'use strict';
/** Ghi lại băm SHA-256 của các thư viện nhúng sau khi cập nhật từ repo nguồn:  node scripts/vendor-manifest.js */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.join(__dirname, '..', 'renderer', 'vendor');
for (const name of fs.readdirSync(root)) {
  const dir = path.join(root, name), file = path.join(dir, 'MANIFEST.json');
  if (!fs.existsSync(file)) continue;
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  // Băm nội dung đã chuẩn hóa xuống dòng (LF) để không phụ thuộc cấu hình checkout của từng máy
  for (const k of Object.keys(m.files)) m.files[k].sha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, k), 'utf8').replace(/\r\n/g, '\n')).digest('hex');
  fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n');
  console.log('Đã cập nhật', file);
}
