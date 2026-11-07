/**
 * Double-entry journal: entry structure, validation and reversal.
 *
 * A posted entry is IMMUTABLE. Corrections are made by posting a reversal
 * entry (debits and credits swapped). The only field that ever changes on a
 * posted entry is the reversal link (`reversedById`, `reversedAt`).
 *
 * Line amounts are integer centavos; each line has exactly one non-zero side.
 */
import { add, formatMoney, MAX_ENTRY_AMOUNT } from './money.js';
import { isValidISODate } from './dates.js';
import { LedgerError } from './errors.js';

export const EntryKind = Object.freeze({
  INCOME: 'income',
  EXPENSE: 'expense',
  TRANSFER: 'transfer',
  OPENING_BALANCE: 'opening_balance',
  MANUAL: 'manual',
  REVERSAL: 'reversal',
});

export const ENTRY_KIND_LABELS = Object.freeze({
  income: 'Income',
  expense: 'Expense',
  transfer: 'Transfer',
  opening_balance: 'Opening balance',
  manual: 'Journal entry',
  reversal: 'Reversal',
});

export const debitLine = (accountId, amount) => ({ accountId, debit: amount, credit: 0 });
export const creditLine = (accountId, amount) => ({ accountId, debit: 0, credit: amount });

export function entryTotals(entry) {
  let debit = 0;
  let credit = 0;
  for (const line of entry.lines) {
    debit = add(debit, line.debit);
    credit = add(credit, line.credit);
  }
  return { debit, credit };
}

/**
 * Validate a (draft or finalized) entry against the chart of accounts.
 * @param {object} entry
 * @param {Map<string, object>} accountsById
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateEntry(entry, accountsById) {
  const errors = [];
  if (!entry || typeof entry !== 'object') return { ok: false, errors: ['Entry is missing.'] };

  if (!isValidISODate(entry.date)) errors.push('Date must be a valid calendar date.');
  const description = typeof entry.description === 'string' ? entry.description.trim() : '';
  if (!description) errors.push('Description is required.');
  else if (description.length > 200) errors.push('Description must be 200 characters or fewer.');
  if (!Object.values(EntryKind).includes(entry.kind)) errors.push('Unknown entry type.');

  if (!Array.isArray(entry.lines) || entry.lines.length < 2) {
    errors.push('A journal entry needs at least two lines.');
    return { ok: false, errors };
  }

  let totalDebit = 0;
  let totalCredit = 0;
  const accountIds = new Set();
  entry.lines.forEach((line, index) => {
    const n = index + 1;
    const account = accountsById.get(line?.accountId);
    if (!account) errors.push(`Line ${n}: account does not exist.`);
    else if (account.isActive === false && entry.kind !== EntryKind.REVERSAL) {
      errors.push(`Line ${n}: account "${account.name}" is archived.`);
    }
    const { debit, credit } = line ?? {};
    if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit) || debit < 0 || credit < 0) {
      errors.push(`Line ${n}: amounts must be non-negative whole centavos.`);
      return;
    }
    if ((debit > 0) === (credit > 0)) {
      errors.push(`Line ${n}: enter either a debit or a credit (exactly one).`);
    }
    totalDebit = add(totalDebit, debit);
    totalCredit = add(totalCredit, credit);
    accountIds.add(line.accountId);
  });

  if (totalDebit !== totalCredit) {
    errors.push(`Entry is unbalanced: debits ${formatMoney(totalDebit)} ≠ credits ${formatMoney(totalCredit)}.`);
  }
  if (totalDebit === 0) errors.push('Entry total must be greater than zero.');
  if (totalDebit > MAX_ENTRY_AMOUNT) errors.push('Entry amount exceeds the allowed maximum.');
  if (accountIds.size < 2) errors.push('An entry must involve at least two different accounts.');

  return { ok: errors.length === 0, errors };
}

/** Turn a draft into a posted entry record (does not validate). */
export function finalizeEntry(draft, { id, now }) {
  return {
    id,
    date: draft.date,
    description: String(draft.description ?? '').trim(),
    note: draft.note ? String(draft.note).trim() : '',
    kind: draft.kind,
    lines: draft.lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit })),
    status: 'posted',
    reversesId: draft.reversesId ?? null,
    reversedById: null,
    reversedAt: null,
    createdAt: now.toISOString(),
  };
}

/**
 * Build the reversal for `original`.
 * @returns {{reversal: object, updatedOriginal: object}}
 */
export function reverseEntry(original, { id, date, now }) {
  if (original.kind === EntryKind.REVERSAL) {
    throw new LedgerError('A reversal cannot itself be reversed. Record a new transaction instead.');
  }
  if (original.reversedById) throw new LedgerError('This entry has already been reversed.');
  if (!isValidISODate(date)) throw new LedgerError('Reversal date is invalid.');
  if (date < original.date) throw new LedgerError('Reversal date cannot be earlier than the original entry.');

  const reversal = finalizeEntry({
    date,
    description: `Reversal: ${original.description}`.slice(0, 200),
    kind: EntryKind.REVERSAL,
    reversesId: original.id,
    lines: original.lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit })),
  }, { id, now });

  const updatedOriginal = { ...original, reversedById: id, reversedAt: now.toISOString() };
  return { reversal, updatedOriginal };
}
