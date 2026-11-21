// Étapes de choix de l'écran « Jouer » après le mode : le lieu et le circuit du lieu (le départ se choisit aux
// réglages, src/ui/drive/entree/EtapeReglages.tsx). Une seule à l'écran ; chacune remplace la précédente
// (src/ui/drive/entree/etapes.ts). En tête de chaque étape, une ligne relit ce qui est déjà choisi et dit ce
// qu'on attend ; dessous, une rangée de choix (elle défile en dock compact, passe à la ligne en dock agrandi et
// en paysage).

import { circuitLabel, mapById, zoneById, zoneOf, zonesOf } from '../../../data/maps.ts';
import { useDock } from '../../../state/dock.ts';
import { useDrive } from '../../../state/drive.ts';
import { PictoCarte } from '../../pictos/Pictos.tsx';
import { useRevealPressed } from '../../scroll.ts';
import { apresCircuit, apresLieu } from './etapes.ts';

/** Ligne de tête d'une étape : ce qui est déjà choisi (en clair), puis ce qu'on attend. */
function Rappel({ choisi, consigne }: { choisi?: string; consigne: string }) {
  return (
    <p className="entree-rappel">
      {choisi && <b>{choisi}</b>}
      {choisi && ' · '}
      {consigne}
    </p>
  );
}

/** Le lieu (plateau matheysin, Monaco, Miami…) : un lieu à un seul circuit mène droit aux réglages. */
export function EtapeLieu() {
  // Le nom du mode choisi : le libellé du premier niveau de la pile.
  const mode = useDock((state) => (state.levels[0]?.kind === 'sortie' ? state.levels[0].libelle : undefined));
  const zones = zonesOf();
  const chosen = useDrive((state) => state.choice.map);
  const chooseMap = useDrive((state) => state.chooseMap);
  const push = useDock((state) => state.push);
  const current = mapById(chosen);
  const pressed = current ? zoneOf(current).id : null;
  const row = useRevealPressed<HTMLDivElement>(pressed ?? '');
  return (
    <div className="entree-corps">
      <Rappel choisi={mode} consigne="choisis le lieu" />
      <div ref={row} className="chips entree-liste" role="group" aria-label="Lieu">
        {zones.map((zone) => {
          const first = zone.maps[0];
          return (
            <button
              key={zone.id}
              type="button"
              className="chip chip-picto"
              data-zone={zone.id}
              aria-pressed={zone.id === pressed}
              onClick={() => {
                const { niveau, carte } = apresLieu(zone);
                if (carte) chooseMap(carte.id);
                push(niveau);
              }}
            >
              {first && <PictoCarte id={first.id} />}
              <span className="chip-text">
                <b>{zone.label}</b>
                <small>{zone.maps.length > 1 ? `${zone.maps.length} circuits` : (first?.hint ?? first?.name)}</small>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Les circuits du lieu choisi, et seulement eux, avec leur miniature. */
export function EtapeCircuit({ lieu }: { lieu: string }) {
  const zone = zoneById(lieu);
  const chosen = useDrive((state) => state.choice.map);
  const chooseMap = useDrive((state) => state.chooseMap);
  const push = useDock((state) => state.push);
  const row = useRevealPressed<HTMLDivElement>(chosen ?? '');
  if (!zone) return <p className="drive-note">Ce lieu n’est plus au catalogue : reviens d’une étape.</p>;
  return (
    <div className="entree-corps">
      <Rappel choisi={zone.label} consigne="choisis le circuit" />
      <div ref={row} className="chips entree-liste" role="group" aria-label="Circuit">
        {zone.maps.map((map) => (
          <button
            key={map.id}
            type="button"
            className="chip chip-picto"
            data-carte={map.id}
            aria-pressed={map.id === chosen}
            onClick={() => {
              chooseMap(map.id);
              push(apresCircuit(map));
            }}
          >
            <PictoCarte id={map.id} />
            <span className="chip-text">
              <b>{circuitLabel(map)}</b>
              {map.hint && <small>{map.hint}</small>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
