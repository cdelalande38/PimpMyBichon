// @ts-check
// Bibliothèque des roues partagées (§ 5.4, § 8) : jantes et pneus modelés une fois, posés par l'app
// sur les ancres roue_* de chaque véhicule compatible. Le catalogue (dessins, types, cotes de
// référence) est une donnée : public/assets/shared/wheels/catalogue.json. Chaque jante est modelée
// à la cote de référence de son genre (rayon de jante, largeur) et mise à l'échelle par l'app ; chaque
// pneu est modelé à la cote de référence et recalé par l'app sur la jante, la largeur et la hauteur
// de flanc choisies (src/scene/vehicle/wheels.ts). Repère : axe Z, face extérieure vers +Z, centre à
// l'origine, mètres. Substituts déclarés : placeholder_jantes et placeholder_pneus (TODO_ASSETS.md).
//
// Matériaux : `paint_jantes` (prend la peinture de la zone « Jantes » du véhicule), `paint_flanc`
// (liseré, flanc blanc ou lettres : couleur libre du pneu), et les rôles chrome, alu, black, rubber.

import { readFileSync } from 'node:fs';
import { BoxGeometry, Matrix4, Vector3 } from 'three';
import * as k from './kit.mjs';

/** @typedef {import('./kit.mjs').Parts} Parts */
/** @typedef {[number, number]} P2 */
/** @typedef {[number, number, number]} P3 */
/** @typedef {{ rim: number, outer: number, width: number }} Ref */
/** @typedef {{ id: string, kind: 'car' | 'bike', style: string, label: string, hint?: string, holes?: number, spokes?: number }} RimEntry */
/** @typedef {{ id: string, label: string, mark: 'lisere' | 'flanc' | 'lettres', tread?: string, color: string }} TireEntry */
/** @typedef {{ reference: { car: Ref, bike: Ref }, rims: RimEntry[], tires: TireEntry[] }} Catalogue */

export const CATALOGUE_URL = new URL('../../public/assets/shared/wheels/catalogue.json', import.meta.url);

/** @returns {Catalogue} */
export function readCatalogue() {
  return JSON.parse(readFileSync(CATALOGUE_URL, 'utf8'));
}

/** Fichier d'une jante, sous public/assets/shared/wheels/. @param {string} id */
export const rimFile = (id) => `jante_${id}.glb`;
/** Fichier d'un pneu pour un genre de véhicule. @param {string} id @param {'car' | 'bike'} kind */
export const tireFile = (id, kind) => `pneu_${id}_${kind === 'bike' ? 'moto' : 'auto'}.glb`;

const JANTE = 'paint_jantes';
const FLANC = 'paint_flanc';
const DEG = Math.PI / 180;

/** @param {Parts} parts */
const both = (parts) => parts.map((p) => ({ material: p.material, geometry: k.doubleSided(p.geometry) }));

// ---------------------------------------------------------------------------------------------
// Pièces communes des jantes

/**
 * Fût et lèvres (rebords), vus des deux côtés. `deep` : creux du fût côté intérieur.
 * @param {number} r @param {number} w demi-largeur @param {string} material
 */
function barrel(r, w, material) {
  return both(
    k.lathe(
      [
        [r - 0.012, -w + 0.006],
        [r + 0.012, -w + 0.004],
        [r + 0.015, -w + 0.012],
        [r - 0.006, -w + 0.02],
        [r - 0.015, -w * 0.3],
        [r - 0.015, w * 0.4],
        [r - 0.006, w - 0.022],
        [r + 0.015, w - 0.013],
        [r + 0.016, w - 0.006],
        [r + 0.01, w - 0.001],
        [r - 0.012, w - 0.005],
      ],
      { material, segments: 64, crease: 55 },
    ),
  );
}

/**
 * Valve : tige alu inclinée vers l'extérieur et bouchon noir, sur le fût, à l'angle `a`.
 * @param {number} r @param {number} z @param {number} [a]
 */
function valve(r, z, a = 15 * DEG) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  /** @type {P3} */
  const from = [(r - 0.014) * c, (r - 0.014) * s, z - 0.004];
  /** @type {P3} */
  const to = [(r - 0.03) * c, (r - 0.03) * s, z + 0.018];
  /** @type {P3} */
  const cap = [(r - 0.034) * c, (r - 0.034) * s, z + 0.03];
  return [...k.rod(from, to, 0.0038, { material: 'alu', radial: 8 }), ...k.rod(to, cap, 0.0046, { material: 'black', radial: 8 })];
}

