// Adhérence à la main (src/data/adherence.ts, src/drive/pilote.ts ; demande du 17 novembre 2026) :
// la météo abaisse la tenue en courbe et allonge les freinages ; l'arrière d'une propulsion puissante
// décroche plein gaz en appui ou au lever de pied brutal, se rattrape en contre-braquant, part en
// tête-à-queue si l'on insiste ; une traction sous-vire ; une moto glisse un peu, sans tête-à-queue ;
// les roues patinent au départ plein gaz sous la pluie et sur la neige. Jamais de frein posé par l'app.
// Les tableaux de chiffres (par météo et par véhicule) sont écrits dans la sortie du test.

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ADHERENCE_METEO } from '../../src/data/adherence.ts';
import type { MapRoute } from '../../src/data/mapTypes.ts';
import { VEHICLES, vehicleById } from '../../src/data/vehicles.ts';
import type { DriveInput, Weather } from '../../src/drive/contrat.ts';
import { createPilot, motriciteDe, patinageDe, performanceDe, tenueEssieu, transmissionDe, type PilotWithProfile } from '../../src/drive/pilote.ts';
import { createRail } from '../../src/drive/rail.ts';
import { PATINAGE, roueEnPlus, rouesMotrices, type Wheel } from '../../src/drive/scene/roues.ts';
import { BOUCLES_ROUTE, type Glisse } from '../../src/data/bruitages.ts';
import { glisseBrute, niveauBoucle, suiviGlisseRepos, suivreGlisse, type EtatRoute } from '../../src/audio/sfx/regles.ts';
import { Quaternion, Vector3, Object3D } from 'three';

const WEATHERS: Weather[] = ['sec', 'pluie', 'neige'];

/** Tableaux de chiffres : dans la sortie du test, et dans le fichier que nomme PMB_RELEVES s'il est donné. */
function relever(text: string): void {
  console.log(text);
  const file = process.env.PMB_RELEVES;
  if (file) appendFileSync(file, `${text}\n`);
}
const MAPS = ['plateau-matheysin', 'monaco-ville', 'monaco-circuit', 'miami-beach'];
const DT = 1 / 60;

/** Route d'essai : une ligne droite de `length` m, chaussée de `width` m (assez large pour glisser sans toucher). */
function straight(length: number, width: number): MapRoute {
  const step = 2;
  const rail: number[] = [];
  for (let x = 0; x <= length; x += step) rail.push(x, 0, 0);
  const total = (rail.length / 3 - 1) * step;
  return {
    format: 'pmb-carte',
    version: 1,
    id: 'essai',
    loop: false,
    length: total,
    step,
    rail,
    sections: [{ from: 0, to: total, ground: 'sol', urban: false, lanes: 2, width }],
    chunks: [],
    starts: [],
    far: null,
  };
}

const main = (throttle: number, steer: number, brake = 0): DriveInput => ({ auto: false, throttle, brake, lane: 0, steer });

function pilotOf(id: string, weather: Weather, width = 400): PilotWithProfile {
  const vehicle = vehicleById(id);
  if (!vehicle) throw new Error(id);
  const pilot = createPilot(createRail(straight(3000, width)), performanceDe(vehicle));
  pilot.setWeather(weather);
  return pilot;
}

/** Lancé en ligne droite à `kmh`, à la main. */
function lancer(pilot: PilotWithProfile, kind: 'car' | 'bike', kmh: number): void {
  for (let i = 0; i < 60 * 90 && pilot.motion.speed * 3.6 < kmh; i += 1) pilot.step(DT, main(1, 0), kind);
}

/** Tient la vitesse (gaz proportionnel) en braquant de `steer` pendant `seconds` s ; rend l'accélération latérale la plus forte prise. */
function tenir(pilot: PilotWithProfile, kind: 'car' | 'bike', kmh: number, steer: number, seconds: number): number {
  let best = 0;
  for (let t = 0; t < seconds; t += DT) {
    const throttle = Math.min(1, Math.max(0, (kmh / 3.6 - pilot.motion.speed) * 0.6 + 0.15));
    pilot.step(DT, main(throttle, steer), kind);
    best = Math.max(best, Math.abs(pilot.lateral));
  }
  return best;
}

