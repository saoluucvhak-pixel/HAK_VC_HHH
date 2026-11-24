'use strict';
/**
 * Báo cáo — tổng hợp bằng SQL (GROUP BY + index), không tải toàn bộ dữ liệu lên giao diện.
 * Tiền theo phiếu/xe là giá trị chưa làm tròn (tham khảo); SỐ THANH TOÁN chính thức = bảng kê (StatementService).
 */
const { fromDb, toDb } = require('../utils/dbMoney');
const { buildTimeline } = require('./TimeAnomalyService');
const { buildStatement } = require('./StatementService');
const { ValidationError } = require('./CatalogService');
const { normalizePlate } = require('../utils/plate');
const { asIds, oneId } = require('../utils/filterIds');
const { fold } = require('../excel/columnMapping');
const { ticketVersionSql } = require('../utils/duyet');

const MONEY = ['don_gia', 'tien_truoc_vat', 'tien_vat', 'tong_tien'];
const conv = (r) => { for (const k of MONEY) if (k in r) r[k] = fromDb(r[k]); return r; };

const SORTABLE = new Set(['so_phieu', 'ngay_gio_can_1', 'bien_so', 'kl_hang_kg', 'noi_xuat', 'don_gia', 'tong_tien', 'tien_truoc_vat', 'don_vi', 'trang_thai_tinh_gia', 'id']);

/** Phiếu "đã tính giá" — cùng định nghĩa với Bảng kê (StatementService.isPriced) + phải có đơn vị vận chuyển. */
const pricedSql = (a = 'p') => `(${a}.trang_thai_tinh_gia IN ('OK','LOCKED') AND ${a}.don_gia IS NOT NULL AND ${a}.ty_le_vat IS NOT NULL AND ${a}.kl_hang_kg > 0 AND ${a}.don_vi_van_chuyen_id IS NOT NULL)`;

class ReportService {
  constructor(db, settings) { this.db = db; this.settings = settings; }

  where(f = {}, alias = 'p') {
    const w = [`${alias}.trang_thai='ACTIVE'`]; const p = [];
    const add = (sql, ...v) => { w.push(sql); p.push(...v); };
    if (f.tu_ngay) add(`${alias}.ngay_can >= ?`, f.tu_ngay);
    if (f.den_ngay) add(`${alias}.ngay_can <= ?`, f.den_ngay);
    // chọn nhiều giá trị: mảng id → IN (...); một id → = (cùng ý nghĩa với bộ lọc cũ)
    const inIds = (col, v) => { const ids = asIds(v); if (ids.length) add(`${col} IN (${ids.map(() => '?').join(',')})`, ...ids); };
    inIds(`${alias}.dot_van_chuyen_id`, f.dot_id);
    inIds(`${alias}.noi_xuat_id`, f.noi_xuat_id);
    inIds(`${alias}.tuyen_id`, f.tuyen_id);
    inIds(`${alias}.don_vi_van_chuyen_id`, f.don_vi_id);
    if (f.bien_so) add(`${alias}.bien_so_chuan = ?`, normalizePlate(f.bien_so));
    if (f.trang_thai_tinh_gia) add(`${alias}.trang_thai_tinh_gia = ?`, f.trang_thai_tinh_gia);
    if (f.chua_tinh_gia) w.push(`NOT ${pricedSql(alias)}`);
    if (f.da_tinh_gia) w.push(pricedSql(alias));
    // Duyệt phiếu: mặc định mọi số liệu (Dashboard, Bảng kê, báo cáo, chốt kỳ, đối chiếu) chỉ gồm phiếu ĐÃ DUYỆT; danh sách Phiếu cân dùng moi_trang_thai để thấy cả Nháp
    if (f.trang_thai_duyet === 'NHAP' || f.trang_thai_duyet === 'DA_DUYET') add(`${alias}.trang_thai_duyet = ?`, f.trang_thai_duyet);
    else if (!f.moi_trang_thai) w.push(`${alias}.trang_thai_duyet = 'DA_DUYET'`);
    if (f.chua_chot) w.push(`${alias}.chot_ky_id IS NULL`);
    if (f.chot_ky_id) add(`${alias}.chot_ky_id = ?`, f.chot_ky_id);
    if (f.search && String(f.search).trim()) this._search(String(f.search).trim(), alias, add);
    return { sql: w.join(' AND '), params: p };
  }

