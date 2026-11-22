/// <reference types="vite/client" />
// Établi moteur (§ 5.11, première partie, demande du 17 novembre 2026) : le moteur sorti du véhicule,
// posé sur son support au milieu du garage, ses pièces écartées en vue éclatée, chacune traitée à part.
// Le catalogue partagé, public/assets/shared/engines/catalogue.json, dit les familles de moteur
// (fabriquées par npm run vehicles:build, tools/vehicles/moteurs.mjs), leurs pièces, leurs nœuds et
// leurs vecteurs d'éclatement, ce qui s'échange (filtres à air) et le cadre de la caméra ; le manifeste
// d'un véhicule nomme la famille de son moteur (engine.model). Ce fichier résout, sans rien connaître
// d'aucun véhicule ni d'aucune famille, le traitement et l'option de chaque pièce (pur, testé sans
// navigateur). Ce n'est pas une simulation mécanique : rien ici ne change le son ni la puissance ; les
// niveaux d'optimisation d'une pièce (genre `optimisation` du catalogue), qui eux comptent pour la
// puissance, sont dans src/data/optimisation.ts.
//
// Dans le build, sans champ nouveau : parts.moteur_<pièce> pour un échange (l'option ; l'origine n'est
// pas écrite), partPaints.moteur_<pièce> pour un traitement. Un Paint ne sait porter qu'une finition de
// peinture (src/data/finishes.ts, la sauvegarde écarte toute autre valeur) : chaque traitement est donc
// porté par une finition qui lui est propre (`porte`), avec sa couleur quand il en a une. L'origine (brut
// de fonderie) n'est jamais écrite ; une valeur inconnue, ou un traitement que la pièce n'admet pas,
// retombe sur l'origine.

import type { FinishId } from './finishes.ts';
import type { Build, Hex, Paint, VehicleManifest } from './vehicleTypes.ts';

export type Vec3 = readonly [number, number, number];

export type TraitementId = 'brut' | 'peinture' | 'chrome' | 'poli' | 'brosse' | 'anodise' | 'noir_satine';

/** Rendu d'un traitement : les réglages d'un matériau physique. */
export interface RenduTraitement {
  /** Couleur de base ; un traitement à couleur libre prend la couleur choisie à la place. */
  color: Hex;
  metalness: number;
  roughness: number;
  /** Vernis : 0 sans vernis. */
  clearcoat: number;
  clearcoatRoughness: number;
  /** Part du reflet de l'environnement (multipliée par celle de l'ambiance pour les métaux). */
  envMapIntensity: number;
}

export interface Traitement {
  id: TraitementId;
  label: string;
  /** Le nom avec son article, pour les phrases : « le chrome ». */
  phrase: string;
  /** Une ligne d'atelier sous le nom. */
  hint: string;
  /**
   * Finition de peinture qui porte ce traitement dans la sauvegarde (partPaints.moteur_<pièce>.finish),
   * une par traitement ; `null` : l'origine, jamais écrite.
   */
  porte: FinishId | null;
  /** Couleur libre (peinture, anodisé) : la teinte de départ ; absente, rien à choisir. */
  teinte?: Hex;
  /** Libre sans achat (l'origine et la peinture) ; sinon un article de la boutique, un seul pour tout le moteur et tous les véhicules. */
  libre: boolean;
  /** `null` : la matière d'origine de chaque morceau. */
  rendu: RenduTraitement | null;
}

