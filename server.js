const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const dns = require('dns').promises;
const zlib = require('zlib');

// ── REPORTS STORAGE ──
const REPORTS_DIR = process.env.REPORTS_DIR || path.join(__dirname, 'data', 'reports');
function ensureReportsDir(userId) {
  const dir = path.join(REPORTS_DIR, String(userId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function loadReports(userId) {
  const dir = path.join(REPORTS_DIR, String(userId));
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch(e) { return null; } })
    .filter(Boolean)
    .sort((a, b) => new Date(b.date_range_end) - new Date(a.date_range_end));
}
function saveReport(userId, report) {
  const dir = ensureReportsDir(userId);
  fs.writeFileSync(path.join(dir, report.id + '.json'), JSON.stringify(report, null, 2));
}
function deleteReport(userId, reportId) {
  const file = path.join(REPORTS_DIR, String(userId), reportId + '.json');
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

// ── DMARC XML PARSER ──
function parseXmlValue(xml, tag) {
  const m = xml.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
  return m ? m[1].trim() : null;
}
function parseAllBlocks(xml, tag) {
  const re = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'gi');
  const out = []; let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1].trim());
  return out;
}
function parseDmarcXml(xml) {
  const orgName = parseXmlValue(xml, 'org_name') || parseXmlValue(xml, 'org-name') || 'Unknown';
  const reportId = parseXmlValue(xml, 'report_id') || parseXmlValue(xml, 'report-id') || String(Date.now());
  const dateBegin = parseXmlValue(xml, 'begin');
  const dateEnd = parseXmlValue(xml, 'end');
  const domain = parseXmlValue(xml, 'domain') || '';
  const policy = parseXmlValue(xml, 'p') || 'none';

  const recordBlocks = parseAllBlocks(xml, 'record');
  const records = recordBlocks.map(block => {
    const count = parseInt(parseXmlValue(block, 'count') || '0');
    const dkim = parseXmlValue(block, 'dkim') || 'fail';
    const spf = parseXmlValue(block, 'spf') || 'fail';
    return {
      source_ip: parseXmlValue(block, 'source_ip') || parseXmlValue(block, 'source-ip') || '',
      count, disposition: parseXmlValue(block, 'disposition') || 'none',
      dkim, spf,
      header_from: parseXmlValue(block, 'header_from') || parseXmlValue(block, 'header-from') || domain
    };
  });

  const total = records.reduce((s, r) => s + r.count, 0);
  const pass = records.filter(r => r.dkim === 'pass' || r.spf === 'pass').reduce((s, r) => s + r.count, 0);
  return {
    id: reportId.replace(/[^a-zA-Z0-9_-]/g, '_') + '_' + Date.now(),
    report_id: reportId,
    org_name: orgName,
    domain, policy,
    date_range_begin: dateBegin ? new Date(parseInt(dateBegin) * 1000).toISOString() : new Date().toISOString(),
    date_range_end: dateEnd ? new Date(parseInt(dateEnd) * 1000).toISOString() : new Date().toISOString(),
    total_messages: total,
    pass_messages: pass,
    fail_messages: total - pass,
    compliance_rate: total > 0 ? Math.round((pass / total) * 1000) / 10 : 0,
    records,
    uploaded_at: new Date().toISOString(),
    raw_xml: xml.length > 60000 ? xml.substring(0, 60000) : xml
  };
}
async function parseUploadedBuffer(buffer, filename) {
  const name = (filename || '').toLowerCase();
  if (name.endsWith('.gz') || (buffer[0] === 0x1F && buffer[1] === 0x8B)) {
    const dec = await new Promise((res, rej) => zlib.gunzip(buffer, (e, r) => e ? rej(e) : res(r)));
    return parseDmarcXml(dec.toString('utf8'));
  }
  if (name.endsWith('.zip') || (buffer[0] === 0x50 && buffer[1] === 0x4B)) {
    const str = buffer.toString('latin1');
    const xmlStart = str.indexOf('<?xml');
    if (xmlStart < 0) throw new Error('No XML found inside ZIP');
    let xmlStr = str.substring(xmlStart);
    const xmlEnd = xmlStr.lastIndexOf('>');
    if (xmlEnd > 0) xmlStr = xmlStr.substring(0, xmlEnd + 1);
    return parseDmarcXml(xmlStr);
  }
  return parseDmarcXml(buffer.toString('utf8'));
}

const app = express();
const PORT = process.env.PORT || 3004;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-railway-env';
const USERS_FILE = process.env.USERS_FILE || path.join(__dirname, 'data', 'users.json');

// ── USER STORAGE ──
function loadUsers() {
  try { if (!fs.existsSync(USERS_FILE)) return []; return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch(e) { return []; }
}
function saveUsers(users) {
  const dir = path.dirname(USERS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}
function findUser(email) { return loadUsers().find(u => u.email === email.toLowerCase().trim()); }
function getUserById(id) { return loadUsers().find(u => u.id === id); }

// ── MIDDLEWARE ──
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

function requireAuth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.redirect('/login');
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch(e) { res.clearCookie('token'); return res.redirect('/login'); }
}
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ── HEALTH ──
app.get('/health', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end('{"status":"ok"}');
});

// ── AUTH ──
app.get('/login', (req, res) => {
  try { if (req.cookies.token) { jwt.verify(req.cookies.token, JWT_SECRET); return res.redirect('/dashboard'); } } catch(e) {}
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.redirect('/login?error=missing');
  const user = findUser(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.redirect('/login?error=invalid');
  const users = loadUsers();
  const idx = users.findIndex(u => u.email === user.email);
  if (idx >= 0) { users[idx].last_login = new Date().toISOString(); saveUsers(users); }
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name || '' }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 7*24*60*60*1000 });
  res.redirect('/dashboard');
});

app.get('/logout', (req, res) => { res.clearCookie('token'); res.redirect('/login'); });
app.post('/logout', (req, res) => { res.clearCookie('token'); res.redirect('/login'); });

// ── API ──
app.get('/api/me', requireAuth, (req, res) => {
  res.json({ id: req.user.id, email: req.user.email, role: req.user.role, name: req.user.name });
});

// Domains
app.get('/api/domains', requireAuth, (req, res) => {
  const user = getUserById(req.user.id);
  res.json(user ? (user.domains || []) : []);
});
app.post('/api/domains', requireAuth, (req, res) => {
  const { domain, policy, rua } = req.body;
  if (!domain) return res.status(400).json({ error: 'domain required' });
  const clean = domain.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === req.user.id);
  if (idx < 0) return res.status(404).json({ error: 'User not found' });
  if (!users[idx].domains) users[idx].domains = [];
  if (users[idx].domains.find(d => d.domain === clean)) return res.status(409).json({ error: 'Domain already added' });
  const newDomain = { id: Date.now(), domain: clean, policy: policy || 'none', rua: rua || '', added_at: new Date().toISOString() };
  users[idx].domains.push(newDomain);
  saveUsers(users);
  res.json(newDomain);
});
app.delete('/api/domains/:domain', requireAuth, (req, res) => {
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === req.user.id);
  if (idx < 0) return res.status(404).json({ error: 'User not found' });
  users[idx].domains = (users[idx].domains || []).filter(d => d.domain !== req.params.domain);
  saveUsers(users);
  res.json({ ok: true });
});
app.patch('/api/domains/:domain', requireAuth, (req, res) => {
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === req.user.id);
  if (idx < 0) return res.status(404).json({ error: 'User not found' });
  const dIdx = (users[idx].domains || []).findIndex(d => d.domain === req.params.domain);
  if (dIdx < 0) return res.status(404).json({ error: 'Domain not found' });
  const { policy, rua } = req.body;
  if (policy) users[idx].domains[dIdx].policy = policy;
  if (rua !== undefined) users[idx].domains[dIdx].rua = rua;
  saveUsers(users);
  res.json(users[idx].domains[dIdx]);
});

