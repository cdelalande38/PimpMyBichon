// Œuvres du garage (§ 4) : les dessins originaux de assets-src/garage/, copiés par
// assets-src/garage/outils/fabriquer.mjs dans public/assets/garage/art/ (l'app ne lit jamais
// assets-src/). Ce registre dit, pour chacune, son fichier, son format, sa taille réelle, sa
// matière et la résolution de sa texture. Le chargement est fait par src/scene/garage/artwork.ts ;
// la place d'une œuvre est donnée par l'objet qui la porte (champ `art` d'un objet du mobilier,
// ArtSlot de src/data/garageBase.ts), et build.ts l'y pose. Les notes ci-dessous ne font que la
// rappeler.
// Les deux enseignes néon n'y sont pas : elles deviennent des tubes (src/scene/garage/neon.ts).

/** Rectangle dans les unités du viewBox : x, y, largeur, hauteur. */
export type ArtRect = readonly [x: number, y: number, width: number, height: number];

/** Une case d'une planche (plaques, casques) : chacune devient sa propre texture. */
export interface ArtRegion {
  id: string;
  rect: ArtRect;
  /** Où la case est posée (rappel ; la place fait foi dans le fichier de l'objet). */
  note?: string;
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
  /**
   * Œuvre posée entière : où (rappel ; la place fait foi dans le fichier de l'objet). Absente pour
   * une planche dont seules les cases sont posées.
   */
  place?: string;
  /** Cases d'une planche, chacune sa texture. */
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

function art(entry: Omit<GarageArt, 'file' | 'ratio'>): GarageArt {
  return { ...entry, file: `${ART_DIR}${entry.id}.svg`, ratio: entry.viewBox[0] / entry.viewBox[1] };
}

export const GARAGE_ART: readonly GarageArt[] = [
  art({
    id: 'toile-pop-art',
    viewBox: [768, 1024],
    // Portrait 3:4, taille de référence ; le châssis la pose à sa propre largeur (ArtSlot).
    size: [0.54, 0.72],
    lighting: 'lit',
    transparent: false,
    waiting: '#917971',
    resolution: 768,
    replaces: ['placeholder_toile_pop_art'],
    place: 'châssis placeholder_toile_pop_art, sur la colonne noire au-dessus de l’écran',
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
    // Le panneau étagé du substitut (1,2 × 0,8 et 0,8 × 1,0 m) a la silhouette du dessin : l'œuvre
    // entière se pose sur sa face avant (local x -0,016, face -x), ou la cible seule.
    place: 'face avant de placeholder_panneau_cible, mur rouge de droite',
    regions: [
      {
        id: 'cible-seule',
        rect: [372, 272, 456, 456],
        note: 'la cible seule (Ø 0,456 m) sur placeholder_panneau_cible, si le panneau reste en volumes',
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
    place: 'glace du fronton de placeholder_flipper, côté joueur (+z local) ; la glace en matière « fronton » (verre sombre) dessous',
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
    place: 'dessus de la caisse de placeholder_flipper, haut du dessin vers le fronton (-z local), joueur vers +z',
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
        note: 'ATELIER BICHON, panneau d’OSB de placeholder_etabli, au-dessus du panneau d’outils',
      },
      {
        id: 'plaque-2',
        rect: [20, 335, 600, 300],
        note: 'TOUJOURS PLEIN GAZ, en haut à droite du panneau d’OSB de placeholder_etabli',
      },
      {
        id: 'plaque-3',
        rect: [20, 665, 600, 300],
        note: 'TURBO, en bas à droite du panneau d’OSB de placeholder_etabli',
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
    // L'enseigne PimpMyBichon (0,88 m de large, centrée en z = -1,55, à 2,05 m) commence vers
    // z = -2,0 : l'affiche reste en deçà.
    place: 'placeholder_affiche, mur gauche, au-dessus du retour de l’établi',
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
    // Une case par casque ; motifs non appliqués en V1 (casques de couleur unie, cahier § 7).
    regions: [
      { id: 'casque-flammes', rect: [0, 0, 480, 420], note: 'case 1 : noir mat, flammes' },
      { id: 'casque-crane', rect: [0, 420, 480, 420], note: 'case 2 : rouge, tête de mort' },
      { id: 'casque-bandes', rect: [480, 0, 480, 420], note: 'case 3 : blanc, bandes bleue et rouge' },
      { id: 'casque-damier', rect: [480, 420, 480, 420], note: 'case 4 : sarcelle pailleté, damier' },
    ],
  }),
];


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
