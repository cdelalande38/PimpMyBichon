// Phares du véhicule (Custom › Phares, src/data/phares.ts), au garage comme en sortie : la lueur des
// optiques avant prend la couleur choisie, leur glace la teinte (clair à fumé), les feux arrière
// passent au fumé. Les optiques sont reconnues par le nom de leurs matériaux (section `lights` du
// manifeste, sinon les rôles `lamp` et `tail`) ; aucun nom de véhicule ici. Les voyants de l'habitacle
// faits de la même matière (nœuds `lights.interior`) en reçoivent une copie à la préparation et restent
// hors des réglages.
//
// Les matériaux des rôles sont partagés par le cache de chargement (src/scene/vehicle/VehicleModel.tsx) :
// on travaille sur des copies, à nous, posées à leur place sur le modèle préparé, et libérées avec lui.
// Les feux arrière de la sortie sont déjà des copies (src/drive/scene/vehicule.tsx, prepareForDrive) :
// on les règle sur place. Le réglage d'origine de chaque copie est gardé dans `userData`, pour qu'un
// second passage (double montage du mode strict de React) reparte de lui et non d'un réglage déjà
// appliqué. Rien n'est alloué une fois les copies faites : un changement de réglage recopie des
// couleurs déjà là.

import { useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import { AddEquation, Color, ConstantColorFactor, CustomBlending, Mesh, MeshStandardMaterial, OneFactor, type Material, type Object3D } from 'three';
import { beamTint, COULEURS_PHARES, couleurPhares, interiorLightNodes, lightNamed, lightsOf, optionFeux, OPTIONS_FEUX, resolvePhares, TEINTE_OPTIQUES, type CouleurPhares, type PharesChoisis } from '../../data/phares.ts';
import type { VehicleLights, VehicleManifest } from '../../data/vehicleTypes.ts';
import { useBuilds } from '../../state/builds.ts';

const ORIGINE = 'pmbPhares';
/** Marque (dans `userData`, copiée avec la matière) d'une matière d'optique posée sur un voyant de l'habitacle. */
export const VOYANT = 'pmbVoyant';

/** Une matière d'optique portée par un voyant de l'habitacle (./separerVoyants) : hors des réglages. */
export function isVoyant(material: Material): boolean {
  return material.userData[VOYANT] === true;
}

/**
 * À la préparation (src/scene/vehicle/VehicleModel.tsx, `prepare`, avant la fusion par matière) : les
 * pièces des nœuds `lights.interior` du manifeste (l'habitacle) qui portent la matière d'une optique
 * avant ou d'un feu arrière (voyants, accents rouges de la planche de bord) en reçoivent une copie, à
 * elles, marquée `VOYANT` et rangée dans `owned` : fusionnées à part (un appel de dessin de plus), elles
 * gardent leur lueur quand les feux passent au fumé ou que l'éclairage change de couleur. Le nom ne
 * change pas : en sortie, le rôle reste celui des feux (src/drive/scene/vehicule.tsx). Rend le nombre
 * de pièces touchées.
 */
export function separerVoyants(scene: Object3D, vehicle: Pick<VehicleManifest, 'lights'>, owned: Material[]): number {
  const nodes = interiorLightNodes(vehicle);
  if (nodes.length === 0) return 0;
  const names = lightsOf(vehicle);
  const copies = new Map<Material, MeshStandardMaterial>();
  let count = 0;
  const swap = (material: Material): Material => {
    if (!(material instanceof MeshStandardMaterial) || isVoyant(material)) return material;
    if (!lightNamed(material.name, names.front) && !lightNamed(material.name, names.rear)) return material;
    let copy = copies.get(material);
    if (!copy) {
      copy = material.clone();
      copy.userData[VOYANT] = true;
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

/** Réglage d'origine d'une optique, gardé dans `userData` (copié tel quel avec le matériau). */
interface Origine {
  color: [number, number, number];
  emissive: [number, number, number];
  intensity: number;
}

/** Une optique réglable : son matériau (à nous) et son réglage d'origine. */
export interface LampSlot {
  material: MeshStandardMaterial;
  color: Color;
  emissive: Color;
  intensity: number;
}

export interface LightsRig {
  front: LampSlot[];
  rear: LampSlot[];
  /** Copies faites ici (à libérer). */
  owned: MeshStandardMaterial[];
}

function originOf(material: MeshStandardMaterial): Origine {
  const kept = material.userData[ORIGINE] as Origine | undefined;
  if (kept) return kept;
  const origin: Origine = {
    color: [material.color.r, material.color.g, material.color.b],
    emissive: [material.emissive.r, material.emissive.g, material.emissive.b],
    intensity: material.emissiveIntensity,
  };
  material.userData[ORIGINE] = origin;
  return origin;
}

/**
 * Optiques du modèle posé sous `root` : celles d'avant et les feux arrière, chacune sur une copie de
 * son matériau (`clone`), ou sur le matériau même s'il est déjà à nous. Un matériau déjà copié par
 * un passage précédent (il porte son réglage d'origine) est repris, pas recopié.
 */
export function createLightsRig(root: Object3D, names: VehicleLights, clone: { front: boolean; rear: boolean }): LightsRig {
  const rig: LightsRig = { front: [], rear: [], owned: [] };
  const done = new Map<Material, MeshStandardMaterial>();
  const take = (material: Material): Material => {
    if (!(material instanceof MeshStandardMaterial) || isVoyant(material)) return material;
    const side = lightNamed(material.name, names.front) ? 'front' : lightNamed(material.name, names.rear) ? 'rear' : null;
    if (!side) return material;
    const known = done.get(material);
    if (known) return known;
    const ours = material.userData[ORIGINE] !== undefined;
    const target = clone[side] && !ours ? material.clone() : material;
    if (clone[side]) rig.owned.push(target);
    const origin = originOf(target);
    rig[side].push({ material: target, color: new Color().fromArray(origin.color), emissive: new Color().fromArray(origin.emissive), intensity: origin.intensity });
    done.set(material, target);
    done.set(target, target);
    return target;
  };
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.material = Array.isArray(object.material) ? (object.material as Material[]).map(take) : take(object.material as Material);
  });
  return rig;
}

export function disposeLightsRig(rig: LightsRig): void {
  for (const material of rig.owned) material.dispose();
}

// Couleurs des réglages, faites une fois (linéaires, comme celles des matériaux).
const LUEURS = new Map<string, Color>(COULEURS_PHARES.map((item) => [item.id, new Color(item.color)]));
const GLACES = new Map<string, Color>(OPTIONS_FEUX.filter((item) => item.glace).map((item) => [item.id, new Color(item.glace)]));
const FUMEE = new Color(TEINTE_OPTIQUES.color);

/** Pose les réglages choisis sur les optiques (sans allocation). */
export function applyLights(rig: LightsRig, choisis: PharesChoisis): void {
  const t = choisis.teinte;
  const lueur = choisis.couleur.origine ? null : LUEURS.get(choisis.couleur.id);
  for (const slot of rig.front) {
    const m = slot.material;
    m.color.copy(slot.color).lerp(FUMEE, TEINTE_OPTIQUES.mix * t);
    m.emissive.copy(lueur ?? slot.emissive);
    m.emissiveIntensity = slot.intensity * choisis.couleur.lueur * (1 - (1 - TEINTE_OPTIQUES.emission) * t);
  }
  const glace = GLACES.get(choisis.feux.id);
  for (const slot of rig.rear) {
    const m = slot.material;
    if (glace) m.color.copy(glace);
    else m.color.copy(slot.color);
    m.emissive.copy(slot.emissive);
    m.emissiveIntensity = slot.intensity * choisis.feux.lueur;
  }
}

/**
 * Faisceau dans l'air et éblouissement d'un phare (src/drive/scene/ciel.ts) teintés de la couleur
 * choisie sans toucher à leurs nuanceurs : le mélange additif passe par un facteur constant
 * (`blendColor`), le blanc pour l'origine. Même calcul que le mélange additif de three.js.
 */
export function tintAdditive(material: Material, couleur: CouleurPhares): void {
  material.blending = CustomBlending;
  material.blendEquation = AddEquation;
  material.blendSrc = ConstantColorFactor;
  material.blendDst = OneFactor;
  material.blendEquationAlpha = AddEquation;
  material.blendSrcAlpha = OneFactor;
  material.blendDstAlpha = OneFactor;
  if (couleur.origine) material.blendColor.setRGB(1, 1, 1);
  else {
    const [r, g, b] = beamTint(couleur.color);
    material.blendColor.setRGB(r, g, b);
  }
}

/** Couleur sRGB d'une lueur, pour les attributs des parcours. */
function hexOf(color: Color): string {
  return `#${color.getHexString()}`;
}

/**
 * Les phares du build sur le modèle posé : copies faites à la préparation, réglages posés à chaque
 * changement (une image redemandée), attributs `data-phares`, `data-phares-teinte`, `data-feux` et
 * `data-phares-optique` (lueur réellement posée sur la première optique avant) sur l'élément de la
 * scène (classe `stageClass`), pour les parcours. Rend les réglages en cours.
 */
export function useVehicleLights(root: Object3D, vehicle: VehicleManifest, options: { cloneRear: boolean; stageClass: string; invalidate: () => void }): PharesChoisis {
  const { cloneRear, stageClass, invalidate } = options;
  const gl = useThree((state) => state.gl);
  const rig = useMemo(() => createLightsRig(root, lightsOf(vehicle), { front: true, rear: cloneRear }), [root, vehicle, cloneRear]);
  useEffect(() => () => disposeLightsRig(rig), [rig]);
  const build = useBuilds((state) => state.builds[vehicle.id]);
  const resolved = resolvePhares(build);
  const couleurId = resolved.couleur.id;
  const teinte = resolved.teinte;
  const feuxId = resolved.feux.id;
  const choisis = useMemo<PharesChoisis>(() => ({ couleur: couleurPhares(couleurId), teinte, feux: optionFeux(feuxId) }), [couleurId, teinte, feuxId]);
  useLayoutEffect(() => {
    applyLights(rig, choisis);
    invalidate();
    const stage = gl.domElement.closest<HTMLElement>(`.${stageClass}`);
    if (!stage) return undefined;
    stage.dataset.phares = choisis.couleur.id;
    stage.dataset.pharesTeinte = String(Math.round(choisis.teinte * 100));
    stage.dataset.feux = choisis.feux.id;
    const first = rig.front[0]?.material;
    if (first) stage.dataset.pharesOptique = hexOf(first.emissive);
    return () => {
      delete stage.dataset.phares;
      delete stage.dataset.pharesTeinte;
      delete stage.dataset.feux;
      delete stage.dataset.pharesOptique;
    };
  }, [rig, choisis, invalidate, gl, stageClass]);
  return choisis;
}
