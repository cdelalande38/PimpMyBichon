// @ts-check
// Séquence de captures de la sortie de nuit (page src/dev/sortie/), en 390 × 844 : une image par
// plan (abscisse, caméra, météo), une planche, et les relevés de chaque plan (appels de dessin et
// triangles du décor et de l'image, tronçons chargés) dans releves.json. Les plans par défaut
// suivent le parcours de la carte : départ, bord de lac, virage, pont, entrée de ville, poursuite
// et vue rasante, au sec et sous la pluie ; --plans les remplace. Lance le serveur de
// développement sur le port demandé (4901 par défaut, ou réutilise celui qui y tourne), ouvre la
// page dans le Chromium de Playwright (ANGLE sur OpenGL ES ; --logiciel : rendu logiciel), écrit
// dans captures/sorties/<carte>/, puis arrête le serveur. --cadence mesure aussi les images par
// seconde à chaque plan (synchro verticale coupée : le temps réel d'une image sur le poste).
//
//   node tools/captures/sortie.mjs <carte> [--vehicule <id>] [--qualite eco|standard|max] [--port <n>]
//        [--out <dossier>] [--logiciel] [--cadence] [--plans nom=s:camera:meteo,…]
//
// La carte doit être fabriquée : npm run maps:build d'abord.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PAGE = 'src/dev/sortie/index.html';
const GPU_ARGS = ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'];
const SOFT_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const UNCAPPED = ['--disable-gpu-vsync', '--disable-frame-rate-limit'];
const W = 390;
const H = 844;
const USAGE = 'usage : node tools/captures/sortie.mjs <carte> [--vehicule <id>] [--qualite <niveau>] [--port <n>] [--out <dossier>] [--logiciel] [--cadence] [--plans nom=s:camera:meteo,…]';

/**
 * Plans par défaut, d'après les départs et les sections de la route (aucune abscisse propre à une
 * carte dans ce fichier) : départ, milieu des sections hors agglomération (bord de lac), virage le
 * plus serré hors ville, plus long pont, entrée de ville du dernier départ.
 * @param {any} route
 */
function defaultPlans(route) {
  /** @type {Array<{ nom: string, s: number, camera: string, meteo: string }>} */
  const plans = [];
  const first = route.starts[0]?.at ?? 0;
  plans.push({ nom: '1-depart', s: first + 40, camera: 'poursuite', meteo: 'sec' });
  const rural = route.sections.filter((/** @type {any} */ x) => !x.urban && x.ground === 'sol' && x.to - x.from > 1000);
  const lake = rural[0] ? (rural[0].from + rural[0].to) / 2 : route.length * 0.25;
  plans.push({ nom: '2-lac', s: lake, camera: 'orbite@1.75', meteo: 'sec' });
  // Virage : plus forte courbure hors ville, rayon de plus de 40 m (pas un rond-point).
  const n = route.rail.length / 3;
  const at = (/** @type {number} */ i, /** @type {number} */ k) => route.rail[Math.max(0, Math.min(n - 1, i)) * 3 + k];
  let best = { s: route.length * 0.15, k: 0 };
  for (let i = 10; i < n - 10; i += 5) {
    const s = i * route.step;
    const sec = route.sections.find((/** @type {any} */ x) => s >= x.from && s <= x.to);
    if (!sec || sec.urban) continue;
    const h1 = Math.atan2(-(at(i, 2) - at(i - 12, 2)), at(i, 0) - at(i - 12, 0));
    const h2 = Math.atan2(-(at(i + 12, 2) - at(i, 2)), at(i + 12, 0) - at(i, 0));
    let d = h2 - h1;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    const k = Math.abs(d) / (12 * route.step);
    if (k > best.k && k < 1 / 45) best = { s, k };
  }
  plans.push({ nom: '3-virage', s: best.s - 25, camera: 'avant', meteo: 'sec' });
  const bridges = route.sections.filter((/** @type {any} */ x) => x.ground === 'pont').sort((/** @type {any} */ a, /** @type {any} */ b) => b.to - b.from - (a.to - a.from));
  if (bridges[0]) plans.push({ nom: '4-pont', s: (bridges[0].from + bridges[0].to) / 2, camera: 'poursuite', meteo: 'sec' });
  const town = route.starts[route.starts.length - 1]?.at ?? route.length * 0.9;
  plans.push({ nom: '5-ville', s: town + 150, camera: 'poursuite', meteo: 'sec' });
  plans.push({ nom: '6-ville-rasante', s: town + 330, camera: 'rasante', meteo: 'sec' });
  plans.push({ nom: '7-ville-pluie', s: town + 150, camera: 'poursuite', meteo: 'pluie' });
  plans.push({ nom: '8-lac-pluie', s: lake + 300, camera: 'rasante', meteo: 'pluie' });
  return plans;
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const o = { id: '', vehicule: '', qualite: '', port: 4901, out: '', soft: false, cadence: false, plans: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    const valued = /^--(vehicule|qualite|port|out|plans)(?:=(.*))?$/.exec(arg);
    if (valued) {
      const value = valued[2] ?? argv[(i += 1)];
      if (!value) throw new Error(`option --${valued[1]} sans valeur\n${USAGE}`);
      const key = /** @type {'vehicule' | 'qualite' | 'port' | 'out' | 'plans'} */ (valued[1]);
      if (key === 'port') o.port = Number(value);
      else o[key] = value;
    } else if (arg === '--logiciel') o.soft = true;
    else if (arg === '--cadence') o.cadence = true;
    else if (arg.startsWith('--')) throw new Error(`option « ${arg} » inconnue\n${USAGE}`);
    else o.id = arg;
  }
  if (!/^[a-z0-9-]+$/.test(o.id)) throw new Error(USAGE);
  if (!Number.isInteger(o.port) || o.port < 1024 || o.port > 65535) throw new Error(`port invalide\n${USAGE}`);
  o.out ||= join('captures', 'sorties', o.id);
  return o;
}

