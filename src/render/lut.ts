// Table de correspondance des couleurs (§ 8, étalonnage), fabriquée en code pour chaque
// ambiance : aucune image importée. Le calcul est pur (testable) ; la texture se fait à part.
// Domaine et valeurs en sRGB affichable, de 0 à 1 (l'effet LUT convertit lui-même).

import { Color } from 'three';

export interface Grade {
  /** Dominante des ombres et des hautes lumières. */
  shadows: string;
  highlights: string;
  /** Force de la dominante (0 : neutre). */
  amount: number;
  /** 1 : inchangée. */
  saturation: number;
  /** 1 : inchangé ; au-delà, courbe en S autour du gris moyen. */
  contrast: number;
}

const LUMA = [0.2126, 0.7152, 0.0722] as const;

function luma(r: number, g: number, b: number): number {
  return r * LUMA[0] + g * LUMA[1] + b * LUMA[2];
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Couleur sRGB 0..1 d'un hexadécimal, sans conversion d'espace. */
function srgb(hex: string): [number, number, number] {
  const color = new Color();
  color.setStyle(hex, 'srgb-linear');
  return [color.r, color.g, color.b];
}

/** Applique l'étalonnage à une couleur sRGB (0..1). */
export function gradeColor(grade: Grade, r: number, g: number, b: number): [number, number, number] {
  const shadows = srgb(grade.shadows);
  const highlights = srgb(grade.highlights);
  const y = luma(r, g, b);
  // Dominante : ombres vers une teinte, hautes lumières vers l'autre, à luminosité constante.
  const t = smoothstep(0.04, 0.6, y);
  const tint = shadows.map((value, i) => value + ((highlights[i] ?? value) - value) * t) as [number, number, number];
  const tintLuma = Math.max(1e-3, luma(...tint));
  let out = [r, g, b].map((value, i) => {
    const toned = (value * (tint[i] ?? 1)) / tintLuma + (shadows[i] ?? 0) * 0.025 * (1 - smoothstep(0, 0.2, y));
    return value + (toned - value) * grade.amount;
  });
  // Saturation autour de la luminance.
  const y2 = luma(out[0] ?? 0, out[1] ?? 0, out[2] ?? 0);
  out = out.map((value) => y2 + (value - y2) * grade.saturation);
  // Contraste : courbe en S douce, neutre à 1.
  out = out.map((value) => {
    const v = clamp01(value);
    const s = v * v * (3 - 2 * v);
    return v + (s - v) * (grade.contrast - 1) * 2;
  });
  return [clamp01(out[0] ?? 0), clamp01(out[1] ?? 0), clamp01(out[2] ?? 0)];
}

/**
 * Données d'une table size³ au format de postprocessing (LookupTexture) : RGBA flottants,
 * rouge le plus rapide, puis vert, puis bleu.
 */
export function gradeLutData(grade: Grade, size = 16): Float32Array {
  const data = new Float32Array(size ** 3 * 4);
  const step = 1 / (size - 1);
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        const i = (r + g * size + b * size * size) * 4;
        const [R, G, B] = gradeColor(grade, r * step, g * step, b * step);
        data[i] = R;
        data[i + 1] = G;
        data[i + 2] = B;
        data[i + 3] = 1;
      }
    }
  }
  return data;
}
