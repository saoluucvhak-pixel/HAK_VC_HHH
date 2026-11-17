'use strict';
/**
 * Kiểm tra hợp lý khối lượng (kg) — một nơi dùng chung cho import, sửa trực tiếp và duyệt từ import.
 * Chặn các lỗi đơn vị làm sai tiền (KL ghi theo tấn bị hiểu là kg → tiền nhỏ 1000 lần; thừa số 0 → lớn 10 lần).
 */
const KL_MIN_KG = 100;        // một chuyến xe tải dưới 100 kg gần như chắc chắn là số ghi theo tấn
const KL_MAX_KG = 100000;     // trên 100 tấn/chuyến vượt mọi xe đầu kéo

const DEFAULT_LIMITS = { min_kg: KL_MIN_KG, max_kg: KL_MAX_KG };
/** Ngưỡng đang áp dụng: cài đặt `kl_hop_ly` {min_kg, max_kg} (chủ nghiệp vụ chỉnh được), thiếu thì dùng mặc định. */
function limitsFrom(settings) {
  let v = null; try { v = settings && settings.get ? settings.get('kl_hop_ly') : null; } catch (e) { v = null; }
  const ok = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
  return { min_kg: v && ok(v.min_kg) ? v.min_kg : KL_MIN_KG, max_kg: v && ok(v.max_kg) && v.max_kg > 0 ? v.max_kg : KL_MAX_KG };
}

/** Trả chuỗi lỗi hoặc null. limits: {min_kg, max_kg} (mặc định 100–100.000). */
function weightProblem(kg, limits = DEFAULT_LIMITS) {
  if (kg === null || kg === undefined || Number.isNaN(Number(kg))) return null;
  const x = Number(kg); const lo = limits.min_kg, hi = limits.max_kg;
  if (x > 0 && x < lo) return `KL hàng ${x} kg quá nhỏ cho một chuyến (ngưỡng tối thiểu ${lo.toLocaleString('vi-VN')} kg) — có thể đang ghi theo TẤN. Ghép cột KL đúng đơn vị (tiêu đề có "(tấn)") hoặc sửa thành kg; ngưỡng chỉnh ở Cài đặt`;
  if (x > hi) return `KL hàng ${x} kg vượt ${hi.toLocaleString('vi-VN')} kg/chuyến — kiểm tra lại đơn vị hoặc thừa chữ số; ngưỡng chỉnh ở Cài đặt`;
  return null;
}
module.exports = { KL_MIN_KG, KL_MAX_KG, DEFAULT_LIMITS, limitsFrom, weightProblem };
