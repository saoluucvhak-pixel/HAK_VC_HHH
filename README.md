# VC Cost — Quản lý · Tính toán · Đối chiếu chi phí vận chuyển (offline)

Phiên bản **0.6.17** — ứng dụng desktop (Electron, chạy offline, dữ liệu SQLite cục bộ) cho HAK Group: import phiếu cân, tính cước vận chuyển, lập Bảng kê, chốt kỳ, đối chiếu với đối tác. Engine tính giá được kiểm chứng khớp với file Excel mẫu PRINCE OF NATURE V.47 (`docs/EXCEL_VS_APP_VALIDATION.md`).

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
- **Sao lưu / khôi phục**, đổi thư mục lưu dữ liệu (Portable cạnh `.exe`, Setup ở `%APPDATA%/VCCost`).

## Chạy thử (cần Node.js ≥ 22.5)
```bash
npm install
npm test                                           # unit + integration test (68)
npm run test:ui                                    # smoke test giao diện (cần Chromium cho Playwright)
npm run validate -- tests/fixtures/sample-v47.xlsx # so engine với Excel → docs/EXCEL_VS_APP_VALIDATION.md
npm run dev                                        # chạy giao diện trong trình duyệt (dev server, không cần Electron)
```
Đóng gói Windows: `npm run dist:win` (portable + NSIS) hoặc `npm run dist:setup`. Bộ cài chia phần nằm trong `setup/` (xem `setup/HUONG_DAN.md`).

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
tools/          dev-server.js (bản dùng cho `npm run dev`)
tests/          *.test.js, ui-smoke.mjs, fixtures/
docs/           tài liệu dự án
setup/          bộ cài Windows chia phần + hướng dẫn
```

## Nguyên tắc
Không hard-code biển số, đơn vị, nơi xuất, đơn giá, VAT, giá dầu, km, 19 tấn, 35 L/100km · không sửa dữ liệu nguồn âm thầm · không tự xóa trùng · không tự gán xe · không tự chọn bảng giá khi xung đột · không tính lại chứng từ đã chốt khi chưa mở khóa.

## Lưu ý
- Thư viện `xlsx` (SheetJS 0.18.5) có cảnh báo bảo mật (ReDoS, prototype pollution) và chưa có bản vá trên npm — chỉ import file Excel từ nguồn tin cậy.
- Bộ cài `.exe` chưa ký số nên Windows SmartScreen có thể cảnh báo.
