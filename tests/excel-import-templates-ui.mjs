// CHROMIUM_PATH=/usr/bin/chromium node tests/excel-import-templates-ui.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { chromium } from 'playwright-core';
import dev from '../tools/dev-server.js';

const screenshots = path.resolve(process.env.EXCEL_TEMPLATE_SCREENSHOTS || 'docs/screenshots');
fs.mkdirSync(screenshots, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hak-excel-ui-'));
const server = await dev.start({ port: 0, dataDir });
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1380 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  async function fixture(order, unit = 'tấn', alternatives = false) {
    const book = new ExcelJS.Workbook();
    book.addWorksheet('Bìa').addRow(['Bảng tổng hợp']);
    const sheet = book.addWorksheet('Phiếu cân');
    sheet.addRow(['PHIẾU CÂN TỔNG HỢP']);
    const rows = [
      ['Mã phiếu', 'Biển số', 'Ngày', 'Khối lượng', 'ĐVT', 'Kho', 'Nội dung'],
      [null, null, 'cân', 'hàng', null, null, null],
      [7, '92H-00903', '05/10/2026 08:00', 12.5, unit, 'Kho QS', 'Giao buổi sáng'],
      ['00008', '92H-00903', '05/10/2026 09:00', 15000, 'kg', 'Kho QS', 'Đã đối chiếu'],
      ['Tổng cộng', null, null, 27000, 'kg'],
      [null, null, 'Ngày 05 tháng 10 năm 2026'],
    ];
    for (const row of rows) sheet.addRow(order.map((i) => row[i]));
    sheet.getRow(4).getCell(order.indexOf(0) + 1).numFmt = '00000';
    if (alternatives) {
      const alternate = book.addWorksheet('Cột đổi vị trí');
      alternate.addRow(['PHIẾU CÂN TỔNG HỢP']);
      for (const row of rows) alternate.addRow([6, 5, 4, 3, 2, 1, 0].map((index) => row[index]));
      const missing = book.addWorksheet('Thiếu tiêu đề');
      missing.addRow(['PHIẾU CÂN TỔNG HỢP']);
      rows.forEach((row, i) => missing.addRow(i === 1 ? [...row.slice(0, 6), 'Cột khác'] : row));
    }
    return { name: 'phieu-can-tong-hop.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await book.xlsx.writeBuffer()) };
  }
  async function pick(locator, file) {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), locator.click()]);
    await chooser.setFiles(file);
  }

  const sample = await fixture([0, 1, 2, 3, 4, 5, 6], 'tấn', true);
  const moved = await fixture([6, 5, 4, 3, 2, 1, 0]);
  await page.goto(`http://127.0.0.1:${server.server.address().port}/`);
  await page.locator('[data-nav=settings]').click();
  const card = page.locator('[data-excel-templates]');
  const editor = card.locator('[data-template-editor]');
  await card.getByRole('button', { name: 'Tạo mẫu' }).click();
  await pick(editor.locator('[data-template-file]'), sample);
  await editor.getByLabel('Sheet mẫu').selectOption('Phiếu cân');
  await editor.getByLabel('Tên mẫu').fill('Phiếu cân nhà cung cấp A');
  await editor.getByLabel('Dòng cuối của tiêu đề (từ 1)').fill('3');
  await editor.getByLabel('Dòng cuối của tiêu đề (từ 1)').press('Tab');
  await editor.locator('[data-template-map=kl_hang_kg] option').getByText('4. hàng', { exact: true }).waitFor({ state: 'attached' });
  await editor.getByLabel('Số dòng tiêu đề').selectOption('2');
  await editor.locator('[data-template-map=kl_hang_kg] option').getByText('4. Khối lượng hàng', { exact: true }).waitFor({ state: 'attached' });
  await editor.locator('[data-template-map=kl_hang_kg]').selectOption('3');
  await editor.locator('[data-template-map=ghi_chu]').selectOption('6');
  await editor.getByLabel('Sheet mẫu').selectOption('Cột đổi vị trí');
  await editor.locator('[data-template-map=ghi_chu] option').getByText('1. Nội dung', { exact: true }).waitFor({ state: 'attached' });
  assert.equal(await editor.locator('[data-template-map=ghi_chu]').inputValue(), '0');
  await editor.getByLabel('Sheet mẫu').selectOption('Thiếu tiêu đề');
  await editor.getByText(/Thiếu cột “Nội dung”/).waitFor();
  assert.equal(await editor.getByRole('button', { name: 'Đọc thử' }).isEnabled(), false);
  await editor.getByLabel('Sheet mẫu').selectOption('Phiếu cân');
  await editor.locator('[data-template-map=ghi_chu] option').getByText('7. Nội dung', { exact: true }).waitFor({ state: 'attached' });
  assert.equal(await editor.locator('[data-template-map=ghi_chu]').inputValue(), '6');
  assert.deepEqual(await editor.getByRole('heading', { level: 4 }).allTextContents(),
    ['1. Chọn tệp và tiêu đề', '2. Ghép cột', '3. Đọc thử và đối chiếu']);
  assert.equal(await editor.locator('[data-template-heading=kl_hang_kg]').textContent(), 'Khối lượng hàng');
  assert.equal(await editor.getByRole('button', { name: 'Lưu mẫu' }).isEnabled(), false);
  await editor.getByRole('button', { name: 'Đọc thử' }).click();
  const trial = card.locator('[data-template-trial]');
  await trial.getByText('00007', { exact: true }).waitFor();
  assert.match(await trial.innerText(), /2 phiếu · 27\.500 kg/);
  assert.match(await trial.innerText(), /Chênh lệch .*500 kg/);
  await editor.getByRole('button', { name: 'Lưu mẫu' }).click();
  await card.getByRole('button', { name: 'Đặt mặc định' }).click();
  await card.locator('[data-template-default]').getByText('Phiếu cân nhà cung cấp A').waitFor();
  await page.getByText('Đã lưu mẫu nhập Excel', { exact: true }).waitFor({ state: 'hidden' });
  const viewport = page.viewportSize();
  await page.setViewportSize({ ...viewport, height: 2400 });
  await trial.getByText('00007', { exact: true }).waitFor();
  await card.screenshot({ path: path.join(screenshots, 'excel-import-template.png') });
  await page.setViewportSize(viewport);
  await card.getByRole('button', { name: 'Tải file mẫu' }).click();
  await page.getByLabel(/Số dòng nhập liệu/).fill('525');
  await page.getByRole('button', { name: 'Đồng ý', exact: true }).click();
  await page.getByText(/Đã xuất: .*MAU_Phieu_can_Tuy_chinh.xlsx/).waitFor();
  const exported = new ExcelJS.Workbook();
  await exported.xlsx.readFile(path.join(dataDir, 'exports', 'MAU_Phieu_can_Tuy_chinh.xlsx'));
  assert.equal(exported.getWorksheet('Phiếu cân').getCell('D3').value, 'Khối lượng hàng');
  assert.equal(exported.getWorksheet('Phiếu cân').getCell('A4').value, null);
  assert.equal(exported.getWorksheet('Phiếu cân').getCell('A528').protection.locked, false);
  assert.equal(exported.getWorksheet('Minh họa').getCell('A3').value, '00001');

  await page.reload();
  await page.locator('[data-nav=settings]').click();
  await card.locator('[data-template-default]').getByText('Phiếu cân nhà cung cấp A').waitFor();
  await card.getByRole('button', { name: 'Sao chép' }).click();
  await pick(editor.locator('[data-template-file]'), sample);
  await editor.getByLabel('Sheet mẫu').selectOption('Phiếu cân');
  await editor.getByRole('button', { name: 'Đọc thử' }).click();
  await editor.getByRole('button', { name: 'Lưu mẫu' }).click();
  await card.getByText('Phiếu cân nhà cung cấp A (bản sao)', { exact: true }).waitFor();

  await page.locator('[data-nav=import]').click();
  await pick(page.locator('[data-act=pick]'), await fixture([6, 5, 4, 3, 2, 1, 0], 'lb'));
  await page.locator('[data-check]').getByText(/Dòng Excel 4.*lb/).waitFor();
  assert.equal(await page.locator('[data-act=preview]').isEnabled(), false);
  await page.locator('[data-import-edit-mapping]').click();
  await page.locator('[data-import-reading]').getByText('Ghép thủ công').waitFor();
  await page.locator('[data-import-template]').selectOption('');
  await page.locator('[data-import-reading]').getByText('Tự nhận diện').waitFor();
  await page.getByRole('button', { name: '‹ Quay lại' }).click();
  await pick(page.locator('[data-act=pick]'), moved);
  await page.locator('[data-import-reading]').getByText('Phiếu cân nhà cung cấp A').waitFor();
  await page.locator('[data-check]').getByText('00007', { exact: true }).waitFor();
  await page.locator('[data-act=preview]').click();
  await page.locator('[data-act=commit]').click();
  await page.locator('.modal').getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByText('Import hoàn tất', { exact: false }).first().waitFor();

  await page.locator('[data-nav=settings]').click();
  await card.getByRole('button', { name: 'Dùng Tự nhận diện' }).click();
  await card.locator('[data-template-default]').getByText('Tự nhận diện').waitFor();
  await page.locator('[data-nav=batches]').click();
  await page.getByRole('button', { name: 'Chi tiết' }).click();
  await page.locator('.modal [data-import-reading]').getByText('Phiếu cân nhà cung cấp A').waitFor();
  await pick(page.locator('[data-batch-read]'), moved);
  await page.locator('.modal [data-template-trial]').getByText('00007', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Chromium: tạo, thử, lưu, sao chép mẫu, áp dụng mặc định, tải lại và đọc lại lô thành công');
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.server.close(resolve));
  server.rt.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
