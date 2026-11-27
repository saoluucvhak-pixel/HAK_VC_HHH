'use strict';
/**
 * File Excel MẪU Chuẩn Doanh nghiệp để người dùng điền rồi Import vào VC Cost:
 *  - Phiếu cân (ticketTemplate)
 *  - Danh sách xe (vehicleTemplate)
 *  - Bảng kê đối tác (partnerTemplate)
 *  - Giá dầu (fuelTemplate)
 *  - Mẫu tùy chỉnh theo cấu hình (configuredTicketTemplate)
 *
 * Tiêu chuẩn Corporate Palette:
 *  - Header Navy #1F4E79, Brand Dark #143452, Viền #D9D9D9, Zebra #F8FAFC, Font Calibri
 *  - Sheet Protection: Khóa header + ô công thức, mở khóa (unlocked) toàn bộ vùng nhập liệu
 *  - Data Validation Dropdown: Tham chiếu danh mục Đơn vị vận chuyển và Địa điểm đang ACTIVE
 */
const ExcelJS = require('exceljs');
const { FIELDS, validateTemplate } = require('./importTemplate');
const { ValidationError } = require('../services/CatalogService');
const { DEFAULT_FUEL_TYPE } = require('../utils/fuelType');
const { headerUnit } = require('./weightUnit');

const BRAND = 'FF1F4E79', BRAND_DARK = 'FF143452', LINE = 'FFD9D9D9', ZEBRA = 'FFF8FAFC', REQ = 'FFFDE8E8', OPT = 'FFEAF1F8';
const F = (o = {}) => ({ name: 'Calibri', size: 11, ...o });
const border = {
  top: { style: 'thin', color: { argb: LINE } },
  left: { style: 'thin', color: { argb: LINE } },
  bottom: { style: 'thin', color: { argb: LINE } },
  right: { style: 'thin', color: { argb: LINE } },
};
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

function validateRowCount(rows) {
  if (!Number.isInteger(rows) || rows < 1 || rows > 5000) throw new ValidationError('Số dòng nhập liệu phải là số nguyên từ 1 đến 5000');
}

