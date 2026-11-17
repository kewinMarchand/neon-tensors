/**
 * @file indicators.js
 * @description Logique pure de calcul d'un indice Fear & Greed (Peur & Avidité) appliqué au marché BTC/USD.
 *
 * L'indice est un composite pondéré de 7 composantes, chacune ramenée sur une échelle
 * 0-100 (0 = peur extrême, 100 = avidité extrême) :
 *
 * 1. Momentum (20%)       : variation du prix sur 24 heures.
 * 2. Tendance (16%)       : écart entre la moyenne mobile EMA20 et EMA50.
 * 3. Volatilité (16%)     : écart-type des rendements horaires (inversé : forte volatilité = peur).
 * 4. Volume (11%)         : volume récent comparé au volume des mêmes heures les jours précédents.
 * 5. RSI (16%)            : Relative Strength Index sur 14 périodes.
 * 6. Dominance BTC (10%)  : CoinGecko, inversée — une dominance en hausse = fuite des altcoins (peur).
 *                           Optionnelle : absente, les poids restants sont renormalisés.
 * 7. Biais du modèle (11%): probabilité P(hausse) du LSTM TensorFlow — garantit que la jauge
 *                           du haut et le bloc de prédiction du bas restent raccord.
 *                           Optionnel : absent, les poids restants sont renormalisés.
 *
 * Ce module est volontairement SANS dépendance et SANT effet de bord (pur),
 * pour être testable avec `node --test` et réutilisable côté client ou serveur.
 */

/** Poids des composantes dans l'indice composite (somme = 1). */
const WEIGHTS = {
  momentum: 0.20, trend: 0.16, volatility: 0.16, volume: 0.11, rsi: 0.16, dominance: 0.10, model: 0.11
};

/**
 * Moyenne mobile exponentielle (EMA).
 *
 * @param {number[]} values - Série de valeurs (ordre chronologique).
 * @param {number} period - Période de lissage.
 * @returns {number} Dernière valeur de l'EMA.
 */
function ema(values, period) {
  if (values.length < period) return values[values.length - 1] ?? 0;
  const k = 2 / (period + 1);
  let acc = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) acc = values[i] * k + acc * (1 - k);
  return acc;
}

/**
 * Relative Strength Index (méthode de Wilder).
 *
 * @param {number[]} closes - Clôtures chronologiques.
 * @param {number} period - Période (14 par défaut).
 * @returns {number} RSI entre 0 et 100 (50 si données insuffisantes ou marché sans variation).
 */
