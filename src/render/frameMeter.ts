// Mesures de cadence pour la recette sur téléphone (« Sous le capot ») : « Mesurer » (la scène
// tourne cinq secondes) et « Comparer » (cinq variantes de la scène, mesurées chacune deux fois, à
// l'aller puis au retour, pour savoir sur le téléphone même où part le temps d'une image : cadence
// naturelle et temps de carte). Module pur : les images arrivent de src/scene/FrameMeter.tsx, les
// variantes se posent dans la scène.
// Aussi : la vitesse de la rotation lente, réglée au temps et non à l'image (la mesure tourne).

/** Durée de la mesure, en millisecondes. */
export const METER_DURATION_MS = 5000;

export interface FrameSample {
  /** Durée depuis l'image précédente, en millisecondes. */
  ms: number;
  calls: number;
  triangles: number;
}

export interface MeterSummary {
  frames: number;
  /** Cadence moyenne, en images par seconde. */
  fps: number;
  /** Temps moyen d'une image, en millisecondes (au dixième). */
  meanMs: number;
  /** Pire centile : cadence que tiennent 99 % des images (durée du centile le plus lent). */
  worstFps: number;
  /** Appels de dessin et triangles moyens par image. */
  calls: number;
  triangles: number;
}

/** Valeur au rang `p` (0 à 1) d'une liste triée, par le rang le plus proche. */
function percentile(sorted: ArrayLike<number>, p: number): number {
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[rank] ?? 0;
}

const tenth = (value: number) => Math.round(value * 10) / 10;

/** Résumé de durées d'image valides (déjà filtrées) ; les moyennes sont fournies. */
function summarize(sortedMs: ArrayLike<number>, total: number, calls: number, triangles: number): MeterSummary {
  const frames = sortedMs.length;
  const slowest = percentile(sortedMs, 0.99);
  return {
    frames,
    fps: tenth((1000 * frames) / total),
    meanMs: tenth(total / frames),
    worstFps: tenth(1000 / slowest),
    calls: Math.round(calls),
    triangles: Math.round(triangles),
  };
}

const validMs = (ms: number) => Number.isFinite(ms) && ms > 0;

/** Résumé d'une mesure ; `null` sans image exploitable. */
export function summarizeFrames(samples: readonly FrameSample[]): MeterSummary | null {
  const valid = samples.filter((sample) => validMs(sample.ms));
  if (valid.length === 0) return null;
  const total = valid.reduce((sum, sample) => sum + sample.ms, 0);
  const sorted = valid.map((sample) => sample.ms).sort((a, b) => a - b);
  const mean = (pick: (sample: FrameSample) => number) => valid.reduce((sum, sample) => sum + pick(sample), 0) / valid.length;
  return summarize(
    sorted,
    total,
    mean((sample) => sample.calls),
    mean((sample) => sample.triangles),
  );
}

// ───────────── Rotation lente ─────────────

/**
 * Vitesse de la rotation lente, dans l'unité d'OrbitControls (`autoRotateSpeed`) : 0,9 donne un
 * tour en 66,7 s, la vitesse d'origine à 60 images par seconde.
 */
export const SLOW_SPIN_SPEED = 0.9;
/**
 * OrbitControls (three-stdlib, appelé par drei sans temps écoulé) avance d'un angle fixe par
 * image, calculé pour 60 images par seconde : à 120 i/s, la scène tournerait deux fois plus vite.
 */
const CONTROLS_NOMINAL_FPS = 60;
/**
 * Pas de temps maximal de la rotation, en secondes : en rendu à la demande, la première image
 * après un repos arrive avec toute la durée du repos, et ferait sauter la vue.
 */
export const SLOW_SPIN_MAX_STEP_S = 0.1;
/** Durée d'un tour de rotation lente, en secondes (tools/captures/cadence.mjs en dépend). */
export const SLOW_SPIN_TURN_S = 60 / SLOW_SPIN_SPEED;

