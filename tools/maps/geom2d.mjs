// @ts-check
// Géométrie plane des cartes (repère de la carte, plan X, Z) : distance à une polyligne avec un index
// en grille, point dans un polygone, simplification, découpe d'un polygone par un carré, aire, hachage
// déterministe. Fonctions pures, sans fournisseur ni réseau.

/**
 * Index des segments d'une polyligne plane pour les requêtes de distance.
 * @param {number[][]} pts [x, z] ou [x, ?, z] (indiquer `iz`)
 * @param {{ cellule?: number, ix?: number, iz?: number }} [o]
 */
export function indexPolyligne(pts, o = {}) {
  const cellule = o.cellule ?? 50;
  const ix = o.ix ?? 0;
  const iz = o.iz ?? 1;
  /** @type {Map<string, number[]>} */
  const cases = new Map();
  const X = pts.map((p) => p[ix] ?? 0);
  const Z = pts.map((p) => p[iz] ?? 0);
  for (let i = 0; i < pts.length - 1; i += 1) {
    const x0 = Math.floor(Math.min(X[i] ?? 0, X[i + 1] ?? 0) / cellule);
    const x1 = Math.floor(Math.max(X[i] ?? 0, X[i + 1] ?? 0) / cellule);
    const z0 = Math.floor(Math.min(Z[i] ?? 0, Z[i + 1] ?? 0) / cellule);
    const z1 = Math.floor(Math.max(Z[i] ?? 0, Z[i + 1] ?? 0) / cellule);
    for (let a = x0; a <= x1; a += 1)
      for (let b = z0; b <= z1; b += 1) {
        const k = `${a}|${b}`;
        const l = cases.get(k);
        if (l) l.push(i);
        else cases.set(k, [i]);
      }
  }
  return {
    /**
     * Segment le plus proche de (x, z) dans un rayon (au-delà : d = Infinity).
     * @param {number} x @param {number} z @param {number} rayon
     * @returns {{ d: number, i: number, t: number, cote: number }} cote > 0 à droite du sens de parcours
     */
    proche(x, z, rayon) {
      let best = { d: Infinity, i: -1, t: 0, cote: 0 };
      const r = Math.ceil(rayon / cellule);
      const cx = Math.floor(x / cellule);
      const cz = Math.floor(z / cellule);
      for (let a = cx - r; a <= cx + r; a += 1)
        for (let b = cz - r; b <= cz + r; b += 1) {
          for (const i of cases.get(`${a}|${b}`) ?? []) {
            const ax = X[i] ?? 0;
            const az = Z[i] ?? 0;
            const dx = (X[i + 1] ?? 0) - ax;
            const dz = (Z[i + 1] ?? 0) - az;
            const L2 = dx * dx + dz * dz;
            const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
            const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
            if (d < best.d || (d === best.d && i < best.i)) {
              // Repère direct X est, Z sud : la droite du sens de marche (dx, dz) est (−dz, dx).
              const cote = Math.sign((x - ax) * -dz + (z - az) * dx);
              best = { d, i, t, cote };
            }
          }
        }
      return best.d <= rayon ? best : { d: Infinity, i: -1, t: 0, cote: 0 };
    },
  };
}

/** Point dans un polygone à trous (règle pair-impair). @param {number} x @param {number} z @param {number[][][]} anneaux */
export function dansPolygone(x, z, anneaux) {
  let dedans = false;
  for (const a of anneaux) {
    for (let i = 0, j = a.length - 1; i < a.length; j = i, i += 1) {
      const xi = a[i]?.[0] ?? 0;
      const zi = a[i]?.[1] ?? 0;
      const xj = a[j]?.[0] ?? 0;
      const zj = a[j]?.[1] ?? 0;
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) dedans = !dedans;
    }
  }
  return dedans;
}

/** Boîte d'anneaux : [minX, minZ, maxX, maxZ]. @param {number[][][]} anneaux */
export function boite(anneaux) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const a of anneaux)
    for (const p of a) {
      b[0] = Math.min(b[0] ?? 0, p[0] ?? 0);
      b[1] = Math.min(b[1] ?? 0, p[1] ?? 0);
      b[2] = Math.max(b[2] ?? 0, p[0] ?? 0);
      b[3] = Math.max(b[3] ?? 0, p[1] ?? 0);
    }
  return /** @type {[number, number, number, number]} */ (b);
}

