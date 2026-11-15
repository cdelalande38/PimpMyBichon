// @ts-check
// Temps de carte graphique par image pendant la rotation lente, sur un ou plusieurs sites
// construits. « Sous le capot » ne donne que la cadence, plafonnée par l'écran (60 i/s ici) :
// elle ne dit rien d'une carte qui a de la marge. Ce relevé pose une requête de minuterie
// (EXT_disjoint_timer_query_webgl2, TIME_ELAPSED) autour de chaque image, de l'extérieur de
// l'app (crochets posés avant son code), et compte aussi les appels de dessin, les triangles et
// les programmes de nuanceur vivants. Il marche donc sur une version qui n'expose rien.
//
// Usage (après `npx vite build` dans chaque racine) :
//   node tools/captures/cadence.mjs [--root <dossier>]... [--label <nom>]... [--tour temps|images]...
//     [--levels standard,max] [--frames <n>] [--skip 120] [--repeat 3] [--port 4321] [--out <fichier.json>]
//     [--logiciel] [--detail]
// --root : dossier qui contient dist/ (défaut : ce dépôt) ; plusieurs racines sont mesurées en
// séries alternées (une série = une racine, un niveau, une page neuve). Chaque racine est servie
// sous /PimpMyBichon/ sur son port (--port, puis les suivants).
// --tour, un par racine, dans l'ordre des --root : comment la rotation lente de cette version
// avance. « temps » (défaut) : au temps, un tour en 66,7 s de rotation quelle que soit la cadence
// (src/render/frameMeter.ts, slowSpinSpeed : pas borné à 0,1 s, repris ici) ; « images » : d'un
// angle fixe par image, un tour en 4 000 images (versions jusqu'à 8dc262f compris).
// --frames <n> : n images au lieu d'un tour, pour toutes les racines (essai court).
// Défauts : un tour entier de rotation lente, trois séries par racine et par niveau, carte
// graphique réelle (ANGLE sur OpenGL ES) ; --logiciel prend le rendu logiciel des parcours (pas de
// minuterie : seuls appels, triangles et programmes sont relevés).
// Sortie : une ligne lisible par racine et par niveau (médiane, neuvième décile, bruit), et le
// relevé complet en JSON (--out, défaut captures/cadence/cadence-<date>.json) ; --detail y ajoute,
// par série, le temps de carte et les appels de chaque image, avec son angle de rotation depuis la
// première image gardée (on compare deux versions au même endroit du tour).

/* global window, document, WebGL2RenderingContext, HTMLCanvasElement, MutationObserver -- fonctions exécutées dans la page */
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { loadavg } from 'node:os';
import { basename, dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

const { values } = parseArgs({
  options: {
    root: { type: 'string', multiple: true },
    label: { type: 'string', multiple: true },
    tour: { type: 'string', multiple: true },
    levels: { type: 'string', default: 'standard,max' },
    frames: { type: 'string' },
    skip: { type: 'string', default: '120' },
    repeat: { type: 'string', default: '3' },
    port: { type: 'string', default: '4321' },
    out: { type: 'string' },
    logiciel: { type: 'boolean', default: false },
    detail: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});
if (values.help) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((line) => line.startsWith('//')).map((line) => line.slice(3)).join('\n'));
  process.exit(0);
}

