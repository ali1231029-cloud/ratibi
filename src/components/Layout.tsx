import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTxSheet } from './TxSheet';

const MAIN = [
  { to: '/', label: 'الرئيسية', icon: '🏠' },
  { to: '/expenses', label: 'المصاريف', icon: '🧾' },
  { to: '/budget', label: 'الميزانية', icon: '📅' },
  { to: '/savings', label: 'الادخار', icon: '🎯' },
];

export const MORE = [
  { to: '/bills', label: 'الفواتير والالتزامات', icon: '📌', hint: 'المصاريف الثابتة ومواعيدها' },
  { to: '/cycles', label: 'سجل الرواتب', icon: '🗂️', hint: 'الدورات السابقة والحالية' },
  { to: '/reports', label: 'التقارير', icon: '📊', hint: 'تحليلات ومقارنات' },
  { to: '/debts', label: 'الديون', icon: '🤝', hint: 'لك وعليك' },
  { to: '/settings', label: 'الإعدادات والنسخ', icon: '⚙️', hint: 'النسخ الاحتياطي والفئات' },
];

export function Layout() {
  const openTx = useTxSheet();
  const { pathname } = useLocation();
  const moreActive = MORE.some((m) => pathname.startsWith(m.to)) || pathname === '/more';
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><img src="./icon.svg" alt="" />راتبي</div>
        {[...MAIN, ...MORE].map((l) => (
          <NavLink key={l.to} to={l.to} end={l.to === '/'} className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}>
            <span className="ico">{l.icon}</span>{l.label}
          </NavLink>
        ))}
      </aside>
      <main className="main">
        <Outlet />
      </main>
      <button className="fab" onClick={() => openTx()} aria-label="إضافة مصروف"><span>+</span>مصروف</button>
      <nav className="bottom-nav" aria-label="التنقل الرئيسي">
        {MAIN.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
            <span className="ico">{l.icon}</span>{l.label}
          </NavLink>
        ))}
        <NavLink to="/more" className={moreActive ? 'active' : ''}><span className="ico">☰</span>المزيد</NavLink>
      </nav>
    </div>
  );
}
