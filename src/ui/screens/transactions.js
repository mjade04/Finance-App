/** Transactions screen: searchable history + entry detail with journal lines and reversal. */
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { card, confirmDialog, emptyState, listRow, money, openSheet, toast } from '../components.js';
import { formatMoney } from '../../domain/money.js';
import { formatDisplayDate } from '../../domain/dates.js';
import { entryTotals, ENTRY_KIND_LABELS } from '../../domain/journal.js';
import { describeEntry, sortEntriesDesc } from '../entryView.js';
import { openTransactionSheet } from '../forms/transactionForm.js';

const ui = { query: '', filter: 'all' };

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expenses' },
  { value: 'transfer', label: 'Transfers' },
  { value: 'other', label: 'Other' },
];

function matches(entry, view, accountsById, query) {
  if (ui.filter !== 'all') {
    if (ui.filter === 'other' ? ['income', 'expense', 'transfer'].includes(entry.kind) : entry.kind !== ui.filter) return false;
  }
  if (!query) return true;
  const haystack = [
    entry.description, entry.note, entry.date, view.subtitle, formatMoney(view.amount),
    ...entry.lines.map((l) => accountsById.get(l.accountId)?.name ?? ''),
  ].join(' ').toLowerCase();
  return haystack.includes(query);
}

export function renderTransactions({ service }) {
  const { entries, accountsById } = service.state;
  const listHost = h('div', { class: 'tx-list' });

  const renderList = () => {
    const q = ui.query.trim().toLowerCase();
    const items = sortEntriesDesc(entries)
      .map((e) => ({ e, v: describeEntry(e, accountsById) }))
      .filter(({ e, v }) => matches(e, v, accountsById, q));
    if (!entries.length) {
      listHost.replaceChildren(card({ children: [emptyState({
        iconName: 'list', title: 'No transactions yet',
        message: 'Income, expenses and transfers you record will appear here with their journal entries.',
        action: h('button', { class: 'btn', type: 'button', onClick: () => openTransactionSheet(service) }, 'Add transaction'),
      })] }));
      return;
    }
    if (!items.length) {
      listHost.replaceChildren(card({ children: [emptyState({ iconName: 'search', title: 'No matches', message: 'Try a different search term or filter.' })] }));
      return;
    }
    const groups = new Map();
    for (const item of items) {
      if (!groups.has(item.e.date)) groups.set(item.e.date, []);
      groups.get(item.e.date).push(item);
    }
    listHost.replaceChildren(...[...groups].map(([date, group]) => h('section', { class: 'tx-group' },
      h('h3', { class: 'tx-date' }, formatDisplayDate(date)),
      h('div', { class: 'card rows' }, group.map(({ e, v }) => listRow({
        iconName: v.icon, tone: v.tone, title: v.title,
        subtitle: `${v.subtitle}${e.reversedById ? ' · reversed' : ''}`,
        trailing: h('span', { class: e.reversedById ? 'struck' : '' }, signed(v)),
        onClick: () => openEntrySheet(service, e.id),
      }))))));
  };

  const search = h('input', {
    class: 'input search-input', type: 'search', placeholder: 'Search description, account, amount, date',
    'aria-label': 'Search transactions', value: ui.query,
    onInput: (e) => { ui.query = e.target.value; renderList(); },
  });

  const chips = h('div', { class: 'chips', role: 'tablist', 'aria-label': 'Filter transactions' });
  const renderChips = () => chips.replaceChildren(...FILTERS.map((f) => h('button', {
    type: 'button', role: 'tab', class: ui.filter === f.value ? 'chip active' : 'chip', 'aria-selected': String(ui.filter === f.value),
    onClick: () => { ui.filter = f.value; renderChips(); renderList(); },
  }, f.label)));
  renderChips();
  renderList();

  return h('div', { class: 'stack' },
    h('div', { class: 'search-wrap' }, icon('search', { size: 20 }), search),
    chips,
    listHost);
}

