// Le véhicule du garage : n'importe quel véhicule du catalogue (src/data/vehicles.ts), chargé à
// la demande d'après son manifeste. Un modèle aux conventions du § 8 est habillé par le nom de ses
// matériaux (src/data/materialRoles.ts) ; un modèle qui ne les suit pas (le banc d'essai,
// placeholder_banc) l'est par la section « adapt » de son manifeste. Ce composant ne connaît
// aucun véhicule ni aucun nom de matériau propre à un modèle. Les roues (nœuds roue_*, ou ceux du
// manifeste) sont rangées à part de la caisse : l'atelier y pose la jante et le pneu choisis, et
// l'assiette déplace la caisse seule (src/scene/vehicle/wheels.ts). L'habitacle (volant, pommeau,
// sièges avant) est posé de même sur ses ancres (src/scene/vehicle/habitacle.ts).

import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  Box3,
  FrontSide,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Texture,
  Vector3,
  WebGLRenderTarget,
  type BufferGeometry,
  type Material,
  Object3D,
  type WebGLRenderer,
} from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BASIS_TRANSCODER_DIR } from '../../data/bench.ts';
import { finish as findFinish } from '../../data/finishes.ts';
import { glassLook, materialRole, paintZoneOf, type GlassLook } from '../../data/materialRoles.ts';
import { modelUrl } from '../../data/vehicles.ts';
import type { Paint, VehicleManifest } from '../../data/vehicleTypes.ts';
import { primeCutDither, programsReady, type CutDitherProgram } from '../../render/cutDither.ts';
import { applyPaint, createPaintMaterial, paintWitnessPrograms, paintWitnesses, warmPaintPrograms } from '../../render/paint.ts';
import { precompileSeen } from '../../render/ReflectionProbe.tsx';
import { useRenderStats } from '../../render/renderStats.ts';
import { shadowSize, VehicleShadowRig } from '../../render/vehicleShadow.ts';
import { useBench } from '../../state/bench.ts';
import { useView } from '../../state/view.ts';
import { resolvePaints, useBuilds } from '../../state/builds.ts';
import { resolveWheels, TIRE_PAINT, WHEEL_SLOTS, wheelFiles } from '../../data/wheels.ts';
import type { Build } from '../../data/vehicleTypes.ts';
import { useHabitacle } from './habitacle.ts';
import { usePieces } from './pieces.ts';
import { separerEchappement, useFinitionEchappement } from './echappement.ts';
import { useCapotScene } from './capot.ts';
import { finirCapot, noterFusion, preparerCapot, type CapotRig } from './capotRig.ts';
import { useFlammesGarage } from './flammes.ts';
import { useGabarit } from './gabarit.ts';
import { applyLivery, createLiveryRig, disposeLivery, type LiveryRig } from './livree.ts';
import { useNeons } from './neons.ts';
import { separerVoyants, useVehicleLights } from './phares.ts';
import { createMarkMaterial, mergeGround, mountWheels, preloadWheels, useBodyPose, useWheelMounts, useWheelSources, type WheelAnchor, type WheelMount, type WheelRig } from './wheels.ts';

const BASE = import.meta.env.BASE_URL;

// Un seul transcodeur KTX2 pour toute la vie de la page : son worker coûte cher à démarrer.
let ktx2: KTX2Loader | null = null;
function ktx2Loader(gl: WebGLRenderer): KTX2Loader {
  ktx2 ??= new KTX2Loader().setTranscoderPath(`${BASE}${BASIS_TRANSCODER_DIR}`).detectSupport(gl);
  return ktx2;
}

function materialsOf(mesh: Mesh): Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function texturesOf(material: Material): Array<[key: string, texture: Texture]> {
  return Object.entries(material).filter((entry): entry is [string, Texture] => entry[1] instanceof Texture);
}

export interface VehicleMeasure {
  /** Demi-longueur, demi-largeur et hauteur, une fois posé au sol. */
  halfLength: number;
  halfWidth: number;
  height: number;
}

/** Rang de dessin des pièces opaques du véhicule : avant le décor (0) et son sol (1). */
const VEHICLE_RENDER_ORDER = -2;

