'use strict';
/** Bộ lọc chọn nhiều: giá trị có thể là mảng id, một id (số/chuỗi) hoặc rỗng. Phần tử rỗng/null/không phải số bị bỏ (không biến thành id 0). */
const asIds = (v) => (Array.isArray(v) ? v : [v]).filter((x) => x !== null && x !== undefined && x !== '').map(Number).filter(Number.isFinite);
/** Đúng một id → id đó; rỗng hoặc nhiều id → null (dùng cho chứng từ chỉ nói về một đợt/đơn vị). */
const oneId = (v) => { const a = asIds(v); return a.length === 1 ? a[0] : null; };
module.exports = { asIds, oneId };
