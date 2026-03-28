import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from './database.js';
import { requireAuth, requireAdmin } from './auth.js';

const router = Router();

// All admin routes require auth + admin role
router.use(requireAuth, requireAdmin);

// ─── Users ────────────────────────────────────────────────────
router.get('/users', (req, res) => {
  try {
    const users = db.prepare('SELECT id, email, role, created_at FROM users ORDER BY created_at DESC').all();
    res.json({ users });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/users', (req, res) => {
  try {
    const { email, password, role } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const validRole = role === 'admin' ? 'admin' : 'viewer';
    const hash = bcrypt.hashSync(password, 10);

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (existing) return res.status(409).json({ error: 'User already exists' });

    const info = db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)').run(
      email.toLowerCase().trim(), hash, validRole
    );

    res.json({ success: true, user: { id: info.lastInsertRowid, email: email.toLowerCase().trim(), role: validRole } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/users/:id', (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (userId === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Domains ──────────────────────────────────────────────────
router.get('/domains', (req, res) => {
  try {
    const domains = db.prepare(`
      SELECT d.*,
        COUNT(DISTINCT r.id) as report_count,
        SUM(rec.count) as total_messages
      FROM domains d
      LEFT JOIN dmarc_reports r ON d.id = r.domain_id
      LEFT JOIN dmarc_records rec ON r.id = rec.report_id
      GROUP BY d.id
      ORDER BY d.created_at DESC
    `).all();
    res.json({ domains });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/domains', (req, res) => {
  try {
    const { domain, display_name } = req.body;
    if (!domain) return res.status(400).json({ error: 'Domain name required' });

    const existing = db.prepare('SELECT id FROM domains WHERE domain = ?').get(domain.toLowerCase().trim());
    if (existing) return res.status(409).json({ error: 'Domain already exists' });

    const info = db.prepare('INSERT INTO domains (domain, display_name) VALUES (?, ?)').run(
      domain.toLowerCase().trim(), display_name || domain.toLowerCase().trim()
    );

    res.json({ success: true, domain: { id: info.lastInsertRowid, domain: domain.toLowerCase().trim(), display_name: display_name || domain } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/domains/:id', (req, res) => {
  try {
    const domainId = parseInt(req.params.id);
    const domain = db.prepare('SELECT id FROM domains WHERE id = ?').get(domainId);
    if (!domain) return res.status(404).json({ error: 'Domain not found' });

    // Cascade delete: records → reports → domain
    const reports = db.prepare('SELECT id FROM dmarc_reports WHERE domain_id = ?').all(domainId);
    for (const report of reports) {
      db.prepare('DELETE FROM dmarc_records WHERE report_id = ?').run(report.id);
    }
    db.prepare('DELETE FROM dmarc_reports WHERE domain_id = ?').run(domainId);
    db.prepare('DELETE FROM domains WHERE id = ?').run(domainId);

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
