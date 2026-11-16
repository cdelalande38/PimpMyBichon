// Le véhicule de la sortie de nuit : celui du garage, avec les peintures de son build
// (src/state/builds.ts), préparé comme au garage (prepare et paintZones de
// src/scene/vehicle/VehicleModel.tsx) mais avec ses roues laissées à part pour tourner, ses phares
// allumés (le faisceau sur le décor est calculé par les matières de nuit, src/drive/scene/materiaux.ts ;
// ici, ses cônes dans l'air et l'éblouissement vu de face), ses feux arrière et stop, et son ombre
// de contact. La scène le pose sur le rail à chaque image par `DriveRig` (aucune allocation).
//
// Roues : celles que l'atelier pose sur les ancres roue_* (jante, pneu et cote du build, assiette
// comprise : src/scene/vehicle/wheels.ts), ou celles du modèle (nœuds roue_*, wheel_* ou listés par
// le manifeste) ; `prepare` les range à part de la caisse, jamais fusionnées. Chaque roue est
// redressée puis tourne autour du côté du véhicule, centre à l'origine de son nœud (src/drive/scene/
// roues.ts) ; une roue dont le pivot est loin du centre reste fixe. Un modèle sans roue roule roues
// fixes (dit par `rig.wheels.length === 0`).

import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  Box3,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  Quaternion,
  Raycaster,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { BASIS_TRANSCODER_DIR } from '../../data/bench.ts';
import { modelUrl, placeOf } from '../../data/vehicles.ts';
import type { InteriorView, VehicleManifest } from '../../data/vehicleTypes.ts';
import { ATMOSPHERE_LAYER } from '../../render/layers.ts';
import { shadowSize, VehicleShadowRig } from '../../render/vehicleShadow.ts';
import { disposePrepared, paintZones, prepare, useVehicleWheels, WHEEL_NODE, type Prepared } from '../../scene/vehicle/VehicleModel.tsx';
import { resolvePaints, useBuilds } from '../../state/builds.ts';
import { createBeam, createGlare } from './ciel.ts';
import { useHabitacle } from '../../scene/vehicle/habitacle.ts';
import { DEFAULT_SEAT, placeEye, seatMetrics, type PlacedSeat } from '../../scene/fit.ts';
import { bodyPoint, STILL_BODY, useBodyPose } from '../../scene/vehicle/wheels.ts';
import { cockpit } from '../cameras.ts';
import { rollingWheels, type Wheel } from './roues.ts';

export { WHEEL_NODE, rollingWheels };
export type { Wheel };

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
  /** Milieu des phares dans le repère du véhicule, direction du faisceau, demi-écart des deux phares (0 : un seul). */
  readonly headLocal: Vector3;
  readonly headDirLocal: Vector3;
  headSpread: number;
  beamGain: { value: number };
  /** Éblouissement des phares vus de face. */
  glareGain: { value: number };
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
    // Le faisceau est réglé sur l'horizontale du véhicule : sa coupure est dans la forme (materiaux.ts).
    headDirLocal: new Vector3(1, 0, 0),
    headSpread: 0.65,
    beamGain: { value: 0.05 },
    glareGain: { value: 1 },
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

/** Lancer de rayon qui voit les deux faces (un dossier vu de face, un pavillon vu d'en dessous). */
function castBoth(targets: readonly Object3D[], origin: Vector3, direction: Vector3, skip: (object: Object3D) => boolean): number | null {
  const changed: Array<[Material, Material['side']]> = [];
  for (const target of targets) {
    target.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      for (const material of Array.isArray(object.material) ? (object.material as Material[]) : [object.material as Material]) {
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
const posedPiece = (object: Object3D) => {
  for (let node: Object3D | null = object; node; node = node.parent) if (node.name === POSED) return true;
  return false;
};

/**
 * Œil de la place `view` dans le repère du véhicule, caisse au repos : posé sur les sièges du modèle
 * (ancres, siège posé mesuré au rayon, pavillon au-dessus), ou repris du manifeste pour un vrai
 * modèle sans ancres. Même résolution qu'au garage (src/scene/GarageCanvas.tsx, resolvePlace).
 * `pending` : un siège attendu n'est pas encore posé.
 */
function seatedEye(root: Object3D, view: InteriorView): { eye: [number, number, number] | null; pending: boolean } {
  const body = root.getObjectByName('caisse');
  if (!view.seat || !body) return { eye: view.eye ? [view.eye[0], view.eye[1], view.eye[2]] : null, pending: false };
  body.updateWorldMatrix(true, true);
  const toBody = body.matrixWorld.clone().invert();
  const turn = body.getWorldQuaternion(new Quaternion());
  const toWorld = (x: number, y: number, z: number) => new Vector3(x, y, z).applyMatrix4(body.matrixWorld);
  const seats: PlacedSeat[] = [];
  let pending = false;
  for (const name of view.seat.anchors) {
    const anchor = root.getObjectByName(name);
    if (!anchor) continue;
    const at = anchor.getWorldPosition(new Vector3()).applyMatrix4(toBody);
    const pose = anchor.children.find((child) => child.name === POSED);
    let metrics = DEFAULT_SEAT;
    if (pose) {
      const box = new Box3();
      const v = new Vector3();
      pose.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        const position = object.geometry.getAttribute('position');
        if (!position) return;
        const toAnchor = toBody.clone().multiply(object.matrixWorld);
        for (let i = 0; i < position.count; i += 1) box.expandByPoint(v.fromBufferAttribute(position, i).applyMatrix4(toAnchor).sub(at));
      });
      if (!box.isEmpty()) {
        metrics = seatMetrics(
          (origin, direction) => castBoth([pose], toWorld(at.x + origin[0], at.y + origin[1], at.z + origin[2]), new Vector3(...direction).applyQuaternion(turn), () => false),
          { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] },
          view.seat.up,
        );
      }
    } else pending = true;
    seats.push({ anchor: [at.x, at.y, at.z], metrics });
  }
  const roof = (x: number, z: number, from: number) => {
    const d = castBoth([body], toWorld(x, from, z), new Vector3(0, 1, 0).applyQuaternion(turn), posedPiece);
    return d === null ? null : from + d;
  };
  return { eye: placeEye(view.seat, seats, roof) ?? (view.eye ? [view.eye[0], view.eye[1], view.eye[2]] : null), pending };
}

