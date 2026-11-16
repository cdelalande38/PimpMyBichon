// Pose du conducteur à bord : une cinématique inverse simple (épaule, coude, poignet ; hanche,
// genou, cheville) sur les points d'appui du véhicule, dans le repère de la caisse (avant +X, haut
// +Y, droite +Z). Voiture : le bassin sur l'assise du siège du conducteur, le dos au dossier, les
// mains sur la jante du volant à dix heures dix (elles suivent le volant qui tourne), les pieds vers
// le pédalier. Moto : le bassin sur l'assise, le buste penché juste assez pour que les bras tiennent
// les poignées à la longueur voulue (bras tendus vers un guidon haut, coudes pliés sur une sportive),
// les pieds sur les repose-pieds (devant : la voûte, talon bas ; derrière : la plante, talon haut).
// Rien ne dépend de l'identifiant du véhicule. Module pur (three seul), testé dans
// tests/unit/conducteur-pose.test.ts et tests/unit/conducteur-places.test.ts.

import { Matrix4, Quaternion, Vector3 } from 'three';
import { DRIVER_POSE, type DriverCatalogue, type Vec3 } from '../../data/conducteur.ts';

export interface DriverSkeleton {
  ids: string[];
  index: Record<string, number>;
  parent: number[];
  /** Décalage au repos dans le repère du parent. */
  offsets: Vector3[];
  /** Position au repos dans le repère du bassin. */
  rest: Vector3[];
}

export function skeletonOf(catalogue: DriverCatalogue): DriverSkeleton {
  const ids = catalogue.bones.map((bone) => bone.id);
  const index: Record<string, number> = {};
  ids.forEach((id, i) => (index[id] = i));
  const parent = catalogue.bones.map((bone) => (bone.parent === null ? -1 : (index[bone.parent] ?? -1)));
  const offsets = catalogue.bones.map((bone) => new Vector3(...bone.at));
  const rest: Vector3[] = [];
  offsets.forEach((offset, i) => {
    const p = parent[i] as number;
    rest.push(p < 0 ? offset.clone() : (rest[p] as Vector3).clone().add(offset));
  });
  return { ids, index, parent, offsets, rest };
}

/** Volant : centre de la jante, repère (jante dans le plan XY local, +Z vers le conducteur, +Y midi), rayon de son axe. */
export interface WheelFrame {
  center: Vec3;
  quaternion: [number, number, number, number];
  radius: number;
}

export interface CarSeating {
  kind: 'car';
  /** Appui des fesses sur l'assise. */
  seat: Vec3;
  /** Inclinaison du buste vers l'arrière, en radians. */
  recline: number;
  wheel: WheelFrame;
  /** Mains de part et d'autre de midi sur la jante, en radians. */
  hands: number;
  floor: number;
  /** x le plus en avant pour les pointes de pied (tablier, pédales), un par pied ou commun ; null : inconnu. */
  toeBoard: number | readonly [number, number] | null;
  /** Place aux genoux : x de la planche de bord à chaque hauteur [y, x]. */
  legRoom?: ReadonlyArray<readonly [number, number]>;
  /** Genoux écartés (0 : droits devant ; 1 : de part et d'autre de la colonne). */
  kneeSpread?: number;
  /** Hauteur du pavillon au-dessus de la place ; null : rien au-dessus. */
  roof: number | null;
  /** Buste et bassin choisis au premier calcul (gardés ensuite). */
  plan?: { torso: number; shift: number; sink: number };
}

export interface BikeSeating {
  kind: 'bike';
  seat: Vec3;
  /** Poignées (gauche, droite) : centre et axe de la prise (vers l'extérieur). */
  grips: [{ at: Vec3; axis: Vec3 }, { at: Vec3; axis: Vec3 }];
  /** Repose-pieds (gauche, droit) : centre et rayon. */
  pegs: [{ at: Vec3; radius: number }, { at: Vec3; radius: number }];
  reach: number;
  /**
   * Axe de direction (un point, une direction unitaire) : les poignées tournent autour quand la moto
   * braque (`DriverMotion.steer`), les mains avec elles. Absent : poignées fixes.
   */
  steering?: { at: Vec3; dir: Vec3 };
  plan?: { torso: number; shift: number; sink: number };
}

