// La sportive (placeholder_sportive) : moto carénée de piste du milieu des années 2000, livrée
// orange, blanc et noir, jantes orange. Substitut modelé par le code d'après la fiche « La
// sportive » (captures/notes-agents/vague-g-fiches.md) et son gabarit chiffré, à remplacer un jour
// par un vrai modèle aux mêmes conventions, sans toucher au code.
// Cotes : empattement 1,41 (essieux à x = ±0,705) ; pneus de 0,60 × 0,12 (avant) et 0,63 × 0,19
// (arrière) ; longueur hors tout 2,03 ; largeur 0,72 aux rétroviseurs ; haut de bulle 1,12 ;
// selle à 0,82.
//
// Construction
// - Carénage intégral : un seul loft du nez (x = +0,80) à l'arrière des flancs (x = -0,16). Le bas
//   remonte en menton au-dessus de la roue avant puis plonge derrière elle jusqu'au sabot. La
//   livrée (orange, blanc, noir) et les optiques sont des régions du loft.
// - Réservoir, selles et coque arrière : un second loft, du haut du réservoir à la pointe de la
//   coque ; selles et réservoir y sont des régions.
// - Bulle : un loft mince en arche. Cadre, bras oscillant, garde-boue et silencieux : profils
//   balayés le long de courbes (outils.mjs). Roues : pneus de la boîte à outils, jantes à trois
//   branches dédoublées (outils.mjs).

import { disc, motoRim, ovalHalf, ovalProfile, rectProfile, sweep } from './outils.mjs';

const AX = 0.705; // demi-empattement
const RF = 0.3; // rayon du pneu avant
const RR = 0.315; // rayon du pneu arrière
const RIM = 0.216; // jante de 17 pouces
const RAKE = (23.5 * Math.PI) / 180;
const DIR = /** @type {const} */ ([-Math.sin(RAKE), Math.cos(RAKE)]); // axe de direction, vers le haut
const FORK_Z = 0.105; // demi-écartement des tubes de fourche

/** Point de l'axe des tubes de fourche à la distance s de l'essieu avant. */
const forkAt = (/** @type {number} */ s, /** @type {number} */ z = 0) => /** @type {[number, number, number]} */ ([AX + s * DIR[0], RF + s * DIR[1], z]);

