/**
 * Functional modules accessible from the Bottom Navigation (Budgets) and More hub:
 * - Budgets (Module 6)
 * - Savings goals (Module 7)
 * - Debt and loans (Module 8)
 * - Credit cards (Module 9)
 * - Recurring bills (Module 10)
 * - General ledger (Module 14)
 * - Journal entries (Module 15)
 * - CSV export (Module 22)
 * - Backup & restore (Module 23)
 */
import { h } from '../dom.js';
import { icon } from '../icons.js';
import {
  card,
  confirmDialog,
  emptyState,
  field,
  listRow,
  money,
  openSheet,
  progressBar,
  segmented,
  select,
  textButton,
  toast,
} from '../components.js';
import { savingsChart } from '../charts.js';
import { add, formatBasisPoints, formatMoney, parseAmount, subtract, toDecimalString } from '../../domain/money.js';
import { formatDisplayDate, monthKeyOf, monthLongLabel, monthRange } from '../../domain/dates.js';
import { SUBTYPE_INFO, TYPE_LABELS } from '../../domain/accounts.js';
import { creditLine, debitLine } from '../../domain/journal.js';
import {
  BILL_FREQUENCIES,
  computeBillsStatus,
  computeBudgetPerformance,
  computeDebtReport,
  computeGoalsProgress,
} from '../../domain/planning.js';
import {
  balanceSheet,
  generalLedger,
  incomeStatement,
  trialBalance,
} from '../../domain/reports.js';
import {
  decryptBackupPayload,
  encryptBackupPayload,
  exportBalanceSheetCsv,
  exportIncomeStatementCsv,
  exportTransactionsCsv,
  exportTrialBalanceCsv,
} from '../../domain/backup.js';
import { openAccountSheet } from '../forms/accountForm.js';
import { openTransactionSheet } from '../forms/transactionForm.js';
import { openEntrySheet } from './transactions.js';

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ==================== MODULE 6: BUDGETS ==================== */

export function renderBudgets({ service }) {
  const { accounts, entries, budgets } = service.state;
  const currentMonth = monthKeyOf(service.today());
  const perf = computeBudgetPerformance(budgets, accounts, entries, currentMonth);

  const openBudgetSheet = (existing = null) => {
    openSheet({
      title: existing ? `Edit budget · ${existing.accountName}` : 'Set monthly budget',
      build(close) {
        const expenseAccounts = accounts.filter((a) => a.type === 'expense' && a.isActive !== false);
        const catSelect = select(
          expenseAccounts.map((a) => ({ value: a.id, label: a.name })),
          { value: existing?.accountId ?? expenseAccounts[0]?.id },
        );
        if (existing) catSelect.disabled = true;
        const amountInput = h('input', {
          class: 'input input-amount',
          inputmode: 'decimal',
          placeholder: '0.00',
          value: existing ? toDecimalString(existing.limit) : '',
        });
        const fCat = field({ label: 'Expense category', control: catSelect });
        const fAmount = field({ label: 'Monthly limit (₱)', control: amountInput });
        const formError = h('p', { class: 'form-error', role: 'alert' });
        const submit = h('button', { class: 'btn btn-block', type: 'submit' }, 'Save budget');
        const delBtn = existing
          ? h('button', {
            class: 'btn btn-danger-tonal btn-block',
            type: 'button',
            onClick: async () => {
              await service.deleteBudget(existing.id);
              close();
              toast('Budget removed');
            },
          }, 'Remove budget')
          : null;

        const form = h('form', { class: 'form', novalidate: true }, fCat, fAmount, formError, submit, delBtn);
        form.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          fAmount.setError(null);
          formError.textContent = '';
          let cents;
          try {
            cents = parseAmount(amountInput.value);
          } catch (err) {
            fAmount.setError(err.message);
            return;
          }
          try {
            await service.setBudget({ accountId: catSelect.value, amount: cents });
            close();
            toast('Monthly budget saved', { tone: 'success' });
          } catch (err) {
            formError.textContent = err.message;
          }
        });
        queueMicrotask(() => amountInput.focus());
        return form;
      },
    });
  };

  const summaryCard = card({
    title: `${monthLongLabel(currentMonth)} budgets`,
    action: textButton('Set budget', () => openBudgetSheet(), { iconName: 'plus' }),
    children: [
      h('div', { class: 'kpis' },
        h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, 'Total budget'), money(perf.totalLimit, { className: 'kpi-value' })),
        h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, 'Spent'), money(perf.totalSpent, { className: 'kpi-value' })),
        h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, 'Remaining'), money(perf.totalRemaining, { className: 'kpi-value', colorize: true }))),
      perf.totalLimit > 0
        ? progressBar(perf.utilizationBp ?? 0, {
          tone: (perf.utilizationBp ?? 0) >= 10000 ? 'expense' : (perf.utilizationBp ?? 0) >= 8000 ? 'c3' : 'primary',
          label: 'Total budget utilization',
        })
        : null,
      perf.unbudgetedSpent > 0
        ? h('p', { class: 'muted small', style: { marginTop: '8px' } },
          'Unbudgeted category spending this month: ', money(perf.unbudgetedSpent))
        : null,
    ],
  });

  if (perf.rows.length === 0) {
    return h('div', { class: 'stack' },
      summaryCard,
      card({
        children: [emptyState({
          iconName: 'pie',
          title: 'No category budgets yet',
          message: 'Set monthly spending limits on your expense categories. Actual spending is computed directly from your posted expense journal entries.',
          action: h('button', { class: 'btn', type: 'button', onClick: () => openBudgetSheet() }, icon('plus', { size: 18 }), 'Set first budget'),
        })],
      }));
  }

  return h('div', { class: 'stack' },
    summaryCard,
    card({
      title: 'Category budgets',
      children: [h('div', { class: 'stack-sm' }, perf.rows.map((r) => {
        const tone = r.status === 'over' ? 'expense' : r.status === 'warn' ? 'c3' : 'primary';
        return h('div', { class: 'budget-item', onClick: () => openBudgetSheet(r) },
          listRow({
            iconName: r.icon,
            tone: r.status === 'over' ? 'expense' : 'neutral',
            title: r.accountName,
            subtitle: `${formatMoney(r.spent)} of ${formatMoney(r.limit)} (${formatBasisPoints(r.utilizationBp)})`,
            trailing: h('span', { class: `num ${r.remaining < 0 ? 'neg' : 'pos'}` },
              r.remaining < 0 ? `${formatMoney(-r.remaining)} over` : `${formatMoney(r.remaining)} left`),
          }),
          progressBar(r.utilizationBp, { tone, label: `${r.accountName} budget utilization` }));
      }))],
    }));
}

