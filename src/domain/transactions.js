/**
 * Translate everyday transactions into balanced journal-entry drafts.
 *
 *  Income   : Dr deposit account (asset)          / Cr income category
 *  Expense  : Dr expense category                 / Cr payment account (asset or liability)
 *  Transfer : Dr destination (asset or liability) / Cr source (asset or liability)
 *
 * Because transfers, borrowing (loan -> cash) and credit-card payments
 * (bank -> card) never touch income/expense accounts, they can never be
 * counted as income or as a second expense.
 */
import { SUBTYPE_INFO, SYSTEM_ACCOUNTS } from './accounts.js';
import { creditLine, debitLine, EntryKind } from './journal.js';
import { ValidationError } from './errors.js';
import { isValidISODate } from './dates.js';

function requireAccount(accountsById, id, label, allowedTypes, errors) {
  const account = accountsById.get(id);
  if (!account) {
    errors.push(`Choose ${label}.`);
    return null;
  }
  if (!allowedTypes.includes(account.type)) {
    errors.push(`"${account.name}" cannot be used as ${label}.`);
    return null;
  }
  if (account.isActive === false) {
    errors.push(`"${account.name}" is archived.`);
    return null;
  }
  return account;
}

function commonChecks({ date, amount }, errors) {
  if (!isValidISODate(date)) errors.push('Choose a valid date.');
  if (!Number.isSafeInteger(amount) || amount <= 0) errors.push('Amount must be greater than zero.');
}

function finish(errors, draft) {
  if (errors.length) throw new ValidationError(errors);
  return draft;
}

export function buildIncome(input, accountsById) {
  const errors = [];
  commonChecks(input, errors);
  const deposit = requireAccount(accountsById, input.depositAccountId, 'a deposit account', ['asset'], errors);
  const income = requireAccount(accountsById, input.incomeAccountId, 'an income category', ['income'], errors);
  return finish(errors, {
    date: input.date,
    kind: EntryKind.INCOME,
    description: input.description?.trim() || income?.name || 'Income',
    note: input.note ?? '',
    lines: [debitLine(deposit?.id, input.amount), creditLine(income?.id, input.amount)],
  });
}

export function buildExpense(input, accountsById) {
  const errors = [];
  commonChecks(input, errors);
  const expense = requireAccount(accountsById, input.expenseAccountId, 'an expense category', ['expense'], errors);
  const payment = requireAccount(accountsById, input.paymentAccountId, 'a payment account',
    ['asset', 'liability'], errors);
  return finish(errors, {
    date: input.date,
    kind: EntryKind.EXPENSE,
    description: input.description?.trim() || expense?.name || 'Expense',
    note: input.note ?? '',
    lines: [debitLine(expense?.id, input.amount), creditLine(payment?.id, input.amount)],
  });
}

export function buildTransfer(input, accountsById) {
  const errors = [];
  commonChecks(input, errors);
  const from = requireAccount(accountsById, input.fromAccountId, 'a source account', ['asset', 'liability'], errors);
  const to = requireAccount(accountsById, input.toAccountId, 'a destination account', ['asset', 'liability'], errors);
  if (from && to && from.id === to.id) errors.push('Source and destination must be different accounts.');
  return finish(errors, {
    date: input.date,
    kind: EntryKind.TRANSFER,
    description: input.description?.trim() || `Transfer: ${from?.name} → ${to?.name}`,
    note: input.note ?? '',
    lines: [debitLine(to?.id, input.amount), creditLine(from?.id, input.amount)],
  });
}

/**
 * Opening balance against Opening Balance Equity.
 * Positive amount = normal balance (money held for assets, money owed for liabilities).
 * Negative amount = contra balance (e.g. an overdrawn bank account).
 * @returns {object|null} draft, or null when amount is zero
 */
export function buildOpeningBalance(account, amount, date) {
  if (!Number.isSafeInteger(amount)) throw new ValidationError(['Opening balance is invalid.']);
  if (amount === 0) return null;
  const info = SUBTYPE_INFO[account.subtype];
  if (!info || (info.type !== 'asset' && info.type !== 'liability')) {
    throw new ValidationError(['Opening balances apply to asset and liability accounts only.']);
  }
  const equity = SYSTEM_ACCOUNTS.OPENING_BALANCE_EQUITY;
  const magnitude = Math.abs(amount);
  const increaseIsDebit = info.type === 'asset';
  const debitAccount = (amount > 0) === increaseIsDebit ? account.id : equity;
  const creditAccount = debitAccount === account.id ? equity : account.id;
  return {
    date,
    kind: EntryKind.OPENING_BALANCE,
    description: `Opening balance: ${account.name}`,
    note: '',
    lines: [debitLine(debitAccount, magnitude), creditLine(creditAccount, magnitude)],
  };
}
