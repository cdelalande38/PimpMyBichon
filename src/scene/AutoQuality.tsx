// Qualité « auto » (§ 8) : le PerformanceMonitor de drei mesure la cadence, mais seulement
// pendant les phases où la scène est rendue en continu (rotation, geste, affinage photo). Le
// rendu est à la demande : un moniteur qui compterait les pauses verrait un téléphone à 1 i/s.

import { PerformanceMonitor } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useState } from 'react';
import { AUTO_MAX_CHANGES, autoQualityBounds } from '../render/autoQuality.ts';
import { applyAutoQuality } from '../render/renderStats.ts';

/** Écart au-delà duquel deux images ne se suivent pas : la scène était à l'arrêt (4 i/s). */
const CONTINUOUS_GAP_S = 0.25;
/** Images à la suite avant de compter : la première après un arrêt mesure la pause. */
const CONTINUOUS_FRAMES = 4;

export function AutoQuality({ enabled }: { enabled: boolean }) {
  const [streak, setStreak] = useState(0);
  const continuous = streak >= CONTINUOUS_FRAMES;

  // Avant tout le reste : la décision de compter ou non vaut pour cette image.
  useFrame((_, delta) => {
    if (!enabled) return;
    if (delta > CONTINUOUS_GAP_S) {
      if (streak !== 0) setStreak(0);
    } else if (streak < CONTINUOUS_FRAMES) {
      setStreak(streak + 1);
    }
  }, -2);

  if (!enabled || !continuous) return null;
  return (
    <PerformanceMonitor
      bounds={autoQualityBounds}
      flipflops={AUTO_MAX_CHANGES}
      onIncline={(api) => applyAutoQuality('incline', api.fps)}
      onDecline={(api) => applyAutoQuality('decline', api.fps)}
      onFallback={(api) => applyAutoQuality('fallback', api.fps)}
    />
  );
}
