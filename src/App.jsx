import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useLocation, Navigate } from 'react-router-dom';
import {
  LayoutDashboard, Globe, FileText, AlertTriangle, MapPin,
  Upload, Shield, Menu, X, RefreshCw, ChevronRight, Settings, LogOut
} from 'lucide-react';
import { AuthProvider, useAuth, getAuthHeaders } from './hooks/useAuth';
import Dashboard from './pages/Dashboard';
import Domains from './pages/Domains';
import DomainDetail from './pages/DomainDetail';
import Timeline from './pages/Timeline';
import Failures from './pages/Failures';
import GeoView from './pages/GeoView';
import ReportDetail from './pages/ReportDetail';
import UploadPage from './pages/UploadPage';
import Login from './pages/Login';
import Admin from './pages/Admin';

const navItems = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/domains', icon: Globe, label: 'Domains' },
  { path: '/timeline', icon: FileText, label: 'Timeline' },
  { path: '/failures', icon: AlertTriangle, label: 'Failures' },
  { path: '/geo', icon: MapPin, label: 'Geography' },
  { path: '/upload', icon: Upload, label: 'Upload' },
];

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#050507' }}>
      <div className="text-slate-500">Loading...</div>
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function Sidebar({ collapsed, setCollapsed }) {
  const { user, logout } = useAuth();

  return (
    <aside
      className={`fixed left-0 top-0 h-full z-40 transition-all duration-300 ${
        collapsed ? 'w-[72px]' : 'w-[240px]'
      }`}
      style={{
        background: 'rgba(5, 5, 7, 0.95)',
        borderRight: '1px solid rgba(74, 222, 128, 0.08)',
        backdropFilter: 'blur(20px)',
      }}
    >
      {/* Logo area */}
      <div className="flex items-center h-16 px-4 border-b" style={{ borderColor: 'rgba(74, 222, 128, 0.08)' }}>
        {collapsed ? (
          <button onClick={() => setCollapsed(false)} className="p-2 rounded-lg hover:bg-white/5 transition">
            <Menu size={20} className="text-slate-400" />
          </button>
        ) : (
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-3">
              <Shield size={24} className="text-green-400" />
              <span className="text-lg font-semibold text-white tracking-tight">plain.direct</span>
            </div>
            <button onClick={() => setCollapsed(true)} className="p-1.5 rounded-lg hover:bg-white/5 transition">
              <X size={16} className="text-slate-500" />
            </button>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="mt-4 px-3 space-y-1">
        {navItems.map(({ path, icon: Icon, label }) => (
          <NavLink
            key={path}
            to={path}
            end={path === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group ${
                isActive
                  ? 'bg-green-500/10 text-green-400'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={20} className={isActive ? 'text-green-400' : 'text-slate-500 group-hover:text-slate-300'} />
                {!collapsed && (
                  <span className="text-sm font-medium">{label}</span>
                )}
                {!collapsed && isActive && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-green-400" />
                )}
              </>
            )}
          </NavLink>
        ))}

        {/* Admin link - only for admins */}
        {user?.role === 'admin' && (
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group ${
                isActive
                  ? 'bg-green-500/10 text-green-400'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Settings size={20} className={isActive ? 'text-green-400' : 'text-slate-500 group-hover:text-slate-300'} />
                {!collapsed && (
                  <span className="text-sm font-medium">Admin</span>
                )}
                {!collapsed && isActive && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-green-400" />
                )}
              </>
            )}
          </NavLink>
        )}
      </nav>

      {/* User info + logout */}
      {!collapsed && (
        <div className="absolute bottom-6 left-3 right-3">
          <div className="glass-card p-3 rounded-xl">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs font-medium text-slate-300">{user?.email}</span>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-slate-500">{user?.role}</p>
              <button
                onClick={logout}
                className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-red-400 transition-colors"
              >
                <LogOut size={10} />
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

function PageHeader() {
  const location = useLocation();
  const allNav = [...navItems, { path: '/admin', label: 'Admin' }];
  const current = allNav.find(n => n.path === location.pathname) || navItems[0];

  return (
    <header className="h-16 flex items-center justify-between px-6 border-b" style={{ borderColor: 'rgba(74, 222, 128, 0.08)' }}>
      <div className="flex items-center gap-2 text-sm">
        <Shield size={16} className="text-green-400" />
        <span className="text-slate-500">Plain Direct</span>
        <ChevronRight size={14} className="text-slate-600" />
        <span className="text-slate-200 font-medium">{current.label}</span>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={() => fetch('/api/fetch-now', { method: 'POST', headers: getAuthHeaders() })}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium
            bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-all border border-green-500/20"
        >
          <RefreshCw size={14} />
          Fetch Reports
        </button>
      </div>
    </header>
  );
}

function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-mesh noise-overlay" style={{ background: '#050507' }}>
      <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />
      <div
        className={`transition-all duration-300 ${collapsed ? 'ml-[72px]' : 'ml-[240px]'}`}
        style={{ minHeight: '100vh' }}
      >
        <PageHeader />
        <main className="p-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/domains" element={<Domains />} />
            <Route path="/domains/:domain" element={<DomainDetail />} />
            <Route path="/timeline" element={<Timeline />} />
            <Route path="/failures" element={<Failures />} />
            <Route path="/geo" element={<GeoView />} />
            <Route path="/upload" element={<UploadPage />} />
            <Route path="/reports/:id" element={<ReportDetail />} />
            {user?.role === 'admin' && (
              <Route path="/admin" element={<Admin />} />
            )}
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/*" element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          } />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
