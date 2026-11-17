'use strict';
/** Giao diện theo HAK Enterprise Design System (skin luxe): token chuẩn nhúng nguyên văn, VC Cost chỉ đặt tên gọi; tương phản AA; việc cần làm. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createApp, SEED_DIR } = require('../src/app');

const R = path.join(__dirname, '..', 'renderer');
const luxe = fs.readFileSync(path.join(R, 'vendor', 'hak-design', 'luxe.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const styles = fs.readFileSync(path.join(R, 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(R, 'index.html'), 'utf8');

function block(selector) {
  const vars = {};
  for (const m of luxe.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].trim() !== selector) continue;
    for (const v of m[2].matchAll(/--([\w-]+)\s*:\s*([^;]+)/g)) vars[v[1]] = v[2].trim();
  }
  return vars;
}
const T = { ...block(':root'), ...block('[data-skin="luxe"]') };           // skin sáng đang dùng
const lum = (h) => { h = h.slice(1); if (h.length === 3) h = [...h].map((c) => c + c).join(''); const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v);

test('index.html bật skin luxe và nạp token chuẩn trước styles.css', () => {
  assert.match(html, /<html[^>]*data-skin="luxe"/);
  assert.ok(html.indexOf('vendor/hak-design/luxe.css') >= 0 && html.indexOf('vendor/hak-design/luxe.css') < html.indexOf('href="styles.css"'));
});

test('styles.css không tự định nghĩa màu thương hiệu: chỉ đặt tên gọi (alias) trỏ tới token chuẩn có thật', () => {
  const root = styles.slice(styles.indexOf(':root{'), styles.indexOf('}', styles.indexOf(':root{')));
  for (const own of ['--brand:', '--bg:', '--card:', '--line:', '--red:', '--shadow:']) assert.ok(!root.includes(own), `${own} phải lấy từ token chuẩn, không định nghĩa lại`);
  const used = [...root.matchAll(/var\(--([\w-]+)\)/g)].map((m) => m[1]);
  assert.ok(used.length >= 10);
  for (const name of used) assert.ok(name in T || ['green', 'brand-dark'].includes(name), `alias trỏ tới token không có: --${name}`);
  assert.match(root, /--text-mute:var\(--mut-aa\)/);             // chữ phụ dùng biến đạt AA
  assert.match(root, /--green:var\(--brand\)/);
});

test('cặp chữ/nền chính của skin luxe sáng đạt WCAG AA ≥ 4,5:1 (không bỏ qua cặp nào)', () => {
  const PAIRS = [['ink', 'card'], ['ink', 'bg'], ['mut-aa', 'card'], ['mut-aa', 'bg'], ['mut-aa', 'th'], ['brand', 'card'], ['onBrand', 'brand'], ['warnFg', 'warnBg'], ['okFg', 'okBg'], ['infoFg', 'infoBg'], ['red', 'card'], ['sbText', 'deep'], ['warn', 'card']];
  let checked = 0;
  for (const [f, b] of PAIRS) {
    assert.ok(isHex(T[f]) && isHex(T[b]), `thiếu/không phải màu hex: ${f} / ${b}`);
    assert.ok(ratio(T[f], T[b]) >= 4.5, `${f} (${T[f]}) trên ${b} (${T[b]}) = ${ratio(T[f], T[b]).toFixed(2)}:1`);
    checked++;
  }
  assert.equal(checked, PAIRS.length);
});

test('còn focus-visible và reduced-motion; menu theo luồng công việc ①–④', () => {
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
  const app = fs.readFileSync(path.join(R, 'app.js'), 'utf8');
  const groups = [...app.matchAll(/\['(① [^']+|② [^']+|③ [^']+|④ [^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(groups, ['① NHẬP & KIỂM TRA', '② GIÁ & TÍNH CƯỚC', '③ ĐỐI CHIẾU & CHỐT KỲ', '④ BẢNG KÊ & BÁO CÁO']);
});

test('workflow.todo: đếm đúng từng bước theo dữ liệu (trước/sau khi chốt kỳ)', async () => {
  const app = createApp({ dbFile: ':memory:', driver: 'node:sqlite' });
  app.seed.load(JSON.parse(fs.readFileSync(path.join(SEED_DIR, 'sample-v47.json'), 'utf8')));
  let t = app.reports.todo();
  assert.deepEqual([t.tong_phieu, t.chua_tinh_gia, t.chua_chot, t.da_chot, t.import_gan_nhat], [0, 0, 0, 0, null]);
  const SAMPLE = path.join(__dirname, 'fixtures', 'sample-v47.xlsx');
  app.vehicleImport.commit((await app.vehicleImport.preview({ filePath: SAMPLE })).token);
  const dot = app.db.get('SELECT id FROM dot_van_chuyen LIMIT 1');
  const o = await app.imports.open({ filePath: SAMPLE });
  const si = app.imports.sheetInfo(o.token, o.suggestedSheet);
  app.imports.preview(o.token, { sheetName: si.sheetName, headerRow: si.headerRow, mapping: si.mapping, dotId: dot.id });
  app.imports.commit(o.token, {});
  t = app.reports.todo();
  assert.equal(t.tong_phieu, 2035); assert.equal(t.chua_tinh_gia, 0); assert.equal(t.chua_chot, 2035); assert.equal(t.da_chot, 0);
  assert.equal(t.can_doi_chieu, 2035);
  assert.equal(t.import_gan_nhat.inserted_rows, 2035); assert.ok(t.import_gan_nhat.file_name);
  // phiếu chưa tính giá được đếm riêng
  app.db.run(`UPDATE phieu_can SET trang_thai_tinh_gia='NO_PRICE' WHERE id IN (SELECT id FROM phieu_can LIMIT 5)`);
  t = app.reports.todo();
  assert.equal(t.chua_tinh_gia, 5); assert.equal(t.chua_chot, 2030); assert.equal(t.tong_phieu, 2035);
  app.db.run(`UPDATE phieu_can SET trang_thai_tinh_gia='OK' WHERE trang_thai_tinh_gia='NO_PRICE'`);
  app.lock.lock({ loai: 'DOT', dot_id: dot.id });
  t = app.reports.todo();
  assert.deepEqual([t.chua_chot, t.da_chot], [0, 2035]);
});

// ---- chế độ tối: token luxe tối + phần bổ sung của VC Cost, giải biến var(--x), cặp chữ/nền đạt AA
function resolveAll(vars) { const out = {}; for (const [k, v0] of Object.entries(vars)) { let v = v0, n = 0; while (/^var\(--[\w-]+\)$/.test(v) && n++ < 8) v = vars[v.slice(6, -1)]; out[k] = v; } return out; }
const darkExtra = (() => { const m = styles.match(/\[data-theme="dark"\]\{(--warnBg[^}]*)\}/); assert.ok(m, 'thiếu khối bổ sung token tối trong styles.css'); const v = {}; for (const x of m[1].matchAll(/--([\w-]+)\s*:\s*([^;]+)/g)) v[x[1]] = x[2].trim(); return v; })();
const D = resolveAll({ ...block(':root'), ...block('[data-theme="dark"]'), ...block('[data-skin="luxe"]'), ...block('[data-skin="luxe"][data-theme="dark"]'), ...darkExtra });

test('chế độ tối: cặp chữ/nền chính đạt WCAG AA ≥ 4,5:1 (kể cả cảnh báo/thông tin dùng làm chữ trên thẻ)', () => {
  const PAIRS = [['ink', 'card'], ['ink', 'bg'], ['mut-aa', 'card'], ['mut-aa', 'bg'], ['brand', 'card'], ['onBrand', 'brand'], ['red', 'card'], ['warnFg', 'card'], ['infoFg', 'card'], ['okFg', 'card'], ['warnFg', 'warnBg'], ['infoFg', 'infoBg'], ['sbText', 'deep']];
  for (const [f, b] of PAIRS) {
    assert.ok(isHex(D[f]) && isHex(D[b]), `không phải màu hex (tối): ${f}=${D[f]} / ${b}=${D[b]}`);
    assert.ok(ratio(D[f], D[b]) >= 4.5, `tối: ${f} (${D[f]}) trên ${b} (${D[b]}) = ${ratio(D[f], D[b]).toFixed(2)}:1`);
  }
});

test('không còn nền trắng cứng trong styles.css (mọi nền đi qua token để đổi được sáng/tối); có nút đổi giao diện', () => {
  assert.equal((styles.match(/background:\s*#fff\b/gi) || []).length, 0);
  const app = fs.readFileSync(path.join(R, 'app.js'), 'utf8');
  assert.match(app, /vc\.theme/); assert.match(app, /data-act': 'theme'/); assert.match(app, /prefers-color-scheme: dark/);
});
