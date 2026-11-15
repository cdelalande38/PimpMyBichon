// Registre des planches du studio des formes (page de développement, hors de l'app livrée).
// Une planche = un nom → une liste de pièces. Pour en ajouter une, dépose un fichier dans
// src/dev/studio/planches/ qui exporte `planches` (nom → pièces) : le studio les ramasse tous,
// aucun fichier commun à modifier. Le vrai mobilier du garage a ses planches toutes faites
// (planches/mobilier.ts, tirées de src/data/garageProps/).

import { Box3, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { GarageMaterialId } from '../../data/garageBase.ts';
import type { GarageArtId } from '../../data/garageArt.ts';
import type { GarageShape, Vec3 } from '../../data/garageShapes.ts';
import { shapeGeometry } from '../../scene/garage/shapes.ts';

export interface PieceStudio {
  forme: GarageShape;
  /** Centre de la forme, en mètres ; le sol est à y = 0. */
  position?: Vec3;
  /** Rotation (x, y, z) en radians, ordre XYZ. */
  rotation?: Vec3;
  /** Couleur de base (#rrggbb). */
  couleur: string;
  /** Rugosité, 0,5 par défaut. */
  rugosite?: number;
  /** Métal, 0 par défaut. */
  metal?: number;
  /** Nom écrit sous la pièce, avec son nombre de triangles. */
  etiquette?: string;
  /** Matériau du garage (GARAGE_MATERIALS) : remplace couleur, rugosité et métal, carte comprise. */
  materiau?: GarageMaterialId;
  /**
   * Objet du garage dont la pièce fait partie : une étiquette par objet, « nom · triangles »
   * (somme de ses pièces, œuvres exclues).
   */
  objet?: string;
  /**
   * Œuvre de src/data/garageArt.ts : la pièce est un plan qui regarde vers +z (avant rotation),
   * large de `largeur`, haut de `hauteur` ; `forme` (un pavé mince aux mêmes cotes) ne sert qu'à
   * la mise en place.
   */
  oeuvre?: { art: GarageArtId; region?: string; largeur: number; hauteur: number };
}

export type Planche = readonly PieceStudio[];

/** Module d'un fichier de src/dev/studio/planches/. */
export interface ModulePlanches {
  planches: Record<string, Planche>;
}

/**
 * Pose un objet composé (pièces placées autour de son origine) en `origine`, tourné de `lacet`
 * radians autour de la verticale.
 */
export function objet(origine: Vec3, pieces: Planche, lacet = 0): PieceStudio[] {
  const tour = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), lacet);
  return pieces.map((piece) => {
    const position = new Vector3(...(piece.position ?? [0, 0, 0])).applyQuaternion(tour).add(new Vector3(...origine));
    const rotation = new Euler().setFromQuaternion(tour.clone().multiply(new Quaternion().setFromEuler(new Euler(...(piece.rotation ?? [0, 0, 0])))));
    return { ...piece, position: [position.x, position.y, position.z], rotation: [rotation.x, rotation.y, rotation.z] };
  });
}

/**
 * Range des pièces isolées en grille sur le sol, de gauche à droite, rangée du fond d'abord, chacune
 * posée sur le sol (le bas de sa boîte englobante à y = 0, après rotation).
 */
export function grille(pieces: Planche, colonnes: number, pas: number): PieceStudio[] {
  const lignes = Math.ceil(pieces.length / colonnes);
  return pieces.map((piece, i) => {
    const colonne = i % colonnes;
    const ligne = Math.floor(i / colonnes);
    const rotation = new Quaternion().setFromEuler(new Euler(...(piece.rotation ?? [0, 0, 0])));
    const geometry = shapeGeometry(piece.forme).applyMatrix4(new Matrix4().makeRotationFromQuaternion(rotation));
    const box = new Box3().setFromBufferAttribute(geometry.getAttribute('position') as never);
    geometry.dispose();
    const centre = box.getCenter(new Vector3());
    return {
      ...piece,
      position: [(colonne - (colonnes - 1) / 2) * pas - centre.x, -box.min.y, (ligne - (lignes - 1) / 2) * pas - centre.z],
    };
  });
}
