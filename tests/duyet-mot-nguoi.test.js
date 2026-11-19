'use strict';
/** P1 0.8.2: chế độ 1 người dùng không bị kẹt duyệt — cho_tu_duyet, cảnh báo khi còn < 2 người có quyền duyệt. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { createRuntime } = require('../src/runtime');
const { loadInitialData } = require('../src/services/InitialDataService');
const { SEED_DIR } = require('../src/app');

const PW = 'matkhau-manh-1';
const mk = () => createRuntime({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'vcd1-')), driver: 'node:sqlite' });
const call = (rt, ch, a) => rt.dispatch(ch, a || {});
const ok = async (rt, ch, a) => { const r = await call(rt, ch, a); assert.equal(r.ok, true, ch + ': ' + r.error); return r.data; };
const login = (rt, u) => call(rt, 'auth.login', { ten_dang_nhap: u, mat_khau: PW });
const firstTicket = (rt) => rt.app.db.get(`SELECT id FROM phieu_can WHERE trang_thai='ACTIVE' AND chot_ky_id IS NULL ORDER BY id LIMIT 1`);

async function oneAdmin() {
  const rt = mk(); await loadInitialData(rt.app, SEED_DIR);
  await ok(rt, 'auth.enable', { ten_dang_nhap: 'admin', ho_ten: 'QT', mat_khau: PW });
  return rt;
}

test('1 người dùng (chỉ 1 admin) + duyệt phiếu: mặc định tự duyệt bị từ chối kèm hướng dẫn; bật cho_tu_duyet thì duyệt được và audit ghi tu_duyet', async () => {
  const rt = await oneAdmin();
  try {
    await ok(rt, 'settings.set', { key: 'duyet_phieu', value: { bat: true }, xac_nhan: true });
    const t = firstTicket(rt);
    await ok(rt, 'tickets.update', { id: t.id, data: { xe_tra_ve: 1 }, note: 'sửa' });
    const r = await ok(rt, 'tickets.approve', { ids: [t.id] });
    assert.equal(r.ok, 0); assert.match(r.results[0].reason, /không tự duyệt/); assert.match(r.results[0].reason, /Cho phép tự duyệt/);
    assert.equal(rt.app.tickets.get(t.id).trang_thai_duyet, 'NHAP');
    await ok(rt, 'settings.set', { key: 'duyet_phieu', value: { bat: true, cho_tu_duyet: true } });
    const r2 = await ok(rt, 'tickets.approve', { ids: [t.id] });
    assert.equal(r2.ok, 1);
    const a = rt.app.db.get(`SELECT new_value FROM audit_log WHERE action='APPROVE_TICKET' ORDER BY id DESC LIMIT 1`);
    assert.equal(JSON.parse(a.new_value).tu_duyet, true);
    // danh sách phiếu đánh dấu "tự duyệt"
    const row = (await ok(rt, 'tickets.list', { filter: {}, offset: 0, limit: 1000 })).rows.find((x) => x.id === t.id);
    assert.equal(row.tu_duyet, 1);
  } finally { rt.close(); }
});

test('cho_tu_duyet: giá trị mặc định false, chỉ nhận boolean; phiếu duyệt bởi người khác không bị đánh dấu tự duyệt', async () => {
  const rt = await oneAdmin();
  try {
    assert.ok(!rt.app.settings.get('duyet_phieu') || !rt.app.settings.get('duyet_phieu').cho_tu_duyet, 'mặc định không cho tự duyệt');
    const bad = await call(rt, 'settings.set', { key: 'duyet_phieu', value: { bat: true, cho_tu_duyet: 'có' }, xac_nhan: true });
    assert.equal(bad.ok, false); assert.equal(bad.type, 'ValidationError');
    await ok(rt, 'auth.createUser', { ten_dang_nhap: 'duyet2', ho_ten: 'Duyet 2', vai_tro: 'DUYET', mat_khau: PW });
    await ok(rt, 'settings.set', { key: 'duyet_phieu', value: { bat: true } });        // đủ 2 người duyệt → không cần xác nhận
    const t = firstTicket(rt);
    await ok(rt, 'tickets.update', { id: t.id, data: { xe_tra_ve: 1 }, note: 'sửa' });   // admin sửa
    await login(rt, 'duyet2');
    assert.equal((await ok(rt, 'tickets.approve', { ids: [t.id] })).ok, 1);
    const row = (await ok(rt, 'tickets.list', { filter: {}, offset: 0, limit: 1000 })).rows.find((x) => x.id === t.id);
    assert.equal(row.tu_duyet, 0);
    assert.equal(JSON.parse(rt.app.db.get(`SELECT new_value FROM audit_log WHERE action='APPROVE_TICKET' ORDER BY id DESC LIMIT 1`).new_value).tu_duyet, false);
  } finally { rt.close(); }
});

test('bật duyệt phiếu khi bật phân quyền mà còn < 2 người có quyền duyệt → ConfirmRequired; xac_nhan=true thì được; có cho_tu_duyet thì không cần', async () => {
  const rt = await oneAdmin();
  try {
    const r = await call(rt, 'settings.set', { key: 'duyet_phieu', value: { bat: true } });
    assert.equal(r.ok, false); assert.equal(r.type, 'ConfirmRequired'); assert.match(r.error, /1 người có quyền duyệt/); assert.match(r.error, /tự duyệt/i);
    assert.ok(!rt.app.settings.get('duyet_phieu') || !rt.app.settings.get('duyet_phieu').bat, 'chưa bật vì chưa xác nhận');
    await ok(rt, 'settings.set', { key: 'duyet_phieu', value: { bat: true }, xac_nhan: true });
    await ok(rt, 'settings.set', { key: 'duyet_phieu', value: { bat: true, cho_tu_duyet: true } });   // đã cho tự duyệt → không cần
    assert.equal(rt.app.settings.get('duyet_phieu').cho_tu_duyet, true);
  } finally { rt.close(); }
});

test('khóa hoặc hạ quyền người duyệt làm số người duyệt còn < 2 (khi duyệt phiếu BẬT, không cho tự duyệt) → ConfirmRequired', async () => {
  const rt = await oneAdmin();
  try {
    const d2 = await ok(rt, 'auth.createUser', { ten_dang_nhap: 'duyet2', ho_ten: 'Duyet 2', vai_tro: 'DUYET', mat_khau: PW });
    await ok(rt, 'settings.set', { key: 'duyet_phieu', value: { bat: true } });
    const lock = await call(rt, 'auth.updateUser', { id: d2.id, trang_thai: 'INACTIVE' });
    assert.equal(lock.ok, false); assert.equal(lock.type, 'ConfirmRequired'); assert.match(lock.error, /còn 1 người/);
    const down = await call(rt, 'auth.updateUser', { id: d2.id, vai_tro: 'NHAP' });
    assert.equal(down.type, 'ConfirmRequired');
    assert.equal(rt.app.db.get('SELECT trang_thai t, vai_tro v FROM nguoi_dung WHERE id=?', [d2.id]).t, 'ACTIVE');   // chưa đổi
    await ok(rt, 'auth.updateUser', { id: d2.id, trang_thai: 'INACTIVE', xac_nhan: true });
    assert.equal(rt.app.db.get('SELECT trang_thai t FROM nguoi_dung WHERE id=?', [d2.id]).t, 'INACTIVE');
    // đổi tên (không đổi quyền duyệt) không cần xác nhận; người dùng NHAP không ảnh hưởng
    const n1 = await ok(rt, 'auth.createUser', { ten_dang_nhap: 'nhap1', ho_ten: 'Nhap 1', vai_tro: 'NHAP', mat_khau: PW });
    await ok(rt, 'auth.updateUser', { id: n1.id, ho_ten: 'Nhap 1 moi' });
    await ok(rt, 'auth.updateUser', { id: n1.id, trang_thai: 'INACTIVE' });
  } finally { rt.close(); }
});

test('TẮT phân quyền hoặc TẮT duyệt phiếu: không cảnh báo, hành vi như cũ', async () => {
  const rt = mk(); await loadInitialData(rt.app, SEED_DIR);
  try {
    await ok(rt, 'settings.set', { key: 'duyet_phieu', value: { bat: true } });       // không phân quyền → không cần xác nhận
    const t = firstTicket(rt);
    await ok(rt, 'tickets.update', { id: t.id, data: { xe_tra_ve: 1 }, note: 'sửa' });
    assert.equal((await ok(rt, 'tickets.approve', { ids: [t.id] })).ok, 1);            // không có người dùng → không kẹt
  } finally { rt.close(); }
});
