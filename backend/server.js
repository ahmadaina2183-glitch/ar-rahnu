import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import Database from 'better-sqlite3';
import OpenAI from 'openai';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const PORT = Number(process.env.PORT || 8788);
const DB_PATH = path.resolve(__dirname, process.env.DATABASE_PATH || './arrahnu.sqlite');
const UPLOAD_DIR = path.resolve(__dirname, process.env.UPLOAD_DIR || './uploads');
const FRONTEND_DIR = path.resolve(__dirname, '..');
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.5';

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

const app = express();
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(FRONTEND_DIR));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
      cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image upload allowed'));
    cb(null, true);
  }
});

const id = () => crypto.randomUUID();
const rowToTicket = (row) => ({
  id: row.id,
  ticketNo: row.ticket_no,
  customer: { id: row.customer_id, name: row.customer_name, ic: row.ic || '', phone: row.phone || '' },
  principal: row.principal,
  remainingPrincipal: row.remaining_principal,
  goldPrice: row.gold_price,
  rate: row.rate,
  rateMode: row.rate_mode,
  startDate: row.start_date,
  tenure: row.tenure,
  status: row.status,
  imageUrl: row.image_path ? `/uploads/${path.basename(row.image_path)}` : '',
  ocrRaw: row.ocr_raw_json ? JSON.parse(row.ocr_raw_json) : null,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

function getTicket(ticketId) {
  const row = db.prepare(`
    SELECT t.*, c.name customer_name, c.ic, c.phone
    FROM pawn_tickets t JOIN customers c ON c.id=t.customer_id
    WHERE t.id=?
  `).get(ticketId);
  if (!row) return null;
  const ticket = rowToTicket(row);
  ticket.items = db.prepare('SELECT id, description, weight_gram weight, value, redeemed, redeemed_at redeemedAt FROM ticket_items WHERE ticket_id=? ORDER BY created_at').all(ticketId)
    .map((x) => ({ ...x, redeemed: Boolean(x.redeemed) }));
  ticket.transactions = db.prepare('SELECT id, type, amount, upah_amount upahAmount, total_paid totalPaid, item_ids_json itemIdsJson, created_at createdAt FROM transactions WHERE ticket_id=? ORDER BY created_at DESC').all(ticketId)
    .map((x) => ({ ...x, itemIds: JSON.parse(x.itemIdsJson || '[]'), itemIdsJson: undefined }));
  return ticket;
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'ar-rahnu-backend', db: DB_PATH }));

app.get('/api/tickets', (_req, res) => {
  const rows = db.prepare(`
    SELECT t.*, c.name customer_name, c.ic, c.phone
    FROM pawn_tickets t JOIN customers c ON c.id=t.customer_id
    ORDER BY t.created_at DESC
  `).all();
  res.json({ ok: true, tickets: rows.map(rowToTicket) });
});

app.get('/api/tickets/:id', (req, res) => {
  const ticket = getTicket(req.params.id);
  if (!ticket) return res.status(404).json({ ok: false, error: 'Ticket not found' });
  res.json({ ok: true, ticket });
});

