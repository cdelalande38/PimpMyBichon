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

- `placeholder_garage` · retiré au jalon 1 : le garage du § 4 est construit d'après `src/data/garage.ts` (enveloppe, lambris de pin, retombées, spots, halos, textures dessinées au canvas). Son mobilier est modelé par le code en formes arrondies (`src/data/garageProps/`, vocabulaire de `src/data/garageShapes.ts`), en attendant des modèles ; chaque objet reste un substitut, listé ci-dessous. Les œuvres dessinées pour le projet (`assets-src/garage/`, servies depuis `public/assets/garage/art/`) sont posées sur leurs objets, et les deux enseignes néon sont construites en tubes d'après leurs tracés (`src/data/neonAlphabet.ts`). Pas encore représentés : étagère à cactus, roues murales, radiateur et cartons de l'établi, dalles blanches du plafond, motifs des casques (`casque-motifs.svg`, non posé) :
  - `placeholder_meubles_atelier` · meubles blancs à tiroirs, plan de travail, outils posés · depuis le jalon 1
  - `placeholder_evier` · évier, robinet et flacons au bout des meubles blancs · depuis le jalon 1
  - `placeholder_moto_en_pieces` · jante, cadre et moteur posés sur le plan de travail · depuis le jalon 1
  - `placeholder_servante` · servante noire à tiroirs · depuis le jalon 1
  - `placeholder_etabli` · établi en L en bois clair, panneau d'OSB et panneau d'outils au-dessus · depuis le jalon 1
  - `placeholder_enceintes` · enceintes noires : trois empilées à gauche de la colonne, deux en haut à droite · depuis le jalon 1
  - `placeholder_applique` · applique articulée · depuis le jalon 1
  - `placeholder_colonne_ecran` · colonne noire toute hauteur · depuis le jalon 1
  - `placeholder_ecran` · grand écran (en attendant la photo du dernier build livré, un coucher de soleil dessiné) · depuis le jalon 1
  - `placeholder_toile_pop_art` · toile sur châssis au-dessus de l'écran, œuvre `toile-pop-art.svg` posée · depuis le jalon 1
  - `placeholder_credence` · plaque de crédence noire à bouts en escalier de carreaux blancs (texture dessinée) · depuis le jalon 1
  - `placeholder_moto_sportive` · sportive carénée noire devant la colonne (la moto du moment) · depuis le jalon 1
  - `placeholder_flipper` · flipper ancien, œuvres `flipper-plateau.svg` et `flipper-fronton.svg` (éclairé) posées · depuis le jalon 1
  - `placeholder_peluche` · peluche posée sur le flipper · depuis le jalon 1
  - `placeholder_panneau_cible` · panneau de bois à bords étagés, cible de l'œuvre `cible.svg` et trois fléchettes · depuis le jalon 1
  - `placeholder_plaques` · trois tôles décoratives rivetées, œuvre `plaques-deco.svg` posée · depuis le jalon 1
  - `placeholder_affiche` · affiche encadrée sur le mur de gauche, œuvre `affiche-atelier.svg` posée · depuis le jalon 1
  - `placeholder_caisses` · caisses empilées · depuis le jalon 1
  - `placeholder_quad` · quad noir à phares ronds et amortisseurs rouges · depuis le jalon 1
  - `placeholder_canape_a`, `placeholder_canape_b` · deux canapés 2 places en cuir noir, en L dans l'angle avant-gauche · depuis le jalon 1
  - `placeholder_table_basse` · table en planches de sapin, quatre pieds fuselés, ceinture et entretoise en H, bois clair · depuis le jalon 1
  - `placeholder_bloc_moteur` · bloc 4 cylindres à cornets rouges, posé sur la table · depuis le jalon 1
  - `placeholder_tabouret_frein` · tabouret à pied en disque noir ajouré, assise en bois clair · depuis le jalon 1
  - `placeholder_pouf_pneu` · pouf pneu, dessus capitonné, sans marque · depuis le jalon 1
  - `placeholder_frigo` · petit frigo noir rétro sur deux palettes empilées (dés, traverses, planches), sans marque · depuis le jalon 1
  - `placeholder_enseigne_ronde` · enseigne ronde à anneau vert lumineux, sans texte · depuis le jalon 1
  - `placeholder_fut` · fût métallique rouge, sans marque · depuis le jalon 1
  - `placeholder_caisse_colonne` · caisse-colonne en bois de palette au bout du canapé · depuis le jalon 1
  - `placeholder_casiers_casques` · casier ouvert à quatre cases, un point LED bleu en haut de chacune · depuis le jalon 1
  - `placeholder_casques` · un casque par case du casier et un sur la patère, en couleurs unies · depuis le jalon 1
  - `placeholder_moto_murale` · petite sportive rouge accrochée sous le casier, silencieux relié au moteur par son collecteur · depuis le jalon 1
  - `placeholder_solives` · solives sombres du plafond (lames de pin dessinées entre elles) · depuis le jalon 1
  - `placeholder_pieds_tubes` · pieds des tubes LED de l'ambiance « Néon » · depuis le jalon 1
