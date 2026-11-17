'use strict';
/**
 * Backup/Restore SQLite (offline).
 * - backupNow / preMigration: `VACUUM INTO` từ kết nối đang mở → file nhất quán kể cả khi đang WAL, được mở lại kiểm tra; ghi backup_log + sha256.
 * - autoDaily: nếu bản AUTO gần nhất cũ hơn 1 ngày → backup.
 * - retention: AUTO giữ `keepDaily` bản gần nhất + 1 bản/tháng cho `keepMonthly` tháng; loại khác giữ 20 bản gần nhất.
 *   Không bao giờ xóa bản backup ngoài quy tắc này.
 * - restore: backup PRE_RESTORE trước, đóng DB, chép file, mở lại (callback reopen).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { uniqueBackupPath, vacuumInto, inspect, driverOf, latestVersion } = require('../database/snapshot');

class BackupService {
  constructor({ getDb, dbFile, backupsDir, settings, reopen }) {
    Object.assign(this, { getDb, dbFile, backupsDir, settings, reopen });
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  /**
   * Tạo bản sao nhất quán từ kết nối `raw` (VACUUM INTO → gồm cả giao dịch còn trong WAL), kiểm tra bằng kết nối riêng
   * (integrity_check, schema đúng phiên bản nguồn). Lỗi ở bất kỳ bước nào → xóa bản sao dở dang và ném lỗi.
   */
  _snapshot(raw, kind, note, { expectVersion = null, protect = [], logFn = null } = {}) {
    const file = uniqueBackupPath(this.backupsDir, kind);
    try {
      vacuumInto(raw, file);
      const chk = inspect(file, driverOf(raw), { expectVersion });
      if (!chk.ok) throw new Error(chk.reason);
    } catch (e) {
      try { fs.unlinkSync(file); } catch { /* chưa tạo */ }
      throw new Error(`Không tạo/xác minh được bản sao lưu ${kind}: ${e.message}`);
    }
    const buf = fs.readFileSync(file);
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    if (logFn) { try { logFn(file, buf.length, sha); } catch (e) { /* DB chỉ đọc / bảng chưa có */ } }
    this.applyRetention(file, protect);
    return { file, size: buf.length, sha256: sha };
  }

  backupNow(kind = 'MANUAL', note = null, { protect = [] } = {}) {
    const db = this.getDb();
    return this._snapshot(db.raw, kind, note, { protect, logFn: (file, size, sha) =>
      db.run('INSERT INTO backup_log(kind, file_path, size_bytes, sha256, note) VALUES (?,?,?,?,?)', [kind === 'PRE_IMPORT' ? 'MANUAL' : kind, file, size, sha, note || kind]) });
  }

  /** Bản sao trước migration, lấy từ kết nối đang mở của migrator (xác minh đúng phiên bản `from`). */
  preMigration({ raw, from }) {
    return this._snapshot(raw, 'PRE_MIGRATION', `Trước khi nâng cấp CSDL từ v${from}`, { expectVersion: from, logFn: (file, size, sha) =>
      raw.prepare('INSERT INTO backup_log(kind, file_path, size_bytes, sha256, note) VALUES (?,?,?,?,?)').run('PRE_MIGRATION', file, size, sha, `Trước khi nâng cấp CSDL từ v${from}`) });
  }

  list() {
    return fs.readdirSync(this.backupsDir).filter((f) => f.endsWith('.db')).map((f) => {
      const st = fs.statSync(path.join(this.backupsDir, f));
      const m = f.match(/_(AUTO|MANUAL|PRE_RESTORE|PRE_MIGRATION|PRE_IMPORT)\.db$/);
      return { file: path.join(this.backupsDir, f), name: f, size: st.size, time: st.mtime.toISOString(), kind: m ? m[1] : 'KHAC' };
    }).sort((a, b) => (a.time < b.time ? 1 : -1));
  }

  /** Gọi khi mở phần mềm: sao lưu nếu bản AUTO gần nhất đã quá `intervalDays` ngày (0 = tắt; mặc định 1). */
  autoDaily() {
    const cfg = (this.settings && this.settings.get('backup')) || {};
    const days = cfg.intervalDays === undefined || cfg.intervalDays === null ? 1 : Number(cfg.intervalDays);
    if (!(days > 0)) return null;
    const last = this.list().find((b) => b.kind === 'AUTO');
    if (!last || Date.now() - Date.parse(last.time) >= days * 24 * 3600 * 1000) return this.backupNow('AUTO');
    return null;
  }

  applyRetention(justCreated = null, protect = []) {
    // Đang mở DB (migration) thì dịch vụ cài đặt có thể chưa sẵn sàng/đã đóng: dùng mặc định thay vì lỗi
    let cfg = {};
    try { cfg = (this.settings && this.settings.get('backup')) || {}; } catch (e) { cfg = {}; }
    // Số bản giữ lại phải là số nguyên dương hợp lệ; giá trị lạ (chữ, âm, 0, rất lớn) → mặc định, KHÔNG bao giờ dẫn tới xóa hàng loạt.
    const n = (x, d, hi) => (Number.isInteger(x) && x >= 1 ? Math.min(x, hi) : d);
    const keepDaily = n(cfg.keepDaily, 30, 3650), keepMonthly = n(cfg.keepMonthly, 12, 240);
    const all = this.list();
    const keep = new Set();
    if (justCreated) keep.add(justCreated);       // bản vừa tạo không bao giờ bị xóa ngay
    for (const f of protect) keep.add(path.resolve(f));   // file đang được chọn để khôi phục không bị quy tắc lưu giữ dọn mất
    const auto = all.filter((b) => b.kind === 'AUTO');
    auto.slice(0, keepDaily).forEach((b) => keep.add(b.file));
    const months = new Map();
    for (const b of auto) { const m = b.time.slice(0, 7); if (!months.has(m)) months.set(m, b.file); }
    [...months.values()].slice(0, keepMonthly).forEach((f) => keep.add(f));
    for (const kind of ['MANUAL', 'PRE_RESTORE', 'PRE_MIGRATION', 'PRE_IMPORT', 'KHAC']) all.filter((b) => b.kind === kind).slice(0, 20).forEach((b) => keep.add(b.file));
    for (const b of all) if (!keep.has(b.file)) { try { fs.unlinkSync(b.file); } catch { /* đang bị khóa: để lần sau */ } }
  }

  /**
   * Xuất MỘT bản sao lưu ra thư mục khác (ổ rời, ổ mạng…): chỉ nhận file nằm trong thư mục sao lưu, kiểm tra hợp lệ trước,
   * không ghi đè file có sẵn, chép xong đối chiếu SHA-256 với bản gốc. Bản trong thư mục sao lưu giữ nguyên.
   */
  exportTo(file, destDir) {
    const full = path.resolve(file);
    if (path.dirname(full) !== path.resolve(this.backupsDir) || !fs.existsSync(full)) throw new Error('File backup không hợp lệ');
    const dest = path.resolve(String(destDir || ''));
    if (!destDir || !fs.existsSync(dest) || !fs.statSync(dest).isDirectory()) throw new Error('Thư mục đích không tồn tại');
    if (dest === path.resolve(this.backupsDir)) throw new Error('Hãy chọn thư mục khác thư mục sao lưu hiện tại');
    const chk = inspect(full, this.getDb().driver);
    if (!chk.ok) throw new Error(`Bản sao lưu không hợp lệ, không xuất: ${chk.reason}`);
    const base = path.basename(full, '.db');
    let out = path.join(dest, `${base}.db`);
    for (let i = 2; fs.existsSync(out); i++) out = path.join(dest, `${base}-${i}.db`);
    fs.copyFileSync(full, out, fs.constants.COPYFILE_EXCL);
    const h = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    const sha = h(out);
    if (sha !== h(full)) { try { fs.unlinkSync(out); } catch { /* bỏ qua */ } throw new Error('Chép ra thư mục đích không khớp bản gốc (SHA-256) — đã hủy, hãy thử ổ khác'); }
    return { path: out, size: fs.statSync(out).size, sha256: sha };
  }

  /**
   * Khôi phục an toàn:
   *  1) chép file chọn vào tệp tạm cạnh DB, kiểm tra (SQLite hợp lệ, integrity_check, đúng DB VC Cost, phiên bản không mới hơn app);
   *  2) PRE_RESTORE nhất quán (file đang chọn được bảo vệ khỏi quy tắc lưu giữ);
   *  3) đóng DB, dời DB hiện tại + WAL/SHM sang tệp tạm (quay lui được), đổi tên bản đã kiểm tra thành app.db, mở lại + đọc thử;
   *  4) lỗi ở bước 3 → trả DB ban đầu về chỗ cũ, mở lại, xác minh đọc được rồi mới ném lỗi (nêu rõ đang dùng bộ dữ liệu nào).
   */
  restore(file) {
    const full = path.resolve(file);
    if (path.dirname(full) !== path.resolve(this.backupsDir) || !fs.existsSync(full)) throw new Error('File backup không hợp lệ');
    const driver = this.getDb().driver;
    const tmp = this.dbFile + '.restore-tmp', old = this.dbFile + '.restore-old';
    const rm = (f) => { try { fs.unlinkSync(f); } catch { /* không có */ } };
    const cleanTmp = () => ['', '-wal', '-shm', '-journal'].forEach((e) => rm(tmp + e));
    // 1) kiểm tra trên bản sao tạm — DB đang dùng chưa bị đụng tới
    cleanTmp(); fs.copyFileSync(full, tmp);
    const chk = inspect(tmp, driver);
    if (!chk.ok) { cleanTmp(); throw new Error(`Không khôi phục được "${path.basename(full)}": ${chk.reason}. Dữ liệu hiện tại không bị thay đổi.`); }
    // 2) PRE_RESTORE
    let pre;
    try { pre = this.backupNow('PRE_RESTORE', `Trước khi khôi phục ${path.basename(full)}`, { protect: [full] }); }
    catch (e) { cleanTmp(); throw new Error(`Không tạo được bản an toàn trước khi khôi phục, đã dừng: ${e.message}. Dữ liệu hiện tại không bị thay đổi.`); }
    if (!fs.existsSync(full)) { cleanTmp(); throw new Error('File backup đã bị dọn trong lúc khôi phục — đã dừng, dữ liệu hiện tại không bị thay đổi.'); }
    // 3) thay thế
    const exts = ['', '-wal', '-shm'];
    const moved = [];
    const putBack = () => {
      for (const e of exts) rm(this.dbFile + e);
      for (const e of moved) fs.renameSync(old + e, this.dbFile + e);
    };
    this.getDb().close();
    try {
      for (const e of exts) rm(old + e);
      for (const e of exts) if (fs.existsSync(this.dbFile + e)) { fs.renameSync(this.dbFile + e, old + e); moved.push(e); }
      fs.renameSync(tmp, this.dbFile);
      this.reopen();
      const r = this.getDb().get('SELECT MAX(version) v FROM schema_version');
      this.getDb().get('SELECT COUNT(*) n FROM phieu_can');
      if (!r || r.v !== latestVersion()) throw new Error('Phiên bản schema sau khi mở lại không đúng');
    } catch (err) {
      // 4) quay lui về DB ban đầu
      let back = '';
      try { try { this.getDb().close(); } catch { /* đã đóng */ } } catch { /* bỏ qua */ }
      try {
        putBack(); this.reopen();
        const c = this.getDb().get('SELECT COUNT(*) n FROM phieu_can');
        back = `Đã quay về dữ liệu ban đầu (${c.n} phiếu cân), đọc/ghi bình thường.`;
      } catch (e2) {
        back = `CẢNH BÁO: quay về dữ liệu ban đầu cũng lỗi (${e2.message}). Bản gốc nằm ở ${old}; bản an toàn: ${pre.file}.`;
      }
      cleanTmp();
      throw new Error(`Khôi phục thất bại (${err.message}). ${back} Bản an toàn trước khôi phục: ${path.basename(pre.file)}.`);
    }
    for (const e of exts) rm(old + e);
    cleanTmp();
    return { restored: path.basename(full), safetyBackup: pre.file, schemaFrom: chk.version, schemaTo: latestVersion(), migrated: chk.needsMigration, counts: chk.counts };
  }
}

module.exports = { BackupService };
