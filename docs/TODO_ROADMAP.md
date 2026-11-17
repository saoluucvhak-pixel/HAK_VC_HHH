# TODO / ROADMAP

## Cần người dùng trả lời trước Phase 3
Q1–Q10 ✅ đã chốt đủ (07/10/2026) — chi tiết: `PHAN_TICH_THIET_KE_A-H.md` mục A.8.

## Tiêu chí hoàn thành (MASTER_PROMPT XLI) — cập nhật 17/11/2026
| # | Tiêu chí | Trạng thái |
|---|---|---|
| 1 | Import được file phiếu cân | ✅ wizard 4 bước, kiểm tra ngay khi ghép cột, đọc thử 8 dòng, tải Excel dòng cần xử lý, hoàn tác |
| 2 | Không sinh duplicate khi import lại | ✅ 9 kịch bản trùng (biển số/nơi xuất viết khác, sửa KL, số phiếu tái dùng, xe/đợt khác…) có test; ràng buộc DB |
| 3–6 | Xác định xe, đơn vị VC, tuyến, bảng giá theo thời gian | ✅ engine + lịch sử xe→đơn vị theo ngày; chặn chồng lấn/giá âm/VAT sai khi nhập danh mục |
| 7 | Tính đúng chi phí từng phiếu | ✅ khớp Excel V.47 (`npm run validate`) |
| 8–9 | Tổng hợp theo xe / đơn vị | ✅ khớp Excel; bảng kê theo từng đơn vị |
| 10 | Lịch sử từng xe theo thời gian | ✅ timeline + cờ thời gian bất thường |
| 11–12 | Đối chiếu, chỉ ra sai lệch | ✅ cấp phiếu và cấp xe (`recon.weight`) |
| 13 | Xuất Excel / PDF | ✅ bảng kê, biểu mẫu in ký, báo cáo, dòng cần xử lý; PDF thật qua Chromium (có kiểm tra tự động) |
| 14 | Dashboard | ✅ "Việc cần làm theo quy trình" + KPI + biểu đồ |
| 15 | Audit log | ✅ bất biến ở mức CSDL (trigger) |
| 16 | Backup/restore | ✅ cấu hình có kiểm tra; không bao giờ xóa hàng loạt do cấu hình sai |
| 17 | Kiểm thử khớp file Excel mẫu | ✅ |
| 18 | Chạy offline | ✅ font/thư viện đóng gói sẵn, CSP chặn mạng |
| 19–20 | Windows Portable / Setup | ✅ CI Windows build `win-unpacked` + khởi động thử bản đóng gói; chạy tay workflow với tùy chọn "installers" để lấy Portable + Setup (chưa ký số) |

## Đã làm thêm so với kế hoạch ban đầu
- **Bộ lọc thông minh HAK Smart Filter** dùng chung mọi màn hình; **Design System luxe** (sáng/tối, AA); menu theo luồng công việc ①–④.
- **Chốt kỳ** (khóa số liệu, snapshot bất biến), **kỳ giá dầu**, **hợp đồng vận chuyển**, **bảng tính đơn giá**.
- Nâng Electron 45 + better-sqlite3 13 (N-API), đọc Excel bằng exceljs (bỏ SheetJS), CI Linux + Windows (cả hai driver CSDL).

## Việc còn lại (đề xuất)
2. Ký số bộ cài (SmartScreen); `minimatch` trong `electron-builder` (chờ bản sửa upstream).
3. Phân quyền người nhập / người duyệt (luồng Nháp → Duyệt); ghi tên người dùng vào nhật ký.

## Ý tưởng sau
- Đọc trực tiếp file xuất từ phần mềm trạm cân theo lịch.
- Mẫu in bảng kê thanh toán theo đơn vị VC.
- Phân quyền người nhập / người duyệt (luồng Nháp → Duyệt).
