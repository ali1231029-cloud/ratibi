import { describe, expect, it } from 'vitest';
import { computeCycleSummary, rangeReport, walletBalance, billOccurrences } from '../src/lib/finance';
import { formatMoney, parseAmount } from '../src/lib/money';
import { addDays, addMonths, diffDays, weekday, todayLocal } from '../src/lib/dates';
import type { AppData, Bill, Cycle, Transaction } from '../src/lib/types';

const NOW = '2026-10-25T00:00:00.000Z';
const plan = { mode: 'equal' as const, weekendDays: [5, 6], workdayWeight: 1, weekendWeight: 1 };

function cycle(over: Partial<Cycle> = {}): Cycle {
  return {
    id: 'c1', startDate: '2026-10-25', nextSalaryDate: '2026-11-24', salaryAmount: 1_000_000,
    carryIn: 0, carriedOut: 0, savingsTarget: 150_000, reserve: 0, plan, status: 'active', note: '',
    createdAt: NOW, updatedAt: NOW, archivedAt: null, ...over,
  };
}

const rent: Bill = {
  id: 'b1', name: 'الإيجار', amount: 250_000, frequency: 'monthly', firstDueDate: '2026-11-01',
  categoryId: 'cat-rent', active: true, endDate: null, createdAt: NOW, updatedAt: NOW,
};

let seq = 0;
function tx(over: Partial<Transaction>): Transaction {
  return {
    id: `t${++seq}`, type: 'expense', amount: 0, date: '2026-10-25', note: '', categoryId: 'cat-food',
    paymentMethod: 'cash', incomeKind: null, billId: null, billDueDate: null, goalId: null, debtId: null,
    createdAt: NOW, updatedAt: NOW, ...over,
  };
}

function data(over: Partial<AppData> = {}): AppData {
  return {
    settings: undefined, cycles: [cycle()], transactions: [], categories: [], bills: [rent],
    goals: [{ id: 'g1', name: 'ادخار عام', targetAmount: 0, targetDate: null, archived: false, createdAt: NOW, updatedAt: NOW }],
    debts: [], dayBudgets: [], ...over,
  };
}

describe('money and dates', () => {
  it('parses amounts as integers, including Arabic digits and separators', () => {
    expect(parseAmount('1,000,000')).toBe(1_000_000);
    expect(parseAmount('١٠٠٠٠٠٠')).toBe(1_000_000);
    expect(parseAmount('12.50', 2)).toBe(1250);
    expect(parseAmount('0.1', 2)).toBe(10);
    expect(parseAmount('-5')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('5.5')).toBeNull(); // IQD has no fractions
    expect(parseAmount('')).toBeNull();
  });

  it('formats IQD as "1,000,000 د.ع"', () => {
    expect(formatMoney(1_000_000).replace(/[⁦⁩]/g, '')).toBe('1,000,000 د.ع');
    expect(formatMoney(-5_000).replace(/[⁦⁩]/g, '')).toBe('-5,000 د.ع');
  });

  it('does calendar math on local days without timezone drift', () => {
    expect(addDays('2026-10-25', 30)).toBe('2026-11-24');
    expect(diffDays('2026-10-25', '2026-11-24')).toBe(30);
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(weekday('2026-10-30')).toBe(5); // Friday
    // 23:30 local time is still the same calendar day.
    expect(todayLocal(new Date(2026, 9, 25, 23, 30))).toBe('2026-10-25');
  });

  it('generates monthly bill occurrences inside a range', () => {
    expect(billOccurrences(rent, '2026-10-25', '2026-11-23')).toEqual(['2026-11-01']);
    expect(billOccurrences(rent, '2026-10-25', '2027-01-05')).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
  });
});

