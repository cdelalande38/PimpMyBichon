// Clôture d'un duel (§ 5.5, jeu), appelée par la scène à l'arrivée du joueur APRÈS la clôture ordinaire
// (src/state/drive.ts, `terminerCourse`) : la course a compté comme une course d'un tour (records, dollars,
// hauts faits). Ici, le verdict s'ajoute : la victoire rapporte selon le niveau (src/data/economie.ts,
// ECONOMIE_DUEL) ; battre un niveau pour la première fois verse sa prime et accorde son haut fait (un
// sticker ; src/data/hautsFaits.ts), une seule fois. Le verdict accompagne le bilan pour l'écran de fin
// (`verdictDuelDe`). Ne lève jamais : en cas d'erreur, le bilan d'origine.

import type { Adversaire } from '../../data/adversaires.ts';
import { ECONOMIE_DUEL, MOTIFS_DUEL } from '../../data/economie.ts';
import { HAUTS_FAITS } from '../../data/hautsFaits.ts';
import { accorder } from '../../jeu/cloture.ts';
import type { Bilan, LigneGain } from '../../jeu/contrat.ts';
import { visible } from '../../jeu/hautsFaits.ts';
import { etatDe, useJeu } from '../../state/jeu.ts';
import type { VerdictDuel } from './duel.ts';

export interface VerdictDuelBilan extends VerdictDuel {
  adversaire: Adversaire;
  /** Dollars de la victoire et de la prime versés par ce duel. */
  victoire: number;
  prime: number;
}

const verdicts = new WeakMap<Bilan, VerdictDuelBilan>();

/** Le verdict du duel qui accompagne ce bilan ; `null` hors duel. */
export function verdictDuelDe(bilan: Bilan | null | undefined): VerdictDuelBilan | null {
  return bilan ? (verdicts.get(bilan) ?? null) : null;
}

/** Haut fait d'un niveau battu (src/data/hautsFaits.ts). */
export function hautFaitDuel(niveau: Adversaire['niveau']): string {
  return `duel-${niveau}`;
}

export function conclureDuel(adversaire: Adversaire, verdict: VerdictDuel, bilan: Bilan): Bilan {
  try {
    const jeu = useJeu.getState();
    let etat = etatDe(jeu);
    const id = hautFaitDuel(adversaire.niveau);
    const victoire = verdict.gagne ? ECONOMIE_DUEL.victoire[adversaire.niveau] : 0;
    const premiere = verdict.gagne && !etat.hautsFaits[id];
    const prime = premiere ? ECONOMIE_DUEL.prime[adversaire.niveau] : 0;
    etat = { ...etat, solde: etat.solde + victoire + prime };
    const def = premiere ? HAUTS_FAITS.find((h) => h.id === id) : undefined;
    let deblocages = bilan.deblocages;
    if (def) {
      const accorde = accorder(etat, [def]);
      etat = accorde.etat;
      deblocages = [...deblocages, ...accorde.deblocages];
    }
    if (victoire + prime > 0 || def) useJeu.setState({ ...etat });
    const lignes: LigneGain[] = [];
    if (victoire > 0) lignes.push({ motif: `${MOTIFS_DUEL.victoire} contre ${adversaire.nom}`, dollars: victoire });
    if (prime > 0) lignes.push({ motif: MOTIFS_DUEL.prime, dollars: prime });
    const complet: Bilan = {
      ...bilan,
      gains: lignes.length > 0 ? { dollars: bilan.gains.dollars + victoire + prime, detail: [...bilan.gains.detail, ...lignes] } : bilan.gains,
      solde: etat.solde,
      hautsFaits: def ? [...bilan.hautsFaits, visible(def)] : bilan.hautsFaits,
      deblocages,
    };
    verdicts.set(complet, { ...verdict, adversaire, victoire, prime });
    return complet;
  } catch {
    return bilan;
  }
}
