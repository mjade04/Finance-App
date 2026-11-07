/** Dashboard screen — every figure comes from computeDashboard() over saved records. */
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { card, emptyState, listRow, money, progressBar, textButton, toast } from '../components.js';
import { barChart, chartLegend, donutChart, lineChart, savingsChart } from '../charts.js';
import { computeDashboard } from '../../domain/dashboard.js';
import { formatBasisPoints, formatMoney } from '../../domain/money.js';
import { formatDisplayDate, monthLongLabel, monthShortLabel } from '../../domain/dates.js';
import { describeEntry } from '../entryView.js';
import { openTransactionSheet } from '../forms/transactionForm.js';
import { openEntrySheet } from './transactions.js';

const TONES = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];

export function renderDashboard({ service }) {
  const { accounts, entries, budgets, goals, bills, accountsById } = service.state;
  const d = computeDashboard({
    accounts,
    entries,
    budgets,
    goals,
    bills,
    today: service.today(),
  });
  const labels = d.trend.map((t) => monthShortLabel(t.key));

  const hero = h('section', { class: 'hero', 'aria-label': 'Net worth summary' },
    h('div', { class: 'hero-top' },
      h('span', { class: 'hero-label' }, 'Net worth'),
      h('span', { class: `health-chip ${d.health.trialBalanced && d.health.equationBalanced ? 'ok' : 'bad'}` },
        icon(d.health.trialBalanced && d.health.equationBalanced ? 'check' : 'alert', { size: 14 }),
        d.health.trialBalanced && d.health.equationBalanced ? 'Books balanced' : 'Ledger imbalance')),
    h('p', { class: 'hero-value num' }, formatMoney(d.netWorth)),
    h('div', { class: 'hero-split' },
      h('div', {}, h('span', { class: 'hero-sub' }, 'Total assets'), h('span', { class: 'num hero-num' }, formatMoney(d.totalAssets))),
      h('div', {}, h('span', { class: 'hero-sub' }, 'Total liabilities'), h('span', { class: 'num hero-num' }, formatMoney(d.totalLiabilities)))));

  const tile = (label, value, iconName, tone) => h('a', { class: 'tile', href: '#/accounts' },
    h('span', { class: `tile-icon tone-bg-${tone}` }, icon(iconName, { size: 18 })),
    h('span', { class: 'tile-label' }, label),
    money(value, { className: 'tile-value' }));

  const liquid = h('div', { class: 'tiles' },
    tile('Available cash', d.liquid.cash, 'cash', 'income'),
    tile('Bank balances', d.liquid.bank, 'bank', 'transfer'),
    tile('E-wallet balances', d.liquid.ewallet, 'phone', 'c4'));

  const monthCard = card({
    title: monthLongLabel(d.month.key),
    children: [h('div', { class: 'kpis' },
      kpi('Monthly income', d.month.income, 'income', 'arrowDown'),
      kpi('Monthly expenses', d.month.expenses, 'expense', 'arrowUp'),
      kpi('Net cash flow', d.month.netCashFlow, d.month.netCashFlow >= 0 ? 'income' : 'expense', 'transfer', true)),
    h('p', { class: 'muted small' }, 'Total liquid funds (cash + banks + e-wallets): ', money(d.liquid.total)),
    h('p', { class: 'muted small' }, 'Net income this month (income − expenses): ', money(d.month.netIncome, { colorize: true }))],
  });

  // Budget utilization card
  const bu = d.budgetUtilization;
  const budgetCard = card({
    title: 'Budget utilization',
    action: textButton('Budgets', () => { location.hash = '#/budgets'; }, { iconName: 'chevronRight' }),
    children: bu.rows.length === 0
      ? [emptyState({
        iconName: 'pie',
        title: 'No monthly budgets set',
        message: 'Set monthly spending limits per expense category to monitor utilization.',
        action: h('a', { class: 'btn btn-tonal', href: '#/budgets' }, 'Set budgets'),
      })]
      : [
        h('div', { class: 'row-between' },
          h('span', { class: 'muted small' }, `${formatMoney(bu.totalSpent)} spent of ${formatMoney(bu.totalLimit)}`),
          h('span', { class: 'num strong' }, formatBasisPoints(bu.utilizationBp))),
        progressBar(bu.utilizationBp ?? 0, {
          tone: (bu.utilizationBp ?? 0) >= 10000 ? 'expense' : (bu.utilizationBp ?? 0) >= 8000 ? 'c3' : 'primary',
          label: 'Overall budget utilization',
        }),
        h('div', { class: 'rows', style: { marginTop: '8px' } }, bu.rows.slice(0, 4).map((r) => listRow({
          iconName: r.icon,
          tone: r.status === 'over' ? 'expense' : 'neutral',
          title: r.accountName,
          subtitle: `${formatMoney(r.spent)} of ${formatMoney(r.limit)} (${formatBasisPoints(r.utilizationBp)})`,
          trailing: money(r.remaining, { colorize: true }),
          href: '#/budgets',
        }))),
      ],
  });

  // Savings progress card & chart
  const sp = d.savingsProgress;
  const savingsCard = card({
    title: 'Savings progress',
    action: textButton('Goals', () => { location.hash = '#/module/goals'; }, { iconName: 'chevronRight' }),
    children: sp.items.length === 0
      ? [emptyState({
        iconName: 'target',
        title: 'No savings goals yet',
        message: 'Create a savings goal with a target amount and date to track your progress.',
        action: h('a', { class: 'btn btn-tonal', href: '#/module/goals' }, 'Create goal'),
      })]
      : [
        h('div', { class: 'row-between', style: { marginBottom: '6px' } },
          h('span', { class: 'muted small' }, `${formatMoney(sp.totalSaved)} saved of ${formatMoney(sp.totalTarget)}`),
          h('span', { class: 'num strong' }, formatBasisPoints(sp.progressBp))),
        savingsChart({ items: sp.items, ariaLabel: 'Savings goals progress' }),
      ],
  });

  // Outstanding debts card
  const debt = d.outstandingDebt;
  const debtCard = card({
    title: 'Outstanding debts',
    action: textButton('Debts & cards', () => { location.hash = '#/module/debts'; }, { iconName: 'chevronRight' }),
    children: debt.total === 0
      ? [emptyState({ iconName: 'check', title: 'No outstanding debts', message: 'Credit-card and loan balances will appear here.' })]
      : [h('p', { class: 'big-num num neg' }, formatMoney(debt.total)),
        h('div', { class: 'rows' },
          listRow({ iconName: 'card', tone: 'expense', title: 'Credit cards', trailing: money(debt.creditCards), href: '#/module/cards' }),
          listRow({ iconName: 'trendDown', tone: 'expense', title: 'Loans', trailing: money(debt.loans), href: '#/module/debts' }),
          debt.other ? listRow({ iconName: 'receipt', tone: 'expense', title: 'Other liabilities', trailing: money(debt.other), href: '#/accounts' }) : null)],
  });

  // Upcoming bills card
  const ub = d.upcomingBills;
  const billsCard = card({
    title: 'Upcoming bills',
    action: textButton('Bills', () => { location.hash = '#/module/bills'; }, { iconName: 'chevronRight' }),
    children: ub.items.length === 0
      ? [emptyState({
        iconName: 'calendar',
        title: 'No recurring bills scheduled',
        message: 'Add monthly or quarterly bills to track due dates and post payments in one tap.',
        action: h('a', { class: 'btn btn-tonal', href: '#/module/bills' }, 'Add recurring bill'),
      })]
      : [
        h('p', { class: 'muted small' },
          `${ub.items.length} active · ${ub.overdueCount ? `${ub.overdueCount} overdue · ` : ''}Total scheduled: `,
          money(ub.totalUpcomingAmount)),
        h('div', { class: 'rows' }, ub.items.slice(0, 4).map((b) => listRow({
          iconName: b.icon,
          tone: b.status === 'overdue' ? 'expense' : b.status === 'due_soon' ? 'c4' : 'neutral',
          title: b.name,
          subtitle: `Due ${formatDisplayDate(b.nextDueDate)} (${b.daysUntilDue < 0 ? `${Math.abs(b.daysUntilDue)}d overdue` : b.daysUntilDue === 0 ? 'Due today' : `in ${b.daysUntilDue}d`})`,
          trailing: money(b.amount),
          href: '#/module/bills',
        }))),
      ],
  });

  if (!d.hasEntries && sp.items.length === 0 && bu.rows.length === 0 && ub.items.length === 0) {
    return h('div', { class: 'stack' }, hero, liquid,
      card({ children: [emptyState({
        iconName: 'wallet',
        title: 'Welcome to MyFinance Pro',
        message: 'Start by setting the opening balances of your cash, bank and e-wallet accounts, then record your first income or expense. Everything is stored only on this device.',
        action: h('div', { class: 'empty-actions' },
          h('a', { class: 'btn btn-tonal', href: '#/accounts' }, 'Set up accounts'),
          h('button', { class: 'btn btn-tonal', type: 'button', onClick: async (ev) => {
            ev.currentTarget.disabled = true;
            await service.seedSampleData();
            toast('Sample PHP ledger loaded', { tone: 'success' });
          } }, 'Load sample PHP data'),
          h('button', { class: 'btn', type: 'button', onClick: () => openTransactionSheet(service) }, 'Add transaction')),
      })] }),
      monthCard, budgetCard, savingsCard, debtCard, billsCard);
  }

  const cashFlowSeries = [
    { name: 'Cash in', values: d.trend.map((t) => t.cashIn), tone: 'income' },
    { name: 'Cash out', values: d.trend.map((t) => t.cashOut), tone: 'expense' },
  ];
  const ivSeries = [
    { name: 'Income', values: d.trend.map((t) => t.income), tone: 'primary' },
    { name: 'Expenses', values: d.trend.map((t) => t.expenses), tone: 'c3' },
  ];

  const top = d.month.byCategory.slice(0, 5);
  const restTotal = d.month.byCategory.slice(5).reduce((t, c) => t + c.amount, 0);
  const donutItems = top.map((c, i) => ({ label: c.name, value: c.amount, tone: TONES[i] }));
  if (restTotal > 0) donutItems.push({ label: 'Others', value: restTotal, tone: TONES[5] });

  const recent = card({
    title: 'Recent transactions',
    action: textButton('See all', () => { location.hash = '#/transactions'; }, { iconName: 'chevronRight' }),
    children: d.recent.length
      ? [h('div', { class: 'rows' }, d.recent.map((e) => {
        const v = describeEntry(e, accountsById);
        return listRow({
          iconName: v.icon, tone: v.tone, title: v.title,
          subtitle: `${formatDisplayDate(e.date)}${e.reversedById ? ' · reversed' : ''}`,
          trailing: amountText(v),
          onClick: () => openEntrySheet(service, e.id),
        });
      }))]
      : [emptyState({ iconName: 'list', title: 'No transactions yet' })],
  });

  return h('div', { class: 'stack' },
    hero,
    liquid,
    monthCard,
    card({ title: 'Monthly cash flow', children: [chartLegend(cashFlowSeries),
      barChart({ labels, series: cashFlowSeries, ariaLabel: 'Cash in and cash out over the last six months' })] }),
    card({ title: 'Income vs expenses', children: [chartLegend(ivSeries),
      barChart({ labels, series: ivSeries, ariaLabel: 'Income versus expenses over the last six months' })] }),
    card({ title: 'Spending by category', children: [donutItems.length
      ? donutChart({ items: donutItems, ariaLabel: 'Spending by category this month', centerLabel: 'Spent', centerValue: compactPeso(d.month.expenses) })
      : emptyState({ iconName: 'pie', title: 'No spending this month', message: 'Expenses you record will be grouped by category here.' })] }),
    card({ title: 'Net-worth trend', children: [lineChart({ labels, values: d.trend.map((t) => t.netWorth), ariaLabel: 'Net worth at each month end' })] }),
    budgetCard,
    savingsCard,
    debtCard,
    billsCard,
    recent);
}

function kpi(label, value, tone, iconName, signed = false) {
  return h('div', { class: 'kpi' },
    h('span', { class: `kpi-icon tone-bg-${tone}` }, icon(iconName, { size: 16 })),
    h('span', { class: 'kpi-label' }, label),
    money(value, { className: 'kpi-value', sign: signed && value > 0 }));
}

function amountText(v) {
  if (v.direction === 'in') return h('span', { class: 'num pos' }, `+${formatMoney(v.amount)}`);
  if (v.direction === 'out') return h('span', { class: 'num neg' }, `-${formatMoney(v.amount)}`);
  return h('span', { class: 'num' }, formatMoney(v.amount));
}

function compactPeso(value) {
  const text = formatMoney(value);
  return text.length > 11 ? `${text.slice(0, text.indexOf('.'))}` : text;
}

export { amountText };
