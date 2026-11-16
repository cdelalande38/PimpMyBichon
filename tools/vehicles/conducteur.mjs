// @ts-check
// Le conducteur à bord (placeholder_conducteur), pièce partagée entre véhicules : un corps articulé
// simple, modelé par le code d'après la fiche de texte captures/notes-agents/reference-personnage.md
// (une allure : carrure solide, épaules larges, bras épais entièrement tatoués, barbe pleine, casquette
// à l'envers en voiture, casque intégral blanc à visière fumée à moto ; aucun visage ressemblant, aucun
// nom, aucun logo, aucun texte). Le catalogue est une donnée : public/assets/shared/conducteur/
// catalogue.json (os, nœuds et chaînes d'os, passes de rendu, couleurs, tenues, points de contact).
//
// Repère : au repos debout, bras le long du corps, origine au milieu des hanches (os `bassin`),
// avant +X, haut +Y, droite +Z, en mètres. Chaque nœud du fichier est une pièce du corps posée dans
// ce repère ; l'app la lie à la chaîne d'os du catalogue (src/scene/vehicle/conducteur.ts).
// Tatouages : des faces d'une matière d'encre dessinées en géométrie (une fonction du point sur le
// bras choisit la matière de chaque triangle) ; aucune image. Budget (§ 8, catalogue.budget) :
// 12 000 triangles et 4 passes de rendu au plus par tenue.

import { readFileSync } from 'node:fs';
import * as k from './kit.mjs';

/** @typedef {import('./kit.mjs').Parts} Parts */
/** @typedef {[number, number]} P2 */
/** @typedef {[number, number, number]} P3 */
/** @typedef {{ id: string, parent: string | null, at: P3 }} Bone */
/** @typedef {{ id: string, kind: 'car' | 'bike', label: string, head: 'casquette' | 'casque', hands: 'nues' | 'gants', feet: 'chaussures' | 'bottes' }} Outfit */
/** @typedef {{ id: string, materials: string[], roughness: number, metalness: number, envMapIntensity?: number, clearcoat?: number }} Pass */
/** @typedef {{ bones: Bone[], nodes: Record<string, string[]>, blend: number, passes: Pass[], colors: Record<string, string>, outfits: Outfit[], budget: { triangles: number, drawCalls: number } }} Catalogue */

export const CATALOGUE_URL = new URL('../../public/assets/shared/conducteur/catalogue.json', import.meta.url);

/** @returns {Catalogue} */
export function readCatalogue() {
  return JSON.parse(readFileSync(CATALOGUE_URL, 'utf8'));
}

/** Fichier d'une tenue, sous public/assets/shared/conducteur/ (même nom que src/data/conducteur.ts). */
export const driverFile = (/** @type {string} */ id) => `conducteur_${id}.glb`;

