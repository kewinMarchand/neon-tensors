/**
 * @file market.js
 * @description Récupération des données de marché BTC/USD depuis les API publiques d'échange.
 *
 * Sources (aucune clé API requise, fallback automatique) :
 * 1. Kraken    : https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=60  (720 bougies horaires)
 * 2. Coinbase  : https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=3600
 *
 * Format normalisé d'une bougie : { t, o, h, l, c, v } (timestamp s, floats), ordre chronologique.
 */

const PAIR_KRAKEN = 'XBTUSD';
const PAIR_COINBASE = 'BTC-USD';
const GRANULARITY_SECONDS = 3600; // bougies horaires

/**
 * Parse la réponse JSON de l'API Kraken (publicOHLC) en bougies normalisées.
 *
 * @param {Object} json - Réponse { error: [], result: { <PAIR>: [[time,o,h,l,c,vwap,vol,count],...], last } }.
 * @returns {Array<{t:number,o:number,h:number,l:number,c:number,v:number}>} Bougies chronologiques.
 */
function parseKrakenCandles(json) {
  const key = Object.keys(json.result || {}).find(k => k !== 'last');
  if (!key) return [];
  return (json.result[key] || [])
    .map(row => ({
      t: Number(row[0]),
      o: Number(row[1]),
      h: Number(row[2]),
      l: Number(row[3]),
      c: Number(row[4]),
      v: Number(row[6])
    }))
    .sort((a, b) => a.t - b.t);
}

/**
 * Parse la réponse de l'API Coinbase Exchange (candles) en bougies normalisées.
 * Coinbase renvoie [time, low, high, open, close, volume] du plus récent au plus ancien.
 *
 * @param {Array<Array<number>>} rows - Tableau brut Coinbase.
 * @returns {Array<{t:number,o:number,h:number,l:number,c:number,v:number}>} Bougies chronologiques.
 */
function parseCoinbaseCandles(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map(row => ({
      t: Number(row[0]),
      o: Number(row[3]),
      h: Number(row[2]),
      l: Number(row[1]),
      c: Number(row[4]),
      v: Number(row[5])
    }))
    .sort((a, b) => a.t - b.t);
}

/**
 * Parse la réponse du ticker Kraken pour extraire le dernier prix traité.
 *
 * @param {Object} json - Réponse { error: [], result: { <PAIR>: { c: [prix, volume], ... } } }.
 * @returns {number} Dernier prix.
 */
function parseKrakenTicker(json) {
  const key = Object.keys(json.result || {})[0];
  if (!key) return NaN;
  return Number(json.result[key].c[0]);
}

/** Nombre maximal de bougies horaires par requête Coinbase (limite de l'API). */
const HOURS_PER_PAGE = 300;

/**
 * Construit les fenêtres de pagination Coinbase : 300 bougies par requête, en remontant le temps.
 * Pur et testable : permet de récupérer plusieurs mois d'historique sans laisser tourner le serveur.
 *
 * @param {number} days - Nombre de jours d'historique souhaités.
 * @param {number} [nowSec] - Timestamp de référence en secondes (injection pour les tests).
 * @returns {Array<{start:number,end:number}>} Fenêtres [start, end] en secondes, de la plus récente à la plus ancienne.
 */
function buildCoinbaseWindows(days, nowSec = Date.now() / 1000) {
  const end = Math.floor(nowSec / 3600) * 3600;
  const totalHours = Math.ceil(days * 24);
  const windows = [];
  for (let i = 0; i < totalHours; i += HOURS_PER_PAGE) {
    const wEnd = end - i * 3600;
    const wStart = end - Math.min(i + HOURS_PER_PAGE, totalHours) * 3600;
    windows.push({ start: wStart, end: wEnd });
  }
  return windows;
}

/**
 * Récupère `days` jours de bougies horaires BTC/USD depuis Coinbase en paginant
 * vers le passé (300 bougies par requête).
 *
 * @param {number} days - Nombre de jours d'historique.
 * @returns {Promise<Array>} Bougies chronologiques dédoublonnées.
 */
