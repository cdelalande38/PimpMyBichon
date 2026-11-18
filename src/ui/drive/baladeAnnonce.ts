// Annonce « la course devient une balade » (src/ui/drive/Balade.tsx) : textes, durée et règle de
// détection, en un module sans React ni CSS (testé dans tests/unit/balade-annonce.test.ts, relu tel quel
// par les parcours, tests/e2e/balade.spec.ts).
//
// Détection sans toucher à la règle (src/drive/course.ts) : l'état de départ était en course à la
// dernière image et ne l'est plus alors que la route roule (`parti`) : le pilote automatique a ramené
// le nombre de tours à courir à 0. Un départ réarmé (« Repartir », nouveau véhicule) repasse par
// `attente` et n'en déclenche aucune ; l'aperçu n'est jamais une course.

import { enCourse, type EtatDepart } from '../../drive/depart.ts';

/** Durée de l'annonce, en secondes de chrono de sortie. */
export const BALADE_MONTREE = 7;

/** Ce que dit l'annonce (aussi lue par les lecteurs d'écran). */
export const MESSAGE_BALADE = 'Pilote automatique : la course est finie pour cette sortie. Tu roules en balade, sans gain.';

/** Phrase courte, sous la commande « Pilote automatique » des réglages, pendant une course. */
export const PREVENIR_BALADE = 'La course s’arrête : tu finis en balade, sans gain';

/** Ce que l'écran a déjà vu : la course était vivante à la dernière image ; chrono (ms) de l'annonce, -1 sinon. */
export interface VuBalade {
  course: boolean;
  depuis: number;
}

export function createVuBalade(): VuBalade {
  return { course: false, depuis: -1 };
}

/** Une image de plus : `annoncer` (poser le message), `effacer` (le retirer), ou `rien`. Aucune allocation. */
export function pasBalade(vu: VuBalade, etat: EtatDepart): 'annoncer' | 'effacer' | 'rien' {
  let acte: 'annoncer' | 'effacer' | 'rien' = 'rien';
  if (vu.course && !enCourse(etat) && etat.phase === 'parti') {
    vu.depuis = etat.chrono;
    acte = 'annoncer';
  } else if (vu.depuis >= 0 && (etat.phase !== 'parti' || etat.chrono < vu.depuis || etat.chrono - vu.depuis >= BALADE_MONTREE * 1000)) {
    vu.depuis = -1;
    acte = 'effacer';
  }
  vu.course = enCourse(etat) && etat.phase !== 'arrive';
  return acte;
}
