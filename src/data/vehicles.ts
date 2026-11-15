/// <reference types="vite/client" />
// Catalogue des véhicules (§ 3, § 6), découvert au build : chaque dossier
// public/assets/vehicles/<id>/ qui porte un vehicle.json en fait partie, sans une ligne de code.
// Les manifestes sont validés ici (erreur claire, chemin du fichier compris) et triés par `order` :
// le premier est le véhicule de départ. Aucun identifiant de véhicule n'est écrit dans le code.

import { FINISHES } from './finishes.ts';
import type { EngineSpec, Paint, VehicleId, VehicleManifest, Zone, ZoneGroup } from './vehicleTypes.ts';

/** Dossier des véhicules, sous le socle de l'app. */
export const VEHICLES_DIR = 'assets/vehicles/';

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const HEX = /^#[0-9a-f]{6}$/;
const KINDS: ReadonlyArray<VehicleManifest['kind']> = ['car', 'bike'];
const WAVES: ReadonlyArray<VehicleManifest['wave']> = [0, 1, 2, 3];
const GROUPS: readonly ZoneGroup[] = ['carrosserie', 'accastillage'];
const FUELS: ReadonlyArray<EngineSpec['fuel']> = ['essence', 'diesel'];
const FEEDS: ReadonlyArray<EngineSpec['feed']> = ['carburateur', 'injection'];
const BOOSTS: ReadonlyArray<EngineSpec['boost']> = ['atmo', 'turbo', 'compresseur'];

type Raw = Record<string, unknown>;

function isObject(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function checkPaint(raw: unknown, where: string, problems: string[]): void {
  if (!isObject(raw)) {
    problems.push(`${where}.paint manquant`);
    return;
  }
  if (typeof raw.color !== 'string' || !HEX.test(raw.color)) problems.push(`${where}.paint.color doit être de la forme « #rrggbb » en minuscules`);
  if (!FINISHES.some((item) => item.id === raw.finish)) problems.push(`${where}.paint.finish inconnue (${String(raw.finish)})`);
  if (raw.flake !== undefined && !positive(raw.flake)) problems.push(`${where}.paint.flake doit être un nombre positif`);
  if (raw.color2 !== undefined && (typeof raw.color2 !== 'string' || !HEX.test(raw.color2))) problems.push(`${where}.paint.color2 doit être de la forme « #rrggbb »`);
}

function checkZones(raw: unknown, problems: string[]): void {
  if (!Array.isArray(raw) || raw.length === 0) {
    problems.push('zones : au moins une zone à colorer');
    return;
  }
  const seen = new Set<string>();
  raw.forEach((zone: unknown, index) => {
    const where = `zones[${index}]`;
    if (!isObject(zone)) {
      problems.push(`${where} n'est pas un objet`);
      return;
    }
    if (typeof zone.id !== 'string' || !ID.test(zone.id)) problems.push(`${where}.id invalide (minuscules, chiffres, « - » et « _ »)`);
    else if (seen.has(zone.id)) problems.push(`${where}.id « ${zone.id} » en double`);
    else seen.add(zone.id);
    if (!text(zone.label)) problems.push(`${where}.label manquant`);
    if (!strings(zone.materials)) problems.push(`${where}.materials doit être une liste de noms de matériaux`);
    if (!GROUPS.includes(zone.group as ZoneGroup)) problems.push(`${where}.group doit valoir ${GROUPS.join(' ou ')}`);
    if (zone.linked !== undefined && typeof zone.linked !== 'boolean') problems.push(`${where}.linked doit être vrai ou faux`);
    checkPaint(zone.paint, where, problems);
  });
}

function checkEngine(raw: unknown, problems: string[]): void {
  if (raw === undefined) return;
  if (!isObject(raw)) {
    problems.push('engine doit être un objet');
    return;
  }
  if (!text(raw.label)) problems.push('engine.label manquant');
  if (!FUELS.includes(raw.fuel as EngineSpec['fuel'])) problems.push(`engine.fuel doit valoir ${FUELS.join(' ou ')}`);
  if (!FEEDS.includes(raw.feed as EngineSpec['feed'])) problems.push(`engine.feed doit valoir ${FEEDS.join(' ou ')}`);
  if (!BOOSTS.includes(raw.boost as EngineSpec['boost'])) problems.push(`engine.boost doit valoir ${BOOSTS.join(', ')}`);
  if (!positive(raw.power)) problems.push('engine.power doit être un nombre de chevaux positif');
}

/** Chemin du manifeste d'un dossier, tel qu'on le cite dans une erreur. */
export function manifestPath(folder: string): string {
  return `public/${VEHICLES_DIR}${folder}/vehicle.json`;
}

/**
 * Valide un manifeste lu dans le dossier `folder`. Lève une erreur qui cite le fichier et chaque
 * problème trouvé ; rend le manifeste typé sinon.
 */
export function validateManifest(raw: unknown, folder: string): VehicleManifest {
  const problems: string[] = [];
  if (!isObject(raw)) {
    problems.push("le contenu n'est pas un objet JSON");
  } else {
    if (raw.id !== folder) problems.push(`id ${raw.id === undefined ? 'absent' : `« ${String(raw.id)} »`} : il doit être égal au nom du dossier, « ${folder} »`);
    if (!ID.test(folder)) problems.push(`nom de dossier « ${folder} » invalide (minuscules, chiffres, « - » et « _ »)`);
    if (!text(raw.name)) problems.push('name manquant');
    if (!KINDS.includes(raw.kind as VehicleManifest['kind'])) problems.push(`kind doit valoir ${KINDS.join(' ou ')}`);
    if (!WAVES.includes(raw.wave as VehicleManifest['wave'])) problems.push('wave doit valoir 0, 1, 2 ou 3');
    if (typeof raw.order !== 'number' || !Number.isFinite(raw.order)) problems.push('order doit être un nombre');
    if (typeof raw.glb !== 'string' || !/^[a-z0-9][a-z0-9_.-]*\.glb$/i.test(raw.glb) || raw.glb.includes('..')) {
      problems.push('glb doit être un nom de fichier .glb du dossier (« body.glb »)');
    }
    if (raw.hint !== undefined && typeof raw.hint !== 'string') problems.push('hint doit être un texte');
    if (raw.placeholder !== undefined && (typeof raw.placeholder !== 'string' || !/^placeholder_[a-z0-9_]+$/.test(raw.placeholder))) {
      problems.push('placeholder doit être un nom « placeholder_* » déclaré dans TODO_ASSETS.md');
    }
    if (!positive(raw.halfLengthHint)) problems.push('halfLengthHint doit être une demi-longueur positive, en mètres');
    checkZones(raw.zones, problems);
    checkEngine(raw.engine, problems);
    if (raw.adapt !== undefined && !isObject(raw.adapt)) problems.push('adapt doit être un objet');
    if (raw.presentSide !== undefined && raw.presentSide !== 'gauche' && raw.presentSide !== 'droite') {
      problems.push('presentSide doit valoir « gauche » ou « droite »');
    }
    if (raw.interiorView !== undefined) {
      const view = raw.interiorView;
      const point = (value: unknown) => Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number' && Number.isFinite(n));
      if (!isObject(view) || !point(view.eye) || !point(view.target)) problems.push('interiorView doit porter eye et target, trois nombres chacun, en mètres');
    }
  }
  if (problems.length > 0) {
    throw new Error(`Manifeste de véhicule invalide, ${manifestPath(folder)} : ${problems.join(' ; ')}.`);
  }
  return raw as unknown as VehicleManifest;
}

/** Nom du dossier d'un chemin de manifeste (« …/vehicles/<dossier>/vehicle.json »). */
export function folderOf(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 2] ?? '';
}

