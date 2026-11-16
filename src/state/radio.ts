// État de la radio : index des stations, téléchargement ou import en cours, offre reçue par
// lien, morceau en cours. Les actions vivent dans src/audio/radio/ (library.ts, player.ts).

import { create } from 'zustand';
import { createStore, get, set, type UseStore } from 'idb-keyval';
import { withBuiltins } from '../audio/radio/accueil.ts';
import { EMPTY_CATALOG, updateCatalog, withDurations, type Catalog } from '../audio/radio/catalog.ts';

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
  | 'trop-gros'
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
  /** Mini-lecteur du haut de l'écran déployé (bouton rond « Radio ») ; replié par défaut. */
  miniOpen: boolean;
}

export const DEFAULT_PREFS: RadioPrefs = Object.freeze({
  shuffle: false,
  volume: 0.9,
  lastStationId: null,
  lastTrackId: null,
  miniOpen: false,
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
    miniOpen: typeof p.miniOpen === 'boolean' ? p.miniOpen : DEFAULT_PREFS.miniOpen,
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
  const { shuffle, volume, lastStationId, lastTrackId, miniOpen } = useRadio.getState();
  void set('reglages', { shuffle, volume, lastStationId, lastTrackId, miniOpen }, db()).catch(() => undefined);
}

// Durées lues mais pas encore enregistrées : reportées sur tout index relu entre-temps.
const pendingDurations = new Map<string, number>();

/**
 * Prend un index relu sur le disque (après une écriture, ou quand un autre onglet l'a changé). Les
 * stations de base (servies par l'app) s'y ajoutent en mémoire, jamais sur le disque.
 */
export function adoptCatalog(catalog: Catalog): void {
  useRadio.setState({ catalog: withBuiltins(pendingDurations.size > 0 ? withDurations(catalog, pendingDurations) : catalog) });
}

/**
 * Applique un changement à l'index relu sur le disque (jamais la copie en mémoire, qu'un autre
 * onglet a pu dépasser), l'enregistre sous le verrou commun et le prend.
 */
export function commitCatalog(change: (current: Catalog) => Catalog): Promise<Catalog> {
  return updateCatalog(change, adoptCatalog);
}

let durationTimer: ReturnType<typeof setTimeout> | null = null;

/** Durée lue à la première écoute : retenue dans l'index, enregistrée sans hâte (seule, sans le reste). */
export function recordDuration(trackId: string, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  const { catalog } = useRadio.getState();
  const next = withDurations(catalog, new Map([[trackId, seconds]]));
  if (next === catalog) return;
  pendingDurations.set(trackId, seconds);
  useRadio.setState({ catalog: next });
  if (durationTimer) clearTimeout(durationTimer);
  durationTimer = setTimeout(() => {
    const batch = new Map(pendingDurations);
    void updateCatalog((current) => withDurations(current, batch))
      .then(() => {
        for (const [id, value] of batch) if (pendingDurations.get(id) === value) pendingDurations.delete(id);
      })
      .catch(() => undefined);
  }, 2000);
}
