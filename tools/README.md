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

« L'app » désigne `src/`, `public/` et `index.html`. Le prototype (`proto/`), la documentation, les outils et les tests ne sont concernés que par la famille c.

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
