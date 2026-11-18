// État de la sortie de nuit (§ 5.5), conforme au contrat (src/drive/contrat.ts, DriveStore).
// L'interface écrit les commandes ; la scène les lit à chaque image par `useDrive.getState()` et
// publie la télémétrie par `setTelemetry`. Seules la météo, la caméra, la commande (manche ou
// pédales) et la direction (libre ou assistée) préférées sont sauvegardées (IndexedDB, lecture
// tolérante, partagées entre les pages de l'app) ; le reste dure la sortie.
// Passer « À la main » met la caméra de poursuite et coupe le réalisateur (demande du 16 novembre
// 2026) ; ensuite rien ne les change tout seul : seuls les boutons de caméra et de réalisateur le font.
// Le choix fait dans le menu (carte, départ) dure la séance : « Sortir » part de là.
// Déroulé (demande du 17 novembre 2026) : la sortie s'ouvre sur l'aperçu (`apercu` : la vitrine en
// pilote automatique, réalisateur, départ lancé sans feux) ; « commencer » (un appui sur la route)
// remet le véhicule sur la ligne du départ choisi, feux, à la main ; « Repartir » fait de même.
// « Pilote automatique » des réglages (`laisserConduire`) rend le volant au pilote sans rien perdre
// du parcours (position, chrono) ; un appui sur la route le reprend.
// Format (src/data/courses.ts, demande du 17 novembre 2026) : balade, course en 1 tour ou en 3 tours,
// choisi au menu et gardé. À l'arrivée d'une course, la scène rend la course finie (`terminerCourse`) :
// record d'avant et médaille ajoutés, `cloturerCourse` (src/jeu/bilan.ts) en tire le bilan que montre
// l'écran de fin (`fin`) ; le record de la carte, du départ et du format est gardé (`meilleurs`).
// Vague U (retour du 18 novembre 2026) : le format d'une sauvegarde neuve est la course d'un tour ; une
// sauvegarde d'avant (version 1), restée sur la balade d'origine, y repart une fois (`migrerDrivePrefs`),
// puis le choix du joueur est respecté. La dernière sortie (carte et départ, `derniere`) est gardée : le
// menu de la sortie (src/ui/drive/SortieEntree.tsx) se rouvre sur ses réglages.
// Carrière (src/data/carriere.ts, demande du 18 novembre 2026) : `lancerRendezVous` part sur un rendez-vous
// où tout est imposé (carte, départ, format, météo, moment) ; les choix libres sont mis de côté
// (`rendezVous.libre`), jamais écrasés dans la sauvegarde, et reviennent au garage (`leave`). Météo, moment
// et format ne se changent pas pendant un rendez-vous ; à l'arrivée, la carrière juge la course
// (src/jeu/carriereCloture.ts) après la clôture ordinaire.

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { CAMERA_IDS, type CameraId, type DriveInput, type DriveStore, type DriveTelemetry, type OrbitView, type Pilot, type Weather } from '../drive/contrat.ts';
import { clampOrbit, DEFAULT_ORBIT } from '../drive/cameras.ts';
import type { EtatDepart } from '../drive/depart.ts';
import type { CourseFinie } from '../drive/course.ts';
import { cleRecord, estFormat, FORMAT_PAR_DEFAUT, indulgence, medailleDe, seuilsMedailles, tempsReference } from '../data/courses.ts';
import type { Bilan, FormatCourse, MomentCourse, ResultatCourse } from '../jeu/contrat.ts';
import { cloturerCourse } from '../jeu/bilan.ts';
import { conclureRendezVous } from '../jeu/carriereCloture.ts';
import type { RendezVous } from '../data/carriere.ts';
import { mapById, MAPS } from '../data/maps.ts';
import { MOMENT_PAR_DEFAUT, momentOf, type Moment } from '../data/moments.ts';
import type { MapId } from '../data/mapTypes.ts';
import { idbStorage, shareAcrossTabs } from './persistence.ts';
import { estRegard, REGARD_PAR_DEFAUT, type RegardId } from '../data/regard.ts';

