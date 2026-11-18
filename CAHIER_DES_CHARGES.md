# PimpMyBichon — cahier des charges pour Claude Code

Version 0.3 du 13 novembre 2026. Remplace les v0.1 et v0.2. Complétée le 14 novembre 2026 : télé du garage et option YouTube (§ 5.12). Complétée le 15 novembre 2026 : le van remplace le combi (§ 3, § 4), fiche de préparation du moteur (§ 5.4), pack de musique à plusieurs stations chargé par son adresse (§ 9), modèle de banc d'essai gardé au catalogue de la première version livrée (§ 10.1), sortie de nuit sur des cartes tirées de lieux réels, sur rail puis en conduite libre (§ 3, § 5.5, § 8, § 14, § 17, § 18).

> Ce fichier est écrit pour vivre dans un dépôt public. Il ne contient volontairement aucune information personnelle sur l'utilisateur final au-delà de son surnom. Garder cette règle dans tout le dépôt (code, commits, issues, assets).

**Ajouts de la v0.3** :

- **Le combi** rejoint la vague 1 : fourgon à moteur arrière, comme le sien, à **aménager en camping-car** à sa sauce (§ 5.10).
- **LED au plafond**, habillages, mobilier, toit relevable, scène de bivouac (§ 5.10).
- **Établi moteur** : on sort le moteur, on le regarde en vue éclatée, on repeint, chrome ou polit chaque pièce. Toute pièce du véhicule peut passer sur l'établi (§ 5.11).
- **Musique** : la radio se remplit par un **dossier de lecture**, et l'utilisateur peut importer ses propres morceaux depuis le téléphone (§ 9).
- **Assets sous licence** (sons de banques payantes) : jamais dans le dépôt public (§ 11).

**Ce qui change depuis la v0.1**, après essai du prototype :

