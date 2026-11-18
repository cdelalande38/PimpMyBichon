// Outils de mesure du tremblement de la sortie (lot « tremblote », 17 novembre 2026) : la boucle d'image
// du moteur (src/drive/scene/moteur.ts, frame) rejouée hors du navigateur, à pas de temps imposé
// (60 i/s, 30 i/s, ou irrégulière de 16 à 50 ms, tirage reproductible), avec le pilote automatique ou un
// joueur simulé (manche tenu, petit bruit de pouce à graine fixe). Chaque image enregistre la pose du
// véhicule, celle de la caméra, et la pose du véhicule VUE DE LA CAMÉRA (position à l'écran en pixels
// sur 390 × 844, cap relatif à l'axe de la caméra, roulis apparent). Le chiffre de tremblement d'une
// grandeur : on retire sa tendance (régression linéaire locale, en temps, sur ± 0,1 s, ce qui laisse
// passer ce qui est au-dessus de 5 Hz environ), puis on prend l'écart-type du saut d'image à image du
// reste. Un mouvement lisse échantillonné à cadence irrégulière donne presque zéro : seul compte ce qui
// n'est pas une fonction lisse du temps.
import { existsSync, readFileSync } from 'node:fs';
import type { MapRoute } from '../../src/data/mapTypes.ts';
import type { Build, VehicleManifest } from '../../src/data/vehicleTypes.ts';
import * as cameras from '../../src/drive/cameras.ts';
import { cameraFeel, cameraShot, chase, createShot, guardShot, type GroundSampler } from '../../src/drive/cameras.ts';
import type { CameraId, DriveInput, Rail, RailPose, VehicleFrame, Weather } from '../../src/drive/contrat.ts';
import { courbureBraquage, createPilot, performanceDe, PILOT, sampleLine, type PilotWithProfile } from '../../src/drive/pilote.ts';
import { createPose, createRail } from '../../src/drive/rail.ts';
import { addRoleMesh, createChunkRelief, Relief } from '../../src/drive/scene/relief.ts';
import { stepOf } from '../../src/drive/scene/profil.ts';

/** Tirage reproductible dans [0, 1[. */
export function tirage(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

export type Cadence = '60' | '30' | 'irreguliere';

/** Durées d'image successives (s) : régulières, ou tirées entre 16 et 50 ms. */
export function cadence(kind: Cadence, seed = 7): () => number {
  if (kind === '60') return () => 1 / 60;
  if (kind === '30') return () => 1 / 30;
  const r = tirage(seed);
  return () => 0.016 + 0.034 * r();
}

const MAPS = new URL('../../public/assets/maps/', import.meta.url);

export function chargerRoute(id: string): MapRoute {
  return JSON.parse(readFileSync(new URL(`${id}/route.json`, MAPS), 'utf8')) as MapRoute;
}

export function carteFabriquee(id: string): boolean {
  return existsSync(new URL(`${id}/route.json`, MAPS));
}

/** Lecteur GLB minimal (comme tests/unit/drive-camera-sol.test.ts) : positions et indices par rôle. */
function lireTroncon(file: URL): Array<{ role: string; positions: Float32Array; index: Uint32Array | Uint16Array | null }> {
  const buf = readFileSync(file);
  const jsonLength = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8')) as {
    meshes: Array<{ name: string; primitives: Array<{ attributes: { POSITION: number }; indices?: number }> }>;
    accessors: Array<{ bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }>;
    bufferViews: Array<{ byteOffset?: number; byteLength: number }>;
  };
  const binStart = 20 + jsonLength + 8;
  const view = (accessor: number) => {
    const a = json.accessors[accessor]!;
    const bv = json.bufferViews[a.bufferView]!;
    const offset = binStart + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const size = a.type === 'VEC3' ? 3 : 1;
    const bytes = buf.buffer.slice(buf.byteOffset + offset, buf.byteOffset + offset + a.count * size * (a.componentType === 5123 ? 2 : 4));
    if (a.componentType === 5126) return new Float32Array(bytes);
    if (a.componentType === 5123) return new Uint16Array(bytes);
    return new Uint32Array(bytes);
  };
  return json.meshes.flatMap((m) =>
    m.primitives.map((p) => ({
      role: m.name.replace(/^fusion_/, ''),
      positions: view(p.attributes.POSITION) as Float32Array,
      index: p.indices === undefined ? null : (view(p.indices) as Uint32Array | Uint16Array),
    })),
  );
}