async function fetchCandlesCoinbase(days) {
  const candles = [];
  for (const w of buildCoinbaseWindows(days)) {
    const url = `https://api.exchange.coinbase.com/products/${PAIR_COINBASE}/candles`
      + `?granularity=${GRANULARITY_SECONDS}`
      + `&start=${new Date(w.start * 1000).toISOString()}`
      + `&end=${new Date(w.end * 1000).toISOString()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Coinbase indisponible (${res.status})`);
    candles.push(...parseCoinbaseCandles(await res.json()));
  }
  const byT = new Map(candles.map(c => [c.t, c]));
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

/**
 * Construit les fenêtres de pagination Coinbase pour des bougies JOURNALIÈRES (86400 s).
 * 300 bougies par requête, alignées sur minuit UTC.
 *
 * @param {number} days - Nombre de jours d'historique souhaités.
 * @param {number} [nowSec] - Timestamp de référence en secondes.
 * @returns {Array<{start:number,end:number}>} Fenêtres, de la plus récente à la plus ancienne.
 */
function buildDailyCoinbaseWindows(days, nowSec = Date.now() / 1000) {
  const g = 86400;
  const end = Math.floor(nowSec / g) * g;
  const total = Math.ceil(days);
  const windows = [];
  for (let i = 0; i < total; i += HOURS_PER_PAGE) {
    const wEnd = end - i * g;
    const wStart = end - Math.min(i + HOURS_PER_PAGE, total) * g;
    windows.push({ start: wStart, end: wEnd });
  }
  return windows;
}

/**
 * Récupère des bougies JOURNALIÈRES BTC/USD depuis Coinbase (granularity 86400).
 *
 * @param {number} days - Nombre de jours d'historique.
 * @returns {Promise<Array>} Bougies chronologiques dédoublonnées.
 */
async function fetchDailyCandlesCoinbase(days) {
  const candles = [];
  for (const w of buildDailyCoinbaseWindows(days)) {
    const url = `https://api.exchange.coinbase.com/products/${PAIR_COINBASE}/candles`
      + `?granularity=86400`
      + `&start=${new Date(w.start * 1000).toISOString()}`
      + `&end=${new Date(w.end * 1000).toISOString()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Coinbase indisponible (${res.status})`);
    candles.push(...parseCoinbaseCandles(await res.json()));
  }
  const byT = new Map(candles.map(c => [c.t, c]));
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

/**
 * Écarte la bougie la plus récente si elle est encore en cours de formation
 * (l'heure courante, incomplète) : ses valeurs fausseraient les indicateurs.
 *
 * @param {Array<{t:number}>} candles - Bougies chronologiques.
 * @returns {Array} Bougies complètes uniquement.
 */
function dropPartialCandle(candles) {
  if (!candles.length) return candles;
  const last = candles[candles.length - 1];
  return (last.t + GRANULARITY_SECONDS > Date.now() / 1000) ? candles.slice(0, -1) : candles;
}

/**
 * Récupère l'historique de bougies horaires BTC/USD.
 * Source privilégiée : Coinbase (paginé, jusqu'à plusieurs mois) ; Kraken en secours (720 bougies).
 *
 * @param {number} [days=30] - Nombre de jours d'historique souhaités.
 * @returns {Promise<{source:string, candles:Array}>} Source utilisée et bougies chronologiques.
 */
async function fetchCandles(days = 30) {
  try {
    const candles = dropPartialCandle(await fetchCandlesCoinbase(days));
    if (candles.length > 24) return { source: 'Coinbase', candles };
    throw new Error('Historique Coinbase trop court');
  } catch (coinbaseError) {
    const res = await fetch(`https://api.kraken.com/0/public/OHLC?pair=${PAIR_KRAKEN}&interval=${GRANULARITY_SECONDS / 60}`);
    const json = await res.json();
    if (json.error && json.error.length) throw new Error(`Kraken : ${json.error.join(', ')} (Coinbase : ${coinbaseError.message})`);
    const candles = dropPartialCandle(parseKrakenCandles(json));
    if (candles.length < 50) throw new Error(`Historiques insuffisants (Coinbase : ${coinbaseError.message})`);
    return { source: 'Kraken', candles };
  }
}

