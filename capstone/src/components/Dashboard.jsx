import { useMemo } from 'react';
import { ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';
import { COLORS } from '../theme.js';
import { groupBy, kpis, bySalesDesc } from '../lib/stats.js';
import { monthlySeries } from '../lib/mining.js';
import { fmtMoney, fmtCompactMoney, fmtInt, fmtPct } from '../lib/format.js';
import CountUp from './CountUp.jsx';

const money = (v) => fmtMoney(v);
// Keep charts readable on big datasets: the biggest n entries plus one "Other" bar.
function topN(list, n) {
  if (list.length <= n) return list;
  const head = list.slice(0, n - 1), tail = list.slice(n - 1);
  const o = tail.reduce((a, e) => ({ ...a, sales: a.sales + e.sales, profit: a.profit + e.profit, qty: a.qty + e.qty, orders: a.orders + e.orders }), { name: `Other (${tail.length})`, sales: 0, profit: 0, qty: 0, orders: 0 });
  return [...head, { ...o, margin: o.sales ? o.profit / o.sales : 0 }];
}
const axisMoney = (v) => fmtCompactMoney(v);

function Card({ title, note, children, className = '' }) {
  return (
    <figure className={'panel chart ' + className}>
      <figcaption><h3>{title}</h3>{note && <p>{note}</p>}</figcaption>
      <div className="chart-body">{children}</div>
    </figure>
  );
}

function Kpi({ label, num, fmt, sub, tone }) {
  return (
    <div className={'kpi ' + (tone || '')}>
      <span>{label}</span>
      <b><CountUp value={num} format={fmt} /></b>
      {sub && <small>{sub}</small>}
    </div>
  );
}

export default function Dashboard({ rows }) {
  const k = useMemo(() => kpis(rows), [rows]);
  const monthly = useMemo(() => monthlySeries(rows), [rows]);
  const byCategory = useMemo(() => topN(groupBy(rows, (r) => r.category).sort(bySalesDesc), 12), [rows]);
  const byStore = useMemo(() => topN(groupBy(rows, (r) => r.store).sort(bySalesDesc), 12), [rows]);
  const byCity = useMemo(() => topN(groupBy(rows, (r) => r.city).sort(bySalesDesc), 12), [rows]);
  const byProduct = useMemo(() => groupBy(rows, (r) => r.product), [rows]);
  const byPay = useMemo(() => topN(groupBy(rows, (r) => r.payment).sort(bySalesDesc), 8), [rows]);
  const byCust = useMemo(() => topN(groupBy(rows, (r) => r.customer).sort(bySalesDesc), 8), [rows]);
  const byDiscount = useMemo(
    () => groupBy(rows.filter((r) => r.discount != null), (r) => r.discount).sort((a, b) => a.name - b.name).map((d) => ({ ...d, label: d.name + '%' })),
    [rows],
  );
  const marginByCat = useMemo(() => [...byCategory].sort((a, b) => b.margin - a.margin), [byCategory]);
  const topProfit = useMemo(() => [...byProduct].sort((a, b) => b.profit - a.profit), [byProduct]);

  if (!rows.length) return <section className="panel empty">No orders match the current filters. Clear a filter to see the dashboard.</section>;

  return (
    <section className="dash" aria-label="Dashboard">
      <div className="kpis">
        <Kpi label="Total Sales" num={k.sales} fmt={fmtMoney} sub={`${fmtInt(k.orders)} orders`} tone="main" />
        <Kpi label="Total Profit" num={k.profit} fmt={fmtMoney} sub={`${fmtPct(k.margin)} margin`} />
        <Kpi label="Total Quantity" num={k.qty} fmt={fmtInt} sub="units sold" />
        <Kpi label="Average order value" num={k.aov} fmt={fmtMoney} sub="sales ÷ orders" />
      </div>

      <div className="grid-2">
        <Card title="Sales and profit by month" className="span-2">
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={monthly} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={COLORS.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} interval={0} angle={-30} textAnchor="end" height={52} />
              <YAxis tickFormatter={axisMoney} tick={{ fontSize: 12 }} width={56} />
              <Tooltip formatter={(v, n) => [money(v), n]} />
              <Legend verticalAlign="top" height={28} />
              <Bar dataKey="sales" name="Sales" fill={COLORS.primary} radius={[3, 3, 0, 0]} />
              <Line dataKey="profit" name="Profit" stroke={COLORS.amber} strokeWidth={3} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Sales by category">
          <ResponsiveContainer width="100%" height={Math.max(240, byCategory.length * 34)}>
            <BarChart data={byCategory} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid stroke={COLORS.grid} horizontal={false} />
              <XAxis type="number" tickFormatter={axisMoney} tick={{ fontSize: 12 }} />
              <YAxis type="category" dataKey="name" width={96} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v) => money(v)} />
              <Bar dataKey="sales" name="Sales" fill={COLORS.primary} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Sales and profit by store">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={byStore} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={COLORS.grid} vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} interval={0} />
              <YAxis tickFormatter={axisMoney} tick={{ fontSize: 12 }} width={56} />
              <Tooltip formatter={(v, n) => [money(v), n]} />
              <Legend verticalAlign="top" height={28} />
              <Bar dataKey="sales" name="Sales" fill={COLORS.primary} radius={[3, 3, 0, 0]} />
              <Bar dataKey="profit" name="Profit" fill={COLORS.amber} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Sales by city">
          <ResponsiveContainer width="100%" height={Math.max(240, byCity.length * 30)}>
            <BarChart data={byCity} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid stroke={COLORS.grid} horizontal={false} />
              <XAxis type="number" tickFormatter={axisMoney} tick={{ fontSize: 12 }} />
              <YAxis type="category" dataKey="name" width={96} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v) => money(v)} />
              <Bar dataKey="sales" name="Sales" fill={COLORS.teal} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Profit margin by category">
          <ResponsiveContainer width="100%" height={Math.max(240, marginByCat.length * 34)}>
            <BarChart data={marginByCat} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid stroke={COLORS.grid} horizontal={false} />
              <XAxis type="number" tickFormatter={(v) => (v * 100).toFixed(0) + '%'} tick={{ fontSize: 12 }} />
              <YAxis type="category" dataKey="name" width={96} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v) => fmtPct(v)} />
              <Bar dataKey="margin" name="Margin" fill={COLORS.amber} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {byDiscount.length > 1 && byDiscount.length <= 20 && (
          <Card title="Discount level vs profit margin">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byDiscount} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={COLORS.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={(v) => (v * 100).toFixed(0) + '%'} tick={{ fontSize: 12 }} width={44} />
                <Tooltip formatter={(v, n, p) => [fmtPct(v), `Margin (${p.payload.orders} orders)`]} />
                <Bar dataKey="margin" fill={COLORS.red} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}

        <Card title="Payment method">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={byPay} dataKey="sales" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                {byPay.map((_, i) => <Cell key={i} fill={COLORS.series[i % COLORS.series.length]} />)}
              </Pie>
              <Tooltip formatter={(v) => money(v)} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Customer type">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={byCust} dataKey="sales" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                {byCust.map((_, i) => <Cell key={i} fill={COLORS.series[(i + 3) % COLORS.series.length]} />)}
              </Pie>
              <Tooltip formatter={(v) => money(v)} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <figure className="panel chart span-2">
          <figcaption><h3>Profit analysis by product</h3></figcaption>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Product</th><th className="num">Sales</th><th className="num">Profit</th><th className="num">Margin</th><th className="num">Qty</th></tr></thead>
              <tbody>
                {[...topProfit.slice(0, 5), ...(topProfit.length > 10 ? [null] : []), ...topProfit.slice(-5).reverse()].map((p, i) => p ? (
                  <tr key={p.name}><td>{p.name}</td><td className="num">{fmtMoney(p.sales)}</td><td className="num">{fmtMoney(p.profit)}</td><td className="num">{fmtPct(p.margin)}</td><td className="num">{fmtInt(p.qty)}</td></tr>
                ) : <tr key={'gap' + i} className="gap"><td colSpan={5}>⋯ lowest-profit products ⋯</td></tr>)}
              </tbody>
            </table>
          </div>
        </figure>
      </div>
    </section>
  );
}
