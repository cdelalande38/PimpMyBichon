// Le pilote (§ 5.5, lot 1) : fait avancer le véhicule sur le rail, tout seul ou à la main.
//
// Pilote automatique : une balade. Croisière à la vitesse limite quand la carte la connaît
// (OpenStreetMap), sinon selon la route (50 km/h en agglomération ; 70, 80 ou 90 km/h hors
// agglomération selon la largeur de la chaussée), vitesse réglée d'avance sur la courbure
// (accélération latérale plafonnée à PILOT.lateral m/s²), freinage anticipé et doux (profil de vitesse
// calculé une fois à rebours, à PILOT.plannedBrake m/s²), reprise franche dans la limite du moteur,
// arrêt au bout d'un parcours ouvert.
//
// À la main : accélérateur, frein, roue libre (frein moteur), NOS. La poussée vient du moteur du
// véhicule (`DrivePerformance`, tirée du manifeste par `performanceDe`) : puissance constante
// bornée par l'adhérence au départ, résistance de l'air réglée pour que l'équilibre tombe juste
// au-dessus de la vitesse de pointe, limiteur à la vitesse de pointe. Aux passages de rapport la
// poussée est presque coupée (PILOT.engine.cut) : ça se sent. Dans les courbes, l'adhérence borne la
// vitesse : une enveloppe de sécurité, calculée une fois sur toute la route à `performance.grip` m/s²
// d'accélération latérale, freine à la place du joueur avant qu'il ne traverse le décor. Aucune
// collision : il n'y a rien d'autre sur la route.
//
// Moteur et boîte (`train`) : la boîte de src/drive/boite.ts avance à chaque sous-pas ; c'est la
// seule vérité du régime et du rapport (compte-tours, son du moteur, coupure aux passages).
//
// NOS (à la main) : chaque nouvel appui (DriveInput.nos) envoie une poussée de PILOT.nos.duration s
// (puissance relevée, vitesse de pointe relevée, plein gaz) tant que la réserve tient ; la réserve se
// vide pendant la poussée et se recharge seule, lentement.
//
// Placement : la route est dégagée, on prend toute sa largeur. Le véhicule suit une trajectoire de
// route dégagée (`createRacingLine`), calculée une fois : une ficelle tendue entre les bords, au
// milieu sur les longues lignes droites, et dans les virages large à l'entrée, à la corde, large à la
// sortie ; lisse, sans à-coup latéral. Sa courbure, plus douce que celle de la route, fait la vitesse
// de passage en courbe (profils). Elle est bornée par la largeur réelle de la chaussée moins la
// demi-largeur du véhicule (`setSize`, sinon celle de son genre) et une garde, plus grande à
// l'extérieur des courbes (les coins du véhicule débordent, la chaussée dessinée suit des cordes de
// 4 m), resserrée un peu avant et après les rétrécissements. À la main, le placement demandé va
// jusqu'au bord gauche ou droit de la chaussée ; sans demande, la même trajectoire que le pilote.
// Le véhicule la suit avec un ressort amorti et ne quitte jamais la chaussée.
//
// Caisse : `roll` est la rotation autour de l'axe avant (+X) du véhicule, au sens direct de three.js :
// positif, le toit part vers la droite (+Z du véhicule). Une voiture roule vers l'extérieur du virage
// (ressort amorti) ; une moto s'incline vers l'intérieur (angle d'équilibre atan(v²κ/g)). `dive` est la
// rotation autour de l'axe latéral, positive nez en l'air (cabrage), négative au freinage (plongée).
//
// Tout est déterministe : l'intégration se fait en sous-pas d'au plus 1/120 s, quel que soit `dt`.
// `step` n'alloue rien.

import { boiteDuVehicule, vitesseMaxBoite } from '../data/boites.ts';
import { computePrep } from '../data/enginePrep.ts';
import type { Build, VehicleManifest } from '../data/vehicleTypes.ts';
import { etatInitial, pasBoite, zonesCadran, type SortieBoite } from './boite.ts';
import type { DriveInput, DriveMotion, DrivePerformance, DriveTrain, Pilot, Rail, RailPose } from './contrat.ts';
import { createPose } from './rail.ts';

