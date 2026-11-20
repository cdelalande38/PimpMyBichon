/// <reference types="vite/client" />
// Catalogue des cartes de sortie (§ 5.5), découvert au build comme celui des véhicules
// (src/data/vehicles.ts) : chaque dossier public/assets/maps/<id>/ qui porte un map.json en fait
// partie, sans une ligne de code. Les manifestes sont validés ici (erreur claire, chemin du fichier
// compris) et triés par `order`. Aucun identifiant de carte n'est écrit dans le code.
// La route (route.json) n'entre pas dans le bundle : elle se charge à la première sortie
// (`fetchRoute`), validée par `validateRoute`.

import { MAP_RAIL_STRIDE, type MapId, type MapKind, type MapManifest, type MapRoute, type MapStart, type MapZone, type RailGround } from './mapTypes.ts';

/** Dossier des cartes, sous le socle de l'app. */
export const MAPS_DIR = 'assets/maps/';

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const KINDS: readonly MapKind[] = ['route', 'ville', 'circuit'];
const GROUNDS: readonly RailGround[] = ['sol', 'pont', 'tunnel'];
const DATE = /^\d{4}-\d{2}$/;
/** Nom de fichier relatif au dossier de la carte : ni « .. », ni chemin absolu, ni adresse. */
const FILE = /^(?!.*\.\.)(?![/\\])[a-zA-Z0-9_./-]{1,128}$/;
/** Image d'un fond d'écran de chargement. */
const IMAGE = /\.(webp|avif)$/;

type Raw = Record<string, unknown>;

function isObject(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function manifestPath(folder: string): string {
  return `public/${MAPS_DIR}${folder}/map.json`;
}

/** Valide un manifeste lu dans `public/assets/maps/<dossier>/map.json` ; lève une erreur claire sinon. */
export function validateMapManifest(raw: unknown, folder: string): MapManifest {
  const problems: string[] = [];
  if (!isObject(raw)) throw new Error(`Manifeste de carte invalide, ${manifestPath(folder)} : ce n'est pas un objet.`);
  if (typeof raw.id !== 'string' || !ID.test(raw.id)) problems.push('id invalide (minuscules, chiffres, « - » et « _ »)');
  else if (raw.id !== folder) problems.push(`id « ${raw.id} » différent du nom du dossier « ${folder} »`);
  if (!text(raw.name)) problems.push('name manquant');
  if (raw.hint !== undefined && !text(raw.hint)) problems.push('hint doit être un texte');
  if (!KINDS.includes(raw.kind as MapKind)) problems.push(`kind doit valoir ${KINDS.join(', ')}`);
  if (!finite(raw.order)) problems.push('order doit être un nombre');
  if (raw.zone !== undefined) {
    const zone = raw.zone;
    if (!isObject(zone)) problems.push('zone doit être un objet { id, label }');
    else {
      if (typeof zone.id !== 'string' || !ID.test(zone.id)) problems.push('zone.id invalide (minuscules, chiffres, « - » et « _ »)');
      if (!text(zone.label)) problems.push('zone.label manquant');
      if (zone.circuit !== undefined && !text(zone.circuit)) problems.push('zone.circuit doit être un texte');
    }
  }
  if (typeof raw.route !== 'string' || !FILE.test(raw.route)) problems.push('route doit être un nom de fichier relatif au dossier de la carte');
  if (raw.fond !== undefined) {
    const fond = raw.fond;
    const image = (value: unknown) => typeof value === 'string' && FILE.test(value) && IMAGE.test(value);
    if (!isObject(fond) || !image(fond.paysage) || !image(fond.portrait)) problems.push('fond doit être { paysage, portrait } : deux images (.webp ou .avif) du dossier de la carte');
  }
  if (!Array.isArray(raw.credits) || raw.credits.length === 0) {
    problems.push('credits : au moins une source à créditer (obligation de licence)');
  } else {
    raw.credits.forEach((credit: unknown, index) => {
      const where = `credits[${index}]`;
      if (!isObject(credit)) {
        problems.push(`${where} n'est pas un objet`);
        return;
      }
      if (!text(credit.source)) problems.push(`${where}.source manquant`);
      if (!text(credit.licence)) problems.push(`${where}.licence manquante`);
      if (typeof credit.date !== 'string' || !DATE.test(credit.date)) problems.push(`${where}.date doit être de la forme « AAAA-MM »`);
    });
  }
  if (problems.length > 0) throw new Error(`Manifeste de carte invalide, ${manifestPath(folder)} : ${problems.join(' ; ')}.`);
  return raw as unknown as MapManifest;
}

/** Nom du dossier d'un chemin de manifeste (« …/maps/<dossier>/map.json »). */
function folderOf(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 2] ?? '';
}

