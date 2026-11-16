// Roues qui tournent pendant la sortie de nuit : leur axe et leur pose de départ, calculés dans le
// repère du véhicule (prepared.root : +X vers l'avant, +Y vers le haut, +Z sur le côté), jamais
// dans celui du monde. Le véhicule est déjà posé sur la route quand les roues de l'atelier arrivent :
// un axe pris dans le repère du monde suivrait le cap de la route, et les roues tourneraient de
// travers (debout, la face de la jante vers l'avant). Le modèle d'origine peut aussi avoir ses roues
// braquées ou ses nœuds dans un autre repère (le concept : Z vers le haut, roues avant braquées de
// 30°) : chaque roue est d'abord redressée, son axe (la plus petite dimension de sa boîte, dans le
// repère de son nœud) ramené sur le côté du véhicule, puis elle tourne autour de cet axe.
// Aussi : la béquille d'atelier retirée en roulant, et la courbure suivie qui fait tourner le volant
// et la tête du conducteur.
// Module pur (three seul) : testé dans tests/unit/drive-scene-roues.test.ts et
// tests/unit/conducteur-sortie.test.ts.

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

// ---------------------------------------------------------------------------------------------
// Béquille et volant en roulant (demande du 16 novembre 2026 : « les motos il faut bien retirer la
// béquille pendant les sorties » ; « il manque un pilote au volant »).

/**
 * Retire les pièces posées au sol du manifeste (`wheels.grounded` : la béquille d'atelier) : elles ne
 * suivent pas la caisse et ne peuvent pas rouler avec elle. La béquille latérale, repliée le long du
 * cadre dans le modèle, reste. Rend les nœuds retirés (aucun identifiant de véhicule ici).
 */
export function liftStands(root: Object3D, grounded: readonly string[] | undefined): Object3D[] {
  const lifted: Object3D[] = [];
  for (const name of grounded ?? []) {
    root.traverse((object) => {
      if (object.name === name && object.visible) {
        object.visible = false;
        lifted.push(object);
      }
    });
  }
  return lifted;
}

/** Ramène un angle dans ]−π, π]. */
function wrapAngle(a: number): number {
  const t = a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
  return t <= -Math.PI ? t + Math.PI * 2 : t;
}

/**
 * Courbure de la trajectoire suivie (1/m, positive vers la gauche), d'après le cap du véhicule et
 * son abscisse à chaque image, lissée (constante de temps `smoothing` s) : sans mémoire du rail.
 * Un saut d'abscisse (départ, retour en arrière) remet à zéro.
 */
export class CurvatureFollower {
  private s = Number.NaN;
  private heading = 0;
  private readonly smoothing: number;
  value = 0;
  constructor(smoothing = 0.25) {
    this.smoothing = smoothing;
  }

  update(s: number, heading: number, dt: number): number {
    const ds = s - this.s;
    if (!Number.isFinite(ds) || ds < 0 || ds > 30) {
      this.s = s;
      this.heading = heading;
      return this.value;
    }
    if (ds < 0.2) return this.value;
    const raw = wrapAngle(heading - this.heading) / ds;
    this.s = s;
    this.heading = heading;
    const k = 1 - Math.exp(-Math.max(0, dt) / this.smoothing);
    this.value += (Math.max(-0.3, Math.min(0.3, raw)) - this.value) * Math.min(1, k * Math.max(1, ds / 0.5));
    return this.value;
  }
}

/** Valeur bornée, rapprochée de sa cible avec une constante de temps (aucun tremblement). */
export function follow(current: number, target: number, max: number, dt: number, smoothing: number): number {
  const goal = Math.max(-max, Math.min(max, target));
  return current + (goal - current) * (1 - Math.exp(-Math.max(0, dt) / smoothing));
}
