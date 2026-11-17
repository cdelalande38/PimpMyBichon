// Mesure de la vue conducteur (vague R, lot « cadrans ») : ce que le volant masque de la vitesse.
//
// Sans navigateur : le modèle du véhicule (public/assets/vehicles/<id>/body.glb) et les pièces
// d'habitacle partagées (public/assets/shared/habitacle/) sont lus à la main, mis dans le même repère que
// l'app (VehicleModel.tsx : modèle recentré, posé sur le sol), puis on lance, de l'œil du conducteur, un
// rayon vers chaque point de la zone utile de chaque instrument. Le rayon qui touche le volant (jante,
// branches, moyeu) ou la planche avant d'arriver au cadran compte pour masqué ; un point hors de l'image
// compte pour perdu. L'œil est celui de l'app : `placeEye` et `seatMetrics` (src/scene/fit.ts) sur les
// sièges du modèle, ou l'œil du manifeste. Les deux caméras sont celles de l'app : le garage
// (interiorView : regard, champ ; src/scene/fit.ts) et la sortie de nuit (src/drive/cameras.ts, embarquée).
//
// Repère du véhicule : avant +X, haut +Y, droite +Z, en mètres. Aucune dépendance au navigateur.

import { existsSync, readFileSync } from 'node:fs';
import { Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import { placeOf } from '../../../src/data/vehicles.ts';
import type { CabinPanel, InteriorView, VehicleManifest } from '../../../src/data/vehicleTypes.ts';
import { interiorFov, lookTarget, placeEye, seatMetrics, type PlacedSeat, type SeatMetrics } from '../../../src/scene/fit.ts';
import { zoneUtile } from '../../../src/scene/vehicle/tableau.ts';

const ASSETS = new URL('../../../public/assets/', import.meta.url);

type V3 = readonly [number, number, number];

/** Un triangle dans le repère du véhicule, et ce qu'il est (étiquette). */
export interface Tri {
  a: V3;
  b: V3;
  c: V3;
  tag: string;
}

interface Glb {
  json: {
    scenes: { nodes: number[] }[];
    nodes: { name?: string; mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
    meshes: { primitives: { attributes: { POSITION: number }; indices?: number; material?: number; mode?: number }[] }[];
    materials?: { name?: string }[];
    accessors: { min?: number[]; max?: number[]; bufferView: number; byteOffset?: number; componentType: number; count: number }[];
    bufferViews: { byteOffset?: number; byteStride?: number }[];
  };
  bin: Buffer;
}

export function lireGlb(url: URL): Glb {
  const bytes = readFileSync(url);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8')) as Glb['json'];
  const binStart = 20 + jsonLength;
  const bin = bytes.subarray(binStart + 8, binStart + 8 + bytes.readUInt32LE(binStart));
  return { json, bin };
}

function lire(glb: Glb, accessor: number): number[] {
  const a = glb.json.accessors[accessor]!;
  const view = glb.json.bufferViews[a.bufferView]!;
  const base = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out: number[] = [];
  const size = a.componentType === 5126 ? 4 : a.componentType === 5125 ? 4 : a.componentType === 5123 ? 2 : 1;
  const comps = glb.json.accessors[accessor] && a.componentType === 5126 ? 3 : 1;
  const stride = view.byteStride ?? size * comps;
  for (let i = 0; i < a.count; i += 1) {
    for (let k = 0; k < comps; k += 1) {
      const at = base + i * stride + k * size;
      out.push(a.componentType === 5126 ? glb.bin.readFloatLE(at) : a.componentType === 5125 ? glb.bin.readUInt32LE(at) : a.componentType === 5123 ? glb.bin.readUInt16LE(at) : glb.bin.readUInt8(at));
    }
  }
  return out;
}

const matriceDe = (n: Glb['json']['nodes'][number]): Matrix4 => {
  if (n.matrix) return new Matrix4().fromArray(n.matrix);
  return new Matrix4().compose(
    new Vector3(...((n.translation ?? [0, 0, 0]) as [number, number, number])),
    new Quaternion(...((n.rotation ?? [0, 0, 0, 1]) as [number, number, number, number])),
    new Vector3(...((n.scale ?? [1, 1, 1]) as [number, number, number])),
  );
};

/** Parcourt un modèle : rend ses triangles dans le repère du GLB, étiquetés par `etiquette(nom du nœud, chemin, nom du matériau)` ; `null` : ignoré. */
export function triangles(glb: Glb, racine: Matrix4, etiquette: (nom: string, chemin: readonly string[], materiau: string) => string | null): Tri[] {
  const out: Tri[] = [];
  const v = new Vector3();
  const visite = (index: number, parent: Matrix4, chemin: readonly string[]): void => {
    const node = glb.json.nodes[index]!;
    const monde = new Matrix4().multiplyMatrices(parent, matriceDe(node));
    const nom = node.name ?? '';
    if (node.mesh !== undefined) {
      for (const prim of glb.json.meshes[node.mesh]!.primitives) {
        if ((prim.mode ?? 4) !== 4) continue;
        const materiau = prim.material !== undefined ? (glb.json.materials?.[prim.material]?.name ?? '') : '';
        const tag = etiquette(nom, chemin, materiau);
        if (tag === null) continue;
        const pos = lire(glb, prim.attributes.POSITION);
        const idx = prim.indices !== undefined ? lire(glb, prim.indices) : Array.from({ length: pos.length / 3 }, (_, i) => i);
        const point = (i: number): V3 => {
          v.set(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!).applyMatrix4(monde);
          return [v.x, v.y, v.z];
        };
        for (let t = 0; t + 2 < idx.length; t += 3) out.push({ a: point(idx[t]!), b: point(idx[t + 1]!), c: point(idx[t + 2]!), tag });
      }
    }
    for (const child of node.children ?? []) visite(child, monde, [...chemin, nom]);
  };
  for (const root of glb.json.scenes[0]!.nodes) visite(root, racine, []);
  return out;
}

/** Boîte englobante d'un modèle d'après les bornes de ses accessoires de position (sans lire les sommets), repère `racine`. */
export function boiteGlb(glb: Glb, racine: Matrix4): { min: V3; max: V3 } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const v = new Vector3();
  const visite = (index: number, parent: Matrix4): void => {
    const node = glb.json.nodes[index]!;
    const monde = new Matrix4().multiplyMatrices(parent, matriceDe(node));
    if (node.mesh !== undefined) {
      for (const prim of glb.json.meshes[node.mesh]!.primitives) {
        const a = glb.json.accessors[prim.attributes.POSITION]!;
        if (!a.min || !a.max) continue;
        for (let c = 0; c < 8; c += 1) {
          v.set(c & 1 ? a.max[0]! : a.min[0]!, c & 2 ? a.max[1]! : a.min[1]!, c & 4 ? a.max[2]! : a.min[2]!).applyMatrix4(monde);
          for (let k = 0; k < 3; k += 1) {
            min[k] = Math.min(min[k]!, v.getComponent(k));
            max[k] = Math.max(max[k]!, v.getComponent(k));
          }
        }
      }
    }
    for (const child of node.children ?? []) visite(child, monde);
  };
  for (const root of glb.json.scenes[0]!.nodes) visite(root, racine);
  return { min, max };
}

/** Tous les sommets d'un modèle, repère du GLB. */
function boite(tris: readonly Tri[]): { min: V3; max: V3 } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) {
    for (const p of [t.a, t.b, t.c]) {
      for (let k = 0; k < 3; k += 1) {
        min[k] = Math.min(min[k]!, p[k]!);
        max[k] = Math.max(max[k]!, p[k]!);
      }
    }
  }
  return { min, max };
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Möller-Trumbore, deux faces : distance du premier point touché le long de `d` (unitaire), ou `null`. */
function rayon(o: V3, d: V3, t: Tri, faceAvant = false): number | null {
  const e1 = sub(t.b, t.a);
  const e2 = sub(t.c, t.a);
  const p = cross(d, e2);
  const det = dot(e1, p);
  if (Math.abs(det) < 1e-12) return null;
  // Face avant seulement : un triangle vu par son dos n'est pas dessiné (le siège autour de l'œil, par exemple).
  if (faceAvant && det > 0) return null;
  const s = sub(o, t.a);
  const u = dot(s, p) / det;
  if (u < 0 || u > 1) return null;
  const q = cross(s, e1);
  const w = dot(d, q) / det;
  if (w < 0 || u + w > 1) return null;
  const dist = dot(e2, q) / det;
  return dist > 1e-6 ? dist : null;
}

