import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

function CubeArt() {
  const cells = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) {
    if ((i * 7 + j * 3 + k * 5) % 3 === 0) continue;
    const x = 210 + (i - k) * 38, y = 60 + (i + k) * 20 + j * 44;
    const t = ((i + j + k) % 5) / 4;
    cells.push(<g key={`${i}${j}${k}`} transform={`translate(${x},${y})`} opacity={0.35 + t * 0.65}>
      <g className="cell" style={{ '--d': ((i * 3 + j * 5 + k * 7) % 11) / 11, '--in': (i + j + k) * 0.05 }}>
        <polygon points="0,0 22,-12 44,0 22,12" style={{ fill: t > 0.6 ? 'var(--amber)' : 'var(--brand)' }} />
        <polygon points="0,0 22,12 22,36 0,24" style={{ fill: t > 0.6 ? 'color-mix(in srgb, var(--amber) 70%, #000)' : 'color-mix(in srgb, var(--brand) 68%, #000)' }} />
        <polygon points="44,0 22,12 22,36 44,24" style={{ fill: t > 0.6 ? 'color-mix(in srgb, var(--amber) 85%, #000)' : 'color-mix(in srgb, var(--brand) 48%, #000)' }} />
      </g>
    </g>);
  }
  return <svg viewBox="0 0 480 400" className="login-art" aria-hidden="true">{cells}</svg>;
}

export default function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', name: '', password: '' });
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => { api('/auth/config', { auth: false }).then((c) => setDemo(c.demo)).catch((e) => setError(e.message)); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      if (mode === 'login') await login(form.username, form.password);
      else await register(form.username, form.name, form.password);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <main className="login">
      <section className="login-brand" aria-hidden={false}>
        <div className="login-brand-inner">
          <div className="login-logo"><svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true"><path d="M20 3 36 11.5v17L20 37 4 28.5v-17z" fill="none" stroke="#f2b134" strokeWidth="2.4" strokeLinejoin="round" /><path d="M4 11.5 20 20l16-8.5M20 20v17" fill="none" stroke="#f2b134" strokeWidth="2" /><rect x="22.5" y="22" width="6" height="6" fill="#d64545" /></svg><span>SmartDMart</span></div>
          <h1>Retail analytics, made clear.</h1>
          <p>Sales, profit and forecasts in one workspace.</p>
        </div>
        <CubeArt />
      </section>

      <section className="login-form-wrap">
        <form className="login-form" onSubmit={submit} noValidate>
          <h2>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>

          <label className="field">Username
            <input autoComplete="username" autoCapitalize="none" required value={form.username} onChange={set('username')} placeholder="e.g. priya.s" />
          </label>
          {mode === 'register' && (
            <label className="field">Full name <span className="opt">(optional)</span>
              <input autoComplete="name" value={form.name} onChange={set('name')} />
            </label>
          )}
          <label className="field">Password
            <span className="pw">
              <input type={show ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required value={form.password} onChange={set('password')} />
              <button type="button" className="btn small ghost" onClick={() => setShow((s) => !s)} aria-pressed={show}>{show ? 'Hide' : 'Show'}</button>
            </span>
            {mode === 'register' && <small className="muted">8+ characters, letters and numbers</small>}
          </label>

          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn primary center" disabled={busy || !form.username || !form.password}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>

          <p className="switch">
            {mode === 'login' ? 'New here?' : 'Already registered?'}{' '}
            <button type="button" className="link-btn" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>{mode === 'login' ? 'Create an account' : 'Sign in'}</button>
          </p>

          {demo && mode === 'login' && (
            <div className="demo-box">
              <b>Quick sign-in</b>
              
              <div className="chips">
                {demo.map((d) => <button type="button" key={d.username} className="chip" onClick={() => setForm({ username: d.username, name: '', password: d.password })}>{d.username} · {d.role}</button>)}
              </div>
            </div>
          )}
        </form>
      </section>
    </main>
  );
}
