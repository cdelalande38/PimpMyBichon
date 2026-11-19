// Simulation d'un parcours de drift (format « Drift »), hors de la scène, à pas imposé : sert à l'outil des
// paliers de médaille (tools/courses/paliers-drift.mjs, `npm run courses:drift`) et aux tests. La course se
// court comme en jeu (src/drive/depart.ts, départ arrêté, un tour) et se compte par le vrai score
// (src/jeu/drift.ts, d'après la dérive, la vitesse et le bord).
//
// La conduite de drift appliquée : direction libre (le réglage d'origine), le manche tenu pour suivre l'axe de
// la route (la place la plus large de chaque côté : en travers, la caisse déborde) ; à l'entrée de chaque
// virage assez serré (rayon ≤ `rayonMax`), à bonne vitesse et pas en plein freinage, un coup de frein d'un
// pas, manche poussé du côté du virage ; plein gaz ensuite ; frein à fond (un freinage tenu, qui arrête la
// glisse) quand la vitesse dépasse ce qui permet encore de passer le prochain virage, comme la conduite à la
// main des temps de référence (src/drive/simulationCourse.ts). Pas de NOS ; l'angle n'est pas ouvert au
// manche : un joueur qui le fait marque plus.

import type { MapRoute } from '../data/mapTypes.ts';
import { bilanDrift, createEtatDrift, pasDrift } from '../jeu/drift.ts';
import type { StatsDrift } from '../jeu/contrat.ts';
import type { DriveInput, Weather } from './contrat.ts';
import { armerDepart, createDepart, pasDepart } from './depart.ts';
import { courbureBraquage, PILOT, type PilotWithProfile } from './pilote.ts';
import { createPose } from './rail.ts';
import { situationNeuve, situer, trouverVirages } from './virages.ts';
import { DRIFT } from '../data/adherence.ts';

export const SIMULATION_DRIFT = {
  /** Pas imposé, en s (celui d'une image en rendu logiciel). */
  dt: 0.1,
  /** Virages où la conduite drifte : rayon le plus serré au plus (m). */
  rayonMax: 120,
  /** Part de l'adhérence visée en courbe, part du freinage le plus fort (comme la conduite à la main). */
  marge: 0.92,
  frein: 0.8,
  /** Regard devant : pas d'échantillonnage (m), temps de réaction (s). */
  regard: 4,
  reaction: 0.3,
  /** Manche ajouté au coup de frein, vers l'intérieur du virage. */
  manche: 0.5,
  /** Regard du manche : distance visée devant (m, au moins), en secondes de route. */
  visee: 8,
  viseeTemps: 0.7,
} as const;

/**
 * Manche (de −1 à 1, comme `DriveInput.steer`) qui ramène le véhicule sur l'axe de la route : la courbure de
 * la route ici, plus ce qui rattrape l'écart et le cap vus à la distance visée ; inverse de `courbureVolant`.
 */
export function mancheVersAxe(pilot: PilotWithProfile, kRoute: number): number {
  const m = pilot.motion;
  const v = m.speed;
  const kind = pilot.performance.kind;
  const L = Math.max(SIMULATION_DRIFT.visee, v * SIMULATION_DRIFT.viseeTemps);
  const cap = (m.yaw ?? 0) - (m.drift ?? 0);
  const voulue = Math.max(-courbureBraquage(kind), Math.min(courbureBraquage(kind), kRoute + (2 * (-m.offset - cap * L)) / (L * L)));
  const F = PILOT.free;
  const plein = Math.min(courbureBraquage(kind), (F.fullGrip * Math.max(1, pilot.performance.grip)) / Math.max(F.slowSpeed, v) ** 2);
  return -Math.sign(voulue) * Math.min(1, (Math.abs(voulue) / plein) ** (1 / F.expo));
}

export interface SimulationDrift extends StatsDrift {
  /** Temps du parcours, en s ; Infinity s'il n'a pas fini dans le temps donné. */
  temps: number;
  /** Coups de frein donnés. */
  coups: number;
  /** Pas où le bord a été touché. */
  contacts: number;
}

