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

test('dòng Tổng cộng: công thức chưa có giá trị, nhiều khối dữ liệu (dòng dưới Tổng cộng không bị bỏ qua âm thầm), cột tấn', async () => {
  const ExcelJS = require('exceljs');
  const app = createApp({ dbFile: ':memory:', driver: 'node:sqlite' });
  app.seed.load(JSON.parse(fs.readFileSync(path.join(SEED_DIR, 'sample-v47.json'), 'utf8')));
  app.vehicleImport.commit((await app.vehicleImport.preview({ filePath: path.join(__dirname, 'fixtures', 'sample-v47.xlsx') })).token);
  const plate = app.db.get('SELECT bien_so_chuan b FROM xe LIMIT 1').b;
  const mk = (ws, n, kl) => ws.addRow([String(n), plate, 'Quế Sơn', `0${n}/10/2026 10:00`, `0${n}/10/2026 10:30`, 30000, 30000 - kl, kl]);
  const open = async (build, head = H) => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('S'); ws.addRow(head); build(ws);
    const o = await app.imports.open({ buffer: Buffer.from(await wb.xlsx.writeBuffer()), fileName: 'b.xlsx' }); const si = app.imports.sheetInfo(o.token, o.suggestedSheet);
    const args = { sheetName: si.sheetName, headerRow: si.headerRow, mapping: si.mapping };
    return { chk: app.imports.check(o.token, args), totals: app.imports.preview(o.token, { ...args, dotId: null }).totals };
  };
  // 1) tổng là công thức không có giá trị lưu sẵn → nêu rõ là không đối chiếu được (không phải "không có dòng tổng")
  const f = await open((ws) => { mk(ws, 1, 17000); mk(ws, 2, 18000); ws.addRow(['Tổng cộng', null, null, null, null, null, null, { formula: 'SUM(H2:H3)' }]); });
  assert.equal(f.totals.file_kg, null); assert.ok(f.totals.file_total_row); assert.equal(f.totals.read_kg, 35000);
  // 2) hai khối: dữ liệu dưới dòng Tổng cộng đầu tiên không được đọc → phải cảnh báo rõ, không im lặng
  const two = await open((ws) => { mk(ws, 1, 17000); ws.addRow(['Tổng cộng', null, null, null, null, null, null, 17000]); mk(ws, 3, 18000); mk(ws, 4, 19000); ws.addRow(['Tổng cộng', null, null, null, null, null, null, 37000]); });
  assert.equal(two.totals.so_dong, 1); assert.equal(two.totals.ignored_below_total, 2); assert.equal(two.totals.ignored_first_row, 4);
  assert.ok(two.chk.problems.some((p) => p.level === 'warning' && /DƯỚI dòng "Tổng cộng"/.test(p.text)));
  // 3) bảng tóm tắt dưới dòng tổng (như V.47) không bị tính là phiếu bị bỏ sót
  const sum = await open((ws) => { mk(ws, 1, 17000); ws.addRow(['Tổng cộng', null, null, null, null, null, null, 17000]); ws.addRow([null, null, 'Xe xuống Cảng', null, 'Xe trả về']); ws.addRow(['Nơi xuất', null, 'Số lượng xe', 'Khối lượng']); });
  assert.equal(sum.totals.ignored_below_total, 0);
  // 4) cột tấn: tổng tính bằng tấn cũng được quy đổi để so với tổng kg đọc được
  const ton = await open((ws) => { ws.addRow(['1', plate, 'Quế Sơn', '01/10/2026 10:00', '01/10/2026 10:30', null, null, 17.5]); ws.addRow(['Tổng cộng', null, null, null, null, null, null, 17.5]); }, [...H.slice(0, 7), 'KL hàng (tấn)']);
  assert.equal(ton.totals.read_kg, 17500); assert.equal(ton.totals.file_kg, 17500); assert.equal(ton.totals.lech_kg, 0);
});