function premier(o: V3, d: V3, tris: readonly Tri[], ignore?: (t: Tri) => boolean): number | null {
  return premierTag(o, d, tris, false, ignore)?.dist ?? null;
}

function premierTag(o: V3, d: V3, tris: readonly Tri[], faceAvant = false, ignore?: (t: Tri) => boolean): { dist: number; tag: string } | null {
  let best: { dist: number; tag: string } | null = null;
  for (const t of tris) {
    if (ignore?.(t)) continue;
    const hit = rayon(o, d, t, faceAvant);
    if (hit !== null && (best === null || hit < best.dist)) best = { dist: hit, tag: t.tag };
  }
  return best;
}

/** Ce qu'on sait d'un véhicule pour la mesure : l'œil, le volant (au repos), la planche et le reste de l'habitacle. */
export interface Vehicule {
  manifeste: VehicleManifest;
  /** Œil du conducteur, repère du véhicule. */
  oeil: V3;
  /** Triangles du volant (jante, branches, moyeu), au repos. */
  volant: Tri[];
  /** Triangles du reste du modèle (planche, pavillon, montants). */
  caisse: Tri[];
  /** Nombre de triangles qui tournent avec le volant (diagnostic). */
  tournantes: number;
  /** Tourne le volant de `angle` radians (positif : vers la gauche du conducteur) autour de son axe. */
  tourner(angle: number): Tri[];
}

