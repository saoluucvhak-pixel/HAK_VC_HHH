'use strict';
/** Sao lưu trước migration nhất quán (gồm WAL) và khôi phục an toàn (kiểm tra, quay lui). Chạy cho từng driver có sẵn. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { xlsxBuffer } = require('./helpers/xlsx');
const { createRuntime } = require('../src/runtime');
const { SEED_DIR } = require('../src/app');
const { migrate, currentVersion, listMigrations } = require('../src/database/migrator');
const { BackupService } = require('../src/services/BackupService');
const { inspect, openFile } = require('../src/database/snapshot');

const SAMPLE = path.join(__dirname, 'fixtures', 'sample-v47.xlsx');
const H = ['Số phiếu', 'Biển số', 'Nơi xuất', 'Giờ cân 1', 'Giờ cân 2', 'Cân 1', 'Cân 2', 'KL hàng'];
const drivers = ['node:sqlite']; try { require('better-sqlite3'); drivers.push('better-sqlite3'); } catch { /* không có */ }
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vcsafe-'));
const rawOpen = (file, driver) => {
  if (driver === 'better-sqlite3') { const B = require('better-sqlite3'); return new B(file); }
  const { DatabaseSync } = require('node:sqlite'); return new DatabaseSync(file);
};
/** DB ở schema v4 (trước bản nâng cấp 005) trong chế độ WAL, tắt checkpoint tự động để giao dịch nằm lại trong WAL. */
function v4Db(file, driver) {
  const dir = tmp();
  for (const m of listMigrations().filter((x) => x.version <= 4)) fs.copyFileSync(m.file, path.join(dir, m.name));
  const raw = rawOpen(file, driver);
  raw.exec('PRAGMA journal_mode = WAL'); raw.exec('PRAGMA foreign_keys = ON'); raw.exec('PRAGMA wal_autocheckpoint = 0');
  migrate(raw, { dir });
  return raw;
}
/** Số liệu đối chiếu: phiếu, kg, tiền trước VAT, VAT, tổng, batch, audit, snapshot chốt. */
const figures = (app) => ({
  ...app.db.get(`SELECT COUNT(*) phieu, COALESCE(SUM(kl_hang_kg),0) kg, COALESCE(SUM(tien_truoc_vat),0) truoc_vat, COALESCE(SUM(tien_vat),0) vat, COALESCE(SUM(tong_tien),0) tong FROM phieu_can WHERE trang_thai='ACTIVE'`),
  batch: app.db.get('SELECT COUNT(*) n FROM import_batch').n, audit: app.db.get('SELECT COUNT(*) n FROM audit_log').n, snapshot: app.db.get('SELECT COUNT(*) n FROM chot_ky_snapshot').n,
});

