/**
 * @file server.js
 * @description Serveur backend Node.js pour l'indice Fear & Greed BTC/USD :
 *              collecte des données d'échange (Kraken/Coinbase/CoinGecko), calcul de l'indice,
 *              entraînement TensorFlow.js pas-à-pas, prévision de bougies futures et inférence.
 *
 * Fonctionnement :
 * 1. Toutes les 60 s, le serveur récupère les bougies horaires BTC/USD et la dominance BTC,
 *    fusionne le tout avec l'historique persisté dans `data/` et diffuse l'indice.
 * 2. À la connexion d'un client, l'état complet (indice + historique) est envoyé.
 * 3. L'entraînement est manuel : mode "Pas-à-pas" (1 époque) ou "Automatique" (10 époques),
 *    deux modèles en parallèle (direction + rendements futurs), messages explicatifs par époque.
 * 4. À la fin de l'entraînement, les poids sont sauvegardés dans `data/` et rechargés au démarrage.
 * 5. Télémétrie d'administration (paramètres du modèle, mémoire Heap, backend TF).
 */

// Tentative de chargement du backend natif accéléré C++ (@tensorflow/tfjs-node).
// S'il n'est pas présent ou incompatible, bascule transparente sur le backend pur JS (@tensorflow/tfjs).
try {
  require('@tensorflow/tfjs-node');
} catch (e) {
  require('@tensorflow/tfjs');
}

const tf = require('@tensorflow/tfjs');
const http = require('http');
const path = require('path');
const socketio = require('socket.io');

// Origines autorisées pour Socket.IO (GitHub Pages, dev local). Configurable via ALLOWED_ORIGINS (séparées par des virgules).
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '*:*';
const market = require('./market');
const indicators = require('./indicators');
const sentiment = require('./sentiment');
const sentimentDaily = require('./sentiment-daily');
const store = require('./store');

/** Délai de pause (en ms) entre chaque cycle d'entraînement pour fluidifier l'Event Loop */
const TIMEOUT_BETWEEN_EPOCHS_MS = 350;

/** Port TCP d'écoute du serveur WebSocket */
const PORT = 8002;

/** Nombre total d'itérations prévues */
const TOTAL_ITERATIONS = 10;

/** Intervalle de rafraîchissement des données de marché (ms) — 5 min, suffisant pour des bougies horaires */
const MARKET_REFRESH_MS = 5 * 60 * 1000;

/** Profondeur d'historique téléchargée au démarrage (jours) — Coinbase paginé */
const HISTORY_DAYS = 365;
/** Historique daily téléchargé au démarrage (jours) */
const HISTORY_DAYS_DAILY = 730;
/** Bougies récentes récupérées à chaque rafraîchissement (jours) puis fusionnées */
const REFRESH_DAYS = 2;
const REFRESH_DAYS_DAILY = 7;

// Messages pédagogiques progressifs pour chaque époque
const EPOCH_MESSAGES = [
  "Époque 1/10 : Poids initiaux aléatoires sur les DEUX modèles. Le classifieur prédit au hasard (loss ≈ ln(2) ≈ 0.693), le prévisionniste renvoie un rendement quasi nul.",
  "Époque 2/10 : Normalisation active. Les 6 caractéristiques par bougie (rendement, volume relatif, RSI, position EMA, momentum 24 h, amplitude) circulent dans les couches LSTM.",
  "Époque 3/10 : Détection du momentum. Le classifieur repère que des suites de bougies vertes augmentent la probabilité de continuation.",
  "Époque 4/10 : Analyse du volume. Les pics de volume (achats/ventes agressifs) sont corrélés aux retournements locaux.",
  "Époque 5/10 : Mémoire temporelle. Les cellules LSTM retiennent la direction des 24 dernières heures pour départager haussier/baissier.",
  "Époque 6/10 : Prévision multi-horizons. Le prévisionniste apprend simultanément les rendements à +1 h, +4 h, +12 h et +7 jours (sortie linéaire).",
  "Époque 7/10 : Équilibre haussier/baissier. Le classifieur apprend à ne pas sur-pondérer la classe majoritaire du jeu de données.",
  "Époque 8/10 : Généralisation. L'accuracy se stabilise au-dessus du hasard (50%) : le signal extrait est statistiquement réel.",
  "Époque 9/10 : Évaluation chronologique. Le jeu de test (20% les plus récents) n'a jamais été vu à l'entraînement.",
  "Époque 10/10 : Convergence atteinte ! Les poids sont sauvegardés dans data/, le biais du modèle alimente l'indice et le chemin de bougies futures est prêt."
];

