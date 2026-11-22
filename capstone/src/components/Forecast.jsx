import { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { api } from '../api.js';
import { COLORS } from '../theme.js';
import { fmtMoney, fmtCompactMoney, fmtPct, downloadText, toCSV } from '../lib/format.js';
import { distinct } from '../lib/filters.js';

export default function Forecast({ rows, preload = null }) {
  const [horizon, setHorizon] = useState(6);
  const [category, setCategory] = useState('');
  const [store, setStore] = useState('');
  const [modelId, setModelId] = useState('best');
  const [growth, setGrowth] = useState(0);
  const [data, setData] = useState(preload);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const cats = useMemo(() => distinct(rows, 'category'), [rows]);
  const stores = useMemo(() => distinct(rows, 'store'), [rows]);

  useEffect(() => {
    if (preload && horizon === 6 && !category && !store) return undefined;
    let live = true;
    setLoading(true); setError('');
    const q = new URLSearchParams({ horizon, ...(category && { category }), ...(store && { store }) });
    api('/forecast?' + q).then((d) => live && setData(d)).catch((e) => live && setError(e.message)).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [horizon, category, store, rows]);

  const o = data?.overall;
  const model = o?.ok ? o.models.find((m) => m.id === (modelId === 'best' ? o.best : modelId)) : null;
  const factor = 1 + growth / 100;
  const chart = useMemo(() => {
    if (!model) return [];
    const hist = o.series.map((s, i) => ({ label: s.label, actual: s.sales, fitted: model.fitted[i] }));
    const last = hist[hist.length - 1];
    const fc = model.forecast.map((f) => ({ label: f.label, forecast: f.value * factor, band: [f.low * factor, f.high * factor] }));
    return [...hist.slice(0, -1), { ...last, forecast: last.actual }, ...fc];
  }, [model, o, factor]);

  const total = model ? model.forecast.reduce((a, f) => a + f.value * factor, 0) : 0;
  const lastN = o?.ok ? o.series.slice(-horizon).reduce((a, s) => a + s.sales, 0) : 0;
  const change = lastN ? total / lastN - 1 : 0;
  const best = o?.ok ? o.models.find((m) => m.id === o.best) : null;

  const exportCsv = () => model && downloadText('smartdmart_forecast.csv', toCSV(['Month', 'Forecast', 'Low_95', 'High_95', 'Model'], model.forecast.map((f) => ({ Month: f.label, Forecast: (f.value * factor).toFixed(2), Low_95: (f.low * factor).toFixed(2), High_95: (f.high * factor).toFixed(2), Model: model.name }))));

  return (
    <section className="forecast" aria-label="Sales forecast">
      <div className="panel controls-row">
        <label className="field">Forecast horizon
          <select value={horizon} onChange={(e) => setHorizon(+e.target.value)}>{[3, 6, 9, 12].map((h) => <option key={h} value={h}>{h} months</option>)}</select></label>
        <label className="field">Category
          <select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{cats.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="field">Store
          <select value={store} onChange={(e) => setStore(e.target.value)}><option value="">All stores</option>{stores.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="field">Model
          <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
            <option value="best">Best on back-test{best ? ` (${best.name})` : ''}</option>
            {o?.ok && o.models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <label className="field">What-if growth: <b>{growth > 0 ? '+' : ''}{growth}%</b>
          <input type="range" min="-30" max="30" step="1" value={growth} onChange={(e) => setGrowth(+e.target.value)} /></label>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {loading && !data && <div className="panel empty">Calculating forecast on the server…</div>}
      {o && !o.ok && <div className="panel empty">{o.reason} Choose a wider selection (for example “All stores”).</div>}

      {model && (
        <>
          <div className="kpis">
            <div className="kpi main"><span>Forecast sales, next {horizon} months</span><b>{fmtMoney(total)}</b><small>{model.name}</small></div>
            <div className="kpi"><span>Versus the last {horizon} months</span><b className={change >= 0 ? 'up' : 'down'}>{change >= 0 ? '▲' : '▼'} {fmtPct(Math.abs(change))}</b><small>{fmtMoney(lastN)} actual</small></div>
            <div className="kpi"><span>Back-test error (MAPE)</span><b>{fmtPct(model.mape)}</b><small>last {o.holdout} months</small></div>
            <div className="kpi"><span>Monthly range (95%)</span><b>{fmtCompactMoney(model.forecast[0].low * factor)} – {fmtCompactMoney(model.forecast[0].high * factor)}</b><small>next month</small></div>
          </div>

          <figure className="panel chart">
            <figcaption><h3>Monthly sales: history and forecast</h3></figcaption>
            <ResponsiveContainer width="100%" height={340}>
              <ComposedChart data={chart} margin={{ top: 8, right: 14, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={COLORS.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-35} textAnchor="end" height={54} />
                <YAxis tickFormatter={fmtCompactMoney} width={58} domain={[0, 'auto']} />
                <Tooltip formatter={(v) => (Array.isArray(v) ? `${fmtMoney(v[0])} to ${fmtMoney(v[1])}` : fmtMoney(v))} />
                <Legend verticalAlign="top" height={28} />
                <Area dataKey="band" name="95% interval" stroke="none" fill={COLORS.amber} fillOpacity={0.28} />
                <Line dataKey="actual" name="Actual" stroke={COLORS.primary} strokeWidth={3} dot={{ r: 3 }} />
                <Line dataKey="fitted" name="Model fit" stroke={COLORS.muted} strokeDasharray="5 4" dot={false} />
                <Line dataKey="forecast" name="Forecast" stroke={COLORS.red} strokeWidth={3} strokeDasharray="2 4" dot={{ r: 4 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </figure>

          <div className={'panel note-card ' + (o.note.startsWith('No model') ? 'warn' : '')}>
            <h3>How reliable is this forecast?</h3>
          </div>

          <div className="grid-2">
            <div className="panel">
              <h3>Model comparison <small>back-tested on the last {o.holdout} months</small></h3>
              <div className="tbl-wrap"><table className="tbl compact">
                <thead><tr><th>Model</th><th className="num">MAE</th><th className="num">MAPE</th><th className="num">RMSE</th><th /></tr></thead>
                <tbody>{[...o.models].sort((a, b) => a.mape - b.mape).map((m) => (
                  <tr key={m.id} className={m.id === o.best ? 'sel' : ''}><td>{m.name}{Object.keys(m.params).length ? <small className="muted"> {Object.entries(m.params).map(([k, v]) => `${k}=${v}`).join(', ')}</small> : null}</td>
                    <td className="num">{fmtMoney(m.mae)}</td><td className="num">{fmtPct(m.mape)}</td><td className="num">{fmtMoney(m.rmse)}</td><td>{m.id === o.best ? <span className="tag repaired">best</span> : ''}</td></tr>))}</tbody>
              </table></div>
            </div>
            <div className="panel">
              <h3>Forecast table</h3>
              <table className="tbl compact"><thead><tr><th>Month</th><th className="num">Forecast</th><th className="num">95% range</th></tr></thead>
                <tbody>{model.forecast.map((f) => <tr key={f.label}><td>{f.label}</td><td className="num">{fmtMoney(f.value * factor)}</td><td className="num">{fmtMoney(f.low * factor)} – {fmtMoney(f.high * factor)}</td></tr>)}</tbody></table>
              <div className="btn-row"><button type="button" className="btn small" onClick={exportCsv}>Export forecast (CSV)</button></div>
            </div>
          </div>
        </>
      )}

      {data && (
        <div className="panel">
          <h3>Category outlook</h3>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Category</th><th className="num">Last 3 months</th><th className="num">Next 3 months</th><th className="num">Change</th><th>Model</th><th className="num">Back-test MAPE</th></tr></thead>
            <tbody>{data.categories.map((c) => c.ok ? (
              <tr key={c.category}><td>{c.category}</td><td className="num">{fmtMoney(c.last3)}</td><td className="num">{fmtMoney(c.next3)}</td>
                <td className={'num ' + (c.change >= 0 ? 'up' : 'down')}>{c.change >= 0 ? '▲' : '▼'} {fmtPct(Math.abs(c.change))}</td><td>{c.model}</td><td className="num">{fmtPct(c.mape)}</td></tr>
            ) : <tr key={c.category}><td>{c.category}</td><td colSpan={5} className="muted">Not enough months of data</td></tr>)}</tbody>
          </table></div>
        </div>
      )}
    </section>
  );
}
