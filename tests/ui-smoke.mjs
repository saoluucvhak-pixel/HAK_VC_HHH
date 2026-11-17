// Chạy: node tests/ui-smoke.mjs  — dev server + Playwright, chụp màn hình vào docs/screenshots
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const { start } = require('../tools/dev-server.js');
import fs from 'fs'; import path from 'path';
const out = path.resolve('docs/screenshots'); fs.mkdirSync(out, { recursive: true });
const srv = await start({ port: 5191 });
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
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
await fc2.setFiles(fx); await page.waitForSelector('[data-act=preview]');
{
  // kiểm tra NGAY khi ghép cột
  const ck = (ok, msg) => { if (!ok) errors.push('nhập liệu: ' + msg); };
  await page.waitForSelector('[data-check] table.t', { timeout: 15000 });
  const txt = async () => await page.textContent('[data-check]');
  let t = await txt();
  ck(/Đọc được 2\.035 dòng — không có dòng lỗi/.test(t), 'tóm tắt đọc file: ' + t.slice(0, 160));
  ck(/Đọc thử 8 dòng đầu/.test(t) && /✓ Quế Sơn/.test(t), 'đọc thử các dòng đầu + nhận ra nơi xuất');
  ck(await page.isEnabled('[data-act=preview]'), 'nút Xem trước phải bật khi đủ cột');
  await shot('02-import-mapping');
  // bỏ ghép cột Biển số → chặn ngay, nêu lý do
  await page.selectOption('[data-map=bien_so]', ''); await page.waitForFunction(() => /Chưa ghép cột "Biển số"/.test(document.querySelector('[data-check]').textContent), null, { timeout: 5000 }).catch(() => ck(false, 'không báo thiếu cột Biển số'));
  ck(!(await page.isEnabled('[data-act=preview]')), 'nút Xem trước phải tắt khi thiếu cột bắt buộc');
  ck(/^✗ Chưa ghép cột "Biển số"/.test(await page.textContent('[data-verdict]')), 'kết luận 1 dòng cạnh ô ghép cột: ' + await page.textContent('[data-verdict]'));
  await shot('02b-import-mapping-loi');
  // ghép lại cột như cũ
  const idx = await page.evaluate(() => [...document.querySelector('[data-map=bien_so]').options].find((o) => /biển số|bien so/i.test(o.textContent) )?.value);
  await page.selectOption('[data-map=bien_so]', idx); await page.waitForFunction(() => /không có dòng lỗi/.test(document.querySelector('[data-check]').textContent), null, { timeout: 5000 }).catch(() => ck(false, 'ghép lại cột không bỏ cảnh báo'));
  ck(await page.isEnabled('[data-act=preview]'), 'nút Xem trước bật lại');
}
await page.click('[data-act=preview]'); await page.waitForSelector('[data-act=commit]'); await shot('03-import-preview');
{ const t = await page.textContent('[data-kl-check]'); if (!/Khớp dòng "Tổng cộng"/.test(t) || !/38\.563\.700 kg/.test(t)) errors.push('đối chiếu KL preview: ' + t); }
await page.click('[data-act=commit]'); await page.click('.modal .btn:has-text("Import")'); await page.waitForSelector('text=Import hoàn tất', { timeout: 60000 }); await shot('04-import-done');
{
  const ck = (ok, msg) => { if (!ok) errors.push('nhập liệu: ' + msg); };
  const t = await page.textContent('[data-result]');
  ck(/Việc tiếp theo/.test(t) && /Đối chiếu/.test(t) && /Chốt kỳ/.test(t), 'khối "Việc tiếp theo": ' + t.slice(0, 200));
  ck((await page.locator('[data-result] [data-act=undo]').count()) === 1, 'nút hoàn tác lần import');
}
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

