// Mesures de cadence pour la recette sur téléphone (« Sous le capot ») : « Mesurer » (la scène
// tourne cinq secondes) et « Comparer » (quatre mesures d'affilée, une variante de la scène
// chacune, pour savoir sur le téléphone même où part le temps d'une image). Module pur : les
// images arrivent de src/scene/FrameMeter.tsx, les variantes se posent dans la scène.
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
export type CompareVariant = 'trame' | 'sans-reflet' | 'densite-1';
export type CompareId = 'courant' | CompareVariant;

export interface CompareStep {
  readonly id: CompareId;
  readonly label: string;
  /** Variante posée pendant cette mesure ; `null` : la scène telle quelle. */
  readonly variant: CompareVariant | null;
}

/**
 * Les quatre mesures, dans l'ordre : la scène telle quelle ; la trame du fondu compilée dans tous
 * les matériaux opaques du décor (comportement d'avant 8dc262f : rejet de fragments partout) ; sans
 * reflet du sol (passe de réflexion planaire et son define coupés) ; densité de pixels 1 (l'image
 * est-elle limitée par le nombre de pixels, ou par la géométrie et le processeur ?).
 */
export const COMPARE_STEPS: readonly CompareStep[] = [
  { id: 'courant', label: 'Réglage en cours', variant: null },
  { id: 'trame', label: 'Trame partout', variant: 'trame' },
  { id: 'sans-reflet', label: 'Sans reflet du sol', variant: 'sans-reflet' },
  { id: 'densite-1', label: 'Densité 1', variant: 'densite-1' },
];

/** Temps de pose après les nuanceurs prêts, avant la fenêtre de mesure (images écartées). */
export const COMPARE_SETTLE_MS = 800;
/**
 * Temps de pose de la première mesure : la scène était à l'arrêt (panneau ouvert), processeur et
 * carte graphique ont baissé leur fréquence et remontent en une ou deux secondes. Sans cette mise
 * en train, la première mesure (« Réglage en cours ») sortait plus lente que la suivante, sur la
 * carte du poste comme ailleurs.
 */
export const COMPARE_WARMUP_MS = 2500;
/** Fenêtre de mesure de chaque variante. */
export const COMPARE_WINDOW_MS = 4000;
/** Images à dessiner après la pose d'une variante avant de croire les nuanceurs prêts. */
export const COMPARE_PREPARE_FRAMES = 2;
/**
 * Au-delà, la variante n'est pas mesurée : ses nuanceurs ne finissent pas de se préparer. Compté
 * après les premières images seulement : une compilation bloquante (première image d'une variante
 * jamais compilée, rendu logiciel) peut à elle seule durer plus longtemps.
 */
export const COMPARE_READY_TIMEOUT_MS = 30_000;
/** Fenêtres recommencées au plus (un nuanceur compilé en cours de pose ou de mesure). */
export const COMPARE_MAX_RESTARTS = 3;
/** Images gardées au plus par fenêtre (4 s à 500 i/s) : tampons alloués une fois. */
export const COMPARE_CAPACITY = 2048;

/** Résumé d'une variante : comme « Mesurer », plus le temps passé sur le fil principal. */
export interface CompareSummary extends MeterSummary {
  /** Temps moyen de calcul par image sur le processeur (fil principal), en millisecondes. */
  cpuMs: number;
}

export type CompareOutcome =
  | { id: CompareId; label: string; measured: true; summary: CompareSummary; programs: number }
  | { id: CompareId; label: string; measured: false; reason: string };

export type ComparePhase = 'prepare' | 'settle' | 'measure' | 'done';

/** Une image vue par la mesure comparée (objet réutilisé d'une image à l'autre). */
export interface CompareFrame {
  /** Instant de l'image, en millisecondes. */
  now: number;
  /** Temps de calcul de l'image sur le fil principal, en millisecondes. */
  cpuMs: number;
  calls: number;
  triangles: number;
  /** Programmes de nuanceur vivants : s'il change, un nuanceur vient d'être compilé. */
  programs: number;
  /** Tout est prêt : programmes compilés, aucun préchauffage en cours, variante bien posée. */
  ready: boolean;
}

export function createCompareFrame(): CompareFrame {
  return { now: 0, cpuMs: 0, calls: 0, triangles: 0, programs: 0, ready: false };
}

/** Raison de ne pas mesurer une variante dans l'état de la scène (`null` : mesurable). */
export type CompareSkip = (id: CompareId) => string | null;

export interface CompareRun {
  /** Rang de la mesure en cours dans COMPARE_STEPS (= leur nombre une fois fini). */
  step: number;
  phase: ComparePhase;
  /** Variante à poser sur la scène en ce moment. */
  variant: CompareVariant | null;
  phaseStart: number;
  phaseFrames: number;
  /** Programmes vivants au début de la pose. */
  programs: number;
  /** Une fenêtre a déjà commencé : la mise en train est faite. */
  warmed: boolean;
  restarts: number;
  last: number;
  count: number;
  readonly ms: Float64Array;
  readonly cpu: Float64Array;
  readonly calls: Float64Array;
  readonly triangles: Float64Array;
  outcomes: CompareOutcome[];
}

