'use strict';
/**
 * Timeline từng xe: thời gian cân, khoảng cách với chuyến trước, cảnh báo bất thường.
 * Chỉ CẢNH BÁO dữ liệu bất thường — không kết luận gian lận.
 */
const { diffMinutes } = require('../utils/datetime');

const DEFAULT_THRESHOLDS = {
  minGapMinutes: 30,          // 2 chuyến liên tiếp cách nhau < 30 phút → cần kiểm tra
  maxWeighDurationMinutes: 240, // cân 1 → cân 2 > 4 giờ → cần kiểm tra
  minWeighDurationMinutes: 1,
};

/** @param {Array} tickets phiếu của 1 xe (bất kỳ thứ tự) */
function buildTimeline(tickets, thresholds = {}) {
  const th = { ...DEFAULT_THRESHOLDS, ...thresholds };
  // Bộ so sánh phải nhất quán (trả 0/tie-break khi bằng nhau): cùng giờ cân thì xếp theo id để thứ tự và khoảng cách giữa chuyến luôn cố định
  const list = [...tickets].sort((a, b) => { const x = a.ngay_gio_can_1 || '', y = b.ngay_gio_can_1 || ''; return x < y ? -1 : x > y ? 1 : (a.id ?? 0) - (b.id ?? 0); });
  let prev = null;
  return list.map((t, i) => {
    const flags = [];
    const duration = diffMinutes(t.ngay_gio_can_1, t.ngay_gio_can_2);
    const gap = prev ? diffMinutes(prev.ngay_gio_can_2, t.ngay_gio_can_1) : null;
    if (duration !== null && duration < 0) flags.push('INVALID_TIME');
    if (duration !== null && duration > th.maxWeighDurationMinutes) flags.push('LONG_WEIGH_DURATION');
    if (duration !== null && duration >= 0 && duration < th.minWeighDurationMinutes) flags.push('SHORT_WEIGH_DURATION');
    if (gap !== null && gap < 0) flags.push('OVERLAP_PREVIOUS_TRIP');
    else if (gap !== null && gap < th.minGapMinutes) flags.push('SHORT_GAP');
    if (Number(t.can_lan_1) > Number(t.can_lan_2)) flags.push('REVERSE_WEIGHING'); // cân 1 (có hàng) > cân 2 (xe rỗng)
    prev = t;
    return { stt: i + 1, ...t, thoi_gian_can_phut: duration, khoang_cach_chuyen_phut: gap, flags };
  });
}

/**
 * Trợ lý kiểm soát rủi ro & bất thường thông minh (Smart Accounting Auditor):
 * Phát hiện toàn diện:
 * 1. Chuyến siêu tốc (Speeding / Short Gap): 2 chuyến liên tiếp của cùng xe cách nhau quá gần
 * 2. Cân lùi / bất thường thời gian (Time Inversion / Duration Anomaly)
 * 3. Lệch xác xe bất thường (Tara Weight Drift): chênh lệch khối lượng xe rỗng (cân 1 hoặc cân 2) > 800kg
 * 4. Tải trọng đột biến (Overload Spike): khối lượng chở vượt 135% trung bình của chính xe đó
 */
function auditAnomalies(tickets, thresholds = {}) {
  const th = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const byVehicle = new Map();
  for (const t of tickets) {
    const k = t.bien_so_chuan || t.bien_so;
    if (!byVehicle.has(k)) byVehicle.set(k, []);
    byVehicle.get(k).push(t);
  }

  const issues = [];
  for (const [bienSo, list] of byVehicle.entries()) {
    const sorted = [...list].sort((a, b) => (a.ngay_gio_can_1 || '').localeCompare(b.ngay_gio_can_1 || '') || (a.id ?? 0) - (b.id ?? 0));
    
    // Tính tải trọng trung bình của xe
    const kls = sorted.map((t) => Number(t.kl_hang_kg) || 0).filter((v) => v > 0);
    const avgKl = kls.length ? kls.reduce((a, b) => a + b, 0) / kls.length : 0;

    // Xác định khối lượng bì (xe rỗng) từng chuyến
    const taras = [];

    let prev = null;
    for (let i = 0; i < sorted.length; i++) {
      const t = sorted[i];
      const duration = diffMinutes(t.ngay_gio_can_1, t.ngay_gio_can_2);
      const gap = prev ? diffMinutes(prev.ngay_gio_can_2 || prev.ngay_gio_can_1, t.ngay_gio_can_1) : null;
      
      // Khối lượng xe rỗng (nếu có cân 2 lần: xe rỗng là min(cân 1, cân 2))
      const c1 = Number(t.can_lan_1) || 0, c2 = Number(t.can_lan_2) || 0;
      const tara = (c1 > 0 && c2 > 0) ? Math.min(c1, c2) : null;
      if (tara) taras.push({ ticketId: t.id, soPhieu: t.so_phieu, tara, ngay: t.ngay_gio_can_1 });

      const flags = [];
      if (duration !== null && duration < 0) flags.push({ code: 'INVALID_TIME', text: 'Thời gian cân 2 trước cân 1 (nghịch đảo)' });
      if (duration !== null && duration > th.maxWeighDurationMinutes) flags.push({ code: 'LONG_WEIGH_DURATION', text: `Thời gian cân kéo dài (${duration} phút > ${th.maxWeighDurationMinutes}p)` });
      if (gap !== null && gap >= 0 && gap < th.minGapMinutes) flags.push({ code: 'SHORT_GAP', text: `Chuyến quay vòng quá nhanh (cách chuyến trước ${gap} phút < ${th.minGapMinutes}p)` });
      if (c1 > 0 && c2 > 0 && c1 > c2) flags.push({ code: 'REVERSE_WEIGHING', text: 'Cân 1 lớn hơn cân 2 (xe vào có hàng, ra xe không)' });
      
      // Kiểm tra đột biến tải trọng (> 140% trung bình và chênh > 5 tấn)
      const curKl = Number(t.kl_hang_kg) || 0;
      if (avgKl > 10000 && curKl > avgKl * 1.4 && (curKl - avgKl) > 5000) {
        flags.push({ code: 'OVERLOAD_SPIKE', text: `Tải trọng đột biến (${(curKl/1000).toFixed(1)} tấn so với TB ${(avgKl/1000).toFixed(1)} tấn)` });
      }

      if (flags.length) {
        issues.push({
          ticket_id: t.id,
          so_phieu: t.so_phieu,
          bien_so: t.bien_so,
          ngay_gio_can_1: t.ngay_gio_can_1,
          noi_xuat: t.noi_xuat || t.noi_xuat_goc,
          kl_hang_kg: t.kl_hang_kg,
          flags,
        });
      }
      prev = t;
    }

    // Kiểm tra lệch xác xe rỗng (Tara Drift) giữa các chuyến
    if (taras.length >= 2) {
      for (let j = 1; j < taras.length; j++) {
        const diff = Math.abs(taras[j].tara - taras[j - 1].tara);
        if (diff > 800) { // Lệch quá 800kg xác xe
          issues.push({
            ticket_id: taras[j].ticketId,
            so_phieu: taras[j].soPhieu,
            bien_so: bienSo,
            ngay_gio_can_1: taras[j].ngay,
            flags: [{ code: 'TARA_DRIFT', text: `Lệch xác xe rỗng bất thường (${diff.toLocaleString('vi-VN')} kg so với chuyến trước)` }],
          });
        }
      }
    }
  }

  return {
    totalChecked: tickets.length,
    anomalyCount: issues.length,
    issues,
  };
}

module.exports = { buildTimeline, auditAnomalies, DEFAULT_THRESHOLDS };
