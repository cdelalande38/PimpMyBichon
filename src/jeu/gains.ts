// Les gains d'une course : un cœur pur. Les chiffres et les motifs viennent de src/data/economie.ts.

import { ECONOMIE, MOTIFS_GAIN, type BaremeFormat, type FormatPaye } from '../data/economie.ts';
import type { Gains, LigneGain, ResultatCourse } from './contrat.ts';

/** Vrai si le temps de la course bat un record qui existait. Une première course sur un parcours ne bat rien. */
export function recordBattu(resultat: Pick<ResultatCourse, 'temps' | 'ancienRecord'>): boolean {
  return resultat.ancienRecord !== null && Number.isFinite(resultat.temps) && resultat.temps < resultat.ancienRecord;
}

/** Détail ligne par ligne, chaque ligne avec son motif en clair ; une ligne nulle n'est pas écrite. */
export function calculerGains(resultat: ResultatCourse, bareme: Readonly<Record<string, BaremeFormat>> = ECONOMIE): Gains {
  const regle = bareme[resultat.format];
  if (!regle) return { dollars: 0, detail: [] };
  const format = resultat.format as FormatPaye;
  const detail: LigneGain[] = [];
  const ligne = (motif: string, dollars: number): void => {
    if (dollars > 0 && motif !== '') detail.push({ motif, dollars });
  };
  ligne(MOTIFS_GAIN.base[format], regle.base);
  if (resultat.medaille) ligne(MOTIFS_GAIN.medaille[resultat.medaille], regle.medaille[resultat.medaille]);
  if (recordBattu(resultat)) ligne(MOTIFS_GAIN.record, regle.record);
  if (resultat.stats.chocs === 0) ligne(MOTIFS_GAIN.sansChoc, regle.sansChoc);
  ligne(MOTIFS_GAIN.meteo[resultat.meteo], regle.meteo[resultat.meteo]);
  return { dollars: detail.reduce((somme, l) => somme + l.dollars, 0), detail };
}
