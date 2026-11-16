/// <reference types="vite/client" />
// Le conducteur à bord (demande du 16 novembre 2026 : « il manque un pilote au volant ») : son
// squelette, ses pièces, ses passes de rendu et ses tenues sont une donnée, public/assets/shared/
// conducteur/catalogue.json (fabriqué par npm run vehicles:build, tools/vehicles/conducteur.mjs) ;
// la façon dont il s'assoit est calculée sur les ancres du véhicule (src/scene/vehicle/
// conducteur-pose.ts) et réglée, pour une moto, par le bloc `driver` du manifeste. Rien ici ne
// connaît un véhicule : la tenue suit le genre (casquette en voiture, casque à moto).

import type { VehicleManifest } from './vehicleTypes.ts';

export type Vec3 = [number, number, number];

export interface DriverBone {
  id: string;
  parent: string | null;
  /** Position au repos, relative au parent (repère du bassin : avant +X, haut +Y, droite +Z). */
  at: Vec3;
}

export interface DriverPass {
  id: string;
  /** Matières du fichier rendues ensemble (leur couleur passe dans les sommets). */
  materials: readonly string[];
  roughness: number;
  metalness: number;
  envMapIntensity?: number;
  clearcoat?: number;
}

export interface DriverOutfit {
  id: string;
  kind: VehicleManifest['kind'];
  label: string;
  head: 'casquette' | 'casque';
  hands: 'nues' | 'gants';
  feet: 'chaussures' | 'bottes';
}

export interface DriverCatalogue {
  bones: readonly DriverBone[];
  /** Pièce du fichier → chaîne d'os qu'elle suit, dans l'ordre de l'axe au repos. */
  nodes: Readonly<Record<string, readonly string[]>>;
  /** Fondu autour d'une articulation, en mètres le long de la chaîne. */
  blend: number;
  passes: readonly DriverPass[];
  colors: Readonly<Record<string, string>>;
  outfits: readonly DriverOutfit[];
  /** Points de contact au repos, dans le repère de leur os : appui des fesses (bassin), œil (tête), prise de la main gauche (main), talon et plante (pied). */
  contacts: { seat: Vec3; eye: Vec3; grip: Vec3; heel: Vec3; ball: Vec3 };
  /** Ancres d'une moto : assise, poignées (gauche, droite), repose-pieds (gauche, droit). */
  anchors: { seat: string; grips: readonly [string, string]; pegs: readonly [string, string] };
  /** Os cachés quand la caméra est à l'œil du conducteur (on voit ses avant-bras et ses mains, pas sa tête). */
  cockpitHidden: readonly string[];
  budget: { triangles: number; drawCalls: number };
}

export const DRIVER_DIR = 'assets/shared/conducteur/';

/** Fichier d'une tenue (même nom que tools/vehicles/conducteur.mjs, driverFile). */
export const driverFile = (id: string): string => `conducteur_${id}.glb`;

type Raw = Record<string, unknown>;
const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
const isVec3 = (value: unknown): value is Vec3 => Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === 'number' && Number.isFinite(v));

/** Valide le catalogue lu (forme et renvois entre os, pièces, passes et couleurs). */
export function validateDriverCatalogue(raw: unknown): DriverCatalogue {
  const where = 'public/assets/shared/conducteur/catalogue.json';
  const problems: string[] = [];
  if (!isObject(raw)) throw new Error(`${where} : objet attendu`);
  const bones = Array.isArray(raw.bones) ? (raw.bones as unknown[]) : [];
  const ids = new Set<string>();
  for (const bone of bones) {
    if (!isObject(bone) || typeof bone.id !== 'string' || !isVec3(bone.at)) {
      problems.push('os mal formé');
      continue;
    }
    if (bone.parent !== null && (typeof bone.parent !== 'string' || !ids.has(bone.parent))) problems.push(`os « ${bone.id} » : parent inconnu ou déclaré après lui`);
    ids.add(bone.id);
  }
  if (!isObject(raw.nodes)) problems.push('nodes manquant');
  else for (const [node, chain] of Object.entries(raw.nodes)) if (!Array.isArray(chain) || chain.length === 0 || !chain.every((id) => ids.has(id as string))) problems.push(`pièce « ${node} » : chaîne d'os inconnue`);
  const passes = Array.isArray(raw.passes) ? (raw.passes as Raw[]) : [];
  if (passes.length === 0) problems.push('passes manquantes');
  if (!isObject(raw.colors)) problems.push('colors manquant');
  if (!Array.isArray(raw.outfits) || !(['car', 'bike'] as const).every((kind) => (raw.outfits as Raw[]).some((o) => o.kind === kind))) problems.push('une tenue par genre de véhicule (car, bike) attendue');
  if (!isObject(raw.contacts) || !['seat', 'eye', 'grip', 'heel', 'ball'].every((key) => isVec3((raw.contacts as Raw)[key]))) problems.push('contacts incomplets');
  if (!isObject(raw.anchors)) problems.push('anchors manquant');
  if (!Array.isArray(raw.cockpitHidden) || !(raw.cockpitHidden as unknown[]).every((id) => ids.has(id as string))) problems.push('cockpitHidden : os inconnu');
  if (problems.length > 0) throw new Error(`${where} : ${problems.join(' ; ')}`);
  return raw as unknown as DriverCatalogue;
}

