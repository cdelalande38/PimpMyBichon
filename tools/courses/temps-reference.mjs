#!/usr/bin/env node
// @ts-check
// npm run courses:temps — temps de référence des courses (src/data/courses.ts, médailles).
//
// Pour chaque carte construite (public/assets/maps/<id>/route.json, npm run maps:build), chaque départ et
// chaque format couru (1 tour ; 3 tours sur une boucle), simule le pilote automatique au sec, depuis
// l'arrêt sur la ligne, avec chaque véhicule du catalogue (src/drive/simulationCourse.ts, pas de 0,1 s),
// puis une conduite à la main appliquée (base de l'or et de l'argent), et les deux sous la pluie et sur la
// neige (le plus grand écart est gardé : indulgence de la météo sur cette carte).
// Écrit public/assets/maps/<id>/courses.json (versionné). Rien n'est téléchargé.
//
// Options : --carte <id> (une seule carte), --verifier (n'écrit rien, dit si les fichiers sont à jour).
// Les modules de l'app (TypeScript) sont chargés par Vite (aucune dépendance de plus).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const seule = args.includes('--carte') ? args[args.indexOf('--carte') + 1] : null;
const verifier = args.includes('--verifier');

const arrondi = (/** @type {number} */ t) => Math.round(t * 10) / 10;
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
  const sim = await server.ssrLoadModule('/src/drive/simulationCourse.ts');
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
    /** @type {Array<[string, number]>} */
    const formats = route.loop ? [['tour1', 1], ['tours3', 3]] : [['tour1', 1]];
    /** @type {Record<string, Record<string, { auto: Record<string, number>, main: Record<string, number> }>>} */
    const brut = {};
    /** @type {{ pluie: number[], neige: number[] }} */
    const meteo = { pluie: [], neige: [] };
    const debut = Date.now();
    for (const vehicle of VEHICLES) {
      const pilot = sim.piloteDeSimulation(route, performanceDe(vehicle));
      for (const start of route.starts) {
        for (const [format, tours] of formats) {
          const parDepart = (brut[start.id] ??= {});
          const ici = (parDepart[format] ??= { auto: {}, main: {} });
          const auto = sim.simulerCourse(pilot, { at: start.at, tours, meteo: 'sec', conduite: 'auto' }).temps;
          ici.auto[vehicle.id] = auto;
          ici.main[vehicle.id] = sim.simulerCourse(pilot, { at: start.at, tours, meteo: 'sec', conduite: 'main' }).temps;
          if (format === 'tour1') {
            const main = ici.main[vehicle.id] ?? Infinity;
            for (const m of /** @type {const} */ (['pluie', 'neige'])) {
              meteo[m].push(sim.simulerCourse(pilot, { at: start.at, tours, meteo: m, conduite: 'auto' }).temps / auto);
              meteo[m].push(sim.simulerCourse(pilot, { at: start.at, tours, meteo: m, conduite: 'main' }).temps / main);
            }
          }
        }
      }
    }
    /** @type {Record<string, Record<string, unknown>>} */
    const departs = {};
    const lignes = [];
    for (const start of route.starts) {
      for (const [format] of formats) {
        const ici = brut[start.id]?.[format];
        if (!ici) continue;
        const vehicules = Object.fromEntries(
          Object.keys(ici.auto)
            .filter((id) => Number.isFinite(ici.auto[id]) && Number.isFinite(ici.main[id]))
            .sort((a, b) => a.localeCompare(b))
            .map((id) => [id, { auto: arrondi(/** @type {number} */ (ici.auto[id])), main: arrondi(/** @type {number} */ (ici.main[id])) }]),
        );
        const auto = arrondi(mediane(Object.values(ici.auto)));
        const main = arrondi(mediane(Object.values(ici.main)));
        (departs[start.id] ??= {})[format] = { auto, main, vehicules };
        const pire = Math.max(...Object.keys(ici.main).map((id) => (ici.main[id] ?? Infinity) / (ici.auto[id] ?? 1)));
        lignes.push(`  ${start.id.padEnd(14)} ${format.padEnd(6)} auto ${auto.toFixed(1).padStart(7)} s  main ${main.toFixed(1).padStart(7)} s  (main/auto ≤ ${pire.toFixed(2)})`);
      }
    }
    // Le plus grand écart des deux conduites, arrondi au vingtième au-dessus.
    const ecart = (/** @type {number[]} */ r) => Math.ceil(Math.max(1, ...r.filter(Number.isFinite)) * 20) / 20;
    const ecartsMeteo = { pluie: ecart(meteo.pluie), neige: ecart(meteo.neige) };
    const fichier = { format: 'pmb-courses', version: 1, meteo: 'sec', outil: 'npm run courses:temps', ecartsMeteo, departs };
    const out = join(ROOT, 'public/assets/maps', map.id, 'courses.json');
    const texte = `${JSON.stringify(fichier, null, 2)}\n`;
    console.log(`${map.id} (${route.loop ? 'boucle' : 'route ouverte'}, ${(route.length / 1000).toFixed(1)} km, ${VEHICLES.length} véhicules, ${((Date.now() - debut) / 1000).toFixed(0)} s) ; météo : pluie ×${ecartsMeteo.pluie}, neige ×${ecartsMeteo.neige}`);
    for (const ligne of lignes) console.log(ligne);
    if (verifier) {
      const actuel = existsSync(out) ? readFileSync(out, 'utf8') : '';
      if (actuel !== texte) {
        ecarts += 1;
        console.log(`  → ${map.id}/courses.json n'est pas à jour`);
      }
    } else {
      writeFileSync(out, texte);
      console.log(`  → public/assets/maps/${map.id}/courses.json`);
    }
  }
} finally {
  await server.close();
}
if (ecarts > 0) process.exit(1);
