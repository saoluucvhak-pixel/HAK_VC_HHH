# CHANGELOG

## 0.8.9 — giao diện tạo mẫu Excel và ghép ngày giờ cân (schema 9)
- Chia trình tạo mẫu thành chọn tệp và tiêu đề, bảng ghép cột, đọc thử và đối chiếu.
- Đồng bộ tiêu đề ngày giờ cân và hỗ trợ tệp có ngày, giờ ở hai cột riêng.

## 0.8.8 — kiểm tra nhập và đối chiếu phiếu cân (schema 9)
- Chuẩn hóa kg/tấn khi đối chiếu. Dòng có dữ liệu lỗi hoặc mâu thuẫn biển số, ngày cân được đưa vào Cần kiểm tra.
- Dùng nơi đến trên từng dòng khi nhập. Nơi đến lạ được báo lỗi, ô trống dùng mặc định.
- Phát hiện mâu thuẫn đơn vị và đọc tổng công bố phía trên bảng. Xuất Excel theo mẫu đã lưu.
- Cho phép nạp lại dữ liệu ban đầu sau lỗi giữa chừng mà vẫn chống trùng.

## 0.8.7 — mẫu nhập Excel cho phiếu cân (schema 9)
- Quản lý mẫu nhập, ghép cột từ tiêu đề một hoặc hai dòng, đọc thử và đặt mặc định trong Cài đặt.
- Ghép theo tên tiêu đề khi cột đổi vị trí, đổi kg/tấn, giữ số 0 đầu của mã phiếu và đối chiếu tổng công bố.
- Lưu cấu hình đọc trên từng lô để đọc lại file nguồn theo cách đọc đã áp dụng.

## 0.8.6 — bảo toàn hồ sơ và Bảng kê đã chốt (schema 9)
- Bản sao lưu thủ công và tự động lưu cả SQLite lẫn tệp nguồn import.
- Cố định bên ký và hợp đồng tại thời điểm chốt.
- Đánh dấu Bảng kê lọc có phiếu đã chốt mang tính tham khảo trên màn hình, Excel và PDF.

## 0.8.5 — chốt kỳ và Bảng kê lịch sử (schema 9)
- Mở lại phần còn lại của đợt khi mở khóa chốt toàn đợt, kể cả khi một đơn vị còn lần chốt riêng.
- Áp dụng phạm vi đơn vị của kỳ ngày khi nhập, sửa, duyệt phiếu.
- Lưu Bảng kê khi chốt và dùng chung cho màn hình, Excel và PDF.
- Nghiệm thu nâng từ schema 8 và xuất lại Bảng kê từ bộ cài.

## 0.8.4 — rà soát toàn diện bằng agent + sửa lỗi (schema 8, không có migration)
- **An toàn tệp**: tên tệp sao chép khi import/xuất Excel được làm sạch và chốt trong thư mục đích (`safeFileName`, `joinInside`), chặn `..`/đường dẫn tuyệt đối.
- **Đọc Excel có giới hạn**: tệp > 50 MB, kích thước giải nén khai báo > 500 MB, sheet > 300.000 dòng / 256 cột / 8 triệu ô bị từ chối rõ ràng (chống zip bomb, ô ở XFD1048576).
- **Phân quyền**: `backup.export` chỉ vai trò Admin.
- **Chốt đợt theo một đơn vị**: chốt kỳ một phần nhà xe không còn khóa cả đợt vận chuyển.
- **Import**: xem trước cũ không còn âm thầm mất dữ liệu (kiểm tra lại dòng đích còn hiệu lực lúc ghi); trùng trong cùng tệp được nhận diện sau khi chuẩn hóa tên địa điểm theo bí danh.
- **Báo cáo nhất quán**: tiền chỉ cộng cho phiếu đã có giá; báo cáo theo nơi xuất không gộp các nơi chưa khớp danh mục.
- **Làm tròn**: đổi quy tắc làm tròn khi đã có kỳ/đợt chốt phải xác nhận.
- **Duyệt phiếu**: chuyển phiếu sang đợt khác không đưa phiếu Đã duyệt về Nháp.
- **Phát hành/CI**: `release.yml` đọc ghi chú và phiên bản tại đúng commit đã nghiệm thu, từ chối tag/release trùng, kiểm tra SHA-256 và tên tệp; `windows.yml` không hủy lần nghiệm thu đang chạy; nghiệm thu kiểm exit code Setup và schema = 8 sau nâng cấp.
- Chi tiết, ma trận lỗi → test: `docs/NGHIEM_THU_0.8.4.md`.

## 0.8.3 — sửa lỗi lần kiểm tra thứ hai (schema 8, không có migration)
- **Hoàn thiện sau rà soát**: đổi *Ngày căn cứ tính giá cước* (cân 1 ↔ cân 2) nay hỏi xác nhận (nêu số phiếu xuyên đêm bị ảnh hưởng), tính lại các phiếu chưa chốt, giữ nguyên phiếu đã chốt và ghi nhật ký `SETTING_PRICE_BASIS`; `catalog.*` từ chối khóa kiểu prototype (`constructor`, `__proto__`…) bằng `ValidationError`; phím tắt Alt+D/I/B tôn trọng quyền như menu; `ui-smoke` ghi tệp mẫu đối tác vào thư mục tạm thay vì `tests/fixtures`.
- **Phân phối bộ cài**: gỡ các mảnh `setup/*.part*` và `NOI_FILE_VA_CAI.bat` khỏi mã nguồn (bộ cài build cục bộ, không qua CI, 113 MB mỗi phiên bản làm phình kho). Bộ cài chính thức chỉ lấy từ trang Releases (đã nghiệm thu bằng CI, có `SHA256SUMS.txt`); `setup/HUONG_DAN.md` hướng dẫn tải và kiểm tra SHA-256. Lịch sử git vẫn giữ các bản cũ (kho chưa được thu nhỏ).
- **P1 đổi trạng thái bảng giá đang dùng**: đưa bảng giá còn phiếu sử dụng ra khỏi ACTIVE (vd INACTIVE) phải xác nhận (`ConfirmRequired`). Câu hỏi nêu số phiếu chưa chốt sẽ được tính lại, số phiếu đã chốt giữ nguyên và chỉ cách mở lại giá cũ (nút 🗑 Xóa bảng giá). Trước đây chỉ một thao tác là làm 381 phiếu mất giá mà không cảnh báo. Khi bật duyệt phiếu, phiếu **đã duyệt** bị đổi tổng tiền được ghi audit `PRICE_RECALC_APPROVED` và mở cảnh báo cùng tên ở Trung tâm cảnh báo; phiếu không tự về Nháp.
- **P2 hoàn tác lô gốc**: lô nhập lại có dòng `PENDING_ALREADY` (đã chờ kiểm tra ở lô trước) không còn làm mất xung đột khi lô gốc bị hoàn tác. Dòng mới nhất cùng dữ liệu được thăng cấp thành dòng "Cần kiểm tra" (audit `PENDING_PROMOTED`), cảnh báo trùng giữ nguyên, số đếm của lô được cập nhật.
- **P2 bật phân quyền sau khi đã bật duyệt phiếu**: `auth.enable` cũng cảnh báo "chỉ còn 1 người có quyền duyệt", kèm lựa chọn bật luôn *Cho phép tự duyệt* (`bat_tu_duyet`). Tắt *Cho phép tự duyệt* khi chỉ có 1 người duyệt cũng phải xác nhận. Mọi điều kiện "đủ người duyệt" dồn về một hàm `canhBaoNguoiDuyet` (`src/utils/duyet.js`).
- **P3**: ẩn nút xóa/thêm giá dầu với vai trò không đủ quyền (giao diện hiểu quyền theo bảng qua `data-table`); màn Backup hiện mốc xuất theo giờ địa phương; mốc "xuất ra ổ khác" ghi thêm vào `backups/export-status.json` nên khôi phục DB cũ không làm lùi mốc.
- Chi tiết, ma trận lỗi → test: `docs/NGHIEM_THU_0.8.3.md`.

