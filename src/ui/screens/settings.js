/** Settings: theme, storage status, data tools, privacy statement, data erase. */
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { card, confirmDialog, listRow, segmented, toast } from '../components.js';
import { applyTheme, getThemePreference } from '../theme.js';

export function renderSettings({ service }) {
  const storageStatus = h('span', { class: 'muted small' }, 'Checking…');
  (async () => {
    try {
      const persisted = await navigator.storage?.persisted?.();
      const estimate = await navigator.storage?.estimate?.();
      const used = estimate ? `${Math.ceil((estimate.usage ?? 0) / 1024)} KB used` : '';
      storageStatus.textContent = `${persisted ? 'Persistent' : 'Best-effort (browser may evict under storage pressure)'}${used ? ` · ${used}` : ''}`;
    } catch {
      storageStatus.textContent = 'Unknown';
    }
  })();

  const theme = segmented([
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light', icon: 'sun' },
    { value: 'dark', label: 'Dark', icon: 'moon' },
  ], {
    value: getThemePreference(), label: 'Theme',
    onChange: async (value) => { applyTheme(value); await service.setSetting('theme', value); },
  });

  const requestPersist = h('button', {
    class: 'btn btn-tonal', type: 'button',
    onClick: async () => {
      const granted = await navigator.storage?.persist?.();
      toast(granted ? 'Persistent storage granted' : 'Browser declined persistent storage. Install the app to improve this.');
    },
  }, 'Request persistent storage');

  const erase = h('button', {
    class: 'btn btn-danger-tonal btn-block', type: 'button',
    onClick: async () => {
      const ok = await confirmDialog({
        title: 'Erase all data?',
        message: 'This permanently deletes every account, transaction, budget, savings goal, and bill stored on this device. Export a JSON backup first if you may want to restore later.',
        confirmLabel: 'Erase everything', danger: true,
      });
      if (!ok) return;
      await service.eraseAllData();
      toast('All data erased');
    },
  }, 'Erase all data');

  return h('div', { class: 'stack' },
    card({ title: 'Appearance', children: [theme] }),
    card({ title: 'Currency', children: [listRow({ iconName: 'peso', tone: 'neutral', title: 'Philippine Peso (PHP, ₱)', subtitle: 'Amounts stored as exact integer centavos (1 PHP = 100 centavos)' })] }),
    card({ title: 'Storage & portability', children: [
      listRow({ iconName: 'layers', tone: 'neutral', title: 'IndexedDB on this device', subtitle: storageStatus }),
      requestPersist,
      h('div', { class: 'rows', style: { marginTop: '8px' } },
        listRow({ href: '#/module/export', iconName: 'download', tone: 'primary', title: 'CSV export', subtitle: 'Transactions and accounting statements', trailing: icon('chevronRight', { size: 18 }) }),
        listRow({ href: '#/module/backup', iconName: 'upload', tone: 'transfer', title: 'Backup & restore', subtitle: 'Validated JSON backups with duplicate detection', trailing: icon('chevronRight', { size: 18 }) })),
    ] }),
    card({ title: 'Privacy & security', children: [
      h('p', { class: 'notice' }, icon('wifiOff', { size: 16 }), 'No accounts, cloud sync, analytics or ads. A strict Content-Security-Policy blocks network requests to any external origin.'),
      h('p', { class: 'notice warn' }, icon('alert', { size: 16 }),
        'Web-prototype security notice: IndexedDB records are stored unencrypted in the browser profile and do not have hardware-backed biometric protection. Native Android migration (Room + SQLCipher/Android Keystore + BiometricPrompt) is required for hardware-enforced encryption and biometric lock.'),
    ] }),
    card({ title: 'Danger zone', children: [erase] }));
}