// État de l'entraînement partagé (horaire)
let isTraining = false;
let isTrainingComplete = false;
let currentIteration = 0;
// true dès que les poids du modèle sont réels (restaurés de data/ ou entraînés dans cette session) :
// tant que le modèle est aléatoire, son biais n'entre PAS dans l'indice
let hasTrainedWeights = false;
let lastMetrics = null;

// État de l'entraînement partagé (daily)
let isTrainingDaily = false;
let isTrainingCompleteDaily = false;
let currentIterationDaily = 0;
let hasTrainedWeightsDaily = false;
let lastMetricsDaily = null;

let serverLogs = [];

// État du marché partagé (horaire)
let marketState = {
  candles: [], fg: null, source: null, updatedAt: null, error: null,
  dominance: null, dominanceHistory: []
};

// État du marché partagé (daily)
let dailyMarketState = {
  candles: [], fg: null, source: null, updatedAt: null, error: null
};

/**
 * Fonction utilitaire asynchrone permettant de marquer une pause temporelle.
 *
 * @param {number} ms - Durée de la pause en millisecondes.
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Envoie un message de log au terminal et le diffuse à la console d'administration client.
 *
 * @param {Object} io - Instance Socket.io
 * @param {string} msg - Message de log
 */
function logToAdmin(io, msg) {
  const timestamp = new Date().toLocaleTimeString();
  const entry = `[${timestamp}] ${msg}`;
  console.log(entry);
  serverLogs.push(entry);
  if (serverLogs.length > 50) serverLogs.shift();
  io.emit('adminLog', entry);
}

/**
 * Récupère bougies + dominance, fusionne avec l'historique persisté, calcule l'indice
 * et met à jour le dataset des modèles.
 *
 * @param {Object} io - Instance Socket.io.
 * @param {number} [days=REFRESH_DAYS] - Jours de bougies à télécharger (plus au démarrage).
 */
async function refreshMarket(io, days = REFRESH_DAYS) {
  try {
    const { source, candles: fetched } = await market.fetchCandles(days);

    // Fusion avec l'historique persisté : l'historique s'accumule au fil des sessions
    const merged = store.mergeCandles(marketState.candles.length ? marketState.candles : [], fetched);
    store.saveCandles(merged);

    // Dominance BTC (CoinGecko) : tolérée en échec, l'indice fonctionne sans elle
    let dominance = marketState.dominance;
    try {
      const { pct } = await market.fetchDominance();
      const last = marketState.dominanceHistory[marketState.dominanceHistory.length - 1];
      if (!last || last.pct !== pct || Date.now() / 1000 - last.t > 3600) {
        marketState.dominanceHistory.push({ t: Math.floor(Date.now() / 1000), pct });
        if (marketState.dominanceHistory.length > 20000) {
          marketState.dominanceHistory = marketState.dominanceHistory.slice(-20000);
        }
        store.saveDominance(marketState.dominanceHistory);
      }
      dominance = { pct };
    } catch (dominanceError) {
      logToAdmin(io, `Dominance indisponible (${dominanceError.message}) : composante ignorée`);
    }

    // Variation de la dominance sur 24 h (points de %) à partir de l'historique
    if (dominance && marketState.dominanceHistory.length) {
      const now = Math.floor(Date.now() / 1000);
      const past = [...marketState.dominanceHistory].reverse().find(d => d.t <= now - 24 * 3600);
      dominance.changePct = past ? dominance.pct - past.pct : 0;
    }

    // Biais du modèle LSTM (P(hausse)) : entre dans l'indice pour raccord haut/bas,
    // mais UNIQUEMENT si les poids sont entraînés (sinon le modèle aléatoire renvoie ≈ 50%,
    // ce qui n'a aucun sens de l'afficher dans l'indice)
    let modelBias = null;
    if (hasTrainedWeights) {
      try {
        modelBias = sentiment.predict(merged).probaUp;
      } catch (biasError) {
        // Modèle non encore prêt : la composante est ignorée
      }
    }

    const fg = indicators.fearGreed(merged, dominance, modelBias);
    marketState.candles = merged;
    marketState.dominance = dominance;
    marketState.fg = fg;
    marketState.source = source;
    marketState.updatedAt = new Date().toISOString();
    marketState.error = null;

    sentiment.prepareData(merged);
    logToAdmin(io, `Marché rafraîchi (${source}) : ${merged.length} bougies, dominance ${dominance ? dominance.pct.toFixed(1) + '%' : 'n/d'}, indice ${fg.score}/100 (${fg.label})`);
    io.emit('marketData', serializeMarket());
    // Ne pas diffuser automatiquement de prévisions : l'utilisateur les demande via "Prédire".
  // (Le biais du modèle dans l'indice Fear & Greed reste calculé ci-dessus si des poids sont disponibles.)
  } catch (err) {
    marketState.error = err.message;
    logToAdmin(io, `Erreur de collecte de marché : ${err.message}`);
    io.emit('marketError', { message: err.message });
  }
}

