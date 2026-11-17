'use strict';
/** Bộ đọc file nhập (exceljs + CSV): chuẩn hóa giá trị ô, độc lập múi giờ, từ chối .xls, runtime đợi nạp dữ liệu ban đầu. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ExcelJS = require('exceljs');
const { readWorkbook, parseCsv } = require('../src/excel/workbookReader');
const { parseDateTime } = require('../src/utils/datetime');
const { xlsxBuffer } = require('./helpers/xlsx');
const { createRuntime } = require('../src/runtime');

const rejects = (p, re) => assert.rejects(p, (e) => e.name === 'ValidationError' && re.test(e.message), String(re));

test('xlsx: giá trị ô chuẩn hóa (số, chuỗi, bool, rich text, hyperlink, công thức, ô gộp, dòng trống)', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('A');
  ws.addRow(['Số phiếu', 'KL', 'Ngày', 'Ghi chú']);
  ws.addRow(['001', 17000.5, new Date(Date.UTC(2026, 9, 1, 8, 30, 15)), true]);
  ws.addRow([]);                                                   // dòng trống phải được giữ
  ws.addRow(['002', { formula: 'B2*2', result: 34001 }, null, { richText: [{ text: 'Xin ' }, { text: 'chào' }] }]);
  ws.getCell('A5').value = { text: 'liên kết', hyperlink: 'https://example.com' };
  ws.getCell('B5').value = { error: '#N/A' };
  ws.mergeCells('A6:B6'); ws.getCell('A6').value = 'gộp';
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const r = await readWorkbook({ buffer: buf, fileName: 'a.xlsx' });
  assert.deepEqual(r.sheets, [{ name: 'A', rows: 6, cols: 4 }]);
  const a = r.aoa('A');
  assert.equal(a.length, 6);
  assert.deepEqual(a[0], ['Số phiếu', 'KL', 'Ngày', 'Ghi chú']);
  assert.equal(a[1][0], '001');                                    // giữ số 0 đầu (chuỗi)
  assert.equal(a[1][1], 17000.5);
  assert.equal(typeof a[1][2], 'number');                          // ngày → số seri Excel
  assert.equal(a[1][3], true);
  assert.deepEqual(a[2], [null, null, null, null]);
  assert.equal(a[3][1], 34001);                                    // công thức → kết quả
  assert.equal(a[3][3], 'Xin chào');
  assert.equal(a[4][0], 'liên kết');
  assert.equal(a[4][1], null);                                     // ô lỗi → null
  assert.equal(a[5][0], 'gộp');
  assert.equal(a[5][1], null);                                     // ô gộp không phải ô gốc → null
  assert.equal(parseDateTime(a[1][2]), '2026-10-01T08:30:15');
  assert.equal(r.hash.length, 64);
});

test('xlsx: ngày giờ không phụ thuộc múi giờ máy (Việt Nam / Mỹ / UTC cho cùng kết quả)', async () => {
  const buf = await xlsxBuffer([[new Date(Date.UTC(2026, 9, 1, 23, 59, 58))]]);
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tz-')), 'd.xlsx');
  fs.writeFileSync(tmp, buf);
  const code = `const {readWorkbook}=require(${JSON.stringify(path.join(__dirname, '..', 'src', 'excel', 'workbookReader'))});
    const {parseDateTime}=require(${JSON.stringify(path.join(__dirname, '..', 'src', 'utils', 'datetime'))});
    readWorkbook({filePath:${JSON.stringify(tmp)}}).then(r=>console.log(parseDateTime(r.aoa('S')[0][0])));`;
  const got = ['Asia/Ho_Chi_Minh', 'America/Los_Angeles', 'UTC'].map((TZ) => execFileSync(process.execPath, ['-e', code], { env: { ...process.env, TZ } }).toString().trim());
  assert.deepEqual(got, ['2026-10-01T23:59:58', '2026-10-01T23:59:58', '2026-10-01T23:59:58']);
});

test('csv: BOM, dấu ; hoặc ,, ngoặc kép (dấu phẩy, xuống dòng, "" thoát), CRLF, ô trống → null, không thêm dòng thừa cuối', async () => {
  assert.deepEqual(parseCsv('﻿a;b;c\r\n1;"x;y";\r\n'), [['a', 'b', 'c'], ['1', 'x;y', null]]);
  assert.deepEqual(parseCsv('a,b\n"he said ""hi""","dòng 1\ndòng 2"\n3,4'), [['a', 'b'], ['he said "hi"', 'dòng 1\ndòng 2'], ['3', '4']]);
  assert.deepEqual(parseCsv(''), []);
  const r = await readWorkbook({ buffer: Buffer.from('Số phiếu,Biển số\n1,92H-00903\n'), fileName: 'x.csv' });
  assert.deepEqual(r.sheets, [{ name: 'Sheet1', rows: 2, cols: 2 }]);
  assert.deepEqual(r.aoa('Sheet1'), [['Số phiếu', 'Biển số'], ['1', '92H-00903']]);
});

test('.xls cũ, file hỏng, không phải xlsx → báo lỗi rõ (ValidationError), không treo', async () => {
  await rejects(readWorkbook({ buffer: Buffer.from('x'), fileName: 'cu.xls' }), /\.xls.*không còn được hỗ trợ/);
  const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(64)]);
  await rejects(readWorkbook({ buffer: ole, fileName: 'doi-ten.xlsx' }), /\.xls/);            // .xls đổi đuôi thành .xlsx
  await rejects(readWorkbook({ buffer: Buffer.from('chỉ là chữ'), fileName: 'a.xlsx' }), /không phải định dạng \.xlsx/);
  await rejects(readWorkbook({ buffer: Buffer.concat([Buffer.from('PK'), Buffer.alloc(40)]), fileName: 'hong.xlsx' }), /Không đọc được file/);
});

test('runtime: yêu cầu đầu tiên đợi nạp dữ liệu ban đầu (Excel đọc bất đồng bộ) xong rồi mới trả lời', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-'));
  const rt = createRuntime({ dataDir: dir, driver: 'node:sqlite', autoInit: true });
  try {
    const r = await rt.dispatch('app.info', {});        // gọi NGAY sau createRuntime
    assert.equal(r.ok, true);
    assert.equal(r.data.counts.phieu, 2035);
    assert.equal(r.data.counts.xe, 220);
    const bad = await rt.dispatch('import.open', { base64: Buffer.from('chữ').toString('base64'), fileName: 'cu.xls' });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /\.xls/);
  } finally { rt.close(); }
});