const REPO = resolve(import.meta.dirname, '..', '..');
const ROOTS = (values.root ?? [REPO]).map((root) => resolve(root));
const LABELS = ROOTS.map((root, i) => values.label?.[i] ?? basename(root));
const LEVELS = values.levels.split(',').map((level) => level.trim()).filter(Boolean);
/** Images gardées d'office (--frames) ; sinon, un tour de rotation lente. */
const FRAMES = values.frames === undefined ? null : Number(values.frames);
/** Tour de rotation lente, par racine : au temps (défaut) ou en images (anciennes versions). */
const TOURS = ROOTS.map((_, i) => values.tour?.[i] ?? 'temps');
/** Rotation au temps : durée d'un tour et pas maximal par image (src/render/frameMeter.ts). */
const TURN_MS = (60 / 0.9) * 1000;
const SPIN_MAX_STEP_MS = 100;
/** Rotation d'un angle fixe par image (jusqu'à 8dc262f) : images par tour à la vitesse 0,9. */
const TURN_FRAMES = 4000;
const SKIP = Number(values.skip);
const REPEAT = Number(values.repeat);
const PORT = Number(values.port);
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = resolve(REPO, values.out ?? join('captures', 'cadence', `cadence-${STAMP}.json`));
/** Gabarit du téléphone de référence (rendu de 800 × 1602 px, pixel ratio 2). */
const VIEWPORT = { width: 412, height: 915 };
const LEVEL_LABELS = /** @type {Record<string, string>} */ ({ eco: 'Économie', standard: 'Standard', max: 'Max' });
/** Fréquence instantanée de la carte (Intel, sysfs) ; absente ailleurs. */
const GPU_FREQ = '/sys/class/drm/card1/gt_cur_freq_mhz';

for (const level of LEVELS) if (!LEVEL_LABELS[level]) throw new Error(`Niveau inconnu : ${level} (eco, standard, max)`);
for (const tour of TOURS) if (tour !== 'temps' && tour !== 'images') throw new Error(`Tour inconnu : ${tour} (temps, images)`);
if (FRAMES !== null && !(FRAMES > 0)) throw new Error(`--frames : nombre d'images attendu`);
for (const root of ROOTS) if (!existsSync(join(root, 'dist', 'index.html'))) throw new Error(`${root}/dist/index.html introuvable (lance le build)`);

const MIME = /** @type {Record<string, string>} */ ({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ktx2': 'image/ktx2',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8',
});

/**
 * Sert `<root>/dist` sous /PimpMyBichon/, comme GitHub Pages.
 * @param {string} root
 * @param {number} port
 */
function serve(root, port) {
  const dist = join(root, 'dist');
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/PimpMyBichon/')) {
      response.writeHead(404).end();
      return;
    }
    const relative = decodeURIComponent(url.pathname.slice('/PimpMyBichon/'.length)) || 'index.html';
    const file = normalize(join(dist, relative));
    if (!file.startsWith(dist + sep) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(file).pipe(response);
  });
  return new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => done(server));
  });
}

/**
 * Crochets posés avant le code de l'app : contexte WebGL2 retenu à sa création, appels de
 * dessin, triangles et programmes comptés, requête de minuterie autour de chaque rappel
 * d'image (requestAnimationFrame). Une image sans appel de dessin n'est pas gardée.
 */
