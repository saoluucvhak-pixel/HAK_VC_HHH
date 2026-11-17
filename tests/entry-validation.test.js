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
async function setup(withTickets = false) {
  const app = createApp({ dbFile: ':memory:', driver: 'node:sqlite' });
  app.seed.load(JSON.parse(fs.readFileSync(path.join(SEED_DIR, 'sample-v47.json'), 'utf8')));
  if (withTickets) {
    app.vehicleImport.commit((await app.vehicleImport.preview({ filePath: SAMPLE })).token);
    const dot = app.db.get('SELECT id FROM dot_van_chuyen LIMIT 1');
    const o = await app.imports.open({ filePath: SAMPLE });
    const si = app.imports.sheetInfo(o.token, o.suggestedSheet);
    app.imports.preview(o.token, { sheetName: si.sheetName, headerRow: si.headerRow, mapping: si.mapping, dotId: dot.id });
    app.imports.commit(o.token, {});
  }
  return app;
}
const rej = (fn, re) => assert.throws(fn, (e) => e.name === 'ValidationError' && re.test(e.message), String(re));

test('đơn vị vận chuyển: không trùng Mã/Tên (hoa-thường, dấu), MST và email đúng dạng; sửa chính mình không bị coi là trùng', async () => {
  const app = await setup(); const C = app.catalog;
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

test('địa điểm: không trùng Tên địa điểm khác, không trùng tên gọi (alias) của địa điểm khác', async () => {
  const app = await setup(); const C = app.catalog;
  const [a, b] = app.db.all('SELECT * FROM dia_diem ORDER BY id LIMIT 2');
  rej(() => C.create('dia_diem', { ma: 'L1', ten: a.ten }), /trùng/);
  rej(() => C.create('dia_diem', { ma: 'L2', ten: a.ten.toUpperCase() }), /trùng/);
  const al = app.db.get('SELECT al.alias, al.dia_diem_id FROM dia_diem_alias al WHERE al.alias_folded <> ? LIMIT 1', [''])
    || null;
  if (al) rej(() => C.create('dia_diem', { ma: 'L3', ten: al.alias }), /tên gọi khác|trùng/);
  assert.equal(C.update('dia_diem', b.id, { ten: b.ten }).ten, b.ten);          // sửa chính mình
  assert.equal(C.create('dia_diem', { ma: 'L4', ten: 'Nơi hoàn toàn mới' }).ten, 'Nơi hoàn toàn mới');
});

test('giá dầu phải > 0', async () => {
  const C = (await setup()).catalog;
  rej(() => C.create('gia_dau', { ngay: '2030-02-01', loai_dau: 'DO', gia: -100 }), /> 0/);
  rej(() => C.create('gia_dau', { ngay: '2030-02-02', loai_dau: 'DO', gia: 0 }), /> 0/);
  assert.equal(C.create('gia_dau', { ngay: '2030-02-03', loai_dau: 'DO', gia: 20000 }).gia, 20000);
});

test('bảng giá nhập trực tiếp: đơn giá > 0, VAT 0–100, không chồng hiệu lực; sửa không tự va chạm', async () => {
  const app = await setup(); const C = app.catalog;
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

test('một định nghĩa "đã tính giá": số chuyến đã tính trong bảng kê = số phiếu "da_tinh_gia" trong báo cáo, từng đơn vị', async () => {
  const app = await setup(true);
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

test('tính lại: kết quả không đổi thì không ghi lại phiếu (updated_at giữ nguyên); đổi giá thì cập nhật', async () => {
  const app = await setup(true);
  app.db.run(`UPDATE phieu_can SET updated_at='2000-01-01T00:00:00'`);
  const snap = () => JSON.stringify(app.db.all('SELECT id, xe_id, noi_xuat_id, tuyen_id, don_vi_van_chuyen_id, bang_gia_id, don_gia, tien_truoc_vat, tien_vat, tong_tien, trang_thai_tinh_gia FROM phieu_can ORDER BY id'));
  const before = snap();
  const r = app.cost.recalc({ all: true });
  assert.equal(r.count, 2035);
  assert.equal(snap(), before);                                                       // kết quả y hệt
  assert.equal(app.db.get(`SELECT COUNT(*) n FROM phieu_can WHERE updated_at <> '2000-01-01T00:00:00'`).n, 0);   // không ghi lại
  const t = app.db.get(`SELECT id, tuyen_id, ngay_can FROM phieu_can LIMIT 1`);
  app.price.createVersion({ tuyen_id: t.tuyen_id, tu_ngay: t.ngay_can, don_gia: 99000, phuong_thuc: 'CO_DINH' });
  assert.ok(app.db.get(`SELECT COUNT(*) n FROM phieu_can WHERE updated_at <> '2000-01-01T00:00:00'`).n > 0);   // giá đổi → có ghi
  assert.notEqual(snap(), before);
});

test('timeline: các chuyến cùng giờ cân có thứ tự cố định (theo id), không phụ thuộc thứ tự đầu vào; giờ rỗng không làm lỗi', () => {
  const { buildTimeline } = require('../src/services/TimeAnomalyService');
  const mk = (id, t1, t2) => ({ id, so_phieu: String(id), ngay_gio_can_1: t1, ngay_gio_can_2: t2, can_lan_1: 30000, can_lan_2: 13000 });
  const a = mk(1, '2026-10-01T08:00:00', '2026-10-01T08:10:00'), b = mk(2, '2026-10-01T08:00:00', '2026-10-01T08:10:00'), c = mk(3, '2026-10-01T09:00:00', '2026-10-01T09:10:00');
  const o1 = buildTimeline([c, b, a]).map((t) => t.id), o2 = buildTimeline([a, c, b]).map((t) => t.id), o3 = buildTimeline([b, a, c]).map((t) => t.id);
  assert.deepEqual(o1, [1, 2, 3]); assert.deepEqual(o2, [1, 2, 3]); assert.deepEqual(o3, [1, 2, 3]);
  assert.doesNotThrow(() => buildTimeline([mk(5, null, null), a]));
});
