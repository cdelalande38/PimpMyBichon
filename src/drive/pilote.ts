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
// poussée est presque coupée (PILOT.engine.cut) : ça se sent. Aucun frein posé par l'app (demande du
// 16 novembre 2026 : « Le fait de cogner ralentira mais pas de freins auto ») : le gaz et le frein
// sont ceux du joueur ; trop vite dans une courbe, le véhicule élargit, frotte le bord, et c'est ce
// frottement qui le ralentit. Aucune collision : il n'y a rien d'autre sur la route.
//
// Direction à la main (`DriveInput.assist` absent ou faux, par défaut) : le joueur tient le braquage.
// Modèle dans le repère de la route : abscisse s, écart latéral e, cap relatif ψ à la tangente. Le
// volant (le manche, lissé) donne une courbure (`courbureVolant` : sensibilité qui baisse avec la
// vitesse, bornée par le braquage du véhicule) ; l'adhérence (`performance.grip`) borne la courbure
// obtenue (`courbureTenue` : au-delà, sous-virage, `DriveMotion.slip` monte) ; ψ suit la différence
// entre cette courbure et celle de la route, e suit ψ (`avanceLibre`). Sans braquer dans un virage,
// le véhicule va tout droit vers le bord extérieur ; manche lâché, il garde son cap. Au bord
// (`bordLibre`, laneLimits moins ce que le cap fait déborder les coins), il frotte : son cap revient le
// long du bord, il perd de la vitesse (franchement de face, peu en effleurant), jamais d'arrêt net ni
// de recul. Direction assistée (`assist` vrai) : la même physique, braquée par une aide qui vise la
// place d'avant (trajectoire, manche ou bords demandés, `courbureAssistee`) ; le pilote automatique,
// lui, ne change pas.
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
// 4 m), resserrée un peu avant et après les rétrécissements. En pilote automatique, le véhicule la
// suit avec un ressort amorti et ne quitte jamais la chaussée. En direction assistée, l'aide braque
// vers la place visée : le placement demandé va jusqu'au bord gauche ou droit de la chaussée ; sans
// demande, la même trajectoire que le pilote ; au manche (`steer`), le placement est progressif : la
// place visée glisse à une allure proportionnelle (toute la largeur en une seconde, moins vite à basse
// vitesse, rien à l'arrêt), tient au lâcher, puis revient doucement sur la trajectoire (`pasPlacement`).
//
// Caisse : `roll` est la rotation autour de l'axe avant (+X) du véhicule, au sens direct de three.js :
// positif, le toit part vers la droite (+Z du véhicule). Une voiture roule vers l'extérieur du virage
// (ressort amorti), d'autant plus qu'elle est souple (peu d'adhérence) : de l'ordre de 2,5 à 4° en
// pilote automatique, 5 à 5,5° à la limite (`carRollOf`) ; une moto s'incline vers l'intérieur (angle
// d'équilibre atan(v²κ/g), un peu appuyé, jusqu'à 45° et plus à la limite), un peu avant la corde
// (courbure à venir) en pilote automatique, selon la courbure réellement prise à la main. `dive` est la rotation autour de l'axe latéral, positive nez en l'air (cabrage),
// négative au freinage (plongée). Virage : la courbure de la trajectoire réellement suivie (celle de la
// route, plus le changement de place) donne le braquage des roues avant (`steer`, angle d'Ackermann sur
// l'empattement du genre de véhicule) ; le changement de place fait pivoter le véhicule (`yaw`) au lieu
// de le faire glisser en crabe. Tout s'efface à l'arrêt.
//
// Adhérence (src/data/adherence.ts, demande du 17 novembre 2026) : la météo (`setWeather`) abaisse ce
// que tiennent les pneus. À la main : on glisse plus tôt sous la pluie, nettement plus sur la neige, les
// freinages s'allongent ; la poussée au-delà de la motricité fait patiner les roues motrices
// (`DriveMotion.spin`) ; chaque essieu tient en courbe ce que la poussée, le frein et le report de
// charge lui laissent (ellipse d'adhérence) : quand l'arrière tient moins que l'avant ne tire, la caisse
// pivote (`DriveMotion.drift`, comprise dans `yaw`), rattrapable en contre-braquant, jusqu'au
// tête-à-queue si l'on insiste ; une traction sous-vire sous la poussée ; une moto glisse un peu de
// l'arrière, sans tête-à-queue. Jamais de frein posé par l'app : la caisse en travers frotte et perd de
// la vitesse, comme au bord. Le pilote automatique règle sa vitesse sur la météo et ne glisse jamais.
//
// Préparation (src/data/preparation.ts, demande du 18 novembre 2026) : les pneus, leur largeur et
// l'assiette du build changent l'adhérence et la motricité selon la météo (`PreparationRoute`, portée par
// `PerformanceRoute.preparation`), et le roulis d'une voiture. Le véhicule d'origine n'y change rien. Le
// pilote automatique lève le pied sur de mauvais pneus, jamais plus vite sur de bons.
//
// Tout est déterministe : l'intégration se fait en sous-pas d'au plus 1/120 s, quel que soit `dt`.
// `step` n'alloue rien.

