// Outils de tracé pour les œuvres du garage. Aucune dépendance.
//
// - lire / transformer / ecrire : un chemin SVG écrit en commandes absolues (M L H V C Q A Z) est
//   ramené à M, L, C et Z ; on peut alors cuire une transformation affine dans ses coordonnées
//   (les arcs deviennent des courbes de Bézier, donc l'inclinaison de la maison reste exacte).
// - texte : l'alphabet filaire dessiné pour le projet (capitales, chiffres, quelques signes), un
//   trait au centre de chaque lettre. Il donne les tubes des néons et, en trait épais, tous les
//   autres lettrages. Aucune police n'entre dans les fichiers.
// - svg : l'enveloppe commune des fichiers.
//
// Les données de chemin sortent sans espace autour des commandes et avec des virgules entre les
// nombres : aucune suite « chiffres, capitales, chiffres » ne peut y apparaître par hasard.

/** Palette de l'interface (§ 4 du cahier des charges). */
export const PALETTE = Object.freeze({
  nuit: '#0a0911',
  rouge: '#ff2d3f',
  bleu: '#3b7bff',
  chrome: '#ece9f4',
  ambre: '#ffb224',
  turquoise: '#22d3b6',
});

/** Inclinaison de la maison, en degrés (la même que celle de l'icône). */
export const PENTE = 9;

/** Nombre arrondi, sans zéros inutiles. */
export function f(n, dec = 1) {
  const v = Number(Number(n).toFixed(dec));
  return Object.is(v, -0) ? '0' : String(v);
}

// --- Matrices affines [a, b, c, d, e, f] : x' = a·x + c·y + e ; y' = b·x + d·y + f ----------

export const M = {
  id: [1, 0, 0, 1, 0, 0],
  t: (x, y = 0) => [1, 0, 0, 1, x, y],
  s: (sx, sy = sx) => [sx, 0, 0, sy, 0, 0],
  r: (deg) => {
    const a = (deg * Math.PI) / 180;
    return [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
  },
  /** Inclinaison horizontale (skewX). */
  k: (deg) => [1, 0, Math.tan((deg * Math.PI) / 180), 1, 0, 0],
  /** Produit, dans l'ordre d'une liste `transform` SVG : la dernière matrice s'applique d'abord. */
  x: (...ms) =>
    ms.reduce((p, q) => [
      p[0] * q[0] + p[2] * q[1],
      p[1] * q[0] + p[3] * q[1],
      p[0] * q[2] + p[2] * q[3],
      p[1] * q[2] + p[3] * q[3],
      p[0] * q[4] + p[2] * q[5] + p[4],
      p[1] * q[4] + p[3] * q[5] + p[5],
    ]),
};

const point = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// --- Arcs elliptiques -> courbes de Bézier cubiques -------------------------------------------

function arc(x1, y1, rx, ry, phi, grand, sens, x2, y2) {
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return [[x1, y1, x2, y2, x2, y2]];
  const sinP = Math.sin(phi);
  const cosP = Math.cos(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosP * dx + sinP * dy;
  const y1p = -sinP * dx + cosP * dy;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = (grand === sens ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
  const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;
  const angle = (ux, uy, vx, vy) => {
    const d = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const a = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / d)));
    return ux * vy - uy * vx < 0 ? -a : a;
  };
  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const t1 = angle(1, 0, ux, uy);
  let dt = angle(ux, uy, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sens && dt > 0) dt -= 2 * Math.PI;
  else if (sens && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
  const pas = dt / n;
  const t = (4 / 3) * Math.tan(pas / 4);
  const sur = (c, s) => [cx + rx * c * cosP - ry * s * sinP, cy + rx * c * sinP + ry * s * cosP];
  const der = (c, s) => [-rx * s * cosP - ry * c * sinP, -rx * s * sinP + ry * c * cosP];
  const courbes = [];
  for (let i = 0; i < n; i++) {
    const a1 = t1 + i * pas;
    const a2 = a1 + pas;
    const p1 = sur(Math.cos(a1), Math.sin(a1));
    const p2 = sur(Math.cos(a2), Math.sin(a2));
    const d1 = der(Math.cos(a1), Math.sin(a1));
    const d2 = der(Math.cos(a2), Math.sin(a2));
    courbes.push([p1[0] + t * d1[0], p1[1] + t * d1[1], p2[0] - t * d2[0], p2[1] - t * d2[1], p2[0], p2[1]]);
  }
  return courbes;
}

// --- Chemins --------------------------------------------------------------------------------------

const COMMANDE = /^[A-Za-z]$/;

/** Lit un chemin en commandes absolues et le ramène à des segments M, L, C et Z. */
export function lire(d) {
  const jetons = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)/g) ?? [];
  const segs = [];
  let i = 0;
  let cmd = '';
  let x = 0;
  let y = 0;
  let x0 = 0;
  let y0 = 0;
  const n = () => {
    if (i >= jetons.length || COMMANDE.test(jetons[i])) throw new Error(`nombre attendu dans « ${d} »`);
    return Number(jetons[i++]);
  };
  while (i < jetons.length) {
    if (COMMANDE.test(jetons[i])) cmd = jetons[i++];
    else if (cmd === 'M') cmd = 'L';
    else if (cmd === 'Z' || cmd === '') throw new Error(`commande attendue dans « ${d} »`);
    switch (cmd) {
      case 'M':
        x = n();
        y = n();
        x0 = x;
        y0 = y;
        segs.push(['M', x, y]);
        break;
      case 'L':
        x = n();
        y = n();
        segs.push(['L', x, y]);
        break;
      case 'H':
        x = n();
        segs.push(['L', x, y]);
        break;
      case 'V':
        y = n();
        segs.push(['L', x, y]);
        break;
      case 'C': {
        const a = [n(), n(), n(), n(), n(), n()];
        segs.push(['C', ...a]);
        x = a[4];
        y = a[5];
        break;
      }
      case 'Q': {
        const qx = n();
        const qy = n();
        const ex = n();
        const ey = n();
        segs.push(['C', x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey), ex, ey]);
        x = ex;
        y = ey;
        break;
      }
      case 'A': {
        const rx = n();
        const ry = n();
        const rot = n();
        const grand = n();
        const sens = n();
        const ex = n();
        const ey = n();
        for (const c of arc(x, y, rx, ry, (rot * Math.PI) / 180, grand, sens, ex, ey)) segs.push(['C', ...c]);
        x = ex;
        y = ey;
        break;
      }
      case 'Z':
        segs.push(['Z']);
        x = x0;
        y = y0;
        break;
      default:
        throw new Error(`commande « ${cmd} » non gérée (commandes absolues seulement) dans « ${d} »`);
    }
  }
  return segs;
}

