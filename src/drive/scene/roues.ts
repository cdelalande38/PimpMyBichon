// Roues qui tournent pendant la sortie de nuit : leur axe et leur pose de départ, calculés dans le
// repère du véhicule (prepared.root : +X vers l'avant, +Y vers le haut, +Z sur le côté), jamais
// dans celui du monde. Le véhicule est déjà posé sur la route quand les roues de l'atelier arrivent :
// un axe pris dans le repère du monde suivrait le cap de la route, et les roues tourneraient de
// travers (debout, la face de la jante vers l'avant). Le modèle d'origine peut aussi avoir ses roues
// braquées ou ses nœuds dans un autre repère (le concept : Z vers le haut, roues avant braquées de
// 30°) : chaque roue est d'abord redressée, son axe (la plus petite dimension de sa boîte, dans le
// repère de son nœud) ramené sur le côté du véhicule, puis elle tourne autour de cet axe.
// Module pur (three seul) : testé dans tests/unit/drive-scene-roues.test.ts.

import { Box3, Matrix4, Quaternion, Vector3, type Mesh, type Object3D } from 'three';

export interface Wheel {
  node: Object3D;
  /** Pose de départ du nœud (redressée), dans le repère de son parent. */
  base: Quaternion;
  /** Axe de rotation dans le repère du parent du nœud : le côté du véhicule. */
  axis: Vector3;
  radius: number;
}

const SIDE = new Vector3(0, 0, 1);

/** Boîte des maillages sous `node`, dans le repère de `node` (matrices du monde à jour). */
export function localBox(node: Object3D): Box3 {
  const box = new Box3();
  const inverse = new Matrix4().copy(node.matrixWorld).invert();
  const m = new Matrix4();
  const part = new Box3();
  node.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    if (!bb) return;
    part.copy(bb).applyMatrix4(m.multiplyMatrices(inverse, mesh.matrixWorld));
    box.union(part);
  });
  return box;
}

/** Axe d'une roue dans le repère de son nœud : la plus petite dimension de sa boîte (une roue est plus large que épaisse). */
export function axleOf(node: Object3D): Vector3 | null {
  const box = localBox(node);
  if (box.isEmpty()) return null;
  const s = box.getSize(new Vector3());
  if (s.x <= s.y && s.x <= s.z) return new Vector3(1, 0, 0);
  if (s.y <= s.x && s.y <= s.z) return new Vector3(0, 1, 0);
  return new Vector3(0, 0, 1);
}

/**
 * Roues qui tournent, d'après les nœuds rangés à part par `prepare` (et garnis par l'atelier) :
 * pose redressée, axe sur le côté du véhicule, rayon de la roue posée. Une roue dont le pivot est loin
 * de son centre reste fixe (elle voilerait).
 */
export function rollingWheels(root: Object3D, spins: ReadonlyArray<{ node: Object3D; radius: number }>): Wheel[] {
  root.updateWorldMatrix(true, true);
  const rootInverse = root.getWorldQuaternion(new Quaternion()).invert();
  const wheels: Wheel[] = [];
  const box = new Box3();
  const center = new Vector3();
  const origin = new Vector3();
  for (const { node, radius } of spins) {
    if (!node.parent) continue;
    box.setFromObject(node, true);
    if (box.isEmpty()) continue;
    box.getCenter(center);
    node.getWorldPosition(origin);
    if (origin.distanceTo(center) > 0.05) continue;
    // Repères du nœud et de son parent, dans celui du véhicule.
    const nodeInRoot = rootInverse.clone().multiply(node.getWorldQuaternion(new Quaternion()));
    const parentInRoot = rootInverse.clone().multiply(node.parent.getWorldQuaternion(new Quaternion()));
    const parentInverse = parentInRoot.clone().invert();
    // Redressée : son axe ramené sur le côté du véhicule (ni braquage ni carrossage en roulant).
    const axle = axleOf(node);
    let base = node.quaternion.clone();
    if (axle) {
      const axleInRoot = axle.applyQuaternion(nodeInRoot);
      if (axleInRoot.z < 0) axleInRoot.negate();
      const straighten = new Quaternion().setFromUnitVectors(axleInRoot.normalize(), SIDE);
      base = parentInverse.clone().multiply(straighten).multiply(nodeInRoot);
    }
    const axis = SIDE.clone().applyQuaternion(parentInverse).normalize();
    wheels.push({ node, base, axis, radius: Math.max(0.1, radius) });
  }
  return wheels;
}
