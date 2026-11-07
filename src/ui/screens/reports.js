/**
 * Reports hub & interactive financial statements:
 * 1. General ledger
 * 2. Trial balance (Total debits = Total credits)
 * 3. Income statement (Revenue − Expenses = Net Income)
 * 4. Balance sheet (Assets = Liabilities + Equity)
 * 5. Cash-flow statement (Operating, Investing, Financing; Beginning + Net = Ending Cash)
 * 6. Net-worth report (6-month history + asset/liability composition)
 * 7. Budget performance (Budget vs. Actual by category)
 * 8. Debt repayment report (Principal charged, repaid, balance & payoff %)
 */
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { card, emptyState, field, listRow, money, progressBar } from '../components.js';
import { lineChart } from '../charts.js';
import { formatBasisPoints, formatMoney } from '../../domain/money.js';
import { formatDisplayDate, monthKeyOf, monthLongLabel, monthRange, monthShortLabel } from '../../domain/dates.js';
import {
  accountingEquation,
  balanceSheet,
  cashFlowStatement,
  incomeStatement,
  netWorthReport,
  trialBalance,
} from '../../domain/reports.js';
import { computeBudgetPerformance, computeDebtReport } from '../../domain/planning.js';
import { renderGeneralLedger } from './modules.js';

export const REPORT_DEFS = {
  'general-ledger': { title: 'General ledger', icon: 'book', sub: 'Every posting per account with running balance' },
  'trial-balance': { title: 'Trial balance', icon: 'scale', sub: 'Debit and credit balances of all accounts (Dr = Cr)' },
  'income-statement': { title: 'Income statement', icon: 'trendUp', sub: 'Revenue, expenses and net income for a period' },
  'balance-sheet': { title: 'Balance sheet', icon: 'layers', sub: 'Assets = Liabilities + Equity as of a date' },
  'cash-flow': { title: 'Cash-flow statement', icon: 'transfer', sub: 'Operating, investing and financing cash flows' },
  'net-worth': { title: 'Net-worth report', icon: 'wallet', sub: 'Net worth history and asset/liability composition' },
  'budget-performance': { title: 'Budget performance', icon: 'pie', sub: 'Monthly budget vs. actual spending per category' },
  'debt-repayment': { title: 'Debt repayment report', icon: 'trendDown', sub: 'Credit cards, loans, principal repaid and balances' },
};

export function reportTitle(key) {
  return REPORT_DEFS[key]?.title ?? 'Financial report';
}

export function renderReports({ service }) {
  const { accounts, entries } = service.state;
  const asOf = service.today();
  const posted = entries.filter((e) => e.date <= asOf);
  const tb = trialBalance(accounts, posted);
  const eq = accountingEquation(accounts, posted);

  const check = (ok, label) => h('span', { class: `health-chip ${ok ? 'ok' : 'bad'}` }, icon(ok ? 'check' : 'alert', { size: 14 }), label);

  const integrity = card({
    title: 'Ledger integrity & accounting identities',
    action: check(tb.balanced && eq.balanced, tb.balanced && eq.balanced ? 'Verified' : 'Problem'),
    children: [
      h('div', { class: 'identity' },
        h('p', { class: 'identity-title' }, 'Identity 1 · Total debits = Total credits'),
        h('div', { class: 'identity-row' }, money(tb.totalDebit), h('span', { class: 'op' }, tb.balanced ? '=' : '≠'), money(tb.totalCredit))),
      h('div', { class: 'identity' },
        h('p', { class: 'identity-title' }, 'Identity 2 · Assets = Liabilities + Equity'),
        h('div', { class: 'identity-row' }, money(eq.assets), h('span', { class: 'op' }, eq.balanced ? '=' : '≠'),
          money(eq.liabilities), h('span', { class: 'op' }, '+'), money(eq.equity))),
      h('p', { class: 'muted small' },
        'Equity = opening balance equity ', money(eq.contributedEquity),
        ' + cumulative net income ', money(eq.netIncome, { colorize: true }),
        '. Derived live from ', String(posted.length), ' posted journal entries.'),
    ],
  });

  const reportLink = (key) => listRow({
    href: `#/report/${key}`,
    iconName: REPORT_DEFS[key].icon,
    tone: 'neutral',
    title: REPORT_DEFS[key].title,
    subtitle: REPORT_DEFS[key].sub,
    trailing: icon('chevronRight', { size: 18 }),
  });

  return h('div', { class: 'stack' },
    integrity,
    card({ title: 'Accounting statements', children: [h('div', { class: 'rows' },
      reportLink('general-ledger'),
      reportLink('trial-balance'),
      reportLink('income-statement'),
      reportLink('balance-sheet'),
      reportLink('cash-flow'),
      reportLink('net-worth'))] }),
    card({ title: 'Planning & debt reports', children: [h('div', { class: 'rows' },
      reportLink('budget-performance'),
      reportLink('debt-repayment'))] }));
}

