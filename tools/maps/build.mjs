// @ts-check
// Fabrication des cartes de sortie, hors ligne et déterministe : pour chaque dossier
// assets-src/maps/<id>/ qui a carte.json et donnees.json (écrit par « npm run maps:fetch -- <id> »),
// écrit public/assets/maps/<id>/route.json (type MapRoute de src/data/mapTypes.ts),
// chunks/NNN.glb (un maillage par rôle, fusion_<rôle>) et lointain.glb. Aucun identifiant de carte
// dans le code ; aucun accès au réseau.
//
//   node tools/maps/build.mjs [id…]      npm run maps:build [-- id…]

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ShapeUtils, Vector2 } from 'three';
import { aire, boite, dansPolygone, decouperRectangle, hasard, indexPolyligne } from './geom2d.mjs';
import { Assembleur, ecrireGlb } from './maillage.mjs';
import { decouper, dentsDeScie, densifier, lisserSerie, pentes, rayons, reechantillonner, sections as faireSections } from './trace.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'assets-src', 'maps');
const OUT = join(ROOT, 'public', 'assets', 'maps');

/** Décalages du terrain au-delà du bord d'accotement, en mètres (le dernier est ramené à la demi-largeur du couloir). */
const DECALAGES = [0, 1.5, 3.5, 6, 9, 13, 18, 24, 32, 42, 54, 68, 85, 105, 127];
/** Pente des talus (déblai et remblai) : 2 de haut pour 3 de long. */
const TALUS = 2 / 3;
/** Un profil en travers tous les K points du rail. */
const K = 2;

/** @param {number} v @param {number} [n] */
const arr = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;
/** @param {number} a @param {number} b @param {number} t */
const mix = (a, b, t) => a + (b - a) * t;

/**
 * Relief : grille du couloir (suites par ligne), repli sur la grille lointaine proche.
 * @param {any} d donnees.json
 */
function relief(d) {
  const pas = d.couloir.pas;
  /** @type {Map<number, Array<{ i0: number, v: Float64Array }>>} */
  const lignes = new Map();
  let k = 0;
  for (const [j, i0, n] of d.couloir.suites) {
    const v = new Float64Array(n);
    for (let t = 0; t < n; t += 1) v[t] = (d.couloir.dm[k++] ?? 0) / 10;
    const l = lignes.get(j);
    if (l) l.push({ i0, v });
    else lignes.set(j, [{ i0, v }]);
  }
  /** @param {number} i @param {number} j */
  const noeud = (i, j) => {
    for (const s of lignes.get(j) ?? []) if (i >= s.i0 && i < s.i0 + s.v.length) return s.v[i - s.i0] ?? null;
    return null;
  };
  const g = d.lointain.proche;
  /** @param {number} x @param {number} z */
  const grossier = (x, z) => {
    const fi = Math.min(g.nx - 1.001, Math.max(0, x / g.pas - g.i0));
    const fj = Math.min(g.nz - 1.001, Math.max(0, z / g.pas - g.j0));
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    const v = (/** @type {number} */ a, /** @type {number} */ b) => (g.dm[b * g.nx + a] ?? 0) / 10;
    return mix(mix(v(i, j), v(i + 1, j), fi - i), mix(v(i, j + 1), v(i + 1, j + 1), fi - i), fj - j);
  };
  /** Altitude du terrain nu (repère de la carte). @param {number} x @param {number} z */
  return (x, z) => {
    const fi = x / pas;
    const fj = z / pas;
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    const a = noeud(i, j);
    const b = noeud(i + 1, j);
    const c = noeud(i, j + 1);
    const e = noeud(i + 1, j + 1);
    if (a === null || b === null || c === null || e === null) return grossier(x, z);
    return mix(mix(a, b, fi - i), mix(c, e, fi - i), fj - j);
  };
}

/**
 * Construit une carte : route, tronçons et relief lointain, en mémoire.
 * @param {string} id
 * @param {{ srcDir?: string }} [o]
 */
