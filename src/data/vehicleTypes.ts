// Contrat des véhicules (§ 6 et § 8 du cahier des charges) : ce que décrit le manifeste
// `public/assets/vehicles/<id>/vehicle.json` d'un véhicule, et ce qu'un build retient de lui.
// Types seuls, aucune donnée : le catalogue est découvert au build, rien n'est codé en dur par
// véhicule. Les champs du § 6 qui manquent ici (pièces, curseurs, livrée, néons, intérieur,
// moteur) arriveront avec leur jalon ; un manifeste ou un build qui les porte déjà reste lisible.

import type { FinishId } from './finishes.ts';
import type { BuildStickers, LiveryZone } from './stickersCalques.ts';

/** Nom du dossier du véhicule dans public/assets/vehicles/. */
export type VehicleId = string;

/** Couleur libre, '#rrggbb' en minuscules. */
export type Hex = string;

/** Peinture effective d'une zone : ce que le rendu applique. */
export interface Paint {
  color: Hex;
  finish: FinishId;
  /** Taille de paillette, en millimètres (finitions à paillettes) ; absente : celle de la finition. */
  flake?: number;
  /** Seconde teinte du caméléon ; absente : celle que la finition déduit de la couleur. */
  color2?: Hex;
}

/**
 * Ce que l'utilisateur a changé sur une zone : les champs absents gardent la peinture d'origine
 * du manifeste. `linked` : faux pour une zone détachée de la zone maîtresse (bi-ton), vrai pour
 * une zone rattachée ; absent : la liaison d'origine du manifeste.
 */
export type PaintChoice = Partial<Paint> & { linked?: boolean };

/**
 * 'carrosserie' : zone peinte, qui peut suivre la zone maîtresse (la première zone 'carrosserie'
 * du manifeste). 'accastillage' : jantes, étriers, sellerie, cadre… toujours indépendante.
 */
export type ZoneGroup = 'carrosserie' | 'accastillage';

export interface Zone {
  id: string;
  /** Nom affiché, en français. */
  label: string;
  /** Noms exacts des matériaux du GLB que la zone colore. */
  materials: readonly string[];
  group: ZoneGroup;
  /** Peinture d'origine. */
  paint: Paint;
  /** Zone 'carrosserie' détachée à l'origine (bi-ton d'usine) : `false`. Absent : liée. */
  linked?: boolean;
  /**
   * Zone maîtresse : son nom dans une phrase, article compris (« le réservoir », « le carénage »),
   * pour le cadenas des autres zones (« Suit le réservoir »). Absent : « la carrosserie ».
   */
  phrase?: string;
}

/**
 * Adaptation d'un modèle qui ne suit pas les conventions de modélisation du § 8 (le modèle de
 * banc d'essai). Un modèle aux conventions n'en a pas besoin : ses matériaux sont nommés par
 * rôle (`paint_<zone>`, `chrome`, `alu`, `black`, `rubber`, `glass`, `leather`, `lamp`, `tail`,
 * `signal`), avant vers +X, +Y vers le haut, origine au sol au centre de l'empattement, mètres.
 */
export interface VehicleAdapt {
  /** Quarts de tour à ajouter autour de la verticale pour amener l'avant vers +X. */
  yawQuarterTurns?: number;
  /** Vitrages : matériaux rendus transparents et teintés. */
  glass?: { materials: readonly string[]; color: Hex; opacity: number };
  /** Optiques allumées : matériaux, couleur et force de l'émission. */
  lamps?: ReadonlyArray<{ materials: readonly string[]; color: Hex; intensity: number }>;
  /** Matériaux qui portent des logos : remplacés par une plaque unie de la teinte `plainColor`. */
  plainMaterials?: readonly string[];
  plainColor?: Hex;
  /** Textures qui portent des logos : retirées de tout le modèle. */
  logoTextures?: ReadonlyArray<{ material: string; maps: readonly string[]; color?: Hex }>;
}

/**
 * Optiques d'un modèle (Custom › Phares, src/data/phares.ts) : matériaux des optiques avant (leur lueur
 * prend la couleur choisie, leur glace la teinte) et des feux arrière (rouges ou fumés). Absent : les
 * rôles des conventions, `lamp` et `tail`.
 */
