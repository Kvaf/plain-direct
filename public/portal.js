var pwTargetId = null;
var dsCurrentDomain = '';
var dnsCheckDomain = '';
var userDomains = [];
var addStep = 1;

// ── NAVIGATE ──
function navigate(page) {
  document.querySelectorAll('.pview').forEach(function(v) { v.classList.remove('active'); });
  document.querySelectorAll('[data-page]').forEach(function(a) { a.classList.remove('active'); });
  var view = document.getElementById('page-' + page);
  if (view) view.classList.add('active');
  document.querySelectorAll('[data-page="' + page + '"]').forEach(function(a) { a.classList.add('active'); });
  document.querySelector('.main').scrollTop = 0;
  if (page === 'domains') loadDomains();
  if (page === 'users') loadUsers();
  if (page === 'reports') loadReports();
  if (page === 'sources') loadSourcesPage();
  if (page === 'alerts') loadAlertsPage();
  if (page === 'dashboard') { loadReportsSummary(); loadDashboardAlerts(); loadDashboardSources(); }
}

document.querySelectorAll('[data-page]').forEach(function(el) {
  el.addEventListener('click', function(e) {
    e.preventDefault();
    navigate(el.getAttribute('data-page'));
  });
});

// ── CLOCK ──
var clockEl = document.getElementById('clock');
function tick() { if (clockEl) clockEl.textContent = new Date().toLocaleTimeString('en-GB'); }
tick();
setInterval(tick, 1000);

// ── STATUS DOT ──
setInterval(function() {
  var dot = document.querySelector('.status-dot');
  if (!dot) return;
  dot.style.background = 'var(--accent)';
  dot.style.boxShadow = '0 0 8px var(--accent)';
  setTimeout(function() { dot.style.background = 'var(--green)'; dot.style.boxShadow = '0 0 6px var(--green)'; }, 300);
}, 5000);

// ── CURRENT USER ──
fetch('/api/me').then(function(r) { return r.json(); }).then(function(me) {
  var meEmail = document.getElementById('me-email');
  var meRole = document.getElementById('me-role');
  if (meEmail) meEmail.textContent = me.email;
  if (meRole) meRole.textContent = me.role;
  if (me.role === 'admin') {
    document.querySelectorAll('.admin-only').forEach(function(el) { el.style.display = ''; });
  }
}).catch(function() {});

// ── DOMAINS ──
function loadDomains() {
  fetch('/api/domains').then(function(r) { return r.json(); }).then(function(domains) {
    userDomains = domains;
    renderDomains(domains);
    var sel = document.getElementById('domainSelect');
    if (sel) {
      sel.innerHTML = domains.length
        ? domains.map(function(d) { return '<option value="' + d.domain + '">' + d.domain + '</option>'; }).join('')
        : '<option>No domains</option>';
    }
  }).catch(function() {});
}

function renderDomains(domains) {
  var container = document.getElementById('domain-cards');
  var emptyEl = document.getElementById('domains-empty');
  if (!container) return;
  Array.from(container.children).forEach(function(c) { if (c.id !== 'domains-empty') c.remove(); });
  if (!domains || !domains.length) {
    if (emptyEl) emptyEl.style.display = 'block';
    var panel = document.getElementById('domains-dns-panel');
    if (panel) panel.style.display = 'none';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  domains.forEach(function(d) {
    var pClass = d.policy === 'reject' ? 'tp' : d.policy === 'quarantine' ? 'tw' : 'tn';
    var card = document.createElement('div');
    card.className = 'dom-card';
    card.dataset.domain = d.domain;
    card.innerHTML =
      '<div><div class="dom-name">' + d.domain + '</div>' +
      '<div class="dom-tags"><span class="tag ' + pClass + '">p=' + d.policy + '</span></div></div>' +
      '<div class="dom-acts">' +
      '<button class="btn btn-g" onclick="openDnsCheck(\'' + d.domain + '\')">DNS Check</button>' +
      '<button class="btn btn-g" onclick="openDomainSettings(\'' + d.domain + '\',\'' + d.policy + '\',\'' + (d.rua || '') + '\')">Settings</button>' +
      '</div>';
    container.insertBefore(card, emptyEl);
  });
  if (domains.length > 0) showInlineDns(domains[0].domain);
}

// Initial load
loadDomains();

function removeDomain(domain) {
  if (!confirm('Remove ' + domain + ' from your account?')) return;
  fetch('/api/domains/' + encodeURIComponent(domain), { method: 'DELETE' })
    .then(function() {
      loadDomains();
      document.getElementById('modal-dom-settings').classList.remove('open');
    });
}

// ── DNS INLINE PANEL ──
function showInlineDns(domain) {
  var panel = document.getElementById('domains-dns-panel');
  var title = document.getElementById('domains-dns-title');
  var body = document.getElementById('domains-dns-body');
  if (!panel) return;
  panel.style.display = 'block';
  title.textContent = 'DNS Health — ' + domain;
  body.innerHTML = '<div style="color:var(--muted2);font-size:0.75rem">Checking DNS for ' + domain + '...</div>';
  fetch('/api/dns/' + encodeURIComponent(domain))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      body.innerHTML = buildDnsRows(data);
      var recheck = document.getElementById('domains-dns-recheck');
      if (recheck) recheck.onclick = function() { showInlineDns(domain); };
    })
    .catch(function() {
      body.innerHTML = '<div style="color:var(--red);font-size:0.75rem">DNS lookup failed — check network</div>';
    });
}

function buildDnsRows(data) {
  var rows = [];
  // SPF
  if (data.spf.found) {
    var spfOk = !data.spf.error;
    var spfStatus = data.spf.error ? false : data.spf.warning ? 'warn' : true;
    rows.push(dnsRow(spfStatus, 'SPF Record', data.spf.error || data.spf.warning || 'Valid', spfOk));
    rows.push(dnsRow(
      data.spf.lookups >= 10 ? false : data.spf.lookups >= 8 ? 'warn' : true,
      'SPF Lookups', data.spf.lookups + '/10', data.spf.lookups < 8
    ));
    if (data.spf.record) rows.push(dnsCode(data.spf.record));
  } else {
    rows.push(dnsRow(false, 'SPF Record', data.spf.error || 'Not found', false));
  }
  // DMARC
  if (data.dmarc.found) {
    var pOk = data.dmarc.policy === 'reject';
    rows.push(dnsRow(true, 'DMARC Record', 'Found', true));
    rows.push(dnsRow(pOk ? true : 'warn', 'DMARC Policy', 'p=' + data.dmarc.policy + (pOk ? ' — enforced' : ' — consider p=reject'), pOk));
    if (data.dmarc.rua) rows.push(dnsRow(true, 'RUA Reports', data.dmarc.rua, true));
    if (data.dmarc.record) rows.push(dnsCode(data.dmarc.record));
  } else {
    rows.push(dnsRow(false, 'DMARC Record', data.dmarc.error || 'Not found', false));
  }
  // DKIM
  if (data.dkim.found) {
    data.dkim.selectors.forEach(function(s) {
      rows.push(dnsRow(true, 'DKIM: ' + s.selector, 'Found', true));
    });
  } else {
    rows.push(dnsRow('warn', 'DKIM', 'No selectors found', false));
  }
  // MX
  rows.push(dnsRow(
    data.mx.found ? true : 'warn',
    'MX Records',
    data.mx.found ? data.mx.records.map(function(m) { return m.exchange; }).join(', ') : 'Not found',
    data.mx.found
  ));
  return '<div style="display:flex;flex-direction:column;gap:0.5rem">' + rows.join('') + '</div>' +
    '<div style="font-size:0.62rem;color:var(--muted);margin-top:0.8rem">Checked: ' + new Date(data.timestamp).toLocaleTimeString() + '</div>';
}