export const PILOT = {
  /** Croisière en agglomération, km/h. */
  urbanKmh: 50,
  /** Croisière hors agglomération : chaussée large (≥ wideWidth m, deux voies et plus), courante, étroite (< narrowWidth m). */
  wideKmh: 90,
  roadKmh: 80,
  narrowKmh: 70,
  wideWidth: 6.5,
  narrowWidth: 5.5,
  /** Accélération latérale visée en courbe, m/s² (rond-point de 17 m : ≈ 27 km/h). */
  lateral: 3.2,
  /** Freinage prévu par le profil, m/s² : doux. */
  plannedBrake: 2,
  /** Freinage le plus fort du pilote automatique, m/s². */
  maxBrake: 4.5,
  /** Reprise la plus franche, m/s² ; en deçà, la part du moteur que le pilote prend (il ne roule jamais à fond). */
  accel: 4,
  autoShare: 0.6,
  /** Variation d'accélération la plus forte, m/s³ (pas d'à-coup). */
  jerk: 5,
  /** Gain de l'asservissement de vitesse, 1/s. */
  gain: 1.5,
  /** Anticipation : le pilote suit le profil à l'endroit où il sera dans ce délai, s (compense le retard du freinage progressif). */
  anticipation: 0.7,
  /**
   * Conduite à la main : frein (m/s²), roue libre (frein moteur, m/s²), vitesse de pointe et
   * adhérence d'un véhicule sans performances déclarées, freinage prévu par l'enveloppe, à-coups.
   */
  manual: { brake: 7, coast: 0.45, topKmh: 120, lateral: 4.5, brakeEnvelope: 5.5, jerk: 14 },
  /**
   * Moteur : rendement de la transmission, plafond d'accélération au départ (adhérence, cabrage d'une
   * moto) en m/s², équilibre de l'air au-dessus de la vitesse de pointe, roulement (m/s²), part de la
   * poussée gardée pendant un passage de rapport, bande du limiteur (part de la vitesse de pointe).
   */
  engine: { efficiency: 0.88, launch: { car: 8.5, bike: 8.4 }, dragMargin: 1.06, rolling: 0.12, cut: 0.12, limiter: 0.02 },
  /**
   * NOS : puissance ajoutée (part de la puissance), vitesse de pointe relevée (facteur), durée d'une
   * poussée (s), réserve vidée par seconde de poussée, rechargée par seconde, réserve minimale pour
   * partir, temps de montée de l'effet (s).
   */
  nos: { boost: 0.45, topRatio: 1.1, duration: 3, drain: 1 / 6.5, recharge: 1 / 50, minReserve: 0.12, ramp: 0.25 },
  /**
   * Placement latéral : pulsation du ressort (rad/s), vitesse latérale la plus forte (m/s, et en
   * part de la vitesse), avance de la visée (s), retrait d'un placement demandé au bord (m), garde
   * entre le flanc et le bord (m), en courbe : rentrée de la chaussée dessinée (m², fois la courbure)
   * et débord le plus fort compté (m).
   */
  lane: { omega: 3, maxRate: 2.5, maxRatePerSpeed: 0.15, lead: 0.3, request: 0.15, clearanceCar: 0.4, clearanceBike: 0.45, chordInset: 2, curveMax: 1 },
  /**
   * Trajectoire de route dégagée : pas (m), bornes resserrées sur ± `erode` pas (rétrécissements
   * adoucis par la fabrication), itérations et facteur de relaxation de la ficelle tendue, rappel
   * vers le milieu (au milieu sur les longues lignes droites), lissage de sa courbure (± pas).
   */
  line: { step: 4, erode: 3, iterations: 700, relax: 1.7, center: 0.003, smooth: 2 },
  /** Demi-largeur et demi-longueur d'un véhicule avant que son modèle soit posé, m. */
  halfWidth: { car: 0.95, bike: 0.45 },
  halfLength: { car: 2.2, bike: 1.05 },
  /** Roulis de caisse d'une voiture : rad par m/s² d'accélération latérale, plafond, ressort. */
  roll: { gain: 0.011, max: 0.075, omega: 9, damping: 0.55 },
  /** Inclinaison d'une moto : plafond, temps de réponse (s). */
  lean: { max: 0.8, tau: 0.22 },
  /** Plongée et cabrage : rad par m/s², plafond, ressort. */
  dive: { gainCar: 0.005, gainBike: 0.003, max: 0.035, omega: 8, damping: 0.6 },
  /** Lissage de l'accélération ressentie par les caméras, s. */
  pullTau: 0.5,
  /** Pas du profil de vitesse, m. */
  profileStep: 1,
  /** Sous-pas d'intégration le plus long, s. */
  substep: 1 / 120,
} as const;

/** Masse et puissance d'un véhicule sans performances déclarées. */
const DEFAULT_BODY = { car: { mass: 1200, power: 100 }, bike: { mass: 280, power: 60 } } as const;

/** Un cheval-vapeur, en watts. */
const HP = 735.5;

/**
 * Performances d'un véhicule pour la route, tirées de son manifeste : puissance (`engine.power`,
 * préparation du build comprise : reprogrammation, carburation), masse, vitesse de pointe,
 * adhérence, boîte ; un kit nitro monté grossit la poussée du NOS. Ce qui manque prend la valeur
 * d'un véhicule moyen de son genre. La vitesse de pointe est bornée par la boîte.
 */
