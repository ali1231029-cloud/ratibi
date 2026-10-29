// Full backup / restore. A backup is a JSON file holding every table. Restoring checks the
// file first, keeps an automatic snapshot of the current data, and never duplicates a record:
// records are matched by their permanent id.

import { db } from './db';
import { AppError, loadAll } from './repo';
import { isISODate } from '../lib/dates';
import { isValidAmount } from '../lib/money';
import { newId, nowIso } from '../lib/ids';
import { PAYMENT_METHODS, TX_TYPE_LABELS, type AppData, type Cycle, type Settings, type Transaction } from '../lib/types';

export const BACKUP_APP = 'ratibi';
export const BACKUP_VERSION = 1;

export interface BackupFile {
  app: typeof BACKUP_APP;
  version: number;
  exportedAt: string;
  data: Required<Omit<AppData, 'settings'>> & { settings: Settings | null };
}

export interface BackupCheck {
  ok: boolean;
  errors: string[];
  counts: Record<string, number>;
  backup?: BackupFile;
}

export async function createBackup(): Promise<BackupFile> {
  const data = await loadAll();
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: nowIso(),
    data: { ...data, settings: data.settings ?? null },
  };
}

const TABLE_KEYS = ['cycles', 'transactions', 'categories', 'bills', 'goals', 'debts', 'dayBudgets'] as const;

/** Validates a parsed backup before anything is written. */
export function checkBackup(raw: unknown): BackupCheck {
  const errors: string[] = [];
  const counts: Record<string, number> = {};
  const b = raw as Partial<BackupFile> | null;
  if (!b || typeof b !== 'object' || b.app !== BACKUP_APP) {
    return { ok: false, errors: ['الملف ليس نسخة احتياطية من تطبيق راتبي.'], counts };
  }
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) {
    return { ok: false, errors: ['إصدار النسخة أحدث من هذا التطبيق. حدّث التطبيق أولاً.'], counts };
  }
  const data = b.data as BackupFile['data'] | undefined;
  if (!data || typeof data !== 'object') return { ok: false, errors: ['الملف لا يحتوي على بيانات.'], counts };

  for (const key of TABLE_KEYS) {
    const rows = (data as unknown as Record<string, unknown>)[key];
    if (!Array.isArray(rows)) {
      errors.push(`الجدول "${key}" مفقود أو تالف.`);
      continue;
    }
    counts[key] = rows.length;
    const ids = new Set<string>();
    const idField = key === 'dayBudgets' ? 'date' : 'id';
    for (const r of rows as Record<string, unknown>[]) {
      const id = r?.[idField];
      if (typeof id !== 'string' || !id) { errors.push(`سجل بدون معرّف في "${key}".`); break; }
      if (ids.has(id)) { errors.push(`معرّف مكرر داخل الملف في "${key}".`); break; }
      ids.add(id);
    }
  }
  if (errors.length) return { ok: false, errors, counts };

  for (const c of data.cycles as Cycle[]) {
    if (!isISODate(c.startDate) || !isISODate(c.nextSalaryDate) || !isValidAmount(c.salaryAmount)) {
      errors.push('بيانات دورة راتب غير صالحة.');
      break;
    }
  }
  const starts = new Set<string>();
  for (const c of data.cycles as Cycle[]) {
    if (starts.has(c.startDate)) { errors.push('يوجد راتبان بنفس التاريخ داخل الملف.'); break; }
    starts.add(c.startDate);
  }
  for (const t of data.transactions as Transaction[]) {
    if (!isISODate(t.date) || !isValidAmount(t.amount) || typeof t.type !== 'string') {
      errors.push('عملية مالية غير صالحة داخل الملف.');
      break;
    }
  }
  return { ok: errors.length === 0, errors, counts, backup: errors.length ? undefined : (b as BackupFile) };
}

export function parseBackupText(text: string): BackupCheck {
  try {
    return checkBackup(JSON.parse(text));
  } catch {
    return { ok: false, errors: ['تعذّرت قراءة الملف. تأكد أنه ملف JSON صحيح.'], counts: {} };
  }
}

export interface RestoreResult {
  mode: 'replace' | 'merge';
  added: number;
  skipped: number;
  snapshotId: string;
}

const MAX_SNAPSHOTS = 5;

async function saveSnapshot(reason: string): Promise<string> {
  const payload = JSON.stringify(await createBackup());
  const id = newId();
  await db.snapshots.add({ id, createdAt: nowIso(), reason, payload });
  const all = await db.snapshots.orderBy('createdAt').toArray();
  for (const old of all.slice(0, Math.max(0, all.length - MAX_SNAPSHOTS))) await db.snapshots.delete(old.id);
  return id;
}

/**
 * replace: current data is swapped for the backup (after an automatic snapshot).
 * merge:   only records whose id is not already stored are added; existing ones are untouched.
 */
