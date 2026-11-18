# Neon Tensor

Portail des applications de machine learning interactives (TensorFlow.js), avec le thème **Boilerplate Neon**.

[![GitHub](https://img.shields.io/badge/GitHub-Repository-181717?logo=github&logoColor=white)](https://github.com/kewinMarchand/neon-tensors)

## Ouvrir le portail

- **En ligne (GitHub Pages)** : [https://kewinmarchand.github.io/neon-tensor/](https://kewinmarchand.github.io/neon-tensor/)
- **Local** : ouvrir `index.html` dans un navigateur.

## Applications

### Fear & Greed Tensor

[![Aperçu de Fear & Greed Tensor](https://raw.githubusercontent.com/kewinMarchand/neon-fear-greed-tensor/main/preview.svg)](https://kewinmarchand.github.io/neon-fear-greed-tensor/)

[Code source](https://github.com/kewinMarchand/neon-tensors/tree/main/apps/fear-greed) — Indice Fear & Greed BTC/USD, graphiques horaires/journaliers/hebdomadaires, entraînement et prévisions avec TensorFlow.js. *(Démo GitHub Pages : frontend statique + backend Node.js hébergé sur Render ; cold start possible sur l’offre gratuite.)*

### Neon Baseball Tensor

[![Aperçu de Neon Baseball Tensor](https://raw.githubusercontent.com/kewinMarchand/neon-baseball-tensor/main/preview.svg)](https://kewinmarchand.github.io/neon-baseball-tensor/)

[Code source](https://github.com/kewinMarchand/neon-tensors/tree/main/apps/baseball) — Classification des lancers MLB (Statcast) par réseau de neurones : entraînement, visualisation et inférence interactive. *(Démo GitHub Pages : frontend statique + backend Node.js hébergé sur Render ; cold start possible sur l’offre gratuite.)*

## Lancement local (expérience complète)

Les applications Tensor utilisent un backend Node.js (Socket.IO) pour les données/entraînement en temps réel :
- **Fear & Greed Tensor** : `npm install && npm run dev` dans `neon-fear-greed-tensor` → http://localhost:8082 (backend :8002)
- **Neon Baseball Tensor** : `npm install && npm run dev` dans `neon-baseball-tensor` → http://localhost:8080 (backend :8001)

## Thème

Ce portail et les applications utilisent la base CSS du [Boilerplate Neon](https://github.com/kewinMarchand/boilerplate-neon) (`neon/neon-tokens.css`, `neon-base.css`, `neon-components.css`).

Les applications restent autonomes dans leurs dépôts respectifs ; ce dépôt fournit le portail et l’identité visuelle de la collection Tensor.
