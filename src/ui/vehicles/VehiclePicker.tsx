// Onglet « Véhicule » du dock : une puce par véhicule du catalogue (src/data/vehicles.ts), dans
// l'ordre du catalogue. Un substitut est annoncé, un modèle absent du build aussi. Chaque véhicule
// garde son build : en changer ne perd rien.

import { useRevealPressed } from '../scroll.ts';
import { modelPresent, VEHICLES, resolveVehicle } from '../../data/vehicles.ts';
import { resolvePaint, masterZone, useBuilds } from '../../state/builds.ts';
import { useBench } from '../../state/bench.ts';

/** Mentions sous le nom : ligne d'atelier, substitut, modèle absent ou en route. */
function notes(parts: ReadonlyArray<string | false | undefined>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' · ');
}

export function VehiclePicker() {
  const current = resolveVehicle(useBuilds((state) => state.current)).id;
  const builds = useBuilds((state) => state.builds);
  const select = useBuilds((state) => state.select);
  const status = useBench((state) => state.status);

  // La rangée défile : le véhicule à l'écran est amené dans le champ s'il en est sorti (relecture
  // de la sauvegarde) ; un choix au pouce ne déplace rien (src/ui/scroll.ts).
  const row = useRevealPressed<HTMLDivElement>(current);

  return (
    <div ref={row} className="chips chips-vehicles" role="group" aria-label="Véhicule">
      {VEHICLES.map((vehicle) => {
        const master = masterZone(vehicle) ?? vehicle.zones[0];
        const swatch = master ? resolvePaint(vehicle, builds[vehicle.id], master.id)?.color : undefined;
        const active = vehicle.id === current;
        const note = notes([
          vehicle.hint,
          vehicle.placeholder !== undefined && 'maquette',
          modelPresent(vehicle) === false && 'modèle absent',
          active && status === 'chargement' && 'en route…',
        ]);
        return (
          <button
            key={vehicle.id}
            type="button"
            className={swatch ? 'chip chip-swatch' : 'chip'}
            aria-pressed={active}
            data-vehicle={vehicle.id}
            onClick={() => select(vehicle.id)}
          >
            {swatch && <span className="swatch" aria-hidden="true" style={{ background: swatch }} />}
            <b>{vehicle.name}</b>
            {note && <small>{note}</small>}
          </button>
        );
      })}
    </div>
  );
}