export interface Prepared extends VehicleMeasure {
  root: Group;
  /** Matériaux de peinture, un par zone trouvée dans le modèle (témoins, préchauffage). */
  paints: MeshPhysicalMaterial[];
  /** Matériau de peinture de chaque zone du manifeste présente dans le modèle. */
  zones: ReadonlyMap<string, MeshPhysicalMaterial>;
  /** Caisse, roues et ancres : ce que l'assiette et le choix des roues déplacent. */
  wheels: WheelRig;
  /** Vitrages, avec leur réglage vu de dehors : la vue intérieure les éclaircit (setGlassInside). */
  glass: GlassPane[];
  /**
   * Ce que la préparation a créé, à libérer quand le modèle change ou quitte la scène. Le reste
   * (géométries d'origine, matériaux, textures, dont les cartes de normales reprises par la
   * peinture) appartient au cache de chargement, partagé : jamais libéré ici.
   */
  owned: { geometries: BufferGeometry[]; materials: Material[] };
  /** Stickers (src/scene/vehicle/livree.ts) ; `null` : le véhicule ne déclare pas de zone de livrée. */
  livery?: LiveryRig | null;
  /** Capot moteur qui s'ouvre, vitré, déposé (./capot.ts) ; `null` : le manifeste n'en déclare pas. */
  capot?: CapotRig | null;
}

type Adapt = NonNullable<VehicleManifest['adapt']>;

/** Logos (exclus de la licence d'un modèle adapté) : plaque unie, images retirées partout. */
function removeLogos(meshes: readonly Mesh[], all: ReadonlySet<Material>, vehicle: VehicleManifest, adapt: Adapt, owned: Material[]): void {
  const plainMaterials = adapt.plainMaterials ?? [];
  const logoTextures = adapt.logoTextures ?? [];
  const isPlain = (material: Material) => plainMaterials.includes(material.name);
  if (plainMaterials.length > 0) {
    const plain = new MeshStandardMaterial({ color: adapt.plainColor ?? '#d8d6cf', roughness: 0.55, metalness: 0 });
    plain.name = `${vehicle.placeholder ?? vehicle.id}_plaque`;
    owned.push(plain);
    for (const mesh of meshes) {
      if (!materialsOf(mesh).some(isPlain)) continue;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map((material) => (isPlain(material) ? plain : material)) : plain;
    }
  }
  const logoSources = new Set<Texture['source']>();
  for (const material of all) {
    for (const logo of logoTextures) {
      if (logo.material !== material.name) continue;
      for (const [key, texture] of texturesOf(material)) if (logo.maps.includes(key)) logoSources.add(texture.source);
    }
  }
  for (const material of all) {
    if (isPlain(material)) continue;
    for (const [key, texture] of texturesOf(material)) {
      if (!logoSources.has(texture.source)) continue;
      (material as unknown as Record<string, unknown>)[key] = null;
      material.needsUpdate = true;
      if (!(material instanceof MeshStandardMaterial)) continue;
      // Un émissif blanc sans sa texture ferait briller toute la pièce.
      if (key === 'emissiveMap') material.emissive.setRGB(0, 0, 0);
      const color = logoTextures.find((logo) => logo.material === material.name)?.color;
      if (key === 'map' && color) material.color.set(color);
    }
  }
}

/** Un vitrage préparé et son réglage vu de dehors. */
export interface GlassPane {
  material: MeshStandardMaterial;
  outside: GlassLook;
}

/**
 * Vitrage transparent et teinté plutôt que réfractant (une passe de rendu complète de moins).
 * Une seule face dessinée, celle qui regarde dehors : vue de l'habitacle, une vitre d'une seule
 * peau n'est pas dessinée du tout, et l'on voit le garage ou la route au travers (un vitrage à deux
 * faces ou épais est éclairci en vue intérieure, setGlassInside).
 */
function makeGlass(material: Material, color: string, look: GlassLook, panes: GlassPane[]): void {
  if (!(material instanceof MeshStandardMaterial)) return;
  if (material instanceof MeshPhysicalMaterial) material.transmission = 0;
  material.color.set(color);
  material.transparent = true;
  material.opacity = look.opacity;
  material.envMapIntensity = look.envMapIntensity;
  material.side = FrontSide;
  material.depthWrite = false;
  material.needsUpdate = true;
  if (!panes.some((pane) => pane.material === material)) panes.push({ material, outside: { ...look } });
}

/** Vitrages vus de dedans (vue intérieure) ou de dehors : opacité et reflet (src/data/materialRoles.ts, glassLook). */
export function setGlassInside(panes: readonly GlassPane[], inside: boolean): void {
  for (const { material, outside } of panes) {
    const look = glassLook(outside, inside);
    material.opacity = look.opacity;
    material.envMapIntensity = look.envMapIntensity;
  }
}

function makeLamp(material: Material, color: string, intensity: number): void {
  if (!(material instanceof MeshStandardMaterial)) return;
  material.emissive.set(color);
  material.emissiveIntensity = intensity;
}

/** Nœuds de roue : convention de nommage des modèles (aucun identifiant de véhicule). */
export const WHEEL_NODE = /^(roue|wheel)_/i;

