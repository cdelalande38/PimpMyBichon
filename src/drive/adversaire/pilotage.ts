// Le pilotage de l'adversaire du duel (§ 5.5, jeu). Aucune conduite nouvelle : c'est le pilote de la sortie
// (src/drive/pilote.ts), conduit comme la conduite à la main appliquée des temps de référence
// (src/drive/simulationCourse.ts : direction assistée, plein gaz, frein dès que la vitesse dépasse ce que tient
// le prochain virage, décidé tous les dixièmes de seconde), en temps réel, avec toute la puissance de son
// véhicule. Deux différences (vague W, 20 novembre 2026 : « au premier virage elle a freiné tellement que je
// l'ai dépassée ») :
// - la vitesse de passage se lit sur la courbure de SA trajectoire, plus douce que la route dessinée, et jamais
//   sous celle de la conduite de référence (`vitesseTenableLigne`) ;
// - l'audace : dans la sortie, le bord frotté ralentit bien plus fort qu'un frein (src/drive/pilote.ts,
//   `bordLibre`), si bien qu'un joueur qui ne freine jamais passe un angle droit d'Ocean Drive à 117 km/h quand
//   des pneus tenus le passent à 30. L'adversaire vise √audace fois la vitesse de ses pneus et laisse le bord
//   faire le reste, comme le joueur.
//
// Le niveau (src/data/adversaires.ts, au menu) règle, mesuré par tests/unit/adversaire.test.ts :
// - l'allure a : il vise a × la vitesse que ses pneus tiennent sur sa trajectoire (adhérence × a² × audace) et
//   a × sa vitesse de pointe (au-delà, il lève le pied) ; jamais moins, en virage, que la référence ;
// - le freinage : la part du freinage le plus fort qu'il prévoit et qu'il applique (bas : il freine tôt, en
//   douceur) ;
// - l'audace (voir plus haut) : 1, il freine pour ses pneus ; 100, il ne freine pour aucun virage ;
// - l'irrégularité : d'une section de route à l'autre (`ReglagePilotage.section` m), son allure baisse de 0 à
//   `irregularite` (bruit déterministe tiré de l'abscisse et de l'adversaire, lissé) : il rate un peu un
//   virage, jamais le même partout, toujours pareil d'une course à l'autre. Jamais au-dessus de son niveau.
// Pas d'élastique : il ne regarde jamais le joueur pour régler son allure. Sous la pluie et sur la neige, il
// freine pour l'adhérence de la météo, comme la référence. Aucun hasard, aucune allocation par image.
//
// NOS (niveau `nos` > 0 : Normal et Difficile) : la même poussée que le joueur, par la même entrée du pilote
// (`DriveInput.nos`, sa propre réserve), envoyée en sortie de virage, au début de chaque ligne droite de sa
// trajectoire d'au moins `nos` m (rayon au-delà de `ReglagePilotage.nosRayon`), points fixés une fois pour la
// carte (`pointsNos`) ; jamais avant `nosDepart` m de chemin (pas au départ arrêté), jamais en freinant. Sa
// réserve se vide et se recharge comme celle du joueur : il n'en a pas pour toutes les lignes droites.

import type { DriveInput, DriveMotion, RailPose } from '../contrat.ts';
import { PILOT, sampleLine, type PilotWithProfile } from '../pilote.ts';
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

/**
 * Les points d'envoi du NOS sur une carte : le début (abscisse, m, croissante) de chaque ligne droite de la
 * trajectoire (rayon au-delà de `rayon` m) longue d'au moins `longueur` m. Calculé une fois, hors de l'image.
 */
export function pointsNos(line: { readonly step: number; readonly loop: boolean; readonly curvature: Float64Array }, longueur: number, rayon: number): Float64Array {
  const k = line.curvature;
  const n = k.length;
  if (!(longueur > 0) || n < 2) return new Float64Array(0);
  const droit = (i: number) => Math.abs(k[((i % n) + n) % n]!) < 1 / rayon;
  // Sur une boucle, on part d'un virage : une ligne droite à cheval sur l'origine reste entière.
  let debut = 0;
  if (line.loop) {
    while (debut < n && droit(debut)) debut += 1;
    if (debut === n) return new Float64Array(0);
  }
  const fin = line.loop ? debut + n : n;
  const out: number[] = [];
  for (let i = debut; i < fin; ) {
    if (!droit(i)) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < fin && droit(j)) j += 1;
    if ((j - i) * line.step >= longueur) out.push(((i % n) * line.step));
    i = j;
  }
  return Float64Array.from(out.sort((a, b) => a - b));
}