/** Les traitements, dans l'ordre de la rangée. */
export const TRAITEMENTS: readonly Traitement[] = [
  { id: 'brut', label: 'Brut de fonderie', phrase: 'le brut de fonderie', hint: 'La matière d’origine', porte: null, libre: true, rendu: null },
  {
    id: 'peinture',
    label: 'Peinture haute température',
    phrase: 'la peinture haute température',
    hint: 'Couleur libre, elle tient la chaleur',
    porte: 'brillant',
    teinte: '#b3261e',
    libre: true,
    rendu: { color: '#b3261e', metalness: 0.05, roughness: 0.36, clearcoat: 0.4, clearcoatRoughness: 0.28, envMapIntensity: 0.9 },
  },
  { id: 'chrome', label: 'Chrome', phrase: 'le chrome', hint: 'Un miroir, de près comme de loin', porte: 'chrome', libre: false, rendu: { color: '#f4f6f8', metalness: 1, roughness: 0.04, clearcoat: 0, clearcoatRoughness: 0, envMapIntensity: 1.3 } },
  { id: 'poli', label: 'Poli miroir', phrase: 'le poli miroir', hint: 'L’alu poli à la main, plus chaud que le chrome', porte: 'metallise', libre: false, rendu: { color: '#e6e2da', metalness: 1, roughness: 0.11, clearcoat: 0, clearcoatRoughness: 0, envMapIntensity: 1.15 } },
  { id: 'brosse', label: 'Brossé', phrase: 'le brossé', hint: 'Un métal satiné, sans miroir', porte: 'mat', libre: false, rendu: { color: '#c3c6ca', metalness: 1, roughness: 0.36, clearcoat: 0, clearcoatRoughness: 0, envMapIntensity: 1 } },
  {
    id: 'anodise',
    label: 'Anodisé',
    phrase: 'l’anodisé',
    hint: 'Un métal teinté, couleur libre',
    porte: 'chrome-colore',
    teinte: '#2f6bff',
    libre: false,
    rendu: { color: '#2f6bff', metalness: 1, roughness: 0.22, clearcoat: 0, clearcoatRoughness: 0, envMapIntensity: 1.1 },
  },
  { id: 'noir_satine', label: 'Noir satiné', phrase: 'le noir satiné', hint: 'Un noir profond, qui ne brille pas', porte: 'satine', libre: false, rendu: { color: '#0e0f11', metalness: 0.3, roughness: 0.48, clearcoat: 0.35, clearcoatRoughness: 0.45, envMapIntensity: 0.8 } },
];

export function traitementById(id: string): Traitement | undefined {
  return TRAITEMENTS.find((item) => item.id === id);
}

// ---------------------------------------------------------------------------------------------
// Le catalogue

export interface MoteurMatiere {
  /** Nom du matériau dans le GLB : paint_<matière>. */
  id: string;
  label: string;
  color: Hex;
  metalness: number;
  roughness: number;
  /** Faux : la matière ne prend aucun traitement (le coton d'un filtre). */
  traitable: boolean;
}

export interface EchangeOption {
  id: string;
  label: string;
  hint?: string;
  /** Nœuds de l'option (part_<nom> dans le GLB) et leur vecteur d'éclatement, en mètres. */
  noeuds: Readonly<Record<string, Vec3>>;
}

export interface Echange {
  label: string;
  /** L'option d'origine : toujours libre. */
  origine: string;
  options: readonly EchangeOption[];
}

/**
 * Genres d'optimisation d'une pièce (vague U, retour du 18 novembre 2026 : « il faudra pouvoir optimiser
 * les pièces moteur aussi ») : le catalogue dit lequel chaque pièce reçoit (`optimisation`) ; les niveaux,
 * leurs prix et leurs gains sont dans src/data/optimisation.ts.
 */
export const GENRES_OPTIMISATION = ['filtre', 'admission', 'carburation', 'culasses', 'echappement', 'allumage'] as const;
export type GenreOptimisation = (typeof GENRES_OPTIMISATION)[number];

export interface MoteurPiece {
  id: string;
  label: string;
  /** Le nom avec son article, pour les phrases : « les cache-culbuteurs ». */
  phrase: string;
  /** Traitements admis (brut compris) ; absents : tous. */
  traitements?: readonly TraitementId[];
  /** Ce que la pièce optimise (src/data/optimisation.ts) ; absent : elle ne s'optimise pas. */
  optimisation?: GenreOptimisation;
  /** Nœuds de la pièce et leur vecteur d'éclatement ; absents si la pièce s'échange (ceux de ses options). */
  noeuds?: Readonly<Record<string, Vec3>>;
  echange?: Echange;
}

export interface MoteurFamille {
  id: string;
  label: string;
  /** Substitut fabriqué par le code (TODO_ASSETS.md, placeholder_moteurs). */
  placeholder?: boolean;
  /** Boîte que la caméra cadre : demi-longueur (X), demi-largeur (Z), hauteur depuis le sol, en mètres. */
  cadre: { halfLength: number; halfWidth: number; height: number };
  /** Demi-tour donné au moteur sur son support (0 ou 180 degrés) : son plus beau côté face à la caméra de départ. */
  orientation?: 0 | 180;
  pieces: readonly MoteurPiece[];
}

export interface MoteursCatalogue {
  budget: { triangles: number; drawCalls: number };
  matieres: readonly MoteurMatiere[];
  familles: readonly MoteurFamille[];
}

/**
 * Élévation de départ de la caméra sur l'établi (angle depuis la verticale, en radians) : un peu
 * au-dessus, pour lire le dessus du moteur (carburateur, filtre, tôles). Le véhicule part de plus bas.
 */
