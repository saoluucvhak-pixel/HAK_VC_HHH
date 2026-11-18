'use strict';
/**
 * Kiểm tra toàn vẹn dữ liệu (CHỈ ĐỌC — không tự sửa/xóa/gộp gì): phát hiện phiếu trùng danh tính, liên kết mồ côi, lệch bộ đếm, lệch tiền.
 * Mỗi mục: {id, title, severity: 'LOI' | 'CANH_BAO', count, sample[]}. Dùng cho màn Backup/Hệ thống và script `npm run integrity`.
 */
class IntegrityService {
  constructor(db) { this.db = db; }

  check({ sampleSize = 20 } = {}) {
    const db = this.db; const checks = [];
    const lim = (() => { const r = db.get(`SELECT value_json FROM settings WHERE key='kl_hop_ly'`); try { const v = r && JSON.parse(r.value_json); return { lo: v && v.min_kg >= 0 ? v.min_kg : 100, hi: v && v.max_kg > 0 ? v.max_kg : 100000 }; } catch (e) { return { lo: 100, hi: 100000 }; } })();
    const add = (id, title, severity, rows, hint) => checks.push({ id, title, severity, count: rows.length, sample: rows.slice(0, sampleSize), hint: hint || null });

    // 0) khóa ngoại
    let fk = []; try { fk = db.all('PRAGMA foreign_key_check'); } catch { /* bỏ qua */ }
    add('FK', 'Vi phạm khóa ngoại', 'LOI', fk.map((r) => ({ bang: r.table, rowid: r.rowid, tham_chieu: r.parent })));

    // 1) phiếu ACTIVE trùng danh tính: cùng số phiếu + cùng nơi xuất (mã) nhưng khác khóa văn bản (vd "QS" / "Quế Sơn" nhập ở bản cũ)
    add('PHIEU_TRUNG_NOI_XUAT', 'Phiếu đang hoạt động trùng số phiếu + nơi xuất (khác cách viết tên nơi xuất)', 'LOI',
      db.all(`SELECT so_phieu, noi_xuat_id, COUNT(*) so_ban, group_concat(id) ids, SUM(tong_tien) tong_tien_raw FROM phieu_can
              WHERE trang_thai='ACTIVE' AND noi_xuat_id IS NOT NULL GROUP BY so_phieu, noi_xuat_id HAVING COUNT(*) > 1 ORDER BY so_phieu`),
      'Xem từng cặp, xóa mềm (Phiếu cân → Xóa) bản nhập sau nếu đúng là cùng một phiếu cân; hệ thống không tự xóa.');
    add('PHIEU_TRUNG_CHUYEN', 'Phiếu đang hoạt động trùng biển số + giờ cân 1 (khác số phiếu)', 'CANH_BAO',
      db.all(`SELECT bien_so_chuan, ngay_gio_can_1, COUNT(*) so_ban, group_concat(id) ids, group_concat(so_phieu) so_phieu FROM phieu_can
              WHERE trang_thai='ACTIVE' GROUP BY bien_so_chuan, ngay_gio_can_1 HAVING COUNT(*) > 1 ORDER BY ngay_gio_can_1`));

    add('SO_PHIEU_KHAC_SO_0_DAU', 'Số phiếu chỉ khác số 0 đầu (vd 0123 / 123) cùng nơi xuất — nghi cùng một phiếu', 'CANH_BAO',
      db.all(`SELECT noi_xuat_id, ltrim(so_phieu,'0') so_khong_0, COUNT(DISTINCT so_phieu) so_cach_viet, group_concat(DISTINCT so_phieu) cac_so_phieu, group_concat(id) ids FROM phieu_can
              WHERE trang_thai='ACTIVE' AND noi_xuat_id IS NOT NULL AND ltrim(so_phieu,'0') <> '' GROUP BY noi_xuat_id, ltrim(so_phieu,'0') HAVING COUNT(DISTINCT so_phieu) > 1`),
      'Số phiếu có số 0 đầu được giữ nguyên khi nhập; nếu hai cách viết là một phiếu cân thật thì xóa mềm bản thừa.');
    add('KL_BAT_THUONG', `Phiếu có KL ngoài khoảng hợp lý (dưới ${lim.lo} kg hoặc trên ${lim.hi} kg/chuyến) — nghi sai đơn vị tấn/kg`, 'LOI',
      db.all(`SELECT id, so_phieu, kl_hang_kg FROM phieu_can WHERE trang_thai='ACTIVE' AND (kl_hang_kg < ? OR kl_hang_kg > ?)`, [lim.lo, lim.hi]),
      'Sửa KL của phiếu (kèm lý do) hoặc xóa mềm và nhập lại từ file đã sửa đơn vị.');

    const bat = (() => { const r = db.get(`SELECT value_json FROM settings WHERE key='duyet_phieu'`); try { return !!(r && JSON.parse(r.value_json).bat); } catch (e) { return false; } })();
    add('NHAP_KHI_TAT_DUYET', 'Phiếu Nháp chưa duyệt trong khi duyệt phiếu đang TẮT (không vào mọi số liệu)', 'LOI',
      bat ? [] : db.all(`SELECT id, so_phieu, ngay_gio_can_1, nhap_boi FROM phieu_can WHERE trang_thai='ACTIVE' AND trang_thai_duyet='NHAP'`),
      'Bật lại duyệt phiếu để duyệt các phiếu này, hoặc xóa mềm nếu nhập nhầm.');

    // 2) chốt kỳ
    add('CHOT_MO_COI', 'Phiếu mang chot_ky_id không tồn tại', 'LOI', db.all(`SELECT p.id, p.so_phieu, p.chot_ky_id FROM phieu_can p LEFT JOIN chot_ky k ON k.id=p.chot_ky_id WHERE p.chot_ky_id IS NOT NULL AND k.id IS NULL`));
    add('CHOT_DA_MO_KHOA', 'Phiếu còn gắn với kỳ đã mở khóa', 'LOI', db.all(`SELECT p.id, p.so_phieu, p.chot_ky_id FROM phieu_can p JOIN chot_ky k ON k.id=p.chot_ky_id WHERE k.trang_thai<>'DA_CHOT'`));
    add('CHOT_THIEU_SNAPSHOT', 'Phiếu thuộc kỳ đã chốt nhưng không có snapshot của kỳ đó', 'LOI',
      db.all(`SELECT p.id, p.so_phieu, p.chot_ky_id FROM phieu_can p JOIN chot_ky k ON k.id=p.chot_ky_id AND k.trang_thai='DA_CHOT'
              LEFT JOIN chot_ky_snapshot s ON s.chot_ky_id=p.chot_ky_id AND s.phieu_can_id=p.id WHERE s.id IS NULL`));
    add('CHOT_LECH_SO_LIEU', 'Kỳ đã chốt: tổng snapshot khác số đã ghi trên kỳ (số phiếu/kg)', 'LOI',
      db.all(`SELECT k.id, k.ma, k.so_phieu, COUNT(s.id) so_snapshot, k.tong_kg, SUM(s.kl_hang_kg) kg_snapshot FROM chot_ky k LEFT JOIN chot_ky_snapshot s ON s.chot_ky_id=k.id
              WHERE k.trang_thai='DA_CHOT' GROUP BY k.id HAVING COUNT(s.id)<>k.so_phieu OR COALESCE(SUM(s.kl_hang_kg),0)<>k.tong_kg`));

    // 3) nhập liệu
    add('BATCH_LECH_DEM', 'Lô import: số phiếu đã ghi khác bộ đếm của lô', 'CANH_BAO',
      db.all(`SELECT b.id, b.file_name, b.inserted_rows, (SELECT COUNT(*) FROM import_batch_row r WHERE r.batch_id=b.id AND r.hanh_dong='INSERT') thuc_te FROM import_batch b
              WHERE b.inserted_rows <> (SELECT COUNT(*) FROM import_batch_row r WHERE r.batch_id=b.id AND r.hanh_dong='INSERT')`));
    add('HANG_CHO_LO_HUY', 'Dòng "Cần kiểm tra" thuộc lô đã hoàn tác', 'CANH_BAO',
      db.all(`SELECT r.id, r.batch_id, r.phieu_can_id FROM import_batch_row r JOIN import_batch b ON b.id=r.batch_id WHERE r.hanh_dong='PENDING_REVIEW' AND b.trang_thai<>'COMMITTED'`));
    add('CANH_BAO_MO_COI', 'Cảnh báo trỏ tới phiếu không tồn tại', 'CANH_BAO',
      db.all(`SELECT c.id, c.loai, c.entity_id FROM canh_bao c LEFT JOIN phieu_can p ON p.id=c.entity_id WHERE c.entity='phieu_can' AND p.id IS NULL`));

    // 4) tiền
    add('TIEN_LECH', 'Phiếu đã tính giá: tiền trước VAT + VAT khác tổng quá 1 đơn vị lưu', 'LOI',
      db.all(`SELECT id, so_phieu, tien_truoc_vat, tien_vat, tong_tien FROM phieu_can WHERE trang_thai='ACTIVE' AND trang_thai_tinh_gia IN ('OK','LOCKED') AND ABS(tien_truoc_vat+tien_vat-tong_tien)>1`));
    add('KL_LECH_CAN', 'Phiếu có đủ hai số cân nhưng KL hàng khác |Cân 1 − Cân 2|', 'CANH_BAO',
      db.all(`SELECT id, so_phieu, can_lan_1, can_lan_2, kl_hang_kg FROM phieu_can WHERE trang_thai='ACTIVE' AND can_lan_1 IS NOT NULL AND can_lan_2 IS NOT NULL
              AND ABS(ABS(can_lan_1-can_lan_2)-kl_hang_kg)>0.5`));

    const loi = checks.filter((c) => c.severity === 'LOI' && c.count).length, canhBao = checks.filter((c) => c.severity === 'CANH_BAO' && c.count).length;
    return { ok: loi === 0, loi, canh_bao: canhBao, tong_muc: checks.length, checks };
  }
}

module.exports = { IntegrityService };
