// Tremblement du véhicule pendant la course (lot « tremblote », demande du 17 novembre 2026 : « parfois
// ils ont la tremblote »). Mesuré hors du navigateur par la boucle d'image rejouée
// (tests/unit/tremblote-outils.ts), à cadence irrégulière (16 à 50 ms, tirage fixe).
//
// Cause trouvée : la garde au sol des caméras (src/drive/cameras.ts, guardShot), sans mémoire d'une
// image à l'autre. Un obstacle de la sonde (case de 2 m qui garde le point le plus haut : bordure, mur,
// toit au bord de la chaussée) attrapé une image sur deux par les douze points de la ligne de visée, ou
// pris sous la caisse avec un relevé multiplié par 1/k, faisait sauter la caméra de poursuite de
// plusieurs mètres d'une image à l'autre : le véhicule bondissait à l'écran (jusqu'à 1 700 pixels en
// ville, en poursuite). Les deux premiers gardes-fous échouent sur l'ancienne garde et passent sur la
// nouvelle ; les bornes de la pose passaient déjà (aucune cause de ce côté).
//
// Écartées, chiffres à l'appui (cap, roulis, tangage, braquage : au plus 0,25° de saut d'image à image
// une fois la tendance retirée, moto au NOS comprise, à 60, 30 i/s et en cadence irrégulière, identiques
// avant et après) : tableau du rendu (TREMBLOTE_TABLE=<fichier.json> pour le refaire, quelques minutes).
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VEHICLES, vehicleById } from '../../src/data/vehicles.ts';
import { CAMERA_GUARD, cameraShot, createShot, guard, guardShot, type GroundSampler } from '../../src/drive/cameras.ts';
import { CAMERA_IDS, type CameraId, type DriveMotion, type Rail, type VehicleFrame } from '../../src/drive/contrat.ts';
import { createPilot, performanceDe, PILOT } from '../../src/drive/pilote.ts';
import { createRail } from '../../src/drive/rail.ts';
import { carteFabriquee, chargerRelief, chargerRoute, chiffres, rejouer, tremblement, type Cadence, type Joueur, type Scenario } from './tremblote-outils.ts';

const cox = vehicleById('cox')!;
const sportive = vehicleById('sportive')!;

/** Ligne droite de 600 m, plate. */
function ligneDroite(): Rail {
  const rail: number[] = [];
  for (let i = 0; i <= 300; i += 1) rail.push(i * 2, 0, 0);
  return createRail({ rail, step: 2, loop: false, sections: [], chunks: [], starts: [], far: null } as unknown as Parameters<typeof createRail>[0]);
}

/** Ligne droite de 300 m, puis trois quarts de cercle de rayon `radius` (m), plats. */
function pisteCourbe(radius: number): Rail {
  const rail: number[] = [];
  for (let i = 0; i <= 150; i += 1) rail.push(i * 2, 0, 0);
  const n = Math.ceil((Math.PI * 1.5 * radius) / 2);
  for (let i = 1; i <= n; i += 1) {
    const a = (i * 2) / radius;
    rail.push(300 + radius * Math.sin(a), 0, -radius * (1 - Math.cos(a)));
  }
  return createRail({ rail, step: 2, loop: false, sections: [], chunks: [], starts: [], far: null } as unknown as Parameters<typeof createRail>[0]);
}

/**
 * Sonde d'essai : chaussée plate à 0 ; sur le bas-côté gauche (z entre −4,8 et −4), une rangée de
 * murets fins (cases de 2 m, une sur deux à 2 m) que la ligne de visée de la poursuite traverse quand
 * le véhicule serre le bord gauche et pivote vers la droite.
 */
const MURETS: GroundSampler = {
  ground: (x, z) => (z > -4.8 && z < -4 && Math.floor(x / 2) % 2 === 0 ? 2 : 0),
  built: () => Number.NaN,
};

