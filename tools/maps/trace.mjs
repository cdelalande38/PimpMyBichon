// @ts-check
// Tracé du parcours, sans dépendance au fournisseur ni au réseau : chaînage des tronçons d'une
// route (plus court chemin entre départ et arrivée), lissage, rééchantillonnage à pas constant,
// pentes et rayons de courbure, sections et découpage en tronçons de décor. Fonctions pures, testées
// par tests/unit/cartes-trace.test.ts.

/** @typedef {{ points: number[][], sens?: string, [k: string]: unknown }} Arete  points : [x, y, z?] ; sens : « direct », « inverse » ou les deux */

/** Clé d'un nœud du graphe : extrémités confondues au demi-mètre. @param {number[]} p */
const cle = (p) => `${Math.round((p[0] ?? 0) * 2)}|${Math.round((p[1] ?? 0) * 2)}`;

/** Longueur plane d'une polyligne. @param {number[][]} pts */
export function longueurPlane(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i += 1) L += Math.hypot((pts[i]?.[0] ?? 0) - (pts[i - 1]?.[0] ?? 0), (pts[i]?.[1] ?? 0) - (pts[i - 1]?.[1] ?? 0));
  return L;
}

/**
 * Plus court chemin (Dijkstra) sur un ensemble de tronçons orientés (sens unique respecté), du nœud le plus proche de `depart` au
 * nœud le plus proche d'`arrivee`. Rend les tronçons dans l'ordre, chacun orienté dans le sens du
 * parcours, et la polyligne continue (sommets communs non répétés) avec, par sommet, le rang du
 * tronçon qui le porte (celui qui commence au sommet).
 * Options : `cout(e)` multiplie la longueur de l'arête e (préférer certaines rues) ; `sensIgnore`
 * parcourt les sens uniques dans les deux sens (circuit sur routes fermées).
 * @template {Arete} T
 * @param {T[]} aretes
 * @param {number[]} depart x, y
 * @param {number[]} arrivee x, y
 * @param {{ cout?: (e: number) => number, sensIgnore?: boolean }} [o]
 * @returns {{ troncons: T[], points: number[][], rang: number[], longueur: number }}
 */
