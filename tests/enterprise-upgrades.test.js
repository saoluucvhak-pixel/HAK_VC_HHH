'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const { createHandlers } = require('../src/ipc/handlers');
const exporters = require('../src/excel/exporters');
const { BackupService } = require('../src/services/BackupService');

test('enterprise upgrades: quickSearch returns tickets, vehicles, dots', async () => {
  const app = createApp({ dbFile: ':memory:', driver: 'node:sqlite' });
  const handlers = createHandlers(app, {});

  const carrier = app.catalog.create('don_vi_van_chuyen', { ma: 'HAK', ten: 'Công ty HAK' });
  const qres = handlers['vehicles.quickAssign']({ bien_so: '92H-99999', don_vi_van_chuyen_id: carrier.id });
  assert.ok(qres.ok);
  const dot = app.catalog.create('dot_van_chuyen', { ma_dot: 'DOT_TEST_QS', ten_tau: 'TÀU HOÀNG ANH', trang_thai: 'MO' });

  // Tạo phiếu cân kèm business_key, strong_key, fingerprint
  app.db.run(`INSERT INTO phieu_can (so_phieu, bien_so, bien_so_chuan, business_key, strong_key, fingerprint, ngay_gio_can_1, kl_hang_kg, trang_thai, trang_thai_duyet)
              VALUES ('PHIEU_888', '92H-99999', '92H99999', 'PHIEU_888|KHO_A', 'sk1', 'fp1', '2026-10-10 08:00', 15000, 'ACTIVE', 'DA_DUYET')`);

  app.db.run("UPDATE phieu_can SET tong_tien=1500000000 WHERE so_phieu='PHIEU_888'");

  // Tìm kiếm theo số phiếu
  const resTicket = handlers['app.quickSearch']({ q: '888' });
  assert.equal(resTicket.tickets.length, 1);
  assert.equal(resTicket.tickets[0].so_phieu, 'PHIEU_888');
  assert.equal(resTicket.tickets[0].tong_tien, 1500000);

  // Tìm kiếm theo biển số
  const resXe = handlers['app.quickSearch']({ q: '92H99999' });
  assert.equal(resXe.vehicles.length, 1);
  assert.equal(resXe.vehicles[0].bien_so, '92H-99999');

  // Tìm kiếm theo tên tàu / đợt
  const resDot = handlers['app.quickSearch']({ q: 'HOÀNG ANH' });
  assert.equal(resDot.dots.length, 1);
  assert.equal(resDot.dots[0].ma_dot, 'DOT_TEST_QS');
});

test('enterprise upgrades: smart auditor detects speeding and overload anomalies', async () => {
  const app = createApp({ dbFile: ':memory:', driver: 'node:sqlite' });
  const handlers = createHandlers(app, {});

  // Tạo 2 chuyến xe liên tiếp chỉ cách nhau 10 phút (Short Gap)
  app.db.run(`INSERT INTO phieu_can (so_phieu, bien_so, bien_so_chuan, business_key, strong_key, fingerprint, ngay_gio_can_1, ngay_gio_can_2, kl_hang_kg, can_lan_1, can_lan_2, trang_thai, trang_thai_duyet)
              VALUES ('P1', '92H-001', '92H001', 'P1|KHO_A', 'sk_p1', 'fp_p1', '2026-10-01 08:00', '2026-10-01 08:15', 25000, 39000, 14000, 'ACTIVE', 'DA_DUYET')`);
  app.db.run(`INSERT INTO phieu_can (so_phieu, bien_so, bien_so_chuan, business_key, strong_key, fingerprint, ngay_gio_can_1, ngay_gio_can_2, kl_hang_kg, can_lan_1, can_lan_2, trang_thai, trang_thai_duyet)
              VALUES ('P2', '92H-001', '92H001', 'P2|KHO_A', 'sk_p2', 'fp_p2', '2026-10-01 08:25', '2026-10-01 08:40', 25000, 39000, 14000, 'ACTIVE', 'DA_DUYET')`);

  const audit = handlers['reports.audit']({});
  assert.equal(audit.totalChecked, 2);
  assert.ok(audit.anomalyCount >= 1);
  const p2Flag = audit.issues.find((i) => i.so_phieu === 'P2');
  assert.ok(p2Flag);
  assert.ok(p2Flag.flags.some((f) => f.code === 'SHORT_GAP'));
});

test('enterprise upgrades: secondary backup mirroring', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-sec-test-'));
  const app = createApp({ dbFile: path.join(dir, 'app.db'), driver: 'node:sqlite' });
  const tmpSecondary = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-sec-backup-'));

  const bk = new BackupService({ getDb: () => app.db, dbFile: path.join(dir, 'app.db'), backupsDir: path.join(dir, 'backups'), settings: app.settings, reopen: () => {} });

  app.settings.set('backup', { secondaryDir: tmpSecondary });
  const snap = bk.backupNow('MANUAL', 'Test backup with mirror');
  
  const files = fs.readdirSync(tmpSecondary);
  assert.equal(files.length, 1);
  assert.equal(files[0], path.basename(snap.file));

  assert.equal(snap.secondary.sha256, snap.sha256);
  assert.equal(bk.exportStatus().secondary.ok, true);
  app.settings.set('backup', { secondaryDir: path.join(tmpSecondary, 'missing') });
  const whenMissing = bk.backupNow();
  assert.ok(fs.existsSync(whenMissing.file));
  assert.equal(whenMissing.secondary.ok, false);
  assert.equal(bk.exportStatus().secondary.ok, false);

  // Đóng app trước khi xóa thư mục test trên Windows
  app.db.close();
  fs.rmSync(tmpSecondary, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('enterprise upgrades: paymentPackWorkbook generates full payment bundle', async () => {
  const doc = {
    st: {
      so_chuyen: 10,
      so_xe: 2,
      tong_tan: 300,
      tong_kg: 300000,
      tien_truoc_vat: 30000000,
      tien_vat: 2400000,
      tong_tien: 32400000,
      lines: [],
      vehicles: [],
      vatLines: [{ vat_percent: 8, thanh_tien: 30000000, tien_vat: 2400000 }],
      don_vi: { ma: 'HAK', ten: 'Công ty HAK' }
    },
    benA: { ten: 'Công ty Đại Hiệp', nguoi_lap: 'Kế toán A' },
    benB: { ma: 'HAK', ten: 'Công ty HAK', dai_dien: 'Nguyễn Văn B' },
    period: 'Kỳ tháng 10/2026',
    notice: 'THAM KHẢO · Phạm vi lọc có phiếu đã chốt.',
    bangChu: 'Ba mươi hai triệu bốn trăm nghìn đồng',
    tickets: []
  };

  const buf = await exporters.paymentPackWorkbook(doc);
  assert.ok(buf);
  const book = new (require('exceljs').Workbook)();
  await book.xlsx.load(buf);
  assert.equal(book.worksheets[0].name, 'Bìa hồ sơ quyết toán');
  assert.ok(book.worksheets[0].getColumn(1).values.includes(doc.notice));
});

