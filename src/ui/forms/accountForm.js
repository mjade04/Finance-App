/** Add-account bottom sheet (balance-sheet accounts and income/expense categories). */
import { h } from '../dom.js';
import { field, openSheet, select, toast } from '../components.js';
import { parseAmount } from '../../domain/money.js';
import { SUBTYPE_INFO } from '../../domain/accounts.js';

const BALANCE_SHEET_SUBTYPES = [
  'cash', 'bank', 'ewallet', 'investment', 'receivable', 'other_asset',
  'credit_card', 'loan', 'payable', 'other_liability',
];
const ALL_SUBTYPES = [...BALANCE_SHEET_SUBTYPES, 'income', 'expense', 'equity'];

export function openAccountSheet(service, { subtype = 'bank', allowCategories = false } = {}) {
  const pool = allowCategories ? ALL_SUBTYPES : BALANCE_SHEET_SUBTYPES;
  openSheet({
    title: allowCategories ? 'New account or category' : 'New account',
    build(close) {
      const name = h('input', { class: 'input', maxlength: 60, placeholder: 'e.g. BDO Savings, Maya, BPI Card', autocomplete: 'off' });
      const groups = [
        { label: 'Assets', options: pool.filter((s) => SUBTYPE_INFO[s].type === 'asset').map((s) => ({ value: s, label: SUBTYPE_INFO[s].label })) },
        { label: 'Liabilities', options: pool.filter((s) => SUBTYPE_INFO[s].type === 'liability').map((s) => ({ value: s, label: SUBTYPE_INFO[s].label })) },
      ];
      if (allowCategories) {
        groups.push(
          { label: 'Income categories', options: [{ value: 'income', label: 'Income category (4xxx)' }] },
          { label: 'Expense categories', options: [{ value: 'expense', label: 'Expense category (5xxx)' }] },
          { label: 'Equity', options: [{ value: 'equity', label: 'Equity account (3xxx)' }] },
        );
      }
      const type = select(groups, { value: subtype });
      const opening = h('input', { class: 'input', inputmode: 'decimal', placeholder: '0.00', autocomplete: 'off' });
      const date = h('input', { class: 'input', type: 'date', value: service.today() });
      const creditLimitInput = h('input', { class: 'input', inputmode: 'decimal', placeholder: 'e.g. 50000.00', autocomplete: 'off' });
      const statementDayInput = h('input', { class: 'input', type: 'number', min: 1, max: 28, placeholder: 'e.g. 15' });
      const dueDayInput = h('input', { class: 'input', type: 'number', min: 1, max: 28, placeholder: 'e.g. 5' });

      const fName = field({ label: 'Account name', control: name });
      const fType = field({ label: 'Account type', control: type });
      const fOpening = field({
        label: 'Opening balance (₱)',
        control: opening,
        hint: 'For cards and loans, enter the amount currently owed. Posts against Opening Balance Equity (never income).',
      });
      const fDate = field({ label: 'Balance as of', control: date });
      const fCreditLimit = field({ label: 'Credit limit (₱, optional)', control: creditLimitInput });
      const fStatementDay = field({ label: 'Statement day of month (1–28, optional)', control: statementDayInput });
      const fDueDay = field({ label: 'Payment due day of month (1–28, optional)', control: dueDayInput });

      const syncVisibility = () => {
        const sub = type.value;
        const isBS = SUBTYPE_INFO[sub]?.type === 'asset' || SUBTYPE_INFO[sub]?.type === 'liability';
        const isCard = sub === 'credit_card';
        fOpening.hidden = !isBS;
        fDate.hidden = !isBS;
        fCreditLimit.hidden = !isCard;
        fStatementDay.hidden = !isCard;
        fDueDay.hidden = !isCard;
      };
      type.addEventListener('change', syncVisibility);
      syncVisibility();

      const formError = h('p', { class: 'form-error', role: 'alert' });
      const submit = h('button', { class: 'btn btn-block', type: 'submit' }, 'Create account');

      const form = h('form', { class: 'form', novalidate: true },
        fName, fType, fOpening, fDate, fCreditLimit, fStatementDay, fDueDay, formError, submit);

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        formError.textContent = '';
        fOpening.setError(null);
        fCreditLimit.setError(null);
        fName.setError(name.value.trim() ? null : 'Account name is required.');
        if (!name.value.trim()) return;

        let openingBalance = 0;
        if (!fOpening.hidden && opening.value.trim()) {
          try {
            openingBalance = parseAmount(opening.value, { allowNegative: true, allowZero: true });
          } catch (err) {
            fOpening.setError(err.message);
            return;
          }
        }

        let creditLimit = null;
        if (!fCreditLimit.hidden && creditLimitInput.value.trim()) {
          try {
            creditLimit = parseAmount(creditLimitInput.value);
          } catch (err) {
            fCreditLimit.setError(err.message);
            return;
          }
        }

        submit.disabled = true;
        try {
          await service.createAccount({
            name: name.value,
            subtype: type.value,
            openingBalance,
            openingDate: date.value,
            creditLimit,
            statementDay: statementDayInput.value ? Number(statementDayInput.value) : null,
            dueDay: dueDayInput.value ? Number(dueDayInput.value) : null,
          });
          close();
          toast('Account created', { tone: 'success' });
        } catch (err) {
          formError.textContent = err.errors ? err.errors.join(' ') : err.message;
          submit.disabled = false;
        }
      });
      queueMicrotask(() => name.focus());
      return form;
    },
  });
}
