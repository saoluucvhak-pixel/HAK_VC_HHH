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
  app.tickets.update(t.id, { kl_hang_kg: 20000 }, 'sửa thử');
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
  app.tickets.update(t.id, { kl_hang_kg: 20000 }, 'sửa thử');
  assert.throws(() => app.settings.set('duyet_phieu', { bat: false }), /Nháp|chưa duyệt/i);
  app.tickets.approve([t.id]);
  app.settings.set('duyet_phieu', { bat: false });                       // hết Nháp → tắt được
});

test('chốt kỳ: còn phiếu Nháp trong phạm vi → preview báo chua_duyet và không chốt được', async () => {
  const app = await mk();
  app.settings.set('duyet_phieu', { bat: true });
  const t = first(app); const full = app.tickets.get(t.id);
  const d0 = full.ngay_can.slice(0, 10); const scope = { loai: 'KY', tu_ngay: d0, den_ngay: d0 };
  app.tickets.update(t.id, { kl_hang_kg: 20000 }, 'sửa thử');
  const pv = app.lock.preview(scope);
  assert.equal(pv.chua_duyet, 1); assert.equal(pv.chot_duoc, false);
  assert.throws(() => app.lock.lock(scope), /Nháp/);
});

test('duyệt kèm phiên bản: phiếu đổi sau khi chọn → không duyệt, báo rõ; phiếu không đổi → duyệt', async () => {
  const app = await mk();
  app.settings.set('duyet_phieu', { bat: true });
  const ver = (id) => app.reports.tickets({ moi_trang_thai: true, search: app.tickets.get(id).so_phieu }, { offset: 0, limit: 5 }).rows.find((r) => r.id === id).ver;
  const t = first(app);
  app.tickets.update(t.id, { kl_hang_kg: 20000 }, 'sửa lần 1');
  const v1 = ver(t.id);
  app.tickets.update(t.id, { kl_hang_kg: 21000 }, 'sửa lần 2 (cùng giây)');
  const r = app.tickets.approve([t.id], null, { [t.id]: v1 });
  assert.equal(r.ok, 0); assert.match(r.results[0].reason, /đã thay đổi sau khi bạn chọn/);
  assert.equal(app.tickets.approve([t.id], null, { [t.id]: ver(t.id) }).ok, 1);
});

test('duyệt: phiếu có KL ngoài ngưỡng hiện hành không duyệt được cho tới khi sửa', async () => {
  const app = await mk();
  app.settings.set('duyet_phieu', { bat: true });
  const t = first(app);
  app.tickets.update(t.id, { kl_hang_kg: 20000 }, 'sửa');
  app.settings.set('kl_hop_ly', { min_kg: 30000, max_kg: 100000 });
  const r = app.tickets.approve([t.id]);
  assert.equal(r.ok, 0); assert.match(r.results[0].reason, /sửa khối lượng trước khi duyệt/);
});
