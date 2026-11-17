/**
 * @file pitch_type.js
 * @description Module d'apprentissage automatique avec TensorFlow.js pour la classification des lancers de baseball.
 * 
 * Concepts clés de TensorFlow.js illustrés :
 * 1. Pipeline de données : Chargement en flux (streaming), transformation et batching avec `tf.data.csv`.
 * 2. Normalisation Min-Max : Mise à l'échelle des caractéristiques d'entrée (features).
 * 3. Architecture de Réseau de Neurones : Modèle séquentiel (`tf.sequential`) à couches denses (`tf.layers.dense`).
 * 4. Fonctions d'activation : ReLU pour les couches cachées et Softmax pour la classification multi-classes.
 * 5. Compilation : Optimiseur adaptatif (Adam) et fonction de perte (Sparse Categorical Crossentropy).
 * 6. Entraînement et Inférence : `fitDataset()`, `predict()`, extraction de tenseurs (`dataSync()`, `arraySync()`).
 */

const tf = require('@tensorflow/tfjs');

/**
 * Normalise une valeur numérique selon la formule Min-Max dans l'intervalle [0, 1].
 * 
 * En Machine Learning, la normalisation est indispensable :
 * Les réseaux de neurones apprennent par descente de gradient. Si une caractéristique varie
 * entre 50 et 100 (ex: vitesse en mph) et une autre entre -150 et -80 (ex: vélocité y),
 * les gradients seront déséquilibrés et l'apprentissage sera très instable ou lent.
 * Ramener toutes les entrées entre 0 et 1 garantit une convergence rapide et homogène des poids.
 * 
 * Formule : (valeur - min) / (max - min)
 * 
 * @param {number} value - La valeur brute issue du capteur.
 * @param {number} min - La valeur minimale observée dans le jeu d'entraînement.
 * @param {number} max - La valeur maximale observée dans le jeu d'entraînement.
 * @returns {number} La valeur normalisée (généralement entre 0 et 1).
 */
function normalize(value, min, max) {
  if (min === undefined || max === undefined) {
    return value;
  }
  return (value - min) / (max - min);
}

// Emplacements des fichiers de données distants (CSV)
// TensorFlow.js sait lire directement des fichiers distants via HTTP/HTTPS ou locaux.
const TRAIN_DATA_PATH =
    'https://storage.googleapis.com/mlb-pitch-data/pitch_type_training_data.csv';
const TEST_DATA_PATH =
    'https://storage.googleapis.com/mlb-pitch-data/pitch_type_test_data.csv';

// Constantes Min et Max observées sur le jeu de données pour chaque variable capteur :
// - vx0, vy0, vz0 : composantes de vitesse initiale de la balle sur les 3 axes
// - ax, ay, az : accélérations subies par la balle
// - start_speed : vitesse initiale au lâcher (en mph)
const VX0_MIN = -18.885;
const VX0_MAX = 18.065;
const VY0_MIN = -152.463;
const VY0_MAX = -86.374;
const VZ0_MIN = -15.5146078412997;
const VZ0_MAX = 9.974;
const AX_MIN = -48.0287647107959;
const AX_MAX = 30.592;
const AY_MIN = 9.397;
const AY_MAX = 49.18;
const AZ_MIN = -49.339;
const AZ_MAX = 2.95522851438373;
const START_SPEED_MIN = 59;
const START_SPEED_MAX = 104.4;

/** Nombre de types de lancers distincts à classifier (classes de sortie 0 à 6) */
const NUM_PITCH_CLASSES = 7;

/** Taille totale du jeu d'entraînement (lignes d'exemples) */
const TRAINING_DATA_LENGTH = 7000;

/** Taille totale du jeu de test/validation (lignes d'exemples non vues à l'entraînement) */
const TEST_DATA_LENGTH = 700;

/**
 * Fonction de transformation appliquée à chaque ligne lue depuis le fichier CSV.
 * 
 * Dans TensorFlow.js, une ligne est représentée sous la forme `{ xs, ys }` :
 * - `xs` : dictionnaire des caractéristiques (features) de la ligne.
 * - `ys` : dictionnaire contenant la cible à prédire (label), ici `pitch_code`.
 * 
 * Cette fonction extrait les 8 caractéristiques, normalise les 7 premières et conserve
 * l'indicateur binaire (lanceur gaucher = 0 ou 1), puis renvoie un tableau de nombres.
 * 
 * @param {{xs: Object, ys: {pitch_code: number}}} param0 - Ligne issue de l'itérateur CSV.
 * @returns {{xs: number[], ys: number}} Données prêtes pour alimenter les tenseurs.
 */
