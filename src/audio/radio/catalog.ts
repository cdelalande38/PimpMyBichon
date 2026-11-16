// Index des stations, rangé dans IndexedDB (base à part, pour ne pas toucher à celle des réglages).
// Lecture tolérante : une entrée abîmée est écartée, jamais l'index entier.
// Plusieurs onglets peuvent être ouverts : chaque écriture relit l'index sur le disque, sous un
// verrou commun (navigator.locks), n'y applique que son changement, puis prévient les autres onglets.

import { createStore, get, set, type UseStore } from 'idb-keyval';

export interface Track {
  id: string;
  /** Chemin d'origine (dans le ZIP, ou nom du fichier choisi). */
  path: string;
  title: string;
  artist?: string;
  /** Fichier du stockage privé qui porte le morceau (station de base : son nom dans le dossier de la station). */
  file: string;
  /** Morceau servi par l'app (station de base) : son adresse, lue en flux ; absente : stockage privé. */
  src?: string;
  /** Tranche du fichier (morceau stocké dans le ZIP) ; absente : le fichier entier. */
  start?: number;
  end?: number;
  mime: string;
  /** Durée en secondes, lue à la première écoute. */
  duration?: number;
}

export interface Station {
  id: string;
  packId: string;
  folder: string;
  name: string;
  tracks: Track[];
  /** Station de base, servie par l'app (accueil.ts) : jamais enregistrée dans l'index, jamais supprimée. */
  builtin?: boolean;
}

export type PackOrigin = 'adresse' | 'fichier' | 'morceaux';

export interface Pack {
  id: string;
  origin: PackOrigin;
  /** Adresse d'origine (pack téléchargé). */
  url?: string;
  /** Nom du fichier choisi, ou hôte de l'adresse. */
  label: string;
  /** Fichiers du stockage privé qui appartiennent au pack. */
  files: string[];
  /** Poids du pack d'origine, en octets (sert à reconnaître un pack déjà importé). */
  sourceBytes: number;
  /** Place occupée sur le téléphone, en octets. */
  bytes: number;
  importedAt: number;
  /** Dossier de la station de départ (champ « depart » de pack.json). */
  depart?: string;
}

export interface Catalog {
  packs: Pack[];
  stations: Station[];
}

export const EMPTY_CATALOG: Catalog = Object.freeze({ packs: [], stations: [] }) as Catalog;

const KEY = 'catalogue';
let store: UseStore | null = null;

function db(): UseStore {
  store ??= createStore('pimpmybichon-radio', 'index');
  return store;
}

const str = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const num = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function readTrack(raw: unknown): Track | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const t = raw as Record<string, unknown>;
  if (!str(t.id) || !str(t.file) || !str(t.path)) return null;
  const track: Track = {
    id: t.id,
    path: t.path,
    file: t.file,
    title: str(t.title) ? t.title : t.path,
    mime: str(t.mime) ? t.mime : 'audio/mpeg',
  };
  if (str(t.artist)) track.artist = t.artist;
  if (num(t.start) && num(t.end) && t.end > t.start) {
    track.start = t.start;
    track.end = t.end;
  }
  if (num(t.duration) && t.duration > 0) track.duration = t.duration;
  return track;
}

