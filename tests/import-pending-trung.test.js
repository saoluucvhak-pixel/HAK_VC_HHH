'use strict';
/** P2 0.8.2: nhập lại cùng một dòng xung đột không được tạo thêm dòng "Cần kiểm tra"; khác số liệu thì tạo dòng mới (cùng nhóm theo phiếu). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { xlsxBuffer } = require('./helpers/xlsx');
const { createRuntime } = require('../src/runtime');
const { loadInitialData } = require('../src/services/InitialDataService');
const { SEED_DIR } = require('../src/app');

const H = ['Số phiếu', 'Biển số', 'Nơi xuất', 'Giờ cân 1', 'Giờ cân 2', 'Cân 1', 'Cân 2', 'KL hàng'];
const fmt = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 19)}`;

async function setup() {
  const rt = createRuntime({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'vcpt-')), driver: 'node:sqlite' });
  await loadInitialData(rt.app, SEED_DIR);
  const ok = async (ch, a) => { const r = await rt.dispatch(ch, a || {}); assert.equal(r.ok, true, ch + ': ' + r.error); return r.data; };
  const t0 = rt.app.db.get(`SELECT * FROM phieu_can WHERE trang_thai='ACTIVE' AND chot_ky_id IS NULL ORDER BY id LIMIT 1`);
  // dòng xung đột: cùng khóa, KL khác (cân 2 lệch). extra thay đổi để có "số liệu khác"
  const conflictRow = (extra = 0) => [t0.so_phieu, t0.bien_so_goc, t0.noi_xuat_goc, fmt(t0.ngay_gio_can_1), fmt(t0.ngay_gio_can_2), t0.can_lan_1, t0.can_lan_1 + 15000 + extra, 15000 + extra];
  const importRows = async (rows, fileName) => {
    const o = await ok('import.open', { base64: (await xlsxBuffer([H, ...rows])).toString('base64'), fileName });
    const si = await ok('import.sheetInfo', { token: o.token, sheetName: o.suggestedSheet });
    const pv = await ok('import.preview', { token: o.token, sheetName: si.sheetName, headerRow: si.headerRow, mapping: si.mapping });
    const cm = await ok('import.commit', { token: o.token });
    return { pv, cm };
  };
  return { rt, ok, t0, conflictRow, importRows };
}

test('nhập 2 lần cùng một dòng xung đột → chỉ 1 dòng chờ; lần 2 phân loại PENDING_ALREADY, ghi SKIP kèm ghi chú lô cũ, không mở thêm cảnh báo', async () => {
  const { rt, ok, t0, conflictRow, importRows } = await setup();
  try {
    const a = await importRows([conflictRow()], 'a.xlsx');
    assert.equal(a.pv.counts.conflict, 1);
    const alerts1 = rt.app.db.get(`SELECT COUNT(*) n FROM canh_bao WHERE entity='phieu_can' AND entity_id=? AND loai='DUPLICATE_TICKET'`, [t0.id]).n;
    const b = await importRows([conflictRow()], 'b.xlsx');
    assert.equal(b.pv.counts.pendingAlready, 1, 'bước xem trước phải hiện riêng số dòng đã chờ kiểm tra');
    assert.equal(b.pv.counts.conflict, 0);
    const pend = await ok('import.pending', {});
    assert.equal(pend.filter((p) => p.phieu_can_id === t0.id).length, 1, 'chỉ 1 dòng chờ cho cùng phiếu');
    const row = rt.app.db.get(`SELECT phan_loai, hanh_dong, errors_json, raw_json FROM import_batch_row WHERE batch_id=? `, [b.cm.batchId]);
    assert.equal(row.phan_loai, 'PENDING_ALREADY'); assert.equal(row.hanh_dong, 'SKIP');
    const batchRow = rt.app.db.get(`SELECT * FROM import_batch_row WHERE batch_id=?`, [b.cm.batchId]);
    assert.match(String(batchRow.errors_json || batchRow.diffs_json || ''), new RegExp(`lô #${a.cm.batchId}`));
    assert.equal(rt.app.db.get(`SELECT COUNT(*) n FROM canh_bao WHERE entity='phieu_can' AND entity_id=? AND loai='DUPLICATE_TICKET'`, [t0.id]).n, alerts1, 'không mở thêm cảnh báo');
    assert.equal(b.cm.conflict, 0);
  } finally { rt.close(); }
});

test('file xung đột thứ hai có số liệu khác → 2 dòng chờ cùng phiếu; import.pending trả nhóm theo phiếu', async () => {
  const { rt, ok, t0, conflictRow, importRows } = await setup();
  try {
    await importRows([conflictRow(0)], 'a.xlsx');
    const b = await importRows([conflictRow(1000)], 'b.xlsx');
    assert.equal(b.pv.counts.conflict, 1); assert.equal(b.pv.counts.pendingAlready || 0, 0);
    const pend = (await ok('import.pending', {})).filter((p) => p.phieu_can_id === t0.id);
    assert.equal(pend.length, 2);
    const groups = await ok('import.pendingGroups', {});
    const g = groups.find((x) => x.phieu_can_id === t0.id);
    assert.ok(g, 'phải có nhóm theo phiếu'); assert.equal(g.rows.length, 2); assert.equal(g.so_phieu, t0.so_phieu);
  } finally { rt.close(); }
});

test('hai bản xem trước cùng một dòng xung đột rồi commit lần lượt: dòng thứ hai bị phát hiện lúc commit (không tạo trùng)', async () => {
  const { rt, ok, t0, conflictRow } = await setup();
  try {
    const open = async (name) => {
      const o = await ok('import.open', { base64: (await xlsxBuffer([H, conflictRow()])).toString('base64'), fileName: name });
      const si = await ok('import.sheetInfo', { token: o.token, sheetName: o.suggestedSheet });
      await ok('import.preview', { token: o.token, sheetName: si.sheetName, headerRow: si.headerRow, mapping: si.mapping });
      return o.token;
    };
    const t1 = await open('p1.xlsx'); const t2 = await open('p2.xlsx');       // cả hai xem trước khi chưa có dòng chờ nào
    await ok('import.commit', { token: t1 });
    const c2 = await ok('import.commit', { token: t2 });
    assert.equal(c2.conflict, 0);
    assert.equal((await ok('import.pending', {})).filter((p) => p.phieu_can_id === t0.id).length, 1);
  } finally { rt.close(); }
});
