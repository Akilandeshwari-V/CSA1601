// Report builder: turns the cleaned rows into one plain object that the Reports page, the PDF writer and the CSV export all share.
// Pure functions only (no DOM, no Node APIs), so the same numbers appear on screen, in the PDF and in the CSV.
import { groupBy, kpis, bySalesDesc } from './stats.js';
import { fmtMoney, fmtInt, fmtPct, toCSV } from './format.js';

export const SCOPES = [
  { id: 'latest', label: 'Latest day', hint: 'The most recent date in the data (use this for “today’s sales”)' },
  { id: '7d', label: 'Last 7 days', hint: '7 days ending on the latest date' },
  { id: '30d', label: 'Last 30 days', hint: '30 days ending on the latest date' },
  { id: 'month', label: 'Latest month', hint: 'From the 1st of the latest month to the latest date' },
  { id: 'all', label: 'Entire dataset', hint: 'Every valid order' },
  { id: 'custom', label: 'Custom range', hint: 'Pick your own dates' },
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---------------------------------------------------------------- dates (ISO strings, UTC arithmetic)
const toUTC = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const fromUTC = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (iso, n) => fromUTC(toUTC(iso) + n * 86400000);
export const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86400000) + 1; // inclusive
const dayLabel = (iso) => `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
const shortDay = (iso) => `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]}`;

/** Work out the date window. Relative scopes count back from the newest date in the data, not from the computer clock. */
export function resolvePeriod(rows, { scope = 'latest', from, to } = {}) {
  if (!rows.length) return { from: null, to: null, days: 0, label: 'No data', scope };
  let min = rows[0].date, max = rows[0].date;
  for (const r of rows) { if (r.date < min) min = r.date; if (r.date > max) max = r.date; }
  let f = min, t = max;
  if (scope === 'latest') f = t = max;
  else if (scope === '7d') f = addDays(max, -6);
  else if (scope === '30d') f = addDays(max, -29);
  else if (scope === 'month') f = max.slice(0, 8) + '01';
  else if (scope === 'custom') { f = from || min; t = to || max; if (f > t) [f, t] = [t, f]; }
  if (scope === 'custom' && (t < min || f > max)) return { from: null, to: null, days: 0, label: `${dayLabel(f)} to ${dayLabel(t)} (outside the data: ${dayLabel(min)} to ${dayLabel(max)})`, scope, dataMin: min, dataMax: max, outside: true };
  if (f < min) f = min;
  if (t > max) t = max;
  const days = daysBetween(f, t);
  const label = f === t ? dayLabel(f) : `${dayLabel(f)} to ${dayLabel(t)}`;
  return { from: f, to: t, days, label, scope, dataMin: min, dataMax: max };
}

const pctChange = (now, before) => (before > 0 ? (now - before) / before : null);
const signed = (v, d = 1) => (v == null ? 'n/a' : (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(d) + '%');

function ranked(rows, key, n, total) {
  const list = groupBy(rows, key).sort(bySalesDesc);
  const keep = list.length > n + 1 ? n : list.length; // never show an "Other (1)" bucket
  const head = list.slice(0, keep).map((e) => ({ ...e, share: total ? e.sales / total : 0 }));
  if (list.length > keep) {
    const tail = list.slice(keep);
    const o = tail.reduce((a, e) => ({ sales: a.sales + e.sales, profit: a.profit + e.profit, qty: a.qty + e.qty, orders: a.orders + e.orders }), { sales: 0, profit: 0, qty: 0, orders: 0 });
    head.push({ name: `Other (${tail.length})`, ...o, margin: o.sales ? o.profit / o.sales : 0, share: total ? o.sales / total : 0 });
  }
  return head;
}

/**
 * buildReport(rows, { scope, from, to }, { name, quality, now })
 * rows: cleaned rows of the active dataset. Returns everything needed to draw the report.
 */
export function buildReport(allRows, opts = {}, meta = {}) {
  const period = resolvePeriod(allRows, opts);
  const rows = period.from ? allRows.filter((r) => r.date >= period.from && r.date <= period.to) : [];
  const k = kpis(rows);
  const generatedAt = meta.now || new Date().toISOString();

  // previous window of the same length directly before this one (not offered for the entire dataset)
  let previous = null;
  if (period.from && period.scope !== 'all') {
    const pTo = addDays(period.from, -1), pFrom = addDays(pTo, -(period.days - 1));
    const pRows = allRows.filter((r) => r.date >= pFrom && r.date <= pTo);
    if (pRows.length) previous = { from: pFrom, to: pTo, label: pFrom === pTo ? dayLabel(pFrom) : `${shortDay(pFrom)} to ${shortDay(pTo)}`, kpis: kpis(pRows) };
  }
  const deltas = previous ? {
    sales: pctChange(k.sales, previous.kpis.sales), profit: pctChange(k.profit, previous.kpis.profit), qty: pctChange(k.qty, previous.kpis.qty),
    orders: pctChange(k.orders, previous.kpis.orders), aov: pctChange(k.aov, previous.kpis.aov), marginPts: k.margin - previous.kpis.margin,
  } : null;

  // trend: per day for up to ~62 days, otherwise per month
  const useMonths = period.days > 62;
  const tr = groupBy(rows, (r) => (useMonths ? r.date.slice(0, 7) : r.date)).sort((a, b) => (a.name < b.name ? -1 : 1));
  const trend = { grain: useMonths ? 'month' : 'day', points: tr.map((e) => ({ key: e.name, label: useMonths ? `${MONTHS[+e.name.slice(5, 7) - 1]} ${e.name.slice(2, 4)}` : shortDay(e.name), sales: e.sales, profit: e.profit, orders: e.orders })) };

  const categories = ranked(rows, (r) => r.category, 8, k.sales);
  const stores = ranked(rows, (r) => r.store, 8, k.sales);
  const cities = ranked(rows, (r) => r.city, 8, k.sales);
  const payments = ranked(rows, (r) => r.payment, 6, k.sales);
  const customers = ranked(rows, (r) => r.customer, 6, k.sales);

  const prods = groupBy(rows, (r) => r.product);
  const topProducts = [...prods].sort((a, b) => b.profit - a.profit).slice(0, 5);
  const bottomProducts = [...prods].filter((p) => p.profit < 0).sort((a, b) => a.profit - b.profit).slice(0, 5);
  const lossMakers = { count: prods.filter((p) => p.profit < 0).length, loss: prods.filter((p) => p.profit < 0).reduce((s, p) => s + p.profit, 0) };

  const weekdays = period.days >= 14 ? WEEKDAYS.map((n, i) => {
    const sub = rows.filter((r) => r.weekday === i); const e = kpis(sub);
    return { name: n, sales: e.sales, orders: e.orders, avg: sub.length ? e.sales / new Set(sub.map((r) => r.date)).size : 0 };
  }) : [];

  // discount effect (needs both sides to have a few orders)
  let discount = null;
  const withD = rows.filter((r) => r.discount != null);
  const hi = kpis(withD.filter((r) => r.discount >= 20)), lo = kpis(withD.filter((r) => r.discount < 20));
  if (hi.orders >= 5 && lo.orders >= 5) discount = { highMargin: hi.margin, lowMargin: lo.margin, highOrders: hi.orders, lowOrders: lo.orders };

  const quality = meta.quality ? { accepted: meta.quality.accepted, rejected: meta.quality.rejected, repaired: meta.quality.repairedRows, totalRead: meta.quality.totalRead } : null;
  const dayTotals = useMonths ? groupBy(rows, (r) => r.date) : tr;
  const bestDay = dayTotals.length > 1 ? [...dayTotals].sort(bySalesDesc)[0] : null;

  const report = {
    title: period.scope === 'latest' ? 'Daily sales report' : period.scope === 'all' ? 'Sales analysis report' : 'Sales performance report',
    generatedAt, dataset: { name: meta.name || 'Dataset', rows: allRows.length, from: period.dataMin || null, to: period.dataMax || null },
    period, previous, kpis: k, deltas, trend, categories, stores, cities, payments, customers, topProducts, bottomProducts, lossMakers, weekdays, discount, bestDay, quality,
    empty: rows.length === 0, insights: [],
  };
  report.insights = buildInsights(report);
  return report;
}

function buildInsights(r) {
  if (r.empty) return ['There are no orders in this period. Pick another date range.'];
  const out = [];
  const k = r.kpis, d = r.deltas;
  const cmp = d && d.sales != null ? `, ${d.sales >= 0 ? 'up' : 'down'} ${Math.abs(d.sales * 100).toFixed(1)}% compared with ${r.previous.label}` : r.period.scope === 'all' ? '' : ', with no earlier period in the data to compare against';
  out.push(`Sales were ${fmtMoney(k.sales)} from ${fmtInt(k.orders)} order lines${cmp}.`);
  out.push(`Profit was ${fmtMoney(k.profit)} at a ${fmtPct(k.margin)} margin${d ? ` (${d.marginPts >= 0 ? 'up' : 'down'} ${Math.abs(d.marginPts * 100).toFixed(1)} percentage points)` : ''}.`);
  const c = r.categories[0];
  if (c) out.push(`${c.name} is the biggest category with ${fmtPct(c.share, 0)} of sales${c.margin < k.margin ? `, but its margin (${fmtPct(c.margin)}) is below the overall ${fmtPct(k.margin)}` : ` and a ${fmtPct(c.margin)} margin`}.`);
  const real = r.stores.filter((s) => !s.name.startsWith('Other ('));
  if (real.length > 1) { const best = real[0], worst = real[real.length - 1]; out.push(`${best.name} leads the locations with ${fmtMoney(best.sales)}; ${worst.name} is the lowest of the top group at ${fmtMoney(worst.sales)}.`); }
  const tp = r.topProducts[0];
  if (tp) out.push(`The most profitable product is ${tp.name} (${fmtMoney(tp.profit)} profit on ${fmtInt(tp.qty)} units).`);
  if (r.lossMakers.count) out.push(`${r.lossMakers.count} product${r.lossMakers.count > 1 ? 's' : ''} sold at a loss, costing ${fmtMoney(Math.abs(r.lossMakers.loss))} in total. Review their pricing.`);
  if (r.discount) out.push(`Orders discounted 20% or more earned a ${fmtPct(r.discount.highMargin)} margin against ${fmtPct(r.discount.lowMargin)} for lighter or no discounts.`);
  if (r.bestDay) out.push(`${r.trend.grain === 'day' ? 'The best day' : 'The best day overall'} was ${dayLabel(r.bestDay.name)} with ${fmtMoney(r.bestDay.sales)}.`);
  if (r.weekdays.length) { const w = [...r.weekdays].sort((a, b) => b.avg - a.avg)[0]; if (w.avg > 0) out.push(`${w.name}s are the strongest weekday (average ${fmtMoney(w.avg)} per trading day).`); }
  if (r.quality && r.quality.rejected) out.push(`${fmtInt(r.quality.rejected)} of ${fmtInt(r.quality.totalRead)} source rows were rejected and are not counted.`);
  return out;
}

/** One flat CSV (opens cleanly in Excel): Section, Item and the same measures on every row. */
export function reportCSV(r) {
  const cols = ['Section', 'Item', 'Sales', 'Profit', 'Margin_%', 'Quantity', 'Orders', 'Share_of_sales_%', 'Change_vs_previous_%'];
  const rnd = (v) => Math.round(v * 100) / 100;
  const line = (section, item, e, extra = {}) => ({ Section: section, Item: item, Sales: rnd(e.sales), Profit: rnd(e.profit), 'Margin_%': e.sales ? rnd((e.profit / e.sales) * 100) : '', Quantity: e.qty, Orders: e.orders, ...extra });
  const rows = [];
  rows.push({ Section: 'Report', Item: `${r.title}: ${r.period.label} (${r.dataset.name})` });
  if (!r.empty) {
    rows.push(line('Summary', 'Selected period', r.kpis, { 'Change_vs_previous_%': r.deltas?.sales != null ? rnd(r.deltas.sales * 100) : '' }));
    if (r.previous) rows.push(line('Summary', `Previous period (${r.previous.label})`, r.previous.kpis));
    for (const [sec, list] of [['Category', r.categories], ['Store', r.stores], ['City', r.cities], ['Payment', r.payments], ['Customer type', r.customers]])
      for (const e of list) rows.push(line(sec, e.name, e, { 'Share_of_sales_%': rnd(e.share * 100) }));
    for (const e of r.topProducts) rows.push(line('Top products by profit', e.name, e));
    for (const e of r.bottomProducts) rows.push(line('Loss-making products', e.name, e));
    for (const p of r.trend.points) rows.push(line(r.trend.grain === 'day' ? 'Daily trend' : 'Monthly trend', p.key, { sales: p.sales, profit: p.profit, qty: '', orders: p.orders }));
    for (const w of r.weekdays) rows.push({ Section: 'Weekday', Item: w.name, Sales: rnd(w.sales), Orders: w.orders });
  }
  r.insights.forEach((t, i) => rows.push({ Section: 'Insight', Item: `${i + 1}. ${t}` }));
  return toCSV(cols, rows);
}

export const reportFileName = (r, ext) => `smartdmart_${r.period.scope === 'latest' ? 'daily' : r.period.scope}_report_${r.period.to || 'empty'}.${ext}`;
