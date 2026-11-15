// @ts-check
// La Cox (placeholder_cox) : berline ronde à deux portes des années 70, moteur arrière, rabaissée,
// sans pare-chocs, jantes alliage à 8 branches. Substitut modelé par le code d'après la fiche
// « La Cox » (captures/notes-agents/vague-g-fiches.md), à remplacer un jour par un vrai modèle aux
// mêmes conventions, sans toucher au code.
// Cotes : longueur 4,08 ; largeur 1,55 (ailes) ; hauteur 1,44 ; empattement 2,40 ; voies 1,31 avant
// et 1,35 arrière ; roues de 0,60 (jantes de 15 pouces, pneus taille basse) ; garde au sol 0,11.
//
// Construction : une caisse en un seul loft (bas de caisse, puis dessus en courbe de Bézier de la
// ceinture au milieu du pavillon) ; les vitres, les capots et le toit sont repérés par le paramètre
// u de cette courbe, échantillonnée à des valeurs fixes : leurs bords tombent sur des lignes du
// maillage et restent nets. Quatre ailes en lofts à part, posées de chaque côté, marchepieds entre
// elles, phares ronds dressés au bout des ailes avant.

/** @typedef {typeof import('../../../tools/vehicles/kit.mjs')} Kit */
/** @typedef {import('../../../tools/vehicles/kit.mjs').Parts} Parts */
/** @typedef {import('../../../tools/vehicles/kit.mjs').Face} Face */
/** @typedef {[number, number]} P2 */
/** @typedef {[number, number, number]} P3 */

const X_FRONT = 1.97; // bout du tablier avant (les ailes avant vont jusqu'à 1,99)
const X_REAR = -2.07; // bout du tablier arrière (les ailes arrière vont jusqu'à -2,09)
const AXLES = /** @type {const} */ ([1.2, -1.2]);
const WHEEL_R = 0.3;
const ARCH_R = 0.34; // rayon des passages de roue dans les ailes
const TRACK_Z = /** @type {const} */ ([0.655, 0.675]); // demi-voies avant, arrière
const FENDER_Z = /** @type {const} */ ([0.6, 0.61]); // axe des ailes avant, arrière

// Paramètres u de la courbe du dessus (0 : ceinture, 1 : milieu du pavillon). Les bords des régions
// sont des valeurs de cette liste.
const U_HOOD = 0.3; // bord des capots (avant)
const U_LID = 0.42; // bord du capot moteur
const U_WIN = 0.53; // haut des vitres latérales
const U_WS = 0.6; // bas du pare-brise et de la lunette sur les côtés
const U_ROOF = 0.66; // bord du toit
const SEAM = 0.016;
const U_SAMPLES = [0, 0.06, 0.12, 0.18, 0.24, U_HOOD - SEAM, U_HOOD, 0.35, U_LID - SEAM, U_LID, 0.475, U_WIN, 0.565, U_WS, U_ROOF, 0.72, 0.78, 0.83, 0.89, 0.94, 0.975, 1];

const X_COWL = 0.72; // bas du pare-brise
const X_WS_TOP = 0.44; // haut du pare-brise
const X_HOOD = 0.79; // arrière du capot avant
const X_LID = -1.29; // haut du capot moteur
const X_RW = /** @type {const} */ ([-1.27, -0.95]); // lunette, de bas en haut
const RW_Z = 0.3; // demi-largeur de la lunette
const X_B = /** @type {const} */ ([-0.41, -0.37]); // montant milieu
const X_Q = -1.0; // arrière de la vitre de custode
const SEAMS_X = [0.52, -0.39];
const VENTS = [-1.335, -1.365, -1.395, -1.425, -1.455];

