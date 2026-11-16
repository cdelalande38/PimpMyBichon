// @ts-check
// Le van (placeholder_van) : fourgon tôlé moderne des années 2000, blanc, rabaissé, jantes tôle
// percées, larges boucliers gris anthracite. Substitut modelé par le code d'après la fiche « Le van »
// (captures/notes-agents/vague-g-fiches.md) et le gabarit chiffré du fourgon réel (gabarit.mjs), à
// remplacer un jour par un vrai modèle aux mêmes conventions, sans toucher au code.
// Cotes : longueur 4,89 (avant à x = +2,40, arrière à x = -2,49) ; largeur 1,90 hors rétroviseurs ;
// hauteur 1,90 ; empattement 3,00 ; voies 1,63 ; roues de 0,66 (jantes de 17 pouces).
//
// Construction
// - La caisse est un seul loft. Sa moitié de section part du milieu du dessous : plancher, paroi et
//   voûte du passage de roue (une marche dans la section au-dessus de chaque essieu), coin du bas de
//   caisse, flanc, pli de caisse, vitrage rentrant, arrondi de pavillon, pavillon à peine bombé.
//   Chaque tronçon a un nombre de points fixe : les bords horizontaux (bouclier, phares, calandre,
//   ceinture, rail, vitres, joint de pavillon) tombent sur des lignes du maillage et restent nets.
// - Le profil dans l'axe suit le gabarit : capot court plongeant (25°) dans le prolongement d'un
//   pare-brise très incliné (33°), pavillon plat, arrière presque vertical. Sous le capot, une marche
//   inclinée porte les grands phares et la calandre à deux lames, en retrait du large bouclier qui
//   avance de 10 cm (sa tablette est le dessus de la caisse entre x = +2,31 et le nez). En plan, la
//   face est large et ses angles s'arrondissent sur 30 cm : les phares s'enroulent sur les ailes.
// - Lignes de caisse du gabarit : ceinture (bas des vitres) à 1,12, haut des vitres à 1,74, mince
//   bandeau sous le pavillon ; porte avant, porte coulissante à droite (vitre teintée, rail sous la
//   ceinture jusqu'aux feux), flanc gauche tôlé ; feux arrière verticaux dans les angles.
// - Bourrelet des passages de roue : le flanc est repoussé de 1,5 cm le long du cercle de chaque
//   passage (fonction de la distance au cercle), dans le même loft : pas de couture.

import interieur, { ancres } from './interieur.mjs';

/** @typedef {typeof import('../../../tools/vehicles/kit.mjs')} Kit */
/** @typedef {import('../../../tools/vehicles/kit.mjs').Parts} Parts */
/** @typedef {import('../../../tools/vehicles/kit.mjs').Face} Face */
/** @typedef {[number, number]} P2 */
/** @typedef {[number, number, number]} P3 */

const X_FRONT = 2.4;
const X_REAR = -2.49;
const AXLES = /** @type {const} */ ([1.5, -1.5]);
const WHEEL_R = 0.33;
const TRACK_Z = 0.815; // demi-voie
const ARCH_R = 0.4;
const ARCH_Y = 0.285; // centre des passages de roue (pneu au ras du haut)
const LIP = 0.015; // saillie du bourrelet
const LIP_W = 0.065; // largeur du bourrelet
const W = 0.95; // demi-largeur de la caisse
const Z_IN = 0.66; // paroi intérieure des passages de roue
const FRONT_B = 0.3; // longueur (x) de l'arrondi avant en plan
const FRONT_A = 0.32; // retrait (z) de l'arrondi avant en plan : demi-largeur 0,63 au nez
const R_TOP = 0.09; // arrondi de pavillon

// Hauteurs du flanc (sous le vitrage), dans l'ordre : joint bas des portes, prise d'air, bouclier
// arrière, feux arrière, bouclier avant, cerclage et verre des phares, lames de calandre, pli de
// caisse, rail de la porte coulissante.
const H_LOW = [0.38, 0.386, 0.46, 0.52, 0.62, 0.71, 0.76, 0.78, 0.8, 0.865, 0.88, 0.915, 0.93, 0.96, 0.98, 1.0, 1.02, 1.05, 1.085, 1.095];
// Hauteurs nominales du vitrage (section à pavillon de 1,90) : bas des vitres (ceinture), haut des
// vitres, joint du haut des portes, départ de l'arrondi. Elles suivent la caisse quand le pavillon
// descend (pare-brise, capot).
const G_NOM = [1.12, 1.22, 1.34, 1.46, 1.58, 1.68, 1.74, 1.765, 1.771, 1.8];
const SHOULDER = 1.11;
const G_TOP = 1.8;
// Indices de contour dans la moitié.
const I_H = 13;
const I_G = I_H + H_LOW.length; // 30 : premier point du vitrage
const I_ARC = I_G + G_NOM.length - 1; // 40 : départ de l'arrondi de pavillon
const HALF_POINTS = I_ARC + 1 + 5 + 7; // 53

