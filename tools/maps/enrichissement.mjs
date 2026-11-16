// @ts-check
// Enrichissement d'une carte par OpenStreetMap (tools/maps/fetch.mjs) : ce que la donnée de l'IGN n'a
// pas, ramené dans le repère de la carte et limité au couloir du parcours. Rangé dans donnees.json
// sous la clé « osm », en nombres seulement (aucun texte, donc aucun nom) :
//   lampadaires  [x, z, …]                     arbres     [x, z, genre, …] (0 feuillu, 1 conifère, 3 palmier)
//   feux         [x, z, …]                     passages   [x, z, àFeux, …]
//   commerces    [x, z, genre, …] (rang dans MAP_SHOP_KINDS, src/data/mapTypes.ts)
//   routes       [{ v, n, o, s, c, p }]  vitesse (km/h, 0 inconnue), voies (0 inconnu), sens unique
//                (1 dans le sens des points, −1 à rebours, 0 double), sol (0, 1 pont, 2 tunnel), couche, points
//   barrieres    [{ t, h, p }]  0 glissière, 1 mur ; hauteur (0 inconnue) ; points
//   parcs        [[x, z, …]]   pistes [[x, z, …]]
//   batiments    [i, étages, toit, couleur, …] : attributs du bâtiment i de donnees.batiments
//                (−1 : inconnu ; toit : rang dans TOITS de fournisseurs/osm.mjs ; couleur : 0xRRGGBB)
// Fonctions pures, testées par tests/unit/cartes-osm.test.ts.

import { createHash } from 'node:crypto';
import { boite, dansPolygone, indexPolyligne, simplifier } from './geom2d.mjs';

/** Genres de commerces, dans l'ordre de MAP_SHOP_KINDS (src/data/mapTypes.ts ; un test vérifie l'accord). */
export const MAP_SHOP_KINDS = /** @type {const} */ (['bar', 'cafe', 'resto', 'glaces', 'club', 'pharmacie', 'station', 'hotel', 'garage', 'lavage', 'pneus', 'pieces', 'pain', 'cinema', 'boutique']);

/** Portées depuis l'axe du parcours, en mètres. */
export const PORTEES = { lampadaire: 40, feu: 25, passage: 12, commerce: 45, route: 25 };

/** @param {number} v @param {number} [n] */
const arr = (v, n = 1) => Math.round(v * 10 ** n) / 10 ** n + 0;

/**
 * @param {{ tuile: (ctx: any, bbox: [number, number, number, number]) => Promise<any> }} osm fournisseur (fournisseurs/osm.mjs)
 * @param {any} ctx lecteur à cache (fetch.mjs)
 * @param {Array<[number, number, number, number]>} tuiles emprises de requête du couloir
 * @param {{ versCarte: (x: number, y: number, z?: number) => [number, number, number] }} rep repère de la carte
 * @param {number[][]} axe axe du parcours [x, y, z] dans le repère de la carte
 * @param {number} dl demi-largeur du couloir
 * @param {Array<{ a: number[] }>} batiments bâtiments de donnees.json (contour à plat x, z, …)
 */
export async function enrichir(osm, ctx, tuiles, rep, axe, dl, batiments) {
  /** @type {any[]} */
  const brutes = [];
  for (const t of tuiles) brutes.push(await osm.tuile(ctx, t));
  return enrichirTuiles(brutes, rep, axe, dl, batiments);
}

/**
 * Partie pure d'`enrichir` : tuiles déjà lues (fournisseurs/osm.mjs, lireTuile).
 * @param {any[]} brutes @param {{ versCarte: (x: number, y: number, z?: number) => [number, number, number] }} rep
 * @param {number[][]} axe @param {number} dl @param {Array<{ a: number[] }>} batiments
 */