/**
 * Écrous de roue : `n` écrous à six pans sur le cercle `rr`, du plan `z` sur `len`.
 * @param {number} n @param {number} rr @param {number} z @param {number} [len] @param {number} [phase]
 */
function nuts(n, rr, z, len = 0.016, phase = 0) {
  /** @type {Parts} */
  const parts = [];
  for (let i = 0; i < n; i += 1) {
    const a = (2 * Math.PI * i) / n + phase;
    const x = rr * Math.cos(a);
    const y = rr * Math.sin(a);
    parts.push(...k.rod([x, y, z], [x, y, z + len], 0.0095, { material: 'chrome', radial: 6 }));
    parts.push(...k.lathe([[0.0095, z + len], [0.006, z + len + 0.004], [0, z + len + 0.005]], { material: 'chrome', segments: 6 }).map((p) => ({ material: p.material, geometry: p.geometry.translate(x, y, 0) })));
  }
  return parts;
}

/**
 * Disque de frein ventilé (alu) et fond sombre derrière la jante : entre les branches, on voit un
 * frein, pas le décor.
 * @param {number} r @param {number} z plan du disque
 */
function brake(r, z) {
  return [
    ...k.lathe([[r * 0.42, z - 0.012], [r * 0.8, z - 0.012], [r * 0.8, z + 0.012], [r * 0.42, z + 0.012]], { material: 'alu', segments: 56, crease: 50 }),
    ...k.lathe([[r * 0.25, z - 0.006], [r * 0.42, z - 0.006], [r * 0.42, z + 0.016], [r * 0.25, z + 0.016]], { material: 'black', segments: 40, crease: 50 }),
    ...both(k.lathe([[r - 0.016, z - 0.03], [r * 0.3, z - 0.03]], { material: 'black', segments: 56 })),
  ];
}

/**
 * Couronne entre le fût et le plan des branches (`zf`), du rayon `r1` au rayon `r2`.
 * @param {number} r @param {number} w @param {number} zf @param {string} material
 */
function dish(r, w, zf, material) {
  return k.lathe(
    [
      [r - 0.012, w - 0.006],
      [r - 0.02, w - 0.016],
      [r - 0.028, zf + 0.006],
      [r - 0.036, zf - 0.004],
    ],
    { material, segments: 64, crease: 55 },
  );
}

/** Cache central bombé. @param {number} rc @param {number} z @param {string} material */
function cap(rc, z, material) {
  return k.lathe([[rc, z - 0.01], [rc, z + 0.006], [rc * 0.8, z + 0.016], [rc * 0.4, z + 0.021], [0, z + 0.022]], { material, segments: 40, crease: 50 });
}

// ---------------------------------------------------------------------------------------------
// Dessins de jantes (cote de référence : rayon `r`, demi-largeur `w`)

