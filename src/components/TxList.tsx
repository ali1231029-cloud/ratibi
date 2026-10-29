import { useApp } from '../hooks/useApp';
import { formatDate } from '../lib/dates';
import { INCOME_KINDS, PAYMENT_METHODS, TX_TYPE_LABELS, type Transaction } from '../lib/types';
import { spendingOf } from '../lib/finance';
import { Money } from './ui';
import { useTxSheet } from './TxSheet';

function describe(t: Transaction, ctx: ReturnType<typeof useApp>) {
  const cat = t.categoryId ? ctx.categoriesById.get(t.categoryId) : undefined;
  const bill = t.billId ? ctx.data.bills.find((b) => b.id === t.billId) : undefined;
  const goal = t.goalId ? ctx.data.goals.find((g) => g.id === t.goalId) : undefined;
  const debt = t.debtId ? ctx.data.debts.find((d) => d.id === t.debtId) : undefined;
  switch (t.type) {
    case 'expense':
      return { icon: cat?.icon ?? '📦', title: bill ? `فاتورة: ${bill.name}` : t.note || cat?.name || 'مصروف', sub: [cat?.name, t.paymentMethod ? PAYMENT_METHODS[t.paymentMethod] : null], tone: 'c-expense', sign: -1 };
    case 'refund':
      return { icon: '↩️', title: t.note || `استرداد — ${cat?.name ?? ''}`, sub: ['استرداد', cat?.name], tone: 'c-income', sign: 1 };
    case 'income':
      return { icon: '💰', title: t.note || INCOME_KINDS[t.incomeKind ?? 'other'], sub: [INCOME_KINDS[t.incomeKind ?? 'other']], tone: 'c-income', sign: 1 };
    case 'saving_in':
      return { icon: '🏦', title: `ادخار: ${goal?.name ?? ''}`, sub: ['تحويل داخلي', t.note], tone: 'c-saving', sign: -1 };
    case 'saving_out':
      return { icon: '🏦', title: `سحب من: ${goal?.name ?? ''}`, sub: ['تحويل داخلي', t.note], tone: 'c-saving', sign: 1 };
    case 'debt_open':
      return debt?.direction === 'owed_to_me'
        ? { icon: '🤝', title: `إقراض ${debt.person}`, sub: ['دين لي'], tone: 'c-muted', sign: -1 }
        : { icon: '🤝', title: `اقتراض من ${debt?.person ?? ''}`, sub: ['دين علي'], tone: 'c-muted', sign: 1 };
    case 'debt_payment':
      return debt?.direction === 'owed_to_me'
        ? { icon: '🤝', title: `استلام دفعة من ${debt.person}`, sub: ['سداد دين لي', t.note], tone: 'c-income', sign: 1 }
        : { icon: '🤝', title: `سداد دفعة إلى ${debt?.person ?? ''}`, sub: ['سداد دين علي', t.note], tone: 'c-expense', sign: -1 };
  }
}

export function TxItem({ t, showDate = false }: { t: Transaction; showDate?: boolean }) {
  const ctx = useApp();
  const openTx = useTxSheet();
  const d = describe(t, ctx);
  const editable = t.type !== 'debt_open';
  const meta = [showDate ? formatDate(t.date) : null, ...d.sub].filter(Boolean).join(' · ');
  return (
    <div className={`item ${editable ? 'clickable' : ''}`} onClick={editable ? () => openTx({ edit: t }) : undefined}
      role={editable ? 'button' : undefined} tabIndex={editable ? 0 : undefined}
      onKeyDown={editable ? (e) => { if (e.key === 'Enter') openTx({ edit: t }); } : undefined}>
      <div className="icon">{d.icon}</div>
      <div className="body">
        <div className="title">{d.title}</div>
        <div className="meta">{meta || TX_TYPE_LABELS[t.type]}</div>
      </div>
      <Money value={d.sign * t.amount} currency={ctx.currency} className={`amount ${d.tone}`} sign />
    </div>
  );
}

/** Transactions grouped by day, newest first, with each day's spending total. */
export function TxByDay({ txs }: { txs: Transaction[] }) {
  const { currency } = useApp();
  const groups = new Map<string, Transaction[]>();
  for (const t of [...txs].sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : a.date < b.date ? 1 : -1))) {
    const g = groups.get(t.date) ?? [];
    g.push(t);
    groups.set(t.date, g);
  }
  return (
    <div>
      {[...groups.entries()].map(([date, list]) => {
        const spent = list.reduce((a, t) => a + spendingOf(t), 0);
        return (
          <div className="day-group" key={date}>
            <div className="day-group-head">
              <span>{formatDate(date, true)}</span>
              {spent !== 0 && <span>المصروف: <Money value={spent} currency={currency} /></span>}
            </div>
            <div className="card" style={{ paddingBlock: 4 }}>
              <div className="list">{list.map((t) => <TxItem key={t.id} t={t} />)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