/** Relief de tous les tronçons d'une carte (garde des caméras). */
export function chargerRelief(id: string, route: MapRoute): Relief {
  const dir = new URL(`${id}/`, MAPS);
  const relief = new Relief();
  route.chunks.forEach((chunk, i) => {
    const r = createChunkRelief();
    for (const m of lireTroncon(new URL(chunk.file, dir))) addRoleMesh(r, m.role, m.positions, m.index, ...chunk.origin);
    relief.set(i, r);
  });
  return relief;
}

/** Ce que fait le joueur simulé à chaque image. */
export type Joueur = 'auto' | 'main' | 'bord' | 'nos' | 'freinage' | 'feux' | 'depart' | 'vite' | 'coupure' | 'gaz';

/**
 * Coupures du manche (demande du 17 novembre 2026 au soir : « on perd le focus du joystick virtuel
 * parfois ») : toutes les 1,5 à 3 s, le manche retombe au neutre (gaz et braquage) pendant 100 à
 * 300 ms, puis revient. Tirage reproductible ; rend les intervalles [début, fin] en secondes.
 */
export function coupures(seconds: number, seed: number): Array<[number, number]> {
  const r = tirage(seed * 17 + 3);
  const out: Array<[number, number]> = [];
  let t = 1.5 + 1.5 * r();
  while (t < seconds) {
    const d = 0.1 + 0.2 * r();
    out.push([t, t + d]);
    t += d + 1.5 + 1.5 * r();
  }
  return out;
}

export interface Scenario {
  rail: Rail;
  vehicle: Pick<VehicleManifest, 'kind' | 'engine' | 'performance' | 'halfLengthHint'> & Partial<Pick<VehicleManifest, 'wheels'>>;
  camera: CameraId;
  cadence: Cadence;
  joueur: Joueur;
  /** Abscisse de départ (m), durée (s), et part du début écartée de la mesure (s). */
  from: number;
  seconds: number;
  warmup?: number;
  relief?: GroundSampler | null;
  /** Tremblement voulu de la caméra à haute vitesse (CAMERA_FEEL) : coupé par défaut. */
  shake?: boolean;
  seed?: number;
  /** Coupures du manche imposées (s), au lieu du tirage de `coupures` (joueur « coupure »). */
  cuts?: Array<[number, number]>;
  /** Préparation (pneus, assiette : src/data/preparation.ts) et météo ; absentes : l'origine, au sec. */
  build?: Partial<Build>;
  meteo?: Weather;
  /** Appelé avec le plan avant sa garde au sol (diagnostic). */
  espion?: (shot: { position: number[]; target: number[] }, frame: VehicleFrame, s: number) => void;
}

/** Une image enregistrée. */
export interface Trace {
  t: Float64Array;
  s: Float64Array;
  speed: Float64Array;
  heading: Float64Array;
  roll: Float64Array;
  pitch: Float64Array;
  steer: Float64Array;
  yaw: Float64Array;
  offset: Float64Array;
  /** Véhicule à l'écran (pixels, 390 × 844), cap relatif à l'axe de la caméra (rad), roulis apparent (rad). */
  screenX: Float64Array;
  screenY: Float64Array;
  viewHeading: Float64Array;
  viewRoll: Float64Array;
  /** Caméra : position (m), cap et site de son axe (rad). */
  camX: Float64Array;
  camY: Float64Array;
  camZ: Float64Array;
  camYaw: Float64Array;
  camPitch: Float64Array;
  /** Relevé de la garde au sol (m). */
  guard: Float64Array;
  /** Bord touché pendant l'image (−1 droite, 1 gauche, 0 libre), manche reçu (−1 à 1). */
  contact: Float64Array;
  stick: Float64Array;
  count: number;
}

const WIDTH = 390;
const HEIGHT = 844;

function newTrace(n: number): Trace {
  const f = () => new Float64Array(n);
  return {
    t: f(), s: f(), speed: f(), heading: f(), roll: f(), pitch: f(), steer: f(), yaw: f(), offset: f(),
    screenX: f(), screenY: f(), viewHeading: f(), viewRoll: f(), camX: f(), camY: f(), camZ: f(), camYaw: f(), camPitch: f(), guard: f(), contact: f(), stick: f(),
    count: 0,
  };
}

const wrap = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

