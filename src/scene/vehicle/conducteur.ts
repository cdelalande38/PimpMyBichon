// Le conducteur à bord (placeholder_conducteur) : le fichier de sa tenue (catalogue partagé,
// src/data/conducteur.ts ; casquette en voiture, casque à moto) devient un maillage articulé, une
// passe de rendu par famille de matières (la couleur de chaque matière passe dans les sommets :
// quatre appels de dessin au plus), lié à un squelette d'os three. Il s'assoit dans la caisse sur
// les ancres du véhicule (src/scene/vehicle/conducteur-pose.ts) et suit l'assiette et le roulis.
// Utilisé par la sortie de nuit (src/drive/scene/vehicule.tsx), qui le fait vivre en roulant.
//
// Les mesures du véhicule (assise du siège, volant, plancher, tablier, pavillon) se prennent au
// rayon dans le modèle posé, comme l'œil de la vue intérieure (src/scene/fit.ts) : les mêmes
// fonctions servent aux tests (tests/unit/conducteur-places.test.ts).

import { useEffect, useMemo, useState } from 'react';
import {
  Bone,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Quaternion,
  Raycaster,
  Skeleton,
  SkinnedMesh,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRIVER_CATALOGUE, DRIVER_DIR, DRIVER_POSE, driverFile, driverSpecOf, outfitFor, type DriverCatalogue, type Vec3 } from '../../data/conducteur.ts';
import { INTERIOR_CATALOGUE } from '../../data/habitacle.ts';
import { placeOf } from '../../data/vehicles.ts';
import type { VehicleManifest } from '../../data/vehicleTypes.ts';
import { DEFAULT_SEAT, seatMetrics } from '../fit.ts';
import { localRotations, skeletonOf, solvePose, STILL_MOTION, type DriverMotion, type DriverPose, type DriverSkeleton, type Seating } from './conducteur-pose.ts';

const loader = new GLTFLoader();
const sources = new Map<string, Promise<GLTF>>();

/** Charge (une fois par séance) le fichier d'une tenue. Un échec s'oublie : le prochain appel réessaie. */
export function loadDriverSource(file: string): Promise<GLTF> {
  const url = `${import.meta.env.BASE_URL}${DRIVER_DIR}${file}`;
  let promise = sources.get(url);
  if (!promise) {
    promise = loader.loadAsync(url);
    promise.catch(() => sources.delete(url));
    sources.set(url, promise);
  }
  return promise;
}

/** Le conducteur monté : racine (à poser dans la caisse), os, maillages par passe. */
export interface DriverRig {
  root: Group;
  skeleton: DriverSkeleton;
  bones: Bone[];
  /** Os de forme (un par os) : la peau y est liée ; un os de forme écrasé cache sa pièce. */
  shapes: Bone[];
  meshes: SkinnedMesh[];
  catalogue: DriverCatalogue;
  dispose(): void;
}

/** Poids de chaque os d'une chaîne pour un point au repos : fondu linéaire autour des articulations. */
export function chainWeights(sk: DriverSkeleton, chain: readonly string[], blend: number, p: Vector3): Array<[number, number]> {
  const indices = chain.map((id) => sk.index[id] as number);
  if (indices.length === 1) return [[indices[0] as number, 1]];
  const j0 = sk.rest[indices[0] as number] as Vector3;
  const last = sk.rest[indices[indices.length - 1] as number] as Vector3;
  const axis = last.clone().sub(j0).normalize();
  const s = p.clone().sub(j0).dot(axis);
  const bounds = indices.slice(1).map((i) => (sk.rest[i] as Vector3).clone().sub(j0).dot(axis));
  let k = 0;
  while (k < bounds.length && s > (bounds[k] as number)) k += 1;
  // Fondu avec l'os voisin le plus proche de son articulation.
  const below = k > 0 ? s - (bounds[k - 1] as number) : Infinity;
  const above = k < bounds.length ? (bounds[k] as number) - s : Infinity;
  if (below < blend && below <= above) {
    const w = 0.5 + (0.5 * below) / blend;
    return [[indices[k] as number, w], [indices[k - 1] as number, 1 - w]];
  }
  if (above < blend) {
    const w = 0.5 + (0.5 * above) / blend;
    return [[indices[k] as number, w], [indices[k + 1] as number, 1 - w]];
  }
  return [[indices[k] as number, 1]];
}

