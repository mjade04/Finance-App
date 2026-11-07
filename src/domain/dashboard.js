/**
 * Dashboard metrics — a pure function of (accounts, entries, today).
 * Every figure comes from posted journal entries; nothing is hard-coded.
 */
import { add, subtract } from './money.js';
import { LIQUID_SUBTYPES } from './accounts.js';
import { accountTotals, balancesByAccount, normalBalance, totalsByType, trialBalance, accountingEquation } from './ledger.js';
import { lastNMonths, monthKeyOf, monthRange } from './dates.js';
import { computeBudgetPerformance, computeGoalsProgress, computeBillsStatus } from './planning.js';

/** Net change an entry causes in cash-equivalent accounts (cash, bank, e-wallet). */
export function liquidDelta(entry, accountsById) {
  let delta = 0;
  for (const line of entry.lines) {
    const account = accountsById.get(line.accountId);
    if (account && LIQUID_SUBTYPES.has(account.subtype)) {
      delta = add(delta, subtract(line.debit, line.credit));
    }
  }
  return delta;
}

function summarizePeriod(accounts, accountsById, entries, { from, to }) {
  const inRange = entries.filter((e) => e.date >= from && e.date <= to);
  const totals = accountTotals(inRange);
  let income = 0;
  let expenses = 0;
  const byCategory = [];
  for (const account of accounts) {
    const t = totals.get(account.id);
    if (!t) continue;
    if (account.type === 'income') income = add(income, normalBalance(account, t));
    if (account.type === 'expense') {
      const spent = normalBalance(account, t);
      expenses = add(expenses, spent);
      if (spent > 0) byCategory.push({ accountId: account.id, name: account.name, icon: account.icon, amount: spent });
    }
  }
  let cashIn = 0;
  let cashOut = 0;
  for (const entry of inRange) {
    const delta = liquidDelta(entry, accountsById);
    if (delta > 0) cashIn = add(cashIn, delta);
    else if (delta < 0) cashOut = subtract(cashOut, delta);
  }
  byCategory.sort((a, b) => b.amount - a.amount);
  return {
    income,
    expenses,
    netIncome: subtract(income, expenses),
    cashIn,
    cashOut,
    netCashFlow: subtract(cashIn, cashOut),
    byCategory,
  };
}

function netWorthAsOf(accounts, entries, date) {
  const byType = totalsByType(accounts, balancesByAccount(accounts, entries, { to: date }));
  return subtract(byType.asset, byType.liability);
}

/**
 * @param {{accounts: object[], entries: object[], budgets?: object[], goals?: object[], bills?: object[], today: string, months?: number}} input
 */
export function computeDashboard({ accounts, entries, budgets = [], goals = [], bills = [], today, months = 6 }) {
  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const currentMonth = monthKeyOf(today);
  const balances = balancesByAccount(accounts, entries, { to: today });

  const groups = { cash: 0, bank: 0, ewallet: 0, creditCards: 0, loans: 0, otherLiabilities: 0 };
  let totalAssets = 0;
  let totalLiabilities = 0;
  for (const account of accounts) {
    const balance = balances.get(account.id) ?? 0;
    if (account.type === 'asset') totalAssets = add(totalAssets, balance);
    if (account.type === 'liability') totalLiabilities = add(totalLiabilities, balance);
    if (account.subtype === 'cash') groups.cash = add(groups.cash, balance);
    else if (account.subtype === 'bank') groups.bank = add(groups.bank, balance);
    else if (account.subtype === 'ewallet') groups.ewallet = add(groups.ewallet, balance);
    else if (account.subtype === 'credit_card') groups.creditCards = add(groups.creditCards, balance);
    else if (account.subtype === 'loan') groups.loans = add(groups.loans, balance);
    else if (account.type === 'liability') groups.otherLiabilities = add(groups.otherLiabilities, balance);
  }

  const month = { key: currentMonth, ...summarizePeriod(accounts, accountsById, entries, monthRange(currentMonth)) };

  const trend = lastNMonths(currentMonth, months).map((key) => {
    const range = monthRange(key);
    const summary = summarizePeriod(accounts, accountsById, entries, range);
    const asOf = range.to < today ? range.to : today;
    return {
      key,
      income: summary.income,
      expenses: summary.expenses,
      cashIn: summary.cashIn,
      cashOut: summary.cashOut,
      netWorth: netWorthAsOf(accounts, entries, asOf),
    };
  });

  const postedToDate = entries.filter((e) => e.date <= today);
  const recent = [...entries]
    .sort((a, b) => (b.date.localeCompare(a.date)) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);

  const tb = trialBalance(accounts, postedToDate);
  const equation = accountingEquation(accounts, postedToDate);

  const budgetUtilization = computeBudgetPerformance(budgets, accounts, entries, currentMonth);
  const savingsProgress = computeGoalsProgress(goals, accounts, entries, today);
  const upcomingBills = computeBillsStatus(bills, accounts, today);

  return {
    hasEntries: entries.length > 0,
    liquid: { ...groups, total: add(add(groups.cash, groups.bank), groups.ewallet) },
    totalAssets,
    totalLiabilities,
    netWorth: subtract(totalAssets, totalLiabilities),
    outstandingDebt: {
      total: totalLiabilities,
      creditCards: groups.creditCards,
      loans: groups.loans,
      other: groups.otherLiabilities,
    },
    month,
    trend,
    recent,
    budgetUtilization,
    savingsProgress,
    upcomingBills,
    health: {
      trialBalanced: tb.balanced,
      equationBalanced: equation.balanced,
      totalDebit: tb.totalDebit,
      totalCredit: tb.totalCredit,
      equation,
    },
  };
}
