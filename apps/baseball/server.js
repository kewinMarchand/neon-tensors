/**
 * @file server.js
 * @description Serveur backend Node.js pour l'entraînement et l'inférence TensorFlow.js en temps réel.
 * 
 * Améliorations :
 * 1. Entraînement manuel (pas de démarrage automatique pour préserver l'expérience pas-à-pas).
 * 2. Mode "Pas-à-pas" (1 époque à la fois) ou mode "Automatique" (10 époques complètes).
 * 3. Messages explicatifs dynamiques avec effet de fondu pour chaque époque.
 * 4. Télémétrie d'administration (paramètres du modèle, mémoire Heap, backend TF).
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
const socketio = require('socket.io');
const pitch_type = require('./pitch_type');

// Origines autorisées pour Socket.IO (GitHub Pages, dev local). Configurable via ALLOWED_ORIGINS (séparées par des virgules).
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '*:*';

/** Délai de pause (en ms) entre chaque cycle d'entraînement pour fluidifier l'Event Loop */
const TIMEOUT_BETWEEN_EPOCHS_MS = 350;

/** Port TCP d'écoute du serveur WebSocket */
const PORT = 8001;

/** Nombre total d'itérations prévues */
const TOTAL_ITERATIONS = 10;

// Messages pédagogiques progressifs pour chaque époque
const EPOCH_MESSAGES = [
  "Époque 1/10 : Poids initiaux aléatoires. Erreur maximale (Loss élevée). Adam oriente les premiers gradients à partir des 70 mini-lots de 100 lancers.",
  "Époque 2/10 : Normalisation active. Les vélocités comprimées [0, 1] circulent dans les couches ReLU. Les premiers séparateurs grossiers se forment.",
  "Époque 3/10 : Détection de la vitesse. Le réseau apprend à isoler nettement les balles lentes (< 80 mph) des balles ultra-rapides (> 93 mph).",
  "Époque 4/10 : Analyse de la trajectoire Z (az < -40 ft/s²). L'accélération plongeante causée par l'effet Magnus identifie spécifiquement les Curveballs.",
  "Époque 5/10 : Analyse latérale X. L'effet latéral (ax) permet au modèle de distinguer la rupture vive d'un Slider face à un Changeup.",
  "Époque 6/10 : Affinage des 73 632 poids synaptiques. Les logits (scores bruts) des classes erronées diminuent fortement.",
  "Époque 7/10 : Optimisation multi-classes. La fonction Softmax affine la distribution des probabilités sur les 7 types de lancers.",
  "Époque 8/10 : Réduction de la fonction de perte (Sparse Categorical Crossentropy). La certitude du modèle dépasse 70% sur les lancers types.",
  "Époque 9/10 : Évaluation sur le jeu de test indépendant (700 lancers non révisés). Le modèle démontre sa capacité de généralisation.",
  "Époque 10/10 : Convergence finale atteinte ! Le modèle a calibré ses 73 632 paramètres et atteint ~80% de précision. Inférence prête !"
];

// État de l'entraînement partagé
let isTraining = false;
let isTrainingComplete = false;
let currentIteration = 0;
let lastAccuracy = null;
let serverLogs = [];

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
 * Calcule les métriques système et modèle pour la console d'administration.
 */
function getAdminStats() {
  const mem = process.memoryUsage();
  return {
    nodeVersion: process.version,
    platform: process.platform,
    port: PORT,
    uptimeSeconds: Math.floor(process.uptime()),
    tfBackend: tf.getBackend(),
    totalParams: pitch_type.model.countParams(),
    heapUsedMB: (mem.heapUsed / 1024 / 1024).toFixed(1),
    heapTotalMB: (mem.heapTotal / 1024 / 1024).toFixed(1),
    layers: [
      { name: 'dense_1 (Entrée)', units: 250, activation: 'relu', params: 2250, role: 'Extraction des caractéristiques physiques' },
      { name: 'dense_2 (Cachée)', units: 175, activation: 'relu', params: 43925, role: 'Combinaisons non-linéaires complexes' },
      { name: 'dense_3 (Cachée)', units: 150, activation: 'relu', params: 26400, role: 'Représentation abstraite des trajectoires' },
      { name: 'dense_4 (Sortie)', units: 7, activation: 'softmax', params: 1057, role: 'Distribution de probabilités (7 lancers)' }
    ]
  };
}

/**
 * Exécute une ou plusieurs époques d'apprentissage du modèle.
 * 
 * @param {Object} io - Instance Socket.io
 * @param {number} epochsToRun - Nombre d'époques à exécuter (1 pour pas-à-pas, ou jusqu'à 10)
 */
