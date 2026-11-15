// Contrat des cartes de sortie (§ 5.5 et § 8 du cahier des charges).
//
// Une carte = un dossier public/assets/maps/<id>/ :
// - map.json, le manifeste, écrit à la main et versionné ;
// - les fichiers produits par tools/maps/ à partir de données géographiques ouvertes : la route
//   (route.json), les tronçons de décor (chunks/*.glb) et le relief lointain. Ils ne sont jamais
//   versionnés : « npm run maps:build » les refait à l'identique.
// Aucun identifiant de carte n'est codé en dur : le catalogue lit les manifestes.
//
// Repère d'une carte : le mètre ; X vers l'est, Y vers le haut, Z vers le sud (repère direct de
// three.js) ; origine au départ du parcours, à son altitude. Le parcours (le « rail ») est l'axe de
// la chaussée ; on s'y repère par l'abscisse s, en mètres depuis le départ.

export type MapId = string;

/** Route ouverte (aller simple), ville (boucle dans les rues) ou circuit (boucle fermée). */
export type MapKind = 'route' | 'ville' | 'circuit';

/** Source de données à créditer, dans CREDITS.md et à l'écran de la carte. */
export type MapCredit = {
  /** Ce qui a servi, tel qu'il doit être cité : « IGN, BD TOPO ». */
  source: string;
  /** Nom de la licence : « Licence Ouverte 2.0 », « ODbL 1.0 ». */
  licence: string;
  /** Date des données, année et mois : « 2026-11 ». */
  date: string;
};

/** Manifeste d'une carte : public/assets/maps/<id>/map.json. */
export type MapManifest = {
  id: MapId;
  /** Nom affiché : « Les lacs du plateau matheysin ». */
  name: string;
  /** Sous-titre du catalogue : d'où l'on part, où l'on arrive. */
  hint?: string;
  kind: MapKind;
  /** Rang dans le catalogue. */
  order: number;
  /** Fichier de la route, produit par tools/maps/, relatif au dossier de la carte : « route.json ». */
  route: string;
  credits: MapCredit[];
};

/** Ce qui porte la chaussée sur une section du parcours. */
export type RailGround = 'sol' | 'pont' | 'tunnel';

/** Section homogène du parcours, entre deux abscisses. */
export type RailSection = {
  from: number;
  to: number;
  ground: RailGround;
  /** En agglomération : lampadaires, façades proches, vitesse de croisière plus basse. */
  urban: boolean;
  /** Nombre de voies, tous sens confondus. */
  lanes: number;
  /** Largeur de la chaussée, en mètres. */
  width: number;
};

/** Point de départ proposé au joueur. */
export type MapStart = {
  id: string;
  /** Nom affiché : « Laffrey ». */
  label: string;
  /** Abscisse du départ. */
  at: number;
};

/**
 * Rôles des matériaux d'un tronçon. Comme pour les véhicules, chaque tronçon ne porte qu'un maillage
 * par rôle, nommé `fusion_<rôle>`, avec un matériau du même nom que le rôle : l'app y pose ses
 * propres matières (chaussée mouillée, eau qui reflète, fenêtres éclairées), réglables sans refaire
 * la carte.
 */
export type MapMaterialRole =
  | 'chaussee'
  | 'marquage'
  | 'accotement'
  | 'terrain'
  | 'eau'
  | 'mur'
  | 'toit'
  | 'fenetre'
  | 'ouvrage'
  | 'glissiere'
  | 'voie';

/** Objets répétés, posés par l'app à partir d'une seule géométrie par nature. */
export type MapInstanceKind = 'arbre' | 'lampadaire' | 'balise';

/** Nombres par instance dans `MapChunk.instances` : x, y, z, échelle, cap (radians autour de Y). */
export const MAP_INSTANCE_STRIDE = 5;

/** Tronçon de décor, chargé puis libéré au fil de la route. */
export type MapChunk = {
  /** Fichier GLB, relatif au dossier de la carte : « chunks/000.glb ». */
  file: string;
  /** Abscisses du parcours couvertes par ce tronçon. */
  from: number;
  to: number;
  /** Position du tronçon dans le repère de la carte ; ses sommets et ses instances lui sont relatifs. */
  origin: [number, number, number];
  /** Boîte englobante dans le repère de la carte : minX, minY, minZ, maxX, maxY, maxZ. */
  box: [number, number, number, number, number, number];
  triangles: number;
  /** Instances par nature, `MAP_INSTANCE_STRIDE` nombres chacune, relatives à `origin`. */
  instances: Partial<Record<MapInstanceKind, number[]>>;
};

/** Nombres par point dans `MapRoute.rail` : x, y, z. */
export const MAP_RAIL_STRIDE = 3;

/** Route d'une carte : public/assets/maps/<id>/route.json, produit par tools/maps/. */
export type MapRoute = {
  format: 'pmb-carte';
  version: 1;
  id: MapId;
  /** Vrai si le parcours se referme : après le dernier point, on repart du premier. */
  loop: boolean;
  /** Longueur du parcours, en mètres : (nombre de points − 1) × step. */
  length: number;
  /** Pas du rail, en mètres : le point i est à l'abscisse i × step. */
  step: number;
  /** Axe de la chaussée, lissé et rééchantillonné à pas constant : `MAP_RAIL_STRIDE` nombres par point. */
  rail: number[];
  /** Sections du parcours, jointives, de 0 à `length`. */
  sections: RailSection[];
  /** Tronçons de décor, dans l'ordre du parcours. */
  chunks: MapChunk[];
  starts: MapStart[];
  /** Relief lointain (silhouettes sur le ciel), en un seul fichier dans le repère de la carte. */
  far: { file: string; triangles: number } | null;
};
