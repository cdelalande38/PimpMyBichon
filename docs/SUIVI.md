# Suivi du projet : demandes, état, suite

Document de passation, tenu à jour à chaque étape. Il dit, pour quelqu'un qui arrive à froid : ce que le commanditaire a demandé (avec ses mots), ce qui est en ligne, ce qui reste faux dans ce qui est livré, et ce qui vient. Le détail technique de chaque lot est dans le message de son commit ; les règles de travail sont dans `CLAUDE.md` ; le périmètre est dans `CAHIER_DES_CHARGES.md` (§ 5.5 pour la sortie, § 11 pour ce que la publication attend) ; les substituts et ce qui manque sont dans `TODO_ASSETS.md`.

Dernière mise à jour : 22 novembre 2026.

## 1. Où on en est

- **En ligne** : poussé le 22 novembre à 12 h 25, validé : ses décisions du 22 novembre (`36eb276`).
- **Aucun agent en vol.** Quota de la semaine à 94 % (retour le 25 novembre à 4 h) : arrêt jusque-là.
- **Reprise** : repartir d'une session neuve de Claude Code (la conversation du 19 au 22 novembre est devenue trop longue). Premier lot : la manette (§ 4, point 0b), puis le reste des menus, les routes plus larges, le rendu.

## 2. Journal des demandes

### 20 et 21 novembre

