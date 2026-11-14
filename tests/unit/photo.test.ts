// Jalon 1, cœur du rendu photo : cadrages, décalages sous-pixel, plan, export, accumulation.
import { describe, expect, it } from 'vitest';
import { FRAMING_IDS, FRAMING_LIMITS, FRAMINGS, framingById, type Framing } from '../../src/data/framings.ts';
import { QUALITY_LEVELS } from '../../src/render/quality.ts';
import {
  advance,
  blendWeight,
  createAccumulator,
  isComplete,
  keyChanged,
  nextWeight,
  observe,
  restart,
  shouldStop,
} from '../../src/render/photo/accumulate.ts';
import { framingPose } from '../../src/render/photo/framing.ts';
import { apertureOffset, halton, pixelJitter, projectionJitter } from '../../src/render/photo/jitter.ts';
import { EXPORT_WIDTH, exportSize, PHOTO_PLANS, photoPlan } from '../../src/render/photo/plan.ts';
import { fitCamera, orbitPosition } from '../../src/scene/fit.ts';

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

describe('cadrages', () => {
  it('cinq cadrages, identifiants et libellés uniques, dans l’ordre des identifiants', () => {
    expect(FRAMINGS).toHaveLength(5);
    expect(FRAMINGS.map((item) => item.id)).toEqual([...FRAMING_IDS]);
    expect(new Set(FRAMINGS.map((item) => item.label)).size).toBe(5);
    for (const item of FRAMINGS) expect(item.label.trim(), item.id).toBe(item.label);
    expect(new Set(FRAMINGS.map((item) => `${item.azimuth}/${item.polar}`)).size).toBe(5);
  });

  it('chaque cadrage reste dans les bornes et la caméra au-dessus du sol', () => {
    const limits = FRAMING_LIMITS;
    const fit = fitCamera(390, 844, 2.2);
    for (const item of FRAMINGS) {
      expect(item.distance, item.id).toBeGreaterThanOrEqual(limits.distance.min);
      expect(item.distance, item.id).toBeLessThanOrEqual(limits.distance.max);
      expect(item.polar, item.id).toBeGreaterThanOrEqual(limits.polar.min);
      expect(item.polar, item.id).toBeLessThanOrEqual(limits.polar.max);
      expect(item.targetHeight, item.id).toBeGreaterThanOrEqual(limits.targetHeight.min);
      expect(item.targetHeight, item.id).toBeLessThanOrEqual(limits.targetHeight.max);
      expect(Math.abs(item.targetAlong), item.id).toBeLessThanOrEqual(limits.targetAlong.max);
      expect(item.fovScale, item.id).toBeGreaterThanOrEqual(limits.fovScale.min);
      expect(item.fovScale, item.id).toBeLessThanOrEqual(limits.fovScale.max);
      expect(item.aperture, item.id).toBeGreaterThanOrEqual(limits.aperture.min);
      expect(item.aperture, item.id).toBeLessThanOrEqual(limits.aperture.max);
      expect(Math.abs(item.azimuth), item.id).toBeLessThanOrEqual(Math.PI);
      const pose = framingPose(item, { fov: fit.fov, distance: fit.distance, target: [0, 0.6, 0], halfLength: 2.2, frontX: 1 });
      expect(pose.position[1], item.id).toBeGreaterThan(0);
      expect(pose.fov, item.id).toBeGreaterThan(0);
      expect(pose.fov, item.id).toBeLessThanOrEqual(80);
    }
  });

  it('framingPose retrouve orbitPosition quand le cadrage ne décale rien', () => {
    const neutral: Framing = {
      id: 'avant',
      label: 'Neutre',
      short: 'Neutre',
      azimuth: 0.7,
      polar: 1.2,
      distance: 1,
      targetHeight: 1,
      targetAlong: 0,
      fovScale: 1,
      aperture: 0,
    };
    const fit = fitCamera(390, 844, 2.2);
    const pose = framingPose(neutral, { fov: fit.fov, distance: fit.distance, target: [0, 0.6, 0], halfLength: 2.2, frontX: 1 });
    const expected = orbitPosition([0, 0.6, 0], fit.distance, 0.7, 1.2);
    pose.position.forEach((value, i) => expect(value).toBeCloseTo(expected[i] ?? Number.NaN, 9));
    expect(pose.fov).toBe(fit.fov);
  });

  it('avant et arrière sont de part et d’autre du véhicule, le ras du sol vise la roue avant', () => {
    const base = { fov: 40, distance: 5, target: [0, 0.6, 0] as const, halfLength: 2.2, frontX: 1 };
    expect(framingPose(framingById('avant'), base).position[0]).toBeGreaterThan(0);
    expect(framingPose(framingById('arriere'), base).position[0]).toBeLessThan(0);
    expect(framingPose(framingById('ras-du-sol'), base).target[0]).toBeGreaterThan(0);
    expect(framingPose(framingById('plongee'), base).position[1]).toBeGreaterThan(
      framingPose(framingById('profil'), base).position[1],
    );
    expect(() => framingById('inconnu' as never)).toThrow(RangeError);
  });
});