/**
 * Nœuds rangés à part de la caisse : roues (convention `roue_*`, ou liste `wheels.nodes` du
 * manifeste) et pièces posées au sol (`wheels.grounded` : béquille). Nœuds de tête seulement.
 */
function looseNodes(scene: Object3D, vehicle: VehicleManifest): { wheels: Object3D[]; grounded: Object3D[] } {
  const named = new Set(vehicle.wheels?.nodes ?? []);
  const grounded = new Set(vehicle.wheels?.grounded ?? []);
  const isWheel = (node: Object3D) => WHEEL_NODE.test(node.name) || named.has(node.name);
  const found = { wheels: [] as Object3D[], grounded: [] as Object3D[] };
  const visit = (node: Object3D) => {
    if (isWheel(node)) found.wheels.push(node);
    else if (grounded.has(node.name)) found.grounded.push(node);
    else for (const child of node.children) visit(child);
  };
  visit(scene);
  return found;
}

/**
 * Retire du modèle une pièce fusionnée sans emporter ce qui pend sous elle. Une pièce peut porter
 * d'autres nœuds : le concept a toutes ses pièces, roues comprises, sous son soubassement, qui se
 * fusionne avec le moteur. Retirée seule, elle emportait ses enfants hors de la scène : les pièces
 * d'un matériau unique disparaissaient, et les roues, posées ensuite à côté de la caisse sans la
 * rotation ni le recentrage du modèle (étape 6), sortaient de leurs passages. Un nœud vide, à la
 * même place, garde ses enfants.
 */
function removeMerged(part: Mesh): void {
  const parent = part.parent;
  if (parent && part.children.length > 0) {
    const stand = new Object3D();
    stand.name = part.name;
    stand.position.copy(part.position);
    stand.quaternion.copy(part.quaternion);
    stand.scale.copy(part.scale);
    for (const child of [...part.children]) stand.add(child);
    parent.add(stand);
  }
  part.removeFromParent();
}

