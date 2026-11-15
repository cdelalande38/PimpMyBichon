// Entrée de la musique : pack choisi dans les fichiers du téléphone, pack téléchargé depuis une
// adresse (écrit en flux dans le stockage privé, avec reprise), morceaux isolés (« Ma playlist »).
// Un pack sans compression reste tel quel : chaque morceau est lu comme une tranche du ZIP.
// Garde-fous : plafond de 2 Gio (téléchargement, ZIP, morceaux décompressés), place vérifiée avant
// d'écrire, CRC contrôlé en flux ; après un refus, rien ne reste dans le stockage privé. Chaque import
// tient un verrou « pmb-radio-ecrit:<pack> » : le ménage d'un autre onglet ne touche pas à ses fichiers.

import { askPersistentStorage } from '../../state/persistence.ts';
import { useSettings } from '../../state/store.ts';
import { adoptCatalog, commitCatalog, loadPrefs, useRadio, type FailCode, type FailInfo, type Job } from '../../state/radio.ts';
import {
  loadCatalog,
  newId,
  onCatalogChange,
  pickOrphans,
  PLAYLIST_ID,
  withIndexLock,
  withoutStations,
  withPack,
  withSongs,
  type Pack,
  type PackOrigin,
  type Station,
  type Track,
} from './catalog.ts';
import { id3Size, parseId3, tagsFromFilename } from './id3.ts';
import { checkPackUrl } from './link.ts';
import {
  fileHandle,
  fileSize,
  isQuotaError,
  listFiles,
  openFile,
  opfsSupported,
  removeFile,
  trackBlob,
  writeStream,
} from './opfs.ts';
import { extensionOf, isAudioPath, mimeOf, parseManifest, pickStart, planStations } from './pack.ts';
import { playStation, stopPlayback } from './player.ts';
import { declaredSizes, entryBytes, entryRange, entryStream, PACK_MAX_BYTES, readZipEntries, ZipError } from './zip.ts';

const FAILS: Record<FailCode, Omit<FailInfo, 'code'>> = {
  reseau: {
    title: 'Pas de réseau.',
    hint: 'Vérifie ta connexion (le Wi-Fi, c’est mieux pour un gros pack), puis réessaie.',
  },
  introuvable: {
    title: 'Adresse introuvable.',
    hint: 'Recopie l’adresse depuis ton hébergement, en entier, sans rien couper.',
  },
  cors: {
    title: 'Ton hébergement n’autorise pas l’atelier à lire le fichier.',
    hint: 'Il doit envoyer l’en-tête Access-Control-Allow-Origin. Sinon, télécharge le ZIP sur le téléphone et ajoute-le depuis un fichier.',
  },
  'pas-un-pack': {
    title: 'Ce n’est pas un pack de musique.',
    hint: 'L’adresse doit mener au fichier ZIP lui-même (lien direct), pas à une page de téléchargement, et le ZIP doit contenir des morceaux.',
  },
  place: {
    title: 'Plus de place sur le téléphone.',
    hint: 'Libère de la place (photos, vidéos, ou une station ici), puis réessaie.',
  },
  serveur: {
    title: 'L’hébergement répond de travers.',
    hint: 'Réessaie dans un moment ; si ça dure, vérifie que le fichier est bien en ligne.',
  },
  coupure: {
    title: 'Le téléchargement a été coupé.',
    hint: 'Reprends là où ça s’est arrêté, de préférence en Wi-Fi.',
  },
  reprise: {
    title: 'L’hébergement ne sait pas reprendre en cours de route.',
    hint: 'Il faut recommencer depuis le début.',
  },
  adresse: {
    title: 'Adresse refusée.',
    hint: 'Colle l’adresse complète du ZIP : elle doit commencer par https.',
  },
  abime: {
    title: 'Le ZIP est abîmé.',
    hint: 'Refabrique-le avec npm run radio:pack, ou retélécharge-le.',
  },
  zip64: {
    title: 'Ce ZIP est trop gros (plus de 4 Go).',
    hint: 'Coupe-le en plusieurs packs, un par station (option --par-station).',
  },
  chiffre: {
    title: 'Ce ZIP est protégé par un mot de passe.',
    hint: 'Refais-le sans mot de passe, avec npm run radio:pack.',
  },
  'trop-gros': {
    title: 'Ce pack est trop gros une fois décompressé.',
    hint: 'Une radio tient sous 2 Go et la musique ne se compresse presque pas : refais le pack avec npm run radio:pack (sans compression), ou coupe-le en plusieurs (option --par-station).',
  },
  inconnu: {
    title: 'Quelque chose a coincé.',
    hint: 'Réessaie ; si ça recommence, recharge l’atelier.',
  },
};

