// Entrée « Intérieur » du dock (Custom) : le volant, le pommeau, les sièges avant, le ciel étoilé et les
// LED d'ambiance (zone « habitacle » des néons, mêmes réglages que dans Néons) du véhicule à l'écran. Un vrai
// modèle à l'habitacle d'une pièce (le concept) garde son volant et ses sièges, mais ses teintes (sellerie,
// planche, tapis : zones de peinture du manifeste, `interior.tints`), son ciel et ses LED se règlent ici. Ouvrir l'entrée fait entrer dans la vue intérieure, assis à la place d'où l'on
// voit le mieux le volet ouvert (manifeste, volets : volant et pommeau du conducteur, le regard sur le
// pommeau ; sièges et ciel de l'arrière) ; on change de place à la main au-dessus du dock (PlacePicker). La quitter ramène à
// l'atelier. Quatre volets dans le même cadre, un seul à la fois : le menu garde sa hauteur, chaque
// choix se voit tout de suite. Pièces, teintes et crans viennent des données (src/data/habitacle.ts,
// manifeste) : ajouter un volant ne touche pas à ce fichier. La sellerie se peint dans Peinture.
// Chaque volet porte son icône ; chaque volant, pommeau et siège sa silhouette, tirée de son style
// (src/ui/pictos/) ; chaque densité du ciel, ses étoiles.

import { useEffect, useState, type ReactNode } from 'react';
import {
  INTERIOR_CATALOGUE,
  INTERIOR_SLOTS,
  INTERIOR_SWATCHES,
  interiorKeys,
  interiorMode,
  interiorTints,
  interiorTouched,
  ledHabitacle,
  ledSlot,
  resolveInterior,
  resolveSky,
  SKY_OFF,
  SKY_ON,
  SKY_TUNE,
  type InteriorPiece,
} from '../../data/habitacle.ts';
import { neonZonesOf } from '../../data/neons.ts';
import { placeForVolet, placesOf, resolveVehicle } from '../../data/vehicles.ts';
import type { Hex, PlaceId } from '../../data/vehicleTypes.ts';
import { normalizeHex, resolvePaint, useBuilds } from '../../state/builds.ts';
import { useDock } from '../../state/dock.ts';
import { useView } from '../../state/view.ts';
import { Icon, type IconName } from '../icons.tsx';
import { NEON_REGARD } from '../../scene/vehicle/neons.ts';
import { NeonZoneReglages } from '../neons/NeonsPanel.tsx';
import { PictoEtoiles, PictoPommeau, PictoSiege, PictoVolant } from '../pictos/Pictos.tsx';
import { useRevealPressed } from '../scroll.ts';
import './habitacle.css';

type Volet = 'volant' | 'pommeau' | 'sieges' | 'teintes' | 'ciel' | 'led';

const VOLETS: ReadonlyArray<{ id: Volet; label: string; icon: IconName }> = [
  { id: 'volant', label: 'Volant', icon: 'volant' },
  { id: 'pommeau', label: 'Pommeau', icon: 'pommeau' },
  { id: 'sieges', label: 'Sièges', icon: 'siege' },
  { id: 'teintes', label: 'Teintes', icon: 'bombe' },
  { id: 'ciel', label: 'Ciel', icon: 'etoiles' },
  { id: 'led', label: 'LED', icon: 'neons' },
];

/** Silhouette d'une pièce, selon son style ; null si le style n'a pas de dessin (le mot seul). */
type Silhouette = (props: { style: string }) => ReactNode;

