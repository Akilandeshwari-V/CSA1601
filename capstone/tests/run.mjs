// Zero-dependency test-suite: node tests/run.mjs   (or: npm test)
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { cleanDataset, parseDate, parseNumber } from '../src/lib/pipeline.js';
import { parseCSV } from '../src/lib/csv.js';
import * as O from '../src/lib/olap.js';
import { buildStar, checkIntegrity, SCHEMA, buildSnowflake, SNOWFLAKE_SCHEMA, SNOWFLAKE_RELATIONSHIPS, checkModelIntegrity } from '../src/lib/star.js';
import { forecastSales, abcAnalysis, weekdayPattern, kmeansProducts, monthlySeries } from '../src/lib/mining.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const text = fs.readFileSync(path.join(dir, '../src/data/DMart_Dataset.csv'), 'utf8');
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log('  ok  ', name); } catch (e) { console.error('  FAIL', name, '\n', e.message); process.exitCode = 1; } };
const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);

const { rows, report } = cleanDataset(text);
const sum = (arr, f) => arr.reduce((a, r) => a + r[f], 0);

console.log('Data pipeline');
test('parses 1000 raw rows', () => assert.equal(report.totalRead, 1000));
test('rejects exactly the 6 invalid rows', () => {
  const ids = [...new Set(report.issues.filter((i) => i.action.startsWith('Rejected')).map((i) => i.orderId))].sort((a, b) => a - b);
  assert.deepEqual(ids, ['1', '10', '100', '150', '25', '40'].sort((a, b) => a - b));
  assert.equal(report.accepted, 994);
});
test('repairs 5 rows (spaces, category, brand, payment)', () => assert.equal(report.repairedRows, 5));
test('no city/product with stray spaces remains', () => rows.forEach((r) => { assert.equal(r.city, r.city.trim()); assert.ok(!/\s{2}/.test(r.product)); }));
test('Order 175 category repaired to Dairy; 125 -> Grocery/Aashirvaad; 70 brand -> Nescafe', () => {
  const g = (id) => rows.find((r) => r.id === id);
  assert.equal(g('175').category, 'Dairy');
  assert.equal(g('125').category, 'Grocery'); assert.equal(g('125').brand, 'Aashirvaad');
  assert.equal(g('70').brand, 'Nescafe');
  assert.equal(g('85').payment, 'Unknown');
});
test('KPIs match independent pandas run', () => {
  near(sum(rows, 'sales'), 748839.75); near(sum(rows, 'profit'), 165662.79); assert.equal(sum(rows, 'qty'), 4579);
});
test('date + number parsers', () => {
  assert.equal(parseDate('05-08-2025').iso, '2025-08-05'); assert.equal(parseDate('31-02-2025'), null);
  assert.equal(parseDate('+'), null); assert.equal(parseDate('2025/99/99'), null);
  assert.equal(parseNumber('1,234.5'), 1234.5); assert.ok(Number.isNaN(parseNumber('abc'))); assert.ok(Number.isNaN(parseNumber('+')));
});
test('CSV parser handles quotes and CRLF', () => {
  const p = parseCSV('a,b\r\n"x,1","he said ""hi"""\r\n');
  assert.deepEqual(p.records[0], { a: 'x,1', b: 'he said "hi"' });
});
test('missing required column raises a clear error', () => assert.throws(() => cleanDataset('Order_ID,Sales\n1,2'), /Missing required column/));

