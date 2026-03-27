import React, { useState, useRef } from 'react';
import { Upload, FileText, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { apiPost } from '../hooks/useApi';

export default function UploadPage() {
  const [status, setStatus] = useState(null); // 'loading' | 'success' | 'error'
  const [result, setResult] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();

  async function handleFile(file) {
    if (!file) return;
    setStatus('loading');
    setResult(null);

    try {
      const text = await file.text();
      const res = await apiPost('/upload', { xml: text });

      if (res.error) {
        setStatus('error');
        setResult(res.error);
      } else {
        setStatus('success');
        setResult(res.result);
      }
    } catch (e) {
      setStatus('error');
      setResult(e.message);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleInputChange(e) {
    const file = e.target.files[0];
    if (file) handleFile(file);
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl mx-auto">
      <div>
        <h2 className="text-lg font-semibold text-slate-200">Upload DMARC Report</h2>
        <p className="text-xs text-slate-500 mt-1">
          Manually upload XML, .gz, or .zip DMARC report files
        </p>
      </div>

      {/* Drop zone */}
      <div
        className={`glass-card glow-border p-12 text-center cursor-pointer transition-all ${
          dragOver ? 'border-green-500/50 bg-green-500/5 scale-[1.01]' : ''
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".xml,.gz,.zip"
          className="hidden"
          onChange={handleInputChange}
        />
        <div className="flex flex-col items-center gap-4">
          <div className={`p-4 rounded-2xl transition-colors ${
            dragOver ? 'bg-green-500/20' : 'bg-slate-800/50'
          }`}>
            <Upload size={32} className={dragOver ? 'text-green-400' : 'text-slate-500'} />
          </div>
          <div>
            <p className="text-sm text-slate-300 font-medium">
              {dragOver ? 'Drop file here' : 'Click or drag to upload'}
            </p>
            <p className="text-xs text-slate-600 mt-1">
              Supports .xml, .gz, and .zip DMARC report files
            </p>
          </div>
        </div>
      </div>

      {/* Status */}
      {status === 'loading' && (
        <div className="glass-card p-5 flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-slate-300">Processing report...</span>
        </div>
      )}

      {status === 'success' && (
        <div className="glass-card p-5 border-l-2 border-emerald-500/50">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle size={18} className="text-emerald-400" />
            <span className="text-sm font-medium text-emerald-300">Report processed successfully</span>
          </div>
          {result && (
            <div className="text-xs text-slate-400 space-y-1">
              <p>Report ID: <span className="font-mono text-slate-300">{result.reportId}</span></p>
              {result.skipped ? (
                <p className="text-amber-400">This report was already in the database</p>
              ) : (
                <p>Records processed: <span className="font-mono text-slate-300">{result.recordCount}</span></p>
              )}
            </div>
          )}
        </div>
      )}

      {status === 'error' && (
        <div className="glass-card p-5 border-l-2 border-red-500/50">
          <div className="flex items-center gap-2 mb-2">
            <XCircle size={18} className="text-red-400" />
            <span className="text-sm font-medium text-red-300">Error processing report</span>
          </div>
          <p className="text-xs text-slate-400">{result}</p>
        </div>
      )}

      {/* Info */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
          <AlertTriangle size={16} className="text-amber-400" />
          Automatic Fetching
        </h3>
        <div className="text-xs text-slate-400 space-y-2 leading-relaxed">
          <p>
            Reports are automatically fetched from <span className="font-mono text-green-400">reports@dmarky.com</span> every 15 minutes.
          </p>
          <p>
            Configure your domains to send DMARC reports to this address by adding the following to your DMARC DNS record:
          </p>
          <div className="bg-slate-800/50 rounded-lg p-3 font-mono text-[11px] text-slate-300 mt-2">
            v=DMARC1; p=reject; rua=mailto:reports@dmarky.com; ruf=mailto:reports@dmarky.com; adkim=s; aspf=s; pct=100;
          </div>
        </div>
      </div>
    </div>
  );
}
