// Alphabet filaire des néons du garage, et composition des deux enseignes.
//
// L'alphabet est celui dessiné pour le projet dans `assets-src/garage/outils/traces.mjs` : un trait
// au centre de chaque lettre, qui devient l'axe d'un tube de verre. Il est repris ici sans le
// déformer, en données typées. Aucune police, aucun texte de marque.
//
// Cadratin normalisé : la ligne de base est à y = 0, le haut des capitales à y = 1, y vers le haut ;
// chaque caractère s'étend de x = 0 à x = sa chasse. Les accents et les queues débordent un peu
// (`NEON_EM`). Coordonnées de traces.mjs (hauteur 100, y vers le bas) : x / 100 et (100 − y) / 100.
//
// Deux écarts d'écriture, sans changer le dessin : le « B » de traces.mjs repasse deux fois sur sa
// barre du milieu (H0H36) et le « 8 » enchaîne ses deux boucles par un rebroussement ; ici le B est en
// deux traits qui ne se doublent pas et le 8 en deux boucles fermées. Un tube ne passe qu'une fois.

/** Point du cadratin. */
export type NeonPoint = readonly [x: number, y: number];

/**
 * Un morceau de trait, qui part de là où le précédent s'arrête :
 * - `line` : segment jusqu'au point donné ;
 * - `arc` : arc de cercle [centre x, centre y, rayon, angle de départ, angle d'arrivée], en degrés,
 *   sens trigonométrique (y vers le haut) ; l'arrivée moins le départ donne le sens et l'ouverture ;
 * - `cubic` : courbe de Bézier [x1, y1, x2, y2, x, y].
 */
export type NeonSegment =
  | { readonly line: NeonPoint }
  | { readonly arc: readonly [cx: number, cy: number, r: number, from: number, to: number] }
  | { readonly cubic: readonly [x1: number, y1: number, x2: number, y2: number, x: number, y: number] };

/** Un trait d'un seul tenant. `closed` : le tube se referme sur son départ (segment ajouté au besoin). */
export interface NeonStroke {
  readonly from: NeonPoint;
  readonly path: readonly NeonSegment[];
  readonly closed?: boolean;
}

/** Un caractère : sa chasse (largeur du dessin, sans l'approche) et ses traits. */
export interface NeonGlyph {
  readonly width: number;
  readonly strokes: readonly NeonStroke[];
}

/** Débords admis autour du cadratin [0, chasse] × [0, 1] : accent de l'É en haut, queue du Q en bas. */
export const NEON_EM = { top: 1.35, bottom: -0.1, side: 0.05 } as const;

/** Chasse d'un caractère absent de l'alphabet : il est sauté, la place reste. */
export const NEON_UNKNOWN_WIDTH = 0.5;

const glyph = (width: number, strokes: readonly NeonStroke[]): NeonGlyph => ({ width, strokes });

