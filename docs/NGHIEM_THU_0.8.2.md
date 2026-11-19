# Biên bản nghiệm thu VC Cost 0.8.2 (schema 8)

- Nền: `main` @ `62723ab` (app 0.8.1, schema 7, `npm test` 177/177). Nhánh làm việc: `claude/vc-cost-0.8.2`.
- Môi trường: Linux, Node 22, node:sqlite + better-sqlite3 13.2, Chromium/Playwright (UI smoke).
- Dữ liệu kiểm tra: SQLite thử + fixture V.47 (2.035 phiếu) + DB schema 7 tạo bằng `scripts/make-old-db.js`. Không dùng dữ liệu thật.
- Số test: **trước 177 → sau 200** (node:sqlite) và 200 (better-sqlite3). `npm run test:ui` thêm 6 khối kiểm tra mới, kết quả `errors: none`.

## 1. Ma trận lỗi → sửa → test

| # | Lỗi | Cách tái hiện | Sửa ở (file:dòng) | Test chứng minh | Kết quả |
|---|---|---|---|---|---|
| P0 | Vai trò NHAP tạo/sửa/xóa được `bang_gia_van_chuyen` và `gia_dau` qua `catalog.*`, làm đổi tổng tiền phiếu | Bật phân quyền, đăng nhập NHAP, `catalog.create {table:'bang_gia_van_chuyen', tu_ngay:'2020-01-01', don_gia_goc:…}` → `ok:true`, recalc đổi tổng tiền | `src/utils/permissions.js:32,36` (`TABLE_PERM`, `permissionFor(channel,args)`), `src/runtime.js:68` | `tests/phan-quyen-bang-gia.test.js` #1–#3 (NHAP → `Forbidden`, tổng tiền không đổi; DUYET/ADMIN được; TẮT phân quyền như cũ; bảng khác NHAP vẫn được) | Đạt |
| P1-a | Bảng giá sửa trực tiếp được mọi thông số (bỏ qua "Phiên bản giá mới") | `catalog.update {table:'bang_gia_van_chuyen', data:{don_gia_goc:1}}` thành công | `src/ipc/handlers.js:96,101` (chặn create; update chỉ nhận `ghi_chu`/`trang_thai`); `renderer/views/catalog.js:57` (cửa sổ sửa chỉ còn 2 ô) | `phan-quyen-bang-gia.test.js` #4; `tests/ui-smoke.mjs` ("sửa bảng giá không còn ô đơn giá/VAT") | Đạt |
| P1-b | "Áp dụng" bảng tính đơn giá và "Duyệt kỳ giá dầu" ghi ngay, không cho thấy tuyến/ngày/số phiếu bị ảnh hưởng | Bấm Áp dụng → tạo bảng giá mới, tính lại phiếu mà không xem trước | `src/services/PriceService.js:36,48` (`_impact`, `previewApplySheet`), `src/ipc/handlers.js:187` (`price.previewApply`), `renderer/views/catalog.js` (modal xem trước + xác nhận) | `phan-quyen-bang-gia.test.js` #5–#6 (có `dong_gia_cu_den`, `mo_gia_moi_tu`, `so_phieu_tinh_lai`; xem trước không ghi dữ liệu); UI smoke ("xem trước có cột Phiếu tính lại / Đóng giá cũ đến") | Đạt |
| P1-c | Giá dầu: "+ Thêm giá" và "Import" khác mức quyền | `fuel.importPreview` quyền *nhập* trong khi `importCommit` *duyệt* | `src/utils/permissions.js` (`fuel.importPreview` → duyệt; `catalog.*` gia_dau → duyệt) | `phan-quyen-bang-gia.test.js` #7 | Đạt |
| P1-d | Nút Duyệt phiếu luôn ẩn khi bật phân quyền: `App.can('tickets.approve')` (tên kênh, không phải tên quyền) | Bật phân quyền + duyệt phiếu, đăng nhập DUYET → không thấy `[data-act=approve-selected]` | `renderer/views/tickets.js:77` (`App.can('duyet')`); `renderer/app.js:234` (`can()` cảnh báo chuỗi lạ), `:245` (`ACTION_CHANNEL`), `src/ipc/handlers.js:42` (`auth.status` trả `channelPerm/tablePerm`); `confirmBox` truyền đủ (title, text, okLabel) | `tests/ui-smoke.mjs` ("vai trò": DUYET thấy nút duyệt, NHAP không thấy, XEM không thấy nút ghi, `__canWarnings` rỗng, `can('tickets.approve')` → false + cảnh báo); `phan-quyen-bang-gia.test.js` #8. Đã chạy thử đột biến: trả lại lỗi cũ thì UI smoke đỏ | Đạt |
| P1-e | Chế độ 1 người + phân quyền + duyệt phiếu: phiếu kẹt ở Nháp (người nhập không tự duyệt) | 1 admin, bật duyệt phiếu, sửa phiếu → `tickets.approve` bị từ chối mãi | `src/utils/duyet.js:10` (`ConfirmRequired`, `soNguoiDuyet`, `duyetTuDuyet`); `src/ipc/handlers.js:74,260` (cảnh báo khi bật/khóa/hạ quyền làm còn < 2 người); `src/services/TicketService.js:135,140` (`cho_tu_duyet`, audit `tu_duyet`); `ReportService.tickets` (`tu_duyet`); `renderer` (ô cài đặt, `callConfirm`, nhãn "Tự duyệt"); README | `tests/duyet-mot-nguoi.test.js` #1–#5 (từ chối kèm hướng dẫn; `cho_tu_duyet=true` duyệt được, audit `tu_duyet:true`; `ConfirmRequired` khi bật/khóa/hạ quyền; TẮT phân quyền không cảnh báo) | Đạt |
| P2-a | `import.pending` có 2 dòng cho cùng phiếu khi nhập 2 lần cùng dòng xung đột | Nhập cùng file xung đột 2 lần | `src/services/TicketImportService.js:163,250,274,314` (`PENDING_ALREADY`, `_pendingSame` kiểm lại trong transaction, `pendingGroups`); `src/database/migrations/008_pending_already.sql`; `renderer/views/import.js` (chip riêng, nhóm k/n) | `tests/import-pending-trung.test.js` #1–#3 (1 dòng chờ, SKIP kèm "lô #x", không mở thêm cảnh báo; số liệu khác → 2 dòng cùng nhóm; hai bản xem trước commit lần lượt không tạo trùng); `tests/migration.test.js` (nâng từ v7); UI smoke ("2 dòng cùng phiếu 1/2, 2/2") | Đạt |
| P2-b | Cha–con: xóa dòng con không hỏi; đóng bằng click nền không làm mới bảng cha; tiêu đề không có đường dẫn; thêm/sửa không làm mới cột tổng hợp của cha | Mở "Chi tiết" của Xe → Xóa dòng con | `renderer/views/catalog.js:111` (`crumb`, `afterChange`, `onClose: load`, `confirmBox`) | UI smoke ("cha–con": tiêu đề `Xe … › Lịch sử đơn vị`; Hủy xác nhận không xóa; click nền → `catalog.list table=xe`). Đột biến: bỏ `onClose` thì test đỏ | Đạt |
| P2-c | Hộp thoại lưu luôn lọc `.xlsx` | Xuất PDF → hộp thoại hiện Excel | `electron/save-filters.js` + `electron/main.js:216` | `tests/sao-luu-hen-gio.test.js` #6 | Đạt (logic); **chưa** kiểm tay trên Electron thật |
| P2-d | App mở qua đêm không có bản AUTO mới | Mở app, chờ qua ngày | `src/runtime.js:57` (hẹn giờ 60 phút, `try/catch`, dừng trong `rt.close`) | `sao-luu-hen-gio.test.js` #1–#2 (chu kỳ 30 ms; đồng hồ nhảy 26 giờ → thêm bản AUTO; lỗi `autoDaily` được ghi log, không văng) | Đạt |
| P2-e | Không nhắc xuất sao lưu ra ổ khác | — | `src/services/BackupService.js:112,117`, `SettingsService` (`backup_export_last`, `remindExportDays`), `renderer/views/system.js` | `sao-luu-hen-gio.test.js` #3; UI smoke ("backup: chưa từng xuất thì nhắc") | Đạt |
| P2-f | Phiên xem trước import không bao giờ bị dọn | Mở nhiều file mà không commit/hủy | `src/services/TicketImportService.js:37` (`_prune`, TTL 2 giờ) | `sao-luu-hen-gio.test.js` #4 | Đạt |
| P2-g | Commit import lỗi sau PRE_IMPORT: không ghi rõ bản PRE_IMPORT không được dùng; cần giữ chặn khi sao lưu lỗi | — | `src/ipc/handlers.js:116` | `sao-luu-hen-gio.test.js` #5 (log + sao lưu lỗi vẫn chặn import, không ghi phiếu) | Đạt |