/** @param {*} k */
export default function sportive(k) {
  const m = new k.Model('sportive');
  m.material('paint_carenage', { color: '#ff6a00' });
  m.material('paint_reservoir', { color: '#ff6a00' });
  m.material('paint_garde_boue', { color: '#ff6a00' });
  m.material('paint_bas_carenage', { color: '#f0efe9' });
  m.material('paint_coque_arriere', { color: '#111114' });
  m.material('paint_jantes', { color: '#ff6a00' });
  m.material('paint_cadre', { color: '#9aa0a8' });
  m.material('paint_fourche', { color: '#c9a23a' });
  m.material('paint_selle', { color: '#111111' });

  // --- Carénage ---------------------------------------------------------------------------------
  const X_NOSE = 0.8;
  const X_FEND = -0.16;
  const fTop = k.smoothCurve([
    [X_FEND, 0.56], [-0.1, 0.62], [0.0, 0.66], [0.2, 0.7], [0.3, 0.72], [0.34, 0.77], [0.38, 0.87],
    [0.42, 0.95], [0.46, 0.985], [0.52, 0.99], [0.6, 0.975], [0.66, 0.95], [0.7, 0.925], [0.74, 0.885],
    [0.77, 0.85], [X_NOSE, 0.815],
  ]);
  const fBot = k.smoothCurve([
    [X_FEND, 0.3], [-0.13, 0.24], [-0.08, 0.19], [0.0, 0.17], [0.3, 0.17], [0.335, 0.18], [0.36, 0.24],
    [0.385, 0.34], [0.41, 0.45], [0.44, 0.53], [0.47, 0.585], [0.5, 0.62], [0.54, 0.645], [0.6, 0.66],
    [0.68, 0.675], [0.73, 0.7], [0.77, 0.75], [X_NOSE, 0.785],
  ]);
  const fW = k.smoothCurve([
    [X_FEND, 0.2], [-0.05, 0.23], [0.1, 0.245], [0.25, 0.25], [0.38, 0.25], [0.48, 0.245], [0.58, 0.225],
    [0.66, 0.18], [0.72, 0.13], [0.76, 0.083], [0.785, 0.045], [X_NOSE, 0.015],
  ]);
  const fYm = k.smoothCurve([[X_FEND, 0.5], [0.3, 0.52], [0.45, 0.5], [0.6, 0.45], [X_NOSE, 0.5]]);
  const fPt = k.smoothCurve([[X_FEND, 2.8], [0.3, 2.8], [0.45, 2.1], [X_NOSE, 2.1]]);
  const fairHalf = (/** @type {number} */ x) => {
    const yt = fTop(x) - k.endInset(x, X_FEND, 0.07);
    const yb = fBot(x) + k.endInset(x, X_FEND, 0.06);
    const w = Math.max(0.004, fW(x) - k.endInset(x, X_FEND, 0.12) - k.endInset(x, X_NOSE, 0.02));
    return ovalHalf({ yb, yt, w, ym: yb + (yt - yb) * fYm(x), pb: 2.6, pt: fPt(x), nb: 16, nt: 18 });
  };
  // Livrée et optiques : les bords suivent les lignes du maillage (indice de contour i, de 0 au
  // milieu du dessous à 34 au milieu du dessus ; 16 = largeur maxi) et des abscisses imposées,
  // pour des bords nets sans marches d'escalier.
  const FV = [[0.065, 0.088], [0.115, 0.138], [0.165, 0.188], [0.215, 0.238]]; // ouïes
  /** @param {*} f */
  const fairMat = (f) => {
    if (f.cap) return 'black';
    const i = Math.min(f.v, 1 - f.v) * 68;
    if (f.x > 0.665 && f.x < 0.785 && i > 15.5 && i < 22.5) return i > 16.5 && i < 21.5 ? 'lamp' : 'black'; // optiques effilées
    if (f.x > 0.28 && f.x < 0.43 && i > 24) return 'black'; // intérieur du carénage, derrière la bulle
    if (f.nx < -0.5 && f.y > 0.62 && f.x > 0.25 && f.x < 0.43) return 'black';
    if (f.x > 0.42 && i > 28) return 'black'; // dessus du nez et tableau de bord
    if (f.x > 0.72 && i < 11) return 'black'; // prise d'air sous le nez
    if (f.x > 0.335 && f.x < 0.47 && i < 12) return 'black'; // face avant des flancs (radiateur)
    if (i > 15 && i < 20 && FV.some(([a, b]) => f.x > a && f.x < b)) return 'black'; // ouïes latérales
    if (i < 8) return 'paint_coque_arriere'; // sabot
    if (i < 14 && f.x < 0.4) return 'paint_bas_carenage'; // bas de carénage
    if (i > 20 && i < 22.5 && f.x > -0.1 && f.x < 0.6) return 'paint_bas_carenage'; // bande médiane
    return 'paint_carenage';
  };
  m.add(
    'carenage',
    k.loft({
      sectionAt: (x) => k.mirrorSection(fairHalf(x)),
      xs: k.sampleX(X_FEND, X_NOSE, { step: 0.014, endZone: 0.12, breaks: [0.28, 0.335, 0.36, 0.385, 0.4, 0.42, 0.43, 0.47, 0.6, 0.665, 0.72, 0.785, -0.1, ...FV.flat()] }),
      around: 2,
      material: fairMat,
      crease: 70,
    }),
  );

  // --- Réservoir, selles, coque arrière ---------------------------------------------------------
  const X_TF = 0.31;
  const X_TIP = -0.985;
  const tTop = k.smoothCurve([
    [X_TIP, 0.98], [-0.94, 0.972], [-0.86, 0.955], [-0.76, 0.937], [-0.68, 0.927], [-0.6, 0.922], [-0.53, 0.915],
    [-0.5, 0.89], [-0.47, 0.845], [-0.42, 0.826], [-0.3, 0.82], [-0.22, 0.826], [-0.19, 0.845], [-0.15, 0.9],
    [-0.08, 0.95], [0.02, 0.975], [0.12, 0.98], [0.22, 0.955], [0.28, 0.91], [X_TF, 0.865],
  ]);
  const tBot = k.smoothCurve([
    [X_TIP, 0.96], [-0.95, 0.935], [-0.85, 0.895], [-0.7, 0.84], [-0.55, 0.785], [-0.4, 0.69], [-0.25, 0.64],
    [-0.15, 0.635], [0.0, 0.68], [X_TF, 0.7],
  ]);
  const tW = k.smoothCurve([
    [X_TIP, 0.008], [-0.95, 0.03], [-0.85, 0.065], [-0.7, 0.1], [-0.55, 0.12], [-0.42, 0.13], [-0.3, 0.14],
    [-0.2, 0.15], [-0.12, 0.18], [0.0, 0.205], [0.15, 0.21], [0.25, 0.195], [X_TF, 0.155],
  ]);
  const knee = k.smoothCurve([[-0.2, 0], [-0.12, 0.14], [0.02, 0.14], [0.12, 0]]);
  const tYm = k.smoothCurve([[X_TIP, 0.45], [-0.5, 0.5], [-0.2, 0.62], [0.1, 0.55], [X_TF, 0.5]]);
  const tankHalf = (/** @type {number} */ x) => {
    const yt = tTop(x) - k.endInset(x, X_TF, 0.04);
    const yb = tBot(x) + k.endInset(x, X_TF, 0.03);
    const w = Math.max(0.004, tW(x) - k.endInset(x, X_TF, 0.06));
    const kn = knee(x);
    const yk = yb + (yt - yb) * 0.45;
    return ovalHalf({
      yb, yt, w, ym: yb + (yt - yb) * tYm(x), pb: 2.2, pt: 2.8, nb: 14, nt: 20,
      pinch: (y) => 1 - kn * Math.exp(-(((y - yk) / 0.1) ** 2)),
    });
  };
  /** @param {*} f */
  const tankMat = (f) => {
    if (f.cap) return f.x > 0 ? 'black' : 'tail';
    if (f.x < -0.935 && f.nx < -0.2) return 'tail';
    if (f.x > -0.19) return 'paint_reservoir';
    if (f.x > -0.465 && f.ny > 0.42) return 'paint_selle';
    if (f.x > -0.71 && f.x <= -0.465 && f.y > 0.84 && (f.ny > 0.42 || f.nx > 0.3)) return 'paint_selle';
    return 'paint_coque_arriere';
  };
  m.add(
    'reservoir',
    k.loft({
      sectionAt: (x) => k.mirrorSection(tankHalf(x)),
      xs: k.sampleX(X_TIP, X_TF, { step: 0.014, endZone: 0.05, breaks: [-0.19, -0.465, -0.71] }),
      around: 2,
      material: tankMat,
      crease: 70,
    }),
  );

  // --- Bulle fumée ------------------------------------------------------------------------------
  const sX0 = 0.4;
  const sX1 = 0.668;
  const sW = k.smoothCurve([[sX0, 0.115], [0.42, 0.14], [0.47, 0.168], [0.55, 0.18], [0.62, 0.16], [sX1, 0.1]]);
  const sTop = k.smoothCurve([[sX0, 1.118], [0.42, 1.12], [0.45, 1.108], [0.52, 1.072], [0.6, 1.015], [sX1, 0.955]]);
  const sEdge = k.smoothCurve([[sX0, 0.93], [0.5, 0.935], [0.6, 0.925], [sX1, 0.9]]);
  const screenSection = (/** @type {number} */ x) => {
    const w = sW(x);
    const yt = sTop(x);
    const ye = Math.min(sEdge(x), yt - 0.02);
    /** @type {[number, number][]} */
    const outer = [];
    /** @type {[number, number][]} */
    const inner = [];
    const n = 24;
    for (let i = 0; i <= n; i += 1) {
      const a = (Math.PI * i) / n;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const z = w * Math.sign(c) * Math.abs(c) ** 0.8;
      const y = ye + (yt - ye) * s ** 0.7;
      outer.push([z, y]);
      inner.push([z * (1 - 0.004 / w), ye + (yt - 0.004 - ye) * s ** 0.7]);
    }
    return [...outer, ...inner.reverse()];
  };
  m.add('bulle', k.loft({ sectionAt: screenSection, xs: k.sampleX(sX0, sX1, { step: 0.015, endZone: 0.03 }), material: 'glass', crease: 80 }));

  // --- Garde-boue avant, lèche-roue arrière -----------------------------------------------------
  const arcPts = (/** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ r, /** @type {number} */ a0, /** @type {number} */ a1, n = 8) =>
    Array.from({ length: n + 1 }, (_, i) => {
      const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
      return /** @type {[number, number, number]} */ ([cx + r * Math.cos(a), cy + r * Math.sin(a), 0]);
    });
  /** Coque mince en arche au-dessus du pneu (b vers l'axe de la roue). */
  const shellProfile = (/** @type {number} */ hw, /** @type {number} */ e) => {
    /** @type {[number, number][]} */
    const pts = [];
    const n = 12;
    for (let i = 0; i <= n; i += 1) {
      const a = -hw + (2 * hw * i) / n;
      pts.push([a, -0.018 * (1 - (a / hw) ** 2) + 0.012 * (a / hw) ** 4]);
    }
    for (let i = n; i >= 0; i -= 1) {
      const a = (-hw + (2 * hw * i) / n) * (1 - e / hw);
      pts.push([a, -0.018 * (1 - (a / hw) ** 2) + 0.012 * (a / hw) ** 4 + e]);
    }
    return pts;
  };
  m.add('garde_boue', sweep(k, arcPts(AX, RF, RF + 0.028, 40, 118), {
    material: 'paint_garde_boue', samples: 40, crease: 75,
    profile: (t) => shellProfile(0.064 - 0.01 * Math.abs(t - 0.45), 0.004),
  }));

  // --- Fourche inversée, tés, étriers -----------------------------------------------------------
  /** @type {*[]} */
  const fork = [];
  for (const z of [-FORK_Z, FORK_Z]) {
    fork.push(...k.rod(forkAt(0.26, z), forkAt(0.64, z), 0.0275, { material: 'paint_fourche', radial: 20 }));
    fork.push(...k.rod(forkAt(0.24, z), forkAt(0.27, z), 0.03, { material: 'black', radial: 20 }));
    fork.push(...k.rod(forkAt(-0.01, z), forkAt(0.25, z), 0.021, { material: 'chrome', radial: 18 }));
    fork.push(...k.rod(forkAt(-0.035, z), forkAt(0.05, z), 0.026, { material: 'black', radial: 14 }));
    // Étrier radial, derrière le plongeur, à cheval sur le disque.
    const ca = (160 * Math.PI) / 180;
    const cr = 0.128;
    fork.push(...k.place(k.roundedExtrude(k.roundedRect(0.1, 0.035, 0.012), { material: 'paint_fourche', depth: 0.042, bevel: 0.006 }), {
      position: [AX + cr * Math.cos(ca), RF + cr * Math.sin(ca), Math.sign(z) * 0.072],
      rotation: [0, 0, ca + Math.PI / 2],
    }));
  }
  // Tés de fourche (plaques perpendiculaires à l'axe de direction).
  for (const s of [0.47, 0.615]) {
    const p = forkAt(s);
    fork.push(...k.place(k.roundedExtrude(k.roundedRect(0.1, 2 * FORK_Z + 0.07, 0.03), { material: 'alu', depth: s > 0.5 ? 0.022 : 0.032, bevel: 0.006, axis: 'y' }), {
      position: [p[0] - 0.035, p[1], 0],
      rotation: [0, 0, RAKE],
    }));
  }
  fork.push(...k.rod(forkAt(-0.0, -FORK_Z - 0.03), forkAt(0, FORK_Z + 0.03), 0.01, { material: 'alu', radial: 10 }));
  m.add('fourche', fork);

  // --- Cadre périmétrique, bras oscillant -------------------------------------------------------
  /** @type {*[]} */
  const frame = [];
  for (const sz of [-1, 1]) {
    frame.push(...sweep(k, [[0.41, 0.775, 0.05 * sz], [0.32, 0.735, 0.13 * sz], [0.15, 0.66, 0.15 * sz], [-0.05, 0.56, 0.15 * sz], [-0.17, 0.47, 0.145 * sz], [-0.2, 0.38, 0.14 * sz]], {
      material: 'paint_cadre', samples: 28, profile: (t) => rectProfile(0.032, 0.1 - 0.02 * t, 0.012),
    }));
  }
  const head = [0.42, 0.78];
  frame.push(...k.rod([head[0] - DIR[0] * 0.09, head[1] - DIR[1] * 0.09, 0], [head[0] + DIR[0] * 0.08, head[1] + DIR[1] * 0.08, 0], 0.034, { material: 'paint_cadre', radial: 18 }));
  frame.push(...k.rod([-0.2, 0.42, -0.17], [-0.2, 0.42, 0.17], 0.022, { material: 'alu', radial: 14 }));
  m.add('cadre', frame);

  /** @type {*[]} */
  const arm = [];
  for (const sz of [-1, 1]) {
    arm.push(...sweep(k, [[-0.19, 0.42, 0.135 * sz], [-0.45, 0.37, 0.13 * sz], [-0.72, 0.315, 0.125 * sz]], {
      material: 'paint_cadre', samples: 18, profile: (t) => rectProfile(0.034, 0.105 - 0.055 * t, 0.012),
    }));
  }
  arm.push(...k.place(k.roundedExtrude(k.roundedRect(0.07, 0.06, 0.02), { material: 'paint_cadre', depth: 0.26, bevel: 0.008, axis: 'z' }), { position: [-0.28, 0.41, 0] }));
  arm.push(...k.rod([-0.705, 0.315, -0.15], [-0.705, 0.315, 0.15], 0.012, { material: 'alu', radial: 10 }));
  for (const sz of [-1, 1]) arm.push(...k.rod([-0.55, 0.335, 0.15 * sz], [-0.55, 0.335, 0.175 * sz], 0.011, { material: 'alu', radial: 10 })); // diabolos
  // Lèche-roue arrière noir.
  arm.push(...sweep(k, arcPts(-AX, RR, RR + 0.035, 58, 128), { material: 'black', samples: 24, crease: 75, profile: () => shellProfile(0.105, 0.004) }));
  // Étrier arrière (à droite, sous le bras).
  arm.push(...k.place(k.roundedExtrude(k.roundedRect(0.07, 0.035, 0.012), { material: 'black', depth: 0.04, bevel: 0.006 }), { position: [-0.705 + 0.06, 0.315 - 0.085, 0.07], rotation: [0, 0, -0.95] }));
  m.add('bras', arm);

  // --- Moteur (bloc sombre dans le carénage), transmission, échappement -------------------------
  /** @type {*[]} */
  const engine = [];
  engine.push(...k.place(k.roundedExtrude(k.roundedRect(0.42, 0.36, 0.06), { material: 'black', depth: 0.38, bevel: 0.02 }), { position: [0.08, 0.4, 0] }));
  engine.push(...k.place(k.roundedExtrude(k.roundedRect(0.24, 0.16, 0.04), { material: 'black', depth: 0.3, bevel: 0.015 }), { position: [0.2, 0.6, 0], rotation: [0, 0, 0.45] }));
  engine.push(...k.place(k.lathe([[0.075, -0.012], [0.075, 0.012]], { material: 'alu', segments: 32 }), { position: [0.05, 0.33, -0.2] })); // carter d'alternateur
  m.add('moteur', engine);

  /** @type {*[]} */
  const drive = [];
  // Chaîne à gauche : du pignon de sortie à la couronne.
  const zc = -0.083;
  const pin = [-0.1, 0.4];
  const rp = 0.04;
  const rc = 0.1;
  const chain = [];
  for (let i = 0; i < 12; i += 1) {
    const a = -Math.PI / 2 + (Math.PI * i) / 11;
    chain.push(/** @type {[number, number, number]} */ ([pin[0] + rp * Math.cos(a), pin[1] + rp * Math.sin(a), zc]));
  }
  for (let i = 0; i < 12; i += 1) {
    const a = Math.PI / 2 + (Math.PI * i) / 11;
    chain.push(/** @type {[number, number, number]} */ ([-AX + rc * Math.cos(a), RR + rc * Math.sin(a), zc]));
  }
  drive.push(...k.tube(chain, { material: 'black', radius: 0.0065, closed: true, radial: 6, segments: 6 }));
  drive.push(...k.place(k.lathe([[0.045, -0.01], [0.045, 0.01]], { material: 'black', segments: 24 }), { position: [pin[0], pin[1], zc] }));
  m.add('transmission', drive);

  /** @type {*[]} */
  const exhaust = [];
  exhaust.push(...k.tube([[0.15, 0.2, 0], [0.0, 0.19, 0], [-0.12, 0.22, 0], [-0.3, 0.36, 0], [-0.4, 0.55, 0], [-0.47, 0.68, 0]], { material: 'black', radius: 0.024, radial: 12 }));
  exhaust.push(...sweep(k, [[-0.46, 0.7, 0], [-0.62, 0.745, 0], [-0.78, 0.8, 0], [-0.88, 0.845, 0]], {
    material: 'black', samples: 20, crease: 60,
    profile: (t) => ovalProfile(0.105 - 0.025 * t, 0.055 - 0.008 * t, 28, 2.4),
  }));
  for (const sz of [-1, 1]) {
    exhaust.push(...sweep(k, [[-0.87, 0.85, 0.042 * sz], [-0.905, 0.862, 0.042 * sz]], { material: 'chrome', samples: 2, profile: () => ovalProfile(0.026, 0.017, 18), caps: false }));
    exhaust.push(...sweep(k, [[-0.88, 0.85, 0.042 * sz], [-0.9, 0.858, 0.042 * sz]], { material: 'black', samples: 2, profile: () => ovalProfile(0.02, 0.012, 18) }));
  }
  m.add('echappement', exhaust);

  // --- Commandes : demi-guidons, rétroviseurs, repose-pieds, clignotants ------------------------
  /** @type {*[]} */
  const ctl = [];
  for (const sz of [-1, 1]) {
    ctl.push(...k.tube([forkAt(0.56, 0.11 * sz), [0.38, 0.875, 0.19 * sz], [0.3, 0.905, 0.25 * sz]], { material: 'black', radius: 0.012, radial: 10 }));
    ctl.push(...k.rod([0.305, 0.902, 0.245 * sz], [0.235, 0.93, 0.31 * sz], 0.017, { material: 'rubber', radial: 14 }));
    ctl.push(...k.rod([0.31, 0.92, 0.22 * sz], [0.24, 0.935, 0.29 * sz], 0.005, { material: 'alu', radial: 6 })); // levier
    // Rétroviseurs : tige depuis le haut du carénage, coque noire, miroir, clignotant.
    ctl.push(...k.tube([[0.54, 0.965, 0.19 * sz], [0.53, 1.0, 0.25 * sz], [0.515, 1.02, 0.29 * sz]], { material: 'black', radius: 0.008, radial: 8 }));
    ctl.push(...k.ellipsoid([0.5, 1.03, 0.315 * sz], [0.04, 0.036, 0.05], { material: 'black' }));
    ctl.push(...k.ellipsoid([0.462, 1.03, 0.315 * sz], [0.006, 0.03, 0.043], { material: 'chrome' }));
    ctl.push(...k.ellipsoid([0.535, 1.025, 0.325 * sz], [0.008, 0.01, 0.03], { material: 'signal' }));
    // Repose-pieds reculés et leurs platines.
    ctl.push(...k.rod([-0.28, 0.42, 0.17 * sz], [-0.28, 0.42, 0.245 * sz], 0.011, { material: 'alu', radial: 10 }));
    ctl.push(...k.place(k.roundedExtrude([[-0.2, 0.5], [-0.15, 0.46], [-0.27, 0.39], [-0.31, 0.43]], { material: 'alu', depth: 0.008, bevel: 0.003 }), { position: [0, 0, 0.165 * sz] }));
    // Clignotants arrière.
    ctl.push(...k.rod([-0.86, 0.84, 0.03 * sz], [-0.87, 0.835, 0.1 * sz], 0.006, { material: 'black', radial: 6 }));
    ctl.push(...k.ellipsoid([-0.872, 0.835, 0.107 * sz], [0.02, 0.011, 0.011], { material: 'signal' }));
  }
  m.add('commandes', ctl);

  // --- Béquille d'atelier arrière (discrète, sous le bras) --------------------------------------
  /** @type {*[]} */
  const stand = [];
  for (const sz of [-1, 1]) {
    stand.push(...k.tube([[-0.55, 0.315, 0.2 * sz], [-0.5, 0.2, 0.205 * sz], [-0.36, 0.035, 0.21 * sz]], { material: 'black', radius: 0.012, radial: 8 }));
    stand.push(...k.rod([-0.55, 0.315, 0.2 * sz], [-0.55, 0.33, 0.175 * sz], 0.009, { material: 'black', radial: 8 }));
    stand.push(...k.place(k.lathe([[0.025, -0.01], [0.025, 0.01]], { material: 'rubber', segments: 16 }), { position: [-0.36, 0.025, 0.225 * sz] }));
  }
  stand.push(...k.rod([-0.36, 0.035, -0.21], [-0.36, 0.035, 0.21], 0.012, { material: 'black', radial: 8 }));
  m.add('bequille', stand);

  // --- Roues ------------------------------------------------------------------------------------
  /** @type {*[]} */
  const front = [...k.tire({ outer: RF, rim: RIM, width: 0.12, moto: true }), ...motoRim(k, { rim: RIM, width: 0.12, material: 'paint_jantes', hubWidth: 0.17 })];
  for (const sz of [-1, 1]) {
    front.push(...k.place(disc(k, { ri: 0.105, ro: 0.155, e: 0.005, material: 'chrome', holes: 12 }), { position: [0, 0, 0.072 * sz] }));
    front.push(...k.place(disc(k, { ri: 0.05, ro: 0.108, e: 0.006, material: 'alu', holes: 5 }), { position: [0, 0, 0.07 * sz] }));
  }
  m.shared('roue_avant', front);
  m.instance('roue_avant', 'roue_avant', { position: [AX, RF, 0] });

  /** @type {*[]} */
  const rear = [...k.tire({ outer: RR, rim: RIM, width: 0.19, moto: true }), ...motoRim(k, { rim: RIM, width: 0.19, material: 'paint_jantes', hubWidth: 0.2 })];
  rear.push(...k.place(disc(k, { ri: 0.06, ro: 0.11, e: 0.005, material: 'chrome', holes: 8 }), { position: [0, 0, 0.075] }));
  rear.push(...k.place(disc(k, { ri: 0.055, ro: 0.1, e: 0.006, material: 'paint_fourche', teeth: 42, holes: 5 }), { position: [0, 0, zc] }));
  m.shared('roue_arriere', rear);
  m.instance('roue_arriere', 'roue_arriere', { position: [-AX, RR, 0] });

  return m;
}
