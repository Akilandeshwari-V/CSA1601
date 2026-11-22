import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { AuthProvider, useAuth } from './auth.jsx';
import { applyGlobal, emptyFilters } from './lib/filters.js';
import { THEMES, applyTheme } from './theme.js';
import { fmtInt, setCurrency } from './lib/format.js';
import Login from './components/Login.jsx';
import FilterBar from './components/FilterBar.jsx';
import CubeLab from './components/CubeLab.jsx';
import Dashboard from './components/Dashboard.jsx';
import Analytics from './components/Analytics.jsx';
import DataMining from './components/DataMining.jsx';
import Forecast from './components/Forecast.jsx';
import DataModel from './components/DataModel.jsx';
import DataQuality from './components/DataQuality.jsx';
import Datasets from './components/Datasets.jsx';
import Reports from './components/Reports.jsx';
import Admin from './components/Admin.jsx';
import Account from './components/Account.jsx';
import Methodology from './components/Methodology.jsx';

const ICONS = {
  dashboard: 'M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z',
  cube: 'M12 2 3 7v10l9 5 9-5V7zm0 2.3 6.3 3.5L12 11.3 5.7 7.8zM5 9.5l6 3.3v6.5l-6-3.3zm14 0v6.5l-6 3.3v-6.5z',
  analytics: 'M4 20V10h4v10zm6 0V4h4v16zm6 0v-7h4v7z',
  mining: 'M12 3a9 9 0 1 0 9 9h-9zm2 0v7h7a7 7 0 0 0-7-7',
  forecast: 'M3 17l6-6 4 4 8-9v5h2V4h-8v2h5l-6.5 7.3-4-4L2 16z',
  model: 'M4 4h7v5H4zm9 0h7v5h-7zM4 15h7v5H4zm9 0h7v5h-7zM11 6.5h2M7.5 9v6M16.5 9v6',
  quality: 'M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5zm-1 14-4-4 1.4-1.4L11 13.2l5.6-5.6L18 9z',
  admin: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-3.3 0-8 1.7-8 5v2h16v-2c0-3.3-4.7-5-8-5z',
  datasets: 'M12 3C7 3 3 4.8 3 7v10c0 2.2 4 4 9 4s9-1.8 9-4V7c0-2.2-4-4-9-4zm0 2c4.1 0 7 1.2 7 2s-2.9 2-7 2-7-1.2-7-2 2.9-2 7-2zM5 9.7C6.7 10.5 9.2 11 12 11s5.3-.5 7-1.3V12c0 .8-2.9 2-7 2s-7-1.2-7-2zm0 5C6.7 15.5 9.2 16 12 16s5.3-.5 7-1.3V17c0 .8-2.9 2-7 2s-7-1.2-7-2z',
  report: 'M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm8 1.5V8h4.5zM8 12h8v1.8H8zm0 3.5h8v1.8H8zM8 8.5h4v1.8H8z',
  about: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2zm0-8h-2V7h2z',
  account: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-3.3 0-8 1.7-8 5v1h16v-1c0-3.3-4.7-5-8-5z',
};
const Icon = ({ name }) => <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d={ICONS[name]} fill="currentColor" /></svg>;

const PAGES = [
  { id: 'dashboard', label: 'Dashboard', title: 'Dashboard', icon: 'dashboard', filters: true },
  { id: 'cube', label: '3D OLAP Cube', title: '3D OLAP Cube', icon: 'cube', filters: true },
  { id: 'model', label: 'Data Model', title: 'Data Model', icon: 'model' },
  { id: 'analytics', label: 'Power BI Analysis', title: 'Power BI Analysis', icon: 'analytics' },
  { id: 'mining', label: 'Data Mining', title: 'Data Mining', icon: 'mining' },
  { id: 'forecast', label: 'Forecasting', title: 'Forecasting', icon: 'forecast' },
  { id: 'reports', label: 'Reports', title: 'Reports', icon: 'report' },
  { id: 'datasets', label: 'Datasets', title: 'Datasets', icon: 'datasets' },
  { id: 'quality', label: 'Data Quality', title: 'Data Quality', icon: 'quality' },
  { id: 'admin', label: 'Administration', title: 'Administration', icon: 'admin', admin: true },
  { id: 'about', label: 'Methodology', title: 'Methodology', icon: 'about', minor: true },
  { id: 'account', label: 'My account', title: 'My account', icon: 'account', minor: true },
];
const pageFromHash = () => { const h = window.location.hash.replace('#', ''); return PAGES.some((p) => p.id === h) ? h : 'dashboard'; };

function Logo() {
  return (
    <svg viewBox="0 0 40 40" width="34" height="34" aria-hidden="true">
      <path d="M20 3 36 11.5v17L20 37 4 28.5v-17z" fill="none" style={{ stroke: 'var(--amber)' }} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M4 11.5 20 20l16-8.5M20 20v17" fill="none" style={{ stroke: 'var(--amber)' }} strokeWidth="2" strokeLinejoin="round" />
      <rect x="22.5" y="22" width="6" height="6" style={{ fill: 'var(--red)' }} />
    </svg>
  );
}

