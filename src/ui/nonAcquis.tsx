// Règle commune des options payantes posées sans être acquises (une sauvegarde gardée après la remise à
// zéro du jeu, un véhicule préparé ailleurs) : l'option reste posée tant qu'on ne la change pas, rien
// n'est retiré du véhicule ni acheté d'office. Sa puce garde son cadenas et son prix (un appui ouvre
// l'achat, comme pour toute option verrouillée) et le panneau le dit en clair sous la rangée, avec ce
// qu'il faudra payer pour y revenir après un autre choix. Même phrase partout : Phares, Échappement,
// pièces montées (Ailerons, Carrosserie), Moteur, Roues et Suspension.

import { dollars } from './jeu/libelles.ts';
import { Padlock } from './paint/Padlock.tsx';
import './nonAcquis.css';

/** La phrase, sans accord (l'option peut être un nom masculin, féminin ou pluriel). */
export function phraseNonAcquise(label: string, prix: number | null | undefined): string {
  return `« ${label} » reste en place sans achat : tant que tu n’y touches pas, rien ne change. Pour y revenir après un autre choix, compte ${dollars(prix ?? 0)}.`;
}

/** Libellé lu d'une puce posée mais pas acquise. */
export function nomNonAcquis(label: string, prix: number | null | undefined): string {
  return `${label}, en place sans achat, à débloquer pour ${dollars(prix ?? 0)}`;
}

export function NoteNonAcquise({ label, prix }: { label: string; prix: number | null | undefined }) {
  return (
    <p className="note-non-acquise" data-non-acquis="oui">
      <Padlock open={false} className="note-non-acquise-cadenas" />
      <span>{phraseNonAcquise(label, prix)}</span>
    </p>
  );
}