/* ==================== MODULE 7: SAVINGS GOALS ==================== */

export function renderSavingsGoals({ service }) {
  const { accounts, entries, goals } = service.state;
  const prog = computeGoalsProgress(goals, accounts, entries, service.today());
  const assetAccounts = accounts.filter((a) => a.type === 'asset' && a.isActive !== false);

  const openGoalSheet = (existing = null) => {
    openSheet({
      title: existing ? 'Edit savings goal' : 'New savings goal',
      build(close) {
        const name = h('input', { class: 'input', maxlength: 60, placeholder: 'e.g. Emergency Fund, Laptop', value: existing?.name ?? '' });
        const target = h('input', { class: 'input input-amount', inputmode: 'decimal', placeholder: '50000.00', value: existing ? toDecimalString(existing.targetAmount) : '' });
        const saved = h('input', { class: 'input', inputmode: 'decimal', placeholder: '0.00', value: existing ? toDecimalString(existing.savedAmount ?? 0) : '0.00' });
        const targetDate = h('input', { class: 'input', type: 'date', value: existing?.targetDate ?? '' });
        const linked = select([
          { value: '', label: 'Track via manual/transfer contributions' },
          ...assetAccounts.map((a) => ({ value: a.id, label: `Mirror balance of ${a.name}` })),
        ], { value: existing?.useAccountBalance && existing?.linkedAccountId ? existing.linkedAccountId : '' });

        const fName = field({ label: 'Goal name', control: name });
        const fTarget = field({ label: 'Target amount (₱)', control: target });
        const fSaved = field({ label: 'Already saved (₱)', control: saved });
        const fDate = field({ label: 'Target date (optional)', control: targetDate });
        const fLinked = field({ label: 'Tracking mode', control: linked });
        const formError = h('p', { class: 'form-error', role: 'alert' });
        const submit = h('button', { class: 'btn btn-block', type: 'submit' }, 'Save goal');

        const form = h('form', { class: 'form', novalidate: true }, fName, fTarget, fLinked, fSaved, fDate, formError, submit);
        form.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          formError.textContent = '';
          let targetCents;
          let savedCents = 0;
          try {
            targetCents = parseAmount(target.value);
            if (saved.value.trim()) savedCents = parseAmount(saved.value, { allowZero: true });
          } catch (err) {
            formError.textContent = err.message;
            return;
          }
          try {
            await service.saveGoal({
              id: existing?.id,
              name: name.value,
              targetAmount: targetCents,
              savedAmount: savedCents,
              targetDate: targetDate.value,
              linkedAccountId: linked.value || null,
              useAccountBalance: Boolean(linked.value),
            });
            close();
            toast('Savings goal saved', { tone: 'success' });
          } catch (err) {
            formError.textContent = err.message;
          }
        });
        return form;
      },
    });
  };

  const openContributeSheet = (goal) => {
    openSheet({
      title: `Contribute · ${goal.name}`,
      build(close) {
        const amount = h('input', { class: 'input input-amount', inputmode: 'decimal', placeholder: '0.00' });
        const fromAcc = select([
          { value: '', label: 'Earmark only (no account transfer)' },
          ...assetAccounts.map((a) => ({ value: a.id, label: `Transfer from ${a.name}` })),
        ]);
        const toAcc = select(assetAccounts.map((a) => ({ value: a.id, label: a.name })), { value: goal.linkedAccountId || assetAccounts[1]?.id || assetAccounts[0]?.id });
        const date = h('input', { class: 'input', type: 'date', value: service.today() });

        const fAmount = field({ label: 'Contribution amount (₱)', control: amount });
        const fFrom = field({ label: 'Source account (optional transfer)', control: fromAcc });
        const fTo = field({ label: 'Destination savings account', control: toAcc });
        const fDate = field({ label: 'Date', control: date });
        const formError = h('p', { class: 'form-error', role: 'alert' });
        const submit = h('button', { class: 'btn btn-block', type: 'submit' }, 'Record contribution');

        const form = h('form', { class: 'form', novalidate: true }, fAmount, fFrom, fTo, fDate, formError, submit);
        form.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          formError.textContent = '';
          let cents;
          try {
            cents = parseAmount(amount.value);
          } catch (err) {
            formError.textContent = err.message;
            return;
          }
          try {
            await service.contributeToGoal(goal.id, {
              amount: cents,
              fromAccountId: fromAcc.value || null,
              toAccountId: fromAcc.value ? toAcc.value : null,
              date: date.value,
            });
            close();
            toast('Contribution recorded', { tone: 'success' });
          } catch (err) {
            formError.textContent = err.message;
          }
        });
        return form;
      },
    });
  };

  const addBtn = h('button', { class: 'btn btn-block', type: 'button', onClick: () => openGoalSheet() }, icon('plus', { size: 18 }), 'New savings goal');

  if (prog.items.length === 0) {
    return h('div', { class: 'stack' },
      addBtn,
      card({
        children: [emptyState({
          iconName: 'target',
          title: 'No savings goals yet',
          message: 'Define savings targets, link them to bank or e-wallet accounts, or record contributions over time.',
        })],
      }));
  }

  return h('div', { class: 'stack' },
    card({
      title: 'Overall savings progress',
      children: [
        h('div', { class: 'kpis' },
          h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, 'Saved'), money(prog.totalSaved, { className: 'kpi-value' })),
          h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, 'Target'), money(prog.totalTarget, { className: 'kpi-value' })),
          h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, 'Progress'), h('span', { class: 'kpi-value num' }, formatBasisPoints(prog.progressBp)))),
        savingsChart({ items: prog.items, ariaLabel: 'Savings progress by goal' }),
      ],
    }),
    addBtn,
    ...prog.items.map((g) => card({
      title: g.name,
      action: textButton('Edit', () => openGoalSheet(g)),
      children: [
        h('p', { class: 'muted small' },
          `${formatMoney(g.currentAmount)} of ${formatMoney(g.targetAmount)} (${formatBasisPoints(g.progressBp)})`,
          g.targetDate ? ` · Target ${formatDisplayDate(g.targetDate)}` : '',
          g.linkedAccountName ? ` · Linked to ${g.linkedAccountName}` : ''),
        progressBar(g.progressBp, { tone: g.completed ? 'income' : 'primary', label: g.name }),
        h('div', { class: 'empty-actions', style: { justifyContent: 'flex-start', marginTop: '10px' } },
          !g.useAccountBalance
            ? h('button', { class: 'btn btn-tonal', type: 'button', onClick: () => openContributeSheet(g) }, icon('plus', { size: 16 }), 'Add contribution')
            : null,
          h('button', {
            class: 'btn-text',
            type: 'button',
            onClick: async () => {
              const ok = await confirmDialog({ title: `Delete "${g.name}"?`, message: 'This removes the savings goal tracker (your account balances are untouched).', danger: true });
              if (ok) { await service.deleteGoal(g.id); toast('Goal deleted'); }
            },
          }, 'Delete')),
      ],
    })));
}

