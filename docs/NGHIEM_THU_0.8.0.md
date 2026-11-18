# Biên bản nghiệm thu VC Cost 0.8.0 (schema 7)

- Nền: `main` @ `6a5a118` (PR #24 — duyệt từng phiếu), `package.json` 0.7.1, schema 6 → 7 (migration 007). Nhánh nghiệm thu: `claude/nghiem-thu-0.8.0` (PR #25), commit đã build bộ cài: `edd781d`.
- Thay đổi chưa phát hành trước đợt này: chức năng duyệt phiếu (PR #24, đã gộp vào main, chưa có release).
- Môi trường: Linux (Node 22, node:sqlite + better-sqlite3 13.2, Chromium/Playwright) và Windows Server (GitHub Actions `windows-latest`, Electron 45.3.3, bộ cài NSIS/Portable).
- Dữ liệu kiểm tra: SQLite thử + fixture V.47 (2.035 phiếu) + DB v4 mẫu của CI. **Không** dùng dữ liệu thật.

## 1. Bảng phát hiện → sửa → hồi quy
| # | Phát hiện (đã tái hiện bằng test đỏ trước khi sửa) | Mức | Sửa (file:dòng) | Hồi quy |
|---|---|---|---|---|
| 1 | **Phạm vi Nháp do người gọi quyết định**: gọi trực tiếp `reports.dashboard` (và các kênh báo cáo/bảng kê/xuất/chốt kỳ) với `moi_trang_thai` hoặc `trang_thai_duyet:'NHAP'` (kể cả bộ lọc lưu từ bản cũ) làm đổi số liệu, kéo phiếu Nháp vào đầu ra. | Cao | `src/ipc/handlers.js:23-27,237` — biên IPC loại hai khóa này ở mọi kênh; chỉ `tickets.count/list/ids` và `export.tickets` được lọc theo trạng thái duyệt. | `tests/approval-scope.test.js` #1 |
| 2 | **Hoàn tác batch giữ "Đã duyệt"**: phiếu cập nhật qua xung đột → được duyệt → hoàn tác batch: số liệu cũ khôi phục nhưng trạng thái vẫn Đã duyệt (duyệt cho số liệu khác). | Cao | `src/services/TicketImportService.js:395` — khôi phục số liệu cũ thì về Nháp, xóa người/thời điểm duyệt. | `tests/approval-scope.test.js` #2 |
| 3 | **Phiếu đổi sau khi được chọn vẫn bị duyệt** (duyệt áp lên số liệu người duyệt chưa thấy). | Trung bình | `src/services/TicketService.js:126` + `ReportService.tickets` trả `ver`; giao diện gửi `vers` — phiếu đã đổi bị từ chối, nêu rõ lý do (so cả khi sửa hai lần trong cùng một giây). | `tests/approval.test.js` (duyệt kèm phiên bản) |
| 4 | **Đổi ngưỡng KL sau khi xem trước**: commit vẫn ghi phiếu vi phạm ngưỡng hiện hành (dùng kết quả preview). | Trung bình | `src/services/TicketImportService.js:211` — commit kiểm lại dòng NEW/KEY_CONFLICT theo ngưỡng hiện hành, báo số dòng + ví dụ, yêu cầu xem trước lại. | `tests/approval-scope.test.js` #4 |
| 5 | Duyệt không kiểm KL: phiếu có KL ngoài ngưỡng hiện hành vẫn duyệt được. | Thấp | `src/services/TicketService.js:127` — chặn duyệt, yêu cầu sửa KL. | `tests/approval.test.js` (KL ngoài ngưỡng) |
| 6 | Chưa có hồi quy giao diện cho luồng duyệt (nhãn Nháp, Dashboard loại Nháp, duyệt bằng nút). | Thấp | `tests/ui-smoke.mjs` thêm khối "duyệt phiếu". | UI smoke |

## 2. Bảng trạng thái phiếu (khi bật duyệt phiếu)
| Từ | Sự kiện | Đến | Ghi nhận |
|---|---|---|---|
| (không có) | Import commit dòng NEW | NHAP | `nhap_boi` = người đăng nhập (hoặc rỗng khi không phân quyền) |
| DA_DUYET | Sửa trường tài chính (`FINANCIAL`); xử lý xung đột "Cập nhật"; hoàn tác batch kiểu UPDATE | NHAP | xóa `duyet_boi/duyet_luc`, `nhap_boi` = người thao tác |
| DA_DUYET | Sửa chỉ ghi chú, chuyển đợt, tính lại giá, đổi bảng giá | DA_DUYET | giữ nguyên |
| NHAP | `tickets.approve` (quyền duyệt) | DA_DUYET | `duyet_boi`, `duyet_luc`, audit `APPROVE_TICKET` |
| NHAP/DA_DUYET | Xóa mềm / hoàn tác import INSERT | VOID (ACTIVE→VOID) | không tính vào bất kỳ số liệu |

Không duyệt được (kết quả từng phiếu, ID lặp gộp một lần): không còn ACTIVE; đã duyệt; đã đổi sau khi chọn; KL ngoài ngưỡng; ngày thuộc kỳ đã chốt; thuộc đợt đã khóa; người nhập/sửa gần nhất tự duyệt (khi bật phân quyền). Tắt duyệt bị chặn khi còn Nháp ACTIVE; chốt kỳ bị chặn khi còn Nháp trong phạm vi. Khi TẮT duyệt: mọi phiếu = Đã duyệt, hành vi như 0.7.1.

## 3. Ma trận phạm vi Nháp trên đầu ra
Thấy phiếu Nháp: **chỉ** Phiếu cân (`tickets.count/list/ids`) và `export.tickets`. Không thấy Nháp (kiểm bằng test #1 với `moi_trang_thai`, `trang_thai_duyet:'NHAP'`): Dashboard, báo cáo theo xe/đơn vị/nơi xuất/ngày/đợt, Bảng kê, preview/lock chốt kỳ; Excel/PDF và biểu mẫu dùng cùng `ReportService.where`. Đối chiếu đối tác và "Việc cần làm" (chua_tinh_gia/can_doi_chieu/chua_chot) chỉ tính phiếu Đã duyệt; `cho_duyet` đếm riêng.

Đối chiếu cross-screen sau nhập/sửa/xóa/hoàn tác/chuyển đợt/đổi giá/chốt/khôi phục/khởi động lại: `tests/handover-matrix.test.js` (V.47) đạt. Mốc V.47: 2.035 phiếu, 38.563.700 kg, tổng Excel-compat 5.512.904.418,24 đ, tổng bốn bảng kê 5.512.904.418 đ — khẳng định trong `integration`, `consistency`, `handover-matrix` (đạt).

## 4. Chống trùng và toàn vẹn
- Các hồi quy chống trùng hiện có (số 0 đầu, alias nơi xuất, trùng trong file/nhiều file/hai preview, commit lặp, VOID, hoàn tác không ghi đè) đều đạt trong 168 test; không phát hiện lỗi mới ở nhóm này.
- `npm run integrity` trên DB nạp V.47: **không có lỗi toàn vẹn**; thêm kiểm tra `NHAP_KHI_TAT_DUYET`. CI Windows chạy tích hợp trên bản cài: `integrity.ok=true, loi=0` cả 4 ca.
- **Chưa xác minh**: bản sao dữ liệu thật (chưa được cung cấp).

## 5. Kết quả kiểm thử
| Hạng mục | Kết quả |
|---|---|
| `npm test` node:sqlite | 168/168 đạt |
| `VCCOST_DRIVER=better-sqlite3 npm test` | 168/168 đạt |
| UI smoke (Chromium, gồm luồng duyệt) | không lỗi |
| CI Linux (PR #25) và Windows (PR/`edd781d`) | thành công |
| Run bộ cài Windows [44222167023](https://github.com/saoluucvhak-pixel/HAK_VC_HHH/actions/runs/44222167023) (commit `edd781d`) | thành công: test 2 driver, đóng gói, smoke, build Setup+Portable, nghiệm thu 4 ca |

Nghiệm thu bộ cài (từ log run): 
| Ca | Thư mục dữ liệu | Schema | Phiếu | Ghi chú |
|---|---|---:|---:|---|
| Cài mới (mặc định) | `%APPDATA%\VCCost` | 7 | 2.035 | migration 001→007; PDF `%PDF-`, Excel `PK`, sao lưu→khôi phục an toàn, import lại: 2.035 trùng hoàn toàn / 0 ghi mới; chốt kỳ 1.046 phiếu; integrity 0 lỗi |
| Nâng từ DB v4 | `%APPDATA%\VCCost` | 7 | 3 | 4 → 7 (005,006,007); có sao lưu `PRE_MIGRATION` + `AUTO`; integrity 0 lỗi |
| Thư mục dữ liệu tùy chỉnh | `D:\a\_temp\du-lieu-tuy-chinh` | 7 | 2.035 | như ca cài mới |
| Portable | `…\portable-test\VCCost-data` | 7 | 2.035 | như ca cài mới |

Cả 4 ca: `version=0.8.0`, `driver=better-sqlite3`, `electron=45.3.3`, `problems=[]`.

SHA-256 đúng các tệp đã nghiệm thu (run 44222167023, commit `edd781d`):
```
383a7f37818604ce207537c5172eba1c2bb978eb50f9cc34a9669e6e3a23f063  VC-Cost-0.8.0-Portable.exe
da40a6779ee4961106e8e24ab10b5e3722b5444fb07d6af1445dfa67a8b4a9ae  VC-Cost-0.8.0-Setup.exe
```
Lưu ý: bản phát hành chính thức phải được nghiệm thu lại bằng một run trên **commit của `main` sau khi gộp** (squash tạo commit khác `edd781d`); SHA-256 chính thức là của run đó và sẽ được ghi vào ghi chú phát hành.

## 6. Dependency, ký số, thông tin tệp
- `npm audit`: 9 advisory mức cao, **đều** từ `picomatch` qua `electron-builder` (công cụ build, không đóng gói vào ứng dụng; chưa có bản sửa upstream) — như 0.7.x.
- Bộ cài **chưa ký số** (`signExecutable:false`): Windows SmartScreen sẽ cảnh báo. Icon vẫn là icon Electron mặc định (log build: "default Electron icon is used"). Thông tin phiên bản/nhà phát hành EXE: đặt từ 0.7.0, cần xem lại thủ công trên máy Windows.

## 7. Phần chưa xác minh / cần quyết định
1. Chưa chạy trên dữ liệu thật và chưa kiểm tay trên máy Windows thật (chỉ runner CI): thử bằng bản sao DB thật bằng `npm run integrity -- <db>`.
2. Chưa kiểm hiệu năng trên tập lớn hơn V.47; chưa kiểm tra bố cục cửa sổ rất nhỏ ngoài phạm vi UI smoke hiện có.
3. Cần quyết định nghiệp vụ: giá trị ngưỡng KL thật (hiện 100–100.000 kg), mặc định cho file nhiều khối (hiện tắt), có bật duyệt phiếu ngay khi bàn giao hay không (hiện tắt), logo/icon, chứng thư ký số.
4. Phạm vi rà soát lần này tập trung vào duyệt phiếu, phạm vi đầu ra, hoàn tác, ngưỡng KL và nghiệm thu bộ cài; các màn nhập danh mục (xe, địa điểm, tuyến, giá…) dựa trên bộ hồi quy hiện có (không phát hiện lỗi mới), chưa rà từng màn thủ công.

## 8. Hướng dẫn
- **Nâng cấp**: cài đè bản Setup (hoặc thay Portable); lần mở đầu tự tạo bản sao lưu `PRE_MIGRATION` rồi nâng schema 6 → 7. Có thể khôi phục từ màn Sao lưu.
- **Dùng duyệt phiếu**: Cài đặt → "Duyệt từng phiếu" → Lưu. Phiếu mới/sửa là Nháp (nhãn vàng), duyệt ở Phiếu cân (chọn → "Duyệt phiếu đã chọn", hoặc "Duyệt tất cả Nháp theo lọc") hoặc từ bước "Duyệt phiếu Nháp" ở Dashboard. Tắt chỉ được khi không còn Nháp.

## 9. Kết luận
**Bàn giao có điều kiện.** Căn cứ: 168/168 test hai driver, UI smoke, integrity 0 lỗi, run bộ cài Windows đạt 4/4 ca nghiệm thu. Điều kiện: (a) nghiệm thu lại bộ cài trên commit `main` sau gộp PR #25 và dùng đúng các tệp đó để phát hành; (b) các mục chưa xác minh ở mục 7 (đặc biệt dữ liệu thật, ký số) được chủ sản phẩm chấp nhận. Chưa phát hành: chờ bạn duyệt biên bản và xác nhận.
