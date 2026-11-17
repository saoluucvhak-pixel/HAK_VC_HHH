// Chạy: node tests/ui-smoke.mjs  — dev server + Playwright, chụp màn hình vào docs/screenshots
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const { start } = require('../tools/dev-server.js');
import fs from 'fs'; import path from 'path';
const out = path.resolve('docs/screenshots'); fs.mkdirSync(out, { recursive: true });
const srv = await start({ port: 5191 });
const errors = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const shot = async (n) => { await page.waitForTimeout(250); await page.screenshot({ path: path.join(out, n + '.png') }); };
const nav = async (id) => { await page.click(`[data-nav="${id}"]`); await page.waitForTimeout(400); };
await page.goto('http://127.0.0.1:5191/');
await page.waitForSelector('#sidebar .nav-item');
await shot('00-dashboard-empty');
// seed
await nav('settings'); page.once('dialog', () => {});
await page.click('[data-act=seed]'); await page.click('.modal .btn:not(.ghost)'); await page.waitForTimeout(800);
// import vehicles + tickets
const fx = path.resolve('tests/fixtures/sample-v47.xlsx');
await nav('import');
const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('button:has-text("Import danh mục xe")')]);
await fc.setFiles(fx); await page.waitForSelector('.modal'); await shot('01-import-vehicles');
await page.click('.modal .btn:has-text("Ghi danh mục xe")'); await page.waitForTimeout(800);
await nav('import');
const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-act=pick]')]);
await fc2.setFiles(fx); await page.waitForSelector('[data-act=preview]'); await shot('02-import-mapping');
await page.click('[data-act=preview]'); await page.waitForSelector('[data-act=commit]'); await shot('03-import-preview');
await page.click('[data-act=commit]'); await page.click('.modal .btn:has-text("Import")'); await page.waitForSelector('text=Import hoàn tất', { timeout: 60000 }); await shot('04-import-done');
for (const [id, n] of [['dashboard', '05-dashboard'], ['tickets', '06-tickets'], ['statements', '07-statements'], ['rp:vehicle', '08-report-vehicle'], ['rp:carrier', '09-report-carrier'], ['prices', '10-prices'], ['fuel', '11-fuel'], ['cat:xe', '12-cat-xe'], ['cat:dia_diem', '13-cat-diadiem'], ['alerts', '14-alerts'], ['batches', '15-batches'], ['audit', '16-audit'], ['backup', '17-backup'], ['settings', '18-settings'], ['review', '19-review'], ['vehicle', '20-vehicle'], ['lock', '21-lock'], ['cat:hop_dong', '24-hop-dong']]) {
  await nav(id); await shot(n);
  const bad = await page.evaluate(() => {
    const out = []; const isNum = /^[−-]?\d{1,3}(\.\d{3})*(,\d+)?%?$/; const isDate = /^\d{2}\/\d{2}\/\d{4}( \d{2}:\d{2}(:\d{2})?)?$/;
    document.querySelectorAll('table.t td').forEach((td) => {
      const t = td.textContent.trim(); if (!t || td.querySelector('button,input,select')) return; const al = getComputedStyle(td).textAlign;
      if (/^\d{4}-\d{2}-\d{2}/.test(t) || /^[−-]?\d+\.\d{1,2}%?$/.test(t)) out.push('định dạng không VN: ' + t);
      else if (isDate.test(t) && al !== 'center') out.push('ngày không canh giữa: ' + t);
      else if (isNum.test(t) && t.length > 3 && !td.classList.contains('mono') && al !== 'right' && al !== 'end') out.push('số không canh phải: ' + t + ' (' + al + ')');
    });
    return [...new Set(out)].slice(0, 6);
  });
  if (bad.length) console.log('ALIGN', id, JSON.stringify(bad));
}
// bảng kê 1 đơn vị
await nav('statements'); await page.click('[data-fkey="sf:statements:don_vi_id"]'); await page.locator('[data-fpop] .fpop-row input').nth(0).check(); await page.click('[data-fpop] .btn.pri'); await page.waitForSelector('.stmt'); await shot('21-statement-one');

