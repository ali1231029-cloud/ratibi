import { useState } from 'react';
import { useApp } from '../hooks/useApp';
import { payBill, reactivateBill, removeBill, saveBill, deleteTransaction } from '../db/repo';
import { diffDays, formatDate } from '../lib/dates';
import { billOccurrences, billsForPeriod, type BillOccurrence } from '../lib/finance';
import { FREQUENCY_LABELS, PAYMENT_METHODS, type Bill, type BillFrequency, type PaymentMethod } from '../lib/types';
import { AmountField, Empty, Money, Sheet, readAmount, toInput, useConfirm, useSaver, useToast } from '../components/ui';

export default function Bills() {
  const { current: s, data, currency, today } = useApp();
  const [editing, setEditing] = useState<Bill | 'new' | null>(null);
  const [paying, setPaying] = useState<BillOccurrence | null>(null);
  const { run } = useSaver();
  const confirm = useConfirm();
  if (!s) return null;

  async function unpay(o: BillOccurrence) {
    if (!o.payment) return;
    if (!(await confirm(`إلغاء تسجيل دفع "${o.bill.name}"؟ سيُحذف قيد الدفع ويعود المبلغ محجوزاً.`, { okText: 'إلغاء الدفع' }))) return;
    await run(() => deleteTransaction(o.payment!.id), 'أُلغي تسجيل الدفع');
  }

  const upcoming = billsForPeriod(data, today, s.bounds.plannedEnd > today ? s.bounds.plannedEnd : today).filter((b) => !b.payment);
  const overdueOld = s.bills.filter((b) => !b.payment && b.dueDate < today);

  return (
    <div>
      <div className="page-head">
        <div><h1>المصاريف الثابتة والفواتير</h1><div className="sub">تُحجز مبالغ الفواتير غير المدفوعة من الميزانية، وتصبح مصروفاً عند الدفع فقط</div></div>
        <button className="btn primary sm" onClick={() => setEditing('new')}>+ التزام جديد</button>
      </div>

      <div className="grid grid-3">
        <div className="stat"><div className="label">التزامات هذه الدورة</div><div className="value"><Money value={s.billsExpected} currency={currency} /></div></div>
        <div className="stat"><div className="label">مدفوع</div><div className="value c-income"><Money value={s.fixedPaid} currency={currency} /></div></div>
        <div className="stat"><div className="label">محجوز غير مدفوع</div><div className="value c-warning"><Money value={s.billsUnpaid} currency={currency} /></div></div>
      </div>

      <div className="card mt">
        <h2>فواتير الدورة الحالية</h2>
        {s.bills.length === 0 ? <Empty icon="📌" text="لا توجد فواتير مستحقة في هذه الدورة." /> : (
          <div className="list">
            {s.bills.map((o) => {
              const d = diffDays(today, o.dueDate);
              return (
                <div className="item" key={`${o.bill.id}-${o.dueDate}`}>
                  <div className="icon">{data.categories.find((c) => c.id === o.bill.categoryId)?.icon ?? '📌'}</div>
                  <div className="body">
                    <div className="title">{o.bill.name}</div>
                    <div className="meta">
                      الاستحقاق {formatDate(o.dueDate)}
                      {o.payment ? ` · دُفعت ${formatDate(o.payment.date)}` : d < 0 ? ` · متأخرة ${-d} يوم` : d === 0 ? ' · اليوم' : ` · بعد ${d} يوم`}
                    </div>
                  </div>
                  <div style={{ textAlign: 'end' }}>
                    <Money value={o.payment?.amount ?? o.expected} currency={currency} className="amount" />
                    <div>
                      {o.payment
                        ? <button className="link-btn small" onClick={() => unpay(o)}>✓ مدفوعة — إلغاء</button>
                        : <button className="btn primary sm" onClick={() => setPaying(o)}>دفع</button>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {overdueOld.length > 0 && <div className="alert danger mt">{overdueOld.length} فاتورة تجاوزت موعد استحقاقها ولم تُدفع.</div>}
        {upcoming.length > 0 && <div className="small muted mt">الفواتير غير المدفوعة القادمة: {upcoming.length}</div>}
      </div>

      <div className="card mt">
        <h2>كل الالتزامات</h2>
        {data.bills.length === 0 ? <Empty icon="🗒️" text="لم تُضف أي التزامات بعد." /> : (
          <div className="list">
            {data.bills.map((b) => {
              const next = billOccurrences(b, today, '9999-12-31')[0];
              return (
                <div className="item clickable" key={b.id} onClick={() => setEditing(b)} role="button" tabIndex={0}>
                  <div className="icon">{data.categories.find((c) => c.id === b.categoryId)?.icon ?? '📌'}</div>
                  <div className="body">
                    <div className="title">{b.name} {!b.active && <span className="badge">متوقف</span>}</div>
                    <div className="meta">{FREQUENCY_LABELS[b.frequency]}{b.active && next ? ` · القادم ${formatDate(next)}` : ''}</div>
                  </div>
                  <Money value={b.amount} currency={currency} className="amount" />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {editing && <BillSheet bill={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {paying && <PaySheet occ={paying} onClose={() => setPaying(null)} />}
    </div>
  );
}

function BillSheet({ bill, onClose }: { bill: Bill | null; onClose: () => void }) {
  const { data, currency, today } = useApp();
  const { busy, run } = useSaver();
  const confirm = useConfirm();
  const toast = useToast();
  const [name, setName] = useState(bill?.name ?? '');
  const [amount, setAmount] = useState(toInput(bill?.amount ?? 0, currency));
  const [freq, setFreq] = useState<BillFrequency>(bill?.frequency ?? 'monthly');
  const [due, setDue] = useState(bill?.firstDueDate ?? today);
  const [cat, setCat] = useState(bill?.categoryId ?? 'cat-other');
  const [error, setError] = useState('');

  async function save() {
    setError('');
    const a = readAmount(amount, currency);
    if (!name.trim()) return setError('اكتب اسم الالتزام.');
    if (!a) return setError('اكتب المبلغ المتوقع.');
    const ok = await run(async () => { await saveBill({ id: bill?.id, name, amount: a, frequency: freq, firstDueDate: due, categoryId: cat }); return true; }, 'تم حفظ الالتزام');
    if (ok) onClose();
  }

  async function remove() {
    if (!bill) return;
    if (!(await confirm(`حذف "${bill.name}"؟ إذا كانت له دفعات سابقة فسيُوقف فقط وتبقى دفعاته في السجل.`, { okText: 'حذف' }))) return;
    const r = await run(() => removeBill(bill.id));
    if (r) {
      toast('success', r === 'deleted' ? 'تم حذف الالتزام' : 'تم إيقاف الالتزام مع الاحتفاظ بدفعاته');
      onClose();
    }
  }

  return (
    <Sheet title={bill ? 'تعديل الالتزام' : 'التزام جديد'} onClose={onClose}>
      <div className="field"><label htmlFor="b-name">الاسم</label><input id="b-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً: الإيجار" /></div>
      <AmountField id="b-amount" label="المبلغ المتوقع" value={amount} onChange={setAmount} currency={currency} />
      <div className="grid grid-2">
        <div className="field"><label htmlFor="b-freq">التكرار</label>
          <select id="b-freq" className="input" value={freq} onChange={(e) => setFreq(e.target.value as BillFrequency)}>
            {(Object.keys(FREQUENCY_LABELS) as BillFrequency[]).map((f) => <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="b-due">{bill ? 'أول تاريخ استحقاق' : 'تاريخ الاستحقاق القادم'}</label><input id="b-due" type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} /></div>
      </div>
      <div className="field"><label htmlFor="b-cat">الفئة</label>
        <select id="b-cat" className="input" value={cat} onChange={(e) => setCat(e.target.value)}>
          {data.categories.filter((c) => !c.archived || c.id === cat).map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
        </select>
      </div>
      {bill && <div className="help small muted">تغيير المبلغ يؤثر على الحجز للفواتير غير المدفوعة فقط؛ الدفعات السابقة لا تتغير.</div>}
      {error && <div className="alert danger mt">{error}</div>}
      <div className="btn-row mt">
        <button className="btn primary" disabled={busy} onClick={save}>حفظ</button>
        {bill && !bill.active && <button className="btn" disabled={busy} onClick={async () => { if (await run(() => reactivateBill(bill.id), 'أُعيد تفعيل الالتزام') !== undefined) onClose(); }}>إعادة التفعيل</button>}
        {bill && bill.active && <button className="btn soft-danger" disabled={busy} onClick={remove}>حذف / إيقاف</button>}
      </div>
    </Sheet>
  );
}

function PaySheet({ occ, onClose }: { occ: BillOccurrence; onClose: () => void }) {
  const { currency, today, data } = useApp();
  const { busy, run } = useSaver();
  const toast = useToast();
  const firstStart = data.cycles.reduce((m, c) => (c.startDate < m ? c.startDate : m), '9999-12-31');
  const [amount, setAmount] = useState(toInput(occ.expected, currency));
  const [date, setDate] = useState(occ.dueDate < today && occ.dueDate >= firstStart ? occ.dueDate : today);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [error, setError] = useState('');

  async function save() {
    const a = readAmount(amount, currency);
    if (!a) return setError('اكتب المبلغ المدفوع.');
    const r = await run(() => payBill({ billId: occ.bill.id, dueDate: occ.dueDate, amount: a, date, paymentMethod: method }));
    if (r) {
      toast(r.created ? 'success' : 'info', r.created ? 'تم تسجيل الدفع' : 'هذه الفاتورة مسجلة كمدفوعة مسبقاً، لم تُسجَّل مرة ثانية');
      onClose();
    }
  }

  return (
    <Sheet title={`دفع: ${occ.bill.name}`} onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>استحقاق {formatDate(occ.dueDate)}. يُسجَّل الدفع مرة واحدة فقط لهذا الاستحقاق ويُربط بالالتزام.</p>
      <AmountField id="p-amount" label="المبلغ المدفوع فعلياً" value={amount} onChange={setAmount} currency={currency} big />
      <div className="field"><label htmlFor="p-date">تاريخ الدفع</label><input id="p-date" type="date" className="input" value={date} min={firstStart} max={today} onChange={(e) => setDate(e.target.value)} /></div>
      <div className="field"><span className="label">طريقة الدفع</span>
        <div className="chips">{(Object.keys(PAYMENT_METHODS) as PaymentMethod[]).map((m) => <button key={m} type="button" className={`chip ${method === m ? 'selected' : ''}`} onClick={() => setMethod(m)}>{PAYMENT_METHODS[m]}</button>)}</div>
      </div>
      {error && <div className="alert danger">{error}</div>}
      <div className="btn-row"><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'جارٍ الحفظ…' : 'تأكيد الدفع'}</button><button className="btn" onClick={onClose}>إلغاء</button></div>
    </Sheet>
  );
}
