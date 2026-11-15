// placeholder_banc : le modèle de banc d'essai dans le garage, à la place des véhicules du
// catalogue. Tout ce qui lui est propre (fichier, matériaux de carrosserie, logos à masquer)
// vient de src/data/bench.ts ; ce composant ne connaît aucun nom de matériau.

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
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BASIS_TRANSCODER_DIR, type BenchModel } from '../../data/bench.ts';
import { finish as findFinish, type Finish } from '../../data/finishes.ts';
import { paintColor } from '../../data/paintColors.ts';
import { primeCutDither, programsReady, type CutDitherProgram } from '../../render/cutDither.ts';
import { applyPaint, createPaintMaterial, paintWitnessPrograms, paintWitnesses, warmPaintPrograms } from '../../render/paint.ts';
import { precompileSeen } from '../../render/ReflectionProbe.tsx';
import { useRenderStats } from '../../render/renderStats.ts';
import { shadowSize, VehicleShadowRig } from '../../render/vehicleShadow.ts';
import { useBench } from '../../state/bench.ts';

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

export interface BenchMeasure {
  /** Demi-longueur, demi-largeur et hauteur, une fois posé au sol. */
  halfLength: number;
  halfWidth: number;
  height: number;
}

/** Rang de dessin des pièces opaques du véhicule : avant le décor (0) et son sol (1). */
const VEHICLE_RENDER_ORDER = -2;

export interface Prepared extends BenchMeasure {
  root: Group;
  paints: MeshPhysicalMaterial[];
  /**
   * Ce que la préparation a créé, à libérer quand le modèle change ou quitte la scène. Le reste
   * (géométries d'origine, matériaux, textures, dont les cartes de normales reprises par la
   * peinture) appartient au cache de chargement, partagé : jamais libéré ici.
   */
  owned: { geometries: BufferGeometry[]; materials: Material[] };
}

/** Copie le modèle, remplace peinture et logos, le pose au sol, centré, longueur sur l'axe X. */
export function prepare(source: Group, model: BenchModel): Prepared {
  const scene = source.clone(true);
  const meshes: Mesh[] = [];
  scene.traverse((object) => {
    if (object instanceof Mesh) meshes.push(object);
  });

  // 1. Logos (exclus de la licence) : la plaque devient unie, et leurs images sont retirées
  //    de tout le modèle, où qu'elles soient posées (couleur, relief, émissif).
  const plain = new MeshStandardMaterial({ color: model.plainColor, roughness: 0.55, metalness: 0 });
  plain.name = 'placeholder_banc_plaque';
  const isPlain = (material: Material) => model.plainMaterials.includes(material.name);
  const logoSources = new Set<Texture['source']>();
  const all = new Set<Material>();
  for (const mesh of meshes) {
    for (const material of materialsOf(mesh)) {
      all.add(material);
      for (const logo of model.logoTextures) {
        if (logo.material !== material.name) continue;
        for (const [key, texture] of texturesOf(material)) {
          if (logo.maps.includes(key)) logoSources.add(texture.source);
        }
      }
    }
    if (!materialsOf(mesh).some(isPlain)) continue;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((material) => (isPlain(material) ? plain : material))
      : plain;
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
      const color = model.logoTextures.find((logo) => logo.material === material.name)?.color;
      if (key === 'map' && color) material.color.set(color);
    }
  }

  // 2. Carrosserie : un matériau de peinture par zone, partagé par toutes ses pièces.
  const paints: MeshPhysicalMaterial[] = [];
  for (const zone of model.paintZones) {
    let paint: MeshPhysicalMaterial | null = null;
    for (const mesh of meshes) {
      const materials = materialsOf(mesh);
      const index = materials.findIndex((material) => zone.materials.includes(material.name));
      if (index < 0) continue;
      paint ??= createPaintMaterial(materials[index]);
      if (Array.isArray(mesh.material)) mesh.material[index] = paint;
      else mesh.material = paint;
    }
    if (paint) paints.push(paint);
  }

  // 3. Vitrages transparents plutôt que réfractants (voir src/data/bench.ts).
  for (const material of all) {
    if (!model.glass.materials.includes(material.name) || !(material instanceof MeshPhysicalMaterial)) continue;
    material.transmission = 0;
    material.color.set(model.glass.color);
    material.transparent = true;
    material.opacity = model.glass.opacity;
    material.depthWrite = false;
    material.needsUpdate = true;
  }

  // 4. Phares, feux stop et clignotants allumés.
  for (const material of all) {
    const lamp = model.lamps.find((item) => item.materials.includes(material.name));
    if (!lamp || !(material instanceof MeshStandardMaterial)) continue;
    material.emissive.set(lamp.color);
    material.emissiveIntensity = lamp.intensity;
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
  root.name = 'placeholder_banc';
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
  const quarterTurns = (size.z > size.x ? 1 : 0) + model.yawQuarterTurns;
  turn.rotation.y = (quarterTurns * Math.PI) / 2;
  turn.updateMatrixWorld(true);
  const box = new Box3().setFromObject(turn, true);
  size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  turn.position.set(-center.x, -box.min.y, -center.z);

  return {
    root,
    paints,
    halfLength: size.x / 2,
    halfWidth: size.z / 2,
    height: size.y,
    owned: { geometries: mergedGeometries, materials: [plain, ...paints] },
  };
}