export const DRIVE_KEY = 'pmb-sortie';
export const DRIVE_VERSION = 2;

export const WEATHERS: readonly { id: Weather; label: string }[] = [
  { id: 'sec', label: 'Sec' },
  { id: 'pluie', label: 'Pluie' },
  { id: 'neige', label: 'Neige' },
];

export const CAMERA_LABELS: Record<CameraId, string> = {
  poursuite: 'Poursuite',
  rasante: 'Rasante',
  avant: 'Avant',
  embarquee: 'Embarquée',
  travelling: 'Bord de route',
  orbite: 'Orbite',
};

/**
 * Commande à la main, en portrait : le manche virtuel (par défaut ; haut le gaz, bas le frein, côtés
 * le placement), ou les deux pédales (appui à droite, appui à gauche, glissé pour se placer).
 */
export type DriveCommande = 'manche' | 'pedales';

export const COMMANDES: readonly { id: DriveCommande; label: string }[] = [
  { id: 'manche', label: 'Manche' },
  { id: 'pedales', label: 'Pédales' },
];

/**
 * Direction à la main : libre (par défaut ; le joueur tient le braquage, le véhicule va où on le
 * dirige) ou assistée (l'aide suit la route ; le manche place le véhicule sur la chaussée). Ni l'une
 * ni l'autre ne freine à la place du joueur (src/drive/pilote.ts).
 */
export type DriveDirection = 'libre' | 'assistee';

export const DIRECTIONS: readonly { id: DriveDirection; label: string }[] = [
  { id: 'libre', label: 'Libre' },
  { id: 'assistee', label: 'Assistée' },
];

/** Ce qui est sauvegardé : le moment (nuit, jour), la météo, la caméra, la commande, la direction et le format préférés. */
export interface DrivePrefs {
  moment: Moment;
  weather: Weather;
  camera: CameraId;
  commande: DriveCommande;
  direction: DriveDirection;
  format: FormatCourse;
}

export const DEFAULT_DRIVE_PREFS: Readonly<DrivePrefs> = Object.freeze({ moment: MOMENT_PAR_DEFAUT, weather: 'pluie', camera: 'poursuite', commande: 'manche', direction: 'libre', format: FORMAT_PAR_DEFAUT });

/** Caméra mise en passant « À la main ». */
export const CAMERA_A_LA_MAIN: CameraId = 'poursuite';

/** Durée du fondu au noir de fin d'aperçu, dans un sens, en ms (la même que la transition de .drive-fondu, src/ui/drive/drive.css). */
export const FONDU_MS = 400;
/** Secours, en ms : si l'écran ne confirme pas le noir (rendu figé), la scène reprend quand même après ce délai. */
export const FONDU_SECOURS_MS = 1500;

/** Fondu de fin d'aperçu : `non` ; `sortie` (l'écran noircit) ; `noir` (l'écran l'est, confirmé par la fin de la transition). */
export type FonduEtat = 'non' | 'sortie' | 'noir';
export type EtapeFondu = 'lever' | 'attendre' | 'reprendre';

/**
 * Fin d'un parcours ouvert en aperçu : que fait la scène à cette image ? `depuis` : instant où le fondu a
 * été levé (ms), -1 s'il ne l'est pas encore ; `noir` : l'écran a confirmé qu'il est noir. Sans mouvement
 * (`reduit`), la coupe est franche : on reprend tout de suite. Sinon : lever le fondu, attendre que l'écran
 * ait fini de noircir (même quand les images tombent à une par seconde : c'est lui qui le dit, pas
 * l'horloge), puis reprendre du départ ; l'horloge ne sert que de secours.
 */
export function etapeFondu(depuis: number, maintenant: number, reduit: boolean, noir: boolean): EtapeFondu {
  if (reduit) return 'reprendre';
  if (depuis < 0) return 'lever';
  return noir || maintenant - depuis >= FONDU_SECOURS_MS ? 'reprendre' : 'attendre';
}

