// @ts-check
// Le van (placeholder_van) : fourgon moderne blanc, tôlé, rabaissé, jantes tôle percées, boucliers
// gris anthracite. Substitut modelé par le code d'après la fiche « Le van »
// (captures/notes-agents/vague-g-fiches.md) et son gabarit chiffré, à remplacer un jour par un vrai
// modèle aux mêmes conventions, sans toucher au code.
// Cotes : longueur 4,89 (avant à x = +2,40, arrière à x = -2,49) ; largeur 1,90 hors rétroviseurs ;
// hauteur 1,90 ; empattement 3,00 ; voies 1,63 ; roues de 0,66 (jantes de 17 pouces).
//
// Construction
// - La caisse est un seul loft. Sa moitié de section part du milieu du dessous : plancher, paroi et
//   voûte du passage de roue (une marche dans la section au-dessus de chaque essieu), coin du bas de
//   caisse, flanc, pli de caisse, vitrage rentrant, arrondi de pavillon, pavillon à peine bombé.
//   Chaque tronçon a un nombre de points fixe : les bords horizontaux (bouclier, phares, calandre,
//   ceinture, rail, vitres, joint de pavillon) tombent sur des lignes du maillage et restent nets.
// - Le profil dans l'axe suit le gabarit : nez arrondi, capot court, pare-brise très incliné et
//   droit, pavillon presque plat, arrière presque vertical. En plan, l'avant s'arrondit en quart
//   d'ellipse entre x = +2,04 et le nez : les phares s'enroulent sur les angles.
// - Bourrelet des passages de roue : le flanc est repoussé de 3 cm le long du cercle de chaque
//   passage (fonction de la distance au cercle), dans le même loft : pas de couture.

import interieur from './interieur.mjs';

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
const LIP = 0.03; // saillie du bourrelet
const LIP_W = 0.065; // largeur du bourrelet
const W = 0.95; // demi-largeur de la caisse
const Z_IN = 0.66; // paroi intérieure des passages de roue
const FRONT_B = 0.36; // longueur (x) de l'arrondi avant en plan
const FRONT_A = 0.55; // retrait (z) de l'arrondi avant en plan : demi-largeur 0,40 au nez
const R_TOP = 0.12; // arrondi de pavillon

// Hauteurs du flanc (sous le vitrage), dans l'ordre : joint bas des portes, prise d'air, bouclier
// arrière, bouclier avant, phares, calandre, ceinture, rail, pli.
const H_LOW = [0.38, 0.386, 0.46, 0.6, 0.67, 0.74, 0.78, 0.8, 0.84, 0.865, 0.875, 0.895, 0.905, 0.92, 0.95, 0.98, 1.0, 1.008, 1.02, 1.04];
// Hauteurs nominales du vitrage (section à pavillon de 1,90) : bas des vitres, haut des vitres, joint
// du pavillon, départ de l'arrondi. Elles suivent la caisse quand le pavillon descend (pare-brise).
const G_NOM = [1.08, 1.2, 1.32, 1.44, 1.55, 1.62, 1.66, 1.72, 1.726, 1.78];
const SHOULDER = 1.04;
const G_TOP = 1.78;
// Indices de contour dans la moitié.
const I_H = 13;
const I_G = I_H + H_LOW.length; // 30 : premier point du vitrage
const I_ARC = I_G + G_NOM.length - 1; // 40 : départ de l'arrondi de pavillon
const HALF_POINTS = I_ARC + 1 + 5 + 5; // 51

