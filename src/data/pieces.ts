/// <reference types="vite/client" />
// Pièces montées sur la caisse (§ 5.4, § 6, demande du 17 novembre 2026) : un système de postes
// (aileron ; kit carrosserie : lame avant, jupes, diffuseur) piloté par les données.
// Le catalogue partagé, public/assets/shared/pieces/catalogue.json, dit les postes et leurs options
// (fabriquées par npm run vehicles:build, tools/vehicles/pieces.mjs) ; le manifeste d'un véhicule dit,
// poste par poste (section `pieces`), où la pièce se pose et ce qu'il accepte. Un poste absent du
// manifeste n'existe pas pour ce véhicule. Ce fichier résout, sans rien connaître d'aucun véhicule,
// l'option posée (une option inconnue ou non permise retombe sur l'origine), sa peinture, et la pose
// de chaque sommet d'une pièce dans le repère du véhicule (pur, testé sans navigateur). Trois poses :
// « surface » et « supports » (aileron : un point de pose sur l'axe) ; « rail » (kit carrosserie : la
// pièce suit une ligne de la caisse, sur l'axe ou en paire gauche-droite, une seule géométrie en miroir).
//
// Dans le build : parts.<poste> (identifiant d'option ; l'origine n'est pas écrite), partPaints.<poste>
// (couleur propre ; absente : la peinture de la carrosserie).
//
// Quatrième pose (vague U, demande du 18 novembre 2026) : « capot ». Ses options ne sont pas des
// fichiers partagés mais des nœuds du modèle que le manifeste nomme (capot d'origine et son pivot, capot
// vitré, compartiment) : src/scene/vehicle/capot.ts les montre ou les cache, le style de l'option dit
// quoi faire (`vitre` : la variante vitrée ; `depose` : plus de capot). Aucune couleur propre : le capot
// garde la peinture de sa zone.

import type { ArticleBoutique } from './boutique.ts';
import { FINISHES } from './finishes.ts';
import type { LiveryFace } from './stickersCalques.ts';
import type { Build, CrownProfile, Paint, PieceLidMount, PieceMount, PieceRailMount, PieceSupports, PieceSurfaceMount, VehicleManifest, VehiclePoint } from './vehicleTypes.ts';

export interface PieceOption {
  id: string;
  /** Famille de modelage (tools/vehicles/pieces.mjs). */
  style: string;
  /**
   * « surface » : épouse la surface au bord de fuite ; « supports » : aileron de niveau sur pieds ;
   * « rail » : suit une ligne de la caisse (kit carrosserie, section `rail` du manifeste) ; « capot » :
   * un nœud du modèle (capot vitré, capot déposé), aucun fichier.
   */
  mount: 'surface' | 'supports' | 'rail' | 'capot';
  label: string;
  /** Le nom avec son article, pour les phrases : « l’aileron haut ». */
  phrase: string;
  hint?: string;
  /** Envergure : part de celle du manifeste (aileron démesuré : plus large). Absente : 1. */
  spanFactor?: number;
  /**
   * Pièce sur rail : hauteur modelée au-dessus de la ligne (contre la face) et sous elle, en mètres.
   * L'app la tasse, sans la déformer autrement, là où la face est moins haute (`rise` du manifeste) ou
   * le bas de caisse plus proche (`wheels.floor`).
   */
  rise?: number;
  depth?: number;
  /** Silhouette de l'option (tracé SVG, boîte 48 × 30), posée sur celle du poste. */
  picto: string;
}

/** Un groupe de postes réunis sous une entrée du menu (kit carrosserie). */
export interface PieceGroupe {
  id: string;
  label: string;
  /** Fin de phrase après le nom d'un véhicule qui n'a aucun poste du groupe. */
  absent: string;
}

export interface PiecePoste {
  id: string;
  label: string;
  /** Groupe du poste (une entrée qui en réunit plusieurs) ; absent : le poste a son entrée à lui. */
  groupe?: string;
  /** Pièce sur rail en paire gauche-droite : le manifeste donne le flanc droit, la gauche est son miroir. */
  mirror?: boolean;
  /** Le nom du poste est un pluriel (« les jupes ») : les phrases s'accordent. */
  plural?: boolean;
  /** Faux : le poste ne prend pas de couleur propre (le capot garde la peinture de sa zone). Absent : vrai. */
  peinture?: boolean;
  /** Fin de phrase après le nom d'un véhicule qui n'a pas ce poste. */
  absent: string;
  /** Nom du réglage de couleur propre : « Couleur de l’aileron ». */
  colorLabel: string;
  /** L'absence de pièce : toujours permise, toujours libre. */
  none: { id: string; label: string; hint?: string; phrase: string };
  /**
   * Cotes de modelage des options, en mètres : largeur (le long du rail pour une pièce sur rail),
   * milieu des pieds (z ; postes sur supports), longueur gardée telle quelle à chaque bout (pièce sur
   * rail : le milieu seul s'étire à la longueur du rail).
   */
  reference: { width: number; feet?: number; ends?: number };
  /** Silhouette commune (tracé SVG, boîte 48 × 30) : l'arrière d'une caisse. */
  picto: string;
  options: readonly PieceOption[];
}

export interface PiecesCatalogue {
  groupes?: readonly PieceGroupe[];
  postes: readonly PiecePoste[];
}

/** Dossier des pièces montées, sous le socle de l'app. */
export const PIECES_DIR = 'assets/shared/pieces/';

/** Nœuds d'un fichier de pièce (mêmes noms que tools/vehicles/pieces.mjs, NODES). */
export const PIECE_NODES = Object.freeze({ surface: 'surface', level: 'niveau', rail: 'rail' });

/** Styles des options de capot : la variante vitrée du modèle, ou plus de capot du tout. */
export const CAPOT_STYLES = Object.freeze(['vitre', 'depose'] as const);
export type CapotStyle = (typeof CAPOT_STYLES)[number];