describe('décalages sous-pixel', () => {
  it('suite de Halton : valeurs connues et erreurs', () => {
    expect([1, 2, 3].map((i) => halton(i, 2))).toEqual([0.5, 0.25, 0.75]);
    expect(halton(1, 3)).toBeCloseTo(1 / 3, 12);
    expect(halton(2, 3)).toBeCloseTo(2 / 3, 12);
    expect(halton(3, 3)).toBeCloseTo(1 / 9, 12);
    expect(halton(0, 2)).toBe(0);
    expect(() => halton(-1, 2)).toThrow(RangeError);
    expect(() => halton(1, 1)).toThrow(RangeError);
    expect(() => halton(1.5, 2)).toThrow(RangeError);
  });

  it('les décalages restent dans [-0,5 ; 0,5] et ne se répètent pas', () => {
    const seen = new Set<string>();
    for (let frame = 0; frame < 1024; frame += 1) {
      const { x, y } = pixelJitter(frame);
      expect(x).toBeGreaterThanOrEqual(-0.5);
      expect(x).toBeLessThanOrEqual(0.5);
      expect(y).toBeGreaterThanOrEqual(-0.5);
      expect(y).toBeLessThanOrEqual(0.5);
      seen.add(`${x}/${y}`);
    }
    expect(seen.size).toBe(1024);
  });

  it('la moyenne du décalage tend vers zéro et les quadrants sont équilibrés', () => {
    for (const count of [16, 32, 64]) {
      const points = Array.from({ length: count }, (_, frame) => pixelJitter(frame));
      expect(Math.abs(mean(points.map((p) => p.x)))).toBeLessThan(0.05);
      expect(Math.abs(mean(points.map((p) => p.y)))).toBeLessThan(0.05);
    }
    const points = Array.from({ length: 64 }, (_, frame) => pixelJitter(frame));
    for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const inQuadrant = points.filter((p) => Math.sign(p.x || 1) === sx && Math.sign(p.y || 1) === sy).length;
      expect(inQuadrant).toBeGreaterThanOrEqual(12);
      expect(inQuadrant).toBeLessThanOrEqual(20);
    }
  });

  it('conversion en décalage de projection : proportionnelle et bornée par un pixel', () => {
    const { x, y } = projectionJitter({ x: 0.5, y: -0.25 }, 1000, 500);
    expect(x).toBeCloseTo(0.001, 12);
    expect(y).toBeCloseTo(-0.001, 12);
    for (let frame = 0; frame < 64; frame += 1) {
      const p = projectionJitter(pixelJitter(frame), 390, 844);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(1 / 390 + 1e-12);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(1 / 844 + 1e-12);
    }
    expect(() => projectionJitter({ x: 0, y: 0 }, 0, 10)).toThrow(RangeError);
    expect(() => projectionJitter({ x: 0, y: 0 }, 10, Number.NaN)).toThrow(RangeError);
  });

  it('disque d’ouverture : dans le disque, centré, nul si le rayon est nul', () => {
    const radius = 0.012;
    const points = Array.from({ length: 64 }, (_, frame) => apertureOffset(frame, radius));
    for (const p of points) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(radius + 1e-12);
    expect(Math.abs(mean(points.map((p) => p.x)))).toBeLessThan(radius * 0.1);
    expect(Math.abs(mean(points.map((p) => p.y)))).toBeLessThan(radius * 0.1);
    const closed = apertureOffset(5, 0);
    expect(Math.abs(closed.x) + Math.abs(closed.y)).toBe(0);
    expect(() => apertureOffset(0, -1)).toThrow(RangeError);
  });
});

