/**
 * Calendar helpers. Accounting dates are plain local dates stored as
 * "YYYY-MM-DD" strings (no time zone), which sort correctly as text.
 * Android migration: java.time.LocalDate / YearMonth.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

const pad2 = (n) => String(n).padStart(2, '0');

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isValidISODate(value) {
  if (typeof value !== 'string') return false;
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1900 || month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

/** Local calendar date of a JS Date as "YYYY-MM-DD". */
export function toISODate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** "2026-11-01" -> "2026-11" */
export function monthKeyOf(isoDate) {
  return isoDate.slice(0, 7);
}

export function monthRange(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  return { from: `${monthKey}-01`, to: `${monthKey}-${pad2(daysInMonth(year, month))}` };
}

export function addMonths(monthKey, delta) {
  const [year, month] = monthKey.split('-').map(Number);
  const index = year * 12 + (month - 1) + delta;
  return `${Math.floor(index / 12)}-${pad2((index % 12) + 1)}`;
}

export function addDays(isoDate, deltaDays) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** Oldest first, ending with `monthKey`. */
export function lastNMonths(monthKey, count) {
  const keys = [];
  for (let i = count - 1; i >= 0; i -= 1) keys.push(addMonths(monthKey, -i));
  return keys;
}

export function monthShortLabel(monthKey) {
  return MONTHS_SHORT[Number(monthKey.slice(5, 7)) - 1];
}

export function monthLongLabel(monthKey) {
  return `${MONTHS_LONG[Number(monthKey.slice(5, 7)) - 1]} ${monthKey.slice(0, 4)}`;
}

/** "2026-11-01" -> "Nov 1, 2026" */
export function formatDisplayDate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return `${MONTHS_SHORT[m - 1]} ${d}, ${y}`;
}
