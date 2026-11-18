// Mesure de la caméra embarquée (vague U, lot « embarquee ») : quelle part de l'écran l'habitacle prend
// au milieu de l'image, et où tombe l'horizon, depuis l'œil du conducteur de la sortie.
//
// Sans navigateur : le modèle du véhicule est lu à la main et posé comme l'app le pose (même recentrage
// que tests/unit/outils/vueConducteur.ts), vitres retirées (on voit au travers), volant du catalogue sur
// son ancre ; l'œil vient de `charger` (placeEye sur les sièges du modèle, comme l'app). Pour chaque
// ligne de l'image, un rayon part de l'œil au milieu de l'écran : il touche l'habitacle (planche, capot,
// volant, montants, pavillon) ou file vers la route et le ciel.
//
// Repère du véhicule : avant +X, haut +Y, droite +Z, en mètres.

import { Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import { placeOf } from '../../../src/data/vehicles.ts';
import type { DriveEyeSpec, VehicleManifest } from '../../../src/data/vehicleTypes.ts';
import { cockpitView } from '../../../src/drive/cameras.ts';
import { zoneUtile } from '../../../src/scene/vehicle/tableau.ts';
import { boiteGlb, charger, lireGlb, triangles, type Tri } from './vueConducteur.ts';

type V3 = readonly [number, number, number];

const ASSETS = new URL('../../../public/assets/', import.meta.url);

export interface Habitacle {
  manifeste: VehicleManifest;
  /** Œil du conducteur résolu comme l'app (siège posé, pavillon), repère du véhicule. */
  oeil: V3;
  /** Hauteur du véhicule posé (sommet de la caisse), en mètres : `frame.height` de la sortie. */
  hauteur: number;
  /** Triangles de la caisse et de l'habitacle (sans vitres ni sièges), et du volant posé. */
  tris: Tri[];
  /** Pavillon au-dessus d'un point (x, z), mesuré depuis `de` vers le haut ; `null` : rien. */
  pavillon(x: number, z: number, de: number): number | null;
}

/** Charge l'habitacle d'un véhicule à place de conducteur, comme la sortie le pose. */
export function chargerHabitacle(manifeste: VehicleManifest): Habitacle {
  const v = charger(manifeste);
  const glb = lireGlb(new URL(`vehicles/${manifeste.id}/body.glb`, ASSETS));
  const nodes = glb.json.nodes;
  // Longueur sur X, comme l'app (src/scene/vehicle/VehicleModel.tsx, prepare : un quart de tour si le
  // modèle est plus long sur Z, plus celui que demande le manifeste).
  const brut = boiteGlb(glb, new Matrix4());
  const quarts = (brut.max[2] - brut.min[2] > brut.max[0] - brut.min[0] ? 1 : 0) + (manifeste.adapt?.yawQuarterTurns ?? 0);
  const tourne = new Matrix4().makeRotationY((quarts * Math.PI) / 2);
  // Boîte précise (sommets), comme l'app : celle des bornes des accessoires, tournées avec leur nœud,
  // déborde sous les roues d'un vrai modèle (le concept était posé 16 cm trop haut).
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const t of triangles(glb, tourne, () => 'tout')) {
    for (const p of [t.a, t.b, t.c]) {
      for (let k = 0; k < 3; k += 1) {
        min[k] = Math.min(min[k]!, p[k]!);
        max[k] = Math.max(max[k]!, p[k]!);
      }
    }
  }
  // Roues sans maillage (ancres du modèle de l'atelier) : cube de leur rayon, comme charger().
  const monde = (nom: string): Vector3 | null => {
    let found: Vector3 | null = null;
    const visite = (i: number, parent: Matrix4): void => {
      const n = nodes[i]!;
      const m = new Matrix4().multiplyMatrices(parent, nodeMatrix(n));
      if (n.name === nom) found = new Vector3().setFromMatrixPosition(m);
      for (const c of n.children ?? []) visite(c, m);
    };
    for (const r of glb.json.scenes[0]!.nodes) visite(r, tourne);
    return found;
  };
  for (const n of nodes) {
    if (!n.name?.startsWith('roue_') || n.mesh !== undefined || (n.children ?? []).length > 0) continue;
    const w = monde(n.name);
    if (!w) continue;
    const r = Math.max(0.05, w.y);
    for (let k = 0; k < 3; k += 1) {
      min[k] = Math.min(min[k]!, w.getComponent(k) - r);
      max[k] = Math.max(max[k]!, w.getComponent(k) + r);
    }
  }
  const poser = new Matrix4().makeTranslation(-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2).multiply(tourne);
  // Balais d'essuie-glace : deux barres fines devant la route, qu'on voit au travers (ils ne comptent pas
  // comme le haut de la planche).
  const corps = triangles(glb, poser, (nom, _chemin, materiau) => (/glass/i.test(materiau) || /Wipers/.test(nom) || nom === 'volant' || nom === 'pommeau' || nom.startsWith('siege_') || /^InteriorSeats/.test(nom) ? null : nom || 'caisse'));
  // Les vitres arrêtent le rayon du pavillon (l'app le lance sur toute la caisse, vitres comprises).
  const vitres = triangles(glb, poser, (nom, _chemin, materiau) => (/glass/i.test(materiau) ? nom || 'vitre' : null));
  // Vrai modèle : son volant est déjà dans `corps` ; modèle de l'atelier : la pièce du catalogue.
  // `charger` pose le modèle d'après la boîte des accessoires, sans quart de tour : l'œil posé sur les
  // sièges et le volant du catalogue sont recalés sur la pose de l'app (un œil du manifeste ne bouge pas).
  const ancienne = (() => {
    const b = boiteGlb(glb, new Matrix4());
    const lo = [...b.min] as [number, number, number];
    const hi = [...b.max] as [number, number, number];
    for (const n of nodes) {
      if (!n.name?.startsWith('roue_') || n.mesh !== undefined || (n.children ?? []).length > 0) continue;
      const w = monde(n.name);
      if (!w) continue;
      const r = Math.max(0.05, w.y);
      for (let k = 0; k < 3; k += 1) {
        lo[k] = Math.min(lo[k]!, w.getComponent(k) - r);
        hi[k] = Math.max(hi[k]!, w.getComponent(k) + r);
      }
    }
    return [-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2] as const;
  })();
  const ecart: V3 = quarts === 0 ? [-(min[0] + max[0]) / 2 - ancienne[0], -min[1] - ancienne[1], -(min[2] + max[2]) / 2 - ancienne[2]] : [0, 0, 0];
  const recale = (p: V3): V3 => [p[0] + ecart[0], p[1] + ecart[1], p[2] + ecart[2]];
  const surSiege = placeOf(manifeste, 'conducteur')?.view.seat !== undefined;
  const oeil = surSiege ? recale(v.oeil) : v.oeil;
  const volant = manifeste.interior?.steeringNode !== undefined ? [] : v.volant.map((t) => ({ a: recale(t.a), b: recale(t.b), c: recale(t.c), tag: 'volant' }));
  const tris = [...corps, ...volant];
  const pavillon = (x: number, z: number, de: number): number | null => {
    let best: number | null = null;
    for (const t of [...corps, ...vitres]) {
      const d = rayon([x, de, z], [0, 1, 0], t);
      if (d !== null && (best === null || d < best)) best = d;
    }
    return best === null ? null : de + best;
  };
  return { manifeste, oeil, hauteur: max[1] - min[1], tris, pavillon };
}

