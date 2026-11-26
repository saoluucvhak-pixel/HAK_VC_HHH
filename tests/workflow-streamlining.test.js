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
