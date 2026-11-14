// Motifs partagés par les œuvres du garage : tête de mort, piston, flammes, éclair, éclat, étoile,
// rayons, trame de points. Tous sont dessinés pour le projet, centrés sur l'origine, et rendus
// comme des fragments SVG que l'appelant place avec un `transform`.

import { f } from './traces.mjs';

// --- Tête de mort (224 × 294, centrée) -------------------------------------------------------------

export const CRANE =
  'M-112 -35C-112 -108 -62 -152 0 -152C62 -152 112 -108 112 -35C112 -5 104 20 92 38C96 50 94 66 80 74C70 80 64 88 62 100L58 128Q56 142 42 142L-42 142Q-56 142 -58 128L-62 100C-64 88 -70 80 -80 74C-94 66 -96 50 -92 38C-104 20 -112 -5 -112 -35Z';
const OEIL = 'M-88 -30C-84 -54 -52 -50 -20 -28C-12 -8 -22 14 -46 18C-72 22 -92 -2 -88 -30Z';
const NEZ = 'M0 22C-6 30 -17 46 -14 54C-10 59 -4 57 0 50C4 57 10 59 14 54C17 46 6 30 0 22Z';
const DENTS = 'M-54 100H54M-33 100V139M-11 100V141M11 100V141M33 100V139';
const FISSURE = 'M50 -139L40 -114L55 -98L45 -76';

/**
 * @param {object} o
 * @param {string} o.id identifiant unique dans le fichier (découpe de l'ombre)
 * @param {string} o.clair
 * @param {string} o.ombre croissant d'ombre, à droite et en bas
 * @param {string} o.trait
 * @param {number} [o.ep] épaisseur du trait
 * @param {string} [o.pupille] point de couleur au fond des orbites
 */
export function crane({ id, clair, ombre, trait, ep = 9, pupille = '' }) {
  const fin = f(ep * 0.72);
  return [
    `<clipPath id="${id}"><path d="${CRANE}"/></clipPath>`,
    `<path d="${CRANE}" fill="${ombre}"/>`,
    `<g clip-path="url(#${id})"><path d="${CRANE}" fill="${clair}" transform="translate(-16 -10)"/></g>`,
    `<path d="${CRANE}" fill="none" stroke="${trait}" stroke-width="${ep}" stroke-linejoin="round"/>`,
    `<path d="${OEIL}" fill="${trait}"/><path d="${OEIL}" fill="${trait}" transform="scale(-1 1)"/>`,
    pupille ? `<circle cx="-50" cy="-10" r="8" fill="${pupille}"/><circle cx="50" cy="-10" r="8" fill="${pupille}"/>` : '',
    `<path d="${NEZ}" fill="${trait}"/>`,
    `<path d="${DENTS}${FISSURE}" fill="none" stroke="${trait}" stroke-width="${fin}" stroke-linecap="round" stroke-linejoin="round"/>`,
  ].join('');
}

// --- Piston et sa bielle (160 × 314, la tête en haut) --------------------------------------------

const P_TETE =
  'M-80 -150Q-80 -166 -64 -166L64 -166Q80 -166 80 -150L80 -52L50 -52Q46 -80 26 -80L-26 -80Q-46 -80 -50 -52L-80 -52Z';
const P_BIELLE = 'M-15 -92L15 -92L25 62L-25 62Z';
const P_CREUX = 'M-6 -44L6 -44L11 44L-11 44Z';

/**
 * @param {object} o
 * @param {string} o.id identifiant unique dans le fichier
 * @param {string} o.clair
 * @param {string} o.ombre
 * @param {string} o.trait
 * @param {string} o.fond couleur vue à travers l'œil de la bielle
 * @param {number} [o.ep]
 */
export function piston({ id, clair, ombre, trait, fond, ep = 8 }) {
  const t = `stroke="${trait}" stroke-width="${ep}" stroke-linejoin="round"`;
  return [
    `<rect x="-68" y="82" width="24" height="36" rx="5" fill="${clair}" ${t}/>`,
    `<rect x="44" y="82" width="24" height="36" rx="5" fill="${ombre}" ${t}/>`,
    `<path d="${P_BIELLE}" fill="${clair}" ${t}/>`,
    `<path d="${P_CREUX}" fill="${ombre}"/>`,
    `<circle cy="100" r="48" fill="${clair}" ${t}/>`,
    `<path d="M0 148A48 48 0 0 0 48 100L25 100A25 25 0 0 1 0 125Z" fill="${ombre}"/>`,
    `<circle cy="100" r="25" fill="${fond}" ${t}/>`,
    `<circle cy="100" r="48" fill="none" ${t}/>`,
    `<clipPath id="${id}"><path d="${P_TETE}"/></clipPath>`,
    `<path d="${P_TETE}" fill="${clair}"/>`,
    `<g clip-path="url(#${id})"><rect x="42" y="-170" width="42" height="124" fill="${ombre}"/></g>`,
    `<path d="M-80 -146H80M-80 -133H80M-80 -120H80" fill="none" stroke="${trait}" stroke-width="${f(ep * 0.6)}"/>`,
    `<circle cy="-99" r="16" fill="${ombre}" ${t}/>`,
    `<path d="${P_TETE}" fill="none" ${t}/>`,
  ].join('');
}

