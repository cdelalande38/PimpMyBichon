// Les règles du mode carrière : un cœur pur, sans navigateur ni store (testé dans tests/unit/carriere.test.ts).
// La suite des rendez-vous est dans src/data/carriere.ts ; la progression se sauvegarde avec le jeu
// (src/state/jeu.ts) ; l'enregistrement d'une course de carrière est dans src/jeu/carriereCloture.ts.
//
// - Le rendez-vous courant est le premier de la suite qui n'est pas réussi : la progression ne recule
//   jamais, un abandon ou un retour au garage ne fait rien perdre, on retente autant qu'on veut.
// - Une course de carrière finie se juge sur l'objectif : « finir » passe dès la ligne franchie ; « bronze »
//   veut une médaille (les seuils de src/data/courses.ts, météo comprise). Elle doit avoir été courue telle
//   que le rendez-vous l'impose (carte, départ, format, météo, moment) ; sinon elle ne compte pas.
// - La prime se paie une seule fois, au premier passage réussi ; rejouer un rendez-vous déjà réussi
//   enregistre le temps, sans prime ; un rendez-vous plus loin que le courant ne se valide pas.

import type { Medaille, ResultatCourse } from './contrat.ts';
import type { RendezVous } from '../data/carriere.ts';

/** Ce que la carrière garde d'un rendez-vous. */
export interface ResultatRendezVous {
  reussi: boolean;
  /** Courses finies sur ce rendez-vous (réussies ou non). */
  essais: number;
  /** Meilleur temps, en secondes ; `null` sans course finie. */
  meilleurTemps: number | null;
  /** Meilleure médaille ; `null` sans médaille. */
  medaille: Medaille | null;
}

export interface ProgressionCarriere {
  /** Par identifiant de rendez-vous (src/data/carriere.ts). */
  resultats: Record<string, ResultatRendezVous>;
}

export function progressionVide(): ProgressionCarriere {
  return { resultats: {} };
}

const IDENTIFIANT = /^[a-z0-9][a-z0-9-]{0,47}$/;
const RESULTATS_MAX = 200;
const ESSAIS_MAX = 1_000_000;
const RANG: Readonly<Record<Medaille, number>> = { bronze: 1, argent: 2, or: 3 };

function medailleOuNull(value: unknown): Medaille | null {
  return value === 'or' || value === 'argent' || value === 'bronze' ? value : null;
}

/** Lecture tolérante d'une progression sauvegardée : ce qui est abîmé s'oublie, une sauvegarde sans carrière part de zéro. */
export function nettoyerProgression(brut: unknown): ProgressionCarriere {
  const source = typeof brut === 'object' && brut !== null && !Array.isArray(brut) ? (brut as Record<string, unknown>) : {};
  const resultats = typeof source.resultats === 'object' && source.resultats !== null && !Array.isArray(source.resultats) ? (source.resultats as Record<string, unknown>) : {};
  const sortie: Record<string, ResultatRendezVous> = {};
  let n = 0;
  for (const id of Object.keys(resultats)) {
    if (n >= RESULTATS_MAX) break;
    const r = resultats[id];
    if (!IDENTIFIANT.test(id) || typeof r !== 'object' || r === null || Array.isArray(r)) continue;
    const v = r as Record<string, unknown>;
    const temps = typeof v.meilleurTemps === 'number' && Number.isFinite(v.meilleurTemps) && v.meilleurTemps > 0 ? v.meilleurTemps : null;
    const essais = typeof v.essais === 'number' && Number.isFinite(v.essais) && v.essais > 0 ? Math.min(ESSAIS_MAX, Math.floor(v.essais)) : 0;
    sortie[id] = { reussi: v.reussi === true, essais, meilleurTemps: temps, medaille: medailleOuNull(v.medaille) };
    n += 1;
  }
  return { resultats: sortie };
}

/** Rang du rendez-vous courant dans la suite (0 pour le premier) ; la longueur de la suite quand tout est réussi. */
export function indexCourant(progression: ProgressionCarriere, carriere: readonly RendezVous[]): number {
  const index = carriere.findIndex((rdv) => progression.resultats[rdv.id]?.reussi !== true);
  return index < 0 ? carriere.length : index;
}

/** Le rendez-vous courant, ou `null` quand la carrière est bouclée (ou vide). */
export function rendezVousCourant(progression: ProgressionCarriere, carriere: readonly RendezVous[]): RendezVous | null {
  return carriere[indexCourant(progression, carriere)] ?? null;
}

