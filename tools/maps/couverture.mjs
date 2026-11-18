// @ts-check
// Chaussée couverte : un point de la chaussée, hors tunnel déclaré, au-dessus duquel passe de la
// géométrie de la carte (terrain, bâtiment, ouvrage, glissière, une autre portion de route, relief
// lointain) à plus de `tolerance` mètres. Le véhicule y roulerait dans le décor et aucune caméra ne le
// verrait. Mesuré par la fabrication (tools/maps/build.mjs, maillages en mémoire) et par le contrôle
// (tools/maps/check.mjs, tronçons écrits) : même fonction, mêmes points de chaussée.

/** Écart toléré entre la chaussée et ce qui passe au-dessus (bombement, marquage, bordures). */
export const TOLERANCE_COUVERTURE = 0.25;

/**
 * Index en grille des triangles non verticaux d'un ensemble de maillages (plan X, Z).
 * @param {Array<{ role: string, positions: ArrayLike<number>, index: ArrayLike<number> | null }>} maillages positions dans le repère de la carte
 * @param {number} cellule
 */
function indexTriangles(maillages, cellule) {
  /** @type {number[]} */
  const T = []; // x0 y0 z0 x1 y1 z1 x2 y2 z2 par triangle
  /** @type {string[]} */
  const roles = [];
  /** @type {Map<number, number[]>} */
  const cases = new Map();
  const cle = (/** @type {number} */ a, /** @type {number} */ b) => (a + 32768) * 65536 + (b + 32768);
  for (const m of maillages) {
    const p = m.positions;
    const n = m.index ? m.index.length : p.length / 3;
    for (let t = 0; t + 2 < n; t += 3) {
      const ia = m.index ? (m.index[t] ?? 0) : t;
      const ib = m.index ? (m.index[t + 1] ?? 0) : t + 1;
      const ic = m.index ? (m.index[t + 2] ?? 0) : t + 2;
      const v = [ia, ib, ic].flatMap((k) => [p[k * 3] ?? 0, p[k * 3 + 1] ?? 0, p[k * 3 + 2] ?? 0]);
      const [x0, , z0, x1, , z1, x2, , z2] = /** @type {number[]} */ (v);
      const aire2 = ((x1 ?? 0) - (x0 ?? 0)) * ((z2 ?? 0) - (z0 ?? 0)) - ((x2 ?? 0) - (x0 ?? 0)) * ((z1 ?? 0) - (z0 ?? 0));
      if (Math.abs(aire2) < 1e-6) continue; // mur, face verticale
      const id = roles.length;
      roles.push(m.role);
      T.push(...v);
      const a0 = Math.floor(Math.min(x0 ?? 0, x1 ?? 0, x2 ?? 0) / cellule);
      const a1 = Math.floor(Math.max(x0 ?? 0, x1 ?? 0, x2 ?? 0) / cellule);
      const b0 = Math.floor(Math.min(z0 ?? 0, z1 ?? 0, z2 ?? 0) / cellule);
      const b1 = Math.floor(Math.max(z0 ?? 0, z1 ?? 0, z2 ?? 0) / cellule);
      for (let a = a0; a <= a1; a += 1)
        for (let b = b0; b <= b1; b += 1) {
          const k = cle(a, b);
          const l = cases.get(k);
          if (l) l.push(id);
          else cases.set(k, [id]);
        }
    }
  }
  return {
    /**
     * Triangles qui couvrent (x, z), avec leur hauteur en ce point.
     * @param {number} x @param {number} z @param {(role: string, y: number) => void} f
     */
    au(x, z, f) {
      for (const id of cases.get(cle(Math.floor(x / cellule), Math.floor(z / cellule))) ?? []) {
        const o = id * 9;
        const x0 = T[o] ?? 0;
        const z0 = T[o + 2] ?? 0;
        const x1 = T[o + 3] ?? 0;
        const z1 = T[o + 5] ?? 0;
        const x2 = T[o + 6] ?? 0;
        const z2 = T[o + 8] ?? 0;
        const d = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
        const l0 = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / d;
        const l1 = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / d;
        const l2 = 1 - l0 - l1;
        if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
        f(/** @type {string} */ (roles[id]), l0 * (T[o + 1] ?? 0) + l1 * (T[o + 4] ?? 0) + l2 * (T[o + 7] ?? 0));
      }
    },
  };
}

