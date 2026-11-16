// @ts-check
// Continuité et largeur de la chaussée dessinée, mesurées sur les maillages (pas sur l'intention) :
// le rail est parcouru tous les `pas` mètres (50 cm), et en chaque point des rayons vers le bas, sur
// l'axe et à ±0,8 m (les roues d'une voiture), cherchent la chaussée : un triangle du rôle
// « chaussee », vu d'en haut (une face retournée n'est pas dessinée : c'est un trou à l'écran), au
// niveau du rail (une autre passe du parcours, sur un pont ou dessous, ne compte pas). Fautes :
// « trou » (rien sous la roue), « retournee » (seulement une face vue de dessous), « marche » (la
// chaussée saute de plus de `marche` mètres d'un point au suivant, pente du rail retirée, ou deux
// nappes à des hauteurs différentes au même point). En travers, tous les mètres, un balayage au
// décimètre donne les bords de la chaussée continue de part et d'autre du rail : largeur dessinée
// et écart entre le rail et le milieu de la chaussée.
// Mesuré par la fabrication (tools/maps/build.mjs, maillages en mémoire) et par le contrôle
// (tools/maps/check.mjs, tronçons écrits) : même fonction.

/** Faute tolérée : aucune. Hauteur d'une marche, m. */
export const MARCHE_MAX = 0.03;
/** Roues : décalages des rayons vers le bas, m (axe et ±0,8 m). */
export const ROUES = [-0.8, 0, 0.8];
/** Largeur minimale de la chaussée (deux fois 2,26 m, le véhicule le plus large rétroviseurs compris, arrondi). */
export const LARGEUR_MIN = 5;
/** Largeur minimale quand la donnée annonce deux voies ou plus. */
export const LARGEUR_MIN_DEUX_VOIES = 6;
/** Écart maximal entre le rail et le milieu de la chaussée dessinée, m. */
export const ECART_AXE_MAX = 0.5;

/**
 * Index en grille des triangles de chaussée (plan X, Z), avec leur sens vu d'en haut.
 * @param {Array<{ role: string, positions: ArrayLike<number>, index: ArrayLike<number> | null }>} maillages
 * @param {number} cellule
 */
