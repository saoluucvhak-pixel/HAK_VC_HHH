# VC Cost 0.8.7 — schema SQLite 9

- Trong **Cài đặt → Mẫu nhập Excel**, quản trị viên có thể chọn sheet, ghép cột từ tiêu đề một hoặc hai dòng, đọc thử, rồi lưu và đặt mẫu mặc định.
- Ứng dụng ghép theo tên tiêu đề khi cột đổi vị trí, quy đổi kg/tấn, giữ số 0 đầu của mã phiếu và đối chiếu tổng công bố khi đọc được.
- Mở **Lịch sử import → Chi tiết** để xem cách đọc của lô và đọc lại đúng file nguồn theo cấu hình đã lưu.

## Cài đặt và nâng cấp

Xuất bản sao lưu ra ổ khác rồi đóng VC Cost trước khi chạy Setup. Schema vẫn là 9. Setup và Portable chưa ký số. Đối chiếu tệp tải về với `SHA256SUMS.txt`.

## VC Cost 0.8.6 — schema SQLite 9

- Bản sao lưu thủ công và tự động mới chứa SQLite và tệp Excel/CSV nguồn trong cùng tệp `.db`. Khôi phục kiểm SHA-256 từng tệp. Bản sao lưu cũ và bản trước import vẫn khôi phục được dữ liệu SQLite.
- Bảng kê chốt mới giữ thông tin bên ký và hợp đồng. Với kỳ cũ, đối chiếu thông tin này với chứng từ gốc.
- Bảng kê lọc có phiếu đã chốt, nhưng không khớp trọn một lần chốt, có nhãn **Tham khảo** trên màn hình, Excel và PDF. Dùng **Lịch sử chốt kỳ** để lấy chứng từ in ký.

## Cài đặt và nâng cấp

Xuất bản sao lưu ra ổ khác rồi đóng VC Cost trước khi chạy Setup. Từ 0.8.5, schema vẫn là 9. Setup và Portable chưa ký số. Đối chiếu tệp tải về với `SHA256SUMS.txt`.

## VC Cost 0.8.5 — schema SQLite 9

- Mở khóa chốt toàn đợt sẽ mở lại đợt và giữ nguyên các phiếu còn khóa theo lần chốt riêng.
- Chốt theo khoảng ngày cho một đơn vị chỉ giới hạn nhập, sửa và duyệt phiếu thuộc phạm vi đó.
- Mở **Lịch sử chốt kỳ → Bảng kê đã chốt** để xem hoặc xuất Excel/PDF theo đúng dữ liệu và quy tắc làm tròn khi chốt. Với kỳ cũ, ứng dụng đối chiếu chi tiết dựng lại với tổng đã lưu. Nếu không khớp, cần dùng chứng từ gốc.
- Kiểm thử giao diện sẽ báo thất bại khi bảng vi phạm quy tắc hiển thị số, ngày hoặc căn lề.

## Nâng cấp
Tạo và xuất bản sao lưu ra thư mục riêng trong bản đang dùng, sau đó đóng ứng dụng rồi chạy Setup. Lần mở đầu tự tạo bản `PRE_MIGRATION` và nâng dữ liệu từ schema 8 lên 9. Để quay lại 0.8.4, dùng bản sao lưu trước nâng cấp. Setup và Portable chưa ký số. Kiểm tra tệp tải về theo `SHA256SUMS.txt`.

## VC Cost 0.8.4 — schema SQLite 8

Ứng dụng quản lý chi phí vận chuyển offline cho HAK. Bản vá sau đợt rà soát toàn diện (bảo mật, nghiệp vụ, kiểm thử, phát hành). Không đổi cấu trúc CSDL (vẫn schema 8), cài đè lên 0.8.3 không cần thao tác thêm.

## Thay đổi trong 0.8.4
- **An toàn**: tên tệp khi nhập/xuất được làm sạch; đọc Excel có giới hạn kích thước (chống tệp phình giải nén); chỉ Admin được xuất sao lưu.
- **Nhập liệu**: bản xem trước cũ được kiểm tra lại khi ghi (không mất dữ liệu âm thầm); nhận diện trùng trong cùng tệp kể cả khi tên địa điểm viết khác nhau.
- **Chốt kỳ/đợt**: chốt một phần nhà xe không khóa cả đợt; đổi quy tắc làm tròn khi đã có kỳ chốt phải xác nhận.
- **Báo cáo**: tiền chỉ tính cho phiếu đã có giá; theo nơi xuất không gộp nơi chưa khớp danh mục.
- **Duyệt phiếu**: chuyển đợt không đưa phiếu Đã duyệt về Nháp.


## 0.8.3
Ứng dụng quản lý chi phí vận chuyển offline cho HAK. Bản vá sau lần kiểm tra thứ hai trên 0.8.2. Không đổi cấu trúc CSDL (vẫn schema 8), cài đè lên 0.8.2 không cần nâng cấp dữ liệu.

