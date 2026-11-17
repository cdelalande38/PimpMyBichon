// Reflets de la caisse en sortie de nuit (lot « reflets », vague Q) : la sonde mobile est rendue
// faces effacées et sans environnement (src/render/probePass.ts), et la lumière des feux arrière
// éclaire la route sans brûler la caisse (TAIL_LIGHT, src/drive/scene/vehicule.tsx). Ce qui se
// mesure dans l'image (luminance de la caisse, contour, halo) se relève par la page src/dev/sortie
// (pmbSortie.caisse()) ; ici, ce qui se borne sans image.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cleanProbePass } from '../../src/render/probePass.ts';

interface TailLight {
  back: number;
  height: number;
  heightShare: number;
  aim: number;
  angle: number;
  penumbra: number;
  candela: { rest: number; brake: number; nos: number };
}
// Module .tsx : import dynamique, interface écrite ici (comme tests/unit/roues-place.test.ts).
const DRIVE_VEHICLE = '../../src/drive/scene/vehicule.tsx';
const { TAIL_LIGHT } = (await import(/* @vite-ignore */ DRIVE_VEHICLE)) as { TAIL_LIGHT: TailLight };

const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('passe de la sonde mobile', () => {
  it('efface chaque face et coupe l’environnement le temps du rendu, puis rend les réglages', () => {
    const gl = { autoClear: false };
    const scene = { environmentIntensity: 1 };
    const seen: Array<[boolean, number]> = [];
    cleanProbePass(gl, scene, () => seen.push([gl.autoClear, scene.environmentIntensity]));
    expect(seen).toEqual([[true, 0]]);
    expect(gl).toEqual({ autoClear: false });
    expect(scene).toEqual({ environmentIntensity: 1 });
  });

  it('rend les réglages même si le rendu échoue', () => {
    const gl = { autoClear: false };
    const scene = { environmentIntensity: 0.7 };
    expect(() =>
      cleanProbePass(gl, scene, () => {
        throw new Error('contexte perdu');
      }),
    ).toThrow('contexte perdu');
    expect(gl.autoClear).toBe(false);
    expect(scene.environmentIntensity).toBe(0.7);
  });

  it('la scène de sortie ne rend sa sonde que par cette passe', () => {
    const moteur = source('src/drive/scene/moteur.ts');
    const calls = moteur.match(/this\.probe\.step\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(moteur).toMatch(/cleanProbePass\(gl, scene, this\.probeStep\)/);
    expect(moteur).toMatch(/private readonly probeStep = \(\): void => \{[^}]*this\.probe\.step\(/);
  });
});

describe('lumière des feux arrière', () => {
  // Repère du véhicule : x vers l'avant, caisse de x = 0 (arrière) à 4,5 m, y = 0 au sol.
  const height = 1.5;
  const light = { x: -TAIL_LIGHT.back, y: Math.min(TAIL_LIGHT.height, height * TAIL_LIGHT.heightShare) };
  const axis = { x: -TAIL_LIGHT.aim + TAIL_LIGHT.back, y: -light.y };
  const axisLength = Math.hypot(axis.x, axis.y);
  /** Angle (rad) entre l'axe du projecteur et la direction d'un point (x, y, z). */
  const offAxis = (x: number, y: number, z: number) => {
    const v = { x: x - light.x, y: y - light.y, z };
    return Math.acos((v.x * axis.x + v.y * axis.y) / (Math.hypot(v.x, v.y, v.z) * axisLength));
  };

  it('laisse toute la caisse hors du cône', () => {
    let nearest = Math.PI;
    for (let x = 0; x <= 4.5; x += 0.25) for (let y = 0.1; y <= 2.2; y += 0.1) for (const z of [0, 0.5, 1]) nearest = Math.min(nearest, offAxis(x, y, z));
    // Le bord du cône est `angle` ; la caisse en reste à plus de 20° au-delà.
    expect(nearest).toBeGreaterThan(TAIL_LIGHT.angle + (20 * Math.PI) / 180);
  });

  it('éclaire la chaussée derrière le véhicule comme avant', () => {
    // Points de la route à 1, 2 et 4 m derrière la caisse : dans le cône, hors de la pénombre.
    const inner = TAIL_LIGHT.angle * (1 - TAIL_LIGHT.penumbra);
    for (const back of [1, 2, 4]) expect(offAxis(-back, 0, 0)).toBeLessThan(inner);
    // Même place et mêmes candelas que la lumière ponctuelle d'avant (5 cd à 0,35 m, 0,6 m de haut).
    expect(TAIL_LIGHT.back).toBeCloseTo(0.35);
    expect(TAIL_LIGHT.candela.rest).toBe(5);
  });

  it('garde les rapports du freinage et du NOS', () => {
    expect(TAIL_LIGHT.candela.brake / TAIL_LIGHT.candela.rest).toBeGreaterThan(2.5);
    expect(TAIL_LIGHT.candela.nos).toBeGreaterThan(TAIL_LIGHT.candela.brake);
  });
});
