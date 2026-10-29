import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RatibiDB, useDatabase, db as currentDb } from '../src/db/db';
import * as repo from '../src/db/repo';
import { createBackup, parseBackupText, restoreBackup, transactionsCsv } from '../src/db/backup';
import { activeCycle, computeCycleSummary, sortCycles } from '../src/lib/finance';
import { todayLocal } from '../src/lib/dates';

let n = 0;
function freshDb(): RatibiDB {
  const instance = new RatibiDB(`test-${++n}`);
  useDatabase(instance);
  return instance;
}

function db() {
  return currentDb;
}

vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date(2026, 9, 25, 21, 0)); // 25 Oct 2026, 9 pm local time

afterAll(() => vi.useRealTimers());

const SETUP: repo.SetupInput = {
  currency: 'IQD',
  salaryAmount: 1_000_000,
  receivedDate: '2026-10-25',
  nextSalaryDate: '2026-11-24',
  savingsTarget: 150_000,
  reserve: 0,
  initialBalance: 0,
  includeInitialInCycle: true,
  bills: [{ name: 'الإيجار', amount: 250_000, firstDueDate: '2026-11-01', frequency: 'monthly', categoryId: 'cat-rent' }],
};

describe('persistent storage', () => {
  beforeEach(() => {
    freshDb();
  });

  it('seeds default categories once, on first creation only', async () => {
    const cats = await db().categories.toArray();
    expect(cats).toHaveLength(13);
    await db().categories.delete('cat-fun');
    db().close();
    const reopened = new RatibiDB(db().name);
    useDatabase(reopened);
    expect(await reopened.categories.count()).toBe(12);
  });

  it('keeps the salary and an expense after closing and reopening the database', async () => {
    await repo.completeSetup(SETUP);
    await repo.addTransaction({ id: 'e1', type: 'expense', amount: 5_000, date: todayLocal(), categoryId: 'cat-food' });
    const name = db().name;
    db().close();

    const reopened = new RatibiDB(name);
    useDatabase(reopened);
    const data = await repo.loadAll();
    expect(data.settings?.setupComplete).toBe(true);
    expect(data.cycles).toHaveLength(1);
    expect(data.cycles[0].salaryAmount).toBe(1_000_000);
    expect(data.transactions).toHaveLength(1);
    const s = computeCycleSummary(data, data.cycles[0], todayLocal());
    expect(s.spendable).toBe(595_000);
  });

  it('never records the salary twice (second setup is refused)', async () => {
    await repo.completeSetup(SETUP);
    await expect(repo.completeSetup(SETUP)).rejects.toThrow('مسبقاً');
    expect(await db().cycles.count()).toBe(1);
  });

  it('a repeated save with the same id does not duplicate the expense', async () => {
    await repo.completeSetup(SETUP);
    const input = { id: 'same', type: 'expense' as const, amount: 5_000, date: '2026-10-25', categoryId: 'cat-food' };
    const [a, b] = await Promise.all([repo.addTransaction(input), repo.addTransaction(input)]);
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
    await repo.addTransaction(input);
    expect(await db().transactions.count()).toBe(1);
  });

  it('records the local date, not the UTC date, late at night', async () => {
    vi.setSystemTime(new Date(2026, 9, 25, 23, 50));
    expect(todayLocal()).toBe('2026-10-25');
    vi.setSystemTime(new Date(2026, 9, 25, 21, 0));
  });

  it('rejects invalid values and future dates without saving', async () => {
    await repo.completeSetup(SETUP);
    await expect(repo.addTransaction({ id: 'x1', type: 'expense', amount: 0, date: '2026-10-25', categoryId: 'cat-food' })).rejects.toThrow();
    await expect(repo.addTransaction({ id: 'x2', type: 'expense', amount: -5, date: '2026-10-25', categoryId: 'cat-food' })).rejects.toThrow();
    await expect(repo.addTransaction({ id: 'x3', type: 'expense', amount: 1.5, date: '2026-10-25', categoryId: 'cat-food' })).rejects.toThrow();
    await expect(repo.addTransaction({ id: 'x4', type: 'expense', amount: 100, date: '2026-10-26', categoryId: 'cat-food' })).rejects.toThrow('مستقبلي');
    await expect(repo.addTransaction({ id: 'x5', type: 'expense', amount: 100, date: '2026-10-20', categoryId: 'cat-food' })).rejects.toThrow('يسبق');
    await expect(repo.addTransaction({ id: 'x6', type: 'expense', amount: 100, date: '2026-10-25', categoryId: 'nope' })).rejects.toThrow('فئة');
    expect(await db().transactions.count()).toBe(0);
  });

  it('reports a failed write instead of claiming success', async () => {
    await repo.completeSetup(SETUP);
    db().close();
    let message = '';
    try {
      await repo.addTransaction({ id: 'f1', type: 'expense', amount: 100, date: '2026-10-25', categoryId: 'cat-food' });
    } catch (e) {
      message = repo.errorMessage(e);
    }
    expect(message).not.toBe('');
  });

  it('edits and deletes expenses', async () => {
    await repo.completeSetup(SETUP);
    await repo.addTransaction({ id: 'e1', type: 'expense', amount: 5_000, date: '2026-10-25', categoryId: 'cat-food' });
    await repo.updateTransaction({ id: 'e1', type: 'expense', amount: 7_000, date: '2026-10-25', categoryId: 'cat-transport' });
    let t = await db().transactions.get('e1');
    expect(t?.amount).toBe(7_000);
    expect(t?.categoryId).toBe('cat-transport');
    await repo.deleteTransaction('e1');
    t = await db().transactions.get('e1');
    expect(t).toBeUndefined();
  });

  it('pays a bill only once per due date', async () => {
    await repo.completeSetup(SETUP);
    const bill = (await db().bills.toArray())[0];
    const input = { billId: bill.id, dueDate: '2026-11-01', amount: 250_000, date: '2026-10-25', paymentMethod: 'cash' as const };
    expect((await repo.payBill(input)).created).toBe(true);
    expect((await repo.payBill(input)).created).toBe(false);
    expect(await db().transactions.count()).toBe(1);
    const data = await repo.loadAll();
    const s = computeCycleSummary(data, data.cycles[0], '2026-10-25');
    expect(s.spendable).toBe(600_000);
  });
});