function instrument() {
  /** @type {any} */
  const w = window;
  const rec = {
    gl: /** @type {WebGL2RenderingContext | null} */ (null),
    ext: /** @type {any} */ (null),
    renderer: /** @type {string | null} */ (null),
    frames: /** @type {Array<{ i: number; t: number; s: number; draws: number; tris: number; programs: number; trame: number; gpu: number | null }>} */ ([]),
    pending: /** @type {Array<{ q: WebGLQuery; entry: { gpu: number | null } }>} */ ([]),
    current: /** @type {{ draws: number; tris: number } | null} */ (null),
    active: false,
    index: 0,
    /** Temps de rotation cumulé, en millisecondes : écarts entre images dessinées, bornés comme l'app. */
    spin: 0,
    lastDraw: /** @type {number | null} */ (null),
    live: 0,
    disjoint: 0,
    outside: 0,
    firstDraw: /** @type {number | null} */ (null),
    marks: /** @type {Record<string, number>} */ ({}),
  };
  w.__cadence = rec;
  const proto = WebGL2RenderingContext.prototype;
  /** @param {number} mode @param {number} count @param {number} instances */
  const count = (mode, count, instances) => {
    const frame = rec.current;
    if (!frame) {
      rec.outside += 1;
      return;
    }
    frame.draws += 1;
    if (mode === 4) frame.tris += Math.floor(count / 3) * instances;
    else if (mode === 5 || mode === 6) frame.tris += Math.max(0, count - 2) * instances;
  };
  /** @param {string} name @param {(args: any[]) => void} note */
  const hook = (name, note) => {
    const original = /** @type {any} */ (proto)[name];
    if (typeof original !== 'function') return;
    /** @type {any} */ (proto)[name] = function (/** @type {any[]} */ ...args) {
      note(args);
      return original.apply(this, args);
    };
  };
  hook('drawArrays', (a) => count(a[0], a[2], 1));
  hook('drawElements', (a) => count(a[0], a[1], 1));
  hook('drawArraysInstanced', (a) => count(a[0], a[2], a[3]));
  hook('drawElementsInstanced', (a) => count(a[0], a[1], a[4]));
  hook('drawRangeElements', (a) => count(a[0], a[3], 1));
  const programs = new WeakSet();
  const createProgram = proto.createProgram;
  proto.createProgram = function () {
    const program = createProgram.call(this);
    if (program) {
      programs.add(program);
      rec.live += 1;
    }
    return program;
  };
  const deleteProgram = proto.deleteProgram;
  proto.deleteProgram = function (program) {
    if (program && programs.has(program)) {
      programs.delete(program);
      rec.live -= 1;
    }
    return deleteProgram.call(this, program);
  };
  const getContext = HTMLCanvasElement.prototype.getContext;
  /** @type {any} */ (HTMLCanvasElement.prototype).getContext = function (/** @type {any[]} */ ...args) {
    const context = getContext.apply(this, /** @type {any} */ (args));
    if (args[0] === 'webgl2' && context && !rec.gl) {
      const gl = /** @type {WebGL2RenderingContext} */ (context);
      rec.gl = gl;
      rec.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      rec.renderer = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    }
    return context;
  };
  /** Relève les requêtes terminées, dans l'ordre (une requête n'aboutit qu'entre deux images). */
  const harvest = () => {
    const { gl, ext } = rec;
    if (!gl || !ext) return;
    while (rec.pending.length > 0) {
      const head = rec.pending[0];
      if (!head || !gl.getQueryParameter(head.q, gl.QUERY_RESULT_AVAILABLE)) break;
      rec.pending.shift();
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      const ns = gl.getQueryParameter(head.q, gl.QUERY_RESULT);
      gl.deleteQuery(head.q);
      if (disjoint) rec.disjoint += 1;
      else head.entry.gpu = ns / 1e6;
    }
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) =>
    raf((time) => {
      harvest();
      const { gl, ext } = rec;
      /** @type {WebGLQuery | null} */
      let query = null;
      if (gl && ext && !rec.active) {
        query = gl.createQuery();
        if (query) {
          gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
          rec.active = true;
        }
      }
      const frame = { draws: 0, tris: 0 };
      rec.current = frame;
      try {
        callback(time);
      } finally {
        rec.current = null;
        if (query && gl && ext) {
          gl.endQuery(ext.TIME_ELAPSED_EXT);
          rec.active = false;
        }
        if (frame.draws > 0) {
          rec.index += 1;
          // Pas borné à 0,1 s, comme la rotation lente de l'app (slowSpinSpeed).
          if (rec.lastDraw !== null) rec.spin += Math.min(Math.max(time - rec.lastDraw, 0), 100);
          rec.lastDraw = time;
          rec.firstDraw ??= performance.now();
          // Matériaux de la coupe en trame à cette image, si la version l'expose (sinon −1).
          const trame = Number(document.querySelector('.stage')?.getAttribute('data-trame') ?? -1);
          const entry = { i: rec.index, t: time, s: rec.spin, draws: frame.draws, tris: frame.tris, programs: rec.live, trame, gpu: null };
          rec.frames.push(entry);
          if (query) rec.pending.push({ q: query, entry });
        } else if (query && gl) gl.deleteQuery(query);
      }
    });
  // Instants de démarrage : véhicule posé, variantes de la coupe prêtes (si la version les expose).
  new MutationObserver(() => {
    const stage = document.querySelector('.stage');
    if (!stage) return;
    if (stage.getAttribute('data-bench') === 'pret') rec.marks.bench ??= performance.now();
    if (stage.getAttribute('data-trame-pret') === 'oui') rec.marks.trame ??= performance.now();
  }).observe(document, { subtree: true, attributes: true, childList: true, attributeFilter: ['data-bench', 'data-trame-pret'] });
}