// Repères le long de X.
const SEAM = 0.006;
// Joints de porte (bord avant de chaque joint) : porte avant, montant, arrière de la porte coulissante.
const SEAMS = [1.36, 0.12, 0.06, -1.1];
const SEAMS_LEFT = [1.36, 0.12]; // flanc gauche : porte avant seule
const X_FWIN = /** @type {const} */ ([0.17, 1.42]); // vitre de porte avant
const X_SWIN = /** @type {const} */ ([-1.04, 0.01]); // vitre de porte coulissante (à droite)
const X_RAIL = /** @type {const} */ ([-2.42, -1.1]);
const X_WS = /** @type {const} */ ([0.8, 1.62]); // pare-brise
const FRAME = 0.015; // joint noir au bord avant et arrière des vitres latérales
const X_COWL = /** @type {const} */ ([1.62, 1.68]); // grille d'auvent
const X_BUMP_F = 1.93; // début du bouclier avant sur le flanc
const X_BUMP_R = -2.12; // fin du bouclier arrière sur le flanc
// Marche des phares : inclinée de x = 2,24 (y = 0,98) à x = 2,32 (y = 0,78), puis tablette du bouclier.
const STEP = /** @type {const} */ ({ x0: 2.24, y0: 0.98, x1: 2.32, y1: 0.78, shelf: 0.76 });
const X_LAMP_OUT = 2.13; // bout arrière des phares sur l'aile (cerclage noir à 2,115)
const Z_GRILLE = 0.335; // demi-largeur de la calandre
const BUMPER_SEAM = /** @type {const} */ ([0.5, 0.506]); // joints du bouclier avant en trois parties
const Z_INTAKE = 0.45; // demi-largeur de la prise d'air basse
const Z_LAMP_IN = 0.37; // bord intérieur des phares (cerclage noir entre les deux)
// Lames chromées de la calandre et verre des phares (hauteurs).
const SLATS = [[0.865, 0.88], [0.915, 0.93]];
const LAMP_Y = /** @type {const} */ ([0.8, 0.96]);
// Arrière : bouclier, feux verticaux, hayon et sa lunette.
const REAR = /** @type {const} */ ({ bumper: 0.52, tail: [0.71, 1.15], signal: [0.88, 0.94], tailZ: 0.78, win: [1.2, 1.72], winZ: 0.68, frameZ: 0.72, gateZ: [0.76, 0.766], gateY: [0.55, 0.556] });

/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** Recherche par dichotomie de x dans [lo, hi] tel que f(x) = v (f monotone). @param {(x: number) => number} f @param {number} v @param {number} lo @param {number} hi */
const solve = (f, v, lo, hi) => {
  const up = f(hi) > f(lo);
  let a = lo;
  let b = hi;
  for (let i = 0; i < 50; i += 1) {
    const m = (a + b) / 2;
    if (f(m) > v === up) b = m;
    else a = m;
  }
  return (a + b) / 2;
};

