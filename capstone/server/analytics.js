// Server-side analytics: forecasting (with back-testing), anomaly detection, correlations, decision tree.
// Pure functions on the cleaned rows so they can be unit-tested without HTTP.
import { monthlySeries } from '../src/lib/mining.js';
import { MONTH_NAMES } from '../src/lib/olap.js';

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };

// ------------------------------------------------------------------ forecasting
function filledSeries(rows) {
  const s = monthlySeries(rows);
  if (!s.length) return [];
  const byK = new Map(s.map((e) => [e.k, e]));
  const out = [];
  for (let k = s[0].k; k <= s[s.length - 1].k; k++) {
    const e = byK.get(k);
    const month = (k % 12) + 1, year = Math.floor(k / 12);
    out.push({ k, label: `${MONTH_NAMES[month - 1]} ${year}`, sales: e ? e.sales : 0, profit: e ? e.profit : 0, qty: e ? e.qty : 0 });
  }
  return out;
}
const labelAfter = (k) => `${MONTH_NAMES[k % 12]} ${Math.floor(k / 12)}`;

const MODELS = {
  naive: { name: 'Naive (last month repeated)', fit: (y) => ({ f: () => y[y.length - 1], fitted: y.map((_, i) => (i ? y[i - 1] : y[0])) }) },
  ma3: { name: '3-month moving average', fit: (y) => {
    const lvl = mean(y.slice(-3));
    return { f: () => lvl, fitted: y.map((_, i) => mean(y.slice(Math.max(0, i - 3), i)) || y[0]) };
  } },
  ses: { name: 'Exponential smoothing (SES)', fit: (y) => {
    let best = null;
    for (let a = 0.05; a <= 0.951; a += 0.05) {
      let l = y[0]; const fitted = [y[0]]; let sse = 0;
      for (let t = 1; t < y.length; t++) { fitted.push(l); sse += (y[t] - l) ** 2; l = a * y[t] + (1 - a) * l; }
      if (!best || sse < best.sse) best = { sse, a, l, fitted };
    }
    return { f: () => best.l, fitted: best.fitted, params: { alpha: +best.a.toFixed(2) } };
  } },
  holt: { name: 'Damped trend (Holt)', fit: (y) => {
    let best = null; const phi = 0.9;
    for (let a = 0.1; a <= 0.951; a += 0.1) for (let b = 0.05; b <= 0.451; b += 0.1) {
      let l = y[0], tr = y.length > 1 ? y[1] - y[0] : 0; const fitted = [y[0]]; let sse = 0;
      for (let t = 1; t < y.length; t++) {
        const pred = l + phi * tr; fitted.push(pred); sse += (y[t] - pred) ** 2;
        const nl = a * y[t] + (1 - a) * (l + phi * tr);
        tr = b * (nl - l) + (1 - b) * phi * tr; l = nl;
      }
      if (!best || sse < best.sse) best = { sse, a, b, l, tr, fitted };
    }
    return { f: (h) => { let s = 0; for (let i = 1; i <= h; i++) s += phi ** i; return best.l + s * best.tr; }, fitted: best.fitted, params: { alpha: +best.a.toFixed(2), beta: +best.b.toFixed(2), damping: phi } };
  } },
  linear: { name: 'Linear trend (OLS)', fit: (y) => {
    const n = y.length, mx = (n - 1) / 2, my = mean(y);
    let sxy = 0, sxx = 0;
    y.forEach((v, i) => { sxy += (i - mx) * (v - my); sxx += (i - mx) ** 2; });
    const b = sxy / sxx, a = my - b * mx;
    return { f: (h) => a + b * (n - 1 + h), fitted: y.map((_, i) => a + b * i), params: { slope: +b.toFixed(2), intercept: +a.toFixed(2) } };
  } },
};

