// Backend integration tests: starts the real HTTP server on a random port with an in-memory database.
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';

const app = createApp({ dataDir: ':memory:', adminPassword: undefined, staticDir: '/nonexistent' });
await new Promise((r) => app.server.listen(0, r));
const base = `http://127.0.0.1:${app.server.address().port}`;
let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log('  ok  ', name); } catch (e) { console.error('  FAIL', name, '\n', e.message); process.exitCode = 1; } };
const call = async (method, path, { token, body, raw } = {}) => {
  const res = await fetch(base + path, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, headers: res.headers };
};

console.log('Backend API');
let admin, analyst;
await test('health endpoint is public', async () => assert.equal((await call('GET', '/api/health')).json.ok, true));
await test('protected endpoints reject anonymous callers', async () => { for (const p of ['/api/dataset', '/api/forecast', '/api/mining', '/api/admin/users', '/api/auth/me']) assert.equal((await call('GET', p)).status, 401, p); });
await test('login fails with a wrong password, succeeds with the demo admin', async () => {
  assert.equal((await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'nope' } })).status, 401);
  const r = await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'Admin@123' } });
  assert.equal(r.status, 200); assert.equal(r.json.user.role, 'admin'); admin = r.json.token;
  analyst = (await call('POST', '/api/auth/login', { body: { username: 'analyst', password: 'Analyst@123' } })).json.token;
  assert.ok(analyst);
});
await test('password hashes are never returned', async () => { const me = await call('GET', '/api/auth/me', { token: admin }); assert.equal(me.json.user.username, 'admin'); assert.ok(!JSON.stringify(me.json).includes('scrypt')); });
await test('tampered or malformed tokens are rejected', async () => {
  assert.equal((await call('GET', '/api/auth/me', { token: admin.slice(0, -3) + 'abc' })).status, 401);
  assert.equal((await call('GET', '/api/auth/me', { token: 'garbage' })).status, 401);
});
await test('registration validates input and creates analyst accounts', async () => {
  assert.equal((await call('POST', '/api/auth/register', { body: { username: 'x', password: 'abc12345' } })).status, 400);
  assert.equal((await call('POST', '/api/auth/register', { body: { username: 'student1', password: 'short' } })).status, 400);
  assert.equal((await call('POST', '/api/auth/register', { body: { username: 'admin', password: 'Abcdefg1' } })).status, 409);
  const r = await call('POST', '/api/auth/register', { body: { username: 'Student1', name: 'Student One', password: 'Abcdefg1' } });
  assert.equal(r.status, 201); assert.equal(r.json.user.role, 'analyst'); assert.equal(r.json.user.username, 'student1');
});
await test('login throttle locks after 5 failures', async () => {
  for (let i = 0; i < 5; i++) await call('POST', '/api/auth/login', { body: { username: 'student1', password: 'wrong' + i } });
  assert.equal((await call('POST', '/api/auth/login', { body: { username: 'student1', password: 'Abcdefg1' } })).status, 429);
});
await test('dataset endpoint returns the cleaned rows and the cleaning report', async () => {
  const r = await call('GET', '/api/dataset', { token: analyst });
  assert.equal(r.status, 200); assert.equal(r.json.rows.length, 994); assert.equal(r.json.report.rejected, 6); assert.equal(r.json.report.totalRead, 1000);
});
await test('forecast endpoint: 6 months, five models, category table, filters work', async () => {
  const r = await call('GET', '/api/forecast?horizon=6', { token: analyst });
  assert.equal(r.status, 200); assert.ok(r.json.overall.ok); assert.equal(r.json.overall.models.length, 5); assert.equal(r.json.overall.models[0].forecast.length, 6); assert.equal(r.json.categories.length, 9);
  const f = await call('GET', '/api/forecast?category=Dairy', { token: analyst });
  assert.ok(f.json.overall.series.reduce((a, s) => a + s.sales, 0) < r.json.overall.series.reduce((a, s) => a + s.sales, 0));
});
await test('mining endpoint returns ABC, k-means, anomalies, correlations and a tree', async () => {
  const r = await call('GET', '/api/mining?target=highMargin', { token: analyst });
  assert.equal(r.status, 200); assert.equal(r.json.abc.length, 20); assert.equal(r.json.kmeans.clusters.length, 3); assert.ok(r.json.tree.rules.length >= 2); assert.equal(r.json.tree.target, 'highMargin'); assert.equal(r.json.correlations.fields.length, 6);
});
await test('only admins can upload datasets, manage users and read the activity log', async () => {
  assert.equal((await call('POST', '/api/dataset', { token: analyst, body: { name: 'x.csv', csv: 'a,b\n1,2' } })).status, 403);
  assert.equal((await call('GET', '/api/admin/users', { token: analyst })).status, 403);
  assert.equal((await call('GET', '/api/admin/activity', { token: analyst })).status, 403);
  const users = await call('GET', '/api/admin/users', { token: admin });
  assert.ok(users.json.users.length >= 3);
  assert.ok((await call('GET', '/api/admin/activity', { token: admin })).json.activity.some((a) => a.action === 'login_failed'));
});
await test('upload rejects a CSV without the required columns, accepts a valid one, reset restores the bundled data', async () => {
  const bad = await call('POST', '/api/dataset', { token: admin, body: { name: 'bad.csv', csv: 'a,b\n1,2' } });
  assert.equal(bad.status, 400); assert.match(bad.json.error, /order date|Missing required column/);
  const header = 'Order_ID,Order_Date,Store,City,Product,Category,Brand,Quantity,Sales,Cost,Profit,Payment_Method,Customer_Type';
  const csv = [header, '1,05-01-2025,S1,C1,Milk,Dairy,Amul,2,100,80,20,UPI,Regular', '2,06-01-2025,S1,C1,Milk,Dairy,Amul,0,100,80,20,UPI,Regular'].join('\n');
  const ok = await call('POST', '/api/dataset', { token: admin, body: { name: 'tiny.csv', csv } });
  assert.equal(ok.status, 201); assert.equal(ok.json.accepted, 1); assert.equal(ok.json.rejected, 1);
  assert.equal((await call('GET', '/api/dataset', { token: analyst })).json.rows.length, 1);
  assert.equal((await call('POST', '/api/dataset/reset', { token: admin })).status, 200);
  assert.equal((await call('GET', '/api/dataset', { token: analyst })).json.rows.length, 994);
});
await test('admin cannot delete themselves; role change works', async () => {
  const users = (await call('GET', '/api/admin/users', { token: admin })).json.users;
  const me = users.find((u) => u.username === 'admin'), s = users.find((u) => u.username === 'student1');
  assert.equal((await call('DELETE', `/api/admin/users/${me.id}`, { token: admin })).status, 400);
  assert.equal((await call('PATCH', `/api/admin/users/${s.id}`, { token: admin, body: { role: 'superuser' } })).status, 400);
  assert.equal((await call('PATCH', `/api/admin/users/${s.id}`, { token: admin, body: { role: 'admin' } })).status, 200);
  assert.equal((await call('DELETE', `/api/admin/users/${s.id}`, { token: admin })).status, 200);
});
await test('exports: session token or 30-day export key; keys do not work on data APIs', async () => {
  const keyRes = await call('POST', '/api/auth/api-key', { token: analyst });
  const key = keyRes.json.key;
  const star = await call('GET', `/api/export/star/FACT_SALES.csv?key=${key}`);
  assert.equal(star.status, 200); assert.equal(star.text.split(/\r?\n/).length, 995); assert.match(star.text.split('\n')[0], /^Sales_ID,Product_Key/);
  const snow = await call('GET', '/api/export/snowflake/DIM_CATEGORY.csv', { token: analyst });
  assert.equal(snow.status, 200); assert.equal(snow.text.trim().split(/\r?\n/).length, 10);
  assert.equal((await call('GET', '/api/export/cleaned.csv')).status, 401);
  assert.equal((await call('GET', '/api/export/nope.csv', { token: analyst })).status, 404);
  assert.equal((await call('GET', '/api/dataset', { token: key })).status, 401);
});
await test('change password requires the current password', async () => {
  assert.equal((await call('POST', '/api/auth/change-password', { token: analyst, body: { current: 'bad', next: 'Newpass123' } })).status, 400);
  assert.equal((await call('POST', '/api/auth/change-password', { token: analyst, body: { current: 'Analyst@123', next: 'Newpass123' } })).status, 200);
  assert.equal((await call('POST', '/api/auth/login', { body: { username: 'analyst', password: 'Newpass123' } })).status, 200);
});
await test('oversized and malformed bodies are refused; unknown routes 404', async () => {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', body: '{not json' }); assert.equal(r.status, 400);
  assert.equal((await call('GET', '/api/nothing', { token: admin })).status, 404);
});

await test('static hosting: serves the build, SPA fallback, correct MIME, no path traversal', async () => {
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdm-'));
  fs.mkdirSync(path.join(dir, 'assets')); fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>SmartDMart</title>'); fs.writeFileSync(path.join(dir, 'assets', 'a.js'), 'console.log(1)');
  const web = createApp({ dataDir: ':memory:', staticDir: dir });
  await new Promise((r) => web.server.listen(0, r));
  const b = `http://127.0.0.1:${web.server.address().port}`;
  const idx = await fetch(b + '/'); assert.match(await idx.text(), /SmartDMart/); assert.match(idx.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(await (await fetch(b + '/some/deep/link')).text(), /SmartDMart/);
  const js = await fetch(b + '/assets/a.js'); assert.match(js.headers.get('content-type'), /javascript/); assert.match(js.headers.get('cache-control'), /immutable/);
  const evil = await fetch(b + '/..%2f..%2fpackage.json'); assert.ok(!(await evil.text()).includes('"dependencies"'));
  assert.equal((await fetch(b + '/', { method: 'POST' })).status, 405);
  await web.close(); fs.rmSync(dir, { recursive: true });
});

// ------------------------------------------------------------------ any-retail-dataset support
import fsx from 'node:fs';
const usCsv = fsx.readFileSync(new URL('../sample_data/US_Retail_Sample.csv', import.meta.url), 'utf8');
await test('another retail layout is auto-mapped, cleaned and becomes the active dataset', async () => {
  const r = await call('POST', '/api/dataset', { token: admin, body: { name: 'US_Retail_Sample.csv', csv: usCsv, currency: 'USD' } });
  assert.equal(r.status, 201, r.text); assert.equal(r.json.accepted, 3197); assert.equal(r.json.rejected, 4);
  const d = (await call('GET', '/api/dataset', { token: analyst })).json;
  assert.equal(d.currency, 'USD'); assert.equal(d.rows.length, 3197); assert.equal(d.report.mapped, true);
  assert.deepEqual([...new Set(d.rows.map((x) => x.category))].sort(), ['Furniture', 'Office Supplies', 'Technology']);
  assert.ok(d.rows.every((x) => x.year === 2023 || x.year === 2024));
});
await test('every analysis endpoint works on the new dataset (forecast, mining, exports)', async () => {
  const f = (await call('GET', '/api/forecast?horizon=6', { token: analyst })).json;
  assert.equal(f.overall.ok, true); assert.equal(f.categories.length, 3);
  const mi = await call('GET', '/api/mining', { token: analyst }); assert.equal(mi.status, 200);
  assert.ok(mi.json.abc.length > 10 && mi.json.tree);
  for (const name of ['cleaned.csv', 'star/FACT_SALES.csv', 'snowflake/DIM_CATEGORY.csv']) assert.equal((await call('GET', '/api/export/' + name, { token: admin })).status, 200, name);
});
await test('dataset library lists both datasets; analysts cannot switch; admin can switch back and delete', async () => {
  let l = (await call('GET', '/api/datasets', { token: analyst })).json.datasets;
  const before = l.length; assert.ok(before >= 2); assert.equal(l.find((x) => x.active).name, 'US_Retail_Sample.csv'); assert.equal(l.find((x) => x.bundled).rows_accepted, 994);
  const id = l.find((x) => !x.bundled).id;
  assert.equal((await call('POST', `/api/datasets/${id}/activate`, { token: analyst })).status, 403);
  assert.equal((await call('POST', '/api/dataset/reset', { token: admin })).status, 200);
  assert.equal((await call('GET', '/api/dataset', { token: analyst })).json.rows.length, 994);
  assert.equal((await call('POST', `/api/datasets/${id}/activate`, { token: admin })).status, 200);
  assert.equal((await call('GET', '/api/dataset', { token: analyst })).json.currency, 'USD');
  assert.equal((await call('DELETE', `/api/datasets/${id}`, { token: admin })).status, 200);
  const d = (await call('GET', '/api/dataset', { token: analyst })).json; assert.equal(d.rows.length, 994); assert.equal(d.currency, 'INR');
  assert.equal((await call('GET', '/api/datasets', { token: analyst })).json.datasets.length, before - 1);
});
await test('an explicit mapping is honoured and an unusable one is refused with a clear message', async () => {
  const csv = 'when,item,units,price,cost\n2025-01-05,Pen,2,10,12\n2025-01-06,Ink,1,30,20\n';
  const bad = await call('POST', '/api/dataset', { token: admin, body: { name: 'm.csv', csv, mapping: { date: 'when', product: 'item' } } });
  assert.equal(bad.status, 400); assert.match(bad.json.error, /Sales/);
  const ok = await call('POST', '/api/dataset', { token: admin, body: { name: 'm.csv', csv, mapping: { date: 'when', product: 'item', quantity: 'units', price: 'price', cost: 'cost' } } });
  assert.equal(ok.status, 201, ok.text); assert.equal(ok.json.accepted, 2);
  const d = (await call('GET', '/api/dataset', { token: analyst })).json;
  assert.equal(d.rows[0].sales, 20); assert.equal(d.rows[0].profit, 8); assert.equal(d.rows[1].profit, 10);
  await call('POST', '/api/dataset/reset', { token: admin });
});

// ------------------------------------------------------------------ reports (PDF / CSV / JSON)
await test('report endpoints return a real PDF, a CSV and JSON for the same period', async () => {
  const pdf = await fetch(base + '/api/export/report.pdf?scope=30d', { headers: { Authorization: 'Bearer ' + analyst } });
  assert.equal(pdf.status, 200); assert.equal(pdf.headers.get('content-type'), 'application/pdf'); assert.match(pdf.headers.get('content-disposition'), /smartdmart_30d_report_2025-12-31\.pdf/);
  const buf = Buffer.from(await pdf.arrayBuffer()); assert.equal(buf.subarray(0, 5).toString(), '%PDF-'); assert.ok(buf.length > 4000);
  const csv = await call('GET', '/api/export/report.csv?scope=latest', { token: analyst }); assert.equal(csv.status, 200); assert.match(csv.text, /Section,Item,Sales/);
  const js = (await call('GET', '/api/export/report.json?scope=30d', { token: analyst })).json;
  assert.equal(js.period.to, '2025-12-31'); assert.equal(js.period.days, 30); assert.ok(js.kpis.sales > 0); assert.ok(js.previous && js.deltas);
});
await test('report endpoint validates input, honours export keys, and follows the active dataset and its currency', async () => {
  assert.equal((await call('GET', '/api/export/report.pdf?scope=yesterday', { token: analyst })).status, 400);
  assert.equal((await call('GET', '/api/export/report.pdf?scope=custom&from=1-1-2025', { token: analyst })).status, 400);
  assert.equal((await call('GET', '/api/export/report.pdf')).status, 401);
  const key = (await call('POST', '/api/auth/api-key', { token: analyst })).json.key || (await call('POST', '/api/auth/api-key', { token: analyst })).json.apiKey;
  if (key) assert.equal((await call('GET', `/api/export/report.csv?scope=7d&key=${key}`)).status, 200);
  await call('POST', '/api/dataset', { token: admin, body: { name: 'US_Retail_Sample.csv', csv: usCsv, currency: 'USD' } });
  const js = (await call('GET', '/api/export/report.json?scope=latest', { token: analyst })).json;
  assert.equal(js.dataset.name, 'US_Retail_Sample.csv'); assert.equal(js.period.to, '2024-12-31'); assert.match(js.insights[0], /^Sales were \$/);
  const pdf = await fetch(base + '/api/export/report.pdf?scope=7d', { headers: { Authorization: 'Bearer ' + analyst } });
  assert.ok(Buffer.from(await pdf.arrayBuffer()).toString('latin1').includes('$'));
  await call('POST', '/api/dataset/reset', { token: admin });
  assert.match((await call('GET', '/api/export/report.json?scope=latest', { token: analyst })).json.insights[0], /^Sales were ₹/);
});

await app.close();
console.log(`\n${passed} API tests passed${process.exitCode ? ' (with failures)' : ''}`);
