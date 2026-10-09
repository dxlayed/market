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
    CREATE TABLE IF NOT EXISTS items (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'Knife',
      rarity TEXT NOT NULL DEFAULT 'Common',
      value INT NOT NULL DEFAULT 0,
      image_url TEXT,
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS items_name_lower ON items (lower(name));
    CREATE TABLE IF NOT EXISTS trades (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE SET NULL,
      kind TEXT NOT NULL CHECK (kind IN ('deposit','withdraw')),
      status TEXT NOT NULL DEFAULT 'pending',
      code TEXT NOT NULL,
      items JSONB NOT NULL DEFAULT '[]',
      handled_by TEXT,
      note TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS inventory (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE SET NULL,
      item_id INT REFERENCES items(id),
      status TEXT NOT NULL DEFAULT 'held',
      deposit_trade_id INT REFERENCES trades(id),
      withdraw_trade_id INT REFERENCES trades(id),
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS inventory_user ON inventory (user_id, status);
    CREATE TABLE IF NOT EXISTS logs (
      id SERIAL PRIMARY KEY,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT,
      detail JSONB,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS logs_created ON logs (created_at DESC);
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

// ---------- Shared helpers for trading + logs ----------
async function tx(fn) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  finally { c.release(); }
}
// Every important action goes in the logs table so owners can audit it.
async function log(db, actor, action, target, detail) {
  try { await (db || pool).query('INSERT INTO logs (actor, action, target, detail) VALUES ($1,$2,$3,$4)', [String(actor), action, target == null ? null : String(target), detail ? JSON.stringify(detail) : null]); }
  catch (e) { console.error('log failed', e.message); }
}
class Fail extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const makeTradeCode = () => Array.from({ length: 6 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
const TRADING_OPEN = process.env.TRADING_OPEN === 'true';
const MM_ACCOUNTS = (process.env.MM_ACCOUNTS || '').split(',').map((s) => s.trim()).filter(Boolean);
const TYPES = ['Knife', 'Gun', 'Pet', 'Misc'];
const RARITIES = ['Chroma', 'Ancient', 'Godly', 'Unique', 'Vintage', 'Legendary', 'Rare', 'Uncommon', 'Common'];


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
    await log(null, user.username, 'user.login', 'roblox:' + ch.rid);
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
    activeTrades: await q("SELECT count(*)::int AS n FROM trades WHERE status IN ('pending','in_progress')"),
    itemsHeld: await q("SELECT count(*)::int AS n FROM inventory WHERE status IN ('held','withdrawing')"),
    owners: OWNERS,
    apiEnabled: BOT_KEY.length >= 32,
  });
}));

app.get('/api/admin/users', owner, wrap(async (req, res) => {
  const q = clean(req.query.q, 30);
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.roblox_id, u.avatar_url, u.banned, u.created_at,
       (SELECT count(*)::int FROM listings l WHERE l.user_id=u.id) AS listings,
       (SELECT count(*)::int FROM messages m WHERE m.user_id=u.id) AS messages,
       (SELECT count(*)::int FROM tickets t WHERE t.user_id=u.id) AS tickets,
       (SELECT count(*)::int FROM inventory v WHERE v.user_id=u.id AND v.status IN ('held','withdrawing')) AS items
     FROM users u WHERE ($1 = '' OR u.username ILIKE '%' || $1 || '%')
     ORDER BY u.created_at DESC LIMIT 200`, [q]);
  res.json(rows.map((u) => ({ ...u, roblox_id: u.roblox_id ? String(u.roblox_id) : null, owner: isOwner(u) })));
}));

app.post('/api/admin/users/:id/ban', owner, wrap(async (req, res) => {
  const target = (await pool.query('SELECT id, username, roblox_id FROM users WHERE id=$1', [parseInt(req.params.id, 10)])).rows[0];
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (isOwner(target)) return res.status(400).json({ error: "Owners can't be banned." });
  await pool.query('UPDATE users SET banned=$1 WHERE id=$2', [!!req.body.banned, target.id]);
  await log(null, req.user.username, req.body.banned ? 'user.banned' : 'user.unbanned', 'user:' + target.username);
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
  await log(null, req.user.username, 'ticket.' + status, 'ticket:' + req.params.id);
  res.json({ ok: true });
}));

app.get('/api/admin/chat', owner, wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT m.id, m.body, m.created_at, u.username, u.id AS user_id FROM messages m JOIN users u ON u.id=m.user_id ORDER BY m.id DESC LIMIT 200');
  res.json(rows);
}));

app.delete('/api/admin/chat/:id', owner, wrap(async (req, res) => {
  const gone = (await pool.query('DELETE FROM messages WHERE id=$1 RETURNING body, user_id', [parseInt(req.params.id, 10)])).rows[0];
  await log(null, req.user.username, 'chat.deleted', 'message:' + req.params.id, gone);
  res.json({ ok: true });
}));

app.get('/api/admin/listings', owner, wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT l.id, l.kind, l.item, l.category, l.price, l.status, l.created_at, u.username FROM listings l JOIN users u ON u.id=l.user_id ORDER BY l.created_at DESC LIMIT 200');
  res.json(rows);
}));

app.delete('/api/admin/listings/:id', owner, wrap(async (req, res) => {
  const gone = (await pool.query('DELETE FROM listings WHERE id=$1 RETURNING item, user_id', [parseInt(req.params.id, 10)])).rows[0];
  await log(null, req.user.username, 'listing.deleted', 'listing:' + req.params.id, gone);
  res.json({ ok: true });
}));

// ---------- Items, inventory, trades ----------
app.get('/api/items', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id, name, type, rarity, value, image_url FROM items WHERE active ORDER BY value DESC, name ASC');
  res.json(rows);
}));

app.get('/api/trading-info', (req, res) => res.json({ open: TRADING_OPEN, accounts: MM_ACCOUNTS }));

app.get('/api/inventory', authAny, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT inv.id, inv.status, inv.created_at, i.id AS item_id, i.name, i.type, i.rarity, i.value, i.image_url
     FROM inventory inv JOIN items i ON i.id=inv.item_id
     WHERE inv.user_id=$1 AND inv.status IN ('held','withdrawing') ORDER BY i.value DESC, inv.id ASC`, [req.user.id]);
  res.json(rows);
}));

