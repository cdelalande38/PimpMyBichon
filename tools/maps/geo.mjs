// @ts-check
// Géodésie des cartes : projection conique conforme de Lambert-93 (EPSG:2154, ellipsoïde GRS80,
// RGF93 assimilé à WGS84 au mètre près), dans les deux sens, et passage au repère d'une carte
// (mètres ; X vers l'est, Y vers le haut, Z vers le sud ; origine au départ, à son altitude).
// Aucune dépendance au fournisseur : chaque fournisseur déclare sa projection (fournisseurs/*.mjs).

const A = 6378137;
const F = 1 / 298.257222101;
const E = Math.sqrt(2 * F - F * F);
const RAD = Math.PI / 180;

/** @param {number} phi */
const mFn = (phi) => Math.cos(phi) / Math.sqrt(1 - E * E * Math.sin(phi) ** 2);
/** @param {number} phi */
const tFn = (phi) => Math.tan(Math.PI / 4 - phi / 2) / ((1 - E * Math.sin(phi)) / (1 + E * Math.sin(phi))) ** (E / 2);

/**
 * Projection conique conforme à deux parallèles automécoïques.
 * @param {{ lat0: number, lon0: number, lat1: number, lat2: number, x0: number, y0: number }} p degrés et mètres
 */
export function lambertConique(p) {
  const phi1 = p.lat1 * RAD;
  const phi2 = p.lat2 * RAD;
  const m1 = mFn(phi1);
  const m2 = mFn(phi2);
  const t1 = tFn(phi1);
  const t2 = tFn(phi2);
  const n = (Math.log(m1) - Math.log(m2)) / (Math.log(t1) - Math.log(t2));
  const FF = m1 / (n * t1 ** n);
  const rho0 = A * FF * tFn(p.lat0 * RAD) ** n;
  const lam0 = p.lon0 * RAD;
  return {
    /** @param {number} lon @param {number} lat @returns {[number, number]} */
    forward(lon, lat) {
      const rho = A * FF * tFn(lat * RAD) ** n;
      const theta = n * (lon * RAD - lam0);
      return [p.x0 + rho * Math.sin(theta), p.y0 + rho0 - rho * Math.cos(theta)];
    },
    /** @param {number} x @param {number} y @returns {[number, number]} */
    inverse(x, y) {
      const dx = x - p.x0;
      const dy = rho0 - (y - p.y0);
      const rho = Math.sign(n) * Math.hypot(dx, dy);
      const t = (rho / (A * FF)) ** (1 / n);
      const theta = Math.atan2(dx, dy);
      let phi = Math.PI / 2 - 2 * Math.atan(t);
      for (let i = 0; i < 12; i += 1) {
        const s = E * Math.sin(phi);
        phi = Math.PI / 2 - 2 * Math.atan(t * ((1 - s) / (1 + s)) ** (E / 2));
      }
      return [(theta / n + lam0) / RAD, phi / RAD];
    },
    /** Facteur d'échelle de la projection à une latitude. @param {number} lat */
    scale(lat) {
      const phi = lat * RAD;
      return (n * A * FF * tFn(phi) ** n) / (A * mFn(phi));
    },
  };
}

/** Lambert-93 (EPSG:2154). */
export const LAMBERT93 = lambertConique({ lat0: 46.5, lon0: 3, lat1: 49, lat2: 44, x0: 700000, y0: 6600000 });

/**
 * Repère d'une carte à partir d'une projection plane : origine (x0, y0, z0) en coordonnées projetées
 * et altitude ; les distances sont ramenées au mètre vrai par le facteur d'échelle à l'origine.
 * @param {{ forward: (lon: number, lat: number) => [number, number], inverse: (x: number, y: number) => [number, number], scale: (lat: number) => number }} proj
 * @param {[number, number, number]} origine x, y projetés et altitude
 */
export function repereCarte(proj, origine) {
  const [x0, y0, z0] = origine;
  const lat0 = proj.inverse(x0, y0)[1];
  const k = proj.scale(lat0);
  return {
    k,
    /** Coordonnées projetées et altitude → repère de la carte. @param {number} x @param {number} y @param {number} [z] @returns {[number, number, number]} */
    versCarte(x, y, z = z0) {
      return [(x - x0) / k, z - z0, -(y - y0) / k];
    },
    /** Repère de la carte (X, Z) → coordonnées projetées. @param {number} X @param {number} Z @returns {[number, number]} */
    versProjete(X, Z) {
      return [x0 + X * k, y0 - Z * k];
    },
  };
}
