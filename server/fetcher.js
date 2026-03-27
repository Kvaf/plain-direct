import Imap from 'imap';
import { simpleParser } from 'mailparser';
import { parseString } from 'xml2js';
import zlib from 'zlib';
import { promisify } from 'util';
import db from './database.js';

const gunzip = promisify(zlib.gunzip);
const inflate = promisify(zlib.inflate);

// Country code to name mapping (common ones)
const COUNTRY_MAP = {
  US: 'United States', GB: 'United Kingdom', DE: 'Germany', FR: 'France',
  NL: 'Netherlands', CA: 'Canada', AU: 'Australia', JP: 'Japan',
  CN: 'China', RU: 'Russia', BR: 'Brazil', IN: 'India', SE: 'Sweden',
  NO: 'Norway', DK: 'Denmark', FI: 'Finland', IT: 'Italy', ES: 'Spain',
  PL: 'Poland', UA: 'Ukraine', RO: 'Romania', CZ: 'Czech Republic',
  AT: 'Austria', CH: 'Switzerland', BE: 'Belgium', IE: 'Ireland',
  SG: 'Singapore', KR: 'South Korea', TW: 'Taiwan', HK: 'Hong Kong',
  ZA: 'South Africa', MX: 'Mexico', AR: 'Argentina', CO: 'Colombia',
  CL: 'Chile', PT: 'Portugal', GR: 'Greece', TR: 'Turkey', IL: 'Israel',
  AE: 'United Arab Emirates', SA: 'Saudi Arabia', TH: 'Thailand',
  VN: 'Vietnam', ID: 'Indonesia', MY: 'Malaysia', PH: 'Philippines',
  NZ: 'New Zealand', BG: 'Bulgaria', HR: 'Croatia', HU: 'Hungary',
  SK: 'Slovakia', LT: 'Lithuania', LV: 'Latvia', EE: 'Estonia',
};

