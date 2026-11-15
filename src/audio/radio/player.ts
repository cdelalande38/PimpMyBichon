// Lecteur de la radio : deux éléments audio pour un fondu enchaîné court entre deux morceaux,
// commandes de l'écran verrouillé (Media Session). La lecture peut démarrer toute seule (ouverture,
// fin d'import) ; si le navigateur refuse de jouer sans geste, la station reste prête et part au
// premier appui n'importe où dans l'app. La musique continue panneau fermé.

import { recordDuration, setPrefs, useRadio } from '../../state/radio.ts';
import type { Station, Track } from './catalog.ts';
import { trackBlob } from './opfs.ts';
import { PlayQueue } from './order.ts';

/** Durée du fondu enchaîné, en secondes. */
const FADE_S = 2;

interface Deck {
  el: HTMLAudioElement;
  url: string | null;
  track: Track | null;
  gain: number;
}

let decks: [Deck, Deck] | null = null;
let active = 0;
let station: Station | null = null;
let queue: PlayQueue | null = null;
let fadeTimer: ReturnType<typeof setInterval> | null = null;
let fadingOut: Deck | null = null;
/** Jeton du dernier démarrage demandé : un chargement dépassé ne prend pas la main. */
let token = 0;
let errors = 0;
/** Retire l'écoute « premier appui » (posée une seule fois). */
let disarmTap: (() => void) | null = null;

/** Commandes de la radio : elles lancent la musique elles-mêmes, l'écoute globale les laisse faire. */
const RADIO_CONTROLS = '.radio-mini button, .radio-player button, .radio-station-head button, .radio-tracks button';

function clearTap(): void {
  disarmTap?.();
  disarmTap = null;
  if (useRadio.getState().waitingTap) useRadio.setState({ waitingTap: false });
}

/** Lecture refusée sans geste : « Touche pour lancer la musique », départ au premier appui. */
function armTapToPlay(): void {
  useRadio.setState({ waitingTap: true });
  if (disarmTap || typeof document === 'undefined') return;
  const onTap = (event: Event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(RADIO_CONTROLS)) return;
    clearTap();
    void resume();
  };
  // pointerup : geste reconnu au toucher comme à la souris ; keydown pour le clavier.
  document.addEventListener('pointerup', onTap, true);
  document.addEventListener('keydown', onTap, true);
  disarmTap = () => {
    document.removeEventListener('pointerup', onTap, true);
    document.removeEventListener('keydown', onTap, true);
  };
}

function master(): number {
  return useRadio.getState().volume;
}

function applyGain(deck: Deck): void {
  deck.el.volume = Math.min(1, Math.max(0, master() * deck.gain));
}

function unload(deck: Deck): void {
  deck.el.pause();
  deck.el.removeAttribute('src');
  deck.el.load();
  if (deck.url) URL.revokeObjectURL(deck.url);
  deck.url = null;
  deck.track = null;
}

function isActive(deck: Deck): boolean {
  return decks !== null && decks[active] === deck;
}

function publish(): void {
  const deck = decks?.[active];
  const track = deck?.track;
  if (!station || !track || !deck) {
    useRadio.setState({ now: null });
    return;
  }
  const playing = !deck.el.paused;
  useRadio.setState({
    now: { stationId: station.id, trackId: track.id, title: track.title, artist: track.artist, playing },
  });
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  }
}

function setMetadata(track: Track): void {
  if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist ?? '',
    album: station?.name ?? 'Radio',
  });
}

function ensureDecks(): [Deck, Deck] {
  if (decks) return decks;
  const make = (): Deck => {
    const el = new Audio();
    el.preload = 'auto';
    const deck: Deck = { el, url: null, track: null, gain: 1 };
    el.addEventListener('timeupdate', () => {
      if (!isActive(deck)) return;
      const position = Math.floor(el.currentTime);
      const duration = Number.isFinite(el.duration) ? Math.round(el.duration) : null;
      const clock = useRadio.getState().clock;
      if (clock.position !== position || clock.duration !== duration) useRadio.setState({ clock: { position, duration } });
      if (fadingOut || !Number.isFinite(el.duration)) return;
      if (el.duration > FADE_S * 4 && el.duration - el.currentTime <= FADE_S) void advance(1, true);
    });
    el.addEventListener('ended', () => {
      if (isActive(deck)) void advance(1, false);
    });
    el.addEventListener('loadedmetadata', () => {
      if (deck.track && deck.track.duration === undefined) recordDuration(deck.track.id, el.duration);
    });
    el.addEventListener('playing', () => {
      if (!isActive(deck)) return;
      errors = 0;
      clearTap();
    });
    el.addEventListener('play', () => isActive(deck) && publish());
    el.addEventListener('pause', () => isActive(deck) && publish());
    el.addEventListener('error', () => {
      if (!isActive(deck) || !deck.track) return;
      errors += 1;
      if (station && errors < station.tracks.length) {
        setTimeout(() => void advance(1, false), 400);
      } else {
        stopPlayback();
      }
    });
    return deck;
  };
  decks = [make(), make()];
  if ('mediaSession' in navigator) {
    const handlers: [MediaSessionAction, () => void][] = [
      ['play', () => void resume()],
      ['pause', () => pause()],
      ['nexttrack', () => void next()],
      ['previoustrack', () => void previous()],
    ];
    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Action inconnue de ce navigateur.
      }
    }
  }
  return decks;
}

