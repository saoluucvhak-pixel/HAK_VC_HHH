'use strict';
/** 0.8.4: tên tệp dựng từ tham số/tên tệp người dùng không được ghi ra ngoài thư mục exports/imports (path traversal). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { xlsxBuffer } = require('./helpers/xlsx');
const { createRuntime } = require('../src/runtime');
const { loadInitialData } = require('../src/services/InitialDataService');
const { SEED_DIR } = require('../src/app');

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const setup = async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'vcpt-')); const dataDir = path.join(base, 'data-root'); const outside = path.join(base, 'ngoai');
  fs.mkdirSync(outside, { recursive: true });
  const rt = createRuntime({ dataDir, driver: 'node:sqlite' }); await loadInitialData(rt.app, SEED_DIR);
  return { rt, base, dataDir, outside };
};
const rel = (outside, dataDir) => path.relative(path.join(dataDir, 'exports'), outside).split(path.sep).join('/');

test('export.timeline: bien_so chứa ../ không ghi được tệp ra ngoài thư mục exports', async () => {
  const { rt, dataDir, outside } = await setup();
  try {
    const evil = `a/../${rel(outside, dataDir)}/PWN`;      // tiền tố tên tệp (ChiTietXe_a) nuốt một cấp '..' nên thêm một cấp
    await rt.dispatch('export.timeline', { bien_so: evil });
    assert.deepEqual(fs.readdirSync(outside), [], 'không được có tệp nào ngoài thư mục exports: ' + fs.readdirSync(outside));
    for (const f of walk(path.join(dataDir, 'exports'))) assert.ok(path.resolve(f).startsWith(path.resolve(dataDir, 'exports') + path.sep), f);
  } finally { rt.close(); }
});

test('import.commit: fileName chứa ../ không ghi bản sao ra ngoài thư mục imports', async () => {
  const { rt, dataDir, outside } = await setup();
  try {
    const H = ['Số phiếu', 'Biển số', 'Nơi xuất', 'Giờ cân 1', 'Giờ cân 2', 'Cân 1', 'Cân 2', 'KL hàng'];
    const plate = rt.app.db.get('SELECT bien_so_chuan b FROM xe LIMIT 1').b;
    const evil = `a/../${path.relative(path.join(dataDir, 'imports'), outside).split(path.sep).join('/')}/pwned.xlsx`;
    const o = (await rt.dispatch('import.open', { base64: (await xlsxBuffer([H, ['AT1', plate, 'Quế Sơn', '05/10/2026 08:00:00', '05/10/2026 08:30:00', 30000, 13000, 17000]])).toString('base64'), fileName: evil })).data;
    const si = (await rt.dispatch('import.sheetInfo', { token: o.token, sheetName: o.suggestedSheet })).data;
    await rt.dispatch('import.preview', { token: o.token, sheetName: si.sheetName, headerRow: si.headerRow, mapping: si.mapping });
    const r = await rt.dispatch('import.commit', { token: o.token });
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(fs.readdirSync(outside), [], 'bản sao tệp nhập bị ghi ra ngoài imports');
    assert.ok(r.data.savedCopy && path.resolve(r.data.savedCopy).startsWith(path.resolve(dataDir, 'imports') + path.sep));
  } finally { rt.close(); }
});

test('writeExport/saveImportCopy: tên hợp lệ vẫn ghi bình thường (xuất Excel Phiếu cân)', async () => {
  const { rt, dataDir } = await setup();
  try {
    const r = await rt.dispatch('export.tickets', { filter: {} });
    assert.equal(r.ok, true, r.error); assert.ok(path.resolve(r.data.path).startsWith(path.resolve(dataDir, 'exports') + path.sep)); assert.ok(fs.existsSync(r.data.path));
  } finally { rt.close(); }
});