/** @type {Record<string, (o: { r: number, w: number, e: RimEntry, kind: 'car' | 'bike' }) => Parts>} */
const RIM_STYLES = {
  /** Tôle emboutie percée d'une couronne de trous, enjoliveur chromé bombé, valve. */
  tole({ r, w, e }) {
    const parts = k.rim({ rim: r, width: 2 * w, style: 'tole', material: JANTE, holes: e.holes ?? 8, hubRadius: r * 0.42, offset: w * 0.35 });
    const zf = Math.min(w - 0.015, w * 0.35);
    // Enjoliveur : grand dôme chromé qui couvre moyeu et écrous, petit bouton au centre.
    parts.push(
      ...k.lathe(
        [
          [r * 0.5, zf - 0.004],
          [r * 0.5, zf + 0.012],
          [r * 0.46, zf + 0.03],
          [r * 0.34, zf + 0.046],
          [r * 0.16, zf + 0.054],
          [0, zf + 0.056],
        ],
        { material: 'chrome', segments: 56, crease: 40 },
      ),
    );
    parts.push(...k.lathe([[r * 0.08, zf + 0.054], [r * 0.08, zf + 0.06], [0, zf + 0.062]], { material: 'black', segments: 24 }));
    parts.push(...valve(r, w - 0.03));
    return parts;
  },

  /** Alliage poli à branches droites, larges et bombées, en retrait de 4 cm (la jante de la Cox). */
  branches_plates({ r, w, e }) {
    /** @type {Parts} */
    const parts = [...barrel(r, w, JANTE)];
    const zLip = w - 0.008;
    const zS = zLip - 0.04;
    parts.push(...k.lathe([[r - 0.014, zLip - 0.002], [r - 0.02, zLip - 0.012], [r - 0.026, zS + 0.004], [r - 0.034, zS - 0.004]], { material: JANTE, segments: 64, crease: 55 }));
    parts.push(...brake(r, zS - 0.05));
    const n = e.spokes ?? 8;
    const rIn = r * 0.26;
    const rOut = r - 0.026;
    const halfIn = r * 0.105;
    const halfOut = rOut * Math.tan((Math.PI / n) * 0.55);
    /** @type {P2[]} */
    const outline = [];
    for (let i = 0; i <= 4; i += 1) outline.push([rIn + (rOut - rIn) * (i / 4), -(halfIn + (halfOut - halfIn) * (i / 4) ** 0.85)]);
    for (let i = 4; i >= 0; i -= 1) outline.push([rIn + (rOut - rIn) * (i / 4), halfIn + (halfOut - halfIn) * (i / 4) ** 0.85]);
    const spoke = k.roundedExtrude(outline, { material: JANTE, depth: 0.024, bevel: 0.011, bevelSegments: 3 });
    for (let i = 0; i < n; i += 1) parts.push(...k.place(spoke, { position: [0, 0, zS], rotation: [0, 0, (2 * Math.PI * i) / n + Math.PI / n] }));
    const hubR = r * 0.31;
    parts.push(...k.lathe([[hubR, zS - 0.01], [hubR, zS + 0.014], [hubR * 0.78, zS + 0.026], [0, zS + 0.032]], { material: JANTE, segments: 48, crease: 50 }));
    parts.push(...nuts(4, hubR * 0.6, zS + 0.018, 0.016, Math.PI / 4));
    parts.push(...k.lathe([[0.012, zS + 0.03], [0.012, zS + 0.04], [0, zS + 0.042]], { material: 'black', segments: 16 }));
    parts.push(...valve(r, zLip - 0.02, (2 * Math.PI) / n / 2 + Math.PI / n));
    return parts;
  },

  /** Flasque pleine : un disque lisse légèrement bombé, gorge sombre, cache chromé et quatre écrous. */
  flasque({ r, w }) {
    /** @type {Parts} */
    const parts = [...barrel(r, w, JANTE)];
    const zf = w - 0.03;
    parts.push(
      ...k.lathe(
        [
          [r - 0.012, w - 0.006],
          [r - 0.02, w - 0.014],
          [r * 0.9, zf],
          [r * 0.74, zf + 0.004],
          [r * 0.72, zf - 0.002],
          [r * 0.7, zf + 0.004],
          [r * 0.45, zf + 0.014],
          [r * 0.3, zf + 0.018],
          [r * 0.29, zf + 0.012],
          [0, zf + 0.012],
        ],
        { material: JANTE, segments: 72, crease: 35 },
      ),
    );
    // Gorge sombre au pied de la lèvre : le disque se détache du rebord.
    parts.push(...k.lathe([[r - 0.02, w - 0.0135], [r * 0.9, zf + 0.0005]], { material: 'black', segments: 72 }).map((p) => ({ material: p.material, geometry: p.geometry.translate(0, 0, 0.0008) })));
    parts.push(...cap(r * 0.18, zf + 0.012, 'chrome'));
    parts.push(...nuts(4, r * 0.24, zf + 0.012, 0.012, Math.PI / 4));
    parts.push(...valve(r, w - 0.03));
    return parts;
  },

  /** Bâtons : barres droites à section ronde aplatie, moyeu bombé, disque de frein visible. */
  batons({ r, w, e, kind }) {
    /** @type {Parts} */
    const parts = [...barrel(r, w, JANTE)];
    const n = e.spokes ?? 5;
    const moto = kind === 'bike';
    const zf = moto ? 0 : w - 0.045;
    if (!moto) {
      parts.push(...dish(r, w, zf, JANTE));
      parts.push(...brake(r, zf - 0.055));
    }
    const hubR = moto ? 0.055 : r * 0.3;
    for (let i = 0; i < n; i += 1) {
      const a = (2 * Math.PI * i) / n;
      const bar = k.roundedExtrude(
        [
          [hubR * 0.8, -0.019],
          [r - 0.03, -0.017],
          [r - 0.012, -0.022],
          [r - 0.012, 0.022],
          [r - 0.03, 0.017],
          [hubR * 0.8, 0.019],
        ],
        { material: JANTE, depth: moto ? 0.03 : 0.026, bevel: 0.011, bevelSegments: 3 },
      );
      parts.push(...k.place(bar, { position: [0, 0, zf], rotation: [0, 0, a] }));
    }
    if (moto) {
      const hw = w * 0.85;
      parts.push(...k.lathe([[0.02, -hw], [hubR, -hw + 0.006], [hubR, hw - 0.006], [0.02, hw]], { material: JANTE, segments: 40, crease: 50 }));
      parts.push(...k.lathe([[0.014, -hw - 0.012], [0.022, -hw - 0.012], [0.022, hw + 0.012], [0.014, hw + 0.012]], { material: 'alu', segments: 20, crease: 50 }));
      parts.push(...valve(r, w * 0.3, Math.PI / n));
    } else {
      parts.push(...k.lathe([[hubR, zf - 0.012], [hubR, zf + 0.012], [hubR * 0.8, zf + 0.022], [0, zf + 0.026]], { material: JANTE, segments: 48, crease: 50 }));
      parts.push(...nuts(n, hubR * 0.62, zf + 0.016, 0.016, Math.PI / n));
      parts.push(...cap(hubR * 0.32, zf + 0.022, 'black'));
      parts.push(...valve(r, w - 0.03, Math.PI / n));
    }
    return parts;
  },

  /** Rayons fils croisés : fût, moyeu à flasques, rayons chromés ; écrou central à six pans (auto). */
  rayons({ r, w, e, kind }) {
    const moto = kind === 'bike';
    const parts = k.rim({ rim: r, width: 2 * w, style: 'rayons', spokes: e.spokes ?? 40, material: JANTE, hubRadius: moto ? 0.042 : r * 0.24 });
    if (!moto) {
      // Deuxième nappe, plus longue vers l'extérieur (roue d'auto à trois nappes) et écrou central.
      const n = Math.round((e.spokes ?? 72) / 3);
      const hubR = r * 0.24;
      for (let i = 0; i < n; i += 1) {
        const a = (2 * Math.PI * (i + 0.5)) / n;
        const lead = ((i % 2 === 0 ? 1 : -1) * 2 * Math.PI) / n;
        parts.push(...k.rod([hubR * 0.9 * Math.cos(a), hubR * 0.9 * Math.sin(a), w * 0.75], [(r - 0.014) * Math.cos(a + lead), (r - 0.014) * Math.sin(a + lead), w * 0.3], 0.0024, { material: 'chrome', radial: 5 }));
      }
      parts.push(...k.lathe([[hubR, w * 0.6], [hubR, w * 0.78], [hubR * 0.6, w * 0.84], [0, w * 0.85]], { material: 'chrome', segments: 40, crease: 50 }));
      parts.push(...k.rod([0, 0, w * 0.82], [0, 0, w * 0.82 + 0.03], r * 0.13, { material: 'chrome', radial: 6 }));
      parts.push(...k.lathe([[r * 0.06, w * 0.82 + 0.03], [r * 0.03, w * 0.82 + 0.034], [0, w * 0.82 + 0.035]], { material: 'black', segments: 12 }));
      parts.push(...both(k.lathe([[r - 0.016, -w * 0.4], [r * 0.3, -w * 0.4]], { material: 'black', segments: 56 })));
    }
    parts.push(...valve(r, moto ? w * 0.3 : w - 0.03, 7 * DEG));
    return parts;
  },

  /** Déport profond : grande lèvre chromée en cuvette, centre à fines branches enfoncé de 8 cm. */
  deport({ r, w, e }) {
    /** @type {Parts} */
    const parts = [...barrel(r, w, JANTE)];
    const zf = w - 0.085;
    const rc = r * 0.74;
    // Cuvette polie : de la lèvre au plan des branches.
    parts.push(
      ...k.lathe(
        [
          [r + 0.016, w - 0.006],
          [r + 0.01, w + 0.001],
          [r - 0.006, w - 0.002],
          [r - 0.012, w - 0.012],
          [rc + 0.012, zf + 0.012],
          [rc, zf + 0.002],
          [rc - 0.004, zf - 0.006],
        ],
        { material: 'chrome', segments: 72, crease: 40 },
      ),
    );
    parts.push(...brake(r, zf - 0.05));
    const n = e.spokes ?? 10;
    const hubR = r * 0.28;
    for (let i = 0; i < n; i += 1) {
      const a = (2 * Math.PI * i) / n;
      const bar = k.roundedExtrude([[hubR * 0.8, -0.011], [rc + 0.004, -0.009], [rc + 0.004, 0.009], [hubR * 0.8, 0.011]], { material: JANTE, depth: 0.018, bevel: 0.007, bevelSegments: 2 });
      parts.push(...k.place(bar, { position: [0, 0, zf], rotation: [0, 0, a] }));
    }
    parts.push(...k.lathe([[hubR, zf - 0.012], [hubR, zf + 0.012], [hubR * 0.8, zf + 0.02], [0, zf + 0.024]], { material: JANTE, segments: 48, crease: 50 }));
    parts.push(...nuts(5, hubR * 0.62, zf + 0.014, 0.016, Math.PI / 5));
    parts.push(...cap(hubR * 0.32, zf + 0.02, 'chrome'));
    parts.push(...valve(r, w - 0.03, Math.PI / n));
    return parts;
  },

  /** Roue pleine de moto : flasque bombé des deux côtés, moyeu alu, valve. */
  pleine({ r, w }) {
    /** @type {Parts} */
    const parts = [...barrel(r, w, JANTE)];
    const f = w * 0.62;
    parts.push(
      ...k.lathe(
        [
          [0, -f - 0.02],
          [0.045, -f - 0.02],
          [0.07, -f - 0.01],
          [r * 0.75, -f * 0.7],
          [r - 0.014, -w * 0.4],
          [r - 0.014, w * 0.4],
          [r * 0.75, f * 0.7],
          [0.07, f + 0.01],
          [0.045, f + 0.02],
          [0, f + 0.02],
        ],
        { material: JANTE, segments: 72, crease: 40 },
      ),
    );
    parts.push(...k.lathe([[0, -f - 0.034], [0.03, -f - 0.034], [0.03, f + 0.034], [0, f + 0.034]], { material: 'alu', segments: 24 }));
    parts.push(...k.lathe([[0.05, f + 0.012], [0.05, f + 0.02], [0.032, f + 0.026], [0.032, f + 0.012]], { material: 'chrome', segments: 32 }));
    parts.push(...valve(r, w * 0.35, 30 * DEG));
    return parts;
  },
};

