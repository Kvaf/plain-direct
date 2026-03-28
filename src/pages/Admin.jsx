import React, { useState, useEffect } from 'react';
import { Users, Globe, Plus, Trash2, Shield, AlertTriangle } from 'lucide-react';
import { getAuthHeaders } from '../hooks/useAuth';

function AdminSection({ title, icon: Icon, children }) {
  return (
    <div className="glass-card glow-border rounded-2xl overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b" style={{ borderColor: 'rgba(74, 222, 128, 0.08)' }}>
        <Icon size={20} className="text-green-400" />
        <h2 className="text-lg font-semibold text-white">{title}</h2>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

function UserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('viewer');
  const [error, setError] = useState('');

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/admin/users', { headers: getAuthHeaders() });
      const data = await res.json();
      setUsers(data.users || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsers(); }, []);

  const addUser = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ email, password, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setEmail('');
      setPassword('');
      setRole('viewer');
      fetchUsers();
    } catch (e) {
      setError(e.message);
    }
  };

  const deleteUser = async (id) => {
    if (!confirm('Delete this user?')) return;
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      fetchUsers();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <AdminSection title="Users" icon={Users}>
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {/* Add user form */}
      <form onSubmit={addUser} className="flex flex-wrap gap-3 mb-6">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          required
          className="flex-1 min-w-[200px] px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-600
            focus:outline-none focus:border-green-500/40 text-sm"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          required
          className="flex-1 min-w-[150px] px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-600
            focus:outline-none focus:border-green-500/40 text-sm"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm
            focus:outline-none focus:border-green-500/40"
        >
          <option value="viewer">Viewer</option>
          <option value="admin">Admin</option>
        </select>
        <button
          type="submit"
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-green-500/10 text-green-400 border border-green-500/20
            hover:bg-green-500/20 transition-all text-sm font-medium"
        >
          <Plus size={16} /> Add User
        </button>
      </form>

      {/* Users table */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="skeleton h-12 rounded-lg" />)}
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map(user => (
              <tr key={user.id}>
                <td className="text-slate-200">{user.email}</td>
                <td>
                  <span className={`px-2 py-1 rounded-lg text-xs font-medium ${
                    user.role === 'admin'
                      ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                      : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                  }`}>
                    {user.role}
                  </span>
                </td>
                <td className="text-slate-500 text-sm font-data">
                  {new Date(user.created_at).toLocaleDateString()}
                </td>
                <td>
                  <button
                    onClick={() => deleteUser(user.id)}
                    className="p-2 rounded-lg hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-all"
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </AdminSection>
  );
}

function DomainManagement() {
  const [domains, setDomains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [domain, setDomain] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');

  const fetchDomains = async () => {
    try {
      const res = await fetch('/api/admin/domains', { headers: getAuthHeaders() });
      const data = await res.json();
      setDomains(data.domains || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDomains(); }, []);

  const addDomain = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch('/api/admin/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ domain, display_name: displayName || domain }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDomain('');
      setDisplayName('');
      fetchDomains();
    } catch (e) {
      setError(e.message);
    }
  };

  const deleteDomain = async (id) => {
    if (!confirm('Delete this domain and all its reports?')) return;
    try {
      const res = await fetch(`/api/admin/domains/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      fetchDomains();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <AdminSection title="Domains" icon={Globe}>
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {/* Add domain form */}
      <form onSubmit={addDomain} className="flex flex-wrap gap-3 mb-6">
        <input
          type="text"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="example.com"
          required
          className="flex-1 min-w-[200px] px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-600
            focus:outline-none focus:border-green-500/40 text-sm"
        />
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Display name (optional)"
          className="flex-1 min-w-[150px] px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-600
            focus:outline-none focus:border-green-500/40 text-sm"
        />
        <button
          type="submit"
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-green-500/10 text-green-400 border border-green-500/20
            hover:bg-green-500/20 transition-all text-sm font-medium"
        >
          <Plus size={16} /> Add Domain
        </button>
      </form>

      {/* Domains table */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="skeleton h-12 rounded-lg" />)}
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Domain</th>
              <th>Display Name</th>
              <th>Reports</th>
              <th>Messages</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {domains.map(d => (
              <tr key={d.id}>
                <td className="text-slate-200 font-medium">{d.domain}</td>
                <td className="text-slate-400">{d.display_name}</td>
                <td className="text-slate-400 font-data">{d.report_count || 0}</td>
                <td className="text-slate-400 font-data">{d.total_messages || 0}</td>
                <td>
                  <button
                    onClick={() => deleteDomain(d.id)}
                    className="p-2 rounded-lg hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-all"
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </AdminSection>
  );
}

export default function Admin() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3 mb-2">
        <Shield size={24} className="text-green-400" />
        <h1 className="text-2xl font-bold text-white">Admin Panel</h1>
      </div>
      <p className="text-slate-500 text-sm">Manage users and domains for the DMARC portal.</p>

      <UserManagement />
      <DomainManagement />
    </div>
  );
}
