// @ts-check
// Habitacle de la Cox (placeholder_cox), pour la vue intérieure du manifeste (interiorView : place
// du conducteur, à gauche) et pour ce qu'on voit par les vitres. Tout est noir, d'après la fiche :
// - garnissage fermé : doublure tendue sous toute la caisse de l'habitacle (ciel de toit, montants,
//   flancs, plancher), percée aux vitres seulement, pour qu'on ne voie jamais à travers la caisse ;
// - planche de bord plate, gros compteur rond derrière le volant, rangée d'interrupteurs avec un
//   bouton rouge ;
// - volant noir à trois branches ajourées ;
// - levier de vitesses long à soufflet, pommeau en tête de mort ivoire (zone `pommeau`) ;
// - deux sièges avant à dossier haut, banquette arrière, garnitures de portes.

/** @typedef {typeof import('../../../tools/vehicles/kit.mjs')} Kit */
/** @typedef {import('../../../tools/vehicles/kit.mjs').Parts} Parts */
/** @typedef {import('../../../tools/vehicles/kit.mjs').Face} Face */
/** @typedef {[number, number]} P2 */
/** @typedef {[number, number, number]} P3 */

/** Matériau écarté de la doublure (ouverture d'une vitre) ; jamais écrit dans le GLB. */
const HOLE = 'paint_vide';

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
 *   windows: P3[][],
 * }} c
 * @returns {Parts}
 */