## 0.8.2 — sửa lỗi sau kiểm tra (schema 8)
- **P0 quyền theo từng bảng**: `catalog.create/update/remove` với **bảng giá** và **giá dầu** cần quyền *Duyệt* (như `price.createVersion`, `fuel.importCommit`); người nhập không còn tạo được bảng giá riêng làm đổi tổng tiền. Các bảng khác giữ quyền *Nhập*. Máy chủ quyết định (`runtime.dispatch`), giao diện chỉ ẩn/hiện nút.
- **P1 bảng giá một luồng**: thông số giá chỉ đổi qua "Phiên bản giá mới"; `catalog.update` bảng giá chỉ nhận ghi chú/trạng thái, `catalog.create` bảng giá trả lỗi hướng dẫn. "Áp dụng" (Bảng tính đơn giá) và "Duyệt kỳ giá dầu" hiện bảng xem trước (đóng giá cũ đến ngày nào, mở giá mới, số phiếu tính lại) và xác nhận trước khi ghi. Import giá dầu cùng mức quyền *Duyệt*.
- **P1 nút Duyệt**: sửa `App.can('tickets.approve')` (luôn false khi bật phân quyền) → `App.can('duyet')`; `can()` cảnh báo khi nhận chuỗi lạ; bảng nút→kênh dùng chung lấy mức quyền từ máy chủ; ẩn nút ghi dữ liệu với vai trò không đủ quyền.
- **P1 không kẹt duyệt khi chỉ có 1 người**: cài đặt `duyet_phieu.cho_tu_duyet` (mặc định tắt); cảnh báo + xác nhận khi bật duyệt phiếu, khóa hoặc hạ quyền làm số người có quyền duyệt < 2; nhãn "Tự duyệt"; audit `APPROVE_TICKET {tu_duyet}`; README mô tả hai chế độ.
- **P2 hàng chờ "Cần kiểm tra"**: nhập lại cùng dòng xung đột không nhân dòng chờ (`PENDING_ALREADY`, SKIP, không mở thêm cảnh báo); số liệu khác thì tạo dòng mới và nhóm theo phiếu; xem trước hiện riêng. **Migration 008** (dựng lại `import_batch_row` để mở rộng CHECK, giữ nguyên dữ liệu).
- **P2 cha–con**: xóa dòng con có xác nhận; tiêu đề đường dẫn; đóng bằng click nền và thêm/sửa/xóa dòng con làm mới bảng cha.
- **P2 sao lưu & xuất**: hẹn giờ kiểm tra sao lưu AUTO mỗi 60 phút (app mở qua đêm vẫn có bản mỗi ngày); mốc "xuất ra ổ khác gần nhất" + nhắc quá 7 ngày (cấu hình được); dọn phiên xem trước import quá 2 giờ; log rõ bản PRE_IMPORT không được dùng khi commit lỗi; hộp thoại lưu chọn bộ lọc theo đuôi (.pdf/.xlsx).
- Chi tiết, ma trận lỗi → test: `docs/NGHIEM_THU_0.8.2.md`.

## 0.8.1 — 18/11/2026 (schema 7)
- Báo cáo và chứng từ chỉ nhận phiếu đã duyệt ở backend, kể cả bộ lọc Nháp/mọi trạng thái. Dashboard, tổng hợp, bảng kê, đối chiếu và biểu mẫu ký dùng cùng phạm vi. Danh sách Phiếu cân vẫn xem được Nháp; Excel dữ liệu có cột trạng thái duyệt.
- Bộ đếm Smart Filter theo đúng phạm vi màn nhập hoặc báo cáo; phản hồi dữ liệu/đếm cũ được bỏ qua khi đổi lọc nhanh; số đếm được làm mới sau duyệt/xóa. Bảng con giữ đúng loại dữ liệu khi chuyển tab. Màn báo cáo nêu phạm vi đã duyệt.
- Sửa trực tiếp kiểm tra KL = |Cân 1 − Cân 2| như import, chặn số không hữu hạn/lý do trắng; xóa giờ cân 2 được xét đúng. Commit kiểm lại quy tắc khối lượng nếu cấu hình thay đổi sau preview.
- Hoàn tác cập nhật số liệu khi bật duyệt đưa phiếu về Nháp, xóa xác nhận cũ. Bổ sung hồi quy qua API, Excel, biểu mẫu và giao diện thật.


## 0.8.0 — 18/11/2026 (schema 7)
- **Nghiệm thu 0.8.0** (`docs/NGHIEM_THU_0.8.0.md`): backend là nơi quyết định phạm vi phiếu Nháp (tham số `moi_trang_thai`/`trang_thai_duyet` từ người gọi bị loại ở mọi kênh ngoài liệt kê phiếu cân); hoàn tác batch đưa phiếu về Nháp khi khôi phục số liệu cũ; duyệt kèm phiên bản phiếu (phiếu đổi sau khi chọn thì không duyệt); import kiểm lại ngưỡng KL hiện hành lúc commit; duyệt chặn phiếu KL ngoài ngưỡng.
- **Duyệt từng phiếu (tùy chọn, mặc định TẮT)**: Cài đặt → "Duyệt từng phiếu". Khi BẬT, phiếu mới nhập (hoặc vừa sửa số liệu / xử lý xung đột cập nhật) là **Nháp**; chỉ khi được duyệt mới vào Dashboard, Bảng kê, báo cáo, đối chiếu và chốt kỳ. Phiếu hiện có = Đã duyệt nên TẮT thì hành vi y như cũ. Duyệt theo lô (`tickets.approve`, quyền "duyệt"), kết quả từng phiếu, ghi nhật ký; khi bật phân quyền, người nhập/sửa không tự duyệt phiếu của mình. Không tắt được khi còn Nháp; chốt kỳ bị chặn khi còn Nháp trong phạm vi; kiểm tra toàn vẹn thêm `NHAP_KHI_TAT_DUYET`. Migration 007 (thêm cột, dữ liệu cũ giữ nguyên).

## 0.7.1 — 18/11/2026 (schema 6, không đổi)
- **Ngưỡng KL cấu hình được**: Cài đặt → "Khối lượng hợp lý mỗi chuyến" (`kl_hop_ly`, mặc định 100–100.000 kg như cũ) áp dụng thống nhất cho import, sửa trực tiếp, duyệt xung đột và kiểm tra toàn vẹn; giá trị sai bị từ chối.
- **Đọc nhiều khối (tùy chọn)**: bước ghép cột có ô "File có nhiều khối" — mỗi dòng "Tổng cộng" là ngăn cách, đọc tiếp các khối sau (chỉ nhận dòng trông như phiếu cân, bỏ bảng tóm tắt), tổng đối chiếu = tổng các dòng Tổng cộng. Mặc định tắt: vẫn dừng ở dòng Tổng cộng đầu và cảnh báo.

