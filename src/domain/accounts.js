/**
 * Chart of accounts model.
 *
 * A single "account" concept is used for both the user's money containers
 * (cash, bank, e-wallet, credit card, loan) and accounting categories
 * (income and expense). This keeps the double-entry model uniform.
 *
 * Account codes: 1xxx assets, 2xxx liabilities, 3xxx equity, 4xxx income, 5xxx expenses.
 */

export const AccountType = Object.freeze({
  ASSET: 'asset',
  LIABILITY: 'liability',
  EQUITY: 'equity',
  INCOME: 'income',
  EXPENSE: 'expense',
});

/** Side on which an account's balance normally increases. */
export const NORMAL_BALANCE = Object.freeze({
  asset: 'debit',
  expense: 'debit',
  liability: 'credit',
  equity: 'credit',
  income: 'credit',
});

export const TYPE_LABELS = Object.freeze({
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  income: 'Income',
  expense: 'Expenses',
});

export const AccountSubtype = Object.freeze({
  CASH: 'cash',
  BANK: 'bank',
  EWALLET: 'ewallet',
  RECEIVABLE: 'receivable',
  INVESTMENT: 'investment',
  OTHER_ASSET: 'other_asset',
  CREDIT_CARD: 'credit_card',
  LOAN: 'loan',
  PAYABLE: 'payable',
  OTHER_LIABILITY: 'other_liability',
  EQUITY: 'equity',
  INCOME: 'income',
  EXPENSE: 'expense',
});

/** Metadata per subtype: owning type, label, default icon and code range. */
export const SUBTYPE_INFO = Object.freeze({
  cash: { type: 'asset', label: 'Cash', icon: 'cash', codeBase: 1000, codeSpan: 100 },
  bank: { type: 'asset', label: 'Bank account', icon: 'bank', codeBase: 1100, codeSpan: 100 },
  ewallet: { type: 'asset', label: 'E-wallet', icon: 'phone', codeBase: 1200, codeSpan: 100 },
  receivable: { type: 'asset', label: 'Receivable', icon: 'receipt', codeBase: 1300, codeSpan: 100 },
  investment: { type: 'asset', label: 'Investment', icon: 'trendUp', codeBase: 1400, codeSpan: 100 },
  other_asset: { type: 'asset', label: 'Other asset', icon: 'wallet', codeBase: 1500, codeSpan: 500 },
  credit_card: { type: 'liability', label: 'Credit card', icon: 'card', codeBase: 2000, codeSpan: 100 },
  loan: { type: 'liability', label: 'Loan', icon: 'trendDown', codeBase: 2100, codeSpan: 100 },
  payable: { type: 'liability', label: 'Payable', icon: 'receipt', codeBase: 2200, codeSpan: 100 },
  other_liability: { type: 'liability', label: 'Other liability', icon: 'alert', codeBase: 2300, codeSpan: 700 },
  equity: { type: 'equity', label: 'Equity', icon: 'scale', codeBase: 3000, codeSpan: 1000 },
  income: { type: 'income', label: 'Income category', icon: 'peso', codeBase: 4000, codeSpan: 1000 },
  expense: { type: 'expense', label: 'Expense category', icon: 'tag', codeBase: 5000, codeSpan: 1000 },
});

/** Cash-equivalent subtypes used for "available cash" and cash-flow metrics. */
export const LIQUID_SUBTYPES = Object.freeze(new Set(['cash', 'bank', 'ewallet']));

export const SYSTEM_ACCOUNTS = Object.freeze({
  OPENING_BALANCE_EQUITY: 'acc-3000',
});

export function isBalanceSheetType(type) {
  return type === 'asset' || type === 'liability' || type === 'equity';
}

export function isLiquid(account) {
  return Boolean(account) && LIQUID_SUBTYPES.has(account.subtype);
}

const seed = (id, code, name, subtype, icon, extra = {}) => ({
  id,
  code,
  name,
  type: SUBTYPE_INFO[subtype].type,
  subtype,
  icon,
  isActive: true,
  isSystem: false,
  ...extra,
});

/** Default Philippine-oriented chart of accounts created on first launch. */
export const DEFAULT_CHART_OF_ACCOUNTS = Object.freeze([
  seed('acc-1000', '1000', 'Cash on Hand', 'cash', 'cash'),
  seed('acc-1100', '1100', 'Bank Account', 'bank', 'bank'),
  seed('acc-1200', '1200', 'GCash', 'ewallet', 'phone'),
  seed('acc-3000', '3000', 'Opening Balance Equity', 'equity', 'scale', { isSystem: true }),
  seed('acc-4000', '4000', 'Salary', 'income', 'peso'),
  seed('acc-4100', '4100', 'Business Income', 'income', 'briefcase'),
  seed('acc-4200', '4200', 'Interest Income', 'income', 'trendUp'),
  seed('acc-4300', '4300', 'Gifts Received', 'income', 'gift'),
  seed('acc-4900', '4900', 'Other Income', 'income', 'tag'),
  seed('acc-5000', '5000', 'Food & Groceries', 'expense', 'food'),
  seed('acc-5100', '5100', 'Transportation', 'expense', 'car'),
  seed('acc-5200', '5200', 'Utilities', 'expense', 'bolt'),
  seed('acc-5300', '5300', 'Housing & Rent', 'expense', 'home'),
  seed('acc-5400', '5400', 'Healthcare', 'expense', 'health'),
  seed('acc-5500', '5500', 'Education', 'expense', 'book'),
  seed('acc-5600', '5600', 'Entertainment', 'expense', 'play'),
  seed('acc-5700', '5700', 'Shopping', 'expense', 'bag'),
  seed('acc-5800', '5800', 'Bank Fees & Interest', 'expense', 'receipt'),
  seed('acc-5900', '5900', 'Other Expenses', 'expense', 'tag'),
]);

/** Next free numeric code inside the subtype's range. */
export function nextAccountCode(accounts, subtype) {
  const info = SUBTYPE_INFO[subtype];
  if (!info) throw new Error(`Unknown account subtype: ${subtype}`);
  const used = new Set(accounts.map((a) => Number(a.code)));
  for (let code = info.codeBase; code < info.codeBase + info.codeSpan; code += 1) {
    if (!used.has(code)) return String(code);
  }
  throw new Error(`No free account codes left for ${info.label}.`);
}

/** @returns {string[]} validation errors (empty when valid) */
export function validateAccount(account, existingAccounts) {
  const errors = [];
  const info = SUBTYPE_INFO[account.subtype];
  const name = typeof account.name === 'string' ? account.name.trim() : '';
  if (!name) errors.push('Account name is required.');
  else if (name.length > 60) errors.push('Account name must be 60 characters or fewer.');
  if (!info) errors.push('Choose a valid account type.');
  else if (info.type !== account.type) errors.push('Account type does not match its subtype.');
  if (!/^\d{4}$/.test(String(account.code ?? ''))) errors.push('Account code must be 4 digits.');

  for (const other of existingAccounts) {
    if (other.id === account.id) continue;
    if (other.code === account.code) errors.push(`Account code ${account.code} is already used.`);
    if (other.type === account.type && other.name.trim().toLowerCase() === name.toLowerCase()) {
      errors.push(`An account named "${name}" already exists.`);
    }
  }
  return errors;
}
