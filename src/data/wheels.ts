/// <reference types="vite/client" />
// Roues partagées (§ 5.4) : jantes, pneus, cotes et assiette. Le catalogue est une donnée,
// public/assets/shared/wheels/catalogue.json (une jante ou un pneu = une ligne, fabriqués par
// npm run vehicles:build) ; ce qu'un véhicule accepte, ses cotes d'origine et ses limites (passage
// de roue, garde au sol) sont dans son manifeste (section `wheels`). Ce fichier résout, sans rien
// connaître d'aucun véhicule, ce que l'atelier pose : dessin, pneu, cotes par essieu, descente de
// caisse. Une valeur inconnue ou hors limites retombe sur l'origine ou sur la borne.

import type { Build, Hex, VehicleManifest, VehicleWheels, WheelSize } from './vehicleTypes.ts';

export type WheelKind = 'car' | 'bike';

export interface RimDesign {
  id: string;
  kind: WheelKind;
  /** Famille de modelage (tools/vehicles/roues.mjs). */
  style: string;
  label: string;
  hint?: string;
}

export interface TireType {
  id: string;
  label: string;
  hint?: string;
  /** Ce que la couleur libre du pneu colore : un liseré, le flanc blanc, ou les lettres. */
  mark: 'lisere' | 'flanc' | 'lettres';
  /** Pavés tout-terrain. */
  tread?: string;
  /** Couleur d'origine de la marque. */
  color: Hex;
  /** « Couleur du liseré », « Couleur du flanc »… */
  colorLabel: string;
}

/** Cote de référence d'un genre : la jante et le pneu y sont modelés, l'app les recale. */
export interface WheelReference {
  rim: number;
  outer: number;
  width: number;
}

export interface WheelCatalogue {
  reference: Record<WheelKind, WheelReference>;
  rims: readonly RimDesign[];
  tires: readonly TireType[];
}

/** Dossier des roues partagées, sous le socle de l'app. */
export const WHEELS_DIR = 'assets/shared/wheels/';

/** Postes du build (parts) et curseurs (tune) des roues et de l'assiette. */
export const WHEEL_SLOTS = Object.freeze({ rim: 'jantes', tire: 'pneus' });
export const WHEEL_TUNE = Object.freeze({
  diameter: 'jante',
  width: 'pneu_largeur',
  rearWidth: 'pneu_arriere',
  aspect: 'pneu_hauteur',
  ride: 'assiette',
});
/** Pièce peinte du pneu (partPaints) : la couleur du liseré, du flanc ou des lettres. */
export const TIRE_PAINT = 'pneus';

/** Préréglages d'assiette : part de la descente possible. */
export const RIDE_PRESETS: ReadonlyArray<{ id: string; label: string; hint: string; value: number }> = [
  { id: 'origine', label: 'Origine', hint: 'Comme sortie d’usine', value: 0 },
  { id: 'rabaissee', label: 'Rabaissée', hint: 'La moitié de la place', value: 0.5 },
  { id: 'au_sol', label: 'Posée au sol', hint: 'Le plus bas possible', value: 1 },
];

/** Marge gardée entre le pneu et la voûte du passage de roue, et sous la caisse, en mètres. */
const ARCH_MARGIN = 0.004;
const FLOOR_MARGIN = 0.012;

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const HEX = /^#[0-9a-f]{6}$/;

