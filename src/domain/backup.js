/**
 * Data portability domain logic:
 * - RFC-4180 CSV generation for transactions, journal lines, and financial statements
 * - Versioned JSON backup creation, schema validation, and duplicate-safe restore planning
 *
 * Pure module (no DOM, no IndexedDB).
 */
import { toDecimalString } from './money.js';
import { validateAccount } from './accounts.js';
import { validateEntry } from './journal.js';
import { validateBudget, validateGoal, validateBill } from './planning.js';
import { ValidationError } from './errors.js';

export const BACKUP_SCHEMA_VERSION = 1;
export const BACKUP_APP_ID = 'myfinance-pro';

/* ==================== 1. CSV EXPORT ==================== */

function escapeCsvCell(value) {
  const raw = value == null ? '' : String(value);
  // Guard against spreadsheet formula injection when a text cell begins with =, +, -, @
  const safe = /^[=+\-@]/.test(raw) && !/^-?\d+(\.\d+)?$/.test(raw) ? `'${raw}` : raw;
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function toCsv(headers, rows) {
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** Export all posted journal entries and their debit/credit lines as CSV. */
export function exportTransactionsCsv(entries, accountsById) {
  const headers = [
    'Entry ID',
    'Date',
    'Kind',
    'Description',
    'Note',
    'Account Code',
    'Account Name',
    'Account Type',
    'Debit (PHP)',
    'Credit (PHP)',
    'Status',
    'Reversed By',
  ];
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  const rows = [];
  for (const e of sorted) {
    for (const line of e.lines) {
      const acc = accountsById.get(line.accountId);
      rows.push([
        e.id,
        e.date,
        e.kind,
        e.description,
        e.note ?? '',
        acc?.code ?? '',
        acc?.name ?? line.accountId,
        acc?.type ?? '',
        toDecimalString(line.debit),
        toDecimalString(line.credit),
        e.reversedById ? 'reversed' : 'posted',
        e.reversedById ?? '',
      ]);
    }
  }
  return toCsv(headers, rows);
}

export function exportTrialBalanceCsv(tb) {
  const headers = ['Account Code', 'Account Name', 'Account Type', 'Debit (PHP)', 'Credit (PHP)'];
  const rows = tb.rows.map((r) => [
    r.account.code,
    r.account.name,
    r.account.type,
    toDecimalString(r.debit),
    toDecimalString(r.credit),
  ]);
  rows.push(['', 'TOTAL', '', toDecimalString(tb.totalDebit), toDecimalString(tb.totalCredit)]);
  return toCsv(headers, rows);
}

export function exportIncomeStatementCsv(is) {
  const headers = ['Section', 'Account Code', 'Account Name', 'Amount (PHP)'];
  const rows = [
    ...is.incomeRows.map((r) => ['Income', r.account.code, r.account.name, toDecimalString(r.amount)]),
    ['Income', '', 'Total Income', toDecimalString(is.totalIncome)],
    ...is.expenseRows.map((r) => ['Expense', r.account.code, r.account.name, toDecimalString(r.amount)]),
    ['Expense', '', 'Total Expenses', toDecimalString(is.totalExpenses)],
    ['Summary', '', 'Net Income', toDecimalString(is.netIncome)],
  ];
  return toCsv(headers, rows);
}

export function exportBalanceSheetCsv(bs) {
  const headers = ['Section', 'Account Code', 'Account Name', 'Balance (PHP)'];
  const rows = [
    ...bs.assetRows.map((r) => ['Assets', r.account.code, r.account.name, toDecimalString(r.amount)]),
    ['Assets', '', 'Total Assets', toDecimalString(bs.totalAssets)],
    ...bs.liabilityRows.map((r) => ['Liabilities', r.account.code, r.account.name, toDecimalString(r.amount)]),
    ['Liabilities', '', 'Total Liabilities', toDecimalString(bs.totalLiabilities)],
    ...bs.equityRows.map((r) => ['Equity', r.account.code, r.account.name, toDecimalString(r.amount)]),
    ['Equity', '', 'Retained Earnings (Net Income)', toDecimalString(bs.retainedEarnings)],
    ['Equity', '', 'Total Equity', toDecimalString(bs.totalEquity)],
    ['Summary', '', 'Total Liabilities + Equity', toDecimalString(bs.totalLiabilitiesAndEquity)],
  ];
  return toCsv(headers, rows);
}

/* ==================== 2. BACKUP & RESTORE ==================== */

/**
 * Deterministic fingerprint for a journal entry so duplicate transactions
 * are detected during import even if their generated UUIDs differ.
 */
export function entryFingerprint(entry) {
  const canonicalLines = [...(entry.lines ?? [])]
    .map((l) => `${l.accountId}:${l.debit}:${l.credit}`)
    .sort()
    .join('|');
  const desc = String(entry.description ?? '').trim().toLowerCase();
  return `${entry.date}::${entry.kind}::${desc}::${canonicalLines}`;
}

export function createBackupPayload(state, { now = new Date() } = {}) {
  const accounts = [...(state.accounts ?? [])];
  const entries = [...(state.entries ?? [])];
  const budgets = [...(state.budgets ?? [])];
  const goals = [...(state.goals ?? [])];
  const bills = [...(state.bills ?? [])];

  return {
    app: BACKUP_APP_ID,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    currency: 'PHP',
    createdAt: now.toISOString(),
    counts: {
      accounts: accounts.length,
      entries: entries.length,
      budgets: budgets.length,
      goals: goals.length,
      bills: bills.length,
    },
    data: {
      accounts,
      entries,
      budgets,
      goals,
      bills,
    },
  };
}

/**
 * Validate an imported backup object and compute the exact records to commit.
 * - `mode: 'merge'` (default): preserves existing data, adds non-duplicate accounts,
 *   and skips duplicate transactions (matching either `id` or `entryFingerprint`).
 * - `mode: 'replace'`: validates the backup as a standalone dataset and replaces all records.
 */
export function validateAndPlanImport(rawPayload, existingState, { mode = 'merge' } = {}) {
  let payload = rawPayload;
  if (typeof rawPayload === 'string') {
    try {
      payload = JSON.parse(rawPayload);
    } catch {
      throw new ValidationError(['Backup file is not valid JSON.']);
    }
  }

  if (!payload || typeof payload !== 'object') {
    throw new ValidationError(['Backup file is empty or malformed.']);
  }
  if (payload.app !== BACKUP_APP_ID) {
    throw new ValidationError(['This file is not a MyFinance Pro backup.']);
  }
  if (!Number.isInteger(payload.schemaVersion) || payload.schemaVersion < 1 || payload.schemaVersion > BACKUP_SCHEMA_VERSION) {
    throw new ValidationError([`Unsupported backup schema version: ${String(payload.schemaVersion)}.`]);
  }
  if (payload.currency && payload.currency !== 'PHP') {
    throw new ValidationError([`Unsupported backup currency: ${payload.currency}. Expected PHP.`]);
  }

  const data = payload.data;
  if (!data || typeof data !== 'object' || !Array.isArray(data.accounts) || !Array.isArray(data.entries)) {
    throw new ValidationError(['Backup is missing required accounts or journal entries arrays.']);
  }

  const incomingAccounts = data.accounts;
  const incomingEntries = data.entries;
  const incomingBudgets = Array.isArray(data.budgets) ? data.budgets : [];
  const incomingGoals = Array.isArray(data.goals) ? data.goals : [];
  const incomingBills = Array.isArray(data.bills) ? data.bills : [];

  const errors = [];

  // Build combined account map for validation
  const mergedAccounts = mode === 'replace' ? [] : [...(existingState.accounts ?? [])];
  const accountsToSave = [];
  const accountIdRemap = new Map();
  let skippedAccounts = 0;

  for (let i = 0; i < incomingAccounts.length; i += 1) {
    const acc = incomingAccounts[i];
    if (!acc || typeof acc.id !== 'string') {
      errors.push(`Account #${i + 1}: missing id.`);
      continue;
    }
    if (mode === 'merge') {
      const existingById = mergedAccounts.find((a) => a.id === acc.id);
      const existingByCode = mergedAccounts.find((a) => a.code === acc.code);
      const existingByNameAndType = mergedAccounts.find(
        (a) => a.type === acc.type && a.name.trim().toLowerCase() === String(acc.name ?? '').trim().toLowerCase(),
      );
      const match = existingById ?? existingByCode ?? existingByNameAndType;
      if (match) {
        accountIdRemap.set(acc.id, match.id);
        skippedAccounts += 1;
        continue;
      }
    }
    const accErrors = validateAccount(acc, mergedAccounts);
    if (accErrors.length) {
      errors.push(`Account "${acc.name ?? acc.id}": ${accErrors.join(' ')}`);
      continue;
    }
    mergedAccounts.push(acc);
    accountsToSave.push(acc);
    accountIdRemap.set(acc.id, acc.id);
  }

  const accountsById = new Map(mergedAccounts.map((a) => [a.id, a]));
  // Ensure archived accounts still validate historical entries during import
  const activeViewById = new Map(
    mergedAccounts.map((a) => [a.id, { ...a, isActive: true }]),
  );

  const existingEntries = mode === 'replace' ? [] : (existingState.entries ?? []);
  const seenEntryIds = new Set(existingEntries.map((e) => e.id));
  const existingFingerprints = new Set(existingEntries.map((e) => entryFingerprint(e)));
  const entriesToSave = [];
  let skippedDuplicateEntries = 0;

  for (let i = 0; i < incomingEntries.length; i += 1) {
    const rawEntry = incomingEntries[i];
    if (!rawEntry || typeof rawEntry.id !== 'string') {
      errors.push(`Entry #${i + 1}: missing id.`);
      continue;
    }
    const remappedLines = Array.isArray(rawEntry.lines)
      ? rawEntry.lines.map((l) => ({
        accountId: accountIdRemap.get(l?.accountId) ?? l?.accountId,
        debit: l?.debit,
        credit: l?.credit,
      }))
      : [];
    const entry = { ...rawEntry, lines: remappedLines };
    const fp = entryFingerprint(entry);

    if (seenEntryIds.has(entry.id) || existingFingerprints.has(fp)) {
      skippedDuplicateEntries += 1;
      continue;
    }

    const v = validateEntry(entry, activeViewById);
    if (!v.ok) {
      errors.push(`Entry "${entry.description ?? entry.id}" (${entry.date}): ${v.errors.join(' ')}`);
      continue;
    }
    seenEntryIds.add(entry.id);
    entriesToSave.push(entry);
  }

  // Budgets
  const existingBudgets = mode === 'replace' ? [] : (existingState.budgets ?? []);
  const seenBudgetAccountIds = new Set(existingBudgets.map((b) => b.accountId));
  const budgetsToSave = [];
  for (const rawB of incomingBudgets) {
    const b = { ...rawB, accountId: accountIdRemap.get(rawB?.accountId) ?? rawB?.accountId };
    if (mode === 'merge' && seenBudgetAccountIds.has(b.accountId)) continue;
    const bErr = validateBudget(b, activeViewById);
    if (bErr.length) {
      errors.push(`Budget: ${bErr.join(' ')}`);
      continue;
    }
    seenBudgetAccountIds.add(b.accountId);
    budgetsToSave.push(b);
  }

  // Savings goals
  const existingGoals = mode === 'replace' ? [] : (existingState.goals ?? []);
  const seenGoalIds = new Set(existingGoals.map((g) => g.id));
  const goalsToSave = [];
  for (const rawG of incomingGoals) {
    const g = {
      ...rawG,
      linkedAccountId: rawG?.linkedAccountId ? (accountIdRemap.get(rawG.linkedAccountId) ?? rawG.linkedAccountId) : null,
    };
    if (mode === 'merge' && seenGoalIds.has(g.id)) continue;
    const gErr = validateGoal(g, activeViewById);
    if (gErr.length) {
      errors.push(`Goal "${g.name ?? ''}": ${gErr.join(' ')}`);
      continue;
    }
    seenGoalIds.add(g.id);
    goalsToSave.push(g);
  }

  // Recurring bills
  const existingBills = mode === 'replace' ? [] : (existingState.bills ?? []);
  const seenBillIds = new Set(existingBills.map((b) => b.id));
  const billsToSave = [];
  for (const rawBill of incomingBills) {
    const b = {
      ...rawBill,
      expenseAccountId: accountIdRemap.get(rawBill?.expenseAccountId) ?? rawBill?.expenseAccountId,
      paymentAccountId: accountIdRemap.get(rawBill?.paymentAccountId) ?? rawBill?.paymentAccountId,
    };
    if (mode === 'merge' && seenBillIds.has(b.id)) continue;
    const billErr = validateBill(b, activeViewById);
    if (billErr.length) {
      errors.push(`Bill "${b.name ?? ''}": ${billErr.join(' ')}`);
      continue;
    }
    seenBillIds.add(b.id);
    billsToSave.push(b);
  }

  if (errors.length) {
    throw new ValidationError(errors);
  }

  return {
    mode,
    accountsToSave,
    entriesToSave,
    budgetsToSave,
    goalsToSave,
    billsToSave,
    summary: {
      accountsAdded: accountsToSave.length,
      accountsSkipped: skippedAccounts,
      entriesAdded: entriesToSave.length,
      entriesSkippedDuplicate: skippedDuplicateEntries,
      budgetsAdded: budgetsToSave.length,
      goalsAdded: goalsToSave.length,
      billsAdded: billsToSave.length,
    },
  };
}

/* ==================== 3. AES-256-GCM ENCRYPTED BACKUPS ==================== */

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function deriveAesGcmKey(passphrase, saltBytes, iterations = 100_000) {
  const enc = new TextEncoder();
  const baseKey = await globalThis.crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return globalThis.crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt a backup payload object using PBKDF2-HMAC-SHA256 (100,000 iterations)
 * and AES-256-GCM authenticated encryption.
 */
export async function encryptBackupPayload(payload, passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 6) {
    throw new ValidationError(['Encryption passphrase must be at least 6 characters.']);
  }
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesGcmKey(passphrase, salt, 100_000);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const cipherBuf = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    app: BACKUP_APP_ID,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    encrypted: true,
    kdf: 'PBKDF2-SHA256',
    iterations: 100_000,
    cipher: 'AES-256-GCM',
    createdAt: payload.createdAt ?? new Date().toISOString(),
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(cipherBuf)),
  };
}

/**
 * Decrypt an AES-256-GCM encrypted backup envelope and return the inner backup payload.
 */
export async function decryptBackupPayload(rawEnvelope, passphrase) {
  let env = rawEnvelope;
  if (typeof rawEnvelope === 'string') {
    try {
      env = JSON.parse(rawEnvelope);
    } catch {
      throw new ValidationError(['Encrypted backup file is not valid JSON.']);
    }
  }
  if (!env || env.app !== BACKUP_APP_ID || env.encrypted !== true) {
    throw new ValidationError(['File is not an encrypted MyFinance Pro backup.']);
  }
  if (typeof passphrase !== 'string' || !passphrase) {
    throw new ValidationError(['Enter the passphrase used to encrypt this backup.']);
  }
  try {
    const salt = base64ToBytes(env.salt);
    const iv = base64ToBytes(env.iv);
    const ciphertext = base64ToBytes(env.ciphertext);
    const key = await deriveAesGcmKey(passphrase, salt, env.iterations || 100_000);
    const plainBuf = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(plainBuf));
  } catch {
    throw new ValidationError(['Decryption failed: incorrect passphrase or corrupted backup file.']);
  }
}
