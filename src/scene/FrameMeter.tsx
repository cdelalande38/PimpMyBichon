// Mesure de cadence de « Sous le capot » : la scène tourne cinq secondes (src/scene/GarageCanvas
// fait tourner la caméra), chaque image donne sa durée, ses appels de dessin et ses triangles.

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { METER_DURATION_MS, summarizeFrames, type FrameSample } from '../render/frameMeter.ts';
import type { QualityLevel } from '../render/quality.ts';
import { useRenderStats } from '../render/renderStats.ts';

export function FrameMeter({ level }: { level: QualityLevel }) {
  const run = useRef<{ start: number; last: number; samples: FrameSample[] } | null>(null);

  // Après la chaîne d'image (priorité 1) : le compteur du moteur couvre toute l'image.
  useFrame((state) => {
    if (!useRenderStats.getState().meter.running) {
      run.current = null;
      return;
    }
    const now = performance.now();
    const current = run.current;
    if (!current) {
      // Première image : elle mesure la pause d'avant, on ne la compte pas.
      run.current = { start: now, last: now, samples: [] };
      state.invalidate();
      return;
    }
    const { calls, triangles } = state.gl.info.render;
    current.samples.push({ ms: now - current.last, calls, triangles });
    current.last = now;
    if (now - current.start < METER_DURATION_MS) {
      state.invalidate();
      return;
    }
    const summary = summarizeFrames(current.samples);
    run.current = null;
    useRenderStats.setState({ meter: { running: false, result: summary ? { ...summary, level } : null } });
  }, 2);

  return null;
}
