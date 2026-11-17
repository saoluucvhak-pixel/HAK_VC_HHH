'use strict';
/** Định dạng số kiểu Việt Nam, số âm làm tròn về 0 hiển thị "0" (không "-0"). Một bản dùng chung cho PDF/in/biểu mẫu. */
function noNegZero(v, digits = 0) {
  const x = Number(v), k = Math.pow(10, digits);
  return Math.round(x * k) / k === 0 ? 0 : x;
}
/** n: giá trị; d: số chữ số thập phân cố định. Rỗng/không phải số → ''. */
function fmtVN(n, d = 0) {
  if (n === null || n === undefined || n === '' || isNaN(Number(n))) return '';
  return noNegZero(n, d).toLocaleString('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d });
}
module.exports = { noNegZero, fmtVN };