describe('salary cycles', () => {
  beforeEach(() => {
    freshDb();
  });

  it('archives the old cycle, keeps its expenses, and cannot be confirmed twice', async () => {
    await repo.completeSetup(SETUP);
    await repo.addTransaction({ id: 'old', type: 'expense', amount: 10_000, date: '2026-10-25', categoryId: 'cat-food' });
    vi.setSystemTime(new Date(2026, 10, 24, 10, 0));
    const input = { amount: 1_100_000, receivedDate: '2026-11-24', nextSalaryDate: '2026-12-24', savingsTarget: 100_000, reserve: 0, carryOver: 0 };
    await repo.confirmSalary(input);
    await expect(repo.confirmSalary(input)).rejects.toThrow('مسبقاً');

    const data = await repo.loadAll();
    const cycles = sortCycles(data.cycles);
    expect(cycles).toHaveLength(2);
    expect(cycles[0].status).toBe('archived');
    expect(cycles[1].status).toBe('active');
    const old = computeCycleSummary(data, cycles[0], '2026-11-24');
    expect(old.variableSpending).toBe(10_000);
    expect(old.totalDays).toBe(30);
    expect(await db().transactions.get('old')).toBeDefined();
    vi.setSystemTime(new Date(2026, 9, 25, 21, 0));
  });

  it('carries over only by choice and never more than what is left', async () => {
    await repo.completeSetup({ ...SETUP, bills: [], savingsTarget: 0 });
    await repo.addTransaction({ id: 'e', type: 'expense', amount: 900_000, date: '2026-10-25', categoryId: 'cat-food' });
    vi.setSystemTime(new Date(2026, 10, 24, 10, 0));
    const base = { amount: 1_000_000, receivedDate: '2026-11-24', nextSalaryDate: '2026-12-24', savingsTarget: 0, reserve: 0 };
    await expect(repo.confirmSalary({ ...base, carryOver: 150_000 })).rejects.toThrow('الترحيل');
    await repo.confirmSalary({ ...base, carryOver: 100_000 });
    const data = await repo.loadAll();
    const [c1, c2] = sortCycles(data.cycles);
    expect(c1.carriedOut).toBe(100_000);
    expect(c2.carryIn).toBe(100_000);
    expect(computeCycleSummary(data, c1, '2026-11-24').availableFunds).toBe(0);
    expect(computeCycleSummary(data, c2, '2026-11-24').spendable).toBe(1_100_000);
    vi.setSystemTime(new Date(2026, 9, 25, 21, 0));
  });

  it('extends a cycle when the salary is late without touching data', async () => {
    await repo.completeSetup(SETUP);
    await repo.addTransaction({ id: 'e', type: 'expense', amount: 5_000, date: '2026-10-25', categoryId: 'cat-food' });
    const c = activeCycle((await repo.loadAll()).cycles)!;
    await repo.updateCycle(c.id, { nextSalaryDate: '2026-11-29' });
    const data = await repo.loadAll();
    const s = computeCycleSummary(data, data.cycles[0], '2026-10-25');
    expect(s.totalDays).toBe(35);
    expect(s.spendable).toBe(595_000);
    expect(data.transactions).toHaveLength(1);
  });

  it('reopening the app never starts a new cycle by itself', async () => {
    await repo.completeSetup(SETUP);
    vi.setSystemTime(new Date(2027, 0, 15, 10, 0));
    const name = db().name;
    db().close();
    useDatabase(new RatibiDB(name));
    const data = await repo.loadAll();
    expect(data.cycles).toHaveLength(1);
    const s = computeCycleSummary(data, data.cycles[0], todayLocal());
    expect(s.overdueDays).toBeGreaterThan(0);
    vi.setSystemTime(new Date(2026, 9, 25, 21, 0));
  });
});