export function chainer(aretes, depart, arrivee, o = {}) {
  /** @type {Map<string, { p: number[], voisins: Array<{ vers: string, e: number }> }>} */
  const noeuds = new Map();
  const longueurs = aretes.map((a) => longueurPlane(a.points));
  aretes.forEach((a, e) => {
    const p0 = /** @type {number[]} */ (a.points[0]);
    const p1 = /** @type {number[]} */ (a.points[a.points.length - 1]);
    const k0 = cle(p0);
    const k1 = cle(p1);
    if (!noeuds.has(k0)) noeuds.set(k0, { p: p0, voisins: [] });
    if (!noeuds.has(k1)) noeuds.set(k1, { p: p1, voisins: [] });
    // Sens unique respecté (rond-points, chaussées séparées) : « direct » va du premier au dernier sommet.
    if (o.sensIgnore || a.sens !== 'inverse') noeuds.get(k0)?.voisins.push({ vers: k1, e });
    if (o.sensIgnore || a.sens !== 'direct') noeuds.get(k1)?.voisins.push({ vers: k0, e });
  });
  /** @param {number[]} q */
  const plusProche = (q) => {
    let best = '';
    let bd = Infinity;
    for (const [k, n] of [...noeuds].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const d = Math.hypot((n.p[0] ?? 0) - (q[0] ?? 0), (n.p[1] ?? 0) - (q[1] ?? 0));
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    return best;
  };
  const a = plusProche(depart);
  const b = plusProche(arrivee);
  /** @type {Map<string, number>} */
  const dist = new Map([[a, 0]]);
  /** @type {Map<string, { de: string, e: number }>} */
  const prec = new Map();
  const vus = new Set();
  for (;;) {
    let u = '';
    let du = Infinity;
    for (const [k, d] of dist) if (!vus.has(k) && (d < du || (d === du && k < u))) [u, du] = [k, d];
    if (!u || u === b) break;
    vus.add(u);
    for (const { vers, e } of noeuds.get(u)?.voisins ?? []) {
      const d = du + (longueurs[e] ?? 0) * (o.cout ? o.cout(e) : 1);
      if (d < (dist.get(vers) ?? Infinity)) {
        dist.set(vers, d);
        prec.set(vers, { de: u, e });
      }
    }
  }
  if (!dist.has(b)) throw new Error('chaînage : aucun chemin entre le départ et l’arrivée sur cette route');
  /** @type {Array<{ e: number, sens: boolean }>} */
  const chemin = [];
  for (let k = b; prec.has(k); ) {
    const pr = /** @type {{ de: string, e: number }} */ (prec.get(k));
    const arete = /** @type {T} */ (aretes[pr.e]);
    chemin.unshift({ e: pr.e, sens: cle(/** @type {number[]} */ (arete.points[0])) === pr.de });
    k = pr.de;
  }
  /** @type {number[][]} */
  const points = [];
  /** @type {number[]} */
  const rang = [];
  /** @type {T[]} */
  const troncons = [];
  chemin.forEach(({ e, sens }, j) => {
    const arete = /** @type {T} */ (aretes[e]);
    const pts = sens ? arete.points : [...arete.points].reverse();
    troncons.push({ ...arete, points: pts });
    pts.forEach((p, i) => {
      if (i === 0 && j > 0) return;
      points.push(p);
      rang.push(i === pts.length - 1 && j < chemin.length - 1 ? j + 1 : j);
    });
  });
  return { troncons, points, rang, longueur: longueurPlane(points) };
}

/**
 * Itinéraire par étapes : plus court chemin d'une étape à la suivante (`chainer`), bouts mis bout à
 * bout ; en boucle, la dernière étape rejoint la première et le dernier point répète le premier.
 * Chaque étape peut préférer des rues (`par` : noms d'arêtes, les autres coûtent `penalite` fois
 * leur longueur). Rend la même forme que `chainer`, plus les demi-tours (cap qui se retourne de plus
 * de 150° d'un sommet au suivant, en mètres depuis le départ) pour contrôle.
 * @template {Arete & { nom?: string }} T
 * @param {T[]} aretes
 * @param {Array<{ p: number[], par?: string[] }>} etapes points x, y ; `par` vaut pour le trajet qui arrive à l'étape
 * @param {{ boucle?: boolean, sensIgnore?: boolean, penalite?: number }} [o]
 */
export function chainerEtapes(aretes, etapes, o = {}) {
  const suite = o.boucle ? [...etapes, /** @type {{ p: number[], par?: string[] }} */ (etapes[0])] : etapes;
  /** @type {T[]} */
  const troncons = [];
  /** @type {number[][]} */
  const points = [];
  /** @type {number[]} */
  const rang = [];
  for (let k = 1; k < suite.length; k += 1) {
    const a = /** @type {{ p: number[] }} */ (suite[k - 1]);
    const b = /** @type {{ p: number[], par?: string[] }} */ (suite[k]);
    const par = b.par && b.par.length ? new Set(b.par) : null;
    const pen = o.penalite ?? 4;
    const ch = chainer(aretes, a.p, b.p, { sensIgnore: o.sensIgnore, cout: par ? (e) => (par.has(String(aretes[e]?.nom ?? '')) ? 1 : pen) : undefined });
    const base = troncons.length;
    troncons.push(...ch.troncons);
    ch.points.forEach((p, i) => {
      if (i === 0 && points.length > 0) return;
      points.push(p);
      rang.push(base + (ch.rang[i] ?? 0));
    });
  }
  // Demi-tours : sommets où la route repart en arrière (étape mal placée sur une impasse).
  /** @type {number[]} */
  const demiTours = [];
  let s = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const p0 = /** @type {number[]} */ (points[i - 1]);
    const p1 = /** @type {number[]} */ (points[i]);
    const p2 = /** @type {number[]} */ (points[i + 1]);
    const ux = (p1[0] ?? 0) - (p0[0] ?? 0);
    const uz = (p1[1] ?? 0) - (p0[1] ?? 0);
    const vx = (p2[0] ?? 0) - (p1[0] ?? 0);
    const vz = (p2[1] ?? 0) - (p1[1] ?? 0);
    s += Math.hypot(ux, uz);
    const L = Math.hypot(ux, uz) * Math.hypot(vx, vz);
    if (L > 0 && (ux * vx + uz * vz) / L < Math.cos((150 * Math.PI) / 180)) demiTours.push(Math.round(s));
  }
  return { troncons, points, rang, longueur: longueurPlane(points), demiTours };
}

/**
 * Rééchantillonne une polyligne [x, y, z] à pas plan régulier (1 m par défaut) en reportant une
 * étiquette entière par point (celle du sommet de départ du segment).
 * @param {number[][]} pts @param {number[]} etiquettes @param {number} pas
 */
