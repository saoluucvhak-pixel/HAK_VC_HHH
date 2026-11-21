# PROMPT CHỈ ĐẠO CHỈNH SỬA VÀ TỐI ƯU HÓA HỆ THỐNG VC COST (HAK_VC_HHH)

> **Mục đích**: Sử dụng prompt này để cung cấp cho AI hoặc kỹ sư lập trình tiến hành thực hiện các công việc sửa lỗi, hoàn thiện các điểm hạn chế về môi trường, tối ưu trải nghiệm người dùng (UX) và nâng cấp giao diện cho dự án **VC Cost**.

---

```markdown
Bạn là kỹ sư phần mềm cao cấp chuyên về Electron, Node.js, SQLite và kiến trúc phần mềm kế toán/vận tải. 
Hiện tại dự án VC Cost (HAK_VC_HHH) tại workspace cục bộ đã đạt 100% test logic (210 unit tests, khớp tuyệt đối mẫu Excel V.47), tuy nhiên qua quá trình kiểm thử sâu hệ thống phát hiện 6 điểm cần tinh chỉnh, tối ưu hóa và xử lý.

Hãy đọc kỹ mã nguồn hiện có và tiến hành thực hiện tuần tự các nhiệm vụ sau:

---

### NHIỆM VỤ 1: Khắc phục lỗi cài đặt C++ native trên môi trường Windows (Độ ưu tiên: CAO)
- **Vấn đề**: File `package.json` khai báo `better-sqlite3` trong `dependencies`. Trên các máy tính Windows thiếu Visual Studio C++ Build Tools hoặc dùng Node.js 24+, lệnh `npm install` gốc sẽ dừng do lỗi `node-gyp rebuild`. Trong khi đó, `src/database/connection.js` đã hỗ trợ sẵn driver `node:sqlite` tích hợp của Node.js >= 22.5.
- **Yêu cầu xử lý**:
  1. Cập nhật `package.json`:
     - Thêm script `"install:safe": "npm install --ignore-scripts"`.
     - Cấu hình lại `better-sqlite3` thành `optionalDependencies` (hoặc cấu hình prebuilds tương thích với Electron khi đóng gói).
  2. Bổ sung ghi chú rõ ràng trong `README.md` phần hướng dẫn cài đặt trên môi trường phát triển Windows.
- **Tiêu chí nghiệm thu**: Chạy thử lệnh cài đặt trên môi trường sạch không bị gián đoạn; `npm test` và `npm run validate` vẫn vượt qua 100% với driver `node:sqlite`.

---

### NHIỆM VỤ 2: Tối ưu hiển thị bảng dữ liệu trên màn hình laptop nhỏ (Độ ưu tiên: TRUNG BÌNH)
- **Vấn đề**: Màn hình danh sách Phiếu cân (`renderer/views/tickets.js`) và Bảng kê có hơn 15 cột. Khi chạy trên màn hình độ phân giải 1366x768 hoặc tỷ lệ phóng to (Display Scaling 125%-150%), bảng bị tràn ngang dài khiến người dùng mất dấu cột Mã phiếu và Thao tác.
- **Yêu cầu xử lý**:
  1. Trong `renderer/styles.css` và `renderer/views/tickets.js`:
     - Thêm CSS `position: sticky; left: 0; z-index: 2` cho cột chọn (checkbox) và cột **Số phiếu**.
     - Thêm CSS `position: sticky; right: 0; z-index: 2` cho cột **Thao tác** (Sửa, Xóa, Chi tiết).
     - Đổ bóng nhẹ (`box-shadow`) phân tách cột ghim cố định với vùng cuộn nội dung.
  2. Bổ sung nút bấm `"⚙ Ẩn/hiện cột"` trên thanh công cụ bảng phiếu cân, cho phép kế toán tick chọn các cột cần xem (lưu cấu hình vào `localStorage.getItem('vc.tickets.columns')`).
- **Tiêu chí nghiệm thu**: Khi cuộn ngang bảng, cột Số phiếu và cột Thao tác luôn hiển thị cố định; các cột khác cuộn trơn tru, không lệch hàng hay vỡ layout.

---

### NHIỆM VỤ 3: Bổ sung thanh tiến độ (Progress Bar) cho tác vụ Import lớn (Độ ưu tiên: TRUNG BÌNH)
- **Vấn đề**: Khi nạp tệp Excel từ 2.000 đến 10.000 dòng, ứng dụng hiện tại chỉ hiển thị trạng thái `disabled` nút bấm, gây cảm giác ứng dụng bị đơ (freeze).
- **Yêu cầu xử lý**:
  1. Trong `renderer/views/import.js`:
     - Khi người dùng bấm "Xem trước" hoặc "Import", hiển thị thanh tiến độ trực quan với 4 giai đoạn rõ ràng:
       - Bước 1/4: Đọc file Excel vào bộ nhớ.
       - Bước 2/4: Phân tích cú pháp & chuẩn hóa dữ liệu.
       - Bước 3/4: Kiểm tra trùng lặp & tính thử chi phí.
       - Bước 4/4: Hoàn tất / Ghi dữ liệu vào CSDL.
     - Sử dụng CSS animation mượt mà theo tông màu thương hiệu `var(--brand)` và `var(--champ)`.
- **Tiêu chí nghiệm thu**: Import file `sample-v47.xlsx` hiển thị thông báo trạng thái từng bước rõ ràng, hoàn thành mượt mà.

---

### NHIỆM VỤ 4: Cải tiến trải nghiệm khi phát hiện file Excel có nhiều khối dữ liệu (Độ ưu tiên: TRUNG BÌNH)
- **Vấn đề**: Một số đơn vị gửi file có nhiều bảng phân cách bởi nhiều dòng "Tổng cộng" (ví dụ: Tổng cộng chuyến sáng, Tổng cộng chuyến chiều). Trình parser hiện tại dừng ở dòng Tổng cộng đầu tiên và gán cờ `ignoredBelowTotal`, nhưng người dùng phổ thông có thể không để ý cảnh báo nhỏ bên dưới.
- **Yêu cầu xử lý**:
  1. Trong `renderer/views/import.js` (tại bước Ghép cột và Xem trước):
     - Nếu phát hiện `ignoredBelowTotal > 0`, hiển thị một Card thông báo nổi bật màu hổ phách (`tag amber`) ngay trên đầu bảng xem trước:
       *"Phát hiện còn X dòng dữ liệu nằm dưới dòng 'Tổng cộng' (dòng Y). File có thể chứa nhiều khối dữ liệu con."*
     - Đặt ngay 1 nút chuyển đổi nhanh (Toggle button / Checkbox): `[x] Đọc tiếp toàn bộ các khối phía dưới (readAfterTotal)`.
     - Khi người dùng tick chọn, tự động gọi lại `check` hoặc `preview` với tham số `readAfterTotal: true` mà không bắt người dùng phải cấu hình thủ công.
- **Tiêu chí nghiệm thu**: Kiểm thử với file có 2 bảng con, người dùng có thể dễ dàng bật chế độ đọc toàn bộ file chỉ bằng 1 click.

---

### NHIỆM VỤ 5: Tích hợp hệ thống phím tắt kế toán (Keyboard Shortcuts) (Độ ưu tiên: THẤP)
- **Vấn đề**: Kế toán viên có thói quen dùng phím tắt liên tục trên bàn phím để tăng tốc độ thao tác thay vì click chuột nhiều lần.
- **Yêu cầu xử lý**:
  1. Bổ sung sự kiện lắng nghe bàn phím toàn cục trong `renderer/app.js`:
     - `Ctrl + F`: Đặt con trỏ vào ô tìm kiếm nhanh của thanh HAK Smart Filter.
     - `Esc`: Đóng bất kỳ cửa sổ Modal / Popover nào đang mở.
     - `Alt + D`: Chuyển nhanh đến màn hình **Duyệt phiếu**.
     - `Alt + I`: Chuyển nhanh đến màn hình **Import phiếu cân**.
     - `Alt + B`: Chuyển nhanh đến màn hình **Bảng kê**.
  2. Bổ sung tooltip hướng dẫn phím tắt cạnh các nút bấm tương ứng.
- **Tiêu chí nghiệm thu**: Nhấn các tổ hợp phím tắt trên hoạt động chuẩn xác, không xung đột với các phím tắt mặc định của hệ điều hành.

---

### NHIỆM VỤ 6: Tùy chọn ngày căn cứ tính cước cho chuyến cân xuyên đêm (Độ ưu tiên: THẤP)
- **Vấn đề**: Nếu xe cân lần 1 lúc 23:50 ngày 31 và cân lần 2 lúc 00:30 ngày 01 (ngày áp dụng giá mới hoặc kỳ mới), hiện tại mặc định lấy `ngay_gio_can_1`. Cần linh hoạt cho phép cấu hình theo từng hợp đồng vận chuyển.
- **Yêu cầu xử lý**:
  1. Trong `src/services/SettingsService.js` và `renderer/views/system.js` (tab Cài đặt tính giá):
     - Thêm cấu hình `ngay_can_cu_gia`: `"CAN_1"` (Mặc định) hoặc `"CAN_2"`.
  2. Trong `src/services/TransportCostEngine.js`:
     - Lấy ngày căn cứ theo cấu hình trên (`t.ngay_gio_can_2` nếu cấu hình là `"CAN_2"` và có dữ liệu, ngược lại dùng `t.ngay_gio_can_1`).
- **Tiêu chí nghiệm thu**: Đổi cài đặt sang `CAN_2`, các chuyến cân xuyên đêm áp dụng đúng đơn giá và nhà xe hiệu lực của ngày cân 2.

---

### NGUYÊN TẮC BẮT BUỘC:
- **KHÔNG LÀM HỎNG LOGIC CŨ**: Đảm bảo toàn bộ 210 bài test hiện hành (`npm test`), bài kiểm chứng Excel (`npm run validate`) và UI smoke test (`npm run test:ui`) tiếp tục PASS 100%.
- **TUÂN THỦ DESIGN SYSTEM**: Sử dụng đúng các token màu chuẩn trong `luxe.css` (`var(--brand)`, `var(--champ)`, `var(--ink)`, `var(--card)`...). Không hard-code mã màu lạ.
- Chạy lại toàn bộ `npm test` và `node tests/test-comprehensive.js` để nghiệm thu sau khi hoàn thành.
```
