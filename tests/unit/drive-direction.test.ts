// Direction à la main (src/drive/pilote.ts) : le joueur tient le braquage. Fonctions pures (courbure
// du volant, adhérence, glissement, bord), ligne droite tenue sans toucher, virage pris en braquant,
// virage raté sans braquer, bornes, arrêt ; aucun frein posé par l'app (le bord seul ralentit) ; passage
// de relais avec le pilote automatique sans à-coup ; et un joueur « raisonnable » qui boucle chaque
// carte avec chaque véhicule sans frotter plus de quelques fois.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MapRoute } from '../../src/data/mapTypes.ts';
import { VEHICLES } from '../../src/data/vehicles.ts';
import type { DriveInput, DrivePerformance, Rail } from '../../src/drive/contrat.ts';
import {
  bordLibre,
  courbureBraquage,
  courbureTenue,
  courbureVolant,
  createEtatLibre,
  createPilot,
  debordCap,
  glissementSousVirage,
  laneLimits,
  performanceDe,
  PILOT,
  type PilotWithProfile,
} from '../../src/drive/pilote.ts';
import { createPose, createRail } from '../../src/drive/rail.ts';

type Segment = { line: number } | { arc: number; turn: number };

/** Route d'essai : lignes droites et arcs (rayon, angle positif à gauche), chaussée de 7 m. */
function makeRoute(segments: Segment[], width = 7): MapRoute {
  const step = 2;
  const rail: number[] = [0, 0, 0];
  let x = 0;
  let z = 0;
  let heading = 0;
  let travelled = 0;
  let next = step;
  const fine = 0.05;
  for (const segment of segments) {
    const length = 'line' in segment ? segment.line : Math.abs(segment.turn) * segment.arc;
    const rate = 'line' in segment ? 0 : segment.turn / length;
    for (let d = 0; d < length - 1e-9; d += fine) {
      heading += rate * fine;
      x += Math.cos(heading) * fine;
      z -= Math.sin(heading) * fine;
      travelled += fine;
      if (travelled >= next - 1e-9) {
        rail.push(x, 0, z);
        next += step;
      }
    }
  }
  const length = (rail.length / 3 - 1) * step;
  return {
    format: 'pmb-carte',
    version: 1,
    id: 'essai',
    loop: false,
    length,
    step,
    rail,
    sections: [{ from: 0, to: length, ground: 'sol', urban: false, lanes: 2, width }],
    chunks: [],
    starts: [],
    far: null,
  };
}

const DT = 1 / 60;
const main = (throttle: number, steer: number, extra: Partial<DriveInput> = {}): DriveInput => ({ auto: false, throttle, brake: 0, lane: 0, steer, ...extra });

/** Lance le véhicule en pilote automatique jusqu'à la vitesse voulue (m/s), en ligne droite. */
function lancer(pilot: PilotWithProfile, kind: 'car' | 'bike', speed: number): void {
  for (let i = 0; i < 60 * 60 && pilot.motion.speed < speed; i += 1) pilot.step(DT, main(1, 0), kind);
}

/**
 * Un joueur « raisonnable » : il vise le milieu de la chaussée un peu plus loin (poursuite pure), avec
 * un retard de 0,2 s ; il règle sa vitesse sur la courbe qui vient (une part de l'adhérence), sans
 * dépasser une allure honnête pour le véhicule. Rend ce qu'il pousse sur le manche, gaz et frein.
 */
