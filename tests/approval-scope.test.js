'use strict';
/** Phạm vi nghiệp vụ của phiếu Nháp do BACKEND bảo đảm: tham số từ người gọi (moi_trang_thai, trang_thai_duyet, bộ lọc lưu từ bản cũ) không được kéo Nháp vào báo cáo/bảng kê/xuất/chốt kỳ. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { createRuntime } = require('../src/runtime');
const { loadInitialData } = require('../src/services/InitialDataService');
const { SEED_DIR } = require('../src/app');

test('Nháp không lọt vào đầu ra dù người gọi truyền moi_trang_thai / trang_thai_duyet', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcap-'));
  const rt = createRuntime({ dataDir: dir, driver: 'node:sqlite' });
  try {
    await loadInitialData(rt.app, SEED_DIR);
    const d = async (ch, a) => { const r = await rt.dispatch(ch, a || {}); assert.equal(r.ok, true, `${ch}: ${r.error}`); return r.data; };
    await d('settings.set', { key: 'duyet_phieu', value: { bat: true } });
    const t = rt.app.db.get(`SELECT id, ngay_can FROM phieu_can WHERE trang_thai='ACTIVE' AND chot_ky_id IS NULL ORDER BY id LIMIT 1`);
    await d('tickets.update', { id: t.id, data: { kl_hang_kg: 21000 }, note: 'thử' });
    assert.equal(rt.app.tickets.get(t.id).trang_thai_duyet, 'NHAP');
    const base = await d('reports.dashboard', {});
    const ngay = String(t.ngay_can).slice(0, 10);
    for (const extra of [{ moi_trang_thai: true }, { trang_thai_duyet: 'NHAP' }, { moi_trang_thai: true, trang_thai_duyet: 'NHAP' }, { moi_trang_thai: '1' }]) {
      const dash = await d('reports.dashboard', extra);
      assert.deepEqual(dash, base, 'Dashboard bị đổi bởi ' + JSON.stringify(extra));
      for (const ch of ['reports.byVehicle', 'reports.byCarrier', 'reports.byOrigin', 'reports.byDate', 'reports.byDot']) {
        assert.deepEqual(await d(ch, extra), await d(ch, {}), ch + ' bị đổi bởi ' + JSON.stringify(extra));
      }
      assert.deepEqual(await d('reports.statements', extra), await d('reports.statements', {}), 'Bảng kê');
      assert.deepEqual(await d('lock.preview', { loai: 'KY', tu_ngay: ngay, den_ngay: ngay, ...extra }), await d('lock.preview', { loai: 'KY', tu_ngay: ngay, den_ngay: ngay }), 'Chốt kỳ preview');
    }
    // kênh liệt kê phiếu cân là nơi duy nhất được thấy Nháp
    assert.ok((await d('tickets.ids', { filter: {} })).includes(t.id));
    assert.ok((await d('tickets.ids', { filter: { trang_thai_duyet: 'NHAP' } })).includes(t.id));
    assert.ok(!(await d('tickets.ids', { filter: { trang_thai_duyet: 'DA_DUYET' } })).includes(t.id));
  } finally { rt.close && rt.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
