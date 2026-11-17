'use strict';
const ExcelJS = require('exceljs');

/** Tạo file .xlsx (Buffer) từ mảng 2 chiều — dùng cho test thay cho SheetJS. */
async function xlsxBuffer(rows, sheetName = 'S') {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Ghi file .xlsx ra đĩa. */
async function writeXlsx(file, rows, sheetName = 'S') {
  require('fs').writeFileSync(file, await xlsxBuffer(rows, sheetName));
}

module.exports = { xlsxBuffer, writeXlsx };
