# HAK Smart Filter (bản nhúng)

Nguồn: https://github.com/saoluucvhak-pixel/HAK_SMART_FILTER — commit `e99bb7e`. Bản sao **nguyên văn**, không sửa tay; bộ chuyển đổi cho VC Cost nằm ở `renderer/filters.js`.

| File ở đây | File ở repo nguồn |
|---|---|
| `smart-filter.js` | `core/smart-filter.js` (lõi thuần dữ liệu: trạng thái, chip, phạm vi, bộ lọc đã lưu) |
| `filter-popover.js` | `ui/filter-popover.js` (ô chọn nhiều, chip) |
| `smart-filter-ui.js` | `ui/smart-filter.js` (thanh lọc nhanh, ngăn kéo nâng cao, bộ lọc đã lưu) |

`MANIFEST.json` ghi băm SHA-256; `tests/vendor.test.js` báo lỗi nếu file bị sửa.
