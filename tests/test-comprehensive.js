'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createRuntime } = require('../src/runtime');
const { IntegrityService } = require('../src/services/IntegrityService');

async function runComprehensiveTests() {
  console.log('=== BẮT ĐẦU KIỂM THỬ MỞ RỘNG (COMPREHENSIVE TEST SUITE) ===\n');
  const results = [];
  const log = (name, ok, msg = '') => {
    results.push({ name, ok, msg });
    console.log(`${ok ? '✅ [PASS]' : '❌ [FAIL]'} ${name}${msg ? ' - ' + msg : ''}`);
  };

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vccost-comprehensive-'));
  const seedDir = path.resolve(__dirname, '../data/seed');
  const rt = createRuntime({ dataDir: tempDir, seedDir, version: 'test-comprehensive', driver: 'node:sqlite' });

  try {
    // 1. Seed dữ liệu mẫu V.47 & Import danh mục xe
    console.log('\n--- 1. Kiểm tra Khởi tạo & Seed dữ liệu ---');
    const seedRes = await rt.dispatch('seed.loadSample', {});
    log('Seed dữ liệu mẫu ban đầu (seed.loadSample)', seedRes.ok);

    const samplePath = path.resolve(__dirname, '../tests/fixtures/sample-v47.xlsx');
    const vehPrev = await rt.dispatch('vehicles.importPreview', { filePath: samplePath });
    const vehCommit = await rt.dispatch('vehicles.importCommit', { token: vehPrev.data.token });
    log('Import danh mục xe từ file mẫu V.47', vehCommit.ok, `Ghi nhận ${vehCommit.data?.imported || 0} xe`);

    // 2. Import phiếu cân từ sample-v47.xlsx
    console.log('\n--- 2. Kiểm tra Import E2E ---');
    const openRes = await rt.dispatch('import.open', { filePath: samplePath });
    log('Mở và đọc file Excel sample-v47.xlsx (import.open)', openRes.ok, `Token: ${openRes.data?.token?.slice(0, 8)}...`);

    const prevRes = await rt.dispatch('import.preview', {
      token: openRes.data.token,
      sheetName: 'File tổng',
      headerRow: 3,
      mapping: {
        stt: 0, so_phieu: 1, ngay_gio_can_1: 2, ngay_gio_can_2: 3, bien_so: 4,
        can_lan_1: 5, can_lan_2: 6, kl_hang_kg: 7, noi_xuat: 8, cong_ty_vc_nguon: 10
      }
    });
    log('Preview & phân tích 2.035 dòng (import.preview)', prevRes.ok, `Tổng đọc: ${prevRes.data?.totals?.so_dong || 0} dòng`);

    const commitRes = await rt.dispatch('import.commit', { token: openRes.data.token });
    log('Commit giao dịch 2.035 phiếu vào CSDL (import.commit)', commitRes.ok, `Đã import: ${commitRes.data?.inserted || 0} phiếu`);

    // 3. Chạy IntegrityService kiểm tra toàn vẹn CSDL
    console.log('\n--- 3. Kiểm tra Toàn vẹn CSDL (Database Integrity Service) ---');
    const integrityRes = new IntegrityService(rt.app.db).check();
    log('Kiểm tra toàn vẹn dữ liệu (Integrity Check)', integrityRes.ok,
      `Kết luận: ${integrityRes.ok ? 'Không có lỗi' : integrityRes.loi + ' lỗi'}`);

    // 4. Kiểm tra Xuất báo cáo (Export Excel)
    console.log('\n--- 4. Kiểm tra Xuất báo cáo Excel (Export Services) ---');
    const expTickets = await rt.dispatch('export.tickets', { filter: {} });
    log('Xuất Excel danh sách Phiếu cân', expTickets.ok, expTickets.ok ? `File: ${expTickets.data?.fileName}` : expTickets.error);

    const expStatement = await rt.dispatch('export.statement', { filter: { don_vi_id: 1 } });
    log('Xuất Excel Bảng kê chi phí đơn vị 1', expStatement.ok, expStatement.ok ? `File: ${expStatement.data?.fileName}` : expStatement.error);

    const expSummary = await rt.dispatch('export.report', { kind: 'carrier', filter: {} });
    log('Xuất Excel Báo cáo đơn vị vận chuyển', expSummary.ok, expSummary.ok ? `File: ${expSummary.data?.fileName}` : expSummary.error);

    const expVehicle = await rt.dispatch('export.report', { kind: 'vehicle', filter: {} });
    log('Xuất Excel Báo cáo theo xe', expVehicle.ok, expVehicle.ok ? `File: ${expVehicle.data?.fileName}` : expVehicle.error);

    // 5. Kiểm tra Phân quyền & Bảo mật (Security & Access Control)
    console.log('\n--- 5. Kiểm tra Phân quyền & Bảo mật (Security & RBAC) ---');
    const enableAuth = await rt.dispatch('auth.enable', { ten_dang_nhap: 'admin', ho_ten: 'Quản trị viên', mat_khau: 'AdminPassword123@' });
    log('Bật hệ thống phân quyền (Auth Enable)', enableAuth.ok);

    // Thử gọi API khi chưa đăng nhập (phải bị từ chối)
    await rt.dispatch('auth.logout', {});
    const unauthCall = await rt.dispatch('tickets.remove', { ids: [1], reason: 'Chưa đăng nhập test' });
    log('Chặn người dùng chưa đăng nhập xóa phiếu', !unauthCall.ok && /đăng nhập/i.test(unauthCall.error || ''), unauthCall.error);

    // Đăng nhập tài khoản admin
    const loginRes = await rt.dispatch('auth.login', { ten_dang_nhap: 'admin', mat_khau: 'AdminPassword123@' });
    log('Đăng nhập Quản trị viên (Admin login)', loginRes.ok);

    // Tạo tài khoản Chỉ xem (XEM)
    const addViewer = await rt.dispatch('auth.createUser', {
      ten_dang_nhap: 'viewer01',
      mat_khau: 'ViewerPass123@',
      ho_ten: 'Nhân viên Xem',
      vai_tro: 'XEM'
    });
    log('Tạo người dùng vai trò Chỉ xem (XEM)', addViewer.ok);

    // Chuyển sang phiên của viewer
    await rt.dispatch('auth.logout', {});
    await rt.dispatch('auth.login', { ten_dang_nhap: 'viewer01', mat_khau: 'ViewerPass123@' });

    // Viewer thử xóa phiếu (phải bị từ chối do không đủ quyền)
    const viewerDel = await rt.dispatch('tickets.remove', { ids: [1], reason: 'Viewer xóa thử' });
    log('Chặn vai trò Chỉ xem thực hiện xóa phiếu (RBAC)', !viewerDel.ok && /quyền/i.test(viewerDel.error || ''), viewerDel.error);

    // Đăng nhập lại admin
    await rt.dispatch('auth.logout', {});
    await rt.dispatch('auth.login', { ten_dang_nhap: 'admin', mat_khau: 'AdminPassword123@' });

    // 6. Kiểm tra Chốt kỳ & Khóa số liệu (Lock Period Protection)
    console.log('\n--- 6. Kiểm tra Khóa kỳ / Chốt kỳ (Period Locking) ---');
    const lockPrev = await rt.dispatch('lock.preview', {
      loai: 'KY',
      tu_ngay: '2026-10-01',
      den_ngay: '2026-10-05'
    });
    log('Xem trước chốt kỳ (lock.preview)', lockPrev.ok, `Có ${lockPrev.data?.so_phieu || 0} phiếu, chốt được: ${lockPrev.data?.chot_duoc}`);

    const lockRes = await rt.dispatch('lock.create', {
      loai: 'KY',
      tu_ngay: '2026-10-01',
      den_ngay: '2026-10-05',
      ghi_chu: 'Khóa kỳ thử nghiệm'
    });
    log('Chốt kỳ số liệu từ 01/10/2026 đến 05/10/2026 (lock.create)', lockRes.ok, lockRes.ok ? `Kỳ ID: ${lockRes.data?.id}` : lockRes.error);

    // Thử sửa phiếu trong kỳ đã chốt (phải bị từ chối bởi bảo vệ kỳ chốt)
    const ticketInPeriod = rt.app.db.get(`SELECT id, can_lan_1, can_lan_2, kl_hang_kg FROM phieu_can WHERE ngay_gio_can_1 >= '2026-10-01' AND ngay_gio_can_1 <= '2026-10-05' AND trang_thai='ACTIVE' LIMIT 1`);
    if (ticketInPeriod) {
      const editLocked = await rt.dispatch('tickets.update', {
        id: ticketInPeriod.id,
        data: { can_lan_1: 30000, can_lan_2: 10000, kl_hang_kg: 20000 },
        note: 'Sửa thử phiếu đã chốt'
      });
      log('Chặn sửa phiếu nằm trong kỳ đã khóa', !editLocked.ok && /đã chốt|khóa/i.test(editLocked.error || ''), editLocked.error);
    }

    // 7. Kiểm tra Sao lưu & Khôi phục CSDL (Backup & Recovery)
    console.log('\n--- 7. Kiểm tra Sao lưu & Khôi phục (Backup & Recovery) ---');
    const backupRes = await rt.dispatch('backup.now', {});
    log('Tạo bản sao lưu CSDL thủ công (backup.now)', backupRes.ok, `File: ${path.basename(backupRes.data?.file || '')}`);

    const backupList = await rt.dispatch('backup.list', {});
    log('Liệt kê danh sách sao lưu (backup.list)', backupList.ok && backupList.data?.length > 0, `Có ${backupList.data?.length} bản sao`);

    // 8. Kiểm tra chống tấn công Injection & Ký tự đặc biệt (Sanitization / Injection safety)
    console.log('\n--- 8. Kiểm tra An toàn tham số & Injection ---');
    const sqliRes = await rt.dispatch('tickets.list', {
      filter: { q: "' OR '1'='1' --", tu_ngay: '2026-01-01', den_ngay: '2026-12-31' }
    });
    log('An toàn trước SQL Injection ở ô tìm kiếm', sqliRes.ok, `Không crash hệ thống`);

    const unicodeRes = await rt.dispatch('tickets.list', {
      filter: { q: 'Đà Nẵng & Quế Sơn — Xe 92H-009.03 <script>alert(1)</script>' }
    });
    log('An toàn với chuỗi Unicode tiếng Việt và XSS pattern', unicodeRes.ok, `Không lỗi hệ thống`);

    // 9. Kiểm tra Mở khóa & Hoàn tác Lô Import (Undo Batch)
    console.log('\n--- 9. Kiểm tra Hoàn tác Import (Undo Batch) ---');
    if (lockRes.data?.id) {
      const unlockRes = await rt.dispatch('lock.unlock', { id: lockRes.data.id, reason: 'Mở khóa để test hoàn tác' });
      log('Mở khóa kỳ số liệu thành công', unlockRes.ok);
    }
    const undoRes = await rt.dispatch('import.undo', { batchId: commitRes.data.batchId, reason: 'Test hoàn tác lô' });
    log('Hoàn tác lô import 2.035 phiếu (import.undo)', undoRes.ok, `Số phiếu bị hủy: ${undoRes.data?.voided || 0}`);

    const countAfter = rt.app.db.get(`SELECT COUNT(*) n FROM phieu_can WHERE trang_thai='ACTIVE'`).n;
    log('Số phiếu active sau hoàn tác về 0', countAfter === 0, `Còn lại: ${countAfter} phiếu`);

  } catch (err) {
    console.error('Lỗi ngoại lệ trong quá trình kiểm thử:', err);
    log('Kiểm thử không gặp ngoại lệ nghiêm trọng', false, err.message);
  } finally {
    rt.close();
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\n=== TỔNG KẾT KIỂM THỬ MỞ RỘNG ===');
  const passed = results.filter((r) => r.ok).length;
  console.log(`Tổng số ca kiểm thử: ${results.length}`);
  console.log(`Số ca đạt: ${passed}`);
  console.log(`Số ca thất bại: ${results.length - passed}`);
  console.log(`Tỷ lệ đạt: ${Math.round((passed / results.length) * 100)}%`);
}

runComprehensiveTests();