function dnsRow(status, label, detail, ok) {
  var icon = status === 'warn' ? '⚠' : status ? '✓' : '✗';
  var iconColor = status === 'warn' ? 'var(--orange)' : status ? 'var(--green)' : 'var(--red)';
  var detailColor = status === 'warn' ? 'var(--orange)' : ok ? 'var(--green)' : 'var(--red)';
  return '<div style="display:flex;align-items:center;gap:0.8rem;padding:0.6rem 0.8rem;background:var(--bg2);border:1px solid var(--border)">' +
    '<span style="font-size:1rem;width:20px;text-align:center;color:' + iconColor + '">' + icon + '</span>' +
    '<span style="font-size:0.75rem;flex:1">' + label + '</span>' +
    '<span style="font-size:0.7rem;color:' + detailColor + '">' + detail + '</span>' +
    '</div>';
}

function dnsCode(record) {
  return '<div style="background:var(--bg);border:1px solid var(--border);padding:0.5rem 0.8rem;font-size:0.68rem;color:var(--green);word-break:break-all;font-family:\'IBM Plex Mono\',monospace">' + record + '</div>';
}

// ── DNS CHECK MODAL ──
function openDnsCheck(domain) {
  dnsCheckDomain = domain;
  document.getElementById('dns-modal-title').textContent = 'DNS Check — ' + domain;
  document.getElementById('dns-check-domain').textContent = domain;
  runRealDnsCheck(domain);
  document.getElementById('modal-dns').classList.add('open');
}

function runRealDnsCheck(domain) {
  var results = document.getElementById('dns-check-results');
  var spfEl = document.getElementById('dns-spf-val');
  var dmarcEl = document.getElementById('dns-dmarc-val');
  results.innerHTML = '<div style="color:var(--muted2);font-size:0.75rem">Checking DNS for ' + domain + '...</div>';
  if (spfEl) spfEl.textContent = 'Checking...';
  if (dmarcEl) dmarcEl.textContent = 'Checking...';
  fetch('/api/dns/' + encodeURIComponent(domain))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      results.innerHTML = buildDnsRows(data);
      if (spfEl) spfEl.textContent = data.spf.record || 'Not found';
      if (dmarcEl) dmarcEl.textContent = data.dmarc.record || 'Not found';
      showInlineDns(domain);
    })
    .catch(function() {
      results.innerHTML = '<div style="color:var(--red);font-size:0.75rem">DNS lookup failed. Please try again.</div>';
    });
}

document.getElementById('modal-dns-close').addEventListener('click', function() { document.getElementById('modal-dns').classList.remove('open'); });
document.getElementById('modal-dns-done').addEventListener('click', function() { document.getElementById('modal-dns').classList.remove('open'); });
document.getElementById('dns-recheck-btn').addEventListener('click', function() { runRealDnsCheck(dnsCheckDomain); });
document.getElementById('modal-dns').addEventListener('click', function(e) { if (e.target === this) this.classList.remove('open'); });

// ── DOMAIN SETTINGS MODAL ──
function openDomainSettings(domain, policy, rua) {
  dsCurrentDomain = domain;
  document.getElementById('dom-settings-title').textContent = 'Settings — ' + domain;
  document.getElementById('ds-domain').textContent = domain;
  document.getElementById('ds-policy').textContent = 'p=' + policy;
  document.getElementById('ds-policy').style.color = policy === 'reject' ? 'var(--green)' : policy === 'quarantine' ? 'var(--orange)' : 'var(--muted2)';
  document.getElementById('ds-volume').textContent = '—';
  document.getElementById('ds-compliance').textContent = '—';
  document.getElementById('ds-policy-sel').value = policy;
  document.getElementById('ds-rua').value = rua || '';
  document.getElementById('ds-ri').value = '86400';
  updateDsPreview();
  document.getElementById('modal-dom-settings').classList.add('open');
  loadDomainAnalysis(domain);
}

function loadDomainAnalysis(domain) {
  var el = document.getElementById('ds-analysis');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--muted2);font-size:0.72rem;padding:1rem 0">&#8987; Loading analysis...</div>';
  fetch('/api/reports/analysis/' + encodeURIComponent(domain))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.has_data) {
        el.innerHTML = '<div style="color:var(--muted);font-size:0.75rem;padding:1rem;background:var(--bg2);border:1px solid var(--border);text-align:center">' +
          'No reports uploaded for this domain yet.<br>' +
          '<span style="font-size:0.65rem;color:var(--muted)">Upload DMARC reports in the Reports section to see analysis.</span>' +
          '</div>';
        return;
      }
      // Update volume & compliance in settings tab
      var volEl = document.getElementById('ds-volume');
      var compEl = document.getElementById('ds-compliance');
      if (volEl) volEl.textContent = data.total_messages >= 1000 ? (data.total_messages/1000).toFixed(0) + 'K' : data.total_messages;
      if (compEl) { compEl.textContent = data.overall_rate + '%'; compEl.style.color = data.overall_rate >= 90 ? 'var(--green)' : data.overall_rate >= 70 ? 'var(--orange)' : 'var(--red)'; }
      el.innerHTML = buildAnalysis(data);
    })
    .catch(function() {
      el.innerHTML = '<div style="color:var(--red);font-size:0.72rem">Could not load analysis.</div>';
    });
}

