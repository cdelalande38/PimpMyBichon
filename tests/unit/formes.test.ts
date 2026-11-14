import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Euler,
  Matrix4,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { describe, expect, it } from 'vitest';
import { GARAGE, GARAGE_MATERIALS, type GarageMaterial } from '../../src/data/garage.ts';
import type { GarageShape, Vec2, Vec3 } from '../../src/data/garageShapes.ts';
import { roundedRectContour, shapeGeometry, triangleCount } from '../../src/scene/garage/shapes.ts';

// Bibliothèque de formes du décor (src/scene/garage/shapes.ts) : chaque forme et ses variantes
// doivent être propres (nombres finis, normales unitaires et cohérentes), conformes aux cotes,
// sous leur budget, fermées et tournées vers l'extérieur, et fusionnables entre elles.

interface Case {
  name: string;
  shape: GarageShape;
  /** Boîte englobante attendue : [min, max]. */
  bounds: readonly [Vec3, Vec3];
  budget: number;
  /** Surface fermée (faux pour un profil tourné qui ne rejoint pas l'axe). */
  closed: boolean;
  /** Volume attendu, avec sa tolérance relative. */
  volume?: readonly [number, number];
  /** Tolérance sur la boîte englobante, en mètres (2/10 mm par défaut). */
  tol?: number;
  /**
   * Bornes du rapport entre aire en coordonnées de texture et aire réelle (0,75 à 1,25 par défaut).
   * Le flanc d'un cône s'écrase vers sa pointe : u y suit un rayon moyen, sans cisaillement.
   */
  uv?: readonly [number, number];
}

const sym = (x: number, y: number, z: number): readonly [Vec3, Vec3] => [
  [-x, -y, -z],
  [x, y, z],
];

const LAMP_FOOT: Vec2[] = [
  [0, 0],
  [0.12, 0],
  [0.12, 0.012],
  [0.04, 0.05],
  [0.025, 0.06],
  [0.025, 0.4],
  [0, 0.4],
];

const L_SHAPE: Vec2[] = [
  [0, 0],
  [0.6, 0],
  [0.6, 0.2],
  [0.2, 0.2],
  [0.2, 0.5],
  [0, 0.5],
];