/** Ce que le modèle posé donne au moteur de la scène (src/drive/scene/moteur.ts, setModel). */
export interface DriveModel {
  wheels: Wheel[];
  tails: MeshStandardMaterial[];
  tailLight: PointLight;
  measure: { halfLength: number; halfWidth: number; height: number };
  /** Milieu des phares, dans le repère du véhicule, et demi-écart des deux phares (0 pour une moto). */
  head: Vector3;
  headSpread: number;
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
  const wheels = useMemo(() => rollingWheels(drive.prepared.root, spins), [drive, spins]);

  // Caméra embarquée (src/drive/cameras.ts, cockpit) : à la place du conducteur du manifeste, posée
  // sur son siège dans le modèle chargé, comme au garage ; résolue une fois le siège posé.
  const seated = useRef(false);
  useLayoutEffect(() => {
    seated.current = false;
    cockpit.eye = null;
    return () => {
      cockpit.eye = null;
    };
  }, [drive, vehicle]);
  useFrame(() => {
    if (seated.current) return;
    const driver = vehicle.kind === 'bike' ? null : placeOf(vehicle, 'conducteur');
    if (!driver) {
      seated.current = true;
      return;
    }
    // Siège attendu pas encore posé : on n'y relance les rayons qu'à son arrivée (une fois l'œil d'attente posé).
    const anchors = driver.view.seat?.anchors.map((name) => drive.prepared.root.getObjectByName(name)) ?? [];
    const waiting = anchors.some((anchor) => anchor && !anchor.children.some((child) => child.name === POSED));
    if (waiting && cockpit.eye) return;
    const { eye, pending } = seatedEye(drive.prepared.root, driver.view);
    cockpit.eye = eye ? bodyPoint(eye, useBodyPose.getState().poses[vehicle.id] ?? STILL_BODY) : null;
    seated.current = !pending;
  });

  const { halfLength, halfWidth, height } = drive.prepared;
  const isBike = vehicle.kind === 'bike';
  // Phares : un ou deux feux aux coins avant. Leur lumière sur le décor est calculée par les matières
  // de nuit (forme d'un feu de croisement) ; ici, leurs cônes dans l'air et leur éblouissement.
  const lights = useMemo(() => {
    const g = new Group();
    g.name = 'phares';
    const y = isBike ? Math.min(1.05, height * 0.72) : Math.min(0.75, height * 0.42);
    const x = halfLength - 0.08;
    const spread = isBike ? 0 : Math.max(0.3, halfWidth - 0.28);
    const sides = isBike ? [0] : [-spread, spread];
    const beamMeshes = sides.map((z) => {
      const beam = createBeam(rig.beamGain);
      beam.position.set(x + 0.05, y, z);
      beam.rotation.z = -0.03;
      beam.layers.set(ATMOSPHERE_LAYER);
      return beam;
    });
    const glares = sides.map((z) => {
      const glare = createGlare(rig.glareGain);
      glare.position.set(x + 0.12, y, z);
      glare.layers.set(ATMOSPHERE_LAYER);
      g.add(glare);
      return glare;
    });
    // Lueur rouge des feux arrière sur la chaussée (plus forte au freinage).
    const tail = new PointLight('#ff1a08', 5, 15, 2);
    tail.position.set(-halfLength - 0.35, Math.min(0.7, height * 0.4), 0);
    g.add(tail);
    return { group: g, beamMeshes, glares, tail, y, x, spread };
  }, [halfLength, halfWidth, height, isBike, rig.beamGain, rig.glareGain]);
  useEffect(
    () => () => {
      for (const b of [...lights.beamMeshes, ...lights.glares]) {
        b.geometry.dispose();
        b.material.dispose();
      }
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
    onModel({ wheels, tails: drive.tails, tailLight: lights.tail, measure: { halfLength, halfWidth, height }, head: new Vector3(lights.x, lights.y, 0), headSpread: lights.spread });
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