/** Pièces d'habitacle : volant, sièges (catalogue partagé). */
const pieceUrl = (fichier: string): URL => new URL(`shared/habitacle/${fichier}`, ASSETS);

const ID_VOLANT = (m: VehicleManifest): string => m.interior?.steering?.default ?? 'sport';

/**
 * Charge un véhicule comme l'app le prépare : le modèle est recentré (boîte des sommets, roues sans
 * maillage comptées comme un cube de leur rayon) et posé sur le sol.
 */
export function charger(manifeste: VehicleManifest, volantId?: string): Vehicule {
  const dossier = new URL(`vehicles/${manifeste.id}/`, ASSETS);
  const glb = lireGlb(new URL('body.glb', dossier));
  const nodes = glb.json.nodes;
  const volantNode = nodes.findIndex((n) => n.name === 'volant');
  const steeringNode = manifeste.interior?.steeringNode;
  const sources = steeringNode !== undefined || volantNode < 0 ? 'modele' : 'pieces';
  const racine = new Matrix4();
  const b = boiteGlb(glb, racine);
  // Roues sans maillage (ancres du modèle de l'atelier) : cube de leur rayon, comme VehicleModel.tsx.
  const mondeNoeud = (nom: string): { p: Vector3; m: Matrix4 } | null => {
    let found: { p: Vector3; m: Matrix4 } | null = null;
    const visite = (i: number, parent: Matrix4): void => {
      const n = nodes[i]!;
      const m = new Matrix4().multiplyMatrices(parent, matriceDe(n));
      if (n.name === nom) found = { p: new Vector3().setFromMatrixPosition(m), m };
      for (const c of n.children ?? []) visite(c, m);
    };
    for (const r of glb.json.scenes[0]!.nodes) visite(r, racine);
    return found;
  };
  const min = [...b.min] as [number, number, number];
  const max = [...b.max] as [number, number, number];
  for (const n of nodes) {
    if (!n.name?.startsWith('roue_') || n.mesh !== undefined || (n.children ?? []).length > 0) continue;
    const w = mondeNoeud(n.name);
    if (!w) continue;
    const r = Math.max(0.05, w.p.y);
    for (let k = 0; k < 3; k += 1) {
      min[k] = Math.min(min[k]!, w.p.getComponent(k) - r);
      max[k] = Math.max(max[k]!, w.p.getComponent(k) + r);
    }
  }
  const decalage = new Vector3(-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2);
  const poser = new Matrix4().makeTranslation(decalage.x, decalage.y, decalage.z);

  const caisse = triangles(glb, poser, (nom, chemin) => (/^InteriorSteering(Base|Cylinder|Emblem|Wheel|Handle)/.test(nom) || /^InteriorSeats/.test(nom) || chemin.some((c) => c === steeringNode) ? null : nom === 'volant' || nom === 'pommeau' || nom.startsWith('siege_') ? null : volantNode < 0 && !/^Interior/.test(nom) ? null : nom || 'caisse'));
  let volant: Tri[] = [];
  let axe: { o: V3; d: V3 } = { o: [0, 0, 0], d: [1, 0, 0] };
  let tournantes: Tri[] = [];
  if (sources === 'modele') {
    // Vrai modèle : le volant d'origine est dans le GLB ; seul le nœud déclaré (steeringNode) tourne.
    const tous = triangles(glb, poser, (nom, chemin) => (/^InteriorSteering(Base|Cylinder|Emblem|Wheel|Handle)/.test(nom) ? (nom === steeringNode || chemin.includes(steeringNode ?? '') ? 'tourne' : 'fixe') : null));
    volant = tous;
    tournantes = tous.filter((t) => t.tag === 'tourne');
    // Axe : direction de plus faible dispersion des sommets qui tournent (la jante est plate).
    const pts = tournantes.flatMap((t) => [t.a, t.b, t.c]);
    const c = pts.reduce<V3>((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length, s[2] + p[2] / pts.length], [0, 0, 0]);
    const cov = new Matrix4().identity();
    const e = cov.elements;
    e.fill(0);
    for (const p of pts) {
      const d = sub(p, c);
      for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) e[i * 4 + j]! += d[i]! * d[j]!;
    }
    // Itération inverse sur la matrice 3×3 de covariance (plus petit vecteur propre).
    const m3 = [
      [e[0]!, e[1]!, e[2]!],
      [e[4]!, e[5]!, e[6]!],
      [e[8]!, e[9]!, e[10]!],
    ];
    const inv = (() => {
      const [[a, bb, cc], [d, ee, f], [g, h, i]] = m3 as [[number, number, number], [number, number, number], [number, number, number]];
      const det = a * (ee * i - f * h) - bb * (d * i - f * g) + cc * (d * h - ee * g);
      return [
        [(ee * i - f * h) / det, (cc * h - bb * i) / det, (bb * f - cc * ee) / det],
        [(f * g - d * i) / det, (a * i - cc * g) / det, (cc * d - a * f) / det],
        [(d * h - ee * g) / det, (bb * g - a * h) / det, (a * ee - bb * d) / det],
      ] as number[][];
    })();
    let v: V3 = [0.3, 1, 0.5];
    for (let k = 0; k < 40; k += 1) v = norm([inv[0]![0]! * v[0] + inv[0]![1]! * v[1] + inv[0]![2]! * v[2], inv[1]![0]! * v[0] + inv[1]![1]! * v[1] + inv[1]![2]! * v[2], inv[2]![0]! * v[0] + inv[2]![1]! * v[1] + inv[2]![2]! * v[2]]);
    axe = { o: c, d: v };
  } else {
    // Modèle de l'atelier : la pièce du catalogue posée sur l'ancre « volant », tournée autour de son axe local Z.
    const piece = lireGlb(pieceUrl(`volant_${volantId ?? ID_VOLANT(manifeste)}.glb`));
    const ancre = mondeNoeud('volant')!;
    const mAncre = new Matrix4().multiplyMatrices(poser, ancre.m);
    volant = triangles(piece, mAncre, (_n, _c, materiau) => (materiau === 'paint_volant' ? 'jante' : materiau === 'alu' || materiau === 'black' ? 'branches' : 'branches'));
    tournantes = volant;
    const o = new Vector3().setFromMatrixPosition(mAncre);
    const d = new Vector3(0, 0, 1).transformDirection(mAncre);
    axe = { o: [o.x, o.y, o.z], d: [d.x, d.y, d.z] };
  }
  const tourner = (angle: number): Tri[] => {
    if (angle === 0) return volant;
    const q = new Quaternion().setFromAxisAngle(new Vector3(...axe.d), angle);
    const o = new Vector3(...axe.o);
    const v = new Vector3();
    const tourne = (p: V3): V3 => {
      v.set(p[0], p[1], p[2]).sub(o).applyQuaternion(q).add(o);
      return [v.x, v.y, v.z];
    };
    return volant.map((t) => (tournantes.includes(t) ? { a: tourne(t.a), b: tourne(t.b), c: tourne(t.c), tag: t.tag } : t));
  };

  // Œil : celui de la place « conducteur » (manifeste), posé sur les sièges comme l'app.
  const place = placeOf(manifeste, 'conducteur');
  const vue: InteriorView | undefined = place?.view;
  let oeil: V3 = vue?.eye ?? [0, 1.2, 0];
  if (vue?.seat) {
    const sieges: PlacedSeat[] = [];
    const idSiege = manifeste.interior?.seats?.default ?? 'bas';
    const piece = existsSync(pieceUrl(`siege_${idSiege}.glb`)) ? lireGlb(pieceUrl(`siege_${idSiege}.glb`)) : null;
    for (const nom of vue.seat.anchors) {
      const w = mondeNoeud(nom);
      if (!w) continue;
      const anchor: V3 = [w.p.x + decalage.x, w.p.y + decalage.y, w.p.z + decalage.z];
      let metrics: SeatMetrics | undefined;
      if (piece) {
        const m = new Matrix4().makeTranslation(...anchor);
        const tris = triangles(piece, m, () => 'siege');
        const bb = boite(tris);
        metrics = seatMetrics(
          (o, d) => premier([anchor[0] + o[0], anchor[1] + o[1], anchor[2] + o[2]], d, tris),
          { min: sub(bb.min, anchor), max: sub(bb.max, anchor) },
          vue.seat.up,
        );
      }
      sieges.push({ anchor, metrics: metrics ?? { cushion: 0.33, backFront: -0.24, back: -0.45, top: 1.05 } });
    }
    const toit = (x: number, z: number, de: number): number | null => {
      const d = premier([x, de, z], [0, 1, 0], caisse);
      return d === null ? null : de + d;
    };
    oeil = placeEye(vue.seat, sieges, toit) ?? oeil;
  }
  return { manifeste, oeil, volant, caisse, tourner, tournantes: tournantes.length };
}