export function renderReportDetail({ service, params }) {
  const key = params.key;
  switch (key) {
    case 'general-ledger':
      return renderGeneralLedger({ service });
    case 'trial-balance':
      return renderTrialBalanceReport(service);
    case 'income-statement':
      return renderIncomeStatementReport(service);
    case 'balance-sheet':
      return renderBalanceSheetReport(service);
    case 'cash-flow':
      return renderCashFlowReport(service);
    case 'net-worth':
      return renderNetWorthReport(service);
    case 'budget-performance':
      return renderBudgetPerformanceReport(service);
    case 'debt-repayment':
      return renderDebtRepaymentReport(service);
    default:
      return card({ children: [emptyState({ iconName: 'alert', title: 'Report not found' })] });
  }
}

/* ---------- 2. Trial Balance ---------- */
function renderTrialBalanceReport(service) {
  const { accounts, entries } = service.state;
  const host = h('div', { class: 'stack' });
  const asOfInput = h('input', { class: 'input', type: 'date', value: service.today() });

  const refresh = () => {
    const asOf = asOfInput.value || service.today();
    const tb = trialBalance(accounts, entries, { asOf });
    host.replaceChildren(
      card({
        title: `Trial balance as of ${formatDisplayDate(asOf)}`,
        action: h('span', { class: `health-chip ${tb.balanced ? 'ok' : 'bad'}` },
          icon(tb.balanced ? 'check' : 'alert', { size: 14 }),
          tb.balanced ? 'Debits = Credits' : 'Unbalanced'),
        children: tb.rows.length === 0
          ? [emptyState({ iconName: 'scale', title: 'No account balances as of this date' })]
          : [
            h('table', { class: 'table' },
              h('thead', {}, h('tr', {},
                h('th', {}, 'Code'),
                h('th', {}, 'Account'),
                h('th', { class: 'r' }, 'Debit'),
                h('th', { class: 'r' }, 'Credit'))),
              h('tbody', {}, tb.rows.map((r) => h('tr', {},
                h('td', { class: 'code' }, r.account.code),
                h('td', {}, r.account.name),
                h('td', { class: 'r num' }, r.debit ? formatMoney(r.debit) : '—'),
                h('td', { class: 'r num' }, r.credit ? formatMoney(r.credit) : '—')))),
              h('tfoot', {}, h('tr', {},
                h('th', { colspan: 2 }, 'Total'),
                h('td', { class: 'r num' }, formatMoney(tb.totalDebit)),
                h('td', { class: 'r num' }, formatMoney(tb.totalCredit))))),
          ],
      }),
    );
  };
  asOfInput.addEventListener('change', refresh);
  refresh();

  return h('div', { class: 'stack' },
    card({ children: [field({ label: 'Balance as of date', control: asOfInput })] }),
    host);
}

/* ---------- 3. Income Statement ---------- */
function renderIncomeStatementReport(service) {
  const { accounts, entries } = service.state;
  const { from: defFrom, to: defTo } = monthRange(monthKeyOf(service.today()));
  const fromInput = h('input', { class: 'input', type: 'date', value: defFrom });
  const toInput = h('input', { class: 'input', type: 'date', value: defTo });
  const host = h('div', { class: 'stack' });

  const refresh = () => {
    const is = incomeStatement(accounts, entries, { from: fromInput.value || null, to: toInput.value || null });
    host.replaceChildren(
      card({
        title: 'Summary',
        children: [
          h('div', { class: 'kpis' },
            h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, 'Revenue'), money(is.totalIncome, { className: 'kpi-value' })),
            h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, 'Expenses'), money(is.totalExpenses, { className: 'kpi-value' })),
            h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, 'Net income'), money(is.netIncome, { className: 'kpi-value', colorize: true }))),
          h('p', { class: 'muted small' }, `Savings rate: ${formatBasisPoints(is.savingsRateBp)}`),
        ],
      }),
      card({
        title: 'Revenue (Income)',
        children: is.incomeRows.length === 0
          ? [h('p', { class: 'muted small' }, 'No revenue recorded in this period.')]
          : [h('table', { class: 'table' },
            h('tbody', {}, is.incomeRows.map((r) => h('tr', {},
              h('td', { class: 'code' }, r.account.code),
              h('td', {}, r.account.name),
              h('td', { class: 'r num pos' }, formatMoney(r.amount))))),
            h('tfoot', {}, h('tr', {},
              h('th', { colspan: 2 }, 'Total revenue'),
              h('td', { class: 'r num pos' }, formatMoney(is.totalIncome)))))],
      }),
      card({
        title: 'Operating & financial expenses',
        children: is.expenseRows.length === 0
          ? [h('p', { class: 'muted small' }, 'No expenses recorded in this period.')]
          : [h('table', { class: 'table' },
            h('tbody', {}, is.expenseRows.map((r) => h('tr', {},
              h('td', { class: 'code' }, r.account.code),
              h('td', {}, r.account.name),
              h('td', { class: 'r num neg' }, formatMoney(r.amount))))),
            h('tfoot', {}, h('tr', {},
              h('th', { colspan: 2 }, 'Total expenses'),
              h('td', { class: 'r num neg' }, formatMoney(is.totalExpenses)))))],
      }),
    );
  };
  fromInput.addEventListener('change', refresh);
  toInput.addEventListener('change', refresh);
  refresh();

  return h('div', { class: 'stack' },
    card({
      children: [h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } },
        field({ label: 'From date', control: fromInput }),
        field({ label: 'To date', control: toInput }))],
    }),
    host);
}