app.get('/api/trades', authAny, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id, kind, status, code, items, note, created_at, updated_at FROM trades WHERE user_id=$1 ORDER BY id DESC LIMIT 30', [req.user.id]);
  res.json(rows);
}));

function tradingGate(req) {
  if (!TRADING_OPEN && !isOwner(req.user)) throw new Fail(503, 'Deposits and withdrawals are coming soon.');
  if (!req.user.roblox_id) throw new Fail(400, 'Log in with Roblox before trading.');
}

app.post('/api/trades/deposit', auth, wrap(async (req, res) => {
  tradingGate(req);
  if (!limit('dep' + req.user.id, 5000)) throw new Fail(429, 'Slow down a little.');
  const want = Array.isArray(req.body.items) ? req.body.items : [];
  const wanted = new Map();
  for (const w of want) {
    const id = parseInt(w.item_id, 10), qty = parseInt(w.qty, 10) || 1;
    if (id > 0 && qty > 0) wanted.set(id, Math.min((wanted.get(id) || 0) + qty, 50));
  }
  if (!wanted.size) throw new Fail(400, 'Pick at least one item to deposit.');
  const total = [...wanted.values()].reduce((a, b) => a + b, 0);
  if (total > 50) throw new Fail(400, 'You can deposit up to 50 items at once.');
  const out = await tx(async (db) => {
    const active = (await db.query("SELECT count(*)::int AS n FROM trades WHERE user_id=$1 AND status IN ('pending','in_progress')", [req.user.id])).rows[0].n;
    if (active >= 2) throw new Fail(400, 'Finish or cancel your open requests first.');
    const found = (await db.query('SELECT id, name FROM items WHERE active AND id = ANY($1)', [[...wanted.keys()]])).rows;
    if (found.length !== wanted.size) throw new Fail(400, 'One of those items is not in the catalog.');
    const items = found.map((i) => ({ item_id: i.id, name: i.name, qty: wanted.get(i.id) }));
    const t = (await db.query("INSERT INTO trades (user_id, kind, code, items) VALUES ($1,'deposit',$2,$3) RETURNING id, code", [req.user.id, makeTradeCode(), JSON.stringify(items)])).rows[0];
    await log(db, req.user.username, 'trade.deposit_requested', 'trade:' + t.id, { items });
    return t;
  });
  res.json(out);
}));

