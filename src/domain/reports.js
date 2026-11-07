/**
 * Accounting & financial statements derived strictly from posted journal entries:
 * - General Ledger (chronological postings with running normal balance)
 * - Income Statement (Revenue − Expenses = Net Income)
 * - Balance Sheet (Assets = Liabilities + Equity)
 * - Statement of Cash Flows (Operating, Investing, Financing cash flows)
 * - Net-Worth Report (multi-month net worth history + asset/liability composition)
 *
 * Trial Balance and Accounting Equation checks live in `./ledger.js` and are
 * re-exported here for convenience.
 */
import { add, ratioBasisPoints, subtract } from './money.js';
import { LIQUID_SUBTYPES, NORMAL_BALANCE } from './accounts.js';
import { accountTotals, balancesByAccount, normalBalance, totalsByType, trialBalance, accountingEquation } from './ledger.js';
import { addMonths, lastNMonths, monthKeyOf, monthRange } from './dates.js';

export { trialBalance, accountingEquation };

/**
 * General Ledger for one or all accounts over an optional date range.
 * Computes opening balance prior to `from`, then steps chronologically
 * through each posting in `[from, to]` to produce a running normal balance.
 */
export function generalLedger(accounts, entries, { accountId = null, from = null, to = null } = {}) {
  const sortedEntries = [...entries].sort(
    (a, b) => a.date.localeCompare(b.date) || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''),
  );
  const targetAccounts = accountId
    ? accounts.filter((a) => a.id === accountId)
    : [...accounts].sort((a, b) => a.code.localeCompare(b.code));

  const ledgers = [];
  for (const account of targetAccounts) {
    const isDebitNormal = NORMAL_BALANCE[account.type] === 'debit';
    let openingBalance = 0;
    let totalDebit = 0;
    let totalCredit = 0;
    const rows = [];

    for (const entry of sortedEntries) {
      if (to && entry.date > to) continue;
      for (const line of entry.lines) {
        if (line.accountId !== account.id) continue;
        const delta = isDebitNormal
          ? subtract(line.debit, line.credit)
          : subtract(line.credit, line.debit);
        if (from && entry.date < from) {
          openingBalance = add(openingBalance, delta);
        } else {
          totalDebit = add(totalDebit, line.debit);
          totalCredit = add(totalCredit, line.credit);
          const prevBalance = rows.length ? rows[rows.length - 1].balance : openingBalance;
          const balance = add(prevBalance, delta);
          rows.push({
            entryId: entry.id,
            date: entry.date,
            kind: entry.kind,
            description: entry.description,
            reversedById: entry.reversedById,
            debit: line.debit,
            credit: line.credit,
            balance,
          });
        }
      }
    }

    const closingBalance = rows.length ? rows[rows.length - 1].balance : openingBalance;
    if (accountId || openingBalance !== 0 || rows.length > 0) {
      ledgers.push({
        account,
        normalSide: NORMAL_BALANCE[account.type],
        openingBalance,
        totalDebit,
        totalCredit,
        closingBalance,
        rows,
      });
    }
  }

  return { ledgers, from, to };
}

/**
 * Income Statement (Profit & Loss) for `[from, to]`.
 * Transfers, loan proceeds, and credit-card bill payments never touch `income`
 * or `expense` accounts, so they are automatically excluded.
 */
export function incomeStatement(accounts, entries, { from = null, to = null } = {}) {
  const totals = accountTotals(entries, { from, to });
  const sorted = [...accounts].sort((a, b) => a.code.localeCompare(b.code));

  const incomeRows = [];
  const expenseRows = [];
  let totalIncome = 0;
  let totalExpenses = 0;

  for (const account of sorted) {
    const t = totals.get(account.id);
    if (!t) continue;
    const balance = normalBalance(account, t);
    if (balance === 0) continue;
    if (account.type === 'income') {
      incomeRows.push({ account, amount: balance });
      totalIncome = add(totalIncome, balance);
    } else if (account.type === 'expense') {
      expenseRows.push({ account, amount: balance });
      totalExpenses = add(totalExpenses, balance);
    }
  }

  const netIncome = subtract(totalIncome, totalExpenses);
  const savingsRateBp = totalIncome > 0 ? ratioBasisPoints(netIncome, totalIncome) : null;

  return {
    from,
    to,
    incomeRows,
    expenseRows,
    totalIncome,
    totalExpenses,
    netIncome,
    savingsRateBp,
  };
}

/**
 * Balance Sheet as of `asOf` date.
 * Verifies the fundamental accounting identity: Assets = Liabilities + Equity,
 * where Equity = Contributed/Opening Equity + Retained Earnings (cumulative Net Income to `asOf`).
 */
export function balanceSheet(accounts, entries, { asOf = null } = {}) {
  const balances = balancesByAccount(accounts, entries, { to: asOf });
  const eq = accountingEquation(accounts, entries, { asOf });
  const sorted = [...accounts].sort((a, b) => a.code.localeCompare(b.code));

  const assetRows = [];
  const liabilityRows = [];
  const equityRows = [];

  for (const account of sorted) {
    const balance = balances.get(account.id) ?? 0;
    if (balance === 0) continue;
    if (account.type === 'asset') assetRows.push({ account, amount: balance });
    else if (account.type === 'liability') liabilityRows.push({ account, amount: balance });
    else if (account.type === 'equity') equityRows.push({ account, amount: balance });
  }

  return {
    asOf,
    assetRows,
    liabilityRows,
    equityRows,
    retainedEarnings: eq.netIncome,
    totalAssets: eq.assets,
    totalLiabilities: eq.liabilities,
    totalContributedEquity: eq.contributedEquity,
    totalEquity: eq.equity,
    totalLiabilitiesAndEquity: eq.liabilitiesPlusEquity,
    balanced: eq.balanced,
  };
}