| Demande (ses mots) | Ce qui a été livré | Commit |
|---|---|---|
| « si un participant arrive sur la ligne d'arrivée il bloque les autres potentiellement. Il faut pas que ça bloque une fois sur la ligne. Par contre pendant la course ça doit rester comme actuellement » | Une fois l'un des deux arrivé, le contact ne s'applique plus entre eux (l'autre passe à côté ou au travers) ; pendant la course, rien ne change | `ff0fc7f` |
| Ses décisions du 22 novembre (§ 5) | « Atelier » dans la vue intérieure (nom accessible « Revenir à l'atelier », la roue dentée s'appelant déjà « Atelier ») ; « Ton compte » ; menu fermé au lancement en paysage ; Custom en trois familles (Couleurs, Pièces, Habitacle) ; « D'origine » du moteur sans les niveaux d'optimisation ; sons de gain +5 dB ; lignes d'échappement plus graves, plus de basses et saturation douce (Sport, Libre) ; moteur de l'adversaire au niveau du joueur de près, qui monte en approche et baisse en éloignement | `36eb276` |
| (décisions sur l'audit, 21 novembre) | Un seul écran « Jouer » : cartes Continuer, Carrière, Course, Duel, Drift, Balade ; « Jouer » dans l'en-tête du menu à toute profondeur (réduit à son triangle quand la place manque) ; bouton rond de la carrière retiré ; aperçu seulement en Balade ; titre d'étape au lieu du fil ; première course libre en 4 ou 5 appuis au lieu de 7. Retouches : pastille d'état, étiquette en double, fondu et molette des rangées, rubriques de l'Atelier visibles en paysage, Échap et P pour la pause, « ? » masqué en course, raccourcis clavier au garage, « Sortir » devenu « Vue atelier » | `3b2cee9` |
| « lorsqu'on charge une course au début c'est figé […] laisser l'écran de chargement de la course un peu plus longtemps, 1 à 2 s » | L'écran de chargement reste 1,5 s de plus, les feux attendent (`CHAUFFE_MS`) | `aa89235` |
| « lance une analyse des menus et place-toi en expert du jeu vidéo et de l'ergonomie de jeux vidéo mobile et PC […] fais un état des lieux et propose des améliorations » | Rapport docs/AUDIT_MENUS.md : 39 problèmes classés, architecture cible, plan. Ses décisions du 21 novembre : bouton rond « Carrière » retiré au profit d'un seul écran « Jouer » ; porte de garage sur le mur avant, près du néon ; aperçu seulement en Balade ; retouches rapides et écran « Jouer » lancés | `80ec58a` |

### Soir du 19 novembre

| Demande (ses mots) | Ce qui a été livré | Commit |
|---|---|---|
| « Direction à renommer en conduite assistée » | Le réglage s'appelle « Conduite assistée », choix « Oui » et « Non » | `59b38d2` |
| « il faudra revoir les distances de circuit annoncés dans les menu ca affiche 0km parfois c'est juste pas possible » | Chaque départ affichait sa borne kilométrique (« km 0,0 » pour le premier) : il dit maintenant la distance jusqu'à l'arrivée, ou la longueur du tour sur un circuit | `59b38d2` |
| « au premier virage elle a freiné tellement que je l'ai dépassée sans souci. J'ai même cru qu'elle était à l'arrêt. Aussi il manque un personnage sur les véhicules de duel » (20 novembre, après essai) | L'adversaire ne freine plus avant la conduite de référence ; nouveau réglage « audace » par niveau (Difficile : il ne lève pas le pied, comme un joueur plein gaz) ; il a un pilote, du même modèle que le joueur, à la tenue teintée de sa couleur | `cdd0c8b` |
| « un élément à fixer ca sera pour la configuration des stickers j'ai l'impression qu'on a pas toutes les options visibles par exemple je peux pas en supprimer » | Les gestes du sticker (dont « Supprimer » et « Curseurs ») étaient au bout d'une rangée qui défilait de côté, hors de l'écran : ils ont leur propre rangée, qui passe à la ligne | `7b4f566` |
| « les préparation moteur ca doit etre payant » | Chaque option de la fiche de préparation (hors « Origine ») est un article, valable pour tous les véhicules : Stage 1 à 3 à 120, 220, 350 $ ; carburation à 80, 160, 260 $ ; nitro à 100, 200, 320 $. Une option déjà montée dans une sauvegarde reste montée et agit ; elle garde son cadenas (règle commune des panneaux) | `215b80d` |
| « pour les écrans de chargement il faudra générer des fonds (fond général de chargement de l'application, fond pour chaque lieux de courses) » | Des rendus de nos propres scènes par le jeu (son choix), de nuit, chaussée mouillée : le garage néon au lancement, une vue par carte au chargement de la sortie, en portrait et en paysage ; outil `npm run fonds:build` ; versés après son accord (« Envoi », 20 novembre) | `0dd9a7c` |
| « traite les reste du del en prio puis NOS puis rodéo puis cartes puis vehicules » | Duel : plus de saut au contact, on double partout où il y a la place, l'adversaire a le son de son moteur (spatialisé) et envoie son NOS en Normal et Difficile | `47be627` |
| (même demande) | NOS : flammes pour le concept et le van, un vrai dard vu de dos, des traits de vitesse lisibles de jour, une poussée qui se sent sur chaque véhicule (la Cox 60 → 92 km/h en 3 s) | `65b28a9` |

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

- **Duel** : le moteur de l'adversaire n'a jamais été écouté (seuls les gains sont testés) ; ses flammes de NOS n'ont pas été capturées ; au départ côte à côte il part contre son bord ; quand le contact cesse, le joueur repoussé revient vers sa trajectoire à 3 m/s au plus ; sur route étroite, les caisses peuvent se chevaucher de quelques centimètres pendant que l'une cède ; le Difficile semble battable plein gaz sans freiner sur Ocean Drive (10 s d'avance après 43 s) : à mesurer ; en portrait, la quinconce cache l'adversaire derrière le van. Trouvé le 20 novembre : frotter le bord ralentit le joueur d'environ 10 g (`bordLibre`, src/drive/pilote.ts), plus fort qu'un frein, donc ne jamais freiner est la meilleure conduite ; le Difficile ne bat le joueur plein gaz que de 0,7 s en sportive sur Ocean Drive (grâce à son NOS) : à trancher, durcir le bord ou laisser ; le Normal est plus dur qu'avant (0,8 à 0,99 fois la référence) ; le pilote de l'adversaire est figé (le guidon braque sous des mains immobiles) et se voit mal dans la Cox.
- **Drift** : sans coup sec sur le frein, seul le concept glisse, et sous la pluie seulement ; les paliers des médailles ont bougé de −39 % à +59 % au dernier recalcul et l'or reste calé sur un pilote simulé ; Monaco est étroit pour glisser ; en portrait la ligne d'aide touche la mini-carte ; pas de record de score par carte.
- **NOS** : le concept et le van n'ont pas d'embout d'échappement modelé (le dard sort de sous le bouclier) et le van a deux sorties ; vu de dos en paysage, le dard reste petit ; de jour contre le ciel, les traits restent discrets ; la poussée plus forte rend un record au NOS plus facile, et sous NOS les roues patinent un peu plus au départ par temps de pluie ou de neige.
- **Néons** : les arcs des roues sont un liseré fin, presque caché quand le pneu remplit l'arche ; celui du van se voit à peine (sa voûte modelée est plus basse que le jeu déclaré : réglage `wheels.gap` à décider) ; les cercles des motos ne braquent pas avec la fourche ; la lueur reste à plat et n'a pas été vue contre un trottoir de ville ; LED d'habitacle invisibles en caméra embarquée ; ciel étoilé du concept jamais vu à l'image ; pulsation sur la musique (§ 5.4) pas faite.
- **Carrière** : « sans NOS » n'est jugé qu'à l'arrivée et le bouton reste à l'écran ; on peut partir avec la mauvaise famille de véhicule (la fiche avertit seulement) ; l'annonce de fin de saison n'a ni parcours ni capture ; la finale dure environ neuf minutes ; le haut fait de la saison 1 garde son ancienne description.
- **Capot** : la Cox seulement (le van n'a pas de modèle de moteur, le pivot du capot du concept n'est pas à la charnière, les motos ont leur moteur dans leur carrosserie) ; de dos, la vitre montre peu le moteur ; pas d'ouverture en pause pendant une sortie.
- **Décisions du 22 novembre** : personne n'a écouté les nouveaux sons (gain, échappement, adversaire) ; après +5 dB, trois sons de gain dépassent 0 dBFS dans le fichier et seul le limiteur de la chaîne tient la sortie ; `sortie-son.spec.ts` échoue sur 2 tests sur 4 (le rapport de vitesse n'est jamais compté : sans doute le départ aux feux de `aa89235`, à corriger en tête du prochain lot).
- **Menus** (21 novembre) : en paysage, la boutique de l'Atelier est plus serrée qu'avant (la rangée des rubriques prend 48 px ; feuille latérale à faire) ; texte très grand en paysage : le contenu de l'Atelier passe sous le « ? » en défilant ; le fondu des rangées ne marche que sous Chrome ; le choix du lieu défile encore (Miami caché en portrait) ; la liste des saisons de la carrière est repliée sous sa fiche, pas un écran à elle ; phares.spec:199 a échoué une fois sur cinq (rangée des départs qui bouge pendant l'appui).
- **Fonds de chargement** : au lancement en paysage, le titre est centré par-dessus le véhicule (le voile le cache presque) ; sur le plateau matheysin, l'eau est noire de nuit et aucun lac ne se lit ; le concept est en vedette partout (les substituts de la Cox et du van montrent une plaque vierge de face) : à refaire par l'outil quand les vrais modèles arriveront ; les fonds de carte ne sont pas au précache.
- **Fin de course** : en paysage et très grand texte, le bouton du garage s'écrit sur plusieurs lignes ; l'écran d'un rendez-vous manqué n'a pas de capture.
- **Clavier** : jamais essayé sur un vrai clavier ; pas de touche de pause.
- **Tests** : `sortie-pilotage.spec.ts:204` est trop lourd (à couper en deux) ; `drift.spec.ts` a besoin de quinze minutes en CI, et le 19 novembre à 18 h 39 sa tranche (parcours complets 5/5) a atteint la limite de 60 min avec un échec à `drift.spec.ts:257` (`data-placement` du manche sous 0,5), alors que le test passe en local : la publication n'en dépend pas, mais la CI est rouge ; `carriere.spec.ts:310` a échoué une fois sur un chargement de modèle (« Failed to fetch »), vert rejoué seul ; le parcours d'échec de la carrière est à réécrire.
- **Plus ancien, toujours ouvert** : le véhicule ne reçoit pas l'ombre du décor ; talus d'herbe en gradins sur certaines cartes ; le moteur du van ; le kit large.

## 4. Lots à venir

Ordre : les menus (en cours, ses décisions du 21 novembre), puis des routes plus larges (son retour du 21 novembre), puis le rendu (ajouté par lui le 21 novembre « pour que ça soit travaillé à la suite »), puis l'ordre qu'il avait fixé le 19 novembre (rodéo, cartes, véhicules). « Gros » : un lot d'agent complet avec validation ; « petit » : une retouche de la boucle principale.

0. **Menus** (d'après docs/AUDIT_MENUS.md § 7) : écran « Jouer » et retouches rapides faits le 21 novembre ; ses décisions du 22 novembre (mots, menu fermé en paysage, Custom regroupé) en cours ; puis menu de pause, panneaux en paysage, choix du lieu en grandes cartes illustrées, porte de garage (mur avant, près du néon « GOOD VIBES ONLY », Opus), disposition PC, choix du véhicule en cartes. À trancher par lui : les mots (« Sortie », « Sortir », « Jeu » ou « Ton compte »), le menu fermé par défaut en paysage, le regroupement des entrées de Custom.
0b. **Manette : le manche ne fait que tourner, la marche arrière au frein** (demande du 22 novembre : « en vue manette il faut que le joystick de gauche ne gère que la direction, car là on freine sans le savoir en voulant tourner à fond à gauche ou à droite. Les boutons accélération et frein de droite seront les seuls à permettre d'avancer ou freiner (si on est à zéro et qu'on freine, on recule : ça permet de débloquer la ligne d'arrivée ou des situations) »). Lot Opus, premier de la file : en commande manette (à l'écran, et la manette physique si elle suit la même règle), le manche de gauche ne donne plus que la direction (src/ui/drive/manche.ts : aujourd'hui haut = gaz, bas = frein) ; GAZ et FREIN de droite seuls pour avancer et freiner ; frein tenu à l'arrêt = marche arrière lente et bornée (le pilote n'en a pas : src/drive/pilote.ts « jamais de recul »), avec la caméra, le chrono, la ligne d'arrivée, le départ et le contact du duel qui la supportent ; la conduite assistée et le tactile hors manette inchangés sauf décision contraire.
1. **Routes plus larges, virages plus amples** (demande du 21 novembre : « Il faudra prévoir d'élargir les routes des circuits, c'est trop juste. Surtout les virages, c'est pas adapté à la taille des véhicules : il faut des virages beaucoup plus larges et étendus »). Lot Opus par carte, dans `tools/maps/` (la carte se refabrique, aucune retouche à la main du rail) : une largeur de chaussée minimale par carte et par type de voie, en données ; les virages adoucis à un rayon minimal (par exemple 25 à 30 m, à mesurer avec la conduite de référence et la moto) en élargissant aussi la chaussée dans le virage ; le bord de route durci (décision du 22 novembre : il freinait plus fort qu'un frein) ; le décor (bâtiments, trottoirs, murets, lampadaires, arbres) repoussé ou découpé là où la route s'élargit ; le lieu reste reconnaissable (Monaco, Miami, le plateau). À refaire derrière, par l'outil : temps de référence et médailles (tools/courses/), paliers du drift, grilles de départ du duel, fonds de chargement (`npm run fonds:build`). Mesurer d'abord : largeur et rayon de chaque virage aujourd'hui, à côté de la largeur des véhicules (le van fait 2,26 m) et de la vitesse de passage.
2. **Rendu : aller vers une qualité « vitrine »** (demande du 21 novembre : « J'aime bien tes propositions d'amélioration, alimente le plan avec tout ça pour que ça soit travaillé à la suite » ; probablement la semaine du 25 novembre, selon le quota). Pas un rendu de jeu de console sur téléphone (le GPU d'un téléphone est 3 à 5 fois moins puissant et chauffe, et le vrai fossé est celui des assets), mais le garage au niveau des meilleurs jeux de voiture sur mobile, et une nuit néon fluide en course. Dans l'ordre :
   1. *État des lieux du rendu* (Opus, analyse, comme l'audit des menus) : image par image, ce qui fait « amateur », ce que chaque chantier ci-dessous apporterait, son coût en temps d'image sur le téléphone de référence et en quota ; des paliers de qualité (bas, haut) et une résolution qui s'adapte.
   2. *De vrais modèles de véhicules* : le premier levier, de loin (la voiture est dans chaque image) ; la Cox et le van sont encore des substituts générés par code. Licence ouverte vérifiée seulement (CC0, CC-BY : décision du 22 novembre, aucun budget) : commencer par le sourcing (recherche par la boucle principale, avec le réseau).
   3. *Éclairage précalculé* (Opus, un à deux lots) : la lumière du garage puis de chaque carte calculée une fois (réflexions, ombres douces, rebonds des néons) et seulement affichée par l'app ; gros gain pour presque rien en temps d'image.
   4. *Passage à WebGPU* (Opus, deux ou trois lots) : le moteur de rendu WebGPU de three.js, avec repli WebGL pour les téléphones qui ne l'ont pas ; meilleurs reflets, brouillard volumétrique, anticrénelage propre, plus d'objets à l'écran.
   5. *Cartes habillées* (gros, carte par carte ; rejoint « Textures des cartes ») : textures de chaussée et de façades (les immeubles sont aujourd'hui des boîtes tirées d'OpenStreetMap), mobilier urbain, végétation modélisée, lumière précalculée par tronçon.
   6. *Mode photo en rendu de film* (moyen) : un moteur de lancer de rayons qui affine l'image en quelques secondes pour les captures du garage ; c'est là qu'on approche le plus le photoréalisme.
3. **Rodéo** (gros) : duel d'accélération en ligne droite, NOS et passages de rapport au bon moment. Réutilise l'adversaire du duel (`DuelEnCourse`). Dernier des quatre chantiers de jeu ouverts le 18 novembre.
4. **Cartes** (gros, une par lot ; données téléchargées par la boucle principale, licence notée dans `CREDITS.md`) : Paris le long de la Seine d'abord ; puis l'Italie (Rome, Pise, Milan), des circuits connus (nommés par leur ville), Moscou, Tokyo, la muraille de Chine, l'Australie, la route 66. Hors de France : OpenStreetMap ; la source du relief est à vérifier pays par pays. Des départs dédiés au drift sur les cartes actuelles (Monaco, la ville, vers 1 800 m ; le plateau vers 6 050 m) sont un petit lot.
5. **Véhicules** (gros, un par lot) : buggy, hot rod, gros 4x4 ; puis un camion à cabine personnalisable. Un convoi avec remorque articulée est un chantier à part (conduite, caméra, grille).
6. **Sourcing de modèles 3D** (petit, recherche seule) : une liste de modèles existants de voitures et de camions sous licence ouverte vérifiée (CC0 ou CC-BY), sans constructeur réel, découpables en pièces ; rien n'est téléchargé avant son choix. Un modèle acheté ne peut vivre que dans le dépôt privé des assets.
7. **Carrière, saison 3** (moyen) : des rendez-vous au score (drift) et contre l'adversaire (duel) ; le format des rendez-vous doit recevoir un objectif de score et un objectif « devant ».
8. **Textures des cartes** (demande de fond) et les points ouverts du § 3.

## 5. Décisions qui attendent le commanditaire

Tranché le 19 novembre au soir : publier (fait), l'ordre des lots, « Conduite assistée », l'arc de néon du van laissé tel quel, les prix et les gains posés sans lui gardés.

Tranché le 22 novembre (ses réponses) :
- la vue intérieure : « Atelier » au lieu de « Vue atelier » ;
- « Jouer » réduit à son triangle quand l'en-tête manque de place : gardé ;
- la rubrique de l'Atelier s'appelle « Ton compte » ;
- en paysage, le menu est fermé par défaut ;
- regroupement des entrées de Custom et ordre des sections : appliquer les recommandations de l'audit (docs/AUDIT_MENUS.md § 5.4) ;
- le bord de route freine trop (environ 10 g, ne jamais freiner est la meilleure conduite) : le durcir, avec l'élargissement des routes ;
- le « D'origine » du moteur ne remet que les pièces, pas les niveaux d'optimisation payés ;
- modèles de véhicules : aucun budget, donc licence ouverte vérifiée seulement (CC0, CC-BY), rien d'acheté ;
- sons de gain : plus forts (« on n'entend pas trop ») ; lignes d'échappement : plus agressives (« ça fait jouet ») ;
- taille du compte-tours en paysage : « parfait » ;
- moteur de l'adversaire au duel : plus fort, surtout de près, qui monte quand il arrive et baisse quand il s'éloigne, dans un sens comme dans l'autre.

Encore en attente : ses retours après essai de chaque publication (en particulier les sons, à l'oreille).

## 6. Reprendre le travail

1. Lire `CLAUDE.md` (règles, agents, quota), puis ce document.
2. Vérifier l'état réel : `git status`, `git log origin/main..HEAD`, la CI du dernier push, la version en ligne (l'identifiant du commit est dans le script d'index du site).
3. Avant toute publication : `npm run check`, `npm run build`, `npm run test:e2e:essentiel`, puis les parcours des écrans touchés ; regarder les captures. Ne rien pousser sans l'accord du commanditaire donné dans la conversation.
4. Un lot d'agent travaille dans une copie du dépôt, sans réseau, sans commit ; sa fusion, sa validation et sa publication restent dans la boucle principale.
5. Mettre ce document à jour à chaque étape : une ligne au journal, les restes au § 3, la file au § 4.
