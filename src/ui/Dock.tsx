// Dock : toutes les commandes de l'écran principal, dans le tiers bas (§ 2). En tête, le véhicule à
// l'écran ; puis les onglets de l'atelier ; enfin la rangée d'actions, qui défile au pouce.
// Deux tailles, au choix (poignée au bout des onglets, préférence retenue : src/state/dock.ts) :
// compact, les rangées défilent ; agrandi, le dock monte et les options passent à la ligne.

import { useLayoutEffect, useRef } from 'react';
import { openSheet, useSettling } from '../app/useRoute.ts';
import { resolveVehicle } from '../data/vehicles.ts';
import { usePwa } from '../pwa/pwaStore.ts';
import { applyUpdate, promptInstall } from '../pwa/register.ts';
import { useBuilds } from '../state/builds.ts';
import { useDock } from '../state/dock.ts';
import { BenchControls } from './BenchControls.tsx';
import { RadioDock } from './radio/RadioDock.tsx';

interface DockProps {
  /** La scène 3D n'a pas démarré : le dock propose de relancer. */
  sceneFailed: boolean;
}

/** Poignée du dock : agrandit ou réduit le menu, au pouce comme au clavier. */
function DockHandle() {
  const expanded = useDock((state) => state.expanded);
  const toggle = useDock((state) => state.toggle);
  const label = expanded ? 'Réduire le menu' : 'Agrandir le menu';
  return (
    <button type="button" className="dock-handle" aria-label={label} title={label} onClick={toggle}>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M6 15l6-6 6 6" />
      </svg>
    </button>
  );
}

export function Dock({ sceneFailed }: DockProps) {
  const canInstall = usePwa((state) => state.canInstall);
  const updateReady = usePwa((state) => state.updateReady);
  // Double appui sur « Retour à l'atelier » : le second ne doit pas rouvrir un panneau.
  const settling = useSettling();
  const vehicle = resolveVehicle(useBuilds((state) => state.current));
  const expanded = useDock((state) => state.expanded);
  const setTop = useDock((state) => state.setTop);

  // Dock agrandi : son bord haut, mesuré à l'écran, sert à la scène pour recadrer le véhicule
  // au-dessus. Il bouge avec le contenu de l'onglet, la taille du texte et celle de l'écran.
  const footer = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = footer.current;
    if (!expanded || !element) {
      setTop(null);
      return;
    }
    const measure = () => setTop(Math.round(element.getBoundingClientRect().top));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [expanded, setTop]);

  return (
    <footer ref={footer} className="dock" data-taille={expanded ? 'agrandi' : 'compact'} inert={settling}>
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

      {!sceneFailed && <BenchControls handle={<DockHandle />} />}

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
