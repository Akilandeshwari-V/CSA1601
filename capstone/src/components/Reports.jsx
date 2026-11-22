import { useMemo, useState } from 'react';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { COLORS } from '../theme.js';
import { downloadWithAuth } from '../api.js';
import { buildReport, reportCSV, reportFileName, SCOPES } from '../lib/report.js';
import { downloadText, fmtMoney, fmtCompactMoney, fmtInt, fmtPct } from '../lib/format.js';
import CountUp from './CountUp.jsx';

const Delta = ({ v, pts }) => {
  if (v == null && pts == null) return null;
  const val = pts != null ? pts : v;
  const up = val >= 0;
  return <span className={'delta ' + (up ? 'up' : 'down')}>{up ? '▲' : '▼'} {Math.abs(val * 100).toFixed(1)}{pts != null ? ' pts' : '%'}</span>;
};

function ShareTable({ title, list, nameLabel }) {
  if (!list.length) return null;
  const max = Math.max(...list.map((e) => e.sales), 1);
  return (
    <div className="panel rpt-block">
      <h3>{title}</h3>
      <div className="tbl-wrap">
        <table className="tbl compact">
          <thead><tr><th>{nameLabel}</th><th style={{ width: '32%' }}>Share of sales</th><th className="num">Sales</th><th className="num">Profit</th><th className="num">Margin</th></tr></thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.name}>
                <td>{e.name}</td>
                <td><div className="rbar" title={fmtPct(e.share, 1)}><i style={{ width: Math.max(2, (e.sales / max) * 100) + '%' }} /><em>{fmtPct(e.share, 0)}</em></div></td>
                <td className="num">{fmtMoney(e.sales)}</td>
                <td className={'num ' + (e.profit < 0 ? 'neg' : '')}>{fmtMoney(e.profit)}</td>
                <td className={'num ' + (e.margin < 0 ? 'neg' : '')}>{fmtPct(e.margin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProductTable({ title, list, note }) {
  if (!list.length) return null;
  return (
    <div className="panel rpt-block">
      <h3>{title} {note && <small>{note}</small>}</h3>
      <div className="tbl-wrap">
        <table className="tbl compact">
          <thead><tr><th>Product</th><th className="num">Units</th><th className="num">Sales</th><th className="num">Profit</th><th className="num">Margin</th></tr></thead>
          <tbody>{list.map((e) => <tr key={e.name}><td>{e.name}</td><td className="num">{fmtInt(e.qty)}</td><td className="num">{fmtMoney(e.sales)}</td><td className={'num ' + (e.profit < 0 ? 'neg' : 'pos')}><b>{fmtMoney(e.profit)}</b></td><td className="num">{fmtPct(e.margin)}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

export default function Reports({ rows, datasetName, quality, onLoadData, isAdmin }) {
  const [scope, setScope] = useState('latest');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState(null);

  const report = useMemo(() => buildReport(rows, { scope, from: from || undefined, to: to || undefined }, { name: datasetName, quality }), [rows, scope, from, to, datasetName, quality]);
  const r = report, k = r.kpis, d = r.deltas;
  const say = (kind, text) => { setToast({ kind, text, id: Date.now() }); setTimeout(() => setToast((t) => (t && Date.now() - t.id >= 3800 ? null : t)), 4000); };

  const query = () => `scope=${scope}${scope === 'custom' && from ? `&from=${from}` : ''}${scope === 'custom' && to ? `&to=${to}` : ''}`;
  const pdf = async () => {
    setBusy('pdf');
    try { await downloadWithAuth(`/export/report.pdf?${query()}`, reportFileName(r, 'pdf')); say('ok', 'PDF report downloaded.'); }
    catch (e) { say('err', e.message); } finally { setBusy(''); }
  };
  const csv = () => { downloadText(reportFileName(r, 'csv'), reportCSV(r)); say('ok', 'CSV report downloaded.'); };

  return (
    <section className="reports" aria-label="Reports">
      <div className="panel rpt-controls noprint">
        <div className="panel-head"><h3>Build a report</h3><span className="muted">{fmtInt(rows.length)} orders</span></div>
        <div className="seg scopes" role="group" aria-label="Report period">
          {SCOPES.map((s) => <button key={s.id} type="button" className={scope === s.id ? 'on' : ''} onClick={() => setScope(s.id)} title={s.hint}>{s.label}</button>)}
        </div>
        {scope === 'custom' && (
          <div className="map-opts">
            <label className="field">From<input type="date" value={from} min={r.period.dataMin} max={r.period.dataMax} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="field">To<input type="date" value={to} min={r.period.dataMin} max={r.period.dataMax} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
        )}
        <div className="btn-row">
          <button type="button" className="btn primary-solid" onClick={pdf} disabled={!!busy || r.empty}>{busy === 'pdf' ? <><span className="spin" /> Building PDF…</> : 'Download PDF'}</button>
          <button type="button" className="btn" onClick={csv} disabled={r.empty}>Download CSV</button>
          <button type="button" className="btn" onClick={() => window.print()} disabled={r.empty}>Print</button>
          {isAdmin && <button type="button" className="btn ghost" onClick={onLoadData}>Load new data</button>}
        </div>
      </div>

      <article className="rpt-sheet" aria-label="Report preview">
        <header className="rpt-cover">
          <div><span className="rpt-brand">SmartDMart · Retail intelligence</span><h2>{r.title}</h2><p>{r.period.label}{r.period.days > 1 ? ` · ${r.period.days} days` : ''}</p></div>
          <div className="rpt-meta"><span>Dataset: {r.dataset.name}</span><span>Generated {r.generatedAt.slice(0, 16).replace('T', ' ')} UTC</span></div>
        </header>

        {r.empty ? (
          <div className="panel empty">No orders fall inside this period. Pick another range{isAdmin ? ' or load a newer sales file' : ''}.</div>
        ) : (
          <>
            <div className="kpis rpt-kpis">
              <div className="kpi main"><span>Total sales</span><b><CountUp value={k.sales} format={fmtMoney} /></b><small>{fmtInt(k.orders)} order lines {d && <Delta v={d.sales} />}</small></div>
              <div className="kpi"><span>Total profit</span><b><CountUp value={k.profit} format={fmtMoney} /></b><small>{fmtPct(k.margin)} margin {d && <Delta pts={d.marginPts} />}</small></div>
              <div className="kpi"><span>Units sold</span><b><CountUp value={k.qty} format={fmtInt} /></b><small>{d && d.qty != null ? <Delta v={d.qty} /> : 'units'}</small></div>
              <div className="kpi"><span>Avg order value</span><b><CountUp value={k.aov} format={fmtMoney} /></b><small>{d && d.aov != null ? <Delta v={d.aov} /> : 'per order line'}</small></div>
            </div>

            <div className="panel rpt-block">
              <h3>Key findings</h3>
              <ul className="findings">{r.insights.map((t, i) => <li key={t} style={{ '--i': i }}>{t}</li>)}</ul>
            </div>

            <div className="panel rpt-block">
              <h3>{r.trend.grain === 'day' ? 'Daily' : 'Monthly'} sales and profit</h3>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={r.trend.points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={COLORS.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} minTickGap={14} />
                  <YAxis tickFormatter={fmtCompactMoney} tick={{ fontSize: 12 }} width={60} />
                  <Tooltip formatter={(v, n) => [fmtMoney(v), n]} />
                  <Legend verticalAlign="top" height={28} />
                  <Bar dataKey="sales" name="Sales" fill={COLORS.primary} radius={[3, 3, 0, 0]} animationDuration={700} />
                  <Line dataKey="profit" name="Profit" stroke={COLORS.amber} strokeWidth={3} dot={r.trend.points.length < 40 ? { r: 3 } : false} animationDuration={900} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="rpt-two">
              <ShareTable title="Sales by category" list={r.categories} nameLabel="Category" />
              <ShareTable title="Sales by store / location" list={r.stores} nameLabel="Store" />
            </div>
            {r.cities.length > 1 && <ShareTable title="Sales by city" list={r.cities} nameLabel="City" />}
            <div className="rpt-two">
              <ProductTable title="Top 5 products by profit" list={r.topProducts} />
              <ProductTable title="Products sold at a loss" list={r.bottomProducts} note={`${r.lossMakers.count} in total`} />
            </div>
            <div className="rpt-two">
              <ShareTable title="Payment methods" list={r.payments} nameLabel="Method" />
              <ShareTable title="Customer types" list={r.customers} nameLabel="Type" />
            </div>
          </>
        )}
      </article>
      {toast && <div className={'toast ' + toast.kind} role="status" key={toast.id}>{toast.kind === 'ok' ? '✓ ' : '! '}{toast.text}</div>}
    </section>
  );
}
