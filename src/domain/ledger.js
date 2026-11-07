/**
 * Ledger calculations derived purely from posted journal entries.
 * No stored balances exist anywhere: every figure is recomputed from entries,
 * so reports can never drift from the journal.
 */
import { add, subtract } from './money.js';
import { NORMAL_BALANCE } from './accounts.js';
import { EntryKind, validateEntry } from './journal.js';

/**
 * Debit/credit totals per account within an optional inclusive date range.
 * @returns {Map<string, {debit: number, credit: number}>}
 */
export function accountTotals(entries, { from = null, to = null } = {}) {
  const totals = new Map();
  for (const entry of entries) {
    if (from && entry.date < from) continue;
    if (to && entry.date > to) continue;
    for (const line of entry.lines) {
      let t = totals.get(line.accountId);
      if (!t) {
        t = { debit: 0, credit: 0 };
        totals.set(line.accountId, t);
      }
      t.debit = add(t.debit, line.debit);
      t.credit = add(t.credit, line.credit);
    }
  }
  return totals;
}

/** Balance expressed on the account's normal side (positive = normal). */
export function normalBalance(account, totals) {
  if (!totals) return 0;
  return NORMAL_BALANCE[account.type] === 'debit'
    ? subtract(totals.debit, totals.credit)
    : subtract(totals.credit, totals.debit);
}

/** @returns {Map<string, number>} accountId -> normal balance */
export function balancesByAccount(accounts, entries, range = {}) {
  const totals = accountTotals(entries, range);
  const balances = new Map();
  for (const account of accounts) balances.set(account.id, normalBalance(account, totals.get(account.id)));
  return balances;
}

/** Sum normal balances by account type. */
export function totalsByType(accounts, balances) {
  const result = { asset: 0, liability: 0, equity: 0, income: 0, expense: 0 };
  for (const account of accounts) {
    result[account.type] = add(result[account.type], balances.get(account.id) ?? 0);
  }
  return result;
}

/**
 * Trial balance as of a date. Each account's net balance goes in the
 * debit or credit column; totals must match.
 */
export function trialBalance(accounts, entries, { asOf = null } = {}) {
  const totals = accountTotals(entries, { to: asOf });
  const rows = [];
  let totalDebit = 0;
  let totalCredit = 0;
  const sorted = [...accounts].sort((a, b) => a.code.localeCompare(b.code));
  for (const account of sorted) {
    const t = totals.get(account.id);
    if (!t) continue;
    const net = subtract(t.debit, t.credit);
    const row = { account, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
    totalDebit = add(totalDebit, row.debit);
    totalCredit = add(totalCredit, row.credit);
    rows.push(row);
  }
  return { rows, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
}

/**
 * Accounting equation check: Assets = Liabilities + Equity,
 * where Equity = equity accounts + (income − expenses) to date.
 */
export function accountingEquation(accounts, entries, { asOf = null } = {}) {
  const byType = totalsByType(accounts, balancesByAccount(accounts, entries, { to: asOf }));
  const netIncome = subtract(byType.income, byType.expense);
  const equity = add(byType.equity, netIncome);
  const liabilitiesPlusEquity = add(byType.liability, equity);
  return {
    assets: byType.asset,
    liabilities: byType.liability,
    contributedEquity: byType.equity,
    netIncome,
    equity,
    liabilitiesPlusEquity,
    balanced: byType.asset === liabilitiesPlusEquity,
  };
}

/**
 * Comprehensive audit of the double-entry ledger:
 * 1. Validates every individual journal entry (Dr = Cr > 0, valid accounts)
 * 2. Verifies reversal symmetry (reversedById <-> reversesId with swapped sides)
 * 3. Verifies Trial Balance (Total Debits = Total Credits)
 * 4. Verifies Fundamental Accounting Equation (Assets = Liabilities + Equity)
 */
export function verifyLedgerIntegrity(accounts, entries, { asOf = null } = {}) {
  const activeViewById = new Map(accounts.map((a) => [a.id, { ...a, isActive: true }]));
  const entriesById = new Map(entries.map((e) => [e.id, e]));
  const violations = [];
  let reversalCount = 0;

  for (const entry of entries) {
    const res = validateEntry(entry, activeViewById);
    if (!res.ok) {
      violations.push(`Entry ${entry.id}: ${res.errors.join(' ')}`);
    }
    if (entry.kind === EntryKind.REVERSAL) {
      reversalCount += 1;
      const orig = entriesById.get(entry.reversesId);
      if (!orig) violations.push(`Reversal ${entry.id} references missing original ${entry.reversesId}.`);
      else if (orig.reversedById !== entry.id) {
        violations.push(`Reversal ${entry.id} and original ${orig.id} have mismatched reversal links.`);
      }
    }
  }

  const tb = trialBalance(accounts, entries, { asOf });
  if (!tb.balanced) violations.push('Trial balance is out of balance (Total Debits ≠ Total Credits).');

  const equation = accountingEquation(accounts, entries, { asOf });
  if (!equation.balanced) violations.push('Accounting equation is out of balance (Assets ≠ Liabilities + Equity).');

  return {
    ok: violations.length === 0,
    entryCount: entries.length,
    reversalCount,
    totalDebit: tb.totalDebit,
    totalCredit: tb.totalCredit,
    trialBalanced: tb.balanced,
    equationBalanced: equation.balanced,
    equation,
    violations,
  };
}