/* ---------- 4. Balance Sheet ---------- */
function renderBalanceSheetReport(service) {
  const { accounts, entries } = service.state;
  const asOfInput = h('input', { class: 'input', type: 'date', value: service.today() });
  const host = h('div', { class: 'stack' });

  const refresh = () => {
    const asOf = asOfInput.value || service.today();
    const bs = balanceSheet(accounts, entries, { asOf });
    host.replaceChildren(
      card({
        title: `Accounting identity as of ${formatDisplayDate(asOf)}`,
        action: h('span', { class: `health-chip ${bs.balanced ? 'ok' : 'bad'}` },
          icon(bs.balanced ? 'check' : 'alert', { size: 14 }),
          bs.balanced ? 'Assets = L + E' : 'Unbalanced'),
        children: [
          h('div', { class: 'identity-row' },
            'Assets ', money(bs.totalAssets),
            h('span', { class: 'op' }, '='),
            'Liabilities ', money(bs.totalLiabilities),
            h('span', { class: 'op' }, '+'),
            'Equity ', money(bs.totalEquity)),
        ],
      }),
      card({
        title: 'Assets',
        children: bs.assetRows.length === 0
          ? [h('p', { class: 'muted small' }, 'No asset balances.')]
          : [h('table', { class: 'table' },
            h('tbody', {}, bs.assetRows.map((r) => h('tr', {},
              h('td', { class: 'code' }, r.account.code),
              h('td', {}, r.account.name),
              h('td', { class: 'r num' }, formatMoney(r.amount))))),
            h('tfoot', {}, h('tr', {}, h('th', { colspan: 2 }, 'Total assets'), h('td', { class: 'r num' }, formatMoney(bs.totalAssets)))))],
      }),
      card({
        title: 'Liabilities',
        children: bs.liabilityRows.length === 0
          ? [h('p', { class: 'muted small' }, 'No liabilities owed.')]
          : [h('table', { class: 'table' },
            h('tbody', {}, bs.liabilityRows.map((r) => h('tr', {},
              h('td', { class: 'code' }, r.account.code),
              h('td', {}, r.account.name),
              h('td', { class: 'r num neg' }, formatMoney(r.amount))))),
            h('tfoot', {}, h('tr', {}, h('th', { colspan: 2 }, 'Total liabilities'), h('td', { class: 'r num neg' }, formatMoney(bs.totalLiabilities)))))],
      }),
      card({
        title: 'Equity',
        children: [h('table', { class: 'table' },
          h('tbody', {},
            ...bs.equityRows.map((r) => h('tr', {},
              h('td', { class: 'code' }, r.account.code),
              h('td', {}, r.account.name),
              h('td', { class: 'r num' }, formatMoney(r.amount)))),
            h('tr', {},
              h('td', { class: 'code' }, 'RE'),
              h('td', {}, 'Retained earnings (cumulative net income)'),
              h('td', { class: 'r num' }, formatMoney(bs.retainedEarnings)))),
          h('tfoot', {},
            h('tr', {}, h('th', { colspan: 2 }, 'Total equity'), h('td', { class: 'r num' }, formatMoney(bs.totalEquity))),
            h('tr', {}, h('th', { colspan: 2 }, 'Total liabilities + equity'), h('td', { class: 'r num' }, formatMoney(bs.totalLiabilitiesAndEquity)))))],
      }),
    );
  };
  asOfInput.addEventListener('change', refresh);
  refresh();

  return h('div', { class: 'stack' },
    card({ children: [field({ label: 'Balance sheet as of date', control: asOfInput })] }),
    host);
}