export function forecast(rows, { horizon = 6, holdout = 3 } = {}) {
  const series = filledSeries(rows);
  const n = series.length;
  if (n < 6) return { ok: false, reason: 'At least 6 months of data are needed for back-testing.', series };
  const y = series.map((s) => s.sales);
  const ho = Math.min(holdout, Math.floor(n / 3));
  const results = Object.entries(MODELS).map(([id, m]) => {
    const train = y.slice(0, n - ho), test = y.slice(n - ho);
    const bt = m.fit(train);
    const errs = test.map((v, i) => v - bt.f(i + 1));
    const mae = mean(errs.map(Math.abs));
    const mape = mean(errs.map((e, i) => Math.abs(e) / (test[i] || 1)));
    const rmse = Math.sqrt(mean(errs.map((e) => e * e)));
    const full = m.fit(y);
    const resid = y.map((v, i) => v - full.fitted[i]).slice(1);
    const sigma = sd(resid);
    const fc = Array.from({ length: horizon }, (_, h) => {
      const v = Math.max(0, full.f(h + 1)), w = 1.96 * sigma * Math.sqrt(h + 1);
      return { label: labelAfter(series[n - 1].k + h + 1), value: v, low: Math.max(0, v - w), high: v + w };
    });
    return { id, name: m.name, params: full.params || {}, mae, mape, rmse, forecast: fc, fitted: full.fitted };
  });
  const best = [...results].sort((a, b) => a.mape - b.mape)[0];
  // honest check: does the best model beat "just repeat the average month"?
  const avgModelMape = (() => {
    const test = y.slice(n - ho), lvl = mean(y.slice(0, n - ho));
    return mean(test.map((v) => Math.abs(v - lvl) / (v || 1)));
  })();
  return { ok: true, series, holdout: ho, horizon, models: results, best: best.id, baselineMape: avgModelMape,
    note: best.mape >= avgModelMape * 0.95 ? 'No model clearly beats simply using the historical average month; treat forecasts as a baseline level.' : 'The selected model beats the historical-average baseline on the hold-out months.' };
}

// ------------------------------------------------------------------ anomalies
export function anomalies(rows) {
  const days = new Map();
  for (const r of rows) { const e = days.get(r.date) || { date: r.date, sales: 0, orders: 0 }; e.sales += r.sales; e.orders++; days.set(r.date, e); }
  const daily = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  const m = mean(daily.map((d) => d.sales)), s = sd(daily.map((d) => d.sales)) || 1;
  const flaggedDays = daily.map((d) => ({ ...d, z: (d.sales - m) / s })).filter((d) => Math.abs(d.z) >= 2.5).sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 10);
  const sorted = rows.map((r) => r.sales).sort((a, b) => a - b);
  const q = (p) => sorted[Math.floor(p * (sorted.length - 1))];
  const q1 = q(0.25), q3 = q(0.75), fence = q3 + 1.5 * (q3 - q1);
  const bigOrders = rows.filter((r) => r.sales > fence).sort((a, b) => b.sales - a.sales).slice(0, 10)
    .map((r) => ({ id: r.id, date: r.date, product: r.product, store: r.store, qty: r.qty, sales: r.sales }));
  return { days: daily.length, meanDaily: m, sdDaily: s, flaggedDays, orderFence: fence, orderOutliers: rows.filter((r) => r.sales > fence).length, bigOrders };
}

// ------------------------------------------------------------------ correlations
export function correlations(rows) {
  const fields = [
    ['Quantity', (r) => r.qty], ['Unit price', (r) => r.sales / r.qty], ['Discount %', (r) => r.discount ?? 0],
    ['Sales', (r) => r.sales], ['Profit', (r) => r.profit], ['Margin %', (r) => (r.profit / r.sales) * 100],
  ];
  const cols = fields.map(([, f]) => rows.map(f));
  const corr = (a, b) => {
    const ma = mean(a), mb = mean(b);
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
    return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
  };
  return { fields: fields.map(([n]) => n), matrix: cols.map((a) => cols.map((b) => corr(a, b))) };
}

// ------------------------------------------------------------------ decision tree (CART, Gini)
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const FEATURES = [
  { name: 'category', type: 'cat', get: (r) => r.category },
  { name: 'store', type: 'cat', get: (r) => r.store },
  { name: 'payment', type: 'cat', get: (r) => r.payment },
  { name: 'customer', type: 'cat', get: (r) => r.customer },
  { name: 'quantity', type: 'num', get: (r) => r.qty },
  { name: 'discount %', type: 'num', get: (r) => r.discount ?? 0 },
  { name: 'unit price', type: 'num', get: (r) => r.sales / r.qty },
];
const TARGETS = {
  highValue: { label: 'High-value order (sales in the top 25%)', make: (rows) => { const s = rows.map((r) => r.sales).sort((a, b) => a - b); const t = s[Math.floor(0.75 * (s.length - 1))]; return { f: (r) => (r.sales > t ? 1 : 0), note: `sales > ${t.toFixed(2)}` }; }, features: ['category', 'store', 'payment', 'customer', 'quantity', 'discount %'] },
  highMargin: { label: 'High-margin order (margin above the median)', make: (rows) => { const s = rows.map((r) => r.profit / r.sales).sort((a, b) => a - b); const t = s[Math.floor(0.5 * (s.length - 1))]; return { f: (r) => (r.profit / r.sales > t ? 1 : 0), note: `margin > ${(t * 100).toFixed(1)}%` }; }, features: ['category', 'store', 'payment', 'customer', 'quantity', 'discount %'] },
};
const gini = (p, n) => (n ? 1 - (p / n) ** 2 - (1 - p / n) ** 2 : 0);