## 2. Rà quyền các kênh ghi dữ liệu (nguồn: `src/utils/permissions.js`)

Danh sách kênh ghi theo mức quyền sau 0.8.2 (đã rà từng kênh, đánh dấu những kênh ảnh hưởng tới tiền):

- **Duyệt (15)**: `tickets.approve`, `import.resolve`, `import.resolveMany`, `import.undo`, `lock.create`, `lock.unlock`, `recon.resolve`, `recon.weight`, `price.approveFuel`, `price.removeFuelPeriod`, `price.remove`, `price.createVersion`, `price.applySheet`, `fuel.importPreview` *(mới nâng)*, `fuel.importCommit`. Ảnh hưởng tiền: giá (`price.*`), giá dầu (`fuel.*`), chốt kỳ (`lock.*`), duyệt/xử lý xung đột (`tickets.approve`, `import.resolve*`, `import.undo`).
- **Quyền theo bảng (mới)**: `catalog.create/update/remove` → *Duyệt* với `bang_gia_van_chuyen`, `gia_dau`; *Nhập* với `don_vi_van_chuyen`, `hop_dong`, `xe`, `xe_don_vi_lich_su`, `dia_diem`, `dia_diem_alias`, `tuyen_van_chuyen`, `dot_van_chuyen`.
- **Nhập (24)**: `cost.recalc`, `alerts.setStatus`, `catalog.*` (bảng ngoài giá), `import.open/check/sheetInfo/preview/previewRows/commit/issuesXlsx/cancel`, `vehicles.importPreview/importCommit`, `tickets.update/remove`, `recon.open/sheetInfo/run`, `price.previewFuel` (xem trước), `price.createFuelPeriod` (chỉ tạo kỳ ở trạng thái Nháp, chưa áp giá — áp giá cần `price.approveFuel` = Duyệt), `backup.now/export`.
- **Quản trị (9)**: `settings.set`, `seed.loadSample`, `initial.load`, `backup.restore`, `auth.*` quản lý người dùng.

