// Le véhicule de la sortie de nuit : celui du garage, avec les peintures de son build
// (src/state/builds.ts), préparé comme au garage (prepare et paintZones de
// src/scene/vehicle/VehicleModel.tsx) mais avec ses roues laissées à part pour tourner, ses phares
// allumés (deux projecteurs et leurs faisceaux dans l'air), ses feux arrière et stop, et son ombre
// de contact. La scène le pose sur le rail à chaque image par `DriveRig` (aucune allocation).
//
// Roues : celles que l'atelier pose sur les ancres roue_* (jante, pneu et cote du build, assiette
// comprise : src/scene/vehicle/wheels.ts), ou celles du modèle (nœuds roue_*, wheel_* ou listés par
// le manifeste) ; `prepare` les range à part de la caisse, jamais fusionnées. Chaque roue tourne
// autour de son axe (Z de son nœud), centre à l'origine du nœud ; une roue dont le pivot est loin du
// centre reste fixe. Un modèle sans roue roule roues fixes (dit par `rig.wheels.length === 0`).

import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  Box3,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  Quaternion,
  SpotLight,
  Vector3,
  type BufferGeometry,
  type Material,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { BASIS_TRANSCODER_DIR } from '../../data/bench.ts';
import { modelUrl } from '../../data/vehicles.ts';
import type { VehicleManifest } from '../../data/vehicleTypes.ts';
import { ATMOSPHERE_LAYER } from '../../render/layers.ts';
import { shadowSize, VehicleShadowRig } from '../../render/vehicleShadow.ts';
import { disposePrepared, paintZones, prepare, useVehicleWheels, WHEEL_NODE, type Prepared } from '../../scene/vehicle/VehicleModel.tsx';
import { resolvePaints, useBuilds } from '../../state/builds.ts';
import { createBeam } from './ciel.ts';
import { useHabitacle } from '../../scene/vehicle/habitacle.ts';

export { WHEEL_NODE };

/**
 * Chargeur propre à la sortie : son cache (useLoader, clé de classe) est distinct de celui du
 * garage, qui libère son modèle quand il le quitte. Le fichier vient du cache HTTP ou du service
 * worker : pas de second téléchargement réel.
 */
class DriveGLTFLoader extends GLTFLoader {}

let ktx2: KTX2Loader | null = null;
function ktx2Loader(gl: WebGLRenderer): KTX2Loader {
  ktx2 ??= new KTX2Loader().setTranscoderPath(`${import.meta.env.BASE_URL}${BASIS_TRANSCODER_DIR}`).detectSupport(gl);
  return ktx2;
}

export interface Wheel {
  node: Object3D;
  base: Quaternion;
  /** Axe de rotation dans le repère du parent du nœud. */
  axis: Vector3;
  radius: number;
}

/** Ce que la boucle de la scène pilote, image par image. */
export interface DriveRig {
  /** Posé sur le rail : position, cap et pente. */
  readonly group: Group;
  /** Dans `group` : roulis et plongée de caisse (l'ombre de contact reste au sol). */
  readonly body: Group;
  wheels: Wheel[];
  /** Angle de roulement cumulé, en radians par mètre de rayon (distance parcourue). */
  distance: number;
  measure: { halfLength: number; halfWidth: number; height: number } | null;
  /** Feux arrière (matières clonées, à nous) : intensité au repos, et au freinage. */
  tails: MeshStandardMaterial[];
  tailBase: number;
  tailLight: PointLight | null;
  /** Milieu des phares dans le repère du véhicule, et direction du faisceau. */
  readonly headLocal: Vector3;
  readonly headDirLocal: Vector3;
  beamGain: { value: number };
}

export function createRig(): DriveRig {
  const group = new Group();
  group.name = 'sortie_vehicule';
  group.rotation.order = 'YZX';
  const body = new Group();
  body.rotation.order = 'XZY';
  group.add(body);
  return {
    group,
    body,
    wheels: [],
    distance: 0,
    measure: null,
    tails: [],
    tailBase: 10,
    tailLight: null,
    headLocal: new Vector3(2, 0.7, 0),
    headDirLocal: new Vector3(1, -0.06, 0).normalize(),
    beamGain: { value: 0.05 },
  };
}

const axisWork = new Quaternion();

