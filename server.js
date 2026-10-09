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
  `);
}

const clean = (v, max) => String(v || '').trim().slice(0, max);

function auth(req, res, next) {
  try {
    req.user = jwt.verify(req.cookies.token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Please log in first.' });
  }
}

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
    let user = (await pool.query('SELECT id, username FROM users WHERE roblox_id=$1', [ch.rid])).rows[0];
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

app.get('/api/me', (req, res) => {
  try { res.json(jwt.verify(req.cookies.token, SECRET)); } catch { res.json(null); }
});

app.get('/api/listings', async (req, res) => {
  const where = ["l.status='open'"];
  const args = [];
  if (req.query.q) { args.push('%' + clean(req.query.q, 50) + '%'); where.push(`l.item ILIKE $${args.length}`); }
  if (['sell', 'buy'].includes(req.query.kind)) { args.push(req.query.kind); where.push(`l.kind=$${args.length}`); }
  if (req.query.category) { args.push(clean(req.query.category, 30)); where.push(`l.category=$${args.length}`); }
  const { rows } = await pool.query(
    `SELECT l.*, u.username FROM listings l JOIN users u ON u.id=l.user_id WHERE ${where.join(' AND ')} ORDER BY l.created_at DESC LIMIT 100`, args);
  res.json(rows);
});

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

app.get('/api/profile', auth, async (req, res) => {
  const id = req.user.id;
  const u = (await pool.query('SELECT username, created_at FROM users WHERE id=$1', [id])).rows[0];
  const c = (await pool.query("SELECT status, count(*)::int AS n FROM listings WHERE user_id=$1 GROUP BY status", [id])).rows;
  const n = (s) => (c.find((r) => r.status === s) || { n: 0 }).n;
  const msgs = (await pool.query('SELECT count(*)::int AS n FROM messages WHERE user_id=$1', [id])).rows[0].n;
  const mine = (await pool.query("SELECT id, kind, item, category, price, status FROM listings WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50", [id])).rows;
  const done = n('done');
  const rank = done >= 15 ? 'Broker' : done >= 5 ? 'Dealer' : done >= 1 ? 'Trader' : 'Newcomer';
  res.json({ username: u.username, joined: u.created_at, open: n('open'), done, messages: msgs, rank, listings: mine });
});

const lastMsg = new Map();

app.get('/api/chat', async (req, res) => {
  const after = parseInt(req.query.after, 10);
  const q = after
    ? ['SELECT m.id, m.body, m.created_at, m.user_id, u.username FROM messages m JOIN users u ON u.id=m.user_id WHERE m.id>$1 ORDER BY m.id ASC LIMIT 100', [after]]
    : ['SELECT * FROM (SELECT m.id, m.body, m.created_at, m.user_id, u.username FROM messages m JOIN users u ON u.id=m.user_id ORDER BY m.id DESC LIMIT 50) t ORDER BY id ASC', []];
  const { rows } = await pool.query(q[0], q[1]);
  res.json(rows);
});

app.post('/api/chat', auth, async (req, res) => {
  const body = clean(req.body.body, 200);
  if (!body) return res.status(400).json({ error: 'Type a message first.' });
  const now = Date.now();
  if (now - (lastMsg.get(req.user.id) || 0) < 1500) return res.status(429).json({ error: 'Slow down a little.' });
  lastMsg.set(req.user.id, now);
  await pool.query('INSERT INTO messages (user_id, body) VALUES ($1,$2)', [req.user.id, body]);
  res.json({ ok: true });
});

const port = process.env.PORT || 3000;
init().then(() => app.listen(port, () => console.log('Running on ' + port))).catch((e) => { console.error(e); process.exit(1); });
