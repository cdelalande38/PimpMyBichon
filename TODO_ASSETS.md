# Assets attendus d'un humain

Claude Code tient ce fichier à jour : chaque substitut encore en place y figure, chaque fourniture reçue en sort. Détail au § 10.3 du cahier des charges.

**Règle** : tout ce qui est sous licence restrictive (banque de sons payante, musique, modèle acheté) va dans le dépôt privé `PimpMyBichon-assets`, jamais ici.

## Bloquants

| Fourniture | Où | Jalon | État |
|---|---|---|---|
| Validation du rendu sur le téléphone, face aux références | — | 1 | à faire |
| Modèles de moteur détaillés, un par famille (le 4 à plat en premier) | `public/assets/shared/engines/<famille>/` | 5 | à sourcer |
| Modèles 3D de la vague 1 : Cox, combi (avec intérieur), bobber, fastback, sportive | `public/assets/vehicles/<id>/` | 6 et 7 | à sourcer (freelance ou modèles libres retravaillés) |
| Une photo du combi | hors dépôt | 6 | à fournir |
| Sons moteur réels, un jeu par famille : prises de `docs/SOURCING_AUDIO.md` à télécharger et valider à l'écoute | dépôt privé, `engines/<famille>/raw/` | 9 | abonnement à prendre, puis écoute |
| Bruitages d'atelier et de route | dépôt privé, `sfx/` | 9 | à sourcer |
| Morceaux du dossier de lecture, licence vérifiée par écrit | dépôt privé, `radio/<station>/` | 9 | à choisir ; vide par défaut |

## Plus tard

| Fourniture | Jalon | État |
|---|---|---|
| Prénoms et textes des amis pour les briefs | 10 | à collecter |
| Modèles de la vague 2 (berline 90, pick-up, 4x4, coupé) | 12 | à sourcer |

## Substituts en place

Format : `placeholder_<nom>` · ce qu'il remplace · depuis quel jalon.

- `placeholder_garage` · le garage du § 4 (décor, objets, éclairage par ambiance) : un sol, un mur et deux tubes néon rouge et bleu · depuis le jalon 0
- `placeholder_speedshape` · le modèle de banc d'essai du jalon 1, puis les véhicules : une forme d'essai de peinture, sans rapport avec un véhicule du catalogue · depuis le jalon 0

Les deux sont générés par le code (`src/scene/`) et annoncés à l'écran (« Substitut · forme d'essai de peinture », et dans « Sous le capot »).

## Emplacements audio

Tous muets : aucun module audio n'existe avant le jalon 9. Rien n'est synthétisé pour combler le vide.

## Licences

Toute fourniture arrive avec sa source et sa licence, notées dans `CREDITS.md`. Rien n'entre dans le dépôt public sans licence qui l'autorise explicitement (CC0, ou création faite pour le projet).
