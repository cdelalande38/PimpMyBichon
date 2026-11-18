// Clôture d'une course de carrière (src/jeu/carriere.ts pour les règles, src/data/carriere.ts pour la suite).
// Appelée par la sortie à l'arrivée d'une course lancée depuis le panneau de la carrière
// (src/state/drive.ts, `terminerCourse`), APRÈS la clôture ordinaire (src/jeu/bilan.ts) : la course a
// déjà compté pour les records, les dollars et les hauts faits comme une course libre du même format ;
// ici, une seule chose de plus : le rendez-vous est jugé, sa progression enregistrée, et sa prime (une
// fois) ajoutée au solde et au bilan, sur une ligne à elle. La carrière bouclée accorde son haut fait.
//
// Le verdict (réussi ou manqué, de combien, le rendez-vous suivant) accompagne le bilan rendu, pour
// l'écran de fin (src/ui/carriere/ProchainRendezVous.tsx) : `verdictDe(bilan)`.

import { CARRIERE, HAUT_FAIT_CARRIERE, rendezVousParId, type RendezVous } from '../data/carriere.ts';
import { indulgence, seuilsMedailles, tempsReference } from '../data/courses.ts';
import { HAUTS_FAITS } from '../data/hautsFaits.ts';
import { etatDe, useJeu } from '../state/jeu.ts';
import { carriereBouclee, enregistrerCourse, indexCourant, jugerRendezVous, primeDue, type Jugement } from './carriere.ts';
import { accorder } from './cloture.ts';
import type { Bilan, ResultatCourse } from './contrat.ts';
import { visible } from './hautsFaits.ts';

export interface VerdictRendezVous extends Jugement {
  rendezVous: RendezVous;
  /** Numéro du rendez-vous jugé (1 pour le premier). */
  numero: number;
  total: number;
  /** Vrai : le rendez-vous était déjà réussi avant cette course (pas de prime). */
  dejaReussi: boolean;
  /** Prime payée par cette course, en dollars (0 si manqué ou déjà réussi). */
  prime: number;
  /** Le rendez-vous courant après cette course ; `null` : la carrière est bouclée. */
  suivant: RendezVous | null;
  suivantNumero: number;
  /** Vrai : cette course vient de boucler la carrière. */
  bouclee: boolean;
}

const verdicts = new WeakMap<Bilan, VerdictRendezVous>();

/** Le verdict de carrière qui accompagne ce bilan ; `null` pour une course libre. */
export function verdictDe(bilan: Bilan | null | undefined): VerdictRendezVous | null {
  return bilan ? (verdicts.get(bilan) ?? null) : null;
}

/** Seuil du bronze (s) de cette course, véhicule et météo compris ; `null` sans temps de référence. */
export function seuilBronze(resultat: Pick<ResultatCourse, 'carte' | 'depart' | 'format' | 'vehicule' | 'meteo'>): number | null {
  const reference = tempsReference(resultat.carte, resultat.depart, resultat.format, resultat.vehicule);
  return reference === null ? null : seuilsMedailles(reference, indulgence(resultat.carte, resultat.meteo)).bronze;
}

/** Le motif de la ligne de prime, à l'écran de fin. */
export function motifPrime(numero: number): string {
  return `Prime du rendez-vous ${numero}`;
}

/**
 * Juge le rendez-vous `id` d'après le bilan de la course qui vient de finir, enregistre la progression
 * (et la prime) dans le jeu, et rend le bilan complété (prime, haut fait de la carrière bouclée). Sans
 * effet si le rendez-vous est inconnu. Ne lève jamais : en cas d'erreur, le bilan d'origine.
 */
export function conclureRendezVous(id: string, bilan: Bilan, carriere: readonly RendezVous[] = CARRIERE): Bilan {
  try {
    const rdv = rendezVousParId(id, carriere);
    if (!rdv) return bilan;
    const rang = carriere.indexOf(rdv);
    const jeu = useJeu.getState();
    const avant = jeu.carriere;
    const courant = indexCourant(avant, carriere);
    const jugement = jugerRendezVous(rdv, bilan.resultat, seuilBronze(bilan.resultat), rang, courant);
    const dejaReussi = avant.resultats[rdv.id]?.reussi === true;
    // Une course hors du rendez-vous (pas encore ouvert, ou courue autrement) ne s'enregistre pas.
    const compte = jugement.raison !== 'pas-encore' && jugement.raison !== 'non-conforme';
    const apres = compte ? enregistrerCourse(avant, rdv, bilan.resultat, jugement.reussi) : avant;
    const prime = compte ? primeDue(avant, rdv, jugement.reussi) : 0;
    const bouclee = !carriereBouclee(avant, carriere) && carriereBouclee(apres, carriere);
    let etat = { ...etatDe(jeu), solde: jeu.solde + prime };
    const def = bouclee ? HAUTS_FAITS.find((h) => h.id === HAUT_FAIT_CARRIERE && !etat.hautsFaits[h.id]) : undefined;
    let deblocages = bilan.deblocages;
    if (def) {
      const accorde = accorder(etat, [def]);
      etat = accorde.etat;
      deblocages = [...deblocages, ...accorde.deblocages];
    }
    useJeu.setState({ ...etat, carriere: apres });
    const suivantIndex = indexCourant(apres, carriere);
    const complet: Bilan = {
      ...bilan,
      gains: prime > 0 ? { dollars: bilan.gains.dollars + prime, detail: [...bilan.gains.detail, { motif: motifPrime(rang + 1), dollars: prime }] } : bilan.gains,
      solde: etat.solde,
      hautsFaits: def ? [...bilan.hautsFaits, visible(def)] : bilan.hautsFaits,
      deblocages,
    };
    verdicts.set(complet, {
      ...jugement,
      rendezVous: rdv,
      numero: rang + 1,
      total: carriere.length,
      dejaReussi,
      prime,
      suivant: carriere[suivantIndex] ?? null,
      suivantNumero: suivantIndex + 1,
      bouclee,
    });
    return complet;
  } catch {
    return bilan;
  }
}
