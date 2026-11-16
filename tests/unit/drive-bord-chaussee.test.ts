// Marge au bord de la chaussée (§ 5.5 ; retour du commanditaire : « la conduite auto nous fait toucher
// le trottoir », puis « on peut prendre toute la route ») : sur les quatre cartes, à chaque mètre,
// les quatre coins d'une voiture large et d'une moto restent sur la chaussée dessinée, avec une marge,
// en pilote automatique comme à la main collé à gauche ou à droite, dans les villages, les
// ronds-points et les lacets. La chaussée dessinée est rejouée comme la fabrique la carte
// (tools/maps/build.mjs : ruban posé sur un point du rail sur deux, demi-largeur adoucie).
// Strict partout : les virages plus serrés que la voiture (rayon de 3,5 à 5,6 m sur 3 à 4 m de
// chaussée, au circuit de Monaco et à Miami) sont adoucis à la fabrication (rail de 8 m de rayon au
// moins, chaussée de 5 m au moins : tools/maps/build.mjs), et le demi-tour du départ de Miami rogné.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MapRoute } from '../../src/data/mapTypes.ts';
import { VEHICLES } from '../../src/data/vehicles.ts';
import type { DriveInput, DriveMotion, Rail, RailPose } from '../../src/drive/contrat.ts';
import { createPilot, performanceDe } from '../../src/drive/pilote.ts';
import { createPose, createRail } from '../../src/drive/rail.ts';

interface Ruban {
  /** Bords gauche et droit aux stations, x et z à la suite. */
  left: Float64Array;
  right: Float64Array;
  /** Abscisse d'une station, m. */
  stationStep: number;
  count: number;
  loop: boolean;
}

function gauss(values: number[], sigma: number): number[] {
  const r = Math.ceil(sigma * 3);
  const w = Array.from({ length: 2 * r + 1 }, (_, k) => Math.exp(-((k - r) ** 2) / (2 * sigma * sigma)));
  const n = values.length;
  return values.map((_, i) => {
    let s = 0;
    let ws = 0;
    for (let k = -r; k <= r; k += 1) {
      const j = i + k;
      let x: number;
      if (j < 0) x = 2 * (values[0] ?? 0) - (values[-j] ?? values[0] ?? 0);
      else if (j >= n) x = 2 * (values[n - 1] ?? 0) - (values[2 * (n - 1) - j] ?? values[n - 1] ?? 0);
      else x = values[j] ?? 0;
      s += (w[k + r] ?? 0) * x;
      ws += w[k + r] ?? 0;
    }
    return s / ws;
  });
}

function ruban(route: MapRoute): Ruban {
  const N = Math.floor(route.rail.length / 3);
  const step = route.step;
  const pts = Array.from({ length: N }, (_, i) => [route.rail[i * 3]!, route.rail[i * 3 + 2]!] as const);
  const per = N - 1;
  const width = pts.map((_, i) => {
    const s = i * step;
    const sec = route.sections.find((x) => s >= x.from && s <= x.to) ?? route.sections[route.sections.length - 1]!;
    return sec.width;
  });
  const hw = gauss(width, 8 / step).map((w) => w / 2);
  const stations: number[] = [];
  for (let i = 0; i < N; i += 2) stations.push(i);
  if (stations[stations.length - 1] !== N - 1) stations.push(N - 1);
  const left = new Float64Array(stations.length * 2);
  const right = new Float64Array(stations.length * 2);
  stations.forEach((i, k) => {
    const a = pts[route.loop ? (((i - 2) % per) + per) % per : Math.max(0, i - 2)]!;
    const b = pts[route.loop ? (i + 2) % per : Math.min(N - 1, i + 2)]!;
    const tx = b[0] - a[0];
    const tz = b[1] - a[1];
    const L = Math.hypot(tx, tz) || 1;
    // Normale de la fabrication : (−tz, tx), vers la droite de la marche.
    const nx = -tz / L;
    const nz = tx / L;
    const p = pts[i]!;
    const h = hw[i] ?? 3;
    left[k * 2] = p[0] - nx * h;
    left[k * 2 + 1] = p[1] - nz * h;
    right[k * 2] = p[0] + nx * h;
    right[k * 2 + 1] = p[1] + nz * h;
  });
  return { left, right, stationStep: step * 2, count: stations.length, loop: route.loop };
}

/** Distance (positive dedans) d'un point (x, z) aux deux bords, sur la corde de l'abscisse `s`. */
function margeAuBord(r: Ruban, s: number, x: number, z: number): number {
  let j = Math.floor(s / r.stationStep);
  if (r.loop) j = ((j % (r.count - 1)) + (r.count - 1)) % (r.count - 1);
  j = Math.max(0, Math.min(r.count - 2, j));
  const side = (e: Float64Array, sign: number) => {
    const x0 = e[j * 2]!;
    const z0 = e[j * 2 + 1]!;
    const dx = e[j * 2 + 2]! - x0;
    const dz = e[j * 2 + 3]! - z0;
    const L = Math.hypot(dx, dz) || 1;
    return (sign * (dx * (z - z0) - dz * (x - x0))) / L;
  };
  return Math.min(side(r.left, 1), side(r.right, -1));
}