export interface VehicleLights {
  front: readonly string[];
  rear: readonly string[];
  /**
   * Nœuds de l'habitacle dont les pièces portent la matière d'une optique sans en être une (voyants,
   * accents rouges de la planche de bord) : elles gardent leur lueur, quels que soient les réglages.
   */
  interior?: readonly string[];
}

/**
 * Moteur d'origine : le point de départ de la fiche de préparation (reprogrammation, carburation,
 * nitro). Des chiffres d'atelier pour le plaisir, pas une simulation mécanique.
 */
export interface EngineSpec {
  /** En clair, sans nom de constructeur : « 4 cylindres à plat refroidi par air ». */
  label: string;
  fuel: 'essence' | 'diesel';
  /** Alimentation d'origine : décide entre carburation et reprogrammation. */
  feed: 'carburateur' | 'injection';
  /** Suralimentation d'origine. */
  boost: 'atmo' | 'turbo' | 'compresseur';
  /** Puissance d'origine, en chevaux. */
  power: number;
  /**
   * Famille de sons du moteur : dossier public/assets/audio/engines/<famille>/ (fabriqué par
   * `npm run sons:build`). Absente, ou sans sons fabriqués : le moteur reste muet.
   */
  sound?: string;
  /**
   * Modèle du moteur sur l'établi (§ 5.11) : une famille du catalogue public/assets/shared/engines/
   * (src/data/moteurs.ts). Absent : l'entrée « Moteur » dit que le modèle reste à faire.
   */
  model?: string;
  /**
   * Le moteur de l'établi posé dans le véhicule (capot ouvert, vitré ou déposé : pieces.capot) : où va
   * l'origine de son fichier (au sol, au pied du support), repère du véhicule posé ; demi-tour autour de
   * la verticale (degrés) ; échelle. Absent : le moteur ne se voit que sur l'établi.
   */
  pose?: EnginePose;
}

/** Pose du moteur dans le véhicule (src/data/moteurs.ts, checkEnginePose). */
export interface EnginePose {
  position: VehiclePoint;
  /** Rotation autour de la verticale, en degrés (0 : l'avant du moteur, côté volant moteur, vers l'avant du véhicule). */
  yaw?: number;
  /** Échelle du modèle (0,5 à 1,2) : un substitut à la taille d'un véhicule qui l'est aussi. */
  scale?: number;
}

/**
 * Performances sur la route (sortie de nuit, § 5.5) : avec `engine.power` et la boîte (celle que
 * nomme `gearbox`, sinon celle de la famille de sons, src/data/boites.ts), elles font l'accélération
 * et la vitesse de pointe du véhicule (src/drive/pilote.ts). Des chiffres plausibles pour le genre de
 * véhicule, pas relevés sur un modèle réel. Absentes : valeurs moyennes d'une voiture ou d'une moto.
 */
export interface PerformanceSpec {
  /** Masse en ordre de marche, pilote compris, en kg. */
  mass: number;
  /** Vitesse de pointe en ligne droite, en km/h (la boîte doit la permettre). */
  topKmh: number;
  /** Adhérence en courbe : accélération latérale la plus forte, en m/s² (la vitesse dans les virages, à la main). */
  grip: number;
  /** Boîte nommée de src/data/boites.ts (BOITES_NOMMEES) ; absente : celle de la famille de sons. */
  gearbox?: string;
  /**
   * Roues motrices (src/data/adherence.ts) : « propulsion », « traction » ou « integrale » ; absente :
   * une traction pour une voiture, l'arrière pour une moto. Fait le survirage et le patinage, à la main.
   */
  transmission?: 'propulsion' | 'traction' | 'integrale';
}

/** Point en mètres, dans le repère du véhicule (avant vers +X, haut vers +Y, droite vers +Z). */
export type VehiclePoint = readonly [number, number, number];

/** Places assises de la vue intérieure : conducteur (à gauche : conduite à gauche), passager, arrière. */
export type PlaceId = 'conducteur' | 'passager' | 'arriere';

