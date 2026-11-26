'use strict';
const { fold, matchField } = require('./columnMapping');
const { ValidationError } = require('../services/CatalogService');

const FIELDS = {
  so_phieu: 'Số phiếu', ngay_gio_can_1: 'Ngày giờ cân 1', ngay_gio_can_2: 'Ngày giờ cân 2',
  bien_so: 'Biển số', can_lan_1: 'Cân lần 1', can_lan_2: 'Cân lần 2', kl_hang_kg: 'KL hàng',
  weight_unit: 'Đơn vị khối lượng', cong_ty_vc: 'Đơn vị vận chuyển (nguồn)',
  noi_xuat: 'Kho / nơi xuất', noi_den: 'Nơi đến', ghi_chu: 'Ghi chú',
};

function requiredFields(mapping, optionalTicket = false) {
  const fields = optionalTicket ? ['bien_so', 'ngay_gio_can_1'] : ['so_phieu', 'bien_so', 'ngay_gio_can_1'];
  const missing = fields.filter((field) => mapping[field] == null);
  if (mapping.kl_hang_kg == null && (mapping.can_lan_1 == null || mapping.can_lan_2 == null)) missing.push('kl_hang_kg');
  return missing;
}

function headersAt(aoa, row, depth, mergedHeader) {
  const current = aoa[row] || [];
  if (depth === 1) return current.map((cell) => String(cell ?? '').trim());
  const previous = mergedHeader?.(row - 1) || aoa[row - 1] || [];
  return current.map((cell, index) => {
    const parts = [previous[index], cell].map((part) => String(part ?? '').trim()).filter(Boolean);
    return parts.length === 2 && fold(parts[0]) === fold(parts[1]) ? parts[0] : parts.join(' ');
  });
}

function resolveColumns(headers, columns) {
  const mapping = {};
  const problems = [];
  for (const [field, title] of Object.entries(columns)) {
    const matches = headers.flatMap((header, index) => fold(header) === fold(title) ? [index] : []);
    if (matches.length === 1) mapping[field] = matches[0];
    else problems.push({
      level: 'error', field,
      text: matches.length ? `Tiêu đề “${title}” bị trùng ở cột ${matches.map((index) => index + 1).join(', ')}`
        : `Thiếu tiêu đề “${title}” đã ghép cho ${FIELDS[field]}`,
    });
  }
  return { mapping, problems };
}

function suggestColumns(headers) {
  const mapping = {};
  headers.forEach((title, index) => {
    const field = matchField(title);
    if (Object.hasOwn(FIELDS, field) && mapping[field] === undefined) mapping[field] = index;
  });
  return mapping;
}

function validateTemplate(template) {
  if (!template || typeof template.name !== 'string' || !template.name.trim() || template.name.length > 120) {
    throw new ValidationError('Tên mẫu phải có từ 1 đến 120 ký tự');
  }
  const { headerRow, headerRows, columns, fallbackUnit } = template;
  if (!Number.isInteger(headerRow) || ![1, 2].includes(headerRows) || headerRow < headerRows - 1 || headerRow >= 300000) {
    throw new ValidationError('Dòng tiêu đề không hợp lệ');
  }
  if (!['', 'kg', 't'].includes(fallbackUnit)) throw new ValidationError('Đơn vị dự phòng phải là kg hoặc tấn');
  if (!columns || typeof columns !== 'object' || Array.isArray(columns) ||
      Object.entries(columns).some(([field, title]) => !Object.hasOwn(FIELDS, field) || typeof title !== 'string' || !title.trim() || title.length > 500)) {
    throw new ValidationError('Cách ghép cột không hợp lệ');
  }
  if (requiredFields(columns, true).length) throw new ValidationError('Cần ghép Biển số, Ngày giờ cân 1, và KL hàng hoặc cả hai cột cân');
  const titles = Object.values(columns).map(fold);
  if (new Set(titles).size !== titles.length) throw new ValidationError('Mỗi tiêu đề chỉ được ghép với một trường');
  return { name: template.name.trim(), headerRow, headerRows, columns, fallbackUnit };
}

module.exports = { FIELDS, requiredFields, headersAt, resolveColumns, suggestColumns, validateTemplate };
