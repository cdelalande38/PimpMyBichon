// Un pack de musique devient une ou plusieurs stations : pack.json version 2 (plusieurs
// stations), version 1 (une station), ou sans pack.json (un dossier de premier niveau = une station).

import type { ZipEntry } from './zip.ts';

export const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'flac', 'webm'] as const;

const MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  webm: 'audio/webm',
};

export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function mimeOf(path: string): string {
  return MIME[extensionOf(path)] ?? 'audio/mpeg';
}

export function isAudioPath(path: string): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1);
  if (base.startsWith('.') || path.startsWith('__MACOSX/')) return false;
  return (AUDIO_EXTENSIONS as readonly string[]).includes(extensionOf(path));
}

const PRETTY: Record<string, string> = {
  'hiphop-rnb': 'Hip-hop & R&B',
  'hip-hop-rnb': 'Hip-hop & R&B',
  hiphop: 'Hip-hop',
  'hip-hop': 'Hip-hop',
  rnb: 'R&B',
  electro: 'Électro',
  'ma-playlist': 'Ma playlist',
};

/** Nom affiché d'une station : « hiphop-rnb » → « Hip-hop & R&B », sinon le dossier avec une majuscule. */
export function prettyStationName(folder: string): string {
  const key = folder.trim().toLowerCase();
  const known = PRETTY[key];
  if (known) return known;
  const text = folder.trim().replace(/_/g, ' ');
  return text.charAt(0).toLocaleUpperCase('fr') + text.slice(1);
}

export interface StationPlan {
  folder: string;
  name: string;
  entries: ZipEntry[];
}

type Manifest =
  | { version: 1; station: string }
  | { version: 2; stations: string[] };

/** Lecture tolérante de pack.json : tout ce qui n'est pas reconnu vaut « pas de manifeste ». */
export function parseManifest(text: string | null): Manifest | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as Record<string, unknown>;
  if (data.format !== 'pmb-pack') return null;
  if (data.version === 1 && typeof data.station === 'string' && data.station.trim()) {
    return { version: 1, station: data.station.trim().replace(/\/+$/, '') };
  }
  if (data.version === 2 && Array.isArray(data.stations)) {
    const stations = data.stations
      .map((item: unknown) =>
        typeof item === 'object' && item !== null && typeof (item as { dossier?: unknown }).dossier === 'string'
          ? (item as { dossier: string }).dossier.trim().replace(/\/+$/, '')
          : '',
      )
      .filter((folder) => folder !== '');
    if (stations.length > 0) return { version: 2, stations };
  }
  return null;
}

const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

function sorted(entries: ZipEntry[]): ZipEntry[] {
  return [...entries].sort((a, b) => collator.compare(a.name, b.name));
}

function under(entries: ZipEntry[], folder: string): ZipEntry[] {
  const prefix = `${folder}/`;
  return entries.filter((entry) => entry.name.startsWith(prefix));
}

function plan(folder: string, entries: ZipEntry[]): StationPlan {
  return { folder, name: prettyStationName(folder), entries: sorted(entries) };
}

function byTopFolder(audio: ZipEntry[], fallbackName: string, strip = ''): StationPlan[] {
  const groups = new Map<string, ZipEntry[]>();
  for (const entry of audio) {
    const rest = entry.name.slice(strip.length);
    const slash = rest.indexOf('/');
    const folder = slash > 0 ? rest.slice(0, slash) : fallbackName;
    const list = groups.get(folder) ?? [];
    list.push(entry);
    groups.set(folder, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => collator.compare(a, b))
    .map(([folder, list]) => plan(folder, list));
}

/**
 * Stations d'un pack. `fallbackName` nomme la station des morceaux posés à la racine
 * (nom du fichier ZIP, sans extension).
 */
export function planStations(entries: ZipEntry[], manifestText: string | null, fallbackName: string): StationPlan[] {
  const audio = entries.filter((entry) => !entry.directory && isAudioPath(entry.name));
  if (audio.length === 0) return [];
  const manifest = parseManifest(manifestText);

  if (manifest?.version === 2) {
    const plans = manifest.stations
      .map((folder) => plan(folder, under(audio, folder)))
      .filter((item) => item.entries.length > 0);
    if (plans.length > 0) return plans;
  }
  if (manifest?.version === 1) {
    const inside = under(audio, manifest.station);
    return [plan(manifest.station, inside.length > 0 ? inside : audio)];
  }

  // Sans manifeste : si tout vit sous un seul dossier qui contient lui-même des dossiers
  // (on a zippé le dossier parent), on descend d'un niveau.
  const tops = new Set(audio.map((entry) => (entry.name.includes('/') ? entry.name.split('/')[0] : '')));
  const [onlyTop] = [...tops];
  if (tops.size === 1 && onlyTop && audio.some((entry) => entry.name.split('/').length >= 3)) {
    const stripped = byTopFolder(audio, onlyTop, `${onlyTop}/`);
    if (stripped.length > 0) return stripped;
  }
  return byTopFolder(audio, fallbackName);
}
