'use strict';
/** Kiểm tra toàn vẹn một file DB (chỉ đọc, mở ở chế độ readonly):  node scripts/integrity.js <đường-dẫn app.db hoặc bản sao lưu> */
const path = require('path');
const { openFile, inspect, driverOf } = require('../src/database/snapshot');
const { IntegrityService } = require('../src/services/IntegrityService');

const file = process.argv[2];
if (!file) { console.error('Cách dùng: node scripts/integrity.js <file.db>'); process.exit(2); }
const driver = process.env.VCCOST_DRIVER || 'node:sqlite';
const chk = inspect(path.resolve(file), driver);
if (!chk.ok) { console.error('Không kiểm tra được:', chk.reason); process.exit(2); }
const raw = openFile(path.resolve(file), driver);
const db = { all: (sql, p = []) => raw.prepare(sql).all(...p).map((r) => ({ ...r })) };
const r = new IntegrityService(db).check();
console.log(`Schema v${chk.version} — ${chk.counts.phieu} phiếu, ${chk.counts.batch} lô import, ${chk.counts.chot} kỳ chốt`);
for (const c of r.checks) console.log(`${c.count ? (c.severity === 'LOI' ? '✗' : '!') : '✓'} ${c.title}: ${c.count}`);
for (const c of r.checks.filter((x) => x.count)) { console.log(`\n[${c.id}] ${c.title}${c.hint ? `\n  → ${c.hint}` : ''}`); for (const s of c.sample) console.log('  ', JSON.stringify(s)); }
raw.close();
console.log(`\nKết luận: ${r.ok ? 'KHÔNG có lỗi toàn vẹn' : `${r.loi} nhóm lỗi cần xử lý`}${r.canh_bao ? `, ${r.canh_bao} cảnh báo` : ''}.`);
process.exit(r.ok ? 0 : 1);
