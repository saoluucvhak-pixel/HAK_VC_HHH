'use strict';
/** Phân quyền tùy chọn: tắt = 1 người dùng như cũ; bật = đăng nhập + quyền theo vai trò, nhật ký ghi tên, bảo vệ quản trị cuối. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { createRuntime } = require('../src/runtime');
const { CHANNEL_PERM, PUBLIC, permissionFor, roleAllows } = require('../src/utils/permissions');

const mk = (o = {}) => createRuntime({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'vcauth-')), driver: 'node:sqlite', ...o });
const call = (rt, ch, a) => rt.dispatch(ch, a || {});
const PW = 'matkhau-manh-1';
async function withAdmin(rt) { return (await call(rt, 'auth.enable', { ten_dang_nhap: 'admin', ho_ten: 'Quản trị', mat_khau: PW })); }
async function addUser(rt, ten, vai_tro) { const r = await call(rt, 'auth.createUser', { ten_dang_nhap: ten, ho_ten: 'Họ ' + ten, vai_tro, mat_khau: PW }); assert.equal(r.ok, true, r.error); return r.data; }
const login = (rt, ten) => call(rt, 'auth.login', { ten_dang_nhap: ten, mat_khau: PW });
/** true nếu bị chặn vì quyền (Forbidden/AuthRequired), false nếu đã qua cửa quyền (lỗi nghiệp vụ khác vẫn tính là qua) */
const blocked = async (rt, ch, a) => { const r = await call(rt, ch, a); return !r.ok && (r.type === 'Forbidden' || r.type === 'AuthRequired'); };

test('khôi phục dữ liệu yêu cầu đăng nhập lại, kể cả khi hai DB dùng cùng ID quản trị', async () => {
  const source = mk();
  const target = mk();
  try {
    const sourceAdmin = await call(source, 'auth.enable', { ten_dang_nhap: 'other-admin', ho_ten: 'Quản trị bộ dữ liệu khác', mat_khau: PW });
    assert.equal(sourceAdmin.ok, true, sourceAdmin.error);
    const snapshot = await call(source, 'backup.now');
    assert.equal(snapshot.ok, true, snapshot.error);
    await withAdmin(target);
    const localBackup = path.join(target.dirs.backups, 'other-data.db');
    fs.copyFileSync(snapshot.data.file, localBackup);
    const restored = await call(target, 'backup.restore', { file: localBackup });
    assert.equal(restored.ok, true, restored.error);
    assert.equal((await call(target, 'auth.status')).data.user, null);
    assert.equal((await call(target, 'app.info')).type, 'AuthRequired');
    assert.equal((await call(target, 'auth.login', { ten_dang_nhap: 'other-admin', mat_khau: PW })).ok, true);
    assert.equal((await call(target, 'app.info')).ok, true);
  } finally {
    source.close();
    target.close();
  }
});

test('mọi kênh API đều có khai báo quyền tường minh (không rơi vào mặc định admin)', () => {
  const rt = mk();
  try {
    const missing = Object.keys(rt.handlers).filter((c) => !PUBLIC.has(c) && !CHANNEL_PERM.has(c));
    assert.deepEqual(missing, []);
    const stale = [...CHANNEL_PERM.keys(), ...PUBLIC].filter((c) => !Object.hasOwn(rt.handlers, c));
    assert.deepEqual(stale, [], 'bảng quyền chứa kênh không còn tồn tại');
    assert.equal(permissionFor('kenh.la'), 'admin');
    assert.equal(roleAllows('XEM', 'nhap'), false); assert.equal(roleAllows('DUYET', 'admin'), false); assert.equal(roleAllows('ADMIN', 'duyet'), true);
  } finally { rt.close(); }
});

test('mặc định KHÔNG áp dụng phân quyền: dùng ngay, không cần đăng nhập, mọi kênh hoạt động như trước', async () => {
  const rt = mk();
  try {
    const st = (await call(rt, 'auth.status')).data;
    assert.equal(st.enabled, false); assert.equal(st.user, null);
    assert.equal((await call(rt, 'settings.set', { key: 'default_noi_den', value: null })).ok, true);
    assert.equal((await call(rt, 'app.info')).ok, true);
    assert.equal((await call(rt, 'backup.now')).ok, true);
  } finally { rt.close(); }
});

