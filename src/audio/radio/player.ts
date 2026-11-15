// Lecteur de la radio : deux éléments audio pour un fondu enchaîné court entre deux morceaux,
// commandes de l'écran verrouillé (Media Session). La lecture peut démarrer toute seule (ouverture,
// fin d'import) ; si le navigateur refuse de jouer sans geste, la station reste prête et part au
// premier appui n'importe où dans l'app. La musique continue panneau fermé.
//
// Invariants, après le bogue du silence en arrière-plan :
// - l'élément actif n'est jamais à gain 0 hors d'un fondu réellement en cours (gain remis à 1 si
//   play() échoue, dans resume(), et par un chien de garde qui termine tout fondu resté en plan) ;
// - une seule transition automatique par fin de morceau ;
// - page cachée (autre app, écran verrouillé) : pas de fondu, le morceau suivant se charge sur LE
//   MÊME élément, dans « ended » : un navigateur mobile laisse continuer un élément qui jouait, mais
//   peut refuser d'en démarrer un autre sans geste ;
// - « en lecture » n'est publié que si le son sort vraiment (événement playing), et au retour au
//   premier plan un morceau resté muet ou en attente se remet à jouer avec du son ;
// - l'adresse d'objet du morceau suivant est préparée dès que le morceau courant a démarré : page
//   cachée, « ended » pose src et appelle play() tout de suite, sans rien attendre (une page sans son
//   peut être ralentie ou gelée). Une seule adresse préparée à la fois, libérée si la file change.

import { recordDuration, setPrefs, useRadio } from '../../state/radio.ts';
import type { Station, Track } from './catalog.ts';
import { trackBlob } from './opfs.ts';
import { PlayQueue } from './order.ts';
import { clampPosition } from './position.ts';

/** Durée du fondu enchaîné, en secondes. */
const FADE_S = 2;
/** Pas des boutons « avance » et « recul » de l'écran verrouillé, en secondes. */
const SEEK_STEP_S = 10;
/** Marge du chien de garde au-delà du fondu, en millisecondes. */
const WATCHDOG_MARGIN_MS = 1500;

interface Deck {
  el: HTMLAudioElement;
  url: string | null;
  track: Track | null;
  gain: number;
  /** Le son sort vraiment : événement « playing » reçu depuis le dernier chargement ou la dernière pause. */
  audible: boolean;
}

let decks: [Deck, Deck] | null = null;
let active = 0;
let station: Station | null = null;
let queue: PlayQueue | null = null;
let fadeTimer: ReturnType<typeof setInterval> | null = null;
let watchdog: ReturnType<typeof setTimeout> | null = null;
let fadingOut: Deck | null = null;
/** Jeton du dernier démarrage demandé : un chargement dépassé ne prend pas la main. */
let token = 0;
let errors = 0;
/** Une transition automatique (fin de morceau) est en cours : les suivantes sont ignorées. */
let advancing = false;
/** L'utilisateur veut de la musique (lancée, pas mise en pause) : sert à se rétablir au retour au premier plan. */
let wanted = false;
/** Retire l'écoute « premier appui » (posée une seule fois). */
let disarmTap: (() => void) | null = null;

/** Adresse d'objet du morceau suivant de la file, prête à être posée sans attente. */
interface Prepared {
  stationId: string;
  index: number;
  trackId: string;
  url: string;
}
let prepared: Prepared | null = null;
/** Jeton des préparations : une lecture de fichier dépassée ne garde pas son adresse. */
let prepareToken = 0;

function releasePrepared(): void {
  prepareToken += 1;
  if (prepared) URL.revokeObjectURL(prepared.url);
  prepared = null;
}

/** Prochain morceau de la file (station, position) : celui que next() rendra. */
function upcoming(): { index: number; track: Track } | null {
  if (!station || !queue || station.tracks.length === 0) return null;
  const index = queue.peekNext();
  const track = station.tracks[index];
  return track ? { index, track } : null;
}

/** Prépare (ou garde) l'adresse du morceau suivant ; libère celle qui ne correspond plus à la file. */
function prepareNext(): void {
  const target = upcoming();
  if (prepared && target && prepared.stationId === station?.id && prepared.index === target.index && prepared.trackId === target.track.id) return;
  releasePrepared();
  if (!target || !station) return;
  const my = prepareToken;
  const stationId = station.id;
  void trackBlob(target.track).then(
    (blob) => {
      if (my !== prepareToken) return;
      prepared = { stationId, index: target.index, trackId: target.track.id, url: URL.createObjectURL(blob) };
    },
    () => undefined,
  );
}

