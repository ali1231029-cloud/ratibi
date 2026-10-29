import type { ISODate } from './dates';

export type BudgetMode = 'equal' | 'flexible';
export type ThemeSetting = 'system' | 'light' | 'dark';

/** How a cycle spreads its spendable money over its days. Copied onto each cycle so
 * changing today's settings never rewrites an archived cycle. */
export interface BudgetPlan {
  mode: BudgetMode;
  /** Weekdays (0 = Sunday … 6 = Saturday) treated as weekend/holiday days. */
  weekendDays: number[];
  workdayWeight: number;
  weekendWeight: number;
}

export interface Settings {
  id: 'app';
  setupComplete: boolean;
  currency: string;
  /** Money that existed before the first cycle (cash on hand at setup). */
  initialBalance: number;
  initialBalanceDate: ISODate | null;
  defaultCycleLength: number;
  defaultReserve: number;
  defaultSavingsTarget: number;
  plan: BudgetPlan;
  theme: ThemeSetting;
  lastBackupAt: string | null;
  lastCategoryId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Cycle {
  id: string;
  /** Date the salary was actually received. The cycle covers startDate .. (next cycle start − 1). */
  startDate: ISODate;
  /** Expected next salary date. For the active cycle the planned end is the day before. */
  nextSalaryDate: ISODate;
  salaryAmount: number;
  /** Money brought into this cycle's budget (initial balance or an opted-in carry-over). */
  carryIn: number;
  /** Money from this cycle moved into the next one by the user's choice. */
  carriedOut: number;
  savingsTarget: number;
  reserve: number;
  plan: BudgetPlan;
  status: 'active' | 'archived';
  note: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export type TxType =
  | 'expense'
  | 'refund'
  | 'income'
  | 'saving_in'
  | 'saving_out'
  | 'debt_open'
  | 'debt_payment';

export type IncomeKind = 'bonus' | 'extra' | 'gift' | 'other';
export type PaymentMethod = 'cash' | 'card' | 'wallet' | 'transfer';

export interface Transaction {
  id: string;
  type: TxType;
  amount: number;
  date: ISODate;
  note: string;
  categoryId: string | null;
  paymentMethod: PaymentMethod | null;
  incomeKind: IncomeKind | null;
  billId: string | null;
  billDueDate: ISODate | null;
  goalId: string | null;
  debtId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  order: number;
  archived: boolean;
}

export type BillFrequency = 'monthly' | 'weekly' | 'yearly' | 'once';

export interface Bill {
  id: string;
  name: string;
  amount: number;
  frequency: BillFrequency;
  /** First due date; later occurrences are derived from it. */
  firstDueDate: ISODate;
  categoryId: string | null;
  active: boolean;
  /** Last date on which occurrences are generated (inclusive), null = forever. */
  endDate: ISODate | null;
  createdAt: string;
  updatedAt: string;
}

export interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  targetDate: ISODate | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export type DebtDirection = 'i_owe' | 'owed_to_me';

export interface Debt {
  id: string;
  person: string;
  direction: DebtDirection;
  principal: number;
  startDate: ISODate;
  dueDate: ISODate | null;
  note: string;
  closed: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A fixed budget for one specific day (flexible mode or a manual "today's budget"). */
export interface DayBudget {
  date: ISODate;
  amount: number;
  updatedAt: string;
}

export interface Snapshot {
  id: string;
  createdAt: string;
  reason: string;
  payload: string;
}

export interface AppData {
  settings: Settings | undefined;
  cycles: Cycle[];
  transactions: Transaction[];
  categories: Category[];
  bills: Bill[];
  goals: Goal[];
  debts: Debt[];
  dayBudgets: DayBudget[];
}

export const PAYMENT_METHODS: Record<PaymentMethod, string> = {
  cash: 'نقداً',
  card: 'بطاقة',
  wallet: 'محفظة إلكترونية',
  transfer: 'تحويل',
};

export const INCOME_KINDS: Record<IncomeKind, string> = {
  bonus: 'مكافأة',
  extra: 'دخل إضافي',
  gift: 'مبلغ من شخص',
  other: 'دخل آخر',
};

export const TX_TYPE_LABELS: Record<TxType, string> = {
  expense: 'مصروف',
  refund: 'استرداد',
  income: 'دخل',
  saving_in: 'تحويل إلى الادخار',
  saving_out: 'سحب من الادخار',
  debt_open: 'دين جديد',
  debt_payment: 'دفعة دين',
};

export const FREQUENCY_LABELS: Record<BillFrequency, string> = {
  monthly: 'شهرياً',
  weekly: 'أسبوعياً',
  yearly: 'سنوياً',
  once: 'مرة واحدة',
};
