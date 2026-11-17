/**
 * @file webpack.config.js
 * @description Configuration de Webpack pour le bundling du client web et l'exécution du serveur de dev.
 * 
 * - Compile `client.js` et la bibliothèque `socket.io-client` en un bundle unique exécutable par le navigateur.
 * - Sert les fichiers statiques (`index.html`, `dist/bundle.js`) sur le port 8080 avec rechargement à chaud.
 */

const path = require('path');

module.exports = {
  // Point d'entrée de l'application cliente
  entry: './client.js',

  // Emplacement et nom du bundle généré
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js'
  },

  // Configuration du serveur de développement local
  devServer: {
    static: {
      directory: path.join(__dirname, '.'),
    },
    port: 8080,
    hot: true
  },

  mode: 'development'
};
