// @ts-check
// Fonds des écrans de chargement (demande du 19 novembre 2026) : des rendus de nos propres scènes par
// le moteur du jeu, aucune image extérieure ni générée. Deux cadrages par image, paysage (1920 × 1080)
// et portrait (1080 × 1920), rendus à double densité puis réduits, en WebP de 250 Kio au plus.
//
// - Chaque carte de public/assets/maps/ : une vue de nuit cadrée comme une affiche, prise dans la page
//   de développement de la sortie (src/dev/sortie/, sans interface), temps arrêté. Les images vont
//   dans le dossier de la carte (fond-paysage-<empreinte>.webp : un fond refait change d'adresse, le
//   cache des cartes du service worker ne le garde pas périmé), et la seule ligne « fond » de son
//   map.json est écrite ou remplacée (le reste du fichier n'est pas touché).
// - « garage » : le garage néon et le véhicule de départ, par le mode photo de l'app (image enregistrée
//   en grand format), dans public/assets/fonds/ (au précache : le lancement l'affiche hors ligne).
//
// Les prises (véhicule, peinture, abscisse, caméra, météo, cadrage) : tools/fonds/prises.json ; une
// carte sans prise part de son premier départ, en poursuite, au sec. Lance le serveur de développement
// sur le port demandé (ou réutilise celui qui y tourne), Chromium de Playwright sur la carte graphique
// (--logiciel : rendu logiciel, bien plus lent), puis arrête le serveur.
//
//   npm run fonds:build [-- <carte|garage> …] [--port <n>] [--logiciel]
//   npm run fonds:build -- <carte> --essai <s>:<caméra>[:<lacet>:<tangage>:<distance>][@<météo>],…
//     (planche d'essai de cadrages, 960 × 540, dans captures/fonds-essai/<carte>.png ; rien n'est écrit
//     dans public/)
//
// Les cartes doivent être fabriquées (npm run maps:build) et les véhicules aussi (npm run vehicles:build).

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAPS = join(ROOT, 'public', 'assets', 'maps');
const GARAGE_DIR = join(ROOT, 'public', 'assets', 'fonds');
const PRISES = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'prises.json'), 'utf8'));
const GPU_ARGS = ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'];
const SOFT_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
/** Cadrages, en pixels CSS ; rendus à double densité, puis réduits (anticrénelage). */
const FORMATS = /** @type {const} */ ({ paysage: { width: 1920, height: 1080 }, portrait: { width: 1080, height: 1920 } });
const DSF = 2;
/**
 * Où tombe le véhicule dans l'image (fractions depuis le coin en haut à gauche), d'après la mise en page des
 * écrans de chargement (src/ui/tuto/tuto.css, src/ui/drive/drive.css) : le texte occupe le bas de l'écran,
 * et la gauche dans la sortie en paysage. La scène est rendue plus grande que le cadrage, véhicule au
 * centre (caméra d'orbite, ou cadrage du mode photo), puis recadrée.
 */
const FOCAL = {
  garage: { paysage: { x: 0.5, y: 0.5 }, portrait: { x: 0.5, y: 0.5 } },
  carte: { paysage: { x: 0.75, y: 0.5 }, portrait: { x: 0.5, y: 0.32 } },
};
const MAX_BYTES = 250 * 1024;
const USAGE = 'usage : npm run fonds:build [-- <carte|garage> …] [--port <n>] [--logiciel] [--essai <s>:<caméra>[:<lacet>:<tangage>:<distance>][@<météo>],…]';

/**
 * @typedef {{ yaw: number, pitch: number, distance: number }} Orbite
 * @typedef {{ vehicule?: string, peinture?: string, s?: number, camera?: string, orbite?: Orbite, meteo?: string, portrait?: Partial<Prise> }} Prise
 */

