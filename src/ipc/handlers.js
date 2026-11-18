'use strict';
/**
 * Bảng kênh API duy nhất giữa giao diện và backend.
 * Electron: ipcMain.handle('api', (e, channel, args) => handlers[channel](args))
 * Dev server: POST /api/<channel>  (cùng handlers → kiểm thử UI ngoài Electron)
 */
const fs = require('fs');
const path = require('path');
const { CATALOGS } = require('../models/catalogs');
const { ALERT_DEF } = require('../services/AlertService');
const exporters = require('../excel/exporters');
const documents = require('../print/documents');
const templates = require('../print/htmlTemplates');
const forms = require('../print/forms');
const formHtml = require('../print/formHtml');
const formXlsx = require('../excel/forms');

/** Cờ mở rộng là nội bộ; trạng thái lọc vẫn được giữ để báo cáo giao với phạm vi Đã duyệt. */
const stripScope = (channel, args) => {
  const clean = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const out = { ...value }; delete out.moi_trang_thai; return out;
  };
  const out = clean(args);
  if (out && out.filter) out.filter = clean(out.filter);
  return out;
};

function createHandlers(app, env = {}) {
  const { exportsDir = null, importsDir = null, seedDir = null, backup = null } = env;
  const { duyetBat } = require('../utils/duyet');
  const allStates = (f) => ({ moi_trang_thai: true, ...(f || {}) });   // Phiếu cân thấy cả phiếu Nháp (trừ khi lọc theo trạng thái duyệt)
  const session = env.session || { get: () => null, set: () => {} };
  const { ROLE_PERMS, ROLE_LABEL } = require('../utils/permissions');
  const authStatus = () => { const u = session.get(); return { enabled: app.auth.enabled(), user: u ? { id: u.id, ten_dang_nhap: u.ten_dang_nhap, ho_ten: u.ho_ten, vai_tro: u.vai_tro } : null, perms: u ? ROLE_PERMS[u.vai_tro] : [], roles: ROLE_LABEL }; };
  const actor = () => { const u = session.get(); return u ? u.id : null; };
  const saveImportCopy = (buf, name) => {
    if (!importsDir || !buf) return null;
    fs.mkdirSync(importsDir, { recursive: true });
    const p = path.join(importsDir, `${new Date().toISOString().replace(/[:.]/g, '-')}_${name}`);
    fs.writeFileSync(p, buf);
    return p;
  };
  const writeExport = (wbBuffer, name) => {
    if (!exportsDir) return { base64: Buffer.from(wbBuffer).toString('base64'), fileName: name };
    fs.mkdirSync(exportsDir, { recursive: true });
    const p = path.join(exportsDir, name);
    fs.writeFileSync(p, Buffer.from(wbBuffer));
    return { path: p, fileName: name };
  };
  const writePdf = async (html, name, opt = {}) => {
    if (!env.renderPdf) throw new Error('Xuất PDF chưa khả dụng trong môi trường này');
    const buf = await env.renderPdf(html, opt);
    return writeExport(buf, name);
  };
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

  const handlers = {
    // ---------------- hệ thống
    'app.info': () => ({ version: env.version || 'dev', dataDir: env.dataDir || null, driver: app.db.driver, schema: app.db.get('SELECT MAX(version) v FROM schema_version').v,
      counts: { phieu: app.db.get(`SELECT COUNT(*) n FROM phieu_can WHERE trang_thai='ACTIVE'`).n, xe: app.db.get('SELECT COUNT(*) n FROM xe').n },
      alertsOpen: app.alerts.countOpen(), pendingReviews: app.imports.pendingReviews().length,
      duyetBat: duyetBat(app.settings), choDuyet: app.db.get(`SELECT COUNT(*) n FROM phieu_can WHERE trang_thai='ACTIVE' AND trang_thai_duyet='NHAP'`).n }),
    'settings.all': () => app.settings.all(),
    'settings.set': ({ key, value }) => { app.settings.set(key, value); if (key === 'time_anomaly') app.cost.syncTimeAlerts(app.db.all('SELECT DISTINCT bien_so_chuan b FROM phieu_can').map((x) => x.b)); return { ok: true }; },
    'seed.loadSample': () => {
      const f = path.join(seedDir, 'sample-v47.json');
      return app.seed.load(JSON.parse(fs.readFileSync(f, 'utf8')));
    },
    'initial.load': () => require('../services/InitialDataService').loadInitialData(app, seedDir),
    'cost.recalc': (f) => app.cost.recalc(f || { all: true }),
    'audit.list': (f) => app.audit.list(f || {}),
    'alerts.list': (f) => app.alerts.list(f || {}),
    'alerts.setStatus': ({ id, status, note }) => app.alerts.setStatus(id, status, note),
    'alerts.types': () => ALERT_DEF,

    // ---------------- danh mục
    'catalog.config': () => CATALOGS,
    'catalog.list': ({ table, ...o }) => app.catalog.list(table, o),
    'catalog.get': ({ table, id }) => app.catalog.get(table, id),
    'catalog.options': ({ table }) => app.catalog.options(table),
    'catalog.create': ({ table, data, parentId }) => app.catalog.create(table, data, { parentId }),
    'catalog.update': ({ table, id, data }) => app.catalog.update(table, id, data),
    'catalog.remove': ({ table, id }) => app.catalog.remove(table, id),

    // ---------------- import phiếu cân
    'import.open': ({ filePath, base64, fileName }) => app.imports.open(base64 ? { buffer: Buffer.from(base64, 'base64'), fileName } : { filePath }),
    'import.check': ({ token, ...o }) => app.imports.check(token, o),
    'import.sheetInfo': ({ token, sheetName, headerRow }) => app.imports.sheetInfo(token, sheetName, headerRow),
    'import.preview': ({ token, ...o }) => app.imports.preview(token, o),
    'import.previewRows': ({ token, ...o }) => app.imports.previewRows(token, o),
    'import.commit': ({ token, ...o }) => {
      if (backup) backup.backupNow('PRE_IMPORT');
      const r = app.imports.commit(token, o);
      // Batch đã ghi xong: lỗi chép file nguồn chỉ là cảnh báo, không được báo như import thất bại
      let copy = null, copyWarning = null;
      try { copy = saveImportCopy(r.fileBuffer, r.fileName); } catch (e) { copyWarning = `Đã nhập xong nhưng không lưu được bản sao file nguồn: ${e.message}`; }
      delete r.fileBuffer;
      return { ...r, savedCopy: copy, copyWarning };
    },
    'import.issuesXlsx': async ({ token }) => {
      const rows = app.imports.issueRows(token);
      const { ISSUE_WARN } = require('../services/TicketImportService');
      return writeExport(await exporters.importIssuesWorkbook(rows, { fileName: app.imports._p(token).wb.fileName }, ISSUE_WARN), `DongCanXuLy_${stamp()}.xlsx`);
    },
    'import.cancel': ({ token }) => app.imports.cancel(token),
    'import.pending': () => app.imports.pendingReviews(),
    'import.resolve': ({ id, action, note }) => app.imports.resolveReview(id, action, note),
    'import.resolveMany': ({ ids, action, note, batchId }) => app.imports.resolveMany(ids, action, note, { batchId }),
    'import.batches': () => app.imports.listBatches(),
    'import.batchRows': ({ batchId, ...o }) => app.imports.batchRows(batchId, o),
    'import.undo': ({ batchId, reason }) => app.imports.undoBatch(batchId, reason),

    // ---------------- import danh mục xe
    'vehicles.importPreview': ({ filePath, base64, fileName, sheetName }) => app.vehicleImport.preview(base64 ? { buffer: Buffer.from(base64, 'base64'), fileName, sheetName } : { filePath, sheetName }),
    'vehicles.importCommit': ({ token, ...o }) => app.vehicleImport.commit(token, o),

    // ---------------- phiếu & báo cáo
    'workflow.todo': () => ({ ...app.reports.todo(), cho_xu_ly: app.imports.pendingReviews().length, canh_bao_mo: app.alerts.countOpen() }),
    'tickets.count': ({ filter, approvedOnly = false }) => app.reports.count(allStates(filter), { approvedOnly }),
    'tickets.periods': () => app.reports.periods(),
    'tickets.list': ({ filter, ...o }) => app.reports.tickets(allStates(filter), o),
    'tickets.ids': ({ filter }) => { const { sql, params } = app.reports.where(allStates(filter)); return app.db.all(`SELECT p.id FROM phieu_can p WHERE ${sql}`, params).map((r) => r.id); },
    'tickets.approve': ({ ids, note, vers }) => app.tickets.approve(ids, note, vers),
    'tickets.removePreview': ({ ids }) => app.tickets.removePreview(ids),
    'tickets.remove': ({ ids, reason }) => app.tickets.remove(ids, reason),
    'tickets.get': ({ id }) => app.tickets.get(id),
    'tickets.update': ({ id, data, note }) => app.tickets.update(id, data, note),
    'tickets.explain': ({ id }) => app.price.explainTicket(id),
    'reports.byVehicle': (f) => app.reports.byVehicle(f || {}),
    'reports.byCarrier': (f) => app.reports.byCarrier(f || {}),
    'reports.byOrigin': (f) => app.reports.byOrigin(f || {}),
    'reports.byDate': (f) => app.reports.byDate(f || {}),
    'reports.byDot': (f) => app.reports.byDot(f || {}),
    'reports.timeline': ({ bien_so, tu_ngay, den_ngay }) => app.reports.timeline(bien_so, { tu_ngay, den_ngay }),
    'reports.statement': (f) => app.reports.statement(f),
    'reports.statements': (f) => app.reports.statements(f || {}),
    'reports.dashboard': (f) => app.reports.dashboard(f || {}),

    // ---------------- đối chiếu
    'recon.open': ({ filePath, base64, fileName }) => app.recon.open(base64 ? { buffer: Buffer.from(base64, 'base64'), fileName } : { filePath }),
    'recon.sheetInfo': ({ token, sheetName, headerRow }) => app.recon.sheetInfo(token, sheetName, headerRow),
    'recon.run': ({ token, ...o }) => app.recon.run(token, o),
    'recon.batches': () => app.recon.batches(),
    'recon.results': ({ batchId, ...o }) => app.recon.results(batchId, o),
    'lock.list': () => app.lock.list(),
    'lock.preview': (o) => app.lock.preview(o),
    'lock.create': (o) => app.lock.lock(o),
    'lock.unlock': ({ id, reason }) => app.lock.unlock(Number(id), reason),
    'recon.weight': ({ batchId }) => app.recon.weightByVehicle(Number(batchId)),
    'recon.resolve': ({ id, xu_ly, note }) => app.recon.resolve(id, xu_ly, note),

    // ---------------- giá
    'price.fuelPeriods': () => app.price.listFuelPeriods(),
    'price.createFuelPeriod': (o) => app.price.createFuelPeriod(o),
    'price.previewFuel': ({ id }) => app.price.previewFuelPeriod(id),
    'price.approveFuel': ({ id }) => app.price.approveFuelPeriod(id),
    'price.createVersion': (o) => app.price.createVersion(o),
    'fuel.importPreview': ({ filePath, base64, fileName, sheetName }) => app.fuelImport.preview(base64 ? { buffer: Buffer.from(base64, 'base64'), fileName, sheetName } : { filePath, sheetName }),
    'fuel.importCommit': ({ token, overwrite }) => app.fuelImport.commit(token, { overwrite: !!overwrite }),
    'price.removeFuelPeriod': ({ id, recalc }) => app.price.removeFuelPeriod(id, { recalc: !!recalc }),
    'price.remove': ({ id, recalc }) => app.price.removeRule(id, { recalc: !!recalc }),
    'price.sheet': (o) => app.price.priceSheet(o || {}),
    'price.applySheet': (o) => app.price.applySheet(o),
    // xem trước đơn giá tự tính từ thông số (không ghi DB)
    'price.calc': (o) => {
      const n = (v) => (v === undefined || v === null || v === '' ? null : Number(String(v).replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')));
      try {
        const r = require('../services/FuelAdjustmentService').derivePrice({ phuong_thuc: o.phuong_thuc || 'CO_DINH', don_gia_goc: n(o.don_gia_goc), gia_dau_co_so: n(o.gia_dau_co_so),
          gia_dau_ap_dung: n(o.gia_dau_ap_dung), khoang_cach_km: n(o.khoang_cach_km), dinh_muc_dau: n(o.dinh_muc_dau), khoi_luong_binh_quan: n(o.khoi_luong_binh_quan) });
        return { ok: true, gia: r.appliedPrice, dieu_chinh: r.adjustment, breakdown: r.breakdown };
      } catch (e) { return { ok: false, message: e.message }; }
    },

    // ---------------- xuất Excel
    'template.tickets': async () => writeExport(await require('../excel/templates').ticketTemplate({ locations: app.db.all(`SELECT ten FROM dia_diem WHERE trang_thai='ACTIVE' ORDER BY ten`).map((x) => x.ten) }), 'MAU_Import_Phieu_can.xlsx'),
    'template.vehicles': async () => writeExport(await require('../excel/templates').vehicleTemplate({ carriers: app.db.all(`SELECT ma FROM don_vi_van_chuyen WHERE trang_thai='ACTIVE' ORDER BY ma`).map((x) => x.ma) }), 'MAU_Import_Danh_sach_xe.xlsx'),
    'export.tickets': async ({ filter }) => {
      const f = filter || {};
      const explicitState = f.trang_thai_duyet === 'NHAP' || f.trang_thai_duyet === 'DA_DUYET';
      const all = app.reports.tickets(explicitState ? allStates(f) : f, { offset: 0, limit: 10_000_000 });
      const nhapBoQua = explicitState ? 0 : app.reports.count({ ...f, trang_thai_duyet: 'NHAP' }).kept;
      return writeExport(await exporters.ticketsWorkbook(all, filter, { nhapBoQua, labels: documents.filterLabels(app, f) }), `ChiTietVanChuyen_${stamp()}.xlsx`);
    },

    // Bảng kê (Excel in/ký + PDF) và báo cáo tổng hợp
    'export.statement': async ({ filter, reconBatchId }) => { const d = documents.statementDoc(app, filter || {}, { reconBatchId }); return writeExport(await exporters.statementWorkbook(d), `${d.file}_${stamp()}.xlsx`); },
    'export.statementPdf': async ({ filter, reconBatchId }) => { const d = documents.statementDoc(app, filter || {}, { reconBatchId }); return writePdf(templates.statementHtml(d), `${d.file}_${stamp()}.pdf`); },
    'export.report': async ({ kind, filter }) => { const d = documents.reportDoc(app, kind, filter || {}); return writeExport(await exporters.reportWorkbook(d), `${d.file}_${stamp()}.xlsx`); },
    'export.reportPdf': async ({ kind, filter }) => { const d = documents.reportDoc(app, kind, filter || {}); return writePdf(templates.reportHtml(d), `${d.file}_${stamp()}.pdf`, { landscape: true }); },
    'export.timeline': async ({ bien_so, tu_ngay, den_ngay }) => writeExport(await exporters.timelineWorkbook(bien_so, app.reports.timeline(bien_so, { tu_ngay, den_ngay }), { tu_ngay, den_ngay }), `ChiTietXe_${bien_so}_${stamp()}.xlsx`),

    'export.priceSheet': async (o) => {
      const d = forms.priceDoc(app, o || {});
      const ExcelJS = require('exceljs'); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await exporters.priceSheetWorkbook(d.sh, { benA: d.benA, benB: d.benB }));
      wb.worksheets[0].name = 'Bảng tổng hợp'; formXlsx.addPriceSheets(wb, d);
      return writeExport(Buffer.from(await wb.xlsx.writeBuffer()), `${d.file}_${stamp()}.xlsx`);
    },
    'export.priceSheetPdf': async (o) => { const d = forms.priceDoc(app, o || {}); return writePdf(formHtml.priceHtml(d), `${d.file}_${stamp()}.pdf`); },
    // 2 biểu mẫu ký hai bên: Tổng hợp xuất hàng tàu, Chi tiết vận chuyển (từng xe)
    'export.tauSummary': async ({ filter }) => { const d = forms.tauSummaryDoc(app, filter || {}); return writeExport(await formXlsx.tauSummaryWorkbook(d), `${d.file}_${stamp()}.xlsx`); },
    'export.tauSummaryPdf': async ({ filter }) => { const d = forms.tauSummaryDoc(app, filter || {}); return writePdf(formHtml.tauSummaryHtml(d), `${d.file}_${stamp()}.pdf`); },
    'export.detail': async ({ filter }) => { const d = forms.detailDoc(app, filter || {}); return writeExport(await formXlsx.detailWorkbook(d), `${d.file}_${stamp()}.xlsx`); },
    'export.detailPdf': async ({ filter }) => { const d = forms.detailDoc(app, filter || {}); return writePdf(formHtml.detailHtml(d), `${d.file}_${stamp()}.pdf`); },
    'forms.preview': ({ filter }) => {
      const t = forms.tauSummaryDoc(app, filter || {}), d = forms.detailDoc(app, filter || {});
      return { period: t.period.text, tau: t.sections.map((s) => ({ don_vi: s.don_vi, noi_xuat: s.noi_xuat, xe: s.tot.xe, so_chuyen: s.tot.so_chuyen, kg: s.tot.kg, tong: Math.round(s.tot.tong) })),
        detail: d.sections.map((s) => ({ don_vi: s.don_vi, xe: s.tot.xe, so_chuyen: s.tot.so_chuyen, kg: s.tot.kg, chuaTinh: s.tot.chuaTinh })) };
    },
    'export.recon': async ({ batchId }) => {
      const b = app.db.get('SELECT * FROM doi_chieu_batch WHERE id=?', [batchId]);
      return writeExport(await exporters.reconWorkbook(b, app.recon.results(batchId, { limit: 10_000_000 }).rows), `DoiChieu_${batchId}_${stamp()}.xlsx`);
    },

    // ---------------- backup
    'system.integrity': () => app.integrity.check(),
    'backup.list': () => (backup ? backup.list() : []),
    'backup.now': () => (backup ? backup.backupNow('MANUAL') : null),
    'backup.restore': ({ file }) => (backup ? backup.restore(file) : null),
    // ---------------- phân quyền
    'auth.status': () => authStatus(),
    'auth.login': ({ ten_dang_nhap, mat_khau }) => { session.set(app.auth.login(ten_dang_nhap, mat_khau)); return authStatus(); },
    'auth.logout': () => { session.set(null); return authStatus(); },
    'auth.me': () => authStatus(),
    'auth.enable': (o) => { session.set(app.auth.enable(o)); return authStatus(); },
    'auth.disable': ({ mat_khau }) => { app.auth.disable(actor(), mat_khau); session.set(null); return authStatus(); },
    'auth.users': () => app.auth.list(),
    'auth.createUser': (o) => app.auth.createUser(actor(), o),
    'auth.updateUser': ({ id, ...patch }) => app.auth.updateUser(actor(), id, patch),
    'auth.resetPassword': ({ id, mat_khau }) => app.auth.resetPassword(actor(), id, mat_khau),
    'auth.changePassword': ({ cu, moi }) => { if (!actor()) throw new Error('Chưa bật phân quyền / chưa đăng nhập'); app.auth.changeOwnPassword(actor(), cu, moi); return { ok: true }; },
    'backup.export': ({ file, dir }) => (backup ? backup.exportTo(file, dir) : null),
  };
  return Object.fromEntries(Object.entries(handlers).map(([ch, fn]) => [ch, (args, ...rest) => fn(stripScope(ch, args), ...rest)]));
}

module.exports = { createHandlers };
