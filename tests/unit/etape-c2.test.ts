import { describe, expect, it } from 'vitest';
import { FINISHES } from '../../src/data/finishes.ts';
import { FRAMINGS, framingById } from '../../src/data/framings.ts';
import { GARAGE } from '../../src/data/garage.ts';
import { AUTO_CEILING, AUTO_MAX_CHANGES, autoQualityBounds, createAutoQuality, stepAutoQuality } from '../../src/render/autoQuality.ts';
import { summarizeFrames, type FrameSample } from '../../src/render/frameMeter.ts';
import { framingPose, frontFromTurn } from '../../src/render/photo/framing.ts';
import { EXPORT_MARGIN, EXPORT_TILE_LIMIT, EXPORT_WIDTH, exportSize, PHOTO_PLANS } from '../../src/render/photo/plan.ts';
import { programVariants } from '../../src/render/paint.ts';
import { vignetteFactor } from '../../src/render/photo/vignette.ts';
import { QUALITY_LEVELS, resolveQuality } from '../../src/render/quality.ts';

// Jalon 1, étape C2 : mode photo (cadrages, export), qualité automatique, mesure de cadence.

describe('étape C2 : cadrages avec le véhicule nez vers -x', () => {
  const base = { fov: 40, distance: 5, target: [0, 0.6, 0] as const, halfLength: 2.2 };

  it('le véhicule du garage est posé nez vers -x', () => {
    expect(frontFromTurn(GARAGE.vehicle.turn)).toBe(-1);
    expect(frontFromTurn(0)).toBe(1);
  });

  it('nez vers -x : chaque cadrage est le miroir du cadrage nez vers +x, caméra du même côté', () => {
    for (const framing of FRAMINGS) {
      const plus = framingPose(framing, { ...base, frontX: 1 });
      const minus = framingPose(framing, { ...base, frontX: -1 });
      expect(minus.position[0], framing.id).toBeCloseTo(-plus.position[0], 9);
      expect(minus.position[1], framing.id).toBeCloseTo(plus.position[1], 9);
      expect(minus.position[2], framing.id).toBeCloseTo(plus.position[2], 9);
      expect(minus.target[0], framing.id).toBeCloseTo(-plus.target[0], 9);
      expect(minus.fov, framing.id).toBe(plus.fov);
    }
  });

  it('nez vers -x : l’avant se photographie côté -x, l’arrière côté +x, le ras du sol vise la roue avant', () => {
    const front = { ...base, frontX: -1 };
    expect(framingPose(framingById('avant'), front).position[0]).toBeLessThan(0);
    expect(framingPose(framingById('arriere'), front).position[0]).toBeGreaterThan(0);
    expect(framingPose(framingById('ras-du-sol'), front).target[0]).toBeLessThan(0);
  });

  it('chaque cadrage a un libellé court de bouton', () => {
    for (const framing of FRAMINGS) {
      expect(framing.short.length, framing.id).toBeGreaterThan(0);
      expect(framing.short.length, framing.id).toBeLessThanOrEqual(10);
    }
  });
});

describe('étape C2 : image enregistrée', () => {
  it('portrait de téléphone en tuiles de 2048 marges comprises : 2160 de large, l’image entière couverte', () => {
    const size = exportSize(390, 844, EXPORT_WIDTH, EXPORT_TILE_LIMIT - 2 * EXPORT_MARGIN);
    expect(size.width).toBe(2160);
    for (const tile of size.tiles) {
      expect(tile.width + 2 * EXPORT_MARGIN).toBeLessThanOrEqual(EXPORT_TILE_LIMIT);
      expect(tile.height + 2 * EXPORT_MARGIN).toBeLessThanOrEqual(EXPORT_TILE_LIMIT);
    }
  });

  it('images par tuile : une seule sans profondeur de champ, davantage avec', () => {
    for (const level of QUALITY_LEVELS) {
      const plan = PHOTO_PLANS[level];
      expect(Number.isInteger(plan.exportFrames), level).toBe(true);
      expect(plan.exportFrames, level).toBeGreaterThanOrEqual(1);
      expect(plan.exportFrames, level).toBeLessThanOrEqual(plan.frames);
      if (plan.depthOfField) expect(plan.exportFrames, level).toBeGreaterThan(1);
    }
  });

  it('vignettage refait sur l’image entière : centre intact, coins assombris, symétrique', () => {
    expect(vignetteFactor(0.5, 0.5, 0.32, 0.42)).toBe(1);
    const corner = vignetteFactor(0, 0, 0.32, 0.42);
    expect(corner).toBeLessThan(1);
    expect(corner).toBeGreaterThanOrEqual(0);
    expect(vignetteFactor(1, 1, 0.32, 0.42)).toBeCloseTo(corner, 12);
    expect(vignetteFactor(0.5, 0.5, 0.32, 0)).toBe(1);
  });
});

