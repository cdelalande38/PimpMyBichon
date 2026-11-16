// Le pilote (§ 5.5, lot 1) : fait avancer le véhicule sur le rail, tout seul ou à la main.
//
// Pilote automatique : croisière selon la route (50 km/h en agglomération ; 60, 80 ou 90 km/h
// hors agglomération selon la largeur de la chaussée), vitesse réglée d'avance sur la courbure
// (accélération latérale plafonnée à PILOT.lateral m/s²), freinage anticipé et doux (profil de vitesse
// calculé une fois à rebours, à PILOT.plannedBrake m/s²), reprise franche, arrêt au bout d'un parcours
// ouvert. À la main : accélérateur, frein, roue libre ; une enveloppe de sécurité, calculée de la même
// façon mais plus large, freine à la place du joueur avant qu'il ne sorte de la route. Aucune collision :
// il n'y a rien d'autre sur la route.
//
// Placement : le véhicule roule dans la voie de droite (au milieu de la chaussée s'il n'y a qu'une
// voie) ; à la main, il se place à gauche ou à droite de sa voie. Le placement suit la route avec un
// ressort amorti et anticipe les rétrécissements ; il ne quitte jamais la chaussée.
//
// Caisse : `roll` est la rotation autour de l'axe avant (+X) du véhicule, au sens direct de three.js :
// positif, le toit part vers la droite (+Z du véhicule). Une voiture roule vers l'extérieur du virage
// (ressort amorti) ; une moto s'incline vers l'intérieur (angle d'équilibre atan(v²κ/g)). `dive` est la
// rotation autour de l'axe latéral, positive nez en l'air (cabrage), négative au freinage (plongée).
//
// Tout est déterministe : l'intégration se fait en sous-pas d'au plus 1/120 s, quel que soit `dt`.
// `step` n'alloue rien.

import type { DriveInput, DriveMotion, Pilot, Rail, RailPose } from './contrat.ts';
import { createPose } from './rail.ts';

export const PILOT = {
  /** Croisière en agglomération, km/h. */
  urbanKmh: 50,
  /** Croisière hors agglomération : chaussée large (≥ wideWidth m, deux voies et plus), courante, étroite (< narrowWidth m). */
  wideKmh: 90,
  roadKmh: 80,
  narrowKmh: 60,
  wideWidth: 6.5,
  narrowWidth: 5.5,
  /** Accélération latérale visée en courbe, m/s² (rond-point de 17 m : ≈ 25 km/h). */
  lateral: 2.8,
  /** Freinage prévu par le profil, m/s² : doux. */
  plannedBrake: 2,
  /** Freinage le plus fort du pilote automatique, m/s². */
  maxBrake: 4.5,
  /** Reprise, m/s² : franche. */
  accel: 2.6,
  /** Variation d'accélération la plus forte, m/s³ (pas d'à-coup). */
  jerk: 5,
  /** Gain de l'asservissement de vitesse, 1/s. */
  gain: 1.5,
  /** Anticipation : le pilote suit le profil à l'endroit où il sera dans ce délai, s (compense le retard du freinage progressif). */
  anticipation: 0.7,
  /** Conduite à la main. */
  manual: { accel: 3.4, brake: 7, coast: 0.5, topKmh: 120, lateral: 4.5, brakeEnvelope: 5, jerk: 14 },
  /** Placement latéral : pulsation du ressort (rad/s), vitesse latérale la plus forte (m/s), marge au bord (m). */
  lane: { omega: 2.4, maxRate: 2, marginCar: 1.05, marginBike: 0.6, lookahead: 25 },
  /** Roulis de caisse d'une voiture : rad par m/s² d'accélération latérale, plafond, ressort. */
  roll: { gain: 0.011, max: 0.075, omega: 9, damping: 0.55 },
  /** Inclinaison d'une moto : plafond, temps de réponse (s). */
  lean: { max: 0.8, tau: 0.22 },
  /** Plongée et cabrage : rad par m/s², plafond, ressort. */
  dive: { gainCar: 0.005, gainBike: 0.003, max: 0.035, omega: 8, damping: 0.6 },
  /** Pas du profil de vitesse, m. */
  profileStep: 1,
  /** Sous-pas d'intégration le plus long, s. */
  substep: 1 / 120,
} as const;

const G = 9.81;
const kmh = (value: number) => value / 3.6;

/** Croisière d'une section de route, en m/s. */
export function cruiseSpeed(pose: Pick<RailPose, 'urban' | 'width' | 'lanes'>): number {
  if (pose.urban) return kmh(PILOT.urbanKmh);
  if (pose.width < PILOT.narrowWidth) return kmh(PILOT.narrowKmh);
  if (pose.width >= PILOT.wideWidth && pose.lanes >= 2) return kmh(PILOT.wideKmh);
  return kmh(PILOT.roadKmh);
}

/** Centre de la voie où roule le véhicule (la voie de droite), en mètres vers la gauche de l'axe. */
export function laneCenter(pose: Pick<RailPose, 'width' | 'lanes'>): number {
  if (pose.lanes < 2) return 0;
  const lane = pose.width / pose.lanes;
  return -(pose.width / 2 - lane / 2);
}