function joueur(rail: Rail, perf: DrivePerformance, cruise: number, dt = DT) {
  const pose = createPose();
  const ahead = createPose();
  const delay = Math.round(0.2 / dt);
  const queue = new Float64Array(delay);
  let at = 0;
  return (pilot: PilotWithProfile): DriveInput => {
    const m = pilot.motion;
    const v = m.speed;
    rail.poseAt(m.s, pose);
    const [tx, , tz] = pose.tangent;
    const fl = Math.hypot(tx, tz) || 1;
    const px = pose.position[0] + (tz / fl) * m.offset;
    const pz = pose.position[2] - (tx / fl) * m.offset;
    const h = pose.heading + (m.yaw ?? 0);
    const look = Math.max(7, v * 0.9);
    rail.poseAt(m.s + look, ahead);
    const dx = ahead.position[0] - px;
    const dz = ahead.position[2] - pz;
    const forward = dx * Math.cos(h) - dz * Math.sin(h);
    const left = -dx * Math.sin(h) - dz * Math.cos(h);
    const wantK = (2 * left) / Math.max(1, forward * forward + left * left);
    const full = courbureVolant(-1, v, perf.grip, perf.kind);
    const u = -Math.sign(wantK) * Math.min(1, Math.pow(Math.abs(wantK) / full, 1 / PILOT.free.expo));
    const steer = queue[at]!;
    queue[at] = u;
    at = (at + 1) % delay;
    // Vitesse : la courbe la plus serrée sur la distance de freinage qui vient.
    let k = 0;
    const span = 25 + (v * v) / 6;
    for (let d = 0; d <= span; d += 4) k = Math.max(k, Math.abs(rail.poseAt(m.s + d, ahead).curvature));
    const target = Math.min(cruise, Math.sqrt((0.7 * perf.grip) / Math.max(k, 1e-6)));
    return { auto: false, throttle: Math.min(1, Math.max(0, (target - v) * 0.5)), brake: Math.min(1, Math.max(0, (v - target) * 0.4)), lane: 0, steer };
  };
}

describe('direction : fonctions pures', () => {
  it('courbure du volant : à gauche positive, à droite négative, nulle au neutre ; bornée par le braquage ; plus douce avec la vitesse', () => {
    expect(courbureVolant(0, 20, 9, 'car')).toBe(0);
    expect(courbureVolant(-1, 20, 9, 'car')).toBeGreaterThan(0);
    expect(courbureVolant(1, 20, 9, 'car')).toBeLessThan(0);
    expect(courbureVolant(-1, 0, 9, 'car')).toBeCloseTo(courbureBraquage('car'), 9);
    expect(courbureVolant(-5, 1, 9, 'bike')).toBeCloseTo(courbureBraquage('bike'), 9);
    // À 200 km/h, manche à fond : une courbe de plus de 200 m de rayon.
    expect(1 / courbureVolant(-1, 200 / 3.6, 9.5, 'car')).toBeGreaterThan(200);
    // À mi-course, beaucoup moins qu'à fond (finesse au milieu).
    expect(courbureVolant(-0.5, 20, 9, 'car')).toBeLessThan(courbureVolant(-1, 20, 9, 'car') * 0.4);
    let last = Infinity;
    for (const v of [5, 10, 20, 40, 70]) {
      const k = courbureVolant(-1, v, 9, 'car');
      expect(k).toBeLessThanOrEqual(last);
      last = k;
    }
    expect(courbureVolant(Number.NaN, 20, 9, 'car')).toBe(0);
  });

  it('adhérence : au-delà, la courbure obtenue plafonne et le glissement monte de 0 à 1', () => {
    expect(courbureTenue(0.01, 20, 9)).toBeCloseTo(0.01, 9);
    expect(courbureTenue(0.1, 20, 9)).toBeCloseTo(9 / 400, 9);
    expect(courbureTenue(-0.1, 20, 9)).toBeCloseTo(-9 / 400, 9);
    expect(courbureTenue(0.2, 0, 9)).toBe(0.2);
    expect(glissementSousVirage(0.01, 20, 9)).toBe(0);
    expect(glissementSousVirage(0.03, 20, 9)).toBeGreaterThan(0);
    expect(glissementSousVirage(0.1, 20, 9)).toBe(1);
  });

  it('bord : borné, cap ramené le long du bord, vitesse perdue franchement de face, peu en effleurant', () => {
    expect(debordCap(0, 1, 2.2)).toBe(0);
    expect(debordCap(0.3, 1, 2.2)).toBeGreaterThan(0.5);
    const face = createEtatLibre();
    face.offset = 3;
    face.psi = 0.5;
    const brushed = createEtatLibre();
    brushed.offset = 3;
    brushed.psi = 0.03;
    const a = bordLibre(face, -2.5, 2.5, 1, 2.2, 20, 1 / 120);
    const b = bordLibre(brushed, -2.5, 2.5, 1, 2.2, 20, 1 / 120);
    expect(face.contact).toBe(1);
    expect(face.offset).toBeLessThanOrEqual(2.5 - debordCap(0.5, 1, 2.2) + 1e-9);
    expect(face.psi).toBeLessThan(0.5);
    expect(face.psi).toBeGreaterThan(0.4);
    expect(a).toBeGreaterThan(b * 5);
    // Au milieu : rien.
    const libre = createEtatLibre();
    expect(bordLibre(libre, -2.5, 2.5, 1, 2.2, 20, 1 / 120)).toBe(0);
    expect(libre.contact).toBe(0);
  });
});

