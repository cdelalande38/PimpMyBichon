// Le van ressemble au fourgon réel : sa silhouette de profil et de face, et ses lignes de caisse
// (ceinture, haut des vitres, pied du pare-brise, phares, feux), mesurées sur le GLB généré contre
// le gabarit chiffré tiré des références (assets-src/vehicles/van/gabarit.mjs).
// Silhouettes rastérisées au centimètre ; roues de 0,66 aux essieux dans les deux ; l'antenne (au-dessus
// de 1,92) n'entre pas dans l'écart maximal. Avant la reprise (commit 302ef9c) : profil 0,27 m²
// d'écart (3,7 %), 15 cm au plus (pied du pare-brise) ; face 0,11 m² (3,4 %), 14 cm au plus.

import { beforeAll, describe, expect, it } from 'vitest';
import { parseGlb } from '../../tools/lib/glb.mjs';
import { buildVehicle } from '../../tools/vehicles/build.mjs';
import { GABARIT } from '../../assets-src/vehicles/van/gabarit.mjs';

type P2 = readonly [number, number];

interface Tri {
  /** Sommets (x, y, z) à plat, par triangle. */
  p: number[];
  material: string;
  node: string;
}

/** Triangles posés du GLB (nœuds sans rotation, comme le kit les écrit). */
function triangles(bytes: Uint8Array): Tri[] {
  const parsed = parseGlb(bytes);
  if (!parsed.ok) throw new Error(parsed.message);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON glTF lu tel quel
  const { json, bin } = parsed.container as { json: Record<string, any>; bin: Uint8Array };
  const view = (accessor: number) => {
    const acc = json.accessors[accessor];
    const bv = json.bufferViews[acc.bufferView];
    const offset = bin.byteOffset + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const size = acc.type === 'VEC3' ? 3 : 1;
    if (acc.componentType === 5126) return new Float32Array(bin.buffer.slice(offset, offset + acc.count * size * 4));
    if (acc.componentType === 5123) return new Uint16Array(bin.buffer.slice(offset, offset + acc.count * 2));
    return new Uint32Array(bin.buffer.slice(offset, offset + acc.count * 4));
  };
  const out: Tri[] = [];
  for (const node of json.nodes as Array<{ name: string; mesh?: number; translation?: number[] }>) {
    if (node.mesh === undefined) continue;
    const [tx, ty, tz] = node.translation ?? [0, 0, 0];
    for (const primitive of json.meshes[node.mesh].primitives) {
      const pos = view(primitive.attributes.POSITION);
      const idx = view(primitive.indices);
      const material = json.materials[primitive.material].name as string;
      for (let i = 0; i < idx.length; i += 3) {
        const p: number[] = [];
        for (let k = 0; k < 3; k += 1) {
          const v = idx[i + k]! * 3;
          p.push(pos[v]! + tx!, pos[v + 1]! + ty!, pos[v + 2]! + tz!);
        }
        out.push({ p, material, node: node.name });
      }
    }
  }
  return out;
}

const R = 0.01;

interface Grid {
  g: Uint8Array;
  W: number;
  H: number;
  x0: number;
  y0: number;
}

function grid(x0: number, x1: number, y0: number, y1: number): Grid {
  const W = Math.round((x1 - x0) / R);
  const H = Math.round((y1 - y0) / R);
  return { g: new Uint8Array(W * H), W, H, x0, y0 };
}

const centre = (m: Grid, i: number, j: number): P2 => [m.x0 + (i + 0.5) * R, m.y0 + (j + 0.5) * R];

