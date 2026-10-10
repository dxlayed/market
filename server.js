const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const crypto = require('crypto');
const cx = require('./crypto.js');

const app = express();
app.set('trust proxy', 1);
// Owner item tools (picture uploads, pasted value lists) need bigger request bodies than everything else.
const smallJson = express.json({ limit: '10kb' }), bigJson = express.json({ limit: '1mb' });
app.use((req, res, next) => (req.path.startsWith('/api/admin/items') ? bigJson : smallJson)(req, res, next));
app.use(cookieParser());

// Buying and selling are open to everyone. Set LISTINGS_OPEN=false in Railway to make them owner-only again.
const LISTINGS_OPEN = process.env.LISTINGS_OPEN !== 'false';

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
    -- Marketplace: money is stored in whole cents so there are no rounding errors.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS balance_cents INT NOT NULL DEFAULT 0;
    CREATE TABLE IF NOT EXISTS market_listings (
      id SERIAL PRIMARY KEY,
      seller_id INT REFERENCES users(id) ON DELETE SET NULL,
      inventory_id INT REFERENCES inventory(id),
      item_id INT REFERENCES items(id),
      price_cents INT NOT NULL CHECK (price_cents > 0),
      status TEXT NOT NULL DEFAULT 'active',
      buyer_id INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      sold_at TIMESTAMPTZ
    );
    CREATE UNIQUE INDEX IF NOT EXISTS market_active_inv ON market_listings (inventory_id) WHERE status='active';
    CREATE INDEX IF NOT EXISTS market_status ON market_listings (status, created_at DESC);
    CREATE TABLE IF NOT EXISTS balance_log (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      delta_cents INT NOT NULL,
      balance_after INT NOT NULL,
      reason TEXT NOT NULL,
      note TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS balance_log_user ON balance_log (user_id, id DESC);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value JSONB NOT NULL);
    ALTER TABLE items ADD COLUMN IF NOT EXISTS demand INT;
    ALTER TABLE inventory ADD COLUMN IF NOT EXISTS added_by TEXT;
    ALTER TABLE market_listings ADD COLUMN IF NOT EXISTS fee_cents INT NOT NULL DEFAULT 0;
    ALTER TABLE crypto_withdrawals ADD COLUMN IF NOT EXISTS tax_cents INT NOT NULL DEFAULT 0;
    CREATE TABLE IF NOT EXISTS tax_collections (id SERIAL PRIMARY KEY, amount_cents INT NOT NULL, sales_cents INT NOT NULL, withdraw_cents INT NOT NULL, collected_by TEXT, created_at TIMESTAMPTZ DEFAULT now());
    ALTER TABLE market_listings ADD COLUMN IF NOT EXISTS collected_id INT;
    CREATE TABLE IF NOT EXISTS deposit_unmatched (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE SET NULL,
      trade_id INT REFERENCES trades(id) ON DELETE SET NULL,
      raw_name TEXT NOT NULL,
      qty INT NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'open',
      item_id INT REFERENCES items(id),
      handled_by TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      handled_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS balance_codes (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      amount_cents INT NOT NULL,
      batch TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      redeemed_by INT REFERENCES users(id) ON DELETE SET NULL,
      redeemed_at TIMESTAMPTZ,
      disabled BOOLEAN NOT NULL DEFAULT false
    );
    CREATE TABLE IF NOT EXISTS giveaways (
      id SERIAL PRIMARY KEY,
      inventory_id INT REFERENCES inventory(id),
      item_id INT REFERENCES items(id),
      host_id INT REFERENCES users(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'active',
      ends_at TIMESTAMPTZ NOT NULL,
      winner_id INT REFERENCES users(id) ON DELETE SET NULL,
      entries_at_draw INT,
      created_at TIMESTAMPTZ DEFAULT now(),
      ended_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS giveaway_entries (
      giveaway_id INT REFERENCES giveaways(id) ON DELETE CASCADE,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (giveaway_id, user_id)
    );
    ALTER TABLE crypto_withdrawals ADD COLUMN IF NOT EXISTS collected_id INT;
    ALTER TABLE items ADD COLUMN IF NOT EXISTS stability TEXT;
    ALTER TABLE items ADD COLUMN IF NOT EXISTS value_change INT;
    ALTER TABLE items ADD COLUMN IF NOT EXISTS value_updated_at TIMESTAMPTZ;
    ALTER TABLE items ADD COLUMN IF NOT EXISTS image_data BYTEA;
    ALTER TABLE items ADD COLUMN IF NOT EXISTS image_type TEXT;
    -- Crypto. locked_cents = deposited money that has to be spent on items before it can be withdrawn.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_cents INT NOT NULL DEFAULT 0;
    CREATE TABLE IF NOT EXISTS crypto_addresses (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      coin TEXT NOT NULL,
      key_id TEXT NOT NULL,
      idx INT NOT NULL,
      address TEXT NOT NULL,
      last_viewed TIMESTAMPTZ DEFAULT now(),
      last_checked TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE (coin, key_id, idx),
      UNIQUE (coin, address)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS crypto_addr_user ON crypto_addresses (user_id, coin, key_id);
    CREATE TABLE IF NOT EXISTS crypto_deposits (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE SET NULL,
      coin TEXT NOT NULL,
      address TEXT NOT NULL,
      txid TEXT NOT NULL,
      amount_sats BIGINT NOT NULL,
      usd_cents INT NOT NULL,
      confirmations INT NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT now(),
      credited_at TIMESTAMPTZ,
      UNIQUE (coin, txid, address)
    );
    CREATE TABLE IF NOT EXISTS crypto_withdrawals (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE SET NULL,
      coin TEXT NOT NULL,
      address TEXT NOT NULL,
      usd_cents INT NOT NULL,
      fee_cents INT NOT NULL,
      coin_amount TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      txid TEXT,
      note TEXT,
      handled_by TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  for (const r of (await pool.query('SELECT key, value FROM settings')).rows) settings[r.key] = r.value;
}

const clean = (v, max) => String(v || '').trim().slice(0, max);

// Owners are Roblox-verified accounts with these usernames. Change with the OWNERS variable in Railway.
const OWNERS = (process.env.OWNERS || 'yukogives,Kriminalitys').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const isOwner = (u) => !!u && u.roblox_id != null && OWNERS.includes(String(u.username).toLowerCase());
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function currentUser(req) {
  let t;
  try { t = jwt.verify(req.cookies.token, SECRET); } catch { return null; }
  return (await pool.query('SELECT id, username, avatar_url, roblox_id, banned, balance_cents FROM users WHERE id=$1', [t.id])).rows[0] || null;
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

// ---------- Maintenance mode ----------
// Owners flip this in the owner panel. Owners keep seeing the normal site; everyone else gets
// public/maintenance, and the API refuses requests except login and the bot API.
const settings = { maintenance: false, sale_tax: { on: false, pct: 5 }, withdraw_tax: { on: false, pct: 5 } };
// Site fees, switched on and off in Owner panel → Overview.
const taxPct = (k) => (settings[k] && settings[k].on ? Math.min(Math.max(Number(settings[k].pct) || 0, 0), 50) : 0);
const taxOf = (cents, pct) => Math.round(cents * pct / 100);
const OPEN_DURING_MAINTENANCE = /^\/api\/(auth\/|logout$|me$|status$|bot\/)/;
// Pages are served at clean addresses (/owner, /inventory, ...). The file in public/ can be named
// either "owner.html" or just "owner"; both work. Old ".html" links redirect to the clean address.
const PUB = path.join(__dirname, 'public');
const PAGES = new Set(['index', 'values', 'giveaways', 'inventory', 'profile', 'support', 'owner', 'maintenance', 'board']);
function pageFile(name) {
  for (const f of [name + '.html', name]) { const fp = path.join(PUB, f); try { if (fs.statSync(fp).isFile()) return fp; } catch {} }
  return null;
}
function pageName(p) {
  if (p === '/' || p === '/index') return 'index';
  const m = p.match(/^\/([\w-]+)\/?$/);
  return m && PAGES.has(m[1]) ? m[1] : null;
}
app.use((req, res, next) => {
  const m = req.path.match(/^\/([\w-]+)\.html$/);
  if ((req.method === 'GET' || req.method === 'HEAD') && m && PAGES.has(m[1])) {
    const q = req.originalUrl.indexOf('?');
    return res.redirect(301, (m[1] === 'index' ? '/' : '/' + m[1]) + (q >= 0 ? req.originalUrl.slice(q) : ''));
  }
  next();
});
app.use(wrap(async (req, res, next) => {
  if (!settings.maintenance) return next();
  const p = req.path;
  const isPage = !!pageName(p);
  if (pageName(p) === 'maintenance' || (!isPage && !p.startsWith('/api/')) || OPEN_DURING_MAINTENANCE.test(p)) return next();
  if (isOwner(await currentUser(req))) return next();
  res.status(503).set('Retry-After', '600');
  if (p.startsWith('/api/')) return res.json({ error: "SplitzMarket is down for maintenance. We'll be back soon.", maintenance: true });
  res.set('Cache-Control', 'no-store').type('html').sendFile(pageFile('maintenance'));
}));
app.get(/^\/[\w-]*\/?$/, (req, res, next) => {
  const name = pageName(req.path), file = name && pageFile(name);
  if (!file) return next();
  res.type('html').sendFile(file);
});
app.use(express.static(PUB, { index: false }));
// Scripts/styles whose file lost its extension (e.g. public/auth instead of public/auth.js) still load.
app.get(/^\/([\w-]+)\.(js|css)$/, (req, res, next) => {
  const fp = path.join(PUB, req.params[0]);
  try { if (fs.statSync(fp).isFile()) return res.type(req.params[1]).sendFile(fp); } catch {}
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
// Withdrawals are open to everyone. Set TRADING_OPEN=false in Railway to make them owner-only again.
const TRADING_OPEN = process.env.TRADING_OPEN !== 'false';
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
  res.json({ id: u.id, username: u.username, avatar: u.avatar_url || null, owner: isOwner(u), banned: !!u.banned, balance: u.balance_cents, maintenance: isOwner(u) ? settings.maintenance : undefined });
}));

app.get('/api/status', wrap(async (req, res) => {
  res.json({ maintenance: settings.maintenance });
}));

// ---------- Marketplace ----------
// Sellers list items they've already deposited. The site holds the item, so a purchase
// moves the item and the money in one database transaction and nobody can be scammed.
const marketGate = (u) => { if (!LISTINGS_OPEN && !isOwner(u)) throw new Fail(503, 'Buying and selling are paused right now.'); };
const MIN_PRICE = 5, MAX_PRICE = 5000000; // $0.05 to $50,000
// Recommended price shown to buyers and sellers: dollars per 1,000 value (RECOMMENDED_PER_1K in Railway, default 20).
const REC_PER_1K = Math.max(0, parseFloat(process.env.RECOMMENDED_PER_1K) || 20);
function toCents(v) {
  const s = String(v == null ? '' : v).trim().replace(/^\$/, '');
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(s)) throw new Fail(400, 'Enter a price like 4.99');
  const c = Math.round(parseFloat(s) * 100);
  if (c < MIN_PRICE || c > MAX_PRICE) throw new Fail(400, 'Prices must be between $0.05 and $50,000.');
  return c;
}
const usd = (c) => '$' + (c / 100).toFixed(2);
// Changes a user's balance and records why. Callers must already hold the user's row lock.
// lockDelta changes the non-withdrawable part: deposits add to it, purchases spend it first.
async function moveMoney(db, userId, delta, reason, note, lockDelta = 0) {
  const r = (await db.query(
    `UPDATE users SET balance_cents = balance_cents + $1,
       locked_cents = LEAST(GREATEST(locked_cents + $3, 0), balance_cents + $1)
     WHERE id=$2 AND balance_cents + $1 >= 0 RETURNING balance_cents`, [delta, userId, lockDelta])).rows[0];
  if (!r) throw new Fail(400, 'Not enough balance.');
  await db.query('INSERT INTO balance_log (user_id, delta_cents, balance_after, reason, note) VALUES ($1,$2,$3,$4,$5)', [userId, delta, r.balance_cents, reason, note || null]);
  return r.balance_cents;
}

const MARKET_SELECT = `SELECT ml.id, ml.price_cents, ml.created_at, ml.seller_id, u.username AS seller,
    i.id AS item_id, i.name, i.type, i.rarity, i.value, i.image_url, i.demand, i.stability, i.value_change
  FROM market_listings ml JOIN items i ON i.id=ml.item_id JOIN users u ON u.id=ml.seller_id`;

app.get('/api/market', wrap(async (req, res) => {
  const where = ["ml.status='active'", 'NOT u.banned'], args = [];
  const add = (sql, v) => { args.push(v); where.push(sql.replace('?', '$' + args.length)); };
  if (req.query.q) add('i.name ILIKE ?', '%' + clean(req.query.q, 50) + '%');
  if (req.query.seller) add('lower(u.username)=lower(?)', clean(req.query.seller, 20));
  const { rows } = await pool.query(`${MARKET_SELECT} WHERE ${where.join(' AND ')} ORDER BY ml.created_at DESC LIMIT 500`, args);
  res.json(rows);
}));

app.get('/api/market/recent', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ml.id, ml.price_cents, ml.sold_at, i.name, i.rarity FROM market_listings ml JOIN items i ON i.id=ml.item_id
     WHERE ml.status='sold' ORDER BY ml.sold_at DESC LIMIT 15`);
  res.json(rows);
}));

app.post('/api/market/list', auth, wrap(async (req, res) => {
  marketGate(req.user);
  if (!limit('list' + req.user.id, 2000)) throw new Fail(429, 'Slow down a little.');
  // Either { items: [{ inventory_id, price }] } with a price per item, or { inventory_ids, price } for one price.
  const priceOf = new Map();
  if (Array.isArray(req.body.items)) for (const it of req.body.items.slice(0, 50)) { const id = parseInt(it.inventory_id, 10); if (id > 0) priceOf.set(id, toCents(it.price)); }
  else { const p = toCents(req.body.price); for (const x of (Array.isArray(req.body.inventory_ids) ? req.body.inventory_ids : []).slice(0, 50)) { const id = parseInt(x, 10); if (id > 0) priceOf.set(id, p); } }
  const ids = [...priceOf.keys()];
  if (!ids.length) throw new Fail(400, 'Pick at least one item to sell.');
  const out = await tx(async (db) => {
    const got = (await db.query(
      "UPDATE inventory SET status='listed' WHERE id = ANY($1) AND user_id=$2 AND status='held' RETURNING id, item_id", [ids, req.user.id])).rows;
    if (got.length !== ids.length) throw new Fail(400, 'Some of those items are not in your inventory anymore. Refresh and try again.');
    for (const g of got) await db.query('INSERT INTO market_listings (seller_id, inventory_id, item_id, price_cents) VALUES ($1,$2,$3,$4)', [req.user.id, g.id, g.item_id, priceOf.get(g.id)]);
    await log(db, req.user.username, 'market.listed', null, { items: got.map((g) => ({ inventory_id: g.id, price: usd(priceOf.get(g.id)) })) });
    return { ok: true, listed: got.length };
  });
  res.json(out);
}));

// Takes a listing down and gives the item back to the seller's inventory.
async function unlist(db, id, actor, sellerId) {
  const l = (await db.query("SELECT * FROM market_listings WHERE id=$1 AND status='active' FOR UPDATE", [id])).rows[0];
  if (!l || (sellerId != null && l.seller_id !== sellerId)) throw new Fail(404, 'That listing is gone. It may have just sold.');
  await db.query("UPDATE market_listings SET status='cancelled' WHERE id=$1", [id]);
  await db.query("UPDATE inventory SET status='held' WHERE id=$1 AND status='listed'", [l.inventory_id]);
  await log(db, actor, 'market.unlisted', 'listing:' + id, { seller_id: l.seller_id, price: usd(l.price_cents) });
  return { ok: true };
}
app.post('/api/market/:id/cancel', auth, wrap(async (req, res) => {
  res.json(await tx((db) => unlist(db, parseInt(req.params.id, 10), req.user.username, req.user.id)));
}));

app.post('/api/market/buy', auth, wrap(async (req, res) => {
  marketGate(req.user);
  if (!limit('buy' + req.user.id, 1500)) throw new Fail(429, 'Slow down a little.');
  const ids = [...new Set((Array.isArray(req.body.listing_ids) ? req.body.listing_ids : []).map((x) => parseInt(x, 10)).filter((x) => x > 0))].slice(0, 50);
  if (!ids.length) throw new Fail(400, 'Your cart is empty.');
  const out = await tx(async (db) => {
    const ls = (await db.query(
      `SELECT ml.*, i.name, u.banned AS seller_banned FROM market_listings ml JOIN items i ON i.id=ml.item_id JOIN users u ON u.id=ml.seller_id
       WHERE ml.id = ANY($1) ORDER BY ml.id FOR UPDATE OF ml`, [ids])).rows;
    const gone = ls.filter((l) => l.status !== 'active' || l.seller_banned);
    if (ls.length !== ids.length || gone.length) throw new Fail(409, 'Some items in your cart were just sold or removed. Your cart has been updated.');
    if (ls.some((l) => l.seller_id === req.user.id)) throw new Fail(400, "You can't buy your own listing.");
    const total = ls.reduce((a, l) => a + l.price_cents, 0);
    // Lock every wallet involved in id order so two checkouts can't deadlock.
    const who = [...new Set([req.user.id, ...ls.map((l) => l.seller_id)])];
    const wallets = (await db.query('SELECT id, balance_cents FROM users WHERE id = ANY($1) ORDER BY id FOR UPDATE', [who])).rows;
    const mine = wallets.find((w) => w.id === req.user.id);
    if (mine.balance_cents < total) throw new Fail(402, `You need ${usd(total)} but have ${usd(mine.balance_cents)}. Add funds first.`);
    const balance = await moveMoney(db, req.user.id, -total, 'purchase', ls.length + ' item' + (ls.length === 1 ? '' : 's') + ': ' + ls.map((l) => l.name).join(', ').slice(0, 200), -total);
    const pct = taxPct('sale_tax');
    for (const l of ls) {
      const fee = taxOf(l.price_cents, pct);
      await moveMoney(db, l.seller_id, l.price_cents - fee, 'sale', 'Sold ' + l.name + ' to ' + req.user.username + (fee ? ' (' + usd(l.price_cents) + ' minus ' + pct + '% fee ' + usd(fee) + ')' : ''));
      await db.query("UPDATE market_listings SET status='sold', buyer_id=$1, sold_at=now(), fee_cents=$3 WHERE id=$2", [req.user.id, l.id, fee]);
      await db.query("UPDATE inventory SET user_id=$1, status='held' WHERE id=$2 AND status='listed'", [req.user.id, l.inventory_id]);
      await log(db, req.user.username, 'market.sold', 'listing:' + l.id, { item: l.name, price: usd(l.price_cents), seller_id: l.seller_id, buyer_id: req.user.id });
    }
    return { ok: true, bought: ls.length, total_cents: total, balance, inventory_ids: ls.map((l) => l.inventory_id) };
  });
  res.json(out);
}));

app.get('/api/wallet', authAny, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id, delta_cents, balance_after, reason, note, created_at FROM balance_log WHERE user_id=$1 ORDER BY id DESC LIMIT 50', [req.user.id]);
  const lk = (await pool.query('SELECT locked_cents FROM users WHERE id=$1', [req.user.id])).rows[0].locked_cents;
  res.json({ balance: req.user.balance_cents, withdrawable: Math.max(0, req.user.balance_cents - lk), history: rows });
}));

app.get('/api/profile', auth, wrap(async (req, res) => {
  const id = req.user.id;
  const u = (await pool.query('SELECT username, created_at, balance_cents FROM users WHERE id=$1', [id])).rows[0];
  const one = async (sql) => (await pool.query(sql, [id])).rows[0];
  const sold = await one("SELECT count(*)::int AS n, COALESCE(sum(price_cents - fee_cents),0)::int AS c FROM market_listings WHERE seller_id=$1 AND status='sold'");
  const bought = await one("SELECT count(*)::int AS n, COALESCE(sum(price_cents),0)::int AS c FROM market_listings WHERE buyer_id=$1 AND status='sold'");
  const deposits = (await one("SELECT count(*)::int AS n FROM trades WHERE user_id=$1 AND kind='deposit' AND status='completed'")).n;
  const messages = (await one('SELECT count(*)::int AS n FROM messages WHERE user_id=$1')).n;
  const listings = (await pool.query(`${MARKET_SELECT} WHERE ml.seller_id=$1 AND ml.status='active' ORDER BY ml.created_at DESC LIMIT 100`, [id])).rows;
  const done = sold.n + bought.n;
  const rank = done >= 15 ? 'Broker' : done >= 5 ? 'Dealer' : done >= 1 ? 'Trader' : 'Newcomer';
  res.json({ username: u.username, joined: u.created_at, balance: u.balance_cents, sales: sold.n, earned: sold.c, purchases: bought.n, spent: bought.c,
    deposits, messages, done, rank, listings });
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
    listings: await q("SELECT count(*)::int AS n FROM market_listings WHERE status='active'"),
    sales24: await q("SELECT count(*)::int AS n FROM market_listings WHERE status='sold' AND sold_at > now() - interval '24 hours'"),
    volume24: await q("SELECT COALESCE(sum(price_cents),0)::int AS n FROM market_listings WHERE status='sold' AND sold_at > now() - interval '24 hours'"),
    balances: await q('SELECT COALESCE(sum(balance_cents),0)::int AS n FROM users'),
    withdrawalsPending: await q("SELECT count(*)::int AS n FROM crypto_withdrawals WHERE status='pending'"),
    messages: await q('SELECT count(*)::int AS n FROM messages'),
    messagesToday: await q("SELECT count(*)::int AS n FROM messages WHERE created_at > now() - interval '24 hours'"),
    openTickets: await q("SELECT count(*)::int AS n FROM tickets WHERE status='open'"),
    waiting: await q(`SELECT count(*)::int AS n FROM tickets t WHERE t.status='open' AND
      NOT COALESCE((SELECT staff FROM ticket_messages m WHERE m.ticket_id=t.id ORDER BY m.id DESC LIMIT 1), false)`),
    activeTrades: await q("SELECT count(*)::int AS n FROM trades WHERE status IN ('pending','in_progress')"),
    itemsHeld: await q("SELECT count(*)::int AS n FROM inventory WHERE status IN ('held','withdrawing','listed')"),
    fees24: await q(`SELECT ((SELECT COALESCE(sum(fee_cents),0) FROM market_listings WHERE status='sold' AND sold_at > now() - interval '24 hours')
      + (SELECT COALESCE(sum(tax_cents),0) FROM crypto_withdrawals WHERE status<>'rejected' AND created_at > now() - interval '24 hours'))::int AS n`),
    feesAll: await q(`SELECT ((SELECT COALESCE(sum(fee_cents),0) FROM market_listings WHERE status='sold')
      + (SELECT COALESCE(sum(tax_cents),0) FROM crypto_withdrawals WHERE status<>'rejected'))::int AS n`),
    online: (() => { const l = activeVisitors(); return { total: new Set(l.map((v, i) => (v.user_id ? 'u' + v.user_id : 'g' + i))).size, users: new Set(l.filter((v) => v.user_id).map((v) => v.user_id)).size }; })(),
    owners: OWNERS,
    apiEnabled: BOT_KEY.length >= 32,
  });
}));

app.get('/api/admin/users', owner, wrap(async (req, res) => {
  const q = clean(req.query.q, 30);
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.roblox_id, u.avatar_url, u.banned, u.created_at,
       (SELECT count(*)::int FROM market_listings l WHERE l.seller_id=u.id AND l.status='active') AS listings, u.balance_cents,
       (SELECT count(*)::int FROM messages m WHERE m.user_id=u.id) AS messages,
       (SELECT count(*)::int FROM tickets t WHERE t.user_id=u.id) AS tickets,
       (SELECT count(*)::int FROM inventory v WHERE v.user_id=u.id AND v.status IN ('held','withdrawing','listed')) AS items
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

const publicSettings = () => ({ maintenance: settings.maintenance, sale_tax: settings.sale_tax, withdraw_tax: settings.withdraw_tax });
app.get('/api/admin/settings', owner, (req, res) => res.json(publicSettings()));
app.post('/api/admin/settings', owner, wrap(async (req, res) => {
  const save = (k, v) => pool.query("INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [k, JSON.stringify(v)]);
  let changed = false;
  if (typeof req.body.maintenance === 'boolean') {
    await save('maintenance', req.body.maintenance);
    settings.maintenance = req.body.maintenance; changed = true;
    await log(null, req.user.username, req.body.maintenance ? 'site.maintenance_on' : 'site.maintenance_off', null);
  }
  for (const k of ['sale_tax', 'withdraw_tax']) {
    const v = req.body[k];
    if (!v || typeof v !== 'object') continue;
    const pct = Math.round(Math.min(Math.max(Number(v.pct ?? settings[k].pct) || 0, 0), 50) * 100) / 100;
    const next = { on: !!v.on, pct };
    await save(k, next); settings[k] = next; changed = true;
    await log(null, req.user.username, 'site.' + k + (next.on ? '_on' : '_off'), null, { pct });
  }
  if (!changed) throw new Fail(400, 'Nothing to change.');
  res.json(publicSettings());
}));

app.get('/api/admin/market', owner, wrap(async (req, res) => {
  const st = ['active', 'sold', 'cancelled'].includes(req.query.status) ? req.query.status : null;
  const { rows } = await pool.query(
    `SELECT ml.id, ml.price_cents, ml.status, ml.created_at, ml.sold_at, i.name, i.rarity, s.username AS seller, b.username AS buyer
     FROM market_listings ml JOIN items i ON i.id=ml.item_id LEFT JOIN users s ON s.id=ml.seller_id LEFT JOIN users b ON b.id=ml.buyer_id
     WHERE ($1::text IS NULL OR ml.status=$1) ORDER BY ml.id DESC LIMIT 300`, [st]);
  res.json(rows);
}));

app.delete('/api/admin/market/:id', owner, wrap(async (req, res) => {
  res.json(await tx((db) => unlist(db, parseInt(req.params.id, 10), req.user.username, null)));
}));

// Owners add funds or pay people out by hand until a payment provider is connected.
app.post('/api/admin/users/:id/balance', owner, wrap(async (req, res) => {
  const raw = String(req.body.amount || '').trim();
  const neg = raw.startsWith('-');
  const cents = toCents(raw.replace(/^[-+]/, ''));
  const note = clean(req.body.note, 120);
  const out = await tx(async (db) => {
    const t = (await db.query('SELECT id, username FROM users WHERE id=$1 FOR UPDATE', [parseInt(req.params.id, 10)])).rows[0];
    if (!t) throw new Fail(404, 'User not found.');
    const balance = await moveMoney(db, t.id, neg ? -cents : cents, neg ? 'owner_removed' : 'owner_added', note || null).catch((e) => {
      if (e instanceof Fail) throw new Fail(400, t.username + " doesn't have that much balance."); throw e;
    });
    await log(db, req.user.username, 'balance.adjusted', 'user:' + t.username, { amount: (neg ? '-' : '+') + usd(cents), balance: usd(balance), note });
    return { ok: true, balance };
  });
  res.json(out);
}));


// ---------- Items, inventory, trades ----------
app.get('/api/items', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id, name, type, rarity, value, image_url, demand, stability, value_change FROM items WHERE active ORDER BY value DESC, name ASC');
  res.json(rows);
}));

app.get('/api/trading-info', (req, res) => res.json({ open: TRADING_OPEN, market: LISTINGS_OPEN, accounts: MM_ACCOUNTS, rec_per_1k: REC_PER_1K, sale_tax_pct: taxPct('sale_tax'), withdraw_tax_pct: taxPct('withdraw_tax') }));

app.get('/api/inventory', authAny, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT inv.id, inv.status, inv.created_at, i.id AS item_id, i.name, i.type, i.rarity, i.value, i.image_url, i.demand, i.stability, i.value_change,
       ml.id AS listing_id, ml.price_cents
     FROM inventory inv JOIN items i ON i.id=inv.item_id
     LEFT JOIN market_listings ml ON ml.inventory_id=inv.id AND ml.status='active'
     WHERE inv.user_id=$1 AND inv.status IN ('held','withdrawing','listed') ORDER BY i.value DESC, inv.id ASC`, [req.user.id]);
  res.json(rows);
}));