export interface OptionsDrift {
  /** Abscisse du départ (MapStart.at), en m. */
  at: number;
  meteo: Weather;
  /** Temps de route au plus, en s. */
  max?: number;
}

/** Vitesse (m/s) au-delà de laquelle la conduite freine : le prochain virage la limite. */
function vitesseTenable(pilot: PilotWithProfile, s: number, v: number, grip: number, frein: number, pose: ReturnType<typeof createPose>): number {
  const rail = pilot.rail;
  const S = SIMULATION_DRIFT;
  const portee = (v * v) / (2 * frein) + v * S.reaction + 10;
  let tenable = Infinity;
  for (let d = 0; d <= portee; d += S.regard) {
    let at = s + d;
    if (rail.loop) at = ((at % rail.length) + rail.length) % rail.length;
    else if (at > rail.length) break;
    const k = Math.abs(rail.poseAt(at, pose).curvature);
    if (k < 1e-5) continue;
    const vVirage = Math.sqrt(grip / k);
    const vIci = Math.sqrt(vVirage * vVirage + 2 * frein * Math.max(0, d - v * S.reaction));
    if (vIci < tenable) tenable = vIci;
  }
  return tenable;
}

/** Un parcours de drift simulé (un tour, ou du départ à l'arrivée), du vert à l'arrivée. */
export function simulerDrift(pilot: PilotWithProfile, route: Pick<MapRoute, 'loop'>, options: OptionsDrift): SimulationDrift {
  const S = SIMULATION_DRIFT;
  const { rail } = pilot;
  const kind = pilot.performance.kind;
  const virages = trouverVirages(rail);
  const ici = situationNeuve();
  pilot.setWeather(options.meteo);
  pilot.setHold(false);
  pilot.reset(options.at);
  const etat = armerDepart(createDepart(), pilot.motion.s, route.loop, false, 1);
  etat.phase = 'parti';
  etat.vert = true;
  etat.depuisVert = Infinity;
  const score = createEtatDrift();
  const max = options.max ?? 3600;
  const input: DriveInput = { auto: false, throttle: 1, brake: 0, lane: 0, steer: 0 };
  const adherence = pilot.adherence;
  const grip = pilot.performance.grip * adherence * S.marge;
  const frein = PILOT.manual.brake * adherence * S.frein;
  const pose = createPose();
  let contacts = 0;
  let coups = 0;
  /** Dernier virage où un coup de frein a été donné (un seul par virage). */
  let fait = -1;
  let freinait = false;
  const arrivee = () => etat.phase === 'arrive';
  for (let t = 0; t < max && !arrivee(); t += S.dt) {
    const m = pilot.motion;
    const freine = m.speed > vitesseTenable(pilot, m.s, m.speed, grip, frein, pose);
    situer(virages, m.s, ici);
    const virage = ici.courant >= 0 ? virages.liste[ici.courant] : undefined;
    const coup: boolean = !freine && !freinait && virage !== undefined && ici.courant !== fait && virage.rayon <= S.rayonMax && m.speed >= DRIFT.vitesseMin * 1.1 && pilot.glisse === 0;
    if (coup) {
      fait = ici.courant;
      coups += 1;
    }
    freinait = freine || coup;
    input.throttle = freine || coup ? 0 : 1;
    input.brake = freine || coup ? 1 : 0;
    // Le manche suit l'axe ; pendant le coup, poussé du côté du virage (sens +1 : à gauche, manche négatif).
    const suivi = mancheVersAxe(pilot, rail.poseAt(m.s, pose).curvature);
    input.steer = coup && virage ? Math.max(-1, Math.min(1, suivi - virage.sens * S.manche)) : suivi;
    const motion = pilot.step(S.dt, input, kind);
    if (pilot.contact !== 0) contacts += 1;
    pasDrift(score, S.dt, motion.drift ?? 0, motion.speed, pilot.contact);
    pasDepart(etat, S.dt, true, motion.s, rail, motion.finished);
  }
  return { ...bilanDrift(score), temps: arrivee() ? etat.arrivee / 1000 : Infinity, coups, contacts };
}
