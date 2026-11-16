// Vitrages vus de l'intérieur (§ 5.4) : depuis chaque point de vue intérieur d'une maquette, on voit
// le garage, ou la route, par les vitres. On le mesure sur les modèles générés, sans rendu : un rayon
// part de l'œil vers des points de chaque vitre ; il traverse les couches de vitrage qui regardent
// l'œil (seules dessinées : une face, src/scene/vehicle/VehicleModel.tsx, makeGlass). Et aucune
// vitre n'est doublée par l'intérieur : derrière chaque point de vitre, dans les 10 cm, rien
// (doublure de l'habitacle percée aux vitres).
//
// Seuil : vu de dedans, l'opacité apparente d'une vitre (1 − part de la lumière du dehors qui passe)
// reste sous 0,2 : au moins 80 % de la lumière du garage arrive à l'œil, quand l'ancien vitrage
// (0,55, vu de face) n'en laissait passer que 45 % et virait au noir sous les néons. Vu de dehors,
// le vitrage reste teinté (0,3 au moins) et ses reflets gardent leur force (opacité × part du reflet
// ≥ 0,5, l'ancien réglage donnait 0,55) : les néons du décor s'y lisent toujours.

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseGlb } from '../../tools/lib/glb.mjs';
import { buildVehicle } from '../../tools/vehicles/build.mjs';
import { GLASS_ROLE, glassLook, glassReflection, transmittance } from '../../src/data/materialRoles.ts';
import { INTERIOR_CATALOGUE } from '../../src/data/habitacle.ts';
import type { VehicleManifest } from '../../src/data/vehicleTypes.ts';
import { builtModel, poseSeats, resolveEye } from './places-modeles.ts';

type V3 = [number, number, number];

interface Triangles {
  /** Sommets a, b, c de chaque triangle, à plat (9 nombres par triangle). */
  positions: Float64Array;
  glass: Uint8Array;
  /** Vitre de la caisse (nœud « carrosserie ») : les verres d'optiques et de cadrans n'en sont pas. */
  pane: Uint8Array;
  count: number;
}

/** Triangles posés d'un GLB généré (nœuds sans rotation ni échelle, comme le kit les écrit). */
function trianglesOf(bytes: Uint8Array): Triangles {
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
  const out: number[] = [];
  const glass: number[] = [];
  const pane: number[] = [];
  for (const node of json.nodes as Array<{ name: string; mesh?: number; translation?: V3; rotation?: number[]; scale?: number[] }>) {
    if (node.mesh === undefined) continue;
    expect(node.rotation ?? [0, 0, 0, 1]).toEqual([0, 0, 0, 1]);
    const [tx, ty, tz] = node.translation ?? [0, 0, 0];
    for (const primitive of json.meshes[node.mesh].primitives) {
      const pos = view(primitive.attributes.POSITION);
      const idx = view(primitive.indices);
      const isGlass = json.materials[primitive.material].name === 'glass' ? 1 : 0;
      for (let i = 0; i < idx.length; i += 1) {
        const v = idx[i]! * 3;
        out.push(pos[v]! + tx, pos[v + 1]! + ty, pos[v + 2]! + tz);
        if (i % 3 !== 0) continue;
        glass.push(isGlass);
        pane.push(isGlass && node.name === 'carrosserie' ? 1 : 0);
      }
    }
  }
  return { positions: Float64Array.from(out), glass: Uint8Array.from(glass), pane: Uint8Array.from(pane), count: glass.length };
}

/** Distance le long du rayon (o, d unitaire) au triangle t, ou Infinity (Möller-Trumbore). */
function hit(p: Float64Array, t: number, o: V3, d: V3): number {
  const i = t * 9;
  const e1x = p[i + 3]! - p[i]!, e1y = p[i + 4]! - p[i + 1]!, e1z = p[i + 5]! - p[i + 2]!;
  const e2x = p[i + 6]! - p[i]!, e2y = p[i + 7]! - p[i + 1]!, e2z = p[i + 8]! - p[i + 2]!;
  const hx = d[1] * e2z - d[2] * e2y, hy = d[2] * e2x - d[0] * e2z, hz = d[0] * e2y - d[1] * e2x;
  const a = e1x * hx + e1y * hy + e1z * hz;
  if (Math.abs(a) < 1e-12) return Infinity;
  const f = 1 / a;
  const sx = o[0] - p[i]!, sy = o[1] - p[i + 1]!, sz = o[2] - p[i + 2]!;
  const u = f * (sx * hx + sy * hy + sz * hz);
  if (u < 0 || u > 1) return Infinity;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = f * (d[0] * qx + d[1] * qy + d[2] * qz);
  if (v < 0 || u + v > 1) return Infinity;
  const s = f * (e2x * qx + e2y * qy + e2z * qz);
  return s > 1e-6 ? s : Infinity;
}