// ---- Định dạng số/ngày theo chuẩn kế toán HAK (vi-VN): dấu chấm nghìn, phẩy thập phân, không "-0", dd/mm/yyyy
{
  const got = await page.evaluate(() => { const f = App.fmt; return {
    money: [f.money(1234567.5), f.money(-0.3), f.money(0), f.money(-1234.4), f.money(null), f.money('')],
    money2: [f.money2(1234567.891), f.money2(-0.004), f.money2(0.285)],
    kg: [f.kg(20090), f.kg(-0.2)], tan: [f.tan(20.09), f.tan(-0.0004)], pct: [f.pct(8), f.pct(12.345)],
    date: [f.date('2026-10-05'), f.date('')], dt: [f.dt('2026-10-05T07:08:09'), f.dts('2026-10-05T07:08:09')], min: [f.min(125), f.min(-5)] }; });
  const want = { money: ['1.234.568', '0', '0', '-1.234', '', ''], money2: ['1.234.567,89', '0,00', '0,29'], kg: ['20.090', '0'], tan: ['20,090', '0,000'], pct: ['8%', '12,35%'],
    date: ['05/10/2026', ''], dt: ['05/10/2026 07:08', '05/10/2026 07:08:09'], min: ['2g 5p', '−5p'] };
  if (JSON.stringify(got) !== JSON.stringify(want)) errors.push('định dạng chuẩn: ' + JSON.stringify(got) + ' ≠ ' + JSON.stringify(want));
}
// ---- Chế độ tối: bật bằng nút ở thanh bên, nhớ lựa chọn sau khi tải lại, đúng màu nền luxe tối
{
  const ck = (ok, msg) => { if (!ok) errors.push('chế độ tối: ' + msg); };
  await nav('dashboard');
  const theme = () => page.getAttribute('html', 'data-theme');
  const toDark = async () => { for (let i = 0; i < 3 && (await page.evaluate(() => localStorage.getItem('vc.theme'))) !== 'dark'; i++) { await page.click('[data-act=theme]'); await page.waitForTimeout(150); } };
  await page.evaluate(() => localStorage.removeItem('vc.theme'));
  await toDark();
  ck((await theme()) === 'dark', 'data-theme phải là dark: ' + (await theme()));
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor); ck(bg === 'rgb(11, 16, 26)', 'nền tối luxe: ' + bg);
  const inputBg = await page.evaluate(() => { const i = document.querySelector('[data-sf-q]'); return i ? getComputedStyle(i).backgroundColor : null; }); ck(inputBg === 'rgb(14, 20, 32)', 'ô nhập theo token tối: ' + inputBg);
  const cardBg = await page.evaluate(() => getComputedStyle(document.querySelector('.card')).backgroundColor); ck(cardBg === 'rgb(18, 25, 38)', 'thẻ theo token tối: ' + cardBg);
  await shot('34-dashboard-dark'); await nav('tickets'); await shot('35-tickets-dark'); await nav('import'); await shot('36-import-dark');
  await page.reload(); await page.waitForSelector('#sidebar .nav-item');
  ck((await theme()) === 'dark', 'sau khi tải lại vẫn tối');
  for (let i = 0; i < 3 && (await theme()) !== 'light'; i++) { await page.click('[data-act=theme]'); await page.waitForTimeout(150); }
  ck((await theme()) === 'light', 'chuyển lại sáng');
  const bgL = await page.evaluate(() => getComputedStyle(document.body).backgroundColor); ck(bgL === 'rgb(245, 242, 236)', 'nền sáng ivory: ' + bgL);
  await page.evaluate(() => localStorage.removeItem('vc.theme')); await page.reload(); await page.waitForSelector('#sidebar .nav-item');
}

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
// ---- "Cần kiểm tra" ngay trong bước Kết quả của import: xử lý từng dòng / hàng loạt (giữ cũ, cập nhật có lý do)
{
  const ck = (ok, msg) => { if (!ok) errors.push('cần kiểm tra: ' + msg); };
  const api = async (c, a) => (await (await fetch('http://127.0.0.1:5191/api/' + c, { method: 'POST', body: JSON.stringify(a || {}) })).json()).data;
  const rows = (await api('tickets.list', { filter: {}, limit: 3 })).rows;
  const csv = ['Số phiếu,Biển số,Nơi xuất,Ngày giờ cân 1,KL hàng (kg)', ...rows.map((r) => `${r.so_phieu},${r.bien_so},${r.noi_xuat_goc || r.noi_xuat},${r.ngay_gio_can_1.slice(8, 10)}/${r.ngay_gio_can_1.slice(5, 7)}/${r.ngay_gio_can_1.slice(0, 4)} ${r.ngay_gio_can_1.slice(11, 19)},${r.kl_hang_kg + 100}`)].join('\n');
  const csvFile = path.join(out, 'xung-dot.csv'); fs.writeFileSync(csvFile, '\uFEFF' + csv);
  const runImport = async () => {
    await nav('import');
    const [fcx] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-act=pick]')]);
    await fcx.setFiles(csvFile); await page.waitForSelector('[data-act=preview]');
    await page.waitForFunction(() => !document.querySelector('[data-act=preview]').disabled, null, { timeout: 8000 });
    await page.click('[data-act=preview]'); await page.waitForSelector('[data-act=commit]');
    await page.click('[data-act=commit]'); await page.click('.modal .btn:has-text("Import")'); await page.waitForSelector('[data-result]', { timeout: 30000 });
  };
  await runImport();
  await page.waitForSelector('[data-review]'); await shot('37-import-can-kiem-tra');
  ck(/3 phiếu cần kiểm tra/.test(await page.textContent('[data-review]')), 'danh sách phải có 3 phiếu: ' + (await page.textContent('[data-review]')).slice(0, 120));
  await page.click('[data-act=bulk-keep]'); await page.click('.modal .btn:not(.ghost)'); await page.waitForTimeout(1500);
  ck((await page.locator('[data-review]').count()) === 0, 'giữ cũ tất cả → danh sách biến mất');
  ck((await api('tickets.list', { filter: { search: rows[0].so_phieu } })).rows.every((r) => r.kl_hang_kg === rows[0].kl_hang_kg || r.so_phieu !== rows[0].so_phieu), 'giữ cũ: KL không đổi');
  await runImport(); await page.waitForSelector('[data-review]');
  await page.click('[data-act=bulk-update]'); await page.waitForSelector('.modal input'); await page.fill('.modal input', 'Đối chiếu lại với phiếu cân gốc'); await page.click('.modal .btn:has-text("Đồng ý")');
  await page.waitForSelector('.modal .btn:not(.ghost)'); await page.click('.modal .btn:not(.ghost)'); await page.waitForTimeout(2000);
  ck((await page.locator('[data-review]').count()) === 0, 'cập nhật tất cả → danh sách biến mất');
  const after = (await api('tickets.list', { filter: { search: rows[0].so_phieu } })).rows.find((r) => r.so_phieu === rows[0].so_phieu);
  ck(after && after.kl_hang_kg === rows[0].kl_hang_kg + 100, 'cập nhật tất cả: KL phải đổi sang ' + (rows[0].kl_hang_kg + 100) + ', thực tế ' + (after && after.kl_hang_kg));
}