export const AUTO_INPUT: Readonly<DriveInput> = Object.freeze({ auto: true, throttle: 0, brake: 0, lane: 0 });

/**
 * Le pilote de la sortie en cours, posé par la scène (src/drive/scene/moteur.ts) et retiré quand
 * elle se démonte : le compte-tours et le NOS le lisent à chaque image (sans faire rendre React),
 * le son du moteur à chaque télémétrie. Jamais sauvegardé.
 */
export const livePilot: { current: Pilot | null } = { current: null };

/** Départ, chrono et tours de la sortie en cours (src/drive/depart.ts), tenus par la scène ; lus par les feux et le chrono. */
export const liveDepart: { current: EtatDepart | null } = { current: null };

/** Arrivée passée (parcours ouvert) : le temps, et le meilleur gardé pour ce parcours, ce départ et ce véhicule. */
export interface ArriveeSortie {
  /** Temps, en ms de temps de sortie. */
  temps: number;
  /** Meilleur temps gardé, celui-ci compris, en ms. */
  meilleur: number;
  /** Meilleur temps précédent, en ms ; -1 s'il n'y en avait pas. */
  precedent: number;
}

/** Meilleurs temps gardés au plus (les plus anciens partent d'abord). */
export const MEILLEURS_MAX = 200;

/** Meilleurs temps relus du stockage : seulement des temps plausibles (moins d'un jour), clés courtes. */
export function sanitizeMeilleurs(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  const entries = Object.entries(raw as Record<string, unknown>).filter(
    ([key, value]) => key.length > 0 && key.length <= 200 && typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 86_400_000,
  );
  for (const [key, value] of entries.slice(-MEILLEURS_MAX)) out[key] = value as number;
  return out;
}

export const IDLE_TELEMETRY: Readonly<DriveTelemetry> = Object.freeze({
  ready: false,
  failed: false,
  speedKmh: 0,
  s: 0,
  progress: 0,
  finished: false,
});

/** Dernière sortie : la carte et le départ (`null` : le premier), gardés pour rouvrir le menu sur ses réglages. */
export interface DerniereSortie {
  map: MapId;
  start: string | null;
}

const ID_SORTIE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Lecture tolérante de la dernière sortie ; la carte peut avoir quitté le catalogue (le menu le vérifie). */
export function sanitizeDerniere(raw: unknown): DerniereSortie | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { map, start } = raw as Record<string, unknown>;
  if (typeof map !== 'string' || !ID_SORTIE.test(map)) return null;
  return { map, start: typeof start === 'string' && start.length > 0 && start.length <= 64 ? start : null };
}

/**
 * Préférences relues d'une sauvegarde de version `version`. Avant la version 2, le format n'avait pas
 * de vrai choix par défaut (la balade, sans gain, que rien ne signalait) : une balade relue repart une
 * fois sur la course d'un tour. Un autre format, choisi exprès, reste.
 */
export function migrerDrivePrefs(raw: unknown, version: number): DrivePrefs {
  const prefs = sanitizeDrivePrefs(raw);
  return version < 2 && prefs.format === 'balade' ? { ...prefs, format: FORMAT_PAR_DEFAUT } : prefs;
}

/** Lecture tolérante : une valeur inconnue retombe sur celle d'origine. */
export function sanitizeDrivePrefs(raw: unknown): DrivePrefs {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const weather = WEATHERS.some((item) => item.id === source.weather) ? (source.weather as Weather) : DEFAULT_DRIVE_PREFS.weather;
  const camera = CAMERA_IDS.includes(source.camera as CameraId) ? (source.camera as CameraId) : DEFAULT_DRIVE_PREFS.camera;
  const commande = COMMANDES.some((item) => item.id === source.commande) ? (source.commande as DriveCommande) : DEFAULT_DRIVE_PREFS.commande;
  const direction = DIRECTIONS.some((item) => item.id === source.direction) ? (source.direction as DriveDirection) : DEFAULT_DRIVE_PREFS.direction;
  const format = estFormat(source.format) ? source.format : DEFAULT_DRIVE_PREFS.format;
  return { moment: momentOf(source.moment), weather, camera, commande, direction, format };
}