describe('backup and restore', () => {
  beforeEach(() => {
    freshDb();
  });

  it('exports, validates and restores without duplicating records', async () => {
    await repo.completeSetup(SETUP);
    await repo.addTransaction({ id: 'e1', type: 'expense', amount: 5_000, date: '2026-10-25', categoryId: 'cat-food', note: 'غداء, "مطعم"' });
    const backup = await createBackup();
    const text = JSON.stringify(backup);
    expect(text).toContain('e1');

    const check = parseBackupText(text);
    expect(check.ok).toBe(true);
    expect(check.counts.transactions).toBe(1);

    // Merge into the same data: nothing is added twice.
    const merged = await restoreBackup(check.backup!, 'merge');
    expect(merged.added).toBe(0);
    expect(await db().transactions.count()).toBe(1);
    expect(await db().cycles.count()).toBe(1);

    // Replace into an empty database restores everything.
    freshDb();
    const replaced = await restoreBackup(check.backup!, 'replace');
    expect(replaced.added).toBeGreaterThan(0);
    const data = await repo.loadAll();
    expect(data.cycles).toHaveLength(1);
    expect(data.transactions[0].note).toBe('غداء, "مطعم"');
    expect(data.settings?.setupComplete).toBe(true);
    expect(await db().snapshots.count()).toBe(1);

    const csv = transactionsCsv(data);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('"غداء, ""مطعم"""');
  });

  it('rejects files that are not valid backups', () => {
    expect(parseBackupText('not json').ok).toBe(false);
    expect(parseBackupText('{"app":"other"}').ok).toBe(false);
    const dup = { app: 'ratibi', version: 1, exportedAt: '', data: { settings: null, cycles: [], transactions: [{ id: 'a' }, { id: 'a' }], categories: [], bills: [], goals: [], debts: [], dayBudgets: [] } };
    expect(parseBackupText(JSON.stringify(dup)).ok).toBe(false);
  });
});