export function buildMap(id, o = {}) {
  const dir = join(o.srcDir ?? SRC, id);
  const carte = JSON.parse(readFileSync(join(dir, 'carte.json'), 'utf8'));
  const d = JSON.parse(readFileSync(join(dir, 'donnees.json'), 'utf8'));
  if (d.format !== 'pmb-carte-donnees' || d.id !== id) throw new Error(`${id} : donnees.json inattendu`);
  const fab = carte.fabrication;
  const step = fab.pasRail;
  const dl = carte.couloir.demiLargeur;

  // --- 1. Rail : densifié au mètre, lissé (plan et altitude), rééchantillonné à pas constant.
  const brut = [];
  for (let i = 0; i < d.axe.points.length; i += 3) brut.push([d.axe.points[i], d.axe.points[i + 2], d.axe.points[i + 1]]);
  const dense = densifier(brut, d.axe.rang, 1);
  const xs = lisserSerie(dense.points.map((p) => p[0] ?? 0), fab.lissagePlan);
  const zs = lisserSerie(dense.points.map((p) => p[1] ?? 0), fab.lissagePlan);
  const ys = lisserSerie(dense.points.map((p) => p[2] ?? 0), fab.lissageAltitude);
  const lisse = xs.map((x, i) => [x, ys[i] ?? 0, zs[i] ?? 0]);
  const rs = reechantillonner(lisse, step);
  const rail = rs.points.map((p) => [arr(p[0] ?? 0), arr(p[1] ?? 0), arr(p[2] ?? 0)]);
  const N = rail.length;
  const length = (N - 1) * step;
  const rangDe = (/** @type {number} */ i) => dense.etiquettes[Math.min(dense.etiquettes.length - 1, Math.round(rs.source[i] ?? 0))] ?? 0;

  // --- 2. Sections (sol, pont, tunnel ; agglomération ; voies ; largeur).
  const valeurs = rail.map((_, i) => {
    const t = d.axe.troncons[rangDe(i)] ?? {};
    const lanes = t.voies && t.voies > 0 ? t.voies : 2;
    const width = t.largeur && t.largeur > 0 ? t.largeur : lanes * 3;
    return { ground: /** @type {'sol' | 'pont' | 'tunnel'} */ (t.sol ?? 'sol'), urban: Boolean(t.urbain), lanes, width };
  });
  const sections = faireSections(valeurs, step, 30).map((s) => ({ from: arr(s.from), to: arr(s.to), ground: s.ground, urban: s.urban, lanes: s.lanes, width: s.width }));
  const sectionDe = (/** @type {number} */ i) => {
    const s = i * step;
    return sections.find((x) => s >= x.from && s <= x.to) ?? /** @type {typeof sections[0]} */ (sections[sections.length - 1]);
  };
  const sec = rail.map((_, i) => sectionDe(i));
  // Largeur adoucie sur une vingtaine de mètres aux changements de section.
  const largeur = lisserSerie(sec.map((s) => s.width), 8 / step);

  // --- 3. Repères locaux : tangente plane et normale à droite (X est, Z sud : droite = (−tz, tx)).
  const T = rail.map((_, i) => {
    const a = /** @type {number[]} */ (rail[Math.max(0, i - 2)]);
    const b = /** @type {number[]} */ (rail[Math.min(N - 1, i + 2)]);
    const tx = (b[0] ?? 0) - (a[0] ?? 0);
    const tz = (b[2] ?? 0) - (a[2] ?? 0);
    const L = Math.hypot(tx, tz) || 1;
    return [tx / L, tz / L];
  });
  const terrainNu = relief(d);
  const lacs = d.lacs.map((/** @type {any} */ l) => {
    const anneaux = l.anneaux.map((/** @type {number[]} */ f) => {
      const a = [];
      for (let i = 0; i < f.length; i += 2) a.push([f[i] ?? 0, f[i + 1] ?? 0]);
      return a;
    });
    return { nom: l.nom, y: l.y, anneaux, b: boite(anneaux) };
  });
  /** @param {number} x @param {number} z */
  const lacEn = (x, z) => lacs.find((/** @type {any} */ l) => x >= l.b[0] && x <= l.b[2] && z >= l.b[1] && z <= l.b[3] && dansPolygone(x, z, l.anneaux)) ?? null;
  /** Terrain nu, abaissé sous les plans d'eau. @param {number} x @param {number} z */
  const H = (x, z) => {
    const h = terrainNu(x, z);
    const l = lacEn(x, z);
    return l ? Math.min(h, l.y - 1.5) : h;
  };

  // --- 4. Profils en travers aux stations (tous les K points), calculés une fois pour toute la carte.
  /** @type {number[]} */
  const stations = [];
  for (let i = 0; i < N; i += K) stations.push(i);
  if (stations[stations.length - 1] !== N - 1) stations.push(N - 1);
  const NS = stations.length;
  // Décalages retenus : ceux qui restent dans le couloir pour le plus large des profils, puis le bord du couloir.
  const eMax = Math.max(...largeur.map((w) => w / 2)) + 2.2;
  const DEC = DECALAGES.filter((v) => v < dl - eMax - 5);
  const nT = DEC.length + 1;
  // Normales moyennées sur une fenêtre qui grandit avec le décalage (évite les plis à l'intérieur des courbes).
  const cumX = [0];
  const cumZ = [0];
  for (const i of stations) {
    const t = /** @type {number[]} */ (T[i]);
    cumX.push((cumX[cumX.length - 1] ?? 0) - (t[1] ?? 0));
    cumZ.push((cumZ[cumZ.length - 1] ?? 0) + (t[0] ?? 0));
  }
  /** @param {number} s @param {number} w */
  const normale = (s, w) => {
    const a = Math.max(0, s - w);
    const b = Math.min(NS - 1, s + w);
    const nx = (cumX[b + 1] ?? 0) - (cumX[a] ?? 0);
    const nz = (cumZ[b + 1] ?? 0) - (cumZ[a] ?? 0);
    const L = Math.hypot(nx, nz) || 1;
    return [nx / L, nz / L];
  };
  const profils = stations.map((i, s) => {
    const p = /** @type {number[]} */ (rail[i]);
    const hw = (largeur[i] ?? 6) / 2;
    const se = sec[i] ?? /** @type {typeof sections[0]} */ (sections[0]);
    const sw = se.urban ? 2.2 : 1.0;
    const bordure = se.urban ? 0.14 : 0;
    const y = p[1] ?? 0;
    const e = hw + sw;
    const ye = y + bordure - (se.urban ? 0 : 0.05);
    return { i, s, p, hw, sw, e, y, ye, bordure, ground: se.ground, urban: se.urban, n: normale(s, 0) };
  });
  // Terrain : positions (pliages repoussés le long de la tangente) puis altitudes avec talus.
  const terX = new Float64Array(NS * 2 * nT);
  const terZ = new Float64Array(NS * 2 * nT);
  const terY = new Float64Array(NS * 2 * nT);
  const at = (/** @type {number} */ s, /** @type {number} */ c, /** @type {number} */ k) => (s * 2 + c) * nT + k;
  let talusMax = 0;
  let ecartAxe = 0;
  for (const [c, cote] of /** @type {Array<[number, number]>} */ ([
    [0, -1],
    [1, 1],
  ])) {
    for (let k = 0; k < nT; k += 1) {
      for (let s = 0; s < NS; s += 1) {
        const pr = /** @type {typeof profils[0]} */ (profils[s]);
        const dk = k < DEC.length ? (DEC[k] ?? 0) : dl - pr.e;
        const w = Math.min(30, Math.round(dk / 6));
        const n = normale(s, w);
        let x = (pr.p[0] ?? 0) + (n[0] ?? 0) * cote * (pr.e + dk);
        let z = (pr.p[2] ?? 0) + (n[1] ?? 0) * cote * (pr.e + dk);
        if (s > 0) {
          const q = at(s - 1, c, k);
          const t = /** @type {number[]} */ (T[pr.i]);
          const av = (x - (terX[q] ?? 0)) * (t[0] ?? 0) + (z - (terZ[q] ?? 0)) * (t[1] ?? 0);
          if (av < 0.5) {
            x += (t[0] ?? 0) * (0.5 - av);
            z += (t[1] ?? 0) * (0.5 - av);
          }
        }
        const q = at(s, c, k);
        terX[q] = x;
        terZ[q] = z;
        const hn = H(x, z);
        let y;
        if (pr.ground === 'sol') {
          y = pr.ye + Math.max(-dk * TALUS, Math.min(dk * TALUS, hn - pr.ye));
          if (k === 0) talusMax = Math.max(talusMax, Math.abs(hn - pr.ye));
        } else y = Math.min(hn, pr.y - 2.5 + dk * 0.3);
        terY[q] = y;
      }
    }
  }
  for (const pr of profils) if (pr.ground === 'sol') ecartAxe = Math.max(ecartAxe, Math.abs(terrainNu(pr.p[0] ?? 0, pr.p[2] ?? 0) - pr.y));
  // Garde : aucun sommet de terrain au-dessus de l'emprise de la chaussée (courbes serrées, retours de la route).
  const idxRail = indexPolyligne(rail, { ix: 0, iz: 2, cellule: 40 });
  let terrainSurRoute = 0;
  for (let q = 0; q < terX.length; q += 1) {
    const pr = idxRail.proche(terX[q] ?? 0, terZ[q] ?? 0, 15);
    if (pr.i < 0) continue;
    const r = /** @type {number[]} */ (rail[pr.i]);
    const pf = /** @type {typeof profils[0]} */ (profils[Math.min(NS - 1, Math.round(pr.i / K))]);
    if (pr.d < pf.e - 0.2 && (terY[q] ?? 0) > (r[1] ?? 0) - 0.3) {
      terY[q] = (r[1] ?? 0) - 0.6;
      terrainSurRoute += 1;
    }
  }
  // Écart chaussée-terrain au bord : bord d'accotement contre premier sommet du terrain (sections au sol).
  let ecartBord = 0;
  for (let s = 0; s < NS; s += 1) {
    const pr = /** @type {typeof profils[0]} */ (profils[s]);
    if (pr.ground !== 'sol') continue;
    for (const c of [0, 1]) ecartBord = Math.max(ecartBord, Math.abs((terY[at(s, c, 0)] ?? 0) - pr.ye));
  }

  /** Altitude du sol aménagé (talus compris) en un point, pour poser les objets. @param {number} x @param {number} z */
  const sol = (x, z) => {
    const pr = idxRail.proche(x, z, dl);
    if (pr.i < 0) return H(x, z);
    const pf = /** @type {typeof profils[0]} */ (profils[Math.min(NS - 1, Math.round(pr.i / K))]);
    if (pr.d <= pf.e) return pf.ye;
    const dk = pr.d - pf.e;
    if (pf.ground !== 'sol') return H(x, z);
    return pf.ye + Math.max(-dk * TALUS, Math.min(dk * TALUS, H(x, z) - pf.ye));
  };

  // --- 5. Glissières : le long de l'eau ou d'un vide, hors agglomération et hors pont.
  const glis = [0, 1].map((c) => {
    const f = profils.map((pr, s) => {
      if (pr.urban || pr.ground !== 'sol') return false;
      const cote = c === 0 ? -1 : 1;
      const n = /** @type {number[]} */ (pr.n);
      const pt = (/** @type {number} */ dd) => [(pr.p[0] ?? 0) + (n[0] ?? 0) * cote * (pr.e + dd), (pr.p[2] ?? 0) + (n[1] ?? 0) * cote * (pr.e + dd)];
      const eau = [4, 10, 18].some((dd) => {
        const [x, z] = pt(dd);
        return lacEn(x ?? 0, z ?? 0) !== null;
      });
      const [x8, z8] = pt(8);
      const vide = terrainNu(x8 ?? 0, z8 ?? 0) < pr.ye - 3;
      return eau || vide || (terY[at(s, c, 3)] ?? 0) < pr.ye - 3;
    });
    // Comblement des trous de moins de 24 m, suppression des bouts de moins de 32 m.
    for (let s = 0; s < NS; s += 1)
      if (!f[s]) {
        let e = s;
        while (e < NS && !f[e]) e += 1;
        if (s > 0 && e < NS && e - s < 6) for (let t = s; t < e; t += 1) f[t] = true;
        s = e;
      }
    for (let s = 0; s < NS; s += 1)
      if (f[s]) {
        let e = s;
        while (e < NS && f[e]) e += 1;
        if (e - s < 8) for (let t = s; t < e; t += 1) f[t] = false;
        s = e;
      }
    return f;
  });

  // --- 6. Découpage en tronçons et attribution des objets au tronçon le plus proche.
  const bornes = decouper(NS, step * K, fab.longueurTroncon);
  const chunkDeStation = new Int32Array(NS);
  bornes.forEach(([a, b], c) => {
    for (let s = a; s <= b; s += 1) chunkDeStation[s] = c;
  });
  /** @param {number} x @param {number} z @param {number} r */
  const chunkEn = (x, z, r) => {
    const pr = idxRail.proche(x, z, r);
    return pr.i < 0 ? -1 : (chunkDeStation[Math.min(NS - 1, Math.round(pr.i / K))] ?? -1);
  };
  /** @type {Array<Map<import('./maillage.mjs').Role, Assembleur>>} */
  const parChunk = bornes.map(() => new Map());
  /** @param {number} c @param {import('./maillage.mjs').Role} role */
  const asm = (c, role) => {
    const m = /** @type {Map<import('./maillage.mjs').Role, Assembleur>} */ (parChunk[c]);
    let a = m.get(role);
    if (!a) {
      a = new Assembleur();
      m.set(role, a);
    }
    return a;
  };
  /** @type {Array<{ arbre: number[], lampadaire: number[], balise: number[] }>} */
  const instances = bornes.map(() => ({ arbre: [], lampadaire: [], balise: [] }));

  // --- 7. Ruban de route, accotements, terrain, ouvrages, glissières, marquage : par tronçon.
  bornes.forEach(([a, b], c) => {
    const ch = asm(c, 'chaussee');
    const ac = asm(c, 'accotement');
    const te = asm(c, 'terrain');
    const ou = asm(c, 'ouvrage');
    const gl = asm(c, 'glissiere');
    /** @type {number[][]} */
    const prevRoute = [];
    for (let s = a; s <= b; s += 1) {
      const pr = /** @type {typeof profils[0]} */ (profils[s]);
      const n = pr.n;
      /** @param {number} u @param {number} y */
      const P = (u, y) => /** @type {[number, number, number]} */ ([(pr.p[0] ?? 0) + (n[0] ?? 0) * u, y, (pr.p[2] ?? 0) + (n[1] ?? 0) * u]);
      // Chaussée bombée : bord gauche, axe, bord droit.
      const r = [ch.sommet(...P(-pr.hw, pr.y)), ch.sommet(...P(0, pr.y + 0.06)), ch.sommet(...P(pr.hw, pr.y))];
      // Accotements (bordure de trottoir en agglomération) : bas, haut, extérieur.
      const acc = [-1, 1].map((cote) => [ac.sommet(...P(cote * pr.hw, pr.y)), ac.sommet(...P(cote * pr.hw, pr.y + pr.bordure)), ac.sommet(...P(cote * pr.e, pr.ye))]);
      const ter = [0, 1].map((cc) => Array.from({ length: nT }, (_, k) => te.sommet(terX[at(s, cc, k)] ?? 0, terY[at(s, cc, k)] ?? 0, terZ[at(s, cc, k)] ?? 0)));
      const prev = prevRoute.pop();
      if (prev && s > a) {
        const [pr0, pacc, pter] = /** @type {[number[], number[][], number[][]]} */ (/** @type {unknown} */ (prev));
        // Sens : la face visible est vue d'en haut (Y vers le haut, avance vers la tangente).
        ch.quad(/** @type {number} */ (pr0[0]), /** @type {number} */ (pr0[1]), /** @type {number} */ (r[1]), /** @type {number} */ (r[0]));
        ch.quad(/** @type {number} */ (pr0[1]), /** @type {number} */ (pr0[2]), /** @type {number} */ (r[2]), /** @type {number} */ (r[1]));
        // Gauche : de l'extérieur vers la chaussée ; droite : de la chaussée vers l'extérieur.
        const L0 = /** @type {number[]} */ (pacc[0]);
        const L1 = /** @type {number[]} */ (acc[0]);
        const R0 = /** @type {number[]} */ (pacc[1]);
        const R1 = /** @type {number[]} */ (acc[1]);
        ac.quad(/** @type {number} */ (L0[2]), /** @type {number} */ (L0[1]), /** @type {number} */ (L1[1]), /** @type {number} */ (L1[2]));
        ac.quad(/** @type {number} */ (L0[1]), /** @type {number} */ (L0[0]), /** @type {number} */ (L1[0]), /** @type {number} */ (L1[1]));
        ac.quad(/** @type {number} */ (R0[0]), /** @type {number} */ (R0[1]), /** @type {number} */ (R1[1]), /** @type {number} */ (R1[0]));
        ac.quad(/** @type {number} */ (R0[1]), /** @type {number} */ (R0[2]), /** @type {number} */ (R1[2]), /** @type {number} */ (R1[1]));
        for (let k = 0; k < nT - 1; k += 1) {
          const tl0 = /** @type {number[]} */ (pter[0]);
          const tl1 = /** @type {number[]} */ (ter[0]);
          const tr0 = /** @type {number[]} */ (pter[1]);
          const tr1 = /** @type {number[]} */ (ter[1]);
          te.quad(/** @type {number} */ (tl0[k + 1]), /** @type {number} */ (tl0[k]), /** @type {number} */ (tl1[k]), /** @type {number} */ (tl1[k + 1]));
          te.quad(/** @type {number} */ (tr0[k]), /** @type {number} */ (tr0[k + 1]), /** @type {number} */ (tr1[k + 1]), /** @type {number} */ (tr1[k]));
        }
      }
      prevRoute.push(/** @type {any} */ ([r, acc, ter]));
    }
    // Ponts : parapets et tablier, par suites de stations sur un ouvrage.
    for (let s = a; s < b; s += 1) {
      const p0 = /** @type {typeof profils[0]} */ (profils[s]);
      const p1 = /** @type {typeof profils[0]} */ (profils[s + 1]);
      if (p0.ground !== 'pont' && p1.ground !== 'pont') continue;
      const coupe = (/** @type {typeof profils[0]} */ pr) => {
        const n = pr.n;
        const P = (/** @type {number} */ u, /** @type {number} */ y) => /** @type {[number, number, number]} */ ([(pr.p[0] ?? 0) + (n[0] ?? 0) * u, y, (pr.p[2] ?? 0) + (n[1] ?? 0) * u]);
        return [-1, 1].map((cote) => [P(cote * pr.e, pr.ye), P(cote * pr.e, pr.ye + 0.9), P(cote * (pr.e + 0.35), pr.ye + 0.9), P(cote * (pr.e + 0.35), pr.y - 1.2)]);
      };
      const c0 = coupe(p0);
      const c1 = coupe(p1);
      for (const cote of [0, 1]) {
        const A = (/** @type {number[][]} */ (c0[cote])).map((v) => ou.sommet(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0));
        const B = (/** @type {number[][]} */ (c1[cote])).map((v) => ou.sommet(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0));
        for (let k = 0; k < 3; k += 1) {
          if (cote === 0) ou.quad(/** @type {number} */ (A[k]), /** @type {number} */ (B[k]), /** @type {number} */ (B[k + 1]), /** @type {number} */ (A[k + 1]));
          else ou.quad(/** @type {number} */ (A[k + 1]), /** @type {number} */ (B[k + 1]), /** @type {number} */ (B[k]), /** @type {number} */ (A[k]));
        }
      }
      // Dessous du tablier.
      const g0 = /** @type {number[][]} */ (c0[0])[3] ?? [];
      const d0 = /** @type {number[][]} */ (c0[1])[3] ?? [];
      const g1 = /** @type {number[][]} */ (c1[0])[3] ?? [];
      const d1 = /** @type {number[][]} */ (c1[1])[3] ?? [];
      const v = [g0, g1, d1, d0].map((q) => ou.sommet(q[0] ?? 0, q[1] ?? 0, q[2] ?? 0));
      ou.quad(/** @type {number} */ (v[0]), /** @type {number} */ (v[1]), /** @type {number} */ (v[2]), /** @type {number} */ (v[3]));
    }
    // Glissières : lisse de 0,30 m entre 0,45 et 0,75 m, poteau à chaque station.
    for (const cc of [0, 1]) {
      const f = /** @type {boolean[]} */ (glis[cc]);
      const cote = cc === 0 ? -1 : 1;
      for (let s = a; s <= b; s += 1) {
        if (!f[s]) continue;
        const pr = /** @type {typeof profils[0]} */ (profils[s]);
        const n = pr.n;
        const u = cote * (pr.e - 0.3);
        const x = (pr.p[0] ?? 0) + (n[0] ?? 0) * u;
        const z = (pr.p[2] ?? 0) + (n[1] ?? 0) * u;
        // Poteau : deux plans croisés.
        const t = /** @type {number[]} */ (T[pr.i]);
        for (const [dx, dz] of [
          [(t[0] ?? 0) * 0.07, (t[1] ?? 0) * 0.07],
          [(n[0] ?? 0) * 0.07, (n[1] ?? 0) * 0.07],
        ]) {
          const q = [gl.sommet(x - (dx ?? 0), pr.ye - 0.3, z - (dz ?? 0)), gl.sommet(x + (dx ?? 0), pr.ye - 0.3, z + (dz ?? 0)), gl.sommet(x + (dx ?? 0), pr.ye + 0.7, z + (dz ?? 0)), gl.sommet(x - (dx ?? 0), pr.ye + 0.7, z - (dz ?? 0))];
          gl.quad(/** @type {number} */ (q[0]), /** @type {number} */ (q[1]), /** @type {number} */ (q[2]), /** @type {number} */ (q[3]));
          gl.quad(/** @type {number} */ (q[1]), /** @type {number} */ (q[0]), /** @type {number} */ (q[3]), /** @type {number} */ (q[2]));
        }
        if (s < b && f[s + 1]) {
          const p1 = /** @type {typeof profils[0]} */ (profils[s + 1]);
          const lisse = (/** @type {typeof profils[0]} */ q, /** @type {number} */ du) => {
            const uu = cote * (q.e - 0.3 + du);
            return [0.45, 0.75].map((h) => gl.sommet((q.p[0] ?? 0) + (q.n[0] ?? 0) * uu, q.ye + h, (q.p[2] ?? 0) + (q.n[1] ?? 0) * uu));
          };
          const A = [...lisse(pr, -0.06), ...lisse(pr, 0.06)];
          const B = [...lisse(p1, -0.06), ...lisse(p1, 0.06)];
          // Face côté route, dessus, face arrière (orientées selon le côté).
          const faces = [
            [0, 1],
            [1, 3],
            [3, 2],
          ];
          for (const [i0, i1] of faces) {
            const q = [A[i0 ?? 0], B[i0 ?? 0], B[i1 ?? 0], A[i1 ?? 0]].map((v) => /** @type {number} */ (v));
            if (cote > 0) gl.quad(/** @type {number} */ (q[0]), /** @type {number} */ (q[3]), /** @type {number} */ (q[2]), /** @type {number} */ (q[1]));
            else gl.quad(/** @type {number} */ (q[0]), /** @type {number} */ (q[1]), /** @type {number} */ (q[2]), /** @type {number} */ (q[3]));
          }
        }
      }
    }
  });

  // Marquage : axe en tirets (3 m, 10 m de vide), lignes de rive continues hors agglomération.
  /**
   * Bande de marquage suivant le rail entre deux points, au décalage u (m), largeur l.
   * @param {number} i0 @param {number} i1 @param {(i: number) => number} u @param {number} l
   */
  const bande = (i0, i1, u, l) => {
    const c = chunkDeStation[Math.min(NS - 1, Math.floor(i0 / K))] ?? 0;
    const m = asm(c, 'marquage');
    /** @type {number[]} */
    let prev = [];
    for (let i = i0; i <= i1; i += 1) {
      const p = /** @type {number[]} */ (rail[i]);
      const t = /** @type {number[]} */ (T[i]);
      const n = [-(t[1] ?? 0), t[0] ?? 0];
      const hw = (largeur[i] ?? 6) / 2;
      const ui = u(i);
      const cur = [ui - l / 2, ui + l / 2].map((uu) => m.sommet((p[0] ?? 0) + (n[0] ?? 0) * uu, (p[1] ?? 0) + 0.06 * (1 - Math.min(1, Math.abs(uu) / hw)) + 0.015, (p[2] ?? 0) + (n[1] ?? 0) * uu));
      if (prev.length) m.quad(/** @type {number} */ (prev[0]), /** @type {number} */ (prev[1]), /** @type {number} */ (cur[1]), /** @type {number} */ (cur[0]));
      prev = cur;
    }
  };
  const tiret = Math.round(3 / step);
  const periode = Math.round(13 / step);
  for (let i = 0; i + tiret < N; i += periode) if ((sec[i]?.ground ?? 'sol') !== 'tunnel') bande(i, i + tiret, () => 0, 0.13);
  // Lignes de rive, par morceaux qui ne chevauchent pas deux tronçons.
  for (const [a, b] of bornes) {
    const i0 = stations[a] ?? 0;
    const i1 = stations[b] ?? 0;
    let s = i0;
    while (s < i1) {
      if (sec[s]?.urban) {
        s += 1;
        continue;
      }
      let e = s;
      while (e < i1 && !sec[e]?.urban) e += 1;
      if (e > s) for (const cote of [-1, 1]) bande(s, e, (i) => cote * ((largeur[i] ?? 6) / 2 - 0.3), 0.15);
      s = e + 1;
    }
  }

  // --- 8. Routes voisines : rubans posés sur le sol aménagé, arrêtés au bord de l’accotement.
  for (const v of d.voisines) {
    const pts = [];
    for (let i = 0; i < v.points.length; i += 3) pts.push([v.points[i], v.points[i + 2]]);
    const dn = densifier(pts.map((p) => [p[0], p[1], 0]), pts.map(() => 0), 4).points;
    const w = Math.max(3, Math.min(9, v.largeur)) / 2;
    /** @type {number[]} */
    let prev = [];
    let prevC = -1;
    for (let i = 0; i < dn.length; i += 1) {
      const p = /** @type {number[]} */ (dn[i]);
      const q = /** @type {number[]} */ (dn[Math.min(dn.length - 1, i + 1)]);
      const o = /** @type {number[]} */ (dn[Math.max(0, i - 1)]);
      const tx = (q[0] ?? 0) - (o[0] ?? 0);
      const tz = (q[1] ?? 0) - (o[1] ?? 0);
      const L = Math.hypot(tx, tz) || 1;
      const x = p[0] ?? 0;
      const z = p[1] ?? 0;
      const pr = idxRail.proche(x, z, dl + 30);
      const pf = pr.i >= 0 ? profils[Math.min(NS - 1, Math.round(pr.i / K))] : null;
      const c = pr.i >= 0 ? (chunkDeStation[Math.min(NS - 1, Math.round(pr.i / K))] ?? -1) : -1;
      if (!pf || pr.d < pf.e + 0.5 || c < 0) { // le ruban s’arrête au bord de l’accotement
        prev = [];
        continue;
      }
      const m = asm(c, 'voie');
      const nx = -tz / L;
      const nz = tx / L;
      const cur = [-w, w].map((u) => m.sommet(x + nx * u, sol(x + nx * u, z + nz * u) + 0.12, z + nz * u));
      if (prev.length && prevC === c) m.quad(/** @type {number} */ (prev[0]), /** @type {number} */ (prev[1]), /** @type {number} */ (cur[1]), /** @type {number} */ (cur[0]));
      prev = cur;
      prevC = c;
    }
  }

  // --- 9. Lacs : découpés en carreaux de 100 m, chaque carreau au tronçon le plus proche (2 km au plus).
  for (const l of lacs) {
    const C = 100;
    for (let gz = Math.floor(l.b[1] / C); gz <= Math.floor(l.b[3] / C); gz += 1)
      for (let gx = Math.floor(l.b[0] / C); gx <= Math.floor(l.b[2] / C); gx += 1) {
        /** @type {[number, number, number, number]} */
        const rect = [gx * C, gz * C, (gx + 1) * C, (gz + 1) * C];
        const c = chunkEn((gx + 0.5) * C, (gz + 0.5) * C, 2000);
        if (c < 0) continue;
        const morceaux = l.anneaux.map((/** @type {number[][]} */ an) => decouperRectangle(an, rect)).filter((/** @type {number[][]} */ an) => an.length >= 3 && Math.abs(aire(an)) > 0.5);
        if (morceaux.length === 0) continue;
        const ext = morceaux[0];
        if (!ext || l.anneaux[0] !== l.anneaux[0]) continue;
        const contour = ext.map((/** @type {number[]} */ p) => new Vector2(p[0], p[1]));
        const trous = morceaux.slice(1).map((/** @type {number[][]} */ an) => an.map((p) => new Vector2(p[0], p[1])));
        const tris = ShapeUtils.triangulateShape(contour, trous);
        const tous = [...contour, ...trous.flat()];
        const m = asm(c, 'eau');
        const base = tous.map((v) => m.sommet(v.x, l.y, v.y));
        for (const [i0, i1, i2] of tris) {
          const A = /** @type {Vector2} */ (tous[i0 ?? 0]);
          const B = /** @type {Vector2} */ (tous[i1 ?? 0]);
          const Cc = /** @type {Vector2} */ (tous[i2 ?? 0]);
          // Face vers le haut : sens horaire dans le plan X, Z vu d'en haut (Y vers le haut, Z vers le sud).
          const cross = (B.x - A.x) * (Cc.y - A.y) - (B.y - A.y) * (Cc.x - A.x);
          if (cross < 0) m.tri(/** @type {number} */ (base[i0 ?? 0]), /** @type {number} */ (base[i1 ?? 0]), /** @type {number} */ (base[i2 ?? 0]));
          else m.tri(/** @type {number} */ (base[i0 ?? 0]), /** @type {number} */ (base[i2 ?? 0]), /** @type {number} */ (base[i1 ?? 0]));
        }
      }
  }

  // --- 10. Bâtiments : emprise extrudée, toit plat, bandes de fenêtres par étage.
  let nbBatiments = 0;
  for (const bt of d.batiments) {
    /** @type {number[][]} */
    let an = [];
    for (let i = 0; i < bt.a.length; i += 2) an.push([bt.a[i], bt.a[i + 1]]);
    if (aire(an) < 0) an = an.reverse();
    const cx = an.reduce((s, p) => s + (p[0] ?? 0), 0) / an.length;
    const cz = an.reduce((s, p) => s + (p[1] ?? 0), 0) / an.length;
    const c = chunkEn(cx, cz, dl + 20);
    if (c < 0) continue;
    // Aucun bâtiment sur la chaussée ou ses accotements (données décalées, passages couverts).
    if (an.some((p) => {
      const pr = idxRail.proche(p[0] ?? 0, p[1] ?? 0, 12);
      return pr.i >= 0 && pr.d < (profils[Math.min(NS - 1, Math.round(pr.i / K))]?.e ?? 5) + 0.3;
    }))
      continue;
    // Sol du bâtiment : médiane des altitudes aux sommets (une pente forte ou un sommet hors du
    // couloir ne le hisse pas) ; les murs descendent jusqu'au point le plus bas, 8 m au plus.
    const hs = an.map((p) => sol(p[0] ?? 0, p[1] ?? 0)).sort((x, y) => x - y);
    const haut0 = hs[Math.floor(hs.length / 2)] ?? 0;
    const bas = Math.max(haut0 - 8, (hs[0] ?? 0) - 0.4);
    const h = Math.max(2.5, Math.min(40, bt.h ?? (bt.e ? bt.e * 3 : 6)));
    const sommet = haut0 + h;
    const mu = asm(c, 'mur');
    const fe = asm(c, 'fenetre');
    const vitre = !/annexe|agricole|industriel|silo|serre/i.test(`${bt.u} ${bt.n}`) && h >= 3.5;
    const etages = Math.max(1, Math.floor((h - 0.6) / 3));
    for (let i = 0; i < an.length; i += 1) {
      const p = /** @type {number[]} */ (an[i]);
      const q = /** @type {number[]} */ (an[(i + 1) % an.length]);
      const v = [mu.sommet(p[0] ?? 0, bas, p[1] ?? 0), mu.sommet(q[0] ?? 0, bas, q[1] ?? 0), mu.sommet(q[0] ?? 0, sommet, q[1] ?? 0), mu.sommet(p[0] ?? 0, sommet, p[1] ?? 0)];
      // Anneau dans le sens trigonométrique du plan (X, Z) : extérieur à gauche de p → q vu d'en haut.
      mu.quad(/** @type {number} */ (v[0]), /** @type {number} */ (v[3]), /** @type {number} */ (v[2]), /** @type {number} */ (v[1]));
      const L = Math.hypot((q[0] ?? 0) - (p[0] ?? 0), (q[1] ?? 0) - (p[1] ?? 0));
      if (!vitre || L < 3) continue;
      const ux = ((q[0] ?? 0) - (p[0] ?? 0)) / L;
      const uz = ((q[1] ?? 0) - (p[1] ?? 0)) / L;
      // Normale extérieure : (uz, −ux) pour un anneau trigonométrique dans le plan X, Z.
      const ox = uz * 0.04;
      const oz = -ux * 0.04;
      for (let f = 0; f < etages; f += 1) {
        const y0 = haut0 + f * 3 + 0.9;
        const y1 = y0 + 1.3;
        if (y1 > sommet - 0.3) break;
        const a0 = 0.7;
        const a1 = L - 0.7;
        const w = [
          fe.sommet((p[0] ?? 0) + ux * a0 + ox, y0, (p[1] ?? 0) + uz * a0 + oz),
          fe.sommet((p[0] ?? 0) + ux * a1 + ox, y0, (p[1] ?? 0) + uz * a1 + oz),
          fe.sommet((p[0] ?? 0) + ux * a1 + ox, y1, (p[1] ?? 0) + uz * a1 + oz),
          fe.sommet((p[0] ?? 0) + ux * a0 + ox, y1, (p[1] ?? 0) + uz * a0 + oz),
        ];
        fe.quad(/** @type {number} */ (w[0]), /** @type {number} */ (w[3]), /** @type {number} */ (w[2]), /** @type {number} */ (w[1]));
      }
    }
    const to = asm(c, 'toit');
    const contour = an.map((p) => new Vector2(p[0], p[1]));
    const base = an.map((p) => to.sommet(p[0] ?? 0, sommet, p[1] ?? 0));
    for (const [i0, i1, i2] of ShapeUtils.triangulateShape(contour, [])) {
      const A = /** @type {Vector2} */ (contour[i0 ?? 0]);
      const B = /** @type {Vector2} */ (contour[i1 ?? 0]);
      const Cc = /** @type {Vector2} */ (contour[i2 ?? 0]);
      const cross = (B.x - A.x) * (Cc.y - A.y) - (B.y - A.y) * (Cc.x - A.x);
      if (cross < 0) to.tri(/** @type {number} */ (base[i0 ?? 0]), /** @type {number} */ (base[i1 ?? 0]), /** @type {number} */ (base[i2 ?? 0]));
      else to.tri(/** @type {number} */ (base[i0 ?? 0]), /** @type {number} */ (base[i2 ?? 0]), /** @type {number} */ (base[i1 ?? 0]));
    }
    nbBatiments += 1;
  }

  // --- 11. Instances : arbres (densité plafonnée), lampadaires en agglomération, balises en virage serré.
  const R = rayons(rail, Math.round(10 / step));
  const PLAFOND_ARBRES = 900;
  for (let t = 0; t < d.arbres.length; t += 3) {
    const x = d.arbres[t];
    const z = d.arbres[t + 1];
    const genre = d.arbres[t + 2];
    if (hasard(Math.round(x * 10), Math.round(z * 10)) > 0.75) continue;
    const pr = idxRail.proche(x, z, dl);
    if (pr.i < 0) continue;
    const pf = /** @type {typeof profils[0]} */ (profils[Math.min(NS - 1, Math.round(pr.i / K))]);
    if (pr.d < pf.e + 5 || lacEn(x, z)) continue; // houppier hors de l’accotement
    const c = chunkDeStation[Math.min(NS - 1, Math.round(pr.i / K))] ?? 0;
    const lst = /** @type {{ arbre: number[] }} */ (instances[c]).arbre;
    if (lst.length / 5 >= PLAFOND_ARBRES) continue;
    const ech = (genre === 1 ? 1.2 : 1) * (0.75 + 0.5 * hasard(Math.round(z * 10), Math.round(x * 10)));
    lst.push(x, sol(x, z), z, ech, hasard(Math.round(x * 7), Math.round(z * 3)) * Math.PI * 2);
  }
  for (let i = 0; i < N; i += Math.round(15 / step)) {
    const pf = /** @type {typeof profils[0]} */ (profils[Math.min(NS - 1, Math.round(i / K))]);
    if (!pf.urban || pf.ground !== 'sol') continue;
    const cote = Math.round(i / Math.round(15 / step)) % 2 === 0 ? 1 : -1;
    const p = /** @type {number[]} */ (rail[i]);
    const t = /** @type {number[]} */ (T[i]);
    const u = cote * (pf.e - 0.4);
    const x = (p[0] ?? 0) + -(t[1] ?? 0) * u;
    const z = (p[2] ?? 0) + (t[0] ?? 0) * u;
    // Cap : la crosse regarde la chaussée.
    const cap = Math.atan2(-(t[1] ?? 0) * -cote, (t[0] ?? 0) * -cote);
    const c = chunkDeStation[Math.min(NS - 1, Math.round(i / K))] ?? 0;
    /** @type {{ lampadaire: number[] }} */ (instances[c]).lampadaire.push(x, pf.ye, z, 1, cap);
  }
  for (let i = 0; i < N; i += Math.round(8 / step)) {
    const r = R[i] ?? Infinity;
    const pf = /** @type {typeof profils[0]} */ (profils[Math.min(NS - 1, Math.round(i / K))]);
    if (r > 120 || pf.urban || pf.ground !== 'sol') continue;
    const a = /** @type {number[]} */ (T[Math.max(0, i - 3)]);
    const b = /** @type {number[]} */ (T[Math.min(N - 1, i + 3)]);
    // Virage à droite (cross > 0 dans X, Z) : extérieur à gauche.
    const cross = (a[0] ?? 0) * (b[1] ?? 0) - (a[1] ?? 0) * (b[0] ?? 0);
    const cote = cross > 0 ? -1 : 1;
    const p = /** @type {number[]} */ (rail[i]);
    const t = /** @type {number[]} */ (T[i]);
    const u = cote * (pf.e + 0.5);
    const x = (p[0] ?? 0) + -(t[1] ?? 0) * u;
    const z = (p[2] ?? 0) + (t[0] ?? 0) * u;
    const c = chunkDeStation[Math.min(NS - 1, Math.round(i / K))] ?? 0;
    /** @type {{ balise: number[] }} */ (instances[c]).balise.push(x, sol(x, z), z, 1, Math.atan2(-(t[0] ?? 0), -(t[1] ?? 0)));
  }

  // --- 12. Écriture des tronçons.
  /** @type {Map<string, Uint8Array>} */
  const fichiers = new Map();
  const chunks = bornes.map(([a, b], c) => {
    const i0 = stations[a] ?? 0;
    const i1 = stations[b] ?? 0;
    const o = /** @type {number[]} */ (rail[i0]);
    /** @type {[number, number, number]} */
    const origin = [arr(o[0] ?? 0), arr(o[1] ?? 0), arr(o[2] ?? 0)];
    const nom = `chunks/${String(c).padStart(3, '0')}.glb`;
    const g = ecrireGlb(`troncon_${String(c).padStart(3, '0')}`, /** @type {any} */ (parChunk[c]), origin);
    fichiers.set(nom, g.bytes);
    const inst = /** @type {{ arbre: number[], lampadaire: number[], balise: number[] }} */ (instances[c]);
    /** @type {Partial<Record<'arbre' | 'lampadaire' | 'balise', number[]>>} */
    const rel = {};
    for (const kind of /** @type {const} */ (['arbre', 'lampadaire', 'balise'])) {
      const l = inst[kind];
      if (l.length === 0) continue;
      const out = [];
      for (let t = 0; t < l.length; t += 5) {
        const x = l[t] ?? 0;
        const y = l[t + 1] ?? 0;
        const z = l[t + 2] ?? 0;
        g.min[0] = Math.min(g.min[0] ?? 0, x);
        g.min[1] = Math.min(g.min[1] ?? 0, y);
        g.min[2] = Math.min(g.min[2] ?? 0, z);
        g.max[0] = Math.max(g.max[0] ?? 0, x);
        g.max[1] = Math.max(g.max[1] ?? 0, y + 12);
        g.max[2] = Math.max(g.max[2] ?? 0, z);
        out.push(arr(x - origin[0]), arr(y - origin[1]), arr(z - origin[2]), arr(l[t + 3] ?? 1, 3), arr(l[t + 4] ?? 0, 3));
      }
      rel[kind] = out;
    }
    return {
      file: nom,
      from: arr(i0 * step),
      to: arr(i1 * step),
      origin,
      box: /** @type {[number, number, number, number, number, number]} */ ([...g.min, ...g.max].map((v) => arr(v))),
      triangles: g.triangles,
      instances: rel,
    };
  });

  // --- 13. Relief lointain : grille proche (trouée au droit du couloir) et grille large (sous la proche).
  const far = new Assembleur();
  const idxLarge = indexPolyligne(rail, { ix: 0, iz: 2, cellule: 200 });
  /**
   * @param {any} g @param {number} abaisse @param {(i: number, j: number) => boolean} garder
   * @param {boolean} trouer
   */
  const grilleFar = (g, abaisse, garder, trouer) => {
    const ids = new Int32Array(g.nx * g.nz);
    const pres = new Uint8Array(g.nx * g.nz);
    for (let j = 0; j < g.nz; j += 1)
      for (let i = 0; i < g.nx; i += 1) {
        const x = (g.i0 + i) * g.pas;
        const z = (g.j0 + j) * g.pas;
        let y = (g.dm[j * g.nx + i] ?? 0) / 10 - abaisse;
        const l = lacEn(x, z);
        if (l) y = Math.min(y, l.y - 4);
        const pr = trouer ? idxLarge.proche(x, z, dl + 60) : { d: Infinity };
        if (pr.d < dl + 60) y -= 4;
        if (pr.d < dl - 30) pres[j * g.nx + i] = 1;
        ids[j * g.nx + i] = far.sommet(x, y, z);
      }
    for (let j = 0; j < g.nz - 1; j += 1)
      for (let i = 0; i < g.nx - 1; i += 1) {
        if (!garder(i, j)) continue;
        const q = [j * g.nx + i, j * g.nx + i + 1, (j + 1) * g.nx + i + 1, (j + 1) * g.nx + i];
        if (trouer && q.every((v) => pres[v])) continue;
        // Vu d'en haut : i vers l'est (X), j vers le sud (Z).
        far.quad(/** @type {number} */ (ids[q[0] ?? 0]), /** @type {number} */ (ids[q[3] ?? 0]), /** @type {number} */ (ids[q[2] ?? 0]), /** @type {number} */ (ids[q[1] ?? 0]));
      }
  };
  const gp = d.lointain.proche;
  const gl2 = d.lointain.loin;
  grilleFar(gp, 0, () => true, true);
  grilleFar(gl2, 10, (i, j) => {
    const x0 = (gl2.i0 + i) * gl2.pas;
    const z0 = (gl2.j0 + j) * gl2.pas;
    const x1 = x0 + gl2.pas;
    const z1 = z0 + gl2.pas;
    return !(x0 >= gp.i0 * gp.pas && x1 <= (gp.i0 + gp.nx - 1) * gp.pas && z0 >= gp.j0 * gp.pas && z1 <= (gp.j0 + gp.nz - 1) * gp.pas);
  }, false);
  const farGlb = ecrireGlb('lointain', new Map([['terrain', far]]), [0, 0, 0]);
  fichiers.set('lointain.glb', farGlb.bytes);

  // --- 14. Départs proposés.
  const starts = carte.departs.map((/** @type {any} */ dp) => {
    let s = 0;
    if (dp.avantFin) s = length - dp.avantFin;
    else if (dp.pres) {
      const l = lacs.find((/** @type {any} */ x) => x.nom === dp.pres);
      if (!l) throw new Error(`départ « ${dp.id} » : plan d'eau « ${dp.pres} » absent des données`);
      // Point du parcours le plus proche de la rive, puis 150 m avant pour arriver le long de l'eau.
      const rive = [...l.anneaux[0], l.anneaux[0][0]];
      const idxRive = indexPolyligne(rive, { cellule: 100 });
      let best = Infinity;
      rail.forEach((p, i) => {
        const q = idxRive.proche(p[0] ?? 0, p[2] ?? 0, 500);
        if (q.d < best) [best, s] = [q.d, i * step];
      });
      s = Math.max(0, s - 150);
    }
    return { id: dp.id, label: dp.label, at: arr(Math.round(s / step) * step) };
  });

  const route = {
    format: /** @type {const} */ ('pmb-carte'),
    version: /** @type {const} */ (1),
    id,
    loop: false,
    length: arr(length),
    step,
    rail: rail.flat(),
    sections,
    chunks,
    starts,
    far: { file: 'lointain.glb', triangles: farGlb.triangles },
  };

  const P = pentes(rail, Math.round(10 / step));
  const mesures = {
    longueur: length,
    points: N,
    troncons: chunks.length,
    trianglesMax: Math.max(...chunks.map((c) => c.triangles)),
    trianglesMoyens: Math.round(chunks.reduce((s, c) => s + c.triangles, 0) / chunks.length),
    trianglesLointain: farGlb.triangles,
    penteMax: Math.max(...P.map(Math.abs)),
    rayonMin: Math.min(...R),
    dentsDeScie: dentsDeScie(rail),
    ecartBord,
    talusMax,
    ecartAxe,
    terrainSurRoute,
    batiments: nbBatiments,
    arbres: instances.reduce((s, x) => s + x.arbre.length / 5, 0),
    lampadaires: instances.reduce((s, x) => s + x.lampadaire.length / 5, 0),
    balises: instances.reduce((s, x) => s + x.balise.length / 5, 0),
    glissieres: glis.reduce((s, f) => s + f.filter(Boolean).length, 0) * step * K,
    ponts: sections.filter((s) => s.ground === 'pont').length,
  };
  return { route, fichiers, mesures };
}