/** Reprend l'adresse préparée si elle est celle du morceau demandé (elle passe à l'élément audio). */
function takePrepared(index: number, track: Track): string | null {
  if (!prepared || prepared.stationId !== station?.id || prepared.index !== index || prepared.trackId !== track.id) return null;
  const { url } = prepared;
  prepared = null;
  prepareToken += 1;
  return url;
}

/** Commandes de la radio : elles lancent la musique elles-mêmes, l'écoute globale les laisse faire. */
const RADIO_CONTROLS = '.radio-mini button, .radio-player button, .radio-station-head button, .radio-tracks button';

function pageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function master(): number {
  return useRadio.getState().volume;
}

function applyGain(deck: Deck): void {
  deck.el.volume = Math.min(1, Math.max(0, master() * deck.gain));
}

function fullGain(deck: Deck): void {
  deck.gain = 1;
  applyGain(deck);
}

function unload(deck: Deck): void {
  deck.el.pause();
  deck.el.removeAttribute('src');
  deck.el.load();
  if (deck.url) URL.revokeObjectURL(deck.url);
  deck.url = null;
  deck.track = null;
  deck.audible = false;
}

function activeDeck(): Deck | null {
  return decks?.[active] ?? null;
}

function isActive(deck: Deck): boolean {
  return activeDeck() === deck;
}

function publish(): void {
  const deck = activeDeck();
  const track = deck?.track;
  if (!station || !track || !deck) {
    useRadio.setState({ now: null });
    return;
  }
  // « En lecture » seulement si le son sort : un play() en attente ne compte pas.
  const playing = deck.audible && !deck.el.paused;
  useRadio.setState({
    now: { stationId: station.id, trackId: track.id, title: track.title, artist: track.artist, playing },
  });
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  }
}

/** Durée du morceau actif : celle de l'élément, sinon celle retenue dans l'index ; null si inconnue. */
function durationOf(deck: Deck): number | null {
  const d = deck.el.duration;
  if (Number.isFinite(d) && d > 0) return d;
  return deck.track?.duration ?? null;
}

/** Position fine publiée pour la barre (au dixième de seconde, quatre fois par seconde au plus). */
function publishProgress(deck: Deck): void {
  const time = Math.round(deck.el.currentTime * 10) / 10;
  const duration = durationOf(deck);
  const progress = useRadio.getState().progress;
  if (progress.time !== time || progress.duration !== duration) useRadio.setState({ progress: { time, duration } });
}