/** Rendez-vous réussis. */
export function nombreReussis(progression: ProgressionCarriere, carriere: readonly RendezVous[]): number {
  return carriere.filter((rdv) => progression.resultats[rdv.id]?.reussi === true).length;
}

export function carriereBouclee(progression: ProgressionCarriere, carriere: readonly RendezVous[]): boolean {
  return carriere.length > 0 && indexCourant(progression, carriere) >= carriere.length;
}

export type EcartRendezVous = 'carte' | 'depart' | 'format' | 'meteo' | 'moment';

/** Ce qui, dans la course courue, ne correspond pas au rendez-vous (vide : conforme). */
export function ecartsAuRendezVous(rdv: RendezVous, resultat: Pick<ResultatCourse, 'carte' | 'depart' | 'format' | 'meteo' | 'moment'>): EcartRendezVous[] {
  const ecarts: EcartRendezVous[] = [];
  if (resultat.carte !== rdv.carte) ecarts.push('carte');
  if (resultat.depart !== rdv.depart) ecarts.push('depart');
  if (resultat.format !== rdv.format) ecarts.push('format');
  if (resultat.meteo !== rdv.meteo) ecarts.push('meteo');
  if (resultat.moment !== rdv.moment) ecarts.push('moment');
  return ecarts;
}

export type RaisonVerdict = 'fini' | 'medaille' | 'trop-lent' | 'non-conforme' | 'pas-encore';

export interface Jugement {
  reussi: boolean;
  raison: RaisonVerdict;
  /** Objectif « bronze » manqué : le seuil du bronze, en secondes ; `null` sinon. */
  seuil: number | null;
  /** Objectif « bronze » manqué : secondes de trop (positif) ; `null` sinon. */
  ecart: number | null;
  /** Course non conforme : ce qui ne correspondait pas. */
  ecarts: readonly EcartRendezVous[];
}

/**
 * Juge une course finie au regard d'un rendez-vous. `seuilBronze` (s) : le seuil du bronze pour cette course
 * (véhicule et météo compris), `null` sans temps de référence ; `rang` : le rang du rendez-vous dans la suite,
 * `courant` : celui du rendez-vous courant (un rendez-vous plus loin ne se valide pas).
 */
export function jugerRendezVous(rdv: RendezVous, resultat: ResultatCourse, seuilBronze: number | null, rang = 0, courant = 0): Jugement {
  const rien = { seuil: null, ecart: null, ecarts: [] as EcartRendezVous[] };
  if (rang > courant) return { ...rien, reussi: false, raison: 'pas-encore' };
  const ecarts = ecartsAuRendezVous(rdv, resultat);
  if (ecarts.length > 0) return { ...rien, reussi: false, raison: 'non-conforme', ecarts };
  if (rdv.objectif === 'finir') return { ...rien, reussi: true, raison: 'fini' };
  if (resultat.medaille !== null) return { ...rien, reussi: true, raison: 'medaille' };
  const seuil = seuilBronze !== null && Number.isFinite(seuilBronze) && seuilBronze > 0 ? seuilBronze : null;
  return { ...rien, reussi: false, raison: 'trop-lent', seuil, ecart: seuil === null ? null : Math.max(0, resultat.temps - seuil) };
}

/** La progression après une course de carrière finie (essai compté, meilleur temps et meilleure médaille gardés). */
export function enregistrerCourse(progression: ProgressionCarriere, rdv: RendezVous, resultat: Pick<ResultatCourse, 'temps' | 'medaille'>, reussi: boolean): ProgressionCarriere {
  const avant = progression.resultats[rdv.id];
  const temps = Number.isFinite(resultat.temps) && resultat.temps > 0 ? resultat.temps : null;
  const meilleurTemps = avant?.meilleurTemps != null && temps !== null ? Math.min(avant.meilleurTemps, temps) : (temps ?? avant?.meilleurTemps ?? null);
  const medailles = [avant?.medaille ?? null, resultat.medaille].filter((m): m is Medaille => m !== null);
  const medaille = medailles.sort((a, b) => RANG[b] - RANG[a])[0] ?? null;
  return {
    resultats: {
      ...progression.resultats,
      [rdv.id]: { reussi: reussi || avant?.reussi === true, essais: Math.min(ESSAIS_MAX, (avant?.essais ?? 0) + 1), meilleurTemps, medaille },
    },
  };
}

/** Prime due pour cette course : celle du rendez-vous, au premier passage réussi seulement. */
export function primeDue(avant: ProgressionCarriere, rdv: RendezVous, reussi: boolean): number {
  return reussi && avant.resultats[rdv.id]?.reussi !== true ? Math.max(0, Math.floor(rdv.prime)) : 0;
}
