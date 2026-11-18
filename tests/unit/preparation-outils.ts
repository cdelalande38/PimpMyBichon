// Outils des mesures de la préparation (vague U) : un temps de course simulé hors de la scène, pour un
// véhicule du catalogue, un build (pneus, largeur, assiette, moteur), une carte, un départ et une météo.
// Conduite à la main appliquée de src/drive/simulationCourse.ts (celle des temps de référence).

import { existsSync, readFileSync } from 'node:fs';
import type { MapRoute } from '../../src/data/mapTypes.ts';
import { MAPS, validateRoute } from '../../src/data/maps.ts';
import type { Build, VehicleManifest } from '../../src/data/vehicleTypes.ts';
import { vehicleById } from '../../src/data/vehicles.ts';
import { WHEEL_SLOTS, WHEEL_TUNE } from '../../src/data/wheels.ts';
import type { Weather } from '../../src/drive/contrat.ts';
import { performanceDe } from '../../src/drive/pilote.ts';
import { piloteDeSimulation, simulerCourse, type Conduite } from '../../src/drive/simulationCourse.ts';

const routes = new Map<string, MapRoute | null>();

/** La route fabriquée d'une carte (npm run maps:build), ou null si elle manque. */
export function routeDe(mapId: string): MapRoute | null {
  if (!routes.has(mapId)) {
    const map = MAPS.find((item) => item.id === mapId);
    const file = map ? `public/assets/maps/${map.id}/${map.route}` : '';
    routes.set(mapId, map && existsSync(file) ? validateRoute(JSON.parse(readFileSync(file, 'utf8')), map) : null);
  }
  return routes.get(mapId) ?? null;
}

export function vehicule(id: string): VehicleManifest {
  const vehicle = vehicleById(id);
  if (!vehicle) throw new Error(`véhicule ${id} absent du catalogue`);
  return vehicle;
}

/** Un build : un pneu (absent : d'origine), une assiette (−1 à 1), une largeur (mm), un poste moteur. */
export function buildDe(options: { pneu?: string; assiette?: number; largeur?: number; moteur?: Record<string, string> } = {}): Build {
  const parts: Record<string, string> = { ...(options.moteur ?? {}) };
  if (options.pneu) parts[WHEEL_SLOTS.tire] = options.pneu;
  const tune: Record<string, number> = {};
  if (options.assiette !== undefined && options.assiette !== 0) tune[WHEEL_TUNE.ride] = options.assiette;
  if (options.largeur !== undefined) tune[WHEEL_TUNE.width] = options.largeur;
  return { paints: {}, parts, tune };
}

/** Temps d'une course d'un tour (s), départ `startId` de la carte, à la main appliquée par défaut. */
export function tempsCourse(vehicleId: string, build: Build | undefined, mapId: string, startId: string, meteo: Weather, conduite: Conduite = 'main'): number {
  const route = routeDe(mapId);
  if (!route) return Number.NaN;
  const start = route.starts.find((item) => item.id === startId);
  if (!start) throw new Error(`départ ${startId} absent de ${mapId}`);
  const pilot = piloteDeSimulation(route, performanceDe(vehicule(vehicleId), build));
  return simulerCourse(pilot, { at: start.at, tours: 1, meteo, conduite }).temps;
}