/** Position au repos (repère du bassin) de chaque os. @param {Catalogue} c @returns {Map<string, P3>} */
export function restJoints(c) {
  /** @type {Map<string, P3>} */
  const out = new Map();
  for (const bone of c.bones) {
    const parent = /** @type {P3 | undefined} */ (bone.parent ? out.get(bone.parent) : [0, 0, 0]);
    if (!parent) throw new Error(`os « ${bone.id} » : parent « ${bone.parent} » déclaré après lui`);
    out.set(bone.id, [parent[0] + bone.at[0], parent[1] + bone.at[1], parent[2] + bone.at[2]]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Outils de forme

/**
 * Section en superellipse : demi-largeur `rz` (côté), demi-profondeur `rx` (avant-arrière), décalée
 * de `cx` vers l'avant, exposant `p` (2 : ellipse ; plus : plus carrée). Points [z, avant].
 * @param {number} rz @param {number} rx @param {number} cx @param {number} p @param {number} n @returns {P2[]}
 */
function section(rz, rx, cx, p, n) {
  /** @type {P2[]} */
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    const a = (2 * Math.PI * i) / n;
    const c = Math.cos(a);
    const s = Math.sin(a);
    pts.push([Math.max(1e-4, rz) * Math.sign(c) * Math.abs(c) ** (2 / p), cx + Math.max(1e-4, rx) * Math.sign(s) * Math.abs(s) ** (2 / p)]);
  }
  return pts;
}

/** Interpolation linéaire par morceaux dans une table [t, …valeurs] triée. @param {number[][]} table @param {number} t */
function lerpTable(table, t) {
  const first = k.at(table, 0);
  const last = k.at(table, table.length - 1);
  if (t <= k.at(first, 0)) return first.slice(1);
  if (t >= k.at(last, 0)) return last.slice(1);
  for (let i = 0; i < table.length - 1; i += 1) {
    const a = k.at(table, i);
    const b = k.at(table, i + 1);
    if (t >= k.at(a, 0) && t <= k.at(b, 0)) {
      const f = (t - k.at(a, 0)) / (k.at(b, 0) - k.at(a, 0) || 1);
      const s = f * f * (3 - 2 * f);
      return a.slice(1).map((v, j) => v + (k.at(b, j + 1) - v) * s);
    }
  }
  return last.slice(1);
}

/**
 * Pièce tendue le long de l'axe vertical : sections en superellipse données par une table
 * [distance depuis le haut (ou le bas), rz, rx, cx, p], bouts arrondis. `dir` −1 : du haut vers le
 * bas (membres), +1 : du bas vers le haut (torse, tête). `origin` : point de départ. `material` :
 * un nom, ou une fonction (hauteur, avant, côté, u, v) → nom, appelée par triangle.
 * @param {{ table: number[][], length: number, dir: 1 | -1, origin: P3, steps: number, around: number, material: string | ((h: number, front: number, side: number, u: number, v: number) => string), round?: [number, number] }} o
 * @returns {Parts}
 */
function vloft(o) {
  const [r0, r1] = o.round ?? [0.03, 0.03];
  /** @type {number[]} */
  const xs = [];
  for (let i = 0; i <= o.steps; i += 1) {
    const t = i / o.steps;
    // Pas resserrés aux bouts (arrondis).
    xs.push(o.length * (t < 0.12 ? (t / 0.12) ** 1.6 * 0.12 : t > 0.88 ? 1 - ((1 - t) / 0.12) ** 1.6 * 0.12 : t));
  }
  const sign = o.dir === -1 ? 1 : -1;
  const parts = k.loft({
    sectionAt: (x) => {
      const [rz = 0.05, rx = 0.05, cx = 0, p = 2] = lerpTable(o.table, x);
      // Bouts arrondis : la section se resserre en quart d'ellipse sur r0 (début) et r1 (fin).
      let f = 1;
      if (x < r0) f = Math.sqrt(Math.max(0.02, 1 - ((r0 - x) / r0) ** 2));
      if (x > o.length - r1) f = Math.min(f, Math.sqrt(Math.max(0.02, 1 - ((x - (o.length - r1)) / r1) ** 2)));
      return section(rz * f, rx * f, cx * sign, p, o.around).map(([z, y]) => /** @type {P2} */ ([z, y * sign]));
    },
    xs,
    material:
      typeof o.material === 'string'
        ? o.material
        : (f) => {
            const fn = /** @type {(h: number, front: number, side: number, u: number, v: number) => string} */ (o.material);
            return fn(o.origin[1] + o.dir * f.x, f.y * sign, f.z, f.u, f.v);
          },
    crease: 80,
  });
  return k.place(parts, { position: o.origin, rotation: [0, 0, o.dir === -1 ? -Math.PI / 2 : Math.PI / 2] });
}

// ---------------------------------------------------------------------------------------------
// Pièces

const SKIN = 'paint_peau';
const INK = 'paint_encre';

/**
 * Motif tribal des bras, en géométrie : vrai si le triangle (u le long du bras, de l'épaule au
 * poignet ; v autour) est d'encre. Entrelacs et pointes à grands aplats, manchette au poignet.
 * @param {number} u @param {number} v @param {number} side −1 gauche, 1 droite
 */
export function tattooInk(u, v, side) {
  if (u < 0.035) return false;
  if (u > 0.9 && u < 0.945) return true;
  if (u >= 0.965) return false;
  const w = side > 0 ? 1 - v : v;
  // Bandes ondulées autour du bras, hérissées de pointes qui montent vers l'épaule.
  const wave = 0.05 * Math.sin(2 * Math.PI * (2 * w + 1.3 * u)) + 0.025 * Math.sin(2 * Math.PI * 5 * w);
  const t = (u * 5.2 + wave * 5.2) % 1;
  const spike = 0.32 * Math.max(0, Math.sin(2 * Math.PI * 4 * w + u * 9)) ** 3;
  return t < 0.5 + spike || (t > 0.78 && t < 0.86);
}

/** Torse et bassin : jean, ceinture, débardeur noir à larges emmanchures, encolure. @param {Catalogue} c */
function torso(c) {
  const J = restJoints(c);
  const shoulderY = /** @type {P3} */ (J.get('epaule_g'))[1];
  /** @type {Parts} */
  const parts = vloft({
    origin: [0, -0.125, 0],
    dir: 1,
    length: 0.66,
    steps: 24,
    around: 22,
    round: [0.07, 0.06],
    table: [
      [0.0, 0.12, 0.09, -0.01, 2.2],
      [0.05, 0.17, 0.12, -0.015, 2.4],
      [0.125, 0.182, 0.122, -0.005, 2.6],
      [0.245, 0.168, 0.116, 0.012, 2.6],
      [0.355, 0.182, 0.124, 0.018, 2.6],
      [0.455, 0.212, 0.134, 0.022, 2.8],
      [0.535, 0.222, 0.126, 0.012, 2.8],
      [0.585, 0.19, 0.105, 0.0, 2.6],
      [0.625, 0.11, 0.075, -0.005, 2.2],
      [0.66, 0.07, 0.06, -0.008, 2],
    ],
    material: (h, front, side) => {
      const az = Math.abs(side);
      if (h < 0.098) return 'paint_jean';
      if (h < 0.135) return 'paint_ceinture';
      // Emmanchures larges, encolure ronde, bretelles.
      if (h > shoulderY - 0.1 && az > 0.135) return SKIN;
      if (h > 0.435 && front > 0.04 && az < 0.11) return SKIN;
      if (h > 0.5 && (az < 0.07 || az > 0.125)) return SKIN;
      return 'paint_debardeur';
    },
  });
  // Boucle de ceinture.
  parts.push(...k.place(k.roundedExtrude(k.roundedRect(0.05, 0.034, 0.006, 3), { material: 'chrome', depth: 0.008, bevel: 0.002, bevelSegments: 1, axis: 'x' }), { position: [0.127, 0.116, 0] }));
  // Chaîne à gros maillons sur la poitrine, et son pendentif en tête de mort.
  /** @type {P3[]} */
  const chain = [
    [-0.07, 0.518, 0],
    [-0.035, 0.518, 0.07],
    [0.05, 0.48, 0.082],
    [0.125, 0.425, 0.05],
    [0.148, 0.388, 0],
    [0.125, 0.425, -0.05],
    [0.05, 0.48, -0.082],
    [-0.035, 0.518, -0.07],
  ];
  parts.push(...k.tube(chain, { material: 'chrome', radius: 0.0055, closed: true, segments: 24, radial: 5 }));
  parts.push(...k.ellipsoid([0.152, 0.368, 0], [0.011, 0.017, 0.014], { material: 'chrome', segments: 10 }));
  parts.push(...k.ellipsoid([0.149, 0.354, 0], [0.008, 0.008, 0.009], { material: 'chrome', segments: 8 }));
  return parts;
}

/** Cou fort. @param {Catalogue} c */
function neck(c) {
  const J = restJoints(c);
  const base = /** @type {P3} */ (J.get('cou'));
  return vloft({
    origin: [base[0] + 0.005, base[1] - 0.06, 0],
    dir: 1,
    length: 0.2,
    steps: 10,
    around: 16,
    round: [0.01, 0.02],
    table: [
      [0, 0.072, 0.066, 0, 2],
      [0.1, 0.064, 0.062, 0.005, 2],
      [0.2, 0.06, 0.058, 0.01, 2],
    ],
    // Le haut du cou, sous le menton, pris dans la barbe pleine.
    material: (h, front) => (h > base[1] + 0.06 && front > -0.01 ? 'paint_barbe' : SKIN),
  });
}

/**
 * Tête : crâne, mâchoire et barbe pleine taillée, moustache, nez, oreilles, yeux sombres ; puis
 * casquette à l'envers, ou casque intégral blanc à visière fumée.
 * @param {Catalogue} c @param {Outfit} outfit
 */
function head(c, outfit) {
  const J = restJoints(c);
  const hy = /** @type {P3} */ (J.get('tete'))[1];
  /** @type {Parts} */
  const parts = [];
  const helmet = outfit.head === 'casque';
  parts.push(
    ...vloft({
      origin: [0, hy - 0.04, 0],
      dir: 1,
      length: 0.27,
      steps: helmet ? 12 : 16,
      around: helmet ? 14 : 18,
      round: [0.03, 0.05],
      table: [
        [0.0, 0.035, 0.035, 0.07, 2],
        [0.03, 0.07, 0.072, 0.05, 2.2],
        [0.07, 0.088, 0.097, 0.03, 2.3],
        [0.11, 0.09, 0.101, 0.022, 2.2],
        [0.15, 0.087, 0.103, 0.016, 2.1],
        [0.19, 0.088, 0.104, 0.008, 2.1],
        [0.23, 0.078, 0.09, 0.0, 2],
        [0.27, 0.04, 0.05, -0.005, 2],
      ],
      material: (h, front, side) => {
        const rel = h - hy;
        // Barbe : la mâchoire et le menton, devant et sur les côtés ; moustache au-dessus de la bouche.
        if (rel < 0.072 && front > -0.055) return 'paint_barbe';
        if (rel < 0.088 && front > 0.075 && Math.abs(side) < 0.045) return 'paint_barbe';
        return SKIN;
      },
    }),
  );
  // Sous le casque, le visage ne se voit pas : ni nez, ni oreilles, ni yeux.
  if (!helmet) parts.push(...k.ellipsoid([0.118, hy + 0.098, 0], [0.02, 0.03, 0.016], { material: SKIN, segments: 10 }));
  for (const s of helmet ? [] : [-1, 1]) {
    parts.push(...k.ellipsoid([0.012, hy + 0.105, s * 0.088], [0.02, 0.03, 0.011], { material: SKIN, segments: 10 }));
    parts.push(...k.ellipsoid([0.1, hy + 0.123, s * 0.034], [0.009, 0.0075, 0.013], { material: 'paint_yeux', segments: 6 }));
  }
  if (!helmet) {
    // Casquette noire à l'envers : calotte, visière sur la nuque, bouton au sommet.
    parts.push(
      ...vloft({
        origin: [0, hy + 0.14, 0],
        dir: 1,
        length: 0.105,
        steps: 7,
        around: 18,
        round: [0.001, 0.05],
        table: [
          [0, 0.094, 0.11, 0.012, 2.1],
          [0.04, 0.091, 0.106, 0.008, 2.1],
          [0.07, 0.08, 0.094, 0.002, 2],
          [0.105, 0.05, 0.06, 0, 2],
        ],
        material: 'paint_casquette',
      }),
    );
    /** @type {P2[]} */
    const bill = [];
    for (let i = 0; i <= 12; i += 1) {
      const a = Math.PI / 2 + (Math.PI * i) / 12;
      bill.push([0.075 * Math.cos(a) * 1.1 - 0.0, 0.075 * Math.sin(a) * 0.95]);
    }
    const visor = k.roundedExtrude(bill, { material: 'paint_casquette', depth: 0.008, bevel: 0.003, bevelSegments: 1, axis: 'y' });
    parts.push(...k.place(visor, { position: [-0.075, hy + 0.15, 0], rotation: [0, 0, -0.18] }));
    parts.push(...k.ellipsoid([0.0, hy + 0.244, 0], [0.012, 0.007, 0.012], { material: 'paint_casquette', segments: 8 }));
  } else {
    // Casque intégral blanc brillant, grande visière fumée (une région de la coque).
    parts.push(
      ...vloft({
        origin: [0, hy - 0.075, 0],
        dir: 1,
        length: 0.32,
        steps: 22,
        around: 28,
        round: [0.004, 0.07],
        table: [
          [0.0, 0.085, 0.1, 0.012, 2.2],
          [0.03, 0.1, 0.122, 0.02, 2.3],
          [0.08, 0.118, 0.14, 0.024, 2.3],
          [0.14, 0.123, 0.144, 0.02, 2.2],
          [0.2, 0.122, 0.142, 0.012, 2.1],
          [0.255, 0.108, 0.128, 0.004, 2],
          [0.32, 0.045, 0.055, -0.004, 2],
        ],
        material: (h, front, side) => {
          const rel = h - hy;
          const ang = Math.atan2(Math.abs(side), front);
          if (rel > 0.055 && rel < 0.165 && ang < 1.3 && front > 0) return 'paint_visiere';
          return 'paint_casque';
        },
      }),
    );
  }
  return parts;
}

/**
 * Bras de l'épaule au poignet, entièrement tatoué ; bracelet à maillons au poignet gauche.
 * @param {Catalogue} c @param {-1 | 1} side
 */
function arm(c, side) {
  const J = restJoints(c);
  const s = /** @type {P3} */ (J.get(side < 0 ? 'epaule_g' : 'epaule_d'));
  const wrist = /** @type {P3} */ (J.get(side < 0 ? 'main_g' : 'main_d'));
  const length = s[1] - wrist[1] + 0.06 + 0.012;
  /** @type {Parts} */
  const parts = vloft({
    origin: [s[0], s[1] + 0.06, s[2]],
    dir: -1,
    length,
    steps: 40,
    around: 18,
    round: [0.07, 0.012],
    table: [
      [0.0, 0.074, 0.074, -0.004, 2.1],
      [0.07, 0.075, 0.072, 0.0, 2.1],
      [0.16, 0.063, 0.068, 0.006, 2],
      [0.27, 0.053, 0.06, 0.004, 2],
      [0.36, 0.047, 0.05, -0.004, 2],
      [0.44, 0.054, 0.048, 0.002, 2.1],
      [0.56, 0.042, 0.035, 0.0, 2.2],
      [0.64, 0.036, 0.026, 0.0, 2.2],
    ],
    material: (_h, _front, _side, u, v) => (tattooInk(u, v, side) ? INK : SKIN),
  });
  if (side < 0) {
    /** @type {P3[]} */
    const ring = [];
    for (let i = 0; i < 12; i += 1) {
      const a = (2 * Math.PI * i) / 12;
      ring.push([wrist[0] + 0.033 * Math.cos(a), wrist[1] + 0.03, wrist[2] + 0.041 * Math.sin(a)]);
    }
    parts.push(...k.tube(ring, { material: 'chrome', radius: 0.0055, closed: true, segments: 24, radial: 6 }));
  }
  return parts;
}

/**
 * Main fermée sur une prise (jante, poignée) : paume, doigts recourbés autour de l'axe de prise
 * (axe X, à `contacts.grip` du poignet), pouce opposé. Repère du poignet ; paume vers le corps au
 * repos (+Z pour la gauche). Nue (tatouée sur le dos) ou gantée.
 * @param {-1 | 1} side @param {Outfit} outfit
 */
function hand(side, outfit) {
  const gloved = outfit.hands === 'gants';
  const skin = gloved ? 'paint_gant' : SKIN;
  const pz = -side; // paume vers l'intérieur
  /** @type {Parts} */
  const parts = [];
  // Paume et dos de la main.
  const palm = k.roundedExtrude(k.roundedRect(0.084, 0.1, 0.02, 3), { material: skin, depth: 0.036, bevel: 0.012, bevelSegments: 1 });
  parts.push(...k.place(palm, { position: [0, -0.052, 0] }));
  if (!gloved) {
    // Encre sur le dos de la main : un aplat pointu.
    const mark = k.roundedExtrude([[-0.03, 0.02], [0.0, -0.03], [0.03, 0.02], [0.0, 0.0]], { material: INK, depth: 0.003, bevel: 0.0008, bevelSegments: 1 });
    parts.push(...k.place(mark, { position: [0, -0.045, -pz * 0.0172] }));
  }
  // Doigts : un C épais autour de l'axe de prise (X), de la jointure jusque devant la prise.
  const C = /** @type {P2} */ ([pz * 0.03, -0.085]); // (z, y)
  /** @type {P2[]} */
  const outline = [];
  const ri = 0.019;
  const ro = 0.041;
  const a0 = Math.atan2(-0.1 - C[1], -pz * 0.004 - C[0]);
  const sweep = -pz * 3.3;
  for (let i = 0; i <= 10; i += 1) {
    const a = a0 + (sweep * i) / 10;
    outline.push([C[0] + ro * Math.cos(a), C[1] + ro * Math.sin(a)]);
  }
  for (let i = 10; i >= 0; i -= 1) {
    const a = a0 + (sweep * i) / 10;
    outline.push([C[0] + ri * Math.cos(a), C[1] + ri * Math.sin(a)]);
  }
  parts.push(...k.roundedExtrude(outline, { material: skin, depth: 0.08, bevel: 0.009, bevelSegments: 1, axis: 'x' }));
  // Pouce, opposé aux doigts, du côté de l'avant de la main.
  parts.push(...k.tube([[0.038, -0.03, pz * 0.012], [0.046, -0.06, pz * 0.04], [0.036, -0.085, pz * 0.058]], { material: skin, radius: 0.0125, segments: 10, radial: 8 }));
  // Grosse bague au majeur.
  if (!gloved) parts.push(...k.place(k.lathe([[0.0125, -0.005], [0.0145, -0.002], [0.0145, 0.002], [0.0125, 0.005]], { material: 'chrome', segments: 14, axis: 'x' }), { position: [0.012, -0.1, pz * 0.006] }));
  return parts;
}

/**
 * Jambe de la hanche à la cheville : jean délavé, usé aux genoux.
 * @param {Catalogue} c @param {-1 | 1} side
 */
function leg(c, side) {
  const J = restJoints(c);
  const hip = /** @type {P3} */ (J.get(side < 0 ? 'hanche_g' : 'hanche_d'));
  const knee = /** @type {P3} */ (J.get(side < 0 ? 'genou_g' : 'genou_d'));
  const ankle = /** @type {P3} */ (J.get(side < 0 ? 'pied_g' : 'pied_d'));
  const top = 0.06;
  const kneeAt = hip[1] - knee[1] + top;
  const length = hip[1] - ankle[1] + top + 0.02;
  return vloft({
    origin: [hip[0], hip[1] + top, hip[2] + side * 0.004],
    dir: -1,
    length,
    steps: 26,
    around: 16,
    round: [0.07, 0.01],
    table: [
      [0.0, 0.1, 0.105, -0.01, 2.1],
      [0.12, 0.093, 0.094, 0.0, 2],
      [0.3, 0.08, 0.082, 0.004, 2],
      [kneeAt, 0.068, 0.07, 0.008, 2],
      [kneeAt + 0.14, 0.068, 0.068, 0.0, 2],
      [length - 0.06, 0.066, 0.066, -0.004, 2],
      [length, 0.064, 0.064, -0.004, 2],
    ],
    material: (h, front) => (Math.abs(h - knee[1]) < 0.055 && front > 0.03 ? 'paint_jean_use' : 'paint_jean'),
  });
}

/** Chaussure sombre ou botte de moto, semelle noire. Repère de la cheville. @param {Outfit} outfit */
function foot(outfit) {
  const boot = outfit.feet === 'bottes';
  /** @type {Parts} */
  const parts = [];
  const sole = -0.085;
  // Empeigne : un loft le long de X, du talon à la pointe.
  const upper = k.loft({
    sectionAt: (x) => {
      const t = (x + 0.065) / 0.275;
      const top = t < 0.35 ? (boot ? 0.03 : 0.0) : 0.0 - (t - 0.35) * 0.09;
      const yt = Math.max(sole + 0.035, top - 0.01);
      const w = 0.045 + 0.012 * Math.sin(Math.PI * Math.min(1, t * 1.25));
      const f = Math.sqrt(Math.max(0.03, 1 - Math.max(0, (Math.abs(t - 0.5) - 0.42) / 0.08) ** 2));
      return k.mirrorSection(k.roundedHalf({ bottom: sole + 0.012, top: yt, halfWidthBottom: w * f, halfWidthTop: w * f * 0.85, rBottom: 0.012, rTop: 0.025, n: 3 }));
    },
    xs: k.sampleX(-0.065, 0.21, { step: 0.046, endZone: 0.03 }),
    material: 'paint_chaussure',
    crease: 70,
  });
  parts.push(...upper);
  parts.push(...k.place(k.roundedExtrude(k.roundedRect(0.28, 0.11, 0.045, 4), { material: 'paint_semelle', depth: 0.014, bevel: 0.004, bevelSegments: 1, axis: 'y' }), { position: [0.075, sole + 0.006, 0] }));
  if (boot) parts.push(...k.rod([0, -0.06, 0], [0, 0.12, 0], 0.056, { material: 'paint_chaussure', radial: 14, top: 0.06 }));
  return parts;
}

/**
 * Le conducteur d'une tenue, un nœud par pièce (noms du catalogue, `nodes`).
 * @param {Outfit} outfit @param {Catalogue} [catalogue]
 */
export function buildDriver(outfit, catalogue = readCatalogue()) {
  const c = catalogue;
  const J = restJoints(c);
  const m = new k.Model(`conducteur_${outfit.id}`);
  for (const [name, color] of Object.entries(c.colors)) {
    const pass = c.passes.find((p) => p.materials.includes(name));
    m.material(name, { color, roughness: pass?.roughness ?? 0.7, metallic: pass?.metalness ?? 0 });
  }
  m.add('torse', torso(c));
  m.add('cou', neck(c));
  m.add('tete', head(c, outfit));
  for (const side of /** @type {const} */ ([-1, 1])) {
    const s = side < 0 ? 'g' : 'd';
    m.add(`bras_${s}`, arm(c, side));
    const wrist = /** @type {P3} */ (J.get(`main_${s}`));
    m.add(`main_${s}`, k.place(hand(side, outfit), { position: wrist }));
    m.add(`jambe_${s}`, leg(c, side));
    const ankle = /** @type {P3} */ (J.get(`pied_${s}`));
    m.add(`pied_${s}`, k.place(foot(outfit), { position: ankle }));
  }
  return m;
}

/**
 * Chiffres d'une tenue fabriquée : triangles, passes de rendu occupées (= appels de dessin).
 * @param {{ materials: string[] }} built @param {number} triangles @param {Catalogue} [catalogue]
 */
export function driverBudget(built, triangles, catalogue = readCatalogue()) {
  const passes = new Set();
  for (const name of built.materials) {
    const pass = catalogue.passes.find((p) => p.materials.includes(name));
    if (!pass) throw new Error(`matière « ${name} » dans aucune passe du catalogue du conducteur`);
    passes.add(pass.id);
  }
  return { triangles, drawCalls: passes.size, passes: [...passes] };
}