/** @param {number} a @param {number} b @param {number} t */
const lerp = (a, b, t) => a + (b - a) * t;
/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** @param {Kit} k */
export default function cox(k) {
  // --- Cotes de la caisse le long de X ----------------------------------------------------------
  const top = k.smoothCurve([
    [X_REAR, 0.5],
    [-2.03, 0.6],
    [-1.9, 0.72],
    [-1.62, 0.86],
    [-1.3, 1.03],
    [-1.0, 1.24],
    [-0.72, 1.355],
    [-0.42, 1.418],
    [-0.1, 1.44],
    [0.18, 1.424],
    [X_WS_TOP, 1.38],
    [0.585, 1.18],
    [X_COWL, 0.975],
    [0.86, 0.935],
    [1.2, 0.86],
    [1.55, 0.765],
    [1.78, 0.685],
    [1.92, 0.605],
    [X_FRONT, 0.54],
  ]);
  const shoulder = k.smoothCurve([
    [X_REAR, 0.4],
    [-1.95, 0.5],
    [-1.62, 0.66],
    [-1.3, 0.81],
    [-1.0, 0.93],
    [-0.8, 0.965],
    [0.5, 0.965],
    [X_COWL, 0.84],
    [1.2, 0.68],
    [1.6, 0.6],
    [X_FRONT, 0.42],
  ]);
  const halfWidth = k.smoothCurve([
    [X_REAR, 0.5],
    [-1.9, 0.54],
    [-1.4, 0.58],
    [-0.95, 0.645],
    [-0.6, 0.665],
    [0.3, 0.668],
    [0.6, 0.64],
    [0.9, 0.56],
    [1.3, 0.48],
    [1.7, 0.4],
    [X_FRONT, 0.33],
  ]);
  const halfWidthBottom = k.smoothCurve([
    [X_REAR, 0.42],
    [-1.7, 0.47],
    [-1.25, 0.49],
    [-0.85, 0.58],
    [-0.6, 0.62],
    [0.5, 0.62],
    [0.8, 0.52],
    [1.25, 0.46],
    [X_FRONT, 0.37],
  ]);
  const bottom = k.smoothCurve([
    [X_REAR, 0.4],
    [-1.95, 0.24],
    [-1.6, 0.13],
    [-1.2, 0.11],
    [1.3, 0.11],
    [1.7, 0.17],
    [1.88, 0.28],
    [X_FRONT, 0.38],
  ]);
  const tumble = k.smoothCurve([
    [X_REAR, 0.03],
    [-1.3, 0.05],
    [-0.9, 0.13],
    [0.5, 0.13],
    [0.82, 0.04],
    [X_FRONT, 0.02],
  ]);

  /** Cotes de la section en x, bouts arrondis compris. @param {number} x */
  const dims = (x) => {
    const front = (/** @type {number} */ r) => k.endInset(x, X_FRONT, r);
    const rear = (/** @type {number} */ r) => k.endInset(x, X_REAR, r);
    const t = top(x) - front(0.07) - rear(0.06);
    const yb = bottom(x) + front(0.05) + rear(0.05);
    const w = halfWidth(x) - front(0.1) - rear(0.1);
    const wb = Math.min(w - 0.02, halfWidthBottom(x) - front(0.08) - rear(0.08));
    const s = clamp(shoulder(x), yb + 0.12, t - 0.05);
    const tb = Math.min(tumble(x), w * 0.3);
    return { t, yb, w, wb, s, tb };
  };

  /** Point [z, y] de la courbe du dessus en u. @param {ReturnType<typeof dims>} d @param {number} u @returns {P2} */
  const upper = (d, u) => {
    const h = d.t - d.s;
    const p0 = [d.w, d.s];
    const p1 = [d.w - d.tb, d.s + 0.62 * h];
    const p2 = [0.6 * d.w, d.t];
    const p3 = [0, d.t];
    const a = (1 - u) ** 3;
    const b = 3 * (1 - u) ** 2 * u;
    const c = 3 * (1 - u) * u * u;
    const e = u ** 3;
    return [a * p0[0] + b * p1[0] + c * p2[0] + e * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + e * p3[1]];
  };
  /** Paramètre u d'une hauteur y sur la courbe du dessus (y croît avec u). @param {ReturnType<typeof dims>} d @param {number} y */
  const uAtY = (d, y) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2;
      if (upper(d, mid)[1] < y) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  /** Paramètre u d'une demi-largeur z (z décroît avec u). @param {ReturnType<typeof dims>} d @param {number} z */
  const uAtZ = (d, z) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2;
      if (upper(d, mid)[0] > z) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };

  /** Moitié droite de la section en x. @param {number} x @returns {P2[]} */
  const half = (x) => {
    const d = dims(x);
    const rb = Math.min(0.06, (d.s - d.yb) * 0.3);
    /** @type {P2[]} */
    const pts = [];
    for (let i = 0; i < 3; i += 1) pts.push([((d.wb - rb) * i) / 3, d.yb]);
    for (const deg of [-90, -60, -30]) {
      const a = (deg * Math.PI) / 180;
      pts.push([d.wb - rb + rb * Math.cos(a), d.yb + rb + rb * Math.sin(a)]);
    }
    for (let j = 0; j < 6; j += 1) {
      const s = j / 6;
      const y = lerp(d.yb + rb, d.s, s);
      pts.push([d.wb + (d.w - d.wb) * (1 - (1 - s) ** 2), y]);
    }
    for (const u of U_SAMPLES) pts.push(upper(d, u));
    return pts;
  };

  // Bord avant des vitres de porte : suit le montant du pare-brise. @param {number} y
  const xA = (/** @type {number} */ y) => X_COWL - 0.06 - 0.88 * (y - 0.965);
  // Bord arrière de la vitre de custode, arrondi en haut. @param {number} y @param {number} yTop
  const xQ = (/** @type {number} */ y, /** @type {number} */ yTop) => {
    const s = clamp((y - 0.965) / Math.max(0.05, yTop - 0.965), 0, 1);
    return X_Q + 0.2 * s ** 1.6;
  };

  /** @param {Face} f */
  const bodyRegion = (f) => {
    const az = Math.abs(f.z);
    const side = Math.sign(f.z) * f.nz;
    if (f.ny < -0.5) return 'black';
    if (f.y < 0.26 && f.x > X_REAR + 0.15 && f.x < X_FRONT - 0.15) return 'black';
    for (const ax of AXLES) if (Math.abs(f.x - ax) < ARCH_R + 0.04 && f.y < 0.66 && side > 0.15 && az > 0.4) return 'black';
    const d = dims(f.x);
    if (f.y > d.s + 1e-4) {
      const u = uAtY(d, f.y);
      // Capot avant, et ses joints.
      if (f.x > X_HOOD) {
        if (f.x < X_HOOD + 0.007 && u > U_HOOD - SEAM) return 'black';
        if (u > U_HOOD - SEAM && u < U_HOOD) return 'black';
        if (u > U_HOOD) return 'paint_capot';
        return 'paint_carrosserie';
      }
      // Capot moteur, ses joints et ses fentes d'aération.
      if (f.x < X_LID) {
        if (f.x > X_LID - 0.007 && u > U_LID - SEAM) return 'black';
        if (u > U_LID - SEAM && u < U_LID && f.y > 0.5) return 'black';
        if (u > U_LID && f.y > 0.5) {
          if (az < 0.22) for (const v of VENTS) if (f.x < v && f.x > v - 0.012) return 'black';
          return 'paint_capot_moteur';
        }
        return 'paint_carrosserie';
      }
      // Pare-brise.
      if (f.x > X_WS_TOP && f.x < X_COWL && u > U_WS && f.nx > 0.2 && Math.abs(f.nz) < 0.45 && f.y > 0.985) return 'glass';
      // Lunette ovale.
      if (f.x > X_RW[0] && f.x < X_RW[1] && f.nx < -0.1 && u > U_WS) {
        const ex = (f.x - (X_RW[0] + X_RW[1]) / 2) / ((X_RW[1] - X_RW[0]) / 2);
        const ez = az / RW_Z;
        if (ex * ex + ez * ez < 1) return 'glass';
      }
      // Vitres latérales : porte (bord avant incliné), custode (bord arrière arrondi).
      if (u < U_WIN && side > 0.2) {
        const yTop = upper(d, U_WIN)[1];
        if (f.x > X_B[1] && f.x < xA(f.y)) return 'glass';
        if (f.x < X_B[0] && f.x > xQ(f.y, yTop)) return 'glass';
      }
      if (u > U_ROOF && f.x > X_RW[1] && f.x < X_WS_TOP) return 'paint_toit';
      return 'paint_carrosserie';
    }
    // Joints de porte sous la ceinture.
    if (side > 0.4 && f.y > 0.3) for (const sx of SEAMS_X) if (f.x > sx && f.x < sx + 0.006) return 'black';
    return 'paint_carrosserie';
  };

  const breaks = [
    X_COWL, X_WS_TOP, X_HOOD, X_HOOD + 0.007, X_LID, X_LID - 0.007, ...X_RW, ...X_B, X_Q,
    ...SEAMS_X.flatMap((s) => [s, s + 0.006]),
    ...VENTS.flatMap((v) => [v, v - 0.012]),
    ...AXLES.flatMap((a) => [a - ARCH_R - 0.04, a + ARCH_R + 0.04]),
  ];
  const body = k.loft({
    sectionAt: (x) => k.mirrorSection(half(x)),
    xs: k.sampleX(X_REAR, X_FRONT, { step: 0.042, endZone: 0.12, endCount: 8, breaks }),
    around: 2,
    material: bodyRegion,
    crease: 60,
    capRows: 6,
    capColumns: 10,
  });

  // --- Ailes ---------------------------------------------------------------------------------
  /**
   * Une aile : loft symétrique autour de son axe (z local = 0), posé ensuite à z = zc.
   * @param {{ x0: number, x1: number, axle: number, top: P2[], base: P2[], hw: P2[] }} o
   */
  const fender = (o) => {
    const yt = k.smoothCurve(o.top);
    const yb0 = k.smoothCurve(o.base);
    const hw = k.smoothCurve(o.hw);
    const dimsF = (/** @type {number} */ x) => {
      const ends = (/** @type {number} */ r) => k.endInset(x, o.x1, r) + k.endInset(x, o.x0, r);
      const t = yt(x) - ends(0.04);
      const dx = Math.abs(x - o.axle);
      let b = yb0(x) + ends(0.03);
      if (dx < ARCH_R) b = Math.max(b, WHEEL_R + Math.sqrt(ARCH_R * ARCH_R - dx * dx));
      b = Math.min(b, t - 0.03);
      const w = Math.max(0.02, hw(x) - ends(0.05));
      return { t, b, w };
    };
    return k.loft({
      sectionAt: (x) => {
        const { t, b, w } = dimsF(x);
        return k.mirrorSection(
          k.roundedHalf({ bottom: b, top: t, halfWidthBottom: w, halfWidthTop: w * 0.97, rBottom: 0.025, rTop: Math.min(w * 0.85, 0.15), crown: 0.004, n: 6 }),
        );
      },
      xs: k.sampleX(o.x0, o.x1, { step: 0.04, endZone: 0.1, endCount: 6, breaks: [o.axle - ARCH_R, o.axle + ARCH_R] }),
      around: 1,
      material: (f) => (f.ny < -0.35 ? 'black' : 'paint_ailes'),
      crease: 65,
      capRows: 4,
      capColumns: 6,
    });
  };
  const frontFender = fender({
    x0: 0.42,
    x1: 1.99,
    axle: AXLES[0],
    top: [[0.42, 0.29], [0.58, 0.4], [0.8, 0.62], [1.02, 0.745], [1.3, 0.795], [1.6, 0.81], [1.8, 0.825], [1.92, 0.815], [1.99, 0.78]],
    base: [[0.42, 0.27], [0.8, 0.27], [1.6, 0.29], [1.85, 0.36], [1.99, 0.46]],
    hw: [[0.42, 0.075], [0.6, 0.12], [0.9, 0.158], [1.2, 0.168], [1.6, 0.165], [1.85, 0.15], [1.99, 0.125]],
  });
  const rearFender = fender({
    x0: -2.09,
    x1: -0.45,
    axle: AXLES[1],
    top: [[-2.09, 0.56], [-2.02, 0.68], [-1.85, 0.79], [-1.55, 0.85], [-1.25, 0.845], [-1.0, 0.77], [-0.8, 0.61], [-0.62, 0.42], [-0.45, 0.29]],
    base: [[-2.09, 0.44], [-1.9, 0.32], [-1.6, 0.29], [-0.45, 0.27]],
    hw: [[-2.09, 0.12], [-1.9, 0.155], [-1.5, 0.168], [-1.2, 0.168], [-0.9, 0.15], [-0.65, 0.11], [-0.45, 0.075]],
  });
  const fenders = k.symmetric([...k.place(frontFender, { position: [0, 0, FENDER_Z[0]] }), ...k.place(rearFender, { position: [0, 0, FENDER_Z[1]] })]);

  // Marchepieds : bande noire entre les ailes, jonc chromé au bord.
  const step = [
    ...k.place(k.roundedExtrude(k.roundedRect(1.5, 0.15, 0.03), { material: 'black', depth: 0.035, bevel: 0.012, axis: 'y' }), { position: [0, 0.285, 0.675] }),
    ...k.rod([-0.74, 0.3, 0.752], [0.74, 0.3, 0.752], 0.006, { material: 'chrome', radial: 8 }),
  ];

  // --- Optiques et chromes -------------------------------------------------------------------
  /** Phare rond dressé au bout de l'aile avant : cuvelage peint, cerclage chromé, verre bombé. */
  const headX = 1.995;
  const headY = 0.675;
  const headZ = FENDER_Z[0];
  const headR = 0.09;
  /** @type {Parts} */
  const headlight = [
    ...k.place(k.lathe([[headR + 0.008, -0.11], [headR + 0.014, -0.04], [headR + 0.013, 0], [headR - 0.004, 0.004]], { material: 'paint_ailes', segments: 40, crease: 60 }), { position: [headX, headY, headZ], rotation: [0, Math.PI / 2, 0] }),
    ...k.orient(k.tube(k.circle(0, 0, headR + 0.002, 28).map(([a, b]) => /** @type {P3} */ ([a, b, 0])), { material: 'chrome', radius: 0.009, closed: true, segments: 40, radial: 8 }), { position: [headX + 0.006, headY, headZ], normal: [1, 0, 0], up: [0, 1, 0] }),
    ...k.orient(k.lamp(k.circle(0, 0, headR - 0.004, 32), { material: 'lamp', bulge: 0.022, depth: 0.004 }), { position: [headX + 0.004, headY, headZ], normal: [1, 0, 0], up: [0, 1, 0] }),
  ];
  // Clignotant en obus chromé sur le dessus de l'aile avant.
  const signalX = 1.5;
  const signalY = 0.815;
  /** @type {Parts} */
  const blinker = [
    ...k.ellipsoid([signalX, signalY, headZ + 0.02], [0.065, 0.024, 0.026], { material: 'chrome', segments: 16 }),
    ...k.ellipsoid([signalX + 0.055, signalY + 0.002, headZ + 0.02], [0.018, 0.017, 0.019], { material: 'signal', segments: 14 }),
  ];
  // Feu arrière ovale dressé sur l'aile arrière.
  const tailX = -2.0;
  const tailY = 0.69;
  /** @type {Parts} */
  const taillight = [
    ...k.orient(k.roundedExtrude(k.roundedRect(0.1, 0.17, 0.05, 8), { material: 'chrome', depth: 0.02, bevel: 0.006 }), { position: [tailX, tailY, FENDER_Z[1]], normal: [-1, 0.25, 0], up: [0, 1, 0] }),
    ...k.orient(k.lamp(k.roundedRect(0.085, 0.155, 0.042, 8), { material: 'tail', bulge: 0.012, depth: 0.004 }), { position: [tailX - 0.011, tailY + 0.003, FENDER_Z[1]], normal: [-1, 0.25, 0], up: [0, 1, 0] }),
  ];
  // Poignées de porte chromées, sous la ceinture, à l'arrière de la porte.
  const handle = k.place(k.roundedExtrude(k.roundedRect(0.13, 0.026, 0.012), { material: 'chrome', depth: 0.03, bevel: 0.009 }), { position: [-0.27, 0.9, 0.668] });
  // Poignée du capot avant, sur le nez.
  const hoodHandle = k.orient(k.roundedExtrude(k.roundedRect(0.12, 0.03, 0.014), { material: 'chrome', depth: 0.03, bevel: 0.01 }), { position: [1.92, 0.61, 0], normal: [0.85, 0.5, 0], up: [0, 1, 0] });
  // Sorties d'échappement fines sous le tablier arrière.
  /** @type {Parts} */
  const exhaust = [];
  for (const z of [-0.3, 0.3]) {
    const pipe = k.lathe([[0.016, 0.1], [0.016, -0.03], [0.022, -0.03], [0.022, 0.08], [0.02, 0.1]], { material: 'chrome', segments: 20, axis: 'x', crease: 60 });
    exhaust.push(...k.place(pipe, { position: [X_REAR + 0.005, 0.27, z] }));
  }

  // Joncs chromés des vitres latérales : posés sur la caisse, le long des bords des régions.
  /** Point 3D de la surface (côté droit) en x et u, un peu en dehors. @param {number} x @param {number} u @returns {P3} */
  const onUpper = (x, u) => {
    const [z, y] = upper(dims(x), u);
    return [x, y + 0.002, z + 0.006];
  };
  /** Abscisse du bord avant de la vitre de porte à la hauteur u (point fixe). @param {number} u */
  const xAt = (u) => {
    let x = X_COWL;
    for (let i = 0; i < 12; i += 1) x = xA(upper(dims(x), u)[1]);
    return x;
  };
  /** Contour d'une vitre (bas, avant, haut, arrière), en points posés sur la surface. @param {(u: number) => number} xF @param {(u: number) => number} xR @returns {P3[]} */
  const windowLoop = (xF, xR) => {
    /** @type {P3[]} */
    const pts = [];
    const n = 8;
    for (let i = 0; i < n; i += 1) pts.push(onUpper(lerp(xR(0.01), xF(0.01), i / n), 0.01));
    for (let i = 0; i < 4; i += 1) pts.push(onUpper(xF(lerp(0.01, U_WIN, i / 4)), lerp(0.01, U_WIN, i / 4)));
    for (let i = 0; i < n; i += 1) pts.push(onUpper(lerp(xF(U_WIN), xR(U_WIN), i / n), U_WIN));
    for (let i = 0; i < 4; i += 1) pts.push(onUpper(xR(lerp(U_WIN, 0.01, i / 4)), lerp(U_WIN, 0.01, i / 4)));
    return pts;
  };
  const quarterRear = (/** @type {number} */ u) => {
    let x = X_Q;
    for (let i = 0; i < 8; i += 1) {
      const d = dims(x);
      x = xQ(upper(d, u)[1], upper(d, U_WIN)[1]);
    }
    return x;
  };
  /** @type {Parts} */
  const trims = [
    ...k.tube(windowLoop(xAt, () => X_B[1]), { material: 'chrome', radius: 0.0055, closed: true, segments: 80, radial: 6 }),
    ...k.tube(windowLoop(() => X_B[0], quarterRear), { material: 'chrome', radius: 0.0055, closed: true, segments: 80, radial: 6 }),
    // Montant du déflecteur, dans la vitre de porte.
    ...k.tube([onUpper(0.36, 0.005), onUpper(0.355, U_WIN * 0.5), onUpper(0.35, U_WIN - 0.005)], { material: 'chrome', radius: 0.005, segments: 12, radial: 8 }),
  ];
  // Jonc de la lunette ovale (les deux moitiés y sont : pas de symétrie à ajouter).
  /** @type {P3[]} */
  const rwLoop = [];
  for (let i = 0; i < 40; i += 1) {
    const a = (2 * Math.PI * i) / 40;
    const x = (X_RW[0] + X_RW[1]) / 2 + ((X_RW[1] - X_RW[0]) / 2) * Math.cos(a);
    const z = RW_Z * Math.sin(a);
    const d = dims(x);
    const [, y] = upper(d, uAtZ(d, Math.abs(z)));
    rwLoop.push([x - 0.004, y + 0.005, z]);
  }
  const rwTrim = k.tube(rwLoop, { material: 'chrome', radius: 0.0055, closed: true, segments: 80, radial: 6 });

  // Rétroviseur rond sur la porte conducteur (côté gauche, -Z).
  /** @type {Parts} */
  const mirror = [
    ...k.rod([0.44, 0.985, -0.655], [0.42, 1.08, -0.74], 0.008, { material: 'chrome', radial: 8 }),
    ...k.orient(k.lathe([[0.055, -0.012], [0.058, 0.0], [0.05, 0.012], [0, 0.014]], { material: 'chrome', segments: 32, crease: 60 }), { position: [0.42, 1.1, -0.75], normal: [1, 0, 0.1], up: [0, 1, 0] }),
    ...k.orient(k.lathe([[0, -0.012], [0.05, -0.012], [0.055, -0.01]], { material: 'glass', segments: 32 }), { position: [0.42, 1.1, -0.75], normal: [1, 0, 0.1], up: [0, 1, 0] }),
  ];

  // --- Habitacle (vu par les vitres) ---------------------------------------------------------
  const lining = k.loft({
    sectionAt: (x) => {
      const d = dims(x);
      return k.mirrorSection(k.roundedHalf({ bottom: 0.2, top: d.t - 0.04, halfWidthBottom: d.wb - 0.04, halfWidthTop: d.w - d.tb - 0.06, rTop: 0.18, rBottom: 0.04 }));
    },
    xs: k.sampleX(-1.22, 0.74, { step: 0.12, endZone: 0.06, endCount: 2 }),
    material: 'black',
    inward: true,
    capRows: 1,
    capColumns: 4,
  });
  /** @type {Parts} */
  const cabin = [...lining];
  for (const z of [-0.3, 0.3]) {
    cabin.push(...k.place(k.roundedExtrude(k.roundedRect(0.48, 0.12, 0.05), { material: 'paint_sellerie', depth: 0.46, bevel: 0.035 }), { position: [-0.02, 0.44, z] }));
    cabin.push(...k.place(k.roundedExtrude(k.roundedRect(0.13, 0.74, 0.06), { material: 'paint_sellerie', depth: 0.44, bevel: 0.035 }), { position: [-0.3, 0.84, z], rotation: [0, 0, 0.2] }));
  }
  cabin.push(...k.place(k.roundedExtrude(k.roundedRect(0.45, 0.12, 0.05), { material: 'paint_sellerie', depth: 1.05, bevel: 0.035 }), { position: [-0.86, 0.42, 0] }));
  cabin.push(...k.place(k.roundedExtrude(k.roundedRect(0.12, 0.5, 0.05), { material: 'paint_sellerie', depth: 1.05, bevel: 0.035 }), { position: [-1.08, 0.7, 0], rotation: [0, 0, 0.3] }));
  // Planche de bord noire et sa rangée d'interrupteurs.
  cabin.push(...k.place(k.roundedExtrude(k.roundedRect(0.26, 0.16, 0.06), { material: 'black', depth: 0.98, bevel: 0.03 }), { position: [0.6, 0.88, 0] }));
  for (let i = 0; i < 6; i += 1) cabin.push(...k.rod([0.51, 0.87, -0.1 + i * 0.05], [0.495, 0.87, -0.1 + i * 0.05], 0.009, { material: 'alu', radial: 8 }));
  // Volant noir à trois branches ajourées (côté conducteur, -Z).
  /** @type {Parts} */
  const wheelParts = [];
  wheelParts.push(...k.tube(k.circle(0, 0, 0.18, 14).map(([a, b]) => /** @type {P3} */ ([a, b, 0])), { material: 'black', radius: 0.014, closed: true, segments: 64, radial: 8 }));
  wheelParts.push(...k.lathe([[0.045, -0.02], [0.045, 0.01], [0, 0.02]], { material: 'black', segments: 20 }));
  for (const a of [Math.PI / 2 + Math.PI, Math.PI / 6, Math.PI - Math.PI / 6]) {
    for (const off of [-0.018, 0.018]) {
      const c = Math.cos(a);
      const s = Math.sin(a);
      wheelParts.push(...k.rod([0.04 * c - off * s, 0.04 * s + off * c, 0], [0.17 * c - off * 0.4 * s, 0.17 * s + off * 0.4 * c, 0], 0.0065, { material: 'black', radial: 6 }));
    }
  }
  cabin.push(...k.orient(wheelParts, { position: [0.4, 1.0, -0.3], normal: [-1, 0.6, 0], up: [0, 1, 0] }));
  // Levier de vitesses long à soufflet, pommeau en tête de mort ivoire.
  cabin.push(...k.place(k.lathe([[0.06, 0], [0.045, 0.04], [0.02, 0.1], [0.008, 0.13], [0, 0.13]], { material: 'black', segments: 16, axis: 'y' }), { position: [0.22, 0.2, 0] }));
  cabin.push(...k.rod([0.22, 0.3, 0], [0.13, 0.78, 0], 0.007, { material: 'alu', radial: 8 }));
  cabin.push(...k.ellipsoid([0.125, 0.81, 0], [0.032, 0.028, 0.026], { material: 'paint_pommeau', segments: 16 }));
  cabin.push(...k.ellipsoid([0.15, 0.786, 0], [0.016, 0.014, 0.019], { material: 'paint_pommeau', segments: 12 }));
  for (const z of [-0.011, 0.011]) cabin.push(...k.ellipsoid([0.152, 0.81, z], [0.006, 0.007, 0.007], { material: 'black', segments: 10 }));

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
    ...rwTrim,
    ...hoodHandle,
    ...exhaust,
    ...mirror,
  ]);

  // Roues : jante à 8 branches larges et bombées, déport creux, écrous apparents. Un maillage partagé.
  m.shared('roue', coxWheel(k));
  m.instance('roue_avant_droite', 'roue', { position: [AXLES[0], WHEEL_R, TRACK_Z[0]] });
  m.instance('roue_avant_gauche', 'roue', { position: [AXLES[0], WHEEL_R, -TRACK_Z[0]], rotation: [0, Math.PI, 0] });
  m.instance('roue_arriere_droite', 'roue', { position: [AXLES[1], WHEEL_R, TRACK_Z[1]] });
  m.instance('roue_arriere_gauche', 'roue', { position: [AXLES[1], WHEEL_R, -TRACK_Z[1]], rotation: [0, Math.PI, 0] });
  return m;
}

