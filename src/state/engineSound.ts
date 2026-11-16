// État du son du moteur (§ 5.8, § 9) : un seul lecteur pour l'app, jamais sauvegardé. Les
// commandes de Mécanique · Préparation (src/ui/engine/EngineSoundControls.tsx) démarrent, font
// monter et coupent le moteur du véhicule à l'écran ; une autre scène (la sortie de nuit) le pilote
// en régime et en charge par `piloter`. Le moteur se coupe sans bruit si l'on change de véhicule
// ou si la page passe en arrière-plan.

import { create } from 'zustand';
import { hasEngineSounds } from '../audio/engine/manifeste.ts';
import { EngineSoundPlayer, type EngineState } from '../audio/engine/lecteur.ts';
import type { VehicleManifest } from '../data/vehicleTypes.ts';
import { resolveVehicle } from '../data/vehicles.ts';
import { useBuilds } from './builds.ts';

export type { EngineState };

export interface EngineSoundStore {
  state: EngineState;
  /** Famille du jeu qui tourne (ou qui démarre), sinon null. */
  famille: string | null;
  /** Dernier démarrage impossible : sons absents du téléphone et réseau coupé. */
  echec: boolean;
  demarrer: () => void;
  /** Coup de gaz : appui (vrai), relâche (faux). */
  gaz: (on: boolean) => void;
  couper: () => void;
  /** Coupe sans jouer la coupure enregistrée. */
  couperNet: () => void;
  /**
   * Pilotage depuis une autre scène : régime en tr/min, charge de 0 à 1 ; `null` rend la main au
   * garage. Sans effet moteur coupé.
   */
  piloter: (regime: number | null, charge?: number) => void;
  /** Plage de régime jouable du jeu chargé (ralenti, plus haute boucle + 25 %), ou null. */
  plage: () => { min: number; max: number } | null;
}

/** Famille de sons d'un véhicule, si des sons ont été fabriqués pour elle. */
export function soundFamilyOf(vehicle: VehicleManifest | null | undefined): string | null {
  const family = vehicle?.engine?.sound;
  return hasEngineSounds(family) ? family : null;
}

let player: EngineSoundPlayer | null = null;

function getPlayer(): EngineSoundPlayer {
  player ??= new EngineSoundPlayer((state) => useEngineSound.setState(state === 'coupe' ? { state, famille: null } : { state }));
  return player;
}

export const useEngineSound = create<EngineSoundStore>()((set, get) => ({
  state: 'coupe',
  famille: null,
  echec: false,
  demarrer: () => {
    if (get().state !== 'coupe') return;
    const famille = soundFamilyOf(resolveVehicle(useBuilds.getState().current));
    if (!famille) return;
    set({ famille, echec: false });
    void getPlayer()
      .start(famille)
      .then((result) => {
        if (result === 'echec') set({ echec: true, famille: null });
      });
  },
  gaz: (on) => player?.throttle(on),
  couper: () => player?.stop(true),
  couperNet: () => player?.stop(false),
  piloter: (regime, charge = 0.5) => player?.drive(regime, charge),
  plage: () => player?.range ?? null,
}));

// Changer de véhicule coupe le moteur, sans bruit.
useBuilds.subscribe((state, previous) => {
  if (state.current !== previous.current) useEngineSound.getState().couperNet();
});

// Page en arrière-plan (autre appli, écran verrouillé) : on coupe, rien ne tourne.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') useEngineSound.getState().couperNet();
  });
}
