'use strict';
/** 0.8.4: chốt ĐỢT theo một đơn vị không được khóa cả đợt (phiếu của đơn vị khác phải còn duyệt/sửa/chốt được). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp, SEED_DIR } = require('../src/app');
const { loadInitialData } = require('../src/services/InitialDataService');

async function mk() { const app = createApp({ dbFile: ':memory:', driver: 'node:sqlite' }); await loadInitialData(app, SEED_DIR); return app; }
const findDotCarrier = (app) => {
  for (const d of app.db.all(`SELECT DISTINCT dot_van_chuyen_id id FROM phieu_can WHERE trang_thai='ACTIVE' AND dot_van_chuyen_id IS NOT NULL AND chot_ky_id IS NULL`)) {
    const dvs = app.db.all(`SELECT DISTINCT don_vi_van_chuyen_id id FROM phieu_can WHERE trang_thai='ACTIVE' AND dot_van_chuyen_id=? AND don_vi_van_chuyen_id IS NOT NULL`, [d.id]);
    for (const dv of dvs) { const pv = app.lock.preview({ loai: 'DOT', dot_id: d.id, don_vi_id: dv.id }); if (pv.chot_duoc) return { dot: d.id, dv: dv.id, soDv: dvs.length }; }
  }
  return null;
};

test('chốt đợt có lọc đơn vị: phiếu bị chốt, đợt KHÔNG chuyển KHOA; mở khóa khôi phục; chốt cả đợt (không lọc) thì KHOA', async () => {
  const app = await mk();
  const c = findDotCarrier(app); assert.ok(c, 'dữ liệu mẫu phải có đợt chốt được theo đơn vị');
  const r = app.lock.lock({ loai: 'DOT', dot_id: c.dot, don_vi_id: c.dv });
  assert.ok(r.so_phieu > 0);
  assert.equal(app.db.get('SELECT trang_thai t FROM dot_van_chuyen WHERE id=?', [c.dot]).t, 'MO', 'chốt theo đơn vị không được khóa cả đợt');
  assert.ok(app.db.get('SELECT COUNT(*) n FROM phieu_can WHERE chot_ky_id=?', [r.id]).n > 0);
  // phiếu của đơn vị KHÁC trong cùng đợt (nếu có) vẫn sửa được
  const other = app.db.get(`SELECT id FROM phieu_can WHERE trang_thai='ACTIVE' AND dot_van_chuyen_id=? AND don_vi_van_chuyen_id<>? AND chot_ky_id IS NULL LIMIT 1`, [c.dot, c.dv]);
  if (other) assert.doesNotThrow(() => app.tickets.update(other.id, { ghi_chu: 'vẫn sửa được' }, 'thử'));
  // phiếu đã chốt thì vẫn không sửa tài chính được
  const locked = app.db.get('SELECT id FROM phieu_can WHERE chot_ky_id=? LIMIT 1', [r.id]);
  assert.throws(() => app.tickets.update(locked.id, { xe_tra_ve: 1 }, 'thử'), /chốt|khóa/i);
  app.lock.unlock(r.id, 'thử');
  assert.equal(app.db.get('SELECT trang_thai t FROM dot_van_chuyen WHERE id=?', [c.dot]).t, 'MO');
});

test('chốt cả đợt (không lọc đơn vị) vẫn chuyển đợt sang KHOA và mở khóa đưa về MO', async () => {
  const app = await mk();
  for (const d of app.db.all(`SELECT DISTINCT dot_van_chuyen_id id FROM phieu_can WHERE trang_thai='ACTIVE' AND dot_van_chuyen_id IS NOT NULL AND chot_ky_id IS NULL`)) {
    const pv = app.lock.preview({ loai: 'DOT', dot_id: d.id });
    if (!pv.chot_duoc) continue;
    const r = app.lock.lock({ loai: 'DOT', dot_id: d.id });
    assert.equal(app.db.get('SELECT trang_thai t FROM dot_van_chuyen WHERE id=?', [d.id]).t, 'KHOA');
    app.lock.unlock(r.id, 'thử');
    assert.equal(app.db.get('SELECT trang_thai t FROM dot_van_chuyen WHERE id=?', [d.id]).t, 'MO');
    return;
  }
  assert.fail('không có đợt nào chốt được trong dữ liệu mẫu');
});
