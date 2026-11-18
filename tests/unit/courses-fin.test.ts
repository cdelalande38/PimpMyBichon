// Écran de fin d'une course (src/ui/drive/FinCourseVue.tsx), rendu sans navigateur avec un bilan vide (la
// souche de src/jeu/bilan.ts) et un bilan plein, fabriqué : résultats, gains ligne par ligne et solde,
// hauts faits et déblocages, « Rejouer » et « Rentrer au garage ».

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Bilan, ResultatCourse } from '../../src/jeu/contrat.ts';
import { bilanVide } from '../../src/state/drive.ts';
import { FinCourseVue, formatDollars, ligneRecord } from '../../src/ui/drive/FinCourseVue.tsx';

const RESULTAT: ResultatCourse = {
  carte: 'monaco-circuit',
  depart: 'port',
  vehicule: 'concept',
  format: 'tours3',
  meteo: 'sec',
  moment: 'nuit',
  temps: 512.34,
  tours: [176.2, 168.04, 168.1],
  ancienRecord: 520.0,
  medaille: 'argent',
  stats: { distance: 9789, vitesseMax: 182.4, glisse: 143.2, chocs: 3, nos: 4 },
};

const BILAN_PLEIN: Bilan = {
  resultat: RESULTAT,
  // Barème de l'économie (vague S) : trois tours, base 110 $, argent 50, record 40.
  gains: {
    dollars: 200,
    detail: [
      { motif: 'Course finie', dollars: 110 },
      { motif: 'Médaille d’argent', dollars: 50 },
      { motif: 'Record battu', dollars: 40 },
    ],
  },
  solde: 1240,
  hautsFaits: [{ id: 'trois-tours', label: 'Trois tours sans lever le pied', description: 'Boucle une course en 3 tours.', recompense: { dollars: 100, articles: ['flammes-bleues'] } }],
  deblocages: [{ id: 'flammes-bleues', famille: 'sticker', label: 'Flammes bleues', prix: null }],
};

const rendre = (bilan: Bilan) => renderToStaticMarkup(createElement(FinCourseVue, { bilan, onRejouer: () => undefined, onGarage: () => undefined }));
const texte = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/[ \n\t]+/g, ' ');

describe('écran de fin', () => {
  it('bilan plein : temps, tours, record, médaille, gains ligne par ligne, solde, hauts faits et déblocages', () => {
    const t = texte(rendre(BILAN_PLEIN));
    expect(t).toContain('8:32.3');
    expect(t).toContain('Médaille d’argent');
    for (const tour of ['Tour 1 2:56.2', 'Tour 2 2:48.0', 'Tour 3 2:48.1']) expect(t).toContain(tour);
    expect(t).toContain('Nouveau record, 7,7 s de mieux ! L’ancien : 8:40.0.');
    expect(t).toContain('Course finie + 110 $');
    expect(t).toContain('Médaille d’argent + 50 $');
    expect(t).toContain(`Total + ${formatDollars(200)}`);
    expect(t).toContain(`Solde : ${formatDollars(1240)}`);
    expect(t).toContain('Trois tours sans lever le pied');
    expect(t).toContain('Haut fait · + 100 $');
    expect(t).toContain('Flammes bleues Sticker');
    expect(t).toContain('9,8 km · 182 km/h au plus · 3 chocs · 143 m de glisse · NOS ×4');
    expect(t).toContain('Rejouer');
    expect(t).toContain('Rentrer au garage');
    // Meilleur tour marqué une seule fois.
    expect(rendre(BILAN_PLEIN).match(/data-meilleur/g)).toHaveLength(1);
  });

  it('bilan vide (souche de l’économie) : le résultat, et des blocs qui le disent en clair', () => {
    const resultat: ResultatCourse = { ...RESULTAT, format: 'tour1', tours: [61.25], temps: 61.25, ancienRecord: null, medaille: null };
    const t = texte(rendre(bilanVide(resultat)));
    expect(t).toContain('1:01.2');
    expect(t).toContain('Pas de médaille cette fois');
    expect(t).not.toContain('Tour 1 ');
    expect(t).toContain('Premier temps posé ici dans ce format');
    expect(t).toContain('Rien de gagné cette fois.');
    expect(t).toContain(`Solde : ${formatDollars(0)}`);
    expect(t).toContain('Rien de nouveau cette fois.');
  });

  it('ligne du record : battu, égalé, gardé', () => {
    expect(ligneRecord(60, null).record).toBe(true);
    expect(ligneRecord(59, 60)).toEqual({ texte: 'Nouveau record, 1,0 s de mieux ! L’ancien : 1:00.0.', record: true });
    expect(ligneRecord(60, 60).record).toBe(false);
    expect(ligneRecord(62.5, 60)).toEqual({ texte: 'Ton record : 1:00.0, 2,5 s plus vite.', record: false });
  });
});
