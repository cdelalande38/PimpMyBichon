// Clôture d'un duel (§ 5.5, jeu), appelée par la scène à l'arrivée du joueur APRÈS la clôture ordinaire
// (src/state/drive.ts, `terminerCourse`) : la course a compté comme une course d'un tour (records, dollars,
// hauts faits). Ici, le verdict s'ajoute : la victoire rapporte selon le niveau (src/data/economie.ts,
// ECONOMIE_DUEL, au palier de gains du niveau couru) ; battre un niveau pour la première fois verse sa prime et accorde son haut fait (un
// sticker ; src/data/hautsFaits.ts), une seule fois. Le verdict accompagne le bilan pour l'écran de fin
// (`verdictDuelDe`). Ne lève jamais : en cas d'erreur, le bilan d'origine.

import type { Adversaire, NiveauDuel } from '../../data/adversaires.ts';
import { ECONOMIE_DUEL, MOTIFS_DUEL } from '../../data/economie.ts';
import { HAUTS_FAITS } from '../../data/hautsFaits.ts';
import { accorder } from '../../jeu/cloture.ts';
import type { Bilan, LigneGain } from '../../jeu/contrat.ts';
import { visible } from '../../jeu/hautsFaits.ts';
import { etatDe, useJeu } from '../../state/jeu.ts';
import type { VerdictDuel } from './duel.ts';

export interface VerdictDuelBilan extends VerdictDuel {
  adversaire: Adversaire;
  niveau: NiveauDuel;
  /** Dollars de la victoire et de la prime versés par ce duel. */
  victoire: number;
  prime: number;
}

const verdicts = new WeakMap<Bilan, VerdictDuelBilan>();

/** Le verdict du duel qui accompagne ce bilan ; `null` hors duel. */
export function verdictDuelDe(bilan: Bilan | null | undefined): VerdictDuelBilan | null {
  return bilan ? (verdicts.get(bilan) ?? null) : null;
}

/** Haut fait d'un palier de gains battu (src/data/hautsFaits.ts) : ses identifiants n'ont pas changé, les premières victoires déjà gagnées restent acquises. */
export function hautFaitDuel(palier: NiveauDuel['gains']): string {
  return `duel-${palier}`;
}

export function conclureDuel(adversaire: Adversaire, niveau: NiveauDuel, verdict: VerdictDuel, bilan: Bilan): Bilan {
  try {
    const jeu = useJeu.getState();
    let etat = etatDe(jeu);
    const id = hautFaitDuel(niveau.gains);
    const victoire = verdict.gagne ? ECONOMIE_DUEL.victoire[niveau.gains] : 0;
    const premiere = verdict.gagne && !etat.hautsFaits[id];
    const prime = premiere ? ECONOMIE_DUEL.prime[niveau.gains] : 0;
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
    if (victoire > 0) lignes.push({ motif: `${MOTIFS_DUEL.victoire} contre ${adversaire.nom} (${niveau.label})`, dollars: victoire });
    if (prime > 0) lignes.push({ motif: MOTIFS_DUEL.prime, dollars: prime });
    const complet: Bilan = {
      ...bilan,
      gains: lignes.length > 0 ? { dollars: bilan.gains.dollars + victoire + prime, detail: [...bilan.gains.detail, ...lignes] } : bilan.gains,
      solde: etat.solde,
      hautsFaits: def ? [...bilan.hautsFaits, visible(def)] : bilan.hautsFaits,
      deblocages,
    };
    verdicts.set(complet, { ...verdict, adversaire, niveau, victoire, prime });
    return complet;
  } catch {
    return bilan;
  }
}
