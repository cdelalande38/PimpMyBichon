// Entrée de la musique : pack choisi dans les fichiers du téléphone, pack téléchargé depuis une
// adresse (écrit en flux dans le stockage privé, avec reprise), morceaux isolés (« Ma playlist »).
// Un pack sans compression reste tel quel : chaque morceau est lu comme une tranche du ZIP.

import { askPersistentStorage } from '../../state/persistence.ts';
import { commitCatalog, loadPrefs, useRadio, type FailCode, type FailInfo, type Job } from '../../state/radio.ts';
import { loadCatalog, newId, PLAYLIST_ID, type Catalog, type Pack, type PackOrigin, type Station, type Track } from './catalog.ts';
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
import { extensionOf, isAudioPath, mimeOf, planStations } from './pack.ts';
import { stopPlayback } from './player.ts';
import { entryBytes, entryRange, entryStream, readZipEntries, ZipError } from './zip.ts';

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
    useRadio.setState({ ...prefs, catalog, status: 'pret' });
    void cleanOrphans(catalog);
    void refreshStorage();
  } catch {
    useRadio.setState({ status: 'indisponible' });
  }
}

async function cleanOrphans(catalog: Catalog): Promise<void> {
  try {
    const owned = new Set(catalog.packs.flatMap((pack) => pack.files));
    for (const name of await listFiles()) {
      if (!owned.has(name) && name !== partial?.file) await removeFile(name);
    }
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
          await writeStream(name, await entryStream(zip, entry));
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
    await addPack(pack, stations);
    const names = stations.map((station) => `«\u00a0${station.name}\u00a0»`).join(', ');
    return stations.length > 1 ? `Stations ajoutées : ${names}.` : `Station ajoutée : ${names}.`;
  } catch (error) {
    for (const name of files) await removeFile(name);
    throw error;
  }
}

/** Range un pack : ses stations remplacent celles de même dossier (réimport sans doublon). */
async function addPack(pack: Pack, stations: Station[]): Promise<void> {
  const { catalog } = useRadio.getState();
  const folders = new Set(stations.map((station) => station.folder));
  const replaced = catalog.stations.filter((station) => station.packId !== PLAYLIST_ID && folders.has(station.folder));
  stopPlayback(replaced.map((station) => station.id));
  const kept = catalog.stations.filter((station) => !replaced.includes(station));
  const inUse = new Set(kept.map((station) => station.packId));
  const orphans = catalog.packs.filter((item) => !inUse.has(item.id));
  await commitCatalog({
    packs: [...catalog.packs.filter((item) => !orphans.includes(item)), pack],
    stations: [...kept, ...stations],
  });
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
    try {
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
  const { catalog } = useRadio.getState();
  const current = catalog.stations.find((station) => station.id === PLAYLIST_ID);
  const known = new Set(current?.tracks.map((track) => track.path));
  const pack: Pack = catalog.packs.find((item) => item.id === PLAYLIST_ID) ?? {
    id: PLAYLIST_ID,
    origin: 'morceaux',
    label: 'Ma playlist',
    files: [],
    sourceBytes: 0,
    bytes: 0,
    importedAt: Date.now(),
  };
  const tracks = [...(current?.tracks ?? [])];
  const files = [...pack.files];
  let bytes = pack.bytes;
  let added = 0;
  for (const song of songs) {
    if (known.has(song.name)) continue;
    const id = newId('t');
    const name = `piste-${id}.${extensionOf(song.name) || 'audio'}`;
    try {
      await writeStream(name, song.stream());
    } catch (error) {
      await removeFile(name);
      throw error;
    }
    files.push(name);
    bytes += song.size;
    const track: Track = { id, path: song.name, file: name, mime: song.type || mimeOf(song.name), title: '' };
    tracks.push(withTags(track, await readTags(track)));
    added += 1;
    patchJob({ done: added });
  }
  const station: Station = { id: PLAYLIST_ID, packId: PLAYLIST_ID, folder: PLAYLIST_ID, name: 'Ma playlist', tracks };
  const latest = useRadio.getState().catalog;
  await commitCatalog({
    packs: [...latest.packs.filter((item) => item.id !== PLAYLIST_ID), { ...pack, files, bytes, sourceBytes: bytes }],
    stations: [...latest.stations.filter((item) => item.id !== PLAYLIST_ID), station],
  });
  void askPersistentStorage();
  void refreshStorage();
  return added === 1 ? '1 morceau ajouté à «\u00a0Ma playlist\u00a0».' : `${added} morceaux ajoutés à «\u00a0Ma playlist\u00a0».`;
}

// ——— Téléchargement depuis une adresse ———

interface PartialDownload {
  url: string;
  host: string;
  packId: string;
  file: string;
  received: number;
  total: number | null;
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
    if (partial) await removeFile(partial.file);
    const packId = newId('pack');
    p = { url, host, packId, file: `${packId}.zip`, received: 0, total: null };
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
  if (partial) await removeFile(partial.file);
  partial = null;
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
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (received === 0 && !looksLikeZip(value)) throw new RadioFailure('pas-un-pack');
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

async function dropStations(ids: Set<string>): Promise<void> {
  const { catalog } = useRadio.getState();
  stopPlayback([...ids]);
  const stations = catalog.stations.filter((station) => !ids.has(station.id));
  const inUse = new Set(stations.map((station) => station.packId));
  const orphans = catalog.packs.filter((pack) => !inUse.has(pack.id));
  await commitCatalog({ packs: catalog.packs.filter((pack) => inUse.has(pack.id)), stations });
  for (const orphan of orphans) for (const name of orphan.files) await removeFile(name);
  void refreshStorage();
}

/** Supprime une station ; le pack part avec sa dernière station, et sa place est libérée. */
export async function deleteStation(stationId: string): Promise<void> {
  await dropStations(new Set([stationId]));
}

/** Supprime un pack entier (toutes ses stations) et libère sa place. */
export async function deletePack(packId: string): Promise<void> {
  const { catalog } = useRadio.getState();
  await dropStations(new Set(catalog.stations.filter((s) => s.packId === packId).map((s) => s.id)));
}