export type Seating = CarSeating | BikeSeating;

/** Ce qui fait vivre la pose en roulant. */
export interface DriverMotion {
  /** Rotation du volant (voiture) ou braquage du guidon (moto), en radians (positive : vers la gauche). */
  steer: number;
  /** Lacet de la tête, en radians (positif : vers la gauche). */
  look: number;
  /** Inclinaison du haut du corps au-delà du véhicule, autour de l'avant (même sens que le roulis), en radians. */
  lean: number;
  /** Buste en avant (+) ou en arrière (−), en radians. */
  surge: number;
  /** Bassin décalé vers +Z (droite), en mètres. */
  hang: number;
}

export const STILL_MOTION: Readonly<DriverMotion> = Object.freeze({ steer: 0, look: 0, lean: 0, surge: 0, hang: 0 });

export interface DriverPose {
  /** Rotation de chaque os dans le repère de la caisse. */
  world: Quaternion[];
  /** Position de chaque os (articulation) dans le repère de la caisse. */
  joints: Vector3[];
  /** Prises des mains (gauche, droite), chevilles visées, œil. */
  grips: [Vector3, Vector3];
  ankles: [Vector3, Vector3];
  eye: Vector3;
  /** Penché du buste vers l'avant, en radians (négatif : en arrière). */
  torso: number;
}

/** Ligne du dessous du bassin, des fesses à l'entrejambe (repère du bassin, au repos). */
const SEAT_LINE: ReadonlyArray<readonly [number, number]> = [
  [-0.1, -0.09],
  [-0.035, -0.105],
  [0.03, -0.1],
  [0.09, -0.088],
  [0.13, -0.062],
];

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
const v3 = (p: Vec3) => new Vector3(p[0], p[1], p[2]);
/** Penché vers l'avant de `a` radians (rotation autour de Z ; l'avant +X descend). */
const pitch = (a: number) => new Quaternion().setFromAxisAngle(Z, -a);

/** Rotation qui porte les axes locaux (x, y) sur les axes (x', y') donnés (orthonormés). */
function basis(xw: Vector3, yw: Vector3): Quaternion {
  const x = xw.clone().normalize();
  const y = yw.clone().sub(x.clone().multiplyScalar(yw.dot(x))).normalize();
  const z = new Vector3().crossVectors(x, y);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}

/** Composante de `v` perpendiculaire à `axis` (unitaire), normalisée ; `fallback` si nulle. */
function perpendicular(v: Vector3, axis: Vector3, fallback: Vector3): Vector3 {
  const out = v.clone().sub(axis.clone().multiplyScalar(v.dot(axis)));
  if (out.lengthSq() < 1e-8) return fallback.clone().sub(axis.clone().multiplyScalar(fallback.dot(axis))).normalize();
  return out.normalize();
}

/**
 * Deux os d'un membre (de `root` à `target`, longueurs a et b) : coude ou genou placé dans le plan
 * qui contient `pole`. Rend le point du milieu.
 */
export function twoBone(root: Vector3, target: Vector3, a: number, b: number, pole: Vector3): Vector3 {
  const d = target.clone().sub(root);
  const dist = Math.min(Math.max(d.length(), Math.abs(a - b) + 1e-4), a + b - 1e-4);
  const u = d.lengthSq() > 1e-10 ? d.clone().normalize() : new Vector3(0, -1, 0);
  const cos = (a * a + dist * dist - b * b) / (2 * a * dist);
  const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
  const side = perpendicular(pole, u, X);
  return root.clone().add(u.multiplyScalar(a * cos)).add(side.multiplyScalar(a * sin));
}

/**
 * Rotations d'un membre à charnière : l'os du haut porte −Y local vers le coude, l'os du bas vers la
 * cible ; la charnière est le Z local des deux (le bras plie vers +X local, la jambe vers −X).
 */