/* ==================== MODULE 8: DEBTS & LOANS ==================== */

export function renderDebtsAndLoans({ service }) {
  const { accounts, entries } = service.state;
  const report = computeDebtReport(accounts, entries, { asOf: service.today() });
  const loanItems = report.items.filter((i) => i.subtype !== 'credit_card');
  const assetAccounts = accounts.filter((a) => a.type === 'asset' && a.isActive !== false);
  const loanAccounts = accounts.filter((a) => a.type === 'liability' && a.subtype !== 'credit_card' && a.isActive !== false);
  const expenseAccounts = accounts.filter((a) => a.type === 'expense' && a.isActive !== false);

  const openBorrowSheet = () => {
    openSheet({
      title: 'Record borrowed loan proceeds',
      build(close) {
        const loanSel = select(loanAccounts.map((a) => ({ value: a.id, label: a.name })));
        const depSel = select(assetAccounts.map((a) => ({ value: a.id, label: a.name })), { value: 'acc-1100' });
        const amount = h('input', { class: 'input input-amount', inputmode: 'decimal', placeholder: '0.00' });
        const date = h('input', { class: 'input', type: 'date', value: service.today() });
        const desc = h('input', { class: 'input', placeholder: 'e.g. Personal loan disbursement' });
        const formError = h('p', { class: 'form-error', role: 'alert' });
        const submit = h('button', { class: 'btn btn-block', type: 'submit' }, 'Post loan proceeds');

        const form = h('form', { class: 'form', novalidate: true },
          field({ label: 'Amount borrowed (₱)', control: amount, hint: 'Accounting rule: Borrowed money is recorded as a Liability (Dr Asset / Cr Loan), never as Income.' }),
          field({ label: 'Loan / liability account', control: loanSel }),
          field({ label: 'Deposited into (asset account)', control: depSel }),
          field({ label: 'Date', control: date }),
          field({ label: 'Description', control: desc }),
          formError,
          submit);

        form.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          formError.textContent = '';
          try {
            const cents = parseAmount(amount.value);
            await service.recordLoanProceeds({
              date: date.value,
              loanAccountId: loanSel.value,
              depositAccountId: depSel.value,
              amount: cents,
              description: desc.value,
            });
            close();
            toast('Loan proceeds recorded', { tone: 'success' });
          } catch (err) {
            formError.textContent = err.message;
          }
        });
        return form;
      },
    });
  };

  const openRepaySheet = (defaultLoanId) => {
    openSheet({
      title: 'Record loan repayment',
      build(close) {
        const loanSel = select(loanAccounts.map((a) => ({ value: a.id, label: a.name })), { value: defaultLoanId });
        const paySel = select(assetAccounts.map((a) => ({ value: a.id, label: a.name })), { value: 'acc-1100' });
        const intSel = select(expenseAccounts.map((a) => ({ value: a.id, label: a.name })), { value: 'acc-5800' });
        const principal = h('input', { class: 'input input-amount', inputmode: 'decimal', placeholder: '0.00' });
        const interest = h('input', { class: 'input', inputmode: 'decimal', placeholder: '0.00', value: '0.00' });
        const date = h('input', { class: 'input', type: 'date', value: service.today() });
        const desc = h('input', { class: 'input', placeholder: 'Optional description' });
        const formError = h('p', { class: 'form-error', role: 'alert' });
        const submit = h('button', { class: 'btn btn-block', type: 'submit' }, 'Post loan payment');

        const form = h('form', { class: 'form', novalidate: true },
          field({ label: 'Principal repaid (₱, reduces loan liability)', control: principal }),
          field({ label: 'Interest & fees (₱, recorded as expense)', control: interest }),
          field({ label: 'Loan account', control: loanSel }),
          field({ label: 'Paid from (asset account)', control: paySel }),
          field({ label: 'Interest expense category', control: intSel }),
          field({ label: 'Date', control: date }),
          field({ label: 'Description', control: desc }),
          formError,
          submit);

        form.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          formError.textContent = '';
          try {
            const pCents = parseAmount(principal.value);
            const iCents = interest.value.trim() ? parseAmount(interest.value, { allowZero: true }) : 0;
            await service.recordLoanPayment({
              date: date.value,
              loanAccountId: loanSel.value,
              paymentAccountId: paySel.value,
              interestAccountId: intSel.value,
              principalAmount: pCents,
              interestAmount: iCents,
              description: desc.value,
            });
            close();
            toast('Loan payment posted', { tone: 'success' });
          } catch (err) {
            formError.textContent = err.message;
          }
        });
        return form;
      },
    });
  };

  return h('div', { class: 'stack' },
    h('p', { class: 'notice' }, icon('info', { size: 16 }),
      'Borrowed funds increase both an Asset and a Liability (never Income). Loan repayments split Principal (liability reduction) from Interest (expense).'),
    h('div', { class: 'empty-actions' },
      h('button', { class: 'btn btn-tonal', type: 'button', onClick: () => openAccountSheet(service, { subtype: 'loan' }) }, icon('plus', { size: 18 }), 'Add loan account'),
      loanAccounts.length ? h('button', { class: 'btn btn-tonal', type: 'button', onClick: openBorrowSheet }, 'Borrow proceeds') : null,
      loanAccounts.length ? h('button', { class: 'btn', type: 'button', onClick: () => openRepaySheet(loanAccounts[0].id) }, 'Repay loan') : null),
    loanItems.length === 0
      ? card({
        children: [emptyState({
          iconName: 'trendDown',
          title: 'No loans or payables yet',
          message: 'Add a Loan or Payable account to track borrowed principal, repayments, and remaining balance.',
        })],
      })
      : card({
        title: 'Loans & payables',
        children: [h('div', { class: 'stack-sm' }, loanItems.map((item) => h('div', { class: 'budget-item' },
          listRow({
            iconName: item.account.icon,
            tone: 'expense',
            title: item.account.name,
            subtitle: `Borrowed ${formatMoney(item.charged)} · Repaid ${formatMoney(item.repaid)} (${formatBasisPoints(item.payoffBp)})`,
            trailing: money(item.balance),
            onClick: () => openRepaySheet(item.account.id),
          }),
          progressBar(item.payoffBp, { tone: 'income', label: `${item.account.name} payoff progress` }))))],
      }));
}