/**
 * Œil d'une place, posé par rapport aux sièges du modèle chargé (résolu par la scène, src/scene/
 * fit.ts, placeEye) : les habitacles changent de pavillon, de planche ou de banquette sans qu'on
 * réécrive une coordonnée.
 */
export interface SeatEye {
  /**
   * Ancres des sièges (nœuds du modèle, `siege_avant_*`) : une pour un siège avant, les deux pour
   * l'arrière (l'œil se recule derrière elles).
   */
  anchors: readonly string[];
  /** Hauteur de l'œil au-dessus de l'assise du siège posé, en mètres (0,80 à 0,90 pour un adulte). */
  up: number;
  /** Siège avant : l'œil en avant de la face du dossier (ou de l'appuie-tête) à hauteur de tête, en mètres. */
  ahead?: number;
  /** Arrière : l'œil en arrière du dos des sièges avant, en mètres. */
  behind?: number;
  /** Décalage de côté depuis le milieu des ancres, vers la droite (+Z), en mètres. */
  side?: number;
  /** Écart gardé sous le pavillon mesuré au-dessus de l'œil, en mètres (0,12 par défaut). */
  headroom?: number;
}

/** Regard par défaut d'une place, en degrés : lacet vers la droite (+Z), tangage vers le haut. */
export interface PlaceLook {
  yaw: number;
  pitch: number;
}

/**
 * Une place de la vue intérieure. L'œil est soit posé sur les sièges du modèle (`seat`), soit, pour
 * un vrai modèle sans ancres, mesuré dans son GLB (`eye`) ; le regard soit un cap (`look`), soit un
 * point (`target`).
 */
export interface InteriorView {
  /** Place assise ; absente : un point de vue sans place (ancien format), traité comme le conducteur. */
  place?: PlaceId;
  seat?: SeatEye;
  eye?: VehiclePoint;
  target?: VehiclePoint;
  look?: PlaceLook;
  /** Nom court, dit par la commande qui y mène : « Conducteur », « Passager », « Arrière ». */
  label?: string;
  /** Champ vertical en portrait, en degrés (60 à 110) ; absent : celui de l'app (90). */
  fov?: number;
  /**
   * Volets de l'entrée Intérieur (volant, pommeau, sieges, ciel) que ce point de vue montre le mieux :
   * l'entrée s'y place quand on ouvre l'un d'eux. Absent : le premier point de vue.
   */
  volets?: readonly string[];
  /**
   * Œil et cadrage de la CONDUITE (caméra embarquée de la sortie), pour la place du conducteur : ils
   * s'écartent de ceux de la vue intérieure du garage, où l'on regarde l'habitacle et non la route.
   * Absent : les réglages par défaut de la caméra (src/drive/cameras.ts, COCKPIT).
   */
  conduite?: DriveEyeSpec;
}

/**
 * Œil de conduite d'une place (vague U : « on voit pas assez la route »), dans le repère du véhicule, en
 * mètres, depuis l'œil de la place (posé sur son siège ou repris du manifeste). Tableaux à deux valeurs :
 * écran en portrait, puis en paysage (entre les deux, la caméra mélange selon le format).
 */
export interface DriveEyeSpec {
  /** Relevé de l'œil (m, −0,1 à 0,35) ; jamais plus haut que le pavillon mesuré, moins une garde. */
  lift?: number;
  /** Avancée de l'œil vers l'avant (m, −0,3 à 0,3). */
  ahead?: number;
  /** Débattement du réglage « Hauteur du regard » : vers le bas puis vers le haut (m, 0 à 0,2). */
  regard?: readonly [number, number];
  /** Horizon : part de la hauteur de l'image depuis le haut (0,3 à 0,6). */
  horizon?: readonly [number, number];
  /** Champ vertical, en degrés (30 à 100). */
  fov?: readonly [number, number];
}

/** Motifs du médaillon du ciel étoilé : des dessins à nous, jamais un emblème de constructeur. */
export type SkyMotif = 'eclair' | 'flamme';

