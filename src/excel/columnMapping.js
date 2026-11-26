'use strict';
/**
 * Tự dò dòng header + nhận dạng cột theo từ đồng nghĩa (không giả định header ở dòng 1).
 * Người dùng luôn được sửa lại mapping ở màn hình Preview.
 */

const SYNONYMS = {
  so_phieu: ['so phieu', 'phieu', 'so chung tu', 'so ct', 'ma phieu', 'ticket', 'so phieu can'],
  ngay_gio_can_1: ['ngay gio can 1', 'ngay can 1', 'can 1 ngay', 'thoi gian can 1', 'ngay gio vao', 'ngay can'],
  ngay_gio_can_2: ['ngay gio can 2', 'ngay can 2', 'can 2 ngay', 'thoi gian can 2', 'ngay gio ra'],
  gio_can_1: ['gio can 1', 'gio vao', 'can 1 gio'],
  gio_can_2: ['gio can 2', 'gio ra', 'can 2 gio'],
  bien_so: ['bien so', 'bien so 1', 'bien so xe', 'so xe', 'bks', 'xe'],
  can_lan_1: ['can lan 1', 'can 1', 'trong luong lan 1', 'trong luong can 1', 'kl lan 1', 'tl lan 1', 'tl can 1'],
  can_lan_2: ['can lan 2', 'can 2', 'trong luong lan 2', 'trong luong can 2', 'kl lan 2', 'tl lan 2', 'tl can 2'],
  kl_hang_kg: ['kl hang (kg)', 'kl hang kg', 'kl hang', 'khoi luong hang', 'khoi luong', 'kl (kg)', 'trong luong hang', 'kl net', 'net'],
  weight_unit: ['don vi khoi luong', 'don vi tinh', 'dvt', 'weight unit'],
  ghi_chu: ['ghi chu', 'notes'],
  noi_xuat: ['kho', 'noi xuat', 'diem xuat', 'kho xuat', 'tram can', 'nha may'],
  noi_den: ['noi den', 'noi nhan', 'diem den', 'cang'],
  cong_ty_vc: ['cong ty van chuyen', 'ten cty vc', 'cty vc', 'don vi van chuyen', 'nha xe', 'ten cong ty', 'cong ty', 'don vi'],
  tu_ngay: ['tu ngay', 'hieu luc tu', 'ngay bat dau'],
  stt: ['stt', 'so tt', 'tt'],
};

/** bỏ dấu tiếng Việt, hạ chữ, gộp khoảng trắng */
function fold(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function matchField(header, { splitTimes = false } = {}) {
  const h = fold(header);
  if (!h) return null;
  let best = null;
  for (const [field, syns] of Object.entries(SYNONYMS)) {
    for (const s of syns) {
      const score = h === s ? 3 : h.replace(/[()]/g, '').trim() === s ? 3 : (h.startsWith(s + ' ') || h.startsWith(s + '(')) ? 2 : 0;
      if (score && (!best || score > best.score || (score === best.score && s.length > best.len))) best = { field, score, len: s.length };
    }
  }
  const field = best?.field ?? null;
  return !splitTimes && (field === 'gio_can_1' || field === 'gio_can_2') ? `ngay_${field}` : field;
}

function mapHeaders(headers) {
  const mapping = {};
  headers.forEach((cell, index) => {
    const field = matchField(cell, { splitTimes: true });
    if (field && mapping[field] === undefined) mapping[field] = index;
  });
  for (const n of [1, 2]) {
    const day = `ngay_gio_can_${n}`, hour = `gio_can_${n}`;
    if (mapping[hour] === undefined) continue;
    if (mapping[day] === undefined) {
      // File cũ có thể dùng tiêu đề “Giờ cân” cho ô chứa cả ngày giờ.
      mapping[day] = mapping[hour];
      delete mapping[hour];
    } else if (/ngay gio|thoi gian/.test(fold(headers[mapping[day]]))) {
      delete mapping[hour];
    }
  }
  return mapping;
}

/**
 * @param {Array<Array>} aoa  mảng 2 chiều từ sheet
 * @param {number} scanRows   số dòng đầu để dò
 * @returns {{headerRow:number, mapping:Object<string,number>, score:number}}
 */
function detectHeader(aoa, scanRows = 30) {
  let best = { headerRow: -1, mapping: {}, score: 0 };
  const REQUIRED = ['so_phieu', 'bien_so', 'kl_hang_kg'];
  for (let r = 0; r < Math.min(scanRows, aoa.length); r++) {
    const mapping = mapHeaders(aoa[r] || []);
    const score = Object.keys(mapping).length + REQUIRED.filter((f) => mapping[f] !== undefined).length * 2;
    if (score > best.score) best = { headerRow: r, mapping, score };
  }
  return best;
}

module.exports = { SYNONYMS, fold, matchField, mapHeaders, detectHeader };