/** Applique une matrice à des segments. */
export function transformer(segs, m) {
  return segs.map((s) => {
    const out = [s[0]];
    for (let i = 1; i < s.length; i += 2) out.push(...point(m, s[i], s[i + 1]));
    return out;
  });
}

/** Écrit des segments : commandes collées aux nombres, virgules entre les nombres. */
export function ecrire(segs, dec = 1) {
  return segs.map((s) => s[0] + s.slice(1).map((v) => f(v, dec)).join(',')).join('');
}

/** Chemin lu, transformé et réécrit. */
export function chemin(d, m = M.id, dec = 1) {
  return ecrire(transformer(lire(d), m), dec);
}

// --- Alphabet filaire -----------------------------------------------------------------------------
// Chaque lettre tient entre y = 0 (haut des capitales) et y = 100 (ligne de base) : [largeur, tracé].

export const ALPHABET = Object.freeze({
  A: [70, 'M0 100L35 0L70 100M12.6 64H57.4'],
  B: [62, 'M0 100V0H34A24 24 0 0 1 34 48H0H36A26 26 0 0 1 36 100H0'],
  C: [58.2, 'M58.2 13.6A32 32 0 0 0 0 32V68A32 32 0 0 0 58.2 86.4'],
  D: [62, 'M0 0V100H26A36 36 0 0 0 62 64V36A36 36 0 0 0 26 0H0'],
  E: [54, 'M54 0H0V100H54M0 50H44'],
  É: [54, 'M54 0H0V100H54M0 50H44M20 -16L36 -32'],
  F: [54, 'M54 0H0V100M0 50H44'],
  G: [64, 'M58.2 13.6A32 32 0 0 0 0 32V68A32 32 0 0 0 64 68V54H36'],
  H: [62, 'M0 0V100M62 0V100M0 50H62'],
  I: [0, 'M0 0V100'],
  J: [44, 'M44 0V72A22 22 0 0 1 0 72'],
  K: [60, 'M0 0V100M58 0L0 60M24 35.2L60 100'],
  L: [50, 'M0 0V100H50'],
  M: [80, 'M0 100V0L40 62L80 0V100'],
  N: [64, 'M0 100V0L64 100V0'],
  O: [66, 'M0 33A33 33 0 0 1 66 33V67A33 33 0 0 1 0 67Z'],
  P: [60, 'M0 100V0H34A26 26 0 0 1 34 52H0'],
  Q: [66, 'M0 33A33 33 0 0 1 66 33V67A33 33 0 0 1 0 67ZM40 76L68 104'],
  R: [62, 'M0 100V0H34A26 26 0 0 1 34 52H0M30 52L62 100'],
  S: [50, 'M46.7 12.5A25 25 0 1 0 25 50A25 25 0 1 1 3.3 87.5'],
  T: [60, 'M0 0H60M30 0V100'],
  U: [64, 'M0 0V68A32 32 0 0 0 64 68V0'],
  V: [68, 'M0 0L34 100L68 0'],
  W: [88, 'M0 0L20 100L44 30L68 100L88 0'],
  X: [62, 'M0 0L62 100M62 0L0 100'],
  Y: [66, 'M0 0L33 52L66 0M33 52V100'],
  Z: [60, 'M0 0H60L0 100H60'],
  0: [54, 'M0 27A27 27 0 0 1 54 27V73A27 27 0 0 1 0 73Z'],
  1: [26, 'M0 24L26 0V100'],
  2: [54, 'M0.9 20A27 27 0 0 1 54 27C54 52 0 68 0 100H54'],
  3: [52, 'M5.3 12.5A25 25 0 1 1 27 50A25 25 0 1 1 5.3 87.5'],
  4: [54, 'M40 100V0L0 68H54'],
  5: [56, 'M50 0H8L5.1 45.3A31 31 0 1 1 1.3 88.9'],
  6: [54, 'M46 2C18 12 0 44 0 73A27 27 0 0 0 54 73A27 27 0 0 0 0 73'],
  7: [54, 'M0 0H54L18 100'],
  8: [54, 'M27 48A24 24 0 0 1 27 0A24 24 0 0 1 27 48A26 26 0 0 1 27 100A26 26 0 0 1 27 48'],
  9: [54, 'M54 27A27 27 0 0 0 0 27A27 27 0 0 0 54 27C54 56 36 88 8 98'],
  "'": [4, 'M4 0L0 24'],
  '-': [30, 'M0 52H30'],
  '.': [0, 'M0 99V100'],
  '!': [0, 'M0 0V66M0 99V100'],
});

