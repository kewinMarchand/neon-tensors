/**
 * @file client.js
 * @description Interface utilisateur interactive, pédagogique et d'administration pour TensorFlow.js.
 */

import io from 'socket.io-client';

// Connexion WebSocket vers le backend.
// - En local (dev) : http://localhost:8001 par défaut.
// - Sur GitHub Pages : définir window.TENSOR_BACKEND_URL dans index.html (URL du service Render).
const BACKEND_URL = (typeof window !== 'undefined' && (window.TENSOR_BACKEND_URL || '').trim())
  ? window.TENSOR_BACKEND_URL.trim().replace(/\/$/, '')
  : 'http://localhost:8001';
const socket = io(BACKEND_URL, {
  reconnectionDelay: 400,
  reconnectionDelayMax: 2000,
  timeout: 20000
});

// Éléments d'interface
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');

const btnStartFull = document.getElementById('btnStartFull');
const btnResetModel = document.getElementById('btnResetModel');

const epochMessageBox = document.getElementById('epochMessageBox');
const epochMessageText = document.getElementById('epochMessageText');

const progressBar = document.getElementById('progressBar');
const progressPercent = document.getElementById('progressPercent');
const progressLabel = document.getElementById('progressLabel');
const epochCounter = document.getElementById('epochCounter');
const accuracyTableBody = document.getElementById('accuracyTableBody');

const btnPredict = document.getElementById('btnPredict');
const sensorList = document.getElementById('sensorList');
const resultContainer = document.getElementById('resultContainer');
const predictedPitchName = document.getElementById('predictedPitchName');
const confidenceBadge = document.getElementById('confidenceBadge');
const softmaxList = document.getElementById('softmaxList');
const presetButtons = document.querySelectorAll('.btn-preset');

// Administration
const adminTotalParams = document.getElementById('adminTotalParams');
const adminTfBackend = document.getElementById('adminTfBackend');
const adminHeap = document.getElementById('adminHeap');
const adminTerminal = document.getElementById('adminTerminal');

// Définition des 8 variables capteurs Statcast
const SENSOR_DEFS = [
  { name: 'vx0', label: 'Vélocité X', unit: 'ft/s', min: -18.885, max: 18.065, desc: 'Vitesse latérale' },
  { name: 'vy0', label: 'Vélocité Y (vers marbre)', unit: 'ft/s', min: -152.463, max: -86.374, desc: 'Vitesse vers le receveur (négative)' },
  { name: 'vz0', label: 'Vélocité Z (verticale)', unit: 'ft/s', min: -15.515, max: 9.974, desc: 'Angle vertical de départ' },
  { name: 'ax', label: 'Accélération X (effet Magnus)', unit: 'ft/s²', min: -48.029, max: 30.592, desc: 'Bifurcation latérale' },
  { name: 'ay', label: 'Décélération Y', unit: 'ft/s²', min: 9.397, max: 49.18, desc: 'Résistance aérodynamique' },
  { name: 'az', label: 'Accélération Z (gravité+effet)', unit: 'ft/s²', min: -49.339, max: 2.955, desc: 'Plongeon vs Portance' },
  { name: 'start_speed', label: 'Vitesse initiale radar', unit: 'mph', min: 59.0, max: 104.4, desc: 'Vitesse au lâcher' },
  { name: 'left_handed_pitcher', label: 'Latéralité lanceur', unit: 'flag', min: 0, max: 1, desc: '0 = Droitier, 1 = Gaucher' }
];

// Échantillons MLB réels
const PITCH_PRESETS = {
  curveball: {
    name: 'Curveball',
    sample: [2.668, -114.333, -1.908, 4.786, 25.707, -45.21, 78.0, 0]
  },
  fastball: {
    name: 'Fastball (4-seam)',
    sample: [-2.12, -137.45, -5.21, -12.45, 29.8, -14.2, 94.5, 0]
  },
  slider: {
    name: 'Slider',
    sample: [4.15, -125.10, -3.40, 8.20, 24.50, -28.90, 84.2, 0]
  },
  changeup: {
    name: 'Changeup',
    sample: [-3.50, -122.80, -4.10, -14.10, 22.40, -24.10, 82.0, 0]
  }
};

