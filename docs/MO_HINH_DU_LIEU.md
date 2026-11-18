# Mô hình dữ liệu cha–con và truy vết (schema v7)

Nguồn: `src/database/migrations/001…007`, `PRAGMA foreign_key_list` trên DB mới migrate. Khóa ngoại bật (`PRAGMA foreign_keys = ON`).

## Quan hệ chính
```
import_batch (1) ──< (n) import_batch_row ──> (0..1) phieu_can
      │                         hanh_dong: INSERT | SKIP | PENDING_REVIEW | KEEP_OLD | UPDATE | IGNORE
      └──< (n) phieu_can.import_batch_id   (lô TẠO ra phiếu)

phieu_can (n) ──> dot_van_chuyen, don_vi_van_chuyen, tuyen_van_chuyen, bang_gia_van_chuyen, xe, dia_diem (nơi xuất / nơi đến)
phieu_can.chot_ky_id  ── (không có FK) ──> chot_ky      ← kỳ chốt HIỆN HÀNH của phiếu (NULL khi chưa chốt / sau mở khóa)
chot_ky (1) ──< (n) chot_ky_snapshot >── (1) phieu_can  [UNIQUE(chot_ky_id, phieu_can_id)]
doi_chieu_batch (1) ──< doi_chieu_dong_b ; doi_chieu_ket_qua ──> phieu_can, doi_chieu_dong_b
canh_bao(entity, entity_id) , audit_log(entity, entity_id)  — tham chiếu đa hình theo tên bảng, KHÔNG có FK (nhật ký/cảnh báo phải sống lâu hơn bản ghi)
nguoi_dung — độc lập; audit_log.user_name lưu tên đăng nhập dạng chữ
```
| Bảng | Khóa | Ghi chú |
|---|---|---|
| `phieu_can` | `id`; `UNIQUE business_key WHERE trang_thai='ACTIVE'` | danh tính = `so_phieu | nơi xuất (bỏ dấu, hoa)`; `strong_key`, `fingerprint` để phân loại trùng |
| `import_batch_row` | `id`; FK `batch_id`, `phieu_can_id` | **một phiếu có thể có nhiều dòng nguồn** (nhiều lô); `old_json` = bản chụp trước lần cập nhật, `raw_json` = dòng nguồn |
| `chot_ky_snapshot` | `id`; UNIQUE (kỳ, phiếu) | một phiếu có thể nằm trong **nhiều kỳ theo thời gian** (chốt → mở khóa → chốt lại): mỗi lần một snapshot, kỳ cũ giữ `DA_MO_KHOA` |
| `audit_log` | `id` | bất biến (trigger chặn UPDATE/DELETE) |

## Hành vi khi sửa / xóa mềm / hoàn tác
- **Xóa mềm**: `phieu_can.trang_thai='VOID'` (không DELETE). Phiếu VOID không nằm trong báo cáo; khóa `business_key` được giải phóng (nhập lại được → tạo phiếu MỚI, dòng nguồn cũ vẫn trỏ phiếu VOID để truy vết). Phiếu đã chốt kỳ / thuộc đợt khóa: không xóa.
- **Sửa trực tiếp** (`TicketService.update`): ghi audit (giá trị cũ/mới + lý do), tính lại phiếu; chặn phiếu đã chốt, đợt khóa, ngày mới rơi vào kỳ đã chốt.
- **Duyệt từ import** (`resolveReview`): `KEEP_OLD`/`IGNORE` chỉ đổi trạng thái dòng; `UPDATE` ghi `old_json` = trạng thái ngay trước khi cập nhật, cùng các chặn như sửa trực tiếp (đợt khóa, kỳ chốt, trùng khóa).
- **Hoàn tác lô** (`undoBatch`): phiếu do lô tạo → VOID; phiếu lô đã cập nhật → khôi phục `old_json` **chỉ khi** phiếu chưa bị sửa tay sau đó và khóa cũ chưa bị chiếm; không thì chặn và nêu phiếu.
- **Mở khóa kỳ**: `chot_ky_id` của phiếu về NULL, kỳ → `DA_MO_KHOA`; snapshot giữ nguyên làm lịch sử.

## Rà soát JOIN gây nhân phiếu/kg/tiền
Mọi truy vấn tổng hợp (Dashboard, Bảng kê, nhóm báo cáo, Phiếu cân, Chốt kỳ) chạy trên **`phieu_can` kèm bảng chiều nhiều–một** (`don_vi_van_chuyen`, `tuyen_van_chuyen`, `dot_van_chuyen`) → không nhân dòng. Bảng một–nhiều (`import_batch_row`, `canh_bao`, `chot_ky_snapshot`, `doi_chieu_ket_qua`) **không** được JOIN vào truy vấn cộng tiền/kg; các danh sách có JOIN (Cần kiểm tra, Cảnh báo, Lịch sử lô, Kết quả đối chiếu) cố ý hiển thị **một dòng cho mỗi bản ghi con**. Hồi quy: `tests/consistency.test.js` đối chiếu theo tập ID giữa Dashboard/Bảng kê/báo cáo/Excel/snapshot (V.47).

## Phạm vi thao tác hàng loạt (màn Phiếu cân, Cần kiểm tra)
- "Xóa phiếu đã chọn": đúng các **ID đã tick** (giữ qua nhiều trang); đổi bộ lọc thì bỏ chọn. "Xóa tất cả phiếu đang lọc": đúng **ID khớp bộ lọc tại lúc bấm** (mọi trang). Hộp xác nhận hiện số phiếu xóa được / đã chốt / đợt khóa; máy chủ kiểm tra lại từng ID, có phiếu bị khóa thì từ chối cả lô.
- Xử lý hàng loạt "Cần kiểm tra": áp dụng cho **các dòng đang hiển thị**; trong kết quả import chỉ gồm dòng của **lô vừa nhập** (máy chủ từ chối dòng lô khác). Từng dòng một giao dịch riêng, kết quả từng phiếu được liệt kê.

## Kiểm tra toàn vẹn (chỉ đọc)
`npm run integrity -- <file.db>` hoặc nút "Kiểm tra toàn vẹn" ở màn Backup (kênh `system.integrity`): khóa ngoại; phiếu trùng số phiếu + nơi xuất (ví dụ do lỗi cũ nhập hai lần với tên nơi xuất khác chữ); phiếu trùng biển số + giờ cân; chốt kỳ mồ côi / thiếu snapshot / lệch số liệu; lô lệch bộ đếm; dòng chờ của lô đã hoàn tác; cảnh báo mồ côi; tiền lệch; KL lệch |Cân 1 − Cân 2|. **Không tự gộp, xóa hay sửa** — người dùng quyết định từng trường hợp. Không cần migration schema cho phần này.

## Duyệt phiếu từ schema 7
`phieu_can.trang_thai_duyet` nhận `NHAP` hoặc `DA_DUYET`, kèm `nhap_boi`, `duyet_boi`, `duyet_luc`. Phiếu cũ mặc định Đã duyệt. Khi bật quy trình, nhập/sửa/hoàn tác cập nhật số liệu đưa phiếu về Nháp để xác nhận lại. Người sửa gần nhất cần người khác duyệt khi bật phân quyền.

Danh sách và Excel dữ liệu nhập có cả Nháp theo bộ lọc, có cột trạng thái. Dashboard, tổng hợp, bảng kê, đối chiếu và biểu mẫu ký luôn giao phạm vi bộ lọc với điều kiện Đã duyệt ở backend. Bộ lọc Nháp cho kết quả rỗng tại những đầu ra này. Smart Filter dùng phạm vi đếm tương ứng với từng màn.