app.get('/api/trades', authAny, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id, kind, status, code, items, note, created_at, updated_at FROM trades WHERE user_id=$1 ORDER BY id DESC LIMIT 30', [req.user.id]);
  res.json(rows);
}));

function tradingGate(req) {
  if (!TRADING_OPEN && !isOwner(req.user)) throw new Fail(503, 'Withdrawals are paused right now.');
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

// Turns whatever name the bot reports into a catalog item: exact name, then the same name ignoring
// case/spaces/apostrophes ("C." = Chroma), then old names (aliases from seed-items.json), then
// without a trailing "(Gun)"/"(Knife)"/"(Rarity)" tag. Returns null when nothing fits.
let nameIndex = null, nameIndexAt = 0;
async function itemIndex(db) {
  if (nameIndex && Date.now() - nameIndexAt < 5 * 60e3) return nameIndex;
  const rows = (await (db || pool).query('SELECT id, name, rarity, active FROM items')).rows;
  const byNorm = new Map();
  for (const r of rows) { const k = normName(r.name); if (!byNorm.has(k)) byNorm.set(k, []); byNorm.get(k).push(r); }
  const aliases = new Map();
  try {
    for (const x of JSON.parse(fs.readFileSync(path.join(__dirname, 'seed-items.json'), 'utf8'))) {
      if (x && x.alias && x.name) aliases.set(normName(x.alias), normName(x.name));
    }
  } catch {}
  nameIndex = { byNorm, aliases }; nameIndexAt = Date.now();
  return nameIndex;
}
async function resolveItem(db, r) {
  if (r.item_id) { const it = (await db.query('SELECT id, name FROM items WHERE id=$1', [parseInt(r.item_id, 10)])).rows[0]; if (it) return it; }
  const raw = clean(r.name, 80);
  if (!raw) return null;
  const exact = (await db.query('SELECT id, name FROM items WHERE lower(name)=lower($1)', [raw])).rows[0];
  if (exact) return exact;
  const idx = await itemIndex(db);
  const rar = (raw.match(/\((Chroma|Ancient|Godly|Unique|Vintage|Legendary|Rare|Uncommon|Common)\)\s*$/i) || [])[1];
  const pick = (list) => {
    if (!list || !list.length) return null;
    const pool2 = rar ? list.filter((x) => x.rarity.toLowerCase() === rar.toLowerCase()) : list;
    const best = (pool2.length ? pool2 : list).slice().sort((a, b) => Number(b.active) - Number(a.active))[0];
    return { id: best.id, name: best.name };
  };
  const n = normName(raw);
  return pick(idx.byNorm.get(n))
    || pick(idx.byNorm.get(idx.aliases.get(n)))
    || pick(idx.byNorm.get(normName(raw.replace(/\s*\([^)]*\)\s*$/, ''))))
    || pick(idx.byNorm.get(normName(raw.replace(/^chroma\s+/i, 'c. '))))
    || null;
}
// Last bot API problems, shown in Owner panel → Bot so failed deposits are never silent.
const botErrors = [];
function botError(where, body, msg) {
  botErrors.unshift({ at: new Date().toISOString(), where, roblox_id: body && body.roblox_id ? String(body.roblox_id).slice(0, 20) : null,
    items: body && Array.isArray(body.received) ? body.received.slice(0, 8).map((x) => (x.qty > 1 ? x.qty + '× ' : '') + String(x.name || x.item_id || '?').slice(0, 40)).join(', ') : null, error: String(msg).slice(0, 200) });
  botErrors.length = Math.min(botErrors.length, 30);
}