let currentSample = [...PITCH_PRESETS.curveball.sample];

/**
 * Normalisation Min-Max : ramène x dans [0, 1].
 */
function normalize(val, min, max) {
  if (min === max) return 0;
  return Math.max(0, Math.min(1, (val - min) / (max - min)));
}

/**
 * Affiche un message informatif avec effet de fondu (fade-out puis fade-in).
 * 
 * @param {string} text - Message à afficher.
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
 * Met à jour le tableau des 8 capteurs avec valeurs brutes et normalisées.
 */
function renderSensorInputs() {
  sensorList.innerHTML = '';
  SENSOR_DEFS.forEach((def, index) => {
    const rawVal = currentSample[index];
    const normVal = def.min === 0 && def.max === 1 ? rawVal : normalize(rawVal, def.min, def.max);

    const item = document.createElement('div');
    item.className = 'sensor-item';
    item.innerHTML = `
      <div>
        <div style="font-weight:600; color:var(--text);">${def.label} <code>(${def.name})</code></div>
        <div style="font-size:0.72rem; color:var(--text-muted);">${def.desc} [${def.min} à ${def.max} ${def.unit}]</div>
      </div>
      <div class="sensor-values">
        <div><strong>${rawVal}</strong> ${def.unit}</div>
        <div class="sensor-norm">TensorFlow [0, 1] : <strong>${normVal.toFixed(3)}</strong></div>
      </div>
    `;
    sensorList.appendChild(item);
  });
}

/**
 * Met à jour le tableau de précision par type de lancer.
 */
function renderAccuracyTable(accuracyPerClass) {
  if (!accuracyPerClass) {
    accuracyTableBody.innerHTML = '<tr><td colspan="2" style="text-align:center; color:var(--text-muted); padding:16px;">Modèle non entraîné (Poids aléatoires).</td></tr>';
    return;
  }

  accuracyTableBody.innerHTML = '';
  const classes = Object.keys(accuracyPerClass);
  classes.forEach(cls => {
    const data = accuracyPerClass[cls];
    const valAcc = data.validation !== undefined ? (data.validation * 100) : 0;

    const row = document.createElement('tr');
    row.innerHTML = `
      <td><strong>${cls}</strong></td>
      <td>
        <div class="accuracy-bar-mini">
          <div class="bar-bg">
            <div class="bar-fill" style="width: ${valAcc.toFixed(1)}%;"></div>
          </div>
          <span class="bar-val">${valAcc.toFixed(1)}%</span>
        </div>
      </td>
    `;
    accuracyTableBody.appendChild(row);
  });
}

/**
 * Met à jour les badges de statut.
 */
function updateStatus(state, text) {
  statusBadge.className = 'status-badge status-' + state;
  statusText.textContent = text;
}

/**
 * Met à jour la barre de progression.
 */
function updateProgress(current, total) {
  const percent = Math.round((current / total) * 100);
  progressBar.style.width = percent + '%';
  progressPercent.textContent = percent + '%';
  epochCounter.textContent = `${current} / ${total} Époques`;

  if (current === 0) {
    progressLabel.textContent = 'En attente de démarrage...';
    updateStatus('idle', 'Modèle non préparé');
    btnPredict.disabled = true;
  } else if (current >= total) {
    progressLabel.textContent = 'Entraînement complet (10/10) !';
    updateStatus('ready', 'Modèle prêt pour inférence');
    btnPredict.disabled = false;
  } else {
    progressLabel.textContent = `Apprentissage en cours : Époque ${current}/${total}...`;
    updateStatus('training', `Entraînement (${percent}%)`);
    // Le modèle peut déjà tester de l'inférence même partielle
    btnPredict.disabled = false;
  }
}

/**
 * Ajoute une ligne de log dans le terminal d'administration.
 */
