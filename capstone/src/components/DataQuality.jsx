import { useMemo, useState } from 'react';
import { RULES } from '../lib/pipeline.js';
import { downloadText, toCSV, fmtInt } from '../lib/format.js';
import { cleanedCSV } from '../lib/exportCsv.js';

export default function DataQuality({ report, rows, sourceName, onManage }) {
  const [filter, setFilter] = useState('All');
  const issues = useMemo(() => report.issues.filter((i) => filter === 'All' || i.action.startsWith(filter)), [report, filter]);
  const rejectedRows = new Set(report.issues.filter((i) => i.action.startsWith('Rejected')).map((i) => i.orderId)).size;

  return (
    <section className="quality" aria-label="Data quality">
      <div className="kpis four">
        <div className="kpi"><span>Rows read</span><b>{fmtInt(report.totalRead)}</b></div>
        <div className="kpi main"><span>Rows accepted</span><b>{fmtInt(report.accepted)}</b></div>
        <div className="kpi"><span>Rows repaired</span><b>{fmtInt(report.repairedRows)}</b></div>
        <div className="kpi warn"><span>Rows rejected</span><b>{fmtInt(rejectedRows)}</b></div>
      </div>

      <div className="panel">
        <h3>Cleaning rules</h3>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Rule</th><th>Action</th><th>What is checked</th><th>Why</th></tr></thead>
            <tbody>{RULES.map((r) => <tr key={r.id}><td>{r.id}</td><td><span className={'tag ' + r.kind.toLowerCase()}>{r.kind}</span></td><td>{r.rule}</td><td>{r.why}</td></tr>)}</tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Row-level log <small>{issues.length} entries</small></h3>
          <div className="seg" role="group" aria-label="Filter log">
            {['All', 'Rejected', 'Repaired', 'Defaulted'].map((f) => <button key={f} type="button" className={filter === f ? 'on' : ''} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f}</button>)}
          </div>
        </div>
        {issues.length === 0 ? <p className="op-note">Nothing to report for this filter.</p> : (
          <div className="tbl-wrap">
            <table className="tbl compact">
              <thead><tr><th>Order_ID</th><th>File row</th><th>Field</th><th>Problem</th><th>Original</th><th>Action</th><th>Result</th></tr></thead>
              <tbody>{issues.map((i, n) => (
                <tr key={n}><td>{i.orderId}</td><td>{i.line}</td><td>{i.field}</td><td>{i.problem}</td><td><code>{i.before === '' ? '(empty)' : i.before}</code></td>
                  <td><span className={'tag ' + i.action.split(' ')[0].toLowerCase()}>{i.action}</span></td><td>{i.after ? <code>{i.after}</code> : '—'}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <div className="btn-row">
          <button type="button" className="btn small" onClick={() => downloadText('smartdmart_cleaning_log.csv', toCSV(['orderId', 'line', 'field', 'problem', 'action', 'before', 'after'], report.issues))}>Download cleaning log (CSV)</button>
          <button type="button" className="btn small" onClick={() => downloadText('smartdmart_cleaned_dataset.csv', cleanedCSV(rows))}>Download cleaned dataset (CSV)</button>
        </div>
      </div>

      <div className="panel">
        <h3>Dataset source</h3>
        <p className="src"><b>{sourceName}</b>{report.dateRange && <> · {report.dateRange.min} to {report.dateRange.max}</>}</p>
        {report.notes?.length > 0 && <div className="notes"><b>Column mapping</b><ul>{report.notes.map((n) => <li key={n}>{n}</li>)}</ul></div>}
        <div className="btn-row"><button type="button" className="btn" onClick={onManage}>Add or switch dataset</button></div>
      </div>
    </section>
  );
}
