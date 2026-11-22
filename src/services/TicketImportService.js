'use strict';
/**
 * IMPORT PHIẾU CÂN: CHỌN FILE → PREVIEW → VALIDATE → NGƯỜI DÙNG XÁC NHẬN → COMMIT (transaction).
 * Không ghi DB ở bước preview. Commit lỗi giữa chừng → rollback toàn bộ.
 * KEY_CONFLICT không tự ghi đè → "Cần kiểm tra" (Giữ cũ / Cập nhật mới / Bỏ qua).
 */
const crypto = require('crypto');
const { readWorkbook } = require('../excel/workbookReader');
const { detectHeader, fold } = require('../excel/columnMapping');
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

  /** Bước 1: đọc file, liệt kê sheet, gợi ý sheet có header tốt nhất. */
  async open({ filePath, buffer, fileName }) {
    const wb = await readWorkbook({ filePath, buffer, fileName });
    const scored = wb.sheets.map((s) => ({ ...s, header: detectHeader(wb.aoa(s.name)) }));
    const best = scored.reduce((a, b) => (b.header.score > (a ? a.header.score : -1) ? b : a), null);
    const prev = this.db.get(`SELECT id, import_time FROM import_batch WHERE file_hash=? AND trang_thai='COMMITTED' ORDER BY id DESC LIMIT 1`, [wb.hash]);
    const token = crypto.randomUUID();
    this._prune();
    this.previews.set(token, { wb, stage: 'opened', createdAt: Date.now() });
    return {
      token, fileName: wb.fileName, hash: wb.hash, size: wb.size,
      sheets: scored.map((s) => ({ name: s.name, rows: s.rows, cols: s.cols, headerRow: s.header.headerRow, score: s.header.score })),
      suggestedSheet: best ? best.name : null,
      previouslyImported: prev ? { batchId: prev.id, at: prev.import_time } : null,
    };
  }

  /** Bước 2: header + mapping của 1 sheet (để người dùng sửa). */
  sheetInfo(token, sheetName, headerRow = null) {
    const p = this._p(token);
    const aoa = p.wb.aoa(sheetName);
    const det = detectHeader(aoa);
    const hr = headerRow === null || headerRow === undefined ? det.headerRow : Number(headerRow);
    const mapping = headerRow === null || headerRow === undefined ? det.mapping : detectHeader([aoa[hr] || []]).mapping;
    return { sheetName, headerRow: hr, headers: (aoa[hr] || []).map((h, i) => ({ index: i, text: h == null ? '' : String(h) })), mapping, sample: aoa.slice(hr + 1, hr + 6) };
  }

  /**
   * Kiểm tra NGAY TẠI CHỖ khi đang ghép cột (bước 2), chưa cần xem trước đầy đủ: thiếu cột bắt buộc, cột bị gán trùng,
   * tóm tắt lỗi cả sheet theo lý do, và đọc thử vài dòng đầu (ngày giờ, biển số chuẩn hóa, KL, nơi xuất nhận ra) để người dùng thấy ngay máy hiểu gì.
   * Chỉ đọc — không ghi DB, không đổi trạng thái phiên.
   */
  check(token, { sheetName, headerRow, mapping, sampleSize = 8, readAfterTotal = false }) {
    const p = this._p(token);
    const m = mapping || {};
    const has = (k) => m[k] !== undefined && m[k] !== null;
    const problems = [];
    const need = [['so_phieu', 'Số phiếu'], ['bien_so', 'Biển số'], ['ngay_gio_can_1', 'Ngày giờ cân 1']];
    for (const [k, label] of need) if (!has(k)) problems.push({ level: 'error', field: k, text: `Chưa ghép cột "${label}" (bắt buộc)` });
    if (!has('kl_hang_kg') && !(has('can_lan_1') && has('can_lan_2'))) problems.push({ level: 'error', field: 'kl_hang_kg', text: 'Cần cột "KL hàng" — hoặc ghép cả "Cân lần 1" và "Cân lần 2" để tự tính KL' });
    if (!has('noi_xuat')) problems.push({ level: 'warning', field: 'noi_xuat', text: 'Chưa ghép "Nơi xuất": không xác định được tuyến và đơn giá, phiếu sẽ ở trạng thái chưa tính giá' });
    if (!has('ngay_gio_can_2')) problems.push({ level: 'warning', field: 'ngay_gio_can_2', text: 'Chưa ghép "Ngày giờ cân 2": không kiểm tra được thời gian cân' });
    const byCol = new Map();
    for (const [k, idx] of Object.entries(m)) if (idx !== undefined && idx !== null) { if (!byCol.has(idx)) byCol.set(idx, []); byCol.get(idx).push(k); }
    for (const [idx, ks] of byCol) if (ks.length > 1) problems.push({ level: 'error', field: ks[0], text: `Cột ${Number(idx) + 1} đang được gán cho nhiều trường: ${ks.join(', ')} — mỗi cột chỉ ghép cho một trường` });

    let rows = [];
    if (!problems.some((x) => x.level === 'error')) {
      try { rows = parseTickets(p.wb.aoa(sheetName), Number(headerRow), m, { weightLimits: limitsFrom(this.settings), readAfterTotal: !!readAfterTotal }); } catch (e) { problems.push({ level: 'error', field: null, text: `Không đọc được dữ liệu: ${e.message}` }); }
    }
    if (rows.ignoredBelowTotal && rows.ignoredBelowTotal.count) problems.push({ level: 'warning', field: null, text: `Còn ${rows.ignoredBelowTotal.count} dòng giống phiếu cân nằm DƯỚI dòng "Tổng cộng" (từ dòng ${rows.ignoredBelowTotal.first_row}) — hệ thống dừng đọc ở dòng Tổng cộng nên các dòng này CHƯA được nhập. File có nhiều khối? Tách/sửa file rồi nhập lại` });
    const reasons = new Map();
    for (const r of rows) for (const e of r.errors) {
      const key = String(e).replace(/\d+([.,]\d+)?/g, '#').replace(/\s+/g, ' ').slice(0, 120);
      const cur = reasons.get(key) || { text: String(e), so_dong: 0, dong_dau: r.source_row };
      cur.so_dong++; reasons.set(key, cur);
    }
    const locs = new Map(this.db.all('SELECT id, ten FROM dia_diem').map((d) => [d.id, d.ten]));
    const alias = this.cost.loadContext().alias;
    const sample = rows.slice(0, sampleSize).map((r) => {
      const nx = alias.get(fold(r.noi_xuat)) || null;
      return { source_row: r.source_row, so_phieu: r.so_phieu, ngay_gio_can_1: r.ngay_gio_can_1, ngay_gio_can_2: r.ngay_gio_can_2, bien_so: r.bien_so, bien_so_goc: r.bien_so_goc,
        kl_hang_kg: r.kl_hang_kg, noi_xuat_goc: r.noi_xuat, noi_xuat_nhan_dang: nx ? locs.get(nx) || null : null, errors: r.errors };
    });
    return {
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
  preview(token, { sheetName, headerRow, mapping, dotId = null, noiDenId = null, readAfterTotal = false }) {
    const p = this._p(token);
    if (!mapping || mapping.so_phieu === undefined || mapping.bien_so === undefined || (mapping.kl_hang_kg === undefined && (mapping.can_lan_1 === undefined || mapping.can_lan_2 === undefined))) {
      throw new ValidationError('Mapping phải có: Số phiếu, Biển số, và KL hàng (hoặc Cân lần 1 + Cân lần 2)');
    }
    if (mapping.ngay_gio_can_1 === undefined) throw new ValidationError('Mapping phải có Ngày giờ cân 1');
    const aoa = p.wb.aoa(sheetName);
    const rows = parseTickets(aoa, Number(headerRow), mapping, { weightLimits: limitsFrom(this.settings), readAfterTotal: !!readAfterTotal });
    const nd = noiDenId || this._defaultNoiDen(dotId);

    // trùng với DB
    const keys = rows.map((r) => businessKey(r));
    const existing = new Map();
    for (let i = 0; i < keys.length; i += 500) {
      const chunk = keys.slice(i, i + 500);
      for (const e of this.db.all(`SELECT id, so_phieu, bien_so_goc AS bien_so, ngay_gio_can_1, ngay_gio_can_2, can_lan_1, can_lan_2, kl_hang_kg,
                                    noi_xuat_goc AS noi_xuat, business_key, fingerprint, chot_ky_id FROM phieu_can
                                    WHERE trang_thai='ACTIVE' AND business_key IN (${chunk.map(() => '?').join(',')})`, chunk)) existing.set(e.business_key, e);
    }
    const cls = classify(rows, existing);

    // tính thử
    const { ctx, alias } = this.cost.loadContext();
    const counts = Object.fromEntries(COUNT_KEYS.map((k) => [k, 0]));
    const seenNorm = new Map();   // (số phiếu | nơi xuất đã quy đổi alias) → dòng đầu tiên trong file
    const out = rows.map((r, i) => {
      let c = cls[i];
      const nx = alias.get(fold(r.noi_xuat)) || null;
      // Cùng số phiếu + cùng nơi xuất (sau khi quy đổi tên gọi khác, VD "QS" = "Quế Sơn") nhưng khác cách viết → không phải phiếu mới.
      if (c.status === 'NEW' && nx && !r.errors.length) {
        const dup = this.db.get(`SELECT id, so_phieu, bien_so_goc AS bien_so, ngay_gio_can_1, ngay_gio_can_2, can_lan_1, can_lan_2, kl_hang_kg, noi_xuat_goc AS noi_xuat
                                 FROM phieu_can WHERE trang_thai='ACTIVE' AND so_phieu=? AND noi_xuat_id=? LIMIT 1`, [String(r.so_phieu ?? '').trim(), nx]);
        if (dup) {
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
      const calc = computeTicket({ ...r, noi_xuat_id: nx, noi_den_id: nd }, ctx);
      if (c.status === 'IN_FILE_DUPLICATE' && c.differs) r.errors.push(`Trùng số phiếu + nơi xuất với dòng ${rows[c.firstIdx].source_row} trong file nhưng nội dung khác — kiểm tra file nguồn`);
      let phanLoai = r.errors.length ? 'ERROR' : c.status;
      // Dòng xung đột mà phiếu đã có dòng chờ kiểm tra với CÙNG dữ liệu → không mở thêm dòng chờ
      let pendingBatch = null;
      if (phanLoai === 'KEY_CONFLICT') { const same = this._pendingSame(c.existingId, c.fp); if (same) { phanLoai = 'PENDING_ALREADY'; pendingBatch = same.batch_id; } }
      counts.total++;
      if (!r.errors.length) counts.valid++;
      ({ NEW: () => counts.new++, EXACT_DUPLICATE: () => counts.exact++, KEY_CONFLICT: () => counts.conflict++, PENDING_ALREADY: () => counts.pendingAlready++, IN_FILE_DUPLICATE: () => counts.inFile++, ERROR: () => counts.error++ })[phanLoai]();
      if (phanLoai === 'NEW') {
        if (calc.warnings.includes('UNKNOWN_VEHICLE') || calc.warnings.includes('UNKNOWN_CARRIER')) counts.unknownVehicle++;
        if (calc.warnings.includes('UNKNOWN_LOCATION')) counts.unknownLocation++;
        if (calc.warnings.includes('NO_PRICE')) counts.noPrice++;
        if (calc.warnings.includes('MULTIPLE_PRICE')) counts.multiplePrice++;
      }
      return { ...r, idx: i, noi_xuat_id: nx, noi_den_id: nd, phan_loai: phanLoai, existingId: c.existingId || null, diffs: c.diffs || null, pendingBatch,
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
    Object.assign(p, { stage: 'previewed', sheetName, headerRow: Number(headerRow), mapping, dotId, noiDenId: nd, rows: out, counts, totals });
    return { token, counts, totals, sheetName, headerRow: Number(headerRow), noiDenId: nd };
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
    return { total: rows.length, rows: rows.slice(offset, offset + limit).map(({ fp, key, ...r }) => r) };
  }

  /** Bước 4: commit trong 1 transaction. */
  commit(token, { note = null, dotId, noiDenId } = {}) {
    const p = this._p(token);
    if (p.stage !== 'previewed') throw new ValidationError('Chưa preview');
    const dot = dotId !== undefined ? dotId : p.dotId;
    if (dot) {
      const d = this.db.get('SELECT trang_thai FROM dot_van_chuyen WHERE id=?', [dot]);
      if (!d) throw new ValidationError('Đợt không tồn tại');
      if (d.trang_thai === 'KHOA') throw new ValidationError('Đợt đã khóa — không import thêm phiếu');
    }
    const nd = noiDenId || p.noiDenId;
    require('./ChotKyService').ChotKyService.prototype.assertOpenForDates.call({ db: this.db }, (p.rows || []).filter((r) => r.phan_loai === 'NEW').map((r) => (r.ngay_gio_can_1 || '').slice(0, 10)));
    // Cấu hình ngưỡng KL có thể đã đổi sau khi xem trước: kiểm lại các dòng sắp ghi theo ngưỡng HIỆN HÀNH
    const lim = limitsFrom(this.settings);
    const vi = (p.rows || []).filter((r) => (r.phan_loai === 'NEW' || r.phan_loai === 'KEY_CONFLICT') && weightProblem(r.kl_hang_kg, lim));
    if (vi.length) throw new ValidationError(`Ngưỡng khối lượng đã thay đổi sau khi xem trước: ${vi.length} dòng không còn hợp lệ (vd dòng ${vi[0].source_row}, phiếu ${vi[0].so_phieu}: ${weightProblem(vi[0].kl_hang_kg, lim)}). Xem trước lại để cập nhật kết quả`);
    // Bản xem trước có thể đã cũ (token sống tới 2 giờ): phiếu gốc mà dòng "trùng"/"xung đột" dựa vào có thể đã bị xóa hoặc đổi dữ liệu.
    // Nếu cứ commit, dòng bị bỏ qua âm thầm và import báo thành công nhưng mất phiếu → bắt xem trước lại.
    for (const r of p.rows || []) {
      if (!['EXACT_DUPLICATE', 'KEY_CONFLICT', 'PENDING_ALREADY'].includes(r.phan_loai) || !r.existingId) continue;
      const ex = this.db.get('SELECT id, so_phieu, trang_thai, fingerprint FROM phieu_can WHERE id=?', [r.existingId]);
      if (!ex || ex.trang_thai !== 'ACTIVE') throw new ValidationError(`Dữ liệu đã thay đổi sau khi xem trước: phiếu ${r.so_phieu} (dòng ${r.source_row}) đã bị xóa hoặc không còn hiệu lực. Hãy xem trước lại rồi import.`);
      if (r.phan_loai === 'EXACT_DUPLICATE' && ex.fingerprint !== r.fp) throw new ValidationError(`Dữ liệu đã thay đổi sau khi xem trước: phiếu ${r.so_phieu} (dòng ${r.source_row}) đã được sửa. Hãy xem trước lại rồi import.`);
    }
    const chuaDuyet = duyetBat(this.settings);    // bật duyệt phiếu → phiếu mới là Nháp cho tới khi được duyệt
    const result = this.db.tx(() => {
      const c = p.counts;
      const batchId = this.db.run(`INSERT INTO import_batch(loai, file_name, file_hash, sheet_name, header_row, mapping_json, total_rows, dot_van_chuyen_id, user_note)
                                   VALUES ('PHIEU_CAN',?,?,?,?,?,?,?,?)`,
      [p.wb.fileName, p.wb.hash, p.sheetName, p.headerRow + 1, JSON.stringify(p.mapping), c.total, dot || null, note]).id;
      let inserted = 0, dup = 0, conflict = 0, err = 0, pendingSkipped = 0;
      for (const r of p.rows) {
        const raw = JSON.stringify({ so_phieu: r.so_phieu, ngay_gio_can_1: r.ngay_gio_can_1, ngay_gio_can_2: r.ngay_gio_can_2, bien_so: r.bien_so_goc,
          can_lan_1: r.can_lan_1, can_lan_2: r.can_lan_2, kl_hang_kg: r.kl_hang_kg, noi_xuat: r.noi_xuat, noi_den: r.noi_den, cong_ty_vc: r.cong_ty_vc_nguon });
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
                                    noi_xuat_goc, noi_xuat_id, noi_den_id, cong_ty_vc_nguon, dot_van_chuyen_id, business_key, strong_key, fingerprint, import_batch_id, source_row, trang_thai_duyet, nhap_boi)
                                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [r.so_phieu, r.ngay_gio_can_1, r.ngay_gio_can_2, r.bien_so_goc, r.bien_so, r.bien_so_chuan, r.can_lan_1, r.can_lan_2, r.kl_hang_kg,
            r.noi_xuat, r.noi_xuat_id, nd, r.cong_ty_vc_nguon == null ? null : String(r.cong_ty_vc_nguon), dot || null, r.key, strongKey(r), r.fp, batchId, r.source_row, chuaDuyet ? 'NHAP' : 'DA_DUYET', this.audit.actor() || null]).id;
          this._row(batchId, r, 'NEW', 'INSERT', id, raw);
          inserted++;
        } else if (r.phan_loai === 'EXACT_DUPLICATE' || r.phan_loai === 'IN_FILE_DUPLICATE') {
          this._row(batchId, r, r.phan_loai, 'SKIP', r.existingId, raw); dup++;
        } else if (r.phan_loai === 'PENDING_ALREADY' || (r.phan_loai === 'KEY_CONFLICT' && this._pendingSame(r.existingId, r.fp))) {
          // kiểm tra lại ngay trong transaction (phòng hai bản xem trước cùng dòng): đã chờ kiểm tra thì chỉ ghi nhận, không mở dòng chờ/cảnh báo mới
          const same = this._pendingSame(r.existingId, r.fp);
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
      return { batchId, inserted, duplicate: dup, conflict, error: err, pendingAlready: pendingSkipped, calculated: calc.count };
    });
    this.previews.delete(token);
    return { ...result, fileBuffer: p.wb.buffer, fileName: p.wb.fileName };
  }

  /** Thay dòng chờ `pr` (thuộc lô `batchId` đang hoàn tác) bằng dòng PENDING_ALREADY cùng dữ liệu, mới nhất, của lô COMMITTED khác. Trả id dòng được thăng cấp hoặc null. */
  _promotePendingAlready(pr, batchId) {
    let fp; try { fp = fingerprint(this._parseRaw(JSON.parse(pr.raw_json))); } catch (e) { return null; }
    const cands = this.db.all(`SELECT r.id, r.batch_id, r.raw_json FROM import_batch_row r JOIN import_batch b ON b.id=r.batch_id
                               WHERE r.phieu_can_id=? AND r.phan_loai='PENDING_ALREADY' AND r.hanh_dong='SKIP' AND b.trang_thai='COMMITTED' AND r.batch_id<>? ORDER BY r.id DESC`, [pr.phieu_can_id, batchId]);
    const hit = cands.find((x) => { try { return fingerprint(this._parseRaw(JSON.parse(x.raw_json))) === fp; } catch (e) { return false; } });
    if (!hit) return null;
    const old = this.db.get('SELECT * FROM phieu_can WHERE id=?', [pr.phieu_can_id]);
    this.db.run(`UPDATE import_batch_row SET phan_loai='KEY_CONFLICT', hanh_dong='PENDING_REVIEW', old_json=?, errors_json=NULL WHERE id=?`, [old ? JSON.stringify(old) : null, hit.id]);
    this.db.run('UPDATE import_batch SET duplicate_rows=MAX(duplicate_rows-1,0), conflict_rows=conflict_rows+1 WHERE id=?', [hit.batch_id]);
    this.audit.log('PENDING_PROMOTED', 'import_batch_row', hit.id, { phan_loai: 'PENDING_ALREADY' }, { phan_loai: 'KEY_CONFLICT', hanh_dong: 'PENDING_REVIEW' }, `Hoàn tác lô #${batchId}: chuyển dòng chờ kiểm tra sang dòng #${hit.id}`);
    return hit.id;
  }

  /** Phiếu đã có dòng "Cần kiểm tra" (lô đã commit, chưa xử lý) với đúng dữ liệu mới này chưa? Trả dòng đó hoặc null. */
  _pendingSame(phieuId, fp) {
    if (!phieuId || !fp) return null;
    for (const x of this.db.all(`SELECT r.id, r.batch_id, r.raw_json FROM import_batch_row r JOIN import_batch b ON b.id=r.batch_id
                                 WHERE r.hanh_dong='PENDING_REVIEW' AND r.phieu_can_id=? AND b.trang_thai='COMMITTED' ORDER BY r.id`, [phieuId])) {
      try { if (fingerprint(this._parseRaw(JSON.parse(x.raw_json))) === fp) return x; } catch (e) { /* dòng hỏng: bỏ qua */ }
    }
    return null;
  }

  _row(batchId, r, phanLoai, hanhDong, phieuId, raw, old = null, errors = null) {
    this.db.run(`INSERT INTO import_batch_row(batch_id, source_row, phan_loai, hanh_dong, phieu_can_id, old_json, raw_json, diffs_json, errors_json)
                 VALUES (?,?,?,?,?,?,?,?,?)`,
    [batchId, r.source_row, phanLoai, hanhDong, phieuId, old ? JSON.stringify(old) : null, raw, r.diffs ? JSON.stringify(r.diffs) : null, errors ? JSON.stringify(errors) : null]);
  }

  _defaultNoiDen(dotId) {
    if (dotId) { const d = this.db.get('SELECT noi_giao_id FROM dot_van_chuyen WHERE id=?', [dotId]); if (d && d.noi_giao_id) return d.noi_giao_id; }
    const code = this.settings.get('default_noi_den');
    if (code) { const l = this.db.get('SELECT id FROM dia_diem WHERE ma=?', [code]); if (l) return l.id; }
    return null;
  }

  _p(token) {
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
        const t = this._parseRaw(JSON.parse(r.raw_json));
        if (t.errors && t.errors.length) throw new ValidationError(`Dòng nguồn không còn hợp lệ theo quy tắc hiện hành (${t.errors[0]}) — không cập nhật`);
        // Cùng phạm vi bảo vệ như sửa trực tiếp: đợt đã khóa, kỳ đã chốt (ngày mới), trùng khóa với phiếu khác
        if (old.dot_van_chuyen_id) {
          const sd = this.db.get('SELECT trang_thai FROM dot_van_chuyen WHERE id=?', [old.dot_van_chuyen_id]);
          if (sd && sd.trang_thai === 'KHOA') throw new ValidationError('Phiếu thuộc đợt đã khóa — mở khóa đợt trước khi cập nhật');
        }
        require('./ChotKyService').ChotKyService.prototype.assertOpenForDates.call({ db: this.db }, [(t.ngay_gio_can_1 || '').slice(0, 10)]);
        const clash = this.db.get(`SELECT id FROM phieu_can WHERE business_key=? AND trang_thai='ACTIVE' AND id<>?`, [businessKey(t), old.id]);
        if (clash) throw new ValidationError(`Dữ liệu mới trùng khóa với phiếu khác (#${clash.id}) — không cập nhật được`);
        // Bản chụp "ngay trước lần cập nhật" (không phải lúc vào hàng chờ): hoàn tác khôi phục đúng trạng thái này
        this.db.run('UPDATE import_batch_row SET old_json=? WHERE id=?', [JSON.stringify(old), r.id]);
        this.db.run(`UPDATE phieu_can SET ngay_gio_can_1=?, ngay_gio_can_2=?, bien_so_goc=?, bien_so=?, bien_so_chuan=?, can_lan_1=?, can_lan_2=?, kl_hang_kg=?,
                       noi_xuat_goc=?, noi_xuat_id=NULL, business_key=?, strong_key=?, fingerprint=?, updated_at=strftime('%Y-%m-%dT%H:%M:%S','now','localtime') WHERE id=?`,
        [t.ngay_gio_can_1, t.ngay_gio_can_2, t.bien_so_goc, t.bien_so, t.bien_so_chuan, t.can_lan_1, t.can_lan_2, t.kl_hang_kg, t.noi_xuat,
          businessKey(t), strongKey(t), fingerprint(t), old.id]);
        this.db.run(`UPDATE import_batch SET updated_rows = updated_rows + 1 WHERE id=?`, [r.batch_id]);
        if (duyetBat(this.settings)) this.db.run(`UPDATE phieu_can SET trang_thai_duyet='NHAP', duyet_boi=NULL, duyet_luc=NULL, nhap_boi=? WHERE id=?`, [this.audit.actor() || null, old.id]);   // dữ liệu đổi → cần duyệt lại
        this.cost.recalc({ ids: [old.id] });
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

  batchRows(batchId, { hanh_dong = null, offset = 0, limit = 500 } = {}) {
    const w = ['r.batch_id = ?']; const p = [batchId];
    if (hanh_dong) { w.push('r.hanh_dong = ?'); p.push(hanh_dong); }
    return {
      total: this.db.get(`SELECT COUNT(*) n FROM import_batch_row r WHERE ${w.join(' AND ')}`, p).n,
      rows: this.db.all(`SELECT r.*, pc.so_phieu, pc.bien_so, pc.trang_thai AS trang_thai_phieu FROM import_batch_row r LEFT JOIN phieu_can pc ON pc.id=r.phieu_can_id
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
        if (cur && cur.trang_thai === 'ACTIVE') {
          // phiếu đã bị sửa tay sau lần cập nhật này → khôi phục bản cũ sẽ ghi đè thay đổi mới hơn
          const expect = fingerprint(this._parseRaw(JSON.parse(this.db.get('SELECT raw_json FROM import_batch_row WHERE id=?', [u.id]).raw_json)));
          if (cur.fingerprint !== expect) throw new ValidationError(`Phiếu ${cur.so_phieu} (#${cur.id}) đã được sửa sau lần cập nhật từ import — không hoàn tác để tránh ghi đè thay đổi mới hơn. Xử lý riêng phiếu này rồi hoàn tác lại`);
          const clash = this.db.get(`SELECT id, so_phieu FROM phieu_can WHERE business_key=? AND trang_thai='ACTIVE' AND id<>?`, [o.business_key, o.id]);
          if (clash) throw new ValidationError(`Khóa cũ của phiếu ${cur.so_phieu} đã bị phiếu #${clash.id} chiếm — không hoàn tác được`);
        }
        this.db.run(`UPDATE phieu_can SET ngay_gio_can_1=?, ngay_gio_can_2=?, bien_so_goc=?, bien_so=?, bien_so_chuan=?, can_lan_1=?, can_lan_2=?, kl_hang_kg=?,
                       noi_xuat_goc=?, noi_xuat_id=?, business_key=?, strong_key=?, fingerprint=? WHERE id=?`,
        [o.ngay_gio_can_1, o.ngay_gio_can_2, o.bien_so_goc, o.bien_so, o.bien_so_chuan, o.can_lan_1, o.can_lan_2, o.kl_hang_kg, o.noi_xuat_goc, o.noi_xuat_id,
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