test('ngưỡng KL cấu hình được (Cài đặt kl_hop_ly) áp dụng thống nhất: import, sửa trực tiếp, kiểm tra toàn vẹn; giá trị sai bị từ chối; mặc định không đổi', async () => {
  const { limitsFrom } = require('../src/utils/weight');
  const app = createApp({ dbFile: ':memory:', driver: 'node:sqlite' });
  await loadInitialData(app, SEED_DIR);
  assert.deepEqual(limitsFrom(app.settings), { min_kg: 100, max_kg: 100000 });
  assert.throws(() => app.settings.set('kl_hop_ly', { min_kg: 500, max_kg: 100 }), /nhỏ hơn/);
  assert.throws(() => app.settings.set('kl_hop_ly', { min_kg: 'a', max_kg: 100 }), /Ngưỡng KL/);
  const t = app.db.get(`SELECT id, kl_hang_kg FROM phieu_can WHERE trang_thai='ACTIVE' ORDER BY id LIMIT 1`);
  assert.throws(() => app.tickets.update(t.id, { kl_hang_kg: 60 }, 'thử'), /quá nhỏ/);                 // mặc định: 60 kg < 100
  app.settings.set('kl_hop_ly', { min_kg: 50, max_kg: 100000 });                                        // chủ nghiệp vụ hạ ngưỡng
  app.tickets.update(t.id, { kl_hang_kg: 60, can_lan_2: null, can_lan_1: null }, 'chuyến nhỏ hợp lệ');
  assert.equal(app.db.get('SELECT kl_hang_kg k FROM phieu_can WHERE id=?', [t.id]).k, 60);
  assert.equal(app.integrity.check().checks.find((c) => c.id === 'KL_BAT_THUONG').count, 0, 'toàn vẹn dùng cùng ngưỡng');
  app.settings.set('kl_hop_ly', { min_kg: 100, max_kg: 100000 });
  assert.equal(app.integrity.check().checks.find((c) => c.id === 'KL_BAT_THUONG').count, 1);
  const mk = parse1(['9', '92H-00903', 'QS', '02/10/2026 10:00', null, null, null, 75]);               // parser mặc định
  assert.ok(mk.errors.some((e) => /quá nhỏ/.test(e)));
  const rows = [H, ['9', '92H-00903', 'QS', '02/10/2026 10:00', null, null, null, 75]];
  const lenient = parseTickets(rows, 0, detectHeader(rows).mapping, { weightLimits: { min_kg: 50, max_kg: 100000 } })[0];
  assert.deepEqual(lenient.errors, []);
});

test('đọc nhiều khối (tùy chọn): mỗi dòng Tổng cộng là ngăn cách, đọc cả các khối sau, bỏ bảng tóm tắt; tổng đối chiếu = tổng các dòng Tổng cộng; mặc định vẫn dừng và cảnh báo', async () => {
  const ExcelJS = require('exceljs');
  const app = createApp({ dbFile: ':memory:', driver: 'node:sqlite' });
  app.seed.load(JSON.parse(fs.readFileSync(path.join(SEED_DIR, 'sample-v47.json'), 'utf8')));
  app.vehicleImport.commit((await app.vehicleImport.preview({ filePath: path.join(__dirname, 'fixtures', 'sample-v47.xlsx') })).token);
  const plate = app.db.get('SELECT bien_so_chuan b FROM xe LIMIT 1').b;
  const mk = (ws, n, kl) => ws.addRow([String(n), plate, 'Quế Sơn', `0${n}/10/2026 10:00`, `0${n}/10/2026 10:30`, 30000, 30000 - kl, kl]);
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('S'); ws.addRow(H);
  mk(ws, 1, 17000); mk(ws, 2, 18000); ws.addRow(['Tổng cộng', null, null, null, null, null, null, 35000]);
  mk(ws, 3, 19000); ws.addRow(['Tổng cộng', null, null, null, null, null, null, 19000]);
  ws.addRow([null, null, 'Xe xuống Cảng', null, 'Xe trả về']); ws.addRow(['Nơi xuất', null, 'Số lượng xe', 'Khối lượng']);       // bảng tóm tắt cuối file
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const go = async (readAfterTotal) => {
    const o = await app.imports.open({ buffer, fileName: 'm.xlsx' }); const si = app.imports.sheetInfo(o.token, o.suggestedSheet);
    const args = { sheetName: si.sheetName, headerRow: si.headerRow, mapping: si.mapping, readAfterTotal };
    return { chk: app.imports.check(o.token, args), totals: app.imports.preview(o.token, { ...args, dotId: null }).totals };
  };
  const def = await go(false);
  assert.equal(def.totals.so_dong, 2); assert.equal(def.totals.ignored_below_total, 1);
  const all = await go(true);
  assert.equal(all.totals.so_dong, 3); assert.equal(all.totals.read_kg, 54000); assert.equal(all.totals.file_kg, 54000); assert.equal(all.totals.lech_kg, 0); assert.equal(all.totals.ignored_below_total, 0);
  assert.ok(!all.chk.problems.some((p) => /DƯỚI dòng/.test(p.text)));
});