export function performanceDe(vehicle: Pick<VehicleManifest, 'kind' | 'engine' | 'performance'>, build?: Pick<Build, 'parts'>): DrivePerformance {
  const kind = vehicle.kind;
  const spec = vehicle.performance;
  const gearbox = boiteDuVehicule(vehicle);
  const prep = computePrep(vehicle, build);
  const hp = prep?.prepared ?? DEFAULT_BODY[kind].power;
  const top = Math.min(spec?.topKmh ?? PILOT.manual.topKmh, vitesseMaxBoite(gearbox) / PILOT.nos.topRatio);
  return {
    kind,
    mass: spec?.mass ?? DEFAULT_BODY[kind].mass,
    power: hp,
    topKmh: top,
    grip: spec?.grip ?? PILOT.manual.lateral,
    gearbox,
    halfWidth: PILOT.halfWidth[kind],
    halfLength: PILOT.halfLength[kind],
    nosBoost: prep && prep.nitro > 0 ? Math.min(1, Math.max(PILOT.nos.boost, prep.nitro / Math.max(1, hp))) : PILOT.nos.boost,
  };
}

/** Performances par défaut (véhicule sans manifeste) : une voiture moyenne. */
export const DEFAULT_PERFORMANCE: DrivePerformance = performanceDe({ kind: 'car' });

const G = 9.81;
const kmh = (value: number) => value / 3.6;

/**
 * Croisière d'une section de route, en m/s : la vitesse limite quand la carte la connaît
 * (OpenStreetMap, plafonnée à la pointe de la conduite à la main), sinon selon la route.
 */
export function cruiseSpeed(pose: Pick<RailPose, 'urban' | 'width' | 'lanes' | 'limit'>, topKmh: number = PILOT.manual.topKmh): number {
  let wanted: number = PILOT.roadKmh;
  if (pose.limit && pose.limit > 0) wanted = pose.limit;
  else if (pose.urban) wanted = PILOT.urbanKmh;
  else if (pose.width < PILOT.narrowWidth) wanted = PILOT.narrowKmh;
  else if (pose.width >= PILOT.wideWidth && pose.lanes >= 2) wanted = PILOT.wideKmh;
  return kmh(Math.min(wanted, topKmh));
}

/** Centre de la voie où roule le véhicule (la voie de droite), en mètres vers la gauche de l'axe. */
export function laneCenter(pose: Pick<RailPose, 'width' | 'lanes'>): number {
  if (pose.lanes < 2) return 0;
  const lane = pose.width / pose.lanes;
  return -(pose.width / 2 - lane / 2);
}

/**
 * Écart le plus grand permis à l'axe, du côté le plus serré : la demi-chaussée moins la demi-largeur
 * du véhicule, la garde au bord et, en courbe, ce que les coins du véhicule débordent à l'extérieur
 * (flèche de sa demi-longueur) plus ce que la chaussée dessinée rentre (cordes de 4 m).
 */
export function laneBound(
  pose: Pick<RailPose, 'width'> & Partial<Pick<RailPose, 'curvature'>>,
  kind: 'car' | 'bike',
  halfWidth: number = PILOT.halfWidth[kind],
  halfLength: number = PILOT.halfLength[kind],
): number {
  const limits = laneLimits(pose, kind, halfWidth, halfLength, LIMITS);
  return Math.max(0, Math.min(-limits[0], limits[1]));
}

const LIMITS: [number, number] = [0, 0];

/**
 * Écarts permis à l'axe, [à droite (négatif), à gauche (positif)] : du côté de l'extérieur du virage,
 * les coins débordent et la chaussée dessinée rentre ; du côté de l'intérieur, rien de plus que la
 * garde. Chaussée trop étroite : les deux bornes se rejoignent au milieu de ce qui reste.
 */
export function laneLimits(
  pose: Pick<RailPose, 'width'> & Partial<Pick<RailPose, 'curvature'>>,
  kind: 'car' | 'bike',
  halfWidth: number,
  halfLength: number,
  out: [number, number],
): [number, number] {
  const clearance = kind === 'bike' ? PILOT.lane.clearanceBike : PILOT.lane.clearanceCar;
  const k = pose.curvature ?? 0;
  const L = PILOT.lane;
  const outward = Math.min(L.curveMax, Math.abs(k) * (L.chordInset + (halfLength * halfLength) / 2));
  const room = pose.width / 2 - halfWidth - clearance;
  // Virage à gauche (k > 0) : l'extérieur est à droite (écart négatif).
  let right = -(room - (k > 0 ? outward : 0));
  let left = room - (k < 0 ? outward : 0);
  if (right > left) right = left = (right + left) / 2;
  out[0] = right;
  out[1] = left;
  return out;
}

