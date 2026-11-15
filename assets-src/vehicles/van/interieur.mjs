// @ts-check
// Habitacle du van (placeholder_van), pour la vue intérieure du manifeste (interiorView : derrière
// les sièges avant, le plafond et le poste de conduite) et pour ce qu'on voit par les vitres.
// D'après la fiche captures/notes-agents/reference-interieur-van.md, de nuit :
// - garnissage fermé : doublure tendue sous la caisse (plafond noir, flancs, plancher), percée au
//   pare-brise et aux vitres latérales, pour voir le garage et jamais à travers la caisse ;
// - le ciel étoilé, son médaillon, les deux grands cadrans clairs et l'écran central allumé sont
//   dessinés par l'app d'après le manifeste (cabin : sky, panels, light), sur les supports noirs
//   posés ici (plafond, visière du combiné, cadre de l'écran) ;
// - planche de bord, combiné à deux cadrans (aiguilles rouges), console à commandes rouges,
//   volant à jante pleine, deux sièges avant enveloppants à appuie-tête, banquette arrière.

/** @typedef {typeof import('../../../tools/vehicles/kit.mjs')} Kit */
/** @typedef {import('../../../tools/vehicles/kit.mjs').Parts} Parts */
/** @typedef {import('../../../tools/vehicles/kit.mjs').Face} Face */
/** @typedef {[number, number]} P2 */
/** @typedef {[number, number, number]} P3 */

/** Matériau écarté de la doublure (ouverture d'une vitre) ; jamais écrit dans le GLB. */
const HOLE = 'paint_vide';
/** Retrait de la doublure sous la caisse : flancs, pavillon. */
const IN_Z = 0.04;
const IN_Y = 0.045;
const FLOOR = 0.42;

/** Points du combiné et de l'écran : le manifeste (cabin.panels) pose leur lumière au même endroit. */
export const DIALS = /** @type {const} */ ({ x: 1.318, y: 1.19, z: -0.47, gap: 0.068, r: 0.05, normal: [-0.94, 0.34, 0] });
export const SCREEN = /** @type {const} */ ({ x: 1.255, y: 1.21, z: 0, w: 0.22, h: 0.13, normal: [-0.94, 0.34, 0] });

/**
 * @param {Kit} k
 * @param {{
 *   dims: (x: number) => { t: number, w: number, crown: number, rTop: number, tEdge: number, flankTop: number, shoulder: number, tumble: number },
 *   flankZ: (d: any, y: number) => number,
 *   gy: (d: any, g: number) => number,
 *   xRear: number,
 *   xWs: readonly [number, number],
 *   xFwin: readonly [number, number],
 *   xSwin: readonly [number, number],
 * }} c
 * @returns {Parts}
 */
