#!/usr/bin/env node
// @ts-check
// node tools/courses/faisabilite.mjs — chaque rendez-vous de la carrière est-il faisable ? (vague V)
//
// Pour chaque rendez-vous de public/assets/carriere/carriere.json, et chaque véhicule du catalogue que ses
// contraintes permettent (une moto, une voiture), simule la conduite à la main appliquée
// (src/drive/simulationCourse.ts : plein gaz, freinage au dernier moment, direction assistée, SANS NOS)
// dans les conditions du rendez-vous (météo, nombre de tours), puis la compare au seuil de son objectif
// (src/data/courses.ts : seuils du véhicule, météo comprise). Marge = seuil ÷ temps − 1. Le véhicule est
// celui du catalogue, sans préparation : un véhicule préparé (plus de puissance) ne peut que gagner du temps.
// La nuit ne change rien à la conduite simulée. « Sans toucher le bord » : la conduite à la main frôle les
// bords (elle vise 92 % de l'adhérence) ; c'est donc le pilote automatique qui sert de référence, et il doit
// finir sans un seul contact. Rien n'est écrit ; sortie en erreur si un rendez-vous passe sous la marge.
//
// Options : --saison <id> (une seule saison), --marge <part> (marge minimale, 0,05 par défaut).

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const seule = args.includes('--saison') ? args[args.indexOf('--saison') + 1] : null;
const MARGE_MIN = args.includes('--marge') ? Number(args[args.indexOf('--marge') + 1]) : 0.05;

const server = await createServer({
  root: ROOT,
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});

let echecs = 0;
try {
  const sim = await server.ssrLoadModule('/src/drive/simulationCourse.ts');
  const { VEHICLES } = await server.ssrLoadModule('/src/data/vehicles.ts');
  const { performanceDe } = await server.ssrLoadModule('/src/drive/pilote.ts');
  const { MAPS, validateRoute } = await server.ssrLoadModule('/src/data/maps.ts');
  const { indulgence, seuilsMedailles, tempsReference } = await server.ssrLoadModule('/src/data/courses.ts');
  const { SAISONS, PROBLEMES_CARRIERE } = await server.ssrLoadModule('/src/data/carriere.ts');
  if (PROBLEMES_CARRIERE.length > 0) throw new Error(`carrière refusée : ${PROBLEMES_CARRIERE.join(' | ')}`);

  /** @type {Map<string, any>} */
  const routes = new Map();
  /** @type {Map<string, any>} */
  const pilotes = new Map();
  const routeDe = (/** @type {string} */ id) => {
    if (routes.has(id)) return routes.get(id);
    const map = MAPS.find((/** @type {{ id: string }} */ m) => m.id === id);
    const file = map ? join(ROOT, 'public/assets/maps', map.id, map.route) : '';
    const route = map && existsSync(file) ? validateRoute(JSON.parse(readFileSync(file, 'utf8')), map) : null;
    routes.set(id, route);
    return route;
  };
  const piloteDe = (/** @type {string} */ carte, /** @type {any} */ vehicle) => {
    const cle = `${carte}|${vehicle.id}`;
    if (!pilotes.has(cle)) pilotes.set(cle, sim.piloteDeSimulation(routeDe(carte), performanceDe(vehicle)));
    return pilotes.get(cle);
  };
  const s1 = (/** @type {number} */ t) => (Number.isFinite(t) ? `${t.toFixed(1)} s` : '—');
  const pct = (/** @type {number} */ m) => (Number.isFinite(m) ? `${m >= 0 ? '+' : ''}${(m * 100).toFixed(1)} %` : '—');

  console.log(`Marge minimale : ${(MARGE_MIN * 100).toFixed(0)} % (seuil de l'objectif ÷ temps de la conduite à la main simulée − 1), sur chaque véhicule permis.`);
  console.log('| Saison | n° | Rendez-vous | Carte · départ | Conditions | Contraintes | Objectif | Seuil (véhicule le plus serré) | Temps de référence | Marge | Contacts |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');
  console.log('(temps de référence : conduite à la main simulée ; « auto » : pilote automatique, pour « sans toucher le bord »)');
  SAISONS.forEach((/** @type {any} */ saison, /** @type {number} */ s) => {
    if (seule && saison.id !== seule) return;
    saison.rendezVous.forEach((/** @type {any} */ rdv, /** @type {number} */ i) => {
      const route = routeDe(rdv.carte);
      if (!route) {
        console.log(`| ${s + 1} | ${i + 1} | ${rdv.titre} | ${rdv.carte} | route absente (npm run maps:build) | | | | | | |`);
        echecs += 1;
        return;
      }
      const start = route.starts.find((/** @type {{ id: string }} */ st) => st.id === rdv.depart);
      const tours = rdv.format === 'tours3' ? 3 : 1;
      const permis = VEHICLES.filter((/** @type {any} */ v) => !(rdv.contraintes.includes('moto') && v.kind !== 'bike') && !(rdv.contraintes.includes('voiture') && v.kind !== 'car'));
      /** @type {{ id: string, temps: number, seuil: number, marge: number, contacts: number } | null} */
      let pire = null;
      let contacts = 0;
      const conduite = rdv.contraintes.includes('sans-choc') ? 'auto' : 'main';
      for (const vehicle of permis) {
        const r = sim.simulerCourse(piloteDe(rdv.carte, vehicle), { at: start.at, tours, meteo: rdv.meteo, conduite });
        const ref = tempsReference(rdv.carte, rdv.depart, rdv.format, vehicle.id);
        const seuil = rdv.objectif === 'finir' || !ref ? Infinity : seuilsMedailles(ref, indulgence(rdv.carte, rdv.meteo))[rdv.objectif];
        const marge = seuil / r.temps - 1;
        contacts = Math.max(contacts, r.contacts);
        if (!pire || marge < pire.marge) pire = { id: vehicle.id, temps: r.temps, seuil, marge, contacts: r.contacts };
      }
      const conditions = [rdv.meteo, rdv.moment, rdv.format === 'tours3' ? '3 tours' : '1 tour'].join(', ');
      const ok = pire !== null && pire.marge >= MARGE_MIN && !(rdv.contraintes.includes('sans-choc') && contacts > 0);
      if (!ok) echecs += 1;
      console.log(
        `| ${s + 1} | ${i + 1} | ${rdv.titre} | ${rdv.carte} · ${rdv.depart} | ${conditions} | ${rdv.contraintes.join(', ') || '—'} | ${rdv.objectif} | ${pire ? `${s1(pire.seuil)} (${pire.id})` : '—'} | ${pire ? s1(pire.temps) : '—'}${conduite === 'auto' ? ' (auto)' : ''} | ${pire ? pct(pire.marge) : '—'}${ok ? '' : ' ✗'} | ${contacts} |`,
      );
    });
  });
} finally {
  await server.close();
}
if (echecs > 0) {
  console.log(`${echecs} rendez-vous sous la marge (ou touchant le bord avec « sans toucher le bord »)`);
  process.exit(1);
}