/** Copie le modèle, pose peinture, rôles et adaptation, le pose au sol, centré, longueur sur X. */
export function prepare(source: Group, vehicle: VehicleManifest): Prepared {
  const scene = source.clone(true);
  const meshes: Mesh[] = [];
  scene.traverse((object) => {
    if (object instanceof Mesh) meshes.push(object);
  });
  // Roues et pièces au sol : jamais fusionnées avec la caisse, qui bouge sans elles. Le volant
  // d'origine d'un vrai modèle (manifeste, `interior.steeringNode`) non plus : il tourne en roulant.
  const loose = looseNodes(scene, vehicle);
  const apart = new Set<Mesh>();
  const steeringNode = vehicle.interior?.steeringNode ? scene.getObjectByName(vehicle.interior.steeringNode) : undefined;
  for (const node of [...loose.wheels, ...loose.grounded, ...(steeringNode ? [steeringNode] : [])]) {
    node.traverse((object) => {
      if (object instanceof Mesh) apart.add(object);
    });
  }
  const all = new Set<Material>();
  for (const mesh of meshes) for (const material of materialsOf(mesh)) all.add(material);
  const owned: Material[] = [];
  const { adapt } = vehicle;

  // 1. Logos d'un modèle adapté.
  if (adapt) removeLogos(meshes, all, vehicle, adapt, owned);

  // 2. Peinture : un matériau par zone, partagé par toutes ses pièces. Une pièce est d'une zone
  //    si son matériau est cité par la zone ou s'appelle « paint_<zone> ».
  const zoneOf = (material: Material) =>
    vehicle.zones.find((zone) => zone.materials.includes(material.name) || paintZoneOf(material.name) === zone.id);
  const zones = new Map<string, MeshPhysicalMaterial>();
  for (const mesh of meshes) {
    const materials = materialsOf(mesh);
    materials.forEach((material, index) => {
      const zone = zoneOf(material);
      if (!zone) return;
      let paint = zones.get(zone.id);
      if (!paint) {
        paint = createPaintMaterial(material);
        zones.set(zone.id, paint);
      }
      if (Array.isArray(mesh.material)) mesh.material[index] = paint;
      else mesh.material = paint;
    });
  }
  // Zone des jantes posées par l'atelier : son matériau existe même si le modèle n'a pas de jante.
  // De même pour les zones des pièces d'habitacle posées par l'atelier (pommeau, sellerie).
  const posedZones = [vehicle.wheels?.fit?.zone, vehicle.interior?.knob?.zone, vehicle.interior?.seats?.zone];
  for (const zoneData of vehicle.zones.filter((zone) => posedZones.includes(zone.id))) {
    if (zones.has(zoneData.id)) continue;
    const stub = new MeshStandardMaterial();
    stub.name = zoneData.materials[0] ?? `paint_${zoneData.id}`;
    zones.set(zoneData.id, createPaintMaterial(stub));
    stub.dispose();
  }
  const paints = [...zones.values()];
  owned.push(...paints);

  // 3. Rôles des matériaux aux conventions (chrome, alu, vitrage, optiques…).
  const glass: GlassPane[] = [];
  for (const material of all) {
    const role = materialRole(material.name);
    if (!role || zoneOf(material) || !(material instanceof MeshStandardMaterial)) continue;
    if (role.opacity !== undefined) {
      makeGlass(material, role.color, { opacity: role.opacity, envMapIntensity: role.envMapIntensity }, glass);
      continue;
    }
    material.color.set(role.color);
    material.metalness = role.metalness;
    material.roughness = role.roughness;
    material.envMapIntensity = role.envMapIntensity;
    if (role.emissive) makeLamp(material, role.emissive.color, role.emissive.intensity);
  }

  // 4. Vitrages et optiques d'un modèle adapté.
  if (adapt?.glass) {
    // Reflet : celui du modèle (le concept garde son rendu d'atelier).
    for (const material of all) {
      if (!adapt.glass.materials.includes(material.name) || !(material instanceof MeshStandardMaterial)) continue;
      makeGlass(material, adapt.glass.color, { opacity: adapt.glass.opacity, envMapIntensity: material.envMapIntensity }, glass);
    }
  }
  for (const lamp of adapt?.lamps ?? []) {
    for (const material of all) if (lamp.materials.includes(material.name)) makeLamp(material, lamp.color, lamp.intensity);
  }

  // 4 bis. Sorties d'échappement du manifeste : leur métal à part, pour la finition (./echappement.ts).
  separerEchappement(scene, vehicle, owned);
  // 4 ter. Voyants de l'habitacle dans la matière d'une optique : à part, hors des réglages des phares (./phares.ts).
  separerVoyants(scene, vehicle, owned);

  // 4 ter. Capot moteur du manifeste (./capot.ts) : compartiment en tête de la fusion, capot en queue,
  //        variante vitrée à part.
  const capot = preparerCapot(scene, vehicle, meshes, apart, owned);

  // 5. Budget de draw calls (§ 8) : le modèle est immobile, ses pièces sont fusionnées par
  //    matériau. Seules les géométries aux attributs identiques se fusionnent.
  scene.updateMatrixWorld(true);
  const groups = new Map<string, Mesh[]>();
  for (const mesh of meshes) {
    if (Array.isArray(mesh.material) || apart.has(mesh)) continue;
    const { geometry } = mesh;
    const signature = [
      mesh.material.uuid,
      geometry.index ? 'indexé' : 'libre',
      Object.keys(geometry.attributes).sort().join(','),
      Object.keys(geometry.morphAttributes).length,
    ].join('|');
    groups.set(signature, [...(groups.get(signature) ?? []), mesh]);
  }
  const merged = new Group();
  const mergedGeometries: BufferGeometry[] = [];
  for (const parts of groups.values()) {
    const first = parts[0];
    if (!first || parts.length < 2) continue;
    const geometries = parts.map((part) => part.geometry.clone().applyMatrix4(part.matrixWorld));
    const counts = geometries.map((item) => item.index?.count ?? item.getAttribute('position').count);
    const geometry = mergeGeometries(geometries, false);
    for (const item of geometries) item.dispose();
    if (!geometry) continue;
    mergedGeometries.push(geometry);
    const mesh = new Mesh(geometry, first.material);
    mesh.name = `fusion_${(first.material as Material).name}`;
    merged.add(mesh);
    noterFusion(capot, mesh, parts, counts);
    for (const part of parts) removeMerged(part);
  }
  finirCapot(capot);

  // 6. Pose : longueur sur X, au sol, centré. Orientation mesurée, jamais supposée.
  const root = new Group();
  root.name = vehicle.placeholder ?? `vehicule_${vehicle.id}`;
  // Le véhicule ne se reflète pas lui-même : la sonde de réflexion le masque.
  root.userData.hideInProbe = true;
  const turn = new Group();
  // Les pièces fusionnées sont déjà dans le repère du parent du modèle : elles vont à côté.
  turn.add(scene, merged);
  // La caisse (que l'assiette déplace) et, à côté, les roues et ce qui reste au sol.
  const body = new Group();
  body.name = 'caisse';
  body.add(turn);
  const ground = new Group();
  ground.name = 'au_sol';
  root.add(body, ground);
  // Ordre de dessin : les pièces opaques du véhicule avant le décor (il occupe le milieu de l'image,
  // le décor caché derrière lui n'est plus calculé) ; les vitrages, transparents, gardent le leur.
  turn.traverse((object) => {
    if (object instanceof Mesh && !materialsOf(object).some((material) => material.transparent)) object.renderOrder = VEHICLE_RENDER_ORDER;
  });
  // Boîte précise (sommets) : celle des boîtes englobantes tournées déborde sous les roues,
  // et le véhicule flotterait au-dessus du sol.
  let size = new Box3().setFromObject(turn, true).getSize(new Vector3());
  const quarterTurns = (size.z > size.x ? 1 : 0) + (adapt?.yawQuarterTurns ?? 0);
  turn.rotation.y = (quarterTurns * Math.PI) / 2;
  turn.updateMatrixWorld(true);
  const box = new Box3().setFromObject(turn, true);
  // Ancre sans maillage (la roue est posée par l'atelier) : la roue d'origine compte dans la boîte,
  // son centre à son rayon au-dessus du sol (modèle aux conventions : le sol est y = 0). Mesurer le
  // rayon depuis le bas de la caisse posait le modèle trop bas de sa garde au sol, et décalait tout
  // ce qui se place en coordonnées du manifeste (ciel étoilé, cadrans, œil de la vue intérieure).
  const at = new Vector3();
  for (const node of loose.wheels) {
    if (new Box3().setFromObject(node, true).isEmpty()) {
      node.getWorldPosition(at);
      const r = Math.max(0.05, at.y);
      box.expandByPoint(at.clone().addScalar(r));
      box.expandByPoint(at.clone().subScalar(r));
    }
  }
  size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  turn.position.set(-center.x, -box.min.y, -center.z);

  // Roues et pièces au sol rangées à part, à la même place.
  root.updateMatrixWorld(true);
  const anchors: WheelAnchor[] = [];
  const own = vehicle.wheels?.fit === undefined;
  for (const node of loose.wheels) {
    const solid = new Box3().setFromObject(node, true);
    const middle = solid.isEmpty() ? node.getWorldPosition(new Vector3()) : solid.getCenter(new Vector3());
    ground.attach(node);
    anchors.push({ node, base: { x: node.position.x, y: node.position.y, z: node.position.z }, front: middle.x > 0, own });
  }
  for (const node of loose.grounded) ground.attach(node);
  // Stickers du build, posés dès la préparation (garage, sortie) ; le garage les suit ensuite (useLivery).
  const livery = createLiveryRig(vehicle, body, zones);
  if (livery) applyLivery(livery, useBuilds.getState().builds[vehicle.id]?.stickers);

  return {
    livery,
    capot,
    root,
    paints,
    zones,
    halfLength: size.x / 2,
    halfWidth: size.z / 2,
    height: size.y,
    wheels: { body, ground, anchors },
    glass,
    owned: { geometries: mergedGeometries, materials: owned },
  };
}