function appendAdminLog(line) {
  if (!adminTerminal) return;
  const div = document.createElement('div');
  div.textContent = line;
  adminTerminal.appendChild(div);
  adminTerminal.scrollTop = adminTerminal.scrollHeight;
}

/**
 * Met à jour les métriques système d'administration.
 */
function updateAdminStats(stats) {
  if (!stats) return;
  if (adminTotalParams) adminTotalParams.textContent = stats.totalParams.toLocaleString();
  if (adminTfBackend) adminTfBackend.textContent = (stats.tfBackend || 'cpu').toUpperCase();
  if (adminHeap) adminHeap.textContent = stats.heapUsedMB + ' MB';
}

// Initialise l'affichage des 8 capteurs
renderSensorInputs();

// =========================================================================
// WEBSOCKET EVENTS
// =========================================================================

socket.on('connect', () => {
  appendAdminLog('[CLIENT] Connexion WebSocket établie avec succès vers le serveur (port 8001)');
});

socket.on('currentState', (state) => {
  updateAdminStats(state.adminStats);

  if (state.serverLogs && Array.isArray(state.serverLogs)) {
    state.serverLogs.forEach(line => appendAdminLog(line));
  }

  if (state.isTrainingComplete) {
    updateProgress(state.totalIterations, state.totalIterations);
    renderAccuracyTable(state.lastAccuracy);
    displayEpochMessageWithFade('Modèle déjà préparé et calibré sur les 10 époques. Vous pouvez classifier des lancers ou le réinitialiser.');
  } else if (state.currentIteration > 0) {
    updateProgress(state.currentIteration, state.totalIterations);
    renderAccuracyTable(state.lastAccuracy);
    displayEpochMessageWithFade(`Modèle en pause à l'époque ${state.currentIteration}/${state.totalIterations}. Vous pouvez continuer pas-à-pas ou lancer la suite.`);
  } else {
    updateProgress(0, state.totalIterations);
    renderAccuracyTable(null);
    displayEpochMessageWithFade('Le modèle est en attente. Cliquez sur <strong>« Lancer Entraînement »</strong> pour commencer.');
  }
});

socket.on('adminLog', (line) => {
  appendAdminLog(line);
});

socket.on('trainingStarted', (data) => {
  btnStartFull.disabled = true;
  btnResetModel.disabled = true;
  displayEpochMessageWithFade('Initialisation du pipeline TensorFlow : chargement des 7 000 lancers et calcul des gradients...');
});

socket.on('epochUpdate', (data) => {
  updateProgress(data.iteration, data.totalIterations);
  renderAccuracyTable(data.accuracy);
  if (data.message) {
    displayEpochMessageWithFade(data.message);
  }
});

socket.on('stepPaused', (data) => {
  btnStartFull.disabled = false;
  btnResetModel.disabled = false;
  updateProgress(data.currentIteration, data.totalIterations);
  renderAccuracyTable(data.accuracy);
  displayEpochMessageWithFade(`Pause à l'époque ${data.currentIteration}/${data.totalIterations}. Observez la progression des barres de précision.`);
});

socket.on('trainingComplete', (data) => {
  btnStartFull.disabled = false;
  btnResetModel.disabled = false;
  updateProgress(data.totalIterations, data.totalIterations);
  renderAccuracyTable(data.accuracy);
  if (data.message) {
    displayEpochMessageWithFade(data.message);
  }
});

socket.on('modelReset', (data) => {
  btnStartFull.disabled = false;
  btnResetModel.disabled = false;
  updateProgress(0, data.totalIterations);
  renderAccuracyTable(null);
  resultContainer.style.display = 'none';
  updateAdminStats(data.adminStats);
  displayEpochMessageWithFade('Les poids du modèle ont été réinitialisés à des valeurs aléatoires. Le modèle a oublié tout son entraînement.');
});

