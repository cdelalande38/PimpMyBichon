// Néons du véhicule (Custom › Néons, § 5.4 « néons : une couleur par zone ») : tubes sous la caisse, dans
// les passages de roue, sous le cadre d'une moto, et LED d'ambiance de l'habitacle. Données pures :
// l'interface (src/ui/neons/, src/ui/habitacle/), le garage (src/scene/vehicle/neons.ts) et la sortie
// (src/drive/scene/neons.ts) les lisent ; les prix sont dans src/data/articles/neons.ts.
//
// Où passent les tubes : section `neons` du manifeste de chaque véhicule (une entrée par zone, des lignes
// brisées dans le repère du véhicule ; les arceaux des roues sont tirés des ancres de roue par l'app).
// Aucun identifiant de véhicule ici.
//
// Sauvegarde (Build, src/data/vehicleTypes.ts), sans champ nouveau : `parts.neon_<zone>` (allumée, et son
// mode : « fixe » ou « respiration »), `partPaints.neon_<zone>` (couleur), `tune.neon_<zone>` (intensité,
// écrite seulement quand elle n'est pas celle d'origine). Une zone éteinte n'écrit rien ; une valeur
// inconnue retombe sur éteint.

import type { Build, Hex, VehicleManifest, VehicleNeonZone, VehiclePoint } from './vehicleTypes.ts';

export type NeonMode = 'fixe' | 'respiration';

/** Une zone du catalogue : son nom, sa couleur au premier allumage, si elle est libre. */
export interface NeonZoneInfo {
  id: string;
  label: string;
  /** Ligne d'atelier sous le nom. */
  hint: string;
  /** Couleur posée au premier allumage. */
  couleur: Hex;
  /** Libre à l'essai : pas d'article, jamais de cadenas. */
  libre?: true;
  /** LED de l'habitacle : la lueur se pose sur le plancher de l'habitacle et suit la caisse. */
  habitacle?: true;
}

/**
 * Les zones, dans l'ordre d'affichage. Les voitures déclarent avant, flancs, arrière, roues (passages de
 * roue), habitacle ; les motos, cadre et roues. La première zone d'une voiture (l'avant) et celle d'une
 * moto (le cadre) sont libres, pour essayer ; les autres se débloquent avec des dollars.
 */
export const NEON_ZONES: readonly NeonZoneInfo[] = [
  { id: 'avant', label: 'Avant', hint: 'Sous le bouclier', couleur: '#18e4ff', libre: true },
  { id: 'flancs', label: 'Flancs', hint: 'Sous les bas de caisse', couleur: '#ff2bd6' },
  { id: 'arriere', label: 'Arrière', hint: 'Sous le bouclier arrière', couleur: '#ff2bd6' },
  { id: 'cadre', label: 'Sous le cadre', hint: 'Le long du moteur', couleur: '#18e4ff', libre: true },
  { id: 'roues', label: 'Roues', hint: 'Dans les passages de roue', couleur: '#18e4ff' },
  { id: 'habitacle', label: 'Habitacle', hint: 'LED d’ambiance', couleur: '#a259ff', habitacle: true },
];

/** Rang d'une zone dans le catalogue (index des tableaux des nuanceurs). */
export const NEON_ZONE_COUNT = NEON_ZONES.length;

export const NEON_MODES: ReadonlyArray<{ id: NeonMode; label: string; hint: string }> = [
  { id: 'fixe', label: 'Fixe', hint: 'Toujours à fond' },
  { id: 'respiration', label: 'Respiration', hint: 'Monte et descend, lentement' },
];

/** Intensité d'une zone : un curseur, de `min` à `max`, `origine` quand rien n'est écrit. */
export const NEON_INTENSITE = Object.freeze({ min: 0.2, max: 1, step: 0.05, origine: 0.8 });

/** Respiration : période (s) et creux (part de la lueur gardée au plus bas). Jamais un stroboscope. */
export const NEON_RESPIRATION = Object.freeze({ periode: 3.6, creux: 0.3 });