// --- Flammes : des langues qui se recouvrent, base posée sur y = 0 ---------------------------

/** Une langue : base centrée en bx, demi-largeur hw, pointe en (tx, ty) avec ty négatif. */
export function langue(bx, hw, tx, ty) {
  const l = bx - hw;
  const r = bx + hw;
  return `M${f(l)} 0C${f(l - hw * 0.35)} ${f(ty * 0.42)} ${f(tx - hw * 0.55)} ${f(ty * 0.62)} ${f(tx)} ${f(ty)}C${f(tx + hw * 0.1)} ${f(ty * 0.6)} ${f(r + hw * 0.45)} ${f(ty * 0.38)} ${f(r)} 0Z`;
}

/**
 * @param {object} o
 * @param {number[][]} o.langues [bx, hw, tx, ty] par langue
 * @param {string[]} o.couleurs de l'extérieur vers le cœur
 * @param {number[]} [o.echelles] taille de chaque couche
 * @param {string} [o.trait] contour de l'ensemble (sans contour si vide)
 * @param {number} [o.ep]
 */
export function flammes({ langues, couleurs, echelles = [1, 0.68, 0.4], trait = '', ep = 8 }) {
  const couche = (e) => langues.map(([bx, hw, tx, ty]) => langue(bx, hw * e, bx + (tx - bx) * e, ty * e)).join('');
  const dehors = couche(echelles[0]);
  return [
    trait ? `<path d="${dehors}" fill="${trait}" stroke="${trait}" stroke-width="${ep * 2}" stroke-linejoin="round"/>` : '',
    ...couleurs.map((c, i) => `<path d="${couche(echelles[i] ?? echelles.at(-1))}" fill="${c}"/>`),
  ].join('');
}

// --- Éclair, éclat, étoile, rayons, trame ---------------------------------------------------------

/** Éclair (94 × 200, centré). */
export const ECLAIR = 'M2 -100L-46 10L-8 10L-30 100L48 -24L8 -24L42 -100Z';

/** Polygone à pointes : n pointes, rayons r1 (pointes) et r2 (creux), irrégularité entre 0 et 1. */
export function eclat(n, r1, r2, phase = -90, irr = 0) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = ((phase + (i * 180) / n) * Math.PI) / 180;
    const jeu = 1 + irr * Math.sin(i * 12.9898 + n) * (i % 2 ? 0.5 : 1);
    const r = (i % 2 ? r2 : r1) * jeu;
    pts.push(`${f(r * Math.cos(a))} ${f(r * Math.sin(a))}`);
  }
  return `M${pts.join('L')}Z`;
}

/** Étoile à cinq branches de rayon r. */
export const etoile = (r, ri = r * 0.42) => eclat(5, r, ri);

/** Rayons de soleil : n secteurs autour de (cx, cy), un sur deux tracé, longueur R. */
export function rayons(cx, cy, n, R, phase = 0) {
  let d = '';
  for (let i = 0; i < n; i += 2) {
    const a0 = ((phase + (i * 360) / n) * Math.PI) / 180;
    const a1 = ((phase + ((i + 1) * 360) / n) * Math.PI) / 180;
    d += `M${f(cx)} ${f(cy)}L${f(cx + R * Math.cos(a0))} ${f(cy + R * Math.sin(a0))}L${f(cx + R * Math.cos(a1))} ${f(cy + R * Math.sin(a1))}Z`;
  }
  return d;
}

/** Trame de points (motif de remplissage), à déclarer dans `<defs>`. */
export function trame(id, pas, r, couleur, angle = 45) {
  return `<pattern id="${id}" width="${pas}" height="${pas}" patternUnits="userSpaceOnUse" patternTransform="rotate(${angle})"><circle cx="${pas / 2}" cy="${pas / 2}" r="${r}" fill="${couleur}"/></pattern>`;
}

/** Secteur d'anneau entre les rayons r1 et r2 et les angles a0 et a1 (degrés, 0 = vers le haut, sens horaire). */
export function secteur(r1, r2, a0, a1) {
  const p = (r, a) => {
    const t = ((a - 90) * Math.PI) / 180;
    return `${f(r * Math.cos(t), 2)} ${f(r * Math.sin(t), 2)}`;
  };
  const grand = a1 - a0 > 180 ? 1 : 0;
  return `M${p(r1, a0)}A${r1} ${r1} 0 ${grand} 1 ${p(r1, a1)}L${p(r2, a1)}A${r2} ${r2} 0 ${grand} 0 ${p(r2, a0)}Z`;
}