function nodeMatrix(n: { matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }): Matrix4 {
  if (n.matrix) return new Matrix4().fromArray(n.matrix);
  return new Matrix4().compose(
    new Vector3(...((n.translation ?? [0, 0, 0]) as [number, number, number])),
    new Quaternion(...((n.rotation ?? [0, 0, 0, 1]) as [number, number, number, number])),
    new Vector3(...((n.scale ?? [1, 1, 1]) as [number, number, number])),
  );
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Möller-Trumbore, deux faces : distance du premier point touché le long de `d` (unitaire), ou `null`. */
function rayon(o: V3, d: V3, t: Tri): number | null {
  const e1 = sub(t.b, t.a);
  const e2 = sub(t.c, t.a);
  const p = cross(d, e2);
  const det = dot(e1, p);
  if (Math.abs(det) < 1e-12) return null;
  const s = sub(o, t.a);
  const u = dot(s, p) / det;
  if (u < 0 || u > 1) return null;
  const q = cross(s, e1);
  const w = dot(d, q) / det;
  if (w < 0 || u + w > 1) return null;
  const dist = dot(e2, q) / det;
  return dist > 1e-6 ? dist : null;
}

/** Une vue : œil, point visé, champ vertical (degrés), format de l'image en pixels. */
export interface Vue {
  oeil: V3;
  cible: V3;
  fov: number;
  largeur: number;
  hauteur: number;
}

/** Ce qu'on lit d'une vue, au milieu de l'écran : parts de la hauteur de l'image (0 en haut, 1 en bas). */
export interface Lecture {
  /** Horizon (point à l'infini droit devant, à hauteur d'œil). */
  horizon: number;
  /** Haut de l'habitacle sous l'horizon (planche, capot, volant) : premier rayon qui le touche en descendant. */
  planche: number;
  /** Ce qui touche ce rayon (nom du nœud, ou « volant »). */
  piece: string;
  /** Bas du pavillon au-dessus de l'horizon (0 : rien en haut de l'image). */
  pavillon: number;
  /** Part de l'écran prise par l'habitacle sous la route : 1 − planche. */
  habitacle: number;
  /** Part de l'écran où se voit la chaussée (entre l'horizon et la planche). */
  route: number;
  /** Distance au sol du premier point de route visible au milieu de l'écran, en mètres. */
  premierSol: number;
  /** Haut du volant dans l'image (part de la hauteur), au milieu de l'écran ; 1 : hors de l'image, en dessous. */
  volant: number;
}

/**
 * Lit la vue `vue` au milieu de l'écran (colonne centrale), une ligne de pixels sur deux. Les triangles
 * sont d'abord réduits à ceux que coupe le plan vertical du regard (la colonne du milieu y reste).
 */
export function lire(h: Habitacle, vue: Vue): Lecture {
  const avant = norm(sub(vue.cible, vue.oeil));
  const droite = norm(cross(avant, [0, 1, 0]));
  const haut = cross(droite, avant);
  const t = Math.tan((vue.fov * Math.PI) / 360);
  // Plan vertical du regard : normale `droite`, passant par l'œil.
  const coupe = h.tris.filter((tri) => {
    const a = dot(sub(tri.a, vue.oeil), droite);
    const b = dot(sub(tri.b, vue.oeil), droite);
    const c = dot(sub(tri.c, vue.oeil), droite);
    return Math.min(a, b, c) <= 1e-4 && Math.max(a, b, c) >= -1e-4 && Math.max(dot(sub(tri.a, vue.oeil), avant), dot(sub(tri.b, vue.oeil), avant), dot(sub(tri.c, vue.oeil), avant)) > 0.05;
  });
  const touche = (y: number): { dist: number; tag: string } | null => {
    const k = (1 - (2 * (y + 0.5)) / vue.hauteur) * t;
    const d = norm([avant[0] + haut[0] * k, avant[1] + haut[1] * k, avant[2] + haut[2] * k]);
    let best: { dist: number; tag: string } | null = null;
    for (const tri of coupe) {
      const dist = rayon(vue.oeil, d, tri);
      if (dist !== null && dist < 8 && (best === null || dist < best.dist)) best = { dist, tag: tri.tag };
    }
    return best;
  };
  // Horizon : direction horizontale droit devant.
  const flat = norm([avant[0], 0, avant[2]]);
  const z = dot(flat, avant);
  const horizon = (1 - dot(flat, haut) / z / t) / 2;
  const yh = Math.round(horizon * vue.hauteur);
  let planche = 1;
  let piece = '';
  for (let y = Math.max(0, yh); y < vue.hauteur; y += 2) {
    const hit = touche(y);
    if (hit) {
      planche = y / vue.hauteur;
      piece = hit.tag;
      break;
    }
  }
  let volant = 1;
  for (let y = Math.max(0, yh); y < vue.hauteur; y += 2) {
    const hit = touche(y);
    if (hit && /^volant$|^InteriorSteering(Wheel|Cylinder|Emblem)/.test(hit.tag)) {
      volant = y / vue.hauteur;
      break;
    }
  }
  let pavillon = 0;
  for (let y = Math.min(vue.hauteur - 1, yh); y >= 0; y -= 2) {
    if (touche(y)) {
      pavillon = (y + 1) / vue.hauteur;
      break;
    }
  }
  // Premier sol visible : le rayon juste au-dessus de la planche, jusqu'au sol (y = 0).
  const k = (1 - 2 * planche) * t;
  const d = norm([avant[0] + haut[0] * k, avant[1] + haut[1] * k, avant[2] + haut[2] * k]);
  const premierSol = d[1] < 0 ? (vue.oeil[1] / -d[1]) * Math.hypot(d[0], d[2]) : Infinity;
  return { horizon, planche, piece, pavillon, habitacle: 1 - planche, route: Math.max(0, planche - horizon), premierSol, volant };
}

/**
 * Ouverture du pare-brise au milieu du regard, vue de `oeil` droit devant (cap 0) : angles (degrés, positifs
 * vers le haut) du bas de l'ouverture (haut de la planche, du capot ou du volant) et de son haut (bord du
 * pavillon), pour l'ouverture qui contient l'horizontale ou, à défaut, la plus proche sous elle.
 */
export function ouverture(h: Habitacle, oeil: V3): { bas: number; haut: number; piece: string } {
  const coupe = h.tris.filter((tri) => Math.min(tri.a[2], tri.b[2], tri.c[2]) <= oeil[2] + 1e-4 && Math.max(tri.a[2], tri.b[2], tri.c[2]) >= oeil[2] - 1e-4 && Math.max(tri.a[0], tri.b[0], tri.c[0]) > oeil[0] + 0.05);
  const libre = (deg: number): string | null => {
    const a = (deg * Math.PI) / 180;
    const d: V3 = [Math.cos(a), Math.sin(a), 0];
    let best: { dist: number; tag: string } | null = null;
    for (const tri of coupe) {
      const dist = rayon(oeil, d, tri);
      if (dist !== null && dist < 8 && (best === null || dist < best.dist)) best = { dist, tag: tri.tag };
    }
    return best ? best.tag : null;
  };
  const pas = 0.25;
  let depart = 0;
  if (libre(0) !== null) {
    // L'horizontale est bouchée : la première ouverture en dessous.
    depart = Number.NaN;
    for (let a = -pas; a >= -45; a -= pas) {
      if (libre(a) === null) {
        depart = a;
        break;
      }
    }
    if (Number.isNaN(depart)) return { bas: 0, haut: 0, piece: libre(0) ?? '' };
  }
  let bas = depart;
  let piece = '';
  for (let a = depart; a >= -60; a -= pas) {
    const tag = libre(a);
    if (tag !== null) {
      piece = tag;
      break;
    }
    bas = a;
  }
  let haut = depart;
  for (let a = depart; a <= 60; a += pas) {
    if (libre(a) !== null) break;
    haut = a;
  }
  return { bas, haut, piece };
}

/** Profil du regard droit devant (cap 0) : pour chaque angle (degrés), la pièce touchée et sa distance. */
export function profil(h: Habitacle, oeil: V3, angles: readonly number[], cap = 0): string[] {
  const c = (cap * Math.PI) / 180;
  return angles.map((deg) => {
    const a = (deg * Math.PI) / 180;
    const d: V3 = [Math.cos(a) * Math.cos(c), Math.sin(a), Math.cos(a) * Math.sin(c)];
    let best: { dist: number; tag: string } | null = null;
    for (const tri of h.tris) {
      const dist = rayon(oeil, d, tri);
      if (dist !== null && dist < 8 && (best === null || dist < best.dist)) best = { dist, tag: tri.tag };
    }
    return `${deg}°:${best ? `${best.tag}@${best.dist.toFixed(2)}` : '-'}`;
  });
}

/**
 * Vue de la caméra embarquée de l'app (src/drive/cameras.ts, cockpitView) depuis l'œil du conducteur,
 * route droite et plate, cap nul : format `largeur` × `hauteur`, hauteur du regard `part` (−1 à 1).
 */
export function vueConduite(h: Habitacle, largeur: number, hauteur: number, part = 0, spec = placeOfConduite(h)): Vue & { pitch: number } {
  const ahead = spec?.ahead ?? 0;
  const ceiling = h.pavillon(h.oeil[0] + ahead, h.oeil[2], h.oeil[1]) ?? Number.NaN;
  const v = cockpitView(h.oeil, spec, largeur / hauteur, part, ceiling, { eye: [0, 0, 0], pitch: 0, fov: 0 });
  const oeil: V3 = [v.eye[0], v.eye[1], v.eye[2]];
  return { oeil, cible: [oeil[0] + Math.cos(v.pitch) * 3, oeil[1] + Math.sin(v.pitch) * 3, oeil[2]], fov: v.fov, largeur, hauteur, pitch: v.pitch };
}

function placeOfConduite(h: Habitacle): DriveEyeSpec | undefined {
  return placeOf(h.manifeste, 'conducteur')?.view.conduite;
}

/**
 * Part de la vitesse perdue à la caméra `vue` (meilleur instrument de vitesse du manifeste) : points de sa
 * zone utile hors de l'image, ou cachés par le volant, la planche ou le reste du modèle (rayon depuis
 * l'œil, comme tests/unit/outils/vueConducteur.ts, mais sur le modèle posé comme l'app : longueur sur X).
 * `null` : aucun instrument de vitesse.
 */
export function vitessePerdue(h: Habitacle, vue: Vue): number | null {
  const panels = (h.manifeste.cabin?.panels ?? []).filter((panel) => panel.instrument?.mesure === 'vitesse');
  if (panels.length === 0) return null;
  const avant = norm(sub(vue.cible, vue.oeil));
  const droite = norm(cross(avant, [0, 1, 0]));
  const haut = cross(droite, avant);
  const t = Math.tan((vue.fov * Math.PI) / 360);
  let best = 1;
  for (const panel of panels) {
    const objet = new Object3D();
    objet.position.set(...panel.center);
    objet.lookAt(new Vector3(...panel.center).add(new Vector3(...panel.normal)));
    objet.updateMatrixWorld(true);
    const zone = zoneUtile(panel);
    const [w, hh] = panel.size;
    const p = new Vector3();
    let n = 0;
    let perdue = 0;
    const PAS = 12;
    for (let i = 0; i < PAS; i += 1) {
      for (let j = 0; j < PAS; j += 1) {
        const u = zone.u0 + ((i + 0.5) / PAS) * (zone.u1 - zone.u0);
        const v = zone.v0 + ((j + 0.5) / PAS) * (zone.v1 - zone.v0);
        if (!zone.contient(u, v)) continue;
        n += 1;
        p.set((u - 0.5) * w, (0.5 - v) * (panel.shape === 'disque' ? w : hh), 0).applyMatrix4(objet.matrixWorld);
        const d = sub([p.x, p.y, p.z], vue.oeil);
        const z = dot(d, avant);
        const x = z > 0 ? dot(d, droite) / z / (t * (vue.largeur / vue.hauteur)) : Infinity;
        const y = z > 0 ? dot(d, haut) / z / t : Infinity;
        const dedans = Math.abs(x) <= 1 && Math.abs(y) <= 1;
        const dist = Math.hypot(...d);
        const dir = norm(d);
        let cache = false;
        for (const tri of h.tris) {
          const hit = rayon(vue.oeil, dir, tri);
          if (hit !== null && hit < dist - 0.03) {
            cache = true;
            break;
          }
        }
        if (!dedans || cache) perdue += 1;
      }
    }
    best = Math.min(best, perdue / Math.max(1, n));
  }
  return best;
}