/**
 * Points de la chaussée couverts. Chaque point du rail hors tunnel, en cinq points en travers (axe,
 * mi-voies, à 0,3 m des bords) : hauteur de la chaussée (bombée de 6 cm à l'axe) contre celle de tout
 * triangle non vertical qui passe au-dessus.
 * @param {{ rail: number[], step: number, loop: boolean, sections: Array<{ from: number, to: number, ground: string, width: number }> }} route
 * @param {Array<{ role: string, positions: ArrayLike<number>, index: ArrayLike<number> | null }>} maillages tronçons, repère de la carte
 * @param {Array<{ role: string, positions: ArrayLike<number>, index: ArrayLike<number> | null }>} [lointain] relief lointain, repère de la carte
 * @param {{ tolerance?: number }} [o]
 * @returns {{ points: number, couverts: Array<{ s: number, u: number, role: string, dy: number }> }}
 */
export function chausseeCouverte(route, maillages, lointain = [], o = {}) {
  const tol = o.tolerance ?? TOLERANCE_COUVERTURE;
  const proche = indexTriangles(maillages, 8);
  const loin = indexTriangles(lointain, 150);
  const r = route.rail;
  const N = r.length / 3;
  const per = N - 1;
  /** @type {Array<{ s: number, u: number, role: string, dy: number }>} */
  const couverts = [];
  let points = 0;
  let sec = 0;
  for (let i = 0; i < N - (route.loop ? 1 : 0); i += 1) {
    const s = i * route.step;
    while (sec < route.sections.length - 1 && s > (route.sections[sec]?.to ?? Infinity)) sec += 1;
    const se = route.sections[sec];
    if (!se || se.ground === 'tunnel') continue;
    const a = route.loop ? (((i - 2) % per) + per) % per : Math.max(0, i - 2);
    const b = route.loop ? (i + 2) % per : Math.min(N - 1, i + 2);
    const tx = (r[b * 3] ?? 0) - (r[a * 3] ?? 0);
    const tz = (r[b * 3 + 2] ?? 0) - (r[a * 3 + 2] ?? 0);
    const L = Math.hypot(tx, tz) || 1;
    const nx = -tz / L;
    const nz = tx / L;
    const hw = se.width / 2;
    for (const f of [-1, -0.5, 0, 0.5, 1]) {
      const u = f * Math.max(0, hw - 0.3);
      const x = (r[i * 3] ?? 0) + nx * u;
      const z = (r[i * 3 + 2] ?? 0) + nz * u;
      const y = (r[i * 3 + 1] ?? 0) + 0.06 * (1 - Math.min(1, Math.abs(u) / hw));
      points += 1;
      let pire = { role: '', dy: tol };
      const voir = (/** @type {string} */ role, /** @type {number} */ h) => {
        if (h - y > pire.dy) pire = { role, dy: h - y };
      };
      proche.au(x, z, voir);
      loin.au(x, z, (_, h) => voir('lointain', h));
      if (pire.role) couverts.push({ s, u: Math.round(u * 10) / 10, role: pire.role, dy: Math.round(pire.dy * 100) / 100 });
    }
  }
  return { points, couverts };
}

/** Écart toléré entre la surface roulée et le sol qui affleure au-dessus (« flaques d'herbe »), m. */
export const TOLERANCE_SOL = 0.01;
/** Sous la voûte d'un tunnel (6 m au-dessus de l'axe, recouverte de terrain à 7,2 m), aucun sol à moins de cette hauteur au-dessus de la surface roulée, m. */
export const PLAFOND_TUNNEL = 6.5;
/** Rôles de la surface roulée (chaussée, marquage, voies, trottoirs et bas-côtés). */
const ROLES_ROULES = new Set(['chaussee', 'marquage', 'voie', 'accotement']);
/** Rôles de sol qui ne doivent jamais affleurer sur la surface roulée (l'herbe, l'eau, le relief lointain). */
const ROLES_SOL = new Set(['terrain', 'eau', 'lointain']);