/** Fait tourner les roues de la distance parcourue (aucune allocation). */
export function rollWheels(rig: DriveRig, meters: number): void {
  rig.distance += meters;
  for (let i = 0; i < rig.wheels.length; i += 1) {
    const w = rig.wheels[i] as Wheel;
    axisWork.setFromAxisAngle(w.axis, -rig.distance / w.radius);
    w.node.quaternion.multiplyQuaternions(axisWork, w.base);
  }
}

interface DrivePrepared {
  prepared: Prepared;
  tails: MeshStandardMaterial[];
  owned: { geometries: BufferGeometry[]; materials: Material[] };
}

/**
 * Roues qui tournent, d'après les nœuds rangés à part par `prepare` (et garnis par l'atelier) :
 * axe Z du parent, rayon de la roue posée.
 */
export function rollingWheels(prepared: Prepared, spins: ReadonlyArray<{ node: Object3D; radius: number }>): Wheel[] {
  prepared.root.updateMatrixWorld(true);
  const wheels: Wheel[] = [];
  const box = new Box3();
  const center = new Vector3();
  const origin = new Vector3();
  const parentQ = new Quaternion();
  for (const { node, radius } of spins) {
    if (!node.parent) continue;
    box.setFromObject(node, true);
    if (box.isEmpty()) continue;
    box.getCenter(center);
    node.getWorldPosition(origin);
    // Un pivot loin du centre ferait voiler la roue : elle reste fixe.
    if (origin.distanceTo(center) > 0.05) continue;
    node.parent.getWorldQuaternion(parentQ);
    const axis = new Vector3(0, 0, 1).applyQuaternion(parentQ.invert()).normalize();
    wheels.push({ node, base: node.quaternion.clone(), axis, radius: Math.max(0.1, radius) });
  }
  return wheels;
}

/** `prepare` du garage (roues rangées à part), feux à nous. */
export function prepareForDrive(source: Group, vehicle: VehicleManifest): DrivePrepared {
  const prepared = prepare(source, vehicle);
  prepared.root.updateMatrixWorld(true);
  // Feux arrière : une copie de la matière par modèle, pour les allumer au freinage sans toucher au
  // garage (les matières des rôles sont partagées par le cache de chargement).
  const tailClones = new Map<Material, MeshStandardMaterial>();
  prepared.root.traverse((o) => {
    if (!(o instanceof Mesh) || Array.isArray(o.material)) return;
    const m = o.material as Material;
    if (m.name !== 'tail' || !(m instanceof MeshStandardMaterial)) return;
    let clone = tailClones.get(m);
    if (!clone) {
      clone = m.clone();
      tailClones.set(m, clone);
    }
    o.material = clone;
  });
  const tails = [...tailClones.values()];
  return { prepared, tails, owned: { geometries: [], materials: tails } };
}

function disposeDrive(p: DrivePrepared): void {
  disposePrepared(p.prepared);
  for (const g of p.owned.geometries) g.dispose();
  for (const m of p.owned.materials) m.dispose();
}

/** Ce que le modèle posé donne au moteur de la scène (src/drive/scene/moteur.ts, setModel). */
export interface DriveModel {
  wheels: Wheel[];
  tails: MeshStandardMaterial[];
  tailLight: PointLight;
  measure: { halfLength: number; halfWidth: number; height: number };
  /** Milieu des phares, dans le repère du véhicule. */
  head: Vector3;
}

interface DriveVehicleProps {
  vehicle: VehicleManifest;
  /** Groupes posés par le moteur ; le composant n'y met que le modèle, ses lumières et son ombre. */
  rig: DriveRig;
  /** Part du reflet de l'environnement sur la carrosserie. */
  bodyEnv: number;
  beams: boolean;
  /** Appelé une fois le modèle posé, et avec `null` quand il s'en va. */
  onModel: (model: DriveModel | null) => void;
}

