# VC Cost 0.8.0 — schema SQLite 7

Ứng dụng quản lý chi phí vận chuyển offline cho HAK. Bản này tích hợp duyệt phiếu tùy chọn và sửa phạm vi báo cáo/chứng từ.

## Thay đổi
- Khi bật duyệt, phiếu mới hoặc vừa sửa là Nháp. Phiếu vào số liệu sau khi được duyệt; tài khoản nhập/sửa cần người khác duyệt khi bật phân quyền.
- Backend bảo vệ Dashboard, tổng hợp, bảng kê, đối chiếu và biểu mẫu ký theo trạng thái đã duyệt. Bộ lọc Nháp cho kết quả rỗng ở các đầu ra này; mở rộng trạng thái vẫn giữ phạm vi đã duyệt.
- Màn Phiếu cân xem được Nháp. Excel dữ liệu nhập ghi rõ trạng thái duyệt, phục vụ kiểm tra nguồn.
- Bộ đếm lọc theo đúng màn nhập/báo cáo; phản hồi đếm cũ được bỏ qua khi đổi lọc nhanh.
- Sửa trực tiếp đối chiếu KL hàng với hai số cân, kiểm tra số hữu hạn và lý do; xóa giờ cân 2 được xử lý đúng.
- Ghi import kiểm lại ngưỡng khối lượng hiện hành. Hoàn tác cập nhật số liệu khi bật duyệt đưa phiếu về Nháp để xác nhận lại.

## Nâng cấp
1. Trong app cũ, tạo bản sao lưu và xuất sang thư mục riêng. Ghi lại đường dẫn dữ liệu đang dùng, rồi đóng app.
2. Cài Setup mới hoặc dùng Portable với đúng thư mục dữ liệu.
3. Schema 6 nâng lên 7, các phiếu cũ mang trạng thái Đã duyệt. Ứng dụng tạo PRE_MIGRATION trước khi nâng schema; duyệt phiếu mặc định tắt.
4. Nếu bật duyệt, mở Phiếu cân và lọc Nháp để xử lý. Báo cáo và chứng từ có ghi phạm vi đã duyệt.
5. Đối chiếu cùng bộ lọc sau nâng cấp. Giữ PRE_MIGRATION để phục hồi nếu cần dùng lại bản cũ phù hợp schema.

## Kiểm tra và giới hạn
Bộ cài được lấy từ Windows CI sau các bước kiểm thử, cài mới, nâng schema 4/6 lên 7, thư mục tùy chỉnh và Portable. Mỗi bộ cài có SHA-256 kèm theo.

Bộ cài chưa ký số. Tại lần kiểm tra dependency, runtime có 0 cảnh báo; cây công cụ build còn 9 mục high từ picomatch (GHSA-fc5q-39xc-vjpf), chờ bản vá upstream. Kết quả nghiệm thu dùng fixture và DB thử.
