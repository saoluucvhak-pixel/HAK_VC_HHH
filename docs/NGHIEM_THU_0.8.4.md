# Nghiệm thu VC Cost 0.8.4

Phương pháp: 4 agent chỉ đọc (bảo mật, nghiệp vụ, kiểm thử, phát hành) rà soát mã nguồn; mỗi phát hiện được tái hiện lại bằng test đỏ trước khi sửa. Chỉ giữ lỗi thật. Công cụ `ruflo security scan` cho 10 cảnh báo HIGH, đều là dương tính giả (đã đối chiếu từng mục).

## Ma trận lỗi → sửa → test
| # | Lỗi | Sửa | Test |
|---|-----|-----|------|
| 1 | Tên tệp import chứa `..` thoát thư mục lưu bản sao | `joinInside`, `safeFileName` (`src/utils/safePath.js`, `src/ipc/handlers.js`) | `tests/an-toan-duong-dan.test.js` |
| 2 | Tên tệp xuất Excel thoát thư mục | như trên | như trên |
| 3 | Đọc Excel không giới hạn (ô XFD1048576, zip bomb, tệp lớn) | `src/excel/workbookReader.js` | `tests/gioi-han-excel.test.js` |
| 4 | `backup.export` mở cho vai trò Nhập | chuyển sang Admin (`src/utils/permissions.js`) | `tests/phan-quyen-bang-gia.test.js` |
| 5 | Chốt kỳ một phần nhà xe khóa cả đợt | `ChotKyService` | `tests/chot-dot-theo-don-vi.test.js` |
| 6 | Xem trước import cũ → ghi mất dữ liệu âm thầm | kiểm tra lại dòng đích lúc ghi (`TicketImportService`) | `tests/import-xem-truoc-cu.test.js` |
| 7 | Trùng trong cùng tệp không nhận ra khi tên địa điểm khác bí danh | chuẩn hóa trước khi so | như trên |
| 8 | Báo cáo cộng tiền phiếu chưa có giá | `pricedSql` có điều kiện (`ReportService`) | `tests/bao-cao-nhat-quan.test.js` |
| 9 | Theo nơi xuất gộp các nơi chưa khớp danh mục | nhóm theo id/tên gốc | như trên |
| 10 | Đổi làm tròn khi đã chốt không cảnh báo | `ConfirmRequired` (`handlers.js`, `renderer/views/system.js`) | `tests/hoan-thien-0.8.3.test.js` |
| 11 | Chuyển đợt đưa phiếu Đã duyệt về Nháp | loại `dot_van_chuyen_id` khỏi trường tài chính (`TicketService`) | `tests/approval.test.js` |
| 12 | `release.yml` đọc ghi chú/phiên bản từ nhánh hiện hành, không chặn tag trùng | viết lại, kiểm tra tại commit nghiệm thu | kiểm tra thủ công YAML + logic |
| 13 | `windows.yml` hủy lần nghiệm thu đang chạy; job chết `publish-081` | concurrency theo run_id, gỡ job | kiểm tra YAML |

Bổ sung test không kèm sửa mã: engine CAN_1/CAN_2 (`tests/can-cu-ngay-gia.test.js`), quyền theo kênh ghi.

## Không sửa (có chủ đích)
Số 0 đầu ở khóa phiếu; thông báo số kiểu Anh; làm tròn Dashboard; chênh giám định; `shell.showItem` và phiên rảnh trên kênh Electron; ghim SHA cho action; bộ cài/biểu tượng chưa ký. Các mục này rủi ro thấp hoặc cần quyết định sản phẩm.

## Kết quả kiểm thử
- `npm test`: 235/235 đạt với node:sqlite và với better-sqlite3.
- `npm run test:ui` (Playwright smoke): không có lỗi.
- CI / nghiệm thu bộ cài Windows: xem mục cuối (điền sau khi chạy).
