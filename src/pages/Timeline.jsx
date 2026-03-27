import React, { useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell
} from 'recharts';
import { Clock, AlertTriangle, TrendingDown } from 'lucide-react';
import { useApi, formatNumber, getCountryFlag, getStatusColor } from '../hooks/useApi';

const PERIODS = [
  { value: '24h', label: '24 Hours' },
  { value: '3d', label: '3 Days' },
  { value: '30d', label: '30 Days' },
  { value: '90d', label: '90 Days' },
  { value: '1y', label: '1 Year' },
];

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-card p-3 rounded-lg border border-slate-700/50 text-xs">
      <p className="text-slate-300 font-medium mb-1.5">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 mb-0.5">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-slate-400">{p.name}:</span>
          <span className="text-slate-200 font-medium">{formatNumber(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Timeline() {
  const [period, setPeriod] = useState('30d');
  const { data, loading } = useApi(`/timeline/${period}`, [period]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Period selector */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-200">Timeline Analysis</h2>
          <p className="text-xs text-slate-500 mt-1">Tracking authentication results over time</p>
        </div>
        <div className="flex gap-1 bg-slate-800/30 rounded-xl p-1 border border-slate-700/30">
          {PERIODS.map(p => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                period === p.value
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="skeleton h-80" />
      ) : (
        <>
          {/* Main timeline chart */}
          <div className="glass-card p-5">
            <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
              <Clock size={16} className="text-green-400" />
              Pass vs Fail — {PERIODS.find(p => p.value === period)?.label}
            </h3>
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={data?.timeline || []}>
                <defs>
                  <linearGradient id="tPassGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="tFailGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ef4444" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="tQuarGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,41,59,0.4)" />
                <XAxis
                  dataKey="time_bucket"
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  tickFormatter={v => {
                    if (!v) return '';
                    if (period === '24h' || period === '3d') return v.split(' ')[1] || v;
                    return v.split(' ')[0]?.slice(5) || v;
                  }}
                />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="passed" stroke="#10b981" fill="url(#tPassGrad)" name="Passed" stackId="1" />
                <Area type="monotone" dataKey="quarantined" stroke="#f59e0b" fill="url(#tQuarGrad)" name="Quarantined" stackId="1" />
                <Area type="monotone" dataKey="rejected" stroke="#ef4444" fill="url(#tFailGrad)" name="Rejected" stackId="1" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Failure breakdown chart */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="glass-card p-5">
              <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
                <TrendingDown size={16} className="text-red-400" />
                DKIM vs SPF Failures
              </h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={data?.timeline || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,41,59,0.4)" />
                  <XAxis
                    dataKey="time_bucket"
                    tick={{ fontSize: 9, fill: '#64748b' }}
                    tickFormatter={v => v?.split(' ')[0]?.slice(5) || ''}
                  />
                  <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="dkim_fail" name="DKIM Fail" fill="#ef4444" opacity={0.8} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="spf_fail" name="SPF Fail" fill="#f59e0b" opacity={0.8} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Failure details */}
            <div className="glass-card p-5">
              <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
                <AlertTriangle size={16} className="text-amber-400" />
                Failure Details — Top Sources
              </h3>
              <div className="space-y-2 max-h-[280px] overflow-y-auto">
                {(data?.failures || []).slice(0, 15).map((f, i) => (
                  <div key={i} className="p-3 rounded-lg bg-slate-800/20 border border-slate-700/20 hover:border-slate-600/30 transition">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span>{getCountryFlag(f.country_code)}</span>
                        <span className="text-xs font-mono text-slate-300">{f.source_ip}</span>
                      </div>
                      <span className="text-xs font-medium text-slate-400">{formatNumber(f.message_count)} msgs</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="flex items-center gap-1">
                        <span className="status-dot" style={{ background: getStatusColor(f.dkim_result) }} />
                        DKIM: {f.dkim_result}
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="status-dot" style={{ background: getStatusColor(f.spf_result) }} />
                        SPF: {f.spf_result}
                      </span>
                      <span className="text-slate-600">{f.as_org || ''}</span>
                    </div>
                    {f.failure_reason && (
                      <p className="text-[10px] text-red-400/70 mt-1 leading-relaxed">{f.failure_reason}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