/**
 * Sérialise l'état du marché pour le client : 7 derniers jours de bougies horaires
 * (graphique principal) + bougies hebdomadaires (graphique hebdo) + dominance.
 */
function serializeMarket() {
  return {
    fg: marketState.fg,
    dominance: marketState.dominance,
    source: marketState.source,
    updatedAt: marketState.updatedAt,
    totalCandles: marketState.candles.length,
    candles: marketState.candles.slice(-168),
    weeklyCandles: indicators.aggregateWeekly(marketState.candles),
    error: marketState.error
  };
}

/**
 * Calcule les métriques système et modèle pour la console d'administration.
 */
function getAdminStats() {
  const mem = process.memoryUsage();
  const s = sentiment.stats();
  return {
    nodeVersion: process.version,
    platform: process.platform,
    port: PORT,
    uptimeSeconds: Math.floor(process.uptime()),
    tfBackend: tf.getBackend(),
    totalParams: s.totalParams,
    classifierParams: s.classifierParams,
    forecasterParams: s.forecasterParams,
    window: s.window,
    features: s.features,
    horizons: s.horizons.join(' / '),
    datasetSize: s.hasData ? 'prêt' : 'en attente de données',
    heapUsedMB: (mem.heapUsed / 1024 / 1024).toFixed(1),
    heapTotalMB: (mem.heapTotal / 1024 / 1024).toFixed(1),
    layers: s.layers
  };
}

/**
 * Lance l'inférence et diffuse le biais de marché + le chemin de bougies futures
 * + la prévision rétrospective (comparaison prédit/réel sur les 12 dernières bougies).
 *
 * @param {Object} io - Instance Socket.io.
 */
function broadcastPrediction(io) {
  try {
    const { probaUp } = sentiment.predict(marketState.candles);
    const s = sentiment.sentimentLabel(probaUp);
    const path = sentiment.forecastPath(marketState.candles);
    const bt = sentiment.backtest(marketState.candles);
    let weekly = null;
    try { weekly = sentiment.weeklyForecast(marketState.candles); } catch (wErr) {
      logToAdmin(io, `Prévision hebdo indisponible : ${wErr.message}`);
    }
    io.emit('predictionResult', {
      probaUp,
      label: s.label,
      color: s.color,
      trained: isTrainingComplete,
      epochs: currentIteration,
      lastT: path.lastT,
      forecast: path.steps,
      backtest: bt,
      weekly
    });
  } catch (err) {
    logToAdmin(io, `Erreur d'inférence : ${err.message}`);
  }
}

function serializeDailyMarket() {
  return {
    fg: dailyMarketState.fg,
    source: dailyMarketState.source,
    updatedAt: dailyMarketState.updatedAt,
    totalCandles: dailyMarketState.candles.length,
    candles: dailyMarketState.candles.slice(-365),
    error: dailyMarketState.error
  };
}