app.post('/api/tickets', (req, res) => {
  const body = req.body || {};
  if (!body.ticketNo || !body.customer?.name) return res.status(400).json({ ok: false, error: 'ticketNo and customer.name required' });

  const customerId = body.customer.id || id();
  const ticketId = body.id || id();
  const principal = Number(body.principal || 0);
  const items = Array.isArray(body.items) ? body.items : [];

  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO customers (id, name, ic, phone, address, updated_at)
      VALUES (@id,@name,@ic,@phone,@address,CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, ic=excluded.ic, phone=excluded.phone, address=excluded.address, updated_at=CURRENT_TIMESTAMP`).run({
      id: customerId,
      name: body.customer.name,
      ic: body.customer.ic || '',
      phone: body.customer.phone || '',
      address: body.customer.address || ''
    });

    db.prepare(`INSERT INTO pawn_tickets
      (id,ticket_no,customer_id,principal,remaining_principal,gold_price,rate,rate_mode,start_date,tenure,status,image_path,ocr_raw_json)
      VALUES (@id,@ticketNo,@customerId,@principal,@remainingPrincipal,@goldPrice,@rate,@rateMode,@startDate,@tenure,@status,@imagePath,@ocrRawJson)`).run({
      id: ticketId,
      ticketNo: body.ticketNo,
      customerId,
      principal,
      remainingPrincipal: Number(body.remainingPrincipal ?? principal),
      goldPrice: Number(body.goldPrice || 0),
      rate: Number(body.rate || 0),
      rateMode: body.rateMode || 'month',
      startDate: body.startDate || new Date().toISOString().slice(0, 10),
      tenure: Number(body.tenure || 6),
      status: body.status || 'active',
      imagePath: body.imagePath || null,
      ocrRawJson: body.ocrRaw ? JSON.stringify(body.ocrRaw) : null
    });

    for (const item of items.length ? items : [{ description: 'Item emas', value: principal, weight: 0 }]) {
      db.prepare(`INSERT INTO ticket_items (id,ticket_id,description,weight_gram,value,redeemed)
        VALUES (@id,@ticketId,@description,@weight,@value,0)`).run({
        id: item.id || id(), ticketId, description: item.description || 'Item emas', weight: Number(item.weight || 0), value: Number(item.value || 0)
      });
    }

    db.prepare(`INSERT INTO transactions (id,ticket_id,type,amount,total_paid,item_ids_json)
      VALUES (?,?,?,?,?,?)`).run(id(), ticketId, 'Surat dibuka', principal, 0, '[]');
  });

  try {
    tx();
    res.status(201).json({ ok: true, ticket: getTicket(ticketId) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'image required' });
  res.json({ ok: true, file: { filename: req.file.filename, path: req.file.path, url: `/uploads/${req.file.filename}`, mimetype: req.file.mimetype, size: req.file.size } });
});

function safeJsonFromText(text) {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (!match) throw new Error('OCR response did not contain JSON');
  return JSON.parse(match[0]);
}

function fallbackOcr() {
  return {
    ticketNo: `G-${String(Date.now()).slice(-5)}`,
    customer: { name: '', ic: '', phone: '' },
    principal: 0,
    rate: 0.75,
    rateMode: 'month',
    startDate: new Date().toISOString().slice(0, 10),
    tenure: 6,
    items: [],
    notes: 'Fallback kosong: isi manual atau set OPENAI_API_KEY untuk Vision OCR sebenar.'
  };
}

app.post('/api/ocr/pawn-ticket', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'image required' });
  const imageBuffer = fs.readFileSync(req.file.path);
  const imageBase64 = imageBuffer.toString('base64');

  if (!process.env.OPENAI_API_KEY) {
    return res.json({ ok: true, mode: 'fallback-no-api-key', imageUrl: `/uploads/${req.file.filename}`, data: fallbackOcr() });
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: 'Extract Malaysian Ar-Rahnu pawn ticket data. Return ONLY valid JSON. No markdown.'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Extract these fields from the pawn ticket image. JSON shape: {"ticketNo":"","customer":{"name":"","ic":"","phone":""},"principal":0,"rate":0,"rateMode":"month|year","startDate":"YYYY-MM-DD","tenure":6,"items":[{"description":"","weight":0,"value":0}],"notes":""}. If unknown, use empty string or 0.` },
            { type: 'image_url', image_url: { url: `data:${req.file.mimetype};base64,${imageBase64}` } }
          ]
        }
      ]
    });
    const text = response.choices?.[0]?.message?.content || '{}';
    const data = safeJsonFromText(text);
    res.json({ ok: true, mode: 'openai-vision', model: OPENAI_MODEL, imageUrl: `/uploads/${req.file.filename}`, data, raw: text });
  } catch (err) {
    res.status(502).json({ ok: false, error: 'OCR Vision failed', details: err.message, imageUrl: `/uploads/${req.file.filename}` });
  }
});

app.use((err, _req, res, _next) => res.status(400).json({ ok: false, error: err.message }));
app.listen(PORT, () => console.log(`Ar-Rahnu backend running at http://127.0.0.1:${PORT}`));
