# Œuvres du garage (sources SVG)

Les éléments graphiques que le garage montre encore en substituts (`placeholder_*` de `src/data/garage.ts`), dessinés
pour le projet. Créations originales : aucun logo, aucun nom de marque, d'émission ou de jeu, aucun personnage existant,
aucune photo, aucune police. Tout lettrage est un tracé issu de l'alphabet filaire maison (`outils/traces.mjs`).

Planche de contrôle (chaque fichier à 256 px de large, la taille vue dans la scène) : `captures/garage-art/planche.png`.

## Fabrication

Les SVG sont **produits** : ne les retouche pas à la main, modifie le module dans `outils/oeuvres/` puis relance.

```bash
node assets-src/garage/outils/fabriquer.mjs                                # réécrit les SVG et les contrôle
node assets-src/garage/outils/fabriquer.mjs --planche captures/garage-art  # + planche de contrôle (sharp)
node assets-src/garage/outils/fabriquer.mjs --essais <dossier>             # + chaque fichier rendu en 768 px
```

Contrôles faits à chaque passage (sortie en erreur au premier échec) : 40 ko au plus, `viewBox` présent, aucun `<text>`
ni police, aucune image ni script, aucun lien autre qu'interne (`url(#…)`), aucun identifiant en double. Les données de
chemin sont écrites sans espace autour des commandes : aucun motif de plaque d'immatriculation ne peut y apparaître.