export class RadioFailure extends Error {
  readonly code: FailCode;
  constructor(code: FailCode) {
    super(code);
    this.code = code;
  }
}

export function failInfo(code: FailCode): FailInfo {
  return { code, ...FAILS[code] };
}

function toFailure(error: unknown): FailCode {
  if (error instanceof RadioFailure) return error.code;
  if (error instanceof ZipError) return error.code === 'methode' ? 'abime' : error.code;
  if (isQuotaError(error)) return 'place';
  return 'inconnu';
}

const setJob = (job: Job | null) => useRadio.setState({ job });
const patchJob = (patch: Partial<Job>) => {
  const job = useRadio.getState().job;
  if (job) setJob({ ...job, ...patch });
};

function failJob(code: FailCode, base?: Partial<Job>): void {
  const job = useRadio.getState().job;
  setJob({
    kind: 'adresse',
    label: '',
    done: 0,
    total: null,
    ...job,
    ...base,
    phase: code === 'coupure' || code === 'reprise' ? 'coupure' : 'erreur',
    fail: failInfo(code),
  });
}

export function busy(): boolean {
  const phase = useRadio.getState().job?.phase;
  return phase === 'telechargement' || phase === 'copie' || phase === 'lecture';
}

export async function refreshStorage(): Promise<void> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    useRadio.setState({ storage: { usage: estimate?.usage ?? null, quota: estimate?.quota ?? null } });
  } catch {
    // Navigateur muet : la place reste « inconnue ».
  }
}

/**
 * Plafond d'un pack. Les parcours d'essai peuvent l'abaisser (window.__pmbRadioPlafond, posé avant
 * le chargement), jamais le relever.
 */
function packCap(): number {
  const wanted = (globalThis as { __pmbRadioPlafond?: unknown }).__pmbRadioPlafond;
  return typeof wanted === 'number' && wanted > 0 ? Math.min(PACK_MAX_BYTES, wanted) : PACK_MAX_BYTES;
}

async function hasRoom(bytes: number): Promise<boolean> {
  try {
    const estimate = await navigator.storage.estimate();
    if (!estimate.quota || estimate.usage === undefined) return true;
    return bytes < estimate.quota - estimate.usage;
  } catch {
    return true;
  }
}

let starting: Promise<void> | null = null;

/** Démarrage : stockage privé, index, réglages, ménage des fichiers orphelins. Une seule fois. */
export function initRadio(): Promise<void> {
  starting ??= start();
  return starting;
}

async function start(): Promise<void> {
  if (!opfsSupported()) {
    useRadio.setState({ status: 'indisponible' });
    return;
  }
  try {
    const [catalog, prefs] = await Promise.all([loadCatalog(), loadPrefs()]);
    useRadio.setState({ ...prefs, status: 'pret' });
    adoptCatalog(catalog);
    onCatalogChange(() => void reloadCatalog());
    void cleanOrphans();
    void refreshStorage();
  } catch {
    useRadio.setState({ status: 'indisponible' });
  }
}

