// Écran de fin d'une course, branché sur la sortie (src/state/drive.ts, `fin`) : par-dessus la scène,
// où le pilote automatique fait un tour d'honneur. « Rejouer » (et « Retenter ») : mêmes réglages, retour sur
// la ligne, aux feux ; « Course suivante » (carrière) : le rendez-vous suivant, la scène rechargée sur sa carte
// (src/ui/carriere/actions.ts, `enchainerRendezVous`) ; « Rentrer au garage ». La vue est dans FinCourseVue.tsx.
//
// Les gains y arrivent un par un, chacun avec son son d'interface (vague U) ; « moins de mouvement »
// (réglage du téléphone) : l'écran complet d'emblée et un seul son. Pour les parcours, le voile porte le
// décompte des sons demandés au lecteur (data-sons-demandes) et de ceux qui sont réellement partis
// (data-sons-joues), depuis l'ouverture de la page, et le dernier demandé (data-son-dernier).

import { useEffect } from 'react';
import { closeSheet } from '../../app/useRoute.ts';
import { useMediaQuery } from '../../app/useMediaQuery.ts';
import { jouerSonInterface, sonsInterface, useSonsInterface } from '../../audio/sfx/interface.ts';
import { useDrive } from '../../state/drive.ts';
import { enchainerRendezVous } from '../carriere/actions.ts';
import { FinCourseVue } from './FinCourseVue.tsx';
import './fincourse.css';

export function FinCourse() {
  const fin = useDrive((state) => state.fin);
  const commencer = useDrive((state) => state.commencer);
  const reduit = useMediaQuery('(prefers-reduced-motion: reduce)');
  const demandes = useSonsInterface((state) => state.demandes);
  const joues = useSonsInterface((state) => state.joues);
  const dernier = useSonsInterface((state) => state.dernier);
  const present = fin !== null;
  // Les prises se chargent dès l'arrivée : le premier son part à l'heure, pas après le décodage.
  useEffect(() => {
    if (present) sonsInterface.precharger();
  }, [present]);
  if (!fin) return null;
  return (
    <div className="drive-veil fin-course-voile" data-sons-demandes={demandes} data-sons-joues={joues} data-son-dernier={dernier ?? undefined}>
      <FinCourseVue bilan={fin} onRejouer={commencer} onGarage={closeSheet} onCourseSuivante={enchainerRendezVous} anime={!reduit} onSon={jouerSonInterface} />
    </div>
  );
}