/**
 * Ciel de toit étoilé : un semis de points lumineux sous le plafond, plus serrés vers le centre,
 * avec un médaillon rond facultatif au milieu. Dessiné par l'app (src/scene/cabin.ts), pas par le
 * modèle : couleur, densité et motif changent sans refaire le GLB.
 */
export interface StarrySky {
  /** Centre du semis, juste sous le plafond. */
  center: VehiclePoint;
  /** Longueur (le long de X) et largeur (le long de Z) du semis, en mètres. */
  size: readonly [number, number];
  /** Nombre de points du semis, médaillon non compris. */
  count: number;
  color: Hex;
  /** Graine du tirage : un même manifeste donne toujours le même ciel. */
  seed?: number;
  /** Médaillon central : rayon en mètres, motif dessiné en points de la couleur des étoiles. */
  medallion?: { radius: number; motif: SkyMotif };
  /**
   * Bombé du pavillon : les points du milieu montent de tant au-dessus de ceux du bord (mètres),
   * pour rester collés à un ciel de toit cintré. Absent : un plafond plat.
   */
  crown?: number;
  /** Allumé d'origine ; absent : vrai. L'utilisateur l'allume ou l'éteint (Custom · Intérieur). */
  on?: boolean;
}

/** Lumière d'habitacle, allumée en vue intérieure seulement. */
export interface CabinLight {
  position: VehiclePoint;
  /** Absente : la couleur du ciel étoilé (ou blanc chaud sans ciel). */
  color?: Hex;
  /** Intensité, en candelas. */
  intensity: number;
  /** Portée, en mètres : au-delà, elle n'éclaire plus rien (le garage reste tel quel). */
  distance: number;
}

/**
 * Instrument vivant porté par un panneau (src/scene/vehicle/tableau.ts) : en sortie de nuit, à la
 * caméra embarquée, il suit la vitesse du compteur de l'écran (km/h entiers) ou le régime du moteur ;
 * au garage, il reste à zéro. Aucun identifiant de véhicule dans le code : tout vient d'ici.
 */
export interface PanelInstrument {
  /** Ce qu'il montre : la vitesse (km/h) ou le régime (tr/min). */
  mesure: 'vitesse' | 'regime';
  /**
   * Valeur de fin de plage (km/h ou tr/min). Absente : 240 km/h pour la vitesse, la fin du cadran
   * du moteur (zones.max du pilote) pour le régime.
   */
  max?: number;
  /** « aiguille » (cadran, graduations) ou « chiffres » (segments). Absent : aiguille sur un disque, chiffres sur un rectangle. */
  affichage?: 'aiguille' | 'chiffres';
  /** Cadran : angles de début et de fin du balayage, en degrés depuis le haut, sens horaire (absent : −135 et 135). */
  balayage?: readonly [number, number];
  /** Cadran : « antihoraire » renverse le balayage (absent : horaire). */
  sens?: 'horaire' | 'antihoraire';
  /** Afficheur de chiffres : ajoute en bas une barre de régime. */
  barre?: 'regime';
}

/**
 * Surface rétroéclairée de la planche (cadran, écran) : dessinée par l'app devant son support noir
 * du modèle, allumée en vue intérieure seulement. Avec un `instrument`, elle montre une aiguille ou
 * des chiffres qui suivent la sortie de nuit.
 */
export interface CabinPanel {
  shape: 'disque' | 'rectangle';
  center: VehiclePoint;
  /** Normale, tournée vers l'habitacle. */
  normal: VehiclePoint;
  /** Diamètre (deux fois le même), ou largeur et hauteur, en mètres. */
  size: readonly [number, number];
  color: Hex;
  /** Force, de 0 à 1 (absente : 1) : lisible de nuit, sans halo. */
  intensity?: number;
  /**
   * Rectangle seulement : largeur du bord haut, en mètres, pour un écran trapézoïdal (`size[0]` est alors
   * celle du bord bas). Absent : un rectangle.
   */
  haut?: number;
  /** Instrument vivant (vitesse ou régime) ; absent : une surface unie. */
  instrument?: PanelInstrument;
}

