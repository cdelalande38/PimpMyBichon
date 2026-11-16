// Roues du véhicule à l'écran (§ 5.4) : la jante et le pneu choisis (catalogue des roues partagées,
// src/data/wheels.ts), posés sur les ancres roue_* du modèle, à la cote choisie ; et l'assiette : la
// caisse monte du rayon gagné et descend de la descente choisie, essieu par essieu (elle bascule si
// l'avant et l'arrière ne changent pas pareil). Les roues restent au sol, la caisse bouge.
// Partagé par le garage (VehicleModel.tsx) et la sortie de nuit (src/drive/scene/vehicule.tsx).
//
// Les fichiers des roues se chargent hors de Suspense (cache de promesses) : au changement de jante,
// l'ancienne reste montée jusqu'à l'arrivée de la nouvelle, le véhicule ne disparaît jamais.

import { useEffect, useState } from 'react';
import { BufferGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, type Material, type MeshPhysicalMaterial, type Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { create } from 'zustand';
import { MATERIAL_ROLES } from '../../data/materialRoles.ts';
import type { VehicleManifest, VehiclePoint } from '../../data/vehicleTypes.ts';
import { rimFile, tireFile, WHEEL_CATALOGUE, WHEELS_DIR, wheelKind, type AxleWheel, type ResolvedWheels, type WheelReference } from '../../data/wheels.ts';

/** Ancre d'une roue dans le repère du véhicule posé (nœud roue_* du modèle, rangé à part de la caisse). */
export interface WheelAnchor {
  node: Object3D;
  /** Position et rotation d'origine du nœud (dans le groupe des roues). */
  base: { x: number; y: number; z: number };
  front: boolean;
  /** Vrai : le nœud porte déjà sa roue (modèle adapté) ; l'atelier n'y pose rien. */
  own: boolean;
}

/** Ce que `prepare` sépare de la caisse pour les roues et l'assiette. */
export interface WheelRig {
  /** La caisse : monte, descend et bascule avec l'assiette. */
  body: Group;
  /** Les roues et ce qui reste au sol (béquille) : jamais déplacés par l'assiette. */
  ground: Group;
  anchors: WheelAnchor[];
}

const BASE = import.meta.env.BASE_URL;
const loader = new GLTFLoader();
const sources = new Map<string, Promise<GLTF>>();

/** Adresse d'un fichier de roue. */
export function wheelUrl(file: string): string {
  return `${BASE}${WHEELS_DIR}${file}`;
}

/** Charge (une fois par séance) un fichier de roue. Un échec s'oublie : le prochain appel réessaie. */
export function loadWheelSource(file: string): Promise<GLTF> {
  const url = wheelUrl(file);
  let promise = sources.get(url);
  if (!promise) {
    promise = loader.loadAsync(url);
    promise.catch(() => sources.delete(url));
    sources.set(url, promise);
  }
  return promise;
}

/** Matériaux des rôles (chrome, alu, noir, caoutchouc), un par rôle pour toutes les roues. */
const roleMaterials = new Map<string, MeshStandardMaterial>();
function roleMaterial(name: string): MeshStandardMaterial {
  const id = MATERIAL_ROLES.some((role) => role.id === name) ? name : 'black';
  let material = roleMaterials.get(id);
  if (!material) {
    const role = MATERIAL_ROLES.find((item) => item.id === id);
    material = new MeshStandardMaterial({ color: role?.color ?? '#121214', metalness: role?.metalness ?? 0, roughness: role?.roughness ?? 0.6 });
    material.envMapIntensity = role?.envMapIntensity ?? 1;
    material.name = id;
    roleMaterials.set(id, material);
  }
  return material;
}

/**
 * Recale un pneu modelé à la cote de référence sur la cote de l'essieu : le talon suit le rayon de
 * la jante, le flanc s'étire à la hauteur choisie, la largeur suit le pneu. Nouvelle géométrie.
 */
export function remapTire(source: BufferGeometry, ref: WheelReference, axle: Pick<AxleWheel, 'rim' | 'outer' | 'width'>): BufferGeometry {
  const geometry = source.clone();
  const position = geometry.getAttribute('position');
  const stretch = (axle.outer - axle.rim) / (ref.outer - ref.rim);
  const sz = axle.width / 1000 / ref.width;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const rho = Math.hypot(x, y);
    const next = rho <= ref.rim ? axle.rim - (ref.rim - rho) : axle.rim + (rho - ref.rim) * stretch;
    const k = rho > 1e-9 ? next / rho : 1;
    position.setXYZ(i, x * k, y * k, position.getZ(i) * sz);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Rang de dessin des pièces opaques du véhicule (comme VehicleModel.tsx). */
const VEHICLE_RENDER_ORDER = -2;

function meshesOf(gltf: GLTF): Mesh[] {
  const found: Mesh[] = [];
  gltf.scene.traverse((object) => {
    if (object instanceof Mesh) found.push(object);
  });
  return found;
}

/** Roues posées sur un véhicule : à retirer (et libérer) au prochain changement. */
export interface MountedWheels {
  /** Pose de la caisse qui en résulte. */
  pose: BodyPose;
  /** Nœuds qui tournent (les ancres) et leur rayon, pour la sortie de nuit. */
  spins: Array<{ node: Object3D; radius: number }>;
  dispose: () => void;
}

interface MountOptions {
  rim: GLTF;
  tire: GLTF;
  /** Matériau de la zone de peinture des jantes. */
  rimPaint: MeshPhysicalMaterial | undefined;
  /** Matériau de la marque du pneu (liseré, flanc blanc, lettres), à la couleur du build. */
  mark: MeshStandardMaterial;
}

/** Matériau de la marque du pneu, à la couleur donnée. */
export function createMarkMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: '#efece2', roughness: 0.7, metalness: 0 });
  material.name = 'paint_flanc';
  material.envMapIntensity = 0.5;
  return material;
}

