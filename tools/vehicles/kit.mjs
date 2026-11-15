// @ts-check
// Boîte à outils de modelage des véhicules substituts (placeholder_*), en Node pur : three seul
// (géométries et BufferGeometryUtils), aucun DOM, aucun hasard. Mode d'emploi complet, avec un
// exemple par outil : assets-src/vehicles/LISEZ-MOI.md.
//
// Repère du véhicule (§ 8 du cahier des charges) : mètres, +Y vers le haut, avant vers +X,
// côté droit vers +Z (gauche vers −Z), origine au sol au centre de l'empattement.
// Chaque outil rend une « pièce » : une liste de { material, geometry }, où geometry est une
// BufferGeometry indexée qui ne porte que position et normal. Model regroupe les pièces par nœud
// et par matériau, puis écrit le GLB (un maillage par nœud, une primitive par matériau).

import {
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  LatheGeometry,
  Matrix4,
  Path,
  Quaternion,
  Shape,
  SphereGeometry,
  TubeGeometry,
  CatmullRomCurve3,
  Euler,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries, mergeVertices, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { writeGlb } from './glb-writer.mjs';

/** @typedef {[number, number]} P2 */
/** @typedef {[number, number, number]} P3 */
/** @typedef {{ material: string, geometry: BufferGeometry }} Part */
/** @typedef {Part[]} Parts */

/** Noms de matériaux admis (§ 8) : paint_<zone> ou un rôle. */
export const MATERIAL_NAME = /^(paint_[a-z0-9_]+|chrome|alu|black|rubber|glass|leather|lamp|tail|signal)$/;

/**
 * Lecture d'un élément dont l'indice est sûr (boucles d'indices) : évite les gardes que
 * noUncheckedIndexedAccess imposerait à chaque lecture.
 * @template T @param {ArrayLike<T>} a @param {number} i @returns {T}
 */
export const at = (a, i) => /** @type {T} */ (a[i]);

/** Angle de pli par défaut, en degrés : au-delà, l'arête reste franche. */
export const DEFAULT_CREASE = 50;

// ---------------------------------------------------------------------------------------------
// Géométrie de base

/**
 * Ne garde que position et normal, indexe, et recalcule des normales lissées sous l'angle de pli.
 * @param {BufferGeometry} geometry
 * @param {number} [creaseDeg]
 */
export function smooth(geometry, creaseDeg = DEFAULT_CREASE) {
  const clean = new BufferGeometry();
  const src = geometry.index ? geometry.toNonIndexed() : geometry;
  clean.setAttribute('position', src.getAttribute('position').clone());
  const creased = toCreasedNormals(clean, (creaseDeg * Math.PI) / 180);
  return mergeVertices(creased, 1e-6);
}

/**
 * Garde les normales existantes, mais réduit la géométrie à position + normal, indexée.
 * @param {BufferGeometry} geometry
 */
export function clean(geometry) {
  const out = new BufferGeometry();
  const src = geometry.index ? geometry.toNonIndexed() : geometry;
  out.setAttribute('position', src.getAttribute('position').clone());
  if (src.getAttribute('normal')) out.setAttribute('normal', src.getAttribute('normal').clone());
  else out.computeVertexNormals();
  return mergeVertices(out, 1e-6);
}

/** @param {BufferGeometry} geometry */
export function triangleCount(geometry) {
  return geometry.index ? geometry.index.count / 3 : geometry.getAttribute('position').count / 3;
}

/** @param {Parts} parts */
export function partsTriangles(parts) {
  return parts.reduce((sum, p) => sum + triangleCount(p.geometry), 0);
}

/**
 * Retourne l'ordre des triangles (et les normales) : la face visible change de côté.
 * @param {BufferGeometry} geometry
 */
export function flip(geometry) {
  const g = geometry.clone();
  const index = g.index;
  if (index) {
    const arr = index.array;
    for (let i = 0; i < arr.length; i += 3) {
      const t = at(arr, i + 1);
      arr[i + 1] = at(arr, i + 2);
      arr[i + 2] = t;
    }
    index.needsUpdate = true;
  }
  const n = g.getAttribute('normal');
  if (n) for (let i = 0; i < n.count; i += 1) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return g;
}

/** Copie de la géométrie et de son envers : visible des deux côtés. @param {BufferGeometry} geometry */
export function doubleSided(geometry) {
  return mergeGeometries([clean(geometry), flip(clean(geometry))]);
}

/**
 * Symétrique par rapport au plan z = 0 (gauche ↔ droite), triangles remis à l'endroit.
 * @param {BufferGeometry} geometry
 */
export function mirrorZ(geometry) {
  const g = clean(geometry);
  g.applyMatrix4(new Matrix4().makeScale(1, 1, -1));
  // Une échelle négative retourne les triangles : on les remet à l'endroit, normales comprises
  // (applyMatrix4 a déjà reflété les normales, il ne reste qu'à inverser l'ordre des sommets).
  const index = /** @type {BufferAttribute} */ (g.index);
  const arr = index.array;
  for (let i = 0; i < arr.length; i += 3) {
    const t = at(arr, i + 1);
    arr[i + 1] = at(arr, i + 2);
    arr[i + 2] = t;
  }
  return g;
}

/**
 * Applique une transformation à toutes les pièces (copies).
 * @param {Parts} parts
 * @param {{ position?: P3, rotation?: P3, scale?: number | P3 }} t  rotation : angles d'Euler XYZ en radians
 */
export function place(parts, t) {
  const m = transformMatrix(t);
  return parts.map((p) => ({ material: p.material, geometry: p.geometry.clone().applyMatrix4(m) }));
}

/** @param {{ position?: P3, rotation?: P3, scale?: number | P3 }} t */
export function transformMatrix(t) {
  const [rx, ry, rz] = t.rotation ?? [0, 0, 0];
  const q = new Quaternion().setFromEuler(new Euler(rx, ry, rz));
  const s = typeof t.scale === 'number' ? [t.scale, t.scale, t.scale] : (t.scale ?? [1, 1, 1]);
  return new Matrix4().compose(new Vector3(...(t.position ?? [0, 0, 0])), q, new Vector3(s[0], s[1], s[2]));
}

/**
 * Oriente une pièce modelée « face vers +Z local » pour qu'elle regarde vers `normal`, posée en
 * `position`, son haut local (+Y) tourné au mieux vers `up` (vertical par défaut).
 * @param {Parts} parts
 * @param {{ position: P3, normal: P3, up?: P3 }} t
 */
export function orient(parts, t) {
  const z = new Vector3(...t.normal).normalize();
  const upHint = new Vector3(...(t.up ?? [0, 1, 0]));
  const x = new Vector3().crossVectors(upHint, z);
  if (x.lengthSq() < 1e-8) x.set(1, 0, 0);
  x.normalize();
  const y = new Vector3().crossVectors(z, x);
  const m = new Matrix4().makeBasis(x, y, z).setPosition(...t.position);
  return parts.map((p) => ({ material: p.material, geometry: p.geometry.clone().applyMatrix4(m) }));
}

/** Symétrie gauche-droite : les pièces et leur copie en miroir. @param {Parts} parts */
export function symmetric(parts) {
  return [...parts, ...parts.map((p) => ({ material: p.material, geometry: mirrorZ(p.geometry) }))];
}

// ---------------------------------------------------------------------------------------------
// Courbes

/**
 * Courbe lisse y = f(x) passant par des points (x croissants) : cubique monotone (Fritsch-Carlson),
 * sans dépassement entre deux points. Hors des bornes : valeur du bout.
 * @param {P2[]} points
 * @returns {(x: number) => number}
 */
export function smoothCurve(points) {
  const n = points.length;
  if (n < 2) throw new Error('smoothCurve : au moins deux points');
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  for (let i = 1; i < n; i += 1) if (!(at(xs, i) > at(xs, i - 1))) throw new Error('smoothCurve : x strictement croissants');
  /** @type {number[]} */
  const d = [];
  for (let i = 0; i < n - 1; i += 1) d.push((at(ys, i + 1) - at(ys, i)) / (at(xs, i + 1) - at(xs, i)));
  /** @type {number[]} */
  const m = new Array(n).fill(0);
  m[0] = at(d, 0);
  m[n - 1] = at(d, n - 2);
  for (let i = 1; i < n - 1; i += 1) m[i] = at(d, i - 1) * at(d, i) <= 0 ? 0 : (at(d, i - 1) + at(d, i)) / 2;
  for (let i = 0; i < n - 1; i += 1) {
    if (at(d, i) === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = at(m, i) / at(d, i);
    const b = at(m, i + 1) / at(d, i);
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * at(d, i);
      m[i + 1] = t * b * at(d, i);
    }
  }
  return (x) => {
    if (x <= at(xs, 0)) return at(ys, 0);
    if (x >= at(xs, n - 1)) return at(ys, n - 1);
    let i = 0;
    while (x > at(xs, i + 1)) i += 1;
    const h = at(xs, i + 1) - at(xs, i);
    const t = (x - at(xs, i)) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * at(ys, i) + (t3 - 2 * t2 + t) * h * at(m, i) + (-2 * t3 + 3 * t2) * at(ys, i + 1) + (t3 - t2) * h * at(m, i + 1);
  };
}

/**
 * Retrait d'un bout arrondi : 0 loin du bout, r au bout, en quart de cercle (tangent au plan du
 * bout). Sert à arrondir l'avant et l'arrière d'un loft.
 * @param {number} x  @param {number} end  abscisse du bout  @param {number} r  rayon
 */
export function endInset(x, end, r) {
  const d = r - Math.abs(end - x);
  if (d <= 0 || r <= 0) return 0;
  return r - Math.sqrt(Math.max(0, r * r - d * d));
}

/**
 * Abscisses de 0 à 1 resserrées vers les deux bouts (cosinus) : count + 1 valeurs.
 * @param {number} count
 */
export function clusteredSteps(count) {
  return Array.from({ length: count + 1 }, (_, i) => 0.5 - 0.5 * Math.cos((Math.PI * i) / count));
}

/**
 * Abscisses d'échantillonnage d'un loft : pas régulier d'au plus `step` mètres, resserré près des
 * bouts sur `endZone` mètres, plus les abscisses imposées `breaks` (bords de vitre, de porte…).
 * @param {number} x0 @param {number} x1 @param {{ step?: number, endZone?: number, endCount?: number, breaks?: number[] }} [o]
 */
export function sampleX(x0, x1, o = {}) {
  const step = o.step ?? 0.03;
  const endZone = o.endZone ?? 0.2;
  const endCount = o.endCount ?? 10;
  const set = new Set();
  const add = (/** @type {number} */ x) => set.add(Math.round(x * 1e5) / 1e5);
  for (let i = 0; i <= endCount; i += 1) {
    const t = 1 - Math.cos(((Math.PI / 2) * i) / endCount);
    add(x0 + endZone * t);
    add(x1 - endZone * t);
  }
  const n = Math.max(1, Math.ceil((x1 - x0 - 2 * endZone) / step));
  for (let i = 0; i <= n; i += 1) add(x0 + endZone + ((x1 - x0 - 2 * endZone) * i) / n);
  for (const b of o.breaks ?? []) if (b > x0 && b < x1) add(b);
  const xs = [...set].sort((a, b) => a - b);
  // Deux abscisses trop proches donnent des triangles en lame : on fusionne sous 4 mm.
  return xs.filter((x, i) => i === 0 || i === xs.length - 1 || x - xs[i - 1] > 0.004);
}

// ---------------------------------------------------------------------------------------------
// Sections

/**
 * Arc de cercle de `from` à `to` degrés (0° = +z, 90° = +y), centre (cz, cy), rayon r : n + 1 points.
 * @param {number} cz @param {number} cy @param {number} r @param {number} from @param {number} to @param {number} n
 * @returns {P2[]}
 */
export function arc(cz, cy, r, from, to, n) {
  /** @type {P2[]} */
  const out = [];
  for (let i = 0; i <= n; i += 1) {
    const a = ((from + ((to - from) * i) / n) * Math.PI) / 180;
    out.push([cz + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

/**
 * Points de a à b exclus du bout b : n points.
 * @param {P2} a @param {P2} b @param {number} n @returns {P2[]}
 */
export function segment(a, b, n) {
  /** @type {P2[]} */
  const out = [];
  for (let i = 0; i < n; i += 1) out.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
  return out;
}

/**
 * Section fermée symétrique à partir de sa moitié droite : points [z, y] de bas en haut, du milieu
 * du dessous (z = 0) au milieu du dessus (z = 0), z ≥ 0. Rend le contour complet, couture au
 * milieu du dessous.
 * @param {P2[]} half
 * @returns {P2[]}
 */
export function mirrorSection(half) {
  const first = at(half, 0);
  const last = at(half, half.length - 1);
  if (Math.abs(first[0]) > 1e-9 || Math.abs(last[0]) > 1e-9) throw new Error('mirrorSection : la moitié commence et finit en z = 0');
  const back = half.slice(1, -1).reverse().map(([z, y]) => /** @type {P2} */ ([-z, y]));
  return [...half, ...back];
}

/**
 * Moitié de section en trapèze arrondi (pratique pour un capot, un réservoir, un carénage) :
 * même nombre de points quelles que soient les cotes, condition pour un loft.
 * @param {{ bottom: number, top: number, halfWidthBottom: number, halfWidthTop: number, rBottom?: number, rTop?: number, crown?: number, n?: number }} o
 *   crown : bombé du dessus au milieu, en mètres ; n : points par arc (6 par défaut)
 * @returns {P2[]}
 */
export function roundedHalf(o) {
  const n = o.n ?? 6;
  const rb = Math.min(o.rBottom ?? 0.03, (o.top - o.bottom) / 2 - 1e-4, o.halfWidthBottom - 1e-4);
  const rt = Math.min(o.rTop ?? 0.05, (o.top - o.bottom) / 2 - 1e-4, o.halfWidthTop - 1e-4);
  const crown = o.crown ?? 0;
  /** @type {P2[]} */
  const pts = [];
  pts.push(...segment([0, o.bottom], [o.halfWidthBottom - rb, o.bottom], n));
  pts.push(...arc(o.halfWidthBottom - rb, o.bottom + rb, rb, -90, 0, n).slice(0, -1));
  const a = /** @type {P2} */ ([o.halfWidthBottom, o.bottom + rb]);
  const b = /** @type {P2} */ ([o.halfWidthTop, o.top - rt]);
  pts.push(...segment(a, b, n));
  pts.push(...arc(o.halfWidthTop - rt, o.top - rt, rt, 0, 90, n).slice(0, -1));
  for (let i = 0; i <= n; i += 1) {
    const z = (o.halfWidthTop - rt) * (1 - i / n);
    const t = z / Math.max(1e-6, o.halfWidthTop - rt);
    pts.push([z, o.top + crown * (1 - t * t)]);
  }
  return pts;
}

// ---------------------------------------------------------------------------------------------
// Loft : surface tendue sur des sections

/**
 * Catmull-Rom centripète périodique sur un contour fermé : `sub` points par côté. La variante
 * centripète ne fait ni boucle ni rebroussement quand les points sont inégalement espacés (un
 * coin serré entre deux longs côtés), contrairement à la variante uniforme.
 * @param {P2[]} pts @param {number} sub @returns {P2[]}
 */
export function subdivideClosed(pts, sub) {
  if (sub <= 1) return pts;
  const n = pts.length;
  /** @param {P2} a @param {P2} b */
  const knot = (a, b) => Math.max(1e-6, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
  /** @param {P2} a @param {P2} b @param {number} ta @param {number} tb @param {number} t @returns {P2} */
  const lerp = (a, b, ta, tb, t) => {
    const w = (t - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
  };
  /** @type {P2[]} */
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const p0 = at(pts, (i - 1 + n) % n);
    const p1 = at(pts, i);
    const p2 = at(pts, (i + 1) % n);
    const p3 = at(pts, (i + 2) % n);
    out.push([p1[0], p1[1]]);
    if (Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) < 1e-9) {
      for (let s = 1; s < sub; s += 1) out.push([p1[0], p1[1]]);
      continue;
    }
    const t0 = 0;
    const t1 = t0 + knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);
    for (let s = 1; s < sub; s += 1) {
      const t = t1 + ((t2 - t1) * s) / sub;
      const a1 = lerp(p0, p1, t0, t1, t);
      const a2 = lerp(p1, p2, t1, t2, t);
      const a3 = lerp(p2, p3, t2, t3, t);
      const b1 = lerp(a1, a2, t0, t2, t);
      const b2 = lerp(a2, a3, t1, t3, t);
      out.push(lerp(b1, b2, t1, t2, t));
    }
  }
  return out;
}

/**
 * @typedef {object} Face
 * @property {number} x @property {number} y @property {number} z  centre du triangle
 * @property {number} nx @property {number} ny @property {number} nz  normale (vers l'extérieur)
 * @property {number} u  0 à 1 le long du loft (de la première à la dernière section)
 * @property {number} v  0 à 1 autour du contour (0 : premier point de la section)
 * @property {boolean} cap  vrai pour un bouchon de bout
 */

/**
 * Loft : surface lisse tendue sur des sections fermées successives, perpendiculaires à X.
 *
 * Deux façons de donner les sections :
 * - `sections: [{ x, points }]` : quelques sections clés (même nombre de points [z, y] chacune),
 *   interpolées en douceur le long de X (cubique monotone par point, `along` pas entre deux clés) ;
 * - `sectionAt: (x) => points` avec `xs` : une fonction échantillonnée aux abscisses données.
 * Autour du contour, `around` subdivise chaque côté par Catmull-Rom centripète (1 : points tels quels).
 *
 * `material` : un nom, ou une fonction (face) => nom, appelée pour chaque triangle (découpe des
 * vitres et des panneaux sans opération booléenne : les normales restent continues d'une région à
 * l'autre). `caps` : 'both' (défaut), 'start', 'end' ou 'none' ; un bouchon est plat.
 * `inward` : surface vue de l'intérieur (doublure d'habitacle).
 * @param {{
 *   sections?: { x: number, points: P2[] }[],
 *   along?: number,
 *   sectionAt?: (x: number) => P2[],
 *   xs?: number[],
 *   around?: number,
 *   material: string | ((f: Face) => string),
 *   caps?: 'both' | 'start' | 'end' | 'none',
 *   crease?: number,
 *   inward?: boolean,
 *   capRows?: number,
 *   capColumns?: number,
 *   capY?: number[],
 *   capZ?: number[],
 * }} o
 * @returns {Parts}
 */
export function loft(o) {
  /** @type {{ x: number, pts: P2[] }[]} */
  let rings;
  if (o.sectionAt) {
    if (!o.xs || o.xs.length < 2) throw new Error('loft : sectionAt demande xs (au moins deux abscisses)');
    const fn = o.sectionAt;
    rings = o.xs.map((x) => ({ x, pts: fn(x) }));
  } else if (o.sections && o.sections.length >= 2) {
    const secs = [...o.sections].sort((a, b) => a.x - b.x);
    const count = at(secs, 0).points.length;
    for (const s of secs) if (s.points.length !== count) throw new Error(`loft : sections de ${count} et ${s.points.length} points`);
    const along = Math.max(1, o.along ?? 8);
    /** @type {((x: number) => number)[]} */
    const curves = [];
    for (let j = 0; j < count; j += 1)
      for (let k = 0; k < 2; k += 1) curves.push(smoothCurve(secs.map((s) => /** @type {P2} */ ([s.x, at(at(s.points, j), k)]))));
    /** @type {number[]} */
    const xs = [];
    for (let i = 0; i < secs.length - 1; i += 1) for (let s = 0; s < along; s += 1) xs.push(at(secs, i).x + ((at(secs, i + 1).x - at(secs, i).x) * s) / along);
    xs.push(at(secs, secs.length - 1).x);
    rings = xs.map((x) => ({ x, pts: Array.from({ length: count }, (_, j) => /** @type {P2} */ ([at(curves, 2 * j)(x), at(curves, 2 * j + 1)(x)])) }));
  } else throw new Error('loft : donne sections (au moins deux) ou sectionAt et xs');

  const around = Math.max(1, o.around ?? 1);
  rings = rings.map((r) => ({ x: r.x, pts: subdivideClosed(r.pts, around) }));
  const m = at(rings, 0).pts.length;
  for (const r of rings) if (r.pts.length !== m) throw new Error('loft : toutes les sections doivent avoir le même nombre de points');

  // Sens du contour : aire signée dans le plan (z, y). On veut des triangles tournés vers l'extérieur.
  let area = 0;
  const ref = at(rings, Math.floor(rings.length / 2)).pts;
  for (let j = 0; j < m; j += 1) {
    const a = at(ref, j);
    const b = at(ref, (j + 1) % m);
    area += a[0] * b[1] - b[0] * a[1];
  }
  const ccw = area > 0;
  const outward = o.inward ? !ccw : ccw;

  /** @type {number[]} */
  const pos = [];
  for (const r of rings) for (const [z, y] of r.pts) pos.push(r.x, y, z);
  /** @type {number[]} */
  const tris = [];
  const nr = rings.length;
  for (let i = 0; i < nr - 1; i += 1) {
    for (let j = 0; j < m; j += 1) {
      const a = i * m + j;
      const b = i * m + ((j + 1) % m);
      const c = (i + 1) * m + j;
      const d = (i + 1) * m + ((j + 1) % m);
      // Contour dans le sens trigonométrique du plan (z vers la droite, y vers le haut) et X
      // croissant : (a, d, b) regarde dehors (vérifié par le test des normales).
      if (outward) tris.push(a, d, b, a, c, d);
      else tris.push(a, b, d, a, d, c);
    }
  }
  /** Rang du premier indice des bouchons dans tris. */
  const capStart = tris.length;
  const caps = o.caps ?? 'both';
  /**
   * Bouchon plat. Si la section est symétrique et monte régulièrement de chaque côté (cas d'une
   * caisse), il est maillé en grille : des rangées horizontales aux hauteurs des points du contour
   * (subdivisées `capRows` fois, plus les hauteurs `capY`), découpées en `capColumns` colonnes
   * régulières plus les demi-largeurs `capZ` (± z) ; les bords de région posés sur ces hauteurs et
   * ces largeurs sont nets (phares, calandre, bouclier, lunette). Sinon : éventail.
   * @param {number} ringIndex @param {boolean} atStart
   */
  const addCap = (ringIndex, atStart) => {
    const r = at(rings, ringIndex);
    const forward = atStart ? !outward : outward; // bouchon de départ : regarde vers −X ; de fin : vers +X
    /** @param {number} a @param {number} b @param {number} c */
    const tri = (a, b, c) => (forward ? tris.push(a, c, b) : tris.push(a, b, c));
    const halfN = m / 2;
    let grid = m % 2 === 0;
    if (grid) {
      for (let j = 1; j < halfN; j += 1) {
        const p = at(r.pts, j);
        const q = at(r.pts, m - j);
        if (Math.abs(p[0] + q[0]) > 1e-5 || Math.abs(p[1] - q[1]) > 1e-5 || p[0] < -1e-6) grid = false;
        // Une subdivision de Catmull-Rom peut redescendre de quelques millimètres dans un coin
        // serré : on tolère 2 cm (les rangées sont alors tenues à hauteur croissante).
        if (at(r.pts, j + 1)[1] < at(r.pts, j)[1] - 0.02) grid = false;
      }
    }
    if (!grid) {
      let cz = 0;
      let cy = 0;
      for (const [z, y] of r.pts) {
        cz += z;
        cy += y;
      }
      const center = pos.length / 3;
      pos.push(r.x, cy / m, cz / m);
      for (let j = 0; j < m; j += 1) tri(center, ringIndex * m + j, ringIndex * m + ((j + 1) % m));
      return;
    }
    const sub = Math.max(1, o.capRows ?? 2);
    // Rangées : (y, demi-largeur, sommet du contour au bout s'il y en a un), de bas en haut.
    /** @type {{ y: number, z: number, ring: number | null, ringLeft: number | null }[]} */
    const levels = [];
    let yPrev = -Infinity;
    for (let j = 0; j < halfN; j += 1) {
      const p0 = at(r.pts, j);
      const p1 = at(r.pts, j + 1);
      for (let s = 0; s < sub; s += 1) {
        const t = s / sub;
        const y = Math.max(yPrev, p0[1] + (p1[1] - p0[1]) * t);
        yPrev = y;
        levels.push({ y, z: Math.max(0, p0[0] + (p1[0] - p0[0]) * t), ring: s === 0 ? ringIndex * m + j : null, ringLeft: s === 0 ? ringIndex * m + ((m - j) % m) : null });
      }
    }
    levels.push({ y: Math.max(yPrev, at(r.pts, halfN)[1]), z: 0, ring: ringIndex * m + halfN, ringLeft: ringIndex * m + halfN });
    // Hauteurs imposées (capY) : rangées en plus, demi-largeur lue sur le contour.
    for (const yb of o.capY ?? []) {
      const k = levels.findIndex((l, i) => i > 0 && l.y > yb && /** @type {typeof l} */ (levels[i - 1]).y < yb);
      if (k < 0) continue;
      const lo = /** @type {typeof levels[number]} */ (levels[k - 1]);
      const hi = /** @type {typeof levels[number]} */ (levels[k]);
      const t = (yb - lo.y) / (hi.y - lo.y);
      levels.splice(k, 0, { y: yb, z: lo.z + (hi.z - lo.z) * t, ring: null, ringLeft: null });
    }
    // Colonnes : pas régulier sur toute la largeur, plus les abscisses imposées (capZ, ± z).
    const zMax = Math.max(...levels.map((l) => l.z));
    const cols = Math.max(2, (o.capColumns ?? 24) & ~1);
    /** @type {number[]} */
    let zs = [];
    for (let c = 0; c <= cols; c += 1) zs.push(-zMax + (2 * zMax * c) / cols);
    for (const zb of o.capZ ?? []) if (zb > 0 && zb < zMax) zs.push(zb, -zb);
    zs.sort((a, b) => a - b);
    zs = zs.filter((z, i) => i === 0 || z - /** @type {number} */ (zs[i - 1]) > 0.003);
    /** @type {number[][]} rangées d'indices de sommets, de −z à +z */
    const rows = levels.map((l) =>
      zs.map((z0) => {
        const z = Math.min(l.z, Math.max(-l.z, z0));
        if (l.ring !== null && z >= l.z - 1e-9) return l.ring;
        if (l.ringLeft !== null && z <= -l.z + 1e-9) return l.ringLeft;
        pos.push(r.x, l.y, z);
        return pos.length / 3 - 1;
      }),
    );
    for (let i = 0; i < rows.length - 1; i += 1)
      for (let c = 0; c < zs.length - 1; c += 1) {
        const a = at(at(rows, i), c);
        const b = at(at(rows, i), c + 1);
        const cc = at(at(rows, i + 1), c);
        const d = at(at(rows, i + 1), c + 1);
        tri(a, b, d);
        tri(a, d, cc);
      }
  };
  if (caps === 'both' || caps === 'start') addCap(0, true);
  if (caps === 'both' || caps === 'end') addCap(nr - 1, false);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geometry.setIndex(tris);
  const nonIndexed = geometry.toNonIndexed();
  const creased = toCreasedNormals(nonIndexed, ((o.crease ?? DEFAULT_CREASE) * Math.PI) / 180);

  const x0 = at(rings, 0).x;
  const x1 = at(rings, nr - 1).x;
  const pick = typeof o.material === 'string' ? () => /** @type {string} */ (o.material) : o.material;
  return splitByMaterial(creased, (t, f) => {
    // Indice de grille du triangle (hors bouchons) : u et v viennent de la grille.
    const quad = Math.floor(t / 2);
    const cap = t * 3 >= capStart;
    const i = cap ? 0 : Math.floor(quad / m);
    const j = cap ? 0 : quad % m;
    f.u = cap ? (f.x - x0 > (x1 - x0) / 2 ? 1 : 0) : (at(rings, i).x + at(rings, i + 1).x) / 2 - x0 === 0 ? 0 : ((at(rings, i).x + at(rings, i + 1).x) / 2 - x0) / (x1 - x0);
    f.v = (j + 0.5) / m;
    f.cap = cap;
    return pick(f);
  });
}

/**
 * Répartit les triangles d'une géométrie non indexée (avec normales) entre matériaux.
 * @param {BufferGeometry} g
 * @param {(t: number, f: Face) => string} choose
 * @returns {Parts}
 */
export function splitByMaterial(g, choose) {
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  /** @type {Map<string, number[]>} */
  const byMat = new Map();
  const count = p.count / 3;
  const e1 = new Vector3();
  const e2 = new Vector3();
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let t = 0; t < count; t += 1) {
    a.fromBufferAttribute(p, 3 * t);
    b.fromBufferAttribute(p, 3 * t + 1);
    c.fromBufferAttribute(p, 3 * t + 2);
    const fn = e1.subVectors(b, a).cross(e2.subVectors(c, a));
    if (fn.lengthSq() < 1e-20) continue; // triangle dégénéré : on l'écarte
    fn.normalize();
    /** @type {Face} */
    const f = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3, z: (a.z + b.z + c.z) / 3, nx: fn.x, ny: fn.y, nz: fn.z, u: 0, v: 0, cap: false };
    const mat = choose(t, f);
    let list = byMat.get(mat);
    if (!list) byMat.set(mat, (list = []));
    list.push(t);
  }
  /** @type {Parts} */
  const parts = [];
  for (const [material, list] of [...byMat.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    const pa = new Float32Array(list.length * 9);
    const na = new Float32Array(list.length * 9);
    list.forEach((t, k) => {
      for (let s = 0; s < 9; s += 1) {
        pa[k * 9 + s] = /** @type {number} */ (p.array[t * 9 + s]);
        na[k * 9 + s] = /** @type {number} */ (n.array[t * 9 + s]);
      }
    });
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pa, 3));
    geo.setAttribute('normal', new BufferAttribute(na, 3));
    parts.push({ material, geometry: mergeVertices(geo, 1e-6) });
  }
  return parts;
}

// ---------------------------------------------------------------------------------------------
// Révolution, tube, extrusion, formes simples

/**
 * Révolution d'un profil [r, h] autour de l'axe donné (z par défaut : une roue ; h suit l'axe).
 * Règle d'orientation : dessine le profil r vers la droite, h vers le haut, et parcours-le en
 * laissant la matière à ta gauche ; le dehors visible est à ta droite (un profil qui monte à r
 * constant donne un cylindre vu de l'extérieur ; un dessus se parcourt de l'extérieur vers l'axe).
 * Une surface vue des deux côtés : doubleSided().
 * @param {P2[]} profile
 * @param {{ material: string, segments?: number, axis?: 'x' | 'y' | 'z', crease?: number, phiStart?: number, phiLength?: number }} o
 * @returns {Parts}
 */
export function lathe(profile, o) {
  const g = new LatheGeometry(profile.map(([r, h]) => new Vector2(Math.max(0, r), h)), o.segments ?? 48, o.phiStart ?? 0, o.phiLength ?? Math.PI * 2);
  orientAxis(g, o.axis ?? 'z');
  return [{ material: o.material, geometry: smooth(g, o.crease ?? DEFAULT_CREASE) }];
}

/**
 * Tourne une géométrie construite autour de Y pour que cet axe devienne `axis`.
 * @param {BufferGeometry} g @param {'x' | 'y' | 'z'} axis
 */
function orientAxis(g, axis) {
  if (axis === 'z') g.rotateX(Math.PI / 2);
  else if (axis === 'x') g.rotateZ(-Math.PI / 2);
}

/**
 * Tube de rayon constant le long d'une courbe lisse (Catmull-Rom) passant par les points.
 * @param {P3[]} points
 * @param {{ material: string, radius: number, segments?: number, radial?: number, closed?: boolean, caps?: boolean }} o
 *   segments : pas le long de la courbe (8 par point par défaut) ; radial : côtés (12)
 * @returns {Parts}
 */
export function tube(points, o) {
  const curve = new CatmullRomCurve3(points.map((p) => new Vector3(...p)), o.closed ?? false, 'centripetal');
  const g = new TubeGeometry(curve, o.segments ?? points.length * 8, o.radius, o.radial ?? 12, o.closed ?? false);
  /** @type {Parts} */
  const parts = [{ material: o.material, geometry: clean(g) }];
  if (!o.closed && (o.caps ?? true)) {
    for (const t of [0, 1]) {
      const p = curve.getPointAt(t);
      const d = curve.getTangentAt(t);
      const disc = new CylinderGeometry(o.radius, o.radius, 1e-4, o.radial ?? 12, 1, false);
      const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), d);
      disc.applyQuaternion(q).translate(p.x, p.y, p.z);
      parts.push({ material: o.material, geometry: smooth(disc, 30) });
    }
  }
  return parts;
}

