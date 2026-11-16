/// <reference types="vite/client" />
// Habitacle (§ 5.4, demande du 15 novembre 2026 : « les pommeaux de vitesse, les types de sièges,
// les volants… les ciels de toit étoilés en LED ou pas ») : volants, pommeaux et sièges avant
// partagés, et le ciel étoilé. Le catalogue est une donnée, public/assets/shared/habitacle/
// catalogue.json (une pièce = une ligne, fabriquée par npm run vehicles:build) ; ce qu'un véhicule
// monte d'origine est dans son manifeste (sections `interior` et `cabin.sky`). Ce fichier résout,
// sans rien connaître d'aucun véhicule, ce que l'atelier pose. Une valeur inconnue retombe sur
// l'origine.
//
// Dans le build : parts.volant, parts.pommeau, parts.sieges (identifiants du catalogue), parts.ciel
// ('allume' ou 'eteint'), partPaints.volant (jante), partPaints.pommeau (pommeau sans zone de
// peinture), partPaints.ciel (couleur des étoiles), tune.ciel_densite (0, 1 ou 2).

import type { Build, CabinLighting, Hex, StarrySky, VehicleManifest } from './vehicleTypes.ts';

export interface InteriorPiece {
  id: string;
  /** Famille de modelage (tools/vehicles/habitacle.mjs). */
  style: string;
  label: string;
  hint?: string;
  /** Couleur d'origine de la partie à couleur libre (jante du volant, pommeau). */
  color?: Hex;
  /** Rugosité de la jante (bois verni, cuir) ; absente : 0,55. */
  roughness?: number;
}

export interface SkyDensity {
  id: string;
  label: string;
  /** Part du nombre de points du manifeste. */
  factor: number;
}

export interface InteriorCatalogue {
  /** Noms des ancres dans les modèles. */
  anchors: { steering: string; knob: string; seats: readonly string[] };
  steering: readonly InteriorPiece[];
  knobs: readonly InteriorPiece[];
  seats: readonly InteriorPiece[];
  /** Crans de densité du ciel étoilé ; `origin` : le cran d'origine. */
  sky: { densities: readonly SkyDensity[]; origin: number };
}

/** Dossier des pièces d'habitacle partagées, sous le socle de l'app. */
export const INTERIOR_DIR = 'assets/shared/habitacle/';

/** Postes du build (parts, partPaints) et curseur (tune) de l'habitacle. */
export const INTERIOR_SLOTS = Object.freeze({ steering: 'volant', knob: 'pommeau', seats: 'sieges', sky: 'ciel' });
export const SKY_TUNE = 'ciel_densite';
/** Options du poste « ciel ». */
export const SKY_ON = 'allume';
export const SKY_OFF = 'eteint';

/** Lumière d'habitacle quand le ciel est éteint : un plafonnier blanc chaud, plus doux. */
const DOME_LIGHT = Object.freeze({ color: '#ffe2c0', factor: 0.6 });

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const HEX = /^#[0-9a-f]{6}$/;

type Raw = Record<string, unknown>;
const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Valide le catalogue (erreur claire) et le rend typé. */
export function validateInteriorCatalogue(raw: unknown): InteriorCatalogue {
  const where = 'public/assets/shared/habitacle/catalogue.json';
  if (!isObject(raw)) throw new Error(`Catalogue de l'habitacle invalide, ${where} : ce n'est pas un objet JSON.`);
  const problems: string[] = [];
  const anchors = raw.anchors;
  if (
    !isObject(anchors) ||
    typeof anchors.steering !== 'string' ||
    typeof anchors.knob !== 'string' ||
    !Array.isArray(anchors.seats) ||
    anchors.seats.length === 0 ||
    !anchors.seats.every((name) => typeof name === 'string')
  ) {
    problems.push('anchors doit porter steering, knob et seats (noms de nœuds)');
  }
  for (const list of ['steering', 'knobs', 'seats'] as const) {
    const items = Array.isArray(raw[list]) ? (raw[list] as unknown[]) : [];
    if (items.length === 0) problems.push(`${list} : au moins une pièce`);
    const seen = new Set<string>();
    items.forEach((item, i) => {
      if (!isObject(item) || typeof item.id !== 'string' || !ID.test(item.id) || typeof item.style !== 'string' || typeof item.label !== 'string') {
        problems.push(`${list}[${i}] doit porter id, style et label`);
        return;
      }
      if (seen.has(item.id)) problems.push(`${list}[${i}].id « ${item.id} » en double`);
      seen.add(item.id);
      if (list !== 'seats' && (typeof item.color !== 'string' || !HEX.test(item.color))) problems.push(`${list}[${i}].color doit être une couleur #rrggbb`);
    });
  }
  const sky = raw.sky;
  const densities = isObject(sky) && Array.isArray(sky.densities) ? sky.densities : [];
  if (densities.length !== 3 || !densities.every((d: unknown) => isObject(d) && typeof d.id === 'string' && typeof d.label === 'string' && typeof d.factor === 'number' && d.factor > 0 && d.factor <= 3)) {
    problems.push('sky.densities doit porter trois crans (id, label, factor de 0 à 3)');
  }
  if (!isObject(sky) || !Number.isInteger(sky.origin) || (sky.origin as number) < 0 || (sky.origin as number) >= densities.length) problems.push('sky.origin doit être le rang d’un cran');
  if (problems.length > 0) throw new Error(`Catalogue de l'habitacle invalide, ${where} : ${problems.join(' ; ')}.`);
  return raw as unknown as InteriorCatalogue;
}

