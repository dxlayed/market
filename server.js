const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Listings are read-only until LISTINGS_OPEN=true is set in Railway Variables.
const LISTINGS_OPEN = process.env.LISTINGS_OPEN === 'true';
app.use('/api/listings', (req, res, next) => (req.method === 'GET' || LISTINGS_OPEN ? next() : res.status(503).json({ error: 'Listings are coming soon.' })));

const url = process.env.DATABASE_URL;
const pool = new Pool({
  connectionString: url,
  ssl: url && !url.includes('railway.internal') && !url.includes('localhost') ? { rejectUnauthorized: false } : false,
});
const SECRET = process.env.JWT_SECRET || 'change-me-in-railway-variables';

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS listings (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('sell','buy')),
      item TEXT NOT NULL,
      category TEXT NOT NULL,
      price TEXT NOT NULL,
      discord TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'open',
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS roblox_id BIGINT UNIQUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
    ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN DEFAULT false;
    CREATE TABLE IF NOT EXISTS tickets (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      subject TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS ticket_messages (
      id SERIAL PRIMARY KEY,
      ticket_id INT REFERENCES tickets(id) ON DELETE CASCADE,
      user_id INT REFERENCES users(id) ON DELETE SET NULL,
      body TEXT NOT NULL,
      staff BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
}

const clean = (v, max) => String(v || '').trim().slice(0, max);

// Owners are Roblox-verified accounts with these usernames. Change with the OWNERS variable in Railway.
const OWNERS = (process.env.OWNERS || 'yukogives,Kriminalitys').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const isOwner = (u) => !!u && u.roblox_id != null && OWNERS.includes(String(u.username).toLowerCase());
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function currentUser(req) {
  let t;
  try { t = jwt.verify(req.cookies.token, SECRET); } catch { return null; }
  return (await pool.query('SELECT id, username, avatar_url, roblox_id, banned FROM users WHERE id=$1', [t.id])).rows[0] || null;
}

const auth = wrap(async (req, res, next) => {
  const u = await currentUser(req);
  if (!u) return res.status(401).json({ error: 'Please log in first.' });
  if (u.banned) return res.status(403).json({ error: 'Your account is banned. Open a support ticket if you think this is a mistake.' });
  req.user = u;
  next();
});

// Like auth, but lets banned users through so they can still reach support.
const authAny = wrap(async (req, res, next) => {
  const u = await currentUser(req);
  if (!u) return res.status(401).json({ error: 'Please log in first.' });
  req.user = u;
  next();
});

const owner = wrap(async (req, res, next) => {
  const u = await currentUser(req);
  if (!isOwner(u)) return res.status(404).json({ error: 'Not found.' });
  req.user = u;
  next();
});

function setToken(res, user) {
  const token = jwt.sign({ id: user.id, username: user.username, avatar: user.avatar || null }, SECRET, { expiresIn: '14d' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 14 * 864e5 });
}

const prod = process.env.NODE_ENV === 'production';
const hits = new Map();
setInterval(() => hits.clear(), 36e5);
function limit(key, ms) { const now = Date.now(); if (now - (hits.get(key) || 0) < ms) return false; hits.set(key, now); return true; }

const WORDS = 'amber apple arrow beach berry breeze cactus candle canyon cedar cherry cloud clover coral cotton crystal daisy dawn dune eagle ember falcon fern field forest frost garden glacier harbor hazel honey island ivory jade jungle koala lake lantern lemon lilac lotus maple meadow mint moon mossy ocean olive orchid otter panda peach pebble pine planet plum pond puffin quartz rabbit river robin sage sand silver sky sparrow spruce star sunrise tiger tulip velvet violet walnut willow winter zebra'.split(' ');
const makeCode = () => Array.from({ length: 8 }, () => WORDS[crypto.randomInt(WORDS.length)]).join(' ');

async function rbx(url, body) {
  const r = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error('roblox ' + r.status);
  return r.json();
}

app.post('/api/auth/start', async (req, res) => {
  if (!limit('s' + req.ip, 2000)) return res.status(429).json({ error: 'Slow down a little.' });
  const name = clean(req.body.username, 20);
  if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) return res.status(400).json({ error: 'Enter your Roblox username.' });
  try {
    const found = await rbx('https://users.roblox.com/v1/usernames/users', { usernames: [name], excludeBannedUsers: true });
    const u = found.data && found.data[0];
    if (!u) return res.status(404).json({ error: 'No Roblox user with that name.' });
    const code = makeCode();
    const token = jwt.sign({ rid: u.id, name: u.name, code }, SECRET, { expiresIn: '10m' });
    res.cookie('challenge', token, { httpOnly: true, sameSite: 'lax', secure: prod, maxAge: 600000 });
    res.json({ code, name: u.name });
  } catch {
    res.status(502).json({ error: "Couldn't reach Roblox. Try again in a moment." });
  }
});

