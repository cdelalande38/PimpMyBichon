// Entrée « Roues » du dock (Custom) : la jante, le pneu et ses cotes, pour le véhicule à l'écran.
// Trois volets dans le même cadre (Jantes, Pneus, Cotes), un seul à la fois : le menu garde sa
// hauteur, chaque choix se voit tout de suite sur le véhicule. Dessins, pneus et bornes viennent des
// données (src/data/wheels.ts, manifeste) : ajouter une jante ne touche pas à ce fichier. La couleur
// et la finition des jantes restent dans Peinture (zone des jantes) : un bouton y mène.

import { useState } from 'react';
import { resolveVehicle } from '../../data/vehicles.ts';
import type { VehicleManifest } from '../../data/vehicleTypes.ts';
import {
  resolveWheels,
  rimsFor,
  sizeLabel,
  TIRE_PAINT,
  tiresFor,
  WHEEL_SLOTS,
  WHEEL_TUNE,
  wheelKind,
  wheelsTouched,
  type ResolvedWheels,
} from '../../data/wheels.ts';
import { normalizeHex, useBuilds } from '../../state/builds.ts';
import { useDock } from '../../state/dock.ts';
import { useRevealPressed } from '../scroll.ts';
import './wheels.css';

/** Espace fine insécable, entre un nombre et son unité. */
const NNBSP = '\u202f';

type Volet = 'jantes' | 'pneus' | 'cotes';

const VOLETS: ReadonlyArray<{ id: Volet; label: string }> = [
  { id: 'jantes', label: 'Jantes' },
  { id: 'pneus', label: 'Pneus' },
  { id: 'cotes', label: 'Cotes' },
];

/** Teintes proposées pour la marque du pneu ; « Autre » ouvre le nuancier du téléphone. */
const MARK_SWATCHES: ReadonlyArray<{ color: string; label: string }> = [
  { color: '#efece2', label: 'Blanc cassé' },
  { color: '#e8d9b0', label: 'Crème' },
  { color: '#ff2d3f', label: 'Rouge' },
  { color: '#ffb224', label: 'Jaune' },
  { color: '#3b7bff', label: 'Bleu' },
  { color: '#22d3b6', label: 'Turquoise' },
  { color: '#2e2e32', label: 'Noir' },
];

function RimChoices({ vehicle, wheels }: { vehicle: VehicleManifest; wheels: ResolvedWheels }) {
  const setPart = useBuilds((state) => state.setPart);
  const openEntry = useDock((state) => state.openEntry);
  const rims = rimsFor(vehicle);
  const current = wheels.rim?.id;
  const row = useRevealPressed<HTMLDivElement>(current ?? '');
  const zone = vehicle.wheels?.fit?.zone;
  const zoneLabel = vehicle.zones.find((item) => item.id === zone)?.label ?? 'Jantes';
  return (
    <>
      <div ref={row} className="chips" role="group" aria-label="Dessin des jantes">
        {rims.map((rim) => (
          <button
            key={rim.id}
            type="button"
            className="chip"
            aria-pressed={current === rim.id}
            data-jante={rim.id}
            onClick={() => setPart(vehicle.id, WHEEL_SLOTS.rim, rim.id === vehicle.wheels?.fit?.rim ? null : rim.id)}
          >
            <b>{rim.label}</b>
            {rim.hint && <small>{rim.hint}</small>}
          </button>
        ))}
      </div>
      <p className="wheels-note">
        <span>La couleur et la finition des jantes se choisissent dans Peinture.</span>
        {zone && (
          <button type="button" className="btn wheels-link" onClick={() => openEntry('peinture', zone)}>
            Peindre · {zoneLabel}
          </button>
        )}
      </p>
    </>
  );
}

function TireChoices({ vehicle, wheels }: { vehicle: VehicleManifest; wheels: ResolvedWheels }) {
  const setPart = useBuilds((state) => state.setPart);
  const setPartPaint = useBuilds((state) => state.setPartPaint);
  const rememberColor = useBuilds((state) => state.rememberColor);
  const tires = tiresFor(vehicle);
  const current = wheels.tire?.id;
  const row = useRevealPressed<HTMLDivElement>(current ?? '');
  const color = wheels.tireColor;
  const pick = (hex: string) => {
    const value = normalizeHex(hex);
    if (!value) return;
    setPartPaint(vehicle.id, TIRE_PAINT, { color: value });
    rememberColor(value);
  };
  return (
    <>
      <div ref={row} className="chips" role="group" aria-label="Type de pneu">
        {tires.map((tire) => (
          <button
            key={tire.id}
            type="button"
            className="chip"
            aria-pressed={current === tire.id}
            data-pneu={tire.id}
            onClick={() => setPart(vehicle.id, WHEEL_SLOTS.tire, tire.id === vehicle.wheels?.fit?.tire ? null : tire.id)}
          >
            <b>{tire.label}</b>
            {tire.hint && <small>{tire.hint}</small>}
          </button>
        ))}
      </div>
      <div className="wheels-swatches" role="group" aria-label={wheels.tire?.colorLabel ?? 'Couleur du pneu'}>
        <span className="wheels-swatch-label">{wheels.tire?.colorLabel ?? 'Couleur'}</span>
        {MARK_SWATCHES.map((swatch) => (
          <button
            key={swatch.color}
            type="button"
            className="wheels-swatch"
            style={{ background: swatch.color }}
            aria-label={swatch.label}
            aria-pressed={color === swatch.color}
            onClick={() => pick(swatch.color)}
          />
        ))}
        <label className="wheels-swatch wheels-swatch-free" style={{ background: color }} title="Autre couleur">
          <span>+</span>
          <input type="color" aria-label="Autre couleur" value={color} onChange={(event) => pick(event.target.value)} />
        </label>
      </div>
    </>
  );
}

