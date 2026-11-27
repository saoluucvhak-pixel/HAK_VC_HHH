'use strict';
const { assertOpenForTickets } = require('./ChotKyService');
/**
 * IMPORT PHIẾU CÂN: CHỌN FILE → PREVIEW → VALIDATE → NGƯỜI DÙNG XÁC NHẬN → COMMIT (transaction).
 * Không ghi DB ở bước preview. Commit lỗi giữa chừng → rollback toàn bộ.
 * KEY_CONFLICT không tự ghi đè → "Cần kiểm tra" (Giữ cũ / Cập nhật mới / Bỏ qua).
 */
const crypto = require('crypto');
const { readWorkbook, exceedsSheetLimit } = require('../excel/workbookReader');
const { detectHeader, fold } = require('../excel/columnMapping');
const { FIELDS, HEADER_DEPTHS, requiredFields, headersAt, resolveColumns, suggestColumns, validateTemplate } = require('../excel/importTemplate');
const { parseTickets } = require('../excel/ticketParser');
const { limitsFrom, weightProblem } = require('../utils/weight');
const { duyetBat } = require('../utils/duyet');
const { classify, businessKey, strongKey, fingerprint } = require('./DuplicateDetector');
const { computeTicket } = require('./TransportCostEngine');
const { ValidationError } = require('./CatalogService');

const COUNT_KEYS = ['total', 'valid', 'new', 'exact', 'conflict', 'pendingAlready', 'inFile', 'error', 'unknownVehicle', 'unknownLocation', 'noPrice', 'multiplePrice'];

// Cảnh báo của phiếu MỚI cần người dùng xử lý trước khi phiếu vào được bảng kê: [vấn đề, cách xử lý]
const ISSUE_WARN = {
  UNKNOWN_VEHICLE: ['Xe chưa có trong danh mục', 'Thêm xe ở Danh mục → Xe (hoặc import danh sách xe)'],
  UNKNOWN_CARRIER: ['Xe chưa gán đơn vị vận chuyển', 'Gán đơn vị cho xe ở Danh mục → Xe'],
  AMBIGUOUS_VEHICLE: ['Xe thuộc nhiều đơn vị cùng thời điểm', 'Sửa lịch sử xe → đơn vị ở Danh mục → Xe'],
  UNKNOWN_LOCATION: ['Chưa nhận ra nơi xuất / tuyến', 'Thêm địa điểm hoặc tên gọi khác ở Danh mục → Địa điểm, tạo tuyến ở Danh mục → Tuyến'],
  NO_PRICE: ['Chưa có bảng giá cho tuyến/ngày này', 'Tạo bảng giá hiệu lực ở menu Bảng giá'],
  MULTIPLE_PRICE: ['Nhiều bảng giá cùng hiệu lực', 'Đóng bớt bảng giá chồng lấn ở menu Bảng giá'],
  NO_VAT_RATE: ['Bảng giá chưa có thuế suất VAT', 'Nhập VAT cho bảng giá'],
};

function workbookHeaders(wb, sheet, row, depth) {
  if (!HEADER_DEPTHS.includes(depth) || !Number.isInteger(row) || row < depth - 1) return [];
  const first = row - depth + 1;
  const levels = wb.scan(sheet, first, row + 1);
  return headersAt(levels, depth - 1, depth, (index) => wb.header(sheet, first + index));
}

class TicketImportService {
  constructor(db, { audit, alerts, cost, settings, previewTtlMs = 2 * 60 * 60 * 1000 }) {
    Object.assign(this, { db, audit, alerts, cost, settings, previewTtlMs });
    this.previews = new Map();
  }

  /** Xóa phiên xem trước quá hạn (giữ bộ nhớ không phình khi mở nhiều file mà không commit/hủy). */
  _prune() {
    const now = Date.now();
    for (const [k, v] of this.previews) if (now - (v.createdAt || 0) > this.previewTtlMs) this.previews.delete(k);
  }

  templates() { return this.settings.get('excel_import_templates', { defaultId: null, templates: [] }); }

  updateTemplate({ action, id, template }) {
    return this.db.tx(() => {
      const current = this.templates();
      const index = current.templates.findIndex((item) => item.id === id);
      if ((action === 'delete' || id != null) && index < 0) throw new ValidationError('Mẫu không còn tồn tại');
      if (action === 'save') {
        const value = validateTemplate(template);
        if (current.templates.some((item) => item.id !== id && fold(item.name) === fold(value.name))) throw new ValidationError('Tên mẫu đã tồn tại');
        if (index < 0) current.templates.push({ id: crypto.randomUUID(), ...value });
        else current.templates[index] = { id, ...value };
      } else if (action === 'delete') {
        current.templates.splice(index, 1);
        if (id === current.defaultId) current.defaultId = null;
      } else if (action === 'default') current.defaultId = id ?? null;
      else throw new ValidationError('Thao tác với mẫu không hợp lệ');
      this.settings.set('excel_import_templates', current);
      return current;
    });
  }

  /** Bước 1: đọc file, liệt kê sheet, gợi ý sheet theo cách đọc mặc định. */
  async open({ filePath, buffer, fileName, sample = false, templateId, background = false }) {
    const wb = await readWorkbook({ filePath, buffer, fileName, background });
    const config = sample ? { defaultId: null, templates: [] } : this.templates();
    const template = config.templates.find((item) => item.id === (templateId === undefined ? config.defaultId : templateId));
    const scored = wb.sheets.map((s) => {
      const oversized = exceedsSheetLimit(s);
      const header = detectHeader(oversized ? [] : wb.scan(s.name, 0, 30));
      const fit = template && !oversized ? resolveColumns(workbookHeaders(wb, s.name, template.headerRow, template.headerRows), template.columns) : null;
      return { ...s, header, fit: fit ? Object.keys(fit.mapping).length : header.score, matches: fit && !fit.problems.length };
    });
    const complete = scored.filter((sheet) => sheet.matches);
    const preferred = complete.find((sheet) => sheet.name === template?.layout?.sheetName);
    const ambiguous = Boolean(template && !preferred && complete.length > 1);
    const best = preferred ?? scored.reduce((a, b) => (!a || b.fit > a.fit ? b : a), null);
    const prev = !sample && this.db.get(`SELECT id, import_time FROM import_batch WHERE file_hash=? AND trang_thai='COMMITTED' ORDER BY id DESC LIMIT 1`, [wb.hash]);
    const token = crypto.randomUUID();
    this._prune();
    this.previews.set(token, { wb, config, sample, stage: 'opened', createdAt: Date.now() });
    return {
      token, fileName: wb.fileName, hash: wb.hash, size: wb.size,
      sheets: scored.map((s) => ({ name: s.name, rows: s.rows, cols: s.cols, headerRow: s.header.headerRow, score: s.header.score })),
      suggestedSheet: ambiguous ? null : best?.name ?? null, ambiguousSheets: ambiguous ? complete.map((sheet) => sheet.name) : [], ...config,
      previouslyImported: prev ? { batchId: prev.id, at: prev.import_time } : null,
    };
  }

  _template(p, id = p.config.defaultId) {
    if (id == null) return null;
    const result = p.config.templates.find((item) => item.id === id);
    if (!result) throw new ValidationError('Mẫu không có trong phiên nhập, hãy mở lại file');
    return result;
  }

  /** Bước 2: tên cột và cách ghép của sheet, hoặc gợi ý để sửa thủ công. */
  sheetInfo(token, sheetName, headerRow = null, { templateId, headerRows = 1 } = {}) {
    const p = this._p(token);
    const template = this._template(p, templateId);
    const hr = template ? template.headerRow : headerRow ?? detectHeader(p.wb.scan(sheetName, 0, 30)).headerRow;
    const depth = template ? template.headerRows : headerRows;
    const titles = workbookHeaders(p.wb, sheetName, hr, depth);
    const { mapping, problems } = template ? resolveColumns(titles, template.columns) : { mapping: suggestColumns(titles), problems: [] };
    return { sheetName, headerRow: hr, headerRows: depth, headers: titles.map((text, index) => ({ index, text })), mapping, problems, sample: p.wb.scan(sheetName, hr + 1, hr + 6) };
  }