/** Entrée du joueur simulé pour cette image (modifie `input`). */
function jouer(joueur: Joueur, pilot: PilotWithProfile, pose: RailPose, input: DriveInput, t: number, thumb: number, kind: 'car' | 'bike'): void {
  const m = pilot.motion;
  if (joueur === 'auto') {
    input.auto = true;
    return;
  }
  input.auto = false;
  const v = m.speed;
  // Vitesse visée : un peu au-dessus du profil du pilote automatique.
  const sample = pilot.profile.auto;
  const i = Math.min(sample.length - 1, Math.max(0, Math.round(m.s / pilot.profile.step)));
  // Joueur pressé (« en vue poursuite on est avec de la vitesse en manuel ») : bien au-dessus du profil.
  const fast = joueur === 'vite' || joueur === 'coupure';
  const goal = (sample[i] ?? 20) * (fast ? 1.4 : 1.1) + (fast ? 4 : 1);
  input.throttle = v < goal - 1 ? 1 : v < goal ? 0.4 : 0;
  input.brake = v > goal + 2 ? Math.min(1, (v - goal - 2) / 4) : 0;
  if (joueur === 'freinage') {
    input.throttle = t < 6 ? 1 : 0;
    input.brake = t < 6 ? 0 : 1;
  }
  if (joueur === 'nos' || joueur === 'depart' || joueur === 'gaz') {
    input.throttle = 1;
    input.brake = 0;
  }
  if (joueur === 'nos' && t > 3) input.nos = Math.floor((t - 3) / 3.2) + 1;
  // Manche : rattraper la trajectoire (écart et cap), plus le bruit du pouce.
  const lead = m.s + v * 0.5;
  const e = sampleLine(pilot.line.offset, pilot.line, lead) - m.offset;
  const want = pose.curvature + (2 * e) / Math.max(25, v * v * 0.6) - (m.yaw ?? 0) / Math.max(4, v * 0.5);
  const full = Math.min(courbureBraquage(kind), (PILOT.free.fullGrip * Math.max(1, pilot.performance.grip)) / Math.max(16, v * v));
  let u = -Math.sign(want) * Math.pow(Math.min(1, Math.abs(want) / full), 1 / PILOT.free.expo);
  if (joueur === 'bord') u = pose.curvature > 0 ? 0.35 : -0.35;
  u += thumb;
  // Le manche de l'écran arrondit au centième.
  input.steer = Math.round(Math.max(-1, Math.min(1, u)) * 100) / 100;
}

/**
 * Rejoue la boucle d'image du moteur pour un scénario ; rend la trace (après la mise en route).
 * Même calcul de pose que src/drive/scene/moteur.ts (frame) : rail, écart, cap, roulis, plongée.
 */