function limb(root: Vector3, mid: Vector3, end: Vector3, flex: 1 | -1, pole: Vector3): [Quaternion, Quaternion] {
  const u1 = mid.clone().sub(root).normalize();
  const u2 = end.clone().sub(mid).normalize();
  const bend = perpendicular(u2, u1, pole);
  const upper = basis(bend.clone().multiplyScalar(flex), u1.clone().negate());
  const hinge = Z.clone().applyQuaternion(upper);
  const lowerY = u2.clone().negate();
  const lowerX = new Vector3().crossVectors(lowerY, hinge);
  return [upper, basis(lowerX, lowerY)];
}

/**
 * Main fermée sur une prise : axe de prise `axis`, point de prise `at`, l'avant-bras arrivant de
 * `from` (épaule). La main prolonge l'avant-bras (poignet droit), la paume du côté `palmToward`.
 * Rend la rotation de la main et la position du poignet.
 */
function gripHand(at: Vector3, axis: Vector3, from: Vector3, palmToward: Vector3, side: -1 | 1, grip: Vec3): { rotation: Quaternion; wrist: Vector3 } {
  const t = axis.clone().normalize();
  const long = perpendicular(at.clone().sub(from), t, X);
  const palm = new Vector3().crossVectors(long, t).normalize();
  if (palm.dot(palmToward) < 0) palm.negate();
  // Repère local de la main : −Y le long des doigts, +Z la paume pour la gauche (−Z pour la droite).
  const yl = long.clone().negate();
  const zl = palm.clone().multiplyScalar(-side);
  const xl = new Vector3().crossVectors(yl, zl);
  const rotation = basis(xl, yl);
  const offset = new Vector3(grip[0], grip[1], grip[2] * -side).applyQuaternion(rotation);
  return { rotation, wrist: at.clone().sub(offset) };
}

/** Point de la jante à `angle` de midi (positif vers la gauche du conducteur), et sa tangente. */
export function rimPoint(wheel: WheelFrame, angle: number): { at: Vector3; tangent: Vector3; outward: Vector3; normal: Vector3 } {
  const q = new Quaternion(...wheel.quaternion);
  const local = new Vector3(-Math.sin(angle) * wheel.radius, Math.cos(angle) * wheel.radius, 0);
  return {
    at: local.applyQuaternion(q).add(v3(wheel.center)),
    tangent: new Vector3(-Math.cos(angle), -Math.sin(angle), 0).applyQuaternion(q),
    outward: new Vector3(-Math.sin(angle), Math.cos(angle), 0).applyQuaternion(q),
    normal: Z.clone().applyQuaternion(q),
  };
}

function boneLength(sk: DriverSkeleton, id: string): number {
  return (sk.offsets[sk.index[id] as number] as Vector3).length();
}

/** Position d'un os enfant, son parent posé (position et rotation). */
function child(sk: DriverSkeleton, id: string, parentAt: Vector3, parentRotation: Quaternion): Vector3 {
  return (sk.offsets[sk.index[id] as number] as Vector3).clone().applyQuaternion(parentRotation).add(parentAt);
}

/**
 * Pose complète. `motion` : ce qui la fait vivre en roulant (volant, tête, penché, buste).
 */
