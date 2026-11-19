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