export const ETABLI_POLAR = 1.12;

/** Dossier des moteurs, sous le socle de l'app. */
export const ENGINES_DIR = 'assets/shared/engines/';
/** Préfixe des nœuds de pièce dans le GLB (§ 8) et nœud du support (mêmes que tools/vehicles/moteurs.mjs). */
export const PART_PREFIX = 'part_';
export const SUPPORT_NODE = 'support';
/** Préfixe des clés du build : parts.moteur_<pièce>, partPaints.moteur_<pièce>. */
export const MOTEUR_PREFIX = 'moteur_';

/** Fichier d'une famille (même nom que tools/vehicles/moteurs.mjs, engineFile). */
export const fichierMoteur = (famille: string): string => `${famille}/moteur.glb`;

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MATIERE = /^paint_[a-z0-9_]+$/;
const HEX = /^#[0-9a-f]{6}$/;

type Raw = Record<string, unknown>;
const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const unit = (value: unknown): value is number => typeof value === 'number' && value >= 0 && value <= 1;

function vector(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number' && Number.isFinite(n)) && Math.hypot(...(value as number[])) <= 1.5;
}

/** Nœuds de pièce d'un objet `noeuds` brut : chaque clé est un nom de nœud, chaque valeur un vecteur. */
function checkNoeuds(value: unknown, where: string, seen: Set<string>, problems: string[]): void {
  if (!isObject(value) || Object.keys(value).length === 0) {
    problems.push(`${where}.noeuds doit nommer au moins un nœud`);
    return;
  }
  for (const [node, vec] of Object.entries(value)) {
    if (!/^[a-z0-9_]+$/.test(node)) problems.push(`${where}.noeuds : « ${node} » (minuscules, chiffres et _)`);
    if (seen.has(node)) problems.push(`${where}.noeuds : « ${node} » déjà pris`);
    seen.add(node);
    if (!vector(vec)) problems.push(`${where}.noeuds.${node} doit être un vecteur d'éclatement (trois nombres, 1,5 m au plus)`);
  }
}

