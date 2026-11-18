// La pastille du capot moteur sur la scène du garage (vague U, demande du 18 novembre 2026) : un vrai
// bouton nommé, « Ouvrir le capot » ou « Fermer le capot », posé sur le capot du véhicule à l'écran
// (sa position vient de la scène, src/scene/vehicle/capot.ts, à chaque image rendue), comme les
// pastilles de la pièce : un repère bref, allumé après un geste sur la scène ; capot ouvert, il reste
// allumé. Seulement pour un véhicule dont le manifeste déclare un capot qui s'ouvre.

import { basculerCapot, useCapot, useCapotOuvert } from '../../scene/vehicle/capotEtat.ts';
import { Icon } from '../icons.tsx';

export function CapotPastille({ shown }: { shown: boolean }) {
  const pin = useCapot((state) => state.pin);
  const vehicule = useCapot((state) => state.vehicule);
  const ouvert = useCapotOuvert();
  if (!vehicule || !pin) return null;
  const label = ouvert ? 'Fermer le capot' : 'Ouvrir le capot';
  return (
    <div className="piece-overlay capot-overlay" data-visible={shown || ouvert ? 'oui' : 'non'}>
      <button
        type="button"
        className="piece-pin capot-pin"
        data-capot={ouvert ? 'ouvert' : 'ferme'}
        aria-label={label}
        aria-pressed={ouvert}
        title={label}
        style={{ left: `${pin.x}px`, top: `${pin.y}px` }}
        onClick={basculerCapot}
      >
        <Icon name="moteur" />
      </button>
    </div>
  );
}
