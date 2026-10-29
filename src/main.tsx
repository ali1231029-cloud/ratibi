import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import './styles.css';
import { AppProvider, useApp } from './hooks/useApp';
import { ConfirmProvider, ToastProvider } from './components/ui';
import { TxSheetProvider } from './components/TxSheet';
import { Layout } from './components/Layout';
import { requestPersistentStorage } from './db/db';
import { errorMessage } from './db/repo';
import Setup from './pages/Setup';
import Dashboard from './pages/Dashboard';
import Expenses from './pages/Expenses';
import Budget from './pages/Budget';
import Bills from './pages/Bills';
import Savings from './pages/Savings';
import Cycles, { CycleDetail } from './pages/Cycles';
import Reports from './pages/Reports';
import Debts from './pages/Debts';
import Settings from './pages/Settings';
import More from './pages/More';

function ThemeSync() {
  const { data } = useApp();
  const theme = data.settings?.theme ?? 'system';
  useEffect(() => {
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b1120' : '#0f766e');
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  return null;
}

function Routed() {
  const { data } = useApp();
  if (!data.settings?.setupComplete || data.cycles.length === 0) {
    return (
      <Routes>
        <Route path="*" element={<Setup />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="expenses" element={<Expenses />} />
        <Route path="budget" element={<Budget />} />
        <Route path="bills" element={<Bills />} />
        <Route path="savings" element={<Savings />} />
        <Route path="cycles" element={<Cycles />} />
        <Route path="cycles/:id" element={<CycleDetail />} />
        <Route path="reports" element={<Reports />} />
        <Route path="debts" element={<Debts />} />
        <Route path="settings" element={<Settings />} />
        <Route path="more" element={<More />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

const loading = (
  <div className="loading"><div><div className="spinner" />جارٍ تحميل بياناتك…</div></div>
);

const loadError = (e: unknown) => (
  <div className="setup">
    <div className="alert danger">تعذّر فتح قاعدة البيانات: {errorMessage(e)}</div>
    <p className="muted">بياناتك لم تُحذف. أعد تحميل الصفحة، وإذا تكررت المشكلة تأكد أن المتصفح لا يعمل في وضع التصفح الخاص وأن مساحة التخزين متاحة.</p>
    <button className="btn primary" onClick={() => location.reload()}>إعادة التحميل</button>
  </div>
);

void requestPersistentStorage();
if (import.meta.env.PROD) registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <ConfirmProvider>
        <AppProvider fallback={loading} error={loadError}>
          <ThemeSync />
          <TxSheetProvider>
            <HashRouter>
              <Routed />
            </HashRouter>
          </TxSheetProvider>
        </AppProvider>
      </ConfirmProvider>
    </ToastProvider>
  </StrictMode>,
);
