import Dexie, { type Table } from 'dexie';
import type { Bill, Category, Cycle, DayBudget, Debt, Goal, Settings, Snapshot, Transaction } from '../lib/types';

export const DB_NAME = 'ratibi';

export const DEFAULT_CATEGORIES: Omit<Category, 'order' | 'archived'>[] = [
  { id: 'cat-transport', name: 'التكسي والمواصلات', icon: '🚕', color: '#f59e0b' },
  { id: 'cat-food', name: 'الأكل والمشروبات', icon: '🍽️', color: '#ef4444' },
  { id: 'cat-rent', name: 'الإيجار', icon: '🏠', color: '#8b5cf6' },
  { id: 'cat-utilities', name: 'الكهرباء والماء', icon: '💡', color: '#eab308' },
  { id: 'cat-internet', name: 'الإنترنت والهاتف', icon: '📶', color: '#06b6d4' },
  { id: 'cat-personal', name: 'المشتريات الشخصية', icon: '🛍️', color: '#ec4899' },
  { id: 'cat-health', name: 'الصحة والأدوية', icon: '💊', color: '#10b981' },
  { id: 'cat-clothes', name: 'الملابس', icon: '👕', color: '#6366f1' },
  { id: 'cat-fun', name: 'الترفيه والخروج', icon: '🎉', color: '#f97316' },
  { id: 'cat-family', name: 'الأسرة والهدايا', icon: '🎁', color: '#d946ef' },
  { id: 'cat-installments', name: 'الأقساط والديون', icon: '📄', color: '#64748b' },
  { id: 'cat-emergency', name: 'الطوارئ', icon: '🚨', color: '#dc2626' },
  { id: 'cat-other', name: 'أخرى', icon: '📦', color: '#94a3b8' },
];

export class RatibiDB extends Dexie {
  settings!: Table<Settings, string>;
  cycles!: Table<Cycle, string>;
  transactions!: Table<Transaction, string>;
  categories!: Table<Category, string>;
  bills!: Table<Bill, string>;
  goals!: Table<Goal, string>;
  debts!: Table<Debt, string>;
  dayBudgets!: Table<DayBudget, string>;
  snapshots!: Table<Snapshot, string>;

  constructor(name = DB_NAME) {
    super(name);
    // Schema changes must add a new version() with an upgrade() — never edit version 1,
    // so existing users keep their data when the app updates.
    this.version(1).stores({
      settings: 'id',
      cycles: 'id, &startDate, status',
      transactions: 'id, date, type, categoryId, billId, goalId, debtId, &[billId+billDueDate]',
      categories: 'id, order',
      bills: 'id',
      goals: 'id',
      debts: 'id',
      dayBudgets: 'date',
      snapshots: 'id, createdAt',
    });

    // Runs only once, when the database is first created on this device.
    this.on('populate', (tx) => {
      tx.table('categories').bulkAdd(DEFAULT_CATEGORIES.map((c, i) => ({ ...c, order: i, archived: false })));
    });
  }
}

export let db = new RatibiDB();

/** Test hook: point the app at a fresh database instance. */
export function useDatabase(instance: RatibiDB): void {
  db = instance;
}

/** Asks the browser not to evict our data under storage pressure. */
export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function isStoragePersisted(): Promise<boolean | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persisted) return null;
    return await navigator.storage.persisted();
  } catch {
    return null;
  }
}
