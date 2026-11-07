/**
 * Application service: the single entry point the UI uses to read and change
 * financial data. It orchestrates domain rules (pure) and the repository
 * (storage), and notifies subscribers after every successful commit.
 *
 * Android migration: becomes use-case classes injected into ViewModels;
 * `subscribe` becomes a Kotlin Flow / StateFlow.
 */
import { DEFAULT_CHART_OF_ACCOUNTS, nextAccountCode, SUBTYPE_INFO, validateAccount } from '../domain/accounts.js';
import { EntryKind, finalizeEntry, reverseEntry, validateEntry } from '../domain/journal.js';
import { buildExpense, buildIncome, buildOpeningBalance, buildTransfer } from '../domain/transactions.js';
import {
  advanceBillDueDate,
  buildCreditCardPayment,
  buildLoanPayment,
  buildLoanProceeds,
  validateBill,
  validateBudget,
  validateGoal,
} from '../domain/planning.js';
import { createBackupPayload, validateAndPlanImport } from '../domain/backup.js';
import { add } from '../domain/money.js';
import { ValidationError, LedgerError } from '../domain/errors.js';
import { isValidISODate, toISODate } from '../domain/dates.js';

export class FinanceService {
  #repo;
  #clock;
  #newId;
  #listeners = new Set();
  #state = {
    accounts: [],
    entries: [],
    budgets: [],
    goals: [],
    bills: [],
    accountsById: new Map(),
  };

  /**
   * @param {import('../data/repository.js').FinanceRepository} repo
   * @param {{clock?: () => Date, newId?: () => string}} [options]
   */
  constructor(repo, { clock = () => new Date(), newId = () => globalThis.crypto.randomUUID() } = {}) {
    this.#repo = repo;
    this.#clock = clock;
    this.#newId = newId;
  }

  async init() {
    const accounts = await this.#repo.listAccounts();
    if (accounts.length === 0) {
      const now = this.#clock().toISOString();
      await this.#repo.commit({
        accounts: DEFAULT_CHART_OF_ACCOUNTS.map((a) => ({ ...a, createdAt: now, updatedAt: now })),
      });
    }
    await this.#reload();
  }

  async #reload() {
    const [accounts, entries, budgets, goals, bills] = await Promise.all([
      this.#repo.listAccounts(),
      this.#repo.listEntries(),
      this.#repo.listBudgets ? this.#repo.listBudgets() : Promise.resolve([]),
      this.#repo.listGoals ? this.#repo.listGoals() : Promise.resolve([]),
      this.#repo.listBills ? this.#repo.listBills() : Promise.resolve([]),
    ]);
    accounts.sort((a, b) => a.code.localeCompare(b.code));
    this.#state = {
      accounts,
      entries,
      budgets,
      goals,
      bills,
      accountsById: new Map(accounts.map((a) => [a.id, a])),
    };
  }

  /** Current read model. Treat as read-only. */
  get state() {
    return this.#state;
  }

  today() {
    return toISODate(this.#clock());
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async #afterCommit() {
    await this.#reload();
    for (const listener of this.#listeners) listener(this.#state);
  }

  #finalizeAndValidate(draft, accountsById = this.#state.accountsById) {
    const entry = finalizeEntry(draft, { id: this.#newId(), now: this.#clock() });
    const result = validateEntry(entry, accountsById);
    if (!result.ok) throw new ValidationError(result.errors);
    return entry;
  }

  async #post(draft) {
    const entry = this.#finalizeAndValidate(draft);
    await this.#repo.commit({ entries: [entry] });
    await this.#afterCommit();
    return entry;
  }

  /* ---------- Everyday transactions & manual journal entries ---------- */

  async recordIncome(input) {
    return this.#post(buildIncome(input, this.#state.accountsById));
  }

  async recordExpense(input) {
    return this.#post(buildExpense(input, this.#state.accountsById));
  }

  async recordTransfer(input) {
    return this.#post(buildTransfer(input, this.#state.accountsById));
  }

  async recordManualEntry({ date, description, note = '', lines }) {
    return this.#post({
      date,
      kind: EntryKind.MANUAL,
      description,
      note,
      lines,
    });
  }

  async reverse(entryId, { date } = {}) {
    const original = this.#state.entries.find((e) => e.id === entryId);
    if (!original) throw new LedgerError('Entry not found.');
    const { reversal, updatedOriginal } = reverseEntry(original, {
      id: this.#newId(),
      date: date ?? (this.today() < original.date ? original.date : this.today()),
      now: this.#clock(),
    });
    const result = validateEntry(reversal, this.#state.accountsById);
    if (!result.ok) throw new ValidationError(result.errors);
    await this.#repo.commit({ entries: [reversal, updatedOriginal] });
    await this.#afterCommit();
    return reversal;
  }

  /* ---------- Accounts & Chart of Accounts ---------- */

  /**
   * Create an account or category with an optional opening balance, atomically.
   */
  async createAccount({
    name,
    subtype,
    openingBalance = 0,
    openingDate,
    creditLimit = null,
    statementDay = null,
    dueDay = null,
  }) {
    const info = SUBTYPE_INFO[subtype];
    if (!info) throw new ValidationError(['Choose a valid account type.']);
    const now = this.#clock().toISOString();
    const account = {
      id: this.#newId(),
      code: nextAccountCode(this.#state.accounts, subtype),
      name: String(name ?? '').trim(),
      type: info.type,
      subtype,
      icon: info.icon,
      creditLimit: Number.isSafeInteger(creditLimit) && creditLimit > 0 ? creditLimit : null,
      statementDay: statementDay ? Number(statementDay) : null,
      dueDay: dueDay ? Number(dueDay) : null,
      isActive: true,
      isSystem: false,
      createdAt: now,
      updatedAt: now,
    };
    const errors = validateAccount(account, this.#state.accounts);
    const date = openingDate ?? this.today();
    if (openingBalance !== 0 && !isValidISODate(date)) errors.push('Opening balance date is invalid.');
    if (errors.length) throw new ValidationError(errors);

    const entries = [];
    const draft = buildOpeningBalance(account, openingBalance, date);
    if (draft) {
      const withNew = new Map(this.#state.accountsById).set(account.id, account);
      entries.push(this.#finalizeAndValidate(draft, withNew));
    }
    await this.#repo.commit({ accounts: [account], entries });
    await this.#afterCommit();
    return account;
  }

  async toggleAccountActive(accountId) {
    const acc = this.#state.accountsById.get(accountId);
    if (!acc) throw new ValidationError(['Account not found.']);
    if (acc.isSystem) throw new ValidationError(['System accounts cannot be archived.']);
    const updated = {
      ...acc,
      isActive: acc.isActive === false,
      updatedAt: this.#clock().toISOString(),
    };
    await this.#repo.commit({ accounts: [updated] });
    await this.#afterCommit();
    return updated;
  }

  /* ---------- Stage 5: Budgets ---------- */

  async setBudget({ accountId, amount }) {
    const existing = this.#state.budgets.find((b) => b.accountId === accountId);
    const now = this.#clock().toISOString();
    const budget = {
      id: existing?.id ?? this.#newId(),
      accountId,
      amount,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const errors = validateBudget(budget, this.#state.accountsById);
    if (errors.length) throw new ValidationError(errors);
    await this.#repo.commit({ budgets: [budget] });
    await this.#afterCommit();
    return budget;
  }

  async deleteBudget(budgetId) {
    await this.#repo.commit({ deleteBudgetIds: [budgetId] });
    await this.#afterCommit();
  }

  /* ---------- Stage 5: Savings goals ---------- */

  async saveGoal({ id, name, targetAmount, savedAmount = 0, targetDate = '', linkedAccountId = null, useAccountBalance = false }) {
    const existing = id ? this.#state.goals.find((g) => g.id === id) : null;
    const now = this.#clock().toISOString();
    const goal = {
      id: existing?.id ?? this.#newId(),
      name: String(name ?? '').trim(),
      targetAmount,
      savedAmount,
      targetDate: targetDate ? String(targetDate).trim() : null,
      linkedAccountId: linkedAccountId || null,
      useAccountBalance: Boolean(useAccountBalance && linkedAccountId),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const errors = validateGoal(goal, this.#state.accountsById);
    if (errors.length) throw new ValidationError(errors);
    await this.#repo.commit({ goals: [goal] });
    await this.#afterCommit();
    return goal;
  }

  /**
   * Record a contribution to a savings goal, optionally posting a real transfer
   * between two asset accounts at the same time.
   */
  async contributeToGoal(goalId, { amount, fromAccountId = null, toAccountId = null, date }) {
    const goal = this.#state.goals.find((g) => g.id === goalId);
    if (!goal) throw new ValidationError(['Savings goal not found.']);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new ValidationError(['Contribution amount must be greater than zero.']);
    }
    const entries = [];
    if (fromAccountId && toAccountId && fromAccountId !== toAccountId) {
      const draft = buildTransfer({
        date: date ?? this.today(),
        fromAccountId,
        toAccountId,
        amount,
        description: `Savings transfer: ${goal.name}`,
      }, this.#state.accountsById);
      entries.push(this.#finalizeAndValidate(draft));
    }
    const updatedGoal = {
      ...goal,
      savedAmount: add(goal.savedAmount ?? 0, amount),
      updatedAt: this.#clock().toISOString(),
    };
    await this.#repo.commit({ goals: [updatedGoal], entries });
    await this.#afterCommit();
    return updatedGoal;
  }

  async deleteGoal(goalId) {
    await this.#repo.commit({ deleteGoalIds: [goalId] });
    await this.#afterCommit();
  }

  /* ---------- Stage 5: Debts, loans & credit cards ---------- */

  async recordLoanProceeds(input) {
    return this.#post(buildLoanProceeds(input, this.#state.accountsById));
  }

  async recordLoanPayment(input) {
    return this.#post(buildLoanPayment(input, this.#state.accountsById));
  }

  async recordCreditCardPayment(input) {
    return this.#post(buildCreditCardPayment(input, this.#state.accountsById));
  }

  /* ---------- Stage 5: Recurring bills ---------- */

  async saveBill({ id, name, amount, frequency = 'monthly', nextDueDate, expenseAccountId, paymentAccountId }) {
    const existing = id ? this.#state.bills.find((b) => b.id === id) : null;
    const now = this.#clock().toISOString();
    const bill = {
      id: existing?.id ?? this.#newId(),
      name: String(name ?? '').trim(),
      amount,
      frequency,
      nextDueDate,
      expenseAccountId,
      paymentAccountId,
      lastPaidDate: existing?.lastPaidDate ?? null,
      isActive: true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const errors = validateBill(bill, this.#state.accountsById);
    if (errors.length) throw new ValidationError(errors);
    await this.#repo.commit({ bills: [bill] });
    await this.#afterCommit();
    return bill;
  }

  /**
   * Pay a recurring bill: posts a balanced expense entry and advances `nextDueDate`
   * atomically in a single storage transaction.
   */
  async payBill(billId, { date, amount, paymentAccountId } = {}) {
    const bill = this.#state.bills.find((b) => b.id === billId);
    if (!bill) throw new ValidationError(['Recurring bill not found.']);
    const paidDate = date ?? this.today();
    const paidAmount = amount ?? bill.amount;
    const paidFrom = paymentAccountId ?? bill.paymentAccountId;

    const draft = buildExpense({
      date: paidDate,
      amount: paidAmount,
      expenseAccountId: bill.expenseAccountId,
      paymentAccountId: paidFrom,
      description: `Bill payment: ${bill.name}`,
    }, this.#state.accountsById);
    const entry = this.#finalizeAndValidate(draft);

    const updatedBill = {
      ...bill,
      lastPaidDate: paidDate,
      nextDueDate: advanceBillDueDate(bill.nextDueDate, bill.frequency),
      updatedAt: this.#clock().toISOString(),
    };
    await this.#repo.commit({ entries: [entry], bills: [updatedBill] });
    await this.#afterCommit();
    return { entry, bill: updatedBill };
  }

  async deleteBill(billId) {
    await this.#repo.commit({ deleteBillIds: [billId] });
    await this.#afterCommit();
  }

  /* ---------- Stage 7: Backup & restore ---------- */

  exportBackup() {
    return createBackupPayload(this.#state, { now: this.#clock() });
  }

  async importBackup(rawPayload, { mode = 'merge' } = {}) {
    const plan = validateAndPlanImport(rawPayload, this.#state, { mode });
    if (mode === 'replace') {
      await this.#repo.eraseAll();
    }
    await this.#repo.commit({
      accounts: plan.accountsToSave,
      entries: plan.entriesToSave,
      budgets: plan.budgetsToSave,
      goals: plan.goalsToSave,
      bills: plan.billsToSave,
    });
    await this.#afterCommit();
    return plan.summary;
  }

  /* ---------- Settings & Erase ---------- */

  getSetting(key, fallback) {
    return this.#repo.getSetting(key, fallback);
  }

  setSetting(key, value) {
    return this.#repo.setSetting(key, value);
  }

  async eraseAllData() {
    await this.#repo.eraseAll();
    await this.init();
    await this.#afterCommit();
  }

  /**
   * Populate realistic Philippine Peso (PHP) double-entry records, budgets,
   * savings goals, and recurring bills so the Dashboard can be explored immediately.
   * Every figure is persisted through the exact same double-entry validation pipeline.
   */
  async seedSampleData() {
    const todayStr = this.today();
    const monthKey = todayStr.slice(0, 7);
    const todayDay = Number(todayStr.slice(8, 10));
    const d = (day) => `${monthKey}-${String(Math.min(day, todayDay)).padStart(2, '0')}`;
    const due = (day) => `${monthKey}-${String(day).padStart(2, '0')}`;

    // Create Credit Card and Personal Loan liability accounts if not present
    let card = this.#state.accounts.find((a) => a.subtype === 'credit_card');
    if (!card) {
      card = await this.createAccount({
        name: 'BPI Blue Mastercard',
        subtype: 'credit_card',
        creditLimit: 8_000_000, // ₱80,000.00
        statementDay: 15,
        dueDay: 5,
      });
    }
    let loan = this.#state.accounts.find((a) => a.subtype === 'loan');
    if (!loan) {
      loan = await this.createAccount({
        name: 'Pag-IBIG Multi-Purpose Loan',
        subtype: 'loan',
      });
    }

    // 1. Opening balances on Cash (₱8,500) and Bank (₱45,000)
    await this.recordManualEntry({
      date: d(1),
      description: 'Opening balance: Cash & Bank',
      lines: [
        { accountId: 'acc-1000', debit: 850_000, credit: 0 },
        { accountId: 'acc-1100', debit: 4_500_000, credit: 0 },
        { accountId: 'acc-3000', debit: 0, credit: 5_350_000 },
      ],
    });

    // 2. Salary of ₱30,000 received into Bank Account (Dr Bank ₱30,000 / Cr Salary ₱30,000)
    await this.recordIncome({
      date: d(1),
      amount: 3_000_000,
      incomeAccountId: 'acc-4000',
      depositAccountId: 'acc-1100',
      description: 'Monthly Salary',
    });

    // 3. Grocery purchase of ₱2,000 in Cash (Dr Food & Groceries ₱2,000 / Cr Cash ₱2,000)
    await this.recordExpense({
      date: d(2),
      amount: 200_000,
      expenseAccountId: 'acc-5000',
      paymentAccountId: 'acc-1000',
      description: 'SM Supermarket Groceries',
    });

    // 4. Transfer of ₱5,000 from Bank Account to GCash E-wallet (Dr GCash ₱5,000 / Cr Bank ₱5,000)
    await this.recordTransfer({
      date: d(3),
      amount: 500_000,
      fromAccountId: 'acc-1100',
      toAccountId: 'acc-1200',
      description: 'Cash-in to GCash',
    });

    // 5. Utilities & Transportation expenses
    await this.recordExpense({
      date: d(4),
      amount: 345_000,
      expenseAccountId: 'acc-5200',
      paymentAccountId: 'acc-1200',
      description: 'Meralco Electric Bill',
    });
    await this.recordExpense({
      date: d(5),
      amount: 180_000,
      expenseAccountId: 'acc-5100',
      paymentAccountId: 'acc-1000',
      description: 'RFID Toll & Fuel',
    });

    // 6. Credit card purchase (₱3,200 Shopping) + partial bill payment (₱1,500 from Bank)
    await this.recordExpense({
      date: d(5),
      amount: 320_000,
      expenseAccountId: 'acc-5700',
      paymentAccountId: card.id,
      description: 'Appliance & home essentials (Card)',
    });
    await this.recordCreditCardPayment({
      date: d(6),
      cardAccountId: card.id,
      paymentAccountId: 'acc-1100',
      amount: 150_000,
      description: 'Partial payment to BPI Card',
    });

    // 7. Loan proceeds (₱20,000 into Bank — liability, not income) + repayment (₱2,000 principal + ₱250 interest)
    await this.recordLoanProceeds({
      date: d(2),
      loanAccountId: loan.id,
      depositAccountId: 'acc-1100',
      amount: 2_000_000,
      description: 'Pag-IBIG loan disbursement',
    });
    await this.recordLoanPayment({
      date: d(6),
      loanAccountId: loan.id,
      paymentAccountId: 'acc-1100',
      interestAccountId: 'acc-5800',
      principalAmount: 200_000,
      interestAmount: 25_000,
      description: 'Monthly loan amortization',
    });

    // 8. Monthly budgets
    await this.setBudget({ accountId: 'acc-5000', amount: 800_000 }); // Food ₱8,000
    await this.setBudget({ accountId: 'acc-5200', amount: 500_000 }); // Utilities ₱5,000
    await this.setBudget({ accountId: 'acc-5100', amount: 400_000 }); // Transport ₱4,000
    await this.setBudget({ accountId: 'acc-5700', amount: 400_000 }); // Shopping ₱4,000

    // 9. Savings goals
    await this.saveGoal({
      name: 'Emergency Fund (6 Months)',
      targetAmount: 10_000_000, // ₱100,000
      savedAmount: 4_500_000,   // ₱45,000
      targetDate: `${Number(monthKey.slice(0, 4)) + 1}-06-30`,
    });
    await this.saveGoal({
      name: 'Travel & Vacation Fund',
      targetAmount: 2_500_000,  // ₱25,000
      savedAmount: 1_250_000,   // ₱12,500
      targetDate: `${monthKey.slice(0, 4)}-12-20`,
    });

    // 10. Recurring bills
    await this.saveBill({
      name: 'PLDT Home Fiber',
      amount: 169_900, // ₱1,699.00
      frequency: 'monthly',
      nextDueDate: due(18),
      expenseAccountId: 'acc-5200',
      paymentAccountId: 'acc-1200',
    });
    await this.saveBill({
      name: 'Condo Association Dues',
      amount: 350_000, // ₱3,500.00
      frequency: 'monthly',
      nextDueDate: due(25),
      expenseAccountId: 'acc-5300',
      paymentAccountId: 'acc-1100',
    });
  }
}
