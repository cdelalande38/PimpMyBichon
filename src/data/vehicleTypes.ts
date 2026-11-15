// Contrat des véhicules (§ 6 et § 8 du cahier des charges) : ce que décrit le manifeste
// `public/assets/vehicles/<id>/vehicle.json` d'un véhicule, et ce qu'un build retient de lui.
// Types seuls, aucune donnée : le catalogue est découvert au build, rien n'est codé en dur par
// véhicule. Les champs du § 6 qui manquent ici (pièces, curseurs, livrée, néons, intérieur,
// moteur) arriveront avec leur jalon ; un manifeste ou un build qui les porte déjà reste lisible.

import type { FinishId } from './finishes.ts';

/** Nom du dossier du véhicule dans public/assets/vehicles/. */
export type VehicleId = string;

/** Couleur libre, '#rrggbb' en minuscules. */
export type Hex = string;

/** Peinture effective d'une zone : ce que le rendu applique. */
export interface Paint {
  color: Hex;
  finish: FinishId;
  /** Taille de paillette, en millimètres (finitions à paillettes) ; absente : celle de la finition. */
  flake?: number;
  /** Seconde teinte du caméléon ; absente : celle que la finition déduit de la couleur. */
  color2?: Hex;
}

/**
 * Ce que l'utilisateur a changé sur une zone : les champs absents gardent la peinture d'origine
 * du manifeste. `linked` : faux pour une zone détachée de la zone maîtresse (bi-ton), vrai pour
 * une zone rattachée ; absent : la liaison d'origine du manifeste.
 */
export type PaintChoice = Partial<Paint> & { linked?: boolean };

/**
 * 'carrosserie' : zone peinte, qui peut suivre la zone maîtresse (la première zone 'carrosserie'
 * du manifeste). 'accastillage' : jantes, étriers, sellerie, cadre… toujours indépendante.
 */
export type ZoneGroup = 'carrosserie' | 'accastillage';

export interface Zone {
  id: string;
  /** Nom affiché, en français. */
  label: string;
  /** Noms exacts des matériaux du GLB que la zone colore. */
  materials: readonly string[];
  group: ZoneGroup;
  /** Peinture d'origine. */
  paint: Paint;
  /** Zone 'carrosserie' détachée à l'origine (bi-ton d'usine) : `false`. Absent : liée. */
  linked?: boolean;
}

/**
 * Adaptation d'un modèle qui ne suit pas les conventions de modélisation du § 8 (le modèle de
 * banc d'essai). Un modèle aux conventions n'en a pas besoin : ses matériaux sont nommés par
 * rôle (`paint_<zone>`, `chrome`, `alu`, `black`, `rubber`, `glass`, `leather`, `lamp`, `tail`,
 * `signal`), avant vers +X, +Y vers le haut, origine au sol au centre de l'empattement, mètres.
 */
export interface VehicleAdapt {
  /** Quarts de tour à ajouter autour de la verticale pour amener l'avant vers +X. */
  yawQuarterTurns?: number;
  /** Vitrages : matériaux rendus transparents et teintés. */
  glass?: { materials: readonly string[]; color: Hex; opacity: number };
  /** Optiques allumées : matériaux, couleur et force de l'émission. */
  lamps?: ReadonlyArray<{ materials: readonly string[]; color: Hex; intensity: number }>;
  /** Matériaux qui portent des logos : remplacés par une plaque unie de la teinte `plainColor`. */
  plainMaterials?: readonly string[];
  plainColor?: Hex;
  /** Textures qui portent des logos : retirées de tout le modèle. */
  logoTextures?: ReadonlyArray<{ material: string; maps: readonly string[]; color?: Hex }>;
}

/**
 * Moteur d'origine : le point de départ de la fiche de préparation (reprogrammation, carburation,
 * nitro). Des chiffres d'atelier pour le plaisir, pas une simulation mécanique.
 */
export interface EngineSpec {
  /** En clair, sans nom de constructeur : « 4 cylindres à plat refroidi par air ». */
  label: string;
  fuel: 'essence' | 'diesel';
  /** Alimentation d'origine : décide entre carburation et reprogrammation. */
  feed: 'carburateur' | 'injection';
  /** Suralimentation d'origine. */
  boost: 'atmo' | 'turbo' | 'compresseur';
  /** Puissance d'origine, en chevaux. */
  power: number;
}

export interface VehicleManifest {
  /** Égal au nom du dossier. */
  id: VehicleId;
  /** Nom de travail générique, affiché : « La Cox ». Jamais un nom de constructeur ou de modèle. */
  name: string;
  kind: 'car' | 'bike';
  /** Vague du catalogue (§ 3) ; 0 : le modèle de banc d'essai. */
  wave: 0 | 1 | 2 | 3;
  /** Rang dans le catalogue ; le plus petit est le véhicule de départ. */
  order: number;
  /** Fichier du modèle, relatif au dossier du véhicule. */
  glb: string;
  /** Une ligne d'atelier sous le nom, dans le catalogue. */
  hint?: string;
  /** Substitut déclaré dans TODO_ASSETS.md (`placeholder_*`) ; absent pour un modèle définitif. */
  placeholder?: string;
  /** Demi-longueur attendue avant chargement, en mètres (cadrage d'attente). */
  halfLengthHint: number;
  /** Zones à colorer, dans l'ordre d'affichage ; la première 'carrosserie' est la zone maîtresse. */
  zones: readonly Zone[];
  /** Moteur d'origine ; absent : pas de fiche de préparation pour ce véhicule. */
  engine?: EngineSpec;
  /**
   * Point de vue intérieur (§ 5.1) : position de l'œil et point regardé, en mètres, dans le repère
   * du véhicule (avant vers +X, haut vers +Y, droite vers +Z). Absent : pas de vue intérieure.
   */
  interiorView?: { eye: readonly [number, number, number]; target: readonly [number, number, number] };
  adapt?: VehicleAdapt;
}

/**
 * Ce que l'utilisateur a fait d'un véhicule. Aujourd'hui : ses peintures, zone par zone, et ses
 * pièces et préparations, poste par poste (§ 5.4 ; pour l'instant la préparation du moteur).
 */
export interface Build {
  paints: Record<string /* id de zone */, PaintChoice>;
  parts?: Record<string /* id de poste */, string /* id d'option */>;
}
