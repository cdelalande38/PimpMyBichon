// Entrée qui réunit plusieurs postes de pièces montées (Custom · Carrosserie : lame avant, jupes,
// diffuseur), tirée des données : le groupe du catalogue des pièces (src/data/pieces.ts), les postes que
// le manifeste du véhicule déclare. Deux étapes qui se remplacent (retour du 18 novembre 2026 : « comme
// pour la carrosserie il faut séparer la sélection des éléments des actions à mener dessus ») :
// 1. « Élément » : la liste des postes, chacun avec ce qui y est posé ; le véhicule entier à l'écran ;
// 2. le poste choisi : son panneau (PiecesPanel : options, cadenas et achat, couleur propre, « D'origine »),
//    et la caméra du garage le cadre (avant, flanc, arrière : src/scene/cadrageZone.ts) au-dessus du menu.
// L'étape est un niveau du dock (src/state/dock.ts, `element`) : « Retour » rend la liste et la vue
// d'avant, le fil dit « Custom · Carrosserie · Jupes ». Un véhicule sans aucun poste du groupe (une
// moto) le dit, comme Ailerons.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { groupeById, isRailMount, mountOf, postesDuGroupe, railZone, resolvePiece } from '../../data/pieces.ts';
import { resolveVehicle } from '../../data/vehicles.ts';
import { useZoneFocus } from '../../scene/cadrageZone.ts';
import { useBuilds } from '../../state/builds.ts';
import { useDock } from '../../state/dock.ts';
import { useView } from '../../state/view.ts';
import { useRevealPressed } from '../scroll.ts';
import { PiecesPanel } from './PiecesPanel.tsx';
import './pieces.css';

export function PiecesGroupe({ groupe: groupeId }: { groupe: string }) {
  const vehicle = resolveVehicle(useBuilds((state) => state.current));
  const build = useBuilds((state) => state.builds[vehicle.id]);
  const top = useDock((state) => state.levels.at(-1));
  const groupe = groupeById(groupeId);
  const postes = postesDuGroupe(groupeId).filter((poste) => mountOf(vehicle, poste.id) !== undefined);
  // Étape du poste : celui du niveau `element` du dock ; un poste que ce véhicule n'a pas rend la liste.
  const poste = top?.kind === 'element' ? postes.find((item) => item.id === top.element) : undefined;
  const perdu = top?.kind === 'element' && !poste;
  useEffect(() => {
    if (perdu) useDock.getState().back();
  }, [perdu]);
  // Le dernier poste ouvert reste marqué dans la liste, au retour.
  const [dernier, setDernier] = useState<string | null>(null);
  const row = useRevealPressed<HTMLDivElement>(poste ? '' : (dernier ?? ''));
  const mount = poste ? mountOf(vehicle, poste.id) : undefined;

  // Cadrage du poste ouvert ; à la liste, la vue d'avant. On regarde la caisse de dehors.
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
  if (postes.length === 0) {
    return (
      <div ref={root} className="pieces" data-testid="pieces" data-groupe={groupeId}>
        <p className="pieces-empty">{`${vehicle.name} ${groupe.absent}`}</p>
      </div>
    );
  }
  if (poste) {
    return (
      <div ref={root} className="pieces-groupe" data-testid="pieces-groupe" data-groupe={groupeId} data-etape="element" data-poste={poste.id}>
        <PiecesPanel key={`${vehicle.id}/${poste.id}`} poste={poste.id} />
      </div>
    );
  }
  return (
    <div ref={root} className="pieces-groupe" data-testid="pieces-groupe" data-groupe={groupeId} data-etape="liste">
      <div ref={row} className="pieces-postes" role="group" aria-label={groupe.label}>
        {postes.map((item) => {
          const pose = resolvePiece(vehicle, build, item.id);
          return (
            <button
              key={item.id}
              type="button"
              className="pieces-poste"
              data-poste={item.id}
              aria-pressed={item.id === dernier}
              onClick={() => {
                setDernier(item.id);
                useDock.getState().push({ kind: 'element', element: item.id, libelle: item.label });
              }}
            >
              <b>{item.label}</b>
              <small>{pose?.option?.label ?? item.none.label}</small>
            </button>
          );
        })}
      </div>
    </div>
  );
}
