'use strict';
/** Kiểm tra toàn vẹn: dữ liệu chuẩn V.47 sạch; phát hiện phiếu trùng danh tính, mồ côi, lệch số; chỉ đọc (không sửa gì). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { createApp, SEED_DIR } = require('../src/app');
const { loadInitialData } = require('../src/services/InitialDataService');

const byId = (r, id) => r.checks.find((c) => c.id === id);

test('V.47 chuẩn: không có lỗi toàn vẹn nào', async () => {
  const app = createApp({ dbFile: ':memory:', driver: 'node:sqlite' });
  await loadInitialData(app, SEED_DIR);
  app.lock.lock({ loai: 'KY', tu_ngay: '2026-09-28', den_ngay: '2026-10-01' });
  const r = app.integrity.check();
  assert.equal(r.ok, true, JSON.stringify(r.checks.filter((c) => c.severity === 'LOI' && c.count)));
  assert.equal(byId(r, 'PHIEU_TRUNG_NOI_XUAT').count, 0); assert.equal(byId(r, 'CHOT_MO_COI').count, 0); assert.equal(byId(r, 'TIEN_LECH').count, 0);
  app.lock.unlock(app.db.get('SELECT id FROM chot_ky').id, 'thử mở khóa');
  assert.equal(app.integrity.check().ok, true, 'sau mở khóa (snapshot cũ còn lại làm lịch sử) vẫn sạch');
});

test('phát hiện: trùng số phiếu + nơi xuất khác cách viết, chốt mồ côi, lệch bộ đếm, lệch tiền; không sửa dữ liệu', async () => {
  const app = createApp({ dbFile: ':memory:', driver: 'node:sqlite' });
  await loadInitialData(app, SEED_DIR);
  const t = app.db.get(`SELECT * FROM phieu_can WHERE trang_thai='ACTIVE' ORDER BY id LIMIT 1`);
  // mô phỏng DB cũ (trước bản sửa): cùng phiếu nhập hai lần với tên nơi xuất khác chữ
  const cols = Object.keys(t).filter((k) => !['id', 'kl_hang_tan', 'ngay_can'].includes(k));
  const vals = cols.map((k) => (k === 'business_key' ? t.business_key + '#ALIAS' : k === 'strong_key' ? t.strong_key + '#ALIAS' : k === 'fingerprint' ? 'x' : t[k]));
  const dupId = app.db.run(`INSERT INTO phieu_can(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, vals).id;
  app.db.run('UPDATE phieu_can SET chot_ky_id=999 WHERE id=?', [app.db.get(`SELECT id FROM phieu_can WHERE id<>? ORDER BY id DESC LIMIT 1`, [dupId]).id]);
  app.db.run('UPDATE import_batch SET inserted_rows=inserted_rows+5');
  const bad = app.db.get(`SELECT id FROM phieu_can WHERE trang_thai_tinh_gia='OK' AND id NOT IN (?, ?) LIMIT 1`, [t.id, dupId]).id;
  app.db.run('UPDATE phieu_can SET tong_tien=tong_tien+5000 WHERE id=?', [bad]);
  const before = JSON.stringify(app.db.all('SELECT id, trang_thai, tong_tien FROM phieu_can ORDER BY id'));
  const r = app.integrity.check();
  assert.equal(r.ok, false);
  const d = byId(r, 'PHIEU_TRUNG_NOI_XUAT'); assert.equal(d.count, 1); assert.deepEqual(d.sample[0].ids.split(',').map(Number).sort((a, b) => a - b), [t.id, dupId].sort((a, b) => a - b));
  assert.ok(byId(r, 'CHOT_MO_COI').count >= 1); assert.equal(byId(r, 'BATCH_LECH_DEM').count, 1); assert.ok(byId(r, 'TIEN_LECH').count >= 1);
  assert.equal(JSON.stringify(app.db.all('SELECT id, trang_thai, tong_tien FROM phieu_can ORDER BY id')), before, 'chỉ đọc: không đổi dữ liệu');
});

test('script npm run integrity: đọc file DB chỉ-đọc, mã thoát 0 khi sạch, 1 khi có lỗi, 2 khi file sai', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcint-')); const file = path.join(dir, 'a.db');
  const app = createApp({ dbFile: file, driver: 'node:sqlite' }); await loadInitialData(app, SEED_DIR);
  app.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); app.close();
  const s = path.join(__dirname, '..', 'scripts', 'integrity.js');
  const ok = spawnSync(process.execPath, ['--no-warnings', s, file], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr); assert.match(ok.stdout, /KHÔNG có lỗi toàn vẹn/); assert.match(ok.stdout, /2035 phiếu/);
  const junk = path.join(dir, 'x.db'); fs.writeFileSync(junk, 'khong phai sqlite');
  assert.equal(spawnSync(process.execPath, ['--no-warnings', s, junk], { encoding: 'utf8' }).status, 2);
});
