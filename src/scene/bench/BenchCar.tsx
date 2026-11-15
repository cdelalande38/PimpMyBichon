// placeholder_banc : le modèle de banc d'essai dans le garage, à la place des véhicules du
// catalogue. Tout ce qui lui est propre (fichier, matériaux de carrosserie, logos à masquer)
// vient de src/data/bench.ts ; ce composant ne connaît aucun nom de matériau.

import { ContactShadows } from '@react-three/drei';
import { useLoader, useThree } from '@react-three/fiber';
import { memo, useEffect, useMemo } from 'react';
import {
  Box3,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Texture,
  Vector3,
  type Camera,
  type Material,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BASIS_TRANSCODER_DIR, type BenchModel } from '../../data/bench.ts';
import { FINISHES, finish as findFinish, type Finish } from '../../data/finishes.ts';
import { paintColor } from '../../data/paintColors.ts';
import { applyPaint, createPaintMaterial, programVariants } from '../../render/paint.ts';
import { useRenderStats } from '../../render/renderStats.ts';
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

interface Prepared extends BenchMeasure {
  root: Group;
  paints: MeshPhysicalMaterial[];
}

/** Copie le modèle, remplace peinture et logos, le pose au sol, centré, longueur sur l'axe X. */
function prepare(source: Group, model: BenchModel): Prepared {
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
  for (const parts of groups.values()) {
    const first = parts[0];
    if (!first || parts.length < 2) continue;
    const geometries = parts.map((part) => part.geometry.clone().applyMatrix4(part.matrixWorld));
    const geometry = mergeGeometries(geometries, false);
    for (const item of geometries) item.dispose();
    if (!geometry) continue;
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

  return { root, paints, halfLength: size.x / 2, halfWidth: size.z / 2, height: size.y };
}

/** Peint la carrosserie ; l'ambiance règle la part de reflet de l'environnement. */
function paintBody(paints: readonly MeshPhysicalMaterial[], hex: string, finish: Finish, bodyEnv: number): void {
  for (const paint of paints) {
    applyPaint(paint, hex, finish);
    paint.envMapIntensity = finish.envMapIntensity * bodyEnv;
  }
}

/**
 * Ombre de contact, rendue une fois. Mémoïsée : le compteur d'images de ContactShadows repart
 * à zéro à chaque rendu React, et un changement de peinture referait tout un rendu de scène.
 */
const ContactShadow = memo(function ContactShadow({ halfLength, halfWidth, height }: BenchMeasure) {
  return <ContactShadows scale={[halfLength * 2.5, halfWidth * 3]} far={height} blur={2.2} opacity={0.8} resolution={512} frames={1} />;
});

/**
 * Compile d'avance, en tâche de fond, chaque variante du programme de peinture (vernis oui/non ×
 * irisation oui/non) avec l'éclairage de la scène : sinon elle se compile au premier toucher
 * d'une finition, sur le fil principal (saccade sur Android). Les matériaux témoins gardent les
 * programmes en vie ; la fonction rendue les libère.
 */
function warmPaintPrograms(gl: WebGLRenderer, scene: Scene, camera: Camera, root: Object3D, paints: readonly MeshPhysicalMaterial[]): () => void {
  let sample: Mesh | null = null;
  root.traverse((object) => {
    if (sample || !(object instanceof Mesh)) return;
    const materials: readonly Material[] = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.some((material) => paints.includes(material as MeshPhysicalMaterial))) sample = object;
  });
  const source = paints[0];
  if (!sample || !source) return () => {};
  const geometry = (sample as Mesh).geometry;
  const witnesses = new Group();
  const materials = programVariants(FINISHES).map((item) => {
    const material = createPaintMaterial(source);
    applyPaint(material, '#808080', item);
    witnesses.add(new Mesh(geometry, material));
    return material;
  });
  void gl.compileAsync(witnesses, camera, scene).catch(() => undefined);
  return () => {
    for (const material of materials) material.dispose();
  };
}

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

  const colorId = useBench((state) => state.color);
  const finishId = useBench((state) => state.finish);
  const setStatus = useBench((state) => state.setStatus);

  useEffect(() => {
    const { hex } = paintColor(colorId);
    const finish = findFinish(finishId);
    paintBody(prepared.paints, hex, finish, bodyEnv);
    invalidate();
  }, [prepared, colorId, finishId, bodyEnv, invalidate]);

  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  useEffect(() => warmPaintPrograms(gl, scene, camera, prepared.root, prepared.paints), [gl, scene, camera, prepared]);

  // Contexte WebGL rendu après une perte : l'ombre, rendue une fois, se refait (revue n° 4).
  const epoch = useRenderStats((state) => state.gpuEpoch);

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
        <ContactShadow key={epoch} halfLength={halfLength} halfWidth={halfWidth} height={height} />
      </group>
    </>
  );
}
