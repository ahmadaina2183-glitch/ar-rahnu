import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import Database from 'better-sqlite3';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const PORT = Number(process.env.PORT || 8788);
const DB_PATH = path.resolve(__dirname, process.env.DATABASE_PATH || './arrahnu.sqlite');
const ADMIN_STATE_PATH = path.resolve(__dirname, process.env.ADMIN_STATE_PATH || './admin-state.json');
const AUTH_USERS_PATH = path.resolve(__dirname, process.env.AUTH_USERS_PATH || './auth-users.json');
const UPLOAD_DIR = path.resolve(__dirname, process.env.UPLOAD_DIR || './uploads');
const FRONTEND_DIR = path.resolve(__dirname, '..');
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.5';
const GOOGLE_MODEL = process.env.GOOGLE_MODEL || 'gemini-2.5-flash';
const AUTH_SECRET = process.env.AUTH_SECRET || 'dev-auth-secret';
const ROLE_PINS = { admin: process.env.ADMIN_PIN || '', staff: process.env.STAFF_PIN || '', customer: process.env.CUSTOMER_PIN || '' };

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

const DEMO_OWNER_ID = process.env.DEFAULT_OWNER_ID || ''; // kosong dulu sampai login/auth siap

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

let db = null;
let supabase = null;

if (USE_SUPABASE) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
} else {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
}

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
const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
const cleanUuid = (value) => isUuid(value) ? value : id();
function addMonthsIso(date, months) {
  const d = new Date(`${String(date || new Date().toISOString().slice(0, 10)).slice(0, 10)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + Number(months || 0));
  return d.toISOString().slice(0, 10);
}
function monthsBetweenIso(start, end) {
  const s = new Date(`${String(start || '').slice(0, 10)}T00:00:00Z`);
  const e = new Date(`${String(end || new Date().toISOString()).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0;
  return Math.max(0, (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth()) + (e.getUTCDate() >= s.getUTCDate() ? 0 : -1));
}

function readAdminState() {
  const defaults = {
    settings: { defaultRate: 0.75, rateMode: 'month', defaultLtv: 0.8, goldPrice: 700, autoApproveCustomers: true },
    staff: []
  };
  try {
    if (!fs.existsSync(ADMIN_STATE_PATH)) fs.writeFileSync(ADMIN_STATE_PATH, JSON.stringify(defaults, null, 2));
    return { ...defaults, ...JSON.parse(fs.readFileSync(ADMIN_STATE_PATH, 'utf8')) };
  } catch {
    return defaults;
  }
}
function writeAdminState(state) { fs.writeFileSync(ADMIN_STATE_PATH, JSON.stringify(state, null, 2)); }
function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyToken(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const good = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (payload.exp && Date.now() > payload.exp) return null;
  return payload;
}
function readAuthUsers() {
  try {
    if (!fs.existsSync(AUTH_USERS_PATH)) fs.writeFileSync(AUTH_USERS_PATH, JSON.stringify({ users: [] }, null, 2));
    return JSON.parse(fs.readFileSync(AUTH_USERS_PATH, 'utf8'));
  } catch { return { users: [] }; }
}
function writeAuthUsers(state) { fs.writeFileSync(AUTH_USERS_PATH, JSON.stringify(state, null, 2)); }
function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

const rowToTicketLite = (row) => ({
  id: row.id,
  ticketNo: row.ticket_no,
  customer: {
    id: row.customer?.id || row.customer_id,
    name: row.customer?.name || row.customer_name,
    ic: row.customer?.ic || row.ic || '',
    phone: row.customer?.phone || row.phone || ''
  },
  principal: Number(row.principal || 0),
  remainingPrincipal: Number(row.remaining_principal || 0),
  goldPrice: Number(row.gold_price || 0),
  rate: Number(row.rate || 0),
  rateMode: row.rate_mode,
  startDate: row.start_date,
  tenure: row.tenure,
  status: row.status,
  imageUrl: row.image_path ? `/uploads/${path.basename(row.image_path)}` : '',
  ocrRaw: row.ocr_raw || (row.ocr_raw_json ? JSON.parse(row.ocr_raw_json) : null),
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

async function getTicketSupabase(ticketId) {
  const { data: t, error } = await supabase
    .from('pawn_tickets')
    .select('*, customer:customers(id,name,ic,phone)')
    .eq('id', ticketId)
    .maybeSingle();
  if (error) throw error;
  if (!t) return null;

  const { data: items } = await supabase
    .from('ticket_items')
    .select('id,description,weight_gram,value,redeemed,redeemed_at,created_at')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true });

  const { data: txs } = await supabase
    .from('transactions')
    .select('id,type,amount,upah_amount,total_paid,item_ids,created_at,cash_out,meta')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: false });

  const ticket = rowToTicketLite(t);
  ticket.items = (items || []).map((x) => ({
    id: x.id,
    description: x.description,
    weight: Number(x.weight_gram || 0),
    value: Number(x.value || 0),
    redeemed: Boolean(x.redeemed),
    redeemedAt: x.redeemed_at,
    createdAt: x.created_at
  }));
  ticket.transactions = (txs || []).map((x) => ({
    id: x.id,
    type: x.type,
    amount: Number(x.amount || 0),
    upahAmount: Number(x.upah_amount || 0),
    totalPaid: Number(x.total_paid || 0),
    itemIds: x.item_ids || [],
    createdAt: x.created_at,
    cashOut: Number(x.cash_out || 0),
    meta: x.meta || null
  }));
  return ticket;
}

