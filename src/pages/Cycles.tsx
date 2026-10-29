import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApp } from '../hooks/useApp';
import { undoLatestSalary, updateCycle } from '../db/repo';
import { formatDate } from '../lib/dates';
import { computeCycleSummary, sortCycles, type CycleSummary } from '../lib/finance';
import type { Cycle } from '../lib/types';
import { AmountField, Empty, Money, Sheet, readAmount, toInput, useConfirm, useSaver } from '../components/ui';
import { CategoryDonut, DailyBars } from '../components/charts';
import { ConfirmSalarySheet, ExtendCycleSheet } from '../components/CycleSheets';
import { TxByDay } from '../components/TxList';

export default function Cycles() {
  const { data, today, currency } = useApp();
  const [sheet, setSheet] = useState<'confirm' | 'extend' | null>(null);
  const { run } = useSaver();
  const confirm = useConfirm();
  const cycles = sortCycles(data.cycles);
  const summaries = cycles.map((c) => computeCycleSummary(data, c, today)).reverse();
  const maxVal = Math.max(1, ...summaries.map((s) => Math.max(s.fundsIn, s.totalExpenses)));

  async function undo() {
    if (!(await confirm('التراجع عن آخر راتب مسجل؟ تُحذف الدورة الأخيرة وتعود الدورة السابقة نشطة. لا تُحذف أي مصروفات؛ تنتقل إلى الدورة السابقة حسب تاريخها.', { okText: 'تراجع' }))) return;
    await run(undoLatestSalary, 'تم التراجع عن آخر راتب');
  }

  return (
    <div>
      <div className="page-head">
        <div><h1>سجل الرواتب والدورات</h1><div className="sub">كل الدورات محفوظة ولا تُحذف عند بدء دورة جديدة</div></div>
        <div className="row">
          <button className="btn primary sm" onClick={() => setSheet('confirm')}>+ تسجيل راتب جديد</button>
          <button className="btn sm" onClick={() => setSheet('extend')}>تعديل موعد الراتب</button>
        </div>
      </div>

      {summaries.length > 1 && (
        <div className="card">
          <h2>مقارنة الدورات</h2>
          <div className="compare">
            {summaries.slice(0, 8).map((s) => (
              <div className="grp" key={s.cycle.id}>
                <div className="lbl"><span>{formatDate(s.cycle.startDate)}</span><span className="muted">صرف {s.spentPercentOfSalary}% من الراتب</span></div>
                <div className="line" style={{ width: `${(s.fundsIn / maxVal) * 100}%`, background: 'var(--income)' }} title="الدخل" />
                <div className="line" style={{ width: `${(s.totalExpenses / maxVal) * 100}%`, background: 'var(--expense)' }} title="المصروف" />
                <div className="line" style={{ width: `${(Math.max(0, s.savingsNet) / maxVal) * 100}%`, background: 'var(--saving)' }} title="الادخار" />
              </div>
            ))}
          </div>
          <div className="row small muted mt"><span>🟩 الدخل</span><span>🟥 المصروف</span><span>🟦 الادخار</span></div>
        </div>
      )}

      <div className="mt">
        {summaries.map((s) => <CycleCard key={s.cycle.id} s={s} currency={currency} />)}
      </div>

      {cycles.length > 1 && <button className="link-btn mt" onClick={undo}>تراجع عن آخر راتب مسجل (عند الخطأ)</button>}

      {sheet === 'confirm' && <ConfirmSalarySheet onClose={() => setSheet(null)} />}
      {sheet === 'extend' && <ExtendCycleSheet onClose={() => setSheet(null)} />}
    </div>
  );
}

function CycleCard({ s, currency }: { s: CycleSummary; currency: string }) {
  return (
    <Link to={`/cycles/${s.cycle.id}`} className="card" style={{ display: 'block', color: 'inherit' }}>
      <div className="card-head">
        <h3>{formatDate(s.bounds.start)} ← {formatDate(s.isActive ? s.bounds.plannedEnd : s.bounds.memberEnd)}</h3>
        <span className={`badge ${s.isActive ? 'ok' : ''}`}>{s.isActive ? 'الحالية' : 'مؤرشفة'}</span>
      </div>
      <div className="grid grid-3">
        <div><div className="small muted">الراتب</div><Money value={s.salary} currency={currency} className="bold c-income" /></div>
        <div><div className="small muted">المصروفات</div><Money value={s.totalExpenses} currency={currency} className="bold c-expense" /></div>
        <div><div className="small muted">{s.isActive ? 'المتاح الآن' : 'رصيد النهاية'}</div><Money value={s.availableFunds} currency={currency} className="bold" /></div>
      </div>
    </Link>
  );
}