/**
 * Compose une ligne de texte dans l'alphabet filaire.
 * @param {string} str capitales, chiffres, espace et quelques signes
 * @param {object} o
 * @param {number} [o.x] abscisse d'ancrage
 * @param {number} [o.y] ligne de base
 * @param {number} [o.h] hauteur des capitales
 * @param {number} [o.esp] espace entre deux lettres, pour une hauteur de 100
 * @param {number} [o.mot] supplément d'espace entre deux mots, pour une hauteur de 100
 * @param {number} [o.pencher] inclinaison en degrés (le haut part à droite)
 * @param {'debut'|'milieu'|'fin'} [o.ancre]
 * @param {number[]} [o.apres] matrice appliquée après la mise en place (rotation autour d'un centre…)
 * @returns {{ lettres: { car: string, d: string }[], d: string, largeur: number, x0: number, x1: number }}
 */
export function texte(str, { x = 0, y = 0, h = 100, esp = 24, mot = 34, pencher = 0, ancre = 'debut', apres = M.id, dec = 1 } = {}) {
  const s = h / 100;
  const k = Math.tan((pencher * Math.PI) / 180);
  const poses = [];
  let plume = 0;
  for (const car of str) {
    if (car === ' ') {
      plume += mot;
      continue;
    }
    const g = ALPHABET[car];
    if (!g) throw new Error(`lettre absente de l'alphabet filaire : « ${car} »`);
    poses.push({ car, px: plume, g });
    plume += g[0] + esp;
  }
  const largeur = Math.max(0, plume - esp) * s;
  const x0 = ancre === 'milieu' ? x - largeur / 2 - (k * h) / 2 : ancre === 'fin' ? x - largeur - k * h : x;
  const lettres = poses.map(({ car, px, g }) => ({
    car,
    d: chemin(g[1], M.x(apres, M.t(x0, y), [1, 0, -k, 1, 0, 0], M.s(s), M.t(px, -100)), dec),
  }));
  return { lettres, d: lettres.map((l) => l.d).join(''), largeur, x0, x1: x0 + largeur + k * h };
}

// --- Enveloppe d'un fichier -----------------------------------------------------------------------

/**
 * @param {object} o
 * @param {number} o.largeur
 * @param {number} o.hauteur
 * @param {string} o.titre
 * @param {string[]} [o.notes] lignes du commentaire d'en-tête (sans double tiret)
 * @param {string} o.corps
 * @param {string} [o.attributs] attributs ajoutés à la racine
 */
export function svg({ largeur, hauteur, titre, notes = [], corps, attributs = '' }) {
  const entete = [
    `PimpMyBichon · garage · ${titre}`,
    ...notes,
    'Création originale pour le projet. Aucune police : tout lettrage est un tracé.',
    'Fichier produit par outils/fabriquer.mjs : pour changer le dessin, modifie le module puis relance.',
  ];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!--',
    ...entete.map((l) => `  ${l}`),
    '-->',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${largeur} ${hauteur}" width="${largeur}" height="${hauteur}"${attributs}>`,
    `<title>${titre}</title>`,
    corps.trim(),
    '</svg>',
    '',
  ].join('\n');
}
