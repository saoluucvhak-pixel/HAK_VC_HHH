'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { openFile } = require('./snapshot');
const { safeFileName } = require('../utils/safePath');

const hashBytes = (bytes) => createHash('sha256').update(bytes).digest('hex');

function hashFile(file) {
  const hash = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let length;
    while ((length = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, length));
    return hash.digest('hex');
  } finally { fs.closeSync(fd); }
}

function checkedName(name) {
  if (typeof name !== 'string' || !name || safeFileName(name) !== name || /[. ]$/.test(name)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new Error('Tên tệp nguồn trong hồ sơ sao lưu không hợp lệ');
  }
  return name;
}

// Bảng phụ nằm trong tệp sao lưu và được gỡ khỏi DB đã tách trước khi mở lại ứng dụng.
function packImports(file, driver, importsDir) {
  const db = openFile(file, driver, { readOnly: false });
  try {
    db.exec(`BEGIN; CREATE TABLE vc_backup_imports(
      name TEXT PRIMARY KEY COLLATE NOCASE, content BLOB NOT NULL, sha256 TEXT NOT NULL
    );`);
    const add = db.prepare('INSERT INTO vc_backup_imports VALUES (?,?,?)');
    for (const entry of fs.readdirSync(importsDir, { withFileTypes: true })) {
      if (!entry.isFile()) throw new Error('Thư mục imports chứa mục không phải tệp nguồn thông thường');
      const bytes = fs.readFileSync(path.join(importsDir, checkedName(entry.name)));
      add.run(entry.name, bytes, hashBytes(bytes));
    }
    db.exec('COMMIT');
  } finally { db.close(); }
}

function stageImports(file, driver, stagedDir) {
  const db = openFile(file, driver, { readOnly: false });
  try {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='vc_backup_imports'").get()) return false;
    fs.mkdirSync(stagedDir);
    for (const row of db.prepare('SELECT name, content, sha256 FROM vc_backup_imports').iterate()) {
      const dest = path.join(stagedDir, checkedName(row.name));
      if (!(row.content instanceof Uint8Array) || hashBytes(row.content) !== row.sha256) {
        throw new Error('SHA-256 tệp nguồn trong hồ sơ sao lưu không khớp');
      }
      fs.writeFileSync(dest, row.content, { flag: 'wx' });
    }
    db.exec('DROP TABLE vc_backup_imports; VACUUM;');
    return true;
  } finally { db.close(); }
}

module.exports = { hashFile, packImports, stageImports };