export function CycleDetail() {
  const { id } = useParams();
  const { data, today, currency, categoriesById } = useApp();
  const [editing, setEditing] = useState(false);
  const cycle = data.cycles.find((c) => c.id === id);
  if (!cycle) return <div className="card"><Empty icon="🗂️" text="الدورة غير موجودة." /><Link to="/cycles">العودة</Link></div>;
  const s = computeCycleSummary(data, cycle, today);

  return (
    <div>
      <div className="page-head">
        <div>
          <Link to="/cycles" className="small">→ سجل الدورات</Link>
          <h1>دورة {formatDate(s.bounds.start)}</h1>
          <div className="sub">{s.isActive ? `حتى ${formatDate(s.bounds.plannedEnd)} (متوقع)` : `انتهت ${formatDate(s.bounds.memberEnd)}`} · {s.totalDays} يوم</div>
        </div>
        <button className="btn sm" onClick={() => setEditing(true)}>تعديل بيانات الدورة</button>
      </div>

      <div className="card">
        <h2>الحساب</h2>
        {s.carryIn > 0 && <div className="kv"><span className="k">مرحّل إلى الدورة</span><Money value={s.carryIn} currency={currency} className="v" /></div>}
        <div className="kv"><span className="k">الراتب</span><Money value={s.salary} currency={currency} className="v c-income" /></div>
        {s.otherIncome > 0 && <div className="kv"><span className="k">دخل إضافي</span><Money value={s.otherIncome} currency={currency} className="v c-income" /></div>}
        {s.debtIn > 0 && <div className="kv"><span className="k">ديون مستلمة / مستردة</span><Money value={s.debtIn} currency={currency} className="v" /></div>}
        <div className="kv"><span className="k">مصاريف متغيرة (بعد الاسترداد)</span><Money value={-s.variableSpending} currency={currency} className="v c-expense" /></div>
        <div className="kv"><span className="k">فواتير مدفوعة</span><Money value={-s.fixedPaid} currency={currency} className="v c-expense" /></div>
        <div className="kv"><span className="k">تحويلات إلى الادخار (صافي)</span><Money value={-s.savingsNet} currency={currency} className="v c-saving" /></div>
        {s.debtOut > 0 && <div className="kv"><span className="k">ديون مدفوعة / مُقرضة</span><Money value={-s.debtOut} currency={currency} className="v" /></div>}
        {s.carriedOut > 0 && <div className="kv"><span className="k">مرحّل إلى الدورة التالية</span><Money value={-s.carriedOut} currency={currency} className="v" /></div>}
        <div className="kv total"><span className="k">{s.isActive ? 'المتاح الآن' : 'رصيد نهاية الدورة'}</span><Money value={s.availableFunds} currency={currency} className="v" /></div>
        {s.isActive && (
          <>
            <div className="kv"><span className="k">محجوز للفواتير غير المدفوعة</span><Money value={-s.billsUnpaid} currency={currency} className="v c-warning" /></div>
            <div className="kv"><span className="k">ادخار مخطط لم يُحوَّل</span><Money value={-s.savingsRemaining} currency={currency} className="v c-saving" /></div>
            {s.reserve > 0 && <div className="kv"><span className="k">الاحتياطي</span><Money value={-s.reserve} currency={currency} className="v" /></div>}
            <div className="kv total"><span className="k">المتاح للصرف</span><Money value={s.spendable} currency={currency} className={`v ${s.spendable < 0 ? 'c-danger' : ''}`} /></div>
          </>
        )}
        <div className="kv"><span className="k">نسبة المصروف من الراتب</span><span className="v num">{s.spentPercentOfSalary}%</span></div>
        <div className="kv"><span className="k">متوسط الإنفاق اليومي المتغير</span><Money value={s.avgDailySpending} currency={currency} className="v" /></div>
        <div className="kv"><span className="k">أيام سُجّلت فيها مصروفات</span><span className="v num">{s.recordedDays} من {s.elapsedDays}</span></div>
        {cycle.note && <div className="small muted mt">ملاحظة: {cycle.note}</div>}
      </div>

      <div className="card mt"><h2>الإنفاق اليومي</h2><DailyBars days={s.days.filter((d) => d.status !== 'future').map((d) => ({ date: d.date, amount: d.actual, planned: d.planned }))} currency={currency} budget /></div>
      <div className="card mt"><h2>حسب الفئة</h2><CategoryDonut items={s.categories} categories={categoriesById} currency={currency} /></div>

      <h2 className="mt-lg" style={{ fontSize: 18 }}>عمليات الدورة ({s.transactions.length})</h2>
      {s.transactions.length === 0 ? <div className="card"><Empty icon="🧾" text="لا توجد عمليات." /></div> : <TxByDay txs={s.transactions} />}

      {editing && <EditCycleSheet cycle={cycle} s={s} onClose={() => setEditing(false)} />}
    </div>
  );
}