/** Ce qui, dans un build, touche aux roues posées (la couleur du pneu à part) : une clé stable. */
function wheelSignature(build: Build | undefined): string {
  return JSON.stringify({
    parts: { [WHEEL_SLOTS.rim]: build?.parts?.[WHEEL_SLOTS.rim], [WHEEL_SLOTS.tire]: build?.parts?.[WHEEL_SLOTS.tire] },
    tune: build?.tune ?? {},
  });
}

const NO_MOUNT: WheelMount = Object.freeze({ stamp: 0, spins: [] });

/**
 * Roues et assiette du véhicule préparé, d'après son build : pose la jante et le pneu choisis sur
 * chaque ancre, à la cote choisie, et la caisse à sa hauteur. Rend un tampon qui change à chaque
 * pose (l'ombre de contact se refait) et les nœuds qui tournent (sortie de nuit). `merge` : au
 * garage, les roues immobiles sont fusionnées par matériau.
 */

export function useVehicleWheels(prepared: Prepared, vehicle: VehicleManifest, invalidate: () => void, options: { merge: boolean }): WheelMount {
  const { merge } = options;
  const signature = useBuilds((state) => wheelSignature(state.builds[vehicle.id]));
  const color = useBuilds((state) => state.builds[vehicle.id]?.partPaints?.[TIRE_PAINT]?.color);
  const resolved = useMemo(() => resolveWheels(vehicle, JSON.parse(signature) as Build), [vehicle, signature]);
  const sources = useWheelSources(wheelFiles(vehicle, resolved));
  const mark = useMemo(() => createMarkMaterial(), []);
  useEffect(() => () => mark.dispose(), [mark]);
  useEffect(() => {
    if (vehicle.wheels?.fit) preloadWheels(vehicle);
  }, [vehicle]);
  const key = prepared.root.uuid;
  const mount = useWheelMounts((state) => state.mounts[key]) ?? NO_MOUNT;
  useLayoutEffect(() => {
    if (!resolved) return undefined;
    const rimPaint = vehicle.wheels?.fit ? prepared.zones.get(vehicle.wheels.fit.zone) : undefined;
    const mounted = mountWheels(prepared.wheels, vehicle, resolved, sources ? { rim: sources.rim, tire: sources.tire, rimPaint, mark } : null);
    // Au garage, rien ne tourne : roues et pièces au sol fusionnées par matériau.
    const unmerge = merge ? mergeGround(prepared.wheels) : null;
    useBodyPose.getState().setPose(vehicle.id, mounted.pose);
    useWheelMounts.getState().publish(key, mounted.spins);
    invalidate();
    return () => {
      unmerge?.();
      mounted.dispose();
    };
  }, [prepared, key, vehicle, resolved, sources, mark, invalidate, merge]);
  useEffect(() => () => useWheelMounts.getState().publish(key, null), [key]);
  // Couleur de la marque du pneu : repeinte sans reposer les roues.
  const tireColor = resolved?.swap ? (color ?? resolved.tire?.color ?? '#efece2') : null;
  useLayoutEffect(() => {
    if (tireColor === null) return;
    mark.color.set(tireColor);
    invalidate();
  }, [mark, tireColor, invalidate]);
  return mount;
}

