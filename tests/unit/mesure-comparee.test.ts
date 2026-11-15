import { describe, expect, it } from 'vitest';
import {
  COMPARE_MAX_RESTARTS,
  COMPARE_PREPARE_FRAMES,
  COMPARE_READY_TIMEOUT_MS,
  COMPARE_SETTLE_MS,
  COMPARE_STEPS,
  COMPARE_WARMUP_MS,
  COMPARE_WINDOW_MS,
  createCompareFrame,
  createCompareRun,
  SLOW_SPIN_MAX_STEP_S,
  SLOW_SPIN_TURN_S,
  slowSpinSpeed,
  controlsDamping,
  CONTROLS_DAMPING,
  startCompareRun,
  stepCompare,
  type CompareFrame,
  type CompareId,
  type CompareRun,
  type CompareSkip,
  type CompareVariant,
} from '../../src/render/frameMeter.ts';

// « Comparer » dans « Sous le capot » (src/render/frameMeter.ts) : quatre mesures d'affilée, une
// variante de la scène chacune ; et la rotation lente réglée au temps.

const all: CompareSkip = () => null;

interface Scene {
  /** Durée d'une image selon la variante posée, en millisecondes. */
  ms: (variant: CompareVariant | null, frame: number) => number;
  ready?: (variant: CompareVariant | null, sinceStart: number) => boolean;
  programs?: (variant: CompareVariant | null, frame: number) => number;
}

/** Fait tourner la machine jusqu'au bout (ou `limit` images) ; relève les variantes posées. */
function drive(run: CompareRun, scene: Scene, skip: CompareSkip = all, limit = 100_000) {
  const frame: CompareFrame = createCompareFrame();
  const variants: Array<CompareVariant | null> = [];
  let now = 1000;
  startCompareRun(run, now, skip);
  variants.push(run.variant);
  const start = now;
  let frames = 0;
  while (run.phase !== 'done' && frames < limit) {
    now += scene.ms(run.variant, frames);
    frames += 1;
    frame.now = now;
    frame.cpuMs = 3;
    frame.calls = run.variant === 'sans-reflet' ? 100 : 140;
    frame.triangles = 500_000;
    frame.programs = scene.programs?.(run.variant, frames) ?? 58;
    frame.ready = scene.ready?.(run.variant, now - start) ?? true;
    stepCompare(run, frame, skip);
    if (variants.at(-1) !== run.variant) variants.push(run.variant);
  }
  return { variants, duration: now - start, frames };
}

const byId = (run: CompareRun, id: CompareId) => run.outcomes.find((outcome) => outcome.id === id);

