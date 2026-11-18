'use strict';
/** Duyệt phiếu tùy chọn: cài đặt `duyet_phieu` {bat:boolean}. Tắt (mặc định) → mọi phiếu có hiệu lực ngay như trước. */
function duyetBat(settings) {
  try { const v = settings && settings.get ? settings.get('duyet_phieu') : null; return !!(v && v.bat); } catch (e) { return false; }
}
/** Phiên bản gồm toàn bộ nội dung cần duyệt, kể cả hai lần sửa trong cùng giây. */
function ticketVersionSql(alias = '') {
  const fields = ['updated_at', 'fingerprint', 'kl_hang_kg', 'tong_tien', 'don_gia', 'ty_le_vat', 'bang_gia_id', 'don_vi_van_chuyen_id', 'tuyen_id', 'noi_den_id', 'dot_van_chuyen_id', 'xe_tra_ve', 'loai_hang', 'ghi_chu', 'nhap_boi', 'trang_thai_duyet'];
  const prefix = alias ? `${alias}.` : '';
  return `json_array(${fields.map((field) => prefix + field).join(',')})`;
}
module.exports = { duyetBat, ticketVersionSql };