test('bật phân quyền: chưa đăng nhập bị chặn, đăng nhập sai bị từ chối, khóa 60 giây sau 5 lần sai, đăng xuất có hiệu lực', async () => {
  const rt = mk();
  try {
    const st = (await withAdmin(rt)).data;
    assert.equal(st.enabled, true); assert.equal(st.user.vai_tro, 'ADMIN');
    assert.equal((await call(rt, 'app.info')).ok, true);
    await call(rt, 'auth.logout');
    const r = await call(rt, 'app.info'); assert.equal(r.ok, false); assert.equal(r.type, 'AuthRequired');
    assert.equal((await call(rt, 'auth.status')).ok, true, 'auth.status công khai');
    for (let i = 0; i < 5; i++) assert.equal((await call(rt, 'auth.login', { ten_dang_nhap: 'admin', mat_khau: 'sai-mat-khau' })).ok, false);
    const locked = await call(rt, 'auth.login', { ten_dang_nhap: 'admin', mat_khau: PW });
    assert.equal(locked.ok, false); assert.match(locked.error, /Sai quá nhiều lần/);
    const row = rt.app.db.get(`SELECT mat_khau_hash h FROM nguoi_dung WHERE ten_dang_nhap='admin'`).h;
    assert.match(row, /^scrypt\$/); assert.ok(!row.includes(PW));
    rt.app.auth.fails.clear();
    assert.equal((await login(rt, 'admin')).ok, true);
    assert.ok(rt.app.db.get(`SELECT COUNT(*) n FROM audit_log WHERE action='AUTH_FAIL'`).n >= 5);
  } finally { rt.close(); }
});

test('ma trận quyền theo vai trò', async () => {
  const rt = mk();
  try {
    await withAdmin(rt);
    for (const [u, r] of [['xem1', 'XEM'], ['nhap1', 'NHAP'], ['duyet1', 'DUYET']]) await addUser(rt, u, r);
    const can = async (who, ch, a) => { await login(rt, who); return !(await blocked(rt, ch, a)); };
    const M = {
      xem1: { ok: ['tickets.list', 'reports.dashboard', 'export.tickets', 'backup.list', 'import.pending'], no: ['tickets.update', 'import.commit', 'import.resolve', 'lock.create', 'settings.set', 'backup.restore', 'auth.users'] },
      nhap1: { ok: ['tickets.update', 'tickets.remove', 'import.open', 'catalog.create', 'backup.now'], no: ['import.resolve', 'import.resolveMany', 'import.undo', 'lock.create', 'lock.unlock', 'price.approveFuel', 'recon.resolve', 'settings.set', 'backup.restore', 'auth.createUser'] },
      duyet1: { ok: ['import.resolve', 'import.undo', 'lock.create', 'lock.unlock', 'price.approveFuel', 'tickets.update', 'reports.dashboard'], no: ['settings.set', 'backup.restore', 'auth.users', 'auth.createUser', 'auth.updateUser', 'seed.loadSample', 'initial.load'] },
      admin: { ok: ['settings.set', 'backup.restore', 'auth.users', 'lock.create', 'tickets.list'], no: [] },
    };
    for (const [who, m] of Object.entries(M)) {
      for (const ch of m.ok) assert.equal(await can(who, ch, ch === 'settings.set' ? { key: 'default_noi_den', value: null } : ch === 'backup.restore' ? { file: 'x' } : {}), true, `${who} phải gọi được ${ch}`);
      for (const ch of m.no) assert.equal(await can(who, ch), false, `${who} KHÔNG được gọi ${ch}`);
    }
    // phản hồi nêu rõ là không đủ quyền
    await login(rt, 'xem1'); const r = await call(rt, 'tickets.remove', { ids: [1], reason: 'x' });
    assert.equal(r.type, 'Forbidden'); assert.match(r.error, /không có quyền/);
  } finally { rt.close(); }
});

test('nhật ký ghi tên đăng nhập của người thao tác', async () => {
  const rt = mk();
  try {
    await withAdmin(rt); await addUser(rt, 'nhap1', 'NHAP');
    await login(rt, 'nhap1');
    const r = await call(rt, 'catalog.create', { table: 'dia_diem', data: { ma: 'TST', ten: 'Điểm thử', loai: 'KHO' } });
    assert.equal(r.ok, true, r.error);
    const a = rt.app.db.get(`SELECT user_name FROM audit_log WHERE entity='dia_diem' ORDER BY id DESC LIMIT 1`);
    assert.equal(a.user_name, 'nhap1');
    assert.equal(rt.app.db.get(`SELECT user_name FROM audit_log WHERE action='USER_CREATE' ORDER BY id DESC LIMIT 1`).user_name, 'admin');
  } finally { rt.close(); }
});

