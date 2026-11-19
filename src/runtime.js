'use strict';
/**
 * Runtime dùng chung cho Electron main và dev server:
 * thư mục dữ liệu (tách khỏi source), DB, backup, bảng handler, dispatch an toàn.
 *   <dataDir>/data/app.db  /backups  /exports  /imports  /logs
 */
const fs = require('fs');
const path = require('path');
const { createApp, SEED_DIR } = require('./app');
const { createHandlers } = require('./ipc/handlers');
const { loadInitialData, isFreshDb } = require('./services/InitialDataService');
const { BackupService } = require('./services/BackupService');
const { permissionFor, roleAllows } = require('./utils/permissions');

function createRuntime({ dataDir, version = 'dev', driver = null, autoInit = false, renderPdf = null, idleMs = 30 * 60 * 1000 }) {
  const dirs = {
    dataDir,
    db: path.join(dataDir, 'data', 'app.db'),
    backups: path.join(dataDir, 'backups'),
    exports: path.join(dataDir, 'exports'),
    imports: path.join(dataDir, 'imports'),
    logs: path.join(dataDir, 'logs'),
  };
  for (const d of [path.dirname(dirs.db), dirs.backups, dirs.exports, dirs.imports, dirs.logs]) fs.mkdirSync(d, { recursive: true });
  const logFile = path.join(dirs.logs, `app_${new Date().toISOString().slice(0, 10)}.log`);
  const log = (msg) => fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);

  const rt = { dirs, log };
  // Phiên đăng nhập (chỉ có ý nghĩa khi bật phân quyền): lưu id người dùng + lần hoạt động cuối; luôn nạp lại từ DB để vai trò/khóa tài khoản có hiệu lực ngay
  const sess = { id: null, last: 0 };
  rt.session = {
    get: () => { if (!sess.id) return null; const u = rt.app && rt.app.auth.user(sess.id); return u && u.trang_thai === 'ACTIVE' ? u : null; },
    set: (u) => { sess.id = u ? u.id : null; sess.last = Date.now(); },
  };
  // PRE_MIGRATION lấy từ kết nối đang mở của migrator (gồm cả dữ liệu còn trong WAL); lỗi → migration không chạy
  const preMigrationBackup = (info) => { const r = rt.backup.preMigration(info); log(`Backup trước migration: ${r.file}`); };
  const open = () => {
    // ID người dùng chỉ có ý nghĩa trong DB đã xác thực, phải đăng nhập lại sau khôi phục.
    rt.session.set(null);
    rt.app = createApp({ dbFile: dirs.db, driver, backupFn: preMigrationBackup, user: () => { const u = rt.session.get(); return u ? u.ten_dang_nhap : null; } });
    if (process.env.VCCOST_RESET_AUTH === '1') { rt.app.auth.forceDisable(); log('VCCOST_RESET_AUTH=1: đã tắt phân quyền'); }
    rt.handlers = createHandlers(rt.app, { exportsDir: dirs.exports, importsDir: dirs.imports, seedDir: SEED_DIR, backup: rt.backup, session: rt.session, version, dataDir, renderPdf: (...a) => { const f = rt.renderPdf || renderPdf; if (!f) throw new Error('Xuất PDF chưa khả dụng trong môi trường này'); return f(...a); } });
    log(`Mở DB (${rt.app.db.driver}), migration: ${JSON.stringify(rt.app.db.migration)}`);
  };
  rt.backup = new BackupService({ getDb: () => rt.app.db, dbFile: dirs.db, backupsDir: dirs.backups, settings: { get: (k) => rt.app.settings.get(k) }, reopen: () => open() });
  open();
  // Nạp dữ liệu ban đầu (đọc Excel bất đồng bộ) rồi sao lưu tự động; dispatch đợi `rt.ready` xong mới xử lý yêu cầu đầu tiên.
  rt.ready = (async () => {
    if (autoInit) {
      try {
        if (isFreshDb(rt.app)) { const r = await loadInitialData(rt.app, SEED_DIR); log(`Nạp dữ liệu ban đầu: ${JSON.stringify(r.phieu)}`); }
      } catch (e) { log(`Nạp dữ liệu ban đầu lỗi: ${e.stack}`); }
    }
    try { rt.backup.autoDaily(); } catch (e) { log(`Auto backup lỗi: ${e.message}`); }
  })();

  rt.dispatch = async (channel, args) => {
    await rt.ready;
    const h = Object.hasOwn(rt.handlers, channel) ? rt.handlers[channel] : null;
    if (typeof h !== 'function') return { ok: false, error: `Kênh không tồn tại: ${channel}` };
    // Phân quyền (chỉ khi được bật): chưa đăng nhập chỉ gọi được kênh công khai; còn lại theo vai trò; từ chối theo mặc định với kênh chưa khai báo
    if (rt.app.auth.enabled()) {
      const perm = permissionFor(channel, args);
      if (perm !== 'public') {
        const u = rt.session.get();
        if (u && sess.last && Date.now() - sess.last > idleMs) { rt.session.set(null); return { ok: false, error: 'Phiên đăng nhập đã hết hạn do không hoạt động — hãy đăng nhập lại', type: 'AuthRequired' }; }
        if (!u) return { ok: false, error: 'Cần đăng nhập', type: 'AuthRequired' };
        if (!roleAllows(u.vai_tro, perm)) return { ok: false, error: `Bạn không có quyền thực hiện thao tác này (${u.ho_ten} — vai trò hiện tại không đủ quyền)`, type: 'Forbidden' };
        sess.last = Date.now();
      }
    }
    try {
      return { ok: true, data: await h(args || {}) };
    } catch (e) {
      if (e.name !== 'ValidationError' && e.name !== 'ConfirmRequired') log(`Lỗi ${channel}: ${e.stack}`);
      return { ok: false, error: e.message, type: e.name };
    }
  };
  rt.close = () => rt.app.close();
  return rt;
}

module.exports = { createRuntime };
