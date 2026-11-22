'use strict';
/** Duyệt phiếu (tùy chọn): TẮT = như cũ; BẬT = phiếu mới/sửa là Nháp, chỉ vào số liệu khi được duyệt. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp, SEED_DIR } = require('../src/app');
const { loadInitialData } = require('../src/services/InitialDataService');

const mk = async () => { const app = createApp({ dbFile: ':memory:', driver: 'node:sqlite' }); await loadInitialData(app, SEED_DIR); return app; };
const nNhap = (app) => app.db.get(`SELECT COUNT(*) n FROM phieu_can WHERE trang_thai_duyet='NHAP'`).n;
const first = (app) => app.db.get(`SELECT id FROM phieu_can WHERE trang_thai='ACTIVE' AND chot_ky_id IS NULL ORDER BY id LIMIT 1`);

test('mặc định TẮT: phiếu cũ là Đã duyệt, mọi số liệu như trước, không thể duyệt', async () => {
  const app = await mk();
  assert.equal(nNhap(app), 0);
  assert.throws(() => app.tickets.approve([1]), /Chưa bật duyệt phiếu/);
});

test('BẬT: sửa phiếu → Nháp, loại khỏi số liệu/Dashboard; duyệt → trở lại; kết quả theo từng ID', async () => {
  const app = await mk();
  app.settings.set('duyet_phieu', { bat: true });
  const t = first(app); const before = app.reports.count({});
  app.tickets.update(t.id, { xe_tra_ve: 1 }, 'sửa thử');
  assert.equal(app.tickets.get(t.id).trang_thai_duyet, 'NHAP');
  const after = app.reports.count({});
  assert.equal(after.kept, before.kept - 1);                                   // phiếu Nháp không tính
  assert.equal(app.reports.count({ moi_trang_thai: true }).kept, before.kept);
  const r = app.tickets.approve([t.id, t.id, 999999], 'ok');
  assert.equal(r.ok, 1); assert.equal(r.failed, 1);
  assert.equal(app.tickets.get(t.id).trang_thai_duyet, 'DA_DUYET');
  assert.deepEqual(app.reports.count({}), before);
  assert.equal(app.db.get(`SELECT COUNT(*) n FROM audit_log WHERE action='APPROVE_TICKET'`).n, 1);
  assert.equal(app.tickets.approve([t.id]).results[0].ok, false);       // đã duyệt rồi
});

test('không tắt duyệt khi còn Nháp; chốt kỳ bị chặn khi còn Nháp trong phạm vi', async () => {
  const app = await mk();
  app.settings.set('duyet_phieu', { bat: true });
  const t = first(app);
  app.tickets.update(t.id, { xe_tra_ve: 1 }, 'sửa thử');
  assert.throws(() => app.settings.set('duyet_phieu', { bat: false }), /Nháp|chưa duyệt/i);
  app.tickets.approve([t.id]);
  app.settings.set('duyet_phieu', { bat: false });                       // hết Nháp → tắt được
});

test('chốt kỳ: còn phiếu Nháp trong phạm vi → preview báo chua_duyet và không chốt được', async () => {
  const app = await mk();
  app.settings.set('duyet_phieu', { bat: true });
  const t = first(app); const full = app.tickets.get(t.id);
  const d0 = full.ngay_can.slice(0, 10); const scope = { loai: 'KY', tu_ngay: d0, den_ngay: d0 };
  app.tickets.update(t.id, { xe_tra_ve: 1 }, 'sửa thử');
  const pv = app.lock.preview(scope);
  assert.equal(pv.chua_duyet, 1); assert.equal(pv.chot_duoc, false);
  assert.throws(() => app.lock.lock(scope), /Nháp/);
});

test('duyệt kèm phiên bản: phiếu đổi sau khi chọn → không duyệt, báo rõ; phiếu không đổi → duyệt', async () => {
  const app = await mk();
  app.settings.set('duyet_phieu', { bat: true });
  const ver = (id) => app.reports.tickets({ moi_trang_thai: true, search: app.tickets.get(id).so_phieu }, { offset: 0, limit: 5 }).rows.find((r) => r.id === id).ver;
  const t = first(app);
  app.tickets.update(t.id, { kl_hang_kg: 20000, can_lan_2: app.tickets.get(t.id).can_lan_1 + 20000 }, 'sửa lần 1');
  const v1 = ver(t.id);
  app.tickets.update(t.id, { kl_hang_kg: 21000, can_lan_2: app.tickets.get(t.id).can_lan_1 + 21000 }, 'sửa lần 2 (cùng giây)');
  const r = app.tickets.approve([t.id], null, { [t.id]: v1 });
  assert.equal(r.ok, 0); assert.match(r.results[0].reason, /đã thay đổi sau khi bạn chọn/);
  assert.equal(app.tickets.approve([t.id], null, { [t.id]: ver(t.id) }).ok, 1);
});

test('duyệt: phiếu có KL ngoài ngưỡng hiện hành không duyệt được cho tới khi sửa', async () => {
  const app = await mk();
  app.settings.set('duyet_phieu', { bat: true });
  const t = first(app);
  app.tickets.update(t.id, { kl_hang_kg: 20000, can_lan_2: app.tickets.get(t.id).can_lan_1 + 20000 }, 'sửa');
  app.settings.set('kl_hop_ly', { min_kg: 30000, max_kg: 100000 });
  const r = app.tickets.approve([t.id]);
  assert.equal(r.ok, 0); assert.match(r.results[0].reason, /sửa khối lượng trước khi duyệt/);
});

test('phiên bản duyệt nhận ra thay đổi xe trả về dù cùng giây và giữ nguyên tiền/KL', async () => {
  const app = await mk();
  try {
    app.settings.set('duyet_phieu', { bat: true });
    const t = first(app);
    app.tickets.update(t.id, { xe_tra_ve: 1 }, 'lần đầu');
    app.db.run("UPDATE phieu_can SET updated_at='2026-11-18T10:00:00' WHERE id=?", [t.id]);
    const row = app.reports.tickets({ moi_trang_thai: true }).rows.find((r) => r.id === t.id);
    app.tickets.update(t.id, { xe_tra_ve: 0 }, 'đổi lại cùng giây');
    app.db.run("UPDATE phieu_can SET updated_at='2026-11-18T10:00:00' WHERE id=?", [t.id]);
    assert.equal(app.tickets.get(t.id).kl_hang_kg, row.kl_hang_kg);
    const result = app.tickets.approve([t.id], null, { [t.id]: row.ver });
    assert.equal(result.ok, 0);
    assert.match(result.results[0].reason, /đã thay đổi/);
  } finally { app.close(); }
});

test('0.8.4: chuyển phiếu sang đợt khác không đổi tiền → phiếu đã duyệt giữ Đã duyệt; đổi dữ liệu tính tiền (KL/loại hàng/xe trả về) → về Nháp', async () => {
  const app = await mk();
  app.settings.set('duyet_phieu', { bat: true });
  const t = app.db.get(`SELECT id, dot_van_chuyen_id d FROM phieu_can WHERE trang_thai='ACTIVE' AND chot_ky_id IS NULL AND dot_van_chuyen_id IS NOT NULL ORDER BY id LIMIT 1`);
  const created = app.catalog.create('dot_van_chuyen', { ma_dot: 'D-DICH-084', ten_tau: 'Đợt đích thử' }); const dot2 = { id: created.id !== undefined ? created.id : created };
  app.tickets.update(t.id, { dot_van_chuyen_id: dot2.id }, 'chuyển đợt');
  const a = app.tickets.get(t.id);
  assert.equal(a.dot_van_chuyen_id, dot2.id); assert.equal(a.trang_thai_duyet, 'DA_DUYET', 'chuyển đợt không được đưa phiếu về Nháp');
  app.tickets.update(t.id, { xe_tra_ve: 1 }, 'đổi xe trả về');
  assert.equal(app.tickets.get(t.id).trang_thai_duyet, 'NHAP');
});
