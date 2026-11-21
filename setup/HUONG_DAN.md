# Cài đặt VC Cost (Windows)

Bộ cài **không còn nằm trong mã nguồn**. Các bản đã nghiệm thu được đăng ở trang **Releases** của kho này, kèm tệp `SHA256SUMS.txt`:

https://github.com/saoluucvhak-pixel/HAK_VC_HHH/releases

## Chọn bản
- **Setup** (`VC-Cost-<phiên bản>-Setup.exe`): cài theo người dùng, dữ liệu ở `%APPDATA%\VCCost`. Nên dùng cho máy làm việc hằng ngày.
- **Portable** (`VC-Cost-<phiên bản>-Portable.exe`): không cần cài, dữ liệu nằm cạnh tệp `.exe` trong thư mục `VCCost-data`.

## Các bước
1. Mở trang Releases, chọn bản mới nhất, tải `Setup` (hoặc `Portable`) và `SHA256SUMS.txt` về cùng một thư mục.
2. Kiểm tra tệp tải về nguyên vẹn (PowerShell, chạy trong thư mục đã tải):
   ```powershell
   Get-FileHash .\VC-Cost-*-Setup.exe -Algorithm SHA256
   Get-Content .\SHA256SUMS.txt
   ```
   Giá trị SHA-256 của tệp phải trùng đúng dòng tương ứng trong `SHA256SUMS.txt`. Nếu khác, đừng chạy tệp và tải lại.
3. Chạy tệp đã kiểm tra. Windows có thể hiện cảnh báo SmartScreen vì bộ cài chưa ký số: chọn "Thông tin thêm" → "Vẫn chạy".
4. Lần mở đầu trên dữ liệu cũ, phần mềm tự tạo bản sao lưu `PRE_MIGRATION` trong thư mục `backups` rồi nâng cấp CSDL.

## Nâng cấp từ bản cũ
Trong bản cũ, tạo bản sao lưu và xuất ra thư mục riêng (màn *Backup & khôi phục* → *Xuất ra…*), đóng ứng dụng, rồi cài đè bản mới. Dữ liệu được giữ nguyên.

## Tự đóng gói
Nhà phát triển có thể tạo bộ cài từ mã nguồn bằng `npm run dist:win` hoặc `python installer/make-setup.py <phiên bản>`. Bản phát hành chính thức luôn là bản đã chạy qua workflow nghiệm thu trên CI.