/**
 * Jante d'un dessin du catalogue, à la cote de référence de son genre.
 * @param {RimEntry} entry @param {Catalogue} catalogue
 * @returns {Parts}
 */
export function buildRim(entry, catalogue) {
  const style = RIM_STYLES[entry.style];
  if (!style) throw new Error(`jante « ${entry.id} » : style « ${entry.style} » inconnu (${Object.keys(RIM_STYLES).join(', ')})`);
  const ref = catalogue.reference[entry.kind];
  return style({ r: ref.rim, w: ref.width / 2, e: entry, kind: entry.kind });
}

// ---------------------------------------------------------------------------------------------
// Pneus

/**
 * Profil [rayon, z] d'un pneu, du talon intérieur (−z) au talon extérieur (+z), bande de roulement
 * comprise (règle de lathe : matière à gauche). Le même dessin que kit.tire.
 * @param {Ref} ref @param {boolean} moto @param {number} [outer]
 * @returns {P2[]}
 */
export function tireProfile(ref, moto, outer = ref.outer) {
  const w = ref.width / 2;
  const R = outer;
  const r = ref.rim;
  const side = R - r;
  /** @type {P2[]} */
  let prof;
  if (moto) {
    prof = [[r + 0.004, -w * 0.7], [r + side * 0.35, -w * 1.0]];
    for (let i = 0; i <= 16; i += 1) {
      const a = Math.PI * (-0.5 + i / 16);
      prof.push([R - w + w * Math.cos(a), w * Math.sin(a)]);
    }
    prof.push([r + side * 0.35, w * 1.0], [r + 0.004, w * 0.7]);
  } else {
    const sh = Math.min(0.035, side * 0.3);
    prof = [[r + 0.004, -w + 0.012], [r + side * 0.25, -w - 0.006], [r + side * 0.6, -w - 0.008], [R - sh, -w + 0.002]];
    for (let i = 1; i < 6; i += 1) {
      const a = (Math.PI / 2) * (i / 6);
      prof.push([R - sh + sh * Math.sin(a), -w + sh - sh * Math.cos(a)]);
    }
    prof.push([R, -w + sh], [R, -w * 0.5], [R, 0], [R, w * 0.5], [R, w - sh]);
    for (let i = 1; i < 6; i += 1) {
      const a = (Math.PI / 2) * (i / 6);
      prof.push([R - sh + sh * Math.cos(a), w - sh + sh * Math.sin(a)]);
    }
    prof.push([R - sh, w - 0.002], [r + side * 0.6, w + 0.008], [r + side * 0.25, w + 0.006], [r + 0.004, w - 0.012]);
  }
  return prof;
}

