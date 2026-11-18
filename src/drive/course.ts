// Suivi d'une course de la sortie (src/data/courses.ts) : ce que la scène mesure pendant qu'elle se court
// (`StatsCourse` du contrat du jeu, src/jeu/contrat.ts), et le résultat rendu à l'arrivée. Pur, sans
// allocation par image : la scène (src/drive/scene/moteur.ts) l'avance à chaque image, après le départ.
//
// - distance : mètres roulés (vitesse × temps), du vert à l'arrivée ;
// - vitesse la plus haute, en km/h ;
// - glisse : mètres roulés pendant que les pneus glissent franchement (`slip` ≥ 0,35) ou que l'arrière
//   décroche (dérive ≥ 0,12 rad, ≈ 7°) ;
// - chocs : contacts avec le bord de la route ; un frottement continu n'en fait qu'un, un nouveau choc
//   compte s'il vient au moins 0,5 s après la fin du précédent ;
// - NOS : poussées parties (le NOS s'allume).
//
// Le pilote automatique ne court pas : s'il prend le volant pendant une course (réglages, « Pilote
// automatique »), la course devient une balade (pas d'arrivée de course, pas de résultat).

import type { FormatCourse, MeteoCourse, MomentCourse, ResultatCourse, StatsCourse } from '../jeu/contrat.ts';
import type { DriveInput, DriveMotion } from './contrat.ts';
import { enCourse, type EtatDepart } from './depart.ts';

export const MESURES = {
  /** Glissement des pneus (0 à 1) au-delà duquel on glisse. */
  glisse: 0.35,
  /** Dérive de l'arrière (rad) au-delà de laquelle on glisse. */
  derive: 0.12,
  /** Un nouveau choc compte s'il vient ce temps (s) au moins après la fin du contact précédent. */
  ecartChocs: 0.5,
} as const;

export interface MesuresCourse extends StatsCourse {
  /** Contact au pas précédent. */
  contactAvant: boolean;
  /** Temps (s) depuis la fin du dernier contact. */
  libreDepuis: number;
  /** NOS allumé au pas précédent. */
  nosAvant: boolean;
}

export function createMesures(): MesuresCourse {
  return { distance: 0, vitesseMax: 0, glisse: 0, chocs: 0, nos: 0, contactAvant: false, libreDepuis: Infinity, nosAvant: false };
}

export function remettreMesures(m: MesuresCourse): MesuresCourse {
  m.distance = 0;
  m.vitesseMax = 0;
  m.glisse = 0;
  m.chocs = 0;
  m.nos = 0;
  m.contactAvant = false;
  m.libreDepuis = Infinity;
  m.nosAvant = false;
  return m;
}

/**
 * Un pas de `dt` s : `motion` du pilote après ce pas, `contact` (bord touché pendant le pas, ≠ 0),
 * `nosAllume` (le NOS pousse).
 */
export function pasMesures(m: MesuresCourse, dt: number, motion: Pick<DriveMotion, 'speed' | 'slip' | 'drift'>, contact: number, nosAllume: boolean): MesuresCourse {
  const pas = Number.isFinite(dt) && dt > 0 ? dt : 0;
  if (pas <= 0) return m;
  const v = Number.isFinite(motion.speed) ? Math.max(0, motion.speed) : 0;
  const d = v * pas;
  m.distance += d;
  const kmh = v * 3.6;
  if (kmh > m.vitesseMax) m.vitesseMax = kmh;
  if ((motion.slip ?? 0) >= MESURES.glisse || Math.abs(motion.drift ?? 0) >= MESURES.derive) m.glisse += d;
  const touche = contact !== 0 && Number.isFinite(contact);
  if (touche && !m.contactAvant && m.libreDepuis >= MESURES.ecartChocs) m.chocs += 1;
  if (touche) m.libreDepuis = 0;
  else m.libreDepuis += pas;
  m.contactAvant = touche;
  if (nosAllume && !m.nosAvant) m.nos += 1;
  m.nosAvant = nosAllume;
  return m;
}

/** Ce que la scène sait de la course à l'arrivée ; le store y ajoute le record d'avant et la médaille. */
export type CourseFinie = Omit<ResultatCourse, 'ancienRecord' | 'medaille'>;

/** Ce qu'il faut de la scène pour clore une course. */
export interface ContexteCourse {
  carte: string;
  depart: string;
  vehicule: string;
  format: FormatCourse;
  meteo: MeteoCourse;
  moment: MomentCourse;
}

/** Résultat d'une course arrivée (une seule allocation, à l'arrivée) ; `null` hors course. */
export function courseFinie(etat: EtatDepart, mesures: MesuresCourse, contexte: ContexteCourse): CourseFinie | null {
  if (!enCourse(etat) || etat.phase !== 'arrive' || etat.arrivee <= 0 || contexte.format === 'balade') return null;
  const tours: number[] = [];
  for (let i = 0; i < Math.min(etat.tours, etat.tempsTours.length); i += 1) tours.push((etat.tempsTours[i] ?? 0) / 1000);
  return {
    carte: contexte.carte,
    depart: contexte.depart,
    vehicule: contexte.vehicule,
    format: contexte.format,
    meteo: contexte.meteo,
    moment: contexte.moment,
    temps: etat.arrivee / 1000,
    tours,
    stats: { distance: mesures.distance, vitesseMax: mesures.vitesseMax, glisse: mesures.glisse, chocs: mesures.chocs, nos: mesures.nos },
  };
}

/**
 * Suivi tenu par la scène : mesures pendant la course (du vert à l'arrivée), course rendue en balade si le
 * pilote automatique prend le volant. Rien d'alloué par image.
 */
export class SuiviCourse {
  readonly mesures = createMesures();

  remettre(): void {
    remettreMesures(this.mesures);
  }

  /** Après le pas du départ : `input` du joueur, `motion` et `contact` du pilote, NOS allumé. */
  pas(etat: EtatDepart, dt: number, input: Pick<DriveInput, 'auto'>, motion: Pick<DriveMotion, 'speed' | 'slip' | 'drift'>, contact: number, nosAllume: boolean): void {
    if (!enCourse(etat) || etat.phase !== 'parti') return;
    if (input.auto) {
      // Le pilote automatique ne court pas : la course devient une balade.
      etat.toursCourse = 0;
      return;
    }
    pasMesures(this.mesures, dt, motion, contact, nosAllume);
  }
}
