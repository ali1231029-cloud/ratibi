// All writes go through this module. Each function validates its input, runs inside a
// single IndexedDB transaction, and only resolves after the data is committed, so the
// UI can show "saved" only when it is really saved.

import { db } from './db';
import { addDays, diffDays, isISODate, todayLocal, type ISODate } from '../lib/dates';
import { currencyInfo, isValidAmount } from '../lib/money';
import { newId, nowIso } from '../lib/ids';
import { computeCycleSummary, debtStatus, goalProgress, sortCycles } from '../lib/finance';
import type {
  AppData, Bill, BillFrequency, BudgetPlan, Category, Cycle, Debt, DebtDirection, Goal, IncomeKind,
  PaymentMethod, Settings, Transaction, TxType,
} from '../lib/types';

export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppError';
  }
}

/** Turns any storage failure into a message the user can act on. */
export function errorMessage(e: unknown): string {
  if (e instanceof AppError) return e.message;
  const err = e as { name?: string; inner?: { name?: string } } | null;
  const name = err?.inner?.name ?? err?.name;
  if (name === 'QuotaExceededError') return 'مساحة التخزين في المتصفح ممتلئة. صدّر نسخة احتياطية وأفرغ بعض المساحة.';
  if (name === 'ConstraintError') return 'هذا السجل محفوظ مسبقاً، ولم يُسجَّل مرة ثانية.';
  if (name === 'DatabaseClosedError' || name === 'InvalidStateError') return 'قاعدة البيانات غير متاحة حالياً. أعد تحميل الصفحة.';
  return 'تعذّر الحفظ بسبب خطأ غير متوقع. لم تُحفظ العملية، حاول مرة أخرى.';
}

function fail(message: string): never {
  throw new AppError(message);
}

function requireAmount(n: unknown, label = 'المبلغ', allowZero = false): number {
  if (!isValidAmount(n)) fail(`${label} غير صالح.`);
  if (!allowZero && n === 0) fail(`${label} يجب أن يكون أكبر من صفر.`);
  return n;
}

function requireDate(d: unknown, label = 'التاريخ'): ISODate {
  if (!isISODate(d)) fail(`${label} غير صالح.`);
  return d;
}

export const DEFAULT_PLAN: BudgetPlan = { mode: 'equal', weekendDays: [5, 6], workdayWeight: 1, weekendWeight: 1 };

const ALL_TABLES = () => [db.settings, db.cycles, db.transactions, db.categories, db.bills, db.goals, db.debts, db.dayBudgets];

export async function loadAll(): Promise<AppData> {
  return db.transaction('r', ALL_TABLES(), async () => ({
    settings: await db.settings.get('app'),
    cycles: await db.cycles.toArray(),
    transactions: await db.transactions.toArray(),
    categories: await db.categories.orderBy('order').toArray(),
    bills: await db.bills.toArray(),
    goals: await db.goals.toArray(),
    debts: await db.debts.toArray(),
    dayBudgets: await db.dayBudgets.toArray(),
  }));
}

// ---------- Setup ----------

export interface FixedBillInput {
  name: string;
  amount: number;
  firstDueDate: ISODate;
  frequency: BillFrequency;
  categoryId: string | null;
}

export interface SetupInput {
  currency: string;
  salaryAmount: number;
  receivedDate: ISODate;
  nextSalaryDate: ISODate;
  savingsTarget: number;
  reserve: number;
  initialBalance: number;
  includeInitialInCycle: boolean;
  bills: FixedBillInput[];
}