describe('étape C2 : qualité automatique', () => {
  it('bornes fixes à 60 i/s : un téléphone lent descend, un écran à 120 Hz ne relève pas la barre', () => {
    // Le moniteur passe sa meilleure cadence vue (4 i/s sur un téléphone lent, 120 sur un écran
    // rapide) : les bornes l'ignorent.
    const bounds: (bestFps: number) => [number, number] = autoQualityBounds;
    expect(bounds(4)).toEqual([45, 57]);
    expect(bounds(120)).toEqual([45, 57]);
  });

  it('descend d’un niveau à la fois, et se fixe en bas de l’échelle', () => {
    let state = createAutoQuality();
    expect(state.level).toBe('standard');
    state = stepAutoQuality(state, 'decline');
    expect(state.level).toBe('eco');
    expect(state.settled).toBe(false);
    state = stepAutoQuality(state, 'decline');
    expect(state).toMatchObject({ level: 'eco', settled: true });
    expect(stepAutoQuality(state, 'incline')).toBe(state);
  });

  it('« auto » ne monte jamais au-dessus du standard au jalon 1', () => {
    expect(AUTO_CEILING).toBe('standard');
    const state = createAutoQuality();
    expect(stepAutoQuality(state, 'incline')).toBe(state);
  });

  it('remonter puis redescendre aussitôt fixe le niveau le plus léger', () => {
    let state = stepAutoQuality(createAutoQuality(), 'decline');
    state = stepAutoQuality(state, 'incline');
    expect(state.level).toBe('standard');
    state = stepAutoQuality(state, 'decline');
    expect(state).toMatchObject({ level: 'eco', settled: true });
  });

  it('pas de va-et-vient sans fin : au plus AUTO_MAX_CHANGES changements, et « fallback » fige', () => {
    let state = createAutoQuality();
    for (let i = 0; i < 10; i += 1) state = stepAutoQuality(state, i % 2 === 0 ? 'decline' : 'incline');
    expect(state.changes).toBeLessThanOrEqual(AUTO_MAX_CHANGES);
    expect(state.settled).toBe(true);
    expect(stepAutoQuality(createAutoQuality(), 'fallback')).toMatchObject({ level: 'standard', settled: true });
  });

  it('« auto » applique le niveau retenu ; sans cibles flottantes, toujours l’économie', () => {
    expect(resolveQuality('auto')).toBe('standard');
    expect(resolveQuality('auto', 'eco')).toBe('eco');
    expect(resolveQuality('max', 'eco')).toBe('max');
    expect(resolveQuality('max', 'standard', false)).toBe('eco');
  });
});

describe('étape C2 : peinture compilée d’avance', () => {
  it('une finition par programme : vernis oui/non × irisation oui/non', () => {
    const variants = programVariants(FINISHES);
    const keys = new Set(variants.map((item) => `${item.clearcoat > 0}-${item.iridescence > 0}`));
    expect(keys.size).toBe(variants.length);
    for (const item of FINISHES) expect(keys.has(`${item.clearcoat > 0}-${item.iridescence > 0}`), item.id).toBe(true);
  });
});

describe('étape C2 : mesure de cadence', () => {
  const frames = (ms: number[], calls = 130, triangles = 450_000): FrameSample[] =>
    ms.map((value) => ({ ms: value, calls, triangles }));

  it('cadence moyenne, pire centile, coût moyen par image', () => {
    const samples = [...frames(Array.from({ length: 99 }, () => 16)), ...frames([50])];
    const summary = summarizeFrames(samples);
    expect(summary).not.toBeNull();
    expect(summary?.frames).toBe(100);
    expect(summary?.fps).toBeCloseTo(1000 / ((99 * 16 + 50) / 100), 0);
    expect(summary?.worstFps).toBeCloseTo(1000 / 16, 0);
    expect(summary?.calls).toBe(130);
    expect(summary?.triangles).toBe(450_000);
  });

  it('le pire centile suit les images lentes quand elles dépassent 1 %', () => {
    const samples = frames([...Array.from({ length: 90 }, () => 16), ...Array.from({ length: 10 }, () => 40)]);
    expect(summarizeFrames(samples)?.worstFps).toBe(25);
  });

  it('sans image exploitable : pas de résultat', () => {
    expect(summarizeFrames([])).toBeNull();
    expect(summarizeFrames(frames([0, Number.NaN, -3]))).toBeNull();
  });
});
