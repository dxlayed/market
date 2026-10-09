(function () {
  const css = document.createElement('style');
  css.textContent = `#rbxAuth{background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:16px;width:min(440px,92vw);padding:24px}
#rbxAuth::backdrop{background:#000b}
#rbxAuth [hidden]{display:none!important}
#rbxAuth h2{margin:0 0 6px;font-family:Outfit,system-ui,sans-serif}
#rbxAuth p,#rbxAuth li{color:var(--mute);font-size:14px;line-height:1.5;margin:0}
#rbxAuth ol{padding-left:20px;margin:0;display:grid;gap:6px}
#rbxAuth .col{display:flex;flex-direction:column;gap:12px}
#rbxAuth .code{background:var(--surface);border:1px dashed var(--gold);border-radius:10px;padding:14px;font-weight:700;font-size:15px;text-align:center;user-select:all;line-height:1.6}
#rbxAuth a{color:var(--gold)}
#rbxAuth .e{color:var(--bad);font-size:14px;min-height:18px}`;
  document.head.append(css);

  const d = document.createElement('dialog');
  d.id = 'rbxAuth';
  d.innerHTML = `
  <div class="col" id="s1">
    <h2>Log in with Roblox</h2>
    <p>No password needed. You prove the account is yours by putting a one-time code in your Roblox bio.</p>
    <input id="nm" placeholder="Your Roblox username" autocomplete="off" maxlength="20">
    <div class="e" id="e1"></div>
    <button class="btn" id="go">Get my code</button>
    <button class="ghost" id="cancel">Cancel</button>
  </div>
  <div class="col" id="s2" hidden>
    <h2>Add this code to your bio</h2>
    <p>Logging in as <b id="who"></b></p>
    <ol>
      <li>Copy the code below.</li>
      <li>On Roblox, open your <a href="https://www.roblox.com/users/profile" target="_blank" rel="noopener">profile</a>, press Edit profile, paste the code into your bio, and save.</li>
      <li>Come back here and press I changed it.</li>
    </ol>
    <div class="code" id="code"></div>
    <button class="ghost" id="copy">Copy code</button>
    <p>The code expires in 10 minutes. After you're in, you can delete it from your bio.</p>
    <div class="e" id="e2"></div>
    <button class="btn" id="done">I changed it</button>
    <button class="ghost" id="back">Back</button>
  </div>`;
  document.body.append(d);

  const $ = (s) => d.querySelector(s);
  let cb = null;
  async function post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Something went wrong');
    return j;
  }
  const step = (n) => { $('#s1').hidden = n !== 1; $('#s2').hidden = n !== 2; };

  async function start() {
    const b = $('#go'); b.disabled = true; b.textContent = 'Looking you up...'; $('#e1').textContent = '';
    try {
      const r = await post('/api/auth/start', { username: $('#nm').value.trim() });
      $('#code').textContent = r.code; $('#who').textContent = r.name; $('#copy').textContent = 'Copy code'; $('#e2').textContent = '';
      step(2);
    } catch (e) { $('#e1').textContent = e.message; }
    b.disabled = false; b.textContent = 'Get my code';
  }
  $('#go').onclick = start;
  $('#nm').addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });
  $('#cancel').onclick = () => d.close();
  $('#back').onclick = () => step(1);
  $('#copy').onclick = () => navigator.clipboard.writeText($('#code').textContent).then(() => { $('#copy').textContent = 'Copied'; });
  $('#done').onclick = async () => {
    const b = $('#done'); b.disabled = true; b.textContent = 'Checking your bio...'; $('#e2').textContent = '';
    try {
      const u = await post('/api/auth/verify');
      d.close();
      if (cb) cb(u);
      if (typeof toast === 'function') toast('Logged in as ' + u.username);
    } catch (e) { $('#e2').textContent = e.message; }
    b.disabled = false; b.textContent = 'I changed it';
  };

  window.RbxAuth = {
    open(fn) { cb = fn; $('#e1').textContent = ''; step(1); d.showModal(); $('#nm').focus(); },
  };


  const mcss = document.createElement('style');
  mcss.textContent = `.um{position:relative;display:flex;gap:10px;align-items:center}
.um-wallet{display:flex;align-items:stretch;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--surface)}
.um-wallet span{padding:8px 14px;font-weight:800;font-family:Outfit,system-ui,sans-serif;display:flex;align-items:center;gap:6px}
.um-wallet span small{color:var(--mute);font-weight:600;font-size:11px;font-family:Manrope,system-ui,sans-serif}
.um-wallet button{border:0;border-radius:0;padding:0 14px;background:var(--gold);color:#fff;font-size:18px;line-height:1;cursor:pointer}
.um-btn{display:flex;gap:10px;align-items:center;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:5px 12px 5px 6px;color:var(--text);text-align:left;cursor:pointer;font:inherit;font-weight:700}
.um-btn small{display:block;color:var(--gold);font-size:12px;font-weight:500;min-height:14px}
.um-pop{position:absolute;right:0;top:calc(100% + 8px);min-width:220px;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:8px;z-index:30;box-shadow:0 12px 40px #000a;display:grid;gap:2px}
.um-pop[hidden]{display:none}
.um-pop a,.um-pop button{display:block;width:100%;text-align:left;padding:9px 12px;border-radius:8px;background:transparent;border:0;color:var(--text);font:inherit;font-weight:700;font-size:14px;text-decoration:none;cursor:pointer}
.um-pop a:hover,.um-pop button:hover{background:var(--raise)}
.um-pop hr{border:0;border-top:1px solid var(--line);margin:6px 0;width:100%}
#fundsDlg{background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:16px;width:min(420px,92vw);padding:24px}
#fundsDlg::backdrop{background:#000b}
#fundsDlg h2{margin:0 0 6px;font-family:Outfit,system-ui,sans-serif}
#fundsDlg p{color:var(--mute);font-size:14px;line-height:1.5;margin:0 0 14px}
#fundsDlg .big{font-family:Outfit,system-ui,sans-serif;font-size:34px;font-weight:800;margin:4px 0 14px}
#fundsDlg .row{display:flex;gap:8px;flex-wrap:wrap}
@media (max-width:640px){.um-btn b,.um-btn small{display:none}}`;
  document.head.append(mcss);

  const money = (c) => '$' + ((c || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  window.money = money;
  const balEls = new Set();
  window.setBalance = (c) => { balEls.forEach((e) => (e.textContent = money(c))); };
  window.refreshBalance = () => fetch('/api/me').then((r) => r.json()).then((u) => { if (u) window.setBalance(u.balance); return u; }).catch(() => null);

  // Funds are added and paid out by owners by hand until a payment provider is connected.
  const fd = document.createElement('dialog');
  fd.id = 'fundsDlg';
  document.body.append(fd);
  window.openFunds = function (mode) {
    const add = mode !== 'out';
    fd.innerHTML = '';
    const h = document.createElement('h2'); h.textContent = add ? 'Add funds' : 'Cash out';
    const big = document.createElement('div'); big.className = 'big'; balEls.add(big);
    const lab = document.createElement('div'); lab.className = 'mute'; lab.textContent = 'Your balance'; lab.style.cssText = 'color:var(--mute);font-size:13px';
    const p = document.createElement('p');
    p.textContent = add
      ? 'Card checkout is coming soon. For now, open a support ticket saying how much you want to add and the team will top up your balance.'
      : 'Open a support ticket with the amount you want to cash out and how you want to be paid. The team will send it and take it off your balance.';
    const go = document.createElement('a'); go.className = 'btn'; go.textContent = add ? 'Open a ticket to add funds' : 'Request a cash out';
    go.href = '/support.html?subject=' + encodeURIComponent(add ? 'Add funds' : 'Cash out request');
    go.style.cssText = 'text-decoration:none;display:inline-block;padding:10px 16px;border-radius:10px;font-weight:700';
    const x = document.createElement('button'); x.className = 'ghost'; x.textContent = 'Close'; x.onclick = () => fd.close();
    const row = document.createElement('div'); row.className = 'row'; row.append(go, x);
    fd.append(h, lab, big, p, row);
    window.refreshBalance();
    fd.showModal();
  };

  window.RbxAuth.menu = function (u, onLogout) {
    const mk = (tag, props, ...kids) => { const e = document.createElement(tag); Object.assign(e, props); kids.forEach((k) => e.append(k)); return e; };
    const bal = mk('b', { textContent: money(u.balance) }); balEls.add(bal);
    const wallet = mk('div', { className: 'um-wallet' }, mk('span', {}, bal),
      mk('button', { type: 'button', textContent: '+', title: 'Add funds', onclick: () => window.openFunds('add') }));
    wallet.querySelector('button').setAttribute('aria-label', 'Add funds');
    const rk = mk('small');
    const btn = mk('button', { className: 'um-btn', type: 'button' }, window.avEl(u), mk('span', {}, mk('b', { textContent: u.username }), rk), document.createTextNode('▾'));
    btn.setAttribute('aria-haspopup', 'true');
    const pop = mk('div', { className: 'um-pop' }); pop.hidden = true;
    const out = mk('button', { type: 'button', textContent: 'Log out', onclick: onLogout }); out.style.color = 'var(--bad)';
    if (u.owner) { const o = mk('a', { href: '/owner.html', textContent: 'Owner panel' }); o.style.color = 'var(--gold)'; pop.append(o, mk('hr')); }
    pop.append(mk('a', { href: '/profile.html', textContent: 'Profile' }), mk('a', { href: '/?seller=' + encodeURIComponent(u.username), textContent: 'My shop' }),
      mk('a', { href: '/inventory.html', textContent: 'Inventory' }), mk('a', { href: '/profile.html#wallet', textContent: 'Transactions' }), mk('a', { href: '/support.html', textContent: 'Support' }), mk('hr'),
      mk('button', { type: 'button', textContent: 'Add funds', onclick: () => window.openFunds('add') }),
      mk('button', { type: 'button', textContent: 'Cash out', onclick: () => window.openFunds('out') }), mk('hr'), out);
    const box = mk('div', { className: 'um' }, btn, pop);
    const wrap = mk('div', { className: 'um' }, wallet, box);
    btn.onclick = (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; btn.setAttribute('aria-expanded', String(!pop.hidden)); };
    document.addEventListener('click', (e) => { if (!box.contains(e.target)) pop.hidden = true; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') pop.hidden = true; });
    fetch('/api/profile').then((r) => (r.ok ? r.json() : null)).then((p) => { if (p) rk.textContent = p.rank; }).catch(() => {});
    return wrap;
  };

  const scss = document.createElement('style');
  scss.textContent = `.soonbtn{opacity:.6;cursor:not-allowed}
.soonbtn i{font-style:normal;font-size:10px;font-weight:800;background:var(--raise);color:var(--gold);border-radius:6px;padding:1px 6px;margin-left:6px}`;
  document.head.append(scss);
  window.soonMsg = (label) => { if (typeof toast === 'function') toast(label + ' is coming soon'); };
  window.soonBtn = function (label, cls) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = (cls || 'ghost sm') + ' soonbtn';
    b.setAttribute('aria-disabled', 'true');
    b.append(label);
    const i = document.createElement('i'); i.textContent = 'Soon'; b.append(i);
    b.onclick = () => window.soonMsg(label);
    return b;
  };

  window.avEl = function (u) {
    const s = document.createElement('span');
    s.className = 'av';
    if (u.avatar && /^https:\/\/[\w.-]+\.rbxcdn\.com\//.test(u.avatar)) {
      s.style.backgroundImage = 'url("' + u.avatar + '")';
      s.style.backgroundSize = 'cover';
      s.style.backgroundPosition = 'center';
    } else {
      s.textContent = u.username[0].toUpperCase();
    }
    return s;
  };

  // ---------- Live chat drawer, on every page ----------
  if (!document.body.dataset.nochat) {
    const ccss = document.createElement('style');
    ccss.textContent = `#chatBtn{position:fixed;right:24px;bottom:24px;z-index:17;background:var(--gold);color:#fff;border:0;border-radius:99px;padding:13px 22px;font:inherit;font-weight:700;font-size:15px;box-shadow:0 6px 28px #e8202a66;display:flex;align-items:center;gap:8px;cursor:pointer}
#chatBtn[hidden]{display:none}
#chatBtn:hover{filter:brightness(1.12)}
#chatBtn .pulse{width:8px;height:8px;border-radius:50%;background:#fff;animation:chatpulse 1.8s infinite}
@keyframes chatpulse{0%{box-shadow:0 0 0 0 #fff8}70%{box-shadow:0 0 0 8px #fff0}100%{box-shadow:0 0 0 0 #fff0}}
#chatShade{position:fixed;inset:0;z-index:18;background:#000a;backdrop-filter:blur(3px);opacity:0;pointer-events:none;transition:opacity .3s}
#chatShade.open{opacity:1;pointer-events:auto}
#chat{position:fixed;top:0;right:0;bottom:0;z-index:19;width:min(420px,100vw);background:linear-gradient(180deg,#1a0d0d,#0e0808);border-left:2px solid var(--gold);display:flex;flex-direction:column;box-shadow:-24px 0 70px #000c;transform:translateX(105%);visibility:hidden;transition:transform .32s cubic-bezier(.4,0,.2,1),visibility 0s .32s}
#chat.open{transform:none;visibility:visible;transition:transform .32s cubic-bezier(.4,0,.2,1)}
#chat header{display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid var(--line);background:#0a0707}
#chat header h3{margin:0;font-family:Outfit,system-ui,sans-serif;font-size:18px;display:flex;align-items:center;gap:10px}
#chat header h3::before{content:"";width:9px;height:9px;border-radius:50%;background:var(--gold);box-shadow:0 0 10px var(--gold)}
#chatMsgs{flex:1;overflow-y:auto;padding:14px 18px;display:flex;flex-direction:column;gap:6px}
#chatMsgs .m{font-size:14px;word-break:break-word;background:#ffffff06;border:1px solid #ffffff0a;border-radius:10px;padding:8px 11px}
#chatMsgs .m.me{background:#e8202a1a;border-color:#e8202a44}
#chatMsgs .m b{color:var(--gold);margin-right:6px}#chatMsgs .m.me b{color:#ff9a9a}
#chatMsgs .m time{color:var(--mute);font-size:11px;margin-left:6px}
#chatForm{display:flex;gap:8px;padding:14px 18px;border-top:1px solid var(--line);background:#0a0707}
#chatForm[hidden]{display:none}
#chatForm input{flex:1;min-width:0}
#chatNote{padding:16px;text-align:center;color:var(--mute);font-size:14px;border-top:1px solid var(--line);background:#0a0707}
#chatNote button{margin-top:8px}
@media (prefers-reduced-motion:reduce){#chat,#chatShade{transition:none}#chatBtn .pulse{animation:none}}`;
    document.head.append(ccss);
    const wrapC = document.createElement('div');
    wrapC.innerHTML = `<button id="chatBtn" type="button"><span class="pulse"></span>Live chat</button>
<div id="chatShade"></div>
<aside id="chat" aria-label="Live chat">
  <header><h3>Live chat</h3><button class="ghost sm" id="chatClose" type="button" aria-label="Close chat">Close</button></header>
  <div id="chatMsgs"></div>
  <form id="chatForm" hidden><input id="chatIn" maxlength="200" placeholder="Say something..." autocomplete="off"><button class="btn sm">Send</button></form>
  <div id="chatNote" hidden>Log in to join the chat.<br><button class="btn sm" type="button" id="chatLogin">Log in with Roblox</button></div>
</aside>`;
    document.body.append(...wrapC.children);
    const q = (id) => document.getElementById(id);
    let chatMe = null, lastId = 0, timer = null;
    const say = (t) => (typeof toast === 'function' ? toast(t) : alert(t));
    function add(rows) {
      const box = q('chatMsgs');
      const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 60 || !lastId;
      rows.forEach((m) => {
        if (m.id <= lastId) return;
        lastId = m.id;
        const d = document.createElement('div'); d.className = 'm' + (chatMe && chatMe.id === m.user_id ? ' me' : '');
        const b = document.createElement('b'); b.textContent = m.username;
        const t = document.createElement('time'); t.textContent = new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        d.append(b, document.createTextNode(m.body), t); box.append(d);
      });
      if (stick) box.scrollTop = box.scrollHeight;
    }
    const poll = () => fetch('/api/chat' + (lastId ? '?after=' + lastId : '')).then((r) => r.json()).then(add).catch(() => {});
    async function openChat() {
      q('chat').classList.add('open'); q('chatShade').classList.add('open'); q('chatBtn').hidden = true;
      chatMe = await fetch('/api/me').then((r) => r.json()).catch(() => null);
      q('chatForm').hidden = !chatMe; q('chatNote').hidden = !!chatMe;
      clearInterval(timer); poll(); timer = setInterval(poll, 3000);
      setTimeout(() => (chatMe ? q('chatIn') : q('chatClose')).focus(), 320);
    }
    function closeChat() { q('chat').classList.remove('open'); q('chatShade').classList.remove('open'); q('chatBtn').hidden = false; clearInterval(timer); }
    q('chatBtn').onclick = openChat; q('chatClose').onclick = closeChat; q('chatShade').onclick = closeChat;
    q('chatLogin').onclick = () => { closeChat(); window.RbxAuth.open(() => location.reload()); };
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && q('chat').classList.contains('open')) closeChat(); });
    q('chatForm').onsubmit = async (e) => {
      e.preventDefault();
      const body = q('chatIn').value.trim(); if (!body) return;
      const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return say(j.error || 'Message failed');
      q('chatIn').value = ''; poll();
    };
    if (location.hash === '#chat') openChat();
  }
})();
