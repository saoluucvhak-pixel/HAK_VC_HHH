'use strict';
/**
 * Electron main process — chạy hoàn toàn offline.
 * Dữ liệu:
 *   - Bản Portable: thư mục "VCCost-data" cạnh file .exe (PORTABLE_EXECUTABLE_DIR)
 *   - Bản Setup   : %APPDATA%/VCCost
 *   - Người dùng đổi trong Cài đặt → ghi vccost-location.json (cạnh .exe / %APPDATA%/VCCost)
 *   - Ghi đè bằng biến môi trường VCCOST_DATA_DIR
 */
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const { createRuntime } = require('../src/runtime');
const { isInside } = require('../src/utils/safePath');

function relaunch() {
  // Portable: chạy lại đúng file .exe gốc
  if (process.env.PORTABLE_EXECUTABLE_FILE) app.relaunch({ execPath: process.env.PORTABLE_EXECUTABLE_FILE });
  else app.relaunch();
  app.exit(0);
}
function dirSize(d) { let n = 0; try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); n += e.isDirectory() ? dirSize(p) : fs.statSync(p).size; } } catch { /* bỏ qua */ } return n; }

let rt = null;
let win = null;

const loc = require('../src/utils/storageLocation');
const where = () => loc.resolveDataDir({ env: process.env, portableDir: process.env.PORTABLE_EXECUTABLE_DIR || null, appData: app.getPath('appData') });

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 700, show: false, backgroundColor: '#F1EFE9',
    title: 'VC Cost — Chi phí vận chuyển',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  // App offline: từ chối mọi yêu cầu quyền của trang (camera, micro, vị trí, thông báo…) và không cho gắn <webview>
  win.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  win.webContents.session.setPermissionCheckHandler(() => false);
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
  // Chặn mọi điều hướng ra Internet
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

/**
 * Chế độ kiểm tra khởi động cho CI (chỉ bật khi có biến môi trường VCCOST_SMOKE=1): mở cửa sổ thật, gọi app.info qua
 * preload → IPC → CSDL, kiểm tra module native (better-sqlite3) đã nạp trong bản đóng gói, ghi kết quả JSON vào
 * VCCOST_SMOKE_OUT rồi thoát (0 = đạt, 1 = lỗi). Không ảnh hưởng khi chạy bình thường.
 */
const smokeFinish = (ok, data) => {
  try { if (process.env.VCCOST_SMOKE_OUT) fs.writeFileSync(process.env.VCCOST_SMOKE_OUT, JSON.stringify({ ok, ...data }, null, 2)); } catch { /* bỏ qua */ }
  try { if (rt) rt.close(); } catch { /* bỏ qua */ }
  app.exit(ok ? 0 : 1);
};
const smokeFail = (error) => smokeFinish(false, { error: String(error) });
if (process.env.VCCOST_SMOKE) {   // bất kỳ lỗi không bắt hay treo nào cũng phải làm CI đỏ nhanh, không treo tới hết thời gian job
  process.on('uncaughtException', smokeFail);
  process.on('unhandledRejection', smokeFail);
  setTimeout(() => smokeFail('timeout 120s'), 120000);
}