/** Pièce sur supports : sous cette hauteur (repère de la pièce), tout descend sur la surface (pieds, semelles). */
export const FOOT_BAND = 0.012;
/** Demi-épaisseur de la bande des pieds autour de reference.feet, et largeur des bouts de lame (dérives), en mètres. */
const FOOT_HALF = 0.035;
const TIP = 0.06;

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

type Raw = Record<string, unknown>;
const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/** Valide le catalogue (erreur claire) et le rend typé. */
export function validatePiecesCatalogue(raw: unknown): PiecesCatalogue {
  const where = 'public/assets/shared/pieces/catalogue.json';
  if (!isObject(raw) || !Array.isArray(raw.postes) || raw.postes.length === 0) throw new Error(`Catalogue des pièces invalide, ${where} : « postes » doit être une liste non vide.`);
  const problems: string[] = [];
  const groupes = new Set<string>();
  if (raw.groupes !== undefined && !Array.isArray(raw.groupes)) problems.push('groupes doit être une liste');
  (Array.isArray(raw.groupes) ? raw.groupes : []).forEach((groupe: unknown, i) => {
    if (!isObject(groupe) || typeof groupe.id !== 'string' || !ID.test(groupe.id) || !text(groupe.label) || !text(groupe.absent)) problems.push(`groupes[${i}] doit porter id, label et absent`);
    else if (groupes.has(groupe.id)) problems.push(`groupes[${i}].id « ${groupe.id} » en double`);
    else groupes.add(groupe.id);
  });
  const postes = new Set<string>();
  raw.postes.forEach((poste: unknown, i) => {
    const at = `postes[${i}]`;
    if (!isObject(poste) || typeof poste.id !== 'string' || !ID.test(poste.id) || !text(poste.label) || !text(poste.absent) || !text(poste.colorLabel) || !text(poste.picto)) {
      problems.push(`${at} doit porter id, label, absent, colorLabel et picto`);
      return;
    }
    if (postes.has(poste.id)) problems.push(`${at}.id « ${poste.id} » en double`);
    postes.add(poste.id);
    const none = poste.none;
    if (!isObject(none) || typeof none.id !== 'string' || !ID.test(none.id) || !text(none.label) || !text(none.phrase)) problems.push(`${at}.none doit porter id, label et phrase`);
    if (poste.groupe !== undefined && !(typeof poste.groupe === 'string' && groupes.has(poste.groupe))) problems.push(`${at}.groupe doit citer un groupe du catalogue`);
    for (const key of ['mirror', 'plural', 'peinture']) if (poste[key] !== undefined && typeof poste[key] !== 'boolean') problems.push(`${at}.${key} doit être vrai ou faux`);
    const options = Array.isArray(poste.options) ? poste.options : [];
    const mounts = new Set(options.map((option: unknown) => (isObject(option) ? option.mount : undefined)));
    const ref = poste.reference;
    if (!isObject(ref) || typeof ref.width !== 'number' || !(ref.width > 0.2 && ref.width <= 4)) problems.push(`${at}.reference doit porter width (largeur de modelage, de 0,2 à 4 m)`);
    else {
      if (mounts.has('supports') && (typeof ref.feet !== 'number' || ref.feet <= FOOT_HALF || ref.feet + FOOT_HALF >= ref.width / 2 - TIP)) {
        problems.push(`${at}.reference doit porter feet (milieu des pieds, entre ${FOOT_HALF} m et la demi-largeur moins ${FOOT_HALF + TIP} m)`);
      }
      if (ref.ends !== undefined && !(typeof ref.ends === 'number' && ref.ends >= 0 && ref.ends < ref.width / 2 - 0.05)) problems.push(`${at}.reference.ends doit être une longueur de 0 à la demi-largeur moins 5 cm`);
    }
    if (mounts.has('rail') && mounts.size > 1) problems.push(`${at}.options : un poste sur rail n'a que des options sur rail`);
    if (mounts.has('capot') && mounts.size > 1) problems.push(`${at}.options : un poste de capot n'a que des options de capot`);
    if (mounts.has('capot') && options.some((option: unknown) => !isObject(option) || !(CAPOT_STYLES as readonly unknown[]).includes(option.style))) problems.push(`${at}.options : une option de capot a pour style ${CAPOT_STYLES.join(' ou ')}`);
    if (poste.mirror === true && !mounts.has('rail')) problems.push(`${at}.mirror ne vaut que pour un poste sur rail`);
    if (options.length === 0) problems.push(`${at}.options : au moins une option`);
    const seen = new Set<string>(isObject(none) && typeof none.id === 'string' ? [none.id] : []);
    options.forEach((option: unknown, j) => {
      const o = `${at}.options[${j}]`;
      if (
        !isObject(option) ||
        typeof option.id !== 'string' ||
        !ID.test(option.id) ||
        !text(option.style) ||
        (option.mount !== 'surface' && option.mount !== 'supports' && option.mount !== 'rail' && option.mount !== 'capot') ||
        !text(option.label) ||
        !text(option.phrase) ||
        !text(option.picto)
      ) {
        problems.push(`${o} doit porter id, style, mount (surface, supports, rail ou capot), label, phrase et picto`);
        return;
      }
      if (seen.has(option.id)) problems.push(`${o}.id « ${option.id} » en double (ou égal à none.id)`);
      seen.add(option.id);
      if (option.spanFactor !== undefined && !(typeof option.spanFactor === 'number' && option.spanFactor >= 1 && option.spanFactor <= 1.5)) problems.push(`${o}.spanFactor doit être un facteur de 1 à 1,5`);
      const height = (value: unknown) => typeof value === 'number' && value >= 0 && value <= 0.4;
      if (option.mount === 'rail' && !(height(option.rise) && height(option.depth))) problems.push(`${o} : une option sur rail porte rise et depth (de 0 à 0,4 m)`);
    });
  });
  if (problems.length > 0) throw new Error(`Catalogue des pièces invalide, ${where} : ${problems.join(' ; ')}.`);
  return raw as unknown as PiecesCatalogue;
}

const FOUND = import.meta.glob<unknown>('../../public/assets/shared/pieces/catalogue.json', { eager: true, import: 'default' });

