import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRepository } from '../src/data/repository.js';
import { FinanceService } from '../src/services/financeService.js';
import {
  balanceSheet,
  cashFlowStatement,
  generalLedger,
  incomeStatement,
  netWorthReport,
  trialBalance,
  accountingEquation,
} from '../src/domain/reports.js';
import { computeBudgetPerformance, computeDebtReport } from '../src/domain/planning.js';
import {
  decryptBackupPayload,
  encryptBackupPayload,
  exportBalanceSheetCsv,
  exportIncomeStatementCsv,
  exportTransactionsCsv,
  exportTrialBalanceCsv,
} from '../src/domain/backup.js';
import { computeDashboard } from '../src/domain/dashboard.js';
import { creditLine, debitLine } from '../src/domain/journal.js';

function createTestService(todayStr = '2026-11-15') {
  let seq = 1;
  return new FinanceService(new MemoryRepository(), {
    clock: () => new Date(`${todayStr}T09:00:00Z`),
    newId: () => `id-${seq++}`,
  });
}

test('Stage 5: budgets track expense categories only and ignore transfers/card settlements', async () => {
  const svc = createTestService('2026-11-15');
  await svc.init();

  // Set Food budget of ₱5,000.00 (500_000 centavos)
  await svc.setBudget({ accountId: 'acc-5000', amount: 500_000 });

  // Salary ₱30,000 -> Bank
  await svc.recordIncome({
    date: '2026-11-01',
    amount: 3_000_000,
    incomeAccountId: 'acc-4000',
    depositAccountId: 'acc-1100',
    description: 'Monthly salary',
  });

  // Food expense ₱4,200 -> 84% utilization ('warn')
  await svc.recordExpense({
    date: '2026-11-05',
    amount: 420_000,
    expenseAccountId: 'acc-5000',
    paymentAccountId: 'acc-1100',
    description: 'Supermarket groceries',
  });

  // Internal transfer ₱5,000 Bank -> GCash (must not affect budget)
  await svc.recordTransfer({
    date: '2026-11-06',
    amount: 500_000,
    fromAccountId: 'acc-1100',
    toAccountId: 'acc-1200',
  });

  const perf = computeBudgetPerformance(svc.state.budgets, svc.state.accounts, svc.state.entries, '2026-11');
  assert.equal(perf.totalLimit, 500_000);
  assert.equal(perf.totalSpent, 420_000);
  assert.equal(perf.totalRemaining, 80_000);
  assert.equal(perf.utilizationBp, 8400);
  assert.equal(perf.rows[0].status, 'warn');
});

test('Stage 5: borrowed loan proceeds are never income; loan repayment splits principal and interest; card payment is never a second expense', async () => {
  const svc = createTestService('2026-11-15');
  await svc.init();

  const loanAcc = await svc.createAccount({ name: 'Personal Loan', subtype: 'loan' });
  const cardAcc = await svc.createAccount({ name: 'BPI Credit Card', subtype: 'credit_card', creditLimit: 5_000_000 });

  // 1. Borrow ₱20,000 into Bank Account
  await svc.recordLoanProceeds({
    date: '2026-11-02',
    loanAccountId: loanAcc.id,
    depositAccountId: 'acc-1100',
    amount: 2_000_000,
    description: 'Personal loan disbursement',
  });

  // 2. Repay ₱5,000 principal + ₱500 interest from Bank Account
  await svc.recordLoanPayment({
    date: '2026-11-10',
    loanAccountId: loanAcc.id,
    paymentAccountId: 'acc-1100',
    interestAccountId: 'acc-5800',
    principalAmount: 500_000,
    interestAmount: 50_000,
    description: 'First installment',
  });

  // 3. Purchase groceries ₱2,000 on Credit Card (counts as expense once)
  await svc.recordExpense({
    date: '2026-11-11',
    expenseAccountId: 'acc-5000',
    paymentAccountId: cardAcc.id,
    amount: 200_000,
    description: 'Groceries on card',
  });

  // 4. Pay Credit Card bill ₱2,000 from Bank Account (never a second expense!)
  await svc.recordCreditCardPayment({
    date: '2026-11-14',
    cardAccountId: cardAcc.id,
    paymentAccountId: 'acc-1100',
    amount: 200_000,
    description: 'Settle BPI card statement',
  });

  const is = incomeStatement(svc.state.accounts, svc.state.entries, { from: '2026-11-01', to: '2026-11-30' });
  // Borrowed ₱20,000 must NOT count as income -> totalIncome = 0
  assert.equal(is.totalIncome, 0);
  // Total expenses = ₱2,000 groceries + ₱500 loan interest = ₱2,500 (card payment is not a 2nd expense!)
  assert.equal(is.totalExpenses, 250_000);

  const debt = computeDebtReport(svc.state.accounts, svc.state.entries, { asOf: '2026-11-30' });
  const loanRow = debt.items.find((i) => i.account.id === loanAcc.id);
  const cardRow = debt.items.find((i) => i.account.id === cardAcc.id);
  assert.equal(loanRow.balance, 1_500_000); // ₱20,000 - ₱5,000 principal = ₱15,000 owed
  assert.equal(cardRow.balance, 0); // ₱2,000 charged - ₱2,000 paid = ₱0 owed
});

