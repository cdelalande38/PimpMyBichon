// @ts-check
// Textures des matières du sol et du bâti de la sortie (chaussée, trottoirs, terrain, façades),
// fabriquées par le code : procédurales, déterministes (même graine, mêmes octets) et raccordables
// sans couture (chaque bruit est périodique sur la tuile). Aucune image téléchargée, aucun texte.
//
// Une texture RGBA par matière, lue par les nuanceurs de la sortie (src/drive/scene/sol.ts) en
// coordonnées du monde ou de la route, à deux échelles mêlées contre la répétition :
//   R, G  relief : normale de la tuile (x, y) codée autour de 0,5 ;
//   B     détail de l'albédo : multiplicateur 0,4 + 1,2 × B (moyenne ramenée à 0,5, soit × 1) ;
//   A     rugosité : multiplicateur 0,6 + 0,8 × A (moyenne 0,5 : × 1) ; pour le terrain, détail de
//         l'albédo de la terre et de la roche (même codage que B).
// Écrites en WebP sans perte (le projet n'a pas d'encodeur KTX2 sur le poste : voir TODO_ASSETS.md) ;
// les niveaux de détail sont faits par le processeur graphique au chargement (mipmaps), le nuanceur
// efface le relief quand il devient plus fin qu'un pixel.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

/** Dossier des matières sous public/assets/maps/ (lu par src/drive/scene/sol.ts : SOL_DIR). */
export const DOSSIER_MATIERES = '_matieres';

/** Taille des textures (pixels de côté). */
export const TAILLE = 256;

/**
 * Matières produites : fichier, tuile (mètres couverts par la texture), ce qu'elle porte.
 * `repere` : « monde » (plan horizontal x, z), « route » (abscisse, écart à l'axe), « facade »
 * (long du mur, hauteur).
 */
export const MATIERES = [
  { id: 'enrobe', fichier: 'enrobe.webp', tuile: 1.5, repere: 'monde', graine: 11, quoi: 'enrobé : granulats, liant, fissures fines' },
  { id: 'dalles', fichier: 'dalles.webp', tuile: 1, repere: 'route', graine: 23, quoi: 'trottoir : dalles de béton de 50 cm, joints, taches' },
  { id: 'terrain', fichier: 'terrain.webp', tuile: 4, repere: 'monde', graine: 37, quoi: 'terrain : relief de terre et de roche, herbe (B), terre et roche (A)' },
  { id: 'enduit', fichier: 'enduit.webp', tuile: 2, repere: 'facade', graine: 51, quoi: 'façades : enduit gratté, reprises, salissures' },
];

// ---------------------------------------------------------------------------------------------
// Bruits périodiques (période en cases, entière) : la tuile se raccorde à elle-même.

/**
 * Hachage entier (lowbias32) → [0, 1).
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
function hash3(x, y, z) {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** @type {(a: ArrayLike<number>, k: number) => number} */
const at = (a, k) => a[k] ?? 0;
/** @type {(i: number, p: number) => number} */
const wrap = (i, p) => ((i % p) + p) % p;
/** @type {(t: number) => number} */
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
/** @type {(a: number, b: number, t: number) => number} */
const lerp = (a, b, t) => a + (b - a) * t;
/** @type {(v: number) => number} */
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** @type {(a: number, b: number, v: number) => number} */
const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * Bruit de gradient périodique, u et v en cases, périodes p (en u) et q (en v). Valeur dans [-1, 1] environ.
 * @param {number} u
 * @param {number} v
 * @param {number} p
 * @param {number} seed
 * @param {number} [q]
 */
function perlin(u, v, p, seed, q = p) {
  const i0 = Math.floor(u);
  const j0 = Math.floor(v);
  const fu = u - i0;
  const fv = v - j0;
  /** @type {(i: number, j: number, du: number, dv: number) => number} */
  const g = (i, j, du, dv) => {
    const a = hash3(wrap(i, p), wrap(j, q), seed) * Math.PI * 2;
    return Math.cos(a) * du + Math.sin(a) * dv;
  };
  const n00 = g(i0, j0, fu, fv);
  const n10 = g(i0 + 1, j0, fu - 1, fv);
  const n01 = g(i0, j0 + 1, fu, fv - 1);
  const n11 = g(i0 + 1, j0 + 1, fu - 1, fv - 1);
  const a = fade(fu);
  return lerp(lerp(n00, n10, a), lerp(n01, n11, a), fade(fv)) * 1.41;
}

