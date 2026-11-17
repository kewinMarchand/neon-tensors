/**
 * @file sentiment-daily.js
 * @description Modèles TensorFlow.js pour la prédiction BTC/USD en bougies JOURNALIÈRES (en parallèle de l'horaire).
 *
 * 1. `classifier` — fenêtre de 30 jours -> P(prochain jour en hausse), sigmoïde.
 * 2. `forecaster` — fenêtre de 30 jours -> rendements à +1 j, +4 j, +7 j, +30 j (4 sorties).
 *    Rollout itératif (+1 j) pour un chemin de 30 bougies journalières futures.
 *
 * Concepts TensorFlow.js illustrés :
 * 1. Séries temporelles : fenêtres glissantes (sliding windows) sur des bougies horaires.
 * 2. Normalisation des caractéristiques et des cibles dans des intervalles bornés.
 * 3. Architectures récurrentes : `tf.layers.lstm` pour mémoriser la dynamique du marché.
 * 4. Compilation : Adam, Binary Crossentropy (direction) et MSE (rendements).
 * 5. Entraînement / évaluation / inférence : `fit()`, `predict()`, `dataSync()`, `dispose()`.
 * 6. Sauvegarde et rechargement des poids : handler de sérialisation JSON personnalisé.
 */

const fs = require('fs');
const path = require('path');
const tf = require('@tensorflow/tfjs');
const store = require('./store');
const { rsi, map01, mapRange } = require('./indicators');

/**
 * Initialise le backend TensorFlow.js. Tente WASM (plus rapide que le JS pur, sans compilation native),
 * sinon retombe sur le backend CPU par défaut. Doit être appelé (et awaité) avant toute utilisation des modèles.
 *
 * @returns {Promise<string>} Nom du backend actif.
 */
async function init() {
  try {
    const tfwasm = require('@tensorflow/tfjs-backend-wasm');
    // Répertoire dist contenant les binaires .wasm (résolu depuis node_modules, compatible Windows)
    const wasmDist = path.dirname(require.resolve('@tensorflow/tfjs-backend-wasm'));
    tfwasm.setWasmPaths(wasmDist + path.sep);
    await tf.setBackend('wasm');
    await tf.ready();
  } catch (err) {
    // WASM indisponible : backend JS/CPU par défaut
    try { await tf.setBackend('cpu'); await tf.ready(); } catch (e) { /* garde le backend courant */ }
  }
  if (!classifier) classifier = buildClassifier();
  if (!forecaster) forecaster = buildForecaster();
  return tf.getBackend();
}

/** Longueur de la fenêtre glissante : 30 bougies journalières. */
const WINDOW = 30;

/** Nombre de caractéristiques par bougie :
 *  [rendement, volume relatif, RSI, position EMA, momentum 24 j, amplitude OHLC]. */
const FEATURES = 6;

/** Horizons de prévision directe (en jours) : +1 j, +4 j, +7 j, +30 j. */
const HORIZONS = [1, 4, 7, 30];

/** Profondeur du chemin de bougies futures produit par rollout (jours). */
const FORECAST_DEPTH = 30;

/** Durée d'une bougie (secondes). */
const CANDLE_SECONDS = 86400;

/** Profondeur du backtest rétrospectif (jours). */
const BACKTEST_DEPTH = 30;

/** Bornes de normalisation des rendements cibles (-15% .. +15% mappé sur [-1, 1]). */
const RET_MIN = -0.15;
const RET_MAX = 0.15;

/** Fraction du jeu de données réservée à l'évaluation (dernière part chronologique). */
const TEST_FRACTION = 0.2;

/** Fichiers de sauvegarde des poids daily dans data/. */
const CLASSIFIER_PATH = path.join(store.DATA_DIR, 'model-classifier-daily.json');
const FORECASTER_PATH = path.join(store.DATA_DIR, 'model-forecast-daily.json');

/**
 * Construit l'architecture du classifieur de direction.
 * LSTM(24) -> Dropout(0.15) -> Dense(12, ReLU) -> Dense(1, Sigmoïde)
 *
 * @returns {tf.Sequential} Modèle compilé (Adam, Binary Crossentropy).
 */