describe('plan du rendu photo', () => {
  it('chaque niveau de qualité a un plan, de plus en plus fourni, tenant dans une à deux secondes', () => {
    for (const level of QUALITY_LEVELS) {
      const plan = photoPlan(level);
      expect(plan, level).toBe(PHOTO_PLANS[level]);
      expect(Number.isInteger(plan.frames), level).toBe(true);
      expect(plan.frames, level).toBeGreaterThanOrEqual(8);
      expect(plan.frames, level).toBeLessThanOrEqual(64);
      expect([512, 1024, 2048], level).toContain(plan.probeSize);
      expect(plan.maxMs, level).toBeGreaterThanOrEqual(1000);
      expect(plan.maxMs, level).toBeLessThanOrEqual(2000);
    }
    expect(PHOTO_PLANS.eco.frames).toBeLessThan(PHOTO_PLANS.standard.frames);
    expect(PHOTO_PLANS.standard.frames).toBeLessThan(PHOTO_PLANS.max.frames);
    expect(PHOTO_PLANS.eco.depthOfField).toBe(false);
    expect(PHOTO_PLANS.max.depthOfField).toBe(true);
  });
});

describe('taille d’export', () => {
  const area = (tiles: readonly { width: number; height: number }[]) =>
    tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0);

  it('portrait de téléphone : 2160 de large, proportions gardées, tuiles dans la limite', () => {
    const size = exportSize(390, 844, EXPORT_WIDTH, 4096);
    expect(size.width).toBe(2160);
    expect(size.height).toBe(Math.round((844 * 2160) / 390));
    expect(size.factor).toBeCloseTo(2160 / 390, 12);
    expect(size.tiled).toBe(true);
    expect(size.columns).toBe(1);
    expect(size.rows).toBe(2);
    for (const tile of size.tiles) {
      expect(tile.width).toBeLessThanOrEqual(4096);
      expect(tile.height).toBeLessThanOrEqual(4096);
    }
    expect(area(size.tiles)).toBe(size.width * size.height);
  });

  it('paysage : une seule tuile quand tout tient', () => {
    const size = exportSize(844, 390, EXPORT_WIDTH, 4096);
    expect(size.width).toBe(2160);
    expect(size.height).toBe(Math.round((390 * 2160) / 844));
    expect(size.tiled).toBe(false);
    expect(size.tiles).toEqual([{ x: 0, y: 0, width: size.width, height: size.height }]);
  });

  it('petite limite de texture : découpe en colonnes et en rangées', () => {
    const size = exportSize(390, 844, EXPORT_WIDTH, 2048);
    expect(size.columns).toBe(2);
    expect(size.rows).toBe(3);
    expect(size.tiles).toHaveLength(6);
  });

  it('propriétés sur des formats variés : limites respectées, tuiles jointives, sans trou ni recouvrement', () => {
    const screens = [[320, 568], [360, 800], [390, 844], [412, 915], [768, 1024], [844, 390], [1920, 1080], [100, 3000]];
    for (const [w, h] of screens as [number, number][]) {
      for (const max of [1024, 2048, 4096, 8192, 16384]) {
        const size = exportSize(w, h, EXPORT_WIDTH, max);
        expect(size.width).toBe(2160);
        expect(size.height).toBeGreaterThanOrEqual(1);
        expect(size.tiles).toHaveLength(size.columns * size.rows);
        expect(size.tiled).toBe(size.tiles.length > 1);
        expect(area(size.tiles)).toBe(size.width * size.height);
        for (const [index, tile] of size.tiles.entries()) {
          expect(tile.width).toBeGreaterThanOrEqual(1);
          expect(tile.height).toBeGreaterThanOrEqual(1);
          expect(tile.width).toBeLessThanOrEqual(max);
          expect(tile.height).toBeLessThanOrEqual(max);
          expect(tile.x + tile.width).toBeLessThanOrEqual(size.width);
          expect(tile.y + tile.height).toBeLessThanOrEqual(size.height);
          const column = index % size.columns;
          const row = Math.floor(index / size.columns);
          const left = size.tiles[row * size.columns + column - 1];
          const above = size.tiles[(row - 1) * size.columns + column];
          expect(tile.x).toBe(column === 0 || !left ? 0 : left.x + left.width);
          expect(tile.y).toBe(row === 0 || !above ? 0 : above.y + above.height);
        }
      }
    }
  });

  it('refuse les entrées invalides', () => {
    expect(() => exportSize(0, 800)).toThrow(RangeError);
    expect(() => exportSize(390, -1)).toThrow(RangeError);
    expect(() => exportSize(Number.NaN, 800)).toThrow(RangeError);
    expect(() => exportSize(Number.POSITIVE_INFINITY, 800)).toThrow(RangeError);
    expect(() => exportSize(390, 844, 0)).toThrow(RangeError);
    expect(() => exportSize(390, 844, 2160, 0)).toThrow(RangeError);
  });
});

