/**
 * @file client.js
 * @description Interface utilisateur interactive, pédagogique et d'administration pour
 *              l'indice Fear & Greed BTC/USD propulsé par TensorFlow.js.
 */

import io from 'socket.io-client';

// Connexion WebSocket vers le backend.
// - En local (dev) : http://localhost:8002 par défaut.
// - Sur GitHub Pages : définir window.NEON_BACKEND_URL dans index.html (URL du service Render).
const BACKEND_URL = (typeof window !== 'undefined' && (window.NEON_BACKEND_URL || '').trim())
  ? window.NEON_BACKEND_URL.trim().replace(/\/$/, '')
  : 'http://localhost:8002';
const socket = io(BACKEND_URL, {
  reconnectionDelay: 400,
  reconnectionDelayMax: 2000,
  timeout: 20000
});

// Éléments d'interface : statut et marché
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
const priceValue = document.getElementById('priceValue');
const priceChange = document.getElementById('priceChange');
const dominanceValue = document.getElementById('dominanceValue');
const dominanceChange = document.getElementById('dominanceChange');
const marketSource = document.getElementById('marketSource');
const updatedAt = document.getElementById('updatedAt');

// Jauge Fear & Greed
const gaugeNeedle = document.getElementById('gaugeNeedle');
const gaugeScore = document.getElementById('gaugeScore');
const gaugeLabel = document.getElementById('gaugeLabel');
const componentsList = document.getElementById('componentsList');

// Graphique
const chartCanvas = document.getElementById('chartCanvas');
const weeklyCanvas = document.getElementById('weeklyCanvas');

// Entraînement
const btnTrainStep = document.getElementById('btnTrainStep');
const btnTrainFull = document.getElementById('btnTrainFull');
const btnResetModel = document.getElementById('btnResetModel');
const btnPredict = document.getElementById('btnPredict');
const progressBar = document.getElementById('progressBar');
const progressPercent = document.getElementById('progressPercent');
const epochCounter = document.getElementById('epochCounter');
const epochMessageBox = document.getElementById('epochMessageBox');
const epochMessageText = document.getElementById('epochMessageText');
const metricsTableBody = document.getElementById('metricsTableBody');

// Prédiction
const probaBar = document.getElementById('probaBar');
const probaPercent = document.getElementById('probaPercent');
const predictedLabel = document.getElementById('predictedLabel');
const predictionNote = document.getElementById('predictionNote');
const forecastList = document.getElementById('forecastList');
const backtestNote = document.getElementById('backtestNote');

// Chemins de prévision courants (pour les dessiner sur le graphique)
let lastForecast = null;
let lastBacktest = null;
let lastCandles = [];

// Données du graphique hebdomadaire (bougies hebdo + bougie de la semaine prédite)
let lastWeeklyCandles = [];
let lastWeeklyForecast = null;

// Daily (graphique dédié + modèle daily)
const dailyCanvas = document.getElementById('dailyCanvas');
const btnDailyTrainStep = document.getElementById('btnDailyTrainStep');
const btnDailyTrainFull = document.getElementById('btnDailyTrainFull');
const btnDailyResetModel = document.getElementById('btnDailyResetModel');
const btnDailyPredict = document.getElementById('btnDailyPredict');
const dailyProgressBar = document.getElementById('dailyProgressBar');
const dailyProgressPercent = document.getElementById('dailyProgressPercent');
const dailyEpochCounter = document.getElementById('dailyEpochCounter');
const dailyEpochMessageBox = document.getElementById('dailyEpochMessageBox');
const dailyEpochMessageText = document.getElementById('dailyEpochMessageText');
const dailyPredictionNote = document.getElementById('dailyPredictionNote');
const dailyForecastList = document.getElementById('dailyForecastList');
const dailyBacktestNote = document.getElementById('dailyBacktestNote');
let lastDailyCandles = [];
let lastDailyForecast = null;
let lastDailyBacktest = null;

// Hebdomadaire (prévision +7j issue du modèle horaire)
const weeklyPredictionNote = document.getElementById('weeklyPredictionNote');
const weeklyForecastList = document.getElementById('weeklyForecastList');
const btnWeeklyTrainStep = document.getElementById('btnWeeklyTrainStep');
const btnWeeklyTrainFull = document.getElementById('btnWeeklyTrainFull');
const btnWeeklyResetModel = document.getElementById('btnWeeklyResetModel');
const btnWeeklyPredict = document.getElementById('btnWeeklyPredict');
const weeklyProgressBar = document.getElementById('weeklyProgressBar');
const weeklyProgressPercent = document.getElementById('weeklyProgressPercent');
const weeklyEpochCounter = document.getElementById('weeklyEpochCounter');
const weeklyEpochMessageBox = document.getElementById('weeklyEpochMessageBox');
const weeklyEpochMessageText = document.getElementById('weeklyEpochMessageText');

// Administration
const adminTotalParams = document.getElementById('adminTotalParams');
const adminTfBackend = document.getElementById('adminTfBackend');
const adminDataset = document.getElementById('adminDataset');
const adminHeap = document.getElementById('adminHeap');
const adminTerminal = document.getElementById('adminTerminal');

/**
 * Affiche un message informatif avec effet de fondu (fade-out puis fade-in).
 *
 * @param {string} text - Message Ã  afficher.
 */
function displayEpochMessageWithFade(text) {
  if (!epochMessageBox || !epochMessageText) return;
  epochMessageBox.classList.remove('fade-in');
  epochMessageBox.classList.add('fade-out');
  setTimeout(() => {
    epochMessageText.innerHTML = text;
    epochMessageBox.classList.remove('fade-out');
    epochMessageBox.classList.add('fade-in');
  }, 250);
}

/**
 * Met Ã  jour la jauge SVG Fear & Greed (aiguille, score, libellé).
 *
 * @param {{score:number, label:string, color:string}} fg - Résultat de l'indice.
 */
