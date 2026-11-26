'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { createApp } = require('../src/app');

test('xử lý đa dạng định dạng giờ khi ghép cột ngày và giờ riêng', async () => {
  const app = createApp({ dbFile: ':memory:', driver: 'node:sqlite' });
  try {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Phiếu cân');
    const cols = {
      so_phieu: 'Số phiếu', bien_so: 'Biển số', ngay_gio_can_1: 'Ngày cân', gio_can_1: 'Giờ cân', kl_hang_kg: 'KL hàng',
    };
    ws.addRow(Object.values(cols));

    // Dòng 1: Giờ dạng 8h30 (chuẩn văn bản tiếng Việt)
    ws.addRow(['P101', '92H-00903', '05/10/2026', '8h30', 15000]);
    // Dòng 2: Giờ dạng 08:45:00 (chuẩn hh:mm:ss)
    ws.addRow(['P102', '92H-00903', '05/10/2026', '08:45:00', 16000]);
    // Dòng 3: Giờ dạng số thập phân Excel (0.5 = 12:00:00 trưa)
    ws.addRow(['P103', '92H-00903', '05/10/2026', 0.5, 17000]);
    // Dòng 4: Giờ dạng 1:30 PM (13:30:00)
    ws.addRow(['P104', '92H-00903', '05/10/2026', '1:30 PM', 18000]);

    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const open = await app.imports.open({ fileName: 'test-time.xlsx', buffer: buf });

    const draft = {
      name: 'Mẫu kiểm tra giờ',
      headerRow: 0,
      headerRows: 1,
      columns: cols,
      fallbackUnit: 'kg',
    };

    const check = app.imports.check(open.token, { sheetName: 'Phiếu cân', draft });
    assert.equal(check.blocking, false);
    assert.equal(check.sample.length, 4);

    assert.equal(check.sample[0].ngay_gio_can_1, '2026-10-05T08:30:00');
    assert.equal(check.sample[1].ngay_gio_can_1, '2026-10-05T08:45:00');
    assert.equal(check.sample[2].ngay_gio_can_1, '2026-10-05T12:00:00');
    assert.equal(check.sample[3].ngay_gio_can_1, '2026-10-05T13:30:00');
  } finally {
    app.close();
  }
});
