// Simulation d'une course, hors de la scène, à pas imposé : sert à l'outil des temps de référence
// (tools/courses/temps-reference.mjs, `npm run courses:temps`) et aux tests (médailles atteignables).
// La course se chronomètre par la vraie machine du départ (src/drive/depart.ts), départ arrêté, depuis le
// vert : le véhicule part de l'arrêt sur la ligne.
//
// Deux conduites :
// - `auto` : le pilote automatique (le conducteur de balade de src/drive/pilote.ts) ;
// - `main` : une conduite à la main appliquée, simulée : direction assistée (l'aide suit la route), plein
//   gaz, et frein à fond dès que la vitesse dépasse ce qui permet encore de s'arrêter à la vitesse que
//   tient le prochain virage (92 % de l'adhérence du véhicule, 80 % de son freinage le plus fort), sans
//   NOS. Un joueur appliqué fait aussi bien ; un joueur qui use du NOS, mieux.

import type { MapRoute } from '../data/mapTypes.ts';
import type { DriveInput, DrivePerformance, Weather } from './contrat.ts';
import { armerDepart, createDepart, pasDepart } from './depart.ts';
import { createPilot, PILOT, type PilotWithProfile } from './pilote.ts';
import { createPose, createRail } from './rail.ts';

export type Conduite = 'auto' | 'main';

export const SIMULATION = {
  /** Pas imposé, en s (celui d'une image en rendu logiciel). */
  dt: 0.1,
  /** Conduite à la main : part de l'adhérence visée en courbe, part du freinage le plus fort. */
  marge: 0.92,
  frein: 0.8,
  /** Regard devant : pas d'échantillonnage (m), et un temps de réaction (s). */
  regard: 4,
  reaction: 0.3,
} as const;

export interface SimulationCourse {
  /** Temps de la course, en s ; Infinity si elle n'a pas fini dans le temps donné. */
  temps: number;
  /** Temps de chaque tour, en s. */
  tours: number[];
  /** Pas où le bord a été touché (conduite à la main). */
  contacts: number;
}

export interface OptionsSimulation {
  /** Abscisse du départ (MapStart.at), en m. */
  at: number;
  /** Tours à courir (1 ou 3 ; 1 sur une route ouverte). */
  tours: number;
  meteo: Weather;
  conduite: Conduite;
  /** Temps de route au plus, en s. */
  max?: number;
}

/** Un pilote prêt pour une route et un véhicule (cher à fabriquer : à réutiliser d'un départ à l'autre). */
export function piloteDeSimulation(route: MapRoute, performance: DrivePerformance): PilotWithProfile {
  return createPilot(createRail(route), performance);
}

/** Vitesse (m/s) au-delà de laquelle la conduite à la main freine : le prochain virage la limite. */
export function vitesseTenable(pilot: PilotWithProfile, s: number, v: number, grip: number, frein: number, pose: ReturnType<typeof createPose>): number {
  const rail = pilot.rail;
  const portee = (v * v) / (2 * frein) + v * SIMULATION.reaction + 10;
  let tenable = Infinity;
  for (let d = 0; d <= portee; d += SIMULATION.regard) {
    let at = s + d;
    if (rail.loop) at = ((at % rail.length) + rail.length) % rail.length;
    else if (at > rail.length) break;
    const k = Math.abs(rail.poseAt(at, pose).curvature);
    if (k < 1e-5) continue;
    const vVirage = Math.sqrt(grip / k);
    const vIci = Math.sqrt(vVirage * vVirage + 2 * frein * Math.max(0, d - v * SIMULATION.reaction));
    if (vIci < tenable) tenable = vIci;
  }
  return tenable;
}

/** Une course simulée, du vert à l'arrivée. */
export function simulerCourse(pilot: PilotWithProfile, options: OptionsSimulation): SimulationCourse {
  const { rail } = pilot;
  const kind = pilot.performance.kind;
  pilot.setWeather(options.meteo);
  pilot.setHold(false);
  pilot.reset(options.at);
  const etat = armerDepart(createDepart(), pilot.motion.s, rail.loop, false, rail.loop ? options.tours : 1);
  // Départ arrêté, vert à l'instant 0 : pas de feux dans la simulation.
  etat.phase = 'parti';
  etat.vert = true;
  etat.depuisVert = Infinity;
  const max = options.max ?? 3600;
  const auto: DriveInput = { auto: true, throttle: 0, brake: 0, lane: 0 };
  const main: DriveInput = { auto: false, throttle: 1, brake: 0, lane: 0, assist: true };
  // Ce que les pneus tiennent sous cette météo, préparation comprise (pneus, largeur, assiette) : le
  // joueur appliqué freine pour ses pneus à lui.
  const adherence = pilot.adherence;
  const grip = pilot.performance.grip * adherence * SIMULATION.marge;
  const frein = PILOT.manual.brake * adherence * SIMULATION.frein;
  const pose = createPose();
  let contacts = 0;
  const arrivee = () => etat.phase === 'arrive';
  for (let t = 0; t < max && !arrivee(); t += SIMULATION.dt) {
    let input = auto;
    if (options.conduite === 'main') {
      const v = pilot.motion.speed;
      const freine = v > vitesseTenable(pilot, pilot.motion.s, v, grip, frein, pose);
      main.throttle = freine ? 0 : 1;
      main.brake = freine ? 1 : 0;
      input = main;
    }
    const motion = pilot.step(SIMULATION.dt, input, kind);
    if (pilot.contact !== 0) contacts += 1;
    pasDepart(etat, SIMULATION.dt, true, motion.s, rail, motion.finished);
  }
  const tours: number[] = [];
  for (let i = 0; i < etat.tours && i < etat.tempsTours.length; i += 1) tours.push((etat.tempsTours[i] ?? 0) / 1000);
  return { temps: arrivee() ? etat.arrivee / 1000 : Infinity, tours, contacts };
}
