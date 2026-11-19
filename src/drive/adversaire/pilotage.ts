// Le pilotage de l'adversaire du duel (§ 5.5, jeu). Aucune conduite nouvelle : c'est le pilote de la sortie
// (src/drive/pilote.ts), conduit comme la conduite à la main appliquée qui donne les temps de référence
// (src/drive/simulationCourse.ts : direction assistée, plein gaz, frein à fond dès que la vitesse dépasse ce
// que tient le prochain virage, décidé tous les dixièmes de seconde), en temps réel, avec toute la puissance
// de son véhicule : aucune limite de vitesse de balade, aucune horloge ralentie.
//
// Le niveau (src/data/adversaires.ts, au menu) règle trois choses, mesurées par tests/unit/adversaire.test.ts :
// - l'allure a : il vise a × la vitesse que son véhicule tient en virage (adhérence visée × a²) et a × sa
//   vitesse de pointe (au-delà, il lève le pied) ; à 1, rien ne le retient ;
// - le freinage : la part du freinage le plus fort sur laquelle il compte pour arriver au virage (la
//   référence compte sur 80 % ; plus bas, il freine plus tôt) ;
// - l'irrégularité : d'une section de route à l'autre (`ReglagePilotage.section` m), son allure baisse de 0 à
//   `irregularite` (bruit déterministe tiré de l'abscisse et de l'adversaire, lissé) : il rate un peu un
//   virage, jamais le même partout, toujours pareil d'une course à l'autre. Jamais au-dessus de son niveau.
// Au niveau le plus dur (allure 1, freinage 0,8, régulier), il court exactement la conduite de référence de son
// véhicule. Pas d'élastique : il ne regarde jamais le joueur pour régler son allure. Sous la pluie et sur la
// neige, il freine pour l'adhérence de la météo, comme la référence. Aucun hasard, aucune allocation par image.

import type { DriveInput, DriveMotion, RailPose } from '../contrat.ts';
import { PILOT, type PilotWithProfile } from '../pilote.ts';
import { createPose } from '../rail.ts';
import { SIMULATION, vitesseTenable } from '../simulationCourse.ts';
import type { NiveauDuel, ReglagePilotage } from '../../data/adversaires.ts';

/** Bruit d'une section, de −1 à 1, tiré d'un entier (déterministe, sans état). */
export function bruitSection(section: number, graine: number): number {
  let h = Math.imul(section | 0, 374761393) ^ Math.imul(graine | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/** Graine d'un adversaire, tirée de son identifiant. */
export function graineDe(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h | 0;
}

/**
 * Variation de l'allure à l'abscisse `s` (de −1 à 1), lissée d'une section à la suivante. Sur une boucle,
 * les sections se referment sur elles-mêmes (`sections` : leur nombre sur le tour ; 0 : route ouverte).
 */
export function variationAllure(s: number, longueurSection: number, graine: number, sections = 0): number {
  const x = Math.max(0, s) / Math.max(1, longueurSection);
  const k = Math.floor(x);
  const f = x - k;
  const t = f * f * (3 - 2 * f);
  const a = sections > 0 ? k % sections : k;
  const b = sections > 0 ? (k + 1) % sections : k + 1;
  return bruitSection(a, graine) * (1 - t) + bruitSection(b, graine) * t;
}

export interface PiloteAdversaire {
  readonly pilot: PilotWithProfile;
  /** Le niveau couru. */
  niveau: NiveauDuel;
  /** Allure du moment (irrégularité comprise), 0 à 1. */
  allureIci: number;
  /** Vitesse (m/s). */
  vitesse: number;
  /** Placement demandé : −1 bord gauche, 1 bord droit, 0 sa trajectoire (src/drive/adversaire/contact.ts). */
  lane: -1 | 0 | 1;
  readonly graine: number;
  readonly reglage: ReglagePilotage;
  /** Temps de référence depuis la dernière décision gaz / frein (s). */
  depuisDecision: number;
  readonly input: DriveInput;
  readonly pose: RailPose;
}

export function createPiloteAdversaire(pilot: PilotWithProfile, niveau: NiveauDuel, reglage: ReglagePilotage, graine: number): PiloteAdversaire {
  return {
    pilot,
    niveau,
    allureIci: niveau.allure,
    vitesse: 0,
    lane: 0,
    graine,
    reglage,
    depuisDecision: Infinity,
    input: { auto: false, throttle: 0, brake: 0, lane: 0, assist: true },
    pose: createPose(),
  };
}

/** Remet l'adversaire arrêté en `s`, à l'écart `offset` de l'axe (m, positif à gauche). */
export function remettreAdversaire(p: PiloteAdversaire, s: number, offset: number): void {
  p.pilot.reset(s);
  // Repris par le pilote au premier pas à la main (src/drive/pilote.ts, passage de relais).
  p.pilot.motion.offset = offset;
  p.vitesse = 0;
  p.lane = 0;
  p.depuisDecision = Infinity;
  p.input.throttle = 0;
  p.input.brake = 0;
}

/** Un pas de `dt` s de temps de sortie ; `tenu` : feux pas encore au vert. Rend le mouvement du pilote. */
export function pasAdversaire(p: PiloteAdversaire, dt: number, tenu: boolean): DriveMotion {
  const pilot = p.pilot;
  pilot.setHold(tenu);
  const rail = pilot.rail;
  const n = p.niveau;
  let a = n.allure;
  if (n.irregularite > 0) {
    const sections = rail.loop ? Math.max(1, Math.round(rail.length / p.reglage.section)) : 0;
    const v = variationAllure(pilot.motion.s, rail.loop ? rail.length / sections : p.reglage.section, p.graine, sections);
    a *= 1 - (n.irregularite * (1 + v)) / 2;
  }
  p.allureIci = a;
  const pas = Math.max(0, Number.isFinite(dt) ? dt : 0);
  // La décision de la conduite appliquée, tous les dixièmes de seconde (comme l'outil des temps).
  p.depuisDecision += pas;
  if (p.depuisDecision >= SIMULATION.dt && !tenu) {
    p.depuisDecision = 0;
    const v = pilot.motion.speed;
    const grip = pilot.performance.grip * pilot.adherence * SIMULATION.marge * a * a;
    const frein = PILOT.manual.brake * pilot.adherence * n.freinage;
    const freine = v > vitesseTenable(pilot, pilot.motion.s, v, grip, frein, p.pose);
    const pointe = a < 1 && v >= (a * pilot.performance.topKmh) / 3.6;
    p.input.throttle = freine || pointe ? 0 : 1;
    p.input.brake = freine ? 1 : 0;
  }
  p.input.lane = p.lane;
  const motion = pilot.step(pas, p.input, pilot.performance.kind);
  p.vitesse = motion.speed;
  return motion;
}
