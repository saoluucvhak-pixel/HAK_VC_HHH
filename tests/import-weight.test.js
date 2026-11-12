'use strict';
/** KL hàng phải khớp |Cân 1 − Cân 2|; header "Cân 1/Cân 2" được nhận dạng; dispatch chỉ nhận kênh có thật. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
const { createApp, SEED_DIR } = require('../src/app');
const { createRuntime } = require('../src/runtime');
const { detectHeader } = require('../src/excel/columnMapping');
const { parseTickets } = require('../src/excel/ticketParser');

const SAMPLE = path.join(__dirname, 'fixtures', 'sample-v47.xlsx');
const H = ['Số phiếu', 'Biển số', 'Nơi xuất', 'Giờ cân 1', 'Giờ cân 2', 'Cân 1', 'Cân 2', 'KL hàng'];

test('header "Cân 1" / "Cân 2" được map vào can_lan_1 / can_lan_2', () => {
  const m = detectHeader([H]).mapping;
  assert.equal(m.can_lan_1, 5);
  assert.equal(m.can_lan_2, 6);
  assert.equal(m.kl_hang_kg, 7);
  const m2 = detectHeader([['Số phiếu', 'Biển số', 'Ngày giờ cân 1', 'Cân lần 1 (kg)', 'Cân lần 2 (kg)', 'KL hàng (kg)']]).mapping;
  assert.equal(m2.can_lan_1, 3);
  assert.equal(m2.can_lan_2, 4);
});

test('parseTickets: KL hàng lệch |cân2 − cân1| bị báo INVALID_WEIGHT; khớp thì không', () => {
  const rows = [H,
    ['1', '92H-00903', 'QS', '01/10/2026 08:00', '01/10/2026 08:30', 30000, 13000, 99999],
    ['2', '92H-00903', 'QS', '01/10/2026 09:00', '01/10/2026 09:30', 30000, 13000, 17000]];
  const out = parseTickets(rows, 0, detectHeader(rows).mapping);
  assert.ok(out[0].errors.some((e) => e.startsWith('INVALID_WEIGHT')));
  assert.deepEqual(out[1].errors, []);
});

test('import end-to-end: phiếu KL lệch cân bị chặn, không vào DB', () => {
  const app = createApp({ dbFile: ':memory:', driver: 'node:sqlite' });
  app.seed.load(JSON.parse(fs.readFileSync(path.join(SEED_DIR, 'sample-v47.json'), 'utf8')));
  app.vehicleImport.commit(app.vehicleImport.preview({ filePath: SAMPLE }).token);
  const dot = app.db.get('SELECT id FROM dot_van_chuyen LIMIT 1');
  const ws = XLSX.utils.aoa_to_sheet([H, ['9005', '92H-00903', 'Quế Sơn', '02/10/2026 10:00', '02/10/2026 10:30', 30000, 13000, 99999]]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'S');
  const o = app.imports.open({ buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), fileName: 'x.xlsx' });
  const si = app.imports.sheetInfo(o.token, o.suggestedSheet);
  const pv = app.imports.preview(o.token, { sheetName: si.sheetName, headerRow: si.headerRow, mapping: si.mapping, dotId: dot.id });
  assert.equal(pv.counts.error, 1);
  assert.equal(app.imports.commit(o.token, {}).inserted, 0);
  assert.equal(app.db.get(`SELECT COUNT(*) n FROM phieu_can WHERE so_phieu='9005'`).n, 0);
});

test('dispatch: chỉ kênh có thật; constructor/__proto__ bị từ chối', async () => {
  const rt = createRuntime({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'vc-')), driver: 'node:sqlite' });
  try {
    for (const ch of ['constructor', '__proto__', 'toString', 'khong.ton.tai']) {
      const r = await rt.dispatch(ch, {});
      assert.equal(r.ok, false, ch);
      assert.match(r.error, /Kênh không tồn tại/);
    }
    assert.equal((await rt.dispatch('settings.all')).ok, true);
  } finally { rt.close(); }
});
