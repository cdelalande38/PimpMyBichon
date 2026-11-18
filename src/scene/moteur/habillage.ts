// Habillage du moteur, partagé par l'établi (./Etabli.tsx : un matériau par morceau, la pièce choisie
// surlignée, la vue éclatée) et par le moteur posé dans le véhicule (src/scene/vehicle/moteur.ts : un
// seul maillage, les traitements portés par les sommets). Une seule façon de lire le fichier d'une
// famille, de reconnaître chaque morceau (sa pièce, sa matière d'origine ou son rôle) et de dire son
// rendu pour un build (traitement et couleur de sa pièce, sinon sa matière, sinon son rôle) ; une seule
// règle pour l'option posée d'un échange (filtres à air). Aucun identifiant de véhicule ni de famille.

import { Mesh, MeshPhysicalMaterial, type Material, type MeshStandardMaterial, type Object3D } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MATERIAL_ROLES, type MaterialRole } from '../../data/materialRoles.ts';
import {
  ENGINES_DIR,
  fichierMoteur,
  matiereById,
  noeudsFamille,
  PART_PREFIX,
  resolveEchange,
  resolveTraitement,
  SUPPORT_NODE,
  type MoteurFamille,
  type MoteurMatiere,
  type TraitementResolu,
} from '../../data/moteurs.ts';
import type { Build } from '../../data/vehicleTypes.ts';

const BASE = import.meta.env.BASE_URL;
const loader = new GLTFLoader();
const sources = new Map<string, Promise<GLTF>>();

/** Charge (une fois par séance) le moteur d'une famille. Un échec s'oublie : le prochain appel réessaie. */
export function loadEngine(famille: string): Promise<GLTF> {
  const url = `${BASE}${ENGINES_DIR}${fichierMoteur(famille)}`;
  let promise = sources.get(url);
  if (!promise) {
    promise = loader.loadAsync(url);
    promise.catch(() => sources.delete(url));
    sources.set(url, promise);
  }
  return promise;
}

/** Nom d'origine du nœud du GLB qui porte cet objet (GLTFLoader le garde dans userData.name). */
export function nodeOf(object: Object3D): string | null {
  for (let node: Object3D | null = object; node; node = node.parent) {
    const name = node.userData.name as unknown;
    if (typeof name === 'string' && (name.startsWith(PART_PREFIX) || name === SUPPORT_NODE)) return name;
  }
  return null;
}

/** Ce qu'est un morceau du moteur : le nœud qui le porte (sans part_ ; `null` : le support), sa matière ou son rôle. */
export interface MorceauType {
  node: string | null;
  matiere: MoteurMatiere | null;
  role: MaterialRole | null;
}

/** Reconnaît un maillage du fichier : sa pièce (nœud), sa matière d'origine (paint_<matière>) ou son rôle. */
export function morceauDe(mesh: Mesh): MorceauType {
  const node = nodeOf(mesh);
  const materialName = (mesh.material as Material).name;
  const matiere = materialName.startsWith('paint_') ? (matiereById(materialName) ?? null) : null;
  const role = matiere ? null : (MATERIAL_ROLES.find((item) => item.id === materialName) ?? MATERIAL_ROLES.find((item) => item.id === 'black') ?? null);
  return { node: node && node !== SUPPORT_NODE ? node.slice(PART_PREFIX.length) : null, matiere, role };
}

/** Rendu d'un morceau : les réglages d'un matériau physique. */
export interface Look {
  color: string;
  metalness: number;
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  /** Part du reflet de l'environnement, avant celle de l'ambiance. */
  envMapIntensity: number;
}

type Noeuds = ReturnType<typeof noeudsFamille>;

/** Traitement et couleur de chaque pièce de la famille dans ce build. */
export function looksOf(famille: MoteurFamille, build: Build | undefined): Map<string, TraitementResolu> {
  return new Map<string, TraitementResolu>(famille.pieces.map((piece) => [piece.id, resolveTraitement(piece, build)]));
}

/** La pièce de la famille qui porte un morceau ; `null` : le support, ou un nœud inconnu. */
export function pieceDe(morceau: MorceauType, known: Noeuds): string | null {
  return morceau.node ? (known.get(morceau.node)?.piece ?? null) : null;
}

/**
 * Rendu d'un morceau : le traitement de sa pièce (couleur choisie comprise) si sa matière le prend,
 * sinon sa matière d'origine, sinon son rôle ; `null` : rien à régler.
 */
export function lookOf(morceau: MorceauType, known: Noeuds, looks: ReadonlyMap<string, TraitementResolu>): Look | null {
  const { matiere, role } = morceau;
  const piece = pieceDe(morceau, known);
  const resolved = piece ? looks.get(piece) : undefined;
  const rendu = matiere?.traitable ? resolved?.traitement.rendu : null;
  if (rendu) return { ...rendu, color: resolved?.couleur ?? rendu.color };
  if (matiere) return { color: matiere.color, metalness: matiere.metalness, roughness: matiere.roughness, clearcoat: 0, clearcoatRoughness: 0, envMapIntensity: 1 };
  if (role) return { color: role.color, metalness: role.metalness, roughness: role.roughness, clearcoat: 0, clearcoatRoughness: 0, envMapIntensity: role.envMapIntensity };
  return null;
}

/** Part du reflet d'un rendu : les métaux prennent celle de l'ambiance, comme la carrosserie (src/data/materialRoles.ts). */
export function envOf(look: Look, bodyEnv: number): number {
  return look.envMapIntensity * (look.metalness >= 0.5 ? bodyEnv : 1);
}

/** Règle un matériau : couleur, métal, rugosité, vernis (matériau physique seulement), reflet. */
export function setLook(material: MeshStandardMaterial, look: Look, bodyEnv: number): void {
  material.color.set(look.color);
  material.metalness = look.metalness;
  material.roughness = look.roughness;
  material.envMapIntensity = envOf(look, bodyEnv);
  if (material instanceof MeshPhysicalMaterial) {
    material.clearcoat = look.clearcoat;
    material.clearcoatRoughness = look.clearcoatRoughness;
  }
}

/** Option posée de chaque pièce qui s'échange (`null` : aucune). */
export function optionsPosees(famille: MoteurFamille, build: Build | undefined): Map<string, string | null> {
  return new Map(famille.pieces.filter((piece) => piece.echange).map((piece) => [piece.id, resolveEchange(piece, build)?.id ?? null]));
}

/** Un nœud de pièce se montre-t-il ? Oui, sauf l'option d'un échange qui n'est pas celle posée. */
export function noeudMontre(info: { piece: string; option: string | null } | undefined, posees: ReadonlyMap<string, string | null>): boolean {
  return !info || info.option === null || posees.get(info.piece) === info.option;
}
