// Le garage du § 4, construit d'après src/data/garage.ts, sous l'ambiance choisie.
// Remplace placeholder_garage ; le mobilier reste en volumes simples (placeholder_*).

import { useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import type { Ambiance } from '../../data/ambiances.ts';
import { GARAGE } from '../../data/garage.ts';
import { createGarage } from './build.ts';

export function Garage({ ambiance }: { ambiance: Ambiance }) {
  const invalidate = useThree((state) => state.invalidate);
  const garage = useMemo(() => createGarage(GARAGE), []);
  useEffect(() => () => garage.dispose(), [garage]);
  // Avant les effets ordinaires : la sonde de réflexion se refait sur les nouvelles couleurs.
  useLayoutEffect(() => {
    garage.update(ambiance);
    invalidate();
  }, [garage, ambiance, invalidate]);
  return <primitive object={garage.root} />;
}
