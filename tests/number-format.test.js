'use strict';
/** Định dạng số dùng chuẩn HAK: chỉ đổi CHUỖI HIỂN THỊ — giá trị tính tiền và ô số Excel giữ nguyên. */
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const R = require('../renderer/vendor/hak-report-standard/hak-report-standard.js');
const { fmtVN } = require('../src/utils/numfmt');
const { createApp, SEED_DIR } = require('../src/app');
const { loadInitialData } = require('../src/services/InitialDataService');
const exporters = require('../src/excel/exporters');
const documents = require('../src/print/documents');

test('số âm tại điểm giữa, số 0, âm nhỏ làm tròn về 0, dấu phân cách kiểu VN', () => {
  const f = (v, d) => R.formatNumber(v, { minDecimals: d, maxDecimals: d });
  assert.equal(f(0.5, 0), '1'); assert.equal(f(-0.5, 0), '-1');         // nửa → xa 0 (như Excel ROUND)
  assert.equal(f(-0.4, 0), '0'); assert.equal(f(-0.004, 2), '0,00'); assert.equal(f(0, 3), '0,000');
  assert.equal(f(1234567.891, 2), '1.234.567,89'); assert.equal(f(-1234.5, 1), '-1.234,5');
  assert.equal(f(30000, 0), '30.000'); assert.equal(f(17.5, 3), '17,500');
  assert.equal(fmtVN(-0.3), '0'); assert.equal(fmtVN(null), ''); assert.equal(fmtVN('abc'), '');
  assert.equal(fmtVN(116700), '116.700');                                   // đơn giá đ/tấn
});

test('Excel: ô tiền/kg là SỐ (không phải chuỗi đã định dạng) để tính tiếp; hiển thị bằng định dạng ô', async () => {
  const app = createApp({ dbFile: ':memory:', driver: 'node:sqlite' });
  await loadInitialData(app, SEED_DIR);
  const st = app.reports.statements({ da_tinh_gia: true })[0];
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await exporters.statementWorkbook(documents.statementDoc(app, { don_vi_id: st.don_vi.id, da_tinh_gia: true }, {})));
  let found = false;
  wb.eachSheet((ws) => ws.eachRow((r) => r.eachCell((c) => {
    const v = c.value && typeof c.value === 'object' && 'result' in c.value ? c.value.result : c.value;
    if (v === st.tong_tien) { found = true; assert.equal(typeof v, 'number'); }
  })));
  assert.ok(found, 'có ô tổng thanh toán dạng số');
  // giá trị lưu/tính không đi qua định dạng hiển thị
  const t = app.db.get(`SELECT kl_hang_kg, don_gia, tien_truoc_vat FROM phieu_can WHERE trang_thai_tinh_gia='OK' LIMIT 1`);
  assert.equal(typeof t.kl_hang_kg, 'number'); assert.equal(typeof t.tien_truoc_vat, 'number');
});
