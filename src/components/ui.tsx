import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { amountToInput, currencyInfo, formatMoney, parseAmount } from '../lib/money';
import { errorMessage } from '../db/repo';

export function Money({ value, currency, className = '', sign = false }: { value: number; currency: string; className?: string; sign?: boolean }) {
  return <span className={`num ${className}`}>{formatMoney(value, currency, { sign })}</span>;
}

export function Stat({ label, value, currency, tone = '', hint }: { label: string; value: number | string; currency?: string; tone?: string; hint?: ReactNode }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className={`value ${tone}`}>
        {typeof value === 'number' && currency ? <Money value={value} currency={currency} /> : <span className="num">{value}</span>}
      </div>
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function Progress({ value, tone = '' }: { value: number; tone?: string }) {
  const w = Math.max(0, Math.min(100, value));
  return (
    <div className={`progress ${tone}`} role="progressbar" aria-valuenow={Math.round(w)} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${w}%` }} />
    </div>
  );
}

export function Empty({ icon, text, children }: { icon: string; text: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="big-ico">{icon}</div>
      <div>{text}</div>
      {children}
    </div>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="close-x" onClick={onClose} aria-label="إغلاق">✕</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// ---------- Toasts ----------

interface Toast { id: number; kind: 'success' | 'error' | 'info'; text: string }
const ToastCtx = createContext<(kind: Toast['kind'], text: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 2800);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

/**
 * Runs a save and reports the real outcome: success only after the promise resolves,
 * a readable error otherwise. `busy` lets the button stay disabled while saving.
 */
export function useSaver() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    if (running.current) return undefined;
    running.current = true;
    setBusy(true);
    try {
      const r = await fn();
      if (success) toast('success', success);
      return r;
    } catch (e) {
      console.warn('save failed', e);
      toast('error', errorMessage(e));
      return undefined;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [toast]);
  return { busy, run };
}

// ---------- Confirm dialog ----------

interface ConfirmReq { text: string; okText: string; danger: boolean; resolve: (v: boolean) => void }
const ConfirmCtx = createContext<(text: string, opts?: { okText?: string; danger?: boolean }) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<ConfirmReq | null>(null);
  const ask = useCallback((text: string, opts: { okText?: string; danger?: boolean } = {}) =>
    new Promise<boolean>((resolve) => setReq({ text, okText: opts.okText ?? 'تأكيد', danger: opts.danger ?? true, resolve })), []);
  const close = (v: boolean) => {
    req?.resolve(v);
    setReq(null);
  };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      {req && (
        <Sheet title="تأكيد" onClose={() => close(false)}>
          <p style={{ marginTop: 0 }}>{req.text}</p>
          <div className="btn-row">
            <button className={`btn ${req.danger ? 'danger' : 'primary'}`} onClick={() => close(true)} autoFocus>{req.okText}</button>
            <button className="btn" onClick={() => close(false)}>إلغاء</button>
          </div>
        </Sheet>
      )}
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmCtx);
}

// ---------- Amount input ----------

export function AmountField({
  label, value, onChange, currency, autoFocus, help, big, allowZero = false, id,
}: {
  label: string; value: string; onChange: (v: string) => void; currency: string;
  autoFocus?: boolean; help?: ReactNode; big?: boolean; allowZero?: boolean; id?: string;
}) {
  const info = currencyInfo(currency);
  const parsed = value.trim() ? parseAmount(value, info.decimals) : null;
  const invalid = value.trim() !== '' && (parsed === null || (!allowZero && parsed === 0));
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="input-suffix">
        <input
          id={id}
          className={`input ${big ? 'amount-input' : ''} ${invalid ? 'invalid' : ''}`}
          inputMode={info.decimals ? 'decimal' : 'numeric'}
          autoComplete="off"
          value={value}
          autoFocus={autoFocus}
          placeholder="0"
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="suffix">{info.symbol}</span>
      </div>
      {invalid ? <div className="error">اكتب مبلغاً صحيحاً{info.decimals ? '' : ' بدون كسور'}.</div>
        : parsed !== null && parsed >= 1000 ? <div className="help num">{formatMoney(parsed, currency)}</div> : null}
      {help ? <div className="help">{help}</div> : null}
    </div>
  );
}

export function readAmount(value: string, currency: string): number | null {
  return parseAmount(value, currencyInfo(currency).decimals);
}

export function toInput(amount: number, currency: string): string {
  return amount ? amountToInput(amount, currency) : '';
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {options.map(([v, l]) => (
        <button key={v} type="button" role="tab" aria-selected={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}
