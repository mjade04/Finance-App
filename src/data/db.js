/**
 * IndexedDB connection and schema migrations.
 * Android migration: replaced by a Room @Database with versioned Migration objects.
 */

export const DB_NAME = 'myfinance-pro';
export const DB_VERSION = 2;

export const STORES = Object.freeze({
  ACCOUNTS: 'accounts',
  ENTRIES: 'journal_entries',
  BUDGETS: 'budgets',
  GOALS: 'goals',
  BILLS: 'bills',
  SETTINGS: 'settings',
});

/**
 * Ordered migrations. Never edit a released migration — add a new version.
 */
const MIGRATIONS = {
  1(db) {
    const accounts = db.createObjectStore(STORES.ACCOUNTS, { keyPath: 'id' });
    accounts.createIndex('code', 'code', { unique: true });
    accounts.createIndex('type', 'type');

    const entries = db.createObjectStore(STORES.ENTRIES, { keyPath: 'id' });
    entries.createIndex('date', 'date');
    entries.createIndex('kind', 'kind');

    db.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
  },
  2(db) {
    if (!db.objectStoreNames.contains(STORES.BUDGETS)) {
      const budgets = db.createObjectStore(STORES.BUDGETS, { keyPath: 'id' });
      budgets.createIndex('accountId', 'accountId', { unique: true });
    }
    if (!db.objectStoreNames.contains(STORES.GOALS)) {
      db.createObjectStore(STORES.GOALS, { keyPath: 'id' });
    }
    if (!db.objectStoreNames.contains(STORES.BILLS)) {
      const bills = db.createObjectStore(STORES.BILLS, { keyPath: 'id' });
      bills.createIndex('nextDueDate', 'nextDueDate');
    }
  },
};

export function openDatabase(name = DB_NAME, factory = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    if (!factory) {
      reject(new Error('IndexedDB is not available in this browser. Local storage of financial data is impossible.'));
      return;
    }
    const request = factory.open(name, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      for (let v = event.oldVersion + 1; v <= DB_VERSION; v += 1) MIGRATIONS[v](db, request.transaction);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Database upgrade blocked. Close other MyFinance Pro tabs and reload.'));
  });
}

export function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted.'));
  });
}
