/// <reference types="vite/client" />
// Pièces montées sur la caisse (§ 5.4, § 6, demande du 17 novembre 2026) : un système de postes
// (aileron aujourd'hui ; sorties d'échappement, lame avant, jupes ensuite) piloté par les données.
// Le catalogue partagé, public/assets/shared/pieces/catalogue.json, dit les postes et leurs options
// (fabriquées par npm run vehicles:build, tools/vehicles/pieces.mjs) ; le manifeste d'un véhicule dit,
// poste par poste (section `pieces`), où la pièce se pose et ce qu'il accepte. Un poste absent du
// manifeste n'existe pas pour ce véhicule. Ce fichier résout, sans rien connaître d'aucun véhicule,
// l'option posée (une option inconnue ou non permise retombe sur l'origine), sa peinture, et la pose
// de chaque sommet d'une pièce dans le repère du véhicule (pur, testé sans navigateur).
//
// Dans le build : parts.<poste> (identifiant d'option ; l'origine n'est pas écrite), partPaints.<poste>
// (couleur propre ; absente : la peinture de la carrosserie).

import type { ArticleBoutique } from './boutique.ts';
import { FINISHES } from './finishes.ts';
import type { Build, CrownProfile, Paint, PieceMount, PieceSupports, VehicleManifest } from './vehicleTypes.ts';

export interface PieceOption {
  id: string;
  /** Famille de modelage (tools/vehicles/pieces.mjs). */
  style: string;
  /** « surface » : épouse la surface au bord de fuite ; « supports » : aileron de niveau sur pieds. */
  mount: 'surface' | 'supports';
  label: string;
  /** Le nom avec son article, pour les phrases : « l’aileron haut ». */
  phrase: string;
  hint?: string;
  /** Envergure : part de celle du manifeste (aileron démesuré : plus large). Absente : 1. */
  spanFactor?: number;
  /** Silhouette de l'option (tracé SVG, boîte 48 × 30), posée sur celle du poste. */
  picto: string;
}

export interface PiecePoste {
  id: string;
  label: string;
  /** Fin de phrase après le nom d'un véhicule qui n'a pas ce poste. */
  absent: string;
  /** Nom du réglage de couleur propre : « Couleur de l’aileron ». */
  colorLabel: string;
  /** L'absence de pièce : toujours permise, toujours libre. */
  none: { id: string; label: string; hint?: string; phrase: string };
  /** Cotes de modelage des options : largeur, milieu des pieds (z), en mètres. */
  reference: { width: number; feet: number };
  /** Silhouette commune (tracé SVG, boîte 48 × 30) : l'arrière d'une caisse. */
  picto: string;
  options: readonly PieceOption[];
}

export interface PiecesCatalogue {
  postes: readonly PiecePoste[];
}

/** Dossier des pièces montées, sous le socle de l'app. */
export const PIECES_DIR = 'assets/shared/pieces/';

/** Nœuds d'un fichier de pièce (mêmes noms que tools/vehicles/pieces.mjs, NODES). */
export const PIECE_NODES = Object.freeze({ surface: 'surface', level: 'niveau' });

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
    const ref = poste.reference;
    if (!isObject(ref) || typeof ref.width !== 'number' || typeof ref.feet !== 'number' || ref.feet <= FOOT_HALF || ref.feet + FOOT_HALF >= ref.width / 2 - TIP) {
      problems.push(`${at}.reference doit porter width et feet (milieu des pieds, entre ${FOOT_HALF} m et la demi-largeur moins ${FOOT_HALF + TIP} m)`);
    }
    const options = Array.isArray(poste.options) ? poste.options : [];
    if (options.length === 0) problems.push(`${at}.options : au moins une option`);
    const seen = new Set<string>(isObject(none) && typeof none.id === 'string' ? [none.id] : []);
    options.forEach((option: unknown, j) => {
      const o = `${at}.options[${j}]`;
      if (
        !isObject(option) ||
        typeof option.id !== 'string' ||
        !ID.test(option.id) ||
        !text(option.style) ||
        (option.mount !== 'surface' && option.mount !== 'supports') ||
        !text(option.label) ||
        !text(option.phrase) ||
        !text(option.picto)
      ) {
        problems.push(`${o} doit porter id, style, mount (surface ou supports), label, phrase et picto`);
        return;
      }
      if (seen.has(option.id)) problems.push(`${o}.id « ${option.id} » en double (ou égal à none.id)`);
      seen.add(option.id);
      if (option.spanFactor !== undefined && !(typeof option.spanFactor === 'number' && option.spanFactor >= 1 && option.spanFactor <= 1.5)) problems.push(`${o}.spanFactor doit être un facteur de 1 à 1,5`);
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

/** Options qu'un véhicule accepte sur un poste (sans l'absence de pièce) : celles du manifeste, que la surface permet. */
export function optionsFor(vehicle: Pick<VehicleManifest, 'pieces'>, poste: string, catalogue: PiecesCatalogue = PIECES_CATALOGUE): PieceOption[] {
  const mount = mountOf(vehicle, poste);
  const item = posteById(poste, catalogue);
  if (!mount || !item) return [];
  return item.options.filter((option) => (!mount.options || mount.options.includes(option.id)) && (option.mount === 'surface' || mount.supports !== undefined));
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
  const feet = reference.feet;
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
 * descendus sur la surface (plan de la normale, bombé et profil en long compris). Rend un nouveau tableau.
 */
export function fitPositions(source: ArrayLike<number>, node: string, mount: PieceMount, poste: PiecePoste, option: Pick<PieceOption, 'spanFactor'>): Float32Array {
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