const FOUND = import.meta.glob<unknown>('../../public/assets/shared/habitacle/catalogue.json', { eager: true, import: 'default' });

/** Le catalogue de l'habitacle partagé. */
export const INTERIOR_CATALOGUE: InteriorCatalogue = validateInteriorCatalogue(Object.values(FOUND)[0]);

/** Fichiers des pièces (mêmes noms que tools/vehicles/habitacle.mjs). */
export const steeringFile = (id: string): string => `volant_${id}.glb`;
export const knobFile = (id: string): string => `pommeau_${id}.glb`;
export const seatFile = (id: string): string => `siege_${id}.glb`;

/** Ce que l'atelier propose pour ce véhicule : des choix, un intérieur gardé (vrai modèle), ou rien. */
export function interiorMode(vehicle: Pick<VehicleManifest, 'interior' | 'cabin'>): 'choix' | 'fixe' | 'aucun' {
  if (vehicle.interior?.fixed) return 'fixe';
  if (vehicle.interior?.steering || vehicle.interior?.knob || vehicle.interior?.seats || vehicle.cabin?.sky) return 'choix';
  return 'aucun';
}

export interface ResolvedInterior {
  steering: InteriorPiece | null;
  /** Couleur de la jante du volant. */
  steeringColor: Hex;
  knob: InteriorPiece | null;
  /** Couleur propre du pommeau (sans zone de peinture). */
  knobColor: Hex;
  /** Zone de peinture qui colore le pommeau, si le véhicule en a une. */
  knobZone: string | null;
  seats: InteriorPiece | null;
  /** Zone de peinture de la sellerie, si le véhicule en a une. */
  seatZone: string | null;
  seatScale: number;
}

function pick(list: readonly InteriorPiece[], chosen: string | undefined, origin: string | undefined): InteriorPiece | null {
  return list.find((item) => item.id === chosen) ?? list.find((item) => item.id === origin) ?? list[0] ?? null;
}

function hexOf(build: Build | undefined, slot: string): Hex | undefined {
  const color = build?.partPaints?.[slot]?.color;
  return typeof color === 'string' && HEX.test(color) ? color : undefined;
}

/**
 * Ce que l'atelier pose dans l'habitacle de ce véhicule pour ce build. `null` : véhicule sans
 * pièces d'habitacle au choix (moto, vrai modèle).
 */
export function resolveInterior(vehicle: Pick<VehicleManifest, 'interior' | 'zones'>, build: Build | undefined, catalogue: InteriorCatalogue = INTERIOR_CATALOGUE): ResolvedInterior | null {
  const interior = vehicle.interior;
  if (!interior || interior.fixed) return null;
  const zone = (id: string | undefined) => (id && vehicle.zones.some((item) => item.id === id) ? id : null);
  const steering = interior.steering ? pick(catalogue.steering, build?.parts?.[INTERIOR_SLOTS.steering], interior.steering.default) : null;
  const knob = interior.knob ? pick(catalogue.knobs, build?.parts?.[INTERIOR_SLOTS.knob], interior.knob.default) : null;
  const seats = interior.seats ? pick(catalogue.seats, build?.parts?.[INTERIOR_SLOTS.seats], interior.seats.default) : null;
  const scale = interior.seats?.scale;
  return {
    steering,
    steeringColor: hexOf(build, INTERIOR_SLOTS.steering) ?? steering?.color ?? '#141416',
    knob,
    knobColor: hexOf(build, INTERIOR_SLOTS.knob) ?? knob?.color ?? '#141416',
    knobZone: zone(interior.knob?.zone),
    seats,
    seatZone: zone(interior.seats?.zone),
    seatScale: typeof scale === 'number' && scale > 0.5 && scale < 2 ? scale : 1,
  };
}

/** Fichiers à charger pour cet habitacle, sous le dossier des pièces partagées. */
export function interiorFiles(resolved: ResolvedInterior | null): { steering: string | null; knob: string | null; seat: string | null } | null {
  if (!resolved) return null;
  return {
    steering: resolved.steering ? steeringFile(resolved.steering.id) : null,
    knob: resolved.knob ? knobFile(resolved.knob.id) : null,
    seat: resolved.seats ? seatFile(resolved.seats.id) : null,
  };
}