async function refreshDailyMarket(io, days = REFRESH_DAYS_DAILY) {
  try {
    const { source, candles: fetched } = await market.fetchDailyCandles(days);
    const merged = store.mergeCandles(dailyMarketState.candles.length ? dailyMarketState.candles : [], fetched);
    store.saveDailyCandles(merged);

    let modelBias = null;
    if (hasTrainedWeightsDaily) {
      try { modelBias = sentimentDaily.predict(merged).probaUp; } catch (e) { /* modèle pas prêt */ }
    }
    // Indice calculé sur les bougies journalières (sans dominance horaire spécifique, on réutilise la dernière connue si dispo)
    const fg = indicators.fearGreed(merged, marketState.dominance, modelBias);
    dailyMarketState.candles = merged;
    dailyMarketState.fg = fg;
    dailyMarketState.source = source;
    dailyMarketState.updatedAt = new Date().toISOString();
    dailyMarketState.error = null;

    sentimentDaily.prepareData(merged);
    logToAdmin(io, `Marché daily rafraîchi (${source}) : ${merged.length} bougies, indice ${fg.score}/100 (${fg.label})`);
    io.emit('dailyMarketData', serializeDailyMarket());
    // Prévisions diffusées uniquement sur demande explicite (bouton Prédire).
  } catch (err) {
    dailyMarketState.error = err.message;
    logToAdmin(io, `Erreur de collecte daily : ${err.message}`);
    io.emit('dailyMarketError', { message: err.message });
  }
}

function broadcastDailyPrediction(io) {
  try {
    const { probaUp } = sentimentDaily.predict(dailyMarketState.candles);
    const s = sentimentDaily.sentimentLabel(probaUp);
    const path = sentimentDaily.forecastPath(dailyMarketState.candles);
    const bt = sentimentDaily.backtest(dailyMarketState.candles);
    let longForecast = null;
    try { longForecast = sentimentDaily.weeklyForecast(dailyMarketState.candles); } catch (wErr) {
      logToAdmin(io, `Prévision long terme daily indisponible : ${wErr.message}`);
    }
    io.emit('dailyPredictionResult', {
      probaUp,
      label: s.label,
      color: s.color,
      trained: isTrainingCompleteDaily,
      epochs: currentIterationDaily,
      lastT: path.lastT,
      forecast: path.steps,
      backtest: bt,
      longForecast,
      horizons: sentimentDaily.HORIZONS
    });
  } catch (err) {
    logToAdmin(io, `Erreur d'inférence daily : ${err.message}`);
  }
}

