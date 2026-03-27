import { Router } from 'express';
import db from './database.js';
import { processUploadedXml } from './fetcher.js';
import { parseString } from 'xml2js';

const router = Router();

// ─── Dashboard Overview ───────────────────────────────────────
router.get('/dashboard', (req, res) => {
  try {
    const totalReports = db.prepare('SELECT COUNT(*) as count FROM dmarc_reports').get().count;
    const totalRecords = db.prepare('SELECT SUM(count) as total FROM dmarc_records').get().total || 0;
    const totalDomains = db.prepare('SELECT COUNT(*) as count FROM domains').get().count;

    const passRate = db.prepare(`
      SELECT
        SUM(CASE WHEN dkim_result = 'pass' AND spf_result = 'pass' THEN count ELSE 0 END) as passed,
        SUM(count) as total
      FROM dmarc_records
    `).get();

    const dkimStats = db.prepare(`
      SELECT
        SUM(CASE WHEN dkim_result = 'pass' THEN count ELSE 0 END) as pass,
        SUM(CASE WHEN dkim_result = 'fail' THEN count ELSE 0 END) as fail,
        SUM(CASE WHEN dkim_result NOT IN ('pass','fail') THEN count ELSE 0 END) as other,
        SUM(count) as total
      FROM dmarc_records
    `).get();

    const spfStats = db.prepare(`
      SELECT
        SUM(CASE WHEN spf_result = 'pass' THEN count ELSE 0 END) as pass,
        SUM(CASE WHEN spf_result = 'fail' THEN count ELSE 0 END) as fail,
        SUM(CASE WHEN spf_result NOT IN ('pass','fail') THEN count ELSE 0 END) as other,
        SUM(count) as total
      FROM dmarc_records
    `).get();

    const dispositionStats = db.prepare(`
      SELECT disposition, SUM(count) as total
      FROM dmarc_records
      GROUP BY disposition
    `).all();

    const recentReports = db.prepare(`
      SELECT r.*, d.domain
      FROM dmarc_reports r
      JOIN domains d ON r.domain_id = d.id
      ORDER BY r.begin_date DESC
      LIMIT 10
    `).all();

    res.json({
      totalReports,
      totalRecords,
      totalDomains,
      passRate: passRate.total > 0 ? ((passRate.passed / passRate.total) * 100).toFixed(1) : 0,
      dkimStats,
      spfStats,
      dispositionStats,
      recentReports,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Time-based failure analytics ──────────────────────────────
router.get('/timeline/:period', (req, res) => {
  const { period } = req.params;
  const { domain } = req.query;

  let dateFilter;
  switch (period) {
    case '24h': dateFilter = "datetime('now', '-1 day')"; break;
    case '3d': dateFilter = "datetime('now', '-3 days')"; break;
    case '30d': dateFilter = "datetime('now', '-30 days')"; break;
    case '90d': dateFilter = "datetime('now', '-90 days')"; break;
    case '1y': dateFilter = "datetime('now', '-1 year')"; break;
    default: dateFilter = "datetime('now', '-30 days')";
  }

  try {
    let groupBy, dateFormat;
    if (period === '24h') {
      groupBy = "strftime('%Y-%m-%d %H:00', r.begin_date)";
      dateFormat = 'hourly';
    } else if (period === '3d') {
      groupBy = "strftime('%Y-%m-%d %H:00', r.begin_date)";
      dateFormat = 'hourly';
    } else {
      groupBy = "strftime('%Y-%m-%d', r.begin_date)";
      dateFormat = 'daily';
    }

    let domainJoin = '';
    let domainWhere = '';
    if (domain) {
      domainJoin = 'JOIN domains d2 ON r.domain_id = d2.id';
      domainWhere = `AND d2.domain = '${domain}'`;
    }

    const timeline = db.prepare(`
      SELECT
        ${groupBy} as time_bucket,
        SUM(rec.count) as total_messages,
        SUM(CASE WHEN rec.dkim_result = 'pass' AND rec.spf_result = 'pass' THEN rec.count ELSE 0 END) as passed,
        SUM(CASE WHEN rec.dkim_result != 'pass' OR rec.spf_result != 'pass' THEN rec.count ELSE 0 END) as failed,
        SUM(CASE WHEN rec.dkim_result = 'fail' THEN rec.count ELSE 0 END) as dkim_fail,
        SUM(CASE WHEN rec.spf_result = 'fail' THEN rec.count ELSE 0 END) as spf_fail,
        SUM(CASE WHEN rec.disposition = 'reject' THEN rec.count ELSE 0 END) as rejected,
        SUM(CASE WHEN rec.disposition = 'quarantine' THEN rec.count ELSE 0 END) as quarantined
      FROM dmarc_records rec
      JOIN dmarc_reports r ON rec.report_id = r.id
      ${domainJoin}
      WHERE r.begin_date >= ${dateFilter} ${domainWhere}
      GROUP BY ${groupBy}
      ORDER BY time_bucket ASC
    `).all();

    // Failure breakdown
    const failures = db.prepare(`
      SELECT
        rec.failure_reason,
        rec.source_ip,
        rec.country_code,
        rec.country_name,
        rec.as_org,
        rec.dkim_result,
        rec.spf_result,
        rec.disposition,
        rec.header_from,
        SUM(rec.count) as message_count,
        r.org_name
      FROM dmarc_records rec
      JOIN dmarc_reports r ON rec.report_id = r.id
      ${domainJoin}
      WHERE r.begin_date >= ${dateFilter}
        AND (rec.dkim_result != 'pass' OR rec.spf_result != 'pass')
        ${domainWhere}
      GROUP BY rec.source_ip, rec.dkim_result, rec.spf_result
      ORDER BY message_count DESC
      LIMIT 50
    `).all();

    res.json({ timeline, failures, dateFormat, period });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Country/Geo analytics ────────────────────────────────────
router.get('/geo', (req, res) => {
  const { domain, period } = req.query;
  let dateFilter = '';
  if (period) {
    const map = { '24h': '-1 day', '3d': '-3 days', '30d': '-30 days', '90d': '-90 days', '1y': '-1 year' };
    dateFilter = `AND r.begin_date >= datetime('now', '${map[period] || '-30 days'}')`;
  }

  let domainWhere = '';
  if (domain) domainWhere = `AND d.domain = '${domain}'`;

  try {
    const countries = db.prepare(`
      SELECT
        rec.country_code,
        rec.country_name,
        SUM(rec.count) as total_messages,
        SUM(CASE WHEN rec.dkim_result = 'pass' AND rec.spf_result = 'pass' THEN rec.count ELSE 0 END) as passed,
        SUM(CASE WHEN rec.dkim_result != 'pass' OR rec.spf_result != 'pass' THEN rec.count ELSE 0 END) as failed,
        COUNT(DISTINCT rec.source_ip) as unique_ips
      FROM dmarc_records rec
      JOIN dmarc_reports r ON rec.report_id = r.id
      JOIN domains d ON r.domain_id = d.id
      WHERE rec.country_code IS NOT NULL ${dateFilter} ${domainWhere}
      GROUP BY rec.country_code
      ORDER BY total_messages DESC
    `).all();

    res.json({ countries });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Domain list ──────────────────────────────────────────────
router.get('/domains', (req, res) => {
  try {
    const domains = db.prepare(`
      SELECT d.*,
        COUNT(DISTINCT r.id) as report_count,
        SUM(rec.count) as total_messages,
        MAX(r.begin_date) as last_report
      FROM domains d
      LEFT JOIN dmarc_reports r ON d.id = r.domain_id
      LEFT JOIN dmarc_records rec ON r.id = rec.report_id
      GROUP BY d.id
      ORDER BY total_messages DESC
    `).all();

    res.json({ domains });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Domain detail ────────────────────────────────────────────
router.get('/domains/:domain', (req, res) => {
  const { domain } = req.params;
  try {
    const domainRow = db.prepare('SELECT * FROM domains WHERE domain = ?').get(domain);
    if (!domainRow) return res.status(404).json({ error: 'Domain not found' });

    const reports = db.prepare(`
      SELECT r.*, COUNT(rec.id) as record_count, SUM(rec.count) as message_count
      FROM dmarc_reports r
      LEFT JOIN dmarc_records rec ON r.id = rec.report_id
      WHERE r.domain_id = ?
      GROUP BY r.id
      ORDER BY r.begin_date DESC
    `).all(domainRow.id);

    const stats = db.prepare(`
      SELECT
        SUM(rec.count) as total,
        SUM(CASE WHEN rec.dkim_result = 'pass' THEN rec.count ELSE 0 END) as dkim_pass,
        SUM(CASE WHEN rec.spf_result = 'pass' THEN rec.count ELSE 0 END) as spf_pass,
        SUM(CASE WHEN rec.dkim_result = 'pass' AND rec.spf_result = 'pass' THEN rec.count ELSE 0 END) as both_pass,
        SUM(CASE WHEN rec.disposition = 'none' THEN rec.count ELSE 0 END) as delivered,
        SUM(CASE WHEN rec.disposition = 'quarantine' THEN rec.count ELSE 0 END) as quarantined,
        SUM(CASE WHEN rec.disposition = 'reject' THEN rec.count ELSE 0 END) as rejected
      FROM dmarc_records rec
      JOIN dmarc_reports r ON rec.report_id = r.id
      WHERE r.domain_id = ?
    `).get(domainRow.id);

    const topSenders = db.prepare(`
      SELECT rec.source_ip, rec.as_org, rec.country_code, rec.country_name,
        rec.ptr_record, rec.dkim_result, rec.spf_result,
        SUM(rec.count) as total
      FROM dmarc_records rec
      JOIN dmarc_reports r ON rec.report_id = r.id
      WHERE r.domain_id = ?
      GROUP BY rec.source_ip
      ORDER BY total DESC
      LIMIT 20
    `).all(domainRow.id);

    res.json({ domain: domainRow, reports, stats, topSenders });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Report detail with full records ──────────────────────────
router.get('/reports/:id', (req, res) => {
  try {
    const report = db.prepare(`
      SELECT r.*, d.domain
      FROM dmarc_reports r
      JOIN domains d ON r.domain_id = d.id
      WHERE r.id = ?
    `).get(req.params.id);

    if (!report) return res.status(404).json({ error: 'Report not found' });

    const records = db.prepare(`
      SELECT * FROM dmarc_records
      WHERE report_id = ?
      ORDER BY count DESC
    `).all(report.id);

    res.json({ report, records });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Export report as XML ─────────────────────────────────────
router.get('/reports/:id/xml', (req, res) => {
  try {
    const report = db.prepare('SELECT raw_xml FROM dmarc_reports WHERE id = ?').get(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });

    res.set('Content-Type', 'application/xml');
    res.set('Content-Disposition', `attachment; filename="dmarc-report-${req.params.id}.xml"`);
    res.send(report.raw_xml);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Upload XML report manually ──────────────────────────────
router.post('/upload', async (req, res) => {
  try {
    const { xml } = req.body;
    if (!xml) return res.status(400).json({ error: 'No XML content provided' });

    const result = await processUploadedXml(xml);
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Fetch logs ───────────────────────────────────────────────
router.get('/fetch-logs', (req, res) => {
  try {
    const logs = db.prepare('SELECT * FROM fetch_logs ORDER BY created_at DESC LIMIT 50').all();
    res.json({ logs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Failure analysis ─────────────────────────────────────────
router.get('/failures', (req, res) => {
  const { domain, period } = req.query;
  let dateFilter = '';
  if (period) {
    const map = { '24h': '-1 day', '3d': '-3 days', '30d': '-30 days', '90d': '-90 days', '1y': '-1 year' };
    dateFilter = `AND r.begin_date >= datetime('now', '${map[period] || '-30 days'}')`;
  }

  let domainWhere = '';
  if (domain) domainWhere = `AND d.domain = '${domain}'`;

  try {
    // Group failures by type
    const byType = db.prepare(`
      SELECT
        CASE
          WHEN rec.dkim_result != 'pass' AND rec.spf_result != 'pass' THEN 'Both Failed'
          WHEN rec.dkim_result != 'pass' THEN 'DKIM Failed'
          WHEN rec.spf_result != 'pass' THEN 'SPF Failed'
          ELSE 'Unknown'
        END as failure_type,
        SUM(rec.count) as total
      FROM dmarc_records rec
      JOIN dmarc_reports r ON rec.report_id = r.id
      JOIN domains d ON r.domain_id = d.id
      WHERE (rec.dkim_result != 'pass' OR rec.spf_result != 'pass')
        ${dateFilter} ${domainWhere}
      GROUP BY failure_type
      ORDER BY total DESC
    `).all();

    // Top failing IPs
    const byIp = db.prepare(`
      SELECT rec.source_ip, rec.as_org, rec.country_code, rec.country_name,
        rec.ptr_record, rec.failure_reason,
        rec.dkim_result, rec.spf_result, rec.disposition,
        SUM(rec.count) as total
      FROM dmarc_records rec
      JOIN dmarc_reports r ON rec.report_id = r.id
      JOIN domains d ON r.domain_id = d.id
      WHERE (rec.dkim_result != 'pass' OR rec.spf_result != 'pass')
        ${dateFilter} ${domainWhere}
      GROUP BY rec.source_ip
      ORDER BY total DESC
      LIMIT 30
    `).all();

    // Failure reasons
    const byReason = db.prepare(`
      SELECT rec.failure_reason, SUM(rec.count) as total
      FROM dmarc_records rec
      JOIN dmarc_reports r ON rec.report_id = r.id
      JOIN domains d ON r.domain_id = d.id
      WHERE rec.failure_reason IS NOT NULL
        ${dateFilter} ${domainWhere}
      GROUP BY rec.failure_reason
      ORDER BY total DESC
      LIMIT 20
    `).all();

    res.json({ byType, byIp, byReason });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Seed demo data ───────────────────────────────────────────
router.post('/seed-demo', (req, res) => {
  try {
    seedDemoData();
    res.json({ success: true, message: 'Demo data seeded' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function seedDemoData() {
  const domains = [
    { domain: 'dmarky.com', name: 'Dmarky' },
    { domain: 'example-corp.se', name: 'Example Corp SE' },
    { domain: 'techstartup.io', name: 'TechStartup' },
  ];

  const orgs = ['Google', 'Microsoft', 'Yahoo', 'Comcast', 'Amazon SES', 'Outlook.com', 'Apple'];
  const countries = [
    { code: 'US', name: 'United States' },
    { code: 'SE', name: 'Sweden' },
    { code: 'DE', name: 'Germany' },
    { code: 'GB', name: 'United Kingdom' },
    { code: 'NL', name: 'Netherlands' },
    { code: 'FR', name: 'France' },
    { code: 'CN', name: 'China' },
    { code: 'RU', name: 'Russia' },
    { code: 'IN', name: 'India' },
    { code: 'JP', name: 'Japan' },
    { code: 'BR', name: 'Brazil' },
    { code: 'CA', name: 'Canada' },
  ];

  const ips = [
    '209.85.220.41', '209.85.220.69', '40.107.22.43', '40.92.0.1',
    '67.231.152.11', '198.2.186.4', '54.240.8.1', '17.58.23.90',
    '185.183.32.4', '103.21.244.0', '194.71.232.5', '77.72.82.101',
    '91.189.90.40', '116.203.45.12', '45.55.64.50', '138.197.111.15',
  ];

  const insertDomain = db.prepare('INSERT OR IGNORE INTO domains (domain, display_name) VALUES (?, ?)');
  const insertReport = db.prepare(`
    INSERT INTO dmarc_reports (report_id, domain_id, org_name, email, begin_date, end_date,
      policy_domain, policy_adkim, policy_aspf, policy_p, policy_sp, policy_pct, raw_xml)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertRecord = db.prepare(`
    INSERT INTO dmarc_records (report_id, source_ip, count, disposition,
      dkim_result, spf_result, dkim_domain, dkim_selector, spf_domain,
      header_from, country_code, country_name, as_org, failure_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    for (const d of domains) {
      insertDomain.run(d.domain, d.name);
    }

    const domainRows = db.prepare('SELECT * FROM domains').all();

    // Generate reports spanning the last year
    for (let daysAgo = 0; daysAgo < 365; daysAgo += Math.floor(Math.random() * 3) + 1) {
      for (const domainRow of domainRows) {
        const org = orgs[Math.floor(Math.random() * orgs.length)];
        const beginDate = new Date(Date.now() - daysAgo * 86400000);
        const endDate = new Date(beginDate.getTime() + 86400000);
        const reportId = `demo-${domainRow.domain}-${org}-${daysAgo}-${Math.random().toString(36).substr(2, 6)}`;

        const rInfo = insertReport.run(
          reportId, domainRow.id, org, `dmarc@${org.toLowerCase().replace(/\s/g, '')}.com`,
          beginDate.toISOString(), endDate.toISOString(),
          domainRow.domain, 'r', 'r', 'reject', 'reject', 100,
          `<feedback><report_metadata><report_id>${reportId}</report_id></report_metadata></feedback>`
        );

        const numRecords = Math.floor(Math.random() * 8) + 1;
        for (let i = 0; i < numRecords; i++) {
          const ip = ips[Math.floor(Math.random() * ips.length)];
          const country = countries[Math.floor(Math.random() * countries.length)];
          const count = Math.floor(Math.random() * 500) + 1;
          const asOrg = org + ' Inc.';

          // 80% pass rate for realism
          const passChance = Math.random();
          let dkim, spf, disposition;
          if (passChance < 0.75) {
            dkim = 'pass'; spf = 'pass'; disposition = 'none';
          } else if (passChance < 0.85) {
            dkim = 'pass'; spf = 'fail'; disposition = 'quarantine';
          } else if (passChance < 0.92) {
            dkim = 'fail'; spf = 'pass'; disposition = 'quarantine';
          } else {
            dkim = 'fail'; spf = 'fail'; disposition = 'reject';
          }

          let failureReason = null;
          if (spf === 'fail') failureReason = `SPF fail: IP ${ip} not in SPF record for ${domainRow.domain}`;
          if (dkim === 'fail') failureReason = (failureReason ? failureReason + ' | ' : '') + `DKIM fail: Signature mismatch for ${domainRow.domain}`;
          if (dkim === 'fail' && spf === 'fail') failureReason += ' | DMARC alignment failed: Neither passed';

          insertRecord.run(
            rInfo.lastInsertRowid, ip, count, disposition,
            dkim, spf, domainRow.domain, 'default', domainRow.domain,
            domainRow.domain, country.code, country.name, asOrg, failureReason
          );
        }
      }
    }
  });

  transaction();
}

export default router;
export { seedDemoData };
