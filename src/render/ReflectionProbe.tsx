// Sonde de réflexion locale (§ 8, ingrédient non négociable) : une cubemap rendue depuis la
// position du véhicule, véhicule masqué, préfiltrée (PMREM) et posée comme environnement de la
// scène. C'est elle qui fait lire les tubes, les spots et les halos du décor dans la carrosserie.
// Elle se refait quand l'ambiance ou la qualité change, jamais à chaque image.
// Un objet marqué `userData.hideInProbe` (le véhicule) n'y apparaît pas. Elle voit en plus les
// calques PROBE_ONLY (rampes du plafond) et NO_MIRROR (petits objets) : src/render/layers.ts.

import { useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
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
  type Material,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from 'three';
import type { Vec3 } from '../data/garage.ts';
import { primeCutDither, programsReady, type CutDitherProgram } from './cutDither.ts';
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
export function precompileSeen(gl: WebGLRenderer, root: Object3D, scene: Scene, camera: Camera, target: WebGLRenderTarget): Set<Material> {
  const seen: Object3D[] = [];
  const materials = new Set<Material>();
  root.traverseVisible((object) => {
    const drawable = object as Object3D & { isMesh?: boolean; isPoints?: boolean; isLine?: boolean; isSprite?: boolean };
    if ((drawable.isMesh || drawable.isPoints || drawable.isLine || drawable.isSprite) && object.layers.test(camera.layers)) seen.push(object);
  });
  const previous = gl.getRenderTarget();
  gl.setRenderTarget(target);
  try {
    for (const object of seen) for (const material of gl.compile(object, camera, scene)) materials.add(material);
  } finally {
    gl.setRenderTarget(previous);
  }
  return materials;
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
  precompile: boolean,
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
  if (precompile && face instanceof PerspectiveCamera) precompileSeen(gl, scene, scene, face, warm);
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

/** Pose une sonde comme environnement de la scène ; l'ancienne (`slot`) est libérée. */
function installProbe(scene: Scene, slot: { current: WebGLRenderTarget | null }, target: WebGLRenderTarget): void {
  const previous = slot.current;
  slot.current = target;
  scene.environment = target.texture;
  if (previous !== target) previous?.dispose();
}

/** Retire la sonde posée (`slot`) et la libère. */
function removeProbe(scene: Scene, slot: { current: WebGLRenderTarget | null }): void {
  const target = slot.current;
  slot.current = null;
  if (!target) return;
  if (scene.environment === target.texture) scene.environment = null;
  target.dispose();
}

/** Lance les programmes de ce que `camera` verra sous l'environnement `next`, sans le poser : l'environnement d'avant revient. */
function precompileUnder(gl: WebGLRenderer, scene: Scene, camera: Camera, target: WebGLRenderTarget, next: WebGLRenderTarget, previous: WebGLRenderTarget): Set<Material> {
  scene.environment = next.texture;
  try {
    return precompileSeen(gl, scene, scene, camera, target);
  } finally {
    scene.environment = previous.texture;
  }
}

/** Programmes que ces matériaux viennent de prendre (compile() pose `currentProgram`). */
function programsOf(gl: WebGLRenderer, materials: Iterable<Material>): CutDitherProgram[] {
  const programs = new Set<CutDitherProgram>();
  for (const material of materials) {
    const program = (gl.properties.get(material) as { currentProgram?: CutDitherProgram } | undefined)?.currentProgram;
    if (program) programs.add(program);
  }
  return [...programs];
}

/**
 * Programmes créés pour une sonde différée dont l'amorçage n'est pas allé au bout (sonde remplacée
 * entre-temps, par exemple en sortant du mode photo aussitôt entré) : encore à amorcer s'ils resservent.
 */
const unprimed = new WeakSet<CutDitherProgram>();

/** Attente des programmes d'une nouvelle sonde, puis premier usage par tranches (comme la trame du fondu). */
const PROBE_POLL_MS = 50;
const PROBE_PRIME_SLICE_MS = 6;
const PROBE_PRIME_GAP_MS = 20;

/** Programmes de three apparus depuis le relevé `known` (renderer.info.programs). */
function freshPrograms(gl: WebGLRenderer, known: ReadonlySet<unknown>): CutDitherProgram[] {
  return ((gl.info.programs ?? []) as unknown as CutDitherProgram[]).filter((program) => !known.has(program));
}

/**
 * Attend que `programs` soient compilés et liés (tâche de fond, KHR_parallel_shader_compile), fait
 * leur premier usage par tranches, hors des images (`primeCutDither`), puis appelle `done`. Sans
 * l'extension, ils sont prêts d'emblée et la liaison s'attend dans les tranches. Rend de quoi annuler.
 */
export function afterPriming(programs: readonly CutDitherProgram[], done: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let primed = 0;
  const tick = () => {
    if (!programsReady(programs)) {
      timer = setTimeout(tick, PROBE_POLL_MS);
      return;
    }
    primed = primeCutDither(programs, primed, PROBE_PRIME_SLICE_MS);
    if (primed < programs.length) {
      timer = setTimeout(tick, PROBE_PRIME_GAP_MS);
      return;
    }
    timer = undefined;
    done();
  };
  timer = setTimeout(tick, 0);
  return () => clearTimeout(timer);
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
  // Sans compilation en tâche de fond, attendre ne sert à rien : la liaison bloquerait de toute façon
  // le fil principal ; la sonde se pose tout de suite, comme avant (rendu logiciel, parcours e2e).
  const parallel = useMemo(() => gl.extensions.has('KHR_parallel_shader_compile'), [gl]);
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

  // Sonde posée (environnement de la scène) : gardée jusqu'à ce que la suivante soit prête, libérée au
  // démontage.
  const installed = useRef<WebGLRenderTarget | null>(null);
  useLayoutEffect(() => () => removeProbe(scene, installed), [scene]);

  // Effet de mise en page : la capture précède toute image. En effet ordinaire, une image pouvait
  // partir avant elle, au démarrage (scène montée dans un rendu à part, une fois les cibles connues) :
  // dessinée sans environnement, jamais affichée, ses compilations retardaient la première vraie
  // image (revue d, m2). Après celui du garage (frère précédent) : couleurs de l'ambiance posées.
  // Compilations lancées d'avance : pas à la première capture (démarrage). Elles y allongeaient la
  // plus longue tâche sans avancer l'image sur un processeur bridé (mesure de corr-e) ; la première
  // image compile alors ses programmes elle-même, comme avant 8d46b53.
  // Ensuite, une sonde qui change de taille (mode photo, niveau Max) change la clé de programme de
  // tout ce qui reflète l'environnement : ses programmes sont créés sans la poser, compilés en tâche
  // de fond, puis amorcés hors des images, et la sonde n'est posée qu'après ; les images d'ici là
  // gardent l'ancienne, dont les programmes sont prêts (revue d, M1 : image figée de 2,5 à 4 s). La
  // photo repart à zéro quand elle est posée (`probe.updates`, src/render/photo/PhotoDirector.tsx).
  const captured = useRef(false);
  const lastEpoch = useRef(epoch);
  useLayoutEffect(() => {
    const precompile = captured.current;
    captured.current = true;
    // Contexte rendu après une perte : l'ancienne sonde est vide, rien à garder.
    const restored = lastEpoch.current !== epoch;
    lastEpoch.current = epoch;
    const { target, ms } = capture(gl, scene, pmrem, size, [x, y, z], warm, floatTargets, precompile);
    // Les appels de dessin de la sonde ne comptent pas dans ceux de l'image.
    gl.info.reset();
    const posed = { current: false };
    const put = () => {
      posed.current = true;
      installProbe(scene, installed, target);
      useRenderStats.setState((state) => ({
        probe: { size, ms: Math.round(ms), updates: (state.probe?.updates ?? 0) + 1, version },
      }));
      invalidate();
    };
    const previous = installed.current;
    if (!precompile || previous === null || restored || !parallel) {
      put();
      // Programmes de l'image (décor sous le nouvel environnement) : lancés avant la prochaine image.
      if (precompile) precompileSeen(gl, scene, scene, viewer, warm);
      return undefined;
    }
    // Programmes de l'image sous la nouvelle sonde, lancés sans la poser.
    const known = new Set<unknown>(gl.info.programs ?? []);
    const materials = precompileUnder(gl, scene, viewer, warm, target, previous);
    const fresh = freshPrograms(gl, known);
    for (const program of fresh) unprimed.add(program);
    const pending = [...new Set([...fresh, ...programsOf(gl, materials).filter((program) => unprimed.has(program))])];
    // Même taille (ambiance) : programmes déjà là et déjà servis, la sonde se pose tout de suite.
    if (pending.length === 0) {
      put();
      return undefined;
    }
    const cancel = afterPriming(pending, () => {
      for (const program of pending) unprimed.delete(program);
      put();
    });
    return () => {
      cancel();
      // Remplacée avant d'être posée (autre changement entre-temps) : jamais vue, libérée.
      if (!posed.current) target.dispose();
    };
  }, [gl, scene, pmrem, warm, viewer, size, x, y, z, version, epoch, floatTargets, parallel, invalidate]);

  return null;
}