console.log('OLAP engine');
const base = O.initialState();
const totalsOf = (st) => O.aggregate(rows, st).totals;
test('default cube is 9 x 4 x 5 and totals equal the dataset', () => {
  const a = O.aggregate(rows, base);
  assert.deepEqual(a.grid, [9, 4, 5]);
  near(a.totals.sales, 748839.75); near(a.totals.profit, 165662.79); assert.equal(a.totals.qty, 4579);
  near(sum(a.cells, 'sales'), 748839.75);
});
test('roll-up preserves totals and reduces the cell count', () => {
  const before = O.aggregate(rows, base);
  const up = O.aggregate(rows, O.rollUp(base, 'time'));
  assert.equal(up.grid[1], 1); // Quarter -> Year = 1 member
  assert.ok(up.cells.length < before.cells.length);
  near(up.totals.sales, before.totals.sales);
});
test('roll-up to ALL gives a single member; cannot roll up past ALL', () => {
  let s = base; while (O.canRollUp(s, 'product')) s = O.rollUp(s, 'product');
  assert.equal(O.aggregate(rows, s).grid[0], 1); assert.equal(O.rollUp(s, 'product'), null);
});
test('drill-down preserves totals and increases detail; drill then roll returns the original cube', () => {
  const dd = O.drillDown(base, 'time');
  const a = O.aggregate(rows, dd); assert.equal(a.grid[1], 12);
  near(a.totals.sales, 748839.75);
  const back = O.aggregate(rows, O.rollUp(dd, 'time'));
  assert.deepEqual(back.cells.map((c) => [c.id, c.sales.toFixed(2)]), O.aggregate(rows, base).cells.map((c) => [c.id, c.sales.toFixed(2)]));
});
test('drill-down is blocked at the lowest level', () => {
  let s = base; while (O.canDrillDown(s, 'location')) s = O.drillDown(s, 'location');
  assert.equal(O.drillDown(s, 'location'), null); assert.equal(O.aggregate(rows, s).grid[2], 50);
});
test('slice: Store = DMart East matches a manual filter', () => {
  const s = O.slice(base, 'location', 1, 'DMart East');
  const a = O.aggregate(rows, s);
  const manual = rows.filter((r) => r.store === 'DMart East');
  assert.equal(a.grid[2], 1); near(a.totals.sales, sum(manual, 'sales')); assert.equal(a.orders, manual.length);
});
test('slice then drill-down stays inside the slice (Q2 -> Apr/May/Jun)', () => {
  const s = O.drillDown(O.slice(base, 'time', 2, '2025 › Q2'), 'time');
  const a = O.aggregate(rows, s);
  assert.deepEqual(a.axes[1].members.map((m) => m.label), ['Apr 2025', 'May 2025', 'Jun 2025']);
  near(a.totals.sales, sum(rows.filter((r) => r.quarter === 2), 'sales'));
});
test('dice on two dimensions matches a manual filter', () => {
  const s = O.dice(base, { product: { level: 1, keys: ['Grocery', 'Dairy'] }, location: { level: 1, keys: ['DMart East', 'DMart West'] } });
  const a = O.aggregate(rows, s);
  const manual = rows.filter((r) => ['Grocery', 'Dairy'].includes(r.category) && ['DMart East', 'DMart West'].includes(r.store));
  near(a.totals.sales, sum(manual, 'sales')); near(a.totals.profit, sum(manual, 'profit')); assert.deepEqual(a.grid.slice(0, 1).concat(a.grid[2]), [2, 2]);
});
test('pivot (swap, rotate, replace dimension) keeps the totals', () => {
  const sw = O.swapAxes(base, 0, 2); assert.deepEqual(sw.axes, ['location', 'time', 'product']);
  const ro = O.rotateAxes(base); assert.deepEqual(ro.axes, ['location', 'product', 'time']);
  const rep = O.setAxisDim(base, 2, 'payment'); assert.deepEqual(rep.axes, ['product', 'time', 'payment']);
  const dup = O.setAxisDim(base, 0, 'time'); assert.deepEqual(dup.axes, ['time', 'product', 'location']);
  for (const st of [sw, ro, rep, dup]) near(totalsOf(st).sales, 748839.75);
  assert.deepEqual(O.aggregate(rows, rep).grid, [9, 4, 5]); // Payment has Cash, Credit, Debit, UPI + Unknown = 5 members
});
test('every level of every dimension sums to the grand total', () => {
  for (const dim of O.DIM_ORDER) for (let l = 0; l < O.DIMS[dim].levels.length; l++) {
    const st = O.setLevel({ ...base, axes: [dim, dim === 'time' ? 'product' : 'time', dim === 'location' ? 'product' : 'location'] }, dim, l);
    near(O.aggregate(rows, st).totals.sales, 748839.75);
  }
});
test('duplicate brand labels are disambiguated (Tata under two categories)', () => {
  const m = O.listMembers(rows, 'product', 2).filter((x) => x.label.includes('Tata'));
  assert.equal(m.length, 2); assert.notEqual(m[0].label, m[1].label);
});
test('SQL generator produces joins, filters and GROUP BY', () => {
  const sql = O.toSQL(O.slice(O.drillDown(base, 'time'), 'time', 2, '2025 › Q2'));
  assert.match(sql, /JOIN DIM_DATE d/); assert.match(sql, /d\.Year = 2025 AND d\.Quarter = 2/); assert.match(sql, /GROUP BY p\.Category, d\.Year, d\.Month, s\.Store/);
});