/** Le catalogue des pièces montées. */
export const PIECES_CATALOGUE: PiecesCatalogue = validatePiecesCatalogue(Object.values(FOUND)[0]);

export function posteById(id: string, catalogue: PiecesCatalogue = PIECES_CATALOGUE): PiecePoste | undefined {
  return catalogue.postes.find((poste) => poste.id === id);
}

/** Fichier d'une option (même nom que tools/vehicles/pieces.mjs, pieceFile). */
export const pieceFile = (poste: string, option: string): string => `${poste}_${option}.glb`;

/** Article de la boutique d'une option (convention de src/data/boutique.ts). */
export const articleIdOf = (poste: string, option: string): string => `piece-${poste}-${option}`;

/** Où se pose le poste sur ce véhicule ; absent : le véhicule n'a pas ce poste. */
export function mountOf(vehicle: Pick<VehicleManifest, 'pieces'>, poste: string): PieceMount | undefined {
  return vehicle.pieces?.[poste];
}

/** Vrai pour un poste posé le long d'une ligne de la caisse (kit carrosserie). */
export const isRailMount = (mount: PieceMount): mount is PieceRailMount => 'rail' in mount;

/** Vrai pour le poste du capot moteur (nœuds du modèle, src/scene/vehicle/capot.ts). */
export const isLidMount = (mount: PieceMount): mount is PieceLidMount => 'lid' in mount;

/** Une option a-t-elle un fichier partagé (public/assets/shared/pieces/) ? Celles du capot, non. */
export const hasPieceFile = (option: Pick<PieceOption, 'mount'>): boolean => option.mount !== 'capot';

/** La pose du manifeste reçoit-elle cette option ? Rail pour rail, capot pour capot ; supports seulement s'ils sont déclarés. */
function accepts(mount: PieceMount, option: PieceOption): boolean {
  if (isRailMount(mount)) return option.mount === 'rail';
  if (isLidMount(mount)) return option.mount === 'capot';
  return option.mount === 'surface' || (option.mount === 'supports' && mount.supports !== undefined);
}

/** Options qu'un véhicule accepte sur un poste (sans l'absence de pièce) : celles du manifeste, que la pose permet. */
export function optionsFor(vehicle: Pick<VehicleManifest, 'pieces'>, poste: string, catalogue: PiecesCatalogue = PIECES_CATALOGUE): PieceOption[] {
  const mount = mountOf(vehicle, poste);
  const item = posteById(poste, catalogue);
  if (!mount || !item) return [];
  return item.options.filter((option) => (!mount.options || mount.options.includes(option.id)) && accepts(mount, option));
}

export function groupeById(id: string, catalogue: PiecesCatalogue = PIECES_CATALOGUE): PieceGroupe | undefined {
  return catalogue.groupes?.find((groupe) => groupe.id === id);
}

/** Postes d'un groupe, dans l'ordre du catalogue (tous, que le véhicule les ait ou non). */
export function postesDuGroupe(groupe: string, catalogue: PiecesCatalogue = PIECES_CATALOGUE): PiecePoste[] {
  return catalogue.postes.filter((poste) => poste.groupe === groupe);
}

/** Option d'origine d'un poste (celle du manifeste, sinon l'absence de pièce). */
export function originOf(vehicle: Pick<VehicleManifest, 'pieces'>, poste: string, catalogue: PiecesCatalogue = PIECES_CATALOGUE): string {
  const item = posteById(poste, catalogue);
  const wanted = mountOf(vehicle, poste)?.default;
  if (wanted && optionsFor(vehicle, poste, catalogue).some((option) => option.id === wanted)) return wanted;
  return item?.none.id ?? '';
}

/** Libre sans achat : l'origine du poste et l'absence de pièce. */
export function isFree(vehicle: Pick<VehicleManifest, 'pieces'>, poste: string, option: string, catalogue: PiecesCatalogue = PIECES_CATALOGUE): boolean {
  return option === originOf(vehicle, poste, catalogue) || option === posteById(poste, catalogue)?.none.id;
}

export interface ResolvedPiece {
  poste: PiecePoste;
  mount: PieceMount;
  /** L'option posée ; `null` : aucune pièce. */
  option: PieceOption | null;
  /** Identifiant de ce qui est posé (option, ou l'absence de pièce). */
  id: string;
  /** Couleur propre (partPaints) ; absente : la peinture de la carrosserie. */
  own: Partial<Paint> | null;
}

/**
 * Ce que le build pose sur un poste de ce véhicule. Une option inconnue ou non permise retombe sur
 * l'origine. `null` : le véhicule n'a pas ce poste.
 */
export function resolvePiece(vehicle: Pick<VehicleManifest, 'pieces'>, build: Build | undefined, poste: string, catalogue: PiecesCatalogue = PIECES_CATALOGUE): ResolvedPiece | null {
  const mount = mountOf(vehicle, poste);
  const item = posteById(poste, catalogue);
  if (!mount || !item) return null;
  const options = optionsFor(vehicle, poste, catalogue);
  const wanted = build?.parts?.[poste];
  const valid = (id: string | undefined) => id !== undefined && (id === item.none.id || options.some((option) => option.id === id));
  const id = valid(wanted) ? (wanted as string) : originOf(vehicle, poste, catalogue);
  const own = build?.partPaints?.[poste];
  return { poste: item, mount, option: options.find((option) => option.id === id) ?? null, id, own: own && Object.keys(own).length > 0 ? own : null };
}

/** Postes que ce véhicule déclare (et que le catalogue connaît), dans l'ordre du catalogue. */
export function postesOf(vehicle: Pick<VehicleManifest, 'pieces'>, catalogue: PiecesCatalogue = PIECES_CATALOGUE): PiecePoste[] {
  return catalogue.postes.filter((poste) => mountOf(vehicle, poste.id) !== undefined);
}

/**
 * Peinture d'une pièce : celle de la carrosserie, ou sa couleur propre (mêmes finitions que la
 * peinture). Une autre finition que celle de la caisse oublie la paillette de la caisse.
 */
