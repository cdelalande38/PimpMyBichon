// Haut de l'écran : marque, état hors ligne et, dessous, une colonne de boutons ronds à icône pour
// ce qui n'est pas de la personnalisation : la radio, le mode photo, la configuration de l'atelier.
// La personnalisation (onglets et options) reste dans le dock, au pouce (§ 2).

import { openSheet } from '../app/useRoute.ts';
import { placeOf, resolveVehicle } from '../data/vehicles.ts';
import { precachePercent, setInstallLater, usePwa } from '../pwa/pwaStore.ts';
import { applyUpdate, promptInstall } from '../pwa/register.ts';
import { useBuilds } from '../state/builds.ts';
import { useDock } from '../state/dock.ts';
import { useView } from '../state/view.ts';
import { openAtelier } from './AtelierSwitcher.tsx';
import { Icon } from './icons.tsx';
import { Solde } from './jeu/Solde.tsx';
import { PlacePicker } from './PlacePicker.tsx';
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
 * Nouvelle version prête : le bandeau du menu ne se voit que menu ouvert (retour du 16 novembre 2026 :
 * un téléphone est resté des heures sur l'ancienne version). Cette pastille se voit au garage même menu
 * fermé ; un appui applique la version et recharge la page.
 */
function UpdatePill({ covered }: { covered: boolean }) {
  const updateReady = usePwa((state) => state.updateReady);
  if (!updateReady) return null;
  return (
    <button
      type="button"
      className="maj-pill"
      aria-label="Nouvelle version prête : recharger l’atelier"
      title="Une nouvelle version de l’atelier est prête"
      inert={covered}
      onClick={() => void applyUpdate()}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5" />
      </svg>
      <span>Nouvelle version</span>
      <b>Recharger</b>
    </button>
  );
}

/**
 * Vue intérieure (§ 5.1) : seulement si le véhicule courant déclare des places dans son manifeste.
 * Le bouton rond entre (à la place gardée pour ce véhicule, le conducteur la première fois) et
 * ressort ; le choix de la place se fait par son nom, au pouce (PlacePicker).
 */
function InteriorButton() {
  const vehicle = resolveVehicle(useBuilds((state) => state.current));
  const inside = useView((state) => state.mode === 'interieur');
  const enterOrLeave = useView((state) => state.enterOrLeave);
  const remembered = useView((state) => state.places[vehicle.id]);
  const place = placeOf(vehicle, remembered);
  if (!place) return null;
  const label = inside ? 'Sortir' : 'Intérieur';
  const title = inside ? 'Sortir : retour à l’atelier' : `Intérieur : place ${place.label.toLowerCase()}`;
  return (
    <button type="button" className="quick-btn" aria-label={label} title={title} data-on={inside || undefined} onClick={() => enterOrLeave(vehicle.id)}>
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
      {/* Le solde en dollars, discret, à côté de la marque : un appui ouvre Atelier › Jeu. */}
      <Solde covered={covered} />
      <div className="hud-side">
        <OfflinePill />
        <UpdatePill covered={covered} />
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
          {/* La sortie de nuit était introuvable au deuxième niveau du menu (retour du 16 novembre
              2026) : son raccourci ouvre Garage › Sortie, où l'on choisit la carte. */}
          {!sceneFailed && (
            <button
              type="button"
              className="quick-btn"
              aria-label="Sortie"
              title="Sortie : choisir la carte et rouler"
              onClick={() => useDock.getState().openEntry('sortie')}
            >
              <Icon name="route" />
            </button>
          )}
          {!sceneFailed && <InteriorButton />}
        </nav>
      </div>
      {/* Choix de la place en vue intérieure : au pouce, au-dessus du dock (posé en bas de l'écran). */}
      {!sceneFailed && <PlacePicker covered={covered} />}
    </header>
  );
}