/** Un autre onglet a changé l'index : on le relit ; une station disparue s'arrête ici aussi. */
async function reloadCatalog(): Promise<void> {
  try {
    await withIndexLock(async () => {
      const fresh = await loadCatalog();
      const ids = new Set(fresh.stations.map((station) => station.id));
      const gone = useRadio.getState().catalog.stations.filter((station) => !ids.has(station.id));
      if (gone.length > 0) stopPlayback(gone.map((station) => station.id));
      adoptCatalog(fresh);
    });
    void refreshStorage();
  } catch {
    // Index illisible pour l'instant : la copie en mémoire reste.
  }
}

// ——— Imports en cours, vus de tous les onglets ———

const WRITE_LOCK = 'pmb-radio-ecrit:';

/** Signale un import en cours (verrou partagé, jamais en attente) ; la fonction rendue le lève. */
function holdWrite(owner: string): Promise<() => void> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) return Promise.resolve(() => undefined);
  return new Promise((resolve) => {
    locks
      .request(WRITE_LOCK + owner, { mode: 'shared' }, () => new Promise<void>((release) => resolve(() => release())))
      .catch(() => resolve(() => undefined));
  });
}

async function busyOwners(): Promise<Set<string>> {
  const owners = new Set<string>();
  try {
    const state = await navigator.locks?.query();
    for (const lock of [...(state?.held ?? []), ...(state?.pending ?? [])]) {
      if (lock.name?.startsWith(WRITE_LOCK)) owners.add(lock.name.slice(WRITE_LOCK.length));
    }
  } catch {
    // Pas de verrous : l'âge des fichiers protège seul les imports des autres onglets.
  }
  return owners;
}

/**
 * Ménage des fichiers que l'index ne connaît pas, sous le verrou de l'index : jamais ceux d'un import
 * en cours (dans n'importe quel onglet), jamais un fichier récent.
 */
async function cleanOrphans(): Promise<void> {
  try {
    await withIndexLock(async () => {
      const catalog = await loadCatalog();
      const owners = await busyOwners();
      const files: { name: string; lastModified: number }[] = [];
      for (const name of await listFiles()) {
        try {
          files.push({ name, lastModified: (await openFile(name)).lastModified });
        } catch {
          // Fichier parti entre-temps.
        }
      }
      for (const name of pickOrphans(files, catalog, owners, Date.now())) await removeFile(name);
    });
  } catch {
    // Ménage remis au prochain lancement.
  }
}

// ——— Index d'un pack ———

const utf8 = new TextDecoder('utf-8');

/** `source` : le morceau déjà ouvert (tranche du ZIP), pour ne pas rouvrir le fichier. */
async function readTags(track: Track, source?: Blob): Promise<Pick<Track, 'title' | 'artist'>> {
  const fromName = tagsFromFilename(track.path);
  try {
    const blob = source ?? (await trackBlob(track));
    const head = new Uint8Array(await blob.slice(0, 10).arrayBuffer());
    const size = id3Size(head);
    if (size > 0) {
      const tags = parseId3(new Uint8Array(await blob.slice(0, Math.min(size, 512 * 1024)).arrayBuffer()));
      return { title: tags.title ?? fromName.title, artist: tags.artist ?? fromName.artist };
    }
  } catch {
    // Étiquette illisible : le nom du fichier fait l'affaire.
  }
  return { title: fromName.title, artist: fromName.artist };
}

function withTags(track: Track, tags: Pick<Track, 'title' | 'artist'>): Track {
  const out: Track = { ...track, title: tags.title };
  if (tags.artist) out.artist = tags.artist;
  else delete out.artist;
  return out;
}

interface PackMeta {
  packId: string;
  file: string;
  origin: PackOrigin;
  label: string;
  url?: string;
  fallbackName: string;
}

