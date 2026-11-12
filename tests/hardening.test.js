'use strict';
/** Bất biến CSDL, đường dẫn an toàn, định dạng không ra "-0", PriceResolver với ngày rỗng, CSP. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createApp, SEED_DIR } = require('../src/app');
const { isInside } = require('../src/utils/safePath');
const { resolvePrice } = require('../src/services/PriceResolver');

const SAMPLE = path.join(__dirname, 'fixtures', 'sample-v47.xlsx');

function lockedApp() {
  const app = createApp({ dbFile: ':memory:', driver: 'node:sqlite' });
  app.seed.load(JSON.parse(fs.readFileSync(path.join(SEED_DIR, 'sample-v47.json'), 'utf8')));
  app.vehicleImport.commit(app.vehicleImport.preview({ filePath: SAMPLE }).token);
  const dot = app.db.get('SELECT id FROM dot_van_chuyen LIMIT 1');
  const o = app.imports.open({ filePath: SAMPLE });
  const si = app.imports.sheetInfo(o.token, o.suggestedSheet);
  app.imports.preview(o.token, { sheetName: si.sheetName, headerRow: si.headerRow, mapping: si.mapping, dotId: dot.id });
  app.imports.commit(o.token, {});
  app.lock.lock({ loai: 'DOT', dot_id: dot.id });
  return app;
}

test('chot_ky_snapshot và audit_log bất biến ở mức CSDL', () => {
  const app = lockedApp();
  const sid = app.db.get('SELECT phieu_can_id id FROM chot_ky_snapshot LIMIT 1').id;
  assert.throws(() => app.db.run('UPDATE chot_ky_snapshot SET tong_tien=1 WHERE phieu_can_id=?', [sid]), /bất biến/);
  assert.throws(() => app.db.run('DELETE FROM chot_ky_snapshot WHERE phieu_can_id=?', [sid]), /bất biến/);
  assert.throws(() => app.db.run(`UPDATE audit_log SET note='x'`), /chỉ được thêm/);
  assert.throws(() => app.db.run('DELETE FROM audit_log'), /chỉ được thêm/);
  assert.ok(app.db.get('SELECT COUNT(*) n FROM audit_log').n > 0);
  // vẫn mở khóa bình thường (snapshot được giữ làm lịch sử)
  const k = app.db.get('SELECT id FROM chot_ky LIMIT 1');
  assert.equal(app.lock.unlock(k.id, 'kiểm thử').ok, true);
  assert.ok(app.db.get('SELECT COUNT(*) n FROM chot_ky_snapshot').n > 0);
});

test('isInside: chặn .., đường dẫn ngoài và tiền tố giả', () => {
  const base = path.join(path.sep, 'data', 'exports');
  assert.equal(isInside(base, path.join(base, 'a.xlsx')), true);
  assert.equal(isInside(base, path.join(base, 'sub', 'a.xlsx')), true);
  assert.equal(isInside(base, path.join(base, '..', 'data', 'app.db')), false);
  assert.equal(isInside(base, path.join(path.sep, 'data', 'exports2', 'a.xlsx')), false);
  assert.equal(isInside(base, path.join(path.sep, 'etc', 'passwd')), false);
  assert.equal(isInside(base, base), false);
  assert.equal(isInside(base, ''), false);
  assert.equal(isInside(base, null), false);
});

test('PriceResolver: ngày rỗng/sai → NO_PRICE, không so sánh chuỗi "undefined"', () => {
  const rule = { id: 1, tuyen_id: 1, don_vi_van_chuyen_id: null, loai_hang: null, tu_ngay: '2026-01-01', den_ngay: null, trang_thai: 'ACTIVE' };
  for (const date of [undefined, null, '', 'abc']) assert.equal(resolvePrice({ routeId: 1, carrierId: 1, goodsType: null, date }, [rule]).status, 'NO_PRICE');
  assert.equal(resolvePrice({ routeId: 1, carrierId: 1, goodsType: null, date: '2026-05-01' }, [rule]).status, 'OK');
});

test('định dạng số in/PDF không ra "-0"', () => {
  const { nf } = require('../src/print/htmlTemplates');
  assert.equal(nf(-0.3), '0');
  assert.equal(nf(-0.004, 2), '0,00');
  assert.equal(nf(-0), '0');
  assert.equal(nf(-1234.5, 0), '-1.235');
  assert.equal(nf(1234567.891, 2), '1.234.567,89');
  assert.equal(nf(null), '');
});

test('CSP của giao diện chặn object/base/form', () => {
  const csp = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8').match(/Content-Security-Policy" content="([^"]+)"/)[1];
  for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"]) assert.ok(csp.includes(d), d);
  assert.ok(!/unsafe-eval|script-src[^;]*unsafe-inline/.test(csp));
});

test('giao diện: chữ phụ và đỏ đạt tương phản WCAG AA, có focus-visible và reduced-motion', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
  const v = (n) => css.match(new RegExp('--' + n + ':(#[0-9a-fA-F]{6})'))[1];
  const lum = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  for (const [fg, bg] of [['text-mute', '#ffffff'], ['text-mute', v('bg')], ['red', '#ffffff'], ['red', v('bg')], ['text', '#ffffff']]) {
    assert.ok(ratio(v(fg), bg) >= 4.5, `${fg} trên ${bg} = ${ratio(v(fg), bg).toFixed(2)}`);
  }
  assert.ok(/:focus-visible/.test(css));
  assert.ok(/prefers-reduced-motion:\s*reduce/.test(css));
});

test('nâng cấp DB đang ở v4 (có dữ liệu) lên v5: giữ dữ liệu, có backup PRE_MIGRATION, chạy lại không đổi', () => {
  const { DatabaseSync } = require('node:sqlite');
  const os = require('os');
  const { migrate, currentVersion, listMigrations } = require('../src/database/migrator');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  for (const m of listMigrations().filter((x) => x.version <= 4)) fs.copyFileSync(m.file, path.join(dir, m.name));
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db, { dir });
  assert.equal(currentVersion(db), 4);
  db.prepare(`INSERT INTO audit_log(action, entity) VALUES ('TEST','x')`).run();
  let backup = null;
  const r = migrate(db, { backupFn: (b) => { backup = b; } });
  assert.deepEqual(r.applied, ['005_bat_bien.sql']);
  assert.equal(backup.kind, 'PRE_MIGRATION');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_log').get().n, 1);
  assert.throws(() => db.exec('DELETE FROM audit_log'), /chỉ được thêm/);
  assert.equal(migrate(db).applied.length, 0);
});
