// Entrée « Intérieur » du dock (Custom) : le volant, le pommeau, les sièges avant et le ciel étoilé du
// véhicule à l'écran. Ouvrir l'entrée fait entrer dans la vue intérieure, la quitter ramène à
// l'atelier. Quatre volets dans le même cadre, un seul à la fois : le menu garde sa hauteur, chaque
// choix se voit tout de suite. Pièces, teintes et crans viennent des données (src/data/habitacle.ts,
// manifeste) : ajouter un volant ne touche pas à ce fichier. La sellerie se peint dans Peinture.

import { useEffect, useState } from 'react';
import {
  INTERIOR_CATALOGUE,
  INTERIOR_SLOTS,
  INTERIOR_SWATCHES,
  interiorKeys,
  interiorMode,
  interiorTouched,
  resolveInterior,
  resolveSky,
  SKY_OFF,
  SKY_ON,
  SKY_TUNE,
  type InteriorPiece,
} from '../../data/habitacle.ts';
import { interiorViewsOf, resolveVehicle } from '../../data/vehicles.ts';
import type { Hex } from '../../data/vehicleTypes.ts';
import { normalizeHex, resolvePaint, useBuilds } from '../../state/builds.ts';
import { useDock } from '../../state/dock.ts';
import { useView } from '../../state/view.ts';
import { useRevealPressed } from '../scroll.ts';
import './habitacle.css';

type Volet = 'volant' | 'pommeau' | 'sieges' | 'ciel';

const VOLETS: ReadonlyArray<{ id: Volet; label: string }> = [
  { id: 'volant', label: 'Volant' },
  { id: 'pommeau', label: 'Pommeau' },
  { id: 'sieges', label: 'Sièges' },
  { id: 'ciel', label: 'Ciel' },
];

/** Rangée de pièces : une puce par pièce du catalogue, la pièce posée cochée. */
function Pieces({ label, pieces, current, attribute, onPick }: { label: string; pieces: readonly InteriorPiece[]; current: string | undefined; attribute: string; onPick: (id: string) => void }) {
  const row = useRevealPressed<HTMLDivElement>(current ?? '');
  return (
    <div ref={row} className="chips" role="group" aria-label={label}>
      {pieces.map((piece) => (
        <button key={piece.id} type="button" className="chip" aria-pressed={current === piece.id} {...{ [`data-${attribute}`]: piece.id }} onClick={() => onPick(piece.id)}>
          <b>{piece.label}</b>
          {piece.hint && <small>{piece.hint}</small>}
        </button>
      ))}
    </div>
  );
}

/** Pastilles de couleur et « + » (nuancier du téléphone). */
function Swatches({ label, swatches, color, onPick }: { label: string; swatches: ReadonlyArray<{ color: Hex; label: string }>; color: Hex; onPick: (hex: string) => void }) {
  return (
    <div className="habitacle-swatches" role="group" aria-label={label}>
      <span className="habitacle-swatch-label">{label}</span>
      {swatches.map((swatch) => (
        <button
          key={swatch.color}
          type="button"
          className="habitacle-swatch"
          style={{ background: swatch.color }}
          aria-label={swatch.label}
          aria-pressed={color === swatch.color}
          onClick={() => onPick(swatch.color)}
        />
      ))}
      <label className="habitacle-swatch habitacle-swatch-free" style={{ background: color }} title="Autre couleur">
        <span>+</span>
        <input type="color" aria-label="Autre couleur" value={color} onChange={(event) => onPick(event.target.value)} />
      </label>
    </div>
  );
}

/**
 * La vue intérieure tant que l'entrée est ouverte : on y entre à l'ouverture, au point de vue du
 * manifeste qui montre le mieux le volet ouvert (volets), on revient à l'atelier en la quittant
 * (retour, autre entrée, dock fermé).
 */
function useInsideWhileOpen(enabled: boolean, seat: number): void {
  useEffect(() => {
    if (!enabled) return undefined;
    return () => useView.getState().setMode('atelier');
  }, [enabled]);
  useEffect(() => {
    if (enabled) useView.setState({ mode: 'interieur', seat });
  }, [enabled, seat]);
}