/** @param {string[]} argv */
function parseArgs(argv) {
  const o = { ids: /** @type {string[]} */ ([]), port: 4902, soft: false, essai: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    const valued = /^--(port|essai)(?:=(.*))?$/.exec(arg);
    if (valued) {
      const value = valued[2] ?? argv[(i += 1)];
      if (!value) throw new Error(`option --${valued[1]} sans valeur\n${USAGE}`);
      if (valued[1] === 'port') o.port = Number(value);
      else o.essai = value;
    } else if (arg === '--logiciel') o.soft = true;
    else if (arg.startsWith('--') || !/^[a-z0-9-]+$/.test(arg)) throw new Error(`argument « ${arg} » inconnu\n${USAGE}`);
    else o.ids.push(arg);
  }
  if (!Number.isInteger(o.port) || o.port < 1024 || o.port > 65535) throw new Error(`port invalide\n${USAGE}`);
  const maps = readdirSync(MAPS).filter((d) => existsSync(join(MAPS, d, 'map.json'))).sort();
  if (o.ids.length === 0) o.ids = ['garage', ...maps];
  for (const id of o.ids) if (id !== 'garage' && !maps.includes(id)) throw new Error(`carte « ${id} » introuvable sous public/assets/maps/`);
  if (o.essai && (o.ids.length !== 1 || o.ids[0] === 'garage')) throw new Error(`--essai : une seule carte\n${USAGE}`);
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

const pause = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** @param {number} port @param {string} base */
async function startServer(port, base) {
  if (await reachable(base)) return null;
  const env = { ...process.env };
  delete env.NODE_TLS_REJECT_UNAUTHORIZED;
  const vite = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [vite, '--port', String(port), '--strictPort'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (c) => (log += c));
  child.stderr.on('data', (c) => (log += c));
  const deadline = Date.now() + 90_000;
  while (!(await reachable(base))) {
    if (child.exitCode !== null) throw new Error(`le serveur de développement s’est arrêté :\n${log}`);
    if (Date.now() > deadline) throw new Error(`le serveur de développement ne répond pas sur le port ${port}`);
    await pause(300);
  }
  return child;
}

/**
 * Rendu d'un cadrage (pixels CSS) : assez grand pour que son centre tombe au point FOCAL du cadrage, et
 * la fenêtre du cadrage dans ce rendu (left, top).
 * @param {keyof typeof FOCAL} sujet @param {keyof typeof FORMATS} nom
 */
function rendu(sujet, nom) {
  const { width: w, height: h } = FORMATS[nom];
  const { x, y } = FOCAL[sujet][nom];
  const width = Math.round(w * 2 * Math.max(x, 1 - x));
  const height = Math.round(h * 2 * Math.max(y, 1 - y));
  return { width, height, left: Math.max(0, Math.round(width / 2 - x * w)), top: Math.max(0, Math.round(height / 2 - y * h)) };
}

/**
 * WebP de MAX_BYTES au plus, au cadrage `nom` : le rendu est ramené à sa taille en pixels CSS
 * (anticrénelage), on en garde la fenêtre du cadrage ; la qualité baisse par crans jusqu'à tenir.
 * @param {Buffer} image @param {keyof typeof FOCAL} sujet @param {keyof typeof FORMATS} nom
 */
async function webp(image, sujet, nom) {
  const size = FORMATS[nom];
  const r = rendu(sujet, nom);
  const cadre = await sharp(await sharp(image).resize(r.width, r.height, { fit: 'fill', kernel: 'lanczos3' }).toBuffer())
    .extract({ left: r.left, top: r.top, ...size })
    .png()
    .toBuffer();
  for (let quality = 84; quality >= 40; quality -= 4) {
    const out = await sharp(cadre).webp({ quality, effort: 6, smartSubsample: true }).toBuffer();
    if (out.length <= MAX_BYTES) return { out, quality };
  }
  throw new Error(`image trop lourde même en qualité 40 (${size.width} × ${size.height})`);
}

const empreinte = (/** @type {Buffer} */ b) => createHash('sha256').update(b).digest('hex').slice(0, 8);

/** Images rendues par le navigateur, ici : on attend `n` images de la page. */
const images = (/** @type {import('@playwright/test').Page} */ page, /** @type {number} */ n) =>
  page.evaluate(
    (count) =>
      new Promise((resolve) => {
        let k = 0;
        const raf = /** @type {any} */ (globalThis).requestAnimationFrame;
        const tick = () => (++k >= count ? resolve(null) : raf(tick));
        raf(tick);
      }),
    n,
  );

/**
 * Pose une prise dans la page de la sortie : caméra et météo (le temps court, la pluie se pose), puis
 * abscisse et orbite, temps arrêté, tronçons chargés.
 * @param {import('@playwright/test').Page} page @param {Prise} p
 */
async function poser(page, p) {
  await page.evaluate(async (x) => {
    const w = /** @type {any} */ (globalThis).pmbSortie;
    w.debug.figer = false;
    // Pluie sans gouttes qui tombent : la chaussée mouillée et ses reflets, rien devant l'objectif.
    w.postes({ gouttes: true, garde: true });
    // La peinture de l'adresse peut tomber avant la lecture des sauvegardes, qui l'écrase : on la repose.
    const peinture = /^([a-z-]+):([0-9a-f]{6})$/i.exec(x.peinture ?? '');
    if (peinture) w.peindre(peinture[1], peinture[2]);
    await w.aller({ camera: x.camera ?? 'poursuite', meteo: x.meteo ?? 'sec', moment: 'nuit' });
    if (x.orbite) w.drive.getState().setOrbit(x.orbite);
    // Le saut d'abscisse remet la poursuite dans l'axe ; le temps arrêté garde le véhicule à s.
    w.debug.seek(x.s);
    w.debug.figer = true;
    const limite = performance.now() + 90_000;
    while (!w.pret()) {
      if (performance.now() > limite) throw new Error('tronçons non chargés après 90 s');
      await new Promise((r) => setTimeout(r, 100));
    }
  }, p);
  // Sonde de réflexion et reflets à jour sur la pose arrêtée.
  await images(page, 30);
}

/**
 * Page de la sortie sur la carte, prête (tronçons du départ chargés), sans interface.
 * @param {import('@playwright/test').BrowserContext} context @param {string} base @param {string} id @param {Prise} p
 */
async function ouvrir(context, base, id, p) {
  const page = await context.newPage();
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const q = new URLSearchParams({ carte: id, propre: '', qualite: 'max', camera: p.camera ?? 'poursuite', meteo: p.meteo ?? 'sec', moment: 'nuit' });
  if (p.vehicule) q.set('vehicule', p.vehicule);
  if (p.peinture) q.set('peinture', p.peinture);
  // Une requête perdue (réseau du poste qui change, ERR_NETWORK_CHANGED) laisse la page en plan : on recharge.
  for (let essai = 1; ; essai += 1) {
    await page.goto(`${base}src/dev/sortie/index.html?${q}`);
    try {
      await page.waitForSelector('body[data-sortie-prete], body[data-sortie-erreur]', { state: 'attached', timeout: 120_000 });
      break;
    } catch (error) {
      const why = `${id} : page de la sortie pas prête (${error instanceof Error ? error.message.split('\n')[0] : error})\n  ${errors.slice(0, 8).join('\n  ')}`;
      if (essai >= 3) throw new Error(why, { cause: error });
      console.warn(`${why}\n  nouvel essai`);
      errors.length = 0;
    }
  }
  const erreur = await page.getAttribute('body', 'data-sortie-erreur');
  if (erreur) throw new Error(`${id} : la page signale une erreur : ${erreur}`);
  return page;
}

/** @param {string} id */
function prise(id) {
  const route = JSON.parse(readFileSync(join(MAPS, id, 'route.json'), 'utf8'));
  /** @type {Prise} */
  const p = PRISES.cartes?.[id] ?? {};
  return { camera: 'poursuite', meteo: 'sec', ...p, s: p.s ?? (route.starts[0]?.at ?? 0) + 40 };
}

/** @param {import('@playwright/test').Browser} browser @param {string} base @param {string} id */
async function carte(browser, base, id) {
  const p = prise(id);
  const context = await browser.newContext({ viewport: FORMATS.paysage, deviceScaleFactor: DSF });
  const page = await ouvrir(context, base, id, p);
  /** @type {Record<string, string>} */
  const fichiers = {};
  for (const nom of /** @type {const} */ (['paysage', 'portrait'])) {
    const size = FORMATS[nom];
    const { width, height } = rendu('carte', nom);
    await page.setViewportSize({ width, height });
    await poser(page, nom === 'portrait' ? { ...p, ...p.portrait } : p);
    const { out, quality } = await webp(await page.screenshot(), 'carte', nom);
    const fichier = `fond-${nom}-${empreinte(out)}.webp`;
    writeFileSync(join(MAPS, id, fichier), out);
    fichiers[nom] = fichier;
    console.log(`public/assets/maps/${id}/${fichier} — ${size.width} × ${size.height}, ${Math.round(out.length / 1024)} Kio (qualité ${quality})`);
  }
  await context.close();
  // Les anciens fonds de la carte s'en vont ; la ligne « fond » du manifeste désigne les nouveaux.
  for (const f of readdirSync(join(MAPS, id))) if (/^fond-.*\.webp$/.test(f) && !Object.values(fichiers).includes(f)) rmSync(join(MAPS, id, f));
  declarer(id, /** @type {{ paysage: string, portrait: string }} */ (fichiers));
}

/**
 * Écrit la ligne « fond » de map.json, ou la remplace : le reste du fichier garde sa forme.
 * @param {string} id @param {{ paysage: string, portrait: string }} fond
 */
function declarer(id, fond) {
  const file = join(MAPS, id, 'map.json');
  const text = readFileSync(file, 'utf8');
  const ligne = `"fond": { "paysage": "${fond.paysage}", "portrait": "${fond.portrait}" },`;
  const next = /^(\s*)"fond":.*$/m.test(text)
    ? text.replace(/^(\s*)"fond":.*$/m, `$1${ligne}`)
    : text.replace(/^(\s*)("route":.*,)$/m, `$1$2\n$1${ligne}`);
  const parsed = JSON.parse(next);
  if (parsed.fond?.paysage !== fond.paysage) throw new Error(`${relative(ROOT, file)} : ligne « fond » impossible à poser (ni ligne « fond » ni ligne « route » suivie d'une virgule)`);
  if (next !== text) writeFileSync(file, next);
}

/** Le garage : mode photo de l'app, cadrage de prises.json, image enregistrée en grand format. */
async function garage(/** @type {import('@playwright/test').Browser} */ browser, /** @type {string} */ base) {
  const g = PRISES.garage ?? {};
  mkdirSync(GARAGE_DIR, { recursive: true });
  for (const nom of /** @type {const} */ (['paysage', 'portrait'])) {
    const size = FORMATS[nom];
    const { width, height } = rendu('garage', nom);
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, acceptDownloads: true, reducedMotion: 'reduce', locale: 'fr-FR' });
    const page = await context.newPage();
    await page.goto(`${base}#/photo`);
    await page.locator('.stage[data-bench="pret"]').waitFor({ state: 'attached', timeout: 180_000 });
    await page.locator('.tuto-chargement').waitFor({ state: 'detached', timeout: 60_000 });
    const cadrage = (nom === 'portrait' ? g.portrait?.cadrage : undefined) ?? g.cadrage ?? 'Trois-quarts avant';
    await page.getByRole('button', { name: cadrage, exact: true }).click();
    await page.locator('.photo-status[data-refine="net"]').waitFor({ timeout: 120_000 });
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    const download = page.waitForEvent('download', { timeout: 180_000 });
    await page.getByRole('link', { name: 'Télécharger' }).click({ timeout: 180_000 });
    const jpeg = readFileSync(await (await download).path());
    const { out, quality } = await webp(jpeg, 'garage', nom);
    const fichier = join(GARAGE_DIR, `garage-${nom}.webp`);
    writeFileSync(fichier, out);
    console.log(`${relative(ROOT, fichier)} — ${size.width} × ${size.height}, ${Math.round(out.length / 1024)} Kio (qualité ${quality})`);
    await context.close();
  }
}