function renderGauge(fg) {
  // L'aiguille pivote de -90° (score 0) Ã  +90° (score 100)
  const angle = -90 + (fg.score / 100) * 180;
  gaugeNeedle.style.transform = `rotate(${angle}deg)`;
  gaugeScore.textContent = fg.score;
  gaugeScore.style.color = fg.color;
  gaugeLabel.textContent = fg.label;
  gaugeLabel.style.color = fg.color;
}

/**
 * Met Ã  jour l'en-tête de marché (prix, variation 24 h, dominance, source).
 *
 * @param {Object} data - Données de marché diffusées par le serveur.
 */
function renderMarketHeader(data) {
  const price = data.fg.price;
  priceValue.textContent = price.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' $';
  const change = data.fg.changePct24h * 100;
  priceChange.textContent = `${change >= 0 ? 'â–²' : 'â–¼'} ${change.toFixed(2)} % / 24 h`;
  priceChange.className = change >= 0 ? 'change up' : 'change down';
  if (data.dominance && Number.isFinite(data.dominance.pct)) {
    dominanceValue.textContent = data.dominance.pct.toFixed(2) + ' %';
    if (Number.isFinite(data.dominance.changePct)) {
      const dChange = data.dominance.changePct;
      dominanceChange.textContent = `${dChange >= 0 ? '+' : 'âˆ’'}${Math.abs(dChange).toFixed(2)} pt / 24 h`;
      dominanceChange.className = dChange >= 0 ? 'change fear' : 'change up'; // hausse dominance = fuite des altcoins (peur)
    } else {
      dominanceChange.textContent = '';
    }
  } else {
    dominanceValue.textContent = 'n/d';
    dominanceChange.textContent = '';
  }
  marketSource.textContent = data.source || '—';
  updatedAt.textContent = data.updatedAt ? new Date(data.updatedAt).toLocaleTimeString('fr-FR') : '—';
}

/**
 * Met Ã  jour la liste des 5 composantes de l'indice avec leurs barres.
 *
 * @param {Array} components - Composantes calculées côté serveur.
 */
function renderComponents(components) {
  componentsList.innerHTML = '';
  components.forEach(comp => {
    const item = document.createElement('div');
    item.className = 'component-item';
    item.innerHTML = `
      <div class="component-head">
        <div>
          <span class="component-label">${comp.label}</span>
          <span class="component-raw">${comp.raw}</span>
        </div>
        <span class="component-score">${comp.score.toFixed(0)}</span>
      </div>
      <div class="bar">
        <div class="bar-fill" style="width:${comp.score}%;"></div>
      </div>
      <div class="component-desc">${comp.desc}</div>
    `;
    componentsList.appendChild(item);
  });
}

/**
 * Dessine le graphique en bougies OHLC avec repères de prix (axe droit) et de temps (axe bas),
 * le chemin de bougies futures en pointillé violet et la prévision rétrospective (comparée
 * aux bougies réelles) en pointillé ambre.
 *
 * @param {Array<{t:number,o:number,h:number,l:number,c:number,v:number}>} candles - Bougies horaires chronologiques.
 */
function renderChart(candles) {
  lastCandles = candles || [];
  const canvas = chartCanvas;
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, width, height);

  if (!candles || candles.length < 2) return;

  // Marges : droite pour l'axe des prix, bas pour l'axe du temps
  const M = { l: 8, r: 62, t: 10, b: 26 };
  const plotW = width - M.l - M.r;
  const plotH = height - M.t - M.b;

  // Prévisions superposées : futures (12 pas après la dernière bougie) et rétrospective
  const lastT = candles[candles.length - 1].t;
  const future = lastForecast && lastForecast.steps
    ? lastForecast.steps.filter(s => s.t > lastT)
    : [];
  const retro = lastBacktest && lastBacktest.steps && lastBacktest.actual
    ? { steps: lastBacktest.steps.filter(s => s.t <= lastT), actual: lastBacktest.actual.filter(a => a.t <= lastT) }
    : null;
  // Zone réservée Ã  droite pour les bougies futures prévues (toujours présente)
  const FUTURE_ZONE = 12;
  const total = candles.length + FUTURE_ZONE;

  // Échelle de prix : englobe les mèches OHLC, les prévisions futures et rétrospectives
  let lo = Infinity;
  let hi = -Infinity;
  candles.forEach(c => { lo = Math.min(lo, c.l); hi = Math.max(hi, c.h); });
  future.forEach(s => { lo = Math.min(lo, s.price); hi = Math.max(hi, s.price); });
  if (retro) {
    retro.steps.forEach(s => { lo = Math.min(lo, s.price); hi = Math.max(hi, s.price); });
    retro.actual.forEach(a => { lo = Math.min(lo, a.price); hi = Math.max(hi, a.price); });
  }
  const pad = (hi - lo) * 0.08 || 1;
  lo -= pad;
  hi += pad;

  const x = i => M.l + (i / (total - 1)) * plotW;
  const y = v => M.t + plotH - ((v - lo) / (hi - lo)) * plotH;

  // Grille + axe des prix (5 repères, étiquettes Ã  droite)
  ctx.font = '10px DM Mono, monospace';
  ctx.textBaseline = 'middle';
  for (let g = 0; g <= 4; g++) {
    const gy = M.t + plotH * g / 4;
    const price = hi - (hi - lo) * g / 4;
    ctx.strokeStyle = 'rgba(37,56,66,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(M.l, gy);
    ctx.lineTo(M.l + plotW, gy);
    ctx.stroke();
    ctx.fillStyle = '#a9bab8';
    ctx.textAlign = 'left';
    ctx.fillText(price.toLocaleString('fr-FR', { maximumFractionDigits: 0 }), M.l + plotW + 6, gy);
  }

  // Axe du temps : une étiquette par jour (bougie Ã  minuit UTC)
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  candles.forEach((candle, i) => {
    const d = new Date(candle.t * 1000);
    if (d.getUTCHours() === 0) {
      ctx.fillStyle = '#a9bab8';
      ctx.fillText(d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }), x(i), M.t + plotH + 6);
      ctx.strokeStyle = 'rgba(37,56,66,0.7)';
      ctx.beginPath();
      ctx.moveTo(x(i), M.t);
      ctx.lineTo(x(i), M.t + plotH);
      ctx.stroke();
    }
  });

  // Barres de volume (fond, discret)
  const maxV = Math.max(...candles.map(c => c.v));
  const bodyW = Math.max(1.5, plotW / total * 0.55);
  candles.forEach((candle, i) => {
    const vh = (candle.v / maxV) * plotH * 0.18;
    ctx.fillStyle = candle.c >= candle.o ? 'rgba(105,255,225,0.12)' : 'rgba(255,95,109,0.12)';
    ctx.fillRect(x(i) - bodyW / 2, M.t + plotH - vh, bodyW, vh);
  });

  // Bougies OHLC : mèche (haut-bas) puis corps (ouverture-clôture)
  candles.forEach((candle, i) => {
    const up = candle.c >= candle.o;
    ctx.strokeStyle = up ? 'rgba(105,255,225,0.8)' : 'rgba(255,95,109,0.8)';
    ctx.fillStyle = up ? 'rgba(105,255,225,0.55)' : 'rgba(255,95,109,0.55)';
    ctx.beginPath();
    ctx.moveTo(x(i), y(candle.h));
    ctx.lineTo(x(i), y(candle.l));
    ctx.lineWidth = 1;
    ctx.stroke();
    const bodyTop = y(Math.max(candle.o, candle.c));
    const bodyBottom = y(Math.min(candle.o, candle.c));
    ctx.fillRect(x(i) - bodyW / 2, bodyTop, bodyW, Math.max(1, bodyBottom - bodyTop));
  });

  // Prévision rétrospective (ambre) : ce que le modèle prévoyait il y a 12 h
  if (retro && retro.steps.length) {
    const startIdx = candles.length - retro.actual.length - 1;
    ctx.beginPath();
    if (startIdx >= 0) ctx.moveTo(x(startIdx), y(candles[startIdx].c));
    retro.steps.forEach((s, i) => ctx.lineTo(x(startIdx + 1 + i), y(s.price)));
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Chemin de bougies futures en pointillé violet (prolongé depuis le dernier prix réel)
  if (future.length) {
    ctx.beginPath();
    ctx.moveTo(x(candles.length - 1), y(candles[candles.length - 1].c));
    future.forEach((s, i) => ctx.lineTo(x(candles.length + i), y(s.price)));
    ctx.strokeStyle = '#c48cff';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    // Marqueurs aux horizons clés x+4 h et x+12 h
    [3, 11].forEach(idx => {
      if (future[idx]) {
        ctx.beginPath();
        ctx.arc(x(candles.length + idx), y(future[idx].price), 4, 0, Math.PI * 2);
        ctx.fillStyle = '#c48cff';
        ctx.fill();
      }
    });
  }
}

