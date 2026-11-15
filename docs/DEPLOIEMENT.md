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
   - **« Comparer »** : cinq variantes de la scène, mesurées deux fois chacune (à l'aller puis au retour), 33 secondes environ. Pose le téléphone à plat et ne touche à rien : fermer le panneau ou quitter l'app arrête la comparaison, tourner le téléphone la fausse. Recopie telles quelles la phrase d'état et les cinq lignes.

C'est bon si :

- les néons du décor se lisent dans la carrosserie, dans les trois ambiances ;
- rien ne passe entre l'œil et le véhicule quand on tourne, et rien ne clignote pendant le fondu ;
- la rotation lente fait un tour en un peu plus d'une minute, sans à-coup ;
- « Mesurer » donne une cadence proche de 60 i/s en Standard.

### Lire « Comparer »

La phrase d'état, au-dessus des lignes, donne le niveau, le pixel ratio, le bruit de l'essai et le rythme de l'écran :

- **« Bruit : 0,4 ms par image, 0,3 ms de carte »** : le plus grand écart entre l'aller et le retour d'une même variante. Un écart au réglage en cours qui ne le dépasse pas est marqué « dans le bruit » : il ne prouve rien.
- **« Trop de bruit pour conclure »** : le bruit dépasse 10 % de la valeur du réglage en cours (0,5 ms au moins). Relance « Comparer », téléphone posé, écran allumé, rien d'autre d'ouvert, pas en charge.
- **« Écran : 60 i/s »** (ou 120) : rythme de l'écran, estimé d'après les images. « Rythme de l'écran pas reconnu » : images trop lentes ou trop irrégulières pour le dire.
- **« Carte pas chronométrée »** : ce navigateur ne donne pas la minuterie de la carte ; seules la cadence et le processeur parlent, et seulement hors du plafond de l'écran (en Max).

Chaque ligne se lit ainsi :

`Variante : 43,1 i/s, 23,2 ms (+0,7 ms, dans le bruit) · carte 18,4 ms (−4,1 ms) · aller-retour à 0,4 et 0,3 ms près · processeur 5,1 ms · 141 appels.`

| Morceau | Ce qu'il dit |
|---|---|
| `43,1 i/s, 23,2 ms` | cadence vue à l'écran, et temps moyen entre deux images (moyenne de l'aller et du retour) |
| `(+0,7 ms, dans le bruit)` | écart au réglage en cours ; « dans le bruit » : pas plus grand que le bruit de l'essai |
| `au plafond de l'écran` | la variante tient le rythme de l'écran : sa cadence ne dit rien de la carte, lis le temps de carte |
| `carte 18,4 ms (−4,1 ms)` | temps de la carte graphique par image (minuterie de la carte, indépendante de l'écran), et son écart au réglage en cours |
| `aller-retour à 0,4 et 0,3 ms près` | écart entre l'aller et le retour de cette variante, pour la cadence puis pour la carte |
| `processeur 5,1 ms` | temps du fil principal par image |
| `141 appels` | appels de dessin par image |

| Ligne | Ce qu'elle change | Si elle s'écarte nettement du réglage en cours (hors du bruit) |
|---|---|---|
| Réglage en cours | rien | c'est la référence |
| Trame partout | la trame du fondu posée sur tous les matériaux opaques du décor, dans l'ordre de dessin actuel (pas exactement l'état d'avant le commit `8dc262f`) | carte plus lente : le rejet de fragments coûte cher sur cette carte graphique |
| Sans reflet du sol | la réflexion du sol coupée | plus rapide : le reflet est un poste lourd (carte et processeur) |
| Sans mobilier | objets, œuvres et ombres de contact du garage cachés | plus rapide : le décor remodelé pèse |
| Densité 1 | un pixel d'image par pixel CSS | carte bien plus rapide : l'image est limitée par le nombre de pixels |

Un temps de carte proche du temps entre deux images dit que l'image est limitée par la carte graphique ; un temps « processeur » proche, qu'elle l'est par le processeur. Au plafond de l'écran (souvent en Standard), seuls la carte et le processeur départagent les lignes. Relève l'état et les cinq lignes en Standard puis en Max.

### Ce qui n'est pas fait, ou pas comme le cahier le demande

- **Substituts** : le modèle de banc d'essai et tout le mobilier du garage, listés dans [TODO_ASSETS.md](../TODO_ASSETS.md).
- **Cadence sur l'appareil de référence** : à confirmer. Dernier relevé : 43 i/s en Max pendant la rotation lente (version `5beca09`), cause non établie ; « Comparer » sert à la trouver.
- **Anticrénelage** : SMAA seul, là où le cahier demande MSAA et SMAA. Sur des cibles en demi-flottants, le MSAA double la mémoire de la chaîne d'image et se résout avant le tone mapping.
- **Niveau Économie** : ni bloom, ni faux reflets au sol.
- **Qualité « Auto »** : plafonnée au niveau Standard.
- **Rendu photo** : pas d'ombres adoucies, l'ombre sous le véhicule est celle de l'atelier.
- **Ombre sous le véhicule** : rendue une seule fois, à la pose du véhicule. Elle ne voit plus que lui (le mobilier n'y laisse plus d'empreinte) et ne change plus d'un chargement à l'autre, mais elle est plus dense qu'avant sous la caisse : à juger à l'œil (réglage unique : `VEHICLE_SHADOW.opacity`, `src/render/vehicleShadow.ts`).
- **Changements d'image à juger** : cônes de lumière arrêtés à 1,5 m du sol, en fondu (ils ne traversent plus le mobilier, mais ne descendent plus jusqu'au sol) ; cuve de l'évier plus sombre (sa tache de contact est maintenant posée sur le plan de travail).
- **Taches de contact du mobilier** : rectangulaires, même sous un meuble à pieds ou en L.
- **Scintillement** : les œuvres, les poignées, les rayons de jante et le rebord de l'évier scintillent en rotation lente. Deux remèdes essayés (chrome moins lisse, filtrage des œuvres), gains dans le bruit : rien changé.
- **Gels de compilation restants** : la première entrée en photo (passe de moyenne de l'affinage), le premier passage en Économie et le premier passage en Max compilent encore des programmes dans l'image ; sur le poste de mesure, une image peut s'y figer plusieurs secondes. La sonde de réflexion d'une nouvelle taille, elle, attend que ses programmes soient prêts avant d'être posée, si le navigateur compile en tâche de fond. Rien de cela n'est éprouvé sur le téléphone.
- **« Comparer »** : sur le poste de mesure, 6 essais complets sur 8 ont fini sur « Trop de bruit pour conclure » (carte graphique partagée avec le reste du bureau) : le seuil est à juger sur le téléphone. Le pire centile n'y figure plus (« Mesurer » le donne) ; une comparaison interrompue ne garde aucune ligne ; la minuterie de la carte n'est pas vérifiée sur l'appareil de référence, ni ce qu'elle compte sur une carte qui dessine par tuiles ; un écran à 120 i/s dont toutes les images prennent deux périodes est lu comme un écran à 60 i/s.
- **Reflet des enseignes au sol** : en pavés de pixels au niveau Standard (réflexion en demi-résolution).
- **Processeur graphique sans cibles flottantes** : niveau Économie imposé, reflets de la carrosserie écrêtés, image nettement plus sombre que le chemin normal (sonde de réflexion en 8 bits linéaires) ; sans flottants 32 bits, le Max se rend au Standard. Essayé en rendu logiciel et sur le poste de mesure, extensions masquées.
- **Parcours automatiques** : le fondu de la coupe n'est éprouvé qu'au niveau Standard ; la perte du contexte WebGL n'a pas de parcours.


## 5 bis. Recette de la première version livrable (15 novembre 2026)

Sur le téléphone, après « Recharger » si le bandeau de nouvelle version s'affiche.

1. **Changer de véhicule** : section « Véhicule » du menu du bas. Cinq véhicules : le concept, la Cox, le van, le bobber, la sportive. Chacun garde sa peinture, et l'app rouvre sur le dernier véhicule choisi, même en mode avion.
2. **Se repérer dans le menu** : la poignée à chevron agrandit le menu (options sur plusieurs lignes) ; la croix le ferme en une pastille « Personnaliser » ; « Retour » remonte d'un niveau. Choisir une option ne doit pas faire bouger le menu.
3. **Peindre** : « Custom », puis « Peinture ». Choisis une zone, puis « Couleur » ou « Finition ». Le disque arc-en-ciel ouvre le nuancier. Une zone au cadenas fermé suit la carrosserie : ses choix sont grisés, et un appui dit pourquoi ; touche le cadenas pour lui donner sa propre peinture.
4. **Préparer le moteur** : « Mécanique », puis « Préparation ». Sur le van, « Stage 3 » donne : origine 102 ch, gain + 73 ch, reprogrammé 175 ch. Chiffres d'atelier, rien ne change à l'écran ni au son.
5. **Écouter la radio** : bouton rond « Radio », en haut à droite.
   - sur le poste : `npm run radio:pack -- <dossier de musique> <fichier.zip>` (un sous-dossier = une station) ;
   - hébergement : une adresse en https qui rend le fichier directement, avec l'en-tête `Access-Control-Allow-Origin` (l'adresse du site, ou `*`) et, pour reprendre après une coupure, les requêtes `Range` acceptées et `Access-Control-Expose-Headers: Content-Length, Content-Range` ;
   - lien : `<adresse de l'app>?pack=<adresse directe du ZIP>`. Ouvert sur le téléphone, il télécharge le pack tout seul (en économie de données, un appui est demandé) ; garde l'app ouverte jusqu'à « Stations ajoutées ». L'adresse du pack n'est jamais écrite dans le dépôt ;
   - sans hébergement : copie le ZIP sur le téléphone, puis « Ajouter un pack » → « Depuis un fichier » ;
   - la lecture démarre seule à la fin de l'import et à l'ouverture de l'app (réglage « Lecture automatique », dans Atelier · Réglages) ; si le navigateur exige un geste, « Touche pour lancer la musique » s'affiche. Le bouton rond déploie ou replie le mini-lecteur ; la barre de progression est dans le panneau.

