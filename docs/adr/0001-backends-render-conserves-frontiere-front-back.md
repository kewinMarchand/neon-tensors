# ADR-0001. Backends Render conservés et frontière front/back

- **Statut** : Acceptée
- **Date** : 2026-11-18
- **Contexte** : plan de consolidation, Phase 3 (Tensor)

## Contexte

Les applications Tensor (`fear-greed-tensor`, `baseball-tensor`) et leur portail doivent migrer dans le monorepo `tensor-lab`, avec un front (GitHub Pages) et des backends (Render) qui restent opérationnels.

## Décision

1. **Backends Render conservés** pour le moment : les services existants (`fear-greed-tensor`, `baseball-tensor` et URLs actuelles) restent en place.
2. **Nouveaux services Render** : création uniquement si nécessaire.
3. **Frontière front/back** : le front du monorepo pointe vers les backends ; CORS / variables d'environnement / données (seed, `data/`) à valider (ADR-005).

## Alternatives envisagées

- **Refonte backend** : rejetée (le plan retient le système Render existant pour le moment).

## Conséquences

- Les fronts Tensor du monorepo (`apps/fear-greed`, `apps/baseball`, `apps/portal`) doivent être branchés sur les URLs backend existantes.
- La suppression des doublons backend n'intervient qu'après confirmation (Phase 4).

## Suivi

Référence : [ADR-0001](../../boilerplates-commun/doc/adr/0001-consolidation-monorepos.md), [ADR-0002](../../boilerplates-commun/doc/adr/0002-composants-communs-et-theme-graphite.md).

## Statut

Acceptée — 2026-11-18