/** Teintes proposées d'un appui ; « Autre » ouvre le nuancier de la peinture. */
export const NEON_TEINTES: ReadonlyArray<{ color: Hex; label: string }> = [
  { color: '#18e4ff', label: 'Cyan' },
  { color: '#ff2bd6', label: 'Magenta' },
  { color: '#a259ff', label: 'Violet' },
  { color: '#2f6bff', label: 'Bleu' },
  { color: '#ff2a1f', label: 'Rouge' },
  { color: '#ff9a1a', label: 'Ambre' },
  { color: '#3dff7a', label: 'Vert' },
  { color: '#f2f6ff', label: 'Blanc' },
];

/** Poste du build d'une zone : `neon_<zone>` (parts, partPaints, tune). */
export function neonSlot(zone: string): string {
  return `neon_${zone}`;
}

export function zoneInfo(id: string): NeonZoneInfo | undefined {
  return NEON_ZONES.find((zone) => zone.id === id);
}

/** Les zones que ce véhicule déclare, dans l'ordre du catalogue, avec le nom que le manifeste leur donne. */
export function neonZonesOf(vehicle: Pick<VehicleManifest, 'neons'>): Array<NeonZoneInfo & { spec: VehicleNeonZone }> {
  const neons = vehicle.neons;
  if (!neons) return [];
  return NEON_ZONES.flatMap((zone) => {
    const spec = neons[zone.id];
    return spec ? [{ ...zone, label: spec.label ?? zone.label, hint: spec.hint ?? zone.hint, spec }] : [];
  });
}

/** Ce qu'une zone monte pour ce build. */
export interface NeonEtat {
  zone: NeonZoneInfo;
  on: boolean;
  mode: NeonMode;
  color: Hex;
  /** De `NEON_INTENSITE.min` à `max`. */
  intensity: number;
}

const HEX = /^#[0-9a-f]{6}$/;

/** Intensité lue dans le build : bornée, l'origine si elle n'est pas un nombre. */
export function intensiteNeon(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return NEON_INTENSITE.origine;
  return Math.min(NEON_INTENSITE.max, Math.max(NEON_INTENSITE.min, value));
}

/** État d'une zone dans un build : éteinte si rien n'est écrit ou si le mode est inconnu. */
export function etatNeon(zone: NeonZoneInfo, build: Pick<Build, 'parts' | 'partPaints' | 'tune'> | undefined): NeonEtat {
  const slot = neonSlot(zone.id);
  const raw = build?.parts?.[slot];
  const mode = NEON_MODES.find((item) => item.id === raw)?.id;
  const color = build?.partPaints?.[slot]?.color;
  return {
    zone,
    on: mode !== undefined,
    mode: mode ?? 'fixe',
    color: typeof color === 'string' && HEX.test(color) ? color : zone.couleur,
    intensity: intensiteNeon(build?.tune?.[slot]),
  };
}

/** Les zones de ce véhicule et leur état pour ce build, dans l'ordre du catalogue. */
export function resolveNeons(vehicle: Pick<VehicleManifest, 'neons'>, build: Pick<Build, 'parts' | 'partPaints' | 'tune'> | undefined): NeonEtat[] {
  return neonZonesOf(vehicle).map((zone) => etatNeon(zone, build));
}

/** Vrai si au moins une zone est allumée. */
export function neonsAllumes(vehicle: Pick<VehicleManifest, 'neons'>, build: Pick<Build, 'parts' | 'partPaints' | 'tune'> | undefined): boolean {
  return resolveNeons(vehicle, build).some((etat) => etat.on);
}

/**
 * Clé stable de ce que les néons d'un build montrent (zones allumées, mode, couleur, intensité) : la scène
 * ne se refait que quand elle change. Vide : tout est éteint.
 */
export function neonSignature(vehicle: Pick<VehicleManifest, 'neons'>, build: Pick<Build, 'parts' | 'partPaints' | 'tune'> | undefined): string {
  return resolveNeons(vehicle, build)
    .filter((etat) => etat.on)
    .map((etat) => `${etat.zone.id}:${etat.mode}:${etat.color}:${etat.intensity.toFixed(2)}`)
    .join('|');
}

