// Roues qui tournent pendant la sortie de nuit : leur axe et leur pose de départ, calculés dans le
// repère du véhicule (prepared.root : +X vers l'avant, +Y vers le haut, +Z sur le côté), jamais
// dans celui du monde. Le véhicule est déjà posé sur la route quand les roues de l'atelier arrivent :
// un axe pris dans le repère du monde suivrait le cap de la route, et les roues tourneraient de
// travers (debout, la face de la jante vers l'avant). Le modèle d'origine peut aussi avoir ses roues
// braquées ou ses nœuds dans un autre repère (le concept : Z vers le haut, roues avant braquées de
// 30°) : chaque roue est d'abord redressée, son axe (la plus petite dimension de sa boîte, dans le
// repère de son nœud) ramené sur le côté du véhicule, puis elle tourne autour de cet axe.
// Les roues avant braquent (`motion.steer` du pilote, amplifié pour l'image par `wheelSteer`) autour
// de la verticale du véhicule ; sur une moto, autour de l'axe de direction (du moyeu avant vers les
// poignées), avec la fourche, le guidon et les poignées (`bikeSteering`).
// Aussi : la béquille d'atelier retirée en roulant, et la courbure suivie (CurvatureFollower, gardée
// pour les essais : le conducteur suit désormais le braquage du pilote).
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
  /** Roue avant : axe de braquage dans le repère du parent du nœud ; absent pour une roue qui ne braque pas. */
  steer?: Vector3;
}

const SIDE = new Vector3(0, 0, 1);
const UP = new Vector3(0, 1, 0);

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
export function rollingWheels(root: Object3D, spins: ReadonlyArray<{ node: Object3D; radius: number }>, kind: 'car' | 'bike' = 'car'): Wheel[] {
  root.updateWorldMatrix(true, true);
  const rootInverse = root.getWorldQuaternion(new Quaternion()).invert();
  const rootMatrix = new Matrix4().copy(root.matrixWorld).invert();
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
    // Roue avant (centre à l'avant du milieu, repère du véhicule) : elle braque autour de la verticale,
    // ou de l'axe de direction d'une moto.
    const hub = center.clone().applyMatrix4(rootMatrix);
    const wheel: Wheel = { node, base, axis, radius: Math.max(0.1, radius) };
    if (hub.x > 0.05) wheel.steer = steeringAxis(root, kind, hub).dir.applyQuaternion(parentInverse).normalize();
    wheels.push(wheel);
  }
  return wheels;
}

// ---------------------------------------------------------------------------------------------
// Braquage (demande du 16 novembre 2026 : « voir la voiture qui tourne, roues plus direction »).

/**
 * Braquage montré à l'image, en radians (positif à gauche), d'après le braquage physique du pilote
 * (`DriveMotion.steer`) : amplifié pour être lisible, borné d'autant plus serré que l'on va vite
 * (30° au pas, quelques degrés lancé). Une moto braque peu : sa roue avant tourne avec sa fourche.
 */
export const WHEEL_STEER = {
  car: { gain: 2.5, low: (30 * Math.PI) / 180, high: (5 * Math.PI) / 180 },
  bike: { gain: 1.2, low: (9 * Math.PI) / 180, high: (1.5 * Math.PI) / 180 },
  /** Vitesses (m/s) de la borne basse (≈ 30 km/h) et de la borne haute (≈ 110 km/h). */
  slow: 8,
  fast: 30,
} as const;

export function wheelSteer(steer: number, speed: number, kind: 'car' | 'bike'): number {
  if (!Number.isFinite(steer)) return 0;
  const W = WHEEL_STEER;
  const k = W[kind];
  const t = Math.min(1, Math.max(0, ((Number.isFinite(speed) ? speed : 0) - W.slow) / (W.fast - W.slow)));
  const max = k.low + (k.high - k.low) * t;
  return Math.max(-max, Math.min(max, steer * k.gain));
}

/** Pièces de direction d'une moto, tournées avec la roue avant (noms des pièces des modèles, jamais d'un véhicule). */
export const STEERING_PARTS = ['fourche', 'guidon', 'poignee_gauche', 'poignee_droite'] as const;
const GRIPS = ['poignee_gauche', 'poignee_droite'] as const;

/**
 * Axe de direction dans le repère du véhicule : la verticale au centre de la roue pour une voiture ;
 * pour une moto, la droite du moyeu avant au milieu des poignées (la chasse de la fourche), si le
 * modèle a ses poignées, sinon la verticale.
 */
export function steeringAxis(root: Object3D, kind: 'car' | 'bike', hub: Vector3): { point: Vector3; dir: Vector3 } {
  if (kind === 'bike') {
    const toRoot = new Matrix4().copy(root.matrixWorld).invert();
    const mid = new Vector3();
    let found = 0;
    for (const name of GRIPS) {
      const grip = root.getObjectByName(name);
      if (!grip) continue;
      mid.add(grip.getWorldPosition(new Vector3()).applyMatrix4(toRoot));
      found += 1;
    }
    if (found === GRIPS.length) {
      const dir = mid.multiplyScalar(1 / found).sub(hub);
      // Une direction raisonnable : nettement vers le haut, penchée vers l'arrière.
      if (dir.lengthSq() > 0.04 && dir.normalize().y > 0.5) return { point: hub.clone(), dir };
    }
  }
  return { point: hub.clone(), dir: UP.clone() };
}

/** Pièce de direction : pose de départ, et axe de direction (point, direction), dans le repère de son parent. */
export interface SteeringPart {
  node: Object3D;
  base: Quaternion;
  origin: Vector3;
  pivot: Vector3;
  axis: Vector3;
}

