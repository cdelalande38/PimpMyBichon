// Haut de l'écran : marque, état hors ligne et, dessous, une colonne de boutons ronds à icône pour
// ce qui n'est pas de la personnalisation : la radio, le mode photo, la configuration de l'atelier.
// La personnalisation (onglets et options) reste dans le dock, au pouce (§ 2).

import { openSheet } from '../app/useRoute.ts';
import { resolveVehicle } from '../data/vehicles.ts';
import { precachePercent, usePwa } from '../pwa/pwaStore.ts';
import { useBuilds } from '../state/builds.ts';
import { useView } from '../state/view.ts';
import { openAtelier } from './AtelierSwitcher.tsx';
import { Icon } from './icons.tsx';
import { offlineLabel } from './labels.ts';
import { RadioButton } from './radio/RadioButton.tsx';

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

/**
 * Vue intérieure (§ 5.1) : seulement si le véhicule courant déclare un point de vue intérieur
 * dans son manifeste. Un appui place l'œil au volant, un second rend la vue d'atelier.
 */
function InteriorButton() {
  const vehicle = resolveVehicle(useBuilds((state) => state.current));
  const inside = useView((state) => state.mode === 'interieur');
  const toggle = useView((state) => state.toggle);
  if (!vehicle.interiorView) return null;
  const label = inside ? 'Sortir' : 'Intérieur';
  return (
    <button
      type="button"
      className="quick-btn"
      aria-label={label}
      title={inside ? 'Sortir : retour à l’atelier' : 'Intérieur : à la place du conducteur'}
      data-on={inside || undefined}
      onClick={toggle}
    >
      <Icon name="volant" />
    </button>
  );
}

interface HudProps {
  /** La scène 3D n'a pas démarré : pas de mode photo. */
  sceneFailed: boolean;
  /** Un panneau est ouvert par-dessus : les boutons ronds sont hors d'atteinte (clavier, lecteurs d'écran). */
  covered?: boolean;
}

export function Hud({ sceneFailed, covered = false }: HudProps) {
  return (
    <header className="hud">
      <h1 className="brand" aria-label="PimpMyBichon">
        <span aria-hidden="true">Pimp my</span>
        <b aria-hidden="true">Bichon</b>
      </h1>
      <div className="hud-side">
        <OfflinePill />
        {/* De haut en bas : l'atelier (rare), la photo, la radio (la plus courue), puis la vue
            intérieure (au plus près du pouce, quand le véhicule en a une). La ligne du morceau en
            cours s'étend à gauche de la radio, sous la marque et l'étiquette du véhicule, sans
            les recouvrir. */}
        <nav className="quick" aria-label="Raccourcis" inert={covered} aria-hidden={covered || undefined}>
          <button type="button" className="quick-btn" aria-label="Atelier" title="Atelier : réglages et état du socle" onClick={openAtelier}>
            <Icon name="atelier" />
          </button>
          {!sceneFailed && (
            <button type="button" className="quick-btn" aria-label="Photo" title="Photo" onClick={() => openSheet({ name: 'photo' })}>
              <Icon name="photo" />
            </button>
          )}
          <RadioButton />
          {!sceneFailed && <InteriorButton />}
        </nav>
      </div>
    </header>
  );
}