function buildAnalysis(d) {
  var html = '';

  // ── SUMMARY BAR ──
  var rateColor = d.overall_rate >= 95 ? 'var(--green)' : d.overall_rate >= 80 ? 'var(--orange)' : 'var(--red)';
  html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--border);border:1px solid var(--border);margin-bottom:1rem">';
  html += kpiCell(d.overall_rate + '%', 'Overall Compliance', rateColor);
  html += kpiCell(d.total_messages.toLocaleString(), 'Total Emails', 'var(--text)');
  html += kpiCell(d.total_fail.toLocaleString(), 'Failures', d.total_fail > 0 ? 'var(--red)' : 'var(--green)');
  html += kpiCell(d.report_count, 'Reports', 'var(--blue)');
  html += '</div>';

  // ── RECOMMENDATION ──
  var rec = d.recommendation;
  var recColor = rec.confidence === 'high' ? 'var(--green)' : rec.confidence === 'medium' ? 'var(--orange)' : 'var(--muted2)';
  var recIcon = rec.action === 'maintain' ? '&#10003;' : rec.action === 'upgrade' ? '&#8679;' : '&#8987;';
  html += '<div style="background:var(--bg2);border:1px solid ' + recColor + ';padding:1rem 1.2rem;margin-bottom:1rem;display:flex;gap:0.8rem;align-items:flex-start">';
  html += '<span style="font-size:1.2rem;color:' + recColor + ';flex-shrink:0">' + recIcon + '</span>';
  html += '<div>';
  html += '<div style="font-size:0.7rem;letter-spacing:0.15em;text-transform:uppercase;color:' + recColor + ';margin-bottom:0.3rem">Policy Recommendation</div>';
  if (rec.action === 'upgrade') {
    html += '<div style="font-size:0.8rem;color:var(--text);margin-bottom:0.3rem">Move from <span style="color:var(--orange)">p=' + rec.from + '</span> to <span style="color:var(--green)">p=' + rec.to + '</span></div>';
  } else if (rec.action === 'maintain') {
    html += '<div style="font-size:0.8rem;color:var(--green);margin-bottom:0.3rem">p=reject is enforced &#10003;</div>';
  } else {
    html += '<div style="font-size:0.8rem;color:var(--muted2);margin-bottom:0.3rem">Continue monitoring with p=' + rec.to + '</div>';
  }
  html += '<div style="font-size:0.72rem;color:var(--muted)">' + rec.reason + '</div>';
  html += '</div></div>';

  // ── TREND CHART ──
  if (d.trend && d.trend.length > 1) {
    html += '<div style="background:var(--bg2);border:1px solid var(--border);padding:1rem 1.2rem;margin-bottom:1rem">';
    html += '<div style="font-size:0.62rem;letter-spacing:0.15em;text-transform:uppercase;color:var(--muted);margin-bottom:0.8rem">Compliance Trend</div>';
    html += buildTrendChart(d.trend);
    html += '</div>';
  }

  // ── NEW SENDERS ──
  if (d.new_senders && d.new_senders.length) {
    html += '<div style="background:rgba(41,182,246,0.06);border:1px solid rgba(41,182,246,0.2);padding:1rem 1.2rem;margin-bottom:1rem">';
    html += '<div style="font-size:0.62rem;letter-spacing:0.15em;text-transform:uppercase;color:var(--blue);margin-bottom:0.6rem">&#43; New Senders in Latest Report (' + d.new_senders.length + ')</div>';
    d.new_senders.forEach(function(s) {
      var pass_pct = s.total > 0 ? Math.round((s.pass/s.total)*100) : 0;
      var c = pass_pct >= 90 ? 'var(--green)' : pass_pct >= 50 ? 'var(--orange)' : 'var(--red)';
      html += '<div style="display:flex;justify-content:space-between;font-size:0.72rem;padding:0.3rem 0;border-bottom:1px solid var(--border)">';
      html += '<span style="font-family:IBM Plex Mono,monospace">' + s.ip + '</span>';
      html += '<span>' + s.total.toLocaleString() + ' msgs &nbsp; <span style="color:' + c + '">' + pass_pct + '% pass</span></span>';
      html += '</div>';
    });
    html += '</div>';
  }

  // ── MISSING SENDERS ──
  if (d.missing_senders && d.missing_senders.length) {
    html += '<div style="background:rgba(255,140,0,0.06);border:1px solid rgba(255,140,0,0.2);padding:1rem 1.2rem;margin-bottom:1rem">';
    html += '<div style="font-size:0.62rem;letter-spacing:0.15em;text-transform:uppercase;color:var(--orange);margin-bottom:0.6rem">&#8722; Senders No Longer Seen (' + d.missing_senders.length + ')</div>';
    d.missing_senders.forEach(function(s) {
      html += '<div style="display:flex;justify-content:space-between;font-size:0.72rem;padding:0.3rem 0;border-bottom:1px solid var(--border)">';
      html += '<span style="font-family:IBM Plex Mono,monospace">' + s.ip + '</span>';
      html += '<span style="color:var(--muted)">Last seen: ' + (s.last_seen||'').slice(0,10) + '</span>';
      html += '</div>';
    });
    html += '</div>';
  }

  // ── THREATS ──
  if (d.threats && d.threats.length) {
    html += '<div style="background:rgba(255,59,59,0.06);border:1px solid rgba(255,59,59,0.2);padding:1rem 1.2rem;margin-bottom:1rem">';
    html += '<div style="font-size:0.62rem;letter-spacing:0.15em;text-transform:uppercase;color:var(--red);margin-bottom:0.6rem">&#9888; Failing Senders</div>';
    d.threats.forEach(function(s) {
      var fail_pct = s.total > 0 ? Math.round((s.fail/s.total)*100) : 0;
      html += '<div style="display:flex;justify-content:space-between;font-size:0.72rem;padding:0.3rem 0;border-bottom:1px solid var(--border)">';
      html += '<span style="font-family:IBM Plex Mono,monospace">' + s.ip + '</span>';
      html += '<span>' + s.total.toLocaleString() + ' msgs &nbsp; <span style="color:var(--red)">' + fail_pct + '% fail</span></span>';
      html += '</div>';
    });
    html += '</div>';
  }

  // ── ALL SENDERS ──
  if (d.senders && d.senders.length) {
    html += '<div style="background:var(--bg2);border:1px solid var(--border);padding:1rem 1.2rem">';
    html += '<div style="font-size:0.62rem;letter-spacing:0.15em;text-transform:uppercase;color:var(--muted);margin-bottom:0.6rem">All Sending Sources</div>';
    html += '<div style="display:grid;grid-template-columns:1fr auto auto;gap:0 1rem;font-size:0.6rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted);padding:0.3rem 0;border-bottom:1px solid var(--border);margin-bottom:0.3rem">';
    html += '<span>IP</span><span>Emails</span><span>Pass</span></div>';
    d.senders.slice(0,10).forEach(function(s) {
      var pass_pct = s.total > 0 ? Math.round((s.pass/s.total)*100) : 0;
      var c = pass_pct >= 95 ? 'var(--green)' : pass_pct >= 70 ? 'var(--orange)' : 'var(--red)';
      html += '<div style="display:grid;grid-template-columns:1fr auto auto;gap:0 1rem;font-size:0.7rem;padding:0.35rem 0;border-bottom:1px solid var(--border)">';
      html += '<span style="font-family:IBM Plex Mono,monospace;color:var(--text)">' + s.ip + '</span>';
      html += '<span style="color:var(--muted2)">' + s.total.toLocaleString() + '</span>';
      html += '<span style="color:' + c + '">' + pass_pct + '%</span>';
      html += '</div>';
    });
    html += '</div>';
  }

  html += '<div style="font-size:0.62rem;color:var(--muted);margin-top:0.8rem">Based on ' + d.report_count + ' report' + (d.report_count!==1?'s':'') + ' &nbsp;&#183;&nbsp; ' + d.date_first + ' – ' + d.date_last + '</div>';
  return html;
}