/**
 * `autoRotateSpeed` à donner à OrbitControls pour une image de `delta` secondes : l'angle suit le
 * temps, pas le nombre d'images (même vitesse à 43, 60 ou 120 i/s), pas borné après un repos.
 */
export function slowSpinSpeed(delta: number): number {
  return SLOW_SPIN_SPEED * CONTROLS_NOMINAL_FPS * spinStep(delta);
}

/** Amortissement des contrôles d'orbite à 60 images par seconde (`dampingFactor`). */
export const CONTROLS_DAMPING = 0.08;

/**
 * `dampingFactor` à donner à OrbitControls pour une image de `delta` secondes. L'amortissement
 * agit par image : à 1 i/s (rendu logiciel), l'élan d'un geste ou la fin de la rotation lente,
 * plus grande par image depuis que la rotation suit le temps, traînait une cinquantaine d'images,
 * soit près d'une minute. Réglé sur le temps, il s'éteint dans le même temps à toute cadence ;
 * à 60 i/s, il vaut 0,08 comme avant. L'élan total d'un geste ne change pas (somme de la série).
 */
export function controlsDamping(delta: number): number {
  const step = spinStep(delta);
  return step > 0 ? 1 - (1 - CONTROLS_DAMPING) ** (CONTROLS_NOMINAL_FPS * step) : CONTROLS_DAMPING;
}

function spinStep(delta: number): number {
  return Number.isFinite(delta) ? Math.min(Math.max(delta, 0), SLOW_SPIN_MAX_STEP_S) : 0;
}


// ───────────── Mesure comparée (« Comparer ») ─────────────

/** Variantes de la scène : chacune retire ou ajoute un seul coût. */
export type CompareVariant = 'trame' | 'sans-reflet' | 'sans-mobilier' | 'densite-1';
export type CompareId = 'courant' | CompareVariant;

export interface CompareStep {
  readonly id: CompareId;
  readonly label: string;
  /** Variante posée pendant cette mesure ; `null` : la scène telle quelle. */
  readonly variant: CompareVariant | null;
}

/**
 * Les cinq variantes : la scène telle quelle ; la trame du fondu posée sur tous les matériaux
 * opaques du décor, dans l'ordre de dessin actuel (véhicule d'abord, sol en dernier, depuis
 * 8dc262f) : ce n'est donc pas exactement l'état d'avant 8dc262f, qui dessinait dans l'ordre par
 * défaut et tramait aussi les voiles transparents ; sans reflet du sol (passe de réflexion planaire
 * et son define coupés) ; sans mobilier (objets, œuvres et ombres de contact cachés : le poids du
 * décor remodelé) ; densité de pixels 1 (l'image est-elle limitée par le nombre de pixels ?).
 */
export const COMPARE_STEPS: readonly CompareStep[] = [
  { id: 'courant', label: 'Réglage en cours', variant: null },
  { id: 'trame', label: 'Trame partout', variant: 'trame' },
  { id: 'sans-reflet', label: 'Sans reflet du sol', variant: 'sans-reflet' },
  { id: 'sans-mobilier', label: 'Sans mobilier', variant: 'sans-mobilier' },
  { id: 'densite-1', label: 'Densité 1', variant: 'densite-1' },
];

/** Objets du garage cachés par « Sans mobilier » (noms posés par src/scene/garage/build.ts). */
export const COMPARE_FURNITURE: readonly string[] = ['garage_mobilier', 'garage_oeuvres', 'garage_contact'];

/**
 * Ordre des fenêtres : les variantes à l'aller, puis à rebours au retour (A B C D E E D C B A).
 * Chaque variante passe deux fois, et ses deux passages encadrent le milieu de l'essai : une dérive
 * régulière (chauffe, fréquence du processeur ou de la carte) s'annule dans leur moyenne, et leur
 * écart dit le bruit de l'essai.
 */
export const COMPARE_ORDER: readonly number[] = [
  ...COMPARE_STEPS.map((_, step) => step),
  ...COMPARE_STEPS.map((_, step) => COMPARE_STEPS.length - 1 - step),
];


