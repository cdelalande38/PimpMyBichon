# Suivi du projet : demandes, état, suite

Document de passation, tenu à jour à chaque étape. Il dit, pour quelqu'un qui arrive à froid : ce que le commanditaire a demandé (avec ses mots), ce qui est en ligne, ce qui reste faux dans ce qui est livré, et ce qui vient. Le détail technique de chaque lot est dans le message de son commit ; les règles de travail sont dans `CLAUDE.md` ; le périmètre est dans `CAHIER_DES_CHARGES.md` (§ 5.5 pour la sortie, § 11 pour ce que la publication attend) ; les substituts et ce qui manque sont dans `TODO_ASSETS.md`.

Dernière mise à jour : 19 novembre 2026, 19 h 45.

## 1. Où on en est

- **En ligne** : `4f71f0c` (vérifié sur le site à 19 h 45). Poussé à 19 h 41 : `7b4f566` (départs, « Conduite assistée », stickers), CI en cours.
- **Prêt en local, validé** : le lot « prepa » (préparation moteur payante) ; publication à 20 h 41 au plus tôt.
- **En cours** : « duel3 » (restes du duel) et « nos2 » (restes du NOS), agents Opus lancés à 18 h 46 ; « fonds » (fonds des écrans de chargement), agent Opus lancé à 19 h 40.

## 2. Journal des demandes

### Soir du 19 novembre