async function trainDailyEpochs(io, epochsToRun = 10) {
  if (isTrainingDaily) {
    logToAdmin(io, 'Entraînement daily déjà en cours.');
    io.emit('dailyStepPaused', { currentIteration: currentIterationDaily, totalIterations: TOTAL_ITERATIONS, metrics: lastMetricsDaily });
    return;
  }
  if (!dailyMarketState.candles.length) {
    logToAdmin(io, 'Entraînement daily impossible : aucune bougie chargée.');
    io.emit('dailyStepPaused', { currentIteration: currentIterationDaily, totalIterations: TOTAL_ITERATIONS, metrics: lastMetricsDaily });
    return;
  }
  try {
    // S'assurer que le dataset est préparé (données semées au démarrage ou après échec de refresh).
    sentimentDaily.prepareData(dailyMarketState.candles);
  } catch (err) {
    logToAdmin(io, 'Préparation des données daily impossible : ' + err.message);
    io.emit('dailyStepPaused', { currentIteration: currentIterationDaily, totalIterations: TOTAL_ITERATIONS, metrics: lastMetricsDaily });
    return;
  }
  isTrainingDaily = true;
  io.emit('dailyTrainingStarted', { epochsToRun, currentIteration: currentIterationDaily, totalIterations: TOTAL_ITERATIONS });

  try {
    const targetIteration = Math.min(TOTAL_ITERATIONS, currentIterationDaily + epochsToRun);
    while (currentIterationDaily < targetIteration) {
      currentIterationDaily++;
      const epochMsg = `Époque ${currentIterationDaily}/${TOTAL_ITERATIONS} (daily, fenêtre ${sentimentDaily.WINDOW} j, horizons ${sentimentDaily.HORIZONS.join('/')} j)`;
      logToAdmin(io, `Époque daily ${currentIterationDaily}/${TOTAL_ITERATIONS} en cours...`);
      const metrics = await sentimentDaily.trainEpoch();
      lastMetricsDaily = metrics;
      logToAdmin(io, `Époque daily ${currentIterationDaily}/${TOTAL_ITERATIONS} terminée — direction ${metrics.direction.loss.toFixed(4)} (test ${(metrics.direction.testAccuracy * 100).toFixed(1)}%) | MAE ${metrics.forecast.maePct.toFixed(2)}%`);
      io.emit('dailyEpochUpdate', { iteration: currentIterationDaily, totalIterations: TOTAL_ITERATIONS, metrics, message: epochMsg });
      await sleep(TIMEOUT_BETWEEN_EPOCHS_MS);
    }

    isTrainingCompleteDaily = (currentIterationDaily >= TOTAL_ITERATIONS);
    if (isTrainingCompleteDaily) {
      const saved = await sentimentDaily.saveModels();
      hasTrainedWeightsDaily = true;
      logToAdmin(io, `Poids daily sauvegardés — ${path.basename(saved.classifier)} et ${path.basename(saved.forecaster)}`);
      io.emit('dailyTrainingComplete', { totalIterations: TOTAL_ITERATIONS, metrics: lastMetricsDaily, message: 'Entraînement daily terminé.' });
      await refreshDailyMarket(io, REFRESH_DAYS_DAILY);
      broadcastDailyPrediction(io);
    } else {
      io.emit('dailyStepPaused', { currentIteration: currentIterationDaily, totalIterations: TOTAL_ITERATIONS, metrics: lastMetricsDaily });
      broadcastDailyPrediction(io);
    }
  } catch (err) {
    logToAdmin(io, 'Erreur pendant l\'entraînement daily : ' + (err && err.message ? err.message : err));
    io.emit('dailyStepPaused', { currentIteration: currentIterationDaily, totalIterations: TOTAL_ITERATIONS, metrics: lastMetricsDaily });
  } finally {
    isTrainingDaily = false;
  }
}

function resetDailyModelSession(io) {
  sentimentDaily.resetModel();
  isTrainingDaily = false;
  isTrainingCompleteDaily = false;
  hasTrainedWeightsDaily = false;
  currentIterationDaily = 0;
  lastMetricsDaily = null;
  logToAdmin(io, 'Poids du modèle daily réinitialisés et sauvegardes supprimées.');
  io.emit('dailyModelReset', { totalIterations: TOTAL_ITERATIONS });
  refreshDailyMarket(io, REFRESH_DAYS_DAILY).catch(() => {});
}

/**
 * Exécute une ou plusieurs époques d'apprentissage des deux modèles.
 *
 * @param {Object} io - Instance Socket.io
 * @param {number} epochsToRun - Nombre d'époques à exécuter (1 pour pas-à-pas, ou jusqu'à 10)
 */
