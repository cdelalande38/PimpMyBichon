# PimpMyBichon

Atelier de customisation de voitures et de motos en 3D temps réel, sur téléphone. Une PWA installable, qui marche hors ligne après la première ouverture, déployée sur GitHub Pages.

Le périmètre, la stack, les budgets et les jalons sont dans [CAHIER_DES_CHARGES.md](CAHIER_DES_CHARGES.md). Les consignes de travail sont dans [CLAUDE.md](CLAUDE.md).

## Où en est le projet

- **Jalon 0, le socle** : accepté le 14 novembre 2026. Vite, React, React Three Fiber, PWA hors ligne, CI et déploiement Pages.
- **Jalon 1, le rendu cible** : en ligne, en attente de sa validation sur téléphone. Rendu showroom néon sur un modèle de banc d'essai, trois ambiances, mode photo. Le garage est construit d'après des données : son mobilier est modelé par le code en formes arrondies, les enseignes néon sont en tubes, les œuvres dessinées pour le projet sont accrochées. Quand on tourne autour du véhicule, les murs et les objets qui passeraient devant lui sortent de l'image (coupe caméra). « Sous le capot » mesure la cadence sur le téléphone (« Mesurer ») et dit où part le temps d'une image (« Comparer »). Le modèle de banc d'essai et chaque meuble sont des substituts déclarés dans [TODO_ASSETS.md](TODO_ASSETS.md). La recette sur le téléphone et la liste de ce qui n'est pas fait, ou pas comme le cahier le demande, sont dans [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md), § 5.

- **Première version livrable (15 novembre 2026)**, mise en ligne à la demande du commanditaire, en avance sur l'ordre des jalons (jalons 2, 3 et 9 entamés ; le jalon 1 n'est pas encore prononcé accepté) :
  - **Catalogue** : cinq véhicules, tous substituts déclarés ([TODO_ASSETS.md](TODO_ASSETS.md)) : « Le concept » (le modèle de banc d'essai, sous licence CC-BY 4.0) et quatre véhicules modelés par le code sur des gabarits de cotes (la Cox, le van, le bobber, la sportive ; sources dans `assets-src/vehicles/`, GLB produits par `npm run vehicles:build`). Un véhicule = un dossier `public/assets/vehicles/<id>/` et son manifeste, découverts au build. Chaque véhicule garde sa peinture, et l'app rouvre sur le dernier véhicule choisi, hors ligne compris.
  - **Menus** : en haut à droite, trois boutons ronds (Atelier : réglages et « Sous le capot » ; Photo ; Radio). En bas, la personnalisation en quatre sections décrites en données (`src/data/dockMenu.ts`) : Véhicule, Custom, Mécanique, Garage, avec une ligne de repère (« Retour », l'endroit où l'on est, « Fermer le menu »). Le menu peut être fermé, compact ou agrandi (options sur plusieurs lignes).
  - **Custom · Peinture** : couleur libre par zone (palette, dernières couleurs, nuancier avec saisie hexadécimale et pipette), finitions, taille de paillette, seconde teinte du caméléon. Un petit cadenas par zone : fermé, la zone suit la carrosserie et ses choix sont verrouillés.
  - **Mécanique · Préparation** : reprogrammation, carburation et nitro, avec la puissance d'origine, le gain et la puissance préparée. Chiffres d'atelier ; aucune pièce visible, aucun son.
  - **Radio** : packs de musique en ZIP, importés depuis un fichier du téléphone, une adresse saisie, ou un lien vers l'app `?pack=<adresse>` qui lance le téléchargement tout seul. Lecture automatique (réglable), enchaînement en arrière-plan, barre de progression, mini-lecteur que le bouton rond déploie ou replie. Aucun morceau n'est fourni ; le pack se fabrique avec `npm run radio:pack`.
  - Pas encore : stickers, flammes, pièces de carrosserie, moteur sur l'établi, intérieurs, sons des moteurs, sortie de nuit. Les entrées correspondantes du menu sont marquées « bientôt ». En cours : la pièce cliquable et la vue intérieure.

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
  data/       ambiances, finitions, cadrages, garage (pièce, mobilier, formes, œuvres, néons)
  render/     niveaux de qualité, reflets, sol, coupe caméra, mesures du rendu
  scene/      scène du garage, véhicule du catalogue (vehicle/), mode photo
  ui/         HUD, dock, panneaux
  dev/        pages de développement (studio des formes, planche des œuvres), hors du site construit
assets-src/   dessins sources faits pour le projet (œuvres du garage, stickers)
tools/        contrôles du dépôt, icônes, captures de contrôle, détection du dépôt privé d'assets
tests/        unit/ (Vitest) et e2e/ (Playwright)
docs/         déploiement, sourcing audio
proto/        prototype v0.1 : référence d'ergonomie uniquement
```

## Règles du dépôt

Le dépôt est public. Aucun nom de marque dans l'app (code, textes, assets), aucune donnée personnelle, aucun secret, aucun fichier sous licence restrictive : les sons de banque, la musique et les modèles achetés vivent dans un dépôt privé, et le build passe sans lui. Détail dans [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md) et [CREDITS.md](CREDITS.md).
