'use strict';
/**
 * Duyệt phiếu tùy chọn: cài đặt `duyet_phieu` { bat:boolean, cho_tu_duyet?:boolean }. Tắt (mặc định) → mọi phiếu có hiệu lực ngay như trước.
 * cho_tu_duyet (mặc định false): cho người nhập/sửa tự duyệt phiếu của mình — dùng khi chỉ có MỘT người có quyền duyệt.
 */
const { ValidationError } = require('../services/CatalogService');
const { ROLE_PERMS } = require('./permissions');

/** Lỗi "cần xác nhận": thao tác hợp lệ nhưng có hệ quả; giao diện hỏi lại rồi gọi lại với xac_nhan=true. */
class ConfirmRequired extends ValidationError { constructor(m) { super(m); this.name = 'ConfirmRequired'; } }

const ROLES_DUYET = Object.entries(ROLE_PERMS).filter(([, p]) => p.includes('duyet')).map(([r]) => r);
const coQuyenDuyet = (u) => !!u && u.trang_thai === 'ACTIVE' && ROLES_DUYET.includes(u.vai_tro);
/** Số người đang hoạt động có quyền duyệt (DUYET và ADMIN). */
const soNguoiDuyet = (db) => db.get(`SELECT COUNT(*) n FROM nguoi_dung WHERE trang_thai='ACTIVE' AND vai_tro IN (${ROLES_DUYET.map(() => '?').join(',')})`, ROLES_DUYET).n;

function duyetTuDuyet(settings) {
  try { const v = settings && settings.get ? settings.get('duyet_phieu') : null; return !!(v && v.bat && v.cho_tu_duyet); } catch (e) { return false; }
}
function duyetBat(settings) {
  try { const v = settings && settings.get ? settings.get('duyet_phieu') : null; return !!(v && v.bat); } catch (e) { return false; }
}
/** Phiên bản gồm toàn bộ nội dung cần duyệt, kể cả hai lần sửa trong cùng giây. */
function ticketVersionSql(alias = '') {
  const fields = ['updated_at', 'fingerprint', 'kl_hang_kg', 'tong_tien', 'don_gia', 'ty_le_vat', 'bang_gia_id', 'don_vi_van_chuyen_id', 'tuyen_id', 'noi_den_id', 'dot_van_chuyen_id', 'xe_tra_ve', 'loai_hang', 'ghi_chu', 'nhap_boi', 'trang_thai_duyet'];
  const prefix = alias ? `${alias}.` : '';
  return `json_array(${fields.map((field) => prefix + field).join(',')})`;
}
module.exports = { duyetBat, duyetTuDuyet, ticketVersionSql, ConfirmRequired, coQuyenDuyet, soNguoiDuyet };