for (const driver of drivers) {
  test(`[${driver}] lỗi đổi tên DB trước thay thế giữ nguyên dữ liệu gốc`, (t) => {
    const rt = createRuntime({ dataDir: tmp(), driver });
    try {
      const backup = rt.backup.backupNow();
      rt.app.db.run(`INSERT INTO audit_log(action, entity) VALUES ('GIU_KHI_RENAME_LOI', 'test')`);
      const rename = fs.renameSync;
      t.mock.method(fs, 'renameSync', (from, to) => {
        if (from === rt.dirs.db && to === rt.dirs.db + '.restore-old') {
          throw new Error('EPERM: không đổi tên được DB đang dùng');
        }
        return rename(from, to);
      });
      assert.throws(() => rt.backup.restore(backup.file), /Khôi phục thất bại/);
      assert.equal(rt.app.db.get(`SELECT COUNT(*) n FROM audit_log WHERE action='GIU_KHI_RENAME_LOI'`).n, 1);
      rt.app.db.run(`INSERT INTO audit_log(action, entity) VALUES ('GHI_SAU_RENAME_LOI', 'test')`);
      assert.equal(rt.app.db.get(`SELECT COUNT(*) n FROM audit_log WHERE action='GHI_SAU_RENAME_LOI'`).n, 1);
    } finally {
      t.mock.restoreAll();
      rt.close();
    }
  });

  test(`[${driver}] PRE_MIGRATION chứa giao dịch đã commit còn trong WAL và vẫn ở schema trước nâng cấp`, () => {
    const dir = tmp(); const file = path.join(dir, 'app.db'); const backups = path.join(dir, 'backups');
    const raw = v4Db(file, driver);
    raw.prepare(`INSERT INTO audit_log(action, entity) VALUES ('TRONG_WAL','x')`).run();
    assert.ok(fs.existsSync(file + '-wal') && fs.statSync(file + '-wal').size > 0, 'giao dịch phải đang nằm trong WAL');
    // cơ chế cũ (chép riêng app.db) không có giao dịch này — chứng minh lỗi được khắc phục
    fs.copyFileSync(file, path.join(dir, 'copy-cu.db'));
    assert.equal(inspect(path.join(dir, 'copy-cu.db'), driver).ok, false, 'chép riêng app.db bỏ sót toàn bộ dữ liệu còn trong WAL (kể cả schema)');
    const bk = new BackupService({ getDb: () => ({}), dbFile: file, backupsDir: backups, settings: { get: () => ({}) }, reopen: () => {} });
    const r = migrate(raw, { backupFn: (i) => bk.preMigration(i) });
    assert.equal(r.to, listMigrations().at(-1).version);
    const [b] = bk.list().filter((x) => x.kind === 'PRE_MIGRATION');
    assert.ok(b, 'có bản PRE_MIGRATION'); assert.match(b.name, /_PRE_MIGRATION\.db$/);
    const chk = inspect(b.file, driver); assert.ok(chk.ok); assert.equal(chk.version, 4);
    const c = openFile(b.file, driver);
    assert.equal(c.prepare(`SELECT COUNT(*) n FROM audit_log WHERE action='TRONG_WAL'`).get().n, 1);
    c.close(); raw.close();
  });

  test(`[${driver}] lỗi ghi bản sao: migration không chạy, DB nguồn giữ phiên bản cũ và vẫn mở/ghi được`, () => {
    const dir = tmp(); const file = path.join(dir, 'app.db'); const backups = path.join(dir, 'backups');
    const raw = v4Db(file, driver);
    raw.prepare(`INSERT INTO audit_log(action, entity) VALUES ('GIU','x')`).run();
    const bk = new BackupService({ getDb: () => ({}), dbFile: file, backupsDir: backups, settings: { get: () => ({}) }, reopen: () => {} });
    fs.rmSync(backups, { recursive: true }); fs.writeFileSync(backups, 'không phải thư mục');   // mô phỏng lỗi ghi file
    assert.throws(() => migrate(raw, { backupFn: (i) => bk.preMigration(i) }), /PRE_MIGRATION/);
    assert.equal(currentVersion(raw), 4);
    raw.prepare(`INSERT INTO audit_log(action, entity) VALUES ('VAN_GHI_DUOC','x')`).run();
    assert.equal(raw.prepare('SELECT COUNT(*) n FROM audit_log').get().n, 2);
    raw.close();
    const again = rawOpen(file, driver); assert.equal(currentVersion(again), 4); again.close();
  });

  test(`[${driver}] đặt tên: nhiều bản PRE_MIGRATION cùng giây không trùng; quy tắc lưu giữ không xóa bản mới nhất`, () => {
    const dir = tmp(); const file = path.join(dir, 'app.db');
    const raw = v4Db(file, driver);
    const bk = new BackupService({ getDb: () => ({}), dbFile: file, backupsDir: path.join(dir, 'b'), settings: { get: () => ({}) }, reopen: () => {} });
    const made = Array.from({ length: 23 }, () => bk.preMigration({ raw, from: 4 }).file);
    assert.equal(new Set(made).size, 23);
    const left = bk.list().filter((x) => x.kind === 'PRE_MIGRATION');
    assert.equal(left.length, 20);
    assert.ok(fs.existsSync(made.at(-1)));
    raw.close();
  });

  test(`[${driver}] khôi phục: từ chối file hỏng/sai ứng dụng/mới hơn, DB hiện tại giữ nguyên; DB cũ hợp lệ khôi phục + migrate; lỗi mở lại → quay về DB ban đầu`, async () => {
    const dir = tmp();
    const rt = createRuntime({ dataDir: dir, driver });
    try {
      const app0 = rt.app;
      app0.seed.load(JSON.parse(fs.readFileSync(path.join(SEED_DIR, 'sample-v47.json'), 'utf8')));
      app0.vehicleImport.commit((await app0.vehicleImport.preview({ filePath: SAMPLE })).token);
      const plate = app0.db.get('SELECT bien_so_chuan b FROM xe LIMIT 1').b;
      const dot = app0.db.get('SELECT id FROM dot_van_chuyen LIMIT 1');
      const rows = [1, 2, 3].map((i) => [`90${i}`, plate, 'Quế Sơn', `0${i}/10/2026 10:00`, `0${i}/10/2026 10:30`, 30000, 13000, 17000]);
      const o = await app0.imports.open({ buffer: await xlsxBuffer([H, ...rows]), fileName: 'f.xlsx' });
      const si = app0.imports.sheetInfo(o.token, o.suggestedSheet);
      app0.imports.preview(o.token, { sheetName: si.sheetName, headerRow: si.headerRow, mapping: si.mapping, dotId: dot.id });
      app0.imports.commit(o.token, {});
      app0.lock.lock({ loai: 'KY', tu_ngay: '2026-10-01', den_ngay: '2026-10-02' });
      const base = figures(rt.app);
      assert.equal(base.phieu, 3); assert.ok(base.snapshot > 0 && base.tong > 0);
      const good = rt.backup.backupNow('MANUAL');
      const bdir = rt.dirs.backups;
      const same = () => { assert.deepEqual(figures(rt.app), base); rt.app.db.run(`INSERT INTO audit_log(action, entity) VALUES ('GHI_THU','x')`); base.audit++; };

      // (a) cắt cụt nhưng còn header SQLite
      const trunc = path.join(bdir, 'app_2020-01-01T00-00-00_MANUAL.db'); fs.writeFileSync(trunc, fs.readFileSync(good.file).subarray(0, 6000));
      assert.throws(() => rt.backup.restore(trunc), /Không khôi phục được/); same();
      // (b) SQLite của ứng dụng khác
      const other = path.join(bdir, 'app_2020-01-02T00-00-00_MANUAL.db'); { const x = rawOpen(other, driver); x.exec('CREATE TABLE khac(a); INSERT INTO khac VALUES (1)'); x.close(); }
      assert.throws(() => rt.backup.restore(other), /không phải cơ sở dữ liệu VC Cost/i); same();
      // (c) VC Cost mới hơn phần mềm
      const newer = path.join(bdir, 'app_2020-01-03T00-00-00_MANUAL.db'); fs.copyFileSync(good.file, newer);
      { const x = rawOpen(newer, driver); x.exec(`INSERT INTO schema_version(version, description) VALUES (99, 'tuong-lai')`); x.close(); }
      assert.throws(() => rt.backup.restore(newer), /mới hơn phần mềm/); same();
      assert.equal(fs.existsSync(rt.dirs.db + '.restore-tmp'), false);

      // (e) lỗi khi mở lại sau thay thế → quay về DB ban đầu, đọc/ghi được
      const realReopen = rt.backup.reopen; let n = 0;
      rt.backup.reopen = () => { if (!n++) throw new Error('mô phỏng lỗi mở lại'); return realReopen(); };
      const v4file = path.join(bdir, 'app_2021-01-01T00-00-00_MANUAL.db');
      { const x = v4Db(v4file, driver); x.prepare(`INSERT INTO audit_log(action, entity) VALUES ('CU','x')`).run(); x.exec('PRAGMA wal_checkpoint(TRUNCATE)'); x.exec('PRAGMA journal_mode = DELETE'); x.close(); }
      assert.throws(() => rt.backup.restore(v4file), /Khôi phục thất bại.*Đã quay về dữ liệu ban đầu \(3 phiếu cân\)/);
      rt.backup.reopen = realReopen; same();
      assert.equal(fs.existsSync(rt.dirs.db + '.restore-old'), false);

      // (d) DB cũ hợp lệ (v4) → khôi phục + migrate; PRE_RESTORE giữ lại số liệu trước đó
      const res = rt.backup.restore(v4file);
      assert.equal(res.schemaFrom, 4); assert.equal(res.migrated, true);
      assert.equal(currentVersion(rt.app.db.raw), listMigrations().at(-1).version);
      assert.equal(rt.app.db.get(`SELECT COUNT(*) n FROM audit_log WHERE action='CU'`).n, 1);
      assert.ok(rt.backup.list().some((b) => b.kind === 'PRE_MIGRATION'), 'mở lại bản cũ phải tạo PRE_MIGRATION');
      const pre = inspect(res.safetyBackup, driver); assert.ok(pre.ok); assert.equal(pre.counts.phieu, 3);
      // quay lại bộ dữ liệu cũ bằng chính PRE_RESTORE
      rt.backup.restore(res.safetyBackup);
      assert.deepEqual({ ...figures(rt.app), audit: base.audit }, base);

      // (f) file được chọn là bản cũ có thể bị quy tắc lưu giữ dọn khi tạo PRE_RESTORE → được bảo vệ
      const target = path.join(bdir, 'app_2019-01-01T00-00-00_PRE_RESTORE.db'); fs.copyFileSync(good.file, target);
      const past = new Date('2019-01-01'); fs.utimesSync(target, past, past);
      for (let i = 0; i < 20; i++) { const f = path.join(bdir, `app_2030-01-01T00-00-${String(i).padStart(2, '0')}_PRE_RESTORE.db`); fs.copyFileSync(good.file, f); }
      rt.backup.restore(target);
      assert.ok(fs.existsSync(target), 'file đang khôi phục không bị dọn');
      assert.equal(figures(rt.app).phieu, 3);
    } finally { try { rt.close(); } catch { /* đã đóng */ } }
  });

  test(`[${driver}] khởi động ứng dụng trên DB cũ (WAL còn dữ liệu): tạo PRE_MIGRATION đủ giao dịch rồi mới nâng cấp`, () => {
    const dir = tmp(); fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    const file = path.join(dir, 'data', 'app.db');
    const raw = v4Db(file, driver);
    raw.prepare(`INSERT INTO audit_log(action, entity) VALUES ('KHOI_DONG','x')`).run();
    raw.exec('PRAGMA wal_autocheckpoint = 1000');
    const rt = createRuntime({ dataDir: dir, driver });   // mở thêm một kết nối thứ hai, như khi ứng dụng khởi động lại sau sự cố
    try {
      assert.deepEqual(rt.app.db.migration.applied, ['005_bat_bien.sql', '006_phan_quyen.sql', '007_duyet_phieu.sql', '008_pending_already.sql', '009_chot_ky_bang_ke.sql', '010_tai_xe_phieu_can.sql']);
      const [b] = rt.backup.list().filter((x) => x.kind === 'PRE_MIGRATION');
      assert.ok(b); const c = openFile(b.file, driver);
      assert.equal(c.prepare(`SELECT COUNT(*) n FROM audit_log WHERE action='KHOI_DONG'`).get().n, 1);
      assert.equal(c.prepare('SELECT MAX(version) v FROM schema_version').get().v, 4);
      c.close();
      assert.equal(rt.app.db.get(`SELECT kind FROM backup_log WHERE kind='PRE_MIGRATION'`).kind, 'PRE_MIGRATION');
    } finally { rt.close(); try { raw.close(); } catch { /* đã đóng */ } }
  });
}

