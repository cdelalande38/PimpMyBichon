// Dock : toutes les commandes de l'écran principal, dans le tiers bas (§ 2).

import { openSheet, useSettling } from '../app/useRoute.ts';
import { usePwa } from '../pwa/pwaStore.ts';
import { applyUpdate, promptInstall } from '../pwa/register.ts';
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

  return (
    <footer className="dock" inert={settling}>
      <div className="dock-text">
        <p className="eyebrow">Banc d’essai · jalon 1</p>
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

      <RadioDock />

      <nav className="acts" aria-label="Atelier">
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