app.post('/api/trades/withdraw', auth, wrap(async (req, res) => {
  tradingGate(req);
  if (!limit('wd' + req.user.id, 5000)) throw new Fail(429, 'Slow down a little.');
  const ids = [...new Set((Array.isArray(req.body.inventory_ids) ? req.body.inventory_ids : []).map((x) => parseInt(x, 10)).filter((x) => x > 0))].slice(0, 50);
  if (!ids.length) throw new Fail(400, 'Pick at least one item to withdraw.');
  const out = await tx(async (db) => {
    const active = (await db.query("SELECT count(*)::int AS n FROM trades WHERE user_id=$1 AND status IN ('pending','in_progress')", [req.user.id])).rows[0].n;
    if (active >= 2) throw new Fail(400, 'Finish or cancel your open requests first.');
    const rows = (await db.query(
      `SELECT inv.id, i.id AS item_id, i.name FROM inventory inv JOIN items i ON i.id=inv.item_id
       WHERE inv.id = ANY($1) AND inv.user_id=$2 AND inv.status='held' FOR UPDATE OF inv`, [ids, req.user.id])).rows;
    if (rows.length !== ids.length) throw new Fail(400, 'Some of those items are not in your inventory anymore. Refresh and try again.');
    const items = rows.map((r) => ({ inventory_id: r.id, item_id: r.item_id, name: r.name, qty: 1 }));
    const t = (await db.query("INSERT INTO trades (user_id, kind, code, items) VALUES ($1,'withdraw',$2,$3) RETURNING id, code", [req.user.id, makeTradeCode(), JSON.stringify(items)])).rows[0];
    await db.query("UPDATE inventory SET status='withdrawing', withdraw_trade_id=$1 WHERE id = ANY($2)", [t.id, ids]);
    await log(db, req.user.username, 'trade.withdraw_requested', 'trade:' + t.id, { items });
    return t;
  });
  res.json(out);
}));

// Core state changes, shared by users, owners and the API so the rules are identical everywhere.
async function finishTrade(db, id, actor, outcome, opts = {}) {
  const t = (await db.query('SELECT * FROM trades WHERE id=$1 FOR UPDATE', [id])).rows[0];
  if (!t) throw new Fail(404, 'Trade not found.');
  const allowed = outcome === 'cancelled' ? ['pending'] : ['pending', 'in_progress'];
  if (!allowed.includes(t.status)) throw new Fail(409, 'This trade is already ' + t.status.replace('_', ' ') + '.');
  let detail = { kind: t.kind, user_id: t.user_id };
  if (outcome === 'completed' && t.kind === 'deposit') {
    let got = t.items;
    if (Array.isArray(opts.received) && opts.received.length) {
      got = [];
      for (const r of opts.received.slice(0, 50)) {
        const qty = Math.min(Math.max(parseInt(r.qty, 10) || 1, 1), 50);
        const item = r.item_id
          ? (await db.query('SELECT id, name FROM items WHERE id=$1', [parseInt(r.item_id, 10)])).rows[0]
          : (await db.query('SELECT id, name FROM items WHERE lower(name)=lower($1)', [clean(r.name, 60)])).rows[0];
        if (!item) throw new Fail(400, 'Unknown item: ' + (r.name || r.item_id) + '. Add it to the catalog first.');
        got.push({ item_id: item.id, name: item.name, qty });
      }
    }
    const units = got.reduce((a, g) => a + g.qty, 0);
    if (units > 100) throw new Fail(400, 'Too many items in one trade.');
    for (const g of got) for (let k = 0; k < g.qty; k++) {
      await db.query('INSERT INTO inventory (user_id, item_id, deposit_trade_id) VALUES ($1,$2,$3)', [t.user_id, g.item_id, t.id]);
    }
    detail.received = got;
    await db.query('UPDATE trades SET items=$1 WHERE id=$2', [JSON.stringify(got), t.id]);
  }
  if (t.kind === 'withdraw') {
    const ids = t.items.map((x) => x.inventory_id);
    if (outcome === 'completed') await db.query("UPDATE inventory SET status='withdrawn' WHERE id = ANY($1) AND status='withdrawing'", [ids]);
    else await db.query("UPDATE inventory SET status='held', withdraw_trade_id=NULL WHERE id = ANY($1) AND status='withdrawing'", [ids]);
    detail.items = t.items;
  }
  const note = opts.note ? clean(opts.note, 300) : null;
  await db.query('UPDATE trades SET status=$1, handled_by=COALESCE(handled_by,$2), note=COALESCE($3,note), updated_at=now() WHERE id=$4', [outcome, actor, note, t.id]);
  if (note) detail.note = note;
  await log(db, actor, 'trade.' + outcome, 'trade:' + t.id, detail);
  return { ok: true, status: outcome };
}