import { adherenceMeteo, FREINAGE, MOTRICITE, PREPARATION_ORIGINE, PRUDENCE_AUTO, SURVIRAGE, TRANSMISSION_PAR_DEFAUT, type PreparationRoute, type Transmission } from '../data/adherence.ts';
import { boiteDuVehicule, vitesseMaxBoite } from '../data/boites.ts';
import { computePrep } from '../data/enginePrep.ts';
import { preparationDe } from '../data/preparation.ts';
import type { Build, VehicleManifest } from '../data/vehicleTypes.ts';
import { etatInitial, pasBoite, zonesCadran, type SortieBoite } from './boite.ts';
import type { DriveInput, DriveMotion, DrivePerformance, DriveTrain, Pilot, Rail, RailPose, Weather } from './contrat.ts';
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
  manual: { brake: 7, coast: 0.45, topKmh: 120, lateral: 4.5, jerk: 14 },
  /**
   * Direction à la main. Manche à fond : `fullGrip` fois l'adhérence en accélération latérale (au plus
   * le braquage le plus fort du véhicule ; sous `slowSpeed` m/s, la sensibilité ne monte plus), courbe
   * `expo` ; le volant suit le manche en `tauIn` s et revient au neutre en `tauOut` s ; cap relatif le
   * plus fort (rad). Bord : retour du cap le long du bord (s), part de la vitesse perdue de face,
   * frottement (m/s²) au-delà d'un angle d'appui (rad). Glissement : dépassement de l'adhérence qui
   * donne un glissement franc (part), lissage (s) ; au bord : glissement de base, gain par radian
   * d'appui, vitesse où il est plein (m/s). Direction assistée : temps de retour sur la place visée et
   * de mise en cap (s), cap visé le plus fort (rad), cap rendu au pilote automatique : lissage (s).
   */
  free: {
    fullGrip: 1.3,
    slowSpeed: 4,
    expo: 1.5,
    tauIn: 0.08,
    tauOut: 0.22,
    yawMax: 0.6,
    edge: { tau: 0.15, face: 0.7, rub: 1, touch: 0.01 },
    slip: { over: 0.6, tau: 0.08, edge: 0.35, edgeGain: 4, edgeSpeed: 8 },
    assist: { lateralTime: 0.6, headingTime: 0.15, yawMax: 0.35 },
    handover: 0.5,
  },
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
   * et débord le plus fort compté (m). Au manche (`DriveInput.steer`) : temps pour balayer toute la
   * largeur utile manche à fond (s), vitesse sous laquelle tout ralentit en proportion (m/s ; à
   * l'arrêt, rien ne bouge), tenue au lâcher (s), constante de temps du retour sur la trajectoire (s).
   */
  lane: {
    omega: 3,
    maxRate: 2.5,
    maxRatePerSpeed: 0.15,
    lead: 0.3,
    request: 0.15,
    clearanceCar: 0.4,
    clearanceBike: 0.45,
    chordInset: 2,
    curveMax: 1,
    steerFull: 1,
    steerSpeed: 6,
    steerHold: 1.2,
    steerReturn: 3,
  },
  /**
   * Trajectoire de route dégagée : pas (m), bornes resserrées sur ± `erode` pas (rétrécissements
   * adoucis par la fabrication), itérations et facteur de relaxation de la ficelle tendue, rappel
   * vers le milieu (au milieu sur les longues lignes droites), lissage de sa courbure (± pas).
   */
  line: { step: 4, erode: 3, iterations: 700, relax: 1.7, center: 0.003, smooth: 2 },
  /** Demi-largeur et demi-longueur d'un véhicule avant que son modèle soit posé, m. */
  halfWidth: { car: 0.95, bike: 0.45 },
  halfLength: { car: 2.2, bike: 1.05 },
  /**
   * Roulis de caisse d'une voiture (`carRollOf`) : à la limite d'adhérence, roulis d'une voiture raide
   * et d'une voiture souple (rad), adhérences (m/s²) qui les bornent, exposant de la montée (moins de 1 :
   * lisible dès les courbes du pilote automatique), plafond ; ressort.
   */
  roll: { atLimitStiff: 0.087, atLimitSoft: 0.096, gripStiff: 10, gripSoft: 5, exponent: 0.65, max: 0.1, omega: 9, damping: 0.55 },
  /**
   * Inclinaison d'une moto : plafond (rad), temps de réponse (s), appui ajouté à l'angle d'équilibre
   * (facteur de l'accélération latérale), anticipation sur la courbure à venir (s).
   */
  lean: { max: 0.87, tau: 0.22, gain: 1.2, anticipation: 0.4 },
  /**
   * Virage : empattement par genre (m), braquage physique le plus fort (rad), lissages de la vitesse
   * latérale, de la courbure suivie et du braquage (s), cap ajouté par un changement de place le plus
   * fort (rad), vitesse sous laquelle cap et braquage s'effacent (m/s).
   */
  steer: { wheelbase: { car: 2.6, bike: 1.45 }, max: 0.6, lateralTau: 0.12, curveTau: 0.08, tau: 0.12, yawMax: 0.105, fade: 2 },
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

/** Performances et préparation pour la route (pneus, largeur, assiette : src/data/preparation.ts). */
export interface PerformanceRoute extends DrivePerformance {
  /** Absente : le véhicule d'origine. */
  preparation?: PreparationRoute;
}

/**
 * Performances d'un véhicule pour la route, tirées de son manifeste : puissance (`engine.power`,
 * préparation du build comprise : reprogrammation, carburation, et les pièces optimisées sur l'établi,
 * src/data/optimisation.ts, que computePrep cumule), masse, vitesse de pointe,
 * adhérence, boîte ; un kit nitro monté grossit la poussée du NOS. Ce qui manque prend la valeur
 * d'un véhicule moyen de son genre. La vitesse de pointe est bornée par la boîte. Les pneus, leur
 * largeur et l'assiette du build (`preparation`) jouent selon la météo.
 */
export function performanceDe(
  vehicle: Pick<VehicleManifest, 'kind' | 'engine' | 'performance'> & Partial<Pick<VehicleManifest, 'wheels'>>,
  build?: Partial<Build>,
): PerformanceRoute {
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
    // Une moto pousse toujours par l'arrière.
    transmission: kind === 'bike' ? 'propulsion' : (spec?.transmission ?? TRANSMISSION_PAR_DEFAUT[kind]),
    preparation: preparationDe({ kind, wheels: vehicle.wheels }, build),
  };
}

/** Préparation d'un véhicule pour la route (absente : celle d'origine, rien ne change). */
function preparationRoute(performance: Pick<PerformanceRoute, 'preparation'>): PreparationRoute {
  return performance.preparation ?? PREPARATION_ORIGINE;
}

/** Roues motrices d'un véhicule (celles du manifeste, sinon celles de son genre). */
export function transmissionDe(performance: Pick<DrivePerformance, 'kind' | 'transmission'>): Transmission {
  return performance.kind === 'bike' ? 'propulsion' : (performance.transmission ?? TRANSMISSION_PAR_DEFAUT[performance.kind]);
}

/**
 * Motricité (m/s²) : accélération la plus forte que les roues motrices transmettent, sous une météo, en
 * ligne droite (pneus, largeur et assiette du build comprises).
 */
export function motriciteDe(performance: Pick<PerformanceRoute, 'kind' | 'transmission' | 'preparation'>, weather?: Weather): number {
  const meteo = weather === 'pluie' || weather === 'neige' ? weather : 'sec';
  return MOTRICITE.reference[performance.kind] * MOTRICITE.transmission[transmissionDe(performance)] * adherenceMeteo(weather).adherence * preparationRoute(performance).motricite[meteo];
}

/** Part de l'adhérence du sec que gardent les pneus du véhicule sous une météo (préparation comprise). */
export function adherenceDe(performance: Pick<PerformanceRoute, 'preparation'>, weather?: Weather): number {
  const meteo = weather === 'pluie' || weather === 'neige' ? weather : 'sec';
  return adherenceMeteo(weather).adherence * preparationRoute(performance).tenue[meteo];
}

/**
 * Poussée (m/s²) que le couple du moteur peut donner en première, à plein gaz : c'est elle qui fait
 * patiner les roues quand elle dépasse la motricité (`MOTRICITE.couple`).
 */
