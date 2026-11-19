'use strict';
const path = require('path');
/** Bộ lọc hộp thoại "Lưu thành…" theo đuôi file xuất (.pdf → PDF, .xlsx → Excel, …). Đuôi lạ → "Tất cả tệp". */
const BY_EXT = {
  '.pdf': [{ name: 'PDF', extensions: ['pdf'] }],
  '.xlsx': [{ name: 'Excel', extensions: ['xlsx'] }],
  '.csv': [{ name: 'CSV', extensions: ['csv'] }],
  '.db': [{ name: 'Cơ sở dữ liệu VC Cost', extensions: ['db'] }],
};
function saveFilters(fileName) {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  return BY_EXT[ext] || [{ name: 'Tất cả tệp', extensions: ['*'] }];
}
module.exports = { saveFilters };
