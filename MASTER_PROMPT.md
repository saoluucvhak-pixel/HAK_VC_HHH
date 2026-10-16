# MASTER PROMPT
## XÂY DỰNG ỨNG DỤNG OFFLINE QUẢN LÝ – TÍNH TOÁN – ĐỐI CHIẾU CHI PHÍ VẬN CHUYỂN

Bạn đóng vai trò đồng thời là:

- Senior Software Architect
- Senior Full-stack Developer
- Chuyên gia thiết kế SQLite
- Chuyên gia xử lý Excel
- Chuyên gia nghiệp vụ logistics/vận tải
- Chuyên gia kiểm soát dữ liệu và đối chiếu chi phí
- UI/UX Designer cho ứng dụng quản trị doanh nghiệp

Nhiệm vụ của bạn là phân tích file Excel mẫu được cung cấp và xây dựng một ứng dụng desktop OFFLINE hoàn chỉnh để quản lý, tính toán và đối chiếu chi phí vận chuyển.

Không chỉ sao chép Excel thành giao diện.

Phải thiết kế lại thành một hệ thống dữ liệu có cấu trúc, có khả năng kiểm tra, truy vết, mở rộng và sử dụng lâu dài.

---

# I. MỤC TIÊU HỆ THỐNG

Ứng dụng phải giải quyết toàn bộ quy trình:

PHIẾU CÂN
→ IMPORT
→ CHUẨN HÓA
→ KIỂM TRA
→ XÁC ĐỊNH XE
→ XÁC ĐỊNH ĐƠN VỊ VẬN CHUYỂN
→ XÁC ĐỊNH TUYẾN
→ TRA BẢNG GIÁ
→ TÍNH CHI PHÍ TỪNG CHUYẾN
→ TỔNG HỢP THEO XE
→ TỔNG HỢP THEO ĐƠN VỊ
→ ĐỐI CHIẾU
→ BÁO CÁO
→ XUẤT EXCEL.

Ứng dụng phải chạy hoàn toàn offline trên Windows.

Internet không được là điều kiện bắt buộc để sử dụng.

---

# II. CÔNG NGHỆ ĐỀ XUẤT

Ưu tiên:

Electron
+ HTML5
+ CSS3
+ JavaScript/TypeScript
+ SQLite.

Có thể sử dụng React/Vue nếu thực sự cần thiết.

Database:

SQLite.

Excel:

sử dụng thư viện đọc/ghi XLSX ổn định.

Ứng dụng cuối cùng phải có khả năng build:

Windows .exe

và ưu tiên có:

1. Portable version
2. Setup installer version.

Không sử dụng Google Sheets làm database chính.

Không yêu cầu server.

Không yêu cầu đăng nhập Internet.

---

# III. FILE EXCEL NGHIỆP VỤ MẪU

File Excel mẫu hiện tại có các sheet:

1. Giá dầu + Giá VC
2. Số xe
3. File tổng
4. CP VC tại ĐH (HHH)
5. Xe chạy QS (HHH)
6. Xe chạy QS (HAK)

Phải phân tích công thức, dữ liệu và quan hệ giữa các sheet trước khi viết code.

Không được chỉ đọc giá trị hiển thị.

Phải tìm hiểu logic của các công thức Excel hiện có như:

COUNTIFS
SUMIFS
SUM
ROUND
AVERAGE

và chuyển logic nghiệp vụ đó thành engine tính toán trong ứng dụng.

---

# IV. DỮ LIỆU PHIẾU CÂN

Trong file mẫu, bảng dữ liệu gốc có các trường chính:

- STT
- Số phiếu
- Ngày giờ cân 1
- Ngày giờ cân 2
- Biển số 1
- Cân lần 1
- Cân lần 2
- Khối lượng hàng KG
- Nơi xuất
- Công ty vận chuyển.

Thiết kế bảng PHIEU_CAN tối thiểu:

id
so_phieu
ngay_gio_can_1
ngay_gio_can_2
bien_so
can_lan_1
can_lan_2
kl_hang_kg
kl_hang_tan
noi_xuat
noi_den
tuyen_id
don_vi_van_chuyen_id
dot_van_chuyen_id
bang_gia_id
don_gia
tien_truoc_vat
ty_le_vat
tien_vat
tong_tien
import_batch_id
trang_thai
ghi_chu
created_at
updated_at.

Trong đó:

kl_hang_tan = kl_hang_kg / 1000.

Tiền trước VAT:

THANH_TIEN = KL_TAN × DON_GIA.

VAT:

VAT = THANH_TIEN × TY_LE_VAT.

Tổng thanh toán:

TONG_TIEN = THANH_TIEN + VAT.

Không được hard-code VAT 8%.

VAT phải lấy từ bảng giá hoặc cấu hình.

---

# V. KHÓA CHỐNG TRÙNG

Đặc biệt chú ý dữ liệu import nhiều lần.

Không được để cùng một phiếu cân bị nhân đôi chi phí.

Xây dựng cơ chế duplicate detection.

Ưu tiên khóa:

Số phiếu + Nơi xuất

hoặc khóa mạnh hơn:

Số phiếu
+ Biển số
+ Ngày giờ cân 1
+ Nơi xuất.

Thiết kế thêm fingerprint/hash cho từng dòng.

Khi import lại cùng file:

không tạo dữ liệu trùng.

Phải phân loại:

MỚI
TRÙNG HOÀN TOÀN
TRÙNG KHÓA NHƯNG KHÁC DỮ LIỆU
DỮ LIỆU ĐÃ TỒN TẠI NHƯNG ĐÃ THAY ĐỔI.

Nếu trùng khóa nhưng khác:

khối lượng
biển số
thời gian
nơi xuất

thì không tự động ghi đè.

Phải đưa vào màn hình:

"Cần kiểm tra".

Cho người dùng chọn:

Giữ dữ liệu cũ
Cập nhật dữ liệu mới
Bỏ qua.

---

# VI. DANH MỤC XE

Tạo bảng:

XE

bao gồm:

id
bien_so_chuan
bien_so_hien_thi
don_vi_van_chuyen_id
loai_xe
tai_trong
trang_thai
tu_ngay
den_ngay
ghi_chu.

File hiện tại có sheet "Số xe":

Biển số → Tên Công ty.

Phải cho phép import danh mục này.

Ví dụ các đơn vị trong file hiện tại có:

HHH
HAK
QC
ĐH.

Không được hard-code các đơn vị này trong source code.

Người dùng phải thêm/sửa/xóa được danh mục.

---

# VII. CHUẨN HÓA BIỂN SỐ

Trước khi đối chiếu phải normalize biển số.

Ví dụ:

43H-01021
43H 01021
43H.01021
43h01021

phải có khả năng quy về cùng một mã chuẩn nếu thực tế là cùng xe.

Nhưng phải giữ lại:

bien_so_goc

để truy vết dữ liệu import.

Nếu xe chưa tồn tại trong danh mục:

KHÔNG tự gán công ty vận chuyển.

Đánh dấu:

XE CHƯA XÁC ĐỊNH.

Cho phép người dùng gán xe vào công ty.

Sau khi gán, hệ thống có thể cập nhật lại các phiếu liên quan.

---

# VIII. ĐƠN VỊ VẬN CHUYỂN

Tạo bảng:

DON_VI_VAN_CHUYEN

gồm:

id
ma
ten
ma_so_thue
dia_chi
nguoi_lien_he
dien_thoai
trang_thai
ghi_chu.

Một xe có thể thay đổi đơn vị quản lý theo thời gian.

Vì vậy cần hỗ trợ lịch sử:

XE
→ ĐƠN VỊ VẬN CHUYỂN
→ TỪ NGÀY
→ ĐẾN NGÀY.

