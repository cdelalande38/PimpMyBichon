// @ts-check
// Fabrication des cartes de sortie, hors ligne et déterministe : pour chaque dossier
// assets-src/maps/<id>/ qui a carte.json et donnees.json (écrit par « npm run maps:fetch -- <id> »),
// écrit public/assets/maps/<id>/route.json (type MapRoute de src/data/mapTypes.ts),
// chunks/NNN.glb (un maillage par rôle, fusion_<rôle>) et lointain.glb. Aucun identifiant de carte
// dans le code ; aucun accès au réseau. Quand donnees.json porte un enrichissement d'OpenStreetMap
// (clé « osm », tools/maps/enrichissement.mjs), il sert : vitesse limite par section, lampadaires à
// leur place, arbres isolés, alignements, parcs et palmiers, feux, passages piétons, glissières et
// murs, étages et toits en pente, commerces au bord du parcours (enseignes de la sortie de nuit).
//
//   node tools/maps/build.mjs [id…]      npm run maps:build [-- id…]

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ShapeUtils, Vector2 } from 'three';
import { plafonner, semer } from './arbres.mjs';
import { repartirEau } from './eau.mjs';
import { chausseeCouverte, gardeChaussee, resumerCouverture } from './couverture.mjs';
import { aire, boite, dansPolygone, hasard, indexPolyligne, simplifier } from './geom2d.mjs';
import { Assembleur, ecrireGlb } from './maillage.mjs';
import { Grille, jalonner, vitessesLeLong } from './enrichissement.mjs';
import { decouper, dentsDeScie, densifier, lisserSerie, pentes, rayons, reechantillonnerCorde, sections as faireSections } from './trace.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'assets-src', 'maps');
const OUT = join(ROOT, 'public', 'assets', 'maps');

/** Décalages du terrain au-delà du bord d'accotement, en mètres (le dernier est ramené à la demi-largeur du couloir). */
const DECALAGES = [0, 1.5, 3.5, 6, 9, 13, 18, 24, 32, 42, 54, 68, 85, 105, 127];
/** Pente des talus (déblai et remblai) : 2 de haut pour 3 de long. */
const TALUS = 2 / 3;
/** Retrait des bâtiments rognés au-delà du bord du trottoir, en mètres. */
const RETRAIT_BATI = 0.5;
/** Tunnels : hauteur des piédroits, de la voûte, et du dessus (terrain recouvrant), au-dessus de l'axe. */
const TUNNEL = { piedroit: 5.2, voute: 6, dessus: 7.2 };

/** @param {number} v @param {number} [n] */
const arr = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;
/** Contour convexe (tous les tournants du même sens). @param {number[][]} an */
const convexe = (an) => {
  let signe = 0;
  for (let i = 0; i < an.length; i += 1) {
    const a = /** @type {number[]} */ (an[i]);
    const b = /** @type {number[]} */ (an[(i + 1) % an.length]);
    const c = /** @type {number[]} */ (an[(i + 2) % an.length]);
    const k = Math.sign(((b[0] ?? 0) - (a[0] ?? 0)) * ((c[1] ?? 0) - (b[1] ?? 0)) - ((b[1] ?? 0) - (a[1] ?? 0)) * ((c[0] ?? 0) - (b[0] ?? 0)));
    if (k && signe && k !== signe) return false;
    if (k) signe = k;
  }
  return true;
};
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
 * @param {{ srcDir?: string, sansGarde?: boolean }} [o] sansGarde : terrain et routes voisines sans la garde de la chaussée (essais)
 */