function getTicketSqlite(ticketId) {
  const row = db.prepare(`
    SELECT t.*, c.name customer_name, c.ic, c.phone
    FROM pawn_tickets t JOIN customers c ON c.id=t.customer_id
    WHERE t.id=?
  `).get(ticketId);
  if (!row) return null;
  const ticket = rowToTicketLite(row);
  ticket.items = db.prepare('SELECT id, description, weight_gram weight, value, redeemed, redeemed_at redeemedAt FROM ticket_items WHERE ticket_id=? ORDER BY created_at').all(ticketId)
    .map((x) => ({ ...x, redeemed: Boolean(x.redeemed) }));
  ticket.transactions = db.prepare('SELECT id, type, amount, upah_amount upahAmount, total_paid totalPaid, item_ids_json itemIdsJson, created_at createdAt FROM transactions WHERE ticket_id=? ORDER BY created_at DESC').all(ticketId)
    .map((x) => ({ ...x, itemIds: JSON.parse(x.itemIdsJson || '[]'), itemIdsJson: undefined }));
  return ticket;
}

app.post('/api/auth/register', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const phone = String(req.body?.phone || '').trim();
    const password = String(req.body?.password || '');
    if (!name || !email || password.length < 6) return res.status(400).json({ ok: false, error: 'Nama, email dan password min 6 aksara required' });

    const auth = readAuthUsers();
    const customerId = id();
    const username = String(req.body?.username || email.split('@')[0]).trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (!username || username.length < 3) return res.status(400).json({ ok: false, error: 'Username minimum 3 aksara' });
    if (auth.users.some((u) => String(u.email || '').toLowerCase() === email)) return res.status(409).json({ ok: false, error: 'Email sudah register' });
    if (auth.users.some((u) => String(u.username || '').toLowerCase() === username)) return res.status(409).json({ ok: false, error: 'Username sudah digunakan' });
    const user = { id: id(), customerId, role: 'customer', username, name, email, phone, passwordHash: passwordHash(password), created_at: new Date().toISOString() };
    auth.users.push(user);
    writeAuthUsers(auth);

    if (USE_SUPABASE) {
      const { error } = await supabase.from('customers').insert({ id: customerId, owner_id: null, name, phone, ic: null, address: null });
      if (error) console.warn('customer insert warning:', error.message);
    } else {
      db.prepare(`INSERT INTO customers (id,name,ic,phone,address,updated_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)`).run(customerId, name, '', phone, '');
    }

    const token = signToken({ role: 'customer', sub: user.id, customerId, username, email, name, iat: Date.now(), exp: Date.now() + 1000 * 60 * 60 * 24 * 7 });
    res.status(201).json({ ok: true, role: 'customer', token, redirect: '/index.html' });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  const role = String(req.body?.role || '').trim();
  if (!['admin', 'staff', 'customer'].includes(role)) return res.status(400).json({ ok: false, error: 'Role tidak sah' });

  if (role === 'customer') {
    const email = String(req.body?.email || req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const user = readAuthUsers().users.find((u) => (u.email === email || u.username === email) && u.role === 'customer');
    if (!user || !verifyPassword(password, user.passwordHash)) return res.status(401).json({ ok: false, error: 'Email/password salah' });
    const token = signToken({ role: 'customer', sub: user.id, customerId: user.customerId, username: user.username || user.email?.split('@')[0], email: user.email, name: user.name, iat: Date.now(), exp: Date.now() + 1000 * 60 * 60 * 24 * 7 });
    return res.json({ ok: true, role, token, redirect: '/index.html' });
  }

  const pin = String(req.body?.pin || '').trim();
  if (!ROLE_PINS[role]) return res.status(500).json({ ok: false, error: `PIN ${role} belum diset` });
  if (pin !== ROLE_PINS[role]) return res.status(401).json({ ok: false, error: 'PIN salah' });
  const token = signToken({ role, iat: Date.now(), exp: Date.now() + 1000 * 60 * 60 * 24 * 7 });
  res.json({ ok: true, role, token, redirect: role === 'admin' ? '/admin.html' : '/staff.html' });
});

app.get('/api/auth/me', (req, res) => {
  const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = verifyToken(auth);
  res.json({ ok: Boolean(user), user });
});

app.get('/api/auth/profile', (req, res) => {
  const user = authUser(req);
  if (!user?.sub || user.role !== 'customer') return res.status(401).json({ ok: false, error: 'Login customer required' });
  const record = readAuthUsers().users.find((u) => u.id === user.sub);
  if (!record) return res.status(404).json({ ok: false, error: 'Profile not found' });
  res.json({ ok: true, profile: { id: record.id, customerId: record.customerId, username: record.username || record.email?.split('@')[0], name: record.name, email: record.email, phone: record.phone, createdAt: record.created_at } });
});

