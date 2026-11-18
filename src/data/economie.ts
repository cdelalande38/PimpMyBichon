// Ce que rapporte une course, en dollars (§ 5.5, jeu : courses, dollars et hauts faits). Tout est ici,
// en données : `calculerGains` (src/jeu/gains.ts) lit ce tableau et ne connaît aucun chiffre.
//
// Les prix de la boutique (src/data/boutique.ts) sont réglés d'après ces gains : une course d'un tour finie
// sans choc rapporte 60 $ au minimum, 100 $ avec une médaille d'or ; un premier pack coûte donc environ
// deux à trois courses, le dernier une dizaine. Les hauts faits (src/data/hautsFaits.ts) ajoutent des
// dollars par-dessus, une seule fois chacun.

import type { FormatCourse, Medaille, MeteoCourse } from '../jeu/contrat.ts';

/** Formats qui rapportent ; la balade n'a ni chrono ni gain. */
export type FormatPaye = Exclude<FormatCourse, 'balade'>;

export interface BaremeFormat {
  /** Course menée jusqu'à la ligne d'arrivée. */
  base: number;
  /** Bonus d'une médaille, selon sa couleur. */
  medaille: Readonly<Record<Medaille, number>>;
  /** Record personnel battu (il faut qu'il y ait eu un temps avant). */
  record: number;
  /** Aucun choc contre le bord de la route. */
  sansChoc: number;
  /** Rouler sous la pluie ou la neige paie plus : l'adhérence se mérite. Le sec ne paie rien de plus. */
  meteo: Readonly<Record<MeteoCourse, number>>;
}

export const ECONOMIE: Readonly<Record<FormatPaye, BaremeFormat>> = {
  tour1: {
    base: 40,
    medaille: { bronze: 15, argent: 30, or: 60 },
    record: 25,
    sansChoc: 20,
    meteo: { sec: 0, pluie: 10, neige: 20 },
  },
  tours3: {
    base: 110,
    medaille: { bronze: 25, argent: 50, or: 100 },
    record: 40,
    sansChoc: 50,
    meteo: { sec: 0, pluie: 25, neige: 50 },
  },
};

/** Motifs affichés à l'écran de fin, un par ligne de gain. */
export const MOTIFS_GAIN = {
  base: { tour1: 'Course d’un tour finie', tours3: 'Course de trois tours finie' },
  medaille: { or: 'Médaille d’or', argent: 'Médaille d’argent', bronze: 'Médaille de bronze' },
  record: 'Record battu',
  sansChoc: 'Aucun choc contre le bord de la route',
  meteo: { sec: '', pluie: 'Course sous la pluie', neige: 'Course sous la neige' },
} as const;
