// Sonde de réflexion locale (§ 8, ingrédient non négociable) : une cubemap rendue depuis la
// position du véhicule, véhicule masqué, préfiltrée (PMREM) et posée comme environnement de la
// scène. C'est elle qui fait lire les tubes, les spots et les halos du décor dans la carrosserie.
// Elle se refait quand l'ambiance ou la qualité change, jamais à chaque image.
// Un objet marqué `userData.hideInProbe` (le véhicule) n'y apparaît pas. Elle voit en plus les
// calques PROBE_ONLY (rampes du plafond) et NO_MIRROR (petits objets) : src/render/layers.ts.

import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  CubeCamera,
  HalfFloatType,
  LinearMipmapLinearFilter,
  LinearSRGBColorSpace,
  MathUtils,
  PerspectiveCamera,
  PMREMGenerator,
  UnsignedByteType,
  WebGLCubeRenderTarget,
  WebGLRenderTarget,
  type Camera,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from 'three';
import type { Vec3 } from '../data/garage.ts';
import { CAMERA_LAYERS, PROBE_LAYERS } from './layers.ts';
import { useRenderStats } from './renderStats.ts';

interface Capture {
  target: WebGLRenderTarget;
  ms: number;
}

/**
 * Cube source du préfiltrage, gardé par le générateur d'une capture à l'autre (three 0.187,
 * champ privé `_sourceTarget`) : on libère sa mémoire graphique après chaque capture, comme le
 * faisait le générateur jetable ; il se réalloue de lui-même à la suivante.
 */
function releasePmremSource(pmrem: PMREMGenerator): void {
  (pmrem as unknown as { _sourceTarget?: WebGLRenderTarget | null })._sourceTarget?.dispose();
}

/** Cible cube en 8 bits, réglée comme celles du générateur de three 0.187 (`_createRenderTarget`). */
function byteCube(size: number, generateMipmaps: boolean): WebGLCubeRenderTarget {
  return new WebGLCubeRenderTarget(size, {
    minFilter: LinearMipmapLinearFilter,
    generateMipmaps,
    type: UnsignedByteType,
    colorSpace: LinearSRGBColorSpace,
    depthBuffer: false,
  });
}

/**
 * Préfiltrage sans cibles flottantes (ni EXT_color_buffer_float ni _half_float : les cibles en
 * demi-flottants du générateur resteraient incomplètes, carrosserie sans reflets). Mêmes passes,
 * cibles en 8 bits fournies au générateur : son cube source (champ privé `_sourceTarget`, repris
 * tel quel s'il a la bonne taille) et la cible de sortie, avec ses niveaux préfiltrés (taille
 * minimale et dernier niveau de three 0.187 : 256 et 8 pixels). Les reflets plus vifs que le
 * blanc sont écrêtés : moins beau, mais lisible.
 */
function prefilterBytes(pmrem: PMREMGenerator, cube: WebGLCubeRenderTarget, size: number): WebGLRenderTarget {
  const side = Math.max(256, MathUtils.floorPowerOfTwo(size));
  const internals = pmrem as unknown as { _sourceTarget: WebGLRenderTarget | null };
  internals._sourceTarget?.dispose();
  internals._sourceTarget = byteCube(side, true);
  const output = byteCube(side, false);
  const texture = output.texture as typeof output.texture & { isPMREMTexture?: boolean; mipmaps: Array<{ width: number; height: number }> };
  for (let lod = 0; lod <= Math.log2(side) - 3; lod += 1) texture.mipmaps.push({ width: side >> lod, height: side >> lod });
  texture.name = 'PMREM';
  texture.isPMREMTexture = true;
  return pmrem.fromCubemap(cube.texture, output);
}

/**
 * Lance d'un coup, sans rien dessiner, la compilation des programmes de ce que `camera` verra de
 * `root` dans l'état actuel de la scène (objets visibles, calques, environnement, brume, lumières),
 * `target` liée : toute cible non nulle donne la clé des passes réelles (espace linéaire, sans tone
 * mapping). Sans cela, chaque programme se compile à sa première utilisation, l'un après l'autre,
 * fil principal bloqué (démarrage, ambiance, niveau) ; lancées ensemble, les compilations se
 * recouvrent (KHR_parallel_shader_compile). Objet par objet : un objet caché ou hors calque ne
 * crée aucun programme inutile.
 */
export function precompileSeen(gl: WebGLRenderer, root: Object3D, scene: Scene, camera: Camera, target: WebGLRenderTarget): void {
  const seen: Object3D[] = [];
  root.traverseVisible((object) => {
    const drawable = object as Object3D & { isMesh?: boolean; isPoints?: boolean; isLine?: boolean; isSprite?: boolean };
    if ((drawable.isMesh || drawable.isPoints || drawable.isLine || drawable.isSprite) && object.layers.test(camera.layers)) seen.push(object);
  });
  const previous = gl.getRenderTarget();
  gl.setRenderTarget(target);
  try {
    for (const object of seen) gl.compile(object, camera, scene);
  } finally {
    gl.setRenderTarget(previous);
  }
}

