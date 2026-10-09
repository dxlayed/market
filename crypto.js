// Crypto deposits and withdrawals for SplitzMarket.
// The server only ever holds PUBLIC keys (xpub/zpub). It can create deposit addresses and watch them,
// but it cannot spend anything. Withdrawals are paid by an owner from their own wallet.
const { HDKey } = require('@scure/bip32');
const { bech32, createBase58check } = require('@scure/base');
const { sha256 } = require('@noble/hashes/sha256');
const { ripemd160 } = require('@noble/hashes/ripemd160');
const QRCode = require('qrcode');

const b58c = createBase58check(sha256);
const hash160 = (b) => ripemd160(sha256(b));

// Extended public key prefixes -> address type. Electrum's default (native segwit) wallets give zpub.
const PREFIX = {
  xpub: 'p2pkh', Ltub: 'p2pkh',
  zpub: 'p2wpkh', vpub: 'p2wpkh',
  ypub: 'p2sh', Mtub: 'p2sh',
};
const COINS = {
  btc: { id: 'btc', name: 'Bitcoin', symbol: 'BTC', gecko: 'bitcoin', hrp: 'bc', p2pkh: 0x00, decimals: 8,
    api: process.env.BTC_API || 'https://mempool.space/api', explorer: 'https://mempool.space/tx/',
    confirmations: Math.max(1, parseInt(process.env.BTC_CONFIRMATIONS, 10) || 2), fee: process.env.BTC_WITHDRAW_FEE || '1.00' },
  ltc: { id: 'ltc', name: 'Litecoin', symbol: 'LTC', gecko: 'litecoin', hrp: 'ltc', p2pkh: 0x30, decimals: 8,
    api: process.env.LTC_API || 'https://litecoinspace.org/api', explorer: 'https://litecoinspace.org/tx/',
    confirmations: Math.max(1, parseInt(process.env.LTC_CONFIRMATIONS, 10) || 4), fee: process.env.LTC_WITHDRAW_FEE || '0.05' },
};

// Parse any extended public key by swapping its version bytes for the standard xpub ones.
function parseXpub(str) {
  const s = String(str || '').trim();
  if (!s) return null;
  const type = PREFIX[s.slice(0, 4)];
  if (!type) throw new Error('Unknown key type ' + s.slice(0, 4) + '. Use the Master Public Key from Electrum (starts with zpub).');
  if (type === 'p2sh') throw new Error('Wrapped-segwit keys (ypub/Mtub) are not supported. Create a native segwit wallet in Electrum (zpub).');
  const raw = b58c.decode(s);
  const std = new Uint8Array(raw); std.set([0x04, 0x88, 0xb2, 0x1e], 0);
  return { key: HDKey.fromExtendedKey(b58c.encode(std)), type };
}

function addressFor(coin, parsed, index) {
  // Electrum receive addresses are chain 0, index i, relative to the master public key it shows.
  const child = parsed.key.deriveChild(0).deriveChild(index);
  const h = hash160(child.publicKey);
  if (parsed.type === 'p2wpkh') return bech32.encode(coin.hrp, [0, ...bech32.toWords(h)]);
  return b58c.encode(Uint8Array.from([coin.p2pkh, ...h]));
}

function validAddress(coin, addr) {
  const a = String(addr || '').trim();
  try {
    if (a.toLowerCase().startsWith(coin.hrp + '1')) { const d = bech32.decode(a.toLowerCase(), 90); return d.prefix === coin.hrp; }
  } catch { /* fall through */ }
  if (coin.id === 'btc' && /^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(a)) { try { b58c.decode(a); return true; } catch { return false; } }
  if (coin.id === 'ltc' && /^[LM3][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(a)) { try { b58c.decode(a); return true; } catch { return false; } }
  if (coin.id === 'btc' && /^bc1p/i.test(a)) { try { bech32m(a); return true; } catch { return false; } }
  return false;
}
function bech32m(a) { return require('@scure/base').bech32m.decode(a.toLowerCase(), 90); }

const qrSvg = (text) => QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0a0707', light: '#ffffff' } });

module.exports = { COINS, parseXpub, addressFor, validAddress, qrSvg };