// Core state changes, shared by users, owners and the API so the rules are identical everywhere.
async function finishTrade(db, id, actor, outcome, opts = {}) {
  const t = (await db.query('SELECT * FROM trades WHERE id=$1 FOR UPDATE', [id])).rows[0];
  if (!t) throw new Fail(404, 'Trade not found.');
  const allowed = outcome === 'cancelled' ? ['pending'] : ['pending', 'in_progress'];
  if (!allowed.includes(t.status)) throw new Fail(409, 'This trade is already ' + t.status.replace('_', ' ') + '.');
  let detail = { kind: t.kind, user_id: t.user_id };
  if (outcome === 'completed' && t.kind === 'deposit') {
    let got = t.items;
    const unmatched = [];
    if (Array.isArray(opts.received) && opts.received.length) {
      got = [];
      for (const r of opts.received.slice(0, 50)) {
        const qty = Math.min(Math.max(parseInt(r.qty, 10) || 1, 1), 50);
        const item = await resolveItem(db, r);
        // Never throw away a deposit because of one odd name: park it for an owner to match by hand.
        if (!item) { unmatched.push({ name: clean(r.name || String(r.item_id || '?'), 80), qty }); continue; }
        const same = got.find((g) => g.item_id === item.id);
        if (same) same.qty += qty; else got.push({ item_id: item.id, name: item.name, qty });
      }
    }
    for (const u of unmatched) await db.query('INSERT INTO deposit_unmatched (user_id, trade_id, raw_name, qty) VALUES ($1,$2,$3,$4)', [t.user_id, t.id, u.name, u.qty]);
    if (unmatched.length) detail.unmatched = unmatched;
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
  botSeen = Date.now();
  next();
}

// ---------- Deposit bot shown on the site (Item Deposit window) ----------
// Change these with BOT_USERNAME, BOT_USER_ID and BOT_SERVER_LINK in Railway.
const BOT = {
  username: clean(process.env.BOT_USERNAME || 'qwrfcve', 30),
  id: String(process.env.BOT_USER_ID || '11576939663').replace(/\D/g, ''),
  link: process.env.BOT_SERVER_LINK || 'https://www.roblox.com/share?code=77982f0c08628c4ab598d523da6fd62c&type=Server',
};
if (!/^https:\/\/(www\.)?roblox\.com\//.test(BOT.link)) BOT.link = 'https://www.roblox.com/users/' + BOT.id + '/profile';
let botSeen = 0, botAvatar = null, botAvatarAt = 0;
async function botView() {
  if (Date.now() - botAvatarAt > 3600e3) {
    botAvatarAt = Date.now();
    try {
      const t = await rbx('https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=' + BOT.id + '&size=150x150&format=Png&isCircular=false');
      const u = (t.data && t.data[0] && t.data[0].imageUrl) || '';
      if (/^https:\/\/[\w.-]+\.rbxcdn\.com\//.test(u)) botAvatar = u;
    } catch { botAvatarAt = Date.now() - 3540e3; }
  }
  // Online = the bot program has talked to the API in the last 3 minutes.
  return { username: BOT.username, id: BOT.id, link: BOT.link, profile: 'https://www.roblox.com/users/' + BOT.id + '/profile', avatar: botAvatar, online: Date.now() - botSeen < 180e3 };
}
app.get('/api/bots', wrap(async (req, res) => res.json([await botView()])));

// Bot keeps itself marked Online on the site.
app.post('/api/bot/heartbeat', botAuth, (req, res) => res.json({ ok: true }));
// Bot checks a player before trading them.
app.get('/api/bot/users/:robloxId', botAuth, wrap(async (req, res) => {
  const u = (await pool.query('SELECT id, username, banned FROM users WHERE roblox_id=$1', [String(req.params.robloxId).replace(/\D/g, '') || '0'])).rows[0];
  if (!u) return res.json({ registered: false });
  const open = (await pool.query(
    `SELECT t.*, u.username, u.roblox_id FROM trades t JOIN users u ON u.id=t.user_id
     WHERE t.user_id=$1 AND t.status IN ('pending','in_progress') ORDER BY t.id`, [u.id])).rows;
  res.json({ registered: true, banned: u.banned, username: u.username, withdrawals: open.filter((t) => t.kind === 'withdraw').map(tradeView), deposits: open.filter((t) => t.kind === 'deposit').map(tradeView) });
}));
// Bot reports what it actually holds in game, so owners can compare it with what the site expects.
app.post('/api/bot/inventory', botAuth, wrap(async (req, res) => {
  const list = Array.isArray(req.body.items) ? req.body.items.slice(0, 2000) : null;
  if (!list) throw new Fail(400, 'items must be a list like [{ "name": "Harvester", "qty": 3 }].');
  const merged = new Map();
  for (const r of list) {
    const name = clean(r.name, 60); const qty = Math.max(0, Math.min(parseInt(r.qty, 10) || 1, 100000));
    if (name && qty) merged.set(name.toLowerCase(), { name: merged.get(name.toLowerCase())?.name || name, qty: (merged.get(name.toLowerCase())?.qty || 0) + qty });
  }
  const stock = { at: new Date().toISOString(), by: req.actor, items: [...merged.values()] };
  await pool.query("INSERT INTO settings (key, value) VALUES ('bot_stock', $1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [JSON.stringify(stock)]);
  res.json({ ok: true, kinds: stock.items.length, units: stock.items.reduce((a, i) => a + i.qty, 0) });
}));
// Bot finished a deposit trade in game: add the items to the player's inventory.
app.post('/api/bot/deposits', botAuth, wrap(async (req, res, next) => {
  const rid = String(req.body.roblox_id || '').replace(/\D/g, '');
  const received = Array.isArray(req.body.received) ? req.body.received : [];
  try {
  if (!rid) throw new Fail(400, 'roblox_id is required.');
  if (!received.length) throw new Fail(400, 'received must list the items you got.');
  const out = await tx(async (db) => {
    const u = (await db.query('SELECT id, username, banned FROM users WHERE roblox_id=$1', [rid])).rows[0];
    if (!u) throw new Fail(404, 'That player has no SplitzMarket account. Ask them to log in on the site first.');
    if (u.banned) throw new Fail(403, 'That player is banned.');
    const t = (await db.query("INSERT INTO trades (user_id, kind, code, items, status, handled_by) VALUES ($1,'deposit',$2,'[]','in_progress',$3) RETURNING id", [u.id, makeTradeCode(), req.actor])).rows[0];
    await finishTrade(db, t.id, req.actor, 'completed', { received, note: req.body.note });
    const got = (await db.query('SELECT items FROM trades WHERE id=$1', [t.id])).rows[0].items;
    const um = (await db.query('SELECT raw_name AS name, qty FROM deposit_unmatched WHERE trade_id=$1', [t.id])).rows;
    if (um.length) botError('deposit (some items need matching)', { roblox_id: rid, received: um }, um.length + ' item name(s) not in the catalog; waiting in Owner panel → Bot');
    return { ok: true, trade_id: t.id, username: u.username, items: got, unmatched: um };
  });
  res.json(out);
  } catch (e) { botError('deposit', req.body, e.message); throw e; }
}));

const tradeView = (t) => ({ id: t.id, kind: t.kind, status: t.status, code: t.code, items: t.items, roblox_id: t.roblox_id ? String(t.roblox_id) : null, roblox_username: t.username, handled_by: t.handled_by, created_at: t.created_at });

app.get('/api/bot/trades', botAuth, wrap(async (req, res) => {
  const status = ['pending', 'in_progress'].includes(req.query.status) ? [req.query.status] : ['pending', 'in_progress'];
  const { rows } = await pool.query(
    `SELECT t.*, u.username, u.roblox_id FROM trades t JOIN users u ON u.id=t.user_id
     WHERE t.status = ANY($1) ORDER BY t.id ASC LIMIT 100`, [status]);
  res.json(rows.map(tradeView));
}));

app.post('/api/bot/trades/:id/claim', botAuth, wrap(async (req, res) => res.json(await tx((db) => claimTrade(db, parseInt(req.params.id, 10), req.actor)))));
app.post('/api/bot/trades/:id/complete', botAuth, wrap(async (req, res) => {
  try { res.json(await tx((db) => finishTrade(db, parseInt(req.params.id, 10), req.actor, 'completed', { received: req.body.received, note: req.body.note }))); }
  catch (e) { botError('trade #' + req.params.id + ' complete', req.body, e.message); throw e; }
}));
app.post('/api/bot/trades/:id/fail', botAuth, wrap(async (req, res) => res.json(await tx((db) => finishTrade(db, parseInt(req.params.id, 10), req.actor, 'failed', { note: req.body.reason })))));

// ---------- Live visitors (owners see who is on the site right now) ----------
// Every open tab checks in every 20s with a random tab id, logged in or not. Kept in memory only.
const visitors = new Map(); // sid -> { user_id, username, avatar, page, device, hidden, first, at }
let visitorPeak = { n: 0, at: null, day: new Date().toDateString() };
const deviceOf = (ua) => /iPad|Tablet/i.test(ua) ? 'Tablet' : /Mobi|Android|iPhone/i.test(ua) ? 'Phone' : 'Computer';
app.post('/api/presence', wrap(async (req, res) => {
  const sid = String(req.body.sid || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
  if (sid.length < 8) return res.json({ ok: false });
  // Leaving a page: expire soon unless the next page checks in (keeps "on site since" across page changes).
  if (req.body.leave) { const v = visitors.get(sid); if (v) v.at = Math.min(v.at, Date.now() - 50e3); return res.json({ ok: true }); }
  if (!limit('pr' + sid, 4000)) return res.json({ ok: true });
  if (!visitors.has(sid) && visitors.size >= 5000) return res.json({ ok: false });
  const u = await currentUser(req);
  const prev = visitors.get(sid);
  visitors.set(sid, {
    user_id: u ? u.id : null, username: u ? u.username : null, avatar: u ? u.avatar_url : null, owner: u ? isOwner(u) : false,
    page: clean(String(req.body.page || '/'), 60) || '/', device: deviceOf(String(req.headers['user-agent'] || '')),
    hidden: !!req.body.hidden, first: prev ? prev.first : Date.now(), at: Date.now(),
  });
  res.json({ ok: true });
}));
function activeVisitors() {
  const cut = Date.now() - 60e3;
  for (const [k, v] of visitors) if (v.at < cut) visitors.delete(k);
  const list = [...visitors.values()];
  const today = new Date().toDateString();
  if (visitorPeak.day !== today) visitorPeak = { n: 0, at: null, day: today };
  const people = new Set(list.map((v, i) => (v.user_id ? 'u' + v.user_id : 'g' + i))).size;
  if (people > visitorPeak.n) visitorPeak = { n: people, at: new Date().toISOString(), day: today };
  return list;
}
setInterval(activeVisitors, 30e3);
app.get('/api/admin/active', owner, (req, res) => {
  const list = activeVisitors();
  // One row per logged-in person (all their tabs together), one row per guest tab.
  const users = new Map(), guests = [];
  list.forEach((v) => {
    if (v.user_id) {
      const x = users.get(v.user_id) || { username: v.username, avatar: v.avatar, owner: v.owner, pages: [], devices: new Set(), tabs: 0, first: v.first, at: 0, hidden: true };
      x.pages.push(v.page); x.devices.add(v.device); x.tabs++; x.first = Math.min(x.first, v.first); x.at = Math.max(x.at, v.at); x.hidden = x.hidden && v.hidden;
      users.set(v.user_id, x);
    } else guests.push({ page: v.page, device: v.device, first: v.first, at: v.at, hidden: v.hidden });
  });
  const pages = {};
  list.forEach((v) => (pages[v.page] = (pages[v.page] || 0) + 1));
  res.json({
    users: [...users.values()].map((x) => ({ ...x, devices: [...x.devices], pages: [...new Set(x.pages)] })).sort((a, b) => a.first - b.first),
    guests: guests.sort((a, b) => a.first - b.first), pages, peak: visitorPeak, now: Date.now(),
  });
});

// ---------- Balance codes (sold on SellAuth, redeemed here) ----------
const CODES_URL = /^https:\/\//.test(process.env.CODES_URL || '') ? process.env.CODES_URL : 'https://splitzmarket.mysellauth.com/';
const CODE_CHARS2 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeBalanceCode = () => 'SPLITZ-' + [0, 1, 2].map(() => Array.from({ length: 4 }, () => CODE_CHARS2[crypto.randomInt(CODE_CHARS2.length)]).join('')).join('-');
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^SPLITZ/, '');
const fmtCode = (n) => 'SPLITZ-' + n.slice(0, 4) + '-' + n.slice(4, 8) + '-' + n.slice(8, 12);
const codeFails = new Map(); // user id or ip -> { n, at }
function codeLocked(key) { const f = codeFails.get(key); return f && f.n >= 8 && Date.now() - f.at < 30 * 60e3; }
function codeFail(key) { const f = codeFails.get(key); const fresh = !f || Date.now() - f.at > 30 * 60e3; codeFails.set(key, { n: fresh ? 1 : f.n + 1, at: Date.now() }); }

app.post('/api/codes/redeem', auth, wrap(async (req, res) => {
  if (!req.user.roblox_id) throw new Fail(400, 'Log in with Roblox first.');
  const keys = ['u' + req.user.id, 'ip' + req.ip];
  if (keys.some(codeLocked)) throw new Fail(429, 'Too many wrong codes. Try again in 30 minutes, or open a support ticket.');
  if (!limit('rc' + req.user.id, 1500)) throw new Fail(429, 'Slow down a little.');
  const n = normCode(req.body.code);
  if (n.length !== 12) { keys.forEach(codeFail); throw new Fail(400, 'That doesn\'t look like a SplitzMarket code. It should look like SPLITZ-XXXX-XXXX-XXXX.'); }
  const code = fmtCode(n);
  const out = await tx(async (db) => {
    const c = (await db.query('SELECT * FROM balance_codes WHERE code=$1 FOR UPDATE', [code])).rows[0];
    if (!c || c.disabled) { keys.forEach(codeFail); throw new Fail(400, 'That code is not valid. Check it and try again.'); }
    if (c.redeemed_by) throw new Fail(400, c.redeemed_by === req.user.id ? 'You already redeemed this code.' : 'This code was already used.');
    await db.query('UPDATE balance_codes SET redeemed_by=$1, redeemed_at=now() WHERE id=$2', [req.user.id, c.id]);
    await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [req.user.id]);
    // Like crypto deposits, code money is spent on items before it can be withdrawn.
    const balance = await moveMoney(db, req.user.id, c.amount_cents, 'code_redeemed', code.slice(0, 12) + '…', c.amount_cents);
    await log(db, req.user.username, 'code.redeemed', 'code:' + c.id, { amount: usd(c.amount_cents), batch: c.batch });
    return { ok: true, amount_cents: c.amount_cents, balance };
  });
  res.json(out);
}));

app.get('/api/admin/codes', owner, wrap(async (req, res) => {
  const summary = (await pool.query(`SELECT amount_cents, count(*)::int AS total,
      count(*) FILTER (WHERE redeemed_by IS NULL AND NOT disabled)::int AS unused,
      count(*) FILTER (WHERE redeemed_by IS NOT NULL)::int AS redeemed,
      count(*) FILTER (WHERE disabled AND redeemed_by IS NULL)::int AS disabled
    FROM balance_codes GROUP BY amount_cents ORDER BY amount_cents`)).rows;
  const recent = (await pool.query(`SELECT c.id, c.code, c.amount_cents, c.redeemed_at, u.username FROM balance_codes c LEFT JOIN users u ON u.id=c.redeemed_by
    WHERE c.redeemed_by IS NOT NULL ORDER BY c.redeemed_at DESC LIMIT 30`)).rows;
  const redeemed = (await pool.query('SELECT COALESCE(sum(amount_cents),0)::int AS c FROM balance_codes WHERE redeemed_by IS NOT NULL')).rows[0].c;
  res.json({ summary, recent, redeemed_cents: redeemed, url: CODES_URL });
}));
app.post('/api/admin/codes', owner, wrap(async (req, res) => {
  const amounts = [...new Set((Array.isArray(req.body.amounts) ? req.body.amounts : []).map((a) => Math.round(parseFloat(String(a).replace(/^\$/, '')) * 100)).filter((c) => c >= 100 && c <= 100000))].slice(0, 10);
  const count = Math.min(Math.max(parseInt(req.body.count, 10) || 0, 1), 500);
  if (!amounts.length) throw new Fail(400, 'Add at least one amount between $1 and $1,000.');
  const batch = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const out = await tx(async (db) => {
    const made = {};
    for (const a of amounts) {
      made[a] = [];
      while (made[a].length < count) {
        const code = makeBalanceCode();
        const r = await db.query('INSERT INTO balance_codes (code, amount_cents, batch, created_by) VALUES ($1,$2,$3,$4) ON CONFLICT (code) DO NOTHING RETURNING code', [code, a, batch, req.user.username]);
        if (r.rowCount) made[a].push(code);
      }
    }
    await log(db, req.user.username, 'codes.created', null, { amounts: amounts.map(usd), count, batch });
    return made;
  });
  res.json({ ok: true, batch, codes: out });
}));
// Download unused codes for one amount as a text file, one per line (ready to paste into SellAuth).
app.get('/api/admin/codes/export', owner, wrap(async (req, res) => {
  const a = parseInt(req.query.amount, 10);
  const rows = (await pool.query('SELECT code FROM balance_codes WHERE amount_cents=$1 AND redeemed_by IS NULL AND NOT disabled ORDER BY id', [a])).rows;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="splitz-codes-' + (a / 100) + 'usd.txt"');
  res.send(rows.map((r) => r.code).join('\n') + (rows.length ? '\n' : ''));
}));
app.post('/api/admin/codes/disable', owner, wrap(async (req, res) => {
  const n = normCode(req.body.code);
  if (n.length !== 12) throw new Fail(400, 'Paste the full code.');
  const r = await pool.query('UPDATE balance_codes SET disabled=true WHERE code=$1 AND redeemed_by IS NULL RETURNING amount_cents', [fmtCode(n)]);
  if (!r.rowCount) throw new Fail(404, 'No unused code like that.');
  await log(null, req.user.username, 'code.disabled', fmtCode(n).slice(0, 12) + '…');
  res.json({ ok: true });
}));

// ---------- Giveaways ----------
// Owners put one of their own held items up. Anyone logged in with Roblox can join once, for free.
// When time runs out a winner is picked at random (every entry has the same chance) and the item moves to them.
const GIVE_SELECT = `SELECT g.id, g.status, g.ends_at, g.created_at, g.ended_at, g.entries_at_draw,
    i.id AS item_id, i.name, i.rarity, i.type, i.value, i.image_url, i.demand, i.stability, i.value_change,
    h.username AS host, w.username AS winner, w.avatar_url AS winner_avatar,
    (SELECT count(*)::int FROM giveaway_entries e WHERE e.giveaway_id=g.id) AS entries
  FROM giveaways g JOIN items i ON i.id=g.item_id LEFT JOIN users h ON h.id=g.host_id LEFT JOIN users w ON w.id=g.winner_id`;
async function drawGiveaway(db, id, actor) {
  const g = (await db.query('SELECT * FROM giveaways WHERE id=$1 FOR UPDATE', [id])).rows[0];
  if (!g) throw new Fail(404, 'Giveaway not found.');
  if (g.status !== 'active') throw new Fail(409, 'This giveaway already ended.');
  const entrants = (await db.query(
    `SELECT e.user_id, u.username FROM giveaway_entries e JOIN users u ON u.id=e.user_id
     WHERE e.giveaway_id=$1 AND NOT u.banned ORDER BY e.user_id`, [id])).rows;
  const item = (await db.query('SELECT name FROM items WHERE id=$1', [g.item_id])).rows[0];
  if (!entrants.length) {
    await db.query("UPDATE inventory SET status='held' WHERE id=$1 AND status='giveaway'", [g.inventory_id]);
    await db.query("UPDATE giveaways SET status='ended', entries_at_draw=0, ended_at=now() WHERE id=$1", [id]);
    await log(db, actor, 'giveaway.no_entries', 'giveaway:' + id, { item: item.name });
    return { ok: true, winner: null };
  }
  const win = entrants[crypto.randomInt(entrants.length)];
  await db.query("UPDATE inventory SET user_id=$1, status='held' WHERE id=$2 AND status='giveaway'", [win.user_id, g.inventory_id]);
  await db.query("UPDATE giveaways SET status='ended', winner_id=$1, entries_at_draw=$2, ended_at=now() WHERE id=$3", [win.user_id, entrants.length, id]);
  await log(db, actor, 'giveaway.won', 'giveaway:' + id, { item: item.name, winner: win.username, entries: entrants.length });
  return { ok: true, winner: win.username, item: item.name, entries: entrants.length };
}
// Draw every giveaway whose time is up.
setInterval(async () => {
  try {
    const due = (await pool.query("SELECT id FROM giveaways WHERE status='active' AND ends_at <= now() ORDER BY id")).rows;
    for (const g of due) await tx((db) => drawGiveaway(db, g.id, 'timer')).catch((e) => { if (!(e instanceof Fail)) console.error('giveaway draw', e.message); });
  } catch {}
}, 3000);

app.get('/api/giveaways', wrap(async (req, res) => {
  const u = await currentUser(req);
  const active = (await pool.query(`${GIVE_SELECT} WHERE g.status='active' ORDER BY g.ends_at ASC`)).rows;
  const ended = (await pool.query(`${GIVE_SELECT} WHERE g.status='ended' ORDER BY g.ended_at DESC LIMIT 12`)).rows;
  let mine = new Set();
  if (u && active.length) mine = new Set((await pool.query('SELECT giveaway_id FROM giveaway_entries WHERE user_id=$1 AND giveaway_id = ANY($2)', [u.id, active.map((g) => g.id)])).rows.map((r) => r.giveaway_id));
  res.json({ now: new Date().toISOString(), active: active.map((g) => ({ ...g, joined: mine.has(g.id) })), ended, rec_per_1k: REC_PER_1K });
}));
// Latest win, for the "Yooo ___ just won a ___" pop-up on every page.
app.get('/api/giveaways/latest', wrap(async (req, res) => {
  const g = (await pool.query(`${GIVE_SELECT} WHERE g.status='ended' AND g.winner_id IS NOT NULL AND g.ended_at > now() - interval '10 minutes' ORDER BY g.ended_at DESC LIMIT 1`)).rows[0];
  res.json(g ? { id: g.id, winner: g.winner, name: g.name, rarity: g.rarity, image_url: g.image_url, entries: g.entries_at_draw } : null);
}));
app.post('/api/giveaways/:id/join', auth, wrap(async (req, res) => {
  if (!req.user.roblox_id) throw new Fail(400, 'Log in with Roblox to join.');
  if (!limit('gj' + req.user.id, 1000)) throw new Fail(429, 'Slow down a little.');
  const id = parseInt(req.params.id, 10);
  const g = (await pool.query('SELECT id, status, ends_at, host_id FROM giveaways WHERE id=$1', [id])).rows[0];
  if (!g || g.status !== 'active' || new Date(g.ends_at) <= new Date()) throw new Fail(409, 'This giveaway already ended.');
  if (g.host_id === req.user.id) throw new Fail(400, "You can't join your own giveaway.");
  await pool.query('INSERT INTO giveaway_entries (giveaway_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, req.user.id]);
  const n = (await pool.query('SELECT count(*)::int AS n FROM giveaway_entries WHERE giveaway_id=$1', [id])).rows[0].n;
  res.json({ ok: true, entries: n });
}));

app.get('/api/admin/giveaways', owner, wrap(async (req, res) => {
  const rows = (await pool.query(`${GIVE_SELECT} ORDER BY (g.status='active') DESC, g.id DESC LIMIT 50`)).rows;
  const items = (await pool.query(
    `SELECT inv.id, i.name, i.rarity, i.type, i.value, i.image_url FROM inventory inv JOIN items i ON i.id=inv.item_id
     WHERE inv.user_id=$1 AND inv.status='held' ORDER BY i.value DESC, i.name`, [req.user.id])).rows;
  res.json({ giveaways: rows, items });
}));
app.post('/api/admin/giveaways', owner, wrap(async (req, res) => {
  const ids = [...new Set((Array.isArray(req.body.inventory_ids) ? req.body.inventory_ids : [req.body.inventory_id]).map((x) => parseInt(x, 10)).filter((x) => x > 0))].slice(0, 20);
  const minutes = Math.round(parseFloat(req.body.minutes));
  if (!ids.length) throw new Fail(400, 'Pick an item from your inventory.');
  if (!(minutes >= 1 && minutes <= 60 * 24 * 14)) throw new Fail(400, 'Pick a length between 1 minute and 14 days.');
  const out = await tx(async (db) => {
    const rows = (await db.query(
      `SELECT inv.id, inv.item_id, i.name FROM inventory inv JOIN items i ON i.id=inv.item_id
       WHERE inv.id = ANY($1) AND inv.user_id=$2 AND inv.status='held' FOR UPDATE OF inv`, [ids, req.user.id])).rows;
    if (rows.length !== ids.length) throw new Fail(400, 'Some of those items are not in your inventory anymore. Refresh and try again.');
    const made = [];
    for (const r of rows) {
      await db.query("UPDATE inventory SET status='giveaway' WHERE id=$1", [r.id]);
      const g = (await db.query("INSERT INTO giveaways (inventory_id, item_id, host_id, ends_at) VALUES ($1,$2,$3, now() + ($4 || ' minutes')::interval) RETURNING id", [r.id, r.item_id, req.user.id, String(minutes)])).rows[0];
      await log(db, req.user.username, 'giveaway.created', 'giveaway:' + g.id, { item: r.name, minutes });
      made.push(g.id);
    }
    return { ok: true, created: made.length };
  });
  res.json(out);
}));
app.post('/api/admin/giveaways/:id/draw', owner, wrap(async (req, res) => res.json(await tx((db) => drawGiveaway(db, parseInt(req.params.id, 10), req.user.username)))));
app.post('/api/admin/giveaways/:id/cancel', owner, wrap(async (req, res) => {
  const out = await tx(async (db) => {
    const g = (await db.query('SELECT * FROM giveaways WHERE id=$1 FOR UPDATE', [parseInt(req.params.id, 10)])).rows[0];
    if (!g) throw new Fail(404, 'Giveaway not found.');
    if (g.status !== 'active') throw new Fail(409, 'This giveaway already ended.');
    await db.query("UPDATE inventory SET status='held' WHERE id=$1 AND status='giveaway'", [g.inventory_id]);
    await db.query("UPDATE giveaways SET status='cancelled', ended_at=now() WHERE id=$1", [g.id]);
    await log(db, req.user.username, 'giveaway.cancelled', 'giveaway:' + g.id);
    return { ok: true };
  });
  res.json(out);
}));

// ---------- Owner: analytics and fee collection ----------
async function uncollected(db) {
  const r = (await db.query(`SELECT
    (SELECT COALESCE(sum(fee_cents),0)::int FROM market_listings WHERE status='sold' AND fee_cents>0 AND collected_id IS NULL) AS sales,
    (SELECT count(*)::int FROM market_listings WHERE status='sold' AND fee_cents>0 AND collected_id IS NULL) AS sales_n,
    (SELECT COALESCE(sum(tax_cents),0)::int FROM crypto_withdrawals WHERE status='paid' AND tax_cents>0 AND collected_id IS NULL) AS wd,
    (SELECT count(*)::int FROM crypto_withdrawals WHERE status='paid' AND tax_cents>0 AND collected_id IS NULL) AS wd_n,
    (SELECT COALESCE(sum(tax_cents),0)::int FROM crypto_withdrawals WHERE status='pending' AND tax_cents>0) AS wd_pending`)).rows[0];
  return { ...r, total: r.sales + r.wd };
}
app.get('/api/admin/analytics', owner, wrap(async (req, res) => {
  const period = async (iv) => {
    const w = (col) => (iv ? `AND ${col} > now() - interval '${iv}'` : '');
    return (await pool.query(`SELECT
      (SELECT COALESCE(sum(price_cents),0)::int FROM market_listings WHERE status='sold' ${w('sold_at')}) AS sales_cents,
      (SELECT count(*)::int FROM market_listings WHERE status='sold' ${w('sold_at')}) AS sales_n,
      (SELECT COALESCE(sum(fee_cents),0)::int FROM market_listings WHERE status='sold' ${w('sold_at')}) AS sale_fees,
      (SELECT COALESCE(sum(usd_cents),0)::int FROM crypto_deposits WHERE status='credited' ${w('credited_at')}) AS dep_cents,
      (SELECT count(*)::int FROM crypto_deposits WHERE status='credited' ${w('credited_at')}) AS dep_n,
      (SELECT COALESCE(sum(usd_cents),0)::int FROM crypto_withdrawals WHERE status='paid' ${w('updated_at')}) AS wd_cents,
      (SELECT count(*)::int FROM crypto_withdrawals WHERE status='paid' ${w('updated_at')}) AS wd_n,
      (SELECT COALESCE(sum(tax_cents),0)::int FROM crypto_withdrawals WHERE status='paid' ${w('updated_at')}) AS wd_fees,
      (SELECT COALESCE(sum(delta_cents),0)::int FROM balance_log WHERE reason='owner_added' ${w('created_at')}) AS added_cents,
      (SELECT COALESCE(sum(amount_cents),0)::int FROM balance_codes WHERE redeemed_by IS NOT NULL ${w('redeemed_at')}) AS code_cents,
      (SELECT count(*)::int FROM balance_codes WHERE redeemed_by IS NOT NULL ${w('redeemed_at')}) AS code_n,
      (SELECT count(*)::int FROM trades WHERE kind='deposit' AND status='completed' ${w('updated_at')}) AS item_dep,
      (SELECT count(*)::int FROM trades WHERE kind='withdraw' AND status='completed' ${w('updated_at')}) AS item_wd,
      (SELECT count(*)::int FROM users WHERE true ${w('created_at')}) AS new_users,
      (SELECT count(DISTINCT buyer_id)::int FROM market_listings WHERE status='sold' ${w('sold_at')}) AS buyers`)).rows[0];
  };
  const [day, week, month, all] = await Promise.all([period('1 day'), period('7 days'), period('30 days'), period(null)]);
  const daily = (await pool.query(`
    SELECT to_char(d, 'YYYY-MM-DD') AS day,
      COALESCE((SELECT sum(price_cents) FROM market_listings WHERE status='sold' AND sold_at >= d AND sold_at < d + interval '1 day'),0)::int AS sales_cents,
      COALESCE((SELECT count(*) FROM market_listings WHERE status='sold' AND sold_at >= d AND sold_at < d + interval '1 day'),0)::int AS sales_n,
      (COALESCE((SELECT sum(fee_cents) FROM market_listings WHERE status='sold' AND sold_at >= d AND sold_at < d + interval '1 day'),0)
       + COALESCE((SELECT sum(tax_cents) FROM crypto_withdrawals WHERE status='paid' AND updated_at >= d AND updated_at < d + interval '1 day'),0))::int AS fees
    FROM generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') d ORDER BY d`)).rows;
  const top = (await pool.query(`SELECT i.name, i.rarity, i.image_url, count(*)::int AS n, sum(ml.price_cents)::int AS cents
    FROM market_listings ml JOIN items i ON i.id=ml.item_id WHERE ml.status='sold' AND ml.sold_at > now() - interval '30 days'
    GROUP BY i.id ORDER BY cents DESC LIMIT 8`)).rows;
  const owed = await uncollected(pool);
  const collections = (await pool.query('SELECT * FROM tax_collections ORDER BY id DESC LIMIT 20')).rows;
  res.json({ day, week, month, all, daily, top, owed, collections, sale_tax: settings.sale_tax, withdraw_tax: settings.withdraw_tax });
}));
// Owner pressed "Tax collected": mark every uncollected fee as collected and start counting from zero.
app.post('/api/admin/analytics/collect', owner, wrap(async (req, res) => {
  const out = await tx(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['tax_collect']);
    const o = await uncollected(db);
    if (!o.total) throw new Fail(400, 'Nothing to collect yet.');
    const c = (await db.query('INSERT INTO tax_collections (amount_cents, sales_cents, withdraw_cents, collected_by) VALUES ($1,$2,$3,$4) RETURNING *', [o.total, o.sales, o.wd, req.user.username])).rows[0];
    await db.query("UPDATE market_listings SET collected_id=$1 WHERE status='sold' AND fee_cents>0 AND collected_id IS NULL", [c.id]);
    await db.query("UPDATE crypto_withdrawals SET collected_id=$1 WHERE status='paid' AND tax_cents>0 AND collected_id IS NULL", [c.id]);
    await log(db, req.user.username, 'tax.collected', 'collection:' + c.id, { amount: usd(o.total), sales: usd(o.sales), withdrawals: usd(o.wd) });
    return c;
  });
  res.json(out);
}));

// ---------- Owner: bot info ----------
app.get('/api/admin/bot', owner, wrap(async (req, res) => {
  const bot = await botView();
  // What the bot should be holding: every real deposited item still on the site.
  const expected = (await pool.query(
    `SELECT i.id AS item_id, i.name, i.rarity, i.type, i.value, i.image_url,
       count(*)::int AS qty,
       count(*) FILTER (WHERE inv.status='held')::int AS held,
       count(*) FILTER (WHERE inv.status='listed')::int AS listed,
       count(*) FILTER (WHERE inv.status='withdrawing')::int AS withdrawing,
       count(*) FILTER (WHERE inv.status='giveaway')::int AS giveaway
     FROM inventory inv JOIN items i ON i.id=inv.item_id
     WHERE inv.status IN ('held','listed','withdrawing','giveaway') AND inv.added_by IS NULL
     GROUP BY i.id ORDER BY i.value DESC, i.name`)).rows;
  const test = (await pool.query("SELECT count(*)::int AS n FROM inventory WHERE status IN ('held','listed','withdrawing') AND added_by IS NOT NULL")).rows[0].n;
  const stock = (await pool.query("SELECT value FROM settings WHERE key='bot_stock'")).rows[0]?.value || null;
  const queue = (await pool.query(
    `SELECT t.id, t.status, t.items, t.created_at, u.username, u.roblox_id FROM trades t LEFT JOIN users u ON u.id=t.user_id
     WHERE t.kind='withdraw' AND t.status IN ('pending','in_progress') ORDER BY t.id`)).rows.map((t) => ({ ...t, roblox_id: t.roblox_id ? String(t.roblox_id) : null }));
  const recent = (await pool.query(
    `SELECT t.id, t.kind, t.status, t.items, t.handled_by, t.updated_at, u.username FROM trades t LEFT JOIN users u ON u.id=t.user_id
     WHERE t.handled_by LIKE 'api:%' ORDER BY t.updated_at DESC LIMIT 25`)).rows;
  const day = (await pool.query(
    `SELECT count(*) FILTER (WHERE kind='deposit')::int AS deposits, count(*) FILTER (WHERE kind='withdraw')::int AS withdrawals
     FROM trades WHERE status='completed' AND updated_at > now() - interval '24 hours'`)).rows[0];
  res.json({ bot, api_enabled: BOT_KEY.length >= 32, last_seen: botSeen ? new Date(botSeen).toISOString() : null, expected, test_items: test, stock, queue, recent, day, rec_per_1k: REC_PER_1K });
}));

// ---------- Owner: deposited items whose names didn't match the catalog ----------
app.get('/api/admin/unmatched', owner, wrap(async (req, res) => {
  const rows = (await pool.query(`SELECT d.*, u.username, i.name AS item_name FROM deposit_unmatched d LEFT JOIN users u ON u.id=d.user_id LEFT JOIN items i ON i.id=d.item_id
    ORDER BY (d.status='open') DESC, d.id DESC LIMIT 60`)).rows;
  res.json({ rows, errors: botErrors });
}));
app.post('/api/admin/unmatched/:id/:action', owner, wrap(async (req, res) => {
  const out = await tx(async (db) => {
    const d = (await db.query('SELECT * FROM deposit_unmatched WHERE id=$1 FOR UPDATE', [parseInt(req.params.id, 10)])).rows[0];
    if (!d) throw new Fail(404, 'Not found.');
    if (d.status !== 'open') throw new Fail(409, 'Already handled.');
    if (req.params.action === 'dismiss') {
      await db.query("UPDATE deposit_unmatched SET status='dismissed', handled_by=$1, handled_at=now() WHERE id=$2", [req.user.username, d.id]);
      await log(db, req.user.username, 'deposit.unmatched_dismissed', 'unmatched:' + d.id, { name: d.raw_name });
      return { ok: true };
    }
    if (req.params.action !== 'assign') throw new Fail(400, 'Unknown action.');
    const item = (await db.query('SELECT id, name FROM items WHERE id=$1', [parseInt(req.body.item_id, 10)])).rows[0];
    if (!item) throw new Fail(400, 'Pick the catalog item it should be.');
    if (!d.user_id) throw new Fail(400, 'That player account no longer exists.');
    for (let k = 0; k < d.qty; k++) await db.query('INSERT INTO inventory (user_id, item_id, deposit_trade_id) VALUES ($1,$2,$3)', [d.user_id, item.id, d.trade_id]);
    await db.query("UPDATE deposit_unmatched SET status='assigned', item_id=$1, handled_by=$2, handled_at=now() WHERE id=$3", [item.id, req.user.username, d.id]);
    await log(db, req.user.username, 'deposit.unmatched_assigned', 'unmatched:' + d.id, { name: d.raw_name, item: item.name, qty: d.qty });
    return { ok: true, item: item.name, qty: d.qty };
  });
  res.json(out);
}));

// ---------- Owner: edit someone's inventory (testing and fixes) ----------
app.get('/api/admin/users/:id/inventory', owner, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT inv.id, inv.status, inv.added_by, inv.created_at, i.id AS item_id, i.name, i.rarity, i.type, i.value, i.image_url
     FROM inventory inv JOIN items i ON i.id=inv.item_id
     WHERE inv.user_id=$1 AND inv.status IN ('held','listed','withdrawing') ORDER BY i.value DESC, inv.id`, [parseInt(req.params.id, 10)]);
  res.json(rows);
}));
app.post('/api/admin/users/:id/inventory', owner, wrap(async (req, res) => {
  const itemId = parseInt(req.body.item_id, 10), qty = Math.min(Math.max(parseInt(req.body.qty, 10) || 1, 1), 50);
  const note = clean(req.body.note, 120);
  const out = await tx(async (db) => {
    const u = (await db.query('SELECT id, username FROM users WHERE id=$1', [parseInt(req.params.id, 10)])).rows[0];
    if (!u) throw new Fail(404, 'User not found.');
    const item = (await db.query('SELECT id, name FROM items WHERE id=$1', [itemId])).rows[0];
    if (!item) throw new Fail(400, 'Pick an item.');
    for (let k = 0; k < qty; k++) await db.query('INSERT INTO inventory (user_id, item_id, added_by) VALUES ($1,$2,$3)', [u.id, item.id, req.user.username]);
    await log(db, req.user.username, 'inventory.owner_added', 'user:' + u.username, { item: item.name, qty, note: note || null });
    return { ok: true, added: qty, item: item.name, username: u.username };
  });
  res.json(out);
}));
app.delete('/api/admin/inventory/:id', owner, wrap(async (req, res) => {
  const out = await tx(async (db) => {
    const r = (await db.query(
      `SELECT inv.id, inv.status, i.name, u.username FROM inventory inv JOIN items i ON i.id=inv.item_id LEFT JOIN users u ON u.id=inv.user_id
       WHERE inv.id=$1 FOR UPDATE OF inv`, [parseInt(req.params.id, 10)])).rows[0];
    if (!r) throw new Fail(404, 'Item not found.');
    if (r.status === 'listed') throw new Fail(400, 'It is listed for sale. Take the listing down in the Market tab first.');
    if (r.status !== 'held') throw new Fail(400, 'It is being withdrawn. Fail or finish that trade first.');
    await db.query("UPDATE inventory SET status='removed' WHERE id=$1", [r.id]);
    await log(db, req.user.username, 'inventory.owner_removed', 'user:' + r.username, { item: r.name, inventory_id: r.id });
    return { ok: true };
  });
  res.json(out);
}));

// ---------- Owner: items, trades, logs ----------
function itemFields(b) {
  const name = clean(b.name, 60);
  if (!name) throw new Fail(400, 'Item needs a name.');
  const type = TYPES.includes(b.type) ? b.type : 'Misc';
  const rarity = RARITIES.includes(b.rarity) ? b.rarity : 'Common';
  const value = Math.max(0, Math.min(parseInt(b.value, 10) || 0, 1e9));
  const image = clean(b.image_url, 300);
  if (image && !/^(https:\/\/|\/img\/item\/\d+|\/items\/[a-z0-9-]+\.webp)/.test(image)) throw new Fail(400, 'Image link must start with https://');
  return { name, type, rarity, value, image_url: image || null };
}

// ---------- Item pictures bundled in item-images.zip (one 200x200 webp per item) ----------
const bundled = new Map();
try {
  const zp = path.join(__dirname, 'item-images.zip');
  if (fs.existsSync(zp)) for (const e of new AdmZip(zp).getEntries()) if (!e.isDirectory && /^[a-z0-9-]+\.webp$/.test(e.entryName)) bundled.set(e.entryName, e.getData());
  console.log('Item pictures loaded: ' + bundled.size);
} catch (e) { console.error('item-images.zip could not be read:', e.message); }
app.get('/items/:file', (req, res) => {
  const b = bundled.get(req.params.file);
  if (!b) return res.status(404).end();
  res.set('Content-Type', 'image/webp').set('Cache-Control', 'public, max-age=604800').send(b);
});

// Public value list for the Values page.
app.get('/api/values', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT i.id, i.name, i.type, i.rarity, i.value, i.image_url, i.demand, i.stability, i.value_change, i.value_updated_at,
       (SELECT min(ml.price_cents) FROM market_listings ml JOIN users u ON u.id=ml.seller_id WHERE ml.item_id=i.id AND ml.status='active' AND NOT u.banned) AS lowest_cents,
       (SELECT count(*)::int FROM market_listings ml WHERE ml.item_id=i.id AND ml.status='active') AS for_sale
     FROM items i WHERE i.active AND i.value > 0 ORDER BY i.value DESC, i.name ASC`);
  res.json(rows);
}));

