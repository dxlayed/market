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
  mcss.textContent = `.um{position:relative}
.um-btn{display:flex;gap:10px;align-items:center;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:5px 12px 5px 6px;color:var(--text);text-align:left;cursor:pointer;font:inherit;font-weight:700}
.um-btn small{display:block;color:var(--gold);font-size:12px;font-weight:500;min-height:14px}
.um-pop{position:absolute;right:0;top:calc(100% + 8px);min-width:220px;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:8px;z-index:30;box-shadow:0 12px 40px #000a;display:grid;gap:2px}
.um-pop[hidden]{display:none}
.um-pop a,.um-pop button{display:block;width:100%;text-align:left;padding:9px 12px;border-radius:8px;background:transparent;border:0;color:var(--text);font:inherit;font-weight:700;font-size:14px;text-decoration:none;cursor:pointer}
.um-pop a:hover,.um-pop button:hover{background:var(--raise)}
.um-pop button.soon{opacity:.55;cursor:not-allowed}
.um-pop hr{border:0;border-top:1px solid var(--line);margin:6px 0;width:100%}`;
  document.head.append(mcss);

  window.RbxAuth.menu = function (u, onLogout) {
    const mk = (tag, props, ...kids) => { const e = document.createElement(tag); Object.assign(e, props); kids.forEach((k) => e.append(k)); return e; };
    const rk = mk('small');
    const btn = mk('button', { className: 'um-btn', type: 'button' }, window.avEl(u), mk('span', {}, mk('b', { textContent: u.username }), rk), document.createTextNode('\u25BE'));
    btn.setAttribute('aria-haspopup', 'true');
    const pop = mk('div', { className: 'um-pop' }); pop.hidden = true;
    const soon = (label) => mk('button', { className: 'soon', type: 'button', textContent: label + '  (Soon)', onclick: () => { if (typeof toast === 'function') toast(label + ' is coming soon'); } });
    const out = mk('button', { type: 'button', textContent: 'Log out', onclick: onLogout }); out.style.color = 'var(--bad)';
    if (u.owner) { const o = mk('a', { href: '/owner.html', textContent: 'Owner panel' }); o.style.color = 'var(--gold)'; pop.append(o, mk('hr')); }
    pop.append(mk('a', { href: '/profile.html', textContent: 'Profile' }), mk('a', { href: '/?seller=' + encodeURIComponent(u.username), textContent: 'My shop' }), mk('a', { href: '/support.html', textContent: 'Support' }), mk('hr'), soon('Deposit'), soon('Withdraw'), mk('hr'), out);
    const wrap = mk('div', { className: 'um' }, btn, pop);
    btn.onclick = (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; btn.setAttribute('aria-expanded', String(!pop.hidden)); };
    document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) pop.hidden = true; });
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
})();