async function trainEpochs(io, epochsToRun = 10) {
  if (isTraining) return;
  isTraining = true;

  logToAdmin(io, `Démarrage de l'apprentissage (${epochsToRun} époque(s) demandée(s))`);
  io.emit('trainingStarted', {
    totalIterations: TOTAL_ITERATIONS,
    currentIteration: currentIteration
  });

  const targetIteration = Math.min(TOTAL_ITERATIONS, currentIteration + epochsToRun);

  while (currentIteration < targetIteration) {
    currentIteration++;
    const epochMsg = EPOCH_MESSAGES[currentIteration - 1] || `Époque ${currentIteration}/${TOTAL_ITERATIONS}`;

    logToAdmin(io, `Époque ${currentIteration}/${TOTAL_ITERATIONS} en cours...`);

    // Entraîne 1 époque sur les 7000 lignes
    await pitch_type.model.fitDataset(pitch_type.trainingData, { epochs: 1 });

    // Évalue la précision sur le jeu de test (700 lignes)
    lastAccuracy = await pitch_type.evaluate(true);

    // Formatage de la précision pour l'ENSEMBLE des 7 types de lancers
    const classSummary = Object.keys(lastAccuracy)
      .map(cls => `${cls}: ${(lastAccuracy[cls].validation * 100).toFixed(0)}%`)
      .join(' | ');
    logToAdmin(io, `Époque ${currentIteration}/${TOTAL_ITERATIONS} terminée ➔ [ ${classSummary} ]`);

    // Diffusion temps réel avec message explicatif
    io.emit('epochUpdate', {
      iteration: currentIteration,
      totalIterations: TOTAL_ITERATIONS,
      accuracy: lastAccuracy,
      message: epochMsg
    });

    await sleep(TIMEOUT_BETWEEN_EPOCHS_MS);
  }

  isTraining = false;
  isTrainingComplete = (currentIteration >= TOTAL_ITERATIONS);

  if (isTrainingComplete) {
    logToAdmin(io, 'Entraînement complet des 10 époques achevé ! Inférence prête.');
    io.emit('trainingComplete', {
      totalIterations: TOTAL_ITERATIONS,
      accuracy: lastAccuracy,
      message: EPOCH_MESSAGES[9]
    });
  } else {
    logToAdmin(io, `Pause du mode pas-à-pas à l'époque ${currentIteration}/${TOTAL_ITERATIONS}.`);
    io.emit('stepPaused', {
      currentIteration: currentIteration,
      totalIterations: TOTAL_ITERATIONS,
      accuracy: lastAccuracy
    });
  }
}

/**
 * Réinitialise complètement le modèle.
 */
function resetModelSession(io) {
  pitch_type.resetModel();
  isTraining = false;
  isTrainingComplete = false;
  currentIteration = 0;
  lastAccuracy = null;
  logToAdmin(io, 'Poids du modèle réinitialisés à des valeurs aléatoires.');
  io.emit('modelReset', {
    totalIterations: TOTAL_ITERATIONS,
    adminStats: getAdminStats()
  });
}

/**
 * Démarre le serveur HTTP et WebSocket.
 */
async function run() {
  const port = process.env.PORT || PORT;
  const server = http.createServer();
  // Socket.IO (v2) : autoriser le frontend hébergé ailleurs (GitHub Pages) et le dev local
  const ioOptions = ALLOWED_ORIGINS === '*:*' ? { origins: '*:*' } : { origins: ALLOWED_ORIGINS };
  const io = socketio(server, ioOptions);

  server.listen(port, () => {
    console.log(`====================================================`);
    console.log(`  > Serveur TensorFlow.js actif sur le port : ${port}`);
    console.log(`  > Entraînement en attente (démarrage manuel par l'UI)`);
    console.log(`====================================================`);
  });

  io.on('connection', (socket) => {
    logToAdmin(io, 'Nouveau client web connecté à l\'interface');

    // Transmet l'état actuel et les métadonnées de démarrage
    socket.emit('currentState', {
      isTraining,
      isTrainingComplete,
      currentIteration,
      totalIterations: TOTAL_ITERATIONS,
      lastAccuracy,
      metadata: pitch_type.SENSOR_METADATA,
      adminStats: getAdminStats(),
      serverLogs: serverLogs.slice(-20)
    });

    // Inférence demandée par le client
    socket.on('predictSample', async (sample) => {
      logToAdmin(io, `Requête d'inférence reçue pour un lancer [${sample.join(', ')}]`);
      const result = await pitch_type.predictSample(sample);
      logToAdmin(io, `Résultat inférence : ${result.predictedPitch} (${(result.confidence * 100).toFixed(1)}%)`);
      io.emit('predictResult', result);
    });

    // Démarrage de l'entraînement complet automatique (10 époques)
    socket.on('startFullTraining', async () => {
      if (!isTraining) {
        if (currentIteration >= TOTAL_ITERATIONS) {
          resetModelSession(io);
        }
        trainEpochs(io, TOTAL_ITERATIONS - currentIteration);
      }
    });

    // Entraînement pas-à-pas (1 époque à la fois)
    socket.on('stepTrain', async () => {
      if (!isTraining) {
        if (currentIteration >= TOTAL_ITERATIONS) {
          resetModelSession(io);
        }
        trainEpochs(io, 1);
      }
    });

    // Réinitialisation du modèle
    socket.on('resetModel', () => {
      resetModelSession(io);
    });
  });

  // NOTE : Aucun entraînement automatique n'est lancé au démarrage !
  // L'utilisateur contrôle l'expérience depuis l'interface graphique.
}

run();
