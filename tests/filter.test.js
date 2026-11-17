'use strict';
/** Bộ lọc thông minh phía backend: chọn nhiều giá trị, tìm không dấu, đếm, kỳ, nhãn phạm vi trên chứng từ. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createApp, SEED_DIR } = require('../src/app');
const { asIds, oneId } = require('../src/utils/filterIds');
const { filterLabels, statementDoc } = require('../src/print/documents');

const SAMPLE = path.join(__dirname, 'fixtures', 'sample-v47.xlsx');
async function setup() {
  const app = createApp({ dbFile: ':memory:', driver: 'node:sqlite' });
  app.seed.load(JSON.parse(fs.readFileSync(path.join(SEED_DIR, 'sample-v47.json'), 'utf8')));
  app.vehicleImport.commit((await app.vehicleImport.preview({ filePath: SAMPLE })).token);
  const dot = app.db.get('SELECT id FROM dot_van_chuyen LIMIT 1');
  const o = await app.imports.open({ filePath: SAMPLE });
  const si = app.imports.sheetInfo(o.token, o.suggestedSheet);
  app.imports.preview(o.token, { sheetName: si.sheetName, headerRow: si.headerRow, mapping: si.mapping, dotId: dot.id });
  app.imports.commit(o.token, {});
  return app;
}
const n = (app, f) => app.reports.count(f).kept;

test('asIds / oneId: mảng, một giá trị, rỗng', () => {
  assert.deepEqual(asIds([1, '2', 'x', null]), [1, 2]);
  assert.deepEqual(asIds('5'), [5]); assert.deepEqual(asIds(''), []); assert.deepEqual(asIds(null), []);
  assert.equal(oneId([7]), 7); assert.equal(oneId('7'), 7); assert.equal(oneId([1, 2]), null); assert.equal(oneId([]), null);
});

test('chọn nhiều đơn vị / nơi xuất: IN (...) = tổng các phần; một id (kiểu cũ) vẫn dùng được', async () => {
  const app = await setup();
  const dv = app.db.all('SELECT id FROM don_vi_van_chuyen ORDER BY id').map((x) => x.id);
  const each = dv.map((id) => n(app, { don_vi_id: id }));
  assert.equal(each.reduce((a, b) => a + b, 0), n(app, {}));                         // các đơn vị chia hết toàn bộ
  assert.equal(n(app, { don_vi_id: [dv[0], dv[1]] }), each[0] + each[1]);
  assert.equal(n(app, { don_vi_id: [String(dv[0])] }), each[0]);                    // id dạng chuỗi
  assert.equal(n(app, { don_vi_id: [] }), n(app, {}));                              // mảng rỗng = không lọc
  const nx = app.db.all('SELECT id FROM dia_diem').map((x) => x.id);
  assert.equal(nx.reduce((a, id) => a + n(app, { noi_xuat_id: id }), 0), n(app, {}));   // mọi phiếu mẫu đều có nơi xuất đã nhận ra
  assert.equal(n(app, { don_vi_id: [dv[0]], noi_xuat_id: nx }), each[0]);                // kết hợp 2 trường: giao của hai tập
});

test('tìm kiếm không dấu, hoa-thường; biển số gõ kiểu nào cũng được; tên nơi xuất kể cả tên gọi khác', async () => {
  const app = await setup();
  const total = n(app, {});
  const que = n(app, { search: 'QUE SON' });
  assert.ok(que > 0 && que <= total, `que son = ${que}`);
  assert.equal(n(app, { search: 'quế sơn' }), que);
  const plate = app.db.get('SELECT bien_so_chuan b, bien_so s FROM phieu_can LIMIT 1');
  const per = n(app, { bien_so: plate.s });
  assert.ok(per > 0);
  for (const q of [plate.s, plate.s.toLowerCase(), plate.b.toLowerCase(), plate.s.replace('-', ' ')]) assert.equal(n(app, { search: q }), per, q);
  assert.equal(n(app, { search: 'khong-co-gi-nhu-the-nay' }), 0);
  assert.equal(n(app, { search: '   ' }), total);                                    // chuỗi trống = không lọc
});

test('count/periods: đúng tổng và kỳ có dữ liệu', async () => {
  const app = await setup();
  const c = app.reports.count({ search: 'que son' });
  assert.equal(c.total, 2035); assert.ok(c.kept > 0 && c.kept <= c.total);
  const ps = app.reports.periods();
  assert.ok(ps.length >= 1 && /^\d{4}-\d{2}$/.test(ps[0].ky));
  assert.equal(ps.reduce((a, p) => a + p.n, 0), 2035);
  assert.ok(ps.every((p, i) => i === 0 || ps[i - 1].ky > p.ky));                    // mới nhất trước
});

test('bảng kê chỉ nói về MỘT đơn vị: nhiều/không chọn bị từ chối, một id (mảng hoặc số) dùng được', async () => {
  const app = await setup();
  const dv = app.db.all('SELECT id FROM don_vi_van_chuyen ORDER BY id').map((x) => x.id);
  assert.throws(() => app.reports.statement({ don_vi_id: [dv[0], dv[1]] }), /đúng một đơn vị/);
  assert.throws(() => app.reports.statement({}), /đúng một đơn vị/);
  const a = app.reports.statement({ don_vi_id: [dv[0]] }), b = app.reports.statement({ don_vi_id: dv[0] });
  assert.equal(a.tong_tien, b.tong_tien);
  assert.ok(app.reports.statements({ don_vi_id: [dv[0], dv[1]] }).length === 2);   // danh sách theo các đơn vị đã chọn
});

test('nhãn phạm vi trên chứng từ liệt kê TÊN các giá trị đã chọn (cùng nội dung với chip trên màn hình)', async () => {
  const app = await setup();
  const dv = app.db.all('SELECT id, ma FROM don_vi_van_chuyen ORDER BY id');
  const lab = Object.fromEntries(filterLabels(app, { don_vi_id: [dv[0].id, dv[1].id], search: 'que son', tu_ngay: '2026-10-01', den_ngay: '2026-10-31' }));
  assert.equal(lab['Đơn vị vận chuyển'], `${dv[0].ma}, ${dv[1].ma}`);
  assert.equal(lab['Tìm'], 'que son');
  assert.match(lab['Thời gian'], /01\/10\/2026 → 31\/10\/2026/);
  const doc = statementDoc(app, { don_vi_id: [dv[0].id], search: 'que son' });          // chứng từ dựng được với bộ lọc mới
  assert.ok(doc.st.so_chuyen > 0 && /Tìm: que son/.test(doc.extra));
});