## 0.7.0 — 18/11/2026 (schema 6)
- **Nghiệm thu bàn giao 0.7.0** (`docs/NGHIEM_THU_0.7.0.md`): phản hồi về chậm không còn ghi đè màn đang mở; "Việc cần làm" nêu rõ phạm vi toàn hệ thống và bấm xử lý bỏ bộ lọc ngầm; cảnh báo dữ liệu nằm dưới dòng "Tổng cộng" (file nhiều khối) và dòng tổng không có giá trị; duyệt xung đột kiểm lại dòng nguồn; hộp xác nhận chặn bấm lặp; EXE/Setup có thông tin phiên bản + nhà phát hành; `npm run integrity -- <db> --csv` xuất danh sách ID nghi vấn; test ma trận đối chiếu giữa các màn sau từng thao tác (`tests/handover-matrix.test.js`).
- **Logic khối lượng (kg/tấn)**: KL ghi nhầm theo tấn (vd 17,5 hiểu thành 17,5 kg → tiền nhỏ 1000 lần) hoặc quá lớn (> 100.000 kg/chuyến) nay bị chặn ở import và sửa trực tiếp (`src/utils/weight.js`); số cân âm bị chặn. Bước xem trước hiển thị tổng KL đọc được, đối chiếu với dòng "Tổng cộng" của file (lệch thì báo đỏ: có thể mất dòng/sai đơn vị) và tổng tạm tính phiếu mới. Kiểm tra toàn vẹn thêm: KL bất thường, số phiếu chỉ khác số 0 đầu. Bảng dữ liệu không còn xuống dòng biển số/ngày giờ; màn Backup gắn nhãn dễ hiểu cho từng loại bản sao (Trước nâng cấp / Trước khôi phục…). Test: `tests/weight-logic.test.js`.
- Sửa lỗi quay lui khôi phục có thể xóa DB gốc khi Windows từ chối bước đổi tên đầu tiên. Quay lui chỉ dọn các đường dẫn đã dời thành công hoặc bộ DB thay thế; hai ca hồi quy trên cả hai driver đã tái hiện mất dữ liệu trước bản sửa.
- CI tự xây và nghiệm thu Setup/Portable trên PR `codex/release-*` và khi cập nhật `main`, đính kèm bộ cài, SHA-256 và JSON kết quả. Script nghiệm thu dừng trước khi cài nếu thư mục dữ liệu mặc định đã tồn tại, bảo toàn dữ liệu trên máy chạy kiểm thử.
- Nghiệm thu cục bộ: 146/146 test đạt với cả `node:sqlite` và `better-sqlite3`; UI smoke Windows qua `CHROMIUM_PATH` hoàn tất không có lỗi; đối chiếu V.47 khớp các chỉ tiêu; `npm audit --omit=dev` có 0 cảnh báo.
- Khôi phục DB xóa phiên đăng nhập cũ, yêu cầu xác thực lại trong bộ dữ liệu vừa khôi phục để tránh nhận nhầm người dùng khi ID trùng nhau giữa hai DB. Có test hồi quy tái hiện trước bản sửa.
- Kiểm thử giao diện nhận `CHROMIUM_PATH` giống dev server, hỗ trợ chạy bằng trình duyệt trên Windows.
- Kiểm tra dependency khi nghiệm thu: `npm audit` hiện báo 9 mục mức cao trong cây công cụ build do `picomatch` (GHSA-fc5q-39xc-vjpf); registry đang cung cấp bản mới nhất 4.0.7 vẫn thuộc phạm vi cảnh báo. Kết quả này thay thế mốc 0 cảnh báo của lần kiểm tra trước. Ghi riêng kết quả `npm audit --omit=dev` trong biên bản nghiệm thu.
- **Kiểm tra toàn vẹn dữ liệu (chỉ đọc)**: `npm run integrity -- <db>` và nút "Kiểm tra toàn vẹn" ở màn Backup — phát hiện phiếu trùng danh tính (kể cả bản trùng do lỗi cũ: cùng số phiếu + nơi xuất viết khác chữ), chốt kỳ mồ côi/lệch snapshot, lô lệch bộ đếm, tiền lệch…; không tự sửa. Tài liệu mô hình cha–con: `docs/MO_HINH_DU_LIEU.md`.
- Import: một cột bị gán cho hai trường nay là **lỗi chặn** ở bước ghép cột (trước là cảnh báo); cài đặt `duplicate_key` chỉ nhận quy tắc thật sự được áp dụng.
- **Phân quyền tùy chọn** (migration 006 `nguoi_dung`, không ảnh hưởng dữ liệu cũ): tắt = 1 người dùng như trước; bật = đăng nhập + 4 vai trò (ADMIN/DUYET/NHAP/XEM). Quyền thực thi ở máy chủ (`runtime.dispatch`, bảng `utils/permissions.js`, kênh chưa khai báo → chỉ admin), mật khẩu băm scrypt, khóa 60 giây sau 5 lần sai, phiên hết hạn 30 phút, bảo vệ quản trị cuối cùng, đổi thư mục lưu trữ chỉ quản trị, `audit_log.user_name` ghi tên đăng nhập, khôi phục khi mất mật khẩu bằng `VCCOST_RESET_AUTH=1`. Giao diện: màn đăng nhập, ô người dùng, màn Người dùng & phân quyền. Test: `tests/auth.test.js` (8) + kịch bản UI.
- **Phụ thuộc**: nâng `electron-builder` 26.18.1; `overrides` ép `minimatch` bản vá cho cây công cụ build (cây chạy thật của `exceljs` giữ `minimatch` 3) → `npm audit` 0 cảnh báo; đóng gói `win-unpacked` vẫn chạy. Thêm `docs/KY_SO_BO_CAI.md` (hướng dẫn ký số khi có chứng thư).
- **Xuất bản sao lưu ra ổ/thư mục riêng**: nút "Xuất ra…" ở màn Backup (kênh `backup.export`): chỉ nhận file trong thư mục sao lưu, kiểm tra hợp lệ trước, không ghi đè file có sẵn, đối chiếu SHA-256 sau khi chép.
- **Đối chiếu chéo trên V.47 (test)**: `tests/consistency.test.js` — Dashboard ↔ Phiếu cân ↔ Bảng kê ↔ nhóm báo cáo (theo ngày/đợt/đơn vị/nhiều đơn vị), Excel và bảng in ↔ Bảng kê, snapshot chốt ↔ số lúc chốt, xóa hàng loạt nhiều trang. Chênh lệch duy nhất giữa Dashboard (tổng từng phiếu, 5.512.904.418,24) và Bảng kê (làm tròn theo bảng kê, 5.512.904.418) là cấp làm tròn.
- **Toàn vẹn số liệu (từ rà soát giai đoạn 1)**: hoàn tác import khôi phục đúng trạng thái *ngay trước* lần cập nhật và chặn khi phiếu đã sửa tay sau đó hoặc khóa cũ đã bị phiếu khác chiếm; commit import kiểm tra lại theo số phiếu + nơi xuất (hai preview "Quế Sơn"/"QS" không còn tạo phiếu đôi); sửa ngày phiếu sang kỳ đã chốt bị chặn; "Cập nhật theo file mới" chặn đợt khóa, ngày vào kỳ chốt và trùng khóa; xử lý hàng loạt chạy từng dòng, không dừng ở lỗi đầu, trả kết quả từng phiếu và từ chối dòng của lô khác; lỗi chép file nguồn sau commit chỉ là cảnh báo. Test: `tests/integrity-fixes.test.js` (6).
- **Sao lưu/khôi phục an toàn**: bản `PRE_MIGRATION` nay tạo bằng `VACUUM INTO` từ kết nối đang mở (gồm giao dịch đã commit còn trong WAL; trước đây chép riêng `app.db` nên có thể thiếu dữ liệu thậm chí thiếu schema), được mở lại kiểm tra (integrity_check, đúng phiên bản nguồn); không tạo/xác minh được thì **dừng, không migrate**, DB giữ nguyên bản cũ. Khôi phục: kiểm tra file chọn trên bản tạm (SQLite hợp lệ, integrity_check, đúng DB VC Cost, không mới hơn phần mềm), PRE_RESTORE nhất quán (file đang chọn được bảo vệ khỏi quy tắc lưu giữ), thay thế bằng đổi tên có quay lui; lỗi ở bất kỳ bước nào thì trả DB ban đầu về, mở lại, đọc thử rồi mới báo. Tên bản sao không bao giờ dùng lại trong cùng phiên. Test: `tests/storage-safety.test.js` (10, hai driver).
- **Định dạng số dùng bản chuẩn HAK_ACCOUNTING_REPORT_STANDARD**: nhúng nguyên văn `dist/hak-report-standard.js` (commit b6bd885) vào `renderer/vendor/hak-report-standard` (có MANIFEST + băm SHA-256, test chặn sửa tay). Giao diện (`App.fmt`), PDF/in (`htmlTemplates`) và biểu mẫu (`forms`) cùng dùng một hàm `formatNumber`, hết bộ định dạng chép riêng. Khác biệt nhỏ: làm tròn nửa-xa-0 như Excel (trước đây số âm .5 làm tròn về phía +∞).
- **Chế độ tối** (token luxe tối của Design System): nút "Giao diện: Theo hệ thống / Sáng / Tối" ở thanh bên, nhớ lựa chọn trên máy, theo hệ điều hành khi để tự động. Mọi nền đi qua token (hết nền trắng cứng); tag/chênh lệch có bản tối; khối bổ sung token cảnh báo/thông tin cho nền tối (Design System chưa có). Cặp chữ/nền tối đạt WCAG AA (có test). Thay màu teal cũ còn sót ở logo/mục đang chọn bằng champagne.
- **"Cần kiểm tra" ngay trong bước Kết quả của import**: danh sách trùng khóa của chính lần import vừa làm, so sánh cũ/mới và xử lý từng dòng **hoặc hàng loạt** (Giữ cũ tất cả / Bỏ qua tất cả / Cập nhật tất cả theo file mới — bắt buộc lý do, bỏ phiếu đã chốt kỳ, ghi nhật ký từng phiếu). Màn "Cần kiểm tra" riêng dùng chung cùng thành phần và cũng có xử lý hàng loạt.
- `docs/TODO_ROADMAP.md` cập nhật đúng thực tế (bảng tiêu chí hoàn thành, việc đã làm thêm, việc còn lại).
- Test: `design.test.js` (+2: AA ở chế độ tối, không còn nền trắng cứng); kịch bản giao diện thật: chế độ tối (nền/ô nhập/thẻ theo token, nhớ sau khi tải lại, quay lại sáng) và xử lý trùng khóa hàng loạt ngay sau import (giữ cũ → KL không đổi; cập nhật tất cả với lý do → KL đổi).
- **Nhập liệu phiếu cân — kiểm tra ngay tại chỗ (bước ghép cột)**: kết luận 1 dòng cạnh các ô ghép cột (✓ đủ cột / ✗ thiếu cột bắt buộc / ⚠ cảnh báo), tóm tắt lỗi cả sheet theo lý do (kèm dòng ví dụ), và **đọc thử 8 dòng đầu** (ngày giờ đọc được, biển số chuẩn hóa ← bản gốc, KL, nơi xuất nhận ra hay chưa). Nút "Xem trước" tự tắt khi thiếu cột bắt buộc (nhận cả trường hợp KL = Cân lần 1 + Cân lần 2); cảnh báo cột bị gán cho 2 trường, thiếu nơi xuất/giờ cân 2. Backend `import.check` (chỉ đọc, không ghi).
- **Xem trước:** nút "⬇ Tải các dòng cần xử lý (Excel)" — liệt kê dòng lỗi, trùng khóa khác nội dung, thiếu xe/nơi xuất/giá kèm lý do và **cách xử lý**; sửa rồi import lại (dòng đã đúng không bị trùng). Backend `import.issuesXlsx`.
- **Kết quả import:** khối "Việc tiếp theo" theo dữ liệu thật (xử lý trùng khóa → hoàn thiện phiếu chưa tính giá → đối chiếu → chốt kỳ) và nút **"↩ Hoàn tác lần import này"** (bắt buộc lý do, có nhật ký).
- Sửa chữ cũ "Chọn file (.xlsx / .xls / .csv)" → ".xlsx / .csv" (.xls không còn hỗ trợ; có hướng dẫn "Lưu thành").
- Excel xuất: đầu bảng dùng navy của skin luxe.
- Định dạng số/ngày trên giao diện được kiểm bằng kịch bản thật theo chuẩn kế toán HAK: `1.234.568`, `-1.234`, `0` (không "-0"), `1.234.567,89`, `20,090 tấn`, `05/10/2026 07:08`.
- Test: 2 test backend (`import.check`, `import.issuesXlsx`) + kịch bản giao diện thật (đọc thử file, chặn khi thiếu cột, kết luận cạnh ô ghép cột, bật lại khi ghép đủ, khối "Việc tiếp theo", nút hoàn tác, định dạng chuẩn).
- **Giao diện theo HAK Enterprise Design System (skin luxe: navy · champagne · ivory)**: token chuẩn nhúng nguyên văn (`renderer/vendor/hak-design/luxe.css`, băm trong MANIFEST); `styles.css` không tự định nghĩa màu thương hiệu mà chỉ đặt tên gọi trỏ sang token (`--green → --brand`, `--text-mute → --mut-aa`…); màu cứng còn lại (nền ô nhập, viền, đầu bảng, thanh bên, toast, dòng cảnh báo) đổi sang token. Cặp chữ/nền chính đạt WCAG AA, có test.
- **Menu theo luồng công việc ①–④** (Nhập & kiểm tra → Giá & tính cước → Đối chiếu & chốt kỳ → Bảng kê & báo cáo).
- **Dashboard mở đầu bằng "Việc cần làm theo quy trình"**: 6 bước, mỗi bước nêu số phiếu còn lại (hoặc ✓ Xong) và nút đi thẳng tới màn xử lý (vd Phiếu cân đã lọc sẵn phiếu chưa tính giá). Backend `workflow.todo`.
- Test: `tests/design.test.js` (5 test: skin/alias/AA/menu/`workflow.todo` theo dữ liệu) + kịch bản giao diện thật (6 bước, nhóm menu, nền ivory, đếm bước, nút Chốt kỳ mở đúng màn). Test tương phản cũ (đọc màu cứng trong styles.css) được thay bằng test trên token chuẩn.
- **Bộ lọc thông minh (HAK Smart Filter) dùng chung mọi màn hình** thay thanh lọc cũ (Phiếu cân, Dashboard, Báo cáo, Biểu mẫu, Bảng kê): chọn nhiều đơn vị / đợt / nơi xuất / tuyến, tìm không dấu (số phiếu, biển số gõ kiểu nào cũng được, tên nơi xuất kể cả tên gọi khác), kỳ + Từ/Đến ngày `dd/mm/yyyy` (tự chèn `/`, chặn ngày không tồn tại), trạng thái tính giá, chip điều kiện, dòng "Hiển thị x / y dòng · Phạm vi", bộ lọc đã lưu theo màn hình. Điều kiện đi từ Dashboard sang Phiếu cân nay hiện thành chip (không còn lọc ngầm). Chứng từ Excel/PDF in tên các giá trị đã chọn và cụm tìm kiếm.
  - Lõi nhúng nguyên văn từ `HAK_SMART_FILTER` (commit e99bb7e) ở `renderer/vendor/hak-smart-filter` + `MANIFEST.json` (test chặn sửa tay); bộ chuyển đổi `renderer/filters.js`.
  - Backend: `ReportService.where` nhận mảng id (IN), tìm kiếm không dấu; thêm `tickets.count`, `tickets.periods`; `asIds`/`oneId`; bảng kê đòi đúng một đơn vị.
  - Giao diện: popup/ngăn kéo/chip theo tokens hiện có; hộp thoại nổi trên ngăn kéo.
  - Test: `tests/filter.test.js` (6), `tests/vendor.test.js` (2) và kịch bản giao diện thật (chọn nhiều → chip → phạm vi → tìm không dấu → ngày → ngăn nâng cao → bộ lọc đã lưu riêng từng màn).
