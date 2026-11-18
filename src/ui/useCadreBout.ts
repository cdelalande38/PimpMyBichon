// Cadrage d'un bout du véhicule pendant qu'un panneau est ouvert (Custom › Phares : l'avant ou l'arrière ;
// Mécanique › Échappement : l'arrière, ses sorties) : la caméra du garage le montre de face, au-dessus du
// menu (src/data/framings.ts, cadreBout ; src/scene/cadrageZone.ts, comme le panneau des stickers), et
// revient à la vue d'atelier quand le panneau se ferme. On le regarde de dehors : la vue intérieure se
// referme. Le gabarit vient de la scène une fois le modèle posé (src/scene/vehicle/gabarit.ts). L'orbite
// au doigt reste libre.

import { useEffect, useLayoutEffect, type RefObject } from 'react';
import { cadreBout, type CoteVehicule } from '../data/framings.ts';
import { useZoneFocus } from '../scene/cadrageZone.ts';
import { useGabarit } from '../scene/vehicle/gabarit.ts';
import { useView } from '../state/view.ts';

/** `cote` : le bout à cadrer, `null` pour aucun ; `zone` : son nom pour la scène (data-cadrage). */
export function useCadreBout(root: RefObject<HTMLElement | null>, vehicle: string, cote: CoteVehicule | null, zone: string): void {
  const gabarit = useGabarit((state) => (state.vehicle === vehicle ? state.gabarit : null));
  const cle = gabarit && cote ? JSON.stringify(cadreBout(cote, gabarit)) : '';
  useEffect(() => {
    const box = cle ? (JSON.parse(cle) as ReturnType<typeof cadreBout>) : null;
    useZoneFocus.getState().setFocus(box ? { vehicle, zone, box } : null);
  }, [vehicle, zone, cle]);
  const cadre = cote !== null;
  useEffect(() => {
    if (!cadre) return undefined;
    useView.getState().setMode('atelier');
    return () => {
      useZoneFocus.getState().setFocus(null);
      useZoneFocus.getState().setCoverTop(null);
    };
  }, [cadre]);
  // Haut du menu à l'écran : le bout du véhicule se cadre au-dessus.
  useLayoutEffect(() => {
    if (!cadre) return undefined;
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
  }, [cadre, root]);
}
