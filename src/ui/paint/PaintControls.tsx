// Onglet « Peinture » du dock (§ 5.2) : trois gestes d'un pouce. La zone (puces, zone maîtresse
// d'abord, petit cadenas sur chaque autre zone de carrosserie), la couleur (palette « Bichon »,
// dernières couleurs, nuancier) et la finition (avec la taille de paillette et la seconde teinte).
// Cadenas fermé : la zone suit la carrosserie, ses choix sont grisés et ne changent rien ; un appui
// dit pourquoi et propose de l'ouvrir. Tout part des données : zones du manifeste,
// src/data/paintColors.ts, src/data/finishes.ts. Dock agrandi : couleurs et finitions ensemble.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { finish as findFinish, FINISHES } from '../../data/finishes.ts';
import { PAINT_COLORS } from '../../data/paintColors.ts';
import { resolveVehicle } from '../../data/vehicles.ts';
import type { Hex, Paint, VehicleManifest } from '../../data/vehicleTypes.ts';
import { FLAKE_RANGE, isLinked, resolvePaints, useBuilds } from '../../state/builds.ts';
import { useDock, type PaintStep, type PickerTarget } from '../../state/dock.ts';
import { useRevealPressed } from '../scroll.ts';
import { ColorPicker } from './ColorPicker.tsx';
import { Padlock } from './Padlock.tsx';
import {
  canLink,
  color2Value,
  flakeValue,
  formatMillimeters,
  hasColor2,
  hasFlake,
  LOCK_MESSAGE,
  LOCK_MESSAGE_MS,
  lockLabel,
  lockState,
  orderedZones,
  paintTarget,
  pickableColors,
} from './paintLogic.ts';
import './paint.css';

type Step = PaintStep;

const STEPS: ReadonlyArray<{ id: Step; label: string }> = [
  { id: 'couleur', label: 'Couleur' },
  { id: 'finition', label: 'Finition' },
];

/**
 * Message d'un appui sur une peinture verrouillée : posé au-dessus du dock (il n'ajoute aucune
 * hauteur au menu), non bloquant, lu par les lecteurs d'écran. Il s'efface seul, ou au choix suivant.
 * `token` : 0, rien ; toute autre valeur, un nouvel appui (le compte à rebours repart).
 */
