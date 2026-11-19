'use strict';
/**
 * 0.8.3 — lỗi phát hiện ở lần kiểm tra thứ hai bản 0.8.2:
 *  P1 đổi trạng thái bảng giá ĐANG DÙNG phải xác nhận (và ghi audit/cảnh báo khi phiếu đã duyệt đổi tiền);
 *  P2 hoàn tác lô gốc không làm mất dòng "Cần kiểm tra" của lô nhập lại (PENDING_ALREADY);
 *  P2 bật phân quyền SAU khi đã bật duyệt phiếu cũng cảnh báo "chỉ 1 người duyệt";
 *  P3 mốc "xuất ra ổ khác" không lùi khi khôi phục DB cũ.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { xlsxBuffer } = require('./helpers/xlsx');
const { createRuntime } = require('../src/runtime');
const { loadInitialData } = require('../src/services/InitialDataService');
const { SEED_DIR } = require('../src/app');

const PW = 'matkhau-manh-1';
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
async function setup({ seed = true } = {}) {
  const rt = createRuntime({ dataDir: tmp('vc083-'), driver: 'node:sqlite' });
  if (seed) await loadInitialData(rt.app, SEED_DIR);
  const call = (ch, a) => rt.dispatch(ch, a || {});
  const ok = async (ch, a) => { const r = await call(ch, a); assert.equal(r.ok, true, ch + ': ' + r.error); return r.data; };
  return { rt, call, ok };
}

// ------------------------------------------------------------------ P1
test('P1: đưa bảng giá ĐANG DÙNG sang INACTIVE → ConfirmRequired, số liệu giữ nguyên; xác nhận → tính lại phiếu chưa chốt, phiếu đã chốt không đổi', async () => {
  const { rt, call, ok } = await setup();
  try {
    const db = rt.app.db;
    const rule = db.get(`SELECT bang_gia_id id, COUNT(*) n, MIN(ngay_can) d FROM phieu_can WHERE trang_thai='ACTIVE' AND bang_gia_id IS NOT NULL GROUP BY bang_gia_id ORDER BY n DESC LIMIT 1`);
    // chốt ngày đầu tiên của bảng giá này → có phiếu đã chốt
    await ok('lock.create', { loai: 'KY', tu_ngay: rule.d.slice(0, 10), den_ngay: rule.d.slice(0, 10) });
    const snap = () => db.all(`SELECT id, tong_tien, trang_thai_tinh_gia, chot_ky_id FROM phieu_can WHERE bang_gia_id=? AND trang_thai='ACTIVE' ORDER BY id`, [rule.id]);
    const before = snap(); const lockedBefore = before.filter((t) => t.chot_ky_id);
    assert.ok(lockedBefore.length > 0 && lockedBefore.length < before.length);

    const r = await call('catalog.update', { table: 'bang_gia_van_chuyen', id: rule.id, data: { trang_thai: 'INACTIVE' } });
    assert.equal(r.ok, false); assert.equal(r.type, 'ConfirmRequired');
    assert.match(r.error, new RegExp(`${before.length} phiếu sử dụng`)); assert.match(r.error, /đã chốt kỳ giữ nguyên/); assert.match(r.error, /Xóa bảng giá/);
    assert.equal(db.get('SELECT trang_thai FROM bang_gia_van_chuyen WHERE id=?', [rule.id]).trang_thai, 'ACTIVE');
    assert.deepEqual(snap(), before, 'chưa xác nhận thì không đổi gì');

    await ok('catalog.update', { table: 'bang_gia_van_chuyen', id: rule.id, data: { trang_thai: 'INACTIVE' }, xac_nhan: true });
    assert.equal(db.get('SELECT trang_thai FROM bang_gia_van_chuyen WHERE id=?', [rule.id]).trang_thai, 'INACTIVE');
    for (const t of lockedBefore) assert.deepEqual(db.get('SELECT id, tong_tien, trang_thai_tinh_gia, chot_ky_id FROM phieu_can WHERE id=?', [t.id]), t, 'phiếu đã chốt giữ nguyên');
    const open = before.filter((t) => !t.chot_ky_id).map((t) => db.get('SELECT bang_gia_id, trang_thai_tinh_gia FROM phieu_can WHERE id=?', [t.id]));
    assert.ok(open.every((t) => t.bang_gia_id !== rule.id), 'phiếu chưa chốt không còn dùng bảng giá đã ngừng');
    // duyệt phiếu tắt → không mở cảnh báo phiếu đã duyệt
    assert.equal(db.get(`SELECT COUNT(*) n FROM canh_bao WHERE loai='PRICE_RECALC_APPROVED'`).n, 0);
  } finally { rt.close(); }
});

test('P1: chỉ đổi ghi chú, hoặc bảng giá không có phiếu dùng → không cần xác nhận', async () => {
  const { rt, ok } = await setup();
  try {
    const used = rt.app.db.get(`SELECT bang_gia_id id FROM phieu_can WHERE trang_thai='ACTIVE' AND bang_gia_id IS NOT NULL LIMIT 1`).id;
    await ok('catalog.update', { table: 'bang_gia_van_chuyen', id: used, data: { ghi_chu: 'ghi chú mới' } });
    const unused = rt.app.db.get(`SELECT id FROM bang_gia_van_chuyen b WHERE trang_thai='ACTIVE' AND NOT EXISTS (SELECT 1 FROM phieu_can p WHERE p.bang_gia_id=b.id AND p.trang_thai='ACTIVE') LIMIT 1`);
    if (unused) await ok('catalog.update', { table: 'bang_gia_van_chuyen', id: unused.id, data: { trang_thai: 'INACTIVE' } });
  } finally { rt.close(); }
});

test('P1: bật duyệt phiếu — phiếu ĐÃ DUYỆT đổi tổng tiền vì đổi trạng thái bảng giá → audit PRICE_RECALC_APPROVED + cảnh báo; phiếu không tự về Nháp', async () => {
  const { rt, ok } = await setup();
  try {
    const db = rt.app.db;
    await ok('settings.set', { key: 'duyet_phieu', value: { bat: true } });     // phiếu hiện có tính là Đã duyệt
    const rule = db.get(`SELECT bang_gia_id id FROM phieu_can WHERE trang_thai='ACTIVE' AND trang_thai_tinh_gia='OK' AND chot_ky_id IS NULL GROUP BY bang_gia_id ORDER BY COUNT(*) DESC LIMIT 1`).id;
    const ids = db.all(`SELECT id FROM phieu_can WHERE bang_gia_id=? AND trang_thai='ACTIVE' AND trang_thai_duyet='DA_DUYET'`, [rule]).map((x) => x.id);
    assert.ok(ids.length > 0);
    await ok('catalog.update', { table: 'bang_gia_van_chuyen', id: rule, data: { trang_thai: 'INACTIVE' }, xac_nhan: true });
    const a = db.get(`SELECT * FROM audit_log WHERE action='PRICE_RECALC_APPROVED' AND entity_id=?`, [rule]);
    assert.ok(a, 'phải có audit PRICE_RECALC_APPROVED');
    assert.equal(JSON.parse(a.old_value).so_phieu, ids.length);
    const c = db.get(`SELECT * FROM canh_bao WHERE loai='PRICE_RECALC_APPROVED' AND entity_id=? AND trang_thai='MOI'`, [rule]);
    assert.ok(c, 'phải mở cảnh báo ở Trung tâm cảnh báo'); assert.equal(c.muc_do, 'TRUNG_BINH');
    assert.ok(ids.every((id) => db.get('SELECT trang_thai_duyet s FROM phieu_can WHERE id=?', [id]).s === 'DA_DUYET'), 'không tự đưa phiếu về Nháp');
  } finally { rt.close(); }
});

test('P1: vẫn phải có quyền duyệt (người nhập liệu bị chặn trước bước xác nhận)', async () => {
  const { rt, call, ok } = await setup();
  try {
    await ok('auth.enable', { ten_dang_nhap: 'admin', ho_ten: 'QT', mat_khau: PW });
    await ok('auth.createUser', { ten_dang_nhap: 'nhap1', ho_ten: 'N', vai_tro: 'NHAP', mat_khau: PW });
    await ok('auth.login', { ten_dang_nhap: 'nhap1', mat_khau: PW });
    const rule = rt.app.db.get(`SELECT bang_gia_id id FROM phieu_can WHERE bang_gia_id IS NOT NULL LIMIT 1`).id;
    const r = await call('catalog.update', { table: 'bang_gia_van_chuyen', id: rule, data: { trang_thai: 'INACTIVE' }, xac_nhan: true });
    assert.equal(r.type, 'Forbidden');
  } finally { rt.close(); }
});

// ------------------------------------------------------------------ P2 hoàn tác
const H = ['Số phiếu', 'Biển số', 'Nơi xuất', 'Giờ cân 1', 'Giờ cân 2', 'Cân 1', 'Cân 2', 'KL hàng'];
const fmt = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 19)}`;
async function importer(ok) {
  return async (rows, fileName) => {
    const o = await ok('import.open', { base64: (await xlsxBuffer([H, ...rows])).toString('base64'), fileName });
    const si = await ok('import.sheetInfo', { token: o.token, sheetName: o.suggestedSheet });
    const pv = await ok('import.preview', { token: o.token, sheetName: si.sheetName, headerRow: si.headerRow, mapping: si.mapping });
    return { pv, cm: await ok('import.commit', { token: o.token }) };
  };
}

test('P2: hoàn tác lô gốc → dòng PENDING_ALREADY của lô nhập lại được thăng cấp thành dòng "Cần kiểm tra"; hoàn tác tiếp lô đó → hết dòng chờ, đóng cảnh báo', async () => {
  const { rt, ok } = await setup();
  try {
    const db = rt.app.db;
    const t0 = db.get(`SELECT * FROM phieu_can WHERE trang_thai='ACTIVE' AND chot_ky_id IS NULL ORDER BY id LIMIT 1`);
    const row = [t0.so_phieu, t0.bien_so_goc, t0.noi_xuat_goc, fmt(t0.ngay_gio_can_1), fmt(t0.ngay_gio_can_2), t0.can_lan_1, t0.can_lan_1 + 15000, 15000];
    const imp = await importer(ok);
    const A = await imp([row], 'a.xlsx'); const B = await imp([row], 'b.xlsx');
    assert.equal(A.cm.conflict, 1); assert.equal(B.cm.pendingAlready, 1);
    const pendOf = async () => (await ok('import.pending')).filter((x) => x.phieu_can_id === t0.id);
    const alertOpen = () => db.get(`SELECT COUNT(*) n FROM canh_bao WHERE loai='DUPLICATE_TICKET' AND entity_id=? AND trang_thai IN ('MOI','DANG_XU_LY')`, [t0.id]).n;

    await ok('import.undo', { batchId: A.cm.batchId, reason: 'nhầm file' });
    const p = await pendOf();
    assert.equal(p.length, 1, 'xung đột vẫn còn trong hàng chờ');
    assert.equal(p[0].batch_id, B.cm.batchId, 'dòng chờ thuộc lô B (còn hiệu lực)');
    assert.equal(alertOpen(), 1, 'cảnh báo trùng vẫn mở');
    const bRow = db.get('SELECT * FROM import_batch WHERE id=?', [B.cm.batchId]);
    assert.equal(bRow.conflict_rows, 1); assert.equal(bRow.duplicate_rows, 0);
    assert.ok(db.get(`SELECT id FROM audit_log WHERE action='PENDING_PROMOTED'`));

    // nhập lại lần 3 → nhận ra đã chờ ở lô B, không mở thêm
    const C = await imp([row], 'c.xlsx'); assert.equal(C.cm.pendingAlready, 1); assert.equal((await pendOf()).length, 1);
    await ok('import.undo', { batchId: C.cm.batchId, reason: 'thử' });
    await ok('import.undo', { batchId: B.cm.batchId, reason: 'nhầm file' });
    assert.equal((await pendOf()).length, 0); assert.equal(alertOpen(), 0);
  } finally { rt.close(); }
});

test('P2: dòng chờ đã được xử lý (Giữ cũ) thì hoàn tác lô gốc không thăng cấp dòng PENDING_ALREADY', async () => {
  const { rt, ok } = await setup();
  try {
    const t0 = rt.app.db.get(`SELECT * FROM phieu_can WHERE trang_thai='ACTIVE' AND chot_ky_id IS NULL ORDER BY id LIMIT 1 OFFSET 3`);
    const row = [t0.so_phieu, t0.bien_so_goc, t0.noi_xuat_goc, fmt(t0.ngay_gio_can_1), fmt(t0.ngay_gio_can_2), t0.can_lan_1, t0.can_lan_1 + 15000, 15000];
    const imp = await importer(ok);
    const A = await imp([row], 'a.xlsx'); await imp([row], 'b.xlsx');
    const pend = (await ok('import.pending')).find((x) => x.phieu_can_id === t0.id);
    await ok('import.resolve', { id: pend.id, action: 'KEEP_OLD' });
    await ok('import.undo', { batchId: A.cm.batchId, reason: 'x' });
    assert.equal((await ok('import.pending')).filter((x) => x.phieu_can_id === t0.id).length, 0);
  } finally { rt.close(); }
});

// ------------------------------------------------------------------ P2 bật phân quyền sau
test('P2: bật duyệt phiếu TRƯỚC, bật phân quyền SAU với 1 quản trị → ConfirmRequired; xac_nhan → bật nhưng không tự duyệt', async () => {
  const { rt, call, ok } = await setup({ seed: false });
  try {
    await ok('settings.set', { key: 'duyet_phieu', value: { bat: true } });
    const r = await call('auth.enable', { ten_dang_nhap: 'admin', ho_ten: 'QT', mat_khau: PW });
    assert.equal(r.ok, false); assert.equal(r.type, 'ConfirmRequired'); assert.match(r.error, /1 người có quyền duyệt/); assert.match(r.error, /Cho phép tự duyệt/);
    assert.equal(rt.app.auth.enabled(), false, 'chưa xác nhận thì chưa bật');
    await ok('auth.enable', { ten_dang_nhap: 'admin', ho_ten: 'QT', mat_khau: PW, xac_nhan: true });
    assert.equal(rt.app.auth.enabled(), true);
    assert.deepEqual(rt.app.settings.get('duyet_phieu'), { bat: true });
  } finally { rt.close(); }
});

test('P2: bật phân quyền kèm bat_tu_duyet → cho_tu_duyet bật, admin tự duyệt được và audit ghi tu_duyet', async () => {
  const { rt, ok } = await setup();
  try {
    await ok('settings.set', { key: 'duyet_phieu', value: { bat: true } });
    await ok('auth.enable', { ten_dang_nhap: 'admin', ho_ten: 'QT', mat_khau: PW, bat_tu_duyet: true });
    assert.deepEqual(rt.app.settings.get('duyet_phieu'), { bat: true, cho_tu_duyet: true });
    const t = rt.app.db.get(`SELECT * FROM phieu_can WHERE trang_thai='ACTIVE' AND trang_thai_tinh_gia='OK' AND chot_ky_id IS NULL LIMIT 1`);
    await ok('tickets.update', { id: t.id, data: { xe_tra_ve: t.xe_tra_ve ? 0 : 1 }, note: 'sửa' });
    const a = await ok('tickets.approve', { ids: [t.id] }); assert.equal(a.ok, 1, JSON.stringify(a.results));
    const log = rt.app.db.get(`SELECT new_value FROM audit_log WHERE action='APPROVE_TICKET' ORDER BY id DESC LIMIT 1`);
    assert.equal(JSON.parse(log.new_value).tu_duyet, true);
  } finally { rt.close(); }
});

test('P2: duyệt phiếu tắt hoặc đã cho tự duyệt → bật phân quyền không hỏi; tắt "cho tự duyệt" khi chỉ 1 người duyệt → hỏi', async () => {
  const { rt, call, ok } = await setup({ seed: false });
  try {
    await ok('auth.enable', { ten_dang_nhap: 'admin', ho_ten: 'QT', mat_khau: PW });       // duyệt phiếu tắt
    await ok('settings.set', { key: 'duyet_phieu', value: { bat: true, cho_tu_duyet: true } });
    const off = await call('settings.set', { key: 'duyet_phieu', value: { bat: true, cho_tu_duyet: false } });
    assert.equal(off.type, 'ConfirmRequired');
    await ok('settings.set', { key: 'duyet_phieu', value: { bat: true, cho_tu_duyet: false }, xac_nhan: true });
    await ok('settings.set', { key: 'duyet_phieu', value: { bat: true } });               // đã bật, lưu lại không hỏi lần nữa
  } finally { rt.close(); }
});

// ------------------------------------------------------------------ P3 mốc xuất
test('P3: mốc "xuất ra ổ khác" ghi cả ra file; khôi phục DB cũ không làm lùi mốc', async () => {
  const { rt, ok } = await setup({ seed: false });
  try {
    const old = await ok('backup.now');                       // DB chưa có mốc xuất
    const dest = tmp('vc083-dest-');
    await ok('backup.export', { file: old.file, dir: dest });
    const st1 = await ok('backup.exportStatus');
    assert.ok(st1.last); assert.equal(st1.nhac, false);
    assert.ok(fs.existsSync(path.join(rt.dirs.backups, 'export-status.json')));
    assert.ok(!(await ok('backup.list')).some((b) => b.name === 'export-status.json'), 'file trạng thái không lẫn vào danh sách bản sao lưu');
    await ok('backup.restore', { file: old.file });
    assert.equal(rt.app.settings.get('backup_export_last'), null, 'DB cũ không có mốc');
    const st2 = await ok('backup.exportStatus');
    assert.equal(st2.last, st1.last, 'mốc lấy từ file, không lùi'); assert.equal(st2.nhac, false);
  } finally { rt.close(); }
});