export function enrichirTuiles(brutes, rep, axe, dl, batiments) {
  const index = indexPolyligne(axe, { ix: 0, iz: 2, cellule: 100 });
  /** @param {number[]} p projeté → [X, Z] */
  const plan = (p) => {
    const c = rep.versCarte(p[0] ?? 0, p[1] ?? 0, 0);
    return [arr(c[0]), arr(c[2])];
  };
  const pres = (/** @type {number[]} */ q, /** @type {number} */ r) => index.proche(q[0] ?? 0, q[1] ?? 0, r).d <= r;
  /** @type {Set<string>} */
  const vus = new Set();
  /** Un objet par identité (les tuiles se chevauchent). @param {string} k */
  const nouveau = (k) => {
    if (vus.has(k)) return false;
    vus.add(k);
    return true;
  };
  const out = {
    /** @type {number[]} */ lampadaires: [],
    /** @type {number[]} */ arbres: [],
    /** @type {number[]} */ feux: [],
    /** @type {number[]} */ passages: [],
    /** @type {number[]} */ commerces: [],
    /** @type {Array<{ v: number, n: number, o: number, s: number, c: number, p: number[] }>} */ routes: [],
    /** @type {Array<{ t: number, h: number, p: number[] }>} */ barrieres: [],
    /** @type {number[][]} */ parcs: [],
    /** @type {number[][]} */ pistes: [],
    /** @type {number[]} */ batiments: [],
  };
  /** Parties d'une ligne à moins de r de l'axe, en suites de deux points au moins. @param {number[][]} pts @param {number} r */
  const parties = (pts, r) => {
    /** @type {number[][][]} */
    const res = [];
    /** @type {number[][]} */
    let run = [];
    for (const p of pts) {
      const q = plan(p);
      if (pres(q, r)) run.push(q);
      else {
        if (run.length >= 2) res.push(run);
        run = [];
      }
    }
    if (run.length >= 2) res.push(run);
    return res;
  };
  /** @type {Array<{ b: number[], an: number[][], toit: number, etages: number | null, couleur: string | null }>} */
  const batOsm = [];
  for (const t of brutes) {
    for (const p of t.lampadaires) {
      const q = plan(p);
      if (pres(q, PORTEES.lampadaire) && nouveau(`l${q}`)) out.lampadaires.push(q[0] ?? 0, q[1] ?? 0);
    }
    for (const [x, y, g] of t.arbres) {
      const q = plan([x, y]);
      if (pres(q, dl) && nouveau(`a${q}`)) out.arbres.push(q[0] ?? 0, q[1] ?? 0, g);
    }
    // Alignements : un arbre tous les 7 m.
    for (const al of t.alignements) {
      if (!nouveau(`al${al.id}`)) continue;
      const pts = al.points.map(plan);
      let reste = 0;
      for (let i = 1; i < pts.length; i += 1) {
        const a = pts[i - 1];
        const b = pts[i];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        let u = reste;
        for (; u < L; u += 7) {
          const q = [arr(a[0] + ((b[0] - a[0]) * u) / L), arr(a[1] + ((b[1] - a[1]) * u) / L)];
          if (pres(q, dl)) out.arbres.push(q[0] ?? 0, q[1] ?? 0, al.genre ?? 0);
        }
        reste = u - L;
      }
    }
    for (const p of t.feux) {
      const q = plan(p);
      if (pres(q, PORTEES.feu) && nouveau(`f${q}`)) out.feux.push(q[0] ?? 0, q[1] ?? 0);
    }
    for (const [x, y, k] of t.passages) {
      const q = plan([x, y]);
      if (pres(q, PORTEES.passage) && nouveau(`p${q}`)) out.passages.push(q[0] ?? 0, q[1] ?? 0, k);
    }
    for (const c of t.commerces) {
      const q = plan(c.p);
      const g = MAP_SHOP_KINDS.indexOf(c.genre);
      if (g >= 0 && pres(q, PORTEES.commerce) && nouveau(`c${q}`)) out.commerces.push(q[0] ?? 0, q[1] ?? 0, g);
    }
    for (const r of t.routes) {
      if (!nouveau(`r${r.id}`)) continue;
      const v = r.vitesse ?? 0;
      const n = r.voies ?? 0;
      const o = r.sens === 'direct' ? 1 : r.sens === 'inverse' ? -1 : 0;
      const s = r.sol === 'pont' ? 1 : r.sol === 'tunnel' ? 2 : 0;
      const c = r.couche ?? 0;
      if (!v && !n && !o && !s && !c) continue;
      for (const run of parties(r.points, PORTEES.route)) out.routes.push({ v, n, o, s, c, p: run.flat() });
    }
    for (const b of t.barrieres) {
      if (!nouveau(`b${b.id}`)) continue;
      for (const run of parties(b.points, dl)) out.barrieres.push({ t: b.type === 'glissiere' ? 0 : 1, h: arr(b.hauteur ?? 0), p: run.flat() });
    }
    for (const pc of t.parcs) {
      if (!nouveau(`pc${pc.id}${pc.anneaux[0]?.length}`)) continue;
      const an = simplifier(pc.anneaux[0].map(plan), 1);
      if (an.length < 4) continue;
      const bx = boite([an]);
      const touche = an.some((q) => pres(q, dl)) || axe.some((p, i) => i % 10 === 0 && (p[0] ?? 0) >= bx[0] && (p[0] ?? 0) <= bx[2] && (p[2] ?? 0) >= bx[1] && (p[2] ?? 0) <= bx[3] && dansPolygone(p[0] ?? 0, p[2] ?? 0, [an]));
      if (touche) out.parcs.push(an.flat());
    }
    for (const pi of t.pistes) {
      if (!nouveau(`pi${pi.id}`)) continue;
      for (const run of parties(pi.points, dl)) out.pistes.push(run.flat());
    }
    for (const b of t.batiments) {
      if (!nouveau(`bt${b.id}${b.anneau.length}`)) continue;
      if (!b.toit && b.etages === null && !b.couleur) continue;
      const an = b.anneau.map(plan);
      batOsm.push({ b: boite([an]), an, toit: b.toit, etages: b.etages, couleur: b.couleur });
    }
  }
  // Attributs des bâtiments : le bâtiment d'OSM qui contient le centre de celui de la carte.
  batiments.forEach((bt, i) => {
    let cx = 0;
    let cz = 0;
    const n = bt.a.length / 2;
    for (let k = 0; k < bt.a.length; k += 2) {
      cx += (bt.a[k] ?? 0) / n;
      cz += (bt.a[k + 1] ?? 0) / n;
    }
    const o = batOsm.find((x) => cx >= (x.b[0] ?? 0) && cx <= (x.b[2] ?? 0) && cz >= (x.b[1] ?? 0) && cz <= (x.b[3] ?? 0) && dansPolygone(cx, cz, [x.an]));
    if (o) out.batiments.push(i, o.etages ?? -1, o.toit, o.couleur ? parseInt(o.couleur.slice(1), 16) : -1);
  });
  return out;
}