export function rejouer(sc: Scenario): Trace {
  const kind = sc.vehicle.kind;
  const pilot = createPilot(sc.rail, performanceDe(sc.vehicle, sc.build));
  if (sc.meteo) pilot.setWeather(sc.meteo);
  const halfWidth = kind === 'bike' ? 0.45 : 0.95;
  const height = kind === 'bike' ? 1.2 : 1.4;
  pilot.setSize(halfWidth, sc.vehicle.halfLengthHint);
  pilot.reset(sc.from);
  const input: DriveInput = { auto: true, throttle: 0, brake: 0, lane: 0 };
  // Lancé : le véhicule part à la vitesse du profil (sauf départ et feux).
  if (sc.joueur !== 'depart' && sc.joueur !== 'feux') {
    const warm: DriveInput = { auto: true, throttle: 0, brake: 0, lane: 0 };
    pilot.reset(Math.max(0, sc.from - 150));
    for (let k = 0; k < 3600 && pilot.motion.s < sc.from; k += 1) pilot.step(1 / 60, warm, kind);
  }
  const next = cadence(sc.cadence, sc.seed ?? 7);
  const thumbNoise = tirage((sc.seed ?? 7) * 31 + 5);
  const pose = createPose();
  const frame: VehicleFrame = { kind, position: [0, 0, 0], heading: 0, pitch: 0, roll: 0, halfLength: sc.vehicle.halfLengthHint, halfWidth, height };
  const shot = createShot();
  const orbit = { yaw: 0.6, pitch: 0.28, distance: 7.5 };
  const reduced = cameraFeel.reducedMotion;
  cameraFeel.reducedMotion = !sc.shake;
  chase.time = Number.NaN;
  // Mémoire de la garde (absente de l'ancien code).
  const memoire = (cameras as unknown as { guard?: { lastId: string } }).guard;
  if (memoire) memoire.lastId = '';
  const frames = Math.ceil(sc.seconds * 70);
  const tr = newTrace(frames);
  let time = 0;
  let thumb = 0;
  const warmup = sc.warmup ?? 1;
  let started = sc.joueur !== 'depart';
  const cuts = sc.cuts ?? (sc.joueur === 'coupure' ? coupures(sc.seconds, sc.seed ?? 7) : null);
  try {
    for (let n = 0; n < frames && time < sc.seconds; n += 1) {
      const dt = stepOf(next(), false, false);
      time += dt;
      // Bruit du pouce : marche au hasard rappelée vers zéro, ± 0,04 environ.
      thumb = thumb * 0.9 + (thumbNoise() - 0.5) * 0.02;
      pilot.rail.poseAt(pilot.motion.s, pose);
      jouer(sc.joueur, pilot, pose, input, time, sc.joueur === 'auto' ? 0 : thumb, kind);
      if (sc.joueur === 'feux') input.throttle = time % 2 < 1 ? 1 : 0;
      if (cuts && cuts.some(([a, b]) => time >= a && time < b)) {
        input.steer = 0;
        input.throttle = 0;
        input.brake = 0;
      }
      if (sc.joueur === 'depart' && time > 1.5) started = true;
      pilot.setHold(sc.joueur === 'feux' || !started);
      const motion = pilot.step(dt, input, kind);
      sc.rail.poseAt(motion.s, pose);
      const tx = pose.tangent[0];
      const tz = pose.tangent[2];
      const hl = Math.hypot(tx, tz) || 1;
      const px = pose.position[0] + (tz / hl) * motion.offset;
      const py = pose.position[1];
      const pz = pose.position[2] - (tx / hl) * motion.offset;
      const heading = pose.heading + (motion.yaw ?? 0);
      frame.position[0] = px;
      frame.position[1] = py;
      frame.position[2] = pz;
      frame.heading = heading;
      frame.pitch = pose.pitch + motion.dive;
      frame.roll = motion.roll;
      cameraShot(sc.camera, frame, motion, sc.rail, time, orbit, shot);
      const y0 = shot.position[1];
      sc.espion?.(shot, frame, motion.s);
      if (sc.relief && pose.ground !== 'tunnel') guardShot(shot, sc.relief);
      if (time < warmup) continue;
      // Axe de la caméra (lookAt, haut +Y), puis roulis.
      const [cx, cy, cz] = shot.position;
      let fx = shot.target[0] - cx;
      let fy = shot.target[1] - cy;
      let fz = shot.target[2] - cz;
      const fl = Math.hypot(fx, fy, fz) || 1;
      fx /= fl;
      fy /= fl;
      fz /= fl;
      // Droite = avant × haut ; haut = droite × avant.
      let rx = -fz;
      let rz = fx;
      const rl = Math.hypot(rx, rz) || 1;
      rx /= rl;
      rz /= rl;
      let ux = -rz * fy;
      let uy = rz * fx - rx * fz;
      let uz = rx * fy;
      let rxx = rx;
      let ry = 0;
      let rzz = rz;
      if (shot.roll) {
        const c = Math.cos(shot.roll);
        const s = Math.sin(shot.roll);
        [rxx, ry, rzz, ux, uy, uz] = [rx * c + ux * s, ry * c + uy * s, rz * c + uz * s, -rx * s + ux * c, -ry * s + uy * c, -rz * s + uz * c];
      }
      const dx = px - cx;
      const dy = py + height * 0.5 - cy;
      const dz = pz - cz;
      const depth = dx * fx + dy * fy + dz * fz;
      const tanHalf = Math.tan((shot.fov * Math.PI) / 360);
      const aspect = WIDTH / HEIGHT;
      const k = tr.count;
      tr.t[k] = time;
      tr.s[k] = motion.s;
      tr.speed[k] = motion.speed;
      tr.heading[k] = heading;
      tr.roll[k] = motion.roll;
      tr.pitch[k] = frame.pitch;
      tr.steer[k] = motion.steer ?? 0;
      tr.yaw[k] = motion.yaw ?? 0;
      tr.offset[k] = motion.offset;
      if (depth > 0.3) {
        tr.screenX[k] = WIDTH / 2 + ((dx * rxx + dy * ry + dz * rzz) / depth / (tanHalf * aspect)) * (WIDTH / 2);
        tr.screenY[k] = HEIGHT / 2 - ((dx * ux + dy * uy + dz * uz) / depth / tanHalf) * (HEIGHT / 2);
      } else {
        tr.screenX[k] = Number.NaN;
        tr.screenY[k] = Number.NaN;
      }
      const camYaw = Math.atan2(-fz, fx);
      tr.camYaw[k] = camYaw;
      tr.camPitch[k] = Math.asin(Math.max(-1, Math.min(1, fy)));
      tr.viewHeading[k] = wrap(heading - camYaw);
      tr.viewRoll[k] = motion.roll + (shot.roll ?? 0);
      tr.camX[k] = cx;
      tr.camY[k] = cy;
      tr.camZ[k] = cz;
      tr.guard[k] = shot.position[1] - y0;
      tr.contact[k] = pilot.contact;
      tr.stick[k] = input.steer ?? 0;
      tr.count += 1;
    }
  } finally {
    cameraFeel.reducedMotion = reduced;
  }
  return tr;
}

