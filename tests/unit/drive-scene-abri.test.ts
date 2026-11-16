// Météo locale de la sortie de nuit (src/drive/scene/abri.ts) : sous un tunnel, ni pluie ni neige,
// chaussée qui sèche après l'entrée et se remouille à la sortie ; attributs posés au chargement.

import { describe, expect, it } from 'vitest';
import type { RailSection } from '../../src/data/mapTypes.ts';
import { dryAt, facadeAttribute, localWeather, nearestSpan, roadAttribute, SHELTER, shelteredAt, tunnelLamps, tunnelSpans } from '../../src/drive/scene/abri.ts';

const sec = (from: number, to: number, ground: RailSection['ground'] = 'sol', width = 7): RailSection => ({ from, to, ground, urban: false, lanes: 2, width });
const SECTIONS: RailSection[] = [sec(0, 500), sec(500, 640, 'tunnel', 8), sec(640, 806, 'tunnel', 8), sec(806, 1500), sec(1500, 1560, 'tunnel')];

describe('abri : météo locale sous les tunnels', () => {
  it('fusionne les sections de tunnel contiguës', () => {
    const spans = tunnelSpans(SECTIONS);
    expect(spans).toEqual([
      { from: 500, to: 806, halfWidth: 4 },
      { from: 1500, to: 1560, halfWidth: 3.5 },
    ]);
  });

  it('la météo locale est nulle sous la voûte, entière dehors', () => {
    const spans = tunnelSpans(SECTIONS);
    const sky = { wet: 1, rain: 1, snow: 1 };
    const out = { wet: 0, rain: 0, snow: 0 };
    for (const s of [520, 600, 700, 800, 1530]) {
      localWeather(sky, spans, s, out);
      expect(out.rain, `pluie à ${s} m`).toBe(0);
      expect(out.snow, `neige à ${s} m`).toBe(0);
    }
    localWeather(sky, spans, 650, out);
    expect(out.wet).toBe(0);
    for (const s of [100, 499, 807, 1200, 1600]) {
      localWeather(sky, spans, s, out);
      expect(out).toEqual(sky);
    }
  });

  it('la chaussée sèche progressivement après l’entrée et se remouille avant la sortie', () => {
    const spans = tunnelSpans(SECTIONS);
    expect(dryAt(spans, 499)).toBe(0);
    expect(dryAt(spans, 503)).toBeLessThan(0.05);
    expect(dryAt(spans, 520)).toBeGreaterThan(0.1);
    expect(dryAt(spans, 520)).toBeLessThan(0.9);
    expect(dryAt(spans, 500 + SHELTER.dryIn)).toBeCloseTo(1, 5);
    expect(dryAt(spans, 700)).toBe(1);
    expect(dryAt(spans, 800)).toBeLessThan(0.9);
    expect(dryAt(spans, 806)).toBeLessThan(0.05);
    // Croissante à l'entrée, décroissante à la sortie, sans saut de plus de 10 % par mètre.
    let prev = 0;
    for (let s = 495; s <= 810; s += 1) {
      const d = dryAt(spans, s);
      expect(Math.abs(d - prev), `saut à ${s} m`).toBeLessThan(0.1);
      prev = d;
    }
    expect(shelteredAt(spans, 501)).toBe(1);
    expect(shelteredAt(spans, 499)).toBe(0);
    expect(nearestSpan(spans, 1400)?.from).toBe(1500);
    expect(nearestSpan([], 1400)).toBeNull();
  });

  it('pose abscisse, écart à l’axe, part au sec et demi-largeur sur la chaussée', () => {
    // Rail droit le long de +X, pas de 2 m, de 0 à 1000 m.
    const rail: number[] = [];
    for (let i = 0; i <= 500; i += 1) rail.push(i * 2, 0, 0);
    const spans = tunnelSpans(SECTIONS);
    // Deux sommets relatifs à l'origine (600, 0, 0) : sur l'axe, et 3 m à gauche de la marche (−Z).
    const attr = roadAttribute([0, 0, 0, 10, 0, -3], [600, 0, 0], rail, 2, 590, 640, SECTIONS, spans);
    expect(attr[0]).toBeCloseTo(600, 3);
    expect(attr[1]).toBeCloseTo(0, 3);
    expect(attr[2]).toBe(1); // au sec, hors agglomération
    expect(attr[3]).toBe(-4);
    expect(attr[4]).toBeCloseTo(610, 3);
    expect(attr[5]).toBeCloseTo(3, 3);
  });

  it('pose pied, sommet et graine sur chaque triangle de mur, et des lampes de voûte', () => {
    const f = facadeAttribute([0, 0, 0, 1, 12, 0, 0, 12, 0], [0, 100, 0]);
    expect([f[0], f[1]]).toEqual([100, 112]);
    expect(f[2]).toBeGreaterThanOrEqual(0);
    expect(f[2]).toBeLessThan(1);
    expect(f[5]).toBe(f[2]);
    const rail: number[] = [];
    for (let i = 0; i <= 1000; i += 1) rail.push(i * 2, 10, 0);
    const lamps = tunnelLamps(tunnelSpans(SECTIONS), 450, 700, rail, 2);
    expect(lamps.length / 3).toBeGreaterThan(10);
    expect(lamps[1]).toBeCloseTo(10 + SHELTER.lampHeight, 5);
    for (let i = 0; i < lamps.length; i += 3) expect(lamps[i] as number).toBeGreaterThanOrEqual(500);
  });
});
