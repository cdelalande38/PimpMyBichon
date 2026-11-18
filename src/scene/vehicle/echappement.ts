// Finition des sorties d'échappement (chrome, noir, bleui : src/data/echappement.ts), au garage comme en
// sortie. Seulement sur un modèle qui range ses sorties dans des nœuds à part, nommés par le manifeste
// (`exhaust.nodes`) : leurs pièces de métal (rôles chrome et alu) reçoivent à la préparation une matière
// à elles (`MATIERE_SORTIE`), fusionnée à part des autres chromes (un appel de dessin de plus) ; la
// finition du build la règle ensuite (couleur, métal, rugosité, part du reflet). Aucune géométrie ajoutée.

import { useLayoutEffect, useMemo } from 'react';
import { Mesh, MeshStandardMaterial, type Material, type Object3D } from 'three';
import { finitionDe, POSTE_ECHAPPEMENT, type FinitionEchappement } from '../../data/echappement.ts';
import type { FinishId } from '../../data/finishes.ts';
import { materialRole } from '../../data/materialRoles.ts';
import type { VehicleManifest } from '../../data/vehicleTypes.ts';
import { useBuilds } from '../../state/builds.ts';

/** Nom de la matière propre aux pièces de métal des sorties. */
export const MATIERE_SORTIE = 'echappement_sortie';

/** Rôles des pièces qui prennent la finition : le métal nu. */
const METAUX: ReadonlySet<string> = new Set(['chrome', 'alu']);

/**
 * À la préparation (src/scene/vehicle/VehicleModel.tsx, `prepare`, avant la fusion par matériau) : les
 * pièces de métal des nœuds `exhaust.nodes` reçoivent une copie de leur matière, nommée `MATIERE_SORTIE`
 * (une par matière d'origine), rangée dans `owned`. Rend le nombre de pièces touchées.
 */
export function separerEchappement(scene: Object3D, vehicle: Pick<VehicleManifest, 'exhaust'>, owned: Material[]): number {
  const nodes = vehicle.exhaust?.nodes ?? [];
  if (nodes.length === 0) return 0;
  const copies = new Map<Material, MeshStandardMaterial>();
  let count = 0;
  const swap = (material: Material): Material => {
    const role = materialRole(material.name);
    if (!role || !METAUX.has(role.id) || !(material instanceof MeshStandardMaterial)) return material;
    let copy = copies.get(material);
    if (!copy) {
      copy = material.clone();
      copy.name = MATIERE_SORTIE;
      copies.set(material, copy);
      owned.push(copy);
    }
    count += 1;
    return copy;
  };
  for (const name of nodes) {
    scene.getObjectByName(name)?.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.material = Array.isArray(object.material) ? (object.material as Material[]).map(swap) : swap(object.material as Material);
    });
  }
  return count;
}

/** Matières des sorties d'un modèle préparé. */
export function matieresSortie(root: Object3D): MeshStandardMaterial[] {
  const found = new Set<MeshStandardMaterial>();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    for (const material of Array.isArray(object.material) ? (object.material as Material[]) : [object.material as Material]) {
      if (material instanceof MeshStandardMaterial && material.name === MATIERE_SORTIE) found.add(material);
    }
  });
  return [...found];
}

/** Pose une finition sur les matières des sorties. */
export function poserFinition(materials: readonly MeshStandardMaterial[], finition: FinitionEchappement): void {
  for (const material of materials) {
    material.color.set(finition.rendu.color);
    material.metalness = finition.rendu.metalness;
    material.roughness = finition.rendu.roughness;
    material.envMapIntensity = finition.rendu.envMapIntensity;
  }
}

/** La finition du build sur les sorties du modèle préparé ; une image redemandée à chaque changement. */
export function useFinitionEchappement(root: Object3D, vehicle: VehicleManifest, invalidate: () => void): void {
  const finish = useBuilds((state) => state.builds[vehicle.id]?.partPaints?.[POSTE_ECHAPPEMENT]?.finish);
  const materials = useMemo(() => matieresSortie(root), [root]);
  useLayoutEffect(() => {
    if (materials.length === 0) return;
    poserFinition(materials, finitionDe({ partPaints: finish ? { [POSTE_ECHAPPEMENT]: { finish: finish as FinishId } } : undefined }));
    invalidate();
  }, [materials, finish, invalidate]);
}