console.log('Star schema');
const star = buildStar(rows);
test('table names and columns equal the draw.io file', () => {
  assert.deepEqual(Object.keys(SCHEMA), ['FACT_SALES', 'DIM_PRODUCT', 'DIM_DATE', 'DIM_STORE', 'DIM_PAYMENT', 'DIM_CUSTOMER_TYPE']);
  assert.deepEqual(SCHEMA.FACT_SALES.columns.map((c) => c.name), ['Sales_ID', 'Product_Key', 'Date_Key', 'Store_Key', 'Payment_Key', 'Customer_Type_Key', 'Quantity', 'Sales', 'Cost', 'Profit']);
  for (const [t, def] of Object.entries(SCHEMA)) assert.deepEqual(Object.keys(star[t][0]), def.columns.map((c) => c.name), t);
});
test('fact rows = accepted rows, no orphan foreign keys, fact totals match', () => {
  assert.equal(star.FACT_SALES.length, 994);
  checkIntegrity(star).forEach((c) => assert.ok(c.ok, c.key));
  near(sum(star.FACT_SALES, 'Sales'), 748839.75);
});
test('dimension sizes (20 products, <= 50 store-city pairs, 5 payment members incl. Unknown, 3 customer types)', () => {
  assert.equal(star.DIM_PRODUCT.length, 20); assert.equal(star.DIM_PAYMENT.length, 5); assert.equal(star.DIM_CUSTOMER_TYPE.length, 3);
  assert.ok(star.DIM_STORE.length <= 50);
});

console.log('Snowflake schema');
const snow = buildSnowflake(rows);
test('snowflake has 12 tables with the documented columns', () => {
  assert.equal(Object.keys(SNOWFLAKE_SCHEMA).length, 12);
  for (const [t, def] of Object.entries(SNOWFLAKE_SCHEMA)) assert.deepEqual(Object.keys(snow[t][0]), def.columns.map((c) => c.name), t);
});
test('snowflake dimension sizes (9 categories, 10 cities, 12 months, 4 quarters, 1 year)', () => {
  assert.equal(snow.DIM_CATEGORY.length, 9); assert.equal(snow.DIM_CITY.length, 10); assert.equal(snow.DIM_MONTH.length, 12);
  assert.equal(snow.DIM_QUARTER.length, 4); assert.equal(snow.DIM_YEAR.length, 1); assert.equal(snow.DIM_PRODUCT.length, 20); assert.equal(snow.DIM_STORE.length, star.DIM_STORE.length);
});
test('snowflake has no orphan keys across all 11 relationships', () => {
  const c = checkModelIntegrity(snow, SNOWFLAKE_RELATIONSHIPS); assert.equal(c.length, 11); c.forEach((x) => assert.ok(x.ok, x.from + '->' + x.to));
});
test('joining through the snowflake gives the same sales per category as the cleaned data', () => {
  const prod = new Map(snow.DIM_PRODUCT.map((p) => [p.Product_Key, p])), brand = new Map(snow.DIM_BRAND.map((b) => [b.Brand_Key, b])), cat = new Map(snow.DIM_CATEGORY.map((c) => [c.Category_Key, c.Category]));
  const viaSnow = {}; snow.FACT_SALES.forEach((f) => { const c = cat.get(brand.get(prod.get(f.Product_Key).Brand_Key).Category_Key); viaSnow[c] = (viaSnow[c] || 0) + f.Sales; });
  const direct = {}; rows.forEach((r) => { direct[r.category] = (direct[r.category] || 0) + r.sales; });
  for (const k of Object.keys(direct)) near(viaSnow[k], direct[k], 1e-6);
});