/** Hauteur du regard relue du stockage (vague U) : un cran inconnu retombe sur « normal ». */
export function sanitizeRegard(raw: unknown): RegardId {
  const value = typeof raw === 'object' && raw !== null ? (raw as { regard?: unknown }).regard : undefined;
  return estRegard(value) ? value : REGARD_PAR_DEFAUT;
}

/** Caméra suivante dans l'ordre du contrat (après l'orbite, on revient à la poursuite). */
export function nextCameraOf(camera: CameraId): CameraId {
  const index = CAMERA_IDS.indexOf(camera);
  return CAMERA_IDS[(index + 1) % CAMERA_IDS.length] as CameraId;
}

function sameTelemetry(a: DriveTelemetry, b: DriveTelemetry): boolean {
  return a.ready === b.ready && a.failed === b.failed && a.speedKmh === b.speedKmh && a.s === b.s && a.progress === b.progress && a.finished === b.finished && a.depart === b.depart;
}

export interface DriveState extends DriveStore {
  hydrated: boolean;
  /** Moment de la sortie : nuit (par défaut) ou jour (src/data/moments.ts). */
  moment: Moment;
  /** Commande préférée à la main, en portrait : le manche ou les pédales. */
  commande: DriveCommande;
  /** Direction préférée à la main : libre ou assistée. */
  direction: DriveDirection;
  /** Format préféré (gardé) : balade, course en 1 tour, en 3 tours. */
  format: FormatCourse;
  /** Hauteur du regard à la caméra embarquée (gardée, src/data/regard.ts). */
  regard: RegardId;
  setRegard: (regard: RegardId) => void;
  /** Essai de la sortie en cours : « Réessayer » et « Repartir » remontent la scène (clé de montage). */
  attempt: number;
  /** Remonte la scène sur la même carte et le même départ, en aperçu : après une erreur. */
  retry: () => void;
  /** Aperçu du début de sortie : pilote automatique, réalisateur, rien à l'écran, jusqu'au premier appui. */
  apercu: boolean;
  /**
   * Fondu au noir de l'aperçu au bout d'un parcours ouvert : levé par la scène en fin de route, confirmé
   * noir par l'écran, baissé quand le véhicule est revenu au départ (src/drive/scene/moteur.ts) ; jamais sauvegardé.
   */
  fondu: FonduEtat;
  setFondu: (fondu: FonduEtat) => void;
  /** Départs à la main demandés (« commencer », « Repartir ») : la scène remet le véhicule sur la ligne et relance les feux. */
  course: number;
  /**
   * Lance la course (depuis l'aperçu) ou la relance (« Repartir ») : véhicule sur la ligne du départ
   * choisi, feux, conduite à la main, caméra de poursuite, réalisateur coupé, pause levée.
   */
  commencer: () => void;
  /** « Pilote automatique » : le pilote reprend où l'on est (parcours et chrono gardés), le réalisateur revient. */
  laisserConduire: () => void;
  /** La scène est tombée (erreur de rendu) : la sortie affiche son message d'erreur. */
  fail: () => void;
  /** Choix du menu, avant de sortir : carte (`null` : la première du catalogue) et départ. */
  choice: { map: MapId | null; start: string | null };
  /** Dernière sortie (gardée) : le menu de la sortie se rouvre sur ses réglages ; `null` avant la première. */
  derniere: DerniereSortie | null;
  /** Choisit la carte du menu ; le départ revient au premier de cette carte. */
  chooseMap: (map: MapId) => void;
  chooseStart: (start: string | null) => void;
  /**
   * Entre en sortie : sur la carte et le départ donnés, sinon sur le choix du menu, sinon sur la
   * première carte. Sans effet si le catalogue est vide ou si l'on roule déjà sur cette carte.
   */
  enter: (map?: MapId | null, start?: string | null) => void;
  /** Rentre au garage : plus de carte, commandes et télémétrie remises à zéro. */
  leave: () => void;
  /** Choisit une caméra à la main : le réalisateur s'arrête. */
  setCamera: (camera: CameraId) => void;
  nextCamera: () => void;
  setDirector: (director: boolean) => void;
  setWeather: (weather: Weather) => void;
  /** Nuit ou jour (src/data/moments.ts), choisi à côté de la météo. */
  setMoment: (moment: Moment) => void;
  /**
   * Pilote automatique (vrai) ou conduite à la main (faux, pédales relâchées). En passant à la main :
   * caméra de poursuite, réalisateur coupé ; le retour au pilote automatique ne les change pas.
   */
  setAuto: (auto: boolean) => void;
  /** Direction préférée à la main (gardée) ; vaut aussitôt si l'on conduit. */
  setDirection: (direction: DriveDirection) => void;
  setThrottle: (throttle: number) => void;
  setBrake: (brake: number) => void;
  setLane: (lane: DriveInput['lane']) => void;
  /**
   * Le manche (et les boutons de la manette) : gaz, frein et placement progressif écrits d'un coup ;
   * `steer` absent : le placement revient aux bords demandés (`lane`). Sans effet en pilote auto.
   */
  setManual: (manual: { throttle: number; brake: number; steer?: number }) => void;
  /** Commande préférée à la main, en portrait (gardée). */
  setCommande: (commande: DriveCommande) => void;
  /** Un appui sur « NOS » (à la main) : le pilote envoie une poussée si la réserve le permet. */
  fireNos: () => void;
  setOrbit: (orbit: Partial<OrbitView>) => void;
  setSlow: (slow: boolean) => void;
  setPaused: (paused: boolean) => void;
  /** Meilleurs temps à l'arrivée, par parcours, départ et véhicule (src/drive/depart.ts, cleTemps) ; gardés. */
  meilleurs: Record<string, number>;
  /** Arrivée de la sortie en cours, ou `null` (posée par la scène, effacée à chaque départ). */
  arrivee: ArriveeSortie | null;
  /** Ligne d'arrivée passée en `temps` ms : garde le meilleur temps de `cle`. */
  noterArrivee: (cle: string, temps: number) => void;
  /** Nouveau départ : l'arrivée précédente s'efface. */
  effacerArrivee: () => void;
  /** Format choisi au menu (gardé) : balade, course en 1 tour, en 3 tours. */
  setFormat: (format: FormatCourse) => void;
  /** Bilan de la course arrivée, montré par l'écran de fin ; `null` sinon (effacé à chaque départ). */
  fin: Bilan | null;
  /**
   * Arrivée d'une course : record d'avant et médaille ajoutés, bilan de `cloturerCourse`, record gardé,
   * le pilote automatique reprend le volant derrière l'écran de fin (tour d'honneur).
   */
  terminerCourse: (course: CourseFinie) => void;
  /** Rendez-vous de carrière en cours (tout imposé), ou `null` en sortie libre. Jamais sauvegardé. */
  rendezVous: RendezVousEnCours | null;
  /** Prépare la sortie d'un rendez-vous : carte, départ, format, météo et moment imposés ; l'appelant ouvre la sortie. */
  lancerRendezVous: (rdv: RendezVous, numero: number, total: number) => void;
}

