import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Download, FileText, Shield, AlertTriangle } from 'lucide-react';
import { useApi, formatNumber, getCountryFlag, getStatusColor, getDispositionLabel } from '../hooks/useApi';

export default function ReportDetail() {
  const { id } = useParams();
  const { data, loading } = useApi(`/reports/${id}`);

  if (loading || !data) {
    return <div className="space-y-4">{[...Array(3)].map((_, i) => <div key={i} className="skeleton h-40" />)}</div>;
  }

  const { report, records } = data;
  const totalMsgs = records.reduce((s, r) => s + r.count, 0);
  const passedMsgs = records.filter(r => r.dkim_result === 'pass' && r.spf_result === 'pass').reduce((s, r) => s + r.count, 0);
  const failedMsgs = totalMsgs - passedMsgs;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-4">
        <Link to={`/domains/${report.domain}`} className="p-2 rounded-lg hover:bg-slate-800/50 transition">
          <ArrowLeft size={20} className="text-slate-400" />
        </Link>
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-slate-200">Report Detail</h2>
          <p className="text-xs text-slate-500">
            {report.org_name} — {report.domain} — {report.begin_date?.split('T')[0]}
          </p>
        </div>
        <a
          href={`/api/reports/${id}/xml`}
          download
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs
            bg-green-500/10 text-green-400 hover:bg-green-500/20 transition border border-green-500/20"
        >
          <Download size={14} />
          Download XML
        </a>
      </div>

      {/* Report metadata */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass-card p-4">
          <div className="text-xs text-slate-500 mb-1">Reporter</div>
          <div className="text-sm font-medium text-slate-300">{report.org_name}</div>
          <div className="text-[10px] text-slate-600 mt-0.5">{report.email}</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-xs text-slate-500 mb-1">Period</div>
          <div className="text-sm font-mono text-slate-300">
            {report.begin_date?.split('T')[0]} → {report.end_date?.split('T')[0]}
          </div>
        </div>
        <div className="glass-card p-4">
          <div className="text-xs text-slate-500 mb-1">DMARC Policy</div>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
              report.policy_p === 'reject' ? 'bg-red-500/10 text-red-400' :
              report.policy_p === 'quarantine' ? 'bg-amber-500/10 text-amber-400' :
              'bg-green-500/10 text-green-400'
            }`}>{report.policy_p}</span>
            <span className="text-[10px] text-slate-600">
              DKIM: {report.policy_adkim || '—'} | SPF: {report.policy_aspf || '—'}
            </span>
          </div>
        </div>
        <div className="glass-card p-4">
          <div className="text-xs text-slate-500 mb-1">Summary</div>
          <div className="flex items-center gap-3">
            <span className="text-emerald-400 text-sm font-bold">{formatNumber(passedMsgs)}</span>
            <span className="text-slate-600">|</span>
            <span className="text-red-400 text-sm font-bold">{formatNumber(failedMsgs)}</span>
            <span className="text-slate-600 text-xs">of {formatNumber(totalMsgs)} messages</span>
          </div>
        </div>
      </div>

      {/* Records table */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
          <Shield size={16} className="text-green-400" />
          Authentication Records ({records.length})
        </h3>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Source IP</th>
                <th>Country</th>
                <th>Organization</th>
                <th>PTR</th>
                <th>DKIM</th>
                <th>DKIM Domain</th>
                <th>SPF</th>
                <th>SPF Domain</th>
                <th>Disposition</th>
                <th>Count</th>
                <th>Failure Reason</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r, i) => (
                <tr key={i} className={r.dkim_result !== 'pass' || r.spf_result !== 'pass' ? 'bg-red-500/[0.02]' : ''}>
                  <td className="font-mono text-xs text-slate-300">{r.source_ip}</td>
                  <td>
                    <span className="flex items-center gap-1.5">
                      <span>{getCountryFlag(r.country_code)}</span>
                      <span className="text-xs text-slate-400">{r.country_name || '—'}</span>
                    </span>
                  </td>
                  <td className="text-xs text-slate-400 max-w-[120px] truncate">{r.as_org || '—'}</td>
                  <td className="text-[10px] text-slate-500 max-w-[140px] truncate font-mono">{r.ptr_record || '—'}</td>
                  <td>
                    <span className="px-2 py-0.5 rounded text-xs font-medium"
                      style={{ background: `${getStatusColor(r.dkim_result)}15`, color: getStatusColor(r.dkim_result) }}>
                      {r.dkim_result}
                    </span>
                  </td>
                  <td className="text-[10px] text-slate-500 font-mono">{r.dkim_domain || '—'}</td>
                  <td>
                    <span className="px-2 py-0.5 rounded text-xs font-medium"
                      style={{ background: `${getStatusColor(r.spf_result)}15`, color: getStatusColor(r.spf_result) }}>
                      {r.spf_result}
                    </span>
                  </td>
                  <td className="text-[10px] text-slate-500 font-mono">{r.spf_domain || '—'}</td>
                  <td>
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      r.disposition === 'reject' ? 'bg-red-500/10 text-red-400' :
                      r.disposition === 'quarantine' ? 'bg-amber-500/10 text-amber-400' :
                      'bg-green-500/10 text-green-400'
                    }`}>{getDispositionLabel(r.disposition)}</span>
                  </td>
                  <td className="text-xs font-mono">{formatNumber(r.count)}</td>
                  <td>
                    {r.failure_reason && (
                      <div className="max-w-[200px]">
                        <p className="text-[10px] text-red-400/70 truncate" title={r.failure_reason}>
                          {r.failure_reason}
                        </p>
                      </div>
                    )}
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