// ---------- Item pictures (uploaded by owners, stored in the database) ----------
app.get('/img/item/:id', wrap(async (req, res) => {
  const r = (await pool.query('SELECT image_data, image_type FROM items WHERE id=$1', [parseInt(req.params.id, 10) || 0])).rows[0];
  if (!r || !r.image_data) return res.status(404).end();
  res.set('Content-Type', r.image_type || 'image/webp').set('Cache-Control', 'public, max-age=31536000, immutable').send(r.image_data);
}));
app.post('/api/admin/items/:id/image', owner, wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const m = /^data:(image\/(?:webp|png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body.data || ''));
  if (!m) throw new Fail(400, 'Upload a PNG, JPG or WebP picture.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 400 * 1024) throw new Fail(400, 'That picture is too big. Keep it under 400 KB.');
  const url = '/img/item/' + id + '?v=' + Date.now().toString(36);
  const r = await pool.query('UPDATE items SET image_data=$1, image_type=$2, image_url=$3 WHERE id=$4 RETURNING name', [buf, m[1], url, id]);
  if (!r.rowCount) throw new Fail(404, 'Item not found.');
  await log(null, req.user.username, 'item.image_uploaded', 'item:' + id, { name: r.rows[0].name, bytes: buf.length });
  res.json({ ok: true, image_url: url });
}));
app.delete('/api/admin/items/:id/image', owner, wrap(async (req, res) => {
  await pool.query('UPDATE items SET image_data=NULL, image_type=NULL, image_url=NULL WHERE id=$1', [parseInt(req.params.id, 10)]);
  await log(null, req.user.username, 'item.image_removed', 'item:' + req.params.id);
  res.json({ ok: true });
}));

