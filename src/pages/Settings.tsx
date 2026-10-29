import { useEffect, useRef, useState } from 'react';
import { useApp } from '../hooks/useApp';
import { saveCategory, setCategoryArchived, setDayBudget, updateCycle, updateSettings } from '../db/repo';
import { createBackup, downloadText, listSnapshots, parseBackupText, restoreBackup, restoreSnapshot, transactionsCsv, type BackupCheck } from '../db/backup';
import { isStoragePersisted, requestPersistentStorage } from '../db/db';
import { formatDate } from '../lib/dates';
import { CURRENCIES, currencyInfo } from '../lib/money';
import type { Category, ThemeSetting } from '../lib/types';
import { AmountField, Money, Seg, Sheet, readAmount, toInput, useConfirm, useSaver } from '../components/ui';
import { ExtendCycleSheet } from '../components/CycleSheets';
import { PlanSheet } from './Budget';

export default function Settings() {
  const { data, current, currency, today } = useApp();
  const settings = data.settings!;
  const { busy, run } = useSaver();
  const [sheet, setSheet] = useState<'extend' | 'plan' | null>(null);
  const [cycleLen, setCycleLen] = useState(String(settings.defaultCycleLength));
  const [defReserve, setDefReserve] = useState(toInput(settings.defaultReserve, currency));
  const [defSavings, setDefSavings] = useState(toInput(settings.defaultSavingsTarget, currency));
  const [curReserve, setCurReserve] = useState(toInput(current?.cycle.reserve ?? 0, currency));
  const [curSavings, setCurSavings] = useState(toInput(current?.cycle.savingsTarget ?? 0, currency));
  const todayFixed = data.dayBudgets.find((d) => d.date === today);
  const [todayBudget, setTodayBudget] = useState(todayFixed ? toInput(todayFixed.amount, currency) : '');

  async function saveDefaults() {
    const len = Number(cycleLen);
    const r = defReserve.trim() ? readAmount(defReserve, currency) : 0;
    const s = defSavings.trim() ? readAmount(defSavings, currency) : 0;
    if (r === null || s === null) return;
    await run(() => updateSettings({ defaultCycleLength: len, defaultReserve: r, defaultSavingsTarget: s }), 'تم حفظ الإعدادات الافتراضية');
  }

  async function saveCurrent() {
    if (!current) return;
    const r = curReserve.trim() ? readAmount(curReserve, currency) : 0;
    const s = curSavings.trim() ? readAmount(curSavings, currency) : 0;
    if (r === null || s === null) return;
    await run(() => updateCycle(current.cycle.id, { reserve: r, savingsTarget: s }), 'تم تحديث الدورة الحالية وإعادة حساب الميزانية');
  }

  return (
    <div>
      <div className="page-head"><h1>الإعدادات</h1></div>

      <div className="card">
        <h2>المظهر</h2>
        <Seg<ThemeSetting> value={settings.theme} onChange={(t) => void run(() => updateSettings({ theme: t }))} options={[['system', 'حسب الجهاز'], ['light', 'فاتح'], ['dark', 'داكن']]} />
      </div>

      <div className="card mt">
        <h2>الدورة الحالية</h2>
        {current && (
          <>
            <div className="kv"><span className="k">موعد الراتب القادم</span><span className="v">{formatDate(current.cycle.nextSalaryDate)} <button className="link-btn" onClick={() => setSheet('extend')}>تعديل</button></span></div>
            <div className="kv"><span className="k">نمط توزيع الميزانية</span><span className="v">{current.cycle.plan.mode === 'equal' ? 'متساوٍ' : 'مرن'} <button className="link-btn" onClick={() => setSheet('plan')}>إعداد المرن</button></span></div>
            <div className="mt">
              <AmountField id="cur-sav" label="الادخار المستهدف لهذه الدورة" value={curSavings} onChange={setCurSavings} currency={currency} allowZero />
              <AmountField id="cur-res" label="مبلغ الاحتياطي لهذه الدورة" value={curReserve} onChange={setCurReserve} currency={currency} allowZero />
              <button className="btn primary" disabled={busy} onClick={saveCurrent}>حفظ للدورة الحالية</button>
            </div>
            <hr className="sep" />
            <AmountField id="today-b" label="ميزانية اليوم (تثبيت يدوي، اختياري)" value={todayBudget} onChange={setTodayBudget} currency={currency} allowZero
              help={<>المقترح حالياً: <Money value={current.todayBudget} currency={currency} />. عند التثبيت تُوزَّع بقية الميزانية على الأيام الأخرى.</>} />
            <div className="btn-row">
              <button className="btn" disabled={busy || !todayBudget.trim()} onClick={() => { const v = readAmount(todayBudget, currency); if (v !== null) void run(() => setDayBudget(today, v), 'تم تثبيت ميزانية اليوم'); }}>تثبيت</button>
              {todayFixed && <button className="btn soft-danger" disabled={busy} onClick={() => { setTodayBudget(''); void run(() => setDayBudget(today, null), 'عادت ميزانية اليوم للحساب التلقائي'); }}>إلغاء التثبيت</button>}
            </div>
          </>
        )}
      </div>

      <div className="card mt">
        <h2>القيم الافتراضية للدورات القادمة</h2>
        <p className="small muted" style={{ marginTop: 0 }}>لا تغيّر الدورات السابقة. تُستخدم عند تسجيل راتب جديد.</p>
        <div className="field"><label htmlFor="cl">طول دورة الراتب (أيام)</label><input id="cl" className="input" inputMode="numeric" value={cycleLen} onChange={(e) => setCycleLen(e.target.value)} /></div>
        <AmountField id="def-sav" label="هدف الادخار لكل دورة" value={defSavings} onChange={setDefSavings} currency={currency} allowZero />
        <AmountField id="def-res" label="مبلغ الاحتياطي" value={defReserve} onChange={setDefReserve} currency={currency} allowZero />
        <button className="btn primary" disabled={busy} onClick={saveDefaults}>حفظ</button>
      </div>

      <div className="card mt">
        <h2>العملة</h2>
        <select className="input" value={settings.currency} onChange={(e) => void run(() => updateSettings({ currency: e.target.value }), 'تم تغيير العملة')} aria-label="العملة">
          {Object.values(CURRENCIES).map((c) => (
            <option key={c.code} value={c.code} disabled={c.decimals !== currencyInfo(settings.currency).decimals}>{c.name} ({c.symbol})</option>
          ))}
        </select>
        <div className="help small muted mt">المبالغ محفوظة كأعداد صحيحة دقيقة. لا يمكن التبديل بين الدينار (بدون كسور) وعملة بكسور بعد إدخال البيانات حتى لا تتغير قيم السجلات.</div>
      </div>

      <Categories />
      <BackupSection />

      {sheet === 'extend' && <ExtendCycleSheet onClose={() => setSheet(null)} />}
      {sheet === 'plan' && <PlanSheet onClose={() => setSheet(null)} />}
    </div>
  );
}

