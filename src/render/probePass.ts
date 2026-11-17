// Passe d'une sonde de réflexion rendue au fil des images (src/drive/scene/sonde.ts) : chaque face
// effacée avant d'être redessinée, décor vu sans environnement. La chaîne d'image coupe l'effacement
// automatique du moteur de rendu (postprocessing pose autoClear = false) : sans lui, la bande de la
// sonde, les lumières lointaines et la lueur des villages, additives, s'ajoutaient à la face d'avant à
// chaque passage, et la sonde s'éclaircissait sans fin (contour d'une caisse noire de 113 à 209 sur
// 255 en 1 200 images, temps figé : le liseré blanc bleuté de la sortie de nuit). Réglages seulement :
// aucun programme recompilé, aucune allocation.

/** Ce que la passe touche du moteur de rendu et de la scène. */
export interface ProbePassTarget {
  gl: { autoClear: boolean };
  scene: { environmentIntensity: number };
}

/** Rend `draw` (une face ou toutes) faces effacées et environnement coupé, puis rend les réglages d'avant. */
export function cleanProbePass(gl: ProbePassTarget['gl'], scene: ProbePassTarget['scene'], draw: () => void): void {
  const autoClear = gl.autoClear;
  const environment = scene.environmentIntensity;
  gl.autoClear = true;
  scene.environmentIntensity = 0;
  try {
    draw();
  } finally {
    gl.autoClear = autoClear;
    scene.environmentIntensity = environment;
  }
}
