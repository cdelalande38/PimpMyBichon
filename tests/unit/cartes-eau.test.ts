// Plans d'eau des cartes (tools/maps/eau.mjs) : un lac à contour tourmenté et à îles est couvert
// sans trou ni débord, et chaque tronçon porte toute l'eau visible depuis lui (les lacs ne
// paraissent plus troués quand les tronçons voisins ne sont pas chargés).

import { describe, expect, it } from 'vitest';
import { dansPolygone } from '../../tools/maps/geom2d.mjs';
import { repartirEau, trianglesEau } from '../../tools/maps/eau.mjs';

/** Lac en U (contour concave) avec deux îles, dont une à cheval sur une limite de carreau de 100 m (l'ancien découpage la noyait). */
const LAC: number[][][] = [
  [
    [0, 0],
    [400, 0],
    [400, 300],
    [300, 300],
    [300, 80],
    [100, 80],
    [100, 300],
    [0, 300],
  ],
  [
    [180, 20],
    [230, 20],
    [230, 60],
    [180, 60],
  ],
  [
    [20, 140],
    [60, 140],
    [60, 180],
    [20, 180],
  ],
];

function dansTriangles(x: number, z: number, tris: number[][]): boolean {
  return tris.some((t) => {
    const [ax = 0, az = 0, bx = 0, bz = 0, cx = 0, cz = 0] = t;
    const s = (px: number, pz: number, qx: number, qz: number) => (qx - px) * (z - pz) - (qz - pz) * (x - px);
    const a = s(ax, az, bx, bz);
    const b = s(bx, bz, cx, cz);
    const c = s(cx, cz, ax, az);
    return (a >= 0 && b >= 0 && c >= 0) || (a <= 0 && b <= 0 && c <= 0);
  });
}

describe('eau des cartes', () => {
  it('couvre un lac à contour concave et à îles sans trou ni débord', () => {
    const tris = trianglesEau(LAC);
    let manque = 0;
    let trop = 0;
    for (let z = 1.5; z < 300; z += 3)
      for (let x = 1.5; x < 400; x += 3) {
        const eau = dansPolygone(x, z, LAC);
        const couvert = dansTriangles(x, z, tris);
        if (eau && !couvert) manque += 1;
        if (!eau && couvert) trop += 1;
      }
    expect(manque).toBe(0);
    expect(trop).toBe(0);
    // Faces vers le haut : sens horaire dans le plan X, Z.
    for (const [ax = 0, az = 0, bx = 0, bz = 0, cx = 0, cz = 0] of tris) expect((bx - ax) * (cz - az) - (bz - az) * (cx - ax)).toBeLessThan(0);
  });

  it('met dans chaque tronçon toute l’eau à portée de son rail', () => {
    // Trois tronçons de 400 m le long du lac, à 150 m de sa rive sud.
    const rails = [0, 1, 2].map((c) => [
      [-400 + c * 400, 450],
      [c * 400, 450],
    ]);
    const portee = 600;
    const parTroncon = repartirEau([{ y: 0, anneaux: LAC }], rails, { portee });
    rails.forEach((r, c) => {
      const tris = (parTroncon[c] ?? []).flatMap((m) => m.tris);
      let manque = 0;
      for (let z = 2.5; z < 300; z += 5)
        for (let x = 2.5; x < 400; x += 5) {
          const [a = [0, 0], b = [0, 0]] = r;
          const t = Math.max(0, Math.min(1, (x - (a[0] ?? 0)) / ((b[0] ?? 0) - (a[0] ?? 0))));
          const d = Math.hypot(x - ((a[0] ?? 0) + ((b[0] ?? 0) - (a[0] ?? 0)) * t), z - 450);
          if (d <= portee && dansPolygone(x, z, LAC) && !dansTriangles(x, z, tris)) manque += 1;
        }
      expect(manque, `tronçon ${c}`).toBe(0);
    });
    // Un tronçon loin du lac n'en porte rien.
    expect(repartirEau([{ y: 0, anneaux: LAC }], [[[5000, 5000], [5400, 5000]]], { portee })[0]).toEqual([]);
  });
});
