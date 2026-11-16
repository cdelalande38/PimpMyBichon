// @ts-check
// La Cox (placeholder_cox) : berline ronde à deux portes des années 70, moteur arrière, rabaissée,
// sans pare-chocs, jantes alliage à 8 branches. Substitut modelé par le code d'après la fiche
// « La Cox » (captures/notes-agents/vague-g-fiches.md) et un gabarit chiffré tiré de vues de profil
// (captures/notes-agents/vague-n-cox.md), à remplacer un jour par un vrai modèle aux mêmes
// conventions, sans toucher au code.
// Cotes : longueur de caisse 3,76 (nez à x = +1,79, poupe à x = -1,97 ; 3,80 échappements compris) ;
// largeur 1,55 aux ailes ; hauteur 1,44 ; empattement 2,40 ; voies 1,31 avant et 1,35 arrière ;
// roues de 0,60 (jantes de 15 pouces) ; garde au sol 0,11.
//
// Construction
// - La caisse est un seul loft. Chaque section (moitié droite) part du milieu du dessous : plancher,
//   bas de caisse, flanc galbé jusqu'à la ceinture B, puis un dôme (courbe de Bézier) de la ceinture
//   au milieu du dessus. Le dôme est coupé en deux par un point E posé à une demi-largeur donnée :
//   bord du capot avant, bord du pare-brise, haut des vitres, bord du capot moteur. Comme chaque
//   tronçon a un nombre de points fixe, ces bords tombent sur des lignes du maillage (repérées par
//   l'indice de contour, voir `band`) et restent nets.
// - Le profil dans l'axe suit le gabarit : capot court et rond qui plonge entre les ailes, pare-brise
//   presque droit, pavillon en arche haute du pare-brise à la lunette, puis une seule descente
//   jusqu'au bas du capot moteur.
// - Quatre ailes rapportées, grosses bulles posées de chaque côté (jusqu'à z = ±0,775), soulignées
//   d'un jonc là où elles entrent dans la caisse ; marchepieds entre elles ; phares ronds dressés
//   dans le nez des ailes avant, feux dressés sur le dos des ailes arrière.

import interieur, { ancres } from './interieur.mjs';
import { fenderSkin, beadAlong } from './ailes.mjs';

/** @typedef {typeof import('../../../tools/vehicles/kit.mjs')} Kit */
/** @typedef {import('../../../tools/vehicles/kit.mjs').Parts} Parts */
/** @typedef {import('../../../tools/vehicles/kit.mjs').Face} Face */
/** @typedef {[number, number]} P2 */
/** @typedef {[number, number, number]} P3 */

const X_FRONT = 1.77; // bas du tablier avant, entre les ailes
const X_REAR = -1.97; // poupe (bas du capot moteur)
const AXLES = /** @type {const} */ ([1.2, -1.2]);
const WHEEL_R = 0.3;
const ARCH_R = 0.36; // rayon des passages de roue dans les ailes
const TRACK_Z = /** @type {const} */ ([0.655, 0.675]); // demi-voies avant, arrière
const HEAD = /** @type {P3} */ ([1.784, 0.548, 0.546]); // centre du verre du phare (côté droit)
const HEAD_R = 0.088;

// Repères le long de X.
const X_WS = /** @type {const} */ ([0.34, 0.6]); // pare-brise : haut, bas (dans l'axe)
const X_HOOD = 0.645; // joint arrière du capot avant
const X_LIP = 1.7; // lèvre du capot avant, au-dessus du tablier
const X_DOOR = /** @type {const} */ ([-0.3, 0.47]); // vitre de porte : arrière, avant (en bas)
const X_VENT = /** @type {const} */ ([0.215, 0.255]); // montant du déflecteur : en haut, en bas
const X_QTR = /** @type {const} */ ([-1.05, -0.39]); // vitre de custode : arrière (en bas), avant
const X_RW = /** @type {const} */ ([-1.5, -1.14]); // lunette
const RW_Z = 0.34; // demi-largeur de la lunette
const X_LID = /** @type {const} */ ([-1.93, -1.56]); // capot moteur : bas, haut
const SEAMS_X = [0.585, -0.345]; // joints de porte, sous la ceinture
const VENTS = [-1.6, -1.622, -1.644, -1.666, -1.688, -1.71];
const SEAM = 0.006;

// Fractions fixes de chaque tronçon du dôme (même nombre de points dans toutes les sections).
const FA = [0, 0.06, 0.15, 0.27, 0.4, 0.53, 0.66, 0.78, 0.89, 0.95]; // de la ceinture B vers E
const FB = [0, 0.12, 0.25, 0.38, 0.5, 0.62, 0.74, 0.86, 1]; // de E vers le milieu du dessus
// Indices de contour dans la moitié : 0-2 plancher, 3-5 coin, 6-8 bas de caisse, 9-16 flanc,
// 17-26 dôme bas (17 = ceinture B, 18 = bas des vitres, 26 = joint), 27-35 dôme haut (27 = E).
const I_BELT = 17;
const I_GLASS = 18;
const I_SEAM = 26;
const I_E = 27;
const HALF_POINTS = 36;