/** Aire signée d'un anneau (positive dans le sens trigonométrique du plan X, Z). @param {number[][]} a */
export function aire(a) {
  let s = 0;
  for (let i = 0, j = a.length - 1; i < a.length; j = i, i += 1) s += ((a[j]?.[0] ?? 0) - (a[i]?.[0] ?? 0)) * ((a[j]?.[1] ?? 0) + (a[i]?.[1] ?? 0));
  return s / 2;
}

/** Simplification de Douglas-Peucker (tolérance en mètres), anneau ou ligne. @param {number[][]} pts @param {number} tol */
export function simplifier(pts, tol) {
  if (pts.length <= 3) return pts;
  const garde = new Uint8Array(pts.length);
  garde[0] = 1;
  garde[pts.length - 1] = 1;
  /** @type {Array<[number, number]>} */
  const pile = [[0, pts.length - 1]];
  while (pile.length) {
    const [a, b] = /** @type {[number, number]} */ (pile.pop());
    const pa = /** @type {number[]} */ (pts[a]);
    const pb = /** @type {number[]} */ (pts[b]);
    const dx = (pb[0] ?? 0) - (pa[0] ?? 0);
    const dz = (pb[1] ?? 0) - (pa[1] ?? 0);
    const L = Math.hypot(dx, dz);
    let dm = -1;
    let im = -1;
    for (let i = a + 1; i < b; i += 1) {
      const p = /** @type {number[]} */ (pts[i]);
      const d = L > 0 ? Math.abs(((p[0] ?? 0) - (pa[0] ?? 0)) * dz - ((p[1] ?? 0) - (pa[1] ?? 0)) * dx) / L : Math.hypot((p[0] ?? 0) - (pa[0] ?? 0), (p[1] ?? 0) - (pa[1] ?? 0));
      if (d > dm) [dm, im] = [d, i];
    }
    if (dm > tol && im > 0) {
      garde[im] = 1;
      pile.push([a, im], [im, b]);
    }
  }
  return pts.filter((_, i) => garde[i]);
}

/**
 * Découpe d'un anneau par un rectangle (Sutherland-Hodgman : le rectangle est convexe, l'anneau
 * peut être concave ; les arêtes dégénérées sont sans effet sur la triangulation).
 * @param {number[][]} anneau @param {[number, number, number, number]} r minX, minZ, maxX, maxZ
 */
export function decouperRectangle(anneau, r) {
  /** @type {Array<[(p: number[]) => boolean, (a: number[], b: number[]) => number[]]>} */
  const plans = [
    [(p) => (p[0] ?? 0) >= r[0], (a, b) => inter(a, b, 0, r[0])],
    [(p) => (p[0] ?? 0) <= r[2], (a, b) => inter(a, b, 0, r[2])],
    [(p) => (p[1] ?? 0) >= r[1], (a, b) => inter(a, b, 1, r[1])],
    [(p) => (p[1] ?? 0) <= r[3], (a, b) => inter(a, b, 1, r[3])],
  ];
  let out = anneau;
  for (const [dedans, couper] of plans) {
    if (out.length === 0) break;
    const entree = out;
    out = [];
    for (let i = 0; i < entree.length; i += 1) {
      const a = /** @type {number[]} */ (entree[(i + entree.length - 1) % entree.length]);
      const b = /** @type {number[]} */ (entree[i]);
      if (dedans(b)) {
        if (!dedans(a)) out.push(couper(a, b));
        out.push(b);
      } else if (dedans(a)) out.push(couper(a, b));
    }
  }
  return out;
}
/** @param {number[]} a @param {number[]} b @param {number} k @param {number} v */
function inter(a, b, k, v) {
  const t = (v - (a[k] ?? 0)) / ((b[k] ?? 0) - (a[k] ?? 0));
  return [(a[0] ?? 0) + ((b[0] ?? 0) - (a[0] ?? 0)) * t, (a[1] ?? 0) + ((b[1] ?? 0) - (a[1] ?? 0)) * t];
}

/** Hachage entier déterministe de deux entiers, rendu dans [0, 1). @param {number} a @param {number} b */
export function hasard(a, b) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