function kpiCell(val, lbl, color) {
  return '<div style="background:var(--bg1);padding:0.8rem 1rem">' +
    '<div style="font-family:Bebas Neue,sans-serif;font-size:1.4rem;color:' + color + ';line-height:1">' + val + '</div>' +
    '<div style="font-size:0.58rem;letter-spacing:0.15em;text-transform:uppercase;color:var(--muted);margin-top:0.2rem">' + lbl + '</div>' +
    '</div>';
}

function buildTrendChart(trend) {
  var W = 440, H = 60, pad = 8;
  var rates = trend.map(function(t){ return t.rate; });
  var minR = Math.max(0, Math.min.apply(null,rates) - 5);
  var maxR = Math.min(100, Math.max.apply(null,rates) + 5);
  var range = maxR - minR || 1;
  var pts = rates.map(function(r,i){
    var x = pad + (i/(rates.length-1||1))*(W-pad*2);
    var y = H - pad - ((r-minR)/range)*(H-pad*2);
    return x.toFixed(1)+','+y.toFixed(1);
  });
  var polyline = pts.join(' ');
  var fill = pts.join(' ') + ' ' + (W-pad).toFixed(1)+','+(H-pad).toFixed(1) + ' ' + pad+','+(H-pad).toFixed(1);
  var lastRate = rates[rates.length-1];
  var lineColor = lastRate >= 95 ? '#00e676' : lastRate >= 80 ? '#ff8c00' : '#ff3b3b';

  var svg = '<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:'+H+'px">';
  // Grid lines at 80, 90, 100
  [80,90,100].forEach(function(v) {
    if (v < minR || v > maxR) return;
    var y = (H - pad - ((v-minR)/range)*(H-pad*2)).toFixed(1);
    svg += '<line x1="'+pad+'" y1="'+y+'" x2="'+(W-pad)+'" y2="'+y+'" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>';
    svg += '<text x="'+(W-pad+4)+'" y="'+(parseFloat(y)+3)+'" font-size="8" fill="rgba(255,255,255,0.2)">'+v+'</text>';
  });
  // Fill
  svg += '<polygon points="'+fill+'" fill="'+lineColor+'" opacity="0.07"/>';
  // Line
  svg += '<polyline points="'+polyline+'" fill="none" stroke="'+lineColor+'" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>';
  // Dots + labels
  rates.forEach(function(r,i) {
    var x = parseFloat(pts[i].split(',')[0]);
    var y = parseFloat(pts[i].split(',')[1]);
    svg += '<circle cx="'+x+'" cy="'+y+'" r="3" fill="'+lineColor+'"/>';
    svg += '<text x="'+x+'" y="'+(y-6)+'" font-size="8" fill="'+lineColor+'" text-anchor="middle">'+r+'%</text>';
  });
  // X labels (dates)
  trend.forEach(function(t,i) {
    var x = parseFloat(pts[i].split(',')[0]);
    svg += '<text x="'+x+'" y="'+(H-1)+'" font-size="7" fill="rgba(255,255,255,0.25)" text-anchor="middle">'+t.date.slice(5)+'</text>';
  });
  svg += '</svg>';
  return svg;
}

function updateDsPreview() {
  var p = document.getElementById('ds-policy-sel').value;
  var rua = document.getElementById('ds-rua').value.trim() || 'dmarc-reports@yourdomain.com';
  var ri = document.getElementById('ds-ri').value;
  document.getElementById('ds-preview').textContent = 'v=DMARC1; p=' + p + '; rua=mailto:' + rua + '; ri=' + ri + '; adkim=s; aspf=s';
}

document.getElementById('ds-policy-sel').addEventListener('change', updateDsPreview);

// Domain settings tab switching
document.querySelectorAll('.ds-tab').forEach(function(tab) {
  tab.addEventListener('click', function() {
    var target = this.getAttribute('data-tab');
    document.querySelectorAll('.ds-tab').forEach(function(t) {
      t.classList.remove('active');
      t.style.color = 'var(--muted2)';
      t.style.borderBottom = '2px solid transparent';
    });
    this.classList.add('active');
    this.style.color = 'var(--accent)';
    this.style.borderBottom = '2px solid var(--accent)';
    document.getElementById('ds-tab-settings').style.display = target === 'settings' ? '' : 'none';
    document.getElementById('ds-tab-analysis').style.display = target === 'analysis' ? '' : 'none';
  });
});
document.getElementById('ds-rua').addEventListener('input', updateDsPreview);
document.getElementById('ds-ri').addEventListener('change', updateDsPreview);
document.getElementById('modal-dom-settings-close').addEventListener('click', function() { document.getElementById('modal-dom-settings').classList.remove('open'); });
document.getElementById('modal-dom-settings-cancel').addEventListener('click', function() { document.getElementById('modal-dom-settings').classList.remove('open'); });
document.getElementById('modal-dom-settings').addEventListener('click', function(e) { if (e.target === this) this.classList.remove('open'); });
document.getElementById('modal-dom-settings-save').addEventListener('click', function() {
  var btn = this;
  btn.textContent = 'Saving...';
  btn.disabled = true;
  var policy = document.getElementById('ds-policy-sel').value;
  var rua = document.getElementById('ds-rua').value.trim();
  fetch('/api/domains/' + encodeURIComponent(dsCurrentDomain), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ policy: policy, rua: rua })
  }).then(function() {
    btn.textContent = 'Saved!';
    btn.style.background = 'var(--green)';
    btn.style.color = '#000';
    setTimeout(function() {
      btn.textContent = 'Save Changes';
      btn.style.background = '';
      btn.style.color = '';
      btn.disabled = false;
      document.getElementById('modal-dom-settings').classList.remove('open');
      loadDomains();
    }, 1200);
  }).catch(function() { btn.textContent = 'Save Changes'; btn.disabled = false; });
});

// ── ADD DOMAIN MODAL ──
function openAddDomain() {
  addStep = 1;
  showAddStep(1);
  document.getElementById('inp-domain').value = '';
  document.getElementById('inp-rua').value = '';
  document.getElementById('inp-policy').value = 'none';
  document.getElementById('verify-result').style.display = 'none';
  document.getElementById('btn-verify').textContent = 'Run DNS Check';
  document.getElementById('btn-verify').disabled = false;
  ['chk-spf', 'chk-dmarc', 'chk-dkim'].forEach(function(id) {
    var r = document.getElementById(id);
    r.querySelector('.chk-icon').textContent = '⏳';
    r.querySelector('.chk-status').textContent = 'Waiting...';
    r.querySelector('.chk-status').style.color = '';
  });
  document.getElementById('modal-add').classList.add('open');
}

function closeAddDomain() { document.getElementById('modal-add').classList.remove('open'); }

function showAddStep(n) {
  addStep = n;
  ['step1', 'step2', 'step3'].forEach(function(id, i) {
    document.getElementById(id).classList.toggle('active', i + 1 === n);
  });
  ['seg1', 'seg2', 'seg3'].forEach(function(id, i) {
    var el = document.getElementById(id);
    el.classList.remove('cur', 'done');
    if (i + 1 < n) el.classList.add('done');
    if (i + 1 === n) el.classList.add('cur');
  });
  document.getElementById('modal-add-title').textContent = 'Add Domain — Step ' + n + ' of 3';
}

