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

// ---------------------------------------------------------------- nhập liệu: kiểm tra tại chỗ + file dòng cần xử lý
const { xlsxBuffer } = require('./helpers/xlsx');
const ExcelJS = require('exceljs');
const HEAD = ['Số phiếu', 'Biển số', 'Nơi xuất', 'Giờ cân 1', 'Giờ cân 2', 'Cân 1', 'Cân 2', 'KL hàng'];
async function openRows(app, rows) {
  const o = await app.imports.open({ buffer: await xlsxBuffer([HEAD, ...rows]), fileName: 'x.xlsx' });
  const si = app.imports.sheetInfo(o.token, o.suggestedSheet);
  return { o, si, args: { sheetName: si.sheetName, headerRow: si.headerRow, mapping: si.mapping } };
}

test('import.check: thiếu cột bắt buộc → chặn, cột gán trùng → cảnh báo, tóm tắt lỗi theo lý do, đọc thử các dòng đầu', async () => {
  const app = await setup(true);
  const plate = app.db.get('SELECT bien_so_hien_thi b FROM xe LIMIT 1').b;
  const { o, args } = await openRows(app, [
    ['9101', plate, 'Quế Sơn', '05/10/2026 08:00', '05/10/2026 08:30', 40000, 23000, 17000],
    ['9102', plate.toLowerCase().replace('-', ' '), 'que son', '31/02/2026 08:00', '', 40000, 23000, 17000],     // ngày không có thật
    ['9103', 'XYZ', 'Mars', '05/10/2026 09:00', '', 40000, 23000, 17000],                                      // biển số sai
    ['9104', plate, 'Quế Sơn', '05/10/2026 10:00', '', 40000, 23000, 99999],                                    // KL lệch cân
  ]);
  const ok = app.imports.check(o.token, args);
  assert.equal(ok.blocking, false);
  assert.equal(ok.summary.tong_dong, 4); assert.equal(ok.summary.dong_loi, 3);
  assert.ok(ok.summary.ly_do.length >= 2 && ok.summary.ly_do.every((x) => x.so_dong >= 1 && x.dong_dau >= 1));
  assert.equal(ok.sample.length, 4);
  assert.equal(ok.sample[0].ngay_gio_can_1, '2026-10-05T08:00:00'); assert.equal(ok.sample[0].noi_xuat_nhan_dang, 'Quế Sơn');
  assert.equal(ok.sample[1].noi_xuat_nhan_dang, 'Quế Sơn');                      // "que son" (không dấu) nhận ra đúng nơi xuất
  assert.equal(ok.sample[1].ngay_gio_can_1, null);                                // 31/02 → không đọc được
  assert.equal(ok.sample[2].noi_xuat_nhan_dang, null);
  assert.ok(ok.sample[2].errors.some((e) => /Biển số/.test(e)));
  // thiếu cột bắt buộc
  const m = { ...args.mapping }; delete m.bien_so; delete m.kl_hang_kg; delete m.can_lan_1;
  const bad = app.imports.check(o.token, { ...args, mapping: m });
  assert.equal(bad.blocking, true);
  assert.ok(bad.problems.filter((p) => p.level === 'error').map((p) => p.text).join('|').match(/Biển số.*KL hàng/s));
  assert.equal(bad.sample.length, 0);
  // cột bị gán cho 2 trường
  const dup = app.imports.check(o.token, { ...args, mapping: { ...args.mapping, ngay_gio_can_2: args.mapping.ngay_gio_can_1 } });
  assert.ok(dup.problems.some((p) => p.level === 'error' && /nhiều trường/.test(p.text)));
  // chỉ đọc: chưa ghi gì, phiên vẫn dùng được để xem trước
  assert.equal(app.db.get(`SELECT COUNT(*) n FROM phieu_can WHERE so_phieu LIKE '91%'`).n, 0);
  assert.doesNotThrow(() => app.imports.preview(o.token, { ...args, dotId: null }));
});

test('import.issuesXlsx: xuất đúng các dòng lỗi / trùng khóa khác / thiếu dữ liệu giá, kèm cách xử lý; phiếu sạch không có mặt', async () => {
  const app = await setup(true);
  const plate = app.db.get('SELECT bien_so_hien_thi b FROM xe LIMIT 1').b;
  const ex = app.db.get('SELECT so_phieu, bien_so_goc, noi_xuat_goc, ngay_gio_can_1 FROM phieu_can LIMIT 1');
  const dmyhm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 16)}`;
  const { o, args } = await openRows(app, [
    ['9201', plate, 'Quế Sơn', '06/10/2026 08:00', '06/10/2026 08:30', 40000, 23000, 17000],              // sạch
    ['9202', plate, 'Quế Sơn', '31/02/2026 08:00', '', 40000, 23000, 17000],                                // lỗi ngày
    ['9203', '99Z-99999', 'Quế Sơn', '06/10/2026 09:00', '06/10/2026 09:30', 40000, 23000, 17000],         // xe chưa có
    ['9204', plate, 'Nơi lạ', '06/10/2026 10:00', '06/10/2026 10:30', 40000, 23000, 17000],                // nơi xuất lạ
    [ex.so_phieu, ex.bien_so_goc, ex.noi_xuat_goc, dmyhm(ex.ngay_gio_can_1), '', 40000, 22000, 18000],     // trùng khóa, khác KL
  ]);
  app.imports.preview(o.token, { ...args, dotId: null });
  const rows = app.imports.issueRows(o.token);
  assert.deepEqual(rows.map((r) => r.phan_loai).sort(), ['ERROR', 'KEY_CONFLICT', 'NEW', 'NEW']);
  assert.ok(!rows.some((r) => r.so_phieu === '9201'));
  const { ISSUE_WARN } = require('../src/services/TicketImportService');
  const buf = await require('../src/excel/exporters').importIssuesWorkbook(rows, { fileName: 'x.xlsx' }, ISSUE_WARN);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('Dòng cần xử lý');
  const text = []; ws.eachRow((r) => text.push(r.values.slice(1).join(' | ')));
  const all = text.join('\n');
  assert.match(all, /Lỗi dữ liệu/); assert.match(all, /Trùng khóa nhưng khác/); assert.match(all, /Xe chưa có trong danh mục/);
  assert.match(all, /Danh mục → Xe/); assert.match(all, /Cần kiểm tra/); assert.match(all, /Địa điểm/);
  assert.ok(!all.includes('9201'));
  assert.throws(() => app.imports.issueRows('khong-co-token'), /hết hạn/);
});
