// Le capot moteur d'un véhicule préparé (vague U, « capot ») : ses nœuds, ses plages de dessin dans les
// maillages fondus par matière, l'état qu'il montre (fermé d'origine, ouvert, vitré, déposé) et les
// pièces posées dessus. Module pur (three seulement, ni React ni état) : la préparation
// (src/scene/vehicle/VehicleModel.tsx, prepare) l'appelle avant et pendant la fusion, la scène
// (./capot.ts) pose ensuite chaque état. Voir l'en-tête de ./capot.ts pour le « même coût capot fermé ».

import { DoubleSide, FrontSide, Matrix4, Mesh, MeshStandardMaterial, Quaternion, Vector3, type BufferGeometry, type Material, type Object3D } from 'three';
import { posteCapot, type CapotStyle } from '../../data/pieces.ts';
import type { PieceLidMount, VehicleManifest } from '../../data/vehicleTypes.ts';

/** Durée de l'ouverture (et de la fermeture) du capot, en secondes ; coupée si l'on demande moins de mouvement. */
export const CAPOT_DUREE_S = 0.7;
/** Vitre du capot vitré : opacité et part du reflet (le vitrage des fenêtres : 0,36 et 1,5, src/data/materialRoles.ts). */
export const VITRE = Object.freeze({ opacity: 0.2, envMapIntensity: 0.6 });
/** Identifiant du cadre de la caméra, capot ouvert (src/scene/cadrageZone.ts). */
export const CAPOT_CADRE = 'capot';

/** Un maillage fondu qui porte le compartiment (en tête) ou le capot (en queue), et ses plages. */
interface Fondu {
  geometry: BufferGeometry;
  total: number;
  /** Fin du compartiment (indices) ; 0 : il n'y en a pas ici. */
  head: number;
  /** Début du capot (indices) ; `total` : il n'y en a pas ici. */
  tail: number;
}

/** Le capot d'un véhicule préparé : ses nœuds, ses maillages, ses plages de dessin. */
export interface CapotRig {
  mount: PieceLidMount;
  lid: Object3D | null;
  glazed: Object3D | null;
  bay: Object3D | null;
  lidMeshes: ReadonlySet<Mesh>;
  bayMeshes: ReadonlySet<Mesh>;
  /** Copies des pièces du capot fondues avec la caisse : elles tournent avec lui, capot ouvert. */
  clones: Mesh[];
  fondus: Fondu[];
  /** Matériau de la tôle du capot (sa zone de peinture), s'il est à lui seul. */
  paint: MeshStandardMaterial | null;
  axis: Vector3;
  restLid: Quaternion;
  restGlazed: Quaternion;
  turn: Quaternion;
  turnMatrix: Matrix4;
  /** Dernier état posé, pour ne rien refaire quand rien ne change. */
  posed: string;
}

/** Le nœud du modèle de ce nom (GLTFLoader garde le nom d'origine dans userData.name). */
function nodeNamed(scene: Object3D, name: string | undefined): Object3D | null {
  if (!name) return null;
  let found: Object3D | null = null;
  scene.traverse((object) => {
    if (!found && (object.userData.name === name || object.name === name)) found = object;
  });
  return found;
}

function meshesOf(node: Object3D | null): Set<Mesh> {
  const out = new Set<Mesh>();
  node?.traverse((object) => {
    if (object instanceof Mesh) out.add(object);
  });
  return out;
}

/**
 * À la préparation, avant la fusion par matière (src/scene/vehicle/VehicleModel.tsx, prepare) : repère
 * les nœuds du capot ; range le compartiment en tête et le capot en queue de la liste des maillages
 * (l'ordre de la fusion) ; la variante vitrée reste à part, cachée. `null` : pas de capot déclaré.
 */
export function preparerCapot(scene: Object3D, vehicle: VehicleManifest, meshes: Mesh[], apart: Set<Mesh>, owned: Material[]): CapotRig | null {
  const found = posteCapot(vehicle);
  if (!found) return null;
  const { mount } = found;
  const lid = nodeNamed(scene, mount.lid);
  const glazed = nodeNamed(scene, mount.glazed);
  const bay = nodeNamed(scene, mount.bay);
  const lidMeshes = meshesOf(lid);
  const bayMeshes = meshesOf(bay);
  // La vitre du capot vitré : une copie du vitrage, plus claire et moins miroir, pour voir le moteur.
  let smoked: MeshStandardMaterial | null = null;
  for (const mesh of meshesOf(glazed)) {
    apart.add(mesh);
    const material = mesh.material as Material;
    if (Array.isArray(mesh.material) || !(material instanceof MeshStandardMaterial) || !material.transparent) continue;
    if (!smoked) {
      smoked = material.clone();
      smoked.opacity = VITRE.opacity;
      smoked.envMapIntensity = VITRE.envMapIntensity;
      owned.push(smoked);
    }
    mesh.material = smoked;
  }
  if (glazed) glazed.visible = false;
  if (bay) bay.visible = false;
  // Un capot d'une seule matière est un maillage, pas un groupe : fondu, son nœud (le pivot) partirait.
  if (lid instanceof Mesh) apart.add(lid);
  const rank = (mesh: Mesh) => (bayMeshes.has(mesh) ? 0 : lidMeshes.has(mesh) ? 2 : 1);
  meshes.sort((a, b) => rank(a) - rank(b));
  const axis = new Vector3(...mount.axis).normalize();
  return {
    mount,
    lid,
    glazed,
    bay,
    lidMeshes,
    bayMeshes,
    clones: [],
    fondus: [],
    paint: null,
    axis,
    restLid: lid ? lid.quaternion.clone() : new Quaternion(),
    restGlazed: glazed ? glazed.quaternion.clone() : new Quaternion(),
    turn: new Quaternion(),
    turnMatrix: new Matrix4(),
    posed: '',
  };
}