document.getElementById('btn-add-domain').addEventListener('click', openAddDomain);
document.getElementById('btn-add-domain2').addEventListener('click', openAddDomain);
document.getElementById('modal-add-close').addEventListener('click', closeAddDomain);
document.getElementById('modal-add').addEventListener('click', function(e) { if (e.target === this) closeAddDomain(); });

document.getElementById('step1-next').addEventListener('click', function() {
  var domain = document.getElementById('inp-domain').value.trim();
  if (!domain) { document.getElementById('inp-domain').style.borderColor = 'var(--red)'; return; }
  document.getElementById('inp-domain').style.borderColor = '';
  var rua = document.getElementById('inp-rua').value.trim() || 'dmarc-reports@' + domain;
  var policy = document.getElementById('inp-policy').value;
  document.getElementById('dns-dmarc').textContent = 'v=DMARC1; p=' + policy + '; rua=mailto:' + rua;
  document.getElementById('verify-domain').textContent = domain;
  showAddStep(2);
});

document.getElementById('step2-back').addEventListener('click', function() { showAddStep(1); });
document.getElementById('step2-next').addEventListener('click', function() { showAddStep(3); });
document.getElementById('step3-back').addEventListener('click', function() { showAddStep(2); });

document.getElementById('btn-verify').addEventListener('click', function() {
  var domain = document.getElementById('inp-domain').value.trim() || 'example.com';
  var btn = this;
  btn.textContent = 'Checking...';
  btn.disabled = true;
  fetch('/api/dns/' + encodeURIComponent(domain))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      setChk('chk-spf', data.spf.found ? true : false, data.spf.found ? 'Found' : 'Not found');
      setChk('chk-dmarc', data.dmarc.found ? true : false, data.dmarc.found ? 'Found — p=' + data.dmarc.policy : 'Not found');
      setChk('chk-dkim', data.dkim.found ? true : 'warn', data.dkim.found ? data.dkim.selectors.length + ' selector(s) found' : 'Not found (optional)');
      var res = document.getElementById('verify-result');
      res.style.display = 'block';
      res.style.color = 'var(--green)';
      res.innerHTML = '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:1.1rem;margin-bottom:0.4rem">DNS check complete — ' + domain + '</div>' +
        '<div style="color:var(--muted2);font-size:0.7rem;margin-bottom:0.8rem">Add domain to your account to start receiving reports.</div>' +
        '<div style="display:flex;gap:0.6rem">' +
        '<button class="btn btn-a" onclick="finishAddDomain(\'' + domain + '\')">Add Domain</button>' +
        '<button class="btn btn-g" onclick="closeAddDomain()">Cancel</button>' +
        '</div>';
    })
    .catch(function() {
      btn.textContent = 'Run DNS Check';
      btn.disabled = false;
      setChk('chk-spf', false, 'Check failed');
      setChk('chk-dmarc', false, 'Check failed');
      setChk('chk-dkim', false, 'Check failed');
    });
});

function setChk(id, pass, msg) {
  var r = document.getElementById(id);
  r.querySelector('.chk-icon').textContent = pass === true ? '✓' : pass === false ? '✗' : '⚠';
  r.querySelector('.chk-icon').style.color = pass === true ? 'var(--green)' : pass === false ? 'var(--red)' : 'var(--orange)';
  r.querySelector('.chk-status').textContent = msg;
  r.querySelector('.chk-status').style.color = pass === true ? 'var(--green)' : pass === false ? 'var(--red)' : 'var(--orange)';
}

function finishAddDomain(domain) {
  var policy = document.getElementById('inp-policy').value;
  var rua = document.getElementById('inp-rua').value.trim();
  fetch('/api/domains', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain: domain, policy: policy, rua: rua })
  }).then(function() {
    closeAddDomain();
    loadDomains();
    navigate('domains');
  }).catch(function() {
    closeAddDomain();
    navigate('domains');
  });
}

// ── USERS ──
function loadUsers() {
  fetch('/api/admin/users').then(function(r) {
    if (!r.ok) throw new Error();
    return r.json();
  }).then(function(users) {
    var tbody = document.getElementById('users-tbody');
    if (!users.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="color:var(--muted);text-align:center;padding:2rem">No users yet</td></tr>';
      return;
    }
    tbody.innerHTML = users.map(function(u) {
      var role = u.role === 'admin' ? '<span class="tag ti">Admin</span>' : '<span class="tag tn">User</span>';
      var domains = u.domain_count !== undefined ? u.domain_count + ' domain' + (u.domain_count !== 1 ? 's' : '') : '—';
      return '<tr>' +
        '<td>' + u.email + '</td>' +
        '<td>' + (u.name || '—') + '</td>' +
        '<td>' + role + '</td>' +
        '<td style="color:var(--muted2)">' + domains + '</td>' +
        '<td style="color:var(--muted2)">' + (u.last_login ? u.last_login.slice(0, 10) : 'Never') + '</td>' +
        '<td><div style="display:flex;gap:0.4rem">' +
        '<button class="btn btn-g" style="padding:0.2rem 0.5rem;font-size:0.65rem" onclick="openChangePw(' + u.id + ',\'' + u.email + '\')">PW</button>' +
        '<button class="btn btn-d" style="padding:0.2rem 0.5rem;font-size:0.65rem" onclick="deleteUser(' + u.id + ',\'' + u.email + '\')">Delete</button>' +
        '</div></td>' +
        '</tr>';
    }).join('');
  }).catch(function() {
    var tbody = document.getElementById('users-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="color:var(--red);text-align:center;padding:2rem">Admin access required</td></tr>';
  });
}

// Add user modal
var btnAddUser = document.getElementById('btn-add-user');
if (btnAddUser) btnAddUser.addEventListener('click', function() {
  document.getElementById('u-email').value = '';
  document.getElementById('u-name').value = '';
  document.getElementById('u-pass').value = '';
  document.getElementById('u-role').value = 'user';
  document.getElementById('user-modal-error').style.display = 'none';
  document.getElementById('modal-user').classList.add('open');
});

document.getElementById('modal-user-close').addEventListener('click', function() { document.getElementById('modal-user').classList.remove('open'); });
document.getElementById('modal-user-cancel').addEventListener('click', function() { document.getElementById('modal-user').classList.remove('open'); });
document.getElementById('modal-user').addEventListener('click', function(e) { if (e.target === this) this.classList.remove('open'); });

document.getElementById('modal-user-save').addEventListener('click', function() {
  var email = document.getElementById('u-email').value.trim();
  var name = document.getElementById('u-name').value.trim();
  var pass = document.getElementById('u-pass').value;
  var role = document.getElementById('u-role').value;
  var errEl = document.getElementById('user-modal-error');
  if (!email || !pass) { errEl.textContent = 'Email and password required.'; errEl.style.display = 'block'; return; }
  if (pass.length < 6) { errEl.textContent = 'Password min 6 characters.'; errEl.style.display = 'block'; return; }
  errEl.style.display = 'none';
  var btn = this;
  btn.textContent = 'Creating...';
  btn.disabled = true;
  fetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, name: name, password: pass, role: role })
  }).then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
  .then(function(res) {
    btn.textContent = 'Create User';
    btn.disabled = false;
    if (!res.ok) { errEl.textContent = res.data.error || 'Error.'; errEl.style.display = 'block'; return; }
    document.getElementById('modal-user').classList.remove('open');
    loadUsers();
  }).catch(function() { btn.textContent = 'Create User'; btn.disabled = false; });
});

