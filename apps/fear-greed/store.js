/**
 * @file store.js
 * @description Persistance locale du laboratoire dans le dossier `data/` (JSON, aucun service externe).
 *
 * Fichiers :
 * - data/btc-candles.json    : historique de bougies horaires BTC/USD (fusionné à chaque rafraîchissement,
 *                              l'historique s'accumule au fil des sessions même au-delà des 720 bougies Kraken).
 * - data/dominance.json      : historique de la dominance BTC (timestamp + % du marché crypto).
 * - data/model-classifier.json : poids du LSTM de direction, sauvegardés après l'entraînement.
 * - data/model-forecast.json   : poids du LSTM de prévision de prix.
 *
 * Les modèles sont écrits via un handler de sauvegarde TensorFlow.js personnalisé
 * (compatible backend pur JS, sans @tensorflow/tfjs-node).
 */

const fs = require('fs');
const path = require('path');
const tf = require('@tensorflow/tfjs');

/** Dossier de stockage : data/ à la racine du projet. */
const DATA_DIR = path.join(__dirname, 'data');

/** Nombre maximal de bougies conservées (≈ 800 jours d'historique horaire). */
const MAX_CANDLES = 20000;

/**
 * Fusionne un historique existant avec de nouvelles bougies, sans doublon (clé = timestamp),
 * en privilégiant les valeurs les plus récentes, puis trie chronologiquement.
 *
 * @param {Array<{t:number}>} existing - Historique déjà stocké (peut être vide).
 * @param {Array<{t:number}>} incoming - Bougies fraîchement récupérées.
 * @param {number} [max=MAX_CANDLES] - Taille maximale conservée.
 * @returns {Array} Historique fusionné et borné.
 */
function mergeCandles(existing, incoming, max = MAX_CANDLES) {
  const byT = new Map();
  for (const c of existing || []) byT.set(c.t, c);
  for (const c of incoming || []) byT.set(c.t, c);
  const merged = [...byT.values()].sort((a, b) => a.t - b.t);
  return merged.length > max ? merged.slice(merged.length - max) : merged;
}

/**
 * Charge l'état persisté au démarrage du serveur (fichiers manquants tolérés).
 *
 * @returns {{candles:Array, dominance:Array}} Historiques stockés (vides si absents).
 */
function loadState() {
  const empty = { candles: [], dominance: [] };
  try {
    if (fs.existsSync(path.join(DATA_DIR, 'btc-candles.json'))) {
      empty.candles = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'btc-candles.json'), 'utf8'));
    }
    if (fs.existsSync(path.join(DATA_DIR, 'dominance.json'))) {
      empty.dominance = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'dominance.json'), 'utf8'));
    }
  } catch (err) {
    console.error('> Lecture de data/ impossible, démarrage à vide :', err.message);
  }
  return empty;
}

/** Fichiers de bougies. */
const CANDLES_FILE = path.join(DATA_DIR, 'btc-candles.json');
const CANDLES_DAILY_FILE = path.join(DATA_DIR, 'btc-candles-daily.json');

/**
 * Écrit l'historique de bougies horaires sur disque (écriture atomique via fichier temporaire).
 */
function saveCandles(candles) {
  const tmp = CANDLES_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(candles));
  fs.renameSync(tmp, CANDLES_FILE);
}

/**
 * Charge les bougies journalières persistées (fichier manquant toléré).
 */
function loadDailyCandles() {
  try {
    if (fs.existsSync(CANDLES_DAILY_FILE)) {
      return JSON.parse(fs.readFileSync(CANDLES_DAILY_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('> Lecture de btc-candles-daily.json impossible :', err.message);
  }
  return [];
}

/** Écrit l'historique de bougies journalières. */
function saveDailyCandles(candles) {
  const tmp = CANDLES_DAILY_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(candles));
  fs.renameSync(tmp, CANDLES_DAILY_FILE);
}

/**
 * Écrit l'historique de dominance sur disque.
 *
 * @param {Array<{t:number,pct:number}>} dominance - Historique de dominance.
 */
function saveDominance(dominance) {
  const target = path.join(DATA_DIR, 'dominance.json');
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(dominance));
  fs.renameSync(tmp, target);
}

/**
 * Handler de sauvegarde TensorFlow.js : sérialise le modèle dans un unique fichier JSON
 * (topologie + poids encodés en base64), sans dépendre de @tensorflow/tfjs-node.
 *
 * @param {string} filePath - Chemin complet du fichier .json cible.
 * @returns {tf.io.SaveHandler} Handler pour `model.save()`.
 */
function tfSaveHandler(filePath) {
  return tf.io.withSaveHandler(async artifacts => {
    const payload = {
      format: artifacts.format,
      generatedBy: artifacts.generatedBy,
      convertedBy: artifacts.convertedBy,
      modelTopology: artifacts.modelTopology,
      weightSpecs: artifacts.weightSpecs,
      weightData: Buffer.from(artifacts.weightData).toString('base64')
    };
    fs.writeFileSync(filePath, JSON.stringify(payload));
    return { modelArtifactsInfo: { dateSaved: new Date(), modelSizes: [fs.statSync(filePath).size] } };
  });
}

/**
 * Charge un modèle TensorFlow.js depuis un fichier JSON écrit par `tfSaveHandler`.
 *
 * @param {string} filePath - Chemin complet du fichier .json.
 * @returns {Promise<tf.LayersModel|null>} Modèle restauré, ou null si absent/corrompu.
 */
async function tfLoadModel(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const weightData = Buffer.from(payload.weightData, 'base64');
  return tf.loadLayersModel(tf.io.fromMemory({
    modelTopology: payload.modelTopology,
    weightSpecs: payload.weightSpecs,
    weightData: weightData.buffer.slice(weightData.byteOffset, weightData.byteOffset + weightData.byteLength)
  }));
}

module.exports = { DATA_DIR, MAX_CANDLES, mergeCandles, loadState, saveCandles, loadDailyCandles, saveDailyCandles, saveDominance, tfSaveHandler, tfLoadModel };
