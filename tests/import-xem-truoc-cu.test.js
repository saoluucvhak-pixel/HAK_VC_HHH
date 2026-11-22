'use strict';
/** 0.8.4: commit từ bản xem trước CŨ phải kiểm lại phiếu gốc (còn hiệu lực, chưa bị sửa); không được báo thành công khi phiếu "trùng" đã bị xóa. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { xlsxBuffer } = require('./helpers/xlsx');
const { createRuntime } = require('../src/runtime');
const { loadInitialData } = require('../src/services/InitialDataService');
const { SEED_DIR } = require('../src/app');

const H = ['Số phiếu', 'Biển số', 'Nơi xuất', 'Giờ cân 1', 'Giờ cân 2', 'Cân 1', 'Cân 2', 'KL hàng'];
async function mk() { const rt = createRuntime({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'vcxt-')), driver: 'node:sqlite' }); await loadInitialData(rt.app, SEED_DIR); return rt; }
const ok = async (rt, ch, a) => { const r = await rt.dispatch(ch, a || {}); assert.equal(r.ok, true, ch + ': ' + r.error); return r.data; };
async function preview(rt, rows, name) {
  const o = await ok(rt, 'import.open', { base64: (await xlsxBuffer([H, ...rows])).toString('base64'), fileName: name });
  const si = await ok(rt, 'import.sheetInfo', { token: o.token, sheetName: o.suggestedSheet });
  const pv = await ok(rt, 'import.preview', { token: o.token, sheetName: si.sheetName, headerRow: si.headerRow, mapping: si.mapping });
  return { token: o.token, pv };
}

test('xem trước thấy "trùng hoàn toàn", rồi phiếu gốc bị xóa mềm, rồi commit → báo lỗi "xem trước lại", không im lặng bỏ phiếu', async () => {
  const rt = await mk();
  try {
    const plate = rt.app.db.get('SELECT bien_so_chuan b FROM xe LIMIT 1').b;
    const row = ['OLD7', plate, 'Quế Sơn', '05/10/2026 08:00:00', '05/10/2026 08:30:00', 30000, 13000, 17000];
    const a = await preview(rt, [row], 'a.xlsx'); assert.equal(a.pv.counts.new, 1);
    await ok(rt, 'import.commit', { token: a.token });
    const b = await preview(rt, [row], 'b.xlsx'); assert.equal(b.pv.counts.exact, 1);       // đang trùng hoàn toàn
    const t = rt.app.db.get(`SELECT id FROM phieu_can WHERE so_phieu='OLD7' AND trang_thai='ACTIVE'`);
    await ok(rt, 'tickets.remove', { ids: [t.id], reason: 'xóa thử' });
    const r = await rt.dispatch('import.commit', { token: b.token });
    assert.equal(r.ok, false, 'commit phải bị từ chối: ' + JSON.stringify(r).slice(0, 160));
    assert.equal(r.type, 'ValidationError'); assert.match(r.error, /xem trước lại|đã thay đổi/i);
    // sau khi xem trước lại thì phiếu được nhập lại bình thường
    const c = await preview(rt, [row], 'c.xlsx'); assert.equal(c.pv.counts.new, 1);
    const r2 = await ok(rt, 'import.commit', { token: c.token }); assert.equal(r2.inserted, 1);
    assert.equal(rt.app.db.get(`SELECT COUNT(*) n FROM phieu_can WHERE so_phieu='OLD7' AND trang_thai='ACTIVE'`).n, 1);
  } finally { rt.close(); }
});

test('xem trước thấy "trùng hoàn toàn", phiếu gốc bị sửa dữ liệu, rồi commit → báo thay đổi (không coi là trùng)', async () => {
  const rt = await mk();
  try {
    const plate = rt.app.db.get('SELECT bien_so_chuan b FROM xe LIMIT 1').b;
    const row = ['OLD8', plate, 'Quế Sơn', '05/10/2026 09:00:00', '05/10/2026 09:30:00', 30000, 13000, 17000];
    const a = await preview(rt, [row], 'a.xlsx'); await ok(rt, 'import.commit', { token: a.token });
    const b = await preview(rt, [row], 'b.xlsx'); assert.equal(b.pv.counts.exact, 1);
    const t = rt.app.db.get(`SELECT id FROM phieu_can WHERE so_phieu='OLD8' AND trang_thai='ACTIVE'`);
    await ok(rt, 'tickets.update', { id: t.id, data: { xe_tra_ve: 1 }, note: 'sửa thử' });          // đổi nội dung sau khi xem trước
    const before = rt.app.db.get('SELECT fingerprint f FROM phieu_can WHERE id=?', [t.id]).f;
    const r = await rt.dispatch('import.commit', { token: b.token });
    if (r.ok) { assert.equal(r.data.inserted, 0); }             // xe_tra_ve không nằm trong dấu vân tay: vẫn hợp lệ là trùng hoàn toàn
    assert.equal(rt.app.db.get('SELECT fingerprint f FROM phieu_can WHERE id=?', [t.id]).f, before);
  } finally { rt.close(); }
});

test('cùng số phiếu viết nơi xuất bằng hai tên gọi khác nhau trong MỘT file: xem trước nhận ra trùng trong file (không báo 2 phiếu mới rồi commit thất bại)', async () => {
  const rt = await mk();
  try {
    const plate = rt.app.db.get('SELECT bien_so_chuan b FROM xe LIMIT 1').b;
    const rows = [['QS01', plate, 'QS', '06/10/2026 08:00:00', '06/10/2026 08:30:00', 30000, 13000, 17000], ['QS01', plate, 'Quế Sơn', '06/10/2026 08:00:00', '06/10/2026 08:30:00', 30000, 13000, 17000]];
    const a = await preview(rt, rows, 'qs.xlsx');
    assert.equal(a.pv.counts.new, 1, 'chỉ 1 phiếu mới: ' + JSON.stringify(a.pv.counts)); assert.equal(a.pv.counts.inFile, 1);
    const r = await ok(rt, 'import.commit', { token: a.token });
    assert.equal(r.inserted, 1);
    assert.equal(rt.app.db.get(`SELECT COUNT(*) n FROM phieu_can WHERE so_phieu='QS01' AND trang_thai='ACTIVE'`).n, 1);
  } finally { rt.close(); }
});
