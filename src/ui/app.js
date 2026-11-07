/**
 * App bootstrap + hash router + shell (app bar, bottom navigation, FAB).
 * Composition root: the only place that knows about IndexedDB, the service and the UI together.
 */
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { emptyState } from './components.js';
import { applyTheme } from './theme.js';
import { IndexedDbRepository } from '../data/repository.js';
import { FinanceService } from '../services/financeService.js';
import { renderDashboard } from './screens/dashboard.js';
import { renderTransactions } from './screens/transactions.js';
import { renderReports, renderReportDetail, reportTitle } from './screens/reports.js';
import { renderMore, renderAccounts, renderChartOfAccounts, renderBudgets, renderModule, moduleTitle } from './screens/more.js';
import { renderSettings } from './screens/settings.js';
import { openTransactionSheet } from './forms/transactionForm.js';

const TABS = [
  { path: 'dashboard', label: 'Dashboard', icon: 'home' },
  { path: 'transactions', label: 'Transactions', icon: 'list' },
  { path: 'budgets', label: 'Budgets', icon: 'pie' },
  { path: 'reports', label: 'Reports', icon: 'chart' },
  { path: 'more', label: 'More', icon: 'grid' },
];

/** path -> { title, render, tab (highlighted nav item), fab } */
const ROUTES = {
  dashboard: { title: 'MyFinance Pro', render: renderDashboard, tab: 'dashboard', fab: true },
  transactions: { title: 'Transactions', render: renderTransactions, tab: 'transactions', fab: true },
  budgets: { title: 'Budgets', render: renderBudgets, tab: 'budgets' },
  reports: { title: 'Reports', render: renderReports, tab: 'reports' },
  report: { title: (p) => reportTitle(p.key), render: renderReportDetail, tab: 'reports', back: 'reports' },
  more: { title: 'More', render: renderMore, tab: 'more' },
  accounts: { title: 'Accounts', render: renderAccounts, tab: 'more', back: 'more' },
  'chart-of-accounts': { title: 'Chart of accounts', render: renderChartOfAccounts, tab: 'more', back: 'more' },
  settings: { title: 'Settings', render: renderSettings, tab: 'more', back: 'more' },
  module: { title: (p) => moduleTitle(p.key), render: renderModule, tab: 'more', back: 'more' },
};

function parseHash() {
  const [path = 'dashboard', key] = location.hash.replace(/^#\/?/, '').split('/');
  return { path: ROUTES[path] ? path : 'dashboard', params: { key } };
}

function buildShell() {
  const title = h('h1', { class: 'app-title', id: 'app-title' });
  const back = h('a', { class: 'icon-btn', id: 'back-btn', 'aria-label': 'Back', hidden: true }, icon('back'));
  const nav = h('nav', { class: 'bottom-nav', 'aria-label': 'Primary' }, TABS.map((t) => h('a', {
    href: `#/${t.path}`, class: 'nav-item', dataset: { tab: t.path },
  }, h('span', { class: 'nav-pill' }, icon(t.icon)), h('span', { class: 'nav-label' }, t.label))));
  const fab = h('button', { class: 'fab', type: 'button', 'aria-label': 'Add transaction', hidden: true }, icon('plus', { size: 26 }));
  const view = h('main', { class: 'view', id: 'view', tabindex: '-1' });
  const offline = h('span', { class: 'offline-chip', id: 'offline-chip', hidden: true }, icon('wifiOff', { size: 14 }), 'Offline');
  const themeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Toggle light/dark theme' }, icon('moon', { size: 20 }));
  const appBar = h('header', { class: 'app-bar' }, back, title, offline, themeBtn);
  const root = document.getElementById('app');
  clear(root).append(appBar, view, fab, nav);
  return { title, back, nav, fab, view, offline, themeBtn };
}

async function main() {
  applyTheme();
  const shell = buildShell();

  let service;
  try {
    const repo = await IndexedDbRepository.open();
    service = new FinanceService(repo);
    await service.init();
    const savedTheme = await service.getSetting('theme');
    if (savedTheme) applyTheme(savedTheme);
    navigator.storage?.persist?.().catch(() => {});
  } catch (err) {
    console.error(err);
    shell.view.replaceChildren(emptyState({ iconName: 'alert', title: 'Local storage unavailable', message: `${err.message} Private-browsing modes may block IndexedDB.` }));
    return;
  }

  const syncThemeIcon = () => {
    const isDark = document.documentElement.dataset.theme === 'dark';
    clear(shell.themeBtn).append(icon(isDark ? 'sun' : 'moon', { size: 20 }));
  };
  syncThemeIcon();
  shell.themeBtn.addEventListener('click', async () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    syncThemeIcon();
    await service.setSetting('theme', next);
  });

  shell.fab.addEventListener('click', () => openTransactionSheet(service));

  let lastPath = null;
  const render = () => {
    const { path, params } = parseHash();
    const route = ROUTES[path];
    const titleText = typeof route.title === 'function' ? route.title(params) : route.title;
    shell.title.textContent = titleText;
    document.title = path === 'dashboard' ? 'MyFinance Pro' : `${titleText} · MyFinance Pro`;
    shell.back.hidden = !route.back;
    if (route.back) shell.back.setAttribute('href', `#/${route.back}`);
    shell.fab.hidden = !route.fab;
    for (const a of shell.nav.querySelectorAll('.nav-item')) {
      const active = a.dataset.tab === route.tab;
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
    const scroll = path === lastPath ? window.scrollY : 0;
    try {
      shell.view.replaceChildren(route.render({ service, params }));
    } catch (err) {
      console.error(err);
      shell.view.replaceChildren(emptyState({ iconName: 'alert', title: 'Something went wrong', message: err.message }));
    }
    window.scrollTo(0, scroll);
    if (path !== lastPath) shell.view.focus({ preventScroll: true });
    lastPath = path;
  };

  window.addEventListener('hashchange', render);
  service.subscribe(render);
  render();

  const updateOnline = () => { shell.offline.hidden = navigator.onLine; };
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  updateOnline();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker registration failed', err));
  }
}

main();