/**
 * Roue de la Cox : pneu taille basse du kit, jante alliage polie à 8 branches larges et bombées,
 * déport creux (le moyeu est en retrait, les branches remontent vers le rebord), écrous apparents.
 * Axe Z, face extérieure vers +Z, centre à l'origine.
 * @param {Kit} k
 * @returns {Parts}
 */
function coxWheel(k) {
  const outer = WHEEL_R;
  const r = 0.1905; // jante de 15 pouces
  const width = 0.19;
  const w = width / 2;
  const mat = 'paint_jantes';
  /** @type {Parts} */
  const parts = [...k.tire({ outer, rim: r, width })];
  // Fût et rebords, visibles des deux côtés.
  const barrel = k.lathe(
    [
      [r - 0.012, -w + 0.006],
      [r + 0.012, -w + 0.004],
      [r + 0.014, -w + 0.012],
      [r - 0.006, -w + 0.02],
      [r - 0.014, -w * 0.3],
      [r - 0.014, w * 0.45],
      [r - 0.004, w - 0.024],
      [r + 0.016, w - 0.014],
      [r + 0.014, w - 0.003],
      [r - 0.014, w - 0.006],
    ],
    { material: mat, segments: 56, crease: 55 },
  );
  for (const p of barrel) parts.push({ material: p.material, geometry: k.doubleSided(p.geometry) });
  // Cuvette : cône creux du rebord vers le moyeu en retrait.
  const zLip = w - 0.012;
  const zHub = 0.0;
  const hubR = 0.058;
  parts.push(...k.lathe([[r - 0.012, zLip - 0.004], [r - 0.03, zLip - 0.018], [hubR + 0.02, zHub - 0.012], [hubR, zHub - 0.015]], { material: 'black', segments: 48, crease: 70 }));
  // Huit branches larges, inclinées du moyeu (en retrait) au rebord.
  const n = 8;
  const len = r - 0.016 - hubR * 0.8;
  const tilt = Math.atan2(zLip - 0.01 - zHub, len);
  const spoke = k.roundedExtrude(
    [
      [0, -0.028],
      [len, -0.046],
      [len, 0.046],
      [0, 0.028],
    ],
    { material: mat, depth: 0.026, bevel: 0.012, bevelSegments: 3 },
  );
  for (let i = 0; i < n; i += 1) {
    const a = (2 * Math.PI * i) / n;
    const tilted = k.place(spoke, { position: [hubR * 0.8, 0, zHub + 0.004], rotation: [0, -tilt, 0] });
    parts.push(...k.place(tilted, { rotation: [0, 0, a] }));
  }
  // Moyeu poli bombé et écrous apparents (quatre).
  parts.push(...k.lathe([[hubR + 0.004, zHub - 0.01], [hubR + 0.004, zHub + 0.012], [hubR * 0.75, zHub + 0.024], [0, zHub + 0.03]], { material: mat, segments: 40, crease: 50 }));
  for (let i = 0; i < 4; i += 1) {
    const a = (2 * Math.PI * i) / 4 + Math.PI / 4;
    const rr = hubR * 0.62;
    parts.push(...k.rod([rr * Math.cos(a), rr * Math.sin(a), zHub + 0.015], [rr * Math.cos(a), rr * Math.sin(a), zHub + 0.036], 0.009, { material: 'chrome', radial: 6 }));
  }
  parts.push(...k.lathe([[0.012, zHub + 0.028], [0.012, zHub + 0.04], [0, zHub + 0.042]], { material: 'black', segments: 16 }));
  // Disque de frein dans l'ombre, derrière la jante.
  parts.push(...k.lathe([[r * 0.35, -w + 0.03], [r * 0.85, -w + 0.03], [r * 0.85, -w + 0.045], [r * 0.35, -w + 0.045]], { material: 'black', segments: 40, crease: 50 }));
  return parts;
}