/**
 * Peau du flanc extérieur entre deux rayons, décollée de `lift` le long de la normale : liseré,
 * flanc blanc. Suit la moitié +z du profil, de l'épaule vers le talon.
 * @param {P2[]} prof @param {number} r1 @param {number} r2 @param {number} lift
 * @returns {Parts}
 */
function sidewallSkin(prof, r1, r2, lift) {
  const half = prof.slice(prof.findIndex(([, z]) => z > 0) - 1);
  /** @type {P2[]} */
  const pts = [];
  /** @param {number} rr @param {number} zz @param {number} nr @param {number} nz */
  const push = (rr, zz, nr, nz) => {
    const p = /** @type {P2} */ ([rr + nr * lift, zz + nz * lift]);
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 1e-4) pts.push(p);
  };
  for (let i = 0; i < half.length - 1; i += 1) {
    const [ra, za] = /** @type {P2} */ (half[i]);
    const [rb, zb] = /** @type {P2} */ (half[i + 1]);
    if (rb >= ra) continue; // la bande de roulement et le haut de l'épaule montent encore
    const hi = Math.min(ra, r2);
    const lo = Math.max(rb, r1);
    if (hi <= lo) continue;
    const dl = Math.hypot(rb - ra, zb - za) || 1;
    // Normale à droite du sens de parcours : (dz, −dr).
    const nr = (zb - za) / dl;
    const nz = -(rb - ra) / dl;
    for (let s = 0; s <= 4; s += 1) {
      const rr = hi + ((lo - hi) * s) / 4;
      push(rr, za + ((zb - za) * (rr - ra)) / (rb - ra), nr, nz);
    }
  }
  return k.lathe(pts, { material: FLANC, segments: 96, crease: 80 });
}