describe('mesure comparée : enchaînement', () => {
  it('quatre mesures dans l’ordre, chaque variante posée puis retirée, une vingtaine de secondes', () => {
    const run = createCompareRun();
    const { variants, duration } = drive(run, { ms: () => 1000 / 60 });
    expect(variants).toEqual([null, 'trame', 'sans-reflet', 'densite-1', null]);
    expect(run.outcomes.map((outcome) => outcome.id)).toEqual(COMPARE_STEPS.map((step) => step.id));
    expect(run.outcomes.every((outcome) => outcome.measured)).toBe(true);
    // Pose (quelques images), temps de pose (mise en train la première fois) et fenêtre, quatre fois.
    const planned = COMPARE_WARMUP_MS + 3 * COMPARE_SETTLE_MS + 4 * COMPARE_WINDOW_MS;
    expect(duration).toBeGreaterThanOrEqual(planned);
    expect(duration).toBeLessThan(planned + 4 * 200);
    expect(duration / 1000).toBeGreaterThan(18);
    expect(duration / 1000).toBeLessThan(22);
  });

  it('chaque résultat dit la cadence, le temps moyen, le pire centile et le coût de sa variante', () => {
    const run = createCompareRun();
    const cost: Record<string, number> = { courant: 23, trame: 25, 'sans-reflet': 16, 'densite-1': 12 };
    drive(run, { ms: (variant, frame) => (variant === null && frame % 50 === 0 ? 40 : cost[variant ?? 'courant'] ?? 0) });
    const current = byId(run, 'courant');
    const plain = byId(run, 'sans-reflet');
    expect(current?.measured && current.summary.meanMs).toBeGreaterThan(23);
    expect(current?.measured && current.summary.worstFps).toBe(25);
    expect(current?.measured && current.programs).toBe(58);
    expect(current?.measured && current.summary.cpuMs).toBe(3);
    expect(plain?.measured && plain.summary.fps).toBeCloseTo(62.5, 1);
    expect(plain?.measured && plain.summary.meanMs).toBe(16);
    expect(plain?.measured && plain.summary.calls).toBe(100);
    const dense = byId(run, 'densite-1');
    expect(dense?.measured && dense.summary.frames).toBeGreaterThanOrEqual(Math.floor(COMPARE_WINDOW_MS / 12));
  });

  it('attend que les nuanceurs soient prêts avant le temps de pose, puis écarte la pose', () => {
    const run = createCompareRun();
    let readyAt = Number.NaN;
    drive(run, {
      // La trame se compile pendant une seconde : images lentes, programmes pas prêts.
      ms: (variant) => (variant === 'trame' && Number.isNaN(readyAt) ? 300 : 20),
      ready: (variant, t) => {
        if (variant !== 'trame') return true;
        if (Number.isNaN(readyAt)) readyAt = t + 1000;
        return t >= readyAt;
      },
    });
    const dither = byId(run, 'trame');
    expect(dither?.measured).toBe(true);
    // Aucune image de compilation (300 ms) dans la fenêtre.
    expect(dither?.measured && dither.summary.worstFps).toBe(50);
  });

  it('un nuanceur compilé pendant la fenêtre la fait recommencer : la compilation n’est jamais mesurée', () => {
    const run = createCompareRun();
    let programs = 58;
    let compiled = false;
    const seen: number[] = [];
    drive(run, {
      ms: (variant) => {
        // Au milieu de la fenêtre de « Sans reflet du sol », une image de 500 ms et un programme de plus.
        if (variant === 'sans-reflet' && run.phase === 'measure' && run.count === 100 && !compiled) {
          compiled = true;
          programs += 1;
          return 500;
        }
        return 16;
      },
      programs: () => {
        seen.push(programs);
        return programs;
      },
    });
    const plain = byId(run, 'sans-reflet');
    expect(compiled).toBe(true);
    expect(plain?.measured && plain.summary.worstFps).toBe(62.5);
    expect(plain?.measured && plain.programs).toBe(59);
  });

  it('une variante que la scène ne permet pas est notée « non mesurée » avec sa raison, sans attente', () => {
    const run = createCompareRun();
    const skip: CompareSkip = (id) => (id === 'sans-reflet' ? 'pas de reflet du sol à ce niveau' : id === 'densite-1' ? 'déjà en densité 1' : null);
    const { variants, duration } = drive(run, { ms: () => 16 }, skip);
    expect(variants).toEqual([null, 'trame', null]);
    expect(byId(run, 'sans-reflet')).toEqual({ id: 'sans-reflet', label: 'Sans reflet du sol', measured: false, reason: 'pas de reflet du sol à ce niveau' });
    expect(byId(run, 'densite-1')?.measured).toBe(false);
    expect(run.outcomes.map((outcome) => outcome.id)).toEqual(['courant', 'trame', 'sans-reflet', 'densite-1']);
    expect(duration).toBeLessThan(COMPARE_WARMUP_MS + COMPARE_SETTLE_MS + 2 * COMPARE_WINDOW_MS + 400);
  });

  it('nuanceurs jamais prêts : la variante est abandonnée au bout du délai, la suite continue', () => {
    const run = createCompareRun();
    const { variants } = drive(run, { ms: () => 50, ready: (variant) => variant !== 'trame' });
    expect(variants).toEqual([null, 'trame', 'sans-reflet', 'densite-1', null]);
    const dither = byId(run, 'trame');
    expect(dither?.measured).toBe(false);
    expect(dither?.measured === false && dither.reason).toMatch(new RegExp(`${COMPARE_READY_TIMEOUT_MS / 1000} secondes`));
    expect(byId(run, 'densite-1')?.measured).toBe(true);
  });

  it('des compilations sans fin : la variante n’est pas mesurée après quelques reprises', () => {
    const run = createCompareRun();
    let programs = 58;
    drive(run, {
      ms: () => 16,
      programs: (variant, frame) => (variant === 'densite-1' && frame % 40 === 0 ? (programs += 1) : programs),
    });
    const dense = byId(run, 'densite-1');
    expect(dense?.measured).toBe(false);
    expect(dense?.measured === false && dense.reason).toMatch(/compilent/);
    expect(run.restarts).toBe(COMPARE_MAX_RESTARTS + 1);
  });

  it('une première image de compilation plus longue que le délai n’abandonne pas la variante', () => {
    const run = createCompareRun();
    let first = true;
    drive(run, {
      ms: (variant) => {
        if (variant === 'trame' && first) {
          first = false;
          return COMPARE_READY_TIMEOUT_MS + 5000;
        }
        return 20;
      },
    });
    const dither = byId(run, 'trame');
    expect(dither?.measured).toBe(true);
    expect(dither?.measured && dither.summary.worstFps).toBe(50);
  });

  it('la première mesure attend la mise en train, les suivantes le temps de pose ordinaire', () => {
    const run = createCompareRun();
    const starts: number[] = [];
    let previous = run.phase;
    let now = 0;
    const frame = createCompareFrame();
    startCompareRun(run, now, all);
    frame.ready = true;
    while (run.phase !== 'done') {
      const before = run.phaseStart;
      stepCompare(run, Object.assign(frame, { now: (now += 10) }), all);
      if (previous === 'settle' && run.phase === 'measure') starts.push(now - before);
      previous = run.phase;
    }
    expect(starts).toHaveLength(4);
    expect(starts[0]).toBeGreaterThanOrEqual(COMPARE_WARMUP_MS);
    expect(starts[0]).toBeLessThan(COMPARE_WARMUP_MS + 20);
    for (const settle of starts.slice(1)) {
      expect(settle).toBeGreaterThanOrEqual(COMPARE_SETTLE_MS);
      expect(settle).toBeLessThan(COMPARE_SETTLE_MS + 20);
    }
  });

  it('la pose dure au moins quelques images, même si tout paraît prêt d’emblée', () => {
    const run = createCompareRun();
    const frame = createCompareFrame();
    startCompareRun(run, 0, all);
    frame.ready = true;
    for (let i = 1; i <= COMPARE_PREPARE_FRAMES; i += 1) {
      frame.now = i * 16;
      expect(stepCompare(run, frame, all)).toBe('prepare');
    }
    frame.now += 16;
    expect(stepCompare(run, frame, all)).toBe('settle');
  });

  it('tampons pleins : la fenêtre se ferme plus tôt, sans déborder', () => {
    const run = createCompareRun(64);
    drive(run, { ms: () => 1 });
    for (const outcome of run.outcomes) expect(outcome.measured && outcome.summary.frames).toBe(64);
  });

  it('pendant la fenêtre, les tampons et la liste des résultats restent les mêmes objets', () => {
    const run = createCompareRun();
    const { ms, outcomes } = { ms: run.ms, outcomes: run.outcomes };
    const frame = createCompareFrame();
    startCompareRun(run, 0, all);
    const list = run.outcomes;
    frame.ready = true;
    let now = 0;
    while (run.phase !== 'measure') stepCompare(run, Object.assign(frame, { now: (now += 16) }), all);
    for (let i = 0; i < 100; i += 1) stepCompare(run, Object.assign(frame, { now: (now += 16) }), all);
    expect(run.ms).toBe(ms);
    expect(run.outcomes).toBe(list);
    expect(outcomes).not.toBe(list);
    expect(run.count).toBe(100);
  });
});