/**
 * Extrusion à bords arrondis d'un contour fermé [u, v] (sens indifférent), épaisseur `depth`
 * centrée sur le plan du contour. axis 'z' : (u, v) = (x, y) ; 'x' : (u, v) = (z, y), épaisseur
 * le long de X ; 'y' : (u, v) = (x, z), épaisseur le long de Y. `holes` : contours à percer.
 * @param {P2[]} outline
 * @param {{ material: string, depth: number, bevel?: number, bevelSegments?: number, holes?: P2[][], axis?: 'x' | 'y' | 'z', curveSegments?: number, crease?: number }} o
 * @returns {Parts}
 */
export function roundedExtrude(outline, o) {
  const shape = new Shape(outline.map(([u, v]) => new Vector2(u, v)));
  for (const h of o.holes ?? []) shape.holes.push(new Path(h.map(([u, v]) => new Vector2(u, v))));
  const bevel = Math.min(o.bevel ?? 0, o.depth / 2 - 1e-5);
  const g = new ExtrudeGeometry(shape, {
    depth: Math.max(1e-5, o.depth - 2 * bevel),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: o.bevelSegments ?? 3,
    curveSegments: o.curveSegments ?? 12,
  });
  g.translate(0, 0, -(o.depth - 2 * bevel) / 2);
  const axis = o.axis ?? 'z';
  if (axis === 'x') g.applyMatrix4(new Matrix4().makeBasis(new Vector3(0, 0, 1), new Vector3(0, 1, 0), new Vector3(1, 0, 0)));
  if (axis === 'y') g.applyMatrix4(new Matrix4().makeBasis(new Vector3(1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 1, 0)));
  // Ces deux bases échangent deux axes (déterminant −1) : il faut remettre les triangles à l'endroit.
  const geo = axis === 'z' ? g : fixWinding(g);
  return [{ material: o.material, geometry: smooth(geo, o.crease ?? 40) }];
}