// ---- Việc cần làm theo quy trình + menu theo luồng công việc + skin luxe
await nav('dashboard'); await page.waitForSelector('[data-todo]');
{
  const ck = (ok, msg) => { if (!ok) errors.push('quy trình: ' + msg); };
  ck((await page.locator('[data-todo] .todo-row').count()) === 6, 'phải có 6 bước');
  const groups = await page.locator('#sidebar .nav-group').allTextContents();
  ck(groups.join('|').includes('① NHẬP & KIỂM TRA') && groups.join('|').includes('④ BẢNG KÊ & BÁO CÁO'), 'nhóm menu: ' + groups.join('|'));
  ck((await page.getAttribute('html', 'data-skin')) === 'luxe', 'skin luxe');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor); ck(bg === 'rgb(245, 242, 236)', 'nền ivory của luxe: ' + bg);
  const nums = await page.locator('[data-todo] .todo-c').allTextContents();
  ck(/2\.035 phiếu chưa chốt/.test(nums.join('|')) && /Xong/.test(nums.join('|')), 'đếm các bước: ' + nums.join('|'));
  await shot('33-dashboard-todo');
  await page.click('[data-todo] .btn:has-text("Chốt kỳ")'); await page.waitForTimeout(400);
  ck((await page.locator('#sidebar .nav-item.active[data-nav="lock"]').count()) === 1, 'nút "Chốt kỳ" phải mở màn Chốt kỳ');
  await nav('dashboard');
}

// ---- Bộ lọc thông minh (HAK Smart Filter): chọn nhiều, tìm không dấu, ngăn nâng cao, bộ lọc đã lưu, chip, dòng phạm vi
const check = (ok, msg) => { if (!ok) errors.push('filter: ' + msg); };
const sumNums = async () => { await page.waitForTimeout(500); const t = await page.textContent('[data-sf-summary]'); const m = t.match(/Hiển thị ([\d.]+) \/ ([\d.]+) dòng/); return m ? [Number(m[1].replace(/\./g, '')), Number(m[2].replace(/\./g, ''))] : null; };
await nav('tickets'); await page.waitForSelector('[data-sf=tickets]'); await page.click('[data-sf-reset]').catch(() => {});
const base = await sumNums(); check(base && base[0] === base[1] && base[1] > 1000, 'tổng ban đầu ' + JSON.stringify(base)); await shot('30-filter-default');
await page.click('[data-fkey="sf:tickets:don_vi_id"]'); await page.waitForSelector('[data-fpop]'); await shot('31-filter-multiselect');
const nOpt = await page.locator('[data-fpop] .fpop-row input').count(); check(nOpt >= 3, 'ít đơn vị để chọn: ' + nOpt);
await page.locator('[data-fpop] .fpop-row input').nth(0).check(); await page.locator('[data-fpop] .fpop-row input').nth(1).check(); await page.click('[data-fpop] .btn.pri');
const two = await sumNums(); check(two && two[0] < base[0] && two[0] > 0, 'chọn 2 đơn vị: ' + JSON.stringify(two));
check((await page.locator('[data-sf=tickets] .fchip').count()) === 1, 'phải có đúng 1 chip');
check(/Đơn vị vận chuyển: 2 mục/.test(await page.textContent('[data-sf=tickets] .fchips')), 'chip nêu "2 mục"');
check(/Phạm vi: Đơn vị vận chuyển: 2 mục/.test(await page.textContent('[data-sf-summary]')), 'dòng phạm vi');
await page.click('[data-sf=tickets] .fchip'); const back = await sumNums(); check(back[0] === base[0], 'bỏ chip → quay về tổng: ' + JSON.stringify(back));
await page.fill('[data-sf-q]', 'que son'); const q1 = await sumNums(); check(q1 && q1[0] > 0 && q1[0] <= base[0], 'tìm không dấu "que son": ' + JSON.stringify(q1));
await page.fill('[data-sf-q]', '92h 00903'); const q2 = await sumNums(); check(q2 && q2[0] > 0 && q2[0] < base[0], 'tìm biển số gõ khác kiểu: ' + JSON.stringify(q2));
await page.fill('[data-sf-q]', ''); await sumNums();
await page.fill('[data-sf-tu]', '15102026'); await page.fill('[data-sf-den]', '31/02/2026'); await page.dispatchEvent('[data-sf-den]', 'change');
check((await page.inputValue('[data-sf-tu]')) === '15/10/2026', 'ô ngày tự chèn dấu /: ' + (await page.inputValue('[data-sf-tu]')));
await page.click('[data-sf-reset]'); await sumNums();
await page.click('[data-sf-adv]'); await page.waitForSelector('[data-sf-drawer]'); await shot('32-filter-drawer');
await page.selectOption('[data-sf-field=trang_thai]', 'DA_TINH'); await page.click('.sfd-foot .btn.pri:has-text("Áp dụng")');
const priced = await sumNums(); check(priced && priced[0] === base[0], 'đã tính giá = tất cả (mẫu đã tính hết): ' + JSON.stringify(priced));
check(/Trạng thái tính giá: Đã tính giá/.test(await page.textContent('[data-sf=tickets] .fchips')), 'chip trạng thái tính giá');
// bộ lọc đã lưu theo màn hình
await page.click('[data-sf-adv]'); await page.waitForSelector('[data-sf-presets]'); await page.click('[data-sf-presets] button:has-text("Lưu bộ lọc hiện tại")');
await page.waitForSelector('.modal input'); await page.fill('.modal input', 'Chỉ đã tính giá'); await page.click('.modal .btn:not(.ghost)'); await page.waitForTimeout(300);
check((await page.locator('[data-sf-presets] option', { hasText: 'Chỉ đã tính giá' }).count()) === 1, 'bộ lọc đã lưu xuất hiện trong danh sách');
await page.click('.sfd-foot .btn:has-text("Hủy")'); await page.click('[data-sf-reset]'); await sumNums();
// bộ lọc đã lưu chỉ của màn hình này
await nav('statements'); await page.click('[data-sf-adv]'); await page.waitForSelector('[data-sf-presets]');
check((await page.locator('[data-sf-presets] option', { hasText: 'Chỉ đã tính giá' }).count()) === 0, 'bộ lọc đã lưu không lẫn sang màn khác');
await page.click('.sfd-foot .btn:has-text("Hủy")');
await nav('tickets'); await page.click('[data-sf-reset]'); await sumNums();
// xóa phiếu: chọn 2 dòng → hộp xóa (không bấm xóa)
await nav('tickets');
await page.click('table.t tbody tr:nth-child(1) input[type=checkbox]'); await page.click('table.t tbody tr:nth-child(2) input[type=checkbox]');
await page.click('[data-act=del-selected]'); await page.waitForSelector('.modal'); await shot('23-delete-tickets');
await page.click('.modal .btn.ghost');
// explain
await nav('tickets'); await page.click('table.t tbody tr >> nth=0'); await page.waitForSelector('.modal'); await shot('22-explain');