const csvTransform = ({xs, ys}) => {
  const values = [
    normalize(xs.vx0, VX0_MIN, VX0_MAX),
    normalize(xs.vy0, VY0_MIN, VY0_MAX),
    normalize(xs.vz0, VZ0_MIN, VZ0_MAX),
    normalize(xs.ax, AX_MIN, AX_MAX),
    normalize(xs.ay, AY_MIN, AY_MAX),
    normalize(xs.az, AZ_MIN, AZ_MAX),
    normalize(xs.start_speed, START_SPEED_MIN, START_SPEED_MAX),
    xs.left_handed_pitcher
  ];
  return {xs: values, ys: ys.pitch_code};
};

/**
 * Jeu de données d'entraînement (Dataset).
 * 
 * Architecture du pipeline TensorFlow.js tf.data :
 * 1. `tf.data.csv()` : Télécharge et lit le CSV de manière paresseuse (streaming), sans tout charger en RAM d'un coup.
 * 2. `{ columnConfigs: { pitch_code: { isLabel: true } } }` : Indique quelle colonne est la cible (y).
 * 3. `.map(csvTransform)` : Applique la normalisation à chaque ligne.
 * 4. `.shuffle(TRAINING_DATA_LENGTH)` : Mélange les données aléatoirement avec un tampon.
 *    Très important en ML pour éviter que le modèle mémorise l'ordre des exemples.
 * 5. `.batch(100)` : Découpe les 7000 lignes en paquets (batches) de 100 exemples.
 *    Le réseau ajustera ses poids toutes les 100 observations (Mini-batch Gradient Descent).
 */
const trainingData =
    tf.data.csv(TRAIN_DATA_PATH, {columnConfigs: {pitch_code: {isLabel: true}}})
        .map(csvTransform)
        .shuffle(TRAINING_DATA_LENGTH)
        .batch(100);

/**
 * Jeu d'entraînement complet chargé en un seul lot pour évaluer la précision globale.
 */
const trainingValidationData =
    tf.data.csv(TRAIN_DATA_PATH, {columnConfigs: {pitch_code: {isLabel: true}}})
        .map(csvTransform)
        .batch(TRAINING_DATA_LENGTH);

/**
 * Jeu de test complet chargé en un seul lot (700 exemples) pour mesurer la capacité de généralisation.
 */
const testValidationData =
    tf.data.csv(TEST_DATA_PATH, {columnConfigs: {pitch_code: {isLabel: true}}})
        .map(csvTransform)
        .batch(TEST_DATA_LENGTH);

// =========================================================================
// DÉFINITION DE L'ARCHITECTURE DU RÉSEAU DE NEURONES (Modèle séquentiel)
// =========================================================================

/**
 * Construit et compile le réseau de neurones séquentiel (73 632 paramètres).
 * 
 * Architecture :
 * 1. Couche Dense (250 neurones, inputShape [8], ReLU) -> 2 250 paramètres
 * 2. Couche Dense (175 neurones, ReLU) -> 43 925 paramètres
 * 3. Couche Dense (150 neurones, ReLU) -> 26 400 paramètres
 * 4. Couche Dense (7 neurones, Softmax) -> 1 057 paramètres
 * 
 * @returns {tf.Sequential} Modèle compilé prêt pour l'entraînement.
 */
function createModel() {
  const m = tf.sequential();
  m.add(tf.layers.dense({units: 250, activation: 'relu', inputShape: [8]}));
  m.add(tf.layers.dense({units: 175, activation: 'relu'}));
  m.add(tf.layers.dense({units: 150, activation: 'relu'}));
  m.add(tf.layers.dense({units: NUM_PITCH_CLASSES, activation: 'softmax'}));

  m.compile({
    optimizer: tf.train.adam(),
    loss: 'sparseCategoricalCrossentropy',
    metrics: ['accuracy']
  });

  return m;
}

