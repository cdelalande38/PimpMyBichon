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
// fixes (dit par `rig.wheels.length === 0`). Les roues avant braquent du braquage du pilote, amplifié
// pour l'image (`wheelSteer`) ; une moto tourne aussi sa fourche, son guidon et ses poignées.

import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  Box3,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  ShaderMaterial,
  SpotLight,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Camera,
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
import { HEADLIGHT } from './materiaux.ts';
import { routeLight } from '../../data/phares.ts';
import { tintAdditive, useVehicleLights } from '../../scene/vehicle/phares.ts';
import { useHabitacle } from '../../scene/vehicle/habitacle.ts';
import { DEFAULT_SEAT, placeEye, seatMetrics, type PlacedSeat } from '../../scene/fit.ts';
import { bodyPoint, STILL_BODY, useBodyPose } from '../../scene/vehicle/wheels.ts';
import { TableauVivant } from '../../scene/vehicle/tableau.ts';
import { cockpit } from '../cameras.ts';
import { bikeSteering, follow, liftStands, rollingWheels, steeringWheelPart, steerParts, wheelSteer, type SteeringPart, type Wheel } from './roues.ts';
import { PILOT } from '../pilote.ts';
import { DRIVER_POSE, driverSpecOf } from '../../data/conducteur.ts';
import { INTERIOR_CATALOGUE } from '../../data/habitacle.ts';
import { livePilot } from '../../state/drive.ts';
import { DRIVE_STAGE_CLASS } from '../contrat.ts';
import { hideForCockpit, measureSeating, mountDriver, seatDriver, unmountDriver, useDriverRig, type DriverHandle } from '../../scene/vehicle/conducteur.ts';
import type { DriverMotion } from '../../scene/vehicle/conducteur-pose.ts';

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
  /** Fourche, guidon et poignées d'une moto, tournés avec sa roue avant (vide pour une voiture). */
  steering: SteeringPart[];
  /** Angle de roulement cumulé, en radians par mètre de rayon (distance parcourue). */
  distance: number;
  /** Distance de plus des roues motrices qui patinent (m, src/drive/scene/roues.ts, `roueEnPlus`). */
  spun: number;
  measure: { halfLength: number; halfWidth: number; height: number } | null;
  /** Feux arrière (matières clonées, à nous) : intensité au repos, et au freinage. */
  tails: MeshStandardMaterial[];
  tailBase: number;
  tailLight: SpotLight | null;
  /** Milieu des phares dans le repère du véhicule, direction du faisceau, demi-écart des deux phares (0 : un seul). */
  readonly headLocal: Vector3;
  readonly headDirLocal: Vector3;
  headSpread: number;
  beamGain: { value: number };
  /** Éblouissement des phares vus de face. */
  glareGain: { value: number };
  /** Ombre portée par l'astre (le jour) : l'empreinte de l'ombre de contact, décalée au sol par le moteur de la scène. */
  cast: { mesh: Mesh; material: ShaderMaterial } | null;
}

/**
 * Lumière des feux arrière : un projecteur posé `back` m derrière la caisse, à la hauteur des feux
 * (`height` m au plus, `heightShare` de la hauteur du véhicule), tourné vers la route `aim` m plus
 * loin ; cône de `angle` rad (demi-angle) et bord adouci (`penumbra`). Intensités en candelas au
 * repos, au freinage et au plus fort du NOS. Il fait la lueur rouge sur la chaussée comme la
 * lumière ponctuelle d'avant (même place, mêmes candelas), mais la caisse est tout entière derrière
 * lui, hors du cône : elle n'en reçoit plus rien. La lumière ponctuelle l'éclairait de face à 0,35 m
 * (caisse claire « brûlée » de dos, rose : 63 % de pixels saturés pour une Cox blanche en poursuite).
 */
export const TAIL_LIGHT = { back: 0.35, height: 0.7, heightShare: 0.4, aim: 1.5, angle: Math.PI / 3, penumbra: 0.5, candela: { rest: 5, brake: 18, nos: 40 }, glow: { substitut: 10, modele: 24 } } as const;