/**
 * Dessine le graphique HEBDOMADAIRE : une bougie par semaine (â‰ˆ 1 an d'historique),
 * suivie de la bougie de la semaine Ã  venir PRÉDITE par le modèle (en violet) :
 * ouverture = dernier prix réel, clôture = prévision +7 jours, mèches = min/max des deux.
 *
 * @param {Array<{t:number,o:number,h:number,l:number,c:number,v:number}>} candles - Bougies hebdomadaires chronologiques.
 * @param {{price:number, retPct:number}|null} weeklyForecast - Prévision +7 jours (peut être null).
 */
function renderWeeklyChart(candles, weeklyForecast) {
  lastWeeklyCandles = candles || [];
  lastWeeklyForecast = weeklyForecast || null;
  if (!weeklyCanvas) return;
  const canvas = weeklyCanvas;
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, width, height);
  if (!candles || candles.length < 2) return;

  // Bougie prédite : o = dernière clôture réelle, c = prix prédit Ã  +7 jours
  const lastClose = candles[candles.length - 1].c;
  const predicted = lastWeeklyForecast && Number.isFinite(lastWeeklyForecast.price)
    ? { o: lastClose, c: lastWeeklyForecast.price, h: Math.max(lastClose, lastWeeklyForecast.price), l: Math.min(lastClose, lastWeeklyForecast.price) }
    : null;

  const M = { l: 8, r: 62, t: 10, b: 26 };
  const plotW = width - M.l - M.r;
  const plotH = height - M.t - M.b;
  // Toujours réserver un emplacement Ã  droite pour la bougie de la semaine prédite
  const total = candles.length + 1;

  // Échelle de prix : englobe mèches réelles et bougie prédite
  let lo = Infinity;
  let hi = -Infinity;
  candles.forEach(c => { lo = Math.min(lo, c.l); hi = Math.max(hi, c.h); });
  if (predicted) { lo = Math.min(lo, predicted.l); hi = Math.max(hi, predicted.h); }
  const pad = (hi - lo) * 0.08 || 1;
  lo -= pad;
  hi += pad;

  const x = i => M.l + (i / (total - 1)) * plotW;
  const y = v => M.t + plotH - ((v - lo) / (hi - lo)) * plotH;

  // Grille + axe des prix (5 repères)
  ctx.font = '10px DM Mono, monospace';
  ctx.textBaseline = 'middle';
  for (let g = 0; g <= 4; g++) {
    const gy = M.t + plotH * g / 4;
    const price = hi - (hi - lo) * g / 4;
    ctx.strokeStyle = 'rgba(37,56,66,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(M.l, gy);
    ctx.lineTo(M.l + plotW, gy);
    ctx.stroke();
    ctx.fillStyle = '#a9bab8';
    ctx.textAlign = 'left';
    ctx.fillText(price.toLocaleString('fr-FR', { maximumFractionDigits: 0 }), M.l + plotW + 6, gy);
  }

  // Axe du temps : une étiquette par mois (première semaine de chaque mois UTC)
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  candles.forEach((candle, i) => {
    const d = new Date(candle.t * 1000);
    if (d.getUTCDate() <= 7) {
      ctx.fillStyle = '#a9bab8';
      ctx.fillText(d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }).replace('.', ''), x(i), M.t + plotH + 6);
      ctx.strokeStyle = 'rgba(37,56,66,0.7)';
      ctx.beginPath();
      ctx.moveTo(x(i), M.t);
      ctx.lineTo(x(i), M.t + plotH);
      ctx.stroke();
    }
  });

  // Barres de volume discrètes
  const maxV = Math.max(...candles.map(c => c.v));
  const bodyW = Math.max(2, plotW / total * 0.55);
  candles.forEach((candle, i) => {
    const vh = (candle.v / maxV) * plotH * 0.18;
    ctx.fillStyle = candle.c >= candle.o ? 'rgba(105,255,225,0.12)' : 'rgba(255,95,109,0.12)';
    ctx.fillRect(x(i) - bodyW / 2, M.t + plotH - vh, bodyW, vh);
  });

  // Bougies hebdomadaires réelles
  candles.forEach((candle, i) => {
    const up = candle.c >= candle.o;
    ctx.strokeStyle = up ? 'rgba(105,255,225,0.8)' : 'rgba(255,95,109,0.8)';
    ctx.fillStyle = up ? 'rgba(105,255,225,0.55)' : 'rgba(255,95,109,0.55)';
    ctx.beginPath();
    ctx.moveTo(x(i), y(candle.h));
    ctx.lineTo(x(i), y(candle.l));
    ctx.lineWidth = 1;
    ctx.stroke();
    const bodyTop = y(Math.max(candle.o, candle.c));
    const bodyBottom = y(Math.min(candle.o, candle.c));
    ctx.fillRect(x(i) - bodyW / 2, bodyTop, bodyW, Math.max(1, bodyBottom - bodyTop));
  });

  // Emplacement réservé / bougie de la semaine prédite
  const iPred = candles.length;
  if (predicted) {
    ctx.strokeStyle = '#c48cff';
    ctx.fillStyle = 'rgba(196,140,255,0.45)';
    ctx.beginPath();
    ctx.moveTo(x(iPred), y(predicted.h));
    ctx.lineTo(x(iPred), y(predicted.l));
    ctx.lineWidth = 1.4;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    const bodyTop = y(Math.max(predicted.o, predicted.c));
    const bodyBottom = y(Math.min(predicted.o, predicted.c));
    ctx.fillRect(x(iPred) - bodyW / 2, bodyTop, bodyW, Math.max(1, bodyBottom - bodyTop));
  } else {
    ctx.save();
    ctx.strokeStyle = 'rgba(196,140,255,0.55)';
    ctx.fillStyle = 'rgba(196,140,255,0.08)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    const slotL = x(iPred) - bodyW * 0.8;
    const slotR = x(iPred) + bodyW * 0.8;
    const slotT = M.t + 8;
    const slotB = M.t + plotH - 8;
    ctx.strokeRect(slotL, slotT, slotR - slotL, slotB - slotT);
    ctx.fillRect(slotL, slotT, slotR - slotL, slotB - slotT);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(196,140,255,0.85)';
    ctx.font = '11px DM Mono, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Prévision', x(iPred), M.t + plotH / 2 - 7);
    ctx.fillText('+7 j', x(iPred), M.t + plotH / 2 + 7);
    ctx.restore();
  }
}

