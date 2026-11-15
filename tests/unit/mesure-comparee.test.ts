import { describe, expect, it } from 'vitest';
import {
  atScreenCap,
  COMPARE_ANNOUNCED_S,
  COMPARE_MAX_RESTARTS,
  COMPARE_MIN_FRAMES,
  COMPARE_ORDER,
  COMPARE_PLANNED_MS,
  COMPARE_PREPARE_FRAMES,
  COMPARE_READY_TIMEOUT_MS,
  COMPARE_SETTLE_MS,
  COMPARE_STEPS,
  COMPARE_WARMUP_MS,
  COMPARE_WINDOW_MS,
  combinePasses,
  createCompareFrame,
  createCompareRun,
  estimateScreen,
  inNoise,
  readCompare,
  recordGpu,
  SLOW_SPIN_MAX_STEP_S,
  SLOW_SPIN_TURN_S,
  slowSpinSpeed,
  controlsDamping,
  CONTROLS_DAMPING,
  startCompareRun,
  stepCompare,
  type CompareFrame,
  type CompareId,
  type CompareOutcome,
  type CompareRun,
  type CompareSkip,
  type CompareSummary,
  type CompareVariant,
  type CompareWait,
  type CompareWindow,
} from '../../src/render/frameMeter.ts';

// « Comparer » dans « Sous le capot » (src/render/frameMeter.ts) : cinq variantes de la scène,
// deux passages chacune (aller puis retour), cadence naturelle et temps de carte dans chaque
// fenêtre ; et la rotation lente réglée au temps.

const all: CompareSkip = () => null;
const FRAME = 1000 / 60;

/** Ce que voit une image, selon la variante posée, le passage, et l'image depuis le départ. */
interface Look {
  variant: CompareVariant | null;
  /** 0 : aller ; 1 : retour. */
  pass: number;
  frame: number;
  /** Temps écoulé depuis le départ de la comparaison. */
  t: number;
  run: CompareRun;
}

interface Scene {
  /** Durée d'une image, en millisecondes. */
  ms: (look: Look) => number;
  /** Temps de carte d'une image de mesure, rendu deux images plus tard (`null` : pas de minuterie). */
  gpu?: (look: Look) => number | null;
  ready?: (look: Look) => boolean;
  wait?: (look: Look) => CompareWait;
  programs?: (look: Look) => number;
  pixels?: (look: Look) => number;
}

/** Retard des résultats de la minuterie de la carte, en images. */
const GPU_DELAY = 2;

/** Fait tourner la machine jusqu'au bout (ou `limit` images) ; relève les variantes posées. */
function drive(run: CompareRun, scene: Scene, skip: CompareSkip = all, limit = 100_000) {
  const frame: CompareFrame = createCompareFrame();
  const variants: Array<CompareVariant | null> = [];
  const slots: number[] = [];
  const inFlight: Array<{ window: number; ms: number; at: number }> = [];
  let now = 1000;
  startCompareRun(run, now, skip);
  variants.push(run.variant);
  slots.push(run.slot);
  const start = now;
  let frames = 0;
  while (run.phase !== 'done' && frames < limit) {
    const look: Look = { variant: run.variant, pass: run.slot < COMPARE_STEPS.length ? 0 : 1, frame: frames, t: now - start, run };
    // Comme FrameMeter : la minuterie encadre les images de mesure, ses résultats arrivent plus tard.
    const measured = run.phase === 'measure' ? (scene.gpu?.(look) ?? null) : null;
    if (measured !== null) inFlight.push({ window: run.window, ms: measured, at: frames + GPU_DELAY });
    while (inFlight.length > 0 && (inFlight[0]?.at ?? Infinity) <= frames) {
      const result = inFlight.shift();
      if (result) recordGpu(run, result.window, result.ms);
    }
    now += scene.ms(look);
    frames += 1;
    look.t = now - start;
    frame.now = now;
    frame.cpuMs = 3;
    frame.calls = run.variant === 'sans-reflet' ? 100 : 140;
    frame.triangles = 500_000;
    frame.programs = scene.programs?.(look) ?? 58;
    frame.pixels = scene.pixels?.(look) ?? (run.variant === 'densite-1' ? 390 * 844 : 780 * 1688);
    frame.ready = scene.ready?.(look) ?? true;
    frame.wait = scene.wait?.(look) ?? 'programmes';
    stepCompare(run, frame, skip);
    if (variants.at(-1) !== run.variant) variants.push(run.variant);
    if (slots.at(-1) !== run.slot) slots.push(run.slot);
  }
  return { variants, slots, duration: now - start, frames };
}

