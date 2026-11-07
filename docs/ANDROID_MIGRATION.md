# Native Android Migration Guide (`MyFinance Pro`)

This document specifies how the modular web prototype in `myfinance-pro` maps to a native Android application written in **Kotlin** with **Jetpack Compose**, **Room (SQLite)**, and **MVVM**, and clearly identifies which components can be ported directly versus which must be rewritten using native Android APIs.

---

## 1. Component Reuse vs. Rewrite Matrix

| Layer | Web Prototype (`src/`) | Native Android Target | Migration Strategy |
| :--- | :--- | :--- | :--- |
| **Monetary Math** | `src/domain/money.js` (`centavos` safe integers + `BigInt` parser) | `@JvmInline value class Money(val centavos: Long)` | **Direct 1:1 port**. All arithmetic rules, `BigDecimal`/`Long` string parsing, and basis-point ratio calculations translate directly to Kotlin. |
| **Chart of Accounts** | `src/domain/accounts.js` (1xxx–5xxx codes, normal balance rules) | `AccountEntity`, `AccountType`, `NormalBalance`, `DefaultChartOfAccounts.kt` | **Direct 1:1 port**. Account codes, subtypes, and normal-balance rules are platform-independent. |
| **Double-Entry Engine** | `src/domain/journal.js`, `src/domain/transactions.js`, `src/domain/ledger.js` | `AccountingEngine.kt`, `JournalEntryEntity`, `JournalLineEntity` | **Direct 1:1 port** of business rules, augmented with SQLite `BEFORE UPDATE` / `BEFORE DELETE` triggers in Room to enforce immutability of posted entries at the database level. |
| **Planning & Reports** | `src/domain/planning.js`, `src/domain/reports.js`, `src/domain/dashboard.js` | `FinancialPlanningEngine.kt`, `AccountingEngine.kt` report generators | **Direct 1:1 port**. Pure functions of `(accounts, entries, budgets, goals, bills, today)`. |
| **Data Persistence** | `src/data/db.js`, `src/data/repository.js` (IndexedDB object stores) | **Room SQLite** (`@Database`, `@Entity`, `@Dao`, `@Transaction`) | **Must be rewritten** for Room SQLite with foreign-key constraints (`ON DELETE RESTRICT`), indices on `accountId` and `entryDate`, and versioned Room `Migration` objects. |
| **State & MVVM** | `src/services/financeService.js` (`subscribe` listener pattern) | `FinanceRepository` + `MainFinanceViewModel` (`StateFlow` / `Flow`) | **Rewrite orchestration wrapper** as Kotlin `ViewModel` + `StateFlow` backed by Room reactive `Flow<List<...>>` queries. |
| **User Interface** | `src/ui/**`, `src/styles/**` (DOM + CSS + SVG charts) | **Jetpack Compose (Material 3)** + Compose `Canvas` charts | **Must be rewritten** in Jetpack Compose (`Scaffold`, `NavigationBar`, `ModalBottomSheet`, `LazyColumn`, `Canvas`). |
| **File Access (CSV / Backups)** | Browser `<input type="file">` & Blob download links | **Android Storage Access Framework (SAF)** (`ActivityResultContracts.CreateDocument` / `OpenDocument`) | **Must be rewritten** using SAF `ContentResolver` input/output streams so the app requires zero broad storage permissions. |
| **Biometric & App Lock** | Not enforceable in browser storage | **AndroidX Biometric** (`BiometricPrompt`) + salted PBKDF2-SHA256 PIN | **Must be implemented natively** on Android (`FragmentActivity` + `BiometricPrompt.PromptInfo` + `FLAG_SECURE`). |
| **Encrypted Backups & DB** | Plain JSON in browser download / unencrypted IndexedDB | **Android Keystore** + **AES-256-GCM** (`PBKDF2WithHmacSHA256` key derivation) | **Must be implemented natively** using `javax.crypto.Cipher` (`AES/GCM/NoPadding`) and `SecretKeyFactory` (`PBKDF2WithHmacSHA256`). |

---

## 2. Database Schema Mapping (IndexedDB → Room SQLite)

In IndexedDB (`src/data/db.js`), a `journal_entry` embeds its `lines` array inside a single object store record. When migrating to **Room SQLite**:

1. **`accounts` table (`AccountEntity`)**:
   - Primary key `id: String` (or `Long`), unique index on `code: String`.
2. **`journal_entries` table (`JournalEntryEntity`)**:
   - Primary key `id: String`, indexed by `date` and `kind`, with self-referencing `reversesId` / `reversedById`.
3. **`journal_lines` table (`JournalLineEntity`)**:
   - Normalized child table with foreign keys to `journal_entries(id)` and `accounts(id)` (`ON DELETE RESTRICT`), storing `debitCentavos: Long` and `creditCentavos: Long` with a SQLite `CHECK ((debitCentavos > 0 AND creditCentavos = 0) OR (debitCentavos = 0 AND creditCentavos > 0))` constraint.
4. **`budgets`, `goals`, `bills` tables**:
   - Normalized tables with foreign keys referencing `accounts(id)`.
