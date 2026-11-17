'use strict';
/**
 * Ngày giờ: lưu trong DB dạng ISO local 'YYYY-MM-DDTHH:mm:ss' (không timezone — giờ cân là giờ địa phương).
 * Nguồn có thể là: chuỗi 'dd/mm/yyyy hh:mm:ss', 'dd.mm.yyyy', Date, hoặc số serial Excel.
 */
const pad = (n) => String(n).padStart(2, '0');

function fromExcelSerial(serial) {
  // Excel 1900 date system; 25569 = 1970-01-01
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** Trả về ISO local string hoặc null nếu không parse được. */
function parseDateTime(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !isNaN(v)) {
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}T${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}`;
  }
  if (typeof v === 'number' && isFinite(v)) return fromExcelSerial(v);
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const [, dd, mm, yyyy, hh = '0', mi = '0', ss = '0'] = m;
    if (!validYmdHms(+yyyy, +mm, +dd, +hh, +mi, +ss)) return null;
    return `${yyyy}-${pad(mm)}-${pad(dd)}T${pad(hh)}:${pad(mi)}:${pad(ss)}`;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const [, yyyy, mm, dd, hh = '00', mi = '00', ss = '00'] = m;
    if (!validYmdHms(+yyyy, +mm, +dd, +hh, +mi, +ss)) return null;
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
  }
  return null;
}

const validYmdHms = (y, mo, d, h, mi, s) => mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate() && h < 24 && mi < 60 && s < 60;
const datePart = (iso) => (iso ? iso.slice(0, 10) : null);

/** Chênh lệch phút giữa 2 ISO local string. */
function diffMinutes(isoA, isoB) {
  if (!isoA || !isoB) return null;
  return (Date.parse(isoB + 'Z') - Date.parse(isoA + 'Z')) / 60000;
}

/** Ngày liền trước của 'YYYY-MM-DD' (dùng khi đóng phiên bản giá/lịch sử xe). */
function dayBefore(d) { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); }
/** 'YYYY-MM-DD…' → 'dd/MM/yyyy' (không đúng dạng ISO thì trả nguyên văn). */
const dmy = (iso) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso || '');
const dmyHm = (iso) => (iso && iso.length >= 16 ? `${dmy(iso)} ${iso.slice(11, 16)}` : dmy(iso));

module.exports = { parseDateTime, datePart, diffMinutes, fromExcelSerial, dayBefore, dmy, dmyHm };