/** Rayon du flanc extérieur au rayon `rr` (moitié +z du profil). @param {P2[]} prof @param {number} rr */
function sidewallZ(prof, rr) {
  const half = prof.slice(prof.findIndex(([, z]) => z > 0) - 1);
  let best = -Infinity;
  for (let i = 0; i < half.length - 1; i += 1) {
    const [ra, za] = /** @type {P2} */ (half[i]);
    const [rb, zb] = /** @type {P2} */ (half[i + 1]);
    const lo = Math.min(ra, rb);
    const hi = Math.max(ra, rb);
    if (rr < lo || rr > hi || hi === lo) continue;
    best = Math.max(best, za + ((zb - za) * (rr - ra)) / (rb - ra));
  }
  return best;
}

// Lettres en bâtons (largeur 0,6, hauteur 1) : un lettrage à nous, aucun nom de marque.
/** @type {Record<string, number[][]>} */
const GLYPHS = {
  B: [[0, 0, 0, 1], [0, 1, 0.42, 1], [0.42, 1, 0.55, 0.88], [0.55, 0.88, 0.55, 0.62], [0.55, 0.62, 0.42, 0.5], [0, 0.5, 0.45, 0.5], [0.45, 0.5, 0.6, 0.38], [0.6, 0.38, 0.6, 0.12], [0.6, 0.12, 0.48, 0], [0.48, 0, 0, 0]],
  I: [[0.3, 0, 0.3, 1], [0.12, 0, 0.48, 0], [0.12, 1, 0.48, 1]],
  C: [[0.6, 1, 0.12, 1], [0.12, 1, 0, 0.85], [0, 0.85, 0, 0.15], [0, 0.15, 0.12, 0], [0.12, 0, 0.6, 0]],
  H: [[0, 0, 0, 1], [0.6, 0, 0.6, 1], [0, 0.5, 0.6, 0.5]],
  O: [[0.12, 0, 0.48, 0], [0.48, 0, 0.6, 0.15], [0.6, 0.15, 0.6, 0.85], [0.6, 0.85, 0.48, 1], [0.48, 1, 0.12, 1], [0.12, 1, 0, 0.85], [0, 0.85, 0, 0.15], [0, 0.15, 0.12, 0]],
  N: [[0, 0, 0, 1], [0, 1, 0.6, 0], [0.6, 0, 0.6, 1]],
  A: [[0, 0, 0.3, 1], [0.3, 1, 0.6, 0], [0.12, 0.4, 0.48, 0.4]],
  T: [[0, 1, 0.6, 1], [0.3, 1, 0.3, 0]],
  E: [[0.6, 0, 0, 0], [0, 0, 0, 1], [0, 1, 0.6, 1], [0, 0.5, 0.45, 0.5]],
  L: [[0, 1, 0, 0], [0, 0, 0.55, 0]],
  R: [[0, 0, 0, 1], [0, 1, 0.48, 1], [0.48, 1, 0.6, 0.85], [0.6, 0.85, 0.6, 0.65], [0.6, 0.65, 0.48, 0.5], [0.48, 0.5, 0, 0.5], [0.25, 0.5, 0.6, 0]],
};