describe('required calculation scenario (salary 1,000,000 / fixed 250,000 / savings 150,000 / 30 days)', () => {
  it('starts with 600,000 spendable and 20,000 per day', () => {
    const s = computeCycleSummary(data(), cycle(), '2026-10-25');
    expect(s.totalDays).toBe(30);
    expect(s.remainingDays).toBe(30);
    expect(s.billsUnpaid).toBe(250_000);
    expect(s.savingsRemaining).toBe(150_000);
    expect(s.spendable).toBe(600_000);
    expect(s.todayBudget).toBe(20_000);
    expect(s.days.every((d) => d.planned === 20_000)).toBe(true);
  });

  it('a 5,000 expense leaves 595,000 and updates future days', () => {
    const d = data({ transactions: [tx({ amount: 5_000 })] });
    const s = computeCycleSummary(d, cycle(), '2026-10-25');
    expect(s.spendable).toBe(595_000);
    expect(s.variableSpending).toBe(5_000);
    expect(s.todayBudget).toBe(20_000);
    expect(s.todayRemaining).toBe(15_000);
    // Next morning the 15,000 left over from day one rolls into the remaining 29 days.
    const next = computeCycleSummary(d, cycle(), '2026-10-26');
    expect(next.spendable).toBe(595_000);
    expect(next.remainingDays).toBe(29);
    expect(next.todayBudget).toBe(Math.floor(595_000 / 29)); // 20,517
    expect(next.days[0].status).toBe('ok');
    expect(next.days[0].actual).toBe(5_000);
  });

  it('paying the bill and transferring savings do not reduce the spendable amount again', () => {
    const d = data({
      transactions: [
        tx({ amount: 5_000 }),
        tx({ amount: 250_000, date: '2026-10-26', billId: 'b1', billDueDate: '2026-11-01', categoryId: 'cat-rent' }),
        tx({ type: 'saving_in', amount: 150_000, date: '2026-10-26', categoryId: null, goalId: 'g1' }),
      ],
    });
    const s = computeCycleSummary(d, cycle(), '2026-10-26');
    expect(s.billsUnpaid).toBe(0);
    expect(s.fixedPaid).toBe(250_000);
    expect(s.savingsRemaining).toBe(0);
    expect(s.savingsNet).toBe(150_000);
    expect(s.spendable).toBe(595_000);
    expect(s.availableFunds).toBe(595_000);
    expect(s.totalExpenses).toBe(255_000); // the savings transfer is not an expense
  });

  it('overspending lowers the budget of the coming days', () => {
    const d = data({ transactions: [tx({ amount: 50_000 })] });
    const s = computeCycleSummary(d, cycle(), '2026-10-26');
    expect(s.days[0].status).toBe('over');
    expect(s.todayBudget).toBe(Math.floor(550_000 / 29));
  });

  it('a day with nothing recorded is "unrecorded", not zero spending', () => {
    const s = computeCycleSummary(data(), cycle(), '2026-10-27');
    expect(s.days[0].actual).toBeNull();
    expect(s.days[0].status).toBe('unrecorded');
    expect(s.recordedDays).toBe(0);
  });
});