export interface CabinLighting {
  sky?: StarrySky;
  light?: CabinLight;
  panels?: readonly CabinPanel[];
}

/**
 * Pièces d'habitacle au choix (§ 5.4, demande du 15 novembre 2026) : volant, pommeau de levier et
 * sièges avant, posés par l'app sur les ancres du modèle (`volant`, `pommeau`, `siege_avant_*`),
 * depuis le catalogue partagé (src/data/habitacle.ts). Le ciel étoilé, lui, est `cabin.sky`.
 */
export interface VehicleInterior {
  /** Vrai : un vrai modèle qui garde son intérieur ; l'atelier le dit au lieu de proposer des choix. */
  fixed?: boolean;
  /**
   * Volant d'origine d'un vrai modèle (habitacle fixe) : nom de son nœud. Gardé hors de la fusion des
   * pièces (`prepare`), il tourne en sortie de nuit autour de sa colonne (src/drive/scene/roues.ts,
   * `steeringWheelPart`), les mains du conducteur avec lui. Un substitut a, lui, l'ancre `volant`.
   */
  steeringNode?: string;
  /**
   * Habitacle d'un vrai modèle (fixe) : ses zones de peinture (sellerie, planche, tapis…), que l'entrée
   * Intérieur relie à Peinture. Elles doivent exister dans `zones`.
   */
  tints?: readonly string[];
  /** Volant d'origine (identifiant du catalogue). */
  steering?: { default: string };
  /** Pommeau d'origine ; `zone` : zone de peinture qui le colore (sinon sa couleur propre). */
  knob?: { default: string; zone?: string };
  /** Sièges avant d'origine ; `zone` : zone de la sellerie ; `scale` : échelle des sièges posés. */
  seats?: { default: string; zone?: string; scale?: number };
  /**
   * Plancher (hauteur, m) et tableau de bord (face en x et dessus en y, m) : aucune pièce posée ne les
   * traverse (contrôlé par npm run vehicles:build et les tests).
   */
  clearance?: { floor: number; dash: readonly [number, number] };
}

/** Cote d'une roue : diamètre de jante (pouces), largeur du pneu (mm), série (hauteur du flanc, % de la largeur). */
export interface WheelSize {
  diameter: number;
  width: number;
  aspect: number;
}

/**
 * Jantes et pneus au choix (§ 5.4), posés par l'app sur les ancres `roue_*` du modèle (une ancre
 * par roue, axe sur Z local, face extérieure vers +Z, centre au moyeu), depuis le catalogue des
 * roues partagées (src/data/wheels.ts).
 */
export interface WheelFit {
  /** Zone de peinture des jantes (couleur et finition restent dans Peinture). */
  zone: string;
  /** Dessin et pneu d'origine (identifiants du catalogue). */
  rim: string;
  tire: string;
  /** Cotes d'origine, avant ; arrière si elles diffèrent (le décalage est gardé quand on change). */
  front: WheelSize;
  rear?: WheelSize;
  /** Bornes des curseurs : diamètre de jante (pouces), série (%). */
  diameter: readonly [number, number];
  aspect: readonly [number, number];
  /** Largeur du pneu avant (voitures : l'arrière suit avec son décalage d'origine), en mm. */
  width?: readonly [number, number];
  /** Largeur du pneu arrière seul (motos), en mm. */
  rearWidth?: readonly [number, number];
  /** Dessins admis ; absent : toutes les jantes du genre du véhicule. */
  rims?: readonly string[];
}

/**
 * Le conducteur à bord : sa pose se calcule sur les ancres du modèle (siège et volant ; assise,
 * poignées et repose-pieds d'une moto). Ce bloc n'en règle que l'allure.
 */
export interface DriverSpec {
  /** Bras vers les poignées d'une moto, en part de la longueur du bras : 0,75 coudes pliés, 0,95 bras tendus. */
  reach?: number;
  /** En courbe, penché au-delà de la moto, en part de son inclinaison. */
  leanExtra?: number;
  /** Décalage du bassin vers l'intérieur de la courbe, en mètres, au plus. */
  hangOff?: number;
}

