/** Add-transaction bottom sheet: Expense / Income / Transfer with live double-entry preview. */
import { h } from '../dom.js';
import { field, openSheet, segmented, select, toast } from '../components.js';
import { parseAmount, formatMoney } from '../../domain/money.js';
import { SUBTYPE_INFO, TYPE_LABELS } from '../../domain/accounts.js';

function accountOptions(accounts, types) {
  return types.map((type) => ({
    label: TYPE_LABELS[type],
    options: accounts.filter((a) => a.type === type && a.isActive !== false)
      .map((a) => ({ value: a.id, label: `${a.name}${a.type === 'asset' || a.type === 'liability' ? ` · ${SUBTYPE_INFO[a.subtype]?.label ?? ''}` : ''}` })),
  })).filter((g) => g.options.length);
}

export function openTransactionSheet(service, { kind = 'expense', defaultAccountId = null } = {}) {
  let current = kind;
  openSheet({
    title: 'New transaction',
    build(close) {
      const { accounts, accountsById } = service.state;
      const container = h('div', { class: 'form-wrap' });

      const renderForm = () => {
        container.replaceChildren(buildForm(current));
      };

      const buildForm = (type) => {
        const amount = h('input', { class: 'input input-amount', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00', name: 'amount' });
        const date = h('input', { class: 'input', type: 'date', value: service.today(), required: true, name: 'date' });
        const description = h('input', { class: 'input', maxlength: 200, placeholder: 'Optional description', name: 'description' });
        const note = h('input', { class: 'input', maxlength: 200, placeholder: 'Optional memo or reference', name: 'note' });

        let primary; let secondary; let primaryLabel; let secondaryLabel;
        if (type === 'expense') {
          primaryLabel = 'Expense category (Debit)';
          primary = select(accountOptions(accounts, ['expense']));
          secondaryLabel = 'Paid from account (Credit)';
          secondary = select(accountOptions(accounts, ['asset', 'liability']), { value: defaultAccountId ?? 'acc-1000' });
        } else if (type === 'income') {
          primaryLabel = 'Income category (Credit)';
          primary = select(accountOptions(accounts, ['income']));
          secondaryLabel = 'Deposit to account (Debit)';
          secondary = select(accountOptions(accounts, ['asset']), { value: defaultAccountId ?? 'acc-1100' });
        } else {
          primaryLabel = 'From source account (Credit)';
          primary = select(accountOptions(accounts, ['asset', 'liability']), { value: defaultAccountId ?? 'acc-1100' });
          secondaryLabel = 'To destination account (Debit)';
          secondary = select(accountOptions(accounts, ['asset', 'liability']), { value: defaultAccountId === 'acc-1200' ? 'acc-1100' : 'acc-1200' });
        }

        const journalPreview = h('p', { class: 'notice', style: { marginTop: '6px', marginBottom: '4px' } });
        const updatePreview = () => {
          let amtText = '₱0.00';
          try {
            amtText = formatMoney(parseAmount(amount.value));
          } catch {
            // keep placeholder when empty/invalid
          }
          const pName = accountsById.get(primary.value)?.name ?? '';
          const sName = accountsById.get(secondary.value)?.name ?? '';
          if (type === 'expense') {
            journalPreview.textContent = `Double-entry: Dr ${pName} ${amtText} / Cr ${sName} ${amtText}`;
          } else if (type === 'income') {
            journalPreview.textContent = `Double-entry: Dr ${sName} ${amtText} / Cr ${pName} ${amtText}`;
          } else {
            journalPreview.textContent = `Double-entry: Dr ${sName} ${amtText} / Cr ${pName} ${amtText}`;
          }
        };
        amount.addEventListener('input', updatePreview);
        primary.addEventListener('change', updatePreview);
        secondary.addEventListener('change', updatePreview);
        updatePreview();

        const fAmount = field({ label: 'Amount (₱)', control: amount });
        const fDate = field({ label: 'Date', control: date });
        const fPrimary = field({ label: primaryLabel, control: primary });
        const fSecondary = field({
          label: secondaryLabel,
          control: secondary,
          hint: type === 'transfer' ? 'Transfers, loan proceeds and credit-card payments are not income or expenses.' : null,
        });
        const fDesc = field({ label: 'Description', control: description });
        const fNote = field({ label: 'Note', control: note });
        const formError = h('p', { class: 'form-error', role: 'alert' });
        const submit = h('button', { class: 'btn btn-block', type: 'submit' }, `Save ${type}`);

        const form = h('form', { class: 'form', novalidate: true },
          fAmount, fPrimary, fSecondary, fDate, fDesc, fNote, journalPreview, formError, submit);

        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          formError.textContent = '';
          fAmount.setError(null);
          let cents;
          try {
            cents = parseAmount(amount.value);
          } catch (err) {
            fAmount.setError(err.message);
            amount.focus();
            return;
          }
          const common = { date: date.value, amount: cents, description: description.value, note: note.value };
          submit.disabled = true;
          try {
            if (type === 'expense') await service.recordExpense({ ...common, expenseAccountId: primary.value, paymentAccountId: secondary.value });
            else if (type === 'income') await service.recordIncome({ ...common, incomeAccountId: primary.value, depositAccountId: secondary.value });
            else await service.recordTransfer({ ...common, fromAccountId: primary.value, toAccountId: secondary.value });
            close();
            toast(`${type[0].toUpperCase()}${type.slice(1)} of ${formatMoney(cents)} saved`, { tone: 'success' });
          } catch (err) {
            formError.textContent = err.errors ? err.errors.join(' ') : err.message;
            submit.disabled = false;
          }
        });
        queueMicrotask(() => amount.focus());
        return form;
      };

      const tabs = segmented([
        { value: 'expense', label: 'Expense', icon: 'arrowUp' },
        { value: 'income', label: 'Income', icon: 'arrowDown' },
        { value: 'transfer', label: 'Transfer', icon: 'transfer' },
      ], { value: current, label: 'Transaction type', onChange: (v) => { current = v; renderForm(); } });

      renderForm();
      return h('div', {}, tabs, container);
    },
  });
}