// IP geolocation via ip-api.com (free, no key needed)
async function geolocateIP(ip) {
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,city,as,org,query`);
    const data = await res.json();
    if (data.status === 'success') {
      return {
        country_code: data.countryCode,
        country_name: data.country,
        city: data.city,
        asn: data.as,
        as_org: data.org,
      };
    }
  } catch (e) {
    console.warn(`Geolocation failed for ${ip}:`, e.message);
  }
  return { country_code: null, country_name: null, city: null, asn: null, as_org: null };
}

// Reverse DNS lookup
async function reverseDNS(ip) {
  try {
    const { promises: dns } = await import('dns');
    const hostnames = await dns.reverse(ip);
    return hostnames[0] || null;
  } catch {
    return null;
  }
}

// Determine failure reason from results
function analyzeFailure(record) {
  const reasons = [];
  const dkim = record.dkim_result;
  const spf = record.spf_result;
  const disposition = record.disposition;

  if (spf === 'fail' || spf === 'softfail') {
    reasons.push(`SPF ${spf}: Sending IP not authorized for domain ${record.spf_domain || record.header_from}`);
  }
  if (spf === 'temperror') reasons.push('SPF temporary error: DNS lookup timed out');
  if (spf === 'permerror') reasons.push('SPF permanent error: Invalid SPF record syntax');
  if (spf === 'neutral') reasons.push('SPF neutral: Domain does not assert sender validity');
  if (spf === 'none') reasons.push('SPF none: No SPF record found for domain');

  if (dkim === 'fail') {
    reasons.push(`DKIM fail: Signature verification failed for ${record.dkim_domain || 'unknown domain'}`);
  }
  if (dkim === 'none') reasons.push('DKIM none: No DKIM signature present');
  if (dkim === 'temperror') reasons.push('DKIM temporary error: DNS lookup failed');
  if (dkim === 'permerror') reasons.push('DKIM permanent error: Invalid DKIM configuration');

  if (disposition === 'reject') reasons.push('Message rejected by receiver policy');
  if (disposition === 'quarantine') reasons.push('Message quarantined (sent to spam/junk)');

  if (spf !== 'pass' && dkim !== 'pass') {
    reasons.push('DMARC alignment failed: Neither SPF nor DKIM passed and aligned');
  }

  return reasons.length > 0 ? reasons.join(' | ') : null;
}

// Parse DMARC XML report
function parseDmarcXml(xmlString) {
  return new Promise((resolve, reject) => {
    parseString(xmlString, { explicitArray: false, mergeAttrs: true }, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });
}

// Extract attachment content (handles .gz, .zip, .xml)
async function extractXmlFromAttachment(attachment) {
  let content = attachment.content;
  const filename = (attachment.filename || '').toLowerCase();

  try {
    if (filename.endsWith('.gz') || filename.endsWith('.gzip')) {
      content = await gunzip(content);
    } else if (filename.endsWith('.zip')) {
      // Use zlib for basic zip extraction
      const AdmZip = (await import('adm-zip')).default;
      const zip = new AdmZip(content);
      const entries = zip.getEntries();
      for (const entry of entries) {
        if (entry.entryName.endsWith('.xml')) {
          content = entry.getData();
          break;
        }
      }
    }
    return content.toString('utf-8');
  } catch (e) {
    // Try raw inflate as fallback
    try {
      content = await inflate(attachment.content);
      return content.toString('utf-8');
    } catch {
      return attachment.content.toString('utf-8');
    }
  }
}

// Process a single DMARC report
async function processReport(xmlContent) {
  const parsed = await parseDmarcXml(xmlContent);
  const feedback = parsed.feedback;
  if (!feedback) throw new Error('Invalid DMARC report: no feedback element');

  const meta = feedback.report_metadata || {};
  const policy = feedback.policy_published || {};
  const reportId = meta.report_id || `unknown-${Date.now()}`;

  // Check if report already exists
  const existing = db.prepare('SELECT id FROM dmarc_reports WHERE report_id = ?').get(reportId);
  if (existing) return { skipped: true, reportId };

  // Get or create domain
  const domain = policy.domain || 'unknown';
  let domainRow = db.prepare('SELECT id FROM domains WHERE domain = ?').get(domain);
  if (!domainRow) {
    const info = db.prepare('INSERT INTO domains (domain, display_name) VALUES (?, ?)').run(domain, domain);
    domainRow = { id: info.lastInsertRowid };
  }

  // Insert report
  const reportInfo = db.prepare(`
    INSERT INTO dmarc_reports (
      report_id, domain_id, org_name, email, begin_date, end_date,
      policy_domain, policy_adkim, policy_aspf, policy_p, policy_sp, policy_pct, raw_xml
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    reportId,
    domainRow.id,
    meta.org_name || null,
    meta.email || null,
    meta.date_range?.begin ? new Date(parseInt(meta.date_range.begin) * 1000).toISOString() : null,
    meta.date_range?.end ? new Date(parseInt(meta.date_range.end) * 1000).toISOString() : null,
    policy.domain || null,
    policy.adkim || null,
    policy.aspf || null,
    policy.p || null,
    policy.sp || null,
    policy.pct ? parseInt(policy.pct) : null,
    xmlContent
  );

  const dbReportId = reportInfo.lastInsertRowid;

  // Process records
  let records = feedback.record;
  if (!records) return { skipped: false, reportId, recordCount: 0 };
  if (!Array.isArray(records)) records = [records];

  const insertRecord = db.prepare(`
    INSERT INTO dmarc_records (
      report_id, source_ip, count, disposition,
      dkim_result, spf_result, dkim_domain, dkim_selector,
      spf_domain, header_from, envelope_from, envelope_to,
      country_code, country_name, city, asn, as_org, ptr_record,
      is_forwarded, failure_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let recordCount = 0;
  for (const record of records) {
    const row = record.row || {};
    const identifiers = record.identifiers || {};
    const authResults = record.auth_results || {};

    const sourceIp = row.source_ip || 'unknown';
    const count = parseInt(row.count) || 1;
    const policyEval = row.policy_evaluated || {};

    // DKIM results
    let dkimResult = policyEval.dkim || 'none';
    let dkimDomain = null;
    let dkimSelector = null;
    if (authResults.dkim) {
      const dkim = Array.isArray(authResults.dkim) ? authResults.dkim[0] : authResults.dkim;
      dkimResult = dkim.result || dkimResult;
      dkimDomain = dkim.domain || null;
      dkimSelector = dkim.selector || null;
    }

    // SPF results
    let spfResult = policyEval.spf || 'none';
    let spfDomain = null;
    if (authResults.spf) {
      const spf = Array.isArray(authResults.spf) ? authResults.spf[0] : authResults.spf;
      spfResult = spf.result || spfResult;
      spfDomain = spf.domain || null;
    }

    const headerFrom = identifiers.header_from || domain;
    const envelopeFrom = identifiers.envelope_from || null;
    const envelopeTo = identifiers.envelope_to || null;

    // Geolocation
    const geo = await geolocateIP(sourceIp);
    const ptr = await reverseDNS(sourceIp);

    // Check forwarding indicators
    const isForwarded = policyEval.reason?.type === 'forwarded' ||
      policyEval.reason?.type === 'mailing_list' ? 1 : 0;

    const recordData = {
      dkim_result: dkimResult,
      spf_result: spfResult,
      dkim_domain: dkimDomain,
      spf_domain: spfDomain,
      header_from: headerFrom,
      disposition: policyEval.disposition || 'none',
    };

    const failureReason = analyzeFailure(recordData);

    insertRecord.run(
      dbReportId, sourceIp, count, policyEval.disposition || 'none',
      dkimResult, spfResult, dkimDomain, dkimSelector,
      spfDomain, headerFrom, envelopeFrom, envelopeTo,
      geo.country_code, geo.country_name, geo.city, geo.asn, geo.as_org, ptr,
      isForwarded, failureReason
    );
    recordCount++;
  }

  return { skipped: false, reportId, recordCount };
}

// Fetch DMARC reports from IMAP inbox
export async function fetchReports() {
  const config = {
    user: process.env.IMAP_USER,
    password: process.env.IMAP_PASSWORD,
    host: process.env.IMAP_HOST,
    port: parseInt(process.env.IMAP_PORT) || 993,
    tls: process.env.IMAP_TLS !== 'false',
    tlsOptions: { rejectUnauthorized: false },
  };

  if (!config.user || !config.password || !config.host) {
    console.warn('IMAP not configured, using demo mode');
    return { status: 'skipped', message: 'IMAP not configured' };
  }

  return new Promise((resolve, reject) => {
    const imap = new Imap(config);
    let results = { processed: 0, skipped: 0, errors: 0 };

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err, box) => {
        if (err) return reject(err);

        // Search for unread emails
        imap.search(['UNSEEN'], async (err, uids) => {
          if (err) return reject(err);
          if (!uids || uids.length === 0) {
            imap.end();
            return resolve({ ...results, message: 'No new reports' });
          }

          const f = imap.fetch(uids, { bodies: '', markSeen: true });

          f.on('message', (msg) => {
            msg.on('body', async (stream) => {
              try {
                const parsed = await simpleParser(stream);

                for (const attachment of (parsed.attachments || [])) {
                  const filename = (attachment.filename || '').toLowerCase();
                  if (filename.includes('.xml') || filename.includes('.gz') || filename.includes('.zip')) {
                    try {
                      const xmlContent = await extractXmlFromAttachment(attachment);
                      const result = await processReport(xmlContent);
                      if (result.skipped) results.skipped++;
                      else results.processed++;
                    } catch (e) {
                      console.error('Error processing attachment:', e.message);
                      results.errors++;
                    }
                  }
                }
              } catch (e) {
                console.error('Error parsing email:', e.message);
                results.errors++;
              }
            });
          });

          f.once('end', () => {
            imap.end();
            // Log fetch result
            db.prepare('INSERT INTO fetch_logs (status, message, reports_fetched) VALUES (?, ?, ?)')
              .run('success', JSON.stringify(results), results.processed);
            resolve(results);
          });

          f.once('error', (err) => {
            imap.end();
            reject(err);
          });
        });
      });
    });

    imap.once('error', (err) => {
      db.prepare('INSERT INTO fetch_logs (status, message) VALUES (?, ?)')
        .run('error', err.message);
      reject(err);
    });

    imap.connect();
  });
}

// Manual XML upload processing
export async function processUploadedXml(xmlContent) {
  return processReport(xmlContent);
}

export { geolocateIP, reverseDNS, analyzeFailure };