/**
 * Catalogue à partir des manifestes lus, indexés par chemin : validés, triés par `order` (puis par
 * identifiant). Un catalogue vide n'est pas une erreur : la sortie dit alors qu'aucune carte n'est
 * livrée avec cette version, et le garage reste utilisable.
 */
export function buildMapCatalog(entries: Record<string, unknown>): readonly MapManifest[] {
  const maps = Object.entries(entries).map(([path, raw]) => validateMapManifest(raw, folderOf(path)));
  // Un lieu porte le même nom sur toutes ses cartes : sinon le menu ne saurait lequel afficher.
  const labels = new Map<string, string>();
  for (const map of maps) {
    if (!map.zone) continue;
    const known = labels.get(map.zone.id);
    if (known !== undefined && known !== map.zone.label) {
      throw new Error(`Manifeste de carte invalide, ${manifestPath(map.id)} : zone « ${map.zone.id} » nommée « ${map.zone.label} » ici et « ${known} » ailleurs.`);
    }
    labels.set(map.zone.id, map.zone.label);
  }
  return Object.freeze([...maps].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
}

/** Lieu d'une carte : celui du manifeste, sinon un lieu à elle seule, du nom de la carte. */
export function zoneOf(map: MapManifest): MapZone {
  return map.zone ?? { id: `carte-${map.id}`, label: map.name };
}

/** Nom d'une carte dans son lieu (« Le circuit ») ; à défaut, son nom entier. */
export function circuitLabel(map: MapManifest): string {
  return map.zone?.circuit ?? map.name;
}

/** Un lieu du menu de la sortie et ses cartes, dans l'ordre du catalogue. */
export interface ZoneEntry {
  id: string;
  label: string;
  maps: readonly MapManifest[];
}

/**
 * Lieux du catalogue, dans l'ordre de leur première carte ; chacun avec ses cartes, dans l'ordre du
 * catalogue. Aucun lieu n'est écrit dans le code : tout vient des manifestes.
 */
export function zonesOf(catalog: readonly MapManifest[] = MAPS): readonly ZoneEntry[] {
  const zones: { id: string; label: string; maps: MapManifest[] }[] = [];
  for (const map of catalog) {
    const zone = zoneOf(map);
    const found = zones.find((item) => item.id === zone.id);
    if (found) found.maps.push(map);
    else zones.push({ id: zone.id, label: zone.label, maps: [map] });
  }
  return zones;
}

/** Le lieu d'identifiant donné, ou `undefined`. */
export function zoneById(id: string | null | undefined, catalog: readonly MapManifest[] = MAPS): ZoneEntry | undefined {
  return id ? zonesOf(catalog).find((zone) => zone.id === id) : undefined;
}

const MANIFESTS = import.meta.glob<unknown>('../../public/assets/maps/*/map.json', { eager: true, import: 'default' });

/** Toutes les cartes du catalogue, triées par `order`. */
export const MAPS: readonly MapManifest[] = buildMapCatalog(MANIFESTS);

export function mapById(id: MapId | null | undefined, catalog: readonly MapManifest[] = MAPS): MapManifest | undefined {
  return id ? catalog.find((map) => map.id === id) : undefined;
}

/** La carte demandée, ou la première du catalogue ; `undefined` si le catalogue est vide. */
export function resolveMap(id: MapId | null | undefined, catalog: readonly MapManifest[] = MAPS): MapManifest | undefined {
  return mapById(id, catalog) ?? catalog[0];
}

/** Adresse d'un fichier de la carte (route, tronçon, relief), sous le socle de l'app. */
export function mapFileUrl(map: Pick<MapManifest, 'id'>, file: string): string {
  return `${import.meta.env.BASE_URL}${MAPS_DIR}${map.id}/${file}`;
}

/** Ligne de crédit telle qu'on l'affiche : « IGN, BD TOPO · Licence Ouverte 2.0 · 2026-11 ». */
export function creditLine(credit: MapManifest['credits'][number]): string {
  return `${credit.source} · ${credit.licence} · ${credit.date}`;
}

/** Départ choisi parmi ceux de la route, ou le premier ; abscisse 0 si la route n'en déclare aucun. */
export function resolveStart(route: Pick<MapRoute, 'starts'>, id: string | null | undefined): MapStart {
  return route.starts.find((start) => start.id === id) ?? route.starts[0] ?? { id: 'depart', label: 'Départ', at: 0 };
}

/**
 * Valide une route lue dans route.json : forme, nombre de points, longueur, sections jointives.
 * Lève une erreur claire sinon (la sortie affiche alors son message d'erreur).
 */
export function validateRoute(raw: unknown, map: Pick<MapManifest, 'id'>): MapRoute {
  const where = `public/${MAPS_DIR}${map.id}/route.json`;
  const problems: string[] = [];
  if (!isObject(raw)) throw new Error(`Route de carte invalide, ${where} : ce n'est pas un objet.`);
  if (raw.format !== 'pmb-carte' || raw.version !== 1) problems.push('format ou version inconnus (attendu : pmb-carte, 1)');
  if (raw.id !== map.id) problems.push(`id « ${String(raw.id)} » différent de la carte « ${map.id} »`);
  if (typeof raw.loop !== 'boolean') problems.push('loop doit être vrai ou faux');
  const step = raw.step;
  const rail = raw.rail;
  if (!finite(step) || step <= 0) problems.push('step doit être un nombre positif');
  if (!Array.isArray(rail) || rail.length < 2 * MAP_RAIL_STRIDE || rail.length % MAP_RAIL_STRIDE !== 0 || !rail.every(finite)) {
    problems.push(`rail doit porter au moins deux points de ${MAP_RAIL_STRIDE} nombres`);
  } else if (finite(step) && finite(raw.length)) {
    const expected = (rail.length / MAP_RAIL_STRIDE - 1) * step;
    if (Math.abs(raw.length - expected) > step) problems.push(`length ${raw.length} ne correspond pas au rail (${expected} m)`);
  }
  if (!finite(raw.length) || raw.length <= 0) problems.push('length doit être un nombre positif');
  if (!Array.isArray(raw.sections) || raw.sections.length === 0) {
    problems.push('sections : au moins une');
  } else {
    let cursor = 0;
    raw.sections.forEach((section: unknown, index) => {
      if (!isObject(section) || !finite(section.from) || !finite(section.to) || !GROUNDS.includes(section.ground as RailGround)) {
        problems.push(`sections[${index}] mal formée`);
        return;
      }
      if (Math.abs(section.from - cursor) > 0.5) problems.push(`sections[${index}] ne suit pas la précédente`);
      if (!finite(section.width) || section.width <= 0 || !finite(section.lanes) || section.lanes < 1) problems.push(`sections[${index}] : largeur ou voies invalides`);
      cursor = section.to;
    });
  }
  if (!Array.isArray(raw.starts)) problems.push('starts doit être une liste');
  if (!Array.isArray(raw.chunks)) problems.push('chunks doit être une liste');
  if (problems.length > 0) throw new Error(`Route de carte invalide, ${where} : ${problems.join(' ; ')}.`);
  return raw as unknown as MapRoute;
}

/** Charge et valide la route d'une carte (servie par l'app, jamais par un tiers). */
export async function fetchRoute(map: MapManifest, signal?: AbortSignal): Promise<MapRoute> {
  const response = await fetch(mapFileUrl(map, map.route), signal ? { signal } : undefined);
  if (!response.ok) throw new Error(`Route introuvable (${response.status}) : ${map.route}`);
  return validateRoute(await response.json(), map);
}

const routes = new Map<MapId, Promise<MapRoute>>();

/**
 * Route d'une carte, chargée une seule fois par séance (le menu y lit les départs, la scène le rail).
 * Un échec n'est pas gardé : l'essai suivant recharge.
 */
export function loadRoute(map: MapManifest): Promise<MapRoute> {
  let pending = routes.get(map.id);
  if (!pending) {
    pending = fetchRoute(map);
    routes.set(map.id, pending);
    pending.catch(() => routes.delete(map.id));
  }
  return pending;
}
