import { useMemo, useState } from 'react';
import { useApp } from '../hooks/useApp';
import { addDays, formatDate, formatMonthKey, monthKey, startOfWeek, WEEKDAY_NAMES, weekday } from '../lib/dates';
import { percent } from '../lib/money';
import { computeCycleSummary, cycleBounds, rangeReport, sortCycles } from '../lib/finance';
import { createBackup, downloadText, transactionsCsv } from '../db/backup';
import { updateSettings } from '../db/repo';
import { Money, Seg, Stat, useSaver } from '../components/ui';
import { CategoryDonut, DailyBars, HBars } from '../components/charts';

type Period = 'cycle' | 'day' | 'week' | 'month' | 'custom';

export default function Reports() {
  const { data, today, currency, categoriesById } = useApp();
  const { run } = useSaver();
  const cycles = sortCycles(data.cycles).reverse();
  const [period, setPeriod] = useState<Period>('cycle');
  const [cycleId, setCycleId] = useState(cycles[0]?.id ?? '');
  const [month, setMonth] = useState(monthKey(today));
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);

  const range = useMemo((): [string, string] => {
    if (period === 'day') return [today, today];
    if (period === 'week') { const s = startOfWeek(today); return [s, addDays(s, 6)]; }
    if (period === 'month') return [`${month}-01`, `${month}-31`];
    if (period === 'custom') return from <= to ? [from, to] : [to, from];
    const c = data.cycles.find((x) => x.id === cycleId) ?? cycles[0];
    if (!c) return [today, today];
    const b = cycleBounds(data.cycles, c);
    return [b.start, b.next ? b.memberEnd : b.plannedEnd];
  }, [period, today, month, from, to, cycleId, data.cycles, cycles]);

  const r = useMemo(() => rangeReport(data, range[0], range[1], today), [data, range, today]);
  const cycleSummary = period === 'cycle' ? (() => {
    const c = data.cycles.find((x) => x.id === cycleId) ?? cycles[0];
    return c ? computeCycleSummary(data, c, today) : undefined;
  })() : undefined;
  const months = [...new Set([...data.transactions.map((t) => monthKey(t.date)), monthKey(today)])].sort().reverse();

  const comparison = sortCycles(data.cycles).map((c) => computeCycleSummary(data, c, today)).slice(-6);

  // Spending by weekday (only days that have records count).
  const byWeekday = Array.from({ length: 7 }, (_, i) => ({ label: WEEKDAY_NAMES[i], amount: 0 }));
  for (const d of r.daily) if (d.amount !== null && d.amount > 0) byWeekday[weekday(d.date)].amount += d.amount;

  async function exportJson() {
    await run(async () => {
      const b = await createBackup();
      await downloadText(`ratibi-backup-${today}.json`, JSON.stringify(b, null, 2), 'application/json');
      await updateSettings({ lastBackupAt: new Date().toISOString() });
    }, 'تم تصدير نسخة JSON كاملة');
  }

  return (
    <div>
      <div className="page-head">
        <div><h1>التقارير والتحليلات</h1><div className="sub">{formatDate(range[0])} — {formatDate(range[1])}</div></div>
        <div className="row">
          <button className="btn sm" onClick={() => void run(() => downloadText(`ratibi-transactions-${today}.csv`, transactionsCsv(data), 'text/csv;charset=utf-8'))}>تصدير CSV / Excel</button>
          <button className="btn sm" onClick={exportJson}>تصدير JSON</button>
        </div>
      </div>

      <div className="card">
        <Seg value={period} onChange={setPeriod} options={[['cycle', 'دورة راتب'], ['day', 'اليوم'], ['week', 'الأسبوع'], ['month', 'شهر'], ['custom', 'فترة مخصصة']]} />
        {period === 'cycle' && (
          <select className="input mt" value={cycleId} onChange={(e) => setCycleId(e.target.value)} aria-label="الدورة">
            {cycles.map((c) => <option key={c.id} value={c.id}>{c.status === 'active' ? 'الحالية — ' : ''}{formatDate(c.startDate)}</option>)}
          </select>
        )}
        {period === 'month' && (
          <select className="input mt" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="الشهر">
            {months.map((m) => <option key={m} value={m}>{formatMonthKey(m)}</option>)}
          </select>
        )}
        {period === 'custom' && (
          <div className="row mt">
            <input type="date" className="input grow" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="من" />
            <input type="date" className="input grow" value={to} onChange={(e) => setTo(e.target.value)} aria-label="إلى" />
          </div>
        )}
      </div>

      <div className="grid grid-3 mt">
        <Stat label="إجمالي الدخل" value={r.totalIncome} currency={currency} tone="c-income" hint={r.otherIncome > 0 ? <>منه إضافي <Money value={r.otherIncome} currency={currency} /></> : 'الراتب المستلم في الفترة'} />
        <Stat label="إجمالي المصروفات" value={r.totalSpending} currency={currency} tone="c-expense" />
        <Stat label="الادخار الفعلي" value={r.savingsNet} currency={currency} tone="c-saving" />
        <Stat label="مصاريف ثابتة (فواتير)" value={r.fixedSpending} currency={currency} />
        <Stat label="مصاريف متغيرة" value={r.variableSpending} currency={currency} hint={r.refunds > 0 ? <>بعد استرداد <Money value={r.refunds} currency={currency} /></> : undefined} />
        <Stat label="متوسط الإنفاق اليومي" value={r.avgDaily} currency={currency} hint={`على ${r.days} يوم`} />
        {cycleSummary && <Stat label="نسبة الراتب المصروفة" value={`${cycleSummary.spentPercentOfSalary}%`} />}
        <Stat label="أيام مسجلة / غير مسجلة" value={`${r.recordedDays} / ${r.unrecordedDays}`} hint="الأيام غير المسجلة لا تُعتبر صفراً" />
      </div>

      <div className="card mt"><h2>الإنفاق اليومي</h2><DailyBars days={r.daily} currency={currency} /></div>

      <div className="grid mt" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        <div className="card"><h2>أكثر الفئات استهلاكاً</h2><CategoryDonut items={r.categories} categories={categoriesById} currency={currency} max={8} /></div>
        <div className="card">
          <h2>أكثر الأيام إنفاقاً</h2>
          {r.topDays.length === 0 ? <div className="empty small">لا توجد بيانات.</div> : (
            <div className="list">
              {r.topDays.map((d, i) => (
                <div className="item" key={d.date}>
                  <div className="icon">{i + 1}</div>
                  <div className="body"><div className="title">{formatDate(d.date, true)}</div><div className="meta">{percent(d.amount, r.totalSpending)}% من مصروف الفترة</div></div>
                  <Money value={d.amount} currency={currency} className="amount c-expense" />
                </div>
              ))}
            </div>
          )}
          <h3 className="mt-lg">حسب يوم الأسبوع</h3>
          <HBars rows={byWeekday.filter((w) => w.amount > 0)} currency={currency} />
        </div>
      </div>

      {comparison.length > 0 && (
        <div className="card mt">
          <h2>مقارنة الدورات المالية</h2>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>الدورة</th><th>الدخل</th><th>المصروف</th><th>الثابت</th><th>المتغير</th><th>الادخار</th><th>% من الراتب</th><th>المتوسط اليومي</th></tr></thead>
              <tbody>
                {comparison.reverse().map((s) => (
                  <tr key={s.cycle.id}>
                    <td>{formatDate(s.cycle.startDate)}{s.isActive ? ' (الحالية)' : ''}</td>
                    <td><Money value={s.salary + s.otherIncome} currency={currency} className="c-income" /></td>
                    <td><Money value={s.totalExpenses} currency={currency} className="c-expense" /></td>
                    <td><Money value={s.fixedPaid} currency={currency} /></td>
                    <td><Money value={s.variableSpending} currency={currency} /></td>
                    <td><Money value={s.savingsNet} currency={currency} className="c-saving" /></td>
                    <td className="num">{s.spentPercentOfSalary}%</td>
                    <td><Money value={s.avgDailySpending} currency={currency} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
