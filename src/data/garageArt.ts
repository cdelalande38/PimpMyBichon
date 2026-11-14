// Œuvres du garage (§ 4) : les dessins originaux de assets-src/garage/, copiés par
// assets-src/garage/outils/fabriquer.mjs dans public/assets/garage/art/ (l'app ne lit jamais
// assets-src/). Ce registre dit, pour chacune, son fichier, son format, sa taille réelle, sa
// matière, la résolution de sa texture et la place prévue dans la pièce. Le chargement est fait
// par src/scene/garage/artwork.ts ; l'accrochage dans la scène (garage.ts, build.ts) vient après.
// Les deux enseignes néon n'y sont pas : elles deviennent des tubes (src/scene/garage/neon.ts).
//
// Repère et cotes : ceux de src/data/garage.ts (x vers la droite vue du canapé, z vers le canapé,
// y vers le haut, en mètres, origine au centre du sol). Les cotes de la pièce n'y sont pas
// exportées : elles sont reprises ici en clair, avec leur origine en commentaire.

import type { Facing, Vec3 } from './garage.ts';

/** Rectangle dans les unités du viewBox : x, y, largeur, hauteur. */
export type ArtRect = readonly [x: number, y: number, width: number, height: number];

/**
 * Place prévue d'une œuvre. `room` : coordonnées de la pièce. `furniture` : coordonnées locales
 * d'un meuble de GARAGE.props (avant son `turn`), désigné par son nom. Le plan regarde vers
 * `facing` ; `rot` (radians, ordre XYZ) suit l'inclinaison du meuble quand il en a une.
 */
export type ArtPlace =
  | { kind: 'room'; at: Vec3; facing: Facing; note: string }
  | { kind: 'furniture'; furniture: string; at: Vec3; facing: Facing; rot?: Vec3; note: string };

/** Une case d'une planche (plaques, casques) : chacune devient sa propre texture. */
export interface ArtRegion {
  id: string;
  rect: ArtRect;
  place: ArtPlace;
}

export interface GarageArt {
  id: GarageArtId;
  /** Chemin relatif à la base de l'app (import.meta.env.BASE_URL). */
  file: string;
  /** Largeur et hauteur du viewBox du fichier (origine 0 0). */
  viewBox: readonly [number, number];
  /** Largeur sur hauteur, lu dans le viewBox. */
  ratio: number;
  /** Taille réelle du viewBox entier, en mètres (largeur, hauteur) : même rapport que le viewBox. */
  size: readonly [number, number];
  /** Émissive (glace éclairée du flipper) ou éclairée par la pièce. */
  lighting: 'emissive' | 'lit';
  /** Intensité émissive conseillée (œuvre émissive seulement). */
  glow?: number;
  /** Fond transparent hors du dessin : alphaTest ou transparence côté matière. */
  transparent: boolean;
  /**
   * Teinte unie de la texture d'attente, posée aussi sous le dessin d'une œuvre opaque (les coins
   * arrondis ne virent pas au noir). `null` : attente transparente (l'œuvre n'apparaît qu'une fois
   * chargée).
   */
  waiting: string | null;
  /** Côté le plus long de la texture du viewBox entier, en pixels (1024 au plus). */
  resolution: number;
  /** Substituts remplacés ou habillés (noms de src/data/garage.ts, TODO_ASSETS.md). */
  replaces: readonly string[];
  /** Place de l'œuvre entière ; absente pour une planche dont chaque case a la sienne. */
  place?: ArtPlace;
  /** Cases d'une planche ; une case sans place (cible seule) reste disponible à la demande. */
  regions?: readonly ArtRegion[];
}

export type GarageArtId =
  | 'toile-pop-art'
  | 'cible'
  | 'flipper-fronton'
  | 'flipper-plateau'
  | 'plaques-deco'
  | 'affiche-atelier'
  | 'casque-motifs';

/** Résolution la plus haute admise pour une texture d'œuvre (§ 8 : 1024 px hors caisse). */
export const ART_MAX_RESOLUTION = 1024;

/** Dossier des œuvres servies, relatif à la base de l'app. */
export const ART_DIR = 'assets/garage/art/';

// Cotes de la pièce reprises de src/data/garage.ts.
/** Mur du fond (BACK = -D / 2). */
const BACK = -3;
/** Mur gauche (LEFT = -W / 2). */
const LEFT = -3.75;
/** Colonne noire de l'écran : 1,5 × 2,9 × 0,4 m centrée en x = 2,25, face avant à BACK + 0,4. */
const COLUMN = { x: 2.25, face: BACK + 0.4 } as const;
/** Cases du casier à casques (CASIER_CASES), le long de z, en coordonnées du casier. */
const CASIER_CASES = [-0.525, -0.175, 0.175, 0.525] as const;
/** Face avant du fond du casier : planche de 0,03 m centrée en x = -0,185 du casier. */
const CASIER_FOND = -0.185 + 0.015;
/** Face avant du panneau d'OSB de l'établi (planche de 0,02 m posée à z = 0,01 de l'établi). */
const OSB_FACE = 0.02;
/** Écart entre une œuvre et la surface qui la porte : assez pour éviter le moiré de profondeur. */
const GAP = 0.001;