/* ---------- 5. Cash-Flow Statement ---------- */
function renderCashFlowReport(service) {
  const { accounts, entries } = service.state;
  const { from: defFrom, to: defTo } = monthRange(monthKeyOf(service.today()));
  const fromInput = h('input', { class: 'input', type: 'date', value: defFrom });
  const toInput = h('input', { class: 'input', type: 'date', value: defTo });
  const host = h('div', { class: 'stack' });

  const refresh = () => {
    const cf = cashFlowStatement(accounts, entries, { from: fromInput.value || null, to: toInput.value || null });
    host.replaceChildren(
      card({
        title: 'Cash reconciliation (Cash + Banks + E-wallets)',
        action: h('span', { class: `health-chip ${cf.reconciled ? 'ok' : 'bad'}` },
          icon(cf.reconciled ? 'check' : 'alert', { size: 14 }),
          cf.reconciled ? 'Reconciled' : 'Check'),
        children: [
          h('table', { class: 'table' },
            h('tbody', {},
              h('tr', {}, h('td', {}, 'Beginning liquid cash'), h('td', { class: 'r num' }, formatMoney(cf.beginningCash))),
              h('tr', {}, h('td', {}, 'Operating cash inflows (income)'), h('td', { class: 'r num pos' }, formatMoney(cf.operatingIn, { signDisplay: 'always' }))),
              h('tr', {}, h('td', {}, 'Operating cash outflows (expenses)'), h('td', { class: 'r num neg' }, formatMoney(-cf.operatingOut))),
              h('tr', {}, h('th', {}, 'Net cash from operating activities'), h('td', { class: 'r num' }, formatMoney(cf.operatingNet, { signDisplay: 'always' }))),
              h('tr', {}, h('td', {}, 'Net cash from investing activities'), h('td', { class: 'r num' }, formatMoney(cf.investingNet, { signDisplay: 'always' }))),
              h('tr', {}, h('td', {}, 'Net cash from financing activities (opening, loans, card payments)'), h('td', { class: 'r num' }, formatMoney(cf.financingNet, { signDisplay: 'always' }))),
              h('tr', {}, h('th', {}, 'Net change in cash'), h('td', { class: 'r num' }, formatMoney(cf.netCashFlow, { signDisplay: 'always' }))),
            ),
            h('tfoot', {},
              h('tr', {}, h('th', {}, 'Ending liquid cash'), h('td', { class: 'r num' }, formatMoney(cf.endingCash))))),
        ],
      }),
    );
  };
  fromInput.addEventListener('change', refresh);
  toInput.addEventListener('change', refresh);
  refresh();

  return h('div', { class: 'stack' },
    card({
      children: [h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } },
        field({ label: 'From date', control: fromInput }),
        field({ label: 'To date', control: toInput }))],
    }),
    host);
}

/* ---------- 6. Net-Worth Report ---------- */
function renderNetWorthReport(service) {
  const { accounts, entries } = service.state;
  const nw = netWorthReport(accounts, entries, { today: service.today(), months: 6 });
  const labels = nw.history.map((hItem) => monthShortLabel(hItem.monthKey));
  const values = nw.history.map((hItem) => hItem.netWorth);

  return h('div', { class: 'stack' },
    card({
      title: 'Current net-worth position',
      children: [
        h('div', { class: 'kpis' },
          h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, 'Total assets'), money(nw.totalAssets, { className: 'kpi-value' })),
          h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, 'Total liabilities'), money(nw.totalLiabilities, { className: 'kpi-value' })),
          h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, 'Net worth'), money(nw.netWorth, { className: 'kpi-value', colorize: true }))),
        lineChart({ labels, values, ariaLabel: 'Six-month net worth history' }),
      ],
    }),
    card({
      title: 'Monthly net-worth history',
      children: [h('table', { class: 'table' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'Month'),
          h('th', { class: 'r' }, 'Assets'),
          h('th', { class: 'r' }, 'Liabilities'),
          h('th', { class: 'r' }, 'Net worth'),
          h('th', { class: 'r' }, 'Change'))),
        h('tbody', {}, nw.history.map((item) => h('tr', {},
          h('td', {}, monthLongLabel(item.monthKey)),
          h('td', { class: 'r num' }, formatMoney(item.assets)),
          h('td', { class: 'r num' }, formatMoney(item.liabilities)),
          h('td', { class: 'r num' }, formatMoney(item.netWorth)),
          h('td', { class: `r num ${item.change > 0 ? 'pos' : item.change < 0 ? 'neg' : ''}` },
            formatMoney(item.change, { signDisplay: 'always' })))))),
      ],
    }));
}

