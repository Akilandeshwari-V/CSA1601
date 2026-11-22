import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

export default function Account() {
  const { user, logout } = useAuth();
  const [f, setF] = useState({ current: '', next: '', again: '' });
  const [msg, setMsg] = useState(null);
  const submit = async (e) => {
    e.preventDefault(); setMsg(null);
    if (f.next !== f.again) return setMsg({ bad: true, text: 'The new passwords do not match.' });
    try { await api('/auth/change-password', { method: 'POST', body: { current: f.current, next: f.next } }); setMsg({ text: 'Password changed.' }); setF({ current: '', next: '', again: '' }); }
    catch (err) { setMsg({ bad: true, text: err.message }); }
  };
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <section className="grid-2" aria-label="Account">
      <div className="panel">
        <h3>Profile</h3>
        <dl className="dl"><dt>Username</dt><dd>{user.username}</dd><dt>Name</dt><dd>{user.name || '—'}</dd><dt>Role</dt><dd><span className="tag default">{user.role}</span></dd></dl>
        <div className="btn-row"><button type="button" className="btn" onClick={() => logout()}>Sign out</button></div>
      </div>
      <form className="panel" onSubmit={submit}>
        <h3>Change password</h3>
        <label className="field">Current password<input type="password" autoComplete="current-password" value={f.current} onChange={set('current')} required /></label>
        <label className="field">New password<input type="password" autoComplete="new-password" value={f.next} onChange={set('next')} required /></label>
        <label className="field">Repeat new password<input type="password" autoComplete="new-password" value={f.again} onChange={set('again')} required /></label>
        {msg && <p className={msg.bad ? 'form-error' : 'ok'} role="status">{msg.text}</p>}
        <button className="btn primary center">Update password</button>
      </form>
    </section>
  );
}