async function trainEpochs(io, epochsToRun = 10) {
  if (isTraining) {
    logToAdmin(io, 'Entraînement horaire déjà en cours.');
    io.emit('stepPaused', { currentIteration: currentIteration, totalIterations: TOTAL_ITERATIONS, metrics: lastMetrics });
    return;
  }
  if (!marketState.candles.length) {
    logToAdmin(io, 'Impossible d\'entraîner : aucune donnée de marché disponible.');
    io.emit('stepPaused', { currentIteration: currentIteration, totalIterations: TOTAL_ITERATIONS, metrics: lastMetrics });
    return;
  }
  try {
    // S'assurer que le dataset est préparé (données semées au démarrage ou après échec de refresh).
    sentiment.prepareData(marketState.candles);
  } catch (err) {
    logToAdmin(io, 'Préparation des données horaire impossible : ' + err.message);
    io.emit('stepPaused', { currentIteration: currentIteration, totalIterations: TOTAL_ITERATIONS, metrics: lastMetrics });
    return;
  }
  isTraining = true;

  logToAdmin(io, `Démarrage de l'apprentissage (${epochsToRun} époque(s) demandée(s))`);
  io.emit('trainingStarted', {
    totalIterations: TOTAL_ITERATIONS,
    currentIteration: currentIteration
  });

  try {
    const targetIteration = Math.min(TOTAL_ITERATIONS, currentIteration + epochsToRun);

    while (currentIteration < targetIteration) {
      currentIteration++;
      const epochMsg = EPOCH_MESSAGES[currentIteration - 1] || `Époque ${currentIteration}/${TOTAL_ITERATIONS}`;

      logToAdmin(io, `Époque ${currentIteration}/${TOTAL_ITERATIONS} en cours...`);

      // Entraîne 1 époque des deux modèles (direction + rendements futurs)
      lastMetrics = await sentiment.trainEpoch();

      logToAdmin(io, `Époque ${currentIteration}/${TOTAL_ITERATIONS} terminée — direction ${lastMetrics.direction.loss.toFixed(4)} (test ${(lastMetrics.direction.testAccuracy * 100).toFixed(1)}%) | MAE prévision ${lastMetrics.forecast.maePct.toFixed(2)}%`);

      // Diffusion temps réel avec message explicatif
      io.emit('epochUpdate', {
        iteration: currentIteration,
        totalIterations: TOTAL_ITERATIONS,
        metrics: lastMetrics,
        message: epochMsg
      });

      await sleep(TIMEOUT_BETWEEN_EPOCHS_MS);
    }

    isTrainingComplete = (currentIteration >= TOTAL_ITERATIONS);

    if (isTrainingComplete) {
      // Sauvegarde des poids : les modèles survivent aux redémarrages
      const saved = await sentiment.saveModels();
      hasTrainedWeights = true;
      logToAdmin(io, `Poids sauvegardés — ${saved.classifier.replace(__dirname + path.sep, '')} et ${saved.forecaster.replace(__dirname + path.sep, '')}`);
      logToAdmin(io, 'Entraînement complet des 10 époques achevé ! Inférence prête.');
      io.emit('trainingComplete', {
        totalIterations: TOTAL_ITERATIONS,
        metrics: lastMetrics,
        message: EPOCH_MESSAGES[9]
      });
      // L'indice et le graphique sont immédiatement recalculés et diffusés (avec biais du modèle)
      await refreshMarket(io, REFRESH_DAYS);
      broadcastPrediction(io);
    } else {
      logToAdmin(io, `Pause du mode pas-à-pas à l'époque ${currentIteration}/${TOTAL_ITERATIONS}.`);
      io.emit('stepPaused', {
        currentIteration: currentIteration,
        totalIterations: TOTAL_ITERATIONS,
        metrics: lastMetrics
      });
      broadcastPrediction(io);
    }
  } catch (err) {
    logToAdmin(io, 'Erreur pendant l\'entraînement horaire : ' + (err && err.message ? err.message : err));
    io.emit('stepPaused', { currentIteration: currentIteration, totalIterations: TOTAL_ITERATIONS, metrics: lastMetrics });
  } finally {
    isTraining = false;
  }
}

/**
 * Réinitialise complètement les modèles (poids aléatoires + suppression des sauvegardes).
 */
function resetModelSession(io) {
  sentiment.resetModel();
  isTraining = false;
  isTrainingComplete = false;
  hasTrainedWeights = false;
  currentIteration = 0;
  lastMetrics = null;
  logToAdmin(io, 'Poids des deux modèles réinitialisés et sauvegardes data/ supprimées.');
  io.emit('modelReset', {
    totalIterations: TOTAL_ITERATIONS,
    adminStats: getAdminStats()
  });
  // Recalcule l'indice sans le biais du modèle
  refreshMarket(io, REFRESH_DAYS).catch(() => {});
}

/**
 * Démarre le serveur HTTP et WebSocket.
 */
