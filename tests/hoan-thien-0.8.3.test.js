'use strict';
/** Hoàn thiện sau rà soát 0.8.3: đổi căn cứ ngày tính giá phải xác nhận + tính lại; danh mục không nhận khóa kiểu prototype. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { createRuntime } = require('../src/runtime');
const { loadInitialData } = require('../src/services/InitialDataService');
const { SEED_DIR } = require('../src/app');

const mk = async () => { const rt = createRuntime({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'vchtt-')), driver: 'node:sqlite' }); await loadInitialData(rt.app, SEED_DIR); return rt; };
const call = (rt, ch, a) => rt.dispatch(ch, a || {});

test('đổi ngay_can_cu_gia: có phiếu xuyên đêm chưa chốt → ConfirmRequired (nêu số phiếu); xác nhận → lưu, tính lại, ghi audit; phiếu đã chốt giữ nguyên', async () => {
  const rt = await mk();
  try {
    const xd = (extra = '') => rt.app.db.all(`SELECT id FROM phieu_can WHERE trang_thai='ACTIVE' AND ngay_gio_can_2 IS NOT NULL AND substr(ngay_gio_can_1,1,10)<>substr(ngay_gio_can_2,1,10) ${extra}`).map((x) => x.id);
    const open = xd('AND chot_ky_id IS NULL').length; const locked = xd('AND chot_ky_id IS NOT NULL').length;
    assert.ok(open + locked > 0, 'dữ liệu mẫu có phiếu xuyên đêm');
    // mô phỏng một phiếu xuyên đêm đang mang giá "cũ": đổi tay đơn giá, tính lại phải đưa về đúng theo căn cứ mới
    const r = await call(rt, 'settings.set', { key: 'ngay_can_cu_gia', value: 'CAN_2' });
    if (open > 0) {
      assert.equal(r.ok, false); assert.equal(r.type, 'ConfirmRequired'); assert.match(r.error, new RegExp(String(open)));
      assert.ok(!rt.app.settings.get('ngay_can_cu_gia') || rt.app.settings.get('ngay_can_cu_gia') === 'CAN_1', 'chưa xác nhận thì chưa lưu');
      const ok = await call(rt, 'settings.set', { key: 'ngay_can_cu_gia', value: 'CAN_2', xac_nhan: true });
      assert.equal(ok.ok, true, ok.error);
    } else assert.equal(r.ok, true);
    assert.equal(rt.app.settings.get('ngay_can_cu_gia'), 'CAN_2');
    const a = rt.app.db.get(`SELECT COUNT(*) n FROM audit_log WHERE action='SETTING_PRICE_BASIS'`).n;
    assert.equal(a, 1, 'ghi nhật ký đổi căn cứ ngày tính giá');
    // đổi về chính giá trị hiện tại: không hỏi, không ghi thêm
    const same = await call(rt, 'settings.set', { key: 'ngay_can_cu_gia', value: 'CAN_2' });
    assert.equal(same.ok, true);
    assert.equal(rt.app.db.get(`SELECT COUNT(*) n FROM audit_log WHERE action='SETTING_PRICE_BASIS'`).n, 1);
    // giá trị lạ bị từ chối
    const bad = await call(rt, 'settings.set', { key: 'ngay_can_cu_gia', value: 'CAN_3' });
    assert.equal(bad.ok, false); assert.equal(bad.type, 'ValidationError');
  } finally { rt.close(); }
});

test('đổi ngay_can_cu_gia không đụng phiếu đã chốt kỳ', async () => {
  const rt = await mk();
  try {
    const t = rt.app.db.get(`SELECT id, tong_tien, don_gia FROM phieu_can WHERE trang_thai='ACTIVE' AND chot_ky_id IS NOT NULL AND ngay_gio_can_2 IS NOT NULL ORDER BY id LIMIT 1`);
    if (!t) return;
    await call(rt, 'settings.set', { key: 'ngay_can_cu_gia', value: 'CAN_2', xac_nhan: true });
    const after = rt.app.db.get('SELECT tong_tien, don_gia FROM phieu_can WHERE id=?', [t.id]);
    assert.deepEqual(after, { tong_tien: t.tong_tien, don_gia: t.don_gia });
  } finally { rt.close(); }
});

test('catalog.*: khóa kiểu prototype (constructor, __proto__, toString) bị từ chối bằng ValidationError, không lộ lỗi nội bộ', async () => {
  const rt = await mk();
  try {
    for (const table of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      for (const [ch, a] of [['catalog.list', { table }], ['catalog.create', { table, data: {} }], ['catalog.update', { table, id: 1, data: {} }], ['catalog.remove', { table, id: 1 }], ['catalog.get', { table, id: 1 }]]) {
        const r = await call(rt, ch, a);
        assert.equal(r.ok, false, `${ch} ${table}`); assert.equal(r.type, 'ValidationError', `${ch} ${table}: ${r.type} ${r.error}`);
        assert.match(r.error, /Danh mục không tồn tại/);
      }
    }
  } finally { rt.close(); }
});

test('0.8.4: đổi cấu hình làm tròn khi đã có kỳ chốt → ConfirmRequired (Bảng kê in ra sẽ lệch số đã chốt); chưa có kỳ chốt thì đổi thẳng', async () => {
  const rt = await mk();
  const mkVal = (d) => ({ level: 'STATEMENT', statement: { lineAmount: { digits: d, mode: 'HALF_UP' }, vat: { digits: 0, mode: 'HALF_UP' } } });
  try {
    const ok0 = await call(rt, 'settings.set', { key: 'rounding', value: mkVal(-2) });
    assert.equal(ok0.ok, true, 'chưa có kỳ chốt: đổi thẳng — ' + ok0.error);
    // chốt một đợt
    let locked = false;
    for (const d of rt.app.db.all(`SELECT DISTINCT dot_van_chuyen_id id FROM phieu_can WHERE trang_thai='ACTIVE' AND dot_van_chuyen_id IS NOT NULL AND chot_ky_id IS NULL`)) {
      if (rt.app.lock.preview({ loai: 'DOT', dot_id: d.id }).chot_duoc) { rt.app.lock.lock({ loai: 'DOT', dot_id: d.id }); locked = true; break; }
    }
    assert.ok(locked, 'cần chốt được một đợt trong dữ liệu mẫu');
    const r = await call(rt, 'settings.set', { key: 'rounding', value: mkVal(-3) });
    assert.equal(r.ok, false); assert.equal(r.type, 'ConfirmRequired'); assert.match(r.error, /đã chốt/i);
    assert.equal(rt.app.settings.get('rounding').statement.lineAmount.digits, -2, 'chưa xác nhận thì chưa đổi');
    const ok = await call(rt, 'settings.set', { key: 'rounding', value: mkVal(-3), xac_nhan: true });
    assert.equal(ok.ok, true, ok.error); assert.equal(rt.app.settings.get('rounding').statement.lineAmount.digits, -3);
  } finally { rt.close(); }
});