/**
 * Feu arrière d'un modèle : la matière du rôle « tail » des substituts, ou, sur un vrai modèle, toute
 * matière qui luit en rouge franc (émission rouge, vert et bleu sous 15 % du rouge : ni clignotant
 * orangé, ni tableau de bord ambré). Aucun nom de modèle ici.
 */
export function isTailMaterial(m: Material): m is MeshStandardMaterial {
  if (!(m instanceof MeshStandardMaterial)) return false;
  if (m.name === 'tail') return true;
  const e = m.emissive;
  return m.emissiveIntensity > 0 && e.r > 0.3 && e.g < e.r * 0.15 && e.b < e.r * 0.15;
}

/**
 * Lueur minimale d'un feu arrière en sortie (`TAIL_LIGHT.glow` : composante la plus forte de
 * l'émission × intensité). Les substituts gardent la leur (blocs de feux larges) ; un vrai modèle aux
 * feux en bandeaux fins (le concept : 1 × 10, comme les substituts, sur quelques pixels de haut) se
 * voyait à peine de dos, la nuit : sa lueur est portée à `modele` (vague S).
 */
export function tailIntensity(m: MeshStandardMaterial): number {
  const glow = m.name === 'tail' ? TAIL_LIGHT.glow.substitut : TAIL_LIGHT.glow.modele;
  const peak = Math.max(m.emissive.r, m.emissive.g, m.emissive.b);
  return peak > 0 && peak * m.emissiveIntensity < glow ? glow / peak : m.emissiveIntensity;
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
    steering: [],
    distance: 0,
    spun: 0,
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
    cast: null,
  };
}

const axisWork = new Quaternion();
const steerWork = new Quaternion();

/**
 * Fait tourner les roues de la distance parcourue (les roues motrices, de `spun` mètres de plus quand
 * elles patinent) et braque les roues avant de `steer` radians
 * (positif à gauche, déjà amplifié pour l'image : `wheelSteer`), fourche d'une moto comprise
 * (aucune allocation).
 */