/** Position pour l'écran verrouillé : aux changements utiles (chargement, lecture, pause, placement). */
function updatePositionState(): void {
  const deck = activeDeck();
  if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setPositionState !== 'function') return;
  try {
    const duration = deck?.track ? durationOf(deck) : null;
    if (!deck || !duration) {
      navigator.mediaSession.setPositionState();
      return;
    }
    navigator.mediaSession.setPositionState({
      duration,
      playbackRate: deck.el.playbackRate || 1,
      position: Math.min(Math.max(0, deck.el.currentTime), duration),
    });
  } catch {
    // Valeurs refusées par le navigateur (durée en cours de lecture) : on réessaiera au prochain changement.
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

/** Termine tout fondu en cours : l'élément sortant est déchargé, l'actif est remis à plein gain. */
function finishFade(): void {
  if (fadeTimer) clearInterval(fadeTimer);
  fadeTimer = null;
  if (watchdog) clearTimeout(watchdog);
  watchdog = null;
  if (fadingOut) unload(fadingOut);
  fadingOut = null;
  const deck = activeDeck();
  if (deck) fullGain(deck);
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

/** play() qui échoue : jamais de gain nul ; refus sans geste → attente du premier appui. */
function onPlayFailed(deck: Deck, error: unknown): void {
  fullGain(deck);
  if (error instanceof DOMException && error.name === 'NotAllowedError') armTapToPlay();
}

async function startTrack(index: number, fade: boolean): Promise<void> {
  const all = ensureDecks();
  const track = station?.tracks[index];
  if (!station || !track) return;
  const my = (token += 1);
  wanted = true;
  finishFade();
  const current = all[active]!;
  // Page cachée : on reste sur l'élément qui jouait (seul autorisé à continuer sans geste), sans fondu.
  const reuse = pageHidden() || !current.track;
  const crossfading = fade && !reuse;
  const incoming = reuse ? current : all[1 - active]!;
  const outgoing = incoming !== current ? current : null;

  // Adresse préparée : aucune attente avant play() (dans « ended », tout reste synchrone).
  let url: string | null = takePrepared(index, track);
  if (!url) releasePrepared();
  try {
    url ??= URL.createObjectURL(await trackBlob(track));
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
  incoming.audible = false;
  incoming.el.src = url;
  incoming.gain = crossfading ? 0 : 1;
  applyGain(incoming);
  active = all.indexOf(incoming);
  useRadio.setState({
    clock: { position: 0, duration: track.duration ? Math.round(track.duration) : null },
    progress: { time: 0, duration: track.duration ?? null },
  });
  setMetadata(track);
  setPrefs({ lastStationId: station.id, lastTrackId: track.id });
  if (outgoing && !crossfading) unload(outgoing);
  if (crossfading && outgoing) {
    // Le fondu part tout de suite ; le chien de garde le termine si play() traîne ou n'aboutit pas.
    crossfade(outgoing, incoming);
    watchdog = setTimeout(finishFade, FADE_S * 1000 + WATCHDOG_MARGIN_MS);
  }
  publish();
  const playing = incoming.el.play();
  // Le morceau courant est lancé : on prépare tout de suite l'adresse du suivant.
  prepareNext();
  try {
    await playing;
  } catch (error) {
    if (my !== token) return;
    // Pas de son à attendre de l'élément sortant : on termine le fondu, l'entrant reste à plein gain.
    finishFade();
    onPlayFailed(incoming, error);
  }
  publish();
}

async function advance(step: 1 | -1, fade: boolean): Promise<void> {
  if (!queue || !station) return;
  const index = step === 1 ? queue.next() : queue.previous();
  await startTrack(index, fade);
}

/** Fin de morceau : une seule transition à la fois, quel que soit le nombre d'événements reçus. */
async function autoAdvance(fade: boolean): Promise<void> {
  if (advancing) return;
  advancing = true;
  try {
    await advance(1, fade);
  } finally {
    advancing = false;
  }
}

function ensureDecks(): [Deck, Deck] {
  if (decks) return decks;
  const make = (): Deck => {
    const el = new Audio();
    el.preload = 'auto';
    const deck: Deck = { el, url: null, track: null, gain: 1, audible: false };
    el.addEventListener('timeupdate', () => {
      if (!isActive(deck)) return;
      const position = Math.floor(el.currentTime);
      const duration = Number.isFinite(el.duration) ? Math.round(el.duration) : null;
      const clock = useRadio.getState().clock;
      if (clock.position !== position || clock.duration !== duration) useRadio.setState({ clock: { position, duration } });
      publishProgress(deck);
      // Fondu seulement page visible ; page cachée, l'enchaînement attend « ended » sur le même élément.
      if (advancing || fadingOut || pageHidden() || !Number.isFinite(el.duration)) return;
      if (el.duration > FADE_S * 4 && el.duration - el.currentTime <= FADE_S) void autoAdvance(true);
    });
    el.addEventListener('ended', () => {
      if (isActive(deck)) void autoAdvance(false);
    });
    el.addEventListener('loadedmetadata', () => {
      if (deck.track && deck.track.duration === undefined) recordDuration(deck.track.id, el.duration);
      if (!isActive(deck)) return;
      publishProgress(deck);
      updatePositionState();
    });
    el.addEventListener('playing', () => {
      deck.audible = true;
      if (!isActive(deck)) return;
      errors = 0;
      // Le son sort : plus de gain nul possible sur l'actif hors fondu réel.
      if (!fadingOut) fullGain(deck);
      clearTap();
      publish();
      updatePositionState();
    });
    el.addEventListener('waiting', () => {
      deck.audible = false;
      if (isActive(deck)) publish();
    });
    el.addEventListener('play', () => isActive(deck) && publish());
    el.addEventListener('pause', () => {
      deck.audible = false;
      if (!isActive(deck)) return;
      publish();
      updatePositionState();
    });
    el.addEventListener('error', () => {
      if (!isActive(deck) || !deck.track) return;
      errors += 1;
      if (station && errors < station.tracks.length) {
        setTimeout(() => void autoAdvance(false), 400);
      } else {
        stopPlayback();
      }
    });
    return deck;
  };
  decks = [make(), make()];
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', recoverOnVisible);
  if ('mediaSession' in navigator) {
    const handlers: [MediaSessionAction, () => void][] = [
      ['play', () => void resume()],
      ['pause', () => pause()],
      ['nexttrack', () => void next()],
      ['previoustrack', () => void previous()],
    ];
    // Curseur et boutons ± 10 s de l'écran verrouillé et de la notification.
    const seekHandlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['seekto', (details) => details.seekTime !== undefined && seekTo(details.seekTime)],
      ['seekforward', (details) => seekBy(details.seekOffset ?? SEEK_STEP_S)],
      ['seekbackward', (details) => seekBy(-(details.seekOffset ?? SEEK_STEP_S))],
    ];
    for (const [action, handler] of seekHandlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Action inconnue de ce navigateur.
      }
    }
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

/**
 * Page cachée : un fondu en cours est terminé aussitôt (les minuteries y sont ralenties).
 * Retour au premier plan : un morceau resté muet, en pause forcée ou en attente se remet à jouer.
 */
function recoverOnVisible(): void {
  if (pageHidden()) {
    if (fadingOut) finishFade();
    return;
  }
  if (!wanted) return;
  const deck = activeDeck();
  if (!deck?.track) return;
  finishFade();
  if (deck.el.ended) {
    void autoAdvance(false);
    return;
  }
  if (deck.el.paused || !deck.audible) {
    deck.el.play().then(publish, (error: unknown) => onPlayFailed(deck, error));
  }
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
  const deck = activeDeck();
  if (deck?.track && station) {
    // Jamais de reprise muette : fondu interrompu terminé, gain remis à 1.
    finishFade();
    fullGain(deck);
    wanted = true;
    try {
      await deck.el.play();
    } catch (error) {
      // Lecture refusée : l'interface reste sur « pause », la musique attend le premier appui.
      onPlayFailed(deck, error);
    }
    publish();
    return;
  }
  const { lastStationId, lastTrackId, catalog } = useRadio.getState();
  const last = catalog.stations.find((item) => item.id === lastStationId) ?? catalog.stations[0];
  if (last) await playStation(last.id, last.id === lastStationId ? (lastTrackId ?? undefined) : undefined);
}

export function pause(): void {
  wanted = false;
  if (fadingOut) finishFade();
  activeDeck()?.el.pause();
  publish();
}

export async function togglePlay(): Promise<void> {
  const deck = activeDeck();
  // Un play() en attente (paused faux, aucun son) compte comme une pause : l'appui relance.
  if (deck?.track && deck.audible && !deck.el.paused) pause();
  else await resume();
}

export async function next(): Promise<void> {
  await advance(1, false);
}

export async function previous(): Promise<void> {
  const deck = activeDeck();
  if (deck && deck.el.currentTime > 3) {
    deck.el.currentTime = 0;
    return;
  }
  await advance(-1, false);
}

/**
 * Se place dans le morceau en cours (secondes, bornées), en lecture comme en pause ; un fondu en
 * cours est d'abord terminé. Sans morceau chargé ou durée inconnue, rien ne se passe.
 */
export function seekTo(seconds: number): void {
  const deck = activeDeck();
  if (!deck?.track) return;
  const duration = durationOf(deck);
  if (!duration) return;
  finishFade();
  deck.el.currentTime = clampPosition(seconds, duration);
  publishProgress(deck);
  const position = Math.floor(deck.el.currentTime);
  useRadio.setState({ clock: { position, duration: Math.round(duration) } });
  updatePositionState();
}

/** Avance (ou recule, pas négatif) dans le morceau en cours. */
export function seekBy(step: number): void {
  const deck = activeDeck();
  if (deck?.track) seekTo(deck.el.currentTime + step);
}

export function setVolume(volume: number): void {
  setPrefs({ volume: Math.min(1, Math.max(0, volume)) });
  if (decks) for (const deck of decks) applyGain(deck);
}

export function setShuffle(shuffle: boolean): void {
  setPrefs({ shuffle });
  queue?.setShuffle(shuffle);
  // La file a changé : l'adresse préparée est libérée et refaite pour le nouveau suivant.
  if (queue) prepareNext();
}

/** Arrête tout (station supprimée ou remplacée). Sans argument : quelle que soit la station. */
export function stopPlayback(stationIds?: readonly string[]): void {
  if (stationIds && (!station || !stationIds.includes(station.id))) return;
  token += 1;
  wanted = false;
  clearTap();
  finishFade();
  releasePrepared();
  if (decks) for (const deck of decks) unload(deck);
  station = null;
  queue = null;
  useRadio.setState({ now: null, progress: { time: 0, duration: null } });
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = 'none';
  }
}

/** Position de lecture du morceau en cours, en secondes (pour les parcours et l'affichage). */
export function currentTime(): number {
  return activeDeck()?.el.currentTime ?? 0;
}
