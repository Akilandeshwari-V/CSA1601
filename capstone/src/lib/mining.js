// Lightweight in-browser data-mining routines (pattern analysis, product analysis, sales prediction).
// They mirror docs/python/mining_validation.py so the results can be cross-checked.
import { MONTH_NAMES } from './olap.js';

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function monthlySeries(rows) {
  const map = new Map();
  for (const r of rows) {
    const k = r.year * 12 + (r.month - 1);
    const e = map.get(k) || { k, year: r.year, month: r.month, sales: 0, profit: 0, qty: 0 };
    e.sales += r.sales; e.profit += r.profit; e.qty += r.qty;
    map.set(k, e);
  }
  const arr = [...map.values()].sort((a, b) => a.k - b.k);
  return arr.map((e) => ({ ...e, label: `${MONTH_NAMES[e.month - 1]} ${e.year}` }));
}

/** Ordinary least squares trend on the monthly sales series + forecast. */
export function forecastSales(rows, horizon = 3) {
  const series = monthlySeries(rows);
  const n = series.length;
  if (n < 3) return { series, fit: null, forecast: [] };
  const ys = series.map((s) => s.sales);
  const xs = ys.map((_, i) => i);
  const mx = (n - 1) / 2;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, sst = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; sst += (ys[i] - my) ** 2; }
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const pred = xs.map((x) => intercept + slope * x);
  const sse = ys.reduce((a, y, i) => a + (y - pred[i]) ** 2, 0);
  const r2 = sst === 0 ? 0 : 1 - sse / sst;
  const se = Math.sqrt(sse / Math.max(1, n - 2));
  const last = series[n - 1].k;
  const forecast = Array.from({ length: horizon }, (_, h) => {
    const k = last + h + 1;
    const month = (k % 12) + 1;
    const year = Math.floor(k / 12);
    return { label: `${MONTH_NAMES[month - 1]} ${year}`, sales: intercept + slope * (n + h), low: intercept + slope * (n + h) - 1.96 * se, high: intercept + slope * (n + h) + 1.96 * se };
  });
  return { series: series.map((s, i) => ({ ...s, trend: pred[i] })), fit: { slope, intercept, r2, se, n }, forecast };
}

export function weekdayPattern(rows) {
  const out = WEEKDAYS.map((d) => ({ day: d, sales: 0, orders: 0 }));
  for (const r of rows) { out[r.weekday].sales += r.sales; out[r.weekday].orders++; }
  return out.map((o) => ({ ...o, avgOrder: o.orders ? o.sales / o.orders : 0 }));
}

/** Pareto / ABC analysis: A = first 80% of revenue, B = next 15%, C = last 5% (cumulative share before the item). */
export function abcAnalysis(rows) {
  const map = new Map();
  for (const r of rows) {
    const e = map.get(r.product) || { product: r.product, category: r.category, sales: 0, profit: 0, qty: 0 };
    e.sales += r.sales; e.profit += r.profit; e.qty += r.qty;
    map.set(r.product, e);
  }
  const list = [...map.values()].sort((a, b) => b.sales - a.sales);
  const total = list.reduce((a, b) => a + b.sales, 0);
  let cum = 0;
  return list.map((p) => {
    const before = cum / total;
    cum += p.sales;
    return { ...p, share: p.sales / total, cumShare: cum / total, cls: before < 0.8 ? 'A' : before < 0.95 ? 'B' : 'C', margin: p.profit / p.sales };
  });
}