// Change password modal
function openChangePw(id, email) {
  pwTargetId = id;
  document.getElementById('pw-for').textContent = 'Change password for: ' + email;
  document.getElementById('pw-input').value = '';
  document.getElementById('modal-pw').classList.add('open');
}

document.getElementById('modal-pw-close').addEventListener('click', function() { document.getElementById('modal-pw').classList.remove('open'); });
document.getElementById('modal-pw-cancel').addEventListener('click', function() { document.getElementById('modal-pw').classList.remove('open'); });
document.getElementById('modal-pw').addEventListener('click', function(e) { if (e.target === this) this.classList.remove('open'); });
document.getElementById('modal-pw-save').addEventListener('click', function() {
  var pw = document.getElementById('pw-input').value;
  if (pw.length < 6) { alert('Min 6 characters.'); return; }
  var btn = this;
  btn.textContent = 'Saving...';
  btn.disabled = true;
  fetch('/api/admin/users/' + pwTargetId + '/password', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pw })
  }).then(function() {
    btn.textContent = 'Save Password';
    btn.disabled = false;
    document.getElementById('modal-pw').classList.remove('open');
  });
});

function deleteUser(id, email) {
  if (!confirm('Delete ' + email + '?')) return;
  fetch('/api/admin/users/' + id, { method: 'DELETE' }).then(function() { loadUsers(); });
}

// ── COPY HELPERS ──
function copyDns(el) {
  navigator.clipboard.writeText(el.textContent).then(function() {
    el.style.color = 'var(--accent)';
    el.style.borderColor = 'var(--accent)';
    setTimeout(function() { el.style.color = ''; el.style.borderColor = ''; }, 700);
  });
}

function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(function() {
    var orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(function() { btn.textContent = orig; }, 1500);
  });
}

// ── REPORTS ──
var reportsData = [];

function loadReports() {
  fetch('/api/reports').then(function(r){ return r.json(); }).then(function(reports) {
    reportsData = reports;
    renderReports(reports);
    // Also update dashboard KPIs if we have data
    loadReportsSummary();
  }).catch(function(){});
}

function loadReportsSummary() {
  fetch('/api/reports/stats/summary').then(function(r){ return r.json(); }).then(function(s) {
    var kpiDomains = document.getElementById('kpi-domains');
    if (kpiDomains) kpiDomains.textContent = userDomains.length || s.domains.length || 0;
    if (s.total_messages > 0) {
      var kpiTotal = document.getElementById('kpi-total');
      var kpiPassRate = document.getElementById('kpi-pass-rate');
      var kpiFail = document.getElementById('kpi-fail');
      var kpiThreats = document.getElementById('kpi-threats');
      if (kpiTotal) kpiTotal.textContent = s.total_messages >= 1000000
        ? (s.total_messages/1000000).toFixed(1) + 'M'
        : s.total_messages >= 1000 ? (s.total_messages/1000).toFixed(0) + 'K'
        : s.total_messages;
      if (kpiPassRate) { kpiPassRate.textContent = s.compliance_rate + '%'; kpiPassRate.style.color = s.compliance_rate >= 90 ? 'var(--green)' : s.compliance_rate >= 70 ? 'var(--orange)' : 'var(--red)'; }
      if (kpiFail) kpiFail.textContent = s.fail_messages >= 1000 ? (s.fail_messages/1000).toFixed(0) + 'K' : s.fail_messages;
      if (kpiThreats) kpiThreats.textContent = s.fail_messages >= 1000 ? (s.fail_messages/1000).toFixed(0) + 'K' : s.fail_messages;
    }
  }).catch(function(){});
}

function renderReports(reports) {
  var tbody = document.getElementById('reports-tbody');
  var emptyEl = document.getElementById('reports-empty');
  var statsEl = document.getElementById('reports-stats');
  if (!tbody) return;

  if (!reports || !reports.length) {
    tbody.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
    if (statsEl) statsEl.style.display = 'none';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  // Stats row
  if (statsEl) {
    statsEl.style.display = 'grid';
    var total = reports.reduce(function(s,r){ return s+r.total_messages; }, 0);
    var pass = reports.reduce(function(s,r){ return s+r.pass_messages; }, 0);
    var rate = total > 0 ? Math.round((pass/total)*1000)/10 : 0;
    document.getElementById('rs-total').textContent = total.toLocaleString();
    document.getElementById('rs-pass').textContent = pass.toLocaleString();
    document.getElementById('rs-fail').textContent = (total-pass).toLocaleString();
    document.getElementById('rs-rate').textContent = rate + '%';
    document.getElementById('rs-count').textContent = reports.length;
    var orgs = [...new Set(reports.map(function(r){ return r.org_name; }))];
    document.getElementById('rs-orgs').textContent = orgs.length;
  }

  tbody.innerHTML = reports.map(function(r) {
    var pClass = r.compliance_rate >= 95 ? 'tp' : r.compliance_rate >= 80 ? 'tw' : 'tf';
    var failClass = r.fail_messages > 0 ? 'style="color:var(--red)"' : 'style="color:var(--muted2)"';
    var dateStr = r.date_range_end ? r.date_range_end.slice(0,10) : '—';
    return '<tr>' +
      '<td>' + dateStr + '</td>' +
      '<td>' + r.org_name + '</td>' +
      '<td style="color:var(--text)">' + (r.domain || '—') + '</td>' +
      '<td>' + (r.total_messages||0).toLocaleString() + '</td>' +
      '<td><span class="tag tp">' + (r.pass_messages||0).toLocaleString() + '</span></td>' +
      '<td><span class="tag ' + (r.fail_messages > 0 ? 'tf' : 'tn') + '">' + (r.fail_messages||0).toLocaleString() + '</span></td>' +
      '<td><span class="tag ' + pClass + '">' + r.compliance_rate + '%</span></td>' +
      '<td><div style="display:flex;gap:0.4rem">' +
      '<button class="btn btn-g" style="padding:0.2rem 0.6rem;font-size:0.65rem" onclick="viewReport(\'' + r.id + '\')">Details</button>' +
      '<button class="btn btn-d" style="padding:0.2rem 0.5rem;font-size:0.65rem" onclick="deleteReport(\'' + r.id + '\')">&#x2715;</button>' +
      '</div></td>' +
      '</tr>';
  }).join('');
}

function viewReport(id) {
  fetch('/api/reports/' + id).then(function(r){ return r.json(); }).then(function(report) {
    var xml = report.raw_xml || '(no raw XML stored)';
    document.getElementById('xml-content').value = xml;
    document.getElementById('modal-xml').classList.add('open');
  });
}

function deleteReport(id) {
  if (!confirm('Delete this report?')) return;
  fetch('/api/reports/' + id, { method: 'DELETE' }).then(function(){ loadReports(); });
}

// ── UPLOAD MODAL ──
function openUploadModal() {
  document.getElementById('upload-drop').style.background = '';
  document.getElementById('upload-status').style.display = 'none';
  document.getElementById('upload-status').innerHTML = '';
  document.getElementById('modal-upload').classList.add('open');
}

document.getElementById('btn-upload-report').addEventListener('click', openUploadModal);
document.getElementById('modal-upload-close').addEventListener('click', function(){ document.getElementById('modal-upload').classList.remove('open'); });
document.getElementById('modal-upload').addEventListener('click', function(e){ if(e.target===this) this.classList.remove('open'); });

// Drag and drop
var dropZone = document.getElementById('upload-drop');
var fileInput = document.getElementById('upload-file-input');

dropZone.addEventListener('click', function(){ fileInput.click(); });
dropZone.addEventListener('dragover', function(e){ e.preventDefault(); dropZone.style.background='var(--bg3)'; dropZone.style.borderColor='var(--accent)'; });
dropZone.addEventListener('dragleave', function(){ dropZone.style.background=''; dropZone.style.borderColor=''; });
dropZone.addEventListener('drop', function(e){
  e.preventDefault();
  dropZone.style.background=''; dropZone.style.borderColor='';
  var files = Array.from(e.dataTransfer.files);
  uploadFiles(files);
});
fileInput.addEventListener('change', function(){
  uploadFiles(Array.from(fileInput.files));
  fileInput.value = '';
});

function uploadFiles(files) {
  var valid = files.filter(function(f){
    return f.name.match(/\.(xml|xml\.gz|gz|zip)$/i) || f.type === 'text/xml' || f.type === 'application/zip' || f.type === 'application/gzip';
  });
  if (!valid.length) {
    showUploadStatus('error', 'Please upload XML, .gz or .zip files.');
    return;
  }
  showUploadStatus('loading', 'Uploading ' + valid.length + ' file' + (valid.length>1?'s':'') + '...');
  var done = 0, errors = [], success = [];
  valid.forEach(function(file) {
    var reader = new FileReader();
    reader.onload = function(e) {
      fetch('/api/reports/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) },
        body: e.target.result
      }).then(function(r){ return r.json(); }).then(function(result) {
        done++;
        if (result.ok) success.push(file.name + ' — ' + result.org_name + ' — ' + (result.total_messages||0).toLocaleString() + ' msgs');
        else errors.push(file.name + ': ' + (result.error||'Unknown error'));
        if (done === valid.length) finishUpload(success, errors);
      }).catch(function() {
        done++; errors.push(file.name + ': Upload failed');
        if (done === valid.length) finishUpload(success, errors);
      });
    };
    reader.readAsArrayBuffer(file);
  });
}