/**
 * Mot en relief sur le flanc extérieur, centré à l'angle `theta`, lettres debout vers l'extérieur.
 * @param {string} word @param {number} theta @param {number} rMid rayon du milieu des lettres
 * @param {number} height hauteur des lettres (m) @param {P2[]} prof profil du pneu @param {number} relief
 * @returns {Parts}
 */
function word(word, theta, rMid, height, prof, relief) {
  const s = height;
  const stroke = 0.13 * s;
  const advance = 0.85 * s;
  const total = advance * word.length - (advance - 0.6 * s);
  /** Point du flanc (pose des lettres) au rayon rr, à l'angle a. @param {number} rr @param {number} a */
  const onSide = (rr, a) => new Vector3(rr * Math.cos(a), rr * Math.sin(a), sidewallZ(prof, rr) - 0.0006);
  /** @type {import('three').BufferGeometry[]} */
  const boxes = [];
  [...word].forEach((ch, i) => {
    const strokes = GLYPHS[ch];
    if (!strokes) return;
    const u0 = -total / 2 + i * advance;
    for (const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] of strokes) {
      const ends = [[x1, y1], [x2, y2]].map(([x = 0, y = 0]) => onSide(rMid + (y - 0.5) * s, theta - (u0 + x * s) / rMid));
      const [p, q] = /** @type {[Vector3, Vector3]} */ (ends);
      const mid = p.clone().add(q).multiplyScalar(0.5);
      const rm = Math.hypot(mid.x, mid.y);
      // Normale du flanc au milieu du trait (pente du profil), puis repère du trait.
      const slope = (sidewallZ(prof, rm + 0.002) - sidewallZ(prof, rm - 0.002)) / 0.004;
      const normal = new Vector3((-slope * mid.x) / rm, (-slope * mid.y) / rm, 1).normalize();
      const dir = q.clone().sub(p);
      const len = dir.length();
      if (len < 1e-6) dir.set(-mid.y, mid.x, 0);
      dir.addScaledVector(normal, -dir.dot(normal)).normalize();
      const side = normal.clone().cross(dir).normalize();
      const g = new BoxGeometry(len + stroke, stroke, relief);
      g.translate(0, 0, relief / 2);
      g.applyMatrix4(new Matrix4().makeBasis(dir, side, normal).setPosition(mid));
      boxes.push(k.clean(g));
    }
  });
  return boxes.map((geometry) => ({ material: FLANC, geometry: k.smooth(geometry, 30) }));
}

/**
 * Pavés tout-terrain sur la bande (auto) ou le sommet rond (moto), en deux ou trois rangs décalés.
 * @param {Ref} ref @param {boolean} moto @param {number} R rayon du haut des pavés
 */
