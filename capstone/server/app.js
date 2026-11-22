// SmartDMart REST API + static file server. Built only on Node built-ins (http, crypto, zlib, node:sqlite).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { hashPassword, verifyPassword, loadSecret, signToken, verifyToken, validateUsername, validatePassword, createThrottle } from './auth.js';
import { cleanDataset, REQUIRED } from '../src/lib/pipeline.js';
import { inspectCSV, mappingProblems } from '../src/lib/mapping.js';
import { CURRENCIES, setCurrency } from '../src/lib/format.js';
import { buildReport, reportCSV, reportFileName, SCOPES } from '../src/lib/report.js';
import { reportToPDF } from '../src/lib/pdf.js';
import { abcAnalysis, kmeansProducts, weekdayPattern, monthlySeries } from '../src/lib/mining.js';
import { buildStar, buildSnowflake, tableCSV, snowflakeCSV, SCHEMA, SNOWFLAKE_SCHEMA } from '../src/lib/star.js';
import { cleanedCSV } from '../src/lib/exportCsv.js';
import { forecast, anomalies, correlations, decisionTree, TREE_TARGETS } from './analytics.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const BUNDLED = path.join(ROOT, 'src/data/DMart_Dataset.csv');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json' };
const TOKEN_TTL = 8 * 3600;

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