const CASES: Case[] = [
  { name: 'pavé d’origine', shape: { box: [1.2, 0.9, 0.6] }, bounds: sym(0.6, 0.45, 0.3), budget: 12, closed: true, volume: [0.648, 1e-6] },
  { name: 'pavé arrondi de 1 cm', shape: { box: [1.2, 0.9, 0.6], bevel: 0.01 }, bounds: sym(0.6, 0.45, 0.3), budget: 150, closed: true, volume: [0.648, 0.003] },
  { name: 'pavé arrondi de 4 cm', shape: { box: [0.5, 0.5, 0.5], bevel: 0.04 }, bounds: sym(0.25, 0.25, 0.25), budget: 300, closed: true, volume: [0.125, 0.02] },
  { name: 'pavé à l’arrondi trop grand (ramené à la demi-arête)', shape: { box: [0.4, 0.2, 0.3], bevel: 1 }, bounds: sym(0.2, 0.1, 0.15), budget: 300, closed: true },
  { name: 'pavé arrondi en detail 2', shape: { box: [0.3, 0.3, 0.3], bevel: 0.01, detail: 2 }, bounds: sym(0.15, 0.15, 0.15), budget: 300, closed: true },
  { name: 'cylindre d’origine', shape: { cylinder: [0.2, 0.5] }, bounds: sym(0.2, 0.25, 0.2), budget: 80, closed: true },
  { name: 'cylindre d’origine en x', shape: { cylinder: [0.1, 0.6], axis: 'x' }, bounds: sym(0.3, 0.1, 0.1), budget: 80, closed: true },
  { name: 'cylindre d’origine en z', shape: { cylinder: [0.1, 0.6], axis: 'z' }, bounds: sym(0.1, 0.1, 0.3), budget: 80, closed: true },
  { name: 'tronc de cône sans arrondi', shape: { cylinder: [0.2, 0.3], top: 0.1 }, bounds: sym(0.2, 0.15, 0.2), budget: 80, closed: true, volume: [(Math.PI * 0.3 * (0.04 + 0.02 + 0.01)) / 3, 0.03] },
  { name: 'tabouret arrondi de 8 mm', shape: { cylinder: [0.2, 0.05], top: 0.18, bevel: 0.008 }, bounds: sym(0.2, 0.025, 0.2), budget: 300, closed: true, tol: 0.005 },
  { name: 'cylindre arrondi de 4 cm', shape: { cylinder: [0.15, 0.4], bevel: 0.04 }, bounds: sym(0.15, 0.2, 0.15), budget: 400, closed: true, volume: [Math.PI * 0.0225 * 0.4, 0.06] },
  { name: 'cône pointe en haut, en x', shape: { cylinder: [0.1, 0.3], top: 0, axis: 'x' }, bounds: [[-0.15, -0.1, -0.1], [0.15, 0.1, 0.1]], budget: 80, closed: true, uv: [0.55, 1.25] },
  { name: 'cône pointe en bas', shape: { cylinder: [0, 0.3], top: 0.1 }, bounds: sym(0.1, 0.15, 0.1), budget: 80, closed: true, uv: [0.55, 1.25] },
  { name: 'cylindre à l’arrondi trop grand', shape: { cylinder: [0.05, 0.04], bevel: 0.5 }, bounds: sym(0.05, 0.02, 0.05), budget: 400, closed: true },
  { name: 'sphère d’origine', shape: { sphere: 0.13 }, bounds: [[-0.13, -0.13, -0.128], [0.13, 0.13, 0.128]], budget: 400, closed: true, volume: [(4 / 3) * Math.PI * 0.13 ** 3, 0.05] },
  { name: 'ellipsoïde', shape: { sphere: 0.13, scale: [1, 1.1, 1.2] }, bounds: sym(0.13, 0.143, 0.156), budget: 400, closed: true, volume: [(4 / 3) * Math.PI * 0.13 ** 3 * 1.32, 0.05] },
  { name: 'sphère en detail 0,5', shape: { sphere: 0.05, detail: 0.5 }, bounds: sym(0.05, 0.05, 0.05), budget: 120, closed: true },
  { name: 'capsule en x', shape: { capsule: [0.02, 0.4], axis: 'x' }, bounds: sym(0.2, 0.02, 0.02), budget: 200, closed: true, volume: [Math.PI * 0.0004 * 0.36 + (4 / 3) * Math.PI * 0.02 ** 3, 0.06] },
  { name: 'capsule trop courte (sphère)', shape: { capsule: [0.05, 0.05] }, bounds: sym(0.05, 0.05, 0.05), budget: 300, closed: true },
  { name: 'capsule en z', shape: { capsule: [0.1, 0.5], axis: 'z' }, bounds: sym(0.1, 0.1, 0.25), budget: 400, closed: true },
  { name: 'pneu (tore en x)', shape: { torus: [0.3, 0.1], axis: 'x' }, bounds: sym(0.1, 0.4, 0.4), budget: 700, closed: true, volume: [2 * Math.PI ** 2 * 0.3 * 0.01, 0.07] },
  { name: 'anneau fin', shape: { torus: [0.1, 0.01] }, bounds: sym(0.11, 0.01, 0.11), budget: 400, closed: true },
  { name: 'tore ouvert (demi-tour)', shape: { torus: [0.3, 0.05], arc: Math.PI }, bounds: [[0, -0.05, -0.35], [0.35, 0.05, 0.35]], budget: 400, closed: true },
  { name: 'assise en coussin', shape: { cushion: [0.6, 0.16, 0.6], bevel: 0.05, puff: 0.025 }, bounds: sym(0.3, 0.105, 0.3), budget: 600, closed: true },
  { name: 'dossier en coussin (bombé en z)', shape: { cushion: [0.6, 0.5, 0.15] }, bounds: sym(0.3, 0.25, 0.075 + 0.018), budget: 600, closed: true },
  { name: 'coussin plat à petit arrondi', shape: { cushion: [0.4, 0.1, 0.4], bevel: 0.012, puff: 0 }, bounds: sym(0.2, 0.05, 0.2), budget: 300, closed: true },
  { name: 'pied de lampe tourné', shape: { lathe: LAMP_FOOT }, bounds: [[-0.12, 0, -0.12], [0.12, 0.4, 0.12]], budget: 2 * 16 * 8, closed: true },
  { name: 'pied de lampe donné à l’envers', shape: { lathe: [...LAMP_FOOT].reverse() }, bounds: [[-0.12, 0, -0.12], [0.12, 0.4, 0.12]], budget: 2 * 16 * 8, closed: true },
  { name: 'abat-jour ouvert', shape: { lathe: [[0.15, 0], [0.08, 0.2]] }, bounds: [[-0.15, 0, -0.15], [0.15, 0.2, 0.15]], budget: 2 * 20, closed: false },
  { name: 'demi-dôme en secteur, en z', shape: { lathe: [[0, 0], [0.2, 0], [0.2, 0.05], [0, 0.15]], arc: Math.PI, axis: 'z' }, bounds: [[0, -0.2, 0], [0.2, 0.2, 0.15]], budget: 200, closed: true },
  { name: 'bague à section carrée (profil bouclé)', shape: { lathe: [[0.1, 0], [0.12, 0], [0.12, 0.02], [0.1, 0.02], [0.1, 0]] }, bounds: [[-0.12, 0, -0.12], [0.12, 0.02, 0.12]], budget: 2 * 16 * 4, closed: true, volume: [Math.PI * (0.0144 - 0.01) * 0.02, 0.04] },
  { name: 'visière épaisse en secteur (profil bouclé, à l’envers)', shape: { lathe: [[0.146, -0.03], [0.146, 0.05], [0.152, 0.05], [0.152, -0.03], [0.146, -0.03]], arc: 2 }, bounds: [[0, -0.03, -0.0634], [0.152, 0.05, 0.152]], budget: 200, closed: true, tol: 0.002 },
  { name: 'profil à deux points (disque)', shape: { lathe: [[0, 0], [0.3, 0]] }, bounds: [[-0.3, 0, -0.3], [0.3, 0, 0.3]], budget: 30, closed: false },
  { name: 'écran extrudé, coins ronds', shape: { extrude: roundedRectContour(1.2, 0.7, 0.04), depth: 0.04, bevel: 0.01 }, bounds: sym(0.6, 0.35, 0.02), budget: 400, closed: true, volume: [1.2 * 0.7 * 0.04, 0.02] },
  { name: 'cadre percé à plat (axe y, contour à l’envers)', shape: { extrude: [[-0.3, -0.2], [-0.3, 0.2], [0.3, 0.2], [0.3, -0.2]], depth: 0.03, axis: 'y', holes: [[[-0.25, -0.15], [0.25, -0.15], [0.25, 0.15], [-0.25, 0.15]]], bevel: 0.004 }, bounds: [[-0.3, -0.015, -0.2], [0.3, 0.015, 0.2]], budget: 300, closed: true, volume: [(0.24 - 0.15) * 0.03, 0.03] },
  { name: 'équerre en L, axe x, sans arrondi', shape: { extrude: L_SHAPE, depth: 0.02, axis: 'x' }, bounds: [[-0.01, 0, -0.6], [0.01, 0.5, 0]], budget: 40, closed: true, volume: [(0.12 + 0.06) * 0.02, 1e-4] },
  { name: 'équerre en L arrondie', shape: { extrude: L_SHAPE, depth: 0.05, bevel: 0.02 }, bounds: [[0, 0, -0.025], [0.6, 0.5, 0.025]], budget: 200, closed: true },
  { name: 'tube à coudes vifs', shape: { tube: [[0, 0, 0], [0, 0.8, 0], [0.4, 0.8, 0]], radius: 0.015 }, bounds: [[-0.015, 0, -0.015], [0.4, 0.815, 0.015]], budget: 2 * 8 * 2 + 16, closed: true },
  { name: 'tube à coudes ronds', shape: { tube: [[0, 0, 0], [0, 0.8, 0], [0.4, 0.8, 0], [0.4, 0.8, 0.5]], radius: 0.015, smooth: true }, bounds: [[-0.015, 0, -0.015], [0.415, 0.815, 0.5]], budget: 2 * 8 * 12 + 16, closed: true },
  { name: 'boucle fermée arrondie', shape: { tube: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], radius: 0.02, smooth: true, closed: true }, bounds: [[-0.02, -0.02, -0.02], [1.02, 0.02, 1.02]], budget: 2 * 8 * 20, closed: true },
  { name: 'boucle fermée gauche (torsion répartie)', shape: { tube: [[0, 0, 0], [1, 0, 0], [1, 0.5, 1], [0, 1, 0.5]], radius: 0.02, closed: true }, bounds: [[-0.02, -0.02, -0.02], [1.02, 1.02, 1.02]], budget: 2 * 8 * 4, closed: true, tol: 0.02 },
  { name: 'tube à deux points', shape: { tube: [[0, 0, 0], [0, 0, 0.5]], radius: 0.05 }, bounds: [[-0.05, -0.05, 0], [0.05, 0.05, 0.5]], budget: 2 * 12 + 24, closed: true, volume: [Math.PI * 0.0025 * 0.5, 0.06] },
];

