import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

export default function Admin() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [activity, setActivity] = useState([]);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    Promise.all([api('/admin/users'), api('/admin/activity')]).then(([u, a]) => { setUsers(u.users); setActivity(a.activity); }).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const act = async (fn) => { setError(''); try { await fn(); load(); } catch (e) { setError(e.message); } };
  return (
    <section className="admin" aria-label="Administration">
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="panel">
        <h3>Users <small>{users.length} accounts</small></h3>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Created</th><th>Last sign-in</th><th /></tr></thead>
          <tbody>{users.map((u) => (
            <tr key={u.id}><td><b>{u.username}</b>{u.id === user.id && <small className="muted"> (you)</small>}</td><td>{u.name || '—'}</td>
              <td><select value={u.role} disabled={u.id === user.id} aria-label={`Role of ${u.username}`} onChange={(e) => act(() => api('/admin/users/' + u.id, { method: 'PATCH', body: { role: e.target.value } }))}><option value="analyst">analyst</option><option value="admin">admin</option></select></td>
              <td>{u.created_at}</td><td>{u.last_login || 'never'}</td>
              <td>{u.id !== user.id && <button type="button" className="btn small ghost danger" onClick={() => { if (window.confirm(`Delete ${u.username}?`)) act(() => api('/admin/users/' + u.id, { method: 'DELETE' })); }}>Delete</button>}</td></tr>))}</tbody>
        </table></div>
      </div>
      <div className="panel">
        <div className="panel-head"><h3>Recent activity</h3><button type="button" className="btn small" onClick={load}>Refresh</button></div>
        <div className="tbl-wrap"><table className="tbl compact">
          <thead><tr><th>Time (UTC)</th><th>User</th><th>Action</th><th>Detail</th></tr></thead>
          <tbody>{activity.map((a) => <tr key={a.id}><td>{a.at}</td><td>{a.username || '—'}</td><td><span className={'tag ' + (a.action === 'login_failed' ? 'rejected' : 'default')}>{a.action}</span></td><td>{a.detail}</td></tr>)}</tbody>
        </table></div>
      </div>
    </section>
  );
}
