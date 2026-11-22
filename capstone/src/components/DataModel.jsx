import { useMemo, useState } from 'react';
import starDdl from '../../docs/mysql/schema.sql?raw';
import snowDdl from '../../docs/mysql/snowflake_schema.sql?raw';
import { SCHEMA, RELATIONSHIPS, SNOWFLAKE_SCHEMA, SNOWFLAKE_RELATIONSHIPS, buildStar, buildSnowflake, checkModelIntegrity, tableCSV, snowflakeCSV } from '../lib/star.js';
import { downloadText, numLocale } from '../lib/format.js';

const W = 220, HEAD = 32, ROW = 24;

const LAYOUTS = {
  star: {
    view: [1000, 760],
    pos: { DIM_PRODUCT: [390, 16], DIM_DATE: [30, 235], FACT_SALES: [390, 205], DIM_STORE: [750, 255], DIM_PAYMENT: [150, 560], DIM_CUSTOMER_TYPE: [630, 560] },
    sides: {
      DIM_PRODUCT: ['bottom', 'top', 0], DIM_DATE: ['right', 'left', 0], DIM_STORE: ['left', 'right', 0],
      DIM_PAYMENT: ['top', 'bottom', -60], DIM_CUSTOMER_TYPE: ['top', 'bottom', 60],
    },
  },
  snowflake: {
    view: [1420, 800],
    pos: {
      FACT_SALES: [620, 330], DIM_PRODUCT: [620, 150], DIM_BRAND: [900, 150], DIM_CATEGORY: [1180, 150],
      DIM_STORE: [900, 360], DIM_CITY: [1180, 360], DIM_DATE: [330, 360], DIM_MONTH: [60, 360], DIM_QUARTER: [60, 170], DIM_YEAR: [330, 170],
      DIM_PAYMENT: [480, 690], DIM_CUSTOMER_TYPE: [780, 690],
    },
    sides: {
      DIM_PRODUCT: ['bottom', 'top', 0], DIM_DATE: ['right', 'left', 0], DIM_STORE: ['left', 'right', 0],
      DIM_PAYMENT: ['top', 'bottom', -60], DIM_CUSTOMER_TYPE: ['top', 'bottom', 60],
      'DIM_BRAND>DIM_PRODUCT': ['left', 'right', 0], 'DIM_CATEGORY>DIM_BRAND': ['left', 'right', 0], 'DIM_MONTH>DIM_DATE': ['right', 'left', 0],
      'DIM_QUARTER>DIM_MONTH': ['bottom', 'top', 0], 'DIM_YEAR>DIM_QUARTER': ['left', 'right', 0], 'DIM_CITY>DIM_STORE': ['left', 'right', 0],
    },
  },
};

const MODELS = {
  star: { schema: SCHEMA, rels: RELATIONSHIPS, build: buildStar, csv: tableCSV, ddl: starDdl, ddlFile: 'smartdmart_star_schema.sql' },
  snowflake: { schema: SNOWFLAKE_SCHEMA, rels: SNOWFLAKE_RELATIONSHIPS, build: buildSnowflake, csv: snowflakeCSV, ddl: snowDdl, ddlFile: 'smartdmart_snowflake_schema.sql' },
};