console.log('Mining');
test('forecast matches numpy polyfit (slope, intercept, R2)', () => {
  const f = forecastSales(rows, 3);
  near(f.fit.slope, -261.6386, 0.001); near(f.fit.intercept, 63842.3250, 0.01); near(f.fit.r2, 0.0126, 0.0005);
  near(f.forecast[0].sales, 60702.66, 0.02); assert.equal(f.forecast[0].label, 'Jan 2026'); assert.equal(f.series.length, 12);
});
test('monthly series matches pandas', () => {
  const m = monthlySeries(rows).map((x) => x.sales);
  near(m[0], 66516.05); near(m[11], 72165.10); near(m[6], 50467.15);
});
test('ABC classes 9/7/4 as in pandas; shares sum to 100%', () => {
  const a = abcAnalysis(rows); const c = (k) => a.filter((p) => p.cls === k).length;
  assert.deepEqual([c('A'), c('B'), c('C')], [9, 7, 4]); near(a.reduce((s, p) => s + p.share, 0), 1, 1e-9);
});
test('weekday pattern matches pandas (JS index: 0=Sun ... 6=Sat)', () => {
  const w = weekdayPattern(rows);
  near(w[0].sales, 96743.15); near(w[1].sales, 93382.15); near(w[5].sales, 113447.55); near(w[6].sales, 117849.15);
  near(w.reduce((a, d) => a + d.sales, 0), 748839.75);
});
test('k-means returns 3 clusters covering all 20 products', () => {
  const k = kmeansProducts(rows, 3);
  assert.equal(k.clusters.length, 3); assert.equal(k.clusters.reduce((a, c) => a + c.size, 0), 20);
});

console.log(`\n${passed} tests passed${process.exitCode ? ' (with failures)' : ''}`);

console.log('Server analytics');
console.log('Flexible column mapping');
const M = await import('../src/lib/mapping.js');
test('DMart file is detected as an identity-like mapping', () => {
  const i = M.inspectCSV(text); assert.equal(i.mapping.date, 'Order_Date'); assert.equal(i.mapping.sales, 'Sales'); assert.equal(i.mapping.store, 'Store'); assert.equal(i.mapping.payment, 'Payment_Method');
  const viaMap = cleanDataset(text, { mapping: i.mapping });
  assert.equal(viaMap.report.accepted, 994); near(sum(viaMap.rows, 'sales'), 748839.75);
});
test('Superstore-style layout: columns found, fractions to percent, repeated IDs become lines, cost derived', () => {
  const csv = 'Row ID,Order ID,Order Date,Region,City,Category,Sub-Category,Product Name,Sales,Quantity,Discount,Profit\n1,CA-1,11/08/2024,West,LA,Tech,Phones,Phone A,\"$1,000.00\",2,0.2,150\n2,CA-1,11/08/2024,West,LA,Tech,Phones,Phone B,200,1,0,-20\n3,CA-2,12/30/2024,East,NYC,Furn,Chairs,Chair,300,3,0.5,30\n';
  const i = M.inspectCSV(csv); assert.equal(i.mapping.store, 'Region'); assert.equal(i.mapping.brand, 'Sub-Category'); assert.equal(i.mapping.discount, 'Discount');
  const r = cleanDataset(csv, { mapping: i.mapping });
  assert.equal(r.report.accepted, 3); assert.deepEqual(r.rows.map((x) => x.id), ['CA-1-1', 'CA-1-2', 'CA-2-1']);
  assert.equal(r.rows[0].date, '2024-11-08'); assert.equal(r.rows[2].date, '2024-12-30'); // 12/30 forces month-first
  assert.equal(r.rows[0].discount, 20); near(r.rows[0].cost, 850); near(r.rows[1].cost, 220);
  assert.equal(r.rows[0].sales, 1000);
});
test('date parser: several formats, ambiguity rules, bad dates', () => {
  assert.equal(M.parseFlexibleDate('5 Jan 2025').iso, '2025-01-05'); assert.equal(M.parseFlexibleDate('Mar 7, 2024').iso, '2024-03-07');
  assert.equal(M.parseFlexibleDate('2025-02-03 14:22:10').iso, '2025-02-03'); assert.equal(M.parseFlexibleDate('03/04/2025', 'mdy').iso, '2025-03-04'); assert.equal(M.parseFlexibleDate('03/04/2025', 'dmy').iso, '2025-04-03');
  assert.equal(M.parseFlexibleDate('45000').iso, '2023-03-15'); assert.equal(M.parseFlexibleDate('31/02/2025'), null); assert.equal(M.parseFlexibleDate('hello'), null);
  assert.equal(M.detectDateOrder(['01/02/2025', '25/03/2025']), 'dmy'); assert.equal(M.detectDateOrder(['01/02/2025', '03/25/2025']), 'mdy');
});
test('mapping without date / sales / profit-or-cost is refused with plain messages', () => {
  const p = M.mappingProblems({}); assert.equal(p.length, 4);
  assert.throws(() => cleanDataset('a,b\n1,2', { mapping: { product: 'a' } }), /order date/);
});
test('profit-only and cost-only files both work; sales = qty x price when missing', () => {
  const csv = 'd,p,q,u,c\n01-02-2025,Pen,3,10,18\n';
  const r = cleanDataset(csv, { mapping: { date: 'd', product: 'p', quantity: 'q', price: 'u', cost: 'c' } });
  assert.equal(r.rows[0].sales, 30); assert.equal(r.rows[0].profit, 12);
});
const F = await import('../src/lib/format.js');
test('currency formatter switches symbol and grouping', () => {
  F.setCurrency('USD'); assert.equal(F.fmtMoney(1234567), '$1,234,567'); F.setCurrency('INR'); assert.equal(F.fmtMoney(1234567), '₹12,34,567');
});
test('list-price column that does not explain Sales is ignored, not used to reject every row', () => {
  const csv = 'd,p,q,list,s,pr\n01-02-2025,Pen,2,10,16,4\n02-02-2025,Ink,1,30,24,6\n';
  const r = cleanDataset(csv, { mapping: { date: 'd', product: 'p', quantity: 'q', price: 'list', sales: 's', profit: 'pr' } });
  assert.equal(r.report.accepted, 2); assert.ok(r.report.notes.some((n) => /list price/.test(n)));
});

