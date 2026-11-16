// Roues qui tournent en sortie de nuit (src/drive/scene/roues.ts) : axe pris dans le repère du
// véhicule et non du monde (le véhicule est déjà posé sur la route, cap quelconque), roue redressée
// (modèle à Z vers le haut, roues avant braquées : le cas du concept), et rotation sans voile.
import { CylinderGeometry, Group, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { rollingWheels } from '../../src/drive/scene/roues.ts';

/** Un véhicule posé sur la route (cap 1,2 rad), une roue dont le nœud vient d'un modèle à Z vers le haut, braquée de 30°. */
function setup(): { root: Group; node: Group; wheel: Mesh } {
  const road = new Group();
  road.rotation.y = 1.2;
  road.position.set(120, 40, -300);
  const root = new Group();
  road.add(root);
  const node = new Group();
  // Repère du modèle : Z vers le haut (−90° autour de X), roue braquée de 30° autour de la verticale du modèle.
  node.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 6));
  node.position.set(1.4, 0.35, 0.8);
  root.add(node);
  // Roue : cylindre d'axe X dans son nœud (essieu sur le côté du modèle d'origine).
  const wheel = new Mesh(new CylinderGeometry(0.35, 0.35, 0.25, 16).rotateZ(Math.PI / 2), new MeshBasicMaterial());
  node.add(wheel);
  return { root, node, wheel };
}

describe('roues qui tournent', () => {
  it('axe sur le côté du véhicule, quel que soit le cap sur la route', () => {
    const { root, node } = setup();
    const [w] = rollingWheels(root, [{ node, radius: 0.35 }]);
    expect(w).toBeDefined();
    root.updateWorldMatrix(true, true);
    const parentInRoot = root.getWorldQuaternion(new Quaternion()).invert().multiply(node.parent!.getWorldQuaternion(new Quaternion()));
    const side = w!.axis.clone().applyQuaternion(parentInRoot);
    expect(Math.abs(side.z)).toBeCloseTo(1, 5);
  });

  it('redressée puis tournée : l’essieu reste sur le côté, le centre ne bouge pas', () => {
    const { root, node } = setup();
    const [w] = rollingWheels(root, [{ node, radius: 0.35 }]);
    const centre = node.position.clone();
    for (const angle of [0, 0.7, 2.1, 4]) {
      node.quaternion.copy(new Quaternion().setFromAxisAngle(w!.axis, -angle).multiply(w!.base));
      const axle = new Vector3(1, 0, 0).applyQuaternion(node.quaternion).applyQuaternion(node.parent!.quaternion);
      // L'essieu du cylindre (X du nœud, puis Y du maillage tourné) : sur le côté du véhicule, sans voile.
      expect(Math.abs(axle.z), `angle ${angle}`).toBeCloseTo(1, 4);
      expect(node.position.distanceTo(centre)).toBe(0);
    }
  });

  it('sans redressement, l’ancien calcul (axe du monde) aurait fait tourner la roue de travers', () => {
    const { root, node } = setup();
    root.updateWorldMatrix(true, true);
    const parentWorld = node.parent!.getWorldQuaternion(new Quaternion());
    const worldAxisInParent = new Vector3(0, 0, 1).applyQuaternion(parentWorld.clone().invert());
    // Avec le véhicule au cap 1,2 rad, l'axe Z du monde n'est plus le côté du véhicule.
    expect(Math.abs(worldAxisInParent.z)).toBeLessThan(0.5);
  });

  it('une roue dont le pivot est loin de son centre reste fixe', () => {
    const { root, node, wheel } = setup();
    wheel.position.set(0.4, 0, 0);
    expect(rollingWheels(root, [{ node, radius: 0.35 }])).toEqual([]);
  });
});