let model = createModel();

/**
 * Réinitialise le modèle (nettoie les tenseurs GPU/WASM existants et réinstancie des poids aléatoires).
 * 
 * @returns {tf.Sequential} Nouveau modèle réinitialisé.
 */
function resetModel() {
  if (model) {
    model.dispose();
  }
  model = createModel();
  module.exports.model = model;
  return model;
}

// =========================================================================
// FONCTIONS D'ÉVALUATION ET DE PRÉDICTION (INFÉRENCE)
// =========================================================================

/**
 * Évalue la précision du modèle classe par classe sur les données d'entraînement
 * et optionnellement sur les données de validation (test).
 * 
 * @param {boolean} useTestData - Si true, calcule également la précision sur le jeu de test.
 * @returns {Promise<Object.<string, {training: number, validation?: number}>>}
 *          Un objet associant chaque type de lancer à ses pourcentages de précision.
 */
async function evaluate(useTestData) {
  let results = {};

  // Évaluation sur les données d'entraînement
  await trainingValidationData.forEachAsync(pitchTypeBatch => {
    // model.predict() exécute la passe avant (forward pass) sur le tenseur d'entrée (xs).
    // dataSync() transfère de manière synchrone les données du tenseur (mémoire WebGL/C++)
    // vers un tableau typé JavaScript standard (Float32Array).
    const values = model.predict(pitchTypeBatch.xs).dataSync();
    const classSize = TRAINING_DATA_LENGTH / NUM_PITCH_CLASSES;

    for (let i = 0; i < NUM_PITCH_CLASSES; i++) {
      results[pitchFromClassNum(i)] = {
        training: calcPitchClassEval(i, classSize, values)
      };
    }
  });

  // Évaluation sur les données de test (validation)
  if (useTestData) {
    await testValidationData.forEachAsync(pitchTypeBatch => {
      const values = model.predict(pitchTypeBatch.xs).dataSync();
      const classSize = TEST_DATA_LENGTH / NUM_PITCH_CLASSES;

      for (let i = 0; i < NUM_PITCH_CLASSES; i++) {
        results[pitchFromClassNum(i)].validation =
            calcPitchClassEval(i, classSize, values);
      }
    });
  }

  return results;
}

/**
 * Métadonnées descriptives des 8 variables de capteurs pour la pédagogie et l'affichage.
 */
const SENSOR_METADATA = [
  { name: 'vx0', label: 'Vélocité initiale X', unit: 'ft/s', min: VX0_MIN, max: VX0_MAX, desc: 'Vitesse horizontale gauche/droite au lâcher' },
  { name: 'vy0', label: 'Vélocité initiale Y', unit: 'ft/s', min: VY0_MIN, max: VY0_MAX, desc: 'Vitesse vers le marbre (négative)' },
  { name: 'vz0', label: 'Vélocité initiale Z', unit: 'ft/s', min: VZ0_MIN, max: VZ0_MAX, desc: 'Vitesse verticale initiale (hauteur)' },
  { name: 'ax', label: 'Accélération X', unit: 'ft/s²', min: AX_MIN, max: AX_MAX, desc: 'Mouvement latéral dû à l\'effet Magnus' },
  { name: 'ay', label: 'Accélération Y', unit: 'ft/s²', min: AY_MIN, max: AY_MAX, desc: 'Décélération par frottement de l\'air' },
  { name: 'az', label: 'Accélération Z', unit: 'ft/s²', min: AZ_MIN, max: AZ_MAX, desc: 'Mouvement vertical (gravité + effet Magnus)' },
  { name: 'start_speed', label: 'Vitesse initiale', unit: 'mph', min: START_SPEED_MIN, max: START_SPEED_MAX, desc: 'Vitesse mesurée au pistolet radar' },
  { name: 'left_handed_pitcher', label: 'Latéralité', unit: 'flag', min: 0, max: 1, desc: '0 = Droitier, 1 = Gaucher' }
];