test('Stage 5: savings goals and recurring bills one-tap payment', async () => {
  const svc = createTestService('2026-11-15');
  await svc.init();

  await svc.recordIncome({
    date: '2026-11-01',
    amount: 3_000_000,
    incomeAccountId: 'acc-4000',
    depositAccountId: 'acc-1100',
  });

  const goal = await svc.saveGoal({
    name: 'Emergency Fund',
    targetAmount: 1_000_000,
    savedAmount: 200_000,
    targetDate: '2026-12-31',
  });
  await svc.contributeToGoal(goal.id, {
    amount: 300_000,
    fromAccountId: 'acc-1100',
    toAccountId: 'acc-1200',
    date: '2026-11-10',
  });

  const bill = await svc.saveBill({
    name: 'Meralco Electric',
    amount: 350_000,
    frequency: 'monthly',
    nextDueDate: '2026-11-20',
    expenseAccountId: 'acc-5200',
    paymentAccountId: 'acc-1100',
  });

  const { bill: updatedBill } = await svc.payBill(bill.id, { date: '2026-11-15' });
  assert.equal(updatedBill.lastPaidDate, '2026-11-15');
  assert.equal(updatedBill.nextDueDate, '2026-12-20');

  const d = computeDashboard({
    ...svc.state,
    today: '2026-11-15',
  });
  assert.equal(d.savingsProgress.totalSaved, 500_000);
  assert.equal(d.savingsProgress.progressBp, 5000); // 50.0%
  assert.equal(d.month.expenses, 350_000);
});

test('Stage 4 & 6: manual journal entries and all accounting identities (Trial Balance, Balance Sheet, Cash Flow, General Ledger)', async () => {
  const svc = createTestService('2026-11-15');
  await svc.init();

  // Opening balance on Cash ₱10,000
  await svc.recordManualEntry({
    date: '2026-10-25',
    description: 'Initial cash on hand',
    lines: [
      debitLine('acc-1000', 1_000_000),
      creditLine('acc-3000', 1_000_000),
    ],
  });

  // November salary ₱30,000 -> Bank
  await svc.recordIncome({
    date: '2026-11-01',
    amount: 3_000_000,
    incomeAccountId: 'acc-4000',
    depositAccountId: 'acc-1100',
  });

  // November grocery ₱2,000 -> Cash
  await svc.recordExpense({
    date: '2026-11-03',
    amount: 200_000,
    expenseAccountId: 'acc-5000',
    paymentAccountId: 'acc-1000',
  });

  // November transfer ₱5,000 Bank -> GCash
  await svc.recordTransfer({
    date: '2026-11-05',
    amount: 500_000,
    fromAccountId: 'acc-1100',
    toAccountId: 'acc-1200',
  });

  const tb = trialBalance(svc.state.accounts, svc.state.entries, { asOf: '2026-11-30' });
  assert.equal(tb.balanced, true);
  assert.equal(tb.totalDebit, tb.totalCredit);

  const eq = accountingEquation(svc.state.accounts, svc.state.entries, { asOf: '2026-11-30' });
  assert.equal(eq.balanced, true);
  assert.equal(eq.assets, eq.liabilitiesPlusEquity);

  const bs = balanceSheet(svc.state.accounts, svc.state.entries, { asOf: '2026-11-30' });
  assert.equal(bs.balanced, true);
  assert.equal(bs.totalAssets, 3_800_000); // ₱8k cash + ₱25k bank + ₱5k GCash = ₱38,000
  assert.equal(bs.totalEquity, 3_800_000); // ₱10k opening equity + ₱28k net income

  const cf = cashFlowStatement(svc.state.accounts, svc.state.entries, { from: '2026-11-01', to: '2026-11-30' });
  assert.equal(cf.beginningCash, 1_000_000); // ₱10,000 from Oct
  assert.equal(cf.operatingIn, 3_000_000);
  assert.equal(cf.operatingOut, 200_000);
  assert.equal(cf.netCashFlow, 2_800_000);
  assert.equal(cf.endingCash, 3_800_000);
  assert.equal(cf.reconciled, true);

  const gl = generalLedger(svc.state.accounts, svc.state.entries, {
    accountId: 'acc-1000',
    from: '2026-11-01',
    to: '2026-11-30',
  });
  assert.equal(gl.ledgers[0].openingBalance, 1_000_000);
  assert.equal(gl.ledgers[0].closingBalance, 800_000);

  const nw = netWorthReport(svc.state.accounts, svc.state.entries, { today: '2026-11-15', months: 3 });
  assert.equal(nw.netWorth, 3_800_000);
  assert.equal(nw.history.length, 3);
});

