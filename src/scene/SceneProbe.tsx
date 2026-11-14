// Relevés pour « Sous le capot » : processeur graphique, pixel ratio, cadence, coût d'une image.
// Ne rend rien à l'écran.

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import type { WebGLRenderer } from 'three';
import { useRenderStats } from '../render/renderStats.ts';

/**
 * Au-delà de cet écart entre deux images, la scène était à l'arrêt : on ne compte pas.
 * Assez large pour mesurer aussi un téléphone à la peine (jusqu'à 2 images par seconde).
 */
const IDLE_GAP_S = 0.5;
const PUBLISH_EVERY_S = 1;

function readRendererName(context: WebGLRenderingContext | WebGL2RenderingContext): string | null {
  try {
    const extension = context.getExtension('WEBGL_debug_renderer_info');
    const raw: unknown = extension
      ? context.getParameter(extension.UNMASKED_RENDERER_WEBGL)
      : context.getParameter(context.RENDERER);
    return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
  } catch {
    return null;
  }
}

/** Le compteur du moteur cesse de se remettre à zéro à chaque passe ; rend la remise d'origine. */
function countWholeFrames(renderer: WebGLRenderer): () => void {
  renderer.info.autoReset = false;
  return () => {
    renderer.info.autoReset = true;
  };
}

export function SceneProbe() {
  const gl = useThree((state) => state.gl);
  const dpr = useThree((state) => state.viewport.dpr);

  useEffect(() => {
    const context = gl.getContext();
    useRenderStats.setState({
      gpu: {
        webgl2:
          typeof WebGL2RenderingContext !== 'undefined' && context instanceof WebGL2RenderingContext,
        renderer: readRendererName(context),
        maxTextureSize: gl.capabilities.maxTextureSize,
      },
    });
  }, [gl]);

  useEffect(() => {
    useRenderStats.setState({ dpr });
  }, [dpr]);

  // Coût d'une image, toutes passes comprises (reflet du sol, scène, chaîne d'image) : le
  // compteur n'est plus remis à zéro par chaque passe, mais au début de chaque image, et lu à sa
  // fin, après la chaîne d'image (priorité 1). Ce qui se rend hors image (sonde) n'y entre pas.
  useEffect(() => countWholeFrames(gl), [gl]);
  useFrame((state) => state.gl.info.reset(), -1);
  useFrame((state) => {
    const { calls, triangles } = state.gl.info.render;
    if (calls === 0) return;
    const previous = useRenderStats.getState().frame;
    if (previous?.calls !== calls || previous.triangles !== triangles) useRenderStats.setState({ frame: { calls, triangles } });
  }, 2);

  // Le rendu est à la demande : on ne mesure que pendant que la scène bouge, et on garde
  // la dernière valeur (le panneau « Sous le capot » met lui-même la scène à l'arrêt).
  const meter = useRef({ frames: 0, time: 0 });

  useFrame((_, delta) => {
    const m = meter.current;
    if (delta > IDLE_GAP_S) {
      // Première image après un arrêt : l'écart mesure la pause, pas la cadence.
      m.frames = 0;
      m.time = 0;
      return;
    }
    m.frames += 1;
    m.time += delta;
    if (m.time >= PUBLISH_EVERY_S) {
      useRenderStats.setState({ fps: Math.round(m.frames / m.time) });
      m.frames = 0;
      m.time = 0;
    }
  });

  return null;
}
