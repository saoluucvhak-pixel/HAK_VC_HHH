# Ký số bộ cài VC Cost (Windows)

Hiện bộ cài **chưa ký số** nên Windows SmartScreen có thể cảnh báo "Unknown publisher". Việc ký cần chứng thư số mua từ nhà cung cấp (không tạo được trong repo).

## Cần chuẩn bị
- Chứng thư **Code Signing** (OV hoặc EV) xuất ra file `.pfx` kèm mật khẩu, hoặc dùng dịch vụ ký đám mây của nhà cung cấp.
- EV xóa cảnh báo SmartScreen ngay; OV cần một thời gian uy tín tích lũy.

## Cách bật (khi đã có chứng thư)
1. Trong `package.json`, mục `build.win`: đổi `"signAndEditExecutable": false` → `true` (hoặc dùng `"signExecutable": false` nếu chỉ muốn nhúng biểu tượng/metadata mà chưa ký), bỏ `"forceCodeSigning": false` nếu muốn bắt buộc ký.
2. Cung cấp chứng thư cho electron-builder qua biến môi trường (không commit vào repo):
   - `CSC_LINK` = đường dẫn file `.pfx` (hoặc nội dung base64)
   - `CSC_KEY_PASSWORD` = mật khẩu chứng thư
3. CI: lưu hai giá trị trên thành **secrets** của repo rồi truyền vào bước build của `.github/workflows/windows.yml` (`env: CSC_LINK: ${{ secrets.CSC_LINK }}`...). Không in giá trị ra log.
4. Build: `npm run dist:win` → kiểm tra bằng `Get-AuthenticodeSignature .\dist\VC-Cost-<ver>-Setup.exe` (Status = Valid).

## Lưu ý
- Smoke của CI khởi động bản đóng gói `win-unpacked`; sau khi bật ký số hãy chạy lại workflow Windows để chắc chắn bản ký vẫn khởi động được.
- Mã nguồn không chứa khóa/chứng thư; nếu lộ chứng thư phải thu hồi ngay tại nhà cung cấp.