function buildClassifier() {
  const model = tf.sequential();
  model.add(tf.layers.lstm({ units: 24, inputShape: [WINDOW, FEATURES], returnSequences: false }));
  model.add(tf.layers.dropout({ rate: 0.15 }));
  model.add(tf.layers.dense({ units: 12, activation: 'relu' }));
  model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));
  model.compile({ optimizer: tf.train.adam(0.001), loss: 'binaryCrossentropy', metrics: ['accuracy'] });
  return model;
}

/**
 * Construit l'architecture du prévisionniste de rendements.
 * LSTM(24) -> Dropout(0.15) -> Dense(16, ReLU) -> Dense(4, Linéaire : +1 h, +4 h, +12 h, +7 jours)
 *
 * @returns {tf.Sequential} Modèle compilé (Adam, MSE).
 */
function buildForecaster() {
  const model = tf.sequential();
  model.add(tf.layers.lstm({ units: 24, inputShape: [WINDOW, FEATURES], returnSequences: false }));
  model.add(tf.layers.dropout({ rate: 0.15 }));
  model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
  model.add(tf.layers.dense({ units: HORIZONS.length, activation: 'linear' }));
  model.compile({ optimizer: tf.train.adam(0.001), loss: 'meanSquaredError' });
  return model;
}

// État des modèles partagés (construits dans init() après choix du backend)
let classifier = null;
let forecaster = null;
let classifierData = null;
let forecasterData = null;

/**
 * Calcule une série d'EMA incrémentale (même formule que indicators.ema, mais
 * valeur par valeur) : indispensable pour précalculer EMA20/EMA50 en une passe.
 *
 * @param {number[]} values - Série chronologique.
 * @param {number} period - Période de lissage (graine = moyenne mobile simple).
 * @returns {number[]} EMA à chaque index (clôture brute tant que la graine n'est pas posée).
 */
function emaSeries(values, period) {
  const k = 2 / (period + 1);
  const out = new Array(values.length);
  let seed = 0;
  let acc = null;
  for (let i = 0; i < values.length; i++) {
    if (acc === null) {
      seed += values[i];
      if (i === period - 1) { acc = seed / period; out[i] = acc; }
      else out[i] = values[i];
    } else {
      acc = values[i] * k + acc * (1 - k);
      out[i] = acc;
    }
  }
  return out;
}

/**
 * Construit les caractéristiques (features) normalisées de chaque bougie — 6 par bougie :
 *
 * - `ret`   : rendement horaire (c[i] / c[i-1] - 1), mappé de -3% à +3% sur [0, 1] ;
 * - `volRel`: volume divisé par la moyenne des 24 précédents, mappé de 0.5x à 2x ;
 * - `rsiN`  : RSI(14) divisé par 100 ;
 * - `emaRel`: position du prix par rapport à l'EMA50 (±5% mappé sur [0, 1]) ;
 * - `mom24` : momentum 24 h (c[i] / c[i-24] - 1), ±10% mappé sur [0, 1] ;
 * - `range` : amplitude de la bougie (h - l) / o, mappé de 0 à 5%.
 *
 * Les séries EMA20/EMA50 et le contexte RSI sont précalculés : la boucle reste O(n).
 *
 * @param {Array<{o:number,h:number,l:number,c:number,v:number}>} candles - Bougies chronologiques.
 * @returns {Array<number[]>} Une ligne de 6 features normalisées par bougie exploitable.
 */
function buildFeatures(candles) {
  const closes = candles.map(c => c.c);
  const ema50 = emaSeries(closes, 50);
  const features = [];
  for (let i = 1; i < candles.length; i++) {
    const ret = (candles[i].c - candles[i - 1].c) / candles[i - 1].c;
    const avgVol = candles.slice(Math.max(0, i - 24), i).reduce((a, b) => a + b.v, 0) / Math.min(24, i);
    const volRel = candles[i].v / (avgVol || 1);
    const rsiN = rsi(closes.slice(Math.max(0, i - 15), i + 1), 14) / 100;
    const emaRel = candles[i].c / (ema50[i] || candles[i].c) - 1;
    const mom24 = i >= 24 ? candles[i].c / candles[i - 24].c - 1 : 0;
    const range = (candles[i].h - candles[i].l) / candles[i].o;
    features.push([
      map01(ret, -0.03, 0.03),
      map01(volRel, 0.5, 2),
      rsiN,
      map01(emaRel, -0.05, 0.05),
      map01(mom24, -0.10, 0.10),
      map01(range, 0, 0.05)
    ]);
  }
  return features;
}