/** @param {number[]} sorted @param {number} q */
const quantile = (sorted, q) => (sorted.length === 0 ? Number.NaN : (sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] ?? Number.NaN));
/** Médiane vraie (moyenne des deux du milieu pour un nombre pair) : pour les synthèses de séries. @param {number[]} sorted */
const median = (sorted) => {
  if (sorted.length === 0) return Number.NaN;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? Number.NaN) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};
/** @param {number[]} values */
const sortNum = (values) => [...values].sort((a, b) => a - b);
/** @param {number} value @param {number} [digits] */
const fr = (value, digits = 2) => (Number.isFinite(value) ? value.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—');
const readFreq = () => {
  try {
    return Number(readFileSync(GPU_FREQ, 'utf8'));
  } catch {
    return Number.NaN;
  }
};

/**
 * Choisit le niveau dans les réglages (sauvegardé dans IndexedDB), puis recharge : la page
 * repart de zéro à ce niveau, la rotation lente de la vue de départ.
 * @param {import('@playwright/test').Page} page
 * @param {string} level
 */
async function chooseLevel(page, level) {
  await page.getByRole('heading', { level: 1, name: 'PimpMyBichon' }).waitFor({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Réglages' }).click();
  const dialog = page.getByRole('dialog', { name: 'Réglages' });
  const button = dialog.getByRole('group', { name: 'Qualité' }).getByRole('button', { name: new RegExp(`^${LEVEL_LABELS[level]}`) });
  await button.click();
  await page.waitForFunction((b) => b?.getAttribute('aria-pressed') === 'true', await button.elementHandle());
  await page.goBack();
  await dialog.waitFor({ state: 'hidden' });
  // La sauvegarde des réglages est asynchrone (IndexedDB).
  await page.waitForTimeout(800);
}

/**
 * Une série : page neuve, niveau choisi, un tour de rotation lente relevé image par image.
 * @param {import('@playwright/test').Browser} browser
 * @param {string} base
 * @param {string} level
 * @param {string} tour « temps » ou « images » : comment la rotation de cette version avance.
 */
async function series(browser, base, level, tour) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'no-preference',
    colorScheme: 'dark',
    locale: 'fr-FR',
    // Pas de précache en tâche de fond pendant la mesure.
    serviceWorkers: 'block',
  });
  try {
    const page = await context.newPage();
    const errors = /** @type {string[]} */ ([]);
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.addInitScript(instrument);
    await page.goto(base);
    await chooseLevel(page, level);
    await page.reload();
    await page.locator(`.stage[data-quality="${level}"][data-bench="pret"]`).waitFor({ state: 'attached', timeout: 240_000 });
    const ready = await page.evaluate(() => /** @type {any} */ (window).__cadence.index);
    const first = ready + SKIP;
    // Un tour : en images (--frames, ou version qui tourne d'un angle fixe par image), ou en temps
    // de rotation depuis l'image `first` (version qui tourne au temps).
    const byFrames = FRAMES ?? (tour === 'images' ? TURN_FRAMES : null);
    const freqs = /** @type {number[]} */ ([]);
    const deadline = Date.now() + 60_000 + (byFrames === null ? TURN_MS * 3 : byFrames * 100);
    /** Temps de rotation cumulé à l'image `first` (rotation au temps). */
    let spinStart = /** @type {number | null} */ (null);
    let last = byFrames === null ? Number.POSITIVE_INFINITY : first + byFrames;
    let stalled = 0;
    let previous = ready;
    for (;;) {
      await page.waitForTimeout(250);
      const { index, spin, firstSpin } = await page.evaluate((from) => {
        const rec = /** @type {any} */ (window).__cadence;
        const entry = rec.index >= from ? rec.frames.find((/** @type {{ i: number }} */ f) => f.i === from) : null;
        return { index: rec.index, spin: rec.spin, firstSpin: entry ? entry.s : null };
      }, first);
      if (spinStart === null && firstSpin !== null) spinStart = firstSpin;
      if (byFrames === null && spinStart !== null && spin - spinStart >= TURN_MS && last === Number.POSITIVE_INFINITY) last = index;
      if (index >= first && index < last) freqs.push(readFreq());
      if (index >= last + 10) break;
      stalled = index === previous ? stalled + 1 : 0;
      previous = index;
      if (stalled > 40) throw new Error('la scène ne tourne plus (rotation lente arrêtée ?)');
      if (Date.now() > deadline) throw new Error('série trop longue');
    }
    const data = await page.evaluate(
      ([from, to, start, turn]) => {
        const rec = /** @type {any} */ (window).__cadence;
        // Rotation au temps : les images du tour sont celles dont la rotation depuis `from` tient dans un tour.
        const inTurn = (/** @type {{ i: number; s: number }} */ f) => (start === null || turn === null ? f.i <= to : f.s - start <= turn);
        return {
          frames: rec.frames.filter((/** @type {{ i: number; s: number }} */ f) => f.i > from && inTurn(f)),
          renderer: rec.renderer,
          timer: rec.ext !== null,
          disjoint: rec.disjoint,
          firstDraw: rec.firstDraw,
          marks: rec.marks,
          live: rec.live,
          stage: Object.fromEntries(
            ['data-programmes', 'data-trame', 'data-trame-pret', 'data-coupe'].map((name) => [name, document.querySelector('.stage')?.getAttribute(name) ?? null]),
          ),
        };
      },
      /** @type {[number, number, number | null, number | null]} */ ([first, last, spinStart, byFrames === null ? TURN_MS : null]),
    );
    /** @type {Array<{ i: number; t: number; s: number; draws: number; tris: number; programs: number; gpu: number | null }>} */
    const frames = data.frames;
    // Angle de rotation de chaque image depuis l'image `first`, en degrés.
    const angleOf = (/** @type {{ i: number; s: number }} */ f) =>
      tour === 'images' || spinStart === null ? ((f.i - first) / TURN_FRAMES) * 360 : ((f.s - spinStart) / TURN_MS) * 360;
    const gpu = sortNum(frames.flatMap((f) => (f.gpu === null ? [] : [f.gpu])));
    const span = frames.length > 1 ? ((frames.at(-1)?.t ?? 0) - (frames[0]?.t ?? 0)) / 1000 : Number.NaN;
    const freq = sortNum(freqs.filter(Number.isFinite));
    return {
      renderer: data.renderer,
      frames: frames.length,
      timed: gpu.length,
      disjoint: data.disjoint,
      gpu: { median: quantile(gpu, 0.5), p90: quantile(gpu, 0.9), mean: gpu.reduce((s, v) => s + v, 0) / Math.max(1, gpu.length), max: gpu.at(-1) ?? Number.NaN },
      draws: { median: quantile(sortNum(frames.map((f) => f.draws)), 0.5), max: Math.max(...frames.map((f) => f.draws)) },
      triangles: { median: quantile(sortNum(frames.map((f) => f.tris)), 0.5), max: Math.max(...frames.map((f) => f.tris)) },
      programs: { start: frames[0]?.programs ?? null, end: frames.at(-1)?.programs ?? null, max: Math.max(...frames.map((f) => f.programs)) },
      fps: frames.length / span,
      tour: byFrames === null ? 'temps' : tour === 'images' && FRAMES === null ? 'images' : 'images imposées',
      turnDegrees: frames.length > 0 ? angleOf(/** @type {any} */ (frames.at(-1))) : Number.NaN,
      gpuFreqMHz: quantile(freq, 0.5),
      startup: {
        firstDrawMs: data.firstDraw,
        benchMs: data.marks.bench ?? null,
        ditherReadyMs: data.marks.trame ?? null,
      },
      stage: data.stage,
      errors,
      ...(values.detail
        ? { detail: frames.map((f) => [f.i, Math.round(angleOf(f) * 100) / 100, f.gpu === null ? null : Math.round(f.gpu * 1000) / 1000, f.draws, /** @type {any} */ (f).trame]) }
        : {}),
    };
  } finally {
    await context.close();
  }
}

