// The single financial engine. Every page reads its numbers from these functions so a
// figure can never be computed two different ways. All amounts are integer minor units.
//
// Model for one salary cycle:
//   fundsIn        = carryIn + salary + other income + borrowed / collected debt money
//   availableFunds = fundsIn − every expense paid (net of refunds) − net savings transfers
//                    − debt money paid out − amount carried to the next cycle
//   spendable      = availableFunds − unpaid bills of the cycle − savings target not yet
//                    transferred − reserve
// A bill is reserved while unpaid and becomes an expense when paid, so it is never counted
// twice. A savings transfer replaces the planned savings it fulfils, never adds to it.

import { addDays, diffDays, eachDay, maxDate, minDate, weekday, addMonths, type ISODate } from './dates';
import { divideFloor, percent } from './money';
import type { AppData, Bill, BudgetPlan, Cycle, Debt, Goal, Transaction } from './types';

export const FAR_FUTURE: ISODate = '9999-12-31';

export function sortCycles(cycles: Cycle[]): Cycle[] {
  return [...cycles].sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
}

export function activeCycle(cycles: Cycle[]): Cycle | undefined {
  const sorted = sortCycles(cycles);
  return sorted.find((c) => c.status === 'active') ?? sorted[sorted.length - 1];
}

export interface CycleBounds {
  start: ISODate;
  /** Day before the expected next salary. */
  plannedEnd: ISODate;
  /** Last day that belongs to this cycle: day before the next cycle, or open-ended. */
  memberEnd: ISODate;
  next: Cycle | undefined;
  prev: Cycle | undefined;
}

export function cycleBounds(cycles: Cycle[], cycle: Cycle): CycleBounds {
  const sorted = sortCycles(cycles);
  const i = sorted.findIndex((c) => c.id === cycle.id);
  const next = i >= 0 ? sorted[i + 1] : undefined;
  const prev = i > 0 ? sorted[i - 1] : undefined;
  const memberEnd = next ? addDays(next.startDate, -1) : FAR_FUTURE;
  const plannedEnd = next ? memberEnd : addDays(cycle.nextSalaryDate, -1);
  return { start: cycle.startDate, plannedEnd, memberEnd, next, prev };
}

export function cycleForDate(cycles: Cycle[], date: ISODate): Cycle | undefined {
  let found: Cycle | undefined;
  for (const c of sortCycles(cycles)) {
    if (c.startDate <= date) found = c;
    else break;
  }
  return found;
}

export function txInRange(transactions: Transaction[], from: ISODate, to: ISODate): Transaction[] {
  return transactions.filter((t) => t.date >= from && t.date <= to);
}

/** Effect of a transaction on cash in hand (the wallet), positive = money in. */
export function cashDelta(tx: Transaction, debtsById: Map<string, Debt>): number {
  switch (tx.type) {
    case 'expense':
    case 'saving_in':
      return -tx.amount;
    case 'refund':
    case 'income':
    case 'saving_out':
      return tx.amount;
    case 'debt_open': {
      const d = tx.debtId ? debtsById.get(tx.debtId) : undefined;
      return d?.direction === 'owed_to_me' ? -tx.amount : tx.amount;
    }
    case 'debt_payment': {
      const d = tx.debtId ? debtsById.get(tx.debtId) : undefined;
      return d?.direction === 'owed_to_me' ? tx.amount : -tx.amount;
    }
  }
}

/** Consumption amount: expenses count positive, refunds negative, everything else 0. */
export function spendingOf(tx: Transaction): number {
  if (tx.type === 'expense') return tx.amount;
  if (tx.type === 'refund') return -tx.amount;
  return 0;
}

export function isFixed(tx: Transaction): boolean {
  return tx.type === 'expense' && tx.billId !== null;
}

export function isVariableSpending(tx: Transaction): boolean {
  return (tx.type === 'expense' && tx.billId === null) || tx.type === 'refund';
}

// ---------- Bills ----------