async function indexZip(meta: PackMeta): Promise<string> {
  const files = [meta.file];
  try {
    const zip = await openFile(meta.file);
    const entries = await readZipEntries(zip);
    const manifestEntry = entries.find((entry) => entry.name === 'pack.json');
    const manifest = manifestEntry ? utf8.decode(await entryBytes(zip, manifestEntry, 64 * 1024)) : null;
    const plans = planStations(entries, manifest, meta.fallbackName);
    if (plans.length === 0) throw new RadioFailure('pas-un-pack');
    const count = plans.reduce((sum, plan) => sum + plan.entries.length, 0);
    // Avant de décompresser quoi que ce soit : plafond, bombe, place libre.
    const sizes = declaredSizes(
      plans.flatMap((plan) => plan.entries),
      packCap(),
    );
    if (sizes.tooBig) throw new RadioFailure('trop-gros');
    if (sizes.inflated > 0 && !(await hasRoom(sizes.inflated))) throw new RadioFailure('place');
    patchJob({ phase: 'lecture', done: 0, total: count });

    let bytes = zip.size;
    let done = 0;
    const stations: Station[] = [];
    for (const plan of plans) {
      const tracks: Track[] = [];
      for (const entry of plan.entries) {
        if (entry.encrypted) throw new RadioFailure('chiffre');
        const id = newId('t');
        let track: Track;
        let source: Blob | undefined;
        if (entry.method === 0) {
          const { start, end } = await entryRange(zip, entry);
          track = { id, path: entry.name, file: meta.file, start, end, mime: mimeOf(entry.name), title: '' };
          source = zip.slice(start, end);
        } else if (entry.method === 8) {
          // Entrée compressée : décompressée une fois pour toutes dans le stockage privé.
          const name = `${meta.packId}-${id}.${extensionOf(entry.name) || 'audio'}`;
          files.push(name);
          try {
            await writeStream(name, await entryStream(zip, entry));
          } catch (error) {
            // Deflate illisible (TypeError du navigateur) : le ZIP est abîmé.
            throw error instanceof TypeError ? new ZipError('abime', `décompression impossible (${entry.name})`) : error;
          }
          bytes += entry.size;
          track = { id, path: entry.name, file: name, mime: mimeOf(entry.name), title: '' };
        } else {
          throw new RadioFailure('abime');
        }
        tracks.push(withTags(track, await readTags(track, source)));
        done += 1;
        patchJob({ done });
      }
      stations.push({ id: newId('s'), packId: meta.packId, folder: plan.folder, name: plan.name, tracks });
    }
    const pack: Pack = {
      id: meta.packId,
      origin: meta.origin,
      label: meta.label,
      files,
      sourceBytes: zip.size,
      bytes,
      importedAt: Date.now(),
    };
    if (meta.url) pack.url = meta.url;
    const depart = parseManifest(manifest)?.depart;
    if (depart) pack.depart = depart;
    await addPack(pack, stations);
    autoStart(stations, depart);
    const names = stations.map((station) => `«\u00a0${station.name}\u00a0»`).join(', ');
    return stations.length > 1 ? `Stations ajoutées : ${names}.` : `Station ajoutée : ${names}.`;
  } catch (error) {
    for (const name of files) await removeFile(name);
    throw error;
  }
}

/** Range un pack : ses stations remplacent celles de même dossier (réimport sans doublon). */
async function addPack(pack: Pack, stations: Station[]): Promise<void> {
  let replaced: Station[] = [];
  let orphans: Pack[] = [];
  await commitCatalog((current) => {
    const change = withPack(current, pack, stations);
    replaced = change.replaced;
    orphans = change.orphans;
    return change.catalog;
  });
  stopPlayback(replaced.map((station) => station.id));
  for (const orphan of orphans) for (const name of orphan.files) await removeFile(name);
  void askPersistentStorage();
  void refreshStorage();
}

// ——— Fichiers du téléphone ———

function isZip(file: File): boolean {
  return /\.zip$/i.test(file.name) || /zip/i.test(file.type);
}

function isAudioFile(file: File): boolean {
  return isAudioPath(file.name) || file.type.startsWith('audio/');
}

