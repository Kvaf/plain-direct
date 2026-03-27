import React, { useState } from 'react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts';
import { AlertTriangle, Shield, XCircle, Info } from 'lucide-react';
import { useApi, formatNumber, getCountryFlag, getStatusColor } from '../hooks/useApi';

const PERIODS = [
  { value: '24h', label: '24h' },
  { value: '3d', label: '3 Days' },
  { value: '30d', label: '30 Days' },
  { value: '90d', label: '90 Days' },
  { value: '1y', label: '1 Year' },
];

const TYPE_COLORS = {
  'Both Failed': '#ef4444',
  'DKIM Failed': '#f97316',
  'SPF Failed': '#f59e0b',
  'Unknown': '#64748b',
};

function FailureExplainer({ type }) {
  const explanations = {
    'SPF fail': 'The sending server\'s IP address is not listed in the domain\'s SPF record. This means the server is not authorized to send email for this domain. Fix: Add the IP or include the service in your SPF record.',
    'DKIM fail': 'The DKIM signature on the email could not be verified. The signature may be invalid, the signing key may have changed, or the message was modified in transit. Fix: Ensure your DKIM keys are correctly published and email content is not being altered.',
    'Both Failed': 'Neither SPF nor DKIM authentication passed. This is the most severe failure and messages will likely be rejected or quarantined. Fix: Verify both SPF records and DKIM signing configuration.',
    'SPF softfail': 'The SPF record says the IP is probably not authorized (~all). Mail servers may still accept these. Fix: Update SPF to explicitly include this source or change to -all.',
    'Alignment': 'The authentication passed but the domain in the From header doesn\'t match the SPF or DKIM domain. DMARC requires alignment between these domains.',
    'Forwarding': 'Email forwarding breaks SPF because the forwarding server\'s IP isn\'t in the original SPF record. ARC (Authenticated Received Chain) helps mitigate this.',
  };

  return (
    <div className="glass-card p-4 border-l-2 border-amber-500/50">
      <div className="flex items-start gap-2">
        <Info size={16} className="text-amber-400 mt-0.5 shrink-0" />
        <div>
          <p className="text-xs font-medium text-amber-300 mb-1">Why does this happen?</p>
          <p className="text-xs text-slate-400 leading-relaxed">
            {explanations[type] || 'Authentication failure detected. Review your DNS records and email configuration.'}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function Failures() {
  const [period, setPeriod] = useState('30d');
  const [selectedType, setSelectedType] = useState(null);
  const { data, loading } = useApi(`/failures?period=${period}`, [period]);

  if (loading) {
    return <div className="space-y-4">{[...Array(3)].map((_, i) => <div key={i} className="skeleton h-40" />)}</div>;
  }

  const byType = data?.byType || [];
  const byIp = data?.byIp || [];
  const byReason = data?.byReason || [];

  const totalFailures = byType.reduce((sum, t) => sum + t.total, 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-200">Failure Analysis</h2>
          <p className="text-xs text-slate-500 mt-1">
            {formatNumber(totalFailures)} authentication failures detected
          </p>
        </div>
        <div className="flex gap-1 bg-slate-800/30 rounded-xl p-1 border border-slate-700/30">
          {PERIODS.map(p => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                period === p.value
                  ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Failure type breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <XCircle size={16} className="text-red-400" />
            Failure Types
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={byType}
                cx="50%"
                cy="50%"
                innerRadius={45}
                outerRadius={80}
                dataKey="total"
                nameKey="failure_type"
                paddingAngle={3}
                onClick={(_, idx) => setSelectedType(byType[idx]?.failure_type)}
              >
                {byType.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={TYPE_COLORS[entry.failure_type] || '#64748b'}
                    stroke="transparent"
                    style={{ cursor: 'pointer' }}
                  />
                ))}
              </Pie>
              <Tooltip formatter={(value) => formatNumber(value)} />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-2 mt-3">
            {byType.map((t, i) => (
              <button
                key={i}
                onClick={() => setSelectedType(t.failure_type)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition text-xs ${
                  selectedType === t.failure_type ? 'bg-slate-700/30 border border-slate-600/30' : 'hover:bg-slate-800/30'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: TYPE_COLORS[t.failure_type] }} />
                  <span className="text-slate-300">{t.failure_type}</span>
                </div>
                <span className="font-mono text-slate-400">{formatNumber(t.total)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Why explanations */}
        <div className="lg:col-span-2 space-y-4">
          {selectedType && <FailureExplainer type={selectedType} />}

          {/* Top failure reasons */}
          <div className="glass-card p-5">
            <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-400" />
              What's causing failures
            </h3>
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {byReason.map((r, i) => {
                const reasons = (r.failure_reason || '').split(' | ');
                return (
                  <div key={i} className="p-3 rounded-lg bg-slate-800/20 border border-slate-700/20">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-red-400">{formatNumber(r.total)} messages affected</span>
                    </div>
                    <div className="space-y-1">
                      {reasons.map((reason, j) => (
                        <p key={j} className="text-[11px] text-slate-400 leading-relaxed pl-3 border-l border-slate-700/50">
                          {reason}
                        </p>
                      ))}
                    </div>
                  </div>
                );
              })}
              {byReason.length === 0 && (
                <p className="text-xs text-slate-500 text-center py-8">No failure reasons logged</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Top failing IPs table */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
          <Shield size={16} className="text-red-400" />
          Top Failing Source IPs
        </h3>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Source IP</th>
                <th>Country</th>
                <th>Organization</th>
                <th>DKIM</th>
                <th>SPF</th>
                <th>Disposition</th>
                <th>Messages</th>
                <th>Failure Reason</th>
              </tr>
            </thead>
            <tbody>
              {byIp.map((row, i) => (
                <tr key={i}>
                  <td className="font-mono text-xs text-slate-300">{row.source_ip}</td>
                  <td>
                    <span className="flex items-center gap-1.5">
                      <span>{getCountryFlag(row.country_code)}</span>
                      <span className="text-xs text-slate-400">{row.country_name || row.country_code || '—'}</span>
                    </span>
                  </td>
                  <td className="text-xs text-slate-400 max-w-[140px] truncate">{row.as_org || '—'}</td>
                  <td>
                    <span className="px-2 py-0.5 rounded text-xs font-medium"
                      style={{ background: `${getStatusColor(row.dkim_result)}15`, color: getStatusColor(row.dkim_result) }}>
                      {row.dkim_result}
                    </span>
                  </td>
                  <td>
                    <span className="px-2 py-0.5 rounded text-xs font-medium"
                      style={{ background: `${getStatusColor(row.spf_result)}15`, color: getStatusColor(row.spf_result) }}>
                      {row.spf_result}
                    </span>
                  </td>
                  <td>
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      row.disposition === 'reject' ? 'bg-red-500/10 text-red-400' :
                      row.disposition === 'quarantine' ? 'bg-amber-500/10 text-amber-400' :
                      'bg-green-500/10 text-green-400'
                    }`}>{row.disposition}</span>
                  </td>
                  <td className="text-xs font-mono">{formatNumber(row.total)}</td>
                  <td className="text-[10px] text-slate-500 max-w-[200px] truncate">{row.failure_reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