/** Libère ce que `prepare` a créé (revue n° 12), sans toucher à ce que le cache de chargement partage. */
export function disposePrepared(prepared: Prepared): void {
  for (const geometry of prepared.owned.geometries) geometry.dispose();
  for (const material of prepared.owned.materials) material.dispose();
  disposeLivery(prepared.livery);
}

/**
 * Peint chaque zone d'après sa peinture effective (store des builds) ; l'ambiance règle la part de
 * reflet de l'environnement. Les zones absentes du modèle sont ignorées.
 */
export function paintZones(zones: ReadonlyMap<string, MeshPhysicalMaterial>, paints: Readonly<Record<string, Paint>>, bodyEnv: number): void {
  for (const [zone, material] of zones) {
    const paint = paints[zone];
    if (!paint) continue;
    const finish = findFinish(paint.finish);
    // Taille de paillette et seconde teinte du caméléon propres à la zone, si elle en a.
    applyPaint(material, paint.color, finish, { flake: paint.flake, color2: paint.color2 });
    material.envMapIntensity = finish.envMapIntensity * bodyEnv;
  }
}

// Cache de chargement : un modèle quitté est libéré (géométries, matériaux, textures, entrée du
// cache) quand plus aucun véhicule monté ne l'utilise. Le double montage du mode strict de React
// garde le modèle : la libération attend la fin de la tâche en cours.
const mounted = new Map<string, number>();

function releaseModel(url: string, gltf: GLTF): void {
  mounted.set(url, (mounted.get(url) ?? 0) - 1);
  window.setTimeout(() => {
    if ((mounted.get(url) ?? 0) > 0) return;
    mounted.delete(url);
    const materials = new Set<Material>();
    gltf.scene.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.geometry.dispose();
      for (const material of materialsOf(object)) materials.add(material);
    });
    for (const material of materials) {
      for (const [, texture] of texturesOf(material)) texture.dispose();
      material.dispose();
    }
    useLoader.clear(GLTFLoader, url);
  }, 0);
}

/**
 * Oublie un chargement tombé (réseau coupé, fichier introuvable) : sinon useLoader garde l'erreur
 * et la relance à chaque retour sur le véhicule, sans nouvelle requête. Un modèle monté n'est pas
 * touché : releaseModel le libère et l'oublie à son démontage.
 */
export function forgetModel(vehicle: Pick<VehicleManifest, 'id' | 'glb'>): void {
  const url = modelUrl(vehicle);
  if ((mounted.get(url) ?? 0) > 0) return;
  useLoader.clear(GLTFLoader, url);
}

/**
 * Ombre de contact (src/render/vehicleShadow.ts) : elle ne voit que le véhicule. Rendue une fois, à la
 * première image après sa pose ; remontée à chaque contexte WebGL rendu (clé d'époque), libérée au
 * démontage. Ses trois programmes sont lancés d'avance, avec ceux du véhicule.
 */
