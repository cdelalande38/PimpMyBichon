// Relevés pour « Sous le capot » : processeur graphique, pixel ratio, cadence.
// Ne rend rien à l'écran.

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
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