Không nên chỉ lưu duy nhất tên công ty trực tiếp trong bảng phiếu cân.

---

# IX. ĐỊA ĐIỂM VÀ TUYẾN VẬN CHUYỂN

Tạo danh mục:

DIA_DIEM

và:

TUYEN_VAN_CHUYEN.

Ví dụ:

Đại Hiệp → Cảng Tiên Sa
Hoàng Anh Khôi → Cảng Tiên Sa
Quảng Nam → Cảng Tiên Sa
Quế Sơn → điểm giao nhận tương ứng.

Tuyến gồm:

id
ma_tuyen
noi_xuat
noi_den
khoang_cach_km
mo_ta
trang_thai.

Không hard-code tuyến vào source code.

---

# X. BẢNG GIÁ VẬN CHUYỂN

Đây là module cực kỳ quan trọng.

Tạo bảng:

BANG_GIA_VAN_CHUYEN.

Các trường:

id
ma_bang_gia
tuyen_id
don_vi_van_chuyen_id
loai_hang
tu_ngay
den_ngay
don_gia_goc
don_gia_dieu_chinh
don_gia_ap_dung
don_vi_tinh
vat_percent
gia_dau_co_so
gia_dau_ap_dung
dinh_muc_dau
khoi_luong_binh_quan
cong_thuc
trang_thai
ghi_chu.

Đơn vị giá hỗ trợ ít nhất:

đồng/tấn
đồng/chuyến.

Thiết kế mở để sau này có thể thêm phương thức khác.

Một bảng giá bắt buộc có:

TỪ NGÀY.

Có thể có:

ĐẾN NGÀY.

Khi tính phiếu cân:

NGÀY CÂN phải nằm trong khoảng hiệu lực của bảng giá.

Nếu có nhiều bảng giá cùng phù hợp:

không tự chọn tùy ý.

Đánh dấu:

XUNG ĐỘT BẢNG GIÁ.

Nếu không tìm thấy:

CHƯA CÓ ĐƠN GIÁ.

---

# XI. GIÁ CƯỚC ĐIỀU CHỈNH THEO GIÁ DẦU

File Excel mẫu có logic điều chỉnh giá vận chuyển theo biến động giá dầu.

Phải chuyển logic này thành một module riêng.

Các tham số:

Giá cước cơ sở
Giá dầu cơ sở
Giá dầu kỳ hiện tại
Khoảng cách
Định mức tiêu hao dầu
Khối lượng bình quân/chuyến
Ngày hiệu lực.

Công thức tổng quát:

Chênh lệch giá dầu
=
Giá dầu hiện tại - Giá dầu cơ sở.

Lượng dầu/chuyến
=
Khoảng cách × định mức tiêu hao.

Chi phí dầu chênh lệch/chuyến
=
Lượng dầu × Chênh lệch giá dầu.

Cước điều chỉnh/tấn
=
Chi phí dầu chênh lệch/chuyến
/
Khối lượng bình quân/chuyến.

Đơn giá áp dụng
=
Đơn giá cơ sở + cước điều chỉnh.

Phải hỗ trợ quy tắc làm tròn.

Không hard-code 35 lít/100 km.

Không hard-code 19 tấn/chuyến.

Không hard-code khoảng cách.

Tất cả phải là tham số cấu hình.

Lưu lịch sử mỗi lần thay đổi giá dầu.

Không được làm thay đổi đơn giá của các chuyến đã chốt trước đó.

---

# XII. ĐỢT VẬN CHUYỂN / TÀU

File mẫu đang quản lý theo:

Tên tàu
Số voyage
Từ ngày
Đến ngày.

Ví dụ dạng:

PRINCE OF NATURE V.47.

Tạo bảng:

DOT_VAN_CHUYEN

gồm:

id
ma_dot
ten_tau
voyage
tu_ngay
den_ngay
khach_hang
noi_giao
trang_thai
ghi_chu.