export function rollWheels(rig: DriveRig, meters: number, steer = 0, spun = 0): void {
  rig.distance += meters;
  rig.spun += spun;
  for (let i = 0; i < rig.wheels.length; i += 1) {
    const w = rig.wheels[i] as Wheel;
    // Une roue motrice qui patine a fait plus de chemin que la route (`spun`).
    axisWork.setFromAxisAngle(w.axis, -(rig.distance + (w.driven ? rig.spun : 0)) / w.radius);
    if (w.steer) {
      steerWork.setFromAxisAngle(w.steer, steer);
      w.node.quaternion.multiplyQuaternions(steerWork, axisWork).multiply(w.base);
    } else w.node.quaternion.multiplyQuaternions(axisWork, w.base);
  }
  steerParts(rig.steering, steer);
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
    if (!isTailMaterial(m)) return;
    let clone = tailClones.get(m);
    if (!clone) {
      clone = m.clone();
      clone.emissiveIntensity = tailIntensity(clone);
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

/** Ombre portée : marge du plan autour de l'empreinte du véhicule (décalage au plus et bord adouci), en mètres. */
const CAST_PLANE_MARGIN = 2.6;

// Ombre portée : boîte arrondie de l'empreinte (demi-longueur, demi-largeur), décalée de uOffset (repère
// du véhicule, au sol), bord doux ; sous le véhicule, un cœur plus dense (le contact).
const CAST_VERTEX = /* glsl */ `
varying vec2 vPos;
void main() {
  vPos = position.xz;
  // La chaussée passe un peu au-dessus du rail (bombé, dévers) : le plan est tiré de 0,25 m vers la
  // caméra le long de la vue (même place à l'écran), pour ne jamais passer sous l'enrobé.
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  mv.xyz *= max( 0.0, 1.0 - 0.25 / max( length( mv.xyz ), 0.5 ) );
  gl_Position = projectionMatrix * mv;
}`;
const CAST_FRAGMENT = /* glsl */ `
uniform vec2 uHalf;
uniform vec2 uOffset;
uniform float opacity;
varying vec2 vPos;
float pmbBoxDist( vec2 p, vec2 h, float r ) {
  vec2 q = abs( p ) - h + r;
  return length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ) - r;
}
void main() {
  float r = min( uHalf.y, 0.6 );
  // Ombre étirée : l'empreinte balayée de sa place au sol jusqu'à son décalage.
  vec2 d = uOffset;
  float t = clamp( dot( vPos, d ) / max( dot( d, d ), 1e-4 ), 0.0, 1.0 );
  float sweep = 1.0 - smoothstep( -0.12, 0.28, pmbBoxDist( vPos - d * t, uHalf * vec2( 0.97, 0.95 ), r ) );
  float core = 1.0 - smoothstep( -0.25, 0.12, pmbBoxDist( vPos, uHalf * vec2( 0.95, 0.92 ), r ) );
  gl_FragColor = vec4( 0.0, 0.0, 0.0, min( max( sweep, core * 1.25 ), 1.0 ) * opacity );
}`;

/** Compile le programme d'un objet caché (montré le temps de la compilation) : rien à compiler quand il apparaît. */
function compileHidden(object: Object3D, gl: WebGLRenderer, camera: Camera, scene: Scene): void {
  const visible = object.visible;
  object.visible = true;
  gl.compile(object, camera, scene);
  object.visible = visible;
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
  /** Fourche, guidon et poignées d'une moto, tournés avec sa roue avant (vide pour une voiture). */
  steering: SteeringPart[];
  tails: MeshStandardMaterial[];
  tailLight: SpotLight;
  measure: { halfLength: number; halfWidth: number; height: number };
  /** Milieu des phares, dans le repère du véhicule, et demi-écart des deux phares (0 pour une moto). */
  head: Vector3;
  headSpread: number;
  /** Ombre portée par l'astre (le jour). */
  cast: NonNullable<DriveRig['cast']>;
  /** Couleur de la lumière des phares sur la route (linéaire), d'après le build (Custom › Phares). */
  headColor: Color;
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
  // La béquille d'atelier (pièce posée au sol du manifeste) est retirée pour toute la sortie : la moto
  // roule dès le départ, et revient sur sa béquille au garage.
  useLayoutEffect(() => {
    const lifted = liftStands(drive.prepared.root, vehicle.wheels?.grounded);
    const stage = gl.domElement.closest<HTMLElement>(`.${DRIVE_STAGE_CLASS}`);
    if (stage && lifted.length > 0) stage.dataset.bequille = 'relevee';
    return () => {
      for (const node of lifted) node.visible = true;
      if (stage) delete stage.dataset.bequille;
    };
  }, [drive, vehicle, gl]);
  const build = useBuilds((state) => state.builds[vehicle.id]);
  const paints = useMemo(() => resolvePaints(vehicle, build), [vehicle, build]);
  useLayoutEffect(() => paintZones(drive.prepared.zones, paints, bodyEnv), [drive, paints, bodyEnv]);
  // Jantes, pneus et assiette du build, posés comme au garage ; les roues tournent avec leur ancre.
  const invalidate = useThree((state) => state.invalidate);
  const { stamp, spins } = useVehicleWheels(drive.prepared, vehicle, invalidate, { merge: false });
  // Volant, pommeau et sièges du build, posés comme au garage (sinon l'habitacle serait vide).
  useHabitacle(drive.prepared, vehicle, invalidate);
  // Phares du build (src/scene/vehicle/phares.ts) : lueur et glace des optiques, feux arrière fumés,
  // posés avant que le modèle soit donné au moteur (les feux y gardent leur lueur de repos).
  const phares = useVehicleLights(drive.prepared.root, vehicle, { cloneRear: false, stageClass: DRIVE_STAGE_CLASS, invalidate });
  const headColor = useMemo(() => {
    if (phares.couleur.origine) return new Color(HEADLIGHT.color);
    const [r, g, b] = routeLight(phares.couleur.color, HEADLIGHT.color);
    return new Color().setRGB(r, g, b);
  }, [phares.couleur]);
  const wheels = useMemo(() => rollingWheels(drive.prepared.root, spins, vehicle.kind), [drive, spins, vehicle.kind]);
  // Direction d'une moto : fourche, guidon et poignées tournent avec la roue avant ; remis droits au départ.
  const steering = useMemo(() => bikeSteering(drive.prepared.root, wheels, vehicle.kind), [drive, wheels, vehicle.kind]);
  useLayoutEffect(() => () => steerParts(steering, 0), [steering]);

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

  useDriver(drive.prepared, vehicle);
  const tableau = useTableau(vehicle);

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
    // Lueur rouge des feux arrière sur la chaussée (plus forte au freinage), la caisse hors du cône (TAIL_LIGHT).
    const tail = new SpotLight('#ff1a08', TAIL_LIGHT.candela.rest, 15, TAIL_LIGHT.angle, TAIL_LIGHT.penumbra, 2);
    tail.position.set(-halfLength - TAIL_LIGHT.back, Math.min(TAIL_LIGHT.height, height * TAIL_LIGHT.heightShare), 0);
    tail.target.position.set(-halfLength - TAIL_LIGHT.aim, 0, 0);
    g.add(tail, tail.target);
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
  // Faisceaux et éblouissements de la couleur choisie.
  useLayoutEffect(() => {
    for (const mesh of [...lights.beamMeshes, ...lights.glares]) tintAdditive(mesh.material, phares.couleur);
    invalidate();
  }, [lights, phares.couleur, invalidate]);

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
  // Ombre portée par l'astre, le jour (moteur.ts, castShadow) : l'empreinte du véhicule au sol, bords
  // adoucis, plus dense dessous (contact) et étirée à l'opposé de l'astre. Calculée dans le nuanceur
  // (aucune texture, un appel de dessin), cachée la nuit ; son programme est compilé dès le montage.
  const cast = useMemo(() => {
    const reach = CAST_PLANE_MARGIN;
    const geometry = new PlaneGeometry(2 * (halfLength + reach), 2 * (halfWidth + reach)).rotateX(-Math.PI / 2);
    const material = new ShaderMaterial({
      uniforms: { uHalf: { value: new Vector2(halfLength, halfWidth) }, uOffset: { value: new Vector2() }, opacity: { value: 0 } },
      vertexShader: CAST_VERTEX,
      fragmentShader: CAST_FRAGMENT,
      transparent: true,
      depthWrite: false,
    });
    material.name = 'jour_ombre_portee';
    const mesh = new Mesh(geometry, material);
    mesh.name = 'ombre_portee';
    mesh.position.y = 0.02;
    mesh.renderOrder = 1;
    mesh.visible = false;
    return { mesh, material };
  }, [halfLength, halfWidth]);
  useEffect(
    () => () => {
      cast.material.dispose();
      cast.mesh.geometry.dispose();
    },
    [cast],
  );
  const camera = useThree((state) => state.camera);
  useLayoutEffect(() => compileHidden(cast.mesh, gl, camera, scene), [cast, gl, camera, scene]);

  useLayoutEffect(() => {
    onModel({ wheels, steering, tails: drive.tails, tailLight: lights.tail, measure: { halfLength, halfWidth, height }, head: new Vector3(lights.x, lights.y, 0), headSpread: lights.spread, cast, headColor });
    return () => onModel(null);
  }, [drive, wheels, steering, lights, halfLength, halfWidth, height, onModel, cast, headColor, phares]);

  return (
    <primitive object={rig.group} dispose={null}>
      <primitive object={shadow.root} dispose={null} />
      <primitive object={cast.mesh} dispose={null} />
      <primitive object={rig.body} dispose={null}>
        <primitive object={drive.prepared.root} dispose={null} />
        {tableau && <primitive object={tableau} dispose={null} />}
        <primitive object={lights.group} dispose={null} />
        {beams && lights.beamMeshes.map((b) => <primitive key={b.uuid} object={b} dispose={null} />)}
      </primitive>
    </primitive>
  );
}

/**
 * Tableau de bord vivant (src/scene/vehicle/tableau.ts) : les panneaux de `cabin.panels` du manifeste
 * qui portent un `instrument` (vitesse ou régime) suivent le pilote de la sortie, à la caméra
 * embarquée seulement (ailleurs, ils sont masqués et rien n'est redessiné). La vitesse affichée est
 * celle du compteur de l'écran (même arrondi) ; elle est publiée sur la scène, `data-tableau`, pour
 * les parcours. Les toiles ne sont réécrites que quand la valeur affichée change, dix fois par
 * seconde au plus. Suit l'assiette de la caisse comme le garage. Sans allocation par image.
 */
function useTableau(vehicle: VehicleManifest): Group | null {
  const gl = useThree((state) => state.gl);
  const pose = useBodyPose((state) => state.poses[vehicle.id]) ?? STILL_BODY;
  const tableau = useMemo(() => {
    const built = new TableauVivant(vehicle.cabin?.panels ?? []);
    return built.empty ? null : built;
  }, [vehicle]);
  useEffect(() => tableau?.pose(pose.y, pose.pitch), [tableau, pose]);
  useEffect(() => () => tableau?.dispose(), [tableau]);
  const stage = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const host = gl.domElement.closest<HTMLElement>(`.${DRIVE_STAGE_CLASS}`);
    stage.current = host;
    return () => {
      if (host) delete host.dataset.tableau;
      stage.current = null;
    };
  }, [gl, tableau]);
  useFrame(() => tableau?.frame(stage.current, livePilot.current, performance.now()), 0.5);
  return tableau?.group ?? null;
}