/**
 * Fourche, guidon et poignées d'une moto, prêts à tourner autour de l'axe de direction de sa roue
 * avant (`rollingWheels`). Une voiture, ou une moto sans ces pièces : rien.
 */
export function bikeSteering(root: Object3D, wheels: readonly Wheel[], kind: 'car' | 'bike'): SteeringPart[] {
  if (kind !== 'bike') return [];
  const front = wheels.find((w) => w.steer);
  if (!front) return [];
  root.updateWorldMatrix(true, true);
  const toRoot = new Matrix4().copy(root.matrixWorld).invert();
  const hub = new Box3().setFromObject(front.node, true).getCenter(new Vector3()).applyMatrix4(toRoot);
  const line = steeringAxis(root, kind, hub);
  const parts: SteeringPart[] = [];
  const seen = new Set<Object3D>();
  for (const name of STEERING_PARTS) {
    const node = root.getObjectByName(name);
    if (!node?.parent || seen.has(node)) continue;
    seen.add(node);
    // Repère du parent, vu du véhicule : l'axe et son point y sont ramenés.
    const parentToRoot = new Matrix4().multiplyMatrices(toRoot, node.parent.matrixWorld);
    const rootToParent = parentToRoot.clone().invert();
    const pivot = line.point.clone().applyMatrix4(rootToParent);
    const tip = line.point.clone().add(line.dir).applyMatrix4(rootToParent);
    parts.push({ node, base: node.quaternion.clone(), origin: node.position.clone(), pivot, axis: tip.sub(pivot).normalize() });
  }
  return parts;
}

/**
 * Volant d'origine d'un vrai modèle (nœud déclaré par le manifeste, `interior.steeringNode`), prêt à
 * tourner autour de sa colonne : l'axe est la normale du plan où s'étalent sa jante et ses branches
 * (les maillages sous le nœud ; le nœud seul s'il n'en a pas), passant par leur centre, tourné vers
 * le conducteur (un angle positif tourne le volant vers la gauche). Le pivot du nœud peut être loin
 * du volant (à l'origine du modèle) : la rotation se fait autour de cette droite, pas du pivot.
 * `null` : rien de mesurable, ou un axe invraisemblable (pas tourné vers l'arrière).
 */
export function steeringWheelPart(root: Object3D, node: Object3D): SteeringPart | null {
  const parent = node.parent;
  if (!parent) return null;
  root.updateWorldMatrix(true, true);
  const toParent = new Matrix4().copy(parent.matrixWorld).invert();
  const meshes: Mesh[] = [];
  for (const child of node.children) {
    child.traverse((o) => {
      if ((o as Mesh).isMesh) meshes.push(o as Mesh);
    });
  }
  if (meshes.length === 0 && (node as Mesh).isMesh) meshes.push(node as Mesh);
  // Moyenne et covariance des sommets, dans le repère du parent du nœud.
  const m = new Matrix4();
  const v = new Vector3();
  const mean = new Vector3();
  let n = 0;
  const points: number[] = [];
  for (const mesh of meshes) {
    const position = mesh.geometry?.getAttribute('position');
    if (!position) continue;
    m.multiplyMatrices(toParent, mesh.matrixWorld);
    const stride = Math.max(1, Math.floor(position.count / 4000));
    for (let i = 0; i < position.count; i += stride) {
      v.fromBufferAttribute(position, i).applyMatrix4(m);
      points.push(v.x, v.y, v.z);
      mean.add(v);
      n += 1;
    }
  }
  if (n < 12) return null;
  mean.multiplyScalar(1 / n);
  let xx = 0;
  let yy = 0;
  let zz = 0;
  let xy = 0;
  let xz = 0;
  let yz = 0;
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i]! - mean.x;
    const y = points[i + 1]! - mean.y;
    const z = points[i + 2]! - mean.z;
    xx += x * x;
    yy += y * y;
    zz += z * z;
    xy += x * y;
    xz += x * z;
    yz += y * z;
  }
  // Plus petite direction de la covariance : plus grande de (trace − C), par itérations.
  const t = xx + yy + zz;
  const axis = new Vector3(1, 0.3, 0.2).normalize();
  const next = new Vector3();
  for (let k = 0; k < 80; k += 1) {
    next.set(
      (t - xx) * axis.x - xy * axis.y - xz * axis.z,
      -xy * axis.x + (t - yy) * axis.y - yz * axis.z,
      -xz * axis.x - yz * axis.y + (t - zz) * axis.z,
    );
    if (next.lengthSq() === 0) return null;
    axis.copy(next.normalize());
  }
  // Tourné vers le conducteur : vers l'arrière du véhicule (−X de son repère).
  const parentToRoot = new Matrix4().copy(root.matrixWorld).invert().multiply(parent.matrixWorld);
  const inRoot = axis.clone().transformDirection(parentToRoot);
  if (inRoot.x > 0) axis.negate();
  if (Math.abs(inRoot.x) < 0.5) return null;
  return { node, base: node.quaternion.clone(), origin: node.position.clone(), pivot: mean, axis };
}

const steerWork = new Quaternion();

/** Tourne les pièces de direction de `angle` radians autour de leur axe (aucune allocation). */
export function steerParts(parts: readonly SteeringPart[], angle: number): void {
  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i] as SteeringPart;
    steerWork.setFromAxisAngle(p.axis, angle);
    p.node.quaternion.multiplyQuaternions(steerWork, p.base);
    p.node.position.copy(p.origin).sub(p.pivot).applyQuaternion(steerWork).add(p.pivot);
  }
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