/**
 * Remet à l'endroit une géométrie dont la base a changé d'orientation (déterminant négatif).
 * @param {BufferGeometry} g
 */
function fixWinding(g) {
  const ni = g.index ? g.toNonIndexed() : g;
  const p = ni.getAttribute('position');
  for (let i = 0; i < p.count; i += 3) {
    const x = p.getX(i + 1);
    const y = p.getY(i + 1);
    const z = p.getZ(i + 1);
    p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
    p.setXYZ(i + 2, x, y, z);
  }
  ni.deleteAttribute('normal');
  return ni;
}

/**
 * Contour de rectangle arrondi centré (largeur w, hauteur h, rayon r), sens trigonométrique.
 * @param {number} w @param {number} h @param {number} r @param {number} [n] points par coin
 * @returns {P2[]}
 */
export function roundedRect(w, h, r, n = 6) {
  const rr = Math.min(r, w / 2 - 1e-5, h / 2 - 1e-5);
  /** @type {P2[]} */
  const pts = [];
  const corners = /** @type {[number, number, number][]} */ ([
    [w / 2 - rr, -h / 2 + rr, -90],
    [w / 2 - rr, h / 2 - rr, 0],
    [-w / 2 + rr, h / 2 - rr, 90],
    [-w / 2 + rr, -h / 2 + rr, 180],
  ]);
  for (const [cx, cy, a0] of corners)
    for (let i = 0; i <= n; i += 1) {
      const a = ((a0 + (90 * i) / n) * Math.PI) / 180;
      pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
    }
  return pts;
}

