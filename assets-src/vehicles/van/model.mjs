// @ts-check
// Le van (placeholder_van) : fourgon moderne blanc rabaissé, jantes tôle percées, bouclier gris.
// Substitut modelé par le code d'après la fiche « Le van » (captures/notes-agents/vague-g-fiches.md),
// à remplacer un jour par un vrai modèle aux mêmes conventions, sans toucher au code.
// Cotes : longueur 4,89 ; largeur 1,90 hors rétroviseurs ; hauteur 1,90 ; empattement 3,00 ;
// porte-à-faux avant 0,90 ; roues de 0,66 ; garde au sol 0,12 (bouclier avant à 0,16).

/** @typedef {typeof import('../../../tools/vehicles/kit.mjs')} Kit */
/** @typedef {[number, number]} P2 */

const X_FRONT = 2.4;
const X_REAR = X_FRONT - 4.89;
const AXLES = [1.5, -1.5];
const WHEEL_R = 0.33;
const ARCH_R = 0.395;
const ARCH_Y = 0.31;
const Z_IN = 0.66; // paroi intérieure des passages de roue
const BELT = 1.08; // ceinture de caisse : bas des vitres latérales
const RAIL = [-2.25, -1.0];
const BUMPER = 0.56; // haut des boucliers avant et arrière
const BUMPER_X = [X_REAR + 0.25, 1.92]; // fin des boucliers sur les flancs // rail de la porte coulissante, sous la ceinture, derrière la porte

