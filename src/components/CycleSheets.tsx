import { useState } from 'react';
import { useApp } from '../hooks/useApp';
import { confirmSalary, updateCycle } from '../db/repo';
import { addDays, diffDays, formatDate } from '../lib/dates';
import { computeCycleSummary } from '../lib/finance';
import { AmountField, Money, Sheet, readAmount, toInput, useSaver } from './ui';

/** Records a newly received salary. Never runs automatically — only on the user's confirmation. */
export function ConfirmSalarySheet({ onClose }: { onClose: () => void }) {
  const { data, today, currency, current } = useApp();
  const { busy, run } = useSaver();
  const settings = data.settings!;
  const cycle = current!.cycle;
  const [amount, setAmount] = useState(toInput(cycle.salaryAmount, currency));
  const [received, setReceived] = useState(today > cycle.startDate ? today : addDays(cycle.startDate, 1));
  const [next, setNext] = useState(addDays(today, settings.defaultCycleLength));
  const [savings, setSavings] = useState(toInput(settings.defaultSavingsTarget, currency));
  const [reserve, setReserve] = useState(toInput(settings.defaultReserve, currency));
  const [carry, setCarry] = useState(false);
  const [error, setError] = useState('');

  // What the current cycle has left up to the day before the new salary.
  const before = received > cycle.startDate
    ? computeCycleSummary({ ...data, transactions: data.transactions.filter((t) => t.date < received) }, cycle, addDays(received, -1))
    : null;
  const maxCarry = Math.max(0, before?.availableFunds ?? 0);
  const [carryAmount, setCarryAmount] = useState('');
  const movedTx = data.transactions.filter((t) => t.date >= received && t.date >= cycle.startDate).length;

  async function save() {
    setError('');
    const a = readAmount(amount, currency);
    const s = savings.trim() ? readAmount(savings, currency) : 0;
    const r = reserve.trim() ? readAmount(reserve, currency) : 0;
    const c = carry ? (carryAmount.trim() ? readAmount(carryAmount, currency) : maxCarry) : 0;
    if (!a) return setError('اكتب مبلغ الراتب.');
    if (s === null || r === null || c === null) return setError('تحقق من المبالغ.');
    if (received <= cycle.startDate) return setError('تاريخ الاستلام يجب أن يكون بعد بداية الدورة الحالية.');
    if (received > today) return setError('تاريخ الاستلام لا يمكن أن يكون في المستقبل.');
    if (next <= received) return setError('موعد الراتب القادم يجب أن يكون بعد تاريخ الاستلام.');
    if (c > maxCarry) return setError('مبلغ الترحيل أكبر من المتبقي.');
    const ok = await run(async () => {
      await confirmSalary({ amount: a, receivedDate: received, nextSalaryDate: next, savingsTarget: s, reserve: r, carryOver: c });
      return true;
    }, 'تم تسجيل الراتب الجديد وأرشفة الدورة السابقة');
    if (ok) onClose();
  }

  return (
    <Sheet title="تأكيد استلام راتب جديد" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <AmountField id="ns-amount" label="مبلغ الراتب" value={amount} onChange={setAmount} currency={currency} big />
        <div className="field">
          <label htmlFor="ns-date">تاريخ الاستلام الفعلي</label>
          <input id="ns-date" type="date" className="input" value={received} min={addDays(cycle.startDate, 1)} max={today} onChange={(e) => setReceived(e.target.value)} />
          {movedTx > 0 && <div className="help">{movedTx} عملية مسجلة من هذا التاريخ فصاعداً ستنتقل إلى الدورة الجديدة (حسب تاريخها).</div>}
        </div>
        <div className="field">
          <label htmlFor="ns-next">موعد الراتب القادم المتوقع</label>
          <input id="ns-next" type="date" className="input" value={next} min={addDays(received, 1)} onChange={(e) => setNext(e.target.value)} />
          {next > received && <div className="help">مدة الدورة الجديدة: {diffDays(received, next)} يوماً.</div>}
        </div>
        <AmountField id="ns-sav" label="الادخار المستهدف للدورة الجديدة" value={savings} onChange={setSavings} currency={currency} allowZero />
        <AmountField id="ns-res" label="الاحتياطي" value={reserve} onChange={setReserve} currency={currency} allowZero />
        <div className="card" style={{ background: 'var(--surface-2)', boxShadow: 'none' }}>
          <div className="kv"><span className="k">المتبقي في الدورة الحالية</span><Money value={before?.availableFunds ?? 0} currency={currency} className="v" /></div>
          <label className="check">
            <input type="checkbox" checked={carry} onChange={(e) => setCarry(e.target.checked)} disabled={maxCarry <= 0} />
            <span>ترحيل المتبقي إلى الدورة الجديدة (يُخصم من الدورة القديمة ويُضاف للجديدة مرة واحدة)</span>
          </label>
          {carry && (
            <AmountField id="ns-carry" label="مبلغ الترحيل" value={carryAmount} onChange={setCarryAmount} currency={currency} allowZero
              help={<>اتركه فارغاً لترحيل كامل المتبقي (<Money value={maxCarry} currency={currency} />).</>} />
          )}
        </div>
        {error && <div className="alert danger mt" role="alert">{error}</div>}
        <div className="btn-row mt">
          <button type="submit" className="btn primary" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'تأكيد وتسجيل الراتب'}</button>
          <button type="button" className="btn" onClick={onClose}>إلغاء</button>
        </div>
      </form>
    </Sheet>
  );
}