/** Fichiers choisis : chaque ZIP devient un pack, les morceaux isolés rejoignent « Ma playlist ». */
export async function importFiles(list: FileList | File[]): Promise<void> {
  await initRadio();
  if (busy() || useRadio.getState().status !== 'pret') return;
  const files = Array.from(list);
  const zips = files.filter(isZip);
  const songs = files.filter((file) => !isZip(file) && isAudioFile(file));
  const messages: string[] = [];
  for (const zip of zips) {
    const packId = newId('pack');
    const file = `${packId}.zip`;
    setJob({ kind: 'fichier', label: zip.name, phase: 'copie', done: 0, total: zip.size });
    const release = await holdWrite(packId);
    try {
      if (zip.size > packCap()) throw new RadioFailure('trop-gros');
      if (!(await hasRoom(zip.size))) throw new RadioFailure('place');
      let last = 0;
      await writeStream(file, zip.stream(), (written) => {
        if (performance.now() - last > 200) {
          last = performance.now();
          patchJob({ done: written });
        }
      });
      messages.push(
        await indexZip({
          packId,
          file,
          origin: 'fichier',
          label: zip.name,
          fallbackName: zip.name.replace(/\.zip$/i, ''),
        }),
      );
    } catch (error) {
      await removeFile(file);
      failJob(toFailure(error));
      return;
    } finally {
      release();
    }
  }
  if (songs.length > 0) {
    try {
      messages.push(await addSongs(songs));
    } catch (error) {
      failJob(toFailure(error));
      return;
    }
  }
  if (zips.length === 0 && songs.length === 0) {
    setJob({ kind: 'fichier', label: files[0]?.name ?? '', phase: 'erreur', done: 0, total: null, fail: failInfo('pas-un-pack') });
    return;
  }
  setJob({ kind: 'fichier', label: '', phase: 'fini', done: 0, total: null, message: messages.join(' ') });
}

async function addSongs(songs: File[]): Promise<string> {
  setJob({ kind: 'morceaux', label: 'Ma playlist', phase: 'copie', done: 0, total: songs.length });
  const release = await holdWrite('piste');
  const written: string[] = [];
  try {
    const current = useRadio.getState().catalog.stations.find((station) => station.id === PLAYLIST_ID);
    const known = new Set(current?.tracks.map((track) => track.path));
    const fresh: { track: Track; bytes: number }[] = [];
    for (const song of songs) {
      if (known.has(song.name)) continue;
      known.add(song.name);
      const id = newId('t');
      const name = `piste-${id}.${extensionOf(song.name) || 'audio'}`;
      written.push(name);
      await writeStream(name, song.stream());
      const track: Track = { id, path: song.name, file: name, mime: song.type || mimeOf(song.name), title: '' };
      fresh.push({ track: withTags(track, await readTags(track)), bytes: song.size });
      patchJob({ done: fresh.length });
    }
    let added: Track[] = [];
    let station: Station | null = null;
    let dropped: string[] = [];
    if (fresh.length > 0) {
      await commitCatalog((latest) => {
        const change = withSongs(latest, fresh);
        added = change.added;
        station = change.station;
        dropped = change.dropped;
        return change.catalog;
      });
    }
    // Morceau ajouté entre-temps par un autre onglet : la copie faite ici part.
    for (const name of dropped) await removeFile(name);
    void askPersistentStorage();
    void refreshStorage();
    if (added.length > 0 && station) autoStart([station]);
    return added.length === 1 ? '1 morceau ajouté à «\u00a0Ma playlist\u00a0».' : `${added.length} morceaux ajoutés à «\u00a0Ma playlist\u00a0».`;
  } catch (error) {
    const owned = new Set(useRadio.getState().catalog.packs.flatMap((pack) => pack.files));
    for (const name of written) if (!owned.has(name)) await removeFile(name);
    throw error;
  } finally {
    release();
  }
}

// ——— Lecture automatique ———

