/** Reusable UI building blocks (Material-inspired). */
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { formatMoney } from '../domain/money.js';

export function money(value, { colorize = false, sign = false, className = '' } = {}) {
  const tone = colorize ? (value > 0 ? 'pos' : value < 0 ? 'neg' : '') : '';
  return h('span', { class: `num ${tone} ${className}`.trim() },
    formatMoney(value, { signDisplay: sign ? 'always' : 'auto' }));
}

export function card({ title, action, className = '', children = [], id }) {
  return h('section', { class: `card ${className}`.trim(), id, 'aria-label': title ?? null },
    title ? h('header', { class: 'card-head' }, h('h2', { class: 'card-title' }, title), action ?? null) : null,
    children);
}

export function textButton(label, onClick, { iconName } = {}) {
  return h('button', { class: 'btn-text', type: 'button', onClick }, label, iconName ? icon(iconName, { size: 18 }) : null);
}

export function stageBadge(stage) {
  return h('span', { class: 'badge badge-muted' }, `Stage ${stage}`);
}

export function emptyState({ iconName = 'info', title, message, action }) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-icon' }, icon(iconName, { size: 28 })),
    h('p', { class: 'empty-title' }, title),
    message ? h('p', { class: 'empty-msg' }, message) : null,
    action ?? null);
}

export function avatar(iconName, tone = 'neutral') {
  return h('span', { class: `avatar tone-bg-${tone}` }, icon(iconName, { size: 20 }));
}

export function listRow({ iconName, tone, title, subtitle, trailing, onClick, href }) {
  const content = [
    iconName ? avatar(iconName, tone) : null,
    h('span', { class: 'row-text' },
      h('span', { class: 'row-title' }, title),
      subtitle ? h('span', { class: 'row-sub' }, subtitle) : null),
    trailing != null ? h('span', { class: 'row-trailing' }, trailing) : null,
  ];
  if (href) return h('a', { class: 'row row-link', href }, content);
  if (onClick) return h('button', { class: 'row row-link', type: 'button', onClick }, content);
  return h('div', { class: 'row' }, content);
}

export function progressBar(basisPoints, { tone = 'primary', label }) {
  const pct = Math.max(0, Math.min(100, (basisPoints ?? 0) / 100));
  return h('div', {
    class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100,
    'aria-valuenow': Math.round(pct), 'aria-label': label,
  }, h('span', { class: `progress-fill tone-bg-${tone}`, style: { width: `${pct}%` } }));
}

/* ---------- Dialogs, sheets and toasts (native <dialog>) ---------- */

/** @returns {Promise<boolean>} */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'dialog', 'aria-labelledby': 'dlg-title' },
      h('h2', { id: 'dlg-title', class: 'dialog-title' }, title),
      h('p', { class: 'dialog-msg' }, message),
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'btn-text', type: 'button', onClick: () => dialog.close('cancel') }, 'Cancel'),
        h('button', { class: danger ? 'btn btn-danger' : 'btn', type: 'button', onClick: () => dialog.close('ok') }, confirmLabel)));
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'ok');
      dialog.remove();
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

/**
 * Bottom sheet. `build(close)` returns the sheet body.
 */
export function openSheet({ title, build }) {
  const body = h('div', { class: 'sheet-body' });
  const close = () => dialog.close();
  const dialog = h('dialog', { class: 'sheet', 'aria-label': title },
    h('div', { class: 'sheet-handle', 'aria-hidden': 'true' }),
    h('header', { class: 'sheet-head' },
      h('h2', { class: 'sheet-title' }, title),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onClick: close }, icon('close'))),
    body);
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  dialog.addEventListener('close', () => dialog.remove());
  body.append(build(close));
  document.body.append(dialog);
  dialog.showModal();
  return { close, dialog, setBody: (node) => clear(body).append(node) };
}

let toastTimer;
export function toast(message, { tone = 'neutral' } = {}) {
  let host = document.getElementById('toast');
  if (!host) {
    host = h('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  host.textContent = message;
  host.dataset.tone = tone;
  host.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => host.classList.remove('show'), 2800);
}

/* ---------- Form controls ---------- */

export function field({ label, control, error, hint }) {
  const id = control.id || `f-${Math.random().toString(36).slice(2, 9)}`;
  control.id = id;
  const errorEl = h('p', { class: 'field-error', id: `${id}-err`, role: 'alert' }, error ?? '');
  control.setAttribute('aria-describedby', `${id}-err`);
  const wrap = h('div', { class: 'field' },
    h('label', { for: id, class: 'field-label' }, label),
    control,
    hint ? h('p', { class: 'field-hint' }, hint) : null,
    errorEl);
  wrap.setError = (msg) => {
    errorEl.textContent = msg ?? '';
    control.setAttribute('aria-invalid', msg ? 'true' : 'false');
  };
  return wrap;
}

export function select(options, { value, name } = {}) {
  return h('select', { class: 'input', name, value },
    options.map((group) => (group.options
      ? h('optgroup', { label: group.label }, group.options.map((o) => h('option', { value: o.value }, o.label)))
      : h('option', { value: group.value }, group.label))));
}

export function segmented(options, { value, onChange, label }) {
  const wrap = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label });
  const render = (current) => {
    clear(wrap);
    for (const o of options) {
      wrap.append(h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(o.value === current),
        class: o.value === current ? 'seg active' : 'seg',
        onClick: () => { render(o.value); onChange(o.value); },
      }, o.icon ? icon(o.icon, { size: 18 }) : null, o.label));
    }
  };
  render(value);
  return wrap;
}