// ---- Đối chiếu: file đối tác dựng từ phiếu HAK + lỗi cài sẵn
const { writeXlsx } = require('./helpers/xlsx.js');
const hakId = (await (await fetch('http://127.0.0.1:5191/api/catalog.options', { method: 'POST', body: JSON.stringify({ table: 'don_vi_van_chuyen' }) })).json()).data.find((x) => x.label === 'HAK').id;
const tk = (await (await fetch('http://127.0.0.1:5191/api/tickets.list', { method: 'POST', body: JSON.stringify({ filter: { don_vi_id: hakId }, limit: 1000 }) })).json()).data.rows;
const aoa = [['STT', 'Số phiếu', 'Biển số', 'Ngày', 'KL (kg)', 'Đơn giá', 'Thành tiền']];
tk.forEach((x, i) => aoa.push([i + 1, x.so_phieu, x.bien_so, x.ngay_can, x.kl_hang_kg, x.don_gia, x.tien_truoc_vat]));
aoa[2][4] += 100; aoa[3][5] = 200000; aoa.splice(4, 1);
const partner = path.join(out, '..', '..', 'tests', 'fixtures', 'doitac-hak.xlsx'); await writeXlsx(partner, aoa, 'BangKe');
await page.click('.modal .btn:has-text("Đóng")');
await nav('reconcile'); await shot('23-recon-list');
await page.click('[data-act=new]'); await page.fill('[data-f=ten]', 'HAK – V.47');
await page.selectOption('[data-f=dv]', { label: 'HAK' });
const [fc3] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-act=pick]')]);
await fc3.setFiles(partner); await page.waitForSelector('[data-map=so_phieu]'); await shot('24-recon-mapping');
await page.click('[data-act=run]'); await page.waitForSelector('text=Kết quả: HAK'); await shot('25-recon-result');
const kq = await page.locator('.kpi small').allInnerTexts(); console.log('recon kpis', kq.join(' | '));
const info = await (await fetch('http://127.0.0.1:5191/api/app.info', { method: 'POST', body: '{}' })).json();
console.log('app.info', JSON.stringify(info.data.counts));
console.log('errors:', errors.length ? errors : 'none');
await browser.close(); srv.close();
process.exit(errors.length ? 1 : 0);