/** Réglage « Lecture automatique » relu ; avant la relecture de la sauvegarde, on attend. */
export function settingsReady(): Promise<void> {
  if (useSettings.getState().hydrated) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = useSettings.subscribe((state) => {
      if (!state.hydrated) return;
      stop();
      resolve();
    });
  });
}

function autoPlayAllowed(): boolean {
  return useSettings.getState().autoPlay && !useRadio.getState().now?.playing;
}

/** Après un import réussi : la station de départ joue, si le réglage le permet et si rien ne joue. */
function autoStart(stations: Station[], depart?: string): void {
  if (!autoPlayAllowed()) return;
  const index = pickStart(stations.map((station) => ({ folder: station.folder, count: station.tracks.length })), depart);
  const first = stations[index];
  if (first) void playStation(first.id);
}

/** Lien vers un pack déjà là : ses stations jouent, comme après un import. */
export function startPack(packId: string): void {
  const { catalog } = useRadio.getState();
  const pack = catalog.packs.find((item) => item.id === packId);
  autoStart(catalog.stations.filter((station) => station.packId === packId), pack?.depart);
}

/** Ouverture de l'app : reprise de la dernière station (et de son morceau), sinon la station de départ. */
export async function autoStartOnOpen(): Promise<void> {
  await Promise.all([initRadio(), settingsReady()]);
  if (!autoPlayAllowed()) return;
  const { catalog, lastStationId, lastTrackId } = useRadio.getState();
  if (catalog.stations.length === 0) return;
  const last = catalog.stations.find((station) => station.id === lastStationId);
  if (last) {
    const track = last.tracks.some((item) => item.id === lastTrackId) ? (lastTrackId ?? undefined) : undefined;
    void playStation(last.id, track);
    return;
  }
  // Pack le plus récent d'abord : sa station de départ, sinon la plus fournie de toute la radio.
  for (const pack of [...catalog.packs].reverse()) {
    const wanted = pack.depart && catalog.stations.find((s) => s.packId === pack.id && s.folder === pack.depart);
    if (wanted) {
      void playStation(wanted.id);
      return;
    }
  }
  autoStart(catalog.stations);
}

// ——— Téléchargement depuis une adresse ———

interface PartialDownload {
  url: string;
  host: string;
  packId: string;
  file: string;
  received: number;
  total: number | null;
  /** Lève le verrou d'import (téléchargement fini, abandonné ou indexé). */
  release: () => void;
}

let partial: PartialDownload | null = null;
let controller: AbortController | null = null;
let wakeLock: { release(): Promise<void> } | null = null;

async function holdScreen(on: boolean): Promise<void> {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await (navigator as Navigator & { wakeLock: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock.request('screen');
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    wakeLock = null;
  }
}

/** Une requête refusée sans réponse lisible : réseau coupé, hôte introuvable, ou CORS ? */
async function classifyFetchError(url: string): Promise<FailCode> {
  const offline = () => navigator.onLine === false;
  if (offline()) return 'reseau';
  try {
    // Requête « opaque » : elle aboutit si l'hôte répond, même sans autorisation CORS.
    await fetch(url, { mode: 'no-cors', method: 'HEAD', cache: 'no-store' });
    return 'cors';
  } catch {
    return offline() ? 'reseau' : 'introuvable';
  }
}

function nameFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? 'pack';
    return decodeURIComponent(last).replace(/\.zip$/i, '') || 'pack';
  } catch {
    return 'pack';
  }
}

function startOfContentRange(response: Response): { start: number; total: number | null } | null {
  const match = /bytes\s+(\d+)-\d+\/(\d+|\*)/i.exec(response.headers.get('Content-Range') ?? '');
  if (!match) return null;
  return { start: Number(match[1]), total: match[2] === '*' ? null : Number(match[2]) };
}

function looksLikeZip(chunk: Uint8Array): boolean {
  return chunk.length >= 4 && chunk[0] === 0x50 && chunk[1] === 0x4b && (chunk[2] === 3 || chunk[2] === 5) && (chunk[3] === 4 || chunk[3] === 6);
}

