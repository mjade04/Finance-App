/**
 * Planning domain models and pure calculations:
 * - Monthly category budgets & budget utilization
 * - Savings goals & progress tracking
 * - Debts, loans & credit-card workflows (borrowing, principal+interest split, card bill payment)
 * - Recurring bills, due-date schedules & one-tap bill payment entries
 *
 * All monetary amounts are integer centavos (₱1.00 = 100).
 * Android migration: maps to Kotlin domain use cases in `domain.planning`.
 */
import { add, assertCentavos, ratioBasisPoints, subtract } from './money.js';
import { addDays, addMonths, isValidISODate, monthRange } from './dates.js';
import { accountTotals, balancesByAccount, normalBalance } from './ledger.js';
import { creditLine, debitLine, EntryKind } from './journal.js';
import { ValidationError } from './errors.js';

/* ==================== 1. BUDGETS ==================== */

export function validateBudget(budget, accountsById) {
  const errors = [];
  if (!budget || typeof budget !== 'object') return ['Budget is missing.'];
  const account = accountsById.get(budget.accountId);
  if (!account) errors.push('Choose an expense category.');
  else if (account.type !== 'expense') errors.push('Budgets can only be set on expense categories.');
  else if (account.isActive === false) errors.push(`"${account.name}" is archived.`);

  if (!Number.isSafeInteger(budget.amount) || budget.amount <= 0) {
    errors.push('Monthly budget limit must be greater than zero.');
  }
  return errors;
}

/**
 * Compute budget vs. actual spending for a given month ("YYYY-MM").
 * Only posted expense entries in that month count toward spending; transfers,
 * loan principal payments, and credit-card bill settlements never touch expense accounts.
 */
export function computeBudgetPerformance(budgets, accounts, entries, monthKey) {
  const range = monthRange(monthKey);
  const totals = accountTotals(entries, range);
  const accountsById = new Map(accounts.map((a) => [a.id, a]));

  const rows = [];
  let totalLimit = 0;
  let totalSpent = 0;

  const sorted = [...budgets].sort((a, b) => {
    const nameA = accountsById.get(a.accountId)?.name ?? '';
    const nameB = accountsById.get(b.accountId)?.name ?? '';
    return nameA.localeCompare(nameB);
  });

  for (const b of sorted) {
    const account = accountsById.get(b.accountId);
    if (!account) continue;
    const spent = Math.max(0, normalBalance(account, totals.get(account.id)));
    const limit = b.amount;
    const remaining = subtract(limit, spent);
    const utilizationBp = ratioBasisPoints(spent, limit) ?? 0;
    const status = utilizationBp >= 10000 ? 'over' : utilizationBp >= 8000 ? 'warn' : 'ok';
    totalLimit = add(totalLimit, limit);
    totalSpent = add(totalSpent, spent);
    rows.push({
      id: b.id,
      accountId: account.id,
      accountName: account.name,
      icon: account.icon,
      limit,
      spent,
      remaining,
      utilizationBp,
      status,
    });
  }

  // Also summarize unbudgeted expense categories that had spending this month
  const budgetedIds = new Set(budgets.map((b) => b.accountId));
  let unbudgetedSpent = 0;
  for (const account of accounts) {
    if (account.type !== 'expense' || budgetedIds.has(account.id)) continue;
    const spent = Math.max(0, normalBalance(account, totals.get(account.id)));
    if (spent > 0) unbudgetedSpent = add(unbudgetedSpent, spent);
  }

  const totalRemaining = subtract(totalLimit, totalSpent);
  const utilizationBp = totalLimit > 0 ? (ratioBasisPoints(totalSpent, totalLimit) ?? 0) : null;

  return {
    monthKey,
    rows,
    totalLimit,
    totalSpent,
    totalRemaining,
    unbudgetedSpent,
    utilizationBp,
    overCount: rows.filter((r) => r.status === 'over').length,
    warnCount: rows.filter((r) => r.status === 'warn').length,
  };
}

/* ==================== 2. SAVINGS GOALS ==================== */

