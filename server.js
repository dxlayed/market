<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Profile | SplitzMarket</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@500;700;800&family=Manrope:wght@400;500;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#12101f;--surface:#1d1a30;--raise:#26223e;--line:#37325a;--text:#f1eefc;--mute:#a29fc0;--gold:#ffb938;--violet:#8b6cff;--ok:#4ade80;--bad:#ff6b6b}
*{box-sizing:border-box}
body{margin:0;font-family:Manrope,system-ui,sans-serif;background:var(--bg);color:var(--text)}
h1,h2,h3,.logo{font-family:Outfit,system-ui,sans-serif;margin:0}
button,input{font:inherit;color:var(--text);background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:9px 12px}
button{cursor:pointer;font-weight:700}
button:focus-visible,a:focus-visible{outline:2px solid var(--gold);outline-offset:1px}
.btn{background:var(--gold);color:#241a00;border:0}.ghost{background:transparent}.sm{padding:6px 12px;font-size:13px;border-radius:8px}
.mute{color:var(--mute);font-size:13px}
.bar{display:flex;align-items:center;gap:14px;padding:12px 24px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.logo{font-size:22px;font-weight:800;text-decoration:none;color:var(--text)}.logo b{color:var(--gold)}
.bar nav{display:flex;gap:6px;margin-right:auto}
.bar nav a{padding:8px 14px;border-radius:10px;color:var(--mute);text-decoration:none;font-weight:700}.bar nav a.on{background:var(--surface);color:var(--text)}
.soon{opacity:.6;cursor:not-allowed}
.soon i{font-style:normal;font-size:10px;font-weight:800;background:var(--raise);color:var(--gold);border-radius:6px;padding:1px 6px;margin-left:6px}
.wallet{display:flex;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--surface)}
.wallet span{padding:9px 16px;font-weight:800}.wallet button{border:0;border-radius:0;padding:9px 14px;background:var(--raise)}
.av{width:32px;height:32px;border-radius:9px;background:var(--violet);display:grid;place-items:center;font-weight:800;font-family:Outfit,sans-serif;flex:none}
.wrap{max-width:1000px;margin:0 auto;padding:28px 24px 60px}
.title{display:flex;align-items:center;gap:14px;padding-bottom:18px;border-bottom:1px solid var(--line);margin-bottom:22px}
.title h1{font-size:30px}
.layout{display:grid;grid-template-columns:200px minmax(0,1fr);gap:22px;align-items:start}
.side{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:10px;display:grid;gap:4px;position:sticky;top:12px}
.side a,.side span{padding:10px 12px;border-radius:10px;color:var(--mute);text-decoration:none;font-weight:700;font-size:14px}
.side a.on{background:var(--gold);color:#241a00}.side a:hover:not(.on){background:var(--raise)}
.side span{opacity:.55}
.card{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:22px;margin-bottom:20px}
.card h2{font-size:19px;margin-bottom:4px}
.head{display:flex;gap:20px;align-items:center}
.head .av{width:84px;height:84px;font-size:34px;border-radius:20px}
.head h2{font-size:28px}
.prog{flex:1;min-width:0}
.prow{display:flex;justify-content:space-between;font-size:12px;font-weight:800;color:var(--mute);margin:8px 0 6px}
.track{height:8px;background:var(--bg);border-radius:99px;overflow:hidden}.track div{height:100%;background:var(--gold);border-radius:99px}
.rk{color:var(--gold);font-weight:800;font-size:14px}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:20px}
.stats div{background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:14px 16px;font-family:Outfit,sans-serif;font-size:26px;font-weight:700}
.stats span{display:block;font-family:Manrope,sans-serif;font-size:12px;font-weight:700;color:var(--mute);margin-bottom:6px}
.link{display:flex;align-items:center;gap:10px;background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:12px 16px;margin-top:14px}
.link a{color:var(--gold);font-weight:700;text-decoration:none;overflow-wrap:anywhere;flex:1}
.item{display:flex;align-items:center;gap:12px;background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-top:10px;font-weight:700}
.item .tag{margin-left:auto;font-size:12px;border-radius:99px;padding:3px 12px;background:var(--raise);color:var(--mute)}
.item .tag.ok{background:#4ade8022;color:var(--ok)}
.item .acts{display:flex;gap:6px}
.item .acts + .tag,.item .tag + .acts{margin-left:0}
.cnt{float:right;font-family:Outfit,sans-serif;font-size:17px}
.gate{text-align:center;padding:60px 20px}
.um{position:relative}
#toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--ok);color:#06240f;padding:10px 18px;border-radius:10px;font-weight:700;opacity:0;pointer-events:none;transition:opacity .2s}#toast.show{opacity:1}
@media (max-width:800px){.layout{grid-template-columns:1fr}.side{position:static;grid-auto-flow:column;overflow-x:auto}.stats{grid-template-columns:repeat(2,1fr)}.head{flex-direction:column;align-items:flex-start}}
</style>
</head>
<body>
<div class="bar">
  <a class="logo" href="/">Splitz<b>Market</b></a>
  <nav><a href="/">Shop</a><a href="/board.html">Board &amp; chat</a><a class="on" href="/profile.html">Profile</a></nav>
  <button class="soon" data-t="Withdrawals are coming soon" aria-disabled="true">Withdraw <i>Soon</i></button>
  <div class="wallet"><span>$0.00</span><button class="soon" data-t="Deposits are coming soon" aria-disabled="true" aria-label="Add funds (coming soon)">+</button></div>
  <div id="who"></div>
</div>

<div class="wrap">
  <div class="title"><h1>Profile</h1></div>
  <div class="layout">
    <aside class="side">
      <a class="on" href="/profile.html">Profile</a>
      <a href="#listings">My listings</a>
      <a id="myshop" href="/">My shop</a>
      <span>Transactions · Soon</span>
      <span>Settings · Soon</span>
    </aside>
    <main id="main"><div class="card mute">Loading your profile...</div></main>
  </div>
</div>
<div id="toast" role="status"></div>

<script src="/auth.js"></script>
<script>
const $ = (id) => document.getElementById(id);
const el = (t, p = {}, ...k) => { const e = document.createElement(t); Object.assign(e, p); k.forEach((x) => e.append(x)); return e; };
const toast = (t) => { const x = $('toast'); x.textContent = t; x.classList.add('show'); setTimeout(() => x.classList.remove('show'), 1800); };
async function api(url, method = 'GET', body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Something went wrong');
  return d;
}
document.querySelectorAll('.soon').forEach((b) => (b.onclick = () => toast(b.dataset.t)));
const RANKS = [['Newcomer', 0], ['Trader', 1], ['Dealer', 5], ['Broker', 15]];

function gate() {
  $('main').replaceChildren(el('div', { className: 'card gate' }, el('h2', { textContent: 'Log in to see your profile' }),
    el('p', { className: 'mute', textContent: 'Use your Roblox account. No password needed.' }),
    el('button', { className: 'btn', textContent: 'Log in with Roblox', onclick: () => RbxAuth.open(() => location.reload()) })));
  $('who').replaceChildren(el('button', { className: 'btn sm', textContent: 'Log in with Roblox', onclick: () => RbxAuth.open(() => location.reload()) }));
}

function render(me, p) {
  $('who').replaceChildren(RbxAuth.menu(me, async () => { await api('/api/logout', 'POST'); location.href = '/'; }));
  const shopUrl = location.origin + '/?seller=' + encodeURIComponent(p.username);
  $('myshop').href = '/?seller=' + encodeURIComponent(p.username);

  const idx = RANKS.map((r) => r[1]).filter((n) => n <= p.done).length - 1;
  const next = RANKS[idx + 1], prev = RANKS[idx][1];
  const pct = next ? Math.round(((p.done - prev) / (next[1] - prev)) * 100) : 100;
  const bigAv = avEl(me);

  const sell = p.listings.filter((l) => l.kind === 'sell').length, buy = p.listings.length - sell;
  const stats = [['Listings posted', p.listings.length], ['Trades done', p.done], ['Open listings', p.open], ['Selling', sell], ['Buying', buy], ['Chat messages', p.messages]];
  const checks = [['Log in with Roblox', true], ['Post your first listing', p.listings.length > 0], ['Complete your first trade', p.done > 0], ['Say hi in the chat', p.messages > 0]];
  const doneCount = checks.filter((c) => c[1]).length;

  const head = el('section', { className: 'card' },
    el('div', { className: 'head' }, bigAv,
      el('div', { className: 'prog' }, el('h2', { textContent: p.username }),
        el('div', { className: 'prow' }, el('span', { textContent: 'TRADES DONE' }), el('span', { textContent: next ? p.done + ' / ' + next[1] : p.done + ' (max)' })),
        el('div', { className: 'track' }, Object.assign(el('div'), { style: 'width:' + pct + '%' })),
        el('div', { className: 'prow' }, el('span', { className: 'rk', textContent: p.rank }), el('span', { textContent: next ? 'Next: ' + next[0] : 'Top rank reached' })))),
    el('div', { className: 'stats' }, ...stats.map(([k, v]) => el('div', {}, el('span', { textContent: k }), String(v)))));

  const shop = el('section', { className: 'card' }, el('h2', { textContent: 'Your shop' }),
    el('p', { className: 'mute', textContent: 'Your own page with all your open listings. Share this link with other players.' }),
    el('div', { className: 'link' }, el('a', { href: shopUrl, textContent: shopUrl }),
      el('button', { className: 'ghost sm', textContent: 'Copy', onclick: () => navigator.clipboard.writeText(shopUrl).then(() => toast('Link copied')) })));

  const list = el('section', { className: 'card', id: 'listings' }, el('h2', { textContent: 'Your listings' }));
  if (!p.listings.length) list.append(el('p', { className: 'mute', textContent: 'Posting listings is coming soon.' }));
  p.listings.forEach((l) => {
    const row = el('div', { className: 'item' }, el('span', { textContent: (l.kind === 'sell' ? 'Selling ' : 'Buying ') + l.item }));
    if (l.status === 'open') {
      row.append(el('span', { className: 'acts' },
        soonBtn('Mark done'), soonBtn('Delete')));
    }
    row.append(el('span', { className: 'tag' + (l.status === 'done' ? ' ok' : ''), textContent: l.status === 'done' ? 'Done' : 'Open' }));
    list.append(row);
  });

  const check = el('section', { className: 'card' }, el('h2', {}, 'Starter checklist', el('span', { className: 'cnt', textContent: doneCount + '/' + checks.length })));
  checks.forEach(([label, ok]) => check.append(el('div', { className: 'item' }, el('span', { textContent: label }), el('span', { className: 'tag' + (ok ? ' ok' : ''), textContent: ok ? 'Done' : 'Pending' }))));

  $('main').replaceChildren(head, shop, check, list);
}

async function init() {
  const me = await api('/api/me').catch(() => null);
  if (!me) return gate();
  try { render(me, await api('/api/profile')); } catch (e) { $('main').replaceChildren(el('div', { className: 'card mute', textContent: e.message })); }
}
init();
</script>
</body>
</html>
