// L'adversaire du duel dans la scène de la sortie (§ 5.5, jeu) : son véhicule, allégé, posé sur la route à
// chaque image par le moteur de la scène (moteur.ts, `poserAdversaire`). Chargé pour un duel seulement :
// une sortie sans adversaire ne charge, ne dessine et ne calcule rien de plus.
//
// Allègement (budget du § 8 : un second véhicule ne double pas la scène) : le modèle du catalogue préparé
// comme celui du joueur (roues à part pour tourner, feux arrière à lui), peint de sa couleur, sans
// habitacle posé, sans conducteur, sans pièces montées, sans néons, sans flammes, sans capot ouvert ; une
// ombre de contact rendue une fois (pas d'ombre portée par le soleil) ; caché de la sonde de reflets. De
// nuit, ses feux arrière luisent (plus fort au freinage) et ses phares éblouissent de face (lueurs sans
// lumière réelle : aucune lumière de plus dans la scène, aucune matière recompilée). Muet : aucun son.

import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Group, Mesh, type MeshStandardMaterial, type Scene, type WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { BASIS_TRANSCODER_DIR } from '../../data/bench.ts';
import { modelUrl } from '../../data/vehicles.ts';
import type { Paint, VehicleManifest } from '../../data/vehicleTypes.ts';
import { ATMOSPHERE_LAYER } from '../../render/layers.ts';
import { shadowSize, VehicleShadowRig } from '../../render/vehicleShadow.ts';
import { disposePrepared, paintZones, useVehicleWheels } from '../../scene/vehicle/VehicleModel.tsx';
import type { DuelEnCourse } from '../adversaire/course.ts';
import type { RailPose } from '../contrat.ts';
import { createGlare } from './ciel.ts';
import { rollingWheels, wheelSteer, type Wheel } from './roues.ts';
import { prepareForDrive, rollWheels, type DriveRig } from './vehicule.tsx';

/** Chargeur propre à l'adversaire : son cache est distinct de celui du joueur (même véhicule : deux copies). */
class AdversaireGLTFLoader extends GLTFLoader {}

let ktx2: KTX2Loader | null = null;
function ktx2Loader(gl: WebGLRenderer): KTX2Loader {
  ktx2 ??= new KTX2Loader().setTranscoderPath(`${import.meta.env.BASE_URL}${BASIS_TRANSCODER_DIR}`).detectSupport(gl);
  return ktx2;
}

/** Peinture de l'adversaire : sa couleur sur la carrosserie (zones du groupe « carrosserie »), le reste d'origine. */
export function peinturesAdversaire(vehicle: Pick<VehicleManifest, 'zones'>, couleur: string): Record<string, Paint> {
  const out: Record<string, Paint> = {};
  for (const zone of vehicle.zones) out[zone.id] = zone.group === 'carrosserie' && zone.linked !== false ? { ...zone.paint, color: couleur as Paint['color'] } : { ...zone.paint };
  return out;
}

/** Nœuds de l'habitacle d'un modèle (conventions des modèles, src/data/vehicleTypes.ts), cachés chez l'adversaire. */
const HABITACLE = /^(habitacle|volant|siege_|interieur|interior)/i;

/** Feux de l'adversaire : intensité des feux arrière au freinage (fois le repos). */
const FREINAGE = 3.2;

/**
 * Pose l'adversaire sur le rail (aucune allocation) : la pose de la route à son abscisse, son écart (pilote
 * et évitement), son cap, son roulis, ses roues ; feux arrière et lueur des phares selon la nuit (`phares`,
 * de 0 le jour à 1 la nuit). Caché hors de la course ou tant que son modèle n'est pas posé.
 */
export function poserAdversaire(rig: DriveRig, duel: DuelEnCourse, pose: RailPose, dt: number, phares: number): void {
  const visible = duel.enPiste && duel.modele === 'pret';
  if (rig.group.visible !== visible) rig.group.visible = visible;
  if (!visible) return;
  const motion = duel.pilote.pilot.motion;
  duel.pilote.pilot.rail.poseAt(motion.s, pose);
  const tx = pose.tangent[0];
  const tz = pose.tangent[2];
  const hl = Math.hypot(tx, tz) || 1;
  rig.group.position.set(pose.position[0] + (tz / hl) * duel.offset, pose.position[1], pose.position[2] - (tx / hl) * duel.offset);
  rig.group.rotation.set(0, pose.heading + (motion.yaw ?? 0), pose.pitch);
  rig.body.rotation.set(motion.roll, 0, motion.dive);
  const vitesse = duel.pilote.vitesse;
  rollWheels(rig, vitesse * dt, wheelSteer(motion.steer ?? 0, vitesse, duel.vehicule.kind));
  const k = motion.braking ? FREINAGE : 1;
  for (let i = 0; i < rig.tails.length; i += 1) (rig.tails[i] as { emissiveIntensity: number }).emissiveIntensity = rig.tailBase * k;
  rig.glareGain.value = phares;
  rig.group.updateMatrixWorld();
}