socket.on('predictResult', (result) => {
  btnPredict.disabled = false;
  btnPredict.textContent = '⚡ Classifier ce Lancer';

  resultContainer.style.display = 'flex';

  // Nom du lancer identifié
  predictedPitchName.textContent = result.predictedPitch;

  // Niveau de confiance en %
  const confidencePercent = (result.confidence * 100).toFixed(1);
  confidenceBadge.textContent = `${confidencePercent}% de certitude`;

  // Distribution Softmax
  softmaxList.innerHTML = '';
  result.probabilities.forEach(item => {
    const p = (item.probability * 100).toFixed(1);
    const isWinner = item.className === result.predictedPitch;

    const row = document.createElement('div');
    row.className = 'dist-row';
    row.innerHTML = `
      <div class="dist-label" style="${isWinner ? 'font-weight:700; color:#60a5fa;' : ''}">${item.className}</div>
      <div class="dist-bar-track">
        <div class="dist-bar-fill" style="width: ${p}%; background: ${isWinner ? 'linear-gradient(90deg, #3b82f6, #10b981)' : ''};"></div>
      </div>
      <div class="dist-percent" style="${isWinner ? 'font-weight:700; color:#34d399;' : ''}">${p}%</div>
    `;
    softmaxList.appendChild(row);
  });
});

socket.on('disconnect', () => {
  updateStatus('connecting', 'Connexion perdue avec le serveur Node.js');
  btnPredict.disabled = true;
});

// =========================================================================
// GESTIONNAIRES D'INTERACTION
// =========================================================================

// Entraînement complet (10 époques)
btnStartFull.addEventListener('click', () => {
  socket.emit('startFullTraining');
});

// Réinitialisation du modèle
btnResetModel.addEventListener('click', () => {
  if (confirm('Voulez-vous vraiment réinitialiser les 73 632 poids du modèle à zéro ?')) {
    socket.emit('resetModel');
  }
});

// Changement de preset MLB
presetButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    presetButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const key = btn.getAttribute('data-preset');
    if (PITCH_PRESETS[key]) {
      currentSample = [...PITCH_PRESETS[key].sample];
      renderSensorInputs();
      resultContainer.style.display = 'none';
      // Synchronise la vue 3D avec le preset sélectionné
      if (typeof selectTrajectory === 'function') {
        selectTrajectory(key);
      }
    }
  });
});

// =========================================================================
// GESTION DU VISUALISEUR 3D DES TRAJECTOIRES SVG
// =========================================================================

const TRAJECTORY_DATA = {
  all: {
    title: 'Tous les lancers réels superposés :',
    color: '#f8fafc',
    desc: 'Visualisez comment les 4 familles de lancers partent du même point de lâcher (Y = 18,44 m) mais se séparent nettement sous l\'effet combiné de la vitesse, de la gravité et de la rotation Magnus.',
    path: 'M 210,75 Q 460,165 710,255',
    dur: '1.7s'
  },
  fastball: {
    title: '⚡ Fastball 4-seam (94,5 mph) :',
    color: '#38bdf8',
    desc: 'Trajectoire tendue et directe. La rotation arrière rapide (backspin) crée une portance aérodynamique (effet Magnus vers le haut, az ≈ -14 ft/s²) qui compense la gravité : la balle semble défier la pesanteur et reste haute dans la zone de prises.',
    path: 'M 210,75 Q 460,165 710,255',
    dur: '1.2s'
  },
  curveball: {
    title: '🌪️ Curveball (78,0 mph) :',
    color: '#f97316',
    desc: 'Balle courbe en arc plongeant. La rotation avant (topspin) force l\'air à pousser la balle vers le bas (az = -45,2 ft/s²). La balle chute violemment au dernier tiers de sa course.',
    path: 'M 210,75 Q 420,95 560,180 T 710,318',
    dur: '1.9s'
  },
  slider: {
    title: '⚡ Slider (84,2 mph) :',
    color: '#eab308',
    desc: 'Balle glissante avec rotation en vrille (gyrospin). Part droite comme une balle rapide, puis bifurque latéralement de 20 cm vers la droite (ax = +8,2 ft/s²) juste avant le marbre.',
    path: 'M 210,75 Q 460,165 745,295',
    dur: '1.6s'
  },
  changeup: {
    title: '⏳ Changeup (82,0 mph) :',
    color: '#a855f7',
    desc: 'Changement de vitesse trompeur. Même gestuelle de lancer qu\'une balle rapide, mais la vitesse plus modeste (82 mph) et la décélération accrue font plonger la balle sous la batte.',
    path: 'M 210,75 Q 450,185 700,290',
    dur: '1.75s'
  }
};

