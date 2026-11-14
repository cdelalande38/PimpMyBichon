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
# 1. Créer le dépôt privé
gh repo create PimpMyBichon-assets --private --description "Assets sous licence de PimpMyBichon"

# 2. Créer une clé de déploiement, sans phrase secrète
ssh-keygen -t ed25519 -N "" -C "pimpmybichon-assets" -f ./assets_deploy_key

# 3. Clé publique sur le dépôt privé (lecture seule par défaut)
gh repo deploy-key add ./assets_deploy_key.pub --repo <compte>/PimpMyBichon-assets --title "CI PimpMyBichon"

# 4. Clé privée en secret du dépôt public (à lancer depuis ce dépôt)
gh secret set ASSETS_DEPLOY_KEY < ./assets_deploy_key

# 5. Ne rien laisser traîner
rm ./assets_deploy_key ./assets_deploy_key.pub
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
└─ models/                modèles 3D sous licence
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
- la forme d'essai apparaît et tourne sous le pouce ;
- l'indicateur affiche « Hors ligne · tout est là » ;
- « Sous le capot » indique « Installée », la version attendue, et une cadence proche de 60 i/s après avoir fait tourner la forme.

Si ça coince, relève ce que dit « Sous le capot » (version, ligne « Hors ligne », ligne « Rendu 3D ») : c'est ce qu'il faut pour diagnostiquer.

## 5. Mise à jour de l'app installée

Une nouvelle version se télécharge en arrière-plan. L'app ne se recharge jamais toute seule : un bandeau « Nouvelle version de l'atelier prête » propose « Recharger ». Sans réponse, la nouvelle version s'applique au prochain lancement, une fois l'app complètement fermée.

## 6. Déboguer sur l'appareil

Téléphone branché en USB, débogage USB activé :

```bash
adb devices            # le téléphone doit apparaître
```

Puis ouvre `chrome://inspect` dans Chrome sur le poste : console, réseau, performances et service worker du téléphone sont accessibles.

## 7. Limites de GitHub Pages

- Site : 1 Go au maximum. Bande passante indicative : 100 Go par mois. Déploiement : 10 minutes au maximum.
- Pas d'en-têtes HTTP personnalisés : rien dans l'app ne doit dépendre de `SharedArrayBuffer`.
- `npm run assets:check` surveille le poids du site construit.

## 8. Revenir en arrière

- Le plus simple : `git revert <commit>` puis push. Le workflow republie la version précédente.
- Sans toucher au code : onglet **Actions**, ouvrir le dernier run vert, **Re-run all jobs**.

Les téléphones déjà installés recevront la version republiée comme une mise à jour ordinaire.
