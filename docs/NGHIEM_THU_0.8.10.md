# BIÊN BẢN NGHIỆM THU PHÁT HÀNH VC COST PHIÊN BẢN 0.8.10

**Thời gian lập biên bản:** 27/11/2026 01:25 (GMT+7)  
**Mã commit cơ sở:** `3362bd9` (đồng bộ nhánh `main` mới nhất trên GitHub)  
**Phiên bản phát hành:** `0.8.10`  
**Môi trường thử nghiệm:** Windows 11 Pro 64-bit / Electron 45.3.3 / Node.js 22.x / better-sqlite3 (Native)

---

## 1. NỘI DUNG NÂNG CẤP & HOÀN THIỆN TRONG BẢN 0.8.10

1. **Bộ Mẫu Excel Chuẩn Doanh Nghiệp Cấp Cao (Corporate Grade)**:
   - Áp dụng chuẩn bảng màu Corporate Navy (`#1F4E79`, Header Dark `#143452`, Border `#D9D9D9`, Dòng so le `#F8FAFC`).
   - Thiết kế Banner tiêu đề doanh nghiệp với mã hiệu ISO quản lý biểu mẫu (`BM-01/VCC-2026` đến `BM-04/VCC-2026`).
   - Huy hiệu chỉ dẫn nhập liệu trực quan 3 màu: 🔴 Bắt buộc, 🔵 Tùy chọn, 🔒 Ô tự động tính công thức (Khóa bảo vệ).
   - Bảo vệ Sheet (`Worksheet Protection`): Khóa tiêu đề và ô công thức, mở khóa 500 dòng nhập liệu người dùng.
   - Dropdown Data Validation liên kết động CSDL: Tuyến đường / Địa điểm và Đơn vị vận chuyển đang hoạt động.
   - Cung cấp đầy đủ 4 biểu mẫu chuẩn:
     - Mẫu phiếu cân xe tải (`ticketTemplate`)
     - Mẫu danh mục phương tiện (`vehicleTemplate`)
     - Mẫu bảng kê đối tác (`partnerTemplate`)
     - Mẫu giá dầu theo kỳ (`fuelTemplate`)
     - Hỗ trợ xuất mẫu Excel tùy biến theo cấu hình ghép cột của người dùng (`configuredTicketTemplate`).

2. **Xử Lý Ngày & Giờ Linh Hoạt Khi Nhập Dữ Liệu**:
   - Nâng cấp bộ phân tích `parseClock` hiểu mọi định dạng giờ phổ biến:
     - Chuỗi tiếng Việt: `8h30`, `08h30p`, `8g30`, `14h45`
     - Chuẩn 12 giờ: `8:30 AM`, `02:15 PM`
     - Chuẩn 24 giờ: `08:30`, `14:30:45`
     - Số thập phân ngày của Excel: `0.5` $\rightarrow$ `12:00:00`
   - Ghép tự động ngày cân và giờ cân thành mốc datetime chuẩn ISO khi người dùng tách riêng cột Ngày và cột Giờ trong file Excel gốc.

3. **Giao Diện UI Tạo Mẫu & Nhập Liệu Trực Quan**:
   - Thêm cột `Mẫu dòng 1` trong bảng ghép cột để người dùng nhìn thấy ngay giá trị thực tế của dòng đầu tiên khi chọn cột nguồn.
   - Thêm hộp gợi ý quy tắc ghép ngày giờ và khối lượng rõ ràng ở Bước 2.
   - Hiển thị ngày giờ đã ghép hoàn chỉnh tại bảng đọc thử ở Bước 3.
   - Thanh công cụ tải nhanh 4 file mẫu chuẩn Doanh nghiệp tại màn hình Import và màn hình Quản lý mẫu.

---

## 2. KẾT QUẢ KIỂM THỬ KỸ THUẬT (TEST SUITE)

- **Kiểm thử tự động toàn diện:** `node --test tests/*.test.js`
  - **Kết quả:** **253 / 253 bài test ĐẠT (100% PASS)**
  - Bao gồm 2 test suite mới: `tests/corporate-templates.test.js` và `tests/datetime-parsing.test.js`.
