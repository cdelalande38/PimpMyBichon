// Sortie de nuit, scène : niveaux de qualité, fenêtre de tronçons, lampadaires proches, cadence de
// la télémétrie et pas de temps (src/drive/scene/profil.ts).

import { describe, expect, it } from 'vitest';
import { chunkAt, chunkWindow, DRIVE_PROFILES, due, fogDensity, nearestLamps, stepOf, TELEMETRY_INTERVAL_MS } from '../../src/drive/scene/profil.ts';
import { QUALITY_LEVELS } from '../../src/render/quality.ts';

const chunks = Array.from({ length: 10 }, (_, i) => ({ from: i * 400, to: (i + 1) * 400 }));

describe('niveaux de qualité de la sortie', () => {
  it('a un profil par niveau de l’app, et l’économie n’a ni reflet planaire ni faisceaux', () => {
    for (const level of QUALITY_LEVELS) expect(DRIVE_PROFILES[level]).toBeDefined();
    expect(DRIVE_PROFILES.eco.reflection).toBe(0);
    expect(DRIVE_PROFILES.eco.beams).toBe(false);
    // Pluie allégée : reflet planaire à 35 % de l'image en standard, à moitié en max (une image sur deux).
    expect(DRIVE_PROFILES.standard.reflection).toBe(0.35);
    expect(DRIVE_PROFILES.max.reflection).toBe(0.5);
  });

  it('garde moins de tronçons, d’arbres et de lampadaires calculés en économie', () => {
    const { eco, standard, max } = DRIVE_PROFILES;
    expect(eco.ahead).toBeLessThan(standard.ahead);
    expect(standard.ahead).toBeLessThanOrEqual(max.ahead);
    expect(eco.treeEvery).toBeGreaterThan(standard.treeEvery);
    expect(eco.lampLights).toBeLessThan(standard.lampLights);
    for (const p of [eco, standard, max]) expect(p.behind).toBeGreaterThanOrEqual(1);
  });

  it('ferme l’horizon par la brume avant la fin des tronçons gardés devant', () => {
    for (const level of QUALITY_LEVELS) {
      const p = DRIVE_PROFILES[level];
      // Au pire, le véhicule est au début de son tronçon : `ahead` tronçons de 400 m devant lui.
      expect(p.fogFar).toBeLessThanOrEqual((p.ahead + 1) * 400);
      expect(Math.exp(-((fogDensity(p.fogFar) * p.fogFar) ** 2))).toBeCloseTo(0.02, 3);
    }
  });
});

describe('fenêtre de tronçons', () => {
  it('trouve le tronçon d’une abscisse, borné aux extrémités', () => {
    expect(chunkAt(chunks, 0)).toBe(0);
    expect(chunkAt(chunks, 399)).toBe(0);
    expect(chunkAt(chunks, 401)).toBe(1);
    expect(chunkAt(chunks, 3999)).toBe(9);
    expect(chunkAt(chunks, 99999)).toBe(9);
    expect(chunkAt(chunks, -5)).toBe(0);
    expect(chunkAt([], 10)).toBe(-1);
  });

  it('garde un tronçon derrière et quelques-uns devant, sans sortir du parcours ouvert', () => {
    const out: number[] = [];
    expect(chunkWindow(chunks, 1000, 1, 2, false, out)).toEqual([1, 2, 3, 4]);
    expect(chunkWindow(chunks, 10, 1, 2, false, out)).toEqual([0, 1, 2]);
    expect(chunkWindow(chunks, 3990, 1, 2, false, out)).toEqual([8, 9]);
  });

  it('fait le tour d’un parcours en boucle, et réutilise le tableau donné', () => {
    const out: number[] = [];
    const same = chunkWindow(chunks, 3990, 1, 2, true, out);
    expect(same).toBe(out);
    expect(out).toEqual([8, 9, 0, 1]);
    expect(chunkWindow(chunks.slice(0, 2), 10, 1, 3, true, out)).toEqual([1, 0]);
  });
});

describe('lampadaires les plus proches', () => {
  const lamps = new Float32Array([100, 8, 0, 10, 8, 0, 50, 8, 0, -20, 8, 0, 30, 8, 0]);
  it('rend les plus proches dans l’ordre, et leur nombre', () => {
    const out = new Float32Array(9);
    const n = nearestLamps(lamps, 5, 0, 0, 3, out, new Int32Array(3), new Float32Array(3));
    expect(n).toBe(3);
    expect([out[0], out[3], out[6]]).toEqual([10, -20, 30]);
    expect(out[1]).toBe(8);
  });

  it('remet à zéro le reste quand il y en a moins que demandé', () => {
    const out = new Float32Array(12).fill(7);
    const n = nearestLamps(lamps, 2, 0, 0, 4, out, new Int32Array(4), new Float32Array(4));
    expect(n).toBe(2);
    expect([out[0], out[3]]).toEqual([10, 100]);
    expect(Array.from(out.slice(6))).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('ne rend rien sans lampadaire', () => {
    const out = new Float32Array(6);
    expect(nearestLamps(new Float32Array(0), 0, 0, 0, 2, out, new Int32Array(2), new Float32Array(2))).toBe(0);
  });
});

describe('boucle', () => {
  it('publie la télémétrie quatre fois par seconde au plus', () => {
    expect(TELEMETRY_INTERVAL_MS).toBeGreaterThanOrEqual(250);
    expect(due(1000, 900)).toBe(false);
    expect(due(1250, 1000)).toBe(true);
    expect(due(0, -Infinity)).toBe(true);
  });

  it('borne le pas à 0,1 s, l’annule en pause et le ralentit au ralenti', () => {
    expect(stepOf(0.016, false, false)).toBeCloseTo(0.016);
    expect(stepOf(0.5, false, false)).toBe(0.1);
    expect(stepOf(0.016, true, false)).toBe(0);
    expect(stepOf(0.02, false, true)).toBeCloseTo(0.005);
    expect(stepOf(-1, false, false)).toBe(0);
  });
});
