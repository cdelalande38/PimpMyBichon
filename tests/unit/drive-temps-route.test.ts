// Temps de ROUTE (temps de simulation, pas de 0,1 s comme une image en rendu logiciel) des étapes que
// guettent les parcours de la sortie de nuit (tests/e2e/sortie*.spec.ts, virage.spec.ts). Depuis la
// vague R, ces parcours comptent leurs délais en secondes de route (tests/e2e/helpers.ts,
// attendreSurLaRoute) et non d'horloge : la CI tombe par moments sous une image par seconde. Ce test
// tient l'écart : chaque étape doit rester sous la moitié du délai que lui donne son parcours ; si la
// physique (src/drive/pilote.ts, src/data/adherence.ts) rend la voiture plus molle, il le dit ici, avant
// la CI.
//
// Relevés du 18 novembre 2026 (vague Q, 4f0fbfc → vague R, 76bd309), concept plein gaz à la main depuis
// l'arrêt sous la pluie : orange 3,3 → 4,0 s, deuxième 3,6 → 4,5 s ; au sec, rien n'a bougé. Pilote
// automatique : deuxième inchangée (3,5 s) ; Cox, 275 m depuis le bas de la rampe : 26,2 → 27,7 s sous
// la pluie. Frein à fond (− 10 km/h) et reprise (+ 5 km/h) : 1,1 à 1,3 s, avant comme après.

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MapRoute } from '../../src/data/mapTypes.ts';
import { vehicleById } from '../../src/data/vehicles.ts';
import type { DriveInput, Weather } from '../../src/drive/contrat.ts';
import { createPilot, performanceDe, type PilotWithProfile } from '../../src/drive/pilote.ts';
import { createRail } from '../../src/drive/rail.ts';

const FILE = 'public/assets/maps/plateau-matheysin/route.json';
const DT = 0.1;
const AUTO: DriveInput = { auto: true, throttle: 0, brake: 0, lane: 0 };
const GAZ: DriveInput = { auto: false, throttle: 1, brake: 0, lane: 0, steer: 0 };
const FREIN: DriveInput = { auto: false, throttle: 0, brake: 1, lane: 0, steer: 0 };

describe.skipIf(!existsSync(FILE))('temps de route des étapes guettées par les parcours', () => {
  const rail = existsSync(FILE) ? createRail(JSON.parse(readFileSync(FILE, 'utf8')) as MapRoute) : null;

  function pilote(id: string, weather: Weather, at = 0): { pilot: PilotWithProfile; kind: 'car' | 'bike' } {
    const vehicle = vehicleById(id);
    if (!vehicle || !rail) throw new Error(id);
    const pilot = createPilot(rail, performanceDe(vehicle));
    pilot.setWeather(weather);
    pilot.reset(at);
    return { pilot, kind: vehicle.kind };
  }

  /** Temps de route (s) jusqu'à ce que `ok` soit vrai, au plus `max` s. */
  function jusqua(p: { pilot: PilotWithProfile; kind: 'car' | 'bike' }, input: DriveInput, ok: () => boolean, max = 120): number {
    let t = 0;
    while (!ok() && t < max) {
      p.pilot.step(DT, input, p.kind);
      t += DT;
    }
    return t;
  }

  const kmh = (p: { pilot: PilotWithProfile }) => p.pilot.motion.speed * 3.6;

  it('à la main, plein gaz depuis l’arrêt : orange, deuxième et + 30 km/h (sortie-pilotage, au sec) ; pluie à peine plus lente', () => {
    for (const weather of ['sec', 'pluie'] as const) {
      const p = pilote('concept', weather);
      const train = p.pilot.train!;
      const orange = jusqua(p, GAZ, () => train.rpm >= train.zones.orange);
      const deuxieme = jusqua(p, GAZ, () => train.gear >= 2) + orange;
      // Délais des parcours : 12 s de route pour l'orange et pour le rapport suivant, 15 s pour + 30 km/h.
      expect(orange, `${weather} : orange (s de route)`).toBeLessThan(12 / 2);
      expect(deuxieme, `${weather} : deuxième (s de route)`).toBeLessThan(12 / 2);
      const p30 = pilote('concept', weather);
      expect(jusqua(p30, GAZ, () => kmh(p30) > 30), `${weather} : + 30 km/h`).toBeLessThan(15 / 2);
      if (weather === 'pluie') {
        // Sous la pluie, la motricité bride la poussée : un quart de plus au plus, pas une voiture molle.
        const sec = pilote('concept', 'sec');
        const orangeSec = jusqua(sec, GAZ, () => sec.pilot.train!.rpm >= sec.pilot.train!.zones.orange);
        expect(orange / orangeSec).toBeLessThan(1.35);
      }
    }
  });

  it('sous la pluie, à la main (sortie.spec) : 25 km/h, − 10 km/h au frein à fond, + 5 km/h à la reprise', () => {
    const p = pilote('concept', 'pluie');
    // Délais du parcours : 8 s de route pour 25 km/h, 6 s pour le frein et pour la reprise.
    expect(jusqua(p, GAZ, () => kmh(p) > 25)).toBeLessThan(8 / 2);
    jusqua(p, GAZ, () => kmh(p) > 28);
    const avant = kmh(p);
    expect(jusqua(p, FREIN, () => kmh(p) < avant - 10)).toBeLessThan(6 / 2);
    const arrete = kmh(p);
    expect(jusqua(p, GAZ, () => kmh(p) > arrete + 5)).toBeLessThan(6 / 2);
  });

  it('pilote automatique (aperçu, sortie-son) : lancé, deuxième rapport ; la poussée du NOS finit', () => {
    for (const id of ['concept', 'sportive']) {
      for (const weather of ['sec', 'pluie'] as const) {
        const p = pilote(id, weather);
        // Délais des parcours : 10 s de route pour 10 km/h, 20 s pour 20 m, 15 s pour la deuxième.
        expect(jusqua(p, AUTO, () => kmh(p) > 10), `${id} ${weather} : 10 km/h`).toBeLessThan(10 / 2);
        const q = pilote(id, weather);
        expect(jusqua(q, AUTO, () => q.pilot.motion.s > 20), `${id} ${weather} : 20 m`).toBeLessThan(20 / 2);
        const r = pilote(id, weather);
        expect(jusqua(r, AUTO, () => r.pilot.train!.gear >= 2), `${id} ${weather} : deuxième`).toBeLessThan(15 / 2);
      }
    }
    // NOS à la main (sortie-son) : la poussée s'arrête d'elle-même ; délai du parcours : 12 s de route.
    const n = pilote('sportive', 'sec');
    jusqua(n, GAZ, () => kmh(n) > 20);
    n.pilot.step(DT, { ...GAZ, nos: 1 }, n.kind);
    expect(n.pilot.train!.nos).toBe(true);
    expect(jusqua(n, { ...GAZ, nos: 1 }, () => !n.pilot.train!.nos)).toBeLessThan(12 / 2);
  });

  it('pilote automatique au sec, du bas de la rampe : après le lacet (275 m) en moins de la moitié du délai de virage.spec', () => {
    for (const id of ['cox', 'sportive']) {
      const p = pilote(id, 'sec', 0);
      // Délai du parcours : 60 s de route.
      expect(jusqua(p, AUTO, () => p.pilot.motion.s > 275), `${id} : 275 m`).toBeLessThan(60 / 2);
    }
  });
});