/** Valide le catalogue (erreur claire) et le rend typé. */
export function validateMoteursCatalogue(raw: unknown): MoteursCatalogue {
  const where = 'public/assets/shared/engines/catalogue.json';
  if (!isObject(raw) || !Array.isArray(raw.familles) || raw.familles.length === 0 || !Array.isArray(raw.matieres)) {
    throw new Error(`Catalogue des moteurs invalide, ${where} : « familles » (liste non vide) et « matieres » attendues.`);
  }
  const problems: string[] = [];
  const budget = raw.budget;
  if (!isObject(budget) || !(typeof budget.triangles === 'number' && budget.triangles > 0) || !(typeof budget.drawCalls === 'number' && budget.drawCalls > 0)) problems.push('budget doit porter triangles et drawCalls');
  const matieres = new Set<string>();
  raw.matieres.forEach((matiere: unknown, i) => {
    if (!isObject(matiere) || typeof matiere.id !== 'string' || !MATIERE.test(matiere.id) || !text(matiere.label) || typeof matiere.color !== 'string' || !HEX.test(matiere.color) || !unit(matiere.metalness) || !unit(matiere.roughness) || typeof matiere.traitable !== 'boolean') {
      problems.push(`matieres[${i}] doit porter id (paint_<nom>), label, color (#rrggbb), metalness et roughness (0 à 1), traitable`);
      return;
    }
    if (matieres.has(matiere.id)) problems.push(`matieres[${i}].id « ${matiere.id} » en double`);
    matieres.add(matiere.id);
  });
  const familles = new Set<string>();
  raw.familles.forEach((famille: unknown, i) => {
    const at = `familles[${i}]`;
    if (!isObject(famille) || typeof famille.id !== 'string' || !ID.test(famille.id) || !text(famille.label) || !Array.isArray(famille.pieces) || famille.pieces.length === 0) {
      problems.push(`${at} doit porter id, label et des pièces`);
      return;
    }
    if (familles.has(famille.id)) problems.push(`${at}.id « ${famille.id} » en double`);
    familles.add(famille.id);
    const cadre = famille.cadre;
    if (!isObject(cadre) || ![cadre.halfLength, cadre.halfWidth, cadre.height].every((v) => typeof v === 'number' && v > 0.1 && v < 3)) problems.push(`${at}.cadre doit porter halfLength, halfWidth et height (0,1 à 3 m)`);
    if (famille.placeholder !== undefined && typeof famille.placeholder !== 'boolean') problems.push(`${at}.placeholder doit être vrai ou faux`);
    if (famille.orientation !== undefined && famille.orientation !== 0 && famille.orientation !== 180) problems.push(`${at}.orientation doit valoir 0 ou 180 (la boîte du cadre reste la même)`);
    const pieces = new Set<string>();
    const nodes = new Set<string>();
    famille.pieces.forEach((piece: unknown, j) => {
      const p = `${at}.pieces[${j}]`;
      if (!isObject(piece) || typeof piece.id !== 'string' || !ID.test(piece.id) || !text(piece.label) || !text(piece.phrase)) {
        problems.push(`${p} doit porter id, label et phrase`);
        return;
      }
      if (pieces.has(piece.id)) problems.push(`${p}.id « ${piece.id} » en double`);
      pieces.add(piece.id);
      if (piece.traitements !== undefined) {
        const list = piece.traitements;
        if (!Array.isArray(list) || !list.includes('brut') || !list.every((id) => typeof id === 'string' && traitementById(id) !== undefined)) problems.push(`${p}.traitements doit citer des traitements connus, brut compris`);
      }
      if (piece.optimisation !== undefined && !GENRES_OPTIMISATION.some((genre) => genre === piece.optimisation)) problems.push(`${p}.optimisation doit nommer un genre connu (${GENRES_OPTIMISATION.join(', ')})`);
      const echange = piece.echange;
      if ((piece.noeuds === undefined) === (echange === undefined)) {
        problems.push(`${p} : des nœuds, ou un échange, l'un des deux`);
        return;
      }
      if (piece.noeuds !== undefined) checkNoeuds(piece.noeuds, p, nodes, problems);
      if (echange !== undefined) {
        if (!isObject(echange) || !text(echange.label) || typeof echange.origine !== 'string' || !Array.isArray(echange.options) || echange.options.length < 2) {
          problems.push(`${p}.echange doit porter label, origine et deux options au moins`);
          return;
        }
        const ids = new Set<string>();
        echange.options.forEach((option: unknown, o) => {
          const q = `${p}.echange.options[${o}]`;
          if (!isObject(option) || typeof option.id !== 'string' || !ID.test(option.id) || !text(option.label)) {
            problems.push(`${q} doit porter id et label`);
            return;
          }
          if (ids.has(option.id)) problems.push(`${q}.id « ${option.id} » en double`);
          ids.add(option.id);
          checkNoeuds(option.noeuds, q, nodes, problems);
        });
        if (!ids.has(echange.origine)) problems.push(`${p}.echange.origine « ${echange.origine} » doit être une de ses options`);
      }
    });
  });
  if (problems.length > 0) throw new Error(`Catalogue des moteurs invalide, ${where} : ${problems.join(' ; ')}.`);
  return raw as unknown as MoteursCatalogue;
}

const FOUND = import.meta.glob<unknown>('../../public/assets/shared/engines/catalogue.json', { eager: true, import: 'default' });

/** Le catalogue des moteurs. */
export const MOTEURS_CATALOGUE: MoteursCatalogue = validateMoteursCatalogue(Object.values(FOUND)[0]);

export function familleById(id: string, catalogue: MoteursCatalogue = MOTEURS_CATALOGUE): MoteurFamille | undefined {
  return catalogue.familles.find((famille) => famille.id === id);
}

/** Famille du moteur d'un véhicule (engine.model) ; absente : le moteur n'a pas encore de modèle. */
export function familleOf(vehicle: Pick<VehicleManifest, 'engine'>, catalogue: MoteursCatalogue = MOTEURS_CATALOGUE): MoteurFamille | undefined {
  const model = vehicle.engine?.model;
  return model ? familleById(model, catalogue) : undefined;
}

export function pieceById(famille: MoteurFamille, id: string): MoteurPiece | undefined {
  return famille.pieces.find((piece) => piece.id === id);
}

export function matiereById(id: string, catalogue: MoteursCatalogue = MOTEURS_CATALOGUE): MoteurMatiere | undefined {
  return catalogue.matieres.find((matiere) => matiere.id === id);
}

/** Clé du build d'une pièce : parts.moteur_<pièce> (échange), partPaints.moteur_<pièce> (traitement). */
export const cleMoteur = (piece: string): string => `${MOTEUR_PREFIX}${piece}`;