  /** Báo cáo/chứng từ luôn giới hạn phiếu đã duyệt, kể cả khi bộ lọc yêu cầu Nháp hoặc mọi trạng thái. */
  approvedWhere(f = {}, alias = 'p') {
    const scope = this.where(f, alias);
    return { sql: `${scope.sql} AND ${alias}.trang_thai_duyet='DA_DUYET'`, params: scope.params };
  }

  /** Tìm kiếm không phân biệt dấu/hoa-thường: số phiếu, biển số (gõ kiểu nào cũng được), tên nơi xuất (kể cả tên gọi khác). */
  _search(q, alias, add) {
    const like = `%${q}%`, parts = [`${alias}.so_phieu LIKE ?`, `${alias}.bien_so LIKE ?`, `${alias}.noi_xuat_goc LIKE ?`], params = [like, like, like];
    const plate = normalizePlate(q);
    if (plate.length >= 2) { parts.push(`${alias}.bien_so_chuan LIKE ?`); params.push(`%${plate}%`); }
    const fq = fold(q);
    if (fq) {
      const ids = this.db.all('SELECT id, ten FROM dia_diem').filter((d) => fold(d.ten).includes(fq)).map((d) => d.id);
      for (const a of this.db.all('SELECT dia_diem_id, alias_folded FROM dia_diem_alias')) if (a.alias_folded.includes(fq) && !ids.includes(a.dia_diem_id)) ids.push(a.dia_diem_id);
      if (ids.length) { parts.push(`${alias}.noi_xuat_id IN (${ids.map(() => '?').join(',')})`); params.push(...ids); }
    }
    add(`(${parts.join(' OR ')})`, ...params);
  }

  /** Số dòng khớp bộ lọc / tổng số phiếu đang hoạt động (cho dòng "Hiển thị x / y dòng"). */
  count(f = {}, { approvedOnly = false } = {}) {
    const { sql, params } = approvedOnly ? this.approvedWhere(f) : this.where(f);
    return { kept: this.db.get(`SELECT COUNT(*) n FROM phieu_can p WHERE ${sql}`, params).n, total: this.db.get(`SELECT COUNT(*) n FROM phieu_can WHERE trang_thai='ACTIVE'`).n };
  }

  /** "Việc cần làm" theo luồng: nhập → kiểm tra → đối chiếu → chốt kỳ → in bảng kê (đếm phiếu ở từng bước). */
  todo() {
    const c = (sql) => this.db.get(sql).n;
    const priced = pricedSql('p');
    return {
      tong_phieu: c(`SELECT COUNT(*) n FROM phieu_can WHERE trang_thai='ACTIVE'`),
      chua_tinh_gia: c(`SELECT COUNT(*) n FROM phieu_can p WHERE p.trang_thai='ACTIVE' AND p.trang_thai_duyet='DA_DUYET' AND NOT ${priced}`),
      can_doi_chieu: c(`SELECT COUNT(*) n FROM phieu_can p WHERE p.trang_thai='ACTIVE' AND p.trang_thai_duyet='DA_DUYET' AND ${priced} AND p.trang_thai_doi_chieu IN ('CHUA_DOI_CHIEU','LECH')`),
      chua_chot: c(`SELECT COUNT(*) n FROM phieu_can p WHERE p.trang_thai='ACTIVE' AND p.trang_thai_duyet='DA_DUYET' AND ${priced} AND p.chot_ky_id IS NULL`),
      cho_duyet: c(`SELECT COUNT(*) n FROM phieu_can WHERE trang_thai='ACTIVE' AND trang_thai_duyet='NHAP'`),
      da_chot: c(`SELECT COUNT(*) n FROM phieu_can WHERE trang_thai='ACTIVE' AND chot_ky_id IS NOT NULL`),
      import_gan_nhat: this.db.get(`SELECT import_time, file_name, inserted_rows FROM import_batch WHERE trang_thai='COMMITTED' ORDER BY id DESC LIMIT 1`) || null,
    };
  }

  /** Các kỳ (yyyy-MM) có phiếu, mới nhất trước — cho ô chọn kỳ. */
  periods(limit = 36) {
    return this.db.all(`SELECT substr(ngay_can,1,7) ky, COUNT(*) n FROM phieu_can WHERE trang_thai='ACTIVE' AND ngay_can IS NOT NULL GROUP BY 1 ORDER BY 1 DESC LIMIT ${Number(limit)}`);
  }