interface Mesure {
  /** Marge la plus faible, m, et son abscisse. */
  min: number;
  at: number;
  /** Mètres où la marge est sous 0,2 m, et hors de la chaussée (marge négative). */
  under20: number;
  outside: number;
  /** Abscisses (arrondies à 10 m) des endroits sous 0,2 m, les premières. */
  zones: number[];
  /** Largeur de chaussée la plus faible rencontrée, m ; écart à l'axe le plus grand, m. */
  narrowest: number;
  maxOffset: number;
  /** Vitesse moyenne, km/h ; durée, s. */
  meanKmh: number;
  seconds: number;
}

interface StepPilot {
  motion: DriveMotion;
  step(dt: number, input: DriveInput, kind: 'car' | 'bike'): DriveMotion;
}

/** Fait rouler un pilote sur toute la carte et mesure la marge des quatre coins à chaque mètre. */
function mesurer(
  route: MapRoute,
  rail: Rail,
  pilot: StepPilot,
  kind: 'car' | 'bike',
  size: { halfWidth: number; halfLength: number },
  input: (s: number) => DriveInput,
  pose: RailPose,
  maxSeconds = 4000,
  skip: (s: number) => boolean = () => false,
): Mesure {
  const r = ruban(route);
  const out: Mesure = { min: Infinity, at: 0, under20: 0, outside: 0, zones: [], narrowest: Infinity, maxOffset: 0, meanKmh: 0, seconds: 0 };
  let nextMeter = Math.ceil(pilot.motion.s) + 1;
  let t = 0;
  let travelled = 0;
  let last = pilot.motion.s;
  const end = rail.loop ? rail.length : rail.length - 1;
  while (t < maxSeconds && travelled < end - 1 && !pilot.motion.finished) {
    pilot.step(1 / 30, input(pilot.motion.s), kind);
    t += 1 / 30;
    const ds = rail.loop ? (pilot.motion.s - last + rail.length) % rail.length : pilot.motion.s - last;
    travelled += ds;
    last = pilot.motion.s;
    while (travelled + 0 >= nextMeter - 0 && nextMeter <= end) {
      const s = pilot.motion.s;
      if (skip(s)) {
        nextMeter += 1;
        continue;
      }
      rail.poseAt(s, pose);
      const [tx, , tz] = pose.tangent;
      const fl = Math.hypot(tx, tz) || 1;
      const fx = tx / fl;
      const fz = tz / fl;
      // Gauche de la marche : (tz, −tx).
      const lx = fz;
      const lz = -fx;
      const o = pilot.motion.offset;
      const cx = pose.position[0] + lx * o;
      const cz = pose.position[2] + lz * o;
      let m = Infinity;
      for (const a of [-1, 1]) {
        for (const b of [-1, 1]) {
          const x = cx + fx * a * size.halfLength + lx * b * size.halfWidth;
          const z = cz + fz * a * size.halfLength + lz * b * size.halfWidth;
          m = Math.min(m, margeAuBord(r, s + a * size.halfLength, x, z));
        }
      }
      if (m < out.min) {
        out.min = m;
        out.at = Math.round(s);
      }
      if (m < 0.2) {
        out.under20 += 1;
        const zone = Math.round(s / 10) * 10;
        if (out.zones.length < 12 && !out.zones.includes(zone)) out.zones.push(zone);
      }
      if (m < 0) out.outside += 1;
      out.narrowest = Math.min(out.narrowest, pose.width);
      out.maxOffset = Math.max(out.maxOffset, Math.abs(o));
      nextMeter += 1;
    }
  }
  out.seconds = Math.round(t);
  out.meanKmh = Math.round((travelled / Math.max(1e-6, t)) * 3.6 * 10) / 10;
  out.min = Math.round(out.min * 100) / 100;
  return out;
}


const MAPS = ['plateau-matheysin', 'monaco-ville', 'monaco-circuit', 'miami-beach'];
const SIZES = { car: { halfWidth: 1.0, halfLength: 2.2 }, bike: { halfWidth: 0.45, halfLength: 1.05 } };
const MARGIN = 0.15;

describe('marge au bord de la chaussée, sur les quatre cartes', () => {
  for (const id of MAPS) {
    const file = new URL(`../../public/assets/maps/${id}/route.json`, import.meta.url);
    describe.skipIf(!existsSync(file))(id, () => {
      for (const kind of ['car', 'bike'] as const) {
        for (const lane of [0, -1, 1] as const) {
          it(`${kind === 'car' ? 'voiture large' : 'moto'}, ${lane === 0 ? 'pilote automatique' : lane < 0 ? 'à la main assistée, collée à gauche' : 'à la main assistée, collée à droite'}`, () => {
            const route = JSON.parse(readFileSync(file, 'utf8')) as MapRoute;
            const rail = createRail(route);
            const vehicle = VEHICLES.find((v) => v.kind === kind) ?? VEHICLES[0]!;
            const pilot = createPilot(rail, { ...performanceDe(vehicle), ...SIZES[kind] });
            const input: DriveInput = lane === 0 ? { auto: true, throttle: 0, brake: 0, lane: 0 } : { auto: false, throttle: 0.6, brake: 0, lane, assist: true };
            const m = mesurer(route, rail, pilot, kind, SIZES[kind], () => input, createPose(), 4000);
            expect(m.min, `${id} : marge la plus faible à ${m.at} m (zones ${m.zones.join(', ')})`).toBeGreaterThan(MARGIN);
            expect(m.outside).toBe(0);
          });
        }
      }
    });
  }
});