export function solvePose(sk: DriverSkeleton, catalogue: DriverCatalogue, seating: Seating, motion: Readonly<DriverMotion> = STILL_MOTION): DriverPose {
  const n = sk.ids.length;
  const world = Array.from({ length: n }, () => new Quaternion());
  const joints = Array.from({ length: n }, () => new Vector3());
  const set = (id: string, at: Vector3, rotation: Quaternion) => {
    const i = sk.index[id] as number;
    (joints[i] as Vector3).copy(at);
    (world[i] as Quaternion).copy(rotation);
  };
  const C = catalogue.contacts;
  const lean = new Quaternion().setFromAxisAngle(X, motion.lean);

  // Buste : penché `torso` (voiture : vers l'arrière, contre le dossier ; moto : vers l'avant), le
  // bassin avancé de `shift` et enfoncé de `sink` dans l'assise. Choisis une fois par véhicule
  // (seating.plan), puis gardés.
  const share = seating.kind === 'car' ? 0.6 : 0.45;
  const upper = (torso: number, shift: number, sink: number) => {
    const pelvis = lean.clone().multiply(pitch(torso * share));
    const contact = v3(C.seat).applyQuaternion(pelvis);
    const hip = v3(seating.seat).sub(contact);
    hip.x += shift;
    hip.y -= sink;
    if (seating.kind === 'bike') {
      // Sur une selle, le bassin penché pose le bas de son ventre avant ses fesses : le point le plus
      // bas de la ligne des fesses à l'entrejambe touche l'assise.
      let low = Infinity;
      for (const [x, y] of SEAT_LINE) low = Math.min(low, new Vector3(x, y, 0).applyQuaternion(pelvis).y);
      hip.y += contact.y - low + 0.006;
    }
    hip.z += motion.hang;
    // Les épaules suivent un peu le volant qui tourne.
    const chest = lean.clone().multiply(new Quaternion().setFromAxisAngle(Y, motion.steer * 0.2)).multiply(pitch(torso + motion.surge));
    const waist = child(sk, 'buste', hip, pelvis);
    const shoulders = (['epaule_g', 'epaule_d'] as const).map((id) => child(sk, id, waist, chest));
    return { pelvis, hip, chest, waist, shoulders: shoulders as [Vector3, Vector3] };
  };
  const armLength = boneLength(sk, 'coude_g') + boneLength(sk, 'main_g');
  const gripDistance = Math.hypot(C.grip[1], C.grip[2]);
  const targets: [Vector3, Vector3] =
    seating.kind === 'car'
      ? [rimPoint(seating.wheel, seating.hands).at, rimPoint(seating.wheel, -seating.hands).at]
      : [v3(seating.grips[0].at), v3(seating.grips[1].at)];
  if (!seating.plan) {
    // Bras à `reach` × leur longueur (jusqu'au point de prise) ; en voiture, le dos près de son
    // inclinaison voulue, le bassin peu avancé et peu enfoncé, la tête sous le pavillon, les genoux
    // sous la planche de bord et sous la jante.
    const want = (seating.kind === 'car' ? DRIVER_POSE.car.reach : seating.reach) * (armLength + gripDistance);
    let best = { torso: 0, shift: 0, sink: 0, score: Infinity };
    const torsos = seating.kind === 'car' ? [0.08, 0.6] : [-0.25, 1.2];
    const shifts = seating.kind === 'car' ? [-0.06, 0.12] : [0, 0];
    const sinks = seating.kind === 'car' ? [0, 0.02] : [0, 0];
    for (let r = torsos[0] as number; r <= (torsos[1] as number) + 1e-9; r += 0.01) {
      for (let t = shifts[0] as number; t <= (shifts[1] as number) + 1e-9; t += 0.02) {
        for (let d = sinks[0] as number; d <= (sinks[1] as number) + 1e-9; d += 0.01) {
          const torso = seating.kind === 'car' ? -r : r;
          const b = upper(torso, t, d);
          const reach = (b.shoulders[0].distanceTo(targets[0]) + b.shoulders[1].distanceTo(targets[1])) / 2;
          let score = Math.abs(reach - want) + 20 * Math.max(0, reach - 0.97 * (armLength + gripDistance));
          if (seating.kind === 'car') {
            score += 0.5 * Math.abs(r - seating.recline) + 0.4 * Math.abs(t) + 1.5 * d;
            if (seating.roof !== null) score += 20 * Math.max(0, headTop(sk, b.waist, b.chest) - (seating.roof - DRIVER_POSE.car.headroom));
            for (const leg of legsOf(sk, catalogue, seating, b)) score += 20 * kneeOverlap(seating, leg.knee);
          }
          if (score < best.score - 1e-9) best = { torso, shift: t, sink: d, score };
        }
      }
    }
    seating.plan = { torso: best.torso, shift: best.shift, sink: best.sink };
  }
  const torso = seating.plan.torso;
  const body = upper(torso, seating.plan.shift, seating.plan.sink);
  set('bassin', body.hip, body.pelvis);
  set('buste', body.waist, body.chest);

  // Cou et tête : la tête reste à peu près droite, regard un peu plongeant, tournée de `look`.
  const headPitch = seating.kind === 'car' ? 0.06 : Math.max(-0.15, -torso * 0.35);
  const neck = lean.clone().multiply(pitch((torso + motion.surge) * 0.4 + headPitch * 0.5));
  const neckAt = child(sk, 'cou', body.waist, body.chest);
  set('cou', neckAt, neck);
  const headLean = new Quaternion().setFromAxisAngle(X, motion.lean * 0.4);
  const head = headLean.multiply(new Quaternion().setFromAxisAngle(Y, motion.look)).multiply(pitch(headPitch));
  const headAt = child(sk, 'tete', neckAt, neck);
  set('tete', headAt, head);
  const eye = v3(C.eye).applyQuaternion(head).add(headAt);

  // Bras.
  const grips: [Vector3, Vector3] = [new Vector3(), new Vector3()];
  (['g', 'd'] as const).forEach((s, i) => {
    const side = (i === 0 ? -1 : 1) as -1 | 1;
    const shoulder = body.shoulders[i] as Vector3;
    let at: Vector3;
    let axis: Vector3;
    let palmToward: Vector3;
    if (seating.kind === 'car') {
      const rim = rimPoint(seating.wheel, -side * seating.hands + motion.steer);
      at = rim.at;
      axis = rim.tangent;
      palmToward = rim.outward.clone().negate();
    } else {
      const grip = seating.grips[i] as { at: Vec3; axis: Vec3 };
      at = v3(grip.at);
      axis = v3(grip.axis);
      // Guidon braqué : la poignée tourne autour de l'axe de direction, la main la suit.
      if (seating.steering && motion.steer !== 0) {
        const turn = new Quaternion().setFromAxisAngle(v3(seating.steering.dir), motion.steer);
        const pivot = v3(seating.steering.at);
        at.sub(pivot).applyQuaternion(turn).add(pivot);
        axis.applyQuaternion(turn);
      }
      palmToward = new Vector3(0.3, -1, 0);
    }
    const hand = gripHand(at, axis, shoulder, palmToward, side, C.grip);
    const a = boneLength(sk, `coude_${s}`);
    const b = boneLength(sk, `main_${s}`);
    const pole = seating.kind === 'car' ? new Vector3(-0.2, -1, side * 0.7) : new Vector3(-0.1, -0.5, side);
    const elbow = twoBone(shoulder, hand.wrist, a, b, pole);
    const [up, fore] = limb(shoulder, elbow, hand.wrist, 1, pole);
    set(`epaule_${s}`, shoulder, up);
    set(`coude_${s}`, elbow, fore);
    // Le poignet suit l'avant-bras : la main est posée au point de prise ; si le bras n'y arrive pas,
    // elle reste au bout de l'avant-bras.
    const wristAt = child(sk, `main_${s}`, elbow, fore);
    set(`main_${s}`, wristAt, hand.rotation);
    grips[i] = v3(C.grip).setZ(C.grip[2] * -side).applyQuaternion(hand.rotation).add(wristAt);
  });

  // Jambes.
  const ankles: [Vector3, Vector3] = [new Vector3(), new Vector3()];
  legsOf(sk, catalogue, seating, body).forEach((leg, i) => {
    const s = i === 0 ? 'g' : 'd';
    set(`hanche_${s}`, leg.hip, leg.thigh);
    set(`genou_${s}`, leg.knee, leg.shin);
    set(`pied_${s}`, child(sk, `pied_${s}`, leg.knee, leg.shin), leg.foot);
    ankles[i] = leg.ankle;
  });

  return { world, joints, grips, ankles, eye, torso };
}

