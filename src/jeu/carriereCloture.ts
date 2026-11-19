// Clôture d'une course de carrière (src/jeu/carriere.ts pour les règles, src/data/carriere.ts pour la suite).
// Appelée par la sortie à l'arrivée d'une course lancée depuis le panneau de la carrière
// (src/state/drive.ts, `terminerCourse`), APRÈS la clôture ordinaire (src/jeu/bilan.ts) : la course a
// déjà compté pour les records, les dollars et les hauts faits comme une course libre du même format ;
// ici, une seule chose de plus : le rendez-vous est jugé, sa progression enregistrée, et sa prime (une
// fois) ajoutée au solde et au bilan, sur une ligne à elle. Une saison bouclée accorde son haut fait, une
// saison tout en or le sien (déclarés par la saison, dans les données).
//
// Le verdict (réussi ou manqué, de combien, le rendez-vous suivant) accompagne le bilan rendu, pour
// l'écran de fin (src/ui/carriere/ProchainRendezVous.tsx) : `verdictDe(bilan)`.

import { placeDe, SAISONS, type ObjectifRendezVous, type RendezVous, type Saison } from '../data/carriere.ts';
import { indulgence, seuilsMedailles, tempsReference } from '../data/courses.ts';
import { HAUTS_FAITS } from '../data/hautsFaits.ts';
import { vehicleById } from '../data/vehicles.ts';
import { etatDe, useJeu } from '../state/jeu.ts';
import { carriereBouclee, enregistrerCourse, indexCourant, jugerRendezVous, primeDue, saisonBouclee, saisonEnOr, type Jugement } from './carriere.ts';
import { accorder } from './cloture.ts';
import type { Bilan, ResultatCourse } from './contrat.ts';
import { visible } from './hautsFaits.ts';

export interface VerdictRendezVous extends Jugement {
  rendezVous: RendezVous;
  /** Numéro du rendez-vous jugé dans sa saison (1 pour le premier), et le nombre de rendez-vous de la saison. */
  numero: number;
  total: number;
  /** Numéro de sa saison (1 pour la première) et la saison. */
  saisonNumero: number;
  saison: Saison;
  /** Vrai : le rendez-vous était déjà réussi avant cette course (pas de prime). */
  dejaReussi: boolean;
  /** Prime payée par cette course, en dollars (0 si manqué ou déjà réussi). */
  prime: number;
  /** Le rendez-vous courant après cette course ; `null` : la carrière est bouclée. Numéro et total : dans sa saison. */
  suivant: RendezVous | null;
  suivantNumero: number;
  suivantTotal: number;
  /** Numéro de la saison du suivant (celle d'après quand cette course vient de boucler une saison). */
  suivantSaison: number;
  /** Vrai : cette course vient de boucler la saison du rendez-vous. */
  saisonBouclee: boolean;
  /** Vrai : cette course vient de boucler la carrière (la dernière saison). */
  bouclee: boolean;
}

const verdicts = new WeakMap<Bilan, VerdictRendezVous>();

/** Le verdict de carrière qui accompagne ce bilan ; `null` pour une course libre. */
export function verdictDe(bilan: Bilan | null | undefined): VerdictRendezVous | null {
  return bilan ? (verdicts.get(bilan) ?? null) : null;
}

/** Seuil (s) de la médaille visée par un objectif pour cette course, véhicule et météo compris ; `null` pour « finir » ou sans temps de référence. */
export function seuilObjectif(objectif: ObjectifRendezVous, resultat: Pick<ResultatCourse, 'carte' | 'depart' | 'format' | 'vehicule' | 'meteo'>): number | null {
  if (objectif === 'finir') return null;
  const reference = tempsReference(resultat.carte, resultat.depart, resultat.format, resultat.vehicule);
  return reference === null ? null : seuilsMedailles(reference, indulgence(resultat.carte, resultat.meteo))[objectif];
}

/** Le motif de la ligne de prime, à l'écran de fin (la saison dite à partir de la deuxième). */
export function motifPrime(numero: number, saison = 1): string {
  return saison > 1 ? `Prime du rendez-vous ${numero}, saison ${saison}` : `Prime du rendez-vous ${numero}`;
}