const servers = await Promise.all(ROOTS.map((root, i) => serve(root, PORT + i)));
const browser = await chromium.launch({
  args: values.logiciel
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
    : ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'],
});

/** @type {Array<Record<string, unknown> & { label: string; level: string; repeat: number; gpu: { median: number; p90: number } }>} */
const results = [];
const loadBefore = loadavg();
try {
  for (let repeat = 0; repeat < REPEAT; repeat += 1) {
    for (const level of LEVELS) {
      // Ordre alterné d'une série à l'autre : une dérive du poste ne favorise aucune version.
      const order = ROOTS.map((_, i) => i);
      if (repeat % 2 === 1) order.reverse();
      for (const i of order) {
        const label = LABELS[i] ?? '';
        const load = loadavg()[0] ?? 0;
        const result = await series(browser, `http://127.0.0.1:${PORT + i}/PimpMyBichon/`, level, TOURS[i] ?? 'temps');
        results.push({ label, level, repeat, load, ...result });
        console.log(
          `  série ${repeat + 1}/${REPEAT} ${level} ${label} : médiane ${fr(result.gpu.median)} ms, p90 ${fr(result.gpu.p90)} ms` +
            ` · ${result.draws.median} appels · ${result.triangles.median.toLocaleString('fr-FR')} triangles · ${result.programs.end} programmes` +
            ` · ${fr(result.fps, 1)} i/s · ${result.frames} images sur ${fr(result.turnDegrees, 1)}° · ${fr(result.gpuFreqMHz, 0)} MHz · charge ${fr(load, 1)}`,
        );
      }
    }
  }
} finally {
  await browser.close();
  for (const server of servers) /** @type {import('node:http').Server} */ (server).close();
}

