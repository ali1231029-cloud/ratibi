import { useState } from 'react';
import { useApp } from '../hooks/useApp';
import { removeGoal, saveGoal, setGoalArchived } from '../db/repo';
import { diffDays, formatDate } from '../lib/dates';
import { divideFloor } from '../lib/money';
import { goalProgress } from '../lib/finance';
import type { Goal } from '../lib/types';
import { AmountField, Empty, Money, Progress, Sheet, readAmount, toInput, useConfirm, useSaver, useToast } from '../components/ui';
import { useTxSheet } from '../components/TxSheet';
import { TxItem } from '../components/TxList';

export default function Savings() {
  const { data, current: s, currency, savings, today } = useApp();
  const openTx = useTxSheet();
  const [editing, setEditing] = useState<Goal | 'new' | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const goals = data.goals.filter((g) => showArchived || !g.archived);
  const history = data.transactions.filter((t) => t.type === 'saving_in' || t.type === 'saving_out')
    .sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 15);

  return (
    <div>
      <div className="page-head">
        <div><h1>الادخار والأهداف</h1><div className="sub">التحويل إلى الادخار تحويل داخلي وليس مصروفاً</div></div>
        <button className="btn primary sm" onClick={() => setEditing('new')}>+ هدف جديد</button>
      </div>

      <div className="grid grid-3">
        <div className="stat"><div className="label">إجمالي المدخرات</div><div className="value c-saving"><Money value={savings} currency={currency} /></div></div>
        <div className="stat"><div className="label">المخطط لهذه الدورة</div><div className="value"><Money value={s?.savingsTarget ?? 0} currency={currency} /></div></div>
        <div className="stat"><div className="label">المحوَّل فعلياً هذه الدورة</div><div className="value c-saving"><Money value={s?.savingsNet ?? 0} currency={currency} /></div>
          {s && s.savingsRemaining > 0 && <div className="hint">متبقٍ <Money value={s.savingsRemaining} currency={currency} /> (محجوز من الميزانية)</div>}
        </div>
      </div>

      <div className="btn-row mt">
        <button className="btn primary" onClick={() => openTx({ type: 'saving_in', preset: { amount: s?.savingsRemaining || undefined } })} disabled={!goals.some((g) => !g.archived)}>تحويل إلى الادخار</button>
        <button className="btn" onClick={() => openTx({ type: 'saving_out' })} disabled={savings <= 0}>سحب من الادخار</button>
      </div>

      <div className="mt">
        {goals.length === 0 ? <div className="card"><Empty icon="🎯" text="أضف هدفاً مثل: سيارة، هاتف، سفر، صندوق طوارئ." /></div> : goals.map((g) => {
          const p = goalProgress(data, g);
          const daysLeft = g.targetDate ? diffDays(today, g.targetDate) : null;
          const perCycle = daysLeft !== null && daysLeft > 0 && p.remaining > 0 ? divideFloor(p.remaining * 30, daysLeft) : null;
          return (
            <div className="card" key={g.id}>
              <div className="card-head">
                <h3>{g.name} {g.archived && <span className="badge">مؤرشف</span>}</h3>
                <button className="link-btn small" onClick={() => setEditing(g)}>تعديل</button>
              </div>
              <div className="row between">
                <span><Money value={p.saved} currency={currency} className="bold c-saving" />{g.targetAmount > 0 && <> من <Money value={g.targetAmount} currency={currency} /></>}</span>
                {g.targetAmount > 0 && <span className="badge saving num">{p.percent}%</span>}
              </div>
              {g.targetAmount > 0 && <div className="mt"><Progress value={p.percent} tone="saving" /></div>}
              <div className="small muted mt">
                {g.targetAmount > 0 && <>المتبقي <Money value={p.remaining} currency={currency} /> · </>}
                {g.targetDate ? <>الموعد {formatDate(g.targetDate)}{daysLeft !== null && daysLeft >= 0 ? ` (بعد ${daysLeft} يوم)` : ' (انتهى)'}</> : 'بدون موعد محدد'}
                {perCycle !== null && <> · تحتاج نحو <Money value={perCycle} currency={currency} /> شهرياً</>}
              </div>
              {!g.archived && (
                <div className="btn-row mt">
                  <button className="btn sm" onClick={() => openTx({ type: 'saving_in', preset: { goalId: g.id } })}>+ إيداع</button>
                  <button className="btn sm" onClick={() => openTx({ type: 'saving_out', preset: { goalId: g.id } })} disabled={p.saved <= 0}>− سحب</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {data.goals.some((g) => g.archived) && (
        <button className="link-btn mt" onClick={() => setShowArchived((v) => !v)}>{showArchived ? 'إخفاء المؤرشفة' : 'عرض الأهداف المؤرشفة'}</button>
      )}

      <div className="card mt">
        <h2>آخر حركات الادخار</h2>
        {history.length === 0 ? <div className="empty small">لا توجد تحويلات بعد.</div> : <div className="list">{history.map((t) => <TxItem key={t.id} t={t} showDate />)}</div>}
      </div>

      {editing && <GoalSheet goal={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function GoalSheet({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const { currency } = useApp();
  const { busy, run } = useSaver();
  const confirm = useConfirm();
  const toast = useToast();
  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState(toInput(goal?.targetAmount ?? 0, currency));
  const [date, setDate] = useState(goal?.targetDate ?? '');
  const [error, setError] = useState('');

  async function save() {
    const t = target.trim() ? readAmount(target, currency) : 0;
    if (!name.trim()) return setError('اكتب اسم الهدف.');
    if (t === null) return setError('المبلغ المستهدف غير صالح.');
    const ok = await run(async () => { await saveGoal({ id: goal?.id, name, targetAmount: t, targetDate: date || null }); return true; }, 'تم حفظ الهدف');
    if (ok) onClose();
  }

  async function remove() {
    if (!goal) return;
    if (!(await confirm(`حذف الهدف "${goal.name}"؟ إذا كانت له تحويلات فسيُؤرشف فقط وتبقى أمواله محسوبة.`, { okText: 'حذف' }))) return;
    const r = await run(() => removeGoal(goal.id));
    if (r) { toast('success', r === 'deleted' ? 'تم حذف الهدف' : 'تمت أرشفة الهدف مع الاحتفاظ بتحويلاته'); onClose(); }
  }

  return (
    <Sheet title={goal ? 'تعديل الهدف' : 'هدف ادخار جديد'} onClose={onClose}>
      <div className="field"><label htmlFor="g-name">اسم الهدف</label><input id="g-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً: شراء سيارة" /></div>
      <AmountField id="g-target" label="المبلغ المستهدف" value={target} onChange={setTarget} currency={currency} allowZero />
      <div className="field"><label htmlFor="g-date">التاريخ المستهدف (اختياري)</label><input id="g-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      {error && <div className="alert danger">{error}</div>}
      <div className="btn-row mt">
        <button className="btn primary" disabled={busy} onClick={save}>حفظ</button>
        {goal?.archived && <button className="btn" disabled={busy} onClick={async () => { if (await run(async () => { await setGoalArchived(goal.id, false); return true; }, 'أُعيد تفعيل الهدف')) onClose(); }}>إلغاء الأرشفة</button>}
        {goal && !goal.archived && <button className="btn soft-danger" disabled={busy} onClick={remove}>حذف</button>}
      </div>
    </Sheet>
  );
}