/** K-means on standardised product features. Deterministic farthest-first initialisation (no randomness). */
export function kmeansProducts(rows, k = 3) {
  const base = abcAnalysis(rows).map((p) => ({ ...p, unitPrice: p.sales / p.qty }));
  if (base.length < k) return { points: base, clusters: [], features: [] };
  const feats = ['sales', 'margin', 'unitPrice'];
  const mean = feats.map((f) => base.reduce((a, p) => a + p[f], 0) / base.length);
  const sd = feats.map((f, i) => Math.sqrt(base.reduce((a, p) => a + (p[f] - mean[i]) ** 2, 0) / base.length) || 1);
  const X = base.map((p) => feats.map((f, i) => (p[f] - mean[i]) / sd[i]));
  const dist = (a, b) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);
  const centroids = [X[0].slice()];
  while (centroids.length < k) {
    let best = -1, bd = -1;
    X.forEach((x, i) => { const d = Math.min(...centroids.map((c) => dist(x, c))); if (d > bd) { bd = d; best = i; } });
    centroids.push(X[best].slice());
  }
  let labels = new Array(X.length).fill(-1);
  for (let it = 0; it < 100; it++) {
    const next = X.map((x) => { let b = 0, bd = Infinity; centroids.forEach((c, ci) => { const d = dist(x, c); if (d < bd) { bd = d; b = ci; } }); return b; });
    if (next.every((l, i) => l === labels[i])) break;
    labels = next;
    centroids.forEach((c, ci) => {
      const m = X.filter((_, i) => labels[i] === ci);
      if (m.length) c.forEach((_, d) => { c[d] = m.reduce((a, x) => a + x[d], 0) / m.length; });
    });
  }
  const order = centroids.map((c, ci) => ({ ci, s: c[0] })).sort((a, b) => b.s - a.s).map((o) => o.ci);
  const names = ['High-revenue products', 'Mid-revenue products', 'Long-tail products', 'Cluster 4', 'Cluster 5'];
  const clusters = order.map((ci, rank) => {
    const members = base.filter((_, i) => labels[i] === ci);
    const sum = (f) => members.reduce((a, p) => a + p[f], 0);
    return { id: rank + 1, name: names[rank] || `Cluster ${rank + 1}`, size: members.length, avgSales: sum('sales') / members.length,
      avgMargin: sum('profit') / sum('sales'), avgUnitPrice: sum('sales') / sum('qty'), members: members.map((m) => m.product) };
  });
  const rankOf = new Map(order.map((ci, r) => [ci, r + 1]));
  return { points: base.map((p, i) => ({ ...p, cluster: rankOf.get(labels[i]) })), clusters, features: feats };
}

/** Plain-language insights computed from the data (used by the report page). */
export function buildInsights(rows) {
  if (!rows.length) return [];
  const sum = (arr, f) => arr.reduce((a, r) => a + r[f], 0);
  const group = (key) => {
    const m = new Map();
    for (const r of rows) { const e = m.get(r[key]) || { name: r[key], sales: 0, profit: 0, qty: 0 }; e.sales += r.sales; e.profit += r.profit; e.qty += r.qty; m.set(r[key], e); }
    return [...m.values()];
  };
  const top = (arr, f) => arr.reduce((a, b) => (b[f] > a[f] ? b : a));
  const low = (arr, f) => arr.reduce((a, b) => (b[f] < a[f] ? b : a));
  const cat = group('category'), store = group('store'), city = group('city');
  const series = monthlySeries(rows);
  const total = sum(rows, 'sales');
  const catMargin = cat.map((c) => ({ ...c, m: c.profit / c.sales }));
  const out = [];
  const tc = top(cat, 'sales');
  out.push({ title: 'Leading category', text: `${tc.name} brings in ${(tc.sales / total * 100).toFixed(1)}% of all sales.` });
  const ts = top(store, 'sales'), ls = low(store, 'sales');
  out.push({ title: 'Store performance', text: `${ts.name} has the highest sales; ${ls.name} has the lowest (${((ts.sales / ls.sales - 1) * 100).toFixed(1)}% gap).` });
  const tcity = top(city, 'sales');
  out.push({ title: 'Top city', text: `${tcity.name} is the highest-selling city.` });
  if (series.length) {
    const bm = top(series, 'sales'), wm = low(series, 'sales');
    out.push({ title: 'Seasonality', text: `${bm.label} is the strongest month and ${wm.label} the weakest.` });
  }
  const bm2 = top(catMargin, 'm'), wm2 = low(catMargin, 'm');
  out.push({ title: 'Margins', text: `${bm2.name} has the best profit margin (${(bm2.m * 100).toFixed(1)}%); ${wm2.name} the lowest (${(wm2.m * 100).toFixed(1)}%).` });
  return out;
}
