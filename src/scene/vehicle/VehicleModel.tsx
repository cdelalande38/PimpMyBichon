// Le véhicule du garage : n'importe quel véhicule du catalogue (src/data/vehicles.ts), chargé à
// la demande d'après son manifeste. Un modèle aux conventions du § 8 est habillé par le nom de ses
// matériaux (src/data/materialRoles.ts) ; un modèle qui ne les suit pas (le banc d'essai,
// placeholder_banc) l'est par la section « adapt » de son manifeste. Ce composant ne connaît
// aucun véhicule ni aucun nom de matériau propre à un modèle.

import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  Box3,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Texture,
  Vector3,
  WebGLRenderTarget,
  type BufferGeometry,
  type Material,
  type Object3D,
  type WebGLRenderer,
} from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BASIS_TRANSCODER_DIR } from '../../data/bench.ts';
import { finish as findFinish } from '../../data/finishes.ts';
import { materialRole, paintZoneOf } from '../../data/materialRoles.ts';
import { modelUrl } from '../../data/vehicles.ts';
import type { Paint, VehicleManifest } from '../../data/vehicleTypes.ts';
import { primeCutDither, programsReady, type CutDitherProgram } from '../../render/cutDither.ts';
import { applyPaint, createPaintMaterial, paintWitnessPrograms, paintWitnesses, warmPaintPrograms } from '../../render/paint.ts';
import { precompileSeen } from '../../render/ReflectionProbe.tsx';
import { useRenderStats } from '../../render/renderStats.ts';
import { shadowSize, VehicleShadowRig } from '../../render/vehicleShadow.ts';
import { useBench } from '../../state/bench.ts';
import { resolvePaints, useBuilds } from '../../state/builds.ts';

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
  /**
   * Ce que la préparation a créé, à libérer quand le modèle change ou quitte la scène. Le reste
   * (géométries d'origine, matériaux, textures, dont les cartes de normales reprises par la
   * peinture) appartient au cache de chargement, partagé : jamais libéré ici.
   */
  owned: { geometries: BufferGeometry[]; materials: Material[] };
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

/** Vitrage transparent et teinté plutôt que réfractant (une passe de rendu complète de moins). */
function makeGlass(material: Material, color: string, opacity: number): void {
  if (!(material instanceof MeshStandardMaterial)) return;
  if (material instanceof MeshPhysicalMaterial) material.transmission = 0;
  material.color.set(color);
  material.transparent = true;
  material.opacity = opacity;
  material.depthWrite = false;
  material.needsUpdate = true;
}

function makeLamp(material: Material, color: string, intensity: number): void {
  if (!(material instanceof MeshStandardMaterial)) return;
  material.emissive.set(color);
  material.emissiveIntensity = intensity;
}

/** Copie le modèle, pose peinture, rôles et adaptation, le pose au sol, centré, longueur sur X. */
export function prepare(source: Group, vehicle: VehicleManifest): Prepared {
  const scene = source.clone(true);
  const meshes: Mesh[] = [];
  scene.traverse((object) => {
    if (object instanceof Mesh) meshes.push(object);
  });
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
  const paints = [...zones.values()];
  owned.push(...paints);

  // 3. Rôles des matériaux aux conventions (chrome, alu, vitrage, optiques…).
  for (const material of all) {
    const role = materialRole(material.name);
    if (!role || zoneOf(material) || !(material instanceof MeshStandardMaterial)) continue;
    if (role.opacity !== undefined) {
      makeGlass(material, role.color, role.opacity);
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
    const { glass } = adapt;
    for (const material of all) if (glass.materials.includes(material.name)) makeGlass(material, glass.color, glass.opacity);
  }
  for (const lamp of adapt?.lamps ?? []) {
    for (const material of all) if (lamp.materials.includes(material.name)) makeLamp(material, lamp.color, lamp.intensity);
  }

  // 5. Budget de draw calls (§ 8) : le modèle est immobile, ses pièces sont fusionnées par
  //    matériau. Seules les géométries aux attributs identiques se fusionnent.
  scene.updateMatrixWorld(true);
  const groups = new Map<string, Mesh[]>();
  for (const mesh of meshes) {
    if (Array.isArray(mesh.material)) continue;
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
    const geometry = mergeGeometries(geometries, false);
    for (const item of geometries) item.dispose();
    if (!geometry) continue;
    mergedGeometries.push(geometry);
    const mesh = new Mesh(geometry, first.material);
    mesh.name = `fusion_${(first.material as Material).name}`;
    merged.add(mesh);
    for (const part of parts) part.removeFromParent();
  }

  // 6. Pose : longueur sur X, au sol, centré. Orientation mesurée, jamais supposée.
  const root = new Group();
  root.name = vehicle.placeholder ?? `vehicule_${vehicle.id}`;
  // Le véhicule ne se reflète pas lui-même : la sonde de réflexion le masque.
  root.userData.hideInProbe = true;
  const turn = new Group();
  // Les pièces fusionnées sont déjà dans le repère du parent du modèle : elles vont à côté.
  turn.add(scene, merged);
  root.add(turn);
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
  size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  turn.position.set(-center.x, -box.min.y, -center.z);

  return {
    root,
    paints,
    zones,
    halfLength: size.x / 2,
    halfWidth: size.z / 2,
    height: size.y,
    owned: { geometries: mergedGeometries, materials: owned },
  };
}

/** Libère ce que `prepare` a créé (revue n° 12), sans toucher à ce que le cache de chargement partage. */
export function disposePrepared(prepared: Prepared): void {
  for (const geometry of prepared.owned.geometries) geometry.dispose();
  for (const material of prepared.owned.materials) material.dispose();
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
 * Ombre de contact (src/render/vehicleShadow.ts) : elle ne voit que le véhicule. Rendue une fois, à la
 * première image après sa pose ; remontée à chaque contexte WebGL rendu (clé d'époque), libérée au
 * démontage. Ses trois programmes sont lancés d'avance, avec ceux du véhicule.
 */
function VehicleShadow({ caster, halfLength, halfWidth, height }: VehicleMeasure & { caster: Object3D }) {
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
  }, [gl, rig, caster, invalidate]);
  useFrame(() => {
    if (!pending.current) return;
    pending.current = false;
    rig.render(gl, caster, scene);
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

  // Avant la première image du véhicule : sinon elle le dessinerait avec le matériau neuf (sans
  // vernis), et compilerait pour rien une variante de plus pendant le démarrage. Rendu à la
  // demande : une image est redemandée après chaque peinture.
  useLayoutEffect(() => {
    paintZones(prepared.zones, paints, bodyEnv);
    invalidate();
  }, [prepared, paints, bodyEnv, invalidate]);
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
    setStatus('pret');
  }, [vehicle.id, halfLength, halfWidth, height, onMeasured, setStatus]);

  return (
    <>
      <primitive object={prepared.root} />
      {/* À laisser à y = 0 : surélevée, son plan de flou passe derrière sa caméra et l'ombre
          disparaît dès que le post-traitement est coupé (niveau économie). Rendue une fois,
          avec le modèle déjà en place. */}
      {/* Hors de la sonde : elle n'y entrerait qu'aux captures faites après le modèle (revue n° 7). */}
      <group userData={{ hideInProbe: true }}>
        <VehicleShadow key={epoch} caster={prepared.root} halfLength={halfLength} halfWidth={halfWidth} height={height} />
      </group>
    </>
  );
}