- `placeholder_banc` · « Le concept », véhicule de départ du catalogue : un modèle de banc d'essai sous licence CC-BY 4.0 (`public/assets/vehicles/concept/`, crédit dans `CREDITS.md`), sans rapport avec un véhicule de la liste du cahier ; sa plaque à logos est remplacée par une plaque unie · depuis le jalon 1
  - `placeholder_banc_plaque` · plaque unie à la place de la plaque à logos du modèle de banc d'essai (`src/scene/vehicle/VehicleModel.tsx`) · depuis le jalon 1
- `placeholder_van` · le van (fourgon moderne blanc rabaissé, fiche « Le van ») · depuis la vague G, repris sur gabarit chiffré en vague H (2026-11-15) : modelé par le code (`assets-src/vehicles/van/model.mjs`, un seul loft calé sur le profil et la coupe du gabarit, boîte à outils `tools/vehicles/`), GLB produit au build par `npm run vehicles:build`, vignette `public/assets/vehicles/van/thumb.webp` tirée de l'aperçu `src/dev/vehicule/`. À remplacer par un vrai modèle aux conventions du § 8 (mêmes matériaux `paint_carrosserie`, `paint_toit`, `paint_boucliers`, `paint_jantes`, mêmes nœuds de roues) déposé en `public/assets/vehicles/van/body.glb`, puis retirer `model.mjs` et la ligne `body.glb` de `.gitignore` pour ce dossier. Habitacle (vague N, 2026-11-16, `assets-src/vehicles/van/interieur.mjs`) : doublure noire percée au pare-brise et aux vitres latérales (on voit le garage, jamais à travers la caisse), planche de bord, combiné à deux cadrans (graduations et aiguilles rouges modelées), cadre d'écran, console à commandes rouges, volant à jante pleine, deux sièges avant à appuie-tête et bourrelets, banquette arrière ; plus de cloison. **Vue intérieure revenue** (`interiorView` : derrière les sièges avant, le plafond et le poste de conduite). Le ciel étoilé (semis rouge plus serré au centre, médaillon rond à éclair), la lumière des deux cadrans et de l'écran, et la lumière d'habitacle rouge sont dessinés par l'app d'après `cabin` du manifeste (`src/scene/cabin.ts`, `CabinLights` de `src/scene/GarageCanvas.tsx`), allumés en vue intérieure seulement ; toujours des substituts modelés par le code. Pas fait : scintillement des étoiles (le rendu à la demande ne redessine rien au repos), rubans et spots du § 5.10, choix de la couleur, de la densité et du motif par l'utilisateur, petit afficheur entre les cadrans, lampadaires de nuit derrière les vitres. 117 304 triangles posés (plafond du test : 120 000). Écart voulu au gabarit : bord d'attaque du capot à 0,98 au lieu de 0,86 (calandre et phares n'y tenaient pas).
- `placeholder_cox` · la Cox (berline ronde à deux portes des années 70, moteur arrière, rabaissée, sans pare-chocs, jantes alliage 8 branches, fiche « La Cox ») · depuis la vague G (2026-11-15) : modelée par le code dans `assets-src/vehicles/cox/model.mjs`, GLB produit par `npm run vehicles:build`. À remplacer par un vrai modèle aux conventions du § 8 (matériaux `paint_carrosserie`, `paint_toit`, `paint_capot`, `paint_capot_moteur`, `paint_ailes`, `paint_jantes`, `paint_sellerie`, `paint_pommeau` et les rôles ; avant vers +X, origine au sol au centre de l'empattement ; roues dans les nœuds `roue_avant_droite`, etc.), sans toucher au code. La vignette `public/assets/vehicles/cox/thumb.webp` est à refaire avec le vrai modèle. Vague H (2026-11-15) : avant repris (capot rond et plongeant, ailes avant en pontons terminées par les phares, tablier lisse) et habitacle complet pour la vue intérieure (`assets-src/vehicles/cox/interieur.mjs`). Vague N (2026-11-16), d'après la fiche `captures/notes-agents/reference-interieur-cox.md` : deux points de vue au manifeste (« Entre les sièges », reculé et centré, qui s'ouvre en entrant ; « Au volant », au second appui), planche complétée (grille striée à gauche du compteur, panneau central à interrupteur sous capot rouge, gros bouton rouge, trois bascules polies sous leurs voyants et trois voyants au-dessus, petit cadran poli entre deux boutons et voyant triangulaire rouge, grande boîte à gants à serrure ronde), volant à trois branches plates percées de deux fentes oblongues, jante épaisse, moyeu uni à six vis, levier fin noir sur ressort à neuf spires, pommeau tête de mort à bouche ouverte et langue rouge, baquets bas sans appui-tête à dossier arrondi, garnitures et ciel de toit noirs, deux balais d'essuie-glace couchés vers la droite. Les accents rouges sont en rôle `tail` (ils luisent) faute d'un rouge mat parmi les rôles. Pas fait : coins très arrondis du pare-brise (la découpe suit la grille du loft), sièges en tissu anthracite plus clair (la zone `sellerie` garde sa teinte d'origine). 142 871 triangles posés (plafond relevé à 150 000 pour ce véhicule).
- `placeholder_bobber` · le bobber (bicylindre en V bas et long, tout noir, gros pneus, selle solo, guidon haut, fiche « Le bobber ») · depuis la vague H (2026-11-15) : modelé par le code dans `assets-src/vehicles/bobber/model.mjs` (outils complémentaires dans `assets-src/vehicles/bobber/outils.mjs`), GLB produit par `npm run vehicles:build`, vignette `public/assets/vehicles/bobber/thumb.webp` tirée de l'aperçu `src/dev/vehicule/`. À remplacer par un vrai modèle aux conventions du § 8 (matériaux `paint_reservoir`, `paint_garde_boue`, `paint_cadre`, `paint_moteur`, `paint_jantes`, `paint_fourche`, `paint_selle` et les rôles ; avant vers +X, origine au sol au centre de l'empattement ; roues dans les nœuds `roue_avant` et `roue_arriere`), sans toucher au code. Vignette à refaire avec le vrai modèle.
- `placeholder_sportive` · la sportive (moto carénée de piste du milieu des années 2000, livrée orange, blanc et noir, jantes orange à trois branches dédoublées, fiche « La sportive ») · depuis la vague H (2026-11-15) : modelée par le code dans `assets-src/vehicles/sportive/model.mjs` (outils propres dans `assets-src/vehicles/sportive/outils.mjs`), GLB produit par `npm run vehicles:build`, vignette `public/assets/vehicles/sportive/thumb.webp` tirée de l'aperçu `src/dev/vehicule/`. À remplacer par un vrai modèle aux conventions du § 8 (matériaux `paint_carenage`, `paint_reservoir`, `paint_garde_boue`, `paint_bas_carenage`, `paint_coque_arriere`, `paint_jantes`, `paint_cadre`, `paint_fourche`, `paint_selle` et les rôles ; nœuds `roue_avant` et `roue_arriere` ; avant vers +X, origine au sol au centre de l'empattement), sans toucher au code. Filet rouge et dessus du nez bleu nuit pas faits : aucune zone ne les porte.
- Pas encore au catalogue : le fastback de la vague 1 et les véhicules de la vague 2 (berline 90, pick-up, 4x4, coupé).

Le garage est généré par le code (`src/scene/garage/`, d'après `src/data/garage.ts`), le concept est décrit par son manifeste `public/assets/vehicles/concept/vehicle.json`, chaque véhicule par le sien. Tous sont annoncés à l'écran (« Au garage · <nom du véhicule> · substitut », et dans « Sous le capot »).

## Emplacements audio

Tous muets : aucun module audio n'existe avant le jalon 9. Rien n'est synthétisé pour combler le vide.

## Licences

Toute fourniture arrive avec sa source et sa licence, notées dans `CREDITS.md`. Rien n'entre dans le dépôt public sans licence qui l'autorise explicitement (CC0, ou création faite pour le projet).
