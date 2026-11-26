'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { createApp } = require('../src/app');

const columns = {
  so_phieu: 'Mã phiếu', bien_so: 'Biển số', ngay_gio_can_1: 'Ngày cân',
  kl_hang_kg: 'Khối lượng hàng', weight_unit: 'ĐVT', noi_xuat: 'Kho', ghi_chu: 'Ghi chú',
};
const template = { name: 'Nhà cung cấp A', headerRow: 2, headerRows: 2, columns, fallbackUnit: '' };
const fields = Object.keys(columns);
const rows = [
  { so_phieu: 7, bien_so: '92H-00903', ngay_gio_can_1: '05/10/2026 08:00', kl_hang_kg: 12.5, weight_unit: 'TẤN', noi_xuat: 'Kho QS', ghi_chu: 'Lô thử' },
  { so_phieu: '00008', bien_so: '92H-00903', ngay_gio_can_1: '05/10/2026 09:00', kl_hang_kg: 15000, weight_unit: 'kgs', noi_xuat: 'Kho QS' },
];
async function workbook({ order = fields, change = {}, includeTotal = true } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Bìa').addRow(['Mẫu tổng hợp']);
  const sheet = wb.addWorksheet('Phiếu cân');
  sheet.addRow(['Bảng cân tháng 10']);
  const parts = { kl_hang_kg: ['Khối lượng', 'hàng'], ngay_gio_can_1: ['Ngày', 'cân'] };
  sheet.addRow(order.map((key) => change[key] || parts[key]?.[0] || columns[key]));
  sheet.addRow(order.map((key) => change[key] ? null : parts[key]?.[1] ?? null));
  rows.forEach((row, i) => sheet.addRow(order.map((key) => i === 1 && key === 'weight_unit' && change.unit ? change.unit : row[key])));
  if (order.includes('so_phieu')) sheet.getRow(4).getCell(order.indexOf('so_phieu') + 1).numFmt = '00000';
  if (includeTotal) sheet.addRow(order.map((key) => ({ so_phieu: 'Tổng cộng', kl_hang_kg: 27000, weight_unit: 'kg' })[key]));
  sheet.addRow(order.map((key) => key === 'ngay_gio_can_1' ? 'Ngày 05 tháng 10 năm 2026' : null));
  return { fileName: 'synthetic.xlsx', buffer: Buffer.from(await wb.xlsx.writeBuffer()) };
}
function saveDefault(app, value = template) {
  const config = app.imports.updateTemplate({ action: 'save', template: value });
  const id = config.templates.at(-1).id;
  app.imports.updateTemplate({ action: 'default', id });
  return id;
}

test('mẫu hai dòng ghép theo tên với cột đổi vị trí, đổi đơn vị, mã có số 0 và đối chiếu tổng', async () => {
  const app = createApp({ dbFile: ':memory:', driver: 'node:sqlite' });
  const id = saveDefault(app);
  const opened = await app.imports.open(await workbook({ order: [...fields].reverse() }));
  assert.equal(opened.suggestedSheet, 'Phiếu cân');
  assert.equal(opened.defaultId, id);
  const args = { sheetName: opened.suggestedSheet };
  const info = app.imports.sheetInfo(opened.token, opened.suggestedSheet);
  assert.equal(info.mapping.so_phieu, 6);
  assert.equal(info.headerRow, 2);
  const check = app.imports.check(opened.token, args);
  assert.equal(check.blocking, false);
  assert.deepEqual(check.sample.map((r) => [r.source_row, r.so_phieu, r.kl_hang_kg]), [[4, '00007', 12500], [5, '00008', 15000]]);
  assert.equal(check.deltaKg, 500);
  assert.equal(check.totalRow, 6);
  assert.equal(app.imports.preview(opened.token, args).counts.new, 2);
  app.imports.commit(opened.token);
  assert.equal(app.db.get('SELECT ghi_chu FROM phieu_can WHERE so_phieu=?', ['00007']).ghi_chu, 'Lô thử');
  app.db.close();
});

test('thiếu, trùng tiêu đề hoặc đơn vị lạ chặn lần đọc mới và giữ lần xem trước hợp lệ', async () => {
  const app = createApp({ dbFile: ':memory:', driver: 'node:sqlite' });
  saveDefault(app);
  for (const [change, expected] of [[{ noi_xuat: 'Nơi tập kết' }, /Thiếu tiêu đề “Kho”/], [{ ghi_chu: 'Kho' }, /Tiêu đề “Kho” bị trùng/], [{ unit: 'lb' }, /Dòng Excel 5/]]) {
    const file = await app.imports.open(await workbook({ change }));
    const check = app.imports.check(file.token, { sheetName: file.suggestedSheet });
    assert.ok(check.blocking);
    assert.ok(check.problems.some((item) => expected.test(item.text)));
    assert.throws(() => app.imports.preview(file.token, { sheetName: file.suggestedSheet }), expected);
  }
  const o = await app.imports.open(await workbook());
  const args = { sheetName: o.suggestedSheet };
  const preview = app.imports.preview(o.token, args);
  assert.throws(() => app.imports.preview(o.token, { sheetName: 'Bìa' }), /tiêu đề/i);
  assert.equal(app.imports.previewRows(o.token).rows.length, preview.counts.new);
  assert.equal(app.db.get('SELECT COUNT(*) n FROM import_batch').n, 0);
  app.db.close();
});