export default function interieur(k, c) {
  // --- Doublure ----------------------------------------------------------------------------------
  // Section de caisse resserrée : 3,5 cm en dedans sur les flancs, 4 cm sous le pavillon.
  const SZ = 0.945;
  const SY = 0.965;
  const Y0 = 0.2;
  const X0 = -1.62;
  const X1 = 0.68;
  const toBodyY = (/** @type {number} */ y) => Y0 + (y - Y0) / SY;
  /** @param {Face} f */
  const region = (f) => {
    if (f.cap) return 'black';
    const p = c.band(f);
    const y = toBodyY(f.y);
    const az = Math.abs(f.z) / SZ;
    // Lunette ovale (sur le dessus de l'arrière).
    if (f.x > c.xRw[0] && f.x < c.xRw[1] && p >= c.I.belt + 2) {
      const ex = (f.x - (c.xRw[0] + c.xRw[1]) / 2) / ((c.xRw[1] - c.xRw[0]) / 2);
      if (ex * ex + (az / c.rwZ) ** 2 < 1) return HOLE;
    }
    if (p >= c.I.e) {
      if (f.x > c.xWs[0] + 0.01 && f.x < c.xWs[1] - 0.005) return HOLE; // pare-brise
      return 'leather'; // ciel de toit
    }
    if (p >= c.I.glass) {
      if (f.x > c.xDoor[0] + 0.01 && f.x < c.xDoorFront(y) - 0.01) return HOLE;
      if (f.x < c.xQtr[1] - 0.01 && f.x > c.xQtrRear(y) + 0.01) return HOLE;
      return 'black'; // montants et pourtour des vitres
    }
    if (p >= c.I.belt) return 'black';
    if (p >= 9) return 'paint_sellerie'; // flancs et garnitures de portes
    return 'black'; // plancher
  };
  const breaks = [...c.xWs, ...c.xDoor, ...c.xQtr, ...c.xRw].filter((x) => x > X0 && x < X1);
  const lining = k
    .loft({
      sectionAt: (x) => k.mirrorSection(c.half(x).map(([z, y]) => /** @type {P2} */ ([z * SZ, Y0 + (y - Y0) * SY]))),
      xs: k.sampleX(X0, X1, { step: 0.04, endZone: 0.04, endCount: 2, breaks }),
      around: 1,
      material: region,
      inward: true,
      capRows: 3,
      capColumns: 6,
      crease: 70,
    })
    .filter((part) => part.material !== HOLE);

  /** @type {Parts} */
  const parts = [...lining];
  // Joncs noirs autour des ouvertures de la doublure : ils cachent le bord en escalier de la grille.
  const inside = (/** @type {P3} */ [x, y, z]) => /** @type {P3} */ ([x, Y0 + (y - Y0) * SY - 0.004, z * SZ]);
  // Les contours des vitres latérales sont donnés côté droit ; celui du pare-brise est complet.
  c.windows.forEach((loop, i) => {
    const pts = loop.map(inside);
    const ws = i === c.windows.length - 1;
    const sides = ws ? [pts] : [pts, pts.map(([x, y, z]) => /** @type {P3} */ ([x, y, -z]))];
    // Jonc du pare-brise plus fin : il se voit de face, à travers le verre.
    for (const side of sides) parts.push(...k.tube(side, { material: 'black', radius: ws ? 0.008 : 0.017, closed: true, segments: 64, radial: 5 }));
  });
  const box = (/** @type {number} */ l, /** @type {number} */ h, /** @type {number} */ r, /** @type {number} */ depth, /** @type {string} */ material, /** @type {number} */ bevel = 0.02) =>
    k.roundedExtrude(k.roundedRect(l, h, r, 6), { material, depth, bevel });

  // Tunnel central et moquette.
  parts.push(...k.place(box(1.7, 0.12, 0.05, 0.2, 'black', 0.03), { position: [-0.35, 0.24, 0] }));

  // --- Planche de bord -----------------------------------------------------------------------
  // Panneau plat, face vers le conducteur (−X), sur toute la largeur, et son bourrelet.
  const DASH_X = 0.575;
  parts.push(...k.place(box(0.1, 0.25, 0.03, 1.2, 'black', 0.02), { position: [DASH_X + 0.05, 0.835, 0] }));
  parts.push(...k.place(box(0.17, 0.05, 0.024, 1.18, 'black', 0.02), { position: [DASH_X + 0.02, 0.965, 0] }));
  // Vide-poche côté passager.
  parts.push(...k.place(box(0.02, 0.09, 0.012, 0.3, 'black', 0.006), { position: [DASH_X - 0.002, 0.86, 0.34] }));

  // Gros compteur rond derrière le volant : boîtier, cerclage chromé, cadran noir, graduations,
  // aiguille orange.
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
  gauge.push(...k.lathe([[0.008, 0.012], [0.008, 0.016], [0, 0.018]], { material: 'chrome', segments: 12 }));
  parts.push(...k.orient(gauge, gPose));

  // Rangée d'interrupteurs au milieu de la planche, dont un gros bouton rouge.
  for (let i = 0; i < 6; i += 1) {
    const z = -0.17 + i * 0.055;
    if (i === 2) {
      parts.push(...k.orient(k.lathe([[0.016, -0.01], [0.016, 0.008], [0.012, 0.014], [0, 0.016]], { material: 'tail', segments: 20, crease: 50 }), { position: [DASH_X - 0.003, 0.79, z], normal: [-1, 0, 0], up: [0, 1, 0] }));
      parts.push(...k.orient(k.tube(k.circle(0, 0, 0.019, 16).map(([a, b]) => /** @type {P3} */ ([a, b, 0])), { material: 'chrome', radius: 0.003, closed: true, segments: 20, radial: 6 }), { position: [DASH_X - 0.002, 0.79, z], normal: [-1, 0, 0], up: [0, 1, 0] }));
    } else {
      parts.push(...k.orient(k.lathe([[0.011, -0.004], [0.011, 0.004], [0, 0.006]], { material: 'chrome', segments: 14 }), { position: [DASH_X - 0.002, 0.79, z], normal: [-1, 0, 0], up: [0, 1, 0] }));
      parts.push(...k.rod([DASH_X - 0.004, 0.79, z], [DASH_X - 0.03, 0.802, z], 0.0035, { material: 'alu', radial: 6 }));
    }
  }

  // --- Volant noir à trois branches ajourées -------------------------------------------------
  const WHEEL = /** @type {P3} */ ([0.29, 0.9, -0.32]);
  const wheelN = /** @type {P3} */ ([-0.85, 0.53, 0]);
  const ringR = 0.19;
  /** @type {Parts} */
  const sw = [];
  sw.push(...k.tube(k.circle(0, 0, ringR, 24).map(([a, b]) => /** @type {P3} */ ([a, b, 0])), { material: 'black', radius: 0.0145, closed: true, segments: 72, radial: 10 }));
  sw.push(...k.lathe([[0.04, -0.03], [0.04, 0.004], [0.03, 0.016], [0, 0.02]], { material: 'black', segments: 24, crease: 50 }));
  sw.push(...k.lathe([[0.014, 0.019], [0.014, 0.024], [0, 0.026]], { material: 'chrome', segments: 14 }));
  // Branches à 3 h, 9 h et 6 h : deux lames qui s'écartent, ajourées au milieu.
  for (const a of [0, Math.PI, -Math.PI / 2]) {
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const at = (/** @type {number} */ r, /** @type {number} */ off) => /** @type {P3} */ ([r * ca - off * sa, r * sa + off * ca, -0.004 + 0.02 * (1 - r / ringR)]);
    for (const s of [-1, 1]) {
      sw.push(...k.tube([at(0.045, s * 0.014), at(0.1, s * 0.024), at(ringR - 0.006, s * 0.022)], { material: 'black', radius: 0.0065, segments: 10, radial: 6 }));
    }
    sw.push(...k.rod(at(ringR - 0.012, -0.024), at(ringR - 0.012, 0.024), 0.0065, { material: 'black', radial: 6 }));
  }
  parts.push(...k.orient(sw, { position: WHEEL, normal: wheelN, up: [0, 1, 0] }));
  // Colonne de direction jusqu'à la planche.
  parts.push(...k.rod([WHEEL[0] + 0.02, WHEEL[1] - 0.012, WHEEL[2]], [DASH_X + 0.02, WHEEL[1] - 0.17, WHEEL[2]], 0.022, { material: 'black', radial: 12 }));

  // --- Levier de vitesses long à soufflet, pommeau en tête de mort ---------------------------
  const BASE = /** @type {P3} */ ([0.34, 0.3, 0]);
  const KNOB = /** @type {P3} */ ([0.25, 0.74, 0]);
  /** @type {P2[]} */
  const boot = [];
  for (let i = 0; i <= 10; i += 1) boot.push([lerpN(0.06, 0.014, i / 10) + (i % 2 ? 0.006 : 0), (0.13 * i) / 10]);
  boot.push([0, 0.13]);
  parts.push(...k.place(k.lathe(boot, { material: 'black', axis: 'y', segments: 18, crease: 80 }), { position: BASE }));
  parts.push(...k.place(box(0.2, 0.03, 0.012, 0.16, 'black', 0.01), { position: [BASE[0], BASE[1] - 0.01, 0] }));
  parts.push(...k.rod([BASE[0], BASE[1] + 0.12, 0], [KNOB[0] + 0.004, KNOB[1] - 0.03, 0], 0.0075, { material: 'chrome', radial: 8 }));
  // Crâne tourné vers le conducteur : boîte crânienne, mâchoire, orbites et nez sombres.
  /** @type {Parts} */
  const skull = [
    ...k.ellipsoid([0.004, 0.006, 0], [0.034, 0.031, 0.029], { material: 'paint_pommeau', segments: 18 }),
    ...k.ellipsoid([-0.012, -0.02, 0], [0.022, 0.016, 0.02], { material: 'paint_pommeau', segments: 14 }),
    ...k.ellipsoid([-0.029, 0.002, -0.012], [0.007, 0.009, 0.0085], { material: 'black', segments: 10 }),
    ...k.ellipsoid([-0.029, 0.002, 0.012], [0.007, 0.009, 0.0085], { material: 'black', segments: 10 }),
    ...k.ellipsoid([-0.032, -0.012, 0], [0.004, 0.005, 0.0035], { material: 'black', segments: 8 }),
  ];
  for (const z of [-0.012, -0.004, 0.004, 0.012]) skull.push(...k.ellipsoid([-0.03, -0.027, z], [0.0035, 0.004, 0.003], { material: 'paint_pommeau', segments: 6 }));
  parts.push(...k.place(skull, { position: KNOB, rotation: [0, -0.6, 0.15] }));

  // --- Sièges --------------------------------------------------------------------------------
  for (const z of [-0.31, 0.31]) {
    // Assise, dossier haut (appui-tête intégré), un peu creusé par deux bourrelets latéraux.
    parts.push(...k.place(box(0.5, 0.12, 0.05, 0.46, 'paint_sellerie', 0.035), { position: [-0.03, 0.43, z], rotation: [0, 0, 0.06] }));
    parts.push(...k.place(box(0.12, 0.8, 0.055, 0.46, 'paint_sellerie', 0.035), { position: [-0.36, 0.86, z], rotation: [0, 0, 0.17] }));
    for (const s of [-1, 1]) parts.push(...k.place(box(0.1, 0.5, 0.04, 0.05, 'paint_sellerie', 0.02), { position: [-0.33, 0.8, z + s * 0.21], rotation: [0, 0, 0.17] }));
    parts.push(...k.place(box(0.06, 0.12, 0.02, 0.36, 'black', 0.015), { position: [-0.06, 0.33, z] }));
  }
  // Banquette arrière.
  parts.push(...k.place(box(0.46, 0.13, 0.05, 1.08, 'paint_sellerie', 0.035), { position: [-0.88, 0.4, 0] }));
  parts.push(...k.place(box(0.12, 0.55, 0.05, 1.04, 'paint_sellerie', 0.035), { position: [-1.1, 0.72, 0], rotation: [0, 0, 0.32] }));

  // --- Garnitures de portes : accoudoir, tirette chromée, manivelle -------------------------
  for (const s of [-1, 1]) {
    parts.push(...k.place(box(0.42, 0.045, 0.02, 0.05, 'black', 0.015), { position: [0.05, 0.69, s * 0.6] }));
    parts.push(...k.rod([0.3, 0.84, s * 0.605], [0.38, 0.84, s * 0.6], 0.006, { material: 'chrome', radial: 8 }));
    parts.push(...k.rod([-0.12, 0.6, s * 0.61], [-0.12, 0.6, s * 0.585], 0.012, { material: 'chrome', radial: 8 }));
    parts.push(...k.rod([-0.12, 0.6, s * 0.585], [-0.07, 0.56, s * 0.585], 0.006, { material: 'chrome', radial: 6 }));
  }
  // Rétroviseur intérieur au haut du pare-brise.
  parts.push(...k.place(box(0.04, 0.06, 0.02, 0.2, 'black', 0.012), { position: [0.2, 1.27, 0] }));
  return parts;
}

/** @param {number} a @param {number} b @param {number} t */
function lerpN(a, b, t) {
  return a + (b - a) * t;
}