/** @param {string} url */
async function reachable(url) {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

/** @param {number} ms */
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** @param {number} port */
function startServer(port) {
  const env = { ...process.env };
  delete env.NODE_TLS_REJECT_UNAUTHORIZED;
  const vite = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(vite)) throw new Error('vite introuvable : lance « npm ci » d’abord');
  const child = spawn(process.execPath, [vite, '--port', String(port), '--strictPort'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (c) => (log += c));
  child.stderr.on('data', (c) => (log += c));
  return { child, log: () => log };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const routeFile = join(ROOT, 'public', 'assets', 'maps', o.id, 'route.json');
  if (!existsSync(routeFile)) throw new Error(`public/assets/maps/${o.id}/route.json absent : npm run maps:build -- ${o.id}`);
  const route = JSON.parse(readFileSync(routeFile, 'utf8'));
  const plans = o.plans
    ? o.plans.split(',').map((p) => {
        const [nom = 'plan', reste = ''] = p.split('=');
        const [s = '0', camera = 'poursuite', meteo = 'sec'] = reste.split(':');
        return { nom, s: Number(s), camera, meteo };
      })
    : defaultPlans(route);
  const base = `http://localhost:${o.port}/PimpMyBichon/`;
  const outDir = resolve(ROOT, o.out);
  /** @type {ReturnType<typeof startServer> | null} */
  let server = null;
  /** @type {import('@playwright/test').Browser | null} */
  let browser = null;
  /** @type {string[]} */
  const errors = [];
  const stop = () => {
    server?.child.kill('SIGTERM');
    server = null;
  };
  process.once('SIGINT', () => {
    stop();
    process.exit(130);
  });
  try {
    if (!(await reachable(base))) {
      server = startServer(o.port);
      const deadline = Date.now() + 60_000;
      while (!(await reachable(base))) {
        if (server.child.exitCode !== null) throw new Error(`le serveur de développement s’est arrêté :\n${server.log()}`);
        if (Date.now() > deadline) throw new Error(`le serveur de développement ne répond pas sur le port ${o.port}`);
        await pause(300);
      }
    }
    browser = await chromium.launch({ args: [...(o.soft ? SOFT_ARGS : GPU_ARGS), ...(o.cadence ? UNCAPPED : [])] });
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(e.message));
    const p0 = /** @type {{ nom: string, s: number, camera: string, meteo: string }} */ (plans[0]);
    const q = new URLSearchParams({ carte: o.id, camera: p0.camera, meteo: p0.meteo, propre: '' });
    if (o.vehicule) q.set('vehicule', o.vehicule);
    if (o.qualite) q.set('qualite', o.qualite);
    await page.goto(`${base}${PAGE}?${q}`);
    await page.waitForSelector('body[data-sortie-prete], body[data-sortie-erreur]', { timeout: 120_000 });
    const erreur = await page.getAttribute('body', 'data-sortie-erreur');
    if (erreur) throw new Error(`la page signale une erreur : ${erreur}`);
    mkdirSync(outDir, { recursive: true });
    /** @type {Buffer[]} */
    const shots = [];
    /** @type {any[]} */
    const releves = [];
    for (const p of plans) {
      await page.evaluate((x) => /** @type {any} */ (globalThis).pmbSortie.aller(x), p);
      const file = join(outDir, `${p.nom}.png`);
      shots.push(await page.screenshot({ path: file }));
      const mesure = await page.evaluate(() => /** @type {any} */ (globalThis).pmbSortie.mesurer());
      const cadence = o.cadence ? await page.evaluate(() => /** @type {any} */ (globalThis).pmbSortie.cadence(3000)) : null;
      const stage = await page.evaluate(() => ({ .../** @type {any} */ (globalThis).document.querySelector('.drive-stage')?.dataset }));
      releves.push({ ...p, mesure, cadence, stage });
      const c = cadence ? ` · ${cadence.fps.toFixed(0)} i/s (${cadence.moyenne.toFixed(1)} ms, p95 ${cadence.p95.toFixed(1)} ms)` : '';
      console.log(`${relative(ROOT, file)} — décor ${mesure.decor.triangles} tri, ${mesure.decor.calls} appels · image ${mesure.total.triangles} tri, ${mesure.total.calls} appels · ${mesure.chunks} tronçons${c}`);
    }
    writeFileSync(join(outDir, 'releves.json'), `${JSON.stringify(releves, null, 2)}\n`);
    const cw = Math.round(W / 2);
    const ch = Math.round(H / 2);
    const cols = 4;
    const rows = Math.ceil(shots.length / cols);
    const tiles = await Promise.all(shots.map((s) => sharp(s).resize(cw, ch).png().toBuffer()));
    const planche = join(outDir, 'planche.png');
    await sharp({ create: { width: cw * cols, height: ch * rows, channels: 3, background: '#000000' } })
      .composite(tiles.map((input, i) => ({ input, left: (i % cols) * cw, top: Math.floor(i / cols) * ch })))
      .png()
      .toFile(planche);
    console.log(relative(ROOT, planche));
  } finally {
    if (errors.length > 0) console.warn(`console de la page :\n  ${[...new Set(errors)].slice(0, 12).map((e) => e.slice(0, 400)).join('\n  ')}`);
    await browser?.close();
    stop();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
