// Entrée qui réunit plusieurs postes de pièces montées (Custom · Carrosserie : lame avant, jupes,
// diffuseur), tirée des données : le groupe du catalogue des pièces (src/data/pieces.ts), les postes que
// le manifeste du véhicule déclare. Une rangée de postes (le choisi, puis ce qui y est posé), et sous
// elle le panneau du poste (PiecesPanel : options, cadenas et achat, couleur propre). Tant que l'entrée
// est ouverte, la caméra du garage cadre le poste choisi (avant, flanc, arrière : src/scene/
// cadrageZone.ts) au-dessus du menu, puis revient à la vue d'avant. Un véhicule sans aucun poste du
// groupe (une moto) le dit, comme Ailerons.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { groupeById, isRailMount, mountOf, postesDuGroupe, railZone, resolvePiece } from '../../data/pieces.ts';
import { resolveVehicle } from '../../data/vehicles.ts';
import { useZoneFocus } from '../../scene/cadrageZone.ts';
import { useBuilds } from '../../state/builds.ts';
import { useView } from '../../state/view.ts';
import { PiecesPanel } from './PiecesPanel.tsx';
import './pieces.css';

export function PiecesGroupe({ groupe: groupeId }: { groupe: string }) {
  const vehicle = resolveVehicle(useBuilds((state) => state.current));
  const build = useBuilds((state) => state.builds[vehicle.id]);
  const [choix, setChoix] = useState<{ vehicle: string; poste: string } | null>(null);
  const groupe = groupeById(groupeId);
  const postes = postesDuGroupe(groupeId).filter((poste) => mountOf(vehicle, poste.id) !== undefined);
  const poste = postes.find((item) => choix?.vehicle === vehicle.id && item.id === choix.poste) ?? postes[0];
  const mount = poste ? mountOf(vehicle, poste.id) : undefined;

  // Cadrage du poste choisi ; on regarde la caisse de dehors (la vue intérieure se referme).
  const root = useRef<HTMLDivElement>(null);
  const cadre = poste && mount && isRailMount(mount) ? railZone(mount, poste.mirror === true) : null;
  const cadreCle = cadre ? JSON.stringify(cadre) : '';
  useEffect(() => {
    const box = cadreCle ? (JSON.parse(cadreCle) as NonNullable<typeof cadre>) : null;
    useZoneFocus.getState().setFocus(box && poste ? { vehicle: vehicle.id, zone: `piece-${poste.id}`, box } : null);
  }, [vehicle.id, poste, cadreCle]);
  useEffect(() => {
    useView.getState().setMode('atelier');
    return () => {
      useZoneFocus.getState().setFocus(null);
      useZoneFocus.getState().setCoverTop(null);
    };
  }, []);
  // Haut du menu à l'écran : le poste se cadre au-dessus.
  useLayoutEffect(() => {
    const dock = root.current?.closest<HTMLElement>('footer.dock') ?? root.current;
    if (!dock) return undefined;
    const measure = () => useZoneFocus.getState().setCoverTop(Math.round(dock.getBoundingClientRect().top));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(dock);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  if (!groupe) return null;
  if (!poste) {
    return (
      <div ref={root} className="pieces" data-testid="pieces" data-groupe={groupeId}>
        <p className="pieces-empty">{`${vehicle.name} ${groupe.absent}`}</p>
      </div>
    );
  }
  return (
    <div ref={root} className="pieces-groupe" data-testid="pieces-groupe" data-groupe={groupeId} data-poste={poste.id}>
      <div className="pieces-postes" role="group" aria-label={groupe.label}>
        {postes.map((item) => {
          const pose = resolvePiece(vehicle, build, item.id);
          return (
            <button key={item.id} type="button" className="pieces-poste" data-poste={item.id} aria-pressed={item.id === poste.id} onClick={() => setChoix({ vehicle: vehicle.id, poste: item.id })}>
              <b>{item.label}</b>
              <small>{pose?.option?.label ?? item.none.label}</small>
            </button>
          );
        })}
      </div>
      <PiecesPanel key={`${vehicle.id}/${poste.id}`} poste={poste.id} />
    </div>
  );
}
