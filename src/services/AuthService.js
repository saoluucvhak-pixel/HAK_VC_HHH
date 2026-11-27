'use strict';
/**
 * Phân quyền TÙY CHỌN (offline, người dùng cục bộ).
 *  - Tắt (mặc định): 1 người dùng, không đăng nhập — hành vi như trước.
 *  - Bật: phải đăng nhập; mỗi kênh API cần quyền theo vai trò (utils/permissions); nhật ký ghi tên đăng nhập.
 * Mật khẩu băm scrypt (muối ngẫu nhiên), không lưu mật khẩu rõ. Hạn chế thử sai: 5 lần sai → khóa 60 giây theo tên đăng nhập.
 */
const crypto = require('crypto');
const { ValidationError } = require('./CatalogService');
const { ROLE_PERMS } = require('../utils/permissions');

const ROLES = Object.keys(ROLE_PERMS);
const NAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;
const need = (c, m) => { if (!c) throw new ValidationError(m); };

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [alg, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const got = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 32);
  const want = Buffer.from(hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
const checkPassword = (pw) => { need(typeof pw === 'string' && pw.length >= 8 && pw.length <= 128, 'Mật khẩu phải từ 8 đến 128 ký tự'); };
const pub = (u) => (u ? { id: u.id, ten_dang_nhap: u.ten_dang_nhap, ho_ten: u.ho_ten, vai_tro: u.vai_tro, trang_thai: u.trang_thai, dang_nhap_cuoi: u.dang_nhap_cuoi, created_at: u.created_at } : null);

class AuthService {
  constructor(db, audit, { now = () => Date.now() } = {}) { Object.assign(this, { db, audit, now }); this.fails = new Map(); }

  _mode() {
    const row = this.db.get("SELECT value_json FROM settings WHERE key='phan_quyen'");
    return row ? JSON.parse(row.value_json) : {};
  }
  enabled() { return this._mode().enabled === true; }
  setupRequired() {
    const mode = this._mode();
    return mode.setupRequired === true && !mode.enabled;
  }
  prepareSetup() {
    this.db.run("INSERT OR IGNORE INTO settings(key, value_json) VALUES ('phan_quyen', ?)",
      [JSON.stringify({ enabled: false, setupRequired: true })]);
  }
  skipSetup() {
    need(this.setupRequired(), 'Chỉ có thể bỏ qua ở lần thiết lập đầu tiên');
    this._setEnabled(false);
  }
  _setEnabled(on) {
    this.db.run(`INSERT INTO settings(key, value_json) VALUES ('phan_quyen', ?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=strftime('%Y-%m-%dT%H:%M:%S','now','localtime')`, [JSON.stringify({ enabled: !!on })]);
  }
  user(id) { return this.db.get('SELECT * FROM nguoi_dung WHERE id=?', [id]); }
  activeAdmins() { return this.db.get(`SELECT COUNT(*) n FROM nguoi_dung WHERE vai_tro='ADMIN' AND trang_thai='ACTIVE'`).n; }

  /** Bật phân quyền: tạo quản trị đầu tiên (hoặc xác nhận quản trị đã có cùng tên). Chỉ khi đang tắt. */
  enable({ ten_dang_nhap, ho_ten, mat_khau } = {}) {
    need(!this.enabled(), 'Phân quyền đã được bật');
    need(NAME_RE.test(String(ten_dang_nhap || '')), 'Tên đăng nhập 3–32 ký tự (chữ, số, . _ -)');
    checkPassword(mat_khau);
    return this.db.tx(() => {
      const ex = this.db.get('SELECT * FROM nguoi_dung WHERE ten_dang_nhap=?', [ten_dang_nhap]);
      let u;
      if (ex) {
        need(ex.vai_tro === 'ADMIN' && ex.trang_thai === 'ACTIVE' && verifyPassword(mat_khau, ex.mat_khau_hash), 'Tên đăng nhập đã tồn tại — nhập đúng mật khẩu quản trị hoặc chọn tên khác');
        u = ex;
      } else {
        need(String(ho_ten || '').trim(), 'Cần nhập họ tên');
        const id = this.db.run(`INSERT INTO nguoi_dung(ten_dang_nhap, ho_ten, vai_tro, mat_khau_hash) VALUES (?,?, 'ADMIN', ?)`, [ten_dang_nhap, String(ho_ten).trim(), hashPassword(mat_khau)]).id;
        u = this.user(id);
      }
      this._setEnabled(true);
      this.audit.log('AUTH_ENABLE', 'nguoi_dung', u.id, null, { ten_dang_nhap: u.ten_dang_nhap });
      return pub(u);
    });
  }

  disable(actorId, ten_dang_nhap, mat_khau) {
    const a = this.user(actorId);
    need(this.enabled() && a?.vai_tro === 'ADMIN' && a.trang_thai === 'ACTIVE'
      && typeof ten_dang_nhap === 'string' && a.ten_dang_nhap.toLowerCase() === ten_dang_nhap.trim().toLowerCase()
      && typeof mat_khau === 'string' && mat_khau.length > 0 && mat_khau.length <= 128,
    'Nhập tên đăng nhập và mật khẩu của quản trị đang dùng');
    this.login(a.ten_dang_nhap, mat_khau);
    this.db.tx(() => {
      this._setEnabled(false);
      this.audit.log('AUTH_DISABLE', 'nguoi_dung', a.id, null, null, 'Chuyển sang chế độ một người sử dụng');
    });
  }

  login(ten, mat_khau) {
    need(this.enabled(), 'Ứng dụng đang ở chế độ một người sử dụng');
    const key = String(ten || '').toLowerCase(); const f = this.fails.get(key);
    if (f && f.until > this.now()) throw new ValidationError(`Sai quá nhiều lần — thử lại sau ${Math.ceil((f.until - this.now()) / 1000)} giây`);
    const u = this.db.get('SELECT * FROM nguoi_dung WHERE ten_dang_nhap=?', [String(ten || '')]);
    const ok = u && u.trang_thai === 'ACTIVE' && verifyPassword(String(mat_khau || ''), u.mat_khau_hash);
    if (!ok) {
      const n = ((f && f.n) || 0) + 1;
      this.fails.set(key, { n, until: n >= 5 ? this.now() + 60000 : 0 });
      this.audit.log('AUTH_FAIL', 'nguoi_dung', u ? u.id : null, null, { ten_dang_nhap: String(ten || '').slice(0, 40) });
      throw new ValidationError('Sai tên đăng nhập hoặc mật khẩu, hoặc tài khoản đã bị khóa');
    }
    this.fails.delete(key);
    this.db.run(`UPDATE nguoi_dung SET dang_nhap_cuoi=strftime('%Y-%m-%dT%H:%M:%S','now','localtime') WHERE id=?`, [u.id]);
    return pub(this.user(u.id));
  }

  list() { return this.db.all('SELECT * FROM nguoi_dung ORDER BY id').map(pub); }

  createUser(actor, { ten_dang_nhap, ho_ten, vai_tro, mat_khau } = {}) {
    need(NAME_RE.test(String(ten_dang_nhap || '')), 'Tên đăng nhập 3–32 ký tự (chữ, số, . _ -)');
    need(String(ho_ten || '').trim(), 'Cần nhập họ tên');
    need(ROLES.includes(vai_tro), 'Vai trò không hợp lệ');
    checkPassword(mat_khau);
    need(!this.db.get('SELECT id FROM nguoi_dung WHERE ten_dang_nhap=?', [ten_dang_nhap]), 'Tên đăng nhập đã tồn tại');
    const id = this.db.run('INSERT INTO nguoi_dung(ten_dang_nhap, ho_ten, vai_tro, mat_khau_hash) VALUES (?,?,?,?)', [ten_dang_nhap, String(ho_ten).trim(), vai_tro, hashPassword(mat_khau)]).id;
    this.audit.log('USER_CREATE', 'nguoi_dung', id, null, { ten_dang_nhap, vai_tro });
    return pub(this.user(id));
  }

  /** Đổi họ tên/vai trò/trạng thái. Không được hạ quyền hoặc khóa quản trị cuối cùng. */
  updateUser(actor, id, patch = {}) {
    return this.db.tx(() => {
      const u = this.user(id); need(u, 'Không tìm thấy người dùng');
      const next = { ho_ten: u.ho_ten, vai_tro: u.vai_tro, trang_thai: u.trang_thai };
      if (patch.ho_ten !== undefined) { need(String(patch.ho_ten).trim(), 'Cần nhập họ tên'); next.ho_ten = String(patch.ho_ten).trim(); }
      if (patch.vai_tro !== undefined) { need(ROLES.includes(patch.vai_tro), 'Vai trò không hợp lệ'); next.vai_tro = patch.vai_tro; }
      if (patch.trang_thai !== undefined) { need(['ACTIVE', 'INACTIVE'].includes(patch.trang_thai), 'Trạng thái không hợp lệ'); next.trang_thai = patch.trang_thai; }
      const wasAdmin = u.vai_tro === 'ADMIN' && u.trang_thai === 'ACTIVE', stillAdmin = next.vai_tro === 'ADMIN' && next.trang_thai === 'ACTIVE';
      need(!(wasAdmin && !stillAdmin && this.activeAdmins() <= 1), 'Phải còn ít nhất một quản trị đang hoạt động');
      this.db.run(`UPDATE nguoi_dung SET ho_ten=?, vai_tro=?, trang_thai=?, updated_at=strftime('%Y-%m-%dT%H:%M:%S','now','localtime') WHERE id=?`, [next.ho_ten, next.vai_tro, next.trang_thai, id]);
      this.audit.log('USER_UPDATE', 'nguoi_dung', id, { vai_tro: u.vai_tro, trang_thai: u.trang_thai, ho_ten: u.ho_ten }, next);
      return pub(this.user(id));
    });
  }

  resetPassword(actor, id, mat_khau) {
    need(this.user(id), 'Không tìm thấy người dùng'); checkPassword(mat_khau);
    this.db.run(`UPDATE nguoi_dung SET mat_khau_hash=?, updated_at=strftime('%Y-%m-%dT%H:%M:%S','now','localtime') WHERE id=?`, [hashPassword(mat_khau), id]);
    this.audit.log('USER_RESET_PASSWORD', 'nguoi_dung', id, null, null);
  }

  changeOwnPassword(id, cu, moi) {
    const u = this.user(id); need(u && verifyPassword(String(cu || ''), u.mat_khau_hash), 'Mật khẩu hiện tại không đúng'); checkPassword(moi);
    this.db.run(`UPDATE nguoi_dung SET mat_khau_hash=?, updated_at=strftime('%Y-%m-%dT%H:%M:%S','now','localtime') WHERE id=?`, [hashPassword(moi), id]);
    this.audit.log('USER_CHANGE_PASSWORD', 'nguoi_dung', id, null, null);
  }
}

module.exports = { AuthService, hashPassword, verifyPassword };
