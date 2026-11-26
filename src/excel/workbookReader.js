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
const { Worker } = require('node:worker_threads');
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

function csvSeparator(text) {
  const counts = { ',': new Map(), ';': new Map() };
  let quoted = false, commas = 0, semicolons = 0, records = 0;
  const record = () => {
    for (const [separator, count] of [[',', commas], [';', semicolons]]) {
      if (count) counts[separator].set(count, (counts[separator].get(count) || 0) + 1);
    }
    commas = 0;
    semicolons = 0;
    records++;
  };
  for (let i = 0; i < text.length && records < 30 && i < 4 * 1024 * 1024; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted) {
      if (ch === ',') commas++;
      else if (ch === ';') semicolons++;
      else if (ch === '\n' || (ch === '\r' && text[i + 1] !== '\n')) record();
    }
  }
  if (!quoted && records < 30) record();
  // Ưu tiên cấu trúc số cột lặp lại. Nếu hòa, dùng cấu trúc có nhiều cột hơn.
  const rank = (histogram) => Math.max(0, ...[...histogram].map(([width, repeats]) => repeats * 1000 + Math.min(width, 999)));
  return rank(counts[';']) > rank(counts[',']) ? ';' : ',';
}

/** CSV → mảng 2 chiều (chuỗi). Hỗ trợ "ô có, dấu phẩy" và "" thoát ngoặc kép, xuống dòng trong ô. */
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const FS = csvSeparator(text);
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
const WORKER_THRESHOLD = 128 * 1024;
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

function exceedsSheetLimit({ rows, cols }) {
  return rows > MAX_ROWS || cols > MAX_COLS || rows * cols > MAX_CELLS;
}

async function decodeXlsx(buf) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buf);
  return workbook.worksheets.map((worksheet) => {
    const info = { name: worksheet.name, rows: worksheet.rowCount, cols: worksheet.columnCount };
    const values = [], merged = [], codes = new Map();
    if (!exceedsSheetLimit(info)) worksheet.eachRow((row, r) => {
      const line = [];
      row.eachCell((cell, c) => {
        let value = norm(cell.value);
        const format = (cell.numFmt || '').split(';', 1)[0];
        // ExcelJS dùng mốc 1904 cho cả ô chỉ có giờ. Giữ phần ngày của ô ngày/giờ thực.
        if (workbook.properties.date1904 && typeof value === 'number' && value >= 1462 && value < 1463
            && (cell.value instanceof Date || cell.value?.result instanceof Date)
            && /h|s/i.test(format) && !/d|y/i.test(format)) value -= 1462;
        if (cell.type === ExcelJS.ValueType.Merge) {
          (merged[r - 1] ||= [])[c - 1] = value;
          return;
        }
        if (value == null) return;
        line[c - 1] = value;
        if (/^0{2,255}$/.test(format) && Number.isSafeInteger(value) && value >= 0) {
          codes.set((r - 1) * info.cols + c - 1, String(value).padStart(format.length, '0'));
        }
      });
      values[r - 1] = line;
    });
    return { info, values, merged, codes };
  });
}

function decodeInWorker(buf) {
  return new Promise((resolve, reject) => {
    const bytes = Uint8Array.from(buf);
    const worker = new Worker(require.resolve('./workbookWorker'), { workerData: bytes, transferList: [bytes.buffer] });
    worker.once('message', ({ sheets, error }) => error ? reject(new Error(error)) : resolve(sheets));
    worker.once('error', reject);
    worker.once('exit', (code) => reject(new Error(`Tiến trình đọc Excel đã dừng trước khi trả kết quả (mã ${code})`)));
  });
}

