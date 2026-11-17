# Neon Tensors

Monorepo des applications **Tensor** (machine learning interactives) : portail + applications, avec socle de composants communs et thème **Neon** attaché, et backends **Render** conservés.

## Structure

```
neon-tensors/
  apps/
    portal/            # portail (ex-neon-tensor) : apps/portal/
    fear-greed/        # apps/fear-greed/ (front + serveur)
    baseball/          # apps/baseball/ (front + serveur)
  packages/
    ui/                # composants commons + shell de jeu (mountGameFrame)
    theme-neon/       # tokens + overrides Neon
    shared/           # utilitaires / ressources partagés
  docs/
    adr/               # ADRs du monorepo
```

## URLs (nouvelles — sans redirection)

- Portail : `https://kewinmarchand.github.io/neon-tensors/`
- Fear & Greed : `https://kewinmarchand.github.io/neon-tensors/apps/fear-greed/`
- Baseball : `https://kewinmarchand.github.io/neon-tensors/apps/baseball/`

## Backends

- Services Render existants conservés pour le moment :
  - `neon-fear-greed-tensor` → https://neon-fear-greed-tensor.onrender.com
  - `neon-baseball-tensor` → https://neon-baseball-tensor.onrender.com
- Nouveaux services Render : création uniquement si nécessaire.

## Notes de déploiement & procédure de mise à jour

- Front (GitHub Pages) : monorepo `main` → `/` ; nouvelles URLs sans redirection.
- Backends (Render) : services existants ; variables d’environnement / CORS / données (seed, `data/`) à valider côté front (`apps/fear-greed`, `apps/baseball`).
- Procédure de mise à jour : toute évolution du front se fait dans le monorepo ; les anciens dépôts (doublons) sont supprimés **après confirmation** (Phase 4, étape 4 du plan).

## ADRs

- `docs/adr/0001-backends-render-conserves-frontiere-front-back.md`