/** Distance d'arrêt de 100 à 0 km/h, frein plein, droit (m). */
function arret(id: string, weather: Weather): number {
  const vehicle = vehicleById(id)!;
  const pilot = pilotOf(id, weather, 12);
  lancer(pilot, vehicle.kind, 98);
  // Croisière tenue, puis frein plein ; la distance est ramenée à 100 km/h pile.
  tenir(pilot, vehicle.kind, 100, 0, 2);
  const v0 = pilot.motion.speed;
  const s0 = pilot.motion.s;
  for (let i = 0; i < 60 * 60 && pilot.motion.speed > 0.05; i += 1) pilot.step(DT, main(0, 0, 1), vehicle.kind);
  return ((pilot.motion.s - s0) * (100 / 3.6) ** 2) / (v0 * v0);
}

/** Accélération latérale tenue : au braquage franc à 70 km/h (40 km/h sur la neige), gaz pour tenir la vitesse (m/s²). */
function lateraleTenue(id: string, weather: Weather): number {
  const vehicle = vehicleById(id)!;
  const pilot = pilotOf(id, weather);
  const kmh = weather === 'neige' ? 40 : 70;
  lancer(pilot, vehicle.kind, kmh);
  return tenir(pilot, vehicle.kind, kmh, -0.85, 1.5);
}

describe('adhérence selon la météo : chiffres par véhicule', () => {
  it('l’adhérence de la météo est une part de celle du sec : la pluie moins, la neige nettement moins', () => {
    expect(ADHERENCE_METEO.sec.adherence).toBe(1);
    expect(ADHERENCE_METEO.pluie.adherence).toBeLessThan(0.85);
    expect(ADHERENCE_METEO.neige.adherence).toBeLessThan(ADHERENCE_METEO.pluie.adherence * 0.7);
  });

  it('en courbe, on tient moins sous la pluie, nettement moins sur la neige ; les freinages s’allongent', () => {
    const rows: string[] = [];
    for (const vehicle of VEHICLES) {
      const lat = WEATHERS.map((w) => lateraleTenue(vehicle.id, w));
      const stop = WEATHERS.map((w) => arret(vehicle.id, w));
      rows.push(`${vehicle.id.padEnd(9)} latérale tenue (m/s²) sec ${lat[0]!.toFixed(1)} · pluie ${lat[1]!.toFixed(1)} · neige ${lat[2]!.toFixed(1)}   |   arrêt 100→0 (m) sec ${stop[0]!.toFixed(0)} · pluie ${stop[1]!.toFixed(0)} · neige ${stop[2]!.toFixed(0)}`);
      expect(lat[1]!).toBeLessThan(lat[0]! * 0.85);
      expect(lat[2]!).toBeLessThan(lat[1]! * 0.7);
      expect(stop[1]!).toBeGreaterThan(stop[0]! * 1.2);
      expect(stop[2]!).toBeGreaterThan(stop[1]! * 1.5);
      // Au sec, un freinage franc : de l'ordre de 55 à 70 m.
      expect(stop[0]!).toBeGreaterThan(45);
      expect(stop[0]!).toBeLessThan(75);
    }
    relever(rows.join('\n'));
  });
});

