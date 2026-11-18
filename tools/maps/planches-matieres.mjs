// @ts-check
// Planches des matières du sol et du bâti (chaussée, bas-côtés, terrain, façades), vues dans la page
// de la sortie (src/dev/sortie/) : chaque plan est pris de nuit, tel que la sortie le rend, puis sous
// une lumière neutre de jour posée à la main (soleil haut et blanc, ciel clair, phares et brume
// coupés), pour juger les matières hors de l'éclairage de nuit. Écrit une image par plan et par
// lumière, releves.json (appels de dessin, triangles, cadence) et planche.png dans le dossier demandé.
//
//   node tools/maps/planches-matieres.mjs <carte> [--port <n>] [--out <dossier>] [--logiciel] [--cadence]
//        [--plans nom=s:camera,…] [--meteo sec|pluie|neige]
//
// Plans tirés de la route (aucune abscisse propre à une carte ici) : au milieu de la plus longue
// section hors agglomération (poursuite, rasante, vue de côté) et de la plus longue section en
// agglomération (poursuite, vue de côté). La carte doit être fabriquée (npm run maps:build).

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PAGE = 'src/dev/sortie/index.html';
const GPU_ARGS = ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-gpu-vsync', '--disable-frame-rate-limit'];
const SOFT_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const W = 390;
const H = 844;

/**
 * @param {{ sections: Array<{ from: number, to: number, ground: string, urban: boolean }> }} route
 * @returns {Array<{ nom: string, s: number, camera: string }>}
 * Vues de côté : caméra d'orbite reculée au plus loin (18 m) et presque à l'horizontale, pour voir
 * le bas-côté, le terrain et les façades derrière le véhicule.
 */