/* ==================== MODULE 9: CREDIT CARDS ==================== */

export function renderCreditCards({ service }) {
  const { accounts, entries } = service.state;
  const report = computeDebtReport(accounts, entries, { asOf: service.today() });
  const cards = report.items.filter((i) => i.subtype === 'credit_card');
  const assetAccounts = accounts.filter((a) => a.type === 'asset' && a.isActive !== false);

  const openPayCardSheet = (cardAcc) => {
    openSheet({
      title: `Pay credit card · ${cardAcc.name}`,
      build(close) {
        const paySel = select(assetAccounts.map((a) => ({ value: a.id, label: a.name })), { value: 'acc-1100' });
        const amount = h('input', { class: 'input input-amount', inputmode: 'decimal', placeholder: '0.00' });
        const date = h('input', { class: 'input', type: 'date', value: service.today() });
        const desc = h('input', { class: 'input', placeholder: `Card bill payment: ${cardAcc.name}` });
        const formError = h('p', { class: 'form-error', role: 'alert' });
        const submit = h('button', { class: 'btn btn-block', type: 'submit' }, 'Post card payment');

        const form = h('form', { class: 'form', novalidate: true },
          field({
            label: 'Payment amount (₱)',
            control: amount,
            hint: 'Accounting rule: Paying your credit card bill settles the liability (Dr Credit Card / Cr Bank) and never counts as a second expense.',
          }),
          field({ label: 'Pay from account', control: paySel }),
          field({ label: 'Date', control: date }),
          field({ label: 'Description', control: desc }),
          formError,
          submit);

        form.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          formError.textContent = '';
          try {
            const cents = parseAmount(amount.value);
            await service.recordCreditCardPayment({
              date: date.value,
              cardAccountId: cardAcc.id,
              paymentAccountId: paySel.value,
              amount: cents,
              description: desc.value,
            });
            close();
            toast('Credit card payment posted', { tone: 'success' });
          } catch (err) {
            formError.textContent = err.message;
          }
        });
        return form;
      },
    });
  };

  return h('div', { class: 'stack' },
    h('p', { class: 'notice' }, icon('card', { size: 16 }),
      'Purchases paid with a credit card are recorded as expenses on the purchase date (Dr Expense / Cr Credit Card). Paying the statement is a liability settlement transfer (Dr Credit Card / Cr Bank), never a second expense.'),
    h('div', { class: 'empty-actions' },
      h('button', { class: 'btn btn-tonal', type: 'button', onClick: () => openAccountSheet(service, { subtype: 'credit_card' }) }, icon('plus', { size: 18 }), 'Add credit card'),
      cards.length ? h('button', { class: 'btn', type: 'button', onClick: () => openTransactionSheet(service, { kind: 'expense' }) }, 'Record card purchase') : null),
    cards.length === 0
      ? card({
        children: [emptyState({
          iconName: 'card',
          title: 'No credit cards added',
          message: 'Add a credit card account with an optional credit limit, statement day, and payment due day.',
        })],
      })
      : h('div', { class: 'stack' }, cards.map((c) => card({
        title: c.account.name,
        action: textButton('Pay bill', () => openPayCardSheet(c.account)),
        children: [
          h('div', { class: 'kpis' },
            h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, 'Balance owed'), money(c.balance, { className: 'kpi-value' })),
            h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, 'Credit limit'), c.creditLimit ? money(c.creditLimit, { className: 'kpi-value' }) : h('span', { class: 'kpi-value muted' }, 'Not set')),
            h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, 'Available'), c.availableCredit != null ? money(c.availableCredit, { className: 'kpi-value' }) : h('span', { class: 'kpi-value muted' }, '—'))),
          c.creditLimit
            ? progressBar(c.utilizationBp ?? 0, {
              tone: (c.utilizationBp ?? 0) >= 8000 ? 'expense' : (c.utilizationBp ?? 0) >= 3000 ? 'c3' : 'primary',
              label: `${c.account.name} credit utilization`,
            })
            : null,
          h('p', { class: 'muted small', style: { marginTop: '6px' } },
            c.creditLimit ? `Utilization: ${formatBasisPoints(c.utilizationBp)}` : 'No credit limit configured',
            c.statementDay ? ` · Statement day: ${c.statementDay}` : '',
            c.dueDay ? ` · Due day: ${c.dueDay}` : ''),
        ],
      }))));
}