/**
 * Met Ã  jour la barre de progression de l'entraînement.
 *
 * @param {number} iteration - Époque courante.
 * @param {number} total - Nombre total d'époques.
 */

/**
 * Dessine le graphique DAILY : bougies journalières + zone réservée à droite (30 j)
 * pour les prévisions futures (rollout) et la prévision rétrospective.
 */
function renderDailyChart(candles) {
  lastDailyCandles = candles || [];
  if (!dailyCanvas) return;
  const canvas = dailyCanvas;
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, width, height);
  if (!candles || candles.length < 2) return;

  const M = { l: 8, r: 62, t: 10, b: 26 };
  const plotW = width - M.l - M.r;
  const plotH = height - M.t - M.b;

  const lastT = candles[candles.length - 1].t;
  const future = lastDailyForecast && lastDailyForecast.steps
    ? lastDailyForecast.steps.filter(s => s.t > lastT)
    : [];
  const retro = lastDailyBacktest && lastDailyBacktest.steps && lastDailyBacktest.actual
    ? { steps: lastDailyBacktest.steps.filter(s => s.t <= lastT), actual: lastDailyBacktest.actual.filter(a => a.t <= lastT) }
    : null;
  const FUTURE_ZONE = 30;
  const total = candles.length + FUTURE_ZONE;

  let lo = Infinity, hi = -Infinity;
  candles.forEach(c => { lo = Math.min(lo, c.l); hi = Math.max(hi, c.h); });
  future.forEach(s => { lo = Math.min(lo, s.price); hi = Math.max(hi, s.price); });
  if (retro) {
    retro.steps.forEach(s => { lo = Math.min(lo, s.price); hi = Math.max(hi, s.price); });
    retro.actual.forEach(a => { lo = Math.min(lo, a.price); hi = Math.max(hi, a.price); });
  }
  const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
  const x = i => M.l + (i / (total - 1)) * plotW;
  const y = v => M.t + plotH - ((v - lo) / (hi - lo)) * plotH;

  ctx.font = '10px DM Mono, monospace';
  ctx.textBaseline = 'middle';
  for (let g = 0; g <= 4; g++) {
    const gy = M.t + plotH * g / 4;
    const price = hi - (hi - lo) * g / 4;
    ctx.strokeStyle = 'rgba(37,56,66,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(M.l, gy); ctx.lineTo(M.l + plotW, gy); ctx.stroke();
    ctx.fillStyle = '#a9bab8'; ctx.textAlign = 'left';
    ctx.fillText(price.toLocaleString('fr-FR', { maximumFractionDigits: 0 }), M.l + plotW + 6, gy);
  }

  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  candles.forEach((candle, i) => {
    const d = new Date(candle.t * 1000);
    if (d.getUTCDate() <= 3) {
      ctx.fillStyle = '#a9bab8';
      ctx.fillText(d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }).replace('.', ''), x(i), M.t + plotH + 6);
      ctx.strokeStyle = 'rgba(37,56,66,0.7)';
      ctx.beginPath(); ctx.moveTo(x(i), M.t); ctx.lineTo(x(i), M.t + plotH); ctx.stroke();
    }
  });

  const maxV = Math.max(...candles.map(c => c.v)) || 1;
  const bodyW = Math.max(1.5, plotW / total * 0.55);
  candles.forEach((candle, i) => {
    const vh = (candle.v / maxV) * plotH * 0.18;
    ctx.fillStyle = candle.c >= candle.o ? 'rgba(105,255,225,0.12)' : 'rgba(255,95,109,0.12)';
    ctx.fillRect(x(i) - bodyW / 2, M.t + plotH - vh, bodyW, vh);
  });
  candles.forEach((candle, i) => {
    const up = candle.c >= candle.o;
    ctx.strokeStyle = up ? 'rgba(105,255,225,0.8)' : 'rgba(255,95,109,0.8)';
    ctx.fillStyle = up ? 'rgba(105,255,225,0.55)' : 'rgba(255,95,109,0.55)';
    ctx.beginPath(); ctx.moveTo(x(i), y(candle.h)); ctx.lineTo(x(i), y(candle.l)); ctx.lineWidth = 1; ctx.stroke();
    const bodyTop = y(Math.max(candle.o, candle.c));
    const bodyBottom = y(Math.min(candle.o, candle.c));
    ctx.fillRect(x(i) - bodyW / 2, bodyTop, bodyW, Math.max(1, bodyBottom - bodyTop));
  });

  if (retro && retro.steps.length) {
    const startIdx = candles.length - retro.actual.length - 1;
    ctx.beginPath();
    if (startIdx >= 0) ctx.moveTo(x(startIdx), y(candles[startIdx].c));
    retro.steps.forEach((s, i) => ctx.lineTo(x(startIdx + 1 + i), y(s.price)));
    ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 1.6; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
  }

  if (future.length) {
    ctx.beginPath();
    ctx.moveTo(x(candles.length - 1), y(candles[candles.length - 1].c));
    future.forEach((s, i) => ctx.lineTo(x(candles.length + i), y(s.price)));
    ctx.strokeStyle = '#c48cff'; ctx.lineWidth = 1.6; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
    [0, 3, 6, 29].forEach(idx => {
      if (future[idx]) {
        ctx.beginPath();
        ctx.arc(x(candles.length + idx), y(future[idx].price), 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#c48cff'; ctx.fill();
      }
    });
  }
}