export function billOccurrences(bill: Bill, from: ISODate, to: ISODate): ISODate[] {
  if (from > to) return [];
  const last = bill.endDate ? minDate(bill.endDate, to) : to;
  const out: ISODate[] = [];
  if (bill.frequency === 'once') {
    if (bill.firstDueDate >= from && bill.firstDueDate <= last) out.push(bill.firstDueDate);
    return out;
  }
  for (let i = 0; i < 5000; i++) {
    let d: ISODate;
    if (bill.frequency === 'weekly') d = addDays(bill.firstDueDate, i * 7);
    else if (bill.frequency === 'monthly') d = addMonths(bill.firstDueDate, i);
    else d = addMonths(bill.firstDueDate, i * 12);
    if (d > last) break;
    if (d >= from) out.push(d);
  }
  return out;
}

export interface BillOccurrence {
  bill: Bill;
  dueDate: ISODate;
  payment: Transaction | undefined;
  /** Amount reserved while unpaid. */
  expected: number;
}

export function billsForPeriod(data: AppData, from: ISODate, to: ISODate): BillOccurrence[] {
  const payments = new Map<string, Transaction>();
  for (const t of data.transactions) {
    if (t.type === 'expense' && t.billId && t.billDueDate) payments.set(`${t.billId}|${t.billDueDate}`, t);
  }
  const out: BillOccurrence[] = [];
  for (const bill of data.bills) {
    const dates = billOccurrences(bill, from, to);
    for (const dueDate of dates) {
      const payment = payments.get(`${bill.id}|${dueDate}`);
      if (!bill.active && !payment) continue;
      out.push({ bill, dueDate, payment, expected: bill.amount });
    }
  }
  return out.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.bill.name.localeCompare(b.bill.name)));
}

// ---------- Daily plan ----------

export type DayStatus = 'future' | 'unrecorded' | 'ok' | 'over' | 'overdue' | 'deficit';

export interface DayRow {
  date: ISODate;
  weekday: number;
  planned: number;
  /** null when nothing was recorded on that day (never assumed to be zero spending). */
  actual: number | null;
  diff: number | null;
  status: DayStatus;
  /** Variable-spending money left after this day (projected for future days). */
  poolAfter: number;
  fixedOverride: boolean;
  isToday: boolean;
  /** Day after the expected salary date while the salary has not been confirmed. */
  afterPlannedEnd: boolean;
  txCount: number;
}

function dayWeight(plan: BudgetPlan, date: ISODate): number {
  if (plan.mode === 'equal') return 1;
  const w = plan.weekendDays.includes(weekday(date)) ? plan.weekendWeight : plan.workdayWeight;
  return w > 0 ? w : 0;
}

/** Budget for days[0] when `pool` must cover all of `days`. */
function shareForFirstDay(pool: number, days: ISODate[], plan: BudgetPlan, overrides: Map<string, number>): number {
  const first = days[0];
  const fixed = overrides.get(first);
  if (fixed !== undefined) return fixed;
  let fixedTotal = 0;
  let weightTotal = 0;
  for (const d of days) {
    const o = overrides.get(d);
    if (o !== undefined) fixedTotal += o;
    else weightTotal += dayWeight(plan, d);
  }
  const rest = pool - fixedTotal;
  if (rest <= 0 || weightTotal <= 0) return 0;
  const w = dayWeight(plan, first);
  return Math.floor((rest * w) / weightTotal);
}

// ---------- Cycle summary ----------

export interface CategoryAmount {
  categoryId: string;
  amount: number;
}

export interface Alert {
  level: 'danger' | 'warning' | 'info';
  text: string;
}

