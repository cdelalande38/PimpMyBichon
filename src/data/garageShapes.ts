// Vocabulaire de formes du décor du garage (§ 4, § 8) : ce que les données décrivent, sans
// géométrie. Le constructeur est src/scene/garage/shapes.ts ; ses repères (centre, axe, sens
// des contours, plan du contour selon l'axe), ses budgets de triangles et un exemple par forme
// sont écrits en tête de ce fichier-là.
// Unités : mètres et radians. Toutes les formes sont centrées sur l'origine de la pièce qui les
// porte, sauf le profil tourné (lathe) et le tube, dont les points sont donnés tels quels.
// `detail` (1 par défaut) multiplie le nombre de côtés et de pas d'arrondi : 0,5 pour un objet
// lointain, 2 pour un objet vu de près. Il ne change jamais les cotes.
// Les trois formes d'origine ({ box }, { cylinder, axis }, { sphere }) gardent leur sens exact :
// sans paramètre nouveau, elles se construisent comme avant.

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];
export type Axis = 'x' | 'y' | 'z';

export type GarageShape =
  /** Pavé (largeur x, hauteur y, profondeur z), centré ; bevel : rayon des arêtes arrondies, en mètres. */
  | { box: Vec3; bevel?: number; detail?: number }
  /** Cylindre (rayon, hauteur), centré, axe y par défaut ; top : rayon du haut s'il diffère (tronc de cône) ; bevel : rayon des bords. */
  | { cylinder: readonly [number, number]; axis?: Axis; top?: number; bevel?: number; detail?: number }
  /** Sphère (rayon) ; scale : ellipsoïde. */
  | { sphere: number; scale?: Vec3; detail?: number }
  /** Capsule (rayon, longueur totale), axe y par défaut. */
  | { capsule: readonly [number, number]; axis?: Axis; detail?: number }
  /** Tore (rayon du cercle, rayon du tube), axe y par défaut ; arc en radians pour un tore ouvert. */
  | { torus: readonly [number, number]; axis?: Axis; arc?: number; detail?: number }
  /** Coussin : pavé à arêtes rondes dont les grandes faces bombent de puff mètres. */
  | { cushion: Vec3; bevel?: number; puff?: number; detail?: number }
  /** Profil (rayon, hauteur) tourné autour de l'axe (y par défaut) ; arc en radians pour un secteur. */
  | { lathe: readonly Vec2[]; axis?: Axis; arc?: number; detail?: number }
  /** Contour fermé en 2D, extrudé de depth le long de l'axe (z par défaut), centré sur cette épaisseur ; bevel arrondit les deux bords ; holes le perce. */
  | { extrude: readonly Vec2[]; depth: number; axis?: Axis; bevel?: number; holes?: ReadonlyArray<readonly Vec2[]>; detail?: number }
  /** Tube de rayon constant le long d'une ligne brisée ; smooth arrondit les coudes ; closed la referme. */
  | { tube: readonly Vec3[]; radius: number; smooth?: boolean; closed?: boolean; detail?: number };