export function plansMatieres(route) {
  /** @param {boolean} urban */
  const longest = (urban) =>
    route.sections.filter((x) => x.ground === 'sol' && x.urban === urban).sort((a, b) => b.to - b.from - (a.to - a.from))[0];
  const plans = [];
  const champ = longest(false);
  if (champ) {
    const s = Math.round((champ.from + champ.to) / 2);
    plans.push({ nom: 'route-poursuite', s, camera: 'poursuite' }, { nom: 'route-rasante', s, camera: 'rasante' }, { nom: 'route-cote', s, camera: 'orbite@1.45' });
  }
  const ville = longest(true);
  if (ville) {
    const s = Math.round((ville.from + ville.to) / 2);
    plans.push({ nom: 'ville-poursuite', s, camera: 'poursuite' }, { nom: 'ville-cote', s, camera: 'orbite@1.45' });
  }
  return plans;
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const o = { id: '', port: 5023, out: '', soft: false, cadence: false, plans: '', meteo: 'sec' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--port') o.port = Number(argv[++i]);
    else if (a === '--out') o.out = argv[++i] ?? '';
    else if (a === '--logiciel') o.soft = true;
    else if (a === '--cadence') o.cadence = true;
    else if (a === '--plans') o.plans = argv[++i] ?? '';
    else if (a === '--meteo') o.meteo = argv[++i] ?? 'sec';
    else if (a && !a.startsWith('-')) o.id = a;
  }
  if (!o.id) throw new Error('usage : node tools/maps/planches-matieres.mjs <carte> [--port <n>] [--out <dossier>] [--logiciel] [--cadence]');
  if (!o.out) o.out = join('captures', 'matieres', o.id);
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
  const child = spawn(process.execPath, [vite, '--port', String(port), '--strictPort'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (c) => (log += c));
  child.stderr.on('data', (c) => (log += c));
  return { child, log: () => log };
}

/**
 * Lumière neutre de jour, posée dans la page (et retirée) : lumières de la scène, brouillard,
 * uniformes de nuit (phares, brume, ciel réfléchi). Les albédos de nuit sont sombres (2 à 4 %) :
 * soleil et ciel sont forcés en conséquence ; seul le rapport entre matières compte ici.
 * @param {boolean} on
 */
function lumiereNeutre(on) {
  const g = /** @type {any} */ (globalThis);
  const dbg = g.pmbSortie.debug;
  const scene = dbg.scene;
  const u = dbg.uniforms;
  const saved = (g.__pmbNuit ??= { lights: new Map(), u: {}, fog: null });
  if (on) {
    scene.traverse((/** @type {any} */ o) => {
      if (o.isDirectionalLight) {
        saved.lights.set(o, { color: o.color.getHex(), intensity: o.intensity, pos: o.position.toArray() });
        o.color.setHex(0xfff4e6);
        o.intensity = 9;
        o.position.set(0.35, 1, 0.25);
      } else if (o.isHemisphereLight) {
        saved.lights.set(o, { color: o.color.getHex(), ground: o.groundColor.getHex(), intensity: o.intensity });
        o.color.setHex(0xcfdfff);
        o.groundColor.setHex(0x6a5c48);
        o.intensity = 4;
      }
    });
    if (scene.fog) {
      saved.fog = { color: scene.fog.color.getHex(), density: scene.fog.density };
      scene.fog.color.setHex(0x9fb2c8);
      scene.fog.density *= 0.35;
    }
    for (const k of ['pmbHeadOn', 'pmbMistDensity', 'pmbLampCount', 'pmbNeonCount']) saved.u[k] = u[k].value;
    saved.u.horizon = u.pmbSkyHorizon.value.getHex();
    saved.u.zenith = u.pmbSkyZenith.value.getHex();
    u.pmbHeadOn.value = 0;
    u.pmbMistDensity.value = 0;
    u.pmbSkyHorizon.value.setHex(0xb8cce4);
    u.pmbSkyZenith.value.setHex(0x5a84bc);
    g.__pmbJour = true;
  } else {
    for (const [o, s] of saved.lights) {
      o.color.setHex(s.color);
      o.intensity = s.intensity;
      if (s.ground !== undefined) o.groundColor.setHex(s.ground);
      if (s.pos) o.position.fromArray(s.pos);
    }
    saved.lights.clear();
    if (scene.fog && saved.fog) {
      scene.fog.color.setHex(saved.fog.color);
      scene.fog.density = saved.fog.density;
    }
    u.pmbHeadOn.value = saved.u.pmbHeadOn;
    u.pmbMistDensity.value = saved.u.pmbMistDensity;
    u.pmbSkyHorizon.value.setHex(saved.u.horizon);
    u.pmbSkyZenith.value.setHex(saved.u.zenith);
    g.__pmbJour = false;
  }
}

/** @param {number} n */
function images(n) {
  return new Promise((done) => {
    let k = 0;
    const tick = () => {
      // Lampadaires et enseignes sont recalculés à chaque image par la scène : de « jour », éteints.
      const g = /** @type {any} */ (globalThis);
      if (g.__pmbJour) {
        g.pmbSortie.debug.uniforms.pmbLampCount.value = 0;
        g.pmbSortie.debug.uniforms.pmbNeonCount.value = 0;
      }
      k += 1;
      if (k >= n) done(undefined);
      else g.requestAnimationFrame(tick);
    };
    /** @type {any} */ (globalThis).requestAnimationFrame(tick);
  });
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const routeFile = join(ROOT, 'public', 'assets', 'maps', o.id, 'route.json');
  if (!existsSync(routeFile)) throw new Error(`public/assets/maps/${o.id}/route.json absent : npm run maps:build -- ${o.id}`);
  const plans = o.plans
    ? o.plans.split(',').map((p) => {
        const [nom = 'plan', reste = ''] = p.split('=');
        const [s = '0', camera = 'poursuite'] = reste.split(':');
        return { nom, s: Number(s), camera };
      })
    : plansMatieres(JSON.parse(readFileSync(routeFile, 'utf8')));
  const base = `http://localhost:${o.port}/PimpMyBichon/`;
  const outDir = resolve(ROOT, o.out);
  /** @type {ReturnType<typeof startServer> | null} */
  let server = null;
  /** @type {import('@playwright/test').Browser | null} */
  let browser = null;
  /** @type {string[]} */
  const errors = [];
  try {
    if (!(await reachable(base))) {
      server = startServer(o.port);
      const deadline = Date.now() + 90_000;
      while (!(await reachable(base))) {
        if (server.child.exitCode !== null) throw new Error(`le serveur s’est arrêté :\n${server.log()}`);
        if (Date.now() > deadline) throw new Error(`le serveur ne répond pas sur le port ${o.port}`);
        await pause(300);
      }
    }
    browser = await chromium.launch({ args: o.soft ? SOFT_ARGS : GPU_ARGS });
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    const q = new URLSearchParams({ carte: o.id, camera: 'poursuite', meteo: o.meteo, propre: '' });
    await page.goto(`${base}${PAGE}?${q}`);
    await page.waitForSelector('body[data-sortie-prete], body[data-sortie-erreur]', { timeout: 180_000 });
    const erreur = await page.getAttribute('body', 'data-sortie-erreur');
    if (erreur) throw new Error(`la page signale une erreur : ${erreur}`);
    mkdirSync(outDir, { recursive: true });
    /** @type {Buffer[]} */
    const shots = [];
    /** @type {any[]} */
    const releves = [];
    await page.evaluate(() =>
      /** @type {any} */ (globalThis).pmbSortie.drive.setState((/** @type {any} */ st) => ({ orbit: { ...st.orbit, distance: 18, pitch: 0.1 } })),
    );
    for (const p of plans) {
      await page.evaluate((x) => /** @type {any} */ (globalThis).pmbSortie.aller(x), { ...p, meteo: o.meteo });
      const cadence = o.cadence ? await page.evaluate(() => /** @type {any} */ (globalThis).pmbSortie.cadence(3000)) : null;
      await page.evaluate(() => {
        /** @type {any} */ (globalThis).pmbSortie.debug.figer = true;
      });
      await page.evaluate(images, 8);
      shots.push(await page.screenshot({ path: join(outDir, `${p.nom}-nuit.png`) }));
      const mesure = await page.evaluate(() => /** @type {any} */ (globalThis).pmbSortie.mesurer());
      await page.evaluate(lumiereNeutre, true);
      await page.evaluate(images, 8);
      shots.push(await page.screenshot({ path: join(outDir, `${p.nom}-jour.png`) }));
      await page.evaluate(lumiereNeutre, false);
      await page.evaluate(() => {
        /** @type {any} */ (globalThis).pmbSortie.debug.figer = false;
      });
      releves.push({ ...p, mesure, cadence });
      const c = cadence ? ` · ${cadence.fps.toFixed(0)} i/s (p95 ${cadence.p95.toFixed(1)} ms)` : '';
      console.log(`${p.nom} (s ${p.s}) — décor ${mesure.decor.triangles} tri, ${mesure.decor.calls} appels · image ${mesure.total.calls} appels${c}`);
    }
    writeFileSync(join(outDir, 'releves.json'), `${JSON.stringify(releves, null, 2)}\n`);
    const cw = Math.round(W / 2);
    const ch = Math.round(H / 2);
    const cols = 2;
    const rows = Math.ceil(shots.length / cols);
    const tiles = await Promise.all(shots.map((s) => sharp(s).resize(cw, ch).png().toBuffer()));
    await sharp({ create: { width: cw * cols, height: ch * rows, channels: 3, background: '#000000' } })
      .composite(tiles.map((input, i) => ({ input, left: (i % cols) * cw, top: Math.floor(i / cols) * ch })))
      .png()
      .toFile(join(outDir, 'planche.png'));
    console.log(relative(ROOT, outDir));
  } finally {
    if (errors.length > 0) console.warn(`console de la page :\n  ${[...new Set(errors)].slice(0, 8).map((e) => e.slice(0, 300)).join('\n  ')}`);
    await browser?.close();
    server?.child.kill('SIGTERM');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