describe('direction libre dans le pilote', () => {
  const kind = 'car' as const;

  it('ligne droite tenue sans toucher : ni écart, ni cap, ni glissement', () => {
    const rail = createRail(makeRoute([{ line: 3000 }]));
    const pilot = createPilot(rail);
    const start = pilot.motion.offset;
    for (let i = 0; i < 60 * 30; i += 1) pilot.step(DT, main(0.7, 0), kind);
    expect(pilot.motion.speed).toBeGreaterThan(20);
    expect(pilot.motion.offset).toBeCloseTo(start, 6);
    expect(pilot.motion.yaw).toBeCloseTo(0, 9);
    expect(pilot.motion.slip).toBe(0);
    expect(pilot.contact).toBe(0);
  });

  it('le manche braque : à gauche le véhicule part à gauche, lâché il garde son cap (il ne se recentre pas)', () => {
    const rail = createRail(makeRoute([{ line: 3000 }], 14));
    const pilot = createPilot(rail);
    lancer(pilot, kind, 15);
    const o = pilot.motion.offset;
    for (let i = 0; i < 20; i += 1) pilot.step(DT, main(0.4, -0.6), kind);
    const yaw = pilot.motion.yaw ?? 0;
    expect(yaw).toBeGreaterThan(0.01);
    expect(pilot.motion.steer ?? 0).toBeGreaterThan(0);
    // Lâché : le volant revient au neutre en douceur, le cap reste (le véhicule continue de s'écarter).
    for (let i = 0; i < 30; i += 1) pilot.step(DT, main(0.4, 0), kind);
    expect(pilot.motion.yaw ?? 0).toBeGreaterThan(yaw * 0.9);
    expect(pilot.motion.offset).toBeGreaterThan(o + 0.2);
  });

  it('virage raté sans braquer : tout droit vers le bord extérieur, il frotte, le bord le ralentit ; jamais hors de la chaussée', () => {
    const rail = createRail(makeRoute([{ line: 200 }, { arc: 40, turn: Math.PI / 2 }, { line: 400 }]));
    const pilot = createPilot(rail);
    const pose = createPose();
    const lim: [number, number] = [0, 0];
    lancer(pilot, kind, 14);
    let touched = 0;
    while (pilot.motion.s < 300 && !pilot.motion.finished) {
      pilot.step(DT, main(0.5, 0), kind);
      if (pilot.contact !== 0) touched = pilot.contact;
      rail.poseAt(pilot.motion.s, pose);
      laneLimits(pose, kind, PILOT.halfWidth.car, PILOT.halfLength.car, lim);
      expect(pilot.motion.offset).toBeGreaterThanOrEqual(lim[0] - 1e-9);
      expect(pilot.motion.offset).toBeLessThanOrEqual(lim[1] + 1e-9);
    }
    // Virage à gauche : l'extérieur est à droite.
    expect(touched).toBe(-1);
  });

  it('virage pris en braquant : un joueur qui braque vers le milieu passe sans toucher le bord', () => {
    const rail = createRail(makeRoute([{ line: 150 }, { arc: 40, turn: Math.PI / 2 }, { line: 100 }, { arc: 30, turn: -Math.PI / 2 }, { line: 200 }]));
    const perf = performanceDe({ kind: 'car' });
    const pilot = createPilot(rail, perf);
    const player = joueur(rail, perf, 15);
    let contacts = 0;
    let maxSteer = 0;
    let maxYaw = 0;
    for (let i = 0; i < 60 * 120 && !pilot.motion.finished; i += 1) {
      pilot.step(DT, player(pilot), kind);
      if (pilot.contact !== 0) contacts += 1;
      maxSteer = Math.max(maxSteer, Math.abs(pilot.motion.steer ?? 0));
      maxYaw = Math.max(maxYaw, Math.abs(pilot.motion.yaw ?? 0));
    }
    expect(pilot.motion.finished).toBe(true);
    expect(contacts).toBe(0);
    // Les roues braquent vraiment ; le cap relatif reste raisonnable.
    expect(maxSteer).toBeGreaterThan(0.03);
    expect(maxYaw).toBeLessThan(0.3);
  });

  it('à l’arrêt, braquer ne déplace rien', () => {
    const rail = createRail(makeRoute([{ line: 500 }]));
    const pilot = createPilot(rail);
    const o = pilot.motion.offset;
    for (let i = 0; i < 120; i += 1) pilot.step(DT, main(0, -1), kind);
    expect(pilot.motion.offset).toBe(o);
    expect(pilot.motion.s).toBe(0);
    expect(pilot.motion.yaw).toBe(0);
  });

  it('lacets de 8 m : ils se prennent au pas, en braquant', () => {
    const rail = createRail(makeRoute([{ line: 60 }, { arc: 8, turn: Math.PI }, { line: 40 }, { arc: 8, turn: -Math.PI }, { line: 80 }], 6));
    for (const vehicle of VEHICLES) {
      const perf = performanceDe(vehicle);
      const pilot = createPilot(rail, perf);
      const player = joueur(rail, perf, 7);
      let contacts = 0;
      let was = 0;
      for (let i = 0; i < 60 * 120 && !pilot.motion.finished; i += 1) {
        pilot.step(DT, player(pilot), vehicle.kind);
        if (pilot.contact !== 0 && was === 0) contacts += 1;
        was = pilot.contact;
      }
      expect(pilot.motion.finished, vehicle.id).toBe(true);
      expect(contacts, vehicle.id).toBeLessThanOrEqual(1);
    }
  });
});

