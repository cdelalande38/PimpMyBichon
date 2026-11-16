// Sortie de nuit, lot 1 (conduite sur rail, § 5.5 du cahier des charges) : contrat entre la conduite
// et la scène.
//
// - La conduite fournit des fonctions pures et l'état : où est le véhicule sur le parcours, à quelle
//   vitesse, d'où on le regarde. Fichiers : src/drive/rail.ts, pilote.ts, cameras.ts, realisateur.ts,
//   src/state/drive.ts, src/ui/drive/.
// - La scène tient la boucle de rendu. À chaque image elle fait avancer le pilote, lit la pose du
//   véhicule et le plan de la caméra, charge et libère les tronçons de la carte, pose les lumières.
//   Fichiers : src/drive/DriveCanvas.tsx, src/drive/scene/.
//
// Repère : celui de la carte (src/data/mapTypes.ts) : le mètre, X vers l'est, Y vers le haut, Z vers
// le sud. Un véhicule a l'avant vers +X dans son propre repère (src/data/vehicleTypes.ts).

import type { BoiteSpec } from '../data/boites.ts';
import type { MapId, MapRoute, RailGround } from '../data/mapTypes.ts';

export type Vec3 = [number, number, number];

/** Où l'on est sur le parcours, et ce que la route y fait. */
export interface RailPose {
  /** Abscisse, en mètres depuis le départ. */
  s: number;
  /** Point de l'axe de la chaussée. */
  position: Vec3;
  /** Direction de la marche, unitaire. */
  tangent: Vec3;
  /** Cap : rotation autour de Y à donner au véhicule pour que son avant (+X) suive la tangente. */
  heading: number;
  /** Pente de la route, en radians, positive en montée. */
  pitch: number;
  /** Courbure, en 1/m : positive quand la route tourne à gauche, nulle en ligne droite. */
  curvature: number;
  ground: RailGround;
  urban: boolean;
  lanes: number;
  /** Largeur de la chaussée, en mètres. */
  width: number;
  /** Vitesse limite de la section, en km/h, quand la carte la connaît (RailSection.speed). */
  limit?: number;
}

/** Le parcours d'une carte, interrogeable à toute abscisse. Fourni par `createRail` (src/drive/rail.ts). */
export interface Rail {
  readonly length: number;
  readonly loop: boolean;
  /** Remplit `out` (aucune allocation par image) et le rend. Hors du parcours : borné, ou rebouclé. */
  poseAt(s: number, out: RailPose): RailPose;
}

export type CreateRail = (route: MapRoute) => Rail;

/** Commandes du joueur. Pilote automatique : `auto` vrai, le reste est ignoré. */
export interface DriveInput {
  auto: boolean;
  /** Accélérateur, de 0 à 1. */
  throttle: number;
  /** Frein, de 0 à 1. */
  brake: number;
  /** Placement demandé sur la chaussée : −1 à gauche de sa voie, 0 au milieu, 1 à droite. */
  lane: -1 | 0 | 1;
  /**
   * NOS : compteur des appuis sur le bouton. Chaque nouvelle valeur demande une poussée (à la main,
   * réserve suffisante) ; absent ou inchangé : rien.
   */
  nos?: number;
}