export function piecePaint(body: Paint, own: Partial<Paint> | null | undefined): Paint {
  if (!own) return body;
  const paint: Paint = { ...body };
  if (own.color !== undefined) paint.color = own.color;
  if (own.finish !== undefined && FINISHES.some((item) => item.id === own.finish) && own.finish !== body.finish) {
    paint.finish = own.finish;
    delete paint.flake;
    delete paint.color2;
  }
  if (own.flake !== undefined) paint.flake = own.flake;
  if (own.color2 !== undefined) paint.color2 = own.color2;
  return paint;
}

/** Vrai si le build a touché au poste (bouton « D'origine »). */
export function pieceTouched(build: Build | undefined, poste: string): boolean {
  return build?.parts?.[poste] !== undefined || build?.partPaints?.[poste] !== undefined;
}

/** Ce que « D'origine » rend : l'option et la couleur propre du poste. */
export function pieceKeys(poste: string): { parts: string[]; partPaints: string[] } {
  return { parts: [poste], partPaints: [poste] };
}

/**
 * Les articles d'un poste pour la boutique (src/data/articles/) : une option avec un prix = un article
 * `piece-<poste>-<option>`, famille `piece`. L'absence de pièce n'en est jamais un.
 */
export function articlesDuPoste(poste: string, prix: Readonly<Record<string, number>>, catalogue: PiecesCatalogue = PIECES_CATALOGUE): ArticleBoutique[] {
  const item = posteById(poste, catalogue);
  if (!item) return [];
  return item.options
    .filter((option) => prix[option.id] !== undefined)
    .map((option) => ({
      id: articleIdOf(poste, option.id),
      famille: 'piece' as const,
      label: option.label.toLowerCase().includes(item.label.toLowerCase()) ? option.label : `${item.label} · ${option.label}`,
      prix: prix[option.id] ?? null,
      description: option.hint ?? option.label,
    }));
}

// ---------------------------------------------------------------------------------------------
// Validation de la section `pieces` d'un manifeste (appelée par src/data/vehicles.ts)