/** Bilan sans rien (économie absente ou en erreur) : l'écran de fin montre quand même le résultat. */
/** Rendez-vous de carrière de la sortie en cours ; les choix libres (météo, moment, format) attendent à côté. */
export interface RendezVousEnCours {
  id: string;
  /** Numéro dans la suite (1 pour le premier) et nombre de rendez-vous. */
  numero: number;
  total: number;
  libre: Pick<DrivePrefs, 'moment' | 'weather' | 'format'>;
}

/** Relecture de la sauvegarde pendant un rendez-vous : les choix relus vont de côté, l'imposé reste. */
export function garderImpose<T extends Pick<DriveState, 'moment' | 'weather' | 'format' | 'rendezVous'>>(current: Pick<DriveState, 'moment' | 'weather' | 'format' | 'rendezVous'>, next: T): T {
  if (!current.rendezVous) return next;
  return { ...next, moment: current.moment, weather: current.weather, format: current.format, rendezVous: { ...current.rendezVous, libre: { moment: next.moment, weather: next.weather, format: next.format } } };
}

export function bilanVide(resultat: ResultatCourse): Bilan {
  return { resultat, gains: { dollars: 0, detail: [] }, solde: 0, hautsFaits: [], deblocages: [] };
}

/** Résultat complet d'une course finie : le record d'avant (s, depuis `meilleurs` en ms) et la médaille. */
export function resultatDe(course: CourseFinie, meilleurs: Readonly<Record<string, number>>): ResultatCourse {
  const old = meilleurs[cleRecord(course.carte, course.depart, course.format)];
  const ancienRecord = typeof old === 'number' && old > 0 ? old / 1000 : null;
  const reference = tempsReference(course.carte, course.depart, course.format, course.vehicule);
  const medaille = reference === null ? null : medailleDe(course.temps, seuilsMedailles(reference, indulgence(course.carte, course.meteo)));
  return { ...course, ancienRecord, medaille };
}

