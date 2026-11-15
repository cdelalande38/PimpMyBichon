# Contrôles automatiques du dépôt

Trois contrôles tournent en CI et se lancent à la main. Chacun passe sur un arbre sain et échoue (code de sortie 1) dès qu'une règle est enfreinte, avec un message qui dit quoi et où.

| Commande | Script | Ce qui est vérifié |
|---|---|---|
| `npm run guard` | `tools/guard.mjs` | requêtes vers un tiers, noms de marques, données personnelles et identifiants |
| `npm run assets:check` | `tools/assets-check.mjs` | sources lourdes, licences déclarées dans `CREDITS.md`, budgets de poids, structure des véhicules, triangles, appels de dessin et textures des GLB |
| `npm run audio:check` | `tools/audio-check.mjs` | synthèse dans la chaîne moteur et la radio, manifestes `engine.json`, licences des fichiers audio |

`npm run check` les enchaîne avec le typage, le lint et les tests. Ce mode d'emploi ne couvre que ces trois contrôles.

## Lancer un contrôle

```sh
node tools/guard.mjs                    # contrôle ce dépôt
node tools/guard.mjs --root <dossier>   # contrôle un autre arbre (les tests s'en servent)
node tools/guard.mjs --json             # sortie machine à la place de la sortie lisible
node tools/guard.mjs --help
```

Les trois scripts acceptent ces options ; le garde y ajoute `--add-brand` et `--brands`, décrites plus bas. Codes de sortie : `0` aucune erreur, `1` au moins une règle enfreinte, `2` mauvais usage de la commande ou erreur inattendue.

## Lire la sortie

Une ligne par constat, puis un bilan :

```text
chemin:ligne  règle  message
```

- `chemin` sans numéro de ligne : le constat porte sur le fichier ou le dossier entier. `(dépôt)` : il porte sur le dépôt.
- **Erreurs** : une règle est enfreinte, le contrôle échoue.
- **Avertissements** : à relire, sans faire échouer.
- **Notes** : ce qui a été contrôlé, les exceptions acceptées, et ce qui ne l'est pas encore (« non contrôlé à ce jalon : … »). Rien n'est réduit en silence.

Avec `--json`, la sortie est un objet `{ tool, ok, errors, warnings, notes }` ; chaque constat a la forme `{ file, line, rule, message }` (`line` vaut 0 pour un fichier entier, `file` est vide pour le dépôt).

## Ce qui est parcouru

- Jamais lus : `node_modules` et `.git` à toute profondeur ; à la racine du dépôt seulement, `dist`, `dev-dist`, `test-results`, `playwright-report`, `captures`, `coverage` et `.private-assets`. Un dossier du même nom rangé plus bas (dans `src/` ou `public/`) reste contrôlé.
- `dist/` n'est lu que par les règles qui le visent : hôtes externes du build (guard) et poids du site (assets-check).
- Les liens symboliques ne sont jamais suivis ; ils sont signalés.
- Un fichier qui contient un octet nul dans son début est tenu pour binaire : son contenu n'est pas lu.

## guard : garde-fous du dépôt public

« L'app » désigne `src/`, `public/`, `index.html` et `assets-src/` (dessins en attente, destinés à l'app). Le prototype (`proto/`), la documentation, les outils et les tests ne sont concernés que par la famille c.

### a. Requêtes vers un tiers

| Règle | Niveau | Ce qui la déclenche |
|---|---|---|
| `url-tierce` | erreur | dans l'app, toute URL absolue écrite en toutes lettres : avec schéma (`http`, `https`, `ws`, `wss`) ou sans (`//hôte/…`) |
| `hote-cdn` | erreur | dans `dist/`, un hôte de CDN que les bibliothèques web et 3D appellent d'elles-mêmes : polices, décodeurs de géométrie et de textures, environnements HDR, miroirs de paquets npm |
| `hote-externe` | avertissement | dans `dist/`, tout autre hôte externe : une ligne par hôte, avec un fichier d'exemple |

Seule exception écrite dans le code : les espaces de noms XML en `www.w3.org` (SVG, XLink, XHTML, MathML), que le navigateur n'appelle jamais. Leur liste est dans `tools/lib/third-party.mjs`, avec celle des hôtes de CDN. Les cartes de sources (`*.map`) de `dist/` ne sont pas lues. Sans `dist/`, une note le dit : lance le build, puis relance le garde.

Les bundles citent des pages de documentation sans effet : c'est pour cela qu'un hôte inconnu donne un avertissement et non une erreur. Relis la liste à chaque nouvelle dépendance.

### b. Noms de marques : règle `marque`

Aucun nom de constructeur automobile ou moto, d'équipementier, de sponsor, d'émission ou de jeu vidéo dans l'app : contenu des fichiers texte, noms de fichiers et de dossiers.