console.log('Reports and PDF');
const R = await import('../src/lib/report.js');
const P = await import('../src/lib/pdf.js');
F.setCurrency('INR');
const maxDate = rows.reduce((m, x) => (x.date > m ? x.date : m), '');
test('period scopes count back from the newest date in the data', () => {
  const l = R.resolvePeriod(rows, { scope: 'latest' }); assert.equal(l.from, maxDate); assert.equal(l.to, maxDate); assert.equal(l.days, 1);
  const w = R.resolvePeriod(rows, { scope: '7d' }); assert.equal(w.days, 7); assert.equal(w.to, maxDate);
  assert.equal(R.resolvePeriod(rows, { scope: 'month' }).from, maxDate.slice(0, 8) + '01');
  assert.equal(R.resolvePeriod(rows, { scope: 'all' }).from, '2025-01-01');
  const c = R.resolvePeriod(rows, { scope: 'custom', from: '2025-03-10', to: '2025-03-01' }); assert.equal(c.from, '2025-03-01'); assert.equal(c.days, 10);
  assert.equal(R.resolvePeriod(rows, { scope: 'custom', from: '2031-01-01', to: '2031-01-09' }).from, null);
});
test('report totals equal an independent calculation; previous-period deltas are correct', () => {
  const rep = R.buildReport(rows, { scope: '30d' }, { name: 'x', quality: report, now: '2026-01-01T00:00:00Z' });
  const inWin = rows.filter((x) => x.date >= rep.period.from && x.date <= rep.period.to);
  near(rep.kpis.sales, sum(inWin, 'sales')); near(rep.kpis.profit, sum(inWin, 'profit')); assert.equal(rep.kpis.orders, inWin.length);
  const prev = rows.filter((x) => x.date >= rep.previous.from && x.date <= rep.previous.to);
  near(rep.previous.kpis.sales, sum(prev, 'sales')); near(rep.deltas.sales, (sum(inWin, 'sales') - sum(prev, 'sales')) / sum(prev, 'sales'));
  near(rep.categories.reduce((s, e) => s + e.sales, 0), rep.kpis.sales); near(rep.categories.reduce((s, e) => s + e.share, 0), 1);
  assert.ok(rep.insights.length >= 5 && rep.insights[0].includes('Sales were'));
});
test('entire-dataset report has no comparison; an empty period yields a clear message, not a crash', () => {
  const all = R.buildReport(rows, { scope: 'all' }, {}); assert.equal(all.previous, null); assert.equal(all.deltas, null); near(all.kpis.sales, 748839.75);
  const none = R.buildReport(rows, { scope: 'custom', from: '2031-01-01', to: '2031-01-02' }, {}); assert.equal(none.empty, true); assert.match(none.insights[0], /no orders/i);
  assert.equal(R.buildReport([], {}, {}).empty, true);
});
test('report CSV has one header, a Summary row and the insights', () => {
  const csv = R.reportCSV(R.buildReport(rows, { scope: '7d' }, { name: 'x' }));
  const lines = csv.split('\r\n'); assert.equal(lines[0], 'Section,Item,Sales,Profit,Margin_%,Quantity,Orders,Share_of_sales_%,Change_vs_previous_%');
  assert.ok(lines.some((l) => l.startsWith('Summary,Selected period'))); assert.ok(lines.some((l) => l.startsWith('Insight,')));
});
test('PDF: valid structure, page count matches, text is extractable, rupee becomes Rs.', () => {
  const rep = R.buildReport(rows, { scope: 'all' }, { name: 'DMart', quality: report, now: '2026-01-01T00:00:00Z' });
  const bytes = P.reportToPDF(rep); const s = Buffer.from(bytes).toString('latin1');
  assert.equal(s.slice(0, 8), '%PDF-1.4'); assert.ok(s.trimEnd().endsWith('%%EOF'));
  const pages = (s.match(/\/Type \/Page /g) || []).length; assert.ok(pages >= 2); assert.match(s, new RegExp(`/Count ${pages}`)); assert.match(s, /Page 1 of \d/);
  assert.ok(s.includes('Rs.7,48,840')); assert.ok(!s.includes('₹'));
  const xr = +s.match(/startxref\n(\d+)/)[1]; assert.ok(s.slice(xr).startsWith('xref'));
  assert.ok(P.reportToPDF(R.buildReport(rows, { scope: 'custom', from: '2031-01-01', to: '2031-01-02' }, {})).length > 500);
});
test('PDF text helpers: encoding, escaping, width, wrapping', () => {
  assert.equal(P.enc('₹5 − 3 • “x”'), 'Rs.5 - 3 \x95 \x93x\x94'); assert.ok(P.textWidth('Hello', 10) > 20 && P.textWidth('Hello', 10, true) > P.textWidth('Hello', 10));
  const d = new P.PDFDoc(); const lines = d.wrap('one two three four five six seven eight nine ten', 60, 10); assert.ok(lines.length > 2 && lines.every((l) => P.textWidth(l, 10) <= 60.5));
  assert.ok(d.fit('A very long product name that cannot fit', 80, 9).endsWith('...'));
});