  /** Chi tiết vận chuyển (phân trang phía SQL). */
  tickets(f = {}, { offset = 0, limit = 100, sort = 'ngay_gio_can_1', dir = 'asc', approvedOnly = false } = {}) {
    const { sql, params } = approvedOnly ? this.approvedWhere(f) : this.where(f);
    const col = SORTABLE.has(sort) ? (sort === 'don_vi' ? 'd.ma' : `p.${sort}`) : 'p.ngay_gio_can_1';
    const base = `FROM phieu_can p LEFT JOIN don_vi_van_chuyen d ON d.id=p.don_vi_van_chuyen_id LEFT JOIN tuyen_van_chuyen t ON t.id=p.tuyen_id
                  LEFT JOIN dot_van_chuyen dt ON dt.id=p.dot_van_chuyen_id WHERE ${sql}`;
    const pr = pricedSql('p');   // tiền chỉ cộng/hiển thị cho phiếu ĐÃ TÍNH GIÁ (khớp Dashboard và Bảng kê); phiếu xe lạ… có thể còn don_gia/tiền nhưng chưa hợp lệ
    const tot = this.db.get(`SELECT COUNT(*) n, SUM(p.kl_hang_kg) kg, SUM(CASE WHEN ${pr} THEN p.tien_truoc_vat END) tien_truoc_vat, SUM(CASE WHEN ${pr} THEN p.tien_vat END) tien_vat, SUM(CASE WHEN ${pr} THEN p.tong_tien END) tong_tien ${base}`, params);
    const rows = this.db.all(`SELECT p.id, p.so_phieu, p.ngay_can, p.ngay_gio_can_1, p.ngay_gio_can_2, p.bien_so, d.ma AS don_vi, p.noi_xuat, p.noi_xuat_goc, p.noi_den,
        t.ma_tuyen AS tuyen, p.tuyen_id, p.don_vi_tinh, p.can_lan_1, p.can_lan_2, p.kl_hang_kg, p.kl_hang_tan, p.don_gia, (CASE WHEN ${pr} THEN p.tien_truoc_vat END) AS tien_truoc_vat, p.ty_le_vat, (CASE WHEN ${pr} THEN p.tien_vat END) AS tien_vat, (CASE WHEN ${pr} THEN p.tong_tien END) AS tong_tien,
        dt.ma_dot AS dot, p.trang_thai_tinh_gia, p.trang_thai_doi_chieu, p.xe_tra_ve, (CASE WHEN p.duyet_boi IS NOT NULL AND p.duyet_boi = p.nhap_boi THEN 1 ELSE 0 END) AS tu_duyet, p.chot_ky_id, p.ghi_chu, p.bang_gia_id, p.trang_thai_duyet, ${ticketVersionSql('p')} AS ver
        ${base} ORDER BY ${col} ${dir === 'desc' ? 'DESC' : 'ASC'}, p.id LIMIT ${Number(limit)} OFFSET ${Number(offset)}`, params).map(conv);
    return { total: tot.n, totals: { so_chuyen: tot.n, tong_kg: tot.kg || 0, tien_truoc_vat: fromDb(tot.tien_truoc_vat) || 0, tien_vat: fromDb(tot.tien_vat) || 0, tong_tien: fromDb(tot.tong_tien) || 0 }, rows };
  }

  _group(f, keySql, labelSql, extraJoin = '', groupSql = keySql) {
    const { sql, params } = this.approvedWhere(f); const pr = pricedSql('p');
    return this.db.all(`SELECT ${keySql} AS k, ${labelSql} AS label, COUNT(*) so_chuyen, COUNT(DISTINCT p.bien_so_chuan) so_xe,
        SUM(p.kl_hang_kg) tong_kg, SUM(p.kl_hang_kg)/1000.0 tong_tan, group_concat(DISTINCT p.don_gia) don_gia_list,
        SUM(CASE WHEN ${pr} THEN p.tien_truoc_vat END) tien_truoc_vat, SUM(CASE WHEN ${pr} THEN p.tien_vat END) tien_vat, SUM(CASE WHEN ${pr} THEN p.tong_tien END) tong_tien,
        SUM(CASE WHEN p.trang_thai_tinh_gia NOT IN ('OK','LOCKED') THEN 1 ELSE 0 END) chua_tinh_gia
      FROM phieu_can p LEFT JOIN don_vi_van_chuyen d ON d.id=p.don_vi_van_chuyen_id ${extraJoin}
      WHERE ${sql} GROUP BY ${groupSql} ORDER BY label`, params)
      .map((r) => ({ ...conv(r), don_gia: (r.don_gia_list ? String(r.don_gia_list).split(',').map((x) => fromDb(Number(x))).sort((a, b) => a - b) : []) }));
  }

