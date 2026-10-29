// Dates are stored as local calendar days ("YYYY-MM-DD"), never as UTC timestamps,
// so an expense entered late at night in Baghdad never shifts to the previous day.
// Arithmetic is done on a UTC-noon-free day number to avoid DST and timezone drift.

export type ISODate = string;

const DAY_MS = 86_400_000;

export function todayLocal(now: Date = new Date()): ISODate {
  return fromParts(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function fromParts(y: number, m: number, d: number): ISODate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function isISODate(s: unknown): s is ISODate {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export function parts(date: ISODate): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y, m, d];
}

function toDayNumber(date: ISODate): number {
  const [y, m, d] = parts(date);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function fromDayNumber(n: number): ISODate {
  const dt = new Date(n * DAY_MS);
  return fromParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromDayNumber(toDayNumber(date) + days);
}

/** b - a in whole days. */
export function diffDays(a: ISODate, b: ISODate): number {
  return toDayNumber(b) - toDayNumber(a);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addMonths(date: ISODate, months: number): ISODate {
  const [y, m, d] = parts(date);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return fromParts(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(date: ISODate): number {
  // Day 0 (1970-01-01) was a Thursday.
  return (((toDayNumber(date) + 4) % 7) + 7) % 7;
}

export function eachDay(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  const n = diffDays(start, end);
  for (let i = 0; i <= n; i++) out.push(addDays(start, i));
  return out;
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a <= b ? a : b;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a >= b ? a : b;
}

export const WEEKDAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
export const MONTH_NAMES = [
  'كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران',
  'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول',
];

export function formatDate(date: ISODate, withWeekday = false): string {
  const [y, m, d] = parts(date);
  const base = `${d} ${MONTH_NAMES[m - 1]} ${y}`;
  return withWeekday ? `${WEEKDAY_NAMES[weekday(date)]}، ${base}` : base;
}

export function formatShortDate(date: ISODate): string {
  const [, m, d] = parts(date);
  return `${d}/${m}`;
}

export function monthKey(date: ISODate): string {
  return date.slice(0, 7);
}

export function formatMonthKey(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** Start of the week (Saturday, as commonly used in Iraq) containing date. */
export function startOfWeek(date: ISODate): ISODate {
  const wd = weekday(date);
  const offset = (wd + 1) % 7; // Saturday -> 0, Sunday -> 1, ... Friday -> 6
  return addDays(date, -offset);
}