export async function completeSetup(input: SetupInput): Promise<void> {
  requireAmount(input.salaryAmount, 'الراتب');
  const received = requireDate(input.receivedDate, 'تاريخ استلام الراتب');
  const next = requireDate(input.nextSalaryDate, 'موعد الراتب القادم');
  if (next <= received) fail('موعد الراتب القادم يجب أن يكون بعد تاريخ الاستلام.');
  if (received > todayLocal()) fail('تاريخ استلام الراتب لا يمكن أن يكون في المستقبل.');
  requireAmount(input.savingsTarget, 'مبلغ الادخار', true);
  requireAmount(input.reserve, 'الاحتياطي', true);
  requireAmount(input.initialBalance, 'الرصيد الابتدائي', true);
  for (const b of input.bills) validateBill(b);

  const now = nowIso();
  await db.transaction('rw', [db.settings, db.cycles, db.bills, db.goals], async () => {
    const existing = await db.settings.get('app');
    if (existing?.setupComplete) fail('تم إعداد التطبيق مسبقاً. لم يُسجَّل الراتب مرة ثانية.');
    if ((await db.cycles.count()) > 0) fail('توجد دورة راتب محفوظة مسبقاً.');
    const settings: Settings = {
      id: 'app',
      setupComplete: true,
      currency: input.currency,
      initialBalance: input.initialBalance,
      initialBalanceDate: input.initialBalance > 0 ? received : null,
      defaultCycleLength: Math.max(1, Math.min(120, diffDays(received, next))),
      defaultReserve: input.reserve,
      defaultSavingsTarget: input.savingsTarget,
      plan: DEFAULT_PLAN,
      theme: existing?.theme ?? 'system',
      lastBackupAt: null,
      lastCategoryId: null,
      createdAt: now,
      updatedAt: now,
    };
    await db.settings.put(settings);
    await db.cycles.add({
      id: newId(),
      startDate: received,
      nextSalaryDate: next,
      salaryAmount: input.salaryAmount,
      carryIn: input.includeInitialInCycle ? input.initialBalance : 0,
      carriedOut: 0,
      savingsTarget: input.savingsTarget,
      reserve: input.reserve,
      plan: DEFAULT_PLAN,
      status: 'active',
      note: '',
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    });
    for (const b of input.bills) {
      await db.bills.add({ id: newId(), ...b, name: b.name.trim(), active: true, endDate: null, createdAt: now, updatedAt: now });
    }
    if ((await db.goals.count()) === 0) {
      await db.goals.add({ id: newId(), name: 'ادخار عام', targetAmount: 0, targetDate: null, archived: false, createdAt: now, updatedAt: now });
    }
  });
}

// ---------- Transactions ----------

export interface TxInput {
  id: string;
  type: TxType;
  amount: number;
  date: ISODate;
  note?: string;
  categoryId?: string | null;
  paymentMethod?: PaymentMethod | null;
  incomeKind?: IncomeKind | null;
  goalId?: string | null;
  debtId?: string | null;
}

async function firstCycleStart(): Promise<ISODate | undefined> {
  const first = await db.cycles.orderBy('startDate').first();
  return first?.startDate;
}