interface Leg {
  hip: Vector3;
  knee: Vector3;
  ankle: Vector3;
  thigh: Quaternion;
  shin: Quaternion;
  foot: Quaternion;
}

/**
 * Les deux jambes, bassin posé. Voiture : talons au plancher, pointes relevées vers le pédalier
 * (jusqu'au premier obstacle devant les pieds) ; moto : la voûte (repose-pieds avancés) ou la plante
 * (reculés) sur le dessus du repose-pied.
 */
function legsOf(sk: DriverSkeleton, catalogue: DriverCatalogue, seating: Seating, body: { hip: Vector3; pelvis: Quaternion }): [Leg, Leg] {
  const C = catalogue.contacts;
  return (['g', 'd'] as const).map((s, i) => {
    const side = (i === 0 ? -1 : 1) as -1 | 1;
    const hip = child(sk, `hanche_${s}`, body.hip, body.pelvis);
    const a = boneLength(sk, `genou_${s}`);
    const b = boneLength(sk, `pied_${s}`);
    let foot: Quaternion;
    let ankle: Vector3;
    let pole: Vector3;
    if (seating.kind === 'car') {
      const P = DRIVER_POSE.car;
      foot = new Quaternion().setFromAxisAngle(Y, -side * 0.08).multiply(pitch(-P.footPitch));
      const heel = v3(C.heel).applyQuaternion(foot);
      const toe = new Vector3(0.21, -0.06, 0).applyQuaternion(foot);
      const y = seating.floor + 0.006 - heel.y;
      const reach = P.legReach * (a + b);
      const dy = hip.y - y;
      let x = hip.x + Math.sqrt(Math.max(0.01, reach * reach - dy * dy));
      const front = seating.toeBoard;
      if (front !== null) x = Math.min(x, (typeof front === 'number' ? front : (front[i] as number)) - toe.x - 0.03);
      // Pieds un peu rentrés, genoux droits devant (écartés de part et d'autre de la colonne si le volant est bas).
      ankle = new Vector3(x, y, hip.z - side * 0.035);
      pole = new Vector3(0.35, 1, side * (seating.kneeSpread ?? -0.05));
    } else {
      const peg = seating.pegs[i] as { at: Vec3; radius: number };
      const ahead = peg.at[0] > body.hip.x + 0.25;
      foot = new Quaternion().setFromAxisAngle(Y, ahead ? 0 : -side * 0.1).multiply(pitch(ahead ? -0.22 : 0.42));
      const contact = (ahead ? new Vector3(0.035, C.heel[1], 0) : v3(C.ball)).applyQuaternion(foot);
      ankle = v3(peg.at).add(new Vector3(0, peg.radius + 0.004, side * (ahead ? 0.03 : 0.012))).sub(contact);
      pole = new Vector3(ahead ? 0.6 : 0.8, 0.35, side * (ahead ? 0.5 : 0.42));
    }
    const knee = twoBone(hip, ankle, a, b, pole);
    const [thigh, shin] = limb(hip, knee, ankle, -1, pole);
    return { hip, knee, ankle, thigh, shin, foot };
  }) as [Leg, Leg];
}

