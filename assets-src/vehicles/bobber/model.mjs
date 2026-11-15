// @ts-check
// Le bobber (placeholder_bobber) : moto basse et longue, bicylindre en V refroidi par air, tout
// noir, gros pneus, selle solo, guidon haut, arrière rigide d'allure. Substitut modelé par le code
// d'après la fiche « Le bobber » (captures/notes-agents/vague-g-fiches.md) et son gabarit chiffré,
// à remplacer un jour par un vrai modèle aux mêmes conventions, sans toucher au code.
// Cotes : empattement 1,64 (essieux à x = ±0,82) ; pneus de 0,64 × 0,13 (avant) et 0,65 × 0,15
// (arrière) ; longueur 2,29 ; largeur au guidon 0,85 ; poignées à y = 1,22 ; selle à y = 0,66 ;
// direction inclinée de 30°, colonne en (+0,47 ; 0,80).
//
// Construction
// - Masses : roues (nœuds roue_avant et roue_arriere, axe Z), cadre en tubes de 3 cm, moteur en V
//   centré sous le réservoir, réservoir en goutte (loft calé sur la poutre du cadre), selle solo
//   (loft creusé), garde-boue balayés autour des essieux (outils.mjs), fourche le long de l'axe
//   de direction.
// - La fourche est décalée de 6,3 cm en avant de l'axe de direction (déport des tés) : l'axe
//   passant par la colonne tombe 7 cm derrière l'essieu avant, comme sur une vraie chasse.

import { arcSweep, bevelCut, circlesHull } from './outils.mjs';

/** @typedef {typeof import('../../../tools/vehicles/kit.mjs')} Kit */
/** @typedef {import('../../../tools/vehicles/kit.mjs').Parts} Parts */
/** @typedef {[number, number]} P2 */
/** @typedef {[number, number, number]} P3 */

const DEG = Math.PI / 180;
const AX_F = 0.82;
const AX_R = -0.82;
const R_F = 0.32;
const R_R = 0.325;
const RIM = 0.205; // jantes de 16 pouces
// Direction : u monte le long de l'axe (vers l'arrière), n en est la normale vers l'avant.
const RAKE = 30 * DEG;
const U = /** @type {P2} */ ([-Math.sin(RAKE), Math.cos(RAKE)]);
const N = /** @type {P2} */ ([Math.cos(RAKE), Math.sin(RAKE)]);
const HEAD = /** @type {P2} */ ([0.47, 0.8]); // colonne
const FORK_Z = 0.11; // demi-écart des tubes de fourche
// Moteur.
const CRANK = /** @type {P2} */ ([0.02, 0.3]);
const VHALF = 22.5 * DEG;
// Cadre.
const SEAT_NODE = /** @type {P2} */ ([-0.25, 0.62]);
const CRADLE_END = /** @type {P2} */ ([-0.3, 0.17]);
const CRADLE_Y = 0.17;
const TUBE_R = 0.015;

/** y du dessus de la poutre (axe du tube) à l'abscisse x. @param {number} x */
const backboneY = (x) => HEAD[1] + ((x - HEAD[0]) * (HEAD[1] - SEAT_NODE[1])) / (HEAD[0] - SEAT_NODE[0]);

/** Point de la fourche (axe d'un tube, dans le plan xy) à la distance s de l'essieu. @param {number} s @returns {P2} */
const forkAt = (s) => [AX_F + U[0] * s, R_F + U[1] * s];
/** Point de l'axe de direction à la distance t de la colonne. @param {number} t @returns {P2} */
const steerAt = (t) => [HEAD[0] + U[0] * t, HEAD[1] + U[1] * t];