function runSmoke() {
  let done = false;
  const finish = (ok, data) => { if (done) return; done = true; smokeFinish(ok, data); };
  win.webContents.once('did-finish-load', async () => {
    try {
      const initial = { migration: rt.app.db.migration, backups: rt.backup.list().map((b) => b.kind) };   // trạng thái ngay sau khi mở (trước sao lưu/khôi phục thử)
      const probe = `(async () => {
        const info = await window.vcApi.invoke('app.info', {});
        for (let i = 0; i < 50 && !(document.getElementById('view') && document.getElementById('view').childElementCount); i++) await new Promise((r) => setTimeout(r, 200));
        const v = document.getElementById('view');
        return { title: document.title, info, viewChildren: v ? v.childElementCount : -1 };
      })()`;
      const r = await win.webContents.executeJavaScript(probe);
      const d = r.info && r.info.data;
      const problems = [];
      if (!r.info || !r.info.ok) problems.push('app.info lỗi: ' + (r.info && r.info.error));
      else {
        if (d.driver !== 'better-sqlite3') problems.push('driver CSDL = ' + d.driver + ' (cần better-sqlite3)');
        if (!(d.schema >= 1)) problems.push('schema không hợp lệ');
      }
      if (!(r.viewChildren > 0)) problems.push('giao diện chưa vẽ');
      // PDF thật qua Chromium của Electron (printToPDF): file phải bắt đầu bằng %PDF và không rỗng
      let pdf = null;
      try {
        const dv = rt.app.db.get('SELECT id FROM don_vi_van_chuyen ORDER BY id LIMIT 1');
        if (dv) {
          const res = await rt.dispatch('export.statementPdf', { filter: { don_vi_id: dv.id } });
          if (!res.ok) problems.push('xuất PDF lỗi: ' + res.error);
          else {
            const buf = fs.readFileSync(res.data.path);
            pdf = { bytes: buf.length, header: buf.subarray(0, 5).toString('latin1') };
            if (pdf.header !== '%PDF-' || pdf.bytes < 2000) problems.push('PDF không hợp lệ: ' + JSON.stringify(pdf));
          }
        }
      } catch (e) { problems.push('xuất PDF ngoại lệ: ' + (e && e.message)); }
      // Sao lưu → Khôi phục thật trên bản đóng gói (đổi tên tệp, WAL/SHM, mở lại): số liệu phải giữ nguyên, DB đọc/ghi được sau đó
      let backup = null;
      try {
        const before = rt.app.db.get('SELECT COUNT(*) n FROM phieu_can').n;
        const b = await rt.dispatch('backup.now', {});
        if (!b.ok) problems.push('sao lưu lỗi: ' + b.error);
        else {
          const x = await rt.dispatch('backup.restore', { file: b.data.file });
          if (!x.ok) problems.push('khôi phục lỗi: ' + x.error);
          else {
            const after = rt.app.db.get('SELECT COUNT(*) n FROM phieu_can').n;
            rt.app.db.run(`INSERT INTO audit_log(action, entity) VALUES ('SMOKE_RESTORE','smoke')`);
            backup = { before, after, safety: !!x.data.safetyBackup };
            if (before !== after) problems.push(`khôi phục làm đổi số phiếu: ${before} → ${after}`);
          }
        }
      } catch (e) { problems.push('sao lưu/khôi phục ngoại lệ: ' + (e && e.message)); }
      // Nghiệm thu trên bản đóng gói: xử lý trùng (nhập lại file mẫu), xuất Excel, chốt kỳ, toàn vẹn, nâng cấp từ bản cũ
      const acc = {};
      try {
        const upFrom = process.env.VCCOST_EXPECT_UPGRADE_FROM ? Number(process.env.VCCOST_EXPECT_UPGRADE_FROM) : null;
        acc.dataDir = rt.dirs.dataDir; acc.dbFile = rt.dirs.db; acc.migration = initial.migration; acc.backups = initial.backups;
        if (upFrom !== null) {
          if (initial.migration.from !== upFrom) problems.push(`nâng cấp: DB phải khởi đầu ở v${upFrom}, thực tế v${initial.migration.from}`);
          if (!acc.backups.includes('PRE_MIGRATION')) problems.push('nâng cấp: thiếu bản sao PRE_MIGRATION');
          const exp = Number(process.env.VCCOST_EXPECT_PHIEU || 0);
          if (rt.app.db.get('SELECT COUNT(*) n FROM phieu_can').n !== exp) problems.push(`nâng cấp: số phiếu sau nâng cấp khác ${exp}`);
          if (rt.app.db.get(`SELECT COUNT(*) n FROM audit_log WHERE action='BAN_CU'`).n !== 1) problems.push('nâng cấp: mất dòng audit của bản cũ');
        } else {
          const seed = path.join(__dirname, '..', 'data', 'seed', 'Tong-hop-chi-phi-VC-V47.xlsx');
          const o = await rt.dispatch('import.open', { filePath: seed }); const si = await rt.dispatch('import.sheetInfo', { token: o.data.token, sheetName: o.data.suggestedSheet });
          const dot = rt.app.db.get('SELECT id FROM dot_van_chuyen LIMIT 1');
          const pv = await rt.dispatch('import.preview', { token: o.data.token, sheetName: si.data.sheetName, headerRow: si.data.headerRow, mapping: si.data.mapping, dotId: dot ? dot.id : null });
          const cm = await rt.dispatch('import.commit', { token: o.data.token });
          acc.reimport = { exact: pv.data.counts.exact, new: pv.data.counts.new, inserted: cm.data && cm.data.inserted };
          if (!cm.ok || cm.data.inserted !== 0 || pv.data.counts.exact !== 2035) problems.push('nhập lại file mẫu phải ra 2035 phiếu trùng hoàn toàn và 0 phiếu mới: ' + JSON.stringify(acc.reimport));
          const dv = rt.app.db.get('SELECT id FROM don_vi_van_chuyen ORDER BY id LIMIT 1');
          const x = await rt.dispatch('export.statement', { filter: { don_vi_id: dv.id, da_tinh_gia: true } });
          if (!x.ok) problems.push('xuất Excel lỗi: ' + x.error);
          else { const b = fs.readFileSync(x.data.path); acc.xlsx = { bytes: b.length, header: b.subarray(0, 2).toString('latin1') }; if (acc.xlsx.header !== 'PK' || b.length < 3000) problems.push('Excel không hợp lệ: ' + JSON.stringify(acc.xlsx)); }
          // Quy trình duyệt trên chính bản đóng gói: Nháp vẫn ở màn nhập, chứng từ chỉ có phiếu đã duyệt.
          const ticket = rt.app.db.get(`SELECT * FROM phieu_can WHERE trang_thai='ACTIVE' AND trang_thai_tinh_gia='OK' LIMIT 1`);
          await rt.dispatch('settings.set', { key: 'duyet_phieu', value: { bat: true } });
          const changed = await rt.dispatch('tickets.update', { id: ticket.id, data: { xe_tra_ve: ticket.xe_tra_ve ? 0 : 1 }, note: 'Nghiệm thu duyệt lại' });
          if (!changed.ok) throw new Error(changed.error);
          const draftFilter = { trang_thai_duyet: 'NHAP', moi_trang_thai: true, don_vi_id: ticket.don_vi_van_chuyen_id };
          const draftBill = await rt.dispatch('reports.statement', draftFilter);
          const draftCount = await rt.dispatch('tickets.count', { filter: draftFilter });
          if (!draftBill.ok || draftBill.data.so_chuyen !== 0 || draftCount.data.kept !== 1) problems.push('Phiếu Nháp lọt báo cáo hoặc mất khỏi màn nhập');
          const approved = await rt.dispatch('tickets.approve', { ids: [ticket.id], note: 'Đã kiểm tra bộ cài' });
          if (!approved.ok || approved.data.ok !== 1) problems.push('Duyệt phiếu trên bộ cài thất bại');
          await rt.dispatch('settings.set', { key: 'duyet_phieu', value: { bat: false } });
          acc.approval = { draftTripsInStatement: draftBill.data && draftBill.data.so_chuyen, draftVisible: draftCount.data && draftCount.data.kept, approved: approved.data && approved.data.ok };
          const lk = await rt.dispatch('lock.create', { loai: 'KY', tu_ngay: '2026-09-28', den_ngay: '2026-10-01' });
          if (!lk.ok) problems.push('chốt kỳ lỗi: ' + lk.error); else acc.chot = { so_phieu: lk.data.so_phieu };
          const lst = await rt.dispatch('lock.list', {}); if (!lst.ok || !lst.data.length) problems.push('danh sách kỳ chốt rỗng sau khi chốt');
        }
        const ig = await rt.dispatch('system.integrity', {}); acc.integrity = ig.ok ? { ok: ig.data.ok, loi: ig.data.loi } : null;
        if (!ig.ok || (upFrom === null && !ig.data.ok)) problems.push('kiểm tra toàn vẹn: ' + (ig.ok ? JSON.stringify(ig.data.checks.filter((c) => c.severity === 'LOI' && c.count).map((c) => c.id)) : ig.error));
      } catch (e) { problems.push('nghiệm thu ngoại lệ: ' + (e && e.message)); }
      finish(problems.length === 0, { version: app.getVersion(), platform: process.platform, electron: process.versions.electron, title: r.title, driver: d && d.driver, schema: d && d.schema, counts: d && d.counts, viewChildren: r.viewChildren, pdf, backup, acc, problems });
    } catch (e) { finish(false, { error: String(e && e.stack || e) }); }
  });
  win.webContents.once('did-fail-load', (_e, code, desc) => finish(false, { error: `did-fail-load ${code} ${desc}` }));
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const w = where();
  if (w.missing) {
    // Thư mục đã chọn không còn (rút USB…): không tạo CSDL trắng — hỏi người dùng
    const r = dialog.showMessageBoxSync({ type: 'error', title: 'VC Cost', message: `Không tìm thấy thư mục dữ liệu:\n${w.dir}`, detail: 'Cắm lại ổ đĩa/USB rồi mở lại, hoặc quay về thư mục mặc định (dữ liệu trong thư mục cũ vẫn được giữ nguyên).',
      buttons: ['Thoát', 'Dùng thư mục mặc định'], defaultId: 0, cancelId: 0 });
    if (r === 0) return app.quit();
    loc.writeCustom(w.bootstrapDir, null); return relaunch();
  }
  const renderPdf = async (html) => {
    const tmp = path.join(app.getPath('temp'), `vccost-print-${Date.now()}.html`);
    fs.writeFileSync(tmp, html, 'utf8');
    const pw = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, javascript: false } });
    try {
      await pw.loadFile(tmp);
      return await pw.webContents.printToPDF(require('../src/print/pdfOptions').pdfOptions());
    } finally { pw.destroy(); try { fs.unlinkSync(tmp); } catch { /* bỏ qua */ } }
  };
  try {
    rt = createRuntime({ dataDir: w.dir, version: app.getVersion(), autoInit: true, renderPdf });
  } catch (e) {
    // Không mở được CSDL (thiếu module native, file hỏng…): báo rõ thay vì treo không cửa sổ
    if (process.env.VCCOST_SMOKE) return smokeFail('createRuntime: ' + (e && e.stack || e));
    dialog.showErrorBox('VC Cost', `Không khởi động được cơ sở dữ liệu:\n${e && e.message}\n\nThư mục dữ liệu: ${w.dir}`);
    return app.exit(1);
  }
  ipcMain.handle('storage.info', () => ({ current: w.dir, default: w.defaultDir, source: w.source, size: dirSize(w.dir) }));
  ipcMain.handle('dialog.pickFolder', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: 'Chọn thư mục' }); return r.canceled ? null : r.filePaths[0]; });
  ipcMain.handle('storage.change', (_e, { target, mode }) => {
    { const u = rt.session.get(); if (rt.app.auth.enabled() && !(u && u.vai_tro === 'ADMIN')) return { ok: false, error: 'Chỉ quản trị mới đổi được thư mục lưu trữ' }; }
    if (w.source === 'ENV') return { ok: false, error: 'Thư mục đang bị cố định bởi biến môi trường VCCOST_DATA_DIR' };
    const target_ = target === null ? w.defaultDir : target;
    const m = target === null ? 'USE' : mode;
    const v = loc.validateTarget({ current: w.dir, target: target_, mode: m });
    if (!v.ok) return v;
    let closed = false;
    try {
      if (m === 'COPY') { rt.backup.backupNow('MANUAL', 'Trước khi đổi thư mục lưu trữ'); rt.close(); closed = true; loc.copyData(w.dir, target_); }
      loc.writeCustom(w.bootstrapDir, target === null ? null : path.resolve(target_));
    } catch (e) { if (closed) setTimeout(relaunch, 800); /* DB đã đóng → mở lại app, vẫn dùng thư mục cũ */ return { ok: false, error: e.message + (closed ? ' — ứng dụng sẽ tự khởi động lại và vẫn dùng thư mục cũ.' : '') }; }
    setTimeout(relaunch, 600);
    return { ok: true, target: target_, note: m === 'COPY' ? 'Đã chép dữ liệu. Thư mục cũ được giữ nguyên để bạn tự xóa khi chắc chắn.' : '' };
  });
  ipcMain.handle('api', (_e, channel, args) => rt.dispatch(channel, args));
  ipcMain.handle('dialog.openFile', async (_e, { filters } = {}) => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: filters || [{ name: 'Excel (.xlsx) / CSV', extensions: ['xlsx', 'csv'] }] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('dialog.saveExport', async (_e, { path: src, fileName }) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: fileName, filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
    if (r.canceled) return null;
    // Chỉ chép file do chính app xuất ra (thư mục exports) — giao diện không được dùng kênh này để đọc file bất kỳ.
    if (!isInside(rt.dirs.exports, src) || !fs.existsSync(src)) throw new Error('Đường dẫn file xuất không hợp lệ');
    fs.copyFileSync(src, r.filePath);
    return r.filePath;
  });
  ipcMain.handle('shell.showItem', (_e, p) => shell.showItemInFolder(p));
  createWindow();
  if (process.env.VCCOST_SMOKE) runSmoke();
});

app.commandLine.appendSwitch('lang', 'vi'); // ô chọn ngày hiển thị dd/mm/yyyy
app.on('window-all-closed', () => { if (rt) rt.close(); app.quit(); });