/** Monte le conducteur d'un fichier de tenue lu (scène glTF). */
export function buildDriverRig(scene: Object3D, catalogue: DriverCatalogue = DRIVER_CATALOGUE): DriverRig {
  const sk = skeletonOf(catalogue);
  const root = new Group();
  root.name = 'conducteur';
  const bones = sk.ids.map((id, i) => {
    const bone = new Bone();
    bone.name = id;
    bone.position.copy(sk.offsets[i] as Vector3);
    return bone;
  });
  const shapes = sk.ids.map((id, i) => {
    const shape = new Bone();
    shape.name = `${id}_forme`;
    (bones[i] as Bone).add(shape);
    return shape;
  });
  bones.forEach((bone, i) => {
    const p = sk.parent[i] as number;
    if (p < 0) root.add(bone);
    else (bones[p] as Bone).add(bone);
  });
  root.updateMatrixWorld(true);

  // Pièces du fichier, rangées par passe : position, normale, couleur (linéaire), os et poids.
  type Bucket = { positions: number[]; normals: number[]; colors: number[]; joints: number[]; weights: number[]; indices: number[] };
  const buckets = new Map<string, Bucket>();
  const passOf = new Map<string, string>();
  for (const pass of catalogue.passes) for (const name of pass.materials) passOf.set(name, pass.id);
  scene.updateMatrixWorld(true);
  const inverse = new Matrix4().copy(scene.matrixWorld).invert();
  const p = new Vector3();
  const nrm = new Vector3();
  scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    let node: Object3D | null = object;
    while (node && !catalogue.nodes[node.name]) node = node.parent;
    const chain = node ? catalogue.nodes[node.name] : undefined;
    if (!chain) return;
    const material = object.material as MeshStandardMaterial;
    const passId = passOf.get(material.name.split('.')[0] ?? material.name);
    if (!passId) return;
    const bucket = buckets.get(passId) ?? { positions: [], normals: [], colors: [], joints: [], weights: [], indices: [] };
    buckets.set(passId, bucket);
    const toRest = new Matrix4().multiplyMatrices(inverse, object.matrixWorld);
    const normalMatrix = new Matrix4().extractRotation(toRest);
    const geometry = object.geometry as BufferGeometry;
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const color = material.color ?? new Color(1, 1, 1);
    const base = bucket.positions.length / 3;
    for (let i = 0; i < position.count; i += 1) {
      p.fromBufferAttribute(position, i).applyMatrix4(toRest);
      bucket.positions.push(p.x, p.y, p.z);
      if (normal) nrm.fromBufferAttribute(normal, i).applyMatrix4(normalMatrix).normalize();
      else nrm.set(0, 1, 0);
      bucket.normals.push(nrm.x, nrm.y, nrm.z);
      bucket.colors.push(color.r, color.g, color.b);
      const weights = chainWeights(sk, chain, catalogue.blend, p);
      for (let k = 0; k < 4; k += 1) {
        bucket.joints.push(weights[k]?.[0] ?? 0);
        bucket.weights.push(weights[k]?.[1] ?? 0);
      }
    }
    const index = geometry.getIndex();
    if (index) for (let i = 0; i < index.count; i += 1) bucket.indices.push(base + index.getX(i));
    else for (let i = 0; i < position.count; i += 1) bucket.indices.push(base + i);
  });

  const skeleton = new Skeleton(shapes);
  const meshes: SkinnedMesh[] = [];
  for (const pass of catalogue.passes) {
    const bucket = buckets.get(pass.id);
    if (!bucket || bucket.indices.length === 0) continue;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(bucket.positions), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(bucket.normals), 3));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(bucket.colors), 3));
    geometry.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(bucket.joints), 4));
    geometry.setAttribute('skinWeight', new BufferAttribute(new Float32Array(bucket.weights), 4));
    const vertices = bucket.positions.length / 3;
    geometry.setIndex(new BufferAttribute(vertices < 65536 ? new Uint16Array(bucket.indices) : new Uint32Array(bucket.indices), 1));
    const params = { vertexColors: true, roughness: pass.roughness, metalness: pass.metalness, envMapIntensity: pass.envMapIntensity ?? 1 };
    const material = pass.clearcoat ? new MeshPhysicalMaterial({ ...params, clearcoat: pass.clearcoat, clearcoatRoughness: 0.08 }) : new MeshStandardMaterial(params);
    material.name = `conducteur_${pass.id}`;
    const mesh = new SkinnedMesh(geometry, material);
    mesh.name = `conducteur_${pass.id}`;
    // Posé loin de son repos : sa boîte de repos ne vaut plus pour l'élagage.
    mesh.frustumCulled = false;
    root.add(mesh);
    mesh.bind(skeleton);
    meshes.push(mesh);
  }
  return {
    root,
    skeleton: sk,
    bones,
    shapes,
    meshes,
    catalogue,
    dispose() {
      for (const mesh of meshes) {
        mesh.geometry.dispose();
        (mesh.material as Material).dispose();
      }
      skeleton.dispose();
      root.removeFromParent();
    },
  };
}

