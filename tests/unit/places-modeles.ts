// Outils des tests des places (tests/unit/places.test.ts) : le modèle d'un véhicule lu comme dans
// l'app (GLB fabriqué en mémoire par tools/vehicles/, ou GLB du dépôt sans ses textures), les sièges
// du catalogue posés sur ses ancres, et l'œil de chaque place résolu comme le fait la scène
// (src/scene/GarageCanvas.tsx, resolvePlace) : mesure des sièges au rayon, pavillon au rayon.

import { readFileSync } from 'node:fs';
import { Box3, DoubleSide, Group, Mesh, Raycaster, Triangle, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildVehicle } from '../../tools/vehicles/build.mjs';
import * as habitacle from '../../tools/vehicles/habitacle.mjs';
import type { InteriorView } from '../../src/data/vehicleTypes.ts';
import { DEFAULT_SEAT, lookTarget, placeEye, seatMetrics, type PlacedSeat } from '../../src/scene/fit.ts';

type Vec3 = [number, number, number];

/** GLB → scène three, textures retirées (inutiles à la mesure, illisibles sans navigateur). */
export async function parseModel(bytes: Uint8Array): Promise<Group> {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8')) as Record<string, unknown> & { materials?: Array<Record<string, unknown>> };
  const bin = buffer.subarray(20 + jsonLength);
  delete json.images;
  delete json.textures;
  delete json.samplers;
  for (const material of json.materials ?? []) {
    const pbr = (material.pbrMetallicRoughness ?? {}) as Record<string, unknown>;
    delete pbr.baseColorTexture;
    delete pbr.metallicRoughnessTexture;
    for (const key of ['normalTexture', 'occlusionTexture', 'emissiveTexture', 'extensions']) delete material[key];
  }
  for (const key of ['extensionsRequired', 'extensionsUsed']) {
    if (Array.isArray(json[key])) json[key] = (json[key] as string[]).filter((name) => !/texture|basisu|webp/i.test(name));
  }
  let text = Buffer.from(JSON.stringify(json));
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + text.length + bin.length, 8);
  head.writeUInt32LE(text.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  const glb = Buffer.concat([head, text, bin]);
  const gltf = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer, '');
  // Pose de l'app (src/scene/vehicle/VehicleModel.tsx, prepare) : longueur sur X, au sol, centré.
  const turn = new Group();
  turn.add(gltf.scene);
  const size = new Box3().setFromObject(turn, true).getSize(new Vector3());
  turn.rotation.y = size.z > size.x ? Math.PI / 2 : 0;
  turn.updateMatrixWorld(true);
  const box = new Box3().setFromObject(turn, true);
  const center = box.getCenter(new Vector3());
  turn.position.set(-center.x, -Math.min(0, box.min.y), -center.z);
  const root = new Group();
  root.add(turn);
  root.traverse((object) => {
    if (object instanceof Mesh) for (const material of [object.material].flat()) material.side = DoubleSide;
  });
  root.updateMatrixWorld(true);
  return root;
}

/** Modèle d'un véhicule fabriqué en mémoire (tools/vehicles/), comme `npm run vehicles:build`. */
export async function builtModel(id: string): Promise<Group> {
  return parseModel((await buildVehicle(id)).bytes);
}

/** Modèle d'un véhicule tel qu'il est dans le dépôt (vrai modèle). */
export async function storedModel(id: string): Promise<Group> {
  return parseModel(new Uint8Array(readFileSync(new URL(`../../public/assets/vehicles/${id}/body.glb`, import.meta.url))));
}

/** Siège du catalogue, en maillages (repère de son ancre), à l'échelle du manifeste. */
export function seatMeshes(id: string, scale = 1): Group {
  const entry = habitacle.readCatalogue().seats.find((item) => item.id === id);
  if (!entry) throw new Error(`siège ${id} absent du catalogue`);
  const group = new Group();
  group.name = 'habitacle_pose';
  group.scale.setScalar(scale);
  for (const part of habitacle.buildSeat(entry)) {
    const mesh = new Mesh(part.geometry);
    (mesh.material as { side: number }).side = DoubleSide;
    group.add(mesh);
  }
  return group;
}

const posed = (object: Object3D) => {
  for (let node: Object3D | null = object; node; node = node.parent) if (node.name === 'habitacle_pose') return true;
  return false;
};

