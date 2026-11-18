// Hauteur du regard à la caméra embarquée de la sortie (vague U, demande du 18 novembre 2026 : « on voit
// pas assez la route, il faudrait qu'on puisse prendre un peu plus de hauteur »). Un réglage du joueur,
// dans les réglages de la sortie (rubrique Vue), gardé avec ses préférences (src/state/drive.ts).
//
// Chaque cran est une part du débattement de l'œil (src/drive/cameras.ts, COCKPIT) : 0 laisse l'œil de
// conduite du manifeste (interiorView.conduite), 1 le monte au plus haut que permet le pavillon mesuré
// au-dessus de lui (voiture) ou que permet le cadre (moto : au-dessus du réservoir), −1 le descend au plus
// bas encore jouable.

export type RegardId = 'bas' | 'normal' | 'haut' | 'tres-haut';

export interface Regard {
  id: RegardId;
  label: string;
  /** Part du débattement, de −1 (au plus bas) à 1 (au plus haut). */
  part: number;
}

export const REGARDS: readonly Regard[] = [
  { id: 'bas', label: 'Bas', part: -1 },
  { id: 'normal', label: 'Normal', part: 0 },
  { id: 'haut', label: 'Haut', part: 0.5 },
  { id: 'tres-haut', label: 'Très haut', part: 1 },
];

export const REGARD_PAR_DEFAUT: RegardId = 'normal';

export const estRegard = (value: unknown): value is RegardId => REGARDS.some((regard) => regard.id === value);

/** Part du débattement d'un cran (0 pour un cran inconnu). */
export function partDuRegard(id: RegardId | null | undefined): number {
  return REGARDS.find((regard) => regard.id === id)?.part ?? 0;
}