function renderDailyProgress(iteration, total) {
  if (!dailyProgressBar) return;
  const pct = Math.round((iteration / total) * 100);
  dailyProgressBar.style.width = pct + '%';
  if (dailyProgressPercent) dailyProgressPercent.textContent = pct + '%';
  if (dailyEpochCounter) dailyEpochCounter.textContent = 'Époque ' + iteration + ' / ' + total;
}


function renderWeeklyProgress(iteration, total) {
  if (!weeklyProgressBar || !weeklyProgressPercent || !weeklyEpochCounter) return;
  const pct = total ? Math.round((iteration / total) * 100) : 0;
  weeklyProgressBar.style.width = pct + '%';
  weeklyProgressPercent.textContent = pct + '%';
  weeklyEpochCounter.textContent = `Époque ${iteration} / ${total}`;
}
function displayWeeklyEpochMessage(text) {
  if (!weeklyEpochMessageBox || !weeklyEpochMessageText) return;
  weeklyEpochMessageBox.classList.remove('fade-in');
  weeklyEpochMessageBox.classList.add('fade-out');
  setTimeout(() => {
    weeklyEpochMessageText.textContent = text;
    weeklyEpochMessageBox.classList.remove('fade-out');
    weeklyEpochMessageBox.classList.add('fade-in');
  }, 200);
}

function renderProgress(iteration, total) {
  const pct = Math.round((iteration / total) * 100);
  progressBar.style.width = pct + '%';
  progressPercent.textContent = pct + '%';
  epochCounter.textContent = `Époque ${iteration} / ${total}`;
}

/**
 * Ajoute une ligne de métriques au tableau d'historique d'entraînement.
 *
 * @param {number} iteration - Époque.
 * @param {{direction:{loss:number, accuracy:number, testAccuracy:number},
 *           forecast:{loss:number, maePct:number}}} metrics - Métriques des deux modèles.
 */
function appendMetricsRow(iteration, metrics) {
  const row = document.createElement('tr');
  row.innerHTML = `
    <td>${iteration}</td>
    <td>${metrics.direction.loss.toFixed(4)}</td>
    <td>${(metrics.direction.accuracy * 100).toFixed(1)} %</td>
    <td>${(metrics.direction.testAccuracy * 100).toFixed(1)} %</td>
    <td>${metrics.forecast.loss.toFixed(6)}</td>
    <td>${metrics.forecast.maePct !== null ? metrics.forecast.maePct.toFixed(2) + ' %' : '—'}</td>
  `;
  metricsTableBody.prepend(row);
}

/**
 * Met Ã  jour le panneau de prédiction : biais de marché + chemin de bougies futures.
 *
 * @param {Object} prediction - { probaUp, label, color, trained, epochs, forecast }.
 */
