import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = process.env.DB_PATH || './data/plain-direct.db';

// Ensure data directory exists
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS domains (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT UNIQUE NOT NULL,
    display_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS dmarc_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id TEXT UNIQUE NOT NULL,
    domain_id INTEGER NOT NULL,
    org_name TEXT,
    email TEXT,
    begin_date DATETIME,
    end_date DATETIME,
    policy_domain TEXT,
    policy_adkim TEXT,
    policy_aspf TEXT,
    policy_p TEXT,
    policy_sp TEXT,
    policy_pct INTEGER,
    raw_xml TEXT,
    fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (domain_id) REFERENCES domains(id)
  );

  CREATE TABLE IF NOT EXISTS dmarc_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL,
    source_ip TEXT NOT NULL,
    count INTEGER DEFAULT 1,
    disposition TEXT,
    dkim_result TEXT,
    spf_result TEXT,
    dkim_domain TEXT,
    dkim_selector TEXT,
    spf_domain TEXT,
    header_from TEXT,
    envelope_from TEXT,
    envelope_to TEXT,
    country_code TEXT,
    country_name TEXT,
    city TEXT,
    asn TEXT,
    as_org TEXT,
    ptr_record TEXT,
    is_forwarded INTEGER DEFAULT 0,
    failure_reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (report_id) REFERENCES dmarc_reports(id)
  );

  CREATE TABLE IF NOT EXISTS fetch_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL,
    message TEXT,
    reports_fetched INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_records_report ON dmarc_records(report_id);
  CREATE INDEX IF NOT EXISTS idx_records_source_ip ON dmarc_records(source_ip);
  CREATE INDEX IF NOT EXISTS idx_records_dkim ON dmarc_records(dkim_result);
  CREATE INDEX IF NOT EXISTS idx_records_spf ON dmarc_records(spf_result);
  CREATE INDEX IF NOT EXISTS idx_reports_domain ON dmarc_reports(domain_id);
  CREATE INDEX IF NOT EXISTS idx_reports_begin ON dmarc_reports(begin_date);
  CREATE INDEX IF NOT EXISTS idx_records_country ON dmarc_records(country_code);

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'viewer',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Seed admin user if no users exist
import bcrypt from 'bcryptjs';
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
if (userCount === 0) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)').run('admin@plain.direct', hash, 'admin');
  console.log('[INIT] Admin user created: admin@plain.direct / admin123');
}

export default db;
