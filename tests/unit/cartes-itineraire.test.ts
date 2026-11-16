// Itinéraires des cartes (tools/maps/trace.mjs, geom2d.mjs, fetch.mjs) : parcours par étapes avec
// rues préférées, boucle refermée, carrefour de deux rues nommées ; mer refermée sur l'emprise à
// partir du trait de côte.

import { describe, expect, it } from 'vitest';
import { pointEtape } from '../../tools/maps/fetch.mjs';
import { aire, couperLigne, dansPolygone, fermerSurBoite, raccorder } from '../../tools/maps/geom2d.mjs';
import { chainerEtapes } from '../../tools/maps/trace.mjs';

type A = { id: string; nom: string; points: number[][]; sens?: string };
const a = (id: string, nom: string, pts: number[][], sens?: string): A => ({ id, nom, points: pts.map(([x = 0, y = 0]) => [x, y, 0]), ...(sens ? { sens } : {}) });

// Un carré de 100 m de côté (rues N, E, S, O) et une diagonale plus courte, sans nom.
const RESEAU = [
  a('n', 'RUE DU NORD', [[0, 100], [100, 100]]),
  a('e', 'RUE DE L’EST', [[100, 100], [100, 0]], 'direct'),
  a('s', 'RUE DU SUD', [[100, 0], [0, 0]]),
  a('o', 'RUE DE L’OUEST', [[0, 0], [0, 100]]),
  a('d', '', [[0, 100], [100, 0]]),
];

describe('itinéraires', () => {
  it('relie les étapes en préférant les rues demandées', () => {
    const court = chainerEtapes(RESEAU, [{ p: [0, 100] }, { p: [100, 0] }]);
    expect(court.troncons.map((t) => t.id)).toEqual(['d']);
    const prefere = chainerEtapes(RESEAU, [{ p: [0, 100] }, { p: [100, 0], par: ['RUE DU NORD', 'RUE DE L’EST'] }]);
    expect(prefere.troncons.map((t) => t.id)).toEqual(['n', 'e']);
    expect(prefere.longueur).toBeCloseTo(200, 6);
  });

  it('respecte les sens uniques, sauf sur route fermée', () => {
    const sens = chainerEtapes(RESEAU, [{ p: [100, 0] }, { p: [100, 100], par: ['RUE DE L’EST'] }]);
    expect(sens.troncons.map((t) => t.id)).not.toContain('e');
    const ferme = chainerEtapes(RESEAU, [{ p: [100, 0] }, { p: [100, 100], par: ['RUE DE L’EST'] }], { sensIgnore: true });
    expect(ferme.troncons.map((t) => t.id)).toEqual(['e']);
  });

  it('referme une boucle : le dernier point est le premier, sans demi-tour', () => {
    // L'étape de départ porte les rues du retour (le dernier trajet arrive chez elle).
    const etapes = [
      { p: [0, 0], par: ['RUE DE L’EST', 'RUE DU SUD'] },
      { p: [100, 100], par: ['RUE DE L’OUEST', 'RUE DU NORD'] },
    ];
    const b = chainerEtapes(RESEAU, etapes, { boucle: true, sensIgnore: true });
    expect(b.points[0]).toEqual(b.points[b.points.length - 1]);
    expect(b.troncons.map((t) => t.id)).toEqual(['o', 'n', 'e', 's']);
    expect(b.longueur).toBeCloseTo(400, 6);
    expect(b.demiTours).toEqual([]);
    // Une étape posée au bout d'une impasse se voit : demi-tour signalé.
    const impasse = [...RESEAU, a('i', 'IMPASSE', [[50, 100], [50, 160]]), a('n1', 'RUE DU NORD', [[0, 100], [50, 100]]), a('n2', 'RUE DU NORD', [[50, 100], [100, 100]])].filter((x) => x.id !== 'n' && x.id !== 'd');
    const dt = chainerEtapes(impasse, [{ p: [0, 100] }, { p: [50, 160] }, { p: [100, 100] }]);
    expect(dt.demiTours.length).toBe(1);
  });

  it('trouve le carrefour de deux rues nommées', () => {
    const proj = { forward: (lon: number, lat: number): [number, number] => [lon, lat] };
    expect(pointEtape({ carrefour: ['RUE DU NORD', 'RUE DE L’EST'] }, RESEAU, proj, 0)).toEqual([100, 100, 0]);
    expect(pointEtape({ lon: 3, lat: 4 }, RESEAU, proj, 0)).toEqual([3, 4]);
    expect(() => pointEtape({ carrefour: ['RUE DU NORD', 'RUE DU SUD'] }, RESEAU, proj, 0)).toThrow(/ne se croisent pas/);
    expect(() => pointEtape({ carrefour: ['RUE DU NORD', 'NULLE PART'] }, RESEAU, proj, 0)).toThrow(/absente/);
  });
});

describe('mer', () => {
  // Trait de côte en deux morceaux, d'ouest en est, qui sort du rectangle [0, 0, 1000, 1000] des deux côtés.
  const morceaux = [
    [
      [600, 500],
      [1100, 450],
    ],
    [
      [-100, 600],
      [300, 550],
      [600, 500],
    ],
  ];
  const r: [number, number, number, number] = [0, 0, 1000, 1000];

  it('raccorde les morceaux et coupe la ligne au rectangle', () => {
    const [ligne = []] = raccorder(morceaux, 1);
    expect(ligne.length).toBe(4);
    const c = couperLigne(ligne, r);
    expect(c[0]?.[0]).toBeCloseTo(0, 6);
    expect(c[c.length - 1]?.[0]).toBeCloseTo(1000, 6);
  });

  it('referme la mer du côté où le parcours ne passe pas', () => {
    const c = couperLigne(raccorder(morceaux, 1)[0] ?? [], r);
    const [a1, a2] = fermerSurBoite(c, r);
    // Les deux anneaux se partagent le rectangle.
    expect(Math.abs(aire(a1)) + Math.abs(aire(a2))).toBeCloseTo(1_000_000, -2);
    // Le large (z grand, au sud) d'un côté, la terre (z petit) de l'autre.
    const sud = [a1, a2].find((an) => dansPolygone(500, 900, [an]));
    const nord = [a1, a2].find((an) => dansPolygone(500, 100, [an]));
    expect(sud).toBeDefined();
    expect(nord).toBeDefined();
    expect(sud).not.toBe(nord);
  });
});
