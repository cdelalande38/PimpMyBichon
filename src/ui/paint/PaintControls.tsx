// Onglet « Peinture » du dock (§ 5.2) : trois gestes d'un pouce. La zone (puces, zone maîtresse
// d'abord, cadenas pour lier ou détacher une zone de carrosserie), la couleur (palette « Bichon »,
// dernières couleurs, nuancier) et la finition (avec la taille de paillette et la seconde teinte).
// Tout part des données : zones du manifeste, src/data/paintColors.ts, src/data/finishes.ts. Dock
// agrandi : les trois ensemble, sur plusieurs lignes, sans l'alternance Couleur / Finition.

import { useEffect, useMemo, useRef, useState } from 'react';
import { finish as findFinish, FINISHES } from '../../data/finishes.ts';
import { PAINT_COLORS } from '../../data/paintColors.ts';
import { resolveVehicle } from '../../data/vehicles.ts';
import type { Hex, Paint, VehicleManifest } from '../../data/vehicleTypes.ts';
import { FLAKE_RANGE, isLinked, masterZone, resolvePaints, useBuilds } from '../../state/builds.ts';
import { useDock } from '../../state/dock.ts';
import { ColorPicker } from './ColorPicker.tsx';
import {
  canLink,
  color2Value,
  flakeValue,
  formatMillimeters,
  hasColor2,
  hasFlake,
  orderedZones,
  paintTarget,
  pickableColors,
} from './paintLogic.ts';
import './paint.css';

type Step = 'couleur' | 'finition';
type PickerTarget = 'color' | 'color2';

const STEPS: ReadonlyArray<{ id: Step; label: string }> = [
  { id: 'couleur', label: 'Couleur' },
  { id: 'finition', label: 'Finition' },
];

function Lock({ open }: { open: boolean }) {
  return (
    <svg className="paint-lock-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d={open ? 'M8 11V7a4 4 0 0 1 7.6-1.7' : 'M8 11V7a4 4 0 0 1 8 0v4'} />
    </svg>
  );
}

/** Amène le choix pressé dans le champ de sa rangée défilante. */
function useKeepPressedInView(key: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      ref.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [key]);
  return ref;
}