export default function interieur(k, c) {
  // --- Doublure ----------------------------------------------------------------------------------
  // Moitié de section à nombre de points fixe : plancher, flanc (rangées au bas et au haut des
  // vitres), arrondi et pavillon. Indices des rangées du vitrage : I_LO à I_HI ; pavillon dès I_TOP.
  const I_LO = 5;
  const I_HI = 7;
  const I_TOP = 9;
  /** @param {number} x @returns {P2[]} */
  const half = (x) => {
    const d = c.dims(x);
    const zl = (/** @type {number} */ y) => c.flankZ(d, y) - IN_Z;
    const ys = [FLOOR, 0.7, 1.0, c.gy(d, 1.08), c.gy(d, 1.35), c.gy(d, 1.62), c.gy(d, 1.72)];
    for (let i = 1; i < ys.length; i += 1) ys[i] = Math.max(/** @type {number} */ (ys[i]), /** @type {number} */ (ys[i - 1]) + 0.004);
    /** @type {P2[]} */
    const pts = [[0, FLOOR], [zl(FLOOR) * 0.5, FLOOR]];
    for (const y of ys) pts.push([zl(y), y]);
    const top = d.tEdge - IN_Y;
    const wTop = d.w - 0.001 - d.tumble - IN_Z;
    const r = Math.max(0.03, Math.min(d.rTop, top - /** @type {number} */ (ys[ys.length - 1]) - 0.01));
    for (const deg of [35, 70]) {
      const a = (deg * Math.PI) / 180;
      pts.push([wTop - r + r * Math.cos(a), top - r + r * Math.sin(a)]);
    }
    const zr = wTop - r;
    for (let i = 0; i <= 3; i += 1) {
      const z = zr * (1 - i / 3);
      const s = z / Math.max(1e-6, zr);
      pts.push([z, top + d.crown * (1 - s * s)]);
    }
    return pts;
  };
  const HP = half(0).length;
  /** @param {Face} f */
  const band = (f) => {
    const n = 2 * HP - 2;
    const pos = f.v * n;
    return pos <= HP - 1 ? pos : n - pos;
  };
  /** @param {Face} f */
  const region = (f) => {
    if (f.cap) return 'black';
    const p = band(f);
    // Pare-brise : le dessus de la doublure entre le haut et le bas du vitrage.
    if (p >= I_TOP - 1 && f.x > c.xWs[0] + 0.015 && f.x < c.xWs[1] - 0.02) return HOLE;
    // Vitres latérales : entre les rangées du bas et du haut du vitrage.
    if (p > I_LO && p < I_HI + 0.5) {
      if (f.x > c.xFwin[0] + 0.015 && f.x < c.xFwin[1] - 0.015) return HOLE;
      if (f.x > c.xSwin[0] + 0.015 && f.x < c.xSwin[1] - 0.015) return HOLE;
    }
    return 'black';
  };
  const X0 = c.xRear + 0.1;
  const X1 = 1.76;
  const breaks = [...c.xWs, ...c.xFwin, ...c.xSwin].flatMap((x) => [x - 0.015, x + 0.015]).filter((x) => x > X0 && x < X1);
  const lining = k
    .loft({
      sectionAt: (x) => k.mirrorSection(half(x)),
      xs: k.sampleX(X0, X1, { step: 0.14, endZone: 0.05, endCount: 2, breaks }),
      around: 1,
      material: region,
      inward: true,
      capRows: 2,
      capColumns: 4,
      crease: 70,
    })
    .filter((part) => part.material !== HOLE);
  /** @type {Parts} */
  const parts = [...lining];
  const box = (/** @type {number} */ l, /** @type {number} */ h, /** @type {number} */ r, /** @type {number} */ depth, /** @type {string} */ material, /** @type {number} */ bevel = 0.02) =>
    k.roundedExtrude(k.roundedRect(l, h, r, 4), { material, depth, bevel, bevelSegments: 2 });

  // --- Planche de bord ; combiné et écran posés dessus, tournés vers le conducteur ------------------------------------
  parts.push(...k.place(box(0.45, 0.24, 0.08, 1.74, 'black', 0.04), { position: [1.45, 1.0, 0] }));
  /** Pose face au conducteur, normale `n`. @param {Parts} p @param {P3} at @param {readonly number[]} n */
  const facing = (p, at, n) => k.orient(p, { position: at, normal: /** @type {P3} */ ([...n]), up: [0, 1, 0] });
  // Combiné : fond noir, deux cadrans (graduations noires sur la lumière de l'app, aiguilles
  // rouges), petit afficheur entre les deux, visière au-dessus.
  parts.push(...facing(box(0.27, 0.13, 0.05, 0.02, 'black', 0.008), [DIALS.x + 0.012, DIALS.y, DIALS.z], DIALS.normal));
  for (const s of [-1, 1]) {
    const dz = DIALS.z + s * DIALS.gap;
    /** @type {Parts} */
    const dial = [...k.tube(k.circle(0, 0, DIALS.r + 0.004, 28).map(([a, b]) => /** @type {P3} */ ([a, b, 0.004])), { material: 'black', radius: 0.004, closed: true, segments: 28, radial: 5 })];
    for (let i = 0; i <= 8; i += 1) {
      const a = ((220 - 32.5 * i) * Math.PI) / 180;
      dial.push(...k.rod([DIALS.r * 0.74 * Math.cos(a), DIALS.r * 0.74 * Math.sin(a), 0.003], [DIALS.r * 0.92 * Math.cos(a), DIALS.r * 0.92 * Math.sin(a), 0.003], 0.0018, { material: 'black', radial: 4 }));
    }
    const na = ((s < 0 ? 150 : 60) * Math.PI) / 180;
    dial.push(...k.rod([0, 0, 0.005], [DIALS.r * 0.85 * Math.cos(na), DIALS.r * 0.85 * Math.sin(na), 0.005], 0.0022, { material: 'tail', radial: 4 }));
    dial.push(...k.lathe([[0.008, 0.004], [0.008, 0.007], [0, 0.009]], { material: 'black', segments: 12 }));
    parts.push(...facing(dial, [DIALS.x, DIALS.y, dz], DIALS.normal));
  }
  parts.push(...facing(k.lamp(k.roundedRect(0.03, 0.04, 0.005, 2), { material: 'tail', bulge: 0.002, depth: 0.002 }), [DIALS.x - 0.002, DIALS.y, DIALS.z], DIALS.normal));
  parts.push(...k.place(box(0.12, 0.025, 0.012, 0.3, 'black', 0.01), { position: [DIALS.x + 0.03, DIALS.y + 0.085, DIALS.z], rotation: [0, 0, -0.5] }));
  // Écran central : cadre noir ; la dalle allumée est celle de l'app (cabin.panels).
  parts.push(...facing(k.roundedExtrude(k.roundedRect(SCREEN.w + 0.024, SCREEN.h + 0.024, 0.012, 3), { material: 'black', depth: 0.014, bevel: 0.004, bevelSegments: 1, holes: [k.roundedRect(SCREEN.w, SCREEN.h, 0.004, 2)] }), [SCREEN.x - 0.004, SCREEN.y, SCREEN.z], SCREEN.normal));
  parts.push(...facing(box(SCREEN.w + 0.02, SCREEN.h + 0.02, 0.01, 0.006, 'black', 0.002), [SCREEN.x + 0.008, SCREEN.y, SCREEN.z], SCREEN.normal));
  // Console : bouches d'aération et rangée de commandes rétroéclairées en rouge.
  for (const dz of [-0.2, 0.2]) parts.push(...facing(box(0.07, 0.05, 0.012, 0.012, 'black', 0.004), [1.218, 1.07, dz], [-1, 0, 0]));
  for (let i = 0; i < 6; i += 1) parts.push(...facing(box(0.022, 0.009, 0.003, 0.004, 'tail', 0.001), [1.216, 0.99, -0.1 + i * 0.04], [-1, 0, 0]));
  parts.push(...k.place(box(0.6, 0.22, 0.05, 0.26, 'black', 0.03), { position: [0.95, 0.7, 0] }));
  for (let i = 0; i < 4; i += 1) parts.push(...k.place(box(0.018, 0.006, 0.002, 0.03, 'tail', 0.001), { position: [0.9 + i * 0.05, 0.813, 0] }));

  // --- Volant à jante pleine ------------------------------------------------------------------
  const WHEEL = /** @type {P3} */ ([1.18, 1.2, -0.47]);
  /** @type {Parts} */
  const sw = [...k.tube(k.circle(0, 0, 0.19, 24).map(([a, b]) => /** @type {P3} */ ([a, b, 0])), { material: 'black', radius: 0.022, closed: true, segments: 56, radial: 9 })];
  sw.push(...k.lathe([[0.07, -0.03], [0.07, 0.01], [0.055, 0.03], [0, 0.034]], { material: 'black', segments: 24, crease: 50 }));
  for (const a of [0, Math.PI, -Math.PI / 2]) {
    sw.push(...k.place(box(0.13, 0.05, 0.02, 0.016, 'black', 0.006), { position: [0.125 * Math.cos(a), 0.125 * Math.sin(a), 0.004], rotation: [0, 0, a] }));
  }
  parts.push(...k.orient(sw, { position: WHEEL, normal: [-0.82, 0.57, 0], up: [0, 1, 0] }));
  parts.push(...k.rod([WHEEL[0] + 0.03, WHEEL[1] - 0.02, WHEEL[2]], [1.36, 1.06, WHEEL[2]], 0.035, { material: 'black', radial: 12 }));

  // --- Sièges avant enveloppants à appuie-tête, banquette arrière -----------------------------
  for (const z of [-0.47, 0.47]) {
    parts.push(...k.place(box(0.5, 0.12, 0.05, 0.5, 'leather', 0.03), { position: [0.72, 0.68, z] }));
    parts.push(...k.place(box(0.12, 0.72, 0.05, 0.5, 'leather', 0.03), { position: [0.44, 1.06, z], rotation: [0, 0, 0.16] }));
    parts.push(...k.place(box(0.1, 0.2, 0.045, 0.3, 'leather', 0.03), { position: [0.37, 1.52, z], rotation: [0, 0, 0.16] }));
    // Bourrelets latéraux marqués, sur l'assise et le dossier.
    for (const s of [-1, 1]) {
      parts.push(...k.place(box(0.46, 0.07, 0.03, 0.07, 'leather', 0.025), { position: [0.72, 0.76, z + s * 0.22] }));
      parts.push(...k.place(box(0.13, 0.55, 0.04, 0.07, 'leather', 0.025), { position: [0.47, 1.02, z + s * 0.23], rotation: [0, 0, 0.16] }));
    }
  }
  parts.push(...k.place(box(0.5, 0.13, 0.05, 1.5, 'leather', 0.03), { position: [-0.95, 0.66, 0] }));
  parts.push(...k.place(box(0.12, 0.7, 0.05, 1.5, 'leather', 0.03), { position: [-1.22, 1.04, 0], rotation: [0, 0, 0.18] }));
  for (const z of [-0.5, 0, 0.5]) parts.push(...k.place(box(0.1, 0.18, 0.04, 0.28, 'leather', 0.03), { position: [-1.3, 1.5, z], rotation: [0, 0, 0.18] }));
  return parts;
}