/** Zones allumées relues dans une clé de `neonSignature` (les éteintes n'y sont pas). */
export function etatsDeSignature(signature: string): NeonEtat[] {
  if (signature === '') return [];
  return signature.split('|').flatMap((part) => {
    const [id, mode, color, intensity] = part.split(':');
    const zone = zoneInfo(id ?? '');
    if (!zone || typeof color !== 'string' || !HEX.test(color)) return [];
    return [{ zone, on: true, mode: mode === 'respiration' ? ('respiration' as const) : ('fixe' as const), color, intensity: intensiteNeon(Number(intensity)) }];
  });
}

/** Postes du build que les néons retiennent (pour « Tout éteindre »). */
export function neonKeys(vehicle: Pick<VehicleManifest, 'neons'>): { parts: string[]; partPaints: string[]; tune: string[] } {
  const slots = neonZonesOf(vehicle).map((zone) => neonSlot(zone.id));
  return { parts: slots, partPaints: slots, tune: slots };
}

// ---------------------------------------------------------------------------------------------
// Boutique : identifiants des articles (convention `piece-<poste>-<option>`, src/data/boutique.ts).

/** Article d'une zone ; `null` : zone libre. */
export function articleNeon(zone: string): string | null {
  return zoneInfo(zone)?.libre ? null : `piece-neon-${zone}`;
}

// ---------------------------------------------------------------------------------------------
// Géométrie : tubes du manifeste et arceaux des roues, lueurs au sol et sur le plancher de l'habitacle.

/** Rayon d'un tube sous la caisse et d'un ruban de LED, en mètres, quand le manifeste n'en donne pas. */
export const NEON_TUBE = Object.freeze({ rayon: 0.011, ruban: 0.006, min: 0.003, max: 0.04 });

/**
 * Arceaux des roues : une voiture a un arc au-dessus du pneu, `ecart` au-delà de son rayon, rentré de
 * `retrait` dans le passage depuis le flanc du pneu, de `de` à `a` degrés (0 : vers l'avant, 90 : en haut) ;
 * une moto a un cercle de chaque côté de la jante, à `jante` de son rayon.
 */
export const NEON_ARCEAUX = Object.freeze({ ecart: 0.035, retrait: 0.05, de: 25, a: 155, pas: 13, jante: 0.82, cercle: 20, cote: 0.035 });

/**
 * Lueur au sol d'un tube : portée (m) tirée de sa hauteur au-dessus du sol, entre `min` et `max`, et
 * force au plus près, qui baisse quand le tube monte (`hauteur`).
 */
export const NEON_LUEUR = Object.freeze({ base: 0.28, parMetre: 1.5, min: 0.32, max: 1.05, hauteur: 0.3 });

export function porteeLueur(hauteur: number): number {
  return Math.min(NEON_LUEUR.max, Math.max(NEON_LUEUR.min, NEON_LUEUR.base + NEON_LUEUR.parMetre * Math.max(0, hauteur)));
}

export function forceLueur(hauteur: number): number {
  const k = Math.max(0, hauteur) / NEON_LUEUR.hauteur;
  return 1 / (1 + k * k);
}

/** Une lueur posée sur un plan horizontal, le long d'une ligne (x, z) : portée et force. */
export interface NeonNappe {
  zone: number;
  /** Points de la ligne, (x, z) ; un seul : une tache ronde. */
  points: ReadonlyArray<readonly [number, number]>;
  /** Hauteur du plan (m). */
  y: number;
  portee: number;
  force: number;
}

/** Cercle ou arc de points autour de `centre`, dans le plan vertical du véhicule (x, y) à la cote `z`. */
export function arc(centre: VehiclePoint, rayon: number, de: number, a: number, pas: number, z: number): VehiclePoint[] {
  const out: VehiclePoint[] = [];
  for (let i = 0; i <= pas; i += 1) {
    const t = ((de + ((a - de) * i) / pas) * Math.PI) / 180;
    out.push([centre[0] + rayon * Math.cos(t), centre[1] + rayon * Math.sin(t), z]);
  }
  return out;
}