| Demande (ses mots) | Ce qui a été livré | Commit |
|---|---|---|
| « Direction à renommer en conduite assistée » | Le réglage s'appelle « Conduite assistée », choix « Oui » et « Non » | `59b38d2` |
| « il faudra revoir les distances de circuit annoncés dans les menu ca affiche 0km parfois c'est juste pas possible » | Chaque départ affichait sa borne kilométrique (« km 0,0 » pour le premier) : il dit maintenant la distance jusqu'à l'arrivée, ou la longueur du tour sur un circuit | `59b38d2` |
| « un élément à fixer ca sera pour la configuration des stickers j'ai l'impression qu'on a pas toutes les options visibles par exemple je peux pas en supprimer » | Les gestes du sticker (dont « Supprimer » et « Curseurs ») étaient au bout d'une rangée qui défilait de côté, hors de l'écran : ils ont leur propre rangée, qui passe à la ligne | `7b4f566` |
| « les préparation moteur ca doit etre payant » | Chaque option de la fiche de préparation (hors « Origine ») est un article, valable pour tous les véhicules : Stage 1 à 3 à 120, 220, 350 $ ; carburation à 80, 160, 260 $ ; nitro à 100, 200, 320 $. Une option déjà montée dans une sauvegarde reste montée et agit ; elle garde son cadenas (règle commune des panneaux) | (ce commit) |
| « pour les écrans de chargement il faudra générer des fonds (fond général de chargement de l'application, fond pour chaque lieux de courses) » | Source choisie par lui : des rendus de nos propres scènes par le jeu. Lot « fonds » prêt, lancé quand une place se libère ; images montrées avant d'être versées | — |
| « traite les reste du del en prio puis NOS puis rodéo puis cartes puis vehicules » | Ordre de la file (§ 4) ; lots « duel3 » et « nos2 » en cours | — |

### Soirée et nuit du 18 au 19 novembre : six lots publiés dans la nuit

| Demande (ses mots) | Ce qui a été livré | Commit |
|---|---|---|
| « pouvoir ouvrir le capot au garage et même en conduite pour voir notre moteur custom, ou un capot en option qui laisse voir le moteur » | Capot moteur de la Cox : il s'ouvre au garage, se pose vitré ou se dépose ; le moteur de l'établi est dans la voiture ; « Sous le capot » dans Mécanique · Moteur | `d047d22` |
| « L'écran de fin de courses en paysage est pas optimisé […] retirer le bouton aller au garage depuis les écrans de chargement […] un bouton pour accéder directement à la course suivante » | Fin de course sur deux colonnes en paysage, « Course suivante » en carrière, chargement sans bouton | `3fbd2cd` |
| « Il manque les néons dans les customisation, les intérieur led etc même dans le concept je veux pouvoir custom l'intérieur » | Custom · Néons par zone, LED d'habitacle, intérieur du concept (teintes, ciel étoilé, LED) | `2c34cbf` |
| « le bouton de freins devrait permettre de faire des drifts. Les drift donnent des points » | Glisse au frein, points, format « Drift » | `b31da55` |
| « J'ai déjà terminé le mode carrière avec les 12 courses. Il faut ajouter du challenge […] une suite a ce mode carrière » | Carrière en saisons ; saison 2 : douze rendez-vous plus durs, avec contraintes | `ba7298b` |
| « On a toujours un mode course contre une IA en attente » | Duel contre un adversaire piloté par le jeu | `c97e0f4` |

### Journée du 19 novembre : ses retours après essai sur téléphone

| Demande (ses mots) | Ce qui a été livré | Commit |
|---|---|---|
| « déplacer le joysticks de départ en ba a gauche c'est plus naturel. Et […] pouvoir utiliser des touche clavier pour piloter » | Repère du manche en bas à gauche en paysage ; pilotage au clavier (flèches ou Z Q S D, Espace : NOS, Entrée : partir) | `95737b8` |
| « Le mode drift ne permet pas de drifter […] automatiquement désactiver la direction assistée si on fait une course en mode drift […] le score occulte souvent en 0, 2 et et perdu […] le même bug qui fait l'effet de tremblement » | Direction libre d'office en Drift ; compteur qui ne clignote plus au trottoir ; tremblement corrigé ; ligne d'aide au départ. Le geste n'a pas changé, à sa demande | `2662f34` |
| « Petit bug visuel des néon côté roues et en jeu le visuel des neon au sol est un peu carré pas assez en mode diffusion de lumière » | Arcs des passages de roue ancrés à la carrosserie ; lueur au sol qui se diffuse | `5920f18` |
| « dans le mode duel il faudra des niveaux de difficulté et que les véhicules adverse utilisent la puissance de leurs véhicules […] Attention à la ligne départ […] bien aligné » | L'adversaire court en temps réel ; trois difficultés ; cinq adversaires ; grille mesurée sur les seize départs | `45547c0` |
| « améliorer l'effet de boost lorsqu'on envoie le NOS […] un effet d'accélération, des flammes bleues » | Dards bleus à l'échappement, lueur sur la chaussée, champ qui s'ouvre, traits de vitesse, bouton NOS qui bat | `6394e93` |
| « [la direction assistée] ca doit être désactivé par defaut en drit mais activé par defaut piour les autres modes » | Direction assistée par défaut hors Drift ; au passage, Espace reste le NOS quand un bouton a gardé le focus | `6f20f20` |
| « le bouton sortir ca fait penser à quitter l'app, il faut le renommer en jouer » | « Jouer » au bout du menu de la sortie et sur la fiche de carrière (**pas encore publié**) | `9daa1d9` |

### Demandes notées, pas encore commencées

| Quand | Demande (ses mots) |
|---|---|
| 18 nov. | « des cartes sur des sections ligne droites en VS en mode accélération pure avec Nos, on place le Nos et des passages de rapport au bon moment […] (mode rodéo) » |
| 18 nov. | « on pourrait imaginer de nouvelles cartes spéciales drift » |
| 18 nov. | Cartes : « Paris sur le long de la seine avec les monuments […] l'Italie avec rome, pise. Des circuits […] connus » |
| 18 nov. | Véhicules : « de type hotroad, un buggy, un 4x4 » (un gros tout-terrain générique, sans nom de marque) |
| 17 nov. | « continuer d'améliorer les textures des maps » (demande de fond) |
| 19 nov. | Cartes : « moscou, tokyo, muraille de chine, milan, australie, US route 66 » |
| 19 nov. | Véhicules : reprendre des modèles 3D déjà faits, comme pour le concept ; « des camions transport, des camion transport execptionnel […] dans les camion on custom souvent les cabine à fond » |

Les demandes plus anciennes (menu par étapes, carrière, gains, préparation, vue intérieure, stickers, établi moteur…) sont livrées : voir `CAHIER_DES_CHARGES.md` § 11 et l'historique git.

## 3. Ce qui reste faux ou non vérifié dans ce qui est livré

Rien de ce qui suit n'a été vu sur un téléphone par celui qui l'a écrit : tout a été vérifié en rendu logiciel.

- **Duel** : l'adversaire serré contre son bord saute d'un coup derrière le joueur (`src/drive/adversaire/contact.ts`) ; le dépassement n'est pas retravaillé ; il est muet et n'a pas de NOS ; la grille en quinconce (deux véhicules larges sur route étroite) est mesurée, pas photographiée ; coût : environ 25 appels de dessin de plus, non mesuré sous la pluie.
- **Drift** : sans coup sec sur le frein, seul le concept glisse, et sous la pluie seulement ; les paliers des médailles ont bougé de −39 % à +59 % au dernier recalcul et l'or reste calé sur un pilote simulé ; Monaco est étroit pour glisser ; en portrait la ligne d'aide touche la mini-carte ; pas de record de score par carte.
- **NOS** : pas de flammes sur le concept ni le van (aucune sortie d'échappement déclarée dans leur manifeste) ; vues de dos les flammes sont deux gerbes plutôt qu'un dard ; de jour les traits de vitesse se voient peu ; la Cox gagne à peine en vitesse pendant la poussée (réglage de la poussée, hors du lot de rendu) ; temps d'image non mesuré.
- **Néons** : les arcs des roues sont un liseré fin, presque caché quand le pneu remplit l'arche ; celui du van se voit à peine (sa voûte modelée est plus basse que le jeu déclaré : réglage `wheels.gap` à décider) ; les cercles des motos ne braquent pas avec la fourche ; la lueur reste à plat et n'a pas été vue contre un trottoir de ville ; LED d'habitacle invisibles en caméra embarquée ; ciel étoilé du concept jamais vu à l'image ; pulsation sur la musique (§ 5.4) pas faite.
- **Carrière** : « sans NOS » n'est jugé qu'à l'arrivée et le bouton reste à l'écran ; on peut partir avec la mauvaise famille de véhicule (la fiche avertit seulement) ; l'annonce de fin de saison n'a ni parcours ni capture ; la finale dure environ neuf minutes ; le haut fait de la saison 1 garde son ancienne description.
- **Capot** : la Cox seulement (le van n'a pas de modèle de moteur, le pivot du capot du concept n'est pas à la charnière, les motos ont leur moteur dans leur carrosserie) ; de dos, la vitre montre peu le moteur ; pas d'ouverture en pause pendant une sortie.
- **Fin de course** : en paysage et très grand texte, le bouton du garage s'écrit sur plusieurs lignes ; l'écran d'un rendez-vous manqué n'a pas de capture.
- **Clavier** : jamais essayé sur un vrai clavier ; pas de touche de pause.
- **Tests** : `sortie-pilotage.spec.ts:204` est trop lourd (à couper en deux) ; `drift.spec.ts` a besoin de quinze minutes en CI, et le 19 novembre à 18 h 39 sa tranche (parcours complets 5/5) a atteint la limite de 60 min avec un échec à `drift.spec.ts:257` (`data-placement` du manche sous 0,5), alors que le test passe en local : la publication n'en dépend pas, mais la CI est rouge ; `carriere.spec.ts:310` a échoué une fois sur un chargement de modèle (« Failed to fetch »), vert rejoué seul ; le parcours d'échec de la carrière est à réécrire.
- **Plus ancien, toujours ouvert** : le véhicule ne reçoit pas l'ombre du décor ; talus d'herbe en gradins sur certaines cartes ; le moteur du van ; le kit large.

## 4. Lots à venir

Ordre fixé par le commanditaire le 19 novembre au soir : restes du duel, NOS, rodéo, cartes, véhicules. Le reste de la liste vient après. « Gros » : un lot d'agent complet avec validation ; « petit » : une retouche de la boucle principale.

1. **Restes du duel et du NOS** (moyen) : le saut de l'adversaire, le dépassement, les sorties d'échappement du concept et du van, la poussée trop faible de la Cox.
2. **Rodéo** (gros) : duel d'accélération en ligne droite, NOS et passages de rapport au bon moment. Réutilise l'adversaire du duel (`DuelEnCourse`). Dernier des quatre chantiers de jeu ouverts le 18 novembre.
3. **Cartes** (gros, une par lot ; données téléchargées par la boucle principale, licence notée dans `CREDITS.md`) : Paris le long de la Seine d'abord ; puis l'Italie (Rome, Pise, Milan), des circuits connus (nommés par leur ville), Moscou, Tokyo, la muraille de Chine, l'Australie, la route 66. Hors de France : OpenStreetMap ; la source du relief est à vérifier pays par pays. Des départs dédiés au drift sur les cartes actuelles (Monaco, la ville, vers 1 800 m ; le plateau vers 6 050 m) sont un petit lot.
4. **Véhicules** (gros, un par lot) : buggy, hot rod, gros 4x4 ; puis un camion à cabine personnalisable. Un convoi avec remorque articulée est un chantier à part (conduite, caméra, grille).
5. **Sourcing de modèles 3D** (petit, recherche seule) : une liste de modèles existants de voitures et de camions sous licence ouverte vérifiée (CC0 ou CC-BY), sans constructeur réel, découpables en pièces ; rien n'est téléchargé avant son choix. Un modèle acheté ne peut vivre que dans le dépôt privé des assets.
6. **Carrière, saison 3** (moyen) : des rendez-vous au score (drift) et contre l'adversaire (duel) ; le format des rendez-vous doit recevoir un objectif de score et un objectif « devant ».
7. **Textures des cartes** (demande de fond) et les points ouverts du § 3.

## 5. Décisions qui attendent le commanditaire

Tranché le 19 novembre au soir : publier (fait), l'ordre des lots, « Conduite assistée », l'arc de néon du van laissé tel quel, les prix et les gains posés sans lui gardés.

- Renommer ou non le « Sortir » de la vue intérieure et l'entrée « Sortie » du menu.
- Toujours en attente de son jugement : les sons de gain et des lignes d'échappement à l'oreille ; la taille du compte-tours en paysage ; le « D'origine » du moteur qui efface aussi les niveaux d'optimisation ; le bouton rond « Carrière » à garder ou non.

## 6. Reprendre le travail

1. Lire `CLAUDE.md` (règles, agents, quota), puis ce document.
2. Vérifier l'état réel : `git status`, `git log origin/main..HEAD`, la CI du dernier push, la version en ligne (l'identifiant du commit est dans le script d'index du site).
3. Avant toute publication : `npm run check`, `npm run build`, `npm run test:e2e:essentiel`, puis les parcours des écrans touchés ; regarder les captures. Ne rien pousser sans l'accord du commanditaire donné dans la conversation.
4. Un lot d'agent travaille dans une copie du dépôt, sans réseau, sans commit ; sa fusion, sa validation et sa publication restent dans la boucle principale.
5. Mettre ce document à jour à chaque étape : une ligne au journal, les restes au § 3, la file au § 4.