/** Libère ce que `prepare` a créé (revue n° 12), sans toucher à ce que le cache de chargement partage. */
export function disposePrepared(prepared: Prepared): void {
  for (const geometry of prepared.owned.geometries) geometry.dispose();
  for (const material of prepared.owned.materials) material.dispose();
}

/** Peint la carrosserie ; l'ambiance règle la part de reflet de l'environnement. */
function paintBody(paints: readonly MeshPhysicalMaterial[], hex: string, finish: Finish, bodyEnv: number): void {
  for (const paint of paints) {
    applyPaint(paint, hex, finish);
    paint.envMapIntensity = finish.envMapIntensity * bodyEnv;
  }
}

/**
 * Ombre de contact (src/render/vehicleShadow.ts) : elle ne voit que le véhicule. Rendue une fois, à la
 * première image après sa pose ; remontée à chaque contexte WebGL rendu (clé d'époque), libérée au
 * démontage. Ses trois programmes sont lancés d'avance, avec ceux du véhicule.
 */
function VehicleShadow({ caster, halfLength, halfWidth, height }: BenchMeasure & { caster: Object3D }) {
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

interface BenchCarProps {
  model: BenchModel;
  /** Appelé une fois le modèle posé, pour le cadrage de la caméra. */
  onMeasured: (measure: BenchMeasure) => void;
  /** Part du reflet de l'environnement propre à la carrosserie, selon l'ambiance. */
  bodyEnv: number;
}

export function BenchCar({ model, onMeasured, bodyEnv }: BenchCarProps) {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const gltf = useLoader(GLTFLoader, `${BASE}${model.file}`, (loader) => {
    loader.setKTX2Loader(ktx2Loader(gl));
  });
  const prepared = useMemo(() => prepare(gltf.scene, model), [gltf, model]);
  useEffect(() => () => disposePrepared(prepared), [prepared]);

  const colorId = useBench((state) => state.color);
  const finishId = useBench((state) => state.finish);
  const setStatus = useBench((state) => state.setStatus);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  // Cible liée pendant les compilations d'avance : la clé de programme dépend d'une cible non nulle.
  const warmTarget = useMemo(() => new WebGLRenderTarget(1, 1, { depthBuffer: false }), []);
  useEffect(() => () => warmTarget.dispose(), [warmTarget]);

  // Avant la première image du véhicule : sinon elle le dessinerait avec le matériau neuf (sans
  // vernis), et compilerait pour rien une variante de plus pendant le démarrage.
  useLayoutEffect(() => {
    const { hex } = paintColor(colorId);
    const finish = findFinish(finishId);
    paintBody(prepared.paints, hex, finish, bodyEnv);
    invalidate();
  }, [prepared, colorId, finishId, bodyEnv, invalidate]);
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
    onMeasured({ halfLength, halfWidth, height });
    setStatus('pret');
  }, [halfLength, halfWidth, height, onMeasured, setStatus]);

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