/** @param {Kit} k */
export default function bobber(k) {
  const m = new k.Model('bobber');
  m.material('paint_reservoir', { color: '#0b0b0e', roughness: 0.2 });
  m.material('paint_garde_boue', { color: '#0b0b0e', roughness: 0.2 });
  m.material('paint_cadre', { color: '#0b0b0e', roughness: 0.4 });
  m.material('paint_moteur', { color: '#111113', roughness: 0.7 });
  m.material('paint_jantes', { color: '#0b0b0e', roughness: 0.4 });
  m.material('paint_fourche', { color: '#0b0b0e', roughness: 0.4 });
  m.material('paint_selle', { color: '#121214', roughness: 0.75 });

  // --- Roues -------------------------------------------------------------------------------------
  // Avant : 40 rayons fils sur jante noire, moyeu de 8 cm, disque de 29 cm à gauche.
  /** @type {Parts} */
  const front = [...k.wheel({ outer: R_F, rim: RIM, width: 0.13, style: 'rayons', spokes: 40, material: 'paint_jantes', hubRadius: 0.04, moto: true })];
  front.push(...disc(k, 0.145, 0.1, -0.058, 'alu'));
  front.push(...k.lathe([[0.1, -0.052], [0.1, -0.048], [0.04, -0.044], [0.04, -0.052]], { material: 'black', segments: 32 }));
  m.shared('roue_avant', front);
  m.instance('roue_avant', 'roue_avant', { position: [AX_F, R_F, 0] });
  // Arrière : flasque plein, noir ; poulie de courroie à gauche, disque à droite.
  /** @type {Parts} */
  const rear = [...k.tire({ outer: R_R, rim: RIM, width: 0.15, moto: true }), ...barrel(k, RIM, 0.15, 'paint_jantes')];
  rear.push(
    ...k.lathe(
      [
        [0, -0.072],
        [0.045, -0.072],
        [0.07, -0.062],
        [0.15, -0.05],
        [RIM - 0.012, -0.046],
        [RIM - 0.012, 0.046],
        [0.15, 0.05],
        [0.07, 0.062],
        [0.045, 0.072],
        [0, 0.072],
      ],
      { material: 'paint_jantes', segments: 64, crease: 40 },
    ),
  );
  rear.push(...k.lathe([[0, -0.085], [0.035, -0.085], [0.035, 0.085], [0, 0.085]], { material: 'alu', segments: 24 }));
  rear.push(...disc(k, 0.11, 0.07, 0.084, 'alu'));
  rear.push(...k.lathe([[0.07, 0.081], [0.07, 0.086], [0.035, 0.09], [0.035, 0.081]], { material: 'black', segments: 32 }));
  rear.push(...pulley(k, 0.13, -0.086, 64));
  m.shared('roue_arriere', rear);
  m.instance('roue_arriere', 'roue_arriere', { position: [AX_R, R_R, 0] });

  // --- Fourche et direction ------------------------------------------------------------------------
  /** @type {Parts} */
  const fork = [];
  /** Pièce modelée le long de +Y, posée le long de la fourche à partir de s. @param {Parts} p @param {number} s @param {number} z */
  const alongFork = (p, s, z) => {
    const [x, y] = forkAt(s);
    return k.place(p, { position: [x, y, z], rotation: [0, 0, RAKE] });
  };
  for (const z of [-FORK_Z, FORK_Z]) {
    // Fourreau bas (avec patte d'essieu), soufflet noir, tube haut.
    fork.push(...alongFork(k.lathe([[0, -0.04], [0.024, -0.04], [0.027, -0.01], [0.027, 0.13], [0.022, 0.15], [0, 0.15]], { material: 'paint_fourche', segments: 20, axis: 'y' }), 0, z));
    fork.push(...alongFork(gaiter(k, 0.25, 0.031, 0.024, 9), 0.14, z));
    fork.push(...alongFork(k.lathe([[0, 0], [0.02, 0], [0.02, 0.33], [0.016, 0.335], [0, 0.335]], { material: 'paint_fourche', segments: 20, axis: 'y' }), 0.38, z));
  }
  // Axe de roue.
  fork.push(...k.rod([AX_F, R_F, -FORK_Z - 0.02], [AX_F, R_F, FORK_Z + 0.02], 0.012, { material: 'alu' }));
  // Tés : plaques perpendiculaires à l'axe, qui joignent la colonne et les deux tubes.
  const offs = (HEAD[0] - AX_F) * N[0] + (HEAD[1] - R_F) * N[1]; // < 0 : la fourche est devant
  for (const [t, th] of /** @type {const} */ ([
    [-0.085, 0.035],
    [0.08, 0.03],
  ])) {
    const plate = k.roundedExtrude(
      circlesHull([
        [0, 0, 0.036],
        [-offs, FORK_Z, 0.032],
        [-offs, -FORK_Z, 0.032],
      ]),
      { material: 'paint_fourche', depth: th, bevel: 0.008, axis: 'y' },
    );
    const [x, y] = steerAt(t);
    fork.push(...k.place(plate, { position: [x, y, 0], rotation: [0, 0, RAKE] }));
  }
  // Étrier avant (gauche), derrière le fourreau.
  fork.push(...k.place(k.roundedExtrude(k.roundedRect(0.075, 0.04, 0.012), { material: 'black', depth: 0.03, bevel: 0.006 }), { position: [AX_F - 0.1, R_F + 0.095, -0.06], rotation: [0, 0, -45 * DEG] }));
  m.add('fourche', fork);

  // --- Cadre -----------------------------------------------------------------------------------------
  /** @type {Parts} */
  const frame = [];
  const tube = (/** @type {P3[]} */ pts, r = TUBE_R) => frame.push(...k.tube(pts, { material: 'paint_cadre', radius: r, radial: 14 }));
  // Colonne de direction.
  {
    const a = steerAt(-0.11);
    const b = steerAt(0.08);
    frame.push(...k.rod([a[0], a[1], 0], [b[0], b[1], 0], 0.026, { material: 'paint_cadre', radial: 20 }));
  }
  // Poutre supérieure.
  tube([
    [HEAD[0] - 0.01, HEAD[1], 0],
    [0.2, backboneY(0.2), 0],
    [-0.1, backboneY(-0.1), 0],
    [SEAT_NODE[0], SEAT_NODE[1], 0],
  ]);
  // Tubes avant doubles, berceau, bras arrière inférieurs, haubans, tube de selle.
  for (const s of [-1, 1]) {
    tube([
      [0.455, 0.71, 0.02 * s],
      [0.38, 0.52, 0.055 * s],
      [0.27, 0.27, 0.07 * s],
      [0.2, CRADLE_Y + 0.005, 0.075 * s],
      [0.05, CRADLE_Y, 0.075 * s],
      [CRADLE_END[0], CRADLE_Y, 0.075 * s],
      [-0.5, 0.22, 0.095 * s],
      [AX_R + 0.03, R_R - 0.01, 0.105 * s],
    ]);
    tube([
      [SEAT_NODE[0], SEAT_NODE[1], 0.03 * s],
      [-0.4, 0.54, 0.07 * s],
      [AX_R + 0.03, R_R + 0.01, 0.105 * s],
    ]);
    // Pattes d'essieu.
    frame.push(
      ...k.place(k.roundedExtrude(circlesHull([[0, 0, 0.03], [0.05, 0.0, 0.025]]), { material: 'paint_cadre', depth: 0.012, bevel: 0.003 }), {
        position: [AX_R, R_R, 0.108 * s],
      }),
    );
  }
  tube([
    [SEAT_NODE[0], SEAT_NODE[1], 0],
    [-0.28, 0.4, 0],
    [CRADLE_END[0] + 0.005, CRADLE_Y + 0.01, 0],
  ]);
  // Traverse sous la selle (porte les ressorts).
  frame.push(...k.rod([-0.42, 0.535, -0.075], [-0.42, 0.535, 0.075], 0.012, { material: 'paint_cadre' }));
  // Platines et repose-pieds avant (commandes avancées).
  for (const s of [-1, 1]) {
    frame.push(...k.rod([0.3, 0.25, 0.08 * s], [0.3, 0.25, 0.2 * s], 0.012, { material: 'paint_cadre' }));
    frame.push(...k.rod([0.22, CRADLE_Y, 0.075 * s], [0.3, 0.25, 0.085 * s], 0.012, { material: 'paint_cadre' }));
    frame.push(...k.rod([0.3, 0.25, 0.195 * s], [0.3, 0.25, 0.285 * s], 0.019, { material: 'rubber', radial: 14 }));
  }
  m.add('cadre', frame);

  // --- Moteur -----------------------------------------------------------------------------------------
  /** @type {Parts} */
  const engine = [];
  // Carter rond de 0,30.
  engine.push(
    ...k.place(
      k.lathe(
        [
          [0, -0.105],
          [0.12, -0.105],
          [0.145, -0.09],
          [0.15, -0.06],
          [0.15, 0.06],
          [0.145, 0.09],
          [0.12, 0.105],
          [0, 0.105],
        ],
        { material: 'paint_moteur', segments: 48 },
      ),
      { position: [CRANK[0], CRANK[1], 0] },
    ),
  );
  // Boîte de vitesses derrière le carter.
  engine.push(...k.place(k.roundedExtrude(k.roundedRect(0.24, 0.2, 0.05), { material: 'paint_moteur', depth: 0.16, bevel: 0.02 }), { position: [-0.18, 0.29, 0] }));
  // Cylindres en V à 45°, fûts à ailettes, culasses arrondies, cache-culbuteurs chromés.
  for (const sgn of [1, -1]) {
    const rot = -sgn * VHALF;
    engine.push(...k.place(cylinder(k), { position: [CRANK[0], CRANK[1], 0], rotation: [0, 0, rot] }));
    engine.push(
      ...k.place(
        k.lathe(
          [
            [0.078, 0.322],
            [0.08, 0.335],
            [0.07, 0.355],
            [0.045, 0.366],
            [0, 0.369],
          ],
          { material: 'chrome', segments: 40, axis: 'y' },
        ),
        { position: [CRANK[0], CRANK[1], 0], rotation: [0, 0, rot] },
      ),
    );
    // Tubes de tiges (côté droit) : du bloc des poussoirs à la culasse.
    const dir = /** @type {P2} */ ([Math.sin(sgn * VHALF), Math.cos(sgn * VHALF)]);
    const perp = /** @type {P2} */ ([dir[1], -dir[0]]);
    for (const o of [-0.022, 0.022]) {
      const top = /** @type {P3} */ ([CRANK[0] + dir[0] * 0.29 + perp[0] * o * sgn, CRANK[1] + dir[1] * 0.29 + perp[1] * o * sgn, 0.112]);
      const bot = /** @type {P3} */ ([CRANK[0] + sgn * 0.035 + o * 0.6, 0.43, 0.105]);
      engine.push(...k.rod(bot, top, 0.0085, { material: 'chrome', radial: 10 }));
    }
  }
  // Bloc des poussoirs et couvercle de distribution (côté droit).
  engine.push(...k.place(k.roundedExtrude(circlesHull([[0, 0, 0.06], [0.03, 0.11, 0.04]]), { material: 'paint_moteur', depth: 0.03, bevel: 0.01 }), { position: [CRANK[0] + 0.02, CRANK[1] + 0.02, 0.112] }));
  // Filtre à air rond de 0,16, côté droit, entre les cylindres ; carburateur derrière.
  engine.push(...k.rod([CRANK[0], 0.55, 0.06], [CRANK[0], 0.55, 0.13], 0.03, { material: 'black', radial: 16 }));
  engine.push(
    ...k.place(
      k.lathe(
        [
          [0, 0],
          [0.074, 0],
          [0.08, 0.008],
          [0.08, 0.036],
          [0.074, 0.044],
          [0.05, 0.05],
          [0, 0.052],
        ],
        { material: 'chrome', segments: 48 },
      ),
      { position: [CRANK[0], 0.55, 0.13] },
    ),
  );
  // Carter primaire oblong (côté gauche), du vilebrequin vers l'embrayage.
  engine.push(
    ...k.place(
      k.roundedExtrude(
        circlesHull([
          [CRANK[0], CRANK[1], 0.085],
          [-0.24, 0.3, 0.115],
        ]),
        { material: 'paint_moteur', depth: 0.06, bevel: 0.022, bevelSegments: 4 },
      ),
      { position: [0, 0, -0.14] },
    ),
  );
  // Réservoir d'huile rond sous la selle.
  engine.push(...k.rod([-0.39, 0.42, -0.075], [-0.39, 0.42, 0.075], 0.065, { material: 'black', radial: 28 }));
  m.add('moteur', engine);

  // --- Transmission : courroie à gauche ---------------------------------------------------------------
  /** @type {Parts} */
  const drive = [];
  {
    const a = /** @type {[number, number, number]} */ ([-0.24, 0.3, 0.05]);
    const b = /** @type {[number, number, number]} */ ([AX_R, R_R, 0.13]);
    const outer = circlesHull([
      [a[0], a[1], a[2] + 0.008],
      [b[0], b[1], b[2] + 0.008],
    ]);
    const inner = circlesHull([
      [a[0], a[1], a[2]],
      [b[0], b[1], b[2]],
    ]).reverse();
    drive.push(...k.place(k.roundedExtrude(outer, { material: 'black', depth: 0.022, bevel: 0.002, holes: [inner] }), { position: [0, 0, -0.088] }));
  }
  m.add('transmission', drive);

  // --- Échappements : deux tubes courts superposés à droite, coupés en biseau ---------------------------
  /** @type {Parts} */
  const exhaust = [];
  const PIPE_R = 0.0225;
  /** @param {P3[]} pts @param {number} yEnd */
  const pipe = (pts, yEnd) => {
    const parts = k.tube(pts, { material: 'chrome', radius: PIPE_R, radial: 16, caps: false, segments: pts.length * 14 });
    bevelCut(parts, { x0: -0.75, y0: yEnd, slope: 0.9 });
    exhaust.push(...parts);
    exhaust.push(...k.rod([-0.6, yEnd, pts[pts.length - 1]?.[2] ?? 0.2], [-0.735, yEnd, pts[pts.length - 1]?.[2] ?? 0.2], PIPE_R - 0.003, { material: 'black', radial: 16 }));
  };
  pipe(
    [
      [0.2, 0.53, 0.05],
      [0.255, 0.48, 0.1],
      [0.265, 0.39, 0.165],
      [0.2, 0.32, 0.2],
      [0.05, 0.3, 0.205],
      [-0.4, 0.3, 0.205],
      [-0.85, 0.3, 0.205],
    ],
    0.3,
  );
  pipe(
    [
      [-0.16, 0.53, 0.05],
      [-0.22, 0.48, 0.12],
      [-0.26, 0.42, 0.19],
      [-0.33, 0.385, 0.215],
      [-0.45, 0.38, 0.215],
      [-0.85, 0.38, 0.215],
    ],
    0.38,
  );
  m.add('echappement', exhaust);

  // --- Réservoir en goutte ---------------------------------------------------------------------------------
  const X_TF = 0.38;
  const X_TR = -0.12;
  const tankTop = k.smoothCurve([
    [X_TR, 0.8],
    [-0.04, 0.865],
    [0.06, 0.905],
    [0.16, 0.926],
    [0.24, 0.93],
    [0.32, 0.918],
    [X_TF, 0.895],
  ]);
  const tankHalfW = k.smoothCurve([
    [X_TR, 0.06],
    [-0.04, 0.1],
    [0.06, 0.13],
    [0.16, 0.147],
    [0.22, 0.15],
    [0.3, 0.142],
    [X_TF, 0.12],
  ]);
  const tankSkirt = k.smoothCurve([
    [X_TR, 0.02],
    [0.0, 0.035],
    [0.15, 0.06],
    [X_TF, 0.075],
  ]);
  /** @param {number} x @returns {P2[]} */
  const tankHalf = (x) => {
    const insF = k.endInset(x, X_TF, 0.07);
    const insR = k.endInset(x, X_TR, 0.05);
    const ins = insF + insR;
    const bb = backboneY(x) + TUBE_R;
    const top = Math.max(bb + 0.03, tankTop(x) - ins * 0.9);
    const hw = Math.max(0.03, tankHalfW(x) - ins);
    const ylow = Math.min(bb - 0.02, bb - tankSkirt(x) + ins * 0.6);
    const tw = Math.min(0.026, hw * 0.4);
    /** @type {P2[]} */
    const pts = [
      [0, bb + 0.004],
      [tw * 0.55, bb + 0.002],
      [tw, bb - 0.012],
    ];
    const NS = 18;
    const e = 2 / 2.6; // superellipse un peu carrée
    const yc = (top + ylow) / 2;
    const ry = (top - ylow) / 2;
    for (let i = 0; i <= NS; i += 1) {
      const th = (-90 + (180 * i) / NS) * DEG;
      const c = Math.pow(Math.abs(Math.cos(th)), e);
      const sn = Math.sign(Math.sin(th)) * Math.pow(Math.abs(Math.sin(th)), e);
      const z = th < 0 ? tw + (hw - tw) * c : hw * c;
      pts.push([i === NS ? 0 : z, yc + ry * sn]);
    }
    return pts;
  };
  m.add(
    'reservoir',
    k.loft({
      sectionAt: (x) => k.mirrorSection(tankHalf(x)),
      xs: k.sampleX(X_TR, X_TF, { step: 0.02, endZone: 0.07 }),
      around: 2,
      material: 'paint_reservoir',
      crease: 70,
    }),
  );
  // Bouchon chromé.
  m.add('reservoir', k.place(k.lathe([[0, 0], [0.026, 0], [0.026, 0.008], [0.02, 0.014], [0, 0.015]], { material: 'chrome', segments: 28 }), { position: [0.16, tankTop(0.16) - 0.004, 0] }));

  // --- Selle solo ---------------------------------------------------------------------------------------------
  const X_SR = -0.49;
  const X_SF = -0.17;
  const seatTop = k.smoothCurve([
    [X_SR, 0.708],
    [-0.45, 0.706],
    [-0.38, 0.688],
    [-0.3, 0.68],
    [-0.22, 0.676],
    [X_SF, 0.668],
  ]);
  const seatHalfW = k.smoothCurve([
    [X_SR, 0.12],
    [-0.43, 0.14],
    [-0.35, 0.13],
    [-0.27, 0.095],
    [-0.21, 0.06],
    [X_SF, 0.04],
  ]);
  m.add(
    'selle',
    k.loft({
      sectionAt: (x) => {
        const ins = k.endInset(x, X_SR, 0.035) + k.endInset(x, X_SF, 0.03);
        const top = seatTop(x) - ins * 0.6;
        const bottom = 0.632 + ins * 0.4;
        const hw = Math.max(0.02, seatHalfW(x) - ins);
        return k.mirrorSection(k.roundedHalf({ bottom, top: Math.max(bottom + 0.02, top), halfWidthBottom: hw * 0.92, halfWidthTop: hw, rBottom: 0.01, rTop: 0.028, crown: -0.006 }));
      },
      xs: k.sampleX(X_SR, X_SF, { step: 0.02, endZone: 0.04 }),
      around: 2,
      material: 'paint_selle',
    }),
  );
  // Deux ressorts sous l'arrière de la selle, et l'attache du bec.
  /** @type {Parts} */
  const springs = [];
  for (const s of [-1, 1]) {
    /** @type {P3[]} */
    const coil = [];
    for (let i = 0; i <= 64; i += 1) {
      const a = (i / 64) * 7 * 2 * Math.PI;
      coil.push([-0.42 + 0.02 * Math.cos(a), 0.545 + (0.085 * i) / 64, 0.075 * s + 0.02 * Math.sin(a)]);
    }
    springs.push(...k.tube(coil, { material: 'chrome', radius: 0.0035, radial: 6, segments: 320 }));
  }
  springs.push(...k.rod([-0.19, 0.64, 0], [-0.24, 0.625, 0], 0.012, { material: 'black' }));
  m.add('selle', springs);

  // --- Garde-boue ----------------------------------------------------------------------------------------------
  /** Profil en U enveloppant : [z, r], extérieur puis intérieur. @param {number} hw @param {number} r0 @param {number} depth */
  const fenderProfile = (hw, r0, depth) => {
    /** @type {P2[]} */
    const pts = [];
    const n = 14;
    for (let i = 0; i <= n; i += 1) {
      const p = -Math.PI / 2 + (Math.PI * i) / n;
      pts.push([hw * Math.sin(p), r0 + depth * Math.pow(Math.cos(p), 0.6)]);
    }
    for (let i = n; i >= 0; i -= 1) {
      const p = -Math.PI / 2 + (Math.PI * i) / n;
      pts.push([(hw - 0.005) * Math.sin(p), r0 - 0.005 + depth * Math.pow(Math.cos(p), 0.6)]);
    }
    return pts;
  };
  /** @type {Parts} */
  const fenders = [];
  fenders.push(...arcSweep(k, fenderProfile(0.085, 0.3, 0.07), { center: [AX_R, R_R], from: 75, to: 155, steps: 44, material: 'paint_garde_boue' }));
  fenders.push(...arcSweep(k, fenderProfile(0.075, 0.3, 0.06), { center: [AX_F, R_F], from: 50, to: 110, steps: 34, material: 'paint_garde_boue' }));
  m.add('garde_boue', fenders);
  // Supports de garde-boue et feu arrière.
  /** @type {Parts} */
  const fenderBits = [];
  for (const s of [-1, 1]) {
    fenderBits.push(...k.tube([[AX_R + 0.02, R_R + 0.02, 0.1 * s], [AX_R - 0.1, R_R + 0.2, 0.095 * s], [AX_R - 0.24, R_R + 0.26, 0.09 * s]], { material: 'paint_cadre', radius: 0.009, radial: 10 }));
    fenderBits.push(...k.rod([AX_F, R_F, 0.088 * s], [AX_F + 0.06, R_F + 0.3, 0.083 * s], 0.008, { material: 'paint_fourche' }));
    fenderBits.push(...k.rod([AX_F, R_F, 0.088 * s], [AX_F - 0.09, R_F + 0.29, 0.083 * s], 0.008, { material: 'paint_fourche' }));
  }
  {
    const a = 140 * DEG;
    const r = 0.375;
    const pos = /** @type {P3} */ ([AX_R + r * Math.cos(a), R_R + r * Math.sin(a), 0]);
    const nrm = /** @type {P3} */ ([Math.cos(a) - 0.4, Math.sin(a), 0]);
    fenderBits.push(...k.orient(k.roundedExtrude(k.roundedRect(0.07, 0.035, 0.015), { material: 'black', depth: 0.02, bevel: 0.005 }), { position: pos, normal: nrm }));
    const lp = /** @type {P3} */ ([pos[0] + nrm[0] * 0.01, pos[1] + nrm[1] * 0.01, 0]);
    fenderBits.push(...k.orient(k.lamp(k.roundedRect(0.06, 0.026, 0.012), { material: 'tail', bulge: 0.006 }), { position: lp, normal: nrm }));
  }
  m.add('feux', fenderBits);

  // --- Phare rond chromé, devant la fourche -----------------------------------------------------------------
  /** @type {Parts} */
  const head = [];
  const HL = /** @type {P3} */ ([0.66, 0.86, 0]);
  head.push(
    ...k.place(
      k.lathe(
        [
          [0, -0.075],
          [0.04, -0.072],
          [0.07, -0.05],
          [0.083, -0.02],
          [0.086, 0.01],
          [0.087, 0.03],
          [0.08, 0.034],
          [0, 0.034],
        ],
        { material: 'chrome', segments: 48, axis: 'x' },
      ),
      { position: HL },
    ),
  );
  head.push(...k.orient(k.lamp(k.circle(0, 0, 0.078, 40), { material: 'lamp', bulge: 0.014 }), { position: [HL[0] + 0.033, HL[1], 0], normal: [1, 0, 0] }));
  // Pattes : des tubes de fourche au phare.
  for (const s of [-1, 1]) {
    const [fx, fy] = forkAt(0.58);
    head.push(...k.rod([fx + 0.01, fy, (FORK_Z - 0.02) * s], [HL[0] - 0.02, HL[1] - 0.01, 0.07 * s], 0.009, { material: 'chrome' }));
  }
  // Petit feu additionnel bas.
  const SP = /** @type {P3} */ ([0.62, 0.69, 0]);
  head.push(...k.place(k.lathe([[0, -0.03], [0.03, -0.025], [0.036, 0.0], [0.036, 0.012], [0, 0.012]], { material: 'chrome', segments: 32, axis: 'x' }), { position: SP }));
  head.push(...k.orient(k.lamp(k.circle(0, 0, 0.031, 28), { material: 'lamp', bulge: 0.006 }), { position: [SP[0] + 0.012, SP[1], 0], normal: [1, 0, 0] }));
  {
    const [lx, ly] = steerAt(-0.085);
    head.push(...k.rod([lx + 0.05, ly - 0.01, 0], [SP[0] - 0.02, SP[1], 0], 0.009, { material: 'black' }));
  }
  m.add('phare', head);

  // --- Guidon haut ------------------------------------------------------------------------------------------
  /** @type {Parts} */
  const bar = [];
  const [tx, ty] = steerAt(0.095);
  /** @type {P3[]} */
  const half = [
    [0.25, 1.22, 0.418],
    [0.284, 1.22, 0.365],
    [0.322, 1.22, 0.31],
    [0.38, 1.2, 0.255],
    [0.415, 1.12, 0.2],
    [tx + 0.005, 1.0, 0.13],
    [tx, ty + 0.06, 0.075],
    [tx, ty + 0.035, 0.04],
  ];
  /** @type {P3[]} */
  const full = [...half, ...[...half].reverse().map(([x, y, z]) => /** @type {P3} */ ([x, y, -z]))];
  bar.push(...k.tube(full, { material: 'chrome', radius: 0.0125, radial: 14, segments: 160 }));
  // Pontets.
  for (const s of [-1, 1]) bar.push(...k.rod([tx, ty, 0.055 * s], [tx, ty + 0.05, 0.055 * s], 0.017, { material: 'black' }));
  // Poignées noires.
  for (const s of [-1, 1]) {
    bar.push(...k.rod([0.322, 1.22, 0.31 * s], [0.248, 1.22, 0.408 * s], 0.017, { material: 'rubber', radial: 16 }));
    // Leviers.
    bar.push(...k.tube([[0.34, 1.222, 0.27 * s], [0.36, 1.22, 0.33 * s], [0.355, 1.215, 0.39 * s]], { material: 'black', radius: 0.006, radial: 8 }));
  }
  // Compteur rond sur le té supérieur, entre les pontets.
  bar.push(...k.place(k.lathe([[0, -0.02], [0.03, -0.018], [0.036, 0.0], [0.036, 0.012], [0.03, 0.014], [0, 0.014]], { material: 'chrome', segments: 32, axis: 'y' }), { position: [tx + 0.01, ty + 0.045, 0], rotation: [0, 0, 0.35] }));
  bar.push(...k.place(k.lathe([[0, 0], [0.03, 0], [0, 0.001]], { material: 'glass', segments: 32, axis: 'y' }), { position: [tx + 0.0145, ty + 0.0575, 0], rotation: [0, 0, 0.35] }));
  m.add('guidon', bar);
  // Rétroviseurs ronds sur tige (nœud à part : la largeur au guidon se mesure sans eux).
  /** @type {Parts} */
  const mirrors = [];
  for (const s of [-1, 1]) {
    mirrors.push(...k.tube([[0.38, 1.2, 0.255 * s], [0.37, 1.27, 0.29 * s], [0.36, 1.33, 0.32 * s]], { material: 'black', radius: 0.0055, radial: 8 }));
    mirrors.push(...k.ellipsoid([0.36, 1.37, 0.33 * s], [0.016, 0.045, 0.045], { material: 'black', segments: 24 }));
    mirrors.push(...k.orient(k.lathe([[0, 0], [0.04, 0], [0, 0.003]], { material: 'chrome', segments: 24, axis: 'z' }), { position: [0.343, 1.37, 0.33 * s], normal: [-1, 0, 0] }));
  }
  m.add('retroviseurs', mirrors);

  // --- Béquille d'atelier arrière, discrète et noire --------------------------------------------------------
  /** @type {Parts} */
  const stand = [];
  for (const s of [-1, 1]) {
    stand.push(...k.tube([[AX_R, R_R, 0.12 * s], [AX_R - 0.05, 0.16, 0.125 * s], [AX_R - 0.09, 0.02, 0.13 * s]], { material: 'black', radius: 0.01, radial: 10 }));
    stand.push(...k.rod([AX_R - 0.09, 0.005, 0.13 * s], [AX_R - 0.09, 0.025, 0.13 * s], 0.018, { material: 'rubber' }));
  }
  stand.push(...k.rod([AX_R - 0.09, 0.02, -0.13], [AX_R - 0.09, 0.02, 0.13], 0.01, { material: 'black' }));
  m.add('bequille', stand);

  return m;
}

