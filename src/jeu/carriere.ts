// Les règles du mode carrière : un cœur pur, sans navigateur ni store (testé dans tests/unit/carriere.test.ts).
// La suite des rendez-vous est dans src/data/carriere.ts ; la progression se sauvegarde avec le jeu
// (src/state/jeu.ts) ; l'enregistrement d'une course de carrière est dans src/jeu/carriereCloture.ts.
//
// - Le rendez-vous courant est le premier de la suite qui n'est pas réussi : la progression ne recule
//   jamais, un abandon ou un retour au garage ne fait rien perdre, on retente autant qu'on veut.
// - Une course de carrière finie se juge sur l'objectif : « finir » passe dès la ligne franchie ; « bronze »,
//   « argent », « or » veulent cette médaille au moins (les seuils de src/data/courses.ts, véhicule et météo
//   compris). Elle doit avoir été courue telle que le rendez-vous l'impose (carte, départ, format, météo,
//   moment, famille du véhicule) ; sinon elle ne compte pas. Une contrainte manquée (NOS poussé, bord
//   touché) fait manquer le rendez-vous : l'essai compte, ni le temps ni la médaille.
// - Saisons (vague V) : la progression suit la suite de TOUS les rendez-vous, saison après saison ; une
//   saison s'ouvre quand la précédente est bouclée. Elle reste rangée par identifiant de rendez-vous :
//   une sauvegarde d'avant les saisons (les douze rendez-vous de la saison 1, mêmes identifiants) se relit
//   telle quelle, saison 1 bouclée ou en cours, records compris (`nettoyerProgression`).
// - La prime se paie une seule fois, au premier passage réussi ; rejouer un rendez-vous déjà réussi
//   enregistre le temps, sans prime ; un rendez-vous plus loin que le courant ne se valide pas.

import type { Medaille, ResultatCourse } from './contrat.ts';
import type { ContrainteRendezVous, RendezVous, Saison } from '../data/carriere.ts';

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

/**
 * Lecture tolérante d'une progression sauvegardée : ce qui est abîmé s'oublie, une sauvegarde sans carrière
 * part de zéro. Migration vers les saisons (vague V) : rien à réécrire, la saison 1 garde les identifiants
 * d'origine ; les résultats d'un rendez-vous retiré des données restent gardés (sans effet), au cas où il
 * reviendrait.
 */
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

/** Les rendez-vous d'une saison sont-ils tous réussis ? */
export function saisonBouclee(progression: ProgressionCarriere, saison: Pick<Saison, 'rendezVous'>): boolean {
  return saison.rendezVous.length > 0 && saison.rendezVous.every((rdv) => progression.resultats[rdv.id]?.reussi === true);
}

/** Tous les rendez-vous de la saison ont-ils l'or (meilleure médaille gardée) ? */
export function saisonEnOr(progression: ProgressionCarriere, saison: Pick<Saison, 'rendezVous'>): boolean {
  return saison.rendezVous.length > 0 && saison.rendezVous.every((rdv) => progression.resultats[rdv.id]?.reussi === true && progression.resultats[rdv.id]?.medaille === 'or');
}

/** Une saison est ouverte quand toutes celles d'avant sont bouclées (la première l'est toujours). */
export function saisonOuverte(progression: ProgressionCarriere, saisons: readonly Saison[], index: number): boolean {
  return index >= 0 && index < saisons.length && saisons.slice(0, index).every((saison) => saisonBouclee(progression, saison));
}

/** Rang de la saison en cours : la première pas bouclée ; la dernière quand tout est bouclé. */
export function indexSaisonCourante(progression: ProgressionCarriere, saisons: readonly Saison[]): number {
  const index = saisons.findIndex((saison) => !saisonBouclee(progression, saison));
  return index < 0 ? Math.max(0, saisons.length - 1) : index;
}

/** Rang (0 pour la plus basse) de ce qu'exige un objectif ; « finir » : 0. */
const RANG_OBJECTIF = { finir: 0, bronze: 1, argent: 2, or: 3 } as const;

export type EcartRendezVous = 'carte' | 'depart' | 'format' | 'meteo' | 'moment' | 'vehicule';