/** Distance de la caméra à l'œil du conducteur sous laquelle on est « dans sa tête ». */
const IN_HEAD = 0.32;

/** Démultiplication de la direction : rotation du volant pour le braquage montré des roues (`wheelSteer`). */
const STEERING_RATIO = DRIVER_POSE.motion.steerPerCurvature / PILOT.steer.wheelbase.car;

/**
 * Le conducteur à bord (src/scene/vehicle/conducteur.ts) : assis sur les ancres du véhicule dès que
 * le siège et le volant sont posés, il vit un peu en roulant. Les mains suivent le volant qui tourne
 * avec le braquage du pilote (`motion.steer`, la même vérité que les roues), la tête se tourne vers
 * l'intérieur du virage (courbure tirée du même braquage), le buste recule à
 * l'accélération et avance au freinage ; le motard se penche au-delà de la moto. Tout est borné et
 * lissé. Quand la caméra est à son œil (embarquée), sa tête et son buste sont cachés.
 */
function useDriver(prepared: Prepared, vehicle: VehicleManifest): void {
  const rig = useDriverRig(vehicle, true);
  const gl = useThree((state) => state.gl);
  const state = useRef<{
    handle: DriverHandle | null;
    tries: number;
    wheel: { anchor: Object3D; base: Quaternion } | null;
    /** Volant d'origine d'un vrai modèle (manifeste, `interior.steeringNode`), tourné autour de sa colonne. */
    column: SteeringPart[];
    motion: DriverMotion;
    solved: DriverMotion;
    hidden: boolean;
    stage: HTMLElement | null;
  } | null>(null);
  useLayoutEffect(() => {
    if (!rig) return;
    const anchor = prepared.root.getObjectByName(INTERIOR_CATALOGUE.anchors.steering) ?? null;
    const named = !anchor && vehicle.interior?.steeringNode ? prepared.root.getObjectByName(vehicle.interior.steeringNode) : undefined;
    const column = named ? steeringWheelPart(prepared.root, named) : null;
    state.current = {
      handle: null,
      tries: 0,
      wheel: anchor ? { anchor, base: anchor.quaternion.clone() } : null,
      column: column ? [column] : [],
      motion: { steer: 0, look: 0, lean: 0, surge: 0, hang: 0 },
      solved: { steer: 0, look: 0, lean: 0, surge: 0, hang: 0 },
      hidden: false,
      stage: gl.domElement.closest<HTMLElement>(`.${DRIVE_STAGE_CLASS}`),
    };
    return () => {
      const current = state.current;
      if (current?.wheel) current.wheel.anchor.quaternion.copy(current.wheel.base);
      if (current) steerParts(current.column, 0);
      unmountDriver(rig);
      if (current?.stage) delete current.stage.dataset.conducteur;
      state.current = null;
    };
  }, [rig, prepared, gl, vehicle]);

  const spec = useMemo(() => driverSpecOf(vehicle), [vehicle]);
  const turn = useMemo(() => new Quaternion(), []);
  const eye = useMemo(() => new Vector3(), []);
  const axis = useMemo(() => new Vector3(0, 0, 1), []);
  // Après le moteur de la scène (priorité 0) qui pose le véhicule et la caméra, avant la chaîne de
  // rendu (priorité 1, toujours montée) : la caméra de cette image est connue.
  useFrame(({ camera }, delta) => {
    const current = state.current;
    if (!rig || !current) return;
    if (!current.handle) {
      // Mesure du véhicule (au rayon) dès que le siège et le volant sont posés ; quelques essais espacés.
      current.tries += 1;
      if (current.tries % 10 !== 1) return;
      const body = prepared.root.getObjectByName('caisse');
      if (!body) return;
      const started = performance.now();
      const { seating } = measureSeating(prepared.root, body, vehicle);
      if (!seating) return;
      current.handle = seatDriver(rig, seating);
      mountDriver(rig, body, Math.round(performance.now() - started));
      if (current.stage) current.stage.dataset.conducteur = 'assis';
      return;
    }
    const pilot = livePilot.current;
    const dt = Math.min(0.1, delta);
    const M = DRIVER_POSE.motion;
    const m = current.motion;
    if (pilot) {
      const motion = pilot.motion;
      const steer = Number.isFinite(motion.steer) ? (motion.steer as number) : 0;
      const curvature = Math.tan(steer) / PILOT.steer.wheelbase[current.handle.seating.kind];
      // Voiture : le volant (démultiplié, borné) ; moto : le guidon, du braquage montré de sa fourche.
      const bike = current.handle.seating.kind === 'bike';
      const steerable = (current.wheel !== null || current.column.length > 0) && !bike;
      // Le volant suit le braquage montré des roues (amplifié comme elles) : il se voit tourner dès
      // une courbe ordinaire, borné pour que les mains restent sur la jante.
      const target = wheelSteer(steer, motion.speed, bike ? 'bike' : 'car') * (bike ? 1 : steerable ? STEERING_RATIO : 0);
      // Le guidon tient les mains : sans lissage de plus que la fourche (déjà lissée par le pilote).
      m.steer = bike ? target : follow(m.steer, target, M.steerMax, dt, M.smoothing);
      m.look = follow(m.look, curvature * M.lookPerCurvature, M.lookMax, dt, M.smoothing);
      m.surge = follow(m.surge, -(motion.pull ?? motion.accel) * M.surgePerAccel, M.surgeMax, dt, M.smoothing);
      if (current.handle.seating.kind === 'bike') {
        m.lean = follow(m.lean, motion.roll * spec.leanExtra, 0.25, dt, M.smoothing);
        m.hang = follow(m.hang, (motion.roll / 0.6) * spec.hangOff, spec.hangOff, dt, M.smoothing);
      }
    }
    // Re-pose seulement quand le mouvement a changé (rien à recalculer en ligne droite stabilisée).
    const s = current.solved;
    if (Math.abs(m.steer - s.steer) + Math.abs(m.look - s.look) + Math.abs(m.lean - s.lean) + Math.abs(m.surge - s.surge) + Math.abs(m.hang - s.hang) > 0.002) {
      if (current.wheel) current.wheel.anchor.quaternion.copy(current.wheel.base).multiply(turn.setFromAxisAngle(axis, m.steer));
      steerParts(current.column, m.steer);
      current.handle.move(m);
      Object.assign(s, m);
    }
    // Caméra à l'œil du conducteur : tête et buste cachés, avant-bras et mains visibles.
    const pose = current.handle.pose;
    eye.copy(pose.eye).applyMatrix4(rig.root.matrixWorld);
    const hidden = camera.position.distanceTo(eye) < IN_HEAD;
    if (hidden !== current.hidden) {
      current.hidden = hidden;
      hideForCockpit(rig, hidden);
      if (current.stage) current.stage.dataset.conducteur = hidden ? 'tete-cachee' : 'assis';
    }
  }, 0.5);
}