/** Mouvement du véhicule sur le rail, avancé par le pilote. */
export interface DriveMotion {
  /** Abscisse, en mètres. */
  s: number;
  /** Vitesse, en m/s. */
  speed: number;
  /** Accélération, en m/s² ; négative au freinage. */
  accel: number;
  /** Écart latéral à l'axe de la chaussée, en mètres, positif vers la gauche de la marche. */
  offset: number;
  /**
   * Roulis de la caisse d'une voiture, ou inclinaison d'une moto dans la courbe, en radians :
   * rotation autour de l'axe avant (+X) du véhicule, au sens direct de three.js ; positif, le toit
   * part vers la droite (+Z du véhicule). Une voiture roule vers l'extérieur du virage, une moto
   * s'incline vers l'intérieur.
   */
  roll: number;
  /**
   * Plongée au freinage ou cabrage à l'accélération, en radians, en plus de la pente : rotation
   * autour de l'axe latéral, de même sens que `pitch` (positive nez en l'air, négative au freinage).
   */
  dive: number;
  /** Feux stop allumés. */
  braking: boolean;
  /** Bout d'un parcours ouvert atteint : le véhicule s'arrête. */
  finished: boolean;
  /** Accélération lissée (≈ 0,5 s), en m/s² : ce que les caméras ressentent, sans les à-coups des passages. */
  pull?: number;
  /** Poussée du NOS, de 0 à 1, adoucie (champ de la caméra, lueur à l'échappement). */
  boost?: number;
}

/**
 * Le moteur et sa boîte, avancés par le pilote à chaque sous-pas (src/drive/boite.ts) : une seule
 * vérité pour le compte-tours, le son du moteur et la coupure de poussée aux passages.
 */
export interface DriveTrain {
  /** Régime du moteur réel, en tr/min. */
  rpm: number;
  /** Rapport engagé, de 1 à `gears`. */
  gear: number;
  gears: number;
  /** Passage de rapport en cours (la poussée est coupée, l'aiguille retombe). */
  shifting: boolean;
  /** Charge du moteur, de 0 à 1 (l'accélérateur ; relâchée au frein et pendant un passage). */
  load: number;
  /** Ralenti et rupteur, en tr/min. */
  idle: number;
  redline: number;
  /** Zones du cadran, en tr/min (début du vert, de l'orange, du rouge ; fin du cadran). */
  zones: Readonly<{ vert: number; orange: number; rouge: number; max: number }>;
  /** NOS envoyé. */
  nos: boolean;
  /** Réserve de NOS, de 0 à 1 : se vide pendant la poussée, se recharge seule, lentement. */
  nosReserve: number;
}

/** Fait avancer le véhicule. Fourni par `createPilot` (src/drive/pilote.ts). */
export interface Pilot {
  readonly motion: DriveMotion;
  /** Moteur et boîte (pilote de src/drive/pilote.ts) ; absent d'un pilote qui n'en tient pas. */
  readonly train?: DriveTrain;
  /** Demi-largeur et demi-longueur hors tout du véhicule posé, en mètres (marge au bord de la chaussée). */
  setSize?(halfWidth: number, halfLength: number): void;
  /** Repart d'une abscisse, à l'arrêt. */
  reset(s: number): void;
  /** Avance de `dt` secondes (borné par l'appelant à 0,1 s). */
  step(dt: number, input: DriveInput, kind: 'car' | 'bike'): DriveMotion;
}

/**
 * Ce que le pilote sait du véhicule (src/drive/pilote.ts, `performanceDe`) : tiré du manifeste
 * (engine.power, performance) et de la boîte ; rien n'est écrit par véhicule dans le code.
 */
export interface DrivePerformance {
  kind: 'car' | 'bike';
  /** Masse en ordre de marche, en kg. */
  mass: number;
  /** Puissance, en chevaux. */
  power: number;
  /** Vitesse de pointe en ligne droite, en km/h. */
  topKmh: number;
  /** Accélération latérale la plus forte à la main, en m/s². */
  grip: number;
  gearbox: BoiteSpec;
  /** Demi-largeur et demi-longueur hors tout, en mètres (avant que le modèle soit posé : celles du genre de véhicule). */
  halfWidth: number;
  halfLength: number;
  /** Puissance ajoutée par le NOS, en part de la puissance (un kit nitro monté la grossit). */
  nosBoost?: number;
}

export type CreatePilot = (rail: Rail, performance?: DrivePerformance) => Pilot;

/** Les six caméras du § 5.5. */
export type CameraId = 'poursuite' | 'rasante' | 'avant' | 'embarquee' | 'travelling' | 'orbite';

