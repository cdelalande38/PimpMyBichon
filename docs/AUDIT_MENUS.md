# Audit des menus et de l'ergonomie

Vague X, 21 novembre 2026. Ta demande : « lance une analyse des menus et place-toi en expert du jeu vidéo et de l'ergonomie de jeux vidéo mobile et PC. Il y a des menus et boutons parfois mal affichés, parfois pas logiques, parfois trop d'un coup. Fais un état des lieux et propose des améliorations. » Aucun code de l'app n'a changé pour ce rapport : c'est une analyse, faite sur des captures prises par un parcours automatique, en trois formats.

## Résumé

Les cinq problèmes les plus graves :

1. **Deux portes d'entrée pour jouer, et aucune n'est la bonne.** « Jouer » (en bas) ouvre un choix « Libre ou Carrière », pendant que la carrière a aussi son bouton rond sur le côté, dessiné avec un soleil et un chiffre qui ne disent pas « carrière » ; « Jouer » disparaît dès qu'on entre dans une section. Une première course libre demande jusqu'à sept appuis.
2. **En paysage, les panneaux de l'Atelier sont presque inutilisables** : la rubrique « Jeu » est cachée sous « Retour », la boutique ne montre qu'une ligne, les réglages qu'une rangée.
3. **Des rangées qui défilent de côté sans aucun signe**, sur 20 écrans sur 43 en portrait : on voit 1,5 véhicule sur 5, deux lieux sur trois (Miami caché). Sur PC à la souris, ces rangées n'ont ni barre ni flèche : la molette ne les fait pas défiler.
4. **Les réglages de la sortie montrent tout d'un coup** (moment, météo, cinq formats, adversaire, difficulté, crédits) et cachent l'essentiel : en duel, le choix de l'adversaire passe sous le bouton « Jouer », et le fil devient « Sort… · Lib… · Mona… ».
5. **Pendant la course, rien ne fait « pause » comme dans un jeu** : la pause fige la route sans rien afficher, les commandes « Repartir » et « Rentrer au garage » sont rangées dans les réglages, et Échap ne fait rien au clavier.

Les cinq améliorations qui changeront le plus le ressenti :

1. **Un seul écran « Jouer »** qui réunit tous les modes en grandes cartes (Carrière en tête avec « Continuer : rendez-vous 4 », puis Course, Duel, Drift, Balade), un bouton « Jouer » toujours visible au garage, et le bouton rond de la carrière retiré.
2. **La porte de garage dans le décor**, sur le mur du néon « GOOD VIBES ONLY », qui s'ouvre quand on part rouler : un vrai moment de jeu, doublé par le bouton « Jouer ».
3. **Le choix du lieu en grandes cartes illustrées** (les fonds de chargement existent déjà pour chaque carte), et des réglages en deux temps : l'essentiel d'abord, la météo et le moment en options.
4. **Un vrai menu de pause** en course : Reprendre, Recommencer, Réglages, Rentrer au garage ; Échap et le bouton « Menu » d'une manette l'ouvrent.
5. **Une mise en page pour le paysage et le PC** : panneaux en feuille latérale pleine hauteur avec leurs rubriques en colonne, rangées qui passent à la ligne au lieu de défiler, molette et flèches du clavier qui marchent partout.

## 1. Comment j'ai travaillé

- Trois formats : téléphone en portrait (390 × 844), téléphone en paysage (844 × 390), PC (1366 × 768, à la souris, sans écran tactile). Rien n'a été vu sur un vrai téléphone ni sur un vrai écran de PC : tout est en rendu logiciel.
- Deux sauvegardes : une neuve (premier lancement, tutoriels réactivés), une riche (1 250 $, deux achats, deux hauts faits, trois rendez-vous de carrière réussis).
- Le parcours a visité 43 écrans du garage par format, l'entrée de la sortie étape par étape, puis la route (chargement, aperçu, réglages, feux, course, pause, retour, fin) : en paysage, une course et un duel jusqu'à l'arrivée ; en portrait, une course jusqu'à la pause. **La route n'a pas été capturée sur PC** (faute de temps) : ce que je dis du clavier en course vient de la mesure d'Échap en paysage et de la lecture du code. À chaque écran, une mesure automatique : cibles sous 48 px, éléments hors de l'écran, couverts par un autre ou rognés par une rangée qui défile, textes coupés, nombre de commandes visibles.
- Bonne nouvelle d'abord : **aucune cible tactile sous 48 px** sur les 129 écrans mesurés du garage. La règle des 48 px est tenue partout ; les défauts sont ailleurs.
- Un artefact à connaître : le parcours bloque le service worker (pour servir la route de test). La pastille « Cache hors ligne en panne » apparaît donc sur toutes les captures. Elle ne s'affiche pas ainsi chez toi en temps normal, mais elle se montre au premier lancement (« préparation ») et hors ligne : les chevauchements qu'elle provoque sont réels.

## 2. Inventaire : ce qu'il y a réellement à l'écran

### 2.1 Au garage, toujours visible

