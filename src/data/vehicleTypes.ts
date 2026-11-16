// Contrat des véhicules (§ 6 et § 8 du cahier des charges) : ce que décrit le manifeste
// `public/assets/vehicles/<id>/vehicle.json` d'un véhicule, et ce qu'un build retient de lui.
// Types seuls, aucune donnée : le catalogue est découvert au build, rien n'est codé en dur par
// véhicule. Les champs du § 6 qui manquent ici (pièces, curseurs, livrée, néons, intérieur,
// moteur) arriveront avec leur jalon ; un manifeste ou un build qui les porte déjà reste lisible.

import type { FinishId } from './finishes.ts';

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
 * Surface rétroéclairée de la planche (cadran, écran) : dessinée par l'app devant son support noir
 * du modèle, allumée en vue intérieure seulement.
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
  /** Roues (jantes, pneus, cotes) et assiette ; absent : ni l'un ni l'autre ne se règle. */
  wheels?: VehicleWheels;
  /** Volant, pommeau et sièges au choix ; absent : pas d'habitacle à garnir. */
  interior?: VehicleInterior;
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
}