/** Une sortie d'échappement : bouche du tuyau (point du repère du véhicule), direction du jet, rayon (m). */
export interface ExhaustOutlet {
  position: VehiclePoint;
  /** Vers où sort le jet (normalisée par l'app) : vers l'arrière, −X, le plus souvent. */
  direction: VehiclePoint;
  /** Rayon intérieur de la sortie, en mètres ; absent : 2,5 cm. */
  radius?: number;
}

/**
 * Ligne d'échappement (src/data/echappement.ts) : les sorties d'où partent les flammes en sortie de nuit
 * (src/drive/scene/flammes.ts), et les nœuds du modèle qui portent les sorties, dont les pièces de métal
 * prennent la finition choisie (src/scene/vehicle/echappement.ts). Sans `nodes` : pas de finition ;
 * sans section : ni flammes ni finition (le son, lui, change toujours).
 */
export interface ExhaustSpec {
  /** Une à quatre sorties. */
  outlets: readonly ExhaustOutlet[];
  /** Nœuds du modèle qui portent les sorties (« echappement »). */
  nodes?: readonly string[];
}

/** Roues et assiette d'un véhicule. */
export interface VehicleWheels {
  /** Jantes et pneus au choix ; absent : le modèle garde les siens, seule l'assiette se règle. */
  fit?: WheelFit;
  /** Nœuds de roue d'un modèle qui ne suit pas la convention `roue_*` (modèle adapté). */
  nodes?: readonly string[];
  /** Nœuds posés au sol qui ne suivent pas la caisse (béquille). */
  grounded?: readonly string[];
  /**
   * Place au-dessus du pneu d'origine, avant et arrière, en mètres : jusqu'où la roue peut monter
   * dans le passage de roue ou sous le garde-boue sans traverser l'aile. Borne le diamètre et
   * l'assiette.
   */
  gap: readonly [number, number];
  /** Hauteur du point le plus bas de la caisse, à l'origine, en mètres (béquille exclue). */
  floor: number;
}

/**
 * Profil d'une surface de pose, en paires [distance, descente] (mètres) : en travers (`crown`), à `z` de
 * l'axe, la surface descend de tant à la verticale ; en long (`bend`), à `x` du point de pose (le long de
 * la surface au bord de fuite, positif vers l'avant ; à l'horizontale sous les pieds, des deux côtés),
 * elle passe de tant sous le plan de la normale.
 */
export type CrownProfile = ReadonlyArray<readonly [distance: number, drop: number]>;

/**
 * Où se posent les pieds d'un aileron sur supports (src/data/pieces.ts) : le milieu des pieds sur la
 * surface, sur l'axe, et la normale de la surface en ce point.
 */
export interface PieceSupports {
  anchor: VehiclePoint;
  normal: VehiclePoint;
  /** Entraxe des pieds, en mètres. */
  spacing: number;
  /** Envergure de la lame, dérives comprises, en mètres. */
  span: number;
  crown?: CrownProfile;
  bend?: CrownProfile;
}

/** Ce qu'un poste de pièce montée permet sur ce véhicule, quelle que soit sa pose. */
interface PieceChoices {
  /** Options permises (identifiants du catalogue) ; absent : toutes celles que la pose accepte. */
  options?: readonly string[];
  /** Option d'origine ; absente : aucune pièce. */
  default?: string;
}

/**
 * Un poste de pièce montée sur une surface (catalogue public/assets/shared/pieces/) : le bord de fuite
 * de la surface de pose, sur l'axe (becquet, queue de canard s'y posent), sa normale, sa largeur
 * utile ; les pieds d'un aileron sur supports ; les options permises.
 */
export interface PieceSurfaceMount extends PieceChoices {
  anchor: VehiclePoint;
  normal: VehiclePoint;
  /** Largeur utile au bord de fuite, en mètres. */
  width: number;
  crown?: CrownProfile;
  bend?: CrownProfile;
  /** Absent : les options sur supports ne sont pas permises. */
  supports?: PieceSupports;
}