/**
 * Découpe chronologiquement des tenseurs en jeu d'entraînement (80%) et de test (20%).
 * La séparation est temporelle : on n'entraîne JAMAIS sur le futur pour évaluer le passé.
 */
function chronologicalSplit(xs, ys, count) {
  const cut = Math.floor(count * (1 - TEST_FRACTION));
  const shape = xs.shape.slice(1);
  return {
    train: {
      xs: xs.slice([0, 0, 0], [cut, ...shape]),
      ys: ys.slice([0, 0], [cut, ys.shape[1]])
    },
    test: {
      xs: xs.slice([cut, 0, 0], [count - cut, ...shape]),
      ys: ys.slice([cut, 0], [count - cut, ys.shape[1]])
    }
  };
}

/**
 * Prépare les tenseurs d'entraînement des deux modèles à partir des bougies.
 *
 * Classifieur : fenêtre de 12 h -> direction de la bougie suivante (1 = hausse).
 * Prévisionniste : fenêtre de 12 h -> rendements normalisés à +1 h, +4 h, +12 h.
 *
 * @param {Array} candles - Bougies chronologiques.
 * @returns {{classifier:number, forecaster:number, window:number, features:number}} Tailles des jeux.
 */
function prepareData(candles) {
  [classifierData, forecasterData].forEach(d => d && (d.xs.dispose(), d.ys.dispose()));
  classifierData = null;
  forecasterData = null;

  // --- Classifieur ---
  const features = buildFeatures(candles);
  const closes = candles.slice(1).map(c => c.c); // aligné sur `features` (décalage de 1 bougie)
  const xs = [];
  const ys = [];
  for (let i = WINDOW; i < features.length; i++) {
    xs.push(features.slice(i - WINDOW, i));
    ys.push(closes[i] > closes[i - 1] ? 1 : 0);
  }
  classifierData = {
    xs: tf.tensor3d(xs, [xs.length, WINDOW, FEATURES]),
    ys: tf.tensor2d(ys, [ys.length, 1])
  };

  // --- Prévisionniste (rendements à +1 h, +4 h, +12 h, bornés dans [-1, 1]) ---
  const fx = [];
  const fy = [];
  for (let i = WINDOW; i < features.length; i++) {
    const base = closes[i - 1];
    const targets = HORIZONS.map(h => {
      if (i - 1 + h >= closes.length) return null;
      return mapRange((closes[i - 1 + h] - base) / base, RET_MIN, RET_MAX, -1, 1);
    });
    if (targets.some(t => t === null)) break; // horizons incomplets en fin d'historique
    fx.push(features.slice(i - WINDOW, i));
    fy.push(targets);
  }
  forecasterData = {
    xs: tf.tensor3d(fx, [fx.length, WINDOW, FEATURES]),
    ys: tf.tensor2d(fy, [fy.length, HORIZONS.length])
  };

  return {
    classifier: classifierData.ys.shape[0],
    forecaster: forecasterData.ys.shape[0],
    window: WINDOW,
    features: FEATURES
  };
}

/**
 * Entraîne UNE époque des deux modèles et évalue sur le jeu de test chronologique.
 *
 * @returns {Promise<{direction:{loss:number, accuracy:number, testAccuracy:number},
 *                     forecast:{loss:number, maePct:number}}>} Métriques de l'époque.
 */
