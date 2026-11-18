'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { createRuntime } = require('../src/runtime');
const { loadInitialData } = require('../src/services/InitialDataService');
const { SEED_DIR } = require('../src/app');
const documents = require('../src/print/documents');
const forms = require('../src/print/forms');
const exporters = require('../src/excel/exporters');
const { xlsxBuffer } = require('./helpers/xlsx');

async function setup() {
  const rt = createRuntime({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'vc-release-')) });
  await rt.ready;
  await loadInitialData(rt.app, SEED_DIR);
  return rt;
}
const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);

test('Nháp chỉ xuất hiện trong dữ liệu nhập; mọi báo cáo và chứng từ chặn cả bộ lọc mở rộng', async () => {
  const rt = await setup();
  try {
    const app = rt.app;
    app.settings.set('duyet_phieu', { bat: true });
    const t = app.db.get("SELECT * FROM phieu_can WHERE trang_thai='ACTIVE' AND trang_thai_tinh_gia='OK' LIMIT 1");
    app.tickets.update(t.id, { xe_tra_ve: t.xe_tra_ve ? 0 : 1 }, 'kiểm tra cần duyệt lại');
    assert.equal(app.tickets.get(t.id).trang_thai_duyet, 'NHAP');
    for (const override of [{ trang_thai_duyet: 'NHAP' }, { moi_trang_thai: true }, { moi_trang_thai: true, trang_thai_duyet: 'NHAP' }]) {
      const f = { ...override, search: t.so_phieu, bien_so: t.bien_so, don_vi_id: t.don_vi_van_chuyen_id, tu_ngay: t.ngay_can, den_ngay: t.ngay_can };
      assert.equal(app.reports.tickets(f).rows.some((r) => r.id === t.id), true, 'màn Phiếu cân vẫn xem được Nháp');
      assert.equal(app.reports.count(f, { approvedOnly: true }).kept, 0);
      assert.equal(app.reports.dashboard(f).kpi.so_chuyen, 0);
      assert.equal(app.reports.statement(f).so_chuyen, 0);
      assert.equal(sum(app.reports.statements(f), 'so_chuyen'), 0);
      for (const method of ['byVehicle', 'byCarrier', 'byOrigin', 'byDate', 'byDot']) assert.equal(sum(app.reports[method](f), 'so_chuyen'), 0, method);
      assert.equal(documents.statementDoc(app, f).tickets.length, 0);
      assert.equal(documents.statementDoc(app, f).st.tong_tien, 0);
      assert.equal(forms.detailDoc(app, f).sections.length, 0);
      assert.equal(forms.tauSummaryDoc(app, f).sections.length, 0);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await exporters.statementWorkbook(documents.statementDoc(app, f)));
      assert.ok(wb.worksheets.length > 0);
      const approvedCount = await rt.dispatch('tickets.count', { filter: f, approvedOnly: true });
      assert.equal(approvedCount.data.kept, 0);
      const allCount = await rt.dispatch('tickets.count', { filter: f });
      assert.ok(allCount.data.kept > 0);
    }
    const expanded = { moi_trang_thai: true };
    assert.equal(app.reports.dashboard(expanded).kpi.so_chuyen, 2034);
    assert.equal(sum(app.reports.statements(expanded), 'so_chuyen'), 2034);
    assert.equal((await rt.dispatch('tickets.count', { filter: {} })).data.kept, 2035);
    const exported = await rt.dispatch('export.tickets', { filter: { trang_thai_duyet: 'NHAP' } });
    assert.equal(exported.ok, true, exported.error);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(exported.data.path);
    const text = []; wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((cell) => text.push(String(cell.value)))));
    assert.ok(text.includes('Trạng thái duyệt'));
    assert.ok(text.includes('Nháp'));
    app.tickets.approve([t.id], 'đã kiểm tra');
    assert.equal(app.reports.dashboard({}).kpi.so_chuyen, 2035);
    assert.equal(sum(app.reports.statements({}), 'so_chuyen'), 2035);
  } finally { rt.close(); }
});