- **Khớp số liệu kế toán thực tế mẫu V.47:** `node scripts/validate-sample.js tests/fixtures/sample-v47.xlsx`
  - Số phiếu cân: **2.035 / 2.035** (Khớp 100%)
  - Tổng khối lượng: **38.563,89 tấn** (Khớp 100%)
  - Tổng cước vận chuyển: **5.512.904.418 đ** (Khớp 100%)

---

## 3. KẾT QUẢ NGHIỆM THU BỘ CÀI WINDOWS THỰC TẾ (SMOKE ACCEPTANCE)

Kịch bản nghiệm thu tự động `scripts/accept-windows.ps1` đã chạy và kiểm tra 7 trường hợp chạy thực tế trên Windows:

| STT | Trường hợp kiểm thử | Thư mục dữ liệu | Schema | Số phiếu nạp | Kết quả |
| :---: | :--- | :--- | :---: | :---: | :---: |
| 1 | `cai-moi-mac-dinh` | `%APPDATA%\VCCost` | Schema 9 | 2.035 | **ĐẠT (PASS)** |
| 2 | `nang-cap-tu-v4` | `%APPDATA%\VCCost` (Migrate v4 $\rightarrow$ v9) | Schema 9 | 3 | **ĐẠT (PASS)** |
| 3 | `nang-cap-tu-v6` | `%APPDATA%\VCCost` (Migrate v6 $\rightarrow$ v9) | Schema 9 | 3 | **ĐẠT (PASS)** |
| 4 | `nang-cap-tu-v7` | `%APPDATA%\VCCost` (Migrate v7 $\rightarrow$ v9) | Schema 9 | 3 | **ĐẠT (PASS)** |
| 5 | `nang-cap-tu-v8` | `%APPDATA%\VCCost` (Migrate v8 $\rightarrow$ v9) | Schema 9 | 3 | **ĐẠT (PASS)** |
| 6 | `thu-muc-tuy-chinh` | Thư mục ngoài `%APPDATA%` do người dùng chọn | Schema 9 | 2.035 | **ĐẠT (PASS)** |
| 7 | `portable-mac-dinh` | Bản Portable tự tạo dữ liệu độc lập `VCCost-data` | Schema 9 | 2.035 | **ĐẠT (PASS)** |

- Toàn bộ các chức năng nạp dữ liệu, xuất Excel/PDF, tạo backup an toàn (`PRE_MIGRATION`), kiểm tra toàn vẹn CSDL SQLite đều đạt chuẩn 100%.

---

## 4. DANH SÁCH BỘ CÀI & MÃ BĂM XÁC THỰC (SHA-256)

Các tệp phát hành chính thức nằm tại thư mục `dist/`:

| Tên tệp phát hành | Kích thước | Mã băm SHA-256 |
| :--- | :---: | :--- |
| **`VC-Cost-0.8.10-Setup.exe`** | 127.752.225 bytes (~121.8 MB) | `d2183e5efcfa2eebe598dfc954f312e02367478fe79cd4d75a9bf3a596b242cb` |
| **`VC-Cost-0.8.10-Portable.exe`** | 115.565.483 bytes (~110.2 MB) | `e4460a9d6494c91542e1c2f11facb796ff1a70a2998a6e682d6853c9f0bf603f` |

*(File lưu trữ mã băm xác thực: `dist/SHA256SUMS.txt`)*

---

## 5. KẾT LUẬN

Phiên bản **VC Cost 0.8.10** đã hoàn thiện toàn diện, đáp ứng đầy đủ yêu cầu về thẩm mỹ chuyên nghiệp chuẩn Doanh nghiệp cho các mẫu Excel, tính chính xác và linh hoạt trong ghép trường ngày giờ, và vượt qua 100% các tiêu chuẩn kiểm thử kỹ thuật lẫn nghiệm thu bộ cài thực tế trên Windows.

Bộ cài đã sẵn sàng để bàn giao và đưa vào sử dụng thực tế.