app.post('/api/auth/verify', async (req, res) => {
  if (!limit('v' + req.ip, 3000)) return res.status(429).json({ error: 'Slow down a little.' });
  let ch;
  try { ch = jwt.verify(req.cookies.challenge, SECRET); } catch { return res.status(400).json({ error: 'Your code expired. Go back and get a new one.' }); }
  try {
    const prof = await rbx('https://users.roblox.com/v1/users/' + ch.rid);
    const bio = String(prof.description || '').toLowerCase().replace(/\s+/g, ' ');
    if (!bio.includes(ch.code)) return res.status(401).json({ error: "We can't see the code in your bio yet. Save it on Roblox, then try again." });
    let avatar = null;
    try {
      const t = await rbx('https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=' + ch.rid + '&size=150x150&format=Png&isCircular=false');
      const url = (t.data && t.data[0] && t.data[0].imageUrl) || '';
      if (/^https:\/\/[\w.-]+\.rbxcdn\.com\//.test(url)) avatar = url;
    } catch {}
    const name = prof.name || ch.name;
    let user = (await pool.query('SELECT id, username, banned FROM users WHERE roblox_id=$1', [ch.rid])).rows[0];
    if (user && user.banned) return res.status(403).json({ error: 'This account is banned from SplitzMarket.' });
    if (user) {
      await pool.query('UPDATE users SET avatar_url=$1 WHERE id=$2', [avatar, user.id]);
      if (name !== user.username) { try { await pool.query('UPDATE users SET username=$1 WHERE id=$2', [name, user.id]); user.username = name; } catch {} }
    } else {
      const claim = await pool.query('UPDATE users SET roblox_id=$1, avatar_url=$2 WHERE lower(username)=lower($3) AND roblox_id IS NULL RETURNING id, username', [ch.rid, avatar, name]);
      user = claim.rows[0] || (await pool.query('INSERT INTO users (username, roblox_id, avatar_url) VALUES ($1,$2,$3) RETURNING id, username', [name, ch.rid, avatar])).rows[0];
    }
    const out = { id: user.id, username: user.username, avatar };
    setToken(res, out);
    res.clearCookie('challenge');
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: "Couldn't check your Roblox profile. Try again in a moment." });
  }
});

app.post('/api/logout', (req, res) => { res.clearCookie('token'); res.json({ ok: true }); });

app.get('/api/me', wrap(async (req, res) => {
  const u = await currentUser(req);
  if (!u) return res.json(null);
  res.json({ id: u.id, username: u.username, avatar: u.avatar_url || null, owner: isOwner(u), banned: !!u.banned });
}));

app.get('/api/listings', wrap(async (req, res) => {
  const where = ["l.status='open'"];
  const args = [];
  if (req.query.q) { args.push('%' + clean(req.query.q, 50) + '%'); where.push(`l.item ILIKE $${args.length}`); }
  if (['sell', 'buy'].includes(req.query.kind)) { args.push(req.query.kind); where.push(`l.kind=$${args.length}`); }
  if (req.query.category) { args.push(clean(req.query.category, 30)); where.push(`l.category=$${args.length}`); }
  const { rows } = await pool.query(
    `SELECT l.*, u.username FROM listings l JOIN users u ON u.id=l.user_id WHERE ${where.join(' AND ')} ORDER BY l.created_at DESC LIMIT 100`, args);
  res.json(rows);
}));