export function decisionTree(rows, target = 'highValue', { maxDepth = 3, minLeaf = 15, seed = 42 } = {}) {
  const T = TARGETS[target] || TARGETS.highValue;
  const { f: label, note } = T.make(rows);
  const feats = FEATURES.filter((f) => T.features.includes(f.name));
  const rand = rng(seed);
  const idx = rows.map((_, i) => i).sort(() => rand() - 0.5);
  const cut = Math.floor(rows.length * 0.7);
  const train = idx.slice(0, cut).map((i) => rows[i]), test = idx.slice(cut).map((i) => rows[i]);
  const importance = Object.fromEntries(feats.map((f) => [f.name, 0]));

  const build = (data, depth) => {
    const n = data.length, pos = data.reduce((a, r) => a + label(r), 0);
    const node = { n, pos, pred: pos * 2 >= n ? 1 : 0 };
    if (depth >= maxDepth || n < minLeaf * 2 || pos === 0 || pos === n) return node;
    const base = gini(pos, n);
    let best = null;
    for (const f of feats) {
      const vals = [...new Set(data.map(f.get))].sort((a, b) => (f.type === 'num' ? a - b : String(a).localeCompare(String(b))));
      const cands = f.type === 'num' ? vals.slice(0, -1).map((v, i) => (v + vals[i + 1]) / 2) : vals;
      for (const c of cands) {
        let ln = 0, lp = 0;
        for (const r of data) { const yes = f.type === 'num' ? f.get(r) <= c : f.get(r) === c; if (yes) { ln++; lp += label(r); } }
        const rn = n - ln, rp = pos - lp;
        if (ln < minLeaf || rn < minLeaf) continue;
        const gain = base - (ln / n) * gini(lp, ln) - (rn / n) * gini(rp, rn);
        if (!best || gain > best.gain) best = { f, c, gain };
      }
    }
    if (!best || best.gain < 1e-4) return node;
    importance[best.f.name] += best.gain * n;
    const test1 = (r) => (best.f.type === 'num' ? best.f.get(r) <= best.c : best.f.get(r) === best.c);
    node.split = { feature: best.f.name, type: best.f.type, value: best.c, gain: best.gain };
    node.yes = build(data.filter(test1), depth + 1);
    node.no = build(data.filter((r) => !test1(r)), depth + 1);
    return node;
  };
  const tree = build(train, 0);
  const featByName = Object.fromEntries(feats.map((f) => [f.name, f]));
  const predict = (node, r) => {
    if (!node.split) return node.pred;
    const f = featByName[node.split.feature];
    const yes = f.type === 'num' ? f.get(r) <= node.split.value : f.get(r) === node.split.value;
    return predict(yes ? node.yes : node.no, r);
  };
  const evalSet = (set) => {
    const cm = { tp: 0, fp: 0, tn: 0, fn: 0 };
    for (const r of set) { const p = predict(tree, r), a = label(r); if (p && a) cm.tp++; else if (p && !a) cm.fp++; else if (!p && !a) cm.tn++; else cm.fn++; }
    return { ...cm, accuracy: (cm.tp + cm.tn) / set.length };
  };
  const majority = (set) => Math.max(set.reduce((a, r) => a + label(r), 0), set.length - set.reduce((a, r) => a + label(r), 0)) / set.length;
  const rules = [];
  const walk = (node, conds) => {
    if (!node.split) { rules.push({ if: conds.length ? conds.join(' AND ') : 'always', then: node.pred ? 'Yes' : 'No', n: node.n, purity: Math.max(node.pos, node.n - node.pos) / node.n }); return; }
    const s = node.split;
    const [y, no] = s.type === 'num' ? [`${s.feature} ≤ ${(+s.value).toFixed(2)}`, `${s.feature} > ${(+s.value).toFixed(2)}`] : [`${s.feature} = ${s.value}`, `${s.feature} ≠ ${s.value}`];
    walk(node.yes, [...conds, y]); walk(node.no, [...conds, no]);
  };
  walk(tree, []);
  const totalImp = Object.values(importance).reduce((a, b) => a + b, 0) || 1;
  const strip = (node) => ({ n: node.n, pos: node.pos, pred: node.pred, split: node.split && { feature: node.split.feature, type: node.split.type, value: node.split.value }, yes: node.yes && strip(node.yes), no: node.no && strip(node.no) });
  return { target, targetLabel: T.label, definition: note, trainSize: train.length, testSize: test.length, train: evalSet(train), test: evalSet(test), baselineTest: majority(test),
    importance: Object.entries(importance).map(([name, v]) => ({ name, share: v / totalImp })).sort((a, b) => b.share - a.share), rules, tree: strip(tree) };
}
export const TREE_TARGETS = Object.fromEntries(Object.entries(TARGETS).map(([k, v]) => [k, v.label]));
