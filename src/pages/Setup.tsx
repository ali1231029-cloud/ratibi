import { useMemo, useState } from 'react';
import { useApp } from '../hooks/useApp';
import { completeSetup, DEFAULT_PLAN, type FixedBillInput } from '../db/repo';
import { parseBackupText, restoreBackup, type BackupCheck } from '../db/backup';
import { addDays, diffDays, formatDate, isISODate } from '../lib/dates';
import { CURRENCIES, currencyInfo } from '../lib/money';
import { computeCycleSummary } from '../lib/finance';
import { FREQUENCY_LABELS, type BillFrequency, type Cycle } from '../lib/types';
import { AmountField, Money, readAmount, useSaver } from '../components/ui';

/** On a new device or after clearing the browser, bring the data back instead of setting up again. */
function RestoreFromBackup() {
  const { busy, run } = useSaver();
  const [check, setCheck] = useState<BackupCheck | null>(null);
  return (
    <details className="card" style={{ marginBottom: 12 }}>
      <summary className="bold" style={{ cursor: 'pointer' }}>لديك نسخة احتياطية؟ استعدها بدلاً من الإعداد</summary>
      <input type="file" accept="application/json,.json" className="input mt" aria-label="ملف النسخة الاحتياطية"
        onChange={async (e) => { const f = e.target.files?.[0]; setCheck(f ? parseBackupText(await f.text()) : null); }} />
      {check && !check.ok && <div className="alert danger mt">النسخة غير صالحة: {check.errors.join(' ')}</div>}
      {check?.ok && (
        <>
          <div className="alert success mt">الملف سليم: {check.counts.cycles} دورة، {check.counts.transactions} عملية.</div>
          <button className="btn primary block mt" disabled={busy}
            onClick={() => void run(() => restoreBackup(check.backup!, 'replace'), 'تمت استعادة بياناتك')}>استعادة البيانات</button>
        </>
      )}
    </details>
  );
}

interface BillDraft { key: number; name: string; amount: string; firstDueDate: string; frequency: BillFrequency; categoryId: string }