function Categories() {
  const { data } = useApp();
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const { run } = useSaver();
  return (
    <div className="card mt">
      <div className="card-head"><h2>فئات المصروفات</h2><button className="btn sm" onClick={() => setEditing('new')}>+ فئة</button></div>
      <div className="chips">
        {data.categories.map((c) => (
          <button key={c.id} className="chip" style={{ opacity: c.archived ? 0.5 : 1 }} onClick={() => setEditing(c)}>
            <span>{c.icon}</span>{c.name}{c.archived ? ' (مخفية)' : ''}
          </button>
        ))}
      </div>
      {editing && <CategorySheet cat={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onArchive={(c) => run(() => setCategoryArchived(c.id, !c.archived), c.archived ? 'أُظهرت الفئة' : 'أُخفيت الفئة')} />}
    </div>
  );
}

function CategorySheet({ cat, onClose, onArchive }: { cat: Category | null; onClose: () => void; onArchive: (c: Category) => Promise<unknown> }) {
  const { busy, run } = useSaver();
  const [name, setName] = useState(cat?.name ?? '');
  const [icon, setIcon] = useState(cat?.icon ?? '📦');
  const [color, setColor] = useState(cat?.color ?? '#0f766e');
  async function save() {
    const ok = await run(async () => { await saveCategory({ id: cat?.id, name, icon, color }); return true; }, 'تم حفظ الفئة');
    if (ok) onClose();
  }
  return (
    <Sheet title={cat ? 'تعديل الفئة' : 'فئة جديدة'} onClose={onClose}>
      <div className="field"><label htmlFor="c-name">الاسم</label><input id="c-name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="grid grid-2">
        <div className="field"><label htmlFor="c-icon">الرمز</label><input id="c-icon" className="input" value={icon} maxLength={4} onChange={(e) => setIcon(e.target.value)} /></div>
        <div className="field"><label htmlFor="c-color">اللون</label><input id="c-color" type="color" className="input" value={color} onChange={(e) => setColor(e.target.value)} /></div>
      </div>
      {cat && <p className="small muted">الفئة المخفية لا تظهر عند إضافة مصروف، لكن عملياتها السابقة تبقى كما هي.</p>}
      <div className="btn-row">
        <button className="btn primary" disabled={busy} onClick={save}>حفظ</button>
        {cat && cat.id !== 'cat-other' && <button className="btn" disabled={busy} onClick={async () => { await onArchive(cat); onClose(); }}>{cat.archived ? 'إظهار' : 'إخفاء'}</button>}
      </div>
    </Sheet>
  );
}

function BackupSection() {
  const { data, today } = useApp();
  const { busy, run } = useSaver();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [check, setCheck] = useState<BackupCheck | null>(null);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<string>('');
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<string>('');
  const [snapshots, setSnapshots] = useState<{ id: string; createdAt: string; reason: string }[]>([]);

  useEffect(() => {
    void isStoragePersisted().then(setPersisted);
    void listSnapshots().then(setSnapshots).catch(() => setSnapshots([]));
    navigator.storage?.estimate?.().then((e) => {
      if (e.usage !== undefined) setUsage(`${(e.usage / 1024).toFixed(0)} كيلوبايت مستخدمة`);
    }).catch(() => undefined);
  }, [result]);

  async function exportJson() {
    await run(async () => {
      const b = await createBackup();
      await downloadText(`ratibi-backup-${today}.json`, JSON.stringify(b, null, 2), 'application/json');
      await updateSettings({ lastBackupAt: new Date().toISOString() });
    }, 'تم إنشاء النسخة الاحتياطية وتنزيلها');
  }

  async function onFile(f: File | undefined) {
    setResult('');
    setCheck(null);
    if (!f) return;
    setFileName(f.name);
    setCheck(parseBackupText(await f.text()));
    if (fileRef.current) fileRef.current.value = '';
  }

  async function restore(mode: 'merge' | 'replace') {
    if (!check?.backup) return;
    const msg = mode === 'replace'
      ? 'سيتم استبدال كل بياناتك الحالية بمحتوى النسخة. تُحفظ نسخة تلقائية من بياناتك الحالية قبل الاستبدال. هل تريد المتابعة؟'
      : 'ستُضاف السجلات غير الموجودة فقط، ولن يتكرر أي سجل موجود. متابعة؟';
    if (!(await confirm(msg, { okText: mode === 'replace' ? 'استبدال البيانات' : 'دمج', danger: mode === 'replace' }))) return;
    const r = await run(() => restoreBackup(check.backup!, mode), 'اكتملت الاستعادة');
    if (r) {
      setResult(`${mode === 'replace' ? 'تم الاستبدال' : 'تم الدمج'}: أُضيف ${r.added} سجل${r.skipped ? `، وتُجوهل ${r.skipped} سجل موجود مسبقاً` : ''}.`);
      setCheck(null);
    }
  }

  async function restoreSnap(id: string) {
    if (!(await confirm('استعادة هذه النسخة التلقائية؟ ستُستبدل البيانات الحالية (وتُحفظ نسخة منها أولاً).', { okText: 'استعادة' }))) return;
    const r = await run(() => restoreSnapshot(id), 'تمت استعادة النسخة التلقائية');
    if (r) setResult(`تمت الاستعادة: ${r.added} سجل.`);
  }

  const last = data.settings?.lastBackupAt;
  return (
    <div className="card mt">
      <h2>النسخ الاحتياطي والاستعادة</h2>
      <div className="alert info">
        بياناتك محفوظة في قاعدة بيانات داخل هذا المتصفح على هذا الجهاز فقط (IndexedDB)، ولا تُرسل لأي خادم. إذا مسحت بيانات المتصفح أو غيّرت الجهاز تضيع، لذلك احتفظ بنسخة احتياطية خارج الجهاز (Google Drive، بريدك، أو حاسوب آخر).
      </div>
      <div className="small muted mt">
        آخر نسخة: {last ? formatDate(last.slice(0, 10)) : 'لم تُنشأ بعد'} · التخزين الدائم: {persisted === null ? 'غير معروف' : persisted ? 'مفعّل' : 'غير مفعّل'} {usage && `· ${usage}`}
        {persisted === false && <button className="link-btn" onClick={() => void requestPersistentStorage().then(setPersisted)}>طلب التفعيل</button>}
      </div>
      <div className="btn-row mt">
        <button className="btn primary" disabled={busy} onClick={exportJson}>إنشاء نسخة احتياطية كاملة (JSON)</button>
        <button className="btn" disabled={busy} onClick={() => void run(() => downloadText(`ratibi-transactions-${today}.csv`, transactionsCsv(data), 'text/csv;charset=utf-8'))}>تصدير العمليات CSV / Excel</button>
      </div>

      <hr className="sep" />
      <h3>استعادة نسخة</h3>
      <input ref={fileRef} type="file" accept="application/json,.json" onChange={(e) => void onFile(e.target.files?.[0])} className="input" aria-label="اختيار ملف النسخة" />
      {check && (
        <div className="mt">
          {check.ok ? (
            <>
              <div className="alert success">الملف "{fileName}" سليم: {check.counts.cycles} دورة، {check.counts.transactions} عملية، {check.counts.bills} التزام، {check.counts.goals} هدف، {check.counts.debts} دين.</div>
              <div className="btn-row mt">
                <button className="btn primary" disabled={busy} onClick={() => restore('merge')}>دمج (بدون تكرار)</button>
                <button className="btn danger" disabled={busy} onClick={() => restore('replace')}>استبدال كل البيانات</button>
              </div>
            </>
          ) : (
            <div className="alert danger">النسخة غير صالحة: {check.errors.join(' ')}</div>
          )}
        </div>
      )}
      {result && <div className="alert success mt" role="status">{result}</div>}

      {snapshots.length > 0 && (
        <>
          <hr className="sep" />
          <h3>نسخ تلقائية قبل الاستعادة</h3>
          <div className="list">
            {snapshots.map((s) => (
              <div className="item" key={s.id}>
                <div className="body"><div className="title">{formatDate(s.createdAt.slice(0, 10))} — {new Date(s.createdAt).toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' })}</div><div className="meta">{s.reason}</div></div>
                <button className="btn sm" disabled={busy} onClick={() => restoreSnap(s.id)}>استعادة</button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