/**
 * Somme d'octaves périodiques ; x, y dans [0, 1) sur la tuile ; f0 : cases de la première octave
 * (entier : la tuile se raccorde), g0 : en y si elle diffère (bruit étiré : strates, coulures).
 * @param {number} x
 * @param {number} y
 * @param {number} f0
 * @param {number} octaves
 * @param {number} seed
 * @param {number} [gain]
 * @param {number} [g0]
 */
function fbm(x, y, f0, octaves, seed, gain = 0.5, g0 = f0) {
  let s = 0;
  let amp = 1;
  let norm = 0;
  let f = f0;
  let g = g0;
  for (let o = 0; o < octaves; o += 1) {
    s += amp * perlin(x * f, y * g, f, seed + o * 101, g);
    norm += amp;
    amp *= gain;
    f *= 2;
    g *= 2;
  }
  return s / norm;
}

/**
 * Cellules de Voronoï périodiques (n × n cases sur la tuile) : distance au plus proche germe (f1),
 * au second (f2), et identifiant de la cellule la plus proche.
 * @param {number} x
 * @param {number} y
 * @param {number} n
 * @param {number} seed
 * @param {number} [jitter]
 */
function worley(x, y, n, seed, jitter = 0.9) {
  const u = x * n;
  const v = y * n;
  const i0 = Math.floor(u);
  const j0 = Math.floor(v);
  let f1 = 9;
  let f2 = 9;
  let id = 0;
  for (let dj = -1; dj <= 1; dj += 1) {
    for (let di = -1; di <= 1; di += 1) {
      const ci = wrap(i0 + di, n);
      const cj = wrap(j0 + dj, n);
      const px = i0 + di + 0.5 + (hash3(ci, cj, seed) - 0.5) * jitter;
      const py = j0 + dj + 0.5 + (hash3(ci, cj, seed + 1) - 0.5) * jitter;
      const d = Math.hypot(px - u, py - v);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = hash3(ci, cj, seed + 2);
      } else if (d < f2) f2 = d;
    }
  }
  return { f1, f2, id };
}

// ---------------------------------------------------------------------------------------------
// Matières : chacune rend, pour un point (x, y) de la tuile, hauteur (relief), albédo, rugosité
// (et, pour le terrain, un second albédo). Les normales viennent de la hauteur (différences
// centrées, périodiques).

/** @typedef {{ h: number, alb: number, rough: number, alb2?: number }} Echantillon */

