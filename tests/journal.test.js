import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../src/domain/accounts.js';
import { validateEntry, finalizeEntry, reverseEntry, debitLine, creditLine, EntryKind } from '../src/domain/journal.js';
import { verifyLedgerIntegrity } from '../src/domain/ledger.js';
import { buildIncome, buildExpense, buildTransfer, buildOpeningBalance } from '../src/domain/transactions.js';
import { ValidationError, LedgerError } from '../src/domain/errors.js';

const byId = new Map(DEFAULT_CHART_OF_ACCOUNTS.map((a) => [a.id, a]));
const card = { id: 'acc-2000', code: '2000', name: 'Credit Card', type: 'liability', subtype: 'credit_card', isActive: true };
const loan = { id: 'acc-2100', code: '2100', name: 'Personal Loan', type: 'liability', subtype: 'loan', isActive: true };
byId.set(card.id, card).set(loan.id, loan);
const now = new Date('2026-11-01T08:00:00Z');

test('salary: Dr Bank 30,000 / Cr Salary 30,000', () => {
  const draft = buildIncome({ date: '2026-11-01', amount: 3_000_000, depositAccountId: 'acc-1100', incomeAccountId: 'acc-4000' }, byId);
  assert.deepEqual(draft.lines, [debitLine('acc-1100', 3_000_000), creditLine('acc-4000', 3_000_000)]);
  assert.equal(validateEntry(draft, byId).ok, true);
});

test('groceries: Dr Food 2,000 / Cr Cash 2,000', () => {
  const draft = buildExpense({ date: '2026-11-01', amount: 200_000, paymentAccountId: 'acc-1000', expenseAccountId: 'acc-5000' }, byId);
  assert.deepEqual(draft.lines, [debitLine('acc-5000', 200_000), creditLine('acc-1000', 200_000)]);
});

test('transfer bank -> e-wallet: Dr GCash / Cr Bank', () => {
  const draft = buildTransfer({ date: '2026-11-01', amount: 500_000, fromAccountId: 'acc-1100', toAccountId: 'acc-1200' }, byId);
  assert.deepEqual(draft.lines, [debitLine('acc-1200', 500_000), creditLine('acc-1100', 500_000)]);
  assert.equal(draft.kind, EntryKind.TRANSFER);
});

test('transfer to the same account is rejected', () => {
  assert.throws(() => buildTransfer({ date: '2026-11-01', amount: 100, fromAccountId: 'acc-1100', toAccountId: 'acc-1100' }, byId), ValidationError);
});

test('income cannot be deposited into an expense category', () => {
  assert.throws(() => buildIncome({ date: '2026-11-01', amount: 100, depositAccountId: 'acc-5000', incomeAccountId: 'acc-4000' }, byId), ValidationError);
});

test('unbalanced and malformed entries are rejected', () => {
  const unbalanced = { date: '2026-11-01', description: 'x', kind: 'manual', lines: [debitLine('acc-1000', 100), creditLine('acc-4000', 99)] };
  const r1 = validateEntry(unbalanced, byId);
  assert.equal(r1.ok, false);
  assert.match(r1.errors.join(' '), /unbalanced/);

  const bothSides = { date: '2026-11-01', description: 'x', kind: 'manual', lines: [{ accountId: 'acc-1000', debit: 100, credit: 100 }, creditLine('acc-4000', 0)] };
  assert.equal(validateEntry(bothSides, byId).ok, false);

  const floaty = { date: '2026-11-01', description: 'x', kind: 'manual', lines: [debitLine('acc-1000', 1.5), creditLine('acc-4000', 1.5)] };
  assert.equal(validateEntry(floaty, byId).ok, false);

  const badDate = { date: '2026-02-30', description: 'x', kind: 'manual', lines: [debitLine('acc-1000', 1), creditLine('acc-4000', 1)] };
  assert.equal(validateEntry(badDate, byId).ok, false);

  const unknown = { date: '2026-11-01', description: 'x', kind: 'manual', lines: [debitLine('nope', 1), creditLine('acc-4000', 1)] };
  assert.equal(validateEntry(unknown, byId).ok, false);
});

test('reversal swaps sides, links both entries, and cannot be repeated', () => {
  const draft = buildExpense({ date: '2026-11-01', amount: 200_000, paymentAccountId: 'acc-1000', expenseAccountId: 'acc-5000' }, byId);
  const original = finalizeEntry(draft, { id: 'e1', now });
  const { reversal, updatedOriginal } = reverseEntry(original, { id: 'e2', date: '2026-11-02', now });
  assert.deepEqual(reversal.lines, [creditLine('acc-5000', 200_000), debitLine('acc-1000', 200_000)]);
  assert.equal(reversal.reversesId, 'e1');
  assert.equal(updatedOriginal.reversedById, 'e2');
  assert.equal(validateEntry(reversal, byId).ok, true);
  assert.throws(() => reverseEntry(updatedOriginal, { id: 'e3', date: '2026-11-02', now }), LedgerError);
  assert.throws(() => reverseEntry(reversal, { id: 'e4', date: '2026-11-02', now }), LedgerError);
  assert.throws(() => reverseEntry(original, { id: 'e5', date: '2026-10-01', now }), LedgerError);
});

test('opening balances post against Opening Balance Equity', () => {
  const bank = byId.get('acc-1100');
  assert.deepEqual(buildOpeningBalance(bank, 1_000_000, '2026-11-01').lines,
    [debitLine('acc-1100', 1_000_000), creditLine('acc-3000', 1_000_000)]);
  assert.deepEqual(buildOpeningBalance(card, 500_000, '2026-11-01').lines,
    [debitLine('acc-3000', 500_000), creditLine('acc-2000', 500_000)]);
  assert.deepEqual(buildOpeningBalance(bank, -100, '2026-11-01').lines,
    [debitLine('acc-3000', 100), creditLine('acc-1100', 100)]);
  assert.equal(buildOpeningBalance(bank, 0, '2026-11-01'), null);
});

test('Stage 4: verifyLedgerIntegrity validates compound entries, reversal links, Trial Balance, and Accounting Equation', () => {
  const accounts = [...byId.values()];
  const e1 = finalizeEntry(
    buildIncome({ date: '2026-11-01', amount: 3_000_000, depositAccountId: 'acc-1100', incomeAccountId: 'acc-4000' }, byId),
    { id: 'e-1', now },
  );
  // Compound 3-line entry: split grocery + transport paid from Cash
  const e2 = finalizeEntry({
    date: '2026-11-02',
    description: 'Split cash errands',
    kind: EntryKind.MANUAL,
    lines: [
      debitLine('acc-5000', 150_000),
      debitLine('acc-5100', 50_000),
      creditLine('acc-1000', 200_000),
    ],
  }, { id: 'e-2', now });
  const { reversal: e3, updatedOriginal: e2Rev } = reverseEntry(e2, { id: 'e-3', date: '2026-11-03', now });

  const auditOk = verifyLedgerIntegrity(accounts, [e1, e2Rev, e3]);
  assert.equal(auditOk.ok, true);
  assert.equal(auditOk.trialBalanced, true);
  assert.equal(auditOk.equationBalanced, true);
  assert.equal(auditOk.reversalCount, 1);

  // Tamper with a line amount to break Dr = Cr
  const tampered = structuredClone(e1);
  tampered.lines[0].debit = 2_999_999;
  const auditBad = verifyLedgerIntegrity(accounts, [tampered]);
  assert.equal(auditBad.ok, false);
  assert.equal(auditBad.trialBalanced, false);
  assert.ok(auditBad.violations.length >= 1);
});