export interface CycleSummary {
  cycle: Cycle;
  bounds: CycleBounds;
  isActive: boolean;
  today: ISODate;
  totalDays: number;
  elapsedDays: number;
  /** Days left including today; 0 when the planned end has passed. */
  remainingDays: number;
  overdueDays: number;
  salary: number;
  carryIn: number;
  otherIncome: number;
  debtIn: number;
  fundsIn: number;
  variableSpending: number;
  refunds: number;
  fixedPaid: number;
  totalExpenses: number;
  savingsIn: number;
  savingsOut: number;
  savingsNet: number;
  debtOut: number;
  carriedOut: number;
  availableFunds: number;
  bills: BillOccurrence[];
  billsExpected: number;
  billsUnpaid: number;
  billsUnpaidCount: number;
  savingsTarget: number;
  savingsRemaining: number;
  reserve: number;
  spendable: number;
  deficit: number;
  variableAllocation: number;
  todaySpending: number;
  todayBudget: number;
  todayRemaining: number;
  tomorrowBudget: number;
  spentPercentOfSalary: number;
  avgDailySpending: number;
  recordedDays: number;
  days: DayRow[];
  categories: CategoryAmount[];
  transactions: Transaction[];
  alerts: Alert[];
}

export function computeCycleSummary(data: AppData, cycle: Cycle, today: ISODate): CycleSummary {
  const bounds = cycleBounds(data.cycles, cycle);
  const isActive = !bounds.next;
  const debtsById = new Map(data.debts.map((d) => [d.id, d]));

  const lastMemberDay = isActive ? maxDate(bounds.plannedEnd, today) : bounds.memberEnd;
  const txs = txInRange(data.transactions, bounds.start, isActive ? FAR_FUTURE : bounds.memberEnd);

  let otherIncome = 0, debtIn = 0, variableSpending = 0, refunds = 0, fixedPaid = 0;
  let savingsIn = 0, savingsOut = 0, debtOut = 0;
  const byCategory = new Map<string, number>();
  const byDay = new Map<string, { amount: number; count: number }>();

  for (const t of txs) {
    switch (t.type) {
      case 'income': otherIncome += t.amount; break;
      case 'saving_in': savingsIn += t.amount; break;
      case 'saving_out': savingsOut += t.amount; break;
      case 'debt_open':
      case 'debt_payment': {
        const delta = cashDelta(t, debtsById);
        if (delta > 0) debtIn += delta; else debtOut -= delta;
        break;
      }
      case 'expense':
        if (t.billId) fixedPaid += t.amount; else variableSpending += t.amount;
        break;
      case 'refund':
        refunds += t.amount;
        variableSpending -= t.amount;
        break;
    }
    const spend = spendingOf(t);
    if (spend !== 0) {
      const cat = t.categoryId ?? 'cat-other';
      byCategory.set(cat, (byCategory.get(cat) ?? 0) + spend);
    }
    if (isVariableSpending(t)) {
      const d = byDay.get(t.date) ?? { amount: 0, count: 0 };
      d.amount += spendingOf(t);
      d.count += 1;
      byDay.set(t.date, d);
    }
  }

  const salary = cycle.salaryAmount;
  const carryIn = cycle.carryIn;
  const carriedOut = cycle.carriedOut;
  const fundsIn = carryIn + salary + otherIncome + debtIn;
  const totalExpenses = variableSpending + fixedPaid;
  const savingsNet = savingsIn - savingsOut;
  const availableFunds = fundsIn - totalExpenses - savingsNet - debtOut - carriedOut;

  const bills = billsForPeriod(data, bounds.start, lastMemberDay);
  let billsExpected = 0, billsUnpaid = 0, billsUnpaidCount = 0;
  for (const b of bills) {
    billsExpected += b.expected;
    if (!b.payment) {
      billsUnpaid += b.expected;
      billsUnpaidCount += 1;
    }
  }
  // Archived cycles hold nothing back any more: their money is either spent or carried.
  const reservedBills = isActive ? billsUnpaid : 0;
  const savingsTarget = cycle.savingsTarget;
  const savingsRemaining = isActive ? Math.max(0, savingsTarget - savingsNet) : 0;
  const reserve = isActive ? cycle.reserve : 0;
  const spendable = availableFunds - reservedBills - savingsRemaining - reserve;
  const deficit = spendable < 0 ? -spendable : 0;
  const variableAllocation = spendable + variableSpending;

  // ----- day-by-day replay -----
  const planEnd = isActive ? bounds.plannedEnd : bounds.memberEnd;
  const planDays = bounds.start <= planEnd ? eachDay(bounds.start, planEnd) : [];
  const overrides = new Map(
    data.dayBudgets.filter((d) => d.date >= bounds.start && d.date <= planEnd).map((d) => [d.date, d.amount] as const),
  );
  const days: DayRow[] = [];
  let pool = variableAllocation;
  let todayBudget = 0;
  let todaySpending = byDay.get(today)?.amount ?? 0;
  let tomorrowBudget = 0;
  let futurePool: number | null = null;

  for (let i = 0; i < planDays.length; i++) {
    const date = planDays[i];
    const rest = planDays.slice(i);
    const rec = byDay.get(date);
    if (date <= today) {
      const planned = pool > 0 ? shareForFirstDay(pool, rest, cycle.plan, overrides) : 0;
      const actual = rec ? rec.amount : null;
      pool -= actual ?? 0;
      const status: DayStatus = actual === null ? 'unrecorded' : actual > planned ? 'over' : 'ok';
      days.push({
        date, weekday: weekday(date), planned, actual, diff: actual === null ? null : planned - actual,
        status, poolAfter: pool, fixedOverride: overrides.has(date), isToday: date === today,
        afterPlannedEnd: false, txCount: rec?.count ?? 0,
      });
      if (date === today) todayBudget = planned;
    } else {
      if (futurePool === null) {
        const todayRow = days.find((d) => d.isToday);
        // Keep today's unspent budget for today; the rest of the pool covers the coming days.
        futurePool = todayRow ? pool + (todayRow.actual ?? 0) - Math.max(todayRow.planned, todayRow.actual ?? 0) : pool;
      }
      const planned = futurePool > 0 ? shareForFirstDay(futurePool, rest, cycle.plan, overrides) : 0;
      futurePool -= planned;
      if (i > 0 && planDays[i - 1] === today) tomorrowBudget = planned;
      else if (today < bounds.start && i === 0) tomorrowBudget = planned;
      days.push({
        date, weekday: weekday(date), planned, actual: null, diff: null,
        status: spendable < 0 ? 'deficit' : 'future', poolAfter: futurePool, fixedOverride: overrides.has(date),
        isToday: false, afterPlannedEnd: false, txCount: rec?.count ?? 0,
      });
    }
  }
  // Salary is late: list the days past the expected date with no budget, so nothing is hidden.
  if (isActive && today > bounds.plannedEnd) {
    for (const date of eachDay(addDays(bounds.plannedEnd, 1), today)) {
      const rec = byDay.get(date);
      pool -= rec?.amount ?? 0;
      days.push({
        date, weekday: weekday(date), planned: 0, actual: rec ? rec.amount : null,
        diff: rec ? -rec.amount : null, status: 'overdue', poolAfter: pool, fixedOverride: false,
        isToday: date === today, afterPlannedEnd: true, txCount: rec?.count ?? 0,
      });
    }
  }
  if (!isActive) todaySpending = 0;

  const totalDays = planDays.length;
  const lastCountedDay = isActive ? minDate(today, lastMemberDay) : bounds.memberEnd;
  const elapsedDays = today < bounds.start ? 0 : Math.max(0, diffDays(bounds.start, lastCountedDay) + 1);
  const remainingDays = isActive && today <= bounds.plannedEnd ? diffDays(maxDate(today, bounds.start), bounds.plannedEnd) + 1 : 0;
  const overdueDays = isActive && today > bounds.plannedEnd ? diffDays(bounds.plannedEnd, today) : 0;
  const recordedDays = days.filter((d) => d.actual !== null && d.date <= today).length;
  const avgDailySpending = divideFloor(variableSpending, elapsedDays);

  const summary: CycleSummary = {
    cycle, bounds, isActive, today, totalDays, elapsedDays, remainingDays, overdueDays,
    salary, carryIn, otherIncome, debtIn, fundsIn, variableSpending, refunds, fixedPaid, totalExpenses,
    savingsIn, savingsOut, savingsNet, debtOut, carriedOut, availableFunds,
    bills, billsExpected, billsUnpaid, billsUnpaidCount, savingsTarget, savingsRemaining, reserve,
    spendable, deficit, variableAllocation,
    todaySpending, todayBudget, todayRemaining: todayBudget - todaySpending, tomorrowBudget,
    spentPercentOfSalary: percent(totalExpenses, salary),
    avgDailySpending, recordedDays, days,
    categories: [...byCategory.entries()]
      .map(([categoryId, amount]) => ({ categoryId, amount }))
      .filter((c) => c.amount > 0)
      .sort((a, b) => b.amount - a.amount),
    transactions: txs,
    alerts: [],
  };
  summary.alerts = buildAlerts(summary);
  return summary;
}