| Module | Rôle |
| --- | --- |
| `outils/traces.mjs` | palette, matrices, lecture et réécriture de chemins (transformations cuites), alphabet filaire, enveloppe des fichiers |
| `outils/motifs.mjs` | tête de mort, piston, flammes, éclair, éclat, étoile, rayons, trame de points |
| `outils/oeuvres/*.mjs` | un module par œuvre (ou par paire d'œuvres) |

## Palette

Celle de l'app : nuit `#0a0911`, rouge `#ff2d3f`, bleu `#3b7bff`, chrome `#ece9f4`, ambre `#ffb224`, turquoise
`#22d3b6`. Tons ajoutés : jaune `#ffd60a`, rose `#ff3d9a`, orange `#ff7a1a` (toile seulement) ; ombres et reliefs
tirés de la palette (`#b3aecb`, `#1c3f96`, `#c81e2f`, `#1b1826`…).

## Les fichiers et leur place dans la pièce

Places et tailles d'après `captures/notes-agents/jalon1-references*.md` et `src/data/garage.ts`.

| Fichier | viewBox | Substitut remplacé | Place prévue |
| --- | --- | --- | --- |
| `toile-pop-art.svg` | 768 × 1024 (3:4, portrait) | `placeholder_toile_pop_art` | colonne noire, au-dessus de l'écran, de 2,0 à 2,9 m. Quatre cases : tête de mort, piston, éclair, flammes. |
| `neon-pimp-my-bichon.svg` | 1024 × 500 | `neon_pimpmybichon` | mur de gauche, vers 2,05 m, face à +x. |
| `neon-good-vibes-only.svg` | 1024 × 700 | `neon_good_vibes` | mur face au fond (z = D/2), vers 1,75 m, face à -z. |
| `cible.svg` | 1200 × 1000 (unité : le mm) | `placeholder_panneau_cible`, `placeholder_cible` | mur rouge de droite, panneau 1,2 × 1,0 m de 1,3 à 2,3 m. Cible Ø 456 centrée en (600, 500) ; cible seule : carré x 372 → 828, y 272 → 728. Hors du panneau, fond transparent. |
| `flipper-fronton.svg` | 720 × 620 (0,72 × 0,62 m) | `placeholder_flipper` (fronton) | glace du fronton, en matière émissive. Thème inventé « PISTONS D'ENFER ». |
| `flipper-plateau.svg` | 700 × 1250 (0,70 × 1,25 m) | `placeholder_flipper` (plateau) | dessus de la caisse, joueur en bas. Groupes : `couloirs-du-haut`, `bumpers`, `medaillon`, `cibles-de-cote`, `bas-de-plateau`, `couloir-de-lancement`. |
| `plaques-deco.svg` | 640 × 1000 | (nouveau, « à placer librement ») | trois tôles 600 × 300 (2:1) empilées en x = 20, y = 5, 335, 665 ; groupes `plaque-1` (ATELIER BICHON), `plaque-2` (TOUJOURS PLEIN GAZ), `plaque-3` (TURBO). Mur OSB de gauche ou au-dessus de l'établi, ~0,4 × 0,2 m chacune. |
| `affiche-atelier.svg` | 640 × 960 (2:3) | (nouveau) | affiche inventée « GRANDE SOIRÉE VIDANGE » : mur OSB de gauche près du panneau d'outils, ou flanc de la colonne, ~0,6 × 0,9 m. |
| `casque-motifs.svg` | 960 × 840 (cases 480 × 420) | `placeholder_casiers_casques` | un casque par case du casier (1,9 à 2,3 m, au-dessus du canapé B). Groupes `casque-flammes` (noir mat `#1b1826`), `casque-bandes` (blanc), `casque-crane` (rouge), `casque-damier` (sarcelle pailleté). Profils, écran à droite, fond transparent : en carte plane ou comme référence de livrée pour un casque modélisé. |

## Néons : ce que contient le fichier, ce que l'app ajoute

Le fichier ne contient **que l'axe des tubes** : un `<path>` par lettre ou par signe, `fill="none"`, trait d'épaisseur
constante (`stroke-width="16"`, rappelé dans `data-tube="16"`), bouts et angles ronds, inclinaison cuite dans les
coordonnées (aucun `transform`), fond transparent, **aucun flou ni lueur**. Un groupe par couleur de tube :

- `neon-pimp-my-bichon.svg` : `ligne-1` « PIMP MY » bleu, `ligne-2` « BICHON » rouge, `eclair` et `soulignement` ambre ;
  inclinaison de la maison (9°).
- `neon-good-vibes-only.svg` : `ligne-1` « GOOD » et `ligne-3` « ONLY » turquoise, `ligne-2` « VIBES » et `ondes` ambre.

Rendu conseillé dans la scène :

1. Lire les tracés avec le `SVGLoader` de three (embarqué), garder la couleur de chaque groupe (`stroke` du `<g>`).
2. Tube : soit un `TubeGeometry` le long des points échantillonnés (rayon = 8 unités × échelle, soit ~1 cm pour une
   enseigne de 1 m de large), soit `SVGLoader.pointsToStroke` en ruban plat face au mur. Matière émissive de la couleur
   du groupe, intensité au-dessus de 1 pour que le bloom de `PostChain` la prenne.
3. Cœur surexposé : un second tracé plus fin (~1/3 du tube), émissif presque blanc, posé devant.
4. Lueur : le bloom, plus si besoin un halo sur le mur (plan additif ou lumière rectangulaire de la couleur du groupe).
   Ne jamais cuire la lueur dans le fichier.
5. Supports : quatre plots et un fond de plexi transparent peuvent être ajoutés par l'app ; le fichier n'en dessine pas.

Aperçu de cette recette (flou proche 3,5 px, flou large 11 px, cœur blanc de 5 unités) : fonction `avecLueur` de
`outils/fabriquer.mjs`, vignettes « + lueur » de la planche.

## Écarts à trancher par l'intégrateur

- La toile est en **portrait** (demande de la mission) ; le panneau actuel `placeholder_toile_pop_art` fait 1,2 × 0,9 m
  en paysage. Dans la même hauteur de 0,9 m, la toile fait 0,675 m de large.
- `NeonSign` (`src/data/garage.ts`) décrit une seule ligne de texte (`text`, `height`) : les enseignes livrées font deux
  et trois lignes. Il faudra un champ qui pointe vers le SVG (et une hauteur totale) plutôt qu'un texte.
- Les SVG sont des sources : l'app devra en tirer des textures (PNG ou KTX2 dans le budget du § 8) ou lire les tracés
  au chargement. Rien n'est encore branché.
