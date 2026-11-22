import { useEffect, useState } from 'react';
import { ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, Cell, ScatterChart, Scatter, ZAxis } from 'recharts';
import { api } from '../api.js';
import { COLORS } from '../theme.js';
import { fmtMoney, fmtCompactMoney, fmtPct, fmtInt, downloadText, toCSV } from '../lib/format.js';

// getters, so the colours follow the active theme
const CLASS_COLOR = { get A() { return COLORS.primary; }, get B() { return COLORS.amber; }, get C() { return COLORS.muted; } };
const CLUSTER_COLOR = { get 0() { return COLORS.primary; }, get 1() { return COLORS.amber; }, get 2() { return COLORS.red; } };
const TABS = [['segments', 'Product segments'], ['classify', 'Classification'], ['anomaly', 'Patterns and anomalies'], ['corr', 'Correlations'], ['assoc', 'Association rules']];

function Heat({ c }) {
  const color = (v) => (v >= 0 ? `color-mix(in srgb, var(--brand) ${Math.round(Math.abs(v) * 100)}%, transparent)` : `color-mix(in srgb, var(--red) ${Math.round(Math.abs(v) * 100)}%, transparent)`);
  return (
    <div className="tbl-wrap"><table className="tbl heat">
      <thead><tr><th />{c.fields.map((f) => <th key={f} className="num">{f}</th>)}</tr></thead>
      <tbody>{c.matrix.map((row, i) => (
        <tr key={i}><th>{c.fields[i]}</th>{row.map((v, j) => <td key={j} className="num" style={{ background: color(v), color: Math.abs(v) > 0.55 ? '#fff' : 'inherit' }}>{v.toFixed(2)}</td>)}</tr>))}</tbody>
    </table></div>
  );
}

function TreeView({ node, depth = 0, label = 'Start' }) {
  const s = node.split;
  const desc = s ? (s.type === 'num' ? `${s.feature} ≤ ${(+s.value).toFixed(2)}` : `${s.feature} = ${s.value}`) : null;
  return (
    <li>
      <div className={'tree-node ' + (s ? 'split' : node.pred ? 'yes' : 'no')}>
        <small>{label}</small>
        <b>{s ? desc + '?' : node.pred ? 'Predict: Yes' : 'Predict: No'}</b>
        <span>{node.n} orders · {fmtPct(node.pos / node.n, 0)} are Yes</span>
      </div>
      {s && <ul><TreeView node={node.yes} depth={depth + 1} label="yes" /><TreeView node={node.no} depth={depth + 1} label="no" /></ul>}
    </li>
  );
}

