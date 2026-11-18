# TEST PLAN

Chạy: `npm test` (node:test). Kiểm chứng Excel: `npm run validate -- "<file.xlsx>"`.

## 0. Bộ kiểm thử hiện hành (v0.8.0 — kiểm thử schema 7, chạy cả node:sqlite và better-sqlite3)
| Nhóm | File |
|---|---|
| Engine tính cước, làm tròn, giá dầu, xe theo ngày | engine.test.js, integration.test.js |
| Nhập liệu, kiểm tra ghép cột, dòng cần xử lý, KL = \|Cân 1 − Cân 2\| | entry-validation.test.js, import-weight.test.js, workbook-reader.test.js |
| Toàn vẹn số liệu: hoàn tác không ghi đè, chống trùng alias lúc commit, khóa kỳ/đợt, hàng loạt có kết quả từng phiếu | integrity-fixes.test.js |
| Đối chiếu chéo V.47 (Dashboard/Bảng kê/báo cáo/Excel/in/snapshot), xóa hàng loạt nhiều trang | consistency.test.js |
| Định dạng số chuẩn HAK, MANIFEST thư viện nhúng | number-format.test.js, vendor.test.js |
| Sao lưu PRE_MIGRATION (WAL), khôi phục an toàn/quay lui, xuất bản sao | storage-safety.test.js |
| Phân quyền tùy chọn, ma trận quyền, bảng quyền đủ kênh | auth.test.js |
| Kiểm tra toàn vẹn dữ liệu (chỉ đọc) | integrity.test.js |
| Migration, cài đặt, an toàn, đối chiếu, thư mục dữ liệu | migration.test.js, settings.test.js, hardening.test.js, reconciliation.test.js, storage.test.js |
| Giao diện thật (Chromium): bộ lọc, nhập, xung đột hàng loạt, Sáng/Tối, cửa sổ nhỏ, phân quyền, toàn vẹn | `npm run test:ui` (tests/ui-smoke.mjs) |
| Bộ cài Windows (CI): cài mới, thư mục dữ liệu mặc định/tùy chỉnh, nâng từ v4, Portable, SHA-256 | `scripts/accept-windows.ps1` qua workflow Windows (installers) |

## 1. Ban đầu (24 test)
| Nhóm (MASTER_PROMPT XXXV) | Test | File |
|---|---|---|
| kg → tấn, tính tiền, VAT (không hard-code 8%) | `kg → tấn, thành tiền, VAT lấy từ bảng giá` | engine.test.js |
| đơn giá theo chuyến | `đơn giá theo chuyến` | engine.test.js |
| bảng giá theo ngày, giá đổi giữa kỳ | `bảng giá theo ngày & giá thay đổi giữa kỳ` | engine.test.js |
| nhiều bảng giá cùng hiệu lực / không có giá | `NO_PRICE … MULTIPLE_PRICE` | engine.test.js |
| ưu tiên giá riêng đơn vị; giá ngừng | 2 test | engine.test.js |
| giá dầu thay đổi (tăng/giảm), khớp Excel | 2 test | engine.test.js |
| làm tròn kiểu Excel; GROUP vs TICKET | 2 test | engine.test.js |
| xe chưa xác định; xe đổi đơn vị theo thời gian | 2 test | engine.test.js |
| KL/nơi xuất không hợp lệ | 1 test | engine.test.js |
| chốt kỳ (engine trả snapshot) | `phiếu đã chốt…` | engine.test.js |
| duplicate phiếu; import cùng file 2 lần; trùng trong file | 2 test | engine.test.js |
| timeline xe & cảnh báo thời gian | 1 test | engine.test.js |
| chuẩn hóa biển số; đọc ngày giờ; dò header | 3 test | engine.test.js |
| migration chạy/idempotent/rollback; khóa trùng DB; trigger chốt & mở khóa | 4 test | migration.test.js |

## 2. Kiểm chứng với Excel mẫu (Phase 12) — ✅ đã chạy
`docs/EXCEL_VS_APP_VALIDATION.md`: giá dầu 9/9 chỉ tiêu, 3 sheet tổng hợp × 6 chỉ tiêu, từng xe 109/109, tổng HHH/HAK/nơi xuất 10/10 → **khớp 100%**.

## 3. Sẽ bổ sung theo phase
| Phase | Test |
|---|---|
| 4 Import | .xls và .csv; ngày + giờ 2 cột; header dòng bất kỳ; file 200k dòng < 30s; rollback khi lỗi giữa chừng; hoàn tác batch; batch có phiếu đã chốt không hoàn tác được |
| 5 Phiếu cân | sửa phiếu ghi audit; chuyển đợt; KEY_CONFLICT → Giữ/Cập nhật/Bỏ qua |
| 6 Giá | kỳ điều chỉnh sinh bảng giá đúng hiệu lực; đóng den_ngay bảng cũ; cảnh báo chồng lấn; giá đã chốt không đổi |
| 7 Engine + DB | tính lại hàng loạt chỉ phiếu chưa chốt; gán xe chưa xác định → tính lại |
| 9 Đối chiếu | khớp theo số phiếu; theo biển số+ngày+KL; lệch KL; lệch giá; lệch tiền; lệch VAT; thiếu A; thiếu B; trùng; nhiều cột lệch cùng lúc |
| 11 | chốt kỳ snapshot; mở khóa (lý do, audit), chốt lại; backup/restore; retention |
| 13–14 | smoke test bản Portable & Setup trên Windows 10/11 không Internet |

## UI e2e (v0.3.0)
`npm run test:ui` — dev server + Chromium: nạp dữ liệu mẫu → import danh mục xe → import 2.035 phiếu → duyệt 20 màn hình, chụp vào `docs/screenshots/`, thất bại nếu có lỗi console/pageerror. Kết quả: 2.035 phiếu, 0 lỗi.

## Đối chiếu (v0.4.0)
`tests/reconciliation.test.js`: matchRows (khớp, lệch nhiều cột, thiếu A/B, trùng B, khớp biển số+ngày+KL, nhiều ứng viên) và end-to-end: bảng kê HAK dựng từ hệ thống + 4 lỗi cài sẵn → 104 khớp, 1 lệch KL, 1 lệch đơn giá, 1 thiếu bên A, 1 thiếu bên B; bảng kê HAK vẫn 416.454.167 đ (đối chiếu không sửa phiếu).

## Hồi quy phát hành 0.8.0
- `release-approval.test.js`: API và file Excel chặn Nháp trên chứng từ, bộ lọc mở rộng, số đếm màn nhập/báo cáo, khối lượng sửa trực tiếp, cấu hình đổi sau preview, tự duyệt bị chặn.
- `integrity-fixes.test.js`: hoàn tác cập nhật sau duyệt đưa phiếu về Nháp và xóa xác nhận cũ.
- UI smoke: Nháp hiện ở màn nhập; cùng bộ lọc cho 0 phiếu ở bảng kê, trạng thái duyệt lại thành công.
- Windows CI: nâng DB schema 4 và 6 lên 7; quy trình duyệt trên bản đã đóng gói; năm ca Setup/Portable cùng checksum.