function finishUpload(success, errors) {
  var html = '';
  if (success.length) html += '<div style="color:var(--green);font-size:0.75rem;margin-bottom:0.5rem">&#10003; Imported:<br>' + success.map(function(s){ return '&nbsp;&nbsp;' + s; }).join('<br>') + '</div>';
  if (errors.length) html += '<div style="color:var(--red);font-size:0.75rem">&#10007; Errors:<br>' + errors.map(function(e){ return '&nbsp;&nbsp;' + e; }).join('<br>') + '</div>';
  if (success.length) {
    html += '<div style="margin-top:1rem"><button class="btn btn-a" style="font-size:0.72rem" onclick="document.getElementById(\'modal-upload\').classList.remove(\'open\');navigate(\'reports\')">View Reports &rarr;</button></div>';
    loadReports();
  }
  showUploadStatus('done', html);
}

function showUploadStatus(type, html) {
  var el = document.getElementById('upload-status');
  el.style.display = 'block';
  if (type === 'loading') el.innerHTML = '<div style="color:var(--muted2);font-size:0.75rem">&#8987; ' + html + '</div>';
  else el.innerHTML = html;
}

function showXML(org) {
  // Legacy — not used anymore, viewReport() handles this now
}

document.getElementById('modal-xml-close').addEventListener('click', function() { document.getElementById('modal-xml').classList.remove('open'); });
document.getElementById('modal-xml').addEventListener('click', function(e) { if (e.target === this) this.classList.remove('open'); });

// ── REMOVE DOMAIN BUTTON ──
var btnRemoveDomain = document.getElementById('btn-remove-domain');
if (btnRemoveDomain) btnRemoveDomain.addEventListener('click', function() { removeDomain(dsCurrentDomain); });

// ── SOURCES PAGE ──
function loadSourcesPage() {
  fetch('/api/sources').then(function(r){ return r.json(); }).then(function(data) {
    var srcTotal = document.getElementById('src-total');
    var srcAuth = document.getElementById('src-auth');
    var srcUnauth = document.getElementById('src-unauth');
    var srcVolume = document.getElementById('src-volume');
    if (srcTotal) srcTotal.textContent = data.total;
    if (srcAuth) srcAuth.textContent = data.authorized;
    if (srcUnauth) srcUnauth.textContent = data.unauthorized;
    if (srcVolume) srcVolume.textContent = data.total_volume >= 1000000 ? (data.total_volume/1000000).toFixed(1) + 'M' : data.total_volume >= 1000 ? (data.total_volume/1000).toFixed(0) + 'K' : data.total_volume;
    
    var tbody = document.getElementById('sources-tbody');
    if (!tbody) return;
    if (!data.sources || !data.sources.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="color:var(--muted);text-align:center;padding:2rem;font-size:0.75rem">Upload DMARC reports to see sending sources</td></tr>';
      return;
    }
    tbody.innerHTML = data.sources.map(function(s) {
      var passRate = s.total > 0 ? Math.round((s.pass/s.total)*1000)/10 : 0;
      var pClass = passRate >= 95 ? 'tp' : passRate >= 70 ? 'tw' : 'tf';
      var status = passRate >= 90 ? '<span class="tag tp">Authorized</span>' : '<span class="tag tf">Unauthorized</span>';
      var spfRate = s.total > 0 ? Math.round((s.spf_pass/s.total)*100) : 0;
      var dkimRate = s.total > 0 ? Math.round((s.dkim_pass/s.total)*100) : 0;
      return '<tr>' +
        '<td style="font-family:\'IBM Plex Mono\',monospace">' + s.ip + '</td>' +
        '<td>' + (s.domain || '—') + '</td>' +
        '<td>' + s.total.toLocaleString() + '</td>' +
        '<td><span class="tag ' + (spfRate >= 90 ? 'tp' : spfRate >= 50 ? 'tw' : 'tf') + '">' + spfRate + '%</span></td>' +
        '<td><span class="tag ' + (dkimRate >= 90 ? 'tp' : dkimRate >= 50 ? 'tw' : 'tf') + '">' + dkimRate + '%</span></td>' +
        '<td><span class="tag ' + pClass + '">' + passRate + '%</span></td>' +
        '<td>' + status + '</td>' +
        '</tr>';
    }).join('');
  }).catch(function(){});
}

