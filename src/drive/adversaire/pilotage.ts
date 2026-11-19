// Le pilotage de l'adversaire du duel (§ 5.5, jeu). Aucune conduite nouvelle : c'est le pilote de la sortie
// (src/drive/pilote.ts), conduit comme la conduite à la main appliquée qui donne les temps de référence
// (src/drive/simulationCourse.ts : direction assistée, plein gaz, frein à fond dès que la vitesse dépasse ce
// que tient le prochain virage, décidé tous les dixièmes de seconde), avec une horloge ralentie.
//
// L'allure : le niveau de l'adversaire est une médaille. Le temps visé est le seuil de cette médaille pour
// la carte, le départ, le format et le VÉHICULE DU JOUEUR (src/data/courses.ts, seuilsMedailles, au sec) ;
// la conduite appliquée du véhicule de l'adversaire met `tempsMain` (même fichier, au sec). L'allure est
// leur rapport, a = tempsMain ÷ temps visé, plafonnée à 1 : le pilote de référence avance de a × dt à
// chaque image. Positions, vitesses et accélérations sont celles de la conduite appliquée, à l'échelle a
// (a pour les vitesses, a² pour les accélérations) : il finit au temps visé, sans jamais aller au-delà de
// ce que son véhicule tient (plafond à 1 : un adversaire dont le véhicule ne peut pas tenir le temps visé
// roule à sa limite, plus lentement, et ne triche pas). Pas d'élastique : il ne regarde jamais le joueur
// pour régler son allure. Sous la pluie et sur la neige, le pilote de référence freine pour l'adhérence de
// la météo : il roule aux allures de la météo, d'autant plus lentement que les médailles s'allongent.
//
// L'irrégularité : d'une section de route à l'autre (`ReglagePilotage.section` m), l'allure varie de
// ± `irregularite` (bruit déterministe tiré de l'abscisse et de l'adversaire, lissé d'une section à la
// suivante, toujours plafonné à 1) : il soigne ou rate un peu un virage, jamais le même partout, et
// toujours pareil d'une course à l'autre. Aucun hasard, aucune allocation par image.

import type { DriveInput, DriveMotion, RailPose } from '../contrat.ts';
import { PILOT, type PilotWithProfile } from '../pilote.ts';
import { createPose } from '../rail.ts';
import { SIMULATION, vitesseTenable } from '../simulationCourse.ts';
import type { ReglagePilotage } from '../../data/adversaires.ts';

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

/**
 * Allure d'un niveau : le temps de la conduite appliquée du véhicule de l'adversaire sur le temps visé,
 * plafonnée à 1 ; sans temps de référence (carte nouvelle), l'allure de repli du fichier.
 */
export function allureDe(tempsMain: number | null | undefined, tempsVise: number | null | undefined, repli: number): number {
  if (typeof tempsMain === 'number' && typeof tempsVise === 'number' && tempsMain > 0 && tempsVise > 0 && Number.isFinite(tempsMain) && Number.isFinite(tempsVise)) {
    return Math.min(1, tempsMain / tempsVise);
  }
  return Math.min(1, Math.max(0.2, repli));
}

export interface PiloteAdversaire {
  readonly pilot: PilotWithProfile;
  /** Allure visée (0 à 1) et allure du moment (irrégularité comprise). */
  allure: number;
  allureIci: number;
  /** Vitesse réelle (m/s) : celle du pilote de référence à l'allure du moment. */
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

export function createPiloteAdversaire(pilot: PilotWithProfile, allure: number, reglage: ReglagePilotage, graine: number): PiloteAdversaire {
  return {
    pilot,
    allure: Math.min(1, Math.max(0.2, allure)),
    allureIci: allure,
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
  const sections = rail.loop ? Math.max(1, Math.round(rail.length / p.reglage.section)) : 0;
  const a = Math.min(1, Math.max(0.2, p.allure * (1 + p.reglage.irregularite * variationAllure(pilot.motion.s, rail.loop ? rail.length / sections : p.reglage.section, p.graine, sections))));
  p.allureIci = a;
  const pas = Math.max(0, Number.isFinite(dt) ? dt : 0) * a;
  // La décision de la conduite appliquée, tous les dixièmes de seconde de son temps (comme l'outil des temps).
  p.depuisDecision += pas;
  if (p.depuisDecision >= SIMULATION.dt && !tenu) {
    p.depuisDecision = 0;
    const v = pilot.motion.speed;
    const grip = pilot.performance.grip * pilot.adherence * SIMULATION.marge;
    const frein = PILOT.manual.brake * pilot.adherence * SIMULATION.frein;
    const freine = v > vitesseTenable(pilot, pilot.motion.s, v, grip, frein, p.pose);
    p.input.throttle = freine ? 0 : 1;
    p.input.brake = freine ? 1 : 0;
  }
  p.input.lane = p.lane;
  const motion = pilot.step(pas, p.input, pilot.performance.kind);
  p.vitesse = motion.speed * a;
  return motion;
}