/** Garde-fou des boucles : une machine qui n'avance plus fait échouer le test au lieu de le figer. */
function guard(): () => void {
  let n = 0;
  return () => {
    n += 1;
    if (n > 100_000) throw new Error('la mesure n’avance plus');
  };
}

const byId = (run: CompareRun, id: CompareId) => run.outcomes.find((outcome) => outcome.id === id);
const summaryOf = (run: CompareRun, id: CompareId): CompareSummary => {
  const outcome = byId(run, id);
  if (!outcome?.measured) throw new Error(`${id} non mesurée : ${outcome && !outcome.measured ? outcome.reason : 'absente'}`);
  return outcome.summary;
};
const programsOf = (run: CompareRun, id: CompareId): number => {
  const outcome = byId(run, id);
  if (!outcome?.measured) throw new Error(`${id} non mesurée`);
  return outcome.programs;
};
const reasonOf = (run: CompareRun, id: CompareId): string => {
  const outcome = byId(run, id);
  if (!outcome || outcome.measured) throw new Error(`${id} mesurée`);
  return outcome.reason;
};

describe('mesure comparée : enchaînement', () => {
  it('dix fenêtres, les variantes à l’aller puis à rebours, chacune posée puis retirée, dans la durée annoncée', () => {
    const run = createCompareRun();
    const { variants, slots, duration } = drive(run, { ms: () => FRAME });
    expect(COMPARE_ORDER).toEqual([0, 1, 2, 3, 4, 4, 3, 2, 1, 0]);
    expect(variants).toEqual([null, 'trame', 'sans-reflet', 'sans-mobilier', 'densite-1', 'sans-mobilier', 'sans-reflet', 'trame', null]);
    expect(slots).toEqual([...COMPARE_ORDER.keys(), COMPARE_ORDER.length]);
    expect(run.outcomes.map((outcome) => outcome.id)).toEqual(COMPARE_STEPS.map((step) => step.id));
    expect(run.outcomes.every((outcome) => outcome.measured)).toBe(true);
    expect(run.variant).toBeNull();
    // Mise en train, puis pour chaque fenêtre : pose (quelques images), temps de pose, mesure.
    expect(COMPARE_PLANNED_MS).toBe(COMPARE_WARMUP_MS - COMPARE_SETTLE_MS + 10 * (COMPARE_SETTLE_MS + COMPARE_WINDOW_MS));
    expect(duration).toBeGreaterThanOrEqual(COMPARE_PLANNED_MS);
    expect(duration).toBeLessThan(COMPARE_PLANNED_MS + 10 * 100);
    expect(duration / 1000).toBeGreaterThanOrEqual(30);
    expect(duration / 1000).toBeLessThanOrEqual(35);
    expect(duration).toBeLessThanOrEqual(COMPARE_ANNOUNCED_S * 1000);
    expect(COMPARE_ANNOUNCED_S * 1000 - duration).toBeLessThan(2000);
  });

  it('une dérive régulière s’annule entre l’aller et le retour ; l’écart des passages la montre', () => {
    const run = createCompareRun();
    // La scène ralentit de 0,2 ms par seconde (chauffe) ; chaque variante a son coût propre.
    const base: Record<string, number> = { courant: 20, trame: 22, 'sans-reflet': 15, 'sans-mobilier': 19, 'densite-1': 12 };
    const own = (look: Look) => base[look.variant ?? 'courant'] ?? 0;
    drive(run, { ms: (look) => own(look) + 0.0002 * look.t, gpu: (look) => own(look) - 4 + 0.0002 * look.t });
    const current = summaryOf(run, 'courant');
    for (const step of COMPARE_STEPS) {
      const summary = summaryOf(run, step.id);
      // Écart au réglage en cours : celui de la variante seule, à 0,1 ms près, malgré la dérive.
      expect(summary.meanMs - current.meanMs, step.id).toBeCloseTo((base[step.id] ?? 0) - 20, 1);
      expect((summary.gpuMs ?? 0) - (current.gpuMs ?? 0), step.id).toBeCloseTo((base[step.id] ?? 0) - 20, 1);
      // Le retour est plus lent que l'aller, d'autant plus que les deux passages sont éloignés.
      expect(summary.passes[1].meanMs).toBeGreaterThan(summary.passes[0].meanMs);
      expect(summary.gapMs).toBeCloseTo(Math.abs(summary.passes[1].meanMs - summary.passes[0].meanMs), 2);
      expect(summary.meanMs).toBeCloseTo((summary.passes[0].meanMs + summary.passes[1].meanMs) / 2, 2);
    }
    expect(current.gapMs).toBeGreaterThan(summaryOf(run, 'trame').gapMs);
    expect(summaryOf(run, 'trame').gapMs).toBeGreaterThan(summaryOf(run, 'densite-1').gapMs);
    // Réglage en cours : passages à 9 fenêtres d'écart (environ 27 s), soit 5,4 ms de dérive.
    expect(current.gapMs).toBeGreaterThan(4.5);
    expect(current.gapGpuMs).toBeCloseTo(current.gapMs, 0);
  });

  it('chaque résultat dit la cadence, le pire centile, le processeur, les appels et le temps de carte de sa variante', () => {
    const run = createCompareRun();
    const cost: Record<string, number> = { courant: 23, trame: 25, 'sans-reflet': 16, 'sans-mobilier': 21, 'densite-1': 12 };
    drive(run, {
      ms: (look) => (look.variant === null && look.frame % 50 === 0 ? 40 : (cost[look.variant ?? 'courant'] ?? 0)),
      // Temps de carte : médiane, une image lente n'y pèse pas.
      gpu: (look) => (look.frame % 40 === 0 ? 90 : (cost[look.variant ?? 'courant'] ?? 0) - 5),
    });
    const current = summaryOf(run, 'courant');
    const plain = summaryOf(run, 'sans-reflet');
    expect(current.meanMs).toBeGreaterThan(23);
    expect(current.worstFps).toBe(25);
    expect(programsOf(run, 'courant')).toBe(58);
    expect(current.cpuMs).toBe(3);
    expect(current.gpuMs).toBe(18);
    expect(current.gapGpuMs).toBe(0);
    expect(current.gpuFrames).toBeGreaterThan(0.8 * current.frames);
    expect(plain.fps).toBeCloseTo(62.5, 1);
    expect(plain.meanMs).toBe(16);
    expect(plain.calls).toBe(100);
    expect(plain.gpuMs).toBe(11);
    const dense = summaryOf(run, 'densite-1');
    expect(dense.frames).toBe(2 * Math.ceil(COMPARE_WINDOW_MS / 12));
  });

  it('temps de carte : seuls ceux de la fenêtre en cours comptent, pas ceux d’avant une reprise ni d’une autre fenêtre', () => {
    const run = createCompareRun(64);
    const frame = createCompareFrame();
    startCompareRun(run, 0, all);
    frame.ready = true;
    let now = 0;
    // Pendant la pose et le temps de pose : rien n'est gardé.
    recordGpu(run, run.window, 5);
    const step1 = guard();
    while (run.phase !== 'measure') {
      step1();
      recordGpu(run, run.window, 5);
      stepCompare(run, Object.assign(frame, { now: (now += 16) }), all);
    }
    expect(run.gpuCount).toBe(0);
    const first = run.window;
    for (let i = 0; i < 10; i += 1) {
      stepCompare(run, Object.assign(frame, { now: (now += 16) }), all);
      recordGpu(run, first, 7);
    }
    expect(run.gpuCount).toBe(10);
    // Un résultat absurde ou d'une autre fenêtre est écarté.
    recordGpu(run, first, Number.NaN);
    recordGpu(run, first, -1);
    recordGpu(run, first + 1, 7);
    expect(run.gpuCount).toBe(10);
    // Reprise (programme compilé) : la fenêtre change de numéro, ses temps d'avant sont oubliés.
    stepCompare(run, Object.assign(frame, { now: (now += 16), programs: 1 }), all);
    expect(run.phase).toBe('prepare');
    expect(run.gpuCount).toBe(0);
    expect(run.window).not.toBe(first);
    const step2 = guard();
    while (run.phase !== 'measure') {
      step2();
      stepCompare(run, Object.assign(frame, { now: (now += 16) }), all);
    }
    recordGpu(run, first, 7);
    expect(run.gpuCount).toBe(0);
    // Tampon plein : rien ne déborde.
    for (let i = 0; i < 100; i += 1) recordGpu(run, run.window, 3);
    expect(run.gpuCount).toBe(64);
  });

  it('sans minuterie de la carte : pas de temps de carte, la cadence reste', () => {
    const run = createCompareRun();
    drive(run, { ms: () => FRAME });
    for (const step of COMPARE_STEPS) {
      const summary = summaryOf(run, step.id);
      expect(summary.gpuMs, step.id).toBeNull();
      expect(summary.gapGpuMs, step.id).toBeNull();
      expect(summary.gpuFrames, step.id).toBe(0);
      expect(summary.meanMs, step.id).toBeCloseTo(FRAME, 1);
    }
  });

  it('attend que les nuanceurs soient prêts avant le temps de pose, puis écarte la pose', () => {
    const run = createCompareRun();
    let readyAt = Number.NaN;
    drive(run, {
      // La trame se compile pendant une seconde : images lentes, programmes pas prêts.
      ms: (look) => (look.variant === 'trame' && Number.isNaN(readyAt) ? 300 : 20),
      ready: (look) => {
        if (look.variant !== 'trame') return true;
        if (Number.isNaN(readyAt)) readyAt = look.t + 1000;
        return look.t >= readyAt;
      },
    });
    // Aucune image de compilation (300 ms) dans les fenêtres.
    expect(summaryOf(run, 'trame').worstFps).toBe(50);
    // Une trame qui met dix secondes à se préparer (téléphone lent) est attendue, pas abandonnée.
    const slow = createCompareRun();
    let slowAt = Number.NaN;
    drive(slow, {
      ms: () => 50,
      ready: (look) => {
        if (look.variant !== 'trame') return true;
        if (Number.isNaN(slowAt)) slowAt = look.t + 10_000;
        return look.t >= slowAt;
      },
    });
    expect(summaryOf(slow, 'trame').frames).toBeGreaterThan(0);
  });

  it('un nuanceur compilé pendant la fenêtre la fait recommencer : la compilation n’est jamais mesurée', () => {
    const run = createCompareRun();
    let programs = 58;
    let compiled = false;
    drive(run, {
      ms: (look) => {
        // Au milieu de « Sans reflet du sol » (aller), une image de 500 ms et un programme de plus.
        if (look.variant === 'sans-reflet' && look.run.phase === 'measure' && look.run.count === 100 && !compiled) {
          compiled = true;
          programs += 1;
          return 500;
        }
        return 16;
      },
      programs: () => programs,
    });
    expect(compiled).toBe(true);
    expect(summaryOf(run, 'sans-reflet').worstFps).toBe(62.5);
    expect(programsOf(run, 'sans-reflet')).toBe(59);
  });

  it('« Densité 1 » dérangée pendant sa fenêtre (écran retaillé) : la fenêtre recommence, sans garder une image d’avant', () => {
    const run = createCompareRun();
    let disturbed = false;
    drive(run, {
      // Images lentes (30 ms) jusqu'au dérangement, rapides (12 ms) ensuite.
      ms: (look) => (look.variant === 'densite-1' && !disturbed ? 30 : 12),
      ready: (look) => {
        if (look.variant === 'densite-1' && look.pass === 0 && look.run.phase === 'measure' && look.run.count === 40 && !disturbed) {
          disturbed = true;
          return false;
        }
        return true;
      },
      wait: () => 'taille',
    });
    expect(disturbed).toBe(true);
    const dense = summaryOf(run, 'densite-1');
    expect(dense.passes[0].meanMs).toBe(12);
    expect(dense.passes[0].worstMs).toBe(12);
  });

  it('dérangée pendant le temps de pose (scène pas prête, ou programme compilé) : la pose reprend en entier', () => {
    for (const kind of ['ready', 'programs'] as const) {
      const run = createCompareRun();
      let disturbedAt = Number.NaN;
      let measureAt = Number.NaN;
      let programs = 58;
      drive(run, {
        ms: (look) => {
          if (look.variant === 'sans-reflet' && look.run.phase === 'measure' && Number.isNaN(measureAt)) measureAt = look.t;
          return 16;
        },
        ready: (look) => {
          if (kind !== 'ready' || look.variant !== 'sans-reflet' || look.run.phase !== 'settle' || look.run.phaseFrames !== 10 || !Number.isNaN(disturbedAt)) return true;
          disturbedAt = look.t;
          return false;
        },
        programs: (look) => {
          if (kind === 'programs' && look.variant === 'sans-reflet' && look.run.phase === 'settle' && look.run.phaseFrames === 10 && Number.isNaN(disturbedAt)) {
            disturbedAt = look.t;
            programs += 1;
          }
          return programs;
        },
      });
      expect(disturbedAt, kind).toBeGreaterThan(0);
      // La mesure ne commence qu'après une pose (quelques images) puis un temps de pose entier.
      expect(measureAt - disturbedAt, kind).toBeGreaterThanOrEqual(COMPARE_SETTLE_MS + COMPARE_PREPARE_FRAMES * 16);
      expect(summaryOf(run, 'sans-reflet').frames, kind).toBeGreaterThan(0);
    }
  });

  it('les reprises d’une fenêtre n’entament pas le crédit de la suivante', () => {
    const run = createCompareRun();
    const restartsBy = new Map<number, number>();
    let programs = 58;
    drive(run, {
      ms: () => 16,
      // Dans chaque fenêtre de « Trame partout » et de « Sans reflet du sol » : autant de reprises
      // que permis (programmes qui changent pendant la mesure).
      programs: (look) => {
        const { run: state } = look;
        if ((look.variant === 'trame' || look.variant === 'sans-reflet') && state.phase === 'measure' && state.phaseFrames === 5) {
          const done = restartsBy.get(state.slot) ?? 0;
          if (done < COMPARE_MAX_RESTARTS) {
            restartsBy.set(state.slot, done + 1);
            programs += 1;
          }
        }
        return programs;
      },
    });
    expect([...restartsBy.values()]).toEqual([3, 3, 3, 3]);
    expect(run.outcomes.every((outcome) => outcome.measured)).toBe(true);
  });

  it('une variante que la scène ne permet pas est notée « non mesurée » avec sa raison, sans attente, aux deux passages', () => {
    const run = createCompareRun();
    const asked: CompareId[] = [];
    const skip: CompareSkip = (id) => {
      asked.push(id);
      return id === 'sans-reflet' ? 'pas de reflet du sol à ce niveau' : id === 'densite-1' ? 'déjà en densité 1' : null;
    };
    const { variants, duration } = drive(run, { ms: () => 16 }, skip);
    expect(variants).toEqual([null, 'trame', 'sans-mobilier', 'trame', null]);
    expect(byId(run, 'sans-reflet')).toEqual({ id: 'sans-reflet', label: 'Sans reflet du sol', measured: false, reason: 'pas de reflet du sol à ce niveau' });
    expect(reasonOf(run, 'densite-1')).toBe('déjà en densité 1');
    expect(run.outcomes.map((outcome) => outcome.id)).toEqual(COMPARE_STEPS.map((step) => step.id));
    // Une raison par variante écartée, demandée une fois ; les autres ne sont demandées qu'à l'aller.
    expect(asked).toEqual(['courant', 'trame', 'sans-reflet', 'sans-mobilier', 'densite-1']);
    expect(run.outcomes.filter((outcome) => !outcome.measured)).toHaveLength(2);
    const window = COMPARE_SETTLE_MS + COMPARE_WINDOW_MS;
    expect(duration).toBeLessThan(COMPARE_WARMUP_MS - COMPARE_SETTLE_MS + 6 * window + 6 * 100);
  });

  it('au retour, la variante n’est pas écartée parce que la scène la porte encore (« Densité 1 » deux fois de suite)', () => {
    const run = createCompareRun();
    // Comme FrameMeter : « déjà en densité 1 » si le pixel ratio est à 1, ce qui est le cas pendant la variante.
    drive(run, { ms: () => 16 }, (id) => (id === 'densite-1' && run.variant === 'densite-1' ? 'l’écran est déjà en densité 1' : null));
    expect(summaryOf(run, 'densite-1').passes).toHaveLength(2);
  });

  it('nuanceurs jamais prêts : la variante est abandonnée au bout du délai, pas retentée au retour, la suite continue', () => {
    const run = createCompareRun();
    const { variants } = drive(run, { ms: () => 50, ready: (look) => look.variant !== 'trame' });
    expect(variants).toEqual([null, 'trame', 'sans-reflet', 'sans-mobilier', 'densite-1', 'sans-mobilier', 'sans-reflet', null]);
    expect(reasonOf(run, 'trame')).toBe(`nuanceurs pas prêts au bout de ${COMPARE_READY_TIMEOUT_MS / 1000} secondes`);
    expect(summaryOf(run, 'densite-1').frames).toBeGreaterThan(0);
  });

  it('délai dépassé : la raison dit ce qui manquait (trame en préparation, densité refusée)', () => {
    for (const [wait, pattern] of [
      ['trame', /^trame du fondu pas prête au bout de 30 secondes$/],
      ['taille', /^densité 1 pas tenue au bout de 30 secondes$/],
    ] as const) {
      const run = createCompareRun();
      drive(run, { ms: () => 50, ready: (look) => look.variant !== 'densite-1', wait: () => wait });
      expect(reasonOf(run, 'densite-1'), wait).toMatch(pattern);
    }
  });

  it('des reprises sans fin : la variante n’est pas mesurée, et la raison dit leur vraie cause', () => {
    const cases: Array<[string, Partial<Scene>, RegExp]> = [
      // Programmes qui changent sans arrêt : des nuanceurs se compilent.
      ['programmes', { programs: (look) => (look.variant === 'densite-1' ? 58 + Math.floor(look.frame / 40) : 58) }, /nuanceurs se compilent/],
      // Pixel ratio remis par le Canvas à chaque changement de taille (téléphone tourné) : pas un nuanceur.
      ['taille', { ready: (look) => !(look.variant === 'densite-1' && look.frame % 40 === 0), wait: () => 'taille' }, /écran a changé de taille/],
      // Taille du tampon d'affichage qui change, variante pourtant bien posée.
      ['pixels', { pixels: (look) => (look.variant === 'densite-1' ? 1000 + Math.floor(look.frame / 40) : 2000) }, /écran a changé de taille/],
      // Trame du fondu qui repasse en préparation.
      ['trame', { ready: (look) => !(look.variant === 'densite-1' && look.frame % 40 === 0), wait: () => 'trame' }, /trame du fondu se prépare/],
    ];
    for (const [name, scene, pattern] of cases) {
      const run = createCompareRun();
      drive(run, { ms: () => 16, ...scene });
      expect(reasonOf(run, 'densite-1'), name).toMatch(pattern);
      expect(reasonOf(run, 'densite-1'), name).not.toMatch(name === 'programmes' ? /taille|trame/ : /compilent/);
      // Les autres variantes vont au bout.
      expect(summaryOf(run, 'sans-mobilier').frames, name).toBeGreaterThan(0);
    }
  });

  it('une première image de compilation plus longue que le délai n’abandonne pas la variante', () => {
    const run = createCompareRun();
    let first = true;
    let compiling = false;
    drive(run, {
      ms: (look) => {
        if (look.variant === 'trame' && first) {
          first = false;
          compiling = true;
          return COMPARE_READY_TIMEOUT_MS + 5000;
        }
        return 20;
      },
      // Cette image-là n'a pas fini de préparer ses nuanceurs.
      ready: () => {
        const ready = !compiling;
        compiling = false;
        return ready;
      },
    });
    expect(summaryOf(run, 'trame').worstFps).toBe(50);
  });

  it('la première fenêtre attend la mise en train, les suivantes le temps de pose ordinaire', () => {
    const run = createCompareRun();
    const starts: number[] = [];
    let previous = run.phase;
    let now = 0;
    const frame = createCompareFrame();
    startCompareRun(run, now, all);
    frame.ready = true;
    const step = guard();
    while (run.phase !== 'done') {
      step();
      const before = run.phaseStart;
      stepCompare(run, Object.assign(frame, { now: (now += 10) }), all);
      if (previous === 'settle' && run.phase === 'measure') starts.push(now - before);
      previous = run.phase;
    }
    expect(starts).toHaveLength(COMPARE_ORDER.length);
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

  it('rendu très lent : chaque fenêtre garde quelques images, même au-delà de sa durée', () => {
    const run = createCompareRun();
    drive(run, { ms: () => 900 });
    for (const step of COMPARE_STEPS) {
      for (const pass of summaryOf(run, step.id).passes) expect(pass.frames, step.id).toBe(COMPARE_MIN_FRAMES);
    }
  });

  it('tampons pleins : la fenêtre se ferme plus tôt, sans déborder', () => {
    const run = createCompareRun(64);
    const { duration } = drive(run, { ms: () => 1 });
    for (const step of COMPARE_STEPS) {
      for (const pass of summaryOf(run, step.id).passes) expect(pass.frames).toBe(64);
    }
    // Sans la fermeture sur tampons pleins, chaque fenêtre durerait sa durée entière.
    expect(duration).toBeLessThan(COMPARE_PLANNED_MS - 10 * COMPARE_WINDOW_MS + 10 * 200);
  });

  it('pendant une fenêtre, les tampons et la liste des résultats restent les mêmes objets', () => {
    const run = createCompareRun();
    const { ms, gpu, rhythm } = run;
    const frame = createCompareFrame();
    startCompareRun(run, 0, all);
    const list = run.outcomes;
    frame.ready = true;
    let now = 0;
    const step = guard();
    while (run.phase !== 'measure') {
      step();
      stepCompare(run, Object.assign(frame, { now: (now += 16) }), all);
    }
    for (let i = 0; i < 100; i += 1) {
      stepCompare(run, Object.assign(frame, { now: (now += 16) }), all);
      recordGpu(run, run.window, 9);
    }
    expect(run.count).toBe(100);
    expect(run.gpuCount).toBe(100);
    expect(run.rhythmCount).toBe(100);
    // Image au même instant que la précédente : intervalle nul, ni dans le rythme ni dans la moyenne.
    stepCompare(run, frame, all);
    expect(run.rhythmCount).toBe(100);
    expect(run.ms).toBe(ms);
    expect(run.gpu).toBe(gpu);
    expect(run.rhythm).toBe(rhythm);
    expect(run.outcomes).toBe(list);
  });

  it('à la fin, le rythme de l’écran est estimé d’après les images de toute la comparaison', () => {
    const run = createCompareRun();
    // Écran à 120 i/s : images de 16,7 ou 25 ms (deux ou trois périodes).
    drive(run, { ms: (look) => (look.frame % 3 === 0 ? 25 : 1000 / 60) });
    expect(run.screenMs).toBeCloseTo(1000 / 120, 1);
    const capped = createCompareRun();
    drive(capped, { ms: () => FRAME });
    expect(capped.screenMs).toBeCloseTo(FRAME, 1);
    // Les images de pose n'y entrent pas : très lentes ici, elles empêcheraient de reconnaître l'écran.
    const posed = createCompareRun();
    drive(posed, { ms: (look) => (look.run.phase === 'measure' ? FRAME : 37) });
    expect(posed.screenMs).toBeCloseTo(FRAME, 1);
    expect(posed.rhythmCount).toBe(COMPARE_STEPS.reduce((sum, step) => sum + summaryOf(posed, step.id).frames, 0));
  });
});

describe('mesure comparée : rythme de l’écran, plafond, bruit', () => {
  const intervals = (values: number[]) => Float64Array.from(values);
  const repeat = (pattern: number[], n: number) => Array.from({ length: n }, (_, i) => pattern[i % pattern.length] as number);

  it('écran à 60 i/s : toutes les images à 16,7 ms, ou qui sautent des périodes (33,3, 50 ms)', () => {
    expect(estimateScreen(intervals(repeat([FRAME], 200)), 200)).toBeCloseTo(FRAME, 2);
    const slow = intervals(repeat([2 * FRAME, 3 * FRAME, 2 * FRAME], 200));
    expect(estimateScreen(slow, 200)).toBeCloseTo(FRAME, 2);
  });

  it('écran à 120 i/s : images seules (8,3 ms), ou à cheval sur deux et trois périodes (16,7 et 25 ms)', () => {
    expect(estimateScreen(intervals(repeat([1000 / 120], 200)), 200)).toBeCloseTo(1000 / 120, 2);
    expect(estimateScreen(intervals(repeat([1000 / 60, 25, 1000 / 60, 25, 25], 200)), 200)).toBeCloseTo(1000 / 120, 2);
  });

  it('écran à 100 i/s (rythme hors de la liste courante) : images à 20 et 30 ms, deux et trois périodes', () => {
    expect(estimateScreen(intervals(repeat([20, 30, 20], 200)), 200)).toBeCloseTo(10, 2);
  });

  it('écran à 90 i/s, avec un peu de gigue et quelques images perdues', () => {
    const values = repeat([1000 / 90 + 0.3, 1000 / 90 - 0.4, 1000 / 90, 2000 / 90 + 0.2], 300);
    values[17] = 61;
    values[123] = 140;
    expect(estimateScreen(intervals(values), values.length)).toBeCloseTo(1000 / 90, 0);
  });

  it('rythme pas reconnu : trop peu d’images, ou des intervalles qui ne tombent sur aucun rythme', () => {
    expect(estimateScreen(intervals([FRAME, FRAME, FRAME]), 3)).toBeNull();
    expect(estimateScreen(intervals(repeat([23, 31, 47, 29, 37, 41], 120)), 120)).toBeNull();
    // Seuls les `count` premiers intervalles comptent.
    const mixed = intervals([...repeat([FRAME], 100), ...repeat([23, 31, 47], 100)]);
    expect(estimateScreen(mixed, 100)).toBeCloseTo(FRAME, 2);
    expect(estimateScreen(mixed, 200)).toBeNull();
  });

  it('au plafond : la cadence atteint 97 % de celle de l’écran', () => {
    expect(atScreenCap({ meanMs: 16.7 }, FRAME)).toBe(true);
    expect(atScreenCap({ meanMs: FRAME / 0.97 - 0.01 }, FRAME)).toBe(true);
    expect(atScreenCap({ meanMs: FRAME / 0.97 + 0.01 }, FRAME)).toBe(false);
    expect(atScreenCap({ meanMs: 8 }, null)).toBe(false);
  });

  const window = (meanMs: number, gpuMs: number | null): CompareWindow => ({
    frames: 150,
    meanMs,
    worstMs: meanMs * 1.5,
    cpuMs: 4,
    calls: 140,
    triangles: 500_000,
    gpuMs,
    gpuFrames: gpuMs === null ? 0 : 148,
  });
  const measured = (id: CompareId, first: [number, number | null], second: [number, number | null]): CompareOutcome => ({
    id,
    label: id,
    measured: true,
    programs: 58,
    summary: combinePasses(window(...first), window(...second)),
  });

  it('deux passages : moyenne, écart, pire centile du plus lent ; temps de carte seulement si les deux l’ont', () => {
    const summary = combinePasses(window(20, 15), window(22, 16));
    expect(summary).toMatchObject({ frames: 300, meanMs: 21, fps: 47.6, gapMs: 2, worstFps: 30.3, gpuMs: 15.5, gapGpuMs: 1, gpuFrames: 296 });
    expect(combinePasses(window(20, 15), window(22, null))).toMatchObject({ gpuMs: null, gapGpuMs: null });
    expect(combinePasses(window(20, null), window(22, 16))).toMatchObject({ gpuMs: null, gapGpuMs: null });
  });

  it('bruit : le plus grand écart aller-retour d’une même variante, pour la cadence et pour la carte', () => {
    const outcomes = [measured('courant', [24, 20], [24.6, 20.1]), measured('trame', [26, 22.5], [25.8, 22.1]), measured('densite-1', [14, 9], [14.1, 9])];
    const reading = readCompare(outcomes, FRAME);
    expect(reading.noiseMs).toBeCloseTo(0.6, 5);
    expect(reading.noiseGpuMs).toBeCloseTo(0.4, 5);
    expect(reading.redo).toBe(false);
    // « Dans le bruit » : écart au réglage en cours qui ne dépasse pas le bruit.
    expect(inNoise(0.6, 0.6)).toBe(true);
    expect(inNoise(-0.6, 0.6)).toBe(true);
    expect(inNoise(0.61, 0.6)).toBe(false);
    expect(inNoise(0, null)).toBe(false);
  });

  it('trop de bruit pour conclure : écart aller-retour au-delà de 10 % du réglage en cours', () => {
    // Carte à 20 ms : bruit permis jusqu'à 2 ms.
    expect(readCompare([measured('courant', [24, 20], [24, 21.9])], null).redo).toBe(false);
    expect(readCompare([measured('courant', [24, 20], [24, 22.5])], null).redo).toBe(true);
    // Cadence : même règle, sauf au plafond de l'écran, où elle ne départage rien.
    expect(readCompare([measured('courant', [24, 20], [27, 20])], null).redo).toBe(true);
    expect(readCompare([measured('courant', [16.6, 9], [16.8, 9.1]), measured('trame', [16.7, 9.5], [19.5, 9.4])], FRAME).redo).toBe(false);
    // Plancher de 0,5 ms : une carte à 3 ms tolère 0,5 ms, pas 0,3 seulement.
    expect(readCompare([measured('courant', [16.7, 3], [16.7, 3.45])], FRAME).redo).toBe(false);
    expect(readCompare([measured('courant', [16.7, 3], [16.7, 3.55])], FRAME).redo).toBe(true);
    // Sans minuterie, seule la cadence compte.
    expect(readCompare([measured('courant', [24, null], [24.2, null])], null)).toEqual({ noiseMs: 0.2, noiseGpuMs: null, redo: false });
    // Réglage en cours pas mesuré : rien à quoi comparer.
    expect(readCompare([measured('trame', [24, 20], [24, 20])], null).redo).toBe(true);
    expect(readCompare([], null)).toEqual({ noiseMs: null, noiseGpuMs: null, redo: true });
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
