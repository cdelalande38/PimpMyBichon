// Rôles des matériaux d'un modèle aux conventions du § 8 : le nom du matériau dans le GLB dit ce
// qu'il est, l'app décide de son rendu. `paint_<zone>` reçoit la peinture multicouche de la zone
// (src/render/paint.ts) ; les autres rôles reçoivent les réglages ci-dessous. Un matériau au nom
// inconnu garde ce que le modèle lui donne.

import type { Hex } from './vehicleTypes.ts';

export type MaterialRoleId = 'chrome' | 'alu' | 'black' | 'rubber' | 'leather' | 'glass' | 'lamp' | 'tail' | 'signal';

export interface MaterialRole {
  id: MaterialRoleId;
  color: Hex;
  metalness: number;
  roughness: number;
  /** Part du reflet de l'environnement (multipliée par celle de l'ambiance pour les métaux). */
  envMapIntensity: number;
  /** Vitrage : transparent et teinté, jamais réfractant (une passe de rendu de moins, § 8). */
  opacity?: number;
  /**
   * Vitrage vu de l'intérieur (vue intérieure) : opacité et part du reflet bien plus faibles, pour
   * voir le garage ou la route par toutes les vitres. Dehors, `opacity` et `envMapIntensity`.
   */
  inside?: { opacity: number; envMapIntensity: number };
  /** Optique allumée : couleur et force de l'émission (au-delà de 1 : halo du bloom). */
  emissive?: { color: Hex; intensity: number };
}

export const MATERIAL_ROLES: readonly MaterialRole[] = [
  { id: 'chrome', color: '#f2f3f5', metalness: 1, roughness: 0.06, envMapIntensity: 1.2 },
  { id: 'alu', color: '#c9ccd2', metalness: 1, roughness: 0.32, envMapIntensity: 1 },
  { id: 'black', color: '#121214', metalness: 0, roughness: 0.55, envMapIntensity: 0.6 },
  { id: 'rubber', color: '#141416', metalness: 0, roughness: 0.9, envMapIntensity: 0.3 },
  { id: 'leather', color: '#2a1e18', metalness: 0, roughness: 0.6, envMapIntensity: 0.5 },
  // Vitrage : dehors, teinté et réfléchissant (les néons s'y lisent : opacité × reflet = 0,54, comme
  // l'ancien réglage 0,55 × 1), mais assez clair pour deviner l'habitacle (64 % de lumière passent) ;
  // dedans, presque incolore (90 % passent).
  { id: 'glass', color: '#0c0e14', metalness: 0, roughness: 0.04, envMapIntensity: 1.5, opacity: 0.36, inside: { opacity: 0.1, envMapIntensity: 0.3 } },
  { id: 'lamp', color: '#ffffff', metalness: 0, roughness: 0.2, envMapIntensity: 1, emissive: { color: '#fff3e0', intensity: 12 } },
  { id: 'tail', color: '#3a0402', metalness: 0, roughness: 0.2, envMapIntensity: 1, emissive: { color: '#ff1206', intensity: 10 } },
  { id: 'signal', color: '#3a1a02', metalness: 0, roughness: 0.2, envMapIntensity: 1, emissive: { color: '#ff8a10', intensity: 4 } },
];

/** Réglage d'un vitrage à l'image : opacité (mélange normal) et part du reflet de l'environnement. */
export interface GlassLook {
  opacity: number;
  envMapIntensity: number;
}

/** Rôle du vitrage (toujours présent). */
export const GLASS_ROLE = MATERIAL_ROLES.find((role) => role.id === 'glass') as MaterialRole & { opacity: number; inside: GlassLook };

/**
 * Vitrage vu de dehors ou de dedans. Dehors : le réglage du rôle (ou celui d'un modèle adapté) ;
 * dedans : celui du rôle, jamais plus opaque que dehors.
 */
export function glassLook(outside: GlassLook, inside: boolean): GlassLook {
  if (!inside) return outside;
  return {
    opacity: Math.min(outside.opacity, GLASS_ROLE.inside.opacity),
    envMapIntensity: Math.min(outside.envMapIntensity, GLASS_ROLE.inside.envMapIntensity),
  };
}

/** Part de la lumière du dehors qui traverse les couches de vitrage dessinées (mélange normal). */
export function transmittance(opacities: readonly number[]): number {
  return opacities.reduce((left, opacity) => left * (1 - opacity), 1);
}

/** Force apparente du reflet de l'environnement (néons) sur un vitrage : opacité × part du reflet. */
export function glassReflection(look: GlassLook): number {
  return look.opacity * look.envMapIntensity;
}

/** Préfixe des matériaux peints : `paint_<id de zone>`. */
export const PAINT_PREFIX = 'paint_';

/**
 * Rôle d'un matériau d'après son nom. Les exporteurs ajoutent souvent un suffixe (« chrome.001 »,
 * « chrome_2 ») : seul le nom avant le premier point ou le dernier « _<chiffres> » compte.
 */
export function materialRole(name: string): MaterialRole | undefined {
  const base = name.toLowerCase().split('.')[0]?.replace(/_\d+$/, '') ?? '';
  return MATERIAL_ROLES.find((role) => role.id === base);
}

/** Zone peinte d'un matériau `paint_<zone>`, ou `null`. */
export function paintZoneOf(name: string): string | null {
  if (!name.startsWith(PAINT_PREFIX)) return null;
  const zone = name.slice(PAINT_PREFIX.length).split('.')[0] ?? '';
  return zone === '' ? null : zone;
}
