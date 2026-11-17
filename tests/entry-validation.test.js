'use strict';
/** Nhập liệu danh mục: chống trùng/chồng lấn/giá trị vô lý; helper dùng chung; "đã tính giá" khớp giữa báo cáo và bảng kê. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createApp, SEED_DIR } = require('../src/app');
const { dayBefore, dmy, dmyHm } = require('../src/utils/datetime');
const { fmtVN, noNegZero } = require('../src/utils/numfmt');

const SAMPLE = path.join(__dirname, 'fixtures', 'sample-v47.xlsx');
function setup(withTickets = false) {
  const app = createApp({ dbFile: ':memory:', driver: 'node:sqlite' });
  app.seed.load(JSON.parse(fs.readFileSync(path.join(SEED_DIR, 'sample-v47.json'), 'utf8')));
  if (withTickets) {
    app.vehicleImport.commit(app.vehicleImport.preview({ filePath: SAMPLE }).token);
    const dot = app.db.get('SELECT id FROM dot_van_chuyen LIMIT 1');
    const o = app.imports.open({ filePath: SAMPLE });
    const si = app.imports.sheetInfo(o.token, o.suggestedSheet);
    app.imports.preview(o.token, { sheetName: si.sheetName, headerRow: si.headerRow, mapping: si.mapping, dotId: dot.id });
    app.imports.commit(o.token, {});
  }
  return app;
}
const rej = (fn, re) => assert.throws(fn, (e) => e.name === 'ValidationError' && re.test(e.message), String(re));

test('đơn vị vận chuyển: không trùng Mã/Tên (hoa-thường, dấu), MST và email đúng dạng; sửa chính mình không bị coi là trùng', () => {
  const app = setup(); const C = app.catalog;
  const dv = app.db.get('SELECT * FROM don_vi_van_chuyen ORDER BY id LIMIT 1');
  rej(() => C.create('don_vi_van_chuyen', { ma: dv.ma.toLowerCase(), ten: 'Khác' }), /Mã .* trùng/);
  rej(() => C.create('don_vi_van_chuyen', { ma: 'NEW1', ten: dv.ten.toUpperCase() }), /Tên .* trùng/);
  rej(() => C.create('don_vi_van_chuyen', { ma: 'NEW2', ten: 'Cty hai', ma_so_thue: 'abc' }), /Mã số thuế/);
  rej(() => C.create('don_vi_van_chuyen', { ma: 'NEW3', ten: 'Cty ba', email: 'khong-phai-email' }), /Email/);
  const ok = C.create('don_vi_van_chuyen', { ma: 'NEW4', ten: 'Cty bốn', ma_so_thue: '0 401 234 567', email: 'a@b.vn' });
  assert.equal(ok.ma_so_thue, '0401234567');                                   // chuẩn hóa bỏ khoảng trắng/chấm
  assert.equal(C.create('don_vi_van_chuyen', { ma: 'NEW5', ten: 'Cty năm', ma_so_thue: '0401234567-001' }).ma_so_thue, '0401234567-001');
  assert.equal(C.update('don_vi_van_chuyen', dv.id, { ten: dv.ten, dien_thoai: '0905' }).dien_thoai, '0905');   // tự mình không phải trùng
});

test('địa điểm: không trùng Tên địa điểm khác, không trùng tên gọi (alias) của địa điểm khác', () => {
  const app = setup(); const C = app.catalog;
  const [a, b] = app.db.all('SELECT * FROM dia_diem ORDER BY id LIMIT 2');
  rej(() => C.create('dia_diem', { ma: 'L1', ten: a.ten }), /trùng/);
  rej(() => C.create('dia_diem', { ma: 'L2', ten: a.ten.toUpperCase() }), /trùng/);
  const al = app.db.get('SELECT al.alias, al.dia_diem_id FROM dia_diem_alias al WHERE al.alias_folded <> ? LIMIT 1', [''])
    || null;
  if (al) rej(() => C.create('dia_diem', { ma: 'L3', ten: al.alias }), /tên gọi khác|trùng/);
  assert.equal(C.update('dia_diem', b.id, { ten: b.ten }).ten, b.ten);          // sửa chính mình
  assert.equal(C.create('dia_diem', { ma: 'L4', ten: 'Nơi hoàn toàn mới' }).ten, 'Nơi hoàn toàn mới');
});

test('giá dầu phải > 0', () => {
  const C = setup().catalog;
  rej(() => C.create('gia_dau', { ngay: '2030-02-01', loai_dau: 'DO', gia: -100 }), /> 0/);
  rej(() => C.create('gia_dau', { ngay: '2030-02-02', loai_dau: 'DO', gia: 0 }), /> 0/);
  assert.equal(C.create('gia_dau', { ngay: '2030-02-03', loai_dau: 'DO', gia: 20000 }).gia, 20000);
});

test('bảng giá nhập trực tiếp: đơn giá > 0, VAT 0–100, không chồng hiệu lực; sửa không tự va chạm', () => {
  const app = setup(); const C = app.catalog;
  const bg = app.db.get(`SELECT * FROM bang_gia_van_chuyen WHERE trang_thai='ACTIVE' ORDER BY id LIMIT 1`);
  const base = { tuyen_id: bg.tuyen_id, don_vi_van_chuyen_id: bg.don_vi_van_chuyen_id, loai_hang: bg.loai_hang, don_vi_tinh: 'DONG_TAN', phuong_thuc: 'CO_DINH', trang_thai: 'ACTIVE', vat_percent: 8 };
  rej(() => C.create('bang_gia_van_chuyen', { ...base, ma_bang_gia: 'OV', tu_ngay: bg.tu_ngay, don_gia_goc: 1000 }), /chồng lấn/);
  rej(() => C.create('bang_gia_van_chuyen', { ...base, ma_bang_gia: 'NEG', tu_ngay: '2040-01-01', don_gia_goc: -5 }), /> 0/);
  rej(() => C.create('bang_gia_van_chuyen', { ...base, ma_bang_gia: 'VAT', tu_ngay: '2040-01-01', don_gia_goc: 5, vat_percent: 800 }), /VAT/);
  // sửa chính bảng giá (đổi ghi chú) không bị coi là chồng với chính nó
  assert.equal(C.update('bang_gia_van_chuyen', bg.id, { ghi_chu: 'ok' }).ghi_chu, 'ok');
  // phiên bản giá qua PriceService (tự đóng bảng cũ) vẫn dùng được
  const id = app.price.createVersion({ tuyen_id: bg.tuyen_id, don_vi_van_chuyen_id: bg.don_vi_van_chuyen_id, tu_ngay: '2040-01-01', don_gia: 111111, phuong_thuc: 'CO_DINH' });
  assert.ok(id > 0);
});

test('helper dùng chung: dayBefore, dmy, dmyHm, fmtVN, noNegZero', () => {
  assert.equal(dayBefore('2026-03-01'), '2026-02-28');
  assert.equal(dayBefore('2024-03-01'), '2024-02-29');
  assert.equal(dayBefore('2026-01-01'), '2025-12-31');
  assert.equal(dmy('2026-10-05T07:08:09'), '05/10/2026');
  assert.equal(dmyHm('2026-10-05T07:08:09'), '05/10/2026 07:08');
  assert.equal(dmy('khong-phai-ngay'), 'khong-phai-ngay');
  assert.equal(dmy(null), '');
  assert.equal(fmtVN(-0.3), '0');
  assert.equal(fmtVN(-0.004, 2), '0,00');
  assert.equal(fmtVN(1234567.891, 2), '1.234.567,89');
  assert.equal(fmtVN(''), '');
  assert.equal(Object.is(noNegZero(-0.2, 0), 0), true);
});

test('một định nghĩa "đã tính giá": số chuyến đã tính trong bảng kê = số phiếu "da_tinh_gia" trong báo cáo, từng đơn vị', () => {
  const app = setup(true);
  for (const d of app.db.all('SELECT id FROM don_vi_van_chuyen')) {
    const st = app.reports.statement({ don_vi_id: d.id });
    const sql = app.reports.where({ don_vi_id: d.id, da_tinh_gia: true });
    const n = app.db.get(`SELECT COUNT(*) n FROM phieu_can p WHERE ${sql.sql}`, sql.params).n;
    assert.equal(st.so_chuyen - st.so_chuyen_chua_tinh_gia, n, `đơn vị ${d.id}`);
  }
});

test('isInside chỉ có một bản: storageLocation dùng safePath', () => {
  const sl = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'storageLocation.js'), 'utf8');
  assert.ok(/require\('\.\/safePath'\)/.test(sl));
});