export function pousseeDepart(performance: Pick<DrivePerformance, 'power' | 'mass' | 'gearbox'>): number {
  const box = performance.gearbox;
  const firstGear = kmh((box.kmhPar1000[0] ?? 10) * (box.passagePleinGaz / 1000));
  return (performance.power * HP * PILOT.engine.efficiency * MOTRICITE.couple) / (Math.max(50, performance.mass) * Math.max(3, firstGear));
}

/** Décélération du frein plein à la main (m/s²), sous une météo. */
export function freinDe(weather?: Weather): number {
  return PILOT.manual.brake * adherenceMeteo(weather).adherence;
}

/**
 * Patinage visé (de 0 à 1) : la poussée du moteur (m/s²) au-delà de la motricité `tenue` (m/s²), plein à
 * `MOTRICITE.plein` de dépassement.
 */
export function patinageDe(poussee: number, tenue: number): number {
  if (!(poussee > 0) || !Number.isFinite(tenue)) return 0;
  const t = Math.max(0.1, tenue);
  return Math.min(1, Math.max(0, (poussee - t) / (MOTRICITE.plein * t)));
}

/** Excès de la poussée du moteur (m/s²) sur la motricité `tenue` (m/s²), en part de celle-ci (0 : rien ne patine). */
export function excesDe(poussee: number, tenue: number): number {
  if (!(poussee > 0) || !Number.isFinite(tenue)) return 0;
  return Math.max(0, poussee / Math.max(0.1, tenue) - 1);
}

/**
 * Accélération latérale qu'un essieu tient (m/s²) : l'adhérence `mu`, multipliée par sa charge (1 sans
 * report) et réduite par la part `long` (de 0 à 1 et au-delà) prise en long par la poussée ou le frein.
 */