function finishFade(): void {
  if (fadeTimer) clearInterval(fadeTimer);
  fadeTimer = null;
  if (fadingOut) unload(fadingOut);
  fadingOut = null;
  const deck = decks?.[active];
  if (deck) {
    deck.gain = 1;
    applyGain(deck);
  }
}

function crossfade(outgoing: Deck, incoming: Deck): void {
  fadingOut = outgoing;
  const t0 = performance.now();
  fadeTimer = setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / (FADE_S * 1000));
    incoming.gain = k;
    outgoing.gain = 1 - k;
    applyGain(incoming);
    applyGain(outgoing);
    if (k >= 1) finishFade();
  }, 50);
}

async function startTrack(index: number, fade: boolean): Promise<void> {
  const all = ensureDecks();
  const track = station?.tracks[index];
  if (!station || !track) return;
  const my = (token += 1);
  finishFade();
  // Le morceau suivant se charge toujours sur l'autre élément : on ne recharge jamais celui qui joue.
  const current = all[active]!;
  const incoming = current.track ? all[1 - active]! : current;
  const outgoing = incoming !== current ? current : null;

  let url: string;
  try {
    url = URL.createObjectURL(await trackBlob(track));
  } catch {
    // Fichier disparu du stockage privé : on passe au suivant, sans boucler.
    errors += 1;
    if (my === token && errors < station.tracks.length) await advance(1, false);
    else if (my === token) stopPlayback();
    return;
  }
  if (my !== token) {
    URL.revokeObjectURL(url);
    return;
  }
  if (incoming.url) URL.revokeObjectURL(incoming.url);
  incoming.url = url;
  incoming.track = track;
  incoming.el.src = url;
  incoming.gain = fade ? 0 : 1;
  applyGain(incoming);
  active = all.indexOf(incoming);
  useRadio.setState({ clock: { position: 0, duration: track.duration ? Math.round(track.duration) : null } });
  setMetadata(track);
  setPrefs({ lastStationId: station.id, lastTrackId: track.id });
  if (outgoing && !fade) unload(outgoing);
  publish();
  try {
    await incoming.el.play();
  } catch (error) {
    if (my === token && error instanceof DOMException && error.name === 'NotAllowedError') armTapToPlay();
    publish();
    return;
  }
  if (outgoing && fade && my === token) crossfade(outgoing, incoming);
  publish();
}

async function advance(step: 1 | -1, fade: boolean): Promise<void> {
  if (!queue || !station) return;
  const index = step === 1 ? queue.next() : queue.previous();
  await startTrack(index, fade);
}

/** Lance une station (sur un geste), éventuellement sur un morceau précis. */
export async function playStation(stationId: string, trackId?: string): Promise<void> {
  const target = useRadio.getState().catalog.stations.find((item) => item.id === stationId);
  if (!target) return;
  station = target;
  errors = 0;
  const start = Math.max(0, trackId ? target.tracks.findIndex((track) => track.id === trackId) : 0);
  queue = new PlayQueue(target.tracks.length, useRadio.getState().shuffle, start);
  await startTrack(queue.current, false);
}

/** Lecture : reprend le morceau en pause, sinon la dernière station écoutée. */
export async function resume(): Promise<void> {
  const deck = decks?.[active];
  if (deck?.track && station) {
    try {
      await deck.el.play();
    } catch (error) {
      // Lecture refusée : l'interface reste sur « pause », la musique attend le premier appui.
      if (error instanceof DOMException && error.name === 'NotAllowedError') armTapToPlay();
    }
    publish();
    return;
  }
  const { lastStationId, lastTrackId, catalog } = useRadio.getState();
  const last = catalog.stations.find((item) => item.id === lastStationId) ?? catalog.stations[0];
  if (last) await playStation(last.id, last.id === lastStationId ? (lastTrackId ?? undefined) : undefined);
}

export function pause(): void {
  if (fadingOut) finishFade();
  decks?.[active]?.el.pause();
  publish();
}

export async function togglePlay(): Promise<void> {
  const deck = decks?.[active];
  if (deck?.track && !deck.el.paused) pause();
  else await resume();
}

export async function next(): Promise<void> {
  await advance(1, false);
}

export async function previous(): Promise<void> {
  const deck = decks?.[active];
  if (deck && deck.el.currentTime > 3) {
    deck.el.currentTime = 0;
    return;
  }
  await advance(-1, false);
}

export function setVolume(volume: number): void {
  setPrefs({ volume: Math.min(1, Math.max(0, volume)) });
  if (decks) for (const deck of decks) applyGain(deck);
}

export function setShuffle(shuffle: boolean): void {
  setPrefs({ shuffle });
  queue?.setShuffle(shuffle);
}

/** Arrête tout (station supprimée ou remplacée). Sans argument : quelle que soit la station. */
export function stopPlayback(stationIds?: readonly string[]): void {
  if (stationIds && (!station || !stationIds.includes(station.id))) return;
  token += 1;
  clearTap();
  finishFade();
  if (decks) for (const deck of decks) unload(deck);
  station = null;
  queue = null;
  useRadio.setState({ now: null });
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = 'none';
  }
}

/** Position de lecture du morceau en cours, en secondes (pour les parcours et l'affichage). */
export function currentTime(): number {
  return decks?.[active]?.el.currentTime ?? 0;
}
