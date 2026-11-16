// État de la sortie de nuit (§ 5.5), conforme au contrat (src/drive/contrat.ts, DriveStore).
// L'interface écrit les commandes ; la scène les lit à chaque image par `useDrive.getState()` et
// publie la télémétrie par `setTelemetry`. Seules la météo et la caméra préférées sont sauvegardées
// (IndexedDB, lecture tolérante, partagées entre les pages de l'app) ; le reste dure la sortie.
// Le choix fait dans le menu (carte, départ) dure la séance : « Sortir » part de là.

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { CAMERA_IDS, type CameraId, type DriveInput, type DriveStore, type DriveTelemetry, type OrbitView, type Pilot, type Weather } from '../drive/contrat.ts';
import { clampOrbit, DEFAULT_ORBIT } from '../drive/cameras.ts';
import { mapById, MAPS } from '../data/maps.ts';
import type { MapId } from '../data/mapTypes.ts';
import { idbStorage, shareAcrossTabs } from './persistence.ts';

export const DRIVE_KEY = 'pmb-sortie';
export const DRIVE_VERSION = 1;

export const WEATHERS: readonly { id: Weather; label: string }[] = [
  { id: 'sec', label: 'Sec' },
  { id: 'pluie', label: 'Pluie' },
  { id: 'neige', label: 'Neige' },
];

export const CAMERA_LABELS: Record<CameraId, string> = {
  poursuite: 'Poursuite',
  rasante: 'Rasante',
  avant: 'Avant',
  embarquee: 'Embarquée',
  travelling: 'Bord de route',
  orbite: 'Orbite',
};

/** Ce qui est sauvegardé : la météo et la caméra préférées. */
export interface DrivePrefs {
  weather: Weather;
  camera: CameraId;
}

export const DEFAULT_DRIVE_PREFS: Readonly<DrivePrefs> = Object.freeze({ weather: 'pluie', camera: 'poursuite' });

export const AUTO_INPUT: Readonly<DriveInput> = Object.freeze({ auto: true, throttle: 0, brake: 0, lane: 0 });

/**
 * Le pilote de la sortie en cours, posé par la scène (src/drive/scene/moteur.ts) et retiré quand
 * elle se démonte : le compte-tours et le NOS le lisent à chaque image (sans faire rendre React),
 * le son du moteur à chaque télémétrie. Jamais sauvegardé.
 */
export const livePilot: { current: Pilot | null } = { current: null };

export const IDLE_TELEMETRY: Readonly<DriveTelemetry> = Object.freeze({
  ready: false,
  failed: false,
  speedKmh: 0,
  s: 0,
  progress: 0,
  finished: false,
});

/** Lecture tolérante : une valeur inconnue retombe sur celle d'origine. */
export function sanitizeDrivePrefs(raw: unknown): DrivePrefs {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const weather = WEATHERS.some((item) => item.id === source.weather) ? (source.weather as Weather) : DEFAULT_DRIVE_PREFS.weather;
  const camera = CAMERA_IDS.includes(source.camera as CameraId) ? (source.camera as CameraId) : DEFAULT_DRIVE_PREFS.camera;
  return { weather, camera };
}

/** Caméra suivante dans l'ordre du contrat (après l'orbite, on revient à la poursuite). */
export function nextCameraOf(camera: CameraId): CameraId {
  const index = CAMERA_IDS.indexOf(camera);
  return CAMERA_IDS[(index + 1) % CAMERA_IDS.length] as CameraId;
}

function sameTelemetry(a: DriveTelemetry, b: DriveTelemetry): boolean {
  return a.ready === b.ready && a.failed === b.failed && a.speedKmh === b.speedKmh && a.s === b.s && a.progress === b.progress && a.finished === b.finished;
}

export interface DriveState extends DriveStore {
  hydrated: boolean;
  /** Essai de la sortie en cours : « Réessayer » et « Repartir » remontent la scène (clé de montage). */
  attempt: number;
  /** Remonte la scène sur la même carte et le même départ : après une erreur, ou au bout de la route. */
  retry: () => void;
  /** La scène est tombée (erreur de rendu) : la sortie affiche son message d'erreur. */
  fail: () => void;
  /** Choix du menu, avant de sortir : carte (`null` : la première du catalogue) et départ. */
  choice: { map: MapId | null; start: string | null };
  /** Choisit la carte du menu ; le départ revient au premier de cette carte. */
  chooseMap: (map: MapId) => void;
  chooseStart: (start: string | null) => void;
  /**
   * Entre en sortie : sur la carte et le départ donnés, sinon sur le choix du menu, sinon sur la
   * première carte. Sans effet si le catalogue est vide ou si l'on roule déjà sur cette carte.
   */
  enter: (map?: MapId | null, start?: string | null) => void;
  /** Rentre au garage : plus de carte, commandes et télémétrie remises à zéro. */
  leave: () => void;
  /** Choisit une caméra à la main : le réalisateur s'arrête. */
  setCamera: (camera: CameraId) => void;
  nextCamera: () => void;
  setDirector: (director: boolean) => void;
  setWeather: (weather: Weather) => void;
  /** Pilote automatique (vrai) ou conduite à la main (faux, pédales relâchées). */
  setAuto: (auto: boolean) => void;
  setThrottle: (throttle: number) => void;
  setBrake: (brake: number) => void;
  setLane: (lane: DriveInput['lane']) => void;
  /** Un appui sur « NOS » (à la main) : le pilote envoie une poussée si la réserve le permet. */
  fireNos: () => void;
  setOrbit: (orbit: Partial<OrbitView>) => void;
  setSlow: (slow: boolean) => void;
  setPaused: (paused: boolean) => void;
}