const work: Quaternion[] = [];

/** Pose les os d'après la pose calculée (repère de la caisse, où la racine est posée). */
export function applyPose(rig: DriverRig, pose: DriverPose): void {
  const local = localRotations(rig.skeleton, pose, work.length === rig.bones.length ? work : (work.splice(0, work.length, ...rig.bones.map(() => new Quaternion())), work));
  rig.bones.forEach((bone, i) => {
    bone.quaternion.copy(local[i] as Quaternion);
    if (rig.skeleton.parent[i] === -1) bone.position.copy(pose.joints[i] as Vector3);
  });
  rig.root.updateMatrixWorld(true);
}

/** Cache (ou montre) la tête et le buste : la caméra est à l'œil du conducteur. */
export function hideForCockpit(rig: DriverRig, hidden: boolean): void {
  for (const id of rig.catalogue.cockpitHidden) {
    const shape = rig.shapes[rig.skeleton.index[id] as number];
    if (shape) shape.scale.setScalar(hidden ? 1e-4 : 1);
  }
}

// ---------------------------------------------------------------------------------------------
// Mesures du véhicule

/** Premier point touché (les deux faces comptent) ; `skip` écarte des objets. */
function castFirst(targets: readonly Object3D[], origin: Vector3, direction: Vector3, skip: (object: Object3D) => boolean): number | null {
  const changed: Array<[Material, Material['side']]> = [];
  for (const target of targets) {
    target.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      for (const material of [object.material].flat() as Material[]) {
        if (material.side !== DoubleSide) {
          changed.push([material, material.side]);
          material.side = DoubleSide;
        }
      }
    });
  }
  try {
    return new Raycaster(origin, direction).intersectObjects([...targets], true).find((hit) => !skip(hit.object))?.distance ?? null;
  } finally {
    for (const [material, side] of changed) material.side = side;
  }
}

const POSED = 'habitacle_pose';
/** Ce qui n'est pas la caisse : pièces posées par l'atelier, conducteur. */
const notBody = (object: Object3D) => {
  for (let node: Object3D | null = object; node; node = node.parent) if (node.name === POSED || node.name === 'conducteur') return true;
  return false;
};

/** Position et rotation d'un nœud dans le repère `frame`. */
/** Nœuds de roue (convention des modèles : roue_*, wheel_*). */
const WHEEL_NAME = /^(roue|wheel)_/i;

/**
 * Axe de direction d'une moto dans le repère de la caisse : du moyeu avant (la roue la plus en avant)
 * au milieu des poignées, comme la direction de la scène de route (src/drive/scene/roues.ts,
 * `steeringAxis`). `null` : pas de roue, ou un axe invraisemblable.
 */
