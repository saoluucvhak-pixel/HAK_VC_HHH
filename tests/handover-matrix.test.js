'use strict';
/**
 * Ma trận đối chiếu giữa các màn hình sau từng thao tác nghiệp vụ (V.47, DB tệp, qua đúng kênh IPC) và sau khi khởi động lại.
 * "Màn hình" = đúng kênh mà màn đó gọi: Phiếu cân (tickets.*), Dashboard (reports.dashboard), Bảng kê (reports.statements),
 * Báo cáo (reports.by*), Việc cần làm (workflow.todo), Cần kiểm tra (import.pending), Lịch sử import (import.batches), Chốt kỳ (lock.list).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { xlsxBuffer } = require('./helpers/xlsx');
const { createRuntime } = require('../src/runtime');
const { loadInitialData } = require('../src/services/InitialDataService');
const { SEED_DIR } = require('../src/app');

const H = ['Số phiếu', 'Biển số', 'Nơi xuất', 'Giờ cân 1', 'Giờ cân 2', 'Cân 1', 'Cân 2', 'KL hàng'];
const sum = (a, k) => a.reduce((s, x) => s + (Number(x[k]) || 0), 0);
const r2 = (x) => Math.round(x * 100) / 100;

async function screens(rt) {
  const d = async (ch, a) => { const r = await rt.dispatch(ch, a || {}); assert.equal(r.ok, true, `${ch}: ${r.error}`); return r.data; };
  const ids = (await d('tickets.ids', { filter: {} })).sort((a, b) => a - b);
  const cnt = await d('tickets.count', { filter: {} }); const list = await d('tickets.list', { filter: {}, offset: 0, limit: 1 });
  const dash = (await d('reports.dashboard', {})).kpi; const st = await d('reports.statements', { da_tinh_gia: true });
  const grp = {}; for (const g of ['byCarrier', 'byDate', 'byOrigin', 'byVehicle']) grp[g] = await d('reports.' + g, { da_tinh_gia: true });
  const todo = await d('workflow.todo'); const pend = await d('import.pending'); const batches = await d('import.batches'); const locks = await d('lock.list');
  const info = await d('app.info');
  return { ids, cnt, list: list.total, dash, st, grp, todo, pend, batches, locks, info };
}
function check(S, label) {
  const m = `[${label}] `;
  assert.equal(S.ids.length, S.cnt.kept, m + 'tickets.ids ≠ tickets.count'); assert.equal(S.cnt.kept, S.cnt.total, m + 'bộ lọc rỗng phải = tổng'); assert.equal(S.list, S.cnt.kept, m + 'tickets.list.total');
  assert.equal(S.todo.tong_phieu, S.cnt.total, m + 'Việc cần làm: tổng phiếu ≠ Phiếu cân');
  assert.equal(S.dash.so_chuyen + S.todo.chua_tinh_gia, S.cnt.total, m + 'Dashboard (đã tính giá) + chưa tính giá ≠ tổng phiếu');
  assert.equal(S.dash.so_chuyen, sum(S.st, 'so_chuyen'), m + 'Dashboard ≠ Bảng kê (chuyến)'); assert.equal(S.dash.tong_kg, sum(S.st, 'tong_kg'), m + 'kg');
  assert.equal(S.dash.tien_truoc_vat, sum(S.st, 'tien_truoc_vat'), m + 'trước VAT');
  assert.ok(Math.abs(S.dash.tong_tien - sum(S.st, 'tong_tien')) <= S.st.length * 0.5 + 0.01, m + 'tổng tiền: chênh quá cấp làm tròn bảng kê');
  for (const [g, rows] of Object.entries(S.grp)) { assert.equal(sum(rows, 'so_chuyen'), S.dash.so_chuyen, m + g + ' chuyến'); assert.equal(sum(rows, 'tong_kg'), S.dash.tong_kg, m + g + ' kg'); assert.ok(Math.abs(sum(rows, 'tong_tien') - S.dash.tong_tien) <= 0.01, m + g + ' tiền'); }
  assert.equal(S.todo.cho_xu_ly, S.pend.length, m + 'Việc cần làm: chờ xử lý ≠ Cần kiểm tra'); assert.equal(S.info.pendingReviews, S.pend.length, m + 'menu: số chờ kiểm tra');
  const locked = S.locks.filter((k) => k.trang_thai === 'DA_CHOT'); assert.equal(sum(locked, 'so_phieu'), S.todo.da_chot, m + 'Chốt kỳ (Σ phiếu kỳ đang chốt) ≠ Việc cần làm (đã chốt)');
  assert.equal(S.dash.da_chot || 0, S.todo.da_chot, m + 'Dashboard đã chốt ≠ Việc cần làm');
  assert.equal(S.info.counts.phieu, S.cnt.total, m + 'menu: số phiếu');
}

test('ma trận: V.47 → nhập lại → sửa → xung đột → chuyển đợt → xóa → hoàn tác → thay giá → chốt/mở khóa → sao lưu/khôi phục → khởi động lại', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vchm-'));
  let rt = createRuntime({ dataDir: dir, driver: 'node:sqlite' });
  const trace = [];
  try {
    const call = async (ch, a) => { const r = await rt.dispatch(ch, a || {}); return r; };
    const ok = async (ch, a) => { const r = await call(ch, a); assert.equal(r.ok, true, `${ch}: ${r.error}`); return r.data; };
    await loadInitialData(rt.app, SEED_DIR);
    const step = async (label) => { const S = await screens(rt); check(S, label); trace.push({ buoc: label, phieu: S.cnt.total, chuyen: S.dash.so_chuyen, kg: S.dash.tong_kg, truoc_vat: S.dash.tien_truoc_vat, tong: r2(S.dash.tong_tien), cho_kiem_tra: S.pend.length, da_chot: S.todo.da_chot }); return S; };
    const importRows = async (rows, fileName = 'f.xlsx') => {
      const o = await ok('import.open', { base64: (await xlsxBuffer([H, ...rows])).toString('base64'), fileName }); const si = await ok('import.sheetInfo', { token: o.token, sheetName: o.suggestedSheet });
      const dot = rt.app.db.get('SELECT id FROM dot_van_chuyen ORDER BY id LIMIT 1').id;
      const pv = await ok('import.preview', { token: o.token, sheetName: si.sheetName, headerRow: si.headerRow, mapping: si.mapping, dotId: dot });
      return { token: o.token, pv, commit: () => call('import.commit', { token: o.token }) };
    };
    const base = await step('1. nạp V.47');
    assert.equal(base.cnt.total, 2035); assert.equal(base.dash.tong_kg, 38563700);

    // 2. nhập lại cùng file → toàn bộ trùng hoàn toàn, không đổi số liệu; bấm ghi lặp không nhân đôi
    const seedFile = path.join(SEED_DIR, 'Tong-hop-chi-phi-VC-V47.xlsx');
    const o = await ok('import.open', { filePath: seedFile }); const si = await ok('import.sheetInfo', { token: o.token, sheetName: o.suggestedSheet });
    const pv = await ok('import.preview', { token: o.token, sheetName: si.sheetName, headerRow: si.headerRow, mapping: si.mapping });
    assert.equal(pv.counts.exact, 2035); assert.equal(pv.counts.new, 0);
    const c1 = await call('import.commit', { token: o.token }); const c2 = await call('import.commit', { token: o.token });
    assert.equal(c1.ok, true); assert.equal(c2.ok, false, 'bấm ghi lặp phải bị từ chối');
    const S2 = await step('2. nhập lại + bấm ghi lặp'); assert.equal(S2.cnt.total, 2035);

    // 3. sửa phiếu → mọi màn đổi theo, đúng 1 phiếu
    const t0 = rt.app.db.get(`SELECT id, kl_hang_kg, can_lan_1, can_lan_2 FROM phieu_can WHERE trang_thai='ACTIVE' AND can_lan_1 IS NOT NULL AND can_lan_2 IS NOT NULL ORDER BY id LIMIT 1`);
    await ok('tickets.update', { id: t0.id, data: { kl_hang_kg: t0.kl_hang_kg + 10, can_lan_2: t0.can_lan_2 + (t0.can_lan_2 > t0.can_lan_1 ? 10 : -10) }, note: 'sửa thử' });
    const S3 = await step('3. sửa phiếu'); assert.equal(S3.dash.tong_kg, base.dash.tong_kg + 10);

    // 4. nhập phiếu mới + xung đột (cùng khóa khác KL) → Cần kiểm tra; duyệt "Cập nhật"
    const tk = rt.app.db.get(`SELECT so_phieu, bien_so_goc, noi_xuat_goc, ngay_gio_can_1, ngay_gio_can_2, can_lan_1, can_lan_2, kl_hang_kg FROM phieu_can WHERE id=? `, [t0.id]);
    const fmt = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 19)}`;
    const conflictRow = [tk.so_phieu, tk.bien_so_goc, tk.noi_xuat_goc, fmt(tk.ngay_gio_can_1), fmt(tk.ngay_gio_can_2), tk.can_lan_1, tk.can_lan_1 + 15000, 15000];
    const plate = rt.app.db.get('SELECT bien_so_chuan b FROM xe LIMIT 1').b;
    const fresh = ['MX1', plate, 'Quế Sơn', '05/10/2026 08:00:00', '05/10/2026 08:30:00', 30000, 13000, 17000];
    const imp = await importRows([conflictRow, fresh]); assert.equal(imp.pv.counts.conflict, 1); assert.equal(imp.pv.counts.new, 1);
    const cm = await imp.commit(); assert.equal(cm.ok, true);
    const S4a = await step('4a. nhập mới + 1 xung đột'); assert.equal(S4a.pend.length, 1); assert.equal(S4a.cnt.total, 2036);
    await ok('import.resolve', { id: S4a.pend[0].id, action: 'UPDATE', note: 'theo file mới' });
    const S4b = await step('4b. duyệt xung đột (Cập nhật)'); assert.equal(S4b.pend.length, 0);

    // 5. chuyển đợt (đợt mới) cho 3 phiếu
    const dot2 = await ok('catalog.create', { table: 'dot_van_chuyen', data: { ma_dot: 'DOT-TEST', ten_tau: 'Tàu thử', trang_thai: 'MO' } });
    const mv = rt.app.db.all(`SELECT id FROM phieu_can WHERE trang_thai='ACTIVE' ORDER BY id LIMIT 3`).map((x) => x.id);
    for (const id of mv) await ok('tickets.update', { id, data: { dot_van_chuyen_id: dot2.id }, note: 'chuyển đợt' });
    await step('5. chuyển đợt');
    assert.equal(sum((await ok('reports.byDot', { da_tinh_gia: true })).filter((r) => r.label === 'DOT-TEST'), 'so_chuyen'), 3);

    // 6. xóa mềm → biến khỏi mọi màn; 7. hoàn tác lô nhập mới
    const dels = rt.app.db.all(`SELECT id FROM phieu_can WHERE trang_thai='ACTIVE' ORDER BY id DESC LIMIT 5`).map((x) => x.id).filter((id) => id !== rt.app.db.get(`SELECT id FROM phieu_can WHERE so_phieu='MX1'`).id).slice(0, 4);
    await ok('tickets.remove', { ids: dels, reason: 'xóa thử' });
    const S6 = await step('6. xóa mềm'); assert.equal(S6.cnt.total, 2036 - dels.length);
    await ok('import.undo', { batchId: cm.data.batchId, reason: 'hoàn tác thử' });
    const S7 = await step('7. hoàn tác lô nhập'); assert.equal(S7.cnt.total, 2036 - dels.length - 1);

    // 8. thay giá rồi tính lại: tiền đổi đồng bộ ở mọi màn
    const rule = rt.app.db.get(`SELECT b.id FROM bang_gia_van_chuyen b WHERE b.id = (SELECT bang_gia_id FROM phieu_can WHERE trang_thai='ACTIVE' AND bang_gia_id IS NOT NULL ORDER BY id LIMIT 1)`);
    rt.app.db.run('UPDATE bang_gia_van_chuyen SET don_gia_ap_dung=don_gia_ap_dung+1000000 WHERE id=?', [rule.id]);
    await ok('cost.recalc', { all: true });
    const S8 = await step('8. thay giá + tính lại'); assert.notEqual(S8.dash.tong_tien, S7.dash.tong_tien);

    // 9. chốt kỳ → đã chốt xuất hiện ở Chốt kỳ/Việc cần làm/Dashboard; sửa phiếu đã chốt bị chặn; mở khóa → trả về
    const lk = await ok('lock.create', { loai: 'KY', tu_ngay: '2026-09-28', den_ngay: '2026-10-01' });
    const S9 = await step('9. chốt kỳ'); assert.equal(S9.todo.da_chot, lk.so_phieu);
    const lockedId = rt.app.db.get('SELECT id FROM phieu_can WHERE chot_ky_id IS NOT NULL LIMIT 1').id;
    assert.equal((await call('tickets.update', { id: lockedId, data: { kl_hang_kg: 20000 }, note: 'x' })).ok, false);
    const snapBefore = rt.app.db.get('SELECT COUNT(*) n, SUM(tong_tien) t FROM chot_ky_snapshot');
    const tot9 = S9.dash.tong_tien;
    await ok('lock.unlock', { id: lk.id, reason: 'mở khóa thử' });
    const S9b = await step('9b. mở khóa'); assert.equal(S9b.todo.da_chot, 0);
    assert.deepEqual(rt.app.db.get('SELECT COUNT(*) n, SUM(tong_tien) t FROM chot_ky_snapshot'), snapBefore, 'snapshot cũ được giữ làm lịch sử');
    assert.ok(Math.abs(S9b.dash.tong_tien - tot9) < 0.01, 'mở khóa không đổi số liệu');
    await ok('lock.create', { loai: 'KY', tu_ngay: '2026-09-28', den_ngay: '2026-10-01' });          // chốt lại (nhiều lần chốt cho cùng phiếu)
    const S9c = await step('9c. chốt lại'); assert.ok(S9c.todo.da_chot > 0);

    // 10. sao lưu → thay đổi → khôi phục: số liệu về đúng bản sao lưu ở mọi màn
    const bk = await ok('backup.now'); const Sb = await step('10a. sao lưu');
    const extra = rt.app.db.all(`SELECT id FROM phieu_can WHERE trang_thai='ACTIVE' AND chot_ky_id IS NULL ORDER BY id LIMIT 2`).map((x) => x.id);
    await ok('tickets.remove', { ids: extra, reason: 'xóa sau sao lưu' });
    await step('10b. xóa sau sao lưu');
    await ok('backup.restore', { file: bk.file });
    const S10 = await step('10c. khôi phục'); assert.deepEqual({ ...S10.dash }, { ...Sb.dash }); assert.equal(S10.cnt.total, Sb.cnt.total);

    // 11. khởi động lại: mọi màn giữ đúng số liệu
    const before = await screens(rt); rt.close();
    rt = createRuntime({ dataDir: dir, driver: 'node:sqlite' });
    const after = await screens(rt); check(after, '11. sau khởi động lại');
    for (const k of ['ids', 'cnt', 'dash', 'todo']) assert.deepEqual(after[k], before[k], `khởi động lại làm đổi ${k}`);
    assert.deepEqual(after.st.map((x) => [x.don_vi.ma, x.so_chuyen, x.tong_kg, x.tong_tien]), before.st.map((x) => [x.don_vi.ma, x.so_chuyen, x.tong_kg, x.tong_tien]));
    const ig = await ok('system.integrity'); assert.equal(ig.ok, true, JSON.stringify(ig.checks.filter((c) => c.severity === 'LOI' && c.count)));
    fs.writeFileSync(path.join(os.tmpdir(), 'ma-tran-doi-chieu.json'), JSON.stringify(trace, null, 2));
  } finally { try { rt.close(); } catch { /* đã đóng */ } }
});