| Élément | Portrait | Paysage | PC (1366 × 768) | Ce qu'il fait | Code |
|---|---|---|---|---|---|
| Marque « Pimp my Bichon » | haut gauche | haut gauche | haut gauche de la colonne | rien | `src/ui/Hud.tsx` |
| Solde « 1 250 $ » | à droite de la marque | idem | idem | ouvre Atelier › Jeu (« Ton compte ») | `src/ui/jeu/Solde.tsx` |
| Pastille d'état (hors ligne, préparation) | haut droite, **par-dessus le solde** | sous la marque, **par-dessus le bouton Atelier** | haut droite | informe | `Hud.tsx`, `OfflinePill` |
| Étiquette « Garage · Le concept » | sous la marque | idem | idem | rien ; **redit ce que dit le menu** (« Au garage · Le concept ») | `src/app/App.tsx` |
| Bouton « ? » (Aide) | haut gauche | haut, contre le menu | haut gauche | tutoriel de l'écran, liste des tutos | `src/ui/tuto/Tutos.tsx` |
| Boutons ronds : Atelier, Photo, Radio, Carrière, Intérieur | colonne droite | colonne gauche | colonne droite | panneau Atelier ; mode photo ; mini-lecteur ; menu de la carrière ; vue intérieure | `Hud.tsx`, `RappelCarriere.tsx` |
| Pastilles sur le décor (enceintes, établi, servante, bloc moteur, néons) | 5 s après un geste | idem | idem | radio, Sous le capot, Préparation, Ambiance | `src/data/pointsInteret.ts` |
| Menu du bas (dock) | tiers bas, une rangée | colonne droite de 300 px, toujours ouverte | bande du bas, comme en portrait | personnaliser ; « Jouer » | `src/ui/Dock.tsx` |

Sur PC, l'app tient dans une colonne de 900 px au milieu de l'écran, avec deux bandes noires de 233 px de chaque côté, et reprend la disposition du portrait : la règle du paysage ne s'applique que sous 540 px de haut (`src/app/paysage.ts`).

### 2.2 Le menu du bas

```
Sections (4)                Entrées                          Niveaux dessous
├─ Véhicule ────────────── (ouvre directement le choix des 5 véhicules)
├─ Custom ──────────────── Peinture ─────────────────────── zone → couleur | finition → nuancier
│                          Roues · Suspension · Intérieur (entre dans la vue intérieure)
│                          Stickers · Carrosserie ───────── poste choisi
│                          Phares · Ailerons · Néons ────── zone choisie
├─ Mécanique (si moteur) ─ Préparation · Moteur ─────────── pièce choisie
│                          Échappement
└─ Garage ──────────────── Ambiance
                           Sortie ───────────────────────── Libre → lieu → circuit → départ → réglages → « Jouer »
                                                            Carrière → saison → rendez-vous → « Jouer »
```

- Profondeur maximale : six niveaux (Custom › Peinture › Carrosserie › Couleur › Nuancier ; Garage › Sortie › Libre › Monaco › La ville › Fontvieille).
- Le bouton « Jouer » n'existe qu'à deux endroits : dans la ligne de tête **quand on est aux sections**, et à côté de « Personnaliser » quand le menu est fermé. Dès qu'on entre dans une section, il disparaît (`Dock.tsx`, `level === 'sections'`).
- En paysage, le menu ne se ferme jamais tout seul : la colonne de droite mange 36 % de la largeur, même au repos.

### 2.3 Les panneaux

- **Atelier** (roue dentée) : trois rubriques en onglets **en bas** du panneau, « Réglages », « Sous le capot », « Jeu ». « Réglages » a ses propres onglets **en haut** (Qualité, Rotation, Texte, Lecture automatique…). « Jeu » s'appelle « Ton compte » une fois ouvert, et a encore ses onglets (Boutique, Hauts faits).
- **Radio** : le bouton rond ne l'ouvre pas, il déplie un mini-lecteur ; c'est le titre du morceau dans ce mini-lecteur qui ouvre le panneau (`src/ui/radio/RadioButton.tsx`).
- **Photo** : l'interface s'efface ; restent les cadrages, « Retour » et « Enregistrer ».
- **Aide** : un tutoriel par écran (19 en tout), « Tous les tutos ».

### 2.4 La sortie

- Entrée : les étapes du menu (voir 2.2), puis un écran de chargement plein (fond rendu de la carte, étapes cochées, plus de bouton).
- Aperçu : la route roule en pilote automatique, « Touche l'écran pour commencer ». En haut : nom de la carte, réglages, radio, et le bouton « ? ».
- Course : nom de la carte et progression, compte-tours, feux puis chrono, position du duel, trois boutons ronds (réglages, radio, pause), mini-carte, manche virtuel (ou pédales), NOS ; en paysage, GAZ, FREIN et NOS à droite.
- Réglages de la route : Vue (caméra, réalisateur, ralenti), Route (moment, météo), Conduite (commande, conduite assistée, manette), Son, et en bas « Commencer la course » ou « Pilote automatique », « Repartir », « Rentrer au garage ».
- Fin de course : résultat, gains, déblocages, puis « Course suivante » (carrière), « Rejouer » ou « Revanche », « Rentrer au garage ». En paysage, les deux colonnes se lisent bien (capture 27) ; le retour au garage rouvre le menu sur les réglages de la dernière sortie, ce qui rend « Rejouer autrement » rapide.
- Le retour du téléphone pendant la course ouvre « Rentrer au garage ? » (capture 30) ; le duel affiche la position et l'écart en haut (capture 28).

### 2.5 Plusieurs chemins vers le même endroit

| Destination | Chemins | Commentaire |
|---|---|---|
| Menu de la sortie | « Jouer » (menu ouvert, aux sections) ; « Jouer » (menu fermé) ; Garage › Sortie ; bouton rond Carrière ; Atelier › Jeu › Carrière › « Voir » ; fin de course › « Course suivante » | six chemins, trois libellés (Jouer, Sortie, Voir) |
| Ton compte | solde ; Atelier › Jeu | deux noms pour le même panneau |
| Vue intérieure | Custom › Intérieur ; bouton rond au volant | le premier change l'onglet ET la caméra |
| Ambiance | Garage › Ambiance ; néon du mur ; enseigne ronde | bien : le décor sert d'interface |
| Sous le capot | Atelier › Sous le capot ; établi ; servante | |
| Préparation | Mécanique › Préparation ; bloc moteur du décor | |
| Radio | bouton rond (mini-lecteur, puis titre) ; enceintes du décor | le bouton rond ne fait pas la même chose que les enceintes |