/** Remet d'aplomb un index lu sur le disque : tout ce qui ne ressemble à rien est écarté. */
export function sanitizeCatalog(raw: unknown): Catalog {
  if (typeof raw !== 'object' || raw === null) return { packs: [], stations: [] };
  const data = raw as Record<string, unknown>;
  const packs: Pack[] = [];
  for (const item of Array.isArray(data.packs) ? data.packs : []) {
    if (typeof item !== 'object' || item === null) continue;
    const p = item as Record<string, unknown>;
    if (!str(p.id)) continue;
    const origin: PackOrigin = p.origin === 'adresse' || p.origin === 'morceaux' ? p.origin : 'fichier';
    const pack: Pack = {
      id: p.id,
      origin,
      label: str(p.label) ? p.label : 'Pack',
      files: Array.isArray(p.files) ? p.files.filter(str) : [],
      sourceBytes: num(p.sourceBytes) ? p.sourceBytes : 0,
      bytes: num(p.bytes) ? p.bytes : 0,
      importedAt: num(p.importedAt) ? p.importedAt : 0,
    };
    if (str(p.url)) pack.url = p.url;
    if (str(p.depart)) pack.depart = p.depart;
    packs.push(pack);
  }
  const known = new Set(packs.map((pack) => pack.id));
  const stations: Station[] = [];
  for (const item of Array.isArray(data.stations) ? data.stations : []) {
    if (typeof item !== 'object' || item === null) continue;
    const s = item as Record<string, unknown>;
    if (!str(s.id) || !str(s.packId) || !known.has(s.packId)) continue;
    const tracks = (Array.isArray(s.tracks) ? s.tracks : []).map(readTrack).filter((t): t is Track => t !== null);
    if (tracks.length === 0) continue;
    const folder = str(s.folder) ? s.folder : s.id;
    stations.push({ id: s.id, packId: s.packId, folder, name: str(s.name) ? s.name : folder, tracks });
  }
  return { packs, stations };
}

export async function loadCatalog(): Promise<Catalog> {
  return sanitizeCatalog(await get(KEY, db()));
}

export async function saveCatalog(catalog: Catalog): Promise<void> {
  await set(KEY, catalog, db());
}

const LOCK = 'pmb-radio-index';
let localQueue: Promise<unknown> = Promise.resolve();

/** Tâche sérialisée avec toutes les écritures de l'index, dans tous les onglets. */
export function withIndexLock<T>(task: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (locks) return locks.request(LOCK, task) as Promise<T>;
  // Navigateur sans verrous : au moins sérialisé dans cet onglet.
  const run = localQueue.then(task, task);
  localQueue = run.catch(() => undefined);
  return run;
}

let channel: BroadcastChannel | null = null;
function bus(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  channel ??= new BroadcastChannel(LOCK);
  return channel;
}

/**
 * Relit l'index sur le disque, y applique `change` et l'enregistre, sous le verrou. `adopt` reçoit
 * le résultat avant la levée du verrou (l'onglet le prend sans risque d'être doublé). Un changement
 * qui rend l'index tel quel n'écrit rien.
 */
export async function updateCatalog(change: (current: Catalog) => Catalog, adopt?: (next: Catalog) => void): Promise<Catalog> {
  return withIndexLock(async () => {
    const current = await loadCatalog();
    const next = change(current);
    if (next !== current) {
      await saveCatalog(next);
      bus()?.postMessage('index');
    }
    adopt?.(next);
    return next;
  });
}

/** Un autre onglet a changé l'index : `listener` est appelé (jamais pour les écritures de cet onglet). */
export function onCatalogChange(listener: () => void): () => void {
  const target = bus();
  if (!target) return () => undefined;
  const handler = () => listener();
  target.addEventListener('message', handler);
  return () => target.removeEventListener('message', handler);
}

// ——— Changements de l'index (purs : ils partent de l'index relu sur le disque) ———

/** Range un pack : ses stations remplacent celles de même dossier ; les packs sans station partent. */
export function withPack(current: Catalog, pack: Pack, stations: Station[]): { catalog: Catalog; replaced: Station[]; orphans: Pack[] } {
  const folders = new Set(stations.map((station) => station.folder));
  const replaced = current.stations.filter((station) => station.packId !== PLAYLIST_ID && folders.has(station.folder));
  const kept = current.stations.filter((station) => !replaced.includes(station));
  const inUse = new Set(kept.map((station) => station.packId));
  const orphans = current.packs.filter((item) => !inUse.has(item.id) && item.id !== pack.id);
  return {
    catalog: { packs: [...current.packs.filter((item) => inUse.has(item.id) && item.id !== pack.id), pack], stations: [...kept, ...stations] },
    replaced,
    orphans,
  };
}