// Repères le long de X.
const SEAM = 0.006;
const SEAMS = [1.55, 0.55, 0.494, -0.62]; // joints de porte (bord avant de chaque joint)
const X_FWIN = /** @type {const} */ ([0.58, 1.52]); // vitre de porte avant
const X_SWIN = /** @type {const} */ ([-0.59, 0.464]); // vitre de porte coulissante
const X_RAIL = /** @type {const} */ ([-2.2, -0.62]);
const X_WS = /** @type {const} */ ([0.98, 1.7]); // pare-brise
const X_COWL = /** @type {const} */ ([1.7, 1.76]); // grille d'auvent
const X_BUMP_F = 1.985; // début du bouclier avant sur le flanc
const X_BUMP_R = -2.15; // fin du bouclier arrière sur le flanc
const X_LAMP_OUT = 2.06; // bout arrière des phares (cerclage noir à 2,04)

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
  // Dessus dans l'axe (gabarit) : pavillon, arrondi, pare-brise droit, capot, nez.
  const ytop = k.smoothCurve([
    [X_REAR, 1.875],
    [-2.2, 1.893],
    [-2.0, 1.9],
    [-0.5, 1.9],
    [0.5, 1.893],
    [0.8, 1.884],
    [0.92, 1.868],
    [1.0, 1.84],
    [1.05, 1.8],
    [1.1, 1.746],
    [1.2, 1.639],
    [1.4, 1.424],
    [1.6, 1.209],
    [1.7, 1.1015],
    [1.76, 1.073],
    [1.85, 1.06],
    [2.0, 1.045],
    [2.2, 1.022],
    [X_FRONT, 1.0],
  ]);
  const ybot = k.smoothCurve([
    [X_REAR, 0.3],
    [-2.3, 0.285],
    [-2.0, 0.255],
    [1.9, 0.25],
    [2.1, 0.23],
    [X_FRONT, 0.22],
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
  const topAt = (x) => ytop(x) - k.endInset(x, X_FRONT, 0.07) - k.endInset(x, X_REAR, 0.2);

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
    const tumble = 0.05 * clamp((flankTop - shoulder) / 0.7, 0, 1);
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
    const zr = wTop - d.rTop;
    for (let i = 1; i <= 5; i += 1) {
      const z = zr * (1 - i / 5);
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

  // Abscisses des bords en plan et des lignes du nez.
  const xAtW = (/** @type {number} */ w) => solve(width, w, X_FRONT - FRONT_B, X_FRONT);
  const X_LAMP_IN = xAtW(0.55);
  const X_RING_IN = xAtW(0.53);
  const X_INTAKE = xAtW(0.5);
  // Calandre noire de 0,84 à 0,92, deux lames chromées.
  const GRILLE = [[0.865, 0.875], [0.895, 0.905]];

  /** @param {Face} f */
  const region = (f) => {
    const az = Math.abs(f.z);
    const side = Math.sign(f.z) * f.nz; // > 0 : regarde vers l'extérieur du flanc
    const p = band(f);
    // Bouchons : face avant (bouclier, prise d'air) et face arrière (hayon, feux, bouclier).
    if (f.cap) {
      if (f.x > 0) {
        if (f.y < 0.74) return f.y > 0.3 && f.y < 0.46 ? 'black' : 'paint_boucliers';
        if (f.y > 0.84 && f.y < 0.92) return GRILLE.some(([a, b]) => f.y > a && f.y < b) ? 'chrome' : 'black';
        return 'paint_carrosserie';
      }
      if (az > 0.8 && f.y > 0.95 && f.y < 1.55) return 'tail';
      if (f.y < 0.6) return 'paint_boucliers';
      if (az > 0.76 && az < 0.766 && f.y > 0.62) return 'black';
      if (f.y > 0.62 && f.y < 0.626 && az < 0.766) return 'black';
      if (az < 0.72 && f.y > 1.1 && f.y < 1.66) return 'glass';
      return 'paint_carrosserie';
    }
    // Dessous et passages de roue.
    if (f.ny < -0.55) return 'black';
    if (p < 7) return 'black';
    // Avant : bouclier, prise d'air, phares enroulés sur les angles, calandre.
    if (f.x > X_BUMP_F && f.y < 0.74 && f.ny < 0.8) {
      if (f.y > 0.3 && f.y < 0.46 && az < 0.5 && f.nx > 0.5) return 'black';
      return 'paint_boucliers';
    }
    if (f.x > X_LAMP_OUT - 0.02 && f.y > 0.78 && f.y < 0.98 && az > 0.53 && p < I_G + 2) {
      if (f.x > X_LAMP_OUT && f.y > 0.8 && f.y < 0.95 && az > 0.55) return f.y < 0.84 ? 'chrome' : 'lamp';
      return 'black';
    }
    if (f.x > 2.3 && f.nx > 0.3 && az < 0.53 && f.y > 0.84 && f.y < 0.92) return GRILLE.some(([a, b]) => f.y > a && f.y < b) ? 'chrome' : 'black';
    // Arrière : bouclier (les feux sont sur le bouchon, dans les angles).
    if (f.x < X_BUMP_R && f.y < 0.6 && f.ny < 0.8) return 'paint_boucliers';
    // Pare-brise et grille d'auvent.
    if (p >= I_ARC + 2 && f.x > X_WS[0] && f.x < X_WS[1] && f.nx > 0.3 && f.ny > 0.2) return 'glass';
    if (p >= I_ARC && f.x > X_COWL[0] && f.x < X_COWL[1] && f.ny > 0.3) return 'black';
    // Vitres latérales : porte avant (le haut suit le montant), porte coulissante.
    if (side > 0.5 && p >= I_G && p < I_ARC) {
      const inBand = f.y > gAt(f.x, 1.08) && f.y < gAt(f.x, 1.62);
      if (inBand && ((f.x > X_FWIN[0] && f.x < X_FWIN[1]) || (f.x > X_SWIN[0] && f.x < X_SWIN[1]))) return 'glass';
      // Joint du haut des portes, sous l'arrondi du pavillon.
      if (f.x > SEAMS[3] - SEAM && f.x < SEAMS[0] + SEAM && f.y > gAt(f.x, 1.72) && f.y < gAt(f.x, 1.726)) return 'black';
    }
    // Joints de porte, joint bas des portes, rail de la porte coulissante.
    if (side > 0.4 && f.y > 0.33 && f.y < gAt(f.x, 1.726)) for (const s of SEAMS) if (f.x > s && f.x < s + SEAM) return 'black';
    if (side > 0.4 && f.y > 0.38 && f.y < 0.386 && f.x > SEAMS[3] && f.x < SEAMS[0] + SEAM) return 'black';
    if (side > 0.4 && f.y > 1.008 && f.y < 1.02 && f.x > X_RAIL[0] && f.x < X_RAIL[1]) return 'black';
    // Pavillon.
    if (f.ny > 0.9 && f.y > 1.8) return 'paint_toit';
    return 'paint_carrosserie';
  };

  const breaks = [
    ...SEAMS.flatMap((s) => [s, s + SEAM]),
    ...AXLES.flatMap((a) => [0, 0.012, 0.025, 0.04, LIP_W].flatMap((d) => [a - ARCH_R - d, a + ARCH_R + d])),
    ...X_FWIN, ...X_SWIN, ...X_RAIL, ...X_WS, ...X_COWL, X_BUMP_F, X_BUMP_R,
    X_LAMP_OUT, X_LAMP_OUT - 0.02, X_LAMP_IN, X_RING_IN, X_INTAKE, 2.2,
  ];
  const body = k.loft({
    sectionAt: (x) => k.mirrorSection(half(x)),
    xs: k.sampleX(X_REAR, X_FRONT, { step: 0.075, endZone: FRONT_B, endCount: 14, breaks }),
    around: 2,
    material: region,
    crease: 55,
    capY: [0.3, 0.46, 0.6, 0.62, 0.626, 0.74, 0.84, 0.865, 0.875, 0.895, 0.905, 0.92, 0.95, 1.1, 1.55, 1.66],
    capZ: [0.72, 0.76, 0.766, 0.8],
    capColumns: 16,
  });

  // --- Prise d'air : deux lames grises ; antibrouillards dans leurs logements ----------------
  /** @type {Parts} */
  const front = [];
  for (const y of [0.355, 0.405]) {
    front.push(...k.place(k.roundedExtrude(k.roundedRect(0.016, 0.014, 0.006), { material: 'paint_boucliers', depth: 0.8, bevel: 0.004, axis: 'z' }), { position: [X_FRONT + 0.004, y, 0] }));
  }
  // Logement d'antibrouillard posé sur l'angle du bouclier, normale de la surface en plan.
  const xFog = xAtW(0.7);
  const dw = (width(xFog + 0.002) - width(xFog - 0.002)) / 0.004;
  const nFog = /** @type {P3} */ ([-dw / Math.hypot(1, dw), 0, 1 / Math.hypot(1, dw)]);
  const fogPose = { position: /** @type {P3} */ ([xFog + nFog[0] * 0.002, 0.56, 0.7 + nFog[2] * 0.002]), normal: nFog, up: /** @type {P3} */ ([0, 1, 0]) };
  /** @type {Parts} */
  const fog = [
    ...k.orient(k.roundedExtrude(k.roundedRect(0.17, 0.075, 0.03), { material: 'black', depth: 0.01, bevel: 0.004 }), fogPose),
    ...k.orient(k.lamp(k.circle(0, 0, 0.026, 20), { material: 'lamp', bulge: 0.008, depth: 0.004 }), { ...fogPose, position: /** @type {P3} */ ([fogPose.position[0] + nFog[0] * 0.005, 0.56, fogPose.position[2] + nFog[2] * 0.005]) }),
  ];

  // --- Habitacle : doublure percée aux vitres, planche, combiné, volant, sièges (interieur.mjs) --
  const cabin = interieur(k, { dims, flankZ, gy, xRear: X_REAR, xWs: X_WS, xFwin: X_FWIN, xSwin: X_SWIN });

  // --- Accessoires : rétroviseurs, poignées, répétiteurs, trappe à carburant -------------------
  /** @type {Parts} */
  const mirror = [
    ...k.rod([1.46, 1.12, 0.93], [1.5, 1.16, 0.99], 0.022, { material: 'black' }),
    ...k.place(k.roundedExtrude(k.roundedRect(0.12, 0.26, 0.05), { material: 'black', depth: 0.2, bevel: 0.04 }), { position: [1.52, 1.2, 1.05] }),
    ...k.place(k.roundedExtrude(k.roundedRect(0.01, 0.21, 0.035), { material: 'chrome', depth: 0.16, bevel: 0.004 }), { position: [1.458, 1.2, 1.05] }),
  ];
  const handles = [0.66, 0.4].flatMap((x) =>
    k.place(k.roundedExtrude(k.roundedRect(0.17, 0.04, 0.016), { material: 'black', depth: 0.03, bevel: 0.01 }), { position: [x, 0.97, 0.952] }),
  );
  const repeater = k.orient(k.lamp(k.circle(0, 0, 0.022, 20), { material: 'signal', bulge: 0.006, depth: 0.004 }), { position: [1.85, 0.95, 0.951], normal: [0, 0, 1] });
  // Essuie-glaces au repos au pied du pare-brise ; poignée du hayon.
  /** @type {Parts} */
  const rest = [
    ...k.rod([1.672, 1.142, -0.72], [1.662, 1.156, -0.06], 0.008, { material: 'black', radial: 6 }),
    ...k.rod([1.672, 1.142, -0.02], [1.662, 1.156, 0.62], 0.008, { material: 'black', radial: 6 }),
    ...k.place(k.roundedExtrude(k.roundedRect(0.016, 0.045, 0.007), { material: 'black', depth: 0.26, bevel: 0.006 }), { position: [X_REAR - 0.004, 1.0, 0] }),
  ];
  // Troisième feu stop en haut du hayon.
  rest.push(...k.orient(k.lamp(k.roundedRect(0.26, 0.026, 0.01), { material: 'tail', bulge: 0.003, depth: 0.003 }), { position: [X_REAR - 0.001, 1.64, 0], normal: [-1, 0, 0], up: [0, 1, 0] }));
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
  m.add('accessoires', [...k.symmetric([...mirror, ...handles, ...repeater, ...fog]), ...front, ...flap, ...rest]);

  // Roues : jante tôle à 16 trous, moyeu noir ; un maillage partagé posé quatre fois.
  m.shared('roue', k.wheel({ outer: WHEEL_R, rim: 0.216, width: 0.215, style: 'tole', material: 'paint_jantes', holes: 16, hubRadius: 0.12, segments: 40 }));
  m.instance('roue_avant_droite', 'roue', { position: [AXLES[0], WHEEL_R, TRACK_Z] });
  m.instance('roue_avant_gauche', 'roue', { position: [AXLES[0], WHEEL_R, -TRACK_Z], rotation: [0, Math.PI, 0] });
  m.instance('roue_arriere_droite', 'roue', { position: [AXLES[1], WHEEL_R, TRACK_Z] });
  m.instance('roue_arriere_gauche', 'roue', { position: [AXLES[1], WHEEL_R, -TRACK_Z], rotation: [0, Math.PI, 0] });
  return m;
}
