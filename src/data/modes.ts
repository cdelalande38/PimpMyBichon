// Les modes de l'écran « Jouer » (vague X, 21 novembre 2026) : une carte par mode, avec une ligne qui dit ce
// qu'on y gagne. Ajouter un mode (le rodéo, prévu), c'est une ligne ici et un pictogramme dans
// src/ui/drive/entree/PictosModes.tsx ; une entrée `disponible: false` garde sa place sans carte à l'écran.
// Un mode règle le format de la sortie (src/data/courses.ts) et le duel (src/drive/adversaire/choix.ts) :
// `formatDuMode`, `modeDe` (logique pure, testée dans tests/unit/entree-sortie.test.ts).

import type { FormatCourse } from '../jeu/contrat.ts';

export type ModeId = 'carriere' | 'course' | 'duel' | 'drift' | 'balade' | 'rodeo';

export interface ModeJeu {
  id: ModeId;
  label: string;
  /** Ce qu'on y gagne, en une ligne courte (une ligne de la colonne du paysage, sans être coupée). */
  aide: string;
  /** Faux : la place est prévue, aucune carte n'est montrée tant que le mode n'existe pas. */
  disponible: boolean;
}

export const MODES_JEU: readonly ModeJeu[] = [
  { id: 'carriere', label: 'Carrière', aide: 'Des épreuves et des primes', disponible: true },
  { id: 'course', label: 'Course', aide: 'Chrono, médailles, dollars', disponible: true },
  { id: 'duel', label: 'Duel', aide: 'Un pilote à battre, des dollars', disponible: true },
  { id: 'drift', label: 'Drift', aide: 'Des points à chaque glisse', disponible: true },
  { id: 'balade', label: 'Balade', aide: 'Pour le plaisir, sans gain', disponible: true },
  { id: 'rodeo', label: 'Rodéo', aide: 'Accélération en ligne droite', disponible: false },
];

/** Formats que le mode « Course » couvre : un tour, ou trois. */
const FORMATS_COURSE: readonly FormatCourse[] = ['tour1', 'tours3'];

/** Format qu'un mode de sortie règle ; la course garde un format de course déjà choisi (1 ou 3 tours), le duel se court en un tour. */
export function formatDuMode(mode: Exclude<ModeId, 'carriere' | 'rodeo'>, actuel: FormatCourse): FormatCourse {
  if (mode === 'balade' || mode === 'drift') return mode;
  if (mode === 'duel') return 'tour1';
  return FORMATS_COURSE.includes(actuel) ? actuel : 'tour1';
}

/** Mode de sortie que dit le format choisi (et le duel) : l'inverse de `formatDuMode`. */
export function modeDe(format: FormatCourse, duel: boolean): Exclude<ModeId, 'carriere' | 'rodeo'> {
  if (duel) return 'duel';
  if (format === 'balade' || format === 'drift') return format;
  return 'course';
}