export function validateGoal(goal, accountsById) {
  const errors = [];
  if (!goal || typeof goal !== 'object') return ['Goal is missing.'];
  const name = typeof goal.name === 'string' ? goal.name.trim() : '';
  if (!name) errors.push('Goal name is required.');
  else if (name.length > 60) errors.push('Goal name must be 60 characters or fewer.');

  if (!Number.isSafeInteger(goal.targetAmount) || goal.targetAmount <= 0) {
    errors.push('Target amount must be greater than zero.');
  }
  if (!Number.isSafeInteger(goal.savedAmount) || goal.savedAmount < 0) {
    errors.push('Saved amount cannot be negative.');
  }
  if (goal.targetDate && !isValidISODate(goal.targetDate)) {
    errors.push('Target date must be a valid calendar date.');
  }
  if (goal.linkedAccountId) {
    const acc = accountsById.get(goal.linkedAccountId);
    if (!acc || acc.type !== 'asset') errors.push('Linked account must be an asset account.');
  }
  return errors;
}

/**
 * Compute progress across all savings goals.
 * If a goal has `useAccountBalance === true` and `linkedAccountId`, its saved
 * amount is the live balance of that asset account; otherwise it uses `goal.savedAmount`
 * (which increases when contributions are recorded).
 */
export function computeGoalsProgress(goals, accounts, entries, today) {
  const balances = balancesByAccount(accounts, entries, { to: today });
  const accountsById = new Map(accounts.map((a) => [a.id, a]));

  let totalTarget = 0;
  let totalSaved = 0;

  const items = goals.map((g) => {
    const linked = g.linkedAccountId ? accountsById.get(g.linkedAccountId) : null;
    const rawCurrent = g.useAccountBalance && linked
      ? Math.max(0, balances.get(linked.id) ?? 0)
      : Math.max(0, g.savedAmount ?? 0);
    const currentAmount = rawCurrent;
    const remainingAmount = Math.max(0, subtract(g.targetAmount, currentAmount));
    const progressBp = ratioBasisPoints(currentAmount, g.targetAmount) ?? 0;
    totalTarget = add(totalTarget, g.targetAmount);
    totalSaved = add(totalSaved, Math.min(currentAmount, g.targetAmount));
    return {
      ...g,
      linkedAccountName: linked?.name ?? null,
      currentAmount,
      remainingAmount,
      progressBp,
      completed: currentAmount >= g.targetAmount,
    };
  });

  return {
    items,
    totalTarget,
    totalSaved,
    progressBp: totalTarget > 0 ? (ratioBasisPoints(totalSaved, totalTarget) ?? 0) : null,
    completedCount: items.filter((i) => i.completed).length,
  };
}

/* ==================== 3. DEBTS, LOANS & CREDIT CARDS ==================== */

/**
 * Borrow money (loan proceeds deposited into cash/bank/e-wallet).
 * Accounting rule: Borrowed money is NEVER income.
 *   Debit  : Asset account (cash/bank/e-wallet)
 *   Credit : Liability account (loan)
 */
export function buildLoanProceeds(input, accountsById) {
  const errors = [];
  if (!isValidISODate(input.date)) errors.push('Choose a valid date.');
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) errors.push('Amount must be greater than zero.');
  const loan = accountsById.get(input.loanAccountId);
  const deposit = accountsById.get(input.depositAccountId);
  if (!loan || loan.type !== 'liability') errors.push('Choose a liability/loan account.');
  if (!deposit || deposit.type !== 'asset') errors.push('Choose an asset account to receive the funds.');

  if (errors.length) throw new ValidationError(errors);
  return {
    date: input.date,
    kind: EntryKind.TRANSFER,
    description: input.description?.trim() || `Loan proceeds: ${loan.name}`,
    note: input.note ?? '',
    lines: [
      debitLine(deposit.id, input.amount),
      creditLine(loan.id, input.amount),
    ],
  };
}

/**
 * Repay a loan with optional interest split:
 *   Debit  : Loan liability (principalAmount) — reduces debt
 *   Debit  : Interest expense (interestAmount, if > 0) — cost of borrowing
 *   Credit : Payment asset account (principalAmount + interestAmount)
 */