test('sửa phiếu kiểm tra cân/KL nhất quán, số hữu hạn, lý do và cho phép xóa giờ cân 2', async () => {
  const rt = await setup();
  try {
    const app = rt.app;
    const t = app.db.get("SELECT * FROM phieu_can WHERE trang_thai='ACTIVE' AND can_lan_1 IS NOT NULL AND can_lan_2 IS NOT NULL LIMIT 1");
    assert.throws(() => app.tickets.update(t.id, { kl_hang_kg: t.kl_hang_kg + 100 }, 'sai cân'), /khớp/);
    assert.throws(() => app.tickets.update(t.id, { can_lan_1: t.can_lan_1 + 100 }, 'sai cân'), /khớp/);
    assert.throws(() => app.tickets.update(t.id, { can_lan_1: Infinity }, 'vô hạn'), /hữu hạn/);
    assert.throws(() => app.tickets.update(t.id, { kl_hang_kg: Infinity }, 'vô hạn'), /hữu hạn/);
    assert.throws(() => app.tickets.update(t.id, { ghi_chu: 'thử' }, '   '), /lý do/);
    assert.equal(app.tickets.get(t.id).kl_hang_kg, t.kl_hang_kg, 'lỗi giữ nguyên phiếu');
    const kg = t.kl_hang_kg + 100;
    const c1 = t.can_lan_1 >= t.can_lan_2 ? t.can_lan_2 + kg : t.can_lan_2 - kg;
    app.tickets.update(t.id, { can_lan_1: c1, kl_hang_kg: kg }, 'điều chỉnh đủ số cân');
    const updated = app.tickets.update(t.id, { ngay_gio_can_1: '2026-10-21T10:00:00', ngay_gio_can_2: null }, 'bỏ giờ cân cũ');
    assert.equal(updated.ngay_gio_can_2, null);
  } finally { rt.close(); }
});

test('commit kiểm lại ngưỡng KL đã đổi sau preview và rollback toàn bộ lô', async () => {
  const rt = await setup();
  try {
    const app = rt.app;
    const t = app.db.get("SELECT * FROM phieu_can WHERE trang_thai='ACTIVE' AND trang_thai_tinh_gia='OK' LIMIT 1");
    const headers = ['Số phiếu', 'Biển số', 'Nơi xuất', 'Giờ cân 1', 'Cân 1', 'Cân 2', 'KL hàng'];
    const buffer = await xlsxBuffer([headers, ['NEW-LIMIT', t.bien_so, t.noi_xuat_goc, '22/10/2026 10:00', 30000, 13000, 17000]]);
    const opened = await app.imports.open({ buffer, fileName: 'limits.xlsx' });
    const sheet = app.imports.sheetInfo(opened.token, opened.suggestedSheet);
    const pv = app.imports.preview(opened.token, { sheetName: sheet.sheetName, headerRow: sheet.headerRow, mapping: sheet.mapping });
    assert.equal(pv.counts.new, 1);
    const batches = app.db.get('SELECT COUNT(*) n FROM import_batch').n;
    app.settings.set('kl_hop_ly', { min_kg: 100, max_kg: 16000 });
    assert.throws(() => app.imports.commit(opened.token), /không còn hợp lệ/);
    assert.equal(app.db.get("SELECT COUNT(*) n FROM phieu_can WHERE so_phieu='NEW-LIMIT'").n, 0);
    assert.equal(app.db.get('SELECT COUNT(*) n FROM import_batch').n, batches);
  } finally { rt.close(); }
});

test('phân quyền thực tế chặn người sửa tự duyệt; người duyệt khác xác nhận được', async () => {
  const rt = await setup();
  const pw = 'kiem-thu-release-08';
  const call = async (ch, args) => { const r = await rt.dispatch(ch, args); assert.equal(r.ok, true, r.error); return r.data; };
  try {
    await call('auth.enable', { ten_dang_nhap: 'admin', ho_ten: 'Quản trị', mat_khau: pw });
    await call('auth.createUser', { ten_dang_nhap: 'reviewer', ho_ten: 'Người duyệt', vai_tro: 'DUYET', mat_khau: pw });
    await call('settings.set', { key: 'duyet_phieu', value: { bat: true } });
    const t = rt.app.db.get("SELECT * FROM phieu_can WHERE trang_thai='ACTIVE' LIMIT 1");
    await call('tickets.update', { id: t.id, data: { xe_tra_ve: t.xe_tra_ve ? 0 : 1 }, note: 'thay đổi số liệu' });
    const self = await call('tickets.approve', { ids: [t.id] });
    assert.equal(self.ok, 0);
    assert.match(self.results[0].reason, /không tự duyệt/);
    await call('auth.login', { ten_dang_nhap: 'reviewer', mat_khau: pw });
    const other = await call('tickets.approve', { ids: [t.id] });
    assert.equal(other.ok, 1);
    assert.equal(rt.app.tickets.get(t.id).duyet_boi, 'reviewer');
  } finally { rt.close(); }
});
