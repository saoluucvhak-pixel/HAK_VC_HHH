'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createHandlers } = require('../src/ipc/handlers');

test('workflow streamlining: quickAssign creates vehicle & carrier history then recalcs', async () => {
  const app = createApp({ dbFile: ':memory:', driver: 'node:sqlite' });
  const handlers = createHandlers(app, {});

  // Tạo sẵn 1 đơn vị vận chuyển
  const carrier = app.catalog.create('don_vi_van_chuyen', { ma: 'HAK', ten: 'Công ty HAK' });

  // Gọi quickAssign
  const res = handlers['vehicles.quickAssign']({ bien_so: '92H-99999', don_vi_van_chuyen_id: carrier.id });
  assert.equal(res.ok, true);
  assert.ok(res.xeId > 0);

  // Kiểm tra xe đã tồn tại
  const xe = app.db.get('SELECT * FROM xe WHERE id=?', [res.xeId]);
  assert.equal(xe.bien_so_chuan, '92H99999');

  // Kiểm tra lịch sử đơn vị
  const ls = app.db.get('SELECT * FROM xe_don_vi_lich_su WHERE xe_id=?', [res.xeId]);
  assert.equal(ls.don_vi_van_chuyen_id, carrier.id);
});

const ExcelJS = require('exceljs');

test('workflow streamlining: preview auto-suggests dot_van_chuyen based on date range', async () => {
  const app = createApp({ dbFile: ':memory:', driver: 'node:sqlite' });
  const dot = app.catalog.create('dot_van_chuyen', { ma_dot: 'DOT_TEST', ten: 'Đợt Tháng 10', tu_ngay: '2026-10-01', den_ngay: '2026-10-31', trang_thai: 'MO' });

  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Data');
  sheet.addRow(['Số phiếu', 'Biển số', 'Ngày cân', 'Khối lượng hàng', 'ĐVT', 'Kho']);
  sheet.addRow(['P001', '92H-00903', '2026-10-05 08:00', 15000, 'kg', 'Kho A']);
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());

  const opened = await app.imports.open({ fileName: 'test.xlsx', buffer });
  const prev = app.imports.preview(opened.token, {
    sheetName: 'Data',
    headerRow: 0,
    headerRows: 1,
    mapping: { so_phieu: 0, bien_so: 1, ngay_gio_can_1: 2, kl_hang_kg: 3, weight_unit: 4, noi_xuat: 5 },
  });

  assert.equal(prev.suggestedDotId, dot.id);
});

test('import chỉ gợi ý đợt đúng ngày, xác nhận dùng cùng nơi đến khi xem trước và ghi', async (t) => {
  const app = createApp();
  t.after(() => app.close());
  const place = app.catalog.create('dia_diem', { ma: 'CANG', ten: 'Cảng hàng', loai: 'CANG' });
  const dot = app.catalog.create('dot_van_chuyen', {
    ma_dot: 'THANG-11', tu_ngay: '2026-11-01', den_ngay: '2026-11-30', noi_giao_id: place.id, trang_thai: 'MO',
  });
  async function open(code, day) {
    const buffer = Buffer.from(`Số phiếu;Biển số;Ngày cân;KL hàng (kg)\n${code};92H-00903;${day} 08:00;15000`);
    const o = await app.imports.open({ fileName: 'can.csv', buffer });
    return [o.token, app.imports.sheetInfo(o.token, o.suggestedSheet)];
  }
  const [outside, outsideMap] = await open('001', '01/10/2026');
  assert.equal(app.imports.preview(outside, outsideMap).suggestedDotId, null);
  app.imports.commit(outside);
  assert.equal(app.db.get("SELECT dot_van_chuyen_id FROM phieu_can WHERE so_phieu='001'").dot_van_chuyen_id, null);

  const [within, withinMap] = await open('002', '02/11/2026');
  assert.equal(app.imports.preview(within, withinMap).suggestedDotId, dot.id);
  assert.throws(() => app.imports.commit(within, { dotId: dot.id }), /xem trước lại/);
  assert.equal(app.imports.preview(within, { ...withinMap, dotId: dot.id }).noiDenId, place.id);
  assert.equal(app.imports.previewRows(within).rows[0].noi_den_id, place.id);
  app.imports.commit(within);
  assert.deepEqual({ ...app.db.get("SELECT dot_van_chuyen_id, noi_den_id FROM phieu_can WHERE so_phieu='002'") },
    { dot_van_chuyen_id: dot.id, noi_den_id: place.id });

  app.catalog.create('dot_van_chuyen', { ma_dot: 'KHAC', tu_ngay: '2026-11-01', trang_thai: 'MO' });
  const [ambiguous, ambiguousMap] = await open('003', '05/11/2026');
  assert.equal(app.imports.preview(ambiguous, ambiguousMap).suggestedDotId, null);
});