const unit = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);
const signed = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(-1, value)) : 0);

export const useDrive = create<DriveState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_DRIVE_PREFS,
      regard: REGARD_PAR_DEFAUT,
      map: null,
      start: null,
      director: true,
      input: { ...AUTO_INPUT },
      orbit: { ...DEFAULT_ORBIT },
      slow: false,
      paused: false,
      telemetry: { ...IDLE_TELEMETRY },
      hydrated: false,
      attempt: 0,
      apercu: true,
      course: 0,
      fondu: 'non',
      choice: { map: null, start: null },
      derniere: null,
      retry: () =>
        set((state) =>
          state.map === null
            ? state
            : { attempt: state.attempt + 1, apercu: true, fondu: 'non', fin: null, input: { ...AUTO_INPUT }, slow: false, paused: false, telemetry: { ...IDLE_TELEMETRY } },
        ),
      commencer: () =>
        set((state) => {
          if (state.map === null) return state;
          const nos = state.input.nos === undefined ? {} : { nos: state.input.nos };
          const input: DriveInput = { auto: false, throttle: 0, brake: 0, lane: 0, ...(state.direction === 'assistee' ? { assist: true } : {}), ...nos };
          return { apercu: false, fondu: 'non', fin: null, course: state.course + 1, input, camera: CAMERA_A_LA_MAIN, director: false, slow: false, paused: false };
        }),
      laisserConduire: () =>
        set((state) => {
          if (state.map === null) return state;
          const nos = state.input.nos === undefined ? {} : { nos: state.input.nos };
          return { input: { ...AUTO_INPUT, ...nos }, director: true, paused: false };
        }),
      setFondu: (fondu) => set((state) => (state.fondu === fondu ? state : { fondu })),
      fail: () => set((state) => ({ telemetry: { ...state.telemetry, ready: false, failed: true } })),
      setTelemetry: (telemetry) => set((state) => (sameTelemetry(state.telemetry, telemetry) ? state : { telemetry: { ...telemetry } })),
      chooseMap: (map) => set((state) => (mapById(map) ? { choice: { map, start: state.choice.map === map ? state.choice.start : null } } : state)),
      chooseStart: (start) => set((state) => ({ choice: { ...state.choice, start } })),
      enter: (map, start) => {
        const state = get();
        const target = mapById(map ?? state.choice.map) ?? MAPS[0];
        if (!target) return;
        const wanted = map !== undefined && map !== null ? (start ?? null) : start !== undefined ? start : state.choice.start;
        if (state.map === target.id && state.start === wanted) return;
        set({
          map: target.id,
          start: wanted,
          // Un rendez-vous de carrière ne remplace pas la dernière sortie libre (celle que rouvre le menu).
          ...(state.rendezVous ? {} : { derniere: { map: target.id, start: wanted } }),
          apercu: true,
          fondu: 'non',
          fin: null,
          director: true,
          input: { ...AUTO_INPUT },
          orbit: { ...DEFAULT_ORBIT },
          slow: false,
          paused: false,
          telemetry: { ...IDLE_TELEMETRY },
        });
      },
      leave: () =>
        set((state) =>
          state.map === null
            ? state.rendezVous
              ? { rendezVous: null, ...state.rendezVous.libre }
              : state
            : { map: null, start: null, apercu: true, fondu: 'non', fin: null, input: { ...AUTO_INPUT }, slow: false, paused: false, telemetry: { ...IDLE_TELEMETRY }, ...(state.rendezVous ? { rendezVous: null, ...state.rendezVous.libre } : {}) },
        ),
      setCamera: (camera) => set({ camera, director: false }),
      nextCamera: () => set((state) => ({ camera: nextCameraOf(state.camera), director: false })),
      setDirector: (director) => set({ director }),
      // Pendant un rendez-vous de carrière, la météo, le moment et le format sont imposés.
      setWeather: (weather) => set((state) => (state.rendezVous ? state : { weather })),
      setMoment: (moment) => set((state) => (state.rendezVous ? state : { moment })),
      // Le compteur du NOS suit d'un mode à l'autre : le pilote ne compte que les nouveaux appuis.
      setAuto: (auto) =>
        set((state) => {
          const nos = state.input.nos === undefined ? {} : { nos: state.input.nos };
          if (auto) return { input: { ...AUTO_INPUT, ...nos } };
          const input: DriveInput = { auto: false, throttle: 0, brake: 0, lane: 0, ...(state.direction === 'assistee' ? { assist: true } : {}), ...nos };
          // On prend le volant : caméra de poursuite, réalisateur coupé (une seule fois, au passage).
          return state.input.auto ? { input, camera: CAMERA_A_LA_MAIN, director: false } : { input };
        }),
      setDirection: (direction) =>
        set((state) => {
          if (!DIRECTIONS.some((item) => item.id === direction) || state.direction === direction) return state;
          if (state.input.auto) return { direction };
          const input: DriveInput = { ...state.input };
          if (direction === 'assistee') input.assist = true;
          else delete input.assist;
          return { direction, input };
        }),
      setThrottle: (throttle) => set((state) => (state.input.auto ? state : { input: { ...state.input, throttle: unit(throttle) } })),
      setBrake: (brake) => set((state) => (state.input.auto ? state : { input: { ...state.input, brake: unit(brake) } })),
      setLane: (lane) => set((state) => (state.input.auto || state.input.lane === lane ? state : { input: { ...state.input, lane } })),
      setManual: ({ throttle, brake, steer }) =>
        set((state) => {
          if (state.input.auto) return state;
          const t = unit(throttle);
          const b = unit(brake);
          const st = steer === undefined ? undefined : signed(steer);
          const input = state.input;
          if (input.throttle === t && input.brake === b && input.steer === st) return state;
          const next: DriveInput = { ...input, throttle: t, brake: b };
          if (st === undefined) delete next.steer;
          else next.steer = st;
          return { input: next };
        }),
      setCommande: (commande) => set((state) => (state.commande === commande ? state : { commande })),
      setRegard: (regard) => set((state) => (!estRegard(regard) || state.regard === regard ? state : { regard })),
      fireNos: () => set((state) => (state.input.auto ? state : { input: { ...state.input, nos: (state.input.nos ?? 0) + 1 } })),
      setOrbit: (orbit) => set((state) => ({ orbit: clampOrbit({ ...state.orbit, ...orbit }) })),
      setSlow: (slow) => set((state) => (state.slow === slow ? state : { slow })),
      setPaused: (paused) => set((state) => (state.paused === paused ? state : { paused })),
      meilleurs: {},
      arrivee: null,
      noterArrivee: (cle, temps) =>
        set((state) => {
          if (!(Number.isFinite(temps) && temps > 0)) return state;
          const old = state.meilleurs[cle];
          const precedent = typeof old === 'number' && old > 0 ? old : -1;
          const meilleur = precedent > 0 ? Math.min(precedent, temps) : temps;
          const meilleurs = { ...state.meilleurs };
          delete meilleurs[cle];
          meilleurs[cle] = meilleur;
          return { meilleurs: sanitizeMeilleurs(meilleurs), arrivee: { temps, meilleur, precedent } };
        }),
      effacerArrivee: () => set((state) => (state.arrivee === null ? state : { arrivee: null })),
      setFormat: (format) => set((state) => (!estFormat(format) || state.format === format || state.rendezVous ? state : { format })),
      fin: null,
      terminerCourse: (course) => {
        // Une seule clôture par course finie (src/jeu/bilan.ts paie et enregistre) : hors de la mise à jour du store.
        const state = get();
        const moment: MomentCourse = (state as Partial<{ moment: MomentCourse }>).moment === 'jour' ? 'jour' : 'nuit';
        const resultat = resultatDe({ ...course, moment }, state.meilleurs);
        let fin: Bilan;
        try {
          fin = cloturerCourse(resultat);
        } catch {
          fin = bilanVide(resultat);
        }
        // Carrière : le rendez-vous est jugé, sa prime (une fois) s'ajoute au bilan.
        if (state.rendezVous) fin = conclureRendezVous(state.rendezVous.id, fin);
        const cle = cleRecord(course.carte, course.depart, course.format);
        const temps = Math.round(course.temps * 1000);
        set((now) => {
          const meilleurs = { ...now.meilleurs };
          const old = meilleurs[cle];
          delete meilleurs[cle];
          meilleurs[cle] = typeof old === 'number' && old > 0 ? Math.min(old, temps) : temps;
          const nos = now.input.nos === undefined ? {} : { nos: now.input.nos };
          return { fin, meilleurs: sanitizeMeilleurs(meilleurs), input: { ...AUTO_INPUT, ...nos }, director: true };
        });
      },
      rendezVous: null,
      lancerRendezVous: (rdv, numero, total) =>
        set((state) => ({
          rendezVous: { id: rdv.id, numero, total, libre: state.rendezVous?.libre ?? { moment: state.moment, weather: state.weather, format: state.format } },
          choice: { map: rdv.carte, start: rdv.depart },
          moment: rdv.moment,
          weather: rdv.meteo,
          format: rdv.format,
        })),
    }),
    {
      name: DRIVE_KEY,
      version: DRIVE_VERSION,
      storage: createJSONStorage(() => idbStorage),
      // Les meilleurs temps et la dernière sortie ne sont écrits qu'une fois posés.
      partialize: (state) => {
        // Pendant un rendez-vous, ce sont les choix libres mis de côté qui se gardent, pas l'imposé.
        const { moment, weather, camera, commande, direction, format, regard, meilleurs, derniere } = { ...state, ...state.rendezVous?.libre };
        return {
          moment,
          weather,
          camera,
          commande,
          direction,
          format,
          regard,
          ...(Object.keys(meilleurs).length > 0 ? { meilleurs } : {}),
          ...(derniere ? { derniere } : {}),
        };
      },
      migrate: (persisted, version) => ({
        ...migrerDrivePrefs(persisted, version),
        regard: sanitizeRegard(persisted),
        meilleurs: sanitizeMeilleurs((persisted as { meilleurs?: unknown } | null)?.meilleurs),
        derniere: sanitizeDerniere((persisted as { derniere?: unknown } | null)?.derniere),
      }),
      merge: (persisted, current) =>
        garderImpose(current, {
          ...current,
          ...sanitizeDrivePrefs(persisted),
          regard: sanitizeRegard(persisted),
          meilleurs: sanitizeMeilleurs((persisted as { meilleurs?: unknown } | null)?.meilleurs),
          derniere: sanitizeDerniere((persisted as { derniere?: unknown } | null)?.derniere),
        }),
      onRehydrateStorage: () => () => {
        useDrive.setState({ hydrated: true });
      },
    },
  ),
);

// Une autre page de l'app enregistre aussi : le store relit la sauvegarde (src/state/persistence.ts).
shareAcrossTabs(useDrive);