/** Une caméra : œil, regard (vecteur unitaire), champ vertical en degrés, format de l'image en pixels. */
export interface Camera {
  oeil: V3;
  avant: V3;
  fov: number;
  largeur: number;
  hauteur: number;
}

function base(c: Camera): { droite: V3; haut: V3 } {
  const droite = norm(cross(c.avant, [0, 1, 0]));
  return { droite, haut: cross(droite, c.avant) };
}

/** Pixel d'un point de l'espace (`null` : derrière la caméra). */
export function projeter(c: Camera, p: V3): [number, number] | null {
  const { droite, haut } = base(c);
  const d = sub(p, c.oeil);
  const z = dot(d, c.avant);
  if (z <= 0.15) return null;
  const t = Math.tan((c.fov * Math.PI) / 360);
  return [((dot(d, droite) / z / (t * (c.largeur / c.hauteur)) + 1) / 2) * c.largeur, ((1 - dot(d, haut) / z / t) / 2) * c.hauteur];
}


/** Caméra de la vue intérieure du garage (src/scene/fit.ts : regard du manifeste, champ de l'écran). */
export function cameraGarage(v: Vehicule, largeur = 390, hauteur = 844): Camera {
  const vue = placeOf(v.manifeste, 'conducteur')!.view;
  const regard: V3 = vue.look ? (lookTarget(v.oeil, vue.look) as V3) : [v.oeil[0] + 1, v.oeil[1], v.oeil[2]];
  return { oeil: v.oeil, avant: norm(sub(regard, v.oeil)), fov: interiorFov(largeur, hauteur, vue.fov), largeur, hauteur };
}

