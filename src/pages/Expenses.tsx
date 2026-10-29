import { useMemo, useState } from 'react';
import { useApp } from '../hooks/useApp';
import { formatDate, formatMonthKey, monthKey } from '../lib/dates';
import { cycleBounds, sortCycles, spendingOf, FAR_FUTURE } from '../lib/finance';
import { readAmount, Money, Empty } from '../components/ui';
import { TxByDay } from '../components/TxList';
import { useTxSheet } from '../components/TxSheet';
import type { TxType } from '../lib/types';

type Kind = 'spending' | 'all' | 'income';

export default function Expenses() {
  const { data, currency, current } = useApp();
  const openTx = useTxSheet();
  const cycles = sortCycles(data.cycles).reverse();
  const months = useMemo(() => [...new Set(data.transactions.map((t) => monthKey(t.date)))].sort().reverse(), [data.transactions]);
  const [period, setPeriod] = useState<string>(current ? `c:${current.cycle.id}` : 'all');
  const [kind, setKind] = useState<Kind>('spending');
  const [categoryId, setCategoryId] = useState('');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const filtered = useMemo(() => {
    let lo = '0000-01-01', hi = FAR_FUTURE;
    if (period.startsWith('c:')) {
      const c = data.cycles.find((x) => x.id === period.slice(2));
      if (c) { const b = cycleBounds(data.cycles, c); lo = b.start; hi = b.memberEnd; }
    } else if (period.startsWith('m:')) {
      lo = `${period.slice(2)}-01`; hi = `${period.slice(2)}-31`;
    }
    if (from && from > lo) lo = from;
    if (to && to < hi) hi = to;
    const amountQ = query.trim() ? readAmount(query, currency) : null;
    const textQ = query.trim().toLowerCase();
    const spendTypes: TxType[] = ['expense', 'refund'];
    return data.transactions.filter((t) => {
      if (t.date < lo || t.date > hi) return false;
      if (kind === 'spending' && !spendTypes.includes(t.type)) return false;
      if (kind === 'income' && t.type !== 'income') return false;
      if (categoryId && t.categoryId !== categoryId) return false;
      if (textQ) {
        const cat = t.categoryId ? data.categories.find((c) => c.id === t.categoryId)?.name ?? '' : '';
        const hit = (amountQ !== null && t.amount === amountQ) || t.note.toLowerCase().includes(textQ) || cat.includes(textQ);
        if (!hit) return false;
      }
      return true;
    });
  }, [data, period, kind, categoryId, query, from, to, currency]);

  const total = filtered.reduce((a, t) => a + (kind === 'income' ? t.amount : spendingOf(t)), 0);
  const lastExpense = [...data.transactions].filter((t) => t.type === 'expense' && !t.billId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  return (
    <div>
      <div className="page-head">
        <div><h1>المصاريف والعمليات</h1><div className="sub">اضغط على أي عملية لتعديلها أو حذفها</div></div>
        <div className="row">
          {lastExpense && (
            <button className="btn sm" onClick={() => openTx({ type: 'expense', preset: { amount: lastExpense.amount, categoryId: lastExpense.categoryId, paymentMethod: lastExpense.paymentMethod, note: lastExpense.note } })}>⟳ نسخ آخر مصروف</button>
          )}
          <button className="btn sm" onClick={() => openTx({ type: 'income' })}>+ دخل</button>
          <button className="btn sm" onClick={() => openTx({ type: 'refund' })}>+ استرداد</button>
        </div>
      </div>

      <div className="card">
        <div className="grid grid-2">
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="f-period">الفترة</label>
            <select id="f-period" className="input" value={period} onChange={(e) => setPeriod(e.target.value)}>
              <optgroup label="دورات الراتب">
                {cycles.map((c) => <option key={c.id} value={`c:${c.id}`}>{c.status === 'active' ? 'الدورة الحالية' : 'دورة'} — {formatDate(c.startDate)}</option>)}
              </optgroup>
              <optgroup label="الأشهر">
                {months.map((m) => <option key={m} value={`m:${m}`}>{formatMonthKey(m)}</option>)}
              </optgroup>
              <option value="all">كل الفترات</option>
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="f-cat">الفئة</label>
            <select id="f-cat" className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">كل الفئات</option>
              {data.categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="f-q">بحث بالمبلغ أو الوصف</label>
            <input id="f-q" className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="مثلاً 5000 أو غداء" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>من / إلى تاريخ</label>
            <div className="row">
              <input type="date" className="input grow" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="من تاريخ" />
              <input type="date" className="input grow" value={to} onChange={(e) => setTo(e.target.value)} aria-label="إلى تاريخ" />
            </div>
          </div>
        </div>
        <div className="row mt">
          <div className="seg grow">
            {([['spending', 'المصاريف'], ['income', 'الدخل'], ['all', 'كل العمليات']] as [Kind, string][]).map(([k, l]) => (
              <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>
            ))}
          </div>
        </div>
        <div className="row between mt">
          <span className="muted small">{filtered.length} عملية</span>
          {kind !== 'all' && <span>المجموع: <Money value={total} currency={currency} className={`bold ${kind === 'income' ? 'c-income' : 'c-expense'}`} /></span>}
        </div>
      </div>

      {filtered.length === 0
        ? <div className="card mt"><Empty icon="🧾" text="لا توجد عمليات مطابقة." /></div>
        : <TxByDay txs={filtered} />}
    </div>
  );
}