/**
 * Contour de cercle (centre, rayon, n côtés), sens trigonométrique.
 * @param {number} cx @param {number} cy @param {number} r @param {number} [n]
 * @returns {P2[]}
 */
export function circle(cx, cy, r, n = 24) {
  return Array.from({ length: n }, (_, i) => /** @type {P2} */ ([cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]));
}

/**
 * Cylindre plein (rayon r, longueur len) d'un point à un autre, bouts plats.
 * @param {P3} from @param {P3} to @param {number} r @param {{ material: string, radial?: number, top?: number }} o
 * @returns {Parts}
 */
export function rod(from, to, r, o) {
  const a = new Vector3(...from);
  const b = new Vector3(...to);
  const d = b.clone().sub(a);
  const g = new CylinderGeometry(o.top ?? r, r, d.length(), o.radial ?? 10, 1, false);
  g.translate(0, d.length() / 2, 0);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), d.normalize()));
  g.translate(a.x, a.y, a.z);
  return [{ material: o.material, geometry: smooth(g, 40) }];
}

/**
 * Ellipsoïde (rayons rx, ry, rz) centré en `center`.
 * @param {P3} center @param {P3} radii @param {{ material: string, segments?: number }} o
 * @returns {Parts}
 */
export function ellipsoid(center, radii, o) {
  const s = o.segments ?? 24;
  const g = new SphereGeometry(1, s, Math.max(6, Math.round(s / 2)));
  g.scale(...radii).translate(...center);
  return [{ material: o.material, geometry: smooth(g, 80) }];
}