function rsi(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gain += diff; else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Écart-type (population) d'une série.
 *
 * @param {number[]} values - Série de valeurs.
 * @returns {number} Écart-type.
 */
function stdev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Ramène une valeur dans [0, 1] selon un intervalle [min, max] (linear mapping borné).
 *
 * @param {number} value - Valeur brute.
 * @param {number} min - Borne basse (renvoie 0).
 * @param {number} max - Borne haute (renvoie 1).
 * @returns {number} Valeur bornée dans [0, 1].
 */
function map01(value, min, max) {
  if (min === max) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/**
 * Transformation linéaire générale d'une valeur d'un intervalle [a1, b1] vers [a2, b2].
 * (inverse de map01 étendue : sert à normaliser puis dénormaliser les rendements du modèle)
 *
 * @param {number} value - Valeur source (non bornée, clampée à [a1, b1]).
 * @param {number} a1 - Borne basse source.
 * @param {number} b1 - Borne haute source.
 * @param {number} a2 - Borne basse cible.
 * @param {number} b2 - Borne haute cible.
 * @returns {number} Valeur transformée dans [a2, b2].
 */
function mapRange(value, a1, b1, a2, b2) {
  return a2 + map01(value, a1, b1) * (b2 - a2);
}

/**
 * Libellé qualitatif correspondant à un score 0-100 (barème cnbc/alternative.me).
 *
 * @param {number} score - Score entre 0 et 100.
 * @returns {string} Libellé en français.
 */
function label(score) {
  if (score < 25) return 'Peur extrême';
  if (score < 45) return 'Peur';
  if (score <= 55) return 'Neutre';
  if (score <= 75) return 'Avidité';
  return 'Avidité extrême';
}

/**
 * Couleur néon associée à un score 0-100 (du rose "peur" au jaune-vert "avidité").
 *
 * @param {number} score - Score entre 0 et 100.
 * @returns {string} Code couleur CSS.
 */
function color(score) {
  if (score < 25) return '#ff72bb';
  if (score < 45) return '#ff9d5c';
  if (score <= 55) return '#ffd166';
  if (score <= 75) return '#a2ff8f';
  return '#BADA55';
}

/**
 * Calcule l'indice Fear & Greed composite à partir d'une liste de bougies horaires.
 *
 * @param {Array<{t:number,o:number,h:number,l:number,c:number,v:number}>} candles
 *   Bougies chronologiques (idéalement >= 720 bougies horaires = 30 jours).
 * @param {{pct:number, changePct:number}} [dominance]
 *   Dominance BTC en % du marché crypto et sa variation sur 24 h en points de %.
 *   Une dominance en hausse traduit une fuite des altcoins = peur ; absente,
 *   la composante est ignorée et les poids restants sont renormalisés.
 * @param {number} [modelBias] - Probabilité P(hausse) du LSTM (0-1) : biais de marché du modèle.
 * @returns {{score:number, label:string, color:string, price:number, changePct24h:number,
 *            components:Array<{key:string,label:string,score:number,raw:string,desc:string}>}}
 */
function fearGreed(candles, dominance, modelBias) {
  if (!candles || candles.length < 50) {
    return { score: 50, label: label(50), color: color(50), price: NaN, changePct24h: 0, components: [] };
  }

  const closes = candles.map(c => c.c);
  const volumes = candles.map(c => c.v);
  const price = closes[closes.length - 1];

  // 1. Momentum : variation sur les 24 dernières bougies horaires (-8% .. +8% -> 0..100)
  const ref24 = closes[Math.max(0, closes.length - 25)];
  const changePct24h = (price - ref24) / ref24;
  const momentum = map01(changePct24h, -0.08, 0.08) * 100;

  // 2. Tendance : écart relatif EMA20 / EMA50 (-3% .. +3% -> 0..100)
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const spread = (e20 - e50) / e50;
  const trend = map01(spread, -0.03, 0.03) * 100;

  // 3. Volatilité : écart-type des 24 derniers rendements horaires, INVERSÉ (0..2.5% -> 100..0)
  const rets = [];
  for (let i = Math.max(1, closes.length - 24); i < closes.length; i++) {
    rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  const vol = stdev(rets);
  const volatility = (1 - map01(vol, 0, 0.025)) * 100;

  // 4. Volume : moyenne des 6 dernières heures vs moyenne des MÊMES heures (UTC)
  // sur les jours précédents — neutralise le biais d'heure de la journée
  // (les nuits UTC sont toujours plus calmes que les séances américaines).
  const recentHours = new Set(candles.slice(-6).map(c => Math.floor(c.t / 3600) % 24));
  let baseSum = 0;
  let baseCount = 0;
  for (let i = 0; i < candles.length - 6; i++) {
    if (recentHours.has(Math.floor(candles[i].t / 3600) % 24)) {
      baseSum += volumes[i];
      baseCount++;
    }
  }
  const baseline = baseCount ? baseSum / baseCount : volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const vol6 = candles.slice(-6).reduce((a, b) => a + b.v, 0) / 6;
  const volume = map01(vol6 / (baseline || 1), 0.6, 1.8) * 100;

  // 5. RSI : la valeur brute est déjà sur une échelle 0-100
  const rsiVal = rsi(closes, 14);

  const parts = [
    { key: 'momentum',   label: 'Momentum 24 h',  score: momentum,   raw: (changePct24h * 100).toFixed(2) + ' %', desc: 'Variation du prix sur 24 h (22%)' },
    { key: 'trend',      label: 'Tendance EMA',   score: trend,      raw: (spread * 100).toFixed(2) + ' %',      desc: 'Écart EMA20 vs EMA50 (18%)' },
    { key: 'volatility', label: 'Volatilité',     score: volatility, raw: (vol * 100).toFixed(2) + ' %',         desc: 'Inversée : calme = avidité (18%)' },
    { key: 'volume',     label: 'Volume',         score: volume,     raw: (vol6 / (baseline || 1)).toFixed(2) + 'x', desc: 'Volume vs mêmes heures 7 j (13%)' },
    { key: 'rsi',        label: 'RSI (14)',       score: rsiVal,     raw: rsiVal.toFixed(1),                      desc: 'Force du mouvement (18%)' }
  ];

  // 6. Dominance BTC : INVERSÉE — une dominance qui monte signifie fuite des altcoins (peur)
  if (dominance && Number.isFinite(dominance.pct) && Number.isFinite(dominance.changePct)) {
    parts.push({
      key: 'dominance',
      label: 'Dominance BTC',
      score: (1 - map01(dominance.changePct, -0.6, 0.6)) * 100,
      raw: dominance.pct.toFixed(2) + ' % (' + (dominance.changePct >= 0 ? '+' : '') + dominance.changePct.toFixed(2) + ' pt)',
      desc: 'Hausse = fuite des altcoins (10%)'
    });
  }

  // 7. Biais du modèle LSTM : sa probabilité P(hausse) entre directement dans l'indice,
  //    pour que la jauge du haut et le bloc de prédiction du bas racontent la même histoire.
  if (Number.isFinite(modelBias)) {
    parts.push({
      key: 'model',
      label: 'Biais du modèle',
      score: Math.max(0, Math.min(100, modelBias * 100)),
      raw: (modelBias * 100).toFixed(0) + ' % P(hausse)',
      desc: 'Sortie sigmoïde du LSTM (11%)'
    });
  }

  const totalWeight = parts.reduce((acc, p) => acc + WEIGHTS[p.key], 0);
  const score = Math.round(parts.reduce((acc, p) => acc + p.score * WEIGHTS[p.key], 0) / totalWeight);
  return { score, label: label(score), color: color(score), price, changePct24h, components: parts };
}

/**
 * Agrège des bougies horaires en bougies HEBDOMADAIRES (semaines alignées sur lundi 00:00 UTC).
 * Sert au graphique hebdo : une bougie par semaine, la dernière étant la semaine en cours.
 *
 * Alignement : l'époque Unix (01/01/1970) est un jeudi, donc (t + 3 jours) / 604 800 s
 * fait démarrer les compartiments le lundi.
 *
 * @param {Array<{t:number,o:number,h:number,l:number,c:number,v:number}>} candles - Bougies horaires chronologiques.
 * @returns {Array} Bougies hebdomadaires { t, o, h, l, c, v } chronologiques.
 */
function aggregateWeekly(candles) {
  if (!candles || !candles.length) return [];
  const buckets = new Map();
  for (const c of candles) {
    const key = Math.floor((c.t + 3 * 86400) / 604800);
    const bucket = buckets.get(key);
    if (!bucket) {
      buckets.set(key, { t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v });
    } else {
      bucket.h = Math.max(bucket.h, c.h);
      bucket.l = Math.min(bucket.l, c.l);
      bucket.c = c.c;
      bucket.v += c.v;
    }
  }
  return [...buckets.values()].sort((a, b) => a.t - b.t);
}

module.exports = { WEIGHTS, ema, rsi, stdev, map01, mapRange, label, color, fearGreed, aggregateWeekly };
