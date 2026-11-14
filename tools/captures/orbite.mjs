// @ts-check
// Tour du véhicule en captures : planches de contrôle de la coupe caméra (src/scene/garage/cut.ts).
// Quatre tours de douze vues en portrait 390 × 844 : distance de départ, recul maximal, recul en
// plongée, caméra basse au plus près. Chaque vue note aussi le nombre d'éléments du décor retirés
// (attribut data-coupe de la scène) dans un relevé JSON à côté des planches.
//
// Usage (après `npm run build`) :
//   node tools/captures/orbite.mjs [--out <dossier>] [--prefix <nom>] [--port <port>]
// Défauts : captures/jalon-1/orbite, préfixe « apres », port 4179 (vite preview sur dist/).
// Chromium de Playwright en rendu logiciel : compter une vingtaine de minutes.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: 'captures/jalon-1/orbite' },
    prefix: { type: 'string', default: 'apres' },
    port: { type: 'string', default: '4179' },
  },
});
const ROOT = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(ROOT, values.out);
const PREFIX = values.prefix;
const BASE = `http://localhost:${values.port}/PimpMyBichon/`;
const WIDTH = 390;
const HEIGHT = 844;
/** Bande de la scène, sous le titre et au-dessus du dock. */
const CLIP = { x: 0, y: 120, width: WIDTH, height: 520 };
/** Point de départ des glissés, au milieu de la scène. */
const GRAB = { x: WIDTH / 2, y: 380 };
/** OrbitControls : un glissé de toute la hauteur de l'écran fait un tour complet. */
const FULL_TURN = HEIGHT;

mkdirSync(OUT, { recursive: true });
const env = { ...process.env };
delete env.NODE_TLS_REJECT_UNAUTHORIZED;
const server = spawn('npx', ['vite', 'preview', '--port', values.port, '--strictPort'], { cwd: ROOT, stdio: 'ignore', env });
const stop = () => server.kill('SIGTERM');
process.on('exit', stop);

async function waitServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(BASE)).ok) return;
    } catch {
      // Serveur pas encore prêt.
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`Serveur de prévisualisation muet sur ${BASE} (dist/ construit ?)`);
}

await waitServer();
const browser = await chromium.launch({
  // Mêmes arguments que playwright.config.ts : WebGL en rendu logiciel.
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
const page = await context.newPage();
await page.goto(BASE);
await page.locator('.stage[data-bench="pret"]').waitFor({ state: 'attached', timeout: 240_000 });

/** Attend que deux captures successives soient identiques (rendu à la demande arrêté). */
async function still() {
  let previous = await page.screenshot({ clip: CLIP });
  for (let i = 0; i < 40; i += 1) {
    await page.waitForTimeout(600);
    const next = await page.screenshot({ clip: CLIP });
    if (Buffer.compare(previous, next) === 0) return;
    previous = next;
  }
}

/**
 * Glissé depuis le milieu de la scène.
 * @param {number} dx
 * @param {number} dy
 */
async function drag(dx, dy) {
  await page.mouse.move(GRAB.x, GRAB.y);
  await page.mouse.down();
  const steps = 6;
  for (let i = 1; i <= steps; i += 1) await page.mouse.move(GRAB.x + (dx * i) / steps, GRAB.y + (dy * i) / steps);
  await page.mouse.up();
}

/**
 * Molette : `times` crans de `delta` (positif : recul).
 * @param {number} delta
 * @param {number} times
 */
async function zoom(delta, times) {
  await page.mouse.move(GRAB.x, GRAB.y);
  for (let i = 0; i < times; i += 1) {
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(120);
  }
}

/** @typedef {{ shot: Buffer; cut: number | null }} View */

/**
 * Un tour complet en `count` vues : captures et nombre d'éléments retirés à chaque vue.
 * @param {number} count
 * @returns {Promise<View[]>}
 */
async function ring(count) {
  /** @type {View[]} */
  const views = [];
  for (let i = 0; i < count; i += 1) {
    await still();
    const shot = await page.screenshot({ clip: CLIP });
    const cut = await page.locator('.stage').getAttribute('data-coupe');
    views.push({ shot, cut: cut === null ? null : Number(cut) });
    await drag(-FULL_TURN / count, 0);
  }
  return views;
}

/** @type {Record<string, Array<number | null>>} */
const report = {};

/**
 * Planche de vignettes, `columns` par rangée, et relevé des éléments retirés.
 * @param {View[]} views
 * @param {string} name
 * @param {number} columns
 */
async function sheet(views, name, columns) {
  const scale = 0.75;
  const tw = Math.round(CLIP.width * scale);
  const th = Math.round(CLIP.height * scale);
  const rows = Math.ceil(views.length / columns);
  const tiles = await Promise.all(views.map(({ shot }) => sharp(shot).resize(tw, th).toBuffer()));
  const file = join(OUT, `${PREFIX}-${name}.jpg`);
  await sharp({ create: { width: tw * columns, height: th * rows, channels: 3, background: '#000' } })
    .composite(tiles.map((input, i) => ({ input, left: (i % columns) * tw, top: Math.floor(i / columns) * th })))
    .jpeg({ quality: 82 })
    .toFile(file);
  const cuts = views.map(({ cut }) => cut);
  report[name] = cuts;
  console.log(`${file} : ${views.length} vues, éléments retirés ${cuts.join(' ')}`);
}

await still();
// 1. Distance de départ, hauteur de départ.
await sheet(await ring(12), 'depart', 6);
// 2. Recul maximal.
await zoom(240, 14);
await sheet(await ring(12), 'recul', 6);
// 3. Recul maximal, caméra haute (plongée).
await drag(0, 140);
await sheet(await ring(12), 'haut', 6);
// 4. Caméra basse, au plus près.
await drag(0, -400);
await zoom(-240, 28);
await sheet(await ring(12), 'pres-bas', 6);

writeFileSync(join(OUT, `${PREFIX}-coupe.json`), `${JSON.stringify(report, null, 2)}\n`);
await browser.close();
stop();
