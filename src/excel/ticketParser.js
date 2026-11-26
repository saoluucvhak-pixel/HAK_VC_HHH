'use strict';
/**
 * Chuyển các dòng của sheet (sau header) thành phiếu cân đã chuẩn hóa + lỗi validate từng dòng.
 * KHÔNG ghi DB. Dừng đọc ở dòng "Tổng cộng" hoặc khi gặp N dòng trống liên tiếp.
 */
const { parseDateTime } = require('../utils/datetime');
const { normalizePlate, displayPlate, isValidPlate } = require('../utils/plate');
const { createHash } = require('node:crypto');
const { unitFrom, headerUnit } = require('./weightUnit');
const { fold } = require('./columnMapping');
const { weightProblem, DEFAULT_LIMITS } = require('../utils/weight');

const num = (v, unit) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  let s = String(v).replace(/\s/g, '');
  if (unit !== 't' || !/^[+-]?\d+\.\d+$/.test(s)) s = s.replace(/\.(?=\d{3}(\D|$))/g, '');
  s = s.replace(',', '.');
  const n = Number(s);
  return isFinite(n) ? n : NaN;
};

/**
 * readAfterTotal: false (mặc định) → dừng ở dòng "Tổng cộng" đầu tiên (đúng IMPORT_SPEC) và cảnh báo dữ liệu bị bỏ lại;
 *                true → coi mỗi dòng "Tổng cộng" là ngăn cách khối và đọc tiếp các khối sau (chỉ nhận dòng trông như phiếu cân; tổng đối chiếu = tổng các dòng Tổng cộng).
 */
