// Peinture de carrosserie. Interface volontairement simple : un matériau, une teinte, une finition.
// Au jalon 1, une première version en réglages de MeshPhysicalMaterial ; la peinture
// multicouche (paillettes en normal map, peau d'orange, Fresnel) remplacera l'intérieur de ce
// module sans changer ses signatures.

import { Color, MeshPhysicalMaterial, type Material } from 'three';
import type { Finish } from '../data/finishes.ts';

/** Couleur d'un métal nu, vers laquelle tire une finition peu teintée (chrome). */
const BARE_METAL = new Color('#e4e6ea');

/**
 * Crée le matériau d'une zone peinte à partir de celui du modèle : on garde son nom et sa
 * carte de normales (joints, détails), on oublie sa couleur et ses textures de teinte.
 */
export function createPaintMaterial(source?: Material): MeshPhysicalMaterial {
  const material = new MeshPhysicalMaterial();
  if (source) {
    material.name = source.name;
    const normalMap = (source as Partial<MeshPhysicalMaterial>).normalMap ?? null;
    if (normalMap) {
      material.normalMap = normalMap;
      material.normalScale.copy((source as MeshPhysicalMaterial).normalScale);
    }
  }
  return material;
}

/** Couleur de base effective : la teinte choisie, mêlée au métal nu selon la finition. */
export function paintBaseColor(hex: string, finish: Pick<Finish, 'tint'>): Color {
  return BARE_METAL.clone().lerp(new Color(hex), Math.min(1, Math.max(0, finish.tint)));
}

/** Applique une teinte et une finition à un matériau de carrosserie. */
export function applyPaint(material: MeshPhysicalMaterial, hex: string, finish: Finish): void {
  material.color.copy(paintBaseColor(hex, finish));
  material.metalness = finish.metalness;
  material.roughness = finish.roughness;
  material.clearcoat = finish.clearcoat;
  material.clearcoatRoughness = finish.clearcoatRoughness;
  material.iridescence = finish.iridescence;
  material.iridescenceIOR = finish.iridescenceIOR;
  material.envMapIntensity = finish.envMapIntensity;
  // Passer d'une finition sans vernis ni irisation à l'inverse change le programme du shader.
  material.needsUpdate = true;
}