function buildAlerts(s: CycleSummary): Alert[] {
  if (!s.isActive) return [];
  const alerts: Alert[] = [];
  if (s.overdueDays > 0) {
    alerts.push({ level: 'warning', text: `موعد الراتب المتوقع مضى عليه ${s.overdueDays} يوم. أكّد استلام الراتب أو مدّد الدورة.` });
  }
  if (s.spendable < 0) {
    alerts.push({ level: 'danger', text: 'يوجد عجز: المصاريف والالتزامات أكبر من المال المتاح لهذه الدورة.' });
  } else if (s.remainingDays > 0) {
    if (s.todayRemaining < 0) {
      alerts.push({ level: 'danger', text: 'تجاوزت ميزانية اليوم. ستُعاد جدولة ميزانيات الأيام القادمة تلقائياً.' });
    }
    if (s.elapsedDays >= 3 && s.variableAllocation > 0) {
      const projected = s.avgDailySpending * s.totalDays;
      if (projected > s.variableAllocation) {
        alerts.push({ level: 'warning', text: 'بمعدل إنفاقك الحالي ستتجاوز ميزانية الدورة قبل موعد الراتب.' });
      }
    }
    if (s.variableAllocation > 0 && s.spendable * 10 < s.variableAllocation && s.remainingDays > 3) {
      alerts.push({ level: 'warning', text: 'بقي أقل من 10% من ميزانية الصرف لهذه الدورة.' });
    }
  }
  const soon = s.bills.filter((b) => !b.payment && diffDays(s.today, b.dueDate) <= 3);
  for (const b of soon) {
    const d = diffDays(s.today, b.dueDate);
    const when = d < 0 ? `متأخرة ${-d} يوم` : d === 0 ? 'مستحقة اليوم' : `مستحقة بعد ${d} يوم`;
    alerts.push({ level: d < 0 ? 'danger' : 'info', text: `فاتورة ${b.bill.name} ${when}.` });
  }
  return alerts;
}