function LockNotice({ token, onOpen, onDone }: { token: number; onOpen: () => void; onDone: () => void }) {
  const [bottom, setBottom] = useState<number | null>(null);
  useEffect(() => {
    if (!token) return;
    const timer = window.setTimeout(onDone, LOCK_MESSAGE_MS);
    return () => window.clearTimeout(timer);
  }, [token, onDone]);
  // Bord haut du dock, relevé à l'apparition : le message se pose juste au-dessus, sur la scène.
  const anchor = (element: HTMLDivElement | null) => {
    const dock = element?.closest('footer');
    if (!dock) return;
    const next = Math.round(window.innerHeight - dock.getBoundingClientRect().top + 8);
    if (next !== bottom) setBottom(next);
  };
  return (
    <div ref={anchor} className="paint-notice-live" role="status" aria-live="polite">
      {token > 0 && (
        <div key={token} className="paint-notice" style={bottom === null ? undefined : { bottom }}>
          <Padlock open={false} />
          <p>{LOCK_MESSAGE}</p>
          <button type="button" className="btn paint-notice-open" onClick={onOpen}>
            Ouvrir le cadenas
          </button>
        </div>
      )}
    </div>
  );
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
  // Niveaux dans la pile du dock (src/state/dock.ts) : liste des zones, puis une zone (couleur ou
  // finition), puis le nuancier. « Retour » (fil du dock, ou Échap) remonte d'un niveau.
  const levels = useDock((state) => state.levels);
  const lastZone = useDock((state) => state.zone);
  const push = useDock((state) => state.push);
  const replace = useDock((state) => state.replace);
  const back = useDock((state) => state.back);
  const first = levels[0];
  // Changement de véhicule : la zone de la pile peut ne plus exister, on retombe sur la liste.
  const zoneLevel = first?.kind === 'zone' && zones.some((zone) => zone.id === first.zone) ? first : null;
  const second = levels[1];
  const zoneId = zoneLevel?.zone ?? (zones.some((zone) => zone.id === lastZone) ? lastZone : null) ?? zones[0]?.id ?? '';
  const step: Step = zoneLevel?.step ?? 'couleur';
  const setStep = (next: Step) => replace({ kind: 'zone', zone: zoneId, step: next });

  const paints = useMemo(() => resolvePaints(manifest, build), [manifest, build]);
  const paint: Paint | undefined = paints[zoneId];
  const zone = manifest.zones.find((item) => item.id === zoneId);
  const lock = lockState(manifest, build, zoneId);
  const locked = lock === 'ferme';
  const target = paintTarget(manifest, build, zoneId);
  const finish = paint ? findFinish(paint.finish) : undefined;
  // Une zone verrouillée n'ouvre pas le nuancier (il n'y reste pas si elle se referme).
  const picker: PickerTarget | null = zoneLevel && second?.kind === 'nuancier' && !locked ? second.target : null;
  const setPicker = (target: PickerTarget | null) => {
    if (target) push({ kind: 'nuancier', target });
    else if (picker) back();
  };

  // Message du cadenas : un compteur, pour qu'un nouvel appui relance son compte à rebours.
  const [notice, setNotice] = useState(0);
  const [noticeZone, setNoticeZone] = useState(zoneId);
  if (noticeZone !== zoneId) {
    // Autre zone : le message de la précédente n'a plus lieu d'être.
    setNoticeZone(zoneId);
    setNotice(0);
  }
  const hideNotice = useCallback(() => setNotice(0), []);

  const zoneRow = useRevealPressed<HTMLDivElement>(`${vehicle}-${zoneId}`);
  const choiceRow = useRevealPressed<HTMLDivElement>(`${wide}-${step}-${paint?.color}-${paint?.finish}`);

  if (!zone || !paint || !finish) {
    return <p className="paint-note">Ce véhicule n’a pas de zone à peindre.</p>;
  }

  /** Geste sur une peinture : verrouillée, le message ; sinon le choix, et le message s'efface. */
  const choose = (apply: () => void) => () => {
    if (locked) {
      setNotice((count) => count + 1);
      return;
    }
    setNotice(0);
    apply();
  };
  const putColor = (hex: Hex, field: PickerTarget = 'color') => setPaint(vehicle, target, { [field]: hex });
  const chooseColor = (hex: Hex) =>
    choose(() => {
      putColor(hex);
      rememberColor(hex);
    });
  // Ouvrir garde l'image telle quelle : la peinture du moment (celle de la carrosserie) devient
  // celle de la zone. Refermer rend la zone à la carrosserie.
  const toggleZoneLock = (id: string, seed: Paint | undefined) => setLinked(vehicle, id, !isLinked(manifest, build, id), seed);
  const toggleLock = () => {
    setNotice(0);
    toggleZoneLock(zoneId, paint);
  };
  const disabled = locked ? { 'aria-disabled': true as const } : {};

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

  // Liste des zones (haut de l'onglet) : une zone choisie fait descendre d'un niveau. Chaque zone
  // de carrosserie autre que la maîtresse porte son cadenas, à droite de la puce.
  const zonesBar = (
    <div className="paint-bar">
      <div ref={zoneRow} className="chips paint-zones" role="group" aria-label="Zones">
        {zones.map((item) => {
          const itemPaint = paints[item.id];
          const chip = (
            <button
              key={item.id}
              type="button"
              className="chip chip-swatch paint-zone"
              aria-pressed={item.id === zoneId}
              onClick={() => push({ kind: 'zone', zone: item.id, step: 'couleur' })}
            >
              {itemPaint && <span className="swatch" aria-hidden="true" style={{ background: itemPaint.color }} />}
              <b>{item.label}</b>
            </button>
          );
          if (!canLink(manifest, item.id)) return chip;
          const state = isLinked(manifest, build, item.id) ? 'ferme' : 'ouvert';
          return (
            <span key={item.id} className="paint-zone-pair">
              {chip}
              <button
                type="button"
                className="paint-lock"
                data-cadenas={state}
                aria-label={lockLabel(item.label, state)}
                title={state === 'ferme' ? 'Suit la carrosserie' : 'Peinture à part'}
                onClick={() => toggleZoneLock(item.id, itemPaint)}
              >
                <Padlock open={state === 'ouvert'} />
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );

  // Ligne du cadenas d'une zone de carrosserie : fermé, le rappel « Suit la carrosserie » reste en
  // vue pendant qu'on fait défiler les peintures (collé en haut du dock agrandi) ; ouvert, de quoi
  // refermer. Pas de ligne pour la zone maîtresse ni pour l'accastillage.
  const lockLine = lock !== 'aucun' && (
    <div className="paint-lockline" data-cadenas={lock}>
      <Padlock open={!locked} />
      <span className="paint-lockline-text">{locked ? 'Suit la carrosserie' : 'Peinture à part'}</span>
      <button type="button" className="btn paint-lockline-btn" aria-label={lockLabel(zone.label, lock)} onClick={toggleLock}>
        {locked ? 'Ouvrir le cadenas' : 'Refermer'}
      </button>
    </div>
  );

  // Dock compact : le cadenas à droite des choix, sur la hauteur de la rangée et du rappel, pour ne
  // pas ajouter de ligne de 48 px au tiers bas. Fermé, « Ouvrir » ; ouvert, « Refermer ».
  const lockButton = lock !== 'aucun' && (
    <button type="button" className="paint-lockbtn" data-cadenas={lock} aria-label={lockLabel(zone.label, lock)} onClick={toggleLock}>
      <Padlock open={!locked} />
      <span aria-hidden="true">{locked ? 'Ouvrir' : 'Refermer'}</span>
    </button>
  );
  // Rappel sous les choix, dans les deux états : la hauteur du dock ne saute pas au cadenas.
  const reminder = lock !== 'aucun' && (
    <p className="paint-reminder" data-cadenas={lock}>
      <Padlock open={!locked} />
      {locked ? 'Suit la carrosserie' : 'Peinture à part'}
    </p>
  );

  const colorRow = (
    <div ref={wide || step === 'couleur' ? choiceRow : undefined} className="chips paint-colors" role="group" aria-label="Couleurs">
      <button type="button" className="paint-dot paint-other" {...disabled} onClick={choose(() => setPicker('color'))}>
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
          {...disabled}
          onClick={chooseColor(color.hex)}
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
          {...disabled}
          onClick={chooseColor(hex)}
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
          {...disabled}
          // Nouvelle finition : sa taille de paillette d'origine revient ; la seconde teinte reste.
          onClick={choose(() => setPaint(vehicle, target, { finish: item.id, flake: undefined }))}
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
            {...disabled}
            // Verrouillé : le curseur reste où il est (valeur contrôlée), le message s'affiche.
            onPointerDown={locked ? () => setNotice((count) => count + 1) : undefined}
            onChange={(event) => {
              const value = Number(event.target.value);
              choose(() => setPaint(vehicle, target, { flake: value }))();
            }}
          />
          <output>{formatMillimeters(flakeValue(paint.finish, paint.flake))}</output>
        </label>
      )}
      {hasColor2(finish) && (
        <button type="button" className="btn paint-color2" {...disabled} onClick={choose(() => setPicker('color2'))}>
          <span className="swatch" aria-hidden="true" style={{ background: color2Value(paint.color, paint.finish, paint.color2) }} />
          Seconde teinte
        </button>
      )}
    </div>
  );

  const noticeEl = <LockNotice token={locked ? notice : 0} onOpen={toggleLock} onDone={hideNotice} />;
  const rootClass = ['paint', wide && 'paint-wide', locked && 'paint-locked'].filter(Boolean).join(' ');

  if (!zoneLevel) {
    return <div className={wide ? 'paint paint-wide' : 'paint'}>{zonesBar}</div>;
  }
  if (wide) {
    // Dock agrandi : le cadenas (collé en haut), les couleurs, puis les finitions de la zone.
    return (
      <div className={rootClass}>
        {lockLine}
        <section className="paint-section" aria-labelledby={`${vehicle}-couleur`}>
          <h3 id={`${vehicle}-couleur`} className="paint-head">
            Couleur
          </h3>
          {colorRow}
        </section>
        <section className="paint-section" aria-labelledby={`${vehicle}-finition`}>
          <h3 id={`${vehicle}-finition`} className="paint-head">
            Finition
          </h3>
          {finishRow}
          {extraRow}
        </section>
        {noticeEl}
      </div>
    );
  }

  return (
    <div className={rootClass}>
      {/* Une rangée sous les onglets (tiers bas, § 2) : étapes et choix ; cadenas et rappel. */}
      <div className="paint-frame">
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
        {reminder}
        {lockButton}
      </div>
      {step !== 'couleur' && extraRow}
      {noticeEl}
    </div>
  );
}

export function PaintControls() {
  const current = useBuilds((state) => state.current);
  const manifest = resolveVehicle(current);
  if (!manifest) return <p className="paint-note">Aucun véhicule au garage pour l’instant.</p>;
  return <PaintEditor key={manifest.id} manifest={manifest} />;
}
