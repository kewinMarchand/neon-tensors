/**
 * @file stop.js
 * @description Utilitaire d'arrêt propre des processus serveurs (Node.js et Webpack Dev Server).
 * 
 * Permet d'identifier et de tuer les processus écoutant sur les ports réseau utilisés par le projet :
 * - Port 8001 : Serveur d'entraînement et WebSocket TensorFlow.js (Backend).
 * - Port 8080 : Serveur Webpack Dev Server (Frontend).
 * 
 * Compatible Windows (PowerShell) et systèmes Unix / macOS (lsof).
 */

const { execSync } = require('child_process');

/**
 * Cible spécifiée en ligne de commande : 'server', 'client' ou 'all' (par défaut).
 */
const target = process.argv[2] || 'all';
const ports = [];

if (target === 'server' || target === '8001') {
  ports.push(8001);
} else if (target === 'client' || target === '8080') {
  ports.push(8080);
} else {
  ports.push(8001, 8080);
}

/**
 * Tente de fermer les processus associés à chaque port ciblé.
 */
for (const port of ports) {
  try {
    if (process.platform === 'win32') {
      const cmd = `powershell -NoProfile -Command "$p = Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; if ($p) { Stop-Process -Id $p -Force; Write-Host 'Processus arrêté sur le port ${port}.' } else { Write-Host 'Aucun processus actif sur le port ${port}.' }"`;
      execSync(cmd, { stdio: 'inherit' });
    } else {
      execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`, { stdio: 'inherit' });
      console.log(`Processus arrêté sur le port ${port}.`);
    }
  } catch (err) {
    console.log(`Aucun processus actif sur le port ${port}.`);
  }
}