function renderPrediction(prediction) {
  const pct = Math.round(prediction.probaUp * 100);
  probaBar.style.width = pct + '%';
  probaBar.style.background = prediction.color;
  probaPercent.textContent = pct + ' %';
  predictedLabel.textContent = prediction.label;
  predictedLabel.style.color = prediction.color;
  predictionNote.textContent = prediction.trained
    ? `Prédiction de la prochaine bougie horaire, après ${prediction.epochs} époques d'entraînement.`
    : `Modèle partiellement entraîné (${prediction.epochs}/10 époques) : prédiction peu fiable pour l'instant.`;

  // Cartes des prix futurs : x+1 h, x+4 h, x+12 h (rollout) + x+7 jours (prédiction directe)
  lastForecast = prediction.forecast ? { steps: prediction.forecast } : null;
  forecastList.innerHTML = '';
  if (lastForecast && prediction.forecast.length) {
    const picks = [0, 3, 11]; // indices des pas +1 h, +4 h, +12 h
    picks.forEach(idx => {
      const step = prediction.forecast[idx];
      if (!step) return;
      const up = step.retPct >= 0;
      const card = document.createElement('div');
      card.className = 'forecast-card';
      card.innerHTML = `
        <div class="forecast-h">${idx === 0 ? '+1 h' : '+' + (idx + 1) + ' h'}</div>
        <div class="forecast-price" style="color:${up ? 'var(--mint)' : 'var(--coral)'}">
          ${up ? 'â–²' : 'â–¼'} ${step.price.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} $
        </div>
        <div class="forecast-ret">${up ? '+' : ''}${step.retPct.toFixed(2)} %</div>
      `;
      forecastList.appendChild(card);
    });
  }
  if (prediction.weekly && Number.isFinite(prediction.weekly.price)) {
    const w = prediction.weekly;
    const up = w.retPct >= 0;
    const card = document.createElement('div');
    card.className = 'forecast-card weekly';
    card.innerHTML = `
      <div class="forecast-h">+7 jours (direct)</div>
      <div class="forecast-price" style="color:${up ? 'var(--mint)' : 'var(--coral)'}">
        ${up ? 'â–²' : 'â–¼'} ${w.price.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} $
      </div>
      <div class="forecast-ret">${up ? '+' : ''}${w.retPct.toFixed(2)} %</div>
    `;
    forecastList.appendChild(card);
  }

  // Prévision rétrospective : compare le chemin prédit il y a N h avec la réalité
  lastBacktest = prediction.backtest || null;
  if (backtestNote) {
    if (lastBacktest && lastBacktest.steps && lastBacktest.steps.length) {
      let maeSum = 0;
      let count = 0;
      lastBacktest.steps.forEach((s, i) => {
        const actual = lastBacktest.actual[i];
        if (actual) {
          maeSum += Math.abs(s.price - actual.price) / actual.price;
          count++;
        }
      });
      const mae = count ? (maeSum / count) * 100 : null;
      const depth = lastBacktest.actual.length;
      backtestNote.textContent = mae !== null
        ? `Prévision relancée il y a ${depth} h (ligne ambre) vs bougies réelles : erreur moyenne MAE ${mae.toFixed(2)} % sur ${depth} h.`
        : 'Prévision rétrospective en cours de calcul...';
    } else {
      backtestNote.textContent = 'Pas encore assez d\'historique pour rejouer une prévision passée.';
    }
  }
  // Le graphique est redessiné avec le chemin pointillé violet + la prévision rétrospective ambre
  renderChart(lastCandles);
  // Mise à jour du graphique et de la section hebdomadaire (prévision +7 j du modèle horaire)
  lastWeeklyForecast = prediction.weekly || null;
  renderWeeklyChart(lastWeeklyCandles, lastWeeklyForecast);
  if (weeklyForecastList) {
    weeklyForecastList.innerHTML = '';
    if (prediction.weekly && Number.isFinite(prediction.weekly.price)) {
      const w = prediction.weekly;
      const up = w.retPct >= 0;
      const card = document.createElement('div');
      card.className = 'forecast-card weekly';
      card.innerHTML = `
        <div class="forecast-h">Semaine prédite (+7 j)</div>
        <div class="forecast-price" style="color:${up ? 'var(--mint)' : 'var(--coral)'}">
          ${up ? '▲' : '▼'} ${w.price.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} $
        </div>
        <div class="forecast-ret">${up ? '+' : ''}${w.retPct.toFixed(2)} % (sortie directe)</div>
      `;
      weeklyForecastList.appendChild(card);
      if (weeklyPredictionNote) weeklyPredictionNote.textContent = 'Prévision hebdomadaire issue du modèle horaire (affichée en fin de graphique).';
    } else if (weeklyPredictionNote) {
      weeklyPredictionNote.textContent = 'Aucune prévision hebdomadaire disponible. Lancez une prédiction du modèle horaire.';
    }
  }
}

/**
 * Ajoute une entrée au terminal d'administration.
 *
 * @param {string} entry - Ligne de log horodatée.
 */
function appendAdminLog(entry) {
  const line = document.createElement('div');
  line.className = 'terminal-line';
  line.textContent = entry;
  adminTerminal.appendChild(line);
  adminTerminal.scrollTop = adminTerminal.scrollHeight;
  while (adminTerminal.children.length > 60) adminTerminal.removeChild(adminTerminal.firstChild);
}

// ---- Branchement des sockets ----

socket.on('connect', () => {
  statusText.textContent = 'Connecté au serveur';
  statusBadge.classList.add('online');
});

socket.on('disconnect', () => {
  statusText.textContent = 'Déconnecté';
  statusBadge.classList.remove('online');
});

socket.on('serverStatus', status => {
  if (status.epochsDone > 0) {
    renderProgress(status.epochsDone, status.totalIterations);
  }
});

socket.on('marketData', data => {
  renderMarketHeader(data);
  renderGauge(data.fg);
  renderComponents(data.fg.components);
  renderChart(data.candles);
  renderWeeklyChart(data.weeklyCandles, lastWeeklyForecast);
});

socket.on('marketError', err => {
  statusText.textContent = 'Erreur marché : ' + err.message;
});

socket.on('epochUpdate', payload => {
  renderProgress(payload.iteration, payload.totalIterations);
  appendMetricsRow(payload.iteration, payload.metrics);
  displayEpochMessageWithFade(payload.message);
  displayWeeklyEpochMessage(payload.message);
  statusText.textContent = `Entraînement : époque ${payload.iteration}/${payload.totalIterations}`;
});

socket.on('trainingStarted', payload => {
  btnTrainStep.disabled = true;
  btnTrainFull.disabled = true;
  if (btnWeeklyTrainStep) btnWeeklyTrainStep.disabled = true;
  if (btnWeeklyTrainFull) btnWeeklyTrainFull.disabled = true;
  displayEpochMessageWithFade('Entraînement démarré...');
  displayWeeklyEpochMessage('Entraînement démarré (modèle horaire, prévision hebdo)...');
});