async function claimTrade(db, id, actor) {
  const r = await db.query("UPDATE trades SET status='in_progress', handled_by=$1, updated_at=now() WHERE id=$2 AND status='pending' RETURNING id", [actor, id]);
  if (!r.rowCount) throw new Fail(409, 'Trade is not pending anymore.');
  await log(db, actor, 'trade.claimed', 'trade:' + id);
  return { ok: true, status: 'in_progress' };
}

app.post('/api/trades/:id/cancel', authAny, wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const own = (await pool.query('SELECT user_id FROM trades WHERE id=$1', [id])).rows[0];
  if (!own || own.user_id !== req.user.id) throw new Fail(404, 'Trade not found.');
  res.json(await tx((db) => finishTrade(db, id, req.user.username, 'cancelled')));
}));

// ---------- API for your own trading system (key protected) ----------
// Set BOT_API_KEY in Railway (32+ random characters). Send it as: Authorization: Bearer <key>
const BOT_KEY = process.env.BOT_API_KEY || '';
function botAuth(req, res, next) {
  const got = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const ok = BOT_KEY.length >= 32 && got.length === BOT_KEY.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(BOT_KEY));
  if (!ok) return res.status(401).json({ error: 'Bad or missing API key.' });
  req.actor = 'api:' + clean(req.headers['x-actor'] || 'bot', 30);
  next();
}

const tradeView = (t) => ({ id: t.id, kind: t.kind, status: t.status, code: t.code, items: t.items, roblox_id: t.roblox_id ? String(t.roblox_id) : null, roblox_username: t.username, handled_by: t.handled_by, created_at: t.created_at });

app.get('/api/bot/trades', botAuth, wrap(async (req, res) => {
  const status = ['pending', 'in_progress'].includes(req.query.status) ? [req.query.status] : ['pending', 'in_progress'];
  const { rows } = await pool.query(
    `SELECT t.*, u.username, u.roblox_id FROM trades t JOIN users u ON u.id=t.user_id
     WHERE t.status = ANY($1) ORDER BY t.id ASC LIMIT 100`, [status]);
  res.json(rows.map(tradeView));
}));

app.post('/api/bot/trades/:id/claim', botAuth, wrap(async (req, res) => res.json(await tx((db) => claimTrade(db, parseInt(req.params.id, 10), req.actor)))));
app.post('/api/bot/trades/:id/complete', botAuth, wrap(async (req, res) => res.json(await tx((db) => finishTrade(db, parseInt(req.params.id, 10), req.actor, 'completed', { received: req.body.received, note: req.body.note })))));
app.post('/api/bot/trades/:id/fail', botAuth, wrap(async (req, res) => res.json(await tx((db) => finishTrade(db, parseInt(req.params.id, 10), req.actor, 'failed', { note: req.body.reason })))));

