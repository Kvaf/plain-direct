import React, { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';
import { MapPin, Globe } from 'lucide-react';
import { useApi, formatNumber, getCountryFlag } from '../hooks/useApi';

const PERIODS = [
  { value: '24h', label: '24h' },
  { value: '3d', label: '3d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: '1y', label: '1y' },
];

export default function GeoView() {
  const [period, setPeriod] = useState('30d');
  const { data, loading } = useApi(`/geo?period=${period}`, [period]);

  const countries = data?.countries || [];
  const topCountries = countries.slice(0, 20);
  const totalMessages = countries.reduce((s, c) => s + c.total_messages, 0);
  const totalFailed = countries.reduce((s, c) => s + c.failed, 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-200">Geographic Analysis</h2>
          <p className="text-xs text-slate-500 mt-1">
            Messages from {countries.length} countries, {countries.reduce((s, c) => s + c.unique_ips, 0)} unique IPs
          </p>
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

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="glass-card p-4 text-center">
          <div className="text-2xl font-bold text-green-400">{countries.length}</div>
          <div className="text-xs text-slate-500">Countries</div>
        </div>
        <div className="glass-card p-4 text-center">
          <div className="text-2xl font-bold text-emerald-400">{formatNumber(totalMessages)}</div>
          <div className="text-xs text-slate-500">Total Messages</div>
        </div>
        <div className="glass-card p-4 text-center">
          <div className="text-2xl font-bold text-red-400">{formatNumber(totalFailed)}</div>
          <div className="text-xs text-slate-500">Failed Messages</div>
        </div>
      </div>

      {/* Bar chart of top countries */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
          <Globe size={16} className="text-green-400" />
          Top Sending Countries
        </h3>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={topCountries} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,41,59,0.4)" />
            <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} />
            <YAxis
              type="category"
              dataKey="country_name"
              width={120}
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              tickFormatter={(v) => v || 'Unknown'}
            />
            <Tooltip
              formatter={(value) => formatNumber(value)}
              contentStyle={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 8 }}
            />
            <Bar dataKey="passed" name="Passed" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
            <Bar dataKey="failed" name="Failed" stackId="a" fill="#ef4444" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Country detail table */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
          <MapPin size={16} className="text-emerald-400" />
          Detailed Country Breakdown
        </h3>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Country</th>
                <th>Messages</th>
                <th>Passed</th>
                <th>Failed</th>
                <th>Pass Rate</th>
                <th>Unique IPs</th>
                <th>Health</th>
              </tr>
            </thead>
            <tbody>
              {countries.map((c, i) => {
                const rate = c.total_messages > 0 ? (c.passed / c.total_messages) * 100 : 0;
                return (
                  <tr key={c.country_code || i}>
                    <td>
                      <span className="flex items-center gap-2">
                        <span className="text-lg">{getCountryFlag(c.country_code)}</span>
                        <span className="text-sm text-slate-300">{c.country_name || c.country_code || 'Unknown'}</span>
                        <span className="text-[10px] text-slate-600 font-mono">{c.country_code}</span>
                      </span>
                    </td>
                    <td className="font-mono text-xs">{formatNumber(c.total_messages)}</td>
                    <td className="font-mono text-xs text-emerald-400">{formatNumber(c.passed)}</td>
                    <td className="font-mono text-xs text-red-400">{formatNumber(c.failed)}</td>
                    <td>
                      <span className="font-mono text-xs" style={{
                        color: rate > 90 ? '#10b981' : rate > 70 ? '#f59e0b' : '#ef4444'
                      }}>
                        {rate.toFixed(1)}%
                      </span>
                    </td>
                    <td className="text-xs text-slate-400">{c.unique_ips}</td>
                    <td>
                      <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${rate}%`,
                            background: rate > 90 ? '#10b981' : rate > 70 ? '#f59e0b' : '#ef4444',
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