/** Angle déroulé (sans saut de 2π), pour les caps. */
function unwrap(x: Float64Array, n: number): Float64Array {
  const out = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i += 1) {
    if (i === 0) acc = x[0]!;
    else acc += wrap(x[i]! - x[i - 1]!);
    out[i] = acc;
  }
  return out;
}

/**
 * Chiffre de tremblement d'une grandeur : reste après régression linéaire locale en temps (± `window` s),
 * écart-type de son saut d'image à image (`saut`) et plus grand saut (`pic`). Images sans valeur (NaN) écartées.
 */
export function tremblement(tr: Trace, values: Float64Array, angle = false, window = 0.1): { saut: number; pic: number } {
  const n = tr.count;
  const x = angle ? unwrap(values, n) : values;
  const t = tr.t;
  const rest = new Float64Array(n).fill(Number.NaN);
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < n; i += 1) {
    if (!(x[i] === x[i])) continue;
    while (t[lo]! < t[i]! - window) lo += 1;
    while (hi < n - 1 && t[hi + 1]! <= t[i]! + window) hi += 1;
    if (t[i]! - t[0]! < window || t[n - 1]! - t[i]! < window) continue;
    let sw = 0;
    let st = 0;
    let sx = 0;
    let stt = 0;
    let stx = 0;
    let ok = true;
    for (let j = lo; j <= hi; j += 1) {
      const xj = x[j]!;
      if (!(xj === xj)) {
        ok = false;
        break;
      }
      const tj = t[j]! - t[i]!;
      sw += 1;
      st += tj;
      sx += xj;
      stt += tj * tj;
      stx += tj * xj;
    }
    if (!ok || sw < 3) continue;
    const den = sw * stt - st * st;
    const fit = den > 1e-12 ? (sx * stt - st * stx) / den : sx / sw;
    rest[i] = x[i]! - fit;
  }
  let sum = 0;
  let count = 0;
  let pic = 0;
  for (let i = 1; i < n; i += 1) {
    const d = rest[i]! - rest[i - 1]!;
    if (!(d === d)) continue;
    sum += d * d;
    count += 1;
    pic = Math.max(pic, Math.abs(d));
  }
  return { saut: count > 0 ? Math.sqrt(sum / count) : 0, pic };
}

const DEG = 180 / Math.PI;

/** Les chiffres d'un scénario : degrés pour les angles, pixels à l'écran, centimètres pour la caméra. */
export function chiffres(tr: Trace): Record<string, number> {
  const r = (v: number, k = 1000) => Math.round(v * k) / k;
  const deg = (v: Float64Array) => tremblement(tr, v, true).saut * DEG;
  return {
    cap: r(deg(tr.heading)),
    roulis: r(deg(tr.roll)),
    tangage: r(deg(tr.pitch)),
    braquage: r(deg(tr.steer)),
    ecranX: r(tremblement(tr, tr.screenX).saut, 100),
    ecranY: r(tremblement(tr, tr.screenY).saut, 100),
    capVu: r(deg(tr.viewHeading)),
    roulisVu: r(deg(tr.viewRoll)),
    camY: r(tremblement(tr, tr.camY).saut * 100, 100),
    camCap: r(deg(tr.camYaw)),
    camSite: r(deg(tr.camPitch)),
  };
}

export function lireRail(id: string): Rail {
  return createRail(chargerRoute(id));
}