/**
 * Mise en train, avant la première fenêtre : la scène était à l'arrêt (panneau ouvert), processeur
 * et carte graphique ont baissé leur fréquence et remontent en une ou deux secondes.
 */
export const COMPARE_WARMUP_MS = 2500;
/** Temps de pose avant chaque fenêtre suivante, nuanceurs prêts (images écartées). */
export const COMPARE_SETTLE_MS = 500;
/**
 * Fenêtre de mesure d'un passage : cadence naturelle (intervalles entre images, l'écran et sa
 * synchronisation compris) et, sur les mêmes images, temps de carte (minuterie de la carte, qui ne
 * dépend pas de la synchronisation de l'écran).
 */
export const COMPARE_WINDOW_MS = 2500;
/** Images gardées au moins par fenêtre (rendu très lent : la fenêtre dure plus longtemps). */
export const COMPARE_MIN_FRAMES = 4;
/** Images à dessiner après la pose d'une variante avant de croire les nuanceurs prêts. */
export const COMPARE_PREPARE_FRAMES = 2;
/**
 * Au-delà, la variante n'est pas mesurée : elle ne finit pas de se préparer. Compté après les
 * premières images seulement : une compilation bloquante (première image d'une variante jamais
 * compilée, rendu logiciel) peut à elle seule durer plus longtemps.
 */
export const COMPARE_READY_TIMEOUT_MS = 30_000;
/** Reprises au plus d'une fenêtre (nuanceur compilé, écran retaillé, trame en préparation). */
export const COMPARE_MAX_RESTARTS = 3;
/** Images gardées au plus par fenêtre (2,5 s à 400 i/s) : tampons alloués une fois. */
export const COMPARE_CAPACITY = 1024;
/** Durée prévue de l'essai (plus quelques images de pose par fenêtre). */
export const COMPARE_PLANNED_MS = COMPARE_WARMUP_MS - COMPARE_SETTLE_MS + COMPARE_ORDER.length * (COMPARE_SETTLE_MS + COMPARE_WINDOW_MS);
/** Durée annoncée dans « Sous le capot », en secondes (une seconde pour les poses). */
export const COMPARE_ANNOUNCED_S = Math.ceil(COMPARE_PLANNED_MS / 1000) + 1;
/**
 * Trop de bruit pour conclure : le plus grand écart aller-retour dépasse cette part de la valeur
 * du réglage en cours (et au moins COMPARE_NOISE_FLOOR_MS).
 */
export const COMPARE_NOISE_SHARE = 0.1;
export const COMPARE_NOISE_FLOOR_MS = 0.5;
/** Au plafond de l'écran : la cadence atteint 97 % de celle de l'écran. */
export const COMPARE_CAP_MARGIN = 1 / 0.97;
/**
 * Rythmes d'écran reconnus (en ms) : 50 à 165 i/s. Un écran bridé plus bas (économie de batterie)
 * n'est pas reconnu, et aucune ligne n'est alors marquée « au plafond ».
 */
const SCREEN_MIN_MS = 1000 / 165;
const SCREEN_MAX_MS = 1000 / 50;
/** Part des intervalles qui doivent tomber sur un multiple du rythme, et tolérance (part du rythme). */
const SCREEN_FIT_SHARE = 0.9;
const SCREEN_FIT_TOLERANCE = 0.12;

/** Ce qui empêche de mesurer : programmes en compilation, écran retaillé, trame en préparation. */
export type CompareWait = 'programmes' | 'taille' | 'trame';

const RESTART_REASONS: Record<CompareWait, string> = {
  programmes: 'des nuanceurs se compilent sans arrêt pendant la mesure',
  taille: 'l’écran a changé de taille pendant la mesure (téléphone tourné ?), relance-la',
  trame: 'la trame du fondu se prépare encore, relance la mesure dans un moment',
};

