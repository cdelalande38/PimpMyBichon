// Entrée « Suspension » du dock (Custom) : l'assiette du véhicule à l'écran. Trois préréglages
// (origine, rabaissée, posée au sol) et un curseur fin, en part de la descente possible : la place
// au-dessus des roues (passage de roue, garde-boue) et sous la caisse, déclarée par le manifeste et
// réduite par de plus grandes roues (src/data/wheels.ts). Les roues restent au sol, la caisse descend :
// chaque cran le montre en petit (src/ui/pictos/), tiré de sa valeur.

import { resolveVehicle } from '../../data/vehicles.ts';
import { RIDE_PRESETS, resolveWheels, WHEEL_TUNE } from '../../data/wheels.ts';
import { useBuilds } from '../../state/builds.ts';
import { useDock } from '../../state/dock.ts';
import { PictoAssiette } from '../pictos/Pictos.tsx';
import './wheels.css';

/** Espace fine insécable, entre un nombre et son unité. */
const NNBSP = '\u202f';

const cm = (meters: number) => `${(meters * 100).toFixed(1).replace('.', ',')}${NNBSP}cm`;

export function SuspensionPanel() {
  const current = useBuilds((state) => state.current);
  const builds = useBuilds((state) => state.builds);
  const setTune = useBuilds((state) => state.setTune);
  const openEntry = useDock((state) => state.openEntry);
  const vehicle = resolveVehicle(current);
  const wheels = resolveWheels(vehicle, builds[vehicle.id]);

  if (!wheels) {
    return (
      <div className="wheels">
        <p className="wheels-empty">{vehicle.name} n’a pas encore de suspension réglable.</p>
      </div>
    );
  }

  const percent = Math.round(wheels.ride * 100);
  const set = (value: number | null) => setTune(vehicle.id, WHEEL_TUNE.ride, value);
  const tight = wheels.maxDrop < 0.01;

  return (
    <div className="wheels" data-testid="suspension">
      <div className="chips" role="group" aria-label="Assiette">
        {RIDE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="chip chip-picto"
            aria-pressed={Math.abs(wheels.ride - preset.value) < 0.005}
            data-assiette={preset.id}
            onClick={() => set(preset.value === 0 ? null : preset.value)}
          >
            <PictoAssiette part={preset.value} />
            <span className="chip-text">
              <b>{preset.label}</b>
              <small>{preset.hint}</small>
            </span>
          </button>
        ))}
      </div>
      <label className="wheels-slider">
        <span>Hauteur</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={percent}
          disabled={tight}
          aria-valuetext={wheels.drop > 0 ? `${cm(wheels.drop)} plus bas` : 'Origine'}
          data-testid="suspension-hauteur"
          onChange={(event) => {
            const value = Number(event.target.value) / 100;
            set(value === 0 ? null : value);
          }}
        />
        <output data-testid="suspension-descente">{wheels.drop > 0 ? `−${cm(wheels.drop)}` : 'Origine'}</output>
      </label>
      <p className="wheels-note">
        <span>
          {tight
            ? 'Plus de place sous les ailes : une jante plus petite ou un flanc plus bas, et ça descend.'
            : `Jusqu’à ${cm(wheels.maxDrop)} plus bas avec ces roues ; « Origine » remet la hauteur d’usine.`}
        </span>
        {wheels.swap && (
          <button type="button" className="btn wheels-link" onClick={() => openEntry('roues')}>
            Roues
          </button>
        )}
      </p>
    </div>
  );
}
