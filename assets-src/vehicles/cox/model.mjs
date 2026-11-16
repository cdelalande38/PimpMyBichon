// @ts-check
// La Cox (placeholder_cox) : berline ronde à deux portes des années 70, moteur arrière, rabaissée,
// sans pare-chocs, jantes alliage à 8 branches. Substitut modelé par le code d'après la fiche
// « La Cox » (captures/notes-agents/vague-g-fiches.md) et son gabarit chiffré, à remplacer un jour
// par un vrai modèle aux mêmes conventions, sans toucher au code.
// Cotes : longueur 4,08 (nez à x = +1,98, poupe à x = -2,10) ; largeur 1,55 aux ailes ; hauteur
// 1,44 ; empattement 2,40 ; voies 1,31 avant et 1,35 arrière ; roues de 0,60 (jantes de 15 pouces) ;
// garde au sol 0,11.
//
// Construction
// - La caisse est un seul loft. Chaque section (moitié droite) part du milieu du dessous : plancher,
//   bas de caisse, flanc galbé jusqu'à la ceinture B, puis un dôme (courbe de Bézier) de la ceinture
//   au milieu du dessus. Le dôme est coupé en deux par un point E posé à une demi-largeur donnée :
//   bord du capot avant, bord du pare-brise, haut des vitres, bord du capot moteur. Comme chaque
//   tronçon a un nombre de points fixe, ces bords tombent sur des lignes du maillage (repérées par
//   l'indice de contour, voir `band`) et restent nets.
// - Le profil dans l'axe suit la silhouette du gabarit : capot court et plongeant, arche du pavillon
//   haute et continue, arrière en une seule courbe jusqu'en bas.
// - Quatre ailes en pontons séparés, posées de chaque côté, qui sortent de la caisse jusqu'à
//   z = ±0,775 ; marchepieds fins entre elles ; phares ronds dressés au bout des ailes avant.

import interieur from './interieur.mjs';

/** @typedef {typeof import('../../../tools/vehicles/kit.mjs')} Kit */
/** @typedef {import('../../../tools/vehicles/kit.mjs').Parts} Parts */
/** @typedef {import('../../../tools/vehicles/kit.mjs').Face} Face */
/** @typedef {[number, number]} P2 */
/** @typedef {[number, number, number]} P3 */

const X_FRONT = 1.98; // bas du tablier avant
const X_REAR = -2.1; // poupe
const AXLES = /** @type {const} */ ([1.2, -1.2]);
const WHEEL_R = 0.3;
const ARCH_R = 0.36; // rayon des passages de roue dans les ailes
const TRACK_Z = /** @type {const} */ ([0.655, 0.675]); // demi-voies avant, arrière
const FENDER_OUT = 0.775; // face extérieure des ailes
const HEAD_X = 1.858; // bout des ailes avant, sous le cerclage du phare

