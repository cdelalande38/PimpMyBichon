// Sonde de réflexion locale (§ 8, ingrédient non négociable) : une cubemap rendue depuis la
// position du véhicule, véhicule masqué, préfiltrée (PMREM) et posée comme environnement de la
// scène. C'est elle qui fait lire les tubes, les spots et les halos du décor dans la carrosserie.
// Elle se refait quand l'ambiance ou la qualité change, jamais à chaque image.
// Un objet marqué `userData.hideInProbe` (le véhicule) n'y apparaît pas.

import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import {
  CubeCamera,
  HalfFloatType,
  PMREMGenerator,
  WebGLCubeRenderTarget,
  type Object3D,
  type Scene,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import type { Vec3 } from '../data/garage.ts';
import { useRenderStats } from './renderStats.ts';

interface Capture {
  target: WebGLRenderTarget;
  ms: number;
}

/** Rend la cubemap et la préfiltre. Le décor est vu sans environnement : pas de reflet d'un ancien état. */
function capture(gl: WebGLRenderer, scene: Scene, size: number, position: Vec3): Capture {
  const start = performance.now();
  const cube = new WebGLCubeRenderTarget(size, { type: HalfFloatType, generateMipmaps: false });
  const camera = new CubeCamera(0.05, 60, cube);
  camera.position.set(...position);

  const hidden: Object3D[] = [];
  scene.traverse((object) => {
    if (object.userData.hideInProbe === true && object.visible) {
      object.visible = false;
      hidden.push(object);
    }
  });
  const environment = scene.environment;
  scene.environment = null;
  // La chaîne d'image coupe l'effacement automatique : sans lui, chaque face garderait
  // l'image de l'ambiance précédente sous la nouvelle.
  const autoClear = gl.autoClear;
  gl.autoClear = true;
  camera.update(gl, scene);
  gl.autoClear = autoClear;
  scene.environment = environment;
  for (const object of hidden) object.visible = true;

  const pmrem = new PMREMGenerator(gl);
  const target = pmrem.fromCubemap(cube.texture);
  pmrem.dispose();
  cube.dispose();
  // Attendre la fin du travail du processeur graphique : la mesure compte le rendu, pas l'envoi.
  gl.getContext().finish();
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
}

export function ReflectionProbe({ size, position, version }: ReflectionProbeProps) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  const [x, y, z] = position;

  useEffect(() => {
    const { target, ms } = capture(gl, scene, size, [x, y, z]);
    const uninstall = install(scene, target);
    useRenderStats.setState((state) => ({
      probe: { size, ms: Math.round(ms), updates: (state.probe?.updates ?? 0) + 1, version },
    }));
    // Les appels de dessin de la sonde ne comptent pas dans ceux de l'image.
    gl.info.reset();
    invalidate();
    return uninstall;
  }, [gl, scene, size, x, y, z, version, invalidate]);

  return null;
}
