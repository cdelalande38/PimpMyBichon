// Vignettage de l'image enregistrée, appliqué une fois sur l'image entière : rendue en tuiles,
// chaque tuile aurait sinon le sien. Même courbe que VignetteEffect de postprocessing (technique
// par défaut), corrigée pour des valeurs déjà encodées en sRGB.

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Facteur (0 à 1) appliqué à la lumière linéaire au point (u, v) de l'image (0 à 1). */
export function vignetteFactor(u: number, v: number, offset: number, darkness: number): number {
  const d = Math.hypot(u - 0.5, v - 0.5);
  return smoothstep(0.8, offset * 0.799, d * (darkness + offset));
}

/** Assombrit les bords d'une image 2D déjà rendue (valeurs sRGB). */
export function applyVignette(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  offset: number,
  darkness: number,
): void {
  const image = context.getImageData(0, 0, width, height);
  const { data } = image;
  for (let y = 0; y < height; y += 1) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x += 1) {
      const factor = vignetteFactor((x + 0.5) / width, v, offset, darkness);
      if (factor >= 0.999) continue;
      const scale = Math.pow(factor, 1 / 2.2);
      const i = (y * width + x) * 4;
      data[i] = (data[i] ?? 0) * scale;
      data[i + 1] = (data[i + 1] ?? 0) * scale;
      data[i + 2] = (data[i + 2] ?? 0) * scale;
    }
  }
  context.putImageData(image, 0, 0);
}