app.patch('/api/auth/profile', async (req, res) => {
  const user = authUser(req);
  if (!user?.sub || user.role !== 'customer') return res.status(401).json({ ok: false, error: 'Login customer required' });
  const state = readAuthUsers();
  const idx = state.users.findIndex((u) => u.id === user.sub);
  if (idx < 0) return res.status(404).json({ ok: false, error: 'Profile not found' });
  const nextEmail = String(req.body?.email || state.users[idx].email || '').trim().toLowerCase();
  if (state.users.some((u, i) => i !== idx && String(u.email || '').toLowerCase() === nextEmail)) return res.status(409).json({ ok: false, error: 'Email sudah digunakan' });
  state.users[idx].name = String(req.body?.name || state.users[idx].name || '').trim();
  state.users[idx].phone = String(req.body?.phone || state.users[idx].phone || '').trim();
  state.users[idx].email = nextEmail;
  state.users[idx].updated_at = new Date().toISOString();
  writeAuthUsers(state);
  if (USE_SUPABASE) await supabase.from('customers').update({ name: state.users[idx].name, phone: state.users[idx].phone, updated_at: new Date().toISOString() }).eq('id', state.users[idx].customerId);
  else db.prepare('UPDATE customers SET name=?, phone=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(state.users[idx].name, state.users[idx].phone, state.users[idx].customerId);
  res.json({ ok: true, profile: { id: state.users[idx].id, customerId: state.users[idx].customerId, username: state.users[idx].username || state.users[idx].email?.split('@')[0], name: state.users[idx].name, email: state.users[idx].email, phone: state.users[idx].phone } });
});

function authUser(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return verifyToken(token);
}

app.get('/api/health', async (_req, res) => {
  if (USE_SUPABASE) {
    const { error } = await supabase.from('customers').select('id').limit(1);
    return res.json({ ok: !error, service: 'ar-rahnu-backend', db: 'supabase', supabaseUrl: SUPABASE_URL, error: error?.message || null });
  }
  return res.json({ ok: true, service: 'ar-rahnu-backend', db: DB_PATH });
});

function parseHrgmsArRahnu(text) {
  const wanted = [
    { id: 'bank-rakyat', match: /Ar-Rahnu X'Change/i, name: "Bank Rakyat — Ar-Rahnu X'Change" },
    { id: 'muamalat', match: /Ar-Rahnu Muamalat/i, name: 'Bank Muamalat' },
    { id: 'bank-islam', match: /Ar-Rahn Kelantan/i, name: 'Bank Islam / Ar-Rahn Kelantan' },
    { id: 'agrobank', match: /Agrobank|Ar-Rahnu Agro/i, name: 'Agrobank — Ar-Rahnu' }
  ];
  const banks = [];
  for (const bank of wanted) {
    const idx = text.search(bank.match);
    if (idx < 0) { banks.push({ id: bank.id, name: bank.name, note: 'Harga tidak dijumpai dalam sumber semasa', prices: { 999: null, 916: null, 835: null, 750: null } }); continue; }
    const end = text.indexOf('Kira Pinjaman', idx);
    const block = text.slice(idx, end > idx ? end : idx + 520);
    const unavailable = /Harga\s+tidak\s+tersedia/i.test(block);
    const prices = {};
    for (const purity of ['999', '916', '835', '750']) {
      const m = unavailable ? null : block.match(new RegExp(`${purity}:\\s*RM\\s*([0-9,.]+)`, 'i'));
      prices[purity] = m ? Number(m[1].replace(/,/g, '')) : null;
    }
    banks.push({ id: bank.id, name: bank.name, note: 'Live fallback: hargaemas.com.my/ar-rahnu', prices });
  }
  const dateMatch = text.match(/Dikemaskini:\s*([^\n]+)/i);
  return { updatedAt: dateMatch?.[1]?.trim() || new Date().toLocaleDateString('ms-MY', { timeZone: 'Asia/Kuala_Lumpur' }), source: 'hargaemas.com.my/ar-rahnu (fallback; official bank sources to be checked when available)', banks };
}

function parseMuamalatOfficial(text) {
  const prices = {};
  for (const purity of ['999', '950', '916', '875', '835', '750']) {
    const m = text.match(new RegExp(`\\b${purity}\\b\\s*\\n+\\s*([0-9]+(?:\\.[0-9]+)?)`, 'i'));
    if (m) prices[purity] = Number(m[1]);
  }
  const date = text.match(/Kemas kini berkuatkuasa:\s*([^\n]+)/i)?.[1]?.trim();
  return Object.keys(prices).length ? { prices, date } : null;
}

app.get('/api/gold-prices/refresh', async (_req, res) => {
  try {
    const response = await fetch('https://www.hargaemas.com.my/ar-rahnu');
    if (!response.ok) throw new Error(`Fetch failed ${response.status}`);
    const html = await response.text();
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#039;|&#8217;/g, "'");
    const data = parseHrgmsArRahnu(text);

    try {
      const muamalatRes = await fetch('https://www.muamalat.com.my/financing/personal/ar-rahnu/ar-rahnu-islamic-pawn-broking-tawarruq/?lang=ms');
      if (muamalatRes.ok) {
        const muHtml = await muamalatRes.text();
        const muText = muHtml.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
        const official = parseMuamalatOfficial(muText);
        if (official) {
          const mu = data.banks.find((b) => b.id === 'muamalat');
          if (mu) {
            mu.prices = { ...mu.prices, ...official.prices };
            mu.note = `Official Muamalat website • ${official.date || 'latest'}`;
            data.source = `${data.source}; Muamalat official website`;
            data.updatedAt = official.date || data.updatedAt;
          }
        }
      }
    } catch (e) {
      console.warn('Muamalat official fetch warning:', e.message);
    }

    res.json({ ok: true, data });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get('/api/tickets', async (req, res) => {
  try {
    const user = authUser(req);
    if (USE_SUPABASE) {
      let q = supabase
        .from('pawn_tickets')
        .select('*, customer:customers(id,name,ic,phone)')
        .order('created_at', { ascending: false });
      if (user?.role === 'customer') q = q.eq('customer_id', user.customerId || '00000000-0000-0000-0000-000000000000');
      else q = DEMO_OWNER_ID ? q.eq('owner_id', DEMO_OWNER_ID) : q.is('owner_id', null);
      const { data, error } = await q;
      if (error) throw error;
      const tickets = await Promise.all((data || []).map((row) => getTicketSupabase(row.id)));
      return res.json({ ok: true, tickets: tickets.filter(Boolean) });
    }

    const rows = db.prepare(`
      SELECT t.*, c.name customer_name, c.ic, c.phone
      FROM pawn_tickets t JOIN customers c ON c.id=t.customer_id
      ORDER BY t.created_at DESC
    `).all();
    return res.json({ ok: true, tickets: rows.map(rowToTicketLite) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get('/api/tickets/:id', async (req, res) => {
  try {
    const user = authUser(req);
    const ticket = USE_SUPABASE ? await getTicketSupabase(req.params.id) : getTicketSqlite(req.params.id);
    if (!ticket) return res.status(404).json({ ok: false, error: 'Ticket not found' });
    if (user?.role === 'customer' && ticket.customer?.id !== user.customerId) return res.status(403).json({ ok: false, error: 'Forbidden' });
    res.json({ ok: true, ticket });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get('/api/staff/summary', async (_req, res) => {
  try {
    const tickets = USE_SUPABASE
      ? (await Promise.all(((await supabase.from('pawn_tickets').select('id').order('created_at', { ascending: false })).data || []).map((row) => getTicketSupabase(row.id)))).filter(Boolean)
      : db.prepare('SELECT id FROM pawn_tickets ORDER BY created_at DESC').all().map((row) => getTicketSqlite(row.id)).filter(Boolean);

    const customers = USE_SUPABASE
      ? ((await supabase.from('customers').select('id,name,ic,phone,address,created_at,updated_at').order('created_at', { ascending: false })).data || [])
      : db.prepare('SELECT id,name,ic,phone,address,created_at,updated_at FROM customers ORDER BY created_at DESC').all();

    const activeTickets = tickets.filter((t) => t.status !== 'redeemed');
    const totalPrincipal = activeTickets.reduce((a, t) => a + Number(t.remainingPrincipal || t.principal || 0), 0);
    const totalMarhun = activeTickets.reduce((a, t) => a + (t.items || []).filter((i) => !i.redeemed).reduce((b, i) => b + Number(i.value || 0), 0), 0);
    const todayKey = new Date().toISOString().slice(0, 10);
    const registrationsToday = customers.filter((c) => String(c.created_at || c.createdAt || '').slice(0, 10) === todayKey).length;
    const ticketsToday = tickets.filter((t) => String(t.createdAt || '').slice(0, 10) === todayKey).length;

    res.json({
      ok: true,
      metrics: {
        customers: customers.length,
        registrationsToday,
        tickets: tickets.length,
        ticketsToday,
        activeTickets: activeTickets.length,
        redeemedTickets: tickets.filter((t) => t.status === 'redeemed').length,
        totalPrincipal,
        totalMarhun
      },
      customers,
      tickets
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get('/api/customers', async (_req, res) => {
  try {
    if (USE_SUPABASE) {
      const { data, error } = await supabase.from('customers').select('id,name,ic,phone,address,created_at,updated_at').order('created_at', { ascending: false });
      if (error) throw error;
      return res.json({ ok: true, customers: data || [] });
    }
    return res.json({ ok: true, customers: db.prepare('SELECT id,name,ic,phone,address,created_at,updated_at FROM customers ORDER BY created_at DESC').all() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.patch('/api/customers/:id', async (req, res) => {
  try {
    const patch = {
      name: String(req.body?.name || '').trim(),
      ic: String(req.body?.ic || '').trim(),
      phone: String(req.body?.phone || '').trim(),
      address: String(req.body?.address || '').trim(),
      updated_at: new Date().toISOString()
    };
    if (!patch.name) return res.status(400).json({ ok: false, error: 'Customer name required' });

    if (USE_SUPABASE) {
      const { data, error } = await supabase.from('customers').update(patch).eq('id', req.params.id).select('id,name,ic,phone,address,created_at,updated_at').maybeSingle();
      if (error) throw error;
      return res.json({ ok: true, customer: data });
    }
    db.prepare('UPDATE customers SET name=?, ic=?, phone=?, address=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(patch.name, patch.ic, patch.phone, patch.address, req.params.id);
    return res.json({ ok: true, customer: db.prepare('SELECT id,name,ic,phone,address,created_at,updated_at FROM customers WHERE id=?').get(req.params.id) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.delete('/api/customers/:id', async (req, res) => {
  try {
    if (USE_SUPABASE) {
      const { error } = await supabase.from('customers').delete().eq('id', req.params.id);
      if (error) throw error;
      return res.json({ ok: true });
    }
    db.prepare('DELETE FROM customers WHERE id=?').run(req.params.id);
    return res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.patch('/api/tickets/:id/status', async (req, res) => {
  try {
    const status = String(req.body?.status || '').trim();
    if (!['active', 'warning', 'overdue', 'redeemed'].includes(status)) return res.status(400).json({ ok: false, error: 'Invalid status' });
    if (USE_SUPABASE) {
      const { error } = await supabase.from('pawn_tickets').update({ status, updated_at: new Date().toISOString() }).eq('id', req.params.id);
      if (error) throw error;
      return res.json({ ok: true, ticket: await getTicketSupabase(req.params.id) });
    }
    db.prepare('UPDATE pawn_tickets SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, req.params.id);
    return res.json({ ok: true, ticket: getTicketSqlite(req.params.id) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get('/api/admin/summary', async (_req, res) => {
  try {
    const staffState = readAdminState();
    const staffSummary = USE_SUPABASE
      ? ((await supabase.from('profiles').select('id,email,full_name,role,created_at,updated_at').in('role', ['admin', 'staff'])).data || [])
      : [];
    const staff = staffSummary.length ? staffSummary : staffState.staff;

    const summaryRes = { locals: null };
    const tickets = USE_SUPABASE
      ? (await Promise.all(((await supabase.from('pawn_tickets').select('id').order('created_at', { ascending: false })).data || []).map((row) => getTicketSupabase(row.id)))).filter(Boolean)
      : db.prepare('SELECT id FROM pawn_tickets ORDER BY created_at DESC').all().map((row) => getTicketSqlite(row.id)).filter(Boolean);
    const customers = USE_SUPABASE
      ? ((await supabase.from('customers').select('id,name,ic,phone,address,created_at,updated_at').order('created_at', { ascending: false })).data || [])
      : db.prepare('SELECT id,name,ic,phone,address,created_at,updated_at FROM customers ORDER BY created_at DESC').all();

    const activeTickets = tickets.filter((t) => t.status !== 'redeemed');
    res.json({
      ok: true,
      metrics: {
        staff: staff.length,
        customers: customers.length,
        tickets: tickets.length,
        activeTickets: activeTickets.length,
        totalPrincipal: activeTickets.reduce((a, t) => a + Number(t.remainingPrincipal || t.principal || 0), 0),
        totalMarhun: activeTickets.reduce((a, t) => a + (t.items || []).filter((i) => !i.redeemed).reduce((b, i) => b + Number(i.value || 0), 0), 0)
      },
      settings: staffState.settings,
      staff,
      customers,
      tickets
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get('/api/admin/settings', (_req, res) => res.json({ ok: true, settings: readAdminState().settings }));

app.patch('/api/admin/settings', (req, res) => {
  const state = readAdminState();
  state.settings = {
    ...state.settings,
    defaultRate: Number(req.body?.defaultRate ?? state.settings.defaultRate),
    rateMode: ['month', 'year'].includes(req.body?.rateMode) ? req.body.rateMode : state.settings.rateMode,
    defaultLtv: Number(req.body?.defaultLtv ?? state.settings.defaultLtv),
    goldPrice: Number(req.body?.goldPrice ?? state.settings.goldPrice),
    autoApproveCustomers: Boolean(req.body?.autoApproveCustomers)
  };
  writeAdminState(state);
  res.json({ ok: true, settings: state.settings });
});

app.get('/api/admin/staff', async (_req, res) => {
  try {
    if (USE_SUPABASE) {
      const { data, error } = await supabase.from('profiles').select('id,email,full_name,role,created_at,updated_at').in('role', ['admin', 'staff']).order('created_at', { ascending: false });
      if (!error && data?.length) return res.json({ ok: true, staff: data });
    }
    return res.json({ ok: true, staff: readAdminState().staff });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/admin/staff', (req, res) => {
  const state = readAdminState();
  const staff = { id: id(), full_name: String(req.body?.full_name || '').trim(), email: String(req.body?.email || '').trim(), role: req.body?.role === 'admin' ? 'admin' : 'staff', status: 'active', created_at: new Date().toISOString() };
  if (!staff.full_name && !staff.email) return res.status(400).json({ ok: false, error: 'Nama atau email staff required' });
  state.staff.unshift(staff);
  writeAdminState(state);
  res.status(201).json({ ok: true, staff });
});

app.patch('/api/admin/staff/:id', (req, res) => {
  const state = readAdminState();
  const idx = state.staff.findIndex((s) => s.id === req.params.id);
  if (idx < 0) return res.status(404).json({ ok: false, error: 'Staff not found in MVP state' });
  state.staff[idx] = { ...state.staff[idx], full_name: String(req.body?.full_name || state.staff[idx].full_name || '').trim(), email: String(req.body?.email || state.staff[idx].email || '').trim(), role: req.body?.role === 'admin' ? 'admin' : 'staff', status: req.body?.status || state.staff[idx].status || 'active', updated_at: new Date().toISOString() };
  writeAdminState(state);
  res.json({ ok: true, staff: state.staff[idx] });
});

app.delete('/api/admin/staff/:id', (req, res) => {
  const state = readAdminState();
  const before = state.staff.length;
  state.staff = state.staff.filter((s) => s.id !== req.params.id);
  writeAdminState(state);
  res.json({ ok: true, deleted: before !== state.staff.length });
});

app.post('/api/tickets', async (req, res) => {
  const body = req.body || {};
  if (!body.ticketNo || !body.customer?.name) return res.status(400).json({ ok: false, error: 'ticketNo and customer.name required' });

  const user = authUser(req);
  const customerId = user?.role === 'customer' && user.customerId ? user.customerId : cleanUuid(body.customer.id);
  const ticketId = cleanUuid(body.id);
  const principal = Number(body.principal || 0);
  const items = Array.isArray(body.items) ? body.items : [];

  try {
    if (USE_SUPABASE) {
      const owner_id = body.ownerId || DEMO_OWNER_ID || null;

      const customerPayload = {
        id: customerId,
        owner_id,
        name: body.customer.name,
        ic: body.customer.ic || null,
        phone: body.customer.phone || null,
        address: body.customer.address || null
      };
      const { error: e1 } = user?.role === 'customer'
        ? await supabase.from('customers').update(customerPayload).eq('id', customerId)
        : await supabase.from('customers').upsert(customerPayload);
      if (e1) throw e1;

      const { error: e2 } = await supabase.from('pawn_tickets').insert({
        id: ticketId,
        owner_id,
        ticket_no: body.ticketNo,
        customer_id: customerId,
        principal,
        remaining_principal: Number(body.remainingPrincipal ?? principal),
        gold_price: Number(body.goldPrice || 0),
        rate: Number(body.rate || 0),
        rate_mode: body.rateMode || 'month',
        start_date: body.startDate || new Date().toISOString().slice(0, 10),
        tenure: Number(body.tenure || 6),
        status: body.status || 'active',
        image_path: body.imagePath || null,
        ocr_raw: body.ocrRaw || null
      });
      if (e2) throw e2;

      const itemRows = (items.length ? items : [{ description: 'Item emas', value: principal, weight: 0 }]).map((item) => ({
        id: cleanUuid(item.id),
        ticket_id: ticketId,
        description: item.description || 'Item emas',
        weight_gram: Number(item.weight || 0),
        value: Number(item.value || 0),
        redeemed: false
      }));
      const { error: e3 } = await supabase.from('ticket_items').insert(itemRows);
      if (e3) throw e3;

      const { error: e4 } = await supabase.from('transactions').insert({
        id: id(),
        ticket_id: ticketId,
        type: 'Surat dibuka',
        amount: principal,
        total_paid: 0,
        item_ids: []
      });
      if (e4) throw e4;

      return res.status(201).json({ ok: true, ticket: await getTicketSupabase(ticketId) });
    }

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
          id: cleanUuid(item.id), ticketId, description: item.description || 'Item emas', weight: Number(item.weight || 0), value: Number(item.value || 0)
        });
      }

      db.prepare(`INSERT INTO transactions (id,ticket_id,type,amount,total_paid,item_ids_json)
        VALUES (?,?,?,?,?,?)`).run(id(), ticketId, 'Surat dibuka', principal, 0, '[]');
    });

    tx();
    res.status(201).json({ ok: true, ticket: getTicketSqlite(ticketId) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.delete('/api/tickets/:id', async (req, res) => {
  const ticketId = req.params.id;
  try {
    if (USE_SUPABASE) {
      const { error } = await supabase.from('pawn_tickets').delete().eq('id', ticketId);
      if (error) throw error;
      return res.json({ ok: true });
    }
    db.prepare('DELETE FROM pawn_tickets WHERE id=?').run(ticketId);
    return res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/tickets/:id/partial', async (req, res) => {
  const ticketId = req.params.id;
  const body = req.body || {};
  const itemIds = Array.isArray(body.itemIds) ? body.itemIds : [];
  const manualRedeemGram = Number(body.manualRedeemGram || 0);
  if (!itemIds.length && manualRedeemGram <= 0) return res.status(400).json({ ok: false, error: 'itemIds or manualRedeemGram required' });

  const now = new Date().toISOString();
  const renewalDate = now.slice(0, 10);
  const txId = id();
  const status = Number(body.remainingWeight || 0) <= 0 ? 'redeemed' : 'active';

  try {
    if (USE_SUPABASE) {
      const changedItemIds = [...itemIds];
      if (manualRedeemGram > 0) {
        let gramsLeft = manualRedeemGram;
        const { data: activeRows, error: readItemsError } = await supabase
          .from('ticket_items')
          .select('id,weight_gram,value')
          .eq('ticket_id', ticketId)
          .eq('redeemed', false)
          .order('weight_gram', { ascending: true });
        if (readItemsError) throw readItemsError;

        for (const item of activeRows || []) {
          if (gramsLeft <= 0) break;
          const weight = Number(item.weight_gram || 0);
          const value = Number(item.value || 0);
          if (weight <= 0) continue;
          changedItemIds.push(item.id);

          if (gramsLeft >= weight) {
            const { error } = await supabase
              .from('ticket_items')
              .update({ redeemed: true, redeemed_at: now, weight_gram: 0, value: 0 })
              .eq('id', item.id)
              .eq('ticket_id', ticketId);
            if (error) throw error;
            gramsLeft -= weight;
          } else {
            const ratioLeft = (weight - gramsLeft) / weight;
            const { error } = await supabase
              .from('ticket_items')
              .update({ weight_gram: Number((weight - gramsLeft).toFixed(3)), value: Number((value * ratioLeft).toFixed(2)) })
              .eq('id', item.id)
              .eq('ticket_id', ticketId);
            if (error) throw error;
            gramsLeft = 0;
          }
        }
      } else if (itemIds.length) {
        const { error: e1 } = await supabase
          .from('ticket_items')
          .update({ redeemed: true, redeemed_at: now })
          .in('id', itemIds)
          .eq('ticket_id', ticketId);
        if (e1) throw e1;
      }

      const { error: e2 } = await supabase
        .from('pawn_tickets')
        .update({
          remaining_principal: Number(body.newLoan || 0),
          gold_price: Number(body.goldPrice || 0),
          start_date: renewalDate,
          status,
          updated_at: now
        })
        .eq('id', ticketId);
      if (e2) throw e2;

      const { error: e3 } = await supabase.from('transactions').insert({
        id: txId,
        ticket_id: ticketId,
        type: 'Tebus Keluar',
        amount: Number(body.oldLoan || 0),
        upah_amount: Number(body.upah || 0),
        total_paid: Number(body.result || 0) < 0 ? Math.abs(Number(body.result || 0)) : 0,
        cash_out: Number(body.result || 0) > 0 ? Number(body.result || 0) : 0,
        item_ids: changedItemIds,
        meta: {
          formula: 'newLoan-oldLoan-upah',
          newLoan: Number(body.newLoan || 0),
          oldLoan: Number(body.oldLoan || 0),
          upah: Number(body.upah || 0),
          result: Number(body.result || 0),
          goldPrice: Number(body.goldPrice || 0),
          ltvRatio: Number(body.ltvRatio || 0),
          redeemWeight: Number(body.redeemWeight || 0),
          manualRedeemGram,
          remainingWeight: Number(body.remainingWeight || 0),
          marhunValue: Number(body.marhunValue || 0),
          renewalDate,
          note: 'Tarikh pembiayaan reset selepas tebus keluar; upah baru kira dari tarikh ini.'
        },
        created_at: now
      });
      if (e3) throw e3;

      return res.json({ ok: true, ticket: await getTicketSupabase(ticketId) });
    }

    const tx = db.transaction(() => {
      for (const itemId of itemIds) {
        db.prepare('UPDATE ticket_items SET redeemed=1, redeemed_at=? WHERE id=? AND ticket_id=?').run(now, itemId, ticketId);
      }
      db.prepare('UPDATE pawn_tickets SET remaining_principal=?, gold_price=?, start_date=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(Number(body.newLoan || 0), Number(body.goldPrice || 0), renewalDate, status, ticketId);
      db.prepare(`INSERT INTO transactions (id,ticket_id,type,amount,upah_amount,total_paid,item_ids_json,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(
        txId,
        ticketId,
        'Tebus Keluar',
        Number(body.oldLoan || 0),
        Number(body.upah || 0),
        Number(body.result || 0) < 0 ? Math.abs(Number(body.result || 0)) : 0,
        JSON.stringify(itemIds),
        now
      );
    });
    tx();
    return res.json({ ok: true, ticket: getTicketSqlite(ticketId) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/tickets/:id/pay-upah', async (req, res) => {
  const ticketId = req.params.id;
  const body = req.body || {};
  const now = new Date().toISOString();
  const txId = id();

  try {
    const ticket = USE_SUPABASE ? await getTicketSupabase(ticketId) : getTicketSqlite(ticketId);
    if (!ticket) return res.status(404).json({ ok: false, error: 'Ticket not found' });

    const latestPaidUntil = (ticket.transactions || [])
      .filter((tx) => tx.type === 'Bayar Upah' && tx.meta?.paidUntil && (tx.meta?.status === 'completed' || tx.meta?.status === undefined))
      .sort((a, b) => new Date(b.meta.paidUntil) - new Date(a.meta.paidUntil))[0]?.meta?.paidUntil;
    const periodStart = latestPaidUntil || ticket.startDate;
    const periodEnd = addMonthsIso(periodStart, 6);
    const blockNo = Math.floor(monthsBetweenIso(ticket.startDate, periodStart) / 6) + 1;
    const principal = Number(ticket.remainingPrincipal || ticket.principal || 0);
    const latestRenew = (ticket.transactions || [])
      .filter((tx) => tx.type === 'Tebus Keluar' && tx.meta?.newLoan)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    const upahBasePrincipal = Number(latestRenew?.meta?.newLoan || ticket.principal || principal || 0);
    const rate = Number(ticket.rate || 0) / 100;
    const monthlyAmount = upahBasePrincipal * (ticket.rateMode === 'year' ? rate / 12 : rate);
    const blockAmount = Number((monthlyAmount * 6).toFixed(2));
    const paidBefore = (ticket.transactions || [])
      .filter((tx) => tx.type === 'Bayar Upah' && tx.meta?.periodStart === periodStart)
      .reduce((a, tx) => a + Number(tx.upahAmount || tx.meta?.upahPaid || tx.totalPaid || 0), 0);
    const outstandingBefore = Math.max(0, Number((blockAmount - paidBefore).toFixed(2)));
    const elapsedDays = Math.max(0, Math.ceil((Date.now() - new Date(periodStart).getTime()) / (1000 * 60 * 60 * 24)));
    const accruedCurrent = Number(Math.min(blockAmount, (monthlyAmount / 30) * elapsedDays).toFixed(2));
    const currentDueBefore = Math.max(0, Number((accruedCurrent - paidBefore).toFixed(2)));
    const requestedAmount = Number(body.amount || 0);
    const amount = Number(Math.max(0, requestedAmount).toFixed(2));
    if (amount <= 0) return res.status(400).json({ ok: false, error: 'Jumlah bayaran upah tidak sah' });
    // Payment allocation rule:
    // 1) Bayar upah semasa dahulu.
    // 2) Jika bayar lebih daripada upah semasa, lebihan terus tolak principal.
    // 3) Lebihan TIDAK auto-bayar future/upah 6 bulan.
    const upahPaid = Number(Math.min(amount, currentDueBefore).toFixed(2));
    const principalReduction = Number(Math.max(0, amount - currentDueBefore).toFixed(2));
    const paidAfter = Number((paidBefore + upahPaid).toFixed(2));
    const currentDueAfter = Math.max(0, Number((currentDueBefore - upahPaid).toFixed(2)));
    const blockOutstandingAfter = Number(Math.max(0, blockAmount - paidAfter).toFixed(2));
    const status = paidAfter + 0.009 >= blockAmount ? 'completed' : 'partial';
    const paidUntil = status === 'completed' ? periodEnd : null;

    if (USE_SUPABASE) {
      const { error } = await supabase.from('transactions').insert({
        id: txId,
        ticket_id: ticketId,
        type: 'Bayar Upah',
        amount: principal,
        upah_amount: upahPaid,
        total_paid: amount,
        cash_out: 0,
        item_ids: [],
        meta: {
          formula: 'payment clears current upah first; excess reduces principal; 6-month balance shown separately',
          blockNo,
          periodStart,
          periodEnd,
          paidUntil,
          status,
          principal,
          upahBasePrincipal,
          upahPaid,
          principalReduction,
          monthlyAmount: Number(monthlyAmount.toFixed(2)),
          blockAmount,
          paidBefore: Number(paidBefore.toFixed(2)),
          paidAfter,
          currentDueBefore,
          currentDueAfter,
          outstandingAfter: currentDueAfter,
          blockOutstandingAfter,
          note: status === 'completed' ? 'Blok upah 6 bulan selesai. Surat update ke blok seterusnya.' : 'Bayaran upah semasa/ansuran. Baki upah semasa dikira selepas tolak bayaran.'
        },
        created_at: now
      });
      if (error) throw error;
      const ticketPatch = { updated_at: now };
      if (principalReduction > 0) ticketPatch.remaining_principal = Number(Math.max(0, principal - principalReduction).toFixed(2));
      await supabase.from('pawn_tickets').update(ticketPatch).eq('id', ticketId);
      return res.json({ ok: true, ticket: await getTicketSupabase(ticketId) });
    }

    db.prepare(`INSERT INTO transactions (id,ticket_id,type,amount,upah_amount,total_paid,item_ids_json,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(txId, ticketId, 'Bayar Upah', principal, upahPaid, amount, JSON.stringify([]), now);
    if (principalReduction > 0) db.prepare('UPDATE pawn_tickets SET remaining_principal=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(Number(Math.max(0, principal - principalReduction).toFixed(2)), ticketId);
    return res.json({ ok: true, ticket: getTicketSqlite(ticketId) });
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

function normalizeOcrDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let y, m, d;
  let match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (match) { y = Number(match[1]); m = Number(match[2]); d = Number(match[3]); }
  else {
    match = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (match) { d = Number(match[1]); m = Number(match[2]); y = Number(match[3]); }
  }
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return '';
  const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(dt.getTime()) || dt.getUTCFullYear() !== y || dt.getUTCMonth() + 1 !== m || dt.getUTCDate() !== d) return '';
  const tomorrow = new Date(); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1); tomorrow.setUTCHours(23, 59, 59, 999);
  if (dt > tomorrow) return '';
  return iso;
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

app.post('/api/ocr/pawn-ticket', upload.fields([{ name: 'images', maxCount: 2 }, { name: 'image', maxCount: 1 }]), async (req, res) => {
  const files = [...(req.files?.images || []), ...(req.files?.image || [])].slice(0, 2);
  if (!files.length) return res.status(400).json({ ok: false, error: 'image required' });

  const prompt = `Extract fields from the Ar-Rahnu document images. JSON shape: {"ticketNo":"","customer":{"name":"","ic":"","phone":""},"principal":0,"marhunTotal":0,"goldPrice":0,"rate":0,"rateMode":"month|year","startDate":"YYYY-MM-DD","tenure":6,"items":[{"description":"","karat":"","weight":0,"value":0}],"notes":""}. The first photo is usually the front page with financing/customer details. The second photo is usually the back page with marhun item table. IMPORTANT: principal means Jumlah Pembiayaan / Amaun Pembiayaan only, not nilai marhun. marhunTotal means total Nilai Marhun, usually sum of item values. DATE RULE: Tarikh Pembiayaan / Tarikh Mula must be read very carefully. Malaysian documents usually show DD/MM/YYYY, so 06/10/2022 means 6 October 2022 and must output as 2022-10-06. Do not confuse it with MM/DD/YYYY. If the date is unclear, output an empty startDate and explain in notes. For Bank Muamalat, map No Akaun Pembiayaan or Serial No as ticketNo, Nama Pemohon as customer.name, No KP as ic, No Tel as phone, Tarikh Pembiayaan as startDate, Amaun Pembiayaan as principal. Kadar Keuntungan means Kadar Upah: use it as rate, and if it says 18 bulan / annual, convert/store rateMode correctly as year or month. From Keterangan Marhun table, extract each row as item with description, karat, weight and nilai marhun. Return ONLY valid JSON. No markdown.`;

  if (!process.env.OPENAI_API_KEY && !process.env.GOOGLE_API_KEY) {
    return res.json({ ok: true, mode: 'fallback-no-api-key', imageUrl: `/uploads/${files[0].filename}`, data: fallbackOcr() });
  }

  try {
    let text = '{}';
    let mode = 'openai-vision';
    let model = OPENAI_MODEL;

    if (process.env.OPENAI_API_KEY) {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const imageParts = files.map((file) => {
        const imageBuffer = fs.readFileSync(file.path);
        const imageBase64 = imageBuffer.toString('base64');
        return { type: 'image_url', image_url: { url: `data:${file.mimetype};base64,${imageBase64}` } };
      });
      const response = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        temperature: 0,
        messages: [
          { role: 'system', content: 'Extract Malaysian Ar-Rahnu pawn ticket data from one or two photos. Return ONLY valid JSON. No markdown.' },
          { role: 'user', content: [{ type: 'text', text: prompt }, ...imageParts] }
        ]
      });
      text = response.choices?.[0]?.message?.content || '{}';
    } else {
      mode = 'gemini-vision';
      model = GOOGLE_MODEL;
      const parts = [{ text: prompt }, ...files.map((file) => ({
        inlineData: {
          mimeType: file.mimetype,
          data: fs.readFileSync(file.path).toString('base64')
        }
      }))];
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GOOGLE_MODEL}:generateContent?key=${process.env.GOOGLE_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json' }
        })
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || `Gemini API error ${response.status}`);
      text = json.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n') || '{}';
    }

    const data = safeJsonFromText(text);
    const originalStartDate = data.startDate;
    data.startDate = normalizeOcrDate(data.startDate);
    if (originalStartDate && !data.startDate) data.notes = `${data.notes || ''} Tarikh mula tidak jelas/format tidak sah: ${originalStartDate}`.trim();
    res.json({ ok: true, mode, model, imageUrl: `/uploads/${files[0].filename}`, imageUrls: files.map((file) => `/uploads/${file.filename}`), data, raw: text });
  } catch (err) {
    res.status(502).json({ ok: false, error: 'OCR Vision failed', details: err.message, imageUrl: `/uploads/${files[0].filename}`, imageUrls: files.map((file) => `/uploads/${file.filename}`) });
  }
});

app.use((err, _req, res, _next) => res.status(400).json({ ok: false, error: err.message }));
app.listen(PORT, () => console.log(`Ar-Rahnu backend running at http://127.0.0.1:${PORT} (${USE_SUPABASE ? 'supabase' : 'sqlite'})`));
