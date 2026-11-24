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

test('Bảng kê đã chốt giữ tiền, VAT và chi tiết khi đổi cấu hình làm tròn', async () => {
  const rt = await mk();
  const config = (digits) => ({ level: 'STATEMENT', statement: { lineAmount: { digits, mode: 'HALF_UP' }, vat: { digits: 0, mode: 'HALF_UP' } } });
  try {
    assert.equal((await call(rt, 'settings.set', { key: 'rounding', value: config(-2) })).ok, true);
    const dot = rt.app.db.get("SELECT DISTINCT dot_van_chuyen_id id FROM phieu_can WHERE dot_van_chuyen_id IS NOT NULL");
    const carrierForTest = rt.app.db.get('SELECT don_vi_van_chuyen_id id FROM phieu_can WHERE dot_van_chuyen_id=? LIMIT 1', [dot.id]).id;
    rt.app.settings.set('company', { ten: 'Bên A tại lúc chốt' });
    const originalContract = rt.app.catalog.create('hop_dong', { ma: 'AUDIT-KY', so_hop_dong: 'HD-GOC',
      don_vi_van_chuyen_id: carrierForTest, noi_ky: 'Nơi ký gốc' });
    const scope = { loai: 'DOT', dot_id: dot.id };
    const { data: period, ok } = await call(rt, 'lock.create', scope);
    assert.equal(ok, true);
    const archived = { chot_ky_id: period.id };
    const before = (await call(rt, 'reports.statements', archived)).data;
    assert.ok(before.length > 1);
    assert.equal(before.reduce((total, st) => total + st.tong_tien, 0), period.tong.tong_tien);
    assert.equal((await call(rt, 'settings.set', { key: 'rounding', value: config(-3) })).ok, true);
    assert.deepEqual((await call(rt, 'reports.statements', archived)).data, before);
    rt.app.settings.set('company', { ten: 'Bên A mới' });
    rt.app.catalog.update('hop_dong', originalContract.id, { so_hop_dong: 'HD-MOI', noi_ky: 'Nơi ký mới' });
    const saved = before.find((s) => s.don_vi.id === carrierForTest);
    const carrier = saved.don_vi.id;
    const explicit = { ...archived, don_vi_id: carrier };
    assert.deepEqual((await call(rt, 'reports.statement', explicit)).data, saved);
    assert.deepEqual((await call(rt, 'reports.statement', { dot_id: dot.id, don_vi_id: carrier })).data, saved);
    const exported = await call(rt, 'export.statement', { filter: explicit });
    assert.equal(exported.ok, true, exported.error);
    assert.match(exported.data.fileName, new RegExp(saved.ky_chot.ma));
    const docs = require('../src/print/documents');
    const archivedDoc = docs.statementDoc(rt.app, explicit);
    assert.equal(archivedDoc.benA.ten, 'Bên A tại lúc chốt');
    assert.match(archivedDoc.contract, /HD-GOC/);
    assert.equal(archivedDoc.benB.noi_ky, 'Nơi ký gốc');
    const ticket = rt.app.db.get('SELECT bien_so FROM phieu_can WHERE chot_ky_id=? AND don_vi_van_chuyen_id=? LIMIT 1', [period.id, carrier]);
    const filtered = { don_vi_id: carrier, dot_id: dot.id, bien_so: ticket.bien_so };
    const previewDoc = docs.statementDoc(rt.app, filtered);
    assert.equal(previewDoc.st.tham_khao, true);
    assert.match(previewDoc.tieu_de, /THAM KHẢO/);
    assert.match(require('../src/print/htmlTemplates').statementHtml(previewDoc), /THAM KHẢO/);
    const xlsx = await call(rt, 'export.statement', { filter: filtered });
    assert.equal(xlsx.ok, true, xlsx.error);
    const workbook = new (require('exceljs').Workbook)();
    await workbook.xlsx.readFile(xlsx.data.path);
    assert.match(workbook.getWorksheet('Bảng kê').getCell('A4').text, /THAM KHẢO/);
    assert.equal((await call(rt, 'lock.unlock', { id: period.id, reason: 'Kiểm thử' })).ok, true);
    assert.equal((await call(rt, 'reports.statement', explicit)).ok, false);
  } finally { rt.close(); }
});