type Raw = Record<string, unknown>;
const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Valide le catalogue (erreur claire) et le rend typé. */
export function validateCatalogue(raw: unknown): WheelCatalogue {
  const problems: string[] = [];
  const where = 'public/assets/shared/wheels/catalogue.json';
  if (!isObject(raw)) throw new Error(`Catalogue des roues invalide, ${where} : ce n'est pas un objet JSON.`);
  const ref = raw.reference;
  for (const kind of ['car', 'bike'] as const) {
    const r = isObject(ref) ? ref[kind] : undefined;
    if (!isObject(r) || ![r.rim, r.outer, r.width].every((n) => typeof n === 'number' && n > 0) || (r.outer as number) <= (r.rim as number)) {
      problems.push(`reference.${kind} doit porter rim < outer et width, en mètres`);
    }
  }
  const seen = new Set<string>();
  const rims = Array.isArray(raw.rims) ? raw.rims : [];
  if (rims.length === 0) problems.push('rims : au moins une jante');
  rims.forEach((rim: unknown, i) => {
    if (!isObject(rim) || typeof rim.id !== 'string' || !ID.test(rim.id) || (rim.kind !== 'car' && rim.kind !== 'bike') || typeof rim.style !== 'string' || typeof rim.label !== 'string') {
      problems.push(`rims[${i}] doit porter id, kind (car ou bike), style et label`);
    } else if (seen.has(rim.id)) problems.push(`rims[${i}].id « ${rim.id} » en double`);
    else seen.add(rim.id);
  });
  const tires = Array.isArray(raw.tires) ? raw.tires : [];
  if (tires.length === 0) problems.push('tires : au moins un pneu');
  tires.forEach((tire: unknown, i) => {
    if (
      !isObject(tire) ||
      typeof tire.id !== 'string' ||
      !ID.test(tire.id) ||
      typeof tire.label !== 'string' ||
      !['lisere', 'flanc', 'lettres'].includes(tire.mark as string) ||
      typeof tire.color !== 'string' ||
      !HEX.test(tire.color) ||
      typeof tire.colorLabel !== 'string'
    ) {
      problems.push(`tires[${i}] doit porter id, label, mark (lisere, flanc ou lettres), color (#rrggbb) et colorLabel`);
    }
  });
  if (problems.length > 0) throw new Error(`Catalogue des roues invalide, ${where} : ${problems.join(' ; ')}.`);
  return raw as unknown as WheelCatalogue;
}

const FOUND = import.meta.glob<unknown>('../../public/assets/shared/wheels/catalogue.json', { eager: true, import: 'default' });

/** Le catalogue des roues partagées. */
export const WHEEL_CATALOGUE: WheelCatalogue = validateCatalogue(Object.values(FOUND)[0]);

/** Fichier d'une jante (même nom que tools/vehicles/roues.mjs, rimFile). */
export const rimFile = (id: string): string => `jante_${id}.glb`;
/** Fichier d'un pneu pour un genre (même nom que tools/vehicles/roues.mjs, tireFile). */
export const tireFile = (id: string, kind: WheelKind): string => `pneu_${id}_${kind === 'bike' ? 'moto' : 'auto'}.glb`;

export function wheelKind(vehicle: Pick<VehicleManifest, 'kind'>): WheelKind {
  return vehicle.kind === 'bike' ? 'bike' : 'car';
}

/** Jantes qu'un véhicule accepte : celles de son genre, ou la liste de son manifeste. */
export function rimsFor(vehicle: Pick<VehicleManifest, 'kind' | 'wheels'>, catalogue: WheelCatalogue = WHEEL_CATALOGUE): RimDesign[] {
  const fit = vehicle.wheels?.fit;
  if (!fit) return [];
  const kind = wheelKind(vehicle);
  return catalogue.rims.filter((rim) => rim.kind === kind && (!fit.rims || fit.rims.includes(rim.id)));
}

/** Pneus qu'un véhicule accepte (tous ont une version auto et une version moto). */
export function tiresFor(vehicle: Pick<VehicleManifest, 'wheels'>, catalogue: WheelCatalogue = WHEEL_CATALOGUE): TireType[] {
  return vehicle.wheels?.fit ? [...catalogue.tires] : [];
}

/** Rayon de jante, en mètres, d'un diamètre en pouces. */
export const rimRadius = (inches: number): number => (inches * 0.0254) / 2;

/** Rayon extérieur d'une roue : jante et hauteur de flanc (largeur × série). */
export function outerRadius(size: WheelSize): number {
  return rimRadius(size.diameter) + (size.width / 1000) * (size.aspect / 100);
}

