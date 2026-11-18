// Écran de fin d'une course, branché sur la sortie (src/state/drive.ts, `fin`) : par-dessus la scène,
// où le pilote automatique fait un tour d'honneur. « Rejouer » : mêmes réglages, retour sur la ligne,
// aux feux ; « Rentrer au garage ». La vue est dans FinCourseVue.tsx.

import { closeSheet } from '../../app/useRoute.ts';
import { useDrive } from '../../state/drive.ts';
import { FinCourseVue } from './FinCourseVue.tsx';
import './fincourse.css';

export function FinCourse() {
  const fin = useDrive((state) => state.fin);
  const commencer = useDrive((state) => state.commencer);
  if (!fin) return null;
  return (
    <div className="drive-veil fin-course-voile">
      <FinCourseVue bilan={fin} onRejouer={commencer} onGarage={closeSheet} />
    </div>
  );
}