/** Comptes par nature, pour le journal et le rendu. @param {ReturnType<typeof enrichirTuiles>} o */
export function compter(o) {
  return {
    lampadaires: o.lampadaires.length / 2,
    arbres: o.arbres.length / 3,
    palmiers: o.arbres.filter((v, i) => i % 3 === 2 && v === 3).length,
    feux: o.feux.length / 2,
    passages: o.passages.length / 3,
    commerces: o.commerces.length / 3,
    routes: o.routes.length,
    vitesses: o.routes.filter((r) => r.v > 0).length,
    barrieres: o.barrieres.length,
    glissieres: o.barrieres.filter((b) => b.t === 0).length,
    parcs: o.parcs.length,
    pistes: o.pistes.length,
    batiments: o.batiments.length / 4,
  };
}

/**
 * Grille de points pour les recherches de voisinage du fabricant (lampadaires, glissières, routes).
 * @template T
 */
export class Grille {
  /** @param {number} cellule */
  constructor(cellule) {
    this.c = cellule;
    /** @type {Map<string, Array<{ x: number, z: number, v: T }>>} */
    this.cases = new Map();
  }
  /** @param {number} x @param {number} z @param {T} v */
  ajouter(x, z, v) {
    const k = `${Math.floor(x / this.c)}|${Math.floor(z / this.c)}`;
    const l = this.cases.get(k);
    if (l) l.push({ x, z, v });
    else this.cases.set(k, [{ x, z, v }]);
  }
  /** Points à moins de r, du plus proche au plus loin. @param {number} x @param {number} z @param {number} r */
  proches(x, z, r) {
    /** @type {Array<{ x: number, z: number, v: T, d: number }>} */
    const out = [];
    const n = Math.ceil(r / this.c);
    const i0 = Math.floor(x / this.c);
    const j0 = Math.floor(z / this.c);
    for (let j = j0 - n; j <= j0 + n; j += 1)
      for (let i = i0 - n; i <= i0 + n; i += 1)
        for (const p of this.cases.get(`${i}|${j}`) ?? []) {
          const d = Math.hypot(p.x - x, p.z - z);
          if (d <= r) out.push({ ...p, d });
        }
    return out.sort((a, b) => a.d - b.d);
  }
}

/**
 * Points d'une polyligne à plat [x, z, …] tous les `pas` mètres au plus, avec leur direction unitaire.
 * @param {number[]} p @param {number} pas
 * @returns {Array<{ x: number, z: number, dx: number, dz: number }>}
 */