describe('edge cases', () => {
  it('shows a deficit instead of a misleading positive budget', () => {
    const d = data({ transactions: [tx({ amount: 700_000 })] });
    const s = computeCycleSummary(d, cycle(), '2026-10-26');
    expect(s.spendable).toBe(-100_000);
    expect(s.deficit).toBe(100_000);
    expect(s.todayBudget).toBe(0);
    expect(s.alerts.some((a) => a.level === 'danger')).toBe(true);
  });

  it('never divides by zero when the salary is late', () => {
    const s = computeCycleSummary(data(), cycle(), '2026-11-27');
    expect(s.remainingDays).toBe(0);
    expect(s.overdueDays).toBe(4);
    expect(s.todayBudget).toBe(0);
    expect(Number.isFinite(s.avgDailySpending)).toBe(true);
    expect(s.days.filter((d) => d.afterPlannedEnd)).toHaveLength(4);
    expect(s.alerts.some((a) => a.text.includes('موعد الراتب'))).toBe(true);
  });

  it('refunds reduce spending and are not income; extra income raises the budget', () => {
    const d = data({
      transactions: [
        tx({ amount: 20_000 }),
        tx({ type: 'refund', amount: 8_000 }),
        tx({ type: 'income', amount: 100_000, categoryId: null, paymentMethod: null, incomeKind: 'bonus' }),
      ],
    });
    const s = computeCycleSummary(d, cycle(), '2026-10-25');
    expect(s.variableSpending).toBe(12_000);
    expect(s.otherIncome).toBe(100_000);
    expect(s.spendable).toBe(600_000 - 12_000 + 100_000);
  });

  it('debts move cash but are neither income nor expenses', () => {
    const d = data({
      debts: [{ id: 'd1', person: 'علي', direction: 'i_owe', principal: 200_000, startDate: '2026-10-25', dueDate: null, note: '', closed: false, createdAt: NOW, updatedAt: NOW }],
      transactions: [
        tx({ type: 'debt_open', amount: 200_000, categoryId: null, debtId: 'd1' }),
        tx({ type: 'debt_payment', amount: 50_000, categoryId: null, debtId: 'd1' }),
      ],
    });
    const s = computeCycleSummary(d, cycle(), '2026-10-25');
    expect(s.totalExpenses).toBe(0);
    expect(s.otherIncome).toBe(0);
    expect(s.debtIn).toBe(200_000);
    expect(s.debtOut).toBe(50_000);
    expect(s.spendable).toBe(600_000 + 150_000);
  });

  it('flexible mode gives weekends more and never plans more than the pool', () => {
    const flex = { mode: 'flexible' as const, weekendDays: [5, 6], workdayWeight: 1, weekendWeight: 2 };
    const s = computeCycleSummary(data({ cycles: [cycle({ plan: flex })] }), cycle({ plan: flex }), '2026-10-25');
    const fri = s.days.find((d) => d.weekday === 5)!;
    const sun = s.days.find((d) => d.weekday === 0)!;
    expect(fri.planned).toBeGreaterThan(sun.planned);
    const total = s.days.reduce((a, d) => a + d.planned, 0);
    expect(total).toBeLessThanOrEqual(600_000);
    expect(total).toBeGreaterThan(600_000 - 30);
  });

  it('a fixed budget for one day is honoured and the rest is spread over the others', () => {
    const d = data({ dayBudgets: [{ date: '2026-10-25', amount: 60_000, updatedAt: NOW }] });
    const s = computeCycleSummary(d, cycle(), '2026-10-25');
    expect(s.todayBudget).toBe(60_000);
    expect(s.days[1].planned).toBe(Math.floor(540_000 / 29));
  });
});

describe('cycles, archive and carry-over', () => {
  const c1 = cycle({ status: 'archived', nextSalaryDate: '2026-11-24', carriedOut: 30_000 });
  const c2 = cycle({ id: 'c2', startDate: '2026-11-24', nextSalaryDate: '2026-12-24', carryIn: 30_000, salaryAmount: 1_000_000 });

  it('transactions belong to the cycle of their date', () => {
    const d = data({
      cycles: [c1, c2],
      transactions: [tx({ amount: 10_000, date: '2026-11-20' }), tx({ amount: 7_000, date: '2026-11-25' })],
    });
    const old = computeCycleSummary(d, c1, '2026-11-25');
    const cur = computeCycleSummary(d, c2, '2026-11-25');
    expect(old.variableSpending).toBe(10_000);
    expect(cur.variableSpending).toBe(7_000);
    expect(old.isActive).toBe(false);
    expect(old.totalDays).toBe(30);
  });

  it('a carried amount leaves the old cycle and enters the new one exactly once', () => {
    const d = data({ cycles: [c1, c2], bills: [] });
    const old = computeCycleSummary(d, c1, '2026-11-25');
    const cur = computeCycleSummary(d, c2, '2026-11-25');
    expect(old.availableFunds).toBe(1_000_000 - 30_000);
    expect(cur.fundsIn).toBe(1_030_000);
    // Wallet total counts each salary once and ignores the carry entirely.
    expect(walletBalance(d)).toBe(2_000_000);
  });
});

describe('range reports', () => {
  it('separates fixed and variable spending and counts unrecorded days', () => {
    const d = data({
      transactions: [
        tx({ amount: 5_000, date: '2026-10-25' }),
        tx({ amount: 250_000, date: '2026-10-26', billId: 'b1', billDueDate: '2026-11-01', categoryId: 'cat-rent' }),
      ],
    });
    const r = rangeReport(d, '2026-10-25', '2026-10-31', '2026-10-27');
    expect(r.salaryIncome).toBe(1_000_000);
    expect(r.variableSpending).toBe(5_000);
    expect(r.fixedSpending).toBe(250_000);
    expect(r.days).toBe(3);
    expect(r.recordedDays).toBe(2);
    expect(r.unrecordedDays).toBe(1);
    expect(r.categories[0].categoryId).toBe('cat-rent');
  });
});