socket.on('stepPaused', payload => {
  btnTrainStep.disabled = false;
  btnTrainFull.disabled = false;
  if (btnWeeklyTrainStep) btnWeeklyTrainStep.disabled = false;
  if (btnWeeklyTrainFull) btnWeeklyTrainFull.disabled = false;
  statusText.textContent = `Pause Ã  l'époque ${payload.currentIteration}/${payload.totalIterations}`;
});

socket.on('trainingComplete', payload => {
  btnTrainStep.disabled = true;
  btnTrainFull.disabled = true;
  if (btnWeeklyTrainStep) btnWeeklyTrainStep.disabled = true;
  if (btnWeeklyTrainFull) btnWeeklyTrainFull.disabled = true;
  displayEpochMessageWithFade(payload.message);
  statusText.textContent = 'Entraînement complet — inférence prête';
});

socket.on('modelReset', payload => {
  btnTrainStep.disabled = false;
  btnTrainFull.disabled = false;
  if (btnWeeklyTrainStep) btnWeeklyTrainStep.disabled = false;
  if (btnWeeklyTrainFull) btnWeeklyTrainFull.disabled = false;
  metricsTableBody.innerHTML = '';
  renderProgress(0, payload.totalIterations);
  renderWeeklyProgress(0, payload.totalIterations);
  displayWeeklyEpochMessage('Modèle réinitialisé. Lancez l\'entraînement pour la prévision hebdomadaire.');
  probaBar.style.width = '0%';
  probaPercent.textContent = '—';
  predictedLabel.textContent = 'En attente d\'entraînement';
  predictedLabel.style.color = 'var(--muted)';
  predictionNote.textContent = 'Réinitialisez puis lancez l\'entraînement pas-Ã -pas pour observer l\'apprentissage.';
  forecastList.innerHTML = '';
  backtestNote.textContent = 'Pas encore assez d\'historique pour rejouer une prévision passée.';
  lastForecast = null;
  lastBacktest = null;
  lastWeeklyForecast = null;
  if (weeklyForecastList) weeklyForecastList.innerHTML = '';
  if (weeklyPredictionNote) weeklyPredictionNote.textContent = 'Aucune prévision hebdomadaire disponible. Lancez une prédiction du modèle horaire.';
  renderChart(lastCandles);
  renderWeeklyChart(lastWeeklyCandles, null);
  if (payload.adminStats) renderAdminStats(payload.adminStats);
});

socket.on('predictionResult', renderPrediction);

socket.on('adminStats', renderAdminStats);

socket.on('adminLog', appendAdminLog);

/**
 * Rend les statistiques d'administration dans la carte dédiée.
 *
 * @param {Object} stats - Statistiques émises par le serveur.
 */
function renderAdminStats(stats) {
  adminTotalParams.textContent = stats.totalParams.toLocaleString('fr-FR');
  adminTfBackend.textContent = stats.tfBackend || '—';
  adminDataset.textContent = stats.datasetSize || '—';
  adminHeap.textContent = `${stats.heapUsedMB} / ${stats.heapTotalMB} Mo`;
  const modelsBreakdown = document.getElementById('adminModels');
  if (modelsBreakdown && stats.classifierParams) {
    modelsBreakdown.textContent = `${stats.classifierParams.toLocaleString('fr-FR')} + ${stats.forecasterParams.toLocaleString('fr-FR')} (h : ${stats.horizons})`;
  }
}

// ---- Actions utilisateur ----

btnTrainStep.addEventListener('click', () => socket.emit('trainStep'));
btnTrainFull.addEventListener('click', () => socket.emit('trainFull'));
btnResetModel.addEventListener('click', () => socket.emit('resetModel'));
btnPredict.addEventListener('click', () => socket.emit('requestPredict'));

// Redessine les graphiques au redimensionnement de la fenêtre
window.addEventListener('resize', () => {
  socket.emit('requestMarket');
  socket.emit('requestDailyMarket');
  renderWeeklyChart(lastWeeklyCandles, lastWeeklyForecast);
  renderDailyChart(lastDailyCandles);
});

// ---- Daily (graphique dédié) ----
function renderDailyPrediction(prediction) {
  lastDailyForecast = prediction.forecast ? { steps: prediction.forecast } : null;
  lastDailyBacktest = prediction.backtest || null;
  if (dailyPredictionNote) {
    const p = Math.round((prediction.probaUp || 0) * 100);
    dailyPredictionNote.textContent = 'P(hausse prochain jour) : ' + p + ' % — ' + (prediction.label || '') + ' (' + (prediction.epochs || 0) + ' époques)';
  }
  if (dailyForecastList) {
    dailyForecastList.innerHTML = '';
    if (prediction.forecast && prediction.forecast.length) {
      const picks = [0, 3, 6, 29].filter(i => i < prediction.forecast.length);
      picks.forEach(idx => {
        const step = prediction.forecast[idx];
        if (!step) return;
        const up = step.retPct >= 0;
        const card = document.createElement('div');
        card.className = 'forecast-card';
        card.innerHTML = `
          <div class="forecast-h">+${idx + 1} j</div>
          <div class="forecast-price" style="color:${up ? 'var(--mint)' : 'var(--coral)'}">
            ${up ? '▲' : '▼'} ${step.price.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} $
          </div>
          <div class="forecast-ret">${up ? '+' : ''}${step.retPct.toFixed(2)} %</div>
        `;
        dailyForecastList.appendChild(card);
      });
    }
    if (prediction.longForecast && Number.isFinite(prediction.longForecast.price)) {
      const w = prediction.longForecast;
      const up = w.retPct >= 0;
      const card = document.createElement('div');
      card.className = 'forecast-card weekly';
      card.innerHTML = `
        <div class="forecast-h">+30 j (direct)</div>
        <div class="forecast-price" style="color:${up ? 'var(--mint)' : 'var(--coral)'}">
          ${up ? '▲' : '▼'} ${w.price.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} $
        </div>
        <div class="forecast-ret">${up ? '+' : ''}${w.retPct.toFixed(2)} %</div>
      `;
      dailyForecastList.appendChild(card);
    }
  }
  if (dailyBacktestNote) {
    if (lastDailyBacktest && lastDailyBacktest.steps && lastDailyBacktest.steps.length) {
      let maeSum = 0, count = 0;
      lastDailyBacktest.steps.forEach((s, i) => {
        const actual = lastDailyBacktest.actual && lastDailyBacktest.actual[i];
        if (actual) { maeSum += Math.abs(s.price - actual.price) / actual.price; count++; }
      });
      const mae = count ? (maeSum / count) * 100 : null;
      const depth = lastDailyBacktest.actual ? lastDailyBacktest.actual.length : 0;
      dailyBacktestNote.textContent = mae !== null
        ? `Prévision relancée il y a ${depth} j (ligne ambre) vs bougies réelles : MAE ${mae.toFixed(2)} % sur ${depth} j.`
        : 'Prévision rétrospective en cours de calcul...';
    } else {
      dailyBacktestNote.textContent = 'Pas encore assez d\'historique pour rejouer une prévision passée.';
    }
  }
  renderDailyChart(lastDailyCandles);
}