Kết luận rà quyền: không còn đường nào ghi trực tiếp vào bảng giá/giá dầu bằng quyền *Nhập*. `tickets.update` không nhận đơn giá/tiền (chỉ ngày giờ, cân, biển số, đợt, loại hàng…), nên không đổi giá trực tiếp.

## 3. Rủi ro còn lại / việc chưa làm (không giấu)

1. **Bảng quyền theo bảng chỉ nâng 2 bảng theo yêu cầu.** Một số bảng ở mức *Nhập* vẫn có thể làm đổi tổng tiền gián tiếp: `xe_don_vi_lich_su` (đổi đơn vị vận chuyển của xe theo ngày → chọn bảng giá riêng đơn vị), `tuyen_van_chuyen` (km dùng trong công thức giá dầu), `dia_diem_alias` (nơi xuất → tuyến → giá), `dot_van_chuyen`. Cần chủ sản phẩm quyết định có nâng các bảng này lên *Duyệt* hay không (một dòng trong `TABLE_PERM`).
2. **Xem trước ở "Áp dụng"/"Duyệt kỳ dầu" là bước giao diện bắt buộc**, không phải ràng buộc phía máy chủ (gọi thẳng `price.applySheet` vẫn chạy nếu có quyền *Duyệt*). Đã giữ vậy để không phá API/test cũ.
3. **Mốc "xuất ra ổ khác"** ghi theo giờ UTC và chỉ biết đã xuất thành công ra *thư mục khác thư mục sao lưu*, không kiểm tra thư mục đó có thật sự là ổ rời.
4. **Hộp thoại lưu theo đuôi file** (Electron) mới kiểm bằng test hàm thuần và đọc mã; chưa bấm tay trên bản đóng gói.
5. **Chưa chạy trên dữ liệu thật**, chưa kiểm tay trên máy Windows thật; nghiệm thu bộ cài (Setup/Portable, nâng từ DB v4/v6/**v7**) dùng workflow CI và được ghi ở mục 4 sau khi chạy.
6. Bộ cài vẫn **chưa ký số**, icon Electron mặc định (không thuộc phạm vi đợt này).
7. Migration 008 dựng lại bảng `import_batch_row` (DROP + RENAME). Đã kiểm: không có khóa ngoại/view/trigger tham chiếu tới bảng này, giữ nguyên `id` và dữ liệu, có `PRAGMA foreign_key_check` sạch và `PRE_MIGRATION` tự động; chưa thử trên DB rất lớn (hàng triệu dòng nguồn).

## 4. Kết quả kiểm thử đã chạy

| Hạng mục | Kết quả |
|---|---|
| `npm test` (node:sqlite) | 200/200 đạt (trước: 177) |
| `VCCOST_DRIVER=better-sqlite3 npm test` | 200/200 đạt |
| `npm run test:ui` | `errors: none` (thêm: sửa bảng giá hạn chế, xem trước áp dụng, vai trò DUYET/NHAP/XEM, tự duyệt, hàng chờ nhóm, cha–con, nhắc xuất sao lưu) |
| Nâng DB v7 → v8 (cục bộ, qua `createRuntime`) | schema 8, 3 phiếu giữ nguyên, có `PRE_MIGRATION`, integrity `ok` |
| Nghiệm thu bộ cài Windows (CI) | xem mục 5 |

## 5. Nghiệm thu bộ cài Windows

Run [44456764322](https://github.com/saoluucvhak-pixel/HAK_VC_HHH/actions/runs/44456764322) (`workflow_dispatch`, `installers=true`) trên commit `20454e5`, kết luận **thành công**: cài gói, test Windows (node:sqlite và better-sqlite3), đóng gói, **kiểm thử giao diện trên Windows**, khởi động thử bản đóng gói, build Setup + Portable, SHA-256, nghiệm thu bộ cài. Đồng thời CI Linux (#65) và Windows theo PR (#73) trên cùng commit đều thành công.

| Ca | Thư mục dữ liệu | Schema | Phiếu | Ghi chú |
|---|---|---:|---:|---|
| Cài mới (Setup, mặc định) | `%APPDATA%\VCCost` | 8 | 2.035 | migration 001→008 |
| Nâng từ v4 | `%APPDATA%\VCCost` | 8 | 3 | 4 → 8 (005–008), có `PRE_MIGRATION` |
| Nâng từ v6 | `%APPDATA%\VCCost` | 8 | 3 | 6 → 8 (007, 008), có `PRE_MIGRATION` |
| **Nâng từ v7** | `%APPDATA%\VCCost` | 8 | 3 | 7 → 8 (chỉ 008), có `PRE_MIGRATION` |
| Thư mục dữ liệu tùy chỉnh | `D:\a\_temp\du-lieu-tuy-chinh` | 8 | 2.035 | migration 001→008 |
| Portable | `…\portable-test\VCCost-data` | 8 | 2.035 | migration 001→008 |

Cả 6 ca: `version=0.8.2`, `driver=better-sqlite3`, `electron=45.3.3`, `problems=[]`, integrity `ok` (0 lỗi). Các ca có dữ liệu V.47 còn cho: PDF `%PDF-` (404.845 byte), Excel `PK`, sao lưu → khôi phục an toàn (2.035 → 2.035), import lại 2.035 phiếu = trùng hoàn toàn / 0 ghi mới, chốt kỳ 1.046 phiếu, kiểm tra duyệt phiếu (`draftTripsInStatement=0`, `draftVisible=1`, `approved=1`).

SHA-256 các tệp của run này (commit `20454e5`):
```
fcc74c2d157d219357067c1296790f79af4821c33e9a759b7e2587e70c573246  VC-Cost-0.8.2-Portable.exe
c8caf3eedbce64df56f42ebc6a7964a30c89a5870a6a7b5926121854f372fffe  VC-Cost-0.8.2-Setup.exe
```
Lưu ý: nếu PR được gộp bằng squash, commit trên `main` sẽ khác `20454e5`; bản phát hành chính thức phải được build và nghiệm thu lại trên commit của `main` rồi dùng đúng các tệp của run đó (cùng quy trình 0.8.0).

## 6. Kết luận

**Bàn giao có điều kiện.** Căn cứ: 200/200 test hai driver, UI smoke (cả bản Windows), integrity 0 lỗi, run bộ cài đạt 6/6 ca nghiệm thu kể cả nâng từ v7. Điều kiện: (a) nghiệm thu lại bộ cài trên commit `main` sau khi gộp và phát hành đúng các tệp đó; (b) chủ sản phẩm quyết định các bảng còn ở mức *Nhập* (mục 3.1) và chấp nhận các rủi ro còn lại ở mục 3 (chưa chạy dữ liệu thật, chưa kiểm tay trên Windows thật và hộp thoại lưu của Electron, chưa ký số, icon mặc định). Chưa phát hành: chờ bạn duyệt biên bản và xác nhận.