function steeringOf(model: Object3D, frame: Object3D, left: Vector3, right: Vector3): { at: Vector3; dir: Vector3 } | null {
  let hub: Vector3 | null = null;
  model.traverse((node) => {
    if (!WHEEL_NAME.test(node.name)) return;
    const at = inFrame(node, frame).at;
    if (!hub || at.x > hub.x) hub = at;
  });
  const front = hub as Vector3 | null;
  if (!front || front.x <= 0.05) return null;
  const dir = left.clone().add(right).multiplyScalar(0.5).sub(front);
  if (dir.lengthSq() < 0.04 || dir.normalize().y <= 0.5) return null;
  return { at: front, dir };
}

function inFrame(node: Object3D, frame: Object3D): { at: Vector3; quaternion: Quaternion } {
  frame.updateWorldMatrix(true, false);
  node.updateWorldMatrix(true, false);
  const inverse = new Matrix4().copy(frame.matrixWorld).invert();
  const m = new Matrix4().multiplyMatrices(inverse, node.matrixWorld);
  const at = new Vector3();
  const quaternion = new Quaternion();
  m.decompose(at, quaternion, new Vector3());
  return { at, quaternion };
}

/** Rayon de l'axe de la jante d'un volant posé (sommets dans le plan de la jante, moins la demi-épaisseur). */
export function rimRadius(posed: Object3D, anchor: Object3D): number {
  let best = 0;
  const inverse = new Matrix4().copy(anchor.matrixWorld).invert();
  const v = new Vector3();
  posed.updateWorldMatrix(true, true);
  posed.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const position = (object.geometry as BufferGeometry).getAttribute('position');
    const m = new Matrix4().multiplyMatrices(inverse, object.matrixWorld);
    for (let i = 0; i < position.count; i += 1) {
      v.fromBufferAttribute(position, i).applyMatrix4(m);
      if (Math.abs(v.z) < 0.03) best = Math.max(best, Math.hypot(v.x, v.y));
    }
  });
  return Math.max(0.12, best - 0.016);
}

type Cast = (from: Vector3, dir: Vector3) => number | null;

/**
 * Place aux pieds et aux genoux, au rayon vers l'avant : pour chaque pied, le premier obstacle
 * (pédale, tablier) entre le plancher et 35 cm au-dessus ; à chaque hauteur du siège aux genoux, la
 * planche de bord.
 */
function room(cast: Cast, seat: Vec3, floor: number): { toeBoard: [number, number] | null; legRoom: Array<[number, number]> } {
  const from = seat[0] + 0.45;
  const toes = [-1, 1].map((side) => {
    let first = Infinity;
    for (let y = floor + 0.05; y <= floor + 0.35 + 1e-9; y += 0.03) {
      for (const dz of [-0.01, 0.03, 0.065, 0.1, 0.135]) {
        const d = cast(new Vector3(from, y, seat[2] + side * dz), new Vector3(1, 0, 0));
        if (d !== null) first = Math.min(first, from + d);
      }
    }
    return first;
  });
  const legRoom: Array<[number, number]> = [];
  for (let y = seat[1] - 0.05; y <= seat[1] + 0.5 + 1e-9; y += 0.03) {
    let first = Infinity;
    for (const dz of [-0.16, -0.08, 0.08, 0.16]) {
      const d = cast(new Vector3(seat[0] + 0.15, y, seat[2] + dz), new Vector3(1, 0, 0));
      if (d !== null) first = Math.min(first, seat[0] + 0.15 + d);
    }
    if (Number.isFinite(first)) legRoom.push([y, first]);
  }
  return { toeBoard: toes.every(Number.isFinite) ? (toes as [number, number]) : null, legRoom };
}

/**
 * Où s'assoit le conducteur, mesuré dans le modèle posé (`model` : le véhicule ; `frame` : la caisse,
 * repère du véhicule au repos). `pending` : une pièce attendue (siège, volant) n'est pas encore posée.
 */