test('mẫu cân lần 1/2 có đơn vị dự phòng, bỏ qua ngày ký và tạo mã ổn định khi thiếu cột số phiếu', async () => {
  const app = createApp({ dbFile: ':memory:', driver: 'node:sqlite' });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Cân');
  ws.addRows([['Xe', 'Ngày cân', 'Cân lần 1', 'Cân lần 2'], ['92H-00903', '05/10/2026 08:00', '30.500', '18,000'], [null, '05/10/2026']]);
  const file = { fileName: 'can.xlsx', buffer: Buffer.from(await wb.xlsx.writeBuffer()) };
  const options = { sheetName: 'Cân', draft: { name: 'Hai lượt', headerRow: 0, headerRows: 1,
    columns: { bien_so: 'Xe', ngay_gio_can_1: 'Ngày cân', can_lan_1: 'Cân lần 1', can_lan_2: 'Cân lần 2' }, fallbackUnit: '' } };
  const sample = await app.imports.open({ ...file, sample: true });
  assert.match(app.imports.check(sample.token, options).problems[0].text, /Dòng Excel 2/);
  options.draft.fallbackUnit = 't';
  const checked = app.imports.check(sample.token, options);
  assert.equal(checked.readKg, 12500);
  assert.equal(checked.summary.tong_dong, 1);
  assert.match(checked.sample[0].so_phieu, /^AUTO-/);
  assert.throws(() => app.imports.preview(sample.token, options), /File mẫu/);
  saveDefault(app, options.draft);
  const o = await app.imports.open(file);
  app.imports.preview(o.token, { sheetName: 'Cân' });
  const { inserted } = app.imports.commit(o.token);
  assert.equal(inserted, 1);
  const reimport = await app.imports.open(file);
  assert.equal(app.imports.preview(reimport.token, { sheetName: 'Cân' }).counts.exact, 1);
  app.db.close();
});

test('tải lại từ SQLite, sửa/sao chép/xóa mẫu; đọc lại lô với cấu hình đã lưu', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hak-excel-'));
  let app;
  t.after(() => {
    app?.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const dbFile = path.join(dir, 'app.db');
  const create = () => createApp({ dbFile, driver: 'node:sqlite' });
  app = create();
  const id = saveDefault(app);
  const source = await workbook({ includeTotal: false });
  const o = await app.imports.open(source);
  app.imports.preview(o.token, { sheetName: o.suggestedSheet });
  const { batchId } = app.imports.commit(o.token);
  app.db.close();
  app = null;

  app = create();
  assert.equal(app.imports.templates().defaultId, id);
  const config = app.imports.updateTemplate({ action: 'save', template: { ...template, name: 'Bản sao A' } });
  app.imports.updateTemplate({ action: 'save', id, template: { ...template, name: 'Đổi tên A' } });
  app.imports.updateTemplate({ action: 'default', id: config.templates[1].id });
  app.imports.updateTemplate({ action: 'delete', id });
  const { readConfig } = app.imports.batchConfig(batchId);
  assert.equal(readConfig.name, template.name);
  const reread = await app.imports.readBatch(batchId, source);
  assert.equal(reread.readKg, 27500);
  assert.equal(reread.summary.tong_dong, 2);
  await assert.rejects(() => app.imports.readBatch(batchId, { buffer: Buffer.from('a,b'), fileName: 'other.csv' }), /khác file nguồn/);
  assert.equal(app.imports.updateTemplate({ action: 'delete', id: config.templates[1].id }).defaultId, null);
});

test('tiêu đề gộp ngang gợi ý cả hai cột cân và nhận kg/tấn từ tên cột', async () => {
  const app = createApp({ dbFile: ':memory:', driver: 'node:sqlite' });
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Cân');
  sheet.addRows([
    ['Xe', 'Ngày cân', 'Cân'], [null, null, 'lần 1 (tấn)', 'lần 2 (kg)'],
    ['92H-00903', '05/10/2026 08:00', 30.5, 18000],
  ]);
  sheet.mergeCells('C1:D1');
  const file = { fileName: 'merged.xlsx', buffer: Buffer.from(await book.xlsx.writeBuffer()) };
  const o = await app.imports.open({ ...file, sample: true });
  const { mapping, headers } = app.imports.sheetInfo(o.token, 'Cân', 1, { headerRows: 2 });
  assert.equal(headers[3].text, 'Cân lần 2 (kg)');
  assert.equal(mapping.can_lan_2, 3);
  const columns = Object.fromEntries(Object.entries(mapping).map(([key, index]) => [key, headers[index].text]));
  const result = app.imports.check(o.token, { sheetName: 'Cân', draft: { name: 'Cân gộp', columns, headerRow: 1, headerRows: 2, fallbackUnit: '' } });
  assert.equal(result.blocking, false);
  assert.equal(result.readKg, 12500);
  app.db.close();
});
