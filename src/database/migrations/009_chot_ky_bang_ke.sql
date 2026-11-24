ALTER TABLE chot_ky ADD COLUMN statements_json TEXT CHECK (statements_json IS NULL OR json_valid(statements_json));

CREATE TRIGGER chot_ky_statements_immutable
BEFORE UPDATE OF statements_json ON chot_ky
WHEN NEW.statements_json IS NOT OLD.statements_json
BEGIN
  SELECT RAISE(ABORT, 'Bảng kê đã chốt không được thay đổi');
END;

-- Khôi phục các đợt bị kẹt sau khi mở khóa lần chốt toàn đợt ở phiên bản cũ.
UPDATE dot_van_chuyen AS d SET trang_thai='MO'
WHERE d.trang_thai='KHOA'
  AND EXISTS (
    SELECT 1 FROM chot_ky k WHERE k.dot_van_chuyen_id=d.id AND k.loai='DOT'
      AND k.don_vi_van_chuyen_id IS NULL AND k.trang_thai='DA_MO_KHOA'
  )
  AND EXISTS (
    SELECT 1 FROM chot_ky k WHERE k.dot_van_chuyen_id=d.id AND k.loai='DOT'
      AND k.don_vi_van_chuyen_id IS NOT NULL AND k.trang_thai='DA_CHOT'
  )
  AND NOT EXISTS (
    SELECT 1 FROM chot_ky k WHERE k.dot_van_chuyen_id=d.id AND k.loai='DOT'
      AND k.don_vi_van_chuyen_id IS NULL AND k.trang_thai='DA_CHOT'
  )
  AND NOT EXISTS (
    SELECT 1 FROM audit_log a
    WHERE a.entity='dot_van_chuyen' AND a.entity_id=d.id AND a.action='UPDATE'
      AND json_valid(a.old_value) AND json_valid(a.new_value)
      AND json_extract(a.old_value, '$.trang_thai')='MO'
      AND json_extract(a.new_value, '$.trang_thai')='KHOA'
  );

INSERT INTO schema_version(version, description) VALUES (9, 'Lưu Bảng kê tại thời điểm chốt');
