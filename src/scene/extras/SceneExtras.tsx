// Point d'ancrage dans la scène 3D : ce qui s'ajoute à la pièce sans modifier GarageCanvas.tsx
// (points d'intérêt du garage, appui sur le véhicule). Monté sous le Canvas, à côté du garage.

export interface SceneExtrasProps {
  /** Mode photo : rien ne répond, rien ne s'affiche. */
  photo: boolean;
}

export function SceneExtras(props: SceneExtrasProps): null {
  void props;
  return null;
}