/** @type {Record<string, (x: number, y: number, seed: number) => Echantillon>} */
const RECETTES = {
  enrobe(x, y, seed) {
    // Granulats : cailloux de 2 à 3 cm (un peu plus gros que nature, pour se lire en roulant).
    const w = worley(x, y, 55, seed);
    const stone = smooth(0.62, 0.18, w.f1);
    const fine = fbm(x, y, 32, 3, seed + 5);
    // Liant : plus sombre, presque lisse ; cailloux plus clairs, teinte propre à chacun.
    let alb = lerp(0.3 + 0.08 * fine, 0.48 + 0.4 * w.id, stone);
    let h = stone * (0.6 + 0.4 * w.id) + 0.15 * fine;
    let rough = lerp(0.42, 0.62 + 0.25 * w.id, stone);
    // Fissures fines : bords de grandes cellules déformées, gardées par endroits seulement.
    const wx = x + 0.03 * fbm(x, y, 4, 2, seed + 9);
    const wy = y + 0.03 * fbm(x, y, 4, 2, seed + 13);
    const c = worley(wx, wy, 3, seed + 17, 1);
    const keep = smooth(0.1, 0.35, fbm(x, y, 2, 2, seed + 21));
    const crack = smooth(0.02, 0.0, c.f2 - c.f1) * keep;
    alb = lerp(alb, 0.06, crack * 0.9);
    h -= crack * 0.8;
    rough = lerp(rough, 0.95, crack);
    return { h, alb, rough };
  },
  dalles(x, y, seed) {
    // Dalles de 50 cm (4 × 4 sur 2 m), joints de 8 mm, teinte et usure propres à chaque dalle.
    const n = 2;
    const u = x * n;
    const v = y * n;
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fu = u - i;
    const fv = v - j;
    const k = hash3(wrap(i, n), wrap(j, n), seed);
    const k2 = hash3(wrap(i, n), wrap(j, n), seed + 3);
    const joint = 0.008 / 0.5;
    const e = Math.min(fu, 1 - fu, fv, 1 - fv);
    const inJoint = smooth(joint, joint * 0.4, e);
    const bevel = smooth(joint * 3.5, joint, e);
    const grain = fbm(x, y, 48, 3, seed + 7);
    const stain = smooth(0.15, 0.55, fbm(x, y, 3, 4, seed + 11));
    // Légère pente de chaque dalle (tassement) : relief à grande échelle par dalle.
    const tilt = (k - 0.5) * 0.25 * (fu - 0.5) + (k2 - 0.5) * 0.25 * (fv - 0.5);
    let h = 0.6 + tilt + 0.1 * grain - 0.25 * bevel - 0.6 * inJoint;
    let alb = (0.5 + 0.18 * (k - 0.5) + 0.06 * grain) * (1 - 0.25 * stain);
    alb = lerp(alb, 0.22, inJoint);
    let rough = lerp(0.55 + 0.1 * grain, 0.75, inJoint);
    // Dalle fêlée de loin en loin.
    if (k2 > 0.82) {
      const d = Math.abs((fu - 0.5) * Math.cos(k * 6) + (fv - 0.5) * Math.sin(k * 6) + 0.04 * fbm(x, y, 12, 2, seed + 19));
      const crack = smooth(0.012, 0.0, d);
      alb = lerp(alb, 0.15, crack);
      h -= 0.3 * crack;
    }
    return { h, alb, rough };
  },
  terrain(x, y, seed) {
    // Relief : mottes de terre et roche feuilletée ; herbe en brins (B), terre et roche (A).
    const clod = fbm(x, y, 8, 4, seed);
    // Strates : bruit étiré en x (le long de la pente quand la roche est projetée sur un talus).
    const strata = Math.abs(fbm(x + 0.08 * fbm(x, y, 2, 2, seed + 3), y, 1, 3, seed + 5, 0.5, 6));
    const rock = 1 - strata;
    const h = 0.5 * clod + 0.6 * rock * rock;
    const blades = fbm(x, y, 64, 2, seed + 7);
    const tufts = fbm(x, y, 12, 3, seed + 9);
    const alb = 0.5 + 0.28 * blades + 0.2 * tufts;
    const alb2 = 0.5 + 0.22 * clod + 0.18 * (rock - 0.5) + 0.12 * fbm(x, y, 32, 2, seed + 11);
    return { h, alb, rough: 0.5, alb2 };
  },
  enduit(x, y, seed) {
    // Enduit gratté (grain fin), reprises de la truelle par plaques, salissures en coulures.
    const grain = fbm(x, y, 80, 2, seed);
    const trowel = fbm(x, y, 5, 3, seed + 3);
    const patch = smooth(0.05, 0.25, fbm(x, y, 2, 3, seed + 5));
    // Coulures : bruit serré en travers, lent dans la hauteur.
    const drip = fbm(x, y, 12, 3, seed + 7, 0.5, 1);
    const h = 0.6 * grain + 0.25 * trowel;
    const alb = 0.5 + 0.08 * grain + 0.09 * trowel - 0.08 * patch - 0.12 * smooth(0.1, 0.6, drip);
    const rough = 0.55 + 0.15 * grain + 0.05 * patch;
    return { h, alb, rough };
  },
};

/**
 * Échantillon brut d'une matière au point (x, y) de la tuile (hors de [0, 1) : la tuile répétée).
 * @param {string} id
 * @param {number} x
 * @param {number} y
 */
export function echantillon(id, x, y) {
  const def = MATIERES.find((m) => m.id === id);
  const recette = RECETTES[id];
  if (!def || !recette) throw new Error(`matière inconnue : ${id}`);
  return recette(x, y, def.graine);
}

/**
 * Fabrique la texture d'une matière : RGBA, `taille` × `taille`, ligne par ligne.
 * @param {string} id
 * @param {number} [taille]
 */