/** Une roue posée, dans le repère de la caisse : centre, rayon du pneu, de la jante, demi-largeur du pneu. */
export interface RoueNeon {
  centre: VehiclePoint;
  rayon: number;
  jante: number;
  demiLargeur: number;
}

/**
 * Lignes des arceaux d'une zone « roues » : un arc au-dessus de chaque roue d'une voiture, côté flanc
 * extérieur, ou deux cercles par roue d'une moto. `cote` : signe du flanc extérieur de la roue (z).
 */
export function arceaux(kind: 'car' | 'bike', roues: readonly RoueNeon[]): VehiclePoint[][] {
  const A = NEON_ARCEAUX;
  return roues.flatMap((roue) => {
    const [x, y, z] = roue.centre;
    if (kind === 'bike') {
      const r = roue.jante * A.jante;
      return [-1, 1].map((s) => arc([x, y, z], r, 0, 360, A.cercle, z + s * (roue.demiLargeur + A.cote)));
    }
    const exterieur = z >= 0 ? 1 : -1;
    return [arc([x, y, z], roue.rayon + A.ecart, A.de, A.a, A.pas, z + exterieur * (roue.demiLargeur - A.retrait))];
  });
}

// ---------------------------------------------------------------------------------------------
// Validation de la section `neons` d'un manifeste (src/data/vehicles.ts, validateManifest).

type Raw = Record<string, unknown>;
const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
const point = (value: unknown): value is VehiclePoint => Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 10);

export function checkNeons(raw: unknown, kind: unknown, problems: string[]): void {
  if (raw === undefined) return;
  if (!isObject(raw)) {
    problems.push('neons doit être un objet (une entrée par zone)');
    return;
  }
  for (const [id, value] of Object.entries(raw)) {
    const where = `neons.${id}`;
    const info = zoneInfo(id);
    if (!info) {
      problems.push(`${where} : zone inconnue (${NEON_ZONES.map((zone) => zone.id).join(', ')})`);
      continue;
    }
    if (!isObject(value)) {
      problems.push(`${where} doit être un objet`);
      continue;
    }
    const tubes = value.tubes;
    const hasTubes = Array.isArray(tubes) && tubes.length > 0;
    if (tubes !== undefined && !(Array.isArray(tubes) && tubes.every((line) => Array.isArray(line) && line.length >= 2 && line.length <= 64 && line.every(point)))) {
      problems.push(`${where}.tubes doit être une liste de lignes (deux points ou plus, trois nombres chacun)`);
    }
    if (value.arceaux !== undefined && value.arceaux !== true) problems.push(`${where}.arceaux doit valoir vrai`);
    if (!hasTubes && value.arceaux !== true) problems.push(`${where} : des tubes, ou des arceaux de roue`);
    if (value.arceaux === true && id !== 'roues') problems.push(`${where}.arceaux : seulement pour la zone roues`);
    if (value.radius !== undefined && !(typeof value.radius === 'number' && value.radius >= NEON_TUBE.min && value.radius <= NEON_TUBE.max)) {
      problems.push(`${where}.radius doit être un rayon de ${NEON_TUBE.min} à ${NEON_TUBE.max} m`);
    }
    for (const key of ['label', 'hint'] as const) if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].trim() === '')) problems.push(`${where}.${key} doit être un texte`);
    if (info.habitacle) {
      if (kind === 'bike') problems.push(`${where} : une moto n’a pas d’habitacle`);
      const pools = value.pools;
      if (pools !== undefined && !(Array.isArray(pools) && pools.every((pool) => isObject(pool) && point(pool.from) && point(pool.to) && typeof pool.radius === 'number' && pool.radius > 0 && pool.radius < 1.5))) {
        problems.push(`${where}.pools doit être une liste de nappes (from, to : trois nombres ; radius en mètres)`);
      }
    } else if (value.pools !== undefined) problems.push(`${where}.pools : seulement pour l’habitacle`);
  }
}
