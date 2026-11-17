// @ts-check
// Captures des virages (page src/dev/virages/ : la scène de la sortie et la mini-carte), en rendu logiciel.
// Un plan = « nom=carte:s:camera:vue » (vue : 390x844 ou 844x390). Lance le serveur de développement
// sur le port demandé, écrit un PNG par plan dans le dossier --out, et relève data-virage de la mini-carte.
//
//   node tools/captures/virages.mjs --port 4951 --out <dossier> --plans nom=carte:s:camera:vue,…

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOFT_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

const args = process.argv.slice(2);
const opt = (/** @type {string} */ name, /** @type {string} */ def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? def) : def;
};
const port = Number(opt('port', '4951'));
const out = opt('out', 'captures');
const plans = opt('plans', '')
  .split(',')
  .filter(Boolean)
  .map((p) => {
    const [nom = 'plan', reste = ''] = p.split('=');
    const [carte = '', s = '0', camera = 'poursuite', vue = '390x844'] = reste.split(':');
    const [w = '390', h = '844'] = vue.split('x');
    return { nom, carte, s: Number(s), camera, w: Number(w), h: Number(h) };
  });
if (plans.length === 0) throw new Error('aucun plan');

const base = `http://localhost:${port}/PimpMyBichon/`;
const reachable = async () => {
  try {
    return (await fetch(base)).ok;
  } catch {
    return false;
  }
};
const pause = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

const env = { ...process.env };
delete env.NODE_TLS_REJECT_UNAUTHORIZED;
const vite = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const server = spawn(process.execPath, [vite, '--port', String(port), '--strictPort'], { cwd: ROOT, env, stdio: 'ignore' });
let browser = null;
try {
  const deadline = Date.now() + 60_000;
  while (!(await reachable())) {
    if (Date.now() > deadline) throw new Error('serveur muet');
    await pause(300);
  }
  mkdirSync(out, { recursive: true });
  browser = await chromium.launch({ args: SOFT_ARGS });
  let page = null;
  let courante = '';
  for (const p of plans) {
    const cle = `${p.carte}@${p.w}x${p.h}`;
    if (cle !== courante) {
      await page?.close();
      page = await browser.newPage({ viewport: { width: p.w, height: p.h }, deviceScaleFactor: 1 });
      const q = new URLSearchParams({ carte: p.carte, camera: p.camera, propre: '' });
      await page.goto(`${base}src/dev/virages/index.html?${q}`);
      await page.waitForSelector('body[data-sortie-prete], body[data-sortie-erreur]', { timeout: 180_000 });
      courante = cle;
    }
    if (!page) throw new Error('page absente');
    await page.evaluate((x) => /** @type {any} */ (globalThis).pmbSortie.aller(x), { s: p.s, camera: p.camera, meteo: 'sec' });
    await pause(1500);
    const info = await page.evaluate(() => {
      const el = /** @type {any} */ (globalThis).document.querySelector('.minicarte');
      return el ? { ...el.dataset } : null;
    });
    await page.screenshot({ path: join(out, `${p.nom}.png`) });
    console.log(p.nom, JSON.stringify(info));
  }
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
