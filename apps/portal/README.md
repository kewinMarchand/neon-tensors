# Tensor Lab — Portail

Portail des applications de machine learning interactives (TensorFlow.js), avec le thème **Graphite** (sombre, accent bleu acier).

[![GitHub](https://img.shields.io/badge/GitHub-Repository-181717?logo=github&logoColor=white)](https://github.com/kewinMarchand/tensor-lab)

## Ouvrir le portail

- **En ligne (GitHub Pages)** : [https://kewinmarchand.github.io/tensor-lab/](https://kewinmarchand.github.io/tensor-lab/)
- **Local** : ouvrir `index.html` (racine) ou `apps/portal/index.html` dans un navigateur.

## Applications

### Fear & Greed Tensor

[![Aperçu de Fear & Greed Tensor](../fear-greed/preview.svg)](https://kewinmarchand.github.io/tensor-lab/apps/fear-greed/)

[Ouvrir l’app](https://kewinmarchand.github.io/tensor-lab/apps/fear-greed/) · [Code source](https://github.com/kewinMarchand/tensor-lab/tree/main/apps/fear-greed) — Indice Fear & Greed BTC/USD, graphiques horaires/journaliers/hebdomadaires, entraînement et prévisions avec TensorFlow.js. *(Démo GitHub Pages : frontend statique + backend Node.js hébergé sur Render ; cold start possible sur l’offre gratuite.)*

### Baseball Tensor

[![Aperçu de Baseball Tensor](../baseball/preview.svg)](https://kewinmarchand.github.io/tensor-lab/apps/baseball/)

[Ouvrir l’app](https://kewinmarchand.github.io/tensor-lab/apps/baseball/) · [Code source](https://github.com/kewinMarchand/tensor-lab/tree/main/apps/baseball) — Classification des lancers MLB (Statcast) par réseau de neurones : entraînement, visualisation et inférence interactive. *(Démo GitHub Pages : frontend statique + backend Node.js hébergé sur Render ; cold start possible sur l’offre gratuite.)*

## Lancement local (expérience complète)

Les applications utilisent un backend Node.js (Socket.IO) pour les données/entraînement en temps réel. Depuis la racine du monorepo :

- **Fear & Greed Tensor** : `cd apps/fear-greed && npm install && npm run dev` → http://localhost:8082 (backend :8002)
- **Baseball Tensor** : `cd apps/baseball && npm install && npm run dev` → http://localhost:8080 (backend :8001)

## Thème

Le portail et les applications utilisent le thème **Graphite** (sombre, sobre, accent bleu acier) via les fichiers de thème partagés (`neon/neon-tokens.css`, `neon/neon-base.css`, `neon/neon-components.css`) et les styles propres à chaque app.