test('Stage 7: CSV export and backup/restore with duplicate transaction avoidance', async () => {
  const svc1 = createTestService('2026-11-15');
  await svc1.init();

  await svc1.recordIncome({
    date: '2026-11-01',
    amount: 3_000_000,
    incomeAccountId: 'acc-4000',
    depositAccountId: 'acc-1100',
    description: 'Salary',
  });
  await svc1.recordExpense({
    date: '2026-11-02',
    amount: 200_000,
    expenseAccountId: 'acc-5000',
    paymentAccountId: 'acc-1000',
    description: 'Groceries',
  });

  const csv = exportTransactionsCsv(svc1.state.entries, svc1.state.accountsById);
  assert.match(csv, /Salary/);
  assert.match(csv, /30000\.00/);
  assert.match(csv, /2000\.00/);

  const backup = svc1.exportBackup();
  assert.equal(backup.counts.entries, 2);

  // Import into a second service twice: second import must skip all duplicate entries
  const svc2 = createTestService('2026-11-15');
  await svc2.init();
  const firstImport = await svc2.importBackup(backup, { mode: 'merge' });
  assert.equal(firstImport.entriesAdded, 2);
  assert.equal(firstImport.entriesSkippedDuplicate, 0);

  // Modify entry IDs in backup to verify fingerprint-based duplicate detection as well
  const clonedBackup = structuredClone(backup);
  clonedBackup.data.entries[0].id = 'different-uuid-999';
  const secondImport = await svc2.importBackup(clonedBackup, { mode: 'merge' });
  assert.equal(secondImport.entriesAdded, 0);
  assert.equal(secondImport.entriesSkippedDuplicate, 2);
  assert.equal(svc2.state.entries.length, 2);

  // Corrupting a backup entry so debits != credits must be rejected
  const corrupted = structuredClone(backup);
  corrupted.data.entries[0].id = 'bad-entry-id';
  corrupted.data.entries[0].description = 'Corrupted unbalanced entry';
  corrupted.data.entries[0].lines[0].debit = 9_999_999;
  await assert.rejects(() => svc2.importBackup(corrupted, { mode: 'merge' }), /unbalanced/i);

  // Stage 7: AES-256-GCM passphrase-encrypted backup & restore + statement CSV exports
  const encryptedEnvelope = await encryptBackupPayload(backup, 'CorrectHorseBatteryStaple!');
  assert.equal(encryptedEnvelope.encrypted, true);
  assert.equal(encryptedEnvelope.cipher, 'AES-256-GCM');
  assert.equal(encryptedEnvelope.kdf, 'PBKDF2-SHA256');

  // Wrong passphrase must fail authenticated decryption
  await assert.rejects(() => decryptBackupPayload(encryptedEnvelope, 'WrongPassphrase123'), /incorrect passphrase/i);

  // Correct passphrase recovers exact backup payload
  const decrypted = await decryptBackupPayload(encryptedEnvelope, 'CorrectHorseBatteryStaple!');
  assert.equal(decrypted.counts.entries, 2);

  // Verify Trial Balance, Income Statement, and Balance Sheet CSV exports
  const tb = trialBalance(svc1.state.accounts, svc1.state.entries);
  const is = incomeStatement(svc1.state.accounts, svc1.state.entries);
  const bs = balanceSheet(svc1.state.accounts, svc1.state.entries);
  assert.match(exportTrialBalanceCsv(tb), /30000\.00/);
  assert.match(exportIncomeStatementCsv(is), /Net Income/);
  assert.match(exportBalanceSheetCsv(bs), /Total Liabilities \+ Equity/);
});
