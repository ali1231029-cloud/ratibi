import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { loadAll } from '../db/repo';
import { todayLocal, type ISODate } from '../lib/dates';
import { activeCycle, computeCycleSummary, walletBalance, totalSavings, type CycleSummary } from '../lib/finance';
import type { AppData, Category } from '../lib/types';

export interface AppState {
  data: AppData;
  today: ISODate;
  currency: string;
  current: CycleSummary | undefined;
  wallet: number;
  savings: number;
  categoriesById: Map<string, Category>;
}

const Ctx = createContext<AppState | null>(null);

/** Re-reads the date every minute so the budget rolls over at local midnight. */
function useToday(): ISODate {
  const [today, setToday] = useState(todayLocal());
  useEffect(() => {
    const id = setInterval(() => setToday(todayLocal()), 60_000);
    const onVisible = () => setToday(todayLocal());
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return today;
}

export function AppProvider({ children, fallback, error }: { children: ReactNode; fallback: ReactNode; error: (e: unknown) => ReactNode }) {
  const [loadError, setLoadError] = useState<unknown>(null);
  // Live query: every committed write re-runs it, so all pages update immediately.
  const data = useLiveQuery(async () => {
    try {
      const d = await loadAll();
      setLoadError(null);
      return d;
    } catch (e) {
      setLoadError(e);
      return undefined;
    }
  }, []);
  const today = useToday();

  const state = useMemo<AppState | null>(() => {
    if (!data) return null;
    const cycle = activeCycle(data.cycles);
    return {
      data,
      today,
      currency: data.settings?.currency ?? 'IQD',
      current: cycle ? computeCycleSummary(data, cycle, today) : undefined,
      wallet: walletBalance(data),
      savings: totalSavings(data),
      categoriesById: new Map(data.categories.map((c) => [c.id, c])),
    };
  }, [data, today]);

  if (loadError) return <>{error(loadError)}</>;
  if (!state) return <>{fallback}</>;
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}