/**
 * Juge le rendez-vous `id` d'après le bilan de la course qui vient de finir, enregistre la progression
 * (et la prime) dans le jeu, et rend le bilan complété (prime, haut fait de la carrière bouclée). Sans
 * effet si le rendez-vous est inconnu. Ne lève jamais : en cas d'erreur, le bilan d'origine.
 */
export function conclureRendezVous(id: string, bilan: Bilan, saisons: readonly Saison[] = SAISONS): Bilan {
  try {
    const place = placeDe(id, saisons);
    if (!place) return bilan;
    const carriere = saisons.flatMap((s) => s.rendezVous);
    const rdv = place.saison.rendezVous[place.rang]!;
    const rang = carriere.indexOf(rdv);
    const jeu = useJeu.getState();
    const avant = jeu.carriere;
    const courant = indexCourant(avant, carriere);
    const kind = vehicleById(bilan.resultat.vehicule)?.kind ?? null;
    const jugement = jugerRendezVous(rdv, bilan.resultat, seuilObjectif(rdv.objectif, bilan.resultat), rang, courant, kind);
    const dejaReussi = avant.resultats[rdv.id]?.reussi === true;
    // Une course hors du rendez-vous (pas encore ouvert, ou courue autrement) ne s'enregistre pas ; une
    // contrainte manquée compte l'essai, sans le temps ni la médaille (ils ne valent pas pour ce rendez-vous).
    const compte = jugement.raison !== 'pas-encore' && jugement.raison !== 'non-conforme';
    const couru = jugement.raison === 'contrainte' ? { temps: Number.NaN, medaille: null } : bilan.resultat;
    const apres = compte ? enregistrerCourse(avant, rdv, couru, jugement.reussi) : avant;
    const prime = compte ? primeDue(avant, rdv, jugement.reussi) : 0;
    const bouclee = !carriereBouclee(avant, carriere) && carriereBouclee(apres, carriere);
    const saisonFinie = !saisonBouclee(avant, place.saison) && saisonBouclee(apres, place.saison);
    const enOr = !saisonEnOr(avant, place.saison) && saisonEnOr(apres, place.saison);
    let etat = { ...etatDe(jeu), solde: jeu.solde + prime };
    const ids = [saisonFinie ? place.saison.hautFait : undefined, enOr ? place.saison.hautFaitOr : undefined];
    const defs = HAUTS_FAITS.filter((h) => ids.includes(h.id) && !etat.hautsFaits[h.id]);
    let deblocages = bilan.deblocages;
    if (defs.length > 0) {
      const accorde = accorder(etat, defs);
      etat = accorde.etat;
      deblocages = [...deblocages, ...accorde.deblocages];
    }
    useJeu.setState({ ...etat, carriere: apres });
    const suivantIndex = indexCourant(apres, carriere);
    const suivant = carriere[suivantIndex] ?? null;
    const placeSuivant = suivant ? placeDe(suivant.id, saisons) : null;
    const complet: Bilan = {
      ...bilan,
      gains: prime > 0 ? { dollars: bilan.gains.dollars + prime, detail: [...bilan.gains.detail, { motif: motifPrime(place.rang + 1, place.indexSaison + 1), dollars: prime }] } : bilan.gains,
      solde: etat.solde,
      hautsFaits: defs.length > 0 ? [...bilan.hautsFaits, ...defs.map(visible)] : bilan.hautsFaits,
      deblocages,
    };
    verdicts.set(complet, {
      ...jugement,
      rendezVous: rdv,
      numero: place.rang + 1,
      total: place.saison.rendezVous.length,
      saisonNumero: place.indexSaison + 1,
      saison: place.saison,
      dejaReussi,
      prime,
      suivant,
      suivantNumero: (placeSuivant?.rang ?? 0) + 1,
      suivantTotal: placeSuivant?.saison.rendezVous.length ?? 0,
      suivantSaison: (placeSuivant?.indexSaison ?? place.indexSaison) + 1,
      saisonBouclee: saisonFinie,
      bouclee,
    });
    return complet;
  } catch {
    return bilan;
  }
}
