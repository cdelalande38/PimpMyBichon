// Logique de l'onglet « Peinture », sans React : conversions de couleur du nuancier et lecture des
// zones liées telle que l'interface la montre. Testée dans tests/unit/peinture.test.ts.

import { finish as findFinish, type Finish, type FinishId } from '../../data/finishes.ts';
import type { Build, Hex, Paint, VehicleManifest, Zone } from '../../data/vehicleTypes.ts';
import { flipColor } from '../../render/paint.ts';
import { FLAKE_RANGE, isLinked, masterZone, normalizeHex, resolvePaint } from '../../state/builds.ts';

type Zoned = Pick<VehicleManifest, 'zones'>;

/** Teinte en degrés [0, 360[, saturation et valeur dans [0, 1]. */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

/** Couleur du nuancier vers '#rrggbb' (sRGB, minuscules). */
export function hsvToHex({ h, s, v }: Hsv): Hex {
  const hue = (((Number.isFinite(h) ? h : 0) % 360) + 360) % 360;
  const sat = clamp01(s);
  const val = clamp01(v);
  const channel = (n: number) => {
    const k = (n + hue / 60) % 6;
    const value = val - val * sat * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(5)}${channel(3)}${channel(1)}`;
}

/**
 * '#rrggbb' vers le nuancier ; `null` si le texte n'est pas une couleur. `hue` garde la teinte
 * en cours quand la couleur n'en a pas (gris, noir, blanc) : le curseur de teinte ne saute pas.
 */
export function hexToHsv(value: string, hue = 0): Hsv | null {
  const hex = normalizeHex(value);
  if (!hex) return null;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let h = hue;
  if (delta > 0) {
    if (max === r) h = 60 * (((g - b) / delta + 6) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

/** Zones dans l'ordre des puces : la zone maîtresse d'abord, les autres dans l'ordre du manifeste. */
export function orderedZones(manifest: Zoned): Zone[] {
  const master = masterZone(manifest);
  return master ? [master, ...manifest.zones.filter((zone) => zone !== master)] : [...manifest.zones];
}

/** Vrai si la zone porte un cadenas : zone de carrosserie autre que la maîtresse. */
export function canLink(manifest: Zoned, zoneId: string): boolean {
  const zone = manifest.zones.find((item) => item.id === zoneId);
  const master = masterZone(manifest);
  return Boolean(zone && master && zone.group === 'carrosserie' && zone.id !== master.id);
}

/**
 * Cadenas d'une zone : « aucun » (zone maîtresse, accastillage), « fermé » (la zone suit la
 * carrosserie : ses choix sont verrouillés) ou « ouvert » (elle a sa propre peinture).
 */
export type LockState = 'aucun' | 'ferme' | 'ouvert';

export function lockState(manifest: Zoned, build: Build | undefined, zoneId: string): LockState {
  if (!canLink(manifest, zoneId)) return 'aucun';
  return isLinked(manifest, build, zoneId) ? 'ferme' : 'ouvert';
}

/** Zone maîtresse dans une phrase, article compris : « le réservoir » ; sans précision, « la carrosserie ». */
export function masterPhrase(manifest: Zoned): string {
  const phrase = masterZone(manifest)?.phrase;
  return typeof phrase === 'string' && phrase.trim() !== '' ? phrase.trim() : 'la carrosserie';
}

/** « de » devant la zone maîtresse : « du réservoir », « de la carrosserie », « de l'aile ». */
export function ofPhrase(phrase: string): string {
  if (/^le /i.test(phrase)) return `du ${phrase.slice(3)}`;
  if (/^les /i.test(phrase)) return `des ${phrase.slice(4)}`;
  return `de ${phrase}`;
}

/** Nom accessible du bouton cadenas : l'état, puis le geste (sans accord à faire sur la zone). */
export function lockLabel(zoneLabel: string, state: Exclude<LockState, 'aucun'>, phrase = 'la carrosserie'): string {
  return state === 'ferme'
    ? `${zoneLabel} : suit ${phrase}, ouvrir le cadenas`
    : `${zoneLabel} : peinture à part, refermer le cadenas`;
}

/** Rappel court de l'état du cadenas : « Suit le réservoir », « Peinture à part ». */
export function lockReminder(state: Exclude<LockState, 'aucun'>, phrase = 'la carrosserie'): string {
  return state === 'ferme' ? `Suit ${phrase}` : 'Peinture à part';
}

/** Message d'un appui sur une peinture verrouillée. */
export function lockMessage(phrase = 'la carrosserie'): string {
  return `Cette partie suit ${phrase}. Ouvre son cadenas pour lui donner sa propre peinture.`;
}

/** Message d'un appui sur une peinture verrouillée (voiture), et sa durée à l'écran. */
export const LOCK_MESSAGE = lockMessage();
export const LOCK_MESSAGE_MS = 6000;

/** Deux peintures qui se voient pareil : couleur, finition, paillette et seconde teinte effectives. */
function samePaint(a: Paint, b: Paint): boolean {
  if (a.color !== b.color || a.finish !== b.finish) return false;
  if (flakeValue(a.finish, a.flake) !== flakeValue(b.finish, b.flake)) return false;
  const finish = findFinish(a.finish);
  return !hasColor2(finish) || color2Value(a.color, a.finish, a.color2) === color2Value(b.color, b.finish, b.color2);
}

/**
 * Vrai si refermer le cadenas de la zone ferait perdre quelque chose : la zone a sa propre peinture
 * et elle diffère de celle de la zone maîtresse. Faux pour une zone déjà fermée ou sans cadenas.
 */
export function relockLoses(manifest: Zoned, build: Build | undefined, zoneId: string): boolean {
  if (lockState(manifest, build, zoneId) !== 'ouvert') return false;
  const master = masterZone(manifest);
  const own = resolvePaint(manifest, build, zoneId);
  const reference = master ? resolvePaint(manifest, build, master.id) : undefined;
  return Boolean(own && reference && !samePaint(own, reference));
}

/** Question posée avant de refermer un cadenas qui ferait perdre une peinture à part. */
export function relockQuestion(zoneLabel: string, phrase = 'la carrosserie'): string {
  return `Refermer le cadenas de « ${zoneLabel} » ? Cette partie reprendra la peinture ${ofPhrase(phrase)} et perdra la sienne.`;
}

/**
 * Zone qui reçoit un coup de peinture donné sur `zoneId` : la zone maîtresse si la zone lui est
 * liée (on repeint toute la carrosserie), sinon la zone elle-même.
 */
export function paintTarget(manifest: Zoned, build: Build | undefined, zoneId: string): string {
  const master = masterZone(manifest);
  return master && isLinked(manifest, build, zoneId) ? master.id : zoneId;
}

export interface Pickable {
  zoneId: string;
  label: string;
  color: Hex;
}

/** Pipette : la couleur effective des autres zones, sans doublon ni la couleur déjà posée. */
export function pickableColors(manifest: Zoned, build: Build | undefined, zoneId: string): Pickable[] {
  const own = resolvePaint(manifest, build, zoneId)?.color;
  const seen = new Set<string>(own ? [own] : []);
  const list: Pickable[] = [];
  for (const zone of orderedZones(manifest)) {
    if (zone.id === zoneId) continue;
    const color = resolvePaint(manifest, build, zone.id)?.color;
    if (!color || seen.has(color)) continue;
    seen.add(color);
    list.push({ zoneId: zone.id, label: zone.label, color });
  }
  return list;
}

/** Vrai si la finition a des paillettes : le curseur de taille a un effet. */
export function hasFlake(finish: Pick<Finish, 'flake'>): boolean {
  return finish.flake > 0;
}

/** Vrai si la finition pose une seconde teinte (caméléon). */
export function hasColor2(finish: Pick<Finish, 'flip'>): boolean {
  return finish.flip > 0;
}

/** Taille de paillette affichée, bornée au curseur : celle de la zone, sinon celle de la finition. */
export function flakeValue(finishId: FinishId, flake: number | undefined): number {
  const value = flake ?? findFinish(finishId).flakeSize;
  return Math.min(FLAKE_RANGE.max, Math.max(FLAKE_RANGE.min, value));
}

/** Seconde teinte affichée : celle de la zone, sinon celle que la finition déduit de la couleur. */
export function color2Value(color: Hex, finishId: FinishId, color2: Hex | undefined): Hex {
  return color2 ?? `#${flipColor(color, findFinish(finishId)).getHexString()}`;
}

/** Millimètres en français : « 0,6 mm ». */
export function formatMillimeters(value: number): string {
  return `${value.toFixed(1).replace('.', ',')} mm`;
}