- **Sửa lỗi mất dữ liệu sao lưu**: cấu hình sao lưu sai (vd số bản giữ lại = "abc", âm, 0) làm `applyRetention` xóa SẠCH bản sao lưu tự động (đã tái hiện: 5 bản → 0, kể cả bản vừa tạo). Nay số bản giữ lại luôn được kiểm tra (giá trị lạ → mặc định 30/12) và bản vừa tạo không bao giờ bị xóa.
- **Cấu hình hệ thống có kiểm tra**: `settings.set` chỉ nhận các khóa đã biết (backup, company, rounding, time_anomaly, default_noi_den, duplicate_key, initial_data, money_scale) và kiểm tra giá trị (khoảng/kiểu). Trước đây nhận mọi khóa/giá trị: làm tròn `NaN` bỏ làm tròn âm thầm, ngưỡng cảnh báo âm, khóa `__proto__`…
- Tính lại hàng loạt chỉ ghi phiếu khi kết quả thật sự đổi (tính lại 20.000 phiếu không đổi: 1,37 s → 0,87 s; `updated_at` phản ánh lần đổi thật).
- Cảnh báo thời gian: bộ so sánh sắp xếp chuyến theo giờ cân nay nhất quán (cùng giờ → theo id; giờ rỗng không lỗi), thứ tự và khoảng cách giữa chuyến không còn phụ thuộc thứ tự đầu vào.
- Electron: từ chối mọi yêu cầu quyền của trang (camera, micro, vị trí…) và chặn `<webview>`.
- Test: `tests/settings.test.js` (3 test) + 2 test trong `entry-validation.test.js`.
- Thay thư viện đọc Excel **SheetJS `xlsx` → `exceljs`** (xóa hẳn `xlsx`, hết cảnh báo mức cao Prototype Pollution/ReDoS). `npm audit`: còn 6 cảnh báo mức vừa của `minimatch` trong `electron-builder` (chỉ công cụ build).
  - Đọc `.xlsx` bằng exceljs, `.csv` bằng bộ đọc riêng (BOM, `,`/`;`, ngoặc kép RFC 4180). Đối chiếu trên file mẫu V.47: 29.702/29.751 ô giống hệt; 49 ô còn lại chỉ là ô công thức ở các dòng tổng cuối sheet (cache 0), ngoài vùng phiếu. Số liệu vẫn khớp Excel (`npm run validate`).
  - **Thay đổi hành vi: không còn đọc `.xls` (Excel 97-2003)** — báo lỗi rõ (cả khi đổi đuôi thành .xlsx) và hướng dẫn "Lưu thành" .xlsx. Hộp chọn file chỉ còn .xlsx/.csv.
  - Giá trị ô chuẩn hóa: ngày → số seri (không phụ thuộc múi giờ máy, có test TZ Việt Nam/Mỹ/UTC), công thức → kết quả, ô lỗi/ô gộp phụ → rỗng.
  - Đọc file thành bất đồng bộ: `open`/`preview` của các import và `loadInitialData` là `async`; `createRuntime` có `rt.ready` và `dispatch` tự đợi nạp dữ liệu ban đầu xong.
  - Hiệu năng: mở file 20.000 dòng ≈ 0,7 s.
  - Test: `tests/workbook-reader.test.js` (5 test) + `tests/helpers/xlsx.js` (thay SheetJS trong test).
