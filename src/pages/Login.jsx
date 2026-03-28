import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Mail, Lock, ArrowRight } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-mesh noise-overlay" style={{ background: '#050507' }}>
      <div className="w-full max-w-md px-6">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-green-500/10 border border-green-500/20 mb-6">
            <Shield size={32} className="text-green-400" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">plain.direct</h1>
          <p className="text-sm text-slate-500 mt-2">DMARC Intelligence Portal</p>
        </div>

        {/* Login form */}
        <form onSubmit={handleSubmit} className="glass-card glow-border p-8 rounded-2xl">
          <h2 className="text-lg font-semibold text-white mb-6">Sign in</h2>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">Email</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-600
                    focus:outline-none focus:border-green-500/40 focus:ring-1 focus:ring-green-500/20 transition-all"
                  placeholder="admin@plain.direct"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">Password</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-600
                    focus:outline-none focus:border-green-500/40 focus:ring-1 focus:ring-green-500/20 transition-all"
                  placeholder="Enter password"
                  required
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-6 py-3 rounded-xl bg-green-500 hover:bg-green-400 text-black font-semibold
              flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Signing in...' : 'Sign in'}
            {!loading && <ArrowRight size={16} />}
          </button>
        </form>

        <p className="text-center text-xs text-slate-600 mt-8">
          Protected DMARC monitoring portal
        </p>
      </div>
    </div>
  );
}