/**
 * Pendant la fusion : `mesh` vient de fondre `parts` (dans cet ordre, `counts` indices chacune). Note
 * ses plages ; chaque pièce du capot fondue reçoit une copie sous le nœud du capot, cachée.
 */
export function noterFusion(rig: CapotRig | null, mesh: Mesh, parts: readonly Mesh[], counts: readonly number[]): void {
  if (!rig) return;
  let total = 0;
  let head = 0;
  let tail = -1;
  parts.forEach((part, i) => {
    const count = counts[i] ?? 0;
    if (rig.bayMeshes.has(part)) head = total + count;
    if (rig.lidMeshes.has(part) && tail < 0) tail = total;
    total += count;
  });
  if (head === 0 && tail < 0) return;
  rig.fondus.push({ geometry: mesh.geometry as BufferGeometry, total, head, tail: tail < 0 ? total : tail });
  if (!rig.lid) return;
  const toLid = new Matrix4().copy(rig.lid.matrixWorld).invert();
  for (const part of parts) {
    if (!rig.lidMeshes.has(part)) continue;
    const clone = new Mesh(part.geometry, part.material);
    clone.name = `${part.name}_ouvert`;
    clone.renderOrder = part.renderOrder;
    clone.applyMatrix4(new Matrix4().multiplyMatrices(toLid, part.matrixWorld));
    clone.visible = false;
    rig.lid.add(clone);
    rig.clones.push(clone);
  }
}

/** Après la fusion : la tôle du capot (seule de sa matière, jamais fondue) et l'état d'origine (capot fermé, compartiment hors plage). */
export function finirCapot(rig: CapotRig | null): void {
  if (!rig) return;
  for (const mesh of rig.lidMeshes) {
    if (!mesh.parent || Array.isArray(mesh.material)) continue;
    const material = mesh.material as Material;
    if (material instanceof MeshStandardMaterial && material.name.startsWith('paint_')) rig.paint = material;
  }
  poserCapot(rig, { style: null, angle: 0, ouvert: false });
}

/** Ce que montre le capot : ce qui y est posé, son ouverture (radians), capot en mouvement ou ouvert. */
export interface CapotPose {
  style: CapotStyle | null;
  angle: number;
  ouvert: boolean;
}

/** Pose un état du capot : nœuds montrés, plages des maillages fondus, rotation, faces de la tôle. */
export function poserCapot(rig: CapotRig, pose: CapotPose): void {
  const origin = pose.style === null;
  // Capot d'origine fermé, au repos : celui qui est fondu avec la caisse (même image, même coût).
  const merged = origin && !pose.ouvert && pose.angle === 0;
  const bay = !merged;
  const key = `${pose.style}|${merged}|${pose.angle.toFixed(5)}`;
  if (key === rig.posed) return;
  rig.posed = key;
  for (const fondu of rig.fondus) {
    const start = bay ? 0 : fondu.head;
    const end = merged ? fondu.total : fondu.tail;
    fondu.geometry.setDrawRange(start, Math.max(0, end - start));
  }
  if (rig.bay) rig.bay.visible = bay;
  if (rig.lid) rig.lid.visible = origin;
  for (const clone of rig.clones) clone.visible = origin && !merged;
  if (rig.glazed) rig.glazed.visible = pose.style === 'vitre';
  rig.turn.setFromAxisAngle(rig.axis, pose.angle);
  if (rig.lid) rig.lid.quaternion.copy(rig.restLid).multiply(rig.turn);
  if (rig.glazed) rig.glazed.quaternion.copy(rig.restGlazed).multiply(rig.turn);
  rig.lid?.updateMatrixWorld(true);
  rig.glazed?.updateMatrixWorld(true);
  // Le dessous de la tôle se voit dès que le capot quitte sa place (ouvert, ou vitré : son cadre).
  const side = merged || pose.style === 'depose' ? FrontSide : DoubleSide;
  if (rig.paint && rig.paint.side !== side) {
    rig.paint.side = side;
    rig.paint.needsUpdate = true;
  }
}

/**
 * Les pièces posées sur le capot (manifeste, `carries` : un aileron sur le capot moteur) passent sous
 * le nœud du capot (ou de sa variante vitrée), au même endroit : elles s'ouvrent avec lui ; capot
 * déposé, elles partent avec lui. Les pièces montées sont rangées dans la caisse sous le nom
 * `piece_<poste>` (./pieces.ts) ; leur repère est celui de la caisse.
 */
export function porterPieces(rig: CapotRig, body: Object3D, style: CapotStyle | null): void {
  const carrier = style === 'vitre' ? rig.glazed : rig.lid;
  const rest = style === 'vitre' ? rig.restGlazed : rig.restLid;
  for (const poste of rig.mount.carries ?? []) {
    const name = `piece_${poste}`;
    let group: Object3D | undefined;
    body.traverse((object) => {
      if (!group && object.name === name) group = object;
    });
    if (!group) continue;
    group.visible = style !== 'depose' && carrier !== null;
    if (!carrier || group.parent === carrier) continue;
    // Repère du capot au repos dans celui de la caisse, puis la pièce dans celui du capot.
    const turned = carrier.quaternion.clone();
    carrier.quaternion.copy(rest);
    body.updateMatrixWorld(true);
    const toBody = new Matrix4().copy(body.matrixWorld).invert().multiply(carrier.matrixWorld);
    carrier.quaternion.copy(turned);
    carrier.updateMatrixWorld(true);
    group.removeFromParent();
    group.matrix.copy(toBody).invert().decompose(group.position, group.quaternion, group.scale);
    carrier.add(group);
    group.updateMatrixWorld(true);
  }
}