/** Vrai si l'on a passé `p` en allant de `avant` à `apres` (vers l'avant, replié sur une boucle de `longueur` m). */
export function passe(avant: number, apres: number, p: number, longueur: number, boucle: boolean): boolean {
  if (apres >= avant) return p > avant && p <= apres;
  return boucle && longueur > 0 && (p > avant || p <= apres);
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
 * Comme `vitesseTenable` (src/drive/simulationCourse.ts), sur la courbure de SA trajectoire (`pilot.line`) au lieu
 * de celle de la route : la route dessinée a des cassures (carrefours, cordes de 4 m) que la trajectoire efface.
 */
export function vitesseTenableLigne(pilot: PilotWithProfile, s: number, v: number, grip: number, frein: number): number {
  const { rail, line } = pilot;
  const portee = (v * v) / (2 * frein) + v * SIMULATION.reaction + 10;
  let tenable = Infinity;
  for (let d = 0; d <= portee; d += SIMULATION.regard) {
    let at = s + d;
    if (rail.loop) at = ((at % rail.length) + rail.length) % rail.length;
    else if (at > rail.length) break;
    const k = Math.abs(sampleLine(line.curvature, line, at));
    if (k < 1e-5) continue;
    const vIci = Math.sqrt(grip / k + 2 * frein * Math.max(0, d - v * SIMULATION.reaction));
    if (vIci < tenable) tenable = vIci;
  }
  return tenable;
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
  /** Où il envoie son NOS (abscisses croissantes, m) ; vide : jamais. */
  readonly nosPoints: Float64Array;
  /** Chemin fait depuis le départ (m) et abscisse au pas d'avant. */
  parcouru: number;
  sAvant: number;
  /** NOS envoyés depuis le départ. */
  nosEnvois: number;
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
    input: { auto: false, throttle: 0, brake: 0, lane: 0, assist: true, nos: 0 },
    pose: createPose(),
    nosPoints: pointsNos(pilot.line, niveau.nos, reglage.nosRayon),
    parcouru: 0,
    sAvant: 0,
    nosEnvois: 0,
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
  p.parcouru = 0;
  p.sAvant = s;
  p.nosEnvois = 0;
  // Réserve pleine à chaque départ : même course, même niveau, même résultat.
  p.pilot.train.nosReserve = 1;
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
    const s = pilot.motion.s;
    const grip = pilot.performance.grip * pilot.adherence * SIMULATION.marge;
    const frein = PILOT.manual.brake * pilot.adherence;
    // Il freine le plus tard possible : seulement si la conduite de référence freinerait ici, ET si sa
    // trajectoire, à son allure et à son audace, l'exige (la plus haute des deux vitesses tenables).
    // À côté du joueur (un côté choisi, src/drive/adversaire/contact.ts), il ne joue pas avec le bord.
    const audace = p.lane === 0 ? n.audace : Math.min(1, n.audace);
    const route = vitesseTenable(pilot, s, v, grip, frein * SIMULATION.frein, p.pose);
    const tenable = audace > 0 ? Math.max(route, vitesseTenableLigne(pilot, s, v, grip * audace, frein * n.freinage)) : route;
    const freine = v > tenable;
    const pointe = a < 1 && v >= (a * pilot.performance.topKmh) / 3.6;
    // Sous son allure, il accélère moins fort (le gaz à a).
    p.input.throttle = freine || pointe ? 0 : a;
    // À fond quand il freine, comme la référence (le frein monte en une demi-seconde : à coups d'un dixième, il
    // ne mord qu'en partie ; la vitesse de passage de la référence, c'est ce qu'elle roule ainsi).
    p.input.brake = freine ? 1 : 0;
  }
  p.input.lane = p.lane;
  const motion = pilot.step(pas, p.input, pilot.performance.kind);
  p.vitesse = motion.speed;
  p.parcouru += motion.speed * pas;
  // NOS : au point passé, s'il accélère et qu'il a fait assez de chemin (le pilote garde sa réserve).
  if (!tenu && p.input.brake === 0 && p.parcouru >= p.reglage.nosDepart) {
    const pts = p.nosPoints;
    for (let i = 0; i < pts.length; i += 1) {
      if (!passe(p.sAvant, motion.s, pts[i]!, rail.length, rail.loop)) continue;
      p.input.nos = (p.input.nos ?? 0) + 1;
      p.nosEnvois += 1;
      break;
    }
  }
  p.sAvant = motion.s;
  return motion;
}
