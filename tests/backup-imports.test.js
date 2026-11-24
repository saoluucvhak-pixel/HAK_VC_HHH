'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRuntime } = require('../src/runtime');
const { openFile } = require('../src/database/snapshot');

test('backup đầy đủ mang tệp nguồn sang máy khác, kiểm băm và rollback khi mở DB lỗi', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-backup-imports-'));
  const source = createRuntime({ dataDir: path.join(root, 'source') });
  const target = createRuntime({ dataDir: path.join(root, 'target') });
  try {
    await Promise.all([source.ready, target.ready]);
    source.app.settings.set('company', { ten: 'Bên A thử' });
    const name = '01-phiếu cân.csv';
    const data = Buffer.from('Số phiếu;Biển số\nP001;TEST01\n');
    fs.writeFileSync(path.join(source.dirs.imports, name), data);
    const backup = source.backup.backupNow();
    const delivered = source.backup.exportTo(backup.file, target.dirs.backups);
    assert.equal(delivered.sha256, backup.sha256);

    const old = path.join(target.dirs.imports, 'trước-khôi-phục.csv');
    fs.writeFileSync(old, 'giữ khi lỗi');
    const reopen = target.backup.reopen;
    let first = true;
    target.backup.reopen = () => {
      if (first) { first = false; throw new Error('Lỗi thử nghiệm sau khi đổi thư mục'); }
      return reopen();
    };
    assert.throws(() => target.backup.restore(delivered.path), /Đã quay về dữ liệu ban đầu/);
    assert.equal(fs.readFileSync(old, 'utf8'), 'giữ khi lỗi');
    assert.notEqual(target.app.settings.get('company')?.ten, 'Bên A thử');

    target.backup.reopen = reopen;
    assert.equal(target.backup.restore(delivered.path).importsRestored, true);
    assert.equal(target.app.settings.get('company').ten, 'Bên A thử');
    assert.deepEqual(fs.readdirSync(target.dirs.imports), [name]);
    assert.deepEqual(fs.readFileSync(path.join(target.dirs.imports, name)), data);
    assert.equal(target.app.db.get("SELECT name FROM sqlite_master WHERE name='vc_backup_imports'"), undefined);

    const damaged = path.join(target.dirs.backups, 'damaged.db');
    fs.copyFileSync(delivered.path, damaged);
    const db = openFile(damaged, target.app.db.driver, { readOnly: false });
    try { db.exec("UPDATE vc_backup_imports SET sha256='invalid'"); } finally { db.close(); }
    assert.throws(() => target.backup.restore(damaged), /SHA-256/);
    assert.equal(target.app.settings.get('company').ten, 'Bên A thử');
    assert.deepEqual(fs.readFileSync(path.join(target.dirs.imports, name)), data);

    const legacy = source.backup.backupNow('PRE_IMPORT');
    const exportedLegacy = source.backup.exportTo(legacy.file, target.dirs.backups);
    assert.equal(target.backup.restore(exportedLegacy.path).importsRestored, false);
    assert.deepEqual(fs.readFileSync(path.join(target.dirs.imports, name)), data);
  } finally {
    source.close();
    target.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
