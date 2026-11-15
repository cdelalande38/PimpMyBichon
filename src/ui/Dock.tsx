// Dock : toutes les commandes de l'écran principal, dans le tiers bas (§ 2). En tête, le véhicule à
// l'écran ; puis les onglets de l'atelier ; enfin la rangée d'actions, qui défile au pouce.

import { openSheet, useSettling } from '../app/useRoute.ts';
import { resolveVehicle } from '../data/vehicles.ts';
import { usePwa } from '../pwa/pwaStore.ts';
import { applyUpdate, promptInstall } from '../pwa/register.ts';
import { useBuilds } from '../state/builds.ts';
import { BenchControls } from './BenchControls.tsx';
import { RadioDock } from './radio/RadioDock.tsx';

interface DockProps {
  /** La scène 3D n'a pas démarré : le dock propose de relancer. */
  sceneFailed: boolean;
}

export function Dock({ sceneFailed }: DockProps) {
  const canInstall = usePwa((state) => state.canInstall);
  const updateReady = usePwa((state) => state.updateReady);
  // Double appui sur « Retour à l'atelier » : le second ne doit pas rouvrir un panneau.
  const settling = useSettling();
  const vehicle = resolveVehicle(useBuilds((state) => state.current));

  return (
    <footer className="dock" inert={settling}>
      <div className="dock-text">
        <p className="eyebrow">
          Au garage · <b className="dock-vehicle">{vehicle.name}</b>
          {vehicle.placeholder !== undefined && ' · substitut'}
        </p>
      </div>

      {sceneFailed && (
        <div className="strip strip-alert">
          <span>Le garage 3D est à l’arrêt.</span>
          <button type="button" className="btn" onClick={() => window.location.reload()}>
            Relancer
          </button>
        </div>
      )}

      {updateReady && (
        <div className="strip" role="status">
          <span>Nouvelle version de l’atelier prête.</span>
          <button type="button" className="btn" onClick={() => void applyUpdate()}>
            Recharger
          </button>
        </div>
      )}

      {canInstall && (
        <button type="button" className="btn cta" onClick={() => void promptInstall()}>
          Installer l’atelier
        </button>
      )}

      {!sceneFailed && <BenchControls />}

      <nav className="acts" aria-label="Atelier">
        <RadioDock />
        {vehicle.engine && (
          <button type="button" className="btn" onClick={() => openSheet({ name: 'moteur' })}>
            Moteur
          </button>
        )}
        <button type="button" className="btn" onClick={() => openSheet({ name: 'capot' })}>
          Sous le capot
        </button>
        <button type="button" className="btn" onClick={() => openSheet({ name: 'reglages' })}>
          Réglages
        </button>
        {!sceneFailed && (
          <button type="button" className="btn" onClick={() => openSheet({ name: 'photo' })}>
            Photo
          </button>
        )}
      </nav>
    </footer>
  );
}
