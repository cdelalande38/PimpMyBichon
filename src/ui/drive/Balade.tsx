// Annonce « la course devient une balade » (vague U, demande du 18 novembre 2026) : quand le pilote
// automatique prend le volant pendant une course (src/drive/course.ts, `SuiviCourse.pas` : le nombre de
// tours à courir tombe à 0), plus d'arrivée, plus de résultat, plus de gain. Rien ne le disait ; ce petit
// message, sur la route, le dit une fois, puis s'efface seul.
//
// - Détecté sans toucher à la règle : l'état de départ (`liveDepart`) passait en course (`enCourse`) à la
//   dernière image et n'y est plus alors que la route roule (`parti`). Un départ rearmé (« Repartir »,
//   changement de véhicule) repasse par `attente` et n'en déclenche aucun.
// - Écrit à chaque image par la boucle commune (aucun rendu React par image) ; le texte n'est posé qu'à
//   l'instant de l'annonce, ce qui la fait lire par un lecteur d'écran (`role="status"`, poli).
// - Temps de route, pas d'horloge : le message dure `BALADE_MONTREE` s de chrono de sortie (il reste donc
//   lisible tant que la sortie est en pause) ; sans mouvement, il apparaît et disparaît sans fondu.
// - Avant l'annonce : la commande « Pilote automatique » des réglages prévient déjà (Reglages.tsx).

import { useRef } from 'react';
import { liveDepart } from '../../state/drive.ts';
import { createVuBalade, MESSAGE_BALADE, pasBalade } from './baladeAnnonce.ts';
import { useBoucleImage } from './CompteTours.tsx';
import './balade.css';

export function AnnonceBalade() {
  const root = useRef<HTMLParagraphElement>(null);
  const vu = useRef(createVuBalade());

  useBoucleImage(() => {
    const etat = liveDepart.current;
    const el = root.current;
    if (!etat || !el) return;
    const acte = pasBalade(vu.current, etat);
    if (acte === 'annoncer') {
      el.textContent = MESSAGE_BALADE;
      el.dataset.visible = 'oui';
    } else if (acte === 'effacer') {
      el.textContent = '';
      el.dataset.visible = 'non';
    }
  });

  return <p ref={root} className="drive-balade-annonce" role="status" aria-live="polite" aria-atomic="true" data-visible="non" />;
}
