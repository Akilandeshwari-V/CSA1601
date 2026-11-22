import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

export function loadSecret(dir) {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (dir === ':memory:') return crypto.randomBytes(32).toString('hex');
  const f = path.join(dir, '.secret');
  try { return fs.readFileSync(f, 'utf8'); } catch { /* first run */ }
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}

const b64 = (b) => Buffer.from(b).toString('base64url');
export function signToken(secret, payload, ttlSeconds) {
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}
export function verifyToken(secret, token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest();
  let given; try { given = Buffer.from(sig, 'base64url'); } catch { return null; }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p.exp > Date.now() / 1000 ? p : null;
  } catch { return null; }
}

export function validateUsername(u) { return typeof u === 'string' && /^[a-z0-9_.-]{3,30}$/.test(u); }
export function validatePassword(p) {
  if (typeof p !== 'string' || p.length < 8 || p.length > 100) return 'Password must be 8–100 characters.';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'Password must contain at least one letter and one number.';
  return null;
}

/** Tiny in-memory login throttle: 5 failures lock a username+ip for 15 minutes. */
export function createThrottle(max = 5, windowMs = 15 * 60 * 1000) {
  const m = new Map();
  return {
    blocked(key) { const e = m.get(key); return !!e && e.count >= max && e.until > Date.now() ? Math.ceil((e.until - Date.now()) / 1000) : 0; },
    fail(key) { const e = m.get(key); const now = Date.now(); const n = e && e.until > now ? e.count + 1 : 1; m.set(key, { count: n, until: now + windowMs }); },
    clear(key) { m.delete(key); },
  };
}
