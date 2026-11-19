# VC Cost — Quản lý · Tính toán · Đối chiếu chi phí vận chuyển (offline)

Phiên bản **0.8.3** (schema 8) — ứng dụng desktop (Electron, chạy offline, dữ liệu SQLite cục bộ) cho HAK Group: import phiếu cân, tính cước vận chuyển, lập Bảng kê, chốt kỳ, đối chiếu với đối tác. Engine tính giá được kiểm chứng khớp với file Excel mẫu PRINCE OF NATURE V.47 (`docs/EXCEL_VS_APP_VALIDATION.md`).

Lịch sử thay đổi: `CHANGELOG.md`.

## Đọc gì trước
1. `docs/PHAN_TICH_THIET_KE_A-H.md` — phân tích file Excel + thiết kế A→H + các câu hỏi đã chốt (mục A.8).
2. `docs/EXCEL_VS_APP_VALIDATION.md` — kết quả engine so với Excel.
3. Các đặc tả: `docs/BUSINESS_RULES.md`, `DATABASE_SCHEMA.md`, `IMPORT_SPEC.md`, `PRICE_ENGINE_SPEC.md`, `RECONCILIATION_SPEC.md`, `UI_SPEC.md`, `TEST_PLAN.md`, `TODO_ROADMAP.md`.

## Chức năng chính
- **Import phiếu cân** (Excel/CSV, có file mẫu): tự dò header, xem trước, chống trùng, hoàn tác theo lô. KL hàng phải khớp |Cân 1 − Cân 2|, nếu lệch dòng bị chặn.
- **Danh mục**: xe (lịch sử xe → đơn vị theo ngày), đơn vị vận chuyển, địa điểm, tuyến, đợt/tàu, bảng giá, kỳ điều chỉnh giá dầu.
- **Tính giá** (`TransportCostEngine`): nơi duy nhất tính tiền; giao diện chỉ hiển thị.
- **Bảng kê / biểu mẫu**: Bảng kê từng đơn vị, Tổng hợp tàu, Chi tiết vận chuyển, Bảng tính đơn giá — xuất PDF và Excel.
- **Chốt kỳ**: khóa số liệu theo khoảng ngày hoặc đợt/tàu; mở khóa bắt buộc có lý do, có nhật ký.
- **Đối chiếu** với file đối tác (khớp / lệch KL / lệch đơn giá / thiếu bên).
- **Cảnh báo & nhật ký**: bất thường thời gian cân, thiếu xe/giá/địa điểm; audit log.
- **Duyệt từng phiếu (tùy chọn, mặc định tắt)**: Cài đặt → bật; phiếu mới/vừa sửa là Nháp, chỉ vào Dashboard, Bảng kê, báo cáo, đối chiếu, chốt kỳ sau khi được duyệt (duyệt theo lô, kèm phiên bản phiếu; người nhập/sửa không tự duyệt khi bật phân quyền).
- **Hai chế độ làm việc** (phân quyền + duyệt phiếu):
  1. **1 người dùng** (mặc định): không đăng nhập, mọi thao tác như cũ. Nếu bật *Duyệt từng phiếu* ở chế độ này không có người dùng nào để tách nhập/duyệt nên bạn duyệt trực tiếp. Nếu bật phân quyền nhưng chỉ có MỘT người có quyền duyệt (thường là Quản trị), hãy bật *Cài đặt → Duyệt từng phiếu → Cho phép tự duyệt*; nếu không, phiếu do chính người đó nhập/sửa sẽ kẹt ở Nháp. Phiếu tự duyệt ghi nhật ký `APPROVE_TICKET {tu_duyet: true}` và hiện nhãn "Tự duyệt".
  2. **Nhiều người, tách nhập/duyệt**: bật phân quyền, tạo ít nhất 2 người có quyền duyệt (Người duyệt/Quản trị), để *Cho phép tự duyệt* TẮT. Người nhập/sửa phiếu không tự duyệt phiếu của mình. Khi bật duyệt phiếu, hoặc khóa/hạ quyền làm số người có quyền duyệt còn dưới 2, phần mềm cảnh báo và hỏi xác nhận.
