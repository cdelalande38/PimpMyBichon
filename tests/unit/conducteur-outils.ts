// Outils des tests du conducteur à bord (tests/unit/conducteur-*.test.ts) : le conducteur fabriqué
// en mémoire (tools/vehicles/conducteur.mjs) et monté comme dans l'app (src/scene/vehicle/
// conducteur.ts), le véhicule fabriqué avec ses sièges et son volant posés sur leurs ancres, ses
// points posés (peau calculée sur le processeur), et la recherche des traversées : une arête du
// corps qui coupe un triangle du véhicule.

import { readFileSync } from 'node:fs';
import { DoubleSide, Group, Mesh, SkinnedMesh, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as conducteur from '../../tools/vehicles/conducteur.mjs';
import * as habitacle from '../../tools/vehicles/habitacle.mjs';
import { validateManifest } from '../../src/data/vehicles.ts';
import type { VehicleManifest } from '../../src/data/vehicleTypes.ts';
import { buildDriverRig, type DriverRig } from '../../src/scene/vehicle/conducteur.ts';

export const manifest = (id: string): VehicleManifest =>
  validateManifest(JSON.parse(readFileSync(new URL(`../../public/assets/vehicles/${id}/vehicle.json`, import.meta.url), 'utf8')), id);

const glbCache = new Map<string, Promise<Group>>();

/** Le conducteur d'une tenue, fabriqué en mémoire et monté comme dans l'app. */
export async function driverRig(outfitId: string): Promise<DriverRig> {
  let scene = glbCache.get(outfitId);
  if (!scene) {
    const catalogue = conducteur.readCatalogue();
    const outfit = catalogue.outfits.find((o) => o.id === outfitId);
    if (!outfit) throw new Error(`tenue ${outfitId} inconnue`);
    const bytes = conducteur.buildDriver(outfit, catalogue).toGlb().bytes;
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    scene = new GLTFLoader().parseAsync(buffer, '').then((gltf) => gltf.scene);
    glbCache.set(outfitId, scene);
  }
  return buildDriverRig((await scene).clone(true));
}

/** Pose le volant `id` (catalogue) sur l'ancre du volant, comme l'app (groupe habitacle_pose). */
export function poseSteering(model: Object3D, id: string): void {
  const anchor = model.getObjectByName('volant');
  if (!anchor) return;
  const entry = habitacle.readCatalogue().steering.find((item) => item.id === id);
  if (!entry) throw new Error(`volant ${id} absent du catalogue`);
  const group = new Group();
  group.name = 'habitacle_pose';
  for (const part of habitacle.buildSteering(entry)) {
    const mesh = new Mesh(part.geometry);
    (mesh.material as { side: number }).side = DoubleSide;
    mesh.name = 'volant_pose';
    group.add(mesh);
  }
  anchor.add(group);
  model.updateMatrixWorld(true);
}

/** Sommets posés du conducteur (repère de sa racine) et triangles, avec l'os principal de chaque sommet. */
export function posedDriver(rig: DriverRig): { points: Vector3[]; bones: number[]; triangles: Array<[number, number, number]> } {
  rig.root.updateMatrixWorld(true);
  const points: Vector3[] = [];
  const bones: number[] = [];
  const triangles: Array<[number, number, number]> = [];
  for (const mesh of rig.meshes as SkinnedMesh[]) {
    const position = mesh.geometry.getAttribute('position');
    const skinIndex = mesh.geometry.getAttribute('skinIndex');
    const skinWeight = mesh.geometry.getAttribute('skinWeight');
    const base = points.length;
    for (let i = 0; i < position.count; i += 1) {
      const v = new Vector3().fromBufferAttribute(position, i);
      mesh.applyBoneTransform(i, v);
      points.push(v.applyMatrix4(mesh.matrixWorld));
      bones.push(skinWeight.getX(i) >= skinWeight.getY(i) ? skinIndex.getX(i) : skinIndex.getY(i));
    }
    const index = mesh.geometry.getIndex()!;
    for (let i = 0; i + 2 < index.count; i += 3) triangles.push([base + index.getX(i), base + index.getX(i + 1), base + index.getX(i + 2)]);
  }
  return { points, bones, triangles };
}

interface Tri {
  a: Vector3;
  b: Vector3;
  c: Vector3;
  name: string;
}

/** Triangles du véhicule (repère du modèle) dont la boîte touche `min`–`max`, hors pièces écartées. */
export function vehicleTriangles(model: Object3D, min: Vector3, max: Vector3, skip: (object: Object3D) => boolean): Tri[] {
  model.updateMatrixWorld(true);
  const out: Tri[] = [];
  model.traverse((object) => {
    if (!(object instanceof Mesh) || skip(object)) return;
    const position = object.geometry.getAttribute('position');
    const index = object.geometry.getIndex();
    const count = index ? index.count : position.count;
    const name = object.name || object.parent?.name || '';
    for (let i = 0; i + 2 < count; i += 3) {
      const [ia, ib, ic] = index ? [index.getX(i), index.getX(i + 1), index.getX(i + 2)] : [i, i + 1, i + 2];
      const a = new Vector3().fromBufferAttribute(position, ia).applyMatrix4(object.matrixWorld);
      const b = new Vector3().fromBufferAttribute(position, ib).applyMatrix4(object.matrixWorld);
      const c = new Vector3().fromBufferAttribute(position, ic).applyMatrix4(object.matrixWorld);
      if (Math.max(a.x, b.x, c.x) < min.x || Math.min(a.x, b.x, c.x) > max.x) continue;
      if (Math.max(a.y, b.y, c.y) < min.y || Math.min(a.y, b.y, c.y) > max.y) continue;
      if (Math.max(a.z, b.z, c.z) < min.z || Math.min(a.z, b.z, c.z) > max.z) continue;
      out.push({ a, b, c, name });
    }
  });
  return out;
}

const CELL = 0.04;
const key = (i: number, j: number, k: number) => `${i},${j},${k}`;

/** Grille de triangles, pour chercher vite les traversées et les marges. */
export class TriangleGrid {
  private readonly cells = new Map<string, number[]>();
  readonly tris: Tri[];
  constructor(tris: Tri[]) {
    this.tris = tris;
    tris.forEach((t, n) => {
      const lo = [Math.min(t.a.x, t.b.x, t.c.x), Math.min(t.a.y, t.b.y, t.c.y), Math.min(t.a.z, t.b.z, t.c.z)].map((v) => Math.floor(v / CELL));
      const hi = [Math.max(t.a.x, t.b.x, t.c.x), Math.max(t.a.y, t.b.y, t.c.y), Math.max(t.a.z, t.b.z, t.c.z)].map((v) => Math.floor(v / CELL));
      for (let i = lo[0]!; i <= hi[0]!; i += 1)
        for (let j = lo[1]!; j <= hi[1]!; j += 1)
          for (let k = lo[2]!; k <= hi[2]!; k += 1) {
            const id = key(i, j, k);
            const list = this.cells.get(id);
            if (list) list.push(n);
            else this.cells.set(id, [n]);
          }
    });
  }

  near(min: Vector3, max: Vector3): Set<number> {
    const found = new Set<number>();
    for (let i = Math.floor(min.x / CELL); i <= Math.floor(max.x / CELL); i += 1)
      for (let j = Math.floor(min.y / CELL); j <= Math.floor(max.y / CELL); j += 1)
        for (let k = Math.floor(min.z / CELL); k <= Math.floor(max.z / CELL); k += 1) for (const n of this.cells.get(key(i, j, k)) ?? []) found.add(n);
    return found;
  }
}

const e1 = new Vector3();
const e2 = new Vector3();
const h = new Vector3();
const s = new Vector3();
const q = new Vector3();

/** Le segment p→r coupe-t-il le triangle (Möller-Trumbore, bornes exclues) ? */
export function segmentHits(p: Vector3, r: Vector3, t: Tri): boolean {
  const dir = r.clone().sub(p);
  e1.subVectors(t.b, t.a);
  e2.subVectors(t.c, t.a);
  h.crossVectors(dir, e2);
  const det = e1.dot(h);
  if (Math.abs(det) < 1e-12) return false;
  const f = 1 / det;
  s.subVectors(p, t.a);
  const u = f * s.dot(h);
  if (u < 0 || u > 1) return false;
  q.crossVectors(s, e1);
  const v = f * dir.dot(q);
  if (v < 0 || u + v > 1) return false;
  const k = f * e2.dot(q);
  return k > 1e-6 && k < 1 - 1e-6;
}

/** Plus courte distance d'un point à un triangle. */
export function pointTriangle(p: Vector3, t: Tri): number {
  // Projection sur le plan, puis bords (assez précis pour une marge au millimètre).
  const ab = t.b.clone().sub(t.a);
  const ac = t.c.clone().sub(t.a);
  const n = new Vector3().crossVectors(ab, ac);
  const area = n.length();
  if (area < 1e-12) return p.distanceTo(t.a);
  n.divideScalar(area);
  const d = p.clone().sub(t.a).dot(n);
  const proj = p.clone().sub(n.clone().multiplyScalar(d));
  const inside = (x: Vector3, y: Vector3) => new Vector3().crossVectors(y.clone().sub(x), proj.clone().sub(x)).dot(n) >= 0;
  if (inside(t.a, t.b) && inside(t.b, t.c) && inside(t.c, t.a)) return Math.abs(d);
  const seg = (x: Vector3, y: Vector3) => {
    const xy = y.clone().sub(x);
    const k = Math.min(1, Math.max(0, p.clone().sub(x).dot(xy) / Math.max(1e-12, xy.lengthSq())));
    return p.distanceTo(x.clone().add(xy.multiplyScalar(k)));
  };
  return Math.min(seg(t.a, t.b), seg(t.b, t.c), seg(t.c, t.a));
}

/**
 * Traversées du corps posé dans le véhicule (arêtes du corps qui coupent un triangle), et marge :
 * plus courte distance des sommets du corps au véhicule. `exclude` : sommets écartés (mains sur la
 * prise, fesses sur l'assise, semelles sur les repose-pieds).
 */
export function crossings(
  driver: ReturnType<typeof posedDriver>,
  model: Object3D,
  skip: (object: Object3D) => boolean,
  exclude: (point: Vector3, bone: number) => boolean,
): { hits: Array<{ part: string; bone: number; at: Vector3 }>; margin: number; nearest: string } {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const p of driver.points) {
    min.min(p);
    max.max(p);
  }
  min.subScalar(0.06);
  max.addScalar(0.06);
  const grid = new TriangleGrid(vehicleTriangles(model, min, max, skip));
  const kept = driver.points.map((p, i) => !exclude(p, driver.bones[i]!));
  const hits: Array<{ part: string; bone: number; at: Vector3 }> = [];
  const lo = new Vector3();
  const hi = new Vector3();
  for (const [a, b, c] of driver.triangles) {
    for (const [i, j] of [[a, b], [b, c], [c, a]] as const) {
      if (!kept[i] || !kept[j]) continue;
      const p = driver.points[i]!;
      const r = driver.points[j]!;
      lo.copy(p).min(r);
      hi.copy(p).max(r);
      for (const n of grid.near(lo, hi)) {
        const t = grid.tris[n]!;
        if (segmentHits(p, r, t)) {
          hits.push({ part: t.name, bone: driver.bones[i]!, at: p.clone() });
          break;
        }
      }
      if (hits.length > 40) return { hits, margin: -1, nearest: '' };
    }
  }
  let margin = 0.05;
  let nearest = '';
  const reach = new Vector3(margin, margin, margin);
  driver.points.forEach((p, i) => {
    if (!kept[i]) return;
    for (const n of grid.near(p.clone().sub(reach), p.clone().add(reach))) {
      const t = grid.tris[n]!;
      const d = pointTriangle(p, t);
      if (d < margin) {
        margin = d;
        nearest = t.name;
      }
    }
  });
  return { hits, margin, nearest };
}
