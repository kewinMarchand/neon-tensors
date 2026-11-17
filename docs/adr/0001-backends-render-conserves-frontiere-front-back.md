# ADR-0001. Backends Render conservés et frontière front/back

- **Statut** : Acceptée
- **Date** : 2026-11-18
- **Contexte** : plan de consolidation `PLAN-CONSOLIDATION-NEON.md`, Phase 3 (Tensor)

## Contexte

Les applications Tensor (`neon-fear-greed-tensor`, `neon-baseball-tensor`) et leur portail (`neon-tensor`) doivent migrer dans le monorepo `neon-tensors`, avec un front (GitHub Pages) et des backends (Render) qui restent opérationnels.

## Décision

1. **Backends Render conservés** pour le moment : les services existants (`neon-fear-greed-tensor`, `neon-baseball-tensor` et URLs actuelles) restent en place.
2. **Nouveaux services Render** : création uniquement si nécessaire.
3. **Frontière front/back** : le front du monorepo pointe vers les backends ; CORS / variables d'environnement / données (seed, `data/`) à valider (ADR-005).

## Alternatives envisagées

- **Refonte backend** : rejetée (le plan retient le système Render existant pour le moment).

## Conséquences

- Les fronts Tensor du monorepo (`apps/fear-greed`, `apps/baseball`, `apps/portal`) doivent être branchés sur les URLs backend existantes.
- La suppression des doublons backend n'intervient qu'après confirmation (Phase 4).

## Suivi

Référence : [ADR-0001](../../boilerplates-commun/doc/adr/0001-consolidation-monorepos-neon.md), [ADR-0002](../../boilerplates-commun/doc/adr/0002-composants-communs-et-theme-neon.md).

## Statut

Acceptée — 2026-11-18