/* ==================== MODULE 10: RECURRING BILLS ==================== */

export function renderRecurringBills({ service }) {
  const { accounts, bills } = service.state;
  const status = computeBillsStatus(bills, accounts, service.today());
  const expenseAccounts = accounts.filter((a) => a.type === 'expense' && a.isActive !== false);
  const paymentAccounts = accounts.filter((a) => (a.type === 'asset' || a.type === 'liability') && a.isActive !== false);

  const openBillSheet = (existing = null) => {
    openSheet({
      title: existing ? 'Edit recurring bill' : 'New recurring bill',
      build(close) {
        const name = h('input', { class: 'input', maxlength: 60, placeholder: 'e.g. Meralco, PLDT Fiber, Condo Dues', value: existing?.name ?? '' });
        const amount = h('input', { class: 'input input-amount', inputmode: 'decimal', placeholder: '0.00', value: existing ? toDecimalString(existing.amount) : '' });
        const freq = select(Object.entries(BILL_FREQUENCIES).map(([value, label]) => ({ value, label })), { value: existing?.frequency ?? 'monthly' });
        const dueDate = h('input', { class: 'input', type: 'date', value: existing?.nextDueDate ?? service.today() });
        const expSel = select(expenseAccounts.map((a) => ({ value: a.id, label: a.name })), { value: existing?.expenseAccountId ?? 'acc-5200' });
        const paySel = select(paymentAccounts.map((a) => ({ value: a.id, label: a.name })), { value: existing?.paymentAccountId ?? 'acc-1100' });

        const formError = h('p', { class: 'form-error', role: 'alert' });
        const submit = h('button', { class: 'btn btn-block', type: 'submit' }, 'Save recurring bill');

        const form = h('form', { class: 'form', novalidate: true },
          field({ label: 'Bill name', control: name }),
          field({ label: 'Amount (₱)', control: amount }),
          field({ label: 'Frequency', control: freq }),
          field({ label: 'Next due date', control: dueDate }),
          field({ label: 'Expense category', control: expSel }),
          field({ label: 'Default payment account', control: paySel }),
          formError,
          submit);

        form.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          formError.textContent = '';
          try {
            const cents = parseAmount(amount.value);
            await service.saveBill({
              id: existing?.id,
              name: name.value,
              amount: cents,
              frequency: freq.value,
              nextDueDate: dueDate.value,
              expenseAccountId: expSel.value,
              paymentAccountId: paySel.value,
            });
            close();
            toast('Recurring bill saved', { tone: 'success' });
          } catch (err) {
            formError.textContent = err.message;
          }
        });
        return form;
      },
    });
  };

  return h('div', { class: 'stack' },
    h('button', { class: 'btn btn-block', type: 'button', onClick: () => openBillSheet() }, icon('plus', { size: 18 }), 'Add recurring bill'),
    status.items.length === 0
      ? card({
        children: [emptyState({
          iconName: 'calendar',
          title: 'No recurring bills',
          message: 'Schedule utilities, subscriptions, rent, and insurance bills. Bills are posted to the ledger only when you confirm payment.',
        })],
      })
      : card({
        title: `Scheduled bills (${status.items.length})`,
        children: [h('div', { class: 'rows' }, status.items.map((b) => listRow({
          iconName: b.icon,
          tone: b.status === 'overdue' ? 'expense' : b.status === 'due_soon' ? 'c4' : 'neutral',
          title: `${b.name} · ${formatMoney(b.amount)}`,
          subtitle: `${BILL_FREQUENCIES[b.frequency]} · Due ${formatDisplayDate(b.nextDueDate)} (${b.daysUntilDue < 0 ? `${Math.abs(b.daysUntilDue)}d overdue` : b.daysUntilDue === 0 ? 'Due today' : `in ${b.daysUntilDue}d`}) · ${b.paymentAccountName}`,
          trailing: h('div', { class: 'empty-actions', style: { marginTop: 0 } },
            h('button', {
              class: 'btn btn-tonal',
              style: { minHeight: '36px', padding: '0 12px', fontSize: '12.5px' },
              type: 'button',
              onClick: async (e) => {
                e.stopPropagation();
                await service.payBill(b.id);
                toast(`Paid ${b.name} (${formatMoney(b.amount)})`, { tone: 'success' });
              },
            }, 'Pay now'),
            h('button', {
              class: 'icon-btn',
              type: 'button',
              'aria-label': 'Delete bill',
              onClick: async (e) => {
                e.stopPropagation();
                const ok = await confirmDialog({ title: `Remove "${b.name}"?`, message: 'Past paid transactions remain in your ledger.', danger: true });
                if (ok) { await service.deleteBill(b.id); toast('Bill removed'); }
              },
            }, icon('close', { size: 16 }))),
          onClick: () => openBillSheet(b),
        })))],
      }));
}