export function densifier(pts, etiquettes, pas = 1) {
  /** @type {number[][]} */
  const out = [];
  /** @type {number[]} */
  const lab = [];
  let reste = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const a = /** @type {number[]} */ (pts[i - 1]);
    const b = /** @type {number[]} */ (pts[i]);
    const L = Math.hypot((b[0] ?? 0) - (a[0] ?? 0), (b[1] ?? 0) - (a[1] ?? 0));
    let t = reste;
    while (t < L) {
      const u = L > 0 ? t / L : 0;
      out.push([0, 1, 2].map((k) => (a[k] ?? 0) + ((b[k] ?? 0) - (a[k] ?? 0)) * u));
      lab.push(etiquettes[i - 1] ?? 0);
      t += pas;
    }
    reste = t - L;
  }
  const last = /** @type {number[]} */ (pts[pts.length - 1]);
  out.push([last[0] ?? 0, last[1] ?? 0, last[2] ?? 0]);
  lab.push(etiquettes[pts.length - 1] ?? 0);
  return { points: out, etiquettes: lab };
}

/**
 * Lissage gaussien d'une série (bords répétés, ou périodique si `boucle`), écart type en nombre
 * d'échantillons.
 * @param {number[]} v @param {number} sigma @param {boolean} [boucle]
 */
export function lisserSerie(v, sigma, boucle = false) {
  if (sigma <= 0) return [...v];
  const r = Math.ceil(sigma * 3);
  const w = Array.from({ length: 2 * r + 1 }, (_, k) => Math.exp(-((k - r) ** 2) / (2 * sigma * sigma)));
  const n = v.length;
  // Boucle : série périodique dont le dernier point répète le premier (période n − 1).
  const per = n - 1;
  return v.map((_, i) => {
    let s = 0;
    let ws = 0;
    for (let k = -r; k <= r; k += 1) {
      // Bords : réflexion impaire (2·v0 − v) pour garder les extrémités en place.
      const j = i + k;
      let x;
      if (boucle && per > 0) x = v[((j % per) + per) % per] ?? 0;
      else if (j < 0) x = 2 * (v[0] ?? 0) - (v[-j] ?? v[0] ?? 0);
      else if (j >= n) x = 2 * (v[n - 1] ?? 0) - (v[2 * (n - 1) - j] ?? v[n - 1] ?? 0);
      else x = v[j] ?? 0;
      const wk = w[k + r] ?? 0;
      s += x * wk;
      ws += wk;
    }
    return s / ws;
  });
}

/**
 * Rééchantillonne une polyligne 3D [X, Y, Z] (repère de la carte) à pas constant le long de sa
 * longueur 3D. Le point i est à l'abscisse i × pas ; le dernier point est le dernier pas entier.
 * Rend aussi, pour chaque point produit, l'indice fractionnaire dans la polyligne d'entrée.
 * @param {number[][]} pts @param {number} pas
 */
export function reechantillonner(pts, pas) {
  const cum = [0];
  for (let i = 1; i < pts.length; i += 1) {
    const a = /** @type {number[]} */ (pts[i - 1]);
    const b = /** @type {number[]} */ (pts[i]);
    cum.push((cum[i - 1] ?? 0) + Math.hypot((b[0] ?? 0) - (a[0] ?? 0), (b[1] ?? 0) - (a[1] ?? 0), (b[2] ?? 0) - (a[2] ?? 0)));
  }
  const total = cum[cum.length - 1] ?? 0;
  const n = Math.floor(total / pas + 1e-9) + 1;
  /** @type {number[][]} */
  const out = [];
  /** @type {number[]} */
  const source = [];
  let j = 1;
  for (let i = 0; i < n; i += 1) {
    const s = i * pas;
    while (j < pts.length - 1 && (cum[j] ?? 0) < s) j += 1;
    const s0 = cum[j - 1] ?? 0;
    const s1 = cum[j] ?? 0;
    const u = s1 > s0 ? Math.min(1, Math.max(0, (s - s0) / (s1 - s0))) : 0;
    const a = /** @type {number[]} */ (pts[j - 1]);
    const b = /** @type {number[]} */ (pts[j]);
    out.push([0, 1, 2].map((k) => (a[k] ?? 0) + ((b[k] ?? 0) - (a[k] ?? 0)) * u));
    source.push(j - 1 + u);
  }
  return { points: out, source, longueur: (n - 1) * pas };
}

