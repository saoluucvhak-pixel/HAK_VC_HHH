-- Duyệt phiếu (tùy chọn): trạng thái duyệt của từng phiếu cân. Mặc định mọi phiếu (cũ và mới) là DA_DUYET — hành vi không đổi.
-- Chỉ khi bật cài đặt `duyet_phieu`, phiếu mới nhập/được sửa số liệu sẽ là NHAP (chưa vào Dashboard/Bảng kê/báo cáo/chốt kỳ) cho tới khi được duyệt.
ALTER TABLE phieu_can ADD COLUMN trang_thai_duyet TEXT NOT NULL DEFAULT 'DA_DUYET' CHECK (trang_thai_duyet IN ('NHAP','DA_DUYET'));
ALTER TABLE phieu_can ADD COLUMN nhap_boi TEXT;     -- người nhập/sửa số liệu gần nhất (tên đăng nhập; NULL khi không bật phân quyền)
ALTER TABLE phieu_can ADD COLUMN duyet_boi TEXT;
ALTER TABLE phieu_can ADD COLUMN duyet_luc TEXT;
CREATE INDEX ix_phieu_cho_duyet ON phieu_can(trang_thai_duyet) WHERE trang_thai_duyet = 'NHAP';
INSERT INTO schema_version(version, description) VALUES (7, 'Duyệt phiếu tùy chọn: trang_thai_duyet, nhap_boi, duyet_boi, duyet_luc');