### Thay đổi trong 0.8.3
- **Bảng giá**: đổi trạng thái một bảng giá đang có phiếu sử dụng phải xác nhận; hộp xác nhận nói rõ số phiếu sẽ được tính lại và số phiếu đã chốt giữ nguyên. Khi bật duyệt phiếu, phiếu đã duyệt bị đổi tiền được ghi nhật ký và báo ở Trung tâm cảnh báo.
- **Nhập liệu**: hoàn tác một lần import không làm mất dòng "Cần kiểm tra" mà lần import sau còn đang dựa vào.
- **Duyệt phiếu**: bật phân quyền khi duyệt phiếu đã bật mà chỉ có 1 người duyệt → cảnh báo và cho chọn bật luôn *Cho phép tự duyệt*.
- **Giao diện & sao lưu**: ẩn nút giá dầu với vai trò không đủ quyền; mốc xuất sao lưu ra ổ khác hiện giờ địa phương và không bị lùi khi khôi phục dữ liệu cũ.


## 0.8.2
Bản vá sau kiểm tra trên 0.8.1: sửa lỗi vượt quyền bảng giá, nút Duyệt khi bật phân quyền, kẹt duyệt ở chế độ 1 người, hàng chờ "Cần kiểm tra" bị nhân dòng, giao diện cha–con và độ tin cậy sao lưu.

## Thay đổi trong 0.8.2
- **Quyền theo bảng**: bảng giá và giá dầu chỉ người có quyền *Duyệt* mới thêm/sửa/xóa (trước đây quyền *Nhập* tạo được bảng giá riêng làm đổi tổng tiền). Thông số giá chỉ đổi qua "Phiên bản giá mới"; "Áp dụng" bảng tính đơn giá và duyệt kỳ giá dầu có xem trước tác động và xác nhận.
- **Duyệt phiếu**: sửa nút Duyệt bị ẩn khi bật phân quyền; tùy chọn *Cho phép tự duyệt* (mặc định tắt) cho chế độ 1 người; cảnh báo khi bật duyệt/khóa/hạ quyền làm còn dưới 2 người có quyền duyệt; nhãn "Tự duyệt" và nhật ký `tu_duyet`.
- **Nhập liệu**: nhập lại cùng dòng xung đột không tạo thêm dòng chờ; số liệu khác được nhóm theo phiếu; bước xem trước hiện riêng số dòng "đã chờ kiểm tra".
- **Giao diện danh mục cha–con**: xóa dòng con có xác nhận, tiêu đề đường dẫn, làm mới bảng cha sau mọi thay đổi.
- **Sao lưu**: kiểm tra sao lưu tự động mỗi 60 phút (mở qua đêm vẫn có bản AUTO), nhắc xuất ra ổ khác sau 7 ngày (cấu hình được), hộp thoại lưu chọn loại tệp theo đuôi.

## Đã có từ 0.8.1
- Khi bật duyệt, phiếu mới hoặc vừa sửa là Nháp. Phiếu vào số liệu sau khi được duyệt; tài khoản nhập/sửa cần người khác duyệt khi bật phân quyền.
- Backend bảo vệ Dashboard, tổng hợp, bảng kê, đối chiếu và biểu mẫu ký theo trạng thái đã duyệt. Bộ lọc Nháp cho kết quả rỗng ở các đầu ra này; mở rộng trạng thái vẫn giữ phạm vi đã duyệt.
- Màn Phiếu cân xem được Nháp. Excel mặc định chỉ xuất Đã duyệt, có ghi số Nháp bị bỏ qua; lọc Nháp rõ ràng thì xuất dữ liệu Nháp kèm trạng thái.
- Giữ kiểm tra phiên bản trước khi duyệt của 0.8.0; phiên bản bao gồm toàn bộ nội dung cần duyệt và tác vụ hàng loạt lấy đủ phiên bản các phiếu.
- Bộ đếm lọc theo đúng màn nhập/báo cáo; phản hồi đếm cũ được bỏ qua khi đổi lọc nhanh.
- Sửa trực tiếp đối chiếu KL hàng với hai số cân, kiểm tra số hữu hạn và lý do; xóa giờ cân 2 được xử lý đúng.
- Ghi import kiểm lại ngưỡng khối lượng hiện hành. Hoàn tác cập nhật số liệu khi bật duyệt đưa phiếu về Nháp để xác nhận lại.

## Nâng cấp
1. Trong app cũ, tạo bản sao lưu và xuất sang thư mục riêng. Ghi lại đường dẫn dữ liệu đang dùng, rồi đóng app.
2. Cài Setup mới hoặc dùng Portable với đúng thư mục dữ liệu.
3. Schema 6/7 nâng lên 8 (migration 008 dựng lại một bảng nhỏ, giữ nguyên dữ liệu); các phiếu cũ mang trạng thái Đã duyệt. Ứng dụng tạo PRE_MIGRATION trước khi nâng schema; duyệt phiếu mặc định tắt.
4. Nếu bật duyệt, mở Phiếu cân và lọc Nháp để xử lý. Báo cáo và chứng từ có ghi phạm vi đã duyệt.
5. Đối chiếu cùng bộ lọc sau nâng cấp. Giữ PRE_MIGRATION để phục hồi nếu cần dùng lại bản cũ phù hợp schema.

## Kiểm tra và giới hạn
Bộ cài được lấy từ Windows CI sau các bước kiểm thử, cài mới, nâng từ bản cũ lên schema 8, thư mục tùy chỉnh và Portable. Mỗi bộ cài có SHA-256 kèm theo.

Bộ cài chưa ký số. Tại lần kiểm tra dependency, runtime có 0 cảnh báo; cây công cụ build còn 9 mục high từ picomatch (GHSA-fc5q-39xc-vjpf), chờ bản vá upstream. Kết quả nghiệm thu dùng fixture và DB thử.
