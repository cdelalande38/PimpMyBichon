// État du son du moteur (§ 5.8, § 9) : un seul lecteur pour l'app, jamais sauvegardé. Les
// commandes de Mécanique · Préparation (src/ui/engine/EngineSoundControls.tsx) démarrent, font
// monter et coupent le moteur du véhicule à l'écran ; une autre scène (la sortie de nuit) le pilote
// en régime et en charge par `piloter`, règle son volume par `niveau` et le remet en marche sans
// le démarreur par `reprendre` (src/drive/son.ts). Le moteur se coupe sans bruit si l'on change de
// véhicule ou si la page passe en arrière-plan. Seul le choix « moteur en sortie » est sauvegardé
// (`useEngineSoundPrefs`).

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { hasEngineSounds } from '../audio/engine/manifeste.ts';
import { EngineSoundPlayer, type EngineState } from '../audio/engine/lecteur.ts';
import type { VehicleManifest } from '../data/vehicleTypes.ts';
import { resolveVehicle } from '../data/vehicles.ts';
import { useBuilds } from './builds.ts';
import { idbStorage, shareAcrossTabs } from './persistence.ts';

export type { EngineState };

export interface EngineSoundStore {
  state: EngineState;
  /** Famille du jeu qui tourne (ou qui démarre), sinon null. */
  famille: string | null;
  /** Dernier démarrage impossible : sons absents du téléphone et réseau coupé. */
  echec: boolean;
  demarrer: () => void;
  /** Remet le moteur en marche sans le démarrage enregistré (véhicule déjà lancé, en sortie). */
  reprendre: () => void;
  /** Coup de gaz : appui (vrai), relâche (faux). */
  gaz: (on: boolean) => void;
  couper: () => void;
  /** Coupe sans jouer la coupure enregistrée. */
  couperNet: () => void;
  /**
   * Pilotage depuis une autre scène : régime en tr/min, charge de 0 à 1 ; `null` rend la main au
   * garage. `glisse` : le régime y glisse en tant de secondes (mesures espacées). Sans effet moteur
   * coupé.
   */
  piloter: (regime: number | null, charge?: number, glisse?: number) => void;
  /** Volume d'ensemble du moteur, de 0 à 1 (1 au garage), en rampe : la hauteur ne change pas. */
  niveau: (niveau: number) => void;
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

export const useEngineSound = create<EngineSoundStore>()((set, get) => {
  const lancer = (demarreur: boolean) => {
    if (get().state !== 'coupe') return;
    const famille = soundFamilyOf(resolveVehicle(useBuilds.getState().current));
    if (!famille) return;
    set({ famille, echec: false });
    void getPlayer()
      .start(famille, { demarreur })
      .then((result) => {
        if (result === 'echec') set({ echec: true, famille: null });
      });
  };
  return {
    state: 'coupe',
    famille: null,
    echec: false,
    demarrer: () => lancer(true),
    reprendre: () => lancer(false),
    gaz: (on) => player?.throttle(on),
    couper: () => player?.stop(true),
    couperNet: () => player?.stop(false),
    piloter: (regime, charge = 0.5, glisse = 0) => player?.drive(regime, charge, glisse),
    niveau: (niveau) => getPlayer().setLevel(niveau),
    plage: () => player?.range ?? null,
  };
});

/** Ce qui est sauvegardé du son du moteur : l'entendre ou non en sortie de nuit. */
export interface EngineSoundPrefs {
  /** Le moteur s'entend en sortie de nuit (bouton « Moteur » de l'écran de sortie). */
  enSortie: boolean;
}

export const ENGINE_SOUND_PREFS_KEY = 'pmb-son-moteur';

/** Lecture tolérante : une valeur inconnue retombe sur celle d'origine (moteur entendu). */
export function sanitizeEngineSoundPrefs(raw: unknown): EngineSoundPrefs {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return { enSortie: typeof source.enSortie === 'boolean' ? source.enSortie : true };
}

export const useEngineSoundPrefs = create<EngineSoundPrefs & { setEnSortie: (on: boolean) => void }>()(
  persist(
    (set) => ({
      enSortie: true,
      setEnSortie: (enSortie) => set((state) => (state.enSortie === enSortie ? state : { enSortie })),
    }),
    {
      name: ENGINE_SOUND_PREFS_KEY,
      version: 1,
      storage: createJSONStorage(() => idbStorage),
      partialize: ({ enSortie }) => ({ enSortie }),
      migrate: (persisted) => sanitizeEngineSoundPrefs(persisted),
      merge: (persisted, current) => ({ ...current, ...sanitizeEngineSoundPrefs(persisted) }),
    },
  ),
);

// Une autre page de l'app enregistre aussi : le store relit la sauvegarde (src/state/persistence.ts).
shareAcrossTabs(useEngineSoundPrefs);

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
