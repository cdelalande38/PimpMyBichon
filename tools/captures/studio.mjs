// @ts-check
// Capture d'une planche du studio des formes (src/dev/studio/) : lance le serveur de
// développement sur le port 5191 (ou réutilise celui qui y tourne déjà), ouvre la page dans le
// Chromium de Playwright en rendu logiciel, attend qu'elle soit prête, écrit
// captures/deco/<planche>-<éclairage>.png (1600 × 1000), puis arrête le serveur qu'elle a lancé.
//
//   node tools/captures/studio.mjs <planche> [studio|garage] [--azimut=<degrés>] [--damier] [--cadre=<i>-<j>]
//
// --cadre cadre les pièces de rang i à j de la planche (à partir de 0), pour les voir de près.
// Avec une option, le nom du fichier la dit : formes-studio-a120-c0-6-damier.png.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 5191;
const BASE = `http://localhost:${PORT}/PimpMyBichon/`;
const PAGE = 'src/dev/studio/index.html';
/** Mêmes arguments que playwright.config.ts : WebGL en rendu logiciel. */
const CHROMIUM_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

const USAGE = 'usage : node tools/captures/studio.mjs <planche> [studio|garage] [--azimut=<degrés>] [--damier] [--cadre=<i>-<j>]';

/** @param {string[]} argv */
function parseArgs(argv) {
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  const flags = argv.filter((arg) => arg.startsWith('--'));
  const [planche, eclairage = 'studio'] = positional;
  if (!planche || !/^[a-z0-9-]+$/.test(planche)) throw new Error(USAGE);
  if (eclairage !== 'studio' && eclairage !== 'garage') throw new Error(`éclairage « ${eclairage} » inconnu (studio ou garage)\n${USAGE}`);
  /** @type {number | null} */
  let azimut = null;
  let damier = false;
  /** @type {string | null} */
  let cadre = null;
  for (const flag of flags) {
    if (flag === '--damier') damier = true;
    else if (/^--cadre=\d+-\d+$/.test(flag)) cadre = flag.slice(8);
    else if (flag.startsWith('--azimut=') && Number.isFinite(Number(flag.slice(9)))) azimut = Number(flag.slice(9));
    else throw new Error(`option « ${flag} » inconnue\n${USAGE}`);
  }
  return { planche, eclairage, azimut, damier, cadre };
}

/** @param {string} url */
async function reachable(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

/** @param {number} ms */
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Lance `vite` sur le port du studio, sans la variable qui coupe la vérification TLS. */
function startServer() {
  const env = { ...process.env };
  delete env.NODE_TLS_REJECT_UNAUTHORIZED;
  const vite = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(vite)) throw new Error('vite introuvable : lance « npm ci » d’abord');
  const child = spawn(process.execPath, [vite, '--port', String(PORT), '--strictPort'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (chunk) => (log += chunk));
  child.stderr.on('data', (chunk) => (log += chunk));
  return { child, log: () => log };
}

async function main() {
  const { planche, eclairage, azimut, damier, cadre } = parseArgs(process.argv.slice(2));
  const query = new URLSearchParams({ planche, eclairage });
  if (azimut !== null) query.set('azimut', String(azimut));
  if (damier) query.set('damier', '');
  if (cadre !== null) query.set('cadre', cadre);
  const url = `${BASE}${PAGE}?${query}`;
  const suffix = `${azimut !== null ? `-a${azimut}` : ''}${cadre !== null ? `-c${cadre}` : ''}${damier ? '-damier' : ''}`;
  const out = join(ROOT, 'captures', 'deco', `${planche}-${eclairage}${suffix}.png`);

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
    if (!(await reachable(BASE))) {
      server = startServer();
      const deadline = Date.now() + 60_000;
      while (!(await reachable(BASE))) {
        if (server.child.exitCode !== null) throw new Error(`le serveur de développement s’est arrêté :\n${server.log()}`);
        if (Date.now() > deadline) throw new Error(`le serveur de développement ne répond pas sur le port ${PORT}`);
        await pause(300);
      }
    }
    browser = await chromium.launch({ args: CHROMIUM_ARGS });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    /** @type {string[]} */
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    await page.goto(url);
    await page.waitForSelector('body[data-studio-pret], body[data-studio-erreur]', { timeout: 180_000 });
    const erreur = await page.getAttribute('body', 'data-studio-erreur');
    if (erreur) throw new Error(`la page signale une erreur : ${erreur}`);
    mkdirSync(dirname(out), { recursive: true });
    await page.screenshot({ path: out });
    if (consoleErrors.length > 0) console.warn(`console de la page :\n  ${consoleErrors.join('\n  ')}`);
    console.log(relative(ROOT, out));
  } finally {
    await browser?.close();
    stop();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