/** Capitales, chiffres et les quatre signes de traces.mjs. */
export const NEON_ALPHABET: Readonly<Record<string, NeonGlyph>> = Object.freeze({
  A: glyph(0.7, [
    { from: [0, 0], path: [{ line: [0.35, 1] }, { line: [0.7, 0] }] },
    { from: [0.126, 0.36], path: [{ line: [0.574, 0.36] }] },
  ]),
  B: glyph(0.62, [
    { from: [0, 0], path: [{ line: [0, 1] }, { line: [0.34, 1] }, { arc: [0.34, 0.76, 0.24, 90, -90] }, { line: [0, 0.52] }] },
    { from: [0.34, 0.52], path: [{ line: [0.36, 0.52] }, { arc: [0.36, 0.26, 0.26, 90, -90] }, { line: [0, 0] }] },
  ]),
  C: glyph(0.582, [
    {
      from: [0.582, 0.864],
      path: [{ arc: [0.32, 0.6803, 0.32, 35.0401, 180.0487] }, { line: [0, 0.32] }, { arc: [0.32, 0.3197, 0.32, 179.9513, 324.9599] }],
    },
  ]),
  D: glyph(0.62, [
    {
      from: [0, 1],
      path: [
        { line: [0, 0] },
        { line: [0.26, 0] },
        { arc: [0.26, 0.36, 0.36, -90, 0] },
        { line: [0.62, 0.64] },
        { arc: [0.26, 0.64, 0.36, 0, 90] },
        { line: [0, 1] },
      ],
    },
  ]),
  E: glyph(0.54, [
    { from: [0.54, 1], path: [{ line: [0, 1] }, { line: [0, 0] }, { line: [0.54, 0] }] },
    { from: [0, 0.5], path: [{ line: [0.44, 0.5] }] },
  ]),
  É: glyph(0.54, [
    { from: [0.54, 1], path: [{ line: [0, 1] }, { line: [0, 0] }, { line: [0.54, 0] }] },
    { from: [0, 0.5], path: [{ line: [0.44, 0.5] }] },
    { from: [0.2, 1.16], path: [{ line: [0.36, 1.32] }] },
  ]),
  F: glyph(0.54, [
    { from: [0.54, 1], path: [{ line: [0, 1] }, { line: [0, 0] }] },
    { from: [0, 0.5], path: [{ line: [0.44, 0.5] }] },
  ]),
  G: glyph(0.64, [
    {
      from: [0.582, 0.864],
      path: [
        { arc: [0.32, 0.6803, 0.32, 35.0401, 180.0487] },
        { line: [0, 0.32] },
        { arc: [0.32, 0.32, 0.32, -180, 0] },
        { line: [0.64, 0.46] },
        { line: [0.36, 0.46] },
      ],
    },
  ]),
  H: glyph(0.62, [
    { from: [0, 1], path: [{ line: [0, 0] }] },
    { from: [0.62, 1], path: [{ line: [0.62, 0] }] },
    { from: [0, 0.5], path: [{ line: [0.62, 0.5] }] },
  ]),
  I: glyph(0, [{ from: [0, 1], path: [{ line: [0, 0] }] }]),
  J: glyph(0.44, [{ from: [0.44, 1], path: [{ line: [0.44, 0.28] }, { arc: [0.22, 0.28, 0.22, 0, -180] }] }]),
  K: glyph(0.6, [
    { from: [0, 1], path: [{ line: [0, 0] }] },
    { from: [0.58, 1], path: [{ line: [0, 0.4] }] },
    { from: [0.24, 0.648], path: [{ line: [0.6, 0] }] },
  ]),
  L: glyph(0.5, [{ from: [0, 1], path: [{ line: [0, 0] }, { line: [0.5, 0] }] }]),
  M: glyph(0.8, [{ from: [0, 0], path: [{ line: [0, 1] }, { line: [0.4, 0.38] }, { line: [0.8, 1] }, { line: [0.8, 0] }] }]),
  N: glyph(0.64, [{ from: [0, 0], path: [{ line: [0, 1] }, { line: [0.64, 0] }, { line: [0.64, 1] }] }]),
  O: glyph(0.66, [
    {
      from: [0, 0.67],
      path: [{ arc: [0.33, 0.67, 0.33, -180, -360] }, { line: [0.66, 0.33] }, { arc: [0.33, 0.33, 0.33, 0, -180] }],
      closed: true,
    },
  ]),
  P: glyph(0.6, [
    { from: [0, 0], path: [{ line: [0, 1] }, { line: [0.34, 1] }, { arc: [0.34, 0.74, 0.26, 90, -90] }, { line: [0, 0.48] }] },
  ]),
  Q: glyph(0.66, [
    {
      from: [0, 0.67],
      path: [{ arc: [0.33, 0.67, 0.33, -180, -360] }, { line: [0.66, 0.33] }, { arc: [0.33, 0.33, 0.33, 0, -180] }],
      closed: true,
    },
    { from: [0.4, 0.24], path: [{ line: [0.68, -0.04] }] },
  ]),
  R: glyph(0.62, [
    { from: [0, 0], path: [{ line: [0, 1] }, { line: [0.34, 1] }, { arc: [0.34, 0.74, 0.26, 90, -90] }, { line: [0, 0.48] }] },
    { from: [0.3, 0.48], path: [{ line: [0.62, 0] }] },
  ]),
  S: glyph(0.5, [
    { from: [0.467, 0.875], path: [{ arc: [0.2505, 0.75, 0.25, 30.0001, 269.8868] }, { arc: [0.2495, 0.25, 0.25, 89.8868, -149.9999] }] },
  ]),
  T: glyph(0.6, [
    { from: [0, 1], path: [{ line: [0.6, 1] }] },
    { from: [0.3, 1], path: [{ line: [0.3, 0] }] },
  ]),
  U: glyph(0.64, [{ from: [0, 1], path: [{ line: [0, 0.32] }, { arc: [0.32, 0.32, 0.32, -180, 0] }, { line: [0.64, 1] }] }]),
  V: glyph(0.68, [{ from: [0, 1], path: [{ line: [0.34, 0] }, { line: [0.68, 1] }] }]),
  W: glyph(0.88, [{ from: [0, 1], path: [{ line: [0.2, 0] }, { line: [0.44, 0.7] }, { line: [0.68, 0] }, { line: [0.88, 1] }] }]),
  X: glyph(0.62, [
    { from: [0, 1], path: [{ line: [0.62, 0] }] },
    { from: [0.62, 1], path: [{ line: [0, 0] }] },
  ]),
  Y: glyph(0.66, [
    { from: [0, 1], path: [{ line: [0.33, 0.48] }, { line: [0.66, 1] }] },
    { from: [0.33, 0.48], path: [{ line: [0.33, 0] }] },
  ]),
  Z: glyph(0.6, [{ from: [0, 1], path: [{ line: [0.6, 1] }, { line: [0, 0] }, { line: [0.6, 0] }] }]),
  0: glyph(0.54, [
    {
      from: [0, 0.73],
      path: [{ arc: [0.27, 0.73, 0.27, -180, -360] }, { line: [0.54, 0.27] }, { arc: [0.27, 0.27, 0.27, 0, -180] }],
      closed: true,
    },
  ]),
  1: glyph(0.26, [{ from: [0, 0.76], path: [{ line: [0.26, 1] }, { line: [0.26, 0] }] }]),
  2: glyph(0.54, [
    { from: [0.009, 0.8], path: [{ arc: [0.27, 0.7309, 0.27, 165.1661, -0.1857] }, { cubic: [0.54, 0.48, 0, 0.32, 0, 0] }, { line: [0.54, 0] }] },
  ]),
  3: glyph(0.52, [
    { from: [0.053, 0.875], path: [{ arc: [0.2695, 0.75, 0.25, 149.9999, -89.8868] }, { arc: [0.2695, 0.25, 0.25, 89.8868, -149.9999] }] },
  ]),
  4: glyph(0.54, [{ from: [0.4, 0], path: [{ line: [0.4, 1] }, { line: [0, 0.32] }, { line: [0.54, 0.32] }] }]),
  5: glyph(0.56, [{ from: [0.5, 1], path: [{ line: [0.08, 1] }, { line: [0.051, 0.547] }, { arc: [0.2507, 0.3099, 0.31, 130.1173, -140.0795] }] }]),
  6: glyph(0.54, [
    { from: [0.46, 0.98], path: [{ cubic: [0.18, 0.88, 0, 0.56, 0, 0.27] }, { arc: [0.27, 0.27, 0.27, -180, 0] }, { arc: [0.27, 0.27, 0.27, 0, 180] }] },
  ]),
  7: glyph(0.54, [{ from: [0, 1], path: [{ line: [0.54, 1] }, { line: [0.18, 0] }] }]),
  8: glyph(0.54, [
    { from: [0.27, 0.52], path: [{ arc: [0.27, 0.76, 0.24, -90, -270] }, { arc: [0.27, 0.76, 0.24, 90, -90] }], closed: true },
    { from: [0.27, 0.52], path: [{ arc: [0.27, 0.26, 0.26, 90, -90] }, { arc: [0.27, 0.26, 0.26, -90, -270] }], closed: true },
  ]),
  9: glyph(0.54, [
    { from: [0.54, 0.73], path: [{ arc: [0.27, 0.73, 0.27, 0, 180] }, { arc: [0.27, 0.73, 0.27, -180, 0] }, { cubic: [0.54, 0.44, 0.36, 0.12, 0.08, 0.02] }] },
  ]),
  "'": glyph(0.04, [{ from: [0.04, 1], path: [{ line: [0, 0.76] }] }]),
  '-': glyph(0.3, [{ from: [0, 0.48], path: [{ line: [0.3, 0.48] }] }]),
  '.': glyph(0, [{ from: [0, 0.01], path: [{ line: [0, 0] }] }]),
  '!': glyph(0, [
    { from: [0, 1], path: [{ line: [0, 0.34] }] },
    { from: [0, 0.01], path: [{ line: [0, 0] }] },
  ]),
});

