-- 005: bất biến ở mức CSDL — ảnh chụp chốt kỳ (số đã ký) và nhật ký kiểm toán chỉ được THÊM, không sửa/xóa.
-- Trước đây chỉ có service chặn; sửa tay CSDL/SQL thẳng vẫn đổi được số đã chốt hoặc xóa nhật ký.
CREATE TRIGGER IF NOT EXISTS trg_snapshot_no_update
BEFORE UPDATE ON chot_ky_snapshot
BEGIN
  SELECT RAISE(ABORT, 'Ảnh chụp chốt kỳ là bất biến — không được sửa');
END;
CREATE TRIGGER IF NOT EXISTS trg_snapshot_no_delete
BEFORE DELETE ON chot_ky_snapshot
BEGIN
  SELECT RAISE(ABORT, 'Ảnh chụp chốt kỳ là bất biến — không được xóa');
END;
CREATE TRIGGER IF NOT EXISTS trg_audit_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'Nhật ký kiểm toán chỉ được thêm, không được sửa');
END;
CREATE TRIGGER IF NOT EXISTS trg_audit_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'Nhật ký kiểm toán chỉ được thêm, không được xóa');
END;
INSERT INTO schema_version(version, description) VALUES (5, 'Bất biến: chot_ky_snapshot và audit_log chỉ thêm');