describe('patinage au départ plein gaz', () => {
  it('fonctions pures : rien sous la motricité, plein au-delà ; la courbe prend sa part de l’adhérence', () => {
    expect(patinageDe(5, 6)).toBe(0);
    expect(patinageDe(6, 6)).toBe(0);
    expect(patinageDe(9, 6)).toBeGreaterThan(0.7);
    expect(patinageDe(20, 6)).toBe(1);
    expect(tenueEssieu(9, 1, 0)).toBeCloseTo(9, 6);
    expect(tenueEssieu(9, 1, 0.6)).toBeCloseTo(7.2, 6);
    expect(tenueEssieu(9, 1, 1.2)).toBe(0);
    const concept = performanceDe(vehicleById('concept')!);
    expect(transmissionDe(concept)).toBe('propulsion');
    expect(transmissionDe(performanceDe(vehicleById('van')!))).toBe('traction');
    expect(transmissionDe({ kind: 'car' })).toBe('traction');
    expect(transmissionDe({ kind: 'bike', transmission: 'traction' })).toBe('propulsion');
    expect(motriciteDe(concept, 'neige')).toBeLessThan(motriciteDe(concept, 'pluie'));
  });

  it('au sec rien ne patine ; sous la pluie la voiture puissante patine ; sur la neige, franchement ; les roues motrices tournent plus vite que la route', () => {
    const rows: string[] = [];
    const table: Record<string, Record<Weather, number>> = {};
    for (const vehicle of VEHICLES) {
      table[vehicle.id] = { sec: 0, pluie: 0, neige: 0 };
      const cells: string[] = [];
      for (const w of WEATHERS) {
        const pilot = pilotOf(vehicle.id, w, 12);
        let spin = 0;
        let t50 = 0;
        for (let t = 0; t < 20 && pilot.motion.speed * 3.6 < 50; t += DT) {
          const m = pilot.step(DT, main(1, 0), vehicle.kind);
          spin = Math.max(spin, m.spin ?? 0);
          // Toujours droit : le patinage en ligne droite ne fait pas pivoter la caisse.
          expect(Math.abs(m.drift ?? 0)).toBeLessThan(1e-6);
          t50 = t + DT;
        }
        table[vehicle.id]![w] = spin;
        cells.push(`${w} patinage ${spin.toFixed(2)}, 0→50 en ${t50.toFixed(1)} s`);
      }
      rows.push(`${vehicle.id.padEnd(9)} ${cells.join(' · ')}`);
    }
    relever(rows.join('\n'));
    for (const vehicle of VEHICLES) {
      const row = table[vehicle.id]!;
      expect(row.sec).toBe(0);
      expect(row.neige).toBeGreaterThanOrEqual(row.pluie);
    }
    expect(table.concept!.pluie).toBeGreaterThan(0.2);
    expect(table.concept!.neige).toBeGreaterThan(0.8);
    expect(table.sportive!.neige).toBeGreaterThan(0.5);
  });
});

