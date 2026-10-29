import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useApp } from '../hooks/useApp';
import { addTransaction, updateTransaction, deleteTransaction } from '../db/repo';
import { newId } from '../lib/ids';
import { formatDate, type ISODate } from '../lib/dates';
import { INCOME_KINDS, PAYMENT_METHODS, type IncomeKind, type PaymentMethod, type Transaction, type TxType } from '../lib/types';
import { AmountField, Seg, Sheet, readAmount, toInput, useConfirm, useSaver } from './ui';

export interface TxSheetOptions {
  type?: TxType;
  edit?: Transaction;
  preset?: Partial<Pick<Transaction, 'amount' | 'categoryId' | 'paymentMethod' | 'note' | 'date' | 'goalId' | 'debtId' | 'incomeKind'>>;
  /** Types offered in the switcher when adding. */
  types?: TxType[];
}

const Ctx = createContext<(o?: TxSheetOptions) => void>(() => {});

export function useTxSheet() {
  return useContext(Ctx);
}

export function TxSheetProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<TxSheetOptions | null>(null);
  const [key, setKey] = useState(0);
  const open = useCallback((o: TxSheetOptions = {}) => {
    setKey((k) => k + 1);
    setOpts(o);
  }, []);
  return (
    <Ctx.Provider value={open}>
      {children}
      {opts && <TxForm key={key} opts={opts} onClose={() => setOpts(null)} />}
    </Ctx.Provider>
  );
}

const TITLES: Record<TxType, [string, string]> = {
  expense: ['إضافة مصروف', 'تعديل المصروف'],
  refund: ['تسجيل استرداد', 'تعديل الاسترداد'],
  income: ['تسجيل دخل إضافي', 'تعديل الدخل'],
  saving_in: ['تحويل إلى الادخار', 'تعديل التحويل'],
  saving_out: ['سحب من الادخار', 'تعديل السحب'],
  debt_open: ['دين جديد', 'تعديل الدين'],
  debt_payment: ['تسجيل دفعة دين', 'تعديل الدفعة'],
};

