import { useEffect, useMemo, useState } from 'react';
import CubeScene, { RAMP_CSS } from './CubeScene.jsx';
import { AXIS_COLORS } from '../theme.js';
import {
  DIMS, DIM_ORDER, aggregate, initialState, rollUp, drillDown, canRollUp, canDrillDown, setLevel, slice, dice, clearFilter,
  swapAxes, rotateAxes, setAxisDim, listMembers, toSQL, describeAxes, SEP,
} from '../lib/olap.js';
import { MEASURES, fmtMeasure, fmtMoney, fmtInt, fmtPct, downloadText, toCSV } from '../lib/format.js';

const OPS = [
  { id: 'rollup', label: 'Roll-up', hint: 'Summarise to a higher level of the hierarchy' },
  { id: 'drilldown', label: 'Drill-down', hint: 'Break down into more detail' },
  { id: 'slice', label: 'Slice', hint: 'Fix one dimension to one value' },
  { id: 'dice', label: 'Dice', hint: 'Keep several values on several dimensions' },
  { id: 'pivot', label: 'Pivot', hint: 'Change which dimensions form the axes' },
];

const summary = (a) => `${a.cells.length} non-empty cells (grid ${a.grid.join(' × ')}) · Sales ${fmtMoney(a.totals.sales)} · Profit ${fmtMoney(a.totals.profit)} · Qty ${fmtInt(a.totals.qty)}`;