  _read(p, { sheetName, headerRow, headerRows = 1, mapping, templateId, draft, fallbackUnit = '', strict = false, readAfterTotal = false }) {
    const template = draft ? validateTemplate(draft) : this._template(p, templateId);
    if (template) {
      ({ headerRow, headerRows, fallbackUnit } = template);
      strict = true;
    }
    const hr = Number(headerRow);
    const selected = p.wb.sheets.find((sheet) => sheet.name === sheetName);
    const titles = workbookHeaders(p.wb, sheetName, hr, headerRows);
    const resolved = template ? resolveColumns(titles, template.columns) : { mapping: mapping || {}, problems: [] };
    const m = { ...resolved.mapping };
    const problems = [...resolved.problems];
    const error = (text, field = null) => problems.push({ level: 'error', field, text });
    if (!HEADER_DEPTHS.includes(headerRows) || !Number.isInteger(hr) || hr < headerRows - 1 || hr >= (selected?.rows ?? 0)) error('Dòng tiêu đề nằm ngoài sheet đã chọn');
    if (!['', 'kg', 't'].includes(fallbackUnit)) error('Đơn vị dự phòng phải là kg hoặc tấn');
    for (const field of requiredFields(m, strict)) {
      if (problems.some((problem) => problem.field === field)) continue;
      error(field === 'kl_hang_kg' ? 'Cần cột "KL hàng" hoặc ghép cả "Cân lần 1" và "Cân lần 2" để tự tính KL'
        : `Chưa ghép cột "${FIELDS[field]}" (bắt buộc)`, field);
    }
    const byCol = new Map();
    for (const [field, index] of Object.entries(m)) {
      if (index == null) continue;
      if (!Object.hasOwn(FIELDS, field) || !Number.isInteger(Number(index)) || index < 0 || index >= titles.length) {
        error(`Cột đã ghép của "${FIELDS[field] || field}" không hợp lệ`, field);
        continue;
      }
      if (byCol.has(Number(index))) error(`Cột ${Number(index) + 1} đang được gán cho nhiều trường: ${byCol.get(Number(index))}, ${field}`, field);
      byCol.set(Number(index), field);
    }
    let rows = [];
    if (!problems.some((problem) => problem.level === 'error')) {
      rows = parseTickets(p.wb.aoa(sheetName), hr, m, { weightLimits: limitsFrom(this.settings), readAfterTotal, strict, fallbackUnit, headers: titles, codeReader: p.wb.codeReader(sheetName) });
      const unitErrors = rows.filter((row) => row.errors.some((message) => message.startsWith('INVALID_UNIT:')));
      if (unitErrors.length) error(`${unitErrors.length} dòng có đơn vị không xác định. Dòng Excel ${unitErrors[0].source_row}: ${unitErrors[0].errors.find((message) => message.startsWith('INVALID_UNIT:')).slice(14)}`, 'weight_unit');
      if (strict && !rows.length) error('Không tìm thấy dòng phiếu cân dưới tiêu đề đã chọn');
      else if (strict && !unitErrors.length && rows.every((row) => row.errors.length)) error('Chưa có dòng phiếu cân hợp lệ. Kiểm tra lại cách ghép cột và đơn vị');
    }
    const readConfig = { version: 1, name: template?.name ?? (strict ? 'Ghép thủ công' : 'Tự nhận diện'), templateId: template?.id ?? null,
      sheetName, headerRow: hr, headerRows, columns: template?.columns ?? Object.fromEntries([...byCol].map(([index, field]) => [field, titles[index]])),
      mapping: m, strict, fallbackUnit, readAfterTotal };
    return { problems, rows, readConfig };
  }

  _resolveDestinations(rows, alias) {
    if (!rows.some((row) => row.noi_den)) return rows.map(() => null);
    const activeIds = new Set(this.db.all("SELECT id FROM dia_diem WHERE trang_thai='ACTIVE'").map((row) => row.id));
    return rows.map((row) => {
      if (!row.noi_den) return null;
      const id = alias.get(fold(row.noi_den));
      if (activeIds.has(id)) return id;
      row.errors.push(`Nơi đến “${row.noi_den}” chưa có trong danh mục đang dùng`);
      return null;
    });
  }

  /**
   * Kiểm tra NGAY TẠI CHỖ khi đang ghép cột (bước 2), chưa cần xem trước đầy đủ: thiếu cột bắt buộc, cột bị gán trùng,
   * tóm tắt lỗi cả sheet theo lý do, và đọc thử vài dòng đầu (ngày giờ, biển số chuẩn hóa, KL, nơi xuất nhận ra) để người dùng thấy ngay máy hiểu gì.
   * Chỉ đọc — không ghi DB, không đổi trạng thái phiên.
   */
  check(token, { sampleSize = 8, ...options }) {
    return this._check(this._p(token), options, sampleSize);
  }

  _check(p, options, sampleSize) {
    const { problems, rows, readConfig } = this._read(p, options);
    if (readConfig.mapping.noi_xuat == null) problems.push({ level: 'warning', field: 'noi_xuat', text: 'Chưa ghép "Nơi xuất": không xác định được tuyến và đơn giá, phiếu sẽ ở trạng thái chưa tính giá' });
    if (readConfig.mapping.ngay_gio_can_2 == null) problems.push({ level: 'warning', field: 'ngay_gio_can_2', text: 'Chưa ghép "Ngày giờ cân 2": không kiểm tra được thời gian cân' });
    if (rows.ignoredBelowTotal && rows.ignoredBelowTotal.count) problems.push({ level: 'warning', field: null, text: `Còn ${rows.ignoredBelowTotal.count} dòng giống phiếu cân nằm DƯỚI dòng "Tổng cộng" (từ dòng ${rows.ignoredBelowTotal.first_row}) — hệ thống dừng đọc ở dòng Tổng cộng nên các dòng này CHƯA được nhập. File có nhiều khối? Tách/sửa file rồi nhập lại` });
    const alias = this.cost.loadContext().alias;
    const destinations = this._resolveDestinations(rows, alias);
    const reasons = new Map();
    for (const r of rows) for (const e of r.errors) {
      const key = String(e).replace(/\d+([.,]\d+)?/g, '#').replace(/\s+/g, ' ').slice(0, 120);
      const cur = reasons.get(key) || { text: String(e), so_dong: 0, dong_dau: r.source_row };
      cur.so_dong++; reasons.set(key, cur);
    }
    const locs = new Map(this.db.all('SELECT id, ten FROM dia_diem').map((d) => [d.id, d.ten]));
    const sample = rows.slice(0, sampleSize).map((r, index) => {
      const nx = alias.get(fold(r.noi_xuat)) || null;
      return { source_row: r.source_row, so_phieu: r.so_phieu, ngay_gio_can_1: r.ngay_gio_can_1, ngay_gio_can_2: r.ngay_gio_can_2, bien_so: r.bien_so, bien_so_goc: r.bien_so_goc,
        kl_hang_kg: r.kl_hang_kg, can_lan_1: r.can_lan_1, can_lan_2: r.can_lan_2, cong_ty_vc_nguon: r.cong_ty_vc_nguon, ghi_chu: r.ghi_chu, tai_xe: r.tai_xe, noi_xuat_goc: r.noi_xuat, noi_den_goc: r.noi_den, noi_den_nhan_dang: locs.get(destinations[index]) ?? null, noi_xuat_nhan_dang: nx ? locs.get(nx) || null : null, errors: r.errors };
    });
    const readKg = Math.round(rows.reduce((sum, row) => sum + (Number(row.kl_hang_kg) || 0), 0) * 1000) / 1000;
    const validKg = Math.round(rows.reduce((sum, row) => sum + (row.errors.length ? 0 : Number(row.kl_hang_kg) || 0), 0) * 1000) / 1000;
    const fileKg = rows.totalRow?.kl_hang_kg ?? null;
    return {
      readConfig, readKg, validKg, fileKg, totalRow: rows.totalRow?.source_row ?? null,
      deltaKg: fileKg === null ? null : Math.round((readKg - fileKg) * 1000) / 1000,
      problems, blocking: problems.some((x) => x.level === 'error'),
      summary: { tong_dong: rows.length, dong_loi: rows.filter((r) => r.errors.length).length, ly_do: [...reasons.values()].sort((a, b) => b.so_dong - a.so_dong).slice(0, 8) },
      sample,
    };
  }