function dayBefore(isoDate) {
  const d = new Date(Date.UTC(Number(isoDate.slice(0, 4)), Number(isoDate.slice(5, 7)) - 1, Number(isoDate.slice(8, 10))));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function liquidBalanceAsOf(accounts, entries, asOf) {
  if (!asOf) return 0;
  const balances = balancesByAccount(accounts, entries, { to: asOf });
  let total = 0;
  for (const acc of accounts) {
    if (LIQUID_SUBTYPES.has(acc.subtype)) {
      total = add(total, balances.get(acc.id) ?? 0);
    }
  }
  return total;
}

/**
 * Direct Statement of Cash Flows for `[from, to]`.
 * Classifies every journal entry that changes liquid cash (cash, bank, e-wallet)
 * according to the counterpart non-liquid accounts involved:
 * - Operating: income & expense accounts
 * - Investing: investment, receivable & other non-liquid asset accounts
 * - Financing: liability (loans, credit cards, payables) & equity (opening balance) accounts
 *
 * Pure internal transfers between two liquid accounts (e.g. Bank -> GCash) have
 * net liquid change = 0 and do not inflate cash inflows or outflows.
 */
export function cashFlowStatement(accounts, entries, { from = null, to = null } = {}) {
  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const beginningCash = from ? liquidBalanceAsOf(accounts, entries, dayBefore(from)) : 0;
  const endingCash = liquidBalanceAsOf(accounts, entries, to);

  let operatingIn = 0;
  let operatingOut = 0;
  let investingNet = 0;
  let financingNet = 0;

  const operatingRows = [];
  const investingRows = [];
  const financingRows = [];

  for (const entry of entries) {
    if (from && entry.date < from) continue;
    if (to && entry.date > to) continue;

    // Net liquid cash delta for this entry
    let liquidDelta = 0;
    const nonLiquidLines = [];
    for (const line of entry.lines) {
      const acc = accountsById.get(line.accountId);
      if (!acc) continue;
      if (LIQUID_SUBTYPES.has(acc.subtype)) {
        liquidDelta = add(liquidDelta, subtract(line.debit, line.credit));
      } else {
        nonLiquidLines.push({ acc, line });
      }
    }
    if (liquidDelta === 0) continue;

    // Attribute each non-liquid counterpart line's impact on cash:
    // For a balanced entry, sum(liquid debit - credit) === sum(non-liquid credit - debit)
    for (const { acc, line } of nonLiquidLines) {
      const cashEffect = subtract(line.credit, line.debit);
      if (cashEffect === 0) continue;
      const item = { date: entry.date, description: entry.description, accountName: acc.name, amount: cashEffect };
      if (acc.type === 'income' || acc.type === 'expense') {
        if (cashEffect > 0) operatingIn = add(operatingIn, cashEffect);
        else operatingOut = add(operatingOut, -cashEffect);
        operatingRows.push(item);
      } else if (acc.type === 'asset') {
        investingNet = add(investingNet, cashEffect);
        investingRows.push(item);
      } else {
        financingNet = add(financingNet, cashEffect);
        financingRows.push(item);
      }
    }
  }

  const operatingNet = subtract(operatingIn, operatingOut);
  const netCashFlow = add(add(operatingNet, investingNet), financingNet);
  const reconciled = add(beginningCash, netCashFlow) === endingCash;

  return {
    from,
    to,
    beginningCash,
    operatingIn,
    operatingOut,
    operatingNet,
    investingNet,
    financingNet,
    netCashFlow,
    endingCash,
    reconciled,
    operatingRows,
    investingRows,
    financingRows,
  };
}

/**
 * Net-Worth Report: current asset/liability breakdown + monthly net-worth history.
 */
export function netWorthReport(accounts, entries, { today, months = 6 } = {}) {
  const currentMonth = monthKeyOf(today);
  const keys = lastNMonths(currentMonth, months);

  const history = keys.map((key, idx) => {
    const { to } = monthRange(key);
    const asOf = to < today ? to : today;
    const byType = totalsByType(accounts, balancesByAccount(accounts, entries, { to: asOf }));
    const assets = byType.asset;
    const liabilities = byType.liability;
    const netWorth = subtract(assets, liabilities);

    let prevNetWorth = 0;
    if (idx > 0) {
      const prevTo = monthRange(keys[idx - 1]).to;
      const prevByType = totalsByType(accounts, balancesByAccount(accounts, entries, { to: prevTo }));
      prevNetWorth = subtract(prevByType.asset, prevByType.liability);
    } else {
      const priorMonth = addMonths(key, -1);
      const priorTo = monthRange(priorMonth).to;
      const priorByType = totalsByType(accounts, balancesByAccount(accounts, entries, { to: priorTo }));
      prevNetWorth = subtract(priorByType.asset, priorByType.liability);
    }

    return {
      monthKey: key,
      asOf,
      assets,
      liabilities,
      netWorth,
      change: subtract(netWorth, prevNetWorth),
    };
  });

  const currentBs = balanceSheet(accounts, entries, { asOf: today });
  const debtToAssetBp = currentBs.totalAssets > 0
    ? (ratioBasisPoints(currentBs.totalLiabilities, currentBs.totalAssets) ?? 0)
    : null;
  return {
    asOf: today,
    totalAssets: currentBs.totalAssets,
    totalLiabilities: currentBs.totalLiabilities,
    netWorth: subtract(currentBs.totalAssets, currentBs.totalLiabilities),
    debtToAssetBp,
    assetRows: currentBs.assetRows,
    liabilityRows: currentBs.liabilityRows,
    history,
  };
}
