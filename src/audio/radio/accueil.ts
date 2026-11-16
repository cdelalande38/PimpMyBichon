// Station d'accueil : de la musique servie par l'app elle-même, qui joue pendant que le premier pack
// arrive, puis lui laisse la place. Chaque dossier public/assets/audio/radio/<dossier>/ qui porte un
// station.json devient une station « de base » : ses morceaux sont lus en flux depuis le site (gardés
// par le service worker à la première écoute), jamais copiés dans le stockage privé, et elle ne se
// supprime pas. Ajouter ou retirer un morceau : déposer ou retirer le fichier, et sa ligne dans
// station.json (npm run radio:accueil la réécrit) ; aucun code à toucher.
//
// Règle de bascule (décidée pour cette station, appliquée par library.ts) :
// - elle ne part toute seule que si la radio n'a encore aucun pack : à l'ouverture de l'app, ou au
//   début d'un téléchargement ou d'un import ; jamais si le réglage « Lecture automatique » est coupé ;
// - quand un pack est prêt, la radio passe en fondu sur la station que l'app choisit d'habitude (celle
//   du champ « depart », sinon la plus fournie) ;
// - un geste de l'utilisateur sur la station d'accueil (pause, morceau suivant ou précédent, choix de
//   la station ou d'un de ses morceaux) annule cette bascule : le pack arrive, le bandeau le dit, et
//   c'est lui qui change de station. Toucher l'écran pour lancer la musique, ou appuyer sur Lecture,
//   n'est pas un choix de station : la bascule reste prévue.

import type { Catalog, Station, Track } from './catalog.ts';
import { isAudioPath, mimeOf } from './pack.ts';

/** Valeur du champ « format » de station.json. */
export const STATION_FORMAT = 'pmb-station';

/** Dossier des stations de base, relatif à la racine du site. */
export const BUILTIN_DIR = 'assets/audio/radio/';

const MANIFESTS = import.meta.glob<unknown>('../../../public/assets/audio/radio/*/station.json', {
  eager: true,
  import: 'default',
});

const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/** Un nom de fichier simple, rangé dans le dossier de la station (ni chemin, ni remontée). */
function plainFile(value: unknown): value is string {
  return text(value) && !/[\\/]/.test(value) && value !== '.' && value !== '..' && isAudioPath(value);
}

/**
 * Lecture tolérante d'un station.json : un morceau mal décrit est écarté, une station sans morceau
 * n'existe pas. `base` : racine du site (import.meta.env.BASE_URL).
 */
export function readStationManifest(raw: unknown, folder: string, base: string): Station | null {
  if (typeof raw !== 'object' || raw === null || !/^[a-z0-9][a-z0-9-]*$/.test(folder)) return null;
  const data = raw as Record<string, unknown>;
  if (data.format !== STATION_FORMAT || data.version !== 1) return null;
  const seen = new Set<string>();
  const tracks: Track[] = [];
  for (const item of Array.isArray(data.morceaux) ? data.morceaux : []) {
    if (typeof item !== 'object' || item === null) continue;
    const m = item as Record<string, unknown>;
    if (!plainFile(m.fichier) || seen.has(m.fichier)) continue;
    seen.add(m.fichier);
    const track: Track = {
      id: `${folder}/${m.fichier}`,
      path: m.fichier,
      file: m.fichier,
      src: `${base}${BUILTIN_DIR}${folder}/${encodeURIComponent(m.fichier)}`,
      title: text(m.titre) ? m.titre.trim() : m.fichier.replace(/\.[^.]+$/, ''),
      mime: mimeOf(m.fichier),
    };
    if (text(m.artiste)) track.artist = m.artiste.trim();
    if (typeof m.duree === 'number' && Number.isFinite(m.duree) && m.duree > 0) track.duration = m.duree;
    tracks.push(track);
  }
  if (tracks.length === 0) return null;
  const name = text(data.nom) ? data.nom.trim() : folder;
  return { id: folder, packId: `app-${folder}`, folder, name, tracks, builtin: true };
}

/** Stations de base trouvées au build, dans l'ordre alphabétique des dossiers. */
export function readBuiltins(manifests: Record<string, unknown>, base: string): Station[] {
  return Object.entries(manifests)
    .map(([path, raw]) => ({ folder: /\/([^/]+)\/station\.json$/.exec(path)?.[1] ?? '', raw }))
    .sort((a, b) => (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0))
    .map(({ folder, raw }) => readStationManifest(raw, folder, base))
    .filter((station): station is Station => station !== null);
}

export const BUILTIN_STATIONS: readonly Station[] = Object.freeze(readBuiltins(MANIFESTS, import.meta.env.BASE_URL));

/** Index en mémoire : celui du disque, suivi des stations de base (jamais enregistrées). */
export function withBuiltins(catalog: Catalog, builtins: readonly Station[] = BUILTIN_STATIONS): Catalog {
  if (builtins.length === 0) return catalog;
  return { packs: catalog.packs, stations: [...catalog.stations.filter((station) => !station.builtin), ...builtins] };
}

/** Stations venues des packs et de « Ma playlist » (sans les stations de base). */
export function packStations(catalog: Catalog): Station[] {
  return catalog.stations.filter((station) => !station.builtin);
}

/** Station de base de l'index (la première), ou undefined. */
export function welcomeStation(catalog: Catalog): Station | undefined {
  return catalog.stations.find((station) => station.builtin);
}

export function isBuiltinId(catalog: Catalog, stationId: string | null | undefined): boolean {
  return stationId !== null && stationId !== undefined && catalog.stations.some((station) => station.id === stationId && station.builtin);
}

// ——— Règle de bascule ———

/** L'utilisateur a touché à la station d'accueil pendant cette session : plus de bascule automatique. */
let touched = false;

export function welcomeTouched(): boolean {
  return touched;
}

/** Pause, morceau suivant ou précédent : un geste, s'il vise la station d'accueil. */
export function noteWelcomeGesture(onWelcome: boolean): void {
  if (onWelcome) touched = true;
}

/** Choix d'une station (ou d'un de ses morceaux) par l'utilisateur. */
export function noteStationChoice(welcome: boolean): void {
  touched = welcome;
}

/** Remise à zéro (tests). */
export function resetWelcomeGestures(): void {
  touched = false;
}

interface Moment {
  /** Réglage « Lecture automatique ». */
  autoPlay: boolean;
  /** Morceau chargé (en lecture, en pause, ou en attente d'un appui), ou null. */
  now: { stationId: string; playing: boolean } | null;
  /** Le morceau chargé appartient à la station d'accueil. */
  onWelcome: boolean;
  /** Geste de l'utilisateur sur la station d'accueil. */
  touched: boolean;
}

/** La station d'accueil part-elle toute seule ? (ouverture, début d'un téléchargement ou d'un import) */
export function shouldStartWelcome(moment: Omit<Moment, 'onWelcome'> & { hasWelcome: boolean; hasPacks: boolean }): boolean {
  return moment.autoPlay && moment.hasWelcome && !moment.hasPacks && moment.now === null && !moment.touched;
}

/**
 * Un pack (ou « Ma playlist ») vient d'arriver : la radio passe-t-elle dessus toute seule ?
 * Sur la station d'accueil, oui tant que l'utilisateur n'y a pas touché (qu'elle joue ou qu'elle
 * attende le premier appui) ; ailleurs, la règle d'avant : seulement si rien ne joue.
 */
export function shouldStartPack(moment: Moment): boolean {
  if (!moment.autoPlay) return false;
  if (moment.now && moment.onWelcome) return !moment.touched;
  return !moment.now?.playing;
}
