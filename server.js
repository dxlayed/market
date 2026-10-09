const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
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
  const token = jwt.sign({ id: user.id, username: user.username }, SECRET, { expiresIn: '14d' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 14 * 864e5 });
}

app.post('/api/register', async (req, res) => {
  const username = clean(req.body.username, 20);
  const password = String(req.body.password || '');
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'Username: 3-20 letters, numbers, underscores.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query('INSERT INTO users (username, password_hash) VALUES ($1,$2) RETURNING id, username', [username, hash]);
    setToken(res, rows[0]);
    res.json(rows[0]);
  } catch (e) {
    res.status(e.code === '23505' ? 409 : 500).json({ error: e.code === '23505' ? 'Username taken.' : 'Server error.' });
  }
});

app.post('/api/login', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM users WHERE lower(username)=lower($1)', [clean(req.body.username, 20)]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(String(req.body.password || ''), u.password_hash))) return res.status(401).json({ error: 'Wrong username or password.' });
  setToken(res, u);
  res.json({ id: u.id, username: u.username });
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