// ---------- Paste a value list ----------
// Understands blocks like:  Evergun / Value - 3,450 / Range - [N/A] / Stability - Stable Item Stability /
// Demand - 5 Rarity - 4 / Change in Value - (-25) -0.7%   (anything else on the page is ignored)
// Names match ignoring case, spaces and punctuation; "C. Evergun" counts as "Chroma Evergun".
const normName = (s) => String(s || '').toLowerCase().replace(/^\s*c\.\s*/, 'chroma ').replace(/[^a-z0-9]/g, '');
// Minimal CSV reader (handles quoted fields with commas).
function csvRows(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
const GUN_WORDS = /gun|luger|blaster|laser|beam|shot|cannon|revolver|pistol|rifle|sniper/i;
function parseValueList(text) {
  const t = String(text || '').replace(/^\uFEFF/, '').trim();
  // JSON lists: [{ name, value | numericValue, type, demand, stability, changeInValue | change, imageUrl | image }]
  if (t.startsWith('[')) {
    let arr; try { arr = JSON.parse(t); } catch { throw new Fail(400, 'That looks like JSON but it could not be read.'); }
    return (Array.isArray(arr) ? arr : []).map((x) => {
      const name = clean(x.name || x.rawName, 60);
      const rawV = x.numericValue ?? x.value;
      const value = rawV == null || rawV === '' ? null : Number.isFinite(+rawV) ? +rawV : parseInt(String(rawV).replace(/,/g, ''), 10);
      const ch = /\(?([+-]?\d[\d,]*)\)?/.exec(String(x.change ?? x.changeInValue ?? ''));
      const img = String(x.image || x.imageUrl || '');
      return { name, value, demand: Number.isFinite(+x.demand) && x.demand !== '' && x.demand != null ? +x.demand : null,
        stability: x.stability ? String(x.stability).replace(/\s*Item Stability\s*$/i, '').slice(0, 40) : null,
        change: ch ? parseInt(ch[1].replace(/,/g, ''), 10) : null,
        type: TYPES.includes(x.type) ? x.type : null, rarity: RARITIES.includes(x.rarity) ? x.rarity : null, alias: x.alias ? clean(x.alias, 60) : null, remove: x.remove === true,
        image: /^https:\/\/[^\s"'<>]{1,290}$/.test(img) || /^\/items\/[a-z0-9-]+\.webp$/.test(img) ? img : null };
    }).filter((x) => x.name && (x.remove || Number.isFinite(x.value) || x.value === null));
  }
  // CSV with a header row, e.g. Name,Category,Tier,Value,Value (number),Stability,Demand,...
  const firstLine = t.split(/\r?\n/, 1)[0];
  if (/(^|,)\s*name\s*(,|$)/i.test(firstLine) && /value/i.test(firstLine) && firstLine.includes(',')) {
    const rows = csvRows(t); const head = rows.shift().map((h) => h.trim().toLowerCase());
    const col = (...names) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
    const iN = col('name'), iV = col('value (number)', 'numericvalue', 'value'), iR = col('category', 'rarity'), iS = col('stability'), iD = col('demand'), iT = col('type');
    return rows.map((r) => {
      const raw = String(r[iV] ?? '').replace(/,/g, '').trim();
      const name = clean(r[iN], 60), m = /\((Gun|Knife)\)/i.exec(name);
      const typ = iT >= 0 ? TYPES.find((x) => x.toLowerCase() === String(r[iT] || '').trim().toLowerCase()) : null;
      return { name, value: /^\d+$/.test(raw) ? parseInt(raw, 10) : NaN, rarity: RARITIES.find((x) => x.toLowerCase() === String(r[iR] || '').trim().toLowerCase()) || null,
        stability: iS >= 0 && r[iS] ? String(r[iS]).trim().slice(0, 40) : null, demand: iD >= 0 && /^\d+$/.test(String(r[iD]).trim()) ? parseInt(r[iD], 10) : null,
        change: null, type: typ || (m ? (m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()) : null), image: null };
    }).filter((x) => x.name && Number.isFinite(x.value) && x.value > 0); // rows without a number value are skipped
  }
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/\t+$/, '').trim());
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const v = /^Value\s*[-–:]\s*([\d,]+)/i.exec(lines[i]);
    if (!v) continue;
    const name = lines[i - 1].replace(/\s*\((knife|gun)\)\s*$/i, '').trim();
    if (!name || name.length > 60) continue;
    const it = { name, value: parseInt(v[1].replace(/,/g, ''), 10), demand: null, stability: null, change: null };
    for (let j = i + 1; j < Math.min(lines.length, i + 7); j++) {
      if (/^Value\s*[-–:]/i.test(lines[j])) break;
      const d = /Demand\s*[-–:]\s*(\d+)/i.exec(lines[j]); if (d) it.demand = parseInt(d[1], 10);
      const st = /^Stability\s*[-–:]\s*(.+?)(\s+Item Stability)?$/i.exec(lines[j]); if (st) it.stability = st[1].trim().slice(0, 40);
      const ch = /^Change in Value\s*[-–:]\s*\(([+-]?\d[\d,]*)\)/i.exec(lines[j]); if (ch) it.change = parseInt(ch[1].replace(/,/g, ''), 10);
    }
    out.push(it);
  }
  return out;
}
async function importValues(text, rarityIn, addNew, actor) {
  const parsed = parseValueList(text);
  if (!parsed.length) throw new Fail(400, 'No items found. Paste the list with lines like "Value - 1,800" under each item name.');
  const rarity = RARITIES.includes(rarityIn) ? rarityIn : 'Godly';
  // Same names can exist in several rarities ("Laser" Godly vs "Laser (Vintage)"), so match on rarity when the list has one.
  const existing = new Map();
  const remember = (r) => { const k = normName(r.name); if (!existing.has(k)) existing.set(k, []); existing.get(k).push(r); };
  (await pool.query('SELECT id, name, rarity FROM items')).rows.forEach(remember);
  const findItem = (it) => {
    const plain = existing.get(normName(it.name)) || [];
    if (!it.rarity) return { hit: plain[0], exact: true };
    const same = plain.find((r) => r.rarity === it.rarity);
    if (same) return { hit: same, exact: true };
    const suffixed = (existing.get(normName(it.name + ' ' + it.rarity)) || [])[0];
    if (suffixed) return { hit: suffixed, exact: false };
    // An older name for the same item (from an earlier catalog) gets renamed instead of duplicated.
    const old = it.alias && (existing.get(normName(it.alias)) || []).find((r) => !it.rarity || r.rarity === it.rarity);
    if (old) return { hit: old, exact: true };
    return { hit: null, taken: plain.length > 0 };
  };
  let updated = 0; const added = [], guessedGun = [], skipped = [], removed = [];
  await tx(async (db) => {
    for (const it of parsed) {
      const { hit, exact, taken } = findItem(it);
      // { "name": ..., "rarity": ..., "remove": true } hides an item and takes down its listings (items go back to sellers).
      if (it.remove) {
        if (hit) {
          const l = await db.query("UPDATE market_listings SET status='cancelled' WHERE item_id=$1 AND status='active' RETURNING inventory_id", [hit.id]);
          if (l.rowCount) await db.query("UPDATE inventory SET status='held' WHERE id = ANY($1) AND status='listed'", [l.rows.map((r) => r.inventory_id)]);
          await db.query('UPDATE items SET active=false WHERE id=$1', [hit.id]);
          removed.push(hit.name);
        }
        continue;
      }
      if (hit) {
        // Only rename when no other item already uses the new name.
        const clash = (existing.get(normName(it.name)) || []).some((r) => r.id !== hit.id);
        let newName = exact && !clash && !/^\s*C\.\s/i.test(it.name) ? it.name : null;
        // Name already used by a different-rarity item: use "Name (Rarity)" instead, if that's free.
        if (exact && clash && it.rarity && !/^\s*C\.\s/i.test(it.name) && !/\((Chroma|Ancient|Godly|Unique|Vintage|Legendary|Rare|Uncommon|Common)\)$/.test(it.name)) {
          const alt = it.name + ' (' + it.rarity + ')';
          if (!(existing.get(normName(alt)) || []).some((r) => r.id !== hit.id)) newName = alt;
        }
        if (newName && newName !== hit.name) { const k = normName(hit.name); existing.set(k, (existing.get(k) || []).filter((r) => r.id !== hit.id)); hit.name = newName; remember(hit); }
        // Type and picture link only change when the list provides them; an uploaded picture is never replaced.
        // Entries without a value (or 0) never wipe a value that's already set.
        const hasV = Number.isFinite(it.value) && it.value > 0;
        await db.query(`UPDATE items SET value=CASE WHEN $8 THEN $1 ELSE value END, demand=CASE WHEN $8 THEN $2 ELSE demand END,
            stability=CASE WHEN $8 THEN $3 ELSE stability END, value_change=CASE WHEN $8 THEN $4 ELSE value_change END,
            value_updated_at=CASE WHEN $8 THEN now() ELSE value_updated_at END,
            type=COALESCE($6, type), image_url=CASE WHEN $7::text IS NOT NULL AND image_data IS NULL THEN $7 ELSE image_url END,
            rarity=COALESCE($9, rarity), name=COALESCE($10, name), active=CASE WHEN $8 THEN true ELSE active END WHERE id=$5`,
          [it.value, it.demand, it.stability, it.change, hit.id, it.type || null, it.image || null, hasV, it.rarity || null,
           newName]);
        updated++;
      } else if (addNew) {
        const type = it.type || (GUN_WORDS.test(it.name) ? 'Gun' : 'Knife');
        const v = Number.isFinite(it.value) ? it.value : 0;
        const name = taken ? it.name + ' (' + (it.rarity || rarity) + ')' : it.name;
        const r = (await db.query('INSERT INTO items (name, type, rarity, value, demand, stability, value_change, value_updated_at, image_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
          [name, type, it.rarity || rarity, v, it.demand, it.stability, it.change, v > 0 ? new Date() : null, it.image || null])).rows[0];
        remember({ id: r.id, name, rarity: it.rarity || rarity });
        added.push(name); if (type === 'Gun' && !it.type) guessedGun.push(name);
      } else skipped.push(it.name);
    }
    await log(db, actor, 'item.values_imported', null, { found: parsed.length, updated, added: added.length, removed });
  });
  return { found: parsed.length, updated, added, guessed_gun: guessedGun, skipped, removed };
}
app.post('/api/admin/items/values', owner, wrap(async (req, res) => {
  res.json(await importValues(req.body.text, req.body.rarity, req.body.add_new !== false, req.user.username));
}));

