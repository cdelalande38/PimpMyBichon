// @ts-check
// Vues d'une carte fabriquée (page src/dev/carte/) : les points de vue déclarés dans
// assets-src/maps/<id>/carte.json (« captures » : nom, vue, abscisse, regard), par défaut à hauteur
// de conducteur le long du parcours et une vue d'oiseau. Lance le serveur de développement sur le
// port demandé (4871 par défaut ; ou réutilise celui qui y tourne déjà), ouvre la page dans le
// Chromium de Playwright (ANGLE sur OpenGL ES ; --logiciel : rendu logiciel SwiftShader), écrit une
// image par vue (390 × 844 par défaut, --taille pour une autre) et planche.png dans captures/cartes/<id>/, puis arrête le serveur.
//
//   node tools/captures/carte.mjs <id> [--port <n>] [--out <dossier>] [--logiciel] [--taille <L>x<H>] [--fenetre <a>,<b>]
//        [--vues nom=vue:s:regard[:hauteur],…]
//
// La carte doit être fabriquée : npm run maps:build d'abord.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PAGE = 'src/dev/carte/index.html';
const GPU_ARGS = ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'];
const SOFT_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const USAGE =
  'usage : node tools/captures/carte.mjs <id> [--port <n>] [--out <dossier>] [--logiciel] [--taille <L>x<H>] [--fenetre <a>,<b>] [--vues nom=vue:s:regard,…]';

/** @param {string[]} argv */
function parseArgs(argv) {
  let id = '';
  let port = 4871;
  let out = '';
  let soft = false;
  let vues = '';
  // Gabarit de référence du cahier des charges : téléphone en portrait.
  let taille = [390, 844];
  let fenetre = '';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    const valued = /^--(port|out|vues|taille|fenetre)(?:=(.*))?$/.exec(arg);
    if (valued) {
      const value = valued[2] ?? argv[(i += 1)];
      if (!value) throw new Error(`option --${valued[1]} sans valeur\n${USAGE}`);
      if (valued[1] === 'port') port = Number(value);
      else if (valued[1] === 'vues') vues = value;
      else if (valued[1] === 'taille') taille = value.split('x').map(Number);
      else if (valued[1] === 'fenetre') fenetre = value;
      else out = value;
    } else if (arg === '--logiciel') soft = true;
    else if (arg.startsWith('--')) throw new Error(`option « ${arg} » inconnue\n${USAGE}`);
    else id = arg;
  }
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(USAGE);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`port invalide\n${USAGE}`);
  const [W = 390, H = 844] = taille;
  if (!(W >= 100 && H >= 100)) throw new Error(`taille invalide\n${USAGE}`);
  return { id, port, soft, vues, W, H, fenetre, out: out || join('captures', 'cartes', id) };
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
  const { id, port, soft, out, vues: vuesCli, W, H, fenetre } = parseArgs(process.argv.slice(2));
  if (!existsSync(join(ROOT, 'public', 'assets', 'maps', id, 'route.json'))) throw new Error(`public/assets/maps/${id}/route.json absent : npm run maps:build -- ${id}`);
  const carte = JSON.parse(readFileSync(join(ROOT, 'assets-src', 'maps', id, 'carte.json'), 'utf8'));
  /** @type {Array<{ nom: string, vue: string, s: number, regard?: number, hauteur?: number }>} */
  const vues = vuesCli
    ? vuesCli.split(',').map((v) => {
        const [nom = 'vue', reste = ''] = v.split('=');
        const [vue = 'conducteur', s = '0', regard = '0', hauteur = '0'] = reste.split(':');
        return { nom, vue, s: Number(s), regard: Number(regard), ...(Number(hauteur) > 0 ? { hauteur: Number(hauteur) } : {}) };
      })
    : carte.captures ?? [
    { nom: 'depart', vue: 'conducteur', s: 200 },
    { nom: 'oiseau', vue: 'oiseau', s: 500 },
  ];
  const base = `http://localhost:${port}/PimpMyBichon/`;
  const outDir = resolve(ROOT, out);
  /** @type {ReturnType<typeof startServer> | null} */
  let server = null;
  /** @type {import('@playwright/test').Browser | null} */
  let browser = null;
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
      server = startServer(port);
      const deadline = Date.now() + 60_000;
      while (!(await reachable(base))) {
        if (server.child.exitCode !== null) throw new Error(`le serveur de développement s’est arrêté :\n${server.log()}`);
        if (Date.now() > deadline) throw new Error(`le serveur de développement ne répond pas sur le port ${port}`);
        await pause(300);
      }
    }
    browser = await chromium.launch({ args: soft ? SOFT_ARGS : GPU_ARGS });
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    /** @type {string[]} */
    const errors = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    const v0 = /** @type {{ nom: string, vue: string, s: number, regard?: number }} */ (vues[0]);
    // La fenêtre de chargement de la sortie s'applique à chaque vue (paramètre de la page).
    await page.goto(`${base}${PAGE}?id=${id}&vue=${v0.vue}&s=${v0.s}&regard=${v0.regard ?? 0}${fenetre ? `&fenetre=${fenetre}` : ''}`);
    await page.waitForSelector('body[data-carte-pret], body[data-carte-erreur]', { timeout: 120_000 });
    const erreur = await page.getAttribute('body', 'data-carte-erreur');
    if (erreur) throw new Error(`la page signale une erreur : ${erreur}`);
    mkdirSync(outDir, { recursive: true });
    /** @type {Buffer[]} */
    const shots = [];
    for (const v of vues) {
      // Code exécuté dans la page : globalThis y est la fenêtre.
      await page.evaluate((x) => /** @type {any} */ (globalThis).pmbVue(x), v);
      await page.evaluate(() => new Promise((r) => /** @type {any} */ (globalThis).requestAnimationFrame(() => /** @type {any} */ (globalThis).requestAnimationFrame(r))));
      const file = join(outDir, `${v.nom}.png`);
      shots.push(await page.screenshot({ path: file }));
      console.log(`${relative(ROOT, file)} — ${await page.getAttribute('body', 'data-carte-info')}`);
    }
    const cw = W / 2;
    const ch = H / 2;
    const cols = 3;
    const rows = Math.ceil(shots.length / cols);
    const tiles = await Promise.all(shots.map((s) => sharp(s).resize(cw, ch).png().toBuffer()));
    const planche = join(outDir, 'planche.png');
    await sharp({ create: { width: cw * cols, height: ch * rows, channels: 3, background: '#000000' } })
      .composite(tiles.map((input, i) => ({ input, left: (i % cols) * cw, top: Math.floor(i / cols) * ch })))
      .png()
      .toFile(planche);
    console.log(relative(ROOT, planche));
    if (errors.length > 0) console.warn(`console de la page :\n  ${errors.join('\n  ')}`);
  } finally {
    await browser?.close();
    stop();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