/** cols: [{key, header, width, req, fmt, align, note, eg, validate, formula, text}] */
function dataSheet(wb, { name, title, subtitle, cols, rows = 500, extra = null }) {
  validateRowCount(rows);
  const ws = wb.addWorksheet(name, {
    views: [{ state: 'frozen', ySplit: 5, showGridLines: false }],
    properties: { tabColor: { argb: BRAND } },
  });
  const NC = cols.length;
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });

  // Dòng 1: Tiêu đề banner doanh nghiệp
  ws.mergeCells(1, 1, 1, NC);
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = F({ size: 15, bold: true, color: { argb: 'FFFFFFFF' } });
  t.fill = fill(BRAND_DARK);
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 34;

  // Dòng 2: Hướng dẫn ngắn & mã biểu mẫu
  ws.mergeCells(2, 1, 2, NC);
  const s = ws.getCell(2, 1);
  s.value = subtitle;
  s.font = F({ italic: true, size: 10, color: { argb: 'FF44546A' } });
  s.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
  ws.getRow(2).height = 28;

  // Dòng 3: Khoảng đệm
  ws.getRow(3).height = 6;

  // Dòng 4: Thanh Legend chỉ dẫn trực quan
  ws.mergeCells(4, 1, 4, NC);
  const lg = ws.getCell(4, 1);
  lg.value = {
    richText: [
      { text: '■ ', font: F({ color: { argb: 'FFC0392B' }, bold: true }) },
      { text: 'Cột bắt buộc (tiêu đề xanh đậm, gạch đỏ)    ', font: F({ size: 10 }) },
      { text: '■ ', font: F({ color: { argb: 'FF5B8DB8' }, bold: true }) },
      { text: 'Cột tùy chọn (tiêu đề xanh nhạt)    ', font: F({ size: 10 }) },
      { text: '🔒 ', font: F({ size: 10 }) },
      { text: 'Ô công thức được bảo vệ tự động. Điền dữ liệu từ dòng 6 trở xuống.', font: F({ size: 10, italic: true }) },
    ],
  };
  lg.alignment = { vertical: 'middle', indent: 1, wrapText: true };
  ws.getRow(4).height = NC < 6 ? 34 : 22;

  // Dòng 5: Tiêu đề các cột
  cols.forEach((c, i) => {
    const h = ws.getCell(5, i + 1);
    h.value = c.header;
    h.font = F({ bold: true, color: { argb: 'FFFFFFFF' } });
    h.fill = fill(c.req ? BRAND : 'FF3B6E9C');
    h.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    h.border = { ...border, bottom: { style: 'medium', color: { argb: c.req ? 'FFC0392B' : 'FF5B8DB8' } } };
    h.protection = { locked: true };
  });
  ws.getRow(5).height = 32;

  // Vùng dữ liệu từ dòng 6 trở xuống
  for (let r = 6; r < 6 + rows; r++) {
    cols.forEach((c, i) => {
      const cell = ws.getCell(r, i + 1);
      cell.border = border;
      cell.font = F();
      cell.alignment = { horizontal: c.align || 'left', vertical: 'middle' };
      if (c.fmt) cell.numFmt = c.fmt;
      if (c.text) cell.numFmt = '@';
      if ((r - 6) % 2) cell.fill = fill(ZEBRA);
      if (c.formula) {
        cell.value = { formula: c.formula(r) };
        cell.protection = { locked: true };
      } else {
        cell.protection = { locked: false };
      }
    });
  }

  // Gắn Data Validation
  cols.forEach((c, i) => {
    if (c.validate) {
      for (let r = 6; r < 6 + rows; r++) ws.getCell(r, i + 1).dataValidation = c.validate;
    }
  });

  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: NC } };
  ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '5:5' };
  if (extra) extra(ws);

  // Cài đặt Sheet Protection: Khóa tiêu đề và ô công thức, mở khóa vùng nhập liệu cho người dùng
  ws.protect('', {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatCells: false,
    formatColumns: false,
    formatRows: false,
    insertColumns: false,
    insertRows: false,
    insertHyperlinks: false,
    deleteColumns: false,
    deleteRows: false,
    sort: true,
    autoFilter: true,
  });

  return ws;
}