/**
 * Caméra embarquée de la sortie de nuit, volant droit, à l'arrêt (src/drive/cameras.ts : l'œil du
 * conducteur ; regard vers la route à `lookAt` m, à 0,6 fois la hauteur du véhicule ; champ `fov`).
 */
export function cameraEmbarquee(v: Vehicule, hauteurVehicule: number, fov: number, largeur = 390, hauteur = 844, regard?: { yaw: number; pitch: number }): Camera {
  const cible: V3 = regard ? (lookTarget(v.oeil, regard) as V3) : [v.oeil[0] + 28, hauteurVehicule * 0.6, v.oeil[2]];
  return { oeil: v.oeil, avant: norm(sub(cible, v.oeil)), fov, largeur, hauteur };
}

/** Résultat pour un instrument. */
export interface MesureInstrument {
  /** Nom court : mesure et affichage. */
  nom: string;
  /** Cadre de la zone utile projeté dans l'image, en pixels : [x0, y0, x1, y1], ou null. */
  cadre: [number, number, number, number] | null;
  /** Part de la zone utile cachée par le volant (0 à 1), vue de l'œil. */
  masqueeVolant: number;
  /** Part cachée par la planche ou le reste du modèle. */
  masqueePlanche: number;
  /** Part hors de l'image. */
  horsImage: number;
  /** Carte de la zone utile (ligne par ligne, du haut) : # volant, p planche, x hors image, . visible. */
  carte: string[];
  /** Pièces du modèle qui cachent le cadran (nom du nœud : nombre de points). */
  occulteurs: Record<string, number>;
  /** Part perdue : masquée (volant ou planche) ou hors image. */
  perdue: number;
}