- **Rendu 3D** : la cible n'est plus le « low-poly premium ». On vise un **rendu showroom néon semi-réaliste**, d'après les références du § 4. C'est l'exigence n°1 du projet (§ 8, jalon 1).
- **Plus de véhicules** : 8 au catalogue cible, livrés par vagues, chargés à la demande. Un véhicule = un dossier (§ 3).
- **Livrées intégrales** : flammes sur toute la caisse, covering à motifs, chromes colorés (§ 5.3).
- **Esprit « Pimp My Ride » assumé** : beaucoup plus d'options, couleur libre sur chaque zone, éditeur de stickers (§ 5.2 à 5.4).
- **Sortie de nuit** : on voit le véhicule rouler, dans l'esprit des jeux de tuning des années 2000 (§ 5.5).
- **Son** : les moteurs et la musique synthétisés du prototype sont **rejetés** (« son d'enfant »). Exigence de réalisme, à base d'enregistrements et de morceaux réels (§ 9).
- **Garage** : décrit d'après 14 photos et une courte vidéo panoramique prise depuis le canapé. Évocation fidèle, pas reproduction au centimètre (§ 4).
- Le prototype reste la référence pour l'ergonomie et la structure, **pas** pour le rendu, le son ni la richesse du catalogue.
- Valeurs par défaut prises sur les questions ouvertes (§ 18). Liste de ce qu'un humain doit fournir : § 10.3 et `TODO_ASSETS.md`.

---

## 1. Intention

PimpMyBichon est un atelier de customisation de voitures et de motos, en 3D temps réel, sur téléphone, avec un rendu qui donne envie de faire une capture d'écran à chaque étape. Il est fait pour **une seule personne**, surnommée Bichon, préparateur passionné, et pour son cercle d'amis.

On prépare un véhicule dans son garage, sans retenue : couleurs, stickers, jantes, néons, sono, tout ce qui se visse. Puis on ouvre la porte du garage et on le regarde rouler de nuit, musique à fond. On peut travailler pour soi (garage libre) ou pour un ami qui passe commande (brief), et on envoie le résultat.

Ce n'est pas un jeu de course : pas d'adversaire, pas de chrono, rien à gagner. L'ambiance reprend les codes des jeux de tuning des années 2000 et des émissions de préparation à l'américaine, sans reprendre aucun élément protégé.

**Critère de réussite unique** : il rouvre l'app de lui-même, et ses amis lui envoient des commandes.

## 2. Utilisateur et contraintes d'usage

- Usage principal **allongé, à une main, en sessions de 2 à 10 minutes**. Les commandes de personnalisation dans le tiers bas de l'écran, cibles de 48 px minimum, portrait par défaut. Depuis le 17 novembre 2026, à la demande du commanditaire, le garage se tient aussi téléphone couché : le menu passe en colonne à droite sur toute la hauteur, les boutons ronds en colonne à gauche, et l'app installée n'impose plus l'orientation. Depuis le 15 novembre 2026, à la demande du commanditaire, les menus sont séparés : la radio, la photo et la configuration de l'app (« Atelier ») sont trois boutons ronds en haut à droite ; le menu du bas ne porte que la personnalisation, en quatre sections (Véhicule, Custom, Mécanique, Garage), avec une ligne de repère (« Retour », l'endroit où l'on est, « Fermer le menu ») ; il peut être fermé, compact ou agrandi (options sur plusieurs lignes, jusqu'à 60 % de l'écran).
- Aucun minuteur, aucun score, aucun échec, aucun rappel du type « reviens jouer ». Le budget d'un brief n'est jamais bloquant.
- Reprise instantanée : à l'ouverture on retrouve le dernier véhicule, dans le même état. Sauvegarde à chaque action.
- Réseau souvent mauvais : **tout doit marcher hors ligne après la première ouverture**.
- Son coupé par défaut au premier lancement, activable en un geste. Prévoir l'écoute au casque ou sur enceinte Bluetooth.
- Thème sombre uniquement. Pas de flash ni de stroboscope. Respecter `prefers-reduced-motion`.
- Cible matérielle : **Android + Chrome** en priorité, appareil de référence **Galaxy S26** (hypothèse tirée des photos, à confirmer). Navigateur de bureau en second. iOS non prioritaire mais ne doit pas être cassé.
- La sortie de nuit doit pouvoir se **regarder sans rien toucher** (pilote automatique par défaut).

## 3. Périmètre

### V1 (ce cahier des charges)

1. Un garage 3D de nuit inspiré de son vrai garage, au rendu showroom néon.
2. Un **catalogue de véhicules** livré par vagues (tableau ci-dessous), chaque véhicule chargé à la demande.
3. Couleur libre et finitions sur chaque zone et sur **chaque pièce** du véhicule.
4. Éditeur de stickers, livrées intégrales et covering.
5. Catalogue de pièces et de réglages large, y compris les excès (kits larges, sono, hydraulique, portes en élytre).
6. **Aménagement intérieur** : le combi se transforme en camping-car (mobilier, habillages, LED au plafond).
7. **Établi moteur** : dépose du moteur, vue éclatée, personnalisation pièce par pièce.
8. **Sortie de nuit** : le véhicule roule de nuit, sous la pluie si on veut, sur une **carte tirée d'un lieu réel** (route de lacs, ville, circuit urbain), en pilote automatique ou à la main.
9. Projets à brief et garage libre.
10. Partage sans serveur : photo, lien de build, lien de défi.
11. Son réaliste : moteurs enregistrés, bruitages d'atelier, radio alimentée par un dossier de lecture.
12. PWA installable, hors ligne, déployée sur GitHub Pages. APK Android en option.

### Véhicules

Noms de travail génériques. Aucun n'est la copie d'un modèle de série : silhouettes « inspirées de », sans logo ni nom de constructeur.

| Vague | Véhicule | Type | D'où il vient |
|---|---|---|---|
| 1 | **La Cox** | berline ronde des années 70, moteur arrière | sa Cox verte |
| 1 | **Le van** | fourgon moderne à moteur avant, tôlé, blanc et rabaissé, aménageable | son van |
| 1 | **Le bobber** | bicylindre en V à cadre rigide | son bobber noir à flammes |
| 1 | **Le fastback** | muscle car américain de la fin des années 60 | références de rendu |
| 1 | **La sportive** | moto carénée de piste | sa sportive orange |
| 2 | **La berline 90** | trois volumes allemande des années 90 | son projet de 2006 |
| 2 | **Le pick-up** | pick-up américain rabaissé des années 80 | son pick-up gris |
| 2 | **Le 4x4** | tout-terrain des années 2000 | son 4x4 à rampes LED |
| 2 | **Le coupé** | coupé moderne à quatre portes | références de covering |
| 3 | au fil de l'eau | lowrider, hot rod, café racer, supermotard, fourgon aménagé | — |

La **V1 est livrable avec la vague 1** (cinq véhicules). Depuis le 15 novembre 2026, le « combi » de ce cahier est **le van** (identifiant `van`) : les photos reçues ce jour-là montrent un fourgon moderne à moteur avant, et non le fourgon à moteur arrière supposé jusque-là ; partout où ce cahier écrit « combi », lire « van ». La Cox garde son moteur à plat ; le van a le sien, un quatre cylindres turbo diesel. L'architecture doit rendre l'ajout d'un véhicule possible **sans toucher au code** : déposer un dossier `public/assets/vehicles/<id>/` (modèle, manifeste, vignette, jeu de sons moteur) suffit. Chaque véhicule a au moins 12 postes et 60 options en P1.

### Hors périmètre V1

Courses, adversaires, chrono, classement, dégâts, collisions, police, monde ouvert, circulation dense, multijoueur, physique de conduite réaliste, comptes utilisateurs, serveur, galerie commune, notifications push, simulation mécanique (pannes, réglages, puissance), iOS optimisé.

Exception décidée le 15 novembre 2026 : la **fiche de préparation du moteur** (§ 5.4) affiche des chiffres de puissance d'atelier, sans rien simuler de la mécanique.

Seconde exception décidée le 15 novembre 2026 : la **conduite libre** (direction au pouce sur route fermée, bords de route qui retiennent le véhicule) fait l'objet d'un second lot de la sortie de nuit (§ 5.5). Monde ouvert, collisions avec dégâts, police et circulation dense restent hors périmètre.

### V2 envisagée (ne pas implémenter, ne pas fermer la porte)

Vague 3 de véhicules, d'autres cartes de sortie au fil de l'eau (Grenoble, Paris, Nice, Marseille, capitales et villes de bord de mer : § 5.5), deuxième garage (atelier souterrain à graffitis), circulation légère, galerie privée et réactions via une petite API (Symfony + API Platform, hébergée hors GitHub Pages), mémo vocal de l'ami joint au défi.

## 4. Univers et direction artistique

### Références de rendu visé

Six images de référence ont été fournies. Elles restent hors du dépôt (marques, plaques et personnes visibles). Ce qu'il faut en retenir :

1. **Atelier souterrain** : mur de parpaings couvert de graffitis, plafond béton à tuyaux apparents, **tubes LED verticaux sur pied** (cyan), projecteurs au sol magenta, brume légère. Une carrosserie noire y reflète chaque tube ; les feux arrière sont allumés ; le sol en béton brille.
2. **Ville néon sous la pluie** : chaussée détrempée qui fait miroir, enseignes verticales, brume violette au ras du sol, traînées lumineuses. Voiture à kit large et grand aileron, néons sous caisse **cyan à l'avant, magenta sur les flancs**.
3. et 4. **Cox à flammes intégrales** : flammes à deux ou trois tons qui partent du nez, épousent le capot et les ailes et courent sur les portes, avec un liseré contrasté ; jantes chrome profondes ; caisse rabaissée.
5. **Covering intégral à motifs** : volutes psychédéliques multicolores sur fond noir, jantes noires.
6. **Covering « chrome coloré »** violet brillant : reflets nets des rampes lumineuses sur toute la caisse, studio de pose.

Ces images fixent **l'intention**. Certaines sont retouchées ou générées : le temps réel sur téléphone n'en donnera pas la copie conforme. Ce qui est exigé, ce sont les ingrédients listés au § 8 (peinture multicouche, reflets des néons sur la caisse, sol mouillé, halos, brume), validés à l'œil au jalon 1.

### Sources pour son univers

La matière disponible : **14 photos** de son garage et de ses véhicules, et **une vidéo panoramique muette de 20 secondes** filmée depuis le canapé. Elles restent hors du dépôt public. Tout ce qu'il faut en retenir est décrit ici ; ne rien chercher à reproduire au pixel, et ne jamais utiliser une photo comme texture.

### Le garage (évocation fidèle)

Disposition, vue depuis le canapé en balayant de gauche à droite :

- **Premier plan** : table basse en bois clair. Dessus, un **bloc 4 cylindres à cornets rouges** posé comme une sculpture. À côté, un tabouret fait d'un **disque de frein** à assise rouge, et un pouf fait d'un **pneu**.
- **À gauche** : un quad noir à phares ronds, garé de trois quarts. Fauteuils en cuir brun derrière la table.
- **Mur du fond** : meubles d'atelier **blancs à tiroirs**, plan de travail sombre, crédence sombre à **motif de carreaux en escalier** noirs et blancs, outils posés. Au-dessus, mur blanc et retombée de plafond blanche à **spots encastrés : bleu à gauche, blanc au centre, rouge à droite**, qui dessinent des halos doubles sur le mur. Applique articulée, enceintes noires murales.
- **Au centre droit** : colonne noire toute hauteur avec **grand écran**, toile pop art au-dessus (motif original à créer). Devant, une **moto supermotard orange** sur béquille.
- **À droite** : un flipper ancien avec une peluche posée dessus, puis un **mur entièrement rouge**, une cible de fléchettes dans un panneau de bois, des caisses empilées.
- **Enveloppe** : plafond en bois, murs latéraux en **panneaux OSB**, sol en **carrelage clair grand format** qui prend la couleur des lumières. Toute la moitié gauche baigne dans le bleu-violet, la droite dans le rouge, le milieu vire au magenta. C'est la signature du lieu.
- **Vus sur les photos, à placer librement** : étagère à casiers avec 4 casques, petite moto sportive rouge accrochée au mur, turbo sur une étagère, mur d'outils, fût métallique rouge, second flipper, plaques d'immatriculation décoratives.
- Un néon mural au nom de l'app, et un second « GOOD VIBES ONLY ».
- **Ambiances lumineuses** au choix : « Bichon » (rouge et bleu, par défaut), « Néon » (magenta et cyan, avec tubes LED sur pied), « Atelier » (blanc neutre pour juger une teinte).
- L'écran du garage diffuse la photo du dernier build livré.

### Les véhicules qu'il a eus (source des teintes, pièces et préréglages)

- Cox **vert sarcelle pailleté** à reflets bleus, jantes 8 branches, clignotants sur les ailes, intérieur noir, volant trois branches, **pommeau tête de mort**.
- Sportive carénée **orange, blanc et noir** à jantes orange.
- Bobber noir à **flammes sur le réservoir**, guidon haut, selle solo, phare rond.
- Berline des années 90 **crème mat**, phares à anneaux lumineux, toit noir, **portes en élytre** (projet 2006).
- Pick-up américain **gris** rabaissé, jantes tôle blanches, feux de gabarit orange sur le toit.
- Un **fourgon moderne blanc, rabaissé**, tôlé, à vitres teintées, bouclier avant gris non peint, jantes tôle percées peintes en blanc, moteur turbo diesel reprogrammé (photos reçues le 15 novembre 2026 ; son intérieur a un plafond à LED, photo attendue).
- 4x4 gris à **rampes LED** (toit et pare-chocs) et pneus tout-terrain à lettrage blanc.
- Pick-up noir et gris rehaussé, arceau de benne chromé.

### Motifs et ton

Têtes de mort, flammes, pistons, chrome, cuir, tatouages tribaux, masque de soudeur à flammes, esprit rock. **L'excès est une qualité** : on doit pouvoir faire un véhicule sobre, mais aussi un véhicule ridicule.

### À l'écran

Nuit, reflets rouges et bleus sur la peinture. Interface en parallélogrammes, capitales espacées, une police d'affichage large et une police de texte technique. Palette d'interface : nuit violette, rouge LED, bleu LED, chrome, ambre pour le budget, turquoise pour le validé.

**Interdits** : logos et noms de constructeurs, d'équipementiers, de sponsors, d'émissions ou de jeux vidéo ; polices, sons, écrans ou musiques extraits d'un jeu ; personnages de dessin animé ; photos de personnes.

## 5. Fonctionnel

### 5.1 Garage et caméra

- Orbite au pouce autour du véhicule, angle vertical borné, zoom au pincement et au double-tap, rotation lente au repos (désactivée si mouvement réduit).
- Bascule Cox / Bobber instantanée, chaque véhicule garde son état.
- La caméra se recadre toute seule sur la zone en cours de modification (roue, capot, réservoir).
- Vue intérieure pour la Cox (volant, pommeau, sièges, sono).
- Mode photo : masque l'interface, 5 cadrages prédéfinis, et lance le **rendu photo** haute qualité du § 8.
- Ambiance lumineuse du garage au choix (§ 4). « Pimp my garage » (placer des tubes LED, choisir le graffiti du mur) en P2.

### 5.2 Couleur et finitions

Tout ce qui est peint, anodisé ou cousu se colore **librement**. Pas de liste fermée.

Les zones dépendent du véhicule ; exemples pour deux d'entre eux.

**Zones Cox** : carrosserie, toit, capot avant, capot moteur, ailes, pare-chocs, jantes, étriers de frein, sellerie, vitres (teinte de 0 à 80 %), phares (teinte), néons.
**Zones bobber** : réservoir, garde-boue, cadre, moteur, jantes, fourche, selle, poignées, casque et blouson du pilote.

Pour chaque zone :

- **Couleur** : roue chromatique + luminosité, saisie hexadécimale, pipette (reprendre la couleur d'une autre zone), 12 dernières couleurs, palette « Bichon » (Vert Bichon, Orange piste, Crème 2006, Gris pick-up, Rouge sang, Noir, Bleu nuit, Violet, Blanc).
- **Finition** : brillant, satiné, mat, métallisé, pailleté (taille de paillette réglable), candy, nacré, **caméléon** (deux teintes selon l'angle), chrome, **chrome coloré** (miroir teinté, toutes teintes), or, cuivre, chrome noir, aluminium brossé, carbone, **rat look** (patine et rouille), métal brut poncé.
- Les zones peintes sont **liées par défaut** (changer la carrosserie change tout) ; un cadenas par zone permet le bi-ton et plus.

### 5.3 Stickers et livrée

Un vrai éditeur, utilisable au pouce.

- **Zones** : flancs gauche et droit, capot avant, toit, capot moteur, ailes ; réservoir, garde-boue et casque pour le bobber.
- **Calques** : jusqu'à 16 par zone. Chaque sticker se déplace, se tourne, se redimensionne, se retourne, se colore, se rend plus ou moins opaque, se duplique, se réordonne. Poignées larges, pas de geste à deux doigts obligatoire (curseurs de taille et de rotation en repli).
- **Symétrie** gauche/droite activée par défaut sur les flancs.
- **Bibliothèque maison** (créations originales en SVG, au moins 80 motifs au lancement) : flammes (6 styles), tribal, pinstriping, bandes de course, damiers, numéros de course, éclairs, étoiles, têtes de mort, pistons croisés, clés, ailes, toiles d'araignée, griffures, éclaboussures, tags et lettrages graffiti, dégradés, **faux sponsors inventés** (noms et logos fictifs, drôles).
- **Texte libre** : son texte, 8 polices (libres de droits, embarquées), contour, ombre, courbure.
- **Image importée** depuis le téléphone (PNG ou photo, détourage non requis) : reste sur l'appareil, n'est pas incluse dans les liens de partage, apparaît sur les photos.
- **Livrées intégrales**, qui couvrent toute la caisse d'un seul tenant :
  - **générateur de flammes** : 2 ou 3 couleurs en dégradé, liseré, longueur, densité, point de départ (nez, passages de roue, bas de caisse) ; les flammes suivent les lignes de la carrosserie ;
  - **covering à motif** répété ou continu : volutes psychédéliques, camouflage, damier, tribal, galaxie, peau de serpent, circuit imprimé, éclaboussures, bandes ; couleurs du motif modifiables une à une ;
  - **dégradés** bi-ton et tri-ton le long de la caisse, horizontaux ou verticaux.
- **Livrées complètes** en un geste (8 préréglages : flammes classiques, course années 70, rat look, tribal 2004, bi-ton lowrider, etc.), modifiables ensuite.
- Plaque d'immatriculation à texte libre (format fantaisie).

### 5.4 Pièces et réglages

Principe : **la profondeur vient d'abord du paramétrique** (couleurs, finitions, stickers, curseurs), qui ne coûte pas de modélisation, puis des pièces modélisées. Priorité P1 = indispensable en V1, P2 = dès que les modèles suivent.

**Curseurs continus (P1)**

| Cox | Bobber |
|---|---|
| hauteur de caisse avant et arrière | longueur et inclinaison de fourche (du bobber au chopper) |
| carrossage, largeur de voie | hauteur et recul du guidon |
| diamètre de jante (15 à 20 pouces), largeur et hauteur de pneu | largeur du pneu arrière (130 à 300) |
| teinte des vitres | hauteur de selle |

**Postes communs à toutes les voitures** : jantes (12 modèles partagés), pneus, étriers, assiette, kit carrosserie (lame avant, jupes, diffuseur, **kit large**), aileron (5), capot, échappement, phares, feux, vitres, intérieur, sono, néons (**une couleur par zone** : avant, flancs, arrière, passages de roue, habitacle), gadgets.
**Postes communs à toutes les motos** : guidon, selle, réservoir ou carénage, garde-boue, échappement, roues, moteur, phare, accessoires, pilote, néons.
Les pièces partagées (jantes, pneus, sièges, volants, sono) sont modélisées une fois et servent à tous les véhicules compatibles.

**Intérieur, sur tout véhicule à habitacle** (demande du 15 novembre 2026) : volant, pommeau de levier, type de sièges et sellerie se choisissent comme les autres pièces, et le **ciel de toit** peut être uni ou **étoilé en LED** (couleur libre, densité, médaillon central à motif original, allumé ou éteint), pas seulement sur le van (§ 5.10). Ces choix se font aussi depuis la vue intérieure.

**Postes propres au fastback (P1)** : prise d'air de capot (plate, bossage, compresseur apparent), persiennes de lunette arrière, becquet et aileron, bandes de capot, sorties d'échappement latérales, jantes larges à l'arrière.
**Postes propres à la sportive (P1)** : carénage complet / tête de fourche seule / nue, bulle (claire, fumée, double courbure), coque arrière monoplace, silencieux (origine, court sous moteur, haut double), couleur des jantes, bracelets, livrées de course à numéro.

**Pièces Cox**

| Poste | P1 | P2 |
|---|---|---|
| Jantes | tôle + enjoliveurs, 8 branches, flasques chrome, noires renforcées, 5 bâtons, rayons fils | 6 modèles de plus, jantes déportées profondes |
| Pneus | route, flanc blanc, lettrage blanc, tout-terrain | slicks |
| Assiette | préréglages origine, rabaissée, posée au sol, baja | **suspension hydraulique** animée (boutons avant, arrière, côté, saut) |
| Pare-chocs | chrome, déposés, tubulaires | lame avant sport, pare-buffle |
| Carrosserie | ailes d'origine ou élargies, capot moteur fermé / ajouré / déposé | jupes, prise d'air de toit, **portes en élytre** (s'ouvrent) |
| Aileron | aucun, becquet « queue de baleine », aileron haut | aileron démesuré |
| Moteur apparent | d'origine, double carburateur à filtres rouges | turbo, compresseur qui dépasse du capot |
| Échappement | double sortie, stinger, 4-en-1 latéral | sorties hautes, flammes à la décélération |
| Phares et feux | ronds, anneaux lumineux, grille de protection | xénon coloré, clignotants séquentiels |
| Toit | nu, galerie, rampe LED, galerie + rampe | planche, roue de secours, toit découvrable |
| Intérieur | sièges d'origine ou baquets, 3 volants, pommeau (boule, tête de mort, piston), arceau | tableau de bord à manomètres |
| **Sono** | aucune, 2 caissons de basses dans le coffre avant (membranes qui battent sur la musique) | mur d'enceintes, écrans dans les appuie-tête |
| Néons | sous caisse, passages de roue, habitacle ; fixe ou pulsation lente sur la musique (jamais de stroboscope) | — |
| Gadgets | purge de nitro (jet de vapeur), klaxon à 3 sons | fumée de pneus au démarrage |

**Pièces bobber**

| Poste | P1 | P2 |
|---|---|---|
| Guidon | origine, ape hanger (3 hauteurs), drag bar, bracelets, guidon en Z | guidon tiller |
| Selle | biplace, solo à ressorts, dosseret café, selle basse rembourrée losanges | sissy bar + pouf passager |
| Réservoir | fat bob, peanut, frisco, cercueil | double réservoir |
| Garde-boue | enveloppant, raccourci, déposé, ducktail | — |
| Échappement | long, shotgun courts, relevé, 2-en-1 queue de poisson, drag pipes | sorties sous selle |
| Roues | rayons chrome, rayons noirs, bâtons, pleines, flancs blancs | roue avant 21 ou 23 pouces fine |
| Moteur | noir, poli, chrome, peint ; filtre rond, cornet, filtre conique | transmission primaire ouverte |
| Phare | rond, phare à grille, double optique | — |
| Accessoires | repose-pieds avancés, sacoche latérale cuir, plaque latérale, clignotants bouts de guidon | béquille sculptée |
| Pilote | casque (jet, bol, intégral ; couleur et sticker), blouson (cuir noir, brun, jean) | — |
| Néons | sous cadre, dans les roues | — |

Chaque changement joue un bruitage d'atelier réel et une micro-animation de la pièce. Un bouton **« Surprends-moi »** tire une configuration au hasard. Un bouton « d'origine » par poste.

Préréglages de départ : « La vraie de Bichon » et « Sortie de grange » (Cox) ; « Le bobber de Bichon » et « Sortie d'usine » (bobber).

**Préparation du moteur** (demandée le 15 novembre 2026). Une fiche par véhicule part du moteur d'origine déclaré dans son manifeste et propose, selon ce moteur : la **reprogrammation** par paliers pour les moteurs à injection, la **carburation** pour les moteurs à carburateur (motos, Cox), le **nitro** pour tous. Elle affiche la puissance d'origine, le gain et la puissance préparée, comme une feuille de préparateur (« Origine 102 ch, gain + 73 ch, reprogrammé 175 ch »). Ce sont des chiffres d'atelier : aucune simulation mécanique. Les pièces visibles (carburateurs, bouteille), les sons et l'effet sur la sortie de nuit viendront avec les pièces P1 et le son.

### 5.5 Sortie de nuit

Le moment de récompense : on sort le véhicule et on le regarde rouler.

- **Entrée** : bouton « Sortir ». La porte du garage se lève, le moteur démarre, le véhicule sort (plan de 3 secondes, passable).
- **Décor** : une **carte** tirée d'un lieu réel (voir « Cartes » plus bas), de nuit, dans l'esprit de la référence n°2 du § 4 : chaussée détrempée qui fait miroir, enseignes néon **fictives** en ville, brume au ras du sol, lampadaires, quelques véhicules garés ; tunnels, ponts et plans d'eau là où le lieu en a. Pas de piéton.
- **Météo** : sec ou pluie (gouttes, éclaboussures, flaques), au choix.
- **Conduite sur rail** (lot 1) : le véhicule suit la route tout seul. **Pilote automatique par défaut** (croisière entre 60 et 90 km/h). À la main : appui maintenu en bas à droite pour accélérer, en bas à gauche pour freiner, balayage latéral pour changer de file. Aucune collision, aucune sortie de route possible.
- **Caméras** : poursuite, rasante côté roue, avant, embarquée, travelling de bord de route (le véhicule passe devant la caméra), orbite libre. Mode **réalisateur** qui enchaîne les plans tout seul. Ralenti sur appui long.
- **Embarquée** (vague U, demande du 18 novembre 2026 : « on voit pas assez la route ») : la route se voit. L'œil de conduite part de l'œil de la place du conducteur (voiture) ou du motard (moto), monte et avance au-dessus de la planche d'après le manifeste (`interiorView.conduite`, distinct de la vue intérieure du garage) ; le regard plonge pour mettre l'horizon vers 42 à 44 % de la hauteur en paysage (47 % en portrait) ; le champ vertical se resserre en paysage (52° au lieu de 74°). Réglage du joueur **Hauteur du regard** (Bas, Normal, Haut, Très haut) dans les réglages de la sortie, rubrique Vue, à la caméra embarquée : gardé, appliqué en douceur, jamais plus haut que le pavillon moins 5 cm.
- **Le véhicule vit** : roues qui tournent, suspension qui travaille, roulis et plongée, feux stop, faisceaux des phares, néons qui se reflètent sur la chaussée, sono qui bat, flammes à l'échappement et purge de nitro si montées, hydraulique utilisable en roulant. Le bobber **penche** en courbe avec son pilote.
- **Sensation de vitesse** : traînées lumineuses, léger élargissement du champ, flou radial discret. Désactivés si mouvement réduit.
- **Son** : moteur qui suit le régime avec passages de rapports, roulement, vent, réverbération dans le tunnel, effet Doppler sur le travelling (§ 9).
- **Photo** à tout moment ; **clip** de 6 à 8 secondes partageable (P2, Android).
- Retour au garage en un geste, à l'endroit où l'on s'était arrêté.

**Cartes (décision du 15 novembre 2026).** Le décor n'est plus une boucle fictive unique : chaque carte est un **parcours de quelques kilomètres tiré d'une vraie route**.

- **Ce qui vient du lieu** : le tracé de la route, le relief, les plans d'eau, l'emprise et la hauteur des bâtiments, les tunnels et les ponts. **Ce qui reste à nous** : l'habillage (matières, néons, enseignes fictives, mobilier, végétation). Une carte est une évocation fidèle au tracé, pas une copie du lieu : aucune façade, aucun monument, aucune enseigne reproduits à l'identique.
- **Une carte = un dossier** `public/assets/maps/<id>/` et un manifeste, chargée à la demande, comme un véhicule. Elle est fabriquée sur le poste par un outil (`tools/maps/`) à partir d'un tracé donné ; **aucune donnée n'est téléchargée à l'exécution**.
- **Sources** : uniquement des données géographiques ouvertes, dont la source et la licence sont notées dans `CREDITS.md` et rappelées dans l'app : les bases de l'IGN (routes, bâtiments, hydrographie, relief) pour la France, enrichies par OpenStreetMap (lampadaires, végétation, feux, passages piétons, glissières et murs, vitesses limites, nature des commerces du bord de la route, jamais leur nom) ; OpenStreetMap seul ailleurs, avec le relief du service d'altimétrie de l'IGN là où il en a un, sinon un relief plat déclaré. Ni fond de carte dessiné, ni donnée d'un service de cartographie commercial.
- **Ordre** : 1. les lacs du plateau matheysin et La Mure ; 2. Monaco, en ville et sur le tour du circuit urbain. Ensuite, au fil de l'eau : Grenoble, Paris, Nice, Marseille, des capitales et des villes de bord de mer. Les cartes sont publiques, dans ce dépôt.
- **Deux lots** : le lot 1 livre la sortie **sur rail** décrite ci-dessus, sur la première carte ; le lot 2 ajoute la **conduite libre** : direction au pouce sur route fermée, bords de route qui retiennent le véhicule, sans dégâts ni circulation.
- **Départ et chrono** (demandés le 16 novembre 2026, en conduite libre) : chaque sortie part arrêtée, aux feux (rouge, rouge, vert), en pilote automatique comme à la main ; une ligne en damier marque le départ choisi et le bout du parcours ; le chrono part au vert et s'arrête sur la ligne d'arrivée, ou compte les tours sur un parcours en boucle ; le meilleur temps est gardé par parcours, départ et véhicule. Ni classement, ni récompense, ni adversaire à ce stade.
- **Aperçu, puis course** (demandé le 17 novembre 2026) : la sortie s'ouvre sur un **aperçu** épuré, le véhicule roulant déjà en pilote automatique avec le réalisateur, sans feux ni chrono ; à l'écran, le nom de la carte, la radio, une icône de réglages dans le coin et « Touche l'écran pour commencer ». Un appui sur la route ramène le véhicule sur la ligne du départ choisi : feux, conduite à la main, caméra de poursuite, réalisateur coupé ; le mode manette est proposé pendant les feux. Tout le reste (caméras, réalisateur, ralenti, météo, commande, direction, son, « Repartir », « Rentrer au garage ») est rangé dans les **réglages**, qui mettent la course en pause tant qu'ils sont ouverts. En course, « Pilote automatique » garde la position et le chrono et remet le réalisateur ; un appui rend le volant sur place.
- **Annonce des virages** (demandée le 17 novembre 2026) : des **balises à chevrons** réfléchissants à l'extérieur des courbes, plus serrées et posées plus tôt quand le virage est sévère ; une **mini-carte** en haut à gauche, en course seulement, orientée dans le sens de la marche, qui montre la suite du tracé et colore le prochain virage selon sa sévérité ; une flèche d'annonce, gauche ou droite, quelques secondes avant le virage.
- **Mode jour** (demandé le 17 novembre 2026) : la sortie se roule aussi de jour, au choix à côté de la météo : ciel et soleil, ombres, matières lisibles en plein jour, phares, lampadaires et néons éteints. Le nom « Sortie de nuit » du menu devient « Sortie ». Les textures des cartes (chaussée, bas-côtés, terrain, bâti, végétation) continuent d'être améliorées ; elles sont fabriquées par `tools/maps/`, sans image téléchargée.
- **Personnalisations qui étaient marquées « bientôt »** (17 novembre 2026 : à traiter, demande du commanditaire) : toutes ouvertes le 18 novembre 2026, chacune par un premier lot et avec des substituts déclarés tant qu'il n'y a pas de vrais modèles. Stickers (jalon 4 : poser des stickers, 82 motifs : les 80 du § 5.3 sont atteints depuis la vague U), Phares, Ailerons, Échappement, puis Carrosserie (lame avant, jupes, diffuseur ; le kit large reste à faire) et Moteur (l'établi du § 5.11 : moteur sorti, vue éclatée, traitement par pièce ; le moteur du van et le moteur remonté dans le véhicule restent à faire). Les nouveautés se débloquent avec les dollars gagnés en course ; ce qui manque à chaque entrée est écrit dans `TODO_ASSETS.md`.
- **Menu de la sortie par étapes** (retour du 18 novembre 2026, demandé pour la deuxième fois) : une étape à la fois, chacune remplace la précédente : le **mode** (Libre, ou Carrière et son panneau), le **lieu** (champ `zone` du manifeste de la carte : identifiant, nom du lieu, nom de la carte dans son lieu), le **circuit** du lieu avec sa miniature (sauté si le lieu n'en a qu'un), le **départ** (sauté si la carte n'en a qu'un), puis les **réglages** : moment, météo (au choix en mode libre), format, crédits des données. Le fil du menu dit où l'on est, « Retour » remonte d'une étape, chaque étape relit en une ligne ce qui est choisi. « **Sortir** » est toujours entier, sur toute la largeur du menu, collé en bas, en portrait comme en paysage (colonne de droite), en texte grand et très grand ; il redit le format et ce qu'il rapporte (la balade, pour le plaisir, sans gain ; la course, chrono, dollars et hauts faits). Le format d'une sauvegarde neuve est la **course d'un tour** ; une sauvegarde d'avant, restée sur la balade d'origine, y repart une fois. La dernière sortie est gardée : le menu se rouvre sur ses réglages, avec « Changer de circuit ».
- **Mode carrière** (demandé le 18 novembre 2026, premier lot livré par la vague U ; données dans `public/assets/carriere/carriere.json`, règles dans `src/jeu/carriere.ts`) : les mots du commanditaire, « Pour les boutons de sélection de météo on permet de sélectionner la météo en mode libre. Dans le mode carrière il faudra que ça soit automatique on fait faire des circuits au joueurs et au fur et a mesure des circuits on lui annonce le prochain est x zone x circuit et x meteo afin que le joueur puisse préparer son véhicule. Par exemple il adaptera la puissance les suspensions et les pneu en conséquence avant le début de la course. » À côté du mode libre (tout se choisit), la carrière est une **suite ordonnée de rendez-vous imposés** (douze pour commencer, sur les quatre cartes) : chacun fixe la carte, le départ, le format (1 ou 3 tours), la météo et le moment, un objectif pour passer au suivant (finir ; le bronze au moins sur les derniers) et une prime (de 40 $ à 150 $, payée une fois, en plus des gains de la course, qui compte aussi pour les records, les dollars et les hauts faits comme une course libre du même format). La difficulté monte : sec et jour d'abord, puis pluie, nuit, neige et trois tours. Le joueur sait **toujours** quel est son prochain rendez-vous (zone, circuit, météo, moment, format, objectif, prime), avec une ligne de conseil de préparation tirée des données : au garage (un bouton rond dans la colonne des raccourcis, avec la météo et le numéro du prochain rendez-vous ; un rappel dans Atelier › Jeu), dans le panneau de la carrière (« Sortir » part avec tout imposé) et sur l'écran de fin d'un rendez-vous réussi. En course, l'écran dit le rendez-vous et son objectif ; les réglages ne laissent changer ni la météo ni le moment ; abandonner ne fait rien perdre ; sous pilote automatique, la course devient une balade et le rendez-vous n'est pas validé. L'écran de fin dit le rendez-vous réussi ou manqué (ce qui manquait, de combien), propose « Retenter » ou « Rentrer au garage préparer le véhicule » ; la carrière bouclée accorde un haut fait. Pas encore : le duel contre un véhicule piloté par l'app, les univers qui se débloquent, l'effet réel des pneus et de la suspension selon la météo (lot « preparation »), dont le conseil chiffré remplacera la ligne de conseil.
- **Jeu : courses, dollars et hauts faits** (ouvert le 17 novembre 2026 à la demande du commanditaire ; jalon 13, premier lot ; contrat dans `src/jeu/contrat.ts`) : à côté de la **balade** (la conduite libre, sans gain), la **course en 1 tour** et la **course en 3 tours** (trois tours sur les cartes en boucle seulement ; sur une route ouverte, un tour est un passage du départ à l'arrivée). Contre la montre d'abord : des temps de référence par carte donnent une médaille (or, argent, bronze). À la fin, un écran affiche **les résultats** (temps total, temps par tour, record), **les gains** en dollars, ligne par ligne, et **ce qui vient d'être débloqué**. Chaque gain y **arrive à son tour** en notification, avec son effet sonore (famille « interface » : `gain` pour un haut fait, un objet, une médaille ou un record, `dollars` pour de l'argent seul ; niveau du curseur « Route ») ; un appui passe à l'écran complet ; « moins de mouvement » : tout d'emblée, un seul son ; un haut fait gagné hors course (le premier achat) s'annonce de la même façon au garage (vague U, 18 novembre 2026). Une **balade** menée au bout le dit (« pour le plaisir, sans gain ») et propose une course d'un tour sur la même route. Les **dollars** sont gardés sur l'appareil et servent à débloquer des personnalisations ; des **hauts faits** (pilotés par les données) font gagner des stickers et d'autres récompenses. Ce qui est libre le 17 novembre 2026 (peinture, roues, suspension, intérieur, ambiance, les quatre cartes) reste gratuit ; les dollars débloquent les nouveautés. Une option payante posée sans être acquise (sauvegarde gardée après la remise à zéro du jeu) **reste en place tant qu'on ne la change pas** : sa puce garde cadenas et prix, et le panneau le dit en une phrase (« … reste en place sans achat », `src/ui/nonAcquis.tsx`), même règle dans Phares, Échappement, Ailerons, Carrosserie, Moteur, Roues et Suspension (vague U, 18 novembre 2026). Le duel contre un véhicule piloté par l'app vient ensuite.
- **Jeu, les quatre chantiers ouverts le 18 novembre 2026** (ses mots, après avoir fini les douze rendez-vous de la carrière : « Il faut ajouter du challenge et se dire que c'était le mode facile ») : (1) une **suite à la carrière** : les douze rendez-vous d'aujourd'hui deviennent la première saison, la facile ; des saisons plus dures suivent (médailles d'argent puis d'or exigées, nuit, pluie, neige, trois tours, primes plus hautes), et recevront des épreuves des modes ci-dessous quand ils existeront ; (2) le **duel** contre un véhicule piloté par l'app, « toujours en attente » : un second véhicule sur la route, des niveaux de difficulté ; (3) le **drift** : « le bouton de freins devrait permettre de faire des drifts. Les drift donnent des points et on pourrait imaginer de nouvelles cartes spéciales drift » : un coup de frein bref en appui fait décrocher l'arrière, la glisse se tient au gaz ; un format jugé au score ; des cartes dédiées ensuite ; (4) le **rodéo** (son mot) : « des cartes sur des sections ligne droites en VS en mode accélération pure avec Nos, on place le Nos et des [passages] de rapport au bon moment pour être le plus rapide et gagner la course » : un face-à-face en ligne droite, départ aux feux, rapports passés à la main, NOS à placer. Ordre de fabrication : la suite de la carrière et le drift d'abord, puis l'adversaire, puis le rodéo qui s'appuie sur lui. Aucune compétition, aucun championnat, aucun pilote réels ne sont cités.
- **Modes de jeu, la suite** (vision du commanditaire, 16 novembre 2026 ; ce qui n'est pas dans le premier lot ci-dessus reste à venir) : la **course contre la montre** ; le **duel** contre un véhicule piloté par l'app ; les **univers** (les cartes) qui se débloquent peu à peu au lieu d'être tous offerts d'emblée ; des **dollars** gagnés en course, qui débloquent les améliorations de performances et les types de customisation. Le départ aux feux et le chrono en sont la première brique.
- Aucun film, aucune émission, aucune compétition n'est cité ni reproduit (§ 17) : les lieux réels, oui.

### 5.6 Projets à brief et garage libre

- **Garage libre** : aucune contrainte, tout est disponible. C'est le mode par défaut à la première ouverture.
- **Brief** : client (prénom d'un ami), titre, texte à la première personne, budget, 2 à 5 **demandes vérifiables** : pièce montée, famille de couleur (« noir », « rouge »…), finition, nombre de stickers, curseur dans une plage, sortie de nuit effectuée.
- Bandeau permanent : titre, coût courant / budget, demandes respectées.
- Dépassement de budget autorisé, signalé en rouge, commenté avec humour à la livraison.
- **Livrer** ouvre la fiche de build : photo, réaction du client (4 tons selon demandes respectées et budget), liste des pièces et prix, total, actions de partage.
- Carnet de commandes : briefs reçus, en cours, livrés.
- 20 briefs fournis au lancement (4 par véhicule de la vague 1), dans `src/data/briefs.ts`.

### 5.7 Partage sans serveur

- **Lien de build** : `…/#b=<code>`. Ouvre l'app sur ce build en lecture, avec « reprendre ce build » et « le voir rouler ».
- **Lien de défi** : `…/#d=<code>`. Un écran « Passer commande à Bichon » permet à un ami de choisir véhicule, budget, demandes (dans une liste de règles prédéfinies) et d'écrire son texte ; il génère le lien à envoyer par messagerie. À l'ouverture côté Bichon, le brief s'ajoute au carnet.
- **Photo** : capture du canvas (garage ou route) composée dans une carte (titre, total, signature), partagée par l'API Web Share avec fichier ; repli sur un téléchargement.
- Code : JSON compact, compressé (`CompressionStream`), encodé base64url, préfixé d'une version (`PMB2.`). Objectif : moins de 2 000 caractères pour un build chargé en stickers. Décodage tolérant : toute valeur inconnue retombe sur l'origine. Jamais d'exécution ni d'injection HTML à partir d'un code reçu.

### 5.8 Son (résumé, détail au § 9)

- **Radio** : stations alimentées par un dossier de lecture, plus une station « Ma playlist » pour les morceaux importés depuis le téléphone. Volumes musique, moteur et bruitages séparés.
- **Moteurs** : enregistrements réels, au garage (démarrage, ralenti, coups de gaz) et sur la route (régime, rapports).
- **Bruitages** d'atelier enregistrés.
- Aucune lecture automatique sans geste. Pause quand l'app passe en arrière-plan.

### 5.9 Sauvegarde et réglages

- IndexedDB (builds, livrées, images importées, carnet, réglages), `navigator.storage.persist()` demandé au premier lancement.
- Plusieurs builds enregistrés par véhicule (« Mes véhicules »), avec vignette.
- Annuler / rétablir sur 30 actions.
- Export / import de la sauvegarde complète par fichier, pour changer de téléphone.
- Réglages : qualité graphique (auto, économie, max), volumes, rotation automatique, pilote automatique, taille du texte.

### 5.10 Aménagement intérieur (le combi en camping-car)

Le combi a un deuxième atelier : **l'intérieur**. On y entre par la porte latérale.

- **Vues** : depuis la porte latérale ouverte, depuis le poste de conduite, orbite intérieure, et **vue en coupe** (toit retiré, façon maison de poupée) pour aménager au pouce.
- **Emplacements** (une option par emplacement, tout est démontable pour revenir à la tôle nue) :

| Emplacement | Options P1 | P2 |
|---|---|---|
| Couchage | banquette-lit pliée ou dépliée, lit fixe transversal | lit de toit |
| Cuisine | aucun, bloc kitchenette (évier, réchaud), meuble glacière | plan de travail coulissant vers l'extérieur |
| Rangements | meubles bas, placards hauts, coffre sous banquette | filets, étagères ouvertes |
| Table | aucune, table pivotante, tablette rabattable | — |
| Sièges avant | fixes, **pivotants** | — |
| Toit | tôle, **toit relevable** (ouvert ou fermé), lanterneau | toit panoramique |
| Plancher | parquet, lino damier, moquette, alu strié | — |
| Parois et plafond | tôle peinte, lambris bois, capitonné losange, tissu | — |
| Rideaux | aucun, unis, à motifs (couleurs libres) | stores |
| **LED au plafond** | **ciel étoilé** (points lumineux, densité réglable), rubans en périphérie, spots encastrés ; couleur libre, intensité, pulsation lente sur la musique | motifs dessinés au plafond |
| Ambiance | guirlande, lampe tempête, néon mural | boule à facettes |
| Sono | aucune, enceintes de portes, caisson sous banquette | écran rabattable |
| Déco | plaid, coussins, plantes, guitare, planche, autocollants de voyage sur les vitres | — |

- **Extérieur camping** : galerie avec coffre, échelle, store banne (replié ou déployé), porte-vélos, roue de secours à l'avant, jerrican, douchette.
- Chaque meuble et chaque habillage se colore et change de matière (essences de bois, tissus, cuirs, stratifiés) avec les outils du § 5.2.
- **Bivouac** (P2) : le combi posé de nuit, store déployé, lumières intérieures allumées qui éclairent dehors, feu de camp. Mode photo disponible.
- Le mécanisme est générique : tout véhicule peut déclarer des emplacements intérieurs dans son manifeste (sono, sièges et habitacle des autres voitures passent par là).

### 5.11 Établi moteur et pièces sur l'établi

- **Sortir le moteur** : le capot s'ouvre, le moteur est déposé sur un support tournant au milieu du garage (plan de 3 secondes, passable). Orbite libre autour du moteur.
- **Vue éclatée** : un curseur écarte les pièces le long de leurs axes, pour atteindre et choisir chacune.
- **Chaque pièce est une zone** : bloc, carters, cache-culbuteurs, culasses, tôles de refroidissement, turbine, carburateurs, filtres à air, collecteur, poulie, alternateur, distributeur, fils de bougie, durites, visserie.
- **Traitements par pièce** : peinture haute température (couleur libre), **chrome**, poli miroir, brossé, anodisé couleur, noir satiné, vermiculé, brut de fonderie, rat look. Fils et durites : couleur libre. Visserie : inox, noire, dorée.
- **Échanges de pièces** : carburation simple ou double, filtres (boîtier, cornets, coniques), turbo ou compresseur, collecteur et échappement, habillages. Ce qui change l'admission ou l'échappement change le son (§ 9).
- **Remontage** : le moteur retourne dans le véhicule avec sa finition ; il reste visible si le capot est ajouré ou déposé.
- Un modèle de moteur **par famille** (4 à plat partagé par la Cox et le combi, bicylindre en V, V8, 4 en ligne de moto…), déclaré dans le manifeste du véhicule.
- **Toute pièce sur l'établi** : un appui sur une pièce montée (jante, pare-chocs, guidon, échappement, rétroviseur…) propose « sur l'établi ». La pièce s'isole, et reçoit couleur et finition propres, indépendantes de la carrosserie.
- Ce n'est pas une simulation mécanique : pas de pannes, pas de réglages, pas de calcul de puissance.
- **Choisir, puis agir ; optimiser** (retour du 18 novembre 2026) : l'entrée va en deux étapes qui se remplacent, la liste des pièces (vue éclatée, rappel du traitement et du niveau, total du moteur), puis les actions de la pièce choisie, en volets (finition, optimisation, échange), la caméra cadrée sur elle ; Custom · Carrosserie fait de même (élément, puis ses options). Les pièces d'admission, de culasse, d'échappement, d'allumage et de carburation ont un ou deux niveaux d'optimisation payants (noms d'atelier inventés, `src/data/optimisation.ts`) : quelques pour cent chacun, 14 à 15 % au plus par moteur, multipliés à la Préparation et lus par la conduite. Seule exception à la puce précédente : des chiffres d'atelier pour le plaisir, sans simulation ; les temps de référence restent ceux du véhicule d'origine.

### 5.12 Télé du garage (option, décidée le 14 novembre 2026)

- **Par défaut, rien ne sort de l'app.** L'écran du garage diffuse ce que l'app produit elle-même : la photo du dernier build livré, un diaporama des builds, plus tard les clips de sortie de nuit. La musique vient de la radio hors ligne du § 9.
- **En option** : toucher l'écran ouvre un panneau « Télé » avec le lecteur officiel de YouTube, sur **la playlist que l'utilisateur a lui-même renseignée** dans les réglages. Le lien reste sur son téléphone ; rien n'est écrit en dur dans le dépôt. C'est le moyen d'avoir d'autres vidéos ou d'autres musiques sans mise à jour de l'app.
- C'est **la seule exception** à la règle « aucune requête vers un tiers ». Rien ne part vers l'extérieur tant que la télé n'a pas été ouverte, l'app n'en dépend jamais, et hors ligne le panneau dit simplement que la télé reviendra avec le réseau. Domaine sans cookie de suivi quand il existe.
- Le lecteur reste dans son panneau, à la taille et selon les règles d'intégration du service : il ne se plaque pas sur l'écran 3D et ne se mélange pas au son de l'app. La radio se met en pause pendant qu'il joue.
- Priorité P2, avec la personnalisation du garage (jalon 11).

## 6. Modèle de données

```ts
type VehicleId = string;                              // = nom du dossier dans public/assets/vehicles/
type Hex = string;                                   // '#rrggbb', couleur libre

interface Paint   { color: Hex; finish: FinishId; flake?: number; color2?: Hex; linked?: boolean; }
interface Sticker { art: string; text?: string; font?: string; x: number; y: number; scale: number; rot: number;
                    flip?: boolean; color?: Hex; opacity?: number; }
interface Build {
  parts:  Record<string /* slotId */, string /* optionId */>;
  paints: Record<string /* zoneId */, Paint>;
  tune:   Record<string /* paramId */, number>;      // curseurs : hauteur, carrossage, fourche…
  livery: Record<string /* zoneId */, Sticker[]>;
  glow:   { zones: Record<string, Hex | null>; mode: 'fixe' | 'pulse'; };   // une couleur par zone
  wrap?:  { kind: 'flames' | 'pattern' | 'gradient'; art?: string; colors: Hex[]; params: Record<string, number>; };
  plate?: string;
  partPaints?: Record<string /* slotId */, Paint>;      // pièce passée sur l'établi
  engine?: { parts: Record<string, string>; paints: Record<string, Paint>; };
  interior?: { modules: Record<string /* emplacement */, string>; paints: Record<string, Paint>;
               ceiling?: { kind: 'stars' | 'strip' | 'spots'; color: Hex; level: number; density?: number; pulse?: boolean; }; };
}

interface Option  { id: string; label: string; price?: number; node?: string; tier: 'P1' | 'P2'; anim?: string; }
interface Slot    { id: string; label: string; anchor?: string; options: Option[]; }
interface Param   { id: string; label: string; min: number; max: number; step: number; def: number; unit?: string; }
interface Zone    { id: string; label: string; material: string; livery?: { uv: 2; size: 1024 | 2048 }; }
interface Vehicle { id: VehicleId; name: string; kind: 'car' | 'bike'; wave: 1 | 2 | 3; glb: string; engine: EngineId; shared: string[] /* bibliothèques de pièces partagées */; engineModel: string /* famille de moteur, dossier partagé */; interiorSlots?: Slot[]; slots: Slot[]; params: Param[]; zones: Zone[]; presets: Record<string, Build>; }

interface Rule  { id: string; label: string; test: (b: Build, ctx: { drove: boolean }) => boolean; }
interface Brief { id: string; vehicle: VehicleId; client: string; title: string; text: string; budget: number; rules: string[]; }

interface SharedBuild { v: VehicleId; b: Build; }    // PMB2.<base64url(deflate(JSON))>, images importées exclues
interface SharedBrief { v: VehicleId; c: string; t: string; x: string; g: number; r: string[]; }
```

Chaque véhicule est décrit par un manifeste `public/assets/vehicles/<id>/vehicle.json` (type `Vehicle`), découvert au build ; rien n'est codé en dur par véhicule.

Le catalogue est **piloté par les données** : ajouter une pièce = un nœud dans le GLB + une ligne dans `src/data/catalog.ts` ; ajouter un sticker = un SVG dans `public/assets/stickers/` + une ligne dans `src/data/stickers.ts`. Aucune logique propre à une pièce dans les composants.

## 7. Architecture et stack

- **Vite + React + TypeScript**.
- **three.js** via **React Three Fiber** et **drei** ; **@react-three/postprocessing** pour le bloom. Renderer WebGL 2 ; WebGPU à réévaluer une fois le jalon 1 atteint, seulement s'il apporte un gain visible. Figer les versions dans `package.json` au démarrage.
- État : **Zustand** (un store, persistance IndexedDB via `idb-keyval`).
- PWA : **vite-plugin-pwa** (Workbox), précache de tout sauf la musique, mise en cache de la musique station par station à la première écoute, avec un écran « Préparation du garage ».
- Audio : **Web Audio API** en direct (pas de moteur audio lourd). Un module `audio/` autonome : mixeur, radio, bruitages, moteurs.
- Routage par **hash** uniquement (`#b=`, `#d=`, `#/commande`), parce que GitHub Pages ne sert que des fichiers statiques.
- Tests : **Vitest** (logique : coût, règles, encodage des liens), **Playwright** (parcours et captures d'écran du canvas).
- Aucune dépendance à un service tiers au moment de l'exécution : polices, textures, sons et modèles sont servis par l'app. Seule exception, facultative et à la demande : la télé du § 5.12.
- **Véhicules à la demande** : le premier lancement ne précache que le garage et le dernier véhicule utilisé ; les autres se téléchargent à la première sélection puis restent hors ligne. Un écran « Mes véhicules » montre ce qui est déjà sur le téléphone.
- **Intérieur** (`interior/`) et **établi** (`bench/`) : deux modes de la même scène de garage, pilotés par le manifeste du véhicule.
- **Dossier de lecture** : un script de build indexe les fichiers audio trouvés dans les dossiers de stations (titre, artiste, durée lus dans les métadonnées) et génère le manifeste de la radio. Déposer un fichier suffit.
- **Livrée** : module `livery/` autonome. Chaque zone est un canvas 2D composé à partir des calques, envoyé en texture sur le jeu d'UV dédié ; recomposition uniquement quand un calque change.
- **Sortie de nuit** : module `drive/` autonome, scène séparée chargée à la demande (le garage est déchargé pendant la sortie pour tenir la mémoire). Cinématique le long d'une spline, sans moteur physique.
- **Moteur audio des véhicules** : lecture d'échantillons en boucle fondus par régime (voir § 9). Pas d'oscillateur dans cette chaîne.

## 8. Exigences 3D

### Cible : rendu showroom néon

Semi-réaliste : des modèles **lisses et détaillés**, une peinture qui se comporte comme une vraie laque, et surtout **les lumières du décor qui se lisent dans la carrosserie**. Références : § 4. Le rendu du prototype (formes simples, à-plats) est explicitement insuffisant.

Les ingrédients exigés, tous présents au niveau de qualité standard sauf mention :

1. **Peinture multicouche** : base (couleur, paillettes en normal map à échelle réglable), vernis (clearcoat) avec léger grain de peau d'orange, Fresnel marqué. Candy, nacré et caméléon par iridescence ou mélange de teintes selon l'angle. Chrome et chrome coloré : métal pur, rugosité ≈ 0,03 à 0,08, teinte libre. Rat look, carbone et brossé par textures dédiées (anisotropie pour le brossé).
2. **Reflets locaux** : une sonde de réflexion par décor (cubemap rendue depuis la position du véhicule, 256 à 512 px par face), mise à jour quand l'éclairage change au garage, et toutes les quelques images en sortie de nuit. C'est ce qui fait apparaître les tubes néon et les enseignes dans la caisse : **ingrédient non négociable**.
3. **Sol réfléchissant** : réflexion planaire floutée, modulée par une carte de rugosité (flaques, carrelage, béton). Version allégée (demi-résolution) en standard, pleine en max, faux reflets en économie.
4. **Sources lumineuses lisibles** : tubes LED et enseignes en géométrie émissive, **bloom sélectif** sur les émissifs, halos additifs sur le sol et les murs. Jusqu'à 4 lumières surfaciques en max ; le reste précalculé.
5. **Atmosphère** : brume volumétrique simulée (brouillard + cônes et nappes en billboards additifs), particules de pluie et éclaboussures instanciées en sortie.
6. **Ombres et occlusion** : lightmaps et occlusion précalculées pour les décors, ombre de contact sous le véhicule, occlusion ambiante en espace écran en max.
7. **Étalonnage** : tone mapping filmique, table de correspondance des couleurs par ambiance (bleu-magenta par défaut), vignettage léger, grain discret. Anticrénelage MSAA + SMAA.
8. **Détails qui font vrai** : optiques de phares avec lentille et réflecteur, feux arrière allumés, disques et étriers visibles derrière les jantes, sculptures de pneus en normal map, joints de carrosserie, habitacle visible à travers les vitres teintées.

### Rendu photo

Quand la caméra s'immobilise en mode photo, l'image **s'affine en une à deux secondes** : accumulation d'images décalées (suréchantillonnage), sonde de réflexion haute résolution, ombres adoucies, profondeur de champ. C'est cette image qui part dans les partages, en 2160 px de large. Un traceur de chemins dans le navigateur (`three-gpu-pathtracer`) est à évaluer en P2 pour ce seul usage.

### Modèles

- Carrosseries subdivisées et lisses, sans facettes visibles ; arêtes chanfreinées ; normales propres pour que les reflets filent sans cassure.
- **150 000 à 400 000 triangles** par véhicule complet sur l'appareil de référence, avec un niveau de détail réduit (≈ 40 %) pour la sortie de nuit et le niveau économie.
- Textures PBR en 2048 px pour la caisse et l'habitacle, 1024 px ailleurs, en KTX2.
- Chaque véhicule respecte les conventions ci-dessous ; les pièces partagées vivent dans `public/assets/shared/`.
- **Moteurs** : un modèle détaillé par famille dans `public/assets/shared/engines/<famille>/`, chaque pièce en maillage séparé et nommé (`part_<nom>`), avec un vecteur d'éclatement par pièce. 40 000 à 80 000 triangles.
- **Intérieur du combi** : volume complet modélisé (tôles, montants, plafond, plancher), modules d'aménagement en nœuds `interior__<emplacement>__<option>`. LED de plafond en émissif piloté (texture de points pour le ciel étoilé), pas en lumières réelles.

### Garage

Construit d'après le § 4, textures créées (OSB, carrelage, lambris, béton), éclairage précalculé par ambiance lumineuse. Les objets du § 4 sont présents et reconnaissables ; leur emplacement exact est libre.

### Livrée

- Jeu d'UV n°2 sans chevauchement sur chaque zone de livrée, dépliage à plat lisible (un flanc = un rectangle), même repère gauche et droite pour la symétrie.
- Jeu d'UV n°3 **continu sur toute la caisse** pour les livrées intégrales (flammes, covering, dégradés), sans couture visible entre capot, ailes et portes.
- Textures de livrée en 2048 px pour la caisse, 1024 px ailleurs.
- La livrée se mélange à la peinture dans le même matériau : elle prend le vernis, les paillettes et les reflets.

### Sortie de nuit

- Une carte par dossier (§ 5.5) : ruban de route et relief produits par l'outil à partir du tracé réel, découpés en tronçons chargés puis libérés au fil de la route ; volumes des bâtiments, mobilier et végétation **instanciés**, un atlas de textures, éclairage précalculé + émissifs. Le budget « décor de route » ci-dessous vaut par carte.
- Chaussée détrempée : réflexion planaire allégée + carte de flaques ; sonde de réflexion mobile pour la caisse.
- Brouillard pour fermer l'horizon et masquer le chargement.
- Pilote des motos : silhouette générique articulée (épaules, bras, tête), casque et blouson colorables.
- Éléments animés du véhicule exposés par le GLB : roues, direction, suspension, portes, capots, membranes de sono.

### Budgets (appareil de référence)

| Élément | Standard | Max |
|---|---|---|
| Véhicule à l'écran | 150 000 à 250 000 triangles, 60 draw calls | jusqu'à 400 000 triangles, 80 draw calls |
| Décor de route visible | 150 000 triangles, 60 draw calls | 250 000 triangles |
| Textures | 2048 px caisse et atlas, 1024 px ailleurs, KTX2 | idem |
| Poids par véhicule | 8 à 15 Mo, toutes variantes | idem |
| Poids des décors | garage 6 à 10 Mo, route 8 à 12 Mo | idem |
| Cadence | 60 i/s au garage, **30 i/s plancher en sortie** | 30 i/s partout |
| Pixel ratio | plafonné à 2 ; rendu à la demande quand rien ne bouge | idem |

Premier lancement : 25 à 40 Mo (app, garage, un véhicule). Chaque véhicule ajouté : 8 à 15 Mo. Musique à part.

Trois niveaux de qualité (économie, standard, max) choisis automatiquement d'après la cadence mesurée (`PerformanceMonitor` de drei), modifiables à la main. Le niveau économie garde la peinture multicouche et la sonde de réflexion ; il coupe la réflexion planaire, l'occlusion écran et la brume.

### Conventions de modélisation (contrat entre Blender et le code)

- Un dossier par véhicule : `vehicles/<id>/body.glb` (+ `body_lod1.glb`), `vehicle.json`, `thumb.webp`, `engine/`. Unités en mètres, +Y vers le haut, avant du véhicule vers +X, origine au sol au centre de l'empattement.
- Chaque variante est un nœud nommé `slot__option` (ex. `wheels__empi8`, `bars__ape`). Le code affiche le nœud de l'option active et masque les autres.
- Points d'ancrage : empties nommés `anchor_<nom>` (roues : une géométrie, quatre ancres). Pivots animables nommés `pivot_<nom>` (portes, capots, fourche, direction).
- Les curseurs agissent sur des ancres et des pivots, jamais sur la géométrie.
- Matériaux nommés par rôle : `paint_<zone>`, `chrome`, `alu`, `black`, `rubber`, `glass`, `leather`, `lamp`, `tail`. Le code remplace `paint_<zone>` par le matériau de la zone.
- Aucun logo, aucun texte de marque dans la géométrie ou les textures.

## 9. Exigences audio

**Règle de base** : dans l'app livrée, aucun moteur ni aucune musique n'est synthétisé. La synthèse du prototype a été rejetée à l'écoute. Tant qu'un fichier réel manque, l'emplacement reste **muet et signalé** dans `TODO_ASSETS.md` ; on ne le comble pas par un oscillateur.

### Moteurs

Un jeu de sons par véhicule, rangé dans son dossier. Signatures de la vague 1, à rendre reconnaissables : **4 cylindres à plat refroidi par air** (Cox), **4 cylindres turbo diesel** (van), **bicylindre en V à calage irrégulier** (bobber), **gros V8 américain** (fastback), **4 cylindres en ligne de moto à haut régime** (sportive). Vague 2 : 6 cylindres en ligne (berline 90), V8 (pick-up), V6 ou diesel (4x4), 4 cylindres turbo (coupé).

- Si l'on ne dispose que de prises continues (démarrage, ralenti, montée en régime, passage), le pipeline `tools/` y découpe des tranches stables, les boucle, et déduit leur régime ; à défaut, lecture granulaire le long d'une montée en régime. C'est le cas le plus courant avec les banques de sons.
- Méthode : **échantillons réels en boucle**, plusieurs par régime, fondus entre voisins et accordés par `playbackRate` (écart maximal ± 25 % autour du régime enregistré). Deux couches par régime si disponibles : en charge et en décélération, mélangées selon l'accélérateur.
- Jeu minimal par moteur : `start`, `idle` (boucle), `low` (≈ 2 000 tr/min), `mid` (≈ 3 500), `high` (≈ 5 000), `stop`, 3 `backfire`. Jeu complet : variantes `_on` / `_off` pour `low`, `mid`, `high`, et un `rev` (coup de gaz à vide).
- Un manifeste `engine.json` par jeu indique le régime réel de chaque boucle et ses points de bouclage.
- L'échappement choisi change le **jeu d'échantillons** quand il existe (origine / libre), sinon applique une égalisation et une saturation propres à la pièce. Turbo monté : sifflement et soupape de décharge.
- Au garage : démarrage, ralenti qui tourne tant qu'on le laisse, coup de gaz à l'appui, coupure.
- Sur la route : modèle simple régime ← vitesse et rapport (boîte automatique, nombre de rapports et régime maximal lus dans le manifeste du véhicule), chute de régime au passage, retour de flammes à la décélération si l'échappement le permet.
- **Acceptation** : écoute à l'aveugle par le commanditaire, au casque puis sur le haut-parleur du téléphone. Verdict attendu : « on dirait un vrai », pour chaque véhicule. Contrôle automatique : aucun `createOscillator` dans `src/audio/engine/`.

### Musique

**Aucun morceau du commerce n'est fourni par le code.** La radio lit ce qu'on lui donne, par les voies ci-dessous ; elle n'embarque qu'une musique à elle, la musique d'accueil (point 4).

1. **Dossier de lecture** (au build) : un dossier par station, `radio/<station>/`. On y dépose des fichiers audio ; le build les indexe, les normalise et les encode. Trois stations prévues par défaut (hip-hop et R&B, rock, électro), mais le nombre de stations suit le nombre de dossiers. Une station vide n'apparaît pas.
2. **Import depuis le téléphone** (dans l'app) : « Ajouter mes morceaux » ouvre le sélecteur de fichiers ; les morceaux choisis sont copiés dans le stockage privé de l'app (OPFS), restent sur l'appareil, fonctionnent hors ligne et forment la station **« Ma playlist »**. Rien n'est envoyé ni partagé.
3. **Pack de musique** (décidé le 14 novembre 2026) : un fichier ZIP par style, non chiffré, que l'on remet à l'utilisateur en privé, par messagerie. L'app l'importe en un geste, depuis son sélecteur de fichiers ou comme cible de partage du téléphone, garde le pack dans le stockage privé de l'appareil et en fait une **station personnelle par pack** (le dossier du ZIP donne son nom à la station). Les packs ne passent jamais par le dépôt ni par le site ; `npm run radio:pack` les fabrique sur le poste à partir du dossier privé `ma-playlist/`. Complément du 15 novembre 2026 : un pack peut réunir plusieurs stations (un dossier par station), et entrer aussi par son **adresse**, saisie dans l'app ou portée par un lien vers l'app (`?pack=<adresse du pack>`) qui ouvre la radio et télécharge le pack aussitôt, sans appui (décision du même jour, après essai sur le téléphone ; seule l'économie de données du navigateur redemande un appui). À la fin d'un import, la lecture démarre seule sur la station la plus fournie ; à l'ouverture de l'app, la radio reprend seule là où elle s'était arrêtée. Un réglage « Lecture automatique » coupe ces départs. L'adresse vient toujours de l'utilisateur et n'est jamais écrite dans le dépôt ; c'est la seconde exception à la règle « aucune requête vers un tiers à l'exécution ».
4. **Musique d'accueil** (décidée le 15 novembre 2026) : quelques morceaux générés par le commanditaire, qui en a les droits d'usage, crédités dans `CREDITS.md` (licence « droits du commanditaire », admise pour ce seul dossier par `npm run assets:check` et `npm run audio:check`). Ils vivent dans `public/assets/audio/radio/accueil/` avec un manifeste `station.json` (nom de la station, ordre, titres, durées ; `npm run radio:accueil` le réécrit d'après les fichiers présents, `npm run audio:check` vérifie qu'il les liste exactement) et forment une station de base, « Atelier FM », servie par l'app : lue en flux, jamais copiée dans le stockage privé, hors du précache du service worker (un morceau n'est demandé que quand il joue, puis gardé à sa première écoute pour rejouer hors ligne ; un morceau jamais entendu est sauté hors ligne), et impossible à supprimer. Elle part seule tant que la radio n'a aucun pack (ouverture de l'app, lien `?pack=`, téléchargement ou import en cours), si le réglage « Lecture automatique » et le navigateur le permettent. Dès que le pack est prêt, la radio passe en fondu (2 s) sur la station que l'app choisit d'habitude (champ « depart », sinon la plus fournie). Un geste de l'utilisateur sur la station d'accueil (pause, morceau suivant ou précédent, choix de la station ou d'un de ses morceaux) annule cette bascule : le pack attend dans la liste et c'est lui qui change de station ; toucher l'écran pour lancer la musique ou appuyer sur Lecture n'est pas un choix de station. Avec un pack sur le téléphone, la station d'accueil ne démarre jamais seule.

- Niveau : normalisation automatique vers −14 LUFS environ, crête vraie ≤ −1 dBTP.
- Dossier de lecture : encodage **Opus** à 128–160 kbit/s, mise en cache station par station à la première écoute.
- Habillage radio : fondu enchaîné, titre et artiste affichés, lecture aléatoire ou dans l'ordre, Media Session API pour l'écran verrouillé.
- En sortie de nuit, la musique passe par un traitement « autoradio » léger en vue extérieure et pleine bande en vue embarquée.
- **Licences** : ne déposer dans le dossier de lecture que des morceaux dont la licence autorise l'intégration dans une application diffusée en ligne (voir § 10.2 et § 17). Les morceaux du commerce passent par l'import sur le téléphone, jamais par le dépôt.

### Bruitages et ambiances

Enregistrements réels : clé à chocs, cliquet, pistolet à peinture, raclette de pose de sticker, porte de garage, néon qui s'allume, compresseur d'hydraulique, portières, klaxons, purge de nitro ; roulement sur chaussée mouillée, vent, passage en tunnel. Sons d'interface courts et discrets.

### Mixage

- Bus musique, moteur, bruitages → compresseur → limiteur. La musique baisse légèrement quand le moteur monte.
- **Graves** : étagère basse et saturation douce pour que les basses et les moteurs s'entendent aussi sur un haut-parleur de téléphone, qui ne restitue presque rien sous 200 Hz. Le « son lourd » se juge au casque ou sur enceinte ; l'app le suggère une fois.
- Réverbération à convolution pour le garage (courte) et le tunnel (longue).
- Origine de chaque fichier tracée dans `assets/audio/CREDITS.md` (source, licence, date, preuve d'abonnement pour la musique générée).

## 10. Chaîne de production sous Linux

### 10.1 3D

1. **Blender** (version LTS courante) : modélisation, UV, ancres, pivots, lightmaps. Un `.blend` par véhicule, par bibliothèque de pièces partagées et par décor dans `assets-src/`.
2. Export glTF binaire par script **Blender en ligne de commande** (`blender -b fichier.blend --python tools/export.py`) pour un export reproductible.
3. **glTF Transform** en CLI : dédoublonnage, Meshopt, textures KTX2 (nécessite **KTX-Software** installé), redimensionnement. Commande type : `gltf-transform optimize in.glb out.glb --compress meshopt --texture-compress ktx2 --texture-size 1024`.
4. Contrôle : `gltf-transform inspect`, puis test dans l'app.
5. Textures : **Krita**, **GIMP**. Stickers : **Inkscape** ou SVG écrits à la main. Matériaux procéduraux : **Material Maker**.

Un `Makefile` ou des scripts `npm run assets:*` enchaînent les étapes 2 à 4.

**Sources de modèles.** Avec la cible de rendu du § 8, les véhicules ne peuvent plus être générés par du code : il faut de vrais modèles. Par ordre de préférence :

1. **Commande à un modeleur indépendant**, avec cession des droits et cahier des conventions du § 8. C'est la seule voie qui garantit des silhouettes sans marque, des pièces séparées et une licence propre. Le budget dépend du niveau de détail et du nombre de pièces : à chiffrer sur devis, véhicule par véhicule.
2. **Modèle sous licence CC0 ou CC-BY** retravaillé dans Blender (découpe en pièces, ancres, UV de livrée), crédité dans `CREDITS.md`.
3. **Modèle acheté sur une place de marché**, seulement si sa licence autorise la diffusion dans une application web **et** la présence du fichier dans un dépôt public. Beaucoup de licences l'interdisent : dans le doute, ne pas l'utiliser, ou garder les assets dans un dépôt privé et vérifier que la mise en ligne reste permise.
4. Blender + Blender MCP pour les **pièces mécaniques et les accessoires** (jantes, échappements, guidons, galeries, sono, décor), pas pour les carrosseries.
5. Génération par IA pour les accessoires de décor uniquement.

**Banc d'essai du rendu (jalon 1)** : pour régler peinture, reflets et éclairage avant d'avoir les modèles définitifs, utiliser le modèle `CarConcept` des glTF Sample Assets de Khronos (voiture-concept sans marque automobile, licence CC-BY 4.0, porte des logos Khronos). Usage interne au réglage ; ne pas le livrer comme véhicule du catalogue définitif. À la demande du commanditaire (15 novembre 2026), il figure dans la première version livrée sous le nom « Le concept », comme substitut déclaré.

### 10.2 Audio

- **ffmpeg** : encodage Opus, normalisation (`loudnorm`), découpe.
- **Audacity** : nettoyage et bouclage des prises moteur (boucle calée sur un nombre entier de cycles moteur).
- **Sources de moteurs et de bruitages**, par ordre de préférence :
  1. enregistrements de ses propres véhicules, si des fichiers apparaissent ;
  2. **CC0** (Freesound filtré sur CC0) : seuls fichiers qui peuvent vivre sans contrainte dans le dépôt public ;
  3. bundles GDC de Sonniss (libres de redevance, usage commercial, sans attribution, redistribution uniquement intégrée à un projet) ;
  4. **banque par abonnement** de type Envato Elements : usage dans un logiciel permis si le son est intégré et non extractible, une licence à enregistrer par projet, **interdiction de redistribuer les fichiers sources**. Donc jamais dans le dépôt public (§ 11). Une présélection de prises est dans `docs/SOURCING_AUDIO.md`.
- **Sources de musique pour le dossier de lecture** : morceaux sous CC0 ou CC-BY, bibliothèques dont la licence autorise l'intégration dans une application, morceaux générés avec droits d'usage acquis, commande à un beatmaker. Les abonnements pensés pour la vidéo en ligne (type Epidemic Sound en formule standard, ou la musique d'Envato Elements) **ne couvrent pas clairement une radio dans une application** : demander une confirmation écrite à l'éditeur avant d'y déposer un seul titre.
- **Bruitages** : mêmes bibliothèques que les moteurs ; packs CC0 pour l'interface.

### 10.3 Ce que Claude Code ne peut pas fabriquer

Claude Code écrit tout le code, les stickers SVG, les textures procédurales, les briefs et les scripts de la chaîne d'assets. Il ne peut **pas** produire :

| À fournir par un humain | Emplacement | Bloque le jalon |
|---|---|---|
| Boucles et sons moteur, un jeu par véhicule (jeu minimal du § 9) | dépôt d'assets, `engines/<famille>/` | 9 |
| Morceaux du dossier de lecture (licence vérifiée) | `radio/<station>/` dans le dépôt d'assets | 9 |
| Bruitages d'atelier et de route | dépôt d'assets, `sfx/` | 9 |
| Modèles définitifs des 5 véhicules de la vague 1 (dont l'intérieur du combi), aux conventions du § 8 | `public/assets/vehicles/<id>/` | 6 et 7 |
| Modèles de moteur détaillés, un par famille | `public/assets/shared/engines/<famille>/` | 5 |
| Modèles de la vague 2 | idem | 12 |
| Validation à l'écoute et sur le téléphone | — | chaque jalon |

En attendant, le code fonctionne avec le modèle de banc d'essai et les véhicules procéduraux du prototype (déclarés comme substituts), et des emplacements audio muets. `TODO_ASSETS.md` tient la liste à jour.

## 11. PWA, déploiement, Android

### GitHub Pages

- Site statique uniquement, publié par un workflow GitHub Actions (`actions/upload-pages-artifact` + `actions/deploy-pages`) à chaque push sur `main`.
- **Ce que la publication attend** (décidé le 18 novembre 2026 : « 45 minutes pour un deploy c'est trop long », en gardant un bon niveau de qualité) : le build et les contrôles (types, lint, garde-fous, assets, audio, tests unitaires) et les **parcours essentiels**, une vingtaine de parcours Playwright marqués `@essentiel` (`npm run test:e2e:essentiel` : l'app s'ouvre, hors ligne, mise à jour, menu et « Jouer », menu de la sortie, peinture, changement de véhicule, achat, la route se charge et ses matières se compilent), soit une dizaine de minutes. La **passe complète** des parcours tourne à chaque push, en parallèle, sans retenir la publication : un échec y est corrigé et repart avec la publication suivante. Un parcours qui garde un geste dont l'app ne peut pas se passer se marque `@essentiel` ; les autres restent dans la passe complète.
- Site de projet : l'app vit sous `/<nom-du-dépôt>/`. Régler `base` dans Vite, `scope` et `start_url` dans le manifeste, et tous les chemins d'assets en relatif.
- Limites à respecter : site ≤ 1 Go, bande passante indicative 100 Go/mois, déploiement ≤ 10 minutes. Ne pas versionner les `.blend` lourds ni les masters audio dans le dépôt de l'app (dossier séparé ou Git LFS hors Pages).
- Avec un compte GitHub gratuit, Pages exige un **dépôt public** : tout ce qui est poussé est visible. L'URL du site est publique dans tous les cas.
- Pas d'en-têtes HTTP personnalisés : ne rien concevoir qui exige `SharedArrayBuffer`.

### Android, trois niveaux

1. **PWA installée depuis Chrome** (recommandé pour démarrer) : « Ajouter à l'écran d'accueil ». Aucun outillage. L'installer soi-même sur son téléphone, en wifi, et laisser le précache se terminer.
2. **APK Capacitor** (recommandé si l'on veut une « vraie app ») : les fichiers web sont embarqués dans l'APK, donc **hors ligne dès l'installation**. Nécessite JDK + Android SDK sur le poste Linux. Distribution par envoi direct de l'APK.
3. **APK TWA via Bubblewrap** (seulement si publication sur le Play Store) : l'APK affiche le site hébergé. Exige un fichier `/.well-known/assetlinks.json` **à la racine du domaine** ; sur GitHub Pages cela impose un dépôt `<compte>.github.io` ou un domaine personnalisé, plus un `.nojekyll`.

Test sur appareil : `adb` + `chrome://inspect` pour la console et les performances en USB.

### Assets sous licence : hors du dépôt public

Tout fichier dont la licence interdit la redistribution (sons de banques payantes, modèles achetés, musique) suit ces règles :

- Il vit dans un **dépôt privé séparé** (`PimpMyBichon-assets`), jamais dans celui-ci.
- Le workflow de déploiement le récupère par une clé de déploiement, puis construit le site. L'artefact publié contient les fichiers, le dépôt public non.
- Au build, les sons sont **regroupés en paquets binaires** (un par véhicule, un pour les bruitages) plutôt que servis un par un, pour qu'ils ne soient pas récupérables tels quels. C'est une précaution, pas une garantie juridique : si une licence exige que le fichier soit inaccessible à l'utilisateur, préférer l'APK.
- Sans accès au dépôt privé (clone tiers, poste neuf), le build passe quand même : emplacements muets et substituts déclarés.
- Seuls les fichiers CC0, ou créés pour le projet, peuvent rester dans le dépôt public.

## 12. Outillage Claude Code

### Logiciels à installer sur le poste Linux

| Outil | Rôle | Obligatoire |
|---|---|---|
| Node.js LTS, git, GitHub CLI (`gh`) | build, dépôt, déploiement | oui |
| Blender LTS | modèles, UV, lightmaps, export | oui |
| KTX-Software | compression des textures en KTX2 | oui |
| ffmpeg | encodage et normalisation audio | oui |
| `uv` (Python) | lance le serveur MCP Blender | si MCP Blender |
| Audacity | montage des prises moteur | recommandé |
| Krita / GIMP / Inkscape | textures, décos, icônes | recommandé |
| Android platform-tools (`adb`) | test sur le téléphone | recommandé |
| JDK + Android SDK | APK Capacitor ou Bubblewrap | optionnel |

### Serveurs MCP à brancher dans Claude Code

| Serveur | Apport | Commande |
|---|---|---|
| **Blender MCP** (`ahujasid/blender-mcp`) | Claude Code pilote une session Blender ouverte : crée et modifie des objets, pose les ancres, applique des matériaux, exécute du Python, importe des assets Poly Haven | `claude mcp add blender uvx blender-mcp` + installer l'add-on `addon.py` dans Blender |
| **Playwright MCP** | Claude Code ouvre l'app, prend des captures du canvas, vérifie le rendu et les parcours | voir la doc du projet pour la commande à jour |
| **Chrome DevTools MCP** (optionnel) | traces de performance, mémoire GPU | idem |
| **Context7** (optionnel) | documentation à jour de three.js, R3F, drei, Workbox | idem |

Précautions Blender MCP : l'outil exécute du Python arbitraire dans Blender, donc **enregistrer avant chaque session** et travailler sur des copies ; télémétrie désactivable par la variable `DISABLE_TELEMETRY=true`. Attente réaliste : très utile pour les pièces mécaniques (cadre, roues, échappements, guidons, galerie), l'assemblage, le nommage et l'export en série ; **insuffisant seul pour une carrosserie galbée**, qui demande une main humaine.

### Skills

- Skills three.js / R3F communautaires (par exemple `cloudai-x/threejs-skills`), installées dans `.claude/skills/`. **Les relire avant installation** : une skill est un jeu d'instructions chargé dans l'agent.
- La skill maison existante de déploiement PWA sur GitHub Pages, si elle couvre Vite + `base` + workflow Pages.
- Skill de design frontend pour la passe d'interface.
- À créer dans le projet (courtes, spécifiques) :
  - `asset-pipeline` : export Blender → glTF Transform → contrôle des budgets, conventions de nommage du § 8.
  - `add-part` : procédure pour ajouter une pièce (nœud GLB + ligne de catalogue + prix + test).
  - `add-brief` : gabarit et ton d'écriture des commandes.

### Connecteurs utiles côté préparation (hors Claude Code)

- Génération audio (voix d'un animateur radio fictif, bruitages) via un service de synthèse si un compte existe déjà : vérifier la licence d'usage avant d'embarquer un fichier. Ne jamais cloner la voix d'une personne réelle sans son accord explicite.
- Outil de maquettage pour valider l'interface avant de coder, si souhaité.

### Skills et contrôles ajoutés en v0.2

- `add-sticker` : gabarit SVG (viewBox, une seule couleur de remplissage recolorable, pas de texte de marque), enregistrement dans la bibliothèque, vignette.
- `add-interior-module` : gabarit d'un meuble ou d'un habillage du combi (nœud, emplacement, matières colorables).
- `audio-slots` : convention de nommage des fichiers audio, format du manifeste `engine.json`, procédure de bouclage et de normalisation.
- `npm run audio:check` : vérifie niveaux, formats, présence des manifestes, et l'absence d'oscillateur dans la chaîne moteur.

## 13. Arborescence

```
/
├─ CLAUDE.md                  consignes du § 19
├─ CAHIER_DES_CHARGES.md
├─ TODO_ASSETS.md             assets attendus d'un humain et substituts en place
├─ proto/index.html           prototype v0.1 : référence d'ergonomie et de structure uniquement
├─ src/
│  ├─ app/                    shell, routage par hash, réglages
│  ├─ render/                 peinture multicouche, sonde de réflexion, sol, bloom, brume, étalonnage, rendu photo, niveaux de qualité
│  ├─ scene/                  Garage, VehicleRig, Glow, Camera
│  ├─ vehicles/               chargement à la demande, lecture des manifestes, pièces partagées
│  ├─ interior/               aménagement : emplacements, modules, LED de plafond, vue en coupe
│  ├─ bench/                  établi : dépose moteur, vue éclatée, traitement pièce par pièce
│  ├─ livery/                 éditeur de stickers, flammes, covering, composition canvas → texture
│  ├─ drive/                  sortie de nuit : route, cinématique, caméras, météo, effets
│  ├─ ui/                     Hud, Dock, ColorPicker, Sliders, Garage (Mes véhicules), BriefSheet, BuildSheet, OrderForm
│  ├─ audio/                  mixer, radio, sfx, engine/ (échantillons uniquement)
│  ├─ data/                   zones.ts, stickers.ts, patterns.ts, briefs.ts, rules.ts
│  ├─ state/                  store.ts, persistence.ts, share.ts, history.ts
│  └─ pwa/
├─ public/assets/
│  ├─ vehicles/<id>/          body.glb, body_lod1.glb, vehicle.json, thumb.webp, engine/
│  ├─ shared/                 jantes, pneus, sièges, volants, sono, engines/<famille>/
│  ├─ garage/                 décor du garage
│  ├─ maps/<id>/              cartes de sortie : manifeste, tronçons, crédits des données (§ 5.5)
│  ├─ stickers/  patterns/    SVG et motifs
│  └─ audio/                  paquets générés au build (rien de versionné sous licence)
├─ docs/SOURCING_AUDIO.md     présélection de sons moteur et règles de licence
├─ assets-src/                .blend (hors Pages, LFS ou dépôt privé)
├─ (dépôt privé PimpMyBichon-assets : engines/, sfx/, radio/<station>/, modèles sous licence)
├─ tools/                     export.py, scripts gltf-transform et ffmpeg, contrôles, maps/ (fabrication des cartes)
├─ tests/                     vitest + playwright
└─ .github/workflows/pages.yml
```

## 14. Jalons et critères d'acceptation

| # | Jalon | Accepté quand |
|---|---|---|
| 0 | Socle : Vite, R3F, PWA, CI, Pages | l'URL Pages s'installe sur Android et s'ouvre en mode avion ; le build passe avec et sans le dépôt d'assets privé |
| 1 | **Rendu cible** | sur le modèle de banc d'essai, dans le garage : les 8 ingrédients du § 8, 3 ambiances lumineuses, rendu photo. **Validation à l'œil par le commanditaire face aux références du § 4**, sur l'appareil de référence, à 60 i/s en standard |
| 2 | Architecture véhicules | un véhicule = un dossier ; chargement à la demande ; les véhicules procéduraux du proto tournent comme substituts ; catalogue piloté par les données |
| 3 | Couleur libre et finitions | toutes les zones, toutes les finitions (dont chrome coloré et caméléon), liaison des zones, curseurs P1, **toute pièce sur l'établi** |
| 4 | Stickers, flammes et covering | éditeur complet au pouce, 80 motifs, générateur de flammes, 10 motifs de covering, dégradés, texte libre, image importée |
| 5 | Établi moteur | dépose, vue éclatée, traitements par pièce, échanges de pièces, remontage ; sur un moteur substitut puis sur le 4 à plat définitif |
| 6 | Vague 1 définitive | Cox, combi, bobber, fastback, sportive : modèles aux conventions, pièces P1, animations (portes, capots, hydraulique, sono), pilote des motos |
| 7 | Aménagement du combi | tous les emplacements P1, vue en coupe, LED de plafond (ciel étoilé, rubans, spots), matières et couleurs libres, extérieur camping |
| 8 | Sortie de nuit | lot 1 : la première carte (lacs du plateau matheysin et La Mure) roulée sur rail, pluie, pilote automatique, 6 caméras, mode réalisateur, 30 i/s plancher ; lot 2 : conduite libre ; puis Monaco, en ville et sur le circuit urbain |
| 9 | Son | un moteur accepté à l'aveugle par famille, bruitages, dossier de lecture et import « Ma playlist », mixage tenu au casque et au haut-parleur |
| 10 | Projets et partage | 20 briefs, carnet, livraison, liens de build et de défi, photo haute qualité partagée depuis Android |
| 11 | Finition | pièces P2, bivouac, télé du garage (§ 5.12), accessibilité, tests sur appareil, clip vidéo, APK si demandé |
| 12 | Vague 2 | berline 90, pick-up, 4x4, coupé, déposés sans modification du code |
| 13 | Modes de jeu (§ 5.5) | contre la montre avec classement de ses propres temps ; duel contre un véhicule piloté par l'app ; cartes débloquées par la progression ; dollars gagnés en course qui débloquent améliorations de performances et types de customisation ; la question « tout reste libre dans l'atelier, ou une carrière verrouille de l'existant » tranchée par le commanditaire (§ 18) avant tout développement |

Le jalon 1 passe avant tout le reste : si le rendu n'atteint pas le niveau attendu sur un seul véhicule, ajouter des véhicules et des options n'y changera rien. Les jalons 2, 3 et 4 ne dépendent d'aucun asset externe ; le jalon 8 ne dépend que de données géographiques ouvertes, téléchargées sur le poste (§ 5.5). Les jalons 5, 6, 7, 9 et 12 attendent les fournitures du § 10.3 ; leur code se développe avant, contre des substituts déclarés.

## 15. Définition de fini

- `npm run build` sans avertissement ; tests Vitest et Playwright verts.
- Fonctionne en mode avion après une première visite.
- Aucune requête réseau vers un tiers à l'exécution, hors télé du § 5.12 ouverte par l'utilisateur et pack de musique téléchargé à l'adresse qu'il a donnée (§ 9).
- Budgets du § 8 vérifiés par `npm run assets:check` ; audio vérifié par `npm run audio:check`.
- Aucun son de moteur ni de musique synthétisé dans le build livré.
- Parcours complet réalisable d'une seule main, pouce droit ou gauche, y compris la pose d'un sticker.
- La sortie de nuit se regarde sans toucher l'écran.
- Ajouter un véhicule ne demande aucune modification de code (vérifié en déposant un dossier de test).
- Les néons du décor se lisent dans la carrosserie, à tous les niveaux de qualité.
- Aucun nom de marque dans l'app (code, textes, assets) ; aucune donnée personnelle dans le dépôt. Seul `docs/SOURCING_AUDIO.md` cite des titres de banques de sons.
- Aucun fichier sous licence restrictive dans le dépôt public (contrôle par `npm run assets:check`).
- `TODO_ASSETS.md` à jour : chaque substitut encore en place y figure.

## 16. Risques et plans B

| Risque | Niveau | Plan B |
|---|---|---|
| Le rendu temps réel reste en dessous des images de référence | **élevé** | jalon 1 dédié et validé avant le reste ; rendu photo affiné pour les images partagées ; l'écart restant est assumé et dit |
| Pas de modèles à la hauteur (qualité, pièces séparées, licence) | **élevé** | commencer par un seul véhicule vraiment abouti ; devis freelance ; vague 1 réduite à 2 véhicules si besoin |
| Catalogue de 8 véhicules = volume d'assets très important | **élevé** | livraison par vagues ; pièces partagées ; la V1 sort avec la vague 1 |
| Fichiers sous licence exposés publiquement (dépôt ou site) | **élevé** | dépôt d'assets privé, paquets binaires, CC0 en priorité, APK si la licence l'exige |
| Musique sans licence adaptée à une app | élevé | dossier de lecture vide par défaut ; import « Ma playlist » sur le téléphone |
| Aménagement du combi : beaucoup de petits modèles | moyen | modules simples et colorables ; P1 d'abord |
| Poids des téléchargements | moyen | véhicules à la demande ; niveau de détail réduit ; textures KTX2 |
| Moteurs pas assez réalistes faute de bons enregistrements | **élevé** | pack payant de boucles par régime ; en dernier recours un seul jeu par moteur sans variante d'échappement |
| Périmètre total trop large pour un premier jet | élevé | l'ordre des jalons donne une app utilisable dès le jalon 4 ; la sortie de nuit et le son suivent |
| Éditeur de stickers pénible au pouce | moyen | livrées préréglées + curseurs ; test sur appareil dès le jalon 4 |
| Sortie de nuit trop lourde pour le téléphone | moyen | décor réduit, brouillard plus proche, qualité économie ; test sur appareil dès le jalon 8 |
| Poids du cache (musique) | moyen | téléchargement par station, à la demande |
| Perte de la sauvegarde | faible | `persist()`, export par fichier, lien de build envoyé à un ami |
| Réseau inutilisable sur place | élevé | installation et précache faits ensemble avant ; APK Capacitor |

## 17. Cadre juridique (à faire relire si l'app sort du cercle privé)

- **Véhicules** : silhouettes « inspirées de », sans logo ni nom de modèle ou de constructeur. La forme de certains véhicules est elle-même protégée ; l'usage privé non commercial limite le risque sans l'annuler, et un site public n'est pas strictement privé.
- **Musique** : aucune bande-son de jeu, aucun titre du commerce embarqué. Uniquement des morceaux libres de droits ou générés avec des droits d'usage acquis, tracés dans `CREDITS.md`.
- **Personnes** : aucune photo, aucun nom complet, aucune information de santé dans l'app ni dans le dépôt. Les prénoms des amis dans les briefs avec leur accord.

- **Stickers** : uniquement des créations originales ; les faux sponsors ne doivent ressembler à aucune marque réelle. Les images importées par l'utilisateur restent sur son appareil.
- **Sons** : uniquement des enregistrements dont la licence autorise l'intégration dans une app, tracés dans `CREDITS.md`. Les banques par abonnement interdisent en général de redistribuer les fichiers et d'en permettre l'extraction : voir § 11.
- **Musique du dossier de lecture** : « libre de droits » ne veut pas dire « utilisable partout ». Les formules standard des banques de musique pour créateurs couvrent des vidéos et des podcasts publiés en ligne ; l'usage dans un jeu ou une application relève d'une formule dédiée ou d'un accord écrit. Les morceaux importés par l'utilisateur sur son téléphone restent sur son appareil.
- **Cartes** : uniquement des données géographiques ouvertes (bases de l'IGN sous Licence Ouverte 2.0, OpenStreetMap sous ODbL), avec la mention de la source dans l'app et dans `CREDITS.md` ; les données dérivées d'OpenStreetMap publiées dans ce dépôt le sont sous la même licence. Aucun fond de carte dessiné, aucune donnée d'un service de cartographie commercial. Les lieux sont évoqués (tracé, relief, gabarit des rues), sans reproduire d'enseigne, de marque ni d'œuvre architecturale à l'identique ; aucun film, aucune émission, aucune compétition citée.

Ce paragraphe n'est pas un avis juridique.

## 18. Décisions par défaut et questions ouvertes

Prises par défaut, à corriger si besoin :

1. Appareil de référence : Galaxy S26.
2. Distribution : PWA installée depuis Chrome ; pas d'APK en V1.
3. Vague 1 : Cox, combi, bobber, fastback, sportive. Vague 2 : berline 90, pick-up, 4x4, coupé.
4. Enseigne du garage : le nom de l'app en néon.
5. Aucune prise de son de ses véhicules (la vidéo du garage est muette) : moteurs issus de banques de sons.
6. Décor de sortie (décidé le 15 novembre 2026) : des cartes tirées de lieux réels, publiques dans ce dépôt (§ 5.5) ; la première : les lacs du plateau matheysin et La Mure ; la deuxième : Monaco, en ville et sur le circuit urbain. Sur rail d'abord (lot 1), conduite libre ensuite (lot 2).
7. Musique : aucun morceau du commerce dans le dépôt ; les stations viennent des packs de musique et de l'import sur le téléphone. Exception décidée le 15 novembre 2026 : une **musique d'accueil** embarquée (quelques morceaux générés par le commanditaire, dont il a les droits d'usage, crédités dans `CREDITS.md`), qui joue pendant le chargement du pack puis lui laisse la place.
8. Assets sous licence dans un dépôt privé `PimpMyBichon-assets`.

Encore ouvertes, et **bloquantes pour les jalons 5, 6, 7 et 9** :

1. D'où viennent les modèles 3D : freelance (budget ?), modèles libres retravaillés, ou les deux ?
2. Abonnement à une banque de sons : lequel, et qui télécharge et valide à l'écoute les prises de `docs/SOURCING_AUDIO.md` ?
3. Musique du dossier de lecture : quelle source, avec quelle licence ?
4. ~~Une photo de l'intérieur du van, à plafond LED~~ : reçue (une courte vidéo de nuit, classée à tort comme attendue jusqu'au 15 novembre 2026 ; les photos de l'extérieur sont arrivées le même jour). Elle montre un ciel de toit étoilé rouge avec un médaillon central, à refaire avec un motif à nous.
5. Quels amis écrivent les premiers briefs ?
6. Modes de jeu (jalon 13) : aujourd'hui tout est libre dans l'atelier ; une progression suppose de verrouiller de l'existant. Un mode libre (tout ouvert, comme maintenant) à côté d'un mode carrière (on gagne et on débloque), ou une progression pour tout le monde ? Ouverte, **bloquante pour le jalon 13 seulement**.

## 19. Consignes pour Claude Code (reprises dans `CLAUDE.md`)

- Lire ce cahier des charges en entier, puis `proto/index.html`. Le proto fait référence pour l'ergonomie et la structure ; **son rendu, son audio et son catalogue sont dépassés**.
- **Le rendu est l'exigence n°1.** Commencer par le jalon 1 et ne pas le déclarer atteint sans captures d'écran comparées aux descriptions du § 4.
- Travailler jalon par jalon (§ 14). Ne pas commencer un jalon avant que le précédent soit accepté. Ne jamais réduire le périmètre en silence : ce qui n'est pas fait est écrit.
- Un véhicule = un dossier et un manifeste. Aucun identifiant de véhicule codé en dur. Catalogue, zones, curseurs, stickers, motifs et briefs sont pilotés par les données.
- Une carte de sortie = un dossier et un manifeste, fabriquée sur le poste à partir de données géographiques ouvertes dont la source et la licence sont notées dans `CREDITS.md`. Aucun identifiant de carte codé en dur, aucune donnée téléchargée à l'exécution.
- La profondeur passe d'abord par le paramétrique (couleurs, finitions, livrées, curseurs).
- **Modèles** : ne pas prétendre atteindre la cible de rendu avec de la géométrie générée par code. Les véhicules procéduraux sont des substituts déclarés, en attendant les modèles du § 10.3.
- **Assets sous licence** : aucun fichier de banque payante, aucun morceau, aucun modèle acheté dans ce dépôt. Ils vivent dans le dépôt privé d'assets ; le build doit passer sans lui.
- **Musique** : ne fournir aucun morceau du commerce. Seule exception : la musique d'accueil embarquée, générée par le commanditaire et créditée dans `CREDITS.md` (décision du 15 novembre 2026).
- **Audio** : ne jamais synthétiser un moteur ou une musique dans le code livré. Un emplacement vide est muet et listé dans `TODO_ASSETS.md`.
- Ne jamais inventer un asset manquant en silence : substitut nommé `placeholder_*`, listé dans `TODO_ASSETS.md`. Ne télécharger aucun modèle, son ou image dont la licence n'est pas vérifiée et notée dans `CREDITS.md`.
- Vérifier chaque écran par une capture Playwright en 390 × 844 avant de déclarer une tâche finie ; vérifier la sortie de nuit par une séquence de captures.
- Mesurer avant d'optimiser ; tenir les budgets du § 8.
- Aucun nom de marque, aucune donnée personnelle, aucune requête vers un tiers à l'exécution.
- Textes de l'interface en français, tutoiement, ton d'atelier entre amis.

## Sources

- Limites de GitHub Pages : https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- Trusted Web Activity et Digital Asset Links : https://developer.chrome.com/docs/android/trusted-web-activity/android-for-web-devs
- Blender MCP : https://github.com/ahujasid/blender-mcp
- Skills three.js pour Claude Code : https://github.com/cloudai-x/threejs-skills
- Stockage et PWA sur WebKit : https://webkit.org/blog/14403/updates-to-storage-policy/
- Car Kit CC0 (Kenney) : https://kenney.nl/assets/car-kit
- Le rapport de recherche du 13 novembre 2026 (étude de faisabilité) complète ce document pour l'existant, les licences musicales et l'ergonomie.
- Moteurs par échantillons en boucle avec l'API Web Audio (étude de cas) : https://web.dev/case-studies/racer-sound
- Bundles audio GDC de Sonniss : https://sonniss.com/gameaudiogdc
- Modèle de banc d'essai CarConcept (Khronos, CC-BY 4.0) : https://github.khronos.org/glTF-Assets/model/CarConcept
- Licence Envato Elements (termes complets) : https://help.elements.envato.com/hc/en-us/articles/360000628966
- Epidemic Sound, fonctionnement des licences et formules : https://www.epidemicsound.com/how-it-works/