export function measureSeating(model: Object3D, frame: Object3D, vehicle: VehicleManifest): { seating: Seating | null; pending: boolean } {
  model.updateWorldMatrix(true, true);
  const toWorld = (p: Vector3) => p.clone().applyMatrix4(frame.matrixWorld);
  const turn = frame.getWorldQuaternion(new Quaternion());
  const cast = (from: Vector3, dir: Vector3, targets: readonly Object3D[] = [model], skip = notBody) => castFirst(targets, toWorld(from), dir.clone().applyQuaternion(turn).normalize(), skip);
  if (vehicle.kind === 'bike') {
    const a = DRIVER_CATALOGUE.anchors;
    const find = (name: string) => {
      const node = model.getObjectByName(name);
      return node ? inFrame(node, frame) : null;
    };
    const seat = find(a.seat);
    const grips = a.grips.map(find);
    const pegs = a.pegs.map(find);
    if (!seat || grips.some((g) => !g) || pegs.some((g) => !g)) return { seating: null, pending: false };
    const vec = (v: Vector3): Vec3 => [v.x, v.y, v.z];
    const spec = driverSpecOf(vehicle);
    const steering = steeringOf(model, frame, grips[0]!.at, grips[1]!.at);
    return {
      pending: false,
      seating: {
        kind: 'bike',
        seat: vec(seat.at),
        grips: grips.map((g) => ({ at: vec(g!.at), axis: vec(new Vector3(1, 0, 0).applyQuaternion(g!.quaternion)) })) as [{ at: Vec3; axis: Vec3 }, { at: Vec3; axis: Vec3 }],
        pegs: pegs.map((g) => ({ at: vec(g!.at), radius: 0 })) as [{ at: Vec3; radius: number }, { at: Vec3; radius: number }],
        reach: spec.reach,
        ...(steering ? { steering: { at: vec(steering.at), dir: vec(steering.dir) } } : {}),
      },
    };
  }
  const place = placeOf(vehicle, 'conducteur');
  if (!place) return { seating: null, pending: false };
  const view = place.view;
  const P = DRIVER_POSE.car;
  const steeringAnchor = model.getObjectByName(INTERIOR_CATALOGUE.anchors.steering);
  const seatName = view.seat?.anchors[0];
  const seatAnchor = seatName ? model.getObjectByName(seatName) : undefined;
  if (view.seat && seatAnchor && steeringAnchor) {
    const seatPose = seatAnchor.children.find((child) => child.name === POSED);
    const wheelPose = steeringAnchor.children.find((child) => child.name === POSED);
    if (!seatPose || !wheelPose) return { seating: null, pending: true };
    const at = inFrame(seatAnchor, frame).at;
    // Mesure du siège posé (comme l'œil de la vue intérieure).
    const box = new Box3();
    const inverse = new Matrix4().copy(frame.matrixWorld).invert();
    const v = new Vector3();
    seatPose.updateWorldMatrix(true, true);
    seatPose.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const position = (object.geometry as BufferGeometry).getAttribute('position');
      const m = new Matrix4().multiplyMatrices(inverse, object.matrixWorld);
      for (let i = 0; i < position.count; i += 1) box.expandByPoint(v.fromBufferAttribute(position, i).applyMatrix4(m).sub(at));
    });
    const metrics = box.isEmpty()
      ? DEFAULT_SEAT
      : seatMetrics((origin, direction) => cast(new Vector3(at.x + origin[0], at.y + origin[1], at.z + origin[2]), new Vector3(...direction), [seatPose], () => false), { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] }, view.seat.up);
    const seat: Vec3 = [at.x + metrics.backFront + P.seatAhead, at.y + metrics.cushion - 0.005, at.z];
    const wheel = inFrame(steeringAnchor, frame);
    const radius = rimRadius(wheelPose, steeringAnchor);
    const floor = vehicle.interior?.clearance?.floor ?? (() => {
      const d = cast(new Vector3(seat[0] + 0.45, seat[1], seat[2]), new Vector3(0, -1, 0));
      return d === null ? 0 : seat[1] - d;
    })();
    const up = cast(new Vector3(seat[0] - 0.12, seat[1] + 0.45, seat[2]), new Vector3(0, 1, 0));
    return {
      pending: false,
      seating: {
        kind: 'car',
        seat,
        recline: P.recline,
        wheel: { center: [wheel.at.x, wheel.at.y, wheel.at.z], quaternion: [wheel.quaternion.x, wheel.quaternion.y, wheel.quaternion.z, wheel.quaternion.w], radius },
        hands: P.hands,
        floor,
        ...room(cast, seat, floor),
        roof: up === null ? null : seat[1] + 0.45 + up,
      },
    };
  }
  // Vrai modèle sans ancres : depuis l'œil de sa place « conducteur ».
  if (!view.eye) return { seating: null, pending: false };
  const W = DRIVER_POSE.carWithoutAnchors;
  const e = view.eye;
  const add = (o: Vec3): Vec3 => [e[0] + o[0], e[1] + o[1], e[2] + o[2]];
  // Jante face au conducteur (+Z local vers l'arrière du véhicule), inclinée de `tilt`, midi en haut.
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2).premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -W.wheel.tilt));
  const seat = add(W.seat);
  const up = cast(new Vector3(seat[0] - 0.12, seat[1] + 0.45, seat[2]), new Vector3(0, 1, 0));
  return {
    pending: false,
    seating: {
      kind: 'car',
      seat,
      recline: W.recline,
      wheel: { center: add(W.wheel.center), quaternion: [q.x, q.y, q.z, q.w], radius: W.wheel.radius },
      hands: (78 * Math.PI) / 180,
      floor: e[1] + W.floor,
      ...room(cast, seat, e[1] + W.floor),
      kneeSpread: W.kneeSpread,
      roof: up === null ? null : seat[1] + 0.45 + up,
    },
  };
}

