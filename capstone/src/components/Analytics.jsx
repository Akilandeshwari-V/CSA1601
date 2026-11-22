import { useMemo, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Cell, ScatterChart, Scatter, ZAxis, Legend } from 'recharts';
import FilterBar from './FilterBar.jsx';
import { api } from '../api.js';
import { COLORS } from '../theme.js';
import { groupBy, kpis } from '../lib/stats.js';
import { applyGlobal, emptyFilters, distinct } from '../lib/filters.js';
import { DAX, mScript, PBI_RELATIONSHIPS } from '../lib/powerbi.js';
import { fmtMoney, fmtCompactMoney, fmtInt, fmtPct, downloadText } from '../lib/format.js';

const MEASURES = { sales: 'Sales', profit: 'Profit', margin: 'Margin %' };
const fmtM = (m, v) => (m === 'margin' ? fmtPct(v) : fmtMoney(v));
const DIM_OPTIONS = [['category', 'Category'], ['brand', 'Brand'], ['product', 'Product'], ['store', 'Store'], ['city', 'City'], ['payment', 'Payment method'], ['customer', 'Customer type']];

function Matrix({ rows, measure }) {
  const cats = distinct(rows, 'category'), stores = distinct(rows, 'store');
  const cell = (c, s) => { const sub = rows.filter((r) => r.category === c && r.store === s); const sales = sub.reduce((a, r) => a + r.sales, 0), profit = sub.reduce((a, r) => a + r.profit, 0); return measure === 'sales' ? sales : measure === 'profit' ? profit : sales ? profit / sales : 0; };
  const grid = cats.map((c) => stores.map((s) => cell(c, s)));
  const flat = grid.flat(); const max = Math.max(...flat, 1e-9), min = measure === 'margin' ? Math.min(...flat.filter((v) => v > 0), max) : 0;
  const shade = (v) => { const t = max === min ? 0.5 : Math.max(0, (v - min) / (max - min)); return `color-mix(in srgb, var(--brand) ${Math.round((0.1 + t * 0.75) * 100)}%, transparent)`; };
  return (
    <div className="tbl-wrap"><table className="tbl heat">
      <thead><tr><th>Category \ Store</th>{stores.map((s) => <th key={s} className="num">{s.replace('DMart ', '')}</th>)}</tr></thead>
      <tbody>{cats.map((c, i) => <tr key={c}><th>{c}</th>{grid[i].map((v, j) => <td key={j} className="num" style={{ background: shade(v), color: (v - min) / ((max - min) || 1) > 0.6 ? '#fff' : 'inherit' }}>{measure === 'sales' || measure === 'profit' ? fmtCompactMoney(v) : fmtPct(v)}</td>)}</tr>)}</tbody>
    </table></div>
  );
}

function Decomposition({ rows, measure }) {
  const [path, setPath] = useState([{ dim: 'category', sel: null }, { dim: 'store', sel: null }, { dim: 'payment', sel: null }]);
  const cols = [];
  let cur = rows;
  for (let i = 0; i < path.length; i++) {
    const { dim, sel } = path[i];
    const used = path.slice(0, i).map((p) => p.dim);
    const grp = groupBy(cur, (r) => r[dim]).sort((a, b) => b[measure === 'margin' ? 'profit' : measure] - a[measure === 'margin' ? 'profit' : measure]);
    const val = (g) => (measure === 'margin' ? g.margin : g[measure]);
    const max = Math.max(...grp.map(val), 1e-9);
    cols.push(
      <div className="dt-col" key={i}>
        <label className="inline-field">Split by
          <select value={dim} onChange={(e) => setPath((p) => p.map((x, k) => (k === i ? { dim: e.target.value, sel: null } : k > i ? { ...x, sel: null } : x)))}>
            {DIM_OPTIONS.filter(([d]) => d === dim || !used.includes(d)).map(([d, l]) => <option key={d} value={d}>{l}</option>)}</select></label>
        <ul>{grp.map((g) => (
          <li key={g.name}><button type="button" className={sel === g.name ? 'on' : ''} onClick={() => setPath((p) => p.map((x, k) => (k === i ? { ...x, sel: sel === g.name ? null : g.name } : k > i ? { ...x, sel: null } : x)))}>
            <span>{g.name}</span><i style={{ width: Math.max(3, (val(g) / max) * 100) + '%' }} /><b>{fmtM(measure, val(g))}</b></button></li>))}</ul>
      </div>,
    );
    if (!sel) break;
    cur = cur.filter((r) => r[dim] === sel);
  }
  return <div className="dtree">{cols}</div>;
}

