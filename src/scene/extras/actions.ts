// Ce qu'ouvre un point d'intérêt de la pièce : un panneau, ou une entrée du dock (rouvert s'il était
// fermé, src/state/dock.ts). Partagé par l'appui sur l'objet (scène) et par sa pastille (interface).

import { openSheet } from '../../app/useRoute.ts';
import type { PieceAction } from '../../data/pointsInteret.ts';
import { useDock } from '../../state/dock.ts';

export function runPieceAction(action: PieceAction): void {
  if (action.kind === 'panneau') openSheet({ name: action.sheet });
  else useDock.getState().openEntry(action.entry);
}

/** Appui sur le véhicule : Custom · Peinture, sur la zone touchée. */
export function openPaint(zone: string | undefined): void {
  useDock.getState().openEntry('peinture', zone);
}