Một phiếu cân có thể thuộc một đợt/tàu.

Cho phép:

Tạo đợt
Import phiếu vào đợt
Chuyển phiếu sang đợt khác
Khóa đợt.

Sau khi khóa:

không được tự động thay đổi dữ liệu tài chính.

---

# XIII. IMPORT EXCEL

Tạo màn hình:

IMPORT PHIẾU CÂN.

Cho phép:

.xlsx
.xls
.csv nếu khả thi.

Không giả định header luôn nằm dòng 1.

Hệ thống phải:

1. đọc workbook;
2. hiển thị danh sách sheet;
3. cho chọn sheet;
4. tự dò dòng header;
5. tự nhận dạng cột;
6. hiển thị preview;
7. cho người dùng mapping lại cột;
8. validate;
9. import.

Mapping cần nhận dạng các tên tương đương.

Ví dụ:

"Số phiếu"
"So phieu"
"Phiếu"
"Số chứng từ"

có thể được map vào:

so_phieu.

Tương tự cho:

Ngày cân 1
Giờ cân 1
Ngày giờ cân 1
Biển số
Số xe
KL hàng
Khối lượng
Nơi xuất.

---

# XIV. IMPORT PREVIEW

Trước khi ghi database phải có màn hình preview.

Hiển thị:

Tổng số dòng
Dòng hợp lệ
Dòng mới
Dòng trùng
Dòng lỗi
Xe chưa xác định
Nơi xuất chưa xác định
Không có bảng giá
Xung đột bảng giá.

Dùng màu trạng thái.

Không được ghi thẳng dữ liệu vào database ngay khi người dùng chọn file.

Quy trình:

CHỌN FILE
→ PREVIEW
→ VALIDATE
→ NGƯỜI DÙNG XÁC NHẬN
→ COMMIT DATABASE.

Import phải dùng transaction.

Nếu lỗi giữa chừng:

rollback.

---

# XV. LỊCH SỬ IMPORT

Tạo bảng:

IMPORT_BATCH.

Lưu:

id
file_name
file_hash
sheet_name
import_time
total_rows
inserted_rows
duplicate_rows
error_rows
updated_rows
user_note.

Người dùng phải xem lại được:

"Lần import này đã thêm những phiếu nào?"

Có chức năng hoàn tác một batch import nếu các dữ liệu đó chưa được khóa/chốt.

---

# XVI. ENGINE TÍNH CHI PHÍ

Tuyệt đối không tính tiền rải rác trong giao diện.

Xây dựng một service/module riêng:

TRANSPORT_COST_ENGINE.

Input:

phiếu cân
xe
đơn vị vận chuyển
tuyến
ngày vận chuyển
bảng giá.

Output:

KL tấn
bảng giá sử dụng
đơn giá
tiền trước VAT
VAT
tổng tiền
trạng thái tính giá.

Mỗi kết quả phải lưu:

price_rule_id

để sau này biết chính xác:

"Tại sao phiếu này có đơn giá này?"

---

# XVII. BẢNG CHI TIẾT VẬN CHUYỂN

Tạo màn hình:

CHI TIẾT VẬN CHUYỂN.

Các cột:

STT
Số phiếu
Ngày
Giờ cân 1
Giờ cân 2
Biển số
Công ty vận chuyển
Nơi xuất
Nơi đến
Tuyến
Cân lần 1
Cân lần 2
KL hàng KG
KL tấn
Đơn giá
Thành tiền
VAT
Tổng tiền
Đợt/Tàu
Trạng thái đối chiếu
Ghi chú.

Có:

search
filter
sort
group
export Excel.

---

# XVIII. CHI TIẾT TỪNG XE THEO THỜI GIAN

Đây là chức năng bắt buộc.

Người dùng chọn:

Biển số.

Sau đó chọn:

Từ ngày
Đến ngày.

Hiển thị timeline toàn bộ chuyến của xe.

Các cột:

STT
Ngày
Giờ vào/cân 1
Giờ ra/cân 2
Số phiếu
Nơi xuất
Nơi đến
Khối lượng KG
Khối lượng tấn
Đơn giá
Thành tiền
VAT
Tổng tiền
Thời gian cân
Khoảng cách thời gian với chuyến trước.

Tính:

THỜI GIAN CÂN
=
Ngày giờ cân 2 - Ngày giờ cân 1.

Tính:

KHOẢNG CÁCH CHUYẾN
=
Ngày giờ cân 1 chuyến hiện tại
-
Ngày giờ cân 2 chuyến trước.

Cho phép cấu hình ngưỡng cảnh báo.

Ví dụ nếu thời gian giữa hai chuyến quá ngắn thì đánh dấu:

"Cần kiểm tra thời gian".

Không kết luận gian lận tự động.

Chỉ cảnh báo dữ liệu bất thường.

---

# XIX. TỔNG HỢP THEO XE

Tạo bảng:

TỔNG HỢP XE.

Cột:

STT
Biển số
Đơn vị vận chuyển
Số chuyến
Tổng KG
Tổng tấn
Đơn giá hoặc nhóm đơn giá
Tiền trước VAT
VAT
Tổng tiền.

Cho phép drill-down:

double click một xe
→ mở danh sách toàn bộ chuyến của xe.

Không cần tạo một sheet riêng cho từng xe như Excel.

---

# XX. TỔNG HỢP THEO ĐƠN VỊ VẬN CHUYỂN

Báo cáo:

Đơn vị
Số xe
Số chuyến
Tổng KG
Tổng tấn
Tiền trước VAT
VAT
Tổng tiền.

Cho phép drill-down:

Đơn vị
→ Xe
→ Chuyến
→ Phiếu cân.

---

# XXI. TỔNG HỢP THEO NƠI XUẤT

Báo cáo:

Nơi xuất
Số chuyến
Tổng khối lượng
Chi phí trước VAT
VAT
Tổng chi phí.

Cho phép tiếp tục phân tích:

Nơi xuất
→ Công ty VC
→ Xe
→ Phiếu cân.

---

# XXII. BẢNG ĐỐI CHIẾU CHI PHÍ VẬN CHUYỂN

Tạo module riêng:

ĐỐI CHIẾU.

Nguồn A:

Chi phí do hệ thống tính từ phiếu cân.

Nguồn B:

Bảng kê/đề nghị thanh toán/hóa đơn/bảng chi phí do đơn vị vận chuyển cung cấp.

Cho phép import nguồn B từ Excel.

Đối chiếu theo nhiều khóa.

Ưu tiên:

Số phiếu

hoặc:

Biển số
+ ngày
+ khối lượng.

Kết quả:

KHỚP
THIẾU BÊN A
THIẾU BÊN B
LỆCH KHỐI LƯỢNG
LỆCH ĐƠN GIÁ
LỆCH TIỀN
LỆCH VAT
TRÙNG DỮ LIỆU
CẦN KIỂM TRA.

---

# XXIII. ĐỐI CHIẾU PHẢI HIỂN THỊ CHÊNH LỆCH

Ví dụ:

KL hệ thống
KL đối tác
Chênh KL

Đơn giá hệ thống
Đơn giá đối tác
Chênh đơn giá

Tiền hệ thống
Tiền đối tác
Chênh tiền.

Không chỉ ghi "Không khớp".

Phải chỉ ra:

CỘT NÀO KHÔNG KHỚP
và
CHÊNH BAO NHIÊU.

---

# XXIV. DASHBOARD

Trang chủ phải có Dashboard.

KPI:

Tổng chuyến
Tổng khối lượng
Tổng chi phí vận chuyển
Tổng VAT
Tổng thanh toán
Số xe
Số đơn vị vận chuyển
Phiếu chưa có giá
Phiếu chưa xác định xe
Phiếu lỗi
Phiếu cần đối chiếu.