/**
 * Catalogue à partir des manifestes lus, indexés par chemin : validés, triés par `order` (puis par
 * identifiant, pour un ordre stable). Lève une erreur si un manifeste est faux ou si rien n'est lu.
 */
export function buildCatalog(entries: Record<string, unknown>): readonly VehicleManifest[] {
  const vehicles = Object.entries(entries).map(([path, raw]) => validateManifest(raw, folderOf(path)));
  if (vehicles.length === 0) throw new Error(`Catalogue vide : aucun vehicle.json sous public/${VEHICLES_DIR}.`);
  return Object.freeze([...vehicles].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
}

// Découverte au build (et sous Vitest) : chaque manifeste entre dans le bundle, le modèle reste un
// fichier servi par l'app et chargé à la demande.
const MANIFESTS = import.meta.glob<unknown>('../../public/assets/vehicles/*/vehicle.json', { eager: true, import: 'default' });

/** Tous les véhicules du catalogue, triés par `order`. */
export const VEHICLES: readonly VehicleManifest[] = buildCatalog(MANIFESTS);

export function vehicleById(id: VehicleId | null | undefined): VehicleManifest | undefined {
  return id ? VEHICLES.find((vehicle) => vehicle.id === id) : undefined;
}

/** Le véhicule courant, ou celui de départ (le premier du catalogue) s'il est absent ou inconnu. */
export function resolveVehicle(current: VehicleId | null): VehicleManifest {
  return vehicleById(current) ?? (VEHICLES[0] as VehicleManifest);
}

/** Adresse du modèle d'un véhicule, sous le socle de l'app. */
export function modelUrl(vehicle: Pick<VehicleManifest, 'id' | 'glb'>): string {
  return `${import.meta.env.BASE_URL}${VEHICLES_DIR}${vehicle.id}/${vehicle.glb}`;
}

// Modèles présents au moment du build (« <id>/<fichier> »), relevés par vite.config.ts : les GLB
// des substituts sont produits avant le build et peuvent manquer. Absent hors build (tests).
declare const __PMB_VEHICLE_MODELS__: readonly string[] | undefined;

/** Vrai ou faux si le build sait si le modèle existe ; `null` s'il n'en sait rien. */
export function modelPresent(vehicle: Pick<VehicleManifest, 'id' | 'glb'>): boolean | null {
  const known = typeof __PMB_VEHICLE_MODELS__ === 'undefined' ? null : __PMB_VEHICLE_MODELS__;
  return known === null ? null : known.includes(`${vehicle.id}/${vehicle.glb}`);
}

/** Peinture d'origine de la zone maîtresse : la pastille du véhicule dans le catalogue. */
export function originPaint(vehicle: Pick<VehicleManifest, 'zones'>): Paint | undefined {
  const master: Zone | undefined = vehicle.zones.find((zone) => zone.group === 'carrosserie') ?? vehicle.zones[0];
  return master?.paint;
}