  /** Dòng cần xử lý của bản xem trước (lỗi, trùng khóa khác nội dung, thiếu xe/nơi xuất/giá) — để xuất Excel sửa rồi import lại. */
  issueRows(token) {
    const p = this._p(token);
    if (!p.rows) throw new ValidationError('Chưa xem trước');
    return p.rows.filter((r) => r.phan_loai === 'ERROR' || r.phan_loai === 'KEY_CONFLICT' || (r.phan_loai === 'NEW' && r.warnings.some((w) => ISSUE_WARN[w])));
  }

  /** Bước 3: preview đầy đủ (parse, validate, phân loại trùng, tính thử). KHÔNG ghi DB. */
  preview(token, { dotId = null, noiDenId = null, ...options }) {
    const p = this._p(token);
    if (p.sample || options.draft) throw new ValidationError('File mẫu chỉ dùng để đọc thử');
    const { rows, problems, readConfig } = this._read(p, options);
    const errors = problems.filter((problem) => problem.level === 'error');
    if (errors.length) throw new ValidationError(`Mapping: ${errors.map((problem) => problem.text).join(' · ')}`);
    const { sheetName, headerRow } = readConfig;
    const selectedDot = this._openDot(dotId);
    const nd = noiDenId ? Number(noiDenId) : this._defaultNoiDen(selectedDot?.id);
    if (nd && !this.db.get("SELECT id FROM dia_diem WHERE id=? AND trang_thai='ACTIVE'", [nd])) {
      throw new ValidationError('Nơi đến mặc định không còn trong danh mục đang dùng');
    }

    // trùng với DB
    const keys = rows.map((r) => businessKey(r));
    const existing = new Map();
    for (let i = 0; i < keys.length; i += 500) {
      const chunk = keys.slice(i, i + 500);
      for (const e of this.db.all(`SELECT id, so_phieu, bien_so_goc AS bien_so, ngay_gio_can_1, ngay_gio_can_2, can_lan_1, can_lan_2, kl_hang_kg,
                                    noi_xuat_goc AS noi_xuat, noi_den_id, tai_xe, business_key, fingerprint, chot_ky_id FROM phieu_can
                                    WHERE trang_thai='ACTIVE' AND business_key IN (${chunk.map(() => '?').join(',')})`, chunk)) existing.set(e.business_key, e);
    }
    const cls = classify(rows, existing);
    const byId = new Map([...existing.values()].map((row) => [row.id, row]));

    // tính thử
    const { ctx, alias, locName } = this.cost.loadContext();
    const destinations = this._resolveDestinations(rows, alias);
    const counts = Object.fromEntries(COUNT_KEYS.map((k) => [k, 0]));
    const seenNorm = new Map();   // (số phiếu | nơi xuất đã quy đổi alias) → dòng đầu tiên trong file
    const out = rows.map((r, i) => {
      let c = cls[i];
      const nx = alias.get(fold(r.noi_xuat)) || null;
      const specifiedDestination = destinations[i];
      // Cùng số phiếu + cùng nơi xuất (sau khi quy đổi tên gọi khác, VD "QS" = "Quế Sơn") nhưng khác cách viết → không phải phiếu mới.
      if (c.status === 'NEW' && nx && !r.errors.length) {
        const dup = this.db.get(`SELECT id, so_phieu, bien_so_goc AS bien_so, ngay_gio_can_1, ngay_gio_can_2, can_lan_1, can_lan_2, kl_hang_kg, noi_xuat_goc AS noi_xuat, noi_den_id, tai_xe, fingerprint
                                 FROM phieu_can WHERE trang_thai='ACTIVE' AND so_phieu=? AND noi_xuat_id=? LIMIT 1`, [String(r.so_phieu ?? '').trim(), nx]);
        if (dup) {
          byId.set(dup.id, dup);
          const alt = classify([r], new Map([[c.key, { ...dup, fingerprint: null }]]))[0];
          const diffs = (alt.diffs || []).filter((d) => d.field !== 'noi_xuat_key');
          c = diffs.length ? { ...c, status: 'KEY_CONFLICT', existingId: dup.id, diffs } : { ...c, status: 'EXACT_DUPLICATE', existingId: dup.id };
        }
      }
      // Cùng số phiếu + cùng nơi xuất sau khi quy đổi alias ("QS" = "Quế Sơn") trong CÙNG file là trùng trong file, dù viết khác chữ
      // (business_key theo chữ không thấy); nếu không, xem trước báo 2 phiếu mới nhưng commit luôn thất bại ở dòng sau.
      if (c.status === 'NEW' && nx && !r.errors.length) {
        const nk = `${String(r.so_phieu ?? '').trim()}|${nx}`; const first = seenNorm.get(nk);
        const fpn = fingerprint({ ...r, noi_xuat: String(nx) });   // so nội dung sau khi quy đổi nơi xuất về cùng một giá trị (tên viết khác không tính là nội dung khác)
        if (first) c = { ...c, status: 'IN_FILE_DUPLICATE', firstIdx: first.idx, differs: first.fp !== fpn };
        else seenNorm.set(nk, { idx: i, fp: fpn });
      }
      const previous = byId.get(c.existingId);
      if (specifiedDestination != null && previous && ['EXACT_DUPLICATE', 'KEY_CONFLICT'].includes(c.status) && previous.noi_den_id !== specifiedDestination) {
        c = { ...c, status: 'KEY_CONFLICT', diffs: [...(c.diffs || []), { field: 'noi_den_id', old: locName.get(previous.noi_den_id) ?? previous.noi_den_id, new: locName.get(specifiedDestination) ?? specifiedDestination }] };
      }
      if (r.tai_xe && previous && previous.tai_xe !== r.tai_xe && ['EXACT_DUPLICATE', 'KEY_CONFLICT'].includes(c.status)) {
        c = { ...c, status: 'KEY_CONFLICT', diffs: [...(c.diffs || []), { field: 'tai_xe', old: previous.tai_xe, new: r.tai_xe }] };
      }
      const destination = r.noi_den ? specifiedDestination : nd;
      const calc = computeTicket({ ...r, noi_xuat_id: nx, noi_den_id: destination }, ctx);
      const previousDestination = c.status === 'IN_FILE_DUPLICATE' ? destinations[c.firstIdx] : null;
      if (c.status === 'IN_FILE_DUPLICATE' && (c.differs || previousDestination !== specifiedDestination || rows[c.firstIdx].tai_xe !== r.tai_xe)) r.errors.push(`Trùng số phiếu + nơi xuất với dòng ${rows[c.firstIdx].source_row} trong file nhưng nội dung khác — kiểm tra file nguồn`);
      let phanLoai = r.errors.length ? 'ERROR' : c.status;
      // Dòng xung đột mà phiếu đã có dòng chờ kiểm tra với CÙNG dữ liệu → không mở thêm dòng chờ
      let pendingBatch = null;
      if (phanLoai === 'KEY_CONFLICT') { const same = this._pendingSame(c.existingId, c.fp, specifiedDestination, r.tai_xe); if (same) { phanLoai = 'PENDING_ALREADY'; pendingBatch = same.batch_id; } }
      counts.total++;
      if (!r.errors.length) counts.valid++;
      ({ NEW: () => counts.new++, EXACT_DUPLICATE: () => counts.exact++, KEY_CONFLICT: () => counts.conflict++, PENDING_ALREADY: () => counts.pendingAlready++, IN_FILE_DUPLICATE: () => counts.inFile++, ERROR: () => counts.error++ })[phanLoai]();
      if (phanLoai === 'NEW') {
        if (calc.warnings.includes('UNKNOWN_VEHICLE') || calc.warnings.includes('UNKNOWN_CARRIER')) counts.unknownVehicle++;
        if (calc.warnings.includes('UNKNOWN_LOCATION')) counts.unknownLocation++;
        if (calc.warnings.includes('NO_PRICE')) counts.noPrice++;
        if (calc.warnings.includes('MULTIPLE_PRICE')) counts.multiplePrice++;
      }
      return { ...r, idx: i, noi_xuat_id: nx, noi_den_id: destination, noi_den_ten: locName.get(destination) ?? r.noi_den, existingFp: previous?.fingerprint, existingDestination: previous?.noi_den_id, existingDriver: previous?.tai_xe, phan_loai: phanLoai, existingId: c.existingId || null, diffs: c.diffs || null, pendingBatch,
        engine_status: calc.status, warnings: calc.warnings, don_vi_van_chuyen_id: calc.don_vi_van_chuyen_id, don_gia: calc.don_gia,
        tien_truoc_vat: calc.tien_truoc_vat, tong_tien: calc.tong_tien, key: c.key, fp: c.fp };
    });
    // Tổng KL: đối chiếu với dòng "Tổng cộng" của chính file (nếu có) và tổng tạm tính của phiếu mới — để thấy ngay nếu mất dòng/sai đơn vị
    const readKg = out.reduce((a, r) => a + (Number(r.kl_hang_kg) || 0), 0);
    const news = out.filter((r) => r.phan_loai === 'NEW');
    const totals = { so_dong: out.length, read_kg: Math.round(readKg * 1000) / 1000, file_kg: rows.totalRow ? rows.totalRow.kl_hang_kg : null, file_total_row: rows.totalRow ? rows.totalRow.source_row : null,
      new_kg: Math.round(news.reduce((a, r) => a + (Number(r.kl_hang_kg) || 0), 0) * 1000) / 1000, new_truoc_vat: news.reduce((a, r) => a + (Number(r.tien_truoc_vat) || 0), 0) };
    totals.ignored_below_total = rows.ignoredBelowTotal ? rows.ignoredBelowTotal.count : 0; totals.ignored_first_row = rows.ignoredBelowTotal ? rows.ignoredBelowTotal.first_row : null;
    totals.lech_kg = totals.file_kg === null ? null : Math.round((totals.read_kg - totals.file_kg) * 1000) / 1000;

    // Gợi ý Đợt vận chuyển tự động dựa trên dải ngày của phiếu trong file (nếu người dùng chưa chọn đợt)
    const dates = out.filter((row) => !row.errors.length).map((row) => row.ngay_gio_can_1?.slice(0, 10)).filter(Boolean).sort();
    const matches = !selectedDot && dates.length ? this.db.all(`SELECT id, ma_dot FROM dot_van_chuyen
      WHERE trang_thai='MO' AND tu_ngay<=? AND (den_ngay IS NULL OR den_ngay>=?) LIMIT 2`, [dates[0], dates.at(-1)]) : [];
    const suggested = matches.length === 1 ? matches[0] : null;

    Object.assign(p, { stage: 'previewed', sheetName, headerRow, readConfig, dotId: selectedDot?.id ?? null,
      explicitDestination: noiDenId ? nd : null, noiDenId: nd, rows: out, counts, totals });
    return { token, counts, totals, sheetName, headerRow: Number(headerRow), noiDenId: nd, noiDenName: locName.get(nd) ?? null, selectedDot,
      suggestedDotId: suggested?.id ?? null, suggestedDotCode: suggested?.ma_dot ?? null };
  }

