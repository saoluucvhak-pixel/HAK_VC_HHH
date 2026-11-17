'use strict';
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
  },
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
    const old = this.get(key);
    this.db.run(`INSERT INTO settings(key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%S','now','localtime')`, [key, JSON.stringify(value)]);
    if (this.audit) this.audit.log('SETTING', 'settings', null, { [key]: old }, { [key]: value });
  }
}
module.exports = { SettingsService, SETTING_KEYS: Object.keys(VALIDATORS) };
