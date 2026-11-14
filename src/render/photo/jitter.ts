// Décalages sous-pixel du rendu photo (suréchantillonnage par accumulation). Module pur.

/** Terme `index` de la suite de Halton de base `base`, dans [0 ; 1[. L'indice 0 vaut 0 : on commence à 1. */
export function halton(index: number, base: number): number {
  if (!Number.isInteger(index) || index < 0) throw new RangeError(`Indice de Halton invalide : ${index}`);
  if (!Number.isInteger(base) || base < 2) throw new RangeError(`Base de Halton invalide : ${base}`);
  let result = 0;
  let fraction = 1 / base;
  let rest = index;
  while (rest > 0) {
    result += (rest % base) * fraction;
    rest = Math.floor(rest / base);
    fraction /= base;
  }
  return result;
}

export interface Offset2 {
  x: number;
  y: number;
}

/** Décalage sous-pixel de l'image `frame` (0, 1, 2…), en pixels, dans [-0,5 ; 0,5] (Halton 2 et 3). */
export function pixelJitter(frame: number): Offset2 {
  return { x: halton(frame + 1, 2) - 0.5, y: halton(frame + 1, 3) - 0.5 };
}

/**
 * Décalage de la matrice de projection, en coordonnées normalisées, pour un décalage en pixels
 * sur une image de `width` × `height` : à ajouter à elements[8] et elements[9] après
 * updateProjectionMatrix (2 unités normalisées couvrent l'image). Le signe n'a pas d'importance
 * pour une moyenne : la suite reste un ensemble de positions dans le pixel.
 */
export function projectionJitter(offset: Offset2, width: number, height: number): Offset2 {
  if (!(width > 0) || !(height > 0)) throw new RangeError(`Taille d'image invalide : ${width} × ${height}`);
  return { x: (2 * offset.x) / width, y: (2 * offset.y) / height };
}

/**
 * Point du disque d'ouverture pour l'image `frame`, de rayon `radius` (profondeur de champ).
 * Halton 5 et 7, indépendants du décalage de pixel ; projection concentrique (équilibrée).
 */
export function apertureOffset(frame: number, radius: number): Offset2 {
  if (!(radius >= 0)) throw new RangeError(`Rayon d'ouverture invalide : ${radius}`);
  const u = 2 * halton(frame + 1, 5) - 1;
  const v = 2 * halton(frame + 1, 7) - 1;
  if (u === 0 && v === 0) return { x: 0, y: 0 };
  let r: number;
  let theta: number;
  if (Math.abs(u) > Math.abs(v)) {
    r = u;
    theta = (Math.PI / 4) * (v / u);
  } else {
    r = v;
    theta = Math.PI / 2 - (Math.PI / 4) * (u / v);
  }
  return { x: radius * r * Math.cos(theta), y: radius * r * Math.sin(theta) };
}