/** Trajectoire de route dégagée, échantillonnée tous les `step` mètres le long du rail. */
export interface RacingLine {
  readonly step: number;
  readonly loop: boolean;
  /** Écart à l'axe, m, positif vers la gauche de la marche. */
  readonly offset: Float64Array;
  /** Bornes visées (droite, négative ; gauche, positive), m. */
  readonly right: Float64Array;
  readonly left: Float64Array;
  /** Courbure de la trajectoire, 1/m, positive quand elle tourne à gauche. */
  readonly curvature: Float64Array;
}

/**
 * Trajectoire de route dégagée pour un véhicule : une ficelle tendue (relaxation projetée) entre les
 * bornes de la chaussée, rappelée doucement vers le milieu ; puis sa courbure, lissée.
 */
export function createRacingLine(rail: Rail, kind: 'car' | 'bike', halfWidth: number, halfLength: number): RacingLine {
  const P = PILOT.line;
  const loop = rail.loop;
  const n = loop ? Math.max(4, Math.round(rail.length / P.step)) : Math.max(2, Math.ceil(rail.length / P.step) + 1);
  const step = loop ? rail.length / n : rail.length / Math.max(1, n - 1);
  const cx = new Float64Array(n);
  const cz = new Float64Array(n);
  const nx = new Float64Array(n);
  const nz = new Float64Array(n);
  const lo = new Float64Array(n);
  const hi = new Float64Array(n);
  const pose = createPose();
  const lim: [number, number] = [0, 0];
  for (let i = 0; i < n; i += 1) {
    rail.poseAt(Math.min(rail.length, i * step), pose);
    const [tx, , tz] = pose.tangent;
    const flat = Math.hypot(tx, tz) || 1;
    cx[i] = pose.position[0];
    cz[i] = pose.position[2];
    // Gauche de la marche : (tz, −tx).
    nx[i] = tz / flat;
    nz[i] = -tx / flat;
    laneLimits(pose, kind, halfWidth, halfLength, lim);
    lo[i] = lim[0];
    hi[i] = lim[1];
  }
  const at = (i: number) => (loop ? ((i % n) + n) % n : Math.min(n - 1, Math.max(0, i)));
  const right = new Float64Array(n);
  const left = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    let r = -Infinity;
    let l = Infinity;
    for (let k = -P.erode; k <= P.erode; k += 1) {
      r = Math.max(r, lo[at(i + k)]!);
      l = Math.min(l, hi[at(i + k)]!);
    }
    if (r > l) r = l = (r + l) / 2;
    right[i] = r;
    left[i] = l;
  }
  const offset = new Float64Array(n);
  for (let i = 0; i < n; i += 1) offset[i] = Math.max(right[i]!, Math.min(left[i]!, 0));
  const first = loop ? 0 : 1;
  const last = loop ? n : n - 1;
  for (let it = 0; it < P.iterations; it += 1) {
    for (let i = first; i < last; i += 1) {
      const a = at(i - 1);
      const b = at(i + 1);
      const ox = (cx[a]! + nx[a]! * offset[a]! + cx[b]! + nx[b]! * offset[b]!) / 2 - (cx[i]! + nx[i]! * offset[i]!);
      const oz = (cz[a]! + nz[a]! * offset[a]! + cz[b]! + nz[b]! * offset[b]!) / 2 - (cz[i]! + nz[i]! * offset[i]!);
      const pull = ox * nx[i]! + oz * nz[i]! - P.center * offset[i]!;
      offset[i] = Math.max(right[i]!, Math.min(left[i]!, offset[i]! + P.relax * pull));
    }
  }
  // Courbure de la trajectoire : angle entre deux cordes, par mètre ; lissée.
  const raw = new Float64Array(n);
  for (let i = first; i < last; i += 1) {
    const a = at(i - 1);
    const b = at(i + 1);
    const ux = cx[i]! + nx[i]! * offset[i]! - (cx[a]! + nx[a]! * offset[a]!);
    const uz = cz[i]! + nz[i]! * offset[i]! - (cz[a]! + nz[a]! * offset[a]!);
    const wx = cx[b]! + nx[b]! * offset[b]! - (cx[i]! + nx[i]! * offset[i]!);
    const wz = cz[b]! + nz[b]! * offset[b]! - (cz[i]! + nz[i]! * offset[i]!);
    const angle = Math.atan2(ux * wz - uz * wx, ux * wx + uz * wz);
    // Repère de la carte : un virage à gauche donne un produit vectoriel négatif.
    raw[i] = -angle / Math.max(1e-6, (Math.hypot(ux, uz) + Math.hypot(wx, wz)) / 2);
  }
  if (!loop && n > 2) {
    raw[0] = raw[1]!;
    raw[n - 1] = raw[n - 2]!;
  }
  const curvature = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    let sum = 0;
    for (let k = -P.smooth; k <= P.smooth; k += 1) sum += raw[at(i + k)]!;
    curvature[i] = sum / (2 * P.smooth + 1);
  }
  return { step, loop, offset, right, left, curvature };
}

