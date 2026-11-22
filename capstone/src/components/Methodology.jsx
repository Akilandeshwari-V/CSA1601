import { fmtInt } from '../lib/format.js';

const STATUS = { impl: 'Built into this website', ext: 'External tool: documented only', both: 'Website version + external guide' };
const Tag = ({ k }) => <span className={'status ' + k}>{STATUS[k]}</span>;

export default function Methodology({ report }) {
  const kdd = [
    ['Selection', `${fmtInt(report.totalRead)} order rows and ${report.columns.length} columns loaded from the dataset.`, 'impl'],
    ['Pre-processing', `${fmtInt(report.rejected)} rows rejected, ${fmtInt(report.repairedRows)} repaired, ${fmtInt(report.accepted)} accepted (Data Quality page).`, 'both'],
    ['Transformation', 'Star and snowflake schemas generated; OLAP hierarchies for Product, Time and Location (Data Model and 3D OLAP Cube pages).', 'both'],
    ['Data mining', 'Segmentation, ABC analysis, decision tree, anomaly detection, correlations and forecasting (Data Mining and Forecasting pages).', 'both'],
    ['Interpretation', 'Dashboard, Power BI-style analysis and key findings for decisions.', 'impl'],
  ];
  const tools = [
    ['Dataset (CSV / Excel)', 'impl', 'Bundled CSV; administrators can upload a replacement.'],
    ['KNIME ETL', 'both', 'Same cleaning rules run on the server (src/lib/pipeline.js). KNIME workflow outline: docs/knime.'],
    ['MySQL data warehouse', 'both', 'Star and snowflake tables are generated and exportable; DDL in docs/mysql. The website itself stores data in SQLite.'],
    ['Mondrian OLAP', 'both', 'JavaScript OLAP engine drives the 3D cube; draft Mondrian schema in docs/mondrian (untested).'],
    ['WEKA / Python', 'both', 'Mining runs on the server; pandas cross-check script and WEKA guide in docs.'],
    ['Power BI / Metabase', 'both', 'Built-in Power BI-style analysis with a live data connection, M script and DAX measures; the .pbix itself must be made in Power BI Desktop.'],
  ];
  return (
    <section className="about" aria-label="Methodology">
      <div className="panel">
        <h3>Knowledge discovery (KDD) process on this dataset</h3>
        <ol className="kdd">{kdd.map(([n, t, k], i) => <li key={n}><span className="kdd-n">{i + 1}</span><div><h4>{n} <Tag k={k} /></h4><p className="live">{t}</p></div></li>)}</ol>
      </div>
      <div className="panel">
        <h3>Architecture</h3>
        <div className="arch">
          <div><b>Browser</b><span>React, Three.js, Recharts. 3D cube, OLAP operations, dashboards run on cleaned rows fetched from the API.</span></div>
          <div className="arr">⇄ HTTPS / JSON</div>
          <div><b>Node.js API</b><span>Authentication (scrypt, signed tokens), roles, dataset cleaning, forecasting, data mining, CSV exports for BI tools.</span></div>
          <div className="arr">⇄ SQL</div>
          <div><b>SQLite</b><span>Users, activity log and uploaded datasets.</span></div>
        </div>
      </div>
      <div className="panel">
        <h3>Pipeline and tool status</h3>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Stage</th><th>Status</th><th>Details</th></tr></thead>
          <tbody>{tools.map(([n, k, d]) => <tr key={n}><td><b>{n}</b></td><td><Tag k={k} /></td><td>{d}</td></tr>)}</tbody>
        </table></div>
      </div>
    </section>
  );
}