function art(entry: Omit<GarageArt, 'file' | 'ratio'>): GarageArt {
  return { ...entry, file: `${ART_DIR}${entry.id}.svg`, ratio: entry.viewBox[0] / entry.viewBox[1] };
}

export const GARAGE_ART: readonly GarageArt[] = [
  art({
    id: 'toile-pop-art',
    viewBox: [768, 1024],
    // Portrait 3:4. Entre le haut de l'écran (1,91 m) et le dessous des solives (2,76 m : solive
    // de 0,14 m sous le plafond de 2,9 m, à x = 2,1, au-dessus de la colonne) : 0,72 m de haut,
    // de 2,0 à 2,72 m. Le panneau actuel (1,2 × 0,9 m, paysage, centré à 2,45 m) déborderait
    // sur les solives en portrait.
    size: [0.54, 0.72],
    lighting: 'lit',
    transparent: false,
    waiting: '#917971',
    resolution: 768,
    replaces: ['placeholder_toile_pop_art'],
    place: {
      kind: 'room',
      at: [COLUMN.x, 2.36, COLUMN.face + 0.005],
      facing: '+z',
      note: 'colonne noire, au-dessus de l’écran, de 2,0 à 2,72 m ; même plan que le panneau actuel',
    },
  }),
  art({
    id: 'cible',
    // Unité : le millimètre. Panneau de bois à bords étagés, cible Ø 456 au centre.
    viewBox: [1200, 1000],
    size: [1.2, 1.0],
    lighting: 'lit',
    transparent: true,
    waiting: '#ac8051',
    resolution: 1024,
    replaces: ['placeholder_cible', 'placeholder_panneau_cible'],
    place: {
      kind: 'furniture',
      // Le panneau étagé du substitut (deux planches de 0,03 m : 1,2 × 0,8 et 0,8 × 1,0 m) a
      // exactement la silhouette du dessin : il reste comme épaisseur, décollé du mur, et garde
      // son rétroéclairage bleu-violet ; l'œuvre se pose sur sa face avant. La cible ronde
      // (placeholder_cible) disparaît.
      furniture: 'placeholder_panneau_cible',
      at: [-0.015 - GAP, 0, 0],
      facing: '-x',
      note: 'mur rouge de droite, panneau 1,2 × 1,0 m de 1,3 à 2,3 m, sur la face avant du panneau étagé',
    },
    regions: [
      {
        id: 'cible-seule',
        rect: [372, 272, 456, 456],
        place: {
          kind: 'furniture',
          furniture: 'placeholder_panneau_cible',
          at: [-0.015 - GAP, 0, 0],
          facing: '-x',
          note: 'la cible seule (Ø 0,456 m), si le panneau reste en volumes',
        },
      },
    ],
  }),
  art({
    id: 'flipper-fronton',
    viewBox: [720, 620],
    size: [0.72, 0.62],
    lighting: 'emissive',
    // Intensité de la matière « fronton » actuelle.
    glow: 0.9,
    transparent: false,
    waiting: '#643f3b',
    resolution: 512,
    replaces: ['placeholder_flipper'],
    place: {
      kind: 'furniture',
      // Boîte du fronton : 0,72 × 0,62 × 0,18 m centrée en (0 ; 1,4 ; -0,58), glace vers le joueur.
      furniture: 'placeholder_flipper',
      at: [0, 1.4, -0.58 + 0.09 + GAP],
      facing: '+z',
      note: 'glace du fronton, côté joueur ; remplace la carte « popart » de la matière « fronton »',
    },
  }),
  art({
    id: 'flipper-plateau',
    viewBox: [700, 1250],
    size: [0.7, 1.25],
    lighting: 'lit',
    transparent: false,
    waiting: '#4c3e49',
    resolution: 512,
    replaces: ['placeholder_flipper'],
    place: {
      kind: 'furniture',
      // Caisse : 0,7 × 0,3 × 1,25 m centrée en (0 ; 0,9 ; 0,05), inclinée de -0,06 rad autour de x.
      // Centre de sa face du haut : (0 ; 0,9 + 0,15 cos 0,06 ; 0,05 - 0,15 sin 0,06), plus l'écart.
      furniture: 'placeholder_flipper',
      at: [0, 1.051, 0.04],
      facing: '+y',
      rot: [-0.06, 0, 0],
      note: 'dessus de la caisse, haut du dessin vers le fronton (-z), joueur vers +z',
    },
  }),
  art({
    id: 'plaques-deco',
    // Trois tôles de 600 × 300 (2:1) ; une tôle fait 0,4 × 0,2 m.
    viewBox: [640, 1000],
    size: [(0.4 * 640) / 600, (0.4 * 1000) / 600],
    lighting: 'lit',
    transparent: true,
    waiting: null,
    resolution: 512,
    replaces: [],
    regions: [
      {
        id: 'plaque-1',
        rect: [20, 5, 600, 300],
        place: {
          kind: 'furniture',
          // Panneau d'OSB de l'établi : x de 0 à 1,45 m, y de 0,975 à 2,225 m ; panneau d'outils
          // de 0,25 à 0,85 m en x, de 1,325 à 1,775 m en y.
          furniture: 'placeholder_etabli',
          at: [0.55, 2.0, OSB_FACE + GAP],
          facing: '+z',
          note: 'ATELIER BICHON, au-dessus du panneau d’outils',
        },
      },
      {
        id: 'plaque-2',
        rect: [20, 335, 600, 300],
        place: {
          kind: 'furniture',
          furniture: 'placeholder_etabli',
          at: [1.12, 2.02, OSB_FACE + GAP],
          facing: '+z',
          note: 'TOUJOURS PLEIN GAZ, en haut à droite du panneau d’OSB, au-dessus de l’outil rouge',
        },
      },
      {
        id: 'plaque-3',
        rect: [20, 665, 600, 300],
        place: {
          kind: 'furniture',
          furniture: 'placeholder_etabli',
          at: [1.15, 1.17, OSB_FACE + GAP],
          facing: '+z',
          note: 'TURBO, en bas à droite du panneau d’OSB, sous l’outil rouge ; à vérifier en capture',
        },
      },
    ],
  }),
  art({
    id: 'affiche-atelier',
    viewBox: [640, 960],
    size: [0.6, 0.9],
    lighting: 'lit',
    transparent: false,
    waiting: '#623636',
    resolution: 512,
    replaces: [],
    place: {
      kind: 'room',
      // Mur gauche, près de l'angle de l'établi, au-dessus de son retour (plateau à 0,9 m) :
      // z de -2,7 à -2,1, y de 1,1 à 2,0. L'enseigne PimpMyBichon (centrée en z = -1,55, à 2,05 m)
      // commence vers z = -2,05 si elle fait 1 m de large : à reprendre si elle grandit.
      at: [LEFT + 0.004, 1.55, -2.4],
      facing: '+x',
      note: 'mur gauche, près du panneau d’outils, au-dessus du retour de l’établi',
    },
  }),
  art({
    id: 'casque-motifs',
    // Planche 2 × 2 de cases 480 × 420 ; une case fait 0,32 × 0,28 m (le casier a des cases de
    // 0,35 × 0,4 m).
    viewBox: [960, 840],
    size: [0.64, 0.56],
    lighting: 'lit',
    transparent: true,
    waiting: null,
    resolution: 512,
    replaces: ['placeholder_casiers_casques'],
    // Une carte par case, contre le fond du casier, sous son point LED. Couleurs des sphères
    // actuelles : noir, rouge, blanc, noir.
    regions: [
      { id: 'casque-flammes', rect: [0, 0, 480, 420], place: casque(0, 'noir mat, flammes') },
      { id: 'casque-crane', rect: [0, 420, 480, 420], place: casque(1, 'rouge, tête de mort') },
      { id: 'casque-bandes', rect: [480, 0, 480, 420], place: casque(2, 'blanc, bandes bleue et rouge') },
      { id: 'casque-damier', rect: [480, 420, 480, 420], place: casque(3, 'sarcelle pailleté, damier') },
    ],
  }),
];