/* ==================== MODULE 15: MANUAL JOURNAL ENTRIES ==================== */

export function renderJournalEntries({ service }) {
  const { accounts, entries, accountsById } = service.state;

  const openManualJournalSheet = () => {
    openSheet({
      title: 'New manual journal entry',
      build(close) {
        const activeAccounts = accounts.filter((a) => a.isActive !== false);
        const accOptions = Object.keys(TYPE_LABELS).map((type) => ({
          label: TYPE_LABELS[type],
          options: activeAccounts.filter((a) => a.type === type).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` })),
        })).filter((g) => g.options.length);

        const date = h('input', { class: 'input', type: 'date', value: service.today() });
        const desc = h('input', { class: 'input', maxlength: 200, placeholder: 'e.g. Compound payroll entry or adjustment' });
        const note = h('input', { class: 'input', placeholder: 'Optional audit memo' });
        const linesHost = h('div', { class: 'stack-sm' });
        const totalsBar = h('p', { class: 'notice' });
        const formError = h('p', { class: 'form-error', role: 'alert' });

        const lineRows = [];

        const updateLiveTotals = () => {
          let dr = 0;
          let cr = 0;
          for (const row of lineRows) {
            try {
              if (row.side.value === 'debit') dr = add(dr, parseAmount(row.amount.value, { allowZero: true }));
              else cr = add(cr, parseAmount(row.amount.value, { allowZero: true }));
            } catch {
              // ignore partial input while typing
            }
          }
          const diff = subtract(dr, cr);
          totalsBar.textContent = `Debits: ${formatMoney(dr)} · Credits: ${formatMoney(cr)} · ${diff === 0 && dr > 0 ? '✓ Balanced' : `Difference: ${formatMoney(Math.abs(diff))}`}`;
        };

        const addLineRow = (defaultAccId, defaultSide = 'debit') => {
          const accSel = select(accOptions, { value: defaultAccId });
          const sideSel = select([
            { value: 'debit', label: 'Debit (Dr)' },
            { value: 'credit', label: 'Credit (Cr)' },
          ], { value: defaultSide });
          const amt = h('input', { class: 'input', inputmode: 'decimal', placeholder: '0.00', onInput: updateLiveTotals });
          sideSel.addEventListener('change', updateLiveTotals);

          const wrap = h('div', { class: 'card', style: { padding: '10px', background: 'var(--surface-2)' } },
            accSel,
            h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '6px' } }, sideSel, amt));
          lineRows.push({ acc: accSel, side: sideSel, amount: amt, el: wrap });
          linesHost.append(wrap);
          updateLiveTotals();
        };

        addLineRow('acc-5000', 'debit');
        addLineRow('acc-1000', 'credit');

        const addLineBtn = h('button', {
          class: 'btn btn-tonal',
          type: 'button',
          onClick: () => addLineRow('acc-1000', 'credit'),
        }, icon('plus', { size: 16 }), 'Add journal line');

        const submit = h('button', { class: 'btn btn-block', type: 'submit' }, 'Post balanced journal entry');
        const form = h('form', { class: 'form', novalidate: true },
          field({ label: 'Date', control: date }),
          field({ label: 'Description', control: desc }),
          field({ label: 'Note', control: note }),
          h('h3', { class: 'section-label' }, 'Journal lines (debits must equal credits)'),
          linesHost,
          addLineBtn,
          totalsBar,
          formError,
          submit);

        form.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          formError.textContent = '';
          try {
            const lines = [];
            for (const r of lineRows) {
              if (!r.amount.value.trim()) continue;
              const cents = parseAmount(r.amount.value);
              lines.push(r.side.value === 'debit' ? debitLine(r.acc.value, cents) : creditLine(r.acc.value, cents));
            }
            await service.recordManualEntry({
              date: date.value,
              description: desc.value,
              note: note.value,
              lines,
            });
            close();
            toast('Journal entry posted', { tone: 'success' });
          } catch (err) {
            formError.textContent = err.errors ? err.errors.join(' ') : err.message;
          }
        });
        return form;
      },
    });
  };

  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

  return h('div', { class: 'stack' },
    h('button', { class: 'btn btn-block', type: 'button', onClick: openManualJournalSheet }, icon('plus', { size: 18 }), 'New manual journal entry'),
    sorted.length === 0
      ? card({ children: [emptyState({ iconName: 'journal', title: 'No journal entries yet', message: 'Every transaction you record creates a balanced double-entry journal record.' })] })
      : h('div', { class: 'stack' }, sorted.map((e) => card({
        title: `${formatDisplayDate(e.date)} · ${e.description}`,
        action: textButton('Inspect', () => openEntrySheet(service, e.id)),
        children: [
          h('table', { class: 'table' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Account'), h('th', { class: 'r' }, 'Debit'), h('th', { class: 'r' }, 'Credit'))),
            h('tbody', {}, e.lines.map((l) => {
              const acc = accountsById.get(l.accountId);
              return h('tr', {},
                h('td', {}, h('span', { class: 'code' }, acc?.code ?? ''), ' ', acc?.name ?? l.accountId),
                h('td', { class: 'r num' }, l.debit ? formatMoney(l.debit) : ''),
                h('td', { class: 'r num' }, l.credit ? formatMoney(l.credit) : ''));
            }))),
        ],
      }))));
}

/* ==================== MODULE 14: GENERAL LEDGER ==================== */

const glFilter = { accountId: 'all', from: '', to: '' };

export function renderGeneralLedger({ service }) {
  const { accounts, entries } = service.state;
  const host = h('div', { class: 'stack' });

  const accSelect = select([
    { value: 'all', label: 'All active accounts with activity' },
    ...Object.keys(TYPE_LABELS).map((type) => ({
      label: TYPE_LABELS[type],
      options: accounts.filter((a) => a.type === type).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` })),
    })),
  ], { value: glFilter.accountId });

  const fromInput = h('input', { class: 'input', type: 'date', value: glFilter.from });
  const toInput = h('input', { class: 'input', type: 'date', value: glFilter.to || service.today() });

  const refresh = () => {
    glFilter.accountId = accSelect.value;
    glFilter.from = fromInput.value;
    glFilter.to = toInput.value;
    const result = generalLedger(accounts, entries, {
      accountId: glFilter.accountId === 'all' ? null : glFilter.accountId,
      from: glFilter.from || null,
      to: glFilter.to || null,
    });
    if (result.ledgers.length === 0) {
      host.replaceChildren(card({ children: [emptyState({ iconName: 'book', title: 'No ledger activity in range', message: 'Post transactions or widen the date filter.' })] }));
      return;
    }
    host.replaceChildren(...result.ledgers.map((l) => card({
      title: `${l.account.code} · ${l.account.name}`,
      action: h('span', { class: 'badge badge-muted' }, `Normal ${l.normalSide}`),
      children: [
        h('p', { class: 'muted small' },
          'Opening: ', money(l.openingBalance),
          ' · Debits: ', money(l.totalDebit),
          ' · Credits: ', money(l.totalCredit),
          ' · Closing: ', money(l.closingBalance)),
        l.rows.length
          ? h('table', { class: 'table' },
            h('thead', {}, h('tr', {},
              h('th', {}, 'Date'),
              h('th', {}, 'Description'),
              h('th', { class: 'r' }, 'Dr'),
              h('th', { class: 'r' }, 'Cr'),
              h('th', { class: 'r' }, 'Balance'))),
            h('tbody', {}, l.rows.map((r) => h('tr', {
              style: 'cursor:pointer',
              onClick: () => openEntrySheet(service, r.entryId),
            },
            h('td', {}, r.date.slice(5)),
            h('td', {}, r.description),
            h('td', { class: 'r num' }, r.debit ? formatMoney(r.debit) : ''),
            h('td', { class: 'r num' }, r.credit ? formatMoney(r.credit) : ''),
            h('td', { class: 'r num' }, formatMoney(r.balance))))))
          : h('p', { class: 'muted small' }, 'No postings during selected dates.'),
      ],
    })));
  };

  accSelect.addEventListener('change', refresh);
  fromInput.addEventListener('change', refresh);
  toInput.addEventListener('change', refresh);
  refresh();

  return h('div', { class: 'stack' },
    card({
      title: 'Ledger filters',
      children: [
        field({ label: 'Account', control: accSelect }),
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } },
          field({ label: 'From date', control: fromInput }),
          field({ label: 'To date', control: toInput })),
      ],
    }),
    host);
}

