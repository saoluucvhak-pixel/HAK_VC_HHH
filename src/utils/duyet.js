'use strict';
/** Duyệt phiếu tùy chọn: cài đặt `duyet_phieu` {bat:boolean}. Tắt (mặc định) → mọi phiếu có hiệu lực ngay như trước. */
function duyetBat(settings) {
  try { const v = settings && settings.get ? settings.get('duyet_phieu') : null; return !!(v && v.bat); } catch (e) { return false; }
}
module.exports = { duyetBat };
