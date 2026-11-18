// Départs d'une carte, lus dans sa route (route.json) : elle se charge ici une fois par séance et sert
// encore à la scène (src/data/maps.ts, loadRoute). Sans réseau à la première fois : « erreur », et l'on
// part du début.

import { useEffect, useState } from 'react';
import { loadRoute } from '../../../data/maps.ts';
import type { MapManifest, MapStart } from '../../../data/mapTypes.ts';

export interface Departs {
  map: string;
  status: 'chargement' | 'pret' | 'erreur';
  list: readonly MapStart[];
  /** Vrai si le parcours se referme (circuit) : les trois tours s'y courent. */
  loop: boolean;
}

export function useDeparts(map: MapManifest | undefined): Departs | null {
  const [starts, setStarts] = useState<Departs | null>(null);
  useEffect(() => {
    if (!map) return;
    let alive = true;
    loadRoute(map).then(
      (route) => alive && setStarts({ map: map.id, status: 'pret', list: route.starts, loop: route.loop }),
      () => alive && setStarts({ map: map.id, status: 'erreur', list: [], loop: false }),
    );
    return () => {
      alive = false;
    };
  }, [map]);
  if (!map) return null;
  return starts?.map === map.id ? starts : { map: map.id, status: 'chargement', list: [], loop: false };
}