/** Valeur d'un échantillonnage de la trajectoire à l'abscisse `s` (interpolée, rebouclée ou bornée). */
export function sampleLine(values: Float64Array, line: RacingLine, s: number): number {
  const n = values.length;
  let u = s / line.step;
  if (line.loop) {
    u = ((u % n) + n) % n;
    const i = Math.floor(u);
    const t = u - i;
    return values[i]! + (values[(i + 1) % n]! - values[i]!) * t;
  }
  u = Math.min(n - 1, Math.max(0, u));
  const i = Math.min(n - 2, Math.floor(u));
  const t = u - i;
  return values[i]! + (values[i + 1]! - values[i]!) * t;
}

/** Profil de vitesse le long du rail, échantillonné tous les `step` mètres. */
export interface SpeedProfile {
  readonly step: number;
  /** Vitesse visée par le pilote automatique, m/s. */
  readonly auto: Float64Array;
  /** Vitesse la plus forte permise à la main, m/s. */
  readonly envelope: Float64Array;
}

/** Vitesse et pente (dv/ds) du profil à l'abscisse `s`, écrites dans `out` ([v, dv/ds]). */
export function sampleProfile(values: Float64Array, step: number, rail: Rail, s: number, out: [number, number]): [number, number] {
  const n = values.length;
  let u = s / step;
  if (rail.loop) u = ((u % (n - 1)) + (n - 1)) % (n - 1);
  else u = Math.min(n - 1, Math.max(0, u));
  const i = Math.min(n - 2, Math.floor(u));
  const t = u - i;
  const a = values[i]!;
  const b = values[i + 1]!;
  out[0] = a + (b - a) * t;
  out[1] = (b - a) / step;
  return out;
}

/**
 * Calcule une fois les deux profils pour un véhicule : courbure et croisière (pilote automatique),
 * courbure et adhérence (enveloppe de la conduite à la main, vitesse de pointe du NOS comprise), puis
 * freinage anticipé à rebours.
 */
export function createSpeedProfile(rail: Rail, performance: DrivePerformance = DEFAULT_PERFORMANCE, line?: RacingLine): SpeedProfile {
  const step = PILOT.profileStep;
  const n = Math.max(2, Math.ceil(rail.length / step) + 1);
  const auto = new Float64Array(n);
  const envelope = new Float64Array(n);
  const pose = createPose();
  const manualTop = kmh(performance.topKmh * PILOT.nos.topRatio);
  const autoLateral = Math.min(PILOT.lateral, performance.grip);
  for (let i = 0; i < n; i += 1) {
    rail.poseAt(Math.min(rail.length, i * step), pose);
    // Courbure de la trajectoire suivie quand on la connaît (plus douce que celle de la route).
    const k = Math.max(Math.abs(line ? sampleLine(line.curvature, line, i * step) : pose.curvature), 1e-6);
    auto[i] = Math.min(cruiseSpeed(pose, performance.topKmh), Math.sqrt(autoLateral / k));
    envelope[i] = Math.min(manualTop, Math.sqrt(performance.grip / k));
  }
  const backward = (values: Float64Array, brake: number) => {
    if (!rail.loop) values[n - 1] = 0;
    // Boucle : deux tours à rebours, pour que le début du parcours voie la fin.
    const passes = rail.loop ? 2 : 1;
    for (let pass = 0; pass < passes; pass += 1) {
      for (let i = n - 2; i >= 0; i -= 1) {
        const next = rail.loop && i === n - 2 && pass > 0 ? values[0]! : values[i + 1]!;
        values[i] = Math.min(values[i]!, Math.sqrt(next * next + 2 * brake * step));
      }
      if (rail.loop) values[n - 1] = values[0]!;
    }
  };
  backward(auto, PILOT.plannedBrake);
  backward(envelope, PILOT.manual.brakeEnvelope);
  return { step, auto, envelope };
}

export interface PilotWithProfile extends Pilot {
  readonly profile: SpeedProfile;
  readonly line: RacingLine;
  readonly rail: Rail;
  readonly performance: DrivePerformance;
  readonly train: DriveTrain;
  setSize(halfWidth: number, halfLength: number): void;
}

function newMotion(): DriveMotion {
  return { s: 0, speed: 0, accel: 0, offset: 0, roll: 0, dive: 0, braking: false, finished: false, pull: 0, boost: 0 };
}

/** Accélération du moteur à plein gaz, avant la résistance de l'air (m/s²), et ce qui freine (m/s²). */
export interface EngineModel {
  /** À la vitesse `v` (m/s), au régime `rpm` (tr/min ; absent : puissance pleine), NOS envoyé ou non. */
  thrust(v: number, nos: boolean, rpm?: number): number;
  resist(v: number): number;
  /** Vitesse que le limiteur ne laisse pas dépasser, m/s. */
  cap(nos: boolean): number;
}

