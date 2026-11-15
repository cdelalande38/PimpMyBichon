// Cartes de sortie (tools/maps/) : conversion Lambert-93 ⇄ longitude et latitude, repère d'une
// carte, géométrie plane (distance à une polyligne, point dans un polygone, découpe, hachage).

import { describe, expect, it } from 'vitest';
import { LAMBERT93, repereCarte } from '../../tools/maps/geo.mjs';
import { aire, dansPolygone, decouperRectangle, hasard, indexPolyligne, simplifier } from '../../tools/maps/geom2d.mjs';

describe('Lambert-93', () => {
  it('retrouve les points de référence (vérifiés contre le WFS de l’IGN à 5 mm près)', () => {
    // Nœud nord de la D1085 (Laffrey) : coordonnées projetées données par le service.
    const [lon, lat] = LAMBERT93.inverse(917860, 6441375);
    expect(lon).toBeCloseTo(5.767149, 5);
    expect(lat).toBeCloseTo(45.03726, 5);
    // Point d'origine de la projection : (3° E, 46,5° N) ↦ (700 000, 6 600 000).
    const [x, y] = LAMBERT93.forward(3, 46.5);
    expect(x).toBeCloseTo(700000, 3);
    expect(y).toBeCloseTo(6600000, 3);
  });

  it('fait l’aller et retour au millimètre', () => {
    for (const [lon, lat] of [
      [5.78, 44.9],
      [2.35, 48.85],
      [7.42, 43.73],
      [-1.5, 47.2],
    ] as const) {
      const [x, y] = LAMBERT93.forward(lon, lat);
      const [lon2, lat2] = LAMBERT93.inverse(x, y);
      const [x2, y2] = LAMBERT93.forward(lon2, lat2);
      expect(Math.hypot(x2 - x, y2 - y)).toBeLessThan(0.001);
    }
  });

  it('a un facteur d’échelle de 1 sur les parallèles automécoïques et moins de 1 entre eux', () => {
    expect(LAMBERT93.scale(44)).toBeCloseTo(1, 9);
    expect(LAMBERT93.scale(49)).toBeCloseTo(1, 9);
    expect(LAMBERT93.scale(45)).toBeLessThan(1);
    expect(LAMBERT93.scale(45)).toBeGreaterThan(0.999);
  });
});

describe('repère d’une carte', () => {
  const rep = repereCarte(LAMBERT93, [917860, 6441375, 783]);
  it('met l’origine au départ, X vers l’est, Y vers le haut, Z vers le sud', () => {
    expect(rep.versCarte(917860, 6441375, 783)).toEqual([0, 0, -0]);
    const [x, y, z] = rep.versCarte(917860 + 100, 6441375 - 100, 800);
    expect(x).toBeGreaterThan(100); // mètre vrai : distance projetée divisée par k < 1
    expect(y).toBe(17);
    expect(z).toBeGreaterThan(100);
    expect(x).toBeCloseTo(100 / rep.k, 6);
  });
  it('revient aux coordonnées projetées', () => {
    const [px, py] = rep.versProjete(...([250, -400] as const));
    const [x, , z] = rep.versCarte(px, py);
    expect(x).toBeCloseTo(250, 6);
    expect(z).toBeCloseTo(-400, 6);
  });
});

describe('géométrie plane', () => {
  it('mesure la distance à une polyligne et le côté (droite du sens de marche)', () => {
    // Marche vers l'est (X+) : la droite est au sud (Z+).
    const idx = indexPolyligne(
      [
        [0, 0],
        [100, 0],
        [100, 100],
      ],
      { cellule: 20 },
    );
    const a = idx.proche(50, 10, 50);
    expect(a.d).toBeCloseTo(10);
    expect(a.cote).toBe(1);
    expect(idx.proche(50, -10, 50).cote).toBe(-1);
    expect(idx.proche(500, 500, 50).d).toBe(Infinity);
  });

  it('teste l’appartenance à un polygone à trou', () => {
    const ext = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const trou = [
      [4, 4],
      [6, 4],
      [6, 6],
      [4, 6],
    ];
    expect(dansPolygone(2, 2, [ext, trou])).toBe(true);
    expect(dansPolygone(5, 5, [ext, trou])).toBe(false);
    expect(dansPolygone(12, 5, [ext])).toBe(false);
  });

  it('découpe un polygone concave par un rectangle sans changer l’aire attendue', () => {
    const l = [
      [0, 0],
      [20, 0],
      [20, 10],
      [10, 10],
      [10, 20],
      [0, 20],
    ];
    const piece = decouperRectangle(l, [5, 5, 15, 15]);
    expect(Math.abs(aire(piece))).toBeCloseTo(75, 6);
  });

  it('simplifie en gardant les extrémités et les angles', () => {
    const pts = Array.from({ length: 11 }, (_, i) => [i, i === 5 ? 3 : 0]);
    const s = simplifier(pts, 0.5);
    expect(s[0]).toEqual([0, 0]);
    expect(s[s.length - 1]).toEqual([10, 0]);
    expect(s).toContainEqual([5, 3]);
    expect(s.length).toBeLessThan(pts.length);
  });

  it('tire un hasard déterministe dans [0, 1)', () => {
    expect(hasard(3, 7)).toBe(hasard(3, 7));
    expect(hasard(3, 7)).not.toBe(hasard(7, 3));
    for (let i = 0; i < 200; i += 1) {
      const v = hasard(i, -i * 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