describe('garde au sol : plus de saut de caméra d’une image à l’autre', () => {
  it('une bordure fine prise une image sur deux ne fait plus bondir la poursuite (cadence irrégulière)', () => {
    const rail = ligneDroite();
    const motion: DriveMotion = { s: 0, speed: 25, accel: 0, offset: 0, roll: 0, dive: 0, braking: false, finished: false, pull: 0, yaw: 0 };
    const frame: VehicleFrame = { kind: 'car', position: [0, 0, 0], heading: 0, pitch: 0, roll: 0, halfLength: 1.9, halfWidth: 0.9, height: 1.4 };
    const shot = createShot();
    let t = 0;
    let s = 40;
    let last = Number.NaN;
    let worst = 0;
    let lifted = 0;
    const r = (() => {
      let x = 11;
      return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
    })();
    for (let n = 0; n < 400; n += 1) {
      const dt = 0.016 + 0.034 * r();
      t += dt;
      s += 25 * dt;
      // Le véhicule serre le bord gauche et la caméra, en retard, passe au-dessus des murets.
      motion.s = s;
      motion.offset = 3.3;
      motion.yaw = -0.25;
      frame.position = [s, 0, -3.3];
      frame.heading = -0.25;
      cameraShot('poursuite', frame, motion, rail, t, { yaw: 0, pitch: 0.3, distance: 7 }, shot);
      const raw = shot.position[1];
      guardShot(shot, MURETS);
      if (shot.position[1] > raw + 0.01) lifted += 1;
      if (last === last) worst = Math.max(worst, Math.abs(shot.position[1] - last));
      last = shot.position[1];
    }
    // La garde agit bien (les murets coupent la ligne de visée)…
    expect(lifted).toBeGreaterThan(50);
    // … mais la caméra ne saute plus : moins de 12 cm d'une image à l'autre (avant : plus de 1 m).
    expect(worst).toBeLessThan(0.12);
  });

  it.skipIf(!carteFabriquee('monaco-ville'))('monaco-ville, s 330 à 380 : le véhicule ne bondit plus à l’écran en poursuite', () => {
    const route = chargerRoute('monaco-ville');
    const rail = createRail(route);
    const relief = chargerRelief('monaco-ville', route);
    for (const cadence of ['irreguliere', '30', '60'] as Cadence[]) {
      const tr = rejouer({ rail, vehicle: cox, camera: 'poursuite', cadence, joueur: 'auto', from: 330, seconds: 5, warmup: 0.5, relief });
      expect(tr.s[tr.count - 1]).toBeGreaterThan(370);
      // Avant : 970 pixels d'une image à l'autre (caméra rapprochée puis relâchée, image par image).
      const y = tremblement(tr, tr.screenY);
      expect(y.pic, cadence).toBeLessThan(25);
      expect(y.saut, cadence).toBeLessThan(4);
    }
  }, 60_000);

  it('la garde reste instantanée sans plan de caméra avant elle, et pour l’embarquée', () => {
    const wall: GroundSampler = { ground: (x) => (x > -6 && x < -4 ? 3 : 0), built: () => Number.NaN };
    guard.id = '';
    guard.x = Number.NaN;
    const a = { position: [-10, 2, 0] as [number, number, number], target: [0, 0.6, 0] as [number, number, number], fov: 50, roll: 0 };
    guardShot(a, wall);
    const b = { position: [-10, 2, 0] as [number, number, number], target: [0, 0.6, 0] as [number, number, number], fov: 50, roll: 0 };
    guardShot(b, wall);
    expect(a.position).toEqual(b.position);
    expect(a.position[1] > 2 || a.position[0] > -10).toBe(true);
    expect(CAMERA_GUARD.fall).toBeGreaterThan(CAMERA_GUARD.rise);
  });
});

describe('pose du véhicule : bornes du saut d’image à image (cadence irrégulière)', () => {
  const rail = ligneDroite();
  it.each([
    ['cox', 'auto'],
    ['cox', 'main'],
    ['sportive', 'auto'],
    ['sportive', 'main'],
  ] as const)('%s, %s : cap, roulis et position vue de la poursuite', (id, joueur) => {
    const vehicle = vehicleById(id)!;
    const tr = rejouer({ rail, vehicle, camera: 'poursuite', cadence: 'irreguliere', joueur, from: 60, seconds: 12, relief: null });
    const c = chiffres(tr);
    expect(c.cap).toBeLessThan(0.15);
    expect(c.roulis).toBeLessThan(0.15);
    expect(c.ecranX).toBeLessThan(1);
    expect(c.ecranY).toBeLessThan(1);
  });

  it('le délai de réponse au manche n’a pas changé (cap à 63 % de son écart, 1/120 s près)', () => {
    // Manche poussé d'un coup à mi-course à 90 km/h en ligne droite : temps pour que le volant du pilote
    // atteigne 63 % de sa valeur (PILOT.free.tauIn), mesuré sur le braquage montré des roues.
    const pilot = createPilot(rail, performanceDe(cox));
    pilot.reset(50);
    const input = { auto: true, throttle: 0, brake: 0, lane: 0 as const, steer: 0 };
    for (let k = 0; k < 600 && pilot.motion.speed < 24; k += 1) pilot.step(1 / 60, input, 'car');
    const manual = { ...input, auto: false, throttle: 0.5 };
    for (let k = 0; k < 30; k += 1) pilot.step(1 / 60, manual, 'car');
    const steady = { ...manual, steer: 0.5 };
    let at63 = Number.NaN;
    const trace: number[] = [];
    for (let k = 0; k < 240; k += 1) {
      pilot.step(1 / 120, steady, 'car');
      trace.push(pilot.motion.steer ?? 0);
    }
    const final = trace[trace.length - 1]!;
    for (let k = 0; k < trace.length; k += 1) {
      if (Math.abs(trace[k]!) >= 0.63 * Math.abs(final)) {
        at63 = (k + 1) / 120;
        break;
      }
    }
    // Volant (tauIn 0,08 s), courbe d'expo, puis roues (tau 0,12 s) : 0,425 s avant le lot, à 10 % près.
    expect(at63).toBeGreaterThan(0.425 * 0.9);
    expect(at63).toBeLessThan(0.425 * 1.1);
    expect(PILOT.free.tauIn).toBe(0.08);
  });
});