/**
 * Cylindre à ailettes et sa culasse, axe +Y, base à 0,11 du vilebrequin, haut à 0,325.
 * @param {Kit} k
 */
function cylinder(k) {
  /** @type {P2[]} */
  const p = [
    [0, 0.11],
    [0.075, 0.11],
  ];
  // Fût : 8 ailettes de 0,20 sur un fût de 0,14.
  for (let i = 0; i < 8; i += 1) {
    const h = 0.118 + i * 0.0175;
    p.push([0.07, h], [0.099, h + 0.002], [0.1, h + 0.006], [0.099, h + 0.009], [0.07, h + 0.011]);
  }
  // Culasse : trois ailettes plus larges, puis le dôme.
  for (let i = 0; i < 3; i += 1) {
    const h = 0.262 + i * 0.017;
    p.push([0.076, h], [0.104, h + 0.002], [0.105, h + 0.006], [0.104, h + 0.009], [0.076, h + 0.011]);
  }
  p.push([0.085, 0.314], [0.088, 0.322], [0.06, 0.326], [0, 0.327]);
  return k.lathe(p, { material: 'paint_moteur', segments: 48, crease: 35, axis: 'y' });
}

/**
 * Soufflet de fourche : accordéon noir le long de +Y.
 * @param {Kit} k @param {number} len @param {number} rOut @param {number} rIn @param {number} folds
 */