/**
 * Sol au-dessus de la surface roulée (défaut vu le 18 novembre 2026 : l'herbe du terrain traverse la
 * chaussée à l'entrée d'un tunnel, et affleure par plaques sur la route). Le rail est parcouru tous
 * les `pas` mètres, tunnels et ponts compris ; en chaque point, la chaussée et ses bas-côtés (trottoir
 * en agglomération) sont balayés en travers tous les `pasTravers` mètres, jusqu'à 10 cm de leur bord.
 * Hauteur de la surface roulée : celle des maillages (chaussée, marquage, voies, accotements) au
 * niveau du rail (une autre passe du parcours, au-dessus ou dessous, ne compte pas). Faute : un
 * triangle de terrain, d'eau ou du relief lointain plus haut que la surface roulée de plus de
 * `tolerance` ; dans un tunnel, seulement sous le plafond (le terrain qui recouvre la voûte est à sa
 * place).
 * @param {{ rail: number[], step: number, loop: boolean, length: number, sections: Array<{ from: number, to: number, ground: string, width: number, urban?: boolean }> }} route
 * @param {Array<{ role: string, positions: ArrayLike<number>, index: ArrayLike<number> | null }>} maillages tronçons, repère de la carte
 * @param {Array<{ role: string, positions: ArrayLike<number>, index: ArrayLike<number> | null }>} [lointain] relief lointain, repère de la carte
 * @param {{ pas?: number, pasTravers?: number, tolerance?: number }} [o]
 * @returns {{ points: number, fautes: Array<{ s: number, u: number, role: string, dy: number, ground: string, bord: boolean }> }}
 */
export function solSurChaussee(route, maillages, lointain = [], o = {}) {
  const pas = o.pas ?? 1;
  const pasT = o.pasTravers ?? 0.5;
  const tol = o.tolerance ?? TOLERANCE_SOL;
  // Seuls les rôles roulés et les sols comptent : le bâti n'entre pas dans l'index. L'eau (carreaux de
  // 100 m, repris dans chaque tronçon proche) va avec le relief lointain, en grandes cases.
  const proche = indexTriangles(maillages.filter((m) => ROLES_ROULES.has(m.role) || (m.role !== 'eau' && ROLES_SOL.has(m.role))), 6);
  const loin = indexTriangles([...lointain.map((m) => ({ ...m, role: 'lointain' })), ...maillages.filter((m) => m.role === 'eau')], 150);
  const r = route.rail;
  const N = r.length / 3;
  const per = N - 1;
  const fin = route.length - (route.loop ? 1e-6 : 0.01);
  /** @type {Array<{ s: number, u: number, role: string, dy: number, ground: string, bord: boolean }>} */
  const fautes = [];
  let points = 0;
  let sec = 0;
  for (let s = 0; s <= fin; s += pas) {
    while (sec < route.sections.length - 1 && s > (route.sections[sec]?.to ?? Infinity)) sec += 1;
    const se = route.sections[sec];
    if (!se) continue;
    // Point du rail (interpolé) et normale à droite (X est, Z sud : droite = (−tz, tx)).
    const f = Math.min(per - 1e-9, s / route.step);
    const i = Math.floor(f);
    const t = f - i;
    const P = (/** @type {number} */ k, /** @type {number} */ c) => r[k * 3 + c] ?? 0;
    const a = route.loop ? (((i - 2) % per) + per) % per : Math.max(0, i - 2);
    const b = route.loop ? (i + 3) % per : Math.min(N - 1, i + 3);
    const tx = P(b, 0) - P(a, 0);
    const tz = P(b, 2) - P(a, 2);
    const L = Math.hypot(tx, tz) || 1;
    const nx = -tz / L;
    const nz = tx / L;
    const x0 = P(i, 0) + (P(i + 1, 0) - P(i, 0)) * t;
    const y0 = P(i, 1) + (P(i + 1, 1) - P(i, 1)) * t;
    const z0 = P(i, 2) + (P(i + 1, 2) - P(i, 2)) * t;
    const hw = se.width / 2;
    const e = hw + (se.urban ? 2.2 : 1.0) - 0.1;
    const nU = Math.ceil((2 * e) / pasT);
    for (let k = 0; k <= nU; k += 1) {
      const u = -e + (2 * e * k) / nU;
      const x = x0 + nx * u;
      const z = z0 + nz * u;
      // Surface roulée au niveau du rail (entre 1,5 m dessous et 1 m dessus).
      let ys = -Infinity;
      proche.au(x, z, (role, h) => {
        if (ROLES_ROULES.has(role) && h > y0 - 1.5 && h < y0 + 1 && h > ys) ys = h;
      });
      if (ys === -Infinity) continue; // hors de l'emprise dessinée (continuite.mjs dit les trous)
      points += 1;
      let pire = { role: '', dy: tol };
      const voir = (/** @type {string} */ role, /** @type {number} */ h) => {
        if (!ROLES_SOL.has(role)) return;
        const dy = h - ys;
        if (se.ground === 'tunnel' && dy >= PLAFOND_TUNNEL) return;
        if (dy > pire.dy) pire = { role, dy };
      };
      proche.au(x, z, voir);
      loin.au(x, z, voir);
      if (pire.role)
        fautes.push({ s: Math.round(s * 10) / 10, u: Math.round(u * 10) / 10, role: pire.role, dy: Math.round(pire.dy * 1000) / 1000, ground: se.ground, bord: Math.abs(u) > hw });
    }
  }
  return { points, fautes };
}

