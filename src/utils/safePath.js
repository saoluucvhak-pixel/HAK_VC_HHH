'use strict';
const path = require('path');

/** true nếu `p` nằm TRONG thư mục `base` (sau khi chuẩn hóa; chặn `..`, đường dẫn tuyệt đối khác, tiền tố giả như base2). */
function isInside(base, p) {
  if (typeof base !== 'string' || typeof p !== 'string' || !base || !p) return false;
  const rel = path.relative(path.resolve(base), path.resolve(p));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

module.exports = { isInside };