/** Normale (sens des sommets, celui que le rendu tient pour l'endroit) et centre du triangle t. */
function frame(p: Float64Array, t: number): { n: V3; c: V3 } {
  const i = t * 9;
  const e1: V3 = [p[i + 3]! - p[i]!, p[i + 4]! - p[i + 1]!, p[i + 5]! - p[i + 2]!];
  const e2: V3 = [p[i + 6]! - p[i]!, p[i + 7]! - p[i + 1]!, p[i + 8]! - p[i + 2]!];
  const n: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const c: V3 = [(p[i]! + p[i + 3]! + p[i + 6]!) / 3, (p[i + 1]! + p[i + 4]! + p[i + 7]!) / 3, (p[i + 2]! + p[i + 5]! + p[i + 8]!) / 3];
  return { n, c };
}

interface Sight {
  /** Opacité apparente moyenne d'une vitre (1 − lumière du dehors qui passe), points non bouchés. */
  opacity: number;
  /** Part des points de vitre que l'œil ne voit pas (pièce de l'habitacle sur le chemin). */
  hidden: number;
  rays: number;
}

/**
 * Ce que voit un œil par les vitres, chaque couche de vitrage dessinée ayant l'opacité `opacity`.
 * `outside` : œil hors du véhicule, visant les seules vitres tournées vers lui.
 */
function sight(tri: Triangles, eye: V3, opacity: number, { maxRays = 240, outside = false } = {}): Sight {
  const glassIds: number[] = [];
  for (let t = 0; t < tri.count; t += 1) if (tri.pane[t]) glassIds.push(t);
  const panes = glassIds.filter((t) => {
    const { c, n } = frame(tri.positions, t);
    if (outside) return n[0] * (eye[0] - c[0]) + n[1] * (eye[1] - c[1]) + n[2] * (eye[2] - c[2]) > 0;
    return Math.hypot(c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]) < 3.5;
  });
  const step = Math.max(1, Math.floor(panes.length / maxRays));
  let sum = 0;
  let seen = 0;
  let hidden = 0;
  let rays = 0;
  for (let k = 0; k < panes.length; k += step) {
    const target = panes[k]!;
    const { c } = frame(tri.positions, target);
    const span: V3 = [c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]];
    const length = Math.hypot(...span);
    const d: V3 = [span[0] / length, span[1] / length, span[2] / length];
    rays += 1;
    const layers: number[] = [];
    let stop = false;
    for (let t = 0; t < tri.count; t += 1) {
      const s = hit(tri.positions, t, eye, d);
      if (s > length + 0.002) continue;
      if (tri.glass[t]) {
        const { n } = frame(tri.positions, t);
        // Dessinée seulement si elle regarde l'œil.
        if (n[0] * d[0] + n[1] * d[1] + n[2] * d[2] < 0) layers.push(opacity);
      } else {
        stop = true;
        break;
      }
    }
    if (stop) {
      hidden += 1;
      continue;
    }
    seen += 1;
    sum += 1 - transmittance(layers);
  }
  return { opacity: seen ? sum / seen : 1, hidden: rays ? hidden / rays : 1, rays };
}

/**
 * Part des points des vitres doublés par l'intérieur : une paroi à moins de 10 cm derrière, à peu
 * près parallèle à la vitre (une doublure). Une pièce de biais, comme le dessus d'une planche de
 * bord sous le pied du pare-brise, ne double pas la vitre : on voit dehors au-dessus.
 */