Filter toàn dashboard:

Từ ngày
Đến ngày
Đợt/Tàu
Nơi xuất
Tuyến
Đơn vị vận chuyển.

---

# XXV. BIỂU ĐỒ

Có thể có:

Khối lượng theo ngày

Chi phí theo ngày

Số chuyến theo ngày

Khối lượng theo nơi xuất

Chi phí theo đơn vị vận chuyển

Top xe theo số chuyến

Top xe theo khối lượng.

Biểu đồ phải lấy trực tiếp từ dữ liệu đang filter.

---

# XXVI. CẢNH BÁO DỮ LIỆU

Tạo "Trung tâm cảnh báo".

Các loại:

DUPLICATE_TICKET
UNKNOWN_VEHICLE
UNKNOWN_CARRIER
UNKNOWN_LOCATION
NO_PRICE
MULTIPLE_PRICE
INVALID_WEIGHT
INVALID_TIME
TIME_ANOMALY
PRICE_CHANGED
UNMATCHED_RECONCILIATION.

Mỗi cảnh báo phải có:

Loại
Mức độ
Dữ liệu liên quan
Nguyên nhân
Cách xử lý
Trạng thái xử lý.

---

# XXVII. CHỐT CHI PHÍ

Cần có chức năng:

CHỐT KỲ / CHỐT ĐỢT.

Khi chốt:

lưu snapshot:

KL
đơn giá
VAT
thành tiền
bảng giá
đơn vị VC
tuyến.

Sau khi chốt:

thay đổi bảng giá không được làm thay đổi dữ liệu lịch sử.

Muốn sửa phải:

MỞ KHÓA
→ ghi log
→ sửa
→ tính lại
→ chốt lại.

---

# XXVIII. AUDIT LOG

Mọi thao tác quan trọng phải được ghi log:

Import
Xóa import
Sửa phiếu
Thay xe
Thay công ty
Thay tuyến
Thay đơn giá
Chốt
Mở khóa
Đối chiếu
Sửa kết quả.

Audit log gồm:

timestamp
action
entity
entity_id
old_value
new_value
note.

---

# XXIX. BACKUP DATABASE

Ứng dụng offline bắt buộc có backup.

Database không đặt lẫn với source code.

Ví dụ:

/data/app.db
/backups/
/exports/
/imports/
/logs/.

Có chức năng:

Backup ngay
Restore
Auto backup.

Ví dụ tự động:

1 backup/ngày.

Không xóa backup cũ mà không có quy tắc retention.

---

# XXX. XUẤT EXCEL

Cho phép xuất:

1. Chi tiết vận chuyển
2. Tổng hợp theo xe
3. Tổng hợp theo công ty VC
4. Tổng hợp theo nơi xuất
5. Bảng đối chiếu
6. Bảng sai lệch
7. Chi tiết từng xe
8. Báo cáo theo đợt/tàu.

Excel xuất phải chuyên nghiệp:

tiêu đề
filter
freeze header
định dạng ngày
định dạng tiền
định dạng kg/tấn
tổng cộng
không mất số 0 đầu
không biến biển số thành kiểu số.

---

# XXXI. UI/UX

Thiết kế desktop chuyên nghiệp.

Sidebar:

TỔNG QUAN

Dashboard

VẬN CHUYỂN

Phiếu cân
Import phiếu cân
Chi tiết vận chuyển
Theo xe

CHI PHÍ

Bảng giá
Giá dầu
Tính chi phí

ĐỐI CHIẾU

Import đối chiếu
Kết quả đối chiếu
Sai lệch

DANH MỤC

Xe
Đơn vị vận chuyển
Địa điểm
Tuyến
Đợt/Tàu

BÁO CÁO

Theo xe
Theo công ty
Theo nơi xuất
Theo thời gian
Theo tàu

HỆ THỐNG

Lịch sử import
Audit log
Backup
Cài đặt.

