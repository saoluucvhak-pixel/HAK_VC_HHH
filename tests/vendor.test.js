'use strict';
/** Thư viện nhúng (HAK Smart Filter) phải đúng nguyên văn bản đã ghi trong MANIFEST — chống sửa tay làm lệch repo nguồn. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dir = path.join(__dirname, '..', 'renderer', 'vendor', 'hak-smart-filter');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'MANIFEST.json'), 'utf8'));

test('hak-smart-filter nhúng: băm SHA-256 khớp MANIFEST, commit nguồn đầy đủ', () => {
  assert.match(manifest.commit, /^[0-9a-f]{40}$/);
  assert.ok(Object.keys(manifest.files).length >= 3);
  for (const [name, m] of Object.entries(manifest.files)) {
    const got = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex');
    assert.equal(got, m.sha256, `${name} đã bị sửa so với bản nguồn (${m.upstream}); cập nhật bằng cách chép lại từ repo nguồn rồi chạy node scripts/vendor-manifest.js`);
  }
});

test('index.html nạp lõi → popover → giao diện → bộ chuyển đổi đúng thứ tự, trước các màn hình', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  const order = ['app.js', 'vendor/hak-smart-filter/smart-filter.js', 'vendor/hak-smart-filter/filter-popover.js', 'vendor/hak-smart-filter/smart-filter-ui.js', 'filters.js', 'views/dashboard.js'];
  const idx = order.map((s) => html.indexOf(`src="${s}"`));
  assert.ok(idx.every((i) => i >= 0), JSON.stringify(idx));
  assert.deepEqual([...idx].sort((a, b) => a - b), idx);
});