/** Écart le plus grand permis à l'axe : la chaussée moins la marge du véhicule. */
export function laneBound(pose: Pick<RailPose, 'width'>, kind: 'car' | 'bike'): number {
  const margin = kind === 'bike' ? PILOT.lane.marginBike : PILOT.lane.marginCar;
  return Math.max(0, pose.width / 2 - margin);
}

/** Profil de vitesse le long du rail, échantillonné tous les `step` mètres. */
export interface SpeedProfile {
  readonly step: number;
  /** Vitesse visée par le pilote automatique, m/s. */
  readonly auto: Float64Array;
  /** Vitesse la plus forte permise à la main, m/s. */
  readonly envelope: Float64Array;
}

/** Vitesse et pente (dv/ds) du profil à l'abscisse `s`, écrites dans `out` ([v, dv/ds]). */
export function sampleProfile(values: Float64Array, step: number, rail: Rail, s: number, out: [number, number]): [number, number] {
  const n = values.length;
  let u = s / step;
  if (rail.loop) u = ((u % (n - 1)) + (n - 1)) % (n - 1);
  else u = Math.min(n - 1, Math.max(0, u));
  const i = Math.min(n - 2, Math.floor(u));
  const t = u - i;
  const a = values[i]!;
  const b = values[i + 1]!;
  out[0] = a + (b - a) * t;
  out[1] = (b - a) / step;
  return out;
}

/** Calcule une fois les deux profils : courbure et croisière, puis freinage anticipé à rebours. */
export function createSpeedProfile(rail: Rail): SpeedProfile {
  const step = PILOT.profileStep;
  const n = Math.max(2, Math.ceil(rail.length / step) + 1);
  const auto = new Float64Array(n);
  const envelope = new Float64Array(n);
  const pose = createPose();
  const manualTop = kmh(PILOT.manual.topKmh);
  for (let i = 0; i < n; i += 1) {
    rail.poseAt(Math.min(rail.length, i * step), pose);
    const k = Math.max(Math.abs(pose.curvature), 1e-6);
    auto[i] = Math.min(cruiseSpeed(pose), Math.sqrt(PILOT.lateral / k));
    envelope[i] = Math.min(manualTop, Math.sqrt(PILOT.manual.lateral / k));
  }
  const backward = (values: Float64Array, brake: number) => {
    if (!rail.loop) values[n - 1] = 0;
    // Boucle : deux tours à rebours, pour que le début du parcours voie la fin.
    const passes = rail.loop ? 2 : 1;
    for (let pass = 0; pass < passes; pass += 1) {
      for (let i = n - 2; i >= 0; i -= 1) {
        const next = rail.loop && i === n - 2 && pass > 0 ? values[0]! : values[i + 1]!;
        values[i] = Math.min(values[i]!, Math.sqrt(next * next + 2 * brake * step));
      }
      if (rail.loop) values[n - 1] = values[0]!;
    }
  };
  backward(auto, PILOT.plannedBrake);
  backward(envelope, PILOT.manual.brakeEnvelope);
  return { step, auto, envelope };
}

export interface PilotWithProfile extends Pilot {
  readonly profile: SpeedProfile;
  readonly rail: Rail;
}

function newMotion(): DriveMotion {
  return { s: 0, speed: 0, accel: 0, offset: 0, roll: 0, dive: 0, braking: false, finished: false };
}