/* ---------- 7. Budget Performance Report ---------- */
function renderBudgetPerformanceReport(service) {
  const { accounts, entries, budgets } = service.state;
  const currentMonth = monthKeyOf(service.today());
  const monthInput = h('input', { class: 'input', type: 'month', value: currentMonth });
  const host = h('div', { class: 'stack' });

  const refresh = () => {
    const selMonth = monthInput.value || currentMonth;
    const perf = computeBudgetPerformance(budgets, accounts, entries, selMonth);
    host.replaceChildren(
      card({
        title: `Budget vs. actual · ${monthLongLabel(selMonth)}`,
        children: perf.rows.length === 0
          ? [emptyState({
            iconName: 'pie',
            title: 'No budgets configured',
            message: 'Configure monthly category budgets in the Budgets tab to compare budgeted vs. actual spending.',
            action: h('a', { class: 'btn btn-tonal', href: '#/budgets' }, 'Go to Budgets'),
          })]
          : [
            h('table', { class: 'table' },
              h('thead', {}, h('tr', {},
                h('th', {}, 'Category'),
                h('th', { class: 'r' }, 'Budget'),
                h('th', { class: 'r' }, 'Actual'),
                h('th', { class: 'r' }, 'Variance'),
                h('th', { class: 'r' }, 'Used'))),
              h('tbody', {}, perf.rows.map((r) => h('tr', {},
                h('td', {}, r.accountName),
                h('td', { class: 'r num' }, formatMoney(r.limit)),
                h('td', { class: 'r num' }, formatMoney(r.spent)),
                h('td', { class: `r num ${r.remaining < 0 ? 'neg' : 'pos'}` }, formatMoney(r.remaining, { signDisplay: 'always' })),
                h('td', { class: 'r num' }, formatBasisPoints(r.utilizationBp))))),
              h('tfoot', {}, h('tr', {},
                h('th', {}, 'Total budgeted'),
                h('td', { class: 'r num' }, formatMoney(perf.totalLimit)),
                h('td', { class: 'r num' }, formatMoney(perf.totalSpent)),
                h('td', { class: `r num ${perf.totalRemaining < 0 ? 'neg' : 'pos'}` }, formatMoney(perf.totalRemaining, { signDisplay: 'always' })),
                h('td', { class: 'r num' }, formatBasisPoints(perf.utilizationBp))))),
          ],
      }),
    );
  };
  monthInput.addEventListener('change', refresh);
  refresh();

  return h('div', { class: 'stack' },
    card({ children: [field({ label: 'Budget month', control: monthInput })] }),
    host);
}

/* ---------- 8. Debt Repayment Report ---------- */
function renderDebtRepaymentReport(service) {
  const { accounts, entries } = service.state;
  const report = computeDebtReport(accounts, entries, { asOf: service.today() });

  return h('div', { class: 'stack' },
    card({
      title: 'Debt & credit-card summary',
      children: [
        h('div', { class: 'kpis' },
          h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, 'Total charged'), money(report.totalBorrowedOrCharged, { className: 'kpi-value' })),
          h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, 'Total repaid'), money(report.totalPrincipalRepaid, { className: 'kpi-value' })),
          h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, 'Balance owed'), money(report.totalBalance, { className: 'kpi-value neg' }))),
        report.overallPayoffBp != null
          ? progressBar(report.overallPayoffBp, { tone: 'income', label: 'Overall debt repayment progress' })
          : null,
      ],
    }),
    card({
      title: 'Liability accounts breakdown',
      children: report.items.length === 0
        ? [emptyState({ iconName: 'check', title: 'No liability accounts', message: 'Add a Credit Card or Loan account to track debt repayment.' })]
        : [h('table', { class: 'table' },
          h('thead', {}, h('tr', {},
            h('th', {}, 'Account'),
            h('th', { class: 'r' }, 'Borrowed / Charged'),
            h('th', { class: 'r' }, 'Repaid'),
            h('th', { class: 'r' }, 'Balance owed'),
            h('th', { class: 'r' }, 'Payoff %'))),
          h('tbody', {}, report.items.map((i) => h('tr', {},
            h('td', {}, i.account.name),
            h('td', { class: 'r num' }, formatMoney(i.charged)),
            h('td', { class: 'r num pos' }, formatMoney(i.repaid)),
            h('td', { class: 'r num neg' }, formatMoney(i.balance)),
            h('td', { class: 'r num' }, formatBasisPoints(i.payoffBp)))))),
        ],
    }));
}
