'use strict';
/** Đối chiếu chéo trên dữ liệu mẫu V.47: Dashboard ↔ Phiếu cân ↔ Bảng kê ↔ nhóm báo cáo ↔ Excel ↔ snapshot chốt; xóa hàng loạt theo bộ lọc. */
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { createApp, SEED_DIR } = require('../src/app');
const { loadInitialData } = require('../src/services/InitialDataService');
const documents = require('../src/print/documents');
const exporters = require('../src/excel/exporters');
const templates = require('../src/print/htmlTemplates');

const sum = (a, k) => a.reduce((s, x) => s + (x[k] || 0), 0);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

async function v47() { const app = createApp({ dbFile: ':memory:', driver: 'node:sqlite' }); await loadInitialData(app, SEED_DIR); return app; }

test('V.47: mốc hồi quy và đối chiếu chéo Dashboard/Phiếu cân/Bảng kê/nhóm báo cáo theo nhiều bộ lọc', async () => {
  const app = await v47();
  const dvs = app.db.all('SELECT id FROM don_vi_van_chuyen ORDER BY id');
  const dot = app.db.get('SELECT id FROM dot_van_chuyen LIMIT 1').id;
  const filters = [{}, { tu_ngay: '2026-10-01', den_ngay: '2026-10-05' }, { dot_id: dot }, { don_vi_id: dvs[0].id }, { don_vi_id: [dvs[0].id, dvs[1].id] }];
  for (const f of filters) {
    const d = app.reports.dashboard(f).kpi;
    const sts = app.reports.statements({ ...f, da_tinh_gia: true });
    assert.equal(d.so_chuyen, app.reports.count(f).kept);
    assert.equal(d.so_chuyen, app.reports.tickets(f, { limit: 1 }).total);
    assert.equal(d.so_chuyen, sum(sts, 'so_chuyen')); assert.equal(d.tong_kg, sum(sts, 'tong_kg'));
    assert.equal(d.tien_truoc_vat, sum(sts, 'tien_truoc_vat'));                     // trước VAT: nguyên đồng, khớp tuyệt đối
    near(d.tien_vat, sum(sts, 'tien_vat'), sts.length * 0.5, 'VAT chỉ lệch do làm tròn mỗi bảng kê');
    near(d.tong_tien, sum(sts, 'tong_tien'), sts.length * 0.5, 'tổng chỉ lệch do làm tròn mỗi bảng kê');
    for (const g of ['byCarrier', 'byDate', 'byOrigin', 'byVehicle']) {
      const a = app.reports[g]({ ...f, da_tinh_gia: true });
      assert.equal(sum(a, 'so_chuyen'), d.so_chuyen, g); assert.equal(sum(a, 'tong_kg'), d.tong_kg, g); near(sum(a, 'tong_tien'), d.tong_tien, 0.01, g);
    }
  }
  const all = app.reports.dashboard({}).kpi;
  assert.equal(all.so_chuyen, 2035); assert.equal(all.tong_kg, 38563700);
  near(all.tong_tien, 5512904418.24, 0.005, 'tổng Excel-compat V.47');
  assert.equal(sum(app.reports.statements({ da_tinh_gia: true }), 'tong_tien'), 5512904418);     // tổng bốn bảng kê chính thức
  assert.equal(app.db.get(`SELECT COUNT(*) n FROM phieu_can WHERE trang_thai='ACTIVE' AND trang_thai_tinh_gia IN ('OK','LOCKED') AND ABS(tien_truoc_vat+tien_vat-tong_tien)>1`).n, 0);
});