// ---- Cửa sổ nhỏ (820×600): các màn chính không làm trang cuộn ngang; focus bàn phím nhìn thấy được; chế độ Tối vẫn đạt
{
  await page.setViewportSize({ width: 820, height: 600 });
  for (const id of ['dashboard', 'import', 'review', 'tickets', 'lock', 'backup', 'statements']) {
    await page.evaluate((v) => App.go(v), id); await page.waitForTimeout(500);
    const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    if (w.sw > w.iw + 2) errors.push(`cửa sổ nhỏ: màn ${id} cuộn ngang (${w.sw} > ${w.iw})`);
  }
  await page.evaluate(() => App.go('backup')); await page.waitForTimeout(400);
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const c = getComputedStyle(e); return { tag: e.tagName, outline: c.outlineStyle, ow: c.outlineWidth, shadow: c.boxShadow }; });
  if (!focus || (focus.outline === 'none' && (!focus.shadow || focus.shadow === 'none'))) errors.push('focus bàn phím không nhìn thấy: ' + JSON.stringify(focus));
  await page.setViewportSize({ width: 1440, height: 900 });
}

// ---- Phản hồi về chậm không được ghi đè màn đang mở; "Việc cần làm" nêu phạm vi và khớp màn đích
{
  const ck = (ok, msg) => { if (!ok) errors.push('nhất quán màn hình: ' + msg); };
  await page.route('**/api/reports.dashboard', async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
  await page.evaluate(() => { App.go('dashboard'); App.go('batches'); });     // mở Dashboard (chậm) rồi chuyển ngay sang Lịch sử import
  await page.waitForTimeout(2600);
  const h1s = await page.$$eval('#view h1', (els) => els.map((e) => e.textContent));
  ck(h1s.length === 1 && /import/i.test(h1s[0]), 'phản hồi chậm của Dashboard đã ghi đè màn Lịch sử import: ' + JSON.stringify(h1s));
  await page.unroute('**/api/reports.dashboard');
  // Bộ lọc đang bật không được làm lệch số "Việc cần làm" so với danh sách đích
  await page.evaluate(() => App.go('dashboard')); await page.waitForSelector('[data-todo]');
  const scopeTxt = await page.textContent('[data-todo]');
  ck(/toàn hệ thống/i.test(scopeTxt), 'khối Việc cần làm không nêu phạm vi toàn hệ thống: ' + scopeTxt.slice(0, 120));
  // bật bộ lọc đơn vị rồi bấm "Xem phiếu" của bước chưa tính giá: danh sách đích phải khớp số đếm toàn hệ thống (không còn bộ lọc ngầm)
  const todoN = await page.evaluate(async () => (await App.api('workflow.todo')).chua_tinh_gia);
  await page.evaluate(() => { App.state.filter.don_vi_id = [1]; });
  await page.evaluate(() => App.go('dashboard')); await page.waitForSelector('[data-todo]');
  if (todoN > 0) {
    await page.click('[data-todo] .todo-row.open button:has-text("Xem phiếu")'); await page.waitForTimeout(700);
    const shown = await page.evaluate(async () => (await App.api('tickets.count', { filter: App.cleanFilter(App.state.filter) })).kept);
    ck(shown === todoN, `danh sách đích (${shown}) ≠ số đếm Việc cần làm (${todoN}) khi đang có bộ lọc`);
  }
  await page.evaluate(() => { Object.keys(App.state.filter).forEach((k) => delete App.state.filter[k]); });
}

// ---- Ngưỡng KL cấu hình được + tùy chọn đọc nhiều khối
{
  const ck = (ok, msg) => { if (!ok) errors.push('tùy chọn nhập liệu: ' + msg); };
  await page.evaluate(() => App.go('settings')); await page.waitForSelector('[data-act=save-kl]');
  await page.fill('[data-f=kl-min]', '50'); await page.click('[data-act=save-kl]'); await page.waitForTimeout(600);
  const set1 = await page.evaluate(async () => (await App.api('settings.all')).kl_hop_ly);
  ck(set1 && set1.min_kg === 50 && set1.max_kg === 100000, 'lưu ngưỡng KL: ' + JSON.stringify(set1));
  await page.fill('[data-f=kl-min]', '100'); await page.click('[data-act=save-kl]'); await page.waitForTimeout(600);   // trả về mặc định
  await page.evaluate(() => App.go('import'));
  const [fcm] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-act=pick]')]); await fcm.setFiles(path.resolve('tests/fixtures/sample-v47.xlsx'));
  await page.waitForSelector('[data-f=multi-block]');
  ck((await page.locator('[data-f=multi-block]').isChecked()) === false, 'tùy chọn nhiều khối phải mặc định tắt');
  await page.evaluate(() => App.go('dashboard'));
}