// Real DNS check
app.get('/api/dns/:domain', requireAuth, async (req, res) => {
  const domain = req.params.domain.toLowerCase().trim();
  const result = {
    domain, timestamp: new Date().toISOString(),
    spf: { found: false, record: null, lookups: 0, valid: false, error: null, warning: null },
    dmarc: { found: false, record: null, policy: null, rua: null, valid: false, error: null },
    dkim: { found: false, selectors: [], error: null },
    mx: { found: false, records: [], error: null }
  };
  try {
    const txt = await dns.resolveTxt(domain);
    const spfRecs = txt.map(r => r.join('')).filter(r => r.startsWith('v=spf1'));
    if (spfRecs.length > 1) { result.spf.found = true; result.spf.record = spfRecs[0]; result.spf.error = 'Multiple SPF records found!'; }
    else if (spfRecs.length === 1) {
      result.spf.found = true; result.spf.record = spfRecs[0]; result.spf.valid = true;
      result.spf.lookups = (spfRecs[0].match(/\b(include|a|mx|ptr|exists|redirect)[:=]/g) || []).length;
      if (result.spf.lookups >= 10) result.spf.error = 'SPF lookup limit reached (10/10)!';
      else if (result.spf.lookups >= 8) result.spf.warning = result.spf.lookups + '/10 lookups — approaching limit';
    } else { result.spf.error = 'No SPF record found'; }
  } catch(e) { result.spf.error = 'Could not resolve TXT records'; }
  try {
    const txt = await dns.resolveTxt('_dmarc.' + domain);
    const rec = txt.map(r => r.join('')).find(r => r.startsWith('v=DMARC1'));
    if (rec) {
      result.dmarc.found = true; result.dmarc.record = rec; result.dmarc.valid = true;
      const p = rec.match(/p=(\w+)/); const rua = rec.match(/rua=([^;]+)/);
      result.dmarc.policy = p ? p[1] : null;
      result.dmarc.rua = rua ? rua[1].trim() : null;
    } else { result.dmarc.error = 'No DMARC record at _dmarc.' + domain; }
  } catch(e) { result.dmarc.error = 'No DMARC record at _dmarc.' + domain; }
  const selectors = ['google','default','mail','k1','selector1','selector2','dkim','smtp','email','s1','s2'];
  const checks = await Promise.allSettled(selectors.map(sel =>
    dns.resolveTxt(sel + '._domainkey.' + domain).then(r => {
      const rec = r.map(x => x.join('')).find(x => x.includes('v=DKIM1') || x.includes('p='));
      return rec ? { selector: sel, record: rec.substring(0, 80) } : null;
    })
  ));
  result.dkim.selectors = checks.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
  result.dkim.found = result.dkim.selectors.length > 0;
  if (!result.dkim.found) result.dkim.error = 'No DKIM selectors found';
  try {
    const mx = await dns.resolveMx(domain);
    result.mx.found = mx.length > 0;
    result.mx.records = mx.sort((a,b) => a.priority - b.priority).slice(0,5).map(r => ({ priority: r.priority, exchange: r.exchange }));
  } catch(e) { result.mx.error = 'No MX records found'; }
  res.json(result);
});

// ── REPORTS API ──
app.get('/api/reports', requireAuth, (req, res) => {
  const reports = loadReports(req.user.id).map(r => ({
    id: r.id, report_id: r.report_id, org_name: r.org_name,
    domain: r.domain, policy: r.policy,
    date_range_begin: r.date_range_begin, date_range_end: r.date_range_end,
    total_messages: r.total_messages, pass_messages: r.pass_messages,
    fail_messages: r.fail_messages, compliance_rate: r.compliance_rate,
    uploaded_at: r.uploaded_at, record_count: (r.records || []).length
  }));
  res.json(reports);
});

app.get('/api/reports/:id', requireAuth, (req, res) => {
  const reports = loadReports(req.user.id);
  const report = reports.find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: 'Report not found' });
  res.json(report);
});

app.delete('/api/reports/:id', requireAuth, (req, res) => {
  deleteReport(req.user.id, req.params.id);
  res.json({ ok: true });
});

app.post('/api/reports/upload', requireAuth, (req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', async () => {
    try {
      const buffer = Buffer.concat(chunks);
      if (buffer.length === 0) return res.status(400).json({ error: 'Empty file' });
      if (buffer.length > 10 * 1024 * 1024) return res.status(400).json({ error: 'File too large (max 10MB)' });
      const filename = decodeURIComponent(req.headers['x-filename'] || 'report.xml');
      const report = await parseUploadedBuffer(buffer, filename);
      saveReport(req.user.id, report);
      res.json({
        ok: true, id: report.id, org_name: report.org_name,
        domain: report.domain, total_messages: report.total_messages,
        compliance_rate: report.compliance_rate
      });
    } catch(e) {
      res.status(400).json({ error: 'Could not parse file: ' + e.message });
    }
  });
  req.on('error', () => res.status(500).json({ error: 'Upload failed' }));
});

app.get('/api/reports/analysis/:domain', requireAuth, (req, res) => {
  const domain = req.params.domain.toLowerCase();
  const all = loadReports(req.user.id).filter(r => r.domain === domain);
  if (!all.length) return res.json({ domain, has_data: false });

  const sorted = [...all].sort((a,b) => new Date(a.date_range_end) - new Date(b.date_range_end));
  const trend = sorted.map(r => ({
    date: (r.date_range_end||r.uploaded_at).slice(0,10),
    org: r.org_name, total: r.total_messages,
    pass: r.pass_messages, fail: r.fail_messages, rate: r.compliance_rate
  }));

  const sm = {};
  all.forEach(r => (r.records||[]).forEach(rec => {
    const ip = rec.source_ip; if (!ip) return;
    if (!sm[ip]) sm[ip] = { ip, total:0, pass:0, fail:0, first_seen: r.date_range_end, last_seen: r.date_range_end };
    sm[ip].total += rec.count;
    if (rec.dkim==='pass'||rec.spf==='pass') sm[ip].pass += rec.count; else sm[ip].fail += rec.count;
    if (new Date(r.date_range_end) > new Date(sm[ip].last_seen)) sm[ip].last_seen = r.date_range_end;
    if (new Date(r.date_range_end) < new Date(sm[ip].first_seen)) sm[ip].first_seen = r.date_range_end;
  }));
  const senders = Object.values(sm).sort((a,b) => b.total - a.total);

  const latest = sorted[sorted.length-1];
  const latestIps = new Set((latest.records||[]).map(r=>r.source_ip));
  const olderIps = new Set(sorted.slice(0,-1).flatMap(r=>(r.records||[]).map(rec=>rec.source_ip)));
  const newSenders = senders.filter(s => latestIps.has(s.ip) && !olderIps.has(s.ip));
  const missingSenders = senders.filter(s => !latestIps.has(s.ip) && olderIps.has(s.ip) && s.total > 50);
  const threats = senders.filter(s => s.fail > 0 && s.fail/(s.total||1) > 0.1).sort((a,b)=>b.fail-a.fail).slice(0,10);

  const avgRate = trend.reduce((s,t)=>s+t.rate,0)/trend.length;
  const pol = latest.policy||'none';
  let rec;
  if (pol==='reject') rec = { action:'maintain', to:'reject', confidence:'high', reason:'Fully enforced with p=reject. Keep monitoring for new unauthorized senders.' };
  else if (pol==='quarantine' && avgRate>=98) rec = { action:'upgrade', to:'reject', confidence:'high', reason:'Compliance '+avgRate.toFixed(1)+'% — ready to enforce p=reject.' };
  else if (pol==='quarantine' && avgRate>=90) rec = { action:'upgrade', to:'reject', confidence:'medium', reason:'Compliance '+avgRate.toFixed(1)+'% — nearly ready for p=reject. Investigate remaining failures first.' };
  else if (pol==='none' && avgRate>=95) rec = { action:'upgrade', to:'quarantine', confidence:'high', reason:'Compliance '+avgRate.toFixed(1)+'% — safe to move to p=quarantine now.' };
  else if (pol==='none' && avgRate>=80) rec = { action:'upgrade', to:'quarantine', confidence:'medium', reason:'Compliance '+avgRate.toFixed(1)+'% — identify remaining failing senders, then move to quarantine.' };
  else rec = { action:'wait', to:pol, confidence:'low', reason:'Compliance '+avgRate.toFixed(1)+'% — keep monitoring and resolve failing senders before tightening policy.' };

  const totalMsgs = all.reduce((s,r)=>s+r.total_messages,0);
  const totalPass = all.reduce((s,r)=>s+r.pass_messages,0);

  res.json({
    domain, has_data:true, report_count:all.length,
    total_messages:totalMsgs, total_pass:totalPass, total_fail:totalMsgs-totalPass,
    overall_rate: totalMsgs>0 ? Math.round((totalPass/totalMsgs)*1000)/10 : 0,
    current_policy:pol, avg_rate:Math.round(avgRate*10)/10,
    trend, senders:senders.slice(0,20), new_senders:newSenders,
    missing_senders:missingSenders, threats, recommendation:rec,
    date_first:(sorted[0].date_range_end||'').slice(0,10),
    date_last:(latest.date_range_end||'').slice(0,10)
  });
});

