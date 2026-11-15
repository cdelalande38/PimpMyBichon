// Index des stations, rangé dans IndexedDB (base à part, pour ne pas toucher à celle des réglages).
// Lecture tolérante : une entrée abîmée est écartée, jamais l'index entier.

import { createStore, get, set, type UseStore } from 'idb-keyval';

export interface Track {
  id: string;
  /** Chemin d'origine (dans le ZIP, ou nom du fichier choisi). */
  path: string;
  title: string;
  artist?: string;
  /** Fichier du stockage privé qui porte le morceau. */
  file: string;
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

export function newId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `${prefix}-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Identifiant de la station « Ma playlist » et de son pack. */
export const PLAYLIST_ID = 'ma-playlist';