export async function restoreBackup(backup: BackupFile, mode: 'replace' | 'merge'): Promise<RestoreResult> {
  const check = checkBackup(backup);
  if (!check.ok) throw new AppError(check.errors[0] ?? 'النسخة غير صالحة.');
  const snapshotId = await saveSnapshot(mode === 'replace' ? 'قبل استبدال البيانات بنسخة احتياطية' : 'قبل دمج نسخة احتياطية');
  const d = backup.data;
  let added = 0;
  let skipped = 0;

  await db.transaction('rw', [db.settings, db.cycles, db.transactions, db.categories, db.bills, db.goals, db.debts, db.dayBudgets], async () => {
    if (mode === 'replace') {
      await Promise.all([db.settings.clear(), db.cycles.clear(), db.transactions.clear(), db.categories.clear(),
        db.bills.clear(), db.goals.clear(), db.debts.clear(), db.dayBudgets.clear()]);
      if (d.settings) await db.settings.put(d.settings);
      await db.cycles.bulkAdd(d.cycles);
      await db.transactions.bulkAdd(d.transactions);
      await db.categories.bulkAdd(d.categories);
      await db.bills.bulkAdd(d.bills);
      await db.goals.bulkAdd(d.goals);
      await db.debts.bulkAdd(d.debts);
      await db.dayBudgets.bulkAdd(d.dayBudgets);
      added = d.cycles.length + d.transactions.length + d.categories.length + d.bills.length + d.goals.length + d.debts.length + d.dayBudgets.length;
      return;
    }
    if (!(await db.settings.get('app')) && d.settings) await db.settings.put(d.settings);
    const existingStarts = new Set((await db.cycles.toArray()).map((c) => c.startDate));
    const tables = [
      [db.cycles, d.cycles], [db.transactions, d.transactions], [db.categories, d.categories],
      [db.bills, d.bills], [db.goals, d.goals], [db.debts, d.debts],
    ] as const;
    for (const [table, rows] of tables) {
      for (const row of rows as { id: string }[]) {
        if (await (table as typeof db.cycles).get(row.id)) { skipped++; continue; }
        if (table === db.cycles) {
          const c = row as Cycle;
          if (existingStarts.has(c.startDate)) { skipped++; continue; }
          existingStarts.add(c.startDate);
        }
        if (table === db.transactions) {
          const t = row as Transaction;
          if (t.billId && t.billDueDate && await db.transactions.where('[billId+billDueDate]').equals([t.billId, t.billDueDate]).first()) {
            skipped++;
            continue;
          }
        }
        await (table as typeof db.cycles).add(row as Cycle);
        added++;
      }
    }
    for (const day of d.dayBudgets) {
      if (await db.dayBudgets.get(day.date)) { skipped++; continue; }
      await db.dayBudgets.add(day);
      added++;
    }
    // A merge may leave several cycles marked active; only the latest one stays active.
    const cycles = (await db.cycles.toArray()).sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
    for (let i = 0; i < cycles.length; i++) {
      const status = i === cycles.length - 1 ? 'active' : 'archived';
      if (cycles[i].status !== status) await db.cycles.update(cycles[i].id, { status });
    }
  });
  return { mode, added, skipped, snapshotId };
}

export async function listSnapshots() {
  return (await db.snapshots.orderBy('createdAt').reverse().toArray()).map((s) => ({ id: s.id, createdAt: s.createdAt, reason: s.reason }));
}

export async function restoreSnapshot(id: string): Promise<RestoreResult> {
  const snap = await db.snapshots.get(id);
  if (!snap) throw new AppError('النسخة التلقائية غير موجودة.');
  const check = parseBackupText(snap.payload);
  if (!check.ok || !check.backup) throw new AppError('النسخة التلقائية تالفة.');
  return restoreBackup(check.backup, 'replace');
}

// ---------- CSV ----------

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Transactions as CSV with a UTF-8 BOM so Excel shows Arabic correctly. */
export function transactionsCsv(data: AppData): string {
  const cats = new Map(data.categories.map((c) => [c.id, c.name]));
  const goals = new Map(data.goals.map((g) => [g.id, g.name]));
  const debts = new Map(data.debts.map((d) => [d.id, d.person]));
  const bills = new Map(data.bills.map((b) => [b.id, b.name]));
  const header = ['التاريخ', 'النوع', 'المبلغ', 'الفئة', 'الوصف', 'طريقة الدفع', 'الفاتورة', 'هدف الادخار', 'الدين', 'المعرف'];
  const rows: (string | number)[][] = [];
  for (const c of data.cycles) {
    rows.push([c.startDate, 'راتب', c.salaryAmount, '', 'راتب الدورة', '', '', '', '', c.id]);
  }
  for (const t of data.transactions) {
    rows.push([
      t.date, TX_TYPE_LABELS[t.type], t.amount, t.categoryId ? cats.get(t.categoryId) ?? '' : '', t.note,
      t.paymentMethod ? PAYMENT_METHODS[t.paymentMethod] : '', t.billId ? bills.get(t.billId) ?? '' : '', t.goalId ? goals.get(t.goalId) ?? '' : '',
      t.debtId ? debts.get(t.debtId) ?? '' : '', t.id,
    ]);
  }
  rows.sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0));
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
