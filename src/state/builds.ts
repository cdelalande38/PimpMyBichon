// Builds : le véhicule à l'écran et, pour chaque véhicule, ce que l'utilisateur en a fait (§ 5.9,
// § 6). Zustand, sauvegardé dans IndexedDB à chaque changement, lecture tolérante comme les
// réglages. Le store ne connaît aucun véhicule : il retient des choix par identifiant, et les
// fonctions pures ci-dessous les résolvent contre un manifeste.

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { FINISHES } from '../data/finishes.ts';
import type {
  Build,
  Hex,
  Paint,
  PaintChoice,
  VehicleId,
  VehicleManifest,
  Zone,
} from '../data/vehicleTypes.ts';
import { idbStorage } from './persistence.ts';

export const BUILDS_KEY = 'pmb-builds';
export const BUILDS_VERSION = 1;
/** Nombre de dernières couleurs retenues (§ 5.2). */
export const RECENT_COLORS = 12;
/** Bornes de la taille de paillette, en millimètres. */
export const FLAKE_RANGE = Object.freeze({ min: 0.2, max: 2 });

const MAX_VEHICLES = 64;
const MAX_ZONES = 64;
const MAX_SLOTS = 64;
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

/** '#rrggbb' en minuscules, ou `null`. Accepte l'absence de dièse, les majuscules et '#rgb'. */
export function normalizeHex(value: unknown): Hex | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase().replace(/^#/, '');
  if (/^[0-9a-f]{6}$/.test(text)) return `#${text}`;
  if (/^[0-9a-f]{3}$/.test(text)) return `#${text.replace(/./g, (digit) => digit + digit)}`;
  return null;
}

type Zoned = Pick<VehicleManifest, 'zones'>;

/** Zone maîtresse : la première zone 'carrosserie' du manifeste. */
export function masterZone(manifest: Zoned): Zone | undefined {
  return manifest.zones.find((zone) => zone.group === 'carrosserie');
}

/** Vrai si la zone suit aujourd'hui la zone maîtresse. */
export function isLinked(manifest: Zoned, build: Build | undefined, zoneId: string): boolean {
  const zone = manifest.zones.find((item) => item.id === zoneId);
  const master = masterZone(manifest);
  if (!zone || !master || zone.group !== 'carrosserie' || zone.id === master.id) return false;
  return build?.paints[zoneId]?.linked ?? zone.linked !== false;
}

function ownPaint(zone: Zone, choice: PaintChoice | undefined): Paint {
  const paint: Paint = { ...zone.paint };
  if (choice?.color !== undefined) paint.color = choice.color;
  if (choice?.finish !== undefined) paint.finish = choice.finish;
  if (choice?.flake !== undefined) paint.flake = choice.flake;
  if (choice?.color2 !== undefined) paint.color2 = choice.color2;
  return paint;
}

/**
 * Peinture effective d'une zone : celle de la zone maîtresse si la zone lui est liée, sinon la
 * sienne (peinture d'origine du manifeste, recouverte par les choix de l'utilisateur).
 * `undefined` : le manifeste n'a pas cette zone.
 */
export function resolvePaint(manifest: Zoned, build: Build | undefined, zoneId: string): Paint | undefined {
  const zone = manifest.zones.find((item) => item.id === zoneId);
  if (!zone) return undefined;
  const master = masterZone(manifest);
  const source = master && isLinked(manifest, build, zoneId) ? master : zone;
  return ownPaint(source, build?.paints[source.id]);
}

/** Peinture effective de chaque zone du manifeste. */
export function resolvePaints(manifest: Zoned, build: Build | undefined): Record<string, Paint> {
  const paints: Record<string, Paint> = {};
  for (const zone of manifest.zones) {
    const paint = resolvePaint(manifest, build, zone.id);
    if (paint) paints[zone.id] = paint;
  }
  return paints;
}

function sanitizeChoice(raw: unknown): PaintChoice | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const choice: PaintChoice = {};
  const color = normalizeHex(source.color);
  if (color) choice.color = color;
  const finish = FINISHES.find((item) => item.id === source.finish);
  if (finish) choice.finish = finish.id;
  if (typeof source.flake === 'number' && Number.isFinite(source.flake)) {
    choice.flake = Math.min(FLAKE_RANGE.max, Math.max(FLAKE_RANGE.min, source.flake));
  }
  const color2 = normalizeHex(source.color2);
  if (color2) choice.color2 = color2;
  if (typeof source.linked === 'boolean') choice.linked = source.linked;
  return Object.keys(choice).length > 0 ? choice : null;
}

function sanitizeBuild(raw: unknown): Build {
  const build: Build = { paints: {} };
  if (typeof raw !== 'object' || raw === null) return build;
  const { paints, parts } = raw as Record<string, unknown>;
  if (typeof paints === 'object' && paints !== null) {
    for (const [zone, value] of Object.entries(paints).slice(0, MAX_ZONES)) {
      const choice = ID.test(zone) ? sanitizeChoice(value) : null;
      if (choice) build.paints[zone] = choice;
    }
  }
  if (typeof parts === 'object' && parts !== null) {
    const kept: Record<string, string> = {};
    for (const [slot, option] of Object.entries(parts).slice(0, MAX_SLOTS)) {
      if (ID.test(slot) && typeof option === 'string' && ID.test(option)) kept[slot] = option;
    }
    if (Object.keys(kept).length > 0) build.parts = kept;
  }
  return build;
}

