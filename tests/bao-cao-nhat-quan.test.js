'use strict';
/** 0.8.4: số liệu báo cáo nhất quán — phiếu chưa tính giá không cộng tiền; nơi xuất chưa nhận diện không bị gộp chung. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp, SEED_DIR } = require('../src/app');
const { loadInitialData } = require('../src/services/InitialDataService');

async function mk() { const app = createApp({ dbFile: ':memory:', driver: 'node:sqlite' }); await loadInitialData(app, SEED_DIR); return app; }
const sum = (a, k) => a.reduce((s, x) => s + (Number(x[k]) || 0), 0);
const r2 = (x) => Math.round(x * 100) / 100;

test('phiếu chưa tính giá (xe lạ) vẫn có tiền trong DB nhưng KHÔNG được cộng vào tổng: Phiếu cân = nhóm theo nơi xuất/ngày/đơn vị/xe = Dashboard = Bảng kê', async () => {
  const app = await mk();
  const t = app.db.get(`SELECT id FROM phieu_can WHERE trang_thai='ACTIVE' AND chot_ky_id IS NULL AND tien_truoc_vat>0 ORDER BY id LIMIT 1`);
  app.db.run(`UPDATE phieu_can SET trang_thai_tinh_gia='UNKNOWN_VEHICLE', don_vi_van_chuyen_id=NULL WHERE id=?`, [t.id]);   // đúng trạng thái engine ghi khi xe lạ: vẫn còn don_gia/tiền
  const keep = app.db.get('SELECT tien_truoc_vat v FROM phieu_can WHERE id=?', [t.id]).v; assert.ok(keep > 0);
  const dash = app.reports.dashboard({}).kpi;
  const st = app.reports.statements({});
  const ref = r2(dash.tien_truoc_vat);
  assert.equal(r2(sum(st, 'tien_truoc_vat')), ref, 'Bảng kê = Dashboard');
  assert.equal(r2(app.reports.tickets({}, { limit: 1 }).totals.tien_truoc_vat), ref, 'tổng Phiếu cân');
  assert.equal(r2(app.reports.tickets({}, { limit: 1 }).totals.tong_tien), r2(dash.tong_tien));
  for (const g of ['byOrigin', 'byDate', 'byCarrier', 'byVehicle']) assert.equal(r2(sum(app.reports[g]({}), 'tien_truoc_vat')), ref, g);
  // dòng của phiếu chưa tính giá không hiện tiền (không để người đọc cộng nhầm)
  const row = app.reports.tickets({}, { limit: 100000 }).rows.find((x) => x.id === t.id);
  assert.equal(row.tien_truoc_vat, null); assert.equal(row.tong_tien, null);
});

test('nơi xuất chưa nhận diện: mỗi tên gốc khác nhau là một nhóm riêng, nhãn đúng, tổng kg khớp', async () => {
  const app = await mk();
  const ts = app.db.all(`SELECT id FROM phieu_can WHERE trang_thai='ACTIVE' AND chot_ky_id IS NULL ORDER BY id LIMIT 2`);
  app.db.run(`UPDATE phieu_can SET noi_xuat_id=NULL, noi_xuat_goc='Bãi Xyz', noi_xuat=NULL WHERE id=?`, [ts[0].id]);
  app.db.run(`UPDATE phieu_can SET noi_xuat_id=NULL, noi_xuat_goc='Bãi Abc', noi_xuat=NULL WHERE id=?`, [ts[1].id]);
  const g = app.reports.byOrigin({});
  const xyz = g.find((x) => x.label === 'Bãi Xyz'), abc = g.find((x) => x.label === 'Bãi Abc');
  assert.ok(xyz && abc, 'hai nơi xuất chưa nhận diện phải là hai nhóm: ' + g.map((x) => x.label).join(' | '));
  assert.equal(xyz.so_chuyen, 1); assert.equal(abc.so_chuyen, 1);
  assert.equal(sum(g, 'tong_kg'), app.reports.dashboard({}).kpi.tong_kg);
});
