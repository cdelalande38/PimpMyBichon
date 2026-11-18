// Phares (Custom › Phares, § 5.4 « Phares et feux ») : couleur de l'éclairage avant, teinte des
// optiques, feux arrière. Données pures : l'interface (src/ui/phares/), le garage et la sortie
// (src/scene/vehicle/phares.ts) les lisent ; les prix sont dans src/data/articles/phares.ts.
//
// Sauvegarde (Build, src/data/vehicleTypes.ts) : `parts.phares` (couleur de l'éclairage),
// `parts.feux` (feux arrière), `tune.phares_teinte` (teinte des optiques, de 0, clair, à 1, fumé).
// L'origine n'est jamais écrite ; une valeur inconnue retombe sur l'origine.
//
// Les optiques d'un véhicule sont reconnues par le nom de leurs matériaux : section `lights` du
// manifeste, sinon les rôles des conventions (`lamp` devant, `tail` derrière, src/data/materialRoles.ts).

import type { Build, Hex, VehicleLights, VehicleManifest } from './vehicleTypes.ts';

/** Postes (`Build.parts`) et curseur (`Build.tune`) des phares. */
export const PHARES_SLOTS = { couleur: 'phares', feux: 'feux' } as const;
export const PHARES_TUNE = { teinte: 'phares_teinte' } as const;

export interface CouleurPhares {
  id: string;
  label: string;
  /** Ligne d'atelier, sous le nom. */
  hint: string;
  /** Couleur de la lumière (sRGB) : pastille, optiques allumées, faisceau, route éclairée. */
  color: Hex;
  /**
   * Part de la lueur d'origine gardée dans l'optique allumée : une teinte franche aussi forte que le
   * blanc d'origine sature en blanc à l'image (ACES) ; plus douce, sa couleur se lit dans l'optique.
   */
  lueur: number;
  /** L'origine : rien n'est repeint, chaque modèle garde la lueur de ses optiques. */
  origine?: true;
}

/**
 * Couleurs de l'éclairage avant. L'origine, blanc chaud, est la teinte halogène de la route éclairée
 * (HEADLIGHT, src/drive/scene/materiaux.ts : un test vérifie qu'elles restent égales).
 */
export const COULEURS_PHARES: readonly CouleurPhares[] = [
  { id: 'chaud', label: 'Blanc chaud', hint: 'D’origine', color: '#ffe9cc', lueur: 1, origine: true },
  { id: 'froid', label: 'Blanc froid', hint: 'Façon xénon', color: '#e2edff', lueur: 1 },
  { id: 'jaune', label: 'Jaune', hint: 'Rétro, perce la pluie', color: '#ffc43a', lueur: 0.3 },
  { id: 'glacier', label: 'Bleu glacier', hint: 'Bleuté, très net', color: '#8ccbff', lueur: 0.3 },
  { id: 'violet', label: 'Violet', hint: 'Teinte franche', color: '#a35cff', lueur: 0.22 },
  { id: 'vert', label: 'Vert néon', hint: 'Teinte franche', color: '#3dff86', lueur: 0.2 },
  { id: 'rose', label: 'Rose', hint: 'Teinte franche', color: '#ff4fc3', lueur: 0.22 },
];

/**
 * Teinte des optiques (glace de clair à fumé) : un curseur de `min` à `max`, le préréglage « Fumé »
 * à `fume`. À 1, la glace prend `mix` de la couleur `color` et l'optique allumée ne garde que
 * `emission` de sa lueur (la glace avant est le matériau de l'optique : le verre bombé posé dessus
 * est celui des vitres, partagé, qu'on ne fume pas).
 */
export const TEINTE_OPTIQUES = { min: 0, max: 1, step: 0.05, fume: 0.7, color: '#141519' as Hex, mix: 0.85, emission: 0.3 } as const;

export interface OptionFeux {
  id: string;
  label: string;
  hint: string;
  /** Glace éteinte (sRGB) ; absente : celle du modèle. */
  glace?: Hex;
  /** Part de la lueur gardée, allumés (freinage compris). */
  lueur: number;
  origine?: true;
}

/** Feux arrière : rouges d'origine, ou fumés (glace sombre, ils restent rouges une fois allumés). */
export const OPTIONS_FEUX: readonly OptionFeux[] = [
  { id: 'rouges', label: 'Rouges', hint: 'D’origine', lueur: 1, origine: true },
  { id: 'fumes', label: 'Fumés', hint: 'Glace sombre', glace: '#120304', lueur: 0.45 },
];

const ORIGINE_COULEUR = COULEURS_PHARES[0] as CouleurPhares;
const ORIGINE_FEUX = OPTIONS_FEUX[0] as OptionFeux;

/** Ce que le build monte, l'origine pour ce qui n'est pas écrit ou pas connu. */
export interface PharesChoisis {
  couleur: CouleurPhares;
  /** Teinte des optiques, de 0 (clair) à 1 (fumé). */
  teinte: number;
  feux: OptionFeux;
}

export function couleurPhares(id: string | undefined): CouleurPhares {
  return COULEURS_PHARES.find((item) => item.id === id) ?? ORIGINE_COULEUR;
}

export function optionFeux(id: string | undefined): OptionFeux {
  return OPTIONS_FEUX.find((item) => item.id === id) ?? ORIGINE_FEUX;
}