function Waterfall({ rows }) {
  const g = groupBy(rows, (r) => r.category).sort((a, b) => b.profit - a.profit);
  let run = 0;
  const data = g.map((c) => { const d = { name: c.name, base: run, value: c.profit }; run += c.profit; return d; });
  data.push({ name: 'Total', base: 0, value: run, total: true });
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={COLORS.grid} vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={60} />
        <YAxis tickFormatter={fmtCompactMoney} width={56} />
        <Tooltip formatter={(v, n) => (n === 'base' ? null : fmtMoney(v))} />
        <Bar dataKey="base" stackId="a" fill="transparent" />
        <Bar dataKey="value" stackId="a" name="Profit">{data.map((d) => <Cell key={d.name} fill={d.total ? COLORS.primaryDark : COLORS.primary} />)}</Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function Influencers({ rows }) {
  const factors = [['Discount given', (r) => (r.discount == null ? null : r.discount + '%')], ['Category', (r) => r.category], ['Store', (r) => r.store], ['Payment method', (r) => r.payment], ['Customer type', (r) => r.customer]];
  const res = factors.map(([name, f]) => {
    const g = groupBy(rows.filter((r) => f(r) != null), f).filter((x) => x.orders >= 10);
    if (g.length < 2) return null;
    const hi = g.reduce((a, b) => (b.margin > a.margin ? b : a)), lo = g.reduce((a, b) => (b.margin < a.margin ? b : a));
    return { name, spread: hi.margin - lo.margin, hi, lo };
  }).filter(Boolean).sort((a, b) => b.spread - a.spread);
  const top = res[0]?.spread || 1;
  return (
    <div>
      {res.map((r) => (
        <div className="infl" key={r.name}>
          <div className="infl-head"><b>{r.name}</b><span>{(r.spread * 100).toFixed(1)} pt spread</span></div>
          <div className="bar-row"><div><i style={{ width: Math.max(2, (r.spread / top) * 100) + '%' }} /></div></div>
          <small>{r.hi.name} {fmtPct(r.hi.margin)} · {r.lo.name} {fmtPct(r.lo.margin)}</small>
        </div>))}
    </div>
  );
}

function Copy({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  return <button type="button" className="btn small" onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }); }}>{done ? 'Copied ✓' : label}</button>;
}

function PowerBiPanel() {
  const [key, setKey] = useState('');
  const [err, setErr] = useState('');
  const base = window.location.origin;
  const m = mScript(base, key || undefined);
  const gen = async () => { setErr(''); try { setKey((await api('/auth/api-key', { method: 'POST' })).key); } catch (e) { setErr(e.message); } };
  return (
    <div className="panel pbi">
      <h3>Open this analysis in Power BI Desktop</h3>
      <ol className="pbi-steps">
        <li><b>Generate an export key.</b> It is valid for 30 days and works only for CSV downloads (not for browsing the site).
          <div className="btn-row"><button type="button" className="btn small primary-inline" onClick={gen}>Generate export key</button>{key && <Copy text={key} label="Copy key" />}</div>
          {err && <p className="form-error">{err}</p>}{key && <textarea readOnly rows={2} value={key} className="mono" onFocus={(e) => e.target.select()} />}</li>
        <li><b>Load the six tables</b> with the Power Query script below (Get data → Blank query → Advanced editor). Server address used: <code>{base}</code>. {base.includes('localhost') && 'Power BI Desktop must run on the same computer as the server for “localhost” to work; after you deploy, the public address is used automatically.'}
          <div className="btn-row"><Copy text={m} label="Copy M script" /><button type="button" className="btn small" onClick={() => downloadText('SmartDMart.pq', m, 'text/plain;charset=utf-8')}>Download .pq</button></div>
          <pre className="code">{m}</pre></li>
        <li><b>Create the relationships</b> in Model view (all one-to-many, single direction):
          <ul>{PBI_RELATIONSHIPS.map((r) => <li key={r}><code>{r}</code></li>)}</ul>
          Mark <code>DIM_DATE[Order_Date]</code> as the date table.</li>
        <li><b>Add the DAX measures.</b>
          <div className="btn-row"><Copy text={DAX} label="Copy DAX" /><button type="button" className="btn small" onClick={() => downloadText('SmartDMart_measures.dax', DAX, 'text/plain;charset=utf-8')}>Download .dax</button></div>
          <pre className="code">{DAX}</pre></li>
        <li><b>Build the visuals</b> shown above: cards (Total Sales, Total Profit, Total Quantity), matrix (Category × Store), decomposition tree, waterfall (Profit by Category), scatter (Sales vs Profit Margin by Product), line (Running Sales by Order_Date), and the Key influencers visual with “Profit Margin %” as the target.</li>
      </ol>
    </div>
  );
}