/** Ce qui dépasse d'un genou (rayon 7,5 cm) dans la planche de bord ou sous la jante, en mètres. */
function kneeOverlap(seating: CarSeating, knee: Vector3): number {
  const R = 0.075;
  let over = 0;
  for (const [y, x] of seating.legRoom ?? []) if (Math.abs(y - knee.y) < R) over = Math.max(over, knee.x + R + 0.01 - x);
  const bottom = rimPoint(seating.wheel, Math.PI).at;
  if (Math.abs(knee.z - bottom.z) < seating.wheel.radius + R && Math.abs(knee.x - bottom.x) < 0.12) over = Math.max(over, knee.y + R + 0.015 - bottom.y);
  return Math.max(0, over);
}

/** Haut de la tête (casquette ou casque compris), buste posé, tête droite. */
function headTop(sk: DriverSkeleton, waist: Vector3, chest: Quaternion): number {
  const neckAt = child(sk, 'cou', waist, chest);
  const headAt = child(sk, 'tete', neckAt, chest);
  return headAt.y + 0.255;
}

/**
 * Rotations locales des os (repère du parent) d'après la pose : à poser sur les os d'un squelette
 * three dont le bassin est au repère de la caisse.
 */
export function localRotations(sk: DriverSkeleton, pose: DriverPose, out: Quaternion[] = sk.ids.map(() => new Quaternion())): Quaternion[] {
  const inverse = new Quaternion();
  for (let i = 0; i < sk.ids.length; i += 1) {
    const p = sk.parent[i] as number;
    const w = pose.world[i] as Quaternion;
    if (p < 0) (out[i] as Quaternion).copy(w);
    else (out[i] as Quaternion).copy(inverse.copy(pose.world[p] as Quaternion).invert().multiply(w));
  }
  return out;
}