export interface MesureVue {
  instruments: MesureInstrument[];
  /** Jante et moyeu projetés : [x0, y0, x1, y1] en pixels. */
  jante: [number, number, number, number] | null;
  moyeu: [number, number, number, number] | null;
  /** Le plus mauvais instrument de vitesse (vitesse seule : ses chiffres ou son cadran). */
  vitesse: MesureInstrument | null;
}

const PAS = 36;

/** Vrai si la boîte du triangle touche `b`. */
function chevauche(t: Tri, b: { min: V3; max: V3 }): boolean {
  for (let k = 0; k < 3; k += 1) {
    if (Math.max(t.a[k]!, t.b[k]!, t.c[k]!) < b.min[k]! || Math.min(t.a[k]!, t.b[k]!, t.c[k]!) > b.max[k]!) return false;
  }
  return true;
}

function rectangle(points: ReadonlyArray<[number, number]>): [number, number, number, number] | null {
  if (points.length === 0) return null;
  return [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1])), Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))];
}

/**
 * Mesure la vue `camera` : pour chaque instrument du manifeste, la part de sa zone utile cachée par le
 * volant (tourné de `angle` radians) ou la planche, ou hors de l'image.
 */
export function mesurer(v: Vehicule, camera: Camera, angle = 0): MesureVue {
  const volant = v.tourner(angle);
  const panels = (v.manifeste.cabin?.panels ?? []).filter((p): p is CabinPanel & { instrument: NonNullable<CabinPanel['instrument']> } => p.instrument !== undefined);
  const instruments: MesureInstrument[] = [];
  for (const panel of panels) {
    const objet = new Object3D();
    objet.position.set(...panel.center);
    objet.lookAt(new Vector3(...panel.center).add(new Vector3(...panel.normal)));
    objet.updateMatrixWorld(true);
    const zone = zoneUtile(panel);
    const [w, h] = panel.size;
    const p = new Vector3();
    const cadres: Array<[number, number]> = [];
    let vol = 0;
    let pla = 0;
    let hors = 0;
    let perdue = 0;
    let n = 0;
    const occulteurs: Record<string, number> = {};
    const carte: string[] = [];
    // Seuls les triangles proches du faisceau (œil et zone) comptent : filtre par boîte, une fois par instrument.
    const bornes = { min: [...camera.oeil] as [number, number, number], max: [...camera.oeil] as [number, number, number] };
    for (const c of [-0.5, 0.5]) {
      for (const d of [-0.5, 0.5]) {
        p.set(c * w, d * (panel.shape === 'disque' ? w : h), 0).applyMatrix4(objet.matrixWorld);
        for (let k = 0; k < 3; k += 1) {
          bornes.min[k] = Math.min(bornes.min[k]!, p.getComponent(k) - 0.05);
          bornes.max[k] = Math.max(bornes.max[k]!, p.getComponent(k) + 0.05);
        }
      }
    }
    const nearVolant = volant.filter((t) => chevauche(t, bornes));
    const nearCaisse = v.caisse.filter((t) => chevauche(t, bornes));
    const normale = norm(panel.normal);
    const centre: V3 = panel.center;
    const visible = dot(normale, sub(camera.oeil, centre)) > 0;
    for (let i = 0; i < PAS; i += 1) {
      for (let j = 0; j < PAS; j += 1) {
        const u = zone.u0 + ((i + 0.5) / PAS) * (zone.u1 - zone.u0);
        const t = zone.v0 + ((j + 0.5) / PAS) * (zone.v1 - zone.v0);
        if (!zone.contient(u, t)) continue;
        n += 1;
        p.set((u - 0.5) * w, (0.5 - t) * (panel.shape === 'disque' ? w : h), 0).applyMatrix4(objet.matrixWorld);
        const pt: V3 = [p.x, p.y, p.z];
        const px = projeter(camera, pt);
        const dedans = px !== null && px[0] >= 0 && px[0] <= camera.largeur && px[1] >= 0 && px[1] <= camera.hauteur;
        if (px) cadres.push(px);
        if (!dedans) hors += 1;
        const dir = sub(pt, camera.oeil);
        const dist = Math.hypot(...dir);
        const d = norm(dir);
        const cacheVolant = (premier(camera.oeil, d, nearVolant) ?? Infinity) < dist - 0.002;
        // Planche : seuls comptent les triangles nettement devant le cadran (le support lui-même se laisse devancer, polygonOffset).
        const hitPlanche = premierTag(camera.oeil, d, nearCaisse, true);
        const cachePlanche = !visible || (hitPlanche !== null && hitPlanche.dist < dist - 0.03);
        if (hitPlanche && cachePlanche) occulteurs[hitPlanche.tag] = (occulteurs[hitPlanche.tag] ?? 0) + 1;
        if (cacheVolant) vol += 1;
        if (cachePlanche) pla += 1;
        if (!dedans || cacheVolant || cachePlanche) perdue += 1;
        carte[j] = (carte[j] ?? '') + (cacheVolant ? '#' : cachePlanche ? 'p' : !dedans ? 'x' : '.');
      }
    }
    instruments.push({
      nom: `${panel.instrument.mesure}/${panel.instrument.affichage ?? (panel.shape === 'disque' ? 'aiguille' : 'chiffres')}`,
      cadre: rectangle(cadres),
      masqueeVolant: vol / Math.max(1, n),
      masqueePlanche: pla / Math.max(1, n),
      horsImage: hors / Math.max(1, n),
      occulteurs,
      carte,
      perdue: perdue / Math.max(1, n),
    });
  }
  const proj = (tris: readonly Tri[]) =>
    rectangle(
      tris.flatMap((t) => [t.a, t.b, t.c]).flatMap((q) => {
        const r = projeter(camera, q);
        return r ? [r] : [];
      }),
    );
  const jante = proj(volant.filter((t) => t.tag === 'jante' || t.tag === 'fixe' || t.tag === 'tourne'));
  const moyeu = proj(volant.filter((t) => t.tag === 'branches'));
  const vit = instruments.filter((i) => i.nom.startsWith('vitesse')).sort((a, b) => b.perdue - a.perdue)[0] ?? null;
  return { instruments, jante, moyeu, vitesse: vit };
}

/** Lit le manifeste d'un véhicule dans le dépôt (ou depuis `fichier`, pour comparer avant et après). */
export function manifesteDe(id: string, fichier?: URL): VehicleManifest {
  return JSON.parse(readFileSync(fichier ?? new URL(`vehicles/${id}/vehicle.json`, ASSETS), 'utf8')) as VehicleManifest;
}