// Repères le long de X.
const X_WS = /** @type {const} */ ([0.2, 0.62]); // pare-brise : haut, bas (dans l'axe)
const X_HOOD = 0.72; // joint arrière du capot avant
const X_LIP = 1.912; // lèvre du capot avant, au-dessus du tablier
const X_DOOR = /** @type {const} */ ([-0.38, 0.42]); // vitre de porte : arrière, avant (en bas)
const X_QTR = /** @type {const} */ ([-1.0, -0.46]); // vitre de custode : arrière (en bas), avant
const X_RW = /** @type {const} */ ([-1.47, -1.12]); // lunette ovale
const RW_Z = 0.36; // demi-largeur de la lunette
const X_LID = /** @type {const} */ ([-2.0, -1.53]); // capot moteur : bas, haut
const SEAMS_X = [0.5, -0.426]; // joints de porte, sous la ceinture
const VENTS = [-1.585, -1.61, -1.635, -1.66, -1.685];
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
  // Profil du dessus dans l'axe (gabarit), points intermédiaires pour bomber pare-brise et lunette.
  const ytop = k.smoothCurve([
    [X_REAR, 0.4],
    [-2.08, 0.45],
    [-2.04, 0.52],
    [-1.97, 0.605],
    [-1.85, 0.72],
    [-1.68, 0.875],
    [-1.5, 1.02],
    [-1.3, 1.162],
    [-1.1, 1.28],
    [-0.85, 1.38],
    [-0.55, 1.428],
    [-0.25, 1.44],
    [0.02, 1.418],
    [X_WS[0], 1.36],
    [0.27, 1.315],
    [0.41, 1.19],
    [0.55, 1.06],
    [X_WS[1], 0.99],
    [0.75, 0.975],
    [1.1, 0.93],
    [1.4, 0.865],
    [1.6, 0.8],
    [1.8, 0.715],
    [1.9, 0.655],
    [1.95, 0.6],
    [X_FRONT, 0.53],
  ]);
  const ybot = k.smoothCurve([
    [X_REAR, 0.3],
    [-2.06, 0.27],
    [-1.95, 0.22],
    [-1.65, 0.13],
    [-1.3, 0.11],
    [1.3, 0.11],
    [1.62, 0.16],
    [1.8, 0.24],
    [1.9, 0.31],
    [1.95, 0.35],
    [X_FRONT, 0.38],
  ]);
  // Ceinture B : demi-largeur et hauteur.
  const wBelt = k.smoothCurve([
    [X_REAR, 0.42],
    [-1.95, 0.46],
    [-1.75, 0.5],
    [-1.5, 0.56],
    [-1.25, 0.62],
    [-1.0, 0.66],
    [-0.75, 0.67],
    [0.5, 0.67],
    [0.6, 0.655],
    [0.72, 0.59],
    [0.85, 0.48],
    [1.0, 0.44],
    [1.25, 0.405],
    [1.6, 0.355],
    [1.85, 0.35],
    [X_FRONT, 0.34],
  ]);
  const yBelt = k.smoothCurve([
    [X_REAR, 0.36],
    [-2.0, 0.48],
    [-1.85, 0.6],
    [-1.6, 0.76],
    [-1.3, 0.88],
    [-1.0, 0.94],
    [-0.75, 0.95],
    [0.5, 0.95],
    [0.62, 0.935],
    [0.75, 0.87],
    [0.9, 0.8],
    [1.1, 0.72],
    [1.4, 0.66],
    [1.6, 0.61],
    [1.8, 0.54],
    [X_FRONT, 0.46],
  ]);
  // Galbe du flanc sous la ceinture : renflement (au-delà de B) et rentrée du bas de caisse.
  const bulge = k.smoothCurve([[-1.0, 0], [-0.7, 0.01], [0.5, 0.01], [0.7, 0]]);
  // À l'avant, la rentrée devient négative : le tablier s'évase vers le bas entre les ailes.
  const tuck = k.smoothCurve([[X_REAR, 0.04], [-1.85, 0.08], [-1.6, 0.13], [-0.85, 0.13], [-0.65, 0.05], [0.5, 0.05], [0.75, 0.02], [1.0, 0], [1.45, -0.03], [1.75, -0.06], [X_FRONT, -0.05]]);
  const yLow = k.smoothCurve([[X_REAR, 0.33], [-1.9, 0.3], [-0.7, 0.28], [0.6, 0.28], [1.6, 0.3], [X_FRONT, 0.44]]);
  const yMaxFrac = k.smoothCurve([[-0.9, 0.7], [-0.7, 0.615], [0.5, 0.615], [0.7, 0.7]]);
  // Dôme : inclinaison des vitres (rad), longueur de la tangente à la ceinture, rondeur du dessus.
  // Sur le capot avant (x > 0,85), la tangente à la ceinture penche vers l'intérieur : dôme rond.
  const tilt = k.smoothCurve([[-1.4, 0], [-0.95, 0.24], [0.45, 0.26], [0.62, 0.12], [0.8, 0.14], [0.95, 0.34], [1.2, 0.55], [X_FRONT, 0.62]]);
  const lift = k.smoothCurve([[-1.5, 0.55], [-1.0, 0.7], [0.45, 0.7], [0.8, 0.55], [1.1, 0.5]]);
  const crown = k.smoothCurve([[-1.6, 0.58], [-1.0, 0.72], [0.4, 0.72], [0.8, 0.55], [1.1, 0.45]]);
  // Demi-largeur du point E : bord du capot moteur, haut des vitres, bord du pare-brise, capot avant.
  const zEdge = k.smoothCurve([
    [X_REAR, 0.32],
    [-1.95, 0.35],
    [-1.6, 0.39],
    [-1.45, 0.42],
    [-1.15, 0.47],
    [-1.0, 0.49],
    [X_WS[0], 0.49],
    [X_WS[1], 0.56],
    [0.68, 0.48],
    [0.76, 0.42],
    [1.0, 0.41],
    [1.2, 0.39],
    [1.6, 0.345],
    [1.85, 0.31],
    [X_FRONT, 0.29],
  ]);

  /** Cotes de la section en x, bouts arrondis compris. @param {number} x */
  const dims = (x) => {
    const fI = (/** @type {number} */ r) => k.endInset(x, X_FRONT, r);
    const rI = (/** @type {number} */ r) => k.endInset(x, X_REAR, r);
    const t = ytop(x) - fI(0.03) - rI(0.02);
    const yb = ybot(x) + fI(0.04) + rI(0.03);
    const wB = wBelt(x) - fI(0.14) - rI(0.14);
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

  /** Indice de contour (dans la moitié, en points d'origine) d'une face du loft de caisse. @param {Face} f */
  const band = (f) => {
    const n = 2 * HALF_POINTS - 2;
    const pos = f.v * n;
    return pos <= HALF_POINTS - 1 ? pos : n - pos;
  };

  // Bord avant de la vitre de porte (suit le montant du pare-brise) et bord arrière de la custode.
  const xDoorFront = (/** @type {number} */ y) => X_DOOR[1] - 0.27 * clamp((y - 0.97) / 0.33, 0, 1);
  const xQtrRear = (/** @type {number} */ y) => X_QTR[0] + 0.24 * clamp((y - 0.97) / 0.3, 0, 1) ** 1.6;
  const inVents = (/** @type {number} */ x) => VENTS.some((v) => x < v && x > v - 0.011);

  /** @param {Face} f */
  const bodyRegion = (f) => {
    const az = Math.abs(f.z);
    const side = Math.sign(f.z) * f.nz;
    if (f.cap) return f.y < 0.27 ? 'black' : 'paint_carrosserie';
    if (f.ny < -0.5) return 'black';
    const p = band(f);
    if (p < I_BELT) {
      if (p < 9 && f.y < 0.29) return 'black';
      if (f.y < 0.27 && f.x > -1.9 && f.x < 1.8) return 'black';
      for (const ax of AXLES) if (Math.abs(f.x - ax) < ARCH_R + 0.06 && f.y < 0.6 && az > 0.38) return 'black';
      if (side > 0.4 && f.y > 0.3) for (const sx of SEAMS_X) if (f.x > sx && f.x < sx + SEAM) return 'black';
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
        if (az < 0.24 && inVents(f.x)) return 'black';
        return 'paint_capot_moteur';
      }
      if (p >= I_SEAM) return 'black';
      return 'paint_carrosserie';
    }
    // Lunette ovale.
    if (f.x > X_RW[0] && f.x < X_RW[1] && f.nx < 0) {
      const ex = (f.x - (X_RW[0] + X_RW[1]) / 2) / ((X_RW[1] - X_RW[0]) / 2);
      const ez = az / RW_Z;
      if (ex * ex + ez * ez < 1) return 'glass';
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
    xs: k.sampleX(X_REAR, X_FRONT, { step: 0.04, endZone: 0.12, endCount: 8, breaks }),
    around: 2,
    material: bodyRegion,
    crease: 60,
    capRows: 5,
    capColumns: 10,
  });

  // --- Ailes ---------------------------------------------------------------------------------
  /**
   * Une aile côté droit : loft dont la section (trapèze arrondi) est centrée sur zc(x), posée sur la
   * voûte du passage de roue au-dessus de l'essieu.
   * r1 : arrondi du bout avant (x1) ; round : fraction (0 à 1) qui rend la section ronde (bout du
   * ponton qui porte le phare).
   * @param {{ x0: number, x1: number, axle: number, crest: P2[], base: P2[], hw: P2[], zc: P2[], r1?: number, round?: P2[] }} o
   */
  const fender = (o) => {
    const yt = k.smoothCurve(o.crest);
    const yb0 = k.smoothCurve(o.base);
    const hw = k.smoothCurve(o.hw);
    const zc = k.smoothCurve(o.zc);
    const round = o.round ? k.smoothCurve(o.round) : () => 0;
    const dimsF = (/** @type {number} */ x) => {
      const ends = (/** @type {number} */ r) => k.endInset(x, o.x1, o.r1 ?? r) + k.endInset(x, o.x0, r);
      const t = yt(x) - ends(0.05);
      const dx = Math.abs(x - o.axle);
      let b = yb0(x) + ends(0.04);
      if (dx < ARCH_R) b = Math.max(b, WHEEL_R + Math.sqrt(ARCH_R * ARCH_R - dx * dx));
      b = Math.min(b, t - 0.035);
      const w = Math.max(0.02, hw(x) - ends(0.07));
      return { t, b, w };
    };
    return k.loft({
      sectionAt: (x) => {
        const { t, b, w } = dimsF(x);
        const c = zc(x);
        const q = clamp(round(x), 0, 1);
        const sec = k.mirrorSection(
          k.roundedHalf({
            bottom: b,
            top: t,
            halfWidthBottom: w,
            halfWidthTop: w * lerp(0.9, 1, q),
            rBottom: lerp(0.02, w, q),
            rTop: lerp(Math.min(w * 0.8, 0.14), w, q),
            crown: 0.006 * (1 - q),
            n: 6,
          }),
        );
        return sec.map(([z, y]) => /** @type {P2} */ ([z + c, y]));
      },
      xs: k.sampleX(o.x0, o.x1, { step: 0.04, endZone: 0.1, endCount: 6, breaks: [o.axle - ARCH_R, o.axle + ARCH_R] }),
      around: 1,
      // Dessous noir : la voûte du passage de roue, et ce qui regarde franchement le sol.
      // Le flanc intérieur qui dépasse dans l'habitacle (pieds avant et arrière) reste noir.
      material: (f) =>
        (f.ny < -0.35 && Math.abs(f.x - o.axle) < ARCH_R + 0.02) || f.ny < -0.8 || (Math.sign(f.z) * f.nz < -0.3 && f.x > -0.95 && f.x < 0.85) ? 'black' : 'paint_ailes',
      crease: 65,
      capRows: 4,
      capColumns: 6,
    });
  };
  const frontFender = fender({
    x0: 0.6,
    x1: HEAD_X,
    axle: AXLES[0],
    // Ponton : la crête monte doucement vers l'avant et finit au ras du cerclage du phare ; la
    // section devient ronde, centrée sur le phare (y 0,66 ; z 0,56).
    crest: [[0.6, 0.36], [0.65, 0.47], [0.72, 0.58], [0.84, 0.67], [1.0, 0.72], [1.2, 0.742], [1.45, 0.752], [1.62, 0.76], [1.74, 0.766], [1.81, 0.768], [HEAD_X, 0.768]],
    base: [[0.6, 0.27], [0.84, 0.28], [1.56, 0.3], [1.66, 0.34], [1.74, 0.41], [1.8, 0.49], [HEAD_X, 0.552]],
    hw: [[0.6, 0.05], [0.68, 0.12], [0.8, 0.18], [0.95, 0.205], [1.55, 0.205], [1.68, 0.18], [1.78, 0.142], [HEAD_X, 0.114]],
    zc: [[0.6, 0.71], [0.72, 0.63], [0.9, 0.57], [1.5, 0.57], [HEAD_X, 0.56]],
    round: [[0.95, 0.3], [1.45, 0.42], [1.72, 0.75], [1.8, 1]],
    r1: 0.012,
  });
  const rearFender = fender({
    x0: -2.02,
    x1: -0.62,
    axle: AXLES[1],
    crest: [[-2.02, 0.6], [-1.96, 0.67], [-1.8, 0.715], [-1.5, 0.73], [-1.2, 0.725], [-1.0, 0.7], [-0.86, 0.65], [-0.75, 0.57], [-0.67, 0.47], [-0.62, 0.36]],
    base: [[-2.02, 0.5], [-1.96, 0.42], [-1.86, 0.35], [-1.7, 0.31], [-1.56, 0.3], [-0.84, 0.28], [-0.62, 0.27]],
    hw: [[-2.02, 0.15], [-1.9, 0.175], [-0.95, 0.175], [-0.8, 0.16], [-0.7, 0.12], [-0.62, 0.05]],
    zc: [[-2.02, 0.6], [-0.95, 0.6], [-0.75, 0.63], [-0.62, 0.71]],
  });
  const fenders = k.symmetric([...frontFender, ...rearFender]);

  // Marchepieds : bande noire fine entre les ailes, jonc chromé au bord.
  const step = [
    ...k.place(k.roundedExtrude(k.roundedRect(1.26, 0.17, 0.02), { material: 'black', depth: 0.024, bevel: 0.008, axis: 'y' }), { position: [0, 0.27, 0.68] }),
    ...k.rod([-0.62, 0.278, 0.762], [0.62, 0.278, 0.762], 0.005, { material: 'chrome', radial: 8 }),
  ];

  // --- Optiques et chromes -------------------------------------------------------------------
  // Phare rond dressé au bout de l'aile avant, légèrement couché : cuvelage peint, cerclage chromé,
  // verre bombé.
  const headR = 0.095;
  const headN = /** @type {P3} */ ([Math.cos(0.14), Math.sin(0.14), 0]);
  const headAt = /** @type {P3} */ ([HEAD_X + 0.004, 0.66, 0.56]);
  const headPose = { position: headAt, normal: headN, up: /** @type {P3} */ ([0, 1, 0]) };
  /** @type {Parts} */
  const headlight = [
    ...k.orient(k.lathe([[headR + 0.004, -0.04], [headR + 0.011, -0.016], [headR + 0.011, -0.004], [headR + 0.002, 0.004]], { material: 'paint_ailes', segments: 40, crease: 60 }), headPose),
    ...k.orient(k.tube(k.circle(0, 0, headR + 0.006, 28).map(([a, b]) => /** @type {P3} */ ([a, b, 0.004])), { material: 'chrome', radius: 0.008, closed: true, segments: 40, radial: 8 }), headPose),
    ...k.orient(k.lamp(k.circle(0, 0, headR, 32), { material: 'lamp', bulge: 0.024, depth: 0.004 }), headPose),
  ];
  // Clignotant en obus chromé sur le dessus de l'aile avant.
  /** @type {Parts} */
  const blinker = [
    ...k.ellipsoid([1.45, 0.766, 0.6], [0.062, 0.022, 0.024], { material: 'chrome', segments: 16 }),
    ...k.ellipsoid([1.5, 0.768, 0.6], [0.018, 0.016, 0.018], { material: 'signal', segments: 14 }),
  ];
  // Feu arrière ovale dressé sur la face arrière de l'aile arrière.
  const tailPose = { position: /** @type {P3} */ ([-1.99, 0.6, 0.6]), normal: /** @type {P3} */ ([-1, 0.12, 0]), up: /** @type {P3} */ ([0, 1, 0]) };
  /** @type {Parts} */
  const taillight = [
    ...k.orient(k.roundedExtrude(k.roundedRect(0.1, 0.2, 0.05, 8), { material: 'chrome', depth: 0.03, bevel: 0.008 }), tailPose),
    ...k.orient(k.lamp(k.roundedRect(0.084, 0.184, 0.042, 8), { material: 'tail', bulge: 0.012, depth: 0.004 }), { ...tailPose, position: /** @type {P3} */ ([-2.006, 0.6, 0.6]) }),
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

  // Poignées de porte chromées, sous la ceinture, à l'arrière de la porte.
  const handle = k.place(k.roundedExtrude(k.roundedRect(0.13, 0.026, 0.012), { material: 'chrome', depth: 0.03, bevel: 0.009 }), { position: [-0.3, 0.9, 0.672] });
  // Poignée du capot avant, sur le nez.
  const hoodHandle = k.orient(k.roundedExtrude(k.roundedRect(0.12, 0.03, 0.014), { material: 'chrome', depth: 0.03, bevel: 0.01 }), { position: [1.895, 0.658, 0], normal: [0.62, 0.78, 0], up: [0, 1, 0] });
  // Deux sorties d'échappement fines sous le tablier arrière.
  /** @type {Parts} */
  const exhaust = [];
  for (const z of [-0.26, 0.26]) {
    const pipe = k.lathe([[0.015, 0.14], [0.015, 0.0], [0.019, 0.0], [0.019, 0.12], [0.017, 0.14]], { material: 'chrome', segments: 20, axis: 'x', crease: 60 });
    exhaust.push(...k.place(pipe, { position: [X_REAR + 0.01, 0.245, z] }));
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
    ...k.tube([onLower(0.3, F0), onLower(0.27, 0.5), onLower(0.24, 0.99)], { material: 'chrome', radius: 0.0045, segments: 12, radial: 6 }),
  ];
  // Jonc du pare-brise : bas, côtés le long de E, haut.
  /** @type {P3[]} */
  const wsLoop = [];
  const zWsAt = (/** @type {number} */ x) => dims(x).zE;
  for (let i = 0; i <= 12; i += 1) wsLoop.push(onDome(X_WS[1] - 0.004, lerp(-zWsAt(X_WS[1]), zWsAt(X_WS[1]), i / 12)));
  for (let i = 1; i < 10; i += 1) {
    const x = lerp(X_WS[1], X_WS[0], i / 10);
    wsLoop.push(onDome(x, zWsAt(x) - 0.003));
  }
  for (let i = 0; i <= 12; i += 1) wsLoop.push(onDome(X_WS[0] + 0.004, lerp(zWsAt(X_WS[0]), -zWsAt(X_WS[0]), i / 12)));
  for (let i = 1; i < 10; i += 1) {
    const x = lerp(X_WS[0], X_WS[1], i / 10);
    wsLoop.push(onDome(x, -zWsAt(x) + 0.003));
  }
  const wsTrim = k.tube(wsLoop, { material: 'chrome', radius: 0.0055, closed: true, segments: 120, radial: 6 });
  // Jonc de la lunette ovale.
  /** @type {P3[]} */
  const rwLoop = [];
  for (let i = 0; i < 40; i += 1) {
    const a = (2 * Math.PI * i) / 40;
    const x = (X_RW[0] + X_RW[1]) / 2 + ((X_RW[1] - X_RW[0]) / 2) * Math.cos(a);
    const z = RW_Z * Math.sin(a);
    const p = onDome(x, z, 0.005);
    rwLoop.push([x - 0.003, p[1], p[2]]);
  }
  const rwTrim = k.tube(rwLoop, { material: 'chrome', radius: 0.0055, closed: true, segments: 80, radial: 6 });

  // Rétroviseur rond sur la porte conducteur (côté gauche, -Z).
  /** @type {Parts} */
  const mirror = [
    ...k.rod([0.4, 0.96, -0.665], [0.37, 1.05, -0.75], 0.008, { material: 'chrome', radial: 8 }),
    ...k.orient(k.lathe([[0.052, -0.012], [0.055, 0.0], [0.047, 0.012], [0, 0.014]], { material: 'chrome', segments: 32, crease: 60 }), { position: [0.37, 1.07, -0.76], normal: [1, 0, 0.1], up: [0, 1, 0] }),
    ...k.orient(k.lathe([[0, -0.012], [0.047, -0.012], [0.052, -0.01]], { material: 'glass', segments: 32 }), { position: [0.37, 1.07, -0.76], normal: [1, 0, 0.1], up: [0, 1, 0] }),
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
    windows: [windowLoop(xDoorFrontAt, () => X_DOOR[0]), windowLoop(() => X_QTR[1], xQtrRearAt), wsLoop],
    onDome,
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
  m.add('carrosserie', [...body, ...fenders, ...k.symmetric(step)]);
  m.add('habitacle', cabin);
  m.add('accessoires', [
    ...k.symmetric([...headlight, ...blinker, ...taillight, ...handle, ...trims]),
    ...wsTrim,
    ...rwTrim,
    ...hoodHandle,
    ...exhaust,
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