export function createCompareRun(capacity = COMPARE_CAPACITY): CompareRun {
  return {
    step: COMPARE_STEPS.length,
    phase: 'done',
    variant: null,
    phaseStart: 0,
    phaseFrames: 0,
    programs: 0,
    warmed: false,
    restarts: 0,
    last: Number.NaN,
    count: 0,
    ms: new Float64Array(capacity),
    cpu: new Float64Array(capacity),
    calls: new Float64Array(capacity),
    triangles: new Float64Array(capacity),
    outcomes: [],
  };
}

function enterPhase(run: CompareRun, phase: ComparePhase, now: number): void {
  run.phase = phase;
  run.phaseStart = now;
  run.phaseFrames = 0;
  run.count = 0;
}

/** Passe à la mesure de rang `step`, en notant d'office celles que la scène ne permet pas. */
function enterStep(run: CompareRun, step: number, now: number, skip: CompareSkip): void {
  for (let s = step; s < COMPARE_STEPS.length; s += 1) {
    const { id, label, variant } = COMPARE_STEPS[s] as CompareStep;
    const reason = skip(id);
    if (reason !== null) {
      run.outcomes.push({ id, label, measured: false, reason });
      continue;
    }
    run.step = s;
    run.variant = variant;
    run.restarts = 0;
    enterPhase(run, 'prepare', now);
    return;
  }
  run.step = COMPARE_STEPS.length;
  run.variant = null;
  enterPhase(run, 'done', now);
}

/** Part de zéro : première mesure posée (ou notée non mesurable), résultats vidés. */
export function startCompareRun(run: CompareRun, now: number, skip: CompareSkip): void {
  run.outcomes = [];
  run.warmed = false;
  run.last = now;
  enterStep(run, 0, now, skip);
}

function closeStep(run: CompareRun, now: number, skip: CompareSkip, outcome: CompareOutcome): void {
  run.outcomes.push(outcome);
  enterStep(run, run.step + 1, now, skip);
}

function restart(run: CompareRun, now: number, skip: CompareSkip): void {
  const { id, label } = COMPARE_STEPS[run.step] as CompareStep;
  run.restarts += 1;
  if (run.restarts > COMPARE_MAX_RESTARTS) {
    closeStep(run, now, skip, { id, label, measured: false, reason: 'des nuanceurs se compilent sans arrêt pendant la mesure' });
    return;
  }
  enterPhase(run, 'prepare', now);
}

/** Résumé des images de la fenêtre ; `null` sans image exploitable. Alloue (fin de fenêtre seulement). */
export function summarizeWindow(run: CompareRun): CompareSummary | null {
  const sorted: number[] = [];
  let total = 0;
  let cpu = 0;
  let calls = 0;
  let triangles = 0;
  for (let i = 0; i < run.count; i += 1) {
    const ms = run.ms[i] ?? Number.NaN;
    if (!validMs(ms)) continue;
    sorted.push(ms);
    total += ms;
    cpu += run.cpu[i] ?? 0;
    calls += run.calls[i] ?? 0;
    triangles += run.triangles[i] ?? 0;
  }
  const n = sorted.length;
  if (n === 0) return null;
  sorted.sort((a, b) => a - b);
  return { ...summarize(sorted, total, calls / n, triangles / n), cpuMs: tenth(cpu / n) };
}

/**
 * Une image de la mesure comparée. Pour chaque variante : pose (attendre que les nuanceurs soient
 * prêts, au moins COMPARE_PREPARE_FRAMES images), temps de pose (COMPARE_SETTLE_MS, la première
 * fois COMPARE_WARMUP_MS ; images écartées), puis fenêtre de mesure (COMPARE_WINDOW_MS). Un nuanceur compilé ou une variante
 * dérangée pendant la pose ou la fenêtre la fait recommencer : on ne mesure jamais une compilation.
 * Aucune allocation hors des changements d'étape. Rend `run.phase` (« done » : tout est mesuré,
 * `run.variant` revenu à `null`).
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
      } else if (run.phaseFrames > COMPARE_PREPARE_FRAMES && elapsed > COMPARE_READY_TIMEOUT_MS) {
        const { id, label } = COMPARE_STEPS[run.step] as CompareStep;
        closeStep(run, frame.now, skip, {
          id,
          label,
          measured: false,
          reason: `nuanceurs pas prêts au bout de ${COMPARE_READY_TIMEOUT_MS / 1000} secondes`,
        });
      }
      break;
    }
    case 'settle': {
      if (!frame.ready || frame.programs !== run.programs) restart(run, frame.now, skip);
      else if (elapsed >= (run.warmed ? COMPARE_SETTLE_MS : COMPARE_WARMUP_MS)) {
        run.warmed = true;
        enterPhase(run, 'measure', frame.now);
      }
      break;
    }
    case 'measure': {
      if (!frame.ready || frame.programs !== run.programs) {
        restart(run, frame.now, skip);
        break;
      }
      const i = run.count;
      run.ms[i] = interval;
      run.cpu[i] = frame.cpuMs;
      run.calls[i] = frame.calls;
      run.triangles[i] = frame.triangles;
      run.count = i + 1;
      if (elapsed >= COMPARE_WINDOW_MS || run.count >= run.ms.length) {
        const { id, label } = COMPARE_STEPS[run.step] as CompareStep;
        const summary = summarizeWindow(run);
        closeStep(
          run,
          frame.now,
          skip,
          summary ? { id, label, measured: true, summary, programs: run.programs } : { id, label, measured: false, reason: 'aucune image mesurée' },
        );
      }
      break;
    }
    case 'done':
      break;
  }
  return run.phase;
}