/** Pack déjà importé depuis cette adresse (avant l'appui : l'adresse seule, aucune requête). */
export function findPackByUrl(url: string): Pack | undefined {
  return useRadio.getState().catalog.packs.find((pack) => pack.url === url);
}

/** Poids annoncé par l'hébergement (requête HEAD, rien n'est téléchargé), ou `null` sans réponse claire. */
export async function remoteSize(url: string): Promise<number | null> {
  try {
    const response = await fetch(url, { method: 'HEAD', mode: 'cors', cache: 'no-store' });
    const length = Number(response.headers.get('Content-Length'));
    return response.ok && length > 0 && !response.headers.get('Content-Encoding') ? length : null;
  } catch {
    return null;
  }
}

/** Même adresse et même poids (connu une fois la réponse reçue) : inutile de télécharger. */
export function findSamePack(url: string, bytes: number | null): Pack | undefined {
  return useRadio.getState().catalog.packs.find((pack) => pack.url === url && bytes !== null && pack.sourceBytes === bytes);
}

/**
 * Télécharge un pack dans le stockage privé, en flux. `reprise` : repart de la coupure par
 * une requête Range. Le téléchargement survit à la fermeture du panneau (garder l'app ouverte).
 */
export async function downloadPack(rawUrl: string, mode: 'neuf' | 'reprise' = 'neuf'): Promise<void> {
  await initRadio();
  if (busy() || useRadio.getState().status !== 'pret') return;
  const check = checkPackUrl(rawUrl);
  if (!check.ok) {
    setJob({ kind: 'adresse', label: rawUrl.slice(0, 80), phase: 'erreur', done: 0, total: null, fail: failInfo('adresse') });
    return;
  }
  const { url, host } = check;
  let p = mode === 'reprise' && partial?.url === url ? partial : null;
  if (!p) {
    await dropPartial();
    const packId = newId('pack');
    p = { url, host, packId, file: `${packId}.zip`, received: 0, total: null, release: await holdWrite(packId) };
    partial = p;
  }
  const job: Job = { kind: 'adresse', label: host, url, phase: 'telechargement', done: p.received, total: p.total };
  setJob(job);
  controller = new AbortController();
  const { signal } = controller;
  void holdScreen(true);
  try {
    await runDownload(p, signal);
  } finally {
    controller = null;
    void holdScreen(false);
  }
}

async function dropPartial(): Promise<void> {
  const p = partial;
  partial = null;
  if (!p) return;
  await removeFile(p.file);
  p.release();
}