socket.on('dailyMarketData', data => { renderDailyChart(data.candles || []); });
socket.on('dailyPredictionResult', renderDailyPrediction);

socket.on('predictionUnavailable', (info) => {
  if (predictedLabel) { predictedLabel.textContent = 'Prédiction indisponible'; predictedLabel.style.color = 'var(--muted)'; }
  if (predictionNote) predictionNote.textContent = 'Entraînez le modèle horaire (ou restaurez des poids) puis cliquez sur « Prédire ».';
  if (probaBar) probaBar.style.width = '0%';
  if (probaPercent) probaPercent.textContent = '—';
  if (forecastList) forecastList.innerHTML = '';
  if (backtestNote) backtestNote.textContent = 'Aucune prévision affichée.';
  lastForecast = null; lastBacktest = null; lastWeeklyForecast = null;
  renderChart(lastCandles);
  renderWeeklyChart(lastWeeklyCandles, null);
  if (weeklyForecastList) weeklyForecastList.innerHTML = '';
  if (weeklyPredictionNote) weeklyPredictionNote.textContent = 'Aucune prévision hebdomadaire disponible. Lancez une prédiction du modèle horaire.';
});
socket.on('dailyPredictionUnavailable', (info) => {
  if (dailyPredictionNote) dailyPredictionNote.textContent = 'Prédiction daily indisponible : entraînez le modèle daily puis cliquez sur « Prédire daily ».';
  if (dailyForecastList) dailyForecastList.innerHTML = '';
  if (dailyBacktestNote) dailyBacktestNote.textContent = 'Aucune prévision affichée.';
  lastDailyForecast = null; lastDailyBacktest = null;
  renderDailyChart(lastDailyCandles);
});

function displayDailyEpochMessage(text) {
  if (!dailyEpochMessageBox || !dailyEpochMessageText) return;
  dailyEpochMessageBox.classList.remove('fade-in');
  dailyEpochMessageBox.classList.add('fade-out');
  setTimeout(() => {
    dailyEpochMessageText.textContent = text;
    dailyEpochMessageBox.classList.remove('fade-out');
    dailyEpochMessageBox.classList.add('fade-in');
  }, 200);
}

socket.on('dailyEpochUpdate', payload => {
  renderDailyProgress(payload.iteration, payload.totalIterations);
  displayDailyEpochMessage(payload.message || ('Époque ' + payload.iteration));
});
socket.on('dailyTrainingStarted', () => {
  if (btnDailyTrainStep) btnDailyTrainStep.disabled = true;
  if (btnDailyTrainFull) btnDailyTrainFull.disabled = true;
  displayDailyEpochMessage('Entraînement daily démarré...');
});
socket.on('dailyStepPaused', payload => {
  if (btnDailyTrainStep) btnDailyTrainStep.disabled = false;
  if (btnDailyTrainFull) btnDailyTrainFull.disabled = false;
  renderDailyProgress(payload.currentIteration, payload.totalIterations);
});
socket.on('dailyTrainingComplete', () => {
  if (btnDailyTrainStep) btnDailyTrainStep.disabled = true;
  if (btnDailyTrainFull) btnDailyTrainFull.disabled = true;
  displayDailyEpochMessage('Entraînement daily terminé — inférence prête. Cliquez sur « Prédire daily » pour afficher les prévisions.');
});
socket.on('dailyModelReset', payload => {
  if (btnDailyTrainStep) btnDailyTrainStep.disabled = false;
  if (btnDailyTrainFull) btnDailyTrainFull.disabled = false;
  renderDailyProgress(0, (payload && payload.totalIterations) || 10);
  lastDailyForecast = null; lastDailyBacktest = null;
  if (dailyPredictionNote) dailyPredictionNote.textContent = 'Modèle daily réinitialisé.';
  renderDailyChart(lastDailyCandles);
});

if (btnDailyTrainStep) btnDailyTrainStep.addEventListener('click', () => socket.emit('dailyTrainStep'));
if (btnDailyTrainFull) btnDailyTrainFull.addEventListener('click', () => socket.emit('dailyTrainFull'));
if (btnDailyResetModel) btnDailyResetModel.addEventListener('click', () => socket.emit('dailyResetModel'));
if (btnDailyPredict) btnDailyPredict.addEventListener('click', () => socket.emit('dailyRequestPredict'));

if (btnWeeklyTrainStep) btnWeeklyTrainStep.addEventListener('click', () => socket.emit('trainStep'));
if (btnWeeklyTrainFull) btnWeeklyTrainFull.addEventListener('click', () => socket.emit('trainFull'));
if (btnWeeklyResetModel) btnWeeklyResetModel.addEventListener('click', () => socket.emit('resetModel'));
if (btnWeeklyPredict) btnWeeklyPredict.addEventListener('click', () => socket.emit('requestPredict'));