/**
 * Rééchantillonne une polyligne 3D à corde constante : chaque point est exactement à `pas` mètres
 * (distance 3D) du précédent, même dans une épingle serrée où l'abscisse curviligne et la corde
 * divergent. Rend les points, l'indice fractionnaire de chacun dans la polyligne d'entrée, et le pas.
 * En boucle (le dernier point de l'entrée répète le premier), le pas est ajusté (à 1 % près au
 * plus) pour que le dernier point retombe exactement sur le premier.
 * @param {number[][]} pts @param {number} pas @param {{ boucle?: boolean }} [o]
 */
export function reechantillonnerCorde(pts, pas, o = {}) {
  /** @param {number} h @param {number} [nMax] */
  const marche = (h, nMax = Infinity) => {
    const p0 = /** @type {number[]} */ (pts[0]);
    /** @type {number[][]} */
    const out = [[p0[0] ?? 0, p0[1] ?? 0, p0[2] ?? 0]];
    /** @type {number[]} */
    const source = [0];
    let j = 0;
    let t0 = 0;
    while (out.length - 1 < nMax) {
      const c = /** @type {number[]} */ (out[out.length - 1]);
      let trouve = false;
      for (; j < pts.length - 1; j += 1, t0 = 0) {
        const A = /** @type {number[]} */ (pts[j]);
        const B = /** @type {number[]} */ (pts[j + 1]);
        const D = [0, 1, 2].map((k) => (B[k] ?? 0) - (A[k] ?? 0));
        const E = [0, 1, 2].map((k) => (A[k] ?? 0) - (c[k] ?? 0));
        const a = (D[0] ?? 0) ** 2 + (D[1] ?? 0) ** 2 + (D[2] ?? 0) ** 2;
        const b = 2 * ((E[0] ?? 0) * (D[0] ?? 0) + (E[1] ?? 0) * (D[1] ?? 0) + (E[2] ?? 0) * (D[2] ?? 0));
        const cc = (E[0] ?? 0) ** 2 + (E[1] ?? 0) ** 2 + (E[2] ?? 0) ** 2 - h * h;
        if (a <= 0) continue;
        const disc = b * b - 4 * a * cc;
        if (disc < 0) continue;
        const t = (-b + Math.sqrt(disc)) / (2 * a);
        if (t >= t0 - 1e-12 && t <= 1) {
          out.push([0, 1, 2].map((k) => (A[k] ?? 0) + (D[k] ?? 0) * t));
          source.push(j + t);
          t0 = t;
          trouve = true;
          break;
        }
      }
      if (!trouve) break;
    }
    return { points: out, source };
  };
  if (!o.boucle) return { ...marche(pas), pas };
  // Boucle : n cordes, n = arrondi de la longueur sur le pas ; dichotomie sur le pas pour que la
  // n-ième corde finisse au bout de l'entrée.
  let L = 0;
  for (let i = 1; i < pts.length; i += 1) L += Math.hypot(...[0, 1, 2].map((k) => (pts[i]?.[k] ?? 0) - (pts[i - 1]?.[k] ?? 0)));
  const n = Math.max(3, Math.round(L / pas));
  const fin = pts.length - 1;
  let lo = pas * 0.97;
  let hi = (pas * L) / (n * pas) * 1.03;
  for (let it = 0; it < 60; it += 1) {
    const h = (lo + hi) / 2;
    const m = marche(h, n);
    const pos = m.points.length - 1 < n ? Infinity : (m.source[n] ?? 0);
    if (pos >= fin - 1e-9) hi = h;
    else lo = h;
  }
  const r = marche(hi, n);
  // La dernière corde se termine sur le premier point (à la tolérance de la dichotomie près).
  const p0 = /** @type {number[]} */ (pts[0]);
  if (r.points.length - 1 === n) r.points[n] = [p0[0] ?? 0, p0[1] ?? 0, p0[2] ?? 0];
  else {
    r.points.push([p0[0] ?? 0, p0[1] ?? 0, p0[2] ?? 0]);
    r.source.push(fin);
  }
  return { ...r, pas: hi };
}

/**
 * Rayon de courbure plan (X, Z) en chaque point, par le cercle passant par les points à ±k pas.
 * @param {number[][]} pts @param {number} k
 */
export function rayons(pts, k) {
  return pts.map((_, i) => {
    const a = pts[Math.max(0, i - k)];
    const b = pts[i];
    const c = pts[Math.min(pts.length - 1, i + k)];
    if (!a || !b || !c || a === b || b === c) return Infinity;
    const ux = (b[0] ?? 0) - (a[0] ?? 0);
    const uz = (b[2] ?? 0) - (a[2] ?? 0);
    const vx = (c[0] ?? 0) - (b[0] ?? 0);
    const vz = (c[2] ?? 0) - (b[2] ?? 0);
    const wx = (c[0] ?? 0) - (a[0] ?? 0);
    const wz = (c[2] ?? 0) - (a[2] ?? 0);
    const cross = Math.abs(ux * vz - uz * vx);
    if (cross < 1e-9) return Infinity;
    return (Math.hypot(ux, uz) * Math.hypot(vx, vz) * Math.hypot(wx, wz)) / (2 * cross);
  });
}

