#!/usr/bin/env node
// @ts-check
// npm run courses:drift — scores de référence du format « Drift » (src/data/drift.ts, médailles).
//
// Pour chaque carte construite (public/assets/maps/<id>/route.json, npm run maps:build) et chaque départ,
// simule au sec un parcours de drift (un tour, ou du départ à l'arrivée) avec chaque véhicule du catalogue :
// la conduite de drift appliquée de src/drive/simulationDrift.ts (direction assistée, un coup de frein à
// l'entrée de chaque virage serré, plein gaz ensuite), comptée par le vrai score (src/jeu/drift.ts).
// Écrit public/assets/maps/<id>/drift.json (versionné) : le score médian du catalogue et celui de chaque
// véhicule ; les paliers des médailles en sont des parts (src/data/drift.ts, MEDAILLES_DRIFT). Rien n'est
// téléchargé.
//
// Options : --carte <id> (une seule carte), --verifier (n'écrit rien, dit si les fichiers sont à jour),
// --meteo (affiche aussi les scores sous la pluie et sur la neige, sans les écrire).
// Les modules de l'app (TypeScript) sont chargés par Vite (aucune dépendance de plus).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const seule = args.includes('--carte') ? args[args.indexOf('--carte') + 1] : null;
const verifier = args.includes('--verifier');
const meteos = args.includes('--meteo');

/** Arrondi à la dizaine. */
const arrondi = (/** @type {number} */ n) => Math.round(n / 10) * 10;
/** @param {number[]} values */
function mediane(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return Number.NaN;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? /** @type {number} */ (v[m]) : (/** @type {number} */ (v[m - 1]) + /** @type {number} */ (v[m])) / 2;
}

const server = await createServer({
  root: ROOT,
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});

let ecarts = 0;
try {
  const { simulerDrift } = await server.ssrLoadModule('/src/drive/simulationDrift.ts');
  const { piloteDeSimulation } = await server.ssrLoadModule('/src/drive/simulationCourse.ts');
  const { VEHICLES } = await server.ssrLoadModule('/src/data/vehicles.ts');
  const { performanceDe } = await server.ssrLoadModule('/src/drive/pilote.ts');
  const { MAPS, validateRoute } = await server.ssrLoadModule('/src/data/maps.ts');

  for (const map of MAPS) {
    if (seule && map.id !== seule) continue;
    const routeFile = join(ROOT, 'public/assets/maps', map.id, map.route);
    if (!existsSync(routeFile)) {
      console.log(`${map.id} : route absente (npm run maps:build), passée`);
      continue;
    }
    const route = validateRoute(JSON.parse(readFileSync(routeFile, 'utf8')), map);
    /** @type {Record<string, Record<string, number>>} */
    const brut = {};
    const lignes = [];
    const debut = Date.now();
    for (const vehicle of VEHICLES) {
      const pilot = piloteDeSimulation(route, performanceDe(vehicle));
      for (const start of route.starts) {
        const sec = simulerDrift(pilot, route, { at: start.at, meteo: 'sec' });
        (brut[start.id] ??= {})[vehicle.id] = Number.isFinite(sec.temps) ? sec.score : Number.NaN;
        let suite = '';
        if (meteos) {
          for (const m of /** @type {const} */ (['pluie', 'neige'])) suite += `  ${m} ${String(simulerDrift(pilot, route, { at: start.at, meteo: m }).score).padStart(6)}`;
        }
        lignes.push(`  ${start.id.padEnd(14)} ${vehicle.id.padEnd(9)} ${String(sec.score).padStart(6)} pts  ${String(sec.nombre).padStart(3)} drifts (${sec.coups} coups de frein, meilleur ${sec.meilleur}, plus long ${sec.plusLong} s, ×${sec.multMax})  ${sec.temps.toFixed(1)} s  bord ${sec.contacts}${suite}`);
      }
    }
    /** @type {Record<string, unknown>} */
    const departs = {};
    for (const start of route.starts) {
      const ici = brut[start.id] ?? {};
      const vehicules = Object.fromEntries(
        Object.keys(ici)
          .filter((id) => Number.isFinite(ici[id]) && /** @type {number} */ (ici[id]) > 0)
          .sort((a, b) => a.localeCompare(b))
          .map((id) => [id, arrondi(/** @type {number} */ (ici[id]))]),
      );
      const score = arrondi(mediane(Object.values(vehicules)));
      if (Number.isFinite(score) && score > 0) departs[start.id] = { score, vehicules };
    }
    const fichier = { format: 'pmb-drift', version: 1, meteo: 'sec', outil: 'npm run courses:drift', departs };
    const out = join(ROOT, 'public/assets/maps', map.id, 'drift.json');
    const texte = `${JSON.stringify(fichier, null, 2)}\n`;
    console.log(`${map.id} (${route.loop ? 'boucle' : 'route ouverte'}, ${(route.length / 1000).toFixed(1)} km, ${VEHICLES.length} véhicules, ${((Date.now() - debut) / 1000).toFixed(0)} s)`);
    for (const ligne of lignes) console.log(ligne);
    if (verifier) {
      const actuel = existsSync(out) ? readFileSync(out, 'utf8') : '';
      if (actuel !== texte) {
        ecarts += 1;
        console.log(`  → ${map.id}/drift.json n'est pas à jour`);
      }
    } else {
      writeFileSync(out, texte);
      console.log(`  → public/assets/maps/${map.id}/drift.json`);
    }
  }
} finally {
  await server.close();
}
if (ecarts > 0) process.exit(1);
