// Palette « Bichon » (§ 5.2) : les teintes de ses véhicules, reprises du prototype.
// Données pures : l'interface et la peinture les lisent, aucune teinte n'est codée ailleurs.

export interface PaintColor {
  id: string;
  label: string;
  /** Couleur de base, en hexadécimal sRGB. */
  hex: string;
}

export const PAINT_COLORS = [
  { id: 'teal', label: 'Vert Bichon', hex: '#0a3a46' },
  { id: 'noir', label: 'Noir', hex: '#0b0b0e' },
  { id: 'rouge', label: 'Rouge sang', hex: '#b0121c' },
  { id: 'orange', label: 'Orange piste', hex: '#ff6a00' },
  { id: 'creme', label: 'Crème 2006', hex: '#e6dcc0' },
  { id: 'gris', label: 'Gris pick-up', hex: '#7b7f88' },
  { id: 'bleu', label: 'Bleu nuit', hex: '#132a72' },
  { id: 'violet', label: 'Violet', hex: '#5b1a8e' },
  { id: 'blanc', label: 'Blanc', hex: '#f0efe9' },
] as const satisfies readonly PaintColor[];

export type PaintColorId = (typeof PAINT_COLORS)[number]['id'];

export const DEFAULT_PAINT_COLOR: PaintColorId = 'teal';

export function paintColor(id: PaintColorId): PaintColor {
  return PAINT_COLORS.find((color) => color.id === id) ?? PAINT_COLORS[0];
}