describe('rotation lente au temps', () => {
  it('à 60 images par seconde, la vitesse d’origine (0,9) : un tour en 66,7 s', () => {
    expect(slowSpinSpeed(1 / 60)).toBeCloseTo(0.9, 10);
    expect(SLOW_SPIN_TURN_S).toBeCloseTo(66.67, 2);
  });

  it('même vitesse angulaire à 43, 60 et 120 images par seconde', () => {
    // OrbitControls avance de 2π/3600 × autoRotateSpeed par image.
    const angle = (fps: number, seconds: number) => {
      let total = 0;
      for (let i = 0; i < Math.round(fps * seconds); i += 1) total += ((2 * Math.PI) / 3600) * slowSpinSpeed(1 / fps);
      return total;
    };
    for (const fps of [43, 60, 120]) expect(angle(fps, SLOW_SPIN_TURN_S)).toBeCloseTo(2 * Math.PI, 2);
  });

  it('pas borné après un repos du rendu à la demande ; temps absurde : immobile', () => {
    expect(slowSpinSpeed(12)).toBeCloseTo(slowSpinSpeed(SLOW_SPIN_MAX_STEP_S), 10);
    expect(slowSpinSpeed(Number.NaN)).toBe(0);
    expect(slowSpinSpeed(-1)).toBe(0);
  });

  /**
   * Boucle d'OrbitControls (three-stdlib) réduite à l'azimut : la rotation lente ajoute son angle
   * à l'élan, qui est appliqué puis amorti par image ; l'image n'est redemandée que si la caméra
   * bouge de plus de 1e-3 m (EPS = 1e-6 sur la distance au carré ; caméra à 6 m). Rend le nombre
   * d'images et la durée de la traîne après l'arrêt de la rotation.
   */
  function tail(fps: number, damping: (delta: number) => number, speed: (delta: number) => number) {
    const dt = 1 / fps;
    let inertia = 0;
    for (let i = 0; i < fps * 20; i += 1) {
      inertia += ((2 * Math.PI) / 3600) * speed(dt);
      inertia *= 1 - damping(dt);
    }
    let frames = 0;
    for (;;) {
      const applied = inertia * damping(dt);
      inertia *= 1 - damping(dt);
      if (applied * 6 <= 1e-3) break;
      frames += 1;
    }
    return { frames, seconds: frames * dt };
  }

  it('amortissement au temps : 0,08 à 60 i/s ; la fin de la rotation lente s’éteint dans le même temps à toute cadence', () => {
    expect(controlsDamping(1 / 60)).toBeCloseTo(CONTROLS_DAMPING, 10);
    expect(controlsDamping(Number.NaN)).toBe(CONTROLS_DAMPING);
    expect(controlsDamping(12)).toBeCloseTo(controlsDamping(SLOW_SPIN_MAX_STEP_S), 10);
    // Amortissement par image (avant) : à 1 i/s, une cinquantaine d'images, près d'une minute.
    const perFrame = tail(1, () => CONTROLS_DAMPING, slowSpinSpeed);
    expect(perFrame.frames).toBeGreaterThan(40);
    expect(perFrame.seconds).toBeGreaterThan(40);
    // Au temps : à 60 i/s, la même traîne qu'avant (0,6 s) ; à 30 et 10 i/s, une seconde au plus
    // (le seuil d'arrêt est par image : une image plus longue bouge plus).
    // Sous 10 i/s, le pas est borné à 0,1 s (rotation et amortissement ralentissent ensemble) :
    // la traîne garde le nombre d'images de 10 i/s, une dizaine au plus.
    const at60 = tail(60, controlsDamping, slowSpinSpeed);
    expect(at60).toEqual(tail(60, () => CONTROLS_DAMPING, slowSpinSpeed));
    expect(at60.seconds).toBeLessThan(1);
    for (const fps of [30, 10]) expect(tail(fps, controlsDamping, slowSpinSpeed).seconds, `${fps} i/s`).toBeLessThanOrEqual(1);
    const at10 = tail(10, controlsDamping, slowSpinSpeed).frames;
    for (const fps of [3, 1]) expect(tail(fps, controlsDamping, slowSpinSpeed).frames, `${fps} i/s`).toBe(at10);
    expect(at10).toBeLessThanOrEqual(12);
  });
});