export default function DataMining({ preload = null, initialTab = 'segments' }) {
  const [tab, setTab] = useState(initialTab);
  const [target, setTarget] = useState('highValue');
  const [d, setD] = useState(preload);
  const [error, setError] = useState('');

  useEffect(() => {
    if (preload && target === preload.tree.target) return undefined;
    let live = true;
    api('/mining?target=' + target).then((r) => live && setD(r)).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [target]);

  if (error) return <p className="form-error" role="alert">{error}</p>;
  if (!d) return <div className="panel empty">Running data-mining algorithms on the server…</div>;
  const { abc, kmeans: km, anomalies: an, correlations: cor, tree, weekday } = d;
  const aCount = abc.filter((p) => p.cls === 'A').length;
  const busiest = weekday.reduce((a, b) => (b.sales > a.sales ? b : a));
  const quietest = weekday.reduce((a, b) => (b.sales < a.sales ? b : a));
  const discMargin = cor.matrix[cor.fields.indexOf('Discount %')][cor.fields.indexOf('Margin %')];

  const exportFeatures = () => downloadText('smartdmart_product_features.csv', toCSV(
    ['Product', 'Category', 'Total_Sales', 'Total_Profit', 'Total_Quantity', 'Margin', 'Unit_Price', 'ABC_Class', 'Cluster'],
    km.points.map((p) => ({ Product: p.product, Category: p.category, Total_Sales: p.sales.toFixed(2), Total_Profit: p.profit.toFixed(2), Total_Quantity: p.qty, Margin: p.margin.toFixed(4), Unit_Price: p.unitPrice.toFixed(2), ABC_Class: p.cls, Cluster: p.cluster }))));

  return (
    <section className="mining" aria-label="Data mining">
      <div className="seg wide scroll-x" role="tablist" aria-label="Mining technique">
        {TABS.map(([id, l]) => <button key={id} role="tab" aria-selected={tab === id} type="button" className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{l}</button>)}
      </div>

      {tab === 'segments' && (
        <div className="grid-2">
          <figure className="panel chart span-2">
            <figcaption><h3>ABC (Pareto) analysis</h3><p>{aCount} of {abc.length} products drive 80% of sales</p></figcaption>
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={abc} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={COLORS.grid} vertical={false} />
                <XAxis dataKey="product" tick={{ fontSize: 10 }} interval={0} angle={-40} textAnchor="end" height={110} />
                <YAxis yAxisId="l" tickFormatter={fmtCompactMoney} width={56} />
                <YAxis yAxisId="r" orientation="right" domain={[0, 1]} tickFormatter={(v) => (v * 100).toFixed(0) + '%'} width={44} />
                <Tooltip formatter={(v, n) => (n === 'Cumulative share' ? fmtPct(v) : fmtMoney(v))} />
                <Legend verticalAlign="top" height={28} />
                <Bar yAxisId="l" dataKey="sales" name="Sales">{abc.map((p) => <Cell key={p.product} fill={CLASS_COLOR[p.cls]} />)}</Bar>
                <Line yAxisId="r" dataKey="cumShare" name="Cumulative share" stroke={COLORS.red} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
            <p className="legend-inline"><i style={{ background: CLASS_COLOR.A }} /> A <i style={{ background: CLASS_COLOR.B }} /> B <i style={{ background: CLASS_COLOR.C }} /> C</p>
          </figure>
          <figure className="panel chart">
            <figcaption><h3>K-means segments</h3></figcaption>
            <ResponsiveContainer width="100%" height={300}>
              <ScatterChart margin={{ top: 8, right: 14, left: 0, bottom: 4 }}>
                <CartesianGrid stroke={COLORS.grid} />
                <XAxis type="number" dataKey="sales" name="Sales" tickFormatter={fmtCompactMoney} />
                <YAxis type="number" dataKey="margin" name="Margin" tickFormatter={(v) => (v * 100).toFixed(0) + '%'} width={44} domain={['auto', 'auto']} />
                <ZAxis type="number" dataKey="unitPrice" range={[60, 380]} name="Unit price" />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ payload }) => payload?.length ? (<div className="tip-lite"><b>{payload[0].payload.product}</b><br />Sales {fmtMoney(payload[0].payload.sales)}<br />Margin {fmtPct(payload[0].payload.margin)}<br />Unit price {fmtMoney(payload[0].payload.unitPrice)}</div>) : null} />
                {km.clusters.map((c) => <Scatter key={c.id} name={c.name} data={km.points.filter((p) => p.cluster === c.id)} fill={CLUSTER_COLOR[c.id - 1]} fillOpacity={0.8} />)}
                <Legend />
              </ScatterChart>
            </ResponsiveContainer>
          </figure>
          <div className="panel">
            <h3>Segment profile</h3>
            <div className="tbl-wrap"><table className="tbl compact">
              <thead><tr><th>Segment</th><th className="num">Products</th><th className="num">Avg sales</th><th className="num">Margin</th><th className="num">Unit price</th></tr></thead>
              <tbody>{km.clusters.map((c) => <tr key={c.id}><td><i className="dot" style={{ background: CLUSTER_COLOR[c.id - 1] }} /> <b>{c.name}</b><br /><small className="muted">{c.members.slice(0, 3).join(', ')}{c.members.length > 3 ? ` +${c.members.length - 3} more` : ''}</small></td><td className="num">{c.size}</td><td className="num">{fmtMoney(c.avgSales)}</td><td className="num">{fmtPct(c.avgMargin)}</td><td className="num">{fmtMoney(c.avgUnitPrice)}</td></tr>)}</tbody>
            </table></div>
            <div className="btn-row"><button type="button" className="btn small" onClick={exportFeatures}>Export features for WEKA / Python</button></div>
          </div>
        </div>
      )}

      {tab === 'classify' && (
        <div className="grid-2">
          <div className="panel span-2">
            <div className="panel-head"><h3>Decision tree classifier</h3>
              <label className="inline-field">Predict
                <select value={target} onChange={(e) => setTarget(e.target.value)}>{Object.entries(d.targets).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label></div>
            <div className="kpis">
              <div className="kpi main"><span>Test accuracy</span><b>{fmtPct(tree.test.accuracy)}</b><small>{tree.testSize} unseen orders</small></div>
              <div className="kpi"><span>Majority-class baseline</span><b>{fmtPct(tree.baselineTest)}</b><small>always guess the common answer</small></div>
              <div className="kpi"><span>Training accuracy</span><b>{fmtPct(tree.train.accuracy)}</b><small>{tree.trainSize} orders</small></div>
              <div className="kpi"><span>Target definition</span><b className="small-b">{tree.definition}</b><small>“Yes” class</small></div>
            </div>
            <p className={'insight' + (tree.test.accuracy - tree.baselineTest < 0.03 ? ' warn' : '')}>
              {tree.test.accuracy - tree.baselineTest < 0.03
                ? 'The tree is barely better than guessing the common answer, so the available attributes do not explain this target well.'
                : `The tree improves on the baseline by ${((tree.test.accuracy - tree.baselineTest) * 100).toFixed(1)} percentage points. The most important attribute is “${tree.importance[0].name}” (${fmtPct(tree.importance[0].share, 0)} of the total importance).`}
              {target === 'highMargin' ? ' Margin follows directly from the discount given, which is why discount dominates.' : ''}
            </p>
          </div>
          <div className="panel">
            <h3>Tree</h3>
            <div className="tree"><ul><TreeView node={tree.tree} /></ul></div>
          </div>
          <div className="panel">
            <h3>Decision rules</h3>
            <div className="tbl-wrap"><table className="tbl compact">
              <thead><tr><th>If…</th><th>Then</th><th className="num">Orders</th><th className="num">Purity</th></tr></thead>
              <tbody>{tree.rules.map((r, i) => <tr key={i}><td>{r.if}</td><td><span className={'tag ' + (r.then === 'Yes' ? 'default' : 'repaired')}>{r.then}</span></td><td className="num">{r.n}</td><td className="num">{fmtPct(r.purity, 0)}</td></tr>)}</tbody>
            </table></div>
            <h3 style={{ marginTop: 14 }}>Attribute importance</h3>
            {tree.importance.filter((i) => i.share > 0.001).map((i) => <div className="bar-row" key={i.name}><span>{i.name}</span><div><i style={{ width: i.share * 100 + '%' }} /></div><b>{fmtPct(i.share, 0)}</b></div>)}
            <h3 style={{ marginTop: 14 }}>Confusion matrix</h3>
            <table className="tbl compact conf"><thead><tr><th /><th className="num">Predicted Yes</th><th className="num">Predicted No</th></tr></thead>
              <tbody><tr><th>Actual Yes</th><td className="num ok-cell">{tree.test.tp}</td><td className="num">{tree.test.fn}</td></tr><tr><th>Actual No</th><td className="num">{tree.test.fp}</td><td className="num ok-cell">{tree.test.tn}</td></tr></tbody></table>
          </div>
        </div>
      )}

      {tab === 'anomaly' && (
        <div className="grid-2">
          <figure className="panel chart">
            <figcaption><h3>Sales by weekday</h3><p>{busiest.day} is the busiest day ({fmtMoney(busiest.sales)}); {quietest.day} the quietest ({fmtMoney(quietest.sales)}).</p></figcaption>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={weekday} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={COLORS.grid} vertical={false} /><XAxis dataKey="day" /><YAxis tickFormatter={fmtCompactMoney} width={56} />
                <Tooltip formatter={(v) => fmtMoney(v)} /><Bar dataKey="sales" name="Sales" radius={[3, 3, 0, 0]}>{weekday.map((w) => <Cell key={w.day} fill={w.day === busiest.day ? COLORS.amber : COLORS.primary} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </figure>
          <div className="panel">
            <h3>Unusual days</h3>
            {an.flaggedDays.length === 0 ? <p className="op-note">No day is that far from normal: daily sales average {fmtMoney(an.meanDaily)} (± {fmtMoney(an.sdDaily)}) over {an.days} trading days.</p> : (
              <table className="tbl compact"><thead><tr><th>Date</th><th className="num">Sales</th><th className="num">Orders</th><th className="num">z-score</th></tr></thead>
                <tbody>{an.flaggedDays.map((x) => <tr key={x.date}><td>{x.date}</td><td className="num">{fmtMoney(x.sales)}</td><td className="num">{x.orders}</td><td className={'num ' + (x.z > 0 ? 'up' : 'down')}>{x.z.toFixed(2)}</td></tr>)}</tbody></table>)}
          </div>
          <div className="panel span-2">
            <h3>Unusually large orders <small>{an.orderOutliers} orders above the IQR fence of {fmtMoney(an.orderFence)}</small></h3>
            {an.bigOrders.length === 0 ? <p className="op-note">No order exceeds the fence.</p> : (
              <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th>Order</th><th>Date</th><th>Product</th><th>Store</th><th className="num">Qty</th><th className="num">Sales</th></tr></thead>
                <tbody>{an.bigOrders.map((o) => <tr key={o.id}><td>{o.id}</td><td>{o.date}</td><td>{o.product}</td><td>{o.store}</td><td className="num">{o.qty}</td><td className="num">{fmtMoney(o.sales)}</td></tr>)}</tbody></table></div>)}
          </div>
        </div>
      )}

      {tab === 'corr' && (
        <div className="panel">
          <h3>Correlation matrix</h3>
          <Heat c={cor} />
          <p className="insight">Discount and margin: r = {discMargin.toFixed(2)}.</p>
        </div>
      )}

      {tab === 'assoc' && (
        <div className="panel note-card warn"><h3>Association rules not applicable</h3><p>Every order has one product and there is no customer ID, so no basket rules can be mined.</p></div>
      )}
    </section>
  );
}