/** Remplit les triangles projetés (axe horizontal : x pour le profil, z pour la face). */
function fillTriangles(m: Grid, tris: readonly Tri[], axis: 0 | 2): void {
  for (const { p } of tris) {
    const a: P2 = [p[axis]!, p[1]!];
    const b: P2 = [p[3 + axis]!, p[4]!];
    const c: P2 = [p[6 + axis]!, p[7]!];
    const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(d) < 1e-14) continue;
    const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - m.x0) / R));
    const i1 = Math.min(m.W - 1, Math.ceil((Math.max(a[0], b[0], c[0]) - m.x0) / R));
    const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1], c[1]) - m.y0) / R));
    const j1 = Math.min(m.H - 1, Math.ceil((Math.max(a[1], b[1], c[1]) - m.y0) / R));
    for (let j = j0; j <= j1; j += 1)
      for (let i = i0; i <= i1; i += 1) {
        const [x, y] = centre(m, i, j);
        const l1 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d;
        const l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d;
        if (l1 >= 0 && l2 >= 0 && l1 + l2 <= 1) m.g[j * m.W + i] = 1;
      }
  }
}

function fillPolygon(m: Grid, poly: readonly P2[]): void {
  for (let j = 0; j < m.H; j += 1)
    for (let i = 0; i < m.W; i += 1) {
      const [x, y] = centre(m, i, j);
      let inside = false;
      for (let a = 0, b = poly.length - 1; a < poly.length; b = a, a += 1) {
        const [xa, ya] = poly[a]!;
        const [xb, yb] = poly[b]!;
        if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside;
      }
      if (inside) m.g[j * m.W + i] = 1;
    }
}

function fillDisc(m: Grid, cx: number, cy: number, r: number): void {
  for (let j = 0; j < m.H; j += 1)
    for (let i = 0; i < m.W; i += 1) {
      const [x, y] = centre(m, i, j);
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) m.g[j * m.W + i] = 1;
    }
}

/** Bord d'une silhouette (cases pleines touchant une vide), sous la hauteur `yMax`. */
function edges(m: Grid, yMax: number): P2[] {
  const out: P2[] = [];
  for (let j = 0; j < m.H; j += 1)
    for (let i = 0; i < m.W; i += 1) {
      if (!m.g[j * m.W + i] || centre(m, i, j)[1] > yMax) continue;
      const empty = (di: number, dj: number) => !m.g[(j + dj) * m.W + i + di];
      if (i === 0 || j === 0 || i === m.W - 1 || j === m.H - 1 || empty(-1, 0) || empty(1, 0) || empty(0, -1) || empty(0, 1)) out.push([i, j]);
    }
  return out;
}