// Starter catalog: seed-items.json (items with a number value, plus rarity, type and picture) is loaded on start
// whenever the file is new or has changed since it was last loaded. If the file hasn't changed, nothing runs,
// so edits made in the owner panel stay put until a new seed-items.json is uploaded.
async function seedItems() {
  const file = path.join(__dirname, 'seed-items.json');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  const hash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
  if (settings.seed_hash === hash) return console.log('Starter items already up to date');
  try {
    const r = await importValues(text, 'Godly', true, 'system');
    // Items without a real value are hidden, unless someone holds one, it's listed, or an owner uploaded its picture.
    const hidden = await pool.query(`UPDATE items i SET active=false WHERE i.active AND i.value <= 0 AND i.image_data IS NULL
      AND NOT EXISTS (SELECT 1 FROM inventory v WHERE v.item_id=i.id AND v.status IN ('held','listed','withdrawing'))`);
    await pool.query("INSERT INTO settings (key, value) VALUES ('seed_hash', $1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [JSON.stringify(hash)]);
    settings.seed_hash = hash;
    console.log('Items without a value hidden: ' + hidden.rowCount);
    console.log('Starter items loaded: ' + r.added.length + ' added, ' + r.updated + ' updated' + (r.removed.length ? ', removed: ' + r.removed.join(', ') : ''));
  } catch (e) { console.error('Starter items failed:', e.message); }
}

app.get('/api/admin/items', owner, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT i.id, i.name, i.type, i.rarity, i.value, i.image_url, i.active, i.created_at, i.demand, i.stability, i.value_change, i.value_updated_at, (SELECT count(*)::int FROM inventory v WHERE v.item_id=i.id AND v.status IN ('held','withdrawing')) AS held
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

// ---------- Crypto deposits & withdrawals ----------
// Set BTC_XPUB and/or LTC_XPUB in Railway (Electrum > Wallet > Information > Master Public Key).
// Each player gets their own address from that key. A watcher checks the blockchain and credits
// deposits after enough confirmations. Withdrawals go into a queue that owners pay from their wallet.
const CRYPTO = {};
for (const coin of Object.values(cx.COINS)) {
  const raw = process.env[coin.symbol + '_XPUB'];
  if (!raw) continue;
  try {
    const parsed = cx.parseXpub(raw);
    CRYPTO[coin.id] = { ...coin, parsed, keyId: crypto.createHash('sha256').update(raw.trim()).digest('hex').slice(0, 12) };
    console.log('Crypto: ' + coin.name + ' deposits on (' + parsed.type + ')');
  } catch (e) { console.error('Crypto: ' + coin.symbol + '_XPUB is not valid: ' + e.message); }
}
const MIN_DEPOSIT = Math.round((parseFloat(process.env.MIN_DEPOSIT_USD) || 1) * 100);
const MIN_WITHDRAW = Math.round((parseFloat(process.env.MIN_WITHDRAW_USD) || 5) * 100);
const PRICE_API = process.env.PRICE_API || 'https://api.coingecko.com/api/v3';
const prices = {}; let pricesAt = 0;
const watch = { lastRun: null, lastError: null, checks: 0 };

// A host that rate-limits us (429) or errors is skipped for a while and the next provider is used.
const hostCool = new Map();
const hostOf = (u) => { try { return new URL(u).host; } catch { return u; } };
async function getJson(url, asText) {
  const host = hostOf(url);
  if ((hostCool.get(host) || 0) > Date.now()) throw new Error(host + ' is cooling down');
  let r;
  try { r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'SplitzMarket/1.0' }, signal: AbortSignal.timeout(10000) }); }
  catch (e) { hostCool.set(host, Date.now() + 30e3); throw new Error(host + ' unreachable: ' + e.message); }
  if (!r.ok) {
    if (r.status === 429 || r.status >= 500) hostCool.set(host, Date.now() + (r.status === 429 ? 90e3 : 30e3));
    throw new Error(url.replace(/\?.*/, '') + ' -> ' + r.status);
  }
  return asText ? r.text() : r.json();
}
// Prices come from CoinGecko, then Coinbase, then Kraken. The last good price is saved, so a
// rate-limited price API never stops deposits from being picked up.
const PRICE_SOURCES = [
  async (coins) => { const j = await getJson(PRICE_API + '/simple/price?ids=' + coins.map((c) => c.gecko).join(',') + '&vs_currencies=usd'); return Object.fromEntries(coins.map((c) => [c.id, j[c.gecko] && j[c.gecko].usd])); },
  async (coins) => Object.fromEntries(await Promise.all(coins.map(async (c) => [c.id, parseFloat((await getJson('https://api.coinbase.com/v2/prices/' + c.symbol + '-USD/spot')).data.amount)]))),
  async (coins) => Object.fromEntries(await Promise.all(coins.map(async (c) => { const j = await getJson('https://api.kraken.com/0/public/Ticker?pair=' + (c.symbol === 'BTC' ? 'XBT' : c.symbol) + 'USD'); const k = Object.keys(j.result || {})[0]; return [c.id, k ? parseFloat(j.result[k].c[0]) : null]; }))),
];
let pricesSavedAt = 0;
async function refreshPrices(force) {
  const coins = Object.values(CRYPTO);
  if (!coins.length) return prices;
  for (const c of coins) if (!prices[c.id] && settings.last_prices && settings.last_prices[c.id] > 0) prices[c.id] = settings.last_prices[c.id];
  if (!force && Date.now() - pricesAt < 60000) return prices;
  pricesAt = Date.now();
  let missing = coins;
  for (const src of PRICE_SOURCES) {
    try {
      const got = await src(missing);
      for (const c of missing) if (got[c.id] > 0) prices[c.id] = got[c.id];
      missing = missing.filter((c) => !(got[c.id] > 0));
    } catch (e) { watch.lastError = 'prices: ' + e.message; }
    if (!missing.length) break;
  }
  if (Date.now() - pricesSavedAt > 10 * 60e3 && Object.keys(prices).length) {
    pricesSavedAt = Date.now(); settings.last_prices = { ...prices };
    pool.query("INSERT INTO settings (key, value) VALUES ('last_prices', $1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [JSON.stringify(prices)]).catch(() => {});
  }
  return prices;
}
const feeCents = (c) => Math.round(parseFloat(c.fee) * 100) || 0;
const coinAmount = (c, cents) => (prices[c.id] ? (cents / 100 / prices[c.id]).toFixed(8) : null);

function coinOf(id) { const c = CRYPTO[String(id || '').toLowerCase()]; if (!c) throw new Fail(400, 'That coin is not available.'); return c; }

app.get('/api/crypto', wrap(async (req, res) => {
  await refreshPrices();
  const u = await currentUser(req);
  let withdrawable = null;
  if (u) withdrawable = Math.max(0, u.balance_cents - (await pool.query('SELECT locked_cents FROM users WHERE id=$1', [u.id])).rows[0].locked_cents);
  res.json({
    coins: Object.values(CRYPTO).map((c) => ({ id: c.id, name: c.name, symbol: c.symbol, price: prices[c.id] || null, confirmations: c.confirmations, fee_cents: feeCents(c) })),
    min_deposit: MIN_DEPOSIT, min_withdraw: MIN_WITHDRAW, withdraw_tax_pct: taxPct('withdraw_tax'), codes_url: CODES_URL,
    balance: u ? u.balance_cents : null, withdrawable,
    open: LISTINGS_OPEN || isOwner(u),
  });
}));

app.post('/api/crypto/address', auth, wrap(async (req, res) => {
  marketGate(req.user);
  if (!req.user.roblox_id) throw new Fail(400, 'Log in with Roblox first.');
  const c = coinOf(req.body.coin);
  const row = await tx(async (db) => {
    const have = (await db.query('UPDATE crypto_addresses SET last_viewed=now() WHERE user_id=$1 AND coin=$2 AND key_id=$3 RETURNING address', [req.user.id, c.id, c.keyId])).rows[0];
    if (have) return have;
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['addr:' + c.id + ':' + c.keyId]);
    const idx = (await db.query('SELECT COALESCE(max(idx)+1, 0) AS n FROM crypto_addresses WHERE coin=$1 AND key_id=$2', [c.id, c.keyId])).rows[0].n;
    const address = cx.addressFor(c, c.parsed, idx);
    await db.query('INSERT INTO crypto_addresses (user_id, coin, key_id, idx, address) VALUES ($1,$2,$3,$4,$5)', [req.user.id, c.id, c.keyId, idx, address]);
    await log(db, req.user.username, 'crypto.address_created', c.id + ':' + address, { idx });
    return { address };
  });
  const uri = (c.id === 'btc' ? 'bitcoin:' : 'litecoin:') + row.address;
  res.json({ coin: c.id, address: row.address, qr: await cx.qrSvg(uri), uri, confirmations: c.confirmations });
}));

