/**
 * Stage 8 tests: Defect regression tests, boundary conditions, date clamping,
 * archived-account reversal safety, duplicate-vs-same-day restore handling,
 * CSV formula-injection sanitization, and full sample-data integrity verification.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRepository } from '../src/data/repository.js';
import { FinanceService } from '../src/services/financeService.js';
import { verifyLedgerIntegrity } from '../src/domain/ledger.js';
import { advanceBillDueDate } from '../src/domain/planning.js';
import { computeDashboard } from '../src/domain/dashboard.js';
import { exportTransactionsCsv } from '../src/domain/backup.js';

function createServiceAt(isoDate = '2026-11-01') {
  let seq = 1;
  return new FinanceService(new MemoryRepository(), {
    clock: () => new Date(`${isoDate}T08:00:00Z`),
    newId: () => `s8-${seq++}`,
  });
}

test('Stage 8: reversing a historical transaction succeeds even after its custom account is archived, while new postings to archived accounts are blocked', async () => {
  const svc = createServiceAt('2026-11-10');
  await svc.init();

  // Create custom expense category, post an expense, then archive the category
  const customExp = await svc.createAccount({ name: 'Pet Care', subtype: 'expense' });
  const entry = await svc.recordExpense({
    date: '2026-11-05',
    amount: 150_000,
    expenseAccountId: customExp.id,
    paymentAccountId: 'acc-1000',
    description: 'Vet checkup',
  });

  // System accounts (Opening Balance Equity acc-3000) cannot be archived
  await assert.rejects(() => svc.toggleAccountActive('acc-3000'), /System accounts cannot be archived/);

  // Archive custom category
  const archived = await svc.toggleAccountActive(customExp.id);
  assert.equal(archived.isActive, false);

  // New expense to archived category is rejected
  await assert.rejects(() => svc.recordExpense({
    date: '2026-11-06',
    amount: 50_000,
    expenseAccountId: customExp.id,
    paymentAccountId: 'acc-1000',
  }), /archived/i);

  // Historical entry on the archived account can still be reversed cleanly
  const rev = await svc.reverse(entry.id, { date: '2026-11-07' });
  assert.equal(rev.kind, 'reversal');
  assert.equal(rev.reversesId, entry.id);

  const check = verifyLedgerIntegrity(svc.state.accounts, svc.state.entries);
  assert.equal(check.ok, true);
});

test('Stage 8: two legitimate same-day identical transactions with distinct IDs are preserved on replace-restore, while merge-restore skips existing duplicates', async () => {
  const svc1 = createServiceAt('2026-11-10');
  await svc1.init();

  // User takes two ₱15.00 jeepney rides on the same day with identical description
  await svc1.recordExpense({
    date: '2026-11-05',
    amount: 1_500,
    expenseAccountId: 'acc-5100',
    paymentAccountId: 'acc-1000',
    description: 'Jeepney fare',
  });
  await svc1.recordExpense({
    date: '2026-11-05',
    amount: 1_500,
    expenseAccountId: 'acc-5100',
    paymentAccountId: 'acc-1000',
    description: 'Jeepney fare',
  });
  assert.equal(svc1.state.entries.length, 2);

  const backup = svc1.exportBackup();

  // Restore in replace mode into a fresh service: both distinct entries must be preserved!
  const svc2 = createServiceAt('2026-11-10');
  await svc2.init();
  const replaceSummary = await svc2.importBackup(backup, { mode: 'replace' });
  assert.equal(replaceSummary.entriesAdded, 2);
  assert.equal(svc2.state.entries.length, 2);

  // Subsequent merge import of the same backup skips both as duplicates
  const mergeSummary = await svc2.importBackup(backup, { mode: 'merge' });
  assert.equal(mergeSummary.entriesAdded, 0);
  assert.equal(mergeSummary.entriesSkippedDuplicate, 2);
});

test('Stage 8: seedSampleData on the 1st of the month clamps transaction dates <= today and passes full ledger & dashboard integrity', async () => {
  const svc = createServiceAt('2026-11-01');
  await svc.init();
  await svc.seedSampleData();

  const integrity = verifyLedgerIntegrity(svc.state.accounts, svc.state.entries, { asOf: '2026-11-01' });
  assert.equal(integrity.ok, true);
  assert.equal(integrity.entryCount, 10);

  const dash = computeDashboard({ ...svc.state, today: '2026-11-01' });
  assert.equal(dash.health.trialBalanced, true);
  assert.equal(dash.health.equationBalanced, true);
  assert.ok(dash.liquid.total > 0, 'Sample liquid balances are immediately visible even on the 1st of the month');
  assert.equal(dash.month.income, 3_000_000); // ₱30,000 salary (loan proceeds excluded!)
});

test('Stage 8: advanceBillDueDate handles weekly, monthly, quarterly, yearly, and month-end/leap-year clamping', () => {
  assert.equal(advanceBillDueDate('2026-11-06', 'weekly'), '2026-11-13');
  assert.equal(advanceBillDueDate('2026-01-31', 'monthly'), '2026-02-28');
  assert.equal(advanceBillDueDate('2028-01-31', 'monthly'), '2028-02-29'); // 2028 is a leap year
  assert.equal(advanceBillDueDate('2026-11-30', 'quarterly'), '2027-02-28');
  assert.equal(advanceBillDueDate('2028-02-29', 'yearly'), '2029-02-28');
});

test('Stage 8: credit card payment with optional finance charge splits liability settlement and interest expense, and CSV export guards against formula injection', async () => {
  const svc = createServiceAt('2026-11-15');
  await svc.init();
  const card = await svc.createAccount({ name: 'Metrobank Card', subtype: 'credit_card' });

  // Charge ₱5,000 on card
  await svc.recordExpense({
    date: '2026-11-03',
    amount: 500_000,
    expenseAccountId: 'acc-5000',
    paymentAccountId: card.id,
    description: '=CMD|\' /C calc\'!A0 Malicious Merchant',
  });

  // Settle ₱5,000 statement + ₱150 finance charge
  await svc.recordCreditCardPayment({
    date: '2026-11-14',
    cardAccountId: card.id,
    paymentAccountId: 'acc-1100',
    amount: 500_000,
    interestAmount: 15_000,
    interestAccountId: 'acc-5800',
    description: 'Full card settlement with finance charge',
  });

  const dash = computeDashboard({ ...svc.state, today: '2026-11-15' });
  // Total expenses = ₱5,000 purchase + ₱150 finance charge = ₱5,150 (principal ₱5,000 is NOT double-counted)
  assert.equal(dash.month.expenses, 515_000);
  assert.equal(dash.outstandingDebt.creditCards, 0);

  // Verify CSV formula injection is neutralized with leading apostrophe
  const csv = exportTransactionsCsv(svc.state.entries, svc.state.accountsById);
  assert.match(csv, /'=CMD\|/);
});