function PaintEditor({ manifest }: { manifest: VehicleManifest }) {
  const vehicle = manifest.id;
  const build = useBuilds((state) => state.builds[vehicle]);
  const recents = useBuilds((state) => state.recents);
  const setPaint = useBuilds((state) => state.setPaint);
  const setLinked = useBuilds((state) => state.setLinked);
  const rememberColor = useBuilds((state) => state.rememberColor);
  // Dock agrandi : couleurs et finitions ensemble, sur plusieurs lignes, au lieu de l'alternance.
  const wide = useDock((state) => state.expanded);

  const zones = useMemo(() => orderedZones(manifest), [manifest]);
  const master = masterZone(manifest);
  const [chosenZone, setZone] = useState<string>(() => zones[0]?.id ?? '');
  // Changement de véhicule : la zone choisie peut ne plus exister.
  const zoneId = zones.some((zone) => zone.id === chosenZone) ? chosenZone : (zones[0]?.id ?? '');
  const [step, setStep] = useState<Step>('couleur');
  const [picker, setPicker] = useState<PickerTarget | null>(null);

  const paints = useMemo(() => resolvePaints(manifest, build), [manifest, build]);
  const paint: Paint | undefined = paints[zoneId];
  const zone = manifest.zones.find((item) => item.id === zoneId);
  const linkable = canLink(manifest, zoneId);
  const linked = isLinked(manifest, build, zoneId);
  const target = paintTarget(manifest, build, zoneId);
  const finish = paint ? findFinish(paint.finish) : undefined;

  const zoneRow = useKeepPressedInView(`${vehicle}-${zoneId}`);
  const choiceRow = useKeepPressedInView(`${wide}-${step}-${paint?.color}-${paint?.finish}`);

  if (!zone || !paint || !finish) {
    return <p className="paint-note">Ce véhicule n’a pas de zone à peindre.</p>;
  }

  const putColor = (hex: Hex, field: PickerTarget = 'color') => setPaint(vehicle, target, { [field]: hex });
  const chooseColor = (hex: Hex) => {
    putColor(hex);
    rememberColor(hex);
  };
  const toggleLink = () => {
    // Au détachement, la peinture du moment devient la sienne : rien ne saute à l'image.
    setLinked(vehicle, zoneId, !linked, paint);
    setPicker(null);
  };

  const pickerValue = picker === 'color2' ? color2Value(paint.color, paint.finish, paint.color2) : paint.color;
  const pickerTitle = picker === 'color2' ? `Seconde teinte · ${zone.label}` : zone.label;

  if (picker) {
    return (
      <div className="paint">
        <ColorPicker
          value={pickerValue}
          title={pickerTitle}
          pickables={pickableColors(manifest, build, zoneId)}
          onLive={(hex) => putColor(hex, picker)}
          onCommit={(hex) => {
            putColor(hex, picker);
            rememberColor(hex);
          }}
          onClose={() => setPicker(null)}
        />
      </div>
    );
  }

  const zonesBar = (
    <div className="paint-bar">
      <div ref={zoneRow} className="chips paint-zones" role="group" aria-label="Zones">
        {zones.map((item) => {
          const itemPaint = paints[item.id];
          const follows = isLinked(manifest, build, item.id);
          return (
            <button
              key={item.id}
              type="button"
              className="chip chip-swatch paint-zone"
              aria-pressed={item.id === zoneId}
              onClick={() => setZone(item.id)}
            >
              {itemPaint && <span className="swatch" aria-hidden="true" style={{ background: itemPaint.color }} />}
              <b>{item.label}</b>
              {follows && <small>liée</small>}
            </button>
          );
        })}
      </div>
      {linkable && master && (
        <button
          type="button"
          className="btn paint-lock"
          aria-pressed={linked}
          aria-label={linked ? `Liée à ${master.label} : détacher` : `Détachée : lier à ${master.label}`}
          onClick={toggleLink}
        >
          <Lock open={!linked} />
          <span aria-hidden="true">{linked ? 'Liée' : 'Détachée'}</span>
        </button>
      )}
    </div>
  );

  const colorRow = (
    <div ref={wide || step === 'couleur' ? choiceRow : undefined} className="chips paint-colors" role="group" aria-label="Couleurs">
      <button type="button" className="paint-dot paint-other" onClick={() => setPicker('color')}>
        <span className="paint-dot-disc paint-rainbow" aria-hidden="true" />
        <span className="paint-dot-label">Autre couleur</span>
      </button>
      {PAINT_COLORS.map((color) => (
        <button
          key={color.id}
          type="button"
          className="paint-dot"
          aria-label={color.label}
          title={color.label}
          aria-pressed={paint.color === color.hex}
          onClick={() => chooseColor(color.hex)}
        >
          <span className="paint-dot-disc" aria-hidden="true" style={{ background: color.hex }} />
        </button>
      ))}
      {recents.length > 0 && (
        <span className="paint-sep" aria-hidden="true">
          Dernières
        </span>
      )}
      {recents.map((hex) => (
        <button
          key={hex}
          type="button"
          className="paint-dot"
          aria-label={`Récente ${hex}`}
          title={hex}
          aria-pressed={paint.color === hex && !PAINT_COLORS.some((color) => color.hex === hex)}
          onClick={() => chooseColor(hex)}
        >
          <span className="paint-dot-disc" aria-hidden="true" style={{ background: hex }} />
        </button>
      ))}
    </div>
  );

  const finishRow = (
    <div ref={!wide && step === 'finition' ? choiceRow : undefined} className="chips paint-finishes" role="group" aria-label="Finitions">
      {FINISHES.map((item) => (
        <button
          key={item.id}
          type="button"
          className="chip"
          aria-pressed={paint.finish === item.id}
          // Nouvelle finition : sa taille de paillette d'origine revient ; la seconde teinte reste.
          onClick={() => setPaint(vehicle, target, { finish: item.id, flake: undefined })}
        >
          <b>{item.label}</b>
          <small>{item.hint}</small>
        </button>
      ))}
    </div>
  );

  const extraRow = (hasFlake(finish) || hasColor2(finish)) && (
    <div className="paint-extra">
      {hasFlake(finish) && (
        <label className="paint-flake">
          <span>Paillette</span>
          <input
            type="range"
            min={FLAKE_RANGE.min}
            max={FLAKE_RANGE.max}
            step={0.1}
            value={flakeValue(paint.finish, paint.flake)}
            aria-valuetext={formatMillimeters(flakeValue(paint.finish, paint.flake))}
            onChange={(event) => setPaint(vehicle, target, { flake: Number(event.target.value) })}
          />
          <output>{formatMillimeters(flakeValue(paint.finish, paint.flake))}</output>
        </label>
      )}
      {hasColor2(finish) && (
        <button type="button" className="btn paint-color2" onClick={() => setPicker('color2')}>
          <span className="swatch" aria-hidden="true" style={{ background: color2Value(paint.color, paint.finish, paint.color2) }} />
          Seconde teinte
        </button>
      )}
    </div>
  );

  const linkedNote = linked && master && (
    <p className="paint-note" role="status">
      Liée : la couleur part aussi sur {master.label}.
    </p>
  );

  if (wide) {
    // Dock agrandi : les zones, puis les couleurs, puis les finitions, visibles ensemble.
    return (
      <div className="paint paint-wide">
        {zonesBar}
        <section className="paint-section" aria-labelledby={`${vehicle}-couleur`}>
          <h3 id={`${vehicle}-couleur`} className="paint-head">
            Couleur
          </h3>
          {colorRow}
          {linkedNote}
        </section>
        <section className="paint-section" aria-labelledby={`${vehicle}-finition`}>
          <h3 id={`${vehicle}-finition`} className="paint-head">
            Finition
          </h3>
          {finishRow}
          {extraRow}
        </section>
      </div>
    );
  }

  return (
    <div className="paint">
      {/* Deux rangées au plus sous les onglets (tiers bas, § 2) : zones et cadenas, puis
          étapes et choix. */}
      {zonesBar}
      <div className="paint-bar paint-bar-steps">
        <nav className="tabs paint-steps" aria-label="Peinture">
          {STEPS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={step === item.id ? 'true' : undefined}
              onClick={() => setStep(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        {step === 'couleur' ? colorRow : finishRow}
      </div>
      {step !== 'couleur' && extraRow}
      {step === 'couleur' && linkedNote}
    </div>
  );
}

export function PaintControls() {
  const current = useBuilds((state) => state.current);
  const manifest = resolveVehicle(current);
  if (!manifest) return <p className="paint-note">Aucun véhicule au garage pour l’instant.</p>;
  return <PaintEditor key={manifest.id} manifest={manifest} />;
}