/**
 * Pose la jante et le pneu sur chaque ancre, à la cote de son essieu, et règle l'assiette (caisse et
 * hauteur des roues). Sans `parts` (modèle qui garde ses roues), règle l'assiette seule.
 */
export function mountWheels(rig: WheelRig, vehicle: Pick<VehicleManifest, 'kind'>, resolved: ResolvedWheels, parts: MountOptions | null): MountedWheels {
  const added: Object3D[] = [];
  const owned: BufferGeometry[] = [];
  const spins: MountedWheels['spins'] = [];
  const ref = WHEEL_CATALOGUE.reference[wheelKind(vehicle)];
  const tireGeometry = new Map<'front' | 'rear', Array<[BufferGeometry, Material]>>();
  const material = (name: string): Material => {
    if (name.startsWith('paint_jantes')) return parts?.rimPaint ?? roleMaterial('alu');
    if (name.startsWith('paint_flanc')) return parts?.mark ?? roleMaterial('black');
    return roleMaterial(name.split('.')[0] ?? name);
  };
  for (const anchor of rig.anchors) {
    const axle = anchor.front ? resolved.front : resolved.rear;
    if (anchor.own || !resolved.swap || !axle || !parts) {
      anchor.node.position.set(anchor.base.x, anchor.base.y, anchor.base.z);
      spins.push({ node: anchor.node, radius: Math.max(0.1, anchor.base.y) });
      continue;
    }
    // Centre de la roue à son rayon au-dessus du sol : la roue touche le sol, quelle que soit sa taille.
    anchor.node.position.set(anchor.base.x, axle.outer, anchor.base.z);
    const wheel = new Group();
    wheel.name = 'roue_posee';
    const rim = new Group();
    rim.scale.set(axle.rim / ref.rim, axle.rim / ref.rim, axle.width / 1000 / ref.width);
    for (const mesh of meshesOf(parts.rim)) {
      const copy = new Mesh(mesh.geometry, material((mesh.material as Material).name));
      copy.renderOrder = VEHICLE_RENDER_ORDER;
      rim.add(copy);
    }
    const key = anchor.front ? 'front' : 'rear';
    let tires = tireGeometry.get(key);
    if (!tires) {
      tires = meshesOf(parts.tire).map((mesh) => {
        const geometry = remapTire(mesh.geometry, ref, axle);
        owned.push(geometry);
        return [geometry, material((mesh.material as Material).name)] as [BufferGeometry, Material];
      });
      tireGeometry.set(key, tires);
    }
    for (const [geometry, mat] of tires) {
      const copy = new Mesh(geometry, mat);
      copy.renderOrder = VEHICLE_RENDER_ORDER;
      wheel.add(copy);
    }
    wheel.add(rim);
    anchor.node.add(wheel);
    added.push(wheel);
    spins.push({ node: anchor.node, radius: axle.outer });
  }
  const pose = poseBody(rig, resolved);
  return {
    pose,
    spins,
    dispose: () => {
      for (const object of added) object.removeFromParent();
      for (const geometry of owned) geometry.dispose();
    },
  };
}

