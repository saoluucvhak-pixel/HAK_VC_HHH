'use strict';
/**
 * Sao chép SQLite nhất quán + kiểm tra file DB. Dùng chung cho sao lưu (kể cả PRE_MIGRATION) và khôi phục.
 *  - vacuumInto: bản sao từ KẾT NỐI ĐANG MỞ (VACUUM INTO) → gồm cả giao dịch đã commit còn nằm trong WAL.
 *  - inspect: mở bản sao bằng kết nối riêng (chỉ đọc), integrity_check + đọc phiên bản schema + nhận diện DB VC Cost.
 */
const fs = require('fs');
const path = require('path');
const { listMigrations } = require('./migrator');

const REQUIRED_TABLES = ['schema_version', 'phieu_can', 'import_batch', 'chot_ky', 'audit_log', 'backup_log'];
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

/** Đường dẫn chưa tồn tại: app_<giờ>_<KIND>.db, trùng giây thì app_<giờ>-2_<KIND>.db ... */
const issued = new Set();   // tên đã cấp trong tiến trình: không dùng lại tên của bản vừa bị quy tắc lưu giữ dọn
function uniqueBackupPath(dir, kind) {
  const ts = stamp();
  let file = path.join(dir, `app_${ts}_${kind}.db`);
  for (let i = 2; fs.existsSync(file) || issued.has(file); i++) file = path.join(dir, `app_${ts}-${i}_${kind}.db`);
  issued.add(file);
  return file;
}

/** Tạo bản sao nhất quán từ kết nối đang mở (raw: có exec). Ném lỗi nếu không ghi được. */
function vacuumInto(raw, file) {
  if (fs.existsSync(file)) throw new Error(`Bản sao đã tồn tại: ${file}`);
  try { raw.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`); }
  catch (e) { try { fs.unlinkSync(file); } catch { /* chưa tạo */ } throw e; }
}

/** Mở file bằng một kết nối riêng (chỉ đọc nếu được). */
function openFile(file, driver, { readOnly = true } = {}) {
  if (driver === 'better-sqlite3') { const B = require('better-sqlite3'); return new B(file, { readonly: readOnly, fileMustExist: true }); }
  const { DatabaseSync } = require('node:sqlite');
  return new DatabaseSync(file, { readOnly });
}

const latestVersion = () => { const m = listMigrations(); return m.length ? m[m.length - 1].version : 0; };

/**
 * Kiểm tra một file DB. Trả {ok, reason, version, latest, needsMigration, counts}. Không bao giờ ném lỗi.
 * @param {number|null} expectVersion nếu có: schema_version phải đúng bằng giá trị này (bản sao PRE_MIGRATION)
 */
function inspect(file, driver, { expectVersion = null } = {}) {
  const latest = latestVersion();
  const fail = (reason, extra = {}) => ({ ok: false, reason, latest, ...extra });
  let head;
  try { const fd = fs.openSync(file, 'r'); try { head = Buffer.alloc(16); fs.readSync(fd, head, 0, 16, 0); } finally { fs.closeSync(fd); } } catch (e) { return fail(`Không đọc được file: ${e.message}`); }
  if (head.toString('latin1') !== 'SQLite format 3\0') return fail('File không phải cơ sở dữ liệu SQLite');
  let db;
  try {
    db = openFile(file, driver);
    const one = (sql) => db.prepare(sql).get();
    const ic = one('PRAGMA integrity_check');
    const verdict = ic && Object.values(ic)[0];
    if (verdict !== 'ok') return fail(`File cơ sở dữ liệu bị hỏng (integrity_check: ${verdict})`);
    const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
    const missing = REQUIRED_TABLES.filter((t) => !names.has(t));
    if (missing.length) return fail(`Không phải cơ sở dữ liệu VC Cost (thiếu bảng: ${missing.join(', ')})`);
    const version = (one('SELECT MAX(version) v FROM schema_version') || {}).v || 0;
    if (version > latest) return fail(`Cơ sở dữ liệu có phiên bản ${version} mới hơn phần mềm (${latest}) — cài bản VC Cost mới hơn để khôi phục`, { version });
    if (expectVersion !== null && version !== expectVersion) return fail(`Phiên bản schema của bản sao (${version}) khác DB nguồn (${expectVersion})`, { version });
    const n = (sql) => Number((one(sql) || {}).n || 0);
    return { ok: true, version, latest, needsMigration: version < latest,
      counts: { phieu: n('SELECT COUNT(*) n FROM phieu_can'), batch: n('SELECT COUNT(*) n FROM import_batch'), audit: n('SELECT COUNT(*) n FROM audit_log'), chot: n('SELECT COUNT(*) n FROM chot_ky') } };
  } catch (e) {
    return fail(`Không mở/đọc được cơ sở dữ liệu: ${e.message}`);
  } finally { try { if (db) db.close(); } catch { /* bỏ qua */ } }
}

const driverOf = (raw) => (raw && raw.constructor && raw.constructor.name === 'DatabaseSync' ? 'node:sqlite' : 'better-sqlite3');

module.exports = { driverOf, uniqueBackupPath, vacuumInto, openFile, inspect, latestVersion, REQUIRED_TABLES };
