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
const { ValidationError } = require('../services/CatalogService');
const { joinInside } = require('../utils/safePath');
const { fromDb } = require('../utils/dbMoney');
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

/** Bảng giá chỉ đổi thông số qua "Phiên bản giá mới" (price.createVersion): đóng giá cũ đến ngày X−1, mở giá mới từ X, tính lại phiếu bị ảnh hưởng. */
const PRICE_TABLE = 'bang_gia_van_chuyen';
const PRICE_EDITABLE = ['ghi_chu', 'trang_thai'];

function createHandlers(app, env = {}) {
  const { exportsDir = null, importsDir = null, seedDir = null, backup = null } = env;
  const { duyetBat, duyetTuDuyet, ConfirmRequired, coQuyenDuyet, soNguoiDuyet, canhBaoNguoiDuyet } = require('../utils/duyet');
  const allStates = (f) => ({ moi_trang_thai: true, ...(f || {}) });   // Phiếu cân thấy cả phiếu Nháp (trừ khi lọc theo trạng thái duyệt)
  const session = env.session || { get: () => null, set: () => {} };
  const { ROLE_PERMS, ROLE_LABEL, CHANNEL_PERM, TABLE_PERM } = require('../utils/permissions');
  const authStatus = () => { const u = session.get(); return { enabled: app.auth.enabled(), user: u ? { id: u.id, ten_dang_nhap: u.ten_dang_nhap, ho_ten: u.ho_ten, vai_tro: u.vai_tro } : null, perms: u ? ROLE_PERMS[u.vai_tro] : [], roles: ROLE_LABEL,
    // nguồn quyền duy nhất là utils/permissions.js; giao diện chỉ ĐỌC để ẩn/hiện nút, máy chủ vẫn là nơi quyết định
    channelPerm: Object.fromEntries(CHANNEL_PERM), tablePerm: TABLE_PERM }; };
  const actor = () => { const u = session.get(); return u ? u.id : null; };
  const saveImportCopy = (buf, name) => {
    if (!importsDir || !buf) return null;
    fs.mkdirSync(importsDir, { recursive: true });
    const p = joinInside(importsDir, `${new Date().toISOString().replace(/[:.]/g, '-')}_${name}`).replace(/[. ]+$/, '');   // fileName do người dùng đưa: không cho thoát khỏi thư mục imports
    fs.writeFileSync(p, buf);
    return p;
  };
  const writeExport = (wbBuffer, name) => {
    if (!exportsDir) return { base64: Buffer.from(wbBuffer).toString('base64'), fileName: name };
    fs.mkdirSync(exportsDir, { recursive: true });
    const p = joinInside(exportsDir, name);   // tên tệp dựng từ tham số (biển số, mã đợt…): không cho thoát khỏi thư mục exports
    fs.writeFileSync(p, Buffer.from(wbBuffer));
    return { path: p, fileName: path.basename(p) };
  };
  const writePdf = async (html, name, opt = {}) => {
    if (!env.renderPdf) throw new Error('Xuất PDF chưa khả dụng trong môi trường này');
    const buf = await env.renderPdf(html, opt);
    return writeExport(buf, name);
  };
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

  /**
   * Sửa ghi chú/trạng thái bảng giá. Đưa bảng giá ĐANG DÙNG ra khỏi ACTIVE làm các phiếu chưa chốt được tính lại (có thể thành "Chưa có đơn giá")
   * → phải xác nhận (ConfirmRequired, cùng mức cảnh báo với nút Xóa bảng giá). Khi bật duyệt phiếu: phiếu ĐÃ DUYỆT đổi tổng tiền được ghi audit
   * PRICE_RECALC_APPROVED và mở cảnh báo ở Trung tâm cảnh báo (không tự đưa phiếu về Nháp).
   */
  const deactivatePrice = (id, data, xac_nhan) => app.db.tx(() => {
    const rule = app.db.get(`SELECT * FROM ${PRICE_TABLE} WHERE id=?`, [id]);
    const leaving = rule && rule.trang_thai === 'ACTIVE' && data && data.trang_thai !== undefined && data.trang_thai !== 'ACTIVE';
    const used = leaving ? app.db.all(`SELECT id, so_phieu, tong_tien, trang_thai_duyet, chot_ky_id FROM phieu_can WHERE bang_gia_id=? AND trang_thai='ACTIVE'`, [id]) : [];
    if (!used.length) return app.catalog.update(PRICE_TABLE, id, data);
    const open = used.filter((t) => !t.chot_ky_id); const locked = used.length - open.length;
    if (!xac_nhan) {
      throw new ConfirmRequired(`Bảng giá ${rule.ma_bang_gia} đang được ${used.length} phiếu sử dụng. Đổi trạng thái sang "${data.trang_thai === 'INACTIVE' ? 'Ngừng' : data.trang_thai}" sẽ tính lại ${open.length} phiếu chưa chốt — `
        + `phiếu không còn bảng giá hiệu lực khác sẽ thành "Chưa có đơn giá"${locked ? `; ${locked} phiếu đã chốt kỳ giữ nguyên` : ''}. Muốn mở lại bảng giá cũ liền trước thì dùng nút 🗑 Xóa bảng giá. Vẫn tiếp tục?`);
    }
    const approvedBefore = new Map(open.filter((t) => t.trang_thai_duyet === 'DA_DUYET').map((t) => [t.id, t.tong_tien]));
    const out = app.catalog.update(PRICE_TABLE, id, data);
    const ids = open.map((t) => t.id);
    if (ids.length) app.cost.recalc({ ids });      // chắc chắn tính lại đúng các phiếu vừa dùng bảng giá này
    if (duyetBat(app.settings) && approvedBefore.size) {
      const changed = [...approvedBefore].map(([tid, truoc]) => ({ tid, truoc, sau: app.db.get('SELECT tong_tien FROM phieu_can WHERE id=?', [tid]).tong_tien })).filter((x) => x.truoc !== x.sau);
      if (changed.length) {
        const sum = (k) => fromDb(changed.reduce((a, x) => a + (Number(x[k]) || 0), 0));
        const info = { ma_bang_gia: rule.ma_bang_gia, so_phieu: changed.length, tong_truoc: sum('truoc'), tong_sau: sum('sau'), phieu_ids: changed.slice(0, 200).map((x) => x.tid) };
        app.audit.log('PRICE_RECALC_APPROVED', PRICE_TABLE, id, { tong_tien: info.tong_truoc, so_phieu: info.so_phieu }, { tong_tien: info.tong_sau, trang_thai: data.trang_thai }, `Đổi trạng thái bảng giá ${rule.ma_bang_gia}: ${info.so_phieu} phiếu đã duyệt đổi tổng tiền`);
        app.alerts.open('PRICE_RECALC_APPROVED', PRICE_TABLE, id, info, `${info.so_phieu} phiếu ĐÃ DUYỆT đổi tổng tiền do đổi trạng thái bảng giá ${rule.ma_bang_gia}`);
      }
    }
    return out;
  });

  const handlers = {
    // ---------------- hệ thống
    'app.info': () => ({ version: env.version || 'dev', dataDir: env.dataDir || null, driver: app.db.driver, schema: app.db.get('SELECT MAX(version) v FROM schema_version').v,
      counts: { phieu: app.db.get(`SELECT COUNT(*) n FROM phieu_can WHERE trang_thai='ACTIVE'`).n, xe: app.db.get('SELECT COUNT(*) n FROM xe').n },
      alertsOpen: app.alerts.countOpen(), pendingReviews: app.imports.pendingReviews().length,
      duyetBat: duyetBat(app.settings), choDuyet: app.db.get(`SELECT COUNT(*) n FROM phieu_can WHERE trang_thai='ACTIVE' AND trang_thai_duyet='NHAP'`).n }),
    'settings.all': () => app.settings.all(),
    'settings.set': ({ key, value, xac_nhan }) => {
      // Bật duyệt phiếu (hoặc tắt "cho tự duyệt") khi đã bật phân quyền mà còn < 2 người có quyền duyệt → phiếu có thể kẹt ở Nháp: hỏi xác nhận
      if (key === 'duyet_phieu' && value && value.bat === true && !xac_nhan && (!duyetBat(app.settings) || duyetTuDuyet(app.settings))) {
        const m = canhBaoNguoiDuyet({ duyetBat: true, phanQuyen: app.auth.enabled(), tuDuyet: !!value.cho_tu_duyet, soSau: soNguoiDuyet(app.db), ngu_canh: 'khi bật duyệt phiếu' });
        if (m) throw new ConfirmRequired(m);
      }
      // Kỳ cũ chỉ có snapshot phiếu và tổng, nên đổi quy tắc có thể làm mất khả năng lập lại chi tiết.
      if (key === 'rounding' && !xac_nhan) {
        const n = app.db.get(`SELECT COUNT(*) n FROM chot_ky WHERE trang_thai='DA_CHOT' AND statements_json IS NULL`).n;
        if (n > 0 && JSON.stringify(value) !== JSON.stringify(app.settings.get('rounding'))) {
          throw new ConfirmRequired(`Đang có ${n} kỳ/đợt đã chốt theo phiên bản cũ. Sau khi đổi làm tròn, có thể cần chứng từ gốc để đối chiếu các kỳ này. Vẫn đổi?`);
        }
      }
      // Đổi căn cứ ngày tính giá (cân 1 ↔ cân 2) làm phiếu XUYÊN ĐÊM đổi bảng giá/đơn vị áp dụng → hỏi xác nhận (nêu số phiếu), rồi tính lại
      // các phiếu chưa chốt; phiếu đã chốt kỳ giữ nguyên số đã chốt.
      if (key === 'ngay_can_cu_gia') {
        const cur = app.settings.get('ngay_can_cu_gia') || 'CAN_1';
        if (value !== cur && (value === 'CAN_1' || value === 'CAN_2')) {
          const rows = app.db.all(`SELECT id, chot_ky_id FROM phieu_can WHERE trang_thai='ACTIVE' AND ngay_gio_can_2 IS NOT NULL AND substr(ngay_gio_can_1,1,10) <> substr(ngay_gio_can_2,1,10)`);
          const open = rows.filter((r) => !r.chot_ky_id).map((r) => r.id); const locked = rows.length - open.length;
          if (open.length && !xac_nhan) {
            throw new ConfirmRequired(`Đổi căn cứ tính giá sang "${value === 'CAN_2' ? 'ngày cân lần 2' : 'ngày cân lần 1'}" ảnh hưởng ${open.length} phiếu xuyên đêm chưa chốt: bảng giá và đơn vị áp dụng được xác định lại theo ngày mới và các phiếu này sẽ được tính lại ngay${locked ? `; ${locked} phiếu đã chốt kỳ giữ nguyên` : ''}. Bảng kê vẫn lọc theo ngày cân lần 1. Tiếp tục?`);
          }
          app.db.tx(() => {
            app.settings.set(key, value);
            if (open.length) app.cost.recalc({ ids: open });
            app.audit.log('SETTING_PRICE_BASIS', 'settings', null, { ngay_can_cu_gia: cur }, { ngay_can_cu_gia: value, so_phieu_tinh_lai: open.length, so_phieu_da_chot_giu_nguyen: locked });
          });
          return { ok: true, tinh_lai: open.length };
        }
      }
      app.settings.set(key, value); if (key === 'time_anomaly') app.cost.syncTimeAlerts(app.db.all('SELECT DISTINCT bien_so_chuan b FROM phieu_can').map((x) => x.b)); return { ok: true }; },
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
    'catalog.create': ({ table, data, parentId }) => {
      if (table === PRICE_TABLE) throw new ValidationError('Không thêm bảng giá trực tiếp — dùng "+ Phiên bản giá mới" (Bảng giá) để đóng giá cũ và mở giá mới đúng ngày hiệu lực');
      return app.catalog.create(table, data, { parentId });
    },
    'catalog.update': ({ table, id, data, xac_nhan }) => {
      if (table !== PRICE_TABLE) return app.catalog.update(table, id, data);
      const bad = Object.keys(data || {}).filter((k) => !PRICE_EDITABLE.includes(k));
      if (bad.length) throw new ValidationError(`Bảng giá chỉ sửa được ghi chú và trạng thái (không sửa: ${bad.join(', ')}). Muốn đổi thông số giá, dùng "+ Phiên bản giá mới"`);
      return deactivatePrice(id, data, xac_nhan);
    },
    'catalog.remove': ({ table, id }) => app.catalog.remove(table, id),

    // ---------------- import phiếu cân
    'import.templates.update': (options) => app.imports.updateTemplate(options),
    'import.open': ({ filePath, base64, fileName, sample }) => app.imports.open({ filePath, buffer: base64 ? Buffer.from(base64, 'base64') : null, fileName, sample, background: true }),
    'import.batchRead': ({ batchId, filePath, base64, fileName }) => app.imports.readBatch(batchId, { filePath, buffer: base64 ? Buffer.from(base64, 'base64') : null, fileName }),
    'import.check': ({ token, ...o }) => app.imports.check(token, o),
    'import.sheetInfo': ({ token, sheetName, headerRow, ...options }) => app.imports.sheetInfo(token, sheetName, headerRow, options),
    'import.preview': ({ token, ...o }) => app.imports.preview(token, o),
    'import.previewRows': ({ token, ...o }) => app.imports.previewRows(token, o),
    'import.commit': ({ token, ...o }) => {
      let pre = null;
      if (backup) pre = backup.backupNow('PRE_IMPORT');            // sao lưu lỗi → ném lỗi → import bị chặn (giữ hành vi an toàn)
      let r;
      try { r = app.imports.commit(token, o); }
      catch (e) {
        // commit chạy trong một giao dịch nên lỗi = chưa ghi gì; bản PRE_IMPORT vừa tạo KHÔNG được dùng để khôi phục
        if (env.log) env.log(`Import thất bại (${e.message}): bản sao lưu PRE_IMPORT ${pre && (pre.file || pre.name) ? `(${pre.file || pre.name}) ` : ''}không được dùng — chưa có dữ liệu nào bị ghi`);
        throw e;
      }
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
    'import.pendingGroups': () => app.imports.pendingGroups(),
    'import.resolve': ({ id, action, note }) => app.imports.resolveReview(id, action, note),
    'import.resolveMany': ({ ids, action, note, batchId }) => app.imports.resolveMany(ids, action, note, { batchId }),
    'import.batches': () => app.imports.listBatches(),
    'import.batchRows': ({ batchId, ...o }) => app.imports.batchRows(batchId, o),
    'import.undo': ({ batchId, reason }) => app.imports.undoBatch(batchId, reason),

    // ---------------- import danh mục xe
    'vehicles.quickAssign': ({ bien_so, don_vi_van_chuyen_id, tu_ngay = null }) => {
      if (!bien_so || !don_vi_van_chuyen_id) throw new ValidationError('Thiếu biển số hoặc đơn vị vận chuyển');
      const { normalizePlate, displayPlate } = require('../utils/plate');
      const chuan = normalizePlate(bien_so);
      return app.db.tx(() => {
        let xe = app.db.get('SELECT id FROM xe WHERE bien_so_chuan=?', [chuan]);
        if (!xe) {
          xe = app.catalog.create('xe', { bien_so_hien_thi: displayPlate(bien_so) });
        }
        app.catalog.create('xe_don_vi_lich_su', { don_vi_van_chuyen_id: Number(don_vi_van_chuyen_id), tu_ngay }, { parentId: xe.id });
        app.cost.recalc({ xeId: xe.id });
        return { ok: true, xeId: xe.id };
      });
    },
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
    'price.previewApply': (o) => app.price.previewApplySheet(o),
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
    'template.configuredTickets': async ({ id, rows }) => {
      const config = app.imports.templates().templates.find((item) => item.id === id);
      if (!config) throw new ValidationError('Mẫu nhập Excel không còn tồn tại');
      return writeExport(await require('../excel/templates').configuredTicketTemplate(config, { rows }), 'MAU_Phieu_can_Tuy_chinh.xlsx');
    },
    'template.tickets': async ({ rows } = {}) => writeExport(await require('../excel/templates').ticketTemplate({
      rows,
      locations: app.db.all(`SELECT ten FROM dia_diem WHERE trang_thai='ACTIVE' ORDER BY ten`).map((x) => x.ten),
      carriers: app.db.all(`SELECT ma FROM don_vi_van_chuyen WHERE trang_thai='ACTIVE' ORDER BY ma`).map((x) => x.ma),
    }), 'MAU_Import_Phieu_can.xlsx'),
    'template.vehicles': async ({ rows } = {}) => writeExport(await require('../excel/templates').vehicleTemplate({ rows, carriers: app.db.all(`SELECT ma FROM don_vi_van_chuyen WHERE trang_thai='ACTIVE' ORDER BY ma`).map((x) => x.ma) }), 'MAU_Import_Danh_sach_xe.xlsx'),
    'template.partner': async ({ rows } = {}) => writeExport(await require('../excel/templates').partnerTemplate({ rows }), 'MAU_Bang_ke_doi_tac.xlsx'),
    'template.fuel': async ({ rows } = {}) => writeExport(await require('../excel/templates').fuelTemplate({
      rows, fuelTypes: app.db.all('SELECT DISTINCT loai_dau FROM gia_dau ORDER BY loai_dau').map((x) => x.loai_dau),
    }), 'MAU_Import_Gia_dau.xlsx'),
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
    'auth.enable': ({ xac_nhan, bat_tu_duyet, ...o }) => {
      // Duyệt phiếu đã bật TRƯỚC khi bật phân quyền: sau khi bật chỉ có (các) quản trị → kiểm tra đủ người duyệt như khi bật duyệt phiếu
      if (duyetBat(app.settings) && !duyetTuDuyet(app.settings) && !app.auth.enabled()) {
        const ex = app.db.get('SELECT vai_tro, trang_thai FROM nguoi_dung WHERE ten_dang_nhap=?', [String(o.ten_dang_nhap || '')]);
        const soSau = soNguoiDuyet(app.db) + (ex && coQuyenDuyet(ex) ? 0 : 1);
        const m = canhBaoNguoiDuyet({ duyetBat: true, phanQuyen: true, tuDuyet: false, soSau, ngu_canh: 'khi bật phân quyền' });
        if (m && !xac_nhan && !bat_tu_duyet) throw new ConfirmRequired(m);
      }
      const u = app.auth.enable(o);
      // Chọn "bật luôn Cho phép tự duyệt" (chế độ 1 người có đăng nhập)
      if (bat_tu_duyet && duyetBat(app.settings)) app.settings.set('duyet_phieu', { ...app.settings.get('duyet_phieu'), bat: true, cho_tu_duyet: true });
      session.set(u); return authStatus();
    },
    'auth.disable': ({ mat_khau }) => { app.auth.disable(actor(), mat_khau); session.set(null); return authStatus(); },
    'auth.users': () => app.auth.list(),
    'auth.createUser': (o) => app.auth.createUser(actor(), o),
    'auth.updateUser': ({ id, xac_nhan, ...patch }) => {
      // Khóa/hạ quyền người duyệt làm số người duyệt còn < 2 khi đang bật duyệt phiếu (không cho tự duyệt) → hỏi xác nhận
      if (!xac_nhan) {
        const u = app.db.get('SELECT vai_tro, trang_thai FROM nguoi_dung WHERE id=?', [id]);
        const next = { vai_tro: patch.vai_tro !== undefined ? patch.vai_tro : u && u.vai_tro, trang_thai: patch.trang_thai !== undefined ? patch.trang_thai : u && u.trang_thai };
        if (u && coQuyenDuyet(u) && !coQuyenDuyet(next)) {
          const m = canhBaoNguoiDuyet({ duyetBat: duyetBat(app.settings), phanQuyen: app.auth.enabled(), tuDuyet: duyetTuDuyet(app.settings), soSau: soNguoiDuyet(app.db) - 1, ngu_canh: 'thay đổi này' });
          if (m) throw new ConfirmRequired(m);
        }
      }
      return app.auth.updateUser(actor(), id, patch);
    },
    'auth.resetPassword': ({ id, mat_khau }) => app.auth.resetPassword(actor(), id, mat_khau),
    'auth.changePassword': ({ cu, moi }) => { if (!actor()) throw new Error('Chưa bật phân quyền / chưa đăng nhập'); app.auth.changeOwnPassword(actor(), cu, moi); return { ok: true }; },
    'backup.export': ({ file, dir }) => (backup ? backup.exportTo(file, dir) : null),
    'backup.exportStatus': () => (backup ? backup.exportStatus() : { last: null, remindDays: 7, nhac: false }),
  };
  return Object.fromEntries(Object.entries(handlers).map(([ch, fn]) => [ch, (args, ...rest) => fn(stripScope(ch, args), ...rest)]));
}

module.exports = { createHandlers };