test('xuất bản sao lưu ra thư mục khác: hợp lệ, không ghi đè, đối chiếu SHA-256; từ chối file ngoài thư mục sao lưu/hỏng/thư mục không có', () => {
  const dir = tmp(); const file = path.join(dir, 'app.db');
  const raw = v4Db(file, drivers[0]);
  const bk = new BackupService({ getDb: () => ({ driver: drivers[0] }), dbFile: file, backupsDir: path.join(dir, 'b'), settings: { get: () => ({}) }, reopen: () => {} });
  const made = bk.preMigration({ raw, from: 4 }).file;
  const usb = tmp();
  const a = bk.exportTo(made, usb); const b = bk.exportTo(made, usb);
  assert.notEqual(a.path, b.path); assert.equal(a.sha256, b.sha256);
  assert.ok(inspect(a.path, drivers[0]).ok);
  assert.throws(() => bk.exportTo(a.path, usb), /File backup không hợp lệ/);
  assert.throws(() => bk.exportTo(made, path.join(usb, 'khong-co')), /Thư mục đích không tồn tại/);
  assert.throws(() => bk.exportTo(made, path.join(dir, 'b')), /khác thư mục sao lưu/);
  const bad = path.join(dir, 'b', 'app_2020-01-01T00-00-00_MANUAL.db'); fs.writeFileSync(bad, Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(200)]));
  assert.throws(() => bk.exportTo(bad, usb), /không hợp lệ, không xuất/);
  assert.ok(fs.existsSync(made), 'bản gốc giữ nguyên');
  raw.close();
});