const TIMEOUT_REASONS: Record<CompareWait, string> = {
  programmes: `nuanceurs pas prêts au bout de ${COMPARE_READY_TIMEOUT_MS / 1000} secondes`,
  taille: `densité 1 pas tenue au bout de ${COMPARE_READY_TIMEOUT_MS / 1000} secondes`,
  trame: `trame du fondu pas prête au bout de ${COMPARE_READY_TIMEOUT_MS / 1000} secondes`,
};

/** Résumé d'une fenêtre (un passage d'une variante). */
export interface CompareWindow {
  /** Intervalles mesurés. */
  frames: number;
  meanMs: number;
  /** Intervalle du pire centile. */
  worstMs: number;
  cpuMs: number;
  calls: number;
  triangles: number;
  /** Temps de carte médian par image (minuterie de la carte) ; `null` sans minuterie. */
  gpuMs: number | null;
  gpuFrames: number;
}

/** Résumé d'une variante : moyenne de ses deux passages, et leur écart. */
export interface CompareSummary {
  frames: number;
  /** Cadence moyenne (1000 / meanMs), en images par seconde. */
  fps: number;
  /** Temps moyen entre deux images, en millisecondes (moyenne des deux passages). */
  meanMs: number;
  /** Écart entre l'aller et le retour, en millisecondes. */
  gapMs: number;
  /** Pire centile : cadence que tiennent 99 % des images (le plus lent des deux passages). */
  worstFps: number;
  /** Temps moyen de calcul par image sur le processeur (fil principal), en millisecondes. */
  cpuMs: number;
  calls: number;
  triangles: number;
  /** Temps de carte par image (moyenne des deux passages) ; `null` sans minuterie de la carte. */
  gpuMs: number | null;
  gapGpuMs: number | null;
  gpuFrames: number;
  /** Valeurs de chaque passage (aller, retour), pour les essais. */
  passes: readonly [CompareWindow, CompareWindow];
}

export type CompareOutcome =
  | { id: CompareId; label: string; measured: true; summary: CompareSummary; programs: number }
  | { id: CompareId; label: string; measured: false; reason: string };

export type ComparePhase = 'prepare' | 'settle' | 'measure' | 'done';

/** Une image vue par la mesure comparée (objet réutilisé d'une image à l'autre). */
export interface CompareFrame {
  /** Instant de l'image (horodatage de l'image, calé sur le rythme de l'écran), en millisecondes. */
  now: number;
  /** Temps de calcul de l'image sur le fil principal, en millisecondes. */
  cpuMs: number;
  calls: number;
  triangles: number;
  /** Programmes de nuanceur vivants : s'il change, un nuanceur vient d'être compilé. */
  programs: number;
  /** Pixels du tampon d'affichage : s'il change, l'écran a changé de taille. */
  pixels: number;
  /** Tout est prêt : programmes compilés, aucun préchauffage en cours, variante bien posée. */
  ready: boolean;
  /** Ce qui manque quand `ready` est faux. */
  wait: CompareWait;
}

export function createCompareFrame(): CompareFrame {
  return { now: 0, cpuMs: 0, calls: 0, triangles: 0, programs: 0, pixels: 0, ready: false, wait: 'programmes' };
}

/** Raison de ne pas mesurer une variante dans l'état de la scène (`null` : mesurable). */
export type CompareSkip = (id: CompareId) => string | null;

