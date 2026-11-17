'use strict';
/** Ghi lại băm SHA-256 của các thư viện nhúng sau khi cập nhật từ repo nguồn:  node scripts/vendor-manifest.js */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dir = path.join(__dirname, '..', 'renderer', 'vendor', 'hak-smart-filter');
const file = path.join(dir, 'MANIFEST.json');
const m = JSON.parse(fs.readFileSync(file, 'utf8'));
for (const k of Object.keys(m.files)) m.files[k].sha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, k))).digest('hex');
fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n');
console.log('Đã cập nhật', file);
