// Le manche virtuel de la sortie (src/ui/drive/manche.ts) : zone morte, progressif, signes, bornes.
import { describe, expect, it } from 'vitest';
import { axeManche, boutonManche, lireManche, lireManettePhysique, MANCHE } from '../../src/ui/drive/manche.ts';

const R = MANCHE.rayon;

describe('manche virtuel', () => {
  it('zone morte au centre : ni gaz, ni frein, ni placement', () => {
    expect(lireManche(0, 0)).toEqual({ throttle: 0, brake: 0, steer: 0 });
    const d = R * MANCHE.morte * 0.9;
    expect(lireManche(d, -d)).toEqual({ throttle: 0, brake: 0, steer: 0 });
  });

  it('vers le haut le gaz, vers le bas le frein, progressifs jusqu’à 1 au bord', () => {
    const half = lireManche(0, -R * 0.6);
    expect(half.throttle).toBeGreaterThan(0.4);
    expect(half.throttle).toBeLessThan(0.6);
    expect(half.brake).toBe(0);
    expect(lireManche(0, -R).throttle).toBe(1);
    expect(lireManche(0, -R * 3).throttle).toBe(1);
    const down = lireManche(0, R);
    expect(down).toEqual({ throttle: 0, brake: 1, steer: 0 });
    // Plus on pousse, plus ça tire : monotone.
    let last = -1;
    for (let k = 0; k <= 1.001; k += 0.05) {
      const t = lireManche(0, -R * k).throttle;
      expect(t).toBeGreaterThanOrEqual(last);
      last = t;
    }
  });

  it('sur les côtés le placement : gauche négatif, droite positif ; en diagonale, les deux', () => {
    expect(lireManche(-R, 0).steer).toBe(-1);
    expect(lireManche(R, 0).steer).toBe(1);
    const diag = lireManche(R * 0.6, -R * 0.6);
    expect(diag.steer).toBeGreaterThan(0.3);
    expect(diag.throttle).toBeGreaterThan(0.3);
    expect(diag.brake).toBe(0);
  });

  it('le bouton reste dans le rayon ; valeurs folles ramenées à zéro', () => {
    const [x, y] = boutonManche(300, 400, R);
    expect(Math.hypot(x, y)).toBeCloseTo(R, 6);
    expect(boutonManche(10, -5, R)).toEqual([10, -5]);
    expect(lireManche(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({ throttle: 0, brake: 0, steer: 0 });
    expect(axeManche(Number.NaN)).toBe(0);
    expect(axeManche(5)).toBe(1);
    expect(axeManche(-5)).toBe(-1);
  });
});

describe('manette physique (disposition standard)', () => {
  const pad = (axes: number[], buttons: Record<number, number>) => ({
    axes,
    buttons: Array.from({ length: 17 }, (_, i) => ({ value: buttons[i] ?? 0, pressed: (buttons[i] ?? 0) > 0.5 })),
  });
  const out = { throttle: 0, brake: 0, steer: 0, nos: false };

  it('gâchette droite le gaz, gauche le frein, manche gauche le placement, bouton du bas le NOS', () => {
    expect(lireManettePhysique(pad([0.05, 0], {}), out)).toEqual({ throttle: 0, brake: 0, steer: 0, nos: false });
    expect(lireManettePhysique(pad([-1, 0], { 7: 0.6, 0: 1 }), out)).toEqual({ throttle: 0.6, brake: 0, steer: -1, nos: true });
    expect(lireManettePhysique(pad([1, 0], { 6: 1 }), out)).toEqual({ throttle: 0, brake: 1, steer: 1, nos: false });
    expect(lireManettePhysique({ axes: [], buttons: [] }, out)).toEqual({ throttle: 0, brake: 0, steer: 0, nos: false });
  });
});