  byVehicle(f = {}) {
    const { sql, params } = this.approvedWhere(f); const pr = pricedSql('p');
    return this.db.all(`SELECT p.bien_so_chuan k, MIN(p.bien_so) label, group_concat(DISTINCT d.ma) don_vi, COUNT(*) so_chuyen,
        SUM(p.kl_hang_kg) tong_kg, SUM(p.kl_hang_kg)/1000.0 tong_tan, group_concat(DISTINCT p.don_gia) don_gia_list,
        SUM(CASE WHEN ${pr} THEN p.tien_truoc_vat END) tien_truoc_vat, SUM(CASE WHEN ${pr} THEN p.tien_vat END) tien_vat, SUM(CASE WHEN ${pr} THEN p.tong_tien END) tong_tien,
        SUM(CASE WHEN p.trang_thai_tinh_gia NOT IN ('OK','LOCKED') THEN 1 ELSE 0 END) chua_tinh_gia
      FROM phieu_can p LEFT JOIN don_vi_van_chuyen d ON d.id=p.don_vi_van_chuyen_id WHERE ${sql}
      GROUP BY p.bien_so_chuan ORDER BY label`, params)
      .map((r) => ({ ...conv(r), don_gia: r.don_gia_list ? String(r.don_gia_list).split(',').map((x) => fromDb(Number(x))).sort((a, b) => a - b) : [] }));
  }
  byCarrier(f = {}) { return this._group(f, 'p.don_vi_van_chuyen_id', `COALESCE(d.ma, '(Chưa xác định)')`); }
  byOrigin(f = {}) {
    // nơi xuất chưa nhận diện (noi_xuat_id NULL) không bị gộp vào MỘT nhóm: tách theo tên gốc, nhãn lấy đúng từ tên gốc
    return this._group(f, 'p.noi_xuat_id', `COALESCE(p.noi_xuat, p.noi_xuat_goc, '(Chưa xác định)')`, '', `p.noi_xuat_id, (CASE WHEN p.noi_xuat_id IS NULL THEN COALESCE(p.noi_xuat_goc, '') END)`);
  }
  byDate(f = {}) { return this._group(f, 'p.ngay_can', 'p.ngay_can'); }
  /** Theo đợt/tàu. KL giám định chỉ để đối chiếu — cước luôn tính theo KL cân (chốt 07/10/2026). */
  byDot(f = {}) {
    return this._group(f, 'p.dot_van_chuyen_id', `COALESCE(dt.ma_dot, '(Chưa gán đợt)')`, 'LEFT JOIN dot_van_chuyen dt ON dt.id=p.dot_van_chuyen_id').map((r) => ({ ...r, ...this.giamDinh(r.k, r.tong_tan) }));
  }
  /** {kl_giam_dinh_tan, chenh_giam_dinh_tan (giám định − cân), chenh_giam_dinh_pct} hoặc null khi đợt chưa nhập KL giám định. */
  giamDinh(dotId, tongTanCan) {
    const d = dotId ? this.db.get('SELECT khoi_luong_giam_dinh gd FROM dot_van_chuyen WHERE id=?', [dotId]) : null;
    if (!d || d.gd === null || d.gd === undefined) return { kl_giam_dinh_tan: null, chenh_giam_dinh_tan: null, chenh_giam_dinh_pct: null };
    const chenh = Math.round((d.gd - tongTanCan) * 1000) / 1000;
    return { kl_giam_dinh_tan: d.gd, chenh_giam_dinh_tan: chenh, chenh_giam_dinh_pct: tongTanCan ? Math.round((chenh / tongTanCan) * 1e6) / 1e4 : null };
  }

  /** Timeline 1 xe (MASTER_PROMPT XVIII). */
  timeline(bienSo, { tu_ngay, den_ngay } = {}) {
    const { sql, params } = this.approvedWhere({ bien_so: bienSo, tu_ngay, den_ngay });
    const rows = this.db.all(`SELECT p.id, p.so_phieu, p.ngay_can, p.ngay_gio_can_1, p.ngay_gio_can_2, p.bien_so, p.noi_xuat, p.noi_xuat_goc, p.noi_den,
        p.can_lan_1, p.can_lan_2, p.kl_hang_kg, p.kl_hang_tan, p.don_gia, p.tien_truoc_vat, p.tien_vat, p.tong_tien, d.ma don_vi
        FROM phieu_can p LEFT JOIN don_vi_van_chuyen d ON d.id=p.don_vi_van_chuyen_id WHERE ${sql}`, params).map(conv);
    return buildTimeline(rows, this.settings.get('time_anomaly') || {});
  }