function Workspace() {
  const { user, logout } = useAuth();
  const [page, setPage] = useState(pageFromHash);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState(emptyFilters);
  const [navOpen, setNavOpen] = useState(false);
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'midnight');
  // soft spotlight that follows the pointer over cards (CSS reads --mx / --my)
  const spot = useCallback((e) => {
    const el = e.target.closest?.('.panel, .kpi'); if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', e.clientX - r.left + 'px'); el.style.setProperty('--my', e.clientY - r.top + 'px');
  }, []);
  
  useEffect(() => { const f = () => setPage(pageFromHash()); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  const go = (id) => { window.location.hash = id; setPage(id); setNavOpen(false); window.scrollTo?.(0, 0); };

  const load = useCallback(() => api('/dataset').then((d) => { setCurrency(d.currency); setData(d); }).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const rows = data?.rows ?? [];
  const filtered = useMemo(() => applyGlobal(rows, filters), [rows, filters]);

  const cur = PAGES.find((p) => p.id === page && (!p.admin || user.role === 'admin')) || PAGES[0];
  const nav = PAGES.filter((p) => !p.minor && (!p.admin || user.role === 'admin'));
  const minor = PAGES.filter((p) => p.minor);

  return (
    <div className={'shell' + (navOpen ? ' nav-open' : '')} onPointerMove={spot}>
      <aside className="side" aria-label="Main navigation">
        <div className="side-brand"><Logo /><div><b>SmartDMart</b><span>Retail intelligence</span></div></div>
        <nav>
          {nav.map((p) => <button key={p.id} type="button" className={cur.id === p.id ? 'on' : ''} aria-current={cur.id === p.id ? 'page' : undefined} onClick={() => go(p.id)}><Icon name={p.icon} />{p.label}</button>)}
        </nav>
        <nav className="side-minor">
          {minor.map((p) => <button key={p.id} type="button" className={cur.id === p.id ? 'on' : ''} onClick={() => go(p.id)}><Icon name={p.icon} />{p.label}</button>)}
        </nav>
        <div className="side-user">
          <div className="avatar" aria-hidden="true">{(user.name || user.username)[0].toUpperCase()}</div>
          <div><b>{user.name || user.username}</b><span>{user.role}</span></div>
          <button type="button" className="btn small ghost" onClick={() => logout()}>Sign out</button>
        </div>
      </aside>
      {navOpen && <button type="button" className="scrim" aria-label="Close menu" onClick={() => setNavOpen(false)} />}

      <div className="content">
        <header className="topbar">
          <button type="button" className="menu-btn" aria-label="Open menu" onClick={() => setNavOpen(true)}><svg viewBox="0 0 24 24" width="24" height="24"><path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></button>
          <div className="topbar-title"><h1>{cur.title}</h1>
            {data && <p><span className="status-dot" />{fmtInt(data.report.accepted)} valid orders · {data.report.dateRange?.min} to {data.report.dateRange?.max} · <button type="button" className="linkbtn" onClick={() => go('datasets')} title="Add or switch dataset">{data.name}</button></p>}</div>
          <div className="theme-switch" role="group" aria-label="Theme">
            {Object.entries(THEMES).map(([id, t]) => (
              <button key={id} type="button" aria-pressed={theme === id} aria-label={`${t.label} theme`} title={t.label}
                style={{ background: `linear-gradient(135deg, ${t.swatch[0]} 50%, ${t.swatch[1]} 50%)` }} onClick={() => setTheme(applyTheme(id))} />
            ))}
          </div>
        </header>
        <main>
          {error && <div className="panel"><p className="form-error" role="alert">{error}</p><button type="button" className="btn" onClick={() => { setError(''); load(); }}>Retry</button></div>}
          {!data && !error && <div className="skeleton-page" aria-busy="true" aria-label="Loading data"><div className="sk-row"><i /><i /><i /><i /></div><div className="sk-block" /><div className="sk-row two"><i /><i /></div></div>}
          {data && (
            <div className="page" key={cur.id + theme}>
              {cur.filters && <FilterBar allRows={rows} filters={filters} setFilters={setFilters} shown={filtered.length} total={rows.length} />}
              {cur.id === 'dashboard' && <Dashboard rows={filtered} />}
              {cur.id === 'cube' && <CubeLab rows={filtered} />}
              {cur.id === 'analytics' && <Analytics rows={rows} />}
              {cur.id === 'mining' && <DataMining />}
              {cur.id === 'forecast' && <Forecast rows={rows} />}
              {cur.id === 'model' && <DataModel rows={rows} />}
              {cur.id === 'quality' && <DataQuality report={data.report} rows={rows} sourceName={data.name} onManage={() => go('datasets')} />}
              {cur.id === 'datasets' && <Datasets isAdmin={user.role === 'admin'} onNavigate={go} onChanged={async () => { setFilters(emptyFilters()); await load(); }} />}
              {cur.id === 'admin' && <Admin />}
              {cur.id === 'about' && <Methodology report={data.report} />}
              {cur.id === 'account' && <Account />}
              {cur.id === 'reports' && <Reports rows={rows} datasetName={data.name} quality={data.report} isAdmin={user.role === 'admin'} onLoadData={() => go('datasets')} />}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function Gate() {
  const { user, ready } = useAuth();
  if (!ready) return <div className="boot">Loading…</div>;
  return user ? <Workspace /> : <Login />;
}

export default function App() { return <AuthProvider><Gate /></AuthProvider>; }