app.get('/api/reports/stats/summary', requireAuth, (req, res) => {
  const reports = loadReports(req.user.id);
  if (!reports.length) return res.json({ total_reports: 0, total_messages: 0, pass_messages: 0, fail_messages: 0, compliance_rate: 0, orgs: [], domains: [] });
  const total = reports.reduce((s, r) => s + r.total_messages, 0);
  const pass = reports.reduce((s, r) => s + r.pass_messages, 0);
  const orgs = [...new Set(reports.map(r => r.org_name))];
  const domains = [...new Set(reports.map(r => r.domain).filter(Boolean))];
  res.json({
    total_reports: reports.length, total_messages: total,
    pass_messages: pass, fail_messages: total - pass,
    compliance_rate: total > 0 ? Math.round((pass / total) * 1000) / 10 : 0,
    orgs, domains, latest: reports[0] ? reports[0].date_range_end : null
  });
});

app.get('/api/sources', requireAuth, (req, res) => {
  const reports = loadReports(req.user.id);
  const sm = {};
  reports.forEach(r => (r.records||[]).forEach(rec => {
    const ip = rec.source_ip; if (!ip) return;
    if (!sm[ip]) sm[ip] = { ip, domain: rec.header_from || r.domain || '', total:0, pass:0, fail:0, spf_pass:0, spf_fail:0, dkim_pass:0, dkim_fail:0, first_seen: r.date_range_end, last_seen: r.date_range_end };
    sm[ip].total += rec.count;
    if (rec.spf==='pass') sm[ip].spf_pass += rec.count; else sm[ip].spf_fail += rec.count;
    if (rec.dkim==='pass') sm[ip].dkim_pass += rec.count; else sm[ip].dkim_fail += rec.count;
    if (rec.dkim==='pass'||rec.spf==='pass') sm[ip].pass += rec.count; else sm[ip].fail += rec.count;
    if (!sm[ip].domain && (rec.header_from || r.domain)) sm[ip].domain = rec.header_from || r.domain;
    if (new Date(r.date_range_end) > new Date(sm[ip].last_seen)) sm[ip].last_seen = r.date_range_end;
    if (new Date(r.date_range_end) < new Date(sm[ip].first_seen)) sm[ip].first_seen = r.date_range_end;
  }));
  const sources = Object.values(sm).sort((a,b) => b.total - a.total);
  const auth = sources.filter(s => s.pass/(s.total||1) >= 0.9);
  const unauth = sources.filter(s => s.pass/(s.total||1) < 0.9);
  res.json({ sources: sources.slice(0,50), total: sources.length, authorized: auth.length, unauthorized: unauth.length, total_volume: sources.reduce((s,x)=>s+x.total,0) });
});

app.get('/api/alerts', requireAuth, (req, res) => {
  const reports = loadReports(req.user.id);
  const user = getUserById(req.user.id);
  const domains = user ? (user.domains || []) : [];
  const alerts = [];

  domains.forEach(d => {
    const hasReports = reports.some(r => r.domain === d.domain);
    if (!hasReports) {
      alerts.push({ severity: 'info', title: 'No reports for ' + d.domain, detail: 'No DMARC aggregate reports received yet. Reports may take 24-48h to arrive.', domain: d.domain, time: d.added_at });
    }
  });

  domains.forEach(d => {
    if (d.policy === 'none') {
      alerts.push({ severity: 'warning', title: 'Policy p=none on ' + d.domain, detail: 'Your DMARC policy is set to monitor-only. Consider upgrading to p=quarantine or p=reject.', domain: d.domain, time: d.added_at });
    }
  });

  const domainStats = {};
  reports.forEach(r => {
    if (!r.domain) return;
    if (!domainStats[r.domain]) domainStats[r.domain] = { total:0, fail:0 };
    domainStats[r.domain].total += r.total_messages;
    domainStats[r.domain].fail += r.fail_messages;
  });
  Object.entries(domainStats).forEach(([domain, stats]) => {
    const failRate = stats.total > 0 ? (stats.fail / stats.total * 100) : 0;
    if (failRate > 20) {
      alerts.push({ severity: 'critical', title: 'High failure rate on ' + domain, detail: Math.round(failRate) + '% of emails failing DMARC (' + stats.fail + ' out of ' + stats.total + '). Check unauthorized senders.', domain, time: new Date().toISOString() });
    } else if (failRate > 5) {
      alerts.push({ severity: 'warning', title: 'Elevated failures on ' + domain, detail: Math.round(failRate*10)/10 + '% failure rate. Review sources to ensure all legitimate senders are authorized.', domain, time: new Date().toISOString() });
    }
  });

  const sm = {};
  reports.forEach(r => (r.records||[]).forEach(rec => {
    const ip = rec.source_ip; if (!ip) return;
    if (!sm[ip]) sm[ip] = { ip, total:0, fail:0 };
    sm[ip].total += rec.count;
    if (rec.dkim!=='pass' && rec.spf!=='pass') sm[ip].fail += rec.count;
  }));
  const threats = Object.values(sm).filter(s => s.fail > 0 && s.fail/(s.total||1) > 0.5 && s.total >= 10);
  threats.slice(0,5).forEach(t => {
    alerts.push({ severity: 'critical', title: 'Unauthorized sender: ' + t.ip, detail: t.fail + ' of ' + t.total + ' emails failing from this IP. May indicate spoofing attempt.', time: new Date().toISOString() });
  });

  const order = { critical:0, warning:1, info:2 };
  alerts.sort((a,b) => (order[a.severity]||9) - (order[b.severity]||9));

  const critical = alerts.filter(a => a.severity === 'critical').length;
  const warnings = alerts.filter(a => a.severity === 'warning').length;
  const info = alerts.filter(a => a.severity === 'info').length;

  res.json({ alerts, counts: { critical, warnings, info, total: alerts.length } });
});

// Admin
app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  res.json(loadUsers().map(u => ({ id: u.id, email: u.email, name: u.name, role: u.role, created_at: u.created_at, last_login: u.last_login, domain_count: (u.domains||[]).length })));
});
app.post('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const { email, password, name, role } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const users = loadUsers();
  if (users.find(u => u.email === email.toLowerCase().trim())) return res.status(409).json({ error: 'Email already exists' });
  const u = { id: Date.now(), email: email.toLowerCase().trim(), password_hash: bcrypt.hashSync(password, 12), name: name||'', role: role==='admin'?'admin':'user', domains: [], created_at: new Date().toISOString(), last_login: null };
  users.push(u); saveUsers(users);
  res.json({ id: u.id, email: u.email, name: u.name, role: u.role });
});
app.delete('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  saveUsers(loadUsers().filter(u => u.id !== id));
  res.json({ ok: true });
});
app.patch('/api/admin/users/:id/password', requireAuth, requireAdmin, (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password too short' });
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === parseInt(req.params.id));
  if (idx < 0) return res.status(404).json({ error: 'User not found' });
  users[idx].password_hash = bcrypt.hashSync(password, 12);
  saveUsers(users); res.json({ ok: true });
});

// ── SERVE PORTAL ──
app.get('/dashboard', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(getPortalHTML());
});