const FOUND = import.meta.glob<unknown>('../../public/assets/shared/conducteur/catalogue.json', { eager: true, import: 'default' });
export const DRIVER_CATALOGUE: DriverCatalogue = validateDriverCatalogue(Object.values(FOUND)[0]);

/** La tenue du genre de véhicule. */
export function outfitFor(vehicle: Pick<VehicleManifest, 'kind'>, catalogue: DriverCatalogue = DRIVER_CATALOGUE): DriverOutfit {
  return catalogue.outfits.find((outfit) => outfit.kind === vehicle.kind) ?? (catalogue.outfits[0] as DriverOutfit);
}

/**
 * Réglages de pose (en plus des ancres du modèle). Voiture : inclinaison du dossier, mains à dix
 * heures dix, pieds vers le pédalier. Moto : bras plus ou moins tendus (manifeste, driver.reach).
 * Voiture sans ancres (vrai modèle) : sa place « conducteur » et des mesures prises depuis l'œil.
 */
export const DRIVER_POSE = {
  car: {
    /** Inclinaison du buste vers l'arrière, en radians (dossier des sièges du catalogue et un peu d'aisance). */
    recline: 0.24,
    /** Appui des fesses en avant de la face du dossier, en mètres (le bassin peut encore avancer de 12 cm). */
    seatAhead: 0.15,
    /** Bras vers le volant : part de la longueur du bras jusqu'à la prise (coudes un peu pliés). */
    reach: 0.79,
    /** Mains sur la jante, de part et d'autre de midi (dix heures dix), en radians. */
    hands: (60 * Math.PI) / 180,
    /** Pieds : la plante relevée vers les pédales, en radians ; jambe allongée à cette part de sa longueur. */
    footPitch: 0.6,
    legReach: 0.95,
    /** Écart gardé sous le pavillon au-dessus de la tête, en mètres. */
    headroom: 0.015,
  },
  /** Voiture sans ancres : depuis l'œil de sa place « conducteur » (repère du véhicule), en mètres. */
  carWithoutAnchors: {
    recline: 0.5,
    seat: [0.21, -0.79, 0] as Vec3,
    kneeSpread: 0.9,
    wheel: { center: [0.575, -0.27, 0] as Vec3, radius: 0.155, tilt: 0.3 },
    floor: -0.83,
  },
  bike: {
    /** Bras tendus vers les poignées : part de la longueur du bras, par défaut. */
    reach: 0.84,
    /** En courbe, le motard se penche au-delà de la moto de cette part de son inclinaison, et décale le bassin vers l'intérieur. */
    leanExtra: 0.22,
    hangOff: 0.03,
  },
  motion: {
    /** Rotation du volant par mètre⁻¹ de courbure (empattement × démultiplication), bornée. */
    steerPerCurvature: 2.6 * 14,
    steerMax: 0.6,
    /** Lacet de la tête vers l'intérieur du virage, borné. */
    lookPerCurvature: 2.2,
    lookMax: 0.28,
    /** Buste en arrière à l'accélération, en avant au freinage : radians par m/s², bornés. */
    surgePerAccel: 0.012,
    surgeMax: 0.07,
    /** Temps de lissage, en secondes. */
    smoothing: 0.25,
  },
} as const;

/** Bloc `driver` du manifeste, ou ses valeurs par défaut. */
export function driverSpecOf(vehicle: Pick<VehicleManifest, 'driver'>): { reach: number; leanExtra: number; hangOff: number } {
  const spec = vehicle.driver ?? {};
  const within = (value: number | undefined, min: number, max: number, fallback: number) => (typeof value === 'number' && value >= min && value <= max ? value : fallback);
  return {
    reach: within(spec.reach, 0.6, 1, DRIVER_POSE.bike.reach),
    leanExtra: within(spec.leanExtra, 0, 0.6, DRIVER_POSE.bike.leanExtra),
    hangOff: within(spec.hangOff, 0, 0.15, DRIVER_POSE.bike.hangOff),
  };
}