function point(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function crown(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  let last = 0;
  for (const pair of value) {
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
    const [z, drop] = pair as [number, number];
    if (z <= last || z > 2 || Math.abs(drop) > 0.3) return false;
    last = z;
  }
  return true;
}

/** Profil en long : paires [x, descente], x croissant, jamais nul, des deux côtés du point de pose. */
function bend(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  let last = -Infinity;
  for (const pair of value) {
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
    const [x, drop] = pair as [number, number];
    if (x <= last || x === 0 || Math.abs(x) > 2 || Math.abs(drop) > 0.3) return false;
    last = x;
  }
  return true;
}

function normal(value: unknown): boolean {
  return point(value) && Math.hypot(...value) > 0.5 && Math.hypot(...value) < 1.5;
}

/** Problèmes d'une pose sur rail (`pieces.<poste>` d'un poste dont les options sont sur rail). */
function checkRail(where: string, mount: Raw, poste: PiecePoste, problems: string[]): void {
  for (const key of ['anchor', 'normal', 'width', 'crown', 'bend', 'supports']) if (mount[key] !== undefined) problems.push(`${where}.${key} : un poste sur rail n'a que rail et rise`);
  const rail = mount.rail;
  if (!Array.isArray(rail) || rail.length < 3 || !rail.every(point)) {
    problems.push(`${where}.rail doit lister au moins trois points de trois nombres, en mètres`);
  } else {
    const points = rail as VehiclePoint[];
    let ok = true;
    for (let i = 1; i < points.length; i += 1) {
      const [a, b] = [points[i - 1] as VehiclePoint, points[i] as VehiclePoint];
      const step = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      if (step < 0.005 || step > 0.3) ok = false;
    }
    if (!ok) problems.push(`${where}.rail : deux points voisins sont à 5 mm au moins et à 30 cm au plus`);
    if (poste.mirror) {
      if (!points.every((p) => p[2] >= 0.05)) problems.push(`${where}.rail : une paire se donne sur le flanc droit (z de 5 cm au moins)`);
    } else if ((points[0] as VehiclePoint)[2] !== 0 || !points.every((p, i) => i === 0 || p[2] > (points[i - 1] as VehiclePoint)[2])) {
      problems.push(`${where}.rail : une pièce sur l'axe part du point sur l'axe (z = 0), z croissant`);
    } else if (railPath(railPoints({ rail: points }, false)).length < 2 * (poste.reference.ends ?? 0) + 0.1) {
      problems.push(`${where}.rail : trop court pour les bouts de la pièce`);
    }
  }
  if (!(typeof mount.rise === 'number' && mount.rise >= 0 && mount.rise <= 0.4)) problems.push(`${where}.rise doit être une hauteur de face de 0 à 0,4 m`);
}

/** Problèmes d'une pose sur surface (aileron : bord de fuite, normale, largeur utile, supports). */
function checkSurface(where: string, mount: Raw, problems: string[]): void {
  if (mount.rail !== undefined) problems.push(`${where}.rail : ce poste se pose sur une surface (anchor, normal, width)`);
  if (!point(mount.anchor)) problems.push(`${where}.anchor doit porter trois nombres, en mètres (bord de fuite, sur l'axe)`);
  if (!normal(mount.normal)) problems.push(`${where}.normal doit être un vecteur unitaire (trois nombres)`);
  if (!(typeof mount.width === 'number' && mount.width >= 0.1 && mount.width <= 3)) problems.push(`${where}.width doit être une largeur utile de 0,1 à 3 m`);
  if (mount.crown !== undefined && !crown(mount.crown)) problems.push(`${where}.crown doit lister des paires [z, descente] en mètres, z croissant de 0 à 2`);
  if (mount.bend !== undefined && !bend(mount.bend)) problems.push(`${where}.bend doit lister des paires [x, descente] en mètres, x croissant, non nul, de −2 à 2`);
  const supports = mount.supports;
  if (supports !== undefined) {
    const ok =
      isObject(supports) &&
      point(supports.anchor) &&
      normal(supports.normal) &&
      typeof supports.spacing === 'number' &&
      supports.spacing >= 2 * FOOT_HALF + 0.02 &&
      typeof supports.span === 'number' &&
      supports.span <= 3 &&
      supports.span >= supports.spacing + 2 * (FOOT_HALF + TIP) + 0.01 &&
      (supports.crown === undefined || crown(supports.crown)) &&
      (supports.bend === undefined || bend(supports.bend));
    if (!ok) problems.push(`${where}.supports doit porter anchor et normal (trois nombres), spacing (entraxe des pieds, 0,09 m au moins) et span (envergure, au moins l'entraxe plus 0,2 m, 3 m au plus), crown et bend facultatifs`);
  }
}

const NODE = /^[a-z0-9_]+$/;
const FACES = ['+x', '-x', '+y', '-y', '+z', '-z'];

/** Problèmes d'un poste de capot (nœuds du modèle, ouverture, pastille, cadre de la caméra). */
function checkLid(where: string, mount: Raw, problems: string[], catalogue: PiecesCatalogue): void {
  for (const key of ['anchor', 'normal', 'width', 'crown', 'bend', 'supports', 'rail', 'rise']) if (mount[key] !== undefined) problems.push(`${where}.${key} : un capot n'a que lid, glazed, bay, axis, angle, pin, frame et carries`);
  const carries = mount.carries;
  if (carries !== undefined && !(Array.isArray(carries) && carries.every((id) => typeof id === 'string' && catalogue.postes.some((poste) => poste.id === id && !poste.options.some((option) => option.mount === 'capot'))))) {
    problems.push(`${where}.carries doit citer des postes du catalogue (ceux posés sur le capot)`);
  }
  if (typeof mount.lid !== 'string' || !NODE.test(mount.lid)) problems.push(`${where}.lid doit nommer le nœud du capot (minuscules, chiffres et _)`);
  for (const key of ['glazed', 'bay']) if (mount[key] !== undefined && (typeof mount[key] !== 'string' || !NODE.test(mount[key]) || mount[key] === mount.lid)) problems.push(`${where}.${key} doit nommer un autre nœud du modèle`);
  if (!normal(mount.axis)) problems.push(`${where}.axis doit être un axe unitaire (trois nombres), repère du nœud`);
  if (!(typeof mount.angle === 'number' && Math.abs(mount.angle) >= 20 && Math.abs(mount.angle) <= 100)) problems.push(`${where}.angle doit être une ouverture de 20 à 100 degrés (signe : le sens)`);
  const pin = mount.pin;
  if (!isObject(pin) || !point(pin.at) || !normal(pin.normal)) problems.push(`${where}.pin doit porter at (trois nombres, en mètres : la pastille sur le capot) et normal (la normale du capot, unitaire)`);
  const frame = mount.frame;
  const size = isObject(frame) ? frame.size : undefined;
  if (!isObject(frame) || !FACES.includes(frame.face as string) || !point(frame.center) || !point(size) || !(size as number[]).every((v) => v > 0.05 && v <= 3)) {
    problems.push(`${where}.frame doit porter face (${FACES.join(', ')}), center et size (trois nombres, 5 cm à 3 m)`);
  }
}

/** Problèmes de la section `pieces` d'un manifeste brut, ajoutés à `problems`. */
export function checkPieces(raw: Raw, problems: string[], catalogue: PiecesCatalogue = PIECES_CATALOGUE): void {
  const pieces = raw.pieces;
  if (pieces === undefined) return;
  if (!isObject(pieces)) {
    problems.push('pieces doit être un objet (un poste par clé)');
    return;
  }
  for (const [id, mount] of Object.entries(pieces)) {
    const where = `pieces.${id}`;
    const poste = posteById(id, catalogue);
    if (!poste) {
      problems.push(`${where} : poste inconnu du catalogue des pièces (${catalogue.postes.map((item) => item.id).join(', ')})`);
      continue;
    }
    if (!isObject(mount)) {
      problems.push(`${where} doit être un objet`);
      continue;
    }
    if (poste.options.some((option) => option.mount === 'rail')) checkRail(where, mount, poste, problems);
    else if (poste.options.some((option) => option.mount === 'capot')) checkLid(where, mount, problems, catalogue);
    else checkSurface(where, mount, problems);
    const known = poste.options.map((option) => option.id);
    if (mount.options !== undefined && !(Array.isArray(mount.options) && mount.options.length > 0 && mount.options.every((option) => typeof option === 'string' && known.includes(option)))) {
      problems.push(`${where}.options doit citer des options du catalogue (${known.join(', ')})`);
    }
    if (mount.default !== undefined && !(typeof mount.default === 'string' && (mount.default === poste.none.id || known.includes(mount.default)))) problems.push(`${where}.default doit être une option du catalogue ou « ${poste.none.id} »`);
  }
}

// ---------------------------------------------------------------------------------------------
// Pose d'une pièce (pur) : chaque sommet du repère de la pièce vers le repère du véhicule posé

type Vec3 = readonly [number, number, number];

/** Descente de la surface à `z` de l'axe, d'après le profil en travers (interpolée, prolongée par sa dernière pente). */
export function crownDrop(profile: CrownProfile | undefined, z: number): number {
  if (!profile || profile.length === 0) return 0;
  const a = Math.abs(z);
  let z0 = 0;
  let d0 = 0;
  for (const [z1, d1] of profile) {
    if (a <= z1) return d0 + ((d1 - d0) * (a - z0)) / (z1 - z0);
    z0 = z1;
    d0 = d1;
  }
  const last = profile[profile.length - 1] as readonly [number, number];
  const before = profile.length > 1 ? (profile[profile.length - 2] as readonly [number, number]) : ([0, 0] as const);
  return last[1] + ((last[1] - before[1]) / (last[0] - before[0])) * (a - last[0]);
}

/**
 * Descente d'un profil en long à `x` (signé) : interpolée entre ses points et (0, 0), prolongée par la
 * pente de son premier ou de son dernier segment.
 */
export function bendDrop(profile: CrownProfile | undefined, x: number): number {
  if (!profile || profile.length === 0) return 0;
  const points: Array<readonly [number, number]> = [...profile.filter(([px]) => px < 0), [0, 0], ...profile.filter(([px]) => px > 0)];
  let i = 1;
  while (i < points.length - 1 && x > (points[i] as readonly [number, number])[0]) i += 1;
  const [x0, d0] = points[i - 1] as readonly [number, number];
  const [x1, d1] = points[i] as readonly [number, number];
  return d0 + ((d1 - d0) * (x - x0)) / (x1 - x0);
}

/**
 * Largeur d'un aileron sur supports : les pieds (bande autour de ±reference.feet) vont rigides à
 * ±spacing / 2, les bouts de lame et leurs dérives à ±halfSpan, le reste s'étire entre les deux.
 */
export function spanMap(z: number, reference: PiecePoste['reference'], spacing: number, halfSpan: number): number {
  const a = Math.abs(z);
  const half = reference.width / 2;
  const feet = reference.feet ?? 0;
  const target = spacing / 2;
  const tipStart = half - TIP;
  let out: number;
  if (a <= feet - FOOT_HALF) out = (a * (target - FOOT_HALF)) / (feet - FOOT_HALF);
  else if (a <= feet + FOOT_HALF) out = a + (target - feet);
  else if (a <= tipStart) out = target + FOOT_HALF + ((a - feet - FOOT_HALF) * (halfSpan - TIP - (target + FOOT_HALF))) / (tipStart - feet - FOOT_HALF);
  else out = a + (halfSpan - half);
  return Math.sign(z) * out;
}

/** Rotation qui amène +Y sur `n` (normalisée), en matrice 3 × 3 (lignes). */
export function upTo(n: Vec3): [Vec3, Vec3, Vec3] {
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  const [x, y, z] = [n[0] / len, n[1] / len, n[2] / len];
  // Axe (0, 1, 0) × n = (z, 0, −x), angle acos(y) : formule de Rodrigues.
  const s = Math.hypot(z, x);
  if (s < 1e-9) return y > 0 ? [[1, 0, 0], [0, 1, 0], [0, 0, 1]] : [[1, 0, 0], [0, -1, 0], [0, 0, -1]];
  const [ux, uz] = [z / s, -x / s];
  const c = y;
  const t = 1 - c;
  return [
    [c + ux * ux * t, -uz * s, ux * uz * t],
    [uz * s, c, -ux * s],
    [uz * ux * t, ux * s, c + uz * uz * t],
  ];
}

/** Pente de la surface vers l'avant (dy/dx) d'après sa normale ; une surface presque verticale n'en a pas. */
function slopeOf(n: Vec3): number {
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  return n[1] / len < 0.2 ? 0 : -n[0] / n[1];
}

/**
 * Pose les sommets d'une pièce (x, y, z à la suite, repère de la pièce) dans le repère du véhicule
 * posé : nœud « surface » tourné sur la normale au bord de fuite, mis à la largeur utile et cintré au
 * bombé en travers et au profil en long (en avant du bord de fuite seulement : ce qui le dépasse reste
 * en porte-à-faux) ; nœud « niveau » posé aux pieds, mis à l'entraxe et à l'envergure, ses pieds
 * descendus sur la surface (plan de la normale, bombé et profil en long compris) ; pose sur rail :
 * voir fitRail (`floor` : bas de caisse d'origine, `wheels.floor` du manifeste). Rend un nouveau tableau.
 */
export function fitPositions(
  source: ArrayLike<number>,
  node: string,
  mount: PieceMount,
  poste: PiecePoste,
  option: Pick<PieceOption, 'spanFactor' | 'rise' | 'depth'>,
  floor?: number,
): Float32Array {
  if (isRailMount(mount)) return fitRail(source, mount, poste, option, floor);
  if (isLidMount(mount)) return Float32Array.from(source);
  return fitSurface(source, node, mount, poste, option);
}

function fitSurface(source: ArrayLike<number>, node: string, mount: PieceSurfaceMount, poste: PiecePoste, option: Pick<PieceOption, 'spanFactor'>): Float32Array {
  const out = new Float32Array(source.length);
  if (node === PIECE_NODES.level && mount.supports) {
    const supports: PieceSupports = mount.supports;
    const slope = slopeOf(supports.normal);
    const halfSpan = (supports.span * (option.spanFactor ?? 1)) / 2;
    const profile = supports.crown ?? mount.crown;
    const [ax, ay, az] = supports.anchor;
    for (let i = 0; i < source.length; i += 3) {
      const x = source[i] as number;
      const y = source[i + 1] as number;
      const z = spanMap(source[i + 2] as number, poste.reference, supports.spacing, halfSpan);
      out[i] = ax + x;
      out[i + 1] = ay + (y <= FOOT_BAND ? y + slope * x - crownDrop(profile, z) - bendDrop(supports.bend, x) : y);
      out[i + 2] = az + z;
    }
    return out;
  }
  const r = upTo(mount.normal);
  const k = mount.width / poste.reference.width;
  const [ax, ay, az] = mount.anchor;
  for (let i = 0; i < source.length; i += 3) {
    const x = source[i] as number;
    const y = source[i + 1] as number;
    const z = (source[i + 2] as number) * k;
    out[i] = ax + r[0][0] * x + r[0][1] * y + r[0][2] * z;
    out[i + 1] = ay + r[1][0] * x + r[1][1] * y + r[1][2] * z - crownDrop(mount.crown, z) - (x > 0 ? bendDrop(mount.bend, x) : 0);
    out[i + 2] = az + r[2][0] * x + r[2][1] * y + r[2][2] * z;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Pose sur rail (kit carrosserie) : la pièce suit une ligne de la caisse

/** Jour gardé entre le bas d'une pièce sur rail et le bas de caisse d'origine, en mètres. */
export const RAIL_CLEARANCE = 0.006;
/** Pas de la courbe lisse tendue sur les points du rail : tant de tronçons entre deux points. */
const RAIL_SUBDIVISIONS = 8;

/**
 * Points du rail complet. Pièce sur l'axe : le symétrique des points du manifeste, puis eux ; paire :
 * les points du flanc droit tels quels. Ordonnés pour que la normale sortante (haut × tangente) regarde
 * dehors : la pièce, modelée en repère direct (X dehors, Y en haut, Z le long du rail), n'est jamais
 * retournée.
 */
export function railPoints(mount: Pick<PieceRailMount, 'rail'>, mirror: boolean): VehiclePoint[] {
  const half = mount.rail;
  const full: VehiclePoint[] = mirror ? [...half] : [...half.slice(1).reverse().map(([x, y, z]): VehiclePoint => [x, y, -z]), ...half];
  const i = Math.min(Math.floor((full.length - 1) / 2), full.length - 2);
  const a = full[i] as VehiclePoint;
  const b = full[i + 1] as VehiclePoint;
  // Normale sortante en plan : (tz, −tx) ; le milieu du tronçon, vu du centre du véhicule.
  const outward = (b[2] - a[2]) * (a[0] + b[0]) - (b[0] - a[0]) * (a[2] + b[2]);
  return outward < 0 ? full.reverse() : full;
}

/** Courbe dense tendue sur les points d'un rail : points, tangentes en plan, longueurs cumulées. */
export interface RailPath {
  /** x, y, z à la suite. */
  points: Float64Array;
  /** Tangente en plan, unitaire : tx, tz à la suite. */
  tangents: Float64Array;
  /** Longueur cumulée à chaque point, en mètres. */
  lengths: Float64Array;
  length: number;
}

/** Courbe de Catmull-Rom (uniforme) par les points du rail, découpée finement. */
export function railPath(points: readonly VehiclePoint[]): RailPath {
  const m = points.length;
  const p = (i: number): VehiclePoint => {
    if (i < 0) {
      const [a, b] = [points[0] as VehiclePoint, points[1] as VehiclePoint];
      return [2 * a[0] - b[0], 2 * a[1] - b[1], 2 * a[2] - b[2]];
    }
    if (i >= m) {
      const [a, b] = [points[m - 1] as VehiclePoint, points[m - 2] as VehiclePoint];
      return [2 * a[0] - b[0], 2 * a[1] - b[1], 2 * a[2] - b[2]];
    }
    return points[i] as VehiclePoint;
  };
  const count = (m - 1) * RAIL_SUBDIVISIONS + 1;
  const out = new Float64Array(count * 3);
  let k = 0;
  for (let i = 0; i < m - 1; i += 1) {
    const [p0, p1, p2, p3] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
    for (let j = 0; j < RAIL_SUBDIVISIONS; j += 1) {
      const t = j / RAIL_SUBDIVISIONS;
      const [t2, t3] = [t * t, t * t * t];
      for (let c = 0; c < 3; c += 1) {
        const [a, b, d, e] = [p0[c] as number, p1[c] as number, p2[c] as number, p3[c] as number];
        out[k * 3 + c] = 0.5 * (2 * b + (d - a) * t + (2 * a - 5 * b + 4 * d - e) * t2 + (3 * b - a - 3 * d + e) * t3);
      }
      k += 1;
    }
  }
  const last = points[m - 1] as VehiclePoint;
  out.set(last, k * 3);
  const lengths = new Float64Array(count);
  for (let i = 1; i < count; i += 1) {
    lengths[i] = (lengths[i - 1] as number) + Math.hypot((out[i * 3] as number) - (out[i * 3 - 3] as number), (out[i * 3 + 1] as number) - (out[i * 3 - 2] as number), (out[i * 3 + 2] as number) - (out[i * 3 - 1] as number));
  }
  const tangents = new Float64Array(count * 2);
  for (let i = 0; i < count; i += 1) {
    const [a, b] = [Math.max(0, i - 1), Math.min(count - 1, i + 1)];
    const tx = (out[b * 3] as number) - (out[a * 3] as number);
    const tz = (out[b * 3 + 2] as number) - (out[a * 3 + 2] as number);
    const len = Math.hypot(tx, tz) || 1;
    tangents[i * 2] = tx / len;
    tangents[i * 2 + 1] = tz / len;
  }
  return { points: out, tangents, lengths, length: lengths[count - 1] as number };
}

/** Point du rail à l'abscisse curviligne `s` et normale sortante en plan ; au-delà des bouts, le rail se prolonge tout droit. */
export function railAt(path: RailPath, s: number, out: { x: number; y: number; z: number; nx: number; nz: number }): void {
  const { points, tangents, lengths } = path;
  const last = lengths.length - 1;
  if (s <= 0 || s >= path.length) {
    const i = s <= 0 ? 0 : last;
    const [tx, tz] = [tangents[i * 2] as number, tangents[i * 2 + 1] as number];
    const d = s <= 0 ? s : s - path.length;
    out.x = (points[i * 3] as number) + tx * d;
    out.y = points[i * 3 + 1] as number;
    out.z = (points[i * 3 + 2] as number) + tz * d;
    out.nx = tz;
    out.nz = -tx;
    return;
  }
  let [lo, hi] = [0, last];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((lengths[mid] as number) <= s) lo = mid;
    else hi = mid;
  }
  const span = (lengths[lo + 1] as number) - (lengths[lo] as number);
  const u = span > 0 ? (s - (lengths[lo] as number)) / span : 0;
  const at = (k: number) => (points[lo * 3 + k] as number) + ((points[lo * 3 + 3 + k] as number) - (points[lo * 3 + k] as number)) * u;
  out.x = at(0);
  out.y = at(1);
  out.z = at(2);
  const tx = (tangents[lo * 2] as number) * (1 - u) + (tangents[lo * 2 + 2] as number) * u;
  const tz = (tangents[lo * 2 + 1] as number) * (1 - u) + (tangents[lo * 2 + 3] as number) * u;
  const len = Math.hypot(tx, tz) || 1;
  out.nx = tz / len;
  out.nz = -tx / len;
}

/**
 * Abscisse le long du rail d'un sommet à `z` (repère de la pièce, de −width/2 à +width/2) : les bouts
 * (`reference.ends`) gardent leur longueur, le milieu s'étire ou se resserre à la longueur du rail.
 */
export function railAbscissa(z: number, reference: PiecePoste['reference'], length: number): number {
  const width = reference.width;
  const ends = Math.min(reference.ends ?? 0, length / 2 - 0.01, width / 2 - 0.01);
  const u = z + width / 2;
  if (u <= ends) return u;
  if (u >= width - ends) return length - (width - u);
  return ends + ((u - ends) * (length - 2 * ends)) / (width - 2 * ends);
}

/**
 * Pose sur rail : chaque sommet (x dehors, y en haut, z le long de la pièce) va sur le rail à son
 * abscisse (railAbscissa), écarté de x sur la normale sortante, à y du rail. Ce qui monte au-dessus du
 * rail (y > 0) se tasse si la face d'aplomb est moins haute que la pièce (`rise`) ; ce qui descend
 * dessous se tasse pour ne jamais passer sous le bas de caisse d'origine (`floor`, moins RAIL_CLEARANCE) :
 * à l'assiette la plus basse, la pièce garde la garde au sol de la caisse. Une paire (poste `mirror`)
 * se pose ainsi à droite ; la gauche est son miroir (mirrorZ).
 */
export function fitRail(source: ArrayLike<number>, mount: PieceRailMount, poste: PiecePoste, option: Pick<PieceOption, 'rise' | 'depth'>, floor?: number): Float32Array {
  const path = railPath(railPoints(mount, poste.mirror === true));
  const up = option.rise && option.rise > mount.rise ? mount.rise / option.rise : 1;
  const out = new Float32Array(source.length);
  const at = { x: 0, y: 0, z: 0, nx: 0, nz: 0 };
  for (let i = 0; i < source.length; i += 3) {
    const x = source[i] as number;
    const y = source[i + 1] as number;
    railAt(path, railAbscissa(source[i + 2] as number, poste.reference, path.length), at);
    let k = up;
    if (y < 0) k = floor === undefined || !option.depth ? 1 : Math.min(1, Math.max(0, (at.y - floor - RAIL_CLEARANCE) / option.depth));
    out[i] = at.x + x * at.nx;
    out[i + 1] = at.y + y * k;
    out[i + 2] = at.z + x * at.nz;
  }
  return out;
}

/** Symétrique gauche-droite de sommets posés (z → −z) ; l'ordre des triangles est à retourner (flipWinding). */
export function mirrorZ(positions: ArrayLike<number>): Float32Array {
  const out = Float32Array.from(positions);
  for (let i = 2; i < out.length; i += 3) out[i] = -(out[i] as number);
  return out;
}

/** Retourne l'ordre des sommets de chaque triangle (indices à la suite, trois par triangle). */
export function flipWinding<T extends { length: number; [index: number]: number }>(indices: T): T {
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const t = indices[i + 1] as number;
    indices[i + 1] = indices[i + 2] as number;
    indices[i + 2] = t;
  }
  return indices;
}

/**
 * Cadre d'un poste sur rail pour la caméra du garage (src/scene/fit.ts, fitZone) : la face regardée
 * (avant, flanc droit, arrière, d'après la normale sortante au milieu du rail), le centre et la taille
 * de la boîte qui entoure la ligne et la pièce.
 */
export function railZone(mount: Pick<PieceRailMount, 'rail'>, mirror: boolean): { face: LiveryFace; center: VehiclePoint; size: [number, number, number] } {
  const points = railPoints(mount, mirror);
  const path = railPath(points);
  const at = { x: 0, y: 0, z: 0, nx: 0, nz: 0 };
  railAt(path, path.length / 2, at);
  const face: LiveryFace = Math.abs(at.nx) >= Math.abs(at.nz) ? (at.nx > 0 ? '+x' : '-x') : at.nz > 0 ? '+z' : '-z';
  const xs = points.map((q) => q[0]);
  const ys = points.map((q) => q[1]);
  const zs = points.map((q) => q[2]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const low = Math.min(...ys);
  const along = face === '+z' || face === '-z' ? x1 - x0 : z1 - z0;
  return { face, center: [(x0 + x1) / 2, low + 0.12, (z0 + z1) / 2], size: [along + 0.2, 0.42, 0.3] };
}

/**
 * Cadre d'un poste pour la caméra du garage, s'il en a un : pièce sur rail (railZone), capot (le cadre
 * du manifeste, compartiment moteur) ; `null` : la caméra ne bouge pas (aileron).
 */
export function zoneDuPoste(mount: PieceMount, poste: Pick<PiecePoste, 'mirror'>): { face: LiveryFace; center: VehiclePoint; size: [number, number, number] } | null {
  if (isRailMount(mount)) return railZone(mount, poste.mirror === true);
  if (isLidMount(mount)) return { face: mount.frame.face, center: mount.frame.center, size: [mount.frame.size[0], mount.frame.size[1], mount.frame.size[2]] };
  return null;
}

/** Le poste du capot moteur d'un véhicule, s'il en déclare un (la pose « capot » du manifeste). */
export function posteCapot(vehicle: Pick<VehicleManifest, 'pieces'>, catalogue: PiecesCatalogue = PIECES_CATALOGUE): { poste: PiecePoste; mount: PieceLidMount } | null {
  for (const poste of postesOf(vehicle, catalogue)) {
    const mount = mountOf(vehicle, poste.id);
    if (mount && isLidMount(mount)) return { poste, mount };
  }
  return null;
}

/** Ce que le build pose sur le capot : l'origine (`null`), la variante vitrée ou plus de capot. */
export function capotDuBuild(vehicle: Pick<VehicleManifest, 'pieces'>, build: Build | undefined, catalogue: PiecesCatalogue = PIECES_CATALOGUE): CapotStyle | null {
  const found = posteCapot(vehicle, catalogue);
  if (!found) return null;
  const style = resolvePiece(vehicle, build, found.poste.id, catalogue)?.option?.style;
  return style === 'vitre' || style === 'depose' ? style : null;
}