function VehicleShadow({ caster, halfLength, halfWidth, height, stamp, pieces }: VehicleMeasure & { caster: Object3D; stamp: number; pieces: string }) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  const rig = useMemo(() => new VehicleShadowRig(shadowSize({ halfLength, halfWidth, height })), [halfLength, halfWidth, height]);
  useEffect(() => () => rig.dispose(), [rig]);
  const pending = useRef(true);
  useLayoutEffect(() => {
    pending.current = true;
    rig.compile(gl);
    invalidate();
    // `pieces` : une pièce montée (aileron…) change la silhouette, l'ombre de contact se refait.
  }, [gl, rig, caster, invalidate, stamp, pieces]);
  useFrame(() => {
    if (!pending.current) return;
    pending.current = false;
    rig.render(gl, caster, scene);
    // Pour les parcours : combien de fois l'ombre a été refaite, et avec quelles pièces posées.
    const trace = globalThis as { __pmbOmbreContact?: { rendus: number; pieces: string } };
    trace.__pmbOmbreContact = { rendus: (trace.__pmbOmbreContact?.rendus ?? 0) + 1, pieces };
  });
  return <primitive object={rig.root} />;
}

/** Intervalle de l'attente avant le préchauffage de la peinture (véhicule dessiné, programmes prêts). */
const PAINT_WARM_POLL_MS = 100;
/** Premier usage des témoins de peinture : tranches de fil principal et pause entre deux (comme la trame). */
const PAINT_PRIME_SLICE_MS = 6;
const PAINT_PRIME_GAP_MS = 20;

interface VehicleModelProps {
  vehicle: VehicleManifest;
  /** Appelé une fois le modèle posé, pour le cadrage de la caméra et la coupe. */
  onMeasured: (id: string, measure: VehicleMeasure) => void;
  /** Part du reflet de l'environnement propre à la carrosserie, selon l'ambiance. */
  bodyEnv: number;
}