async function readWorkbook({ filePath, buffer, fileName, background = false }) {
  if (!buffer && filePath) {
    const sz = (await fs.promises.stat(filePath)).size;
    if (sz > MAX_FILE_BYTES) throw new ValidationError(`Tệp quá lớn (${Math.round(sz / 1048576)} MB): giới hạn ${MAX_FILE_BYTES / 1048576} MB. Tách tệp hoặc xóa vùng thừa rồi chọn lại.`);
  }
  const buf = buffer ? Buffer.from(buffer) : await fs.promises.readFile(filePath);
  if (buf.length > MAX_FILE_BYTES) throw new ValidationError(`Tệp quá lớn (${Math.round(buf.length / 1048576)} MB): giới hạn ${MAX_FILE_BYTES / 1048576} MB. Tách tệp hoặc xóa vùng thừa rồi chọn lại.`);
  const name = fileName || (filePath ? path.basename(filePath) : 'file');
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  let data;
  if (/\.csv$/i.test(name)) {
    const values = parseCsv(buf.toString('utf8'));
    const cols = values.reduce((max, row) => Math.max(max, row.length), 0);
    data = [{ info: { name: 'Sheet1', rows: values.length, cols }, values }];
  } else {
    if (/\.xls$/i.test(name) || buf.subarray(0, 8).equals(OLE_MAGIC)) {
      throw new ValidationError('Định dạng Excel cũ (.xls) không còn được hỗ trợ — mở file bằng Excel rồi "Lưu thành" .xlsx (hoặc .csv), sau đó chọn lại.');
    }
    if (!buf.subarray(0, 2).equals(ZIP_MAGIC)) throw new ValidationError('Không đọc được file: không phải định dạng .xlsx hợp lệ (hoặc file bị hỏng).');
    const expandedSize = declaredUnzippedBytes(buf);
    if (expandedSize > MAX_UNZIPPED_BYTES) throw new ValidationError('Tệp .xlsx có kích thước giải nén quá lớn (nghi tệp độc hại hoặc hỏng) — không đọc.');
    try {
      data = background && (buf.length >= WORKER_THRESHOLD || expandedSize >= 8 * WORKER_THRESHOLD) ? await decodeInWorker(buf) : await decodeXlsx(buf);
    } catch (error) {
      throw new ValidationError(`Không đọc được file .xlsx: ${error.message}`);
    }
  }
  const sheets = data.map(({ info }) => info);
  const byName = new Map(data.map((sheet) => [sheet.info.name, sheet]));
  const aoaCache = new Map();
  const ensureSize = ({ name: sheet, rows, cols }) => {
    if (exceedsSheetLimit({ rows, cols })) throw new ValidationError(`Sheet "${sheet}" quá lớn hoặc có dữ liệu bất thường (${rows} dòng × ${cols} cột, giới hạn ${MAX_ROWS} × ${MAX_COLS}). Xóa các ô thừa ở vùng xa (Ctrl+End trong Excel) hoặc chọn sheet khác.`);
  };
  const scan = (sheet, start, end) => {
    const data = byName.get(sheet);
    if (!data || start < 0) return [];
    ensureSize(data.info);
    return Array.from({ length: Math.max(0, Math.min(end, data.info.rows) - start) }, (_, offset) =>
      Array.from({ length: data.info.cols }, (_, col) => data.values[start + offset]?.[col] ?? null));
  };
  const aoa = (sheet) => {
    if (!aoaCache.has(sheet)) aoaCache.set(sheet, scan(sheet, 0, byName.get(sheet)?.info.rows ?? 0));
    return aoaCache.get(sheet);
  };
  const codeReader = (sheet) => {
    const data = byName.get(sheet);
    return (row, col, value) => data?.codes?.get(row * data.info.cols + col) ?? value;
  };
  const header = (sheet, index) => {
    const line = scan(sheet, index, index + 1)[0] || [];
    const merged = byName.get(sheet)?.merged?.[index];
    return merged ? line.map((value, col) => merged[col] ?? value) : line;
  };
  return { fileName: name, hash, size: buf.length, sheets, aoa, scan, codeReader, header, buffer: buf };
}

module.exports = { readWorkbook, decodeXlsx, parseCsv, normCell: norm, exceedsSheetLimit };