La liste d'interdits ne figure nulle part en clair dans le dépôt. `tools/guard-brands.sha256` contient une empreinte SHA-256 par ligne, celle du terme normalisé (minuscules, sans accents, espaces simples). Le scan découpe le texte en mots (aux espaces, à la ponctuation et aux frontières d'un identifiant : majuscules internes, chiffres, tirets, soulignés), normalise, puis compare l'empreinte de chaque suite de un, deux ou trois mots.

**Ajouter un terme interdit**

```sh
node tools/guard.mjs --add-brand "<terme>"
```

- La commande n'écrit que l'empreinte, et garde le fichier trié. Le terme lui-même ne doit apparaître ni dans le code, ni dans un test, ni dans ce mode d'emploi, ni dans un message de commit.
- Un terme fait un à trois mots, au moins trois caractères et deux lettres.
- Un terme à majuscule interne reçoit deux empreintes : découpé comme il s'écrit, et d'un seul tenant.
- L'option se répète pour ajouter plusieurs termes ; ils sont traités dans l'ordre.
- N'ajoute aucun terme qui soit aussi un mot courant français ou anglais, un prénom, ou un identifiant plausible dans le code d'une app 3D : il bloquerait du code légitime. En cas de doute, écarte-le.

**Retirer un terme** : le message d'erreur donne le début de l'empreinte du terme trouvé ; supprime la ligne qui commence ainsi dans `tools/guard-brands.sha256`.

**Dans les tests** : uniquement des termes inventés, passés par une liste temporaire (`hashesOf` dans `tests/unit/tools/helpers.ts`, ou `--brands <fichier>` en ligne de commande). Jamais une vraie marque.

### c. Données personnelles et identifiants

Sur tous les fichiers texte du dépôt, ligne par ligne, une erreur par occurrence. Les messages ne recopient jamais la valeur entière : la sortie finit dans des journaux de CI publics.

Dans ce tableau, L vaut pour une lettre capitale et C pour un chiffre.

