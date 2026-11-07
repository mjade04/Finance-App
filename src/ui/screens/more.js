/** "More" hub, Accounts, Chart of accounts, Budgets, and specialized modules. */
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { card, emptyState, listRow, money, openSheet, toast } from '../components.js';
import { balancesByAccount } from '../../domain/ledger.js';
import { NORMAL_BALANCE, SUBTYPE_INFO, TYPE_LABELS } from '../../domain/accounts.js';
import { formatDisplayDate } from '../../domain/dates.js';
import { describeEntry, sortEntriesDesc } from '../entryView.js';
import { openAccountSheet } from '../forms/accountForm.js';
import { openTransactionSheet } from '../forms/transactionForm.js';
import { openEntrySheet } from './transactions.js';
import {
  renderBackupRestore,
  renderBudgets,
  renderCreditCards,
  renderCsvExport,
  renderDebtsAndLoans,
  renderGeneralLedger,
  renderJournalEntries,
  renderRecurringBills,
  renderSavingsGoals,
} from './modules.js';

export { renderBudgets };

export const MODULES = {
  goals: { title: 'Savings goals', icon: 'target', sub: 'Target amounts, dates and progress', render: renderSavingsGoals },
  debts: { title: 'Debts & loans', icon: 'trendDown', sub: 'Loans, borrowing proceeds and principal/interest split', render: renderDebtsAndLoans },
  cards: { title: 'Credit cards', icon: 'card', sub: 'Limits, utilization, statement & bill payments', render: renderCreditCards },
  bills: { title: 'Recurring bills', icon: 'calendar', sub: 'Due dates, reminders and one-tap posting', render: renderRecurringBills },
  journal: { title: 'Journal entries', icon: 'journal', sub: 'Manual multi-line entries and audit trail', render: renderJournalEntries },
  ledger: { title: 'General ledger', icon: 'book', sub: 'All postings per account with running balances', render: renderGeneralLedger },
  export: { title: 'CSV export', icon: 'download', sub: 'Export transactions and financial statements', render: renderCsvExport },
  backup: { title: 'Backup & restore', icon: 'upload', sub: 'Validated JSON backups with duplicate protection', render: renderBackupRestore },
};

export function renderMore() {
  const link = (href, iconName, title, sub) => listRow({
    href,
    iconName,
    tone: 'neutral',
    title,
    subtitle: sub,
    trailing: icon('chevronRight', { size: 18 }),
  });
  const mod = (key) => link(`#/module/${key}`, MODULES[key].icon, MODULES[key].title, MODULES[key].sub);
  return h('div', { class: 'stack' },
    card({ title: 'Money & planning', children: [h('div', { class: 'rows' },
      link('#/accounts', 'wallet', 'Accounts', 'Cash, banks, e-wallets, cards and loans'),
      link('#/budgets', 'pie', 'Budgets', 'Monthly category spending limits and utilization'),
      mod('goals'), mod('debts'), mod('cards'), mod('bills'))] }),
    card({ title: 'Accounting tools', children: [h('div', { class: 'rows' },
      link('#/chart-of-accounts', 'layers', 'Chart of accounts', 'Account codes, types and normal balances'),
      mod('journal'), mod('ledger'),
      link('#/reports', 'chart', 'Financial statements & reports', 'Trial balance, income statement, balance sheet…'))] }),
    card({ title: 'Data & settings', children: [h('div', { class: 'rows' },
      mod('export'), mod('backup'),
      link('#/settings', 'sliders', 'Settings', 'Theme, storage, sample data, privacy'))] }),
    h('p', { class: 'muted tiny center' }, 'MyFinance Pro · Offline-first personal finance & double-entry accounting'));
}

export function renderAccounts({ service }) {
  const { accounts, entries } = service.state;
  const balances = balancesByAccount(accounts, entries, { to: service.today() });
  const groups = [
    { title: 'Cash & e-wallets', subtypes: ['cash', 'ewallet'] },
    { title: 'Bank accounts', subtypes: ['bank'] },
    { title: 'Other assets', subtypes: ['investment', 'receivable', 'other_asset'] },
    { title: 'Credit cards', subtypes: ['credit_card'] },
    { title: 'Loans & payables', subtypes: ['loan', 'payable', 'other_liability'] },
  ];
  const quickActions = h('div', { class: 'empty-actions', style: { marginTop: 0 } },
    h('button', { class: 'btn', type: 'button', onClick: () => openAccountSheet(service) }, icon('plus', { size: 18 }), 'Add account'),
    h('button', { class: 'btn btn-tonal', type: 'button', onClick: () => openTransactionSheet(service, { kind: 'income' }) }, icon('arrowDown', { size: 16 }), 'Income'),
    h('button', { class: 'btn btn-tonal', type: 'button', onClick: () => openTransactionSheet(service, { kind: 'expense' }) }, icon('arrowUp', { size: 16 }), 'Expense'),
    h('button', { class: 'btn btn-tonal', type: 'button', onClick: () => openTransactionSheet(service, { kind: 'transfer' }) }, icon('transfer', { size: 16 }), 'Transfer'));

  const sections = groups.map((g) => {
    const list = accounts.filter((a) => g.subtypes.includes(a.subtype) && a.isActive !== false);
    if (!list.length) return null;
    return card({ title: g.title, children: [h('div', { class: 'rows' }, list.map((a) => listRow({
      iconName: a.icon, tone: a.type === 'liability' ? 'expense' : 'transfer', title: a.name,
      subtitle: `${a.code} · ${SUBTYPE_INFO[a.subtype].label}${a.type === 'liability' ? ' · owed' : ''}`,
      trailing: money(balances.get(a.id) ?? 0),
      onClick: () => openAccountDetailSheet(service, a.id),
    })))] });
  });
  return h('div', { class: 'stack' },
    h('p', { class: 'muted small' }, 'Balances are calculated live from posted journal entries. Tap any account to inspect its activity or record an income, expense, or transfer.'),
    quickActions, ...sections);
}

