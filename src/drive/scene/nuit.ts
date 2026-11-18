// Étalonnage de la chaîne d'image (src/render/PostChain.tsx) et part du reflet sur la carrosserie,
// par moment et par météo : lus dans src/data/moments.ts. Les lumières du ciel (lune ou soleil,
// ambiance) sont posées par le moteur de la scène (moteur.ts, applyMoment).

import { AMBIANCES, type Ambiance } from '../../data/ambiances.ts';
import { lookOf, type Moment } from '../../data/moments.ts';
import type { Weather } from '../contrat.ts';

function ambianceOf(moment: Moment, weather: Weather): Ambiance {
  const { image } = lookOf(moment, weather);
  return { ...(AMBIANCES[0] as Ambiance), exposure: image.exposition, bloom: image.bloom, grade: image.etalonnage };
}

/**
 * Ambiance de la chaîne d'image pour la sortie : seuls l'étalonnage, l'exposition et le bloom y
 * servent (le reste décrit le garage). Nuit bleue, hautes lumières chaudes (sodium, phares) ; jour
 * neutre, bloom réduit aux reflets du soleil.
 */
export const NIGHT_AMBIANCE: Ambiance = ambianceOf('nuit', 'sec');

const AMBIANCES_SORTIE = new Map<string, Ambiance>();

/** L'ambiance d'un moment et d'une météo (un objet stable par couple : la chaîne d'image ne se refait pas). */
export function sortieAmbiance(moment: Moment, weather: Weather): Ambiance {
  if (moment === 'nuit') return NIGHT_AMBIANCE;
  const key = `${moment}:${weather}`;
  let found = AMBIANCES_SORTIE.get(key);
  if (!found) {
    found = ambianceOf(moment, weather);
    AMBIANCES_SORTIE.set(key, found);
  }
  return found;
}

/** Reflet de l'environnement sur la carrosserie (la sonde voit le ciel, la lune ou le soleil, les lampadaires). */
export function bodyEnvOf(moment: Moment, weather: Weather): number {
  return lookOf(moment, weather).carrosserie;
}