/** Moves the expected salary date (e.g. the salary is late). Nothing is deleted. */
export function ExtendCycleSheet({ onClose }: { onClose: () => void }) {
  const { today, current } = useApp();
  const { busy, run } = useSaver();
  const cycle = current!.cycle;
  const [next, setNext] = useState(cycle.nextSalaryDate > today ? cycle.nextSalaryDate : addDays(today, 3));
  const [error, setError] = useState('');

  async function save() {
    setError('');
    if (next <= cycle.startDate) return setError('الموعد يجب أن يكون بعد بداية الدورة.');
    const ok = await run(async () => { await updateCycle(cycle.id, { nextSalaryDate: next }); return true; }, 'تم تعديل موعد الراتب وإعادة حساب الميزانية');
    if (ok) onClose();
  }

  return (
    <Sheet title="تعديل موعد الراتب القادم" onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>إذا تأخر الراتب، مدّد الدورة الحالية. لا تُحذف أي بيانات، وتُوزَّع الميزانية المتبقية على الأيام الجديدة.</p>
      <div className="field">
        <label htmlFor="ext-next">الموعد الجديد المتوقع</label>
        <input id="ext-next" type="date" className="input" value={next} min={addDays(cycle.startDate, 1)} onChange={(e) => setNext(e.target.value)} />
        <div className="help">نهاية الدورة: {formatDate(addDays(next, -1))} — المدة الكلية {diffDays(cycle.startDate, next)} يوماً.</div>
      </div>
      <div className="btn-row">
        <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</button>
        <button className="btn" onClick={onClose}>إلغاء</button>
      </div>
      {error && <div className="alert danger mt" role="alert">{error}</div>}
    </Sheet>
  );
}

export function SalaryDueBanner() {
  const { current, today } = useApp();
  const [sheet, setSheet] = useState<'confirm' | 'extend' | null>(null);
  if (!current?.isActive) return null;
  const due = current.cycle.nextSalaryDate;
  if (today < due) return null;
  return (
    <>
      <div className="alert warning" style={{ flexWrap: 'wrap' }}>
        <span className="grow">حلّ موعد الراتب المتوقع ({formatDate(due)}). هل استلمت الراتب؟ لن يُضاف أي راتب دون تأكيدك.</span>
        <div className="btn-row" style={{ width: '100%' }}>
          <button className="btn primary sm" onClick={() => setSheet('confirm')}>نعم، استلمته</button>
          <button className="btn sm" onClick={() => setSheet('extend')}>لم يصل — عدّل الموعد</button>
        </div>
      </div>
      {sheet === 'confirm' && <ConfirmSalarySheet onClose={() => setSheet(null)} />}
      {sheet === 'extend' && <ExtendCycleSheet onClose={() => setSheet(null)} />}
    </>
  );
}