/** Cartes à fabriquer : dossiers de assets-src/maps/ qui ont carte.json. */
export function listeCartes(srcDir = SRC) {
  return existsSync(srcDir) ? readdirSync(srcDir).filter((d) => existsSync(join(srcDir, d, 'carte.json'))).sort() : [];
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const ids = args.length > 0 ? args : listeCartes();
  if (ids.length === 0) {
    console.log('maps:build : aucune carte dans assets-src/maps/');
    return;
  }
  let failed = 0;
  for (const id of ids) {
    const started = Date.now();
    if (!existsSync(join(SRC, id, 'donnees.json'))) {
      console.log(`${id} : donnees.json absent, carte ignorée (npm run maps:fetch -- ${id})`);
      continue;
    }
    try {
      const { route, fichiers, mesures: m } = buildMap(id);
      const out = join(OUT, id);
      rmSync(join(out, 'chunks'), { recursive: true, force: true });
      let poids = 0;
      for (const [nom, bytes] of fichiers) {
        mkdirSync(dirname(join(out, nom)), { recursive: true });
        writeFileSync(join(out, nom), bytes);
        poids += bytes.byteLength;
      }
      const texte = `${JSON.stringify(route)}\n`;
      writeFileSync(join(out, 'route.json'), texte);
      poids += texte.length;
      console.log(
        `${id} : ${(m.longueur / 1000).toFixed(2)} km · ${m.troncons} tronçons (triangles : ${m.trianglesMax.toLocaleString('fr-FR')} au plus, ${m.trianglesMoyens.toLocaleString('fr-FR')} en moyenne ; lointain ${m.trianglesLointain.toLocaleString('fr-FR')}) · ` +
          `${(poids / 1e6).toFixed(2)} Mo · ${((Date.now() - started) / 1000).toFixed(1)} s`,
      );
      console.log(
        `  pente ${(m.penteMax * 100).toFixed(1)} % au plus · rayon ${m.rayonMin.toFixed(0)} m au moins · dents de scie ${(m.dentsDeScie * 100).toFixed(1)} cm · ` +
          `bord chaussée-terrain ${m.ecartBord.toFixed(2)} m · talus ${m.talusMax.toFixed(1)} m au plus · axe-terrain nu ${m.ecartAxe.toFixed(1)} m · terrain rabattu sous la route : ${m.terrainSurRoute} sommets`,
      );
      console.log(`  ${m.batiments} bâtiments · ${m.arbres} arbres · ${m.lampadaires} lampadaires · ${m.balises} balises · ${m.glissieres} m de glissières · ${m.ponts} ponts`);
      console.log(`  → ${relative(ROOT, out)}/`);
    } catch (error) {
      failed += 1;
      console.error(`${id} : ${error instanceof Error ? (error.stack ?? error.message) : error}`);
    }
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