function indexChaussee(maillages, cellule) {
  /** @type {number[]} */
  const T = [];
  /** @type {number[]} */
  const dessus = [];
  /** @type {Map<number, number[]>} */
  const cases = new Map();
  const cle = (/** @type {number} */ a, /** @type {number} */ b) => (a + 32768) * 65536 + (b + 32768);
  for (const m of maillages) {
    if (m.role !== 'chaussee') continue;
    const p = m.positions;
    const n = m.index ? m.index.length : p.length / 3;
    for (let t = 0; t + 2 < n; t += 3) {
      const ia = m.index ? (m.index[t] ?? 0) : t;
      const ib = m.index ? (m.index[t + 1] ?? 0) : t + 1;
      const ic = m.index ? (m.index[t + 2] ?? 0) : t + 2;
      const v = [ia, ib, ic].flatMap((k) => [p[k * 3] ?? 0, p[k * 3 + 1] ?? 0, p[k * 3 + 2] ?? 0]);
      const [x0 = 0, , z0 = 0, x1 = 0, , z1 = 0, x2 = 0, , z2 = 0] = v;
      // Normale (b − a) × (c − a) : composante Y = (z1 − z0)(x2 − x0) − (x1 − x0)(z2 − z0) ; > 0 : face vue d'en haut.
      const ny = (z1 - z0) * (x2 - x0) - (x1 - x0) * (z2 - z0);
      if (Math.abs(ny) < 1e-9) continue;
      const id = dessus.length;
      dessus.push(ny > 0 ? 1 : 0);
      T.push(...v);
      for (let a = Math.floor(Math.min(x0, x1, x2) / cellule); a <= Math.floor(Math.max(x0, x1, x2) / cellule); a += 1)
        for (let b = Math.floor(Math.min(z0, z1, z2) / cellule); b <= Math.floor(Math.max(z0, z1, z2) / cellule); b += 1) {
          const k = cle(a, b);
          const l = cases.get(k);
          if (l) l.push(id);
          else cases.set(k, [id]);
        }
    }
  }
  return {
    triangles: dessus.length,
    retournes: dessus.filter((d) => !d).length,
    /**
     * Triangles de chaussée sous (x, z) : hauteur et sens.
     * @param {number} x @param {number} z @param {(y: number, dessus: boolean) => void} f
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
        if (l0 < -1e-7 || l1 < -1e-7 || l2 < -1e-7) continue;
        f(l0 * (T[o + 1] ?? 0) + l1 * (T[o + 4] ?? 0) + l2 * (T[o + 7] ?? 0), dessus[id] === 1);
      }
    },
  };
}

/**
 * Point du rail à l'abscisse s : position et normale à droite (X est, Z sud : droite = (−tz, tx)).
 * @param {{ rail: ArrayLike<number>, step: number, loop: boolean }} route @param {number} s
 */
export function pointRail(route, s) {
  const r = route.rail;
  const N = r.length / 3;
  const per = N - 1;
  const f = Math.max(0, Math.min(per - 1e-9, s / route.step));
  const i = Math.floor(f);
  const t = f - i;
  const P = (/** @type {number} */ k, /** @type {number} */ c) => r[k * 3 + c] ?? 0;
  const tangente = (/** @type {number} */ k) => {
    const a = route.loop ? (((k - 2) % per) + per) % per : Math.max(0, k - 2);
    const b = route.loop ? (k + 2) % per : Math.min(N - 1, k + 2);
    const tx = P(b, 0) - P(a, 0);
    const tz = P(b, 2) - P(a, 2);
    const L = Math.hypot(tx, tz) || 1;
    return [tx / L, tz / L];
  };
  const ta = tangente(i);
  const tb = tangente(Math.min(N - 1, i + 1));
  let tx = (ta[0] ?? 0) * (1 - t) + (tb[0] ?? 0) * t;
  let tz = (ta[1] ?? 0) * (1 - t) + (tb[1] ?? 0) * t;
  const L = Math.hypot(tx, tz) || 1;
  tx /= L;
  tz /= L;
  const j = Math.min(N - 1, i + 1);
  return {
    x: P(i, 0) + (P(j, 0) - P(i, 0)) * t,
    y: P(i, 1) + (P(j, 1) - P(i, 1)) * t,
    z: P(i, 2) + (P(j, 2) - P(i, 2)) * t,
    nx: -tz,
    nz: tx,
  };
}

/**
 * Continuité de la chaussée sous les roues, largeur dessinée et écart à l'axe.
 * @param {{ rail: number[], step: number, loop: boolean, length: number, sections: Array<{ from: number, to: number, ground: string, width: number, lanes: number }> }} route
 * @param {Array<{ role: string, positions: ArrayLike<number>, index: ArrayLike<number> | null }>} maillages tronçons, repère de la carte
 * @param {{ pas?: number, pasTravers?: number }} [o]
 */
export function continuiteChaussee(route, maillages, o = {}) {
  const pas = o.pas ?? 0.5;
  const pasT = o.pasTravers ?? 1;
  const idx = indexChaussee(maillages, 6);
  // Le bout du parcours (sans boucle) : le dernier point est pris un centimètre avant le bord du ruban.
  const fin = route.length - (route.loop ? 1e-6 : 0.01);
  /** @type {Array<{ s: number, u: number, faute: 'trou' | 'retournee' | 'marche', dy?: number }>} */
  const fautes = [];
  /** Hauteur de la chaussée vue d'en haut au niveau du rail en (x, z), ou un code de faute. @param {number} x @param {number} z @param {number} y */
  const sonder = (x, z, y) => {
    /** @type {number[]} */
    const vus = [];
    let dessous = false;
    idx.au(x, z, (h, d) => {
      if (Math.abs(h - y) > 1.2) return; // autre passe du parcours
      if (d) vus.push(h);
      else dessous = true;
    });
    if (vus.length === 0) return dessous ? 'retournee' : 'trou';
    vus.sort((a, b) => a - b);
    return vus;
  };
  /** @type {number[]} */
  const prec = ROUES.map(() => NaN);
  let points = 0;
  for (let s = 0; s <= fin + 1e-9; s += pas) {
    const p = pointRail(route, s);
    points += 1;
    ROUES.forEach((u, k) => {
      const v = sonder(p.x + p.nx * u, p.z + p.nz * u, p.y);
      if (typeof v === 'string') {
        fautes.push({ s: Math.round(s * 10) / 10, u, faute: v });
        prec[k] = NaN;
        return;
      }
      const haut = /** @type {number} */ (v[v.length - 1]);
      const bas = /** @type {number} */ (v[0]);
      const r = haut - p.y;
      const saut = Number.isNaN(prec[k] ?? NaN) ? 0 : Math.abs(r - (prec[k] ?? 0));
      const nappes = haut - bas;
      if (saut > MARCHE_MAX || nappes > MARCHE_MAX) fautes.push({ s: Math.round(s * 10) / 10, u, faute: 'marche', dy: Math.round(Math.max(saut, nappes) * 1000) / 1000 });
      prec[k] = r;
    });
  }
  // En travers : bords de la chaussée continue de part et d'autre du rail, tous les `pasT` mètres.
  /** @type {Array<{ s: number, gauche: number, droite: number, declaree: number, lanes: number }>} */
  const travers = [];
  let sec = 0;
  for (let s = 0; s <= fin + 1e-9; s += pasT) {
    while (sec < route.sections.length - 1 && s > (route.sections[sec]?.to ?? Infinity)) sec += 1;
    const se = route.sections[sec];
    const p = pointRail(route, s);
    const bord = (/** @type {number} */ cote) => {
      let u = 0;
      let trous = 0;
      let dernier = 0;
      for (let k = 0; k < 300; k += 1) {
        const v = sonder(p.x + p.nx * cote * u, p.z + p.nz * cote * u, p.y);
        if (typeof v === 'string') {
          trous += 1;
          if (trous > 1) break;
        } else {
          trous = 0;
          dernier = u;
        }
        u += 0.1;
      }
      // Bord affiné par dichotomie entre le dernier point dedans et le suivant (au millimètre près).
      let a = dernier;
      let b = dernier + 0.1;
      for (let k = 0; k < 7; k += 1) {
        const m = (a + b) / 2;
        if (typeof sonder(p.x + p.nx * cote * m, p.z + p.nz * cote * m, p.y) === 'string') b = m;
        else a = m;
      }
      return a;
    };
    travers.push({ s, gauche: bord(-1), droite: bord(1), declaree: se?.width ?? 0, lanes: se?.lanes ?? 0 });
  }
  return { points, fautes, travers, triangles: idx.triangles, retournes: idx.retournes };
}

/**
 * Erreurs bloquantes (tools/maps/check.mjs) : faute sous les roues, chaussée sous 5 m (6 m à deux
 * voies), côté du rail plus étroit que la moitié de la largeur déclarée, rail à plus de 0,5 m du
 * milieu de la chaussée.
 * @param {ReturnType<typeof continuiteChaussee>} c
 */
export function erreursContinuite(c) {
  const z = resumerContinuite(c);
  /** @type {string[]} */
  const e = [];
  if (c.fautes.length)
    e.push(`chaussée interrompue sous les roues en ${c.fautes.length} points (${Object.entries(z.zones).map(([k, v]) => `${k} vers ${v.slice(0, 10).join(', ')} m`).join(' ; ')})`);
  if (z.sous5) e.push(`chaussée de moins de ${LARGEUR_MIN} m sur ${z.sous5} m (${z.largeurMin} m à ${z.largeurMinAt} m)`);
  if (z.sous6DeuxVoies) e.push(`chaussée à deux voies de moins de ${LARGEUR_MIN_DEUX_VOIES} m sur ${z.sous6DeuxVoies} m`);
  if (z.coteCourt) e.push(`moins de la demi-largeur déclarée d'un côté du rail sur ${z.coteCourt} m (vers ${z.zonesCote.slice(0, 10).join(', ')} m)`);
  if (z.ecartMax > ECART_AXE_MAX) e.push(`rail à ${z.ecartMax} m du milieu de la chaussée (à ${z.ecartAt} m ; vers ${z.zonesEcart.slice(0, 10).join(', ')} m)`);
  return e;
}

/**
 * Résumé : fautes regroupées par zone (abscisses à 10 m près), histogramme des largeurs dessinées
 * (longueur par classe), longueurs sous 5 et 6 m, sections déclarées plus larges que le dessin,
 * écart rail-milieu de la chaussée.
 * @param {ReturnType<typeof continuiteChaussee>} c @param {number} pasT
 */
export function resumerContinuite(c, pasT = 1) {
  /** @type {Record<string, number[]>} */
  const zones = {};
  for (const f of c.fautes) {
    const z = (zones[f.faute] ??= []);
    const a = Math.round(f.s / 10) * 10;
    if (!z.includes(a)) z.push(a);
  }
  const classes = [0, 3, 4, 5, 6, 7, 8, 10, 14];
  /** @type {Record<string, number>} */
  const histogramme = {};
  let sous5 = 0;
  let sous6 = 0;
  let sous6DeuxVoies = 0;
  let ecartMax = 0;
  let ecartAt = 0;
  let surDeclaree = 0;
  let surDeclareeMax = 0;
  /** Mètres où un côté du rail a moins de chaussée que la moitié de la largeur déclarée. */
  let coteCourt = 0;
  /** @type {number[]} */
  const zonesCote = [];
  let largeurMin = Infinity;
  let largeurMinAt = 0;
  /** @type {number[]} */
  const zonesEcart = [];
  for (const t of c.travers) {
    const w = t.gauche + t.droite;
    const k = classes.filter((x) => w >= x - 0.02).pop() ?? 0;
    const i = classes.indexOf(k);
    const nom = i === classes.length - 1 ? `≥ ${k} m` : `${k}–${classes[i + 1]} m`;
    histogramme[nom] = (histogramme[nom] ?? 0) + pasT;
    if (w < LARGEUR_MIN - 0.02) sous5 += pasT;
    if (w < LARGEUR_MIN_DEUX_VOIES - 0.02) sous6 += pasT;
    if (t.lanes >= 2 && w < LARGEUR_MIN_DEUX_VOIES - 0.02) sous6DeuxVoies += pasT;
    if (w < largeurMin) [largeurMin, largeurMinAt] = [w, t.s];
    const e = Math.abs(t.droite - t.gauche) / 2;
    if (e > ecartMax) [ecartMax, ecartAt] = [e, t.s];
    if (e > ECART_AXE_MAX) {
      const a = Math.round(t.s / 10) * 10;
      if (!zonesEcart.includes(a)) zonesEcart.push(a);
    }
    if (Math.min(t.gauche, t.droite) < t.declaree / 2 - 0.05) {
      coteCourt += pasT;
      const a = Math.round(t.s / 10) * 10;
      if (!zonesCote.includes(a)) zonesCote.push(a);
    }
    if (t.declaree > w + 0.25) {
      surDeclaree += pasT;
      surDeclareeMax = Math.max(surDeclareeMax, t.declaree - w);
    }
  }
  return {
    zones,
    histogramme: Object.fromEntries(Object.entries(histogramme).sort((a, b) => parseFloat(a[0].replace('≥ ', '')) - parseFloat(b[0].replace('≥ ', '')))),
    sous5,
    sous6,
    sous6DeuxVoies,
    largeurMin: Math.round(largeurMin * 100) / 100,
    largeurMinAt,
    ecartMax: Math.round(ecartMax * 100) / 100,
    ecartAt,
    zonesEcart,
    surDeclaree,
    surDeclareeMax: Math.round(surDeclareeMax * 100) / 100,
    coteCourt,
    zonesCote,
  };
}
