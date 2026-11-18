// Corps du panneau « moteur » : la fiche de préparation du véhicule à l'écran. Le moteur d'origine
// en clair, les trois chiffres en grand (origine, gain, préparé), une rangée de puces par poste.
// Les postes et les gains sont des données (src/data/enginePrep.ts) ; les choix vont dans le build.

import { useId } from 'react';
import {
  BOOST_LABEL,
  FEED_LABEL,
  FUEL_LABEL,
  ORIGIN_LABEL,
  chosenOption,
  computePrep,
  gainPieces,
  resultLabelFor,
  slotsFor,
  type PrepSlot,
} from '../../data/enginePrep.ts';
import type { Build, VehicleId } from '../../data/vehicleTypes.ts';
import { resolveVehicle } from '../../data/vehicles.ts';
import { useBuilds } from '../../state/builds.ts';
import { EngineSoundControls } from './EngineSoundControls.tsx';
import './engine.css';

const NBSP = ' ';

function hp(value: number): string {
  return `${value}${NBSP}ch`;
}

function SlotRow({
  slot,
  vehicle,
  build,
  engine,
}: {
  slot: PrepSlot;
  vehicle: VehicleId;
  build: Build | undefined;
  engine: Parameters<typeof chosenOption>[0];
}) {
  const setPart = useBuilds((state) => state.setPart);
  const titleId = useId();
  const chosen = chosenOption(engine, build, slot.id);
  return (
    <section className="engine-slot" aria-labelledby={titleId}>
      <h3 id={titleId}>{slot.label}</h3>
      <p className="engine-hint">{slot.hint}</p>
      <div className="chips engine-chips" role="group" aria-labelledby={titleId}>
        <button
          type="button"
          className="chip"
          aria-pressed={chosen === undefined}
          onClick={() => setPart(vehicle, slot.id, null)}
        >
          {ORIGIN_LABEL}
          <small>Comme sorti d’usine</small>
        </button>
        {slot.options.map((option) => (
          <button
            key={option.id}
            type="button"
            className="chip"
            aria-pressed={chosen?.id === option.id}
            onClick={() => setPart(vehicle, slot.id, option.id)}
          >
            {option.label}
            <small>{option.hint}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

export function EnginePanel() {
  const current = useBuilds((state) => state.current);
  const builds = useBuilds((state) => state.builds);
  const setPart = useBuilds((state) => state.setPart);
  const vehicle = resolveVehicle(current);
  const engine = vehicle?.engine;
  const prep = vehicle ? computePrep(vehicle, builds[vehicle.id]) : null;
  const pieces = vehicle ? gainPieces(vehicle, builds[vehicle.id]) : null;

  if (!vehicle || !engine || !prep) {
    return (
      <div className="engine">
        <EngineSoundControls />
        <p className="engine-empty">
          {vehicle ? `${vehicle.name} n’a pas encore de moteur déclaré` : 'Aucun véhicule à l’écran'}
          &nbsp;: pas de fiche de préparation pour l’instant.
        </p>
      </div>
    );
  }

  const build = builds[vehicle.id];
  const slots = slotsFor(engine);
  const touched = slots.some((slot) => chosenOption(engine, build, slot.id) !== undefined);

  return (
    <div className="engine" data-agrandir="toujours">
      <EngineSoundControls />
      <p className="engine-spec">
        <strong>{engine.label}</strong>
        <span>
          {[FUEL_LABEL[engine.fuel], FEED_LABEL[engine.feed], BOOST_LABEL[engine.boost]].join(' · ')}
        </span>
      </p>

      <dl className="engine-figures" aria-live="polite">
        <div>
          <dt>Origine</dt>
          <dd data-testid="moteur-origine">{hp(prep.origin)}</dd>
        </div>
        <div className="engine-gain">
          <dt>Gain</dt>
          <dd data-testid="moteur-gain">{`+${NBSP}${hp(prep.gain)}`}</dd>
        </div>
        <div className="engine-result">
          <dt>{resultLabelFor(engine)}</dt>
          <dd data-testid="moteur-prepare">{hp(prep.prepared)}</dd>
        </div>
      </dl>

      {/* Pièces optimisées sur l'établi (Mécanique · Moteur) : comprises dans le gain et le total. */}
      {pieces && pieces.pourcent > 0 && (
        <p className="engine-note engine-pieces" data-testid="moteur-pieces">
          Dont pièces du moteur&nbsp;: <strong>{`+${NBSP}${pieces.pourcent}${NBSP}%`}</strong>, soit {`+${NBSP}${hp(pieces.chevaux)}`}, réglées dans Moteur.
        </p>
      )}

      {prep.nitro > 0 && (
        <p className="engine-nitro" data-testid="moteur-nitro">
          Bouteille ouverte&nbsp;: <strong>{`+${NBSP}${hp(prep.nitro)}`}</strong>, soit {hp(prep.withNitro)}{' '}
          le temps de la poussée.
        </p>
      )}

      {slots.map((slot) => (
        <SlotRow key={slot.id} slot={slot} vehicle={vehicle.id} build={build} engine={engine} />
      ))}

      <button
        type="button"
        className="btn engine-reset"
        disabled={!touched}
        onClick={() => {
          for (const slot of slots) setPart(vehicle.id, slot.id, null);
        }}
      >
        Tout remettre d’origine
      </button>

      <p className="engine-note">
        Chiffres d’atelier pour le plaisir, pas un passage au banc&nbsp;: on ne simule pas la mécanique.
      </p>
    </div>
  );
}