async function runDownload(p: PartialDownload, signal: AbortSignal): Promise<void> {
  let response: Response;
  try {
    response = await fetch(p.url, {
      mode: 'cors',
      cache: 'no-store',
      signal,
      headers: p.received > 0 ? { Range: `bytes=${p.received}-` } : undefined,
    });
  } catch {
    if (signal.aborted) return;
    failJob(p.received > 0 ? 'coupure' : await classifyFetchError(p.url));
    return;
  }
  if (!response.ok || !response.body) {
    void response.body?.cancel();
    if (p.received > 0 && response.status === 416) {
      failJob('reprise');
      return;
    }
    await dropPartial();
    failJob(response.status === 404 || response.status === 410 ? 'introuvable' : 'serveur');
    return;
  }

  let offset = 0;
  if (p.received > 0) {
    const range = startOfContentRange(response);
    if (response.status !== 206 || range?.start !== p.received) {
      void response.body.cancel();
      failJob('reprise');
      return;
    }
    offset = p.received;
    p.total = range.total ?? p.total;
    if (p.total !== null && p.total > packCap()) {
      void response.body.cancel();
      await dropPartial();
      failJob('trop-gros');
      return;
    }
  } else {
    const length = Number(response.headers.get('Content-Length'));
    p.total = length > 0 && !response.headers.get('Content-Encoding') ? length : null;
    const same = findSamePack(p.url, p.total);
    if (same) {
      void response.body.cancel();
      await dropPartial();
      setJob({ kind: 'adresse', label: p.host, phase: 'fini', done: 0, total: null, message: 'Ce pack est déjà dans ta radio : rien à télécharger.' });
      return;
    }
    if (p.total !== null && p.total > packCap()) {
      void response.body.cancel();
      await dropPartial();
      failJob('trop-gros');
      return;
    }
    if (p.total !== null && !(await hasRoom(p.total))) {
      void response.body.cancel();
      await dropPartial();
      failJob('place');
      return;
    }
  }
  patchJob({ total: p.total, done: offset });

  const writable = await (await fileHandle(p.file)).createWritable({ keepExistingData: offset > 0 });
  if (offset > 0) await writable.seek(offset);
  const reader = response.body.getReader();
  let received = offset;
  let last = 0;
  const cap = packCap();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (received === 0 && !looksLikeZip(value)) throw new RadioFailure('pas-un-pack');
      // Coupé au-delà de la taille annoncée (l'hébergement répond de travers) ou du plafond (flux sans fin).
      if (p.total !== null && received + value.length > p.total) throw new RadioFailure('serveur');
      if (received + value.length > cap) throw new RadioFailure('trop-gros');
      await writable.write(value as Uint8Array<ArrayBuffer>);
      received += value.length;
      p.received = received;
      if (performance.now() - last > 250) {
        last = performance.now();
        patchJob({ done: received });
      }
    }
    await writable.close();
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    if (signal.aborted || error instanceof RadioFailure || isQuotaError(error)) {
      await writable.abort().catch(() => undefined);
      await dropPartial();
      if (signal.aborted) setJob(null);
      else failJob(toFailure(error));
      return;
    }
    // Coupure du réseau : on garde ce qui est arrivé, la suite viendra par une requête Range.
    await writable.close().catch(() => writable.abort().catch(() => undefined));
    p.received = await fileSize(p.file);
    failJob('coupure', { done: p.received });
    return;
  }
  if (p.total !== null && received < p.total) {
    p.received = received;
    failJob('coupure', { done: received });
    return;
  }

  partial = null;
  try {
    const message = await indexZip({
      packId: p.packId,
      file: p.file,
      origin: 'adresse',
      url: p.url,
      label: p.host,
      fallbackName: nameFromUrl(p.url),
    });
    setJob({ kind: 'adresse', label: p.host, phase: 'fini', done: 0, total: null, message });
  } catch (error) {
    failJob(toFailure(error));
  } finally {
    p.release();
  }
}

/** Annule le téléchargement en cours (le fichier partiel est effacé). */
export function cancelDownload(): void {
  if (controller) controller.abort();
  else {
    void dropPartial();
    setJob(null);
  }
}

/** Ferme le bandeau d'un import terminé ou en échec. */
export function dismissJob(): void {
  if (busy()) return;
  if (useRadio.getState().job?.phase === 'coupure') void dropPartial();
  setJob(null);
}

// ——— Suppression ———

async function dropStations(drop: (station: Station) => boolean): Promise<void> {
  let removed: Station[] = [];
  let orphans: Pack[] = [];
  await commitCatalog((current) => {
    const change = withoutStations(current, drop);
    removed = change.removed;
    orphans = change.orphans;
    return change.catalog;
  });
  stopPlayback(removed.map((station) => station.id));
  for (const orphan of orphans) for (const name of orphan.files) await removeFile(name);
  void refreshStorage();
}

/** Supprime une station ; le pack part avec sa dernière station, et sa place est libérée. */
export async function deleteStation(stationId: string): Promise<void> {
  await dropStations((station) => station.id === stationId);
}

/** Supprime un pack entier (toutes ses stations) et libère sa place. */
export async function deletePack(packId: string): Promise<void> {
  await dropStations((station) => station.packId === packId);
}
