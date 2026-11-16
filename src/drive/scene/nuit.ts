// Réglages de la nuit : étalonnage de la chaîne d'image (src/render/PostChain.tsx), lumières du
// ciel, part du reflet sur la carrosserie. Données, sans code de rendu.

import { AMBIANCES, type Ambiance } from '../../data/ambiances.ts';

/**
 * Ambiance de la chaîne d'image pour la sortie : seuls l'étalonnage, l'exposition et le bloom y
 * servent (le reste décrit le garage). Nuit bleue, hautes lumières chaudes (sodium, phares).
 */
export const NIGHT_AMBIANCE: Ambiance = {
  ...(AMBIANCES[0] as Ambiance),
  exposure: 1.25,
  bloom: 0.95,
  grade: { shadows: '#2c3c9a', highlights: '#ffd2a0', amount: 0.1, saturation: 1.1, contrast: 1.1 },
};

export const NIGHT_LIGHTS = {
  /** Ciel et sol de la lumière d'ambiance : juste de quoi détacher les formes, le noir reste noir. */
  sky: '#22305a',
  ground: '#050507',
  ambient: 0.5,
  /** Lune basse, bleutée. */
  moon: '#9fb2e0',
  moonIntensity: 0.5,
  moonDirection: [0.5, 0.7, -0.35] as const,
  /** Reflet de l'environnement sur la carrosserie (la sonde voit une nuit sombre). */
  bodyEnv: 5,
} as const;
