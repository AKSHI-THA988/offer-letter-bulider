/**
 * OfferFlow Backend — Express + JWT + PostgreSQL
 * =============================================
 * npm install && npm run dev
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const csvParser = require('csv-parser');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const stream = require('stream');

const app = express();
const PORT = process.env.PORT || 5000;

// ── DB Pool ─────────────────────────────────────────────────
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'offerflow',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || 'postgres',
  max: 10,
  idleTimeoutMillis: 30000,
});

// ── Middleware ───────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }));

// ── JWT Middleware ───────────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'offerflow_secret_2025');
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin' && req.user.role !== 'hr') {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
}

// ── Multer for CSV ───────────────────────────────────────────
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── Email Transporter ────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

// ════════════════════════════════════════════════════════════
// AUTH ROUTES
// ════════════════════════════════════════════════════════════

/** POST /api/auth/register */
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role = 'hr' } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'All fields required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) return res.status(409).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id, name, email, role',
      [name, email, hash, role]
    );
    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET || 'offerflow_secret_2025', { expiresIn: '7d' });
    res.status(201).json({ token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

/** POST /api/auth/login */
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET || 'offerflow_secret_2025', { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

/** GET /api/auth/me */
app.get('/api/auth/me', authMiddleware, async (req, res) => {
  const result = await pool.query('SELECT id, name, email, role, created_at FROM users WHERE id = $1', [req.user.id]);
  res.json(result.rows[0]);
});

// ════════════════════════════════════════════════════════════
// TEMPLATE ROUTES
// ════════════════════════════════════════════════════════════

/** GET /api/templates */
app.get('/api/templates', authMiddleware, async (req, res) => {
  const result = await pool.query('SELECT * FROM templates WHERE created_by = $1 ORDER BY created_at DESC', [req.user.id]);
  res.json(result.rows);
});

/** POST /api/templates */
app.post('/api/templates', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { name, body } = req.body;
    if (!name || !body) return res.status(400).json({ error: 'Name and body required' });
    const result = await pool.query(
      'INSERT INTO templates (name, body, created_by) VALUES ($1,$2,$3) RETURNING *',
      [name, body, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** PUT /api/templates/:id */
app.put('/api/templates/:id', authMiddleware, adminOnly, async (req, res) => {
  const { name, body } = req.body;
  const result = await pool.query(
    'UPDATE templates SET name=$1, body=$2, updated_at=NOW() WHERE id=$3 AND created_by=$4 RETURNING *',
    [name, body, req.params.id, req.user.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Template not found' });
  res.json(result.rows[0]);
});

/** DELETE /api/templates/:id */
app.delete('/api/templates/:id', authMiddleware, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM templates WHERE id=$1 AND created_by=$2', [req.params.id, req.user.id]);
  res.json({ message: 'Template deleted' });
});

// ════════════════════════════════════════════════════════════
// CANDIDATE ROUTES
// ════════════════════════════════════════════════════════════

/** GET /api/candidates */
app.get('/api/candidates', authMiddleware, async (req, res) => {
  const { search, status } = req.query;
  let q = 'SELECT * FROM candidates WHERE 1=1';
  const params = [];
  if (search) { params.push(`%${search}%`); q += ` AND (name ILIKE $${params.length} OR email ILIKE $${params.length})`; }
  if (status) { params.push(status); q += ` AND status = $${params.length}`; }
  q += ' ORDER BY created_at DESC';
  const result = await pool.query(q, params);
  res.json(result.rows);
});

/** POST /api/candidates */
app.post('/api/candidates', authMiddleware, async (req, res) => {
  try {
    const { name, email, phone, role, department } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'Name and email required' });
    const existing = await pool.query('SELECT id FROM candidates WHERE email = $1', [email]);
    if (existing.rows.length) return res.status(409).json({ error: 'Candidate with this email exists' });
    const result = await pool.query(
      'INSERT INTO candidates (name, email, phone, role, department) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [name, email, phone, role, department]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** PUT /api/candidates/:id */
app.put('/api/candidates/:id', authMiddleware, async (req, res) => {
  const { name, email, phone, role, department, status } = req.body;
  const result = await pool.query(
    'UPDATE candidates SET name=$1,email=$2,phone=$3,role=$4,department=$5,status=$6,updated_at=NOW() WHERE id=$7 RETURNING *',
    [name, email, phone, role, department, status, req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Candidate not found' });
  res.json(result.rows[0]);
});

/** POST /api/candidates/bulk — CSV Upload */
app.post('/api/candidates/bulk', authMiddleware, adminOnly, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'CSV file required' });
  const results = [];
  const errors = [];
  const readable = new stream.Readable();
  readable.push(req.file.buffer);
  readable.push(null);
  await new Promise((resolve) => {
    readable.pipe(csvParser())
      .on('data', (row) => results.push(row))
      .on('end', resolve);
  });
  for (const row of results) {
    try {
      await pool.query(
        'INSERT INTO candidates (name, email, phone, role, department) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (email) DO NOTHING',
        [row.name, row.email, row.phone, row.position, row.department]
      );
    } catch (e) {
      errors.push({ row, error: e.message });
    }
  }
  res.json({ imported: results.length - errors.length, errors });
});

// ════════════════════════════════════════════════════════════
// OFFER ROUTES
// ════════════════════════════════════════════════════════════

/** GET /api/offers */
app.get('/api/offers', authMiddleware, async (req, res) => {
  const { status, search, page = 1, limit = 20 } = req.query;
  let q = `SELECT o.*, c.name as candidate_name, t.name as template_name
           FROM offers o
           LEFT JOIN candidates c ON o.candidate_id = c.id
           LEFT JOIN templates t ON o.template_id = t.id
           WHERE o.created_by = $1`;
  const params = [req.user.id];
  if (status) { params.push(status); q += ` AND o.status = $${params.length}`; }
  if (search) { params.push(`%${search}%`); q += ` AND (c.name ILIKE $${params.length} OR o.data->>'position' ILIKE $${params.length})`; }
  q += ` ORDER BY o.created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
  params.push(parseInt(limit), (parseInt(page)-1)*parseInt(limit));
  const result = await pool.query(q, params);
  const count = await pool.query('SELECT COUNT(*) FROM offers WHERE created_by=$1', [req.user.id]);
  res.json({ offers: result.rows, total: parseInt(count.rows[0].count) });
});

/** GET /api/offers/stats */
app.get('/api/offers/stats', authMiddleware, async (req, res) => {
  const result = await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status='draft') as draft,
      COUNT(*) FILTER (WHERE status='sent') as sent,
      COUNT(*) FILTER (WHERE status='accepted') as accepted,
      COUNT(*) FILTER (WHERE status='rejected') as rejected
    FROM offers WHERE created_by = $1
  `, [req.user.id]);
  res.json(result.rows[0]);
});

/** GET /api/offers/:id */
app.get('/api/offers/:id', authMiddleware, async (req, res) => {
  const result = await pool.query('SELECT * FROM offers WHERE id=$1 AND created_by=$2', [req.params.id, req.user.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Offer not found' });
  res.json(result.rows[0]);
});

/** POST /api/offers */
app.post('/api/offers', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { candidate_id, template_id, data } = req.body;
    if (!template_id || !data?.name) return res.status(400).json({ error: 'Template and candidate name required' });
    const result = await pool.query(
      `INSERT INTO offers (candidate_id, template_id, data, status, created_by)
       VALUES ($1,$2,$3,'draft',$4) RETURNING *`,
      [candidate_id, template_id, JSON.stringify(data), req.user.id]
    );
    const offer = result.rows[0];
    await logHistory(offer.id, 'draft', req.user.email, 'Offer created', pool);
    res.status(201).json(offer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** PUT /api/offers/:id */
app.put('/api/offers/:id', authMiddleware, adminOnly, async (req, res) => {
  const { data } = req.body;
  const result = await pool.query(
    'UPDATE offers SET data=$1, updated_at=NOW() WHERE id=$2 AND created_by=$3 RETURNING *',
    [JSON.stringify(data), req.params.id, req.user.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Offer not found' });
  await logHistory(req.params.id, result.rows[0].status, req.user.email, 'Offer data updated', pool);
  res.json(result.rows[0]);
});

/** POST /api/offers/:id/send — Transition to Sent + Email */
app.post('/api/offers/:id/send', authMiddleware, adminOnly, async (req, res) => {
  const offerResult = await pool.query('SELECT o.*, t.body as template_body FROM offers o JOIN templates t ON o.template_id=t.id WHERE o.id=$1', [req.params.id]);
  if (!offerResult.rows.length) return res.status(404).json({ error: 'Offer not found' });
  const offer = offerResult.rows[0];
  if (offer.status !== 'draft') return res.status(400).json({ error: 'Only draft offers can be sent' });

  await pool.query('UPDATE offers SET status=\'sent\', sent_at=NOW() WHERE id=$1', [req.params.id]);
  await logHistory(req.params.id, 'sent', req.user.email, 'Offer sent to candidate', pool);

  // Send email with PDF
  try {
    const htmlBody = applyPlaceholders(offer.template_body, offer.data);
    const pdfBuffer = await generatePDF(htmlBody, offer.data.name, false);
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: offer.data.email,
      subject: `Offer Letter — ${offer.data.position} at ${offer.data.company}`,
      html: `<p>Dear ${offer.data.name},</p><p>Please find your offer letter attached.</p><p>Please respond by <strong>${offer.data.deadline}</strong>.</p><p>Best regards,<br/>HR Team</p>`,
      attachments: [{ filename: `Offer_Letter_${offer.data.name.replace(/ /g,'_')}.pdf`, content: pdfBuffer }]
    });
  } catch (mailErr) {
    console.warn('Email send failed (non-fatal):', mailErr.message);
  }
  res.json({ message: 'Offer sent successfully' });
});

/** POST /api/offers/:id/status — Change status */
app.post('/api/offers/:id/status', authMiddleware, adminOnly, async (req, res) => {
  const { status, note } = req.body;
  const allowed = ['accepted', 'rejected'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Status must be accepted or rejected' });
  await pool.query('UPDATE offers SET status=$1, responded_at=NOW() WHERE id=$2', [status, req.params.id]);
  await logHistory(req.params.id, status, req.user.email, note || `Offer ${status}`, pool);
  res.json({ message: `Offer ${status}` });
});

/** GET /api/offers/:id/pdf — Download PDF */
app.get('/api/offers/:id/pdf', authMiddleware, async (req, res) => {
  const result = await pool.query('SELECT o.*, t.body as template_body FROM offers o JOIN templates t ON o.template_id=t.id WHERE o.id=$1', [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Offer not found' });
  const offer = result.rows[0];
  const html = applyPlaceholders(offer.template_body, offer.data);
  const isDraft = offer.status === 'draft';
  const pdfBuffer = await generatePDF(html, offer.data.name, isDraft);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Offer_${offer.data.name.replace(/ /g,'_')}.pdf"`);
  res.send(pdfBuffer);
});

/** GET /api/offers/:id/history */
app.get('/api/offers/:id/history', authMiddleware, async (req, res) => {
  const result = await pool.query('SELECT * FROM offer_history WHERE offer_id=$1 ORDER BY created_at DESC', [req.params.id]);
  res.json(result.rows);
});

/** POST /api/offers/:id/sign — E-signature */
app.post('/api/offers/:id/sign', authMiddleware, async (req, res) => {
  const { signature, ip_address } = req.body;
  await pool.query(
    'UPDATE offers SET signature=$1, signed_at=NOW(), signed_ip=$2, status=\'accepted\' WHERE id=$3',
    [signature, ip_address || req.ip, req.params.id]
  );
  await logHistory(req.params.id, 'accepted', 'candidate', 'E-signature received', pool);
  res.json({ message: 'Signature recorded' });
});

// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════

async function logHistory(offerId, status, user, note, pool) {
  await pool.query(
    'INSERT INTO offer_history (offer_id, status, changed_by, note) VALUES ($1,$2,$3,$4)',
    [offerId, status, user, note]
  );
}

function applyPlaceholders(body, data) {
  let result = body;
  Object.keys(data).forEach(k => {
    result = result.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), data[k] || '');
  });
  return result;
}

async function generatePDF(htmlBody, name, isDraft) {
  const fullHtml = `<!DOCTYPE html><html><head>
    <style>
      body { font-family: Georgia, serif; max-width: 680px; margin: 40px auto; padding: 0 40px; line-height: 1.9; color: #1a1a1a; }
      .watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%) rotate(-35deg); font-size: 80px; opacity: 0.04; font-weight: 900; }
      p { margin: 0 0 14px; }
      strong { font-weight: 700; }
    </style></head><body>
    ${isDraft ? '<div class="watermark">DRAFT</div>' : ''}
    <div style="text-align:right;margin-bottom:40px;color:#666;font-size:13px;">Date: ${new Date().toLocaleDateString()}</div>
    ${htmlBody.split('\n').map(l => l.trim() ? `<p>${l}</p>` : '<br/>').join('')}
    </body></html>`;
  try {
    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(fullHtml, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top:'20mm', bottom:'20mm', left:'15mm', right:'15mm' } });
    await browser.close();
    return pdf;
  } catch {
    // Fallback to PDFKit
    return new Promise((resolve) => {
      const doc = new PDFDocument({ margin: 60 });
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      if (isDraft) {
        doc.save().rotate(-35, { origin: [doc.page.width/2, doc.page.height/2] })
           .fontSize(80).fillColor('#e0e0e0').text('DRAFT', 100, 300).restore();
      }
      doc.fillColor('#1a1a1a').fontSize(12).font('Helvetica');
      const lines = htmlBody.replace(/<[^>]+>/g, '').split('\n');
      lines.forEach(l => { if (l.trim()) doc.text(l.trim(), { lineGap: 6 }); else doc.moveDown(0.5); });
      doc.end();
    });
  }
}

// ── Health check ─────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── 404 ──────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// ── Error handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => console.log(`🚀 OfferFlow API running on http://localhost:${PORT}`));
module.exports = app;