// ---------------------------------------------------------------------------------------------
// Optiques

/**
 * Optique : un fond allumé (`material` : lamp, tail ou signal) sous un verre bombé (glass), sur un
 * contour [u, v] quelconque (étoilé autour de son centre : trapèze, rond, goutte). Modelée face
 * vers +Z local, base en z = 0 : à poser avec orient().
 * @param {P2[]} outline
 * @param {{ material: 'lamp' | 'tail' | 'signal', bulge?: number, depth?: number, rings?: number, glass?: boolean }} o
 *   bulge : bombé du verre au centre (m) ; depth : épaisseur du fond (m)
 * @returns {Parts}
 */
export function lamp(outline, o) {
  const bulge = o.bulge ?? 0.012;
  const depth = o.depth ?? 0.01;
  const rings = o.rings ?? 6;
  let cu = 0;
  let cv = 0;
  for (const [u, v] of outline) {
    cu += u;
    cv += v;
  }
  cu /= outline.length;
  cv /= outline.length;
  /**
   * Dôme sur le contour : anneaux qui rétrécissent vers le centre, hauteur en (1 − k²).
   * @param {number} z0 @param {number} h @param {number} shrink
   */
  const dome = (z0, h, shrink) => {
    const n = outline.length;
    /** @type {number[]} */
    const pos = [];
    for (let r = 0; r <= rings; r += 1) {
      const k = 1 - r / rings; // 1 au bord, 0 au centre
      for (const [u, v] of outline) pos.push(cu + (u - cu) * k * shrink, cv + (v - cv) * k * shrink, z0 + h * (1 - k * k));
    }
    pos.push(cu, cv, z0 + h);
    /** @type {number[]} */
    const idx = [];
    let area = 0;
    for (let i = 0; i < n; i += 1) {
      const a = at(outline, i);
      const b = at(outline, (i + 1) % n);
      area += a[0] * b[1] - b[0] * a[1];
    }
    const ccw = area > 0;
    for (let r = 0; r < rings; r += 1)
      for (let i = 0; i < n; i += 1) {
        const a = r * n + i;
        const b = r * n + ((i + 1) % n);
        const c = (r + 1) * n + i;
        const d = (r + 1) * n + ((i + 1) % n);
        if (ccw) idx.push(a, b, d, a, d, c);
        else idx.push(a, d, b, a, c, d);
      }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(idx);
    return smooth(g, 70);
  };
  /** @type {Parts} */
  const parts = [{ material: o.material, geometry: dome(0, depth, 1) }];
  if (o.glass ?? true) parts.push({ material: 'glass', geometry: dome(0.002, depth + bulge, 1.02) });
  return parts;
}