function TxForm({ opts, onClose }: { opts: TxSheetOptions; onClose: () => void }) {
  const { data, today, currency, current } = useApp();
  const { busy, run } = useSaver();
  const confirm = useConfirm();
  const edit = opts.edit;
  const preset = opts.preset ?? {};
  const [id] = useState(() => edit?.id ?? newId());
  const [type, setType] = useState<TxType>(edit?.type ?? opts.type ?? 'expense');
  const [amount, setAmount] = useState(toInput(edit?.amount ?? preset.amount ?? 0, currency));
  const visibleCats = data.categories.filter((c) => !c.archived || c.id === edit?.categoryId);
  const defaultCat = edit?.categoryId ?? preset.categoryId ?? data.settings?.lastCategoryId ?? visibleCats[0]?.id ?? null;
  const [categoryId, setCategoryId] = useState<string | null>(defaultCat);
  const [date, setDate] = useState<ISODate>(edit?.date ?? preset.date ?? today);
  const [note, setNote] = useState(edit?.note ?? preset.note ?? '');
  const [method, setMethod] = useState<PaymentMethod>(edit?.paymentMethod ?? preset.paymentMethod ?? 'cash');
  const [incomeKind, setIncomeKind] = useState<IncomeKind>(edit?.incomeKind ?? preset.incomeKind ?? 'extra');
  const goals = data.goals.filter((g) => !g.archived || g.id === edit?.goalId);
  const [goalId, setGoalId] = useState<string | null>(edit?.goalId ?? preset.goalId ?? goals[0]?.id ?? null);
  const [debtId] = useState<string | null>(edit?.debtId ?? preset.debtId ?? null);
  const [details, setDetails] = useState(Boolean(edit) || (preset.date !== undefined && preset.date !== today));
  const [error, setError] = useState('');

  const firstStart = data.cycles.reduce<string | null>((m, c) => (m === null || c.startDate < m ? c.startDate : m), null);
  const switchTypes = edit ? [] : opts.types ?? (opts.type ? [] : ['expense', 'income', 'refund'] as TxType[]);
  const isBillPayment = Boolean(edit?.billId);

  async function save() {
    setError('');
    const value = readAmount(amount, currency);
    if (value === null || value <= 0) { setError('اكتب مبلغاً صحيحاً أكبر من صفر.'); return; }
    if ((type === 'expense' || type === 'refund') && !categoryId) { setError('اختر الفئة.'); return; }
    if ((type === 'saving_in' || type === 'saving_out') && !goalId) { setError('اختر هدف الادخار.'); return; }
    const input = { id, type, amount: value, date, note, categoryId, paymentMethod: method, incomeKind, goalId, debtId };
    const ok = await run(async () => {
      if (edit) await updateTransaction(input);
      else await addTransaction(input);
      return true;
    }, edit ? 'تم حفظ التعديل' : 'تم الحفظ');
    if (ok) onClose();
  }

  async function remove() {
    if (!edit) return;
    if (!(await confirm('هل تريد حذف هذه العملية نهائياً؟ سيُعاد حساب الميزانية والتقارير.', { okText: 'حذف' }))) return;
    const ok = await run(async () => { await deleteTransaction(edit.id); return true; }, 'تم الحذف');
    if (ok) onClose();
  }

  const title = TITLES[type][edit ? 1 : 0];
  const remaining = current?.isActive ? current.todayRemaining : null;

  return (
    <Sheet title={title} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {switchTypes.length > 1 && (
          <div className="field">
            <Seg value={type} onChange={setType} options={switchTypes.map((t) => [t, t === 'expense' ? 'مصروف' : t === 'income' ? 'دخل' : t === 'refund' ? 'استرداد' : TITLES[t][0]])} />
          </div>
        )}

        <AmountField id="tx-amount" label="المبلغ" value={amount} onChange={setAmount} currency={currency} autoFocus={!edit} big
          help={type === 'expense' && remaining !== null && !edit ? <>المتبقي من ميزانية اليوم: <b className="num">{remaining.toLocaleString('en-US')}</b></> : undefined} />

        {(type === 'expense' || type === 'refund') && (
          <div className="field">
            <span className="label">الفئة</span>
            <div className="chips">
              {visibleCats.map((c) => (
                <button type="button" key={c.id} className={`chip ${categoryId === c.id ? 'selected' : ''}`} onClick={() => setCategoryId(c.id)} aria-pressed={categoryId === c.id}>
                  <span>{c.icon}</span>{c.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {type === 'income' && (
          <div className="field">
            <span className="label">نوع الدخل</span>
            <div className="chips">
              {(Object.keys(INCOME_KINDS) as IncomeKind[]).map((k) => (
                <button type="button" key={k} className={`chip ${incomeKind === k ? 'selected' : ''}`} onClick={() => setIncomeKind(k)}>{INCOME_KINDS[k]}</button>
              ))}
            </div>
            <div className="help">استرداد مبلغ مصروف يُسجَّل كـ"استرداد" وليس دخلاً. سداد دين لك يُسجَّل من صفحة الديون.</div>
          </div>
        )}

        {(type === 'saving_in' || type === 'saving_out') && (
          <div className="field">
            <label htmlFor="tx-goal">هدف الادخار</label>
            <select id="tx-goal" className="input" value={goalId ?? ''} onChange={(e) => setGoalId(e.target.value || null)}>
              {goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <div className="help">تحويل داخلي بين أموالك، لا يُحسب مصروفاً.</div>
          </div>
        )}

        {!details ? (
          <button type="button" className="link-btn" onClick={() => setDetails(true)} style={{ marginBottom: 12 }}>
            {formatDate(date, true)} · {type === 'expense' ? PAYMENT_METHODS[method] + ' · ' : ''}إضافة تفاصيل أو تغيير التاريخ
          </button>
        ) : (
          <>
            <div className="field">
              <label htmlFor="tx-date">التاريخ</label>
              <input id="tx-date" type="date" className="input" value={date} min={firstStart ?? undefined} max={today}
                onChange={(e) => setDate(e.target.value)} />
            </div>
            {type === 'expense' && (
              <div className="field">
                <span className="label">طريقة الدفع</span>
                <div className="chips">
                  {(Object.keys(PAYMENT_METHODS) as PaymentMethod[]).map((m) => (
                    <button type="button" key={m} className={`chip ${method === m ? 'selected' : ''}`} onClick={() => setMethod(m)}>{PAYMENT_METHODS[m]}</button>
                  ))}
                </div>
              </div>
            )}
            <div className="field">
              <label htmlFor="tx-note">الوصف (اختياري)</label>
              <input id="tx-note" className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً: غداء مع الأصدقاء" />
            </div>
          </>
        )}

        {isBillPayment && <div className="alert info" style={{ marginBottom: 12 }}>هذه دفعة فاتورة مرتبطة بالتزام ثابت.</div>}
        {error && <div className="alert danger" style={{ marginBottom: 12 }} role="alert">{error}</div>}

        <div className="btn-row">
          <button type="submit" className="btn primary" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</button>
          {edit && <button type="button" className="btn soft-danger" onClick={remove} disabled={busy}>حذف</button>}
        </div>
      </form>
    </Sheet>
  );
}