function Diagram({ model, data, selected, onSelect }) {
  const [hover, setHover] = useState(null);
  const L = LAYOUTS[model], M = MODELS[model];
  const h = (t) => HEAD + M.schema[t].columns.length * ROW;
  const rowY = (t, key) => L.pos[t][1] + HEAD + M.schema[t].columns.findIndex((c) => c.name === key) * ROW + ROW / 2;
  const anchor = (t, key, side, off) => {
    const [x, y] = L.pos[t];
    if (side === 'left') return [x, rowY(t, key)];
    if (side === 'right') return [x + W, rowY(t, key)];
    if (side === 'top') return [x + W / 2 + off, y];
    return [x + W / 2 + off, y + h(t)];
  };
  const focus = hover || selected;
  const conns = M.rels.map((rel) => {
    const cfg = L.sides[rel.to === 'FACT_SALES' ? rel.from : `${rel.from}>${rel.to}`];
    const [ps, cs, off] = cfg;
    const P = anchor(rel.from, rel.key, ps, ps === 'top' || ps === 'bottom' ? 0 : 0);
    const Q = anchor(rel.to, rel.key, cs, off);
    const horiz = ps === 'left' || ps === 'right';
    const pts = horiz ? [P, [(P[0] + Q[0]) / 2, P[1]], [(P[0] + Q[0]) / 2, Q[1]], Q] : [P, [P[0], (P[1] + Q[1]) / 2], [Q[0], (P[1] + Q[1]) / 2], Q];
    const lab = (pt, side) => (side === 'left' ? [pt[0] - 14, pt[1] - 6] : side === 'right' ? [pt[0] + 7, pt[1] - 6] : side === 'top' ? [pt[0] + 7, pt[1] - 7] : [pt[0] + 7, pt[1] + 17]);
    return { rel, pts, one: lab(P, ps), many: lab(Q, cs), on: focus === rel.from || focus === rel.to };
  });
  const connected = (t) => focus && (t === focus || M.rels.some((r) => (r.from === focus || r.to === focus) && (r.from === t || r.to === t)));

  return (
    <div className="schema-scroll">
      <svg viewBox={`0 0 ${L.view[0]} ${L.view[1]}`} className={'schema-svg ' + model} role="group" aria-label={model + ' schema diagram'}>
        <defs><marker id={'arrow-' + model} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="st-arrow" /></marker></defs>
        {conns.map((c) => (
          <g key={c.rel.from + c.rel.to} className={'st-rel' + (c.on ? ' on' : '')}>
            <polyline points={c.pts.map((p) => p.join(',')).join(' ')} fill="none" markerEnd={`url(#arrow-${model})`} />
            <text x={c.one[0]} y={c.one[1]} className="st-card">1</text>
            <text x={c.many[0]} y={c.many[1]} className="st-card">N</text>
          </g>
        ))}
        {Object.keys(M.schema).map((name) => {
          const t = M.schema[name], [x, y] = L.pos[name];
          return (
            <g key={name} className={'st-table' + (t.kind === 'fact' ? ' fact' : '') + (name === selected ? ' active' : '') + (focus && !connected(name) ? ' dim' : '')}
              transform={`translate(${x},${y})`} tabIndex={0} role="button" aria-label={`${name}, ${t.columns.length} columns`}
              onClick={() => onSelect(name)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(name); } }}
              onMouseEnter={() => setHover(name)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(name)} onBlur={() => setHover(null)}>
              <rect className="st-box" width={W} height={h(name)} rx="6" />
              <rect className="st-head" width={W} height={HEAD} rx="6" /><rect className="st-head-fix" y={HEAD - 8} width={W} height="8" />
              <text className="st-title" x={12} y={21}>{name}</text>
              <text className="st-count" x={W - 10} y={21} textAnchor="end">{data[name].length.toLocaleString(numLocale())} rows</text>
              {t.columns.map((c, i) => (
                <g key={c.name} transform={`translate(0,${HEAD + i * ROW})`}>
                  {i > 0 && <line className="st-sep" x1="0" x2={W} y1="0" y2="0" />}
                  <text className="st-col" x={44} y={16}>{c.name}</text>
                  {c.pk && <text className="st-badge pk" x={10} y={16}>PK</text>}
                  {c.fk && <text className="st-badge fk" x={10} y={16}>FK</text>}
                </g>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function DataModel({ rows, initialModel = 'star' }) {
  const [model, setModel] = useState(initialModel);
  const [selected, setSelected] = useState('FACT_SALES');
  const [showDdl, setShowDdl] = useState(false);
  const star = useMemo(() => buildStar(rows), [rows]);
  const snow = useMemo(() => buildSnowflake(rows), [rows]);
  const M = MODELS[model];
  const data = model === 'star' ? star : snow;
  const sel = M.schema[selected] ? selected : 'FACT_SALES';
  const integrity = useMemo(() => checkModelIntegrity(data, M.rels), [data, M]);
  const cols = M.schema[sel].columns.map((c) => c.name);
  const cells = (d) => Object.entries(d).filter(([k]) => k !== 'FACT_SALES').reduce((a, [, v]) => a + v.length, 0);

  const switchModel = (m) => { setModel(m); setSelected('FACT_SALES'); };

  return (
    <section className="schema" aria-label="Data model">
      <div className="panel">
        <div className="panel-head">
          <h3>Dimensional model</h3>
          <div className="seg" role="group" aria-label="Schema type">
            <button type="button" className={model === 'star' ? 'on' : ''} aria-pressed={model === 'star'} onClick={() => switchModel('star')}>Star schema</button>
            <button type="button" className={model === 'snowflake' ? 'on' : ''} aria-pressed={model === 'snowflake'} onClick={() => switchModel('snowflake')}>Snowflake schema</button>
          </div>
        </div>
        
        <Diagram model={model} data={data} selected={sel} onSelect={setSelected} />
        <ul className="schema-legend">
          <li><b className="st-badge-inline pk">PK</b> primary key</li>
          <li><b className="st-badge-inline fk">FK</b> foreign key</li>
          <li><span className="rel-sample" /> 1 → N relationship (parent → child)</li>
        </ul>
      </div>

      <div className="grid-2 schema-detail">
        <div className="panel">
          <h3>{sel} <small>{data[sel].length.toLocaleString(numLocale())} rows built from your dataset</small></h3>
          <div className="tbl-wrap">
            <table className="tbl compact">
              <thead><tr>{cols.map((c) => <th key={c} className={typeof data[sel][0]?.[c] === 'number' ? 'num' : ''}>{c}{M.schema[sel].columns.find((x) => x.name === c).pk ? ' 🔑' : ''}</th>)}</tr></thead>
              <tbody>{data[sel].slice(0, 8).map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} className={typeof r[c] === 'number' ? 'num' : ''}>{String(r[c])}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <div className="btn-row">
            <button type="button" className="btn small" onClick={() => downloadText(sel + '.csv', M.csv(sel, data))}>Download {sel}.csv</button>
            <button type="button" className="btn small" onClick={() => Object.keys(M.schema).forEach((n, i) => setTimeout(() => downloadText(n + '.csv', M.csv(n, data)), i * 250))}>Download all {Object.keys(M.schema).length} CSV files</button>
          </div>
        </div>

        <div className="panel">
          <h3>Referential integrity <small>{integrity.every((i) => i.ok) ? 'all keys valid' : 'problems found'}</small></h3>
          <div className="tbl-wrap">
            <table className="tbl compact">
              <thead><tr><th>Parent → child</th><th>Key</th><th className="num">Orphans</th><th /></tr></thead>
              <tbody>{integrity.map((c) => <tr key={c.from + c.to}><td>{c.from} → {c.to}</td><td>{c.key}</td><td className="num">{c.orphans}</td><td>{c.ok ? <span className="ok">✓</span> : <span className="bad">✗</span>}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>Star vs snowflake for this dataset</h3>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Aspect</th><th>Star schema</th><th>Snowflake schema</th></tr></thead>
            <tbody>
              <tr><td>Tables</td><td>6 (1 fact + 5 dimensions)</td><td>12 (1 fact + 11 dimension tables)</td></tr>
              <tr><td>Dimension rows stored</td><td>{cells(star).toLocaleString(numLocale())}</td><td>{cells(snow).toLocaleString(numLocale())}</td></tr>
              <tr><td>Joins to report sales by Category</td><td>1 (FACT → DIM_PRODUCT)</td><td>3 (FACT → PRODUCT → BRAND → CATEGORY)</td></tr>
              <tr><td>Joins to report sales by Year</td><td>1 (FACT → DIM_DATE)</td><td>4 (FACT → DATE → MONTH → QUARTER → YEAR)</td></tr>
              <tr><td>Redundancy</td><td>Category repeated on every product row, Year on every date row</td><td>Each value stored once; updates touch one row</td></tr>
              <tr><td>Best for</td><td>Fast, simple OLAP queries and the 3D cube</td><td>Cleaner hierarchies and smaller dimensions</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel ddl">
        <div className="panel-head"><h3>MySQL DDL ({model})</h3>
          <div className="btn-row" style={{ marginTop: 0 }}>
            <button type="button" className="btn small" onClick={() => setShowDdl((v) => !v)}>{showDdl ? 'Hide' : 'Show'} SQL</button>
            <button type="button" className="btn small" onClick={() => downloadText(M.ddlFile, M.ddl, 'text/plain;charset=utf-8')}>Download .sql</button>
          </div></div>
        {showDdl && <pre>{M.ddl}</pre>}
      </div>
    </section>
  );
}