test('V.47: số trên file Excel bảng kê và bảng in khớp Bảng kê; snapshot chốt khớp số lúc chốt', async () => {
  const app = await v47();
  for (const st of app.reports.statements({ da_tinh_gia: true })) {
    const doc = documents.statementDoc(app, { don_vi_id: st.don_vi.id, da_tinh_gia: true }, {});
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await exporters.statementWorkbook(doc));
    const nums = new Set(); wb.eachSheet((ws) => ws.eachRow((r) => r.eachCell((c) => { const v = c.value; if (typeof v === 'number') nums.add(v); else if (v && typeof v.result === 'number') nums.add(v.result); })));
    for (const x of [st.so_chuyen, st.tong_kg, st.tien_truoc_vat, st.tien_vat, st.tong_tien]) assert.ok(nums.has(x), `${st.don_vi.ma}: Excel thiếu ${x}`);
    const html = templates.statementHtml(doc);
    assert.ok(html.includes(Number(st.tong_tien).toLocaleString('vi-VN')), `${st.don_vi.ma}: bảng in thiếu tổng ${st.tong_tien}`);
    assert.ok(!/var\(--|data-theme|prefers-color-scheme/.test(html), 'bảng in không phụ thuộc chế độ Sáng/Tối');
    assert.ok(!html.includes('-0,'.concat('00')) && !/>-0</.test(html));
  }
  const k = app.lock.lock({ loai: 'KY', tu_ngay: '2026-10-01', den_ngay: '2026-10-05' });
  const snap = app.db.get('SELECT COUNT(*) n, SUM(kl_hang_kg) kg FROM chot_ky_snapshot WHERE chot_ky_id=?', [k.id]);
  const live = app.reports.statements({ tu_ngay: '2026-10-01', den_ngay: '2026-10-05' });
  assert.equal(snap.n, k.so_phieu); assert.equal(snap.n, sum(live, 'so_chuyen')); assert.equal(snap.kg, sum(live, 'tong_kg'));
  assert.equal(sum(live, 'tong_tien'), k.tong.tong_tien);
});

test('xóa hàng loạt theo bộ lọc (nhiều trang): ID lọc = ID xóa; có phiếu đã chốt → từ chối cả lô; sau xóa tổng giảm đúng, có audit từng phiếu', async () => {
  const app = await v47();
  const f = { tu_ngay: '2026-10-02', den_ngay: '2026-10-04' };
  const ids = app.db.all(`SELECT p.id FROM phieu_can p WHERE ${app.reports.where(f).sql}`, app.reports.where(f).params).map((r) => r.id);
  assert.ok(ids.length > 200, 'phải nhiều hơn một trang 100 dòng');
  assert.equal(ids.length, app.reports.count(f).kept);
  const before = app.reports.dashboard({}).kpi;
  const part = app.reports.dashboard(f).kpi;
  // phiếu của kỳ đã chốt trong lô → từ chối cả lô, không xóa phiếu nào
  app.lock.lock({ loai: 'KY', tu_ngay: '2026-09-28', den_ngay: '2026-10-02' });
  const pv = app.tickets.removePreview(ids); assert.ok(pv.da_chot_ky > 0 && pv.xoa_duoc + pv.da_chot_ky + pv.dot_khoa + pv.khong_con === ids.length);
  assert.throws(() => app.tickets.remove(ids, 'thử'), /đã chốt kỳ/);
  assert.equal(app.reports.count(f).kept, ids.length);
  // chỉ ngày 04/10 (chưa chốt) → xóa được đúng số lượng
  const f2 = { tu_ngay: '2026-10-04', den_ngay: '2026-10-04' };
  const w2 = app.reports.where(f2); const ids2 = app.db.all(`SELECT p.id FROM phieu_can p WHERE ${w2.sql}`, w2.params).map((r) => r.id);
  const part2 = app.reports.dashboard(f2).kpi;
  const r = app.tickets.remove(ids2, 'xóa thử'); assert.equal(r.deleted, ids2.length);
  const after = app.reports.dashboard({}).kpi;
  assert.equal(after.so_chuyen, before.so_chuyen - ids2.length); assert.equal(after.tong_kg, before.tong_kg - part2.tong_kg);
  near(after.tong_tien, before.tong_tien - part2.tong_tien, 0.01, 'tổng sau xóa');
  assert.equal(app.db.get(`SELECT COUNT(*) n FROM audit_log WHERE action='DELETE_TICKET'`).n, ids2.length);
  assert.ok(part.so_chuyen >= part2.so_chuyen);
});
