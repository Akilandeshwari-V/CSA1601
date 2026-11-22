import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from './api.js';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(!getToken());

  const logout = useCallback(async (silent) => {
    if (!silent) { try { await api('/auth/logout', { method: 'POST' }); } catch { /* ignore */ } }
    setToken(null); setUser(null);
  }, []);

  useEffect(() => { setUnauthorizedHandler(() => { setToken(null); setUser(null); }); }, []);
  useEffect(() => {
    if (!getToken()) return;
    api('/auth/me').then((r) => setUser(r.user)).catch(() => setToken(null)).finally(() => setReady(true));
  }, []);

  const value = useMemo(() => ({
    user, ready, logout,
    login: async (username, password) => { const r = await api('/auth/login', { method: 'POST', body: { username, password }, auth: false }); setToken(r.token); setUser(r.user); },
    register: async (username, name, password) => { const r = await api('/auth/register', { method: 'POST', body: { username, name, password }, auth: false }); setToken(r.token); setUser(r.user); },
  }), [user, ready, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
