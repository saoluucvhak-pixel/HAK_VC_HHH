'use strict';
/** Định dạng số kiểu Việt Nam — dùng bản chuẩn HAK_ACCOUNTING_REPORT_STANDARD (vendor), số âm làm tròn về 0 hiển thị "0" (không "-0"). */
const R = require('../../renderer/vendor/hak-report-standard/hak-report-standard.js');
function noNegZero(v, digits = 0) {
  const x = Number(v), k = Math.pow(10, digits);
  return Math.round(x * k) / k === 0 ? 0 : x;
}
/** n: giá trị; d: số chữ số thập phân cố định. Rỗng/không phải số → ''. */
function fmtVN(n, d = 0) {
  if (n === null || n === undefined || n === '' || !Number.isFinite(Number(n))) return '';
  return R.formatNumber(Number(n), { minDecimals: d, maxDecimals: d });
}
module.exports = { noNegZero, fmtVN };