/** @param {number} a @param {number} b @param {number} t */
const lerp = (a, b, t) => a + (b - a) * t;
/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** @param {Kit} k */
export default function cox(k) {
  // --- Cotes de la caisse le long de X ----------------------------------------------------------
  // Profil du dessus dans l'axe (gabarit, voiture rabaissée de 6 cm).
  const ytop = k.smoothCurve([
    [X_REAR, 0.42],
    [-1.955, 0.5],
    [-1.92, 0.57],
    [-1.86, 0.665],
    [-1.8, 0.74],
    [-1.7, 0.858],
    [-1.6, 0.968],
    [-1.5, 1.058],
    [-1.4, 1.122],
    [-1.3, 1.19],
    [-1.2, 1.256],
    [-1.1, 1.316],
    [-1.0, 1.356],
    [-0.9, 1.387],
    [-0.75, 1.418],
    [-0.55, 1.436],
    [-0.35, 1.44],
    [-0.15, 1.434],
    [0.05, 1.414],
    [0.2, 1.39],
    [X_WS[0], 1.345],
    [0.4, 1.27],
    [0.5, 1.13],
    [X_WS[1], 1.0],
    [X_HOOD, 0.99],
    [0.75, 0.99],
    [0.9, 0.983],
    [1.05, 0.968],
    [1.2, 0.942],
    [1.3, 0.912],
    [1.4, 0.866],
    [1.5, 0.802],
    [1.6, 0.718],
    [1.67, 0.64],
    [1.72, 0.565],
    [1.755, 0.5],
    [X_FRONT, 0.44],
  ]);
  const ybot = k.smoothCurve([
    [X_REAR, 0.33],
    [-1.94, 0.28],
    [-1.86, 0.22],
    [-1.65, 0.14],
    [-1.35, 0.11],
    [1.3, 0.11],
    [1.52, 0.15],
    [1.64, 0.21],
    [1.72, 0.27],
    [X_FRONT, 0.3],
  ]);
  // Ceinture B : demi-largeur et hauteur.
  const wBelt = k.smoothCurve([
    [X_REAR, 0.4],
    [-1.9, 0.46],
    [-1.75, 0.53],
    [-1.5, 0.6],
    [-1.25, 0.655],
    [-1.0, 0.69],
    [-0.8, 0.7],
    [0.45, 0.7],
    [0.56, 0.69],
    [0.64, 0.64],
    [0.72, 0.56],
    [0.82, 0.49],
    [1.0, 0.46],
    [1.25, 0.43],
    [1.5, 0.405],
    [1.68, 0.39],
    [X_FRONT, 0.385],
  ]);
  const yBelt = k.smoothCurve([
    [X_REAR, 0.37],
    [-1.92, 0.47],
    [-1.8, 0.6],
    [-1.6, 0.74],
    [-1.35, 0.83],
    [-1.1, 0.875],
    [-0.9, 0.89],
    [0.5, 0.89],
    [0.6, 0.875],
    [0.7, 0.82],
    [0.85, 0.73],
    [1.05, 0.68],
    [1.3, 0.64],
    [1.5, 0.59],
    [1.65, 0.53],
    [X_FRONT, 0.42],
  ]);
  // Galbe du flanc sous la ceinture : renflement (au-delà de B) et rentrée du bas de caisse.
  const bulge = k.smoothCurve([[-1.0, 0], [-0.75, 0.012], [0.45, 0.012], [0.65, 0]]);
  // À l'avant, la rentrée devient négative : le tablier s'évase vers le bas entre les ailes.
  const tuck = k.smoothCurve([[X_REAR, 0.04], [-1.8, 0.08], [-1.55, 0.13], [-0.9, 0.13], [-0.7, 0.04], [0.5, 0.04], [0.7, 0.02], [0.95, 0], [1.4, -0.03], [1.65, -0.05], [X_FRONT, -0.04]]);
  const yLow = k.smoothCurve([[X_REAR, 0.34], [-1.85, 0.3], [-0.75, 0.28], [0.6, 0.28], [1.5, 0.3], [X_FRONT, 0.36]]);
  const yMaxFrac = k.smoothCurve([[-0.95, 0.7], [-0.75, 0.6], [0.45, 0.6], [0.65, 0.7]]);
  // Dôme : inclinaison des vitres (rad), longueur de la tangente à la ceinture, rondeur du dessus.
  // Habitacle : vitres latérales penchées vers l'intérieur, pavillon rond ; pare-brise plus plat en
  // travers. Sur le capot avant et le capot moteur, la tangente penche vers l'intérieur : dôme rond.
  const tilt = k.smoothCurve([[-1.75, 0.5], [-1.4, 0.36], [-0.95, 0.36], [0.3, 0.36], [0.5, 0.3], [0.62, 0.3], [0.75, 0.42], [1.0, 0.55], [1.4, 0.62], [X_FRONT, 0.66]]);
  const lift = k.smoothCurve([[-1.7, 0.6], [-1.2, 0.78], [-0.9, 0.82], [0.25, 0.82], [0.5, 0.8], [0.75, 0.6], [1.1, 0.52]]);
  const crown = k.smoothCurve([[-1.7, 0.6], [-1.2, 0.68], [-0.9, 0.7], [0.15, 0.7], [0.38, 0.8], [0.55, 0.84], [0.75, 0.55], [1.1, 0.4], [1.5, 0.34]]);
  // Demi-largeur du point E : bord du capot moteur, haut des vitres, bord du pare-brise, capot avant.
  const zEdge = k.smoothCurve([
    [X_REAR, 0.28],
    [-1.9, 0.31],
    [-1.7, 0.34],
    [-1.56, 0.36],
    [-1.45, 0.42],
    [-1.25, 0.49],
    [-1.05, 0.53],
    [-0.9, 0.535],
    [X_WS[0], 0.535],
    [0.47, 0.55],
    [X_WS[1], 0.56],
    [0.63, 0.5],
    [0.7, 0.45],
    [1.0, 0.42],
    [1.25, 0.38],
    [1.5, 0.315],
    [1.7, 0.26],
    [X_FRONT, 0.24],
  ]);

  /** Cotes de la section en x, bouts arrondis compris. @param {number} x */
  const dims = (x) => {
    const fI = (/** @type {number} */ r) => k.endInset(x, X_FRONT, r);
    const rI = (/** @type {number} */ r) => k.endInset(x, X_REAR, r);
    const t = ytop(x) - fI(0.03) - rI(0.02);
    const yb = ybot(x) + fI(0.04) + rI(0.03);
    const wB = wBelt(x) - fI(0.06) - rI(0.12);
    // Au bout du nez, la section devient trop basse pour les marges : on garde un contour qui ne
    // se replie pas (ceinture au-dessus du dessous, bas de caisse entre les deux).
    const yB = Math.max(yb + 0.05, Math.min(t - 0.03, Math.max(yb + 0.1, yBelt(x))));
    const yL = yB - 0.06 > yb + 0.03 ? clamp(yLow(x), yb + 0.03, yB - 0.06) : lerp(yb, yB, 0.4);
    const wb = wB - tuck(x);
    const wm = wB + bulge(x);
    const sm = yMaxFrac(x);
    const zE = clamp(zEdge(x), 0.05, wB * 0.9);
    return { t, yb, wB, yB, yL, wb, wm, sm, zE, tilt: tilt(x), lift: lift(x), crown: crown(x) };
  };
  /** @typedef {ReturnType<typeof dims>} Dims */

  /** Point [z, y] du dôme en u (0 : ceinture B, 1 : milieu du dessus). @param {Dims} d @param {number} u @returns {P2} */
  const dome = (d, u) => {
    const h = d.t - d.yB;
    const l = d.lift * h;
    const p0 = [d.wB, d.yB];
    const p1 = [d.wB - l * Math.sin(d.tilt), d.yB + l * Math.cos(d.tilt)];
    const p2 = [d.crown * d.wB, d.t];
    const a = (1 - u) ** 3;
    const b = 3 * (1 - u) ** 2 * u;
    const c = 3 * (1 - u) * u * u;
    const e = u ** 3;
    return [a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1] + e * d.t];
  };
  /** Paramètre u du dôme à la demi-largeur z (z décroît avec u). @param {Dims} d @param {number} z */
  const uAtZ = (d, z) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30; i += 1) {
      const mid = (lo + hi) / 2;
      if (dome(d, mid)[0] > z) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };

  /** Moitié droite de la section en x. @param {number} x @returns {P2[]} */
  const half = (x) => {
    const d = dims(x);
    /** @type {P2[]} */
    const pts = [];
    const rf = Math.min(0.03, (d.yL - d.yb) / 2);
    const wf = clamp(d.wb - 0.08, 0.1, d.wb - 0.02);
    for (let i = 0; i < 3; i += 1) pts.push([((wf - rf) * i) / 3, d.yb]);
    for (const deg of [-90, -60, -30]) {
      const a = (deg * Math.PI) / 180;
      pts.push([wf - rf + rf * Math.cos(a), d.yb + rf + rf * Math.sin(a)]);
    }
    for (let i = 0; i < 3; i += 1) pts.push([lerp(wf, d.wb, i / 3), lerp(d.yb + rf, d.yL, i / 3)]);
    for (let j = 0; j < 8; j += 1) {
      const s = j / 8;
      const y = lerp(d.yL, d.yB, s);
      const z = s < d.sm ? d.wb + (d.wm - d.wb) * Math.sin(((Math.PI / 2) * s) / d.sm) : d.wm - (d.wm - d.wB) * ((s - d.sm) / (1 - d.sm)) ** 2;
      pts.push([z, y]);
    }
    const uE = uAtZ(d, d.zE);
    for (const f of FA) pts.push(dome(d, f * uE));
    for (const g of FB) pts.push(dome(d, uE + g * (1 - uE)));
    pts[pts.length - 1] = [0, d.t];
    return pts;
  };
  /** Demi-largeur de la caisse à la hauteur y, dans la section x (flanc et dôme). @param {number} x @param {number} y */
  const bodyZ = (x, y) => {
    const pts = half(x);
    let best = 0;
    for (let i = 6; i < pts.length - 1; i += 1) {
      const [za, ya] = /** @type {P2} */ (pts[i]);
      const [zb, yb] = /** @type {P2} */ (pts[i + 1]);
      if ((y - ya) * (y - yb) <= 0 && ya !== yb) best = Math.max(best, za + ((zb - za) * (y - ya)) / (yb - ya));
    }
    return best;
  };

  /** Indice de contour (dans la moitié, en points d'origine) d'une face du loft de caisse. @param {Face} f */
  const band = (f) => {
    const n = 2 * HALF_POINTS - 2;
    const pos = f.v * n;
    return pos <= HALF_POINTS - 1 ? pos : n - pos;
  };

  // Bord avant de la vitre de porte (suit le montant du pare-brise) et bord arrière de la custode.
  const xDoorFront = (/** @type {number} */ y) => X_DOOR[1] - 0.255 * clamp((y - 0.91) / 0.34, 0, 1) ** 0.9;
  const xQtrRear = (/** @type {number} */ y) => X_QTR[0] + 0.3 * (1 - Math.sqrt(1 - clamp((y - 0.91) / 0.335, 0, 1) ** 2));
  const inVents = (/** @type {number} */ x) => VENTS.some((v) => x < v && x > v - 0.011);

  /** @param {Face} f */
  const bodyRegion = (f) => {
    const az = Math.abs(f.z);
    const side = Math.sign(f.z) * f.nz;
    if (f.cap) return f.y < 0.26 ? 'black' : 'paint_carrosserie';
    if (f.ny < -0.5) return 'black';
    const p = band(f);
    if (p < I_BELT) {
      if (p < 9 && f.y < 0.29) return 'black';
      if (f.y < 0.26 && f.x > -1.85 && f.x < 1.66) return 'black';
      for (const ax of AXLES) if (Math.abs(f.x - ax) < ARCH_R + 0.06 && f.y < 0.62 && az > 0.36) return 'black';
      if (side > 0.4 && f.y > 0.29) for (const sx of SEAMS_X) if (f.x > sx && f.x < sx + SEAM) return 'black';
      return 'paint_carrosserie';
    }
    // Capot avant et ses joints.
    if (f.x > X_HOOD) {
      if (p >= I_E && f.x > X_LIP) return f.x < X_LIP + SEAM ? 'black' : 'paint_carrosserie';
      if (p >= I_E) return f.x < X_HOOD + SEAM ? 'black' : 'paint_capot';
      if (p >= I_SEAM) return 'black';
      return 'paint_carrosserie';
    }
    // Capot moteur, ses joints et ses fentes d'aération.
    if (f.x < X_LID[1] && f.x > X_LID[0] - SEAM) {
      if (p >= I_E) {
        if (f.x > X_LID[1] - SEAM || f.x < X_LID[0]) return 'black';
        if (az < 0.24 && az > 0.03 && inVents(f.x)) return 'black';
        return 'paint_capot_moteur';
      }
      if (p >= I_SEAM) return 'black';
      return 'paint_carrosserie';
    }
    // Lunette.
    if (f.x > X_RW[0] && f.x < X_RW[1] && f.nx < 0) {
      const ex = (f.x - (X_RW[0] + X_RW[1]) / 2) / ((X_RW[1] - X_RW[0]) / 2);
      const ez = az / RW_Z;
      // Super-ellipse : coins arrondis, côtés presque droits.
      if (ex ** 4 + ez ** 4 < 1) return 'glass';
    }
    if (p >= I_E) {
      if (f.x > X_WS[0] && f.x < X_WS[1]) return 'glass';
      if (f.x <= X_WS[0] && f.x > X_LID[1]) return 'paint_toit';
      return 'paint_carrosserie';
    }
    // Vitres latérales : porte (bord avant incliné), custode (bord arrière arrondi).
    if (p >= I_GLASS && side > 0.15) {
      if (f.x > X_DOOR[0] && f.x < xDoorFront(f.y)) return 'glass';
      if (f.x < X_QTR[1] && f.x > xQtrRear(f.y)) return 'glass';
    }
    return 'paint_carrosserie';
  };

  const breaks = [
    ...X_WS, X_HOOD, X_HOOD + SEAM, X_LIP, X_LIP + SEAM, ...X_DOOR, ...X_QTR, ...X_RW, X_LID[0], X_LID[0] - SEAM, X_LID[1], X_LID[1] - SEAM,
    ...SEAMS_X.flatMap((s) => [s, s + SEAM]),
    ...VENTS.flatMap((v) => [v, v - 0.011]),
  ];
  const body = k.loft({
    sectionAt: (x) => k.mirrorSection(half(x)),
    xs: k.sampleX(X_REAR, X_FRONT, { step: 0.035, endZone: 0.12, endCount: 8, breaks }),
    around: 2,
    material: bodyRegion,
    crease: 60,
    capRows: 5,
    capColumns: 10,
  });

  // --- Ailes ---------------------------------------------------------------------------------
  // Grosses bulles rapportées (ailes.mjs) : crête haute au-dessus de la roue, jupe qui descend
  // devant et derrière la roue, section ronde ; l'aile avant finit en nez rond autour du phare.
  const frontSpec = {
    x0: 0.6,
    x1: 1.776,
    axle: AXLES[0],
    archR: ARCH_R,
    wheelR: WHEEL_R,
    crest: /** @type {P2[]} */ ([[0.6, 0.3], [0.64, 0.43], [0.7, 0.55], [0.79, 0.655], [0.9, 0.725], [1.03, 0.76], [1.18, 0.772], [1.33, 0.767], [1.46, 0.752], [1.56, 0.722], [1.65, 0.7], [1.72, 0.704], [1.776, 0.708]]),
    base: /** @type {P2[]} */ ([[0.6, 0.27], [0.84, 0.28], [1.56, 0.29], [1.64, 0.28], [1.7, 0.31], [1.745, 0.38], [1.776, 0.45]]),
    hw: /** @type {P2[]} */ ([[0.6, 0.05], [0.66, 0.12], [0.76, 0.18], [0.9, 0.205], [1.45, 0.205], [1.58, 0.19], [1.68, 0.172], [1.776, 0.166]]),
    zc: /** @type {P2[]} */ ([[0.6, 0.71], [0.7, 0.64], [0.85, 0.575], [1.5, 0.565], [1.65, 0.55], [1.776, 0.546]]),
    roundTop: /** @type {P2[]} */ ([[0.6, 0.6], [0.9, 0.85], [1.776, 1]]),
    r1: 0.03,
    r0: 0.05,
  };
  const rearSpec = {
    x0: -1.9,
    x1: -0.7,
    axle: AXLES[1],
    archR: ARCH_R,
    wheelR: WHEEL_R,
    crest: /** @type {P2[]} */ ([[-1.9, 0.38], [-1.87, 0.48], [-1.82, 0.575], [-1.74, 0.665], [-1.62, 0.74], [-1.48, 0.785], [-1.3, 0.808], [-1.12, 0.8], [-0.98, 0.77], [-0.88, 0.71], [-0.8, 0.62], [-0.74, 0.5], [-0.7, 0.32]]),
    base: /** @type {P2[]} */ ([[-1.9, 0.46], [-1.87, 0.36], [-1.8, 0.29], [-1.7, 0.27], [-1.56, 0.29], [-0.84, 0.28], [-0.7, 0.27]]),
    hw: /** @type {P2[]} */ ([[-1.9, 0.13], [-1.8, 0.175], [-1.6, 0.195], [-1.0, 0.195], [-0.86, 0.17], [-0.77, 0.12], [-0.7, 0.05]]),
    zc: /** @type {P2[]} */ ([[-1.9, 0.585], [-1.0, 0.58], [-0.86, 0.6], [-0.78, 0.64], [-0.7, 0.71]]),
    roundTop: /** @type {P2[]} */ ([[-1.9, 0.9], [-1.0, 0.8], [-0.7, 0.6]]),
    r1: 0.05,
    r0: 0.06,
  };
  // Dessous et voûte noirs ; ce qui de l'aile entre dans la caisse (bosse du passage de roue vue
  // de l'habitacle, pieds avant) est noir aussi : on ne le voit que du dedans.
  const fenderMaterial = (/** @type {number} */ axle) => (/** @type {Face} */ f) =>
    (f.ny < -0.35 && Math.abs(f.x - axle) < ARCH_R + 0.02) || f.ny < -0.8 || (Math.sign(f.z) * f.nz < -0.3 && f.x > -0.95 && f.x < 0.85) || (f.y > 0.3 && Math.abs(f.z) < bodyZ(f.x, f.y) - 0.012)
      ? 'black'
      : 'paint_ailes';
  const frontFender = fenderSkin(k, frontSpec, fenderMaterial(AXLES[0]));
  const rearFender = fenderSkin(k, rearSpec, fenderMaterial(AXLES[1]));
  const fenders = k.symmetric([...frontFender.parts, ...rearFender.parts]);
  // Joncs d'aile : bourrelet noir là où l'aile entre dans la caisse.
  const beads = k.symmetric([
    ...beadAlong(k, frontFender.dims, bodyZ, { from: 0.64, to: 1.7, radius: 0.0065, material: 'black' }),
    ...beadAlong(k, rearFender.dims, bodyZ, { from: -1.86, to: -0.74, radius: 0.0065, material: 'black' }),
  ]);

  // Marchepieds : bande noire striée entre les ailes, jonc chromé au bord.
  /** @type {Parts} */
  const step = [...k.place(k.roundedExtrude(k.roundedRect(1.32, 0.15, 0.02), { material: 'black', depth: 0.026, bevel: 0.008, axis: 'y' }), { position: [-0.05, 0.27, 0.7] })];
  for (let i = 0; i < 5; i += 1) step.push(...k.rod([-0.66, 0.285, 0.645 + i * 0.026], [0.56, 0.285, 0.645 + i * 0.026], 0.003, { material: 'rubber', radial: 4 }));
  step.push(...k.rod([-0.7, 0.276, 0.776], [0.6, 0.276, 0.776], 0.005, { material: 'chrome', radial: 8 }));

  // --- Optiques et chromes -------------------------------------------------------------------
  // Phare rond dressé dans le nez de l'aile avant : cuvelage peint, cerclage chromé, verre bombé.
  const headN = /** @type {P3} */ ([Math.cos(0.05), Math.sin(0.05), 0]);
  const headPose = { position: HEAD, normal: headN, up: /** @type {P3} */ ([0, 1, 0]) };
  /** @type {Parts} */
  const headlight = [
    ...k.orient(k.lathe([[HEAD_R + 0.006, -0.05], [HEAD_R + 0.016, -0.022], [HEAD_R + 0.016, -0.004], [HEAD_R + 0.004, 0.004]], { material: 'paint_ailes', segments: 40, crease: 60 }), headPose),
    ...k.orient(k.tube(k.circle(0, 0, HEAD_R + 0.008, 28).map(([a, b]) => /** @type {P3} */ ([a, b, 0.004])), { material: 'chrome', radius: 0.009, closed: true, segments: 40, radial: 8 }), headPose),
    ...k.orient(k.lamp(k.circle(0, 0, HEAD_R, 32), { material: 'lamp', bulge: 0.026, depth: 0.004 }), headPose),
  ];
  // Clignotant en obus chromé sur le dessus de l'aile avant.
  /** @type {Parts} */
  const blinker = [
    ...k.ellipsoid([1.42, 0.752, 0.6], [0.062, 0.022, 0.024], { material: 'chrome', segments: 16 }),
    ...k.ellipsoid([1.47, 0.753, 0.6], [0.02, 0.017, 0.019], { material: 'signal', segments: 14 }),
  ];
  // Feu arrière dressé sur le dos de l'aile arrière : socle peint, cerclage chromé, verre rouge.
  const tailAt = /** @type {P3} */ ([-1.792, 0.6, 0.6]);
  const tailN = /** @type {P3} */ ([-0.86, 0.5, 0]);
  const tailPose = { position: tailAt, normal: tailN, up: /** @type {P3} */ ([0.5, 0.86, 0]) };
  const tailShape = k.roundedRect(0.105, 0.19, 0.048, 8);
  /** @type {Parts} */
  const taillight = [
    ...k.orient(k.roundedExtrude(k.roundedRect(0.125, 0.21, 0.056, 8), { material: 'paint_ailes', depth: 0.05, bevel: 0.012 }), tailPose),
    ...k.orient(k.roundedExtrude(k.roundedRect(0.115, 0.2, 0.052, 8), { material: 'chrome', depth: 0.012, bevel: 0.004 }), { ...tailPose, position: /** @type {P3} */ ([tailAt[0] - 0.86 * 0.025, tailAt[1] + 0.5 * 0.025, tailAt[2]]) }),
    ...k.orient(k.lamp(tailShape, { material: 'tail', bulge: 0.014, depth: 0.004 }), { ...tailPose, position: /** @type {P3} */ ([tailAt[0] - 0.86 * 0.031, tailAt[1] + 0.5 * 0.031, tailAt[2]]) }),
  ];

  /** Point 3D du dôme (côté droit) en x, sur la fraction f du tronçon bas (0 : ceinture, 1 : E), un peu en dehors. @param {number} x @param {number} f @returns {P3} */
  const onLower = (x, f) => {
    const d = dims(x);
    const [z, y] = dome(d, f * uAtZ(d, d.zE));
    return [x, y + 0.002, z + 0.006];
  };
  /** Point 3D du dôme à la demi-largeur z (côté du signe de z). @param {number} x @param {number} z @param {number} [out] @returns {P3} */
  const onDome = (x, z, out = 0.006) => {
    const d = dims(x);
    const [zz, y] = dome(d, uAtZ(d, Math.abs(z)));
    return [x, y + out, Math.sign(z || 1) * zz];
  };
  /** Point 3D du flanc (sous la ceinture) à la hauteur y, un peu en dehors. @param {number} x @param {number} y @param {number} [out] @returns {P3} */
  const onFlank = (x, y, out = 0.004) => [x, y, bodyZ(x, y) + out];

  // Poignées de porte chromées, sous la ceinture, à l'arrière de la porte ; serrure ronde.
  /** @type {Parts} */
  const handle = [];
  {
    const [hx, hy, hz] = onFlank(-0.21, 0.81, 0.012);
    handle.push(...k.place(k.roundedExtrude(k.roundedRect(0.15, 0.024, 0.011), { material: 'chrome', depth: 0.022, bevel: 0.008 }), { position: [hx, hy, hz] }));
    handle.push(...k.rod(onFlank(-0.27, 0.81, -0.005), [hx - 0.06, hy, hz], 0.007, { material: 'chrome', radial: 8 }));
    handle.push(...k.rod(onFlank(-0.15, 0.81, -0.005), [hx + 0.06, hy, hz], 0.007, { material: 'chrome', radial: 8 }));
    const lock = onFlank(-0.31, 0.81, 0);
    handle.push(...k.orient(k.lathe([[0.011, -0.004], [0.011, 0.004], [0.008, 0.007], [0, 0.007]], { material: 'chrome', segments: 14 }), { position: lock, normal: [0, 0, 1], up: [0, 1, 0] }));
  }
  // Charnières apparentes à l'avant de la porte.
  /** @type {Parts} */
  const hinges = [];
  for (const hy of [0.5, 0.76]) {
    const p = onFlank(SEAMS_X[0] - 0.012, hy, 0.006);
    hinges.push(...k.place(k.roundedExtrude(k.roundedRect(0.05, 0.075, 0.012), { material: 'chrome', depth: 0.02, bevel: 0.006 }), { position: p }));
    hinges.push(...k.rod([p[0] + 0.012, p[1] - 0.04, p[2] + 0.008], [p[0] + 0.012, p[1] + 0.04, p[2] + 0.008], 0.007, { material: 'chrome', radial: 8 }));
  }
  // Poignée du capot avant, au bas du nez, et nervure centrale du capot.
  /** @type {Parts} */
  const hood = [];
  {
    const y = ytop(1.66);
    hood.push(...k.orient(k.roundedExtrude(k.roundedRect(0.13, 0.03, 0.014), { material: 'chrome', depth: 0.028, bevel: 0.01 }), { position: [1.668, y + 0.004, 0], normal: [0.7, 0.71, 0], up: [-0.71, 0.7, 0] }));
    /** @type {P3[]} */
    const rib = [];
    for (let i = 0; i <= 16; i += 1) {
      const x = lerp(X_HOOD + 0.06, 1.6, i / 16);
      rib.push([x, ytop(x) + 0.001, 0]);
    }
    hood.push(...k.tube(rib, { material: 'paint_capot', radius: 0.012, segments: 40, radial: 8 }));
  }
  // Deux sorties d'échappement fines sous le tablier arrière.
  /** @type {Parts} */
  const exhaust = [];
  for (const z of [-0.27, 0.27]) {
    const pipe = k.lathe([[0.016, 0.16], [0.016, 0.0], [0.02, 0.0], [0.02, 0.14], [0.018, 0.16]], { material: 'chrome', segments: 20, axis: 'x', crease: 60 });
    exhaust.push(...k.place(pipe, { position: [X_REAR - 0.035, 0.22, z] }));
  }
  // Plaques unies (aucun texte) : à l'avant sur le tablier, à l'arrière sur le capot moteur, sous
  // le bossage chromé de l'éclaireur.
  /** @type {Parts} */
  const plates = [];
  {
    const front = /** @type {P3} */ ([X_FRONT + 0.012, 0.37, 0]);
    plates.push(...k.orient(k.roundedExtrude(k.roundedRect(0.46, 0.11, 0.01), { material: 'black', depth: 0.012, bevel: 0.003 }), { position: front, normal: [1, 0.12, 0], up: [0, 1, 0] }));
    plates.push(...k.orient(k.roundedExtrude(k.roundedRect(0.44, 0.095, 0.006), { material: 'alu', depth: 0.004, bevel: 0.0015 }), { position: [front[0] + 0.007, front[1], 0], normal: [1, 0.12, 0], up: [0, 1, 0] }));
    const rx = -1.895;
    const ry = ytop(rx) - 0.005;
    const rn = /** @type {P3} */ ([-0.9, 0.42, 0]);
    const rup = /** @type {P3} */ ([0.42, 0.9, 0]);
    plates.push(...k.orient(k.roundedExtrude(k.roundedRect(0.34, 0.15, 0.012), { material: 'black', depth: 0.012, bevel: 0.003 }), { position: [rx - 0.004, ry, 0], normal: rn, up: rup }));
    plates.push(...k.orient(k.roundedExtrude(k.roundedRect(0.32, 0.135, 0.008), { material: 'alu', depth: 0.004, bevel: 0.0015 }), { position: [rx - 0.011, ry + 0.003, 0], normal: rn, up: rup }));
    // Éclaireur de plaque : bossage chromé au-dessus de la plaque.
    const lx = -1.835;
    plates.push(...k.ellipsoid([lx, ytop(lx) + 0.004, 0], [0.05, 0.03, 0.09], { material: 'chrome', segments: 18 }));
  }

  // Joncs chromés des vitres latérales, posés le long des bords des régions.
  /** Abscisse du bord avant de la vitre de porte à la fraction f (point fixe). @param {number} f */
  const xDoorFrontAt = (f) => {
    let x = X_DOOR[1];
    for (let i = 0; i < 12; i += 1) x = xDoorFront(onLower(x, f)[1]);
    return x;
  };
  const xQtrRearAt = (/** @type {number} */ f) => {
    let x = X_QTR[0];
    for (let i = 0; i < 12; i += 1) x = xQtrRear(onLower(x, f)[1]);
    return x;
  };
  const F0 = FA[1];
  /** Contour d'une vitre (bas, avant, haut, arrière). @param {(f: number) => number} xF @param {(f: number) => number} xR @returns {P3[]} */
  const windowLoop = (xF, xR) => {
    /** @type {P3[]} */
    const pts = [];
    const n = 8;
    for (let i = 0; i < n; i += 1) pts.push(onLower(lerp(xR(F0), xF(F0), i / n), F0));
    for (let i = 0; i < 5; i += 1) pts.push(onLower(xF(lerp(F0, 1, i / 5)), lerp(F0, 1, i / 5)));
    for (let i = 0; i < n; i += 1) pts.push(onLower(lerp(xF(1), xR(1), i / n), 1));
    for (let i = 0; i < 5; i += 1) pts.push(onLower(xR(lerp(1, F0, i / 5)), lerp(1, F0, i / 5)));
    return pts;
  };
  /** @type {Parts} */
  const trims = [
    ...k.tube(windowLoop(xDoorFrontAt, () => X_DOOR[0]), { material: 'chrome', radius: 0.005, closed: true, segments: 90, radial: 6 }),
    ...k.tube(windowLoop(() => X_QTR[1], xQtrRearAt), { material: 'chrome', radius: 0.005, closed: true, segments: 90, radial: 6 }),
    // Montant du déflecteur, dans la vitre de porte.
    ...k.tube([onLower(X_VENT[1], F0), onLower(lerp(X_VENT[1], X_VENT[0], 0.5), 0.5), onLower(X_VENT[0], 0.99)], { material: 'chrome', radius: 0.0055, segments: 12, radial: 6 }),
    // Gouttière chromée au-dessus des vitres, de l'avant du pavillon à la custode.
    ...k.tube(Array.from({ length: 24 }, (_, i) => onLower(lerp(0.3, -1.0, i / 23), 1.04)), { material: 'chrome', radius: 0.0045, segments: 60, radial: 6 }),
    // Jonc chromé de ceinture, sous les vitres, le long de la caisse.
    ...k.tube(Array.from({ length: 20 }, (_, i) => onLower(lerp(0.55, -1.15, i / 19), 0)), { material: 'chrome', radius: 0.004, segments: 50, radial: 6 }),
  ];
  // Jonc du pare-brise : bas, côtés le long de E, haut.
  /** @type {P3[]} */
  const wsLoop = [];
  const zWsAt = (/** @type {number} */ x) => dims(x).zE;
  for (let i = 0; i <= 12; i += 1) wsLoop.push(onDome(X_WS[1] + 0.006, lerp(-zWsAt(X_WS[1]), zWsAt(X_WS[1]), i / 12)));
  for (let i = 1; i < 10; i += 1) {
    const x = lerp(X_WS[1], X_WS[0], i / 10);
    wsLoop.push(onDome(x, zWsAt(x) + 0.005));
  }
  for (let i = 0; i <= 12; i += 1) wsLoop.push(onDome(X_WS[0] - 0.006, lerp(zWsAt(X_WS[0]), -zWsAt(X_WS[0]), i / 12)));
  for (let i = 1; i < 10; i += 1) {
    const x = lerp(X_WS[0], X_WS[1], i / 10);
    wsLoop.push(onDome(x, -zWsAt(x) - 0.005));
  }
  const wsTrim = k.tube(wsLoop, { material: 'chrome', radius: 0.0055, closed: true, segments: 120, radial: 6 });
  // Jonc de la lunette (même super-ellipse que la vitre).
  /** @type {P3[]} */
  const rwLoop = [];
  for (let i = 0; i < 48; i += 1) {
    const a = (2 * Math.PI * i) / 48;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const x = (X_RW[0] + X_RW[1]) / 2 + ((X_RW[1] - X_RW[0]) / 2) * Math.sign(c) * Math.abs(c) ** 0.5;
    const z = RW_Z * Math.sign(s) * Math.abs(s) ** 0.5;
    const p = onDome(x, z, 0.005);
    rwLoop.push([x - 0.003, p[1], p[2]]);
  }
  const rwTrim = k.tube(rwLoop, { material: 'chrome', radius: 0.0055, closed: true, segments: 96, radial: 6 });

  // Rétroviseur rond chromé sur la porte conducteur (côté gauche, -Z).
  const mirrorBase = onLower(0.4, 0.05);
  /** @type {Parts} */
  const mirror = [
    ...k.rod([mirrorBase[0], mirrorBase[1], -mirrorBase[2]], [0.37, 1.0, -0.78], 0.008, { material: 'chrome', radial: 8 }),
    ...k.orient(k.lathe([[0.052, -0.012], [0.055, 0.0], [0.047, 0.012], [0, 0.014]], { material: 'chrome', segments: 32, crease: 60 }), { position: [0.37, 1.02, -0.79], normal: [1, 0, 0.1], up: [0, 1, 0] }),
    ...k.orient(k.lathe([[0, -0.012], [0.047, -0.012], [0.052, -0.01]], { material: 'glass', segments: 32 }), { position: [0.37, 1.02, -0.79], normal: [1, 0, 0.1], up: [0, 1, 0] }),
  ];

  // --- Vitres vues de dedans : où est le verre, et les cadres des joncs intérieurs --------------
  const RW_C = (X_RW[0] + X_RW[1]) / 2;
  const RW_H = (X_RW[1] - X_RW[0]) / 2;
  /**
   * Le point de caisse q est-il une vitre, ou à moins de `m` de son bord ? (sert à percer la
   * doublure devant chaque vitre)
   * @param {P3} q @param {number} m
   */
  const glassAt = ([x, y, z], m) => {
    const az = Math.abs(z);
    if (x > X_WS[0] - m && x < X_WS[1] + m && y > 0.9 && az < dims(clamp(x, X_WS[0], X_WS[1])).zE + m) return true;
    if (x > X_RW[0] - m && x < X_RW[1] + m && y > 0.9 && ((x - RW_C) / (RW_H + m)) ** 4 + (az / (RW_Z + m)) ** 4 < 1) return true;
    if (x > X_QTR[0] - m && x < X_DOOR[1] + m && az > 0.3) {
      const xc = clamp(x, X_QTR[0], X_DOOR[1]);
      const yb = onLower(xc, F0)[1] - 0.002;
      const yt = onLower(xc, 1)[1] - 0.002;
      if (y > yb - m && y < yt + m) {
        const yy = clamp(y, yb, yt);
        if (x > X_DOOR[0] - m && x < xDoorFront(yy) + m) return true;
        if (x < X_QTR[1] + m && x > xQtrRear(yy) - m) return true;
      }
    }
    return false;
  };
  /**
   * Point d'un cadre intérieur : p(a, b) sur la tôle, poussé de `depth` vers l'intérieur le long de
   * la normale de la tôle (différences finies).
   * @param {(a: number, b: number) => P3} fn @param {number} a @param {number} b @param {number} depth
   * @returns {P3}
   */
  const sunk = (fn, a, b, depth) => {
    const p = fn(a, b);
    const pa = fn(a + 1e-3, b);
    const pb = fn(a, b + 1e-3);
    const u = [pa[0] - p[0], pa[1] - p[1], pa[2] - p[2]];
    const v = [pb[0] - p[0], pb[1] - p[1], pb[2] - p[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    n = n.map((c) => c / l);
    // Orientée vers le dehors (loin du milieu de l'habitacle).
    const out = (p[0] + 0.3) * n[0] + (p[1] - 0.75) * n[1] + p[2] * n[2] > 0 ? 1 : -1;
    return [p[0] - out * n[0] * depth, p[1] - out * n[1] * depth, p[2] - out * n[2] * depth];
  };
  const FR_OUT = 0.016; // le jonc commence 0,3 cm au-delà du bord du verre (rayon 1,3 cm)
  const FR_IN = 0.012;
  const DF = 0.04; // ≈ 1,6 cm le long du dôme
  /** Cadre d'une vitre latérale (côté droit), un peu au-delà de son bord. @param {(f: number) => number} xF @param {(f: number) => number} xR @returns {P3[]} */
  const frameLoop = (xF, xR) => {
    /** @type {P3[]} */
    const pts = [];
    const f0 = F0 - DF;
    const f1 = 1 + DF;
    const at = (/** @type {number} */ x, /** @type {number} */ f) => sunk(onLower, x, f, FR_IN);
    const n = 10;
    for (let i = 0; i < n; i += 1) pts.push(at(lerp(xR(F0) - FR_OUT, xF(F0) + FR_OUT, i / n), f0));
    for (let i = 0; i < 6; i += 1) {
      const f = lerp(f0, f1, i / 6);
      pts.push(at(xF(clamp(f, F0, 1)) + FR_OUT, f));
    }
    for (let i = 0; i < n; i += 1) pts.push(at(lerp(xF(1) + FR_OUT, xR(1) - FR_OUT, i / n), f1));
    for (let i = 0; i < 6; i += 1) {
      const f = lerp(f1, f0, i / 6);
      pts.push(at(xR(clamp(f, F0, 1)) - FR_OUT, f));
    }
    return pts;
  };
  /** @type {P3[]} */
  const wsFrame = [];
  {
    const dome2 = (/** @type {number} */ x, /** @type {number} */ z) => onDome(x, z, 0);
    // Le pare-brise est penché : le cadre s'écarte davantage en x pour rester hors du verre.
    const zw = (/** @type {number} */ x) => dims(x).zE + 0.02;
    const xb = X_WS[1] + 0.03;
    const xt = X_WS[0] - 0.035;
    for (let i = 0; i <= 12; i += 1) wsFrame.push(sunk(dome2, xb, lerp(-zw(X_WS[1]), zw(X_WS[1]), i / 12), 0.008));
    for (let i = 1; i < 8; i += 1) {
      const x = lerp(xb, xt, i / 8);
      wsFrame.push(sunk(dome2, x, zw(clamp(x, X_WS[0], X_WS[1])), 0.008));
    }
    for (let i = 0; i <= 12; i += 1) wsFrame.push(sunk(dome2, xt, lerp(zw(X_WS[0]), -zw(X_WS[0]), i / 12), 0.008));
    for (let i = 1; i < 8; i += 1) {
      const x = lerp(xt, xb, i / 8);
      wsFrame.push(sunk(dome2, x, -zw(clamp(x, X_WS[0], X_WS[1])), 0.008));
    }
  }
  /** @type {P3[]} */
  const rwFrame = [];
  for (let i = 0; i < 48; i += 1) {
    const a = (2 * Math.PI * i) / 48;
    const cs = Math.cos(a);
    const sn = Math.sin(a);
    const x = RW_C + (RW_H + FR_OUT) * Math.sign(cs) * Math.abs(cs) ** 0.5;
    const z = (RW_Z + FR_OUT) * Math.sign(sn) * Math.abs(sn) ** 0.5;
    rwFrame.push(sunk((xx, zz) => onDome(xx, zz, 0), x, z, FR_IN));
  }
  const frames = [
    { loop: frameLoop(xDoorFrontAt, () => X_DOOR[0]), mirror: true },
    { loop: frameLoop(() => X_QTR[1], xQtrRearAt), mirror: true },
    { loop: wsFrame, mirror: false },
    { loop: rwFrame, mirror: false },
  ];

  // --- Habitacle (vue intérieure du conducteur, et vu par les vitres) : interieur.mjs ----------
  const cabin = interieur(k, {
    half,
    band,
    I: { belt: I_BELT, glass: I_GLASS, e: I_E },
    xWs: X_WS,
    xDoor: X_DOOR,
    xQtr: X_QTR,
    xRw: X_RW,
    rwZ: RW_Z,
    xDoorFront,
    xQtrRear,
    onDome,
    glassAt,
    frames,
  });

  // --- Modèle --------------------------------------------------------------------------------
  const m = new k.Model('cox');
  const teal = { color: '#0a3a46', roughness: 0.3 };
  m.material('paint_carrosserie', teal)
    .material('paint_toit', teal)
    .material('paint_capot', teal)
    .material('paint_capot_moteur', teal)
    .material('paint_ailes', teal)
    .material('paint_jantes', { color: '#d9dde2', metallic: 1, roughness: 0.08 })
    .material('paint_sellerie', { color: '#111114', roughness: 0.6 })
    .material('paint_pommeau', { color: '#e9e0c8', roughness: 0.4 });
  m.add('carrosserie', [...body, ...fenders, ...beads, ...k.symmetric(step)]);
  m.add('habitacle', cabin);
  // Habitacle : ancres du volant, du pommeau et des sièges avant ; l'app y pose les pièces partagées
  // choisies (tools/vehicles/habitacle.mjs ; d'origine : sport, tête de mort, baquets bas).
  for (const { node, ...pose } of ancres(k)) m.anchor(node, pose);
  m.add('accessoires', [
    ...k.symmetric([...headlight, ...blinker, ...taillight, ...handle, ...hinges, ...trims]),
    ...wsTrim,
    ...rwTrim,
    ...hood,
    ...exhaust,
    ...plates,
    ...mirror,
  ]);

  // Roues : quatre ancres (axe Z, face extérieure vers +Z) ; l'app y pose la jante et les pneus
  // choisis dans le catalogue partagé (d'origine : huit branches, 165 à l'avant et 185 à l'arrière).
  m.anchor('roue_avant_droite', { position: [AXLES[0], WHEEL_R, TRACK_Z[0]] });
  m.anchor('roue_avant_gauche', { position: [AXLES[0], WHEEL_R, -TRACK_Z[0]], rotation: [0, Math.PI, 0] });
  m.anchor('roue_arriere_droite', { position: [AXLES[1], WHEEL_R, TRACK_Z[1]] });
  m.anchor('roue_arriere_gauche', { position: [AXLES[1], WHEEL_R, -TRACK_Z[1]], rotation: [0, Math.PI, 0] });
  return m;
}