/**
 * Écarte la bougie journalière en cours (jour UTC incomplet).
 */
function dropPartialDailyCandle(candles) {
  if (!candles.length) return candles;
  const last = candles[candles.length - 1];
  return (last.t + 86400 > Date.now() / 1000) ? candles.slice(0, -1) : candles;
}

/**
 * Récupère l'historique de bougies JOURNALIÈRES BTC/USD (Coinbase, sinon Kraken interval 1440).
 *
 * @param {number} [days=730] - Nombre de jours d'historique souhaités.
 * @returns {Promise<{source:string, candles:Array}>}
 */
async function fetchDailyCandles(days = 730) {
  try {
    const candles = dropPartialDailyCandle(await fetchDailyCandlesCoinbase(days));
    if (candles.length > 30) return { source: 'Coinbase', candles };
    throw new Error('Historique Coinbase daily trop court');
  } catch (coinbaseError) {
    const res = await fetch(`https://api.kraken.com/0/public/OHLC?pair=${PAIR_KRAKEN}&interval=1440`);
    const json = await res.json();
    if (json.error && json.error.length) throw new Error(`Kraken : ${json.error.join(', ')} (Coinbase : ${coinbaseError.message})`);
    const candles = dropPartialDailyCandle(parseKrakenCandles(json));
    if (candles.length < 30) throw new Error(`Historiques daily insuffisants (Coinbase : ${coinbaseError.message})`);
    return { source: 'Kraken', candles };
  }
}

/**
 * Récupère le dernier prix traité BTC/USD (Coinbase, sinon Kraken).
 *
 * @returns {Promise<{source:string, price:number}>} Source et dernier prix.
 */
async function fetchTicker() {
  try {
    const res = await fetch(`https://api.exchange.coinbase.com/products/${PAIR_COINBASE}/ticker`);
    if (!res.ok) throw new Error(`Coinbase indisponible (${res.status})`);
    const json = await res.json();
    const price = Number(json.price);
    if (!Number.isFinite(price) || price <= 0) throw new Error('Ticker Coinbase invalide');
    return { source: 'Coinbase', price };
  } catch (coinbaseError) {
    const res = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${PAIR_KRAKEN}`);
    const json = await res.json();
    if (json.error && json.error.length) throw new Error(`Kraken : ${json.error.join(', ')} (${coinbaseError.message})`);
    const price = parseKrakenTicker(json);
    if (!Number.isFinite(price) || price <= 0) throw new Error(`Ticker invalide : ${coinbaseError.message}`);
    return { source: 'Kraken', price };
  }
}

/**
 * Récupère la dominance BTC (part du BTC dans la capitalisation totale du marché crypto)
 * via l'API publique CoinGecko.
 *
 * @returns {Promise<{pct:number}>} Dominance en % (ex: 55.3).
 */
async function fetchDominance() {
  const res = await fetch('https://api.coingecko.com/api/v3/global');
  if (!res.ok) throw new Error(`CoinGecko indisponible (${res.status})`);
  const json = await res.json();
  const pct = Number(json.data.market_cap_percentage.btc);
  if (!Number.isFinite(pct) || pct <= 0) throw new Error('Dominance CoinGecko invalide');
  return { pct };
}

module.exports = { PAIR_KRAKEN, PAIR_COINBASE, GRANULARITY_SECONDS, HOURS_PER_PAGE, buildCoinbaseWindows, buildDailyCoinbaseWindows, fetchCandlesCoinbase, fetchDailyCandlesCoinbase, parseKrakenCandles, parseCoinbaseCandles, parseKrakenTicker, fetchCandles, fetchDailyCandles, fetchTicker, fetchDominance };
