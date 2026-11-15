// Point d'ancrage dans l'interface, au-dessus de la scène et sous les panneaux : ce qui se pose
// sur l'image sans modifier App.tsx (pastilles des points d'intérêt de la pièce).

export interface SceneOverlayProps {
  /** Un panneau est ouvert : la scène passe derrière, hors d'atteinte. */
  covered: boolean;
}

export function SceneOverlay(props: SceneOverlayProps): null {
  void props;
  return null;
}