- Nhập liệu danh mục — chống trùng/chồng lấn/giá trị vô lý (trước đây các trường hợp này được nhận, gây tách bảng kê hoặc MULTIPLE_PRICE):
  - Đơn vị vận chuyển: không trùng Mã/Tên (không phân biệt hoa-thường, dấu, khoảng trắng); Mã số thuế 10 số (hoặc 10-3 số), tự chuẩn hóa; email đúng dạng.
  - Địa điểm: không trùng Tên địa điểm khác, không trùng tên gọi (alias) của địa điểm khác.
  - Bảng giá nhập trực tiếp ở danh mục: đơn giá > 0, VAT 0–100%, không chồng hiệu lực với bảng giá ACTIVE cùng tuyến/đơn vị/loại hàng (dùng "Tạo phiên bản giá mới" để tự đóng bảng cũ).
  - Giá dầu phải > 0.
- Gom xử lý trùng lặp về một chỗ: `dayBefore`, `dmy`, `dmyHm` (utils/datetime), định dạng số không "-0" cho PDF/in (utils/numfmt), `isInside` (utils/safePath; storageLocation dùng lại). Test khẳng định định nghĩa "đã tính giá" của báo cáo và bảng kê trùng nhau theo từng đơn vị.
- Test: `tests/entry-validation.test.js` (7 test). Rà soát import (biển số viết khác, nơi xuất viết khác, KL sửa, số phiếu tái dùng, xe khác, đợt khác, dòng trùng trong file, xe chồng giờ cân) — hành vi hiện tại đúng, không đổi.
- Bản vá: `electron` 45.3.1 → 45.3.3, `better-sqlite3` 13.1.1 → 13.2.0, `playwright-core` 1.65.0 → 1.65.1. Kiểm chứng: 76/76 test bằng cả hai driver, kiểm tra khởi động + PDF thật (Electron 45.3.3) và `test:ui` đạt.
- Phụ thuộc: ép `uuid` ≥ 11.1.1 (qua `overrides`; `exceljs` chỉ dùng `uuid.v4`) để hết cảnh báo; nâng `chart.js` 4.5 → 4.6.1, `tabulator-tables` 6.6 → 6.7.1, `playwright-core` 1.63 → 1.65. `npm audit`: 9 → 7 cảnh báo, còn `xlsx` (high, chưa có bản vá trên npm) và chuỗi `minimatch` trong `electron-builder` (moderate, chỉ công cụ build, không đóng gói vào app).
- Nâng Electron 33.4.11 → **45.3.1** (bản 33 hết hỗ trợ, `npm audit` mức cao đã hết) và `better-sqlite3` 11.10 → **13.1.1** (N-API prebuilt dùng chung Node/Electron: không còn build lại module native, bỏ bước `install-app-deps` trong CI). `electron-builder` → 26.18. Loại các prebuilt nền tảng khác và mã nguồn C của better-sqlite3 khỏi bản đóng gói.
- Kiểm chứng: kiểm tra khởi động Electron 45 (cửa sổ → preload → IPC → CSDL) và **xuất PDF thật** qua Chromium (≈330 KB, `%PDF-`) đạt; cả bộ 76 test đạt bằng cả hai driver `node:sqlite` và `better-sqlite3`.
- Biến `VCCOST_DRIVER=better-sqlite3|node:sqlite` ép driver CSDL (giá trị lạ bị từ chối, không lặng lẽ đổi driver). CI chạy bộ test bằng cả hai driver.
- CI Windows (`.github/workflows/windows.yml`): trên `windows-latest` chạy `npm test`, nạp `better-sqlite3` cho Electron, đóng gói `win-unpacked` rồi KHỞI ĐỘNG THẬT bản đóng gói (cửa sổ → preload → IPC → CSDL) và kiểm tra driver = better-sqlite3. Chạy tay (workflow_dispatch) tick "installers" để build thêm Portable + Setup (artifact giữ 14 ngày).
- Electron: chế độ kiểm tra khởi động cho CI (`VCCOST_SMOKE=1`, kết quả ghi vào `VCCOST_SMOKE_OUT`, thoát 0/1; không ảnh hưởng khi chạy bình thường). Nếu không mở được CSDL (thiếu module native, file hỏng) app hiện hộp thoại lỗi rõ ràng rồi thoát, thay vì treo không có cửa sổ.
- CSDL (migration 005): `chot_ky_snapshot` (số đã chốt/ký) và `audit_log` bất biến ở mức CSDL — trigger chặn UPDATE/DELETE, kể cả sửa tay bằng SQL. Trước đây chỉ service chặn. Mở khóa kỳ vẫn giữ snapshot làm lịch sử.
- Electron: kênh `dialog.saveExport` chỉ chép file nằm trong thư mục `exports` của app; bỏ kênh `shell.openPath` (giao diện không dùng); CSP thêm `object-src`, `base-uri`, `form-action` = 'none'.
- Định dạng số (giao diện, PDF/in, biểu mẫu): số âm làm tròn về 0 hiển thị "0", không còn "-0" / "-0,00" (cùng quy tắc HAK_ACCOUNTING_REPORT_STANDARD).
- Giá: `resolvePrice` trả NO_PRICE khi ngày rỗng/sai thay vì so sánh chuỗi "undefined".
- Giao diện: chữ phụ (`--text-mute`) và màu đỏ (`--red`) đạt tương phản WCAG AA (≥ 4,5:1); thêm `:focus-visible` và `prefers-reduced-motion`.
- Dọn: xóa `scripts/dev-server.js` (bản cũ trùng `tools/dev-server.js`).
- Test: `tests/hardening.test.js` (bất biến CSDL, nâng cấp v4→v5, đường dẫn an toàn, "-0", ngày rỗng, CSP, tương phản).
- Import: header ngắn "Cân 1" / "Cân 2" (và "TL cân 1/2", "Trọng lượng cân 1/2") nay được nhận là cân lần 1/2, nên kiểm tra KL hàng = |Cân 1 − Cân 2| được áp dụng; trước đây các cột này bị bỏ qua và phiếu lệch KL vẫn vào hệ thống.
- Backend: kênh API chỉ nhận tên kênh có thật (`constructor`, `__proto__`… bị từ chối "Kênh không tồn tại").
- Thêm `tests/import-weight.test.js`; cập nhật README (phiên bản, chức năng, lệnh chạy, cấu trúc).

