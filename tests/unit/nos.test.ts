import { describe, expect, it } from 'vitest';
import { effetNosRepos, NOS_RENDU, suivreNos } from '../../src/data/nos.ts';

describe('effet du NOS à l’image', () => {
  it('rien hors poussée : tout à zéro, aucun temps compté', () => {
    const e = suivreNos(effetNosRepos(), false, 0, 1 / 60, false);
    expect([e.force, e.fov, e.recul, e.tremble, e.teinte, e.traits]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(e.depuis).toBe(Infinity);
  });

  it('à l’envoi : coup de champ et tremblement qui retombent, recul et dards tenus toute la poussée', () => {
    const e = effetNosRepos();
    suivreNos(e, true, 0.7, 1 / 60, false);
    expect(e.depuis).toBe(0);
    const fov0 = e.fov;
    const tremble0 = e.tremble;
    expect(fov0).toBeCloseTo(NOS_RENDU.camera.coup * 0.7, 6);
    for (let i = 0; i < 90; i += 1) suivreNos(e, true, 1, 1 / 60, false);
    expect(e.depuis).toBeCloseTo(1.5, 6);
    expect(e.fov).toBeLessThan(fov0 / 10);
    expect(e.tremble).toBeLessThan(tremble0 / 10);
    expect(e.recul).toBeCloseTo(NOS_RENDU.camera.recul, 6);
    expect(e.force).toBe(1);
    expect(e.traits).toBe(1);
    expect(e.teinte).toBeCloseTo(NOS_RENDU.ecran.teinte, 6);
  });

  it('à la fin : s’éteint avec la poussée du pilote, puis tout revient à zéro', () => {
    const e = effetNosRepos();
    suivreNos(e, true, 1, 1 / 60, false);
    suivreNos(e, false, 0.4, 1 / 60, false);
    expect(e.force).toBeCloseTo(0.4, 6);
    suivreNos(e, false, 0.001, 1 / 60, false);
    expect(e.force).toBe(0);
    expect(e.depuis).toBe(Infinity);
    // Un nouvel envoi repart de zéro.
    suivreNos(e, true, 0.2, 1 / 60, false);
    expect(e.depuis).toBe(0);
  });

  it('moins de mouvement : ni champ, ni recul, ni tremblement, ni traits ; dards et teinte discrète', () => {
    const e = suivreNos(effetNosRepos(), true, 1, 1 / 60, true);
    expect([e.fov, e.recul, e.tremble, e.traits]).toEqual([0, 0, 0, 0]);
    expect(e.force).toBe(1);
    expect(e.teinte).toBeCloseTo(NOS_RENDU.ecran.teinteReduite, 6);
    expect(e.teinte).toBeLessThan(NOS_RENDU.ecran.teinte);
  });

  it('valeurs folles : bornées, sans NaN', () => {
    const e = suivreNos(effetNosRepos(), true, Number.NaN, Number.NaN, false);
    expect(e.force).toBe(0);
    suivreNos(e, true, 3, 1 / 60, false);
    expect(e.force).toBe(1);
  });
});
