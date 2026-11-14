// Le garage du § 4, construit d'après src/data/garage.ts, sous l'ambiance choisie.
// Remplace placeholder_garage ; le mobilier reste en volumes simples (placeholder_*).
// Il porte aussi la réflexion planaire de son sol et son atmosphère, selon le niveau de qualité.

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import type { Ambiance } from '../../data/ambiances.ts';
import { GARAGE } from '../../data/garage.ts';
import { PlanarReflection } from '../../render/planarReflection.ts';
import type { QualityProfile } from '../../render/quality.ts';
import { useRenderStats } from '../../render/renderStats.ts';
import { createGarage } from './build.ts';

export function Garage({ ambiance, profile }: { ambiance: Ambiance; profile: QualityProfile }) {
  const invalidate = useThree((state) => state.invalidate);
  const garage = useMemo(() => createGarage(GARAGE), []);
  useEffect(() => () => garage.dispose(), [garage]);
  // Avant les effets ordinaires : la sonde de réflexion se refait sur les nouvelles couleurs.
  useLayoutEffect(() => {
    garage.update(ambiance);
    invalidate();
  }, [garage, ambiance, invalidate]);

  // Réflexion planaire : cible à la fraction d'image du niveau (aucune en économie).
  const scale = profile.reflection;
  const reflection = useMemo(() => (scale > 0 ? new PlanarReflection(scale, garage.surfaces) : null), [scale, garage]);
  useLayoutEffect(() => {
    garage.setQuality({ reflection: reflection !== null, atmosphere: profile.atmosphere });
    invalidate();
    return () => reflection?.dispose();
  }, [garage, reflection, profile.atmosphere, invalidate]);

  // Avant la chaîne d'image (priorité 1) : le reflet est prêt quand la scène est dessinée.
  useFrame(({ gl, scene, camera }) => {
    if (!reflection) return;
    reflection.update(gl, scene, camera, garage.floor);
    const { width, height } = reflection.measured;
    const current = useRenderStats.getState().reflection;
    if (current?.width !== width || current.height !== height) useRenderStats.setState({ reflection: { width, height } });
  });
  useEffect(() => {
    if (!reflection) useRenderStats.setState({ reflection: null });
  }, [reflection]);

  return <primitive object={garage.root} />;
}
