'use strict';
/** Hồi quy từ báo cáo rà soát: hoàn tác không ghi đè, chống trùng alias lúc commit, khóa kỳ/đợt, xử lý hàng loạt có kết quả từng ID. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const path = require('path');
const { xlsxBuffer } = require('./helpers/xlsx');
const { createApp, SEED_DIR } = require('../src/app');

const SAMPLE = path.join(__dirname, 'fixtures', 'sample-v47.xlsx');
const H = ['Số phiếu', 'Biển số', 'Nơi xuất', 'Giờ cân 1', 'Giờ cân 2', 'Cân 1', 'Cân 2', 'KL hàng'];
async function mk() {
  const app = createApp({ dbFile: ':memory:', driver: 'node:sqlite' });
  app.seed.load(JSON.parse(fs.readFileSync(path.join(SEED_DIR, 'sample-v47.json'), 'utf8')));
  app.vehicleImport.commit((await app.vehicleImport.preview({ filePath: SAMPLE })).token);
  app.plate = app.db.get('SELECT bien_so_chuan b FROM xe LIMIT 1').b;
  app.dot = app.db.get('SELECT id FROM dot_van_chuyen LIMIT 1').id;
  return app;
}
const row = (app, sp, d = '02', kl = 17000, nx = 'Quế Sơn') => [sp, app.plate, nx, `${d}/10/2026 10:00`, `${d}/10/2026 10:30`, 30000, 30000 - kl, kl];
async function open(app, rows) {
  const o = await app.imports.open({ buffer: await xlsxBuffer([H, ...rows]), fileName: 'f.xlsx' });
  const si = app.imports.sheetInfo(o.token, o.suggestedSheet);
  const pv = app.imports.preview(o.token, { sheetName: si.sheetName, headerRow: si.headerRow, mapping: si.mapping, dotId: app.dot });
  return { token: o.token, pv, commit: () => app.imports.commit(o.token, {}) };
}
const idOf = (app, sp) => app.db.get(`SELECT id FROM phieu_can WHERE so_phieu=? AND trang_thai='ACTIVE'`, [sp]).id;
const kl = (app, id) => app.db.get('SELECT kl_hang_kg, can_lan_2 FROM phieu_can WHERE id=?', [id]);

test('hoàn tác import khôi phục đúng trạng thái ngay trước lần cập nhật; phiếu đã sửa tay sau đó thì chặn (không ghi đè)', async () => {
  const app = await mk();
  (await open(app, [row(app, '7002')])).commit();
  const id = idOf(app, '7002');
  const b2 = (await open(app, [row(app, '7002', '02', 16000)])).commit();
  assert.equal(b2.conflict, 1);
  app.tickets.update(id, { kl_hang_kg: 17500, can_lan_2: 12500 }, 'sửa tay trước khi duyệt');
  app.imports.resolveReview(app.imports.pendingReviews().find((x) => x.phieu_can_id === id).id, 'UPDATE', 'theo file');
  assert.equal(kl(app, id).kl_hang_kg, 16000);
  // chưa sửa gì thêm → hoàn tác về đúng giá trị ngay trước khi cập nhật (17.500, không phải 17.000 lúc vào hàng chờ)
  app.imports.undoBatch(b2.batchId, 'hoàn tác');
  assert.deepEqual(kl(app, id), { kl_hang_kg: 17500, can_lan_2: 12500 });
  // kịch bản chặn: cập nhật lại bằng một batch mới, rồi sửa tay, rồi hoàn tác → bị chặn
  const b3 = (await open(app, [row(app, '7002', '02', 15000)])).commit();
  app.imports.resolveReview(app.imports.pendingReviews().find((x) => x.phieu_can_id === id).id, 'UPDATE', 'lần 2');
  app.tickets.update(id, { kl_hang_kg: 15500, can_lan_2: 14500 }, 'sửa tay sau cập nhật');
  assert.throws(() => app.imports.undoBatch(b3.batchId, 'x'), /đã được sửa sau lần cập nhật/);
  assert.deepEqual(kl(app, id), { kl_hang_kg: 15500, can_lan_2: 14500 });
  assert.equal(app.db.get('SELECT trang_thai FROM import_batch WHERE id=?', [b3.batchId]).trang_thai, 'COMMITTED');
});

test('hai preview cùng phiếu với hai tên gọi nơi xuất (Quế Sơn / QS): commit thứ hai bị chặn, chỉ 1 phiếu ACTIVE', async () => {
  const app = await mk();
  const p1 = await open(app, [row(app, '7005', '02', 17000, 'Quế Sơn')]);
  const p2 = await open(app, [row(app, '7005', '02', 17000, 'QS')]);
  p1.commit();
  assert.throws(() => p2.commit(), /đã có.*preview lại/);
  assert.equal(app.db.get(`SELECT COUNT(*) n FROM phieu_can WHERE so_phieu='7005' AND trang_thai='ACTIVE'`).n, 1);
});

test('đổi ngày phiếu sang kỳ đã chốt bị chặn; đổi sang ngày kỳ mở vẫn được', async () => {
  const app = await mk();
  (await open(app, [row(app, '8001', '02'), row(app, '8010', '20')])).commit();
  app.lock.lock({ loai: 'KY', tu_ngay: '2026-10-01', den_ngay: '2026-10-05' });
  const id = idOf(app, '8010');
  assert.throws(() => app.tickets.update(id, { ngay_gio_can_1: '2026-10-02T10:00:00', ngay_gio_can_2: '2026-10-02T10:30:00' }, 'đổi ngày'), /kỳ đã chốt/);
  assert.equal(app.db.get('SELECT ngay_gio_can_1 d FROM phieu_can WHERE id=?', [id]).d.slice(0, 10), '2026-10-20');
  app.tickets.update(id, { ngay_gio_can_1: '2026-10-21T10:00:00', ngay_gio_can_2: '2026-10-21T10:30:00' }, 'đổi sang kỳ mở');
});

test('duyệt "Cập nhật theo file mới": chặn phiếu thuộc đợt đã khóa, cho phép lại khi mở khóa', async () => {
  const app = await mk();
  (await open(app, [row(app, '7003', '20')])).commit();
  const id = idOf(app, '7003');
  (await open(app, [row(app, '7003', '20', 16000)])).commit();
  const pend = () => app.imports.pendingReviews().find((x) => x.phieu_can_id === id);
  app.db.run(`UPDATE dot_van_chuyen SET trang_thai='KHOA' WHERE id=?`, [app.dot]);
  assert.throws(() => app.imports.resolveReview(pend().id, 'UPDATE', 'x'), /đợt đã khóa/);
  assert.equal(kl(app, id).kl_hang_kg, 17000);
  app.db.run(`UPDATE dot_van_chuyen SET trang_thai='MO' WHERE id=?`, [app.dot]);
  app.imports.resolveReview(pend().id, 'UPDATE', 'ok'); assert.equal(kl(app, id).kl_hang_kg, 16000);
});

test('xử lý hàng loạt: kết quả từng ID, không dừng ở lỗi đầu, từ chối dòng của lô khác, lô gồm phiếu mở/chốt/xóa', async () => {
  const app = await mk();
  (await open(app, [row(app, '9001', '02'), row(app, '9002', '20'), row(app, '9003', '21')])).commit();
  app.lock.lock({ loai: 'KY', tu_ngay: '2026-10-01', den_ngay: '2026-10-05' });                 // 9001 đã chốt
  const other = (await open(app, [row(app, '9004', '22')])); other.commit();
  const b = (await open(app, [row(app, '9001', '02', 16000), row(app, '9002', '20', 16000), row(app, '9003', '21', 16000)])).commit();
  const b9004 = (await open(app, [row(app, '9004', '22', 16000)])).commit();
  app.tickets.remove([idOf(app, '9003')], 'xóa');                                                // 9003 đã VOID sau khi vào hàng chờ
  const rowsOf = (bid) => app.imports.pendingReviews().filter((x) => x.batch_id === bid).map((x) => x.id);
  const mine = rowsOf(b.batchId); assert.equal(mine.length, 3);
  const foreign = rowsOf(b9004.batchId)[0];
  const res = app.imports.resolveMany([...mine, foreign], 'UPDATE', 'lý do', { batchId: b.batchId });
  assert.equal(res.total, 4); assert.equal(res.ok, 1); assert.equal(res.failed, 3);
  const by = Object.fromEntries(res.results.map((x) => [x.so_phieu, x]));
  assert.equal(by['9002'].ok, true); assert.match(by['9001'].reason, /đã chốt/); assert.match(by['9003'].reason, /không còn hiệu lực/);
  assert.match(res.results.find((x) => x.id === foreign).reason, /không thuộc lô/);
  assert.equal(kl(app, idOf(app, '9002')).kl_hang_kg, 16000);
  assert.equal(kl(app, idOf(app, '9004')).kl_hang_kg, 17000, 'phiếu của lô khác không bị đụng');
  assert.throws(() => app.imports.resolveMany(mine, 'UPDATE', ''), /lý do/);
  // chạy lại: dòng đã xử lý báo "không còn chờ", không xử lý trùng
  const again = app.imports.resolveMany(mine, 'KEEP_OLD', null, { batchId: b.batchId });
  assert.equal(again.results.find((x) => x.so_phieu === '9002').ok, false);
  assert.equal(app.db.get(`SELECT COUNT(*) n FROM audit_log WHERE action='UPDATE_TICKET_FROM_IMPORT'`).n, 1);
});

test('lỗi chép file nguồn sau khi commit: batch vẫn ghi, kết quả có cảnh báo (không ném lỗi); thử lại không nhập đôi', async () => {
  const os = require('os');
  const { createRuntime } = require('../src/runtime');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcim-'));
  const rt = createRuntime({ dataDir: dir, driver: 'node:sqlite' });
  try {
    const app = rt.app; app.seed.load(JSON.parse(fs.readFileSync(path.join(SEED_DIR, 'sample-v47.json'), 'utf8')));
    app.vehicleImport.commit((await app.vehicleImport.preview({ filePath: SAMPLE })).token);
    app.plate = app.db.get('SELECT bien_so_chuan b FROM xe LIMIT 1').b; app.dot = app.db.get('SELECT id FROM dot_van_chuyen LIMIT 1').id;
    fs.rmSync(rt.dirs.imports, { recursive: true }); fs.writeFileSync(rt.dirs.imports, 'chặn');   // mô phỏng lỗi ghi
    const buffer = (await xlsxBuffer([H, row(app, '6001')])).toString('base64');
    const run = async () => {
      const o = (await rt.dispatch('import.open', { base64: buffer, fileName: 'f.xlsx' })).data;
      const si = (await rt.dispatch('import.sheetInfo', { token: o.token, sheetName: o.suggestedSheet })).data;
      await rt.dispatch('import.preview', { token: o.token, sheetName: si.sheetName, headerRow: si.headerRow, mapping: si.mapping, dotId: app.dot });
      return rt.dispatch('import.commit', { token: o.token });
    };
    const r = await run();
    assert.equal(r.ok, true); assert.equal(r.data.inserted, 1); assert.equal(r.data.savedCopy, null); assert.match(r.data.copyWarning, /không lưu được bản sao/);
    const again = await run(); assert.equal(again.data.inserted, 0); assert.equal(again.data.duplicate, 1);
    assert.equal(app.db.get(`SELECT COUNT(*) n FROM phieu_can WHERE so_phieu='6001'`).n, 1);
  } finally { rt.close(); }
});