function lined(tri: Triangles): { share: number; panes: number } {
  let panes = 0;
  let covered = 0;
  for (let t = 0; t < tri.count; t += 1) {
    if (!tri.pane[t]) continue;
    const { n, c } = frame(tri.positions, t);
    const length = Math.hypot(...n);
    if (length < 1e-9) continue;
    const d: V3 = [-n[0] / length, -n[1] / length, -n[2] / length];
    panes += 1;
    for (let u = 0; u < tri.count; u += 1) {
      if (tri.glass[u]) continue;
      if (hit(tri.positions, u, c, d) < 0.1) {
        const m = frame(tri.positions, u).n;
        const parallel = Math.abs(m[0] * d[0] + m[1] * d[1] + m[2] * d[2]) / Math.max(1e-12, Math.hypot(...m));
        if (parallel < 0.95) continue;
        covered += 1;
        break;
      }
    }
  }
  return { share: panes ? covered / panes : 1, panes };
}

const manifestOf = (id: string) => JSON.parse(readFileSync(new URL(`../../public/assets/vehicles/${id}/vehicle.json`, import.meta.url), 'utf8')) as VehicleManifest;

describe('vitrage : réglage du rôle « glass »', () => {
  it('vu de dehors : teinté, reflets des néons gardés ; vu de dedans : presque incolore', () => {
    const outside = { opacity: GLASS_ROLE.opacity, envMapIntensity: GLASS_ROLE.envMapIntensity };
    expect(outside.opacity).toBeGreaterThanOrEqual(0.3);
    expect(glassReflection(outside)).toBeGreaterThanOrEqual(0.5);
    const inside = glassLook(outside, true);
    expect(1 - transmittance([inside.opacity])).toBeLessThan(0.2);
    expect(glassReflection(inside)).toBeLessThan(0.1);
    // Un vitrage adapté plus opaque (le concept, 0,55) est éclairci de même en vue intérieure.
    expect(glassLook({ opacity: 0.55, envMapIntensity: 1 }, true).opacity).toBeLessThan(0.2);
    expect(glassLook({ opacity: 0.55, envMapIntensity: 1 }, false)).toEqual({ opacity: 0.55, envMapIntensity: 1 });
  });
});

for (const id of ['van', 'cox']) {
  describe(`vitrage vu de l'intérieur : ${id}`, () => {
    const manifest = manifestOf(id);
    let tri: Triangles;
    // Les places (conducteur, passager, arrière) n'ont plus d'œil écrit : il se pose sur le siège, au
    // chargement. On le résout ici comme la scène, sièges d'origine posés sur leurs ancres.
    const views = [manifest.interiorView, ...(manifest.interiorViews ?? [])].filter((view) => view !== undefined);
    let eyes: V3[] = [];
    beforeAll(async () => {
      tri = trianglesOf((await buildVehicle(id)).bytes);
      const model = await builtModel(id);
      const seat = manifest.interior?.seats?.default ?? INTERIOR_CATALOGUE.seats[0]?.id ?? '';
      poseSeats(model, INTERIOR_CATALOGUE.anchors.seats, seat, manifest.interior?.seats?.scale ?? 1);
      eyes = views.map((view) => (view.eye ?? resolveEye(model, view).eye) as V3);
    }, 120_000);

    it('a au moins un point de vue intérieur', () => {
      expect(views.length).toBeGreaterThan(0);
      expect(eyes.length).toBe(views.length);
    });

    it('de chaque point de vue, les vitres laissent voir dehors (opacité apparente < 0,2)', () => {
      const inside = glassLook({ opacity: GLASS_ROLE.opacity, envMapIntensity: GLASS_ROLE.envMapIntensity }, true).opacity;
      for (const eye of eyes) {
        const seen = sight(tri, eye, inside);
        expect(seen.rays, `rayons depuis ${eye.join(', ')}`).toBeGreaterThan(20);
        expect(seen.opacity, `opacité apparente depuis ${eye.join(', ')}`).toBeLessThan(0.2);
        // Sièges, planche et montants cachent une part des vitres ; il en reste plus de la moitié en vue.
        expect(seen.hidden, `vitres cachées depuis ${eye.join(', ')}`).toBeLessThan(0.5);
      }
    }, 60_000);

    it('aucune vitre n’est doublée par l’intérieur (doublure percée aux vitres)', () => {
      const { share, panes } = lined(tri);
      expect(panes).toBeGreaterThan(50);
      expect(share).toBeLessThan(0.05);
    }, 60_000);

    it('vu de dehors, de trois quarts avant, le vitrage reste teinté', () => {
      const seen = sight(tri, [4, 1.6, 3], GLASS_ROLE.opacity, { maxRays: 120, outside: true });
      expect(seen.opacity).toBeGreaterThanOrEqual(0.3);
    }, 60_000);
  });
}
