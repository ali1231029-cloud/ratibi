import { Link } from 'react-router-dom';
import { useApp } from '../hooks/useApp';
import { formatDate } from '../lib/dates';
import { Money, Progress, Stat } from '../components/ui';
import { CategoryDonut } from '../components/charts';
import { TxItem } from '../components/TxList';
import { SalaryDueBanner } from '../components/CycleSheets';
import { useTxSheet } from '../components/TxSheet';

export default function Dashboard() {
  const { current: s, currency, categoriesById, wallet, savings } = useApp();
  const openTx = useTxSheet();
  if (!s) return null;
  const recent = [...s.transactions].sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : a.date < b.date ? 1 : -1)).slice(0, 6);
  const lastExpense = [...s.transactions].filter((t) => t.type === 'expense' && !t.billId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const paidBills = s.bills.filter((b) => b.payment);
  const unpaidBills = s.bills.filter((b) => !b.payment);
  const usedPct = s.variableAllocation > 0 ? (s.variableSpending / s.variableAllocation) * 100 : 0;
  const deficit = s.spendable < 0;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>الرئيسية</h1>
          <div className="sub">دورة الراتب من {formatDate(s.bounds.start)} إلى {formatDate(s.bounds.plannedEnd)}</div>
        </div>
      </div>

      <SalaryDueBanner />

      <div className={`hero mt ${deficit ? 'deficit' : ''}`}>
        <div className="label">{deficit ? 'عجز في الميزانية' : s.remainingDays > 0 ? 'المتبقي من ميزانية اليوم' : 'المتاح للصرف'}</div>
        <div className="big">
          <Money value={deficit ? s.spendable : s.remainingDays > 0 ? s.todayRemaining : s.spendable} currency={currency} />
        </div>
        <div className="row">
          {s.remainingDays > 0 && <span>ميزانية اليوم: <b><Money value={s.todayBudget} currency={currency} /></b></span>}
          <span>صرفت اليوم: <b><Money value={s.todaySpending} currency={currency} /></b></span>
          <span>{s.remainingDays > 0 ? <>متبقٍ <b className="num">{s.remainingDays}</b> يوم حتى الراتب</> : <>تأخر الراتب <b className="num">{s.overdueDays}</b> يوم</>}</span>
        </div>
      </div>

      {s.alerts.length > 0 && (
        <div className="mt">
          {s.alerts.map((a) => <div key={a.text} className={`alert ${a.level}`}>{a.text}</div>)}
        </div>
      )}

      <div className="grid grid-3 mt">
        <Stat label="الراتب المسجل" value={s.salary} currency={currency} tone="c-income" hint={s.carryIn > 0 ? <>+ مرحّل <Money value={s.carryIn} currency={currency} /></> : s.otherIncome > 0 ? <>+ دخل إضافي <Money value={s.otherIncome} currency={currency} /></> : undefined} />
        <Stat label="المتاح للصرف في الدورة" value={s.spendable} currency={currency} tone={deficit ? 'c-danger' : ''} hint="بعد حجز الفواتير والادخار" />
        <Stat label="إجمالي المصروفات" value={s.totalExpenses} currency={currency} tone="c-expense" hint={<>متغيرة <Money value={s.variableSpending} currency={currency} /></>} />
        <Stat label="الرصيد النقدي الفعلي" value={wallet} currency={currency} hint="كل أموالك خارج الادخار" />
        <Stat label="متوسط الإنفاق اليومي" value={s.avgDailySpending} currency={currency} hint={`خلال ${s.elapsedDays} يوم`} />
        <Stat label="نسبة المصروف من الراتب" value={`${s.spentPercentOfSalary}%`} hint={`يوم ${Math.min(s.elapsedDays, s.totalDays)} من ${s.totalDays}`} />
      </div>

      <div className="card mt">
        <div className="card-head"><h2>ميزانية الصرف المتغير</h2><Link to="/budget" className="small">الجدول اليومي ←</Link></div>
        <Progress value={usedPct} tone={usedPct > 100 ? 'danger' : usedPct > 85 ? 'warn' : ''} />
        <div className="row between small mt">
          <span>صُرف <Money value={s.variableSpending} currency={currency} className="bold" /></span>
          <span>من <Money value={s.variableAllocation} currency={currency} className="bold" /></span>
        </div>
        {s.remainingDays > 1 && !deficit && <div className="small muted mt">ميزانية الغد المتوقعة: <Money value={s.tomorrowBudget} currency={currency} className="bold" /></div>}
      </div>

      <div className="grid grid-2 mt">
        <div className="card">
          <div className="card-head"><h3>الفواتير</h3><Link to="/bills" className="small">الكل ←</Link></div>
          <div className="kv"><span className="k">مدفوعة ({paidBills.length})</span><Money value={s.fixedPaid} currency={currency} className="v c-income" /></div>
          <div className="kv"><span className="k">غير مدفوعة ({unpaidBills.length})</span><Money value={s.billsUnpaid} currency={currency} className="v c-warning" /></div>
          {unpaidBills[0] && <div className="small muted mt">الأقرب: {unpaidBills[0].bill.name} — {formatDate(unpaidBills[0].dueDate)}</div>}
        </div>
        <div className="card">
          <div className="card-head"><h3>الادخار</h3><Link to="/savings" className="small">الأهداف ←</Link></div>
          <div className="kv"><span className="k">المستهدف للدورة</span><Money value={s.savingsTarget} currency={currency} className="v" /></div>
          <div className="kv"><span className="k">المحوَّل فعلياً</span><Money value={s.savingsNet} currency={currency} className="v c-saving" /></div>
          <Progress value={s.savingsTarget > 0 ? (s.savingsNet / s.savingsTarget) * 100 : 0} tone="saving" />
          <div className="small muted mt">إجمالي المدخرات: <Money value={savings} currency={currency} className="bold" /></div>
        </div>
      </div>

      <div className="card mt">
        <h2>توزيع المصاريف</h2>
        <CategoryDonut items={s.categories} categories={categoriesById} currency={currency} />
      </div>

      <div className="card mt">
        <div className="card-head">
          <h2>آخر العمليات</h2>
          <div className="row">
            {lastExpense && (
              <button className="btn sm" onClick={() => openTx({ type: 'expense', preset: { amount: lastExpense.amount, categoryId: lastExpense.categoryId, paymentMethod: lastExpense.paymentMethod, note: lastExpense.note } })}>
                ⟳ تكرار آخر مصروف
              </button>
            )}
            <Link to="/expenses" className="small">الكل ←</Link>
          </div>
        </div>
        {recent.length === 0
          ? <div className="empty small">لم تسجل أي عملية في هذه الدورة بعد. اضغط "+ مصروف" للبدء.</div>
          : <div className="list">{recent.map((t) => <TxItem key={t.id} t={t} showDate />)}</div>}
      </div>
    </div>
  );
}
