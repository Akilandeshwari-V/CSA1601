import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { cleanDataset } from '../lib/pipeline.js';
import { FIELDS, inspectCSV, mappingProblems } from '../lib/mapping.js';
import { CURRENCIES, fmtInt } from '../lib/format.js';

const guessCurrency = (records, mapping) => {
  const col = mapping.sales || mapping.price;
  if (!col) return null;
  const sample = records.slice(0, 200).map((r) => String(r[col] ?? '')).join(' ');
  if (/\$/.test(sample)) return 'USD';
  if (/€/.test(sample)) return 'EUR';
  if (/£/.test(sample)) return 'GBP';
  if (/₹|rs\.?\s?\d/i.test(sample)) return 'INR';
  return null;
};

function Library({ isAdmin, onChanged }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api('/datasets').then((r) => setList(r.datasets)).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const act = async (fn) => { setBusy(true); setError(''); try { await fn(); await load(); await onChanged(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const activate = (d) => act(() => (d.bundled ? api('/dataset/reset', { method: 'POST' }) : api(`/datasets/${d.id}/activate`, { method: 'POST' })));
  const remove = (d) => { if (window.confirm(`Delete “${d.name}”? This cannot be undone.`)) act(() => api(`/datasets/${d.id}`, { method: 'DELETE' })); };

  return (
    <div className="panel">
      <div className="panel-head"><h3>Dataset library <small>{list ? `${list.length} available` : ''}</small></h3></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {!list ? <p className="op-note">Loading…</p> : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Dataset</th><th className="num">Valid rows</th><th className="num">Rejected</th><th>Currency</th><th>Added by</th><th>Added</th><th>Status</th>{isAdmin && <th />}</tr></thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id ?? 'bundled'}>
                  <td><b>{d.name}</b></td>
                  <td className="num">{fmtInt(d.rows_accepted)}</td>
                  <td className="num">{fmtInt(d.rows_rejected)}</td>
                  <td>{CURRENCIES[d.currency]?.symbol ?? '—'} {d.currency}</td>
                  <td>{d.uploaded_by || '—'}</td>
                  <td>{d.at ? d.at.slice(0, 16) : '—'}</td>
                  <td>{d.active ? <span className="tag ok-tag">Active</span> : <span className="tag">Stored</span>}</td>
                  {isAdmin && (
                    <td className="row-actions">
                      {!d.active && <button type="button" className="btn small" disabled={busy} onClick={() => activate(d)}>Analyse this</button>}
                      {!d.bundled && <button type="button" className="btn small ghost" disabled={busy} onClick={() => remove(d)}>Delete</button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Wizard({ onDone, onNavigate }) {
  const input = useRef(null);
  const [file, setFile] = useState(null); // { name, text }
  const [mapping, setMapping] = useState({});
  const [currency, setCurrency] = useState('INR');
  const [currencyNote, setCurrencyNote] = useState('');
  const [dateOrder, setDateOrder] = useState('auto');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const parsed = useMemo(() => (file ? inspectCSV(file.text) : null), [file]);

  const load = (name, text, forceCurrency) => {
    setError(''); setResult(null);
    const p = inspectCSV(text);
    if (!p.header.length) { setError('That file looks empty or is not a CSV.'); return; }
    setFile({ name, text }); setMapping(p.mapping); setDateOrder('auto');
    const g = guessCurrency(p.records, p.mapping);
    setCurrency(forceCurrency || g || 'INR');
    setCurrencyNote(forceCurrency ? '' : g ? `Detected ${g} from the values.` : 'No currency symbol found in the file. Please confirm.');
  };
  const onFile = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader(); r.onload = () => load(f.name, String(r.result)); r.readAsText(f); e.target.value = '';
  };
  const trySample = async () => {
    try { const res = await fetch('/sample/US_Retail_Sample.csv'); if (!res.ok) throw new Error(); load('US_Retail_Sample.csv', await res.text(), 'USD'); }
    catch { setError('Could not load the sample file from the server.'); }
  };

  const problems = useMemo(() => mappingProblems(mapping), [mapping]);
  const dry = useMemo(() => {
    if (!file || problems.length) return null;
    try { return { ok: cleanDataset(file.text, { mapping, dateOrder, currency }) }; } catch (e) { return { error: e.message }; }
  }, [file, mapping, dateOrder, currency, problems]);

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const r = await api('/dataset', { method: 'POST', body: { name: file.name, csv: file.text, mapping, dateOrder, currency } });
      setResult(r); setFile(null); await onDone();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const setCol = (id, v) => setMapping((m) => ({ ...m, [id]: v || null }));
  const dryRep = dry?.ok?.report;

  return (
    <div className="panel">
      <div className="panel-head"><h3>Add a retail dataset</h3></div>
      <div className="btn-row">
        <input ref={input} type="file" accept=".csv,text/csv" onChange={onFile} hidden />
        <button type="button" className="btn primary-solid" onClick={() => input.current?.click()}>Choose CSV file</button>
        <button type="button" className="btn" onClick={trySample}>Try the sample US retail dataset</button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {result && (
        <div className="ok-msg" role="status">
          Loaded. {fmtInt(result.accepted)} valid rows, {fmtInt(result.rejected)} rejected. All pages now show this dataset.
          <div className="btn-row">
            <button type="button" className="btn primary-solid" onClick={() => onNavigate('reports')}>Build the report (PDF / CSV)</button>
            <button type="button" className="btn" onClick={() => onNavigate('dashboard')}>Open the dashboard</button>
          </div>
        </div>
      )}

      {file && parsed && (
        <>
          <h4 className="wiz-h">1. Match columns <small>{file.name} · {fmtInt(parsed.records.length)} rows · {parsed.header.length} columns</small></h4>
          <div className="map-grid">
            {FIELDS.map((f) => (
              <label key={f.id} title={f.hint} className={'map-row' + (mapping[f.id] ? ' set' : '')}>
                <span className="map-label">{f.label}{f.need === true && <i title="Required"> *</i>}</span>
                <select value={mapping[f.id] || ''} onChange={(e) => setCol(f.id, e.target.value)}>
                  <option value="">— none —</option>
                  {parsed.header.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="map-opts">
            <label className="field">Currency
              <select value={currency} onChange={(e) => { setCurrency(e.target.value); setCurrencyNote(''); }}>
                {Object.entries(CURRENCIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              {currencyNote && <small>{currencyNote}</small>}
            </label>
            <label className="field">Date format (for 03/04/2025)
              <select value={dateOrder} onChange={(e) => setDateOrder(e.target.value)}>
                <option value="auto">Detect automatically</option>
                <option value="dmy">Day / Month / Year</option>
                <option value="mdy">Month / Day / Year</option>
              </select>
            </label>
          </div>

          <h4 className="wiz-h">2. Preview</h4>
          {problems.length > 0 && <ul className="problems" role="alert">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          {dry?.error && <p className="form-error" role="alert">{dry.error}</p>}
          {dryRep && (
            <>
              <div className="kpis four">
                <div className="kpi"><span>Rows read</span><b>{fmtInt(dryRep.totalRead)}</b></div>
                <div className="kpi main"><span>Will be analysed</span><b>{fmtInt(dryRep.accepted)}</b></div>
                <div className="kpi"><span>Repaired</span><b>{fmtInt(dryRep.repairedRows)}</b></div>
                <div className="kpi warn"><span>Rejected</span><b>{fmtInt(dryRep.rejected)}</b></div>
              </div>
              {dryRep.notes.length > 0 && (
                <div className="notes"><b>Interpretation</b><ul>{dryRep.notes.map((n) => <li key={n}>{n}</li>)}</ul></div>
              )}
              {dry.ok.rows.length === 0 && <p className="form-error" role="alert">No row passed validation. Most often the date column or date format is wrong.</p>}
              {dry.ok.rows.length > 0 && (
                <div className="tbl-wrap">
                  <table className="tbl compact">
                    <thead><tr><th>Date</th><th>Store</th><th>City</th><th>Product</th><th>Category</th><th className="num">Qty</th><th className="num">Sales</th><th className="num">Profit</th></tr></thead>
                    <tbody>{dry.ok.rows.slice(0, 5).map((r) => <tr key={r.id}><td>{r.date}</td><td>{r.store}</td><td>{r.city}</td><td>{r.product}</td><td>{r.category}</td><td className="num">{r.qty}</td><td className="num">{r.sales.toFixed(2)}</td><td className="num">{r.profit.toFixed(2)}</td></tr>)}</tbody>
                  </table>
                </div>
              )}
            </>
          )}
          <div className="btn-row">
            <button type="button" className="btn primary-solid" disabled={busy || !dry?.ok?.rows.length} onClick={submit}>{busy ? 'Loading…' : 'Analyse this dataset'}</button>
            <button type="button" className="btn ghost" onClick={() => { setFile(null); setResult(null); }}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

export default function Datasets({ isAdmin, onChanged, onNavigate }) {
  const [tick, setTick] = useState(0);
  const changed = async () => { await onChanged(); setTick((t) => t + 1); };
  return (
    <section className="datasets" aria-label="Datasets">
      <Library key={tick} isAdmin={isAdmin} onChanged={onChanged} />
      {isAdmin ? <div style={{ marginTop: 16 }}><Wizard onDone={changed} onNavigate={onNavigate} /></div> : <div className="panel" style={{ marginTop: 16 }}><p className="op-note">Only administrators can add or switch datasets.</p></div>}
    </section>
  );
}