---

# XXXII. YÊU CẦU HIỆU NĂNG

Không load toàn bộ dữ liệu vào DOM.

Sử dụng:

pagination
virtual scrolling
SQL aggregation
index database.

Tạo index tối thiểu cho:

so_phieu
bien_so
ngay_gio_can_1
don_vi_van_chuyen_id
tuyen_id
noi_xuat
dot_van_chuyen_id
import_batch_id.

Hệ thống phải xử lý ổn định ít nhất hàng trăm nghìn phiếu cân.

---

# XXXIII. NGUYÊN TẮC KIẾN TRÚC

Không viết toàn bộ chương trình trong một file HTML.

Không tạo một file JavaScript hàng chục nghìn dòng.

Phải module hóa.

Ví dụ:

/src
  /database
  /services
  /repositories
  /models
  /modules
  /components
  /utils
  /excel
  /reports
  /validation

Các service quan trọng:

ExcelImportService
TicketService
VehicleService
CarrierService
RouteService
PriceService
FuelPriceService
TransportCostService
ReconciliationService
ReportService
BackupService
AuditService.

---

# XXXIV. DATABASE MIGRATION

Phải có:

schema_version.

Khi nâng cấp app:

không được xóa database cũ.

Phải có migration:

v1 → v2
v2 → v3
...

Không được dùng cách:

"database thay đổi thì xóa DB tạo lại".

---

# XXXV. KIỂM THỬ

Viết test cho các nghiệp vụ quan trọng.

Test:

kg → tấn

tính tiền

VAT

bảng giá theo ngày

giá thay đổi giữa kỳ

giá dầu thay đổi

duplicate phiếu

xe chưa xác định

nhiều bảng giá cùng hiệu lực

không có bảng giá

import cùng file hai lần

đối chiếu lệch KL

đối chiếu lệch giá

đối chiếu lệch tiền

chốt kỳ

mở khóa.

---

# XXXVI. TEST DỰA TRÊN FILE EXCEL MẪU

Sau khi xây dựng engine:

import file Excel mẫu.

Sau đó so sánh kết quả app với Excel.

Đối chiếu:

Số chuyến
Tổng KG
Tổng tấn
Đơn giá
Thành tiền
VAT
Tổng tiền.

So sánh theo:

biển số
nơi xuất
đơn vị vận chuyển.

Nếu app khác Excel:

không được sửa số thủ công để khớp.

Phải tìm nguyên nhân:

logic
mapping
bảng giá
ngày hiệu lực
làm tròn
VAT
dữ liệu trùng.

Tạo báo cáo:

EXCEL_VS_APP_VALIDATION.

---

# XXXVII. KHÔNG ĐƯỢC LÀM

Không hard-code:

biển số
công ty vận chuyển
nơi xuất
đơn giá
VAT
giá dầu
khoảng cách
19 tấn
35L/100km.

Không sửa dữ liệu nguồn âm thầm.

Không tự xóa duplicate.

Không tự gán xe chưa xác định.

Không tự chọn bảng giá khi có nhiều bảng giá phù hợp.

Không làm mất lịch sử giá.

Không tính lại chứng từ đã chốt mà không có thao tác mở khóa.

Không dùng Excel làm database.

---

# XXXVIII. YÊU CẦU VỀ TÍNH TOÁN TIỀN

Không sử dụng floating-point thông thường một cách thiếu kiểm soát cho tiền.

Phải có quy tắc decimal/rounding rõ ràng.

Phân biệt:

Khối lượng KG
Khối lượng tấn
Đơn giá
Thành tiền
VAT
Tổng tiền.

Cho phép cấu hình quy tắc làm tròn:

đơn giá
thành tiền
VAT
tổng tiền.

Kết quả phải có khả năng đối chiếu với Excel và chứng từ kế toán.

---

# XXXIX. PHƯƠNG PHÁP TRIỂN KHAI