const A = await import('../server/analytics.js');
test('forecast: 12 months, 5 models, back-test metrics, 6-month horizon, non-negative', () => {
  const f = A.forecast(rows, { horizon: 6 });
  assert.ok(f.ok); assert.equal(f.series.length, 12); assert.equal(f.models.length, 5);
  f.models.forEach((m) => { assert.equal(m.forecast.length, 6); assert.ok(m.mape >= 0 && Number.isFinite(m.mape)); m.forecast.forEach((p) => assert.ok(p.value >= 0 && p.low <= p.value && p.value <= p.high)); });
  assert.equal(f.models.find((m) => m.id === 'linear').forecast[0].label, 'Jan 2026');
  assert.ok(f.models.find((m) => m.id === f.best));
});
test('forecast: too little data is refused instead of invented', () => assert.equal(A.forecast(rows.filter((r) => r.month <= 3)).ok, false));
test('forecast linear model equals the OLS used by the Mining Lab', () => {
  const lin = A.forecast(rows).models.find((m) => m.id === 'linear');
  near(lin.params.slope, -261.64, 0.01);
});
test('anomalies: fence and daily stats are finite', () => { const a = A.anomalies(rows); assert.ok(a.days > 300); assert.ok(Number.isFinite(a.orderFence)); a.flaggedDays.forEach((d) => assert.ok(Math.abs(d.z) >= 2.5)); });
test('correlations: symmetric, diagonal 1, discount strongly negative with margin', () => {
  const c = A.correlations(rows);
  c.matrix.forEach((r, i) => { near(r[i], 1, 1e-9); r.forEach((v, j) => near(v, c.matrix[j][i], 1e-9)); });
  assert.ok(c.matrix[c.fields.indexOf('Discount %')][c.fields.indexOf('Margin %')] < -0.95);
});
test('decision tree: deterministic, beats or equals the majority baseline on the test set, rules cover all training rows', () => {
  const t1 = A.decisionTree(rows, 'highValue'), t2 = A.decisionTree(rows, 'highValue');
  assert.deepEqual(t1.rules, t2.rules); assert.ok(t1.test.accuracy >= t1.baselineTest - 0.02);
  assert.equal(t1.rules.reduce((a, r) => a + r.n, 0), t1.trainSize); near(t1.importance.reduce((a, i) => a + i.share, 0), 1, 1e-9);
  const m = A.decisionTree(rows, 'highMargin'); assert.ok(m.test.accuracy > 0.9); assert.equal(m.importance[0].name, 'discount %');
});
console.log(`\n${passed} tests passed (with server analytics)${process.exitCode ? ' (with failures)' : ''}`);