function tread(ref, moto, R) {
  const w = ref.width / 2;
  const n = moto ? 26 : 30;
  const depth = 0.014;
  /** @type {import('three').BufferGeometry[]} */
  const blocks = [];
  /** @type {{ a: number, size: number, shift: number }[]} rangs : position sur la bande, largeur, décalage */
  const rows = moto
    ? [{ a: -0.62, size: 0.42, shift: 0 }, { a: 0, size: 0.5, shift: 0.5 }, { a: 0.62, size: 0.42, shift: 0 }]
    : [{ a: -0.5, size: 0.62, shift: 0 }, { a: 0.5, size: 0.62, shift: 0.5 }, { a: -0.92, size: 0.2, shift: 0.5 }, { a: 0.92, size: 0.2, shift: 0 }];
  for (const row of rows) {
    // Point du rang sur le profil et normale, dans le plan (rayon, z).
    let pr;
    let pz;
    let nr;
    let nz;
    let along;
    if (moto) {
      const ang = row.a * (Math.PI / 2) * 0.85;
      pr = R - depth - w + w * Math.cos(ang);
      pz = w * Math.sin(ang);
      nr = Math.cos(ang);
      nz = Math.sin(ang);
      along = row.size * w * 1.1;
    } else {
      pr = R - depth;
      pz = row.a * w * 0.9;
      nr = 1;
      nz = 0;
      along = row.size * w * 0.9;
    }
    for (let i = 0; i < n; i += 1) {
      const theta = ((i + row.shift) / n) * 2 * Math.PI;
      const er = new Vector3(Math.cos(theta), Math.sin(theta), 0);
      const et = new Vector3(-Math.sin(theta), Math.cos(theta), 0);
      const ez = new Vector3(0, 0, 1);
      const normal = er.clone().multiplyScalar(nr).addScaledVector(ez, nz);
      const across = er.clone().multiplyScalar(nz).addScaledVector(ez, -nr);
      const g = new BoxGeometry(((2 * Math.PI * R) / n) * 0.55, depth + 0.006, along);
      g.translate(0, (depth + 0.006) / 2 - 0.006, 0);
      const m = new Matrix4().makeBasis(et, normal, across);
      m.setPosition(er.clone().multiplyScalar(pr).addScaledVector(ez, pz));
      g.applyMatrix4(m);
      blocks.push(k.clean(g));
    }
  }
  return blocks.map((geometry) => ({ material: 'rubber', geometry: k.smooth(geometry, 30) }));
}

/**
 * Pneu d'un type du catalogue pour un genre de véhicule, à la cote de référence.
 * @param {TireEntry} entry @param {'car' | 'bike'} kind @param {Catalogue} catalogue
 * @returns {Parts}
 */
export function buildTire(entry, kind, catalogue) {
  const ref = catalogue.reference[kind];
  const moto = kind === 'bike';
  const knobby = entry.tread !== undefined;
  // Pneu à pavés : carcasse un peu plus petite, les pavés ramènent au rayon de référence.
  const carcass = knobby ? ref.outer - 0.012 : ref.outer;
  const prof = tireProfile(ref, moto, carcass);
  /** @type {Parts} */
  const parts = k.lathe(prof, { material: 'rubber', segments: 96, crease: 60 });
  const r = ref.rim;
  const side = carcass - r;
  if (entry.mark === 'lisere') {
    parts.push(...sidewallSkin(prof, r + side * (moto ? 0.5 : 0.56), r + side * (moto ? 0.56 : 0.62), 0.0012));
  } else if (entry.mark === 'flanc') {
    parts.push(...sidewallSkin(prof, r + side * (moto ? 0.4 : 0.2), r + side * (moto ? 0.72 : 0.66), 0.0012));
  } else if (entry.mark === 'lettres') {
    const rMid = r + side * (moto ? 0.4 : 0.46);
    const height = side * (moto ? 0.24 : 0.32);
    for (const [text, theta] of /** @type {[string, number][]} */ ([['BICHON', Math.PI / 2], ['ATELIER', 0], ['BICHON', -Math.PI / 2], ['ATELIER', Math.PI]])) {
      parts.push(...word(text, theta, rMid, height, prof, 0.0024));
    }
    // Deux filets fins au-dessus et au-dessous des lettres.
    parts.push(...sidewallSkin(prof, rMid + height * 0.75, rMid + height * 0.8, 0.0012));
  }
  if (knobby) parts.push(...tread(ref, moto, ref.outer));
  return parts;
}