  /** Trang dữ liệu preview (cho bảng ảo hóa). filter: phan_loai hoặc cờ cảnh báo */
  previewRows(token, { filter = null, offset = 0, limit = 200 } = {}) {
    const p = this._p(token);
    let rows = p.rows || [];
    if (filter) {
      const f = {
        pendingAlready: (r) => r.phan_loai === 'PENDING_ALREADY', new: (r) => r.phan_loai === 'NEW', exact: (r) => r.phan_loai === 'EXACT_DUPLICATE', conflict: (r) => r.phan_loai === 'KEY_CONFLICT',
        inFile: (r) => r.phan_loai === 'IN_FILE_DUPLICATE', error: (r) => r.phan_loai === 'ERROR', valid: (r) => r.phan_loai !== 'ERROR',
        unknownVehicle: (r) => r.phan_loai === 'NEW' && (r.warnings.includes('UNKNOWN_VEHICLE') || r.warnings.includes('UNKNOWN_CARRIER')),
        unknownLocation: (r) => r.phan_loai === 'NEW' && r.warnings.includes('UNKNOWN_LOCATION'),
        noPrice: (r) => r.phan_loai === 'NEW' && r.warnings.includes('NO_PRICE'),
        multiplePrice: (r) => r.phan_loai === 'NEW' && r.warnings.includes('MULTIPLE_PRICE'),
      }[filter];
      if (f) rows = rows.filter(f);
    }
    return { total: rows.length, rows: rows.slice(offset, offset + limit).map(({ fp, key, existingFp, existingDestination, ...r }) => r) };
  }

