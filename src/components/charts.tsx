import { formatMoney, percent } from '../lib/money';
import { formatShortDate } from '../lib/dates';
import type { Category } from '../lib/types';
import type { CategoryAmount } from '../lib/finance';
import { Money } from './ui';

export function CategoryDonut({ items, categories, currency, max = 6 }: {
  items: CategoryAmount[]; categories: Map<string, Category>; currency: string; max?: number;
}) {
  const total = items.reduce((a, c) => a + c.amount, 0);
  if (total <= 0) return <div className="empty small">لا توجد مصروفات مسجلة بعد.</div>;
  const top = items.slice(0, max);
  const restAmount = items.slice(max).reduce((a, c) => a + c.amount, 0);
  const slices = top.map((c) => {
    const cat = categories.get(c.categoryId);
    return { name: cat?.name ?? 'غير مصنف', color: cat?.color ?? '#94a3b8', icon: cat?.icon ?? '📦', amount: c.amount };
  });
  if (restAmount > 0) slices.push({ name: 'فئات أخرى', color: '#94a3b8', icon: '…', amount: restAmount });

  const r = 52;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="donut-wrap">
      <svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label="توزيع المصاريف حسب الفئة">
        <circle cx="70" cy="70" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="22" />
        {slices.map((s) => {
          const len = (s.amount / total) * circ;
          const el = (
            <circle key={s.name} cx="70" cy="70" r={r} fill="none" stroke={s.color} strokeWidth="22"
              strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={-offset} transform="rotate(-90 70 70)">
              <title>{`${s.name}: ${formatMoney(s.amount, currency)}`}</title>
            </circle>
          );
          offset += len;
          return el;
        })}
        <text x="70" y="66" textAnchor="middle" fontSize="11" fill="var(--muted)">المجموع</text>
        <text x="70" y="84" textAnchor="middle" fontSize="13" fontWeight="800" fill="var(--text)">{formatMoney(total, currency, { symbol: false }).replace(/[⁦⁩]/g, '')}</text>
      </svg>
      <div className="legend">
        {slices.map((s) => (
          <div className="li" key={s.name}>
            <span className="dot" style={{ background: s.color }} />
            <span className="nm">{s.icon} {s.name}</span>
            <Money value={s.amount} currency={currency} className="small bold" />
            <span className="pc num">{percent(s.amount, total)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Daily bars. A null amount is drawn hatched as "not recorded", never as zero. */
export function DailyBars({ days, currency, budget }: {
  days: { date: string; amount: number | null; planned?: number }[]; currency: string; budget?: boolean;
}) {
  if (days.length === 0) return <div className="empty small">لا توجد أيام في هذه الفترة.</div>;
  const max = Math.max(1, ...days.map((d) => Math.max(d.amount ?? 0, d.planned ?? 0)));
  return (
    <div>
      <div className="bars" role="img" aria-label="الإنفاق اليومي">
        {days.map((d) => {
          const over = budget && d.planned !== undefined && d.amount !== null && d.amount > d.planned;
          const h = d.amount === null ? 0 : Math.max(2, (Math.max(0, d.amount) / max) * 100);
          return (
            <div key={d.date} className={`bar ${d.amount === null ? 'none' : ''} ${over ? 'over' : ''}`} style={{ height: `${h}%` }}
              title={`${formatShortDate(d.date)}: ${d.amount === null ? 'غير مسجل' : formatMoney(d.amount, currency).replace(/[⁦⁩]/g, '')}`} />
          );
        })}
      </div>
      <div className="bars-labels">
        <span>{formatShortDate(days[0].date)}</span>
        {days.length > 2 && <span>{formatShortDate(days[Math.floor(days.length / 2)].date)}</span>}
        <span>{formatShortDate(days[days.length - 1].date)}</span>
      </div>
    </div>
  );
}

export function HBars({ rows, currency }: { rows: { label: string; amount: number; color?: string }[]; currency: string }) {
  const max = Math.max(1, ...rows.map((r) => r.amount));
  return (
    <div className="hbar">
      {rows.map((r) => (
        <div className="r" key={r.label}>
          <div className="top"><span>{r.label}</span><Money value={r.amount} currency={currency} className="bold" /></div>
          <div className="progress"><div style={{ width: `${(r.amount / max) * 100}%`, background: r.color }} /></div>
        </div>
      ))}
    </div>
  );
}