export function VehicleModel({ vehicle, onMeasured, bodyEnv }: VehicleModelProps) {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const url = modelUrl(vehicle);
  const gltf = useLoader(GLTFLoader, url, (loader) => {
    loader.setKTX2Loader(ktx2Loader(gl));
  });
  useEffect(() => {
    mounted.set(url, (mounted.get(url) ?? 0) + 1);
    return () => releaseModel(url, gltf);
  }, [url, gltf]);
  const prepared = useMemo(() => prepare(gltf.scene, vehicle), [gltf, vehicle]);
  useEffect(() => () => disposePrepared(prepared), [prepared]);

  // Peintures du store : chaque changement repeint, sans recharger le modèle.
  const build = useBuilds((state) => state.builds[vehicle.id]);
  const paints = useMemo(() => resolvePaints(vehicle, build), [vehicle, build]);
  const setStatus = useBench((state) => state.setStatus);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  // Cible liée pendant les compilations d'avance : la clé de programme dépend d'une cible non nulle.
  const warmTarget = useMemo(() => new WebGLRenderTarget(1, 1, { depthBuffer: false }), []);
  useEffect(() => () => warmTarget.dispose(), [warmTarget]);

  // Roues et assiette : posées avant la première image et avant la compilation d'avance, reposées à chaque choix.
  const { stamp } = useVehicleWheels(prepared, vehicle, invalidate, { merge: true });
  // Habitacle : volant, pommeau et sièges du build sur les ancres (src/scene/vehicle/habitacle.ts).
  useHabitacle(prepared, vehicle, invalidate, { preload: true });
  // Phares du build : lueur et glace des optiques, feux arrière (src/scene/vehicle/phares.ts).
  useVehicleLights(prepared.root, vehicle, { cloneRear: true, stageClass: 'stage', invalidate });
  // Pièces montées (aileron…) du build, sur la caisse (src/scene/vehicle/pieces.ts).
  const pieces = usePieces(prepared, vehicle, invalidate, bodyEnv, { preload: true });
  // Finition des sorties d'échappement du build (./echappement.ts).
  useFinitionEchappement(prepared.root, vehicle, invalidate);
  // Retour de flammes au garage, au lâcher d'un coup de gaz (Mécanique · Échappement, ligne libre).
  useFlammesGarage(prepared.root, vehicle, invalidate);
  // Capot moteur : ouvert à la pastille, vitré ou déposé, le moteur de l'établi dedans (./capot.ts).
  const capot = useCapotScene(prepared, vehicle, invalidate, bodyEnv, { garage: true, stageClass: 'stage', pieces });
  // Néons du build : tubes dans la caisse, lueur posée au sol à côté du modèle (./neons.ts).
  const neons = useNeons(prepared, vehicle, invalidate, { stageClass: 'stage', aim: true });

  // Avant la première image du véhicule : sinon elle le dessinerait avec le matériau neuf (sans
  // vernis), et compilerait pour rien une variante de plus pendant le démarrage. Rendu à la
  // demande : une image est redemandée après chaque peinture.
  useLayoutEffect(() => {
    paintZones(prepared.zones, paints, bodyEnv);
    invalidate();
  }, [prepared, paints, bodyEnv, invalidate]);
  // Stickers : recomposés à chaque changement du build, une image redemandée quand la texture est prête.
  const stickers = useBuilds((state) => state.builds[vehicle.id]?.stickers);
  useLayoutEffect(() => {
    if (prepared.livery) applyLivery(prepared.livery, stickers, invalidate);
  }, [prepared, stickers, invalidate]);
  // Vue intérieure : vitrages presque incolores, pour voir dehors par toutes les vitres.
  const inside = useView((state) => state.mode === 'interieur');
  useLayoutEffect(() => {
    setGlassInside(prepared.glass, inside);
    invalidate();
  }, [prepared, inside, invalidate]);
  // Programmes du véhicule peint lancés ensemble avant sa première image, au lieu de se compiler
  // un par un pendant celle-ci, fil principal bloqué (démarrage, changement de modèle).
  useLayoutEffect(() => {
    if (scene.environment !== null) precompileSeen(gl, prepared.root, scene, camera, warmTarget);
  }, [gl, scene, camera, prepared, warmTarget]);

  // Contexte WebGL rendu après une perte : l'ombre, rendue une fois, se refait (revue n° 4).
  const epoch = useRenderStats((state) => state.gpuEpoch);

  // Préchauffage des variantes de la peinture : après la première image du véhicule et ses
  // programmes prêts (le démarrage passe d'abord), puis à chaque nouvelle sonde (ambiance, niveau,
  // mode photo : autre environnement, autres lumières, donc autres clés de programme).
  const witnesses = useMemo(() => paintWitnesses(prepared.root, prepared.paints), [prepared]);
  useEffect(() => () => witnesses.dispose(), [witnesses]);
  // Puis premier usage de leurs programmes hors des images, par tranches, une fois compilés en tâche de
  // fond (requêtes de liaison et d'emplacements) : le premier choix d'une finition n'attend plus rien
  // dans l'image (revue d, m4), comme la trame du fondu (primeCutDither, src/render/cutDither.ts).
  useEffect(() => {
    let timer = 0;
    let programs: CutDitherProgram[] | null = null;
    let primed = 0;
    const drawn = () => prepared.paints.every((paint) => (gl.properties.get(paint) as { currentProgram?: unknown }).currentProgram !== undefined);
    const tick = () => {
      if (programs === null) {
        if (scene.environment === null || !drawn() || !programsReady(gl.info.programs)) {
          timer = window.setTimeout(tick, PAINT_WARM_POLL_MS);
          return;
        }
        warmPaintPrograms(gl, witnesses, scene, camera, warmTarget);
        programs = paintWitnessPrograms(gl, witnesses);
        primed = 0;
      }
      if (!programsReady(programs)) {
        timer = window.setTimeout(tick, PAINT_WARM_POLL_MS);
        return;
      }
      primed = primeCutDither(programs, primed, PAINT_PRIME_SLICE_MS);
      if (primed < programs.length) timer = window.setTimeout(tick, PAINT_PRIME_GAP_MS);
    };
    const schedule = () => {
      window.clearTimeout(timer);
      programs = null;
      timer = window.setTimeout(tick, 0);
    };
    schedule();
    const unsubscribe = useRenderStats.subscribe((state, previous) => {
      if (state.probe !== previous.probe) schedule();
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [gl, scene, camera, prepared, witnesses, warmTarget, epoch]);

  const { halfLength, halfWidth, height } = prepared;
  useEffect(() => {
    onMeasured(vehicle.id, { halfLength, halfWidth, height });
    // Gabarit publié pour les panneaux qui cadrent une partie du véhicule (Custom › Phares).
    useGabarit.getState().poser(vehicle.id, { halfLength, halfWidth, height });
    setStatus('pret');
  }, [vehicle.id, halfLength, halfWidth, height, onMeasured, setStatus]);

  return (
    <>
      <primitive object={prepared.root} />
      {/* Lueur des néons au sol : hors du modèle (que la sonde masque), pour que la caisse la reflète. */}
      <primitive object={neons.sol} />
      {/* À laisser à y = 0 : surélevée, son plan de flou passe derrière sa caméra et l'ombre
          disparaît dès que le post-traitement est coupé (niveau économie). Rendue une fois,
          avec le modèle déjà en place. */}
      {/* Hors de la sonde : elle n'y entrerait qu'aux captures faites après le modèle (revue n° 7). */}
      <group userData={{ hideInProbe: true }}>
        <VehicleShadow key={epoch} caster={prepared.root} halfLength={halfLength} halfWidth={halfWidth} height={height} stamp={stamp} pieces={`${pieces}|${capot.signature}`} />
      </group>
    </>
  );
}