| Règle | Ce qui la déclenche | Ce qui passe |
|---|---|---|
| `email` | une adresse e-mail | les domaines d'exemple (`example.com`, `example.org`, `example.net`), les extensions réservées aux essais (`.test`, `.invalid`, `.example`, `.localhost`), les adresses `noreply@…` et `no-reply@…`, le compte technique `git@…` des forges |
| `telephone` | un numéro français : `0C CC CC CC CC` (séparé par des espaces, des points, des tirets, ou d'un seul tenant), ou le même avec l'indicatif international de la France | les nombres décimaux, les suites de chiffres plus longues |
| `plaque` | une plaque française : `LL-CCC-LL`, ou l'ancien format `CCCC LL CC` | les minuscules, les références plus longues |
| `chemin-perso` | un chemin de dossier personnel : `/home/<nom>/`, `/Users/<nom>/`, ou son équivalent sous Windows ; la cible d'un lien symbolique est contrôlée aussi | les comptes génériques (`runner`, `user`, `username`, `node`, `ubuntu`, `vscode`, `shared`, `public`) |
| `cle-privee` | l'en-tête d'un bloc de clé privée au format PEM | les clés publiques et les certificats |
| `jeton-forge` | un jeton d'accès de forge logicielle, reconnu à son préfixe | un préfixe sans jeton derrière |
| `cle-api` | une clé d'API de service courant reconnue à sa forme, un jeton signé, ou une longue valeur d'allure aléatoire affectée à un nom qui annonce un secret | une valeur lisible, une variable d'environnement |

`package-lock.json` et les autres fichiers de verrouillage recopient des métadonnées de paquets tiers : la règle `email` ne s'y applique pas (une note le rappelle), les autres règles si.

### Poser une exception

Une exception se pose sur la ligne qui précède, dans un commentaire qui occupe sa ligne :

```text
guard-ignore-next-line <règle> : <raison>
```

- `<règle>` : l'identifiant de la règle à ignorer, parmi `url-tierce`, `marque`, `email`, `telephone`, `plaque`, `chemin-perso`, `cle-privee`, `jeton-forge` et `cle-api`.
- `<raison>` : obligatoire. Sans raison, sans les deux-points ou avec une règle inconnue, l'exception est refusée : c'est une erreur, et le constat qu'elle visait reste une erreur.
- Tous les styles de commentaire conviennent : `//`, `#`, `/* … */`, une ligne ` * ` d'un bloc, `{/* … */}` en JSX, `<!-- … -->` en HTML et en Markdown.
- Elle ne couvre que la règle nommée, et que la ligne suivante. Pour deux règles sur la même ligne, empile deux commentaires.
- Elle reste visible : chaque exception acceptée donne une note `exception` dans le rapport ; une exception qui ne couvre aucun constat donne un avertissement `exception-inutile`.
- La ligne de l'exception est contrôlée elle aussi : n'écris pas dans la raison ce que tu veux faire ignorer.
- Citée dans une phrase ou dans une chaîne de caractères, la directive n'a aucun effet.

Exemple, dans un composant qui affiche les crédits :

- ligne 1 : `// guard-ignore-next-line url-tierce : texte de licence affiché, jamais appelé`
- ligne 2 : la constante qui contient l'adresse de la licence.

Les règles d'`assets-check` et d'`audio-check`, ainsi que `hote-cdn` et `hote-externe`, ne connaissent pas d'exception : on corrige le fichier, ou on déclare sa licence.

### Ce que le garde ne voit pas

- Les requêtes dont l'adresse est calculée à l'exécution : seules les URL écrites en toutes lettres sont vues.
- Le contenu des fichiers binaires : nœuds et textures des GLB, métadonnées des images et des sons (`assets-check` mesure les GLB, mais le garde ne les lit pas).

## assets-check : assets et budgets

| Règle | Ce qui la déclenche |
|---|---|
| `extension-interdite` | un fichier `.blend`, `.blend1`, `.wav`, `.flac`, `.aif`, `.aiff`, `.psd`, `.kra` ou `.xcf`, où qu'il soit : les sources lourdes et les masters vivent hors du dépôt public |
| `licence` | un fichier de `public/assets/` (hors `.gitkeep`) qu'aucune ligne de `CREDITS.md` ne couvre, ou couvert par une licence hors liste |
| `poids-fichier` | un fichier du dépôt de plus de 25 Mo |
| `poids-vehicule` | un dossier `public/assets/vehicles/<id>/` de plus de 15 Mo, toutes variantes comprises |
| `poids-decor` | `public/assets/garage/` de plus de 10 Mo, ou `public/assets/city/` de plus de 12 Mo |
| `poids-site` | `dist/` de plus de 1 Go (limite de l'hébergeur) ; en dessous, une note donne le total et les cinq plus gros fichiers |
| `vehicule` | un dossier de véhicule sans `vehicle.json` (JSON valide, champ `id` égal au nom du dossier), sans `body.glb` ou sans `thumb.webp`, ou dont l'un de ces deux fichiers est vide |
| `lien-symbolique` | avertissement : un lien symbolique sous `public/`, dont la cible échappe aux contrôles |

Les mégaoctets sont décimaux (1 Mo vaut un million d'octets) : c'est la lecture la plus stricte des budgets. Dossier absent, aucun véhicule, pas de `dist/` : une note le dit, sans erreur.

### Budgets des modèles GLB

Chaque `.glb` sous `public/assets/` est lu en Node pur (en-tête, bloc JSON, bloc binaire ; `tools/lib/glb.mjs`) et reçoit une note chiffrée : triangles, primitives, maillages, nombre de textures, plus grande texture, part de KTX2, poids.

- **Triangles** : somme sur les primitives en mode triangles (indices divisés par 3, ou sommets divisés par 3 sans indices) ; une bande ou un éventail compte n - 2 ; points et lignes n'en comptent pas.
- **Appels de dessin** : une primitive vaut un appel, tous maillages du fichier confondus. C'est un majorant : les instances et la fusion à l'exécution ne sont pas simulées.
- **Textures** : les images du JSON, avec leurs dimensions lues dans l'en-tête de l'image (KTX2, PNG, JPEG, WebP), qu'elle soit embarquée, en URI de données ou dans un fichier voisin du GLB.

| Règle | Où | Ce qui la déclenche |
|---|---|---|
| `modele` | tout `public/assets/` | GLB illisible (en-tête absent, version autre que 2, fichier ou bloc tronqué, JSON invalide) : erreur. Un fichier vide est refusé par `vehicule`, sans doublon |
| `modele-triangles` | véhicules : erreur ; banc d'essai : avertissement | plus de 400 000 triangles dans un fichier |
| `modele-appels` | idem | plus de 80 primitives dans un fichier |
| `modele-texture` | idem | une texture de plus de 2048 px, de largeur ou de hauteur ; avertissement partout si des dimensions n'ont pas pu être lues |
| `modele-format` | avertissement | une texture qui n'est pas en KTX2 |

« Véhicules » : `public/assets/vehicles/**`, variantes comprises. « Banc d'essai » : `public/assets/bench/**`, substitut déclaré, qui reçoit les mêmes seuils en avertissements. Les autres dossiers (garage, route) sont mesurés et lisibles, sans seuil. Les seuils sont dans `MODEL_LIMITS` (`tools/lib/models.mjs`).

Non contrôlé à ce jalon : budgets de triangles et de draw calls des décors (garage, route), textures de 1024 px hors caisse et atlas, appels de dessin réels à l'exécution (instances, fusion).

### Format de `CREDITS.md`

`CREDITS.md`, à la racine, déclare la licence de chaque fichier embarqué dans un tableau Markdown :

```md
| Fichier(s) | Origine | Auteur | Licence | Date | Note |
|---|---|---|---|---|---|
| `public/assets/stickers/**` | dessinés pour le projet | projet PimpMyBichon | création projet | 2026-11-14 | planche de stickers |
| `public/assets/garage/sol.glb`, `public/assets/garage/mur.glb` | banque de modèles libres | nom de l'auteur | CC0-1.0 | 2026-11-14 | |
```

- **Fichier(s)** : un ou plusieurs chemins ou motifs **entre accents graves**, relatifs à la racine du dépôt. Une ligne sans accent grave ne couvre rien (avertissement).
- **Licence** : l'une des licences admises dans un dépôt public, et rien d'autre dans la cellule : `CC0-1.0`, `CC-BY-4.0`, `OFL-1.1` ou `création projet`. La casse, les accents et la ponctuation ne comptent pas (« CC BY 4.0 » convient) ; un lien Markdown est lu par son libellé.
- Les autres colonnes sont libres : elles servent à la traçabilité (source, auteur, date d'entrée, preuve d'abonnement pour la musique générée).

Motifs reconnus, sensibles à la casse :

| Motif | Ce qu'il couvre |
|---|---|
| `dossier/fichier.ext` | ce fichier |
| `dossier` ou `dossier/` | tout le contenu du dossier |
| `*` | n'importe quoi dans un seul nom de fichier ou de dossier |
| `**` | n'importe quelle suite de dossiers, y compris aucun |
| `?` | un caractère, sauf la barre oblique |
| `{a,b}` | l'une des variantes, sans imbrication |

La lecture est tolérante :

- l'ordre des colonnes est libre : la colonne des chemins est repérée par son en-tête (« Fichier(s) », « Chemin » ou « Motif » ; à défaut, c'est la première), celle des licences par « Licence » ;
- un tableau sans colonne « Licence » est ignoré, et plusieurs tableaux peuvent se suivre dans le fichier ;
- les blocs de code et les commentaires HTML ne déclarent rien : un exemple de format n'est pas une déclaration.

Deux règles à connaître :

- un motif large ne rattrape pas une licence refusée : si deux lignes couvrent un fichier, les deux doivent porter une licence admise ;
- si `CREDITS.md` est absent, chaque fichier de `public/assets/` est une erreur ; s'il n'y a rien à couvrir, une simple note.

## audio-check : audio

| Règle | Niveau | Ce qui la déclenche |
|---|---|---|
| `synthese` | erreur | dans `src/audio/engine/` et `src/audio/radio/`, l'un des noms `createOscillator`, `OscillatorNode`, `createPeriodicWave`, `PeriodicWave`, `createConstantSource` ou `ConstantSourceNode` |
| `synthese` | avertissement | les mêmes noms ailleurs dans `src/`, le reste de `src/audio/` compris : vérifie que ce son n'est ni un moteur ni une musique |
| `manifeste-moteur` | erreur | un `engine.json` sous `public/assets/` qui n'est pas du JSON valide |
| `licence` | erreur | un fichier `.mp3`, `.ogg`, `.opus`, `.m4a`, `.aac` ou `.weba` sous `public/` sans ligne de licence admise dans `CREDITS.md` (même lecture que pour `assets-check`) |
| `lien-symbolique` | avertissement | un lien symbolique sous `src/` ou `public/` |

- La recherche de la synthèse est textuelle, sans analyse du code. Un accès par crochets avec une chaîne littérale est vu, même déguisé par un échappement ; un commentaire qui cite le nom est signalé lui aussi. Un nom assemblé à l'exécution ne l'est pas.
- Tant qu'un fichier réel manque, l'emplacement reste muet et figure dans `TODO_ASSETS.md` : on ne le comble pas par un oscillateur.
- La musique et les sons de banque ne vont jamais dans le dépôt public : ils vivent dans le dépôt privé d'assets.
- Dossiers absents : une note « 0 fichier contrôlé », code 0.

Non contrôlé à ce jalon : niveaux (LUFS, crête vraie), formats et points de bouclage, complétude des jeux de sons moteur (jalon 9).

## Code et tests

- `tools/<nom>.mjs` ne fait que lire la ligne de commande ; la logique vit dans `tools/lib/*.mjs`, sous forme de fonctions qui retournent `{ errors, warnings, notes }`.
- ESM Node pur, typé par JSDoc (`// @ts-check`), sans dépendance hors bibliothèque standard, compatible Node 20.19.

| Fichiers de `tools/lib/` | Rôle |
|---|---|
| `cli.mjs`, `report.mjs` | arguments, affichage et code de sortie ; constats et rapport |
| `fs-walk.mjs`, `text.mjs`, `glob.mjs` | parcours de l'arbre, lecture des fichiers texte, motifs de chemins |
| `guard.mjs`, `third-party.mjs`, `brands.mjs`, `secrets.mjs` | le garde et ses trois familles de règles |
| `credits.mjs`, `assets.mjs`, `audio.mjs` | lecture de `CREDITS.md`, contrôle des assets, contrôle audio |
| `glb.mjs`, `models.mjs` | lecture d'un conteneur GLB (comptages, dimensions d'images) ; budgets des modèles |

Les tests sont dans `tests/unit/tools/` et travaillent sur des arbres temporaires :

```sh
npx vitest run tests/unit/tools
npx tsc -p tsconfig.node.json
npx eslint tools tests/unit/tools
```

Le garde contrôle aussi ses propres sources et ses tests : les chaînes sensibles y sont fabriquées à l'exécution (voir `fake` dans `tests/unit/tools/helpers.ts`), jamais écrites en clair.

## Œuvres du garage : fabrication, copie servie, contrôle

Hors des trois contrôles ci-dessus. Les œuvres originales du garage sont produites dans `assets-src/garage/` (mode d'emploi : `assets-src/garage/LISEZ-MOI.md`) ; l'app ne lit que leur copie servie.

```sh
node assets-src/garage/outils/fabriquer.mjs   # écrit et contrôle les SVG, puis copie les œuvres servies
npx vite --port 5193 --strictPort             # serveur de développement (autre terminal)
node assets-src/garage/outils/capturer.mjs --detail   # captures/deco/oeuvres.png et oeuvres-detail.png
npx vitest run tests/unit/oeuvres.test.ts
```

- **Copie servie** : chaque œuvre qui passe les contrôles et n'est pas marquée `servie: false` (les deux enseignes néon, qui deviennent des tubes) est copiée octet pour octet dans `public/assets/garage/art/<id>.svg`. Aucune copie si une œuvre échoue ; un SVG de ce dossier qui ne correspond plus à aucune œuvre est retiré. Précachée par le motif `svg` de `vite.config.ts` (≈ 92 ko, 22 ko compressés).
- **Registre** : `src/data/garageArt.ts` (fichier, viewBox et rapport, taille réelle, matière, teinte d'attente, résolution de texture, place prévue, cases des planches). Chargement en texture : `acquireArtwork` de `src/scene/garage/artwork.ts`.
- **Test** : `tests/unit/oeuvres.test.ts` vérifie que chaque entrée a son fichier, copie exacte de sa source, que rapport et taille suivent le viewBox, et que les fichiers servis n'ont ni texte, ni image, ni lien externe et pèsent 40 ko au plus.
- **Page de contrôle** : `src/dev/oeuvres/index.html` (hors de l'app livrée, servie par le serveur de développement) pose chaque œuvre et chaque case à sa taille réelle sous une lumière ambiante neutre ; `?echelle=<px par mètre>&centre=<id ou id#case>` pour cadrer de près.

## Coupe caméra : planches du tour du véhicule

Hors des trois contrôles ci-dessus. `tools/captures/orbite.mjs` fait le tour du véhicule sur le site construit et range des planches de contrôle de la coupe caméra (le décor qui passerait devant le véhicule quitte l'image, `src/scene/garage/cut.ts`).

```sh
npm run build                                   # ou npx vite build
node tools/captures/orbite.mjs                  # captures/jalon-1/orbite/apres-*.jpg
node tools/captures/orbite.mjs --prefix essai --out captures/autre --port 4180
```

- **Quatre planches** de douze vues (un tour complet chacune, portrait 390 × 844) : `-depart` (distance et hauteur de départ), `-recul` (recul maximal), `-haut` (recul maximal en plongée), `-pres-bas` (caméra basse, au plus près). Sur chaque vue, le véhicule entier et son reflet doivent être dégagés ; rien ne flotte (un objet retiré emporte ce qu'il porte, son œuvre et son ombre de contact) ; les retombées et leurs spots restent sur les murs du fond quand la caméra recule.
- **Préfixes déjà rangés** : `avant` (garage d'origine, sans coupe), `apres` et `apres2` (coupe caméra), `deco` (mobilier remodelé, œuvres, néons en tubes, ombres de contact).
- **Relevé** `<préfixe>-coupe.json` : pour chaque planche, le nombre d'éléments du décor retirés à chaque vue (attribut `data-coupe` de la scène).
- Le script lance `vite preview` sur le port donné (4179 par défaut) et le Chromium de Playwright en rendu logiciel, avec les arguments de `playwright.config.ts`. Compter une vingtaine de minutes ; lancer un seul tour à la fois sur une machine partagée.
- Les preuves chiffrées de la coupe sont dans `tests/unit/coupe.test.ts` (règles, garde-fou de structure, balayage de 2 170 positions d'œil vérifié par lancer de rayons, sources de nuanceur sans `discard` hors du define `PMB_CUT_DITHER`, règle « quel matériau porte la trame ») et `tests/e2e/coupe.spec.ts` (glissés, fondu, repos sans dessin, trame seulement pendant le fondu, aucun programme compilé ni aucune requête GL de premier usage — journal de liaison, emplacements des uniformes — pendant les images du premier fondu ; attributs `data-trame`, `data-trame-pret` et `data-programmes` de la scène). Les variantes « trame » ne sont préparées que pour les matériaux opaques qui dessinent au moins un élément de la coupe ; leur premier usage est fait hors des images (`primeCutDither`, `src/render/cutDither.ts`).

## Cadence : temps de carte graphique par image

Hors des trois contrôles ci-dessus. La ligne « Cadence » de « Sous le capot » est plafonnée par l'écran (60 i/s) : elle ne dit rien d'une carte qui a de la marge. `tools/captures/cadence.mjs` relève, image par image pendant la rotation lente, le **temps de carte graphique** (requête de minuterie `TIME_ELAPSED` d'`EXT_disjoint_timer_query_webgl2`), les appels de dessin, les triangles et les programmes de nuanceur vivants, sur un ou plusieurs sites construits.

```sh
npx vite build                                                     # dist/ de ce dépôt
node tools/captures/cadence.mjs                                    # ce dépôt, Standard et Max, 3 séries
node tools/captures/cadence.mjs --root /chemin/avant --root . --label avant --label apres --repeat 4
node tools/captures/cadence.mjs --levels max --frames 1000 --repeat 1 --out captures/cadence/essai.json
node tools/captures/cadence.mjs --root /chemin/avant --root . --levels standard --repeat 2 --detail
node tools/captures/cadence.mjs --root /chemin/avant --root . --tour images --tour temps --label avant --label apres
```

- **Racines** : `--root <dossier>` désigne un dossier qui contient `dist/` (défaut : ce dépôt), répétable ; `--label` nomme chaque racine (défaut : nom du dossier). Une ancienne version se prépare par `git archive <commit> | tar -x -C <dossier>`, un lien `node_modules` vers celui du dépôt, puis `npx vite build` dans ce dossier.
- **Serveur** : intégré, une racine par port à partir de `--port` (4321 par défaut), sous `/PimpMyBichon/` comme GitHub Pages ; service worker bloqué (pas de précache pendant la mesure).
- **Page** : Chromium de Playwright sur la vraie carte (ANGLE sur OpenGL ES : `--use-angle=gl-egl --ignore-gpu-blocklist --enable-gpu`), 412 × 915 à densité 2 (rendu de 824 × 1830 px, proche du téléphone de référence), mouvement non réduit. Une série = une page neuve : niveau choisi dans les réglages, rechargement, la rotation lente repart de la vue de départ.
- **Relevé** : crochets posés avant le code de l'app (aucune aide de sa part, donc valable sur une ancienne version) : une requête de minuterie autour de chaque rappel `requestAnimationFrame` qui dessine, appels et triangles comptés sur `drawElements`/`drawArrays`, programmes comptés sur `createProgram`/`deleteProgram`. On attend le véhicule posé, on saute `--skip` images (120), puis on garde un tour entier de rotation lente (la médiane ne dépend donc pas de l'instant de départ) : au temps (`--tour temps`, défaut : 66,7 s de rotation, écarts entre images dessinées bornés à 0,1 s comme l'app, quelle que soit la cadence) ou en images (`--tour images`, versions jusqu'à 8dc262f, où la rotation avançait d'un angle fixe par image : 4 000 images). Un `--tour` par `--root`, dans l'ordre. `--frames <n>` impose n images à toutes les racines (essai court). Contrôlé par l'azimut réel : 359,6° à 58 i/s, 357,1° à 43 i/s.
- **Bruit** : `--repeat` séries par racine et par niveau (3), ordre des racines inversé une série sur deux. La synthèse donne la médiane des médianes de série, et le bruit comme demi-étendue de ces médianes. Relever aussi `uptime` : sur un poste chargé (rendu logiciel d'autres parcours), le temps de carte monte de quelques pour cent ; refaire la série finale au calme.
- **Détail** : `--detail` ajoute au JSON, par série, chaque image `[rang, angle en degrés depuis la première image gardée, temps de carte en ms, appels, matériaux en trame]` (« matériaux en trame » vaut −1 sur une version qui n'expose pas `data-trame`). Sur ce poste, une même fenêtre d'angle varie de ± 1 ms d'une série à l'autre (perturbations passagères) : comparer des médianes de série, pas des fenêtres isolées.
- **Sortie** : une ligne par série pendant la mesure, puis une ligne par racine et par niveau (`médiane … ms (± bruit) · p90 … · appels · triangles · programmes · véhicule posé à … s`) ; relevé complet en JSON (`--out`, défaut `captures/cadence/cadence-<date>.json`) : par série, médiane, neuvième décile, moyenne et maximum du temps de carte, appels, triangles, programmes, images par seconde, fréquence de la carte (Intel, sysfs), instants de démarrage (première image, véhicule posé, trame de la coupe prête si la version l'expose), attributs de `.stage`.
- **Limites** : une carte de bureau ne reproduit pas forcément le coût d'une carte de téléphone (tuiles, test de profondeur précoce) : ce relevé compare des versions sur ce poste, il ne prédit pas la cadence d'un Adreno. `--logiciel` passe en rendu logiciel (pas de minuterie : seuls appels, triangles et programmes ont un sens). Compter environ une minute et demie par série.

### Sur le téléphone : « Comparer »

« Sous le capot », bouton « Comparer » (à côté de « Mesurer ») : cinq variantes de la scène au niveau en cours, mesurées chacune deux fois, à l'aller puis au retour (A B C D E, puis E D C B A), en 33 s environ sans toucher à rien. Une dérive régulière (chauffe, fréquences) s'annule dans la moyenne des deux passages, et leur écart dit le bruit de l'essai. Chaque fenêtre attend que les nuanceurs soient prêts et que le nombre de programmes ne bouge plus, puis un temps de pose (2,5 s la première fois, le temps que les fréquences remontent, 0,5 s ensuite) et 2,5 s de rotation. Un nuanceur compilé, un écran retaillé (pixel ratio remis par le Canvas, téléphone tourné) ou la trame en préparation relancent la fenêtre ; au-delà de trois reprises, la variante est notée « non mesurée » avec la vraie raison, et son retour n'est pas tenté. Les cinq : **Réglage en cours** ; **Trame partout** (trame posée sur tous les matériaux opaques du décor, dans l'ordre de dessin actuel : ce n'est pas exactement l'état d'avant `8dc262f`, qui dessinait dans l'ordre par défaut et tramait aussi les voiles transparents) ; **Sans reflet du sol** ; **Sans mobilier** (groupes `garage_mobilier`, `garage_oeuvres` et `garage_contact` cachés : le poids du décor remodelé ; la coupe continue de décider pour eux, et la sonde, si elle se refait pendant la mesure, les voit quand même) ; **Densité 1**.

Dans chaque fenêtre, sur les mêmes images : la cadence (intervalles entre les horodatages `requestAnimationFrame`, calés sur l'écran), le temps de carte (une requête `TIME_ELAPSED` de `EXT_disjoint_timer_query_webgl2` encadre chaque image, du début du calcul à la fin de la chaîne d'image ; résultats lus une à trois images plus tard, images « disjointes » écartées, médiane par fenêtre ; rien si le navigateur ne donne pas la minuterie, ou si un outil en a déjà une en cours), le temps « processeur » (fil principal par image) et les appels. Chaque ligne donne la moyenne des deux passages, l'écart au réglage en cours (« dans le bruit » s'il ne dépasse pas le bruit de l'essai) et l'écart aller-retour. Bruit de l'essai : le plus grand écart aller-retour d'une même variante, pour la cadence et pour la carte ; au-delà de 10 % de la valeur du réglage en cours (0,5 ms au moins), l'état conseille de recommencer (la cadence ne compte pas quand le réglage en cours est au plafond de l'écran). Rythme de l'écran : estimé sur les horodatages (plus longue période de 50 à 165 i/s dont 90 % des intervalles sont des multiples) ; une ligne dont la cadence l'atteint à 97 % est marquée « au plafond de l'écran ». Limite : un écran à 120 i/s dont toutes les images prennent exactement deux périodes est pris pour un écran à 60 i/s.

Abandon si le panneau se ferme, l'onglet se cache, le contexte WebGL se perd, le mode photo s'ouvre, le niveau change ou la scène s'arrête ; tout revient à l'état d'origine (pixel ratio, reflet du sol, mobilier, trame), et aucune ligne n'est gardée tant qu'aucune variante n'a fini ses deux passages. Logique pure : `stepCompare`, `combinePasses`, `readCompare`, `estimateScreen` (`src/render/frameMeter.ts`, `tests/unit/mesure-comparee.test.ts`) ; parcours : `tests/e2e/mesure.spec.ts`.

Pourquoi la minuterie de la carte et pas la lecture d'un pixel : un « coût d'une image » mesuré en forçant la fin du travail de la carte (`gl.readPixels` d'un pixel en fin d'image) a été essayé (correction E, 15 novembre). Il met processeur et carte bout à bout : sur la carte du poste, ses écarts entre variantes s'éloignaient de ceux de la minuterie de 1,5 à 4,8 ms (« Sans reflet du sol » retire aussi 2 à 3 ms de processeur). Il n'est donc pas affiché. La minuterie de l'app, comparée à celle de `tools/captures/cadence.mjs` sur des images alternées des mêmes fenêtres, donne les mêmes écarts entre variantes à 1 ms près en Standard (0,3 à 0,8 ms sur 4 essais), et à 0,9 à 1,9 ms en Max sous une charge de 13 à 20 (signes changeants : bruit, pas biais).

## Formes du décor : studio de contrôle

Hors des trois contrôles ci-dessus. Le vocabulaire de formes du décor (`src/data/garageShapes.ts`) se construit par `shapeGeometry` de `src/scene/garage/shapes.ts` : repères, sens des contours, budgets de triangles et un exemple par forme sont écrits en tête de ce fichier. `tools/captures/studio.mjs` photographie une planche de pièces du studio (`src/dev/studio/`, page de développement absente du build).

```sh
node tools/captures/studio.mjs salon garage --port 5201            # une famille du mobilier : captures/deco/salon-garage.png
node tools/captures/studio.mjs canape-a studio --port 5201 --out captures/deco/salon   # un objet seul
npx vitest run tests/unit/mobilier.test.ts                         # noms, matériaux, œuvres, place, budgets par famille et des néons, recoupements bornés, connexité des pièces
```

- **Mobilier** : planches toutes faites, tirées de `src/data/garageProps/*.ts` (rien à déclarer) : une par famille (`salon`, `atelier`, `engins`, `loisirs` : tous ses objets côte à côte, étiquette « nom · triangles ») et une par objet (nom sans `placeholder_`, tirets : `canape-a`, `moto-sportive`, `panneau-cible`…). Vraies matières de `GARAGE_MATERIALS` (cartes comprises), œuvres posées (`art`) avec leur dessin, réglées comme au garage (`artworkMaterial` et `ART_GAP` de `src/scene/garage/artwork.ts` : œuvres découpées sans aplat). Pas d'assombrissement de pied ni de tache de contact : ils n'existent qu'au garage (`src/scene/garage/build.ts`). Un objet adossé est tourné pour montrer sa face côté pièce ; tous sont posés au sol du studio.
- **Capture** : 1600 × 1000, écrite dans `<dossier>/<planche>-<éclairage>.png` (`--out <dossier>`, `captures/deco` par défaut) ; une option de vue ajoute son suffixe (`-a60`, `-c0-5`, `-damier`). Le script lance le serveur de développement sur le port `--port <n>` (5191 par défaut ; ou réutilise celui qui y tourne), le Chromium de Playwright en rendu logiciel avec les arguments de `playwright.config.ts`, attend l'attribut `data-studio-pret` de la page (posé quand les dessins des œuvres sont arrivés ; 60 s au plus), puis arrête le serveur qu'il a lancé, et lui seul. Plusieurs captures en même temps : un port chacune (modeleurs : 5201 à 5204). Une dizaine de secondes par capture.
- **Éclairages** : `studio` (environnement neutre, une lumière principale) ou `garage` (bande bleu-violet à gauche, rouge à droite, environnement sombre). Sol sombre légèrement brillant, caméra de trois quarts cadrée sur la planche.
- **Autres planches** : `formes` (toutes les formes et variantes) et `exemples` (canapé en coussins, roue, casque), par exemple `node tools/captures/studio.mjs formes studio --cadre=0-5 --azimut=60 --damier`.
- **Options** : `--azimut=<degrés>` tourne la caméra (20 par défaut, 0 = de face) ; `--cadre=<i>-<j>` cadre les pièces de rang i à j pour les voir de près ; `--damier` pose un damier de 10 cm (ligne rouge au mètre) sur toutes les pièces pour juger les coordonnées de texture.
- **Page à la main** : `npx vite --port 5191 --strictPort`, puis `/PimpMyBichon/src/dev/studio/index.html?planche=formes&eclairage=garage` ; souris pour tourner autour.
- **Ajouter une planche** : un fichier dans `src/dev/studio/planches/` qui exporte `planches` (nom → liste de pièces : forme, position, rotation, couleur, rugosité, métal, étiquette ; ou `materiau` du garage, `objet`, `oeuvre`). Outils de `src/dev/studio/registre.ts` : `grille` range des pièces isolées sur le sol, `objet` pose un objet composé (décalage et lacet). Planches fournies : `formes` (toutes les formes et variantes, étiquetées avec leur nombre de triangles) et `exemples` (canapé en coussins, roue, casque).
- **Test** : `tests/unit/formes.test.ts` vérifie chaque forme et ses variantes (nombres finis, normales unitaires et du côté de la face, boîte englobante, budget, surface fermée et tournée vers l'extérieur, volume, coordonnées de texture en mètres), la fusion de toutes les formes, les paramètres refusés, et que les formes d'origine se construisent comme le faisait `partGeometry`.
