-- Phân quyền (tùy chọn): người dùng cục bộ, vai trò ADMIN / DUYET / NHAP / XEM. Chế độ bật/tắt nằm trong settings('phan_quyen').
-- Mặc định KHÔNG áp dụng phân quyền (1 người dùng) — bảng này rỗng và không ảnh hưởng gì tới dữ liệu cũ.
CREATE TABLE nguoi_dung (
  id             INTEGER PRIMARY KEY,
  ten_dang_nhap  TEXT NOT NULL UNIQUE COLLATE NOCASE,
  ho_ten         TEXT NOT NULL,
  vai_tro        TEXT NOT NULL CHECK (vai_tro IN ('ADMIN','DUYET','NHAP','XEM')),
  mat_khau_hash  TEXT NOT NULL,
  trang_thai     TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (trang_thai IN ('ACTIVE','INACTIVE')),
  dang_nhap_cuoi TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now','localtime')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now','localtime'))
);
INSERT INTO schema_version(version, description) VALUES (6, 'Phân quyền tùy chọn: nguoi_dung');
