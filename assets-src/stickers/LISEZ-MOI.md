# Bibliothèque de stickers (dossier d'attente)

Motifs dessinés pour le projet, préparés en avance pour le jalon 4. **Rien d'ici n'est encore branché dans l'app** :
au jalon 4, les fichiers retenus passeront dans `public/assets/stickers/`, leur catalogue dans `src/data/stickers.ts`
et leur ligne dans `CREDITS.md` sera mise à jour.

Créations originales : aucun logo, aucun nom de marque, d'émission ou de jeu, aucun personnage existant, aucune
photo. Les « sponsors » sont des enseignes inventées pour rire (Huile de Coude, Cambouis et Fils, La Bielle Coulée,
Rouille Royale, Pot Percé, Turbo Mamie, Boulons Perdus, Bout de Ficelle, Patin Fumant, Bougie Noyée).

## État au 14 novembre 2026

`index.json` est le seul manifeste. Il décrit 86 motifs dans 18 catégories.

| | Nombre |
| --- | --- |
| Motifs dans le dossier | 86 |
| Bons en l'état | 67 |
| À reprendre avant le jalon 4 (champ `aReprendre` de leur entrée, avec le motif) | 19 |
| Écartés du dépôt (`controle.ecartes` du manifeste) | 2 |

Les 86 fichiers passent le contrôle du gabarit par script. Les 19 « à reprendre » ont été relevés au regard, à
128 px, la taille de la vignette dans l'app : détail trop fin pour rester lisible, cadrage collé au bord, lecture
ambiguë, doublon. Les deux motifs écartés ressemblaient trop à des signes existants (la couronne-signature d'un
peintre, le logo d'un sponsor) : ils ne sont pas versionnés et sont à redessiner autrement.

## Gabarit

- Un fichier SVG par motif, rangé dans `<categorie>/<id>.svg`, 12 ko au plus.
- `viewBox` : `0 0 512 512` (1:1), `0 0 1024 512` (2:1) ou `0 0 1024 256` (4:1). Le champ `ratio` du manifeste le dit.
- Une seule teinte : tout est en `currentColor`, l'app donne la couleur. Les nuances passent par l'opacité.
- Aucun `<text>`, aucune police, aucune image, aucun script, aucun lien autre qu'interne (`url(#…)`).
- Environ 6 % de marge autour du motif. Rien ne doit descendre sous 2 px de trait à 128 px.

## Manifeste

```json
{
  "id": "flammes-classiques-long",
  "label": "Flammes classiques, longues",
  "categorie": "flammes",
  "fichier": "flammes/flammes-classiques-long.svg",
  "ratio": "2:1",
  "symetrique": false,
  "tags": ["flammes", "hot rod"],
  "aReprendre": "présent seulement si le motif est à reprendre : dit pourquoi"
}
```

`symetrique` vaut vrai quand le motif est son propre miroir : l'app n'a alors pas à le retourner d'un flanc à l'autre.

## Lettrages et polices

Aucun fichier de police n'est dans le dépôt, et aucun SVG ne contient de texte : tout lettrage est un tracé.

- Graffiti (VROUM, GAZ, RAT) : capitales dessinées à la main.
- Faux sponsors : lettrage composé avec des polices libres installées sur le poste, puis converti en tracés.

| Police | Licence | Motifs |
| --- | --- | --- |
| DejaVu Sans Bold, DejaVu Serif Bold (2.37) | licence Bitstream Vera | Huile de Coude, Bougie Noyée, Rouille Royale |
| Liberation Serif Bold, Liberation Sans Bold (2.1.5) | OFL-1.1 | Cambouis et Fils, Pot Percé, Bout de Ficelle |
| Liberation Sans Narrow Bold (1.07.6) | GPL-2.0 avec exception pour les polices | La Bielle Coulée, Turbo Mamie, Boulons Perdus, Patin Fumant |

## Points ouverts pour le jalon 4

- Reprendre les 19 motifs marqués, redessiner les 2 écartés.
- Décider si les quatre lettrages composés en Liberation Sans Narrow sont refaits avec une police sous OFL-1.1
  (par exemple celles de l'app), pour ne garder que les licences listées dans `CREDITS.md`.
- Les identifiants internes (`clipPath`, dégradés) sont préfixés par l'identifiant du sticker, pour rester uniques si
  plusieurs SVG sont posés dans la même page. Exception à corriger : `eclaboussure-bombe`.
- Les toiles d'araignée sont en trait (`stroke="currentColor"`) d'épaisseur fixe : le trait grossit avec le sticker.
- Les chemins utilisent des commandes relatives à une décimale : à vérifier avec le lecteur SVG retenu pour
  fabriquer les textures.
- Les SVG ne sont pas produits par un outil versionné : ils se retouchent à la main ou se redessinent.
