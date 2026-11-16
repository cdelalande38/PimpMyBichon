// @ts-check
// Arbres des cartes : les candidats de donnees.json (grille de 7 m tirée au hasard dans la
// végétation, et le long des haies) sont déplacés de quelques mètres hors de leur case, puis
// éclaircis par un bruit de basse fréquence (bosquets et clairières plutôt qu'une plantation
// régulière), enfin plafonnés par tronçon en tirant au sort (et non en gardant les premiers de la
// liste, rangée par lignes : la coupe dessinait une lisière droite). Déterministe ; fonctions pures,
// testées par tests/unit/cartes-arbres.test.ts.

import { hasard } from './geom2d.mjs';

/** Bruit de valeur lissé dans [0, 1), de période `echelle` mètres. @param {number} x @param {number} z @param {number} echelle */
export function bruit(x, z, echelle) {
  const fx = x / echelle;
  const fz = z / echelle;
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const u = fx - i;
  const v = fz - j;
  const s = (/** @type {number} */ t) => t * t * (3 - 2 * t);
  const a = hasard(i + 101, j + 977);
  const b = hasard(i + 102, j + 977);
  const c = hasard(i + 101, j + 978);
  const d = hasard(i + 102, j + 978);
  return a + (b - a) * s(u) + (c - a) * s(v) + (a - b - c + d) * s(u) * s(v);
}

/**
 * Sème les arbres à partir des candidats (x, z, genre) : déplacement de ±`ecart` mètres, puis
 * tirage avec une probabilité qui suit le bruit (de `pMin` dans les clairières à `pMax` au cœur des
 * bosquets). Rend { x, z, genre, cle } ; `cle` sert au tirage au sort du plafond.
 * @param {number[]} candidats trois nombres par candidat
 * @param {{ ecart?: number, echelle?: number, pMin?: number, pMax?: number }} [o]
 */
export function semer(candidats, o = {}) {
  const ecart = o.ecart ?? 6;
  const echelle = o.echelle ?? 45;
  const pMin = o.pMin ?? 0.05;
  const pMax = o.pMax ?? 1;
  /** @type {Array<{ x: number, z: number, genre: number, cle: number }>} */
  const out = [];
  for (let t = 0; t < candidats.length; t += 3) {
    const x0 = candidats[t] ?? 0;
    const z0 = candidats[t + 1] ?? 0;
    const xi = Math.round(x0 * 10);
    const zi = Math.round(z0 * 10);
    const x = x0 + (hasard(xi, zi + 17) - 0.5) * 2 * ecart;
    const z = z0 + (hasard(zi + 29, xi) - 0.5) * 2 * ecart;
    const n = bruit(x, z, echelle);
    const p = pMin + (pMax - pMin) * Math.min(1, Math.max(0, (n - 0.25) / 0.5));
    if (hasard(xi + 7, zi + 3) >= p) continue;
    out.push({ x, z, genre: candidats[t + 2] ?? 0, cle: hasard(zi + 911, xi + 313) });
  }
  return out;
}

/**
 * Garde au plus `n` arbres, tirés au sort par leur clé (sans biais de position).
 * @template {{ cle: number }} T @param {T[]} liste @param {number} n
 */
export function plafonner(liste, n) {
  if (liste.length <= n) return liste;
  const garde = new Set([...liste].sort((a, b) => a.cle - b.cle).slice(0, n));
  return liste.filter((a) => garde.has(a));
}

/**
 * Indice de Clark et Evans d'un semis (distance moyenne au plus proche voisin rapportée à celle d'un
 * semis au hasard de même densité) : 1 au hasard, plus de 1 régulier (2,15 en réseau hexagonal),
 * moins de 1 en bosquets. Mesuré dans un rectangle, bords exclus.
 * @param {Array<{ x: number, z: number }>} pts @param {[number, number, number, number]} r
 */
export function clarkEvans(pts, r) {
  const marge = 10;
  const dedans = pts.filter((p) => p.x >= r[0] && p.x <= r[2] && p.z >= r[1] && p.z <= r[3]);
  const C = 10;
  /** @type {Map<string, Array<{ x: number, z: number }>>} */
  const cases = new Map();
  for (const p of dedans) {
    const k = `${Math.floor(p.x / C)}|${Math.floor(p.z / C)}`;
    const l = cases.get(k);
    if (l) l.push(p);
    else cases.set(k, [p]);
  }
  let somme = 0;
  let n = 0;
  for (const p of dedans) {
    if (p.x < r[0] + marge || p.x > r[2] - marge || p.z < r[1] + marge || p.z > r[3] - marge) continue;
    let d = Infinity;
    const cx = Math.floor(p.x / C);
    const cz = Math.floor(p.z / C);
    for (let a = cx - 1; a <= cx + 1; a += 1)
      for (let b = cz - 1; b <= cz + 1; b += 1) for (const q of cases.get(`${a}|${b}`) ?? []) if (q !== p) d = Math.min(d, Math.hypot(q.x - p.x, q.z - p.z));
    if (d < Infinity) {
      somme += d;
      n += 1;
    }
  }
  const densite = dedans.length / ((r[2] - r[0]) * (r[3] - r[1]));
  return n ? somme / n / (0.5 / Math.sqrt(densite)) : NaN;
}