// ---------------------------------------------------------------------------------------------
// Roues

/**
 * Pneu (révolution autour de Z, flanc extérieur vers +Z) à flanc bombé.
 * @param {{ outer: number, rim: number, width: number, moto?: boolean, segments?: number }} o
 *   outer : rayon extérieur ; rim : rayon de la jante (17 pouces : 0,216) ; moto : profil rond
 * @returns {Parts}
 */
export function tire(o) {
  const w = o.width / 2;
  const R = o.outer;
  const r = o.rim;
  const side = R - r;
  /** @type {P2[]} profil [rayon, z], du talon intérieur (−z) au talon extérieur (+z) */
  let prof;
  if (o.moto) {
    // Section presque ronde : demi-cercle sur la bande, flancs qui rentrent vers la jante.
    prof = [[r + 0.004, -w * 0.7], [r + side * 0.35, -w * 1.0]];
    for (let i = 0; i <= 12; i += 1) {
      const a = Math.PI * (-0.5 + i / 12);
      prof.push([R - w + w * Math.cos(a), w * Math.sin(a)]);
    }
    prof.push([r + side * 0.35, w * 1.0], [r + 0.004, w * 0.7]);
  } else {
    const sh = Math.min(0.035, side * 0.3); // rayon d'épaule
    prof = [
      [r + 0.004, -w + 0.012],
      [r + side * 0.25, -w - 0.006],
      [r + side * 0.6, -w - 0.008],
      [R - sh, -w + 0.002],
    ];
    for (let i = 1; i < 6; i += 1) {
      const a = (Math.PI / 2) * (i / 6);
      prof.push([R - sh + sh * Math.sin(a), -w + sh - sh * Math.cos(a)]);
    }
    prof.push([R, -w + sh], [R, 0], [R, w - sh]);
    for (let i = 1; i < 6; i += 1) {
      const a = (Math.PI / 2) * (i / 6);
      prof.push([R - sh + sh * Math.cos(a), w - sh + sh * Math.sin(a)]);
    }
    prof.push([R - sh, w - 0.002], [r + side * 0.6, w + 0.008], [r + side * 0.25, w + 0.006], [r + 0.004, w - 0.012]);
  }
  // Le profil va de −z à +z en passant par la bande de roulement : la matière est à sa gauche,
  // le dehors à sa droite (règle de lathe).
  return lathe(prof, { material: 'rubber', segments: o.segments ?? 72, crease: 60 });
}

