// État de la radio : index des stations, téléchargement ou import en cours, offre reçue par
// lien, morceau en cours. Les actions vivent dans src/audio/radio/ (library.ts, player.ts).

import { create } from 'zustand';
import { createStore, get, set, type UseStore } from 'idb-keyval';
import { EMPTY_CATALOG, saveCatalog, type Catalog } from '../audio/radio/catalog.ts';

export type RadioStatus = 'chargement' | 'pret' | 'indisponible';

export type FailCode =
  | 'reseau'
  | 'introuvable'
  | 'cors'
  | 'pas-un-pack'
  | 'place'
  | 'serveur'
  | 'coupure'
  | 'reprise'
  | 'adresse'
  | 'abime'
  | 'zip64'
  | 'chiffre'
  | 'inconnu';

export interface FailInfo {
  code: FailCode;
  title: string;
  hint: string;
}

export type JobPhase = 'telechargement' | 'copie' | 'lecture' | 'coupure' | 'erreur' | 'fini';

export interface Job {
  kind: 'adresse' | 'fichier' | 'morceaux';
  /** Hôte de l'adresse ou nom du fichier. */
  label: string;
  phase: JobPhase;
  /** Octets reçus ou copiés (morceaux lus pendant la phase « lecture »). */
  done: number;
  total: number | null;
  url?: string;
  fail?: FailInfo;
  /** Phase « fini » : ce qui a été ajouté. */
  message?: string;
}

/** Pack reçu par lien quand le navigateur demande d'économiser les données : il attend un appui. */
export interface Offer {
  url: string;
  host: string;
}

export interface NowPlaying {
  stationId: string;
  trackId: string;
  title: string;
  artist?: string;
  playing: boolean;
}

export interface RadioPrefs {
  shuffle: boolean;
  volume: number;
  lastStationId: string | null;
  lastTrackId: string | null;
}

export const DEFAULT_PREFS: RadioPrefs = Object.freeze({
  shuffle: false,
  volume: 0.9,
  lastStationId: null,
  lastTrackId: null,
});

export interface RadioState extends RadioPrefs {
  status: RadioStatus;
  catalog: Catalog;
  job: Job | null;
  offer: Offer | null;
  now: NowPlaying | null;
  /** Le navigateur a refusé de jouer sans geste : la musique part au premier appui. */
  waitingTap: boolean;
  /** Position et durée du morceau en cours, en secondes entières. */
  clock: { position: number; duration: number | null };
  /** Position fine (au dixième de seconde) et durée, pour la barre de progression. */
  progress: { time: number; duration: number | null };
  /** Place occupée par l'app et quota du navigateur, en octets. */
  storage: { usage: number | null; quota: number | null };
}

export const useRadio = create<RadioState>(() => ({
  ...DEFAULT_PREFS,
  status: 'chargement',
  catalog: EMPTY_CATALOG,
  job: null,
  offer: null,
  now: null,
  waitingTap: false,
  clock: { position: 0, duration: null },
  progress: { time: 0, duration: null },
  storage: { usage: null, quota: null },
}));

let prefsDb: UseStore | null = null;
function db(): UseStore {
  prefsDb ??= createStore('pimpmybichon-radio-reglages', 'kv');
  return prefsDb;
}

export function sanitizePrefs(raw: unknown): RadioPrefs {
  const p = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const volume = typeof p.volume === 'number' && Number.isFinite(p.volume) ? Math.min(1, Math.max(0, p.volume)) : DEFAULT_PREFS.volume;
  return {
    shuffle: typeof p.shuffle === 'boolean' ? p.shuffle : DEFAULT_PREFS.shuffle,
    volume,
    lastStationId: typeof p.lastStationId === 'string' ? p.lastStationId : null,
    lastTrackId: typeof p.lastTrackId === 'string' ? p.lastTrackId : null,
  };
}

export async function loadPrefs(): Promise<RadioPrefs> {
  try {
    return sanitizePrefs(await get('reglages', db()));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/** Retient un réglage de la radio (aléatoire, volume, dernière station). */
export function setPrefs(patch: Partial<RadioPrefs>): void {
  useRadio.setState(patch);
  const { shuffle, volume, lastStationId, lastTrackId } = useRadio.getState();
  void set('reglages', { shuffle, volume, lastStationId, lastTrackId }, db()).catch(() => undefined);
}

/** Remplace l'index et l'enregistre. */
export async function commitCatalog(catalog: Catalog): Promise<void> {
  useRadio.setState({ catalog });
  await saveCatalog(catalog);
}

let durationTimer: ReturnType<typeof setTimeout> | null = null;

/** Durée lue à la première écoute : retenue dans l'index, enregistrée sans hâte. */
export function recordDuration(trackId: string, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  const { catalog } = useRadio.getState();
  let changed = false;
  const stations = catalog.stations.map((station) => {
    if (!station.tracks.some((track) => track.id === trackId && track.duration === undefined)) return station;
    changed = true;
    return {
      ...station,
      tracks: station.tracks.map((track) => (track.id === trackId ? { ...track, duration: seconds } : track)),
    };
  });
  if (!changed) return;
  useRadio.setState({ catalog: { ...catalog, stations } });
  if (durationTimer) clearTimeout(durationTimer);
  durationTimer = setTimeout(() => {
    void saveCatalog(useRadio.getState().catalog).catch(() => undefined);
  }, 2000);
}
