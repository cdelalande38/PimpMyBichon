// Lumières proches de la sortie de nuit (src/drive/scene/profil.ts) : fondu à l'entrée et à la sortie
// de la liste (aucune flaque ni aucun reflet qui s'allume d'un coup), et tronçons voulus jusqu'à la
// brume (aucun tronçon qui surgit dans le champ).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MapRoute } from '../../src/data/mapTypes.ts';
import { chunkAt, chunkPlan, DRIVE_PROFILES, lampWeights, nearestLamps, wantedChunks } from '../../src/drive/scene/profil.ts';
import { QUALITY_LEVELS } from '../../src/render/quality.ts';

/** Poids des lampes d'une rangée tous les 30 m le long de X, vues depuis x. */
function weightsAt(x: number, keep = 4, real = 2) {
  const lamps = new Float32Array(40 * 3);
  for (let i = 0; i < 40; i += 1) lamps.set([i * 30, 8, 0], i * 3);
  const order = new Int32Array(keep + 1);
  const dist = new Float32Array(keep + 1);
  const out = new Float32Array((keep + 1) * 3);
  const found = nearestLamps(lamps, 40, x, 0, keep + 1, out, order, dist);
  const w = new Float32Array(keep * 2);
  const r = new Float32Array(real);
  const n = lampWeights(dist, found, keep, real, 0.35, w, r);
  // Poids par lampadaire (rang dans la rangée).
  const byLamp = new Map<number, { w: number; diffuse: number; real: number }>();
  for (let k = 0; k < n; k += 1) byLamp.set(order[k] ?? -1, { w: w[k * 2] ?? 0, diffuse: w[k * 2 + 1] ?? 0, real: k < real ? (r[k] ?? 0) : 0 });
  return byLamp;
}

describe('lumières proches : fondus', () => {
  it('une lampe qui sort de la liste a un poids nul à cet instant ; aucun saut en avançant', () => {
    let prev = weightsAt(300);
    for (let x = 300.5; x < 600; x += 0.5) {
      const cur = weightsAt(x);
      for (let i = 0; i < 40; i += 1) {
        const a = prev.get(i);
        const b = cur.get(i);
        const wa = a?.w ?? 0;
        const wb = b?.w ?? 0;
        expect(Math.abs(wa - wb), `poids de la lampe ${i} à ${x} m`).toBeLessThan(0.08);
        // Lumière totale (vraie + calculée) continue elle aussi.
        expect(Math.abs((a ? a.diffuse + a.real : 0) - (b ? b.diffuse + b.real : 0)), `lumière de la lampe ${i} à ${x} m`).toBeLessThan(0.08);
      }
      prev = cur;
    }
  });

  it('peu de lampes : toutes pleines', () => {
    const order = new Int32Array(5);
    const dist = new Float32Array(5);
    const out = new Float32Array(15);
    const found = nearestLamps(new Float32Array([0, 8, 0, 30, 8, 0]), 2, 0, 0, 5, out, order, dist);
    const w = new Float32Array(8);
    const r = new Float32Array(2);
    expect(lampWeights(dist, found, 4, 2, 0.35, w, r)).toBe(2);
    expect(w[0]).toBe(1);
    expect(r[0]).toBe(1);
    expect(w[1]).toBe(0);
  });
});

describe('tronçons voulus', () => {
  const chunks = Array.from({ length: 12 }, (_, i) => ({ from: i * 250, to: (i + 1) * 250, box: [i * 250, 0, -50, (i + 1) * 250, 10, 50] }));
  it('va devant jusqu’à la portée de la brume, et prend ce qui est près de la caméra', () => {
    const out: number[] = [];
    wantedChunks(chunks, 10, 1, 1, false, 800, Number.NaN, Number.NaN, 0, 8, out);
    expect(out.sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    // Boîte d'un tronçon lointain sur la route, mais proche de la caméra (lacet).
    const loop = chunks.map((c, i) => (i === 9 ? { ...c, box: [0, 0, 60, 200, 10, 120] } : c));
    wantedChunks(loop, 10, 1, 1, false, 300, 100, 0, 200, 8, out);
    expect(out).toContain(9);
    // Plafond.
    wantedChunks(chunks, 10, 1, 1, false, 5000, Number.NaN, Number.NaN, 0, 5, out);
    expect(out.length).toBe(5);
  });
});

describe('chaussée chargée devant contre la brume, sur toutes les cartes', () => {
  // Signalé sur téléphone : « à un moment la route est coupée ». La chaussée chargée d'un seul tenant
  // devant le véhicule doit toujours dépasser la distance où la brume a tout mangé (fogFar), à chaque
  // niveau de qualité, sur chaque carte fabriquée ; et les tronçons chargés restent dans le budget du
  // décor (§ 8 : 150 000 triangles en standard, 250 000 en max ; l'économie tenue au budget standard).
  const BUDGET: Record<string, number> = { eco: 150_000, standard: 150_000, max: 250_000 };
  const root = join(__dirname, '..', '..', 'public', 'assets', 'maps');
  const maps = existsSync(root) ? readdirSync(root).filter((d) => existsSync(join(root, d, 'route.json'))) : [];
  it.each(maps)('%s', (id) => {
    const route = JSON.parse(readFileSync(join(root, id, 'route.json'), 'utf8')) as MapRoute;
    const chunks = route.chunks;
    const n = chunks.length;
    for (const level of QUALITY_LEVELS) {
      const p = DRIVE_PROFILES[level];
      const plan = chunkPlan(p);
      const out: number[] = [];
      let worst = Infinity;
      let tri = 0;
      for (let s = 0; s < route.length; s += 10) {
        wantedChunks(chunks, s, p.behind, p.ahead, route.loop, plan.reach, Number.NaN, Number.NaN, 0, plan.cap, out);
        tri = Math.max(tri, out.reduce((t, k) => t + (chunks[k]?.triangles ?? 0), 0));
        // Chaussée chargée d'un seul tenant devant s.
        let i = chunkAt(chunks, s);
        let end = chunks[i]?.to ?? 0;
        let wrap = 0;
        for (;;) {
          let j = i + 1;
          if (j >= n) {
            if (!route.loop) {
              end = Infinity;
              break;
            }
            j = 0;
            wrap += chunks[n - 1]?.to ?? 0;
          }
          if (!out.includes(j) || end - s > 5000) break;
          end = (chunks[j]?.to ?? 0) + wrap;
          i = j;
        }
        worst = Math.min(worst, end - s);
      }
      expect(worst, `${id}, ${level} : chaussée chargée devant au pire`).toBeGreaterThanOrEqual(p.fogFar);
      expect(tri, `${id}, ${level} : triangles des tronçons chargés`).toBeLessThanOrEqual(BUDGET[level] ?? 150_000);
    }
  });
});
