'use strict';
/**
 * Đọc .xlsx / .csv thành danh sách sheet + mảng 2 chiều. Không ghi gì.
 *  - .xlsx: exceljs (đọc bất đồng bộ MỘT lần khi mở; `aoa(sheet)` sau đó đồng bộ).
 *  - .csv : bộ đọc riêng (UTF-8/BOM, dấu phân cách , hoặc ; tự nhận, ngoặc kép RFC 4180).
 *  - .xls (Excel 97-2003) KHÔNG đọc được → báo rõ cách chuyển sang .xlsx.
 * Giá trị ô được chuẩn hóa để các bộ phân tích phía sau không phụ thuộc thư viện:
 *   ngày → số seri Excel; công thức → kết quả đã tính; rich text/hyperlink → chuỗi; ô lỗi và ô gộp (không phải ô gốc) → null.
 */
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const ExcelJS = require('exceljs');
const { ValidationError } = require('../services/CatalogService');

const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);   // .xls cũ (và file Office mã hóa)
const ZIP_MAGIC = Buffer.from([0x50, 0x4b]);                                        // .xlsx là ZIP

/** Date → số seri Excel (Excel không có múi giờ: dùng thành phần UTC mà exceljs đã đặt). */
const dateToSerial = (d) => d.getTime() / 86400000 + 25569;

function norm(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return isNaN(v) ? null : dateToSerial(v);
  if (typeof v === 'object') {
    if ('error' in v) return null;
    if ('result' in v) return norm(v.result);            // công thức: lấy kết quả đã lưu
    if ('formula' in v || 'sharedFormula' in v) return null;   // công thức chưa có kết quả
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return norm(v.text);                // hyperlink
    return null;
  }
  return v;
}

/** CSV → mảng 2 chiều (chuỗi). Hỗ trợ "ô có, dấu phẩy" và "" thoát ngoặc kép, xuống dòng trong ô. */
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const FS = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cell = '', q = false;
  const endCell = () => { row.push(cell === '' ? null : cell); cell = ''; };
  const endRow = () => { endCell(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === FS) endCell();
    else if (c === '\n') endRow();
    else if (c === '\r') { if (text[i + 1] !== '\n') endRow(); }
    else cell += c;
  }
  if (cell !== '' || row.length) endRow();
  return rows;
}

async function readWorkbook({ filePath, buffer, fileName }) {
  const buf = buffer ? Buffer.from(buffer) : fs.readFileSync(filePath);
  const name = fileName || (filePath ? path.basename(filePath) : 'file');
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  const aoaCache = new Map();
  let sheets, getAoa;

  if (/\.csv$/i.test(name)) {
    const rows = parseCsv(buf.toString('utf8'));
    const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
    sheets = [{ name: 'Sheet1', rows: rows.length, cols }];
    getAoa = () => rows.map((r) => Array.from({ length: cols }, (_, i) => (i < r.length ? r[i] : null)));
  } else {
    if (/\.xls$/i.test(name) || buf.subarray(0, 8).equals(OLE_MAGIC)) {
      throw new ValidationError('Định dạng Excel cũ (.xls) không còn được hỗ trợ — mở file bằng Excel rồi "Lưu thành" .xlsx (hoặc .csv), sau đó chọn lại.');
    }
    if (!buf.subarray(0, 2).equals(ZIP_MAGIC)) throw new ValidationError('Không đọc được file: không phải định dạng .xlsx hợp lệ (hoặc file bị hỏng).');
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buf); } catch (e) { throw new ValidationError(`Không đọc được file .xlsx: ${e.message}`); }
    const byName = new Map(wb.worksheets.map((w) => [w.name, w]));
    sheets = wb.worksheets.map((w) => ({ name: w.name, rows: w.rowCount || 0, cols: w.columnCount || 0 }));
    getAoa = (sheet) => {
      const ws = byName.get(sheet);
      if (!ws) return [];
      const R = ws.rowCount || 0, C = ws.columnCount || 0, out = [];
      for (let r = 1; r <= R; r++) {
        const row = ws.getRow(r), line = new Array(C);
        for (let c = 1; c <= C; c++) {
          const cell = row.getCell(c);
          line[c - 1] = cell.type === ExcelJS.ValueType.Merge ? null : norm(cell.value);   // ô gộp không phải ô gốc: bỏ (như SheetJS)
        }
        out.push(line);
      }
      return out;
    };
  }
  const aoa = (sheet) => {
    if (!aoaCache.has(sheet)) aoaCache.set(sheet, getAoa(sheet));
    return aoaCache.get(sheet);
  };
  return { fileName: name, hash, size: buf.length, sheets, aoa, buffer: buf };
}

module.exports = { readWorkbook, parseCsv, normCell: norm };