export const CAMERA_IDS: readonly CameraId[] = ['poursuite', 'rasante', 'avant', 'embarquee', 'travelling', 'orbite'];

/** Ce que la caméra doit savoir du véhicule, dans le repère de la carte. */
export interface VehicleFrame {
  kind: 'car' | 'bike';
  /** Point au sol, au centre de l'empattement. */
  position: Vec3;
  heading: number;
  /** Pente de la route plus plongée de caisse. */
  pitch: number;
  roll: number;
  halfLength: number;
  halfWidth: number;
  height: number;
}

/** Réglage de la caméra d'orbite, tenu par le geste du joueur. */
export interface OrbitView {
  /** Angle autour du véhicule, en radians, 0 derrière lui. */
  yaw: number;
  /** Élévation, en radians. */
  pitch: number;
  /** Distance, en mètres. */
  distance: number;
}

/** Plan rendu par une caméra. */
export interface CameraShot {
  position: Vec3;
  target: Vec3;
  /** Champ vertical, en degrés. */
  fov: number;
}

/**
 * Plan d'une caméra à un instant. Fourni par src/drive/cameras.ts. `time` est le temps de sortie, en
 * secondes ; `out` est rempli et rendu (aucune allocation par image).
 */
export type CameraShotOf = (
  id: CameraId,
  frame: VehicleFrame,
  motion: DriveMotion,
  rail: Rail,
  time: number,
  orbit: OrbitView,
  out: CameraShot,
) => CameraShot;

/** Mode réalisateur : choisit la caméra tout seul. Fourni par `createDirector` (src/drive/realisateur.ts). */
export interface Director {
  /** Caméra à montrer à l'instant `time` ; change de plan de temps en temps, jamais plus d'une fois par seconde. */
  pick(time: number, motion: DriveMotion, pose: RailPose): CameraId;
  reset(): void;
}

export type CreateDirector = () => Director;

export type Weather = 'sec' | 'pluie' | 'neige';

/** Ce que la scène publie pour l'interface, quatre fois par seconde au plus. */
export interface DriveTelemetry {
  /** La carte et le véhicule sont posés, la première image est rendue. */
  ready: boolean;
  /** Le chargement a échoué (carte absente, hors ligne à la première sortie). */
  failed: boolean;
  speedKmh: number;
  /** Abscisse, en mètres. */
  s: number;
  /** Part du parcours faite, de 0 à 1. */
  progress: number;
  finished: boolean;
}

/**
 * État de la sortie, tenu par src/state/drive.ts (`useDrive`, jamais sauvegardé sauf la météo et la
 * caméra préférées). L'interface écrit les commandes ; la scène les lit à chaque image par
 * `useDrive.getState()` et publie la télémétrie par `setTelemetry`.
 */
export interface DriveStore {
  /** Carte de la sortie en cours, ou `null` au garage. */
  map: MapId | null;
  /** Départ choisi (MapStart.id), ou `null` pour le premier. */
  start: string | null;
  camera: CameraId;
  /** Mode réalisateur : la caméra change toute seule. */
  director: boolean;
  weather: Weather;
  input: DriveInput;
  orbit: OrbitView;
  /** Ralenti (appui long). */
  slow: boolean;
  paused: boolean;
  telemetry: DriveTelemetry;
  setTelemetry: (telemetry: DriveTelemetry) => void;
  /** La scène n'a pas pu se poser (route absente, hors ligne à la première sortie, erreur de rendu). */
  fail: () => void;
}

/**
 * Attributs que la scène pose sur son élément racine (classe `drive-stage`), pour les parcours :
 * `data-sortie` (« chargement », « prete » ou « erreur »), `data-carte`, `data-vehicule`, `data-s`
 * (abscisse arrondie au mètre), `data-vitesse` (km/h arrondis), `data-camera`, `data-troncons`
 * (nombre de tronçons chargés), `data-meteo`.
 */
export const DRIVE_STAGE_CLASS = 'drive-stage';