export function genererMatiere(id, taille = TAILLE) {
  const def = MATIERES.find((m) => m.id === id);
  const recette = RECETTES[id];
  if (!def || !recette) throw new Error(`matière inconnue : ${id}`);
  const n = taille;
  const H = new Float32Array(n * n);
  const A = new Float32Array(n * n);
  const R = new Float32Array(n * n);
  const A2 = new Float32Array(n * n);
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const e = recette(i / n, j / n, def.graine);
      const k = j * n + i;
      H[k] = e.h;
      A[k] = e.alb;
      R[k] = e.rough;
      A2[k] = e.alb2 ?? 0.5;
    }
  }
  // Moyennes ramenées à 0,5 : la texture module la teinte et la rugosité de la matière sans les déplacer.
  /** @param {Float32Array} a */
  const recentre = (a) => {
    let m = 0;
    for (const v of a) m += v;
    m /= a.length;
    for (let k = 0; k < a.length; k += 1) a[k] = clamp01(0.5 + (at(a, k) - m));
  };
  recentre(A);
  recentre(A2);
  recentre(R);
  // Normales : pente de la hauteur sur une tuile d'un mètre de relief arbitraire (force réglée par
  // le nuanceur), différences centrées périodiques.
  const out = new Uint8Array(n * n * 4);
  const force = n / 24;
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const k = j * n + i;
      const dx = (at(H, j * n + wrap(i + 1, n)) - at(H, j * n + wrap(i - 1, n))) * force;
      const dy = (at(H, wrap(j + 1, n) * n + i) - at(H, wrap(j - 1, n) * n + i)) * force;
      const len = Math.hypot(dx, dy, 1);
      out[k * 4] = Math.round((0.5 - (0.5 * dx) / len) * 255);
      out[k * 4 + 1] = Math.round((0.5 - (0.5 * dy) / len) * 255);
      out[k * 4 + 2] = Math.round(at(A, k) * 255);
      // Canal A jamais nul (pas de pixel transparent qu'un décodeur pourrait simplifier).
      out[k * 4 + 3] = Math.max(8, Math.round(at(id === 'terrain' ? A2 : R, k) * 255));
    }
  }
  return out;
}

/**
 * Écart moyen entre pixels voisins de part et d'autre du bord (la tuile répétée) rapporté à celui
 * de l'intérieur : proche de 1 pour une texture qui se raccorde sans couture.
 * @param {Uint8Array} rgba
 * @param {number} n
 */
export function rapportDeBord(rgba, n) {
  let bord = 0;
  let dedans = 0;
  for (let c = 0; c < 4; c += 1) {
    for (let t = 0; t < n; t += 1) {
      bord += Math.abs(at(rgba, (t * n + (n - 1)) * 4 + c) - at(rgba, t * n * 4 + c));
      bord += Math.abs(at(rgba, ((n - 1) * n + t) * 4 + c) - at(rgba, t * 4 + c));
      const m = n >> 1;
      dedans += Math.abs(at(rgba, (t * n + m) * 4 + c) - at(rgba, (t * n + m - 1) * 4 + c));
      dedans += Math.abs(at(rgba, (m * n + t) * 4 + c) - at(rgba, ((m - 1) * n + t) * 4 + c));
    }
  }
  return bord / Math.max(1, dedans);
}

/**
 * Fabrique toutes les matières dans `dossier` (public/assets/maps/_matieres/) : les WebP et
 * matieres.json, que l'app lit à la construction. Rend le poids écrit et la mémoire des textures.
 * @param {string} dossier
 * @param {number} [taille]
 */
export async function ecrireMatieres(dossier, taille = TAILLE) {
  mkdirSync(dossier, { recursive: true });
  let poids = 0;
  const liste = [];
  for (const m of MATIERES) {
    const rgba = genererMatiere(m.id, taille);
    const bytes = await sharp(Buffer.from(rgba), { raw: { width: taille, height: taille, channels: 4 } })
      .webp({ lossless: true, effort: 6, exact: true })
      .toBuffer();
    writeFileSync(join(dossier, m.fichier), bytes);
    poids += bytes.byteLength;
    liste.push({ id: m.id, fichier: m.fichier, taille, tuile: m.tuile, repere: m.repere });
  }
  const manifeste = { format: 'pmb-matieres', version: 1, matieres: liste };
  const texte = `${JSON.stringify(manifeste, null, 2)}\n`;
  writeFileSync(join(dossier, 'matieres.json'), texte);
  // RGBA 8 bits et mipmaps (× 4/3) une fois chargées par le processeur graphique.
  const memoire = Math.round(MATIERES.length * taille * taille * 4 * (4 / 3));
  return { poids: poids + texte.length, memoire, fichiers: liste.length };
}