/**
 * Un poste de pièce posée le long d'une ligne de la caisse (kit carrosserie : lame avant, jupes,
 * diffuseur ; src/data/pieces.ts, fitRail). `rail` : des points sur la face extérieure, en bas de
 * caisse, à quelques centimètres l'un de l'autre. Pièce sur l'axe (lame, diffuseur) : du point sur
 * l'axe (z = 0) vers un bout, la pièce prend aussi le symétrique ; paire (jupes, poste `mirror` du
 * catalogue) : sur le flanc droit, de l'avant vers l'arrière, la pièce gauche est son miroir. La pièce
 * descend sous la ligne au plus jusqu'au bas de caisse (`wheels.floor`) et monte au plus de `rise` contre
 * la face (là où elle reste d'aplomb).
 */
export interface PieceRailMount extends PieceChoices {
  rail: readonly VehiclePoint[];
  /** Hauteur de face d'aplomb au-dessus de la ligne, en mètres. */
  rise: number;
}

/**
 * Le poste « capot » (capot moteur qui s'ouvre, capot vitré, sans capot ; src/scene/vehicle/capot.ts) :
 * les nœuds du modèle, pas un fichier partagé. `lid` : le capot d'origine, son pivot sur la charnière ;
 * `glazed` : sa variante vitrée (même pivot) ; `bay` : le compartiment, caché capot fermé ; `axis` et
 * `angle` : l'ouverture, autour d'un axe du nœud, en degrés ; `pin` : la pastille « Ouvrir le capot » (son point et la normale du capot : vue de l'autre côté, elle se cache) ;
 * `frame` : ce que la caméra du garage cadre capot ouvert (repère du véhicule posé) ; `carries` : les
 * postes posés sur le capot.
 */
export interface PieceLidMount extends PieceChoices {
  lid: string;
  glazed?: string;
  bay?: string;
  axis: VehiclePoint;
  angle: number;
  pin: { at: VehiclePoint; normal: VehiclePoint };
  frame: { face: '+x' | '-x' | '+y' | '-y' | '+z' | '-z'; center: VehiclePoint; size: VehiclePoint };
  /** Postes posés sur le capot (un aileron sur le capot moteur) : ils s'ouvrent avec lui, partent avec lui. */
  carries?: readonly string[];
}

/** Un poste de pièce montée : sur une surface, le long d'une ligne, ou un capot. Absent du manifeste : le poste n'existe pas. */
export type PieceMount = PieceSurfaceMount | PieceRailMount | PieceLidMount;

/**
 * Une zone de néons (Custom › Néons, src/data/neons.ts) : où passent ses tubes ou ses rubans, des lignes
 * brisées dans le repère du véhicule (caisse au repos), et, pour la zone `roues`, des arceaux tirés des
 * ancres de roue par l'app. L'habitacle porte aussi ses nappes de lueur sur le plancher (`pools`).
 */
export interface VehicleNeonZone {
  tubes?: ReadonlyArray<readonly VehiclePoint[]>;
  /** Zone `roues` : un arc dans chaque passage de roue (voiture), deux cercles par roue (moto). */
  arceaux?: true;
  /** Rayon du tube, en mètres ; absent : celui du catalogue (tube sous la caisse, ruban dans l'habitacle). */
  radius?: number;
  /** Habitacle : lueurs posées sur le plancher, de `from` à `to` (hauteur du plancher en y), portée `radius`. */
  pools?: ReadonlyArray<{ from: VehiclePoint; to: VehiclePoint; radius: number }>;
  /** Nom et ligne d'atelier propres à ce véhicule (« Dans les roues » sur une moto). */
  label?: string;
  hint?: string;
}

/** Néons d'un véhicule, zone par zone (identifiants du catalogue de src/data/neons.ts). */
export type VehicleNeons = Readonly<Record<string /* id de zone */, VehicleNeonZone>>;