export interface CompareRun {
  /** Rang de la fenêtre en cours dans COMPARE_ORDER (= sa longueur une fois fini). */
  slot: number;
  /** Variante de la fenêtre en cours (rang dans COMPARE_STEPS). */
  step: number;
  phase: ComparePhase;
  /** Variante à poser sur la scène en ce moment. */
  variant: CompareVariant | null;
  phaseStart: number;
  phaseFrames: number;
  /** Programmes vivants et pixels au début du temps de pose. */
  programs: number;
  pixels: number;
  /** Une fenêtre a déjà commencé : la mise en train est faite. */
  warmed: boolean;
  restarts: number;
  last: number;
  count: number;
  gpuCount: number;
  /** Numéro de la fenêtre (changé à chaque fenêtre et à chaque reprise) : les temps de carte arrivent en retard. */
  window: number;
  readonly ms: Float64Array;
  readonly cpu: Float64Array;
  readonly calls: Float64Array;
  readonly triangles: Float64Array;
  readonly gpu: Float64Array;
  /** Tampon de tri (médiane et centile, en fin de fenêtre). */
  readonly scratch: Float64Array;
  /** Intervalles de toutes les fenêtres, pour reconnaître le rythme de l'écran. */
  readonly rhythm: Float64Array;
  rhythmCount: number;
  /** Passages mesurés par variante : aller, retour. */
  readonly windows: Array<[CompareWindow | null, CompareWindow | null]>;
  /** Variantes écartées ou abandonnées, avec leur raison. */
  readonly dropped: Array<string | null>;
  /** Variantes finies (mesurées ou non), dans l'ordre de COMPARE_STEPS. */
  outcomes: CompareOutcome[];
  /** Intervalle de l'écran estimé à la fin (ms) ; `null` si son rythme n'est pas reconnu. */
  screenMs: number | null;
}

export function createCompareRun(capacity = COMPARE_CAPACITY): CompareRun {
  return {
    slot: COMPARE_ORDER.length,
    step: 0,
    phase: 'done',
    variant: null,
    phaseStart: 0,
    phaseFrames: 0,
    programs: 0,
    pixels: 0,
    warmed: false,
    restarts: 0,
    last: Number.NaN,
    count: 0,
    gpuCount: 0,
    window: 0,
    ms: new Float64Array(capacity),
    cpu: new Float64Array(capacity),
    calls: new Float64Array(capacity),
    triangles: new Float64Array(capacity),
    gpu: new Float64Array(capacity),
    scratch: new Float64Array(capacity),
    rhythm: new Float64Array(capacity * COMPARE_ORDER.length),
    rhythmCount: 0,
    windows: COMPARE_STEPS.map(() => [null, null]),
    dropped: COMPARE_STEPS.map(() => null),
    outcomes: [],
    screenMs: null,
  };
}

function enterPhase(run: CompareRun, phase: ComparePhase, now: number): void {
  run.phase = phase;
  run.phaseStart = now;
  run.phaseFrames = 0;
}

function clearWindow(run: CompareRun): void {
  run.count = 0;
  run.gpuCount = 0;
  run.window += 1;
}

/** Passe à la fenêtre de rang `slot`, en notant d'office les variantes que la scène ne permet pas. */
function enterSlot(run: CompareRun, slot: number, now: number, skip: CompareSkip): void {
  for (let s = slot; s < COMPARE_ORDER.length; s += 1) {
    const step = COMPARE_ORDER[s] as number;
    if (run.dropped[step] !== null) continue;
    const { id, label, variant } = COMPARE_STEPS[step] as CompareStep;
    // Demandé au premier passage seulement : au retour, la scène porte peut-être encore la
    // variante d'avant (« Densité 1 » deux fois de suite : le pixel ratio est déjà à 1).
    const reason = run.windows[step]?.[0] === null ? skip(id) : null;
    if (reason !== null) {
      drop(run, step, { id, label, measured: false, reason });
      continue;
    }
    run.slot = s;
    run.step = step;
    run.variant = variant;
    run.restarts = 0;
    clearWindow(run);
    enterPhase(run, 'prepare', now);
    return;
  }
  run.slot = COMPARE_ORDER.length;
  run.variant = null;
  run.screenMs = estimateScreen(run.rhythm, run.rhythmCount);
  enterPhase(run, 'done', now);
}

/** Range un résultat de variante à sa place (ordre de COMPARE_STEPS). Alloue (fin de variante). */
function finish(run: CompareRun, outcome: CompareOutcome): void {
  const rank = (id: CompareId) => COMPARE_STEPS.findIndex((step) => step.id === id);
  run.outcomes = [...run.outcomes, outcome].sort((a, b) => rank(a.id) - rank(b.id));
}

