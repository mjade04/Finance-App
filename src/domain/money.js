/**
 * Exact money arithmetic for MyFinance Pro.
 *
 * RULE: every monetary amount inside the domain is a JavaScript *safe integer*
 * representing CENTAVOS (₱1.00 === 100). Floating-point numbers are never
 * accepted as money input; user input is parsed from text.
 *
 * Android migration: maps 1:1 to a Kotlin `@JvmInline value class Money(val centavos: Long)`.
 */

export const CURRENCY = Object.freeze({
  code: 'PHP',
  symbol: '₱',
  minorUnitsPerMajor: 100,
});

/** Largest amount accepted for a single entry: ₱1,000,000,000,000.00 */
export const MAX_ENTRY_AMOUNT = 100_000_000_000_000;

export class MoneyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MoneyError';
  }
}

export function isCentavos(value) {
  return Number.isSafeInteger(value);
}

export function assertCentavos(value, label = 'Amount') {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} must be an integer number of centavos (got ${String(value)}).`);
  }
  return value;
}

function checked(result) {
  if (!Number.isSafeInteger(result)) {
    throw new MoneyError('Monetary overflow: result exceeds the safe integer range.');
  }
  return result === 0 ? 0 : result; // normalise -0
}

export function add(a, b) {
  return checked(assertCentavos(a) + assertCentavos(b));
}

export function subtract(a, b) {
  return checked(assertCentavos(a) - assertCentavos(b));
}

export function negate(a) {
  assertCentavos(a);
  return a === 0 ? 0 : -a;
}

export function sum(values) {
  let total = 0;
  for (const v of values) total = add(total, v);
  return total;
}

export function sumBy(items, selector) {
  let total = 0;
  for (const item of items) total = add(total, selector(item));
  return total;
}

const AMOUNT_PATTERN = /^(-)?(\d*)(?:\.(\d{0,2}))?$/;

/**
 * Parse user text such as "1,234.50", "₱ 30000", ".75" into centavos.
 * Uses BigInt internally, so no floating-point step is ever involved.
 */
export function parseAmount(input, { allowNegative = false, allowZero = false } = {}) {
  if (typeof input !== 'string') {
    throw new MoneyError('Amounts must be parsed from text to avoid floating-point errors.');
  }
  const cleaned = input.replace(/₱|PHP/gi, '').replace(/[\s,]/g, '');
  const match = AMOUNT_PATTERN.exec(cleaned);
  if (!match || (match[2] === '' && !match[3])) {
    throw new MoneyError('Enter a valid amount with up to 2 decimal places.');
  }
  const pesos = match[2] === '' ? '0' : match[2];
  const cents = (match[3] ?? '').padEnd(2, '0');
  let value = BigInt(pesos) * 100n + BigInt(cents);
  if (match[1]) value = -value;

  const limit = BigInt(MAX_ENTRY_AMOUNT);
  if (value > limit || value < -limit) throw new MoneyError('Amount is too large.');

  const result = Number(value);
  if (result < 0 && !allowNegative) throw new MoneyError('Amount cannot be negative.');
  if (result === 0 && !allowZero) throw new MoneyError('Amount must be greater than zero.');
  return result === 0 ? 0 : result;
}

function splitCentavos(value) {
  const absolute = Math.abs(value);
  const cents = absolute % 100;
  const pesos = (absolute - cents) / 100; // exact: absolute - cents is divisible by 100
  return { negative: value < 0, pesos, cents };
}

function groupThousands(integer) {
  return String(integer).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** "₱1,234.50", "-₱20.00", "+₱5.00" (signDisplay: 'always') */
export function formatMoney(value, { symbol = true, signDisplay = 'auto' } = {}) {
  assertCentavos(value);
  const { negative, pesos, cents } = splitCentavos(value);
  const body = `${symbol ? CURRENCY.symbol : ''}${groupThousands(pesos)}.${String(cents).padStart(2, '0')}`;
  if (negative) return `-${body}`;
  if (signDisplay === 'always' && value > 0) return `+${body}`;
  return body;
}

/** Plain machine-friendly text, e.g. "1234.50" — used for inputs and CSV. */
export function toDecimalString(value) {
  assertCentavos(value);
  const { negative, pesos, cents } = splitCentavos(value);
  return `${negative ? '-' : ''}${pesos}.${String(cents).padStart(2, '0')}`;
}

/** Compact label for chart axes only ("₱12.5k"). Truncates; never used for totals. */
export function formatCompact(value) {
  assertCentavos(value);
  const { negative, pesos } = splitCentavos(value);
  const sign = negative ? '-' : '';
  const scaled = (unit) => {
    const tenths = Math.floor((pesos * 10) / unit);
    const whole = Math.floor(tenths / 10);
    const decimal = tenths % 10;
    return decimal ? `${whole}.${decimal}` : `${whole}`;
  };
  if (pesos >= 1_000_000) return `${sign}₱${scaled(1_000_000)}M`;
  if (pesos >= 1_000) return `${sign}₱${scaled(1_000)}k`;
  return `${sign}₱${pesos}`;
}

/**
 * Ratio in basis points (1% = 100 bp), rounded half away from zero, computed
 * with BigInt. Returns null when `whole` is zero.
 */
export function ratioBasisPoints(part, whole) {
  assertCentavos(part);
  assertCentavos(whole);
  if (whole === 0) return null;
  const p = BigInt(part) * 10000n;
  const w = BigInt(whole);
  const q = p / w;
  const r = p % w;
  const absR = r < 0n ? -r : r;
  const absW = w < 0n ? -w : w;
  let adjust = 0n;
  if (2n * absR >= absW) adjust = (p < 0n) !== (w < 0n) ? -1n : 1n;
  return Number(q + adjust);
}

/** 1234 bp -> "12.3%" */
export function formatBasisPoints(bp) {
  if (bp == null) return '—';
  const negative = bp < 0;
  const a = Math.abs(bp);
  return `${negative ? '-' : ''}${Math.floor(a / 100)}.${Math.floor((a % 100) / 10)}%`;
}