/**
 * Résumé du sol au-dessus de la surface roulée : points par rôle et par sol (sol, pont, tunnel), sur
 * la chaussée ou ses bas-côtés, zones (à 10 m près) et écart maximal.
 * @param {Array<{ s: number, role: string, dy: number, ground: string, bord: boolean }>} fautes
 */
export function resumerSolSurChaussee(fautes) {
  /** @type {Record<string, number>} */
  const parRole = {};
  /** @type {Record<string, number>} */
  const parSol = {};
  /** @type {Set<number>} */
  const zones = new Set();
  let dyMax = 0;
  let bord = 0;
  for (const c of fautes) {
    parRole[c.role] = (parRole[c.role] ?? 0) + 1;
    parSol[c.ground] = (parSol[c.ground] ?? 0) + 1;
    if (c.bord) bord += 1;
    zones.add(Math.round(c.s / 10) * 10);
    dyMax = Math.max(dyMax, c.dy);
  }
  return { parRole, parSol, bord, chaussee: fautes.length - bord, zones: [...zones].sort((a, b) => a - b), dyMax };
}

/**
 * Résumé lisible : nombre de points par rôle et abscisses (à 10 m près) des zones couvertes.
 * @param {Array<{ s: number, role: string, dy: number }>} couverts
 */
export function resumerCouverture(couverts) {
  /** @type {Record<string, number>} */
  const parRole = {};
  /** @type {Set<number>} */
  const zones = new Set();
  let dyMax = 0;
  for (const c of couverts) {
    parRole[c.role] = (parRole[c.role] ?? 0) + 1;
    zones.add(Math.round(c.s / 10) * 10);
    dyMax = Math.max(dyMax, c.dy);
  }
  return { parRole, zones: [...zones].sort((a, b) => a - b), dyMax };
}

/**
 * Garde de la fabrication : l'emprise protégée (chaussée et trottoirs de toutes les passes du
 * parcours, hors tunnel) en triangles, rangés en grille. Un triangle de décor qui passe au-dessus de
 * l'un d'eux de plus de `tol` mètres est refusé : test exact, par découpe du triangle de décor par le
 * triangle protégé (les deux sont plans, l'écart de hauteur est maximal en un sommet de la découpe).
 * @param {number[]} tris x, y, z des trois sommets de chaque triangle protégé (9 nombres par triangle)
 * @param {number} [cellule]
 */
