import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  add, subtract, sum, parseAmount, formatMoney, toDecimalString, formatCompact,
  ratioBasisPoints, formatBasisPoints, MoneyError,
} from '../src/domain/money.js';

test('classic floating-point trap is exact with centavos', () => {
  // 0.1 + 0.2 in floats = 0.30000000000000004
  assert.equal(add(parseAmount('0.10'), parseAmount('0.20')), 30);
  assert.equal(sum([parseAmount('19.99'), parseAmount('0.01'), parseAmount('80')]), 10000);
});

test('parseAmount accepts common formats', () => {
  assert.equal(parseAmount('30,000'), 3_000_000);
  assert.equal(parseAmount('₱ 1,234.5'), 123_450);
  assert.equal(parseAmount('.75'), 75);
  assert.equal(parseAmount('2000.00'), 200_000);
  assert.equal(parseAmount('-5', { allowNegative: true }), -500);
  assert.equal(parseAmount('0', { allowZero: true }), 0);
});

test('parseAmount rejects invalid input', () => {
  for (const bad of ['', 'abc', '1.234', '1.2.3', '12a', '-', '.']) {
    assert.throws(() => parseAmount(bad), MoneyError, bad);
  }
  assert.throws(() => parseAmount('-5'), MoneyError);
  assert.throws(() => parseAmount('0'), MoneyError);
  assert.throws(() => parseAmount(12.5), MoneyError, 'numbers are refused');
  assert.throws(() => parseAmount('9999999999999'), MoneyError, 'too large');
});

test('arithmetic refuses non-integer amounts', () => {
  assert.throws(() => add(1.5, 1), MoneyError);
  assert.throws(() => subtract(Number.MAX_SAFE_INTEGER, -1), MoneyError);
});

test('formatting', () => {
  assert.equal(formatMoney(3_000_000), '₱30,000.00');
  assert.equal(formatMoney(-123_456), '-₱1,234.56');
  assert.equal(formatMoney(5, { signDisplay: 'always' }), '+₱0.05');
  assert.equal(formatMoney(0), '₱0.00');
  assert.equal(toDecimalString(-105), '-1.05');
  assert.equal(formatCompact(1_250_000), '₱12.5k');
  assert.equal(formatCompact(250_000_000), '₱2.5M');
});

test('ratios in basis points', () => {
  assert.equal(ratioBasisPoints(1, 3), 3333);
  assert.equal(ratioBasisPoints(2, 3), 6667);
  assert.equal(ratioBasisPoints(5, 0), null);
  assert.equal(formatBasisPoints(6667), '66.6%');
});