### Pas fait dans cette version, ou pas comme demandé

- **Véhicules** : quatre substituts modelés par le code, sous le niveau du concept (sportive un peu gonflée, flanc arrière du van austère, paillettes de la Cox encore grosses) ; le concept dépasse le budget d'appels de dessin (109 primitives pour 60) ; aucun niveau de détail réduit.
- **Menus** : les entrées Stickers, Carrosserie, Phares, Ailerons, Suspension, Moteur et Échappement sont affichées « bientôt », sans action. La règle « toutes les commandes dans le tiers bas » ne vaut plus que pour la personnalisation (cahier des charges, § 2). En menu compact, à l'étape Finition avec la taille de paillette, le menu dépasse du tiers bas.
- **Radio** : ouvrir un ZIP depuis la messagerie (cible de partage Android) n'est pas fait ; un téléchargement interrompu par la fermeture de l'app est à recommencer ; pas de normalisation du niveau sonore. Sur forfait mobile, le lien télécharge sans demander.
- **Moteur** : chiffres seulement ; ni pièces visibles, ni son, ni effet en sortie de nuit.
- **Vu sur le téléphone par le commanditaire** : l'import d'un pack de 423 Mo (3 à 4 minutes), l'enchaînement de la musique en arrière-plan, le menu agrandi. Le reste n'est éprouvé que par les parcours automatiques.
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