/** Ce que le modèle posé donne au moteur de la scène (moteur.ts, `setAdversaire`). */
export interface ModeleAdversaire {
  wheels: Wheel[];
  tails: MeshStandardMaterial[];
  measure: { halfLength: number; halfWidth: number; height: number };
}

/** Le modèle de l'adversaire posé (ou retiré, `null`) : roues, feux et mesures sur son rig, le duel prévenu. */
export function poserModeleAdversaire(rig: DriveRig, duel: DuelEnCourse, model: ModeleAdversaire | null): void {
  rig.wheels = model?.wheels ?? [];
  rig.distance = 0;
  rig.tails = model?.tails ?? [];
  rig.tailBase = model?.tails[0]?.emissiveIntensity ?? 10;
  rig.measure = model?.measure ?? null;
  if (model) duel.mesurer(model.measure.halfWidth, model.measure.halfLength);
  if (model) duel.modele = 'pret';
}

interface Props {
  duel: DuelEnCourse;
  rig: DriveRig;
  bodyEnv: number;
  onModel: (model: ModeleAdversaire | null) => void;
}

/** Le véhicule de l'adversaire, posé dans `rig.body`. À monter sous Suspense et un garde-fou (SceneBoundary). */
export function DriveAdversaire({ duel, rig, bodyEnv, onModel }: Props) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene) as Scene;
  const invalidate = useThree((state) => state.invalidate);
  const vehicle = duel.vehicule;
  const gltf = useLoader(AdversaireGLTFLoader, modelUrl(vehicle), (loader) => {
    loader.setKTX2Loader(ktx2Loader(gl));
  });
  const drive = useMemo(() => {
    const prepared = prepareForDrive(gltf.scene, vehicle);
    // Pas d'habitacle : sièges, volant et planche du modèle restent dans le garage.
    prepared.prepared.root.traverse((o) => {
      if (HABITACLE.test(o.name)) o.visible = false;
    });
    return prepared;
  }, [gltf, vehicle]);
  useEffect(
    () => () => {
      disposePrepared(drive.prepared);
      for (const m of drive.owned.materials) m.dispose();
    },
    [drive],
  );
  // Libère le modèle chargé quand la sortie se termine (cache propre à l'adversaire).
  useEffect(
    () => () => {
      window.setTimeout(() => {
        gltf.scene.traverse((o) => {
          if (o instanceof Mesh) o.geometry.dispose();
        });
        useLoader.clear(AdversaireGLTFLoader, modelUrl(vehicle));
      }, 0);
    },
    [gltf, vehicle],
  );
  const peintures = useMemo(() => peinturesAdversaire(vehicle, duel.adversaire.couleur), [vehicle, duel.adversaire.couleur]);
  useLayoutEffect(() => paintZones(drive.prepared.zones, peintures, bodyEnv), [drive, peintures, bodyEnv]);
  const { stamp, spins } = useVehicleWheels(drive.prepared, vehicle, invalidate, { merge: false });
  const wheels = useMemo(() => rollingWheels(drive.prepared.root, spins, vehicle.kind), [drive, spins, vehicle.kind]);
  const { halfLength, halfWidth, height } = drive.prepared;
  const isBike = vehicle.kind === 'bike';

  // Phares : deux lueurs aux coins avant (une pour une moto), vues de face la nuit ; aucune lumière réelle.
  const glares = useMemo(() => {
    const g = new Group();
    g.name = 'adversaire_phares';
    const y = isBike ? Math.min(1.05, height * 0.72) : Math.min(0.75, height * 0.42);
    const spread = isBike ? 0 : Math.max(0.3, halfWidth - 0.28);
    const meshes = (isBike ? [0] : [-spread, spread]).map((z) => {
      const glare = createGlare(rig.glareGain);
      glare.position.set(halfLength + 0.04, y, z);
      glare.layers.set(ATMOSPHERE_LAYER);
      g.add(glare);
      return glare;
    });
    return { group: g, meshes };
  }, [halfLength, halfWidth, height, isBike, rig.glareGain]);
  useEffect(
    () => () => {
      for (const m of glares.meshes) {
        m.geometry.dispose();
        m.material.dispose();
      }
    },
    [glares],
  );

  // Ombre de contact, rendue une fois (à l'arrivée des roues), au sol sous la caisse.
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
    onModel({ wheels, tails: drive.tails, measure: { halfLength, halfWidth, height } });
    return () => onModel(null);
  }, [wheels, drive, halfLength, halfWidth, height, onModel]);

  return (
    <primitive object={rig.group} dispose={null}>
      <primitive object={shadow.root} dispose={null} />
      <primitive object={rig.body} dispose={null}>
        <primitive object={drive.prepared.root} dispose={null} />
        <primitive object={glares.group} dispose={null} />
      </primitive>
    </primitive>
  );
}