/** Article de la boutique d'un traitement : un seul pour toutes les pièces, tous les moteurs, tous les véhicules. */
export const articleTraitement = (id: string): string => `piece-moteur-traitement-${id}`;
/** Article d'une option d'échange (convention `piece-<poste>-<option>`, src/data/boutique.ts). */
export const articleEchange = (piece: string, option: string): string => `piece-moteur-${piece}-${option}`;

/** Traitements qu'admet une pièce, dans l'ordre de la rangée. */
export function traitementsDe(piece: MoteurPiece): Traitement[] {
  return TRAITEMENTS.filter((item) => !piece.traitements || piece.traitements.includes(item.id));
}

export interface TraitementResolu {
  traitement: Traitement;
  /** Couleur choisie (traitement à couleur libre) ; `null` : aucune. */
  couleur: Hex | null;
}

const ORIGINE: Traitement = TRAITEMENTS[0] as Traitement;

/**
 * Traitement d'une pièce dans ce build : la finition écrite désigne le traitement qu'elle porte ; une
 * valeur inconnue, ou un traitement que la pièce n'admet pas, retombe sur l'origine.
 */
export function resolveTraitement(piece: MoteurPiece, build: Build | undefined): TraitementResolu {
  const own = build?.partPaints?.[cleMoteur(piece.id)];
  const found = own?.finish ? TRAITEMENTS.find((item) => item.porte === own.finish) : undefined;
  const traitement = found && traitementsDe(piece).some((item) => item.id === found.id) ? found : ORIGINE;
  return { traitement, couleur: traitement.teinte ? (own?.color ?? traitement.teinte) : null };
}

/** Ce qu'il faut écrire dans partPaints.moteur_<pièce> pour ce traitement ; `null` : l'origine (on efface). */
export function ecritTraitement(traitement: Traitement, couleur?: Hex): Partial<Paint> | null {
  if (!traitement.porte) return null;
  return traitement.teinte ? { finish: traitement.porte, color: couleur ?? traitement.teinte } : { finish: traitement.porte };
}

/** Option posée sur une pièce qui s'échange ; une option inconnue retombe sur l'origine. `null` : la pièce ne s'échange pas. */
export function resolveEchange(piece: MoteurPiece, build: Build | undefined): EchangeOption | null {
  const echange = piece.echange;
  if (!echange) return null;
  const wanted = build?.parts?.[cleMoteur(piece.id)];
  return echange.options.find((option) => option.id === wanted) ?? echange.options.find((option) => option.id === echange.origine) ?? (echange.options[0] as EchangeOption);
}

/** Libre sans achat : l'origine d'un échange. */
export function echangeLibre(piece: MoteurPiece, option: string): boolean {
  return piece.echange?.origine === option;
}

/** Nœuds d'une pièce dans ce build (ceux de l'option posée si elle s'échange), avec leur vecteur d'éclatement. */
export function noeudsDe(piece: MoteurPiece, build: Build | undefined): Readonly<Record<string, Vec3>> {
  return piece.noeuds ?? resolveEchange(piece, build)?.noeuds ?? {};
}

/** Chaque nœud de pièce de la famille, toutes options comprises : la pièce qui le porte et son éclatement. */
export function noeudsFamille(famille: MoteurFamille): Map<string, { piece: string; eclate: Vec3; option: string | null }> {
  const out = new Map<string, { piece: string; eclate: Vec3; option: string | null }>();
  for (const piece of famille.pieces) {
    for (const [node, eclate] of Object.entries(piece.noeuds ?? {})) out.set(node, { piece: piece.id, eclate, option: null });
    for (const option of piece.echange?.options ?? []) for (const [node, eclate] of Object.entries(option.noeuds)) out.set(node, { piece: piece.id, eclate, option: option.id });
  }
  return out;
}

/** Clés que « D'origine » efface : les échanges et les traitements de toutes les pièces de la famille, et jamais les niveaux d'optimisation (`moteur_<pièce>_niveau`, déjà payés). */
export function clesMoteur(famille: MoteurFamille): { parts: string[]; partPaints: string[] } {
  return {
    parts: famille.pieces.filter((piece) => piece.echange).map((piece) => cleMoteur(piece.id)),
    partPaints: famille.pieces.map((piece) => cleMoteur(piece.id)),
  };
}

/** Vrai si le build a touché au moteur (traitement ou échange). */
export function moteurTouche(famille: MoteurFamille, build: Build | undefined): boolean {
  const keys = clesMoteur(famille);
  return keys.parts.some((key) => build?.parts?.[key] !== undefined) || keys.partPaints.some((key) => build?.partPaints?.[key] !== undefined);
}

