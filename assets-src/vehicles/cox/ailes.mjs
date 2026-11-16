// @ts-check
// Ailes rapportées de la Cox (placeholder_cox) : une aile est un loft dont la section, à dessus
// rond, est centrée sur zc(x) et posée sur la voûte du passage de roue ; devant et derrière la
// roue, elle descend en jupe jusqu'au bas de caisse. Le jonc d'aile suit la ligne où la peau de
// l'aile entre dans la caisse.

/** @typedef {typeof import('../../../tools/vehicles/kit.mjs')} Kit */
/** @typedef {import('../../../tools/vehicles/kit.mjs').Parts} Parts */
/** @typedef {import('../../../tools/vehicles/kit.mjs').Face} Face */
/** @typedef {[number, number]} P2 */
/** @typedef {[number, number, number]} P3 */

/**
 * @typedef {{
 *   x0: number, x1: number, axle: number, archR: number, wheelR: number,
 *   crest: P2[], base: P2[], hw: P2[], zc: P2[], roundTop: P2[], r0: number, r1: number,
 * }} FenderSpec
 * @typedef {{ t: number, b: number, w: number, c: number, q: number }} FenderDims
 */

/** @param {number} a @param {number} b @param {number} t */
const lerp = (a, b, t) => a + (b - a) * t;
/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Moitié de section d'aile (côté extérieur, du milieu du dessous au milieu du dessus), en
 * coordonnées locales (z depuis le centre).
 * @param {Kit} k @param {FenderDims} d
 */
function fenderHalf(k, d) {
  return k.roundedHalf({
    bottom: d.b,
    top: d.t,
    halfWidthBottom: d.w,
    halfWidthTop: d.w * lerp(0.92, 1, d.q),
    rBottom: 0.02,
    rTop: lerp(Math.min(d.w * 0.75, 0.15), d.w, d.q),
    crown: 0.004 * (1 - d.q),
    n: 6,
  });
}

/**
 * Peau d'une aile côté droit.
 * @param {Kit} k @param {FenderSpec} o @param {(f: Face) => string} material
 * @returns {{ parts: Parts, dims: (x: number) => FenderDims, half: (d: FenderDims) => P2[] }}
 */
export function fenderSkin(k, o, material) {
  const yt = k.smoothCurve(o.crest);
  const yb0 = k.smoothCurve(o.base);
  const hw = k.smoothCurve(o.hw);
  const zc = k.smoothCurve(o.zc);
  const round = k.smoothCurve(o.roundTop);
  /** @param {number} x @returns {FenderDims} */
  const dims = (x) => {
    const ends = (/** @type {number} */ r) => k.endInset(x, o.x1, o.r1 * r) + k.endInset(x, o.x0, o.r0 * r);
    const t = yt(x) - ends(1);
    const dx = Math.abs(x - o.axle);
    let b = yb0(x) + ends(0.8);
    if (dx < o.archR) b = Math.max(b, o.wheelR + Math.sqrt(o.archR * o.archR - dx * dx));
    b = Math.min(b, t - 0.035);
    const w = Math.max(0.02, hw(x) - ends(1.4));
    return { t, b, w, c: zc(x), q: clamp(round(x), 0, 1) };
  };
  const parts = k.loft({
    sectionAt: (x) => {
      const d = dims(x);
      return k.mirrorSection(fenderHalf(k, d)).map(([z, y]) => /** @type {P2} */ ([z + d.c, y]));
    },
    xs: k.sampleX(o.x0, o.x1, { step: 0.035, endZone: 0.12, endCount: 7, breaks: [o.axle - o.archR, o.axle + o.archR] }),
    around: 1,
    material,
    crease: 65,
    capRows: 4,
    capColumns: 6,
  });
  return { parts, dims, half: (d) => fenderHalf(k, d) };
}

/**
 * Jonc d'aile : tube le long de la ligne où le dessus de l'aile (côté intérieur) entre dans la
 * caisse, de `from` à `to`.
 * @param {Kit} k
 * @param {(x: number) => FenderDims} dims
 * @param {(x: number, y: number) => number} bodyZ demi-largeur de la caisse à la hauteur y
 * @param {{ from: number, to: number, radius: number, material: string, count?: number }} o
 * @returns {Parts}
 */
export function beadAlong(k, dims, bodyZ, o) {
  const n = o.count ?? 48;
  /** @type {P3[][]} */
  const runs = [[]];
  for (let i = 0; i <= n; i += 1) {
    const x = lerp(o.from, o.to, i / n);
    const d = dims(x);
    // Contour intérieur, du milieu du dessus vers le bas (z décroissant depuis le centre).
    const pts = fenderHalf(k, d)
      .slice()
      .reverse()
      .map(([z, y]) => /** @type {P2} */ ([d.c - z, y]));
    /** @type {P3 | null} */
    let hit = null;
    for (let j = 0; j < pts.length - 1; j += 1) {
      const [za, ya] = /** @type {P2} */ (pts[j]);
      const [zb, yb] = /** @type {P2} */ (pts[j + 1]);
      const ga = za - bodyZ(x, ya);
      const gb = zb - bodyZ(x, yb);
      if (ga >= 0 && gb < 0) {
        const s = ga / (ga - gb);
        hit = [x, lerp(ya, yb, s) + o.radius * 0.3, lerp(za, zb, s) + o.radius * 0.4];
        break;
      }
    }
    const run = /** @type {P3[]} */ (runs[runs.length - 1]);
    if (hit) run.push(hit);
    else if (run.length) runs.push([]);
  }
  return runs.filter((r) => r.length >= 3).flatMap((r) => k.tube(r, { material: o.material, radius: o.radius, segments: r.length * 2, radial: 6 }));
}