/**
 * Part de la puissance disponible à un régime : la souplesse de la boîte au ralenti, pleine au
 * régime de passage à plein gaz et au-delà.
 */
export function powerShare(rpm: number, box: DrivePerformance['gearbox']): number {
  const x = (rpm - box.ralenti) / Math.max(1, box.passagePleinGaz - box.ralenti);
  return box.souplesse + (1 - box.souplesse) * Math.min(1, Math.max(0, x));
}

export function engineModel(performance: DrivePerformance): EngineModel {
  const E = PILOT.engine;
  const box = performance.gearbox;
  const watts = performance.power * HP * E.efficiency;
  const mass = Math.max(50, performance.mass);
  const top = kmh(performance.topKmh);
  // Résistance de l'air : l'équilibre avec la puissance disponible sur le dernier rapport tombe juste
  // au-dessus de la vitesse de pointe.
  const equilibrium = top * E.dragMargin;
  const lastGear = box.kmhPar1000[box.kmhPar1000.length - 1] ?? 30;
  const topShare = powerShare((equilibrium * 3.6 * 1000) / lastGear, box);
  const drag = (watts * topShare) / (mass * equilibrium * equilibrium * equilibrium) - E.rolling / (equilibrium * equilibrium);
  const launch = E.launch[performance.kind];
  const boxTop = kmh(vitesseMaxBoite(box));
  const cap = (nos: boolean) => Math.min(boxTop, top * (nos ? PILOT.nos.topRatio : 1));
  return {
    cap,
    resist: (v) => Math.max(0, drag) * v * v + (v > 0.05 ? E.rolling : 0),
    thrust(v, nos, rpm) {
      const share = rpm === undefined ? 1 : powerShare(rpm, box);
      const power = watts * share * (nos ? 1 + (performance.nosBoost ?? PILOT.nos.boost) : 1);
      let a = Math.min(launch * (nos ? 1.08 : 1), power / (mass * Math.max(v, 0.5)));
      // Limiteur : la poussée s'éteint en approchant de la vitesse de pointe.
      const limit = cap(nos);
      const band = limit * E.limiter;
      if (v > limit - band) a *= Math.min(1, Math.max(0, (limit - v) / band));
      return a;
    },
  };
}

