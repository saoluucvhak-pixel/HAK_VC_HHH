'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp, SEED_DIR } = require('../src/app');
const { loadInitialData, isFreshDb } = require('../src/services/InitialDataService');
const { parseTickets } = require('../src/excel/ticketParser');
const { matchRows, detectB, parseB } = require('../src/services/ReconciliationService');
const { detectHeader } = require('../src/excel/columnMapping');
const seed = require('../data/seed/sample-v47.json');

test('đối chiếu kiểm tra biển số, ngày, đơn vị và dữ liệu nhập sai', () => {
  const a = [{id:1, so_phieu:'QA-01', bien_so_chuan:'92H00903', ngay_can:'2026-10-05', kl_hang_kg:15000}];
  const verdict = (rows) => {
    const { headerRow, mapping } = detectB(rows);
    return matchRows(a, parseB(rows, headerRow, mapping))[0].ket_qua;
  };
  assert.equal(verdict([['Số phiếu','Biển số','Ngày','KL hàng (kg)'], ['QA-01','43C-01234','06/10/2026',15000]]), 'CAN_KIEM_TRA');
  assert.equal(verdict([['Số phiếu','Biển số','Khối lượng (tấn)'], ['QA-01','92H-00903','15.000']]), 'KHOP');
  assert.equal(verdict([['Số phiếu','Biển số','KL hàng (kg)'], ['QA-01','92H-00903','chưa rõ']]), 'CAN_KIEM_TRA');
});

test('nhập nơi đến theo từng dòng, báo nơi lạ và giữ giá trị mặc định khi trống', async (t) => {
  const app = createApp({ dbFile: ':memory:', driver: 'node:sqlite' });
  t.after(() => app.close());
  app.seed.load(seed);
  const open = async (entries) => {
    const head = 'Số phiếu;Biển số;Ngày cân;KL hàng (kg);Nơi xuất;Nơi đến';
    const lines = entries.map(([code, destination]) => `${code};92H-00903;05/10/2026 08:00;15000;QS;${destination}`);
    const o = await app.imports.open({ buffer: Buffer.from([head, ...lines].join('\n')), fileName: 'synthetic.csv' });
    const si = app.imports.sheetInfo(o.token, o.suggestedSheet);
    return { token: o.token, preview: app.imports.preview(o.token, si) };
  };
  const o = await open([['QA-01','DN'],['QA-02',''],['QA-03','Chưa có trong danh mục']]);
  assert.equal(o.preview.counts.error, 1);
  assert.equal(app.imports.commit(o.token).inserted, 2);
  const destination = (code) => app.db.get('SELECT d.ma FROM phieu_can p JOIN dia_diem d ON p.noi_den_id=d.id WHERE p.so_phieu=?', [code]).ma;
  assert.equal(destination('QA-01'), 'DN');
  assert.equal(destination('QA-02'), 'TIENSA');
  assert.equal((await open([['QA-01','DN']])).preview.counts.exact, 1);
  const changed = await open([['QA-01','TIENSA']]);
  assert.equal(changed.preview.counts.conflict, 1);
  const batch = app.imports.commit(changed.token);
  app.imports.resolveReview(app.imports.pendingReviews()[0].id, 'UPDATE', 'Cập nhật tuyến');
  assert.equal(destination('QA-01'), 'TIENSA');
  app.imports.undoBatch(batch.batchId, 'Hoàn tác cập nhật');
  assert.equal(destination('QA-01'), 'DN');
});

test('Excel đọc tổng trên đầu bảng và chặn ĐVT mâu thuẫn', () => {
  const header = ['Số phiếu','Biển số','Ngày cân','KL hàng (tấn)','ĐVT'];
  const data = [['Tổng khối lượng công bố (kg)',14000], header, ['QA-01','92H-00903','05/10/2026 08:00',15,'tấn']];
  const result = parseTickets(data, 1, detectHeader(data).mapping, { strict:true });
  assert.deepEqual(result.totalRow, {source_row:1,kl_hang_kg:14000});
  data[2][4] = 'kg';
  assert.ok(parseTickets(data, 1, detectHeader(data).mapping, {strict:true})[0].errors.some(e => e.includes('INVALID_UNIT')));
});

test('nạp lần đầu có thể tiếp tục sau lỗi giữa chừng', async (t) => {
  const app = createApp({ dbFile: ':memory:', driver: 'node:sqlite' });
  t.after(() => app.close());
  const parse = app.vehicleImport.preview.bind(app.vehicleImport);
  app.vehicleImport.preview = async () => { throw new Error('Đọc file thất bại'); };
  await assert.rejects(loadInitialData(app, SEED_DIR), /Đọc file thất bại/);
  assert.equal(isFreshDb(app), true);
  app.vehicleImport.preview = parse;
  await loadInitialData(app, SEED_DIR);
  assert.equal(isFreshDb(app), false);
  assert.equal(app.db.get('SELECT COUNT(*) n FROM phieu_can').n, 2035);
});

test('xuất file theo bố cục mẫu và đọc lại các ví dụ bằng đúng cấu hình', async (t) => {
  const ExcelJS = require('exceljs');
  const { configuredTicketTemplate } = require('../src/excel/templates');
  const app = createApp({ dbFile: ':memory:', driver: 'node:sqlite' });
  t.after(() => app.close());
  const template = {
    name: 'Đối tác A', headerRow: 4, headerRows: 2, fallbackUnit: '',
    columns: { so_phieu: 'Mã phiếu', bien_so: 'Biển số', ngay_gio_can_1: 'Ngày cân', kl_hang_kg: 'Khối lượng (tấn)' },
    layout: { sheetName: 'Bảng cân', positions: { so_phieu: 0, bien_so: 2, ngay_gio_can_1: 4, kl_hang_kg: 6 } },
  };
  const { templates } = app.imports.updateTemplate({ action: 'save', template });
  app.imports.updateTemplate({ action: 'default', id: templates[0].id });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await configuredTicketTemplate(templates[0]));
  const data = wb.getWorksheet('Bảng cân');
  const samples = wb.getWorksheet('Minh họa');
  assert.equal(data.getCell('G5').value, 'Khối lượng (tấn)');
  assert.equal(data.getCell('A6').value, null);
  assert.equal(samples.getCell('A3').value, '00001');
  assert.equal(samples.getCell('G3').value, 15);
  for (let i = 0; i < 3; i++) data.getRow(6 + i).values = samples.getRow(3 + i).values;
  const file = await app.imports.open({ fileName: 'round-trip.xlsx', buffer: await wb.xlsx.writeBuffer() });
  assert.equal(file.suggestedSheet, 'Bảng cân');
  const check = app.imports.check(file.token, { sheetName: file.suggestedSheet });
  assert.equal(check.blocking, false);
  assert.equal(check.summary.dong_loi, 0);
  assert.equal(check.readKg, 46500);
  const old = { ...template };
  delete old.layout;
  await wb.xlsx.load(await configuredTicketTemplate(old));
  assert.equal(wb.getWorksheet('Phiếu cân').getCell('D5').value, 'Khối lượng (tấn)');
});
