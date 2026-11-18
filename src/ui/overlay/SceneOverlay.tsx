// Point d'ancrage dans l'interface, au-dessus de la scène et sous les panneaux : les pastilles des
// points d'intérêt de la pièce (src/data/pointsInteret.ts). Leur position vient de la scène
// (src/scene/extras/SceneExtras.tsx, à chaque image rendue) ; ici, de vrais boutons nommés,
// atteignables au clavier, qui ouvrent le même menu qu'un appui sur l'objet. Ce sont des repères
// brefs (src/state/piece.ts) : effacés au repos, allumés un instant après un geste ou au clavier.

import { useEffect } from 'react';
import { POINTS_INTERET } from '../../data/pointsInteret.ts';
import { runPieceAction } from '../../scene/extras/actions.ts';
import { usePiece } from '../../state/piece.ts';
import { useView } from '../../state/view.ts';
import { Icon } from '../icons.tsx';
import { CapotPastille } from './CapotPastille.tsx';
import './overlay.css';

export interface SceneOverlayProps {
  /** Un panneau est ouvert : la scène passe derrière, hors d'atteinte. */
  covered: boolean;
}

export function SceneOverlay({ covered }: SceneOverlayProps) {
  const pins = usePiece((state) => state.pins);
  const shown = usePiece((state) => state.shown);
  const mode = useView((state) => state.mode);

  // La scène lit cet état au moment d'un appui : panneau ouvert, elle ne répond plus.
  useEffect(() => {
    usePiece.setState({ covered });
  }, [covered]);
  useEffect(() => () => usePiece.setState({ covered: false }), []);

  if (covered || mode !== 'atelier') return null;
  // Le capot moteur du véhicule à l'écran, s'il s'ouvre (src/ui/overlay/CapotPastille.tsx).
  const capot = <CapotPastille shown={shown} />;
  if (pins.length === 0) return capot;
  return (
    <>
      <div className="piece-overlay" data-visible={shown ? 'oui' : 'non'}>
        {pins.map((pin) => {
          const point = POINTS_INTERET.find((item) => item.id === pin.id);
          if (!point) return null;
          return (
            <button
              key={pin.id}
              type="button"
              className="piece-pin"
              data-point={pin.id}
              aria-label={point.label}
              title={point.label}
              style={{ left: `${pin.x}px`, top: `${pin.y}px` }}
              onClick={() => runPieceAction(point.action)}
            >
              <Icon name={point.icon} />
            </button>
          );
        })}
      </div>
      {capot}
    </>
  );
}
