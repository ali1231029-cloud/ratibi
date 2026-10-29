// Money is always an integer count of the currency's smallest unit used by the app.
// For IQD that unit is one dinar (fils are not used in practice), so 1,000,000 IQD = 1000000.

export interface CurrencyInfo {
  code: string;
  symbol: string;
  name: string;
  decimals: number;
}

export const CURRENCIES: Record<string, CurrencyInfo> = {
  IQD: { code: 'IQD', symbol: 'د.ع', name: 'الدينار العراقي', decimals: 0 },
  USD: { code: 'USD', symbol: '$', name: 'الدولار الأمريكي', decimals: 2 },
  EUR: { code: 'EUR', symbol: '€', name: 'اليورو', decimals: 2 },
  SAR: { code: 'SAR', symbol: 'ر.س', name: 'الريال السعودي', decimals: 2 },
  AED: { code: 'AED', symbol: 'د.إ', name: 'الدرهم الإماراتي', decimals: 2 },
};

export function currencyInfo(code: string): CurrencyInfo {
  return CURRENCIES[code] ?? CURRENCIES.IQD;
}

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

function normalizeDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const a = ARABIC_DIGITS.indexOf(ch);
    const p = PERSIAN_DIGITS.indexOf(ch);
    if (a >= 0) out += String(a);
    else if (p >= 0) out += String(p);
    else if (ch === '٫') out += '.';
    else if (ch === '٬' || ch === ',' || ch === ' ' || ch === ' ') continue;
    else out += ch;
  }
  return out.trim();
}

/**
 * Parses user input into integer minor units without floating point math.
 * Returns null for anything that is not a valid non-negative amount.
 */
export function parseAmount(input: string, decimals = 0): number | null {
  const s = normalizeDigits(input);
  if (!s) return null;
  const re = decimals > 0 ? new RegExp(`^(\\d+)(?:\\.(\\d{0,${decimals}}))?$`) : /^(\d+)$/;
  const m = re.exec(s);
  if (!m) return null;
  const whole = m[1].replace(/^0+(?=\d)/, '');
  const frac = (m[2] ?? '').padEnd(decimals, '0');
  const digits = whole + frac;
  if (digits.length > 15) return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : null;
}

export function isValidAmount(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
}

function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Formats minor units as e.g. "1,000,000 د.ع" (or "-5,000 د.ع"). */
export function formatMoney(amount: number, currency = 'IQD', opts: { symbol?: boolean; sign?: boolean } = {}): string {
  const info = currencyInfo(currency);
  const neg = amount < 0;
  const abs = Math.abs(Math.trunc(amount));
  let text: string;
  if (info.decimals > 0) {
    const base = 10 ** info.decimals;
    const whole = Math.floor(abs / base);
    const frac = String(abs % base).padStart(info.decimals, '0');
    text = `${groupDigits(String(whole))}.${frac}`;
  } else {
    text = groupDigits(String(abs));
  }
  const sign = neg ? '-' : opts.sign && amount > 0 ? '+' : '';
  const symbol = opts.symbol === false ? '' : ` ${info.symbol}`;
  return `⁦${sign}${text}⁩${symbol}`;
}

/** Plain digits for an input field, e.g. 1500000 -> "1500000" or 1250 (USD) -> "12.50". */
export function amountToInput(amount: number, currency = 'IQD'): string {
  const info = currencyInfo(currency);
  if (info.decimals === 0) return String(amount);
  const base = 10 ** info.decimals;
  return `${Math.floor(amount / base)}.${String(amount % base).padStart(info.decimals, '0')}`;
}

/** Integer division that floors, used for daily budgets. Never divides by zero. */
export function divideFloor(amount: number, parts: number): number {
  if (parts <= 0) return 0;
  return Math.floor(amount / parts);
}

/** Percentage (0..100+) rounded to one decimal, safe for a zero base. */
export function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part * 1000) / whole) / 10;
}

export function sum(values: number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}