export function jalonner(p, pas) {
  /** @type {Array<{ x: number, z: number, dx: number, dz: number }>} */
  const out = [];
  for (let k = 2; k < p.length; k += 2) {
    const ax = p[k - 2] ?? 0;
    const az = p[k - 1] ?? 0;
    const bx = p[k] ?? 0;
    const bz = p[k + 1] ?? 0;
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-6) continue;
    const n = Math.max(1, Math.ceil(L / pas));
    for (let t = 0; t < n; t += 1) out.push({ x: ax + ((bx - ax) * t) / n, z: az + ((bz - az) * t) / n, dx: (bx - ax) / L, dz: (bz - az) / L });
    if (k === p.length - 2) out.push({ x: bx, z: bz, dx: (bx - ax) / L, dz: (bz - az) / L });
  }
  return out;
}

/**
 * Vitesse limite d'OSM le long du rail : pour chaque point, la route d'OSM la plus proche à moins de
 * `r` mètres, alignée sur la marche (|cos| ≥ 0,7) ; 0 si aucune.
 * @param {number[][]} rail [x, y, z] @param {Array<{ v: number, p: number[] }>} routes @param {number} [r]
 */
export function vitessesLeLong(rail, routes, r = 7) {
  /** @type {Grille<{ v: number, dx: number, dz: number }>} */
  const g = new Grille(10);
  for (const ro of routes) if (ro.v > 0) for (const q of jalonner(ro.p, 2)) g.ajouter(q.x, q.z, { v: ro.v, dx: q.dx, dz: q.dz });
  return rail.map((p, i) => {
    const a = rail[Math.max(0, i - 2)] ?? p;
    const b = rail[Math.min(rail.length - 1, i + 2)] ?? p;
    const tx = (b[0] ?? 0) - (a[0] ?? 0);
    const tz = (b[2] ?? 0) - (a[2] ?? 0);
    const L = Math.hypot(tx, tz) || 1;
    const m = g.proches(p[0] ?? 0, p[2] ?? 0, r).find((q) => Math.abs((q.v.dx * tx + q.v.dz * tz) / L) >= 0.7);
    return m ? m.v.v : 0;
  });
}

/** Nom ramené à sa forme de comparaison : minuscules, sans accents, mots séparés d'une espace. @param {string} t */
export function normaliserNom(t) {
  return String(t)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Empreinte d'un nom normalisé (16 chiffres hexadécimaux de son SHA-256). @param {string} n */
export function empreinteNom(n) {
  return createHash('sha256').update(n).digest('hex').slice(0, 16);
}

/** Clés d'OSM qui nomment un commerce, une marque ou un exploitant (jamais gardées). */
export const CLES_NOMS = /^(name|brand|operator|official_name|alt_name|old_name|short_name|loc_name|int_name|reg_name)(:|$)/;

/** Clés d'OSM gardées dans le cache brut (tout le reste, contacts et adresses compris, est jeté). */
const CLES_GARDEES = new Set(['highway', 'ref', 'lanes', 'maxspeed', 'oneway', 'junction', 'width', 'bridge', 'tunnel', 'layer', 'service', 'access', 'building', 'building:levels', 'roof:levels', 'height', 'roof:shape', 'building:colour', 'natural', 'leaf_type', 'genus', 'species', 'taxon', 'taxon:en', 'species:en', 'waterway', 'landuse', 'leisure', 'barrier', 'crossing', 'crossing:markings', 'crossing_ref', 'amenity', 'shop', 'tourism']);

/**
 * Filtre d'une réponse Overpass avant qu'elle soit gardée sur le disque : seules les clés utiles
 * restent (CLES_GARDEES), et le nom des seules rues ; les noms, marques et exploitants des commerces,
 * hôtels, bureaux et artisans sont rendus à part (pour leurs empreintes), jamais écrits.
 * @param {any} json
 * @returns {{ json: any, noms: string[] }}
 */
export function filtrerOverpass(json) {
  /** @type {string[]} */
  const noms = [];
  const elements = (json.elements ?? []).map((/** @type {any} */ e) => {
    const g = e.tags ?? {};
    /** @type {Record<string, string>} */
    const tags = {};
    for (const [k, v] of Object.entries(g)) {
      // Numéro de route seulement (« D1085 », « SR A1A ») : pas les références d'itinéraires de randonnée.
      if (k === 'ref' && !(/\d/.test(String(v)) && String(v).length <= 12)) continue;
      if (CLES_GARDEES.has(k)) tags[k] = String(v);
      else if (CLES_NOMS.test(k) && (g.amenity || g.shop || g.tourism || g.craft || g.office || g.brand)) noms.push(String(v));
    }
    if (g.highway && typeof g.name === 'string' && !(g.amenity || g.shop || g.tourism)) tags.name = g.name;
    return { ...e, ...(e.tags ? { tags } : {}) };
  });
  return { json: { ...json, elements }, noms };
}