describe('accumulation', () => {
  it('poids de la moyenne courante : 1 / (n + 1)', () => {
    expect([0, 1, 2, 3, 9].map(blendWeight)).toEqual([1, 1 / 2, 1 / 3, 1 / 4, 1 / 10]);
    expect(() => blendWeight(-1)).toThrow(RangeError);
    expect(() => blendWeight(0.5)).toThrow(RangeError);
  });

  it('mélanger avec ces poids donne la moyenne exacte des images', () => {
    const values = [0.9, 0.1, 0.4, 0.7, 0.25, 0.6, 0.33, 0.8];
    let acc = 0;
    let state = createAccumulator(values.length);
    for (const value of values) {
      const w = nextWeight(state);
      acc = acc * (1 - w) + value * w;
      state = advance(state);
    }
    expect(acc).toBeCloseTo(mean(values), 12);
    expect(isComplete(state)).toBe(true);
  });

  it('s’arrête à la cible et ne la dépasse pas', () => {
    let state = createAccumulator(3);
    for (let i = 0; i < 5; i += 1) state = advance(state);
    expect(state.count).toBe(3);
    expect(shouldStop(state, 0, 1500)).toBe(true);
    expect(() => createAccumulator(0)).toThrow(RangeError);
    expect(() => createAccumulator(2.5)).toThrow(RangeError);
  });

  it('s’arrête aussi au délai, mais jamais sans une image au moins', () => {
    let state = createAccumulator(32);
    expect(shouldStop(state, 5000, 1500)).toBe(false);
    state = advance(state);
    expect(shouldStop(state, 1499, 1500)).toBe(false);
    expect(shouldStop(state, 1500, 1500)).toBe(true);
  });

  it('repart de zéro quand la caméra bouge, pas quand elle reste immobile', () => {
    const pose = [1, 2, 3, 0, 0.6, 0, 40, 390, 844];
    let state = observe(createAccumulator(16), pose);
    expect(state.count).toBe(0);
    for (let i = 0; i < 6; i += 1) state = advance(state);
    expect(observe(state, [...pose])).toBe(state);
    expect(observe(state, pose.map((v) => v + 1e-6)).count).toBe(6);
    const moved = observe(state, [1.5, ...pose.slice(1)]);
    expect(moved.count).toBe(0);
    expect(moved.target).toBe(16);
    expect(moved.key?.[0]).toBe(1.5);
    expect(observe(advance(moved), [...pose, 1]).count).toBe(0);
    expect(keyChanged(null, pose)).toBe(true);
    expect(keyChanged(pose, [...pose.slice(0, 8), Number.NaN])).toBe(true);
  });

  it('restart garde l’empreinte et accepte une nouvelle cible', () => {
    const state = advance(advance(observe(createAccumulator(8), [1, 2])));
    const again = restart(state, 12);
    expect(again).toEqual({ count: 0, target: 12, key: [1, 2] });
    expect(restart(state).target).toBe(8);
  });
});