const trajButtons = document.querySelectorAll('.btn-traj-pill');
const legendTitle = document.getElementById('legendTitle');
const legendDesc = document.getElementById('legendDesc');
const svgBallMotion = document.getElementById('svgBallMotion');
const svgPaths = {
  fastball: document.getElementById('svgTrajFastball'),
  curveball: document.getElementById('svgTrajCurveball'),
  slider: document.getElementById('svgTrajSlider'),
  changeup: document.getElementById('svgTrajChangeup')
};

function selectTrajectory(key) {
  trajButtons.forEach(b => b.classList.toggle('active', b.getAttribute('data-traj') === key));

  const data = TRAJECTORY_DATA[key] || TRAJECTORY_DATA.all;
  if (legendTitle) {
    legendTitle.textContent = data.title;
    legendTitle.style.color = data.color;
  }
  if (legendDesc) {
    legendDesc.textContent = data.desc;
  }

  // Met en valeur les courbes SVG correspondantes
  Object.keys(svgPaths).forEach(k => {
    const el = svgPaths[k];
    if (!el) return;
    if (key === 'all') {
      el.classList.add('active');
      el.style.opacity = '0.75';
    } else if (k === key) {
      el.classList.add('active');
      el.style.opacity = '1';
    } else {
      el.classList.remove('active');
      el.style.opacity = '0.12';
    }
  });

  // Anime la balle de baseball sur la trajectoire
  if (svgBallMotion && data.path) {
    svgBallMotion.setAttribute('path', data.path);
    svgBallMotion.setAttribute('dur', data.dur || '1.7s');
  }

  // Synchronise le preset dans le bac à sable à droite
  if (key !== 'all' && PITCH_PRESETS[key]) {
    presetButtons.forEach(b => b.classList.toggle('active', b.getAttribute('data-preset') === key));
    currentSample = [...PITCH_PRESETS[key].sample];
    renderSensorInputs();
    resultContainer.style.display = 'none';
  }
}

trajButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.getAttribute('data-traj');
    selectTrajectory(key);
  });
});

// Inférence : clic sur Classifier
btnPredict.addEventListener('click', () => {
  btnPredict.disabled = true;
  btnPredict.textContent = 'Calcul du tenseur...';
  socket.emit('predictSample', currentSample);
});

// Accordéons rétractables
function setupToggle(toggleId, contentId, btnId, label) {
  const toggle = document.getElementById(toggleId);
  const content = document.getElementById(contentId);
  const btn = document.getElementById(btnId);

  if (toggle && content) {
    toggle.addEventListener('click', () => {
      const isHidden = content.style.display === 'none';
      content.style.display = isHidden ? (contentId === 'adminContent' ? 'flex' : 'block') : 'none';
      if (btn) {
        btn.textContent = isHidden ? `Fermer ▲` : `${label} ▼`;
      }
    });
  }
}

setupToggle('guideToggle', 'guideContent', 'guideToggleBtn', 'Ouvrir le guide');
setupToggle('varsToggle', 'varsContent', 'varsToggleBtn', 'Voir le référentiel');
setupToggle('dlMathsToggle', 'dlMathsContent', 'dlMathsToggleBtn', 'Ouvrir les algorithmes');
setupToggle('baseballGlossaryToggle', 'baseballGlossaryContent', 'baseballGlossaryToggleBtn', 'Voir le glossaire');
setupToggle('adminToggle', 'adminContent', 'adminToggleBtn', 'Ouvrir l\'administration');
