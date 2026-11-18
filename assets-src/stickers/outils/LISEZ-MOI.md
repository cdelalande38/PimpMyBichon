# Outils de dessin des stickers de la vague U

Les 23 motifs dessinés pour le projet à la vague U (dés, cartes, vagues, soleils, bandes, damier ondulé,
drapeaux croisés, numéros, engrenage, volant, tournevis, étincelles, cinq faux sponsors inventés) et les
cinq reprises (flocon, liseré et fantômes des flammes) sont écrits par ces scripts, à la main, sans police ni
fichier tiers : le lettrage (sponsors, numéros) est un alphabet de polylignes dans `lib.py`.

- `lib.py` : formes (cercle, rectangle arrondi, étoile, polygone régulier), alphabet tracé, lettrage.
- `dessins1.py`, `dessins2.py` : un motif par bloc ; `python3 dessins1.py` puis `python3 dessins2.py`
  écrivent les SVG dans `sortie/` (à copier dans `src/data/stickers/` ; le flocon et les flammes se
  construisent d'après `flammes-classiques-*.svg`, qui doit y être).
- `planche.mjs` : planche de contrôle (`node planche.mjs sortie.png 7 140 sombre|clair <dossier> <id>…`),
  rendue par Chromium de Playwright.

Gabarit des motifs : voir `../LISEZ-MOI.md` (viewBox 1:1, 2:1 ou 4:1, une seule teinte en `currentColor`,
12 ko au plus, aucun texte). Les 14 motifs repris tels quels de `assets-src/stickers/` n'ont pas de script.