function signed(v) {
  if (v.direction === 'in') return h('span', { class: 'num pos' }, `+${formatMoney(v.amount)}`);
  if (v.direction === 'out') return h('span', { class: 'num neg' }, `-${formatMoney(v.amount)}`);
  return h('span', { class: 'num' }, formatMoney(v.amount));
}

/** Detail sheet showing the double-entry lines of a posted entry. */
export function openEntrySheet(service, entryId) {
  openSheet({
    title: 'Transaction details',
    build(close) {
      const { entries, accountsById } = service.state;
      const entry = entries.find((e) => e.id === entryId);
      if (!entry) return emptyState({ title: 'Entry not found' });
      const v = describeEntry(entry, accountsById);
      const totals = entryTotals(entry);
      const related = entries.find((e) => e.id === (entry.reversedById ?? entry.reversesId));

      const table = h('table', { class: 'table' },
        h('caption', { class: 'sr-only' }, 'Journal entry lines'),
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Account'), h('th', { scope: 'col', class: 'r' }, 'Debit'), h('th', { scope: 'col', class: 'r' }, 'Credit'))),
        h('tbody', {}, entry.lines.map((l) => {
          const acc = accountsById.get(l.accountId);
          return h('tr', {},
            h('td', {}, h('span', { class: 'code' }, acc?.code ?? '—'), ' ', acc?.name ?? 'Unknown account'),
            h('td', { class: 'r num' }, l.debit ? formatMoney(l.debit) : ''),
            h('td', { class: 'r num' }, l.credit ? formatMoney(l.credit) : ''));
        })),
        h('tfoot', {}, h('tr', {}, h('th', { scope: 'row' }, 'Total'),
          h('td', { class: 'r num' }, formatMoney(totals.debit)), h('td', { class: 'r num' }, formatMoney(totals.credit)))));

      const canReverse = !entry.reversedById && entry.kind !== 'reversal';
      const reverseBtn = canReverse ? h('button', {
        class: 'btn btn-danger-tonal btn-block', type: 'button',
        onClick: async () => {
          const ok = await confirmDialog({
            title: 'Reverse this transaction?',
            message: `A reversing journal entry of ${formatMoney(totals.debit)} will be posted. The original stays in your history for audit purposes.`,
            confirmLabel: 'Reverse', danger: true,
          });
          if (!ok) return;
          try {
            await service.reverse(entry.id);
            close();
            toast('Transaction reversed', { tone: 'success' });
          } catch (err) {
            toast(err.message, { tone: 'error' });
          }
        },
      }, icon('undo', { size: 18 }), 'Reverse transaction') : null;

      return h('div', { class: 'stack-sm' },
        h('div', { class: 'detail-head' },
          h('span', { class: `avatar avatar-lg tone-bg-${v.tone}` }, icon(v.icon, { size: 24 })),
          h('div', {},
            h('p', { class: 'detail-title' }, entry.description),
            h('p', { class: 'muted small' }, `${ENTRY_KIND_LABELS[entry.kind]} · ${formatDisplayDate(entry.date)}`)),
          h('p', { class: 'detail-amount' }, money(totals.debit))),
        entry.note ? h('p', { class: 'muted' }, entry.note) : null,
        h('h3', { class: 'section-label' }, 'Journal entry (double-entry)'),
        table,
        h('p', { class: 'muted small' }, totals.debit === totals.credit ? '✓ Debits equal credits.' : '⚠ Entry is unbalanced.'),
        related ? h('p', { class: 'notice' }, icon('info', { size: 16 }),
          entry.reversedById ? `Reversed on ${formatDisplayDate(related.date)}.` : `Reverses “${related.description.replace(/^Reversal: /, '')}”.`) : null,
        h('p', { class: 'muted tiny' }, `Recorded ${new Date(entry.createdAt).toLocaleString()} · ID ${entry.id.slice(0, 8)}`),
        reverseBtn);
    },
  });
}
