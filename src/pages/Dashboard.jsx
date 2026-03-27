import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, Legend
} from 'recharts';
import { Shield, ShieldCheck, ShieldAlert, Mail, Globe, Clock, TrendingUp, AlertTriangle } from 'lucide-react';
import { useApi, formatNumber, getCountryFlag } from '../hooks/useApi';
import { Link } from 'react-router-dom';

const COLORS = {
  pass: '#10b981',
  fail: '#ef4444',
  quarantine: '#f59e0b',
  none: '#4ade80',  // delivered
  reject: '#ef4444',
  other: '#64748b',
};

function StatCard({ icon: Icon, label, value, sub, color = 'blue', trend }) {
  const colorMap = {
    blue: 'from-green-500/10 to-green-600/5 border-green-500/20 text-green-400',
    green: 'from-emerald-500/10 to-emerald-600/5 border-emerald-500/20 text-emerald-400',
    red: 'from-red-500/10 to-red-600/5 border-red-500/20 text-red-400',
    yellow: 'from-amber-500/10 to-amber-600/5 border-amber-500/20 text-amber-400',
    purple: 'from-purple-500/10 to-purple-600/5 border-purple-500/20 text-purple-400',
  };
  const c = colorMap[color];

  return (
    <div className={`glass-card glow-border p-5 bg-gradient-to-br ${c} border`}>
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2 rounded-lg bg-gradient-to-br ${c}`}>
          <Icon size={20} />
        </div>
        {trend && (
          <div className="flex items-center gap-1 text-xs">
            <TrendingUp size={12} />
            <span>{trend}</span>
          </div>
        )}
      </div>
      <div className="text-2xl font-bold tracking-tight font-data">
        {value}
      </div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
      {sub && <div className="text-[10px] text-slate-600 mt-0.5">{sub}</div>}
    </div>
  );
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-card p-3 rounded-lg border border-slate-700/50 text-xs">
      <p className="text-slate-300 font-medium mb-1">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-slate-400">{p.name}:</span>
          <span className="text-slate-200 font-medium">{formatNumber(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { data, loading } = useApi('/dashboard');
  const { data: timeData } = useApi('/timeline/30d');
  const { data: geoData } = useApi('/geo?period=30d');

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="skeleton h-32" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="skeleton h-80" />
          <div className="skeleton h-80" />
        </div>
      </div>
    );
  }

  const pieData = [
    { name: 'DKIM Pass', value: data.dkimStats?.pass || 0 },
    { name: 'DKIM Fail', value: data.dkimStats?.fail || 0 },
    { name: 'DKIM Other', value: data.dkimStats?.other || 0 },
  ].filter(d => d.value > 0);

  const spfPieData = [
    { name: 'SPF Pass', value: data.spfStats?.pass || 0 },
    { name: 'SPF Fail', value: data.spfStats?.fail || 0 },
    { name: 'SPF Other', value: data.spfStats?.other || 0 },
  ].filter(d => d.value > 0);

  const pieColors = ['#10b981', '#ef4444', '#64748b'];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          icon={Mail}
          label="Total Messages"
          value={formatNumber(data.totalRecords)}
          sub={`${data.totalReports} reports processed`}
          color="blue"
        />
        <StatCard
          icon={ShieldCheck}
          label="DMARC Pass Rate"
          value={`${data.passRate}%`}
          sub="Combined DKIM + SPF"
          color="green"
        />
        <StatCard
          icon={Shield}
          label="DKIM Pass Rate"
          value={data.dkimStats?.total > 0 ? `${((data.dkimStats.pass / data.dkimStats.total) * 100).toFixed(1)}%` : '—'}
          color="blue"
        />
        <StatCard
          icon={ShieldAlert}
          label="SPF Pass Rate"
          value={data.spfStats?.total > 0 ? `${((data.spfStats.pass / data.spfStats.total) * 100).toFixed(1)}%` : '—'}
          color="purple"
        />
        <StatCard
          icon={Globe}
          label="Domains Monitored"
          value={data.totalDomains}
          color="yellow"
        />
      </div>

      <div className="gradient-line" />

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Timeline area chart */}
        <div className="lg:col-span-2 glass-card p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <Clock size={16} className="text-green-400" />
            Message Volume — Last 30 Days
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={timeData?.timeline || []}>
              <defs>
                <linearGradient id="passGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="failGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,41,59,0.4)" />
              <XAxis
                dataKey="time_bucket"
                tick={{ fontSize: 10, fill: '#64748b' }}
                tickFormatter={v => v?.split(' ')[0]?.slice(5) || v}
              />
              <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="passed" stroke="#10b981" fill="url(#passGrad)" name="Passed" />
              <Area type="monotone" dataKey="failed" stroke="#ef4444" fill="url(#failGrad)" name="Failed" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* DKIM / SPF donut charts */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <Shield size={16} className="text-green-400" />
            Authentication Results
          </h3>
          <div className="space-y-6">
            <div>
              <p className="text-xs text-slate-500 mb-2 text-center">DKIM</p>
              <ResponsiveContainer width="100%" height={120}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={35} outerRadius={55} dataKey="value" paddingAngle={2}>
                    {pieData.map((_, i) => <Cell key={i} fill={pieColors[i]} />)}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-2 text-center">SPF</p>
              <ResponsiveContainer width="100%" height={120}>
                <PieChart>
                  <Pie data={spfPieData} cx="50%" cy="50%" innerRadius={35} outerRadius={55} dataKey="value" paddingAngle={2}>
                    {spfPieData.map((_, i) => <Cell key={i} fill={pieColors[i]} />)}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-center gap-4 text-xs">
              {['Pass', 'Fail', 'Other'].map((label, i) => (
                <div key={label} className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ background: pieColors[i] }} />
                  <span className="text-slate-400">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom row: Disposition + Geo */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Disposition breakdown */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-400" />
            Message Disposition
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.dispositionStats || []} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,41,59,0.4)" />
              <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} />
              <YAxis
                type="category"
                dataKey="disposition"
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                width={90}
                tickFormatter={v => v === 'none' ? 'Delivered' : v === 'quarantine' ? 'Quarantined' : v === 'reject' ? 'Rejected' : v}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="total" name="Messages" radius={[0, 6, 6, 0]}>
                {(data.dispositionStats || []).map((entry, i) => (
                  <Cell key={i} fill={COLORS[entry.disposition] || COLORS.other} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Top countries */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <Globe size={16} className="text-emerald-400" />
            Top Sending Countries
          </h3>
          <div className="space-y-2 max-h-[240px] overflow-y-auto">
            {(geoData?.countries || []).slice(0, 10).map((c, i) => {
              const passRate = c.total_messages > 0 ? (c.passed / c.total_messages) * 100 : 0;
              return (
                <div key={c.country_code || i} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-800/30 transition">
                  <span className="text-lg">{getCountryFlag(c.country_code)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-300 truncate">{c.country_name || c.country_code}</span>
                      <span className="text-xs text-slate-500">{formatNumber(c.total_messages)} msgs</span>
                    </div>
                    <div className="mt-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${passRate}%`,
                          background: passRate > 90 ? '#10b981' : passRate > 70 ? '#f59e0b' : '#ef4444',
                        }}
                      />
                    </div>
                  </div>
                  <span className="text-xs font-mono" style={{ color: passRate > 90 ? '#10b981' : passRate > 70 ? '#f59e0b' : '#ef4444' }}>
                    {passRate.toFixed(0)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Recent reports */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
          <FileText size={16} className="text-green-400" />
          Recent Reports
        </h3>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Domain</th>
                <th>Reporter</th>
                <th>Period</th>
                <th>Policy</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(data.recentReports || []).map(r => (
                <tr key={r.id}>
                  <td>
                    <Link to={`/domains/${r.domain}`} className="text-green-400 hover:text-green-300 transition">
                      {r.domain}
                    </Link>
                  </td>
                  <td className="text-slate-400">{r.org_name}</td>
                  <td className="text-slate-500 text-xs font-mono">
                    {r.begin_date?.split('T')[0]} → {r.end_date?.split('T')[0]}
                  </td>
                  <td>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      r.policy_p === 'reject' ? 'bg-red-500/10 text-red-400' :
                      r.policy_p === 'quarantine' ? 'bg-amber-500/10 text-amber-400' :
                      'bg-green-500/10 text-green-400'
                    }`}>
                      {r.policy_p || 'none'}
                    </span>
                  </td>
                  <td>
                    <Link
                      to={`/reports/${r.id}`}
                      className="text-xs text-slate-500 hover:text-green-400 transition"
                    >
                      View Details →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function FileText(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={props.size || 24} height={props.size || 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}