/** Planche d'essai : un cadrage par case, 960 × 540, pour choisir une prise (rien n'est écrit dans public/). */
async function essai(/** @type {import('@playwright/test').Browser} */ browser, /** @type {string} */ base, /** @type {string} */ id, /** @type {string} */ spec) {
  const p = prise(id);
  // Le cadrage paysage d'une carte à demi-taille (FOCAL).
  const r = rendu('carte', 'paysage');
  const size = { width: 960, height: 540 };
  const context = await browser.newContext({ viewport: { width: Math.round(r.width / 2), height: Math.round(r.height / 2) }, deviceScaleFactor: 1 });
  const page = await ouvrir(context, base, id, p);
  /** @type {Buffer[]} */
  const tiles = [];
  for (const item of spec.split(',')) {
    const [plan = '', meteo = p.meteo] = item.split('@');
    const [s = '0', camera = 'poursuite', yaw, pitch, distance] = plan.split(':');
    const orbite = yaw === undefined ? undefined : { yaw: Number(yaw), pitch: Number(pitch ?? 0.2), distance: Number(distance ?? 7.5) };
    await poser(page, { ...p, s: Number(s), camera, orbite, meteo });
    const shot = await page.screenshot({ clip: { x: Math.round(r.left / 2), y: Math.round(r.top / 2), ...size } });
    const label = Buffer.from(`<svg width="960" height="40"><rect width="960" height="40" fill="#000" opacity="0.6"/><text x="12" y="28" font-size="22" fill="#fff" font-family="sans-serif">${item}</text></svg>`);
    tiles.push(await sharp(shot).composite([{ input: label, top: 0, left: 0 }]).png().toBuffer());
    console.log(`essai ${item}`);
  }
  await context.close();
  const cols = 3;
  const tw = 640;
  const th = 360;
  const small = await Promise.all(tiles.map((t) => sharp(t).resize(tw, th).png().toBuffer()));
  const dir = join(ROOT, 'captures', 'fonds-essai');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `${id}.png`);
  await sharp({ create: { width: tw * cols, height: th * Math.ceil(small.length / cols), channels: 3, background: '#000' } })
    .composite(small.map((input, i) => ({ input, left: (i % cols) * tw, top: Math.floor(i / cols) * th })))
    .png()
    .toFile(out);
  console.log(relative(ROOT, out));
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const base = `http://localhost:${o.port}/PimpMyBichon/`;
  const server = await startServer(o.port, base);
  const stop = () => server?.kill('SIGTERM');
  process.once('SIGINT', () => {
    stop();
    process.exit(130);
  });
  const browser = await chromium.launch({ args: o.soft ? SOFT_ARGS : GPU_ARGS });
  try {
    const debut = Date.now();
    for (const id of o.ids) {
      if (o.essai) await essai(browser, base, id, o.essai);
      else if (id === 'garage') await garage(browser, base);
      else await carte(browser, base, id);
    }
    console.log(`fonds faits en ${Math.round((Date.now() - debut) / 1000)} s`);
  } finally {
    await browser.close();
    stop();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