/** @param {Kit} k */
export default function van(k) {
  // --- Cotes de la caisse le long de X ----------------------------------------------------------
  // Dessus dans l'axe (gabarit) : pavillon, arrondi, pare-brise droit (33°), grille d'auvent,
  // capot plongeant (25°) jusqu'au bord d'attaque arrondi au-dessus des phares.
  const ytop = k.smoothCurve([
    [X_REAR, 1.875],
    [-2.2, 1.893],
    [-2.0, 1.9],
    [0.3, 1.9],
    [0.55, 1.892],
    [0.68, 1.872],
    [0.78, 1.835],
    [0.86, 1.79],
    [1.03, 1.684],
    [1.25, 1.548],
    [1.45, 1.424],
    [1.62, 1.318],
    [1.66, 1.3],
    [1.82, 1.225],
    [2.0, 1.15],
    [2.12, 1.095],
    [2.19, 1.055],
    [2.225, 1.02],
    [STEP.x0, STEP.y0],
  ]);
  // Marche des phares, puis tablette du bouclier, arrondie au nez.
  /** @param {number} x */
  const profileTop = (x) => {
    if (x <= STEP.x0) return ytop(x);
    if (x <= STEP.x1) return STEP.y0 + ((x - STEP.x0) / (STEP.x1 - STEP.x0)) * (STEP.y1 - STEP.y0);
    const s = Math.min(1, (x - STEP.x1) / 0.02);
    return STEP.y1 + (STEP.shelf - STEP.y1) * s;
  };
  const ybot = k.smoothCurve([
    [X_REAR, 0.32],
    [-2.3, 0.29],
    [-2.0, 0.25],
    [1.9, 0.225],
    [2.1, 0.218],
    [X_FRONT, 0.215],
  ]);
  /** Demi-largeur en plan : quart d'ellipse à l'avant, petit arrondi à l'arrière. @param {number} x */
  const width = (x) => {
    let w = W - k.endInset(x, X_REAR, 0.06);
    const x0 = X_FRONT - FRONT_B;
    if (x > x0) {
      const s = Math.min(1, (x - x0) / FRONT_B);
      w -= FRONT_A * (1 - Math.sqrt(1 - s * s));
    }
    return w;
  };
  /** Dessus dans l'axe, bouts arrondis compris. @param {number} x */
  const topAt = (x) => profileTop(x) - k.endInset(x, X_FRONT, 0.04) - k.endInset(x, X_REAR, 0.2);

  /** Bas du flanc : soulevé en arc au-dessus des roues. @param {number} x @param {number} yb */
  const archBottom = (x, yb) => {
    let y = yb;
    for (const ax of AXLES) {
      const d = Math.abs(x - ax);
      if (d < ARCH_R) y = Math.max(y, ARCH_Y + Math.sqrt(ARCH_R * ARCH_R - d * d));
    }
    return y;
  };
  /** Bourrelet : saillie en z au point (x, y) du flanc, selon la distance au cercle du passage. @param {number} x @param {number} y */
  const lip = (x, y) => {
    let best = 0;
    for (const ax of AXLES) {
      const d = Math.max(0, Math.hypot(x - ax, y - ARCH_Y) - ARCH_R);
      const s = d / LIP_W;
      if (s < 1) best = Math.max(best, LIP * (1 - s) * (1 - s) * (1 + 2 * s));
    }
    return best;
  };

  /** Cotes de la section en x. @param {number} x */
  const dims = (x) => {
    const t = topAt(x);
    const yb = ybot(x) + k.endInset(x, X_FRONT, 0.03) + k.endInset(x, X_REAR, 0.04);
    const w = width(x);
    const crown = 0.01 * clamp((t - 1.1) / 0.3, 0, 1);
    const rTop = clamp((t - 1.1) * 0.15, 0.025, R_TOP);
    const tEdge = t - crown;
    const flankTop = tEdge - rTop;
    const shoulder = Math.min(SHOULDER, flankTop - 0.02);
    const tumble = 0.035 * clamp((flankTop - shoulder) / 0.7, 0, 1);
    return { t, yb, w, crown, rTop, tEdge, flankTop, shoulder, tumble };
  };
  /** @typedef {ReturnType<typeof dims>} Dims */
  /** Hauteur réelle d'une hauteur nominale du vitrage. @param {Dims} d @param {number} g */
  const gy = (d, g) => d.shoulder + ((g - SHOULDER) / (G_TOP - SHOULDER)) * (d.flankTop - d.shoulder);
  /** Flanc : z au point de hauteur y (sans bourrelet). @param {Dims} d @param {number} y */
  const flankZ = (d, y) => {
    if (y < 0.6) return d.w - 0.02 * ((0.6 - y) / 0.3) ** 2;
    if (y <= 1.0) return d.w;
    if (y <= 1.02) return d.w + 0.004 * ((y - 1.0) / 0.02);
    if (y <= d.shoulder + 1e-6) return d.w + 0.004 - 0.005 * clamp((y - 1.02) / 0.02, 0, 1);
    const s = clamp((y - d.shoulder) / Math.max(1e-6, d.flankTop - d.shoulder), 0, 1);
    return d.w - 0.001 - d.tumble * s;
  };

  /** Moitié droite de la section en x. @param {number} x @returns {P2[]} */
  const half = (x) => {
    const d = dims(x);
    const ya = archBottom(x, d.yb);
    const rB = 0.04;
    // Flanc : points relatifs au bas (bourrelet), puis hauteurs fixes, rangées sans se croiser.
    const ys = [ya + rB, ya + rB + 0.025, ya + rB + 0.05, ...H_LOW];
    const eps = 0.002;
    for (let i = 1; i < ys.length; i += 1) ys[i] = Math.max(/** @type {number} */ (ys[i]), /** @type {number} */ (ys[i - 1]) + eps);
    for (let i = ys.length - 1; i >= 0; i -= 1) ys[i] = Math.min(/** @type {number} */ (ys[i]), d.shoulder - (ys.length - 1 - i) * eps);
    const wb = flankZ(d, ys[0] ?? 0) + lip(x, ya + rB);
    const zIn = Math.min(Z_IN, wb - rB - 0.02);
    /** @type {P2[]} */
    const pts = [];
    pts.push(...k.segment([0, d.yb], [zIn, d.yb], 3));
    pts.push(...k.segment([zIn, d.yb], [zIn, ya], 2));
    pts.push(...k.segment([zIn, ya], [wb - rB, ya], 2));
    for (const deg of [-90, -60, -30]) {
      const a = (deg * Math.PI) / 180;
      const y = ya + rB + rB * Math.sin(a);
      pts.push([wb - rB + rB * Math.cos(a) + (deg === -90 ? 0 : lip(x, y) - lip(x, ya + rB)), y]);
    }
    for (const y of ys) pts.push([flankZ(d, y) + lip(x, y), y]);
    for (const g of G_NOM) {
      const y = gy(d, g);
      pts.push([flankZ(d, y), y]);
    }
    const wTop = d.w - 0.001 - d.tumble;
    const arc = k.arc(wTop - d.rTop, d.flankTop, d.rTop, 0, 90, 5).slice(1);
    pts.push(...arc);
    // Dessus : sept points, dont les joints du bouclier et les bords de la calandre et des phares
    // (lignes nettes sur la tablette et la marche).
    const zr = wTop - d.rTop;
    for (const z of [(zr + BUMPER_SEAM[1]) / 2, BUMPER_SEAM[1], BUMPER_SEAM[0], Z_LAMP_IN, Z_GRILLE, Z_GRILLE / 2, 0]) {
      const s = z / Math.max(1e-6, zr);
      pts.push([z, d.tEdge + d.crown * (1 - s * s)]);
    }
    return pts;
  };

  /** Indice de contour (dans la moitié, en points d'origine) d'une face de la caisse. @param {Face} f */
  const band = (f) => {
    const n = 2 * HALF_POINTS - 2;
    const pos = f.v * n;
    return pos <= HALF_POINTS - 1 ? pos : n - pos;
  };
  /** Hauteur réelle d'une hauteur nominale du vitrage en x. @param {number} x @param {number} g */
  const gAt = (x, g) => gy(dims(x), g);

  // Abscisses des bords en plan, et de la marche des phares à chaque hauteur de ses lignes.
  const xAtW = (/** @type {number} */ w) => solve(width, w, X_FRONT - FRONT_B, X_FRONT);
  const xStep = (/** @type {number} */ y) => STEP.x0 + ((y - STEP.y0) / (STEP.y1 - STEP.y0)) * (STEP.x1 - STEP.x0);
  const STEP_Y = [0.98, 0.96, 0.93, 0.915, 0.88, 0.865, 0.8, 0.78];


  /** @param {Face} f */
  const region = (f) => {
    const az = Math.abs(f.z);
    const right = f.z > 0;
    const side = Math.sign(f.z) * f.nz; // > 0 : regarde vers l'extérieur du flanc
    const p = band(f);
    // Bouchons : face avant (bouclier, prise d'air) et face arrière (hayon, feux, bouclier).
    if (f.cap) {
      if (f.x > 0) {
        if (az > BUMPER_SEAM[0] && az < BUMPER_SEAM[1]) return 'black';
        return f.y > 0.3 && f.y < 0.46 && az < Z_INTAKE ? 'black' : 'paint_boucliers';
      }
      if (f.y < REAR.bumper) return 'paint_boucliers';
      if (az > REAR.tailZ && f.y > REAR.tail[0] && f.y < REAR.tail[1]) return f.y > REAR.signal[0] && f.y < REAR.signal[1] ? 'signal' : 'tail';
      if (az > REAR.gateZ[0] && az < REAR.gateZ[1] && f.y > REAR.gateY[0]) return 'black';
      if (f.y > REAR.gateY[0] && f.y < REAR.gateY[1] && az < REAR.gateZ[1]) return 'black';
      if (az < REAR.winZ && f.y > REAR.win[0] && f.y < REAR.win[1]) return 'glass';
      if (az < REAR.frameZ && f.y > REAR.win[0] - 0.03 && f.y < REAR.win[1] + 0.03) return 'black';
      return 'paint_carrosserie';
    }
    // Dessous et passages de roue.
    if (f.ny < -0.55) return 'black';
    if (p < 7) return 'black';
    // Face avant sous le capot : marche inclinée, cuvette noire où se posent phares et calandre
    // (pièces en volume, plus bas), puis tablette du bouclier et ses joints.
    if (f.x > STEP.x0 - 0.004 && f.x < STEP.x1 + 0.004 && f.nx > 0.5 && f.y > STEP.y1 - 0.005 && f.y < STEP.y0 + 0.005) return 'black';
    if (f.x > STEP.x1 && f.y > STEP.shelf - 0.03 && f.ny > 0.3) return az > BUMPER_SEAM[0] && az < BUMPER_SEAM[1] ? 'black' : 'paint_boucliers';
    // Bouclier avant, enroulé jusqu'au passage de roue.
    if (f.x > X_BUMP_F && f.y < STEP.shelf && f.ny < 0.8) return 'paint_boucliers';
    // Coin extérieur des phares étiré sur l'aile : glace sombre jusqu'à la marche (le clignotant est
    // dans le coin du phare).
    if (f.x > X_LAMP_OUT && f.x < STEP.x0 && f.y > 0.88 && f.y < 0.96 && side > 0.2) return 'black';
    // Arrière : bouclier, feux verticaux enroulés sur l'angle.
    if (f.x < X_BUMP_R && f.y < REAR.bumper && f.ny < 0.8) return 'paint_boucliers';
    if (f.x < X_REAR + 0.05 && f.y > REAR.tail[0] && f.y < REAR.tail[1] && side > 0.2) return f.y > REAR.signal[0] && f.y < REAR.signal[1] ? 'signal' : 'tail';
    // Pare-brise et grille d'auvent.
    // Pare-brise bordé de noir (sérigraphie) sur ses côtés, en haut et au pied.
    if (p >= I_ARC + 2 && f.x > X_WS[0] && f.x < X_WS[1] && f.nx > 0.3 && f.ny > 0.2) return p < I_ARC + 2.5 || f.x < X_WS[0] + 0.04 || f.x > X_WS[1] - 0.03 ? 'black' : 'glass';
    if (p >= I_ARC && f.x > X_COWL[0] && f.x < X_COWL[1] && f.ny > 0.3) return 'black';
    // Vitres latérales : porte avant (le haut suit le montant), porte coulissante à droite.
    if (side > 0.5 && p >= I_G && p < I_ARC) {
      const inBand = f.y > gAt(f.x, 1.12) && f.y < gAt(f.x, 1.74);
      // Vitres bordées de joints noirs à l'avant et à l'arrière.
      const pane = (/** @type {readonly [number, number]} */ w) => (f.x < w[0] + FRAME || f.x > w[1] - FRAME ? 'black' : 'glass');
      if (inBand && f.x > X_FWIN[0] && f.x < X_FWIN[1]) return pane(X_FWIN);
      if (inBand && right && f.x > X_SWIN[0] && f.x < X_SWIN[1]) return pane(X_SWIN);
      // Joint du haut des portes, sous l'arrondi du pavillon.
      const doors = right ? [SEAMS[3] ?? 0, SEAMS[0] ?? 0] : [SEAMS_LEFT[1] ?? 0, SEAMS_LEFT[0] ?? 0];
      if (f.x > doors[0] - SEAM && f.x < doors[1] + SEAM && f.y > gAt(f.x, 1.765) && f.y < gAt(f.x, 1.771)) return 'black';
    }
    // Joints de porte, joint bas des portes, rail de la porte coulissante (à droite).
    const seams = right ? SEAMS : SEAMS_LEFT;
    if (side > 0.4 && f.y > 0.33 && f.y < gAt(f.x, 1.771)) for (const s of seams) if (f.x > s && f.x < s + SEAM) return 'black';
    if (side > 0.4 && f.y > 0.38 && f.y < 0.386 && f.x > (seams[seams.length - 1] ?? 0) && f.x < (seams[0] ?? 0) + SEAM) return 'black';
    if (side > 0.4 && right && f.y > 1.085 && f.y < 1.095 && f.x > X_RAIL[0] && f.x < X_RAIL[1]) return 'black';
    // Pavillon.
    if (f.ny > 0.9 && f.y > 1.8) return 'paint_toit';
    return 'paint_carrosserie';
  };

  const breaks = [
    ...SEAMS.flatMap((s) => [s, s + SEAM]),
    ...AXLES.flatMap((a) => [0, 0.012, 0.025, 0.04, LIP_W].flatMap((d) => [a - ARCH_R - d, a + ARCH_R + d])),
    ...X_FWIN, ...X_SWIN, ...[...X_FWIN, ...X_SWIN].flatMap((x, i) => [i % 2 ? x - FRAME : x + FRAME]), ...X_RAIL, ...X_WS, X_WS[0] + 0.04, X_WS[1] - 0.03, ...X_COWL, X_BUMP_F, X_BUMP_R,
    X_LAMP_OUT, X_LAMP_OUT - 0.015, X_REAR + 0.05, 2.2,
    ...STEP_Y.map(xStep), STEP.x1 + 0.02,
  ];
  // Les lignes imposées (breaks) passent avant le pas régulier : une abscisse du pas à moins de
  // 4,5 mm d'une ligne lui cède la place (sinon la fusion des abscisses proches la décale et les
  // bords des phares et des lames partent en dents de scie).
  const lines = [...new Set(breaks.filter((x) => x > X_REAR && x < X_FRONT).map((x) => Math.round(x * 1e5) / 1e5))];
  const xs = [...k.sampleX(X_REAR, X_FRONT, { step: 0.08, endZone: FRONT_B, endCount: 10 }).filter((x) => x === X_REAR || x === X_FRONT || lines.every((b) => Math.abs(x - b) > 0.0045)), ...lines].sort((a, b) => a - b);
  const body = k.loft({
    sectionAt: (x) => k.mirrorSection(half(x)),
    xs,
    around: 2,
    material: region,
    crease: 55,
    capY: [0.3, 0.46, REAR.bumper, REAR.gateY[0], REAR.gateY[1], REAR.tail[0], REAR.signal[0], REAR.signal[1], REAR.tail[1], REAR.win[0] - 0.03, REAR.win[0], REAR.win[1], REAR.win[1] + 0.03],
    capZ: [Z_INTAKE, ...BUMPER_SEAM, REAR.winZ, REAR.frameZ, REAR.gateZ[0], REAR.gateZ[1], REAR.tailZ],
    capColumns: 16,
  });

  // --- Prise d'air basse : trois lames noires en relief ; antibrouillards ronds dans les angles ---
  /** @type {Parts} */
  const front = [];
  for (const y of [0.33, 0.38, 0.43]) {
    front.push(...k.place(k.roundedExtrude(k.roundedRect(0.024, 0.018, 0.007), { material: 'black', depth: 2 * Z_INTAKE - 0.03, bevel: 0.005, axis: 'z' }), { position: [X_FRONT + 0.004, y, 0] }));
  }
  // Logement rond d'antibrouillard posé sur l'angle du bouclier, normale de la surface en plan.
  const xFog = xAtW(0.74);
  const dw = (width(xFog + 0.002) - width(xFog - 0.002)) / 0.004;
  const nFog = /** @type {P3} */ ([-dw / Math.hypot(1, dw), 0, 1 / Math.hypot(1, dw)]);
  const fogAt = (/** @type {number} */ out) => /** @type {P3} */ ([xFog + nFog[0] * out, 0.4, 0.74 + nFog[2] * out]);
  /** @type {Parts} */
  const fog = [
    ...k.orient(k.roundedExtrude(k.circle(0, 0, 0.055, 28), { material: 'black', depth: 0.016, bevel: 0.005, bevelSegments: 2 }), { position: fogAt(0.002), normal: nFog, up: [0, 1, 0] }),
    ...k.orient(k.tube(k.circle(0, 0, 0.04, 28).map(([a, b]) => /** @type {P3} */ ([a, b, 0])), { material: 'chrome', radius: 0.004, closed: true, segments: 28, radial: 6 }), { position: fogAt(0.01), normal: nFog, up: [0, 1, 0] }),
    ...k.orient(k.lamp(k.circle(0, 0, 0.034, 24), { material: 'lamp', bulge: 0.008, depth: 0.004 }), { position: fogAt(0.01), normal: nFog, up: [0, 1, 0] }),
  ];

  // --- Face avant sur la marche (normale de la marche, vers l'avant et le haut) -----------------
  const stepLen = Math.hypot(STEP.x1 - STEP.x0, STEP.y0 - STEP.y1);
  const stepN = /** @type {P3} */ ([(STEP.y0 - STEP.y1) / stepLen, (STEP.x1 - STEP.x0) / stepLen, 0]);
  const stepTilt = Math.atan2(stepN[1], stepN[0]);
  /** Point de la marche à la hauteur y, décollé de `out` le long de sa normale. @param {number} y @param {number} out */
  const onStep = (y, out) => /** @type {P3} */ ([xStep(y) + stepN[0] * out, y + stepN[1] * out, 0]);
  /** Coordonnée le long de la marche (vers le haut) d'une hauteur y, depuis y = 0,88. @param {number} y */
  const v = (y) => ((y - 0.88) / (STEP.y0 - STEP.y1)) * stepLen;
  // Phare gauche, dessiné dans le plan de la marche (u : vers l'extérieur, v : vers le haut), reporté
  // à droite par symétrie : grand trapèze dont le bord bas remonte vers l'aile, cuvette noire, deux
  // réflecteurs ronds cerclés de chrome, clignotant dans le coin extérieur, glace lisse par-dessus.
  /** @param {number} inset @returns {P2[]} */
  const headlight = (inset) => [
    [Z_LAMP_IN + 0.005 + inset, v(0.785) + inset],
    [0.66, v(0.825) + inset],
    [0.84 - inset, v(0.885) + inset],
    [0.845 - inset, v(0.955) - inset],
    [0.83 - inset, v(0.965) - inset],
    [Z_LAMP_IN + 0.015 + inset, v(0.965) - inset],
    [Z_LAMP_IN + 0.005 + inset, v(0.955) - inset],
  ];
  /** Pose dans le plan de la marche (origine à y = 0,88 dans l'axe), décollé de `out`. @param {Parts} p @param {number} out */
  const lampPlane = (p, out) => k.orient(p, { position: onStep(0.88, out), normal: stepN, up: [0, 1, 0] });
  /** Réflecteur rond cerclé de chrome au point (u, v) du phare. @param {number} u @param {number} vv @param {number} r @returns {Parts} */
  const reflector = (u, vv, r) => [
    ...k.place(k.lamp(k.circle(0, 0, r, 28), { material: 'lamp', bulge: 0.012, depth: 0.005 }), { position: [u, vv, 0] }),
    ...k.place(k.tube(k.circle(0, 0, r + 0.004, 28).map(([a, b]) => /** @type {P3} */ ([a, b, 0])), { material: 'chrome', radius: 0.0035, closed: true, segments: 28, radial: 6 }), { position: [u, vv, 0.002] }),
  ];
  /** @type {Parts} */
  const lampLeft = [
    ...lampPlane(k.roundedExtrude(headlight(0), { material: 'black', depth: 0.022, bevel: 0.005, bevelSegments: 2 }), 0.008),
    ...lampPlane([...reflector(0.48, v(0.885), 0.05), ...reflector(0.645, v(0.9), 0.04)], 0.019),
    ...lampPlane(k.place(k.lamp(k.roundedRect(0.075, 0.04, 0.01, 3), { material: 'signal', bulge: 0.006, depth: 0.004 }), { position: [0.775, v(0.925), 0] }), 0.019),
    ...lampPlane(k.roundedExtrude(headlight(0.006), { material: 'glass', depth: 0.004, bevel: 0.0015, bevelSegments: 1 }), 0.036),
  ];
  // Calandre : bandeau noir en retrait (la marche), deux lames horizontales en relief, jonc chromé
  // fin en haut ; aucun écusson. Lèvre du capot au-dessus des optiques : arête marquée.
  const bar = (/** @type {number} */ w, /** @type {number} */ h, /** @type {number} */ len, /** @type {string} */ material) =>
    k.roundedExtrude(k.roundedRect(w, h, Math.min(w, h) * 0.4), { material, depth: len, bevel: Math.min(w, h) * 0.3, axis: 'z' });
  /** @type {Parts} */
  const grille = [
    ...SLATS.flatMap(([a = 0, b = 0]) => k.place(bar(0.03, b - a + 0.012, 2 * Z_GRILLE - 0.02, 'black'), { position: onStep((a + b) / 2, 0.012), rotation: [0, 0, stepTilt] })),
    ...k.place(bar(0.012, 0.009, 2 * Z_GRILLE - 0.01, 'chrome'), { position: onStep(LAMP_Y[1] + 0.002, 0.008), rotation: [0, 0, stepTilt] }),
    ...k.place(bar(0.05, 0.016, 2 * 0.845, 'paint_carrosserie'), { position: [STEP.x0 - 0.012, STEP.y0 + 0.02, 0], rotation: [0, 0, -0.436] }),
  ];

  // --- Habitacle : doublure percée aux vitres, planche, combiné, volant, sièges (interieur.mjs) --
  const cabin = interieur(k, { dims, flankZ, gy, xRear: X_REAR, xWs: X_WS, xFwin: X_FWIN, xSwin: X_SWIN, rear: REAR });

  // --- Accessoires : rétroviseurs, poignées, répétiteurs, essuie-glaces, gouttières, nervures,
  //     antenne, trappe à carburant -----------------------------------------------------------
  // Grands rétroviseurs à coque noire au coin bas avant de la vitre de porte : bras, coque, miroir.
  /** @type {Parts} */
  const mirror = [
    ...k.rod([1.36, 1.15, 0.935], [1.3, 1.17, 0.99], 0.02, { material: 'black', radial: 10 }),
    ...k.place(k.roundedExtrude(k.roundedRect(0.12, 0.27, 0.045), { material: 'black', depth: 0.2, bevel: 0.03 }), { position: [1.27, 1.245, 1.03] }),
    ...k.place(k.roundedExtrude(k.roundedRect(0.01, 0.22, 0.03), { material: 'chrome', depth: 0.13, bevel: 0.004 }), { position: [1.208, 1.245, 1.045] }),
  ];
  // Poignées noires : arrière de la porte avant (deux côtés), avant de la porte coulissante (à droite).
  const handle = (/** @type {number} */ x) => k.place(k.roundedExtrude(k.roundedRect(0.17, 0.04, 0.016), { material: 'black', depth: 0.03, bevel: 0.01 }), { position: [x, 1.035, 0.954] });
  const repeater = k.orient(k.lamp(k.circle(0, 0, 0.02, 20), { material: 'signal', bulge: 0.006, depth: 0.004 }), { position: [1.95, 0.9, 0.951], normal: [0, 0, 1] });
  // Gouttière le long du pavillon, au-dessus des portes.
  const gutter = k.rod([0.82, gy(dims(0.82), 1.8) - 0.005, 0.905], [-2.36, 1.795, 0.905], 0.007, { material: 'paint_carrosserie', radial: 6 });
  /** @type {Parts} */
  const rest = [
    // Essuie-glaces au repos au pied du pare-brise.
    ...k.rod([1.598, 1.343, -0.74], [1.586, 1.352, -0.07], 0.008, { material: 'black', radial: 6 }),
    ...k.rod([1.598, 1.343, -0.03], [1.586, 1.352, 0.62], 0.008, { material: 'black', radial: 6 }),
    // Poignée du hayon, sous la lunette.
    ...k.place(k.roundedExtrude(k.roundedRect(0.016, 0.045, 0.007), { material: 'black', depth: 0.26, bevel: 0.006 }), { position: [X_REAR - 0.004, 1.0, 0] }),
    // Antenne courte, au-dessus du pare-brise, couchée vers l'arrière.
    ...k.rod([0.6, 1.885, -0.32], [0.46, 1.985, -0.32], 0.005, { material: 'black', radial: 6 }),
    ...k.place(k.roundedExtrude(k.roundedRect(0.06, 0.02, 0.008), { material: 'black', depth: 0.03, bevel: 0.006 }), { position: [0.6, 1.9, -0.32] }),
    // Poignée de la porte coulissante (à droite).
    ...handle(0.0),
  ];
  // Nervures de tôle du pavillon : quatre joncs dans la longueur.
  for (const z of [-0.5, -0.17, 0.17, 0.5]) rest.push(...k.place(k.roundedExtrude(k.roundedRect(0.035, 0.012, 0.005), { material: 'paint_toit', depth: 2.4, bevel: 0.004, axis: 'x' }), { position: [-0.95, 1.898, z] }));
  // Troisième feu stop en haut du hayon.
  rest.push(...k.orient(k.lamp(k.roundedRect(0.26, 0.026, 0.01), { material: 'tail', bulge: 0.003, depth: 0.003 }), { position: [X_REAR - 0.001, 1.75, 0], normal: [-1, 0, 0], up: [0, 1, 0] }));
  // Trappe à carburant : côté gauche, derrière le passage de roue arrière.
  /** @type {Parts} */
  const flap = [
    ...k.place(k.roundedExtrude(k.roundedRect(0.17, 0.13, 0.02), { material: 'black', depth: 0.004, bevel: 0.001 }), { position: [-2.12, 0.92, -0.951] }),
    ...k.place(k.roundedExtrude(k.roundedRect(0.158, 0.118, 0.016), { material: 'paint_carrosserie', depth: 0.004, bevel: 0.0015 }), { position: [-2.12, 0.92, -0.954] }),
  ];

  const m = new k.Model('van');
  m.material('paint_carrosserie', { color: '#f0efe9', roughness: 0.3 })
    .material('paint_toit', { color: '#f0efe9', roughness: 0.3 })
    .material('paint_boucliers', { color: '#3a3d42', roughness: 0.75 })
    .material('paint_jantes', { color: '#f0efe9', roughness: 0.3 });
  m.add('carrosserie', body);
  m.add('habitacle', cabin);
  // Habitacle : ancres du volant, du pommeau et des sièges avant ; l'app y pose les pièces partagées
  // choisies (tools/vehicles/habitacle.mjs ; d'origine : moyeu large, boule, enveloppants).
  for (const { node, ...pose } of ancres(k)) m.anchor(node, pose);
  m.add('accessoires', [...k.symmetric([...mirror, ...handle(0.3), ...repeater, ...fog, ...gutter, ...lampLeft]), ...front, ...grille, ...flap, ...rest]);

  // Roues : jante tôle à 16 trous, moyeu noir ; un maillage partagé posé quatre fois.
  // Roues : quatre ancres ; l'app y pose la jante et les pneus choisis (d'origine : tôle, 215/55 R17).
  m.anchor('roue_avant_droite', { position: [AXLES[0], WHEEL_R, TRACK_Z] });
  m.anchor('roue_avant_gauche', { position: [AXLES[0], WHEEL_R, -TRACK_Z], rotation: [0, Math.PI, 0] });
  m.anchor('roue_arriere_droite', { position: [AXLES[1], WHEEL_R, TRACK_Z] });
  m.anchor('roue_arriere_gauche', { position: [AXLES[1], WHEEL_R, -TRACK_Z], rotation: [0, Math.PI, 0] });
  return m;
}
