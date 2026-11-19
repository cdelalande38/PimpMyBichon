// L'adversaire seul sur la route, hors de la scène, à pas imposé : pour les tests (il boucle chaque carte
// sans toucher un bord, ses temps face aux médailles, le déterminisme). Même machine du départ que la scène.

import type { Weather } from '../contrat.ts';
import { armerDepart, createDepart, pasDepart, type EtatDepart } from '../depart.ts';
import { laneLimits } from '../pilote.ts';
import { createPose } from '../rail.ts';
import { pasAdversaire, remettreAdversaire, type PiloteAdversaire } from './pilotage.ts';

export interface SimulationAdversaire {
  /** Temps de la course, s ; Infinity s'il n'a pas fini. */
  temps: number;
  /** Pas où il a frôlé la limite de sa trajectoire (garde au bord comprise), comme la conduite de référence. */
  contacts: number;
  /** Pas où il était hors de la chaussée (au-delà des limites, garde comprise, de plus de 2 cm) : jamais. */
  dehors: number;
  /** Vitesse réelle la plus haute, m/s. */
  vitesseMax: number;
}

/** Une course de l'adversaire, départ arrêté en `at`, `tours` tours, sous `meteo`, au pas de `dt` s. */
export function simulerAdversaire(p: PiloteAdversaire, at: number, tours: number, meteo: Weather, dt = 0.1, max = 3600): SimulationAdversaire {
  const rail = p.pilot.rail;
  p.pilot.setWeather(meteo);
  remettreAdversaire(p, at, p.pilot.motion.offset);
  p.pilot.reset(at);
  const etat = armerDepart(createDepart(), p.pilot.motion.s, rail.loop, false, rail.loop ? tours : 1);
  etat.phase = 'parti';
  etat.vert = true;
  etat.depuisVert = Infinity;
  let contacts = 0;
  let dehors = 0;
  let vitesseMax = 0;
  const pose = createPose();
  const bornes: [number, number] = [0, 0];
  const perf = p.pilot.performance;
  const arrive = (e: EtatDepart) => e.phase === 'arrive';
  for (let t = 0; t < max && !arrive(etat); t += dt) {
    const motion = pasAdversaire(p, dt, false);
    if (p.pilot.contact !== 0) contacts += 1;
    rail.poseAt(motion.s, pose);
    laneLimits(pose, perf.kind, perf.halfWidth ?? 0.95, perf.halfLength ?? 2.2, bornes);
    if (motion.offset < bornes[0] - 0.02 || motion.offset > bornes[1] + 0.02) dehors += 1;
    if (p.vitesse > vitesseMax) vitesseMax = p.vitesse;
    pasDepart(etat, dt, true, motion.s, rail, motion.finished);
  }
  return { temps: arrive(etat) ? etat.arrivee / 1000 : Infinity, contacts, dehors, vitesseMax };
}