export interface VehicleManifest {
  /** Égal au nom du dossier. */
  id: VehicleId;
  /** Nom de travail générique, affiché : « La Cox ». Jamais un nom de constructeur ou de modèle. */
  name: string;
  kind: 'car' | 'bike';
  /** Vague du catalogue (§ 3) ; 0 : le modèle de banc d'essai. */
  wave: 0 | 1 | 2 | 3;
  /** Rang dans le catalogue ; le plus petit est le véhicule de départ. */
  order: number;
  /** Fichier du modèle, relatif au dossier du véhicule. */
  glb: string;
  /** Une ligne d'atelier sous le nom, dans le catalogue. */
  hint?: string;
  /** Substitut déclaré dans TODO_ASSETS.md (`placeholder_*`) ; absent pour un modèle définitif. */
  placeholder?: string;
  /** Demi-longueur attendue avant chargement, en mètres (cadrage d'attente). */
  halfLengthHint: number;
  /** Zones à colorer, dans l'ordre d'affichage ; la première 'carrosserie' est la zone maîtresse. */
  zones: readonly Zone[];
  /** Moteur d'origine ; absent : pas de fiche de préparation pour ce véhicule. */
  engine?: EngineSpec;
  /** Performances sur la route ; absentes : celles d'un véhicule moyen de son genre. */
  performance?: PerformanceSpec;
  /**
   * Première place de la vue intérieure (§ 5.1), le conducteur : œil et regard dans le repère du
   * véhicule (avant vers +X, haut vers +Y, droite vers +Z), en mètres. Absent : pas de vue intérieure.
   */
  interiorView?: InteriorView;
  /** Places suivantes (passager, arrière), chacune une fois au plus ; on les choisit par leur nom. */
  interiorViews?: readonly InteriorView[];
  /** Ce que l'habitacle allume en vue intérieure (§ 5.10) : ciel étoilé, lumière d'habitacle. */
  cabin?: CabinLighting;
  /**
   * Côté montré dans la vue de départ de l'atelier : 'droite' pose le véhicule nez à droite, la
   * caméra en miroir (le bobber montre ses échappements). Absent : 'gauche', nez à gauche.
   */
  presentSide?: 'gauche' | 'droite';
  adapt?: VehicleAdapt;
  /** Optiques avant et feux arrière (Custom › Phares) ; absent : les rôles `lamp` et `tail`. */
  lights?: VehicleLights;
  /** Roues (jantes, pneus, cotes) et assiette ; absent : ni l'un ni l'autre ne se règle. */
  wheels?: VehicleWheels;
  /** Volant, pommeau et sièges au choix ; absent : pas d'habitacle à garnir. */
  interior?: VehicleInterior;
  /** Le conducteur à bord (src/data/conducteur.ts) ; absent : les réglages par défaut de son genre. */
  driver?: DriverSpec;
  /** Zones de livrée où se posent les stickers (src/data/stickersCalques.ts) ; absent : pas de stickers. */
  livery?: readonly LiveryZone[];
  /** Pièces montées sur la caisse, poste par poste (aileron, kit carrosserie…, src/data/pieces.ts) ; absent : aucune. */
  pieces?: Readonly<Record<string /* id de poste */, PieceMount>>;
  /** Sorties d'échappement (flammes, finition) ; absent : ni flammes ni finition. */
  exhaust?: ExhaustSpec;
  /** Néons, zone par zone (Custom › Néons) ; absent : pas de néons. */
  neons?: VehicleNeons;
}

/**
 * Ce que l'utilisateur a fait d'un véhicule : ses peintures, zone par zone ; ses pièces et
 * préparations, poste par poste (§ 5.4 : préparation du moteur, jantes, pneus) ; ses curseurs
 * (cotes des roues, assiette) et la couleur de ses pneus.
 */
export interface Build {
  paints: Record<string /* id de zone */, PaintChoice>;
  parts?: Record<string /* id de poste */, string /* id d'option */>;
  /** Curseurs (§ 6) : diamètre de jante, largeur et série du pneu, assiette… */
  tune?: Record<string /* id de curseur */, number>;
  /** Couleur propre d'une pièce (§ 6) : la marque du pneu (liseré, flanc blanc, lettres). */
  partPaints?: Record<string /* id de poste */, Partial<Paint>>;
  /** Stickers posés, zone de livrée par zone (§ 5.3). */
  stickers?: BuildStickers;
}