export interface ResolvedSky {
  on: boolean;
  color: Hex;
  /** Rang du cran de densité (0 à 2). */
  density: number;
}

/** État du ciel étoilé de ce véhicule pour ce build ; `null` : pas de ciel étoilé. */
export function resolveSky(vehicle: Pick<VehicleManifest, 'cabin'>, build: Build | undefined, catalogue: InteriorCatalogue = INTERIOR_CATALOGUE): ResolvedSky | null {
  const sky = vehicle.cabin?.sky;
  if (!sky) return null;
  const state = build?.parts?.[INTERIOR_SLOTS.sky];
  const on = state === SKY_ON ? true : state === SKY_OFF ? false : sky.on !== false;
  const raw = build?.tune?.[SKY_TUNE];
  const max = catalogue.sky.densities.length - 1;
  const density = typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= max ? raw : catalogue.sky.origin;
  return { on, color: hexOf(build, INTERIOR_SLOTS.sky) ?? sky.color, density };
}

/**
 * L'habitacle allumé de ce véhicule pour ce build : le ciel du manifeste à la couleur et à la
 * densité choisies (absent s'il est éteint), la lumière d'habitacle à sa couleur (plafonnier blanc
 * chaud, plus doux, ciel éteint). `undefined` : le véhicule n'allume rien.
 */
export function cabinFor(vehicle: Pick<VehicleManifest, 'cabin'>, build: Build | undefined, catalogue: InteriorCatalogue = INTERIOR_CATALOGUE): CabinLighting | undefined {
  const cabin = vehicle.cabin;
  if (!cabin) return undefined;
  const state = resolveSky(vehicle, build, catalogue);
  if (!state || !cabin.sky) return cabin;
  const factor = catalogue.sky.densities[state.density]?.factor ?? 1;
  const sky: StarrySky | undefined = state.on ? { ...cabin.sky, color: state.color, count: Math.max(1, Math.round(cabin.sky.count * factor)) } : undefined;
  const light = cabin.light && (state.on ? { ...cabin.light, color: cabin.light.color ?? state.color } : { ...cabin.light, color: DOME_LIGHT.color, intensity: cabin.light.intensity * DOME_LIGHT.factor });
  return { ...cabin, sky, light };
}

/** Postes du build que l'habitacle retient (pour « D'origine »). */
export function interiorKeys(): { parts: string[]; partPaints: string[]; tune: string[] } {
  const { steering, knob, seats, sky } = INTERIOR_SLOTS;
  return { parts: [steering, knob, seats, sky], partPaints: [steering, knob, sky], tune: [SKY_TUNE] };
}

/** Vrai si le build a touché à l'habitacle (pièces, couleurs, ciel), ou à la zone du pommeau. */
export function interiorTouched(build: Build | undefined, knobZone: string | null = null): boolean {
  const keys = interiorKeys();
  return (
    keys.parts.some((id) => build?.parts?.[id] !== undefined) ||
    keys.partPaints.some((id) => build?.partPaints?.[id] !== undefined) ||
    keys.tune.some((id) => build?.tune?.[id] !== undefined) ||
    (knobZone !== null && build?.paints[knobZone] !== undefined)
  );
}

/** Teintes proposées par volet ; « Autre » ouvre le nuancier du téléphone. */
export const INTERIOR_SWATCHES: Readonly<Record<'volant' | 'pommeau' | 'ciel', ReadonlyArray<{ color: Hex; label: string }>>> = {
  volant: [
    { color: '#141416', label: 'Noir' },
    { color: '#e9e2cf', label: 'Ivoire' },
    { color: '#6e3a1c', label: 'Bois' },
    { color: '#c81e1e', label: 'Rouge' },
    { color: '#1b3fa0', label: 'Bleu' },
    { color: '#22d3b6', label: 'Turquoise' },
  ],
  pommeau: [
    { color: '#e9e0c8', label: 'Os' },
    { color: '#141416', label: 'Noir' },
    { color: '#e9e2cf', label: 'Ivoire' },
    { color: '#c81e1e', label: 'Rouge' },
    { color: '#1b3fa0', label: 'Bleu' },
    { color: '#ffb224', label: 'Jaune' },
  ],
  ciel: [
    { color: '#ff2a1f', label: 'Rouge' },
    { color: '#ffd28a', label: 'Blanc chaud' },
    { color: '#e8f0ff', label: 'Blanc froid' },
    { color: '#3b7bff', label: 'Bleu' },
    { color: '#b04dff', label: 'Violet' },
    { color: '#22d3b6', label: 'Turquoise' },
  ],
};