export default function Setup() {
  const { data, today } = useApp();
  const { busy, run } = useSaver();
  const [step, setStep] = useState(0);
  const [currency, setCurrency] = useState('IQD');
  const [salary, setSalary] = useState('');
  const [received, setReceived] = useState(today);
  const [knowNext, setKnowNext] = useState(true);
  const [nextDate, setNextDate] = useState(addDays(today, 30));
  const [bills, setBills] = useState<BillDraft[]>([]);
  const [savings, setSavings] = useState('');
  const [reserve, setReserve] = useState('');
  const [initial, setInitial] = useState('');
  const [includeInitial, setIncludeInitial] = useState(true);
  const [error, setError] = useState('');

  const effectiveNext = knowNext ? nextDate : addDays(received, 30);
  const amt = (v: string) => (v.trim() ? readAmount(v, currency) : 0);

  function validateStep(s: number): string {
    if (s === 0) {
      const v = amt(salary);
      if (!v) return 'اكتب مبلغ الراتب.';
      if (!isISODate(received)) return 'اختر تاريخ استلام الراتب.';
      if (received > today) return 'تاريخ الاستلام لا يمكن أن يكون في المستقبل.';
      if (!isISODate(effectiveNext) || effectiveNext <= received) return 'موعد الراتب القادم يجب أن يكون بعد تاريخ الاستلام.';
    }
    if (s === 1) {
      for (const b of bills) {
        if (!b.name.trim()) return 'اكتب اسم كل التزام أو احذفه.';
        if (!amt(b.amount)) return `اكتب مبلغ "${b.name}".`;
        if (!isISODate(b.firstDueDate)) return `اختر تاريخ استحقاق "${b.name}".`;
      }
    }
    if (s === 2) {
      if (amt(savings) === null || amt(reserve) === null || amt(initial) === null) return 'تحقق من المبالغ المدخلة.';
    }
    return '';
  }

  function next() {
    const e = validateStep(step);
    setError(e);
    if (!e) setStep(step + 1);
  }

  const billInputs: FixedBillInput[] = bills.map((b) => ({
    name: b.name, amount: amt(b.amount) ?? 0, firstDueDate: b.firstDueDate, frequency: b.frequency, categoryId: b.categoryId,
  }));

  const preview = useMemo(() => {
    if (step < 3) return null;
    const cycle: Cycle = {
      id: 'preview', startDate: received, nextSalaryDate: effectiveNext, salaryAmount: amt(salary) ?? 0,
      carryIn: includeInitial ? amt(initial) ?? 0 : 0, carriedOut: 0, savingsTarget: amt(savings) ?? 0,
      reserve: amt(reserve) ?? 0, plan: DEFAULT_PLAN, status: 'active', note: '', createdAt: '', updatedAt: '', archivedAt: null,
    };
    return computeCycleSummary({
      ...data, cycles: [cycle], transactions: [], dayBudgets: [],
      bills: billInputs.map((b, i) => ({ ...b, id: `p${i}`, active: true, endDate: null, createdAt: '', updatedAt: '' })),
    }, cycle, today);
  }, [step]); // recomputed each time the review step is opened

  async function finish() {
    await run(() => completeSetup({
      currency, salaryAmount: amt(salary) ?? 0, receivedDate: received, nextSalaryDate: effectiveNext,
      savingsTarget: amt(savings) ?? 0, reserve: amt(reserve) ?? 0, initialBalance: amt(initial) ?? 0,
      includeInitialInCycle: includeInitial, bills: billInputs,
    }), 'تم حفظ الراتب وبدء الدورة');
  }

  const cats = data.categories.filter((c) => !c.archived);
  const addBill = (name = '', categoryId = 'cat-other') => setBills((b) => [...b, {
    key: Date.now() + Math.random(), name, amount: '', firstDueDate: addDays(received, 7), frequency: 'monthly', categoryId,
  }]);
  const setBill = (key: number, patch: Partial<BillDraft>) => setBills((bs) => bs.map((b) => (b.key === key ? { ...b, ...patch } : b)));

  return (
    <div className="setup">
      <div className="brand" style={{ padding: 0 }}><img src="./icon.svg" alt="" />راتبي</div>
      <p className="muted" style={{ marginTop: 4 }}>إعداد سريع لمرة واحدة. تُحفظ بياناتك على هذا الجهاز ولن يُطلب منك إدخالها مجدداً.</p>
      {step === 0 && <RestoreFromBackup />}
      <div className="steps">{[0, 1, 2, 3].map((i) => <div key={i} className={i <= step ? 'on' : ''} />)}</div>

      {step === 0 && (
        <div className="card">
          <h2>الراتب</h2>
          <div className="field">
            <label htmlFor="currency">العملة</label>
            <select id="currency" className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {Object.values(CURRENCIES).map((c) => <option key={c.code} value={c.code}>{c.name} ({c.symbol})</option>)}
            </select>
          </div>
          <AmountField id="salary" label="الراتب الشهري" value={salary} onChange={setSalary} currency={currency} big autoFocus />
          <div className="field">
            <label htmlFor="received">تاريخ استلام الراتب الفعلي</label>
            <input id="received" type="date" className="input" value={received} max={today} onChange={(e) => setReceived(e.target.value)} />
          </div>
          <label className="check">
            <input type="checkbox" checked={!knowNext} onChange={(e) => setKnowNext(!e.target.checked)} />
            <span>لا أعرف موعد الراتب القادم — استخدم دورة 30 يوماً (يمكن تعديلها لاحقاً)</span>
          </label>
          {knowNext && (
            <div className="field">
              <label htmlFor="next">موعد الراتب القادم المتوقع</label>
              <input id="next" type="date" className="input" value={nextDate} min={addDays(received, 1)} onChange={(e) => setNextDate(e.target.value)} />
            </div>
          )}
          {isISODate(received) && isISODate(effectiveNext) && effectiveNext > received && (
            <div className="alert info">الدورة من {formatDate(received)} إلى {formatDate(addDays(effectiveNext, -1))} — {diffDays(received, effectiveNext)} يوماً.</div>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="card">
          <h2>المصاريف الثابتة والفواتير</h2>
          <p className="muted small" style={{ marginTop: 0 }}>مثل الإيجار والإنترنت والكهرباء والأقساط. تُحجز مبالغها من الميزانية حتى تدفعها، ولا تُخصم مرتين.</p>
          {bills.map((b) => (
            <div className="bill-row" key={b.key}>
              <input className="input full" placeholder="اسم الالتزام" value={b.name} onChange={(e) => setBill(b.key, { name: e.target.value })} aria-label="اسم الالتزام" />
              <input className="input" inputMode="numeric" placeholder={`المبلغ (${currencyInfo(currency).symbol})`} value={b.amount} onChange={(e) => setBill(b.key, { amount: e.target.value })} aria-label="المبلغ" />
              <select className="input" value={b.frequency} onChange={(e) => setBill(b.key, { frequency: e.target.value as BillFrequency })} aria-label="التكرار">
                {(Object.keys(FREQUENCY_LABELS) as BillFrequency[]).map((f) => <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>)}
              </select>
              <label className="small muted full" htmlFor={`due-${b.key}`}>تاريخ الاستحقاق القادم</label>
              <input id={`due-${b.key}`} type="date" className="input" value={b.firstDueDate} onChange={(e) => setBill(b.key, { firstDueDate: e.target.value })} />
              <select className="input" value={b.categoryId} onChange={(e) => setBill(b.key, { categoryId: e.target.value })} aria-label="الفئة">
                {cats.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
              </select>
              <button type="button" className="btn sm soft-danger full" onClick={() => setBills((bs) => bs.filter((x) => x.key !== b.key))}>حذف</button>
            </div>
          ))}
          <div className="chips">
            <button type="button" className="chip" onClick={() => addBill('الإيجار', 'cat-rent')}>+ الإيجار</button>
            <button type="button" className="chip" onClick={() => addBill('الإنترنت', 'cat-internet')}>+ الإنترنت</button>
            <button type="button" className="chip" onClick={() => addBill('الكهرباء', 'cat-utilities')}>+ الكهرباء</button>
            <button type="button" className="chip" onClick={() => addBill('', 'cat-installments')}>+ قسط</button>
            <button type="button" className="chip" onClick={() => addBill()}>+ التزام آخر</button>
          </div>
          {bills.length === 0 && <p className="muted small">يمكنك تخطي هذه الخطوة وإضافة الالتزامات لاحقاً.</p>}
        </div>
      )}

      {step === 2 && (
        <div className="card">
          <h2>الادخار والرصيد</h2>
          <AmountField id="savings" label="مبلغ الادخار المستهدف لهذه الدورة" value={savings} onChange={setSavings} currency={currency} allowZero
            help="يُحجز من الميزانية ولا يُحسب مصروفاً. عند تحويله فعلياً يُسجَّل كتحويل داخلي." />
          <AmountField id="reserve" label="مبلغ احتياطي للطوارئ (اختياري)" value={reserve} onChange={setReserve} currency={currency} allowZero
            help="مبلغ لا يدخل في الميزانية اليومية." />
          <AmountField id="initial" label="الرصيد الابتدائي (أموال موجودة قبل الراتب)" value={initial} onChange={setInitial} currency={currency} allowZero />
          {amt(initial) ? (
            <label className="check">
              <input type="checkbox" checked={includeInitial} onChange={(e) => setIncludeInitial(e.target.checked)} />
              <span>أضف هذا الرصيد إلى ميزانية الصرف في هذه الدورة</span>
            </label>
          ) : null}
        </div>
      )}

      {step === 3 && preview && (
        <div className="card">
          <h2>مراجعة قبل الحفظ</h2>
          <div className="kv"><span className="k">الراتب</span><Money value={preview.salary} currency={currency} className="v c-income" /></div>
          {preview.carryIn > 0 && <div className="kv"><span className="k">الرصيد الابتدائي</span><Money value={preview.carryIn} currency={currency} className="v" /></div>}
          <div className="kv"><span className="k">الالتزامات خلال الدورة</span><Money value={-preview.billsUnpaid} currency={currency} className="v c-expense" /></div>
          <div className="kv"><span className="k">الادخار المخطط</span><Money value={-preview.savingsRemaining} currency={currency} className="v c-saving" /></div>
          {preview.reserve > 0 && <div className="kv"><span className="k">الاحتياطي</span><Money value={-preview.reserve} currency={currency} className="v" /></div>}
          <div className="kv total"><span className="k">المتاح للصرف المتغير</span><Money value={preview.spendable} currency={currency} className={`v ${preview.spendable < 0 ? 'c-danger' : ''}`} /></div>
          <div className="kv"><span className="k">عدد أيام الدورة</span><span className="v num">{preview.totalDays}</span></div>
          <div className="kv total"><span className="k">ميزانية اليوم المقترحة</span><Money value={preview.todayBudget} currency={currency} className="v c-income" /></div>
          {preview.spendable < 0 && <div className="alert danger mt">الالتزامات والادخار أكبر من الراتب. راجع المبالغ أو استمر وسيظهر العجز بوضوح.</div>}
        </div>
      )}

      {error && <div className="alert danger mt" role="alert">{error}</div>}

      <div className="btn-row mt-lg">
        {step > 0 && <button className="btn" onClick={() => { setError(''); setStep(step - 1); }} disabled={busy}>رجوع</button>}
        {step < 3 && <button className="btn primary" onClick={next}>{step === 1 && bills.length === 0 ? 'تخطي' : 'التالي'}</button>}
        {step === 3 && <button className="btn primary" onClick={finish} disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ وبدء الدورة'}</button>}
      </div>
    </div>
  );
}
