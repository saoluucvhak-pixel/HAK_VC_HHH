'use strict';
/** P0 0.8.2: quyền theo TỪNG BẢNG cho catalog.*: bảng giá và giá dầu cần quyền duyệt (như price.createVersion / fuel.importCommit). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { createRuntime } = require('../src/runtime');
const { loadInitialData } = require('../src/services/InitialDataService');
const { SEED_DIR } = require('../src/app');
const { permissionFor } = require('../src/utils/permissions');

const PW = 'matkhau-manh-1';
const mk = () => createRuntime({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'vcbg-')), driver: 'node:sqlite' });
const call = (rt, ch, a) => rt.dispatch(ch, a || {});
const login = (rt, u) => call(rt, 'auth.login', { ten_dang_nhap: u, mat_khau: PW });
const tong = (rt) => rt.app.db.get(`SELECT SUM(tong_tien) t FROM phieu_can WHERE trang_thai='ACTIVE'`).t;

async function setup() {
  const rt = mk(); await loadInitialData(rt.app, SEED_DIR);
  assert.equal((await call(rt, 'auth.enable', { ten_dang_nhap: 'admin', ho_ten: 'QT', mat_khau: PW })).ok, true);
  for (const [u, r] of [['nhap1', 'NHAP'], ['duyet1', 'DUYET']]) assert.equal((await call(rt, 'auth.createUser', { ten_dang_nhap: u, ho_ten: u, vai_tro: r, mat_khau: PW })).ok, true);
  return rt;
}
const priceRow = (rt) => rt.app.db.get(`SELECT id, tuyen_id, don_vi_van_chuyen_id FROM bang_gia_van_chuyen ORDER BY id LIMIT 1`);
const bgData = (b) => ({ ma_bang_gia: 'BG-LEO-1', tuyen_id: b.tuyen_id, tu_ngay: '2020-01-01', don_gia_goc: 999999, vat_percent: 8, phuong_thuc: 'CO_DINH', don_vi_tinh: 'DONG_TAN', trang_thai: 'ACTIVE' });

test('permissionFor(catalog.*, {table}): bảng giá/giá dầu → duyet; bảng khác → nhap', () => {
  for (const ch of ['catalog.create', 'catalog.update', 'catalog.remove']) {
    assert.equal(permissionFor(ch, { table: 'bang_gia_van_chuyen' }), 'duyet');
    assert.equal(permissionFor(ch, { table: 'gia_dau' }), 'duyet');
    assert.equal(permissionFor(ch, { table: 'xe' }), 'nhap');
    assert.equal(permissionFor(ch, {}), 'nhap');
    assert.equal(permissionFor(ch), 'nhap');
  }
  assert.equal(permissionFor('catalog.list', { table: 'bang_gia_van_chuyen' }), 'xem');
  assert.equal(permissionFor('catalog.create', { table: '__proto__' }), 'nhap');
});

test('NHAP không tạo/sửa/xóa được bảng giá và giá dầu; tổng tiền phiếu không đổi; DUYET được; bảng khác NHAP vẫn được', async () => {
  const rt = await setup();
  try {
    const b = priceRow(rt); const before = tong(rt);
    await login(rt, 'nhap1');
    for (const [ch, a] of [
      ['catalog.create', { table: 'bang_gia_van_chuyen', data: bgData(b) }],
      ['catalog.update', { table: 'bang_gia_van_chuyen', id: b.id, data: { ghi_chu: 'x' } }],
      ['catalog.remove', { table: 'bang_gia_van_chuyen', id: b.id }],
      ['catalog.create', { table: 'gia_dau', data: { ngay: '2026-10-01', loai_dau: 'DO', gia: 99999 } }],
    ]) {
      const r = await call(rt, ch, a);
      assert.equal(r.ok, false, ch + ' ' + a.table + ' phải bị từ chối'); assert.equal(r.type, 'Forbidden');
    }
    assert.equal(rt.app.db.get(`SELECT COUNT(*) n FROM bang_gia_van_chuyen WHERE ma_bang_gia='BG-LEO-1'`).n, 0);
    assert.equal(tong(rt), before);
    // bảng khác vẫn nhập được ở vai trò NHAP
    const okXe = await call(rt, 'catalog.create', { table: 'dia_diem', data: { ma: 'DD-TEST', ten: 'Địa điểm thử', loai: 'KHO' } });
    assert.notEqual(okXe.type, 'Forbidden', okXe.error);
    // DUYET được qua cửa quyền (có thể bị chặn bởi nghiệp vụ khác, nhưng không phải Forbidden)
    await login(rt, 'duyet1');
    const r2 = await call(rt, 'catalog.create', { table: 'gia_dau', data: { ngay: '2026-10-01', loai_dau: 'DO 0,05S-II', gia: 20000 } });
    assert.equal(r2.ok, true, r2.error);
    await login(rt, 'admin');
    assert.notEqual((await call(rt, 'catalog.update', { table: 'bang_gia_van_chuyen', id: b.id, data: { ghi_chu: 'adm' } })).type, 'Forbidden');
  } finally { rt.close(); }
});

test('TẮT phân quyền: catalog.* với bảng giá chạy như cũ', async () => {
  const rt = mk(); await loadInitialData(rt.app, SEED_DIR);
  try {
    const b = priceRow(rt);
    const r = await call(rt, 'catalog.update', { table: 'bang_gia_van_chuyen', id: b.id, data: { ghi_chu: 'ok' } });
    assert.equal(r.ok, true, r.error);
  } finally { rt.close(); }
});

test('P1: bảng giá chỉ đổi qua "Phiên bản giá mới": catalog.update chỉ nhận ghi_chu/trang_thai; catalog.create bị từ chối kèm hướng dẫn', async () => {
  const rt = mk(); await loadInitialData(rt.app, SEED_DIR);
  try {
    const b = priceRow(rt); const before = tong(rt);
    const row0 = rt.app.db.get('SELECT don_gia_goc, vat_percent, tu_ngay FROM bang_gia_van_chuyen WHERE id=?', [b.id]);
    const bad = await call(rt, 'catalog.update', { table: 'bang_gia_van_chuyen', id: b.id, data: { don_gia_goc: 1 } });
    assert.equal(bad.ok, false); assert.equal(bad.type, 'ValidationError'); assert.match(bad.error, /Phiên bản giá mới/);
    const bad2 = await call(rt, 'catalog.update', { table: 'bang_gia_van_chuyen', id: b.id, data: { ghi_chu: 'x', vat_percent: 99, tu_ngay: '2020-01-01' } });
    assert.equal(bad2.ok, false); assert.match(bad2.error, /vat_percent|VAT|Phiên bản giá mới/);
    assert.deepEqual(rt.app.db.get('SELECT don_gia_goc, vat_percent, tu_ngay FROM bang_gia_van_chuyen WHERE id=?', [b.id]), row0);
    assert.equal(tong(rt), before);
    const cr = await call(rt, 'catalog.create', { table: 'bang_gia_van_chuyen', data: bgData(b) });
    assert.equal(cr.ok, false); assert.equal(cr.type, 'ValidationError'); assert.match(cr.error, /Phiên bản giá mới/);
    const ok = await call(rt, 'catalog.update', { table: 'bang_gia_van_chuyen', id: b.id, data: { ghi_chu: 'ghi chú mới' } });
    assert.equal(ok.ok, true, ok.error);
    assert.equal(rt.app.db.get('SELECT ghi_chu g FROM bang_gia_van_chuyen WHERE id=?', [b.id]).g, 'ghi chú mới');
    // kênh chính thức vẫn tạo được phiên bản mới
    const nv = await call(rt, 'price.createVersion', { tuyen_id: b.tuyen_id, tu_ngay: '2027-01-01', don_gia_goc: 100000, vat_percent: 8, don_vi_tinh: 'DONG_TAN', ma_bang_gia: 'BG-NV-1' });
    assert.equal(nv.ok, true, nv.error);
  } finally { rt.close(); }
});

test('P1: xem trước tác động trước khi ghi — "tuyến nào đóng giá cũ ngày nào, mở giá mới bao nhiêu, bao nhiêu phiếu tính lại"', async () => {
  const rt = mk(); await loadInitialData(rt.app, SEED_DIR);
  try {
    const ok = async (ch, a) => { const r = await call(rt, ch, a); assert.equal(r.ok, true, ch + ': ' + r.error); return r.data; };
    const fuel = rt.app.db.get(`SELECT tuyen_id FROM bang_gia_van_chuyen WHERE phuong_thuc='DIEU_CHINH_DAU' AND trang_thai='ACTIVE' ORDER BY id LIMIT 1`);
    if (!fuel) return;                                    // dữ liệu mẫu không có tuyến điều chỉnh dầu → test chỉ áp dụng khi có
    const before = rt.app.db.get('SELECT COUNT(*) n FROM bang_gia_van_chuyen').n;
    const pv = await ok('price.previewApply', { ngay_ap_dung: '2027-03-01', gia_dau: 25000 });
    assert.ok(Array.isArray(pv.items) && pv.items.length > 0);
    const it = pv.items[0];
    for (const k of ['ma_tuyen', 'gia_cu', 'gia_moi', 'dong_gia_cu_den', 'mo_gia_moi_tu', 'so_phieu_tinh_lai']) assert.ok(k in it, 'thiếu ' + k);
    assert.equal(it.dong_gia_cu_den, '2027-02-28'); assert.equal(it.mo_gia_moi_tu, '2027-03-01');
    assert.equal(rt.app.db.get('SELECT COUNT(*) n FROM bang_gia_van_chuyen').n, before, 'xem trước không được ghi dữ liệu');
    // số phiếu tính lại khớp thực tế
    const created = await ok('price.applySheet', { ngay_ap_dung: '2027-03-01', gia_dau: 25000 });
    assert.equal(created.created, pv.items.filter((i) => !i.skip).length);
    // ngày áp dụng nằm trong dải phiếu → có phiếu chưa chốt bị tính lại; số đếm khớp COUNT thực tế
    const d0 = rt.app.db.get(`SELECT MIN(ngay_can) d FROM phieu_can WHERE trang_thai='ACTIVE' AND chot_ky_id IS NULL`).d;
    const pv2 = await ok('price.previewApply', { ngay_ap_dung: String(d0).slice(0, 10), gia_dau: 25000 });
    const tong2 = pv2.items.reduce((s, i) => s + i.so_phieu_tinh_lai, 0);
    const real = pv2.items.reduce((s, i) => s + rt.app.db.get(`SELECT COUNT(*) n FROM phieu_can WHERE tuyen_id=? AND trang_thai='ACTIVE' AND chot_ky_id IS NULL AND ngay_can >= ?${i.ma_gia_cu ? '' : ''}`, [i.tuyen_id, String(d0).slice(0, 10)]).n, 0);
    assert.ok(tong2 > 0); assert.ok(tong2 <= real);
  } finally { rt.close(); }
});

test('P1: kỳ giá dầu — xem trước (price.previewFuel) có đủ thông tin đóng/mở giá và số phiếu tính lại', async () => {
  const rt = mk(); await loadInitialData(rt.app, SEED_DIR);
  try {
    const ok = async (ch, a) => { const r = await call(rt, ch, a); assert.equal(r.ok, true, ch + ': ' + r.error); return r.data; };
    const g = rt.app.db.all(`SELECT ngay, loai_dau FROM gia_dau ORDER BY ngay`);
    if (!g.length) return;
    const id = await ok('price.createFuelPeriod', { ma_ky: 'K-T', loai_dau: g[0].loai_dau, tu_ngay_tham_chieu: g[0].ngay, den_ngay_tham_chieu: g[g.length - 1].ngay, ngay_ap_dung: '2027-04-01' });
    const pv = await ok('price.previewFuel', { id });
    for (const it of pv.items.filter((i) => !i.skip)) { assert.equal(it.dong_gia_cu_den, '2027-03-31'); assert.equal(it.mo_gia_moi_tu, '2027-04-01'); assert.equal(typeof it.so_phieu_tinh_lai, 'number'); }
  } finally { rt.close(); }
});

test('P1: giá dầu — "+ Thêm giá" (catalog.create gia_dau) và "Import" (fuel.importPreview/Commit) cùng mức quyền duyet', () => {
  assert.equal(permissionFor('catalog.create', { table: 'gia_dau' }), 'duyet');
  assert.equal(permissionFor('catalog.update', { table: 'gia_dau' }), 'duyet');
  assert.equal(permissionFor('fuel.importPreview'), 'duyet');
  assert.equal(permissionFor('fuel.importCommit'), 'duyet');
});

test('auth.status trả channelPerm/tablePerm lấy từ permissions.js (giao diện không tự khai mức quyền)', async () => {
  const { CHANNEL_PERM, TABLE_PERM } = require('../src/utils/permissions');
  const rt = mk();
  try {
    const st = (await call(rt, 'auth.status')).data;
    assert.equal(st.channelPerm['tickets.approve'], 'duyet'); assert.equal(st.channelPerm['price.createVersion'], 'duyet');
    assert.equal(st.channelPerm['tickets.remove'], CHANNEL_PERM.get('tickets.remove'));
    assert.deepEqual(st.tablePerm, TABLE_PERM);
  } finally { rt.close(); }
});

test('0.8.4: backup.export (xuất cả CSDL, gồm băm mật khẩu) chỉ dành cho quản trị; backup.now vẫn ở quyền nhập', async () => {
  const { CHANNEL_PERM } = require('../src/utils/permissions');
  assert.equal(CHANNEL_PERM.get('backup.export'), 'admin'); assert.equal(CHANNEL_PERM.get('backup.now'), 'nhap');
  const rt = mk(); await loadInitialData(rt.app, SEED_DIR);
  try {
    assert.equal((await call(rt, 'auth.enable', { ten_dang_nhap: 'admin', ho_ten: 'QT', mat_khau: PW })).ok, true);
    assert.equal((await call(rt, 'auth.createUser', { ten_dang_nhap: 'nhap1', ho_ten: 'n', vai_tro: 'NHAP', mat_khau: PW })).ok, true);
    await login(rt, 'nhap1');
    const b = await call(rt, 'backup.now'); assert.equal(b.ok, true, b.error);
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'vcdest-'));
    const r = await call(rt, 'backup.export', { file: b.data.file, dir: dest });
    assert.equal(r.ok, false); assert.equal(r.type, 'Forbidden'); assert.deepEqual(fs.readdirSync(dest), []);
    await login(rt, 'admin');
    const r2 = await call(rt, 'backup.export', { file: b.data.file, dir: dest });
    assert.equal(r2.ok, true, r2.error);
  } finally { rt.close(); }
});

test('0.8.4: kênh ghi chưa từng có test quyền — XEM luôn bị Forbidden; NHAP bị chặn ở kênh mức duyệt; kênh mức nhập qua được cửa quyền', async () => {
  const rt = mk(); await loadInitialData(rt.app, SEED_DIR);
  try {
    assert.equal((await call(rt, 'auth.enable', { ten_dang_nhap: 'admin', ho_ten: 'QT', mat_khau: PW })).ok, true);
    for (const [u, r] of [['xem1', 'XEM'], ['nhap1', 'NHAP']]) assert.equal((await call(rt, 'auth.createUser', { ten_dang_nhap: u, ho_ten: u, vai_tro: r, mat_khau: PW })).ok, true);
    const GHI = ['price.remove', 'vehicles.importCommit', 'alerts.setStatus', 'import.cancel', 'recon.weight', 'price.createFuelPeriod', 'tickets.remove', 'cost.recalc'];
    await login(rt, 'xem1');
    for (const ch of GHI) { const r = await call(rt, ch, {}); assert.equal(r.type, 'Forbidden', `XEM phải bị chặn ở ${ch}`); }
    await login(rt, 'nhap1');
    for (const ch of ['price.remove', 'recon.weight']) assert.equal((await call(rt, ch, {})).type, 'Forbidden', `NHAP phải bị chặn ở ${ch} (mức duyệt)`);
    for (const ch of ['vehicles.importCommit', 'alerts.setStatus', 'import.cancel', 'cost.recalc']) assert.notEqual((await call(rt, ch, {})).type, 'Forbidden', `NHAP phải qua cửa quyền ở ${ch}`);
  } finally { rt.close(); }
});