/**
 * Prédit le type de lancer pour un échantillon de capteurs individuel (inférence en temps réel).
 * 
 * Renvoie non seulement la classe gagnante, mais aussi :
 * - Le niveau de confiance (probabilité maximale)
 * - La distribution complète des probabilités calculée par Softmax pour les 7 classes
 * - Les caractéristiques brutes et normalisées pour l'inspection pédagogique.
 * 
 * @param {number[]} sample - Tableau contenant les 8 valeurs capteurs brutes d'un lancer.
 * @returns {Promise<{predictedPitch: string, confidence: number, probabilities: Array, rawSample: number[], normalizedSample: number[]}>}
 */
async function predictSample(sample) {
  // Calcul pédagogique de l'échantillon normalisé
  const normalized = [
    normalize(sample[0], VX0_MIN, VX0_MAX),
    normalize(sample[1], VY0_MIN, VY0_MAX),
    normalize(sample[2], VZ0_MIN, VZ0_MAX),
    normalize(sample[3], AX_MIN, AX_MAX),
    normalize(sample[4], AY_MIN, AY_MAX),
    normalize(sample[5], AZ_MIN, AZ_MAX),
    normalize(sample[6], START_SPEED_MIN, START_SPEED_MAX),
    sample[7]
  ];

  // Inférence : tf.tensor crée un batch de taille 1 [1, 8] à partir de l'échantillon NORMALISÉ
  // IMPORTANT : L'inférence DOIT utiliser les données normalisées [0, 1] exactement comme à l'entraînement,
  // sinon les valeurs brutes saturent les neurones ReLU et biaisent la sortie vers Fastball à 100%.
  const inputTensor = tf.tensor(normalized, [1, normalized.length]);
  const result = model.predict(inputTensor).arraySync()[0];
  inputTensor.dispose();

  let maxIndex = 0;
  let maxProb = -1;
  const probabilities = [];

  for (let i = 0; i < NUM_PITCH_CLASSES; i++) {
    const prob = result[i];
    probabilities.push({
      classNum: i,
      className: pitchFromClassNum(i),
      probability: prob
    });
    if (prob > maxProb) {
      maxProb = prob;
      maxIndex = i;
    }
  }

  // Tri décroissant pour affichage direct dans l'interface
  probabilities.sort((a, b) => b.probability - a.probability);

  return {
    predictedPitch: pitchFromClassNum(maxIndex),
    confidence: maxProb,
    probabilities: probabilities,
    rawSample: sample,
    normalizedSample: normalized
  };
}

/**
 * Calcule la précision moyenne de prédiction pour une classe donnée à partir
 * du tableau de probabilités aplati retourné par dataSync().
 * 
 * @param {number} pitchIndex - Indice de la classe (0 à 6).
 * @param {number} classSize - Nombre d'exemples correspondant à cette classe dans le lot.
 * @param {Float32Array} values - Tableau 1D aplati de toutes les prédictions (taille : nb_exemples * 7).
 * @returns {number} Précision moyenne (score entre 0 et 1).
 */
function calcPitchClassEval(pitchIndex, classSize, values) {
  // Chaque lancer a 7 probabilités de sortie. On décale l'indice de départ
  // selon la classe analysée.
  let index = (pitchIndex * classSize * NUM_PITCH_CLASSES) + pitchIndex;
  let total = 0;
  for (let i = 0; i < classSize; i++) {
    total += values[index];
    index += NUM_PITCH_CLASSES;
  }
  return total / classSize;
}

/**
 * Convertit un identifiant de classe numérique (0 à 6) en nom lisible de lancer de baseball.
 * 
 * @param {number} classNum - Code numérique de la classe.
 * @returns {string} Nom du lancer (ex: "Fastball (4-seam)", "Curveball", etc.).
 */
function pitchFromClassNum(classNum) {
  switch (classNum) {
    case 0:
      return 'Fastball (2-seam)';
    case 1:
      return 'Fastball (4-seam)';
    case 2:
      return 'Fastball (sinker)';
    case 3:
      return 'Fastball (cutter)';
    case 4:
      return 'Slider';
    case 5:
      return 'Changeup';
    case 6:
      return 'Curveball';
    default:
      return 'Unknown';
  }
}

module.exports = {
  evaluate,
  model,
  resetModel,
  normalize,
  pitchFromClassNum,
  predictSample,
  testValidationData,
  trainingData,
  TEST_DATA_LENGTH,
  SENSOR_METADATA,
  NUM_PITCH_CLASSES
};