/**
 * Rend la cubemap et la préfiltre. Le décor est vu sans environnement : pas de reflet d'un ancien état.
 * Le générateur est celui du composant : ses nuanceurs (copie du cube, GGX, intégration) restent
 * compilés d'une capture à l'autre. La durée relevée est celle du fil principal (envoi des
 * commandes) : on n'attend plus la carte graphique, qui finit sans bloquer l'interface.
 */
function capture(
  gl: WebGLRenderer,
  scene: Scene,
  pmrem: PMREMGenerator,
  size: number,
  position: Vec3,
  warm: WebGLRenderTarget,
  floatTargets: boolean,
): Capture {
  const start = performance.now();
  const cube = new WebGLCubeRenderTarget(size, { type: floatTargets ? HalfFloatType : UnsignedByteType, generateMipmaps: false });
  const camera = new CubeCamera(0.05, 60, cube);
  camera.position.set(...position);
  // Les six caméras partagent les calques du support : rampes du plafond et petits objets en plus.
  for (const layer of PROBE_LAYERS) camera.layers.enable(layer);

  const hidden: Object3D[] = [];
  // Un objet peut aussi s'apprêter pour la sonde (`userData.onProbe`, qui rend de quoi revenir) :
  // le sol coupe ainsi son reflet planaire, rendu à l'image d'avant (autre ambiance, véhicule compris).
  const restores: Array<() => void> = [];
  scene.traverse((object) => {
    if (object.userData.hideInProbe === true && object.visible) {
      object.visible = false;
      hidden.push(object);
    }
    const prepare: unknown = object.userData.onProbe;
    if (typeof prepare === 'function') restores.push((prepare as () => () => void)());
  });
  const environment = scene.environment;
  scene.environment = null;
  // La chaîne d'image coupe l'effacement automatique : sans lui, chaque face garderait
  // l'image de l'ambiance précédente sous la nouvelle.
  const autoClear = gl.autoClear;
  gl.autoClear = true;
  // Programmes du décor vu par la sonde (sans environnement) : lancés ensemble avant les six faces.
  // (Une des six caméras : elles partagent les calques du support.)
  const face = camera.children[0];
  if (face instanceof PerspectiveCamera) precompileSeen(gl, scene, scene, face, warm);
  camera.update(gl, scene);
  gl.autoClear = autoClear;
  scene.environment = environment;
  for (const object of hidden) object.visible = true;
  for (const restore of restores) restore();

  const target = floatTargets ? pmrem.fromCubemap(cube.texture) : prefilterBytes(pmrem, cube, size);
  releasePmremSource(pmrem);
  cube.dispose();
  return { target, ms: performance.now() - start };
}

/** Pose la sonde comme environnement de la scène ; rend de quoi la retirer et la libérer. */
function install(scene: Scene, target: WebGLRenderTarget): () => void {
  scene.environment = target.texture;
  return () => {
    if (scene.environment === target.texture) scene.environment = null;
    target.dispose();
  };
}

export interface ReflectionProbeProps {
  /** Côté d'une face de la cubemap, en pixels. */
  size: number;
  position: Vec3;
  /** Change quand le décor change d'éclairage (identifiant d'ambiance) : la sonde se refait. */
  version: string;
  /** Change quand le contexte WebGL revient d'une perte : la sonde, vidée, se refait. */
  epoch?: number;
}

export function ReflectionProbe({ size, position, version, epoch = 0 }: ReflectionProbeProps) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  // Sans cibles en demi-flottants, la sonde passe en 8 bits. Lu ici sur le contexte : la première
  // capture précède le relevé de la scène (useRenderStats.floatTargets, posé après).
  const floatTargets = useMemo(() => gl.extensions.has('EXT_color_buffer_float') || gl.extensions.has('EXT_color_buffer_half_float'), [gl]);
  const [x, y, z] = position;
  // Un générateur par vie du composant (et par contexte) : neuf à chaque capture, il recompilait
  // ses quatre nuanceurs à chaque ambiance (revue n° 6).
  const pmrem = useMemo(() => new PMREMGenerator(gl), [gl]);
  useEffect(() => () => pmrem.dispose(), [pmrem]);
  // Cible liée pendant les compilations lancées d'avance, et caméra aux calques de la caméra
  // principale (posés par la scène après cet effet, à la première capture).
  const warm = useMemo(() => new WebGLRenderTarget(1, 1, { depthBuffer: false }), []);
  useEffect(() => () => warm.dispose(), [warm]);
  const viewer = useMemo(() => {
    const camera = new PerspectiveCamera();
    for (const layer of CAMERA_LAYERS) camera.layers.enable(layer);
    return camera;
  }, []);

  useEffect(() => {
    const { target, ms } = capture(gl, scene, pmrem, size, [x, y, z], warm, floatTargets);
    const uninstall = install(scene, target);
    // Programmes de l'image (décor sous le nouvel environnement) : lancés avant la prochaine image.
    precompileSeen(gl, scene, scene, viewer, warm);
    useRenderStats.setState((state) => ({
      probe: { size, ms: Math.round(ms), updates: (state.probe?.updates ?? 0) + 1, version },
    }));
    // Les appels de dessin de la sonde ne comptent pas dans ceux de l'image.
    gl.info.reset();
    invalidate();
    return uninstall;
  }, [gl, scene, pmrem, warm, viewer, size, x, y, z, version, epoch, floatTargets, invalidate]);

  return null;
}