export function buildMap(id, o = {}) {
  const dir = join(o.srcDir ?? SRC, id);
  const carte = JSON.parse(readFileSync(join(dir, 'carte.json'), 'utf8'));
  const d = JSON.parse(readFileSync(join(dir, 'donnees.json'), 'utf8'));
  if (d.format !== 'pmb-carte-donnees' || d.id !== id) throw new Error(`${id} : donnees.json inattendu`);
  const fab = carte.fabrication;
  const dl = carte.couloir.demiLargeur;
  /** Un profil en travers tous les K points du rail. */
  const K = fab.pasProfil ?? 2;
  // Boucle : le dernier point de l'axe répète le premier ; lissage périodique, pas ajusté pour que
  // le rail se referme exactement (le dernier point du rail est le premier).
  const boucle = Boolean(d.axe.boucle);

  // --- 1. Rail : densifié au mètre, lissé (plan et altitude), rééchantillonné à pas constant.
  const brut = [];
  for (let i = 0; i < d.axe.points.length; i += 3) brut.push([d.axe.points[i], d.axe.points[i + 2], d.axe.points[i + 1]]);
  const dense = densifier(brut, d.axe.rang, 1);
  const xs = lisserSerie(dense.points.map((p) => p[0] ?? 0), fab.lissagePlan, boucle);
  const zs = lisserSerie(dense.points.map((p) => p[1] ?? 0), fab.lissagePlan, boucle);
  const ys = lisserSerie(dense.points.map((p) => p[2] ?? 0), fab.lissageAltitude, boucle);
  const lisse = xs.map((x, i) => [x, ys[i] ?? 0, zs[i] ?? 0]);
  // Corde constante : chaque point du rail à `step` mètres du précédent, épingles comprises ; en
  // boucle, pas ajusté pour retomber sur le départ.
  const rs = reechantillonnerCorde(lisse, fab.pasRail, { boucle });
  const step = rs.pas;
  const rail = rs.points.map((p) => [arr(p[0] ?? 0), arr(p[1] ?? 0), arr(p[2] ?? 0)]);
  if (boucle) rail[rail.length - 1] = [...(/** @type {number[]} */ (rail[0]))];
  const N = rail.length;
  const length = (N - 1) * step;
  const rangDe = (/** @type {number} */ i) => dense.etiquettes[Math.min(dense.etiquettes.length - 1, Math.round(rs.source[i] ?? 0))] ?? 0;

  // --- 2. Sections (sol, pont, tunnel ; agglomération ; voies ; largeur ; vitesse limite).
  /** Enrichissement d'OpenStreetMap, s'il y en a un. @type {any} */
  const osm = d.osm ?? null;
  // Vitesse limite (km/h) : celle du tronçon (OpenStreetMap seul), sinon celle de la route d'OSM qui
  // longe le rail ; 0 si inconnue.
  const vOsm = osm ? vitessesLeLong(rail, osm.routes) : [];
  const valeurs = rail.map((_, i) => {
    const t = d.axe.troncons[rangDe(i)] ?? {};
    const lanes = t.voies && t.voies > 0 ? t.voies : 2;
    const width = t.largeur && t.largeur > 0 ? t.largeur : lanes * 3;
    const speed = t.vitesse > 0 ? t.vitesse : (vOsm[i] ?? 0);
    return { ground: /** @type {'sol' | 'pont' | 'tunnel'} */ (t.sol ?? 'sol'), urban: Boolean(t.urbain), lanes, width, speed };
  });
  const sections = faireSections(valeurs, step, 30).map((s) => ({ from: arr(s.from), to: arr(s.to), ground: s.ground, urban: s.urban, lanes: s.lanes, width: s.width, ...(s.speed ? { speed: s.speed } : {}) }));
  // La dernière section finit pile au bout du parcours (pas non entier en boucle).
  const derniere = sections[sections.length - 1];
  if (derniere) derniere.to = boucle ? length : arr(length);
  const sectionDe = (/** @type {number} */ i) => {
    const s = i * step;
    return sections.find((x) => s >= x.from && s <= x.to) ?? /** @type {typeof sections[0]} */ (sections[sections.length - 1]);
  };
  const sec = rail.map((_, i) => sectionDe(i));
  // Largeur adoucie sur une vingtaine de mètres aux changements de section.
  const largeur = lisserSerie(sec.map((s) => s.width), 8 / step);

  // --- 3. Repères locaux : tangente plane et normale à droite (X est, Z sud : droite = (−tz, tx)).
  const per = N - 1;
  const T = rail.map((_, i) => {
    const a = /** @type {number[]} */ (rail[boucle ? (((i - 2) % per) + per) % per : Math.max(0, i - 2)]);
    const b = /** @type {number[]} */ (rail[boucle ? (i + 2) % per : Math.min(N - 1, i + 2)]);
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
    return { nom: l.nom, nature: l.nature, y: l.y, anneaux, b: boite(anneaux) };
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
  // Emprise protégée : chaussée et trottoirs de toutes les passes du parcours, hors tunnel, en
  // triangles (chaussée bombée ; dessus du trottoir relevé de 5 cm). Aucun
  // triangle de terrain ni de route voisine ne passe au-dessus (garde.couvre) : là où le parcours se
  // frôle, s'enroule en lacets ou se croise, le terrain d'une passe s'arrête au bord de la chaussée
  // de l'autre au lieu de la recouvrir.
  /** @type {number[]} */
  const protege = [];
  /** Coupe en travers protégée au point i : [u, hauteur] de gauche à droite. @param {number} i */
  const coupeProtegee = (i) => {
    const se = sec[i] ?? /** @type {typeof sections[0]} */ (sections[0]);
    const y = rail[i]?.[1] ?? 0;
    const hw = Math.max((largeur[i] ?? 6) / 2, se.width / 2 - 0.3);
    const e = hw + (se.urban ? 2.2 : 1.0);
    const yt = y + (se.urban ? 0.14 : -0.05) + 0.05;
    return [
      [-e, yt],
      [-hw, yt],
      [-hw, y],
      [0, y + 0.06],
      [hw, y],
      [hw, yt],
      [e, yt],
    ];
  };
  for (let i = 0; i < N - 1; i += 1) {
    if ((sec[i]?.ground ?? 'sol') === 'tunnel' || (sec[i + 1]?.ground ?? 'sol') === 'tunnel') continue;
    const [A, B] = [i, i + 1].map((k) => {
      const p = /** @type {number[]} */ (rail[k]);
      const t = /** @type {number[]} */ (T[k]);
      return coupeProtegee(k).map(([u = 0, h = 0]) => [(p[0] ?? 0) - (t[1] ?? 0) * u, h, (p[2] ?? 0) + (t[0] ?? 0) * u]);
    });
    for (let k = 0; k < 6; k += 1) {
      const a0 = /** @type {number[]} */ (A?.[k]);
      const a1 = /** @type {number[]} */ (A?.[k + 1]);
      const b0 = /** @type {number[]} */ (B?.[k]);
      const b1 = /** @type {number[]} */ (B?.[k + 1]);
      // Les deux bandes verticales (bordure) n'ont pas d'aire : la garde les ignore.
      protege.push(...a0, ...b0, ...b1, ...a0, ...b1, ...a1);
    }
  }
  const garde = gardeChaussee(o.sansGarde ? [] : protege);
  /** Abscisses (à 50 m près) des triangles de terrain refusés par la garde : diagnostic. @type {Set<number>} */
  const zonesRefusees = new Set();
  let terrainRefuse = 0;

  // Terrain : positions (pliages repoussés le long de la tangente) puis altitudes avec talus. Un
  // sommet qui tombe plus près d'une autre portion du parcours que de la sienne (rues parallèles,
  // épingles, boucle autour d'un pâté de maisons) s'arrête sur le précédent : les nappes de terrain
  // de deux rues voisines ne se chevauchent plus.
  const idxRail = indexPolyligne(rail, { ix: 0, iz: 2, cellule: 40 });
  /** Écart en mètres le long du parcours entre deux points du rail (en boucle : par le plus court). @param {number} i @param {number} j */
  const ecartLe = (i, j) => {
    const d = Math.abs(i - j);
    return (boucle ? Math.min(d, per - d) : d) * step;
  };
  let replies = 0;
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
        if (k > 0) {
          const off = pr.e + dk;
          const pp = idxRail.proche(x, z, off);
          if (pp.i >= 0 && pp.d < off - 0.5 && ecartLe(pp.i, pr.i) > 2 * off + 10) {
            const q0 = at(s, c, k - 1);
            const q = at(s, c, k);
            terX[q] = terX[q0] ?? 0;
            terZ[q] = terZ[q0] ?? 0;
            terY[q] = terY[q0] ?? 0;
            replies += 1;
            continue;
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
        } else if (pr.ground === 'tunnel') y = Math.max(hn, pr.y + TUNNEL.dessus - dk * 0.5);
        else y = Math.min(hn, pr.y - 2.5 + dk * 0.3);
        terY[q] = y;
      }
    }
  }
  for (const pr of profils) if (pr.ground === 'sol') ecartAxe = Math.max(ecartAxe, Math.abs(terrainNu(pr.p[0] ?? 0, pr.p[2] ?? 0) - pr.y));
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
    if (pf.ground === 'tunnel') return Math.max(H(x, z), pf.y + TUNNEL.dessus);
    if (pr.d <= pf.e) return pf.ye;
    const dk = pr.d - pf.e;
    if (pf.ground !== 'sol') return H(x, z);
    return pf.ye + Math.max(-dk * TALUS, Math.min(dk * TALUS, H(x, z) - pf.ye));
  };

  // --- 5. Glissières : le long de l'eau ou d'un vide, hors agglomération et hors pont ; partout au sol
  //     si la carte le demande (« glissieres »: « partout » : un circuit en ville, routes fermées).
  const partout = fab.glissieres === 'partout';
  // Glissières d'OpenStreetMap (barrier=guard_rail) : là où l'une longe le bord de la chaussée.
  /** @type {Grille<number>} */
  const gGlis = new Grille(8);
  if (osm) for (const b of osm.barrieres) if (b.t === 0) for (const q of jalonner(b.p, 2)) gGlis.ajouter(q.x, q.z, 0);
  let glisOsm = 0;
  const glis = [0, 1].map((c) => {
    const f = profils.map((pr, s) => {
      if (partout) return pr.ground === 'sol';
      if (osm && pr.ground === 'sol') {
        const cote = c === 0 ? -1 : 1;
        const n = /** @type {number[]} */ (pr.n);
        if (gGlis.proches((pr.p[0] ?? 0) + (n[0] ?? 0) * cote * (pr.e + 0.3), (pr.p[2] ?? 0) + (n[1] ?? 0) * cote * (pr.e + 0.3), 3).length) {
          glisOsm += 1;
          return true;
        }
      }
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
  /** @type {Array<{ arbre: number[], lampadaire: number[], balise: number[], feu: number[], palmier: number[] }>} */
  const instances = bornes.map(() => ({ arbre: [], lampadaire: [], balise: [], feu: [], palmier: [] }));
  /** Commerces d'OSM par tronçon : abscisse, x, y, z (repère de la carte), genre. @type {number[][]} */
  const commercesParTroncon = bornes.map(() => []);

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
      /** Triangle de terrain, sauf s'il passe au-dessus de la chaussée ou d'un trottoir. @param {number} i0 @param {number} i1 @param {number} i2 */
      const terre = (i0, i1, i2) => {
        const v = [i0, i1, i2].map((k) => [te.pos[k * 3] ?? 0, te.pos[k * 3 + 1] ?? 0, te.pos[k * 3 + 2] ?? 0]);
        if (garde.couvre(/** @type {number[]} */ (v[0]), /** @type {number[]} */ (v[1]), /** @type {number[]} */ (v[2]), 0.1)) {
          terrainRefuse += 1;
          zonesRefusees.add(Math.round((pr.i * step) / 50) * 50);
        } else te.tri(i0, i1, i2);
      };
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
          for (const [q0, q1, q2, q3] of [
            [tl0[k + 1], tl0[k], tl1[k], tl1[k + 1]],
            [tr0[k], tr0[k + 1], tr1[k + 1], tr1[k]],
          ].map((q) => q.map((v) => /** @type {number} */ (v)))) {
            terre(/** @type {number} */ (q0), /** @type {number} */ (q1), /** @type {number} */ (q2));
            terre(/** @type {number} */ (q0), /** @type {number} */ (q2), /** @type {number} */ (q3));
          }
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
    // Tunnels : piédroits, voûte, réglettes de lumière au plafond (rôle « fenetre », éclairé la nuit),
    // dessus recouvert de terrain et fronton aux têtes. Faces doubles : vues du dedans et du dehors.
    const fe = asm(c, 'fenetre');
    for (let s = a; s < b; s += 1) {
      const p0 = /** @type {typeof profils[0]} */ (profils[s]);
      const p1 = /** @type {typeof profils[0]} */ (profils[s + 1]);
      if (p0.ground !== 'tunnel' || p1.ground !== 'tunnel') continue;
      const coupe = (/** @type {typeof profils[0]} */ pr) => {
        const P = (/** @type {number} */ u, /** @type {number} */ y) => /** @type {[number, number, number]} */ ([(pr.p[0] ?? 0) + (pr.n[0] ?? 0) * u, y, (pr.p[2] ?? 0) + (pr.n[1] ?? 0) * u]);
        const e = pr.e + 0.3;
        return [P(-e, pr.ye - 0.2), P(-e, pr.y + TUNNEL.piedroit), P(-e + 1.4, pr.y + TUNNEL.voute), P(e - 1.4, pr.y + TUNNEL.voute), P(e, pr.y + TUNNEL.piedroit), P(e, pr.ye - 0.2)];
      };
      const A = coupe(p0).map((v) => ou.sommet(...v));
      const B = coupe(p1).map((v) => ou.sommet(...v));
      for (let k = 0; k < 5; k += 1) {
        const q = /** @type {[number, number, number, number]} */ ([A[k], B[k], B[k + 1], A[k + 1]]);
        ou.quad(q[0], q[1], q[2], q[3]);
        ou.quad(q[0], q[3], q[2], q[1]);
      }
      // Dessus : terrain plat d'un bord à l'autre, au niveau du recouvrement.
      const dessus = (/** @type {typeof profils[0]} */ pr) =>
        [-1, 1].map((cote) => te.sommet((pr.p[0] ?? 0) + (pr.n[0] ?? 0) * cote * (pr.e + 0.5), pr.y + TUNNEL.dessus, (pr.p[2] ?? 0) + (pr.n[1] ?? 0) * cote * (pr.e + 0.5)));
      const [g0, d0] = dessus(p0);
      const [g1, d1] = dessus(p1);
      te.quad(/** @type {number} */ (g0), /** @type {number} */ (g1), /** @type {number} */ (d1), /** @type {number} */ (d0));
      te.quad(/** @type {number} */ (g0), /** @type {number} */ (d0), /** @type {number} */ (d1), /** @type {number} */ (g1));
      // Réglette : 0,3 m de large sous la voûte, une station sur deux.
      if (s % 2 === 0) {
        const L = [p0, p1].flatMap((pr) =>
          [-0.15, 0.15].map((u) => fe.sommet((pr.p[0] ?? 0) + (pr.n[0] ?? 0) * u, pr.y + TUNNEL.voute - 0.05, (pr.p[2] ?? 0) + (pr.n[1] ?? 0) * u)),
        );
        fe.quad(/** @type {number} */ (L[0]), /** @type {number} */ (L[2]), /** @type {number} */ (L[3]), /** @type {number} */ (L[1]));
        fe.quad(/** @type {number} */ (L[0]), /** @type {number} */ (L[1]), /** @type {number} */ (L[3]), /** @type {number} */ (L[2]));
      }
      // Frontons : aux têtes du tunnel, de la voûte au dessus.
      for (const [pr, voisin] of /** @type {Array<[typeof profils[0], typeof profils[0] | undefined]>} */ ([
        [p0, profils[s - 1]],
        [p1, profils[s + 2]],
      ])) {
        if (voisin && voisin.ground === 'tunnel') continue;
        const P = (/** @type {number} */ u, /** @type {number} */ y) => ou.sommet((pr.p[0] ?? 0) + (pr.n[0] ?? 0) * u, y, (pr.p[2] ?? 0) + (pr.n[1] ?? 0) * u);
        const e = pr.e + 0.5;
        const f = [P(-e, pr.y + TUNNEL.piedroit), P(e, pr.y + TUNNEL.piedroit), P(e, pr.y + TUNNEL.dessus), P(-e, pr.y + TUNNEL.dessus)];
        ou.quad(/** @type {number} */ (f[0]), /** @type {number} */ (f[1]), /** @type {number} */ (f[2]), /** @type {number} */ (f[3]));
        ou.quad(/** @type {number} */ (f[0]), /** @type {number} */ (f[3]), /** @type {number} */ (f[2]), /** @type {number} */ (f[1]));
      }
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

  // Passages piétons d'OpenStreetMap peints sur le parcours : bandes de 0,5 m tous les mètres en
  // travers de la chaussée, 3 m de long (matière « marquage »).
  let nbPassages = 0;
  if (osm) {
    /** @type {number[]} */
    const faits = [];
    for (let k = 0; k < osm.passages.length; k += 3) {
      const pr = idxRail.proche(osm.passages[k] ?? 0, osm.passages[k + 1] ?? 0, 12);
      if (pr.i < 0) continue;
      const i = Math.min(N - 1, Math.round(pr.i + pr.t));
      const hw = (largeur[i] ?? 6) / 2;
      if (pr.d > hw + 1.5 || (sec[i]?.ground ?? 'sol') === 'tunnel' || faits.some((j) => ecartLe(i, j) < 10)) continue;
      faits.push(i);
      const p = /** @type {number[]} */ (rail[i]);
      const t = /** @type {number[]} */ (T[i]);
      const m = asm(chunkDeStation[Math.min(NS - 1, Math.floor(i / K))] ?? 0, 'marquage');
      for (let u = -hw + 0.55; u + 0.5 <= hw - 0.3; u += 1) {
        const v = [
          [u, -1.5],
          [u + 0.5, -1.5],
          [u + 0.5, 1.5],
          [u, 1.5],
        ].map(([uu = 0, tt = 0]) => m.sommet((p[0] ?? 0) - (t[1] ?? 0) * uu + (t[0] ?? 0) * tt, (p[1] ?? 0) + 0.06 * (1 - Math.min(1, Math.abs(uu) / hw)) + 0.02, (p[2] ?? 0) + (t[0] ?? 0) * uu + (t[1] ?? 0) * tt));
        m.quad(/** @type {number} */ (v[0]), /** @type {number} */ (v[1]), /** @type {number} */ (v[2]), /** @type {number} */ (v[3]));
      }
      nbPassages += 1;
    }
  }
  // Murs et murets d'OpenStreetMap à moins de 30 m du parcours, hors de son emprise : 0,3 m d'épaisseur,
  // 1,2 m de haut faute de hauteur connue (matière « mur »).
  let longueurMurs = 0;
  if (osm)
    for (const b of osm.barrieres) {
      if (b.t !== 1) continue;
      const h = b.h > 0 ? Math.min(4, b.h) : 1.2;
      /** @typedef {{ x: number, z: number, y: number, c: number }} PointMur */
      /** @type {PointMur | null} */
      let prev = null;
      for (const q of jalonner(b.p, 3)) {
        const pr = idxRail.proche(q.x, q.z, 30);
        const pf = pr.i >= 0 ? profils[Math.min(NS - 1, Math.round(pr.i / K))] : null;
        if (!pf || pr.d < pf.e + 0.4 || pf.ground === 'tunnel') {
          prev = null;
          continue;
        }
        const c = chunkDeStation[Math.min(NS - 1, Math.round(pr.i / K))] ?? 0;
        const y = sol(q.x, q.z);
        if (prev && prev.c === c) {
          const mu = asm(c, 'mur');
          const L = Math.hypot(q.x - prev.x, q.z - prev.z) || 1;
          // o : normale (uz, −ux) de la marche, côté « extérieur » des anneaux de bâtiments.
          const ox = ((q.z - prev.z) / L) * 0.15;
          const oz = (-(q.x - prev.x) / L) * 0.15;
          const S = (/** @type {{ x: number, z: number }} */ a, /** @type {number} */ k, /** @type {number} */ yy) => mu.sommet(a.x + ox * k, yy, a.z + oz * k);
          const [pb, pt, qt, qb] = [S(prev, 1, prev.y - 0.3), S(prev, 1, prev.y + h), S(q, 1, y + h), S(q, 1, y - 0.3)];
          mu.quad(pb, pt, qt, qb);
          const [pb2, pt2, qt2, qb2] = [S(prev, -1, prev.y - 0.3), S(prev, -1, prev.y + h), S(q, -1, y + h), S(q, -1, y - 0.3)];
          mu.quad(pb2, qb2, qt2, pt2);
          mu.quad(pt, pt2, qt2, qt);
          longueurMurs += L;
        }
        prev = /** @type {any} */ ({ x: q.x, z: q.z, y, c });
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
      if (prev.length && prevC === c) {
        // Garde : le ruban d'une route voisine ne passe pas au-dessus de la chaussée qu'il rejoint.
        const q = [prev[0], prev[1], cur[1], cur[0]].map((k) => [m.pos[(k ?? 0) * 3] ?? 0, m.pos[(k ?? 0) * 3 + 1] ?? 0, m.pos[(k ?? 0) * 3 + 2] ?? 0]);
        const [q0, q1, q2, q3] = /** @type {number[][]} */ (q);
        if (!garde.couvre(/** @type {number[]} */ (q0), /** @type {number[]} */ (q1), /** @type {number[]} */ (q2), 0.1) && !garde.couvre(/** @type {number[]} */ (q0), /** @type {number[]} */ (q2), /** @type {number[]} */ (q3), 0.1))
          m.quad(/** @type {number} */ (prev[0]), /** @type {number} */ (prev[1]), /** @type {number} */ (cur[1]), /** @type {number} */ (cur[0]));
      }
      prev = cur;
      prevC = c;
    }
  }

  // --- 9. Lacs et mer : carreaux de 100 m, chacun dans tous les tronçons dont le rail passe à moins
  //     de `porteeEau` mètres (tools/maps/eau.mjs) : l'eau visible depuis un tronçon y est entière.
  const railsTroncons = bornes.map(([a, b]) => {
    const i0 = stations[a] ?? 0;
    const i1 = stations[b] ?? 0;
    /** @type {number[][]} */
    const pts = [];
    for (let i = i0; i <= i1; i += 5) pts.push([rail[i]?.[0] ?? 0, rail[i]?.[2] ?? 0]);
    pts.push([rail[i1]?.[0] ?? 0, rail[i1]?.[2] ?? 0]);
    return pts;
  });
  repartirEau(lacs, railsTroncons, { portee: fab.porteeEau ?? 1200 }).forEach((liste, c) => {
    if (liste.length === 0) return;
    const m = asm(c, 'eau');
    for (const { y, tris } of liste) {
      /** @type {Map<string, number>} */
      const vus = new Map();
      const v = (/** @type {number} */ x, /** @type {number} */ z) => {
        const k = `${x}|${z}`;
        let id = vus.get(k);
        if (id === undefined) {
          id = m.sommet(x, y, z);
          vus.set(k, id);
        }
        return id;
      };
      for (const t of tris) m.tri(v(t[0] ?? 0, t[1] ?? 0), v(t[2] ?? 0, t[3] ?? 0), v(t[4] ?? 0, t[5] ?? 0));
    }
  });

  // --- 10. Bâtiments : emprise extrudée, toit plat, bandes de fenêtres par étage.
  let nbBatiments = 0;
  let batimentsRognes = 0;
  let batimentsEcartes = 0;
  /** Abscisses (à 10 m près) des bâtiments rognés : diagnostic. @type {Set<number>} */
  const zonesRognees = new Set();
  const eMaxBati = Math.max(...profils.map((p) => p.e)) + RETRAIT_BATI;
  /**
   * Contour d'un bâtiment hors de l'emprise du parcours (toutes les passes, hors tunnel) : null s'il
   * faut l'écarter ; `tunnel` : profil de tunnel sous le bâtiment (il reste entier, posé dessus).
   * @param {number[][]} an anneau trigonométrique
   * @returns {{ an: number[][], tunnel: typeof profils[0] | null } | null}
   */
  const rognerBati = (an) => {
    /** @type {{ v: typeof profils[0] | null }} */
    const sous = { v: null };
    /** Emprise la plus enfoncée en (x, z) : [profondeur, qx, qz, e] ou null. @param {number} x @param {number} z */
    const dedans = (x, z) => {
      /** @type {{ v: number[] | null }} */
      const pire = { v: null };
      idxRail.autour(x, z, eMaxBati, (i, d, qx, qz) => {
        const pf = /** @type {typeof profils[0]} */ (profils[Math.min(NS - 1, Math.round(i / K))]);
        const lim = pf.e + RETRAIT_BATI;
        if (d >= lim) return;
        if (pf.ground === 'tunnel') {
          sous.v = pf;
          return;
        }
        if (!pire.v || lim - d > (pire.v[0] ?? 0)) pire.v = [lim - d, qx, qz, lim];
      });
      return pire.v;
    };
    // La route traverse-t-elle le bâtiment (un point du rail hors tunnel dans son contour) ?
    const ba = boite([an]);
    const prc = idxRail.proche((ba[0] + ba[2]) / 2, (ba[1] + ba[3]) / 2, Math.hypot(ba[2] - ba[0], ba[3] - ba[1]) / 2 + 2);
    if (prc.i >= 0) {
      for (let i = Math.max(0, prc.i - 60); i < Math.min(N, prc.i + 60); i += 1) {
        const r = /** @type {number[]} */ (rail[i]);
        if (!dansPolygone(r[0] ?? 0, r[2] ?? 0, [an])) continue;
        if ((sec[i]?.ground ?? 'sol') !== 'tunnel') return null;
        sous.v = profils[Math.min(NS - 1, Math.round(i / K))] ?? null;
      }
    }
    if (!an.some((p) => dedans(p[0] ?? 0, p[1] ?? 0))) {
      // Sommets dehors : reste à voir si un côté entame l'emprise.
      let entame = false;
      for (let i = 0; i < an.length && !entame; i += 1) {
        const p = /** @type {number[]} */ (an[i]);
        const q = /** @type {number[]} */ (an[(i + 1) % an.length]);
        const L = Math.hypot((q[0] ?? 0) - (p[0] ?? 0), (q[1] ?? 0) - (p[1] ?? 0));
        for (let k = 1; k < Math.ceil(L); k += 1) if (dedans(mix(p[0] ?? 0, q[0] ?? 0, k / Math.ceil(L)), mix(p[1] ?? 0, q[1] ?? 0, k / Math.ceil(L)))) entame = true;
      }
      if (!entame) return { an, tunnel: sous.v };
    }
    // Contour redécoupé au mètre, chaque point dans l'emprise repoussé radialement jusqu'à son bord.
    /** @type {number[][]} */
    const dense = [];
    for (let i = 0; i < an.length; i += 1) {
      const p = /** @type {number[]} */ (an[i]);
      const q = /** @type {number[]} */ (an[(i + 1) % an.length]);
      const n = Math.max(1, Math.ceil(Math.hypot((q[0] ?? 0) - (p[0] ?? 0), (q[1] ?? 0) - (p[1] ?? 0))));
      for (let k = 0; k < n; k += 1) dense.push([mix(p[0] ?? 0, q[0] ?? 0, k / n), mix(p[1] ?? 0, q[1] ?? 0, k / n)]);
    }
    const cx = an.reduce((s, p) => s + (p[0] ?? 0), 0) / an.length;
    const cz = an.reduce((s, p) => s + (p[1] ?? 0), 0) / an.length;
    for (const p of dense) {
      for (let iter = 0; iter < 4; iter += 1) {
        const w = dedans(p[0] ?? 0, p[1] ?? 0);
        if (!w) break;
        const [, qx = 0, qz = 0, lim = 0] = w;
        let dx = (p[0] ?? 0) - qx;
        let dz = (p[1] ?? 0) - qz;
        let L = Math.hypot(dx, dz);
        if (L < 1e-3) {
          dx = cx - qx;
          dz = cz - qz;
          L = Math.hypot(dx, dz) || 1;
        }
        p[0] = qx + (dx / L) * (lim + 0.01);
        p[1] = qz + (dz / L) * (lim + 0.01);
      }
      if (dedans(p[0] ?? 0, p[1] ?? 0)) return null; // coincé entre deux passes
    }
    let out = simplifier([...dense, /** @type {number[]} */ (dense[0])], 0.15).slice(0, -1);
    // Points confondus (deux côtés repoussés sur le même bord) : retirés.
    out = out.filter((p, i) => {
      const q = /** @type {number[]} */ (out[(i + 1) % out.length]);
      return Math.hypot((q[0] ?? 0) - (p[0] ?? 0), (q[1] ?? 0) - (p[1] ?? 0)) > 0.05;
    });
    if (out.length < 3 || aire(out) < 8) return null;
    return { an: out, tunnel: sous.v };
  };
  /** Attributs d'OSM par bâtiment : étages, forme de toit. @type {Map<number, { e: number, toit: number }>} */
  const attrOsm = new Map();
  if (osm) for (let k = 0; k < osm.batiments.length; k += 4) attrOsm.set(osm.batiments[k], { e: osm.batiments[k + 1], toit: osm.batiments[k + 2] });
  let etagesOsm = 0;
  let toitsEnPente = 0;
  for (const [ib, bt] of /** @type {Array<[number, any]>} */ ([...d.batiments.entries()])) {
    const ao = attrOsm.get(ib);
    /** @type {number[][]} */
    let an = [];
    for (let i = 0; i < bt.a.length; i += 2) an.push([bt.a[i], bt.a[i + 1]]);
    if (aire(an) < 0) an = an.reverse();
    const cx = an.reduce((s, p) => s + (p[0] ?? 0), 0) / an.length;
    const cz = an.reduce((s, p) => s + (p[1] ?? 0), 0) / an.length;
    const c = chunkEn(cx, cz, dl + 20);
    if (c < 0) continue;
    // Aucun bâtiment sur la chaussée ou ses accotements (données décalées, passages couverts) : le
    // contour, redécoupé au mètre, est repoussé hors de l'emprise de toutes les passes du parcours
    // (trottoir + RETRAIT_BATI), puis simplifié ; le bâtiment reste, rogné, en retrait du trottoir.
    // Au-dessus d'un tunnel, le bâtiment reste entier, posé sur le recouvrement. Écarté seulement si
    // la route le traverse ou s'il ne reste presque rien.
    const rogne = rognerBati(an);
    if (rogne === null) {
      batimentsEcartes += 1;
      continue;
    }
    if (rogne.an !== an) {
      batimentsRognes += 1;
      const pr = idxRail.proche(cx, cz, dl + 20);
      if (pr.i >= 0) zonesRognees.add(Math.round((pr.i * step) / 10) * 10);
    }
    an = rogne.an;
    const conflit = rogne.tunnel;
    // Sol du bâtiment : médiane des altitudes aux sommets (une pente forte ou un sommet hors du
    // couloir ne le hisse pas) ; les murs descendent jusqu'au point le plus bas, 8 m au plus.
    const hs = an.map((p) => sol(p[0] ?? 0, p[1] ?? 0)).sort((x, y) => x - y);
    const haut0 = hs[Math.floor(hs.length / 2)] ?? 0;
    const bas = Math.max(haut0 - 8, (hs[0] ?? 0) - 0.4, conflit ? conflit.y + TUNNEL.dessus : -Infinity);
    // Hauteur : celle de la donnée, sinon ses étages, sinon les étages d'OSM (building:levels).
    const etOsm = !bt.h && !bt.e && ao && ao.e > 0 ? ao.e : 0;
    if (etOsm) etagesOsm += 1;
    const h = Math.max(2.5, Math.min(fab.hauteurMax ?? 40, bt.h ?? (bt.e ? bt.e * 3 : etOsm ? etOsm * 3.2 : 6)));
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
    // Toit en pente d'OSM (deux pans, quatre pans, pyramide, mansarde) sur un petit bâtiment convexe :
    // une pyramide basse sur le contour (le faîtage n'est pas reconstruit).
    if (ao && [1, 2, 3, 7, 8].includes(ao.toit) && an.length <= 8 && aire(an) < 600 && convexe(an)) {
      const ax = an.reduce((s2, p) => s2 + (p[0] ?? 0), 0) / an.length;
      const az = an.reduce((s2, p) => s2 + (p[1] ?? 0), 0) / an.length;
      const apex = to.sommet(ax, sommet + Math.min(3.5, 0.3 * Math.sqrt(aire(an))), az);
      for (let i = 0; i < an.length; i += 1) {
        const A = /** @type {number[]} */ (an[i]);
        const B = /** @type {number[]} */ (an[(i + 1) % an.length]);
        const cross = ((B[0] ?? 0) - (A[0] ?? 0)) * (az - (A[1] ?? 0)) - ((B[1] ?? 0) - (A[1] ?? 0)) * (ax - (A[0] ?? 0));
        if (cross < 0) to.tri(/** @type {number} */ (base[i]), /** @type {number} */ (base[(i + 1) % an.length]), apex);
        else to.tri(/** @type {number} */ (base[i]), apex, /** @type {number} */ (base[(i + 1) % an.length]));
      }
      toitsEnPente += 1;
      nbBatiments += 1;
      continue;
    }
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
  // Semis déplacé et éclairci (bosquets, clairières), puis plafond tiré au sort par tronçon
  // (tools/maps/arbres.mjs) : ni grille visible, ni lisière droite.
  /** @type {Array<ReturnType<typeof semer>>} */
  const arbresParTroncon = bornes.map(() => []);
  for (const a of semer(d.arbres)) {
    const pr = idxRail.proche(a.x, a.z, dl);
    if (pr.i < 0) continue;
    const pf = /** @type {typeof profils[0]} */ (profils[Math.min(NS - 1, Math.round(pr.i / K))]);
    if (pr.d < pf.e + 5 || lacEn(a.x, a.z)) continue; // houppier hors de l’accotement
    /** @type {ReturnType<typeof semer>} */ (arbresParTroncon[chunkDeStation[Math.min(NS - 1, Math.round(pr.i / K))] ?? 0]).push(a);
  }
  arbresParTroncon.forEach((liste, c) => {
    const lst = /** @type {{ arbre: number[] }} */ (instances[c]).arbre;
    for (const a of plafonner(liste, PLAFOND_ARBRES)) {
      const xi = Math.round(a.x * 10);
      const zi = Math.round(a.z * 10);
      const ech = (a.genre === 1 ? 1.2 : 1) * (0.7 + 0.6 * hasard(zi, xi));
      lst.push(a.x, sol(a.x, a.z), a.z, ech, hasard(Math.round(a.x * 7), Math.round(a.z * 3)) * Math.PI * 2);
    }
  });
  // Lampadaires d'OpenStreetMap à leur place (à moins de 40 m du rail), repoussés hors de la chaussée
  // et du trottoir s'ils y tombent, la crosse vers la route ; le semis régulier (en agglomération) ne
  // garde que les points du rail à plus de 30 m de tout lampadaire d'OSM.
  /** @type {Grille<number>} */
  const gLampes = new Grille(20);
  let lampesOsm = 0;
  if (osm)
    for (let k = 0; k < osm.lampadaires.length; k += 2) {
      let x = osm.lampadaires[k] ?? 0;
      let z = osm.lampadaires[k + 1] ?? 0;
      if (gLampes.proches(x, z, 5).length) continue;
      const pr = idxRail.proche(x, z, 40);
      if (pr.i < 0) continue;
      const pf = /** @type {typeof profils[0]} */ (profils[Math.min(NS - 1, Math.round(pr.i / K))]);
      if (pf.ground === 'tunnel') continue;
      // Pied du lampadaire sur l'axe : projection sur le segment le plus proche du rail.
      const qa = /** @type {number[]} */ (rail[pr.i]);
      const qb = /** @type {number[]} */ (rail[Math.min(N - 1, pr.i + 1)]);
      const qx = (qa[0] ?? 0) + ((qb[0] ?? 0) - (qa[0] ?? 0)) * pr.t;
      const qz = (qa[2] ?? 0) + ((qb[2] ?? 0) - (qa[2] ?? 0)) * pr.t;
      const t = /** @type {number[]} */ (T[pr.i]);
      let dx = x - qx;
      let dz = z - qz;
      let L = Math.hypot(dx, dz);
      if (L < 0.1) [dx, dz, L] = [-(t[1] ?? 0), t[0] ?? 0, 1];
      const dedans = L < pf.e - 0.4;
      if (dedans) {
        x = qx + (dx / L) * (pf.e - 0.4);
        z = qz + (dz / L) * (pf.e - 0.4);
      }
      gLampes.ajouter(x, z, 0);
      const c = chunkDeStation[Math.min(NS - 1, Math.round(pr.i / K))] ?? 0;
      /** @type {{ lampadaire: number[] }} */ (instances[c]).lampadaire.push(x, dedans || L < pf.e ? pf.ye : sol(x, z), z, 1, Math.atan2(-dx, -dz));
      lampesOsm += 1;
    }
  let lampesSemees = 0;
  const pasLampes = fab.pasLampadaires ?? 15;
  for (let i = 0; i < N - (boucle ? 1 : 0); i += Math.round(pasLampes / step)) {
    const pf = /** @type {typeof profils[0]} */ (profils[Math.min(NS - 1, Math.round(i / K))]);
    if (!pf.urban || pf.ground !== 'sol') continue;
    if (lampesOsm && gLampes.proches(rail[i]?.[0] ?? 0, rail[i]?.[2] ?? 0, 30).length) continue;
    lampesSemees += 1;
    const cote = Math.round(i / Math.round(pasLampes / step)) % 2 === 0 ? 1 : -1;
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

  // Arbres d'OpenStreetMap (isolés et alignements) à leur place ; parcs et jardins : un arbre tous les
  // 12 m environ (grille tirée au hasard) loin des arbres connus. Palmiers : ceux d'OSM (genre ou
  // espèce), et une part des autres (fabrication.palmiers, de 0 à 1) dans les villes du bord de mer.
  let arbresOsm = 0;
  let palmiers = 0;
  let arbresParcs = 0;
  if (osm) {
    const part = fab.palmiers ?? 0;
    /** @type {Grille<number>} */
    const gArbres = new Grille(10);
    /** @param {number} x @param {number} z @param {number} genre @param {number} cle */
    const poser = (x, z, genre, cle) => {
      const pr = idxRail.proche(x, z, dl);
      if (pr.i < 0) return false;
      const pf = /** @type {typeof profils[0]} */ (profils[Math.min(NS - 1, Math.round(pr.i / K))]);
      if (pr.d < pf.e + 1.5 || lacEn(x, z) || gArbres.proches(x, z, 3).length) return false;
      gArbres.ajouter(x, z, 0);
      const palme = genre === 3 || (genre === 0 && hasard(cle, 17) < part);
      if (palme) palmiers += 1;
      const c = chunkDeStation[Math.min(NS - 1, Math.round(pr.i / K))] ?? 0;
      const ech = (palme ? 0.85 : 0.75) + 0.5 * hasard(Math.round(z * 10), Math.round(x * 10));
      /** @type {Record<string, number[]>} */ (instances[c])[palme ? 'palmier' : 'arbre']?.push(x, sol(x, z), z, ech, hasard(Math.round(x * 7), Math.round(z * 3)) * Math.PI * 2);
      return true;
    };
    for (let k = 0; k < osm.arbres.length; k += 3) if (poser(osm.arbres[k] ?? 0, osm.arbres[k + 1] ?? 0, osm.arbres[k + 2] ?? 0, k)) arbresOsm += 1;
    for (const f of osm.parcs) {
      /** @type {number[][]} */
      const ring = [];
      for (let k = 0; k < f.length; k += 2) ring.push([f[k] ?? 0, f[k + 1] ?? 0]);
      const bx = boite([ring]);
      const G = 12;
      for (let gz = Math.floor(bx[1] / G); gz <= Math.ceil(bx[3] / G); gz += 1)
        for (let gx = Math.floor(bx[0] / G); gx <= Math.ceil(bx[2] / G); gx += 1) {
          const x = (gx + hasard(gx + 313, gz)) * G;
          const z = (gz + hasard(gz + 571, gx)) * G;
          if (!dansPolygone(x, z, [ring]) || gArbres.proches(x, z, 8).length) continue;
          if (poser(x, z, 0, gx * 7919 + gz)) arbresParcs += 1;
        }
    }
  }
  // Feux tricolores d'OSM : un par carrefour et par passage, à droite, 8 m avant, tourné vers ceux qui arrivent.
  let nbFeux = 0;
  if (osm) {
    /** @type {number[]} */
    const faits = [];
    for (let k = 0; k < osm.feux.length; k += 2) {
      const pr = idxRail.proche(osm.feux[k] ?? 0, osm.feux[k + 1] ?? 0, 25);
      if (pr.i < 0 || faits.some((j) => ecartLe(pr.i, j) < 30)) continue;
      faits.push(pr.i);
      let i = pr.i - Math.round(8 / step);
      if (boucle) i = ((i % per) + per) % per;
      else if (i < 0) continue;
      const pf = /** @type {typeof profils[0]} */ (profils[Math.min(NS - 1, Math.round(i / K))]);
      if (pf.ground === 'tunnel') continue;
      const p = /** @type {number[]} */ (rail[i]);
      const t = /** @type {number[]} */ (T[i]);
      const u = pf.e - 0.5;
      const c = chunkDeStation[Math.min(NS - 1, Math.round(i / K))] ?? 0;
      /** @type {{ feu: number[] }} */ (instances[c]).feu.push((p[0] ?? 0) - (t[1] ?? 0) * u, pf.ye, (p[2] ?? 0) + (t[0] ?? 0) * u, 1, Math.atan2(-(t[0] ?? 0), -(t[1] ?? 0)));
      nbFeux += 1;
    }
  }
  // Commerces d'OSM au bord du parcours (45 m au plus) : un par côté et par 12 m de route, pour les
  // enseignes de la sortie de nuit (src/drive/scene/enseignes.ts), avec leur genre seulement.
  let nbCommerces = 0;
  if (osm) {
    const pris = new Set();
    for (let k = 0; k < osm.commerces.length; k += 3) {
      const x = osm.commerces[k] ?? 0;
      const z = osm.commerces[k + 1] ?? 0;
      const pr = idxRail.proche(x, z, 45);
      if (pr.i < 0) continue;
      const pf = /** @type {typeof profils[0]} */ (profils[Math.min(NS - 1, Math.round(pr.i / K))]);
      if (pf.ground === 'tunnel') continue;
      const p = /** @type {number[]} */ (rail[pr.i]);
      const t = /** @type {number[]} */ (T[pr.i]);
      const cote = (x - (p[0] ?? 0)) * -(t[1] ?? 0) + (z - (p[2] ?? 0)) * (t[0] ?? 0) >= 0 ? 1 : -1;
      const cle = `${Math.round((pr.i * step) / 12)}|${cote}`;
      if (pris.has(cle)) continue;
      pris.add(cle);
      commercesParTroncon[chunkDeStation[Math.min(NS - 1, Math.round(pr.i / K))] ?? 0]?.push(arr(pr.i * step), x, sol(x, z), z, osm.commerces[k + 2] ?? 0);
      nbCommerces += 1;
    }
  }
  // Ponts et tunnels de la carte recoupés par OSM (bridge, tunnel) : une route d'OSM du même genre à
  // moins de 8 m du milieu de l'ouvrage.
  let ouvragesConfirmes = 0;
  if (osm) {
    /** @type {Grille<number>} */
    const g = new Grille(10);
    for (const ro of osm.routes) if (ro.s) for (const q of jalonner(ro.p, 3)) g.ajouter(q.x, q.z, ro.s);
    for (const se of sections) {
      if (se.ground === 'sol') continue;
      const p = rail[Math.min(N - 1, Math.round((se.from + se.to) / 2 / step))] ?? [0, 0, 0];
      if (g.proches(p[0] ?? 0, p[2] ?? 0, 8).some((q) => q.v === (se.ground === 'pont' ? 1 : 2))) ouvragesConfirmes += 1;
    }
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
    const inst = /** @type {{ arbre: number[], lampadaire: number[], balise: number[], feu: number[], palmier: number[] }} */ (instances[c]);
    /** @type {Partial<Record<'arbre' | 'lampadaire' | 'balise' | 'feu' | 'palmier', number[]>>} */
    const rel = {};
    for (const kind of /** @type {const} */ (['arbre', 'lampadaire', 'balise', 'feu', 'palmier'])) {
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
      to: c === bornes.length - 1 ? (boucle ? length : arr(length)) : arr(i1 * step),
      origin,
      box: /** @type {[number, number, number, number, number, number]} */ ([...g.min, ...g.max].map((v) => arr(v))),
      triangles: g.triangles,
      instances: rel,
      // Commerces (carte enrichie par OSM ; liste vide comprise) : abscisse, x, y, z relatifs, genre.
      ...(osm
        ? {
            shops: (commercesParTroncon[c] ?? []).map((v, k) => (k % 5 === 0 || k % 5 === 4 ? v : arr(v - (origin[(k % 5) - 1] ?? 0)))),
          }
        : {}),
    };
  });

  // --- 13. Relief lointain : grille proche (trouée au droit du couloir) et grille large (sous la proche).
  const far = new Assembleur();
  const idxLarge = indexPolyligne(rail, { ix: 0, iz: 2, cellule: 200 });
  // En mer (le relief y est au niveau de la mer, faute de donnée), pas de relief lointain : au-delà
  // de la mer fabriquée, le large se fond dans la brume au lieu d'un plateau sombre au ras de l'eau.
  const mer = lacs.find((/** @type {any} */ l) => l.nature === 'Mer') ?? null;
  /**
   * @param {any} g @param {number} abaisse @param {(i: number, j: number) => boolean} garder
   * @param {boolean} trouer
   */
  const grilleFar = (g, abaisse, garder, trouer) => {
    // Plancher : la plus basse altitude de la chaussée (hors tunnel, emprise et 3 m compris) dans chaque
    // case ; les quatre coins d'une case que la route traverse passent 2 m dessous, si bien que le
    // relief lointain ne recouvre jamais la route (la rampe au départ de la carte des lacs).
    /** @type {Map<number, number>} */
    const plancher = new Map();
    for (let i = 0; i < N; i += 1) {
      if ((sec[i]?.ground ?? 'sol') === 'tunnel') continue;
      const p = /** @type {number[]} */ (rail[i]);
      const e = (largeur[i] ?? 6) / 2 + 2.2 + 3;
      const ia = Math.floor(((p[0] ?? 0) - e) / g.pas) - g.i0;
      const ib = Math.floor(((p[0] ?? 0) + e) / g.pas) - g.i0;
      const ja = Math.floor(((p[2] ?? 0) - e) / g.pas) - g.j0;
      const jb = Math.floor(((p[2] ?? 0) + e) / g.pas) - g.j0;
      for (let ci = ia; ci <= ib; ci += 1)
        for (let cj = ja; cj <= jb; cj += 1) {
          const k = (cj + 1) * (g.nx + 3) + ci + 1;
          plancher.set(k, Math.min(plancher.get(k) ?? Infinity, p[1] ?? 0));
        }
    }
    const ids = new Int32Array(g.nx * g.nz);
    const pres = new Uint8Array(g.nx * g.nz);
    const auLarge = new Uint8Array(g.nx * g.nz);
    for (let j = 0; j < g.nz; j += 1)
      for (let i = 0; i < g.nx; i += 1) {
        const x = (g.i0 + i) * g.pas;
        const z = (g.j0 + j) * g.pas;
        let y = (g.dm[j * g.nx + i] ?? 0) / 10 - abaisse;
        if (mer && y + abaisse <= mer.y + 0.3) auLarge[j * g.nx + i] = 1;
        const l = lacEn(x, z);
        if (l) y = Math.min(y, l.y - 4);
        const pr = trouer ? idxLarge.proche(x, z, dl + 60) : { d: Infinity };
        if (pr.d < dl + 60) y -= 4;
        if (pr.d < dl - 30) pres[j * g.nx + i] = 1;
        for (const [ci, cj] of [
          [i - 1, j - 1],
          [i, j - 1],
          [i - 1, j],
          [i, j],
        ])
          y = Math.min(y, (plancher.get(((cj ?? 0) + 1) * (g.nx + 3) + (ci ?? 0) + 1) ?? Infinity) - 2);
        ids[j * g.nx + i] = far.sommet(x, y, z);
      }
    for (let j = 0; j < g.nz - 1; j += 1)
      for (let i = 0; i < g.nx - 1; i += 1) {
        if (!garder(i, j)) continue;
        const q = [j * g.nx + i, j * g.nx + i + 1, (j + 1) * g.nx + i + 1, (j + 1) * g.nx + i];
        if (trouer && q.every((v) => pres[v])) continue;
        if (q.every((v) => auLarge[v])) continue;
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
    } else if (dp.etape !== undefined) {
      // Étape de l'itinéraire (carte.json, itineraire.etapes) : point du parcours le plus proche.
      const e = d.axe.etapes?.[dp.etape];
      if (!e) throw new Error(`départ « ${dp.id} » : étape ${dp.etape} absente des données`);
      const pr = idxRail.proche(e[0] ?? 0, e[1] ?? 0, 500);
      if (pr.i < 0) throw new Error(`départ « ${dp.id} » : étape ${dp.etape} loin du parcours`);
      s = (pr.i + pr.t) * step;
    } else if (dp.rue) {
      // Première entrée du parcours dans la rue nommée.
      const i = rail.findIndex((_, k) => d.axe.troncons[rangDe(k)]?.nom === dp.rue);
      if (i < 0) throw new Error(`départ « ${dp.id} » : rue « ${dp.rue} » absente du parcours`);
      s = i * step;
    }
    s = Math.max(0, Math.min(length - step, s + (dp.decalage ?? 0)));
    return { id: dp.id, label: dp.label, at: arr(Math.round(s / step) * step) };
  });

  const route = {
    format: /** @type {const} */ ('pmb-carte'),
    version: /** @type {const} */ (1),
    id,
    loop: boucle,
    length: boucle ? length : arr(length),
    step,
    rail: rail.flat(),
    sections,
    chunks,
    starts,
    far: { file: 'lointain.glb', triangles: farGlb.triangles },
  };

  // Contrôle : aucun point de la chaussée (hors tunnel) sous le décor ni sous le relief lointain.
  const maillagesEnMemoire = parChunk.flatMap((m) => [...m].map(([role, a]) => ({ role, positions: a.pos, index: a.idx })));
  const couverture = chausseeCouverte(route, maillagesEnMemoire, [{ role: 'lointain', positions: far.pos, index: far.idx }]);
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
    terrainSurRoute: couverture.couverts.filter((c) => c.role === 'terrain').length,
    terrainReplie: replies,
    terrainRefuse,
    sommetsTerrain: terX.length,
    zonesRefusees: [...zonesRefusees].sort((x, y) => x - y),
    chausseeCouverte: couverture.couverts.length,
    couverture: resumerCouverture(couverture.couverts),
    couverts: couverture.couverts,
    batiments: nbBatiments,
    batimentsRognes,
    batimentsEcartes,
    zonesRognees: [...zonesRognees].sort((x, y) => x - y),
    arbres: instances.reduce((s, x) => s + x.arbre.length / 5, 0),
    lampadaires: instances.reduce((s, x) => s + x.lampadaire.length / 5, 0),
    balises: instances.reduce((s, x) => s + x.balise.length / 5, 0),
    glissieres: glis.reduce((s, f) => s + f.filter(Boolean).length, 0) * step * K,
    ponts: sections.filter((s) => s.ground === 'pont').length,
    tunnels: sections.filter((s) => s.ground === 'tunnel').length,
    feux: instances.reduce((s, x) => s + x.feu.length / 5, 0),
    palmiers: instances.reduce((s, x) => s + x.palmier.length / 5, 0),
    /** Ce qu'OpenStreetMap a apporté à la carte (null sans enrichissement). */
    osm: osm
      ? {
          lampadairesOsm: lampesOsm,
          lampadairesSemes: lampesSemees,
          arbresOsm,
          arbresParcs,
          palmiers,
          feux: nbFeux,
          passages: nbPassages,
          commerces: nbCommerces,
          murs: Math.round(longueurMurs),
          glissieres: Math.round(glisOsm * step * K),
          sectionsAvecVitesse: sections.filter((s) => /** @type {any} */ (s).speed).length,
          longueurAvecVitesse: Math.round(sections.reduce((s, x) => s + (/** @type {any} */ (x).speed ? x.to - x.from : 0), 0)),
          batimentsEtages: etagesOsm,
          toitsEnPente,
          pistes: osm.pistes.length,
          ouvrages: sections.filter((s) => s.ground !== 'sol').length,
          ouvragesConfirmes,
        }
      : null,
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
          `bord chaussée-terrain ${m.ecartBord.toFixed(2)} m · talus ${m.talusMax.toFixed(1)} m au plus · axe-terrain nu ${m.ecartAxe.toFixed(1)} m · triangles de terrain écartés de la chaussée : ${m.terrainRefuse}${m.zonesRefusees.length ? ` (vers ${m.zonesRefusees.slice(0, 12).join(', ')} m)` : ''} · replié contre une autre portion : ${m.terrainReplie} sommets`,
      );
      console.log(
        `  chaussée couverte (hors tunnel) : ${m.chausseeCouverte} points` +
          (m.chausseeCouverte ? ` (${Object.entries(m.couverture.parRole).map(([k, v]) => `${k} ${v}`).join(', ')} ; jusqu'à ${m.couverture.dyMax.toFixed(2)} m ; vers ${m.couverture.zones.slice(0, 16).join(', ')} m)` : ''),
      );
      console.log(`  ${m.batiments} bâtiments (${m.batimentsRognes} rognés hors de l'emprise, ${m.batimentsEcartes} écartés) · ${m.arbres} arbres · ${m.palmiers} palmiers · ${m.lampadaires} lampadaires · ${m.feux} feux · ${m.balises} balises · ${Math.round(m.glissieres)} m de glissières · ${m.ponts} ponts · ${m.tunnels} tunnels`);
      if (m.osm) console.log(`  OpenStreetMap : ${Object.entries(m.osm).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
      console.log(`  → ${relative(ROOT, out)}/`);
    } catch (error) {
      failed += 1;
      console.error(`${id} : ${error instanceof Error ? (error.stack ?? error.message) : error}`);
    }
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