// ——— Tableau avant et après (TREMBLOTE_TABLE=<fichier.json>) ———

describe.skipIf(!process.env.TREMBLOTE_TABLE)('tableau de mesure', () => {
  it('tous les scénarios', () => {
    const rows: Array<Record<string, unknown>> = [];
    const add = (nom: string, sc: Scenario) => {
      const tr = rejouer(sc);
      const c = chiffres(tr);
      const pic = tremblement(tr, tr.screenY).pic;
      rows.push({ nom, ...c, picEcranY: Math.round(pic * 10) / 10, images: tr.count });
    };
    const maps = ['monaco-ville', 'plateau-matheysin', 'monaco-circuit', 'miami-beach'].filter(carteFabriquee);
    for (const id of maps) {
      const route = chargerRoute(id);
      const rail = createRail(route);
      const relief = chargerRelief(id, route);
      const from = id === 'plateau-matheysin' ? 9900 : 200;
      for (const vehicle of VEHICLES) {
        // « vite » : à la main, bien au-dessus du profil ; « coupure » : de même, manche au neutre 100 à 300 ms toutes les 1,5 à 3 s.
        for (const joueur of ['auto', 'main', 'vite', 'coupure'] as Joueur[]) {
          add(`${id} ${vehicle.id} ${joueur} poursuite irr.`, { rail, vehicle, camera: 'poursuite', cadence: 'irreguliere', joueur, from, seconds: 60, relief });
        }
      }
      if (id === 'monaco-ville') {
        for (const camera of CAMERA_IDS as readonly CameraId[]) {
          for (const cadence of ['60', '30', 'irreguliere'] as Cadence[]) {
            add(`${id} cox auto ${camera} ${cadence}`, { rail, vehicle: cox, camera, cadence, joueur: 'auto', from: 0, seconds: 120, relief });
          }
        }
      }
      if (id === 'plateau-matheysin') {
        for (const vehicle of [cox, sportive]) {
          for (const joueur of ['bord', 'nos', 'freinage', 'feux', 'depart'] as Joueur[]) {
            add(`${id} ${vehicle.id} ${joueur} poursuite irr.`, { rail, vehicle, camera: 'poursuite', cadence: 'irreguliere', joueur, from: 2000, seconds: 15, relief });
          }
        }
        add(`${id} cox auto poursuite irr. 0-15 km`, { rail, vehicle: cox, camera: 'poursuite', cadence: 'irreguliere', joueur: 'auto', from: 0, seconds: 900, relief });
      }
    }
    // Sans relief (la pose seule, ligne droite) : cadences comparées.
    const straight = ligneDroite();
    for (const vehicle of [cox, sportive]) {
      for (const cadence of ['60', '30', 'irreguliere'] as Cadence[]) {
        add(`ligne droite ${vehicle.id} main poursuite ${cadence}`, { rail: straight, vehicle, camera: 'poursuite', cadence, joueur: 'main', from: 60, seconds: 15, relief: null });
      }
    }
    // Une seule coupure du manche (gaz et braquage au neutre), plein gaz, en ligne droite puis dans une
    // courbe de 150 m : écart le plus grand à la même course sans coupure, sur 1,5 s.
    const deg = 180 / Math.PI;
    for (const [nom, from, t0] of [['ligne droite', 20, 4], ['courbe R 150 m', 200, 6]] as const) {
      const rail = pisteCourbe(150);
      for (const vehicle of [cox, sportive]) {
        for (const d of [0.1, 0.2, 0.3]) {
          const base: Scenario = { rail, vehicle, camera: 'poursuite', cadence: 'irreguliere', joueur: 'gaz', from, seconds: t0 + 2, relief: null, warmup: 0.5 };
          const a = rejouer({ ...base, cuts: [] });
          const b = rejouer({ ...base, cuts: [[t0, t0 + d]] });
          const ecart = (key: 'roll' | 'viewHeading' | 'pitch' | 'screenX' | 'screenY', k = 1) => {
            let m = 0;
            for (let i = 0; i < Math.min(a.count, b.count); i += 1) if (a.t[i]! >= t0 && a.t[i]! <= t0 + 1.5) m = Math.max(m, Math.abs(a[key][i]! - b[key][i]!));
            return Math.round(m * k * 100) / 100;
          };
          rows.push({ nom: `coupure unique ${Math.round(d * 1000)} ms, ${nom}, ${vehicle.id}`, roulis: ecart('roll', deg), capVu: ecart('viewHeading', deg), tangage: ecart('pitch', deg), ecranX: ecart('screenX'), ecranY: ecart('screenY') });
        }
      }
    }
    writeFileSync(process.env.TREMBLOTE_TABLE!, JSON.stringify(rows, null, 1));
    expect(rows.length).toBeGreaterThan(20);
  }, 900_000);
});