app.get('/api/crypto/history', auth, wrap(async (req, res) => {
  // While someone has the deposit window open, check their own addresses right away (at most every 4 seconds).
  if (Object.keys(CRYPTO).length && limit('live' + req.user.id, 4000)) {
    await refreshPrices().catch(() => {});
    const mine = (await pool.query('SELECT * FROM crypto_addresses WHERE user_id=$1', [req.user.id])).rows.filter((r) => CRYPTO[r.coin] && CRYPTO[r.coin].keyId === r.key_id);
    await Promise.race([Promise.all(mine.map((r) => checkAddress(r).catch(() => {}))), sleep(3500)]);
  }
  const deposits = (await pool.query('SELECT id, coin, txid, amount_sats, usd_cents, confirmations, status, created_at FROM crypto_deposits WHERE user_id=$1 ORDER BY id DESC LIMIT 20', [req.user.id])).rows;
  const withdrawals = (await pool.query('SELECT id, coin, address, usd_cents, fee_cents, tax_cents, coin_amount, status, txid, note, created_at FROM crypto_withdrawals WHERE user_id=$1 ORDER BY id DESC LIMIT 20', [req.user.id])).rows;
  res.json({ deposits: deposits.map((d) => ({ ...d, amount_sats: Number(d.amount_sats), needed: (CRYPTO[d.coin] || cx.COINS[d.coin] || {}).confirmations })), withdrawals });
}));