  /** Bước 4: commit trong 1 transaction. */
  commit(token, { note = null, dotId, noiDenId } = {}) {
    const p = this._p(token);
    if (p.stage !== 'previewed') throw new ValidationError('Chưa preview');
    if ((dotId !== undefined && (dotId ? Number(dotId) : null) !== p.dotId)
        || (noiDenId !== undefined && (noiDenId ? Number(noiDenId) : null) !== p.explicitDestination)) {
      throw new ValidationError('Hãy xem trước lại sau khi đổi đợt hoặc nơi đến');
    }
    const dot = this._openDot(p.dotId)?.id ?? null;
    const nd = p.noiDenId;
    if ((!p.explicitDestination && this._defaultNoiDen(dot) !== nd)
        || (nd && !this.db.get("SELECT id FROM dia_diem WHERE id=? AND trang_thai='ACTIVE'", [nd]))) {
      throw new ValidationError('Nơi đến mặc định đã thay đổi — hãy xem trước lại rồi nhập');
    }
    // Cấu hình ngưỡng KL có thể đã đổi sau khi xem trước: kiểm lại các dòng sắp ghi theo ngưỡng HIỆN HÀNH
    const lim = limitsFrom(this.settings);
    const vi = (p.rows || []).filter((r) => (r.phan_loai === 'NEW' || r.phan_loai === 'KEY_CONFLICT') && weightProblem(r.kl_hang_kg, lim));
    if (vi.length) throw new ValidationError(`Ngưỡng khối lượng đã thay đổi sau khi xem trước: ${vi.length} dòng không còn hợp lệ (vd dòng ${vi[0].source_row}, phiếu ${vi[0].so_phieu}: ${weightProblem(vi[0].kl_hang_kg, lim)}). Xem trước lại để cập nhật kết quả`);
    // Bản xem trước có thể đã cũ (token sống tới 2 giờ): phiếu gốc mà dòng "trùng"/"xung đột" dựa vào có thể đã bị xóa hoặc đổi dữ liệu.
    // Nếu cứ commit, dòng bị bỏ qua âm thầm và import báo thành công nhưng mất phiếu → bắt xem trước lại.
    for (const r of p.rows || []) {
      if (!['EXACT_DUPLICATE', 'KEY_CONFLICT', 'PENDING_ALREADY'].includes(r.phan_loai) || !r.existingId) continue;
      const ex = this.db.get('SELECT id, so_phieu, trang_thai, fingerprint, noi_den_id, tai_xe FROM phieu_can WHERE id=?', [r.existingId]);
      if (!ex || ex.trang_thai !== 'ACTIVE') throw new ValidationError(`Dữ liệu đã thay đổi sau khi xem trước: phiếu ${r.so_phieu} (dòng ${r.source_row}) đã bị xóa hoặc không còn hiệu lực. Hãy xem trước lại rồi import.`);
      if (r.phan_loai === 'EXACT_DUPLICATE' && (ex.fingerprint !== (r.existingFp || r.fp) || (r.noi_den && ex.noi_den_id !== r.existingDestination) || (r.tai_xe && ex.tai_xe !== r.existingDriver))) throw new ValidationError(`Dữ liệu đã thay đổi sau khi xem trước: phiếu ${r.so_phieu} (dòng ${r.source_row}) đã được sửa. Hãy xem trước lại rồi import.`);
    }
    const chuaDuyet = duyetBat(this.settings);    // bật duyệt phiếu → phiếu mới là Nháp cho tới khi được duyệt
    const result = this.db.tx(() => {
      const explicitDestinationIds = new Set(p.rows.filter((row) => ['NEW', 'KEY_CONFLICT'].includes(row.phan_loai) && row.noi_den).map((row) => row.noi_den_id));
      for (const id of explicitDestinationIds) {
        if (!this.db.get("SELECT id FROM dia_diem WHERE id=? AND trang_thai='ACTIVE'", [id])) {
          throw new ValidationError('Nơi đến đã thay đổi sau khi xem trước. Hãy xem trước lại rồi nhập');
        }
      }
      const c = p.counts;
      const batchId = this.db.run(`INSERT INTO import_batch(loai, file_name, file_hash, sheet_name, header_row, mapping_json, total_rows, dot_van_chuyen_id, user_note)
                                   VALUES ('PHIEU_CAN',?,?,?,?,?,?,?,?)`,
      [p.wb.fileName, p.wb.hash, p.sheetName, p.headerRow + 1, JSON.stringify(p.readConfig), c.total, dot || null, note]).id;
      let inserted = 0, dup = 0, conflict = 0, err = 0, pendingSkipped = 0;
      for (const r of p.rows) {
        const raw = JSON.stringify({ so_phieu: r.so_phieu, ngay_gio_can_1: r.ngay_gio_can_1, ngay_gio_can_2: r.ngay_gio_can_2, bien_so: r.bien_so_goc,
          can_lan_1: r.can_lan_1, can_lan_2: r.can_lan_2, kl_hang_kg: r.kl_hang_kg, noi_xuat: r.noi_xuat, noi_den: r.noi_den, noi_den_id: r.noi_den ? r.noi_den_id : null, cong_ty_vc: r.cong_ty_vc_nguon, ghi_chu: r.ghi_chu, tai_xe: r.tai_xe });
        if (r.phan_loai === 'NEW') {
          const current = this._parseRaw(JSON.parse(raw));
          if (current.errors.length) throw new ValidationError(`Phiếu ${r.so_phieu} không còn hợp lệ (${current.errors[0]}) — hãy xem trước lại`);
          // kiểm tra lại ngay trong transaction (phòng import song song)
          const again = this.db.get(`SELECT id FROM phieu_can WHERE business_key=? AND trang_thai='ACTIVE'`, [r.key]);
          if (again) throw new ValidationError(`Phiếu ${r.so_phieu} vừa được import ở nơi khác — hãy preview lại`);
          // cùng số phiếu + cùng nơi xuất (dù viết bằng tên gọi khác, vd "QS" / "Quế Sơn") cũng là một phiếu
          const sameLoc = r.noi_xuat_id ? this.db.get(`SELECT id FROM phieu_can WHERE trang_thai='ACTIVE' AND so_phieu=? AND noi_xuat_id=?`, [String(r.so_phieu ?? '').trim(), r.noi_xuat_id]) : null;
          if (sameLoc) throw new ValidationError(`Phiếu ${r.so_phieu} đã có (ghi nơi xuất bằng tên gọi khác) — hãy preview lại`);
          const id = this.db.run(`INSERT INTO phieu_can(so_phieu, ngay_gio_can_1, ngay_gio_can_2, bien_so_goc, bien_so, bien_so_chuan, can_lan_1, can_lan_2, kl_hang_kg,
                                    noi_xuat_goc, noi_xuat_id, noi_den_id, cong_ty_vc_nguon, dot_van_chuyen_id, business_key, strong_key, fingerprint, import_batch_id, source_row, trang_thai_duyet, nhap_boi, ghi_chu, tai_xe)
                                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [r.so_phieu, r.ngay_gio_can_1, r.ngay_gio_can_2, r.bien_so_goc, r.bien_so, r.bien_so_chuan, r.can_lan_1, r.can_lan_2, r.kl_hang_kg,
            r.noi_xuat, r.noi_xuat_id, r.noi_den ? r.noi_den_id : nd, r.cong_ty_vc_nguon == null ? null : String(r.cong_ty_vc_nguon), dot || null, r.key, strongKey(r), r.fp, batchId, r.source_row, chuaDuyet ? 'NHAP' : 'DA_DUYET', this.audit.actor() || null, r.ghi_chu, r.tai_xe]).id;
          this._row(batchId, r, 'NEW', 'INSERT', id, raw);
          inserted++;
        } else if (r.phan_loai === 'EXACT_DUPLICATE' || r.phan_loai === 'IN_FILE_DUPLICATE') {
          this._row(batchId, r, r.phan_loai, 'SKIP', r.existingId, raw); dup++;
        } else if (r.phan_loai === 'PENDING_ALREADY' || (r.phan_loai === 'KEY_CONFLICT' && this._pendingSame(r.existingId, r.fp, r.noi_den ? r.noi_den_id : null))) {
          // kiểm tra lại ngay trong transaction (phòng hai bản xem trước cùng dòng): đã chờ kiểm tra thì chỉ ghi nhận, không mở dòng chờ/cảnh báo mới
          const same = this._pendingSame(r.existingId, r.fp, r.noi_den ? r.noi_den_id : null);
          const note = same ? `đã chờ kiểm tra ở lô #${same.batch_id}` : 'đã chờ kiểm tra ở lô trước';
          this._row(batchId, { ...r, diffs: r.diffs }, 'PENDING_ALREADY', 'SKIP', r.existingId, raw, null, [note]); dup++; pendingSkipped++;
        } else if (r.phan_loai === 'KEY_CONFLICT') {
          const old = this.db.get('SELECT * FROM phieu_can WHERE id=?', [r.existingId]);
          this._row(batchId, r, 'KEY_CONFLICT', 'PENDING_REVIEW', r.existingId, raw, old);
          this.alerts.open('DUPLICATE_TICKET', 'phieu_can', r.existingId, { so_phieu: r.so_phieu, diffs: r.diffs, batchId }, `Phiếu ${r.so_phieu} trùng khóa nhưng khác: ${r.diffs.map((d) => d.field).join(', ')}`);
          conflict++;
        } else {
          this._row(batchId, r, 'ERROR', 'IGNORE', null, raw, null, r.errors); err++;
        }
      }
      this.db.run('UPDATE import_batch SET inserted_rows=?, duplicate_rows=?, conflict_rows=?, error_rows=? WHERE id=?', [inserted, dup, conflict, err, batchId]);
      this.audit.log('IMPORT', 'import_batch', batchId, null, { file: p.wb.fileName, sheet: p.sheetName, inserted, dup, conflict, err });
      const calc = this.cost.recalc({ batchId });
      assertOpenForTickets(this.db, this.db.all(
        'SELECT ngay_gio_can_1, don_vi_van_chuyen_id FROM phieu_can WHERE import_batch_id=?', [batchId]));
      return { batchId, inserted, duplicate: dup, conflict, error: err, pendingAlready: pendingSkipped, calculated: calc.count };
    });
    this.previews.delete(token);
    return { ...result, fileBuffer: p.wb.buffer, fileName: p.wb.fileName };
  }

  /** Thay dòng chờ `pr` (thuộc lô `batchId` đang hoàn tác) bằng dòng PENDING_ALREADY cùng dữ liệu, mới nhất, của lô COMMITTED khác. Trả id dòng được thăng cấp hoặc null. */
  _promotePendingAlready(pr, batchId) {
    let fp, destination, driver;
    try {
      const raw = JSON.parse(pr.raw_json);
      fp = fingerprint(this._parseRaw(raw));
      destination = raw.noi_den_id ?? null;
      driver = raw.tai_xe ?? null;
    } catch (e) { return null; }
    const cands = this.db.all(`SELECT r.id, r.batch_id, r.raw_json FROM import_batch_row r JOIN import_batch b ON b.id=r.batch_id
                               WHERE r.phieu_can_id=? AND r.phan_loai='PENDING_ALREADY' AND r.hanh_dong='SKIP' AND b.trang_thai='COMMITTED' AND r.batch_id<>? ORDER BY r.id DESC`, [pr.phieu_can_id, batchId]);
    const hit = cands.find((x) => {
      try {
        const raw = JSON.parse(x.raw_json);
        return (raw.noi_den_id ?? null) === destination && (raw.tai_xe ?? null) === driver && fingerprint(this._parseRaw(raw)) === fp;
      } catch (e) { return false; }
    });
    if (!hit) return null;
    const old = this.db.get('SELECT * FROM phieu_can WHERE id=?', [pr.phieu_can_id]);
    this.db.run(`UPDATE import_batch_row SET phan_loai='KEY_CONFLICT', hanh_dong='PENDING_REVIEW', old_json=?, errors_json=NULL WHERE id=?`, [old ? JSON.stringify(old) : null, hit.id]);
    this.db.run('UPDATE import_batch SET duplicate_rows=MAX(duplicate_rows-1,0), conflict_rows=conflict_rows+1 WHERE id=?', [hit.batch_id]);
    this.audit.log('PENDING_PROMOTED', 'import_batch_row', hit.id, { phan_loai: 'PENDING_ALREADY' }, { phan_loai: 'KEY_CONFLICT', hanh_dong: 'PENDING_REVIEW' }, `Hoàn tác lô #${batchId}: chuyển dòng chờ kiểm tra sang dòng #${hit.id}`);
    return hit.id;
  }

  /** Phiếu đã có dòng "Cần kiểm tra" (lô đã commit, chưa xử lý) với đúng dữ liệu mới này chưa? Trả dòng đó hoặc null. */
  _pendingSame(phieuId, fp, destination = null, driver = null) {
    if (!phieuId || !fp) return null;
    for (const x of this.db.all(`SELECT r.id, r.batch_id, r.raw_json FROM import_batch_row r JOIN import_batch b ON b.id=r.batch_id
                                 WHERE r.hanh_dong='PENDING_REVIEW' AND r.phieu_can_id=? AND b.trang_thai='COMMITTED' ORDER BY r.id`, [phieuId])) {
      try {
        const raw = JSON.parse(x.raw_json);
        if ((raw.noi_den_id ?? null) === destination && (raw.tai_xe ?? null) === driver && fingerprint(this._parseRaw(raw)) === fp) return x;
      } catch (e) { /* dòng hỏng: bỏ qua */ }
    }
    return null;
  }

  _row(batchId, r, phanLoai, hanhDong, phieuId, raw, old = null, errors = null) {
    this.db.run(`INSERT INTO import_batch_row(batch_id, source_row, phan_loai, hanh_dong, phieu_can_id, old_json, raw_json, diffs_json, errors_json)
                 VALUES (?,?,?,?,?,?,?,?,?)`,
    [batchId, r.source_row, phanLoai, hanhDong, phieuId, old ? JSON.stringify(old) : null, raw, r.diffs ? JSON.stringify(r.diffs) : null, errors ? JSON.stringify(errors) : null]);
  }

  _openDot(id) {
    if (!id) return null;
    const dot = this.db.get('SELECT id, ma_dot, trang_thai FROM dot_van_chuyen WHERE id=?', [id]);
    if (!dot) throw new ValidationError('Đợt không tồn tại');
    if (dot.trang_thai !== 'MO') throw new ValidationError('Đợt đã khóa — không import thêm phiếu');
    return dot;
  }

  _defaultNoiDen(dotId) {
    if (dotId) { const d = this.db.get('SELECT noi_giao_id FROM dot_van_chuyen WHERE id=?', [dotId]); if (d && d.noi_giao_id) return d.noi_giao_id; }
    const code = this.settings.get('default_noi_den');
    if (code) { const l = this.db.get('SELECT id FROM dia_diem WHERE ma=?', [code]); if (l) return l.id; }
    return null;
  }

  _p(token) {
    this._prune();
    const p = this.previews.get(token);
    if (!p) throw new ValidationError('Phiên import đã hết hạn — hãy chọn lại file');
    return p;
  }

  cancel(token) { this.previews.delete(token); }

  // ------------------------------------------------------------- CẦN KIỂM TRA
  pendingReviews() {
    return this.db.all(`SELECT r.id, r.batch_id, r.source_row, r.phieu_can_id, r.raw_json, r.diffs_json, b.file_name, b.import_time,
                          p.so_phieu, p.bien_so, p.ngay_gio_can_1, p.ngay_gio_can_2, p.can_lan_1, p.can_lan_2, p.kl_hang_kg, p.noi_xuat_goc, p.chot_ky_id
                        FROM import_batch_row r JOIN import_batch b ON b.id=r.batch_id LEFT JOIN phieu_can p ON p.id=r.phieu_can_id
                        WHERE r.hanh_dong='PENDING_REVIEW' AND b.trang_thai='COMMITTED' ORDER BY r.id`)
      .map((x) => ({ ...x, raw: JSON.parse(x.raw_json), diffs: JSON.parse(x.diffs_json || '[]') }));
  }

  /** Hàng chờ nhóm theo phiếu: nhiều dòng chờ (số liệu khác nhau) cho cùng một phiếu nằm chung một nhóm. */
  pendingGroups() {
    const groups = new Map();
    for (const r of this.pendingReviews()) {
      const key = r.phieu_can_id === null || r.phieu_can_id === undefined ? `row-${r.id}` : r.phieu_can_id;
      if (!groups.has(key)) groups.set(key, { phieu_can_id: r.phieu_can_id, so_phieu: r.so_phieu, bien_so: r.bien_so, kl_hang_kg: r.kl_hang_kg, noi_xuat_goc: r.noi_xuat_goc, chot_ky_id: r.chot_ky_id, rows: [] });
      groups.get(key).rows.push(r);
    }
    return [...groups.values()];
  }

  _parseRaw(raw) {
    const [t] = parseTickets([['so_phieu', 't1', 't2', 'bs', 'c1', 'c2', 'kg', 'nx'], [raw.so_phieu, raw.ngay_gio_can_1, raw.ngay_gio_can_2, raw.bien_so, raw.can_lan_1, raw.can_lan_2, raw.kl_hang_kg, raw.noi_xuat]],
      0, { so_phieu: 0, ngay_gio_can_1: 1, ngay_gio_can_2: 2, bien_so: 3, can_lan_1: 4, can_lan_2: 5, kl_hang_kg: 6, noi_xuat: 7 }, { weightLimits: limitsFrom(this.settings) });
    return t;
  }

  /**
   * Xử lý hàng loạt: mỗi dòng một giao dịch riêng, KHÔNG dừng ở lỗi đầu tiên; trả kết quả từng ID.
   * batchId (nếu có): chỉ nhận dòng thuộc lô đó — dòng của lô khác bị từ chối.
   */
  resolveMany(ids, action, note = null, { batchId = null } = {}) {
    if (!Array.isArray(ids) || !ids.length) throw new ValidationError('Chưa chọn dòng nào');
    if (action === 'UPDATE' && !String(note || '').trim()) throw new ValidationError('Cập nhật hàng loạt cần ghi lý do');
    const results = [];
    for (const id of [...new Set(ids.map(Number))]) {
      const row = this.db.get(`SELECT r.id, r.batch_id, r.hanh_dong, p.so_phieu FROM import_batch_row r LEFT JOIN phieu_can p ON p.id=r.phieu_can_id WHERE r.id=?`, [id]);
      const base = { id, so_phieu: row ? row.so_phieu : null };
      if (!row) { results.push({ ...base, ok: false, reason: 'Dòng không tồn tại' }); continue; }
      if (batchId != null && row.batch_id !== Number(batchId)) { results.push({ ...base, ok: false, reason: `Dòng thuộc lô #${row.batch_id}, không thuộc lô đang xử lý` }); continue; }
      try { this.resolveReview(id, action, note); results.push({ ...base, ok: true }); }
      catch (e) { results.push({ ...base, ok: false, reason: e.message }); }
    }
    const ok = results.filter((x) => x.ok).length;
    return { action, total: results.length, ok, failed: results.length - ok, results };
  }

  /** action: KEEP_OLD | UPDATE | IGNORE */
  resolveReview(rowId, action, note = null) {
    if (!['KEEP_OLD', 'UPDATE', 'IGNORE'].includes(action)) throw new ValidationError('Hành động không hợp lệ');
    return this.db.tx(() => {
      const r = this.db.get(`SELECT * FROM import_batch_row WHERE id=? AND hanh_dong='PENDING_REVIEW'`, [rowId]);
      if (!r) throw new ValidationError('Dòng không còn chờ kiểm tra');
      const old = this.db.get('SELECT * FROM phieu_can WHERE id=?', [r.phieu_can_id]);
      if (action === 'UPDATE') {
        if (!old || old.trang_thai !== 'ACTIVE') throw new ValidationError('Phiếu gốc không còn hiệu lực');
        if (old.chot_ky_id) throw new ValidationError('Phiếu đã chốt — phải mở khóa kỳ trước khi cập nhật');
        const raw = JSON.parse(r.raw_json);
        const t = this._parseRaw(raw);
        if (raw.noi_den_id && !this.db.get("SELECT id FROM dia_diem WHERE id=? AND trang_thai='ACTIVE'", [raw.noi_den_id])) {
          throw new ValidationError('Nơi đến trong file không còn trong danh mục đang dùng');
        }
        if (t.errors && t.errors.length) throw new ValidationError(`Dòng nguồn không còn hợp lệ theo quy tắc hiện hành (${t.errors[0]}) — không cập nhật`);
        // Cùng phạm vi bảo vệ như sửa trực tiếp: đợt đã khóa, kỳ đã chốt (ngày mới), trùng khóa với phiếu khác
        if (old.dot_van_chuyen_id) {
          const sd = this.db.get('SELECT trang_thai FROM dot_van_chuyen WHERE id=?', [old.dot_van_chuyen_id]);
          if (sd && sd.trang_thai === 'KHOA') throw new ValidationError('Phiếu thuộc đợt đã khóa — mở khóa đợt trước khi cập nhật');
        }
        const clash = this.db.get(`SELECT id FROM phieu_can WHERE business_key=? AND trang_thai='ACTIVE' AND id<>?`, [businessKey(t), old.id]);
        if (clash) throw new ValidationError(`Dữ liệu mới trùng khóa với phiếu khác (#${clash.id}) — không cập nhật được`);
        // Bản chụp "ngay trước lần cập nhật" (không phải lúc vào hàng chờ): hoàn tác khôi phục đúng trạng thái này
        this.db.run('UPDATE import_batch_row SET old_json=? WHERE id=?', [JSON.stringify(old), r.id]);
        this.db.run(`UPDATE phieu_can SET ngay_gio_can_1=?, ngay_gio_can_2=?, bien_so_goc=?, bien_so=?, bien_so_chuan=?, can_lan_1=?, can_lan_2=?, kl_hang_kg=?,
                       noi_xuat_goc=?, noi_xuat_id=NULL, noi_den_id=?, tai_xe=COALESCE(?, tai_xe), business_key=?, strong_key=?, fingerprint=?, updated_at=strftime('%Y-%m-%dT%H:%M:%S','now','localtime') WHERE id=?`,
        [t.ngay_gio_can_1, t.ngay_gio_can_2, t.bien_so_goc, t.bien_so, t.bien_so_chuan, t.can_lan_1, t.can_lan_2, t.kl_hang_kg, t.noi_xuat, raw.noi_den_id ?? old.noi_den_id, raw.tai_xe ?? null,
          businessKey(t), strongKey(t), fingerprint(t), old.id]);
        this.db.run(`UPDATE import_batch SET updated_rows = updated_rows + 1 WHERE id=?`, [r.batch_id]);
        if (duyetBat(this.settings)) this.db.run(`UPDATE phieu_can SET trang_thai_duyet='NHAP', duyet_boi=NULL, duyet_luc=NULL, nhap_boi=? WHERE id=?`, [this.audit.actor() || null, old.id]);   // dữ liệu đổi → cần duyệt lại
        this.cost.recalc({ ids: [old.id] });
        assertOpenForTickets(this.db, [this.db.get('SELECT ngay_gio_can_1, don_vi_van_chuyen_id FROM phieu_can WHERE id=?', [old.id])]);
      }
      this.db.run(`UPDATE import_batch_row SET hanh_dong=? WHERE id=?`, [action, rowId]);
      this.audit.log(action === 'UPDATE' ? 'UPDATE_TICKET_FROM_IMPORT' : 'REVIEW_' + action, 'phieu_can', r.phieu_can_id, action === 'UPDATE' ? old : null, action === 'UPDATE' ? JSON.parse(r.raw_json) : null, note);
      const left = this.db.get(`SELECT COUNT(*) n FROM import_batch_row WHERE phieu_can_id=? AND hanh_dong='PENDING_REVIEW'`, [r.phieu_can_id]).n;
      if (!left) this.alerts.closeAuto('phieu_can', r.phieu_can_id, [], ['DUPLICATE_TICKET']);
      return { ok: true };
    });
  }

  // ------------------------------------------------------------- LỊCH SỬ & HOÀN TÁC
  listBatches() { return this.db.all(`SELECT * FROM import_batch ORDER BY id DESC`); }

  batchConfig(batchId) {
    const batch = this.db.get(`SELECT * FROM import_batch WHERE id=? AND loai='PHIEU_CAN'`, [batchId]);
    if (!batch) throw new ValidationError('Lô phiếu cân không tồn tại');
    const saved = JSON.parse(batch.mapping_json || 'null');
    const readConfig = saved?.version === 1 ? saved : {
      name: 'Cách ghép của lô cũ', sheetName: batch.sheet_name, headerRow: batch.header_row - 1,
      headerRows: 1, mapping: saved, strict: false, fallbackUnit: '', readAfterTotal: false,
    };
    return { batch, readConfig };
  }

  async readBatch(batchId, file) {
    const { batch, readConfig } = this.batchConfig(batchId);
    if (!readConfig.mapping) throw new ValidationError('Lô này chưa có cấu hình đọc file');
    const wb = await readWorkbook({ ...file, background: true });
    if (wb.hash !== batch.file_hash) throw new ValidationError('File đã chọn khác file nguồn của lô này');
    return this._check({ wb, config: { defaultId: null, templates: [] } }, { ...readConfig, templateId: null }, 8);
  }

  batchRows(batchId, { hanh_dong = null, offset = 0, limit = 500 } = {}) {
    const w = ['r.batch_id = ?']; const p = [batchId];
    if (hanh_dong) { w.push('r.hanh_dong = ?'); p.push(hanh_dong); }
    return {
      total: this.db.get(`SELECT COUNT(*) n FROM import_batch_row r WHERE ${w.join(' AND ')}`, p).n,
      rows: this.db.all(`SELECT r.*, COALESCE(json_extract(r.raw_json, '$.so_phieu'), pc.so_phieu) so_phieu,
                         COALESCE(json_extract(r.raw_json, '$.bien_so'), pc.bien_so) bien_so,
                         pc.trang_thai AS trang_thai_phieu FROM import_batch_row r LEFT JOIN phieu_can pc ON pc.id=r.phieu_can_id
                         WHERE ${w.join(' AND ')} ORDER BY r.id LIMIT ${Number(limit)} OFFSET ${Number(offset)}`, p),
    };
  }

  undoBatch(batchId, reason) {
    if (!reason) throw new ValidationError('Cần ghi lý do hoàn tác');
    return this.db.tx(() => {
      const b = this.db.get('SELECT * FROM import_batch WHERE id=?', [batchId]);
      if (!b || b.trang_thai !== 'COMMITTED') throw new ValidationError('Batch không tồn tại hoặc đã hoàn tác');
      const locked = this.db.get(`SELECT COUNT(*) n FROM import_batch_row r JOIN phieu_can p ON p.id=r.phieu_can_id
                                  WHERE r.batch_id=? AND r.hanh_dong IN ('INSERT','UPDATE') AND p.chot_ky_id IS NOT NULL`, [batchId]).n;
      if (locked) throw new ValidationError(`${locked} phiếu của lần import này đã chốt — không hoàn tác được`);
      const ins = this.db.all(`SELECT phieu_can_id FROM import_batch_row WHERE batch_id=? AND hanh_dong='INSERT'`, [batchId]).map((x) => x.phieu_can_id);
      for (const id of ins) {
        this.db.run(`UPDATE phieu_can SET trang_thai='VOID', updated_at=strftime('%Y-%m-%dT%H:%M:%S','now','localtime') WHERE id=?`, [id]);
        this.db.run(`UPDATE canh_bao SET trang_thai='DA_XU_LY', resolved_at=strftime('%Y-%m-%dT%H:%M:%S','now','localtime'), ghi_chu='Hoàn tác import' WHERE entity='phieu_can' AND entity_id=? AND trang_thai IN ('MOI','DANG_XU_LY')`, [id]);
      }
      const upd = this.db.all(`SELECT * FROM import_batch_row WHERE batch_id=? AND hanh_dong='UPDATE'`, [batchId]);
      for (const u of upd) {
        // Phiếu đã bị lần import SAU (chưa hoàn tác) sửa tiếp → khôi phục snapshot cũ sẽ ghi đè mất dữ liệu mới
        const later = this.db.get(`SELECT b.id FROM import_batch_row r JOIN import_batch b ON b.id=r.batch_id
          WHERE r.phieu_can_id=? AND r.hanh_dong='UPDATE' AND b.id>? AND b.trang_thai<>'UNDONE' LIMIT 1`, [u.phieu_can_id, batchId]);
        if (later) throw new ValidationError(`Phiếu #${u.phieu_can_id} đã được lần import #${later.id} cập nhật tiếp — hoàn tác lần import #${later.id} trước`);
        const o = JSON.parse(u.old_json);
        const cur = this.db.get('SELECT * FROM phieu_can WHERE id=?', [u.phieu_can_id]);
        const raw = JSON.parse(u.raw_json);
        if (cur && cur.trang_thai === 'ACTIVE') {
          // phiếu đã bị sửa tay sau lần cập nhật này → khôi phục bản cũ sẽ ghi đè thay đổi mới hơn
          const expect = fingerprint(this._parseRaw(raw));
          if (cur.fingerprint !== expect || (raw.noi_den_id != null && cur.noi_den_id !== raw.noi_den_id) || (raw.tai_xe != null && cur.tai_xe !== raw.tai_xe)) throw new ValidationError(`Phiếu ${cur.so_phieu} (#${cur.id}) đã được sửa sau lần cập nhật từ import — không hoàn tác để tránh ghi đè thay đổi mới hơn. Xử lý riêng phiếu này rồi hoàn tác lại`);
          const clash = this.db.get(`SELECT id, so_phieu FROM phieu_can WHERE business_key=? AND trang_thai='ACTIVE' AND id<>?`, [o.business_key, o.id]);
          if (clash) throw new ValidationError(`Khóa cũ của phiếu ${cur.so_phieu} đã bị phiếu #${clash.id} chiếm — không hoàn tác được`);
        }
        this.db.run(`UPDATE phieu_can SET ngay_gio_can_1=?, ngay_gio_can_2=?, bien_so_goc=?, bien_so=?, bien_so_chuan=?, can_lan_1=?, can_lan_2=?, kl_hang_kg=?,
                       noi_xuat_goc=?, noi_xuat_id=?, noi_den_id=?, tai_xe=?, business_key=?, strong_key=?, fingerprint=? WHERE id=?`,
        [o.ngay_gio_can_1, o.ngay_gio_can_2, o.bien_so_goc, o.bien_so, o.bien_so_chuan, o.can_lan_1, o.can_lan_2, o.kl_hang_kg, o.noi_xuat_goc, o.noi_xuat_id, (raw.noi_den_id == null && cur ? cur.noi_den_id : o.noi_den_id), raw.tai_xe == null && cur ? cur.tai_xe : o.tai_xe ?? null,
          o.business_key, o.strong_key, o.fingerprint, o.id]);
        if (duyetBat(this.settings)) {
          this.db.run(`UPDATE phieu_can SET trang_thai_duyet='NHAP', nhap_boi=?, duyet_boi=NULL, duyet_luc=NULL WHERE id=?`, [this.audit.actor() || null, o.id]);
        }
      }
      for (const pr of this.db.all(`SELECT id, phieu_can_id, raw_json FROM import_batch_row WHERE batch_id=? AND hanh_dong='PENDING_REVIEW' AND phieu_can_id IS NOT NULL`, [batchId])) {
        // Lô khác (còn hiệu lực) đã nhập lại ĐÚNG dữ liệu này và được ghi PENDING_ALREADY → dòng chờ không được mất theo lô bị hoàn tác:
        // thăng cấp dòng PENDING_ALREADY mới nhất thành dòng "Cần kiểm tra" (giữ cảnh báo DUPLICATE_TICKET đang mở).
        this._promotePendingAlready(pr, batchId);
        const left = this.db.get(`SELECT COUNT(*) n FROM import_batch_row WHERE phieu_can_id=? AND hanh_dong='PENDING_REVIEW' AND batch_id<>?`, [pr.phieu_can_id, batchId]).n;
        if (!left) this.alerts.closeAuto('phieu_can', pr.phieu_can_id, [], ['DUPLICATE_TICKET']);
      }
      this.db.run(`UPDATE import_batch_row SET hanh_dong='IGNORE' WHERE batch_id=? AND hanh_dong='PENDING_REVIEW'`, [batchId]);
      this.db.run(`UPDATE import_batch SET trang_thai='UNDONE', user_note=COALESCE(user_note,'')||' | Hoàn tác: '||? WHERE id=?`, [reason, batchId]);
      this.audit.log('UNDO_IMPORT', 'import_batch', batchId, { inserted: ins.length, updated: upd.length }, null, reason);
      if (upd.length) this.cost.recalc({ ids: upd.map((u) => u.phieu_can_id) });
      const plates = this.db.all(`SELECT DISTINCT bien_so_chuan FROM phieu_can WHERE id IN (${ins.map(() => '?').join(',') || 'NULL'})`, ins).map((x) => x.bien_so_chuan);
      this.cost.syncTimeAlerts(plates);
      return { voided: ins.length, restored: upd.length };
    });
  }
}

module.exports = { TicketImportService, ISSUE_WARN };