/** L'éclair des enseignes (`ECLAIR` de `outils/motifs.mjs`) : hauteur 1, centré sur l'origine. */
export const NEON_BOLT: NeonStroke = {
  from: [0.01, 0.5],
  path: [
    { line: [-0.23, -0.05] },
    { line: [-0.04, -0.05] },
    { line: [-0.15, -0.5] },
    { line: [0.24, 0.12] },
    { line: [0.04, 0.12] },
    { line: [0.21, 0.5] },
  ],
  closed: true,
};

// --- Composition des enseignes --------------------------------------------------------------------

/** Une ligne d'enseigne. Les longueurs sont en fractions de hauteur de capitale. */
export interface NeonLine {
  readonly text: string;
  /** Hauteur de capitale, relative à celle de l'enseigne (1 par défaut). */
  readonly size?: number;
  /** Groupe de tubes (une couleur) ; les lignes d'un même groupe partagent un matériau. */
  readonly tube?: string;
  /** Couleur du verre, `#rrggbb`. */
  readonly color?: string;
  /** Approche (blanc entre deux lettres), en fraction de la hauteur de capitale de la ligne. */
  readonly tracking?: number;
  /** Espace de mot, en fraction de la hauteur de capitale de la ligne. */
  readonly wordSpacing?: number;
  /** Blanc entre la ligne de base de la ligne précédente et le haut de celle-ci, en fraction de la hauteur de l'enseigne. */
  readonly gapBefore?: number;
}

