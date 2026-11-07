/**
 * Storage abstraction (Repository pattern).
 *
 * The domain and services depend only on this contract, never on IndexedDB:
 *
 * @typedef {object} FinanceRepository
 * @property {() => Promise<object[]>} listAccounts
 * @property {() => Promise<object[]>} listEntries
 * @property {() => Promise<object[]>} listBudgets
 * @property {() => Promise<object[]>} listGoals
 * @property {() => Promise<object[]>} listBills
 * @property {(changes: {
 *   accounts?: object[],
 *   entries?: object[],
 *   budgets?: object[],
 *   goals?: object[],
 *   bills?: object[],
 *   deleteBudgetIds?: string[],
 *   deleteGoalIds?: string[],
 *   deleteBillIds?: string[]
 * }) => Promise<void>} commit
 * @property {(key: string, fallback?: any) => Promise<any>} getSetting
 * @property {(key: string, value: any) => Promise<void>} setSetting
 * @property {() => Promise<void>} eraseAll
 *
 * Android migration: becomes a Kotlin `FinanceRepository` interface backed by
 * Room DAOs; `commit` maps to a `@Transaction` DAO method.
 */
import { DB_NAME, DB_VERSION, openDatabase, requestToPromise, STORES, transactionDone } from './db.js';

export class IndexedDbRepository {
  /** @param {IDBDatabase} db */
  constructor(db) {
    this.db = db;
  }

  static async open(name = DB_NAME, factory = globalThis.indexedDB) {
    return new IndexedDbRepository(await openDatabase(name, factory));
  }

  close() {
    this.db.close();
  }

  async diagnostics() {
    const [accounts, entries, budgets, goals, bills] = await Promise.all([
      this.listAccounts(),
      this.listEntries(),
      this.listBudgets(),
      this.listGoals(),
      this.listBills(),
    ]);
    return {
      backend: 'IndexedDB',
      dbName: this.db.name,
      schemaVersion: this.db.version,
      stores: [...this.db.objectStoreNames],
      counts: {
        accounts: accounts.length,
        entries: entries.length,
        budgets: budgets.length,
        goals: goals.length,
        bills: bills.length,
      },
    };
  }

  async #getAll(store) {
    const tx = this.db.transaction(store, 'readonly');
    return requestToPromise(tx.objectStore(store).getAll());
  }

  listAccounts() {
    return this.#getAll(STORES.ACCOUNTS);
  }

  listEntries() {
    return this.#getAll(STORES.ENTRIES);
  }

  listBudgets() {
    return this.#getAll(STORES.BUDGETS);
  }

  listGoals() {
    return this.#getAll(STORES.GOALS);
  }

  listBills() {
    return this.#getAll(STORES.BILLS);
  }

  async commit({
    accounts = [],
    entries = [],
    budgets = [],
    goals = [],
    bills = [],
    deleteBudgetIds = [],
    deleteGoalIds = [],
    deleteBillIds = [],
  } = {}) {
    const storeNames = [
      STORES.ACCOUNTS,
      STORES.ENTRIES,
      STORES.BUDGETS,
      STORES.GOALS,
      STORES.BILLS,
    ];
    const tx = this.db.transaction(storeNames, 'readwrite');
    const done = transactionDone(tx);
    const accountStore = tx.objectStore(STORES.ACCOUNTS);
    const entryStore = tx.objectStore(STORES.ENTRIES);
    const budgetStore = tx.objectStore(STORES.BUDGETS);
    const goalStore = tx.objectStore(STORES.GOALS);
    const billStore = tx.objectStore(STORES.BILLS);

    for (const account of accounts) accountStore.put(account);
    for (const entry of entries) entryStore.put(entry);
    for (const budget of budgets) budgetStore.put(budget);
    for (const goal of goals) goalStore.put(goal);
    for (const bill of bills) billStore.put(bill);
    for (const id of deleteBudgetIds) budgetStore.delete(id);
    for (const id of deleteGoalIds) goalStore.delete(id);
    for (const id of deleteBillIds) billStore.delete(id);

    await done;
  }

  async getSetting(key, fallback = undefined) {
    const tx = this.db.transaction(STORES.SETTINGS, 'readonly');
    const record = await requestToPromise(tx.objectStore(STORES.SETTINGS).get(key));
    return record ? record.value : fallback;
  }

  async setSetting(key, value) {
    const tx = this.db.transaction(STORES.SETTINGS, 'readwrite');
    const done = transactionDone(tx);
    tx.objectStore(STORES.SETTINGS).put({ key, value });
    await done;
  }

  async eraseAll() {
    const names = Object.values(STORES);
    const tx = this.db.transaction(names, 'readwrite');
    const done = transactionDone(tx);
    for (const name of names) tx.objectStore(name).clear();
    await done;
  }
}

/** In-memory implementation with identical semantics — used by unit tests. */
export class MemoryRepository {
  #accounts = new Map();
  #entries = new Map();
  #budgets = new Map();
  #goals = new Map();
  #bills = new Map();
  #settings = new Map();

  async listAccounts() {
    return [...this.#accounts.values()].map((v) => structuredClone(v));
  }

  async listEntries() {
    return [...this.#entries.values()].map((v) => structuredClone(v));
  }

  async listBudgets() {
    return [...this.#budgets.values()].map((v) => structuredClone(v));
  }

  async listGoals() {
    return [...this.#goals.values()].map((v) => structuredClone(v));
  }

  async listBills() {
    return [...this.#bills.values()].map((v) => structuredClone(v));
  }

  async commit({
    accounts = [],
    entries = [],
    budgets = [],
    goals = [],
    bills = [],
    deleteBudgetIds = [],
    deleteGoalIds = [],
    deleteBillIds = [],
  } = {}) {
    for (const account of accounts) this.#accounts.set(account.id, structuredClone(account));
    for (const entry of entries) this.#entries.set(entry.id, structuredClone(entry));
    for (const budget of budgets) this.#budgets.set(budget.id, structuredClone(budget));
    for (const goal of goals) this.#goals.set(goal.id, structuredClone(goal));
    for (const bill of bills) this.#bills.set(bill.id, structuredClone(bill));
    for (const id of deleteBudgetIds) this.#budgets.delete(id);
    for (const id of deleteGoalIds) this.#goals.delete(id);
    for (const id of deleteBillIds) this.#bills.delete(id);
  }

  async getSetting(key, fallback = undefined) {
    return this.#settings.has(key) ? structuredClone(this.#settings.get(key)) : fallback;
  }

  async setSetting(key, value) {
    this.#settings.set(key, structuredClone(value));
  }

  async eraseAll() {
    this.#accounts.clear();
    this.#entries.clear();
    this.#budgets.clear();
    this.#goals.clear();
    this.#bills.clear();
    this.#settings.clear();
  }

  close() {}

  async diagnostics() {
    return {
      backend: 'Memory',
      dbName: DB_NAME,
      schemaVersion: DB_VERSION,
      stores: Object.values(STORES),
      counts: {
        accounts: this.#accounts.size,
        entries: this.#entries.size,
        budgets: this.#budgets.size,
        goals: this.#goals.size,
        bills: this.#bills.size,
      },
    };
  }
}