## 0.6.17
- Bảng tổng hợp, Bảng chi tiết, Bảng tính đơn giá (PDF + Excel): bỏ hẳn phần tên công ty/địa chỉ/MST ở đầu trang; chỉ còn quốc hiệu căn giữa. Thông tin Bên A/Bên B vẫn nằm ở khối "Bên thuê vận chuyển / Bên vận chuyển" bên dưới tiêu đề. Sửa nhãn "Bên thuê vận chuyển" bị cắt chữ ở Excel Bảng chi tiết.

## 0.6.16
- Import: nút "⬇ File mẫu phiếu cân" và "⬇ File mẫu danh sách xe" (màn Import phiếu cân). File Excel mẫu trình bày chuyên nghiệp: tiêu đề, cột bắt buộc/tùy chọn phân màu, dòng kẻ sẵn định dạng ngày giờ/số/văn bản, công thức KL hàng = |Cân 1 − Cân 2|, danh sách chọn đơn vị/địa điểm đang có, sheet "Hướng dẫn" ghi định dạng và ví dụ từng cột. Điền vào rồi import được ngay (đã kiểm thử).

## 0.6.15
- Danh mục Xe: thêm ô "Đơn vị vận chuyển (chủ xe)" + "Áp dụng từ ngày" ngay trong form thêm/sửa xe. Đổi sang đơn vị khác thì dòng cũ tự đóng và phiếu cân được tính lại. Cột "Đơn vị hiện tại" hiện nhãn đỏ "Chưa gán đơn vị" cho xe chưa có đơn vị.

## 0.6.14
- Rà soát mọi biểu mẫu (PDF + Excel): quốc hiệu "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM / Độc lập – Tự do – Hạnh phúc" luôn căn giữa; dòng "Số: …" chuyển xuống DƯỚI tiêu đề (Bảng tổng hợp, Bảng chi tiết, Bảng tính đơn giá, Bảng kê).
- Excel Bảng tính đơn giá (sheet tổng hợp): bổ sung quốc hiệu căn giữa, tiêu đề căn giữa, "Số: …"; công thức theo giá dầu giữ nguyên, kiểm tra tính lại đúng.

## 0.6.13
- Bảng tính đơn giá (và các biểu mẫu cùng kiểu: Tổng hợp tàu, Chi tiết vận chuyển; cả PDF và Excel): quốc hiệu "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM / Độc lập – Tự do – Hạnh phúc" nằm chính giữa trang, thông tin Bên A xuống dòng dưới bên trái.
- Xóa phiếu cân: chọn nhiều phiếu (ô tick) rồi "Xóa phiếu đã chọn", hoặc "Xóa tất cả phiếu đang lọc", hoặc "Xóa phiếu này" trong cửa sổ chi tiết phiếu. Xóa được cả phiếu đã áp giá vận chuyển (tiền biến khỏi Bảng kê/báo cáo). Bắt buộc ghi lý do, có nhật ký, import lại được. Phiếu đã chốt kỳ hoặc thuộc đợt đã khóa thì không xóa (phải mở khóa trước).

## 0.6.12
- Cài đặt → "Sao lưu tự động khi mở phần mềm": đặt định kỳ theo ngày (vd 2 ngày/lần). Mở phần mềm mà bản sao lưu tự động gần nhất đã quá số ngày đó thì tự sao lưu; nhập 0 để tắt.

## 0.6.11 — chốt kỳ, Dashboard theo kỳ, định dạng VN
- Chốt kỳ (mục mới): chốt theo Khoảng ngày hoặc Đợt/Tàu (có thể lọc đơn vị). Xem trước số phiếu/tiền theo Bảng kê; còn phiếu chưa tính giá thì KHÔNG cho chốt. Chốt xong lưu snapshot, khóa sửa phiếu (cả giờ cân, KL, biển số, đợt, trạng thái) và import không ghi đè được. Mở khóa bắt buộc có lý do, được ghi audit.
- Dashboard: chọn "Kỳ thể hiện" (tháng này/trước, quý, năm, tất cả, hoặc một kỳ đã chốt); số liệu chỉ tính phiếu ĐÃ TÍNH GIÁ (khớp Bảng kê); thẻ "Phiếu chưa tính giá" nêu lý do, bấm để mở danh sách cần xử lý.
- Nhập số có dấu ngăn nghìn (1.234.567,89); số canh phải, chữ canh trái, ngày canh giữa; ngày dd/mm/yyyy, số theo định dạng VN trên toàn app.
- Sửa lỗi nhỏ: biển số gõ nhầm O/I ở vị trí số, số full-width; import xe báo rõ dòng trùng biển số khác đơn vị/ngày (không âm thầm bỏ), ngày không đọc được, lỗi chồng lịch nêu đúng biển số; backup cùng giây không ghi đè nhau; khôi phục kiểm tra file trước khi đóng DB; không mở DB phiên bản mới hơn phần mềm; xóa danh mục đang có hợp đồng/nơi đến báo rõ; đối chiếu không coi số phiếu lặp ở xe khác là dữ liệu trùng; hoàn tác import chặn khi phiếu đã bị import sau sửa tiếp; phiếu LOCKED không bị đếm là "chưa tính giá".

## 0.6.10 — rà soát tính toán & logic
- Giá: tạo phiên bản giá mới không còn chồng ngày lên bảng giá bắt đầu sau nó (trước đây gây MULTIPLE_PRICE, phiếu rơi khỏi bảng kê). Kỳ giá dầu nay điều chỉnh cả bảng giá riêng theo đơn vị / loại hàng.
- Biểu mẫu: Tổng hợp tàu, Chi tiết vận chuyển, Bảng tính đơn giá dùng đúng quy tắc "đã tính giá" và cách làm tròn của Bảng kê → tổng, VAT, số bằng chữ khớp Bảng kê; các dòng cộng đúng tổng. Phụ lục xe của Bảng kê không còn cộng phiếu chưa tính giá.
- Đối chiếu: dung sai kg được đọc đúng; file đối tác không còn mất dòng khi ô đầu bắt đầu bằng "Công…".
- Import: chặn ngày không tồn tại (31/02, tháng 13…); dòng thiếu số phiếu báo lỗi thay vì bị bỏ; cột KL ghi "(tấn)" tự đổi ra kg; cùng số phiếu + cùng nơi xuất viết khác tên (QS / Quế Sơn) không còn bị coi là phiếu mới; trùng trong file khác nội dung báo lỗi; hoàn tác import đóng cảnh báo trùng.
- Sửa phiếu: phiếu đã chốt khóa mọi trường (trừ ghi chú); đợt khóa chặn sửa; kiểm tra ngày giờ và cân không âm.
- Giao diện: bộ lọc Tuyến/Biển số đang bật luôn hiện ra, không lọc ngầm Dashboard/báo cáo.

