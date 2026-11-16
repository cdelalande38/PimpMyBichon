// @ts-check
// Habitacle de la Cox (placeholder_cox), pour la vue intérieure du manifeste (deux points de vue :
// entre les sièges, reculé, puis à la place du conducteur, à gauche) et pour ce qu'on voit par les
// vitres. D'après la fiche captures/notes-agents/reference-interieur-cox.md : tout noir mat, trois
// accents seulement, le rouge (tail), le métal poli (chrome) et l'os du pommeau (zone `pommeau`).
// - garnissage fermé : doublure tendue sous toute la caisse de l'habitacle (ciel de toit, montants,
//   flancs, plancher), percée aux vitres seulement, pour qu'on ne voie jamais à travers la caisse ;
// - planche de bord plate : grille striée et gros compteur derrière le volant, panneau central
//   (interrupteur sous capot rouge, gros bouton rouge, trois bascules polies sous leurs voyants),
//   petit cadran poli dessous, grande boîte à gants à serrure ronde à droite ;
// - colonne de direction et ancre `volant` : le volant (sport à trois branches percées d'origine)
//   est une pièce partagée posée par l'app (tools/vehicles/habitacle.mjs, manifeste interior) ;
// - levier long et fin sur un ressort à spires apparentes, ancre `pommeau` au bout de la tige
//   (tête de mort couleur os d'origine, pièce partagée) ;
// - ancres siege_avant_* (baquets bas d'origine, pièces partagées, zone `sellerie`), banquette
//   arrière, garnitures de portes ;
// - deux balais d'essuie-glace au repos au bas du pare-brise, couchés vers la droite.

/** @typedef {typeof import('../../../tools/vehicles/kit.mjs')} Kit */
/** @typedef {import('../../../tools/vehicles/kit.mjs').Parts} Parts */
/** @typedef {import('../../../tools/vehicles/kit.mjs').Face} Face */
/** @typedef {[number, number]} P2 */
/** @typedef {[number, number, number]} P3 */

/** Matériau écarté de la doublure (ouverture d'une vitre) ; jamais écrit dans le GLB. */
const HOLE = 'paint_vide';

/** Centre du volant et sa normale (vers le conducteur). */
const WHEEL = /** @type {P3} */ ([0.29, 0.9, -0.32]);
const WHEEL_N = /** @type {P3} */ ([-0.85, 0.53, 0]);
/** Pied et bout de la tige du levier : le pommeau se visse au bout. */
const LEVER = /** @type {const} */ ({ base: /** @type {P3} */ ([0.34, 0.3, 0]), top: /** @type {P3} */ ([0.254, 0.705, 0]) });
/** Sièges avant : au sol (doublure du plancher), sous le milieu de l'assise ; ±z. */
const SEAT = /** @type {const} */ ({ x: -0.03, y: 0.113, z: 0.31 });

/**
 * Ancres des pièces d'habitacle partagées (public/assets/shared/habitacle/catalogue.json, anchors) :
 * volant (face vers le conducteur), pommeau (+Y le long de la tige, face vers l'arrière, tournée un
 * peu vers le conducteur), sièges avant.
 * @param {Kit} k
 * @returns {{ node: string, position: P3, rotation?: P3 }[]}
 */
export function ancres(k) {
  const tilt = Math.atan2(LEVER.base[0] - LEVER.top[0], LEVER.top[1] - LEVER.base[1]);
  return [
    { node: 'volant', ...k.anchorPose(WHEEL, WHEEL_N) },
    { node: 'pommeau', position: LEVER.top, rotation: [0, -0.3, tilt] },
    { node: 'siege_avant_gauche', position: [SEAT.x, SEAT.y, -SEAT.z] },
    { node: 'siege_avant_droit', position: [SEAT.x, SEAT.y, SEAT.z] },
  ];
}

/**
 * @param {Kit} k
 * @param {{
 *   half: (x: number) => P2[],
 *   band: (f: Face) => number,
 *   I: { belt: number, glass: number, e: number },
 *   xWs: readonly [number, number],
 *   xDoor: readonly [number, number],
 *   xQtr: readonly [number, number],
 *   xRw: readonly [number, number],
 *   rwZ: number,
 *   xDoorFront: (y: number) => number,
 *   xQtrRear: (y: number) => number,
 *   onDome: (x: number, z: number, out?: number) => P3,
 *   glassAt: (q: P3, margin: number) => boolean,
 *   frames: { loop: P3[], mirror: boolean }[],
 * }} c
 * @returns {Parts}
 */
