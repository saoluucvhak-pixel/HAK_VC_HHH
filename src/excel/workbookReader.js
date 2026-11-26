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

// Giới hạn chống tệp độc hại/hỏng làm hết bộ nhớ của tiến trình chính (Electron sập khi mở tệp của đối tác).
const MAX_FILE_BYTES = 50 * 1024 * 1024;          // tệp tải vào
const MAX_UNZIPPED_BYTES = 500 * 1024 * 1024;     // tổng kích thước giải nén khai báo trong zip
const MAX_ROWS = 300000, MAX_COLS = 256, MAX_CELLS = 8000000;

/** Tổng kích thước giải nén KHAI BÁO trong thư mục trung tâm của zip (không giải nén gì cả). */
function declaredUnzippedBytes(buf) {
  let total = 0;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) !== 0x06054b50) continue;
    const n = buf.readUInt16LE(i + 10); let p = buf.readUInt32LE(i + 16);
    for (let k = 0; k < n && p + 46 <= buf.length && buf.readUInt32LE(p) === 0x02014b50; k++) {
      total += buf.readUInt32LE(p + 24);
      p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    }
    return total;
  }
  return 0;
}

async function readWorkbook({ filePath, buffer, fileName }) {
  if (!buffer && filePath) { const sz = fs.statSync(filePath).size; if (sz > MAX_FILE_BYTES) throw new ValidationError(`Tệp quá lớn (${Math.round(sz / 1048576)} MB): giới hạn ${MAX_FILE_BYTES / 1048576} MB. Tách tệp hoặc xóa vùng thừa rồi chọn lại.`); }
  const buf = buffer ? Buffer.from(buffer) : fs.readFileSync(filePath);
  if (buf.length > MAX_FILE_BYTES) throw new ValidationError(`Tệp quá lớn (${Math.round(buf.length / 1048576)} MB): giới hạn ${MAX_FILE_BYTES / 1048576} MB. Tách tệp hoặc xóa vùng thừa rồi chọn lại.`);
  const name = fileName || (filePath ? path.basename(filePath) : 'file');
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  const aoaCache = new Map();
  let sheets, getAoa, getMergedHeader;
  const paddedCodes = new Map();

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
    if (declaredUnzippedBytes(buf) > MAX_UNZIPPED_BYTES) throw new ValidationError('Tệp .xlsx có kích thước giải nén quá lớn (nghi tệp độc hại hoặc hỏng) — không đọc.');
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buf); } catch (e) { throw new ValidationError(`Không đọc được file .xlsx: ${e.message}`); }
    const byName = new Map(wb.worksheets.map((w) => [w.name, w]));
    sheets = wb.worksheets.map((w) => ({ name: w.name, rows: w.rowCount || 0, cols: w.columnCount || 0 }));
    getMergedHeader = (sheet, index) => {
      const ws = byName.get(sheet);
      if (!ws || index < 0 || index >= ws.rowCount) return [];
      const row = ws.getRow(index + 1);
      return Array.from({ length: ws.columnCount }, (_, col) => norm(row.getCell(col + 1).value));
    };
    getAoa = (sheet) => {
      const ws = byName.get(sheet);
      if (!ws) return [];
      const R = ws.rowCount || 0, C = ws.columnCount || 0, out = [];
      if (R > MAX_ROWS || C > MAX_COLS || R * C > MAX_CELLS) throw new ValidationError(`Sheet "${sheet}" quá lớn hoặc có dữ liệu bất thường (${R} dòng × ${C} cột, giới hạn ${MAX_ROWS} × ${MAX_COLS}). Xóa các ô thừa ở vùng xa (Ctrl+End trong Excel) hoặc chọn sheet khác.`);
      const codes = new Map();
      paddedCodes.set(sheet, codes);
      for (let r = 1; r <= R; r++) {
        const row = ws.getRow(r), line = new Array(C);
        for (let c = 1; c <= C; c++) {
          const cell = row.getCell(c);
          line[c - 1] = cell.type === ExcelJS.ValueType.Merge ? null : norm(cell.value);   // ô gộp không phải ô gốc: bỏ (như SheetJS)
          const format = (cell.numFmt || '').split(';', 1)[0];
          if (/^0{2,255}$/.test(format) && Number.isSafeInteger(line[c - 1]) && line[c - 1] >= 0) {
            codes.set((r - 1) * C + c - 1, String(line[c - 1]).padStart(format.length, '0'));
          }
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
  const codeReader = (sheet) => {
    aoa(sheet);
    const codes = paddedCodes.get(sheet);
    const cols = sheets.find((item) => item.name === sheet)?.cols;
    return (row, col, value) => codes?.get(row * cols + col) ?? value;
  };
  return { fileName: name, hash, size: buf.length, sheets, aoa, codeReader, header: (sheet, index) => getMergedHeader ? getMergedHeader(sheet, index) : aoa(sheet)[index], buffer: buf };
}

module.exports = { readWorkbook, parseCsv, normCell: norm };