function parseTickets(aoa, headerRow, mapping, {
  maxBlankRun = 50, weightLimits = DEFAULT_LIMITS, readAfterTotal = false,
  headers = aoa[headerRow] || [], fallbackUnit = '', strict = false, codeReader = (r, c, value) => value,
} = {}) {
  const get = (row, f) => (mapping[f] === undefined ? undefined : row[mapping[f]]);
  const has = (value) => value != null && String(value).trim() !== '';
  const weightFields = ['kl_hang_kg', 'can_lan_1', 'can_lan_2'];
  const unitsByField = Object.fromEntries(weightFields.map((field) => [field, headerUnit(headers[mapping[field]])]));
  const readWeight = (row, field, errors, total = false) => {
    const value = get(row, field);
    if (!has(value)) return null;
    const parts = typeof value === 'string' && value.trim().match(/^([+-]?[0-9.,\s]+?)\s*([a-zA-ZÀ-ỹ.]+(?:\s+[a-zA-ZÀ-ỹ.]+)*)$/);
    const cellUnit = parts ? unitFrom(parts[2]) : null;
    const rowUnit = get(row, 'weight_unit');
    const columnUnit = unitsByField[field];
    const unit = cellUnit || (columnUnit !== 'invalid' && columnUnit) || unitFrom(rowUnit) || fallbackUnit || (!strict && 'kg');
    const bad = (parts && !cellUnit) || columnUnit === 'invalid' ||
      (!total && has(rowUnit) && !unitFrom(rowUnit)) || !unit;
    if (bad) {
      if (errors) errors.push(`INVALID_UNIT: Không xác định được đơn vị của ${headers[mapping[field]] || field}${has(rowUnit) ? ` (“${rowUnit}”)` : ''}. Chọn kg/tấn hoặc sửa cột đơn vị`);
      return null;
    }
    const n = num(parts ? parts[1] : value, unit);
    return unit === 't' && Number.isFinite(n) ? Math.round(n * 1e6) / 1000 : n;
  };
  const hasTicketData = (row) => ['so_phieu', 'bien_so', ...weightFields].some((field) => has(get(row, field)));
  let lastTicket = aoa.length - 1;
  if (strict) while (lastTicket > headerRow && !hasTicketData(aoa[lastTicket] || [])) lastTicket--;
  const out = [];
  let totalRow = null, totalAt = -1, afterTotal = false;
  let blank = 0;
  for (let r = headerRow + 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const first = fold(row.find((c) => c !== null && c !== undefined && c !== '') ?? '');
    const isTotal = strict
      ? !isValidPlate(get(row, 'bien_so')) && row.some((cell) => /^(?:tong cong|tong khoi luong|tong kl|grand total|total)\b/.test(fold(cell)))
      : first.startsWith('tong cong');
    if (isTotal) {
      // dòng tổng của chính file: lấy KL tổng (nếu có) để đối chiếu với tổng các dòng đã đọc — phát hiện mất dòng / sai đơn vị
      const t = readWeight(row, 'kl_hang_kg', null, true);
      // Công thức chưa có kết quả lưu sẵn: chỉ ghi nhận có dòng tổng.
      const tkg = Number.isFinite(t) ? t : null;
      if (!readAfterTotal) { totalRow = { source_row: r + 1, kl_hang_kg: tkg }; totalAt = r; break; }
      // nhiều khối: cộng dồn các dòng tổng; một ô tổng không có giá trị làm tổng đối chiếu không xác định
      totalRow = totalRow ? { source_row: totalRow.source_row, kl_hang_kg: totalRow.kl_hang_kg === null || tkg === null ? null : totalRow.kl_hang_kg + tkg, blocks: (totalRow.blocks || 1) + 1 } : { source_row: r + 1, kl_hang_kg: tkg, blocks: 1 };
      afterTotal = true;
      continue;
    }
    if (afterTotal) { const bs0 = get(row, 'bien_so'), t10 = get(row, 'ngay_gio_can_1'); if (!(bs0 && isValidPlate(bs0) && parseDateTime(t10))) continue; }   // dưới dòng tổng chỉ nhận dòng trông như phiếu cân (bỏ bảng tóm tắt)
    if (strict && !isValidPlate(get(row, 'bien_so'))) {
      const isSignature = row.some((cell) => /^(?:ngay ky|nguoi lap(?: bieu)?|nguoi ky|ke toan|ky ten|ngay \d{1,2} thang \d{1,2} nam)\b/.test(fold(cell)));
      if (isSignature || (r > lastTicket && has(get(row, 'ngay_gio_can_1')))) continue;
    }
    const originalCode = get(row, 'so_phieu');
    const soPhieu = codeReader(r, mapping.so_phieu, originalCode);
    const hasData = ['bien_so', 'kl_hang_kg', 'ngay_gio_can_1', 'can_lan_1', 'can_lan_2'].some((f) => { const v = get(row, f); return v !== null && v !== undefined && v !== ''; });
    const noSoPhieu = !has(soPhieu);
    if (noSoPhieu && !hasData) {
      if (row.every((c) => c === null || c === undefined || c === '')) { if (++blank >= maxBlankRun) break; }
      continue;
    }
    blank = 0;
    const errors = [];
    const t1 = parseDateTime(get(row, 'ngay_gio_can_1'));
    const t2 = parseDateTime(get(row, 'ngay_gio_can_2'));
    const c1 = readWeight(row, 'can_lan_1', errors);
    const c2 = readWeight(row, 'can_lan_2', errors);
    let kg = readWeight(row, 'kl_hang_kg', errors);
    const bsGoc = get(row, 'bien_so');
    if (noSoPhieu && (!strict || mapping.so_phieu !== undefined)) errors.push('Thiếu số phiếu');
    if (!t1) errors.push('INVALID_TIME: ngày giờ cân 1 không đọc được');
    if (t1 && t2 && t2 < t1) errors.push('INVALID_TIME: cân 2 trước cân 1');
    if (!bsGoc) errors.push('Thiếu biển số');
    else if (!isValidPlate(bsGoc)) errors.push('Biển số không đúng định dạng');
    if (kg === null && c1 !== null && c2 !== null) kg = Math.abs(c2 - c1);
    if (kg === null || isNaN(kg) || kg <= 0) errors.push('INVALID_WEIGHT: KL hàng không hợp lệ');
    if ([c1, c2].some((weight) => weight !== null && weight < 0)) errors.push('INVALID_WEIGHT: số cân không được âm');
    if ([c1, c2].some(Number.isNaN)) errors.push('INVALID_WEIGHT: số cân không hợp lệ');
    const wp = weightProblem(kg, weightLimits); if (wp) errors.push('INVALID_WEIGHT: ' + wp);
    if (c1 !== null && c2 !== null && !isNaN(c1) && !isNaN(c2) && kg !== null && Math.abs(Math.abs(c2 - c1) - kg) > 0.5) {
      errors.push(`INVALID_WEIGHT: |cân2 - cân1| = ${Math.abs(c2 - c1)} ≠ KL hàng ${kg}`);
    }
    const generatedCode = noSoPhieu && strict && mapping.so_phieu === undefined && !errors.length
      ? 'AUTO-' + createHash('sha256').update(JSON.stringify([normalizePlate(bsGoc), t1, t2, c1, c2, kg])).digest('hex').slice(0, 24)
      : '';
    out.push({
      source_row: r + 1,
      so_phieu: noSoPhieu ? generatedCode : String(soPhieu).trim(),
      ngay_gio_can_1: t1, ngay_gio_can_2: t2,
      bien_so_goc: bsGoc == null ? null : String(bsGoc),
      bien_so: bsGoc == null ? null : displayPlate(bsGoc),
      bien_so_chuan: normalizePlate(bsGoc),
      can_lan_1: c1, can_lan_2: c2, kl_hang_kg: kg,
      noi_xuat: get(row, 'noi_xuat') == null ? null : String(get(row, 'noi_xuat')).trim(),
      noi_den: get(row, 'noi_den') == null ? null : String(get(row, 'noi_den')).trim(),
      cong_ty_vc_nguon: get(row, 'cong_ty_vc') ?? null, // chỉ để đối chiếu, KHÔNG dùng để gán đơn vị
      ghi_chu: has(get(row, 'ghi_chu')) ? String(get(row, 'ghi_chu')).trim() : null,
      errors,
    });
  }
  out.totalRow = totalRow;
  // Dữ liệu còn lại DƯỚI dòng "Tổng cộng" (file có nhiều khối/nhiều tháng) không được đọc — đếm các dòng trông như phiếu cân để cảnh báo, không im lặng bỏ qua
  out.ignoredBelowTotal = { count: 0, first_row: null };
  if (totalAt >= 0) {
    for (let r = totalAt + 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      const bs = get(row, 'bien_so'), t1 = get(row, 'ngay_gio_can_1');
      if (bs && isValidPlate(bs) && parseDateTime(t1)) { out.ignoredBelowTotal.count++; if (out.ignoredBelowTotal.first_row === null) out.ignoredBelowTotal.first_row = r + 1; }
    }
  }
  return out;
}

module.exports = { parseTickets };
