# PimpMyBichon — consignes pour Claude Code

Atelier de customisation de voitures et de motos en 3D temps réel, sur téléphone (PWA, Android + Chrome en priorité, appareil de référence Galaxy S26), déployé sur GitHub Pages. Esprit « Pimp My Ride » : rendu showroom néon, couleur libre sur chaque pièce, stickers et flammes, catalogue de véhicules, van à aménager en camping-car, moteur à sortir et à chromer sur l'établi, sortie de nuit où l'on regarde le véhicule rouler.

## À lire avant d'écrire du code

1. `CAHIER_DES_CHARGES.md` (v0.3) en entier : périmètre, cible de rendu, stack, budgets, jalons, définition de fini.
2. `TODO_ASSETS.md` : ce qu'un humain doit fournir, et les substituts en place. `docs/SOURCING_AUDIO.md` : présélection de sons moteur et règles de licence.
3. `proto/index.html` : prototype v0.1. Référence pour l'ergonomie et la structure **uniquement**. Son rendu, son audio et son catalogue ont été rejetés.

## Règles de travail

- **Le rendu est l'exigence n°1.** Commencer par le jalon 1 (rendu cible sur le modèle de banc d'essai). Ne pas le déclarer atteint sans captures d'écran confrontées aux descriptions du § 4. Les néons du décor doivent se lire dans la carrosserie.
- Avancer jalon par jalon (§ 14). Ne pas commencer un jalon avant que le précédent soit accepté. Ne jamais réduire le périmètre en silence : ce qui n'est pas fait est écrit.
- Un véhicule = un dossier `public/assets/vehicles/<id>/` et un manifeste. Aucun identifiant de véhicule codé en dur. Intérieurs (emplacements, modules) et moteurs (un modèle par famille, pièces nommées) sont déclarés dans les manifestes. Catalogue, zones, curseurs, stickers, motifs et briefs sont pilotés par les données (`src/data/`, manifestes).
- Une carte de sortie = un dossier `public/assets/maps/<id>/` et un manifeste (§ 5.5 du cahier des charges), fabriquée sur le poste par `tools/maps/` à partir de données géographiques ouvertes (bases de l'IGN, OpenStreetMap) dont la source et la licence sont notées dans `CREDITS.md`. Aucun identifiant de carte codé en dur, aucune donnée téléchargée à l'exécution, aucun film ni aucune compétition cités.
- La profondeur passe d'abord par le paramétrique : couleurs libres, finitions, livrées, curseurs.
- **Modèles** : ne pas prétendre atteindre la cible de rendu avec de la géométrie générée par code. Les véhicules procéduraux du proto sont des substituts déclarés.
- **Assets sous licence** : aucun fichier de banque payante, aucun morceau de musique, aucun modèle acheté dans ce dépôt. Ils vivent dans le dépôt privé `PimpMyBichon-assets`, récupéré au déploiement ; le build doit passer sans lui (emplacements muets, substituts déclarés).
- **Musique** : ne fournir aucun morceau. Construire le dossier de lecture (indexation au build) et l'import « Ma playlist » (stockage privé sur le téléphone), et les laisser vides.
- **Audio** : ne jamais synthétiser un moteur ou une musique dans le code livré (aucun `createOscillator` dans `src/audio/engine/`). Un emplacement audio vide reste muet.
- Ne jamais inventer un asset manquant en silence : substitut nommé `placeholder_*`, listé dans `TODO_ASSETS.md`. Ne télécharger aucun modèle, son ou image sans licence vérifiée et notée dans `CREDITS.md`.
- Vérifier chaque écran par une capture Playwright en 390 × 844 avant de déclarer une tâche finie ; la sortie de nuit par une séquence de captures.
- Mesurer avant d'optimiser ; tenir les budgets du § 8.
- Routage par hash uniquement, chemins d'assets relatifs, `base` Vite réglé sur `/PimpMyBichon/`.
- Aucune requête vers un tiers à l'exécution : polices, textures, sons et modèles sont servis par l'app. Deux exceptions : la télé du garage (§ 5.12 du cahier des charges), en option, qui n'ouvre le lecteur YouTube que sur un geste de l'utilisateur et sur la playlist qu'il a lui-même renseignée ; et le pack de musique (§ 9), téléchargé à l'adresse que l'utilisateur a saisie, ou dès l'ouverture d'un lien vers l'app qui porte cette adresse. Aucune adresse externe n'est écrite dans le code.

## Quota et travail en continu

- **Contrôler le quota en continu.** Dès le début d'une session, et après chaque relance de Claude Code, lire le quota (`claude -p "/usage" --output-format text` : session de 5 heures, semaine, Fable) et lancer une garde de fond qui le relit toutes les cinq minutes. Le relire avant tout lancement d'agents.
- **Seuils.** À 90 % de la session de 5 heures : ne plus rien lancer et passer en mode économe (laisser finir les agents en vol, intégrer leur travail). Pour la semaine, on peut travailler jusqu'à 96 %. Prévenir tôt quand une jauge va bloquer, avec l'heure prévue. Les remises à zéro sont déclenchées par le commanditaire, jamais par Claude.
- **Réveil par cron.** Poser un réveil à un seul tir (outil de planification de la session) cinq minutes après chaque retour à zéro de la session de 5 heures, pour que le travail reprenne tout seul : le réveil relit le quota, vérifie le dépôt, la CI et le site, reprend le travail en cours, puis repose le réveil suivant.
- **Après un plantage ou une relance**, la garde et les réveils ont disparu avec la session : les reposer avant toute autre chose.

## Interdits

- Noms et logos de constructeurs, d'équipementiers, de sponsors, d'émissions ou de jeux vidéo ; personnages de dessin animé.
- Musique, sons, polices ou écrans extraits d'un jeu ou du commerce.
- Données personnelles : le dépôt est public. Seul le surnom « Bichon » apparaît. Pas de photo ni de vidéo de référence dans le dépôt, pas de plaque d'immatriculation, pas de nom complet.
- Clés, jetons ou identifiants dans le dépôt.

## Textes

Interface en français, tutoiement, ton d'atelier entre amis.