/**
 * Signature de ce que montre l'établi pour ce build : traitement, couleur et option de chaque pièce.
 * Une clé stable : la scène ne se refait que si elle change.
 */
export function signatureEtabli(famille: MoteurFamille, build: Build | undefined): string {
  return JSON.stringify(
    famille.pieces.map((piece) => {
      const { traitement, couleur } = resolveTraitement(piece, build);
      return [piece.id, traitement.id, couleur, resolveEchange(piece, build)?.id ?? null];
    }),
  );
}

/** Phrase de l'entrée pour un véhicule dont le moteur n'a pas encore de modèle. */
export function sansModele(vehicle: Pick<VehicleManifest, 'name' | 'engine'>): string {
  const label = vehicle.engine?.label;
  return `${vehicle.name} attend encore le modèle de son moteur${label ? ` (${label})` : ''} : l’établi s’ouvrira avec lui.`;
}

// ---------------------------------------------------------------------------------------------
// Validation du champ engine.model d'un manifeste (appelée par src/data/vehicles.ts)

/** Problème du champ `engine.model` d'un manifeste brut, ajouté à `problems`. */
export function checkEngineModel(value: unknown, problems: string[], catalogue: MoteursCatalogue = MOTEURS_CATALOGUE): void {
  if (value === undefined) return;
  if (typeof value !== 'string' || !familleById(value, catalogue)) problems.push(`engine.model doit nommer une famille du catalogue des moteurs (${catalogue.familles.map((famille) => famille.id).join(', ')})`);
}

// ---------------------------------------------------------------------------------------------
// Le moteur posé dans le véhicule (vague U, « capot » : capot ouvert, vitré ou déposé)

/** Bornes de l'échelle du moteur posé : un substitut à la taille d'un véhicule qui l'est aussi. */
export const POSE_SCALE = Object.freeze({ min: 0.5, max: 1.2 });

/**
 * Problèmes du champ `engine.pose` d'un manifeste brut (appelée par src/data/vehicles.ts) : il demande
 * un modèle ; position (trois nombres, à 3 m au plus de l'origine), demi-tour en degrés, échelle bornée.
 */
export function checkEnginePose(value: unknown, model: unknown, problems: string[]): void {
  if (value === undefined) return;
  if (model === undefined) problems.push('engine.pose demande engine.model (le moteur à poser)');
  if (!isObject(value)) {
    problems.push('engine.pose doit être un objet (position, yaw, scale)');
    return;
  }
  const position = value.position;
  if (!Array.isArray(position) || position.length !== 3 || !position.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 3)) problems.push('engine.pose.position doit porter trois nombres, en mètres (3 m au plus)');
  if (value.yaw !== undefined && !(typeof value.yaw === 'number' && Number.isFinite(value.yaw) && Math.abs(value.yaw) <= 360)) problems.push('engine.pose.yaw doit être un angle en degrés (−360 à 360)');
  if (value.scale !== undefined && !(typeof value.scale === 'number' && value.scale >= POSE_SCALE.min && value.scale <= POSE_SCALE.max)) problems.push(`engine.pose.scale doit être une échelle de ${POSE_SCALE.min} à ${POSE_SCALE.max}`);
  for (const key of Object.keys(value)) if (!['position', 'yaw', 'scale'].includes(key)) problems.push(`engine.pose.${key} : inconnu (position, yaw, scale)`);
}

/** Le moteur à poser dans le véhicule : sa famille et sa pose ; `null` : le manifeste n'en pose pas. */
export function moteurPose(vehicle: Pick<VehicleManifest, 'engine'>, catalogue: MoteursCatalogue = MOTEURS_CATALOGUE): { famille: MoteurFamille; pose: Required<NonNullable<NonNullable<VehicleManifest['engine']>['pose']>> } | null {
  const famille = familleOf(vehicle, catalogue);
  const pose = vehicle.engine?.pose;
  if (!famille || !pose) return null;
  return { famille, pose: { position: pose.position, yaw: pose.yaw ?? 0, scale: pose.scale ?? 1 } };
}

/**
 * Signature de ce que montre le moteur posé : traitement, couleur et option de chaque pièce (comme
 * l'établi, sans la vue éclatée ni la pièce choisie). `''` : pas de moteur posé.
 */
export function signatureMoteurPose(vehicle: Pick<VehicleManifest, 'engine'>, build: Build | undefined): string {
  const posed = moteurPose(vehicle);
  return posed ? signatureEtabli(posed.famille, build) : '';
}
