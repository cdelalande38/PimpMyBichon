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

- `placeholder_garage` · retiré au jalon 1 : le garage du § 4 est construit d'après `src/data/garage.ts` (enveloppe, lambris de pin, retombées, spots, halos, textures dessinées au canvas). Son mobilier reste en volumes simples, listés ci-dessous, en attendant des modèles. Pas encore représentés : étagère à cactus, roues murales, radiateur et cartons de l'établi, dalles blanches du plafond :
  - `placeholder_meubles_atelier` · meubles blancs à tiroirs, plan de travail, outils posés · depuis le jalon 1
  - `placeholder_evier` · évier, robinet et flacons au bout des meubles blancs · depuis le jalon 1
  - `placeholder_moto_en_pieces` · jante, cadre et moteur posés sur le plan de travail · depuis le jalon 1
  - `placeholder_servante` · servante noire à tiroirs · depuis le jalon 1
  - `placeholder_etabli` · établi en L en bois clair, panneau d'OSB et panneau d'outils au-dessus · depuis le jalon 1
  - `placeholder_enceintes` · enceintes noires : trois empilées à gauche de la colonne, deux en haut à droite · depuis le jalon 1
  - `placeholder_applique` · applique articulée · depuis le jalon 1
  - `placeholder_colonne_ecran` · colonne noire toute hauteur · depuis le jalon 1
  - `placeholder_ecran` · grand écran (en attendant la photo du dernier build livré, un coucher de soleil dessiné) · depuis le jalon 1
  - `placeholder_toile_pop_art` · toile pop art (motif original à créer) · depuis le jalon 1
  - `placeholder_credence` · crédence noire à bouts en escalier de carreaux blancs (texture dessinée) · depuis le jalon 1
  - `placeholder_moto_sportive` · sportive carénée noire devant la colonne (la moto du moment) · depuis le jalon 1
  - `placeholder_flipper` · flipper ancien et son fronton éclairé · depuis le jalon 1
  - `placeholder_peluche` · peluche posée sur le flipper · depuis le jalon 1
  - `placeholder_panneau_cible` · panneau de bois à bords étagés, rétroéclairé · depuis le jalon 1
  - `placeholder_cible` · cible de fléchettes (texture dessinée) · depuis le jalon 1
  - `placeholder_caisses` · caisses empilées · depuis le jalon 1
  - `placeholder_quad` · quad noir à phare rond et amortisseurs rouges · depuis le jalon 1
  - `placeholder_canape_a`, `placeholder_canape_b` · deux canapés 2 places en cuir noir, en L dans l'angle avant-gauche · depuis le jalon 1
  - `placeholder_table_basse` · table en planches de sapin sur socle noir fermé · depuis le jalon 1
  - `placeholder_bloc_moteur` · bloc 4 cylindres à cornets rouges, posé sur la table · depuis le jalon 1
  - `placeholder_tabouret_frein` · tabouret à pied en disque noir ajouré, assise en bois clair · depuis le jalon 1
  - `placeholder_pouf_pneu` · pouf pneu, dessus capitonné, sans marque · depuis le jalon 1
  - `placeholder_frigo` · petit frigo noir rétro sur socle de palette, sans marque · depuis le jalon 1
  - `placeholder_enseigne_ronde` · enseigne ronde à anneau vert lumineux, sans texte · depuis le jalon 1
  - `placeholder_fut` · fût métallique rouge, sans marque · depuis le jalon 1
  - `placeholder_caisse_colonne` · caisse-colonne en bois de palette au bout du canapé · depuis le jalon 1
  - `placeholder_casiers_casques` · casier ouvert à quatre cases, un casque par case, un point LED bleu en haut de chacune · depuis le jalon 1
  - `placeholder_moto_murale` · petite sportive rouge accrochée sous le casier · depuis le jalon 1
  - `placeholder_solives` · solives sombres du plafond (lames de pin dessinées entre elles) · depuis le jalon 1
  - `placeholder_pieds_tubes` · pieds des tubes LED de l'ambiance « Néon » · depuis le jalon 1
- `placeholder_banc` · les véhicules du catalogue : un modèle de banc d'essai sous licence CC-BY 4.0 (`public/assets/bench/carconcept/`, crédit dans `CREDITS.md`), sans rapport avec un véhicule du catalogue ; sa plaque à logos est remplacée par une plaque unie · depuis le jalon 1

Le garage est généré par le code (`src/scene/garage/`, d'après `src/data/garage.ts`), le banc d'essai est décrit dans `src/data/bench.ts`. Les deux sont annoncés à l'écran (« Substitut · modèle de banc d'essai », et dans « Sous le capot »).

## Emplacements audio

Tous muets : aucun module audio n'existe avant le jalon 9. Rien n'est synthétisé pour combler le vide.

## Licences

Toute fourniture arrive avec sa source et sa licence, notées dans `CREDITS.md`. Rien n'entre dans le dépôt public sans licence qui l'autorise explicitement (CC0, ou création faite pour le projet).