  /** Bảng kê 1 đơn vị (làm tròn theo bảng kê). */
  statement(f) {
    const dvId = f ? oneId(f.don_vi_id) : null;
    if (dvId === null) throw new Error('Cần chọn đúng một đơn vị vận chuyển');
    const { sql, params } = this.approvedWhere(f);
    const rows = this.db.all(`SELECT p.kl_hang_kg, p.don_gia, p.tuyen_id, p.don_vi_tinh, p.ty_le_vat AS vat_percent,
                                    p.bien_so, p.trang_thai_tinh_gia AS status, p.chot_ky_id
                              FROM phieu_can p WHERE ${sql}`, params).map(conv);
    const closeId = rows[0]?.chot_ky_id;
    if (closeId && rows.every((row) => row.chot_ky_id === closeId)) {
      const n = this.db.get(`SELECT COUNT(*) n FROM chot_ky_snapshot
                             WHERE chot_ky_id=? AND don_vi_van_chuyen_id=?`, [closeId, dvId]).n;
      if (rows.length === n) {
        const statement = this._closedStatements(closeId).find((st) => st.don_vi.id === dvId);
        if (!statement) throw new ValidationError('Không tìm thấy đơn vị trong Bảng kê đã chốt');
        return statement;
      }
    }
    if (f.chot_ky_id) throw new ValidationError('Không có Bảng kê đã chốt theo phạm vi đã chọn');
    return { ...this._buildStatement(rows, dvId), ...(rows.some((row) => row.chot_ky_id) ? { tham_khao: true } : {}) };
  }

  _buildStatement(rows, carrierId, rounding = this.settings.get('rounding')?.statement) {
    const routes = new Map(this.db.all('SELECT id, ma_tuyen FROM tuyen_van_chuyen').map((r) => [r.id, r.ma_tuyen]));
    const statement = buildStatement(rows, { rounding, routeLabel: (id) => routes.get(id) || '(chưa có tuyến)' });
    statement.don_vi = this.db.get('SELECT * FROM don_vi_van_chuyen WHERE id=?', [carrierId]);
    return statement;
  }

  _closedStatements(id) {
    const period = this.db.get("SELECT * FROM chot_ky WHERE id=? AND trang_thai='DA_CHOT'", [id]);
    if (!period) throw new ValidationError('Kỳ chốt không còn hiệu lực');
    let statements;
    if (period.statements_json) {
      statements = JSON.parse(period.statements_json);
    } else {
      const snapshots = this.db.all('SELECT snapshot_json FROM chot_ky_snapshot WHERE chot_ky_id=?', [id]);
      const carriers = new Map();
      for (const row of snapshots) {
        const t = conv(JSON.parse(row.snapshot_json));
        const group = carriers.get(t.don_vi_van_chuyen_id) || [];
        group.push({ ...t, status: t.trang_thai_tinh_gia, vat_percent: t.ty_le_vat });
        carriers.set(t.don_vi_van_chuyen_id, group);
      }
      const changed = this.db.get(`SELECT s.old_value FROM audit_log s
        WHERE s.id > (
          SELECT MAX(l.id) FROM audit_log l WHERE l.action='LOCK_PERIOD' AND l.entity='chot_ky' AND l.entity_id=?
        ) AND s.action='SETTING' AND s.entity='settings' AND json_type(s.new_value, '$.rounding') IS NOT NULL
        ORDER BY s.id LIMIT 1`, [id]);
      const rounding = changed ? (JSON.parse(changed.old_value).rounding?.statement ?? {}) : this.settings.get('rounding')?.statement;
      statements = Array.from(carriers, ([carrier, rows]) => this._buildStatement(rows, carrier, rounding));
      const sums = (key) => statements.reduce((total, st) => total + st[key], 0);
      const matches = sums('so_chuyen') === period.so_phieu && Math.abs(sums('tong_kg') - period.tong_kg) < 1e-6
        && ['tien_truoc_vat', 'tien_vat', 'tong_tien'].every((key) => toDb(sums(key)) === period[key]);
      if (!matches) throw new ValidationError('Kỳ chốt cũ: không dựng lại được chi tiết khớp tổng đã lưu. Dùng chứng từ gốc để đối chiếu.');
    }
    return statements.map((st) => ({ ...st, ky_chot: { id, ma: period.ma, dot_id: period.dot_van_chuyen_id,
      tu_ngay: period.tu_ngay, den_ngay: period.den_ngay } }));
  }

