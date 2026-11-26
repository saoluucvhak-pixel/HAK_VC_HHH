'use strict';
/** 0.8.4: tệp Excel bất thường (ô ở góc xa, tệp quá lớn, zip bomb) phải bị từ chối bằng ValidationError, không làm hết bộ nhớ / sập ứng dụng. */
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { readWorkbook } = require('../src/excel/workbookReader');

const rejects = (p, re) => assert.rejects(p, (e) => e.name === 'ValidationError' && re.test(e.message), String(re));

test('xlsx có một ô ở XFD1048576: đọc danh sách sheet được, nhưng lấy dữ liệu bị từ chối rõ ràng (không cấp phát 1.7×10^10 ô)', async () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('S');
  ws.getCell('A1').value = 'Số phiếu'; ws.getCell('XFD1048576').value = 'x';
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const r = await readWorkbook({ buffer: buf, fileName: 'doc-hai.xlsx' });
  assert.equal(r.sheets[0].name, 'S');
  assert.throws(() => r.aoa('S'), (e) => e.name === 'ValidationError' && /quá lớn|bất thường/.test(e.message));
});

test('xlsx bình thường (vài nghìn dòng) vẫn đọc được', async () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('S');
  for (let i = 1; i <= 3000; i++) ws.addRow([`P${i}`, i, 'a']);
  const r = await readWorkbook({ buffer: Buffer.from(await wb.xlsx.writeBuffer()), fileName: 'ok.xlsx' });
  assert.equal(r.aoa('S').length, 3000);
});

test('tệp quá lớn (> 50 MB) bị từ chối trước khi giải nén', async () => {
  const big = Buffer.alloc(51 * 1024 * 1024, 1); big[0] = 0x50; big[1] = 0x4b;
  await rejects(readWorkbook({ buffer: big, fileName: 'lon.xlsx' }), /quá lớn|50 MB/);
});

test('zip bomb: kích thước giải nén khai báo vượt trần bị từ chối', async () => {
  // gói zip tối thiểu có một mục khai báo kích thước giải nén 2 GB
  const name = Buffer.from('xl/a.xml');
  const cd = Buffer.alloc(46 + name.length); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt32LE(2 * 1024 * 1024 * 1024 - 1, 24); cd.writeUInt16LE(name.length, 28); name.copy(cd, 46);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(30, 16);   // thư mục trung tâm bắt đầu sau 4 byte đầu + 26 byte đệm
  const buf = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(26), cd, eocd]);
  await rejects(readWorkbook({ buffer: buf, fileName: 'bomb.xlsx' }), /giải nén|quá lớn/);
});

test('luồng nền đọc V47 giống tiến trình chính và chỉ đọc vùng tiêu đề khi quét sheet', async () => {
  const filePath = require('node:path').join(__dirname, 'fixtures', 'sample-v47.xlsx');
  const [foreground, background] = await Promise.all([readWorkbook({ filePath }), readWorkbook({ filePath, background: true })]);
  assert.deepEqual(background.sheets, foreground.sheets);
  const main = background.sheets.reduce((largest, next) => next.rows > largest.rows ? next : largest);
  assert.deepEqual(background.scan(main.name, 0, 10), foreground.aoa(main.name).slice(0, 10));
  assert.deepEqual(background.aoa(main.name), foreground.aoa(main.name));
});