function guideSheet(wb, { title, intro, cols, tips }) {
  const ws = wb.addWorksheet('Hướng dẫn', { views: [{ showGridLines: false }], properties: { tabColor: { argb: 'FFE0A100' } } });
  [24, 14, 34, 44].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.mergeCells(1, 1, 1, 4);
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = F({ size: 15, bold: true, color: { argb: 'FFFFFFFF' } });
  t.fill = fill(BRAND_DARK);
  t.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 32;

  let r = 3;
  for (const line of intro) {
    ws.mergeCells(r, 1, r, 4);
    const c = ws.getCell(r, 1);
    c.value = line;
    c.font = F();
    c.alignment = { wrapText: true, vertical: 'top' };
    ws.getRow(r).height = 30;
    r++;
  }
  r++;
  ['Cột', 'Yêu cầu', 'Định dạng', 'Ví dụ / giải thích'].forEach((h, i) => {
    const c = ws.getCell(r, i + 1);
    c.value = h;
    c.font = F({ bold: true, color: { argb: 'FFFFFFFF' } });
    c.fill = fill(BRAND);
    c.border = border;
    c.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  ws.getRow(r).height = 24;
  r++;

  for (const c of cols) {
    const vals = [c.header, c.req ? 'Bắt buộc' : 'Tùy chọn', c.format, c.eg];
    vals.forEach((v, i) => {
      const cell = ws.getCell(r, i + 1);
      cell.value = v;
      cell.border = border;
      cell.alignment = { wrapText: true, vertical: 'top' };
      cell.font = F({ bold: i === 0, color: i === 1 ? { argb: c.req ? 'FFC0392B' : 'FF44546A' } : undefined });
      if (i === 1) cell.fill = fill(c.req ? REQ : OPT);
    });
    ws.getRow(r).height = Math.max(22, 15 * Math.ceil(String(c.eg || '').length / 48));
    r++;
  }
  r++;
  ws.mergeCells(r, 1, r, 4);
  const th = ws.getCell(r, 1);
  th.value = 'LƯU Ý QUAN TRỌNG KHI NHẬP LIỆU';
  th.font = F({ bold: true, color: { argb: BRAND } });
  r++;
  for (const tip of tips) {
    ws.mergeCells(r, 1, r, 4);
    const c = ws.getCell(r, 1);
    c.value = '•  ' + tip;
    c.font = F();
    c.alignment = { wrapText: true, vertical: 'top' };
    ws.getRow(r).height = tip.length > 110 ? 32 : 20;
    r++;
  }
  return ws;
}

function listSheetMulti(wb, name, colsDef) {
  const ws = wb.addWorksheet(name, { views: [{ showGridLines: false }], properties: { tabColor: { argb: 'FF8896A5' } } });
  colsDef.forEach((col, idx) => {
    const colIdx = idx + 1;
    ws.getColumn(colIdx).width = col.colWidth || 36;
    const h = ws.getCell(1, colIdx);
    h.value = col.header;
    h.font = F({ bold: true, color: { argb: 'FFFFFFFF' } });
    h.fill = fill(BRAND);
    h.border = border;
    col.items.forEach((v, i) => {
      const c = ws.getCell(i + 2, colIdx);
      c.value = v;
      c.border = border;
      c.font = F();
    });
  });
  return ws;
}

const listValidationCol = (sheet, colLetter, n, msg) => ({
  type: 'list',
  allowBlank: true,
  formulae: [`'${sheet}'!$${colLetter}$2:$${colLetter}$${Math.max(2, n + 1)}`],
  showErrorMessage: true,
  errorStyle: 'warning',
  errorTitle: 'Giá trị chưa có trong danh mục',
  error: msg,
});

async function ticketTemplate({ locations = [], carriers = [], rows } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'VC Cost';
  wb.created = new Date();
  const dtFmt = 'dd/mm/yyyy hh:mm';
  const hasLoc = locations.length > 0;
  const hasCar = carriers.length > 0;

  const cols = [
    { header: 'STT', width: 7, align: 'center', fmt: '0', req: false, format: 'Số thứ tự', eg: 'Không bắt buộc, chỉ để dễ đối chiếu.' },
    { header: 'Số phiếu', width: 16, req: true, text: true, format: 'Văn bản (giữ số 0 đầu)', eg: 'Ví dụ: 000123 hoặc PC-0123. Mỗi phiếu một số riêng.' },
    { header: 'Ngày giờ cân 1', width: 19, align: 'center', req: true, fmt: dtFmt, format: 'dd/mm/yyyy hh:mm', eg: 'Ví dụ: 29/09/2026 13:16 — thời điểm cân lần 1.',
      validate: { type: 'date', operator: 'greaterThan', allowBlank: true, formulae: [new Date(2000, 0, 1)], showErrorMessage: true, errorTitle: 'Ngày giờ không hợp lệ', error: 'Nhập ngày giờ dạng dd/mm/yyyy hh:mm' } },
    { header: 'Ngày giờ cân 2', width: 19, align: 'center', req: false, fmt: dtFmt, format: 'dd/mm/yyyy hh:mm', eg: 'Ví dụ: 29/09/2026 13:52 — thời điểm cân lần 2 (nếu có).' },
    { header: 'Biển số', width: 14, align: 'center', req: true, text: true, format: 'Văn bản', eg: 'Gõ kiểu nào cũng được: 43H-01021, 43h 01021…' },
    { header: 'Cân lần 1 (kg)', width: 15, align: 'right', req: false, fmt: '#,##0', format: 'Số, kg', eg: 'Ví dụ: 45.500 — trọng lượng xe + hàng.' },
    { header: 'Cân lần 2 (kg)', width: 15, align: 'right', req: false, fmt: '#,##0', format: 'Số, kg', eg: 'Ví dụ: 27.700 — trọng lượng xe không.' },
    { header: 'KL hàng (kg)', width: 16, align: 'right', req: true, fmt: '#,##0', format: 'Số, kg', eg: 'Ví dụ: 17.800. Tự động tính = |Cân 1 − Cân 2| khi có đủ hai lần cân (ô đã khóa bảo vệ).',
      formula: (r) => `IF(AND(ISNUMBER(F${r}),ISNUMBER(G${r})),ABS(F${r}-G${r}),"")` },
    { header: 'Nơi xuất', width: 28, req: true, format: 'Chọn từ danh mục hoặc gõ tên', eg: 'Ví dụ: Quế Sơn, Đại Hiệp. Khớp danh mục Địa điểm.',
      validate: hasLoc ? listValidationCol('Danh mục', 'A', locations.length, 'Địa điểm này chưa có trong danh mục — vẫn nhập được, nhưng cần khai báo tên gọi trước khi tính giá.') : undefined },
    { header: 'Công ty vận chuyển', width: 26, req: false, format: 'Chọn từ danh mục hoặc để trống', eg: 'Ví dụ: HAK, HHH, QC. Để trống nếu tra cứu theo Danh mục Xe.',
      validate: hasCar ? listValidationCol('Danh mục', hasLoc ? 'B' : 'A', carriers.length, 'Đơn vị vận chuyển này chưa có trong danh mục.') : undefined },
    { header: 'Ghi chú', width: 24, req: false, format: 'Văn bản', eg: 'Ghi chú thêm về chuyến xe hoặc loại hàng.' },
  ];

  dataSheet(wb, {
    name: 'Phiếu cân',
    rows,
    title: 'HỆ THỐNG QUẢN LÝ VẬN CHUYỂN & CHI PHÍ — VC COST (BM-01/VCC-2026)',
    subtitle: 'MẪU IMPORT PHIẾU CÂN DOANH NGHIỆP — Điền dữ liệu từ dòng 6 trở xuống. Ô công thức đã được bảo vệ tự động.',
    cols,
  });

  guideSheet(wb, {
    title: 'HƯỚNG DẪN ĐIỀN FILE MẪU PHIẾU CÂN VẬN CHUYỂN',
    intro: [
      'File này dùng để nhập hàng loạt phiếu cân vào VC Cost. Chỉ cần điền sheet "Phiếu cân", từ dòng 6 trở xuống.',
      'Import lại cùng một file không tạo phiếu trùng: phiếu giống hệt được bỏ qua; phiếu trùng số nhưng khác dữ liệu được đưa vào "Cần kiểm tra".',
    ],
    cols,
    tips: [
      'Không đổi tên, không xóa, không chèn cột trước dòng tiêu đề (dòng 5). Có thể thêm cột phụ phía sau, VC Cost sẽ bỏ qua.',
      'Số phiếu và Biển số để dạng văn bản để không mất số 0 đầu.',
      'Khối lượng tính bằng kg. Nếu chỉ có số tấn, đặt tên cột là "KL hàng (tấn)" và VC Cost tự đổi ra kg.',
      'Mỗi dòng cần có Số phiếu, Biển số, Nơi xuất và khối lượng (hoặc đủ hai lần cân).',
      'Xe phải có trong Danh mục Xe và đã gán đơn vị vận chuyển thì mới tính được giá; xe mới có thể thêm trước bằng file mẫu "Danh sách xe".',
    ],
  });

  const catCols = [];
  if (hasLoc) catCols.push({ header: 'Địa điểm (ACTIVE)', items: locations, colWidth: 36 });
  if (hasCar) catCols.push({ header: 'Đơn vị vận chuyển (ACTIVE)', items: carriers, colWidth: 32 });
  if (catCols.length) listSheetMulti(wb, 'Danh mục', catCols);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function vehicleTemplate({ carriers = [], rows } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'VC Cost';
  wb.created = new Date();
  const hasCar = carriers.length > 0;
  const cols = [
    { header: 'STT', width: 7, align: 'center', fmt: '0', req: false, format: 'Số thứ tự', eg: 'Không bắt buộc.' },
    { header: 'Biển số', width: 16, align: 'center', req: true, text: true, format: 'Văn bản', eg: 'Gõ kiểu nào cũng được: 43H-01021, 43h 01021, 92H00903…' },
    { header: 'Công ty vận chuyển', width: 36, req: true, format: 'Chọn từ danh mục', eg: 'Mã đơn vị vận chuyển, ví dụ: HAK, HHH, QC. Chọn từ dropdown.',
      validate: hasCar ? listValidationCol('Danh mục', 'A', carriers.length, 'Đơn vị này chưa có trong VC Cost — có thể tạo mới ở bước Xem trước khi import.') : undefined },
    { header: 'Từ ngày', width: 18, align: 'center', req: false, fmt: 'dd/mm/yyyy', format: 'dd/mm/yyyy', eg: 'Ngày xe bắt đầu thuộc đơn vị này. Để trống nếu là từ trước tới nay.' },
  ];
  dataSheet(wb, {
    name: 'Danh sách xe',
    rows,
    title: 'HỆ THỐNG QUẢN LÝ VẬN CHUYỂN & CHI PHÍ — VC COST (BM-02/VCC-2026)',
    cols,
    subtitle: 'MẪU IMPORT DANH SÁCH XE — Mỗi dòng gán một xe cho một đơn vị vận chuyển. Điền xong lưu file .xlsx rồi vào VC Cost → Import phiếu cân → "Import danh mục xe".',
  });
  guideSheet(wb, {
    title: 'HƯỚNG DẪN ĐIỀN FILE MẪU DANH SÁCH XE',
    intro: [
      'Dùng để khai báo hàng loạt xe và đơn vị vận chuyển (chủ xe) của từng xe. Điền sheet "Danh sách xe", từ dòng 6 trở xuống.',
      'Phiếu cân sẽ tính cho đơn vị nào là dựa vào danh sách này theo ngày cân.',
    ],
    cols,
    tips: [
      'Mỗi biển số chỉ nên xuất hiện một lần trong file. Cần ghi nhận xe đổi đơn vị theo thời gian thì import lần lượt từng đợt, mỗi đợt có cột "Từ ngày".',
      'Xe đã có trong VC Cost và cùng đơn vị: bỏ qua. Xe đã có nhưng khác đơn vị: VC Cost hỏi ngày bắt đầu áp dụng đơn vị mới, không tự ghi đè.',
      'Biển số sai định dạng sẽ được liệt kê ở bước Xem trước để sửa lại.',
    ],
  });
  if (hasCar) listSheetMulti(wb, 'Danh mục', [{ header: 'Đơn vị vận chuyển (ACTIVE)', items: carriers, colWidth: 36 }]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function partnerTemplate({ rows } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'VC Cost';
  wb.created = new Date();
  const cols = [
    { header: 'STT', width: 7, align: 'center', fmt: '0', req: false, format: 'Số thứ tự', eg: 'Không bắt buộc.' },
    { header: 'Số phiếu', width: 16, align: 'center', req: true, text: true, format: 'Văn bản', eg: 'Mã số phiếu cân (VD: 1520, PC-0123). Khóa đối chiếu mạnh nhất.' },
    { header: 'Biển số', width: 15, align: 'center', req: true, text: true, format: 'Văn bản', eg: 'Biển số xe (VD: 43H-01055, 43C-12345). Tự chuẩn hóa.' },
    { header: 'Ngày', width: 15, align: 'center', req: true, fmt: 'dd/mm/yyyy', format: 'dd/mm/yyyy', eg: 'Ngày cân hoặc ngày vận chuyển (VD: 29/09/2026).' },
    { header: 'KL hàng (kg)', width: 16, align: 'right', req: true, fmt: '#,##0', format: 'Số (kg)', eg: 'Khối lượng hàng thực tế tính tiền (VD: 19.530).' },
    { header: 'Đơn giá (đ/tấn)', width: 18, align: 'right', req: false, fmt: '#,##0', format: 'Số (đồng)', eg: 'Đơn giá cước vận chuyển (VD: 206.500).' },
    { header: 'Thành tiền (đ)', width: 18, align: 'right', req: false, fmt: '#,##0', format: 'Số (đồng)', eg: 'Cước trước VAT. Có công thức: = ROUND(KL * Đơn giá / 1000, 0).',
      formula: (r) => `IF(AND(ISNUMBER(E${r}),ISNUMBER(F${r})),ROUND(E${r}*F${r}/1000,0),"")` },
    { header: 'VAT (đ)', width: 16, align: 'right', req: false, fmt: '#,##0', format: 'Số (đồng)', eg: 'Tiền thuế VAT (nếu có).' },
    { header: 'Tổng tiền (đ)', width: 18, align: 'right', req: false, fmt: '#,##0', format: 'Số (đồng)', eg: 'Tổng thanh toán (Thành tiền + VAT).' },
    { header: 'Ghi chú', width: 22, req: false, format: 'Văn bản', eg: 'Ghi chú thêm của đơn vị vận chuyển (tùy chọn).' },
  ];
  dataSheet(wb, {
    name: 'Bảng kê đối tác',
    rows,
    title: 'HỆ THỐNG QUẢN LÝ VẬN CHUYỂN & CHI PHÍ — VC COST (BM-03/VCC-2026)',
    cols,
    subtitle: 'MẪU BẢNG KÊ VẬN CHUYỂN (ĐỐI TÁC GỬI ĐỐI CHIẾU) — Mẫu chuẩn gửi cho các đơn vị vận chuyển / nhà xe điền và gửi lại để đối chiếu chi phí.',
  });
  guideSheet(wb, {
    title: 'HƯỚNG DẪN ĐIỀN BẢNG KÊ ĐỐI CHIẾU',
    intro: [
      'Dùng để đơn vị vận chuyển lập bảng kê cước gửi cho bên thuê vận chuyển kiểm tra, đối chiếu trước khi thanh toán.',
      'Điền sheet "Bảng kê đối tác", từ dòng 6 trở xuống. Giữ nguyên dòng tiêu đề.',
    ],
    cols,
    tips: [
      'Nên có đủ Số phiếu và Biển số xe để phần mềm đối chiếu tự động chính xác nhất.',
      'Nếu bảng kê không có Số phiếu, phần mềm vẫn hỗ trợ so khớp tự động theo: Biển số xe + Ngày + Khối lượng cân.',
      'Đơn giá thường tính theo đồng/tấn; thành tiền = ROUND(Khối lượng (kg) * Đơn giá / 1.000, 0). Ô công thức được bảo vệ.',
    ],
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function fuelTemplate({ rows, fuelTypes = [] } = {}) {
  const types = [...new Set([DEFAULT_FUEL_TYPE, ...fuelTypes])];
  const wb = new ExcelJS.Workbook();
  wb.creator = 'VC Cost';
  wb.created = new Date();
  const cols = [
    { header: 'STT', width: 7, align: 'center', fmt: '0', req: false, format: 'Số thứ tự', eg: 'Không bắt buộc.' },
    { header: 'Ngày', width: 16, align: 'center', req: true, fmt: 'dd/mm/yyyy', format: 'dd/mm/yyyy', eg: 'Ví dụ: 01/10/2026 — ngày giá dầu có hiệu lực điều chỉnh.',
      validate: { type: 'date', operator: 'greaterThan', allowBlank: false, formulae: [new Date(2000, 0, 1)], showErrorMessage: true, errorTitle: 'Ngày không hợp lệ', error: 'Nhập ngày dạng dd/mm/yyyy' } },
    { header: 'Giá dầu (đ/lít)', width: 18, align: 'right', req: true, fmt: '#,##0', format: 'Số (đồng/lít)', eg: 'Ví dụ: 20.500 — đơn giá một lít dầu theo quy định hợp đồng.' },
    { header: 'Loại dầu', width: 18, align: 'center', req: false, text: true, format: 'Chọn từ danh mục', eg: `Mặc định là ${DEFAULT_FUEL_TYPE} nếu để trống.`,
      validate: listValidationCol('Danh mục', 'A', types.length, 'Chọn đúng loại dầu áp dụng cho kỳ điều chỉnh.') },
    { header: 'Nguồn điều chỉnh', width: 32, req: false, text: true, format: 'Văn bản', eg: 'Ví dụ: Petrolimex Vùng 1, Quyết định điều chỉnh giá số…' },
    { header: 'Ghi chú', width: 28, req: false, text: true, format: 'Văn bản', eg: 'Ghi chú thêm về đợt điều chỉnh giá dầu.' },
  ];
  dataSheet(wb, {
    name: 'Giá dầu',
    rows,
    title: 'HỆ THỐNG QUẢN LÝ VẬN CHUYỂN & CHI PHÍ — VC COST (BM-04/VCC-2026)',
    cols,
    subtitle: 'MẪU IMPORT GIÁ DẦU — Mỗi dòng là một mốc ngày thay đổi giá dầu. Điền xong lưu file .xlsx rồi vào VC Cost → Giá dầu → "Import giá dầu".',
  });
  guideSheet(wb, {
    title: 'HƯỚNG DẪN ĐIỀN FILE MẪU GIÁ DẦU',
    intro: [
      'Dùng để nhập lịch sử điều chỉnh giá dầu DO phục vụ tính toán bù trừ cước vận chuyển tự động.',
      'Điền sheet "Giá dầu", từ dòng 6 trở xuống. Giữ nguyên dòng tiêu đề.',
    ],
    cols,
    tips: [
      'Cột Ngày và Giá dầu là bắt buộc. Định dạng ngày chuẩn là dd/mm/yyyy.',
      'Nếu cùng một ngày có nhiều giá dầu cho cùng loại dầu, hệ thống sẽ cảnh báo trùng trong file.',
      'Khi import lại ngày đã có trong phần mềm, hệ thống sẽ hỏi để bạn chọn bỏ qua hoặc cập nhật đơn giá mới.',
    ],
  });
  listSheetMulti(wb, 'Danh mục', [{ header: 'Loại dầu', items: types, colWidth: 30 }]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function configuredTicketTemplate(config, { rows = 500 } = {}) {
  validateRowCount(rows);
  const { name, headerRow, headerRows, columns, fallbackUnit, layout } = validateTemplate(config);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'VC Cost';
  const header = headerRow + 1;
  const entries = Object.entries(columns).map(([field, title], index) => ({
    field, title, col: (layout?.positions[field] ?? index) + 1,
  }));
  const data = wb.addWorksheet(layout?.sheetName || 'Phiếu cân', {
    views: [{ state: 'frozen', ySplit: header, showGridLines: false }],
    properties: { tabColor: { argb: BRAND } },
  });
  const availableSheetName = (label) => data.name.toLowerCase() === label.toLowerCase() ? label + ' (mẫu)' : label;
  const example = wb.addWorksheet(availableSheetName('Minh họa'));

  const styleHeader = (cell, title) => {
    cell.value = title;
    cell.font = F({ bold: true, color: { argb: 'FFFFFFFF' } });
    cell.fill = fill(BRAND);
    cell.border = border;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  };

  const weightFields = ['kl_hang_kg', 'can_lan_1', 'can_lan_2'].filter((field) => Object.hasOwn(columns, field));
  const explicit = weightFields.map((field) => headerUnit(columns[field])).filter(Boolean);
  const rowUnit = headerUnit(columns.kl_hang_kg) || (new Set(explicit).size <= 1 ? explicit[0] || fallbackUnit || 'kg' : null);

  const valuesFor = (i) => {
    const net = 15000 + i * 500;
    const weights = { kl_hang_kg: net, can_lan_1: 30000, can_lan_2: 30000 - net };
    const weightCell = (field) => {
      const unit = headerUnit(columns[field]) || (columns.weight_unit && rowUnit) || fallbackUnit;
      if (!unit) return `${weights[field]} kg`;
      return unit === 't' ? weights[field] / 1000 : weights[field];
    };
    return {
      so_phieu: `0000${i + 1}`, bien_so: `92H-9000${i + 1}`, ngay_gio_can_1: columns.gio_can_1 ? '05/10/2026' : `05/10/2026 08:0${i}`, gio_can_1: `08:0${i}`,
      ngay_gio_can_2: columns.gio_can_2 ? '05/10/2026' : `05/10/2026 08:1${i}`, gio_can_2: `08:1${i}`, weight_unit: rowUnit === 't' ? 'tấn' : rowUnit,
      noi_xuat: 'Kho mẫu', noi_den: 'Nơi đến mẫu', tai_xe: 'Tài xế mẫu', cong_ty_vc: 'Đơn vị mẫu', ghi_chu: 'Dữ liệu minh họa',
      ...Object.fromEntries(weightFields.map((field) => [field, weightCell(field)])),
    };
  };

  const samples = Array.from({ length: 3 }, (_, i) => valuesFor(i));
  for (const { field, title, col } of entries) {
    data.getColumn(col).width = Math.max(18, Math.min(40, title.length + 4));
    example.getColumn(col).width = data.getColumn(col).width;
    styleHeader(data.getCell(header, col), title);
    styleHeader(example.getCell(2, col), title);

    for (let i = 0; i < 3; i++) {
      const cell = example.getCell(3 + i, col);
      cell.value = samples[i][field] ?? null;
      cell.border = border;
      cell.font = F();
      if (i % 2) cell.fill = fill(ZEBRA);
      if (field === 'so_phieu') cell.numFmt = '@';
      else if (field === 'kl_hang_kg' || field === 'can_lan_1' || field === 'can_lan_2') cell.numFmt = '#,##0.###';
    }

    // Định dạng các dòng nhập liệu trên sheet dữ liệu
    for (let r = header + 1; r <= header + rows; r++) {
      const cell = data.getCell(r, col);
      cell.border = border;
      cell.font = F();
      cell.protection = { locked: false };
      if ((r - header - 1) % 2) cell.fill = fill(ZEBRA);
      if (field === 'so_phieu' || field === 'bien_so') cell.numFmt = '@';
      else if (field === 'kl_hang_kg' || field === 'can_lan_1' || field === 'can_lan_2') cell.numFmt = '#,##0.###';
    }
  }

  for (let row = header - headerRows + 1; row < header; row++) data.getRow(row).height = 18;
  data.getRow(header).height = 30;
  example.getCell(1, 1).value = 'Ba dòng minh họa để tham khảo khi điền phiếu';
  example.getCell(1, 1).font = F({ bold: true, color: { argb: BRAND_DARK } });

  const sampleVehicles = wb.addWorksheet(availableSheetName('Danh mục mẫu'), { properties: { tabColor: { argb: 'FF8896A5' } } });
  sampleVehicles.getColumn(1).width = 20;
  sampleVehicles.getColumn(2).width = 25;
  styleHeader(sampleVehicles.getCell('A1'), 'Biển số minh họa');
  styleHeader(sampleVehicles.getCell('B1'), 'Tài xế minh họa');
  samples.forEach((row, i) => {
    const r = sampleVehicles.addRow([row.bien_so, `Tài xế mẫu ${i + 1}`]);
    r.getCell(1).border = border;
    r.getCell(2).border = border;
  });

  const guide = wb.addWorksheet(availableSheetName('Hướng dẫn'), { properties: { tabColor: { argb: 'FFE0A100' } } });
  guide.getColumn(1).width = 95;
  const guideRows = [
    `MẪU NHẬP EXCEL PHIẾU CÂN — ${name}`,
    `Điền phiếu thực tế trong sheet “${data.name}”, từ dòng ${header + 1}. Giữ nguyên tên tiêu đề.`,
    `Dùng sheet “${example.name}” để xem cách điền. Dùng mã nơi xuất và nơi đến có trong danh mục.`,
    'Số phiếu là văn bản. Nhập khối lượng theo đơn vị ở tiêu đề hoặc cột đơn vị.',
    'BẢNG ĐỐI ỨNG CÁC TRƯỜNG DỮ LIỆU:',
  ];
  guideRows.forEach((txt, idx) => {
    const row = guide.addRow([txt]);
    row.getCell(1).font = idx === 0 ? F({ bold: true, size: 14, color: { argb: BRAND_DARK } }) : F();
  });
  for (const { field, title } of entries) {
    const row = guide.addRow([`•  ${FIELDS[field]} → "${title}"`]);
    row.getCell(1).font = F();
  }

  // Khóa tiêu đề, mở vùng nhập liệu
  data.protect('', {
    selectLockedCells: true,
    selectUnlockedCells: true,
    sort: true,
    autoFilter: true,
  });

  return wb.xlsx.writeBuffer();
}

module.exports = { ticketTemplate, vehicleTemplate, partnerTemplate, fuelTemplate, configuredTicketTemplate };