export function createPilot(rail: Rail): PilotWithProfile {
  const profile = createSpeedProfile(rail);
  const motion = newMotion();
  const pose = createPose();
  const ahead = createPose();
  const sample: [number, number] = [0, 0];
  let accel = 0;
  let offsetRate = 0;
  let rollRate = 0;
  let diveRate = 0;

  function reset(s: number): void {
    const start = rail.loop ? s : Math.min(rail.length, Math.max(0, Number.isFinite(s) ? s : 0));
    rail.poseAt(start, pose);
    motion.s = pose.s;
    motion.speed = 0;
    motion.accel = 0;
    motion.offset = laneCenter(pose);
    motion.roll = 0;
    motion.dive = 0;
    motion.braking = true;
    motion.finished = !rail.loop && pose.s >= rail.length;
    accel = 0;
    offsetRate = 0;
    rollRate = 0;
    diveRate = 0;
  }

  /** Accélération voulue par l'asservissement sur un profil : suivi plus anticipation de sa pente. */
  function track(values: Float64Array, s: number, v: number): number {
    // Le plus contraignant des deux : ici, ou là où l'on sera bientôt (jamais une sortie de virage
    // vue d'avance comme une raison d'accélérer dans le virage).
    sampleProfile(values, profile.step, rail, s, sample);
    const hereV = sample[0];
    const hereSlope = sample[1];
    sampleProfile(values, profile.step, rail, s + v * PILOT.anticipation, sample);
    if (hereV <= sample[0]) return PILOT.gain * (hereV - v) + hereSlope * v;
    return PILOT.gain * (sample[0] - v) + sample[1] * v;
  }

  function substep(h: number, input: DriveInput, kind: 'car' | 'bike'): void {
    const v = motion.speed;
    rail.poseAt(motion.s, pose);
    let wanted: number;
    let jerk: number;
    if (input.auto) {
      wanted = Math.min(PILOT.accel, Math.max(-PILOT.maxBrake, track(profile.auto, motion.s, v)));
      jerk = PILOT.jerk;
    } else {
      const throttle = Math.min(1, Math.max(0, input.throttle));
      const brake = Math.min(1, Math.max(0, input.brake));
      wanted = throttle * PILOT.manual.accel - brake * PILOT.manual.brake;
      if (throttle === 0 && brake === 0) wanted = -PILOT.manual.coast;
      // Enveloppe de sécurité : le pilote freine à la place du joueur, jamais l'inverse.
      wanted = Math.max(-PILOT.manual.brake, Math.min(wanted, track(profile.envelope, motion.s, v)));
      jerk = PILOT.manual.jerk;
    }
    const delta = wanted - accel;
    const limit = jerk * h;
    accel += Math.max(-limit, Math.min(limit, delta));
    // Jamais de recul : à l'arrêt, une décélération ne fait que tenir le véhicule.
    let speed = v + accel * h;
    if (speed <= 0) {
      speed = 0;
      if (accel < 0) accel = 0;
    }
    motion.accel = (speed - v) / h;
    motion.speed = speed;
    let s = motion.s + speed * h;
    if (rail.loop) {
      s = ((s % rail.length) + rail.length) % rail.length;
    } else if (s >= rail.length || (rail.length - s < 0.25 && speed < 0.6 && input.auto)) {
      s = rail.length;
      motion.speed = 0;
      motion.accel = 0;
      accel = 0;
      motion.finished = true;
    }
    motion.s = s;

    // Placement : vise sa voie, au point le plus contraint entre ici et un peu plus loin.
    rail.poseAt(s + (rail.loop ? 1 : Math.sign(rail.length - s)) * PILOT.lane.lookahead, ahead);
    const bound = Math.min(laneBound(pose, kind), laneBound(ahead, kind));
    const lane = input.auto ? 0 : input.lane;
    const width = Math.min(pose.width / Math.max(1, pose.lanes), ahead.width / Math.max(1, ahead.lanes));
    const margin = kind === 'bike' ? PILOT.lane.marginBike : PILOT.lane.marginCar;
    const swing = Math.max(0, width / 2 - margin * 0.75);
    const target = Math.max(-bound, Math.min(bound, laneCenter(ahead) - lane * swing));
    const omega = PILOT.lane.omega;
    offsetRate += (omega * omega * (target - motion.offset) - 2 * omega * offsetRate) * h;
    offsetRate = Math.max(-PILOT.lane.maxRate, Math.min(PILOT.lane.maxRate, offsetRate));
    const hard = laneBound(pose, kind);
    motion.offset = Math.max(-hard, Math.min(hard, motion.offset + offsetRate * h));

    // Caisse.
    const lateral = speed * speed * pose.curvature;
    if (kind === 'bike') {
      const lean = Math.max(-PILOT.lean.max, Math.min(PILOT.lean.max, -Math.atan(lateral / G)));
      motion.roll += (lean - motion.roll) * Math.min(1, h / PILOT.lean.tau);
      rollRate = 0;
    } else {
      const roll = Math.max(-PILOT.roll.max, Math.min(PILOT.roll.max, PILOT.roll.gain * lateral));
      const w = PILOT.roll.omega;
      rollRate += (w * w * (roll - motion.roll) - 2 * PILOT.roll.damping * w * rollRate) * h;
      motion.roll += rollRate * h;
    }
    const gain = kind === 'bike' ? PILOT.dive.gainBike : PILOT.dive.gainCar;
    const dive = Math.max(-PILOT.dive.max, Math.min(PILOT.dive.max, gain * motion.accel));
    const w = PILOT.dive.omega;
    diveRate += (w * w * (dive - motion.dive) - 2 * PILOT.dive.damping * w * diveRate) * h;
    motion.dive += diveRate * h;
  }

  function step(dt: number, input: DriveInput, kind: 'car' | 'bike'): DriveMotion {
    const span = Math.min(0.1, Math.max(0, Number.isFinite(dt) ? dt : 0));
    if (span > 0 && !motion.finished) {
      const count = Math.max(1, Math.ceil(span / PILOT.substep - 1e-9));
      const h = span / count;
      for (let i = 0; i < count && !motion.finished; i += 1) substep(h, input, kind);
    } else if (span > 0) {
      // Arrivé : la caisse se pose, le véhicule ne bouge plus.
      motion.roll *= Math.max(0, 1 - span * 4);
      motion.dive *= Math.max(0, 1 - span * 4);
    }
    motion.braking = motion.finished || motion.speed < 0.05 || motion.accel < -0.6 || (!input.auto && input.brake > 0.05);
    return motion;
  }

  reset(0);
  return { motion, profile, rail, reset, step };
}