function gaiter(k, len, rOut, rIn, folds) {
  /** @type {P2[]} */
  const p = [[0, 0], [rIn, 0]];
  for (let i = 0; i < folds; i += 1) {
    const h = (len * i) / folds;
    p.push([rOut, h + len / folds / 2], [rIn, h + len / folds]);
  }
  p.push([0, len]);
  return k.lathe(p, { material: 'black', segments: 20, crease: 80, axis: 'y' });
}

/**
 * Disque de frein (couronne mince) dans le plan z = z0.
 * @param {Kit} k @param {number} ro @param {number} ri @param {number} z0 @param {string} material
 */
function disc(k, ro, ri, z0, material) {
  return k.lathe(
    [
      [ri, z0 - 0.0025],
      [ro, z0 - 0.0025],
      [ro, z0 + 0.0025],
      [ri, z0 + 0.0025],
      [ri, z0 - 0.0025],
    ],
    { material, segments: 48, crease: 40 },
  );
}

/**
 * Poulie crantée de courroie dans le plan z = z0.
 * @param {Kit} k @param {number} r @param {number} z0 @param {number} teeth
 */
function pulley(k, r, z0, teeth) {
  return k.lathe(
    [
      [0.04, z0 - 0.012],
      [r, z0 - 0.012],
      [r, z0 + 0.012],
      [0.04, z0 + 0.012],
    ],
    { material: 'black', segments: teeth, crease: 40 },
  );
}

/**
 * Fût de jante (rebords et creux), vu des deux côtés.
 * @param {Kit} k @param {number} r @param {number} width @param {string} material
 */
function barrel(k, r, width, material) {
  const w = width / 2;
  const parts = k.lathe(
    [
      [r - 0.012, -w + 0.006],
      [r + 0.012, -w + 0.004],
      [r + 0.014, -w + 0.012],
      [r - 0.006, -w + 0.02],
      [r - 0.014, -w * 0.3],
      [r - 0.014, w * 0.4],
      [r - 0.006, w - 0.02],
      [r + 0.014, w - 0.012],
      [r + 0.012, w - 0.004],
      [r - 0.012, w - 0.006],
    ],
    { material, segments: 64, crease: 55 },
  );
  return parts.map((p) => ({ material: p.material, geometry: k.doubleSided(p.geometry) }));
}