// Synthèse : par version et par niveau, médiane des médianes de série ; le bruit est la
// demi-étendue des médianes de série (et son rapport à la médiane).
const summary = [];
for (const level of LEVELS) {
  for (const label of LABELS) {
    const runs = results.filter((r) => r.label === label && r.level === level);
    const medians = sortNum(runs.map((r) => r.gpu.median));
    const p90s = sortNum(runs.map((r) => r.gpu.p90));
    const middle = median(medians);
    const noise = ((medians.at(-1) ?? 0) - (medians[0] ?? 0)) / 2;
    /** @param {(r: any) => number} pick */
    const mid = (pick) => median(sortNum(runs.map(pick)));
    const line = {
      label,
      level,
      series: runs.length,
      gpuMedianMs: middle,
      gpuP90Ms: median(p90s),
      noiseMs: noise,
      noiseRatio: noise / middle,
      seriesMedians: medians,
      draws: mid((r) => r.draws.median),
      triangles: mid((r) => r.triangles.median),
      programs: mid((r) => r.programs.end),
      firstDrawMs: mid((r) => r.startup.firstDrawMs ?? Number.NaN),
      benchMs: mid((r) => r.startup.benchMs ?? Number.NaN),
      gpuFreqMHz: mid((r) => r.gpuFreqMHz),
    };
    summary.push(line);
    console.log(
      `${level.padEnd(8)} ${label.padEnd(14)} médiane ${fr(middle)} ms (± ${fr(noise)}) · p90 ${fr(line.gpuP90Ms)} ms` +
        ` · ${line.draws} appels · ${Math.round(line.triangles).toLocaleString('fr-FR')} triangles · ${line.programs} programmes` +
        ` · véhicule posé à ${fr(line.benchMs / 1000, 1)} s`,
    );
  }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      date: new Date().toISOString(),
      renderer: results[0]?.renderer ?? null,
      viewport: { ...VIEWPORT, deviceScaleFactor: 2 },
      frames: FRAMES,
      turn: { ms: TURN_MS, maxStepMs: SPIN_MAX_STEP_MS, framesPerTurnOld: TURN_FRAMES },
      skip: SKIP,
      repeat: REPEAT,
      software: values.logiciel,
      load: { before: loadBefore, after: loadavg() },
      roots: ROOTS.map((root, i) => ({ label: LABELS[i], root, tour: TOURS[i] })),
      summary,
      series: results,
    },
    null,
    2,
  )}\n`,
);
console.log(`Relevé : ${OUT}`);
