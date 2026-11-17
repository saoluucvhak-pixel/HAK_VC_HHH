'use strict';
/**
 * Kiểm tra hợp lý khối lượng (kg) — một nơi dùng chung cho import, sửa trực tiếp và duyệt từ import.
 * Chặn các lỗi đơn vị làm sai tiền (KL ghi theo tấn bị hiểu là kg → tiền nhỏ 1000 lần; thừa số 0 → lớn 10 lần).
 */
const KL_MIN_KG = 100;        // một chuyến xe tải dưới 100 kg gần như chắc chắn là số ghi theo tấn
const KL_MAX_KG = 100000;     // trên 100 tấn/chuyến vượt mọi xe đầu kéo

/** Trả chuỗi lỗi hoặc null. */
function weightProblem(kg) {
  if (kg === null || kg === undefined || Number.isNaN(Number(kg))) return null;
  const x = Number(kg);
  if (x > 0 && x < KL_MIN_KG) return `KL hàng ${x} kg quá nhỏ cho một chuyến — có thể đang ghi theo TẤN. Ghép cột KL đúng đơn vị (tiêu đề có "(tấn)") hoặc sửa thành kg`;
  if (x > KL_MAX_KG) return `KL hàng ${x} kg vượt ${KL_MAX_KG.toLocaleString('vi-VN')} kg/chuyến — kiểm tra lại đơn vị hoặc thừa chữ số`;
  return null;
}
module.exports = { KL_MIN_KG, KL_MAX_KG, weightProblem };