// ---------- Wallet, goals, debts ----------

export function walletBalance(data: AppData): number {
  const debtsById = new Map(data.debts.map((d) => [d.id, d]));
  let total = data.settings?.initialBalance ?? 0;
  for (const c of data.cycles) total += c.salaryAmount;
  for (const t of data.transactions) total += cashDelta(t, debtsById);
  return total;
}

export interface GoalProgress {
  goal: Goal;
  saved: number;
  remaining: number;
  percent: number;
}

export function goalProgress(data: AppData, goal: Goal): GoalProgress {
  let saved = 0;
  for (const t of data.transactions) {
    if (t.goalId !== goal.id) continue;
    if (t.type === 'saving_in') saved += t.amount;
    else if (t.type === 'saving_out') saved -= t.amount;
  }
  return {
    goal,
    saved,
    remaining: Math.max(0, goal.targetAmount - saved),
    percent: Math.min(100, percent(saved, goal.targetAmount)),
  };
}

export function totalSavings(data: AppData): number {
  let s = 0;
  for (const t of data.transactions) {
    if (t.type === 'saving_in') s += t.amount;
    else if (t.type === 'saving_out') s -= t.amount;
  }
  return s;
}

export interface DebtStatus {
  debt: Debt;
  paid: number;
  remaining: number;
  payments: Transaction[];
}