const unit = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

export const useDrive = create<DriveState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_DRIVE_PREFS,
      map: null,
      start: null,
      director: true,
      input: { ...AUTO_INPUT },
      orbit: { ...DEFAULT_ORBIT },
      slow: false,
      paused: false,
      telemetry: { ...IDLE_TELEMETRY },
      hydrated: false,
      attempt: 0,
      choice: { map: null, start: null },
      retry: () =>
        set((state) =>
          state.map === null
            ? state
            : { attempt: state.attempt + 1, input: { ...AUTO_INPUT }, slow: false, paused: false, telemetry: { ...IDLE_TELEMETRY } },
        ),
      fail: () => set((state) => ({ telemetry: { ...state.telemetry, ready: false, failed: true } })),
      setTelemetry: (telemetry) => set((state) => (sameTelemetry(state.telemetry, telemetry) ? state : { telemetry: { ...telemetry } })),
      chooseMap: (map) => set((state) => (mapById(map) ? { choice: { map, start: state.choice.map === map ? state.choice.start : null } } : state)),
      chooseStart: (start) => set((state) => ({ choice: { ...state.choice, start } })),
      enter: (map, start) => {
        const state = get();
        const target = mapById(map ?? state.choice.map) ?? MAPS[0];
        if (!target) return;
        const wanted = map !== undefined && map !== null ? (start ?? null) : start !== undefined ? start : state.choice.start;
        if (state.map === target.id && state.start === wanted) return;
        set({
          map: target.id,
          start: wanted,
          director: true,
          input: { ...AUTO_INPUT },
          orbit: { ...DEFAULT_ORBIT },
          slow: false,
          paused: false,
          telemetry: { ...IDLE_TELEMETRY },
        });
      },
      leave: () =>
        set((state) =>
          state.map === null
            ? state
            : { map: null, start: null, input: { ...AUTO_INPUT }, slow: false, paused: false, telemetry: { ...IDLE_TELEMETRY } },
        ),
      setCamera: (camera) => set({ camera, director: false }),
      nextCamera: () => set((state) => ({ camera: nextCameraOf(state.camera), director: false })),
      setDirector: (director) => set({ director }),
      setWeather: (weather) => set({ weather }),
      // Le compteur du NOS suit d'un mode à l'autre : le pilote ne compte que les nouveaux appuis.
      setAuto: (auto) =>
        set((state) => {
          const nos = state.input.nos === undefined ? {} : { nos: state.input.nos };
          return { input: auto ? { ...AUTO_INPUT, ...nos } : { auto: false, throttle: 0, brake: 0, lane: 0 as const, ...nos } };
        }),
      setThrottle: (throttle) => set((state) => (state.input.auto ? state : { input: { ...state.input, throttle: unit(throttle) } })),
      setBrake: (brake) => set((state) => (state.input.auto ? state : { input: { ...state.input, brake: unit(brake) } })),
      setLane: (lane) => set((state) => (state.input.auto || state.input.lane === lane ? state : { input: { ...state.input, lane } })),
      fireNos: () => set((state) => (state.input.auto ? state : { input: { ...state.input, nos: (state.input.nos ?? 0) + 1 } })),
      setOrbit: (orbit) => set((state) => ({ orbit: clampOrbit({ ...state.orbit, ...orbit }) })),
      setSlow: (slow) => set((state) => (state.slow === slow ? state : { slow })),
      setPaused: (paused) => set((state) => (state.paused === paused ? state : { paused })),
    }),
    {
      name: DRIVE_KEY,
      version: DRIVE_VERSION,
      storage: createJSONStorage(() => idbStorage),
      partialize: ({ weather, camera }) => ({ weather, camera }),
      migrate: (persisted) => sanitizeDrivePrefs(persisted),
      merge: (persisted, current) => ({ ...current, ...sanitizeDrivePrefs(persisted) }),
      onRehydrateStorage: () => () => {
        useDrive.setState({ hydrated: true });
      },
    },
  ),
);

// Une autre page de l'app enregistre aussi : le store relit la sauvegarde (src/state/persistence.ts).
shareAcrossTabs(useDrive);
