'use strict';
/** Phạm vi nghiệp vụ của phiếu Nháp do BACKEND bảo đảm: tham số từ người gọi (moi_trang_thai, trang_thai_duyet, bộ lọc lưu từ bản cũ) không được kéo Nháp vào báo cáo/bảng kê/xuất/chốt kỳ. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { createRuntime } = require('../src/runtime');
const { loadInitialData } = require('../src/services/InitialDataService');
const { SEED_DIR } = require('../src/app');

test('Nháp không lọt vào đầu ra dù người gọi truyền moi_trang_thai / trang_thai_duyet', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcap-'));
  const rt = createRuntime({ dataDir: dir, driver: 'node:sqlite' });
  try {
    await loadInitialData(rt.app, SEED_DIR);
    const d = async (ch, a) => { const r = await rt.dispatch(ch, a || {}); assert.equal(r.ok, true, `${ch}: ${r.error}`); return r.data; };
    await d('settings.set', { key: 'duyet_phieu', value: { bat: true } });
    const t = rt.app.db.get(`SELECT id, ngay_can FROM phieu_can WHERE trang_thai='ACTIVE' AND chot_ky_id IS NULL ORDER BY id LIMIT 1`);
    await d('tickets.update', { id: t.id, data: { kl_hang_kg: 21000, can_lan_2: rt.app.tickets.get(t.id).can_lan_1 + 21000 }, note: 'thử' });
    assert.equal(rt.app.tickets.get(t.id).trang_thai_duyet, 'NHAP');
    const base = await d('reports.dashboard', {});
    const ngay = String(t.ngay_can).slice(0, 10);
    for (const extra of [{ moi_trang_thai: true }, { trang_thai_duyet: 'NHAP' }, { moi_trang_thai: true, trang_thai_duyet: 'NHAP' }, { moi_trang_thai: '1' }]) {
      const dash = await d('reports.dashboard', extra);
      if (extra.trang_thai_duyet === 'NHAP') assert.equal(dash.kpi.so_chuyen, 0);
      else assert.deepEqual(dash, base);
      for (const ch of ['reports.byVehicle', 'reports.byCarrier', 'reports.byOrigin', 'reports.byDate', 'reports.byDot']) {
        if (extra.trang_thai_duyet === 'NHAP') assert.equal((await d(ch, extra)).length, 0);
        else assert.deepEqual(await d(ch, extra), await d(ch, {}));
      }
      if (extra.trang_thai_duyet === 'NHAP') assert.equal((await d('reports.statements', extra)).length, 0);
      else assert.deepEqual(await d('reports.statements', extra), await d('reports.statements', {}));
      assert.deepEqual(await d('lock.preview', { loai: 'KY', tu_ngay: ngay, den_ngay: ngay, ...extra }), await d('lock.preview', { loai: 'KY', tu_ngay: ngay, den_ngay: ngay }), 'Chốt kỳ preview');
    }
    // kênh liệt kê phiếu cân là nơi duy nhất được thấy Nháp
    assert.ok((await d('tickets.ids', { filter: {} })).includes(t.id));
    assert.ok((await d('tickets.ids', { filter: { trang_thai_duyet: 'NHAP' } })).includes(t.id));
    assert.ok(!(await d('tickets.ids', { filter: { trang_thai_duyet: 'DA_DUYET' } })).includes(t.id));
  } finally { rt.close && rt.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('import → xung đột "Cập nhật" → duyệt → hoàn tác batch: số liệu cũ khôi phục thì phiếu phải quay lại Nháp, phiếu mới nhập bị VOID, người nhập/duyệt/audit đúng', async () => {
  const { xlsxBuffer } = require('./helpers/xlsx');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcap2-'));
  const rt = createRuntime({ dataDir: dir, driver: 'node:sqlite' });
  try {
    await loadInitialData(rt.app, SEED_DIR);
    const ok = async (ch, a) => { const r = await rt.dispatch(ch, a || {}); assert.equal(r.ok, true, `${ch}: ${r.error}`); return r.data; };
    await ok('settings.set', { key: 'duyet_phieu', value: { bat: true } });
    const H = ['Số phiếu', 'Biển số', 'Nơi xuất', 'Giờ cân 1', 'Giờ cân 2', 'Cân 1', 'Cân 2', 'KL hàng'];
    const t0 = rt.app.db.get(`SELECT * FROM phieu_can WHERE trang_thai='ACTIVE' AND chot_ky_id IS NULL ORDER BY id LIMIT 1`);
    const fmt = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 19)}`;
    const conflict = [t0.so_phieu, t0.bien_so_goc, t0.noi_xuat_goc, fmt(t0.ngay_gio_can_1), fmt(t0.ngay_gio_can_2), t0.can_lan_1, t0.can_lan_1 + 15000, 15000];
    const plate = rt.app.db.get('SELECT bien_so_chuan b FROM xe LIMIT 1').b;
    const fresh = ['MX1', plate, 'Quế Sơn', '05/10/2026 08:00:00', '05/10/2026 08:30:00', 30000, 13000, 17000];
    const o = await ok('import.open', { base64: (await xlsxBuffer([H, conflict, fresh])).toString('base64'), fileName: 'f.xlsx' });
    const si = await ok('import.sheetInfo', { token: o.token, sheetName: o.suggestedSheet });
    const dot = rt.app.db.get('SELECT id FROM dot_van_chuyen ORDER BY id LIMIT 1').id;
    await ok('import.preview', { token: o.token, sheetName: si.sheetName, headerRow: si.headerRow, mapping: si.mapping, dotId: dot });
    const cm = await ok('import.commit', { token: o.token });
    const mx = rt.app.db.get(`SELECT * FROM phieu_can WHERE so_phieu='MX1'`);
    assert.equal(mx.trang_thai_duyet, 'NHAP');                                   // phiếu mới nhập khi bật duyệt = Nháp
    assert.equal(rt.app.tickets.get(t0.id).trang_thai_duyet, 'DA_DUYET');        // phiếu xung đột giữ nguyên tới khi chọn "Cập nhật"
    const pend = await ok('import.pending', {});
    await ok('import.resolve', { id: pend[0].id, action: 'UPDATE', note: 'theo file mới' });
    const a = rt.app.tickets.get(t0.id); assert.equal(a.trang_thai_duyet, 'NHAP'); assert.equal(a.duyet_boi, null);
    const ap = rt.app.tickets.approve([t0.id, mx.id]); assert.equal(ap.ok, 2);
    assert.equal(rt.app.tickets.get(t0.id).trang_thai_duyet, 'DA_DUYET');
    await ok('import.undo', { batchId: cm.batchId, reason: 'hoàn tác thử' });
    const b = rt.app.tickets.get(t0.id);
    assert.equal(b.kl_hang_kg, t0.kl_hang_kg);                                   // số liệu cũ đã khôi phục
    assert.equal(b.trang_thai_duyet, 'NHAP', 'khôi phục số liệu cũ phải cần duyệt lại');
    assert.equal(b.duyet_boi, null);
    assert.equal(rt.app.tickets.get(mx.id).trang_thai, 'VOID');
  } finally { rt.close && rt.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('phân quyền + duyệt: người nhập/sửa không tự duyệt; người nhập (NHAP) bị chặn quyền; người duyệt khác duyệt được; audit ghi đúng người', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcap3-'));
  const rt = createRuntime({ dataDir: dir, driver: 'node:sqlite' });
  const PW = 'matkhau-manh-1';
  const call = (ch, a) => rt.dispatch(ch, a || {});
  try {
    await loadInitialData(rt.app, SEED_DIR);
    assert.equal((await call('auth.enable', { ten_dang_nhap: 'admin', ho_ten: 'QT', mat_khau: PW })).ok, true);
    for (const [u, r] of [['nhap1', 'NHAP'], ['duyet1', 'DUYET'], ['duyet2', 'DUYET']]) assert.equal((await call('auth.createUser', { ten_dang_nhap: u, ho_ten: u, vai_tro: r, mat_khau: PW })).ok, true);
    assert.equal((await call('settings.set', { key: 'duyet_phieu', value: { bat: true } })).ok, true);
    const t = rt.app.db.get(`SELECT id FROM phieu_can WHERE trang_thai='ACTIVE' AND chot_ky_id IS NULL ORDER BY id LIMIT 1`);
    await call('auth.login', { ten_dang_nhap: 'duyet1', mat_khau: PW });
    assert.equal((await call('tickets.update', { id: t.id, data: { kl_hang_kg: 21000, can_lan_2: rt.app.tickets.get(t.id).can_lan_1 + 21000 }, note: 'sửa' })).ok, true);
    assert.equal(rt.app.tickets.get(t.id).nhap_boi, 'duyet1');
    const self = await call('tickets.approve', { ids: [t.id] });
    assert.equal(self.ok, true); assert.equal(self.data.ok, 0); assert.match(self.data.results[0].reason, /không tự duyệt/);
    await call('auth.login', { ten_dang_nhap: 'nhap1', mat_khau: PW });
    const r = await call('tickets.approve', { ids: [t.id] });
    assert.equal(r.ok, false); assert.equal(r.type, 'Forbidden');
    await call('auth.login', { ten_dang_nhap: 'duyet2', mat_khau: PW });
    const ok = await call('tickets.approve', { ids: [t.id, t.id] });
    assert.equal(ok.ok, true); assert.equal(ok.data.ok, 1);
    const a = rt.app.tickets.get(t.id); assert.equal(a.trang_thai_duyet, 'DA_DUYET'); assert.equal(a.duyet_boi, 'duyet2'); assert.ok(a.duyet_luc);
    assert.equal(rt.app.db.get(`SELECT user_name u FROM audit_log WHERE action='APPROVE_TICKET' ORDER BY id DESC LIMIT 1`).u, 'duyet2');
  } finally { rt.close && rt.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('đổi ngưỡng KL sau khi xem trước: commit kiểm lại theo cấu hình hiện hành, không ghi phiếu vi phạm', async () => {
  const { xlsxBuffer } = require('./helpers/xlsx');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcap4-'));
  const rt = createRuntime({ dataDir: dir, driver: 'node:sqlite' });
  try {
    await loadInitialData(rt.app, SEED_DIR);
    const ok = async (ch, a) => { const r = await rt.dispatch(ch, a || {}); assert.equal(r.ok, true, `${ch}: ${r.error}`); return r.data; };
    const H = ['Số phiếu', 'Biển số', 'Nơi xuất', 'Giờ cân 1', 'Giờ cân 2', 'Cân 1', 'Cân 2', 'KL hàng'];
    const plate = rt.app.db.get('SELECT bien_so_chuan b FROM xe LIMIT 1').b;
    const row = ['KL1', plate, 'Quế Sơn', '05/10/2026 08:00:00', '05/10/2026 08:30:00', 30000, 13000, 17000];
    const o = await ok('import.open', { base64: (await xlsxBuffer([H, row])).toString('base64'), fileName: 'f.xlsx' });
    const si = await ok('import.sheetInfo', { token: o.token, sheetName: o.suggestedSheet });
    const dot = rt.app.db.get('SELECT id FROM dot_van_chuyen ORDER BY id LIMIT 1').id;
    const pv = await ok('import.preview', { token: o.token, sheetName: si.sheetName, headerRow: si.headerRow, mapping: si.mapping, dotId: dot });
    assert.equal(pv.counts.new, 1);
    await ok('settings.set', { key: 'kl_hop_ly', value: { min_kg: 20000, max_kg: 100000 } });   // 17.000 kg giờ là quá nhỏ
    const r = await rt.dispatch('import.commit', { token: o.token });
    assert.equal(r.ok, false); assert.match(r.error, /Ngưỡng khối lượng đã thay đổi/);
    const n = rt.app.db.get(`SELECT COUNT(*) n FROM phieu_can WHERE so_phieu='KL1' AND trang_thai='ACTIVE'`).n;
    assert.equal(n, 0, 'phiếu vi phạm ngưỡng hiện hành vẫn bị ghi: ' + JSON.stringify(r).slice(0, 200));
  } finally { rt.close && rt.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Excel "Chi tiết vận chuyển": mặc định không gồm phiếu Nháp (nêu rõ số phiếu bị bỏ qua); lọc Nháp rõ ràng thì xuất Nháp kèm cột trạng thái duyệt', async () => {
  const ExcelJS = require('exceljs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcap5-'));
  const rt = createRuntime({ dataDir: dir, driver: 'node:sqlite' });
  try {
    await loadInitialData(rt.app, SEED_DIR);
    const d = async (ch, a) => { const r = await rt.dispatch(ch, a || {}); assert.equal(r.ok, true, `${ch}: ${r.error}`); return r.data; };
    const read = async (res) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(res.path); const ws = wb.worksheets[0]; const text = []; ws.eachRow((r) => text.push(r.values.filter((v) => v != null).map((v) => (v && v.result !== undefined ? v.result : v)).join('|'))); return text; };
    const total = (await d('tickets.count', { filter: {} })).total;
    await d('settings.set', { key: 'duyet_phieu', value: { bat: true } });
    const t = rt.app.db.get(`SELECT id, so_phieu FROM phieu_can WHERE trang_thai='ACTIVE' AND chot_ky_id IS NULL ORDER BY id LIMIT 1`);
    await d('tickets.update', { id: t.id, data: { kl_hang_kg: 21000, can_lan_2: rt.app.tickets.get(t.id).can_lan_1 + 21000 }, note: 'thử' });
    const all = await read(await d('export.tickets', { filter: {} }));
    assert.ok(!all.slice(4).some((l) => l.split('|')[1] === String(t.so_phieu)), 'Excel mặc định chứa phiếu Nháp');
    const head = all.slice(0, 3).join(' ');
    assert.match(head, new RegExp(`${total - 1} phiếu`), 'tiêu đề phải ghi số phiếu đã duyệt xuất ra: ' + head);
    assert.match(head, /1 phiếu Nháp chưa duyệt/);
    const nhap = await read(await d('export.tickets', { filter: { trang_thai_duyet: 'NHAP' } }));
    assert.match(nhap.slice(0, 3).join(' '), /1 phiếu/); assert.ok(nhap.some((l) => l.includes('Nháp')));
  } finally { rt.close && rt.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('đối chiếu đối tác: phiếu Nháp không tham gia và kết quả báo số phiếu Nháp bị bỏ qua', async () => {
  const { xlsxBuffer } = require('./helpers/xlsx');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcap6-'));
  const rt = createRuntime({ dataDir: dir, driver: 'node:sqlite' });
  try {
    await loadInitialData(rt.app, SEED_DIR);
    const ok = async (ch, a) => { const r = await rt.dispatch(ch, a || {}); assert.equal(r.ok, true, `${ch}: ${r.error}`); return r.data; };
    await ok('settings.set', { key: 'duyet_phieu', value: { bat: true } });
    const t = rt.app.db.get(`SELECT id, so_phieu, bien_so_goc FROM phieu_can WHERE trang_thai='ACTIVE' AND chot_ky_id IS NULL ORDER BY id LIMIT 1`);
    await ok('tickets.update', { id: t.id, data: { kl_hang_kg: 21000, can_lan_2: rt.app.tickets.get(t.id).can_lan_1 + 21000 }, note: 'thử' });
    const o = await ok('recon.open', { base64: (await xlsxBuffer([['Số phiếu', 'Biển số', 'KL'], [t.so_phieu, t.bien_so_goc, 21000]])).toString('base64'), fileName: 'dt.xlsx' });
    const si = await ok('recon.sheetInfo', { token: o.token, sheetName: o.suggestedSheet });
    const r = await ok('recon.run', { token: o.token, ten: 'thử', sheetName: si.sheetName, headerRow: si.headerRow, mapping: si.mapping });
    assert.equal(r.nhapBoQua, 1);
    assert.equal(rt.app.db.get(`SELECT COUNT(*) n FROM doi_chieu_ket_qua WHERE batch_id=? AND phieu_can_id=?`, [r.batchId, t.id]).n, 0);
  } finally { rt.close && rt.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
