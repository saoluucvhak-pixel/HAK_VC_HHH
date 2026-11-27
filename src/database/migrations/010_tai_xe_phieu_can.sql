ALTER TABLE phieu_can ADD COLUMN tai_xe TEXT;
INSERT INTO schema_version(version, description) VALUES (10, 'Lưu tên tài xế từ phiếu cân');
