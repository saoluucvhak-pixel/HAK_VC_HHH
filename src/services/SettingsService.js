'use strict';
const { validateTemplate } = require('../excel/importTemplate');
const { ValidationError } = require('./CatalogService');

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const numIn = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const need = (cond, msg) => { if (!cond) throw new ValidationError(msg); };

/**
 * Cấu hình hệ thống: CHỈ nhận các khóa đã biết và kiểm tra giá trị trước khi lưu.
 * (Trước đây nhận mọi khóa/giá trị: vd số bản sao lưu giữ lại = "abc" làm xóa sạch bản sao lưu tự động, làm tròn NaN → bỏ làm tròn âm thầm.)
 */
const VALIDATORS = {
  excel_import_templates(value) {
    need(isObj(value) && Array.isArray(value.templates), 'Danh sách mẫu nhập không hợp lệ');
    for (const item of value.templates) {
      need(isObj(item) && typeof item.id === 'string' && /^[0-9a-f-]{36}$/.test(item.id), 'Mã mẫu nhập không hợp lệ');
      validateTemplate(item);
      need(Object.keys(item).length === 6, 'Mẫu nhập chỉ lưu cấu hình đọc Excel');
    }
    const ids = new Set(value.templates.map((item) => item.id));
    need(ids.size === value.templates.length && (value.defaultId === null || ids.has(value.defaultId)), 'Mẫu mặc định không hợp lệ');
    need(Object.keys(value).length === 2, 'Danh sách mẫu có dữ liệu thừa');
  },
  duyet_phieu(v) {
    need(isObj(v) && typeof v.bat === 'boolean', 'Duyệt phiếu: bat phải là true/false');
    need(v.cho_tu_duyet === undefined || typeof v.cho_tu_duyet === 'boolean', 'Duyệt phiếu: cho_tu_duyet phải là true/false');
  },
  kl_hop_ly(v) {
    need(isObj(v), 'Ngưỡng khối lượng phải là đối tượng');
    need(numIn(v.min_kg, 0, 1_000_000) && numIn(v.max_kg, 1, 10_000_000), 'Ngưỡng KL: tối thiểu 0–1.000.000 kg, tối đa 1–10.000.000 kg');
    need(v.min_kg < v.max_kg, 'Ngưỡng KL tối thiểu phải nhỏ hơn tối đa');
  },
  ngay_can_cu_gia(v) {
    need(v === 'CAN_1' || v === 'CAN_2', 'Ngày căn cứ tính giá phải là CAN_1 (Ngày cân lần 1) hoặc CAN_2 (Ngày cân lần 2)');
  },
  money_scale(v) { need(v === 1000, 'Hệ số lưu tiền (money_scale) cố định 1000 — không đổi được'); },
  // Chỉ một quy tắc được cài đặt trong mã: số phiếu + nơi xuất. Giá trị khác sẽ bị mã bỏ qua âm thầm → từ chối thay vì nhận rồi không áp dụng.
  duplicate_key(v) { need(v === 'SO_PHIEU_NOI_XUAT', 'Khóa chống trùng chỉ hỗ trợ SO_PHIEU_NOI_XUAT (số phiếu + nơi xuất)'); },
  default_noi_den(v) { need(v === null || (typeof v === 'string' && v.length <= 50), 'Mã nơi đến mặc định không hợp lệ'); },
  initial_data(v) { need(isObj(v), 'initial_data phải là đối tượng'); },
  company(v) {
    need(isObj(v), 'Thông tin công ty phải là đối tượng');
    for (const [k, x] of Object.entries(v)) need(x === null || (typeof x === 'string' && x.length <= 300), `Thông tin công ty "${k}" phải là chữ (≤ 300 ký tự)`);
  },
  rounding(v) {
    need(isObj(v), 'Cấu hình làm tròn phải là đối tượng');
    if (v.level !== undefined) need(['STATEMENT', 'TICKET', 'GROUP'].includes(v.level), 'Cấp làm tròn không hợp lệ');
    if (v.statement !== undefined) {
      need(isObj(v.statement), 'Làm tròn bảng kê phải là đối tượng');
      for (const k of ['lineAmount', 'vat']) {
        const r = v.statement[k];
        if (r === undefined) continue;
        need(isObj(r) && intIn(r.digits, -6, 6), `Làm tròn "${k}": số chữ số phải là số nguyên từ −6 đến 6`);
        need(r.mode === undefined || ['HALF_UP', 'DOWN', 'UP'].includes(r.mode), `Làm tròn "${k}": kiểu không hợp lệ`);
      }
    }
  },
  time_anomaly(v) {
    need(isObj(v), 'Ngưỡng cảnh báo thời gian phải là đối tượng');
    if (v.minGapMinutes !== undefined) need(numIn(v.minGapMinutes, 0, 1440), 'Khoảng cách tối thiểu giữa 2 chuyến phải từ 0 đến 1440 phút');
    if (v.maxWeighDurationMinutes !== undefined) need(numIn(v.maxWeighDurationMinutes, 1, 10080), 'Thời gian cân tối đa phải từ 1 đến 10080 phút');
    if (v.minWeighDurationMinutes !== undefined) need(numIn(v.minWeighDurationMinutes, 0, 1440), 'Thời gian cân tối thiểu phải từ 0 đến 1440 phút');
  },
  backup(v) {
    need(isObj(v), 'Cấu hình sao lưu phải là đối tượng');
    if (v.intervalDays !== undefined) need(intIn(v.intervalDays, 0, 3650), 'Chu kỳ sao lưu phải là số nguyên ngày từ 0 đến 3650');
    if (v.keepDaily !== undefined) need(intIn(v.keepDaily, 1, 3650), 'Số bản sao lưu hằng ngày giữ lại phải từ 1 đến 3650');
    if (v.keepMonthly !== undefined) need(intIn(v.keepMonthly, 1, 240), 'Số bản sao lưu hằng tháng giữ lại phải từ 1 đến 240');
    if (v.auto !== undefined) need(['OFF', 'INTERVAL', 'DAILY'].includes(v.auto), 'Chế độ sao lưu tự động không hợp lệ');
    if (v.remindExportDays !== undefined) need(intIn(v.remindExportDays, 1, 365), 'Số ngày nhắc xuất sao lưu ra ổ khác phải từ 1 đến 365');
  },
  /** Mốc lần xuất bản sao lưu ra ổ khác gần nhất — do máy chủ ghi khi backup.export thành công. */
  backup_export_last(v) { need(isObj(v) && typeof v.at === 'string' && !Number.isNaN(Date.parse(v.at)), 'Mốc xuất sao lưu không hợp lệ'); },
};