/**
 * Jante complète (révolution autour de Z, face extérieure vers +Z), sans pneu.
 * style 'tole' : voile plat percé d'une couronne de trous ronds ; 'branches' : moyeu et branches ;
 * 'rayons' : rayons croisés fins (moto). Le voile et les branches prennent `material` (une zone
 * paint_<…> pour qu'ils se colorent) ; moyeu en black, écrous en chrome, rayons en `spokeMaterial`.
 * @param {{ rim: number, width: number, style: 'tole' | 'branches' | 'rayons', material: string,
 *   holes?: number, spokes?: number, offset?: number, barrelMaterial?: string, spokeMaterial?: string, hubRadius?: number, segments?: number }} o
 * @returns {Parts}
 */
export function rim(o) {
  const w = o.width / 2;
  const r = o.rim;
  const seg = o.segments ?? 48;
  const barrelMat = o.barrelMaterial ?? o.material;
  const face = Math.min(w - 0.015, o.offset ?? w * 0.45); // z du voile
  /** @type {Parts} */
  const parts = [];
  // Fût : rebord extérieur, creux, rebord intérieur ; visible des deux côtés.
  const barrel = lathe(
    [
      [r - 0.012, -w + 0.006],
      [r + 0.012, -w + 0.004],
      [r + 0.014, -w + 0.012],
      [r - 0.006, -w + 0.02],
      [r - 0.014, -w * 0.3],
      [r - 0.014, w * 0.4],
      [r - 0.006, w - 0.02],
      [r + 0.014, w - 0.012],
      [r + 0.012, w - 0.004],
      [r - 0.012, w - 0.006],
    ],
    { material: barrelMat, segments: seg, crease: 55 },
  );
  parts.push({ material: barrelMat, geometry: doubleSided(at(barrel, 0).geometry) });
  const hubR = o.hubRadius ?? r * 0.3;
  if (o.style === 'tole') {
    const holes = o.holes ?? 14;
    const ringR = (hubR + r * 0.9) / 2 + r * 0.04;
    const holeR = Math.min(0.02, (Math.PI * ringR) / holes / 2.4);
    /** @type {P2[][]} */
    const hs = [];
    for (let i = 0; i < holes; i += 1) {
      const a = (2 * Math.PI * i) / holes;
      hs.push(circle(ringR * Math.cos(a), ringR * Math.sin(a), holeR, 12).reverse());
    }
    hs.push(circle(0, 0, hubR * 0.55, 24).reverse());
    // Voile légèrement embouti : un disque percé et une couronne tronconique qui rejoint le fût.
    parts.push(...place(roundedExtrude(circle(0, 0, r * 0.86, seg), { material: o.material, depth: 0.008, bevel: 0.003, bevelSegments: 2, holes: hs }), { position: [0, 0, face] }));
    parts.push(...lathe([[r - 0.012, face - 0.03], [r * 0.93, face - 0.005], [r * 0.85, face + 0.004]], { material: o.material, segments: seg, crease: 70 }).map((p) => ({ material: p.material, geometry: doubleSided(p.geometry) })));
  } else if (o.style === 'branches') {
    const n = o.spokes ?? 5;
    for (let i = 0; i < n; i += 1) {
      const a = (2 * Math.PI * i) / n;
      const spoke = roundedExtrude(
        [
          [hubR * 0.8, -0.022],
          [r - 0.01, -0.03],
          [r - 0.01, 0.03],
          [hubR * 0.8, 0.022],
        ],
        { material: o.material, depth: 0.02, bevel: 0.006 },
      );
      parts.push(...place(spoke, { position: [0, 0, face - 0.005], rotation: [0, 0, a] }));
    }
    parts.push(...lathe([[hubR, face - 0.03], [hubR, face], [hubR * 0.7, face + 0.012], [0, face + 0.012]], { material: o.material, segments: 40, crease: 50 }));
  } else {
    const n = o.spokes ?? 36;
    const flange = Math.min(w * 0.7, 0.05);
    parts.push(...lathe([[0, -flange - 0.01], [hubR, -flange], [hubR * 0.6, -flange * 0.5], [hubR * 0.6, flange * 0.5], [hubR, flange], [0, flange + 0.01]], { material: 'alu', segments: 32, crease: 50 }));
    for (let i = 0; i < n; i += 1) {
      const a = (2 * Math.PI * i) / n;
      const sideZ = i % 2 === 0 ? flange : -flange;
      const lead = ((i % 4 < 2 ? 1 : -1) * (2 * Math.PI)) / n * 3;
      /** @type {P3} */
      const from = [hubR * 0.92 * Math.cos(a), hubR * 0.92 * Math.sin(a), sideZ];
      /** @type {P3} */
      const to = [(r - 0.012) * Math.cos(a + lead), (r - 0.012) * Math.sin(a + lead), sideZ * 0.15];
      parts.push(...rod(from, to, 0.0022, { material: o.spokeMaterial ?? 'chrome', radial: 5 }));
    }
  }
  // Moyeu et écrous (voiture) : cache noir et cinq écrous.
  if (o.style !== 'rayons') {
    parts.push(...lathe([[hubR * 0.52, face - 0.01], [hubR * 0.5, face + 0.015], [hubR * 0.4, face + 0.028], [0, face + 0.03]], { material: 'black', segments: 32, crease: 50 }));
    for (let i = 0; i < 5; i += 1) {
      const a = (2 * Math.PI * i) / 5 + Math.PI / 10;
      const rr = hubR * 0.72;
      parts.push(...rod([rr * Math.cos(a), rr * Math.sin(a), face], [rr * Math.cos(a), rr * Math.sin(a), face + 0.016], 0.0095, { material: 'chrome', radial: 6 }));
    }
    // Fond sombre derrière le voile (disque de frein dans l'ombre) : les trous se lisent en noir.
    parts.push(...lathe([[r * 0.35, face - 0.06], [r * 0.78, face - 0.06], [r * 0.78, face - 0.045], [r * 0.35, face - 0.045]], { material: 'black', segments: 40, crease: 50 }));
  }
  return parts;
}

/**
 * Roue complète (jante + pneu), autour de Z, face extérieure vers +Z, centre à l'origine.
 * @param {Parameters<typeof rim>[0] & { outer: number, moto?: boolean }} o
 * @returns {Parts}
 */
export function wheel(o) {
  return [...tire({ outer: o.outer, rim: o.rim, width: o.width, moto: o.moto }), ...rim(o)];
}

// ---------------------------------------------------------------------------------------------
// Modèle

/**
 * @typedef {{ color?: string, metallic?: number, roughness?: number, emissive?: string, emissiveStrength?: number, alpha?: number }} MaterialOverride
 */

