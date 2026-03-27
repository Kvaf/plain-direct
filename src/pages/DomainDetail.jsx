import React from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import { Shield, ArrowLeft, Download, ChevronRight } from 'lucide-react';
import { useApi, formatNumber, getCountryFlag, getStatusColor } from '../hooks/useApi';

export default function DomainDetail() {
  const { domain } = useParams();
  const { data, loading } = useApi(`/domains/${domain}`);

  if (loading || !data) {
    return <div className="space-y-4">{[...Array(4)].map((_, i) => <div key={i} className="skeleton h-40" />)}</div>;
  }

  const { domain: d, reports, stats, topSenders } = data;
  const total = stats?.total || 1;
  const dkimRate = ((stats?.dkim_pass || 0) / total * 100).toFixed(1);
  const spfRate = ((stats?.spf_pass || 0) / total * 100).toFixed(1);
  const passRate = ((stats?.both_pass || 0) / total * 100).toFixed(1);

  const dispositionData = [
    { name: 'Delivered', value: stats?.delivered || 0, color: '#4ade80' },
    { name: 'Quarantined', value: stats?.quarantined || 0, color: '#f59e0b' },
    { name: 'Rejected', value: stats?.rejected || 0, color: '#ef4444' },
  ].filter(x => x.value > 0);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/domains" className="p-2 rounded-lg hover:bg-slate-800/50 transition">
          <ArrowLeft size={20} className="text-slate-400" />
        </Link>
        <div>
          <h2 className="text-xl font-bold text-slate-200">{domain}</h2>
          <p className="text-xs text-slate-500">Domain report overview</p>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { label: 'Messages', value: formatNumber(total), color: '#4ade80' },
          { label: 'DMARC Pass', value: `${passRate}%`, color: passRate >= 90 ? '#10b981' : '#f59e0b' },
          { label: 'DKIM Pass', value: `${dkimRate}%`, color: dkimRate >= 90 ? '#10b981' : '#f59e0b' },
          { label: 'SPF Pass', value: `${spfRate}%`, color: spfRate >= 90 ? '#10b981' : '#f59e0b' },
          { label: 'Reports', value: reports?.length || 0, color: '#8b5cf6' },
        ].map((s, i) => (
          <div key={i} className="glass-card p-4">
            <div className="text-xs text-slate-500 mb-1">{s.label}</div>
            <div className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Disposition pie */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4">Message Disposition</h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={dispositionData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={3}>
                {dispositionData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip formatter={(value) => formatNumber(value)} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex justify-center gap-4 mt-2">
            {dispositionData.map(d => (
              <div key={d.name} className="flex items-center gap-1.5 text-xs">
                <div className="w-2 h-2 rounded-full" style={{ background: d.color }} />
                <span className="text-slate-400">{d.name}: {formatNumber(d.value)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Top senders table */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4">Top Sending Sources</h3>
          <div className="overflow-y-auto max-h-[280px]">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Source IP</th>
                  <th>Org</th>
                  <th>DKIM</th>
                  <th>SPF</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {(topSenders || []).map((s, i) => (
                  <tr key={i}>
                    <td className="font-mono text-xs">
                      <span className="mr-2">{getCountryFlag(s.country_code)}</span>
                      {s.source_ip}
                    </td>
                    <td className="text-slate-400 text-xs truncate max-w-[120px]">{s.as_org || '—'}</td>
                    <td>
                      <span className="status-dot" style={{ background: getStatusColor(s.dkim_result) }} />
                    </td>
                    <td>
                      <span className="status-dot" style={{ background: getStatusColor(s.spf_result) }} />
                    </td>
                    <td className="text-xs font-mono">{formatNumber(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Reports list */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-slate-300 mb-4">All Reports</h3>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Reporter</th>
                <th>Period</th>
                <th>Records</th>
                <th>Messages</th>
                <th>Policy</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(reports || []).map(r => (
                <tr key={r.id}>
                  <td className="text-slate-300">{r.org_name}</td>
                  <td className="text-xs font-mono text-slate-500">
                    {r.begin_date?.split('T')[0]} → {r.end_date?.split('T')[0]}
                  </td>
                  <td className="text-xs">{r.record_count}</td>
                  <td className="text-xs font-mono">{formatNumber(r.message_count)}</td>
                  <td>
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      r.policy_p === 'reject' ? 'bg-red-500/10 text-red-400' :
                      r.policy_p === 'quarantine' ? 'bg-amber-500/10 text-amber-400' :
                      'bg-green-500/10 text-green-400'
                    }`}>{r.policy_p}</span>
                  </td>
                  <td className="flex items-center gap-2">
                    <Link to={`/reports/${r.id}`} className="text-xs text-green-400 hover:underline">
                      Details
                    </Link>
                    <a href={`/api/reports/${r.id}/xml`} download className="text-xs text-slate-500 hover:text-slate-300">
                      <Download size={14} />
                    </a>
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