/** Le véhicule posé dans `rig.body`. À monter sous Suspense et un garde-fou (SceneBoundary). */
export function DriveVehicle({ vehicle, rig, bodyEnv, beams, onModel }: DriveVehicleProps) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene) as Scene;
  const gltf = useLoader(DriveGLTFLoader, modelUrl(vehicle), (loader) => {
    loader.setKTX2Loader(ktx2Loader(gl));
  });
  const drive = useMemo(() => prepareForDrive(gltf.scene, vehicle), [gltf, vehicle]);
  useEffect(() => () => disposeDrive(drive), [drive]);
  // Libère le modèle chargé quand la sortie se termine (cache propre à la sortie).
  useEffect(
    () => () => {
      window.setTimeout(() => {
        gltf.scene.traverse((o) => {
          if (o instanceof Mesh) o.geometry.dispose();
        });
        useLoader.clear(DriveGLTFLoader, modelUrl(vehicle));
      }, 0);
    },
    [gltf, vehicle],
  );
  const build = useBuilds((state) => state.builds[vehicle.id]);
  const paints = useMemo(() => resolvePaints(vehicle, build), [vehicle, build]);
  useLayoutEffect(() => paintZones(drive.prepared.zones, paints, bodyEnv), [drive, paints, bodyEnv]);
  // Jantes, pneus et assiette du build, posés comme au garage ; les roues tournent avec leur ancre.
  const invalidate = useThree((state) => state.invalidate);
  const { stamp, spins } = useVehicleWheels(drive.prepared, vehicle, invalidate, { merge: false });
  // Volant, pommeau et sièges du build, posés comme au garage (sinon l'habitacle serait vide).
  useHabitacle(drive.prepared, vehicle, invalidate);
  const wheels = useMemo(() => rollingWheels(drive.prepared, spins), [drive, spins]);

  const { halfLength, halfWidth, height } = drive.prepared;
  const isBike = vehicle.kind === 'bike';
  // Phares : deux projecteurs (un pour une moto) aux coins avant, visés à 25 m devant, un peu bas.
  const lights = useMemo(() => {
    const g = new Group();
    g.name = 'phares';
    const y = isBike ? Math.min(1.05, height * 0.72) : Math.min(0.75, height * 0.42);
    const x = halfLength - 0.08;
    const sides = isBike ? [0] : [-(halfWidth - 0.28), halfWidth - 0.28];
    const spots: SpotLight[] = [];
    for (const z of sides) {
      const spot = new SpotLight('#fff1dc', isBike ? 3400 : 2400, 110, 0.42, 0.55, 2);
      spot.position.set(x, y, z);
      spot.target.position.set(x + 25, 0, z * 1.6);
      g.add(spot, spot.target);
      spots.push(spot);
    }
    const beamMeshes = sides.map((z) => {
      const beam = createBeam(rig.beamGain);
      beam.position.set(x + 0.05, y, z);
      beam.rotation.z = -0.07;
      beam.layers.set(ATMOSPHERE_LAYER);
      return beam;
    });
    // Lueur rouge des feux arrière sur la chaussée (plus forte au freinage).
    const tail = new PointLight('#ff1a08', 2.5, 9, 2);
    tail.position.set(-halfLength - 0.4, Math.min(0.8, height * 0.45), 0);
    g.add(tail);
    return { group: g, spots, beamMeshes, tail, y, x };
  }, [halfLength, halfWidth, height, isBike, rig.beamGain]);
  useEffect(
    () => () => {
      for (const b of lights.beamMeshes) {
        b.geometry.dispose();
        b.material.dispose();
      }
      for (const s of lights.spots) s.dispose();
      lights.tail.dispose();
    },
    [lights],
  );

  // Ombre de contact (src/render/vehicleShadow.ts), rendue une fois, au sol sous la caisse.
  const shadow = useMemo(() => new VehicleShadowRig(shadowSize({ halfLength, halfWidth, height })), [halfLength, halfWidth, height]);
  useEffect(() => () => shadow.dispose(), [shadow]);
  const pending = useRef(true);
  useLayoutEffect(() => {
    pending.current = true;
    shadow.compile(gl);
  }, [gl, shadow, stamp]);
  useFrame(() => {
    if (!pending.current) return;
    pending.current = false;
    shadow.render(gl, drive.prepared.root, scene);
  });

  useLayoutEffect(() => {
    onModel({ wheels, tails: drive.tails, tailLight: lights.tail, measure: { halfLength, halfWidth, height }, head: new Vector3(lights.x, lights.y, 0) });
    return () => onModel(null);
  }, [drive, wheels, lights, halfLength, halfWidth, height, onModel]);

  return (
    <primitive object={rig.group} dispose={null}>
      <primitive object={shadow.root} dispose={null} />
      <primitive object={rig.body} dispose={null}>
        <primitive object={drive.prepared.root} dispose={null} />
        <primitive object={lights.group} dispose={null} />
        {beams && lights.beamMeshes.map((b) => <primitive key={b.uuid} object={b} dispose={null} />)}
      </primitive>
    </primitive>
  );
}