/** Le conducteur d'un véhicule, posé sur ses ancres : pose figée (le garage) ou à faire vivre (la sortie). */
export interface DriverHandle {
  rig: DriverRig;
  seating: Seating;
  pose: DriverPose;
  /** Re-pose le conducteur pour ce mouvement. */
  move(motion: Readonly<DriverMotion>): DriverPose;
}

/** Pose le conducteur une fois mesuré le véhicule. */
export function seatDriver(rig: DriverRig, seating: Seating): DriverHandle {
  const handle: DriverHandle = {
    rig,
    seating,
    pose: solvePose(rig.skeleton, rig.catalogue, seating, STILL_MOTION),
    move(motion) {
      handle.pose = solvePose(rig.skeleton, rig.catalogue, seating, motion);
      applyPose(rig, handle.pose);
      return handle.pose;
    },
  };
  applyPose(rig, handle.pose);
  return handle;
}

/** Monte le conducteur assis dans la caisse ; `measureMs` : durée de la mesure du véhicule (diagnostic). */
export function mountDriver(rig: DriverRig, body: Object3D, measureMs: number): void {
  rig.root.userData.mesureMs = measureMs;
  body.add(rig.root);
}

/** Le retire de la caisse (sortie terminée, véhicule changé). */
export function unmountDriver(rig: DriverRig): void {
  rig.root.removeFromParent();
}

/** Le conducteur monté pour un véhicule (tenue de son genre), ou `null` tant que son fichier n'est pas là. */
export function useDriverRig(vehicle: VehicleManifest, enabled: boolean): DriverRig | null {
  const file = enabled ? driverFile(outfitFor(vehicle).id) : null;
  const [gltf, setGltf] = useState<GLTF | null>(null);
  useEffect(() => {
    if (!file) return;
    let live = true;
    loadDriverSource(file).then(
      (loaded) => {
        if (live) setGltf(loaded);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [file]);
  const rig = useMemo(() => (gltf && file ? buildDriverRig(gltf.scene) : null), [gltf, file]);
  useEffect(() => () => rig?.dispose(), [rig]);
  return rig;
}
