// @ts-check
// Planche de six vues d'un véhicule généré (page src/dev/vehicule/) : trois quarts avant, profil,
// trois quarts arrière, face, dessus, détail d'une roue. Lance le serveur de développement sur le
// port demandé (4531 par défaut ; ou réutilise celui qui y tourne déjà), ouvre la page dans le
// Chromium de Playwright sur la vraie carte graphique (ANGLE sur OpenGL ES ; --logiciel : rendu
// logiciel SwiftShader, plus lent), écrit une image par vue (1000 × 640) et planche.png (les six
// vues en 3 × 2, 1500 × 640) et thumb.webp (vignette du catalogue, 512 × 320) dans
// captures/vehicules/<id>/, puis arrête le serveur qu'il a lancé.
//
//   node tools/captures/vehicule.mjs <id> [--port <n>] [--out <dossier>] [--logiciel] [--vues av34,profil,…]
//
// Le GLB doit exister : npm run vehicles:build -- <id> d'abord.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PAGE = 'src/dev/vehicule/index.html';
const VIEWS = ['av34', 'profil', 'ar34', 'face', 'dessus', 'roue'];
const GPU_ARGS = ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'];
const SOFT_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const W = 1000;
const H = 640;
const USAGE = 'usage : node tools/captures/vehicule.mjs <id> [--port <n>] [--out <dossier>] [--logiciel] [--vues av34,profil,…]';

/** @param {string[]} argv */
function parseArgs(argv) {
  let id = '';
  let port = 4531;
  let out = '';
  let soft = false;
  let views = VIEWS;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    const valued = /^--(port|out|vues)(?:=(.*))?$/.exec(arg);
    if (valued) {
      const value = valued[2] ?? argv[(i += 1)];
      if (!value) throw new Error(`option --${valued[1]} sans valeur\n${USAGE}`);
      if (valued[1] === 'port') port = Number(value);
      else if (valued[1] === 'out') out = value;
      else views = value.split(',');
    } else if (arg === '--logiciel') soft = true;
    else if (arg.startsWith('--')) throw new Error(`option « ${arg} » inconnue\n${USAGE}`);
    else id = arg;
  }
  if (!/^[a-z0-9_-]+$/.test(id)) throw new Error(USAGE);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`port invalide\n${USAGE}`);
  return { id, port, soft, views, out: out || join('captures', 'vehicules', id) };
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
  const { id, port, soft, views, out } = parseArgs(process.argv.slice(2));
  if (!existsSync(join(ROOT, 'public', 'assets', 'vehicles', id, 'body.glb'))) throw new Error(`public/assets/vehicles/${id}/body.glb absent : npm run vehicles:build -- ${id}`);
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
    await page.goto(`${base}${PAGE}?id=${id}&vue=${views[0]}`);
    await page.waitForSelector('body[data-vehicule-pret], body[data-vehicule-erreur]', { timeout: 90_000 });
    const erreur = await page.getAttribute('body', 'data-vehicule-erreur');
    if (erreur) throw new Error(`la page signale une erreur : ${erreur}`);
    console.log(await page.getAttribute('body', 'data-vehicule-info'));
    mkdirSync(outDir, { recursive: true });
    /** @type {Buffer[]} */
    const shots = [];
    for (const view of views) {
      // Code exécuté dans la page : globalThis y est la fenêtre.
      await page.evaluate((v) => /** @type {any} */ (globalThis).pmbVue(v), view);
      await page.evaluate(() => new Promise((r) => /** @type {any} */ (globalThis).requestAnimationFrame(() => /** @type {any} */ (globalThis).requestAnimationFrame(r))));
      const file = join(outDir, `${view}.png`);
      shots.push(await page.screenshot({ path: file }));
      console.log(relative(ROOT, file));
    }
    // Planche : les vues en 3 colonnes, demi-taille.
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
    // Vignette du catalogue (512 × 320, WebP) tirée du trois quarts avant : à recopier dans
    // public/assets/vehicles/<id>/thumb.webp (assets:check l'exige pour chaque véhicule).
    const av34 = views.indexOf('av34');
    if (av34 >= 0) {
      const thumb = join(outDir, 'thumb.webp');
      await sharp(shots[av34]).extract({ left: Math.round(W * 0.15), top: Math.round(H * 0.17), width: Math.round(W * 0.82), height: Math.round(H * 0.8) }).resize(512, 320).webp({ quality: 82 }).toFile(thumb);
      console.log(`${relative(ROOT, thumb)} (vignette : à recopier dans public/assets/vehicles/${id}/)`);
    }
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