// ——— Outils de contrôle ———

function vec(geometry: BufferGeometry, name: string, i: number): Vector3 {
  return new Vector3().fromBufferAttribute(geometry.getAttribute(name) as never, i);
}

function triangles(geometry: BufferGeometry): Array<[number, number, number]> {
  const index = geometry.getIndex();
  if (!index) throw new Error('géométrie non indexée');
  const list: Array<[number, number, number]> = [];
  for (let t = 0; t < index.count; t += 3) list.push([index.getX(t), index.getX(t + 1), index.getX(t + 2)]);
  return list;
}

/** Sommets confondus soudés : identifiant de position commun. */
function welded(geometry: BufferGeometry): number[] {
  const position = geometry.getAttribute('position');
  const ids = new Map<string, number>();
  const out: number[] = [];
  for (let i = 0; i < position.count; i += 1) {
    const key = [position.getX(i), position.getY(i), position.getZ(i)].map((v) => Math.round(v * 1e5)).join(',');
    if (!ids.has(key)) ids.set(key, ids.size);
    out.push(ids.get(key)!);
  }
  return out;
}

/** Arêtes orientées après soudure : chacune doit apparaître une fois, et son inverse une fois. */
function openEdges(geometry: BufferGeometry): number {
  const ids = welded(geometry);
  const edges = new Map<string, number>();
  for (const tri of triangles(geometry)) {
    const w = tri.map((i) => ids[i]!);
    for (let k = 0; k < 3; k += 1) {
      const key = `${w[k]}>${w[(k + 1) % 3]}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  let bad = 0;
  for (const [key, count] of edges) {
    const [a, b] = key.split('>');
    if (count !== 1 || edges.get(`${b}>${a}`) !== 1) bad += 1;
  }
  return bad;
}

function signedVolume(geometry: BufferGeometry): number {
  let volume = 0;
  for (const [a, b, c] of triangles(geometry)) {
    volume += vec(geometry, 'position', a).dot(vec(geometry, 'position', b).cross(vec(geometry, 'position', c))) / 6;
  }
  return volume;
}

/** Rapport entre l'aire en coordonnées de texture et l'aire réelle : 1 pour des UV en mètres. */
function uvScale(geometry: BufferGeometry): number {
  let surface = 0;
  let mapped = 0;
  const uv = geometry.getAttribute('uv');
  for (const [a, b, c] of triangles(geometry)) {
    const pa = vec(geometry, 'position', a);
    surface += vec(geometry, 'position', b).sub(pa).cross(vec(geometry, 'position', c).sub(pa)).length() / 2;
    const [ua, va, ub, vb, uc, vc] = [uv.getX(a), uv.getY(a), uv.getX(b), uv.getY(b), uv.getX(c), uv.getY(c)];
    mapped += Math.abs((ub - ua) * (vc - va) - (uc - ua) * (vb - va)) / 2;
  }
  return mapped / surface;
}

function expectNear(actual: Vector3, expected: Vec3, tolerance: number, label: string): void {
  expect(Math.abs(actual.x - expected[0]), `${label} x`).toBeLessThan(tolerance);
  expect(Math.abs(actual.y - expected[1]), `${label} y`).toBeLessThan(tolerance);
  expect(Math.abs(actual.z - expected[2]), `${label} z`).toBeLessThan(tolerance);
}

describe('formes du décor : propreté de chaque variante', () => {
  for (const testCase of CASES) {
    it(testCase.name, () => {
      const geometry = shapeGeometry(testCase.shape);
      expect(Object.keys(geometry.attributes).sort()).toEqual(['normal', 'position', 'uv']);
      expect(geometry.getIndex()).not.toBeNull();
      expect(geometry.groups).toHaveLength(0);

      const position = geometry.getAttribute('position');
      const normal = geometry.getAttribute('normal');
      const uv = geometry.getAttribute('uv');
      for (let i = 0; i < position.count; i += 1) {
        expect([position.getX(i), position.getY(i), position.getZ(i)].every(Number.isFinite)).toBe(true);
        expect([uv.getX(i), uv.getY(i)].every(Number.isFinite)).toBe(true);
        expect(Math.abs(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)) - 1)).toBeLessThan(1e-4);
      }

      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      expectNear(box.min, testCase.bounds[0], testCase.tol ?? 2e-4, 'min');
      expectNear(box.max, testCase.bounds[1], testCase.tol ?? 2e-4, 'max');

      expect(triangleCount(geometry)).toBeLessThanOrEqual(testCase.budget);

      // Normales de sommet du même côté que la face (pas de triangle retourné).
      for (const [a, b, c] of triangles(geometry)) {
        const pa = vec(geometry, 'position', a);
        const face = vec(geometry, 'position', b).sub(pa).cross(vec(geometry, 'position', c).sub(pa));
        const sum = vec(geometry, 'normal', a).add(vec(geometry, 'normal', b)).add(vec(geometry, 'normal', c));
        expect(face.dot(sum)).toBeGreaterThan(0);
      }

      if (testCase.closed) {
        expect(openEdges(geometry)).toBe(0);
        expect(signedVolume(geometry)).toBeGreaterThan(0);
      }
      if (testCase.volume) {
        const [expected, tolerance] = testCase.volume;
        expect(Math.abs(signedVolume(geometry) / expected - 1)).toBeLessThan(tolerance);
      }
      // Coordonnées de texture en mètres.
      const [low, high] = testCase.uv ?? [0.75, 1.25];
      expect(uvScale(geometry)).toBeGreaterThan(low);
      expect(uvScale(geometry)).toBeLessThan(high);
    });
  }

  it('est déterministe', () => {
    for (const { shape } of CASES) {
      const a = shapeGeometry(shape);
      const b = shapeGeometry(shape);
      expect(Array.from(a.getAttribute('position').array)).toEqual(Array.from(b.getAttribute('position').array));
      expect(Array.from(a.getIndex()!.array)).toEqual(Array.from(b.getIndex()!.array));
    }
  });

  it('fusionne toutes les formes ensemble et avec un pavé d’origine', () => {
    const geometries = [...CASES.map(({ shape }) => shapeGeometry(shape)), new BoxGeometry(1, 1, 1)];
    const merged = mergeGeometries(geometries, false);
    expect(merged).not.toBeNull();
    expect(merged!.getAttribute('position').count).toBe(geometries.reduce((sum, g) => sum + g.getAttribute('position').count, 0));
  });

  it('les arrondis de 5 à 15 mm portent des normales lisses (aucune facette sur l’arrondi)', () => {
    // Sur un pavé arrondi, aucun sommet de l'arrondi ne porte une normale d'axe pur : la normale
    // tourne de la face à la face voisine, ce qui accroche un reflet net.
    const geometry = shapeGeometry({ box: [0.4, 0.4, 0.4], bevel: 0.01 });
    const normal = geometry.getAttribute('normal');
    let tilted = 0;
    for (let i = 0; i < normal.count; i += 1) {
      const n = vec(geometry, 'normal', i);
      if (Math.max(Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)) < 0.99) tilted += 1;
    }
    expect(tilted).toBeGreaterThan(normal.count / 2);
  });
});

describe('formes du décor : paramètres dégénérés refusés', () => {
  const refused: Array<[string, GarageShape, RegExp]> = [
    ['pavé sans épaisseur', { box: [1, 0, 1] }, /box.*hauteur/],
    ['profil à un point', { lathe: [[0.1, 0]] }, /lathe.*deux points/],
    ['profil collé à l’axe', { lathe: [[0, 0], [0, 1]] }, /lathe.*collé à l’axe/],
    ['contour de deux points', { extrude: [[0, 0], [1, 0]], depth: 0.1 }, /extrude.*trois points/],
    ['tube qui fait demi-tour', { tube: [[0, 0, 0], [1, 0, 0], [0, 0, 0.0000001]], radius: 0.01 }, /tube.*demi-tour/],
    ['tube d’un seul point', { tube: [[0, 0, 0], [0, 0, 0]], radius: 0.01 }, /tube.*2 points/],
    ['tore dont le tube dépasse le cercle', { torus: [0.1, 0.2] }, /torus.*rayon du tube/],
    ['rayon négatif', { sphere: -1 }, /sphere.*rayon/],
    ['arrondi négatif', { box: [1, 1, 1], bevel: -0.1 }, /box.*bevel/],
  ];
  for (const [name, shape, message] of refused) {
    it(name, () => {
      expect(() => shapeGeometry(shape)).toThrow(message);
    });
  }
});

// ——— Les trois formes d'origine, face à partGeometry (src/scene/garage/build.ts) ———

/** Copie de partGeometry au moment où la bibliothèque a été écrite (sans placement). */
function legacy(shape: GarageShape): BufferGeometry {
  if ('box' in shape) {
    const [w, h, d] = shape.box;
    const geometry = new BoxGeometry(w, h, d);
    const uv = geometry.getAttribute('uv');
    const faces: Array<[number, number]> = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    faces.forEach(([su, sv], face) => {
      for (let i = face * 4; i < face * 4 + 4; i += 1) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    });
    return geometry;
  }
  if ('cylinder' in shape) {
    const [radius, height] = shape.cylinder;
    const geometry = new CylinderGeometry(radius, radius, height, 20);
    if (shape.axis === 'x') geometry.rotateZ(Math.PI / 2);
    if (shape.axis === 'z') geometry.rotateX(Math.PI / 2);
    return geometry;
  }
  if ('sphere' in shape) return new SphereGeometry(shape.sphere, 18, 12);
  throw new Error('forme non historique');
}

describe('formes d’origine : construites comme avant', () => {
  const origin: GarageShape[] = [
    { box: [1.2, 0.9, 0.6] },
    { box: [0.05, 2.1, 0.8] },
    { cylinder: [0.2, 0.5] },
    { cylinder: [0.03, 1.2], axis: 'x' },
    { cylinder: [0.1, 0.02], axis: 'z' },
    { sphere: 0.13 },
  ];
  for (const shape of origin) {
    it(JSON.stringify(shape), () => {
      const now = shapeGeometry(shape);
      const before = legacy(shape);
      expect(Array.from(now.getAttribute('position').array)).toEqual(Array.from(before.getAttribute('position').array));
      expect(Array.from(now.getAttribute('normal').array)).toEqual(Array.from(before.getAttribute('normal').array));
      expect(Array.from(now.getIndex()!.array)).toEqual(Array.from(before.getIndex()!.array));
      const a = new Box3().setFromBufferAttribute(now.getAttribute('position') as never);
      const b = new Box3().setFromBufferAttribute(before.getAttribute('position') as never);
      expect(a.equals(b)).toBe(true);
      // Pavé : mêmes coordonnées de texture. Cylindre et sphère : passées en mètres (voir le test suivant).
      if ('box' in shape) expect(Array.from(now.getAttribute('uv').array)).toEqual(Array.from(before.getAttribute('uv').array));
    });
  }

  it('aucun matériau texturé n’est posé sur un cylindre ou une sphère du garage : leurs UV en mètres ne changent pas le rendu', () => {
    const textured = (id: keyof typeof GARAGE_MATERIALS) => {
      const material: GarageMaterial = GARAGE_MATERIALS[id];
      return material.map !== undefined || material.roughnessMap !== undefined;
    };
    const offenders = GARAGE.props.flatMap((prop) =>
      prop.parts.filter((part) => ('cylinder' in part || 'sphere' in part) && textured(part.material)).map((part) => `${prop.name} : ${part.material}`),
    );
    expect(offenders).toEqual([]);
  });

  it('le mobilier actuel se construit en entier avec shapeGeometry, mêmes boîtes que partGeometry', () => {
    let count = 0;
    for (const prop of GARAGE.props) {
      for (const part of prop.parts) {
        const shape = ('box' in part ? { box: part.box } : 'cylinder' in part ? { cylinder: part.cylinder, axis: part.axis } : { sphere: part.sphere }) as GarageShape;
        const matrix = new Matrix4().compose(new Vector3(...part.at), new Quaternion().setFromEuler(new Euler(...(part.rot ?? [0, 0, 0]))), new Vector3(1, 1, 1));
        const now = new Box3().setFromBufferAttribute(shapeGeometry(shape).applyMatrix4(matrix).getAttribute('position') as never);
        const before = new Box3().setFromBufferAttribute(legacy(shape).applyMatrix4(matrix).getAttribute('position') as never);
        expect(now.equals(before)).toBe(true);
        count += 1;
      }
    }
    expect(count).toBeGreaterThan(20);
  });
});

describe('studio des formes : page de développement seulement', () => {
  it('rien dans src/ hors de src/dev/ n’importe le studio', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (path !== join('src', 'dev')) walk(path);
        } else if (/\.(ts|tsx)$/.test(name) && /from\s+['"][^'"]*\/dev\//.test(readFileSync(path, 'utf8'))) {
          offenders.push(path);
        }
      }
    };
    walk('src');
    expect(offenders).toEqual([]);
  });
});
