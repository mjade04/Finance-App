/** Presentation mapping for journal entries (pure; no DOM). */
import { entryTotals, ENTRY_KIND_LABELS } from '../domain/journal.js';

/**
 * @returns {{title: string, subtitle: string, amount: number, direction: 'in'|'out'|'neutral', icon: string, tone: string}}
 */
export function describeEntry(entry, accountsById) {
  const { debit: amount } = entryTotals(entry);
  const debitAcc = accountsById.get(entry.lines.find((l) => l.debit > 0)?.accountId);
  const creditAcc = accountsById.get(entry.lines.find((l) => l.credit > 0)?.accountId);
  const name = (a) => a?.name ?? 'Unknown account';
  switch (entry.kind) {
    case 'income':
      return { title: entry.description, subtitle: `${name(creditAcc)} → ${name(debitAcc)}`, amount, direction: 'in', icon: creditAcc?.icon ?? 'arrowDown', tone: 'income' };
    case 'expense':
      return { title: entry.description, subtitle: `${name(debitAcc)} · paid from ${name(creditAcc)}`, amount, direction: 'out', icon: debitAcc?.icon ?? 'arrowUp', tone: 'expense' };
    case 'transfer':
      return { title: entry.description, subtitle: `${name(creditAcc)} → ${name(debitAcc)}`, amount, direction: 'neutral', icon: 'transfer', tone: 'transfer' };
    case 'reversal':
      return { title: entry.description, subtitle: 'Reversal entry', amount, direction: 'neutral', icon: 'undo', tone: 'neutral' };
    default:
      return { title: entry.description, subtitle: ENTRY_KIND_LABELS[entry.kind] ?? 'Journal entry', amount, direction: 'neutral', icon: 'journal', tone: 'neutral' };
  }
}

export function sortEntriesDesc(entries) {
  return [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}