app.post('/api/crypto/withdraw', auth, wrap(async (req, res) => {
  marketGate(req.user);
  if (!limit('cw' + req.user.id, 3000)) throw new Fail(429, 'Slow down a little.');
  const c = coinOf(req.body.coin);
  const address = String(req.body.address || '').trim();
  if (!cx.validAddress(c, address)) throw new Fail(400, 'That is not a valid ' + c.name + ' address.');
  const amount = toCents(req.body.amount);
  const fee = feeCents(c);
  if (amount < MIN_WITHDRAW) throw new Fail(400, 'The minimum withdrawal is ' + usd(MIN_WITHDRAW) + '.');
  const tpct = taxPct('withdraw_tax'), tax = taxOf(amount, tpct);
  if (amount <= fee + tax) throw new Fail(400, 'The amount has to be more than the ' + usd(fee + tax) + ' in fees.');
  await refreshPrices();
  const out = await tx(async (db) => {
    const u = (await db.query('SELECT balance_cents, locked_cents FROM users WHERE id=$1 FOR UPDATE', [req.user.id])).rows[0];
    const open = (await db.query("SELECT count(*)::int AS n FROM crypto_withdrawals WHERE user_id=$1 AND status='pending'", [req.user.id])).rows[0].n;
    if (open) throw new Fail(400, 'You already have a withdrawal waiting. Wait for it to be sent first.');
    const free = u.balance_cents - u.locked_cents;
    if (amount > free) throw new Fail(400, `You can withdraw up to ${usd(Math.max(0, free))}. Deposited money has to be spent on items before it can be withdrawn.`);
    const w = (await db.query('INSERT INTO crypto_withdrawals (user_id, coin, address, usd_cents, fee_cents, tax_cents, coin_amount) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [req.user.id, c.id, address, amount, fee, tax, coinAmount(c, amount - fee - tax)])).rows[0];
    const balance = await moveMoney(db, req.user.id, -amount, 'crypto_withdrawal', c.name + ' to ' + address.slice(0, 10) + '…' + (tax ? ' (incl. ' + tpct + '% fee ' + usd(tax) + ')' : ''));
    await log(db, req.user.username, 'crypto.withdraw_requested', 'withdrawal:' + w.id, { coin: c.id, address, amount: usd(amount), fee: usd(fee), tax: usd(tax) });
    return { ok: true, id: w.id, balance };
  });
  res.json(out);
}));

// Owner: withdrawal queue and recent deposits.
app.get('/api/admin/crypto', owner, wrap(async (req, res) => {
  await refreshPrices();
  const withdrawals = (await pool.query(
    `SELECT w.*, u.username FROM crypto_withdrawals w LEFT JOIN users u ON u.id=w.user_id
     ORDER BY (w.status='pending') DESC, w.id DESC LIMIT 200`)).rows;
  const deposits = (await pool.query(
    `SELECT d.*, u.username FROM crypto_deposits d LEFT JOIN users u ON u.id=d.user_id ORDER BY d.id DESC LIMIT 100`)).rows;
  res.json({
    coins: Object.values(CRYPTO).map((c) => ({ id: c.id, name: c.name, price: prices[c.id] || null, explorer: c.explorer })),
    withdrawals: withdrawals.map((w) => ({ ...w, send_now: coinAmount(CRYPTO[w.coin] || cx.COINS[w.coin], w.usd_cents - w.fee_cents - (w.tax_cents || 0)) })),
    deposits: deposits.map((d) => ({ ...d, amount_sats: Number(d.amount_sats) })), watch,
  });
}));
// Owner: force-check a deposit by address or transaction ID right now.
app.post('/api/admin/crypto/recheck', owner, wrap(async (req, res) => {
  const q = String(req.body.query || '').trim();
  if (!q) throw new Fail(400, 'Paste a deposit address or a transaction ID.');
  let addrs = (await pool.query('SELECT * FROM crypto_addresses WHERE address=$1', [q])).rows;
  if (!addrs.length && /^[0-9a-fA-F]{64}$/.test(q)) {
    const known = (await pool.query('SELECT DISTINCT address FROM crypto_deposits WHERE txid=$1', [q.toLowerCase()])).rows.map((r) => r.address);
    let outs = known;
    if (!outs.length) for (const c of Object.values(CRYPTO)) for (const base of ESPLORA[c.id] || []) {
      try { const t = await getJson(base + '/tx/' + q.toLowerCase()); outs = (t.vout || []).map((o) => o.scriptpubkey_address).filter(Boolean); break; } catch {}
    }
    if (outs.length) addrs = (await pool.query('SELECT * FROM crypto_addresses WHERE address = ANY($1)', [outs])).rows;
  }
  if (!addrs.length) throw new Fail(404, 'That is not one of our deposit addresses, or the transaction was not found. Check the coin and that it was sent to the address shown on the site.');
  for (const a of addrs) await checkAddress(a);
  const deps = (await pool.query(`SELECT d.*, u.username FROM crypto_deposits d LEFT JOIN users u ON u.id=d.user_id WHERE d.address = ANY($1) ORDER BY d.id DESC LIMIT 10`, [addrs.map((a) => a.address)])).rows;
  const owner = (await pool.query('SELECT username FROM users WHERE id=$1', [addrs[0].user_id])).rows[0];
  await log(null, req.user.username, 'crypto.recheck', q.slice(0, 20));
  res.json({ user: owner ? owner.username : null, addresses: addrs.map((a) => a.address), deposits: deps.map((d) => ({ ...d, amount_sats: Number(d.amount_sats) })) });
}));
// Owner: credit a deposit that was under the minimum anyway.
app.post('/api/admin/crypto/deposits/:id/credit', owner, wrap(async (req, res) => {
  const out = await tx(async (db) => {
    const d = (await db.query("SELECT * FROM crypto_deposits WHERE id=$1 FOR UPDATE", [parseInt(req.params.id, 10)])).rows[0];
    if (!d) throw new Fail(404, 'Deposit not found.');
    if (d.status !== 'below_min') throw new Fail(409, 'Only deposits under the minimum can be credited by hand.');
    await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [d.user_id]);
    const c = CRYPTO[d.coin] || cx.COINS[d.coin];
    await moveMoney(db, d.user_id, d.usd_cents, 'crypto_deposit', (Number(d.amount_sats) / 1e8).toFixed(8).replace(/0+$/, '').replace(/\.$/, '') + ' ' + c.symbol + ' (credited by staff)', d.usd_cents);
    await db.query("UPDATE crypto_deposits SET status='credited', credited_at=now() WHERE id=$1", [d.id]);
    await log(db, req.user.username, 'crypto.deposit_credited_by_owner', d.coin + ':' + d.txid, { usd: usd(d.usd_cents) });
    return { ok: true };
  });
  res.json(out);
}));
app.post('/api/admin/crypto/withdrawals/:id/:action', owner, wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10), a = req.params.action;
  const out = await tx(async (db) => {
    const w = (await db.query("SELECT * FROM crypto_withdrawals WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!w) throw new Fail(404, 'Withdrawal not found.');
    if (w.status !== 'pending') throw new Fail(409, 'This withdrawal is already ' + w.status + '.');
    if (a === 'paid') {
      const txid = clean(req.body.txid, 100);
      if (!/^[0-9a-fA-F]{64}$/.test(txid)) throw new Fail(400, 'Paste the 64-character transaction ID from your wallet.');
      await db.query("UPDATE crypto_withdrawals SET status='paid', txid=$1, handled_by=$2, updated_at=now() WHERE id=$3", [txid, req.user.username, id]);
      await log(db, req.user.username, 'crypto.withdraw_paid', 'withdrawal:' + id, { txid, amount: usd(w.usd_cents) });
    } else if (a === 'reject') {
      const note = clean(req.body.reason, 200) || 'Rejected by staff';
      await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [w.user_id]);
      await moveMoney(db, w.user_id, w.usd_cents, 'withdrawal_refund', note);
      await db.query("UPDATE crypto_withdrawals SET status='rejected', note=$1, handled_by=$2, updated_at=now() WHERE id=$3", [note, req.user.username, id]);
      await log(db, req.user.username, 'crypto.withdraw_rejected', 'withdrawal:' + id, { note, refunded: usd(w.usd_cents) });
    } else throw new Fail(404, 'Unknown action.');
    return { ok: true };
  });
  res.json(out);
}));

// ---------- Blockchain watcher ----------
const tips = {};
// Blockchain data: Esplora explorers first (mempool.space / blockstream / litecoinspace), BlockCypher as a last resort.
const ESPLORA = {
  btc: [...new Set([cx.COINS.btc.api, 'https://blockstream.info/api', 'https://mempool.space/api'])],
  ltc: [...new Set([cx.COINS.ltc.api, 'https://litecoinspace.org/api'])],
};
const CYPHER = { btc: 'btc/main', ltc: 'ltc/main' };
async function tipHeight(base) {
  const t = tips[base];
  if (t && Date.now() - t.at < 5000) return t.h;
  const h = parseInt(await getJson(base + '/blocks/tip/height', true), 10);
  if (!(h > 0)) throw new Error(hostOf(base) + ' tip height unavailable');
  tips[base] = { h, at: Date.now() };
  return h;
}
// Every payment to an address as [{ txid, sats, confs }].
async function addressTxs(c, address) {
  let last;
  for (const base of ESPLORA[c.id] || []) {
    try {
      const txs = await getJson(base + '/address/' + address + '/txs');
      const tip = await tipHeight(base);
      return (Array.isArray(txs) ? txs : []).map((t) => ({
        txid: t.txid,
        sats: (t.vout || []).filter((o) => o.scriptpubkey_address === address).reduce((a, o) => a + Number(o.value || 0), 0),
        confs: t.status && t.status.confirmed && t.status.block_height ? Math.max(1, tip - t.status.block_height + 1) : 0, // a mined tx always has at least 1
      }));
    } catch (e) { last = e; }
  }
  if (CYPHER[c.id]) {
    try {
      const j = await getJson('https://api.blockcypher.com/v1/' + CYPHER[c.id] + '/addrs/' + address + '/full?limit=50');
      return (j.txs || []).map((t) => ({
        txid: t.hash,
        sats: (t.outputs || []).filter((o) => (o.addresses || []).includes(address)).reduce((a, o) => a + Number(o.value || 0), 0),
        confs: t.block_height > 0 ? Math.max(1, Number(t.confirmations) || 1) : 0,
      }));
    } catch (e) { last = e; }
  }
  throw last || new Error('no explorer available for ' + c.id);
}
async function checkAddress(row) {
  const c = CRYPTO[row.coin];
  if (!c) return;
  const txs = await addressTxs(c, row.address);
  watch.checks++;
  for (const t of txs) {
    const sats = t.sats, confs = t.confs;
    if (!sats) continue;
    let dep = (await pool.query('SELECT * FROM crypto_deposits WHERE coin=$1 AND txid=$2 AND address=$3', [c.id, t.txid, row.address])).rows[0];
    if (!dep) {
      if (!prices[c.id]) await refreshPrices(true);
      if (!prices[c.id]) { watch.lastError = 'no ' + c.symbol + ' price yet, deposit ' + t.txid.slice(0, 10) + ' waits'; continue; }
      const cents = Math.round((sats / 1e8) * prices[c.id] * 100);
      dep = (await pool.query(
        `INSERT INTO crypto_deposits (user_id, coin, address, txid, amount_sats, usd_cents, confirmations) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (coin, txid, address) DO NOTHING RETURNING *`, [row.user_id, c.id, row.address, t.txid, sats, cents, confs])).rows[0];
      if (!dep) continue;
      await log(null, 'watcher', 'crypto.deposit_seen', c.id + ':' + t.txid, { user_id: row.user_id, sats, usd: usd(cents) });
    } else if (dep.status === 'pending' && dep.confirmations !== confs) {
      await pool.query('UPDATE crypto_deposits SET confirmations=$1 WHERE id=$2', [confs, dep.id]);
    }
    if (dep.status === 'pending' && confs >= c.confirmations) {
      await tx(async (db) => {
        const d = (await db.query("SELECT * FROM crypto_deposits WHERE id=$1 AND status='pending' FOR UPDATE", [dep.id])).rows[0];
        if (!d) return;
        if (d.usd_cents < MIN_DEPOSIT) {
          await db.query("UPDATE crypto_deposits SET status='below_min', confirmations=$1 WHERE id=$2", [confs, d.id]);
          await log(db, 'watcher', 'crypto.deposit_below_min', c.id + ':' + d.txid, { usd: usd(d.usd_cents) });
          return;
        }
        await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [d.user_id]);
        await moveMoney(db, d.user_id, d.usd_cents, 'crypto_deposit', (Number(d.amount_sats) / 1e8).toFixed(8).replace(/0+$/, '').replace(/\.$/, '') + ' ' + c.symbol, d.usd_cents);
        await db.query("UPDATE crypto_deposits SET status='credited', confirmations=$1, credited_at=now() WHERE id=$2", [confs, d.id]);
        await log(db, 'watcher', 'crypto.deposit_credited', c.id + ':' + d.txid, { user_id: d.user_id, usd: usd(d.usd_cents) });
      });
    }
  }
  await pool.query('UPDATE crypto_addresses SET last_checked=now() WHERE id=$1', [row.id]);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Three loops that never block each other:
//  hot  - addresses opened in the last 30 minutes and anything still confirming (every few seconds)
//  day  - addresses opened in the last 24 hours (every minute)
//  all  - every address (every 15 minutes, slowly, so explorers don't rate-limit us)
const busy = { hot: false, day: false, all: false };
async function sweep(mode) {
  if (busy[mode] || !Object.keys(CRYPTO).length) return;
  busy[mode] = true;
  try {
    await refreshPrices();
    const keys = Object.values(CRYPTO).map((c) => c.id + ':' + c.keyId);
    const pending = "EXISTS (SELECT 1 FROM crypto_deposits d WHERE d.address=a.address AND d.status='pending')";
    const where = mode === 'all' ? 'true'
      : mode === 'hot' ? `((a.last_viewed > now() - interval '30 minutes' AND (a.last_checked IS NULL OR a.last_checked < now() - interval '6 seconds')) OR ${pending})`
      : `(a.last_viewed > now() - interval '24 hours' AND (a.last_checked IS NULL OR a.last_checked < now() - interval '45 seconds'))`;
    const rows = (await pool.query(
      `SELECT a.* FROM crypto_addresses a WHERE (a.coin || ':' || a.key_id) = ANY($1) AND ${where}
       ORDER BY a.last_checked ASC NULLS FIRST LIMIT $2`, [keys, mode === 'all' ? 1000 : 200])).rows;
    for (const r of rows) {
      try { await checkAddress(r); } catch (e) { watch.lastError = new Date().toISOString() + ' ' + e.message; }
      await sleep(mode === 'all' ? 1200 : mode === 'hot' ? 150 : 400);
    }
    watch.lastRun = new Date().toISOString();
  } catch (e) { watch.lastError = e.message; }
  busy[mode] = false;
}
const POLL = Math.max(3, parseInt(process.env.CRYPTO_POLL_SECONDS, 10) || 5) * 1000;
setInterval(() => sweep('hot'), POLL);
setInterval(() => sweep('day'), 60 * 1000);
setInterval(() => sweep('all'), 15 * 60 * 1000);
setTimeout(() => sweep('all'), 60 * 1000);


app.use((err, req, res, next) => {
  if (err instanceof Fail) return res.status(err.status).json({ error: err.message });
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Something went wrong on our side. Try again.' });
});
process.on('unhandledRejection', (e) => console.error('Unhandled', e));

const port = process.env.PORT || 3000;
init().then(seedItems).then(() => app.listen(port, () => console.log('Running on ' + port))).catch((e) => { console.error(e); process.exit(1); });