/** Pose de la caisse d'un véhicule : montée au milieu de l'empattement (m) et bascule (rad, autour de Z). */
export interface BodyPose {
  y: number;
  pitch: number;
}

/**
 * Pose de la caisse de chaque véhicule posé, pour ce qui vit dans son repère sans être dans son
 * modèle : la vue intérieure (œil et regard) et l'habitacle allumé (ciel étoilé, cadrans).
 */
export const useBodyPose = create<{ poses: Record<string, BodyPose>; setPose: (vehicle: string, pose: BodyPose) => void }>()((set) => ({
  poses: {},
  setPose: (vehicle, pose) =>
    set((state) => {
      const old = state.poses[vehicle];
      if (old && Math.abs(old.y - pose.y) < 1e-6 && Math.abs(old.pitch - pose.pitch) < 1e-7) return state;
      return { poses: { ...state.poses, [vehicle]: pose } };
    }),
}));

export const STILL_BODY: Readonly<BodyPose> = Object.freeze({ y: 0, pitch: 0 });

/** Roues posées d'un véhicule préparé (clé : sa racine) : tampon de pose et nœuds qui tournent. */
export interface WheelMount {
  stamp: number;
  spins: ReadonlyArray<{ node: Object3D; radius: number }>;
}

export const useWheelMounts = create<{ mounts: Record<string, WheelMount>; publish: (key: string, spins: WheelMount['spins'] | null) => void }>()((set) => ({
  mounts: {},
  publish: (key, spins) =>
    set((state) => {
      const mounts = { ...state.mounts };
      if (spins === null) delete mounts[key];
      else mounts[key] = { stamp: (state.mounts[key]?.stamp ?? 0) + 1, spins };
      return { mounts };
    }),
}));

/** Un point du repère du véhicule d'origine, porté par la caisse posée (assiette, roues). */
export function bodyPoint(point: VehiclePoint, pose: BodyPose): [number, number, number] {
  const [x, y, z] = point;
  const c = Math.cos(pose.pitch);
  const s = Math.sin(pose.pitch);
  return [x * c - y * s, x * s + y * c + pose.y, z];
}

/** Assiette : la caisse monte de `lift` à chaque essieu et bascule entre les deux. */
export function poseBody(rig: WheelRig, resolved: ResolvedWheels): BodyPose {
  const front = rig.anchors.filter((anchor) => anchor.front);
  const rear = rig.anchors.filter((anchor) => !anchor.front);
  const avg = (list: WheelAnchor[]) => list.reduce((sum, anchor) => sum + anchor.base.x, 0) / Math.max(1, list.length);
  const xf = front.length > 0 ? avg(front) : 1;
  const xr = rear.length > 0 ? avg(rear) : -1;
  const { front: lf, rear: lr } = resolved.lift;
  const span = xf - xr || 1;
  rig.body.rotation.z = Math.atan2(lf - lr, span);
  rig.body.position.y = lr + ((lf - lr) * (0 - xr)) / span;
  rig.body.updateMatrixWorld(true);
  return { y: rig.body.position.y, pitch: rig.body.rotation.z };
}