// ---------- Owner: items, trades, logs ----------
function itemFields(b) {
  const name = clean(b.name, 60);
  if (!name) throw new Fail(400, 'Item needs a name.');
  const type = TYPES.includes(b.type) ? b.type : 'Misc';
  const rarity = RARITIES.includes(b.rarity) ? b.rarity : 'Common';
  const value = Math.max(0, Math.min(parseInt(b.value, 10) || 0, 1e9));
  const image = clean(b.image_url, 300);
  if (image && !/^https:\/\//.test(image)) throw new Fail(400, 'Image link must start with https://');
  return { name, type, rarity, value, image_url: image || null };
}

app.get('/api/admin/items', owner, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT i.*, (SELECT count(*)::int FROM inventory v WHERE v.item_id=i.id AND v.status IN ('held','withdrawing')) AS held
     FROM items i ORDER BY i.active DESC, i.value DESC, i.name ASC`);
  res.json(rows);
}));

app.post('/api/admin/items', owner, wrap(async (req, res) => {
  const f = itemFields(req.body);
  try {
    const r = (await pool.query('INSERT INTO items (name, type, rarity, value, image_url) VALUES ($1,$2,$3,$4,$5) RETURNING id', [f.name, f.type, f.rarity, f.value, f.image_url])).rows[0];
    await log(null, req.user.username, 'item.created', 'item:' + r.id, f);
    res.json(r);
  } catch (e) { if (e.code === '23505') throw new Fail(409, 'An item with that name already exists.'); throw e; }
}));

app.patch('/api/admin/items/:id', owner, wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (typeof req.body.active === 'boolean' && Object.keys(req.body).length === 1) {
    await pool.query('UPDATE items SET active=$1 WHERE id=$2', [req.body.active, id]);
    await log(null, req.user.username, req.body.active ? 'item.enabled' : 'item.disabled', 'item:' + id);
    return res.json({ ok: true });
  }
  const f = itemFields(req.body);
  try { await pool.query('UPDATE items SET name=$1, type=$2, rarity=$3, value=$4, image_url=$5 WHERE id=$6', [f.name, f.type, f.rarity, f.value, f.image_url, id]); }
  catch (e) { if (e.code === '23505') throw new Fail(409, 'An item with that name already exists.'); throw e; }
  await log(null, req.user.username, 'item.updated', 'item:' + id, f);
  res.json({ ok: true });
}));

// Paste lines like: Harvester, Knife, Ancient, 1800
app.post('/api/admin/items/import', owner, wrap(async (req, res) => {
  const lines = String(req.body.text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 2000);
  let added = 0, updated = 0; const errors = [];
  for (const [n, line] of lines.entries()) {
    if (n === 0 && /^name\s*,/i.test(line)) continue;
    const [name, type, rarity, value, image_url] = line.split(',').map((x) => (x || '').trim());
    const norm = (v, list) => list.find((x) => x.toLowerCase() === String(v).toLowerCase());
    try {
      const nt = norm(type, TYPES), nr = norm(rarity, RARITIES);
      if (!nt) throw new Error('type must be one of ' + TYPES.join('/'));
      if (!nr) throw new Error('rarity must be one of ' + RARITIES.join('/'));
      if (value === undefined || value === '' || isNaN(parseInt(value, 10))) throw new Error('value must be a number');
      const f = itemFields({ name, type: nt, rarity: nr, value, image_url });
      const r = await pool.query(
        `INSERT INTO items (name, type, rarity, value, image_url) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT ((lower(name))) DO UPDATE SET type=EXCLUDED.type, rarity=EXCLUDED.rarity, value=EXCLUDED.value, image_url=COALESCE(EXCLUDED.image_url, items.image_url)
         RETURNING (xmax = 0) AS inserted`, [f.name, f.type, f.rarity, f.value, f.image_url]);
      r.rows[0].inserted ? added++ : updated++;
    } catch (e) { errors.push('Line ' + (n + 1) + ': ' + e.message); }
  }
  await log(null, req.user.username, 'item.imported', null, { added, updated, errors: errors.length });
  res.json({ added, updated, errors: errors.slice(0, 20) });
}));

app.get('/api/admin/trades', owner, wrap(async (req, res) => {
  const st = req.query.status;
  const filter = st === 'active' || !st ? ['pending', 'in_progress'] : st === 'all' ? null : [st];
  const { rows } = await pool.query(
    `SELECT t.*, u.username, u.roblox_id FROM trades t LEFT JOIN users u ON u.id=t.user_id
     WHERE ($1::text[] IS NULL OR t.status = ANY($1)) ORDER BY t.id DESC LIMIT 200`, [filter]);
  res.json(rows.map(tradeView));
}));

app.post('/api/admin/trades/:id/:action', owner, wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10), a = req.params.action, who = req.user.username;
  if (a === 'claim') return res.json(await tx((db) => claimTrade(db, id, who)));
  if (a === 'complete') return res.json(await tx((db) => finishTrade(db, id, who, 'completed', { received: req.body.received, note: req.body.note })));
  if (a === 'fail') return res.json(await tx((db) => finishTrade(db, id, who, 'failed', { note: req.body.reason })));
  throw new Fail(404, 'Unknown action.');
}));

app.get('/api/admin/logs', owner, wrap(async (req, res) => {
  const q = clean(req.query.q, 60), type = clean(req.query.type, 20);
  const { rows } = await pool.query(
    `SELECT id, actor, action, target, detail, created_at FROM logs
     WHERE ($1 = '' OR actor ILIKE '%' || $1 || '%' OR target ILIKE '%' || $1 || '%' OR detail::text ILIKE '%' || $1 || '%')
       AND ($2 = '' OR action LIKE $2 || '.%')
     ORDER BY id DESC LIMIT 300`, [q, type]);
  res.json(rows);
}));

app.use((err, req, res, next) => {
  if (err instanceof Fail) return res.status(err.status).json({ error: err.message });
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Something went wrong on our side. Try again.' });
});
process.on('unhandledRejection', (e) => console.error('Unhandled', e));

const port = process.env.PORT || 3000;
init().then(() => app.listen(port, () => console.log('Running on ' + port))).catch((e) => { console.error(e); process.exit(1); });