export default function CubeLab({ rows }) {
  const [state, setState] = useState(initialState);
  const [measure, setMeasure] = useState('sales');
  const [op, setOp] = useState('rollup');
  const [opDim, setOpDim] = useState('time');
  const [sliceDim, setSliceDim] = useState('location');
  const [sliceKey, setSliceKey] = useState('');
  const [diceSel, setDiceSel] = useState({});
  const [log, setLog] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [hover, setHover] = useState(null);
  const [autoRotate, setAutoRotate] = useState(false);
  const [resetToken, setResetToken] = useState(0);
  const [showAll, setShowAll] = useState(false);

  const result = useMemo(() => aggregate(rows, state), [rows, state]);
  useEffect(() => setSelectedId(null), [rows]);

  const effOpDim = state.axes.includes(opDim) ? opDim : state.axes[0];
  const sliceMembers = useMemo(() => listMembers(rows, sliceDim, state.levels[sliceDim]), [rows, sliceDim, state.levels]);
  const sliceValue = sliceMembers.some((m) => m.key === sliceKey) ? sliceKey : sliceMembers[0]?.key ?? '';

  const commit = (next, title, detail) => {
    const after = aggregate(rows, next);
    setLog((l) => [{ id: Date.now() + Math.random(), title, detail, before: summary(result), after: summary(after) }, ...l].slice(0, 12));
    setState(next);
    setSelectedId(null);
    setShowAll(false);
  };
  const lvlName = (dim, l) => DIMS[dim].levels[l].name;

  const doRoll = () => {
    const next = rollUp(state, effOpDim);
    if (next) commit(next, `Roll-up on ${DIMS[effOpDim].name}`, `${lvlName(effOpDim, state.levels[effOpDim])} → ${lvlName(effOpDim, next.levels[effOpDim])}. Totals are preserved; detail is summarised.`);
  };
  const doDrill = () => {
    const next = drillDown(state, effOpDim);
    if (next) commit(next, `Drill-down on ${DIMS[effOpDim].name}`, `${lvlName(effOpDim, state.levels[effOpDim])} → ${lvlName(effOpDim, next.levels[effOpDim])}. Totals are preserved; more detail is shown.`);
  };
  const jump = (dim, level) => {
    if (level === state.levels[dim]) return;
    commit(setLevel(state, dim, level), `${level < state.levels[dim] ? 'Roll-up' : 'Drill-down'} on ${DIMS[dim].name}`, `${lvlName(dim, state.levels[dim])} → ${lvlName(dim, level)}.`);
  };
  const doSlice = () => {
    if (!sliceValue && sliceValue !== '') return;
    const m = sliceMembers.find((x) => x.key === sliceValue);
    const next = slice(state, sliceDim, state.levels[sliceDim], sliceValue);
    const after = aggregate(rows, next);
    const share = result.totals.sales ? (after.totals.sales / aggregate(rows, { ...state, filters: Object.fromEntries(Object.entries(state.filters).filter(([d]) => d !== sliceDim)) }).totals.sales) : 0;
    commit(next, `Slice: ${DIMS[sliceDim].name} = ${m?.label ?? sliceValue}`, `${DIMS[sliceDim].name} (${lvlName(sliceDim, state.levels[sliceDim])}) is fixed to one member, which leaves ${fmtPct(share)} of the sales visible.`);
  };
  const doDice = () => {
    const selections = {};
    for (const [dim, keys] of Object.entries(diceSel)) if (keys.length) selections[dim] = { level: state.levels[dim], keys };
    const dims = Object.keys(selections);
    if (!dims.length) return;
    commit(dice(state, selections), `Dice on ${dims.map((d) => DIMS[d].name).join(' + ')}`,
      dims.map((d) => `${DIMS[d].name}: ${selections[d].keys.map((k) => k.split(SEP).pop()).join(', ')}`).join('  |  ') + (dims.length < 2 ? '  (a dice normally uses two or more dimensions)' : ''));
    setDiceSel({});
  };
  const doPivot = (next, what) => commit(next, 'Pivot', `${what}. New axes → ${describeAxes(next)}`);
  const reset = () => { setState(initialState()); setLog([{ id: Date.now(), title: 'Reset', detail: 'Cube restored to Product › Category × Time › Quarter × Store.', before: summary(result), after: summary(aggregate(rows, initialState())) }]); setSelectedId(null); setDiceSel({}); };

  const selectedCell = selectedId == null ? null : result.cells.find((c) => c.id === selectedId);
  const labelsOf = (c) => [result.axes[0].members[c.i], result.axes[1].members[c.j], result.axes[2].members[c.k]];
  const sortedCells = useMemo(() => [...result.cells].sort((a, b) => b[measure] - a[measure]), [result, measure]);
  const shownCells = showAll ? sortedCells : sortedCells.slice(0, 10);
  const filterEntries = Object.entries(state.filters);
  const sql = useMemo(() => toSQL(state), [state]);

  const exportCube = () => {
    const cols = [...result.axes.map((a) => `${a.dimName} (${a.levelName})`), 'Total_Sales', 'Total_Profit', 'Total_Quantity', 'Orders'];
    const data = result.cells.map((c) => {
      const row = {};
      labelsOf(c).forEach((m, i) => { row[cols[i]] = m.label; });
      return { ...row, Total_Sales: c.sales.toFixed(2), Total_Profit: c.profit.toFixed(2), Total_Quantity: c.qty, Orders: c.count };
    });
    downloadText('smartdmart_cube_view.csv', toCSV(cols, data));
  };

  return (
    <section className="lab" aria-label="3D OLAP cube">
      <div className="lab-main">
        <div className="viewport">
          <div className="hud hud-top">
            <div className="axis-legend">
              {result.axes.map((a, i) => (
                <span key={a.dim} className="ax-chip" style={{ '--ax': AXIS_COLORS[i] }}>
                  <b>{'XYZ'[i]}</b> {a.dimName} › {a.levelName} <i>{a.members.length}</i>
                </span>
              ))}
            </div>
            <div className="seg" role="group" aria-label="Measure shown by cell size and colour">
              {Object.values(MEASURES).map((m) => (
                <button key={m.id} type="button" className={measure === m.id ? 'on' : ''} aria-pressed={measure === m.id} onClick={() => setMeasure(m.id)}>{m.short}</button>
              ))}
            </div>
          </div>
          <CubeScene result={result} measure={measure} selectedId={selectedId} autoRotate={autoRotate} resetToken={resetToken}
            onHover={setHover} onSelect={(c) => setSelectedId(c ? c.id : null)} />
          {hover && (
            <div className="tip" style={{ left: Math.min(hover.x + 14, 9999), top: hover.y + 14 }}>
              {labelsOf(hover.cell).map((m, i) => (<div key={i}><span style={{ color: AXIS_COLORS[i] }}>{result.axes[i].dimName}</span> {m.parts.join(SEP) || m.label}</div>))}
              <hr />
              <div>Sales <b>{fmtMoney(hover.cell.sales)}</b></div>
              <div>Profit <b>{fmtMoney(hover.cell.profit)}</b></div>
              <div>Quantity <b>{fmtInt(hover.cell.qty)}</b> · Orders <b>{hover.cell.count}</b></div>
            </div>
          )}
          {!rows.length && <div className="empty-overlay">No orders match the current filters.</div>}
          <div className="hud hud-bottom">
            <div className="legend"><span>0</span><div style={{ background: RAMP_CSS }} /><span>{fmtMeasure(measure, result.max[measure])}</span><em>cell size and colour = {MEASURES[measure].label}</em></div>
            <div className="hud-actions">
              <button type="button" className={'btn small' + (autoRotate ? ' on' : '')} aria-pressed={autoRotate} onClick={() => setAutoRotate((v) => !v)}>Auto-rotate</button>
              <button type="button" className="btn small" onClick={() => setResetToken((t) => t + 1)}>Reset view</button>
            </div>
          </div>
          <p className="hud-hint">Drag to rotate · scroll to zoom · click a cell</p>
        </div>

        <aside className="ops" aria-label="OLAP operations">
          <div className="seg wide" role="tablist" aria-label="OLAP operation">
            {OPS.map((o) => (
              <button key={o.id} role="tab" aria-selected={op === o.id} type="button" className={op === o.id ? 'on' : ''} onClick={() => setOp(o.id)}>{o.label}</button>
            ))}
          </div>

          {(op === 'rollup' || op === 'drilldown') && (
            <div className="op-panel">
              <div className="dim-pick" role="radiogroup" aria-label="Dimension">
                {state.axes.map((d, i) => (
                  <button key={d} type="button" role="radio" aria-checked={effOpDim === d} className={'dim-btn' + (effOpDim === d ? ' on' : '')} style={{ '--ax': AXIS_COLORS[i] }} onClick={() => setOpDim(d)}>
                    <b>{'XYZ'[i]}</b> {DIMS[d].name}<small>{lvlName(d, state.levels[d])}</small>
                  </button>
                ))}
              </div>
              <ol className="hier" aria-label={`${DIMS[effOpDim].name} hierarchy`}>
                {DIMS[effOpDim].levels.map((l, i) => (
                  <li key={l.name}><button type="button" className={state.levels[effOpDim] === i ? 'on' : ''} onClick={() => jump(effOpDim, i)}>{l.name}</button></li>
                ))}
              </ol>
              {op === 'rollup' ? (
                <button type="button" className="btn primary" disabled={!canRollUp(state, effOpDim)} onClick={doRoll}>
                  {canRollUp(state, effOpDim) ? `Roll up ${DIMS[effOpDim].name}: ${lvlName(effOpDim, state.levels[effOpDim])} → ${lvlName(effOpDim, state.levels[effOpDim] - 1)}` : 'Already at the top level'}
                </button>
              ) : (
                <button type="button" className="btn primary" disabled={!canDrillDown(state, effOpDim)} onClick={doDrill}>
                  {canDrillDown(state, effOpDim) ? `Drill down ${DIMS[effOpDim].name}: ${lvlName(effOpDim, state.levels[effOpDim])} → ${lvlName(effOpDim, state.levels[effOpDim] + 1)}` : 'Already at the lowest level'}
                </button>
              )}
            </div>
          )}

          {op === 'slice' && (
            <div className="op-panel">
              <label className="field">Dimension
                <select value={sliceDim} onChange={(e) => { setSliceDim(e.target.value); setSliceKey(''); }}>
                  {DIM_ORDER.map((d) => <option key={d} value={d}>{DIMS[d].name} (level: {lvlName(d, state.levels[d])})</option>)}
                </select>
              </label>
              <label className="field">Member
                <select value={sliceValue} onChange={(e) => setSliceKey(e.target.value)}>
                  {sliceMembers.map((m) => <option key={m.key} value={m.key}>{m.parts.join(SEP) || m.label}</option>)}
                </select>
              </label>
              <button type="button" className="btn primary" disabled={!sliceMembers.length} onClick={doSlice}>Slice: {DIMS[sliceDim].name} = {sliceMembers.find((m) => m.key === sliceValue)?.label ?? '—'}</button>
            </div>
          )}

          {op === 'dice' && (
            <div className="op-panel">
              {DIM_ORDER.map((d) => {
                const members = listMembers(rows, d, state.levels[d]);
                const sel = diceSel[d] || [];
                return (
                  <details key={d} className="dice-dim" open={d === state.axes[0] || sel.length > 0 ? true : undefined}>
                    <summary>{DIMS[d].name} <small>{lvlName(d, state.levels[d])}</small>{sel.length > 0 && <span className="badge">{sel.length}</span>}</summary>
                    <div className="chips scroll">
                      {members.map((m) => (
                        <button type="button" key={m.key} className={'chip' + (sel.includes(m.key) ? ' on' : '')} aria-pressed={sel.includes(m.key)} title={m.parts.join(SEP)}
                          onClick={() => setDiceSel((s) => ({ ...s, [d]: sel.includes(m.key) ? sel.filter((k) => k !== m.key) : [...sel, m.key] }))}>{m.label}</button>
                      ))}
                    </div>
                  </details>
                );
              })}
              <button type="button" className="btn primary" disabled={!Object.values(diceSel).some((k) => k.length)} onClick={doDice}>
                Apply dice ({Object.values(diceSel).filter((k) => k.length).length} dimension{Object.values(diceSel).filter((k) => k.length).length === 1 ? '' : 's'})
              </button>
            </div>
          )}

          {op === 'pivot' && (
            <div className="op-panel">
              {[0, 1, 2].map((i) => (
                <label className="field" key={i} style={{ '--ax': AXIS_COLORS[i] }}>
                  <span><b className="axdot">{'XYZ'[i]}</b> axis</span>
                  <select value={state.axes[i]} onChange={(e) => doPivot(setAxisDim(state, i, e.target.value), `${'XYZ'[i]} axis now shows ${DIMS[e.target.value].name}`)}>
                    {DIM_ORDER.map((d) => <option key={d} value={d}>{DIMS[d].name}</option>)}
                  </select>
                </label>
              ))}
              <div className="btn-row">
                <button type="button" className="btn" onClick={() => doPivot(rotateAxes(state), 'Axes rotated (X→Y→Z→X)')}>Rotate axes</button>
                <button type="button" className="btn" onClick={() => doPivot(swapAxes(state, 0, 1), 'X and Y swapped')}>Swap X↔Y</button>
                <button type="button" className="btn" onClick={() => doPivot(swapAxes(state, 1, 2), 'Y and Z swapped')}>Swap Y↔Z</button>
                <button type="button" className="btn" onClick={() => doPivot(swapAxes(state, 0, 2), 'X and Z swapped')}>Swap X↔Z</button>
              </div>
            </div>
          )}

          <div className="active">
            <div className="active-head"><span>Active filters</span><button type="button" className="btn small ghost" onClick={reset}>Reset cube</button></div>
            {filterEntries.length === 0 ? <p className="op-note">None</p> : (
              <ul className="chips">
                {filterEntries.map(([d, f]) => (
                  <li key={d}><button type="button" className="chip on removable" onClick={() => commit(clearFilter(state, d), `Cleared filter on ${DIMS[d].name}`, 'The dimension is no longer restricted.')} title="Remove this filter">
                    {DIMS[d].name}: {f.keys.length === 1 ? f.keys[0].split(SEP).pop() : `${f.keys.length} members`} ×</button></li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      <div className="lab-results">
        <div className="panel result-card" aria-live="polite">
          <h3>Result of the last operation</h3>
          {log.length === 0 ? <p className="op-note">No operations yet</p> : (
            <ol className="log">
              {log.map((l, i) => (
                <li key={l.id} className={i === 0 ? 'latest' : ''}>
                  <b>{l.title}</b><span>{l.detail}</span>
                  {i === 0 && (<><small>Before: {l.before}</small><small>After: {l.after}</small></>)}
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="panel">
          <h3>Current cube view</h3>
          <div className="kpi-strip">
            <div><span>Total Sales</span><b>{fmtMoney(result.totals.sales)}</b></div>
            <div><span>Total Profit</span><b>{fmtMoney(result.totals.profit)}</b></div>
            <div><span>Total Quantity</span><b>{fmtInt(result.totals.qty)}</b></div>
            <div><span>Orders in view</span><b>{fmtInt(result.orders)}</b></div>
          </div>
          {selectedCell && (
            <div className="selected">
              <div className="sel-head"><b>Selected cell</b><button type="button" className="btn small ghost" onClick={() => setSelectedId(null)}>Clear</button></div>
              <p>{labelsOf(selectedCell).map((m, i) => <span key={i} className="pill" style={{ '--ax': AXIS_COLORS[i] }}>{m.parts.join(SEP) || m.label}</span>)}</p>
              <p>Sales <b>{fmtMoney(selectedCell.sales)}</b> · Profit <b>{fmtMoney(selectedCell.profit)}</b> ({fmtPct(selectedCell.profit / selectedCell.sales)} margin) · Qty <b>{fmtInt(selectedCell.qty)}</b> · {selectedCell.count} order{selectedCell.count === 1 ? '' : 's'}</p>
              <details><summary>Underlying orders (drill-through)</summary>
                <table className="tbl compact"><thead><tr><th>Order</th><th>Date</th><th>Product</th><th className="num">Qty</th><th className="num">Sales</th></tr></thead>
                  <tbody>{selectedCell.rows.slice(0, 15).map((r) => <tr key={r.id}><td>{r.id}</td><td>{r.date}</td><td>{r.product}</td><td className="num">{r.qty}</td><td className="num">{fmtMoney(r.sales)}</td></tr>)}</tbody></table>
                {selectedCell.rows.length > 15 && <p className="op-note">Showing 15 of {selectedCell.rows.length} orders.</p>}
              </details>
            </div>
          )}
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr>
                {result.axes.map((a, i) => <th key={a.dim} style={{ '--ax': AXIS_COLORS[i] }}><span className="axdot">{'XYZ'[i]}</span> {a.dimName}</th>)}
                <th className="num">Sales</th><th className="num">Profit</th><th className="num">Qty</th><th className="num">Orders</th>
              </tr></thead>
              <tbody>
                {shownCells.map((c) => (
                  <tr key={c.id} className={c.id === selectedId ? 'sel' : ''} onClick={() => setSelectedId(c.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setSelectedId(c.id); }}>
                    {labelsOf(c).map((m, i) => <td key={i} title={m.parts.join(SEP)}>{m.label}</td>)}
                    <td className={'num' + (measure === 'sales' ? ' hl' : '')}>{fmtMoney(c.sales)}</td>
                    <td className={'num' + (measure === 'profit' ? ' hl' : '')}>{fmtMoney(c.profit)}</td>
                    <td className={'num' + (measure === 'qty' ? ' hl' : '')}>{fmtInt(c.qty)}</td>
                    <td className="num">{c.count}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={3}>Total ({result.cells.length} cells)</td><td className="num">{fmtMoney(result.totals.sales)}</td><td className="num">{fmtMoney(result.totals.profit)}</td><td className="num">{fmtInt(result.totals.qty)}</td><td className="num">{result.orders}</td></tr></tfoot>
            </table>
          </div>
          <div className="btn-row">
            {sortedCells.length > 10 && <button type="button" className="btn small" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show top 10' : `Show all ${sortedCells.length} cells`}</button>}
            <button type="button" className="btn small" onClick={exportCube}>Export this view (CSV)</button>
          </div>
          <details className="sql"><summary>SQL equivalent</summary><pre>{sql}</pre></details>
        </div>
      </div>
    </section>
  );
}
