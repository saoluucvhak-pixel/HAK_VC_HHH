'use strict';
/** Logic khối lượng: KL ghi nhầm đơn vị tấn/kg, số cân âm, KL ngoài khoảng hợp lý — chặn ở import, sửa trực tiếp, và phát hiện bằng kiểm tra toàn vẹn. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const path = require('path');
const { parseTickets } = require('../src/excel/ticketParser');
const { detectHeader } = require('../src/excel/columnMapping');
const { weightProblem, KL_MIN_KG, KL_MAX_KG } = require('../src/utils/weight');
const { createApp, SEED_DIR } = require('../src/app');
const { loadInitialData } = require('../src/services/InitialDataService');

const H = ['Số phiếu', 'Biển số', 'Nơi xuất', 'Giờ cân 1', 'Giờ cân 2', 'Cân 1', 'Cân 2', 'KL hàng'];
const d = '02/10/2026 10:00', d2 = '02/10/2026 10:30';
const parse1 = (row, head = H) => { const rows = [head, row]; return parseTickets(rows, 0, detectHeader(rows).mapping)[0]; };
const has = (r, re) => r.errors.some((e) => re.test(e));

test('KL quá nhỏ (ghi theo tấn) hoặc quá lớn bị chặn; KL hợp lệ và cột có "(tấn)" vẫn đạt', () => {
  assert.ok(has(parse1(['1', '92H-00903', 'QS', d, null, null, null, '17,5']), /quá nhỏ.*TẤN/));
  assert.ok(has(parse1(['2', '92H-00903', 'QS', d, d2, 30000, 12500, 17.5]), /quá nhỏ/));
  assert.ok(has(parse1(['3', '92H-00903', 'QS', d, null, null, null, 170000]), /vượt 100\.000/));
  assert.deepEqual(parse1(['4', '92H-00903', 'QS', d, d2, 30000, 13000, 17000]).errors, []);
  assert.deepEqual(parse1(['5', '92H-00903', 'QS', d, null, null, null, 17.5], [...H.slice(0, 7), 'KL hàng (tấn)']).errors, []);   // tấn → 17.500 kg
  assert.equal(parse1(['5', '92H-00903', 'QS', d, null, null, null, 17.5], [...H.slice(0, 7), 'KL hàng (tấn)']).kl_hang_kg, 17500);
  assert.equal(weightProblem(KL_MIN_KG), null); assert.equal(weightProblem(KL_MAX_KG), null); assert.ok(weightProblem(KL_MIN_KG - 1)); assert.ok(weightProblem(KL_MAX_KG + 1));
});

test('số cân âm bị chặn ngay ở import', () => {
  assert.ok(has(parse1(['6', '92H-00903', 'QS', d, d2, -30000, -13000, 17000]), /không được âm/));
});

test('sửa trực tiếp: KL quá nhỏ/lớn bị chặn; toàn vẹn phát hiện KL bất thường và số phiếu chỉ khác số 0 đầu', async () => {
  const app = createApp({ dbFile: ':memory:', driver: 'node:sqlite' });
  await loadInitialData(app, SEED_DIR);
  const t = app.db.get(`SELECT id FROM phieu_can WHERE trang_thai='ACTIVE' ORDER BY id LIMIT 1`);
  assert.throws(() => app.tickets.update(t.id, { kl_hang_kg: 17.5 }, 'thử'), /quá nhỏ/);
  assert.throws(() => app.tickets.update(t.id, { kl_hang_kg: 250000 }, 'thử'), /vượt/);
  // mô phỏng dữ liệu cũ đã lọt: KL bất thường + hai cách viết số phiếu
  app.db.run('UPDATE phieu_can SET kl_hang_kg=17.5 WHERE id=?', [t.id]);
  const src = app.db.get('SELECT * FROM phieu_can WHERE id=?', [t.id]);
  const cols = Object.keys(src).filter((k) => !['id', 'kl_hang_tan', 'ngay_can'].includes(k));
  const vals = cols.map((k) => (k === 'so_phieu' ? '0' + src.so_phieu : k === 'business_key' ? src.business_key + '#0' : k === 'strong_key' ? 'sk0' : k === 'fingerprint' ? 'fp0' : src[k]));
  app.db.run(`INSERT INTO phieu_can(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, vals);
  const r = app.integrity.check(); const by = (id) => r.checks.find((c) => c.id === id);
  assert.equal(by('KL_BAT_THUONG').count, 2); assert.equal(by('SO_PHIEU_KHAC_SO_0_DAU').count, 1);
  assert.equal(r.ok, false);
});

test('preview: đối chiếu tổng KL với dòng "Tổng cộng" của file; lệch thì báo; không có dòng tổng thì nói rõ', async () => {
  const { xlsxBuffer } = require('./helpers/xlsx');
  const app = createApp({ dbFile: ':memory:', driver: 'node:sqlite' });
  app.seed.load(JSON.parse(fs.readFileSync(path.join(SEED_DIR, 'sample-v47.json'), 'utf8')));
  app.vehicleImport.commit((await app.vehicleImport.preview({ filePath: path.join(__dirname, 'fixtures', 'sample-v47.xlsx') })).token);
  const plate = app.db.get('SELECT bien_so_chuan b FROM xe LIMIT 1').b;
  const mk = (n, kl) => [String(n), plate, 'Quế Sơn', `0${n}/10/2026 10:00`, `0${n}/10/2026 10:30`, 30000, 30000 - kl, kl];
  const run = async (rows) => {
    const o = await app.imports.open({ buffer: await xlsxBuffer([H, ...rows]), fileName: 't.xlsx' }); const si = app.imports.sheetInfo(o.token, o.suggestedSheet);
    return app.imports.preview(o.token, { sheetName: si.sheetName, headerRow: si.headerRow, mapping: si.mapping, dotId: null }).totals;
  };
  const ok = await run([mk(1, 17000), mk(2, 18000), ['Tổng cộng', null, null, null, null, null, null, 35000]]);
  assert.equal(ok.read_kg, 35000); assert.equal(ok.file_kg, 35000); assert.equal(ok.lech_kg, 0); assert.equal(ok.new_kg, 35000); assert.ok(ok.new_truoc_vat > 0);
  const bad = await run([mk(3, 17000), mk(4, 18000), ['Tổng cộng', null, null, null, null, null, null, 52000]]);   // file ghi tổng 52.000 nhưng chỉ có 2 dòng hợp 35.000 (mất dòng)
  assert.equal(bad.lech_kg, -17000);
  const none = await run([mk(5, 17000)]);
  assert.equal(none.file_kg, null); assert.equal(none.lech_kg, null);
});