/* ==================== MODULE 22: CSV EXPORT ==================== */

export function renderCsvExport({ service }) {
  const { accounts, entries, accountsById } = service.state;
  const today = service.today();
  const { from, to } = monthRange(monthKeyOf(today));

  return h('div', { class: 'stack' },
    card({
      title: 'Export financial records (CSV)',
      children: [
        h('p', { class: 'muted small', style: { marginBottom: '10px' } },
          'Exports RFC-4180 compliant spreadsheets formatted in exact Philippine Peso (PHP) decimals for Excel, Google Sheets, or LibreOffice Calc.'),
        h('div', { class: 'rows' },
          listRow({
            iconName: 'download',
            tone: 'primary',
            title: 'Transactions & journal lines (.csv)',
            subtitle: `${entries.length} posted journal entries with account codes, debits and credits`,
            onClick: () => {
              const csv = exportTransactionsCsv(entries, accountsById);
              downloadFile(`myfinance-pro-transactions-${today}.csv`, csv, 'text/csv;charset=utf-8');
              toast('Transactions CSV downloaded', { tone: 'success' });
            },
          }),
          listRow({
            iconName: 'scale',
            tone: 'transfer',
            title: `Trial balance as of ${today} (.csv)`,
            subtitle: 'All account debit and credit balances',
            onClick: () => {
              const tb = trialBalance(accounts, entries, { asOf: today });
              downloadFile(`myfinance-pro-trial-balance-${today}.csv`, exportTrialBalanceCsv(tb), 'text/csv;charset=utf-8');
              toast('Trial Balance CSV downloaded', { tone: 'success' });
            },
          }),
          listRow({
            iconName: 'trendUp',
            tone: 'income',
            title: 'Current month income statement (.csv)',
            subtitle: `${from} to ${to}`,
            onClick: () => {
              const is = incomeStatement(accounts, entries, { from, to });
              downloadFile(`myfinance-pro-income-statement-${monthKeyOf(today)}.csv`, exportIncomeStatementCsv(is), 'text/csv;charset=utf-8');
              toast('Income Statement CSV downloaded', { tone: 'success' });
            },
          }),
          listRow({
            iconName: 'layers',
            tone: 'neutral',
            title: `Balance sheet as of ${today} (.csv)`,
            subtitle: 'Assets, liabilities, and equity',
            onClick: () => {
              const bs = balanceSheet(accounts, entries, { asOf: today });
              downloadFile(`myfinance-pro-balance-sheet-${today}.csv`, exportBalanceSheetCsv(bs), 'text/csv;charset=utf-8');
              toast('Balance Sheet CSV downloaded', { tone: 'success' });
            },
          })),
      ],
    }));
}