/** Rangée de pièces : une puce par pièce du catalogue, sa silhouette et son nom, la pièce posée cochée. */
function Pieces({
  label,
  pieces,
  current,
  attribute,
  picto: Picto,
  onPick,
}: {
  label: string;
  pieces: readonly InteriorPiece[];
  current: string | undefined;
  attribute: string;
  picto: Silhouette;
  onPick: (id: string) => void;
}) {
  const row = useRevealPressed<HTMLDivElement>(current ?? '');
  return (
    <div ref={row} className="chips" role="group" aria-label={label}>
      {pieces.map((piece) => (
        <button key={piece.id} type="button" className="chip chip-picto" aria-pressed={current === piece.id} {...{ [`data-${attribute}`]: piece.id }} onClick={() => onPick(piece.id)}>
          <Picto style={piece.style} />
          <span className="chip-text">
            <b>{piece.label}</b>
            {piece.hint && <small>{piece.hint}</small>}
          </span>
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
 * La vue intérieure tant que l'entrée est ouverte : on y entre à l'ouverture, à la place qui montre
 * le mieux le volet ouvert, et on y repasse quand on change de volet (pas entre-temps : une place
 * choisie à la main reste) ; on revient à l'atelier en quittant l'entrée (retour, autre entrée,
 * dock fermé). Une place choisie ici n'est pas gardée pour le véhicule : seul le choix à la main l'est.
 */
function useInsideWhileOpen(enabled: boolean, vehicle: string, place: PlaceId, focus: string | null): void {
  useEffect(() => {
    if (!enabled) return undefined;
    return () => useView.getState().setMode('atelier');
  }, [enabled]);
  useEffect(() => {
    if (enabled) useView.getState().sit(vehicle, place, false, focus);
  }, [enabled, vehicle, place, focus]);
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
  const tints = interiorTints(vehicle);
  const led = neonZonesOf(vehicle).find((zone) => zone.habitacle) ?? null;
  const volets = VOLETS.filter(
    (item) =>
      (item.id === 'volant' && interior?.steering) ||
      (item.id === 'pommeau' && interior?.knob) ||
      (item.id === 'sieges' && interior?.seats) ||
      (item.id === 'teintes' && tints.length > 0) ||
      (item.id === 'ciel' && sky) ||
      (item.id === 'led' && led),
  );
  const [chosen, setVolet] = useState<Volet>('volant');
  const volet = volets.find((item) => item.id === chosen)?.id ?? volets[0]?.id;
  const places = placesOf(vehicle);
  // Le pommeau, bas sur la console, sort du champ étroit d'un écran en hauteur : le regard le vise.
  // Les LED : le regard descend sur le pied de la planche, là où leur lueur se pose (NEON_REGARD).
  useInsideWhileOpen(mode !== 'aucun' && places.length > 0, vehicle.id, placeForVolet(places, volet), volet === 'pommeau' ? INTERIOR_CATALOGUE.anchors.knob : volet === 'led' ? NEON_REGARD : null);

  if (mode === 'aucun' || !volet) {
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
  // « D'origine » rend aussi les teintes de l'habitacle d'un vrai modèle et éteint ses LED.
  const keys = interiorKeys();
  const ledPoste = ledSlot(vehicle);
  const reset = () =>
    resetKeys(vehicle.id, {
      parts: [...keys.parts, ...(ledPoste ? [ledPoste] : [])],
      partPaints: [...keys.partPaints, ...(ledPoste ? [ledPoste] : [])],
      tune: [...keys.tune, ...(ledPoste ? [ledPoste] : [])],
      paints: [...(knobZone ? [knobZone] : []), ...tints.map((zone) => zone.id)],
    });
  const touched = interiorTouched(build, knobZone) || ledHabitacle(vehicle, build) !== null || tints.some((zone) => build?.paints[zone.id] !== undefined);

  return (
    <div className="habitacle" data-testid="habitacle">
      <div className="habitacle-head">
        <div className="habitacle-volets" role="group" aria-label="Volets de l’intérieur">
          {volets.map((item) => (
            <button key={item.id} type="button" className="habitacle-volet" aria-pressed={volet === item.id} onClick={() => setVolet(item.id)}>
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <button type="button" className="btn habitacle-reset" disabled={!touched} onClick={reset}>
          <Icon name="origine" />
          <span>D’origine</span>
        </button>
      </div>
      {volet === 'volant' && interior?.steering && (
        <>
          <Pieces
            label="Dessin du volant"
            pieces={INTERIOR_CATALOGUE.steering}
            current={interior.steering.id}
            attribute="volant"
            picto={PictoVolant}
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
            picto={PictoPommeau}
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
            picto={PictoSiege}
            onPick={(id) => setPart(vehicle.id, INTERIOR_SLOTS.seats, id === origin?.seats?.default ? null : id)}
          />
          <p className="habitacle-note">
            <span>{seatZone ? 'Couleur et finition : dans Peinture.' : 'Sellerie en cuir sombre d’origine.'}</span>
            {seatZone && (
              <button type="button" className="btn habitacle-link" onClick={() => openEntry('peinture', seatZone)}>
                Peindre · {seatZoneLabel}
              </button>
            )}
          </p>
        </>
      )}
      {volet === 'teintes' && tints.length > 0 && (
        <>
          <p className="habitacle-note">
            <span>{`${vehicle.name} garde son volant et ses sièges d’origine (un vrai modèle, d’une pièce) ; leurs teintes, elles, se changent dans Peinture.`}</span>
          </p>
          <div className="chips habitacle-teintes" role="group" aria-label="Teintes de l’habitacle">
            {tints.map((zone) => (
              <button key={zone.id} type="button" className="chip chip-swatch" data-teinte-zone={zone.id} onClick={() => openEntry('peinture', zone.id)}>
                <span className="swatch" aria-hidden="true" style={{ background: resolvePaint(vehicle, build, zone.id)?.color ?? '#141416' }} />
                <span className="chip-text">
                  <b>{zone.label}</b>
                  <small>Peindre</small>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      {volet === 'led' && led && <NeonZoneReglages vehicle={vehicle} zone={led} build={build} />}
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
                  <PictoEtoiles facteur={item.factor} />
                  <span>{item.label}</span>
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
