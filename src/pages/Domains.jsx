import React from 'react';
import { Link } from 'react-router-dom';
import { Globe, ChevronRight, Shield, Mail } from 'lucide-react';
import { useApi, formatNumber } from '../hooks/useApi';

export default function Domains() {
  const { data, loading } = useApi('/domains');

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => <div key={i} className="skeleton h-24" />)}
      </div>
    );
  }

  const domains = data?.domains || [];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-200">Monitored Domains</h2>
          <p className="text-xs text-slate-500 mt-1">{domains.length} domains tracked</p>
        </div>
      </div>

      <div className="grid gap-4">
        {domains.map(d => {
          const totalMsgs = d.total_messages || 0;
          return (
            <Link
              key={d.id}
              to={`/domains/${d.domain}`}
              className="glass-card glow-border p-5 flex items-center gap-5 group hover:scale-[1.005] transition-transform"
            >
              <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/20">
                <Globe size={24} className="text-green-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-slate-200 truncate">{d.domain}</h3>
                  {d.display_name && d.display_name !== d.domain && (
                    <span className="text-xs text-slate-500">({d.display_name})</span>
                  )}
                </div>
                <div className="flex items-center gap-4 mt-1.5">
                  <span className="flex items-center gap-1.5 text-xs text-slate-500">
                    <Mail size={12} />
                    {formatNumber(totalMsgs)} messages
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-slate-500">
                    <Shield size={12} />
                    {d.report_count || 0} reports
                  </span>
                  {d.last_report && (
                    <span className="text-xs text-slate-600">
                      Last: {new Date(d.last_report).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
              <ChevronRight size={20} className="text-slate-600 group-hover:text-green-400 transition" />
            </Link>
          );
        })}

        {domains.length === 0 && (
          <div className="glass-card p-12 text-center">
            <Globe size={48} className="text-slate-600 mx-auto mb-4" />
            <p className="text-slate-400">No domains found</p>
            <p className="text-xs text-slate-600 mt-1">Upload DMARC reports or configure your inbox</p>
          </div>
        )}
      </div>
    </div>
  );
}