async function trainEpoch() {
  if (!classifierData || !forecasterData) throw new Error('Dataset non préparé');
  if (!classifierData.ys.shape[0] || !forecasterData.ys.shape[0]) {
    throw new Error(`Dataset trop court : ${classifierData.ys.shape[0]} exemples direction, ${forecasterData.ys.shape[0]} exemples prévision (il faut au moins ${WINDOW + Math.max(...HORIZONS)} bougies journalières)`);
  }

  // --- Direction ---
  const cSplit = chronologicalSplit(classifierData.xs, classifierData.ys, classifierData.ys.shape[0]);
  const cHistory = await classifier.fit(cSplit.train.xs, cSplit.train.ys, {
    epochs: 1, batchSize: 32, shuffle: true, verbose: 0
  });
  const cEval = classifier.evaluate(cSplit.test.xs, cSplit.test.ys, { verbose: 0 });
  const direction = {
    loss: cHistory.history.loss[0],
    accuracy: (cHistory.history.acc || cHistory.history.accuracy)[0],
    testAccuracy: cEval[1].dataSync()[0]
  };
  cEval.forEach(t => t.dispose());
  cSplit.train.xs.dispose(); cSplit.train.ys.dispose();
  cSplit.test.xs.dispose(); cSplit.test.ys.dispose();

  // --- Rendements futurs ---
  const fSplit = chronologicalSplit(forecasterData.xs, forecasterData.ys, forecasterData.ys.shape[0]);
  const fHistory = await forecaster.fit(fSplit.train.xs, fSplit.train.ys, {
    epochs: 1, batchSize: 32, shuffle: true, verbose: 0
  });
  const fEval = forecaster.evaluate(fSplit.test.xs, fSplit.test.ys, { verbose: 0 });
  // evaluate() renvoie un Scalar (modèle sans métrique) ou un tableau : on normalise
  const fLoss = Array.isArray(fEval) ? fEval[0] : fEval;
  const forecast = { loss: fLoss.dataSync()[0], maePct: null };
  (Array.isArray(fEval) ? fEval : [fEval]).forEach(t => t.dispose());
  fSplit.train.xs.dispose(); fSplit.train.ys.dispose();
  fSplit.test.xs.dispose(); fSplit.test.ys.dispose();

  // MAE en points de % : les erreurs normalisées [-1, 1] sont reconverties en rendements réels
  const pred = forecaster.predict(forecasterData.xs);
  const diff = tf.sub(pred, forecasterData.ys).mul((RET_MAX - RET_MIN) / 2);
  forecast.maePct = diff.abs().mean().dataSync()[0] * 100;
  pred.dispose();
  diff.dispose();

  return { direction, forecast };
}

/**
 * Inférence : probabilité de hausse de la prochain jour.
 *
 * @param {Array} candles - Bougies chronologiques.
 * @returns {{probaUp:number}} Probabilité dans [0, 1].
 */
function predict(candles) {
  const features = buildFeatures(candles);
  const window = features.slice(features.length - WINDOW, features.length);
  const input = tf.tensor3d([window], [1, WINDOW, FEATURES]);
  const output = classifier.predict(input);
  const probaUp = output.dataSync()[0];
  input.dispose();
  output.dispose();
  return { probaUp };
}

/**
 * Prévision : chemin complet de bougies horaires futures par ROLLOUT.
 *
 * À chaque pas, le prévisionniste prédit les rendements à +1 h, +4 h et +12 h depuis la
 * fenêtre courante ; on applique le rendement +1 h pour construire la bougie suivante
 * (synthétique), que l'on réinjecte dans la fenêtre. Après `FORECAST_DEPTH` pas, on obtient
 * les prix à x+1 h, x+2 h, ... x+12 h, dont les horizons x, x+4 h et x+12 h demandés.
 *
 * @param {Array} candles - Bougies chronologiques.
 * @param {number} [depth=FORECAST_DEPTH] - Nombre de bougies futures simulées.
 * @returns {{lastPrice:number, lastT:number, steps:Array<{t:number,price:number,retPct:number}>}}
 */
