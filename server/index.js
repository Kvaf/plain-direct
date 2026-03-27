import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';
import routes, { seedDemoData } from './routes.js';
import { fetchReports } from './fetcher.js';
import db from './database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3004;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// API routes
app.use('/api', routes);

// Manual fetch trigger
app.post('/api/fetch-now', async (req, res) => {
  try {
    const result = await fetchReports();
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  const reportCount = db.prepare('SELECT COUNT(*) as count FROM dmarc_reports').get().count;
  res.json({ status: 'ok', reports: reportCount, uptime: process.uptime() });
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Schedule IMAP fetch
const cronSchedule = process.env.FETCH_CRON || '*/15 * * * *';
cron.schedule(cronSchedule, async () => {
  console.log('[CRON] Fetching DMARC reports...');
  try {
    const result = await fetchReports();
    console.log('[CRON] Fetch result:', result);
  } catch (e) {
    console.error('[CRON] Fetch error:', e.message);
  }
});

// Seed demo data if database is empty
const count = db.prepare('SELECT COUNT(*) as count FROM dmarc_reports').get().count;
if (count === 0) {
  console.log('[INIT] Seeding demo data...');
  seedDemoData();
  console.log('[INIT] Demo data seeded.');
}

app.listen(PORT, () => {
  console.log(`Plain Direct portal on port ${PORT}`);
  console.log(`Database: ${db.prepare('SELECT COUNT(*) as c FROM dmarc_reports').get().c} reports`);
});