export function openAccountDetailSheet(service, accountId) {
  openSheet({
    title: 'Account activity',
    build(close) {
      const { accounts, entries, accountsById } = service.state;
      const account = accountsById.get(accountId);
      if (!account) return emptyState({ title: 'Account not found' });
      const balances = balancesByAccount(accounts, entries, { to: service.today() });
      const balance = balances.get(account.id) ?? 0;
      const relatedEntries = sortEntriesDesc(
        entries.filter((e) => e.lines.some((l) => l.accountId === account.id)),
      ).slice(0, 12);

      return h('div', { class: 'stack-sm' },
        h('div', { class: 'detail-head' },
          h('span', { class: `avatar avatar-lg tone-bg-${account.type === 'liability' ? 'expense' : 'transfer'}` }, icon(account.icon, { size: 24 })),
          h('div', {},
            h('p', { class: 'detail-title' }, account.name),
            h('p', { class: 'muted small' }, `${account.code} · ${SUBTYPE_INFO[account.subtype]?.label ?? account.type} · Normal ${NORMAL_BALANCE[account.type]}`)),
          h('p', { class: 'detail-amount' }, money(balance))),
        h('div', { class: 'empty-actions', style: { justifyContent: 'flex-start' } },
          account.type === 'asset'
            ? h('button', {
              class: 'btn btn-tonal',
              type: 'button',
              onClick: () => { close(); openTransactionSheet(service, { kind: 'income', defaultAccountId: account.id }); },
            }, '+ Income')
            : null,
          h('button', {
            class: 'btn btn-tonal',
            type: 'button',
            onClick: () => { close(); openTransactionSheet(service, { kind: 'expense', defaultAccountId: account.id }); },
          }, '+ Expense'),
          h('button', {
            class: 'btn btn-tonal',
            type: 'button',
            onClick: () => { close(); openTransactionSheet(service, { kind: 'transfer', defaultAccountId: account.id }); },
          }, '⇄ Transfer')),
        h('h3', { class: 'section-label' }, `Recent postings (${relatedEntries.length})`),
        relatedEntries.length === 0
          ? emptyState({ iconName: 'list', title: 'No transactions on this account yet' })
          : h('div', { class: 'rows' }, relatedEntries.map((e) => {
            const v = describeEntry(e, accountsById);
            return listRow({
              iconName: v.icon,
              tone: v.tone,
              title: v.title,
              subtitle: `${formatDisplayDate(e.date)}${e.reversedById ? ' · reversed' : ''}`,
              trailing: money(v.amount),
              onClick: () => { close(); openEntrySheet(service, e.id); },
            });
          })));
    },
  });
}

export function renderChartOfAccounts({ service }) {
  const { accounts } = service.state;
  const addBtn = h('button', {
    class: 'btn btn-block',
    type: 'button',
    onClick: () => openAccountSheet(service, { subtype: 'expense', allowCategories: true }),
  }, icon('plus', { size: 18 }), 'Add account or category');

  return h('div', { class: 'stack' },
    h('p', { class: 'muted small' }, 'Codes: 1xxx assets · 2xxx liabilities · 3xxx equity · 4xxx income · 5xxx expenses.'),
    addBtn,
    ...Object.keys(TYPE_LABELS).map((type) => card({
      title: `${TYPE_LABELS[type]} · normal ${NORMAL_BALANCE[type]}`,
      children: [h('div', { class: 'rows' }, accounts.filter((a) => a.type === type).map((a) => listRow({
        iconName: a.icon,
        tone: a.isActive === false ? 'neutral' : 'primary',
        title: `${a.name}${a.isActive === false ? ' (archived)' : ''}`,
        subtitle: `${a.code} · ${SUBTYPE_INFO[a.subtype]?.label ?? a.type}`,
        trailing: a.isSystem
          ? h('span', { class: 'badge badge-muted' }, 'System')
          : h('button', {
            class: 'btn-text',
            type: 'button',
            onClick: async () => {
              const updated = await service.toggleAccountActive(a.id);
              toast(updated.isActive ? `${a.name} restored` : `${a.name} archived`);
            },
          }, a.isActive === false ? 'Restore' : 'Archive'),
      })))],
    })));
}

export function renderModule({ service, params }) {
  const m = MODULES[params.key];
  if (!m || !m.render) {
    return card({ children: [emptyState({ iconName: 'alert', title: 'Unknown module' })] });
  }
  return m.render({ service, params });
}

export function moduleTitle(key) {
  return MODULES[key]?.title ?? 'Module';
}
