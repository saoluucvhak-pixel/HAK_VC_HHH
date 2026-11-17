# Biên bản nghiệm thu VC Cost 0.7.0 (schema 6)

- Nền: `main` @ `b52e0dc` (PR #19). Nhánh nghiệm thu: `claude/handover-qa`. Lần nghiệm thu trước: run Windows 44165464239 (main b52e0dc, bộ cài Setup 71e54546…, Portable 995bacba…).
- Thay đổi sau lần nghiệm thu trước: xem "Bảng lỗi" bên dưới (các thay đổi đều nằm trong PR bàn giao).
- Môi trường kiểm thử: Linux (Node 22.23, node:sqlite + better-sqlite3 13.2, Chromium/Playwright, Electron 45.3.3 + xvfb) và Windows Server (GitHub Actions `windows-latest`, bộ cài thật).

## 1. Bảng lỗi đã tái hiện → sửa → hồi quy
| # | Lỗi (tái hiện trước khi sửa) | Mức | Sửa | Hồi quy |
|---|---|---|---|---|
| 1 | **Phản hồi về chậm ghi đè màn đang mở**: mở Dashboard (API chậm 1,5 s) rồi chuyển ngay sang Lịch sử import → màn hiện cả hai ("Lịch sử import" + "Dashboard"). | Cao (số liệu sai màn) | `go()` dùng phiên điều hướng + vùng chứa riêng; kết quả của màn cũ bị bỏ | `tests/ui-smoke.mjs` (route trễ) |
| 2 | **"Việc cần làm" không nêu phạm vi và bộ lọc ngầm**: khối đếm toàn hệ thống nhưng nằm cạnh KPI theo bộ lọc; bấm "Xem phiếu" mở danh sách vẫn mang bộ lọc cũ → số đếm ≠ danh sách đích. | Cao | Nhãn "Toàn hệ thống" + ghi chú khi có bộ lọc; bấm xử lý bỏ bộ lọc ngầm | ui-smoke: danh sách đích = số đếm khi đang lọc theo đơn vị |
| 3 | **File nhiều khối**: dòng dữ liệu nằm DƯỚI dòng "Tổng cộng" bị bỏ qua âm thầm (chỉ phiếu của khối đầu được nhập). | Cao (mất dữ liệu nhập) | Đếm các dòng giống phiếu dưới dòng tổng → cảnh báo ở bước ghép cột và banner đỏ ở xem trước | `weight-logic.test.js` (nhiều khối, bảng tóm tắt không bị coi là phiếu) |
| 4 | Dòng "Tổng cộng" là công thức chưa có giá trị lưu: giao diện nói "không có dòng Tổng cộng". | Thấp | Nêu rõ "không có giá trị (công thức chưa tính/lưu)" | cùng file test |
| 5 | Duyệt "Cập nhật theo file mới" không kiểm tra lại quy tắc hiện hành của dòng nguồn (KL/biển số…). | Trung bình | Chặn nếu dòng nguồn không còn hợp lệ | integrity-fixes / weight-logic |
| 6 | Hộp xác nhận cho phép bấm lặp nút hành động trong lúc thao tác trước chưa xong. | Trung bình | Vô hiệu nút + trạng thái "đang xử lý" đến khi xong | ui-smoke (toàn bộ luồng hộp thoại) |
| 7 | EXE/Setup không có thông tin phiên bản/nhà phát hành (rcedit bị tắt cùng `signAndEditExecutable:false`). | Thấp | Bật chỉnh tài nguyên (resedit) với `signExecutable:false`; `author`/`copyright`; xác minh có `CompanyName=HAK Group`, `FileDescription=VC Cost` | kiểm tra chuỗi tài nguyên trong EXE; CI Windows khởi động bản đóng gói |

Đã kiểm tra và **không thấy lỗi**: JOIN nhân phiếu/kg/tiền (mọi truy vấn cộng dùng `phieu_can` + bảng chiều nhiều–một; `docs/MO_HINH_DU_LIEU.md`), alias nơi xuất và hai preview cùng phiếu (commit chặn), số 0 đầu/khoảng trắng, nhập lại/bấm ghi lặp (lần 2 bị từ chối, không nhân đôi), khôi phục DB khác với phiên đăng nhập, ô ngày dd/mm/yyyy trong Electron (`--lang=vi`).

## 2. Ma trận đối chiếu giữa các màn sau từng thao tác
Test `tests/handover-matrix.test.js` chạy trên V.47 (DB tệp, đúng kênh IPC mà từng màn gọi) rồi **khởi động lại app** và so lại. Mỗi bước kiểm tra: Phiếu cân (ID, đếm, danh sách) = Dashboard + chưa tính giá = Bảng kê = 4 nhóm báo cáo (chuyến, kg, tiền) = Việc cần làm = Cần kiểm tra = menu = Chốt kỳ.

| Bước | Phiếu | Chuyến (đã tính giá) | kg | Trước VAT | Tổng (cộng từng phiếu) | Chờ kiểm tra | Đã chốt |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1. nạp V.47 | 2.035 | 2.035 | 38.563.700 | 5.104.541.128 | 5.512.904.418,24 | 0 | 0 |
| 2. nhập lại + bấm ghi lặp | 2.035 | 2.035 | 38.563.700 | 5.104.541.128 | 5.512.904.418,24 | 0 | 0 |
| 3. sửa phiếu (+10 kg) | 2.035 | 2.035 | 38.563.710 | 5.104.543.193 | 5.512.906.648,44 | 0 | 0 |
| 4a. nhập mới + 1 xung đột | 2.036 | 2.036 | 38.580.710 | 5.108.053.693 | 5.516.697.988,44 | 1 | 0 |
| 4b. duyệt xung đột (Cập nhật) | 2.036 | 2.036 | 38.575.610 | 5.107.000.543 | 5.515.560.586,44 | 0 | 0 |
| 5. chuyển đợt (3 phiếu) | 2.036 | 2.036 | 38.575.610 | 5.107.000.543 | 5.515.560.586,44 | 0 | 0 |
| 6. xóa mềm (4 phiếu) | 2.032 | 2.032 | 38.501.170 | 5.098.313.395 | 5.506.178.466,60 | 0 | 0 |
| 7. hoàn tác lô nhập | 2.031 | 2.031 | 38.489.270 | 5.095.856.045 | 5.503.524.528,60 | 0 | 0 |
| 8. thay giá + tính lại | 2.031 | 2.031 | 38.489.270 | 5.102.583.865 | 5.510.790.574,20 | 0 | 0 |
| 9. chốt kỳ (1.046 phiếu) | 2.031 | 2.031 | 38.489.270 | 5.102.583.865 | 5.510.790.574,20 | 0 | 1.046 |
| 9b. mở khóa (snapshot cũ giữ nguyên) | 2.031 | 2.031 | 38.489.270 | 5.102.583.865 | 5.510.790.574,20 | 0 | 0 |
| 9c. chốt lại | 2.031 | 2.031 | 38.489.270 | 5.102.583.865 | 5.510.790.574,20 | 0 | 1.046 |
| 10a/b/c. sao lưu → xóa 2 → khôi phục | 2.031 → 2.029 → 2.031 | | 38.489.270 → 38.454.720 → 38.489.270 | | 5.510.790.574,20 → 5.503.047.919,20 → 5.510.790.574,20 | 0 | 1.046 |
| 11. khởi động lại | giữ nguyên mọi màn | | | | | | |

**Cấp làm tròn / loại số liệu:** Phiếu cân, Dashboard, 4 nhóm báo cáo = tổng từng phiếu (tiền không làm tròn, lưu 1/1000 đ). Bảng kê = làm tròn theo từng bảng kê (dòng giá, VAT trên tổng dòng). Chênh lệch tối đa giữa hai cách = 0,5 đ × số bảng kê (V.47: 5.512.904.418,24 so với 5.512.904.418). Mọi ràng buộc trên được kiểm bằng `assert` ở từng bước, không chênh lệch nào ngoài cấp làm tròn.

## 3. Chống trùng và toàn vẹn
- Khóa nghiệp vụ: `số phiếu | nơi xuất (bỏ dấu, hoa)`, duy nhất trong phiếu ACTIVE (chỉ mục `ux_phieu_business_key`); alias nơi xuất quy về cùng mã nơi xuất ở preview **và được kiểm tra lại trong transaction commit**. Số phiếu tái sử dụng chỉ hợp lệ khi phiếu cũ VOID. Số 0 đầu được giữ nguyên (`0123` ≠ `123`; kiểm tra toàn vẹn cảnh báo cặp nghi vấn).
- `npm run integrity -- <db> [--csv file]` (chỉ đọc) đã chạy: **DB mới V.47** (schema 6, 2.035 phiếu, 1 lô) → 0 lỗi, 0 cảnh báo; **DB nâng cấp từ v4** (có dữ liệu + WAL, qua migration 005→006) → 0 lỗi. Không có bản sao dữ liệu thật của chủ dữ liệu trong phạm vi kiểm tra: **chưa kiểm tra trên dữ liệu thật**; script dùng được trực tiếp trên bản sao. Bản ghi nghi vấn xuất CSV (ID + lý do), không tự xử lý.
- Quan hệ, hành vi sửa/xóa mềm/hoàn tác và phạm vi thao tác hàng loạt: `docs/MO_HINH_DU_LIEU.md`.

## 4. Đơn vị, định dạng số, nhập liệu
- Quy tắc kg/tấn thống nhất tại `src/utils/weight.js`: import (`ticketParser`), sửa trực tiếp (`TicketService.update`), kiểm tra toàn vẹn; duyệt xung đột chỉ nhận dòng đã hợp lệ lúc preview và nay kiểm lại lúc cập nhật. Tính cước/báo cáo/chứng từ dùng kg đã lưu (không có quy tắc kg riêng).
- Đã thử: cột kg, cột "(tấn)", mapping tay, số Excel, `17,5`, `17.500`, trống, âm, 0, sát ngưỡng (99/100/100.000/100.001 kg). **Ngưỡng 100–100.000 kg/chuyến là giả định của kỹ sư, chưa được chủ nghiệp vụ chốt** (xem câu hỏi mở).
- Đối chiếu tổng: banner xem trước nêu tổng KL đọc được ↔ dòng "Tổng cộng" của file (V.47: 38.563.700 kg, khớp dòng 2040) và tổng phiếu mới riêng; thử công thức chưa có giá trị, nhiều khối, bảng tóm tắt, cột tấn.
- Chuẩn số HAK (`hak-report-standard`, MANIFEST khớp): số âm tại điểm giữa làm tròn xa 0, âm nhỏ → `0`, dấu `.`/`,`; ô tiền/kg trong Excel là **số**; V.47 đối chiếu theo chế độ làm tròn của repo (`npm run validate`: tổng bốn bảng kê 5.512.904.418 đ, Excel-compat 5.512.904.418,24 đ, chênh −0,24 đ chỉ do làm tròn).

## 5. Sửa/xóa/duyệt/hoàn tác, sao lưu/khôi phục
Giữ nguyên các hồi quy đã có (`integrity-fixes`, `storage-safety`, `auth`): chặn phiếu đã chốt / đợt khóa / đổi ngày vào kỳ chốt / thay đổi sau khi vào hàng chờ; hàng loạt trả kết quả từng ID; hoàn tác không ghi đè thay đổi mới hơn; PRE_MIGRATION chứa giao dịch trong WAL; khôi phục file hỏng/sai ứng dụng/mới hơn bị từ chối; quay lui khi đổi tên/mở lại lỗi; đăng nhập lại sau khi khôi phục DB khác. **Chưa mô phỏng được** "hết dung lượng đĩa" thật (chỉ mô phỏng lỗi ghi bằng đường dẫn bị chặn).

## 6. Giao diện, bộ cài
- Sáng/Tối, cửa sổ 820×600 không cuộn ngang, focus bàn phím nhìn thấy, hộp xác nhận nêu phạm vi, bấm lặp bị chặn (ui-smoke).
- EXE/Setup: có thông tin phiên bản + `HAK Group`. **Icon: chưa có tài nguyên thương hiệu (logo/.ico) trong repo VC Cost và Design System** → vẫn dùng icon Electron mặc định; cần chủ sản phẩm cung cấp logo.
- **Ký số: chưa ký** (cần chứng thư; `docs/KY_SO_BO_CAI.md`) → SmartScreen có thể cảnh báo.
- Dependency tại thời điểm nghiệm thu: `npm audit` = 9 mức cao, **cùng một nguyên nhân** `picomatch` (ReDoS, advisory áp dụng mọi phiên bản, chưa có bản vá) qua `electron-builder → … → tinyglobby`. Chỉ nằm trong công cụ build (`npm ls --omit=dev` rỗng), không đóng gói vào ứng dụng. Cảnh báo `minimatch` trước đó đã hết.

## 7. Câu hỏi nghiệp vụ còn mở
1. Ngưỡng KL hợp lệ mỗi chuyến: mặc định 100–100.000 kg (giả định). **Sau 0.7.0 đã chỉnh được ở Cài đặt** — chủ nghiệp vụ đặt giá trị thực tế.
2. File nhiều khối/nhiều tháng: mặc định vẫn dừng ở dòng Tổng cộng đầu và cảnh báo; **sau 0.7.0 có ô tùy chọn "File có nhiều khối"** để đọc tiếp. Cần chủ nghiệp vụ cho biết quy tắc nào nên là mặc định.
3. Logo/icon thương hiệu để đưa vào EXE/Setup và cửa sổ.
4. Chứng thư ký số (để bỏ cảnh báo SmartScreen).
5. Có bản sao dữ liệu thật (đã ẩn thông tin nhạy cảm) để chạy `npm run integrity` trước khi phát hành?
