import { useState } from 'react';
import { useApp } from '../hooks/useApp';
import { deleteDebt, saveDebt, setDebtClosed } from '../db/repo';
import { diffDays, formatDate } from '../lib/dates';
import { debtStatus } from '../lib/finance';
import type { Debt, DebtDirection } from '../lib/types';
import { AmountField, Empty, Money, Progress, Seg, Sheet, readAmount, toInput, useConfirm, useSaver } from '../components/ui';
import { useTxSheet } from '../components/TxSheet';
import { TxItem } from '../components/TxList';

export default function Debts() {
  const { data, currency, today } = useApp();
  const openTx = useTxSheet();
  const [editing, setEditing] = useState<Debt | 'new' | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const statuses = data.debts.map((d) => debtStatus(data, d));
  const iOwe = statuses.filter((s) => s.debt.direction === 'i_owe' && !s.debt.closed).reduce((a, s) => a + s.remaining, 0);
  const owedToMe = statuses.filter((s) => s.debt.direction === 'owed_to_me' && !s.debt.closed).reduce((a, s) => a + s.remaining, 0);

  return (
    <div>
      <div className="page-head">
        <div><h1>الديون</h1><div className="sub">قسم اختياري. الديون ودفعاتها تحرّك النقد لكنها ليست دخلاً ولا مصروفاً</div></div>
        <button className="btn primary sm" onClick={() => setEditing('new')}>+ دين جديد</button>
      </div>
      <div className="grid grid-2">
        <div className="stat"><div className="label">ديون عليّ</div><div className="value c-expense"><Money value={iOwe} currency={currency} /></div></div>
        <div className="stat"><div className="label">ديون لي</div><div className="value c-income"><Money value={owedToMe} currency={currency} /></div></div>
      </div>

      <div className="mt">
        {statuses.length === 0 ? <div className="card"><Empty icon="🤝" text="لا توجد ديون مسجلة." /></div> : statuses
          .sort((a, b) => Number(a.debt.closed) - Number(b.debt.closed) || (a.debt.dueDate ?? '9') .localeCompare(b.debt.dueDate ?? '9'))
          .map((st) => {
            const d = st.debt;
            const due = d.dueDate ? diffDays(today, d.dueDate) : null;
            const pct = d.principal > 0 ? (st.paid / d.principal) * 100 : 0;
            return (
              <div className="card" key={d.id}>
                <div className="card-head">
                  <h3>{d.direction === 'i_owe' ? `عليّ لـ ${d.person}` : `لي عند ${d.person}`} {d.closed && <span className="badge ok">مغلق</span>}</h3>
                  <button className="link-btn small" onClick={() => setEditing(d)}>تعديل</button>
                </div>
                <div className="row between">
                  <span>المتبقي <Money value={st.remaining} currency={currency} className={`bold ${d.direction === 'i_owe' ? 'c-expense' : 'c-income'}`} /></span>
                  <span className="small muted">من <Money value={d.principal} currency={currency} /></span>
                </div>
                <div className="mt"><Progress value={pct} /></div>
                <div className="small muted mt">
                  {d.dueDate ? <>موعد السداد {formatDate(d.dueDate)}{due !== null && !d.closed && st.remaining > 0 ? (due < 0 ? ` — متأخر ${-due} يوم` : ` — بعد ${due} يوم`) : ''}</> : 'بدون موعد'}
                  {d.note && <> · {d.note}</>}
                </div>
                <div className="btn-row mt">
                  {st.remaining > 0 && !d.closed && (
                    <button className="btn sm primary" onClick={() => openTx({ type: 'debt_payment', preset: { debtId: d.id, amount: st.remaining } })}>
                      {d.direction === 'i_owe' ? 'تسجيل دفعة دفعتها' : 'تسجيل دفعة استلمتها'}
                    </button>
                  )}
                  <button className="btn sm" onClick={() => setOpen(open === d.id ? null : d.id)}>الدفعات ({st.payments.length})</button>
                </div>
                {open === d.id && (
                  <div className="list mt">
                    {data.transactions.filter((t) => t.debtId === d.id).sort((a, b) => (a.date < b.date ? 1 : -1)).map((t) => <TxItem key={t.id} t={t} showDate />)}
                  </div>
                )}
              </div>
            );
          })}
      </div>
      {editing && <DebtSheet debt={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function DebtSheet({ debt, onClose }: { debt: Debt | null; onClose: () => void }) {
  const { currency, today } = useApp();
  const { busy, run } = useSaver();
  const confirm = useConfirm();
  const [direction, setDirection] = useState<DebtDirection>(debt?.direction ?? 'i_owe');
  const [person, setPerson] = useState(debt?.person ?? '');
  const [amount, setAmount] = useState(toInput(debt?.principal ?? 0, currency));
  const [start, setStart] = useState(debt?.startDate ?? today);
  const [due, setDue] = useState(debt?.dueDate ?? '');
  const [note, setNote] = useState(debt?.note ?? '');
  const [recordCash, setRecordCash] = useState(true);
  const [error, setError] = useState('');

  async function save() {
    const a = readAmount(amount, currency);
    if (!person.trim()) return setError('اكتب اسم الشخص.');
    if (!a) return setError('اكتب مبلغ الدين.');
    const ok = await run(async () => {
      await saveDebt({ id: debt?.id, person, direction, principal: a, startDate: start, dueDate: due || null, note, recordCash: !debt && recordCash });
      return true;
    }, 'تم حفظ الدين');
    if (ok) onClose();
  }

  async function remove() {
    if (!debt) return;
    if (!(await confirm('حذف الدين وكل دفعاته؟ سيُعاد حساب الأرصدة.', { okText: 'حذف' }))) return;
    if (await run(async () => { await deleteDebt(debt.id); return true; }, 'تم حذف الدين')) onClose();
  }

  return (
    <Sheet title={debt ? 'تعديل الدين' : 'دين جديد'} onClose={onClose}>
      {!debt && <div className="field"><Seg value={direction} onChange={setDirection} options={[['i_owe', 'دين عليّ (اقترضت)'], ['owed_to_me', 'دين لي (أقرضت)']]} /></div>}
      <div className="field"><label htmlFor="d-person">الشخص</label><input id="d-person" className="input" value={person} onChange={(e) => setPerson(e.target.value)} /></div>
      <AmountField id="d-amount" label="مبلغ الدين" value={amount} onChange={setAmount} currency={currency} />
      <div className="grid grid-2">
        <div className="field"><label htmlFor="d-start">تاريخ الدين</label><input id="d-start" type="date" className="input" value={start} max={today} onChange={(e) => setStart(e.target.value)} /></div>
        <div className="field"><label htmlFor="d-due">موعد السداد (اختياري)</label><input id="d-due" type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} /></div>
      </div>
      <div className="field"><label htmlFor="d-note">ملاحظة</label><input id="d-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      {!debt && (
        <label className="check">
          <input type="checkbox" checked={recordCash} onChange={(e) => setRecordCash(e.target.checked)} />
          <span>{direction === 'i_owe' ? 'استلمت هذا المبلغ الآن (يُضاف لرصيدي)' : 'دفعت هذا المبلغ الآن (يُخصم من رصيدي)'} — ألغِ التحديد إذا كان الدين قديماً.</span>
        </label>
      )}
      {error && <div className="alert danger mt">{error}</div>}
      <div className="btn-row mt">
        <button className="btn primary" disabled={busy} onClick={save}>حفظ</button>
        {debt && <button className="btn" disabled={busy} onClick={async () => { if (await run(async () => { await setDebtClosed(debt.id, !debt.closed); return true; }, debt.closed ? 'أُعيد فتح الدين' : 'تم إغلاق الدين')) onClose(); }}>{debt.closed ? 'إعادة فتح' : 'إغلاق الدين'}</button>}
        {debt && <button className="btn soft-danger" disabled={busy} onClick={remove}>حذف</button>}
      </div>
    </Sheet>
  );
}
