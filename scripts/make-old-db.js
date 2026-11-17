'use strict';
/**
 * Tạo DB "bản cũ" ở schema N (mặc định 4) có dữ liệu mẫu — dùng nghiệm thu nâng cấp trên bộ cài (CI Windows) và thử migration:
 *   node scripts/make-old-db.js <file.db> [version]   → in JSON {version, phieu, audit}
 */
const fs = require('fs'); const os = require('os'); const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { migrate, listMigrations } = require('../src/database/migrator');

const file = process.argv[2]; const ver = Number(process.argv[3] || 4);
if (!file) { console.error('Cách dùng: node scripts/make-old-db.js <file.db> [version]'); process.exit(2); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oldmig-'));
for (const m of listMigrations().filter((x) => x.version <= ver)) fs.copyFileSync(m.file, path.join(dir, m.name));
fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
const db = new DatabaseSync(path.resolve(file));
db.exec('PRAGMA journal_mode = WAL'); db.exec('PRAGMA foreign_keys = ON'); db.exec('PRAGMA wal_autocheckpoint = 0');   // giao dịch còn nằm trong WAL
migrate(db, { dir });
const ins = db.prepare(`INSERT INTO phieu_can(so_phieu, ngay_gio_can_1, ngay_gio_can_2, bien_so_goc, bien_so, bien_so_chuan, can_lan_1, can_lan_2, kl_hang_kg, noi_xuat_goc, business_key, strong_key, fingerprint)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
for (let i = 1; i <= 3; i++) ins.run(`CU${i}`, `2026-10-0${i}T08:00:00`, `2026-10-0${i}T08:30:00`, '92H-00903', '92H-00903', '92H00903', 30000, 13000, 17000, 'Quế Sơn', `CU${i}|QUE SON`, `s${i}`, `f${i}`);
db.prepare(`INSERT INTO audit_log(action, entity) VALUES ('BAN_CU','phieu_can')`).run();
const out = { version: ver, phieu: db.prepare('SELECT COUNT(*) n FROM phieu_can').get().n, audit: db.prepare('SELECT COUNT(*) n FROM audit_log').get().n };
db.close();
console.log(JSON.stringify(out));