## 0.6.9
- Bảng giá / kỳ giá dầu đã có phiếu sử dụng: cho phép "Xóa và tính lại" — gỡ giá khỏi phiếu chưa chốt kỳ rồi tính lại ngay (về bảng giá cũ nếu có); phiếu đã chốt kỳ vẫn chặn.
- Đổi số bản 0.6.9 để các file .part không bị lẫn với các lần gửi trước (nguyên nhân hay gặp của lỗi khi ghép).
- Giao diện app theo style DGVC (nền, màu, font Be Vietnam Pro): mọi chứng từ in A4 dọc (lề 14/13/15/17 mm), Times New Roman cỡ 13px, bảng 12px, viền 0,6pt #444, đầu bảng xanh xám #e8eef3, dòng cộng #f2f5f8; Chi tiết vận chuyển chuyển từ ngang sang A4 dọc (cả PDF và Excel); Excel đầu bảng #EFEFEF, viền #7F7F7F như DGVC.
- Biểu mẫu ký 2 bên: mỗi bên có thêm ô KẾ TOÁN ký (cạnh ô Giám đốc/đại diện) ở PDF và Excel.
- Danh mục mới "Hợp đồng vận chuyển" (như DGVC): mã, số HĐ, ngày ký, bên vận chuyển, hiệu lực từ–đến, nơi lập, tiêu đề Bảng kê, mẫu diễn giải cước. Bảng kê và 3 biểu mẫu in tự lấy "Căn cứ hợp đồng số… ngày…" theo hợp đồng còn hiệu lực tại ngày chứng từ. Migration 003 tự tạo hợp đồng từ số HĐ đã nhập ở đơn vị vận chuyển.

## 0.6.7
- Bảng tổng hợp xuất hàng tàu và Chi tiết vận chuyển làm lại theo bố cục PRICING_SHEET: đầu chứng từ (Bên A trái, quốc hiệu + Số phải), tiêu đề, khối thông tin có nhãn (căn cứ hợp đồng, Bên thuê, Bên vận chuyển, tuyến), bảng, bằng chữ, ký 2 bên. Tổng hợp tàu in dọc A4.

## 0.6.6
- Bảng tính đơn giá: mỗi tuyến canh vừa khít 1 trang A4 (PDF), kể cả khi có mục D và chữ ký.

## 0.6.5
- Bảng tính đơn giá vận chuyển theo mẫu PRICING_SHEET: mỗi tuyến một trang (STT · Chỉ tiêu · Cách tính · Diễn giải · Giá trị · ĐVT; mục A thông số, B giá dầu áp dụng, C điều chỉnh, đơn giá + bằng chữ, D giá trị cước theo phiếu cân nếu chọn khoảng ngày; ký 2 bên). Excel mỗi tuyến một sheet có công thức sống + sheet tổng hợp; PDF cùng bố cục.

## 0.6.4
- Bảng tổng hợp xuất hàng tàu: tiêu đề 3 dòng theo mẫu — "BẢNG TỔNG HỢP VẬN CHUYỂN XUẤT HÀNG TÀU <tên tàu>" / "TUYẾN TỪ <nơi xuất> ĐẾN <nơi đến>" / "ĐỢT <mã đợt, ngày>"; mỗi tuyến (nơi xuất → nơi đến) của từng đơn vị một bảng/sheet. Tự lấy tên tàu theo đợt.

## 0.6.3
- **Xóa nhầm**: nút 🗑 ở Bảng giá / Giá dầu chuyển lên cột đầu (trước nằm cuối bảng nên bị khuất), thêm nút "Xóa" trong hộp sửa; kỳ điều chỉnh giá dầu ĐÃ DUYỆT xóa được nếu chưa phiếu nào dùng (gỡ bảng giá do kỳ sinh ra, mở lại bảng cũ).
- **Báo cáo → Biểu mẫu in ký 2 bên** (Excel A4 + PDF, Times New Roman, quốc hiệu, thông tin Bên A/B, chữ ký + kế toán): (1) Tổng hợp xuất hàng theo tàu (mỗi đơn vị × nơi xuất: số xe, chuyến, KG, tấn, đơn giá, thành tiền, VAT, tổng, bằng chữ); (2) Chi tiết vận chuyển từng xe/từng chuyến (số phiếu, giờ cân 1/2, cân lần 1/2, KL, đơn giá, cộng theo xe); (3) Bảng tính đơn giá vận chuyển (Excel có công thức sống + PDF, chọn Bên B ký).
- Các báo cáo tổng hợp có lại cột KL (kg) và (tấn).

## 0.6.2 (chưa đóng gói)
- Bảng kê / biên bản in theo **style DGVC**: Times New Roman, quốc hiệu, "Số …/BK-<mã>-<tháng>", căn cứ hợp đồng, khối thông tin Bên A/Bên B (đại diện, chức vụ, MST, ĐT, email, TK ngân hàng), bảng có KL **kg + tấn**, bằng chữ, địa danh/ngày, chữ ký có tên công ty in hoa, chức danh và kế toán. KG quay lại trong bảng kê vì cần cho đối chiếu khối lượng.
- Danh mục **Đơn vị vận chuyển** có thêm nhóm "Thông tin in Bảng kê / biên bản": tên in, xưng hô, đại diện, chức danh, kế toán, email, ngân hàng, số TK, số/ngày hợp đồng, địa danh (migration 002). Cài đặt → Bên A có thêm xưng hô, điện thoại, email, địa danh.
- **Đối chiếu khối lượng 2 bên theo xe** (Bên A cân ↔ Bên B đối tác) lấy từ lô đối chiếu: số chuyến, KL kg, chênh B−A (kg, %), kết luận Khớp/Lệch/Chỉ một bên. Chọn lô ngay màn Bảng kê; in kèm "Biên bản đối chiếu khối lượng" (sheet Excel + trang PDF) có ô thống nhất và chữ ký 2 bên.
- Phụ lục PDF: 1) theo xe 2) đối chiếu KL (nếu chọn) 3) danh sách phiếu cân. 48 test PASS.

## 0.6.1 (đã đóng gói; các mục dưới cũng nằm trong 0.6.2 nếu chưa đóng gói)
- Bảng kê + báo cáo: Excel chuẩn in/ký (A4, Bên A/Bên B, bằng chữ, khối chữ ký, phụ lục phiếu cân), xuất PDF, bộ lọc đầy đủ (+ nơi xuất, tuyến, biển số); bỏ cột KG và "chưa tính giá" khỏi báo cáo (chỉ còn cảnh báo); Cài đặt có thông tin Bên A.
- Giá dầu: Import từ file (Ngày + Giá, xem trước, tùy chọn ghi đè), sửa/xóa giá dầu từng ngày, xóa kỳ điều chỉnh nháp.
- Bảng giá: nút 🗑 chỉ xóa được bảng giá CHƯA có phiếu dùng; có phiếu dùng thì chặn và cảnh báo (tạo phiên bản giá mới thay thế).
- Mục mới **Bảng tính đơn giá** (CHI PHÍ): từng tuyến, từng bước I.1→III.1 như sheet Excel "Giá dầu + Giá VC"; đổi giá dầu / bình quân khoảng ngày để xem trước; Xuất Excel có công thức sống; "Áp dụng thành bảng giá mới" từ ngày X.
- Bảng giá: chỉ nhập THÔNG SỐ (đơn giá gốc, giá dầu cơ sở/áp dụng, km, định mức, KL bình quân); "Đơn giá áp dụng" và "Điều chỉnh" TỰ TÍNH theo công thức Excel, không nhập tay (server bỏ qua giá gửi lên). Form có xem trước công thức; đổi km → giá tự tính lại.

## [0.6.0] — 2026-10-07 — Dữ liệu ban đầu từ Excel
- Lần mở đầu tiên (CSDL trống) app tự nạp dữ liệu từ file Excel V.47 đi kèm (`data/seed/Tong-hop-chi-phi-VC-V47.xlsx`): địa điểm, tuyến, 4 đơn vị VC, giá dầu + kỳ điều chỉnh + bảng giá (gồm Quế Sơn), đợt PON-V47, 220 xe, 2.035 phiếu cân đã tính giá. Dùng đúng luồng nghiệp vụ thật; chạy lại không trùng. Chỉ nạp 1 lần (cờ `initial_data`).
- Cài đặt → "Nạp dữ liệu ban đầu (Excel V.47)" để nạp lại/bổ sung thủ công. 43 test PASS; kiểm thử Electron thật: lần 1 nạp đủ, lần 2 không nạp lại.