function drop(run: CompareRun, step: number, outcome: CompareOutcome & { measured: false }): void {
  run.dropped[step] = outcome.reason;
  finish(run, outcome);
}

/** Part de zéro : première fenêtre posée (ou variantes notées non mesurables), résultats vidés. */
export function startCompareRun(run: CompareRun, now: number, skip: CompareSkip): void {
  run.outcomes = [];
  run.warmed = false;
  run.last = now;
  run.rhythmCount = 0;
  run.screenMs = null;
  for (const pair of run.windows) pair.fill(null);
  run.dropped.fill(null);
  enterSlot(run, 0, now, skip);
}

function fail(run: CompareRun, now: number, skip: CompareSkip, reason: string): void {
  const { id, label } = COMPARE_STEPS[run.step] as CompareStep;
  drop(run, run.step, { id, label, measured: false, reason });
  enterSlot(run, run.slot + 1, now, skip);
}

function restart(run: CompareRun, now: number, skip: CompareSkip, cause: CompareWait): void {
  run.restarts += 1;
  if (run.restarts > COMPARE_MAX_RESTARTS) {
    fail(run, now, skip, RESTART_REASONS[cause]);
    return;
  }
  clearWindow(run);
  enterPhase(run, 'prepare', now);
}

/**
 * Temps de carte d'une image de la fenêtre `window` (minuterie de la carte, lu une à trois images
 * plus tard) ; ignoré si la fenêtre a changé ou recommencé depuis.
 */
export function recordGpu(run: CompareRun, window: number, ms: number): void {
  if (window !== run.window || run.phase !== 'measure' || !validMs(ms) || run.gpuCount >= run.gpu.length) return;
  run.gpu[run.gpuCount] = ms;
  run.gpuCount += 1;
}

/** Ce qui dérange la fenêtre en cours (`null` : rien). */
function disturbance(run: CompareRun, frame: CompareFrame): CompareWait | null {
  if (frame.programs !== run.programs) return 'programmes';
  if (frame.pixels !== run.pixels) return 'taille';
  return frame.ready ? null : frame.wait;
}

const hundredth = (value: number) => Math.round(value * 100) / 100;

/** Résumé de la fenêtre qui se ferme ; `null` sans intervalle exploitable. Alloue (fin de fenêtre). */
export function summarizeWindow(run: CompareRun): CompareWindow | null {
  let total = 0;
  let cpu = 0;
  let calls = 0;
  let triangles = 0;
  let n = 0;
  for (let i = 0; i < run.count; i += 1) {
    const ms = run.ms[i] ?? Number.NaN;
    if (!validMs(ms)) continue;
    run.scratch[n] = ms;
    n += 1;
    total += ms;
    cpu += run.cpu[i] ?? 0;
    calls += run.calls[i] ?? 0;
    triangles += run.triangles[i] ?? 0;
  }
  if (n === 0) return null;
  const worstMs = percentile(run.scratch.subarray(0, n).sort(), 0.99);
  let gpuMs: number | null = null;
  if (run.gpuCount > 0) {
    const gpu = run.scratch.subarray(0, run.gpuCount);
    gpu.set(run.gpu.subarray(0, run.gpuCount));
    gpuMs = percentile(gpu.sort(), 0.5);
  }
  return { frames: n, meanMs: total / n, worstMs, cpuMs: cpu / n, calls: calls / n, triangles: triangles / n, gpuMs, gpuFrames: run.gpuCount };
}

