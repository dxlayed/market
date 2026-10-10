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
  function openFundsTicket(mode) {
    const add = mode !== 'out';
    fd.innerHTML = '';
    const h = document.createElement('h2'); h.textContent = add ? 'Add funds' : 'Withdraw';
    const big = document.createElement('div'); big.className = 'big'; balEls.add(big);
    const lab = document.createElement('div'); lab.className = 'mute'; lab.textContent = 'Your balance'; lab.style.cssText = 'color:var(--mute);font-size:13px';
    const p = document.createElement('p');
    p.textContent = add
      ? 'Open a support ticket saying how much you want to add and the team will top up your balance.'
      : 'Open a support ticket with the amount you want to withdraw and where to send it. The team will send it and take it off your balance.';
    const go = document.createElement('a'); go.className = 'btn'; go.textContent = add ? 'Open a ticket to add funds' : 'Request a withdrawal';
    go.href = '/support.html?subject=' + encodeURIComponent(add ? 'Add funds' : 'Withdrawal request');
    go.style.cssText = 'text-decoration:none;display:inline-block;padding:10px 16px;border-radius:10px;font-weight:700';
    const x = document.createElement('button'); x.className = 'ghost'; x.textContent = 'Close'; x.onclick = () => fd.close();
    const row = document.createElement('div'); row.className = 'row'; row.append(go, x);
    fd.append(h, lab, big, p, row);
    window.refreshBalance();
    fd.showModal();
  }

  // ---------- Crypto deposit / withdraw (used when the server has BTC_XPUB or LTC_XPUB set) ----------
  const ccss2 = document.createElement('style');
  ccss2.textContent = `#cxDlg{background:#0d0808;color:var(--text);border:1px solid #4a1a1a;border-radius:20px;width:min(720px,96vw);max-height:92vh;padding:0;overflow:hidden}
#cxDlg::backdrop{background:#000c;backdrop-filter:blur(3px)}
#cxDlg[open]{display:flex;flex-direction:column}
#cxDlg .hd{display:flex;align-items:center;gap:6px;padding:16px 18px;border-bottom:1px solid var(--line)}
#cxDlg .tab{background:transparent;border:0;color:var(--mute);font:inherit;font-weight:800;font-size:16px;padding:8px 14px;border-radius:10px;cursor:pointer;font-family:Outfit,system-ui,sans-serif}
#cxDlg .tab.on{background:var(--gold);color:#fff}
#cxDlg .x{margin-left:auto;background:transparent;border:0;color:var(--mute);font-size:22px;cursor:pointer;padding:4px 10px}
#cxDlg .bd{padding:18px;overflow:auto}
#cxDlg .bals{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px}
#cxDlg .bals div{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:12px 14px}
#cxDlg .bals b{display:block;font-family:Outfit,system-ui,sans-serif;font-size:24px}
#cxDlg .bals span{color:var(--mute);font-size:12px;font-weight:700}
#cxDlg .coins{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
#cxDlg .coin{display:flex;flex-direction:column;align-items:center;gap:6px;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px 10px;cursor:pointer;color:var(--text);font:inherit}
#cxDlg .coin:hover{border-color:#6a2222}
#cxDlg .coin.on{border-color:var(--gold);background:linear-gradient(180deg,#e8202a1c,var(--surface))}
#cxDlg .coin svg{width:40px;height:40px}
#cxDlg .coin b{font-family:Outfit,system-ui,sans-serif;font-size:16px}
#cxDlg .coin small{color:var(--mute);font-weight:700}
#cxDlg h3{font-family:Outfit,system-ui,sans-serif;font-size:20px;margin:22px 0 12px}
#cxDlg .warn{background:#ff7a4514;border:1px solid #ff7a4566;color:#ffc2a8;border-radius:12px;padding:10px 14px;font-size:14px;line-height:1.45}
#cxDlg .dep{display:grid;grid-template-columns:auto 1fr;gap:18px;align-items:center;margin-top:14px}
#cxDlg .qr{width:170px;height:170px;background:#fff;border-radius:14px;padding:8px}
#cxDlg .qr svg{width:100%;height:100%;display:block}
#cxDlg label{display:block;color:var(--mute);font-size:12px;font-weight:800;margin:0 0 6px}
#cxDlg .addr{display:flex;gap:8px;align-items:center;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:8px 8px 8px 12px}
#cxDlg .addr code{flex:1;min-width:0;overflow-wrap:anywhere;font-size:14px;font-family:ui-monospace,Menlo,Consolas,monospace}
#cxDlg .note{color:var(--mute);font-size:13px;line-height:1.5;margin-top:10px}
#cxDlg input{width:100%}
#cxDlg .amt{display:grid;grid-template-columns:1fr 1fr;gap:10px}
#cxDlg .sum{display:flex;justify-content:space-between;font-size:14px;padding:6px 2px}
#cxDlg .sum.big{font-weight:800;font-size:16px;border-top:1px solid var(--line);margin-top:4px;padding-top:10px}
#cxDlg .go{width:100%;margin-top:12px;padding:13px;font-size:15px}
#cxDlg .err{color:var(--bad);font-size:13px;min-height:18px;margin-top:8px}
#cxDlg .hist{display:grid;gap:6px}
#cxDlg .hr{display:flex;justify-content:space-between;gap:10px;align-items:center;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:9px 12px;font-size:14px}
#cxDlg .hr small{display:block;color:var(--mute);font-size:12px}
#cxDlg .pill{font-size:11px;font-weight:800;border-radius:99px;padding:3px 10px;background:var(--raise);color:var(--mute);white-space:nowrap}
#cxDlg .pill.ok{background:#4ade8022;color:#4ade80}#cxDlg .pill.wait{background:#e8202a22;color:#ff8a8f}#cxDlg .pill.bad{background:#ff7a4522;color:var(--bad)}
@media (max-width:560px){#cxDlg .dep{grid-template-columns:1fr;justify-items:center}#cxDlg .amt{grid-template-columns:1fr}}`;
  document.head.append(ccss2);
  const COIN_ICON = {
    btc: '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="#f7931a"/><path fill="#fff" d="M27.6 17.6c.4-2.6-1.6-4-4.3-4.9l.9-3.5-2.1-.5-.8 3.4-1.7-.4.9-3.4-2.1-.5-.9 3.5-1.4-.3-2.9-.7-.6 2.3s1.6.4 1.5.4c.9.2 1 .8 1 1.2l-1 3.9.2.1-.2-.1-1.4 5.5c-.1.3-.4.7-1 .5l-1.5-.4-1 2.4 2.8.7 1.5.4-.9 3.6 2.1.5.9-3.5 1.7.4-.9 3.5 2.1.5.9-3.6c3.6.7 6.4.4 7.5-2.9.9-2.6 0-4.1-1.9-5.1 1.4-.3 2.4-1.2 2.7-3.1zm-4.8 6.8c-.6 2.6-5 1.2-6.4.8l1.2-4.6c1.4.4 6 1.1 5.2 3.8zm.7-6.8c-.6 2.4-4.2 1.2-5.4.9l1-4.2c1.2.3 5 .9 4.4 3.3z"/></svg>',
    ltc: '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="#bfbbbb"/><path fill="#fff" d="M14.4 30h13.4l.9-3.3h-9.3l1.5-5.6 2.6-1 .6-2.3-2.6 1 2.1-7.8h-4.7l-2.7 10.1-2.3.9-.6 2.3 2.3-.9z"/></svg>',
  };
  const cd = document.createElement('dialog'); cd.id = 'cxDlg'; document.body.append(cd);
  let cxInfo = null, cxTimer = null;
  const usdC = (c) => money(c);
  const elx = (t, p = {}, ...k) => { const e = document.createElement(t); for (const [a, v] of Object.entries(p)) { if (a.includes('-')) e.setAttribute(a, v); else e[a] = v; } k.forEach((x) => x != null && e.append(x)); return e; };
  const jget = (u) => fetch(u).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Something went wrong'); return j; });
  const jpost = (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Something went wrong'); return j; });
  const fmtCoin = (sats) => (sats / 1e8).toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
  const minutes = (c) => (c.id === 'btc' ? c.confirmations * 10 : Math.ceil(c.confirmations * 2.5));

  async function openCrypto(mode, coinId) {
    try { cxInfo = await jget('/api/crypto'); } catch { cxInfo = null; }
    if (!cxInfo || !cxInfo.coins.length) return openFundsTicket(mode);
    let tab = mode === 'out' ? 'out' : 'in', coin = coinId || null;
    const close = () => { clearInterval(cxTimer); cd.close(); };
    function draw() {
      clearInterval(cxTimer);
      const tabs = [['in', 'Deposit'], ['out', 'Withdraw']].map(([k, l]) => elx('button', { className: 'tab' + (tab === k ? ' on' : ''), type: 'button', textContent: l, onclick: () => { tab = k; draw(); } }));
      const bd = elx('div', { className: 'bd' });
      bd.append(elx('div', { className: 'bals' },
        elx('div', {}, elx('span', { textContent: 'Total balance' }), elx('b', { textContent: usdC(cxInfo.balance || 0) })),
        elx('div', {}, elx('span', { textContent: 'Withdrawable' }), elx('b', { textContent: usdC(cxInfo.withdrawable || 0) }))));
      const grid = elx('div', { className: 'coins' });
      cxInfo.coins.forEach((c) => {
        const b = elx('button', { className: 'coin' + (coin === c.id ? ' on' : ''), type: 'button', onclick: () => { coin = c.id; draw(); } });
        b.innerHTML = COIN_ICON[c.id] || '';
        b.append(elx('b', { textContent: c.name }), elx('small', { textContent: c.price ? '$' + c.price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : 'Price loading' }));
        grid.append(b);
      });
      bd.append(elx('label', { textContent: tab === 'in' ? 'Pick a coin to deposit' : 'Pick a coin to receive' }), grid);
      const c = cxInfo.coins.find((x) => x.id === coin);
      if (!cxInfo.open) bd.append(elx('p', { className: 'note', textContent: 'Crypto deposits and withdrawals are paused right now.' }));
      else if (c && tab === 'in') depositPane(bd, c);
      else if (c && tab === 'out') withdrawPane(bd, c);
      cd.replaceChildren(elx('div', { className: 'hd' }, ...tabs, elx('button', { className: 'x', type: 'button', textContent: '×', 'aria-label': 'Close', onclick: close })), bd);
    }
    async function depositPane(bd, c) {
      const box = elx('div', {}, elx('h3', { textContent: 'Deposit ' + c.name }), elx('p', { className: 'note', textContent: 'Getting your address...' }));
      bd.append(box);
      let a;
      try { a = await jpost('/api/crypto/address', { coin: c.id }); } catch (e) { box.replaceChildren(elx('div', { className: 'err', textContent: e.message })); return; }
      const qr = elx('div', { className: 'qr' }); qr.innerHTML = a.qr;
      const copy = elx('button', { className: 'btn sm', type: 'button', textContent: 'Copy', onclick: () => navigator.clipboard.writeText(a.address).then(() => { copy.textContent = 'Copied'; setTimeout(() => (copy.textContent = 'Copy'), 1500); }) });
      const hist = elx('div', { className: 'hist' });
      box.replaceChildren(elx('h3', { textContent: 'Deposit ' + c.name }),
        elx('div', { className: 'warn', textContent: 'Only send ' + c.name + ' (' + c.symbol + ') to this address. Sending any other coin, or using the wrong network, loses it for good.' }),
        elx('div', { className: 'dep' }, qr, elx('div', {},
          elx('label', { textContent: 'Your personal ' + c.symbol + ' address' }), elx('div', { className: 'addr' }, elx('code', { textContent: a.address }), copy),
          elx('p', { className: 'note', textContent: 'Send any amount over ' + usdC(cxInfo.min_deposit) + '. We spot it within seconds and add it to your balance after ' + c.confirmations + ' confirmation' + (c.confirmations === 1 ? '' : 's') + ' (about ' + minutes(c) + ' minutes). This address is yours to reuse anytime.' }))),
        elx('h3', { textContent: 'Your deposits' }), hist);
      const load = async () => {
        let h; try { h = await jget('/api/crypto/history'); } catch { return; }
        const rows = h.deposits.filter((d) => d.coin === c.id);
        hist.replaceChildren(...(rows.length ? rows.map((d) => elx('div', { className: 'hr' },
          elx('div', {}, elx('b', { textContent: fmtCoin(d.amount_sats) + ' ' + c.symbol + ' · ' + usdC(d.usd_cents) }), elx('small', { textContent: new Date(d.created_at).toLocaleString() })),
          elx('span', { className: 'pill ' + (d.status === 'credited' ? 'ok' : d.status === 'pending' ? 'wait' : 'bad'),
            textContent: d.status === 'credited' ? 'Added to balance' : d.status === 'pending' ? 'Confirming ' + Math.min(d.confirmations, d.needed) + '/' + d.needed : 'Below minimum' }))) : [elx('p', { className: 'note', textContent: 'Nothing yet. Deposits show up here as soon as they hit the network.' })]));
        refreshBalance();
      };
      load(); cxTimer = setInterval(async () => { await load(); try { const i = await jget('/api/crypto'); cxInfo.balance = i.balance; cxInfo.withdrawable = i.withdrawable; } catch {} }, 8000);
    }
    function withdrawPane(bd, c) {
      const addr = elx('input', { placeholder: 'Paste your ' + c.name + ' address', autocomplete: 'off', spellcheck: false });
      const amt = elx('input', { placeholder: '0.00', inputMode: 'decimal' });
      const est = elx('input', { placeholder: '0', disabled: true });
      const fee = c.fee_cents, recv = elx('span'), err = elx('div', { className: 'err' });
      const go = elx('button', { className: 'btn go', type: 'button', textContent: 'Withdraw' });
      const upd = () => {
        const v = parseFloat(String(amt.value).replace(/^\$/, '')) || 0, cents = Math.round(v * 100), net = Math.max(0, cents - fee);
        est.value = c.price && net ? (net / 100 / c.price).toFixed(8) + ' ' + c.symbol : '';
        recv.textContent = usdC(net);
      };
      amt.oninput = upd; upd();
      const max = elx('button', { className: 'ghost sm', type: 'button', textContent: 'Max', onclick: () => { amt.value = ((cxInfo.withdrawable || 0) / 100).toFixed(2); upd(); } });
      const hist = elx('div', { className: 'hist' });
      go.onclick = async () => {
        err.textContent = ''; go.disabled = true;
        try {
          const r = await jpost('/api/crypto/withdraw', { coin: c.id, address: addr.value, amount: amt.value });
          setBalance(r.balance); cxInfo = await jget('/api/crypto'); if (typeof toast === 'function') toast('Withdrawal requested. You will get it as soon as staff send it.'); draw();
        } catch (e) { err.textContent = e.message; }
        go.disabled = false;
      };
      bd.append(elx('h3', { textContent: 'Withdraw ' + c.name }),
        elx('label', { textContent: 'Receiving ' + c.name + ' address' }), addr,
        elx('label', { style: 'margin-top:14px;display:flex;justify-content:space-between;align-items:center' }, elx('span', { textContent: 'Amount (USD)' }), max),
        elx('div', { className: 'amt' }, amt, est),
        elx('div', { style: 'margin-top:10px' },
          elx('div', { className: 'sum' }, elx('span', { className: 'mute', textContent: 'Network fee' }), elx('span', { textContent: usdC(fee) })),
          elx('div', { className: 'sum big' }, elx('span', { textContent: 'You receive' }), recv)),
        go, err,
        elx('p', { className: 'note', textContent: 'Minimum ' + usdC(cxInfo.min_withdraw) + '. Money you deposited has to be spent on items first. Money from sales can be withdrawn anytime. The coin amount is an estimate and may shift slightly with the price.' }),
        elx('h3', { textContent: 'Your withdrawals' }), hist);
      jget('/api/crypto/history').then((h) => {
        const rows = h.withdrawals.filter((w) => w.coin === c.id);
        hist.replaceChildren(...(rows.length ? rows.map((w) => elx('div', { className: 'hr' },
          elx('div', {}, elx('b', { textContent: usdC(w.usd_cents) + (w.coin_amount ? ' · ~' + w.coin_amount.replace(/0+$/, '') + ' ' + c.symbol : '') }), elx('small', { textContent: w.address })),
          w.status === 'paid' && w.txid ? elx('a', { className: 'pill ok', href: (c.id === 'btc' ? 'https://mempool.space/tx/' : 'https://litecoinspace.org/tx/') + w.txid, target: '_blank', rel: 'noopener', textContent: 'Sent' })
            : elx('span', { className: 'pill ' + (w.status === 'pending' ? 'wait' : 'bad'), textContent: w.status === 'pending' ? 'Waiting to send' : 'Refunded' }))) : [elx('p', { className: 'note', textContent: 'No withdrawals yet.' })]));
      }).catch(() => {});
    }
    draw();
    cd.onclose = () => clearInterval(cxTimer);
    if (!cd.open) cd.showModal();
  }
  window.openFunds = (mode) => openCrypto(mode);

  // ---------- Top bar: Withdraw menu, wallet + quick actions, Item Deposit and Withdraw Items windows ----------
  const qcss = document.createElement('style');
  qcss.textContent = `.um-wd{position:relative}
.um-wdbtn{display:flex;align-items:center;gap:8px;height:100%;background:linear-gradient(180deg,#3a1012,#220a0b);border:1px solid #7a1c20;color:#ffd9d9;border-radius:12px;padding:8px 14px;font:inherit;font-weight:800;cursor:pointer}
.um-wdbtn:hover{border-color:var(--gold);box-shadow:0 0 18px #e8202a33}
.um-wdbtn svg{width:18px;height:18px}.um-wdbtn .car{font-size:11px;opacity:.8}
.um-wallet .plus{display:flex;align-items:center;justify-content:center;width:42px;font-size:22px;font-weight:800}
.qa{position:absolute;right:0;top:calc(100% + 10px);width:300px;background:#120a0a;border:1px solid var(--line);border-radius:16px;padding:14px;z-index:31;box-shadow:0 18px 50px #000c;display:grid;gap:10px}
.qa[hidden]{display:none}
.qa h4{margin:2px 4px 2px;font-size:12px;letter-spacing:.08em;color:#d8c6c6;font-weight:800}
.qa button{display:flex;align-items:center;gap:14px;width:100%;text-align:left;background:#1a0f0f;border:1px solid var(--line);border-radius:14px;padding:12px;color:var(--text);font:inherit;cursor:pointer}
.qa button:hover{border-color:#7a1c20;background:#211212}
.qa .ic{flex:none;width:42px;height:42px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:linear-gradient(180deg,#e8202a33,#8f0d1433);border:1px solid #e8202a55;color:#ff5a61}
.qa .ic svg{width:22px;height:22px}
.qa b{display:block;font-family:Outfit,system-ui,sans-serif;font-size:16px}.qa small{color:var(--mute);font-weight:600}
.wdm{position:absolute;right:0;top:calc(100% + 10px);min-width:220px;background:#120a0a;border:1px solid var(--line);border-radius:14px;padding:8px;z-index:31;box-shadow:0 18px 50px #000c;display:grid;gap:2px}
.wdm[hidden]{display:none}
.wdm button{display:flex;align-items:center;gap:12px;width:100%;background:transparent;border:0;border-radius:10px;padding:10px 12px;color:#e4d6d6;font:inherit;font-weight:700;font-size:15px;cursor:pointer;text-align:left}
.wdm button:hover{background:#1e1111;color:#fff}.wdm svg{width:22px;height:22px;color:#ff5a61}
.sdlg{background:#100909;color:var(--text);border:1px solid #3a1717;border-radius:20px;width:min(480px,94vw);max-height:92vh;padding:0;overflow:hidden}
.sdlg[open]{display:flex;flex-direction:column}
.sdlg::backdrop{background:#000c;backdrop-filter:blur(3px)}
.sdlg .hd{display:flex;align-items:center;gap:14px;padding:20px 20px 16px;border-bottom:1px solid var(--line)}
.sdlg .hd .ic{flex:none;width:48px;height:48px;border-radius:14px;display:flex;align-items:center;justify-content:center;background:linear-gradient(180deg,#e8202a44,#8f0d1444);border:1px solid #e8202a66;color:#ff5a61}
.sdlg .hd .ic svg{width:24px;height:24px}
.sdlg .hd h2{margin:0;font-family:Outfit,system-ui,sans-serif;font-size:21px;letter-spacing:.02em;text-transform:uppercase}
.sdlg .hd p{margin:2px 0 0;color:var(--mute);font-size:14px}
.sdlg .x{margin-left:auto;align-self:flex-start;background:transparent;border:0;color:var(--mute);font-size:22px;line-height:1;cursor:pointer;padding:2px 6px}
.sdlg .x:hover{color:#fff}
.sdlg .bd{padding:16px 20px;overflow:auto;display:grid;gap:14px}
.sdlg .warn{display:flex;gap:10px;background:#2a1a08;border:1px solid #6b4a14;color:#f3c45a;border-radius:14px;padding:12px 14px;font-size:14px;font-weight:700;line-height:1.45}
.sdlg .warn svg{flex:none;width:18px;height:18px;margin-top:2px}
.sdlg .lab{display:flex;justify-content:space-between;align-items:center;font-size:12px;font-weight:800;letter-spacing:.06em;color:#d8c6c6;text-transform:uppercase}
.sdlg .lab button{background:none;border:0;color:#ff5a61;font:inherit;font-weight:800;text-transform:none;letter-spacing:0;font-size:14px;cursor:pointer;padding:0}
.botc{background:#170e0e;border:1px solid var(--line);border-radius:16px;padding:14px;display:grid;gap:12px}
.botc .top{display:flex;align-items:center;gap:12px}
.botc .av{position:relative;width:50px;height:50px;border-radius:14px;background:#2a1616 center/cover;display:flex;align-items:center;justify-content:center;font-family:Outfit,system-ui,sans-serif;font-weight:900;font-size:22px;color:#ff5a61;flex:none;border:1px solid var(--line)}
.botc .av i{position:absolute;right:-3px;bottom:-3px;width:13px;height:13px;border-radius:99px;background:#6b6b6b;border:2px solid #170e0e}
.botc.on .av i{background:#4ade80}
.botc .nm{flex:1;min-width:0}
.botc .nm b{display:block;font-family:Outfit,system-ui,sans-serif;font-size:18px;overflow-wrap:anywhere}
.botc .nm small{color:var(--mute);font-weight:700;display:flex;align-items:center;gap:6px}
.botc .nm small::before{content:"";width:7px;height:7px;border-radius:99px;background:#6b6b6b}
.botc.on .nm small{color:#4ade80}.botc.on .nm small::before{background:#4ade80}
.botc .cp{width:40px;height:40px;border-radius:12px;background:#221313;border:1px solid var(--line);display:flex;align-items:center;justify-content:center;cursor:pointer;color:#e4d6d6;padding:0}
.botc .cp svg{width:17px;height:17px}
.botc .acts{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.botc .acts a{display:flex;align-items:center;justify-content:center;gap:8px;border-radius:12px;padding:12px;font-weight:800;text-decoration:none;font-size:15px}
.botc .acts svg{width:17px;height:17px}
.botc .fr{background:#2a1214;border:1px solid #6b1c20;color:#ff9a9e}.botc .fr:hover{border-color:var(--gold)}
.botc .js{background:var(--gold);color:#fff;box-shadow:0 6px 24px #e8202a44}.botc .js:hover{filter:brightness(1.12)}
.bsteps{display:grid;gap:10px}
.bsteps>div{display:flex;gap:12px;background:#170e0e;border:1px solid var(--line);border-radius:14px;padding:12px 14px}
.bsteps>div>span{flex:none;width:28px;height:28px;border-radius:99px;display:flex;align-items:center;justify-content:center;background:#2a1214;border:1px solid #6b1c20;color:#ff5a61;font-weight:800;font-size:13px}
.bsteps b{display:block;font-family:Outfit,system-ui,sans-serif;font-size:16px}.bsteps p{margin:2px 0 0;color:var(--mute);font-size:14px;line-height:1.45}
.wrow{display:flex;align-items:center;gap:12px;background:#170e0e;border:1px solid var(--line);border-radius:16px;padding:10px 12px}
.wrow.sel{border-color:#a3262b;background:linear-gradient(90deg,#e8202a14,#170e0e)}
.wrow .ph{width:58px;height:58px;flex:none;border-radius:12px;background:#0d0707;display:flex;align-items:center;justify-content:center;overflow:hidden}
.wrow .ph img{width:100%;height:100%;object-fit:contain}
.wrow .nm{flex:1;min-width:0}.wrow .nm b{display:block;font-family:Outfit,system-ui,sans-serif;font-size:17px}
.wrow .nm small{display:flex;align-items:center;gap:8px;color:#e4d6d6;font-weight:700;font-size:13px;margin-top:4px}
.wrow .rp{font-size:11px;font-weight:800;letter-spacing:.04em;border-radius:7px;padding:2px 7px;border:1px solid currentColor;text-transform:uppercase}
.wrow .stp{display:flex;align-items:center;background:#221313;border:1px solid var(--line);border-radius:12px;padding:3px}
.wrow .stp button{width:34px;height:34px;border:0;border-radius:9px;background:transparent;color:#fff;font-size:20px;font-weight:800;cursor:pointer;padding:0}
.wrow .stp button:hover:not(:disabled){background:#341b1b}.wrow .stp button:disabled{opacity:.35;cursor:default}
.wrow .stp em{min-width:30px;text-align:center;font-style:normal;font-weight:800}
.sdlg .ft{display:flex;align-items:center;gap:10px;padding:14px 20px;border-top:1px solid var(--line);background:#0d0707}
.sdlg .ft .wsum{flex:1;display:block}.sdlg .ft .wsum b{display:block}.sdlg .ft .wsum small{color:#ff5a61;font-weight:800}
.sdlg .ft .cl{background:#221313;border:1px solid var(--line);border-radius:12px;padding:12px 20px;font-weight:800;cursor:pointer}
.sdlg .ft .go{display:flex;align-items:center;gap:8px;background:var(--gold);color:#fff;border:0;border-radius:12px;padding:12px 22px;font-weight:800;cursor:pointer}
.sdlg .ft .go:disabled{opacity:.45;cursor:default}.sdlg .ft .go svg{width:17px;height:17px}
.sdlg .empty{color:var(--mute);text-align:center;padding:26px 10px;font-size:14px}
.sdlg .pend{display:flex;align-items:center;gap:10px;background:#1c1010;border:1px solid #6b1c20;border-radius:14px;padding:10px 12px;font-size:14px}
.sdlg .pend span{flex:1}.sdlg .pend button{background:var(--gold);color:#fff;border:0;border-radius:10px;padding:8px 12px;font-weight:800;cursor:pointer}
@media (max-width:640px){.um-wdbtn .t{display:none}.qa,.wdm{position:fixed;left:16px;right:16px;width:auto}}`;
  document.head.append(qcss);

  const IC = {
    wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18M16 14.5h2"/></svg>',
    cardIn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="12" rx="2.5"/><path d="M3 9h18M12 13v7M9 17l3 3 3-3"/></svg>',
    boxIn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M12 9v6M9.5 12.5L12 15l2.5-2.5"/></svg>',
    boxOut: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M12 15V9M9.5 11.5L12 9l2.5 2.5"/></svg>',
    coinOut: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="7"/><path d="M12 10v6M9.5 12.5L12 10l2.5 2.5M12 2v2"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l9 4v6c0 5-3.8 9.3-9 10-5.2-.7-9-5-9-10V6z"/><path d="M12 7v6M12 16v.5" stroke="#2a1a08" stroke-width="2.2" stroke-linecap="round"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 10"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l12.5-7.5z"/></svg>',
  };
  const RCOL = { Chroma: '#b78bff', Ancient: '#7c5cff', Godly: '#d94fd0', Unique: '#e6b422', Vintage: '#d9b98a', Legendary: '#ff4d4d', Rare: '#2fb36a', Uncommon: '#4d7cff', Common: '#8a8fa3' };
  const ex = (t, p = {}, ...k) => { const e = document.createElement(t); for (const [a, v] of Object.entries(p)) { if (a === 'html') e.innerHTML = v; else if (a.includes('-')) e.setAttribute(a, v); else e[a] = v; } k.forEach((x) => x != null && e.append(x)); return e; };
  const sdlg = (id) => { let x = document.getElementById(id); if (!x) { x = ex('dialog', { id, className: 'sdlg' }); x.addEventListener('click', (e) => { if (e.target === x) x.close(); }); document.body.append(x); } return x; };
  const head = (dlg, icon, title, sub) => ex('div', { className: 'hd' }, ex('div', { className: 'ic', html: icon }), ex('div', {}, ex('h2', { textContent: title }), sub ? ex('p', { textContent: sub }) : null), ex('button', { className: 'x', type: 'button', textContent: '×', 'aria-label': 'Close', onclick: () => dlg.close() }));
  let tinfo = null;
  const tradingInfo = async () => tinfo || (tinfo = await jget('/api/trading-info').catch(() => ({ rec_per_1k: 20 })));

  // Item Deposit (also used after a withdrawal: join the same bot to receive)
  window.openItemDeposit = async function (mode) {
    const recv = mode === 'receive';
    const dlg = sdlg('botDlg');
    const list = ex('div', { style: 'display:grid;gap:10px' }, ex('div', { className: 'empty', textContent: 'Loading bots...' }));
    const lab = ex('div', { className: 'lab' }, ex('span', { textContent: 'Bots' }));
    dlg.replaceChildren(
      head(dlg, recv ? IC.boxOut : IC.boxIn, recv ? 'Receive items' : 'Item Deposit', recv ? 'Join the bot below and it will trade you your items.' : 'Join a bot below to deposit your items.'),
      ex('div', { className: 'bd' },
        ex('div', { className: 'warn' }, ex('span', { html: IC.warn }), ex('span', { textContent: "Always double-check the bot's exact username above. Scammers impersonate our bots — never trade with anyone else, and we'll never DM you first." })),
        lab, list,
        ex('div', { className: 'bsteps' },
          ex('div', {}, ex('span', { textContent: '1' }), ex('div', {}, ex('b', { textContent: 'Under 13? Add as friend' }), ex('p', { textContent: 'Roblox restricts under-13 accounts from joining servers without being friends first.' }))),
          ex('div', {}, ex('span', { textContent: '2' }), ex('div', {}, ex('b', { textContent: 'Join the private server' }), ex('p', { textContent: recv ? 'The bot will trade you the items you withdrew once you are in. Accept it to finish.' : 'Bring the items you want to deposit. The bot will trade you once you\'re in, and the items show up in your inventory right after.' }))))));
    if (!dlg.open) dlg.showModal();
    let bots = [];
    try { bots = await jget('/api/bots'); } catch {}
    const on = bots.filter((b) => b.online).length;
    lab.firstChild.textContent = on + (on === 1 ? ' bot' : ' bots') + ' online · join any to ' + (recv ? 'receive' : 'deposit');
    list.replaceChildren(...(bots.length ? bots.map((b) => {
      const av = ex('div', { className: 'av' }, ex('i'));
      if (b.avatar && /^https:\/\/[\w.-]+\.rbxcdn\.com\//.test(b.avatar)) av.style.backgroundImage = 'url("' + b.avatar + '")'; else av.prepend(b.username[0].toUpperCase());
      const cp = ex('button', { className: 'cp', type: 'button', title: 'Copy username', 'aria-label': 'Copy username', html: IC.copy });
      cp.onclick = () => navigator.clipboard.writeText(b.username).then(() => { cp.innerHTML = IC.check; if (typeof toast === 'function') toast('Copied ' + b.username); setTimeout(() => (cp.innerHTML = IC.copy), 1500); });
      return ex('div', { className: 'botc' + (b.online ? ' on' : '') },
        ex('div', { className: 'top' }, av, ex('div', { className: 'nm' }, ex('b', { textContent: b.username }), ex('small', { textContent: b.online ? 'Online' : 'Offline' })), cp),
        ex('div', { className: 'acts' },
          ex('a', { className: 'fr', href: b.profile, target: '_blank', rel: 'noopener', html: IC.check + '<span>Friends</span>' }),
          ex('a', { className: 'js', href: b.link, target: '_blank', rel: 'noopener', html: IC.play + '<span>Join Server</span>' })));
    }) : [ex('div', { className: 'empty', textContent: 'No bots right now. Ask in our Discord.' })]));
  };

  // Withdraw Items
  window.openItemWithdraw = async function (preselect) {
    const dlg = sdlg('wdDlg');
    const info = await tradingInfo();
    let inv = [], trades = [];
    try { [inv, trades] = await Promise.all([jget('/api/inventory'), jget('/api/trades').catch(() => [])]); } catch (e) { if (typeof toast === 'function') toast(e.message, true); return; }
    const groups = new Map();
    for (const i of inv.filter((x) => x.status === 'held')) {
      if (!groups.has(i.item_id)) groups.set(i.item_id, { ...i, ids: [], pick: 0 });
      groups.get(i.item_id).ids.push(i.id);
    }
    const pre = new Set((preselect || []).map(Number));
    groups.forEach((g) => { g.pick = g.ids.filter((id) => pre.has(id)).length; });
    if (!pre.size && groups.size === 1) groups.forEach((g) => (g.pick = 1));
    const recC = (v) => Math.round((Number(v) || 0) * (info.rec_per_1k || 20) / 10);
    const rows = ex('div', { style: 'display:grid;gap:10px' });
    const lab = ex('span');
    const selB = ex('b'), estS = ex('small');
    const go = ex('button', { className: 'go', type: 'button', html: IC.boxOut + '<span>Withdraw</span>' });
    function upd() {
      let n = 0, c = 0;
      groups.forEach((g) => { n += g.pick; c += g.pick * recC(g.value); });
      selB.textContent = n + ' selected'; estS.textContent = '≈ ' + money(c); go.disabled = !n;
    }
    function draw() {
      lab.textContent = 'Withdrawable - ' + [...groups.values()].reduce((a, g) => a + g.ids.length, 0);
      rows.replaceChildren(...(groups.size ? [...groups.values()].map((g) => {
        const ph = ex('div', { className: 'ph' });
        if (g.image_url && /^(https:\/\/|\/img\/item\/|\/items\/)/.test(g.image_url)) ph.append(ex('img', { src: g.image_url, alt: '', referrerPolicy: 'no-referrer', loading: 'lazy' }));
        const qty = ex('em', { textContent: String(g.pick) });
        const minus = ex('button', { type: 'button', textContent: '−', 'aria-label': 'Less' });
        const plus = ex('button', { type: 'button', textContent: '+', 'aria-label': 'More' });
        const row = ex('div', { className: 'wrow' }, ph,
          ex('div', { className: 'nm' }, ex('b', { textContent: g.name }), ex('small', {}, ex('span', { className: 'rp', textContent: g.rarity, style: 'color:' + (RCOL[g.rarity] || RCOL.Common) }), ex('span', { textContent: g.ids.length + ' available' }))),
          ex('div', { className: 'stp' }, minus, qty, plus));
        const set = (v) => { g.pick = Math.max(0, Math.min(g.ids.length, v)); qty.textContent = g.pick; minus.disabled = !g.pick; plus.disabled = g.pick >= g.ids.length; row.classList.toggle('sel', g.pick > 0); upd(); };
        minus.onclick = () => set(g.pick - 1); plus.onclick = () => set(g.pick + 1);
        if (typeof window.valueTip === 'function') window.valueTip(ph, g);
        set(g.pick);
        return row;
      }) : [ex('div', { className: 'empty', textContent: 'Nothing to withdraw. Items you deposit or buy show up here. Items listed for sale have to be taken down first.' })]));
      upd();
    }
    const pending = trades.filter((t) => t.kind === 'withdraw' && ['pending', 'in_progress'].includes(t.status));
    const bd = ex('div', { className: 'bd' });
    if (pending.length) bd.append(ex('div', { className: 'pend' }, ex('span', { textContent: 'You have a withdrawal waiting. Join the bot to get it.' }), ex('button', { type: 'button', textContent: 'Join bot', onclick: () => { dlg.close(); window.openItemDeposit('receive'); } })));
    bd.append(ex('div', { className: 'lab' }, lab, ex('button', { type: 'button', textContent: 'Clear all', onclick: () => { groups.forEach((g) => (g.pick = 0)); draw(); } })), rows);
    go.onclick = async () => {
      const ids = []; groups.forEach((g) => ids.push(...g.ids.slice(0, g.pick)));
      if (ids.length > 50) { if (typeof toast === 'function') toast('You can withdraw up to 50 items at once.', true); return; }
      go.disabled = true;
      try {
        await jpost('/api/trades/withdraw', { inventory_ids: ids });
        dlg.close();
        if (typeof toast === 'function') toast('Withdrawal ready. Join the bot to receive your items.');
        if (typeof window.onItemsChanged === 'function') window.onItemsChanged();
        window.openItemDeposit('receive');
      } catch (e) { if (typeof toast === 'function') toast(e.message, true); go.disabled = false; }
    };
    dlg.replaceChildren(head(dlg, IC.boxOut, 'Withdraw Items'), bd,
      ex('div', { className: 'ft' }, ex('div', { className: 'wsum' }, selB, estS), ex('button', { className: 'cl', type: 'button', textContent: 'Close', onclick: () => dlg.close() }), go));
    draw();
    if (!dlg.open) dlg.showModal();
  };

  window.RbxAuth.menu = function (u, onLogout) {
    const mk = (tag, props, ...kids) => { const e = document.createElement(tag); Object.assign(e, props); kids.forEach((k) => e.append(k)); return e; };
    const pops = [];
    const closeAll = (except) => pops.forEach((p) => { if (p !== except) p.hidden = true; });
    const toggle = (p) => (e) => { e.stopPropagation(); const show = p.hidden; closeAll(); p.hidden = !show; p.style.top = window.innerWidth <= 640 ? e.currentTarget.getBoundingClientRect().bottom + 8 + 'px' : ''; };

    // Withdraw ▾
    const wdm = mk('div', { className: 'wdm' }); wdm.hidden = true; pops.push(wdm);
    wdm.append(ex('button', { type: 'button', html: IC.boxOut + '<span>Withdraw Items</span>', onclick: () => { closeAll(); window.openItemWithdraw(); } }),
      ex('button', { type: 'button', html: IC.coinOut + '<span>Withdraw Crypto</span>', onclick: () => { closeAll(); window.openFunds('out'); } }));
    const wdBtn = ex('button', { className: 'um-wdbtn', type: 'button', html: IC.boxOut + '<span class="t">Withdraw</span><span class="car">▾</span>' });
    wdBtn.onclick = toggle(wdm);
    const wdWrap = mk('div', { className: 'um-wd' }, wdBtn, wdm);

    // Wallet + quick actions
    const bal = mk('b', { textContent: money(u.balance) }); balEls.add(bal);
    const qa = mk('div', { className: 'qa' }); qa.hidden = true; pops.push(qa);
    qa.append(ex('h4', { textContent: 'QUICK ACTIONS' }),
      ex('button', { type: 'button', onclick: () => { closeAll(); window.openFunds('add'); } }, ex('span', { className: 'ic', html: IC.cardIn }), ex('span', {}, ex('b', { textContent: 'Deposit Balance' }), ex('small', { textContent: 'Cards / Crypto' }))),
      ex('button', { type: 'button', onclick: () => { closeAll(); window.openItemDeposit(); } }, ex('span', { className: 'ic', html: IC.boxIn }), ex('span', {}, ex('b', { textContent: 'Item Deposit' }), ex('small', { textContent: 'MM2' }))));
    const plus = ex('button', { className: 'plus', type: 'button', textContent: '+', title: 'Deposit', 'aria-label': 'Deposit' });
    plus.onclick = toggle(qa);
    const wallet = mk('div', { className: 'um-wallet' }, ex("span", { html: "<i style=\"color:var(--mute);display:flex\">" + IC.wallet.replace("<svg ", "<svg width=\"18\" height=\"18\" ") + "</i>" }, bal), plus);
    const walletWrap = mk('div', { className: 'um-wd' }, wallet, qa);

    // Account menu
    const rk = mk('small');
    const btn = mk('button', { className: 'um-btn', type: 'button' }, window.avEl(u), mk('span', {}, mk('b', { textContent: u.username }), rk), document.createTextNode('▾'));
    btn.setAttribute('aria-haspopup', 'true');
    const pop = mk('div', { className: 'um-pop' }); pop.hidden = true; pops.push(pop);
    const out = mk('button', { type: 'button', textContent: 'Log out', onclick: onLogout }); out.style.color = 'var(--bad)';
    if (u.owner) { const o = mk('a', { href: '/owner.html', textContent: 'Owner panel' }); o.style.color = 'var(--gold)'; pop.append(o, mk('hr')); }
    pop.append(mk('a', { href: '/profile.html', textContent: 'Profile' }), mk('a', { href: '/?seller=' + encodeURIComponent(u.username), textContent: 'My shop' }),
      mk('a', { href: '/inventory.html', textContent: 'Inventory' }), mk('a', { href: '/profile.html#wallet', textContent: 'Transactions' }), mk('a', { href: '/support.html', textContent: 'Support' }), mk('hr'),
      mk('button', { type: 'button', textContent: 'Deposit balance', onclick: () => { closeAll(); window.openFunds('add'); } }),
      mk('button', { type: 'button', textContent: 'Deposit items', onclick: () => { closeAll(); window.openItemDeposit(); } }),
      mk('a', { href: 'https://discord.gg/splitzmarket', target: '_blank', rel: 'noopener', textContent: 'Discord' }), mk('hr'), out);
    btn.onclick = toggle(pop);
    const box = mk('div', { className: 'um' }, btn, pop);
    const wrap = mk('div', { className: 'um' }, wdWrap, walletWrap, box);
    document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) closeAll(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
    fetch('/api/profile').then((r) => (r.ok ? r.json() : null)).then((p) => { if (p) rk.textContent = p.rank; }).catch(() => {});
    return wrap;
  };

  const scss = document.createElement('style');
  scss.textContent = `.soonbtn{opacity:.6;cursor:not-allowed}
.soonbtn i{font-style:normal;font-size:10px;font-weight:800;background:var(--raise);color:var(--gold);border-radius:6px;padding:1px 6px;margin-left:6px}`;
  document.head.append(scss);
  window.soonMsg = (label) => { if (typeof toast === 'function') toast(label + ' is paused right now'); };
  window.soonBtn = function (label, cls) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = (cls || 'ghost sm') + ' soonbtn';
    b.setAttribute('aria-disabled', 'true');
    b.append(label);
    const i = document.createElement('i'); i.textContent = 'Paused'; b.append(i);
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

  // ---------- Official logo (split S), built in so it never depends on uploaded image files ----------
  const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><radialGradient id="smg" cx=".5" cy=".5" r=".6"><stop offset="0" stop-color="#3a0b0f"/><stop offset="1" stop-color="#0a0707"/></radialGradient><clipPath id="smt"><path d="M0 0H100V45.7L0 57.2Z"/></clipPath><clipPath id="smb"><path d="M0 57.2L100 45.7V100H0Z"/></clipPath></defs><rect width="100" height="100" rx="22" fill="url(#smg)"/><g clip-path="url(#smt)" fill="#f6efee" transform="translate(-1.5 -1)"><path d="M289 -12Q198 -12 130.5 14.5Q63 41 6 99L131 224Q170 187 213.0 167.5Q256 148 305 148Q346 148 367.0 160.5Q388 173 388 195Q388 217 370.0 231.5Q352 246 322.5 257.5Q293 269 257.5 281.0Q222 293 187.0 310.0Q152 327 122.5 351.5Q93 376 75.0 412.5Q57 449 57 502Q57 571 90.0 621.0Q123 671 183.0 697.5Q243 724 324 724Q404 724 472.5 698.5Q541 673 586 626L460 501Q427 533 394.0 548.5Q361 564 322 564Q291 564 272.5 554.0Q254 544 254 524Q254 503 272.0 489.5Q290 476 319.5 465.0Q349 454 384.5 442.0Q420 430 455.0 413.5Q490 397 519.5 371.5Q549 346 567.0 308.0Q585 270 585 216Q585 107 507.5 47.5Q430 -12 289 -12Z" transform="translate(21.04 84.83) scale(0.09783 -0.09783)"/></g><g clip-path="url(#smb)" transform="translate(2 1.4)"><g fill="#e8202a"><path d="M289 -12Q198 -12 130.5 14.5Q63 41 6 99L131 224Q170 187 213.0 167.5Q256 148 305 148Q346 148 367.0 160.5Q388 173 388 195Q388 217 370.0 231.5Q352 246 322.5 257.5Q293 269 257.5 281.0Q222 293 187.0 310.0Q152 327 122.5 351.5Q93 376 75.0 412.5Q57 449 57 502Q57 571 90.0 621.0Q123 671 183.0 697.5Q243 724 324 724Q404 724 472.5 698.5Q541 673 586 626L460 501Q427 533 394.0 548.5Q361 564 322 564Q291 564 272.5 554.0Q254 544 254 524Q254 503 272.0 489.5Q290 476 319.5 465.0Q349 454 384.5 442.0Q420 430 455.0 413.5Q490 397 519.5 371.5Q549 346 567.0 308.0Q585 270 585 216Q585 107 507.5 47.5Q430 -12 289 -12Z" transform="translate(21.04 84.83) scale(0.09783 -0.09783)"/></g></g></svg>';
  const LOGO_URL = 'data:image/svg+xml,' + encodeURIComponent(LOGO_SVG);
  window.LOGO_SVG = LOGO_SVG;
  document.querySelectorAll('link[rel~="icon"]').forEach((l) => l.remove());
  const fav = document.createElement('link'); fav.rel = 'icon'; fav.type = 'image/svg+xml'; fav.href = LOGO_URL; document.head.append(fav);
  if (!document.querySelector('meta[name="theme-color"]')) { const m = document.createElement('meta'); m.name = 'theme-color'; m.content = '#0a0707'; document.head.append(m); }
  const lcss = document.createElement('style');
  lcss.textContent = '.logo{display:inline-flex;align-items:center;gap:10px}.logo .lm{width:34px;height:34px;flex:none;display:block;filter:drop-shadow(0 0 10px #e8202a40)}.logo .lm svg{width:100%;height:100%;display:block}';
  document.head.append(lcss);
  document.querySelectorAll('a.logo').forEach((a) => {
    if (a.querySelector('.lm')) return;
    const i = document.createElement('span'); i.className = 'lm'; i.setAttribute('aria-hidden', 'true'); i.innerHTML = LOGO_SVG;
    const name = document.createElement('span'); name.append(...a.childNodes);
    a.append(i, name);
  });

  // ---------- Item value hover card + "Values" link in every top menu ----------
  const vcss = document.createElement('style');
  vcss.textContent = `#vtip{position:fixed;z-index:45;pointer-events:none;width:230px;background:#120a0a;border:1px solid #5a1f1f;border-radius:14px;padding:12px 14px;box-shadow:0 18px 50px #000c;opacity:0;transform:translateY(4px);transition:opacity .12s,transform .12s;font-size:13px}
#vtip.on{opacity:1;transform:none}
#vtip .top{display:flex;gap:10px;align-items:center;margin-bottom:8px}
#vtip .top img{width:46px;height:46px;object-fit:contain;flex:none;background:#0a0707;border-radius:10px;padding:3px}
#vtip .n{font-family:Outfit,system-ui,sans-serif;font-weight:800;font-size:16px;line-height:1.2}
#vtip .s{color:var(--mute);font-size:12px;font-weight:700}
#vtip .v{display:flex;align-items:baseline;justify-content:space-between;border-top:1px solid var(--line);padding-top:8px}
#vtip .v b{font-family:Outfit,system-ui,sans-serif;font-size:24px;font-weight:800}
#vtip .v b:not(:only-child){white-space:nowrap}
#vtip .ch{font-weight:800;font-size:12px}#vtip .ch.up{color:#4ade80}#vtip .ch.down{color:#ff8a8f}
#vtip dl{display:grid;grid-template-columns:auto 1fr;gap:3px 10px;margin:8px 0 0}
#vtip dt{color:var(--mute);font-weight:700}#vtip dd{margin:0;text-align:right;font-weight:700}
@media (hover:none){#vtip{display:none}}`;
  document.head.append(vcss);
  const tip = document.createElement('div'); tip.id = 'vtip'; tip.setAttribute('role', 'tooltip'); document.body.append(tip);
  const demandWord = (d) => (d == null ? '—' : d >= 7 ? 'Very high' : d >= 5 ? 'High' : d >= 3 ? 'Medium' : d >= 2 ? 'Low' : 'Very low');
  function fillTip(i) {
    const mk = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
    const ch = i.value_change;
    const chEl = ch == null || ch === 0 ? mk('span', 'ch', ch === 0 ? 'No change' : '') : mk('span', 'ch ' + (ch > 0 ? 'up' : 'down'), (ch > 0 ? '▲ +' : '▼ ') + ch.toLocaleString());
    const v = mk('div', 'v'); v.append(mk('span', '', 'Value'), mk('b', '', i.value ? i.value.toLocaleString() : 'No value yet'));
    const dl = mk('dl');
    [['Demand', i.demand == null ? '—' : demandWord(i.demand) + ' (' + i.demand + ')'], ['Stability', i.stability || '—'], ['Recent change', null]].forEach(([k, val]) => {
      dl.append(mk('dt', '', k)); const dd = mk('dd', '', val); if (val == null) dd.append(chEl); dl.append(dd);
    });
    if (i.price_cents) { dl.append(mk('dt', '', 'Price')); dl.append(mk('dd', '', money(i.price_cents))); }
    if (i.rec_cents) { dl.append(mk('dt', '', 'Estimate')); const r = mk('dd', '', window.estRange(i.rec_cents)); r.style.color = '#4ade80'; dl.append(r); }
    const top = mk('div', 'top');
    if (i.image_url && /^(https:\/\/|\/img\/item\/|\/items\/)/.test(i.image_url)) { const im = mk('img'); im.src = i.image_url; im.alt = ''; im.referrerPolicy = 'no-referrer'; im.onerror = () => im.remove(); top.append(im); }
    const nm = mk('div'); nm.append(mk('div', 'n', i.name), mk('div', 's', [i.rarity, i.type].filter(Boolean).join(' '))); top.append(nm);
    tip.replaceChildren(top, v, dl);
  }
  function place(el) {
    const r = el.getBoundingClientRect(), w = 230, h = tip.offsetHeight || 170;
    let x = r.right + 10; if (x + w > innerWidth - 8) x = r.left - w - 10; if (x < 8) x = Math.min(innerWidth - w - 8, Math.max(8, r.left));
    let y = r.top + 10; if (y + h > innerHeight - 8) y = innerHeight - h - 8;
    tip.style.left = x + 'px'; tip.style.top = Math.max(8, y) + 'px';
  }
  // Estimated price range shown to buyers: the recommended price give or take about 3%, rounded so it reads naturally.
  window.estRange = function (cents) {
    if (!cents) return '—';
    const lo = cents * 0.97, hi = cents * 1.03;
    const fmt = (c, up) => (c >= 1000 ? '$' + (up ? Math.ceil(c / 100) : Math.floor(c / 100)).toLocaleString() : '$' + ((up ? Math.ceil(c) : Math.max(1, Math.floor(c))) / 100).toFixed(2));
    const a = fmt(lo, false), b = fmt(hi, true);
    return a === b ? a : a + ' – ' + b;
  };
  window.valueTip = function (el, item) {
    const show = () => { fillTip(item); place(el); tip.classList.add('on'); };
    const hide = () => tip.classList.remove('on');
    el.addEventListener('mouseenter', show); el.addEventListener('mouseleave', hide);
    el.addEventListener('focusin', show); el.addEventListener('focusout', hide);
  };
  window.addEventListener('scroll', () => tip.classList.remove('on'), { passive: true });
  const nav = document.querySelector('.bar nav');
  if (nav && !nav.querySelector('a[href="/values.html"]')) {
    const a = document.createElement('a'); a.href = '/values.html'; a.textContent = 'Values';
    if (location.pathname === '/values.html') a.className = 'on';
    const first = nav.querySelector('a'); first ? first.after(a) : nav.append(a);
  }

  // ---------- Discord, owner maintenance banner, first-visit welcome ----------
  const DISCORD = 'https://discord.gg/splitzmarket';
  window.DISCORD = DISCORD;
  const DISCORD_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.4 18.4 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18.1a19.9 19.9 0 0 0 6 3l1.3-2.1a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.8 19.8 0 0 0 6-3c.5-5.2-.8-9.7-3.6-13.7zM8 15.3c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.5 8 10.5s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4z"/></svg>';
  const wcss = document.createElement('style');
  wcss.textContent = `.dcLink{display:inline-flex;align-items:center;gap:7px;color:var(--mute);text-decoration:none;font-weight:700;font-size:14px;padding:8px 12px;border-radius:10px}
.dcLink:hover{color:var(--text);background:var(--surface)}
.dcLink svg{width:18px;height:18px}
#mBanner{position:sticky;top:0;z-index:16;background:repeating-linear-gradient(-45deg,#e8202a,#e8202a 14px,#c4111b 14px,#c4111b 28px);color:#fff;font-weight:700;font-size:14px;text-align:center;padding:8px 16px}
#mBanner a{color:#fff}
#welcome{position:fixed;inset:0;z-index:50;display:grid;place-items:center;padding:20px;background:#050303e6;backdrop-filter:blur(6px);opacity:0;transition:opacity .35s}
#welcome.on{opacity:1}
#welcome .seam{position:absolute;inset:-20% -10%;background:linear-gradient(103deg,transparent 49.6%,#e8202a 49.85%,#ff5a5f 50%,#e8202a 50.15%,transparent 50.4%);opacity:.45;filter:drop-shadow(0 0 22px #e8202a);pointer-events:none}
#welcome .card{position:relative;width:min(600px,100%);max-height:calc(100vh - 40px);overflow:auto;background:linear-gradient(180deg,#170c0c,#0c0707);border:1px solid #4a1a1a;border-radius:24px;padding:40px 36px 30px;text-align:center;box-shadow:0 40px 120px #000}
#welcome .mark{position:relative;display:inline-block;font-family:Outfit,system-ui,sans-serif;font-weight:900;font-size:clamp(60px,13vw,104px);line-height:.9;letter-spacing:-.04em;margin-bottom:26px;user-select:none}
#welcome .mark span{display:block}
#welcome .mark .a{clip-path:polygon(0 0,100% 0,100% 44%,0 60%);transform:translate(-.12em,-.06em);transition:transform .8s cubic-bezier(.2,.8,.2,1) .15s}
#welcome .mark .b{position:absolute;inset:0;color:var(--gold);clip-path:polygon(0 60%,100% 44%,100% 100%,0 100%);transform:translate(.2em,.12em);transition:transform .8s cubic-bezier(.2,.8,.2,1) .15s}
#welcome.on .mark .a{transform:none}
#welcome.on .mark .b{transform:translate(.06em,.035em)}
#welcome h2{font-family:Outfit,system-ui,sans-serif;font-size:clamp(24px,4vw,32px);font-weight:800;letter-spacing:-.02em;margin:0 0 10px}
#welcome p{color:#d4bfbe;font-size:16px;line-height:1.6;margin:0 auto 24px;max-width:44ch}
#welcome ol{list-style:none;padding:0;margin:0 0 28px;display:grid;gap:10px;text-align:left}
#welcome li{display:flex;gap:14px;align-items:baseline;padding:12px 16px;border-left:3px solid var(--gold);background:#ffffff05;border-radius:0 12px 12px 0;font-size:15px;line-height:1.45;color:#e9dcdb}
#welcome li b{font-family:Outfit,system-ui,sans-serif;color:var(--gold);font-size:18px;min-width:12px}
#welcome .acts{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
#welcome .acts>*{display:inline-flex;align-items:center;gap:9px;text-decoration:none;font:inherit;font-weight:700;font-size:15px;padding:13px 20px;border-radius:12px;cursor:pointer}
#welcome .go{background:var(--gold);color:#fff;border:0;box-shadow:0 8px 30px #e8202a55}
#welcome .dc{background:transparent;color:var(--text);border:1px solid #4a1a1a}
#welcome .dc:hover{border-color:var(--gold)}
#welcome .dc svg{width:20px;height:20px}
#welcome .x{position:absolute;top:14px;right:14px;background:transparent;border:0;color:var(--mute);font-size:22px;cursor:pointer;padding:4px 10px;border-radius:8px}
#welcome .x:hover{color:var(--text)}
@media (prefers-reduced-motion:reduce){#welcome,#welcome .mark span{transition:none}}
@media (max-width:640px){.dcLink span{display:none}#welcome .card{padding:34px 20px 22px}}`;
  document.head.append(wcss);

  const bar = document.querySelector('.bar');
  const who = document.getElementById('who');
  if (bar && who) {
    const a = document.createElement('a');
    a.className = 'dcLink'; a.href = DISCORD; a.target = '_blank'; a.rel = 'noopener';
    a.innerHTML = DISCORD_SVG + '<span>Discord</span>';
    bar.insertBefore(a, who);
  }

  // Owners get a reminder strip while regular players are seeing the maintenance page.
  if (!document.body.dataset.nowelcome) fetch('/api/me').then((r) => r.json()).then((u) => {
    if (!u || !u.owner || !u.maintenance) return;
    const b = document.createElement('div'); b.id = 'mBanner';
    b.innerHTML = 'Maintenance mode is on. Only owners can see the site right now. <a href="/owner.html#maintenance">Turn it off</a>';
    document.body.prepend(b);
  }).catch(() => {});

  window.showWelcome = function () {
    if (document.getElementById('welcome')) return;
    const w = document.createElement('div');
    w.id = 'welcome'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-modal', 'true'); w.setAttribute('aria-labelledby', 'wTitle');
    w.innerHTML = `<div class="seam" aria-hidden="true"></div>
<div class="card">
  <button class="x" type="button" aria-label="Close">×</button>
  <div class="mark" aria-hidden="true"><span class="a">Splitz</span><span class="b">Splitz</span></div>
  <h2 id="wTitle">Welcome to SplitzMarket</h2>
  <p>The place to buy and sell Murder Mystery 2 items. Everything listed is already in our hands, so what you see is what you get.</p>
  <ol>
    <li><b>1</b><span>Log in with your Roblox account and add funds to your balance.</span></li>
    <li><b>2</b><span>Buy any item on the market. It's in your inventory the second you pay.</span></li>
    <li><b>3</b><span>Withdraw it and our bot sends it to you in game. Selling works the same way in reverse.</span></li>
  </ol>
  <div class="acts">
    <button class="go" type="button">Start shopping</button>
    <a class="dc" href="${DISCORD}" target="_blank" rel="noopener">${DISCORD_SVG}Join our Discord</a>
  </div>
</div>`;
    const prev = document.activeElement;
    const close = () => {
      try { sessionStorage.setItem('sm_welcomed', '1'); } catch {}
      w.classList.remove('on'); setTimeout(() => w.remove(), 350);
      document.removeEventListener('keydown', esc); if (prev && prev.focus) prev.focus();
    };
    const esc = (e) => { if (e.key === 'Escape') close(); };
    w.querySelector('.x').onclick = close; w.querySelector('.go').onclick = close;
    w.onclick = (e) => { if (e.target === w) close(); };
    document.addEventListener('keydown', esc);
    document.body.append(w);
    requestAnimationFrame(() => requestAnimationFrame(() => w.classList.add('on')));
    w.querySelector('.go').focus();
  };
  let seen = false;
  try { seen = !!sessionStorage.getItem('sm_welcomed'); } catch {}
  if (!seen && !document.body.dataset.nowelcome) window.showWelcome();

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
