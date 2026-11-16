// Choix de la place en vue intérieure (demande du 16 novembre 2026 : « se placer à la place
// conducteur, passager ou arrière… c'est le menu qui va pas surtout ») : une commande nommée par
// place du manifeste (src/data/vehicles.ts, placesOf), plus « Sortir », en une rangée au pouce, posée
// juste au-dessus du dock (compact ou agrandi) : elle ne recouvre ni le dock ni les raccourcis. La
// place choisie à la main est gardée pour ce véhicule (src/state/view.ts).

import { useLayoutEffect, useState } from 'react';
import { placeOf, placesOf, resolveVehicle } from '../data/vehicles.ts';
import { useBuilds } from '../state/builds.ts';
import { useDock } from '../state/dock.ts';
import { useView } from '../state/view.ts';
import './places.css';

/** Écart entre la rangée et le haut du dock, en pixels CSS. */
const GAP = 8;

/** Distance du bas de l'écran au haut du dock (0 sans dock), suivie quand le dock change de taille. */
function useDockClearance(active: boolean): number {
  const [clearance, setClearance] = useState(0);
  const expanded = useDock((state) => state.expanded);
  const closed = useDock((state) => state.closed);
  const menu = useDock((state) => state.menu);
  useLayoutEffect(() => {
    if (!active) return undefined;
    const dock = document.querySelector<HTMLElement>('footer.dock');
    const measure = () => {
      const top = dock?.getBoundingClientRect().top;
      setClearance(top === undefined ? 0 : Math.max(0, Math.round(window.innerHeight - top)));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' || !dock ? null : new ResizeObserver(measure);
    if (dock) observer?.observe(dock);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [active, expanded, closed, menu]);
  return clearance;
}

export function PlacePicker({ covered = false }: { covered?: boolean }) {
  const vehicle = resolveVehicle(useBuilds((state) => state.current));
  const inside = useView((state) => state.mode === 'interieur');
  const current = placeOf(vehicle, useView((state) => state.place));
  const sit = useView((state) => state.sit);
  const setMode = useView((state) => state.setMode);
  const places = placesOf(vehicle);
  const shown = inside && places.length > 0 && !covered;
  const clearance = useDockClearance(shown);
  if (!shown) return null;
  return (
    <div className="places" role="group" aria-label="Ta place dans le véhicule" style={{ bottom: `${clearance + GAP}px` }}>
      {places.map((place) => (
        <button key={place.id} type="button" className="place-btn" aria-pressed={current?.id === place.id} data-place={place.id} onClick={() => sit(vehicle.id, place.id)}>
          {place.label}
        </button>
      ))}
      <button type="button" className="place-btn place-sortir" onClick={() => setMode('atelier')}>
        Sortir
      </button>
    </div>
  );
}