/** Famille d'un véhicule : `kind` de son manifeste (`null` : inconnu, la contrainte de famille n'est pas tenue). */
export type FamilleVehicule = 'car' | 'bike' | null;

/** Ce qui, dans la course courue, ne correspond pas au rendez-vous (vide : conforme). */
export function ecartsAuRendezVous(rdv: RendezVous, resultat: Pick<ResultatCourse, 'carte' | 'depart' | 'format' | 'meteo' | 'moment'>, famille: FamilleVehicule = null): EcartRendezVous[] {
  const ecarts: EcartRendezVous[] = [];
  if (resultat.carte !== rdv.carte) ecarts.push('carte');
  if (resultat.depart !== rdv.depart) ecarts.push('depart');
  if (resultat.format !== rdv.format) ecarts.push('format');
  if (resultat.meteo !== rdv.meteo) ecarts.push('meteo');
  if (resultat.moment !== rdv.moment) ecarts.push('moment');
  if ((rdv.contraintes.includes('moto') && famille !== 'bike') || (rdv.contraintes.includes('voiture') && famille !== 'car')) ecarts.push('vehicule');
  return ecarts;
}

/** Contraintes de conduite manquées (NOS poussé, bord touché) ; la famille du véhicule est un écart, pas une faute. */
export function contraintesManquees(rdv: Pick<RendezVous, 'contraintes'>, resultat: Pick<ResultatCourse, 'stats'>): ContrainteRendezVous[] {
  const manquees: ContrainteRendezVous[] = [];
  if (rdv.contraintes.includes('sans-nos') && resultat.stats.nos > 0) manquees.push('sans-nos');
  if (rdv.contraintes.includes('sans-choc') && resultat.stats.chocs > 0) manquees.push('sans-choc');
  return manquees;
}

export type RaisonVerdict = 'fini' | 'medaille' | 'trop-lent' | 'contrainte' | 'non-conforme' | 'pas-encore';

export interface Jugement {
  reussi: boolean;
  raison: RaisonVerdict;
  /** Objectif de médaille manqué : le seuil de la médaille visée, en secondes ; `null` sinon. */
  seuil: number | null;
  /** Objectif de médaille manqué : secondes de trop (positif) ; `null` sinon. */
  ecart: number | null;
  /** Course non conforme : ce qui ne correspondait pas. */
  ecarts: readonly EcartRendezVous[];
  /** Contraintes manquées (raison « contrainte »). */
  manquees: readonly ContrainteRendezVous[];
}

/**
 * Juge une course finie au regard d'un rendez-vous. `seuilObjectif` (s) : le seuil de la médaille visée pour
 * cette course (véhicule et météo compris), `null` sans temps de référence ; `rang` : le rang du rendez-vous
 * dans la suite, `courant` : celui du rendez-vous courant (un rendez-vous plus loin ne se valide pas) ;
 * `famille` : celle du véhicule couru (contraintes « moto », « voiture »).
 */
export function jugerRendezVous(rdv: RendezVous, resultat: ResultatCourse, seuilObjectif: number | null, rang = 0, courant = 0, famille: FamilleVehicule = null): Jugement {
  const rien = { seuil: null, ecart: null, ecarts: [] as EcartRendezVous[], manquees: [] as ContrainteRendezVous[] };
  if (rang > courant) return { ...rien, reussi: false, raison: 'pas-encore' };
  const ecarts = ecartsAuRendezVous(rdv, resultat, famille);
  if (ecarts.length > 0) return { ...rien, reussi: false, raison: 'non-conforme', ecarts };
  const manquees = contraintesManquees(rdv, resultat);
  if (manquees.length > 0) return { ...rien, reussi: false, raison: 'contrainte', manquees };
  if (rdv.objectif === 'finir') return { ...rien, reussi: true, raison: 'fini' };
  if (resultat.medaille !== null && RANG[resultat.medaille] >= RANG_OBJECTIF[rdv.objectif]) return { ...rien, reussi: true, raison: 'medaille' };
  const seuil = seuilObjectif !== null && Number.isFinite(seuilObjectif) && seuilObjectif > 0 ? seuilObjectif : null;
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