/** « 195/50 R17 » (auto) ou « 180/55-17 » (moto). */
export function sizeLabel(size: WheelSize, kind: WheelKind): string {
  const d = Number.isInteger(size.diameter) ? size.diameter : size.diameter.toFixed(1);
  return kind === 'bike' ? `${size.width}/${size.aspect}-${d}` : `${size.width}/${size.aspect} R${d}`;
}

export interface AxleWheel extends WheelSize {
  /** Rayon de la jante et rayon extérieur, en mètres. */
  rim: number;
  outer: number;
  /** Rayon extérieur d'origine de l'essieu. */
  origin: number;
}

export interface ResolvedWheels {
  /** Vrai : l'atelier pose ses jantes et ses pneus ; faux : le modèle garde les siens (assiette seule). */
  swap: boolean;
  rim: RimDesign | null;
  tire: TireType | null;
  /** Couleur de la marque du pneu (liseré, flanc ou lettres). */
  tireColor: Hex;
  front: AxleWheel | null;
  rear: AxleWheel | null;
  /** Curseurs effectifs (après les limites). */
  diameter: number;
  width: number;
  rearWidth: number;
  aspect: number;
  /** Part de la descente demandée (0 à 1), descente possible et descente posée, en mètres. */
  ride: number;
  maxDrop: number;
  drop: number;
  /** Montée de la caisse à l'avant et à l'arrière, en mètres (rayon gagné moins la descente). */
  lift: { front: number; rear: number };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function tuned(build: Build | undefined, id: string): number | undefined {
  const value = build?.tune?.[id];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Descente de caisse possible : la voûte des passages de roue, puis le sol sous la caisse. */
export function maxDropFor(wheels: Pick<VehicleWheels, 'gap' | 'floor'>, grow: { front: number; rear: number }): number {
  const [gapFront, gapRear] = wheels.gap;
  const byArch = Math.min(gapFront - grow.front, gapRear - grow.rear) - ARCH_MARGIN;
  const byFloor = wheels.floor + Math.min(grow.front, grow.rear) - FLOOR_MARGIN;
  return Math.max(0, Math.min(byArch, byFloor));
}

/**
 * Ce que l'atelier pose pour ce véhicule et ce build : dessin, pneu, cotes par essieu (bornées par
 * le manifeste et par le passage de roue), descente de caisse. `null` : le véhicule ne déclare pas
 * de roues.
 */
export function resolveWheels(vehicle: Pick<VehicleManifest, 'kind' | 'wheels'>, build: Build | undefined, catalogue: WheelCatalogue = WHEEL_CATALOGUE): ResolvedWheels | null {
  const wheels = vehicle.wheels;
  if (!wheels) return null;
  const ride = clamp(tuned(build, WHEEL_TUNE.ride) ?? 0, 0, 1);
  const fit = wheels.fit;
  if (!fit) {
    const maxDrop = maxDropFor(wheels, { front: 0, rear: 0 });
    const drop = ride * maxDrop;
    return {
      swap: false,
      rim: null,
      tire: null,
      tireColor: '#000000',
      front: null,
      rear: null,
      diameter: 0,
      width: 0,
      rearWidth: 0,
      aspect: 0,
      ride,
      maxDrop,
      drop,
      lift: { front: -drop, rear: -drop },
    };
  }
  const rims = rimsFor(vehicle, catalogue);
  const rimId = build?.parts?.[WHEEL_SLOTS.rim];
  const rim = rims.find((item) => item.id === rimId) ?? rims.find((item) => item.id === fit.rim) ?? rims[0] ?? null;
  const tireId = build?.parts?.[WHEEL_SLOTS.tire];
  const tire = catalogue.tires.find((item) => item.id === tireId) ?? catalogue.tires.find((item) => item.id === fit.tire) ?? catalogue.tires[0] ?? null;
  const color = build?.partPaints?.[TIRE_PAINT]?.color;
  const tireColor = typeof color === 'string' && HEX.test(color) ? color : (tire?.color ?? '#efece2');

  const front0 = fit.front;
  const rear0 = fit.rear ?? fit.front;
  // Décalages d'origine entre l'arrière et l'avant (pneus plus larges derrière), gardés.
  const stagger = { width: rear0.width - front0.width, aspect: rear0.aspect - front0.aspect, diameter: rear0.diameter - front0.diameter };
  let diameter = clamp(Math.round(tuned(build, WHEEL_TUNE.diameter) ?? front0.diameter), fit.diameter[0], fit.diameter[1]);
  const width = fit.width ? clamp(Math.round(tuned(build, WHEEL_TUNE.width) ?? front0.width), fit.width[0], fit.width[1]) : front0.width;
  const rearWidth = fit.rearWidth ? clamp(Math.round(tuned(build, WHEEL_TUNE.rearWidth) ?? rear0.width), fit.rearWidth[0], fit.rearWidth[1]) : width + stagger.width;
  const wanted = clamp(Math.round(tuned(build, WHEEL_TUNE.aspect) ?? front0.aspect), fit.aspect[0], fit.aspect[1]);
  const originFront = outerRadius(front0);
  const originRear = outerRadius(rear0);
  const [gapFront, gapRear] = wheels.gap;
  // Le pneu ne doit pas dépasser la voûte, caisse à l'origine : la série baisse d'abord, puis le diamètre.
  const fits = (d: number) => {
    const roomFront = originFront + gapFront - ARCH_MARGIN - rimRadius(d);
    const roomRear = originRear + gapRear - ARCH_MARGIN - rimRadius(d + stagger.diameter);
    return Math.floor(Math.min((roomFront / (width / 1000)) * 100, (roomRear / (rearWidth / 1000)) * 100 - stagger.aspect));
  };
  while (diameter > fit.diameter[0] && fits(diameter) < fit.aspect[0]) diameter -= 1;
  const aspect = clamp(Math.min(wanted, fits(diameter)), fit.aspect[0], fit.aspect[1]);
  const frontSize: WheelSize = { diameter, width, aspect };
  const rearSize: WheelSize = { diameter: diameter + stagger.diameter, width: rearWidth, aspect: aspect + stagger.aspect };
  const front: AxleWheel = { ...frontSize, rim: rimRadius(frontSize.diameter), outer: outerRadius(frontSize), origin: originFront };
  const rear: AxleWheel = { ...rearSize, rim: rimRadius(rearSize.diameter), outer: outerRadius(rearSize), origin: originRear };
  const grow = { front: front.outer - originFront, rear: rear.outer - originRear };
  const maxDrop = maxDropFor(wheels, grow);
  const drop = ride * maxDrop;
  return {
    swap: true,
    rim,
    tire,
    tireColor,
    front,
    rear,
    diameter,
    width,
    rearWidth,
    aspect,
    ride,
    maxDrop,
    drop,
    lift: { front: grow.front - drop, rear: grow.rear - drop },
  };
}

/** Fichiers à charger pour poser ces roues (jante, pneu), sous le dossier des roues. */
export function wheelFiles(vehicle: Pick<VehicleManifest, 'kind'>, resolved: ResolvedWheels | null): { rim: string; tire: string } | null {
  if (!resolved?.swap || !resolved.rim || !resolved.tire) return null;
  return { rim: rimFile(resolved.rim.id), tire: tireFile(resolved.tire.id, wheelKind(vehicle)) };
}

/** Vrai si le build a touché aux roues ou à l'assiette (bouton « D'origine »). */
export function wheelsTouched(build: Build | undefined, scope: 'roues' | 'assiette'): boolean {
  if (scope === 'assiette') return tuned(build, WHEEL_TUNE.ride) !== undefined;
  return (
    build?.parts?.[WHEEL_SLOTS.rim] !== undefined ||
    build?.parts?.[WHEEL_SLOTS.tire] !== undefined ||
    build?.partPaints?.[TIRE_PAINT] !== undefined ||
    [WHEEL_TUNE.diameter, WHEEL_TUNE.width, WHEEL_TUNE.rearWidth, WHEEL_TUNE.aspect].some((id) => tuned(build, id) !== undefined)
  );
}
