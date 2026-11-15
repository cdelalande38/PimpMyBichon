# Déploiement et recette sur le téléphone

L'app est un site statique publié sur GitHub Pages par le workflow `.github/workflows/pages.yml`. Chaque push sur `main` lance le build, les contrôles et les parcours Playwright, puis publie `dist/`. Une pull request lance les mêmes contrôles, sans publier.

Adresse du site : `https://<compte>.github.io/PimpMyBichon/`

## 1. Mise en route, une seule fois

Pages doit être activé avec la source « GitHub Actions ».

- Dans l'interface : **Settings → Pages → Build and deployment → Source : GitHub Actions**.
- Ou en ligne de commande, depuis le dépôt (`gh` remplace `{owner}` et `{repo}` tout seul) :

```bash
gh api -X POST "repos/{owner}/{repo}/pages" -f build_type=workflow
```

Tant que ce n'est pas fait, le job « Publication » échoue avec une erreur 404. Le build et les tests, eux, passent.

## 2. Ce qui est publié

| Publié | Pas publié |
|---|---|
| le contenu de `dist/` : l'app, ses polices, ses icônes, le service worker | `proto/`, `docs/`, `src/`, `tools/`, `tests/` |
| plus tard, les paquets audio générés au build | le dépôt privé d'assets tel quel |

Le dépôt est public : tout ce qui est poussé se voit, même ce qui n'est pas publié sur le site. `npm run guard` refuse les adresses e-mail, les chemins personnels, les clés et les noms de marque.

## 3. Dépôt privé d'assets (facultatif pour l'instant)

Les sons de banque, la musique et les modèles sous licence ne vont jamais dans ce dépôt. Ils vivent dans un dépôt privé `PimpMyBichon-assets`, que la CI récupère par une clé de déploiement en lecture seule. **Le build passe sans lui** : emplacements muets et substituts déclarés (`TODO_ASSETS.md`).

Au jalon 0, le build se contente de constater sa présence et de compter ce qu'il contient (visible dans « Sous le capot »). L'empaquetage des sons arrive avec le jalon 9.

```bash
# 1. Créer le dépôt privé, avec un premier commit : la CI ne sait pas récupérer un dépôt vide
gh repo create PimpMyBichon-assets --private --add-readme --description "Assets sous licence de PimpMyBichon"

# 2. Créer une clé de déploiement, sans phrase secrète, hors de tout dépôt
CLE=$(mktemp -d)
ssh-keygen -t ed25519 -N "" -C "pimpmybichon-assets" -f "$CLE/assets_deploy_key"

# 3. Clé publique sur le dépôt privé (lecture seule par défaut)
gh repo deploy-key add "$CLE/assets_deploy_key.pub" --repo <compte>/PimpMyBichon-assets --title "CI PimpMyBichon"

# 4. Clé privée en secret du dépôt public (à lancer depuis ce dépôt)
gh secret set ASSETS_DEPLOY_KEY < "$CLE/assets_deploy_key"

# 5. Ne rien laisser traîner
rm -r "$CLE"
```

En local, clone-le dans `.private-assets/` (dossier ignoré par git), ou pointe ailleurs avec la variable `PMB_ASSETS_DIR` :

```bash
git clone git@github.com:<compte>/PimpMyBichon-assets.git .private-assets
```

Arborescence attendue :

```
.private-assets/
├─ engines/<famille>/     un dossier par famille de moteur (raw/ pour les prises brutes)
├─ sfx/                   bruitages d'atelier et de route
├─ radio/<station>/       un dossier par station ; une station vide n'apparaît pas
├─ models/                modèles 3D sous licence
└─ references/            photos et vidéos de cadrage : jamais publiées, jamais utilisées comme textures
```

## 4. Recette du jalon 0 sur Android

Critère d'acceptation : l'app s'installe et s'ouvre en mode avion.

1. Sur le téléphone, en wifi, ouvre l'adresse du site dans **Chrome**.
2. Attends que l'indicateur en haut à droite passe de « Préparation du garage… » à **« Prêt hors ligne »**.
3. Installe l'app : bouton **« Installer l'atelier »** dans le dock, ou menu de Chrome puis « Ajouter à l'écran d'accueil ».
4. Ferme Chrome. Passe le téléphone en **mode avion**.
5. Ouvre PimpMyBichon depuis l'écran d'accueil.

C'est bon si :

- l'app s'ouvre en plein écran, sans barre d'adresse ;
- le modèle de banc d’essai apparaît et tourne sous le pouce ;
- l'indicateur affiche « Hors ligne · tout est là » ;
- « Sous le capot » indique « Installée », la version attendue, et une cadence proche de 60 i/s après avoir fait tourner la forme.

Si ça coince, relève ce que dit « Sous le capot » (version, ligne « Hors ligne », ligne « Rendu 3D ») : c'est ce qu'il faut pour diagnostiquer.

## 5. Recette du jalon 1 sur Android

Critère d'acceptation (cahier des charges, § 14) : le rendu cible sur le modèle de banc d'essai, dans le garage, avec les trois ambiances et le rendu photo, validé à l'œil face aux références du § 4, sur l'appareil de référence, à 60 i/s en standard.