function EditCycleSheet({ cycle, s, onClose }: { cycle: Cycle; s: CycleSummary; onClose: () => void }) {
  const { currency, today } = useApp();
  const { busy, run } = useSaver();
  const [salary, setSalary] = useState(toInput(cycle.salaryAmount, currency));
  const [start, setStart] = useState(cycle.startDate);
  const [next, setNext] = useState(cycle.nextSalaryDate);
  const [savings, setSavings] = useState(toInput(cycle.savingsTarget, currency));
  const [reserve, setReserve] = useState(toInput(cycle.reserve, currency));
  const [carryIn, setCarryIn] = useState(toInput(cycle.carryIn, currency));
  const [note, setNote] = useState(cycle.note);
  const [error, setError] = useState('');

  async function save() {
    setError('');
    const a = readAmount(salary, currency);
    const sv = savings.trim() ? readAmount(savings, currency) : 0;
    const rs = reserve.trim() ? readAmount(reserve, currency) : 0;
    const ci = carryIn.trim() ? readAmount(carryIn, currency) : 0;
    if (!a || sv === null || rs === null || ci === null) return setError('تحقق من المبالغ.');
    const ok = await run(async () => {
      await updateCycle(cycle.id, {
        salaryAmount: a, startDate: start, savingsTarget: sv, reserve: rs, carryIn: ci, note,
        ...(s.isActive && next !== cycle.nextSalaryDate ? { nextSalaryDate: next } : {}),
      });
      return true;
    }, 'تم حفظ التعديل وإعادة حساب التقارير');
    if (ok) onClose();
  }

  return (
    <Sheet title="تعديل بيانات الدورة" onClose={onClose}>
      <AmountField id="ec-salary" label="الراتب" value={salary} onChange={setSalary} currency={currency} />
      <div className="field">
        <label htmlFor="ec-start">تاريخ البداية (استلام الراتب)</label>
        <input id="ec-start" type="date" className="input" value={start} max={today} onChange={(e) => setStart(e.target.value)} />
        <div className="help">تصحيح التاريخ يعيد توزيع العمليات على الدورات حسب تواريخها، ويعدّل نهاية الدورة السابقة تلقائياً.</div>
      </div>
      {s.isActive && (
        <div className="field">
          <label htmlFor="ec-next">موعد الراتب القادم</label>
          <input id="ec-next" type="date" className="input" value={next} onChange={(e) => setNext(e.target.value)} />
        </div>
      )}
      <AmountField id="ec-sav" label="الادخار المستهدف" value={savings} onChange={setSavings} currency={currency} allowZero />
      <AmountField id="ec-res" label="الاحتياطي" value={reserve} onChange={setReserve} currency={currency} allowZero />
      <AmountField id="ec-carry" label="المرحّل إلى هذه الدورة" value={carryIn} onChange={setCarryIn} currency={currency} allowZero
        help={s.bounds.prev ? 'يُعدَّل المبلغ المرحّل من الدورة السابقة بنفس القيمة حتى لا يُحسب مرتين.' : 'للدورة الأولى: الرصيد الابتدائي المضاف للميزانية.'} />
      <div className="field"><label htmlFor="ec-note">ملاحظة</label><input id="ec-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      {error && <div className="alert danger">{error}</div>}
      <div className="btn-row"><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</button><button className="btn" onClick={onClose}>إلغاء</button></div>
    </Sheet>
  );
}
