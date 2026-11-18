// Le son du moteur suit la ligne d'échappement du véhicule à l'écran (src/audio/engine/echappement.ts) :
// au chargement de l'app, puis à chaque changement de véhicule, de ligne ou de sauvegarde relue. Branché
// une fois, par le panneau Échappement (chargé avec le dock) et par les flammes de la sortie.

import { choisirSonEchappement } from '../../audio/engine/echappement.ts';
import { ligneDe } from '../../data/echappement.ts';
import { resolveVehicle } from '../../data/vehicles.ts';
import { useBuilds } from '../../state/builds.ts';

/** Ligne montée sur le véhicule à l'écran. */
export function ligneCourante(): string {
  const state = useBuilds.getState();
  return ligneDe(state.builds[resolveVehicle(state.current).id]).id;
}

let branche = false;

/** Branche le suivi (une seule fois). */
export function suivreLigneEchappement(): void {
  if (branche) return;
  branche = true;
  choisirSonEchappement(ligneCourante());
  useBuilds.subscribe((state, previous) => {
    if (state.current !== previous.current || state.builds !== previous.builds) choisirSonEchappement(ligneCourante());
  });
}

suivreLigneEchappement();
