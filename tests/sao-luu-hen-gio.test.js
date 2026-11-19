'use strict';
/** P2 0.8.2: sao lưu tự động theo giờ khi mở qua đêm, mốc "xuất ra ổ khác", dọn phiên xem trước quá hạn, log PRE_IMPORT không dùng. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { xlsxBuffer } = require('./helpers/xlsx');
const { createRuntime } = require('../src/runtime');
const { loadInitialData } = require('../src/services/InitialDataService');
const { SEED_DIR } = require('../src/app');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const autos = (rt) => fs.readdirSync(rt.dirs.backups).filter((f) => f.endsWith('_AUTO.db')).length;

test('app mở qua đêm: hẹn giờ gọi autoDaily lặp lại (chu kỳ ngắn khi test); rt.close() dừng hẹn giờ', async () => {
  const rt = createRuntime({ dataDir: tmp('vcbk-'), driver: 'node:sqlite', autoBackupMs: 30 });
  await rt.ready;
  let calls = 0; const orig = rt.backup.autoDaily.bind(rt.backup);
  rt.backup.autoDaily = () => { calls++; return orig(); };
  await sleep(200);
  assert.ok(calls >= 3, `hẹn giờ phải gọi autoDaily lặp lại, thực tế ${calls}`);
  rt.close();
  const after = calls; await sleep(150);
  assert.equal(calls, after, 'sau rt.close() không còn gọi autoDaily');
});

test('qua đêm thật: đồng hồ nhảy >1 ngày thì hẹn giờ tạo thêm bản AUTO; lỗi autoDaily được bọc try/catch (không làm sập)', async () => {
  const rt = createRuntime({ dataDir: tmp('vcbk2-'), driver: 'node:sqlite', autoBackupMs: 30 });
  await rt.ready;
  const before = autos(rt); assert.ok(before >= 1);
  const realNow = Date.now; Date.now = () => realNow() + 26 * 3600 * 1000;
  try { await sleep(250); } finally { Date.now = realNow; }
  assert.ok(autos(rt) > before, 'đồng hồ qua đêm phải sinh thêm bản AUTO');
  const orig = rt.backup.autoDaily.bind(rt.backup); rt.backup.autoDaily = () => { throw new Error('lỗi thử'); };
  await sleep(120);                                   // không văng lỗi ra ngoài
  rt.backup.autoDaily = orig; rt.close();
  assert.match(fs.readFileSync(path.join(rt.dirs.logs, fs.readdirSync(rt.dirs.logs)[0]), 'utf8'), /Auto backup lỗi: lỗi thử/);
});

test('backup.export ghi mốc "xuất ra ổ khác gần nhất"; app.info/settings trả mốc; nhắc khi quá hạn (cấu hình được)', async () => {
  const rt = createRuntime({ dataDir: tmp('vcbk3-'), driver: 'node:sqlite' });
  try {
    await rt.ready;
    const ok = async (ch, a) => { const r = await rt.dispatch(ch, a || {}); assert.equal(r.ok, true, ch + ': ' + r.error); return r.data; };
    assert.equal((await ok('settings.all')).backup_export_last || null, null);
    const st0 = await ok('backup.exportStatus');
    assert.equal(st0.last, null); assert.equal(st0.nhac, true); assert.equal(st0.remindDays, 7);
    const b = await ok('backup.now');
    const dest = tmp('vcdest-');
    const out = await ok('backup.export', { file: b.file, dir: dest });
    assert.ok(fs.existsSync(out.path));
    const st1 = await ok('backup.exportStatus');
    assert.ok(st1.last); assert.equal(st1.nhac, false); assert.ok(Math.abs(Date.parse(st1.last) - Date.now()) < 60000);
    // quá 7 ngày (mặc định) → nhắc; đổi ngưỡng 30 ngày → hết nhắc
    const realNow = Date.now; Date.now = () => realNow() + 8 * 24 * 3600 * 1000;
    try {
      assert.equal((await ok('backup.exportStatus')).nhac, true);
      await ok('settings.set', { key: 'backup', value: { remindExportDays: 30 } });
      assert.equal((await ok('backup.exportStatus')).nhac, false);
    } finally { Date.now = realNow; }
    const bad = await rt.dispatch('settings.set', { key: 'backup', value: { remindExportDays: 0 } });
    assert.equal(bad.ok, false); assert.equal(bad.type, 'ValidationError');
    // xuất lỗi (thư mục không tồn tại) không được ghi mốc
    const before = (await ok('backup.exportStatus')).last;
    const fail = await rt.dispatch('backup.export', { file: b.file, dir: path.join(dest, 'khong-co') });
    assert.equal(fail.ok, false); assert.equal((await ok('backup.exportStatus')).last, before);
  } finally { rt.close(); }
});

test('phiên xem trước import quá 2 giờ bị dọn khi mở file mới', async () => {
  const rt = createRuntime({ dataDir: tmp('vcbk4-'), driver: 'node:sqlite' });
  try {
    await rt.ready; await loadInitialData(rt.app, SEED_DIR);
    const open = async () => (await rt.dispatch('import.open', { base64: (await xlsxBuffer([['Số phiếu', 'Biển số'], ['1', 'x']])).toString('base64'), fileName: 'p.xlsx' })).data.token;
    const t1 = await open();
    assert.ok(rt.app.imports.previews.has(t1));
    const realNow = Date.now; Date.now = () => realNow() + 2 * 3600 * 1000 + 5000;
    let t2; try { t2 = await open(); } finally { Date.now = realNow; }
    assert.equal(rt.app.imports.previews.has(t1), false, 'phiên cũ hơn 2 giờ phải bị dọn');
    assert.equal(rt.app.imports.previews.has(t2), true);
    const r = await rt.dispatch('import.sheetInfo', { token: t1, sheetName: 'Sheet1' });
    assert.equal(r.ok, false); assert.match(r.error, /hết hạn|Phiên|không còn/i);
  } finally { rt.close(); }
});

test('commit import lỗi sau khi đã sao lưu PRE_IMPORT: ghi log rõ bản PRE_IMPORT không được dùng; sao lưu lỗi vẫn chặn import', async () => {
  const rt = createRuntime({ dataDir: tmp('vcbk5-'), driver: 'node:sqlite' });
  try {
    await rt.ready; await loadInitialData(rt.app, SEED_DIR);
    const H = ['Số phiếu', 'Biển số', 'Nơi xuất', 'Giờ cân 1', 'Giờ cân 2', 'Cân 1', 'Cân 2', 'KL hàng'];
    const plate = rt.app.db.get('SELECT bien_so_chuan b FROM xe LIMIT 1').b;
    const o = (await rt.dispatch('import.open', { base64: (await xlsxBuffer([H, ['LOG1', plate, 'Quế Sơn', '05/10/2026 08:00:00', '05/10/2026 08:30:00', 30000, 13000, 17000]])).toString('base64'), fileName: 'l.xlsx' })).data;
    const si = (await rt.dispatch('import.sheetInfo', { token: o.token, sheetName: o.suggestedSheet })).data;
    await rt.dispatch('import.preview', { token: o.token, sheetName: si.sheetName, headerRow: si.headerRow, mapping: si.mapping });
    // ép commit lỗi: đổi ngưỡng KL để commit kiểm lại thất bại
    await rt.dispatch('settings.set', { key: 'kl_hop_ly', value: { min_kg: 20000, max_kg: 100000 } });
    const r = await rt.dispatch('import.commit', { token: o.token });
    assert.equal(r.ok, false);
    const logTxt = fs.readdirSync(rt.dirs.logs).map((f) => fs.readFileSync(path.join(rt.dirs.logs, f), 'utf8')).join('\n');
    assert.match(logTxt, /PRE_IMPORT.*không được dùng/i);
    // sao lưu lỗi → chặn import (giữ hành vi cũ)
    const orig = rt.backup.backupNow.bind(rt.backup); rt.backup.backupNow = () => { throw new Error('đầy đĩa'); };
    const o2 = (await rt.dispatch('import.open', { base64: (await xlsxBuffer([H, ['LOG2', plate, 'Quế Sơn', '05/10/2026 09:00:00', '05/10/2026 09:30:00', 30000, 13000, 17000]])).toString('base64'), fileName: 'l2.xlsx' })).data;
    const si2 = (await rt.dispatch('import.sheetInfo', { token: o2.token, sheetName: o2.suggestedSheet })).data;
    await rt.dispatch('settings.set', { key: 'kl_hop_ly', value: { min_kg: 100, max_kg: 100000 } });
    await rt.dispatch('import.preview', { token: o2.token, sheetName: si2.sheetName, headerRow: si2.headerRow, mapping: si2.mapping });
    const r2 = await rt.dispatch('import.commit', { token: o2.token });
    rt.backup.backupNow = orig;
    assert.equal(r2.ok, false); assert.match(r2.error, /đầy đĩa/);
    assert.equal(rt.app.db.get(`SELECT COUNT(*) n FROM phieu_can WHERE so_phieu='LOG2'`).n, 0, 'sao lưu lỗi thì không được ghi phiếu');
  } finally { rt.close(); }
});

test('electron: bộ lọc hộp thoại lưu chọn theo đuôi file (.pdf → PDF, .xlsx → Excel)', () => {
  const { saveFilters } = require('../electron/save-filters');
  assert.deepEqual(saveFilters('BangKe_2026.pdf'), [{ name: 'PDF', extensions: ['pdf'] }]);
  assert.deepEqual(saveFilters('BangKe.XLSX'), [{ name: 'Excel', extensions: ['xlsx'] }]);
  assert.deepEqual(saveFilters('app_2026_MANUAL.db')[0].extensions, ['db']);
  assert.deepEqual(saveFilters('khong-duoi'), [{ name: 'Tất cả tệp', extensions: ['*'] }]);
  assert.deepEqual(saveFilters(undefined), [{ name: 'Tất cả tệp', extensions: ['*'] }]);
  const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  assert.match(src, /filters: saveFilters\(fileName\)/); assert.doesNotMatch(src, /filters: \[\{ name: 'Excel'/);
});
