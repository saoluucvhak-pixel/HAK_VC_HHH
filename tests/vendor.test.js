'use strict';
/** Thư viện nhúng (HAK Smart Filter) phải đúng nguyên văn bản đã ghi trong MANIFEST — chống sửa tay làm lệch repo nguồn. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dir = path.join(__dirname, '..', 'renderer', 'vendor', 'hak-smart-filter');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'MANIFEST.json'), 'utf8'));
// Băm theo nội dung đã chuẩn hóa xuống dòng (LF): Windows có thể checkout CRLF (core.autocrlf) mà nội dung vẫn là bản nguồn
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');

test('hak-smart-filter nhúng: băm SHA-256 khớp MANIFEST, commit nguồn đầy đủ', () => {
  assert.match(manifest.commit, /^[0-9a-f]{40}$/);
  assert.ok(Object.keys(manifest.files).length >= 3);
  for (const [name, m] of Object.entries(manifest.files)) {
    const got = sha(path.join(dir, name));
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

test('băm không đổi khi file được checkout với xuống dòng CRLF (Windows)', () => {
  const f = path.join(dir, 'smart-filter.js');
  const lf = fs.readFileSync(f, 'utf8');
  const crlf = lf.replace(/\r?\n/g, '\r\n');
  const h = (t) => crypto.createHash('sha256').update(t.replace(/\r\n/g, '\n')).digest('hex');
  assert.notEqual(Buffer.from(crlf).length, Buffer.from(lf).length);
  assert.equal(h(crlf), h(lf));
  assert.equal(h(lf), manifest.files['smart-filter.js'].sha256);
});

test('hak-report-standard nhúng: băm khớp MANIFEST, nạp trước app.js, và định dạng số khớp bản chuẩn', () => {
  const d = path.join(__dirname, '..', 'renderer', 'vendor', 'hak-report-standard');
  const m = JSON.parse(fs.readFileSync(path.join(d, 'MANIFEST.json'), 'utf8'));
  assert.match(m.commit, /^[0-9a-f]{40}$/);
  for (const [name, f] of Object.entries(m.files)) assert.equal(sha(path.join(d, name)), f.sha256, `${name} đã bị sửa so với bản nguồn`);
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.ok(html.indexOf('vendor/hak-report-standard/hak-report-standard.js') >= 0 && html.indexOf('vendor/hak-report-standard/hak-report-standard.js') < html.indexOf('src="app.js"'));
  const R = require('../renderer/vendor/hak-report-standard/hak-report-standard.js');
  const { fmtVN } = require('../src/utils/numfmt');
  for (const [v, dgt] of [[1234567.891, 2], [-0.004, 2], [-0.3, 0], [0, 3], [1250000, 0], [-1234.5, 1]]) assert.equal(fmtVN(v, dgt), R.formatNumber(v, { minDecimals: dgt, maxDecimals: dgt }));
  assert.equal(R.formatNumber(-0.3, { maxDecimals: 0 }), '0');
});