### 2.6 Libellés différents pour la même chose

- Partir rouler : « Jouer » (bouton), « Sortie » (entrée du menu, titre de l'écran de chargement), « Sortir » (vue intérieure, où il veut dire « revenir à l'atelier »), « Commencer la course » (réglages de l'aperçu), « Y aller » (fiche de carrière). Le libellé « Sortir » de la vue intérieure est déjà noté comme à trancher dans le suivi.
- Le mot « Atelier » désigne à la fois la roue dentée (configuration), l'app entière (« Installer l'atelier », « Retour à l'atelier ») et rien de visible au garage, où l'on lit « Garage ».
- « Jeu » (onglet) = « Ton compte » (titre) = le solde (bouton).

### 2.7 Ce qui change d'un format à l'autre

- Portrait : boutons ronds à droite, menu en bas sur une rangée qui défile ; le menu monte de lui-même aux réglages de la sortie et à la carrière (il couvre alors 60 % de l'écran et cache le véhicule).
- Paysage : boutons ronds à gauche, menu en colonne à droite toujours ouvert, panneaux en feuille latérale ; « ? » contre le menu.
- PC : la mise en page du portrait, élargie à 900 px. Pas de survol utile, pas de défilement à la molette dans les rangées, aucun raccourci au garage hormis Échap ; la manette ne sert qu'en course.

## 3. Analyse écran par écran

Gravité : **bloquant** (on ne peut pas faire ce qu'on veut, ou on se trompe), **gênant** (on y arrive mal, ou lentement), **finition** (ça se voit, ça ne gêne pas).

### A. Le garage au repos

| N° | Problème | Gravité | Capture | Code |
|---|---|---|---|---|
| A1 | La pastille d'état recouvre le solde en portrait (« 1 25… ») et le bouton Atelier en paysage. | gênant | 01, 03 | `src/ui/Hud.tsx` (`OfflinePill`), `src/app/styles.css` (`.pill`) |
| A2 | Le bouton rond de la carrière porte l'icône de la météo du prochain rendez-vous (un soleil) et un chiffre : on le prend pour un réglage de lumière ou une notification. | gênant | 01, 02 | `src/ui/carriere/RappelCarriere.tsx` (`PastilleCarriere`) |
| A3 | Cinq boutons ronds sans texte : seuls l'appareil photo et le volant se devinent ; la roue dentée s'appelle « Atelier », la radio déplie un lecteur au lieu d'ouvrir son panneau. | gênant | 01 | `Hud.tsx` |
| A4 | « Garage · Le concept » est écrit deux fois (étiquette du haut, tête du menu). | finition | 01 | `App.tsx`, `Dock.tsx` (`DockHeader`) |
| A5 | Aucun accès à la course dans le décor, alors que le décor sert déjà de raccourci pour la radio, l'ambiance et la mécanique. | gênant | 29 | `src/data/pointsInteret.ts` |
| A6 | En paysage, le menu reste ouvert en colonne (36 % de la largeur) même quand on ne personnalise rien ; « Jouer » est en haut à droite, loin du pouce droit qui tient le bas. | gênant | 02 | `src/app/paysage.css`, `Dock.tsx` |
| A7 | Sur PC, deux bandes noires de 233 px et la mise en page du téléphone en portrait ; le véhicule est petit, le menu est une bande au ras du bas. | gênant | 04 | `src/app/paysage.ts` (requête du paysage) |

### B. Le menu du bas

| N° | Problème | Gravité | Capture | Code |
|---|---|---|---|---|
| B1 | Rangées qui défilent de côté sans aucun indice (ni dégradé, ni flèche, ni compteur) : 20 écrans sur 43 en portrait ; le seul signe est un mot coupé au bord (« Sticker »). | gênant | 05, 06, 10 | `src/app/styles.css` (`.chips`, `.tabs`, `scrollbar-width: none`) |
| B2 | Sur PC, ces rangées n'ont ni barre ni flèche, et la molette ne les fait pas défiler (mesuré : la rangée des véhicules, 1 256 px dans 900 px, reste à 0 après un coup de molette) : la 5e moto du choix des véhicules, les zones de peinture au-delà de « Planche et contre-portes » ou les pièces du moteur ne sont atteignables qu'au clavier (Tab) ou avec Maj + molette. | **bloquant** sur PC | 07 | idem, aucun gestionnaire de molette |
| B3 | Le choix du véhicule, écran phare d'un jeu de customisation, est une rangée de puces où l'on voit 1,5 véhicule sur 5, et leur description est coupée (« Coupé d'essai … »). | gênant | 06 | `src/ui/vehicles/VehiclePicker.tsx` |
| B4 | « Jouer » disparaît dès qu'on entre dans une section : après avoir peint, il faut « Retour », « Retour », puis « Jouer ». | gênant | 05 | `Dock.tsx` (`DockHeader`) |
| B5 | « Sortie » est rangée dans la section « Garage », à côté d'« Ambiance » : jouer est caché comme une option de décor. | gênant | — | `src/data/dockMenu.ts` |
| B6 | En portrait compact, une seule rangée est visible : dans Préparation, les options payantes (Stage 1 à 3, carburation, nitro) sont sous la ligne de flottaison, on voit d'abord « Démarrer / Coup de gaz / Couper ». | gênant | 08 | `src/ui/engine/EnginePanel.tsx` |
| B7 | En paysage, la colonne du menu défile en hauteur sans aucun indice : les boutons d'écoute de l'Échappement (« Démarrer », « Coup de gaz », « Couper ») sont sous le bord, comme la dernière zone de Peinture, d'Intérieur et les dernières couleurs des Phares ; rien ne dit qu'il y a une suite. | gênant | 19 | `src/app/paysage.css` |
| B8 | Vue intérieure : « Conducteur / Passager / Sortir » ; « Sortir » veut dire « revenir à l'atelier » et le bouton au volant fait la même chose ; le mini-lecteur de la radio passe par-dessus le volant. | gênant | 18 | `src/ui/PlacePicker.tsx`, `Hud.tsx` |
| B9 | Neuf entrées dans Custom : c'est beaucoup sur une rangée, et l'ordre ne suit ni la fréquence ni le prix (Phares et Ailerons après Carrosserie, Néons en dernier alors qu'ils sont le cœur de l'esprit néon). | finition | 05 | `dockMenu.ts` |

### C. « Jouer » et l'entrée de la sortie

| N° | Problème | Gravité | Capture | Code |
|---|---|---|---|---|
| C1 | « Jouer » mène à un écran « Libre ou Carrière ? » : deux grandes cases qui disent peu (pas d'image, pas d'état de la carrière). Le duel, le drift et la balade sont cachés plus loin, dans les « formats » des réglages. | **bloquant** pour comprendre l'offre | 09 | `src/ui/drive/entree/Etapes.tsx`, `etapes.ts` (`MODES`) |
| C2 | Course libre à froid : Jouer → Libre → lieu → circuit → départ → réglages → Jouer → toucher l'écran : **sept appuis** avant le feu rouge. | gênant | 09 à 11 | `etapes.ts` |
| C3 | Le choix du lieu montre deux lieux sur trois ; le troisième (Miami) n'est visible qu'en faisant glisser. Les fonds de chargement de chaque carte existent, mais le choix n'en montre rien. | gênant | 10 | `Etapes.tsx` (`EtapeLieu`) |
| C4 | Réglages de la sortie, trop d'un coup : moment, météo, cinq formats, puis, en duel, cinq adversaires et trois difficultés, les crédits des données, « Jouer ». En portrait, le menu couvre 60 % de l'écran et cache le véhicule. | gênant | 11, 12 | `src/ui/drive/entree/EtapeReglages.tsx` |
| C5 | En duel, l'adversaire et la difficulté passent sous le bouton « Jouer » (mesuré : trois adversaires couverts en portrait, deux en paysage) ; on peut partir sans avoir vu qui on affronte. | gênant | 12, 13 | idem |
| C6 | Le fil se tasse jusqu'à l'illisible : « Sort… · Lib… · Mona… · La vil… », et en paysage « S… · … M… L… ». | finition | 11, 13 | `Dock.tsx` (`useFilSerre`) |
| C7 | « Course 3 tours » apparaît grisée sans dire pourquoi à côté du bouton (l'explication est plus bas, en petit). | finition | 11 | `EtapeReglages.tsx` |
| C8 | La carrière s'ouvre par quatre chemins (voir 2.5) ; la fiche du rendez-vous est bien faite, mais la liste des saisons est collée sous « Jouer » et sa première ligne est coupée. | gênant | 14 | `src/ui/carriere/CarrierePanneau.tsx` |

### D. Les panneaux

| N° | Problème | Gravité | Capture | Code |
|---|---|---|---|---|
| D1 | En paysage, la rubrique « Jeu » de l'Atelier est **cachée sous le bouton « Retour »** ; on ne l'atteint que par le solde. | **bloquant** en paysage | 15 | `src/ui/Sheet.tsx`, `src/ui/AtelierSwitcher.tsx`, `paysage.css` |
| D2 | En paysage, la tête du panneau (titre, phrase d'aide, solde, carrière) reste fixe : la boutique ne montre qu'une ligne, les réglages une seule rangée. | **bloquant** en paysage | 15 | idem |
| D3 | Deux rangées d'onglets dans le même panneau (en haut les réglages, en bas les rubriques) ; les onglets du haut sont coupés (« Lecture aut… »). | gênant | 16 | `src/ui/SettingsPanel.tsx`, `Sheet.tsx` |
| D4 | La radio : un bouton qui déplie un lecteur, un titre qui ouvre le panneau, des enceintes qui l'ouvrent aussi ; trois gestes pour une seule chose. | finition | 17 | `RadioButton.tsx` |

### E. La route

| N° | Problème | Gravité | Capture | Code |
|---|---|---|---|---|
| E1 | La pause fige la route et change l'icône, c'est tout : pas de voile, pas de « Pause », pas de « Reprendre » au milieu ; « Repartir » et « Rentrer au garage » sont dans les réglages, à un autre bouton. | gênant | 25 | `src/ui/drive/DriveScreen.tsx`, `Reglages.tsx` |
| E2 | Au clavier, Échap ne fait rien pendant la course (mesuré) et aucune touche ne met en pause. | gênant sur PC | — | `DriveScreen.tsx` (Échap seulement pendant le chargement) |
| E3 | Le bouton « ? » reste à l'écran pendant la course : en portrait entre le nom de la carte et la mini-carte, en paysage sous la pause, dans la zone du pouce droit ; un appui par erreur ouvre un tutoriel en pleine course. En paysage, il passe même par-dessus le panneau des réglages de la route. | gênant | 24, 25, 26 | `Tutos.tsx` |
| E6 | En duel, côte à côte en paysage, la voiture de l'adversaire passe sous le NOS et le FREIN : les commandes cachent l'information la plus utile du moment. | finition | 28 | `src/ui/drive/drive.css` |
| E4 | Après « Jouer », l'aperçu demande encore de toucher l'écran : deux confirmations pour un départ. C'est un choix que tu as demandé (vitrine) ; je propose de le garder pour la Balade et de partir droit aux feux pour les courses. | finition, à décider | 23 | `DriveScreen.tsx` |
| E5 | Les réglages de la route mélangent la vue, la météo, la commande, le son et les actions de fin ; « Commencer la course » est un bouton rouge géant dans un panneau de réglages. | gênant | 24 | `Reglages.tsx` |

### P. PC : clavier, souris, manette

| N° | Problème | Gravité | Code |
|---|---|---|---|
| P1 | Le focus se voit bien (liseré orange, capture 22), mais Tab passe d'abord par les boutons ronds, le mini-lecteur et les pastilles du décor : « Jouer » est loin. Aucun raccourci au garage (Entrée, chiffres, lettres). | gênant | `Dock.tsx`, `Hud.tsx` |
| P2 | Les menus ne se pilotent pas à la manette (elle n'est lue qu'en course). | gênant | `src/ui/drive/Manche.tsx` (`useManettePhysique`) |
| P3 | Rangées sans défilement à la molette (voir B2). | bloquant | `styles.css` |

### G. Premier lancement

| N° | Problème | Gravité | Capture |
|---|---|---|---|
| G1 | L'écran de chargement est réussi (fond rendu, étapes cochées). En paysage, le titre est posé sur le véhicule (déjà noté au suivi). | finition | 20 |
| G2 | Le tutoriel d'accueil parle de tourner autour du véhicule et de personnaliser, jamais de jouer : le joueur qui veut rouler ne sait pas où aller. | gênant | 21 |

## 4. Propositions, problème par problème

Effort : **R** retouche rapide (moins d'une heure), **M** lot moyen (un agent), **G** refonte (plusieurs lots).

| N° | Correction proposée | Effort |
|---|---|---|
| A1 | La pastille d'état passe sous la marque, sur sa propre ligne, et ne recouvre jamais un bouton ; ou elle se range dans le bouton Atelier sous forme de point de couleur. | R |
| A2 | Retirer le bouton rond de la carrière (il passe dans l'écran « Jouer », voir § 5) ; à défaut, une icône de trophée ou de drapeau avec le numéro, et le mot « Carrière » en bulle. | R |
| A3 | Garder trois boutons ronds au plus (Atelier, Photo, Radio) ; libellé court sous chaque icône en paysage et sur PC (il y a la place) ; le bouton Radio ouvre le panneau, le mini-lecteur se déplie par un appui long ou par sa propre flèche. | R à M |
| A4 | Supprimer l'étiquette du haut quand le menu montre déjà le véhicule. | R |
| A5 | La porte de garage (§ 6). | M |
| A6 | En paysage, le menu fermé par défaut, réduit à deux gros boutons en bas à droite (« Personnaliser », « Jouer ») ; il s'ouvre en colonne quand on personnalise. | M |
| A7 | Sur PC (écran large et haut), une disposition dédiée : scène pleine largeur, menu en colonne à droite comme en paysage, boutons ronds à gauche avec leur nom. | M |
| B1 | Dans toute rangée qui défile : dégradé au bord qui coupe, et un compteur discret (« 3 / 9 ») ou des petites flèches ; mieux, passer à la ligne dès que la rangée tient sur deux lignes. | R (dégradé), M (deux lignes partout) |
| B2 | Molette verticale convertie en défilement horizontal sur les rangées, et flèches cliquables aux bords quand la souris est là (`hover: hover`). | R |
| B3 | Choix du véhicule en grandes cartes (vignette `thumb.webp` déjà présente, nom, une ligne), deux par écran en portrait, une grille en paysage et sur PC, avec un compteur « 2 / 5 ». | M |
| B4 | « Jouer » toujours visible au garage : un bouton fixe en bas à droite, hors du menu, à toute profondeur (sauf panneau ouvert). | R |
| B5 | Sortir « Sortie » du menu de personnalisation : le menu du bas ne sert qu'à personnaliser, « Jouer » mène à l'écran des modes. | M (avec § 5) |
| B6 | Préparation : les options payantes en premier, les essais de son (Démarrer, Coup de gaz) dans une ligne plus petite dessous. | R |
| B7 | En paysage, le contenu de la colonne défile en entier et la dernière ligne a toujours une marge ; le débordement d'une option est signalé par le même dégradé que B1. | R |
| B8 | Renommer « Sortir » en « Vue atelier » (ou une flèche « Retour ») ; le mini-lecteur s'efface en vue intérieure. | R |
| B9 | Regrouper Custom en trois familles (Couleurs : Peinture, Stickers, Néons ; Pièces : Roues, Carrosserie, Ailerons, Phares ; Habitacle : Intérieur, Suspension) ou au moins remonter Néons en deuxième. À décider. | R à M |
| C1 | L'écran « Jouer » des modes (§ 5.2) : une carte par mode avec image, une ligne et son état (« Rendez-vous 4 sur 12 », « Record : 1:12,4 »). | M |
| C2 | Une course libre à froid en trois appuis : Jouer → Course → la carte (lieu et circuit dans la même grille) → « Jouer » ; le départ par défaut est le premier, modifiable sur la fiche. La reprise (« Continuer : Monaco, la ville ») en un appui en tête de l'écran des modes. | M |
| C3 | Lieux et circuits dans une même grille de cartes illustrées par les fonds de chargement (un lieu à deux circuits montre deux cartes). | M |
| C4 | Réglages en deux temps : en haut, ce qui change la course (format, adversaire et difficulté en duel) ; « Moment et météo » repliés dans une ligne qui résume (« Nuit · Pluie ») et s'ouvre au toucher ; les crédits des données passent dans Sous le capot ou dans un lien. | M |
| C5 | Le bouton « Jouer » réserve sa place (le contenu défile au-dessus, jamais dessous) ; en duel, l'adversaire choisi est rappelé sur le bouton avec sa vignette. | R |
| C6 | Remplacer le fil par un titre d'étape (« Choisis ton départ ») et le chemin résumé une seule fois (« Monaco · La ville ») ; le fil complet reste lu par les lecteurs d'écran. | R |
| C7 | Masquer les formats impossibles sur la carte choisie, ou écrire la raison dans la case (« circuit fermé seulement »). | R |
| C8 | La carrière devient la première carte de l'écran des modes : « Continuer » lance le prochain rendez-vous (sa fiche s'affiche avant, avec « Jouer ») ; la liste des saisons est un écran à elle. | M |
| D1, D2 | En paysage, feuille latérale pleine hauteur à deux colonnes : les rubriques en colonne à gauche (Réglages, Sous le capot, Jeu, Radio), le contenu à droite qui défile seul ; la tête du panneau se replie au défilement. | M |
| D3 | Une seule rangée d'onglets par panneau : les rubriques de l'Atelier passent en tête ; les réglages se lisent en liste (titre de réglage, choix dessous), sans onglets. | M |
| D4 | Voir A3. | R |
| E1, E5 | Un menu de pause plein écran semi-transparent : « Reprendre » (grand, au centre), « Recommencer », « Réglages » (vue, son, commande), « Rentrer au garage » ; la course est floutée derrière. Le bouton réglages disparaît du bandeau : un seul bouton « Pause » en course. | M |
| E2 | Échap et P ouvrent la pause ; le bouton « Menu » de la manette aussi. | R |
| E3 | Le bouton « ? » ne s'affiche pas pendant la course (il reste dans l'aperçu et dans le menu de pause) ; il ne passe jamais par-dessus un panneau. | R |
| E6 | En paysage, NOS et FREIN plus bas et plus transparents tant qu'on ne les touche pas, ou la caméra de poursuite décalée vers la gauche en duel. | R à M |
| E4 | Garder l'aperçu pour la Balade et le premier lancement d'une carte ; pour une course, une carrière ou un duel, partir droit aux feux. À décider. | R |
| P1 | Raccourcis au garage : Entrée = Jouer, 1 à 4 = sections, Échap = retour ; l'ordre de tabulation commence par le menu. | R |
| P2 | Navigation des menus à la manette : croix directionnelle pour aller d'un bouton à l'autre (le focus existe déjà), A pour valider, B pour revenir. | M |
| G2 | Une étape de l'accueil montre « Jouer » (ou la porte) : « Quand tu es prêt, sors rouler ». | R |

## 5. Architecture cible de la navigation

### 5.1 Principes

1. **Deux verbes, deux gros boutons** : « Personnaliser » et « Jouer », toujours visibles au garage, au même endroit, au pouce droit en paysage.
2. **Le menu du bas ne sert qu'à personnaliser.** Jouer, la carrière, la boutique ne s'y cachent plus.
3. **Un seul écran « Jouer »** réunit tous les modes. Les modes sont des cartes, pas des « formats » dans une liste de réglages.
4. **Le décor double l'interface**, jamais l'inverse : la porte pour rouler, l'établi pour la mécanique, les enceintes pour la radio, le néon pour l'ambiance. Chaque objet a son bouton équivalent.
5. **Une action principale par écran**, en rouge, toujours entière, jamais recouverte.

### 5.2 L'écran « Jouer »

Ouvert par le bouton « Jouer » ou par la porte. En tête, la reprise (ce qu'on faisait la dernière fois), puis les modes :

| Carte | Contenu | Un appui |
|---|---|---|
| Continuer | « Carrière · rendez-vous 4 sur 12 · Un tour du port » ou « Monaco, la ville · Course 1 tour » | lance la fiche, puis « Jouer » |
| Carrière | saison, cases réussies, prime du prochain rendez-vous | fiche du prochain rendez-vous |
| Course | « 1 tour ou 3 tours, chrono et médailles » | grille des cartes |
| Duel | « Contre un pilote du jeu » | grille des cartes, puis adversaire |
| Drift | « Des points à chaque glisse » | grille des cartes |
| Balade | « Rouler pour le plaisir, sans chrono » | grille des cartes |
| (plus tard) Rodéo | « Accélération en ligne droite » | — |

Le rodéo, prévu au suivi, s'y ajoute comme une carte de plus sans toucher au reste.

### 5.3 Ce qui reste visible au garage

- Haut gauche : marque, solde (ouvre « Ton compte »).
- Côté (droite en portrait, gauche en paysage) : Atelier, Photo, Radio. Intérieur reste dans Custom › Intérieur (et en bouton rond seulement si tu y tiens).
- Bas droite : « Jouer » (rouge), à gauche « Personnaliser ».
- Le reste (carrière, boutique, hauts faits, aide) passe dans les écrans.

### 5.4 Ordre des sections du menu de personnalisation

Véhicule, Custom, Mécanique, Ambiance (Garage ne garde que l'ambiance ; on peut le renommer « Garage » et y mettre l'ambiance seule, ou fondre l'ambiance dans les réglages du décor). Dans Custom, Néons remonte en deuxième ou les entrées se regroupent (B9).

### 5.5 Accessible en un geste

Jouer, Personnaliser, Continuer (dans l'écran Jouer), Pause en course, Rejouer en fin de course, le solde, la radio.

### 5.6 Maquettes en fil de fer

**Garage, portrait (menu fermé)**

```
┌──────────────────────────────┐
│ PIMP MY BICHON   1 250 $      │
│                         (⚙)   │
│                         (📷)  │
│        [ véhicule ]     (📻)  │
│      ┌──────────────┐         │
│      │ porte (▶)    │ ← dans  │
│      └──────────────┘   le    │
│                         décor │
│                               │
│ ┌──────────────┐ ┌──────────┐ │
│ │ PERSONNALISER│ │ ▶ JOUER  │ │
│ └──────────────┘ └──────────┘ │
└──────────────────────────────┘
```

**Garage, paysage (menu fermé par défaut)**

```
┌─────────────────────────────────────────────────────────────┐
│ PIMP MY BICHON 1 250 $                                       │
│ (⚙) Atelier                                                  │
│ (📷) Photo           [ véhicule, porte au fond ]             │
│ (📻) Radio                                                   │
│                                  ┌─────────────┐ ┌─────────┐ │
│                                  │PERSONNALISER│ │ ▶ JOUER │ │
│                                  └─────────────┘ └─────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**Écran « Jouer », portrait**

```
┌──────────────────────────────┐
│ ← Retour           JOUER      │
│ ┌──────────────────────────┐ │
│ │ ▶ CONTINUER               │ │
│ │ Carrière · RDV 4 sur 12   │ │
│ │ Un tour du port · 60 $    │ │
│ └──────────────────────────┘ │
│ ┌────────────┐ ┌────────────┐│
│ │ CARRIÈRE   │ │ COURSE     ││
│ │ ▮▮▮▯▯▯ 3/12│ │ chrono     ││
│ └────────────┘ └────────────┘│
│ ┌────────────┐ ┌────────────┐│
│ │ DUEL       │ │ DRIFT      ││
│ └────────────┘ └────────────┘│
│ ┌──────────────────────────┐ │
│ │ BALADE                    │ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

**Écran « Jouer », paysage**

```
┌─────────────────────────────────────────────────────────────┐
│ ← Retour   JOUER                                             │
│ ┌──────────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│ │ ▶ CONTINUER       │ │ CARRIÈRE │ │ COURSE   │ │ DUEL     │  │
│ │ Carrière · RDV 4  │ │ 3 / 12   │ │          │ │          │  │
│ │ Un tour du port   │ ├──────────┤ ├──────────┤ ├──────────┤  │
│ │                   │ │ DRIFT    │ │ BALADE   │ │ (bientôt)│  │
│ └──────────────────┘ └──────────┘ └──────────┘ └──────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Choix de la carte (Course, Duel, Drift, Balade), paysage**

```
┌─────────────────────────────────────────────────────────────┐
│ ← Modes   COURSE · choisis ta carte                          │
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌──────────┐ │
│ │ [fond rendu]│ │ [fond rendu]│ │ [fond rendu]│ │[fond …]  │ │
│ │ Plateau     │ │ Monaco      │ │ Monaco      │ │ Miami    │ │
│ │ Les lacs    │ │ La ville    │ │ Le circuit  │ │ Front de │ │
│ │ 20,6 km     │ │ 4,2 km      │ │ tour 3,3 km │ │ mer      │ │
│ │ record 4:12 │ │ —           │ │ —           │ │          │ │
│ └─────────────┘ └─────────────┘ └─────────────┘ └──────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**Fiche avant le départ, portrait**

```
┌──────────────────────────────┐
│ ← Cartes   MONACO · LA VILLE  │
│ [ fond rendu de la carte ]    │
│ Départ : Fontvieille     ▾    │
│ Format : 1 tour | 3 tours     │
│ (duel) Adversaire : Nova ▾    │
│        Difficulté : Normal ▾  │
│ Nuit · Pluie            ▾     │  ← replié
│                               │
│ ┌──────────────────────────┐ │
│ │        ▶ JOUER            │ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

**Pause en course, paysage**

```
┌─────────────────────────────────────────────────────────────┐
│                [ route floutée derrière ]                    │
│                       PAUSE                                  │
│                ┌──────────────────┐                          │
│                │    ▶ REPRENDRE   │                          │
│                └──────────────────┘                          │
│        [ Recommencer ]  [ Réglages ]  [ Rentrer au garage ]  │
└─────────────────────────────────────────────────────────────┘
```

## 6. La porte de garage dans le décor

### 6.1 Ce que dit le décor aujourd'hui

- Le néon « GOOD VIBES ONLY » (`neon_good_vibes`, `src/data/garage.ts`) est sur le **mur avant**, à 1,75 m de haut, au-dessus du canapé A (`placeholder_canape_a`, à 2,3 m à gauche du milieu). Ce mur est **derrière la caméra** de départ : on ne lit le néon que dans les reflets des flancs, c'est voulu (commentaire du fichier).
- L'app sait déjà faire d'un objet du décor un bouton : `src/data/pointsInteret.ts` (une ligne par objet : l'objet visé, une icône, ce que l'appui ouvre), les pastilles de `src/ui/overlay/` et la détection d'appui de `src/scene/extras/`. Les enceintes, l'établi, la servante, le bloc moteur et deux néons s'en servent.

### 6.2 Où la placer

- **Proposition principale** : sur le mur avant, entre le néon et le mur rouge, là où tu dis qu'elle est dans la vraie vie. La capture 29 montre ce mur, caméra retournée : à gauche du néon (vu de la porte, c'est le côté du mur rouge), environ 2,5 m de mur sombre sont libres, avec une pile de caisses au sol dans le coin, à décaler de quelques dizaines de centimètres. Une porte sectionnelle de 2,4 m sur 2,1 m (la retombée du plafond est à 2,35 m), lames horizontales, liseré de LED tout autour.
- Problème : la caméra de départ lui tourne le dos. Trois moyens de la rendre évidente quand même :
  1. **Un trait de lumière sous la porte** (la rue de nuit derrière, bleu froid) qui se reflète sur le sol mouillé du garage et dans la carrosserie, comme le néon : on la devine sans la voir.
  2. **Une arrivée de caméra** au lancement : la caméra part de la porte, passe au-dessus du canapé et vient se poser sur le véhicule (deux secondes, une fois par séance, coupée au premier toucher, sautée si « mouvements réduits »).
  3. **Le geste « Jouer »** fait pivoter la caméra vers la porte, qui monte en roulant (son de rideau, lumière de la rue qui entre), puis l'écran des modes apparaît par-dessus la porte ouverte.
- **Variante plus visible**, si la vraie place ne suffit pas : sur le mur rouge (droit), près du coin avant, en partie visible dans le cadrage de départ en paysage. Moins fidèle au vrai garage. À toi de choisir.

### 6.3 La rendre évidente

- Une pastille avec l'icône « Jouer » (le triangle) ou « route », posée au milieu de la porte, qui suit les mêmes règles que les autres pastilles (visible 5 s après l'arrivée et après chaque geste sur la scène).
- Au repos, le liseré de LED respire doucement ; il s'allume franchement quand le joueur a assez de dollars pour un nouveau rendez-vous, ou quand la carrière a un rendez-vous en attente (le rôle du bouton rond actuel, mais dans le décor).
- À l'ouverture : la porte monte (0,8 s), la lumière de la rue balaie le sol, la musique baisse ; si on annule, la porte redescend.

### 6.4 Doubler pour l'accessibilité et le PC

- Le bouton « Jouer » reste toujours là : la porte est un raccourci et une mise en scène, jamais le seul chemin.
- La pastille est un vrai bouton (nom lu « Aller rouler », focus au clavier, Entrée la déclenche), comme les pastilles actuelles.
- « Mouvements réduits » : pas de pivot de caméra, la porte s'ouvre en fondu.

### 6.5 Ce que ça coûte

| Morceau | Travail | Effort |
|---|---|---|
| Modèle | Une porte sectionnelle dessinée en code dans les données du décor (comme les meubles actuels : boîtes biseautées, lames, rail), matériau tôle peinte, liseré LED, une animation de montée. Un modèle sous licence plus tard, si tu veux mieux. | M (un agent, Opus : 3D) |
| Bouton dans le décor | Une ligne dans `src/data/pointsInteret.ts`, une icône de plus (`PieceIcon`), une action « jouer » à côté de « panneau » et « entrée ». | R |
| Caméra | Pivot vers la porte au « Jouer », arrivée au lancement ; respect de « mouvements réduits ». | M |
| Lumière | Trait de lumière au sol (nappe de lumière cuite, comme les autres taches du décor), reflet dans la carrosserie à vérifier en capture. | R à M |
| Tests | Parcours : la pastille existe, ouvre l'écran des modes, a un nom accessible ; capture du mur avant en portrait et en paysage ; le budget d'images par seconde du garage (§ 8 du cahier des charges) remesuré. | R |

## 7. Plan

### 7.1 Retouches rapides (moins d'une heure chacune, la boucle principale ou un agent Sonnet en lot)

1. A1 pastille d'état qui ne recouvre plus rien.
2. B2 molette dans les rangées et flèches au survol (PC).
3. B1 dégradé au bord des rangées qui défilent.
4. B4 « Jouer » toujours visible au garage.
5. C5 « Jouer » qui ne recouvre plus les choix ; C6 fil remplacé par un titre d'étape ; C7 formats impossibles expliqués.
6. D1 rubrique « Jeu » visible en paysage (correction minimale : les onglets passent au-dessus de « Retour » ou à la ligne).
7. E2 Échap et P pour la pause ; E3 « ? » masqué en course.
8. B6 options payantes de la préparation en premier ; B7 marges du bas en paysage ; B8 « Sortir » renommé ; A4 étiquette en double retirée.
9. P1 raccourcis au garage ; G2 étape « Jouer » dans l'accueil.

### 7.2 Lots moyens (un agent chacun)

1. **Écran « Jouer » des modes** (C1, C2, C8, B5, A2) : Sonnet, refonte d'écran bornée ; dépend de ta décision sur le bouton rond de la carrière.
2. **Choix de la carte en grandes cartes illustrées et fiche avant départ** (C3, C4) : Sonnet ; après le lot 1.
3. **Menu de pause** (E1, E5) : Sonnet.
4. **Panneaux en paysage, rubriques en colonne** (D1, D2, D3) : Sonnet.
5. **Disposition PC** (A7, P2 en option) : Opus si la scène doit recadrer, Sonnet sinon.
6. **Porte de garage** (§ 6) : Opus (modèle, caméra, lumière) ; indépendant des autres, mais son action finale ouvre l'écran du lot 1.
7. **Choix du véhicule en cartes** (B3) : Sonnet.

### 7.3 Refonte (plusieurs lots)

- Paysage repensé de bout en bout (A6 menu fermé par défaut, colonne qui s'ouvre, tous les écrans repris) : après les lots 1, 2 et 4.
- Navigation complète à la manette dans les menus (P2) : après la disposition PC.
- Regroupement des entrées de Custom (B9) : si tu le veux.

### 7.4 Ordre conseillé

Retouches rapides d'abord (elles enlèvent les blocages en paysage et sur PC), puis le lot 1 (écran Jouer), le lot 3 (pause), le lot 4 (panneaux en paysage), le lot 2 (cartes illustrées), la porte (lot 6), enfin le PC et le véhicule. Le rodéo, prévu dans la file, gagnerait à arriver après le lot 1 : il s'y branche comme une carte de mode.

### 7.5 Ce qui demande ta décision

1. Retirer le bouton rond de la carrière au profit de l'écran « Jouer » (déjà dans tes décisions en attente).
2. La place de la porte : mur avant à côté du néon (fidèle, mais derrière la caméra) ou mur rouge (plus visible).
3. Garder l'aperçu « Touche l'écran pour commencer » pour toutes les sorties, ou seulement la Balade.
4. Le menu fermé par défaut en paysage.
5. Le regroupement des entrées de Custom et l'ordre des sections.
6. Les mots : « Jouer » partout pour partir, « Sortie » retiré de l'interface ; « Sortir » de la vue intérieure renommé ; « Ton compte » ou « Jeu ».

## Annexe : captures

Les captures citées sont dans `docs/audit-menus/` (JPEG, numérotées comme dans le texte ; cadres rouges numérotés sur les problèmes). Toutes les captures du parcours, et les mesures écran par écran au format JSON, sont dans `captures/vague-x-audit/` (hors dépôt).