describe('l’arrière décroche, à la main', () => {
  /** En appui à `kmh`, braquage `steer`, gaz `throttle` : relevé de la dérive. */
  function appui(id: string, weather: Weather, kmh: number) {
    const vehicle = vehicleById(id)!;
    const pilot = pilotOf(id, weather);
    lancer(pilot, vehicle.kind, kmh);
    tenir(pilot, vehicle.kind, kmh, -0.55, 1.2);
    return { pilot, kind: vehicle.kind };
  }

  it('propulsion puissante plein gaz en appui : la caisse se met en travers, rattrapée en contre-braquant ; sans frein posé par l’app', () => {
    const { pilot, kind } = appui('concept', 'sec', 60);
    expect(Math.abs(pilot.motion.drift ?? 0)).toBeLessThan(0.03);
    let maxDrift = 0;
    let t = 0;
    for (; t < 3 && maxDrift < 0.35; t += DT) {
      const m = pilot.step(DT, main(1, -0.7), kind);
      maxDrift = Math.max(maxDrift, m.drift ?? 0);
      expect(m.braking).toBe(false);
    }
    relever(`concept, sec, 60 km/h en appui puis plein gaz : dérive ${((maxDrift * 180) / Math.PI).toFixed(0)}° en ${t.toFixed(2)} s, glissement ${(pilot.motion.slip ?? 0).toFixed(2)}`);
    // Dérive franche, vers l'intérieur du virage (à gauche), entendue par le son de dérapage.
    expect(maxDrift).toBeGreaterThan(0.3);
    expect(pilot.motion.slip ?? 0).toBeGreaterThan(0.6);
    // Le cap de la caisse comprend la dérive.
    expect((pilot.motion.yaw ?? 0) - (pilot.motion.drift ?? 0)).toBeLessThanOrEqual(0.6 + 1e-9);
    // Contre-braquer (à droite) et lever un peu le pied : la caisse se remet dans l'axe de la marche.
    let caught = -1;
    let steerSeen = 0;
    for (let k = 0; k < 4 / DT; k += 1) {
      const m = pilot.step(DT, main(0.3, 0.8), kind);
      steerSeen = Math.min(steerSeen, m.steer ?? 0);
      if (Math.abs(m.drift ?? 0) < 0.05 && caught < 0) caught = k * DT;
    }
    relever(`  contre-braqué : dérive sous 3° après ${caught.toFixed(2)} s`);
    // Roues braquées à l'opposé du virage pendant le rattrapage.
    expect(steerSeen).toBeLessThan(-0.02);
    expect(caught).toBeGreaterThan(0);
    expect(caught).toBeLessThan(2.5);
  });

  it('en insistant (braqué dans le virage, plein gaz), tête-à-queue ; puis la caisse se remet dans l’axe au pas', () => {
    const { pilot, kind } = appui('concept', 'sec', 60);
    let maxDrift = 0;
    let t = 0;
    for (; t < 6 && maxDrift < 2.5; t += DT) {
      const m = pilot.step(DT, main(1, -1), kind);
      maxDrift = Math.max(maxDrift, Math.abs(m.drift ?? 0));
    }
    relever(`concept, insiste : dérive ${((maxDrift * 180) / Math.PI).toFixed(0)}° en ${t.toFixed(2)} s, ${(pilot.motion.speed * 3.6).toFixed(0)} km/h`);
    expect(maxDrift).toBeGreaterThan(Math.PI / 2);
    for (let k = 0; k < 15 / DT; k += 1) pilot.step(DT, main(0, 0), kind);
    expect(pilot.motion.speed).toBeLessThan(3);
    expect(Math.abs(pilot.motion.drift ?? 0)).toBeLessThan(0.05);
  });

  it('lever de pied brutal en courbe : l’arrière de la Cox décroche ; au gaz tenu, rien', () => {
    const run = (lift: boolean) => {
      const vehicle = vehicleById('cox')!;
      const pilot = pilotOf('cox', 'sec');
      lancer(pilot, 'car', 70);
      // En appui à la limite, gaz en grand.
      for (let t = 0; t < 1.5; t += DT) pilot.step(DT, main(1, -0.9), vehicle.kind);
      let maxDrift = 0;
      for (let t = 0; t < 2; t += DT) {
        const m = pilot.step(DT, main(lift ? 0 : 1, -0.9), vehicle.kind);
        maxDrift = Math.max(maxDrift, m.drift ?? 0);
      }
      return maxDrift;
    };
    const lifted = run(true);
    const held = run(false);
    relever(`cox, sec, 70 km/h à la limite : lever de pied → dérive ${((lifted * 180) / Math.PI).toFixed(1)}° ; gaz tenu → ${((held * 180) / Math.PI).toFixed(1)}°`);
    expect(lifted).toBeGreaterThan(0.12);
    expect(held).toBeLessThan(0.03);
  });

  it('une traction sous-vire : plein gaz en appui, le van élargit (glissement de l’avant), sa caisse ne pivote pas', () => {
    const { pilot, kind } = appui('van', 'pluie', 45);
    let maxDrift = 0;
    let slip = 0;
    for (let t = 0; t < 3; t += DT) {
      const m = pilot.step(DT, main(1, -1), kind);
      maxDrift = Math.max(maxDrift, Math.abs(m.drift ?? 0));
      slip = Math.max(slip, m.slip ?? 0);
    }
    relever(`van, pluie, plein gaz en appui : dérive ${((maxDrift * 180) / Math.PI).toFixed(1)}°, glissement ${slip.toFixed(2)}`);
    expect(maxDrift).toBeLessThan(0.05);
    expect(slip).toBeGreaterThan(0.3);
  });

  it('les motos : l’arrière glisse un peu, jamais de tête-à-queue', () => {
    for (const vehicle of VEHICLES.filter((v) => v.kind === 'bike')) {
      for (const w of WEATHERS) {
        const pilot = pilotOf(vehicle.id, w);
        lancer(pilot, 'bike', 50);
        let maxDrift = 0;
        for (let t = 0; t < 5; t += DT) maxDrift = Math.max(maxDrift, Math.abs(pilot.step(DT, main(1, -1), 'bike').drift ?? 0));
        expect(maxDrift).toBeLessThanOrEqual(0.3 + 1e-9);
      }
    }
  });

  it('le pilote automatique ne glisse ni ne patine, sous les trois météos', () => {
    for (const w of WEATHERS) {
      const pilot = pilotOf('concept', w);
      for (let t = 0; t < 20; t += DT) {
        const m = pilot.step(DT, { auto: true, throttle: 0, brake: 0, lane: 0 }, 'car');
        expect(m.drift ?? 0).toBe(0);
        expect(m.spin ?? 0).toBe(0);
      }
    }
  });
});

