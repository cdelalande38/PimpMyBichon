# Crédits et licences

Tout fichier qui n'a pas été créé pour le projet est tracé ici : source, auteur, licence, date d'entrée. Rien n'entre dans ce dépôt public sans une licence qui l'autorise explicitement (CC0-1.0, CC-BY-4.0, OFL-1.1, ou création faite pour le projet). Les fichiers sous licence restrictive vivent dans le dépôt privé d'assets, jamais ici.

`npm run assets:check` lit le tableau ci-dessous : tout fichier de `public/assets/` doit être couvert par une ligne dont la première cellule contient son chemin ou un motif entre accents graves, et dont la licence fait partie des licences admises. Format détaillé dans `tools/README.md`.

## Fichiers embarqués

| Fichier(s) | Origine | Auteur | Licence | Date | Note |
|---|---|---|---|---|---|
| `public/icons/**` | dessinées pour le projet, sources dans `tools/icons/` | projet PimpMyBichon | création projet | 2026-11-14 | icône de l'app et icônes de la PWA |
| `@fontsource/russo-one` | paquet npm 5.3.0, police Russo One | Jovanny Lemonad | OFL-1.1 | 2026-11-14 | police d'affichage, embarquée dans le bundle ; nom de police réservé « Russo » |
| `@fontsource/chakra-petch` | paquet npm 5.3.0, police Chakra Petch | The Chakra Petch Project Authors | OFL-1.1 | 2026-11-14 | police de texte, embarquée dans le bundle |

## Bibliothèques

Le code s'appuie sur des bibliothèques libres installées par npm (three.js, React, React Three Fiber, drei, postprocessing, Zustand, idb-keyval, Workbox, sous licence MIT ou équivalente). La liste exacte et les versions sont dans `package.json` et `package-lock.json` ; chaque paquet fournit sa licence dans `node_modules/`.

## Audio

Aucun fichier audio n'est embarqué pour l'instant. Quand il y en aura, chaque fichier sera tracé ici avec sa source, sa licence, sa date et, pour la musique générée, la preuve d'abonnement (§ 9 du cahier des charges).
