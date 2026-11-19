import { describe, expect, it } from 'vitest';
import type { MapRoute } from '../../src/data/mapTypes.ts';
import { effetNosRepos, NOS_RENDU, suivreNos } from '../../src/data/nos.ts';
import { VEHICLES } from '../../src/data/vehicles.ts';
import type { DriveInput } from '../../src/drive/contrat.ts';
import { createPilot, engineModel, performanceDe, PILOT } from '../../src/drive/pilote.ts';
import { createRail } from '../../src/drive/rail.ts';

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

describe('tous les véhicules crachent', () => {
  it('chaque véhicule du catalogue déclare au moins une sortie d’échappement, vers l’arrière', () => {
    for (const vehicle of VEHICLES) {
      expect(vehicle.exhaust?.outlets.length ?? 0, vehicle.id).toBeGreaterThan(0);
      for (const outlet of vehicle.exhaust!.outlets) expect(outlet.direction[0], vehicle.id).toBeLessThan(0);
    }
  });

  it('les traits de vitesse ont un réglage pour chaque moment, plus épais et plus soutenus de jour', () => {
    const { nuit, jour } = NOS_RENDU.ecran.traits;
    expect(jour.epaisseur).toBeGreaterThan(nuit.epaisseur);
    expect(jour.couleur).not.toBe(nuit.couleur);
  });
});

// La poussée (src/drive/pilote.ts, PILOT.nos) : une part de la puissance, ou au moins `pousseeMin` de plus.
describe('le NOS se sent sur chaque véhicule', () => {
  const longueur = 2000;
  const rail: number[] = [];
  for (let x = 0; x <= longueur; x += 2) rail.push(x, 0, 0);
  const droite = { format: 'pmb-carte', version: 1, id: 'essai', loop: false, length: longueur, step: 2, rail, sections: [{ from: 0, to: longueur, ground: 'sol', urban: false, lanes: 2, width: 7 }], chunks: [], starts: [], far: null } as MapRoute;

  /** Plein gaz à la main jusqu'à `depart` km/h, puis 3 s avec ou sans NOS : vitesse au bout (km/h). */
  function auBout(vehicle: (typeof VEHICLES)[number], depart: number, nos: boolean): number {
    const performance = performanceDe(vehicle);
    const pilot = createPilot(createRail(droite), performance);
    pilot.setHold(false);
    pilot.reset(10);
    const input: DriveInput = { auto: false, throttle: 1, brake: 0, lane: 0, nos: 0, assist: true };
    for (let t = 0; pilot.motion.speed * 3.6 < depart && t < 60; t += 0.1) pilot.step(0.1, input, performance.kind);
    if (nos) input.nos = 1;
    for (let i = 0; i < 30; i += 1) pilot.step(0.1, input, performance.kind);
    return pilot.motion.speed * 3.6;
  }

  for (const vehicle of VEHICLES) {
    it(`${vehicle.id} : depuis 60 et 100 km/h, au moins 12 km/h de plus en 3 s qu’à plein gaz sans NOS, au plus 30`, () => {
      for (const depart of [60, 100]) {
        const gain = auBout(vehicle, depart, true) - auBout(vehicle, depart, false);
        expect(gain, `depuis ${depart} km/h`).toBeGreaterThan(12);
        expect(gain, `depuis ${depart} km/h`).toBeLessThan(30);
      }
    });
  }

  it('sans NOS, rien ne change ; avec, au moins `pousseeMin` de plus sous le limiteur, et le kit nitro ajoute encore', () => {
    const cox = VEHICLES.find((v) => v.id === 'cox')!;
    const base = performanceDe(cox);
    const moteur = engineModel(base);
    const avecKit = engineModel({ ...base, nosBoost: 1 });
    for (const v of [5, 15, 25]) {
      expect(moteur.thrust(v, true, 5000)).toBeGreaterThanOrEqual(moteur.thrust(v, false, 5000) + PILOT.nos.pousseeMin - 1e-9);
      expect(avecKit.thrust(v, false, 5000)).toBe(moteur.thrust(v, false, 5000));
      expect(avecKit.thrust(v, true, 5000)).toBeGreaterThan(moteur.thrust(v, true, 5000));
    }
  });
});