/**
 * Au garage, les roues ne tournent pas : leurs pièces (et celles qui restent au sol) sont fusionnées
 * par matériau, comme la caisse (budget d'appels de dessin du § 8 : six appels pour quatre roues au
 * lieu de vingt-quatre). Les pièces d'origine restent, cachées. Rend de quoi tout défaire.
 */
export function mergeGround(rig: WheelRig): () => void {
  rig.ground.updateMatrixWorld(true);
  const toGround = new Matrix4().copy(rig.ground.matrixWorld).invert();
  const groups = new Map<string, Mesh[]>();
  rig.ground.traverseVisible((object) => {
    if (!(object instanceof Mesh) || Array.isArray(object.material)) return;
    const { geometry } = object;
    const signature = [
      (object.material as Material).uuid,
      geometry.index ? 'indexé' : 'libre',
      Object.keys(geometry.attributes).sort().join(','),
      Object.keys(geometry.morphAttributes).length,
    ].join('|');
    groups.set(signature, [...(groups.get(signature) ?? []), object]);
  });
  const merged = new Group();
  merged.name = 'roues_fusionnees';
  const owned: BufferGeometry[] = [];
  const hidden: Mesh[] = [];
  const local = new Matrix4();
  for (const parts of groups.values()) {
    const first = parts[0];
    if (!first || parts.length < 2) continue;
    const geometries = parts.map((part) => part.geometry.clone().applyMatrix4(local.multiplyMatrices(toGround, part.matrixWorld)));
    const geometry = mergeGeometries(geometries, false);
    for (const item of geometries) item.dispose();
    if (!geometry) continue;
    owned.push(geometry);
    const mesh = new Mesh(geometry, first.material);
    mesh.name = `fusion_${(first.material as Material).name}`;
    mesh.renderOrder = first.renderOrder;
    merged.add(mesh);
    for (const part of parts) {
      part.visible = false;
      hidden.push(part);
    }
  }
  rig.ground.add(merged);
  return () => {
    merged.removeFromParent();
    for (const geometry of owned) geometry.dispose();
    for (const part of hidden) part.visible = true;
  };
}

/** Toutes les roues d'un genre, chargées en tâche de fond : changer de jante ne fait plus attendre. */
export function preloadWheels(vehicle: Pick<VehicleManifest, 'kind'>): void {
  const kind = wheelKind(vehicle);
  for (const rim of WHEEL_CATALOGUE.rims) if (rim.kind === kind) void loadWheelSource(rimFile(rim.id)).catch(() => undefined);
  for (const tire of WHEEL_CATALOGUE.tires) void loadWheelSource(tireFile(tire.id, kind)).catch(() => undefined);
}

export interface WheelSources {
  rim: GLTF;
  tire: GLTF;
}

/**
 * Jante et pneu chargés, hors de Suspense : pendant le chargement d'un nouveau choix, le précédent
 * reste rendu ; `null` avant le premier chargement, ou si les fichiers manquent (roues absentes,
 * caisse seule : rien ne casse).
 */
export function useWheelSources(files: { rim: string; tire: string } | null): WheelSources | null {
  const [loaded, setLoaded] = useState<WheelSources | null>(null);
  const rimName = files?.rim ?? null;
  const tireName = files?.tire ?? null;
  useEffect(() => {
    if (rimName === null || tireName === null) return;
    let live = true;
    Promise.all([loadWheelSource(rimName), loadWheelSource(tireName)]).then(
      ([rim, tire]) => {
        if (live) setLoaded({ rim, tire });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [rimName, tireName]);
  return files ? loaded : null;
}