export function createApp({ dataDir = path.join(ROOT, 'server/data'), adminPassword = process.env.ADMIN_PASSWORD, staticDir = path.join(ROOT, 'dist') } = {}) {
  const db = openDb(dataDir);
  const secret = loadSecret(dataDir);
  const throttle = createThrottle();
  const demoMode = !adminPassword && process.env.NODE_ENV !== 'production';
  const adminPw = adminPassword || 'Admin@123';

  if (!db.prepare('SELECT 1 FROM users WHERE role = ? LIMIT 1').get('admin')) {
    db.prepare('INSERT INTO users (username, name, role, pass_hash) VALUES (?,?,?,?)').run('admin', 'Administrator', 'admin', hashPassword(adminPw));
    db.prepare('INSERT INTO users (username, name, role, pass_hash) VALUES (?,?,?,?)').run('analyst', 'Demo Analyst', 'analyst', hashPassword(demoMode ? 'Analyst@123' : crypto_random()));
  }
  function crypto_random() { return Array.from({ length: 24 }, () => 'abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 32)]).join('') + 'A1'; }

  // ---------------------------------------------------------------- dataset cache
  let cache = null;
  function loadDataset() {
    const active = db.prepare('SELECT * FROM datasets WHERE active = 1 ORDER BY id DESC LIMIT 1').get();
    const text = active ? active.csv : fs.readFileSync(BUNDLED, 'utf8');
    const mapping = active?.mapping ? JSON.parse(active.mapping) : null;
    const currency = active?.currency || 'INR';
    const cleaned = cleanDataset(text, mapping ? { mapping, dateOrder: active.date_order || 'auto', currency } : { currency });
    cache = { id: active ? active.id : null, name: active ? active.name : 'DMart_Dataset.csv (bundled)', custom: !!active, currency, mapping, ...cleaned, star: null, snow: null, derived: new Map() };
    return cache;
  }
  const dataset = () => cache || loadDataset();
  const memo = (key, fn) => { const d = dataset(); if (!d.derived.has(key)) d.derived.set(key, fn(d)); return d.derived.get(key); };

  // ---------------------------------------------------------------- helpers
  const log = (user, action, detail, ip) => db.prepare('INSERT INTO activity (user_id, username, action, detail, ip) VALUES (?,?,?,?,?)').run(user?.id ?? null, user?.username ?? null, action, String(detail ?? '').slice(0, 300), ip ?? null);
  const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role });
  const clientIp = (req) => req.socket.remoteAddress || '';

  function send(req, res, status, body, headers = {}) {
    const isStr = typeof body === 'string' || Buffer.isBuffer(body);
    let payload = isStr ? body : JSON.stringify(body);
    const h = { 'Content-Type': isStr ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers };
    if (payload.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) { payload = zlib.gzipSync(payload); h['Content-Encoding'] = 'gzip'; h.Vary = 'Accept-Encoding'; }
    res.writeHead(status, { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', ...h });
    res.end(payload);
  }

  function readBody(req, limit = 6 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Request body too large (limit 6 MB).')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Body must be valid JSON.')); }
      });
      req.on('error', reject);
    });
  }

  function auth(req, url, { exportRoute = false } = {}) {
    const h = req.headers.authorization || '';
    let token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token && exportRoute) token = url.searchParams.get('key');
    const p = verifyToken(secret, token);
    if (!p) throw new HttpError(401, 'Please sign in.');
    if (p.scope === 'export' && !exportRoute) throw new HttpError(401, 'An export key can only be used for /api/export downloads.');
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(p.sub);
    if (!u) throw new HttpError(401, 'Account no longer exists.');
    return u;
  }
  const requireAdmin = (u) => { if (u.role !== 'admin') throw new HttpError(403, 'Administrator access required.'); };

  const applyQueryFilters = (rows, q) => {
    const cat = q.get('category'), store = q.get('store');
    return rows.filter((r) => (!cat || r.category === cat) && (!store || r.store === store));
  };

  // ---------------------------------------------------------------- routes
  async function route(req, res, url) {
    const m = req.method, p = url.pathname, ip = clientIp(req);

    if (m === 'GET' && p === '/api/health') return send(req, res, 200, { ok: true, time: new Date().toISOString() });
    if (m === 'GET' && p === '/api/auth/config') return send(req, res, 200, { registration: true, demo: demoMode ? [{ username: 'admin', password: 'Admin@123', role: 'admin' }, { username: 'analyst', password: 'Analyst@123', role: 'analyst' }] : null });

    if (m === 'POST' && p === '/api/auth/register') {
      const b = await readBody(req);
      const username = String(b.username || '').trim().toLowerCase();
      if (!validateUsername(username)) throw new HttpError(400, 'Username must be 3–30 characters: letters, numbers, dot, dash or underscore.');
      const pwErr = validatePassword(b.password); if (pwErr) throw new HttpError(400, pwErr);
      if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'That username is already taken.');
      const name = String(b.name || '').trim().slice(0, 60);
      const r = db.prepare('INSERT INTO users (username, name, role, pass_hash) VALUES (?,?,?,?)').run(username, name, 'analyst', hashPassword(b.password));
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(r.lastInsertRowid));
      log(u, 'register', 'New analyst account', ip);
      return send(req, res, 201, { token: signToken(secret, { sub: u.id }, TOKEN_TTL), user: publicUser(u) });
    }

    if (m === 'POST' && p === '/api/auth/login') {
      const b = await readBody(req);
      const username = String(b.username || '').trim().toLowerCase();
      const key = ip + '|' + username;
      const wait = throttle.blocked(key);
      if (wait) throw new HttpError(429, `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} minute(s).`);
      const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      const ok = u && typeof b.password === 'string' && verifyPassword(b.password, u.pass_hash);
      if (!ok) { throttle.fail(key); log(u, 'login_failed', username, ip); throw new HttpError(401, 'Incorrect username or password.'); }
      throttle.clear(key);
      db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(u.id);
      log(u, 'login', '', ip);
      return send(req, res, 200, { token: signToken(secret, { sub: u.id }, TOKEN_TTL), user: publicUser(u) });
    }

    if (p.startsWith('/api/export/')) {
      const u = auth(req, url, { exportRoute: true });
      const d = dataset();
      const name = decodeURIComponent(p.slice('/api/export/'.length));
      if (/^report\.(pdf|csv|json)$/.test(name)) { // /api/export/report.pdf?scope=latest|7d|30d|month|all|custom&from=YYYY-MM-DD&to=YYYY-MM-DD
        const q = url.searchParams, scope = q.get('scope') || 'latest', iso = /^\d{4}-\d{2}-\d{2}$/;
        if (!SCOPES.some((s) => s.id === scope)) throw new HttpError(400, 'scope must be one of: ' + SCOPES.map((s) => s.id).join(', '));
        for (const k of ['from', 'to']) if (q.get(k) && !iso.test(q.get(k))) throw new HttpError(400, `${k} must look like 2025-12-31`);
        setCurrency(d.currency); // synchronous from here to the end of the build, so concurrent requests cannot interleave
        const rep = buildReport(d.rows, { scope, from: q.get('from') || undefined, to: q.get('to') || undefined }, { name: d.name, quality: d.report });
        log(u, 'export', `${name} ${scope}`, ip);
        const ext = name.split('.')[1];
        if (ext === 'json') return send(req, res, 200, rep);
        const body = ext === 'pdf' ? Buffer.from(reportToPDF(rep)) : '\uFEFF' + reportCSV(rep);
        return send(req, res, 200, body, { 'Content-Type': ext === 'pdf' ? 'application/pdf' : 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${reportFileName(rep, ext)}"` });
      }
      let csv = null, file = name;
      if (name === 'cleaned.csv') csv = cleanedCSV(d.rows);
      else {
        const [model, tbl] = name.replace(/\.csv$/, '').split('/');
        if (model === 'star' && SCHEMA[tbl]) { d.star ||= buildStar(d.rows); csv = tableCSV(tbl, d.star); file = tbl + '.csv'; }
        if (model === 'snowflake' && SNOWFLAKE_SCHEMA[tbl]) { d.snow ||= buildSnowflake(d.rows); csv = snowflakeCSV(tbl, d.snow); file = tbl + '.csv'; }
      }
      if (csv == null) throw new HttpError(404, 'Unknown export. Use cleaned.csv, report.pdf, report.csv, star/<TABLE>.csv or snowflake/<TABLE>.csv.');
      log(u, 'export', name, ip);
      return send(req, res, 200, csv, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${file.split('/').pop()}"` });
    }

    if (p.startsWith('/api/')) {
      const user = auth(req, url);

      if (m === 'GET' && p === '/api/auth/me') return send(req, res, 200, { user: publicUser(user) });
      if (m === 'POST' && p === '/api/auth/logout') { log(user, 'logout', '', ip); return send(req, res, 200, { ok: true }); }
      if (m === 'POST' && p === '/api/auth/change-password') {
        const b = await readBody(req);
        if (!verifyPassword(String(b.current || ''), user.pass_hash)) throw new HttpError(400, 'Current password is incorrect.');
        const e = validatePassword(b.next); if (e) throw new HttpError(400, e);
        db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(b.next), user.id);
        log(user, 'change_password', '', ip);
        return send(req, res, 200, { ok: true });
      }
      if (m === 'POST' && p === '/api/auth/api-key') {
        log(user, 'api_key', 'created 30-day export key', ip);
        return send(req, res, 200, { key: signToken(secret, { sub: user.id, scope: 'export' }, 30 * 24 * 3600), expiresInDays: 30 });
      }

      if (m === 'GET' && p === '/api/dataset') {
        const d = dataset();
        return send(req, res, 200, { id: d.id, name: d.name, custom: d.custom, currency: d.currency, mapping: d.mapping, report: d.report, rows: d.rows });
      }
      if (m === 'GET' && p === '/api/datasets') {
        const d = dataset();
        const list = db.prepare('SELECT id, name, uploaded_by, rows_accepted, rows_rejected, active, currency, at, length(csv) AS bytes FROM datasets ORDER BY id DESC').all();
        const bundled = memo('bundledCount', () => cleanDataset(fs.readFileSync(BUNDLED, 'utf8')).report);
        return send(req, res, 200, {
          datasets: [
            { id: null, name: 'DMart_Dataset.csv (bundled)', bundled: true, active: !d.custom, rows_accepted: bundled.accepted, rows_rejected: bundled.rejected, currency: 'INR', uploaded_by: 'built-in', at: null },
            ...list.map((r) => ({ ...r, active: !!r.active, bundled: false })),
          ],
        });
      }
      if (m === 'POST' && p === '/api/dataset') {
        requireAdmin(user);
        const b = await readBody(req, 25 * 1024 * 1024);
        const name = String(b.name || 'uploaded.csv').slice(0, 80);
        const csv = String(b.csv || '');
        const currency = CURRENCIES[b.currency] ? b.currency : 'INR';
        const dateOrder = ['auto', 'dmy', 'mdy'].includes(b.dateOrder) ? b.dateOrder : 'auto';
        let mapping = b.mapping && typeof b.mapping === 'object' ? b.mapping : null;
        if (!mapping) { // no mapping sent: DMart layout is used as-is, any other layout is auto-detected
          const { header, mapping: guess } = inspectCSV(csv);
          const exact = REQUIRED.every((c) => header.includes(c));
          if (!exact) mapping = guess;
        }
        if (mapping) { const probs = mappingProblems(mapping); if (probs.length) throw new HttpError(400, probs.join(' ')); }
        let cleaned;
        try { cleaned = cleanDataset(csv, mapping ? { mapping, dateOrder, currency } : { currency }); } catch (e) { throw new HttpError(400, e.message); }
        if (!cleaned.rows.length) throw new HttpError(400, 'No valid rows were found in this file. Check the column mapping and the date format.');
        db.exec('UPDATE datasets SET active = 0');
        db.prepare('INSERT INTO datasets (name, csv, uploaded_by, rows_accepted, rows_rejected, active, mapping, currency, date_order) VALUES (?,?,?,?,?,1,?,?,?)')
          .run(name, csv, user.username, cleaned.report.accepted, cleaned.report.rejected, mapping ? JSON.stringify(mapping) : null, currency, dateOrder);
        loadDataset();
        log(user, 'dataset_upload', `${name}: ${cleaned.report.accepted} accepted, ${cleaned.report.rejected} rejected`, ip);
        return send(req, res, 201, { name, accepted: cleaned.report.accepted, rejected: cleaned.report.rejected, notes: cleaned.report.notes });
      }
      const dm = p.match(/^\/api\/datasets\/(\d+)(\/activate)?$/);
      if (dm && ((m === 'POST' && dm[2]) || (m === 'DELETE' && !dm[2]))) {
        requireAdmin(user);
        const id = Number(dm[1]);
        const row = db.prepare('SELECT id, name, active FROM datasets WHERE id = ?').get(id);
        if (!row) throw new HttpError(404, 'Dataset not found.');
        if (m === 'DELETE') {
          db.prepare('DELETE FROM datasets WHERE id = ?').run(id);
          if (row.active) db.exec('UPDATE datasets SET active = 0'); // falls back to the bundled dataset
          loadDataset();
          log(user, 'dataset_delete', row.name, ip);
          return send(req, res, 200, { ok: true });
        }
        db.exec('UPDATE datasets SET active = 0'); db.prepare('UPDATE datasets SET active = 1 WHERE id = ?').run(id);
        loadDataset();
        log(user, 'dataset_activate', row.name, ip);
        return send(req, res, 200, { ok: true });
      }
      if (m === 'POST' && p === '/api/dataset/reset') {
        requireAdmin(user);
        db.exec('UPDATE datasets SET active = 0'); loadDataset();
        log(user, 'dataset_reset', 'bundled dataset restored', ip);
        return send(req, res, 200, { ok: true });
      }

      if (m === 'GET' && p === '/api/forecast') {
        const horizon = Math.min(12, Math.max(1, parseInt(url.searchParams.get('horizon') || '6', 10) || 6));
        const d = dataset();
        const rows = applyQueryFilters(d.rows, url.searchParams);
        const overall = forecast(rows, { horizon });
        const categories = [...new Set(d.rows.map((r) => r.category))].sort().map((c) => {
          const f = forecast(d.rows.filter((r) => r.category === c), { horizon: 3 });
          if (!f.ok) return { category: c, ok: false };
          const best = f.models.find((x) => x.id === f.best);
          const hist = f.series.slice(-3).reduce((a, s) => a + s.sales, 0);
          const next = best.forecast.reduce((a, x) => a + x.value, 0);
          return { category: c, ok: true, model: best.name, mape: best.mape, last3: hist, next3: next, change: hist ? next / hist - 1 : 0 };
        });
        return send(req, res, 200, { filters: { category: url.searchParams.get('category'), store: url.searchParams.get('store') }, overall, categories });
      }

      if (m === 'GET' && p === '/api/mining') {
        const target = TREE_TARGETS[url.searchParams.get('target')] ? url.searchParams.get('target') : 'highValue';
        const d = dataset();
        const out = memo('mining:' + target, () => ({
          abc: abcAnalysis(d.rows), kmeans: kmeansProducts(d.rows, 3), weekday: weekdayPattern(d.rows), monthly: monthlySeries(d.rows),
          anomalies: anomalies(d.rows), correlations: correlations(d.rows), tree: decisionTree(d.rows, target), targets: TREE_TARGETS,
        }));
        return send(req, res, 200, out);
      }

      if (m === 'GET' && p === '/api/admin/users') {
        requireAdmin(user);
        return send(req, res, 200, { users: db.prepare('SELECT id, username, name, role, created_at, last_login FROM users ORDER BY id').all() });
      }
      const um = p.match(/^\/api\/admin\/users\/(\d+)$/);
      if (um && (m === 'PATCH' || m === 'DELETE')) {
        requireAdmin(user);
        const id = Number(um[1]);
        const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
        if (!target) throw new HttpError(404, 'User not found.');
        if (id === user.id) throw new HttpError(400, 'You cannot change or delete your own account here.');
        if (m === 'DELETE') { db.prepare('DELETE FROM users WHERE id = ?').run(id); log(user, 'user_delete', target.username, ip); return send(req, res, 200, { ok: true }); }
        const b = await readBody(req);
        if (!['admin', 'analyst'].includes(b.role)) throw new HttpError(400, 'Role must be admin or analyst.');
        db.prepare('UPDATE users SET role = ? WHERE id = ?').run(b.role, id);
        log(user, 'user_role', `${target.username} → ${b.role}`, ip);
        return send(req, res, 200, { ok: true });
      }
      if (m === 'GET' && p === '/api/admin/activity') {
        requireAdmin(user);
        return send(req, res, 200, { activity: db.prepare('SELECT id, username, action, detail, ip, at FROM activity ORDER BY id DESC LIMIT 100').all() });
      }
      throw new HttpError(404, 'Unknown API endpoint.');
    }

    // ------------------------------------------------------------ static site (production build)
    if (m !== 'GET' && m !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
    if (!fs.existsSync(staticDir)) return send(req, res, 200, 'SmartDMart API is running. Build the frontend with "npm run build" or use "npm run dev".');
    let rel = decodeURIComponent(p);
    let file = path.join(staticDir, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(staticDir)) throw new HttpError(403, 'Forbidden');
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(staticDir, 'index.html');
    const ext = path.extname(file);
    const buf = fs.readFileSync(file);
    const immutable = file.includes(`${path.sep}assets${path.sep}`);
    const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'";
    return send(req, res, 200, buf, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache', 'Content-Security-Policy': csp });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      await route(req, res, url);
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
      if (!res.headersSent) send(req, res, e.status || 500, { error: e instanceof HttpError ? e.message : 'Internal server error.' });
    }
  });
  loadDataset();
  return { server, db, close: () => new Promise((r) => server.close(() => { db.close(); r(); })) };
}