describe('le pilote automatique tient la route sous les trois météos', () => {
  for (const id of MAPS) {
    const file = new URL(`../../public/assets/maps/${id}/route.json`, import.meta.url);
    describe.skipIf(!existsSync(file))(id, () => {
      for (const w of WEATHERS) {
        // Un trajet entier simulé par véhicule : large délai, la machine peut être chargée (agents, parcours).
        it(w, () => {
          const route = JSON.parse(readFileSync(file, 'utf8')) as MapRoute;
          const rail = createRail(route);
          const rows: string[] = [];
          for (const vehicle of VEHICLES) {
            const perf = performanceDe(vehicle);
            const pilot = createPilot(rail, perf);
            pilot.setWeather(w);
            const mu = perf.grip * ADHERENCE_METEO[w].adherence;
            const end = rail.loop ? rail.length : rail.length - 1;
            let travelled = 0;
            let last = pilot.motion.s;
            let t = 0;
            const lats: number[] = [];
            let maxBrake = 0;
            const step = 1 / 10;
            while (t < 4000 && travelled < end && !pilot.motion.finished) {
              const m = pilot.step(step, { auto: true, throttle: 0, brake: 0, lane: 0 }, vehicle.kind);
              t += step;
              travelled += rail.loop ? (m.s - last + rail.length) % rail.length : m.s - last;
              last = m.s;
              if (m.speed > 3) lats.push(Math.abs(pilot.lateral));
              maxBrake = Math.max(maxBrake, -m.accel);
            }
            lats.sort((a, b) => a - b);
            // Accélération latérale tenue : celle de 99 % du parcours (la courbure du rail a des pointes d'un instant).
            const maxLat = lats[Math.floor(lats.length * 0.99)] ?? 0;
            rows.push(`${vehicle.id} ${((travelled / t) * 3.6).toFixed(0)} km/h de moyenne, latérale ${maxLat.toFixed(1)} m/s² (99 %, pointe ${(lats[lats.length - 1] ?? 0).toFixed(1)} ; tenue ${mu.toFixed(1)}), freinage ≤ ${maxBrake.toFixed(1)} m/s²`);
            expect(travelled, `${vehicle.id} boucle`).toBeGreaterThanOrEqual(end - 1);
            // Il tient la route : jamais au-delà de ce que les pneus tiennent sous cette météo.
            expect(maxLat, `${vehicle.id} latérale`).toBeLessThan(mu);
            expect(maxBrake, `${vehicle.id} freinage`).toBeLessThan(7 * ADHERENCE_METEO[w].adherence);
          }
          relever(`${id} ${w} :\n  ${rows.join('\n  ')}`);
        }, 60_000);
      }
    });
  }
});