export function debtStatus(data: AppData, debt: Debt): DebtStatus {
  const payments = data.transactions.filter((t) => t.debtId === debt.id && t.type === 'debt_payment');
  const paid = payments.reduce((a, t) => a + t.amount, 0);
  return { debt, paid, remaining: Math.max(0, debt.principal - paid), payments };
}

/** Largest amount that may be carried from the active cycle into a new one. */
export function suggestedCarryOver(data: AppData, today: ISODate): number {
  const c = activeCycle(data.cycles);
  if (!c) return 0;
  return Math.max(0, computeCycleSummary(data, c, today).availableFunds);
}

// ---------- Range reports ----------

export interface RangeReport {
  from: ISODate;
  to: ISODate;
  days: number;
  salaryIncome: number;
  otherIncome: number;
  totalIncome: number;
  variableSpending: number;
  fixedSpending: number;
  totalSpending: number;
  refunds: number;
  savingsNet: number;
  avgDaily: number;
  recordedDays: number;
  unrecordedDays: number;
  categories: CategoryAmount[];
  topDays: { date: ISODate; amount: number }[];
  daily: { date: ISODate; amount: number | null }[];
}

export function rangeReport(data: AppData, from: ISODate, to: ISODate, today: ISODate): RangeReport {
  const txs = txInRange(data.transactions, from, to);
  let otherIncome = 0, variableSpending = 0, fixedSpending = 0, refunds = 0, savingsNet = 0;
  const byCategory = new Map<string, number>();
  const byDay = new Map<string, number>();
  for (const t of txs) {
    if (t.type === 'income') otherIncome += t.amount;
    else if (t.type === 'saving_in') savingsNet += t.amount;
    else if (t.type === 'saving_out') savingsNet -= t.amount;
    else if (t.type === 'refund') { refunds += t.amount; variableSpending -= t.amount; }
    else if (t.type === 'expense') { if (t.billId) fixedSpending += t.amount; else variableSpending += t.amount; }
    const s = spendingOf(t);
    if (s !== 0) {
      const cat = t.categoryId ?? 'cat-other';
      byCategory.set(cat, (byCategory.get(cat) ?? 0) + s);
      byDay.set(t.date, (byDay.get(t.date) ?? 0) + s);
    }
  }
  const salaryIncome = data.cycles.filter((c) => c.startDate >= from && c.startDate <= to).reduce((a, c) => a + c.salaryAmount, 0);
  const countedEnd = minDate(to, today);
  const dayList = from <= countedEnd ? eachDay(from, countedEnd) : [];
  const totalSpending = variableSpending + fixedSpending;
  const recordedDays = dayList.filter((d) => byDay.has(d)).length;
  return {
    from, to, days: dayList.length,
    salaryIncome, otherIncome, totalIncome: salaryIncome + otherIncome,
    variableSpending, fixedSpending, totalSpending, refunds, savingsNet,
    avgDaily: divideFloor(totalSpending, dayList.length),
    recordedDays, unrecordedDays: dayList.length - recordedDays,
    categories: [...byCategory.entries()].map(([categoryId, amount]) => ({ categoryId, amount }))
      .filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount),
    topDays: [...byDay.entries()].map(([date, amount]) => ({ date, amount }))
      .filter((d) => d.amount > 0).sort((a, b) => b.amount - a.amount).slice(0, 5),
    daily: dayList.map((date) => ({ date, amount: byDay.has(date) ? byDay.get(date)! : null })),
  };
}