## [0.5.0] — 2026-10-07 — Chọn thư mục lưu trữ + bản Windows Portable
- Cài đặt → "Thư mục lưu trữ dữ liệu": chọn thư mục khác; **Chép dữ liệu sang** (đích phải trống, thư mục cũ giữ nguyên, tự backup trước) hoặc **Dùng dữ liệu có sẵn** (không ghi đè); về thư mục mặc định; tự khởi động lại. Cấu hình ở `vccost-location.json` (cạnh .exe / %APPDATA%/VCCost). Thư mục đã chọn mất (rút USB) → hỏi, không tự tạo CSDL trắng.
- Đã kiểm thử trong Electron thật (xvfb): đổi, mở lại, về mặc định. 42 test PASS.
- Bộ cài Setup (NSIS, cài theo người dùng, không cần Admin, có gỡ cài đặt, gỡ không xóa dữ liệu) dựng bằng `installer/make-setup.py` — chạy được trên Linux không cần wine.
- Cấu hình electron-builder (`npm run dist:win`); better-sqlite3 chuyển sang dependencies. Portable build được; Setup cần wine/Windows.

## [0.4.1] — 2026-10-07
- Q10: hiển thị chênh lệch KL giám định − KL cân (báo cáo theo đợt, Dashboard lọc đợt, danh mục Đợt/Tàu); cước vẫn tính theo KL cân. Seed nạp KL giám định 38.453,23 t. 38 test PASS. Đã chốt đủ Q1–Q10.

## [0.4.0] — 2026-10-07 — Phase 9: Đối chiếu
### Thêm
- `ReconciliationService`: khớp theo Số phiếu (hoặc Biển số + Ngày + KL nếu file đối tác không có số phiếu); 9 loại kết quả (Khớp / Thiếu bên A / Thiếu bên B / Lệch KL / Lệch đơn giá / Lệch tiền / Lệch VAT / Trùng dữ liệu / Cần kiểm tra); liệt kê đủ mọi cột lệch; dung sai KL và tiền cấu hình được.
- Cờ `trang_thai_doi_chieu` trên phiếu, 1 cảnh báo tổng hợp cho mỗi lô lệch, xử lý từng dòng (Chấp nhận A/B, Điều chỉnh, Bỏ qua + ghi chú, có audit). Đối chiếu không sửa phiếu cân.
- Màn hình Đối chiếu (danh sách lô → 2 bước → bảng song song Hệ thống | Đối tác, ô lệch tô màu) và xuất Excel 2 sheet (Bảng đối chiếu, Sai lệch).
- 3 test mới (37 PASS) + UI e2e mở rộng (25 ảnh chụp); mẫu file đối tác (sinh khi chạy, nay ghi vào thư mục tạm) `tests/fixtures/doitac-hak.xlsx`.
### Chưa có
- Đối chiếu cấp xe (đối tác chỉ gửi tổng theo biển số); build Windows.

## [0.3.0] — 2026-10-07 — Giao diện (renderer) + kiểm thử UI
### Thêm
- Giao diện Electron/HTML: sidebar tối, Dashboard (KPI, biểu đồ cột/thanh thuần CSS, top xe), Phiếu cân (phân trang/sắp xếp/tìm phía server, xuất Excel, "Vì sao phiếu có giá này?"), Chi tiết theo xe (timeline + cờ thời gian), 5 báo cáo có drill-down, Bảng kê thanh toán theo từng đơn vị (+ xuất Excel).
- Import 4 bước (chọn file → sheet & ghép cột → xem trước có phân loại/bộ lọc → kết quả), import danh mục xe, "Cần kiểm tra" (Giữ cũ / Cập nhật / Bỏ qua, có so sánh), Lịch sử import + hoàn tác.
- Danh mục CRUD sinh từ cấu hình (xe + lịch sử đơn vị, đơn vị VC, địa điểm + alias, tuyến, đợt/tàu), Bảng giá (phiên bản mới), Giá dầu (kỳ điều chỉnh: xem trước → duyệt), Cảnh báo, Audit log, Backup/Khôi phục, Cài đặt (làm tròn, ngưỡng thời gian).
- `tools/dev-server.js` (chạy UI trong trình duyệt với cùng handlers), `tests/ui-smoke.mjs` (Playwright e2e + 23 ảnh chụp trong `docs/screenshots/`).
### Chưa có
- Đối chiếu (Phase 9) chỉ có đặc tả; build Windows Portable/Setup cần máy Windows/CI.

## [0.2.0] — 2026-10-07 — Áp dụng quyết định nghiệp vụ Q1, Q2, Q3, Q5 + backend Phase 3–7
### Nghiệp vụ đã chốt
- Q1: Xe trả về **vẫn tính cước**; cờ `xe_tra_ve` chỉ dùng cho KL xuống tàu (BR-DOT-05).
- Q2: Giá Quế Sơn **suy ngược**: 146 km khứ hồi (Quế Cường 55 km + 18 km), cước cơ sở 173.000, giá dầu cơ sở 19.200 từ 07/11/2025 → engine tự tính ra 206.500, khớp Excel (BR-TUYEN-04). Đây là tổ hợp duy nhất cho cước cơ sở tròn nghìn.
- Q3: **Hóa đơn riêng từng đơn vị** (HHH, HAK, QC, ĐH) (BR-XE-06).
- Q5: **Làm tròn theo bảng kê**: thành tiền mỗi dòng giá làm tròn đồng, VAT tính 1 lần trên tổng (BR-ROUND-01).
### Thêm
- StatementService (bảng kê theo đơn vị), CatalogService, PriceService (kỳ điều chỉnh giá dầu), TicketImportService (preview → commit transaction, Cần kiểm tra, hoàn tác batch), VehicleImportService, CostService (tính lại khi danh mục đổi), ReportService, AlertService, AuditService, BackupService, SeedService, xuất Excel (ExcelJS), IPC + Electron main.
- 34 test PASS (unit + migration + integration end-to-end với file mẫu).
### Kiểm chứng
- Bảng kê V.47: HHH 4.074.119.881 · HAK 416.454.167 · QC 624.215.138 · ĐH 398.115.232 → tổng 5.512.904.418 đ (Excel 5.512.904.418,24 — lệch −0,24 đ do làm tròn).
### Chưa có
- Giao diện (renderer), build Windows Portable/Setup.


## [0.1.0] — 2026-10-06 — Phase 1–2 (Phân tích & Thiết kế) + lõi engine
### Thêm
- Phân tích đầy đủ file Excel mẫu PRINCE OF NATURE V.47 (6 sheet, công thức, dữ liệu, 11 lỗi/rủi ro, 10 câu hỏi nghiệp vụ).
- Bộ tài liệu: PHAN_TICH_THIET_KE_A-H, PROJECT_SPEC, DATABASE_SCHEMA, BUSINESS_RULES, IMPORT_SPEC, PRICE_ENGINE_SPEC, RECONCILIATION_SPEC, UI_SPEC, TEST_PLAN, TODO_ROADMAP.
- Migration SQLite v1 (`001_init.sql`) + migration runner có rollback.
- Lõi nghiệp vụ: money (Decimal, làm tròn kiểu Excel), plate (chuẩn hóa biển số), datetime, FuelAdjustmentService, PriceResolver, VehicleResolver (lịch sử), TransportCostEngine (GROUP/TICKET), DuplicateDetector, TimeAnomalyService, dò header & parser phiếu cân.
- 24 unit test (PASS) + script `validate-sample.js` → EXCEL_VS_APP_VALIDATION: khớp 100% với Excel.
- Seed dữ liệu cấu hình từ file mẫu (`data/seed/sample-v47.json`).