// ---- Kiểm tra toàn vẹn dữ liệu (chỉ đọc) từ màn Backup
{
  await page.evaluate(() => App.go('backup')); await page.waitForSelector('[data-act=integrity]');
  await page.click('[data-act=integrity]'); await page.waitForSelector('.modal h2');
  const title = await page.textContent('.modal h2');
  if (!/toàn vẹn|nhóm lỗi/.test(title)) errors.push('toàn vẹn: tiêu đề hộp thoại lạ: ' + title);
  await page.click('.modal .btn');
}

// ---- Phân quyền tùy chọn: bật → đăng xuất → màn đăng nhập → đăng nhập → ẩn mục theo quyền → tắt
{
  const ck = (ok, msg) => { if (!ok) errors.push('phân quyền: ' + msg); };
  await page.evaluate(() => App.go('users')); await page.waitForSelector('[data-act=enable-auth]');
  ck((await page.textContent('.card')).includes('Đang dùng 1 người'), 'mặc định không áp dụng phân quyền');
  const inputs = page.locator('.card input');
  await inputs.nth(0).fill('admin'); await inputs.nth(1).fill('Quản trị viên'); await inputs.nth(2).fill('matkhau-manh-1');
  await page.click('[data-act=enable-auth]'); await page.click('.modal .btn:has-text("Bật")');
  await page.waitForSelector('[data-user=admin]'); await shot('40-phan-quyen-bat');
  ck((await page.locator('[data-act=add-user]').count()) === 1, 'quản trị thấy nút thêm người dùng');
  await page.click('[data-act=logout]'); await page.waitForSelector('[data-login]');
  ck((await page.locator('#view *').count()) === 0, 'đăng xuất: nội dung bị xóa');
  await page.fill('[data-login] input[name=ten]', 'admin'); await page.fill('[data-login] input[name=mk]', 'sai-mat-khau');
  await page.click('[data-act=login]'); await page.waitForSelector('[data-login] .tag.red');
  await page.fill('[data-login] input[name=mk]', 'matkhau-manh-1'); await page.click('[data-act=login]');
  await page.waitForSelector('[data-user=admin]'); await page.waitForFunction(() => !document.querySelector('[data-login]'));
  await page.evaluate(() => App.go('users')); await page.waitForSelector('[data-act=disable-auth]');
  await page.click('[data-act=disable-auth]'); await page.fill('.modal input', 'matkhau-manh-1'); await page.click('.modal .btn.danger');
  await page.waitForSelector('[data-act=enable-auth]');
  ck((await page.locator('[data-user]').count()) === 0, 'tắt phân quyền: không còn ô người dùng');
}

console.log('errors:', errors.length ? errors : 'none');
await browser.close(); srv.close();
process.exit(errors.length ? 1 : 0);