function cast(targets: Object3D[], origin: Vector3, direction: Vector3, skip: (object: Object3D) => boolean = () => false): number | null {
  const hit = new Raycaster(origin, direction).intersectObjects(targets, true).find((item) => !skip(item.object));
  return hit ? hit.distance : null;
}

/** Pose le siège `seat` (catalogue) sur chaque ancre de siège du modèle ; rend de quoi le retirer. */
export function poseSeats(model: Group, anchors: readonly string[], seat: string, scale = 1): () => void {
  const added: Object3D[] = [];
  for (const name of anchors) {
    const anchor = model.getObjectByName(name);
    if (!anchor) continue;
    const group = seatMeshes(seat, scale);
    anchor.add(group);
    added.push(group);
  }
  model.updateMatrixWorld(true);
  return () => {
    for (const group of added) group.removeFromParent();
    model.updateMatrixWorld(true);
  };
}

/** Œil et point regardé d'une place, résolus comme dans la scène (modèle au repos : repère du véhicule). */
export function resolveEye(model: Group, view: InteriorView): { eye: Vec3; target: Vec3; seats: PlacedSeat[] } {
  let eye: Vec3 | null = view.eye ? [view.eye[0], view.eye[1], view.eye[2]] : null;
  const seats: PlacedSeat[] = [];
  if (view.seat) {
    for (const name of view.seat.anchors) {
      const anchor = model.getObjectByName(name);
      if (!anchor) throw new Error(`ancre ${name} absente du modèle`);
      const at = anchor.getWorldPosition(new Vector3());
      const pose = anchor.children.find((child) => child.name === 'habitacle_pose');
      let metrics = DEFAULT_SEAT;
      if (pose) {
        const box = new Box3().setFromObject(pose, true);
        metrics = seatMetrics(
          (origin, direction) => cast([pose], new Vector3(at.x + origin[0], at.y + origin[1], at.z + origin[2]), new Vector3(...direction)),
          { min: [box.min.x - at.x, box.min.y - at.y, box.min.z - at.z], max: [box.max.x - at.x, box.max.y - at.y, box.max.z - at.z] },
          view.seat.up,
        );
      }
      seats.push({ anchor: [at.x, at.y, at.z], metrics });
    }
    const roof = (x: number, z: number, from: number) => {
      const d = cast([model], new Vector3(x, from, z), new Vector3(0, 1, 0), posed);
      return d === null ? null : from + d;
    };
    eye = placeEye(view.seat, seats, roof);
  }
  if (!eye) throw new Error('place sans œil');
  const target: Vec3 = view.look ? lookTarget(eye, view.look) : view.target ? [view.target[0], view.target[1], view.target[2]] : [eye[0] + 1, eye[1], eye[2]];
  return { eye, target, seats };
}

/** Plus courte distance de `point` aux faces du modèle (pièces posées comprises), en mètres, et la pièce la plus proche. */
export function clearance(model: Object3D, point: Vec3): { distance: number; name: string } {
  const p = new Vector3(...point);
  const triangle = new Triangle();
  const closest = new Vector3();
  const box = new Box3();
  let best = { distance: Infinity, name: '' };
  model.updateMatrixWorld(true);
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    box.setFromObject(object, true);
    if (box.distanceToPoint(p) >= best.distance) return;
    const position = object.geometry.getAttribute('position');
    const index = object.geometry.getIndex();
    const count = index ? index.count : position.count;
    const [a, b, c] = [new Vector3(), new Vector3(), new Vector3()];
    for (let i = 0; i + 2 < count; i += 3) {
      const [ia, ib, ic] = index ? [index.getX(i), index.getX(i + 1), index.getX(i + 2)] : [i, i + 1, i + 2];
      a.fromBufferAttribute(position, ia).applyMatrix4(object.matrixWorld);
      b.fromBufferAttribute(position, ib).applyMatrix4(object.matrixWorld);
      c.fromBufferAttribute(position, ic).applyMatrix4(object.matrixWorld);
      triangle.set(a, b, c).closestPointToPoint(p, closest);
      const d = closest.distanceTo(p);
      if (d < best.distance) best = { distance: d, name: object.name || object.parent?.name || '' };
    }
  });
  return best;
}

/** Hauteur du premier maillage au-dessus de `point` (pièces posées exclues), ou `null`. */
export function roofAbove(model: Object3D, point: Vec3): number | null {
  const d = cast([model], new Vector3(...point), new Vector3(0, 1, 0), posed);
  return d === null ? null : point[1] + d;
}
