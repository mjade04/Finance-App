# MyFinance Pro — Offline Personal Finance & Double-Entry Accounting

**MyFinance Pro** (`C:\Users\Mjade\.gemini\antigravity\scratch\myfinance-pro`) is an offline-first, mobile-first web prototype designed with strict architectural separation so its financial and accounting domain logic can be migrated directly to a native Android application (**Kotlin + Jetpack Compose + Room SQLite + MVVM**).

> **Important Note on Build Target & Security**:
> This directory (`myfinance-pro`) is an offline-capable Web Prototype using **IndexedDB** and a **Service Worker**, not a compiled Android `.apk`. While it operates completely offline with a strict Content-Security-Policy (`default-src 'self'`) that blocks external network transmissions, a browser-based web prototype does **not** provide the same security guarantees as a native Android application (such as hardware-backed Android Keystore encryption, SQLCipher database encryption, or `BiometricPrompt` authentication).
> *(Note: A companion native Android Gradle project also exists in `C:\Users\Mjade\.gemini\antigravity\scratch\MyFinancePro`.)*

---

## 1. Running the Prototype & Automated Tests

### Start the Local Offline-First Server
```powershell
cd C:\Users\Mjade\.gemini\antigravity\scratch\myfinance-pro
node scripts/serve.mjs
```
Then open `http://127.0.0.1:4173` in a desktop or mobile browser. Once loaded, the Service Worker (`sw.js`) caches all application modules locally so the app works in **airplane mode**.

### Run the Automated Test Suite
```powershell
cd C:\Users\Mjade\.gemini\antigravity\scratch\myfinance-pro
node --test tests/*.test.js
```

---

## 2. Architecture Overview

The codebase is organized into four strictly separated layers:

```text
myfinance-pro/
├── index.html                        # Entry point with strict offline CSP
├── manifest.webmanifest              # Installable Web App Manifest
├── sw.js                             # Offline Service Worker (pre-caches all assets)
├── icons/                            # Self-contained SVG & PNG app icons
├── scripts/
│   ├── serve.mjs                     # Zero-dependency local HTTP server
│   └── make-icons.mjs                # Deterministic icon generator
├── src/
│   ├── domain/                       # PURE FINANCIAL & ACCOUNTING LOGIC (zero DOM / IndexedDB)
│   │   ├── money.js                  # Exact integer centavo arithmetic (₱1.00 = 100 centavos)
│   │   ├── dates.js                  # Local ISO calendar helpers ("YYYY-MM-DD", "YYYY-MM")
│   │   ├── errors.js                 # ValidationError & LedgerError types
│   │   ├── accounts.js               # 5-class Chart of Accounts (1xxx–5xxx) & validation
│   │   ├── journal.js                # Immutable double-entry journal, validation & reversals
│   │   ├── transactions.js           # Builders for Income, Expense, Transfer & Opening Balance
│   │   ├── ledger.js                 # Account balances, Trial Balance & Accounting Equation
│   │   ├── planning.js               # Budgets, Savings Goals, Loans, Credit Cards & Bills
│   │   ├── reports.js                # General Ledger, Income Statement, Balance Sheet, Cash Flow, Net Worth
│   │   ├── dashboard.js              # Pure read-model computation for all 13 Dashboard metrics & 5 charts
│   │   └── backup.js                 # RFC-4180 CSV export & validated JSON backup/restore
│   ├── data/                         # STORAGE ABSTRACTION LAYER
│   │   ├── db.js                     # IndexedDB connection & versioned schema migrations
│   │   └── repository.js             # IndexedDbRepository & MemoryRepository (for unit tests)
│   ├── services/                     # APPLICATION / USE-CASE LAYER
│   │   └── financeService.js         # Coordinates domain rules, atomic repository commits & state subscribers
│   ├── styles/                       # MATERIAL-INSPIRED DESIGN SYSTEM
│   │   ├── tokens.css                # Light & dark theme design tokens
│   │   ├── base.css                  # App bar, bottom navigation, FAB, layout
│   │   └── components.css            # Cards, hero, tiles, tables, charts, sheets, dialogs
│   └── ui/                           # PRESENTATION LAYER
│       ├── app.js                    # Shell, router, bottom navigation & offline indicator
│       ├── dom.js                    # Safe DOM & SVG element builders (never uses innerHTML)
│       ├── components.js             # Reusable Material components, dialogs, bottom sheets, toasts
│       ├── charts.js                 # Responsive SVG bar, line, donut & savings-progress charts
│       ├── icons.js                  # Self-contained 24x24 SVG stroke icons
│       ├── entryView.js              # Journal-entry presentation mapper
│       ├── theme.js / boot-theme.js  # System / Light / Dark theme persistence
│       ├── forms/                    # Account & Transaction bottom-sheet forms
│       └── screens/                  # Dashboard, Transactions, Budgets, Reports, More, Settings & Modules
└── tests/
    ├── money.test.js                 # Exact centavo arithmetic & parsing tests
    ├── journal.test.js               # Double-entry rules, opening balances & reversal tests
    ├── service.test.js               # End-to-end accounting scenarios & persistence tests
    └── planning_reports_backup.test.js # Budgets, loans, credit cards, bills, statements & backup tests
```

---

## 3. Native Android Migration Guide

See [`docs/ANDROID_MIGRATION.md`](docs/ANDROID_MIGRATION.md) for the complete mapping from this prototype to native Android (**Kotlin**, **Jetpack Compose**, **Room with SQLite**, **MVVM**, **Storage Access Framework**, **BiometricPrompt**, and **AES-256-GCM Encrypted Backups**).
