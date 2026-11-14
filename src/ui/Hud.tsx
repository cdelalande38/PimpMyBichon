// Haut de l'écran : marque et état hors ligne. Lecture seule : toutes les commandes vivent
// dans le tiers bas, à portée de pouce (§ 2).

import { precachePercent, usePwa } from '../pwa/pwaStore.ts';
import { offlineLabel } from './labels.ts';

function OfflinePill() {
  const offline = usePwa((state) => state.offline);
  const online = usePwa((state) => state.online);
  const percent = usePwa(precachePercent);
  const label = offlineLabel(offline, online);

  return (
    <p className="pill" role="status" data-state={offline} hidden={label === ''}>
      <span>{label}</span>
      {offline === 'preparation' && percent > 0 && (
        // Le pourcentage bouge sans arrêt : inutile de le faire lire à chaque pas.
        <span aria-hidden="true">{percent}&nbsp;%</span>
      )}
    </p>
  );
}

export function Hud() {
  return (
    <header className="hud">
      <h1 className="brand" aria-label="PimpMyBichon">
        <span aria-hidden="true">Pimp my</span>
        <b aria-hidden="true">Bichon</b>
      </h1>
      <OfflinePill />
    </header>
  );
}
