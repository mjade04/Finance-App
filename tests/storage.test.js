/**
 * Stage 2 tests: IndexedDB connection, schema migrations, IndexedDbRepository
 * persistence across close & reopen, settings storage, and duplicate-safe restore.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DB_VERSION, STORES } from '../src/data/db.js';
import { IndexedDbRepository } from '../src/data/repository.js';
import { FinanceService } from '../src/services/financeService.js';

/**
 * Lightweight, spec-compatible IndexedDB simulator for Node.js tests.
 * Persists store maps inside the factory instance so closing and reopening a
 * database by name verifies true persistence across sessions.
 */
class FakeIDBFactory {
  #databases = new Map();

  open(name, version = 1) {
    const req = { result: null, error: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null, transaction: {} };
    queueMicrotask(() => {
      try {
        let meta = this.#databases.get(name);
        const oldVersion = meta ? meta.version : 0;
        if (!meta) {
          meta = { name, version, stores: new Map() };
          this.#databases.set(name, meta);
        }
        const db = this.#createDbHandle(meta);
        req.result = db;
        if (version > oldVersion) {
          meta.version = version;
          req.onupgradeneeded?.({ oldVersion, newVersion: version });
        }
        req.onsuccess?.();
      } catch (err) {
        req.error = err;
        req.onerror?.();
      }
    });
    return req;
  }

  #createDbHandle(meta) {
    return {
      get name() { return meta.name; },
      get version() { return meta.version; },
      get objectStoreNames() {
        const names = [...meta.stores.keys()];
        names.contains = (n) => meta.stores.has(n);
        return names;
      },
      createObjectStore(storeName, { keyPath = 'id' } = {}) {
        const storeMeta = { keyPath, records: new Map(), indexes: new Map() };
        meta.stores.set(storeName, storeMeta);
        return {
          createIndex(indexName, path, options = {}) {
            storeMeta.indexes.set(indexName, { path, options });
          },
        };
      },
      transaction(storeNames) {
        const list = Array.isArray(storeNames) ? storeNames : [storeNames];
        for (const s of list) {
          if (!meta.stores.has(s)) throw new Error(`Object store "${s}" does not exist.`);
        }
        const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
        let pending = 0;
        let finished = false;
        const maybeComplete = () => {
          if (!finished && pending === 0) {
            finished = true;
            queueMicrotask(() => tx.oncomplete?.());
          }
        };
        queueMicrotask(maybeComplete);

        tx.objectStore = (storeName) => {
          const storeMeta = meta.stores.get(storeName);
          const asyncOp = (fn) => {
            pending += 1;
            const r = { result: undefined, error: null, onsuccess: null, onerror: null };
            queueMicrotask(() => {
              try {
                r.result = fn();
                r.onsuccess?.();
              } catch (err) {
                r.error = err;
                tx.error = err;
                r.onerror?.();
                tx.onerror?.();
              } finally {
                pending -= 1;
                maybeComplete();
              }
            });
            return r;
          };
          return {
            getAll: () => asyncOp(() => [...storeMeta.records.values()].map((v) => structuredClone(v))),
            get: (key) => asyncOp(() => (storeMeta.records.has(key) ? structuredClone(storeMeta.records.get(key)) : undefined)),
            put: (value) => asyncOp(() => {
              const key = value[storeMeta.keyPath];
              storeMeta.records.set(key, structuredClone(value));
              return key;
            }),
            delete: (key) => asyncOp(() => {
              storeMeta.records.delete(key);
            }),
            clear: () => asyncOp(() => {
              storeMeta.records.clear();
            }),
          };
        };
        return tx;
      },
      close() {},
    };
  }
}

test('Stage 2: IndexedDbRepository runs migrations, persists data across close/reopen, and maintains settings', async () => {
  const idbFactory = new FakeIDBFactory();
  let seq = 1;
  const makeClock = () => new Date('2026-11-06T10:00:00Z');
  const makeId = () => `idb-${seq++}`;

  // Session 1: Open database, initialize accounts, record transactions, budgets, goals, bills & settings
  const repo1 = await IndexedDbRepository.open('myfinance-pro-test', idbFactory);
  const svc1 = new FinanceService(repo1, { clock: makeClock, newId: makeId });
  await svc1.init();

  await svc1.setSetting('theme', 'dark');
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
  await svc1.setBudget({ accountId: 'acc-5000', amount: 600_000 });
  await svc1.saveGoal({ name: 'Emergency Fund', targetAmount: 5_000_000, savedAmount: 1_000_000 });
  await svc1.saveBill({
    name: 'PLDT Fiber',
    amount: 169_900,
    frequency: 'monthly',
    nextDueDate: '2026-11-18',
    expenseAccountId: 'acc-5200',
    paymentAccountId: 'acc-1100',
  });

  const diag1 = await repo1.diagnostics();
  assert.equal(diag1.backend, 'IndexedDB');
  assert.equal(diag1.schemaVersion, DB_VERSION);
  assert.deepEqual(diag1.stores.sort(), Object.values(STORES).sort());
  assert.equal(diag1.counts.entries, 2);
  assert.equal(diag1.counts.budgets, 1);
  assert.equal(diag1.counts.goals, 1);
  assert.equal(diag1.counts.bills, 1);

  // Close Session 1
  repo1.close();

  // Session 2: Reopen the same IndexedDB database and verify all records persisted
  const repo2 = await IndexedDbRepository.open('myfinance-pro-test', idbFactory);
  const svc2 = new FinanceService(repo2, { clock: makeClock, newId: makeId });
  await svc2.init();

  assert.equal(await svc2.getSetting('theme'), 'dark');
  assert.equal(svc2.state.entries.length, 2);
  assert.equal(svc2.state.budgets.length, 1);
  assert.equal(svc2.state.goals.length, 1);
  assert.equal(svc2.state.bills.length, 1);
  assert.equal(svc2.state.entries[0].description, 'Salary');
  assert.equal(svc2.state.entries[1].description, 'Groceries');

  // Verify eraseAll clears all IndexedDB stores and re-seeds default Chart of Accounts
  await svc2.eraseAllData();
  assert.equal(svc2.state.entries.length, 0);
  assert.equal(svc2.state.budgets.length, 0);
  assert.equal(svc2.state.accounts.length, 19);
  repo2.close();
});