test('quản trị cuối cùng được bảo vệ; khóa tài khoản và đổi vai trò có hiệu lực ngay; đổi/đặt lại mật khẩu', async () => {
  const rt = mk();
  try {
    const adm = (await withAdmin(rt)).data.user;
    const lastAdmin = await call(rt, 'auth.updateUser', { id: adm.id, vai_tro: 'XEM' });
    assert.equal(lastAdmin.ok, false); assert.match(lastAdmin.error, /ít nhất một quản trị/);
    assert.equal((await call(rt, 'auth.updateUser', { id: adm.id, trang_thai: 'INACTIVE' })).ok, false);
    const u = await addUser(rt, 'nhap1', 'NHAP');
    await login(rt, 'nhap1');
    assert.equal(await blocked(rt, 'lock.create'), true);
    await login(rt, 'admin');
    await call(rt, 'auth.updateUser', { id: u.id, vai_tro: 'DUYET' });
    await login(rt, 'nhap1'); assert.equal(await blocked(rt, 'lock.create'), false, 'đổi vai trò có hiệu lực ngay');
    await login(rt, 'admin');
    await call(rt, 'auth.updateUser', { id: u.id, trang_thai: 'INACTIVE' });
    assert.equal((await login(rt, 'nhap1')).ok, false, 'tài khoản bị khóa không đăng nhập được');
    assert.equal((await call(rt, 'auth.createUser', { ten_dang_nhap: 'ab', ho_ten: 'x', vai_tro: 'XEM', mat_khau: PW })).ok, false);
    assert.equal((await call(rt, 'auth.createUser', { ten_dang_nhap: 'user2', ho_ten: 'x', vai_tro: 'XEM', mat_khau: '123' })).ok, false);
    assert.equal((await call(rt, 'auth.createUser', { ten_dang_nhap: 'user2', ho_ten: 'x', vai_tro: 'GIAMDOC', mat_khau: PW })).ok, false);
    await call(rt, 'auth.resetPassword', { id: u.id, mat_khau: 'mat-khau-moi-9' });
    await call(rt, 'auth.updateUser', { id: u.id, trang_thai: 'ACTIVE' });
    assert.equal((await call(rt, 'auth.login', { ten_dang_nhap: 'nhap1', mat_khau: 'mat-khau-moi-9' })).ok, true);
    assert.equal((await call(rt, 'auth.changePassword', { cu: 'sai', moi: 'mat-khau-moi-10' })).ok, false);
    assert.equal((await call(rt, 'auth.changePassword', { cu: 'mat-khau-moi-9', moi: 'mat-khau-moi-10' })).ok, true);
  } finally { rt.close(); }
});

test('tắt phân quyền cần mật khẩu quản trị; VCCOST_RESET_AUTH=1 khôi phục khi mất mật khẩu; dữ liệu nghiệp vụ không đổi', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcauth-'));
  let rt = createRuntime({ dataDir: dir, driver: 'node:sqlite' });
  try {
    await withAdmin(rt);
    const bad = await call(rt, 'auth.disable', { mat_khau: 'sai' }); assert.equal(bad.ok, false);
    assert.equal((await call(rt, 'auth.status')).data.enabled, true);
    rt.close();
    process.env.VCCOST_RESET_AUTH = '1';
    rt = createRuntime({ dataDir: dir, driver: 'node:sqlite' });
    delete process.env.VCCOST_RESET_AUTH;
    assert.equal((await call(rt, 'auth.status')).data.enabled, false);
    assert.equal((await call(rt, 'app.info')).ok, true);
    assert.equal(rt.app.db.get(`SELECT COUNT(*) n FROM audit_log WHERE action='AUTH_RESET'`).n, 1);
    await withAdmin(rt);                                  // bật lại bằng quản trị cũ (đúng mật khẩu)
    assert.equal((await call(rt, 'auth.disable', { mat_khau: PW })).ok, true);
    assert.equal((await call(rt, 'auth.status')).data.enabled, false);
  } finally { delete process.env.VCCOST_RESET_AUTH; try { rt.close(); } catch { /* đã đóng */ } }
});

test('phiên hết hạn khi không hoạt động quá thời gian cho phép', async () => {
  const rt = mk({ idleMs: 50 });
  try {
    await withAdmin(rt);
    assert.equal((await call(rt, 'app.info')).ok, true);
    await new Promise((r) => setTimeout(r, 120));
    const r = await call(rt, 'app.info'); assert.equal(r.ok, false); assert.equal(r.type, 'AuthRequired'); assert.match(r.error, /hết hạn/);
  } finally { rt.close(); }
});

test('khôi phục sang DB khác: phiên của người dùng không có trong DB khôi phục bị hủy; quản trị của DB khôi phục đăng nhập lại được', async () => {
  const rt = mk();
  try {
    await withAdmin(rt);
    const bk = (await call(rt, 'backup.now')).data;                  // bản sao có 1 quản trị
    await addUser(rt, 'nhap1', 'NHAP'); await login(rt, 'nhap1');
    assert.equal((await call(rt, 'app.info')).ok, true);
    await login(rt, 'admin');
    assert.equal((await call(rt, 'backup.restore', { file: bk.file })).ok, true);   // DB khôi phục không có 'nhap1'
    assert.equal((await login(rt, 'nhap1')).ok, false, 'tài khoản không tồn tại trong DB khôi phục không đăng nhập được');
    const r = await call(rt, 'app.info');
    assert.ok(r.ok || r.type === 'AuthRequired');
    await call(rt, 'auth.logout');
    assert.equal((await call(rt, 'app.info')).type, 'AuthRequired');
    assert.equal((await login(rt, 'admin')).ok, true); assert.equal((await call(rt, 'app.info')).ok, true);
  } finally { rt.close(); }
});