/**
 * Ornements des enseignes (positions relatives à une ligne, en fractions de sa hauteur de capitale) :
 * - `bolt` : l'éclair, dans la place libre à droite de la ligne `line`, centré à `lift` au-dessus de sa base ;
 * - `underline` : un trait sous la ligne `line`, à `drop` sous sa base, de la largeur de son dessin ;
 * - `waves` : des ondes de part et d'autre de la ligne `line`, arcs de rayons `radii` ouverts de ± `spread` degrés.
 */
export type NeonOrnament =
  | { readonly kind: 'bolt'; readonly line: number; readonly height: number; readonly lift: number; readonly nudge?: number; readonly tube?: string; readonly color?: string }
  | { readonly kind: 'underline'; readonly line: number; readonly drop: number; readonly tube?: string; readonly color?: string }
  | {
      readonly kind: 'waves';
      readonly line: number;
      readonly radii: readonly number[];
      readonly spread: number;
      readonly gap?: number;
      readonly tube?: string;
      readonly color?: string;
    };

export type NeonAlign = 'left' | 'center' | 'right';

/** Une enseigne composée : ses lignes et les réglages de mise en page qui la font ressembler à son SVG. */
export interface NeonSignLayout {
  readonly lines: readonly NeonLine[];
  /** Hauteur de capitale conseillée en mètres (ligne de taille 1). */
  readonly capHeight: number;
  /** Inclinaison en degrés, le haut part à droite. */
  readonly slant: number;
  readonly align: NeonAlign;
  readonly ornaments: readonly NeonOrnament[];
}

/** Couleurs de verre : la palette de l'interface. */
export const NEON_COLORS = Object.freeze({
  bleu: '#3b7bff',
  rouge: '#ff2d3f',
  ambre: '#ffb224',
  turquoise: '#22d3b6',
});

/**
 * Les deux enseignes dessinées (`assets-src/garage/neon-*.svg`, module `outils/oeuvres/neons.mjs`),
 * rangées sous le nom de l'enseigne dans `GARAGE.signs`. Proportions reprises du SVG : une unité du
 * fichier vaut un millimètre à la hauteur conseillée, le tube de 16 unités fait alors 16 mm.
 */
export const NEON_SIGNS: Readonly<Record<string, NeonSignLayout>> = Object.freeze({
  // « PIMP MY » (120) au-dessus de « BICHON » (184), alignés sur le même bord incliné de 9°,
  // l'éclair dans la place libre à droite de la première ligne, un soulignement sous la seconde.
  neon_pimpmybichon: {
    capHeight: 0.184,
    slant: 9,
    align: 'left',
    lines: [
      { text: 'PIMP MY', size: 120 / 184, tube: 'ligne-1', color: NEON_COLORS.bleu, tracking: 0.26, wordSpacing: 0.3 },
      { text: 'BICHON', tube: 'ligne-2', color: NEON_COLORS.rouge, tracking: 0.27, gapBefore: 44 / 184 },
    ],
    ornaments: [
      { kind: 'bolt', line: 0, height: 148 / 120, lift: 62 / 120, nudge: 6 / 120, tube: 'eclair', color: NEON_COLORS.ambre },
      { kind: 'underline', line: 1, drop: 56 / 184, tube: 'soulignement', color: NEON_COLORS.ambre },
    ],
  },
  // « GOOD » (140), « VIBES » (204), « ONLY » (140), droits et centrés ; deux ondes de chaque côté du mot central.
  neon_good_vibes: {
    capHeight: 0.204,
    slant: 0,
    align: 'center',
    lines: [
      { text: 'GOOD', size: 140 / 204, tube: 'ligne-1', color: NEON_COLORS.turquoise, tracking: 0.28 },
      { text: 'VIBES', tube: 'ligne-2', color: NEON_COLORS.ambre, tracking: 0.28, gapBefore: 56 / 204 },
      { text: 'ONLY', size: 140 / 204, tube: 'ligne-3', color: NEON_COLORS.turquoise, tracking: 0.28, gapBefore: 66 / 204 },
    ],
    ornaments: [{ kind: 'waves', line: 1, radii: [64 / 204, 108 / 204], spread: 36, gap: 4 / 204, tube: 'ondes', color: NEON_COLORS.ambre }],
  },
});