function forecastPath(candles, depth = FORECAST_DEPTH) {
  const working = candles.slice(-Math.max(WINDOW * 6, 120)).map(c => ({ ...c }));
  const steps = [];
  const lastRealT = working[working.length - 1].t;

  for (let step = 1; step <= depth; step++) {
    const features = buildFeatures(working);
    const window = features.slice(features.length - WINDOW, features.length);
    const input = tf.tensor3d([window], [1, WINDOW, FEATURES]);
    const output = forecaster.predict(input);
    const outs = output.dataSync();
    input.dispose();
    output.dispose();

    // Dénormalisation du rendement +1 h puis application au prix de référence de la fenêtre
    const lastClose = working[working.length - 1].c;
    const ret = mapRange(outs[0], -1, 1, RET_MIN, RET_MAX);
    const price = lastClose * (1 + ret);

    steps.push({
      t: lastRealT + step * CANDLE_SECONDS,
      price,
      retPct: (price / candles[candles.length - 1].c - 1) * 100
    });

    // Bougie synthétique réinjectée (volume neutre = moyenne des 12 dernières périodes)
    const avgVol = working.slice(-12).reduce((a, b) => a + b.v, 0) / 12;
    working.push({ t: lastRealT + step * CANDLE_SECONDS, o: lastClose, h: price, l: price, c: price, v: avgVol });
  }

  return { lastPrice: candles[candles.length - 1].c, lastT: lastRealT, steps };
}

/**
 * Prévision RÉTROSPECTIVE : rejoue la prévision comme si elle avait été lancée
 * il y a `depth` bougies, pour comparer graphiquement avec ce qui s'est réellement passé.
 * Par défaut 30 bougies (30 j).
 *
 * @param {Array} candles - Bougies chronologiques.
 * @param {number} [depth=BACKTEST_DEPTH] - Nombre de bougies passées à rejouer.
 * @returns {{steps:Array<{t:number,price:number,retPct:number}>, actual:Array<{t:number,price:number}>}|null}
 *   Chemin prédit à l'époque + valeurs réelles correspondantes ; null si trop peu de données.
 */
function backtest(candles, depth = BACKTEST_DEPTH) {
  if (!candles || candles.length < depth + WINDOW + 2) return null;
  const past = candles.slice(0, candles.length - depth);
  const path = forecastPath(past, depth);
  const actual = candles.slice(-depth).map(c => ({ t: c.t, price: c.c }));
  return { steps: path.steps, actual };
}

/**
 * Prévision DIRECTE à +30 jours : rendement de l'horizon maximal (sortie 4)
 * depuis les 30 derniers jours — sans rollout, donc sans accumulation d'erreur.
 *
 * @param {Array} candles - Bougies chronologiques.
 * @returns {{price:number, retPct:number}|null} Prix prédit dans une semaine et variation associée.
 */
function weeklyForecast(candles) {
  const features = buildFeatures(candles);
  const window = features.slice(features.length - WINDOW, features.length);
  const input = tf.tensor3d([window], [1, WINDOW, FEATURES]);
  const output = forecaster.predict(input);
  const outs = output.dataSync();
  input.dispose();
  output.dispose();
  const lastPrice = candles[candles.length - 1].c;
  const ret = mapRange(outs[HORIZONS.indexOf(30)], -1, 1, RET_MIN, RET_MAX);
  return { price: lastPrice * (1 + ret), retPct: ret * 100 };
}

/** Libellé de sentiment court terme associé à une probabilité de hausse. */
function sentimentLabel(probaUp) {
  if (probaUp < 0.35) return { label: 'Biais baissier', color: '#ff72bb' };
  if (probaUp < 0.5) return { label: 'Légèrement baissier', color: '#ff9d5c' };
  if (probaUp < 0.65) return { label: 'Neutre', color: '#ffd166' };
  if (probaUp < 0.8) return { label: 'Légèrement haussier', color: '#a2ff8f' };
  return { label: 'Biais haussier', color: '#BADA55' };
}

/**
 * Sauvegarde les poids des deux modèles dans data/ (JSON, handler personnalisé).
 *
 * @returns {Promise<{classifier:string, forecaster:string}>} Chemins écrits.
 */
async function saveModels() {
  fs.mkdirSync(store.DATA_DIR, { recursive: true });
  await classifier.save(store.tfSaveHandler(CLASSIFIER_PATH));
  await forecaster.save(store.tfSaveHandler(FORECASTER_PATH));
  return { classifier: CLASSIFIER_PATH, forecaster: FORECASTER_PATH };
}