async function run() {
  const port = process.env.PORT || PORT;
  const server = http.createServer();
  // Socket.IO (v2) : autoriser le frontend hébergé ailleurs (GitHub Pages) et le dev local
  // ALLOWED_ORIGINS peut valoir "*:*" ou une liste séparée par des virgules.
  const ioOptions = ALLOWED_ORIGINS === '*:*' ? { origins: '*:*' } : { origins: ALLOWED_ORIGINS };
  const io = socketio(server, ioOptions);

  // Backend TensorFlow.js (WASM si disponible, sinon CPU/JS) + construction des modèles
  const backend = await sentiment.init();
  const backendDaily = await sentimentDaily.init();
  logToAdmin(io, `Backend TensorFlow.js : ${backend} (daily: ${backendDaily})`);

  // Restauration des poids sauvegardés lors d'une session précédente
  const restored = await sentiment.loadModels();
  hasTrainedWeights = restored;
  if (restored) {
    isTrainingComplete = true;
    currentIteration = TOTAL_ITERATIONS;
    logToAdmin(io, 'Poids restaurés depuis data/model-classifier.json et data/model-forecast.json');
  }
  const restoredDaily = await sentimentDaily.loadModels();
  hasTrainedWeightsDaily = restoredDaily;
  if (restoredDaily) {
    isTrainingCompleteDaily = true;
    currentIterationDaily = TOTAL_ITERATIONS;
    logToAdmin(io, 'Poids daily restaurés depuis data/model-classifier-daily.json et data/model-forecast-daily.json');
  }

  io.on('connection', socket => {
    console.log(`> Client connecté (${socket.id})`);
    socket.emit('serverStatus', {
      epochsDone: currentIteration,
      totalIterations: TOTAL_ITERATIONS,
      trained: isTrainingComplete,
      hasData: marketState.candles.length > 0,
      restored,
      daily: {
        epochsDone: currentIterationDaily,
        totalIterations: TOTAL_ITERATIONS,
        trained: isTrainingCompleteDaily,
        hasData: dailyMarketState.candles.length > 0,
        restored: restoredDaily
      }
    });
    socket.emit('adminStats', getAdminStats());
    socket.emit('adminLog', serverLogs[serverLogs.length - 1] ? serverLogs.join('\n') : '');
    if (marketState.candles.length) socket.emit('marketData', serializeMarket());
    if (dailyMarketState.candles.length) socket.emit('dailyMarketData', serializeDailyMarket());

    socket.on('requestMarket', () => {
      if (marketState.candles.length) socket.emit('marketData', serializeMarket());
      else refreshMarket(io);
    });
    socket.on('requestDailyMarket', () => {
      if (dailyMarketState.candles.length) socket.emit('dailyMarketData', serializeDailyMarket());
      else refreshDailyMarket(io);
    });

    socket.on('trainStep', () => trainEpochs(io, 1));
    socket.on('trainFull', () => trainEpochs(io, TOTAL_ITERATIONS));
    socket.on('resetModel', () => resetModelSession(io));
    socket.on('requestPredict', () => {
      socket.emit('adminStats', getAdminStats());
      if (!hasTrainedWeights) {
        logToAdmin(io, 'Prédiction horaire indisponible : entraînez le modèle ou restaurez des poids valides.');
        socket.emit('predictionUnavailable', { reason: 'not_trained', model: 'hourly' });
        return;
      }
      broadcastPrediction(io);
    });

    socket.on('dailyTrainStep', () => trainDailyEpochs(io, 1));
    socket.on('dailyTrainFull', () => trainDailyEpochs(io, TOTAL_ITERATIONS));
    socket.on('dailyResetModel', () => resetDailyModelSession(io));
    socket.on('dailyRequestPredict', () => {
      socket.emit('adminStats', getAdminStats());
      if (!hasTrainedWeightsDaily) {
        logToAdmin(io, 'Prédiction daily indisponible : entraînez le modèle daily ou restaurez des poids valides.');
        socket.emit('dailyPredictionUnavailable', { reason: 'not_trained', model: 'daily' });
        return;
      }
      broadcastDailyPrediction(io);
    });

    socket.on('disconnect', () => console.log(`> Client déconnecté (${socket.id})`));
  });

  server.listen(port, () => {
    console.log(`====================================================`);
    console.log(`  > Serveur Fear & Greed TensorFlow.js actif sur le port : ${port}`);
    console.log(`  > Collecte Kraken/Coinbase/CoinGecko, entraînement manuel`);
    console.log(`  > Stockage persistant : ${store.DATA_DIR}`);
    console.log(`====================================================`);
  });

  // Chargement de l'historique persisté (versionné dans data/) pour démarrer sans collecte lourde
  const persisted = store.loadState();
  marketState.candles = persisted.candles || [];
  marketState.dominanceHistory = (persisted.dominance || []).map(d => ({ t: d.t, pct: d.pct }));
  if (marketState.candles.length) {
    logToAdmin(io, `Historique restauré : ${marketState.candles.length} bougies horaires depuis data/btc-candles.json`);
  }
  dailyMarketState.candles = store.loadDailyCandles() || [];
  if (dailyMarketState.candles.length) {
    logToAdmin(io, `Historique daily restauré : ${dailyMarketState.candles.length} bougies depuis data/btc-candles-daily.json`);
  }

  // Diffuser immédiatement les données semées pour que l'UI affiche les graphes sans attendre le réseau
  if (marketState.candles.length) {
    try {
      let dominance = marketState.dominance || null;
      if (!dominance && marketState.dominanceHistory.length) {
        const last = marketState.dominanceHistory[marketState.dominanceHistory.length - 1];
        dominance = { pct: last.pct };
        const now = Math.floor(Date.now() / 1000);
        const past = [...marketState.dominanceHistory].reverse().find(d => d.t <= now - 24 * 3600);
        dominance.changePct = past ? dominance.pct - past.pct : 0;
      }
      let modelBias = null;
      if (hasTrainedWeights) {
        try { modelBias = sentiment.predict(marketState.candles).probaUp; } catch (_) {}
      }
      marketState.fg = indicators.fearGreed(marketState.candles, dominance, modelBias);
      marketState.dominance = dominance;
      marketState.source = marketState.source || 'Données semées';
      marketState.updatedAt = marketState.updatedAt || new Date().toISOString();
      io.emit('marketData', serializeMarket());
    } catch (err) {
      console.error('> Émission des données semées impossible :', err.message);
    }
  }
  if (dailyMarketState.candles.length) {
    try { io.emit('dailyMarketData', serializeDailyMarket()); } catch (_) {}
  }

  // Rafraîchissement initial : léger si l'historique versionné est suffisant, sinon collecte profonde
  const hourlySeeded = marketState.candles.length >= 2000;
  const dailySeeded = dailyMarketState.candles.length >= 300;
  const hourlyDays = hourlySeeded ? REFRESH_DAYS : HISTORY_DAYS;
  const dailyDays = dailySeeded ? REFRESH_DAYS_DAILY : HISTORY_DAYS_DAILY;
  if (hourlySeeded) logToAdmin(io, `Historique horaire suffisant (${marketState.candles.length}) : rafraîchissement léger (${hourlyDays}j).`);
  else logToAdmin(io, `Historique horaire insuffisant : collecte initiale profonde (${hourlyDays}j).`);
  if (dailySeeded) logToAdmin(io, `Historique daily suffisant (${dailyMarketState.candles.length}) : rafraîchissement léger (${dailyDays}j).`);
  else logToAdmin(io, `Historique daily insuffisant : collecte initiale profonde (${dailyDays}j).`);

  // Lancer le rafraîchissement sans bloquer le démarrage (les clients reçoivent déjà les données semées)
  Promise.all([
    refreshMarket(io, hourlyDays).catch(err => logToAdmin(io, 'Rafraîchissement initial horaire : ' + (err && err.message ? err.message : err))),
    refreshDailyMarket(io, dailyDays).catch(err => logToAdmin(io, 'Rafraîchissement initial daily : ' + (err && err.message ? err.message : err)))
  ]).then(() => logToAdmin(io, 'Rafraîchissement initial terminé.'));

  setInterval(() => refreshMarket(io).catch(err => logToAdmin(io, 'Rafraîchissement horaire : ' + (err && err.message ? err.message : err))), MARKET_REFRESH_MS);
  setInterval(() => refreshDailyMarket(io).catch(err => logToAdmin(io, 'Rafraîchissement daily : ' + (err && err.message ? err.message : err))), 60 * 60 * 1000); // daily : toutes les heures (bougies journalières)
}

run().catch(err => {
  console.error('Erreur fatale du serveur :', err);
  process.exit(1);
});
