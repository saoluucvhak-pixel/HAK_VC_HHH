## VC Cost 0.7.0 (schema SQLite 6)

Ứng dụng Electron + SQLite chạy offline cho HAK. Bộ cài: **Setup** (cài theo người dùng, dữ liệu ở `%APPDATA%\VCCost`) và **Portable** (dữ liệu cạnh file `.exe`, thư mục `VCCost-data`). Bộ cài **chưa ký số** — Windows SmartScreen có thể cảnh báo; kiểm tra SHA-256 bên dưới trước khi cài.

### Điểm chính
- Phân quyền tùy chọn (mặc định 1 người dùng; bật được 4 vai trò, nhật ký ghi tên đăng nhập).
- Sao lưu `PRE_MIGRATION` nhất quán (kể cả giao dịch còn trong WAL), khôi phục an toàn có quay lui, xuất bản sao ra thư mục riêng.
- Toàn vẹn số liệu: hoàn tác không ghi đè, chống trùng lúc commit, chặn sửa/duyệt vào kỳ chốt và đợt khóa, xử lý hàng loạt có kết quả từng phiếu.
- Logic khối lượng: chặn KL sai đơn vị tấn/kg, đối chiếu tổng KL với dòng "Tổng cộng" của file, cảnh báo dữ liệu nằm dưới dòng tổng.
- Giao diện: chế độ Sáng/Tối, bộ lọc thông minh, "Việc cần làm" nêu phạm vi, phản hồi chậm không ghi đè màn đang mở.
- Kiểm tra toàn vẹn dữ liệu chỉ đọc (`npm run integrity`, nút ở màn Backup).
- Định dạng số theo chuẩn HAK; đối chiếu V.47: 2.035 phiếu, 38.563.700 kg, tổng bốn bảng kê 5.512.904.418 đ.

Chi tiết và biên bản nghiệm thu: `CHANGELOG.md`, `docs/NGHIEM_THU_0.7.0.md`.

### Nâng cấp từ bản cũ
1. Đóng VC Cost. Sao chép thư mục dữ liệu (`%APPDATA%\VCCost`, hoặc `VCCost-data` cạnh file Portable) ra nơi an toàn.
2. Chạy bộ cài mới (Setup cài đè; Portable chép file mới). Dữ liệu cũ được giữ.
3. Lần mở đầu, nếu CSDL cũ cần nâng cấp, ứng dụng tự tạo bản sao `PRE_MIGRATION` (màn **Backup**, nhãn "Trước nâng cấp") rồi mới nâng cấp. Nếu không tạo/kiểm tra được bản sao, ứng dụng **dừng và không nâng cấp**.

### Khôi phục khi nâng cấp lỗi
Mở màn **Backup** → chọn bản "Trước nâng cấp" → **Khôi phục** (ứng dụng tạo bản "Trước khôi phục" trước khi thay thế; lỗi thì tự quay về dữ liệu ban đầu). Quên mật khẩu quản trị khi đã bật phân quyền: chạy với biến môi trường `VCCOST_RESET_AUTH=1` một lần.

### Chưa có trong bản này
Ký số bộ cài; logo/icon thương hiệu riêng (đang dùng icon Electron mặc định); trạng thái Nháp → Duyệt từng phiếu.