/** @param {Kit} k */
export default function van(k) {
  const top = k.smoothCurve([
    [X_REAR, 1.86],
    [X_REAR + 0.1, 1.888],
    [-2.2, 1.897],
    [0.35, 1.9],
    [0.72, 1.865],
    [0.95, 1.74],
    [1.3, 1.46],
    [1.6, 1.16],
    [1.85, 1.085],
    [2.2, 1.03],
    [X_FRONT, 0.98],
  ]);
  const bottom = k.smoothCurve([
    [X_REAR, 0.3],
    [X_REAR + 0.15, 0.27],
    [-2.05, 0.24],
    [1.95, 0.23],
    [2.2, 0.165],
    [X_FRONT, 0.17],
  ]);
  const halfWidth = k.smoothCurve([
    [X_REAR, 0.92],
    [X_REAR + 0.12, 0.943],
    [-2.15, 0.95],
    [1.95, 0.95],
    [2.17, 0.93],
    [2.33, 0.885],
    [X_FRONT, 0.84],
  ]);

  /** Bas du flanc : soulevé en arc au-dessus des roues. @param {number} x @param {number} yb */
  const archBottom = (x, yb) => {
    let y = yb;
    for (const ax of AXLES) {
      const d = Math.abs(x - ax);
      if (d < ARCH_R) y = Math.max(y, ARCH_Y + Math.sqrt(ARCH_R * ARCH_R - d * d));
    }
    return y;
  };

  /** Cotes de la section en x, bouts arrondis compris. @param {number} x */
  const dims = (x) => {
    const front = (/** @type {number} */ r) => k.endInset(x, X_FRONT, r);
    const rear = (/** @type {number} */ r) => k.endInset(x, X_REAR, r);
    const t = top(x) - front(0.11) - rear(0.06);
    const b = bottom(x) + front(0.06) + rear(0.05);
    const w = halfWidth(x) - front(0.13) - rear(0.07);
    return { top: t, bottom: b, w };
  };

  /** Moitié droite de la section en x : [z, y] du milieu du dessous au milieu du dessus. @param {number} x @returns {P2[]} */
  const half = (x) => {
    const { top: t, bottom: yb, w } = dims(x);
    const ya = archBottom(x, yb);
    const shoulder = Math.min(BELT, t - 0.08);
    const rTop = Math.min(0.12, (t - shoulder) * 0.4);
    const tumble = 0.1 * Math.min(1, Math.max(0, (t - shoulder) / 0.8));
    const wTop = w - tumble;
    const wTopEdge = shoulder + (t - rTop - shoulder) * 0.94; // haut des vitres latérales
    const rB = 0.035;
    const zIn = Math.min(Z_IN, w - rB - 0.02);
    const rail0 = Math.min(1.0, shoulder - 0.05);
    const rail1 = Math.min(1.02, shoulder - 0.03);
    /** Flanc droit, légèrement bombé à mi-hauteur. @param {number} y */
    const flankZ = (y) => w + 0.008 * Math.sin((Math.PI * (y - ya)) / Math.max(0.01, shoulder - ya));
    /** @type {P2[]} */
    const pts = [];
    pts.push(...k.segment([0, yb], [zIn, yb], 3));
    pts.push(...k.segment([zIn, yb], [zIn, ya], 2));
    pts.push(...k.segment([zIn, ya], [w - rB, ya], 2));
    pts.push(...k.arc(w - rB, ya + rB, rB, -90, 0, 3).slice(0, -1));
    // Ligne des boucliers (BUMPER) : un point du contour y tombe pile, pour une arête nette.
    const yBump = Math.max(BUMPER, ya + rB + 0.03);
    for (let i = 0; i < 2; i += 1) {
      const y = ya + rB + ((yBump - ya - rB) * i) / 2;
      pts.push([flankZ(y), y]);
    }
    for (let i = 0; i < 4; i += 1) {
      const y = yBump + ((rail0 - yBump) * i) / 4;
      pts.push([flankZ(y), y]);
    }
    pts.push([flankZ(rail0), rail0], [flankZ(rail1), rail1]);
    pts.push(...k.segment([w, shoulder], [wTop, wTopEdge], 6));
    pts.push(...k.segment([wTop, wTopEdge], [wTop, t - rTop], 2));
    pts.push(...k.arc(wTop - rTop, t - rTop, rTop, 0, 90, 6).slice(0, -1));
    for (let i = 0; i <= 6; i += 1) {
      const z = (wTop - rTop) * (1 - i / 6);
      const s = z / Math.max(1e-6, wTop - rTop);
      pts.push([z, t + 0.012 * (1 - s * s)]);
    }
    return pts;
  };

  /** Haut des vitres latérales en x (pour les régions). @param {number} x */
  const windowTop = (x) => {
    const { top: t } = dims(x);
    const shoulder = Math.min(BELT, t - 0.08);
    const rTop = Math.min(0.12, (t - shoulder) * 0.4);
    return shoulder + (t - rTop - shoulder) * 0.94;
  };

  // Joints de porte : une fine colonne noire entre deux abscisses voisines.
  const SEAMS = [1.36, 0.27, -1.02];
  const SEAM_W = 0.006;
  const breaks = [
    ...SEAMS.flatMap((s) => [s, s + SEAM_W]),
    ...AXLES.flatMap((a) => [a - ARCH_R, a - ARCH_R - 0.005, a + ARCH_R, a + ARCH_R + 0.005]),
    0.33, 1.3, -0.95, 0.18, RAIL[0], RAIL[1], ...BUMPER_X,
  ];
  const xs = k.sampleX(X_REAR, X_FRONT, { step: 0.035, endZone: 0.16, endCount: 10, breaks });

  /** @param {import('../../../tools/vehicles/kit.mjs').Face} f */
  const region = (f) => {
    const az = Math.abs(f.z);
    const side = Math.sign(f.z) * f.nz; // > 0 : regarde vers l'extérieur du flanc
    // Dessous et voûtes des passages de roue.
    if (f.ny < -0.55) return 'black';
    if (f.y < 0.8 && az < Z_IN + 0.012 && az > Z_IN - 0.05 && Math.abs(f.nz) > 0.5) return 'black'; // paroi des passages de roue
    if (f.y < 0.8 && az < Z_IN + 0.01 && side < -0.5) return 'black';
    // Avant.
    if (f.x > BUMPER_X[1] && f.y < BUMPER && f.ny < 0.8) {
      if (f.nx > 0.6 && f.y > 0.25 && f.y < 0.4 && az < 0.58) return 'black';
      return 'paint_boucliers';
    }
    if (f.x > 1.95 && f.nx > 0.8) {
      // Phares étirés vers les ailes, cerclés de noir pour se lire sur le blanc. Sur le bouchon
      // seulement : ses rangées et colonnes (capY, capZ) tombent pile sur leurs bords.
      if (az > 0.42 && az < 0.67 && f.y > 0.66 && f.y < 0.86) {
        const inside = az > 0.44 && az < 0.65 && f.y > 0.68 && f.y < 0.84;
        return inside ? 'lamp' : 'black';
      }
      if (f.y > 0.6 && f.y < 0.8 && az < 0.4) {
        if ((f.y > 0.665 && f.y < 0.68) || (f.y > 0.725 && f.y < 0.74)) return 'alu';
        return 'black';
      }
    }
    // Arrière.
    if (f.x < BUMPER_X[0] && f.y < BUMPER && f.ny < 0.8) return 'paint_boucliers';
    if (f.nx < -0.5) {
      if (az > 0.72 && f.y > 0.82 && f.y < 1.5) return 'tail';
      if (az < 0.74 && f.y > 1.1 && f.y < 1.78) return 'glass';
    }
    // Pare-brise.
    if (f.x > 0.74 && f.x < 1.62 && f.nx > 0.3 && f.ny > 0.3 && Math.abs(f.nz) < 0.45 && f.y > 1.14) return 'glass';
    // Vitres latérales : porte avant (montant avant incliné), porte coulissante.
    if (side > 0.55 && f.y > BELT + 0.005 && f.y < windowTop(f.x)) {
      // Porte avant : le haut suit le montant du pare-brise (windowTop descend avec le toit).
      if (f.x > 0.33 && f.x < 1.3) return 'glass';
      if (f.x > -0.95 && f.x < 0.18) return 'glass';
    }
    // Joints de porte et rail de la porte coulissante.
    if (side > 0.5 && f.y < BELT + 0.6) for (const s of SEAMS) if (f.x > s && f.x < s + SEAM_W) return 'black';
    if (side > 0.5 && f.y > 0.995 && f.y < 1.025 && f.x > RAIL[0] && f.x < RAIL[1]) return 'black';
    // Pavillon.
    if (f.ny > 0.9 && f.y > 1.8) return 'paint_toit';
    return 'paint_carrosserie';
  };

  const body = k.loft({
    sectionAt: (x) => k.mirrorSection(half(x)),
    xs,
    around: 2,
    material: region,
    crease: 55,
    // Bouchons en grille : rangées et colonnes posées sur les bords des régions de l'avant et de l'arrière.
    capY: [0.25, 0.4, 0.6, 0.66, 0.665, 0.68, 0.725, 0.74, 0.8, 0.84, 0.86, 0.82, 1.1, 1.5, 1.78],
    capZ: [0.4, 0.42, 0.44, 0.58, 0.65, 0.67, 0.72, 0.74],
    capColumns: 20,
  });

  // Doublure sombre de l'habitacle (vue par les vitres) et mobilier.
  const liningXs = k.sampleX(X_REAR + 0.08, 1.6, { step: 0.12, endZone: 0.05, endCount: 2 });
  const lining = k.loft({
    sectionAt: (x) => {
      const { top: t, w } = dims(x);
      return k.mirrorSection(k.roundedHalf({ bottom: 0.42, top: t - 0.05, halfWidthBottom: w - 0.05, halfWidthTop: w - 0.15, rTop: 0.1, rBottom: 0.03 }));
    },
    xs: liningXs,
    material: 'black',
    inward: true,
    capRows: 1,
    capColumns: 4,
  });
  /** @type {import('../../../tools/vehicles/kit.mjs').Parts} */
  const cabin = [...lining];
  for (const z of [-0.47, 0.12, 0.52]) {
    const wSeat = z < 0 ? 0.5 : 0.38;
    cabin.push(...k.place(k.roundedExtrude(k.roundedRect(0.5, 0.12, 0.05), { material: 'leather', depth: wSeat, bevel: 0.03 }), { position: [0.62, 0.66, z] }));
    cabin.push(...k.place(k.roundedExtrude(k.roundedRect(0.12, 0.66, 0.05), { material: 'leather', depth: wSeat, bevel: 0.03 }), { position: [0.36, 1.02, z], rotation: [0, 0, 0.18] }));
  }
  cabin.push(...k.place(k.roundedExtrude(k.roundedRect(0.42, 0.2, 0.07), { material: 'black', depth: 1.7, bevel: 0.04 }), { position: [1.4, 1.02, 0] }));
  const ring = Array.from({ length: 10 }, (_, i) => /** @type {[number, number, number]} */ ([0, 0.18 * Math.sin((2 * Math.PI * i) / 10), 0.18 * Math.cos((2 * Math.PI * i) / 10)]));
  cabin.push(...k.place(k.tube(ring, { material: 'black', radius: 0.016, closed: true, segments: 60, radial: 8 }), { position: [1.12, 1.18, -0.47], rotation: [0, 0, 0.55] }));

  // Rétroviseurs : bras et coque noire, miroir chromé côté arrière.
  const mirror = [
    ...k.rod([1.36, 1.12, 0.9], [1.33, 1.16, 1.02], 0.02, { material: 'black' }),
    ...k.place(k.roundedExtrude(k.roundedRect(0.11, 0.25, 0.045), { material: 'black', depth: 0.17, bevel: 0.035 }), { position: [1.31, 1.2, 1.055] }),
    ...k.place(k.roundedExtrude(k.roundedRect(0.01, 0.21, 0.03), { material: 'chrome', depth: 0.13, bevel: 0.004 }), { position: [1.253, 1.2, 1.055] }),
  ];
  // Poignées de porte.
  const handles = [0.45, -0.88].flatMap((x) =>
    k.place(k.roundedExtrude(k.roundedRect(0.16, 0.035, 0.015), { material: 'black', depth: 0.028, bevel: 0.009 }), { position: [x, 0.99, 0.955] }),
  );
  // Répétiteur rond orange sur l'aile avant.
  const repeater = k.orient(k.lamp(k.circle(0, 0, 0.024, 20), { material: 'signal', bulge: 0.006, depth: 0.004 }), { position: [2.02, 0.76, 0.948], normal: [0.15, 0, 1] });

  const m = new k.Model('van');
  m.material('paint_carrosserie', { color: '#f0efe9', roughness: 0.3 })
    .material('paint_toit', { color: '#f0efe9', roughness: 0.3 })
    .material('paint_boucliers', { color: '#3a3d42', roughness: 0.75 })
    .material('paint_jantes', { color: '#f0efe9', roughness: 0.3 });
  m.add('carrosserie', body);
  m.add('habitacle', cabin);
  m.add('accessoires', [...k.symmetric(mirror), ...k.symmetric(handles), ...k.symmetric(repeater)]);

  // Roues : un maillage partagé, posé quatre fois (côté gauche : retourné d'un demi-tour).
  m.shared('roue', k.wheel({ outer: WHEEL_R, rim: 0.216, width: 0.215, style: 'tole', material: 'paint_jantes', holes: 14 }));
  const zWheel = 0.82;
  m.instance('roue_avant_droite', 'roue', { position: [AXLES[0], WHEEL_R, zWheel] });
  m.instance('roue_avant_gauche', 'roue', { position: [AXLES[0], WHEEL_R, -zWheel], rotation: [0, Math.PI, 0] });
  m.instance('roue_arriere_droite', 'roue', { position: [AXLES[1], WHEEL_R, zWheel] });
  m.instance('roue_arriere_gauche', 'roue', { position: [AXLES[1], WHEEL_R, -zWheel], rotation: [0, Math.PI, 0] });
  return m;
}