export default function interieur(k, c) {
  // --- Doublure ----------------------------------------------------------------------------------
  // Section de caisse resserrée : 3,5 cm en dedans sur les flancs, 4 cm sous le pavillon. Percée
  // devant chaque vitre : une face de la doublure saute quand le point de caisse qu'elle regarde
  // (4,5 cm dehors, le long de sa normale) est une vitre ou à moins de 2 cm de son bord. Ainsi rien
  // ne passe derrière le verre, ni le ciel de toit (que la doublure resserrée descend sous le haut
  // des vitres), ni les montants, quel que soit l'angle d'où l'on regarde.
  const SZ = 0.945;
  const SY = 0.965;
  const Y0 = 0.2;
  const X0 = -1.62;
  const X1 = 0.68;
  const GAP = 0.045;
  const MARGIN = 0.02;
  /** @param {Face} f */
  const region = (f) => {
    if (f.cap) return 'black';
    // La normale de la doublure regarde l'habitacle : la caisse est de l'autre côté.
    const q = /** @type {P3} */ ([f.x - f.nx * GAP, f.y - f.ny * GAP, f.z - f.nz * GAP]);
    return c.glassAt(q, MARGIN) ? HOLE : 'black';
  };
  const breaks = [...c.xWs, ...c.xDoor, ...c.xQtr, ...c.xRw].filter((x) => x > X0 && x < X1);
  const lining = k
    .loft({
      sectionAt: (x) => k.mirrorSection(c.half(x).map(([z, y]) => /** @type {P2} */ ([z * SZ, Y0 + (y - Y0) * SY]))),
      xs: k.sampleX(X0, X1, { step: 0.03, endZone: 0.04, endCount: 2, breaks }),
      around: 2,
      material: region,
      inward: true,
      capRows: 3,
      capColumns: 6,
      crease: 70,
    })
    .filter((part) => part.material !== HOLE);

  /** @type {Parts} */
  const parts = [...lining];
  // Joncs noirs autour des ouvertures : posés juste au-delà du bord du verre, 1,2 cm sous la tôle,
  // ils cachent le bord en escalier de la doublure sans passer derrière la vitre.
  for (const { loop, mirror } of c.frames) {
    const sides = mirror ? [loop, loop.map(([x, y, z]) => /** @type {P3} */ ([x, y, -z]))] : [loop];
    for (const side of sides) parts.push(...k.tube(side, { material: 'black', radius: 0.013, closed: true, segments: 72, radial: 6 }));
  }
  const box = (/** @type {number} */ l, /** @type {number} */ h, /** @type {number} */ r, /** @type {number} */ depth, /** @type {string} */ material, /** @type {number} */ bevel = 0.02) =>
    k.roundedExtrude(k.roundedRect(l, h, r, 6), { material, depth, bevel });

  // Tunnel central et moquette.
  parts.push(...k.place(box(1.7, 0.12, 0.05, 0.2, 'black', 0.03), { position: [-0.35, 0.24, 0] }));

  // --- Planche de bord -----------------------------------------------------------------------
  // Panneau plat, face vers le conducteur (−X), sur toute la largeur, et son bourrelet.
  const DASH_X = 0.53;
  const FACE = DASH_X - 0.002;
  parts.push(...k.place(box(0.08, 0.23, 0.03, 1.14, 'black', 0.02), { position: [DASH_X + 0.04, 0.825, 0] }));
  // Bourrelet à arêtes vives sous le pied du pare-brise : il ne double pas le verre.
  parts.push(...k.place(box(0.16, 0.04, 0.008, 1.12, 'black', 0.006), { position: [DASH_X - 0.03, 0.935, 0] }));
  /** Pose sur la face de la planche : (u, v) = (z, y), normale vers le conducteur. @param {Parts} p @param {number} z @param {number} y @param {number} [dx] */
  const onDash = (p, z, y, dx = 0) => k.orient(p, { position: [FACE - dx, y, z], normal: [-1, 0, 0], up: [0, 1, 0] });
  /** Plaque à coins arrondis posée à plat sur la planche (épaisseur vers le conducteur). @param {number} w @param {number} h @param {number} r @param {number} t @param {string} material */
  const plate = (w, h, r, t, material) => k.roundedExtrude(k.roundedRect(w, h, r, 3), { material, depth: t, bevel: Math.min(0.003, t / 2 - 1e-4), bevelSegments: 1 });

  // Gros compteur rond derrière le volant : boîtier, cerclage, cadran noir, graduations, aiguille.
  const GAUGE = /** @type {P3} */ ([DASH_X - 0.005, 0.862, -0.32]);
  const gaugeR = 0.075;
  const gPose = { position: GAUGE, normal: /** @type {P3} */ ([-1, 0.12, 0]), up: /** @type {P3} */ ([0, 1, 0]) };
  /** @type {Parts} */
  const gauge = [
    ...k.lathe([[gaugeR + 0.012, -0.03], [gaugeR + 0.012, 0.0], [gaugeR + 0.004, 0.014], [gaugeR, 0.012]], { material: 'black', segments: 40, crease: 60 }),
    ...k.tube(k.circle(0, 0, gaugeR + 0.003, 32).map(([a, b]) => /** @type {P3} */ ([a, b, 0.014])), { material: 'chrome', radius: 0.005, closed: true, segments: 48, radial: 8 }),
    ...k.lathe([[gaugeR, 0.008], [0, 0.008]], { material: 'black', segments: 40 }),
  ];
  for (let i = 0; i <= 10; i += 1) {
    const a = ((225 - 27 * i) * Math.PI) / 180;
    const r0 = gaugeR * (i % 2 ? 0.82 : 0.74);
    gauge.push(...k.rod([r0 * Math.cos(a), r0 * Math.sin(a), 0.01], [gaugeR * 0.92 * Math.cos(a), gaugeR * 0.92 * Math.sin(a), 0.01], 0.0028, { material: 'alu', radial: 4 }));
  }
  const na = (150 * Math.PI) / 180;
  gauge.push(...k.rod([0, 0, 0.012], [gaugeR * 0.8 * Math.cos(na), gaugeR * 0.8 * Math.sin(na), 0.012], 0.0026, { material: 'signal', radial: 4 }));
  gauge.push(...k.lathe([[0.008, 0.012], [0.008, 0.016], [0, 0.018]], { material: 'black', segments: 12 }));
  parts.push(...k.orient(gauge, gPose));

  // Grille à fines stries verticales, à gauche du compteur : cadre, fond creux, quinze lames.
  const GRILLE_Z = -0.485;
  const GRILLE_Y = 0.85;
  parts.push(...onDash(k.roundedExtrude(k.roundedRect(0.11, 0.13, 0.012, 3), { material: 'black', depth: 0.008, bevel: 0.003, bevelSegments: 1, holes: [k.roundedRect(0.094, 0.114, 0.006, 2)] }), GRILLE_Z, GRILLE_Y, 0.004));
  for (let i = 0; i < 15; i += 1) {
    const z = GRILLE_Z - 0.042 + i * 0.006;
    parts.push(...k.rod([FACE - 0.002, GRILLE_Y - 0.054, z], [FACE - 0.002, GRILLE_Y + 0.054, z], 0.0016, { material: 'black', radial: 4 }));
  }

  // Panneau d'interrupteurs rapporté, au centre (de gauche à droite : capot rouge, gros bouton
  // rouge, trois bascules polies sous leurs voyants), une rangée de trois voyants au-dessus.
  const PANEL_Z = -0.085;
  const PANEL_Y = 0.835;
  parts.push(...onDash(plate(0.27, 0.15, 0.014, 0.01, 'black'), PANEL_Z, PANEL_Y, 0.005));
  const PF = FACE - 0.01; // face du panneau
  const ROW = PANEL_Y - 0.02;
  /** Voyant rond : petite lentille bombée. @param {number} z @param {number} y @param {string} material */
  const pilot = (z, y, material) => k.orient(k.lathe([[0.0055, -0.002], [0.0055, 0.002], [0.003, 0.0045], [0, 0.005]], { material, segments: 10 }), { position: [PF, y, z], normal: [-1, 0, 0], up: [0, 1, 0] });
  // Interrupteur sous capot rouge basculant, relevé : socle, levier poli, capot incliné.
  const COVER_Z = PANEL_Z - 0.1;
  parts.push(...k.orient(plate(0.03, 0.044, 0.004, 0.006, 'black'), { position: [PF - 0.003, ROW, COVER_Z], normal: [-1, 0, 0], up: [0, 1, 0] }));
  parts.push(...k.rod([PF - 0.006, ROW, COVER_Z], [PF - 0.026, ROW - 0.006, COVER_Z], 0.0026, { material: 'chrome', radial: 6 }));
  parts.push(...k.orient(k.roundedExtrude(k.roundedRect(0.028, 0.046, 0.006, 2), { material: 'tail', depth: 0.008, bevel: 0.0025, bevelSegments: 1 }), { position: [PF - 0.022, ROW + 0.032, COVER_Z], normal: [-0.55, -0.83, 0], up: [-0.83, 0.55, 0] }));
  // Gros bouton rond rouge (démarrage) dans sa bague noire.
  const START_Z = PANEL_Z - 0.048;
  parts.push(...k.orient(k.lathe([[0.022, -0.004], [0.022, 0.004], [0.018, 0.007], [0, 0.007]], { material: 'black', segments: 20 }), { position: [PF, ROW, START_Z], normal: [-1, 0, 0], up: [0, 1, 0] }));
  parts.push(...k.orient(k.lathe([[0.016, 0.004], [0.016, 0.014], [0.012, 0.019], [0, 0.021]], { material: 'tail', segments: 20, crease: 50 }), { position: [PF, ROW, START_Z], normal: [-1, 0, 0], up: [0, 1, 0] }));
  // Trois bascules en métal poli, chacune sous un petit voyant.
  for (let i = 0; i < 3; i += 1) {
    const z = PANEL_Z + 0.004 + i * 0.04;
    parts.push(...k.orient(k.lathe([[0.0085, -0.003], [0.0085, 0.004], [0.006, 0.007], [0, 0.007]], { material: 'chrome', segments: 12 }), { position: [PF, ROW, z], normal: [-1, 0, 0], up: [0, 1, 0] }));
    parts.push(...k.rod([PF - 0.006, ROW, z], [PF - 0.03, ROW - 0.012, z], 0.003, { material: 'chrome', radial: 6, top: 0.0022 }));
    parts.push(...pilot(z, ROW + 0.035, 'signal'));
  }
  // Rangée de trois petits voyants ronds au-dessus du panneau.
  for (let i = 0; i < 3; i += 1) parts.push(...pilot(PANEL_Z - 0.09 + i * 0.03, PANEL_Y + 0.058, i === 1 ? 'tail' : 'signal'));

  // Petit cadran rond à cerclage poli sous le panneau, entre deux petits boutons ; un voyant
  // rouge triangulaire à droite.
  const MINI = /** @type {P3} */ ([FACE, 0.738, PANEL_Z]);
  const miniR = 0.024;
  /** @type {Parts} */
  const mini = [
    ...k.lathe([[miniR + 0.004, -0.004], [miniR + 0.004, 0.006], [miniR, 0.007], [0, 0.004]], { material: 'black', segments: 24 }),
    ...k.tube(k.circle(0, 0, miniR + 0.002, 20).map(([a, b]) => /** @type {P3} */ ([a, b, 0.007])), { material: 'chrome', radius: 0.0032, closed: true, segments: 32, radial: 6 }),
    ...k.rod([0, 0, 0.0075], [miniR * 0.75 * Math.cos(2.2), miniR * 0.75 * Math.sin(2.2), 0.0075], 0.0016, { material: 'alu', radial: 4 }),
  ];
  for (let i = 0; i <= 4; i += 1) {
    const a = ((210 - 60 * i) * Math.PI) / 180;
    mini.push(...k.rod([miniR * 0.7 * Math.cos(a), miniR * 0.7 * Math.sin(a), 0.006], [miniR * 0.9 * Math.cos(a), miniR * 0.9 * Math.sin(a), 0.006], 0.0014, { material: 'alu', radial: 4 }));
  }
  parts.push(...k.orient(mini, { position: MINI, normal: [-1, 0, 0], up: [0, 1, 0] }));
  for (const dz of [-0.052, 0.052]) parts.push(...k.orient(k.lathe([[0.007, -0.003], [0.007, 0.006], [0, 0.007]], { material: 'black', segments: 12 }), { position: [FACE, MINI[1], PANEL_Z + dz], normal: [-1, 0, 0], up: [0, 1, 0] }));
  parts.push(...onDash(k.roundedExtrude([[-0.008, -0.006], [0.008, -0.006], [0, 0.008]], { material: 'tail', depth: 0.004, bevel: 0.001, bevelSegments: 1 }), PANEL_Z + 0.08, MINI[1], 0.002));

  // Grande boîte à gants à coins arrondis sur presque toute la moitié droite, serrure ronde en haut.
  const BOX_Z = 0.3;
  const BOX_Y = 0.832;
  parts.push(...onDash(plate(0.45, 0.19, 0.03, 0.012, 'black'), BOX_Z, BOX_Y, 0.004));
  parts.push(...onDash(k.lathe([[0.011, -0.003], [0.011, 0.005], [0.008, 0.008], [0, 0.008]], { material: 'alu', segments: 14 }), BOX_Z, BOX_Y + 0.07, 0.012));
  parts.push(...k.rod([FACE - 0.02, BOX_Y + 0.07 - 0.005, BOX_Z], [FACE - 0.02, BOX_Y + 0.07 + 0.005, BOX_Z], 0.0015, { material: 'black', radial: 4 }));

  // --- Volant (pièce partagée posée par l'app sur l'ancre `volant`) : colonne de direction seule ---
  parts.push(...k.rod([WHEEL[0] + 0.02, WHEEL[1] - 0.012, WHEEL[2]], [DASH_X + 0.02, WHEEL[1] - 0.17, WHEEL[2]], 0.022, { material: 'black', radial: 12 }));

  // --- Levier : tige longue et fine sur un ressort à spires apparentes ; le pommeau (pièce
  //     partagée, tête de mort d'origine) est posé par l'app sur l'ancre `pommeau` -------------
  const BASE = LEVER.base;
  const KNOB = LEVER.top;
  const SPRING_H = 0.2;
  // Embase au plancher, ressort de neuf spires autour du pied de la tige.
  parts.push(...k.place(box(0.16, 0.025, 0.012, 0.13, 'black', 0.008), { position: [BASE[0], BASE[1] - 0.005, 0] }));
  parts.push(...k.place(k.lathe([[0.034, 0], [0.034, 0.012], [0.026, 0.016], [0.012, 0.018]], { material: 'black', axis: 'y', segments: 18 }), { position: BASE }));
  /** @type {P3[]} */
  const coil = [];
  const turns = 9;
  for (let i = 0; i <= turns * 10; i += 1) {
    const t = i / (turns * 10);
    const a = 2 * Math.PI * turns * t;
    coil.push([BASE[0] + 0.024 * Math.cos(a) - 0.09 * t * SPRING_H, BASE[1] + 0.016 + t * SPRING_H, 0.024 * Math.sin(a)]);
  }
  parts.push(...k.tube(coil, { material: 'black', radius: 0.0034, segments: turns * 12, radial: 5, caps: false }));
  parts.push(...k.rod([BASE[0], BASE[1] + 0.01, 0], KNOB, 0.0055, { material: 'black', radial: 8 }));

  // --- Sièges avant : pièces partagées posées par l'app sur les ancres siege_avant_* (baquets
  //     bas d'origine) ; banquette arrière ----------------------------------------------------
  parts.push(...k.place(box(0.46, 0.13, 0.05, 1.08, 'paint_sellerie', 0.035), { position: [-0.88, 0.4, 0] }));
  parts.push(...k.place(box(0.12, 0.55, 0.05, 1.04, 'paint_sellerie', 0.035), { position: [-1.1, 0.72, 0], rotation: [0, 0, 0.32] }));

  // --- Garnitures de portes : accoudoir, tirette, manivelle (noires, aucun chrome décoratif) ---
  for (const s of [-1, 1]) {
    parts.push(...k.place(box(0.42, 0.045, 0.02, 0.05, 'black', 0.015), { position: [0.05, 0.69, s * 0.6] }));
    parts.push(...k.rod([0.3, 0.84, s * 0.605], [0.38, 0.84, s * 0.6], 0.006, { material: 'black', radial: 8 }));
    parts.push(...k.rod([-0.12, 0.6, s * 0.61], [-0.12, 0.6, s * 0.585], 0.012, { material: 'black', radial: 8 }));
    parts.push(...k.rod([-0.12, 0.6, s * 0.585], [-0.07, 0.56, s * 0.585], 0.006, { material: 'black', radial: 6 }));
  }
  // Rétroviseur intérieur au haut du pare-brise.
  parts.push(...k.place(box(0.04, 0.06, 0.02, 0.2, 'black', 0.012), { position: [0.29, 1.285, 0] }));
  // Pare-soleil rabattus contre le ciel de toit, au haut du pare-brise.
  for (const s of [-1, 1]) {
    // Suivent la pente du pavillon en travers : 2 cm sous le ciel de toit.
    parts.push(...k.orient(k.roundedExtrude(k.roundedRect(0.13, 0.28, 0.03, 4), { material: 'black', depth: 0.012, bevel: 0.004, bevelSegments: 1 }), { position: [0.21, 1.295, s * 0.22], normal: [0.2, -0.96, -s * 0.17], up: [0, -0.17 * s, 0.96 * s] }));
  }

  // --- Pédalier : embrayage et frein suspendus, accélérateur à rouleau, devant le conducteur ----
  const PEDAL_X = 0.43;
  for (const [z, len] of /** @type {const} */ ([[-0.43, 0.07], [-0.33, 0.07]])) {
    parts.push(...k.rod([PEDAL_X + 0.09, 0.14, z], [PEDAL_X, 0.29, z], 0.008, { material: 'black', radial: 6 }));
    parts.push(...k.orient(k.roundedExtrude(k.roundedRect(len, 0.06, 0.012, 3), { material: 'rubber', depth: 0.014, bevel: 0.004, bevelSegments: 1 }), { position: [PEDAL_X - 0.008, 0.3, z], normal: [-0.85, 0.53, 0], up: [0.53, 0.85, 0] }));
  }
  parts.push(...k.orient(k.roundedExtrude(k.roundedRect(0.05, 0.16, 0.012, 3), { material: 'rubber', depth: 0.014, bevel: 0.004, bevelSegments: 1 }), { position: [PEDAL_X + 0.04, 0.17, -0.2], normal: [-0.6, 0.8, 0], up: [0.8, 0.6, 0] }));
  parts.push(...k.rod([PEDAL_X + 0.09, 0.13, -0.2], [PEDAL_X + 0.09, 0.13, -0.2 + 0.001], 0.012, { material: 'black', radial: 8 }));

  // --- Essuie-glaces : deux balais au repos au bas du pare-brise, couchés vers la droite -------
  const xWiper = c.xWs[1] - 0.03;
  for (const z0 of [-0.4, 0.02]) {
    const pivot = c.onDome(c.xWs[1] - 0.012, z0, 0.004);
    parts.push(...k.rod(pivot, [pivot[0], pivot[1] + 0.014, pivot[2]], 0.008, { material: 'black', radial: 8 }));
    /** @type {P3[]} */
    const arm = [0, 0.5, 1].map((t) => c.onDome(lerpN(c.xWs[1] - 0.014, xWiper, t), z0 + 0.03 + t * 0.3, 0.016));
    parts.push(...k.tube(arm, { material: 'black', radius: 0.0035, segments: 8, radial: 5 }));
    /** @type {P3[]} */
    const blade = [0, 0.5, 1].map((t) => c.onDome(xWiper - 0.004, z0 + 0.05 + t * 0.34, 0.008));
    parts.push(...k.tube(blade, { material: 'black', radius: 0.006, segments: 8, radial: 5 }));
  }
  return parts;
}

/** @param {number} a @param {number} b @param {number} t */
function lerpN(a, b, t) {
  return a + (b - a) * t;
}