interface Cote {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  testId: string;
}

/**
 * Cotes : une puce par cote (sa valeur dedans), et le curseur de la cote choisie. Un seul curseur
 * à l'écran : le menu tient dans le tiers bas.
 */
function SizeSliders({ vehicle, wheels }: { vehicle: VehicleManifest; wheels: ResolvedWheels }) {
  const setTune = useBuilds((state) => state.setTune);
  const [chosen, setChosen] = useState<string>(WHEEL_TUNE.diameter);
  const fit = vehicle.wheels?.fit;
  if (!fit || !wheels.front || !wheels.rear) return null;
  const kind = wheelKind(vehicle);
  const cotes: Cote[] = [
    { id: WHEEL_TUNE.diameter, label: 'Jante', value: wheels.diameter, min: fit.diameter[0], max: fit.diameter[1], unit: 'pouces', testId: 'roues-diametre' },
  ];
  if (fit.width) cotes.push({ id: WHEEL_TUNE.width, label: 'Largeur', value: wheels.width, min: fit.width[0], max: fit.width[1], unit: 'mm', testId: 'roues-largeur' });
  if (fit.rearWidth) cotes.push({ id: WHEEL_TUNE.rearWidth, label: 'Pneu arrière', value: wheels.rearWidth, min: fit.rearWidth[0], max: fit.rearWidth[1], unit: 'mm', testId: 'roues-arriere' });
  cotes.push({ id: WHEEL_TUNE.aspect, label: 'Flanc', value: wheels.aspect, min: fit.aspect[0], max: fit.aspect[1], unit: '%', testId: 'roues-flanc' });
  const cote = cotes.find((item) => item.id === chosen) ?? (cotes[0] as Cote);
  const same = wheels.front.width === wheels.rear.width && wheels.front.aspect === wheels.rear.aspect;
  const short = (unit: string) => (unit === 'pouces' ? '″' : `${NNBSP}${unit}`);
  return (
    <>
      <div className="chips" role="group" aria-label="Cote à régler">
        {cotes.map((item) => (
          <button key={item.id} type="button" className="chip wheels-cote" aria-pressed={item.id === cote.id} data-cote={item.id} onClick={() => setChosen(item.id)}>
            <b>{item.label}</b>
            <small>
              {item.value}
              {short(item.unit)}
            </small>
          </button>
        ))}
      </div>
      <label className="wheels-slider">
        <span className="wheels-size" data-testid="roues-cote">
          {same ? sizeLabel(wheels.front, kind) : `${sizeLabel(wheels.front, kind)} · ${sizeLabel(wheels.rear, kind)}`}
        </span>
        <input
          type="range"
          min={cote.min}
          max={cote.max}
          step={1}
          value={cote.value}
          aria-label={cote.label}
          aria-valuetext={`${cote.value} ${cote.unit}`}
          data-testid={cote.testId}
          onChange={(event) => setTune(vehicle.id, cote.id, Number(event.target.value))}
        />
        <output>
          {cote.value}
          {NNBSP}
          {cote.unit}
        </output>
      </label>
    </>
  );
}

export function WheelsPanel() {
  const current = useBuilds((state) => state.current);
  const builds = useBuilds((state) => state.builds);
  const setPart = useBuilds((state) => state.setPart);
  const setTune = useBuilds((state) => state.setTune);
  const setPartPaint = useBuilds((state) => state.setPartPaint);
  const openEntry = useDock((state) => state.openEntry);
  const [volet, setVolet] = useState<Volet>('jantes');
  const vehicle = resolveVehicle(current);
  const build = builds[vehicle.id];
  const wheels = resolveWheels(vehicle, build);

  if (!wheels?.swap) {
    return (
      <div className="wheels">
        <p className="wheels-empty">
          {vehicle.name} garde ses roues d’origine&nbsp;: ses jantes ne se démontent pas encore.
          {wheels ? ' Son assiette, elle, se règle dans Suspension.' : ''}
        </p>
        {wheels && (
          <button type="button" className="btn" onClick={() => openEntry('suspension')}>
            Régler l’assiette
          </button>
        )}
      </div>
    );
  }

  const reset = () => {
    setPart(vehicle.id, WHEEL_SLOTS.rim, null);
    setPart(vehicle.id, WHEEL_SLOTS.tire, null);
    setPartPaint(vehicle.id, TIRE_PAINT, null);
    for (const id of [WHEEL_TUNE.diameter, WHEEL_TUNE.width, WHEEL_TUNE.rearWidth, WHEEL_TUNE.aspect]) setTune(vehicle.id, id, null);
  };

  return (
    <div className="wheels" data-testid="roues">
      <div className="wheels-head">
        <div className="wheels-volets" role="group" aria-label="Volets des roues">
          {VOLETS.map((item) => (
            <button key={item.id} type="button" className="wheels-volet" aria-pressed={volet === item.id} onClick={() => setVolet(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn wheels-reset" disabled={!wheelsTouched(build, 'roues')} onClick={reset}>
          D’origine
        </button>
      </div>
      {volet === 'jantes' && <RimChoices vehicle={vehicle} wheels={wheels} />}
      {volet === 'pneus' && <TireChoices vehicle={vehicle} wheels={wheels} />}
      {volet === 'cotes' && <SizeSliders vehicle={vehicle} wheels={wheels} />}
    </div>
  );
}