- **Quyền theo bảng**: bảng giá và giá dầu cần quyền *Duyệt* (cùng mức với "Phiên bản giá mới" và import giá dầu); các danh mục khác cần quyền *Nhập*. Thông số bảng giá chỉ đổi qua "Phiên bản giá mới" (có xem trước tác động); cửa sổ sửa chỉ còn ghi chú và trạng thái.
- **Phân quyền (tùy chọn)**: mặc định 1 người dùng, không đăng nhập. Menu *Người dùng & phân quyền* để bật: Quản trị (toàn quyền, người dùng, cài đặt, khôi phục) · Người duyệt (duyệt xung đột/hoàn tác import, chốt/mở khóa kỳ, bảng giá, đối chiếu) · Người nhập liệu (import, sửa/xóa phiếu, danh mục, sao lưu) · Chỉ xem (xem + xuất báo cáo). Nhật ký ghi tên đăng nhập; phiên hết hạn sau 30 phút không hoạt động; sai mật khẩu 5 lần khóa 60 giây. Quên mật khẩu quản trị: chạy ứng dụng với biến môi trường `VCCOST_RESET_AUTH=1` một lần (cần quyền truy cập máy) để tắt phân quyền rồi bật lại.
- **Sao lưu / khôi phục**, đổi thư mục lưu dữ liệu (Portable cạnh `.exe`, Setup ở `%APPDATA%/VCCost`).

## Chạy thử (cần Node.js ≥ 22.5)
```bash
npm install
npm test                                           # unit + integration test (145); VCCOST_DRIVER=better-sqlite3 npm test để chạy bằng driver của bản đóng gói
npm run test:ui                                    # smoke test giao diện (cần Chromium cho Playwright)
npm run validate -- tests/fixtures/sample-v47.xlsx # so engine với Excel → docs/EXCEL_VS_APP_VALIDATION.md
npm run dev                                        # chạy giao diện trong trình duyệt (dev server, không cần Electron)
```
Đóng gói Windows: `npm run dist:win` (portable + NSIS) hoặc `npm run dist:setup`. CI Windows (`.github/workflows/windows.yml`) tự build `win-unpacked` và khởi động thử; chạy tay workflow và tick "installers" để lấy bộ cài Portable/Setup. Kiểm tra khởi động cục bộ: `VCCOST_SMOKE=1 VCCOST_SMOKE_OUT=smoke.json VCCOST_DATA_DIR=<thư mục tạm> npx electron .` (thoát 0 = đạt). Bộ cài chia phần nằm trong `setup/` (xem `setup/HUONG_DAN.md`).

## Cấu trúc
```
electron/       main.js, preload.js (cửa sổ cách ly, CSP, chặn điều hướng ra ngoài)
renderer/       giao diện (app.js, views/*)
src/database/   connection (node:sqlite / better-sqlite3), migrator, migrations/
src/services/   Cost/Price/Fuel/Vehicle resolver, TransportCostEngine, Ticket(Import), ChotKy,
                Reconciliation, Report, Statement, Backup, Alert, Audit ...
src/excel/      columnMapping (dò header, từ đồng nghĩa), ticketParser, templates, exporters, forms
src/print/      biểu mẫu HTML → PDF
src/ipc/        handlers.js — bảng kênh API duy nhất giữa giao diện và backend
src/utils/      money (Decimal, làm tròn kiểu Excel), plate (biển số), datetime
data/seed/      sample-v47.json — danh mục & bảng giá rút từ file mẫu (dữ liệu, không phải code)
scripts/        validate-sample.js
tools/          dev-server.js (dùng cho `npm run dev`)
tests/          *.test.js, ui-smoke.mjs, fixtures/
docs/           tài liệu dự án
setup/          bộ cài Windows chia phần + hướng dẫn
```

## Nguyên tắc
Không hard-code biển số, đơn vị, nơi xuất, đơn giá, VAT, giá dầu, km, 19 tấn, 35 L/100km · không sửa dữ liệu nguồn âm thầm · không tự xóa trùng · không tự gán xe · không tự chọn bảng giá khi xung đột · không tính lại chứng từ đã chốt khi chưa mở khóa.

## Lưu ý
- Import đọc được `.xlsx` và `.csv`. File `.xls` cũ (Excel 97-2003) không còn được hỗ trợ — mở bằng Excel rồi "Lưu thành" `.xlsx`.
- Bộ cài `.exe` chưa ký số nên Windows SmartScreen có thể cảnh báo.
- `npm audit`: 0 cảnh báo (đã nâng `electron-builder` 26.18.1 và ép `minimatch` bản vá cho cây công cụ build bằng `overrides`; cây chạy thật của `exceljs` giữ nguyên). Ký số bộ cài: xem `docs/KY_SO_BO_CAI.md`.