function isEmpty(build: Build): boolean {
  return Object.keys(build.paints).length === 0 && build.parts === undefined;
}

export interface BuildsData {
  /** Véhicule à l'écran ; `null` : le véhicule de départ du catalogue. */
  current: VehicleId | null;
  builds: Record<VehicleId, Build>;
  /** Dernières couleurs choisies, la plus récente d'abord. */
  recents: Hex[];
}

export const DEFAULT_BUILDS: Readonly<BuildsData> = Object.freeze({ current: null, builds: {}, recents: [] });

/**
 * Lecture tolérante : une sauvegarde abîmée, venue d'une autre version ou qui cite un véhicule
 * disparu ne casse rien. Ce qui est illisible est écarté, champ par champ ; un véhicule inconnu
 * du catalogue garde son build, pour le jour où son dossier revient.
 */
export function sanitizeBuilds(raw: unknown): BuildsData {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const builds: Record<VehicleId, Build> = {};
  if (typeof source.builds === 'object' && source.builds !== null) {
    for (const [vehicle, value] of Object.entries(source.builds).slice(0, MAX_VEHICLES)) {
      if (!ID.test(vehicle)) continue;
      const build = sanitizeBuild(value);
      if (!isEmpty(build)) builds[vehicle] = build;
    }
  }
  const recents: Hex[] = [];
  if (Array.isArray(source.recents)) {
    for (const value of source.recents) {
      const color = normalizeHex(value);
      if (color && !recents.includes(color)) recents.push(color);
      if (recents.length === RECENT_COLORS) break;
    }
  }
  return {
    current: typeof source.current === 'string' && ID.test(source.current) ? source.current : null,
    builds,
    recents,
  };
}

export interface BuildsState extends BuildsData {
  /** Vrai une fois la sauvegarde relue : avant, l'interface montre les peintures d'origine. */
  hydrated: boolean;
  /** Met un véhicule à l'écran ; son build reste tel qu'on l'a laissé. */
  select: (vehicle: VehicleId) => void;
  /** Change la peinture propre d'une zone ; les champs absents du patch ne bougent pas. */
  setPaint: (vehicle: VehicleId, zone: string, patch: Partial<Paint>) => void;
  /**
   * Lie ou détache une zone de la zone maîtresse. Au détachement, `seed` (la peinture effective
   * du moment) devient sa peinture propre : rien ne change à l'image.
   */
  setLinked: (vehicle: VehicleId, zone: string, linked: boolean, seed?: Paint) => void;
  /** Monte une option sur un poste (§ 5.4) ; `null` rend le poste à son origine. */
  setPart: (vehicle: VehicleId, slot: string, option: string | null) => void;
  /** Range une couleur en tête des dernières couleurs (à appeler quand un choix est posé). */
  rememberColor: (color: Hex) => void;
  /** Rend au véhicule son état d'origine : peintures et pièces. */
  resetVehicle: (vehicle: VehicleId) => void;
}

function withChoice(
  builds: Record<VehicleId, Build>,
  vehicle: VehicleId,
  zone: string,
  patch: PaintChoice,
): Record<VehicleId, Build> {
  const build = builds[vehicle] ?? { paints: {} };
  return {
    ...builds,
    [vehicle]: { ...build, paints: { ...build.paints, [zone]: { ...build.paints[zone], ...patch } } },
  };
}

export const useBuilds = create<BuildsState>()(
  persist(
    (set) => ({
      ...DEFAULT_BUILDS,
      hydrated: false,
      select: (vehicle) => set({ current: vehicle }),
      setPaint: (vehicle, zone, patch) =>
        set((state) => ({ builds: withChoice(state.builds, vehicle, zone, patch) })),
      setLinked: (vehicle, zone, linked, seed) =>
        set((state) => ({
          builds: withChoice(state.builds, vehicle, zone, linked ? { linked } : { ...seed, linked }),
        })),
      setPart: (vehicle, slot, option) =>
        set((state) => {
          const build = state.builds[vehicle] ?? { paints: {} };
          const parts = Object.fromEntries(Object.entries(build.parts ?? {}).filter(([id]) => id !== slot));
          if (option !== null) parts[slot] = option;
          const next: Build = { paints: build.paints };
          if (Object.keys(parts).length > 0) next.parts = parts;
          return { builds: { ...state.builds, [vehicle]: next } };
        }),
      rememberColor: (color) =>
        set((state) => {
          const hex = normalizeHex(color);
          if (!hex) return {};
          return { recents: [hex, ...state.recents.filter((item) => item !== hex)].slice(0, RECENT_COLORS) };
        }),
      resetVehicle: (vehicle) =>
        set((state) => ({
          builds: Object.fromEntries(Object.entries(state.builds).filter(([id]) => id !== vehicle)),
        })),
    }),
    {
      name: BUILDS_KEY,
      version: BUILDS_VERSION,
      storage: createJSONStorage(() => idbStorage),
      partialize: ({ current, builds, recents }) => ({ current, builds, recents }),
      migrate: (persisted) => sanitizeBuilds(persisted),
      merge: (persisted, current) => ({ ...current, ...sanitizeBuilds(persisted) }),
      onRehydrateStorage: () => () => {
        useBuilds.setState({ hydrated: true });
      },
    },
  ),
);