describe('aucun frein posé par l’app, à la main', () => {
  for (const assist of [false, true]) {
    it(`${assist ? 'direction assistée' : 'direction libre'} : plein gaz dans un virage serré, le véhicule élargit, frotte, et seul le bord le ralentit`, () => {
      const rail = createRail(makeRoute([{ line: 300 }, { arc: 25, turn: Math.PI }, { line: 300 }]));
      const perf = performanceDe({ kind: 'car', performance: { mass: 1200, grip: 8, topKmh: 160 } });
      const pilot = createPilot(rail, perf);
      lancer(pilot, 'car', 25);
      const pose = createPose();
      const lim: [number, number] = [0, 0];
      let slip = 0;
      let lost = 0;
      let rubbing = 0;
      let lastS = pilot.motion.s;
      // En braquant à fond vers l'intérieur (libre) ou laissé à l'aide (assistée), gaz à fond, jamais de frein.
      for (let i = 0; i < 60 * 30 && pilot.motion.s < 300 + 25 * Math.PI; i += 1) {
        const before = pilot.motion.speed;
        pilot.step(DT, main(1, assist ? 0 : -1, assist ? { assist: true, steer: undefined } : {}), 'car');
        const m = pilot.motion;
        expect(m.braking).toBe(false);
        expect(m.s).toBeGreaterThanOrEqual(lastS - 1e-9);
        lastS = m.s;
        slip = Math.max(slip, m.slip ?? 0);
        // Toute baisse de vitesse sensible se fait au contact du bord.
        if (m.speed < before - 0.02) {
          lost += before - m.speed;
          expect(pilot.contact, `à ${m.s.toFixed(1)} m`).not.toBe(0);
        }
        if (pilot.contact !== 0) rubbing += 1;
        // Accélération latérale prise : jamais au-delà de l'adhérence.
        expect(Math.abs(pilot.lateral)).toBeLessThanOrEqual(perf.grip + 1e-6);
        rail.poseAt(m.s, pose);
        laneLimits(pose, 'car', PILOT.halfWidth.car, PILOT.halfLength.car, lim);
        expect(m.offset).toBeGreaterThanOrEqual(lim[0] - 1e-9);
        expect(m.offset).toBeLessThanOrEqual(lim[1] + 1e-9);
      }
      expect(rubbing).toBeGreaterThan(0);
      expect(lost).toBeGreaterThan(3);
      expect(slip).toBeGreaterThan(0.5);
      // Le bord ralentit sans arrêter net : le véhicule passe la courbe.
      expect(pilot.motion.speed).toBeGreaterThan(5);
    });
  }

  it('feux stop : ceux du joueur seulement', () => {
    const rail = createRail(makeRoute([{ line: 2000 }]));
    const pilot = createPilot(rail);
    lancer(pilot, 'car', 25);
    pilot.step(DT, main(0, 0), 'car');
    expect(pilot.motion.braking).toBe(false);
    pilot.step(DT, { auto: false, throttle: 0, brake: 1, lane: 0, steer: 0 }, 'car');
    expect(pilot.motion.braking).toBe(true);
  });
});