/** Valeurs PBR par rôle (le rendu de l'app les remplace par les siennes ; elles servent ailleurs). */
const ROLE_PBR = /** @type {Record<string, Required<Pick<MaterialOverride, 'color' | 'metallic' | 'roughness'>> & MaterialOverride>} */ ({
  paint: { color: '#c8c8c8', metallic: 0, roughness: 0.35 },
  chrome: { color: '#f2f2f2', metallic: 1, roughness: 0.05 },
  alu: { color: '#d6d8dc', metallic: 1, roughness: 0.32 },
  black: { color: '#0b0b0d', metallic: 0, roughness: 0.55 },
  rubber: { color: '#121212', metallic: 0, roughness: 0.9 },
  glass: { color: '#10141a', metallic: 0, roughness: 0.05, alpha: 0.45 },
  leather: { color: '#1d1512', metallic: 0, roughness: 0.6 },
  lamp: { color: '#f4f4f0', metallic: 0, roughness: 0.15, emissive: '#fff6e8', emissiveStrength: 1 },
  tail: { color: '#7a0808', metallic: 0, roughness: 0.2, emissive: '#ff1a10', emissiveStrength: 1 },
  signal: { color: '#ff8a1a', metallic: 0, roughness: 0.2, emissive: '#ff7a00', emissiveStrength: 1 },
});

/** @param {string} name */
export function rolePbr(name) {
  return { ...(ROLE_PBR[name.startsWith('paint_') ? 'paint' : name] ?? ROLE_PBR.paint) };
}

export class Model {
  /** @param {string} id identifiant du véhicule (nom du nœud racine) */
  constructor(id) {
    this.id = id;
    /** @type {Map<string, MaterialOverride>} */
    this.overrides = new Map();
    /** @type {Map<string, { parts: Parts, position?: P3, rotation?: P3, mesh?: string }>} */
    this.nodes = new Map();
    /** @type {Map<string, Parts>} */
    this.meshes = new Map();
  }

  /**
   * Règle les valeurs PBR d'un matériau (couleur d'origine d'une zone, par exemple).
   * @param {string} name @param {MaterialOverride} o
   */
  material(name, o) {
    checkMaterial(name);
    this.overrides.set(name, { ...(this.overrides.get(name) ?? {}), ...o });
    return this;
  }

  /**
   * Ajoute des pièces à un nœud (créé au besoin). Nœud = un objet nommé du GLB.
   * @param {string} node @param {Parts} parts
   */
  add(node, parts) {
    checkNode(node);
    for (const p of parts) checkMaterial(p.material);
    const n = this.nodes.get(node) ?? { parts: [] };
    if (n.mesh) throw new Error(`nœud « ${node} » : déjà une instance`);
    n.parts.push(...parts);
    this.nodes.set(node, n);
    return this;
  }

  /**
   * Déclare un maillage partagé (une roue) : écrit une fois, posé par instance().
   * @param {string} name @param {Parts} parts
   */
  shared(name, parts) {
    for (const p of parts) checkMaterial(p.material);
    this.meshes.set(name, parts);
    return this;
  }

  /**
   * Pose un maillage partagé dans un nœud à lui, déplacé et tourné (angles d'Euler XYZ, radians).
   * @param {string} node @param {string} mesh @param {{ position?: P3, rotation?: P3 }} t
   */
  instance(node, mesh, t) {
    checkNode(node);
    if (!this.meshes.has(mesh)) throw new Error(`maillage partagé « ${mesh} » inconnu`);
    if (this.nodes.has(node)) throw new Error(`nœud « ${node} » déjà pris`);
    this.nodes.set(node, { parts: [], mesh, position: t.position, rotation: t.rotation });
    return this;
  }

  /** Écrit le GLB et rend ses octets avec un résumé chiffré. */
  toGlb() {
    /** @type {string[]} */
    const materialNames = [];
    const matIndex = (/** @type {string} */ name) => {
      let i = materialNames.indexOf(name);
      if (i < 0) {
        materialNames.push(name);
        i = materialNames.length - 1;
      }
      return i;
    };
    /** @type {{ name: string, primitives: { material: number, positions: Float32Array, normals: Float32Array, indices: Uint32Array }[] }[]} */
    const meshes = [];
    /** @type {Map<string, number>} */
    const meshIndex = new Map();
    /** @param {string} name @param {Parts} parts */
    const buildMesh = (name, parts) => {
      /** @type {Map<string, BufferGeometry[]>} */
      const byMat = new Map();
      for (const p of parts) {
        const g = clean(p.geometry);
        const list = byMat.get(p.material) ?? [];
        list.push(g);
        byMat.set(p.material, list);
      }
      const prims = [...byMat.keys()].sort().map((mat) => {
        const merged = mergeGeometries(/** @type {BufferGeometry[]} */ (byMat.get(mat)));
        const pos = /** @type {Float32Array} */ (merged.getAttribute('position').array);
        const nor = new Float32Array(/** @type {Float32Array} */ (merged.getAttribute('normal').array));
        for (let i = 0; i < nor.length; i += 3) {
          const l = Math.hypot(at(nor, i), at(nor, i + 1), at(nor, i + 2)) || 1;
          nor[i] = at(nor, i) / l;
          nor[i + 1] = at(nor, i + 1) / l;
          nor[i + 2] = at(nor, i + 2) / l;
        }
        return { material: matIndex(mat), positions: new Float32Array(pos), normals: nor, indices: Uint32Array.from(/** @type {ArrayLike<number>} */ (merged.index?.array ?? [])) };
      });
      meshes.push({ name, primitives: prims });
      return meshes.length - 1;
    };
    for (const [name, parts] of this.meshes) meshIndex.set(name, buildMesh(name, parts));
    /** @type {{ name: string, mesh?: number, translation?: number[], rotation?: number[], children?: number[] }[]} */
    const nodes = [{ name: this.id, children: [] }];
    for (const [name, n] of this.nodes) {
      /** @type {{ name: string, mesh?: number, translation?: number[], rotation?: number[] }} */
      const node = { name };
      node.mesh = n.mesh ? meshIndex.get(n.mesh) : buildMesh(name, n.parts);
      if (n.position) node.translation = [...n.position];
      if (n.rotation) {
        const q = new Quaternion().setFromEuler(new Euler(...n.rotation));
        node.rotation = [q.x, q.y, q.z, q.w].map((v) => (Math.abs(v) < 1e-12 ? 0 : v));
      }
      nodes.push(node);
      /** @type {number[]} */ (at(nodes, 0).children).push(nodes.length - 1);
    }
    const materials = materialNames.map((name) => /** @type {import('./glb-writer.mjs').GlbMaterial} */ ({ name, ...rolePbr(name), ...(this.overrides.get(name) ?? {}) }));
    const bytes = writeGlb({ nodes, meshes, materials, generator: 'PimpMyBichon tools/vehicles' });
    return { bytes, materials: materialNames, nodes: nodes.map((n) => n.name) };
  }
}

/** @param {string} name */
function checkMaterial(name) {
  if (!MATERIAL_NAME.test(name)) throw new Error(`matériau « ${name} » hors conventions (paint_<zone>, chrome, alu, black, rubber, glass, leather, lamp, tail, signal)`);
}

/** @param {string} name */
function checkNode(name) {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`nœud « ${name} » : minuscules, chiffres et _ seulement`);
}