export function HabitaclePanel() {
  const current = useBuilds((state) => state.current);
  const builds = useBuilds((state) => state.builds);
  const setPart = useBuilds((state) => state.setPart);
  const setTune = useBuilds((state) => state.setTune);
  const setPaint = useBuilds((state) => state.setPaint);
  const setPartPaint = useBuilds((state) => state.setPartPaint);
  const rememberColor = useBuilds((state) => state.rememberColor);
  const resetKeys = useBuilds((state) => state.resetKeys);
  const openEntry = useDock((state) => state.openEntry);
  const vehicle = resolveVehicle(current);
  const build = builds[vehicle.id];
  const mode = interiorMode(vehicle);
  const interior = resolveInterior(vehicle, build);
  const sky = resolveSky(vehicle, build);
  const volets = VOLETS.filter(
    (item) => (item.id === 'volant' && interior?.steering) || (item.id === 'pommeau' && interior?.knob) || (item.id === 'sieges' && interior?.seats) || (item.id === 'ciel' && sky),
  );
  const [chosen, setVolet] = useState<Volet>('volant');
  const volet = volets.find((item) => item.id === chosen)?.id ?? volets[0]?.id;
  const views = interiorViewsOf(vehicle);
  useInsideWhileOpen(mode !== 'aucun' && views.length > 0, Math.max(0, views.findIndex((view) => volet !== undefined && (view.volets ?? []).includes(volet))));

  if (mode === 'fixe' || mode === 'aucun' || !volet) {
    return (
      <div className="habitacle" data-testid="habitacle">
        <p className="habitacle-empty">
          {mode === 'fixe'
            ? `${vehicle.name} garde son intérieur d’origine : c’est un vrai modèle, son volant et ses sièges ne se démontent pas encore. Glisse un doigt pour regarder autour de toi.`
            : `${vehicle.name} n’a pas d’habitacle à garnir : sur une moto, tout se règle dehors.`}
        </p>
      </div>
    );
  }

  const paint = (slot: string, hex: string) => {
    const value = normalizeHex(hex);
    if (!value) return;
    setPartPaint(vehicle.id, slot, { color: value });
    rememberColor(value);
  };
  const knobZone = interior?.knobZone ?? null;
  const knobColor = knobZone ? (resolvePaint(vehicle, build, knobZone)?.color ?? interior?.knobColor ?? '#141416') : (interior?.knobColor ?? '#141416');
  const pickKnobColor = (hex: string) => {
    const value = normalizeHex(hex);
    if (!value) return;
    if (knobZone) {
      setPaint(vehicle.id, knobZone, { color: value });
      rememberColor(value);
    } else paint(INTERIOR_SLOTS.knob, value);
  };
  const origin = vehicle.interior;
  const seatZone = interior?.seatZone ?? null;
  const seatZoneLabel = vehicle.zones.find((zone) => zone.id === seatZone)?.label ?? 'Sellerie';
  const reset = () => resetKeys(vehicle.id, { ...interiorKeys(), paints: knobZone ? [knobZone] : [] });

  return (
    <div className="habitacle" data-testid="habitacle">
      <div className="habitacle-head">
        <div className="habitacle-volets" role="group" aria-label="Volets de l’intérieur">
          {volets.map((item) => (
            <button key={item.id} type="button" className="habitacle-volet" aria-pressed={volet === item.id} onClick={() => setVolet(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn habitacle-reset" disabled={!interiorTouched(build, knobZone)} onClick={reset}>
          D’origine
        </button>
      </div>
      {volet === 'volant' && interior?.steering && (
        <>
          <Pieces
            label="Dessin du volant"
            pieces={INTERIOR_CATALOGUE.steering}
            current={interior.steering.id}
            attribute="volant"
            onPick={(id) => setPart(vehicle.id, INTERIOR_SLOTS.steering, id === origin?.steering?.default ? null : id)}
          />
          <Swatches label="Couleur de la jante" swatches={INTERIOR_SWATCHES.volant} color={interior.steeringColor} onPick={(hex) => paint(INTERIOR_SLOTS.steering, hex)} />
        </>
      )}
      {volet === 'pommeau' && interior?.knob && (
        <>
          <Pieces
            label="Pommeau de levier"
            pieces={INTERIOR_CATALOGUE.knobs}
            current={interior.knob.id}
            attribute="pommeau"
            onPick={(id) => setPart(vehicle.id, INTERIOR_SLOTS.knob, id === origin?.knob?.default ? null : id)}
          />
          <Swatches label="Couleur du pommeau" swatches={INTERIOR_SWATCHES.pommeau} color={knobColor} onPick={pickKnobColor} />
        </>
      )}
      {volet === 'sieges' && interior?.seats && (
        <>
          <Pieces
            label="Sièges avant"
            pieces={INTERIOR_CATALOGUE.seats}
            current={interior.seats.id}
            attribute="siege"
            onPick={(id) => setPart(vehicle.id, INTERIOR_SLOTS.seats, id === origin?.seats?.default ? null : id)}
          />
          <p className="habitacle-note">
            <span>{seatZone ? 'La couleur et la finition de la sellerie se choisissent dans Peinture.' : 'Sellerie en cuir sombre d’origine.'}</span>
            {seatZone && (
              <button type="button" className="btn habitacle-link" onClick={() => openEntry('peinture', seatZone)}>
                Peindre · {seatZoneLabel}
              </button>
            )}
          </p>
        </>
      )}
      {volet === 'ciel' && sky && (
        <>
          <div className="habitacle-sky">
            <div className="habitacle-toggle" role="group" aria-label="Ciel étoilé">
              {[
                { id: SKY_ON, label: 'Allumé', on: true },
                { id: SKY_OFF, label: 'Éteint', on: false },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="habitacle-volet"
                  aria-pressed={sky.on === item.on}
                  data-ciel={item.id}
                  onClick={() => setPart(vehicle.id, INTERIOR_SLOTS.sky, item.on === (vehicle.cabin?.sky?.on !== false) ? null : item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="habitacle-toggle" role="group" aria-label="Densité des étoiles">
              {INTERIOR_CATALOGUE.sky.densities.map((item, rank) => (
                <button
                  key={item.id}
                  type="button"
                  className="habitacle-volet habitacle-density"
                  aria-pressed={sky.density === rank}
                  data-densite={item.id}
                  disabled={!sky.on}
                  onClick={() => setTune(vehicle.id, SKY_TUNE, rank === INTERIOR_CATALOGUE.sky.origin ? null : rank)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <Swatches label="Couleur des étoiles" swatches={INTERIOR_SWATCHES.ciel} color={sky.color} onPick={(hex) => paint(INTERIOR_SLOTS.sky, hex)} />
        </>
      )}
    </div>
  );
}