async function validateTx(input: TxInput, existingId?: string): Promise<Transaction> {
  requireAmount(input.amount);
  const date = requireDate(input.date);
  if (date > todayLocal()) fail('لا يمكن تسجيل عملية بتاريخ مستقبلي.');
  const first = await firstCycleStart();
  if (!first) fail('أكمل إعداد الراتب أولاً.');
  if (date < first) fail('التاريخ يسبق بداية أول دورة راتب مسجلة.');

  const base: Transaction = {
    id: input.id,
    type: input.type,
    amount: input.amount,
    date,
    note: (input.note ?? '').trim().slice(0, 300),
    categoryId: null,
    paymentMethod: null,
    incomeKind: null,
    billId: null,
    billDueDate: null,
    goalId: null,
    debtId: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  switch (input.type) {
    case 'expense':
    case 'refund': {
      const cat = input.categoryId ? await db.categories.get(input.categoryId) : undefined;
      if (!cat) fail('اختر فئة صحيحة.');
      base.categoryId = cat.id;
      base.paymentMethod = input.type === 'expense' ? input.paymentMethod ?? 'cash' : null;
      break;
    }
    case 'income':
      base.incomeKind = input.incomeKind ?? 'extra';
      break;
    case 'saving_in':
    case 'saving_out': {
      const goal = input.goalId ? await db.goals.get(input.goalId) : undefined;
      if (!goal) fail('اختر هدف الادخار.');
      base.goalId = goal.id;
      if (input.type === 'saving_out') {
        const data = await loadAll();
        const progress = goalProgress({ ...data, transactions: data.transactions.filter((t) => t.id !== existingId) }, goal);
        if (input.amount > progress.saved) fail('المبلغ أكبر من المدخر في هذا الهدف.');
      }
      break;
    }
    case 'debt_open':
    case 'debt_payment': {
      const debt = input.debtId ? await db.debts.get(input.debtId) : undefined;
      if (!debt) fail('الدين غير موجود.');
      base.debtId = debt.id;
      if (input.type === 'debt_payment') {
        const data = await loadAll();
        const st = debtStatus({ ...data, transactions: data.transactions.filter((t) => t.id !== existingId) }, debt);
        if (input.amount > st.remaining) fail('الدفعة أكبر من المبلغ المتبقي من الدين.');
      }
      break;
    }
    default:
      fail('نوع العملية غير معروف.');
  }
  return base;
}

/**
 * Adds a transaction. The id is created by the form when it opens, so pressing save twice
 * (or a retried request) finds the same id and never creates a second record.
 */
export async function addTransaction(input: TxInput): Promise<{ created: boolean }> {
  const tx = await validateTx(input);
  return db.transaction('rw', [db.transactions, db.settings], async () => {
    if (await db.transactions.get(tx.id)) return { created: false };
    await db.transactions.add(tx);
    if (tx.type === 'expense' && tx.categoryId) await db.settings.update('app', { lastCategoryId: tx.categoryId });
    return { created: true };
  });
}

export async function updateTransaction(input: TxInput): Promise<void> {
  const existing = await db.transactions.get(input.id);
  if (!existing) fail('العملية غير موجودة، ربما حُذفت.');
  if (existing.type !== input.type) fail('لا يمكن تغيير نوع العملية.');
  const tx = await validateTx(input, existing.id);
  await db.transactions.put({
    ...tx,
    billId: existing.billId,
    billDueDate: existing.billDueDate,
    createdAt: existing.createdAt,
    updatedAt: nowIso(),
  });
}

export async function deleteTransaction(id: string): Promise<void> {
  await db.transactions.delete(id);
}

// ---------- Bills ----------

function validateBill(b: FixedBillInput): void {
  if (!b.name.trim()) fail('اكتب اسم الالتزام.');
  requireAmount(b.amount, 'مبلغ الالتزام');
  requireDate(b.firstDueDate, 'تاريخ الاستحقاق');
  if (!['monthly', 'weekly', 'yearly', 'once'].includes(b.frequency)) fail('دورة التكرار غير صالحة.');
}

export async function saveBill(input: FixedBillInput & { id?: string }): Promise<string> {
  validateBill(input);
  const now = nowIso();
  if (input.id) {
    const existing = await db.bills.get(input.id);
    if (!existing) fail('الالتزام غير موجود.');
    await db.bills.put({ ...existing, ...input, name: input.name.trim(), id: existing.id, updatedAt: now });
    return existing.id;
  }
  const bill: Bill = { ...input, id: newId(), name: input.name.trim(), active: true, endDate: null, createdAt: now, updatedAt: now };
  await db.bills.add(bill);
  return bill.id;
}

/** Bills with payments are only stopped (history stays); unused bills are removed. */
export async function removeBill(id: string): Promise<'deleted' | 'stopped'> {
  return db.transaction('rw', [db.bills, db.transactions], async () => {
    const paid = await db.transactions.where('billId').equals(id).count();
    if (paid > 0) {
      await db.bills.update(id, { active: false, endDate: todayLocal(), updatedAt: nowIso() });
      return 'stopped';
    }
    await db.bills.delete(id);
    return 'deleted';
  });
}

export async function reactivateBill(id: string): Promise<void> {
  await db.bills.update(id, { active: true, endDate: null, updatedAt: nowIso() });
}

export interface PayBillInput {
  billId: string;
  dueDate: ISODate;
  amount: number;
  date: ISODate;
  paymentMethod: PaymentMethod;
  note?: string;
}

/** One payment per bill occurrence: the id is derived from the bill and its due date. */
export async function payBill(input: PayBillInput): Promise<{ created: boolean }> {
  requireAmount(input.amount);
  const date = requireDate(input.date);
  if (date > todayLocal()) fail('لا يمكن تسجيل دفعة بتاريخ مستقبلي.');
  const first = await firstCycleStart();
  if (!first || date < first) fail('تاريخ الدفع يسبق بداية أول دورة راتب.');
  return db.transaction('rw', [db.bills, db.transactions], async () => {
    const bill = await db.bills.get(input.billId);
    if (!bill) fail('الالتزام غير موجود.');
    const id = `billpay-${bill.id}-${input.dueDate}`;
    if (await db.transactions.get(id)) return { created: false };
    const dup = await db.transactions.where('[billId+billDueDate]').equals([bill.id, input.dueDate]).first();
    if (dup) return { created: false };
    const now = nowIso();
    await db.transactions.add({
      id, type: 'expense', amount: input.amount, date, note: (input.note ?? bill.name).trim(),
      categoryId: bill.categoryId ?? 'cat-other', paymentMethod: input.paymentMethod, incomeKind: null,
      billId: bill.id, billDueDate: input.dueDate, goalId: null, debtId: null, createdAt: now, updatedAt: now,
    });
    return { created: true };
  });
}

// ---------- Categories ----------

export async function saveCategory(input: { id?: string; name: string; icon: string; color: string }): Promise<void> {
  const name = input.name.trim();
  if (!name) fail('اكتب اسم الفئة.');
  await db.transaction('rw', db.categories, async () => {
    const all = await db.categories.toArray();
    if (all.some((c) => c.name === name && c.id !== input.id && !c.archived)) fail('توجد فئة بهذا الاسم.');
    if (input.id) {
      const existing = all.find((c) => c.id === input.id);
      if (!existing) fail('الفئة غير موجودة.');
      await db.categories.put({ ...existing, name, icon: input.icon || '📦', color: input.color });
    } else {
      const order = all.reduce((m, c) => Math.max(m, c.order), -1) + 1;
      const cat: Category = { id: newId(), name, icon: input.icon || '📦', color: input.color, order, archived: false };
      await db.categories.add(cat);
    }
  });
}

export async function setCategoryArchived(id: string, archived: boolean): Promise<void> {
  if (id === 'cat-other' && archived) fail('لا يمكن إخفاء فئة "أخرى".');
  await db.categories.update(id, { archived });
}

// ---------- Goals ----------

export async function saveGoal(input: { id?: string; name: string; targetAmount: number; targetDate: ISODate | null }): Promise<void> {
  const name = input.name.trim();
  if (!name) fail('اكتب اسم الهدف.');
  requireAmount(input.targetAmount, 'المبلغ المستهدف', true);
  if (input.targetDate !== null) requireDate(input.targetDate, 'التاريخ المستهدف');
  const now = nowIso();
  if (input.id) {
    const g = await db.goals.get(input.id);
    if (!g) fail('الهدف غير موجود.');
    await db.goals.put({ ...g, name, targetAmount: input.targetAmount, targetDate: input.targetDate, updatedAt: now });
  } else {
    const goal: Goal = { id: newId(), name, targetAmount: input.targetAmount, targetDate: input.targetDate, archived: false, createdAt: now, updatedAt: now };
    await db.goals.add(goal);
  }
}

export async function removeGoal(id: string): Promise<'deleted' | 'archived'> {
  return db.transaction('rw', [db.goals, db.transactions], async () => {
    const used = await db.transactions.where('goalId').equals(id).count();
    if (used > 0) {
      await db.goals.update(id, { archived: true, updatedAt: nowIso() });
      return 'archived';
    }
    await db.goals.delete(id);
    return 'deleted';
  });
}

export async function setGoalArchived(id: string, archived: boolean): Promise<void> {
  await db.goals.update(id, { archived, updatedAt: nowIso() });
}

// ---------- Debts ----------

export interface DebtInput {
  id?: string;
  person: string;
  direction: DebtDirection;
  principal: number;
  startDate: ISODate;
  dueDate: ISODate | null;
  note: string;
  /** Record the money actually changing hands now (borrowed cash in / lent cash out). */
  recordCash: boolean;
}

export async function saveDebt(input: DebtInput): Promise<void> {
  const person = input.person.trim();
  if (!person) fail('اكتب اسم الشخص.');
  requireAmount(input.principal, 'مبلغ الدين');
  const startDate = requireDate(input.startDate, 'تاريخ الدين');
  if (input.dueDate !== null) requireDate(input.dueDate, 'موعد السداد');
  const now = nowIso();
  if (input.recordCash) {
    const first = await firstCycleStart();
    if (!first || startDate < first) fail('لتسجيل حركة نقدية يجب أن يكون التاريخ ضمن دورات الراتب.');
    if (startDate > todayLocal()) fail('لا يمكن تسجيل حركة نقدية بتاريخ مستقبلي.');
  }
  await db.transaction('rw', [db.debts, db.transactions], async () => {
    if (input.id) {
      const d = await db.debts.get(input.id);
      if (!d) fail('الدين غير موجود.');
      const paid = (await db.transactions.where('debtId').equals(d.id).filter((t) => t.type === 'debt_payment').toArray())
        .reduce((a, t) => a + t.amount, 0);
      if (input.principal < paid) fail('المبلغ أقل من المدفوع فعلاً من هذا الدين.');
      await db.debts.put({ ...d, person, principal: input.principal, startDate, dueDate: input.dueDate, note: input.note.trim(), updatedAt: now });
      const open = await db.transactions.get(`debtopen-${d.id}`);
      if (open) await db.transactions.update(open.id, { amount: input.principal, date: startDate, updatedAt: now });
      return;
    }
    const debt: Debt = {
      id: newId(), person, direction: input.direction, principal: input.principal, startDate,
      dueDate: input.dueDate, note: input.note.trim(), closed: false, createdAt: now, updatedAt: now,
    };
    await db.debts.add(debt);
    if (input.recordCash) {
      await db.transactions.add({
        id: `debtopen-${debt.id}`, type: 'debt_open', amount: debt.principal, date: startDate,
        note: debt.direction === 'i_owe' ? `اقتراض من ${person}` : `إقراض ${person}`,
        categoryId: null, paymentMethod: null, incomeKind: null, billId: null, billDueDate: null,
        goalId: null, debtId: debt.id, createdAt: now, updatedAt: now,
      });
    }
  });
}

export async function deleteDebt(id: string): Promise<void> {
  await db.transaction('rw', [db.debts, db.transactions], async () => {
    await db.transactions.where('debtId').equals(id).delete();
    await db.debts.delete(id);
  });
}

export async function setDebtClosed(id: string, closed: boolean): Promise<void> {
  await db.debts.update(id, { closed, updatedAt: nowIso() });
}

// ---------- Cycles ----------

export interface ConfirmSalaryInput {
  amount: number;
  receivedDate: ISODate;
  nextSalaryDate: ISODate;
  savingsTarget: number;
  reserve: number;
  carryOver: number;
}

/**
 * Records a newly received salary: archives the current cycle and opens a new one, in one
 * transaction. The unique index on startDate makes a second confirmation impossible.
 */
export async function confirmSalary(input: ConfirmSalaryInput): Promise<string> {
  requireAmount(input.amount, 'الراتب');
  const received = requireDate(input.receivedDate, 'تاريخ الاستلام');
  const next = requireDate(input.nextSalaryDate, 'موعد الراتب القادم');
  const today = todayLocal();
  if (received > today) fail('تاريخ الاستلام لا يمكن أن يكون في المستقبل.');
  if (next <= received) fail('موعد الراتب القادم يجب أن يكون بعد تاريخ الاستلام.');
  requireAmount(input.savingsTarget, 'مبلغ الادخار', true);
  requireAmount(input.reserve, 'الاحتياطي', true);
  requireAmount(input.carryOver, 'مبلغ الترحيل', true);

  return db.transaction('rw', ALL_TABLES(), async () => {
    const data = await loadAll();
    const sorted = sortCycles(data.cycles);
    const current = sorted[sorted.length - 1];
    if (!current) fail('لا توجد دورة حالية. أكمل الإعداد أولاً.');
    if (sorted.some((c) => c.startDate === received)) fail('يوجد راتب مسجل بهذا التاريخ مسبقاً، ولم يُسجَّل مرة ثانية.');
    if (received <= current.startDate) fail('تاريخ الراتب الجديد يجب أن يكون بعد بداية الدورة الحالية.');

    // Carry-over is limited to what the current cycle really has left up to the new salary date.
    const asOfReceived = computeCycleSummary(
      { ...data, transactions: data.transactions.filter((t) => t.date < received) },
      current,
      addDays(received, -1),
    );
    const maxCarry = Math.max(0, asOfReceived.availableFunds);
    if (input.carryOver > maxCarry) fail('مبلغ الترحيل أكبر من المتبقي في الدورة الحالية.');

    const now = nowIso();
    await db.cycles.update(current.id, {
      status: 'archived',
      nextSalaryDate: received,
      carriedOut: input.carryOver,
      archivedAt: now,
      updatedAt: now,
    });
    const id = newId();
    await db.cycles.add({
      id,
      startDate: received,
      nextSalaryDate: next,
      salaryAmount: input.amount,
      carryIn: input.carryOver,
      carriedOut: 0,
      savingsTarget: input.savingsTarget,
      reserve: input.reserve,
      plan: data.settings?.plan ?? DEFAULT_PLAN,
      status: 'active',
      note: '',
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    });
    return id;
  });
}

/** Undo the latest salary confirmation (for mistakes). Transactions are kept. */
export async function undoLatestSalary(): Promise<void> {
  await db.transaction('rw', db.cycles, async () => {
    const sorted = sortCycles(await db.cycles.toArray());
    if (sorted.length < 2) fail('لا يمكن التراجع عن الدورة الأولى. عدّل بياناتها بدلاً من ذلك.');
    const latest = sorted[sorted.length - 1];
    const prev = sorted[sorted.length - 2];
    await db.cycles.delete(latest.id);
    await db.cycles.update(prev.id, {
      status: 'active',
      carriedOut: 0,
      nextSalaryDate: latest.nextSalaryDate,
      archivedAt: null,
      updatedAt: nowIso(),
    });
  });
}

export interface CycleUpdate {
  startDate?: ISODate;
  nextSalaryDate?: ISODate;
  salaryAmount?: number;
  savingsTarget?: number;
  reserve?: number;
  carryIn?: number;
  note?: string;
}

export async function updateCycle(id: string, patch: CycleUpdate): Promise<void> {
  if (patch.salaryAmount !== undefined) requireAmount(patch.salaryAmount, 'الراتب');
  if (patch.savingsTarget !== undefined) requireAmount(patch.savingsTarget, 'مبلغ الادخار', true);
  if (patch.reserve !== undefined) requireAmount(patch.reserve, 'الاحتياطي', true);
  if (patch.carryIn !== undefined) requireAmount(patch.carryIn, 'الرصيد المرحّل', true);
  if (patch.startDate !== undefined) requireDate(patch.startDate, 'تاريخ البداية');
  if (patch.nextSalaryDate !== undefined) requireDate(patch.nextSalaryDate, 'موعد الراتب القادم');

  await db.transaction('rw', [db.cycles, db.transactions], async () => {
    const sorted = sortCycles(await db.cycles.toArray());
    const i = sorted.findIndex((c) => c.id === id);
    if (i < 0) fail('الدورة غير موجودة.');
    const cycle = sorted[i];
    const prev = sorted[i - 1];
    const next = sorted[i + 1];
    const now = nowIso();
    const update: Partial<Cycle> = { updatedAt: now };

    if (patch.startDate !== undefined && patch.startDate !== cycle.startDate) {
      const s = patch.startDate;
      if (s > todayLocal()) fail('تاريخ البداية لا يمكن أن يكون في المستقبل.');
      if (prev && s <= prev.startDate) fail('تاريخ البداية يجب أن يكون بعد بداية الدورة السابقة.');
      if (next && s >= next.startDate) fail('تاريخ البداية يجب أن يكون قبل بداية الدورة التالية.');
      const end = patch.nextSalaryDate ?? cycle.nextSalaryDate;
      if (!next && s >= end) fail('تاريخ البداية يجب أن يكون قبل موعد الراتب القادم.');
      if (!prev) {
        const earliest = await db.transactions.orderBy('date').first();
        if (earliest && earliest.date < s) fail('توجد عمليات مسجلة قبل هذا التاريخ. لا يمكن تأخير بداية أول دورة بعدها.');
      }
      update.startDate = s;
      if (prev) await db.cycles.update(prev.id, { nextSalaryDate: s, updatedAt: now });
    }
    if (patch.nextSalaryDate !== undefined) {
      if (next) fail('موعد نهاية الدورة المؤرشفة يتحدد ببداية الدورة التالية.');
      const start = update.startDate ?? cycle.startDate;
      if (patch.nextSalaryDate <= start) fail('موعد الراتب القادم يجب أن يكون بعد بداية الدورة.');
      update.nextSalaryDate = patch.nextSalaryDate;
    }
    if (patch.salaryAmount !== undefined) update.salaryAmount = patch.salaryAmount;
    if (patch.savingsTarget !== undefined) update.savingsTarget = patch.savingsTarget;
    if (patch.reserve !== undefined) update.reserve = patch.reserve;
    if (patch.carryIn !== undefined) {
      if (prev && prev.carriedOut !== patch.carryIn) {
        // Keep both sides of a carry-over equal so it is never counted twice.
        await db.cycles.update(prev.id, { carriedOut: patch.carryIn, updatedAt: now });
      }
      update.carryIn = patch.carryIn;
    }
    if (patch.note !== undefined) update.note = patch.note.trim().slice(0, 300);
    await db.cycles.update(id, update);
  });
}

// ---------- Day budgets & settings ----------

export async function setDayBudget(date: ISODate, amount: number | null): Promise<void> {
  requireDate(date);
  if (amount === null) {
    await db.dayBudgets.delete(date);
    return;
  }
  requireAmount(amount, 'ميزانية اليوم', true);
  await db.dayBudgets.put({ date, amount, updatedAt: nowIso() });
}

export type SettingsPatch = Partial<Pick<Settings, 'currency' | 'defaultCycleLength' | 'defaultReserve' | 'defaultSavingsTarget' | 'plan' | 'theme' | 'lastBackupAt'>>;

export async function updateSettings(patch: SettingsPatch): Promise<void> {
  if (patch.defaultCycleLength !== undefined && (!Number.isInteger(patch.defaultCycleLength) || patch.defaultCycleLength < 1 || patch.defaultCycleLength > 120)) {
    fail('طول الدورة يجب أن يكون بين 1 و 120 يوماً.');
  }
  if (patch.defaultReserve !== undefined) requireAmount(patch.defaultReserve, 'الاحتياطي', true);
  if (patch.defaultSavingsTarget !== undefined) requireAmount(patch.defaultSavingsTarget, 'هدف الادخار', true);
  if (patch.plan) {
    const p = patch.plan;
    if (!(p.workdayWeight >= 0 && p.weekendWeight >= 0 && p.workdayWeight + p.weekendWeight > 0)) fail('أوزان الأيام غير صالحة.');
  }
  await db.transaction('rw', [db.settings, db.cycles], async () => {
    const s = await db.settings.get('app');
    if (!s) {
      // Theme may be chosen before setup is finished.
      if (patch.theme && Object.keys(patch).length === 1) return;
      fail('أكمل الإعداد أولاً.');
    }
    if (patch.currency && patch.currency !== s.currency) {
      if (currencyInfo(patch.currency).decimals !== currencyInfo(s.currency).decimals) {
        fail('لا يمكن التحويل إلى عملة بعدد خانات عشرية مختلف بعد تسجيل البيانات، لأن المبالغ المحفوظة ستتغير قيمتها.');
      }
    }
    await db.settings.put({ ...s, ...patch, updatedAt: nowIso() });
    if (patch.plan) {
      const active = sortCycles(await db.cycles.toArray()).pop();
      if (active) await db.cycles.update(active.id, { plan: patch.plan, updatedAt: nowIso() });
    }
  });
}

export async function getTheme(): Promise<Settings['theme']> {
  try {
    return (await db.settings.get('app'))?.theme ?? 'system';
  } catch {
    return 'system';
  }
}