function casque(index: 0 | 1 | 2 | 3, motif: string): ArtPlace {
  return {
    kind: 'furniture',
    furniture: 'placeholder_casiers_casques',
    at: [CASIER_FOND + GAP, 0.2, CASIER_CASES[index]],
    facing: '+x',
    note: `case ${index + 1} du casier : ${motif} ; carte plane ou référence de livrée d’un casque modélisé`,
  };
}

/** Œuvre par identifiant. */
export function garageArt(id: GarageArtId): GarageArt {
  const found = GARAGE_ART.find((item) => item.id === id);
  if (!found) throw new Error(`œuvre inconnue : ${id}`);
  return found;
}

/** Rectangle d'une case, ou du viewBox entier sans case. */
export function artRect(item: GarageArt, region?: string): ArtRect {
  if (region === undefined) return [0, 0, item.viewBox[0], item.viewBox[1]];
  const found = item.regions?.find((entry) => entry.id === region);
  if (!found) throw new Error(`case inconnue « ${region} » dans l’œuvre ${item.id}`);
  return found.rect;
}

/** Taille réelle d'une case (ou de l'œuvre entière), en mètres. */
export function artSize(item: GarageArt, region?: string): readonly [number, number] {
  const [, , width, height] = artRect(item, region);
  return [(width / item.viewBox[0]) * item.size[0], (height / item.viewBox[1]) * item.size[1]];
}

/**
 * Taille en pixels de la texture d'une case (ou de l'œuvre entière) : même densité que le viewBox
 * entier rendu à `resolution` sur son côté le plus long.
 */
export function artPixels(item: GarageArt, region?: string, resolution = item.resolution): readonly [number, number] {
  const [, , width, height] = artRect(item, region);
  const scale = Math.min(resolution, ART_MAX_RESOLUTION) / Math.max(item.viewBox[0], item.viewBox[1]);
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}
