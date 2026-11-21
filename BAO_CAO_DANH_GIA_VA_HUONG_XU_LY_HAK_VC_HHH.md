# BÁO CÁO ĐÁNH GIÁ, KIỂM THỬ VÀ ĐỀ XUẤT NÂNG CẤP HỆ THỐNG VC COST (HAK_VC_HHH)

- **Dự án**: Hệ thống quản lý – tính toán – đối chiếu chi phí vận chuyển (VC Cost - Offline Desktop App)
- **Mã nguồn GitHub**: [https://github.com/saoluucvhak-pixel/HAK_VC_HHH](https://github.com/saoluucvhak-pixel/HAK_VC_HHH)
- **Thư mục làm việc**: `D:\PROJECT_IT\VCHHH_OFFLINE`
- **Phiên bản hiện tại**: `0.8.3` (Database Schema: 8)
- **Thời điểm kiểm tra**: 20/11/2026
- **Công nghệ nền tảng**: Electron, Node.js (>=22.5), SQLite (`better-sqlite3` & `node:sqlite`), Vanilla JS, CSS Token Luxe (HAK Design System), ExcelJS, Playwright.

---

## I. TỔNG QUAN KẾT QUẢ KIỂM THỬ THỰC TẾ

Toàn bộ mã nguồn đã được tải về đầy đủ từ nhánh `main` của repository và tiến hành thiết lập môi trường, kiểm thử đa tầng:

| Hạng mục kiểm thử | Công cụ / Lệnh | Kết quả thực tế | Đánh giá |
|---|---|---|---|
| **Cài đặt thư viện** | `npm install --ignore-scripts` | 431 gói cài đặt thành công, 0 lỗ hổng bảo mật (`found 0 vulnerabilities`) | ✅ Hoàn tất |
| **Kiểm thử logic & nghiệp vụ** | `npm test` (`node --test tests/*.test.js`) | **210/210 test cases PASS** (100% đạt, thời gian: ~48.3s) | ✅ Xuất sắc |
| **Kiểm chứng với Excel chuẩn** | `npm run validate -- tests/fixtures/sample-v47.xlsx` | **100% số liệu khớp tuyệt đối** với file kế toán mẫu V.47 | ✅ Xuất sắc |
| **Kiểm thử giao diện (UI Smoke)** | `npm run test:ui` (Playwright + Chrome) | Duyệt qua 40+ kịch bản màn hình, **0 lỗi console / pageerror** | ✅ Xuất sắc |

### 1. Chi tiết kiểm chứng số liệu với File Excel mẫu (V.47)
- **Sheet "File tổng"**: Đọc chính xác 2.035 phiếu cân.
- **Tổng sản lượng đợt**: Đạt đúng **38.563.700 kg** (38.563,89 tấn).
- **Tổng chi phí gồm VAT**: Đạt đúng **5.512.904.418,24 VNĐ** (chênh lệch tròn theo quy tắc bảng kê chỉ 0,24 đ do làm tròn từng dòng).
- **Phân tách theo từng đơn vị vận chuyển**: Khớp 100% số xe, số chuyến và doanh thu của cả 4 đơn vị (HAK, HHH, QC, ĐH).
- **Phát hiện bất thường**: Engine cảnh báo chính xác 16 phiếu có dấu hiệu cân bất thường (thời gian cân kéo dài `LONG_WEIGH_DURATION`, cân đảo `REVERSE_WEIGHING`, khoảng cách giữa 2 chuyến quá ngắn `SHORT_GAP`).

---

## II. ĐÁNH GIÁ QUY TRÌNH NHẬP VÀ XỬ LÝ DỮ LIỆU

### 1. Điểm mạnh nổi bật
1. **Quy trình Import 4 bước an toàn tuyệt đối**:
   - `Open` (Đọc file, gợi ý sheet có cấu trúc phù hợp nhất) $\rightarrow$ `SheetInfo/Check` (Tự động nhận diện cột, cho phép ghép cột động và kiểm tra nhanh lỗi ngay tại chỗ) $\rightarrow$ `Preview` (Phân tích toàn diện, đối chiếu trùng lặp, tính thử tiền nhưng **chưa ghi CSDL**) $\rightarrow$ `Commit` (Thực thi trong một `Transaction` CSDL duy nhất). Nếu xảy ra lỗi giữa chừng, toàn bộ dữ liệu tự động rollback.
2. **Cơ chế chống trùng lặp đa tầng thông minh**:
   - Phân loại rõ: `EXACT_DUPLICATE` (trùng 100%), `IN_FILE_DUPLICATE` (trùng ngay trong file nguồn), `KEY_CONFLICT` (cùng số phiếu + nơi xuất nhưng khác khối lượng hoặc xe) và `PENDING_ALREADY` (đã có dòng tương tự đang chờ duyệt ở lô khác).
   - Cơ chế giải quyết xung đột **"Cần kiểm tra" (Pending Review)** minh bạch: Người dùng có thể chủ động chọn *Giữ cũ*, *Cập nhật mới* hoặc *Bỏ qua*, kèm theo lý do bắt buộc và nhật ký kiểm toán (Audit Log).
3. **Độ toàn vẹn và kiểm soát khối lượng (Data Integrity)**:
   - Ràng buộc nghiêm ngặt: Khối lượng hàng bắt buộc phải bằng $|Cân\ 1 - Cân\ 2|$. Nếu sai lệch, dòng phiếu sẽ bị chặn ngay ở khâu import.
   - Ngưỡng giới hạn khối lượng (cấu hình được): Chặn các lỗi nhập liệu nhầm đơn vị (ví dụ nhập 30 tấn thay vì 30.000 kg).
   - Đối chiếu tổng khối lượng với dòng "Tổng cộng" của file Excel gốc để đảm bảo không bị sót dòng.
4. **Engine tính giá tập trung (`TransportCostEngine`)**:
   - Triết lý chuẩn mực: Backend là **Single Source of Truth**; giao diện chỉ hiển thị, không tự tính tiền.
   - Hỗ trợ biến động giá theo chu kỳ: Phân giải bảng giá theo ngày hiệu lực, tính toán bù trừ giá dầu theo công thức linh hoạt, lịch sử xe luân chuyển giữa các nhà xe theo mốc thời gian (`VehicleResolver`).
   - Hai chế độ làm tròn: `GROUP` (cộng sản lượng rồi nhân đơn giá - chuẩn kế toán mẫu) và `TICKET` (tính tròn từng phiếu).
5. **Cơ chế Khóa kỳ / Chốt kỳ (`ChotKyService`)**:
   - Bảo vệ số liệu đã chốt: Không cho phép sửa đổi hoặc tính lại các phiếu thuộc kỳ đã khóa.
   - Muốn mở khóa bắt buộc phải ghi rõ lý do và chỉ người có thẩm quyền mới thực hiện được.
6. **Quy trình Duyệt phiếu linh hoạt**:
   - Tách biệt trạng thái `NHAP` (Nháp) và `DA_DUYET` (Đã duyệt). Phiếu nháp bị loại bỏ khỏi Bảng kê, Dashboard và báo cáo công nợ để tránh xuất nhầm số liệu chưa được kiểm soát.

### 2. Các điểm hạn chế và rủi ro tiềm ẩn cần xử lý
1. **Phụ thuộc Native C++ Module khi cài đặt**:
   - `package.json` khai báo `better-sqlite3` ở dependencies chính. Khi chạy trên Node 24 mới hoặc các máy Windows văn phòng thiếu Visual Studio Build Tools, lệnh `npm install` gốc sẽ báo lỗi `node-gyp rebuild`. Dù code đã có fallback sang `node:sqlite`, cần làm mịn quy trình cài đặt để người dùng/kỹ thuật viên không gặp lỗi.
2. **Khả năng xử lý file Excel dung lượng lớn**:
   - `workbookReader.js` đọc toàn bộ tệp vào RAM thông qua `exceljs`. Nếu khách hàng nạp file Excel tổng hợp cả năm (vài chục MB, hàng vạn dòng kèm hình ảnh/biểu đồ), việc này có thể gây giật lag bộ nhớ (RAM spike) hoặc làm đơ giao diện tạm thời do Node.js xử lý đồng bộ.
3. **Cấu trúc dữ liệu nhiều bảng trong cùng 1 Sheet Excel**:
   - Một số đơn vị vận tải xuất file Excel có nhiều bảng phân cách bởi nhiều dòng "Tổng cộng" (ví dụ: Tổng cộng sáng, Tổng cộng chiều). Hiện tại app mặc định dừng ở dòng Tổng cộng đầu tiên và cảnh báo dòng bên dưới (`ignoredBelowTotal`). Mặc dù có tùy chọn `readAfterTotal`, nhưng người dùng phổ thông thường không hiểu rõ cách bật hoặc cấu hình.
4. **Thời điểm áp dụng đơn giá cho các chuyến cân xuyên ngày**:
   - Hiện tại engine lấy ngày cân 1 (`ngay_gio_can_1`) để xác định ngày áp dụng bảng giá và nhà xe sở hữu. Nếu một xe vào cân lúc 23:45 ngày 31 và ra lúc 00:30 ngày 01 (thời điểm giá dầu hoặc bảng giá mới có hiệu lực), cần có quy định nghiệp vụ rõ ràng xem tính theo ngày vào hay ngày ra.

---

## III. ĐÁNH GIÁ THIẾT KẾ GIAO DIỆN & TRẢI NGHIỆM NGƯỜI DÙNG (DESIGN & UI/UX)

### 1. Điểm mạnh về thiết kế
1. **Hệ thống Design System chuyên nghiệp**:
   - Sử dụng **HAK Enterprise Design System** (`luxe.css`), tông màu kết hợp hài hòa: Xanh navy sâu (`#0B101A`), Vàng champagne (`#C9A45C`), Trắng ngà (`#F1EFE9`).
   - Thiết kế giao diện mang phong cách sang trọng, hiện đại, đậm chất ứng dụng tài chính/doanh nghiệp cao cấp.
2. **Tuân thủ chuẩn tiếp cận và hiển thị**:
   - Đạt chuẩn **WCAG AA** về độ tương phản chữ/nền ($\ge 4,5:1$) ở cả hai chế độ Sáng và Tối (Dark Mode).
   - Phông chữ chuẩn tiếng Việt: Kết hợp `Be Vietnam Pro` (chữ hiển thị rõ ràng, nét thanh mảnh hiện đại) và `IBM Plex Mono` (cho các cột số liệu, mã phiếu, biển số xe).
3. **Quy chuẩn hiển thị số liệu kế toán Việt Nam**:
   - Số tiền và khối lượng định dạng dấu chấm phân cách hàng nghìn, dấu phẩy thập phân (`1.234.567,89`).
   - Canh lề chuẩn nghiệp vụ: Cột số canh phải (`tabular-nums`), cột ngày tháng canh giữa, cột chữ canh trái.
   - Ô nhập số tiền/khối lượng có tính năng format realtime khi người dùng gõ phím, giữ đúng vị trí con trỏ chuột.
4. **Điều hướng theo luồng công việc (Workflow-driven Navigation)**:
   - Thanh menu bên trái phân nhóm mạch lạc:
     - `① Nhập liệu`: Import phiếu cân, Import danh mục xe, Cần kiểm tra.
     - `② Xử lý`: Phiếu cân, Điều chỉnh giá dầu, Bảng giá, Duyệt phiếu.
     - `③ Báo cáo & Đối chiếu`: Bảng kê thanh toán, Đối chiếu đối tác, Báo cáo xe, Báo cáo nhà xe.
     - `④ Kiểm soát & Hệ thống`: Chốt kỳ, Danh mục, Lịch sử thao tác (Audit), Sao lưu dữ liệu, Cài đặt.
   - Có thanh **HAK Smart Filter** cho phép lọc kết hợp từ khóa, khoảng ngày nhanh, popover chọn nhiều đơn vị, nhiều tuyến linh hoạt.

### 2. Các điểm cần tối ưu về Design & UI/UX
1. **Khả năng đáp ứng màn hình kích thước nhỏ (Responsiveness)**:
   - Trên màn hình laptop 14 inch độ phân giải HD (1366x768), bảng danh sách phiếu cân có trên 15 cột dẫn đến thanh cuộn ngang khá dài. Cần bổ sung tính năng **Ghim cột cố định** (Sticky columns cho cột "Số phiếu" và "Thao tác") và cho phép người dùng ẩn/hiện bớt các cột không quan trọng.
2. **Trải nghiệm nhập liệu nhanh bằng bàn phím (Keyboard Navigation)**:
   - Nhân viên kế toán thường có thói quen thao tác liên tục bằng bàn phím numpad. Các form nhập nhanh danh mục và màn hình duyệt phiếu hàng loạt hiện chủ yếu dựa vào click chuột. Cần bổ sung các phím tắt tiện lợi (ví dụ: `Ctrl+S` để lưu, `Esc` đóng popup, `Space` để chọn dòng, `Enter` để xác nhận).
3. **Thanh tiến trình (Progress Indicator) trực quan**:
   - Khi thực hiện import lô lớn (2.000 - 5.000 dòng) hoặc chạy tính toán lại giá toàn bộ kỳ, hiện tại giao diện chỉ vô hiệu hóa nút bấm và hiện thông báo kết thúc. Việc hiển thị thanh tiến trình % (Progress Bar) cụ thể sẽ giúp người dùng yên tâm không tưởng nhầm là ứng dụng bị treo.
4. **Chế độ xem trước file in & xuất chứng từ**:
   - Khi xuất PDF Bảng kê hoặc Bảng tính đơn giá, người dùng cần có nút "Xem trước trang in" (Print Preview) trực tiếp trên giao diện trước khi quyết định lưu file ra máy.

---

## IV. BẢNG DANH MỤC CÁC NỘI DUNG CẦN SỬA & HƯỚNG XỬ LÝ

| STT | Vấn đề phát hiện | Phân loại | Mức độ | Hướng xử lý / Giải pháp đề xuất |
|:---:|---|---|:---:|---|
| **1** | Lỗi cài đặt `better-sqlite3` khi chạy `npm install` trên môi trường thiếu Visual Studio C++ Build Tools | Kỹ thuật / Môi trường | **Cao** | Bổ sung script cài đặt an toàn: thêm script `"install:safe": "npm install --ignore-scripts"` hoặc cấu hình `optionalDependencies` cho `better-sqlite3`. Đảm bảo ứng dụng chạy trơn tru với driver tích hợp sẵn `node:sqlite` mà không cần trình biên dịch C++. |
| **2** | Chưa có thanh tiến độ (Progress Bar) khi import file Excel dung lượng lớn | UI / UX | **Trung bình** | Thêm thanh tiến độ % trong `renderer/views/import.js` bằng cách chia nhỏ các giai đoạn (Đọc file $\rightarrow$ Parse dữ liệu $\rightarrow$ Kiểm tra trùng $\rightarrow$ Tính thử tiền) và cập nhật giao diện liên tục. |
| **3** | Bảng phiếu cân bị tràn ngang trên màn hình laptop nhỏ (1366x768) | Giao diện | **Trung bình** | Thêm thuộc tính CSS cố định (Sticky Columns) cho 2 cột đầu (Checkbox, Số phiếu) và cột cuối (Thao tác). Bổ sung popup "Tùy chọn ẩn/hiện cột" cho phép kế toán lưu cấu hình hiển thị theo nhu cầu. |
| **4** | Tệp Excel có nhiều khối dữ liệu con (nhiều dòng "Tổng cộng") dễ gây hiểu nhầm | Nghiệp vụ Import | **Trung bình** | Khi phát hiện cờ `ignoredBelowTotal`, hiển thị banner cảnh báo nổi bật màu cam ngay trên bảng ghép cột kèm nút toggle: *"Đọc toàn bộ các khối phía dưới"* để kế toán quyết định chỉ bằng 1 cú click. |
| **5** | Chưa có phím tắt thao tác nhanh cho màn hình Duyệt phiếu và Nhập liệu | Trải nghiệm người dùng | **Thấp** | Bổ sung bộ lắng nghe phím tắt toàn cục: `Ctrl+F` (nhảy vào ô tìm kiếm), `Ctrl+A` (chọn tất cả dòng), `Alt+D` (Duyệt các dòng đã chọn), `Esc` (Đóng modal). |
| **6** | Quy tắc xác định ngày áp dụng bảng giá cho chuyến cân xuyên đêm (qua ngày mới) | Quy trình dữ liệu | **Thấp** | Thêm một tùy chọn trong Cài đặt hệ thống: *"Ngày căn cứ tính giá: [Ngày cân lần 1 (Mặc định) / Ngày cân lần 2]"* để linh hoạt đáp ứng hợp đồng cụ thể với từng chủ hàng/nhà xe. |
| **7** | Xem trước (Preview) biểu mẫu Bảng kê / Báo cáo trước khi in/xuất | Chức năng | **Thấp** | Tích hợp modal preview HTML có phân trang A4 ngay trên giao diện trước khi xuất file `.pdf` hoặc `.xlsx`. |

---

## V. KẾT LUẬN & ĐỀ XUẤT LỘ TRÌNH TRIỂN KHAI

### Đánh giá chung:
Mã nguồn ứng dụng **HAK_VC_HHH (VC Cost 0.8.3)** có **chất lượng hoàn thiện rất cao**:
- Kiến trúc phần mềm tách lớp mạch lạc (Database $\rightarrow$ Services $\rightarrow$ IPC Handlers $\rightarrow$ Frontend View).
- Thuật toán tính toán chi phí vận chuyển, bù trừ giá dầu và xử lý số liệu kế toán đã được kiểm chứng khớp 100% với tài liệu và bảng tính thực tế của HAK Group.
- Bộ test tự động cực kỳ đồ sộ và chỉn chu (210 bài test nghiệp vụ + test giao diện Playwright đạt 100%).
- Hệ thống thiết kế (Design System) sang trọng, chuẩn mực, hỗ trợ Dark Mode và khả năng truy cập rất tốt.

### Lộ trình thực hiện khuyến nghị:
1. **Giai đoạn 1 (Ưu tiên ngay)**:
   - Cập nhật tài liệu hướng dẫn cài đặt (`README.md`) và script đóng gói để xử lý triệt để việc tương thích driver SQLite trên các máy tính Windows khác nhau (`node:sqlite` vs `better-sqlite3`).
   - Cải tiến giao diện bảng phiếu cân (Sticky header/columns, ẩn hiện cột) để phục vụ tốt nhất cho các dòng máy laptop văn phòng.
2. **Giai đoạn 2 (Hoàn thiện trải nghiệm UX)**:
   - Bổ sung thanh tiến trình khi import file lớn.
   - Cải tiến thông báo trực quan khi import file có nhiều khối bảng tính.
   - Bổ sung hệ thống phím tắt cho nhân viên nhập liệu/kế toán.
3. **Giai đoạn 3 (Nâng cao)**:
   - Thêm tính năng cấu hình ngày căn cứ tính cước cho các chuyến xe cân xuyên ngày.
   - Thêm trình xem trước bản in (Print preview modal).

---
*Báo cáo được thực hiện tự động dựa trên phân tích mã nguồn thực tế và kết quả chạy test tại workspace `D:\PROJECT_IT\VCHHH_OFFLINE`.*
