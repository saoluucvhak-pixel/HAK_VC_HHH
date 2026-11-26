'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { createApp } = require('../src/app');
const { ticketTemplate, vehicleTemplate, partnerTemplate, fuelTemplate } = require('../src/excel/templates');

async function fill(generate, name, values, { formula, options = {} } = {}) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await generate({ rows: 525, ...options }));
  const sheet = book.getWorksheet(1);
  assert.ok(sheet.sheetProtection.sheet);
  assert.notEqual(sheet.getCell('B5').protection?.locked, false);
  assert.equal(sheet.getCell('B530').protection.locked, false);
  assert.notEqual(sheet.getCell('B531').protection?.locked, false);
  if (formula) {
    assert.notEqual(sheet.getCell(formula).protection?.locked, false);
    assert.ok(sheet.getCell(formula).value.formula);
  }
  for (const [col, value] of Object.entries(values)) sheet.getCell(col + '530').value = value;
  return { fileName: name, buffer: Buffer.from(await book.xlsx.writeBuffer()) };
}

test('tải bốn mẫu chuẩn, điền dòng 525 và nhập lại qua các chức năng tương ứng', async (t) => {
  const app = createApp();
  t.after(() => app.close());
  app.catalog.create('don_vi_van_chuyen', { ma: 'HAK', ten: 'Đơn vị mẫu' });
  const date = new Date('2026-10-05T08:00:00Z');
  const assigned = await app.vehicleImport.preview(await fill(vehicleTemplate, 'xe.xlsx',
    { B: '92H-00903', C: 'HAK', D: date }, { options: { carriers: ['HAK'] } }));
  assert.equal(assigned.counts.NEW, 1);
  app.vehicleImport.commit(assigned.token);
  assert.equal(app.db.get('SELECT bien_so_chuan FROM xe').bien_so_chuan, '92H00903');

  const ticket = await app.imports.open(await fill(ticketTemplate, 'can.xlsx',
    { B: '00007', C: date, E: '92H-00903', F: 30000, G: 15000, I: 'Kho mẫu' }, { formula: 'H530' }));
  const info = app.imports.sheetInfo(ticket.token, ticket.suggestedSheet);
  assert.equal(app.imports.preview(ticket.token, info).counts.new, 1);
  assert.equal(app.imports.commit(ticket.token).inserted, 1);
  assert.deepEqual({ ...app.db.get('SELECT so_phieu, kl_hang_kg FROM phieu_can WHERE so_phieu=?', ['00007']) },
    { so_phieu: '00007', kl_hang_kg: 15000 });

  const partner = await app.recon.open(await fill(partnerTemplate, 'doi-tac.xlsx',
    { B: '00007', C: '92H-00903', D: date, E: 15000, F: 150000 }, { formula: 'G530' }));
  const reconInfo = app.recon.sheetInfo(partner.token, partner.suggestedSheet);
  assert.equal(app.recon.run(partner.token, { ten: 'Đối tác gửi lại', ...reconInfo }).soB, 1);
  assert.equal(app.db.get('SELECT so_phieu FROM doi_chieu_dong_b').so_phieu, '00007');

  const fuel = await app.fuelImport.preview(await fill(fuelTemplate, 'dau.xlsx', { B: date, C: 20500 }));
  assert.equal(fuel.rows[0].loai_dau, 'DO 0,05S-II');
  assert.equal(app.fuelImport.commit(fuel.token).created, 1);
  const period = app.price.createFuelPeriod({ ma_ky: 'THANG10', tu_ngay_tham_chieu: '2026-10-05',
    den_ngay_tham_chieu: '2026-10-05', ngay_ap_dung: '2026-10-06' });
  assert.equal(app.price.previewFuelPeriod(period).ky.gia_dau_binh_quan, 20500);
  await assert.rejects(() => ticketTemplate({ rows: 5001 }), /1 đến 5000/);
});
