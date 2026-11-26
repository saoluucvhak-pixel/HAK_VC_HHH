'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { ticketTemplate, vehicleTemplate, partnerTemplate, fuelTemplate, configuredTicketTemplate } = require('../src/excel/templates');

test('mẫu phiếu cân chuẩn Doanh nghiệp: palette corporate, sheet protection, ô công thức khóa, ô nhập mở', async () => {
  const buf = await ticketTemplate({ locations: ['Quế Sơn', 'Đại Hiệp'], carriers: ['HAK', 'HHH'] });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);

  const ws = wb.getWorksheet('Phiếu cân');
  assert.ok(ws, 'phải có sheet Phiếu cân');

  // Tiêu đề dòng 5 khóa (mặc định locked !== false trong ExcelJS)
  const hCol = ws.getCell(5, 2);
  assert.ok(hCol.protection?.locked !== false, 'tiêu đề phải được bảo vệ khóa');

  // Ô công thức KL hàng (dòng 6, cột 8) phải khóa (protection.locked !== false)
  const formulaCell = ws.getCell(6, 8);
  assert.ok(formulaCell.formula || formulaCell.value?.formula, 'cột KL hàng phải có công thức');
  assert.ok(formulaCell.protection?.locked !== false, 'ô công thức phải được bảo vệ khóa');

  // Ô nhập liệu (dòng 6, cột 2) phải mở khóa (locked: false)
  const inputCell = ws.getCell(6, 2);
  assert.equal(inputCell.protection?.locked, false, 'ô nhập liệu phải được mở khóa cho người dùng');

  // Kiểm tra sheet Danh mục có đủ 2 cột địa điểm và đơn vị
  const catSheet = wb.getWorksheet('Danh mục');
  assert.ok(catSheet, 'phải có sheet Danh mục');
  assert.equal(catSheet.getCell(1, 1).value, 'Địa điểm (ACTIVE)');
  assert.equal(catSheet.getCell(1, 2).value, 'Đơn vị vận chuyển (ACTIVE)');
});

test('mẫu giá dầu Doanh nghiệp (fuelTemplate): đúng định dạng và sheet hướng dẫn', async () => {
  const buf = await fuelTemplate();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);

  const ws = wb.getWorksheet('Giá dầu');
  assert.ok(ws, 'phải có sheet Giá dầu');
  assert.equal(ws.getCell(5, 2).value, 'Ngày');
  assert.equal(ws.getCell(5, 3).value, 'Giá dầu (đ/lít)');

  const guide = wb.getWorksheet('Hướng dẫn');
  assert.ok(guide, 'phải có sheet Hướng dẫn');
});

test('mẫu tùy chỉnh (configuredTicketTemplate): bảo vệ sheet và định dạng chuyên nghiệp', async () => {
  const config = {
    name: 'Mẫu thử nghiệm',
    headerRow: 1,
    headerRows: 1,
    columns: { so_phieu: 'Số phiếu', bien_so: 'Biển số', ngay_gio_can_1: 'Ngày giờ cân 1', kl_hang_kg: 'KL hàng' },
    fallbackUnit: 'kg',
  };
  const buf = await configuredTicketTemplate(config);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);

  const data = wb.getWorksheet('Phiếu cân');
  assert.ok(data, 'phải có sheet Phiếu cân');
  assert.equal(data.getCell(2, 1).value, 'Số phiếu');
  assert.equal(data.getCell(3, 1).protection?.locked, false, 'dòng nhập liệu phải mở khóa');
});