export function buildLoanPayment(input, accountsById) {
  const errors = [];
  if (!isValidISODate(input.date)) errors.push('Choose a valid date.');
  const principal = input.principalAmount ?? 0;
  const interest = input.interestAmount ?? 0;
  if (!Number.isSafeInteger(principal) || principal <= 0) errors.push('Principal amount must be greater than zero.');
  if (!Number.isSafeInteger(interest) || interest < 0) errors.push('Interest amount cannot be negative.');

  const loan = accountsById.get(input.loanAccountId);
  const payment = accountsById.get(input.paymentAccountId);
  const interestAcc = interest > 0 ? accountsById.get(input.interestAccountId ?? 'acc-5800') : null;

  if (!loan || loan.type !== 'liability') errors.push('Choose a liability/loan account.');
  if (!payment || payment.type !== 'asset') errors.push('Choose an asset account to pay from.');
  if (interest > 0 && (!interestAcc || interestAcc.type !== 'expense')) {
    errors.push('Choose a valid interest expense category.');
  }

  if (errors.length) throw new ValidationError(errors);
  const totalOut = add(principal, interest);
  const lines = [debitLine(loan.id, principal)];
  if (interest > 0) lines.push(debitLine(interestAcc.id, interest));
  lines.push(creditLine(payment.id, totalOut));

  return {
    date: input.date,
    kind: interest > 0 ? EntryKind.MANUAL : EntryKind.TRANSFER,
    description: input.description?.trim() || `Loan payment: ${loan.name}`,
    note: input.note ?? '',
    lines,
  };
}

/**
 * Pay a credit-card statement balance from a bank/cash/e-wallet account.
 * Accounting rule: Credit card payments must NEVER count as a second expense.
 *   Debit  : Credit card liability account (amount)
 *   Debit  : Optional finance charge / interest expense (interestAmount, if > 0)
 *   Credit : Payment asset account (amount + interestAmount)
 */
export function buildCreditCardPayment(input, accountsById) {
  const errors = [];
  if (!isValidISODate(input.date)) errors.push('Choose a valid date.');
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) errors.push('Amount must be greater than zero.');
  const interest = input.interestAmount ?? 0;
  if (!Number.isSafeInteger(interest) || interest < 0) errors.push('Finance charge cannot be negative.');
  const card = accountsById.get(input.cardAccountId);
  const payment = accountsById.get(input.paymentAccountId);
  const interestAcc = interest > 0 ? accountsById.get(input.interestAccountId ?? 'acc-5800') : null;
  if (!card || card.subtype !== 'credit_card') errors.push('Choose a credit card account.');
  if (!payment || payment.type !== 'asset') errors.push('Choose an asset account to pay from.');
  if (interest > 0 && (!interestAcc || interestAcc.type !== 'expense')) {
    errors.push('Choose a valid interest expense category.');
  }

  if (errors.length) throw new ValidationError(errors);
  const totalOut = add(input.amount, interest);
  const lines = [debitLine(card.id, input.amount)];
  if (interest > 0) lines.push(debitLine(interestAcc.id, interest));
  lines.push(creditLine(payment.id, totalOut));

  return {
    date: input.date,
    kind: interest > 0 ? EntryKind.MANUAL : EntryKind.TRANSFER,
    description: input.description?.trim() || `Card payment: ${card.name}`,
    note: input.note ?? '',
    lines,
  };
}

/**
 * Debt & credit-card summary derived from posted journal entries.
 */
export function computeDebtReport(accounts, entries, { asOf = null } = {}) {
  const posted = asOf ? entries.filter((e) => e.date <= asOf) : entries;
  const totals = accountTotals(posted);
  const liabilities = accounts.filter((a) => a.type === 'liability' && a.isActive !== false);

  let totalBalance = 0;
  let totalBorrowedOrCharged = 0;
  let totalPrincipalRepaid = 0;

  const items = liabilities.map((acc) => {
    const t = totals.get(acc.id) ?? { debit: 0, credit: 0 };
    // For a liability: credits increase debt (borrowing/charges), debits reduce debt (repayments)
    const charged = t.credit;
    const repaid = t.debit;
    const balance = subtract(charged, repaid);
    const creditLimit = Number.isSafeInteger(acc.creditLimit) && acc.creditLimit > 0 ? acc.creditLimit : null;
    const utilizationBp = creditLimit ? (ratioBasisPoints(Math.max(0, balance), creditLimit) ?? 0) : null;
    const payoffBp = charged > 0 ? (ratioBasisPoints(Math.min(repaid, charged), charged) ?? 0) : 0;

    totalBalance = add(totalBalance, balance);
    totalBorrowedOrCharged = add(totalBorrowedOrCharged, charged);
    totalPrincipalRepaid = add(totalPrincipalRepaid, repaid);

    return {
      account: acc,
      subtype: acc.subtype,
      charged,
      repaid,
      balance,
      creditLimit,
      availableCredit: creditLimit ? Math.max(0, subtract(creditLimit, Math.max(0, balance))) : null,
      utilizationBp,
      payoffBp,
      statementDay: acc.statementDay ?? null,
      dueDay: acc.dueDay ?? null,
    };
  });

  return {
    items,
    totalBalance,
    totalBorrowedOrCharged,
    totalPrincipalRepaid,
    overallPayoffBp: totalBorrowedOrCharged > 0
      ? (ratioBasisPoints(Math.min(totalPrincipalRepaid, totalBorrowedOrCharged), totalBorrowedOrCharged) ?? 0)
      : null,
  };
}