export function tenueEssieu(mu: number, charge: number, long: number): number {
  const u = Math.min(1, Math.max(0, Number.isFinite(long) ? long : 0));
  return Math.max(0, mu * charge * Math.sqrt(1 - u * u));
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

/** Placement au manche : la place visée, son poids face à la trajectoire, la tenue qui reste. */
export interface PlacementManche {
  /** Écart visé à l'axe, m, positif vers la gauche de la marche. */
  target: number;
  /** 1 : la place du manche ; 0 : la trajectoire ; entre les deux, le retour en cours. */
  weight: number;
  /** Tenue au lâcher qui reste, s. */
  hold: number;
}

export function createPlacementManche(): PlacementManche {
  return { target: 0, weight: 0, hold: 0 };
}

/**
 * Un sous-pas du placement au manche, fonction pure de l'état donné (modifié sur place) : manche
 * poussé (`steer`, −1 à gauche, 1 à droite), la place visée glisse à une allure proportionnelle ;
 * lâché, elle tient `steerHold` s, puis revient sur la trajectoire (`line`) avec la constante de temps
 * `steerReturn`. Tout ralentit sous `steerSpeed` m/s : à l'arrêt, rien ne bouge. Bornée par [lo, hi]
 * (laneLimits : droite négative, gauche positive). Rend l'écart visé, continu d'un pas à l'autre.
 */
export function pasPlacement(state: PlacementManche, steer: number, line: number, lo: number, hi: number, speed: number, h: number): number {
  const L = PILOT.lane;
  const moving = Math.min(1, Math.max(0, speed) / L.steerSpeed);
  const push = Number.isFinite(steer) ? Math.max(-1, Math.min(1, steer)) : 0;
  if (Math.abs(push) > 1e-3) {
    // On reprend d'où l'on en est : la place mêlée à la trajectoire, sans saut.
    if (state.weight < 1) {
      state.target = state.weight * state.target + (1 - state.weight) * line;
      state.weight = 1;
    }
    const rate = (Math.max(0, hi - lo) / L.steerFull) * moving;
    state.target -= push * rate * h;
    state.hold = L.steerHold;
  } else if (state.weight > 0) {
    if (state.hold > 0) state.hold = Math.max(0, state.hold - h * moving);
    else {
      state.weight *= Math.exp((-h * moving) / L.steerReturn);
      if (state.weight < 1e-3) state.weight = 0;
    }
  }
  state.target = Math.max(lo, Math.min(hi, state.target));
  return state.weight * state.target + (1 - state.weight) * line;
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

/** Profil de vitesse du pilote automatique le long du rail, échantillonné tous les `step` mètres. */
export interface SpeedProfile {
  readonly step: number;
  /** Vitesse visée par le pilote automatique, m/s. */
  readonly auto: Float64Array;
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
 * Calcule une fois le profil du pilote automatique pour un véhicule : courbure et croisière, puis
 * freinage anticipé à rebours. À la main, aucun profil : le joueur freine lui-même.
 */
export function createSpeedProfile(rail: Rail, performance: PerformanceRoute = DEFAULT_PERFORMANCE, line?: RacingLine, weather?: Weather): SpeedProfile {
  const step = PILOT.profileStep;
  const n = Math.max(2, Math.ceil(rail.length / step) + 1);
  const auto = new Float64Array(n);
  const pose = createPose();
  const meteo = adherenceMeteo(weather);
  // Pneus moins bons que ceux d'origine sous cette météo : il lève le pied d'autant ; meilleurs : rien de plus.
  const prudence = Math.min(1, adherenceDe(performance, weather) / meteo.adherence);
  // Au sec, le plafond d'avant (PILOT.lateral) ; sous la pluie et sur la neige, une part de celui-ci.
  const autoLateral = Math.min(PILOT.lateral, performance.grip) * meteo.lateraleAuto * prudence;
  for (let i = 0; i < n; i += 1) {
    rail.poseAt(Math.min(rail.length, i * step), pose);
    // Courbure de la trajectoire suivie quand on la connaît (plus douce que celle de la route).
    const k = Math.max(Math.abs(line ? sampleLine(line.curvature, line, i * step) : pose.curvature), 1e-6);
    auto[i] = Math.min(cruiseSpeed(pose, performance.topKmh) * meteo.croisiere, Math.sqrt(autoLateral / k));
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
  backward(auto, Math.min(PILOT.plannedBrake, freinDe(weather) * prudence * PRUDENCE_AUTO.freinPrevu));
  return { step, auto };
}

export interface PilotWithProfile extends Pilot {
  readonly profile: SpeedProfile;
  readonly line: RacingLine;
  readonly rail: Rail;
  readonly performance: PerformanceRoute;
  readonly train: DriveTrain;
  /** À la main : bord touché (−1 à droite, 1 à gauche, 0 libre) pendant le dernier pas. */
  readonly contact: number;
  /** Accélération latérale réellement prise (m/s², positive vers la gauche), au dernier sous-pas. */
  readonly lateral: number;
  setSize(halfWidth: number, halfLength: number): void;
  setHold(held: boolean): void;
  setWeather(weather: Weather): void;
  /** Météo prise en compte. */
  readonly weather: Weather;
  /** Part de l'adhérence du sec que gardent les pneus sous cette météo (préparation comprise). */
  readonly adherence: number;
}

function newMotion(): DriveMotion {
  return { s: 0, speed: 0, accel: 0, offset: 0, roll: 0, dive: 0, braking: false, finished: false, pull: 0, boost: 0, steer: 0, yaw: 0, slip: 0, drift: 0, spin: 0 };
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

// ---------------------------------------------------------------------------------------------
// Virage (demande du 16 novembre 2026 : « voir la voiture qui tourne, roues plus direction ; moto ça
// penche ») : fonctions pures, sans allocation, appelées à chaque sous-pas par le bloc « Caisse ».

const clampTo = (value: number, max: number) => Math.max(-max, Math.min(max, value));

/**
 * Cap ajouté par un changement de place (rad, positif vers la gauche, comme `RailPose.heading`) :
 * atan(vitesse latérale / vitesse), borné à `PILOT.steer.yawMax`, effacé à l'arrêt.
 */
export function yawOf(lateralRate: number, speed: number): number {
  const S = PILOT.steer;
  const v = Number.isFinite(speed) ? Math.max(0, speed) : 0;
  if (v <= 0 || !Number.isFinite(lateralRate)) return 0;
  return clampTo(Math.atan2(lateralRate, Math.max(v, S.fade)), S.yawMax) * Math.min(1, v / S.fade);
}

/**
 * Braquage des roues avant (rad, positif à gauche) qui fait suivre une courbure (1/m, positive à
 * gauche) : angle d'Ackermann atan(empattement × courbure), borné, effacé à l'arrêt.
 */
export function steerOf(curvature: number, speed: number, kind: 'car' | 'bike'): number {
  const S = PILOT.steer;
  if (!Number.isFinite(curvature) || !Number.isFinite(speed)) return 0;
  return clampTo(Math.atan(S.wheelbase[kind] * curvature), S.max) * Math.min(1, Math.max(0, speed) / S.fade);
}

/** Roulis d'une voiture à la limite d'adhérence (rad) : plus fort pour une voiture souple (peu d'adhérence). */
export function rollLimitOf(grip: number): number {
  const R = PILOT.roll;
  const soft = Math.min(1, Math.max(0, (R.gripStiff - grip) / (R.gripStiff - R.gripSoft)));
  return R.atLimitStiff + (R.atLimitSoft - R.atLimitStiff) * soft;
}

/**
 * Roulis visé d'une voiture (rad, positif toit à droite) pour une accélération latérale (m/s², positive
 * vers la gauche) : vers l'extérieur, `rollLimitOf(grip)` à la limite, une montée progressive avant.
 */
export function carRollOf(lateral: number, grip: number): number {
  const R = PILOT.roll;
  if (!Number.isFinite(lateral)) return 0;
  const g = Math.max(1, Number.isFinite(grip) ? grip : PILOT.manual.lateral);
  const x = Math.min(1, Math.abs(lateral) / g);
  return clampTo(Math.sign(lateral) * rollLimitOf(g) * Math.pow(x, R.exponent), R.max);
}

/** Inclinaison visée d'une moto (rad, négative vers la gauche) : angle d'équilibre, un peu appuyé, borné. */
export function bikeLeanOf(lateral: number): number {
  const L = PILOT.lean;
  if (!Number.isFinite(lateral)) return 0;
  return clampTo(-Math.atan((L.gain * lateral) / G), L.max);
}

// ---------------------------------------------------------------------------------------------
// Direction à la main (demande du 16 novembre 2026 : « on dirait qu'un auto pilot nous pilote encore
// un peu sur la direction ») : fonctions pures, sans allocation, appelées à chaque sous-pas.

/** Courbure la plus forte que le braquage du véhicule permet, 1/m. */
export function courbureBraquage(kind: 'car' | 'bike'): number {
  return Math.tan(PILOT.steer.max) / PILOT.steer.wheelbase[kind];
}

/**
 * Courbure demandée par le volant (1/m, positive à gauche) : `volant` de −1 (à fond à gauche) à 1 (à
 * fond à droite), comme le manche. À fond, `fullGrip` fois l'adhérence en accélération latérale : la
 * sensibilité baisse avec la vitesse (on ne zigzague pas à 200 km/h) ; au pas, le braquage du véhicule.
 */
export function courbureVolant(volant: number, speed: number, grip: number, kind: 'car' | 'bike'): number {
  const F = PILOT.free;
  if (!Number.isFinite(volant) || volant === 0) return 0;
  const u = clampTo(volant, 1);
  const v = Math.max(F.slowSpeed, Number.isFinite(speed) ? speed : 0);
  const g = Math.max(1, Number.isFinite(grip) ? grip : PILOT.manual.lateral);
  const full = Math.min(courbureBraquage(kind), (F.fullGrip * g) / (v * v));
  return -Math.sign(u) * Math.pow(Math.abs(u), F.expo) * full;
}

/** Courbure obtenue : celle demandée, bornée par l'adhérence (au-delà, le véhicule élargit). */
export function courbureTenue(demandee: number, speed: number, grip: number): number {
  if (!Number.isFinite(demandee)) return 0;
  const v2 = Number.isFinite(speed) ? speed * speed : 0;
  if (v2 < 1e-6) return demandee;
  return clampTo(demandee, Math.max(1, Number.isFinite(grip) ? grip : PILOT.manual.lateral) / v2);
}

/** Glissement des pneus en sous-virage, de 0 (ils tiennent) à 1 (ils glissent franchement). */
export function glissementSousVirage(demandee: number, speed: number, grip: number): number {
  if (!Number.isFinite(demandee) || !Number.isFinite(speed)) return 0;
  const ratio = (Math.abs(demandee) * speed * speed) / Math.max(1, Number.isFinite(grip) ? grip : PILOT.manual.lateral);
  return Math.min(1, Math.max(0, (ratio - 1) / PILOT.free.slip.over));
}

/** Ce que le cap relatif fait déborder les coins du véhicule sur le côté (m). */
export function debordCap(psi: number, halfWidth: number, halfLength: number): number {
  if (!Number.isFinite(psi)) return 0;
  return Math.max(0, halfLength * Math.abs(Math.sin(psi)) + halfWidth * (Math.cos(psi) - 1));
}

/** Mouvement libre dans le repère de la route, tenu par le pilote à la main. */
export interface EtatLibre {
  /** Écart à l'axe (m, positif à gauche) et cap relatif à la tangente (rad, positif à gauche). */
  offset: number;
  psi: number;
  /** Courbure obtenue au dernier pas (1/m, positive à gauche). */
  curvature: number;
  /** Bord touché : −1 à droite, 1 à gauche, 0 libre ; angle d'appui vers le bord (rad). */
  contact: number;
  push: number;
}

export function createEtatLibre(): EtatLibre {
  return { offset: 0, psi: 0, curvature: 0, contact: 0, push: 0 };
}

/**
 * Un sous-pas du mouvement libre : la courbure demandée, bornée par l'adhérence, fait tourner le
 * véhicule ; son cap relatif suit la différence avec la courbure de la route ici (`kRoad`), son écart
 * suit son cap. Rend le chemin fait le long de l'axe (m, jamais négatif : le cap reste borné).
 */
export function avanceLibre(state: EtatLibre, demandee: number, kRoad: number, speed: number, grip: number, h: number): number {
  const F = PILOT.free;
  const v = Number.isFinite(speed) ? Math.max(0, speed) : 0;
  const kr = Number.isFinite(kRoad) ? kRoad : 0;
  const k = courbureTenue(demandee, v, grip);
  const ds = ((v * Math.cos(state.psi)) / Math.max(0.2, 1 - kr * state.offset)) * h;
  state.offset += v * Math.sin(state.psi) * h;
  state.psi = clampTo(state.psi + v * k * h - kr * ds, F.yawMax);
  state.curvature = k;
  return ds;
}

/**
 * Le bord : l'écart reste dans [lo, hi] (laneLimits, droite négative), moins ce que le cap de la caisse
 * (`body`, par défaut celui de la marche) fait déborder les coins. Au contact, le cap vers le bord revient le long du bord en `edge.tau` s et le
 * véhicule perd de la vitesse : d'autant plus qu'il arrive de face. Rend la décélération (m/s²).
 */
export function bordLibre(state: EtatLibre, lo: number, hi: number, halfWidth: number, halfLength: number, speed: number, h: number, body: number = state.psi): number {
  const E = PILOT.free.edge;
  // Les coins débordent selon le cap de la caisse (`body` : la marche plus la dérive, en survirage).
  const extra = debordCap(body, halfWidth, halfLength);
  let a = lo + extra;
  let b = hi - extra;
  if (a > b) a = b = (lo + hi) / 2;
  let side = 0;
  if (state.offset > b) {
    state.offset = b;
    side = 1;
  } else if (state.offset < a) {
    state.offset = a;
    side = -1;
  }
  state.contact = side;
  if (side === 0) {
    state.push = 0;
    return 0;
  }
  const push = Math.max(0, side * state.psi);
  state.push = push;
  const v = Number.isFinite(speed) ? Math.max(0, speed) : 0;
  state.psi -= side * push * (1 - Math.exp(-h / E.tau));
  return (E.face * v * Math.sin(push)) / E.tau + (push > E.touch && v > 0 ? E.rub : 0);
}

/**
 * Direction assistée : la courbure qui ramène le véhicule sur la place visée (`err`, m, positif à
 * gauche) en `lateralTime` s, cap mis en `headingTime` s, bornée par le braquage du véhicule.
 */
export function courbureAssistee(err: number, psi: number, kRoad: number, offset: number, speed: number, kind: 'car' | 'bike'): number {
  const A = PILOT.free.assist;
  const v = Math.max(1, Number.isFinite(speed) ? speed : 0);
  const wanted = clampTo(Math.atan2((Number.isFinite(err) ? err : 0) / A.lateralTime, v), A.yawMax);
  const keep = (kRoad * Math.cos(psi)) / Math.max(0.2, 1 - kRoad * offset);
  return clampTo(keep + (wanted - psi) / (A.headingTime * v), courbureBraquage(kind));
}

export function createPilot(rail: Rail, performance: PerformanceRoute = DEFAULT_PERFORMANCE): PilotWithProfile {
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
  /** Placement au manche (`DriveInput.steer`). */
  const manche = createPlacementManche();
  let rollRate = 0;
  let diveRate = 0;
  // Caisse (virage) : écart du sous-pas précédent, vitesse latérale et courbure suivie lissées.
  let lastOffset = 0;
  let lateralRate = 0;
  let pathCurvature = 0;
  // À la main : mouvement libre, volant (le manche lissé), mode du sous-pas précédent (passage de
  // relais sans à-coup), cap rendu au pilote automatique qui s'efface, accélération latérale prise.
  const free = createEtatLibre();
  let volant = 0;
  let mode: 'auto' | 'main' | null = null;
  let yawCarry = 0;
  let lateralNow = 0;
  /** Bord touché pendant le dernier pas (un sous-pas suffit). */
  let touched = 0;
  let nosLeft = 0;
  /** Dernier compteur d'appuis du NOS vu (`null` : pas encore lu ; la première lecture ne lance rien). */
  let nosSeen: number | null = null;
  /** Tenu sur la ligne de départ (feux pas encore au vert, src/drive/depart.ts) : il n'avance pas. */
  let held = false;
  // Adhérence (src/data/adherence.ts) : météo, adhérence qu'elle laisse, motricité ; à la main, dérive de
  // la caisse et sa vitesse (rad, rad/s), patinage, accélération longitudinale lissée (report de charge).
  let weather: Weather = 'sec';
  let wetGrip = adherenceDe(performance, weather);
  let traction = motriciteDe(performance, weather);
  // Roulis de caisse d'une voiture : l'assiette le change (posée au sol, plus à plat).
  const rollShare = preparationRoute(performance).roulis;
  const transmission = transmissionDe(performance);
  const driveFront = transmission !== 'propulsion';
  // Poussée que le couple du moteur peut donner en première, pour juger le patinage (m/s²).
  const torquePush = pousseeDepart(performance);
  const driveRear = transmission !== 'traction';
  let drift = 0;
  let driftRate = 0;
  let spin = 0;
  let exces = 0;
  let axLisse = 0;

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
    motion.steer = 0;
    motion.yaw = 0;
    motion.slip = 0;
    motion.drift = 0;
    motion.spin = 0;
    drift = 0;
    driftRate = 0;
    spin = 0;
    exces = 0;
    axLisse = 0;
    free.offset = motion.offset;
    free.psi = 0;
    free.curvature = 0;
    free.contact = 0;
    free.push = 0;
    volant = 0;
    mode = null;
    yawCarry = 0;
    lateralNow = 0;
    touched = 0;
    lastOffset = motion.offset;
    lateralRate = 0;
    pathCurvature = 0;
    motion.braking = true;
    motion.finished = !rail.loop && pose.s >= rail.length;
    motion.pull = 0;
    motion.boost = 0;
    accel = 0;
    offsetRate = 0;
    manche.weight = 0;
    manche.hold = 0;
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

  /** Ce que l'avant tient au dernier sous-pas (m/s², pour le glissement en sous-virage) ; glisse de l'arrière (0 à 1). */
  let capFront = performance.grip;
  let rearSlide = 0;

  /**
   * À la main : chaque essieu tient en courbe ce que lui laissent la poussée, le frein et le report de
   * charge ; l'avant tire la courbure demandée (au plus ce qu'il tient : au-delà, sous-virage), l'arrière
   * suit tant qu'il tient, plus ce que la dérive lui demande pour se refermer. Quand il ne tient plus,
   * la caisse pivote (`drift`) ; au-delà de `teteAQueue`, toupie. Rend la courbure de la marche (1/m) :
   * la moyenne de ce que tirent les deux essieux. Sans allocation.
   */
  function courbeTenue(kCmd: number, speed: number, kind: 'car' | 'bike', driveUse: number, brakeUse: number, h: number): number {
    const S = SURVIRAGE;
    const mu = Math.max(0.5, performance.grip * wetGrip);
    const report = Math.max(-S.reportMax, Math.min(S.reportMax, (S.report * axLisse) / G));
    const longF = brakeUse * FREINAGE.avant + (driveFront ? driveUse : 0);
    const longR = brakeUse * FREINAGE.arriere + (driveRear ? driveUse : 0);
    // L'avant garde toujours un peu de direction (une traction qui patine sous-vire, elle ne file pas droit).
    const capF = Math.max(0.15 * mu, tenueEssieu(mu, 1 - report, longF));
    const capR = tenueEssieu(mu, (1 + (report > 0 ? report * S.gainArriere : report)) * S.equilibre, longR);
    capFront = capF;
    const v2 = speed * speed;
    const need = v2 * kCmd;
    const aF = Math.max(-capF, Math.min(capF, need));
    const bike = kind === 'bike';
    const stiff = (bike ? S.moto.raideur : S.raideur) * mu;
    if (!bike && Math.abs(drift) > S.teteAQueue) {
      // Toupie : plus rien ne tient, la caisse tourne sur elle-même en glissant.
      driftRate *= Math.exp(-h * S.amortiGlisse * 0.5);
      rearSlide = 1;
      drift += driftRate * h;
      if (drift > Math.PI) drift -= 2 * Math.PI;
      else if (drift < -Math.PI) drift += 2 * Math.PI;
      return 0;
    }
    const aRwant = aF + stiff * drift;
    const aR = Math.max(-capR, Math.min(capR, aRwant));
    const sliding = Math.abs(aRwant) > capR + 1e-6;
    rearSlide = sliding ? Math.min(1, (Math.abs(aRwant) - capR) / (0.3 * mu) + Math.abs(drift) / S.glisse) : Math.min(1, Math.abs(drift) / S.glisse);
    const damping = sliding ? S.amortiGlisse : 2 * S.amortissement * Math.sqrt(S.pivot * stiff);
    driftRate += (S.pivot * (aF - aR) - damping * driftRate) * h;
    drift += driftRate * h;
    if (bike && Math.abs(drift) > S.moto.max) {
      drift = Math.sign(drift) * S.moto.max;
      driftRate = 0;
    }
    return v2 > 0.25 ? (aF + aR) / 2 / v2 : kCmd;
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
    // Parts de l'adhérence prises en long par la poussée (rapportée à la motricité) et par le frein.
    let driveUse = 0;
    let brakeUse = 0;
    if (input.auto) {
      const thrust = engine.thrust(v, false, train.rpm);
      const resist = engine.resist(v);
      // Freinage et reprise bornés par ce que les pneus tiennent sous la météo (au sec, les plafonds d'avant).
      const target = Math.max(-Math.min(PILOT.maxBrake, PILOT.manual.brake * wetGrip * PRUDENCE_AUTO.frein), track(profile.auto, motion.s, v));
      // Reprise : une part de ce que le moteur donne (une Cox reprend en douceur, une voiture de course franchement).
      wanted = Math.min(PILOT.accel, PILOT.autoShare * (thrust * cut - resist), traction * PRUDENCE_AUTO.reprise, target);
      jerk = PILOT.jerk;
      braking = wanted <= -0.6;
      // Charge : ce qu'il faut de moteur pour tenir l'accélération voulue (un filet en croisière).
      load = braking ? 0 : Math.min(1, Math.max(0.15, (wanted + resist) / Math.max(0.1, thrust)));
    } else {
      const brake = Math.min(1, Math.max(0, input.brake));
      // Le NOS, c'est plein gaz.
      const throttle = nos ? 1 : Math.min(1, Math.max(0, input.throttle));
      // Motricité : ce que les roues motrices transmettent, moins ce que la courbe leur prend déjà ; au-delà,
      // elles patinent et transmettent un peu moins.
      const push = throttle * engine.thrust(v, nos, train.rpm) * cut;
      const mu = Math.max(0.5, performance.grip * wetGrip);
      const latUse = Math.min(0.95, Math.abs(lateralNow) / mu);
      const tenue = traction * Math.sqrt(1 - latUse * latUse);
      // Excès de poussée sur la motricité (part, lissé) : il fait le patinage (plein à `MOTRICITE.plein`) et
      // la poussée perdue, qui croît avec lui sans plafond avant `perteMax` (plus de puissance sur la neige :
      // plus de roues qui patinent, moins de poussée transmise).
      const pousse = Math.min(push, throttle * torquePush * (nos ? 1 + (performance.nosBoost ?? PILOT.nos.boost) : 1));
      const lisse = Math.min(1, h / MOTRICITE.tau);
      spin += (patinageDe(pousse, tenue) - spin) * lisse;
      if (spin < 1e-4) spin = 0;
      exces += (excesDe(pousse, tenue) - exces) * lisse;
      if (exces < 1e-4) exces = 0;
      driveUse = push / traction;
      brakeUse = brake;
      wanted = Math.min(push, tenue * (1 - Math.min(MOTRICITE.perteMax, (MOTRICITE.perte * exces) / MOTRICITE.plein))) - engine.resist(v) - brake * PILOT.manual.brake * wetGrip;
      if (throttle === 0 && brake === 0) wanted -= PILOT.manual.coast;
      // Aucun frein posé par l'app : seuls le bord et la caisse en travers ralentissent, plus bas.
      wanted = Math.max(-PILOT.manual.brake, wanted);
      jerk = PILOT.manual.jerk;
      braking = brake > 0;
      load = brake > 0 ? 0 : throttle;
    }
    const delta = wanted - accel;
    const limit = jerk * h;
    accel += Math.max(-limit, Math.min(limit, delta));
    axLisse += (accel - axLisse) * Math.min(1, h / SURVIRAGE.reportTau);
    // Jamais de recul : à l'arrêt, une décélération ne fait que tenir le véhicule.
    let speed = v + accel * h;
    if (speed <= 0) {
      speed = 0;
      if (accel < 0) accel = 0;
    }
    // À la main : le mouvement libre (chemin fait le long de l'axe), repris d'où en est le véhicule.
    const kRoad = pose.curvature;
    let kCmd = 0;
    let advance = speed * h;
    if (!input.auto) {
      if (mode !== 'main') {
        free.offset = motion.offset;
        free.psi = clampTo(motion.yaw ?? 0, PILOT.free.yawMax);
        free.curvature = pathCurvature;
        volant = 0;
        drift = 0;
        driftRate = 0;
        mode = 'main';
      }
      if (input.assist === true) {
        volant = 0;
        const lead = motion.s + (rail.loop ? 1 : Math.sign(rail.length - motion.s) || 1) * speed * PILOT.lane.lead;
        laneLimits(pose, kind, halfWidth, halfLength, here);
        let target = sampleLine(line.offset, line, lead);
        if (input.steer !== undefined) target = pasPlacement(manche, input.steer, target, here[0], here[1], speed, h);
        else {
          manche.weight = 0;
          if (input.lane < 0) target = sampleLine(line.left, line, lead) - PILOT.lane.request;
          else if (input.lane > 0) target = sampleLine(line.right, line, lead) + PILOT.lane.request;
        }
        target = Math.max(here[0], Math.min(here[1], target));
        kCmd = courbureAssistee(target - free.offset, free.psi, kRoad, free.offset, speed, kind);
      } else {
        manche.weight = 0;
        const want = Number.isFinite(input.steer) ? clampTo(input.steer as number, 1) : 0;
        const returning = Math.abs(want) < Math.abs(volant) && want * volant >= 0;
        volant += (want - volant) * (1 - Math.exp(-h / (returning ? PILOT.free.tauOut : PILOT.free.tauIn)));
        if (Math.abs(volant) < 1e-4 && want === 0) volant = 0;
        kCmd = courbureVolant(volant, speed, performance.grip, kind);
      }
      // Direction assistée : l'aide tient la caisse (pas de dérive), la météo borne quand même la courbe.
      const kPath = input.assist === true ? kCmd : courbeTenue(kCmd, speed, kind, driveUse, brakeUse, h);
      if (input.assist === true) {
        drift = 0;
        driftRate = 0;
        rearSlide = 0;
        capFront = Math.max(0.5, performance.grip * wetGrip);
      }
      advance = avanceLibre(free, kPath, kRoad, speed, input.assist === true ? capFront : performance.grip * 2, h);
    }
    motion.accel = (speed - v) / h;
    motion.speed = speed;
    stepGearbox(h, speed, load, braking);
    let s = motion.s + advance;
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

    rail.poseAt(s, pose);
    laneLimits(pose, kind, halfWidth, halfLength, here);
    const S = PILOT.steer;
    if (!input.auto) {
      // À la main : le bord (frottement, cap ramené le long du bord, vitesse perdue), puis la caisse.
      // Les bornes d'ici, resserrées comme celles de la trajectoire un peu avant et après les
      // rétrécissements (les coins du véhicule y arrivent avant son centre).
      let lo = Math.max(here[0], sampleLine(line.right, line, s));
      let hi = Math.min(here[1], sampleLine(line.left, line, s));
      if (lo > hi) lo = hi = (lo + hi) / 2;
      const scrub = bordLibre(free, lo, hi, halfWidth, halfLength, motion.speed, h, free.psi + drift);
      if (free.contact !== 0) touched = free.contact;
      // La caisse en travers frotte : elle perd de la vitesse (ce n'est pas un frein posé par l'app).
      const sideways = SURVIRAGE.frottement * Math.max(0.5, performance.grip * wetGrip) * Math.abs(Math.sin(drift));
      if ((scrub > 0 || sideways > 0) && !motion.finished) {
        motion.speed = Math.max(0, motion.speed - (scrub + sideways) * h);
        motion.accel = (motion.speed - v) / h;
      }
      // Au bord, la dérive se referme ; au pas, la caisse se remet dans l'axe (pas de marche arrière).
      if (free.contact !== 0) {
        drift *= Math.exp(-h / SURVIRAGE.bord);
        driftRate *= Math.exp(-h / SURVIRAGE.bord);
      }
      if (motion.speed < SURVIRAGE.remise.vitesse) {
        const k = Math.exp(-h / SURVIRAGE.remise.tau);
        drift *= k;
        driftRate *= k;
      }
      if (Math.abs(drift) < 1e-5 && Math.abs(driftRate) < 1e-4) drift = driftRate = 0;
      const F = PILOT.free;
      const edgeSlip = free.contact !== 0 ? Math.min(1, F.slip.edge + F.slip.edgeGain * free.push) * Math.min(1, motion.speed / F.slip.edgeSpeed) : 0;
      const slipWanted = Math.max(glissementSousVirage(kCmd, motion.speed, capFront), edgeSlip, rearSlide, spin);
      motion.slip = (motion.slip ?? 0) + (slipWanted - (motion.slip ?? 0)) * Math.min(1, h / F.slip.tau);
      motion.offset = free.offset;
      motion.drift = drift;
      motion.spin = spin;
      motion.yaw = free.psi + drift;
      // Pour rendre la main au pilote automatique sans à-coup.
      lateralRate = motion.speed * Math.sin(free.psi);
      lastOffset = motion.offset;
      pathCurvature = free.curvature;
      const wheelAngle = motion.steer ?? 0;
      motion.steer = wheelAngle + (steerOf(kCmd, motion.speed, kind) - wheelAngle) * Math.min(1, h / S.tau);
      lateralNow = motion.speed * motion.speed * free.curvature;
      if (kind === 'bike') {
        // Elle se couche selon la courbure réellement prise.
        motion.roll += (bikeLeanOf(lateralNow) - motion.roll) * Math.min(1, h / PILOT.lean.tau);
        rollRate = 0;
      } else {
        const w = PILOT.roll.omega;
        rollRate += (w * w * (carRollOf(lateralNow, performance.grip) * rollShare - motion.roll) - 2 * PILOT.roll.damping * w * rollRate) * h;
        motion.roll += rollRate * h;
      }
    } else {
      // Placement : la trajectoire de route dégagée, visée un peu en avant ; à la main, le bord gauche ou
      // droit demandé, ou la place tenue au manche (progressive, rien ne bouge à l'arrêt). Jamais au-delà
      // des bornes d'ici.
      const lead = s + (rail.loop ? 1 : Math.sign(rail.length - s) || 1) * speed * PILOT.lane.lead;
      if (mode !== 'auto') {
        // On reprend d'où en est le véhicule : sa vitesse latérale, et son cap qui s'efface doucement.
        const rate = speed * Math.sin(motion.yaw ?? 0);
        offsetRate = rate;
        lateralRate = rate;
        lastOffset = motion.offset;
        yawCarry = mode === 'main' ? (motion.yaw ?? 0) - yawOf(rate, speed) : 0;
        manche.weight = 0;
        mode = 'auto';
      }
      let target = sampleLine(line.offset, line, lead);
      target = Math.max(here[0], Math.min(here[1], target));
      const omega = PILOT.lane.omega;
      offsetRate += (omega * omega * (target - motion.offset) - 2 * omega * offsetRate) * h;
      const maxRate = Math.max(PILOT.lane.maxRate, PILOT.lane.maxRatePerSpeed * speed);
      offsetRate = Math.max(-maxRate, Math.min(maxRate, offsetRate));
      motion.offset = Math.max(here[0], Math.min(here[1], motion.offset + offsetRate * h));

      // Caisse. La vitesse latérale (changement de place), lissée, fait pivoter le véhicule (`yaw`) ; la
      // courbure réellement suivie (la route ici, plus la variation de ce cap par mètre) fait le braquage
      // des roues avant et l'accélération latérale du roulis.
      if (pose.s !== s) rail.poseAt(s, pose);
      lateralRate += ((motion.offset - lastOffset) / h - lateralRate) * Math.min(1, h / S.lateralTau);
      lastOffset = motion.offset;
      const yawBefore = motion.yaw ?? 0;
      yawCarry *= Math.exp(-h / PILOT.free.handover);
      if (Math.abs(yawCarry) < 1e-5) yawCarry = 0;
      motion.yaw = yawOf(lateralRate, speed) + yawCarry;
      const followed = pose.curvature + (motion.yaw - yawBefore) / (h * Math.max(speed, S.fade));
      pathCurvature += (followed - pathCurvature) * Math.min(1, h / S.curveTau);
      const wheelAngle = motion.steer ?? 0;
      motion.steer = wheelAngle + (steerOf(pathCurvature, speed, kind) - wheelAngle) * Math.min(1, h / S.tau);
      const lateral = speed * speed * pathCurvature;
      lateralNow = lateral;
      motion.slip = (motion.slip ?? 0) * Math.max(0, 1 - h / PILOT.free.slip.tau);
      // Le pilote automatique ne glisse ni ne patine jamais.
      drift = driftRate = spin = exces = 0;
      motion.drift = 0;
      motion.spin = 0;
      if (kind === 'bike') {
        // Elle se couche un peu avant la corde : la courbure à venir sur la trajectoire s'ajoute.
        const ahead = sampleLine(line.curvature, line, s + speed * PILOT.lean.anticipation) - sampleLine(line.curvature, line, s);
        const lean = bikeLeanOf(lateral + speed * speed * ahead);
        motion.roll += (lean - motion.roll) * Math.min(1, h / PILOT.lean.tau);
        rollRate = 0;
      } else {
        const roll = carRollOf(lateral, performance.grip) * rollShare;
        const w = PILOT.roll.omega;
        rollRate += (w * w * (roll - motion.roll) - 2 * PILOT.roll.damping * w * rollRate) * h;
        motion.roll += rollRate * h;
      }
    }
    motion.pull = (motion.pull ?? 0) + (motion.accel - (motion.pull ?? 0)) * Math.min(1, h / PILOT.pullTau);
    const gain = kind === 'bike' ? PILOT.dive.gainBike : PILOT.dive.gainCar;
    const dive = Math.max(-PILOT.dive.max, Math.min(PILOT.dive.max, gain * motion.accel));
    const w = PILOT.dive.omega;
    diveRate += (w * w * (dive - motion.dive) - 2 * PILOT.dive.damping * w * diveRate) * h;
    motion.dive += diveRate * h;
  }

  function step(dt: number, input: DriveInput, kind: 'car' | 'bike'): DriveMotion {
    const span = Math.min(0.1, Math.max(0, Number.isFinite(dt) ? dt : 0));
    if (span > 0) touched = 0;
    if (span > 0 && !motion.finished && !held) {
      const count = Math.max(1, Math.ceil(span / PILOT.substep - 1e-9));
      const h = span / count;
      for (let i = 0; i < count && !motion.finished; i += 1) substep(h, input, kind);
    } else if (span > 0) {
      // Arrivé : la caisse se pose, le véhicule ne bouge plus, le moteur retombe au ralenti.
      motion.roll *= Math.max(0, 1 - span * 4);
      motion.dive *= Math.max(0, 1 - span * 4);
      motion.steer = (motion.steer ?? 0) * Math.max(0, 1 - span * 4);
      motion.yaw = (motion.yaw ?? 0) * Math.max(0, 1 - span * 4);
      motion.pull = (motion.pull ?? 0) * Math.max(0, 1 - span * 4);
      motion.slip = (motion.slip ?? 0) * Math.max(0, 1 - span * 8);
      spin *= Math.max(0, 1 - span * 8);
      exces *= Math.max(0, 1 - span * 8);
      drift *= Math.max(0, 1 - span * 4);
      driftRate = 0;
      motion.spin = spin;
      motion.drift = drift;
      if (held) {
        // Tenu sur la ligne : un appui sur le NOS ne part pas ; l'accélérateur fait monter le régime à vide.
        nosSeen = input.nos ?? 0;
        nosLeft = 0;
        motion.speed = 0;
        motion.accel = 0;
      }
      stepNos(span, input);
      const revs = held && !input.auto ? input.throttle : 0;
      stepGearbox(span, 0, revs, !held || input.brake > 0.05);
    }
    // À la main, les feux stop sont ceux du joueur : un bord qui ralentit n'est pas un freinage.
    motion.braking = input.auto
      ? motion.finished || motion.speed < 0.05 || motion.accel < -0.6
      : motion.finished || input.brake > 0.05 || (motion.speed < 0.05 && !(input.throttle > 0));
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
    profile = createSpeedProfile(rail, performance, line, weather);
  }

  /** Météo : adhérence, motricité, freinage ; le profil du pilote automatique est recalculé. */
  function setWeather(next: Weather): void {
    if (next === weather || !(next === 'sec' || next === 'pluie' || next === 'neige')) return;
    weather = next;
    wetGrip = adherenceDe(performance, weather);
    traction = motriciteDe(performance, weather);
    profile = createSpeedProfile(rail, performance, line, weather);
  }

  /** Tient le véhicule sur la ligne (vrai) ou le lâche (faux). */
  function setHold(on: boolean): void {
    held = on;
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
    transmission,
    get contact() {
      return touched;
    },
    get lateral() {
      return lateralNow;
    },
    get weather() {
      return weather;
    },
    get adherence() {
      return wetGrip;
    },
    reset,
    step,
    setSize,
    setHold,
    setWeather,
  };
}