Không viết toàn bộ ứng dụng ngay lập tức.

Thực hiện theo phase.

PHASE 1
Phân tích Excel và nghiệp vụ.

PHASE 2
Thiết kế database.

PHASE 3
Xây dựng danh mục.

PHASE 4
Xây dựng Excel Import Engine.

PHASE 5
Xây dựng phiếu cân.

PHASE 6
Xây dựng bảng giá và Fuel Adjustment Engine.

PHASE 7
Xây dựng Transport Cost Engine.

PHASE 8
Xây dựng báo cáo xe.

PHASE 9
Xây dựng Reconciliation Engine.

PHASE 10
Dashboard.

PHASE 11
Audit + Backup.

PHASE 12
Test với Excel mẫu.

PHASE 13
Build Windows Portable.

PHASE 14
Build Windows Setup.

---

# XL. TÀI LIỆU DỰ ÁN

Bắt buộc tạo:

README.md

MASTER_PROMPT.md

PROJECT_SPEC.md

DATABASE_SCHEMA.md

BUSINESS_RULES.md

IMPORT_SPEC.md

PRICE_ENGINE_SPEC.md

RECONCILIATION_SPEC.md

UI_SPEC.md

TEST_PLAN.md

CHANGELOG.md

TODO_ROADMAP.md.

Mọi thay đổi nghiệp vụ về sau phải cập nhật tài liệu tương ứng.

---

# XLI. TIÊU CHÍ HOÀN THÀNH

Ứng dụng chỉ được xem là hoàn thành khi:

1. Import được file phiếu cân.
2. Không sinh duplicate khi import lại.
3. Xác định được xe.
4. Xác định được đơn vị vận chuyển.
5. Xác định được tuyến.
6. Tra đúng bảng giá theo thời gian.
7. Tính đúng chi phí từng phiếu.
8. Tổng hợp đúng theo xe.
9. Tổng hợp đúng theo đơn vị VC.
10. Xem được lịch sử từng xe theo thời gian.
11. Đối chiếu được bảng chi phí bên ngoài.
12. Chỉ ra chính xác sai lệch.
13. Xuất được Excel.
14. Có dashboard.
15. Có audit log.
16. Có backup/restore.
17. Kết quả kiểm thử khớp với file Excel mẫu.
18. Chạy hoàn toàn offline.
19. Có bản Windows Portable.
20. Có bản Windows Setup.

---

# XLII. YÊU CẦU CUỐI CÙNG CHO AI LẬP TRÌNH

Trước khi code, hãy:

1. Đọc toàn bộ file Excel mẫu.
2. Liệt kê tất cả sheet.
3. Phân tích header từng sheet.
4. Phân tích công thức.
5. Xác định các bảng dữ liệu gốc.
6. Xác định các bảng báo cáo.
7. Xác định khóa liên kết.
8. Xác định quy tắc tính chi phí.
9. Xác định các mức giá và thời gian hiệu lực.
10. Xác định những điểm chưa rõ.

Sau đó trình bày:

A. Phân tích hệ thống hiện tại.

B. ERD/database đề xuất.

C. Data flow.

D. Business rules.

E. Cấu trúc source code.

F. Kế hoạch triển khai.

G. Các rủi ro dữ liệu.

H. Các điểm cần cải tiến so với Excel.

Chỉ sau khi hoàn thành thiết kế trên mới bắt đầu code.

Mục tiêu cuối cùng không phải "chuyển Excel thành app".

Mục tiêu là xây dựng:

HỆ THỐNG QUẢN LÝ CHI PHÍ VẬN CHUYỂN OFFLINE

có khả năng:

IMPORT
→ KIỂM SOÁT
→ TÍNH GIÁ
→ THEO DÕI XE
→ ĐỐI CHIẾU
→ PHÂN TÍCH
→ BÁO CÁO
→ TRUY VẾT

một cách chính xác, ổn định và có thể mở rộng lâu dài.