/** Résumé d'une variante d'après ses deux passages. */
export function combinePasses(first: CompareWindow, second: CompareWindow): CompareSummary {
  const meanMs = (first.meanMs + second.meanMs) / 2;
  const both = first.gpuMs !== null && second.gpuMs !== null;
  return {
    frames: first.frames + second.frames,
    fps: tenth(1000 / meanMs),
    meanMs: hundredth(meanMs),
    gapMs: hundredth(Math.abs(first.meanMs - second.meanMs)),
    worstFps: tenth(1000 / Math.max(first.worstMs, second.worstMs)),
    cpuMs: hundredth((first.cpuMs + second.cpuMs) / 2),
    calls: Math.round((first.calls + second.calls) / 2),
    triangles: Math.round((first.triangles + second.triangles) / 2),
    gpuMs: both ? hundredth(((first.gpuMs ?? 0) + (second.gpuMs ?? 0)) / 2) : null,
    gapGpuMs: both ? hundredth(Math.abs((first.gpuMs ?? 0) - (second.gpuMs ?? 0))) : null,
    gpuFrames: first.gpuFrames + second.gpuFrames,
    passes: [first, second],
  };
}

function closeWindow(run: CompareRun, now: number, skip: CompareSkip): void {
  const summary = summarizeWindow(run);
  if (summary === null) {
    fail(run, now, skip, 'aucune image mesurée');
    return;
  }
  const pair = run.windows[run.step] as [CompareWindow | null, CompareWindow | null];
  const first = pair[0];
  if (first === null) pair[0] = summary;
  else {
    pair[1] = summary;
    const { id, label } = COMPARE_STEPS[run.step] as CompareStep;
    finish(run, { id, label, measured: true, summary: combinePasses(first, summary), programs: run.programs });
  }
  enterSlot(run, run.slot + 1, now, skip);
}

/**
 * Une image de la mesure comparée. Pour chaque fenêtre (COMPARE_ORDER) : pose de la variante
 * (nuanceurs prêts, au moins COMPARE_PREPARE_FRAMES images), temps de pose (la première fois, la
 * mise en train ; images écartées), puis fenêtre de mesure (COMPARE_WINDOW_MS ; les temps de carte
 * arrivent à part, par recordGpu). Un nuanceur compilé, un écran retaillé ou une variante dérangée
 * la font recommencer : on ne mesure jamais une compilation. Aucune allocation hors des fins de
 * fenêtre. Rend `run.phase` (« done » : tout est mesuré, `run.variant` revenu à `null`, rythme de
 * l'écran estimé).
 */
export function stepCompare(run: CompareRun, frame: CompareFrame, skip: CompareSkip): ComparePhase {
  const interval = frame.now - run.last;
  run.last = frame.now;
  run.phaseFrames += 1;
  const elapsed = frame.now - run.phaseStart;
  switch (run.phase) {
    case 'prepare': {
      if (run.phaseFrames > COMPARE_PREPARE_FRAMES && frame.ready) {
        enterPhase(run, 'settle', frame.now);
        run.programs = frame.programs;
        run.pixels = frame.pixels;
      } else if (!frame.ready && run.phaseFrames > COMPARE_PREPARE_FRAMES && elapsed > COMPARE_READY_TIMEOUT_MS) {
        fail(run, frame.now, skip, TIMEOUT_REASONS[frame.wait]);
      }
      break;
    }
    case 'settle': {
      const cause = disturbance(run, frame);
      if (cause !== null) restart(run, frame.now, skip, cause);
      else if (elapsed >= (run.warmed ? COMPARE_SETTLE_MS : COMPARE_WARMUP_MS)) {
        run.warmed = true;
        enterPhase(run, 'measure', frame.now);
      }
      break;
    }
    case 'measure': {
      const cause = disturbance(run, frame);
      if (cause !== null) {
        restart(run, frame.now, skip, cause);
        break;
      }
      const i = run.count;
      run.ms[i] = interval;
      run.cpu[i] = frame.cpuMs;
      run.calls[i] = frame.calls;
      run.triangles[i] = frame.triangles;
      run.count = i + 1;
      if (run.rhythmCount < run.rhythm.length && validMs(interval)) {
        run.rhythm[run.rhythmCount] = interval;
        run.rhythmCount += 1;
      }
      if ((elapsed >= COMPARE_WINDOW_MS && run.count >= COMPARE_MIN_FRAMES) || run.count >= run.ms.length) closeWindow(run, frame.now, skip);
      break;
    }
    case 'done':
      break;
  }
  return run.phase;
}