/** Teinte lue dans le build : bornée à [0, 1], 0 si elle n'est pas un nombre. */
export function teinteOptiques(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return TEINTE_OPTIQUES.min;
  return Math.min(TEINTE_OPTIQUES.max, Math.max(TEINTE_OPTIQUES.min, value));
}

export function resolvePhares(build: Pick<Build, 'parts' | 'tune'> | undefined): PharesChoisis {
  return {
    couleur: couleurPhares(build?.parts?.[PHARES_SLOTS.couleur]),
    teinte: teinteOptiques(build?.tune?.[PHARES_TUNE.teinte]),
    feux: optionFeux(build?.parts?.[PHARES_SLOTS.feux]),
  };
}

/** Vrai si le build s'écarte de l'origine des phares (bouton « D'origine »). */
export function pharesTouches(build: Pick<Build, 'parts' | 'tune'> | undefined): boolean {
  const choisis = resolvePhares(build);
  return choisis.couleur.origine !== true || choisis.teinte > 0 || choisis.feux.origine !== true;
}

// ---------------------------------------------------------------------------------------------
// Boutique : identifiants des articles (convention `piece-<poste>-<option>`, src/data/boutique.ts).

export function articleCouleur(id: string): string {
  return `piece-${PHARES_SLOTS.couleur}-${id}`;
}

/** La teinte fumée des optiques : un seul article débloque tout le curseur. */
export const ARTICLE_TEINTE = `piece-${PHARES_SLOTS.couleur}-fume`;

export function articleFeux(id: string): string {
  return `piece-${PHARES_SLOTS.feux}-${id}`;
}

// ---------------------------------------------------------------------------------------------
// Optiques d'un modèle (manifeste, section `lights`).

/** Modèle aux conventions du § 8 : les rôles `lamp` (devant) et `tail` (derrière). */
export const DEFAULT_LIGHTS: VehicleLights = Object.freeze({ front: Object.freeze(['lamp']), rear: Object.freeze(['tail']) });

export function lightsOf(vehicle: Pick<VehicleManifest, 'lights'>): VehicleLights {
  return vehicle.lights ?? DEFAULT_LIGHTS;
}

/**
 * Un matériau est-il l'un de ceux nommés ? Les exporteurs ajoutent souvent un suffixe (« lamp.001 »,
 * « lamp_2 ») : le nom entier, ou le nom avant le premier point ou le dernier « _<chiffres> », sans
 * tenir compte de la casse.
 */
export function lightNamed(name: string, names: readonly string[]): boolean {
  const lower = name.toLowerCase();
  const base = lower.split('.')[0]?.replace(/_\d+$/, '') ?? '';
  return names.some((item) => {
    const wanted = item.toLowerCase();
    return wanted === lower || wanted === base;
  });
}

/** Validation de la section `lights` d'un manifeste (src/data/vehicles.ts, validateManifest). */
export function checkLights(raw: unknown, problems: string[]): void {
  if (raw === undefined) return;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    problems.push('lights doit être un objet (front, rear)');
    return;
  }
  const lights = raw as Record<string, unknown>;
  const names = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim() !== '');
  if (!names(lights.front) || (lights.front as unknown[]).length === 0) problems.push('lights.front doit nommer au moins un matériau d’optique avant');
  if (!names(lights.rear)) problems.push('lights.rear doit être une liste de noms de matériaux de feux arrière');
  for (const key of Object.keys(lights)) if (key !== 'front' && key !== 'rear') problems.push(`lights.${key} : clé inconnue (front, rear)`);
}

// ---------------------------------------------------------------------------------------------
// Couleur de la lumière, en valeurs linéaires (celles des nuanceurs).

type Rgb = [number, number, number];

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Couleur sRGB « #rrggbb » en valeurs linéaires. */
export function linearOf(hex: Hex): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [channel((n >> 16) & 255), channel((n >> 8) & 255), channel(n & 255)];
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Lumière des phares sur la route : la couleur choisie, relevée pour garder au moins `share` de la
 * luminance de l'origine (une teinte franche ne doit pas éteindre la route), sans dépasser `gain`.
 */
export const ROUTE_LIGHT = { share: 0.55, gain: 3 } as const;

export function routeLight(color: Hex, origin: Hex = ORIGINE_COULEUR.color): Rgb {
  const rgb = linearOf(color);
  const wanted = ROUTE_LIGHT.share * luminance(linearOf(origin));
  const has = luminance(rgb);
  const k = has >= wanted || has <= 0 ? 1 : Math.min(ROUTE_LIGHT.gain, wanted / has);
  return [rgb[0] * k, rgb[1] * k, rgb[2] * k];
}

/**
 * Teinte du faisceau dans l'air et de l'éblouissement (src/drive/scene/ciel.ts) : leurs nuanceurs
 * dessinent un blanc chaud `base` (linéaire) ; la couleur choisie s'y applique en facteur de mélange,
 * de 0 à 1 par composante (le plus fort à 1).
 */
export const BEAM_BASE: Rgb = [1, 0.94, 0.82];

export function beamTint(color: Hex, base: Rgb = BEAM_BASE): Rgb {
  const rgb = linearOf(color);
  const k: Rgb = [rgb[0] / base[0], rgb[1] / base[1], rgb[2] / base[2]];
  const top = Math.max(k[0], k[1], k[2]);
  return top > 0 ? [k[0] / top, k[1] / top, k[2] / top] : [1, 1, 1];
}