/**
 * Pente (dénivelé sur distance plane) en chaque point, sur ±k pas.
 * @param {number[][]} pts @param {number} k
 */
export function pentes(pts, k) {
  return pts.map((_, i) => {
    const a = /** @type {number[]} */ (pts[Math.max(0, i - k)]);
    const c = /** @type {number[]} */ (pts[Math.min(pts.length - 1, i + k)]);
    const d = Math.hypot((c[0] ?? 0) - (a[0] ?? 0), (c[2] ?? 0) - (a[2] ?? 0));
    return d > 0 ? ((c[1] ?? 0) - (a[1] ?? 0)) / d : 0;
  });
}

/**
 * Plus grand écart d'altitude entre deux points successifs, rapporté à la pente moyenne locale :
 * mesure des dents de scie (zéro pour une série lisse).
 * @param {number[][]} pts
 */
export function dentsDeScie(pts) {
  let max = 0;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const y0 = /** @type {number[]} */ (pts[i - 1])[1] ?? 0;
    const y1 = /** @type {number[]} */ (pts[i])[1] ?? 0;
    const y2 = /** @type {number[]} */ (pts[i + 1])[1] ?? 0;
    max = Math.max(max, Math.abs(y1 - (y0 + y2) / 2));
  }
  return max;
}

/**
 * Sections jointives à partir d'une étiquette par point du rail : fusion des points voisins de même
 * valeur, puis absorption des sections plus courtes que `min` mètres (sauf les ouvrages).
 * @template {{ ground: string, urban: boolean, lanes: number, width: number, speed?: number }} V
 * @param {V[]} valeurs une par point du rail
 * @param {number} pas
 * @param {number} min
 * @returns {Array<V & { from: number, to: number }>}
 */
export function sections(valeurs, pas, min) {
  /** @param {V} a @param {V} b */
  const egal = (a, b) => a.ground === b.ground && a.urban === b.urban && a.lanes === b.lanes && a.width === b.width && (a.speed ?? 0) === (b.speed ?? 0);
  /** @type {Array<V & { from: number, to: number }>} */
  let out = [];
  valeurs.forEach((v, i) => {
    const last = out[out.length - 1];
    if (last && egal(last, v)) last.to = i * pas;
    else {
      if (last) last.to = i * pas;
      out.push({ ...v, from: i * pas, to: i * pas });
    }
  });
  // Absorption des sections trop courtes (hors pont et tunnel) par la voisine la plus longue.
  for (let guard = 0; guard < 1000; guard += 1) {
    const i = out.findIndex((s) => s.to - s.from < min && s.ground === 'sol' && out.length > 1);
    if (i < 0) break;
    const s = /** @type {V & { from: number, to: number }} */ (out[i]);
    const prev = out[i - 1];
    const next = out[i + 1];
    const cible = !prev ? next : !next ? prev : prev.to - prev.from >= next.to - next.from ? prev : next;
    if (!cible) break;
    if (cible === prev) prev.to = s.to;
    else if (next) next.from = s.from;
    out.splice(i, 1);
    // Refusion des voisines devenues égales.
    out = out.reduce((/** @type {Array<V & { from: number, to: number }>} */ acc, x) => {
      const l = acc[acc.length - 1];
      if (l && egal(l, x)) l.to = x.to;
      else acc.push(x);
      return acc;
    }, []);
  }
  return out;
}

/**
 * Découpe le rail en tronçons de décor de longueur voisine de `cible` mètres : bornes en indices de
 * points, le dernier point d'un tronçon est le premier du suivant.
 * @param {number} nPoints @param {number} pas @param {number} cible
 * @returns {Array<[number, number]>}
 */
export function decouper(nPoints, pas, cible) {
  const longueur = (nPoints - 1) * pas;
  const n = Math.max(1, Math.round(longueur / cible));
  /** @type {Array<[number, number]>} */
  const out = [];
  for (let c = 0; c < n; c += 1) {
    const i0 = Math.round((c * (nPoints - 1)) / n);
    const i1 = Math.round(((c + 1) * (nPoints - 1)) / n);
    out.push([i0, i1]);
  }
  return out;
}