/** Retire les stations choisies ; un pack part avec sa dernière station. */
export function withoutStations(current: Catalog, drop: (station: Station) => boolean): { catalog: Catalog; removed: Station[]; orphans: Pack[] } {
  const removed = current.stations.filter(drop);
  if (removed.length === 0) return { catalog: current, removed, orphans: [] };
  const stations = current.stations.filter((station) => !removed.includes(station));
  const inUse = new Set(stations.map((station) => station.packId));
  return {
    catalog: { packs: current.packs.filter((pack) => inUse.has(pack.id)), stations },
    removed,
    orphans: current.packs.filter((pack) => !inUse.has(pack.id)),
  };
}

/** Ajoute des morceaux à « Ma playlist » ; un morceau déjà présent (même nom) est écarté. */
export function withSongs(
  current: Catalog,
  songs: readonly { track: Track; bytes: number }[],
  now = Date.now(),
): { catalog: Catalog; station: Station | null; added: Track[]; dropped: string[] } {
  const playlist = current.stations.find((station) => station.id === PLAYLIST_ID);
  const known = new Set(playlist?.tracks.map((track) => track.path));
  const fresh = songs.filter((song) => !known.has(song.track.path));
  const dropped = songs.filter((song) => known.has(song.track.path)).map((song) => song.track.file);
  if (fresh.length === 0) return { catalog: current, station: playlist ?? null, added: [], dropped };
  const pack: Pack = current.packs.find((item) => item.id === PLAYLIST_ID) ?? {
    id: PLAYLIST_ID,
    origin: 'morceaux',
    label: 'Ma playlist',
    files: [],
    sourceBytes: 0,
    bytes: 0,
    importedAt: now,
  };
  const bytes = pack.bytes + fresh.reduce((sum, song) => sum + song.bytes, 0);
  const added = fresh.map((song) => song.track);
  const station: Station = { id: PLAYLIST_ID, packId: PLAYLIST_ID, folder: PLAYLIST_ID, name: 'Ma playlist', tracks: [...(playlist?.tracks ?? []), ...added] };
  return {
    catalog: {
      packs: [...current.packs.filter((item) => item.id !== PLAYLIST_ID), { ...pack, files: [...pack.files, ...added.map((track) => track.file)], bytes, sourceBytes: bytes }],
      stations: [...current.stations.filter((item) => item.id !== PLAYLIST_ID), station],
    },
    station,
    added,
    dropped,
  };
}

/** Reporte des durées lues (identifiant du morceau → secondes) sur les morceaux qui n'en ont pas. */
export function withDurations(current: Catalog, durations: ReadonlyMap<string, number>): Catalog {
  let changed = false;
  const stations = current.stations.map((station) => {
    if (!station.tracks.some((track) => track.duration === undefined && durations.has(track.id))) return station;
    changed = true;
    return {
      ...station,
      tracks: station.tracks.map((track) => {
        const seconds = durations.get(track.id);
        return track.duration === undefined && seconds !== undefined ? { ...track, duration: seconds } : track;
      }),
    };
  });
  return changed ? { ...current, stations } : current;
}

// ——— Ménage des fichiers orphelins ———

/** Un fichier trop récent n'est jamais effacé : un autre onglet peut être en train de l'importer. */
export const ORPHAN_GRACE_MS = 10 * 60 * 1000;

/** Propriétaire d'un fichier : son pack (pack-…zip, pack-…-t-….mp3), « piste » pour Ma playlist. */
export function fileOwner(name: string): string {
  const pack = /^pack-[0-9a-f]+/.exec(name);
  if (pack) return pack[0];
  return name.startsWith('piste-') ? 'piste' : name;
}

/** Fichiers à effacer : inconnus de l'index, d'aucun import en cours, et assez anciens. */
export function pickOrphans(
  files: readonly { name: string; lastModified: number }[],
  catalog: Catalog,
  busyOwners: ReadonlySet<string>,
  now: number,
): string[] {
  const owned = new Set(catalog.packs.flatMap((pack) => pack.files));
  return files
    .filter((file) => !owned.has(file.name) && !busyOwners.has(fileOwner(file.name)) && now - file.lastModified > ORPHAN_GRACE_MS)
    .map((file) => file.name);
}

export function newId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `${prefix}-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Identifiant de la station « Ma playlist » et de son pack. */
export const PLAYLIST_ID = 'ma-playlist';
