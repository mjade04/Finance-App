import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRepository } from '../src/data/repository.js';
import { FinanceService } from '../src/services/financeService.js';
import { computeDashboard } from '../src/domain/dashboard.js';
import { trialBalance, accountingEquation } from '../src/domain/ledger.js';
import { ValidationError } from '../src/domain/errors.js';

async function setup() {
  let n = 0;
  const repo = new MemoryRepository();
  const service = new FinanceService(repo, {
    clock: () => new Date(2026, 10, 15, 10, 0, 0), // 2026-11-15 local
    newId: () => `id-${++n}`,
  });
  await service.init();
  return { repo, service };
}

test('first launch seeds the chart of accounts once', async () => {
  const { repo, service } = await setup();
  const count = service.state.accounts.length;
  assert.ok(count > 10);
  await service.init();
  assert.equal((await repo.listAccounts()).length, count);
});

test('end-to-end scenario: income, expense, transfers, borrowing, card payment', async () => {
  const { service } = await setup();
  const card = await service.createAccount({ name: 'BPI Card', subtype: 'credit_card' });
  const loan = await service.createAccount({ name: 'Loan from Tito', subtype: 'loan' });
  await service.createAccount({ name: 'Maya', subtype: 'ewallet', openingBalance: 100_000, openingDate: '2026-10-01' });

  await service.recordIncome({ date: '2026-11-01', amount: 3_000_000, depositAccountId: 'acc-1100', incomeAccountId: 'acc-4000' });
  await service.recordExpense({ date: '2026-11-02', amount: 200_000, paymentAccountId: 'acc-1000', expenseAccountId: 'acc-5000' });
  await service.recordTransfer({ date: '2026-11-03', amount: 500_000, fromAccountId: 'acc-1100', toAccountId: 'acc-1200' });
  await service.recordTransfer({ date: '2026-11-04', amount: 1_000_000, fromAccountId: loan.id, toAccountId: 'acc-1000' }); // borrow
  await service.recordExpense({ date: '2026-11-05', amount: 300_000, paymentAccountId: card.id, expenseAccountId: 'acc-5700' }); // card purchase
  await service.recordTransfer({ date: '2026-11-06', amount: 300_000, fromAccountId: 'acc-1100', toAccountId: card.id }); // card payment

  const { accounts, entries } = service.state;
  const d = computeDashboard({ accounts, entries, today: '2026-11-15' });

  // Only real income and real expenses count.
  assert.equal(d.month.income, 3_000_000, 'borrowing and transfers are not income');
  assert.equal(d.month.expenses, 500_000, 'card payment is not a second expense');

  assert.equal(d.liquid.cash, 1_000_000 - 200_000 + 0); // -2,000 groceries + 10,000 loan (Cash starts at 0)
  assert.equal(d.liquid.bank, 3_000_000 - 500_000 - 300_000);
  assert.equal(d.liquid.ewallet, 500_000 + 100_000);
  assert.equal(d.outstandingDebt.creditCards, 0);
  assert.equal(d.outstandingDebt.loans, 1_000_000);
  assert.equal(d.netWorth, d.totalAssets - d.totalLiabilities);
  assert.equal(d.netWorth, 100_000 + 3_000_000 - 500_000, 'opening + income - expenses');

  // Net cash flow = change in liquid accounts this month (internal transfers net to zero).
  assert.equal(d.month.netCashFlow, 3_000_000 - 200_000 + 1_000_000 - 300_000);

  const tb = trialBalance(accounts, entries);
  assert.equal(tb.balanced, true);
  assert.equal(tb.totalDebit, tb.totalCredit);
  const eq = accountingEquation(accounts, entries);
  assert.equal(eq.balanced, true);
  assert.equal(eq.assets, eq.liabilities + eq.equity);
  assert.equal(d.health.trialBalanced && d.health.equationBalanced, true);

  const spending = d.month.byCategory.map((c) => [c.accountId, c.amount]);
  assert.deepEqual(spending, [['acc-5700', 300_000], ['acc-5000', 200_000]]);
});

test('reversal restores balances and keeps history', async () => {
  const { service } = await setup();
  const e = await service.recordExpense({ date: '2026-11-02', amount: 200_000, paymentAccountId: 'acc-1000', expenseAccountId: 'acc-5000' });
  await service.reverse(e.id);
  const { accounts, entries } = service.state;
  assert.equal(entries.length, 2);
  const d = computeDashboard({ accounts, entries, today: '2026-11-15' });
  assert.equal(d.month.expenses, 0);
  assert.equal(d.liquid.cash, 0);
  await assert.rejects(service.reverse(e.id));
});

test('invalid input never reaches storage', async () => {
  const { service, repo } = await setup();
  await assert.rejects(service.recordIncome({ date: '2026-11-01', amount: 0, depositAccountId: 'acc-1100', incomeAccountId: 'acc-4000' }), ValidationError);
  await assert.rejects(service.createAccount({ name: 'Cash on Hand', subtype: 'cash' }), ValidationError);
  assert.equal((await repo.listEntries()).length, 0);
});

test('future-dated entries do not affect current balances', async () => {
  const { service } = await setup();
  await service.recordIncome({ date: '2026-12-20', amount: 100_000, depositAccountId: 'acc-1100', incomeAccountId: 'acc-4000' });
  const d = computeDashboard({ ...service.state, today: '2026-11-15' });
  assert.equal(d.liquid.bank, 0);
  assert.equal(d.month.income, 0);
});
