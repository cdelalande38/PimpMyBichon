// Haut de l'écran : marque, état hors ligne et, dessous, une colonne de boutons ronds à icône pour
// ce qui n'est pas de la personnalisation : la radio, le mode photo, la configuration de l'atelier.
// La personnalisation (onglets et options) reste dans le dock, au pouce (§ 2).

import { openSheet } from '../app/useRoute.ts';
import { interiorViewsOf, resolveVehicle } from '../data/vehicles.ts';
import { precachePercent, setInstallLater, usePwa } from '../pwa/pwaStore.ts';
import { promptInstall } from '../pwa/register.ts';
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
  const canInstall = usePwa((state) => state.canInstall);
  const installLater = usePwa((state) => state.installLater);
  const label = offlineLabel(offline, online);
  // « Prêt hors ligne », en ligne, ne dit rien d'utile (retour du 16 novembre 2026) : la pastille ne
  // se montre que s'il y a quelque chose à signaler (préparation, panne, hors ligne). L'état complet
  // reste dans Atelier › Sous le capot. Quand elle se tait, sa place sert au bouton d'installation,
  // petit : il ne prend plus une rangée du dock. Sa croix le range pour de bon (« plus tard ») : il
  // ne reste alors que dans Atelier › Sous le capot.
  const quiet = label === '' || (offline === 'pret' && online);

  return (
    <>
      <p className="pill" role="status" data-state={offline} hidden={quiet}>
        <span>{label}</span>
        {offline === 'preparation' && percent > 0 && (
          // Le pourcentage bouge sans arrêt : inutile de le faire lire à chaque pas.
          <span aria-hidden="true">{percent}&nbsp;%</span>
        )}
      </p>
      {canInstall && !installLater && quiet && (
        <div className="install-pill" role="group" aria-label="Installer l’atelier">
          <button type="button" className="install-go" title="Installer l’atelier sur ce téléphone" onClick={() => void promptInstall()}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
            </svg>
            Installer
          </button>
          <button
            type="button"
            className="install-later"
            aria-label="Plus tard : ranger le bouton dans l’Atelier"
            title="Plus tard : le bouton reste dans Atelier › Sous le capot"
            onClick={() => setInstallLater(true)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M7 7l10 10M17 7L7 17" />
            </svg>
          </button>
        </div>
      )}
    </>
  );
}

/**
 * Vue intérieure (§ 5.1) : seulement si le véhicule courant déclare un point de vue intérieur
 * dans son manifeste. Un appui ouvre le premier point de vue, chaque appui suivant passe au point
 * de vue suivant (interiorViews), l'appui sur le dernier rend la vue d'atelier. Le nom du bouton
 * dit ce que fera l'appui.
 */
function InteriorButton() {
  const vehicle = resolveVehicle(useBuilds((state) => state.current));
  const inside = useView((state) => state.mode === 'interieur');
  const seat = useView((state) => state.seat);
  const next = useView((state) => state.next);
  const views = interiorViewsOf(vehicle);
  if (views.length === 0) return null;
  const following = inside ? views[seat + 1] : undefined;
  const label = !inside ? 'Intérieur' : following ? `Vue suivante : ${following.label ?? 'autre place'}` : 'Sortir';
  const title = !inside
    ? `Intérieur : ${(views[0]?.label ?? 'à la place du conducteur').toLowerCase()}`
    : following
      ? label
      : 'Sortir : retour à l’atelier';
  return (
    <button
      type="button"
      className="quick-btn"
      aria-label={label}
      title={title}
      data-on={inside || undefined}
      data-place={inside ? seat : undefined}
      onClick={() => next(views.length)}
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
