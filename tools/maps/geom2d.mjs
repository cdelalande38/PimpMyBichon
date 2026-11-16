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

/**
 * Met bout à bout des lignes dont les extrémités se touchent (à `tol` mètres près), dans un sens ou
 * dans l'autre. Rend les lignes raccordées, la plus longue (en sommets) d'abord.
 * @param {number[][][]} lignes @param {number} [tol]
 */
export function raccorder(lignes, tol = 1) {
  const reste = lignes.filter((l) => l.length >= 2).map((l) => [...l]);
  /** @type {number[][][]} */
  const out = [];
  const proche = (/** @type {number[]} */ a, /** @type {number[]} */ b) => Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0)) <= tol;
  while (reste.length) {
    let l = /** @type {number[][]} */ (reste.shift());
    for (let ajout = true; ajout; ) {
      ajout = false;
      for (let i = 0; i < reste.length; i += 1) {
        const m = /** @type {number[][]} */ (reste[i]);
        const d0 = /** @type {number[]} */ (l[0]);
        const d1 = /** @type {number[]} */ (l[l.length - 1]);
        const m0 = /** @type {number[]} */ (m[0]);
        const m1 = /** @type {number[]} */ (m[m.length - 1]);
        if (proche(d1, m0)) l = [...l, ...m.slice(1)];
        else if (proche(d1, m1)) l = [...l, ...[...m].reverse().slice(1)];
        else if (proche(d0, m1)) l = [...m, ...l.slice(1)];
        else if (proche(d0, m0)) l = [...[...m].reverse(), ...l.slice(1)];
        else continue;
        reste.splice(i, 1);
        ajout = true;
        break;
      }
    }
    out.push(l);
  }
  return out.sort((a, b) => b.length - a.length);
}

/**
 * Plus longue portion d'une ligne à l'intérieur d'un rectangle, bouts ramenés sur le bord.
 * @param {number[][]} ligne @param {[number, number, number, number]} r minX, minZ, maxX, maxZ
 */
export function couperLigne(ligne, r) {
  const dedans = (/** @type {number[]} */ p) => (p[0] ?? 0) >= r[0] && (p[0] ?? 0) <= r[2] && (p[1] ?? 0) >= r[1] && (p[1] ?? 0) <= r[3];
  /** Point du segment a → b sur le bord (a dedans, b dehors, ou l'inverse). */
  const bord = (/** @type {number[]} */ a, /** @type {number[]} */ b) => {
    let t = 1;
    const dx = (b[0] ?? 0) - (a[0] ?? 0);
    const dz = (b[1] ?? 0) - (a[1] ?? 0);
    for (const [v, d, o] of /** @type {Array<[number, number, number]>} */ ([
      [r[0], dx, a[0] ?? 0],
      [r[2], dx, a[0] ?? 0],
    ]))
      if (d !== 0) {
        const u = (v - o) / d;
        if (u > 0 && u < t) t = u;
      }
    for (const v of [r[1], r[3]])
      if (dz !== 0) {
        const u = (v - (a[1] ?? 0)) / dz;
        if (u > 0 && u < t) t = u;
      }
    return [(a[0] ?? 0) + dx * t, (a[1] ?? 0) + dz * t];
  };
  /** @type {number[][][]} */
  const morceaux = [];
  /** @type {number[][]} */
  let cur = [];
  for (let i = 0; i < ligne.length; i += 1) {
    const p = /** @type {number[]} */ (ligne[i]);
    const q = ligne[i - 1];
    if (dedans(p)) {
      if (cur.length === 0 && q && !dedans(q)) cur.push(bord(p, q));
      cur.push(p);
    } else if (cur.length) {
      cur.push(bord(/** @type {number[]} */ (q), p));
      morceaux.push(cur);
      cur = [];
    }
  }
  if (cur.length) morceaux.push(cur);
  return morceaux.sort((a, b) => b.length - a.length)[0] ?? [];
}

/**
 * Referme une ligne qui traverse un rectangle (bouts sur le bord) en deux anneaux : l'un longe le
 * bord dans un sens, l'autre dans l'autre. Sert à la mer : le trait de côte et le large.
 * @param {number[][]} ligne @param {[number, number, number, number]} r minX, minZ, maxX, maxZ
 * @returns {[number[][], number[][]]}
 */
export function fermerSurBoite(ligne, r) {
  // Abscisse sur le périmètre, de 0 à 4 : haut (z min) vers l'est, droite, bas vers l'ouest, gauche.
  const t = (/** @type {number[]} */ p) => {
    const x = p[0] ?? 0;
    const z = p[1] ?? 0;
    const e = [Math.abs(z - r[1]), Math.abs(x - r[2]), Math.abs(z - r[3]), Math.abs(x - r[0])];
    const c = e.indexOf(Math.min(...e));
    if (c === 0) return (x - r[0]) / (r[2] - r[0]);
    if (c === 1) return 1 + (z - r[1]) / (r[3] - r[1]);
    if (c === 2) return 2 + (r[2] - x) / (r[2] - r[0]);
    return 3 + (r[3] - z) / (r[3] - r[1]);
  };
  const coins = [
    [r[2], r[1]],
    [r[2], r[3]],
    [r[0], r[3]],
    [r[0], r[1]],
  ];
  const a = /** @type {number[]} */ (ligne[0]);
  const b = /** @type {number[]} */ (ligne[ligne.length - 1]);
  const ta = t(a);
  const tb = t(b);
  /** Coins rencontrés en allant de t0 à t1 dans le sens du périmètre. @param {number} t0 @param {number} t1 */
  const parcours = (t0, t1) => {
    const fin = t1 >= t0 ? t1 : t1 + 4;
    /** @type {number[][]} */
    const out = [];
    for (let k = Math.floor(t0) + 1; k <= fin; k += 1) out.push(/** @type {number[]} */ (coins[(k - 1) % 4]));
    return out;
  };
  const sens = [...ligne, ...parcours(tb, ta)];
  const inverse = [...ligne, ...parcours(ta, tb).reverse()];
  return [sens, inverse];
}