  statements(f = {}) {
    if (f.chot_ky_id && !f.don_vi_id && Object.keys(f).length === 1) return this._closedStatements(f.chot_ky_id);
    const ids = this.db.all(`SELECT DISTINCT p.don_vi_van_chuyen_id id FROM phieu_can p WHERE ${this.approvedWhere(f).sql} AND p.don_vi_van_chuyen_id IS NOT NULL`, this.approvedWhere(f).params);
    return ids.map((x) => this.statement({ ...f, don_vi_id: x.id }));
  }

  dashboard(f = {}) {
    const pf = { ...f, da_tinh_gia: true }; // số liệu chính: CHỈ phiếu đã tính giá (khớp Bảng kê)
    const { sql, params } = this.approvedWhere(pf);
    const k = this.db.get(`SELECT COUNT(*) so_chuyen, COALESCE(SUM(kl_hang_kg),0) tong_kg, COALESCE(SUM(tien_truoc_vat),0) tien_truoc_vat, COALESCE(SUM(tien_vat),0) tien_vat,
        COALESCE(SUM(tong_tien),0) tong_tien, COUNT(DISTINCT bien_so_chuan) so_xe, COUNT(DISTINCT don_vi_van_chuyen_id) so_don_vi,
        SUM(CASE WHEN chot_ky_id IS NOT NULL THEN 1 ELSE 0 END) da_chot
      FROM phieu_can p WHERE ${sql}`, params);
    for (const m of ['tien_truoc_vat', 'tien_vat', 'tong_tien']) k[m] = fromDb(k[m]);
    // Phiếu CHƯA tính giá (cùng bộ lọc): đếm, KL, theo từng lý do
    const u = this.approvedWhere({ ...f, chua_tinh_gia: true });
    const un = this.db.get(`SELECT COUNT(*) so_chuyen, COALESCE(SUM(kl_hang_kg),0) tong_kg FROM phieu_can p WHERE ${u.sql}`, u.params);
    const unBy = this.db.all(`SELECT CASE WHEN p.trang_thai_tinh_gia IN ('OK','LOCKED') THEN 'THIEU_DU_LIEU_GIA' ELSE p.trang_thai_tinh_gia END trang_thai, COUNT(*) so_chuyen, COALESCE(SUM(kl_hang_kg),0) tong_kg
                              FROM phieu_can p WHERE ${u.sql} GROUP BY 1 ORDER BY 2 DESC`, u.params);
    const w = this.approvedWhere(f);
    const o = this.db.get(`SELECT SUM(CASE WHEN trang_thai_doi_chieu IN ('CHUA_DOI_CHIEU','LECH') THEN 1 ELSE 0 END) can_doi_chieu FROM phieu_can p WHERE ${w.sql}`, w.params);
    k.can_doi_chieu = o.can_doi_chieu || 0;
    k.chua_tinh = { so_chuyen: un.so_chuyen, tong_kg: un.tong_kg, theo_trang_thai: unBy };
    f = pf;
    const top = (order) => this.db.all(`SELECT MIN(p.bien_so) label, COUNT(*) so_chuyen, SUM(kl_hang_kg) tong_kg FROM phieu_can p WHERE ${sql}
                                        GROUP BY bien_so_chuan ORDER BY ${order} DESC LIMIT 10`, params);
    return {
      kpi: k,
      byDate: this.byDate(f).map((r) => ({ label: r.label, so_chuyen: r.so_chuyen, tong_tan: r.tong_tan, tong_tien: r.tong_tien })),
      byOrigin: this.byOrigin(f).map((r) => ({ label: r.label, tong_tan: r.tong_tan, so_chuyen: r.so_chuyen })),
      byCarrier: this.byCarrier(f).map((r) => ({ label: r.label, tong_tien: r.tong_tien, so_chuyen: r.so_chuyen })),
      giamDinh: oneId(f.dot_id) !== null ? this.giamDinh(oneId(f.dot_id), k.tong_kg / 1000) : null,
      topTrips: top('so_chuyen'), topWeight: top('tong_kg'),
    };
  }
}

module.exports = { ReportService };
