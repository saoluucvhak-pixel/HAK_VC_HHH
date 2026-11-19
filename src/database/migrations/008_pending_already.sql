-- 0.8.2: dòng nhập lại cùng dữ liệu với một dòng "Cần kiểm tra" đang chờ được phân loại PENDING_ALREADY (hành động SKIP).
-- SQLite không đổi được ràng buộc CHECK tại chỗ → dựng lại import_batch_row với CHECK mở rộng, giữ nguyên id và dữ liệu.
-- Không bảng/view/trigger nào tham chiếu import_batch_row nên DROP + RENAME an toàn khi foreign_keys=ON.
CREATE TABLE import_batch_row_new (
  id            INTEGER PRIMARY KEY,
  batch_id      INTEGER NOT NULL REFERENCES import_batch(id),
  source_row    INTEGER,
  phan_loai     TEXT NOT NULL CHECK (phan_loai IN ('NEW','EXACT_DUPLICATE','KEY_CONFLICT','IN_FILE_DUPLICATE','ERROR','PENDING_ALREADY')),
  hanh_dong     TEXT NOT NULL CHECK (hanh_dong IN ('INSERT','SKIP','UPDATE','KEEP_OLD','IGNORE','PENDING_REVIEW')),
  phieu_can_id  INTEGER REFERENCES phieu_can(id),
  old_json      TEXT,
  raw_json      TEXT NOT NULL,
  diffs_json    TEXT,
  errors_json   TEXT
);
INSERT INTO import_batch_row_new (id, batch_id, source_row, phan_loai, hanh_dong, phieu_can_id, old_json, raw_json, diffs_json, errors_json)
  SELECT id, batch_id, source_row, phan_loai, hanh_dong, phieu_can_id, old_json, raw_json, diffs_json, errors_json FROM import_batch_row;
DROP TABLE import_batch_row;
ALTER TABLE import_batch_row_new RENAME TO import_batch_row;
CREATE INDEX ix_batchrow_batch ON import_batch_row(batch_id);
CREATE INDEX ix_batchrow_phieu_cho ON import_batch_row(phieu_can_id) WHERE hanh_dong = 'PENDING_REVIEW';

INSERT INTO schema_version(version, description) VALUES (8, 'Phân loại PENDING_ALREADY cho dòng nhập lại đã chờ kiểm tra');