export function createPilot(rail: Rail, performance: DrivePerformance = DEFAULT_PERFORMANCE): PilotWithProfile {
  let line = createRacingLine(rail, performance.kind, performance.halfWidth, performance.halfLength);
  let profile = createSpeedProfile(rail, performance, line);
  const engine = engineModel(performance);
  const box = performance.gearbox;
  const kind0 = performance.kind;
  const motion = newMotion();
  const pose = createPose();
  const sample: [number, number] = [0, 0];
  const gearOut: SortieBoite = { rapport: 1, regime: box.ralenti, passage: 0, charge: 0 };
  const gearIn = { vitesseKmh: 0, charge: 0, frein: false };
  const train: DriveTrain = {
    rpm: box.ralenti,
    gear: 1,
    gears: box.kmhPar1000.length,
    shifting: false,
    load: 0,
    idle: box.ralenti,
    redline: box.rupteur,
    zones: zonesCadran(box),
    nos: false,
    nosReserve: 1,
  };
  let gearState = etatInitial(box.ralenti);
  let halfWidth: number = performance.halfWidth ?? PILOT.halfWidth[kind0];
  let halfLength: number = performance.halfLength ?? PILOT.halfLength[kind0];
  const here: [number, number] = [0, 0];
  let accel = 0;
  let offsetRate = 0;
  let rollRate = 0;
  let diveRate = 0;
  let nosLeft = 0;
  /** Dernier compteur d'appuis du NOS vu (`null` : pas encore lu ; la première lecture ne lance rien). */
  let nosSeen: number | null = null;

  function reset(s: number): void {
    const start = rail.loop ? s : Math.min(rail.length, Math.max(0, Number.isFinite(s) ? s : 0));
    rail.poseAt(start, pose);
    motion.s = pose.s;
    motion.speed = 0;
    motion.accel = 0;
    laneLimits(pose, kind0, halfWidth, halfLength, here);
    motion.offset = Math.max(here[0], Math.min(here[1], sampleLine(line.offset, line, pose.s)));
    motion.roll = 0;
    motion.dive = 0;
    motion.braking = true;
    motion.finished = !rail.loop && pose.s >= rail.length;
    motion.pull = 0;
    motion.boost = 0;
    accel = 0;
    offsetRate = 0;
    rollRate = 0;
    diveRate = 0;
    nosLeft = 0;
    gearState = etatInitial(box.ralenti);
    train.rpm = box.ralenti;
    train.gear = 1;
    train.shifting = false;
    train.load = 0;
    train.nos = false;
  }

  /** Accélération voulue par l'asservissement sur un profil : suivi plus anticipation de sa pente. */
  function track(values: Float64Array, s: number, v: number): number {
    // Le plus contraignant des deux : ici, ou là où l'on sera bientôt (jamais une sortie de virage
    // vue d'avance comme une raison d'accélérer dans le virage).
    sampleProfile(values, profile.step, rail, s, sample);
    const hereV = sample[0];
    const hereSlope = sample[1];
    sampleProfile(values, profile.step, rail, s + v * PILOT.anticipation, sample);
    if (hereV <= sample[0]) return PILOT.gain * (hereV - v) + hereSlope * v;
    return PILOT.gain * (sample[0] - v) + sample[1] * v;
  }

  /** La boîte avance d'un sous-pas : régime, rapport, passage. */
  function stepGearbox(h: number, speed: number, load: number, brake: boolean): void {
    gearIn.vitesseKmh = speed * 3.6;
    gearIn.charge = load;
    gearIn.frein = brake;
    pasBoite(gearState, gearIn, box, box.ralenti, h, gearOut);
    gearState.rapport = gearOut.rapport;
    gearState.regime = gearOut.regime;
    gearState.passage = gearOut.passage;
    train.rpm = gearOut.regime;
    train.gear = gearOut.rapport;
    train.shifting = gearOut.passage > 0;
    train.load = gearOut.charge;
  }

  /** Réserve et poussée du NOS : un nouvel appui (à la main, réserve suffisante) lance une poussée. */
  function stepNos(h: number, input: DriveInput): boolean {
    const N = PILOT.nos;
    const count = input.nos ?? 0;
    if (nosSeen === null) nosSeen = count;
    const pressed = count !== nosSeen;
    nosSeen = count;
    if (input.auto || input.brake > 0.05) nosLeft = 0;
    else if (pressed && nosLeft <= 0 && train.nosReserve >= N.minReserve) nosLeft = N.duration;
    const on = nosLeft > 0 && train.nosReserve > 0;
    if (on) {
      nosLeft = Math.max(0, nosLeft - h);
      train.nosReserve = Math.max(0, train.nosReserve - N.drain * h);
      if (train.nosReserve <= 0) nosLeft = 0;
    } else {
      nosLeft = 0;
      train.nosReserve = Math.min(1, train.nosReserve + N.recharge * h);
    }
    train.nos = on;
    motion.boost = (motion.boost ?? 0) + ((on ? 1 : 0) - (motion.boost ?? 0)) * Math.min(1, h / N.ramp);
    return on;
  }

  function substep(h: number, input: DriveInput, kind: 'car' | 'bike'): void {
    const v = motion.speed;
    rail.poseAt(motion.s, pose);
    const nos = stepNos(h, input);
    // Pendant un passage de rapport, la poussée est presque coupée.
    const cut = train.shifting ? PILOT.engine.cut : 1;
    let wanted: number;
    let jerk: number;
    let load: number;
    let braking: boolean;
    if (input.auto) {
      const thrust = engine.thrust(v, false, train.rpm);
      const resist = engine.resist(v);
      const target = Math.max(-PILOT.maxBrake, track(profile.auto, motion.s, v));
      // Reprise : une part de ce que le moteur donne (une Cox reprend en douceur, une voiture de course franchement).
      wanted = Math.min(PILOT.accel, PILOT.autoShare * (thrust * cut - resist), target);
      jerk = PILOT.jerk;
      braking = wanted <= -0.6;
      // Charge : ce qu'il faut de moteur pour tenir l'accélération voulue (un filet en croisière).
      load = braking ? 0 : Math.min(1, Math.max(0.15, (wanted + resist) / Math.max(0.1, thrust)));
    } else {
      const brake = Math.min(1, Math.max(0, input.brake));
      // Le NOS, c'est plein gaz.
      const throttle = nos ? 1 : Math.min(1, Math.max(0, input.throttle));
      wanted = throttle * engine.thrust(v, nos, train.rpm) * cut - engine.resist(v) - brake * PILOT.manual.brake;
      if (throttle === 0 && brake === 0) wanted -= PILOT.manual.coast;
      // Enveloppe de sécurité : le pilote freine à la place du joueur, jamais l'inverse.
      wanted = Math.max(-PILOT.manual.brake, Math.min(wanted, track(profile.envelope, motion.s, v)));
      jerk = PILOT.manual.jerk;
      braking = brake > 0;
      load = brake > 0 ? 0 : throttle;
    }
    const delta = wanted - accel;
    const limit = jerk * h;
    accel += Math.max(-limit, Math.min(limit, delta));
    // Jamais de recul : à l'arrêt, une décélération ne fait que tenir le véhicule.
    let speed = v + accel * h;
    if (speed <= 0) {
      speed = 0;
      if (accel < 0) accel = 0;
    }
    motion.accel = (speed - v) / h;
    motion.speed = speed;
    motion.pull = (motion.pull ?? 0) + (motion.accel - (motion.pull ?? 0)) * Math.min(1, h / PILOT.pullTau);
    stepGearbox(h, speed, load, braking);
    let s = motion.s + speed * h;
    if (rail.loop) {
      s = ((s % rail.length) + rail.length) % rail.length;
    } else if (s >= rail.length || (rail.length - s < 0.25 && speed < 0.6 && input.auto)) {
      s = rail.length;
      motion.speed = 0;
      motion.accel = 0;
      accel = 0;
      motion.finished = true;
    }
    motion.s = s;

    // Placement : la trajectoire de route dégagée, visée un peu en avant ; à la main, le bord gauche ou
    // droit demandé. Jamais au-delà des bornes d'ici.
    rail.poseAt(s, pose);
    laneLimits(pose, kind, halfWidth, halfLength, here);
    const lead = s + (rail.loop ? 1 : Math.sign(rail.length - s) || 1) * speed * PILOT.lane.lead;
    const lane = input.auto ? 0 : input.lane;
    let target = sampleLine(line.offset, line, lead);
    if (lane < 0) target = sampleLine(line.left, line, lead) - PILOT.lane.request;
    else if (lane > 0) target = sampleLine(line.right, line, lead) + PILOT.lane.request;
    target = Math.max(here[0], Math.min(here[1], target));
    const omega = PILOT.lane.omega;
    offsetRate += (omega * omega * (target - motion.offset) - 2 * omega * offsetRate) * h;
    const maxRate = Math.max(PILOT.lane.maxRate, PILOT.lane.maxRatePerSpeed * speed);
    offsetRate = Math.max(-maxRate, Math.min(maxRate, offsetRate));
    motion.offset = Math.max(here[0], Math.min(here[1], motion.offset + offsetRate * h));

    // Caisse.
    const lateral = speed * speed * sampleLine(line.curvature, line, s);
    if (kind === 'bike') {
      const lean = Math.max(-PILOT.lean.max, Math.min(PILOT.lean.max, -Math.atan(lateral / G)));
      motion.roll += (lean - motion.roll) * Math.min(1, h / PILOT.lean.tau);
      rollRate = 0;
    } else {
      const roll = Math.max(-PILOT.roll.max, Math.min(PILOT.roll.max, PILOT.roll.gain * lateral));
      const w = PILOT.roll.omega;
      rollRate += (w * w * (roll - motion.roll) - 2 * PILOT.roll.damping * w * rollRate) * h;
      motion.roll += rollRate * h;
    }
    const gain = kind === 'bike' ? PILOT.dive.gainBike : PILOT.dive.gainCar;
    const dive = Math.max(-PILOT.dive.max, Math.min(PILOT.dive.max, gain * motion.accel));
    const w = PILOT.dive.omega;
    diveRate += (w * w * (dive - motion.dive) - 2 * PILOT.dive.damping * w * diveRate) * h;
    motion.dive += diveRate * h;
  }

  function step(dt: number, input: DriveInput, kind: 'car' | 'bike'): DriveMotion {
    const span = Math.min(0.1, Math.max(0, Number.isFinite(dt) ? dt : 0));
    if (span > 0 && !motion.finished) {
      const count = Math.max(1, Math.ceil(span / PILOT.substep - 1e-9));
      const h = span / count;
      for (let i = 0; i < count && !motion.finished; i += 1) substep(h, input, kind);
    } else if (span > 0) {
      // Arrivé : la caisse se pose, le véhicule ne bouge plus, le moteur retombe au ralenti.
      motion.roll *= Math.max(0, 1 - span * 4);
      motion.dive *= Math.max(0, 1 - span * 4);
      motion.pull = (motion.pull ?? 0) * Math.max(0, 1 - span * 4);
      stepNos(span, input);
      stepGearbox(span, 0, 0, true);
    }
    motion.braking = motion.finished || motion.speed < 0.05 || motion.accel < -0.6 || (!input.auto && input.brake > 0.05);
    return motion;
  }

  /** Mesures du modèle posé : la trajectoire et les profils sont recalculés s'ils changent. */
  function setSize(width: number, length: number): void {
    const w = Number.isFinite(width) && width > 0.1 && width < 3 ? width : halfWidth;
    const l = Number.isFinite(length) && length > 0.3 && length < 8 ? length : halfLength;
    if (Math.abs(w - halfWidth) < 0.03 && Math.abs(l - halfLength) < 0.05) return;
    halfWidth = w;
    halfLength = l;
    line = createRacingLine(rail, kind0, halfWidth, halfLength);
    profile = createSpeedProfile(rail, performance, line);
  }

  reset(0);
  return {
    motion,
    get profile() {
      return profile;
    },
    get line() {
      return line;
    },
    rail,
    performance,
    train,
    reset,
    step,
    setSize,
  };
}
