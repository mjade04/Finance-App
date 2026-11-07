/**
 * Offline Service Worker for MyFinance Pro.
 * Pre-caches every application asset on install so the app works in
 * airplane mode with zero network requests.
 */
const CACHE_NAME = 'myfinance-pro-v2';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './src/styles/tokens.css',
  './src/styles/base.css',
  './src/styles/components.css',
  './src/data/db.js',
  './src/data/repository.js',
  './src/domain/accounts.js',
  './src/domain/backup.js',
  './src/domain/dashboard.js',
  './src/domain/dates.js',
  './src/domain/errors.js',
  './src/domain/journal.js',
  './src/domain/ledger.js',
  './src/domain/money.js',
  './src/domain/planning.js',
  './src/domain/reports.js',
  './src/domain/transactions.js',
  './src/services/financeService.js',
  './src/ui/app.js',
  './src/ui/boot-theme.js',
  './src/ui/charts.js',
  './src/ui/components.js',
  './src/ui/dom.js',
  './src/ui/entryView.js',
  './src/ui/icons.js',
  './src/ui/theme.js',
  './src/ui/forms/accountForm.js',
  './src/ui/forms/transactionForm.js',
  './src/ui/screens/dashboard.js',
  './src/ui/screens/modules.js',
  './src/ui/screens/more.js',
  './src/ui/screens/reports.js',
  './src/ui/screens/settings.js',
  './src/ui/screens/transactions.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  // Strict same-origin enforcement: never fetch from any external host
  if (url.origin !== self.location.origin) {
    event.respondWith(Response.error());
    return;
  }
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cached) => cached || fetch(event.request)),
  );
});