app.post('/api/listings', auth, async (req, res) => {
  const b = req.body;
  const kind = b.kind === 'buy' ? 'buy' : 'sell';
  const item = clean(b.item, 60), category = clean(b.category, 30), price = clean(b.price, 40);
  const discord = clean(b.discord, 40), description = clean(b.description, 300);
  if (!item || !category || !price || !discord) return res.status(400).json({ error: 'Fill in item, category, price and Discord.' });
  const { rows } = await pool.query(
    'INSERT INTO listings (user_id,kind,item,category,price,discord,description) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    [req.user.id, kind, item, category, price, discord, description]);
  res.json(rows[0]);
});

app.patch('/api/listings/:id/done', auth, async (req, res) => {
  await pool.query("UPDATE listings SET status='done' WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id]);
  res.json({ ok: true });
});

app.delete('/api/listings/:id', auth, async (req, res) => {
  await pool.query('DELETE FROM listings WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

app.get('/api/profile', auth, wrap(async (req, res) => {
  const id = req.user.id;
  const u = (await pool.query('SELECT username, created_at FROM users WHERE id=$1', [id])).rows[0];
  const c = (await pool.query("SELECT status, count(*)::int AS n FROM listings WHERE user_id=$1 GROUP BY status", [id])).rows;
  const n = (s) => (c.find((r) => r.status === s) || { n: 0 }).n;
  const msgs = (await pool.query('SELECT count(*)::int AS n FROM messages WHERE user_id=$1', [id])).rows[0].n;
  const mine = (await pool.query("SELECT id, kind, item, category, price, status FROM listings WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50", [id])).rows;
  const done = n('done');
  const rank = done >= 15 ? 'Broker' : done >= 5 ? 'Dealer' : done >= 1 ? 'Trader' : 'Newcomer';
  res.json({ username: u.username, joined: u.created_at, open: n('open'), done, messages: msgs, rank, listings: mine });
}));

const lastMsg = new Map();

app.get('/api/chat', wrap(async (req, res) => {
  const after = parseInt(req.query.after, 10);
  const q = after
    ? ['SELECT m.id, m.body, m.created_at, m.user_id, u.username FROM messages m JOIN users u ON u.id=m.user_id WHERE m.id>$1 ORDER BY m.id ASC LIMIT 100', [after]]
    : ['SELECT * FROM (SELECT m.id, m.body, m.created_at, m.user_id, u.username FROM messages m JOIN users u ON u.id=m.user_id ORDER BY m.id DESC LIMIT 50) t ORDER BY id ASC', []];
  const { rows } = await pool.query(q[0], q[1]);
  res.json(rows);
}));

app.post('/api/chat', auth, wrap(async (req, res) => {
  const body = clean(req.body.body, 200);
  if (!body) return res.status(400).json({ error: 'Type a message first.' });
  const now = Date.now();
  if (now - (lastMsg.get(req.user.id) || 0) < 1500) return res.status(429).json({ error: 'Slow down a little.' });
  lastMsg.set(req.user.id, now);
  await pool.query('INSERT INTO messages (user_id, body) VALUES ($1,$2)', [req.user.id, body]);
  res.json({ ok: true });
}));

// ---------- Support tickets ----------
app.get('/api/tickets', authAny, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT t.id, t.subject, t.status, t.created_at, t.updated_at,
       (SELECT staff FROM ticket_messages m WHERE m.ticket_id=t.id ORDER BY m.id DESC LIMIT 1) AS last_staff
     FROM tickets t WHERE t.user_id=$1 ORDER BY t.updated_at DESC LIMIT 50`, [req.user.id]);
  res.json(rows);
}));

app.post('/api/tickets', authAny, wrap(async (req, res) => {
  const subject = clean(req.body.subject, 80), body = clean(req.body.body, 1000);
  if (!subject || !body) return res.status(400).json({ error: 'Add a subject and a message.' });
  if (!limit('t' + req.user.id, 30000)) return res.status(429).json({ error: 'Wait a few seconds before opening another ticket.' });
  const open = (await pool.query("SELECT count(*)::int AS n FROM tickets WHERE user_id=$1 AND status='open'", [req.user.id])).rows[0].n;
  if (open >= 3) return res.status(400).json({ error: 'You already have 3 open tickets. Reply in one of those instead.' });
  const t = (await pool.query('INSERT INTO tickets (user_id, subject) VALUES ($1,$2) RETURNING id', [req.user.id, subject])).rows[0];
  await pool.query('INSERT INTO ticket_messages (ticket_id, user_id, body, staff) VALUES ($1,$2,$3,false)', [t.id, req.user.id, body]);
  res.json(t);
}));

async function ticketFor(req, res) {
  const id = parseInt(req.params.id, 10);
  const t = (await pool.query('SELECT t.*, u.username FROM tickets t JOIN users u ON u.id=t.user_id WHERE t.id=$1', [id])).rows[0];
  const u = await currentUser(req);
  if (!t || !u || (t.user_id !== u.id && !isOwner(u))) { res.status(404).json({ error: 'Ticket not found.' }); return null; }
  return { t, u };
}

app.get('/api/tickets/:id', wrap(async (req, res) => {
  const r = await ticketFor(req, res); if (!r) return;
  const msgs = (await pool.query(
    `SELECT m.id, m.body, m.staff, m.created_at, u.username FROM ticket_messages m LEFT JOIN users u ON u.id=m.user_id
     WHERE m.ticket_id=$1 ORDER BY m.id ASC`, [r.t.id])).rows;
  res.json({ ticket: { id: r.t.id, subject: r.t.subject, status: r.t.status, username: r.t.username, created_at: r.t.created_at }, messages: msgs, staff: isOwner(r.u) });
}));

app.post('/api/tickets/:id/messages', wrap(async (req, res) => {
  const r = await ticketFor(req, res); if (!r) return;
  const body = clean(req.body.body, 1000);
  if (!body) return res.status(400).json({ error: 'Type a message first.' });
  if (!limit('tm' + r.u.id, 1500)) return res.status(429).json({ error: 'Slow down a little.' });
  const staff = isOwner(r.u);
  if (r.t.status === 'closed' && !staff) await pool.query("UPDATE tickets SET status='open' WHERE id=$1", [r.t.id]);
  await pool.query('INSERT INTO ticket_messages (ticket_id, user_id, body, staff) VALUES ($1,$2,$3,$4)', [r.t.id, r.u.id, body, staff]);
  await pool.query('UPDATE tickets SET updated_at=now() WHERE id=$1', [r.t.id]);
  res.json({ ok: true });
}));

// ---------- Owner panel ----------
app.get('/api/admin/stats', owner, wrap(async (req, res) => {
  const q = async (sql) => (await pool.query(sql)).rows[0].n;
  res.json({
    users: await q('SELECT count(*)::int AS n FROM users'),
    newUsers: await q("SELECT count(*)::int AS n FROM users WHERE created_at > now() - interval '24 hours'"),
    banned: await q('SELECT count(*)::int AS n FROM users WHERE banned'),
    listings: await q("SELECT count(*)::int AS n FROM listings WHERE status='open'"),
    messages: await q('SELECT count(*)::int AS n FROM messages'),
    messagesToday: await q("SELECT count(*)::int AS n FROM messages WHERE created_at > now() - interval '24 hours'"),
    openTickets: await q("SELECT count(*)::int AS n FROM tickets WHERE status='open'"),
    waiting: await q(`SELECT count(*)::int AS n FROM tickets t WHERE t.status='open' AND
      NOT COALESCE((SELECT staff FROM ticket_messages m WHERE m.ticket_id=t.id ORDER BY m.id DESC LIMIT 1), false)`),
    owners: OWNERS,
  });
}));

app.get('/api/admin/users', owner, wrap(async (req, res) => {
  const q = clean(req.query.q, 30);
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.roblox_id, u.avatar_url, u.banned, u.created_at,
       (SELECT count(*)::int FROM listings l WHERE l.user_id=u.id) AS listings,
       (SELECT count(*)::int FROM messages m WHERE m.user_id=u.id) AS messages,
       (SELECT count(*)::int FROM tickets t WHERE t.user_id=u.id) AS tickets
     FROM users u WHERE ($1 = '' OR u.username ILIKE '%' || $1 || '%')
     ORDER BY u.created_at DESC LIMIT 200`, [q]);
  res.json(rows.map((u) => ({ ...u, roblox_id: u.roblox_id ? String(u.roblox_id) : null, owner: isOwner(u) })));
}));

app.post('/api/admin/users/:id/ban', owner, wrap(async (req, res) => {
  const target = (await pool.query('SELECT id, username, roblox_id FROM users WHERE id=$1', [parseInt(req.params.id, 10)])).rows[0];
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (isOwner(target)) return res.status(400).json({ error: "Owners can't be banned." });
  await pool.query('UPDATE users SET banned=$1 WHERE id=$2', [!!req.body.banned, target.id]);
  res.json({ ok: true });
}));

app.get('/api/admin/tickets', owner, wrap(async (req, res) => {
  const status = req.query.status === 'closed' ? 'closed' : req.query.status === 'all' ? null : 'open';
  const { rows } = await pool.query(
    `SELECT t.id, t.subject, t.status, t.created_at, t.updated_at, u.username,
       (SELECT staff FROM ticket_messages m WHERE m.ticket_id=t.id ORDER BY m.id DESC LIMIT 1) AS last_staff,
       (SELECT count(*)::int FROM ticket_messages m WHERE m.ticket_id=t.id) AS replies
     FROM tickets t JOIN users u ON u.id=t.user_id
     WHERE ($1::text IS NULL OR t.status=$1) ORDER BY t.updated_at DESC LIMIT 200`, [status]);
  res.json(rows);
}));

app.post('/api/admin/tickets/:id/status', owner, wrap(async (req, res) => {
  const status = req.body.status === 'closed' ? 'closed' : 'open';
  await pool.query('UPDATE tickets SET status=$1, updated_at=now() WHERE id=$2', [status, parseInt(req.params.id, 10)]);
  res.json({ ok: true });
}));

app.get('/api/admin/chat', owner, wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT m.id, m.body, m.created_at, u.username, u.id AS user_id FROM messages m JOIN users u ON u.id=m.user_id ORDER BY m.id DESC LIMIT 200');
  res.json(rows);
}));

app.delete('/api/admin/chat/:id', owner, wrap(async (req, res) => {
  await pool.query('DELETE FROM messages WHERE id=$1', [parseInt(req.params.id, 10)]);
  res.json({ ok: true });
}));

app.get('/api/admin/listings', owner, wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT l.id, l.kind, l.item, l.category, l.price, l.status, l.created_at, u.username FROM listings l JOIN users u ON u.id=l.user_id ORDER BY l.created_at DESC LIMIT 200');
  res.json(rows);
}));

app.delete('/api/admin/listings/:id', owner, wrap(async (req, res) => {
  await pool.query('DELETE FROM listings WHERE id=$1', [parseInt(req.params.id, 10)]);
  res.json({ ok: true });
}));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Something went wrong on our side. Try again.' });
});
process.on('unhandledRejection', (e) => console.error('Unhandled', e));

const port = process.env.PORT || 3000;
init().then(() => app.listen(port, () => console.log('Running on ' + port))).catch((e) => { console.error(e); process.exit(1); });