export function gardeChaussee(tris, cellule = 4) {
  /** @type {Map<number, number[]>} */
  const cases = new Map();
  const cle = (/** @type {number} */ a, /** @type {number} */ b) => (a + 32768) * 65536 + (b + 32768);
  const nt = Math.floor(tris.length / 9);
  for (let t = 0; t < nt; t += 1) {
    const o = t * 9;
    const xs = [tris[o] ?? 0, tris[o + 3] ?? 0, tris[o + 6] ?? 0];
    const zs = [tris[o + 2] ?? 0, tris[o + 5] ?? 0, tris[o + 8] ?? 0];
    for (let a = Math.floor(Math.min(...xs) / cellule); a <= Math.floor(Math.max(...xs) / cellule); a += 1)
      for (let b = Math.floor(Math.min(...zs) / cellule); b <= Math.floor(Math.max(...zs) / cellule); b += 1) {
        const k = cle(a, b);
        const l = cases.get(k);
        if (l) l.push(t);
        else cases.set(k, [t]);
      }
  }
  const vu = new Int32Array(nt).fill(-1);
  let tour = 0;
  /** Hauteur du plan d'un triangle (9 nombres à partir de o) en (x, z). @param {ArrayLike<number>} T @param {number} o @param {number} x @param {number} z */
  const plan = (T, o, x, z) => {
    const ax = T[o] ?? 0, ay = T[o + 1] ?? 0, az = T[o + 2] ?? 0;
    const bx = T[o + 3] ?? 0, by = T[o + 4] ?? 0, bz = T[o + 5] ?? 0;
    const cx = T[o + 6] ?? 0, cy = T[o + 7] ?? 0, cz = T[o + 8] ?? 0;
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    const l0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
    const l1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
    return l0 * ay + l1 * by + (1 - l0 - l1) * cy;
  };
  return {
    /**
     * Hauteur de l'emprise protégée en (x, z) (la plus haute de ses nappes), ou −Infinity hors d'elle.
     * @param {number} x @param {number} z
     */
    hauteur(x, z) {
      let h = -Infinity;
      for (const t of cases.get(cle(Math.floor(x / cellule), Math.floor(z / cellule))) ?? []) {
        const o = t * 9;
        const x0 = tris[o] ?? 0, z0 = tris[o + 2] ?? 0, x1 = tris[o + 3] ?? 0, z1 = tris[o + 5] ?? 0, x2 = tris[o + 6] ?? 0, z2 = tris[o + 8] ?? 0;
        const d = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
        if (Math.abs(d) < 1e-9) continue;
        const l0 = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / d;
        const l1 = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / d;
        const l2 = 1 - l0 - l1;
        if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
        h = Math.max(h, l0 * (tris[o + 1] ?? 0) + l1 * (tris[o + 4] ?? 0) + l2 * (tris[o + 7] ?? 0));
      }
      return h;
    },
    /**
     * Le triangle (x, y, z) × 3 passe-t-il au-dessus de l'emprise protégée de plus de `tol` mètres ?
     * Avec un `plafond` (sous la voûte d'un tunnel) : passe-t-il entre `tol` et `plafond` mètres
     * au-dessus d'elle (le terrain qui recouvre la voûte reste) ; une découpe sans aire (le triangle
     * touche l'emprise par un bord) ne compte pas.
     * @param {number[]} a @param {number[]} b @param {number[]} c @param {number} tol @param {number} [plafond]
     */
    couvre(a, b, c, tol, plafond = Infinity) {
      const D = [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0, b[0] ?? 0, b[1] ?? 0, b[2] ?? 0, c[0] ?? 0, c[1] ?? 0, c[2] ?? 0];
      const det = ((D[5] ?? 0) - (D[8] ?? 0)) * ((D[0] ?? 0) - (D[6] ?? 0)) + ((D[6] ?? 0) - (D[3] ?? 0)) * ((D[2] ?? 0) - (D[8] ?? 0));
      if (Math.abs(det) < 1e-9) return false; // face verticale
      const xs = [D[0] ?? 0, D[3] ?? 0, D[6] ?? 0];
      const zs = [D[2] ?? 0, D[5] ?? 0, D[8] ?? 0];
      const bx0 = Math.min(...xs), bx1 = Math.max(...xs), bz0 = Math.min(...zs), bz1 = Math.max(...zs);
      tour += 1;
      for (let i = Math.floor(bx0 / cellule); i <= Math.floor(bx1 / cellule); i += 1)
        for (let j = Math.floor(bz0 / cellule); j <= Math.floor(bz1 / cellule); j += 1)
          for (const t of cases.get(cle(i, j)) ?? []) {
            if (vu[t] === tour) continue;
            vu[t] = tour;
            const o = t * 9;
            const P = [
              [tris[o] ?? 0, tris[o + 2] ?? 0],
              [tris[o + 3] ?? 0, tris[o + 5] ?? 0],
              [tris[o + 6] ?? 0, tris[o + 8] ?? 0],
            ];
            if (Math.max(...P.map((p) => p[0] ?? 0)) < bx0 || Math.min(...P.map((p) => p[0] ?? 0)) > bx1) continue;
            if (Math.max(...P.map((p) => p[1] ?? 0)) < bz0 || Math.min(...P.map((p) => p[1] ?? 0)) > bz1) continue;
            const aireP = ((P[1]?.[0] ?? 0) - (P[0]?.[0] ?? 0)) * ((P[2]?.[1] ?? 0) - (P[0]?.[1] ?? 0)) - ((P[2]?.[0] ?? 0) - (P[0]?.[0] ?? 0)) * ((P[1]?.[1] ?? 0) - (P[0]?.[1] ?? 0));
            if (Math.abs(aireP) < 1e-9) continue;
            // Découpe (Sutherland-Hodgman) du triangle de décor par le triangle protégé, convexe.
            /** @type {number[][]} */
            let poly = [
              [xs[0] ?? 0, zs[0] ?? 0],
              [xs[1] ?? 0, zs[1] ?? 0],
              [xs[2] ?? 0, zs[2] ?? 0],
            ];
            const sens = Math.sign(aireP);
            for (let e = 0; e < 3 && poly.length; e += 1) {
              const p0 = /** @type {number[]} */ (P[e]);
              const p1 = /** @type {number[]} */ (P[(e + 1) % 3]);
              const ex = (p1[0] ?? 0) - (p0[0] ?? 0);
              const ez = (p1[1] ?? 0) - (p0[1] ?? 0);
              const cote = (/** @type {number[]} */ q) => sens * (ex * ((q[1] ?? 0) - (p0[1] ?? 0)) - ez * ((q[0] ?? 0) - (p0[0] ?? 0)));
              const entree = poly;
              poly = [];
              for (let k = 0; k < entree.length; k += 1) {
                const q0 = /** @type {number[]} */ (entree[(k + entree.length - 1) % entree.length]);
                const q1 = /** @type {number[]} */ (entree[k]);
                const c0 = cote(q0);
                const c1 = cote(q1);
                if (c1 >= 0) {
                  if (c0 < 0) poly.push([(q0[0] ?? 0) + ((q1[0] ?? 0) - (q0[0] ?? 0)) * (c0 / (c0 - c1)), (q0[1] ?? 0) + ((q1[1] ?? 0) - (q0[1] ?? 0)) * (c0 / (c0 - c1))]);
                  poly.push(q1);
                } else if (c0 >= 0) poly.push([(q0[0] ?? 0) + ((q1[0] ?? 0) - (q0[0] ?? 0)) * (c0 / (c0 - c1)), (q0[1] ?? 0) + ((q1[1] ?? 0) - (q0[1] ?? 0)) * (c0 / (c0 - c1))]);
              }
            }
            if (poly.length < 3) continue;
            if (plafond === Infinity) {
              for (const q of poly) if (plan(D, 0, q[0] ?? 0, q[1] ?? 0) > plan(tris, o, q[0] ?? 0, q[1] ?? 0) + tol) return true;
              continue;
            }
            // Sous un plafond : l'écart (plan contre plan) est affine sur la découpe, convexe ; il
            // parcourt [min, max] de ses valeurs aux sommets. Faute si cet intervalle mord ]tol, plafond[.
            let aireD = 0;
            for (let k = 0; k < poly.length; k += 1) {
              const q0 = /** @type {number[]} */ (poly[k]);
              const q1 = /** @type {number[]} */ (poly[(k + 1) % poly.length]);
              aireD += (q0[0] ?? 0) * (q1[1] ?? 0) - (q1[0] ?? 0) * (q0[1] ?? 0);
            }
            if (Math.abs(aireD) < 2e-3) continue;
            let dMin = Infinity;
            let dMax = -Infinity;
            for (const q of poly) {
              const dd = plan(D, 0, q[0] ?? 0, q[1] ?? 0) - plan(tris, o, q[0] ?? 0, q[1] ?? 0);
              dMin = Math.min(dMin, dd);
              dMax = Math.max(dMax, dd);
            }
            if (dMax > tol && dMin < plafond) return true;
          }
      return false;
    },
  };
}