/* ==================== MODULE 23: BACKUP & RESTORE ==================== */

export function renderBackupRestore({ service }) {
  const { accounts, entries, budgets, goals, bills } = service.state;
  const today = service.today();
  let importMode = 'merge';
  const resultBox = h('div', {});
  const passphraseInput = h('input', {
    class: 'input',
    type: 'password',
    placeholder: 'Optional passphrase (min 6 chars for AES-256-GCM encryption)',
  });

  const fileInput = h('input', {
    type: 'file',
    accept: '.json,application/json',
    style: { display: 'none' },
    onChange: async (ev) => {
      const file = ev.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        let parsed = JSON.parse(text);
        if (parsed && parsed.encrypted === true) {
          parsed = await decryptBackupPayload(parsed, passphraseInput.value);
        }
        if (importMode === 'replace') {
          const ok = await confirmDialog({
            title: 'Replace all existing data?',
            message: 'All current accounts, transactions, budgets, goals, and bills on this device will be replaced by the backup file.',
            confirmLabel: 'Replace all',
            danger: true,
          });
          if (!ok) { fileInput.value = ''; return; }
        }
        const summary = await service.importBackup(parsed, { mode: importMode });
        resultBox.replaceChildren(
          h('p', { class: 'notice' }, icon('check', { size: 16 }),
            `Import complete (${importMode}): +${summary.entriesAdded} transactions (${summary.entriesSkippedDuplicate} duplicates skipped), +${summary.accountsAdded} accounts, +${summary.budgetsAdded} budgets, +${summary.goalsAdded} goals, +${summary.billsAdded} bills.`),
        );
        toast('Backup restored successfully', { tone: 'success' });
      } catch (err) {
        resultBox.replaceChildren(
          h('p', { class: 'notice warn' }, icon('alert', { size: 16 }),
            `Import rejected: ${err.errors ? err.errors.join(' ') : err.message}`),
        );
        toast('Backup validation failed', { tone: 'error' });
      } finally {
        fileInput.value = '';
      }
    },
  });

  const modeSeg = segmented([
    { value: 'merge', label: 'Merge (skip duplicates)' },
    { value: 'replace', label: 'Replace all data' },
  ], {
    value: importMode,
    label: 'Restore mode',
    onChange: (v) => { importMode = v; },
  });

  return h('div', { class: 'stack' },
    card({
      title: 'Create local backup (.json or AES-256-GCM encrypted)',
      children: [
        h('p', { class: 'muted small', style: { marginBottom: '12px' } },
          `Snapshot includes ${accounts.length} accounts, ${entries.length} journal entries, ${budgets.length} budgets, ${goals.length} savings goals, and ${bills.length} recurring bills.`),
        field({ label: 'Backup passphrase (optional, used for AES-256-GCM encrypt/decrypt)', control: passphraseInput }),
        h('div', { class: 'empty-actions', style: { marginTop: '10px' } },
          h('button', {
            class: 'btn',
            type: 'button',
            onClick: () => {
              const payload = service.exportBackup();
              downloadFile(`myfinance-pro-backup-${today}.json`, JSON.stringify(payload, null, 2), 'application/json');
              toast('Plain JSON backup downloaded', { tone: 'success' });
            },
          }, icon('download', { size: 18 }), 'Download JSON backup'),
          h('button', {
            class: 'btn btn-tonal',
            type: 'button',
            onClick: async () => {
              try {
                const payload = service.exportBackup();
                const enc = await encryptBackupPayload(payload, passphraseInput.value);
                downloadFile(`myfinance-pro-backup-${today}.enc.json`, JSON.stringify(enc, null, 2), 'application/json');
                toast('AES-256-GCM encrypted backup downloaded', { tone: 'success' });
              } catch (err) {
                toast(err.errors ? err.errors.join(' ') : err.message, { tone: 'error' });
              }
            },
          }, icon('lock', { size: 18 }), 'Download Encrypted (.enc.json)')),
      ],
    }),
    card({
      title: 'Restore or import backup',
      children: [
        h('p', { class: 'muted small', style: { marginBottom: '10px' } },
          'Every imported journal entry is validated for double-entry balance (Debits = Credits). In Merge mode, duplicate transactions (by ID or identical date/kind/description/lines) are automatically skipped. If restoring an encrypted .enc.json file, enter its passphrase above first.'),
        field({ label: 'Import mode', control: modeSeg }),
        fileInput,
        h('button', {
          class: 'btn btn-tonal btn-block',
          style: { marginTop: '10px' },
          type: 'button',
          onClick: () => fileInput.click(),
        }, icon('upload', { size: 18 }), 'Select backup JSON / .enc.json file…'),
        resultBox,
      ],
    }));
}