class SettingsService {
  constructor(db, audit) { this.db = db; this.audit = audit; }
  get(key, dflt = null) {
    const r = this.db.get('SELECT value_json FROM settings WHERE key = ?', [key]);
    return r ? JSON.parse(r.value_json) : dflt;
  }
  all() { return Object.fromEntries(this.db.all('SELECT key, value_json FROM settings').map((r) => [r.key, JSON.parse(r.value_json)])); }
  set(key, value) {
    if (!Object.hasOwn(VALIDATORS, key)) throw new ValidationError(`Khóa cấu hình không hợp lệ: ${String(key).slice(0, 60)}`);
    VALIDATORS[key](value);
    if (key === 'duyet_phieu' && !value.bat) {   // tắt khi còn phiếu Nháp → phiếu Nháp sẽ biến mất khỏi mọi số liệu: bắt buộc duyệt/xóa trước
      const n = this.db.get(`SELECT COUNT(*) n FROM phieu_can WHERE trang_thai='ACTIVE' AND trang_thai_duyet='NHAP'`).n;
      if (n) throw new ValidationError(`Còn ${n} phiếu Nháp chưa duyệt — hãy duyệt hoặc xóa chúng trước khi tắt duyệt phiếu`);
    }
    const old = this.get(key);
    this.db.run(`INSERT INTO settings(key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%S','now','localtime')`, [key, JSON.stringify(value)]);
    if (this.audit) this.audit.log('SETTING', 'settings', null, { [key]: old }, { [key]: value });
  }
}
module.exports = { SettingsService, SETTING_KEYS: Object.keys(VALIDATORS) };