/** Écart de deux silhouettes : surface qui diffère (m² et part de la référence), écart maximal du contour (cm). */
function compare(model: Grid, ref: Grid, yMax = 1.92): { diff: number; share: number; max: number } {
  let diff = 0;
  let area = 0;
  for (let k = 0; k < model.g.length; k += 1) {
    if (model.g[k] !== ref.g[k]) diff += 1;
    if (ref.g[k]) area += 1;
  }
  const a = edges(model, yMax);
  const b = edges(ref, yMax);
  const nearest = (p: P2, set: readonly P2[]) => Math.sqrt(Math.min(...set.map((q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2)));
  let max = 0;
  for (const p of a) max = Math.max(max, nearest(p, b));
  for (const p of b) max = Math.max(max, nearest(p, a));
  return { diff: diff * R * R, share: diff / area, max };
}

describe('le van ressemble au fourgon réel', () => {
  let tris: Tri[];
  beforeAll(async () => {
    tris = triangles((await buildVehicle('van')).bytes);
  }, 60_000);

  const outside = () => tris.filter((t) => t.node !== 'habitacle');

  it('de profil : moins de 2 % de surface d’écart avec le gabarit, 6 cm au plus sur le contour', () => {
    const model = grid(-2.7, 2.7, 0, 2.1);
    const ref = grid(-2.7, 2.7, 0, 2.1);
    fillTriangles(model, outside(), 0);
    fillPolygon(ref, GABARIT.profil);
    for (const m of [model, ref]) for (const x of [1.5, -1.5]) fillDisc(m, x, 0.33, 0.33);
    const { diff, share, max } = compare(model, ref);
    expect(share).toBeLessThan(0.02);
    expect(diff).toBeLessThan(0.15);
    expect(max).toBeLessThan(6);
  }, 60_000);

  it('de face : moins de 2,5 % de surface d’écart, 6 cm au plus (rétroviseurs compris)', () => {
    const model = grid(-1.3, 1.3, 0, 2.1);
    const ref = grid(-1.3, 1.3, 0, 2.1);
    fillTriangles(model, outside(), 2);
    fillPolygon(ref, [...GABARIT.face, ...[...GABARIT.face].reverse().map(([z, y]) => [-z, y] as const)]);
    const { share, max } = compare(model, ref);
    expect(share).toBeLessThan(0.025);
    expect(max).toBeLessThan(6);
  }, 60_000);

  /** Étendue en hauteur (et en x) d'un matériau d'un nœud (la caisse par défaut), filtrée. */
  const span = (material: string, keep: (x: number, y: number, z: number) => boolean, node = 'carrosserie') => {
    let yMin = Infinity;
    let yMax = -Infinity;
    let xAtMin = 0;
    for (const t of tris) {
      if (t.material !== material || t.node !== node) continue;
      for (let k = 0; k < 9; k += 3) {
        const [x, y, z] = [t.p[k]!, t.p[k + 1]!, t.p[k + 2]!];
        if (!keep(x, y, z)) continue;
        if (y < yMin) {
          yMin = y;
          xAtMin = x;
        }
        yMax = Math.max(yMax, y);
      }
    }
    return { yMin, yMax, xAtMin };
  };

  it('a les lignes de caisse du gabarit : ceinture, haut des vitres, pare-brise, phares, feux', () => {
    const { lignes } = GABARIT;
    // Vitres latérales (porte avant, porte coulissante) : bas à la ceinture, haut sous un mince bandeau.
    const side = span('glass', (x, _y, z) => Math.abs(z) > 0.9 && x > -1.2 && x < 1.3);
    expect(side.yMin).toBeCloseTo(lignes.ceinture, 1);
    expect(Math.abs(side.yMax - lignes.hautVitres)).toBeLessThan(0.04);
    // Pare-brise : pied à la grille d'auvent, haut au bord du pavillon.
    const screen = span('glass', (x, _y, z) => x > 0.6 && Math.abs(z) < 0.6);
    expect(Math.abs(screen.yMin - lignes.piedPareBrise[1])).toBeLessThan(0.03);
    expect(Math.abs(screen.xAtMin - lignes.piedPareBrise[0])).toBeLessThan(0.05);
    expect(Math.abs(screen.yMax - lignes.hautPareBrise[1])).toBeLessThan(0.06);
    // Grands phares au-dessus du bouclier (leur glace, pièce posée sur la marche), feux arrière verticaux.
    const lamps = span('glass', (x, y) => x > 2.1 && y > 0.7, 'accessoires');
    expect(Math.abs(lamps.yMin - lignes.phares[0])).toBeLessThan(0.05);
    expect(Math.abs(lamps.yMax - lignes.phares[1])).toBeLessThan(0.03);
    expect(lamps.yMax - lamps.yMin).toBeGreaterThan(0.14);
    const tails = span('tail', (x) => x < -2.3);
    expect(Math.abs(tails.yMin - lignes.feuxArriere[0])).toBeLessThan(0.03);
    expect(Math.abs(tails.yMax - lignes.feuxArriere[1])).toBeLessThan(0.03);
  });

  it('porte une porte coulissante vitrée à droite seulement : flanc gauche tôlé, rail à droite', () => {
    const right = span('glass', (x, _y, z) => z > 0.8 && x > -1.1 && x < 0.05);
    const left = span('glass', (x, _y, z) => z < -0.8 && x > -1.1 && x < 0.05);
    expect(right.yMax).toBeGreaterThan(1.5);
    expect(left.yMax).toBe(-Infinity);
  });
});
