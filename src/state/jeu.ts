// L'état du jeu : solde en dollars, articles acquis, hauts faits obtenus, compteurs cumulés. Sauvegardé
// dans IndexedDB sur le modèle des autres stores (lecture tolérante, fusion entre onglets par
// src/state/persistence.ts : les ensembles se fusionnent clé par clé, un nombre changé par une page
// remplace celui de la sauvegarde ; deux pages qui courent en même temps pourraient donc perdre
// un gain, ce qui n'arrive pas en pratique). Toute la logique est pure et vit dans src/jeu/.

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { HautFait } from '../jeu/contrat.ts';
import { acheterDans, possedeDans, type IssueAchat } from '../jeu/achats.ts';
import { nettoyerProgression, progressionVide, type ProgressionCarriere } from '../jeu/carriere.ts';
import { verifierCumuls } from '../jeu/cloture.ts';
import { etatVide, nettoyerEtat, type EtatJeu } from '../jeu/etat.ts';
import { visible } from '../jeu/hautsFaits.ts';
import { idbStorage, shareAcrossTabs } from './persistence.ts';

export const JEU_KEY = 'pmb-jeu';
export const JEU_VERSION = 1;

/** Ce qu'un achat réussi rapporte en plus : les hauts faits qu'il fait obtenir (« Premier achat »). */
export type ResultatAchat = IssueAchat & { hautsFaits?: readonly HautFait[] };

export interface JeuState extends EtatJeu {
  hydrated: boolean;
  /** Mode carrière (src/jeu/carriere.ts) : les rendez-vous réussis et leurs résultats ; remis à zéro avec le reste. */
  carriere: ProgressionCarriere;
  /** Remplace l'état du jeu (utilisé par la clôture d'une course, src/jeu/bilan.ts). */
  appliquer: (etat: EtatJeu) => void;
  /** Achète un article de la boutique ; l'état ne change que si l'achat réussit. */
  acheter: (id: string) => ResultatAchat;
  /** Remise à zéro de la progression (la remise à zéro de l'app). */
  remettreAZero: () => void;
}

/** Les champs sauvegardés d'un état (sans les fonctions ni `hydrated`). */
export function etatDe(state: EtatJeu): EtatJeu {
  return { solde: state.solde, articles: state.articles, hautsFaits: state.hautsFaits, cumuls: state.cumuls };
}

export const useJeu = create<JeuState>()(
  persist(
    (set, get) => ({
      ...etatVide(),
      carriere: progressionVide(),
      hydrated: false,
      appliquer: (etat) => set(etatDe(etat)),
      acheter: (id) => {
        const issue = acheterDans(etatDe(get()), id);
        if (!issue.ok) return issue;
        // Un achat peut faire obtenir un haut fait qui ne tient qu'aux cumuls (« Premier achat »).
        const suite = verifierCumuls(issue.etat);
        set(etatDe(suite.etat));
        return { ...issue, etat: suite.etat, hautsFaits: suite.hautsFaits.map(visible) };
      },
      remettreAZero: () => set({ ...etatVide(), carriere: progressionVide() }),
    }),
    {
      name: JEU_KEY,
      version: JEU_VERSION,
      storage: createJSONStorage(() => idbStorage),
      // La progression de la carrière voyage avec le jeu ; une sauvegarde d'avant la carrière part de zéro.
      partialize: (state) => ({ ...etatDe(state), carriere: state.carriere }),
      migrate: (persisted) => ({ ...nettoyerEtat(persisted), carriere: nettoyerProgression((persisted as { carriere?: unknown } | null)?.carriere) }),
      merge: (persisted, current) => ({ ...current, ...nettoyerEtat(persisted), carriere: nettoyerProgression((persisted as { carriere?: unknown } | null)?.carriere) }),
      onRehydrateStorage: () => () => {
        useJeu.setState({ hydrated: true });
      },
    },
  ),
);

shareAcrossTabs(useJeu);

/** Réactif : vrai si l'article est acquis (pour les écrans qui verrouillent ou déverrouillent un motif). */
export function usePossede(id: string): boolean {
  return useJeu((state) => possedeDans(state, id));
}
