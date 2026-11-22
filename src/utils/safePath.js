'use strict';
const path = require('path');

/** true nếu `p` nằm TRONG thư mục `base` (sau khi chuẩn hóa; chặn `..`, đường dẫn tuyệt đối khác, tiền tố giả như base2). */
function isInside(base, p) {
  if (typeof base !== 'string' || typeof p !== 'string' || !base || !p) return false;
  const rel = path.relative(path.resolve(base), path.resolve(p));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Tên tệp an toàn: bỏ dấu phân cách thư mục, ký tự cấm và chuỗi `..`; luôn là MỘT thành phần tên (không có đường dẫn). */
function safeFileName(name, fallback = 'tep') {
  let s = String(name === undefined || name === null ? '' : name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\.{2,}/g, '.').replace(/^[\s.]+/, '').slice(0, 160);
  if (!s) s = fallback;
  return s;
}
/** Ghép `name` vào `base` và bảo đảm kết quả nằm trong `base`; ném lỗi nếu không. */
function joinInside(base, name) {
  const p = path.join(base, safeFileName(name));
  if (!isInside(base, p)) throw new Error('Tên tệp không hợp lệ');
  return p;
}

module.exports = { isInside, safeFileName, joinInside };
