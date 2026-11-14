# PimpMyBichon

Atelier de customisation de voitures et de motos en 3D temps réel, sur téléphone. Une PWA installable, qui marche hors ligne après la première ouverture, déployée sur GitHub Pages.

Le périmètre, la stack, les budgets et les jalons sont dans [CAHIER_DES_CHARGES.md](CAHIER_DES_CHARGES.md). Les consignes de travail sont dans [CLAUDE.md](CLAUDE.md).

## Où en est le projet

**Jalon 0, le socle** : Vite, React, React Three Fiber, PWA hors ligne, CI et déploiement Pages. L'app affiche une scène de substitut (déclarée dans [TODO_ASSETS.md](TODO_ASSETS.md)) : pas encore de véhicule, pas encore de son.

Prochain jalon : le rendu cible (showroom néon), sur un modèle de banc d'essai.

## Démarrer

Il faut Node 20.19 ou plus récent (la CI tourne sur Node 24, voir `.nvmrc`).

```bash
npm install
npm run dev          # serveur de développement, sans service worker
npm run build        # site de production dans dist/
npm run preview      # sert dist/ sous /PimpMyBichon/, comme GitHub Pages
```

Le service worker et le mode hors ligne ne s'essaient que sur le site construit : `npm run build`, puis `npm run preview`.

## Contrôles

```bash
npm run check        # types, lint, garde-fous, assets, audio, tests unitaires
npm run test:e2e     # parcours Playwright en 390 × 844, hors ligne compris (après un build)
```

| Commande | Ce qu'elle vérifie |
|---|---|
| `npm run typecheck` | les types de l'app, du service worker et des outils |
| `npm run lint` | ESLint, règles des hooks React comprises |
| `npm run guard` | aucune requête vers un tiers, aucun nom de marque, aucune donnée personnelle, aucun secret |
| `npm run assets:check` | licences déclarées dans `CREDITS.md`, poids des dossiers, fichiers interdits |
| `npm run audio:check` | aucun moteur ni aucune musique synthétisés |
| `npm test` | tests unitaires Vitest |

Première utilisation de Playwright : `npx playwright install chromium`. Les captures de revue vont dans `captures/` (hors dépôt) ; `PMB_DSF=2 npm run test:e2e` les rend plus fines.

## Arborescence

```
src/
  app/        coque, routage par hash, styles
  pwa/        service worker, précache, mise à jour, installation
  state/      réglages et sauvegarde IndexedDB
  render/     niveaux de qualité, mesures du rendu
  scene/      scène du garage (substituts au jalon 0)
  ui/         HUD, dock, panneaux
tools/        contrôles du dépôt, icônes, détection du dépôt privé d'assets
tests/        unit/ (Vitest) et e2e/ (Playwright)
docs/         déploiement, sourcing audio
proto/        prototype v0.1 : référence d'ergonomie uniquement
```

## Règles du dépôt

Le dépôt est public. Aucun nom de marque, aucune donnée personnelle, aucun secret, aucun fichier sous licence restrictive : les sons de banque, la musique et les modèles achetés vivent dans un dépôt privé, et le build passe sans lui. Détail dans [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md) et [CREDITS.md](CREDITS.md).
