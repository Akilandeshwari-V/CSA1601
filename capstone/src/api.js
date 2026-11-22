// Thin fetch wrapper for the SmartDMart REST API (same origin; Vite proxies /api to the Node server in development).
const KEY = 'sdm_token';
export const getToken = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const setToken = (t) => { try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); } catch { /* storage blocked */ } };

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export async function api(path, { method = 'GET', body, auth = true } = {}) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(auth && getToken() ? { Authorization: 'Bearer ' + getToken() } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error('Cannot reach the SmartDMart server. Is it running (npm run dev)?'), { network: true });
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    if (res.status === 401 && auth) onUnauthorized();
    throw Object.assign(new Error(data?.error || `Request failed (${res.status})`), { status: res.status });
  }
  return data;
}

export async function downloadWithAuth(path, filename) {
  const res = await fetch('/api' + path, { headers: { Authorization: 'Bearer ' + getToken() } });
  if (!res.ok) throw new Error('Download failed (' + res.status + ')');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