// ── ALERTS PAGE ──
function loadAlertsPage() {
  fetch('/api/alerts').then(function(r){ return r.json(); }).then(function(data) {
    var critEl = document.getElementById('alert-kpi-critical');
    var warnEl = document.getElementById('alert-kpi-warnings');
    var infoEl = document.getElementById('alert-kpi-info');
    var totalEl = document.getElementById('alert-kpi-total');
    if (critEl) critEl.textContent = data.counts.critical;
    if (warnEl) warnEl.textContent = data.counts.warnings;
    if (infoEl) infoEl.textContent = data.counts.info;
    if (totalEl) totalEl.textContent = data.counts.total;
    
    // Update sidebar badge
    var badges = document.querySelectorAll('.sidebar-badge');
    badges.forEach(function(b) {
      var totalAlerts = data.counts.critical + data.counts.warnings;
      b.textContent = totalAlerts;
      b.style.display = totalAlerts > 0 ? '' : 'none';
    });
    
    var list = document.getElementById('alerts-list');
    if (!list) return;
    if (!data.alerts || !data.alerts.length) {
      list.innerHTML = '<div class="al-item"><div class="al-sev si"></div><div class="al-body"><div class="al-ttl">No alerts</div><div class="al-meta">Everything looks good! No issues detected.</div></div></div>';
      return;
    }
    list.innerHTML = data.alerts.map(function(a) {
      var sevClass = a.severity === 'critical' ? 'sc' : a.severity === 'warning' ? 'sw' : 'si';
      var sevLabel = a.severity === 'critical' ? '<span class="tag tf">CRITICAL</span>' : a.severity === 'warning' ? '<span class="tag tw">WARNING</span>' : '<span class="tag ti">INFO</span>';
      var timeStr = a.time ? new Date(a.time).toLocaleDateString() : '';
      return '<div class="al-item">' +
        '<div class="al-sev ' + sevClass + '"></div>' +
        '<div class="al-body">' +
        '<div class="al-ttl">' + a.title + ' ' + sevLabel + '</div>' +
        '<div class="al-meta">' + a.detail + '</div>' +
        '</div>' +
        '<div class="al-time">' + timeStr + '</div>' +
        '</div>';
    }).join('');
  }).catch(function(){});
}

function clearAlerts() {
  var list = document.getElementById('alerts-list');
  if (list) list.innerHTML = '<div class="al-item"><div class="al-sev si"></div><div class="al-body"><div class="al-ttl">No alerts</div><div class="al-meta">All alerts marked as read.</div></div></div>';
}

// ── DASHBOARD DYNAMIC DATA ──
function loadDashboardAlerts() {
  fetch('/api/alerts').then(function(r){ return r.json(); }).then(function(data) {
    // Update sidebar badge
    var badges = document.querySelectorAll('.sidebar-badge');
    badges.forEach(function(b) {
      var totalAlerts = data.counts.critical + data.counts.warnings;
      b.textContent = totalAlerts;
      b.style.display = totalAlerts > 0 ? '' : 'none';
    });
    
    // Update dashboard alerts panel
    var alertPanel = document.querySelector('#page-dashboard .al-list');
    if (!alertPanel) return;
    if (!data.alerts || !data.alerts.length) {
      alertPanel.innerHTML = '<div class="al-item"><div class="al-sev si"></div><div class="al-body"><div class="al-ttl">No alerts</div><div class="al-meta">Everything looks good!</div></div></div>';
      return;
    }
    alertPanel.innerHTML = data.alerts.slice(0,5).map(function(a) {
      var sevClass = a.severity === 'critical' ? 'sc' : a.severity === 'warning' ? 'sw' : 'si';
      return '<div class="al-item">' +
        '<div class="al-sev ' + sevClass + '"></div>' +
        '<div class="al-body">' +
        '<div class="al-ttl">' + a.title + '</div>' +
        '<div class="al-meta">' + a.detail.substring(0,80) + (a.detail.length > 80 ? '...' : '') + '</div>' +
        '</div>' +
        '</div>';
    }).join('');
  }).catch(function(){});
}

function loadDashboardSources() {
  fetch('/api/sources').then(function(r){ return r.json(); }).then(function(data) {
    var tbody = document.querySelector('#page-dashboard .panel:last-child tbody');
    if (!tbody) return;
    if (!data.sources || !data.sources.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="color:var(--muted);text-align:center;padding:1.5rem;font-size:0.72rem">Upload DMARC reports to see sources</td></tr>';
      return;
    }
    tbody.innerHTML = data.sources.slice(0,5).map(function(s) {
      var passRate = s.total > 0 ? Math.round((s.pass/s.total)*100) : 0;
      var status = passRate >= 90 ? '<span class="tag tp">Pass</span>' : '<span class="tag tf">Fail</span>';
      return '<tr>' +
        '<td style="font-size:0.72rem;font-family:\'IBM Plex Mono\',monospace">' + s.ip + '</td>' +
        '<td style="color:var(--muted2)">' + (s.domain || '—') + '</td>' +
        '<td>' + s.total.toLocaleString() + '</td>' +
        '<td>' + status + '</td>' +
        '</tr>';
    }).join('');
  }).catch(function(){});
}

// ── EXPORT ──
function exportData() {
  fetch('/api/reports').then(function(r){ return r.json(); }).then(function(reports) {
    if (!reports.length) { alert('No reports to export.'); return; }
    var csv = 'Date,Organization,Domain,Total,Pass,Fail,Compliance\n';
    reports.forEach(function(r) {
      csv += (r.date_range_end||'').slice(0,10) + ',' +
        '"' + (r.org_name||'').replace(/"/g,'""') + '",' +
        (r.domain||'') + ',' +
        (r.total_messages||0) + ',' +
        (r.pass_messages||0) + ',' +
        (r.fail_messages||0) + ',' +
        (r.compliance_rate||0) + '%\n';
    });
    var blob = new Blob([csv], {type:'text/csv'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dmarc-report-export-' + new Date().toISOString().slice(0,10) + '.csv';
    a.click();
  });
}

// Wire export buttons
document.querySelectorAll('.btn-g').forEach(function(btn) {
  if (btn.textContent.trim() === 'Export') btn.addEventListener('click', exportData);
});

// ── DOMAIN SELECT FILTER ──
var domainSelect = document.getElementById('domainSelect');
if (domainSelect) {
  domainSelect.addEventListener('change', function() {
    // Reload dashboard data when domain changes
    loadReportsSummary();
    loadDashboardAlerts();
    loadDashboardSources();
  });
}

// ── DOMAIN SETTINGS: UPDATE VOLUME/COMPLIANCE ──
var origOpenDomainSettings = window.openDomainSettings;
if (typeof origOpenDomainSettings === 'undefined') {
  // Already defined above, just need to enhance it
}

// Initial dashboard data load
setTimeout(function() {
  loadReportsSummary();
  loadDashboardAlerts();
  loadDashboardSources();
}, 500);
