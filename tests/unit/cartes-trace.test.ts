// Cartes de sortie (tools/maps/trace.mjs) : chaînage du tracé, densification, lissage,
// rééchantillonnage à pas constant, pentes et rayons, sections et découpage en tronçons.

import { describe, expect, it } from 'vitest';
import { chainer, decouper, dentsDeScie, densifier, lisserSerie, pentes, rayons, reechantillonner, sections } from '../../tools/maps/trace.mjs';

describe('chaînage', () => {
  // Deux chemins de A à D : A-B-D (court) et A-C-D (long) ; une arête est saisie à l'envers.
  const aretes = [
    { id: 'ab', points: [[0, 0, 10], [100, 0, 11]] },
    { id: 'db', points: [[200, 0, 13], [150, 5, 12], [100, 0, 11]] },
    { id: 'ac', points: [[0, 0, 10], [0, 300, 10]] },
    { id: 'cd', points: [[0, 300, 10], [200, 0, 13]] },
  ];
  it('prend le plus court chemin et oriente les tronçons dans le sens du parcours', () => {
    const c = chainer(aretes, [1, 1], [199, 1]);
    expect(c.troncons.map((t) => t.id)).toEqual(['ab', 'db']);
    expect(c.points).toEqual([
      [0, 0, 10],
      [100, 0, 11],
      [150, 5, 12],
      [200, 0, 13],
    ]);
    // Le sommet commun porte le tronçon qui y commence.
    expect(c.rang).toEqual([0, 1, 1, 1]);
    expect(c.longueur).toBeCloseTo(100 + 2 * Math.hypot(50, 5), 6);
  });
  it('respecte les sens uniques (rond-point parcouru dans le sens de circulation)', () => {
    // Anneau carré A(0,0) → B(10,0) → C(10,10) → D(0,10) → A, à sens unique dans cet ordre ;
    // entrée en A, sortie en D : le plus court serait A → D (10 m), à contresens.
    const anneau = [
      { id: 'ab', sens: 'direct', points: [[0, 0], [10, 0]] },
      { id: 'bc', sens: 'direct', points: [[10, 0], [10, 10]] },
      { id: 'dc', sens: 'inverse', points: [[0, 10], [10, 10]] },
      { id: 'da', sens: 'direct', points: [[0, 10], [0, 0]] },
    ];
    expect(chainer(anneau, [0, 0], [0, 10]).troncons.map((t) => t.id)).toEqual(['ab', 'bc', 'dc']);
    expect(chainer(anneau.map((t) => ({ ...t, sens: 'double' })), [0, 0], [0, 10]).troncons.map((t) => t.id)).toEqual(['da']);
  });
  it('signale l’absence de chemin', () => {
    expect(() => chainer([aretes[0] as (typeof aretes)[0], { id: 'x', points: [[500, 500], [600, 600]] }], [0, 0], [600, 600])).toThrow(/aucun chemin/);
  });
});

describe('lissage et rééchantillonnage', () => {
  it('densifie au pas demandé en reportant les étiquettes', () => {
    const d = densifier(
      [
        [0, 0, 0],
        [10, 0, 1],
        [10, 5, 1],
      ],
      [7, 8, 9],
      1,
    );
    expect(d.points.length).toBe(16);
    expect(d.etiquettes[3]).toBe(7);
    expect(d.etiquettes[12]).toBe(8);
    expect(d.points[5]?.[2]).toBeCloseTo(0.5);
  });

  it('garde une série affine intacte, extrémités comprises, et efface une dent de scie', () => {
    const affine = Array.from({ length: 50 }, (_, i) => 3 + 0.2 * i);
    lisserSerie(affine, 5).forEach((v, i) => expect(v).toBeCloseTo(affine[i] ?? 0, 9));
    const scie = Array.from({ length: 200 }, (_, i) => (i % 2 ? 1 : -1));
    const lisse = lisserSerie(scie, 4);
    expect(Math.max(...lisse.slice(20, 180).map(Math.abs))).toBeLessThan(0.01);
  });

  it('rééchantillonne à pas 3D constant : le point i est à i × pas', () => {
    const pts = Array.from({ length: 101 }, (_, i) => [Math.cos(i / 20) * 200, i * 0.3, Math.sin(i / 20) * 200]);
    const r = reechantillonner(pts, 2);
    expect(r.longueur).toBe((r.points.length - 1) * 2);
    for (let i = 1; i < r.points.length; i += 1) {
      const a = r.points[i - 1] as number[];
      const b = r.points[i] as number[];
      // Corde d'un arc de 2 m sur une hélice de rayon 200 m : à moins d'un millimètre du pas.
      expect(Math.abs(Math.hypot((b[0] ?? 0) - (a[0] ?? 0), (b[1] ?? 0) - (a[1] ?? 0), (b[2] ?? 0) - (a[2] ?? 0)) - 2)).toBeLessThan(0.002);
    }
    expect(dentsDeScie(r.points)).toBeLessThan(0.01);
  });

  it('mesure rayon de courbure et pente', () => {
    const cercle = Array.from({ length: 200 }, (_, i) => [Math.cos(i / 50) * 50, i * 0.1, Math.sin(i / 50) * 50]);
    const R = rayons(cercle, 5);
    expect(R[100]).toBeCloseTo(50, 1);
    const droite = Array.from({ length: 50 }, (_, i) => [i * 2, i * 0.1, 0]);
    expect(rayons(droite, 5)[20]).toBe(Infinity);
    expect(pentes(droite, 5)[20]).toBeCloseTo(0.05, 9);
  });
});

describe('sections et tronçons', () => {
  const v = (ground: string, urban = false, width = 7) => ({ ground, urban, lanes: 2, width });
  it('fusionne les points voisins égaux, absorbe les sections courtes sauf les ponts', () => {
    const vals = [...Array(50).fill(v('sol')), ...Array(5).fill(v('sol', false, 6)), ...Array(40).fill(v('sol')), ...Array(4).fill(v('pont')), ...Array(51).fill(v('sol', true))];
    const s = sections(vals, 2, 30);
    expect(s.map((x) => [x.from, x.to, x.ground, x.urban])).toEqual([
      [0, 190, 'sol', false],
      [190, 198, 'pont', false],
      [198, 298, 'sol', true],
    ]);
  });
  it('découpe en tronçons jointifs qui partagent leur point frontière', () => {
    const b = decouper(1001, 2, 400);
    expect(b.length).toBe(5);
    expect(b[0]?.[0]).toBe(0);
    expect(b[b.length - 1]?.[1]).toBe(1000);
    for (let i = 1; i < b.length; i += 1) expect(b[i]?.[0]).toBe(b[i - 1]?.[1]);
  });
});