// Landing page for unauthenticated, dashboard for authenticated
app.get('/', (req, res) => {
  try {
    if (req.cookies.token) {
      jwt.verify(req.cookies.token, JWT_SECRET);
      return res.redirect('/dashboard');
    }
  } catch(e) {}
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function getPortalHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Plain DMARC Portal</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Space+Mono:wght@400;700&display=swap');
:root{--bg:#050507;--bg1:#0a0b0f;--bg2:#111218;--bg3:#1a1b23;--border:rgba(255,255,255,0.06);--border2:rgba(255,255,255,0.12);--accent:#4ade80;--accent-dim:rgba(74,222,128,0.15);--red:#ef4444;--orange:#f59e0b;--green:#4ade80;--blue:#818cf8;--text:#f0f0f5;--muted:#5a5d6e;--muted2:#8b8fa3}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:'Inter',system-ui,sans-serif;font-size:14px;min-height:100vh;display:flex;flex-direction:column;overflow-x:hidden}
body::before{content:'';position:fixed;inset:0;background-image:radial-gradient(ellipse at 20% 50%,rgba(74,222,128,0.03) 0%,transparent 70%);pointer-events:none;z-index:0}
::selection{background:var(--accent-dim);color:var(--accent)}
::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:var(--bg1)}::-webkit-scrollbar-thumb{background:var(--muted);border-radius:3px}
a{text-decoration:none;color:inherit}
.topbar{height:52px;border-bottom:1px solid var(--border);background:var(--bg1);display:flex;align-items:center;padding:0 1.5rem;gap:1rem;position:sticky;top:0;z-index:50;flex-shrink:0;backdrop-filter:blur(12px)}
.logo{font-size:1.1rem;font-weight:700;letter-spacing:-0.02em;white-space:nowrap}
.logo em{color:var(--accent);font-style:normal}
.topbar-nav{display:flex;list-style:none;gap:0;margin-left:1rem}
.topbar-nav li a{display:block;padding:0 1rem;height:52px;line-height:52px;font-size:0.75rem;font-weight:500;letter-spacing:0.04em;text-transform:uppercase;color:var(--muted2);cursor:pointer;transition:color 0.15s,background 0.15s;border-right:1px solid var(--border)}
.topbar-nav li a:hover{color:var(--text);background:rgba(255,255,255,0.02)}
.topbar-nav li a.active{color:var(--accent);background:var(--accent-dim)}
.topbar-right{margin-left:auto;display:flex;align-items:center;gap:1rem}
.status-dot{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 6px var(--green);animation:pulse 2s infinite}
.domain-select{background:var(--bg2);border:1px solid var(--border2);color:var(--text);font-family:'Inter',sans-serif;font-size:0.75rem;padding:0.35rem 0.7rem;outline:none;cursor:pointer;border-radius:4px}
.layout{display:flex;flex:1;position:relative;z-index:1}
.sidebar{width:200px;flex-shrink:0;border-right:1px solid var(--border);background:var(--bg1);display:flex;flex-direction:column}
.sidebar-section{padding:1rem 0;border-bottom:1px solid var(--border)}
.sidebar-lbl{font-size:0.6rem;letter-spacing:0.2em;text-transform:uppercase;color:var(--muted);padding:0 1rem 0.5rem;font-weight:600}
.sidebar-item{display:flex;align-items:center;gap:0.6rem;padding:0.5rem 1rem;font-size:0.78rem;color:var(--muted2);cursor:pointer;transition:all 0.15s;border-left:2px solid transparent;font-weight:400}
.sidebar-item:hover{color:var(--text);background:rgba(255,255,255,0.03)}
.sidebar-item.active{color:var(--accent);border-left-color:var(--accent);background:var(--accent-dim)}
.sidebar-badge{margin-left:auto;background:var(--red);color:#fff;font-size:0.6rem;padding:0.15rem 0.45rem;border-radius:3px;font-weight:600}
.main{flex:1;overflow-y:auto;padding:1.5rem;display:flex;flex-direction:column;gap:1.5rem}
.pview{display:none;flex-direction:column;gap:1.5rem}
.pview.active{display:flex;animation:fadeIn 0.25s ease both}
.page-hdr{display:flex;align-items:flex-end;justify-content:space-between;padding-bottom:1rem;border-bottom:1px solid var(--border)}
.page-title{font-size:1.8rem;font-weight:800;letter-spacing:-0.5px;line-height:1}
.page-sub{font-size:0.72rem;color:var(--muted2);margin-top:0.3rem}
.page-acts{display:flex;gap:0.6rem}
.btn{padding:0.45rem 1rem;font-family:'Inter',sans-serif;font-size:0.75rem;border:none;cursor:pointer;transition:all 0.15s;border-radius:4px;font-weight:500}
.btn-a{background:var(--accent);color:#050507;font-weight:600}
.btn-a:hover{opacity:0.85}
.btn-g{background:transparent;border:1px solid var(--border2);color:var(--muted2)}
.btn-g:hover{color:var(--text);border-color:var(--muted2)}
.btn-d{background:transparent;border:1px solid var(--red);color:var(--red)}
.btn-d:hover{background:rgba(239,68,68,0.08)}
.kpi-row{display:grid;gap:1px;background:var(--border);border:1px solid var(--border);border-radius:6px;overflow:hidden}
.kpi-5{grid-template-columns:repeat(5,1fr)}
.kpi-4{grid-template-columns:repeat(4,1fr)}
.kpi{background:var(--bg1);padding:1.2rem 1.4rem;display:flex;flex-direction:column;gap:0.3rem}
.kpi:hover{background:var(--bg2)}
.kpi-lbl{font-size:0.62rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted);font-weight:600}
.kpi-val{font-family:'Space Mono',monospace;font-size:1.8rem;font-weight:700;line-height:1;letter-spacing:-0.02em}
.kpi-d{font-size:0.68rem}
.kpi-d.up{color:var(--green)}.kpi-d.dn{color:var(--red)}.kpi-d.nt{color:var(--muted2)}
.kpi-bar{height:2px;background:var(--border);margin-top:0.5rem;position:relative;overflow:hidden;border-radius:1px}
.kpi-fill{height:100%;position:absolute;left:0;top:0;border-radius:1px}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
.panel{background:var(--bg1);border:1px solid var(--border);display:flex;flex-direction:column;border-radius:6px;overflow:hidden}
.panel-hdr{padding:0.9rem 1.2rem;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}
.panel-ttl{font-size:0.68rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted2);font-weight:600}
.panel-act{font-size:0.65rem;color:var(--accent);cursor:pointer;font-weight:500}
.panel-body{padding:1.2rem;flex:1}
.tag{display:inline-block;padding:0.15rem 0.5rem;font-size:0.62rem;letter-spacing:0.06em;text-transform:uppercase;font-weight:600;border-radius:3px}
.tp{background:rgba(74,222,128,0.12);color:var(--green)}
.tf{background:rgba(239,68,68,0.12);color:var(--red)}
.tw{background:rgba(255,140,0,0.12);color:var(--orange)}
.tn{background:rgba(255,255,255,0.06);color:var(--muted2)}
.ti{background:rgba(41,182,246,0.12);color:var(--blue)}
.tw-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse}
thead tr{border-bottom:1px solid var(--border2)}
th{font-size:0.6rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted);text-align:left;padding:0.5rem 0.8rem;font-weight:600}
td{padding:0.6rem 0.8rem;font-size:0.75rem;border-bottom:1px solid var(--border);vertical-align:middle}
tbody tr{transition:background 0.1s}
tbody tr:hover{background:rgba(255,255,255,0.02)}
tbody tr:last-child td{border-bottom:none}
.al-list{display:flex;flex-direction:column}
.al-item{padding:1rem 1.2rem;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;gap:0.8rem;transition:background 0.1s}
.al-item:hover{background:rgba(255,255,255,0.02)}
.al-item:last-child{border-bottom:none}
.al-sev{width:3px;align-self:stretch;flex-shrink:0;border-radius:2px}
.sc{background:var(--red)}.sw{background:var(--orange)}.si{background:var(--blue)}
.al-body{flex:1}
.al-ttl{font-size:0.75rem;margin-bottom:0.2rem;font-weight:500}
.al-meta{font-size:0.65rem;color:var(--muted2)}
.al-time{font-size:0.65rem;color:var(--muted);white-space:nowrap}
.al-acts{display:flex;gap:0.4rem;align-items:center}
.spark-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--border);border-radius:4px;overflow:hidden}
.spark-cell{background:var(--bg1);padding:1rem}
.spark-ttl{font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted);margin-bottom:0.4rem;font-weight:600}
.spark-v{font-family:'Space Mono',monospace;font-size:1.4rem;font-weight:700;letter-spacing:-0.02em}
svg.spark{width:100%;height:36px;margin-top:0.5rem}
.dom-cards{display:flex;flex-direction:column;gap:1px;background:var(--border);border-radius:6px;overflow:hidden}
.dom-card{background:var(--bg1);padding:1.4rem;display:flex;align-items:center;gap:1.5rem;transition:background 0.15s;flex-wrap:wrap}
.dom-card:hover{background:var(--bg2)}
.dom-name{font-family:'Space Mono',monospace;font-size:1.2rem;font-weight:700;min-width:160px;letter-spacing:-0.01em}
.dom-tags{display:flex;gap:0.4rem;flex-wrap:wrap}
.dom-stats{margin-left:auto;display:flex;gap:1.5rem}
.dom-stat{text-align:right}
.dom-stat-v{font-family:'Space Mono',monospace;font-size:1.1rem;font-weight:700}
.dom-stat-l{font-size:0.6rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;font-weight:500}
.dom-acts{display:flex;gap:0.4rem}
.pol-chip{flex:1;padding:0.8rem 1rem;background:var(--bg2);border:1px solid var(--border);display:flex;flex-direction:column;gap:0.3rem;border-radius:4px}
.pol-lbl{font-size:0.6rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted);font-weight:600}
.pol-val{font-family:'Space Mono',monospace;font-size:1.1rem;font-weight:700}
.modal-ov{position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:200;display:none;align-items:center;justify-content:center;backdrop-filter:blur(4px)}
.modal-ov.open{display:flex}
.modal{background:var(--bg1);border:1px solid var(--border2);width:560px;max-width:90vw;max-height:85vh;display:flex;flex-direction:column;border-radius:8px;overflow:hidden}
.modal-hdr{padding:1rem 1.4rem;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}
.modal-ttl{font-size:1rem;font-weight:700}
.modal-cls{background:none;border:none;color:var(--muted2);cursor:pointer;font-size:1.2rem}
.modal-body{padding:1.4rem;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:1rem}
.step-bar{display:flex;gap:4px;margin-bottom:0.5rem}
.step-seg{flex:1;height:3px;background:var(--border2);border-radius:2px;transition:background 0.3s}
.step-seg.done,.step-seg.cur{background:var(--accent)}
.step-pnl{display:none;flex-direction:column;gap:1rem}
.step-pnl.active{display:flex}
.fgroup{display:flex;flex-direction:column;gap:0.4rem}
.flabel{font-size:0.62rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted2);font-weight:600}
.finput{background:var(--bg2);border:1px solid var(--border2);color:var(--text);font-family:'Inter',sans-serif;font-size:0.82rem;padding:0.7rem 0.9rem;outline:none;transition:border-color 0.15s;width:100%;border-radius:4px}
.finput:focus{border-color:var(--accent)}
.finput::placeholder{color:var(--muted)}
.modal-footer{display:flex;justify-content:space-between;align-items:center;padding-top:0.5rem;border-top:1px solid var(--border);margin-top:0.5rem}
.modal-step-lbl{font-size:0.65rem;color:var(--muted2)}
.dns-box{background:var(--bg);border:1px solid var(--border);padding:1rem;display:flex;flex-direction:column;gap:0.7rem;border-radius:4px}
.dns-rec{display:grid;grid-template-columns:80px 100px 1fr;gap:0.6rem;align-items:center;font-size:0.72rem}
.dns-rec-hdr{font-size:0.58rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted)}
.dns-val{background:var(--bg2);border:1px solid var(--border);padding:0.4rem 0.6rem;color:var(--green);word-break:break-all;cursor:pointer;font-size:0.7rem;transition:border-color 0.15s;border-radius:3px;font-family:monospace}
.dns-val:hover{border-color:var(--accent)}
.chk-row{display:flex;align-items:center;gap:0.8rem;padding:0.7rem;background:var(--bg2);border:1px solid var(--border);border-radius:4px}
.chk-icon{font-size:1rem;width:20px;text-align:center}
.chk-lbl{font-size:0.75rem;flex:1}
.chk-status{font-size:0.65rem;color:var(--muted2)}
.xml-area{width:100%;background:var(--bg);border:1px solid var(--border);color:var(--green);font-family:monospace;font-size:0.72rem;padding:1rem;resize:vertical;min-height:220px;outline:none;border-radius:4px}
.status-bar{position:fixed;bottom:0;left:0;right:0;border-top:1px solid var(--border);background:var(--bg1);padding:0.5rem 1.5rem;display:flex;align-items:center;justify-content:space-between;font-size:0.62rem;color:var(--muted);letter-spacing:0.06em;z-index:10}
.status-bar-left{display:flex;align-items:center;gap:0.8rem}
@keyframes pulse{0%,100%{opacity:1;box-shadow:0 0 6px var(--green)}50%{opacity:0.5;box-shadow:0 0 12px var(--green)}}
@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@media(max-width:1100px){.kpi-5{grid-template-columns:repeat(3,1fr)}.g2{grid-template-columns:1fr}.sidebar{display:none}}
@media(max-width:640px){.kpi-5,.kpi-4{grid-template-columns:1fr 1fr}.topbar-nav{display:none}.spark-grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<header class="topbar">
  <div class="logo">plain<em>.direct</em></div>
  <ul class="topbar-nav">
    <li><a data-page="dashboard" class="active">Dashboard</a></li>
    <li><a data-page="reports">Reports</a></li>
    <li><a data-page="sources">Sources</a></li>
    <li><a data-page="domains">Domains</a></li>
    <li><a data-page="alerts">Alerts</a></li>
    <li><a data-page="settings">Settings</a></li>
  </ul>
  <div class="topbar-right">
    <select class="domain-select" id="domainSelect"><option>Loading...</option></select>
    <div class="status-dot"></div>
    <span style="font-size:0.7rem;color:var(--muted2)">Live</span>
  </div>
</header>
<div class="layout">
  <aside class="sidebar">
    <div class="sidebar-section">
      <div class="sidebar-lbl">Monitor</div>
      <div class="sidebar-item active" data-page="dashboard"><span>&#9670;</span> Overview</div>
      <div class="sidebar-item" data-page="reports"><span>&#9635;</span> Reports</div>
      <div class="sidebar-item" data-page="sources"><span>&#9678;</span> Sources</div>
    </div>
    <div class="sidebar-section">
      <div class="sidebar-lbl">Security</div>
      <div class="sidebar-item" data-page="alerts"><span>&#9889;</span> Alerts <span class="sidebar-badge" id="alert-badge">0</span></div>
    </div>
    <div class="sidebar-section">
      <div class="sidebar-lbl">Configure</div>
      <div class="sidebar-item" data-page="domains"><span>&#9671;</span> Domains</div>
      <div class="sidebar-item" data-page="settings"><span>&#9881;</span> Settings</div>
      <div class="sidebar-item admin-only" data-page="users" style="display:none"><span>&#9673;</span> Users</div>
    </div>
  </aside>
  <main class="main">

    <!-- DASHBOARD -->
    <div class="pview active" id="page-dashboard">
      <div class="page-hdr">
        <div><div class="page-title">Dashboard</div><div class="page-sub">DMARC email authentication monitoring</div></div>
        <div class="page-acts"><button class="btn btn-g">Export</button><button class="btn btn-a" id="btn-add-domain">+ Add Domain</button></div>
      </div>
      <div class="kpi-row kpi-5">
        <div class="kpi"><div class="kpi-lbl">Total Emails</div><div class="kpi-val" id="kpi-total" style="color:var(--text)">&#8212;</div><div class="kpi-d nt" id="kpi-total-d">No reports yet</div><div class="kpi-bar"><div class="kpi-fill" style="width:72%;background:var(--accent)"></div></div></div>
        <div class="kpi"><div class="kpi-lbl">DMARC Pass</div><div class="kpi-val" id="kpi-pass-rate" style="color:var(--green)">&#8212;</div><div class="kpi-d nt" id="kpi-pass-d">Upload a report</div><div class="kpi-bar"><div class="kpi-fill" style="width:94%;background:var(--green)"></div></div></div>
        <div class="kpi"><div class="kpi-lbl">DMARC Fail</div><div class="kpi-val" id="kpi-fail" style="color:var(--red)">&#8212;</div><div class="kpi-d nt">Failures from reports</div><div class="kpi-bar"><div class="kpi-fill" style="width:6%;background:var(--red)"></div></div></div>
        <div class="kpi"><div class="kpi-lbl">Threats Blocked</div><div class="kpi-val" id="kpi-threats" style="color:var(--orange)">&#8212;</div><div class="kpi-d nt">Failed messages</div><div class="kpi-bar"><div class="kpi-fill" style="width:45%;background:var(--orange)"></div></div></div>
        <div class="kpi"><div class="kpi-lbl">Active Domains</div><div class="kpi-val" style="color:var(--blue)" id="kpi-domains">0</div><div class="kpi-d nt">Your protected domains</div><div class="kpi-bar"><div class="kpi-fill" style="width:100%;background:var(--blue)"></div></div></div>
      </div>
      <div class="panel">
        <div class="panel-hdr"><span class="panel-ttl">Email Volume &#8212; 30 Days</span><span class="panel-act" data-page="reports">View full report</span></div>
        <div class="panel-body">
          <div class="spark-grid">
            <div class="spark-cell"><div class="spark-ttl">SPF Pass</div><div class="spark-v" id="dash-spf">&#8212;</div><svg class="spark" viewBox="0 0 100 36" preserveAspectRatio="none"><polyline points="0,28 10,24 20,26 30,18 40,22 50,14 60,16 70,10 80,8 90,12 100,6" fill="none" stroke="var(--green)" stroke-width="1.5"/><polyline points="0,28 10,24 20,26 30,18 40,22 50,14 60,16 70,10 80,8 90,12 100,6 100,36 0,36" fill="rgba(74,222,128,0.08)" stroke="none"/></svg></div>
            <div class="spark-cell"><div class="spark-ttl">DKIM Pass</div><div class="spark-v" id="dash-dkim">&#8212;</div><svg class="spark" viewBox="0 0 100 36" preserveAspectRatio="none"><polyline points="0,30 10,26 20,28 30,20 40,18 50,16 60,14 70,12 80,10 90,8 100,6" fill="none" stroke="var(--blue)" stroke-width="1.5"/><polyline points="0,30 10,26 20,28 30,20 40,18 50,16 60,14 70,12 80,10 90,8 100,6 100,36 0,36" fill="rgba(41,182,246,0.08)" stroke="none"/></svg></div>
            <div class="spark-cell"><div class="spark-ttl">Rejected</div><div class="spark-v" id="dash-rejected">&#8212;</div><svg class="spark" viewBox="0 0 100 36" preserveAspectRatio="none"><polyline points="0,20 10,22 20,18 30,24 40,16 50,20 60,14 70,18 80,12 90,16 100,10" fill="none" stroke="var(--red)" stroke-width="1.5"/><polyline points="0,20 10,22 20,18 30,24 40,16 50,20 60,14 70,18 80,12 90,16 100,10 100,36 0,36" fill="rgba(230,51,41,0.08)" stroke="none"/></svg></div>
          </div>
        </div>
      </div>
      <div class="g2">
        <div class="panel">
          <div class="panel-hdr"><span class="panel-ttl">Active Alerts</span><span class="panel-act" data-page="alerts">View all</span></div>
          <div class="al-list" id="dash-alerts">
            <div class="al-item"><div class="al-sev si"></div><div class="al-body"><div class="al-ttl">No alerts yet</div><div class="al-meta">Upload reports to start monitoring</div></div></div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-hdr"><span class="panel-ttl">Top Sending Sources</span><span class="panel-act" data-page="sources">Full report</span></div>
          <div class="panel-body" style="padding:0">
            <table><thead><tr><th>IP</th><th>Provider</th><th>Volume</th><th>Result</th></tr></thead><tbody id="dash-sources">
              <tr><td colspan="4" style="color:var(--muted);text-align:center;padding:1.5rem;font-size:0.72rem">Upload DMARC reports to see sources</td></tr>
            </tbody></table>
          </div>
        </div>
      </div>
    </div>

    <!-- REPORTS -->
    <div class="pview" id="page-reports">
      <div class="page-hdr"><div><div class="page-title">Reports</div><div class="page-sub">Incoming DMARC aggregate reports</div></div><div class="page-acts"><button class="btn btn-a" id="btn-upload-report">&#8593; Upload Report</button></div></div>
      <div id="reports-stats" style="display:none;grid-template-columns:repeat(6,1fr);gap:1px;background:var(--border);border:1px solid var(--border);border-radius:6px;overflow:hidden">
        <div class="kpi"><div class="kpi-lbl">Total Emails</div><div class="kpi-val" id="rs-total" style="color:var(--text)">0</div></div>
        <div class="kpi"><div class="kpi-lbl">Pass</div><div class="kpi-val" id="rs-pass" style="color:var(--green)">0</div></div>
        <div class="kpi"><div class="kpi-lbl">Fail</div><div class="kpi-val" id="rs-fail" style="color:var(--red)">0</div></div>
        <div class="kpi"><div class="kpi-lbl">Compliance</div><div class="kpi-val" id="rs-rate" style="color:var(--green)">0%</div></div>
        <div class="kpi"><div class="kpi-lbl">Reports</div><div class="kpi-val" id="rs-count" style="color:var(--blue)">0</div></div>
        <div class="kpi"><div class="kpi-lbl">Reporting Orgs</div><div class="kpi-val" id="rs-orgs" style="color:var(--muted2)">0</div></div>
      </div>
      <div id="reports-empty" style="display:none;padding:4rem 2rem;text-align:center;background:var(--bg1);border:1px solid var(--border);border-radius:6px">
        <div style="font-size:1.3rem;font-weight:700;color:var(--muted2);margin-bottom:0.8rem">No reports yet</div>
        <div style="font-size:0.78rem;color:var(--muted);margin-bottom:1.5rem">Upload DMARC XML aggregate reports received at your rua= address.<br>Files can be .xml, .xml.gz or .zip</div>
        <button class="btn btn-a" onclick="openUploadModal()">&#8593; Upload your first report</button>
      </div>
      <div class="panel">
        <div class="panel-hdr"><span class="panel-ttl">Aggregate Reports</span><span class="panel-act" onclick="loadReports()" style="cursor:pointer">&#8635; Refresh</span></div>
        <div class="panel-body" style="padding:0">
          <div class="tw-wrap"><table><thead><tr><th>Date</th><th>Org</th><th>Domain</th><th>Messages</th><th>Pass</th><th>Fail</th><th>Compliance</th><th></th></tr></thead>
          <tbody id="reports-tbody"><tr><td colspan="8" style="color:var(--muted);text-align:center;padding:2rem">Loading...</td></tr></tbody></table></div>
        </div>
      </div>
    </div>

    <!-- SOURCES -->
    <div class="pview" id="page-sources">
      <div class="page-hdr"><div><div class="page-title">Sources</div><div class="page-sub">All detected sending sources</div></div></div>
      <div class="kpi-row kpi-4" id="sources-kpis">
        <div class="kpi"><div class="kpi-lbl">Total Sources</div><div class="kpi-val" style="color:var(--text)" id="src-total">0</div></div>
        <div class="kpi"><div class="kpi-lbl">Authorized</div><div class="kpi-val" style="color:var(--green)" id="src-auth">0</div></div>
        <div class="kpi"><div class="kpi-lbl">Unauthorized</div><div class="kpi-val" style="color:var(--red)" id="src-unauth">0</div></div>
        <div class="kpi"><div class="kpi-lbl">Total Emails</div><div class="kpi-val" style="color:var(--blue)" id="src-volume">0</div></div>
      </div>
      <div class="panel">
        <div class="panel-hdr"><span class="panel-ttl">All Sending Sources</span><span class="panel-act" onclick="loadSourcesPage()" style="cursor:pointer">&#8635; Refresh</span></div>
        <div class="panel-body" style="padding:0">
          <div class="tw-wrap"><table><thead><tr><th>IP / Range</th><th>Domain</th><th>Volume</th><th>SPF</th><th>DKIM</th><th>Pass Rate</th><th>Status</th></tr></thead><tbody id="sources-tbody">
            <tr><td colspan="7" style="color:var(--muted);text-align:center;padding:2rem;font-size:0.75rem">Upload DMARC reports to see sending sources</td></tr>
          </tbody></table></div>
        </div>
      </div>
    </div>

    <!-- ALERTS -->
    <div class="pview" id="page-alerts">
      <div class="page-hdr"><div><div class="page-title">Alerts</div><div class="page-sub">Security events and notifications</div></div><div class="page-acts"><button class="btn btn-g" onclick="clearAlerts()">Mark all read</button></div></div>
      <div class="kpi-row kpi-4">
        <div class="kpi"><div class="kpi-lbl">Critical</div><div class="kpi-val" id="alert-kpi-critical" style="color:var(--red)">0</div></div>
        <div class="kpi"><div class="kpi-lbl">Warnings</div><div class="kpi-val" id="alert-kpi-warnings" style="color:var(--orange)">0</div></div>
        <div class="kpi"><div class="kpi-lbl">Info</div><div class="kpi-val" id="alert-kpi-info" style="color:var(--blue)">0</div></div>
        <div class="kpi"><div class="kpi-lbl">Total</div><div class="kpi-val" id="alert-kpi-total" style="color:var(--muted2)">0</div></div>
      </div>
      <div class="panel">
        <div class="panel-hdr"><span class="panel-ttl">All Alerts</span></div>
        <div class="al-list" id="alerts-list">
          <div class="al-item"><div class="al-sev si"></div><div class="al-body"><div class="al-ttl">No alerts yet</div><div class="al-meta">Alerts appear when DMARC reports are uploaded and analyzed</div></div></div>
        </div>
      </div>
    </div>

    <!-- DOMAINS -->
    <div class="pview" id="page-domains">
      <div class="page-hdr"><div><div class="page-title">Domains</div><div class="page-sub">Your protected domains</div></div><div class="page-acts"><button class="btn btn-a" id="btn-add-domain2">+ Add Domain</button></div></div>
      <div class="dom-cards" id="domain-cards">
        <div id="domains-empty" style="padding:2rem;color:var(--muted);font-size:0.75rem;text-align:center;background:var(--bg1)">No domains yet &#8212; click + Add Domain to get started.</div>
      </div>
      <div class="panel" id="domains-dns-panel" style="display:none">
        <div class="panel-hdr"><span class="panel-ttl" id="domains-dns-title">DNS Health</span><span class="panel-act" id="domains-dns-recheck" style="cursor:pointer">Refresh</span></div>
        <div class="panel-body" id="domains-dns-body"></div>
      </div>
    </div>

    <!-- SETTINGS -->
    <div class="pview" id="page-settings">
      <div class="page-hdr"><div><div class="page-title">Settings</div><div class="page-sub">Your account</div></div><div class="page-acts"><form method="POST" action="/logout" style="margin:0"><button type="submit" class="btn btn-d">Sign out</button></form></div></div>
      <div class="panel">
        <div class="panel-hdr"><span class="panel-ttl">Account</span></div>
        <div class="panel-body" style="display:flex;flex-direction:column;gap:0.5rem">
          <div style="font-size:0.7rem;color:var(--muted2)">Signed in as</div>
          <div id="me-email" style="font-size:0.9rem">&#8212;</div>
          <div id="me-role" style="font-size:0.65rem;color:var(--accent);letter-spacing:0.08em;text-transform:uppercase;font-weight:600">&#8212;</div>
        </div>
      </div>
    </div>

    <!-- USERS (admin only) -->
    <div class="pview" id="page-users">
      <div class="page-hdr"><div><div class="page-title">Users</div><div class="page-sub">Admin &#8212; manage portal access</div></div><div class="page-acts"><button class="btn btn-a" id="btn-add-user">+ Add User</button></div></div>
      <div class="panel">
        <div class="panel-hdr"><span class="panel-ttl">All Users</span></div>
        <div class="panel-body" style="padding:0">
          <div class="tw-wrap"><table><thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Domains</th><th>Last Login</th><th></th></tr></thead>
          <tbody id="users-tbody"><tr><td colspan="6" style="color:var(--muted);text-align:center;padding:2rem">Loading...</td></tr></tbody></table></div>
        </div>
      </div>
    </div>

  </main>
</div>

<!-- ADD DOMAIN MODAL -->
<div class="modal-ov" id="modal-add">
  <div class="modal">
    <div class="modal-hdr"><div class="modal-ttl" id="modal-add-title">Add Domain &#8212; Step 1 of 3</div><button class="modal-cls" id="modal-add-close">x</button></div>
    <div class="modal-body">
      <div class="step-bar"><div class="step-seg cur" id="seg1"></div><div class="step-seg" id="seg2"></div><div class="step-seg" id="seg3"></div></div>
      <div class="step-pnl active" id="step1">
        <div class="fgroup"><div class="flabel">Domain name</div><input class="finput" id="inp-domain" type="text" placeholder="example.com"/></div>
        <div class="fgroup"><div class="flabel">RUA Report Email</div><input class="finput" id="inp-rua" type="text" placeholder="reports@example.com"/></div>
        <div class="fgroup"><div class="flabel">DMARC Policy</div><select class="finput" id="inp-policy"><option value="none">p=none &#8212; Monitor only</option><option value="quarantine">p=quarantine &#8212; Spam failures</option><option value="reject">p=reject &#8212; Block failures</option></select></div>
        <div class="modal-footer"><span class="modal-step-lbl">Step 1 of 3</span><button class="btn btn-a" id="step1-next">Next</button></div>
      </div>
      <div class="step-pnl" id="step2">
        <div style="font-size:0.75rem;color:var(--muted2)">Add these DNS records at your registrar. Click to copy.</div>
        <div class="dns-box">
          <div class="dns-rec dns-rec-hdr"><span>Type</span><span>Name</span><span>Value</span></div>
          <div class="dns-rec"><span class="tag ti">TXT</span><span style="color:var(--muted2)">@</span><span class="dns-val" id="dns-spf-add" onclick="copyDns(this)">v=spf1 include:_spf.google.com ~all</span></div>
          <div class="dns-rec"><span class="tag ti">TXT</span><span style="color:var(--muted2)">_dmarc</span><span class="dns-val" id="dns-dmarc" onclick="copyDns(this)">v=DMARC1; p=none; rua=mailto:reports@example.com</span></div>
        </div>
        <div class="modal-footer"><button class="btn btn-g" id="step2-back">Back</button><button class="btn btn-a" id="step2-next">I have added the records</button></div>
      </div>
      <div class="step-pnl" id="step3">
        <div style="font-size:0.75rem;color:var(--muted2)">Verifying DNS for <strong id="verify-domain" style="color:var(--text)">example.com</strong></div>
        <div style="display:flex;flex-direction:column;gap:0.6rem">
          <div class="chk-row" id="chk-spf"><span class="chk-icon">?</span><span class="chk-lbl">SPF Record</span><span class="chk-status">Waiting...</span></div>
          <div class="chk-row" id="chk-dmarc"><span class="chk-icon">?</span><span class="chk-lbl">DMARC Record</span><span class="chk-status">Waiting...</span></div>
          <div class="chk-row" id="chk-dkim"><span class="chk-icon">?</span><span class="chk-lbl">DKIM (optional)</span><span class="chk-status">Waiting...</span></div>
        </div>
        <div id="verify-result" style="display:none;padding:1rem;background:var(--bg2);border:1px solid var(--border);font-size:0.75rem;border-radius:4px"></div>
        <div class="modal-footer"><button class="btn btn-g" id="step3-back">Back</button><button class="btn btn-a" id="btn-verify">Run DNS Check</button></div>
      </div>
    </div>
  </div>
</div>

<!-- UPLOAD REPORT MODAL -->
<div class="modal-ov" id="modal-upload">
  <div class="modal" style="width:560px">
    <div class="modal-hdr"><div class="modal-ttl">Upload DMARC Report</div><button class="modal-cls" id="modal-upload-close">x</button></div>
    <div class="modal-body">
      <div style="font-size:0.78rem;color:var(--muted2);line-height:1.7">
        Upload the XML aggregate reports you receive at your <code style="color:var(--accent)">rua=</code> address.<br>
        Supported formats: <span style="color:var(--text)">.xml &nbsp; .xml.gz &nbsp; .zip</span>
      </div>
      <div id="upload-drop" style="border:1px dashed var(--border2);padding:3rem 2rem;text-align:center;cursor:pointer;transition:all 0.2s;background:var(--bg2);border-radius:6px">
        <div style="font-size:1.8rem;margin-bottom:0.8rem;opacity:0.4">&#8659;</div>
        <div style="font-size:0.8rem;color:var(--muted2)">Drag &amp; drop files here, or click to browse</div>
        <div style="font-size:0.65rem;color:var(--muted);margin-top:0.4rem">You can upload multiple files at once</div>
        <input type="file" id="upload-file-input" accept=".xml,.gz,.zip" multiple style="display:none"/>
      </div>
      <div id="upload-status" style="display:none;background:var(--bg2);border:1px solid var(--border);padding:1rem;font-size:0.75rem;border-radius:4px"></div>
      <div style="font-size:0.68rem;color:var(--muted);border-top:1px solid var(--border);padding-top:0.8rem">
        <strong style="color:var(--muted2)">Where to find your reports:</strong><br>
        Check the inbox of the email address you set as <code style="color:var(--accent)">rua=mailto:you@yourdomain.com</code> in your DMARC record. Google, Yahoo and Microsoft send reports daily as .zip or .xml.gz attachments.
      </div>
    </div>
  </div>
</div>

<!-- DNS CHECK MODAL -->
<div class="modal-ov" id="modal-dns">
  <div class="modal" style="width:620px">
    <div class="modal-hdr"><div class="modal-ttl" id="dns-modal-title">DNS Check</div><button class="modal-cls" id="modal-dns-close">x</button></div>
    <div class="modal-body">
      <div style="font-size:0.72rem;color:var(--muted2)">Domain: <strong id="dns-check-domain" style="color:var(--text)">&#8212;</strong></div>
      <div id="dns-check-results"><div style="color:var(--muted2);font-size:0.75rem">Select a domain to check.</div></div>
      <div style="background:var(--bg2);border:1px solid var(--border);padding:1rem;display:flex;flex-direction:column;gap:0.6rem;border-radius:4px">
        <div style="font-size:0.62rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted);font-weight:600">Published Records</div>
        <div style="font-size:0.7rem;color:var(--muted2)">SPF</div><code id="dns-spf-val" style="font-size:0.7rem;color:var(--green);word-break:break-all">&#8212;</code>
        <div style="font-size:0.7rem;color:var(--muted2);margin-top:0.4rem">DMARC</div><code id="dns-dmarc-val" style="font-size:0.7rem;color:var(--green);word-break:break-all">&#8212;</code>
      </div>
      <div style="display:flex;justify-content:space-between;padding-top:0.5rem;border-top:1px solid var(--border)">
        <button class="btn btn-g" id="dns-recheck-btn">Recheck</button>
        <button class="btn btn-a" id="modal-dns-done">Done</button>
      </div>
    </div>
  </div>
</div>

<!-- DOMAIN SETTINGS MODAL -->
<div class="modal-ov" id="modal-dom-settings">
  <div class="modal" style="width:660px;max-height:90vh">
    <div class="modal-hdr"><div class="modal-ttl" id="dom-settings-title">Domain Settings</div><button class="modal-cls" id="modal-dom-settings-close">x</button></div>
    <div class="modal-body" style="overflow-y:auto;max-height:calc(90vh - 60px)">
      <div style="display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:1.2rem">
        <button class="ds-tab active" data-tab="settings" style="background:none;border:none;color:var(--accent);font-family:'Inter',sans-serif;font-size:0.72rem;font-weight:600;letter-spacing:0.08em;padding:0.5rem 1.2rem;cursor:pointer;border-bottom:2px solid var(--accent)">Settings</button>
        <button class="ds-tab" data-tab="analysis" style="background:none;border:none;color:var(--muted2);font-family:'Inter',sans-serif;font-size:0.72rem;font-weight:500;letter-spacing:0.08em;padding:0.5rem 1.2rem;cursor:pointer;border-bottom:2px solid transparent">Analysis</button>
      </div>
      <div id="ds-tab-settings">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.8rem">
          <div class="pol-chip"><div class="pol-lbl">Domain</div><div id="ds-domain" style="font-size:1.1rem;font-weight:700">&#8212;</div></div>
          <div class="pol-chip"><div class="pol-lbl">Current Policy</div><div id="ds-policy" style="font-size:1.1rem;font-weight:700">&#8212;</div></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.8rem;margin-top:0.5rem">
          <div class="pol-chip"><div class="pol-lbl">Email Volume</div><div id="ds-volume" style="font-size:1.1rem;font-weight:700">&#8212;</div></div>
          <div class="pol-chip"><div class="pol-lbl">Compliance</div><div id="ds-compliance" style="font-size:1.1rem;font-weight:700">&#8212;</div></div>
        </div>
        <div class="fgroup" style="margin-top:1rem"><div class="flabel">DMARC Policy</div><select class="finput" id="ds-policy-sel"><option value="none">p=none &#8212; Monitor only</option><option value="quarantine">p=quarantine &#8212; Spam failures</option><option value="reject">p=reject &#8212; Block all (recommended)</option></select></div>
        <div class="fgroup"><div class="flabel">RUA Report Email</div><input class="finput" id="ds-rua" type="text" placeholder="reports@yourdomain.com"/></div>
        <div class="fgroup"><div class="flabel">Report Interval</div><select class="finput" id="ds-ri"><option value="86400">Daily</option><option value="3600">Hourly</option><option value="604800">Weekly</option></select></div>
        <div style="background:var(--bg2);border:1px solid var(--border);padding:1rem;border-radius:4px">
          <div style="font-size:0.62rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted);margin-bottom:0.6rem;font-weight:600">Resulting DMARC Record</div>
          <code id="ds-preview" style="font-size:0.7rem;color:var(--green);word-break:break-all">&#8212;</code>
        </div>
        <div style="display:flex;justify-content:space-between;padding-top:0.8rem;border-top:1px solid var(--border);margin-top:0.8rem">
          <button class="btn btn-d" id="btn-remove-domain">Remove Domain</button>
          <div style="display:flex;gap:0.6rem"><button class="btn btn-g" id="modal-dom-settings-cancel">Cancel</button><button class="btn btn-a" id="modal-dom-settings-save">Save Changes</button></div>
        </div>
      </div>
      <div id="ds-tab-analysis" style="display:none">
        <div id="ds-analysis"></div>
      </div>
    </div>
  </div>
</div>

<!-- ADD USER MODAL -->
<div class="modal-ov" id="modal-user">
  <div class="modal">
    <div class="modal-hdr"><div class="modal-ttl">Add User</div><button class="modal-cls" id="modal-user-close">x</button></div>
    <div class="modal-body">
      <div id="user-modal-error" style="display:none;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);color:var(--red);font-size:0.72rem;padding:0.6rem 0.8rem;border-radius:4px"></div>
      <div class="fgroup"><div class="flabel">Email</div><input class="finput" id="u-email" type="text" placeholder="user@company.com"/></div>
      <div class="fgroup"><div class="flabel">Name (optional)</div><input class="finput" id="u-name" type="text"/></div>
      <div class="fgroup"><div class="flabel">Password</div><input class="finput" id="u-pass" type="password" placeholder="Min. 6 characters"/></div>
      <div class="fgroup"><div class="flabel">Role</div><select class="finput" id="u-role"><option value="user">User</option><option value="admin">Admin</option></select></div>
      <div style="display:flex;justify-content:flex-end;gap:0.6rem;padding-top:1rem;border-top:1px solid var(--border)">
        <button class="btn btn-g" id="modal-user-cancel">Cancel</button>
        <button class="btn btn-a" id="modal-user-save">Create User</button>
      </div>
    </div>
  </div>
</div>

<!-- CHANGE PASSWORD MODAL -->
<div class="modal-ov" id="modal-pw">
  <div class="modal" style="width:400px">
    <div class="modal-hdr"><div class="modal-ttl">Change Password</div><button class="modal-cls" id="modal-pw-close">x</button></div>
    <div class="modal-body">
      <div id="pw-for" style="font-size:0.75rem;color:var(--muted2)"></div>
      <div class="fgroup"><div class="flabel">New Password</div><input class="finput" id="pw-input" type="password" placeholder="Min. 6 characters"/></div>
      <div style="display:flex;justify-content:flex-end;gap:0.6rem;padding-top:1rem;border-top:1px solid var(--border)">
        <button class="btn btn-g" id="modal-pw-cancel">Cancel</button>
        <button class="btn btn-a" id="modal-pw-save">Save Password</button>
      </div>
    </div>
  </div>
</div>

<!-- XML MODAL -->
<div class="modal-ov" id="modal-xml">
  <div class="modal" style="width:700px">
    <div class="modal-hdr"><div class="modal-ttl">DMARC Report XML</div><button class="modal-cls" id="modal-xml-close">x</button></div>
    <div class="modal-body"><textarea class="xml-area" id="xml-content" readonly></textarea></div>
  </div>
</div>

<div class="status-bar">
  <div class="status-bar-left">
    <div class="status-dot" style="width:5px;height:5px"></div>
    <span>PLAIN.DIRECT DMARC PORTAL</span>
  </div>
  <span id="clock"></span>
</div>

<script src="/portal.js"></script>
</body>
</html>`;
}

// Serve portal.js from file
const PORTAL_JS_PATH = path.join(__dirname, 'public', 'portal.js');
function getPortalJS() {
  try { return fs.readFileSync(PORTAL_JS_PATH, 'utf8'); } catch(e) { return '// portal.js not found'; }
}

app.get('/portal.js', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-transform');
  res.send(getPortalJS());
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.get('*', (req, res) => {
  try { if (req.cookies.token) { jwt.verify(req.cookies.token, JWT_SECRET); return res.redirect('/dashboard'); } } catch(e) {}
  res.redirect('/');
});

// Auto-seed admin user if volume is empty
function seedAdminIfNeeded() {
  const users = loadUsers();
  if (users.length === 0) {
    const seedEmail = process.env.ADMIN_EMAIL || 'admin@plain.direct';
    const seedPass = process.env.ADMIN_PASSWORD || 'admin123';
    const hash = bcrypt.hashSync(seedPass, 12);
    const admin = { id: Date.now(), email: seedEmail, password_hash: hash, name: '', role: 'admin', domains: [], created_at: new Date().toISOString(), last_login: null };
    saveUsers([admin]);
    console.log('Seeded admin user: ' + seedEmail);
  }
}

seedAdminIfNeeded();

app.listen(PORT, () => {
  console.log('PlainDMARC portal on port ' + PORT);
  console.log(loadUsers().length + ' user(s) loaded');
});
