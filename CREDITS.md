# Crédits et licences

Tout fichier qui n'a pas été créé pour le projet est tracé ici : source, auteur, licence, date d'entrée. Rien n'entre dans ce dépôt public sans une licence qui l'autorise explicitement (CC0-1.0, CC-BY-4.0, OFL-1.1, ou création faite pour le projet). Les fichiers sous licence restrictive vivent dans le dépôt privé d'assets, jamais ici.

`npm run assets:check` lit le tableau ci-dessous : tout fichier de `public/assets/` doit être couvert par une ligne dont la première cellule contient son chemin ou un motif entre accents graves, et dont la licence fait partie des licences admises. Format détaillé dans `tools/README.md`.

## Fichiers embarqués

| Fichier(s) | Origine | Auteur | Licence | Date | Note |
|---|---|---|---|---|---|
| `public/icons/**` | dessinées pour le projet, sources dans `tools/icons/` | projet PimpMyBichon | création projet | 2026-11-14 | icône de l'app et icônes de la PWA |
| `@fontsource/russo-one` | paquet npm 5.3.0, police Russo One | Jovanny Lemonad | OFL-1.1 | 2026-11-14 | police d'affichage, embarquée dans le bundle ; nom de police réservé « Russo » |
| `@fontsource/chakra-petch` | paquet npm 5.3.0, police Chakra Petch | The Chakra Petch Project Authors | OFL-1.1 | 2026-11-14 | police de texte, embarquée dans le bundle |
| `public/assets/vehicles/concept/body.glb`, `public/assets/vehicles/concept/LICENSE.md` | modèle « Car Concept » des exemples glTF (GLB, textures KTX2), avec son `LICENSE.md` | Eric Chadwick, Darmstadt Graphics Group GmbH, 2024 | CC-BY-4.0 | 2026-11-14 | « Le concept » du catalogue, ancien modèle de banc d'essai du jalon 1 (`placeholder_banc`), déplacé de `public/assets/bench/carconcept/` le 2026-11-15 ; les logos sont exclus de la licence et masqués à l'écran (plaque unie, textures de logos retirées à l'exécution) |
| `public/assets/vehicles/*/vehicle.json` | écrits pour le projet | projet PimpMyBichon | création projet | 2026-11-15 | manifestes des véhicules du catalogue (§ 6) |
| `public/assets/vehicles/{cox,van,bobber,sportive}/**` | modèles substituts générés par le code : `body.glb` produit par `npm run vehicles:build` depuis `assets-src/vehicles/<id>/model.mjs` (jamais versionné), `thumb.webp` tiré de l'aperçu `src/dev/vehicule/` | projet PimpMyBichon | création projet | 2026-11-15 | substituts déclarés (`placeholder_*`) dans `TODO_ASSETS.md`, en attendant les vrais modèles |
| `public/assets/garage/**` | dessinées pour le projet, copies servies des sources `assets-src/garage/` écrites par `assets-src/garage/outils/fabriquer.mjs` | projet PimpMyBichon | création projet | 2026-11-14 | œuvres du garage en SVG (toile, cible, fronton et plateau du flipper, plaques, affiche, motifs de casque) ; aucune police, aucun logo ; registre dans `src/data/garageArt.ts` |
| `three/examples/jsm/libs/basis/` | transcodeur Basis Universal fourni par le paquet three 0.187.0, émis dans le build sous `libs/basis/` | Binomial LLC | Apache-2.0 | 2026-11-14 | décode les textures KTX2 sur le téléphone ; aucune copie versionnée dans le dépôt |

## Sources graphiques en attente

Dessins faits pour le projet, versionnés dans `assets-src/` mais pas encore embarqués dans l'app. Leur ligne passera dans le tableau ci-dessus quand ils entreront dans `public/assets/`.

| Fichier(s) | Origine | Auteur | Licence | Date | Note |
|---|---|---|---|---|---|
| `assets-src/garage/**` | dessinées pour le projet, produites par `assets-src/garage/outils/` | projet PimpMyBichon | création projet | 2026-11-14 | œuvres du garage (toile, néons, cible, flipper, plaques, affiche, casques) ; lettrage issu d'un alphabet filaire maison, aucune police |
| `assets-src/stickers/**` | dessinés pour le projet | projet PimpMyBichon | création projet | 2026-11-14 | bibliothèque de stickers du jalon 4 ; lettrage des faux sponsors composé avec des polices libres puis converti en tracés (DejaVu 2.37, licence Bitstream Vera ; Liberation 2.1.5, OFL-1.1 ; Liberation Sans Narrow 1.07.6, GPL-2.0 avec exception pour les polices), aucun fichier de police dans le dépôt ; détail dans `assets-src/stickers/LISEZ-MOI.md` |
| `assets-src/vehicles/**` | écrits pour le projet, boîte à outils `tools/vehicles/` | projet PimpMyBichon | création projet | 2026-11-15 | sources des véhicules substituts modelés par le code (`placeholder_*`), transformées en `body.glb` au build ; notice `assets-src/vehicles/LISEZ-MOI.md` |

## Bibliothèques

Le code s'appuie sur des bibliothèques libres installées par npm (three.js, React, React Three Fiber, drei, postprocessing, Zustand, idb-keyval, Workbox, sous licence MIT ou équivalente). La liste exacte et les versions sont dans `package.json` et `package-lock.json` ; chaque paquet fournit sa licence dans `node_modules/`.

## Audio

Aucun fichier audio n'est embarqué pour l'instant. Quand il y en aura, chaque fichier sera tracé ici avec sa source, sa licence, sa date et, pour la musique générée, la preuve d'abonnement (§ 9 du cahier des charges).