/**
 * Vérifie qu'un modèle chargé est compatible avec la fenêtre ET le nombre de features courants.
 * Un modèle sauvegardé avant un changement d'architecture (ex: fenêtre 12 h → 24 h,
 * ou 3 features → 6) produit des tenseurs de formes incompatibles : il est écarté et supprimé.
 *
 * @param {tf.LayersModel|null} model - Modèle restauré (ou null).
 * @param {string} filePath - Chemin du fichier de poids correspondant.
 * @returns {tf.LayersModel|null} Modèle compatible, ou null.
 */
function checkWindowCompatibility(model, filePath) {
  if (!model) return null;
  const savedWindow = model.inputs[0].shape[1];
  const savedFeatures = model.inputs[0].shape[2];
  if (savedWindow === WINDOW && savedFeatures === FEATURES) return model;
  console.warn(`> Poids ignorés (${filePath}) : sauvegardés avec une entrée [${savedWindow} h, ${savedFeatures} features], incompatible avec [${WINDOW} j, ${FEATURES} features].`);
  try { fs.unlinkSync(filePath); } catch (err) { /* rien à faire */ }
  model.dispose();
  return null;
}

/**
 * Recharge les poids sauvegardés au démarrage (aucun effet si les fichiers sont absents).
 * Les couches reconstruites par `loadLayersModel` sont recompilées pour pouvoir ré-entraîner.
 *
 * @returns {Promise<boolean>} true si les deux modèles ont été restaurés.
 */
async function loadModels() {
  const c = checkWindowCompatibility(await store.tfLoadModel(CLASSIFIER_PATH), CLASSIFIER_PATH);
  const f = checkWindowCompatibility(await store.tfLoadModel(FORECASTER_PATH), FORECASTER_PATH);
  if (c) { c.compile({ optimizer: tf.train.adam(0.001), loss: 'binaryCrossentropy', metrics: ['accuracy'] }); classifier.dispose(); classifier = c; }
  if (f) { f.compile({ optimizer: tf.train.adam(0.001), loss: 'meanSquaredError' }); forecaster.dispose(); forecaster = f; }
  return Boolean(c && f);
}

/** Supprime les fichiers de poids (utilisé quand le modèle est réinitialisé). */
function deleteSavedModels() {
  [CLASSIFIER_PATH, FORECASTER_PATH].forEach(p => {
    try { fs.unlinkSync(p); } catch (err) { /* fichiers absents : rien à faire */ }
  });
}

/**
 * Reconstruit deux modèles vierges (poids aléatoires), purge la mémoire et supprime les sauvegardes.
 */
function resetModel() {
  classifier.dispose();
  forecaster.dispose();
  [classifierData, forecasterData].forEach(d => d && (d.xs.dispose(), d.ys.dispose()));
  classifierData = null;
  forecasterData = null;
  classifier = buildClassifier();
  forecaster = buildForecaster();
  deleteSavedModels();
}

/**
 * Statistiques pour la console d'administration.
 */
function stats() {
  return {
    totalParams: classifier.countParams() + forecaster.countParams(),
    classifierParams: classifier.countParams(),
    forecasterParams: forecaster.countParams(),
    window: WINDOW,
    features: FEATURES,
    horizons: HORIZONS,
    forecastDepth: FORECAST_DEPTH,
    hasData: classifierData !== null,
    layers: [
      { name: 'lstm_1 (Séquence)', units: 24, activation: 'tanh', role: 'Mémoire de la dynamique du marché (fenêtre 30 j)' },
      { name: 'dropout_1', units: '-', activation: '-', role: 'Régularisation (15% abandonnés)' },
      { name: 'dense_1 (Cachée)', units: '12/16', activation: 'relu', role: 'Combinaisons non-linéaires' },
      { name: 'dense_2 (Sortie)', units: '1 / 4', activation: 'sigmoïde / linéaire', role: 'P(hausse) et rendements +1 j, +4 j, +7 j, +30 j' }
    ]
  };
}

module.exports = {
  WINDOW, FEATURES, HORIZONS, FORECAST_DEPTH, RET_MIN, RET_MAX,
  init,
  buildFeatures, buildClassifier, buildForecaster,
  prepareData, trainEpoch, predict, forecastPath, backtest, weeklyForecast,
  sentimentLabel, saveModels, loadModels, resetModel, stats,
  get classifier() { return classifier; },
  get forecaster() { return forecaster; }
};