/* ==================== 4. RECURRING BILLS ==================== */

export const BILL_FREQUENCIES = Object.freeze({
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
});

export function validateBill(bill, accountsById) {
  const errors = [];
  if (!bill || typeof bill !== 'object') return ['Bill is missing.'];
  const name = typeof bill.name === 'string' ? bill.name.trim() : '';
  if (!name) errors.push('Bill name is required.');
  else if (name.length > 60) errors.push('Bill name must be 60 characters or fewer.');

  if (!Number.isSafeInteger(bill.amount) || bill.amount <= 0) {
    errors.push('Bill amount must be greater than zero.');
  }
  if (!isValidISODate(bill.nextDueDate)) {
    errors.push('Next due date must be a valid calendar date.');
  }
  if (!Object.keys(BILL_FREQUENCIES).includes(bill.frequency)) {
    errors.push('Choose a valid billing frequency.');
  }
  const exp = accountsById.get(bill.expenseAccountId);
  if (!exp || exp.type !== 'expense') errors.push('Choose an expense category.');
  const pay = accountsById.get(bill.paymentAccountId);
  if (!pay || (pay.type !== 'asset' && pay.type !== 'liability')) errors.push('Choose a payment account.');
  return errors;
}

/** Advance a bill's `nextDueDate` by one period according to its frequency. */
export function advanceBillDueDate(isoDate, frequency = 'monthly') {
  if (frequency === 'weekly') return addDays(isoDate, 7);
  const delta = frequency === 'quarterly' ? 3 : frequency === 'yearly' ? 12 : 1;
  const nextMonth = addMonths(isoDate.slice(0, 7), delta);
  const day = Number(isoDate.slice(8, 10));
  const { to } = monthRange(nextMonth);
  const maxDay = Number(to.slice(8, 10));
  const clampedDay = String(Math.min(day, maxDay)).padStart(2, '0');
  return `${nextMonth}-${clampedDay}`;
}

function diffDays(fromISO, toISO) {
  const a = Date.UTC(Number(fromISO.slice(0, 4)), Number(fromISO.slice(5, 7)) - 1, Number(fromISO.slice(8, 10)));
  const b = Date.UTC(Number(toISO.slice(0, 4)), Number(toISO.slice(5, 7)) - 1, Number(toISO.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

/**
 * Evaluate due status of all recurring bills relative to `today`.
 */
export function computeBillsStatus(bills, accounts, today) {
  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const items = bills
    .filter((b) => b.isActive !== false)
    .map((b) => {
      const daysUntilDue = diffDays(today, b.nextDueDate);
      const status = daysUntilDue < 0 ? 'overdue' : daysUntilDue <= 7 ? 'due_soon' : 'upcoming';
      const exp = accountsById.get(b.expenseAccountId);
      const pay = accountsById.get(b.paymentAccountId);
      return {
        ...b,
        expenseAccountName: exp?.name ?? 'Expense',
        paymentAccountName: pay?.name ?? 'Account',
        icon: exp?.icon ?? 'calendar',
        daysUntilDue,
        status,
      };
    })
    .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));

  let totalUpcomingAmount = 0;
  for (const item of items) {
    assertCentavos(item.amount);
    totalUpcomingAmount = add(totalUpcomingAmount, item.amount);
  }

  return {
    items,
    overdueCount: items.filter((i) => i.status === 'overdue').length,
    dueSoonCount: items.filter((i) => i.status === 'due_soon').length,
    totalUpcomingAmount,
  };
}