/** Part des intervalles qui tombent sur un multiple de `period` (au moins une période). */
function fitShare(intervals: ArrayLike<number>, period: number): number {
  let fit = 0;
  for (let i = 0; i < intervals.length; i += 1) {
    const turns = (intervals[i] ?? 0) / period;
    const nearest = Math.round(turns);
    if (nearest >= 1 && Math.abs(turns - nearest) <= SCREEN_FIT_TOLERANCE) fit += 1;
  }
  return fit / intervals.length;
}

/**
 * Intervalle de rafraîchissement de l'écran, d'après les intervalles entre images (horodatages de
 * l'image, calés sur l'écran) : chaque intervalle vaut un nombre entier de périodes. On part du plus
 * court (5ᵉ centile) et de ses moitié et tiers (images qui sautent une période sur deux : 16,7 et
 * 25 ms à 120 i/s), plus les rythmes courants ; on garde la plus longue période (50 à 165 i/s) dont
 * 90 % des intervalles sont des multiples. `null` : rythme pas reconnu (rendu très lent ou irrégulier).
 */
export function estimateScreen(intervals: Float64Array, count: number): number | null {
  if (count < COMPARE_MIN_FRAMES) return null;
  const sorted = Float64Array.from(intervals.subarray(0, count)).sort();
  const shortest = percentile(sorted, 0.05);
  const candidates = [shortest, shortest / 2, shortest / 3, 1000 / 60, 1000 / 90, 1000 / 120, 1000 / 144]
    .filter((period) => period >= SCREEN_MIN_MS && period <= SCREEN_MAX_MS && period <= shortest * 1.03)
    .sort((a, b) => b - a);
  for (const period of candidates) if (fitShare(sorted, period) >= SCREEN_FIT_SHARE) return period;
  return null;
}

/** La cadence de cette variante atteint celle de l'écran : elle ne dit rien de la carte. */
export function atScreenCap(summary: Pick<CompareSummary, 'meanMs'>, screenMs: number | null): boolean {
  return screenMs !== null && summary.meanMs <= screenMs * COMPARE_CAP_MARGIN;
}

/** Lecture d'une comparaison : son bruit, et s'il faut la refaire. */
export interface CompareReading {
  /** Plus grand écart aller-retour d'une même variante : cadence, puis temps de carte (ms). */
  noiseMs: number | null;
  noiseGpuMs: number | null;
  /** Trop de bruit pour conclure (ou réglage en cours pas mesuré) : refaire l'essai. */
  redo: boolean;
}

const tooNoisy = (noise: number | null, reference: number | null) =>
  noise !== null && reference !== null && noise > Math.max(COMPARE_NOISE_FLOOR_MS, COMPARE_NOISE_SHARE * reference);

export function readCompare(outcomes: readonly CompareOutcome[], screenMs: number | null): CompareReading {
  let noiseMs: number | null = null;
  let noiseGpuMs: number | null = null;
  for (const outcome of outcomes) {
    if (!outcome.measured) continue;
    const { gapMs, gapGpuMs } = outcome.summary;
    noiseMs = Math.max(noiseMs ?? 0, gapMs);
    if (gapGpuMs !== null) noiseGpuMs = Math.max(noiseGpuMs ?? 0, gapGpuMs);
  }
  const base = outcomes.find((outcome) => outcome.id === 'courant');
  if (!base?.measured) return { noiseMs, noiseGpuMs, redo: true };
  const { summary } = base;
  // Au plafond de l'écran, la cadence du réglage en cours ne départage rien : la carte, si.
  const cadenceNoisy = !atScreenCap(summary, screenMs) && tooNoisy(noiseMs, summary.meanMs);
  return { noiseMs, noiseGpuMs, redo: cadenceNoisy || tooNoisy(noiseGpuMs, summary.gpuMs) };
}

/** L'écart à la référence ne dépasse pas le bruit de l'essai. */
export function inNoise(delta: number, noise: number | null): boolean {
  return noise !== null && Math.abs(delta) <= noise;
}
