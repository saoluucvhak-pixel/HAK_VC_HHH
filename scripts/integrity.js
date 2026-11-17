'use strict';
/** Kiểm tra toàn vẹn một file DB (chỉ đọc, mở ở chế độ readonly):  node scripts/integrity.js <đường-dẫn app.db hoặc bản sao lưu> */
const path = require('path');
const { openFile, inspect, driverOf } = require('../src/database/snapshot');
const { IntegrityService } = require('../src/services/IntegrityService');

const args = process.argv.slice(2);
const csvAt = args.indexOf('--csv');
const csvOut = csvAt >= 0 ? args[csvAt + 1] : null;
const file = args.find((a, i) => !a.startsWith('--') && (csvAt < 0 || i !== csvAt + 1));
if (!file) { console.error('Cách dùng: node scripts/integrity.js <file.db> [--csv ket-qua.csv]'); process.exit(2); }
const driver = process.env.VCCOST_DRIVER || 'node:sqlite';
const chk = inspect(path.resolve(file), driver);
if (!chk.ok) { console.error('Không kiểm tra được:', chk.reason); process.exit(2); }
const raw = openFile(path.resolve(file), driver);
const db = { all: (sql, p = []) => raw.prepare(sql).all(...p).map((r) => ({ ...r })), get: (sql, p = []) => { const r = raw.prepare(sql).get(...p); return r ? { ...r } : undefined; } };
const r = new IntegrityService(db).check();
console.log(`Schema v${chk.version} — ${chk.counts.phieu} phiếu, ${chk.counts.batch} lô import, ${chk.counts.chot} kỳ chốt`);
for (const c of r.checks) console.log(`${c.count ? (c.severity === 'LOI' ? '✗' : '!') : '✓'} ${c.title}: ${c.count}`);
for (const c of r.checks.filter((x) => x.count)) { console.log(`\n[${c.id}] ${c.title}${c.hint ? `\n  → ${c.hint}` : ''}`); for (const s of c.sample) console.log('  ', JSON.stringify(s)); }
raw.close();
if (csvOut) {   // danh sách bản ghi nghi vấn (ID + lý do) để chủ dữ liệu quyết định — chỉ liệt kê, không sửa
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['\uFEFFmuc_kiem_tra,muc_do,ly_do,chi_tiet'];
  for (const c of r.checks) for (const x of c.sample) lines.push([c.id, c.severity === 'LOI' ? 'Lỗi' : 'Cảnh báo', c.title, JSON.stringify(x)].map(q).join(','));
  require('fs').writeFileSync(path.resolve(csvOut), lines.join('\r\n') + '\r\n', 'utf8');
  console.log(`Đã ghi ${lines.length - 1} dòng nghi vấn vào ${csvOut} (mỗi mục tối đa 20 dòng đầu; chạy không --csv để xem số lượng đầy đủ)`);
}
console.log(`\nKết luận: ${r.ok ? 'KHÔNG có lỗi toàn vẹn' : `${r.loi} nhóm lỗi cần xử lý`}${r.canh_bao ? `, ${r.canh_bao} cảnh báo` : ''}.`);
process.exit(r.ok ? 0 : 1);
