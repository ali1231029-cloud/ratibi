import { useState } from 'react';
import { useApp } from '../hooks/useApp';
import { setDayBudget, updateSettings } from '../db/repo';
import { formatDate, formatShortDate, WEEKDAY_NAMES } from '../lib/dates';
import { isVariableSpending, type DayRow } from '../lib/finance';
import { AmountField, Money, Seg, Sheet, readAmount, toInput, useSaver } from '../components/ui';
import { DailyBars } from '../components/charts';
import { TxItem } from '../components/TxList';
import { useTxSheet } from '../components/TxSheet';
import type { BudgetMode } from '../lib/types';

const STATUS: Record<DayRow['status'], [string, string]> = {
  future: ['قادم', ''],
  unrecorded: ['غير مسجل', ''],
  ok: ['ضمن الميزانية', 'ok'],
  over: ['تجاوز', 'over'],
  overdue: ['بعد موعد الراتب', 'warn'],
  deficit: ['عجز', 'danger'],
};

export default function Budget() {
  const { current: s, currency, data } = useApp();
  const { busy, run } = useSaver();
  const [day, setDay] = useState<DayRow | null>(null);
  const [showPlan, setShowPlan] = useState(false);
  if (!s) return null;
  const plan = s.cycle.plan;

  async function setMode(mode: BudgetMode) {
    await run(() => updateSettings({ plan: { ...(data.settings?.plan ?? plan), mode } }), mode === 'equal' ? 'الوضع المتساوي مفعّل' : 'الوضع المرن مفعّل');
  }

  return (
    <div>
      <div className="page-head">
        <div><h1>جدول الميزانية</h1><div className="sub">كل أيام الدورة — اضغط على يوم لعرض مصروفاته أو إضافة مصروف</div></div>
      </div>

      <div className="card">
        <div className="row between">
          <div className="grow"><Seg value={plan.mode} onChange={(m) => void setMode(m)} options={[['equal', 'توزيع متساوٍ'], ['flexible', 'توزيع مرن']]} /></div>
          {plan.mode === 'flexible' && <button className="btn sm" onClick={() => setShowPlan(true)} disabled={busy}>إعداد الأوزان</button>}
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          {plan.mode === 'equal'
            ? 'الميزانية المتبقية تُقسَّم بالتساوي على الأيام المتبقية. ما توفّره اليوم يُضاف للأيام القادمة، وما تتجاوزه يُخصم منها.'
            : `أيام العطلة (${plan.weekendDays.map((d) => WEEKDAY_NAMES[d]).join('، ')}) تأخذ وزن ${plan.workdayWeight > 0 ? (plan.weekendWeight / plan.workdayWeight).toFixed(1) : '—'}× مقارنة بأيام العمل. يمكنك تحديد ميزانية ثابتة لأي يوم.`}
        </p>
        <div className="grid grid-3 mt">
          <div className="stat"><div className="label">ميزانية الصرف للدورة</div><div className="value"><Money value={s.variableAllocation} currency={currency} /></div></div>
          <div className="stat"><div className="label">المتبقي</div><div className={`value ${s.spendable < 0 ? 'c-danger' : ''}`}><Money value={s.spendable} currency={currency} /></div></div>
          <div className="stat"><div className="label">الأيام المتبقية</div><div className="value num">{s.remainingDays}</div></div>
        </div>
      </div>

      <div className="card mt">
        <h3>الإنفاق اليومي مقابل المخطط</h3>
        <DailyBars days={s.days.filter((d) => !d.afterPlannedEnd || d.actual !== null).map((d) => ({ date: d.date, amount: d.status === 'future' ? null : d.actual, planned: d.planned }))} currency={currency} budget />
        <div className="small muted mt">الأعمدة المخططة بخطوط مائلة = أيام لم تُسجَّل فيها مصروفات أو أيام قادمة.</div>
      </div>

      <div className="card mt">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>التاريخ</th><th>اليوم</th><th>المخطط</th><th>الفعلي</th><th>الفرق</th><th>الحالة</th><th>المتاح بعده</th></tr>
            </thead>
            <tbody>
              {s.days.map((d) => (
                <tr key={d.date} className={`clickable ${d.isToday ? 'today' : ''} ${d.status === 'future' ? 'future' : ''}`} onClick={() => setDay(d)}>
                  <td className="num">{formatShortDate(d.date)}{d.isToday ? ' • اليوم' : ''}</td>
                  <td>{WEEKDAY_NAMES[d.weekday]}</td>
                  <td><Money value={d.planned} currency={currency} />{d.fixedOverride ? ' 📌' : ''}</td>
                  <td>{d.actual === null ? <span className="muted">—</span> : <Money value={d.actual} currency={currency} />}</td>
                  <td>{d.diff === null ? <span className="muted">—</span> : <Money value={d.diff} currency={currency} className={d.diff < 0 ? 'c-danger' : 'c-income'} sign />}</td>
                  <td><span className={`badge ${STATUS[d.status][1]}`}>{STATUS[d.status][0]}</span></td>
                  <td><Money value={d.poolAfter} currency={currency} className={d.poolAfter < 0 ? 'c-danger' : ''} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {day && <DaySheet day={day} onClose={() => setDay(null)} />}
      {showPlan && <PlanSheet onClose={() => setShowPlan(false)} />}
    </div>
  );
}

function DaySheet({ day, onClose }: { day: DayRow; onClose: () => void }) {
  const { data, currency, today } = useApp();
  const openTx = useTxSheet();
  const { busy, run } = useSaver();
  const existing = data.dayBudgets.find((b) => b.date === day.date);
  const [fixed, setFixed] = useState(existing ? toInput(existing.amount, currency) : '');
  const txs = data.transactions.filter((t) => t.date === day.date);
  const variable = txs.filter(isVariableSpending);
  const others = txs.filter((t) => !isVariableSpending(t));

  async function saveFixed(clear: boolean) {
    const v = clear ? null : readAmount(fixed, currency);
    if (!clear && v === null) return;
    const ok = await run(async () => { await setDayBudget(day.date, v); return true; }, clear ? 'أُلغيت الميزانية الثابتة لهذا اليوم' : 'تم تحديد ميزانية اليوم');
    if (ok) onClose();
  }

  return (
    <Sheet title={formatDate(day.date, true)} onClose={onClose}>
      <div className="kv"><span className="k">الميزانية المخططة</span><Money value={day.planned} currency={currency} className="v" /></div>
      <div className="kv"><span className="k">المصروف الفعلي</span>{day.actual === null ? <span className="v muted">لم يُسجَّل شيء</span> : <Money value={day.actual} currency={currency} className="v c-expense" />}</div>
      {variable.length + others.length > 0 && (
        <div className="list mt">{[...variable, ...others].map((t) => <TxItem key={t.id} t={t} />)}</div>
      )}
      {day.date <= today && (
        <button className="btn primary block mt" onClick={() => { onClose(); openTx({ type: 'expense', preset: { date: day.date } }); }}>+ إضافة مصروف لهذا اليوم</button>
      )}
      {!day.afterPlannedEnd && day.date >= today && (
        <>
          <hr className="sep" />
          <AmountField id="day-fixed" label="ميزانية ثابتة لهذا اليوم (اختياري)" value={fixed} onChange={setFixed} currency={currency} allowZero
            help="مثلاً يوم مناسبة. تُوزَّع بقية الميزانية على الأيام الأخرى تلقائياً." />
          <div className="btn-row">
            <button className="btn" disabled={busy || !fixed.trim()} onClick={() => saveFixed(false)}>حفظ الميزانية الثابتة</button>
            {existing && <button className="btn soft-danger" disabled={busy} onClick={() => saveFixed(true)}>إلغاء التثبيت</button>}
          </div>
        </>
      )}
    </Sheet>
  );
}

export function PlanSheet({ onClose }: { onClose: () => void }) {
  const { data } = useApp();
  const { busy, run } = useSaver();
  const plan = data.settings!.plan;
  const [weekend, setWeekend] = useState<number[]>(plan.weekendDays);
  const [workW, setWorkW] = useState(String(plan.workdayWeight));
  const [endW, setEndW] = useState(String(plan.weekendWeight));
  const [error, setError] = useState('');

  async function save() {
    const w1 = Number(workW), w2 = Number(endW);
    if (!(w1 >= 0 && w2 >= 0 && w1 + w2 > 0) || !Number.isFinite(w1) || !Number.isFinite(w2)) return setError('الأوزان يجب أن تكون أرقاماً موجبة.');
    const ok = await run(async () => { await updateSettings({ plan: { mode: 'flexible', weekendDays: weekend, workdayWeight: w1, weekendWeight: w2 } }); return true; }, 'تم حفظ التوزيع المرن');
    if (ok) onClose();
  }

  return (
    <Sheet title="التوزيع المرن" onClose={onClose}>
      <div className="field">
        <span className="label">أيام العطلة</span>
        <div className="chips">
          {WEEKDAY_NAMES.map((n, i) => (
            <button key={n} type="button" className={`chip ${weekend.includes(i) ? 'selected' : ''}`}
              onClick={() => setWeekend((w) => (w.includes(i) ? w.filter((x) => x !== i) : [...w, i].sort()))}>{n}</button>
          ))}
        </div>
      </div>
      <div className="grid grid-2">
        <div className="field"><label htmlFor="w1">وزن يوم العمل</label><input id="w1" className="input" inputMode="decimal" value={workW} onChange={(e) => setWorkW(e.target.value)} /></div>
        <div className="field"><label htmlFor="w2">وزن يوم العطلة</label><input id="w2" className="input" inputMode="decimal" value={endW} onChange={(e) => setEndW(e.target.value)} /></div>
      </div>
      <div className="help small muted">مثال: وزن العمل 1 ووزن العطلة 2 يعني أن يوم العطلة يأخذ ضعف ميزانية يوم العمل.</div>
      {error && <div className="alert danger mt">{error}</div>}
      <div className="btn-row mt"><button className="btn primary" disabled={busy} onClick={save}>حفظ</button><button className="btn" onClick={onClose}>إلغاء</button></div>
    </Sheet>
  );
}