export default function Analytics({ rows: allRows }) {
  const [filters, setFilters] = useState(emptyFilters);
  const [measure, setMeasure] = useState('sales');
  const rows = useMemo(() => applyGlobal(allRows, filters), [allRows, filters]);
  const k = useMemo(() => kpis(rows), [rows]);
  const daily = useMemo(() => {
    const m = new Map(); rows.forEach((r) => m.set(r.date, (m.get(r.date) || 0) + r.sales));
    let run = 0; return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, daily: v, cumulative: (run += v) }));
  }, [rows]);
  const products = useMemo(() => groupBy(rows, (r) => r.product).map((p) => ({ ...p, category: rows.find((r) => r.product === p.name).category })), [rows]);
  const cats = useMemo(() => distinct(allRows, 'category'), [allRows]);

  return (
    <section className="analytics" aria-label="Power BI style analysis">
      <FilterBar allRows={allRows} filters={filters} setFilters={setFilters} shown={rows.length} total={allRows.length} />
      {!rows.length ? <div className="panel empty">No orders match the slicers.</div> : (
        <>
          <div className="kpis">
            <div className="kpi main"><span>Total Sales</span><b>{fmtMoney(k.sales)}</b></div>
            <div className="kpi"><span>Total Profit</span><b>{fmtMoney(k.profit)}</b></div>
            <div className="kpi"><span>Total Quantity</span><b>{fmtInt(k.qty)}</b></div>
            <div className="kpi"><span>Profit margin</span><b>{fmtPct(k.margin)}</b></div>
            <div className="kpi"><span>Average order value</span><b>{fmtMoney(k.aov)}</b></div>
          </div>
          <div className="panel-head"><h3>Interactive analysis</h3>
            <div className="seg" role="group" aria-label="Measure">{Object.entries(MEASURES).map(([id, l]) => <button key={id} type="button" className={measure === id ? 'on' : ''} aria-pressed={measure === id} onClick={() => setMeasure(id)}>{l}</button>)}</div></div>
          <div className="grid-2">
            <div className="panel span-2"><h3>Decomposition tree</h3><Decomposition rows={rows} measure={measure} /></div>
            <div className="panel span-2"><h3>Matrix: category × store <small>{MEASURES[measure]}, darker = higher</small></h3><Matrix rows={rows} measure={measure} /></div>
            <figure className="panel chart"><figcaption><h3>Profit contribution by category</h3></figcaption><Waterfall rows={rows} /></figure>
            <figure className="panel chart"><figcaption><h3>Products: sales vs margin</h3></figcaption>
              <ResponsiveContainer width="100%" height={280}>
                <ScatterChart margin={{ top: 8, right: 14, left: 0, bottom: 4 }}>
                  <CartesianGrid stroke={COLORS.grid} />
                  <XAxis type="number" dataKey="sales" name="Sales" tickFormatter={fmtCompactMoney} /><YAxis type="number" dataKey="margin" name="Margin" tickFormatter={(v) => (v * 100).toFixed(0) + '%'} width={44} domain={['auto', 'auto']} />
                  <ZAxis type="number" dataKey="qty" range={[50, 400]} name="Quantity" />
                  <Tooltip content={({ payload }) => payload?.length ? (<div className="tip-lite"><b>{payload[0].payload.name}</b><br />{payload[0].payload.category}<br />Sales {fmtMoney(payload[0].payload.sales)}<br />Margin {fmtPct(payload[0].payload.margin)}<br />Qty {fmtInt(payload[0].payload.qty)}</div>) : null} />
                  {cats.map((c, i) => <Scatter key={c} name={c} data={products.filter((p) => p.category === c)} fill={COLORS.series[i % COLORS.series.length]} fillOpacity={0.8} />)}
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </ScatterChart>
              </ResponsiveContainer></figure>
            <figure className="panel chart span-2"><figcaption><h3>Cumulative sales</h3></figcaption>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={daily} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={COLORS.grid} vertical={false} /><XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={50} /><YAxis tickFormatter={fmtCompactMoney} width={58} />
                  <Tooltip formatter={(v) => fmtMoney(v)} /><Line dataKey="cumulative" name="Cumulative sales" stroke={COLORS.primary} strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer></figure>
            <div className="panel span-2"><h3>Key influencers on profit margin</h3><Influencers rows={rows} /></div>
          </div>
        </>
      )}
      <PowerBiPanel />
    </section>
  );
}