describe('roues qui patinent et son du patinage', () => {
  it('roues motrices selon la transmission : l’arrière d’une propulsion, l’avant d’une traction, toutes en intégrale', () => {
    const wheel = (front: boolean): Wheel => ({ node: new Object3D(), base: new Quaternion(), axis: new Vector3(0, 0, 1), radius: 0.3, ...(front ? { steer: new Vector3(0, 1, 0) } : {}) });
    const wheels = [wheel(true), wheel(true), wheel(false), wheel(false)];
    rouesMotrices(wheels, 'propulsion');
    expect(wheels.map((w) => w.driven)).toEqual([false, false, true, true]);
    rouesMotrices(wheels, 'traction');
    expect(wheels.map((w) => w.driven)).toEqual([true, true, false, false]);
    rouesMotrices(wheels, 'integrale');
    expect(wheels.every((w) => w.driven)).toBe(true);
    // Patinage plein : la bande de roulement va bien plus vite que la route ; rien sans patinage.
    expect(roueEnPlus(0)).toBe(0);
    expect(roueEnPlus(1)).toBe(PATINAGE.vitesse);
    expect(roueEnPlus(Number.NaN)).toBe(0);
    expect(PATINAGE.vitesse).toBeGreaterThan(8);
  });

  it('la boucle « burnout » suit le patinage, dès l’arrêt ; le dérapage long suit la glisse ; aucune ne joue l’autre', () => {
    const burnout = BOUCLES_ROUTE.find((b) => b.emplacement === 'burnout');
    const derapage = BOUCLES_ROUTE.find((b) => b.emplacement === 'derapage-long');
    expect(burnout?.glisse?.source).toBe('patinage');
    const etat = (part: Partial<EtatRoute>): EtatRoute => ({ vitesseKmh: 0, pluie: 0, neige: 0, mouille: 0, abri: 0, nos: false, ...part });
    expect(niveauBoucle(burnout!, etat({ patinage: 0 }))).toBe(0);
    expect(niveauBoucle(burnout!, etat({ patinage: 1 }))).toBeGreaterThan(0.5);
    expect(niveauBoucle(burnout!, etat({ glisse: 1 }))).toBe(0);
    expect(niveauBoucle(derapage!, etat({ patinage: 1, vitesseKmh: 60 }))).toBe(0);
    expect(glisseBrute(burnout!, etat({ patinage: 0.7, glisse: 0.2 }))).toBe(0.7);
    expect(glisseBrute(derapage!, etat({ patinage: 0.7, glisse: 0.2 }))).toBe(0.2);
    // Au départ arrêté (0 km/h), le suivi s'allume ; plus bas sur la neige.
    const suivi = suiviGlisseRepos();
    let v = 0;
    for (let i = 0; i < 30; i += 1) v = suivreGlisse(suivi, 1, 0, 0.1, burnout!.glisse as Glisse);
    expect(v).toBeGreaterThan(0.9);
    expect(niveauBoucle(burnout!, etat({ patinage: 1, neige: 1, mouille: 1 }))).toBeLessThan(niveauBoucle(burnout!, etat({ patinage: 1 })));
  });

  it('le pilote publie le patinage : une propulsion sur la neige, plein gaz depuis l’arrêt', () => {
    const pilot = pilotOf('concept', 'neige', 12);
    let spin = 0;
    for (let t = 0; t < 1; t += DT) spin = Math.max(spin, pilot.step(DT, main(1, 0), 'car').spin ?? 0);
    expect(spin).toBeGreaterThan(0.8);
    expect(pilot.transmission).toBe('propulsion');
    // Le pied levé, le patinage retombe.
    for (let t = 0; t < 1; t += DT) pilot.step(DT, main(0, 0), 'car');
    expect(pilot.motion.spin ?? 0).toBeLessThan(0.05);
  });
});