describe('passage de relais avec le pilote automatique', () => {
  it('à la main puis en automatique : écart et cap continus, le cap s’efface doucement', () => {
    const rail = createRail(makeRoute([{ line: 3000 }], 14));
    const pilot = createPilot(rail);
    for (let i = 0; i < 60 * 8; i += 1) pilot.step(DT, { auto: true, throttle: 0, brake: 0, lane: 0 }, 'car');
    let offset = pilot.motion.offset;
    let yaw = pilot.motion.yaw ?? 0;
    const check = () => {
      expect(Math.abs(pilot.motion.offset - offset)).toBeLessThan(0.1);
      expect(Math.abs((pilot.motion.yaw ?? 0) - yaw)).toBeLessThan(0.02);
      offset = pilot.motion.offset;
      yaw = pilot.motion.yaw ?? 0;
    };
    for (let i = 0; i < 25; i += 1) {
      pilot.step(DT, main(0.5, -0.5), 'car');
      check();
    }
    expect(yaw).toBeGreaterThan(0.02);
    for (let i = 0; i < 60 * 3; i += 1) {
      pilot.step(DT, { auto: true, throttle: 0, brake: 0, lane: 0 }, 'car');
      check();
    }
    expect(Math.abs(pilot.motion.yaw ?? 0)).toBeLessThan(0.05);
  });
});

const MAPS = ['plateau-matheysin', 'monaco-ville', 'monaco-circuit', 'miami-beach'];

describe('jouable au pouce : un joueur raisonnable boucle chaque carte', () => {
  for (const id of MAPS) {
    const file = new URL(`../../public/assets/maps/${id}/route.json`, import.meta.url);
    describe.skipIf(!existsSync(file))(id, () => {
      for (const vehicle of VEHICLES) {
        it(vehicle.id, () => {
          const route = JSON.parse(readFileSync(file, 'utf8')) as MapRoute;
          const rail = createRail(route);
          const perf = performanceDe(vehicle);
          const pilot = createPilot(rail, perf);
          // Allure honnête : 90 km/h, moins pour un véhicule lent.
          const cruise = Math.min(90, perf.topKmh * 0.75) / 3.6;
          const player = joueur(rail, perf, cruise, 1 / 30);
          let contacts = 0;
          let was = 0;
          let t = 0;
          let travelled = 0;
          let last = pilot.motion.s;
          const end = rail.loop ? rail.length : rail.length - 1;
          while (t < 3000 && travelled < end && !pilot.motion.finished) {
            pilot.step(1 / 30, player(pilot), vehicle.kind);
            t += 1 / 30;
            const ds = rail.loop ? (pilot.motion.s - last + rail.length) % rail.length : pilot.motion.s - last;
            travelled += ds;
            last = pilot.motion.s;
            if (pilot.contact !== 0 && was === 0) contacts += 1;
            was = pilot.contact;
          }
          const kmh = (travelled / t) * 3.6;
          console.log(`${id} ${vehicle.id} : ${Math.round(travelled)} m en ${Math.round(t)} s, ${kmh.toFixed(1)} km/h, ${contacts} frottements`);
          expect(travelled, 'parcours bouclé').toBeGreaterThanOrEqual(end - 1);
          expect(contacts).toBeLessThanOrEqual(5);
          expect(kmh).toBeGreaterThan(25);
        });
      }
    });
  }
});