1. Ouvre l'app. Si le bandeau « Nouvelle version de l'atelier prête » s'affiche, touche « Recharger ».
2. « Sous le capot » : vérifie que la version est celle du dernier commit publié.
3. Regarde les trois ambiances (onglet « Ambiance »), quelques teintes et finitions, puis le rendu photo (« Photo »).
4. Tourne autour du véhicule, de près et de loin, d'en haut et au ras du sol : les murs et les objets qui passeraient devant lui quittent l'image en fondu ; le véhicule et son reflet au sol restent entiers.
5. Mesure la cadence dans « Sous le capot », en qualité Standard puis en Max (« Réglages ») :
   - **« Mesurer »** : la scène tourne cinq secondes, la ligne « Mesure » donne la cadence, le pire centile, les appels de dessin et les triangles ;
   - **« Comparer »** : quatre mesures d'affilée, une vingtaine de secondes. Pose le téléphone et ne touche à rien : fermer le panneau ou quitter l'app arrête la comparaison.

C'est bon si :

- les néons du décor se lisent dans la carrosserie, dans les trois ambiances ;
- rien ne passe entre l'œil et le véhicule quand on tourne, et rien ne clignote pendant le fondu ;
- la rotation lente fait un tour en un peu plus d'une minute, sans à-coup ;
- « Mesurer » donne une cadence proche de 60 i/s en Standard.

### Lire « Comparer »

Chaque ligne donne la cadence, le temps par image et son écart au réglage en cours, le pire centile, le temps « processeur » (fil principal) et les appels de dessin.

| Ligne | Ce qu'elle change | Si elle s'écarte nettement du réglage en cours |
|---|---|---|
| Réglage en cours | rien | c'est la référence |
| Trame partout | la trame du fondu compilée dans tous les matériaux opaques du décor, comme avant le commit `8dc262f` | plus lente : le rejet de fragments coûte cher sur cette carte graphique |
| Sans reflet du sol | la réflexion du sol coupée | plus rapide : le reflet est le poste le plus lourd |
| Densité 1 | un pixel d'image par pixel CSS | plus rapide : l'image est limitée par le nombre de pixels |

Un temps par image proche du temps « processeur » dit que l'image est limitée par le processeur, pas par la carte graphique. Quand l'écran plafonne la cadence (60 i/s sur toutes les lignes), seul le temps « processeur » distingue les lignes : c'est en Max, sous le plafond, que la comparaison parle. Pour un diagnostic, relève les quatre lignes dans les deux niveaux.

### Ce qui n'est pas fait, ou pas comme le cahier le demande

- **Substituts** : le modèle de banc d'essai et tout le mobilier du garage, listés dans [TODO_ASSETS.md](../TODO_ASSETS.md).
- **Cadence sur l'appareil de référence** : à confirmer. Dernier relevé : 43 i/s en Max pendant la rotation lente (version `5beca09`), cause non établie ; « Comparer » sert à la trouver.
- **Anticrénelage** : SMAA seul, là où le cahier demande MSAA et SMAA. Sur des cibles en demi-flottants, le MSAA double la mémoire de la chaîne d'image et se résout avant le tone mapping.
- **Niveau Économie** : ni bloom, ni faux reflets au sol.
- **Qualité « Auto »** : plafonnée au niveau Standard.
- **Rendu photo** : pas d'ombres adoucies, l'ombre sous le véhicule est celle de l'atelier.
- **Ombre sous le véhicule** : rendue une seule fois, elle varie un peu d'un chargement à l'autre.
- **Taches de contact du mobilier** : rectangulaires, même sous un meuble à pieds ou en L.
- **Reflet des enseignes au sol** : en pavés de pixels au niveau Standard (réflexion en demi-résolution).
- **Processeur graphique sans cibles flottantes** : niveau Économie imposé, reflets de la carrosserie écrêtés ; sans flottants 32 bits, le Max se rend au Standard. Essayé en rendu logiciel seulement.
- **Parcours automatiques** : le fondu de la coupe n'est éprouvé qu'au niveau Standard ; la perte du contexte WebGL n'a pas de parcours.

## 6. Mise à jour de l'app installée

Une nouvelle version se télécharge en arrière-plan. L'app ne se recharge jamais toute seule : un bandeau « Nouvelle version de l'atelier prête » propose « Recharger ». Sans réponse, la nouvelle version s'applique au prochain lancement, une fois l'app complètement fermée.

## 7. Déboguer sur l'appareil

Téléphone branché en USB, débogage USB activé :

```bash
adb devices            # le téléphone doit apparaître
```

Puis ouvre `chrome://inspect` dans Chrome sur le poste : console, réseau, performances et service worker du téléphone sont accessibles.

## 8. Limites de GitHub Pages

- Site : 1 Go au maximum. Bande passante indicative : 100 Go par mois. Déploiement : 10 minutes au maximum.
- Pas d'en-têtes HTTP personnalisés : rien dans l'app ne doit dépendre de `SharedArrayBuffer`.
- `npm run assets:check` surveille le poids du site construit.

## 9. Revenir en arrière

- Le plus simple : `git revert <commit>` puis push. Le workflow republie la version précédente.
- Sans toucher au code : onglet **Actions**, ouvrir le run vert du dernier commit qui marchait (pas forcément le plus récent), **Re-run all jobs**. Possible tant que GitHub conserve ce run ; au-delà, `git revert`.

Les téléphones déjà installés recevront la version republiée comme une mise à jour ordinaire.
