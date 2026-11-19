// Les six caméras de la sortie (§ 5.5) : des fonctions du véhicule, de son mouvement et du rail. Une
// seule mémoire d'une image à l'autre, le retard de la poursuite et de la rasante (`chase`, avancé par
// le temps de sortie) ; sinon un plan est une fonction continue de l'abscisse et de la pose, donc sans
// saut (sauf le travelling, qui change de poste comme on coupe un plan).
//
// Virage (demande du 16 novembre 2026 : « on voit un véhicule qui reste droit et prend le virage ») :
// la poursuite et la rasante suivent le cap du véhicule avec un retard (CHASE.tau, écart borné à
// CHASE.max) et sa place avec un retard plus court : en courbe on voit son flanc qui s'inscrit, puis
// la caméra revient dans l'axe. L'embarquée penche avec la caisse (une part bornée du roulis, l'œil
// suit le motard qui se couche) et regarde un peu vers l'intérieur de la courbe.
//
// Direction à la main (le véhicule peut prendre un vrai cap sur la route, `motion.yaw`, ±0,6 rad au
// plus) : la poursuite se place derrière le véhicule (son cap relatif s'ajoute au retard), pas
// derrière la route ; l'embarquée regarde là où pointe le véhicule. En pilote automatique ce cap ne
// fait que quelques degrés : rien ne change à l'œil.
//
// - poursuite : derrière, sur le rail quelques mètres en arrière, à la hauteur du toit ; suit la route.
// - rasante : au ras du sol (0,35 m), le long du flanc gauche (côté axe de la chaussée), regarde vers
//   l'arrière du véhicule.
// - avant : devant, sur le rail, regarde le véhicule arriver.
// - embarquee : à la place du conducteur du manifeste (œil posé sur son siège par la scène, `cockpit`,
//   puis œil de conduite : COCKPIT, `cockpitView`), sinon au-dessus du toit (du casque du motard) ;
//   regarde la route plus loin. Le réglage « Hauteur du regard » du joueur monte ou descend l'œil.
// - travelling : un poste fixe sur le bas-côté, tous les TRAVELLING.spacing m, côté droit puis côté
//   gauche ; le véhicule arrive de loin, passe devant, s'éloigne, puis on coupe au poste suivant. Le
//   champ se resserre quand il est loin (téléobjectif) et s'ouvre quand il passe.
// - orbite : autour du véhicule, réglée au doigt (OrbitView), bornée au-dessus du sol.
// Au-delà des bouts d'un parcours ouvert, les points du rail se prolongent en ligne droite.
//
// Impression de vitesse (CAMERA_FEEL), bornée pour ne jamais donner le mal de mer : le champ s'ouvre
// avec la vitesse (≈ 3° à 90 km/h, davantage au-delà, plafonné) et pendant le NOS ; la poursuite
// descend avec la vitesse (le bord de route défile plus vite à l'écran), recule à l'accélération (le véhicule s'éloigne dans le cadre) et se
// rapproche au freinage, d'après l'accélération lissée du pilote (`motion.pull`, sans les à-coups des
// passages de rapport) ; un léger tremblement à haute vitesse, fonction du temps (déterministe), coupé
// si le téléphone demande moins de mouvement.

import { liveNos } from '../data/nos.ts';
import type { DriveEyeSpec } from '../data/vehicleTypes.ts';
import type { CameraId, CameraShot, DriveMotion, OrbitView, Rail, RailPose, Vec3, VehicleFrame } from './contrat.ts';
import { createPose, lateralPoint } from './rail.ts';

export const TRAVELLING = {
  /** Écart entre deux postes, en mètres le long du rail. */
  spacing: 90,
  /** Distance parcourue après le poste avant de couper au suivant, en mètres. */
  passBy: 24,
  /** Écart au bord de la chaussée (sur le bas-côté), et hauteur, en mètres. */
  shoulder: 1.4,
  height: 1.1,
  /** Champ : bornes, en degrés ; taille à cadrer autour du véhicule, en mètres. */
  fovMin: 14,
  fovMax: 58,
  frame: 7,
} as const;

/** Impression de vitesse : réglages et bornes. */
export const CAMERA_FEEL = {
  /** Champ ajouté : degrés à 90 km/h (25 m/s), plafond, vitesse du plafond (m/s) ; pendant le NOS. */
  fovAt90: 3,
  fovMax: 14,
  fovFull: 70,
  fovBoost: 7,
  /** Poursuite : recul par m/s² d'accélération ressentie (m), recul et rapprochement les plus forts (m). */
  pullBack: 0.25,
  pullBackMax: 1.4,
  pullFwdMax: 0.9,
  /** Poursuite : abaissement à pleine vitesse (m, atteint à fovFull) et à l'accélération (m par m/s², plafond). */
  speedLower: 0.55,
  lower: 0.05,
  lowerMax: 0.3,
  /** Tremblement : vitesse où il commence et où il plafonne (m/s), amplitude au plafond (m). */
  shakeFrom: 22,
  shakeFull: 75,
  shakeMax: 0.03,
} as const;

/** Retard des caméras sur le véhicule en courbe, et inclinaison de l'embarquée : réglages et bornes. */
export const CHASE = {
  /** Retard sur le cap (s) et écart de cap le plus fort (rad, ≈ 15°). */
  tau: 0.4,
  max: 0.26,
  /** Retard sur la place (s) et écart latéral le plus fort (m). */
  lateralTau: 0.25,
  lateralMax: 1.2,
  /** Au-delà de ce temps (s) ou de cet écart d'abscisse (m) entre deux plans : la caméra se remet dans l'axe. */
  gap: 0.5,
  jump: 30,
  /** Embarquée : part du roulis suivie par l'image, et inclinaison la plus forte (rad), voiture et moto. */
  rollShare: { car: 0.6, bike: 0.5 },
  rollMax: 0.4,
  /** Embarquée : regard vers l'intérieur de la courbe (m par 1/m de courbure au point visé), borné (m). */
  inside: 220,
  insideMax: 2.5,
  /** Embarquée : distance du point visé en ligne droite (m), raccourcie en courbe (1 + distance × courbure × lookBend). */
  lookAt: 28,
  lookBend: 1,
  /** Embarquée d'une moto : œil relevé au-dessus du casque du motard (m). */
  bikeEyeLift: 0.4,
  /**
   * Embarquée à la place du conducteur : écart au plus, en radians (≈ 10°), entre le regard et l'axe du
   * véhicule. Au-delà, les instruments de la planche (vague R, « cadrans ») sortent du cadre en portrait
   * (champ horizontal d'environ ±19° pour un champ vertical de 74°) : la vitesse ne se lirait plus en virage.
   */
  cockpitYawMax: 0.17,
} as const;

/**
 * Mémoire du retard (une seule scène à la fois) : cap et écart latéral de la caméra, temps et abscisse
 * du dernier plan. `lag` (rad) et `slide` (m) sont les écarts au véhicule, bornés.
 */
export const chase = { time: Number.NaN, s: Number.NaN, heading: 0, offset: 0, lag: 0, slide: 0 };

const wrap = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

/**
 * Avance le retard jusqu'au temps `time` (s). Le premier plan, un temps qui recule ou saute de plus de
 * CHASE.gap, ou un saut d'abscisse (départ choisi, retour au début) remettent la caméra dans l'axe ;
 * un même temps ne change rien (plusieurs plans d'une même image). Aucune allocation.
 */
export function followChase(frame: VehicleFrame, motion: DriveMotion, rail: Rail, time: number): void {
  const C = CHASE;
  const dt = time - chase.time;
  let ds = motion.s - chase.s;
  if (rail.loop) ds -= rail.length * Math.round(ds / rail.length);
  if (!(dt >= 0) || dt > C.gap || !(Math.abs(ds) <= C.jump) || !Number.isFinite(frame.heading)) {
    chase.time = time;
    chase.s = motion.s;
    chase.heading = Number.isFinite(frame.heading) ? frame.heading : 0;
    chase.offset = motion.offset;
    chase.lag = 0;
    chase.slide = 0;
    return;
  }
  if (dt === 0) return;
  chase.time = time;
  chase.s = motion.s;
  chase.heading += wrap(frame.heading - chase.heading) * (1 - Math.exp(-dt / C.tau));
  chase.lag = Math.max(-C.max, Math.min(C.max, wrap(chase.heading - frame.heading)));
  chase.heading = frame.heading + chase.lag;
  chase.offset += (motion.offset - chase.offset) * (1 - Math.exp(-dt / C.lateralTau));
  chase.slide = Math.max(-C.lateralMax, Math.min(C.lateralMax, chase.offset - motion.offset));
  chase.offset = motion.offset + chase.slide;
}

/** Cap du véhicule relatif à la route (rad), borné comme le pilote le borne. */
const relativeYaw = (motion: DriveMotion) => {
  const yaw = motion.yaw ?? 0;
  return Number.isFinite(yaw) ? Math.max(-0.6, Math.min(0.6, yaw)) : 0;
};

/** Cap de la marche relatif à la route (rad) : celui de la caisse moins sa dérive (survirage), borné. */
const marchYaw = (motion: DriveMotion) => {
  const yaw = (motion.yaw ?? 0) - (motion.drift ?? 0);
  return Number.isFinite(yaw) ? Math.max(-0.6, Math.min(0.6, yaw)) : 0;
};

/** Tourne le point `p` de `angle` radians autour de la verticale passant par (cx, cz), comme un cap. */
function turnAround(p: Vec3, cx: number, cz: number, angle: number): void {
  if (angle === 0) return;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = p[0] - cx;
  const z = p[2] - cz;
  p[0] = cx + x * c + z * s;
  p[2] = cz - x * s + z * c;
}

/** Mouvement réduit demandé par le téléphone : pas de tremblement. Réglable par les tests. */
export const cameraFeel = {
  reducedMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
};

/** Champ ajouté par la vitesse (m/s), en degrés : ≈ 3° à 90 km/h, plafonné. */
export function speedFov(speed: number): number {
  const F = CAMERA_FEEL;
  const v = Math.max(0, Number.isFinite(speed) ? speed : 0);
  if (v <= 25) return (F.fovAt90 * v) / 25;
  return Math.min(F.fovMax, F.fovAt90 + ((F.fovMax - F.fovAt90) * (v - 25)) / (F.fovFull - 25));
}

/** Amplitude du tremblement à cette vitesse (m), nulle en mouvement réduit. */
export function shakeAmplitude(speed: number): number {
  if (cameraFeel.reducedMotion) return 0;
  const F = CAMERA_FEEL;
  return F.shakeMax * Math.min(1, Math.max(0, (speed - F.shakeFrom) / (F.shakeFull - F.shakeFrom)));
}

/** Bornes de l'orbite au doigt. */
export const ORBIT_LIMITS = { pitchMin: 0.06, pitchMax: 1.25, distanceMin: 3, distanceMax: 18 } as const;

export const DEFAULT_ORBIT: Readonly<OrbitView> = Object.freeze({ yaw: 0.6, pitch: 0.28, distance: 7.5 });

const orbitYaw = (yaw: number) => (Number.isFinite(yaw) ? yaw - 2 * Math.PI * Math.round(yaw / (2 * Math.PI)) : DEFAULT_ORBIT.yaw);
const orbitPitch = (pitch: number) =>
  Number.isFinite(pitch) ? Math.min(ORBIT_LIMITS.pitchMax, Math.max(ORBIT_LIMITS.pitchMin, pitch)) : DEFAULT_ORBIT.pitch;
const orbitDistance = (distance: number) =>
  Number.isFinite(distance) ? Math.min(ORBIT_LIMITS.distanceMax, Math.max(ORBIT_LIMITS.distanceMin, distance)) : DEFAULT_ORBIT.distance;

/** Orbite ramenée dans ses bornes (le lacet est ramené sur ]−π, π]). */
export function clampOrbit(view: OrbitView): OrbitView {
  return { yaw: orbitYaw(view.yaw), pitch: orbitPitch(view.pitch), distance: orbitDistance(view.distance) };
}

// Mémoire de travail, allouée une fois.
const scratch: RailPose = createPose();
const station: RailPose = createPose();
const point: Vec3 = [0, 0, 0];
const sight: CockpitView = { eye: [0, 0, 0], pitch: 0, fov: 74 };

/** Pose du rail à `s`, prolongée en ligne droite au-delà des bouts d'un parcours ouvert. */
function extendedPose(rail: Rail, s: number, out: RailPose): RailPose {
  rail.poseAt(s, out);
  if (!rail.loop) {
    const beyond = s < 0 ? s : s > rail.length ? s - rail.length : 0;
    if (beyond !== 0) {
      out.position[0] += out.tangent[0] * beyond;
      out.position[1] += out.tangent[1] * beyond;
      out.position[2] += out.tangent[2] * beyond;
    }
  }
  return out;
}

function set(out: Vec3, x: number, y: number, z: number): void {
  out[0] = x;
  out[1] = y;
  out[2] = z;
}

/** Rang du poste de travelling qui filme un véhicule à l'abscisse `s`. */
export function travellingIndex(s: number): number {
  return Math.floor((s + TRAVELLING.spacing - TRAVELLING.passBy) / TRAVELLING.spacing);
}

/** Abscisse du poste de travelling de rang `index` (rebouclée, ou bornée au parcours). */
export function travellingAt(rail: Rail, index: number): number {
  const at = index * TRAVELLING.spacing;
  if (rail.loop) return ((at % rail.length) + rail.length) % rail.length;
  return Math.min(rail.length, Math.max(0, at));
}

/**
 * Œil du conducteur du véhicule de la sortie, dans son repère (avant +X, haut +Y, droite +Z, en
 * mètres, caisse posée) : la place « conducteur » de son manifeste, résolue sur le siège du modèle
 * chargé par la scène (src/drive/scene/vehicule.tsx), comme au garage ; sur une moto, l'œil du motard
 * posé sur sa selle (vague U : « ce que voit le pilote », le réservoir en bas de l'image). `null` : poste
 * générique au-dessus du toit (véhicule sans place, modèle ou motard pas encore posé).
 */
export const cockpit: {
  eye: Vec3 | null;
  /** Pavillon au-dessus de l'œil de conduite (hauteur dans le repère du véhicule, m), mesuré par la scène ; NaN : inconnu. */
  ceiling: number;
  /** Œil et cadrage de conduite du manifeste (interiorView.conduite), ou `null` : ceux de COCKPIT (COCKPIT.bike pour une moto). */
  conduite: DriveEyeSpec | null;
  /** Format de l'image (largeur / hauteur), posé par la scène. */
  aspect: number;
  /** Hauteur du regard demandée par le joueur : part du débattement, de −1 à 1 (src/data/regard.ts). */
  regard: number;
} = { eye: null, ceiling: Number.NaN, conduite: null, aspect: 390 / 844, regard: 0 };

/**
 * Embarquée (vague U, demande du 18 novembre 2026, téléphone en paysage : « on voit pas assez la route,
 * il faudrait qu'on puisse prendre un peu plus de hauteur ») : réglages par défaut de l'œil de conduite,
 * que le manifeste précise place par place (interiorView.conduite). Avant, le regard visait un point de la
 * route à 28 m, presque à l'horizontale, avec le même champ vertical (74°) dans tous les formats : en
 * paysage, l'horizon tombait au milieu de l'image, la planche juste dessous, et le champ ouvrait 117° en
 * largeur (la route n'était qu'une bande mince). Maintenant le regard part de l'axe de la route et plonge
 * de l'angle qui met l'horizon à `horizon` de la hauteur de l'image ; champ et horizon dépendent du
 * format (portrait, paysage, mélangés entre les deux) ; l'œil monte et avance au-dessus de la planche.
 */
export const COCKPIT = {
  /** Champ vertical (degrés) : portrait, paysage (≈ 93° de large en 844 × 390). */
  fov: [74, 52] as readonly [number, number],
  /**
   * Horizon, part de la hauteur de l'image depuis le haut : portrait, paysage. En portrait, l'image est
   * haute : plus bas (47 %), l'habitacle n'y prend pas plus de place qu'avant.
   */
  horizon: [0.47, 0.42] as readonly [number, number],
  /** Formats (largeur / hauteur) : portrait jusqu'au premier, paysage dès le second ; mélange entre les deux. */
  formats: [0.8, 1.4] as readonly [number, number],
  /** Débattement de la hauteur du regard (m) : vers le bas, vers le haut. */
  regard: [0.05, 0.08] as readonly [number, number],
  /** Garde sous le pavillon mesuré au-dessus de l'œil (m) : l'œil le plus haut ne le traverse pas. */
  ceilingGap: 0.05,
  /** Distance du point visé (m) : court, la ligne de visée plonge sans passer sous la route (guardShot). */
  aim: 3,
  /** Passage d'un cran de regard à l'autre (s). */
  regardTau: 0.25,
  /**
   * Moto, à l'œil du motard (tête et buste cachés, src/drive/scene/vehicule.tsx), jamais plus de
   * `bikeAbove` m au-dessus du haut de la moto (le motard d'une sportive, couché, a l'œil bien au-dessus
   * de sa bulle : de là, la moto sortait de l'image) ; un peu en arrière, champ plus ouvert : le guidon,
   * les mains, le compteur ou le haut du carénage restent en bas de l'image. La hauteur du regard monte
   * l'œil au-dessus du réservoir ; pas de pavillon.
   */
  bike: { ahead: -0.15, regard: [0.08, 0.25], fov: [74, 62], horizon: [0.45, 0.4] } as DriveEyeSpec,
  bikeAbove: 0.15,
  /** Poste générique au-dessus du toit (ou du casque), en attendant l'œil : champ, horizon. */
  outside: { fov: [66, 52], horizon: [0.47, 0.42] } as DriveEyeSpec,
} as const;

/** Œil et cadrage de conduite : œil (repère du véhicule), plongée du regard (rad, négative vers le bas), champ vertical (degrés). */
export interface CockpitView {
  eye: [number, number, number];
  pitch: number;
  fov: number;
}

/** Part du paysage dans le cadrage (0 : portrait, 1 : paysage), selon le format largeur / hauteur ; fondu entre les deux. */
export function landscapeShare(aspect: number): number {
  const [a, b] = COCKPIT.formats;
  if (!(aspect > 0) || !Number.isFinite(aspect)) return 0;
  const t = Math.min(1, Math.max(0, Math.log(aspect / a) / Math.log(b / a)));
  return t * t * (3 - 2 * t);
}

/**
 * Œil et cadrage de conduite d'une place : depuis `eye` (œil de la place, repère du véhicule), relevé et
 * avancé du manifeste (`spec`), plus la hauteur du regard (`part`, de −1 à 1, sur le débattement), jamais
 * à moins de COCKPIT.ceilingGap du pavillon (`ceiling` : sa hauteur au-dessus de l'œil de conduite, NaN :
 * inconnue) ; champ et horizon selon le format `aspect`, d'où la plongée. Sans allocation : remplit `out`.
 */
export function cockpitView(eye: Readonly<Vec3>, spec: DriveEyeSpec | null | undefined, aspect: number, part: number, ceiling: number, out: CockpitView): CockpitView {
  const C = COCKPIT;
  framing(spec, aspect, out);
  let y = eye[1] + (spec?.lift ?? 0) + regardLift(spec, part);
  if (Number.isFinite(ceiling)) y = Math.min(y, Math.max(eye[1], ceiling - C.ceilingGap));
  out.eye[0] = eye[0] + (spec?.ahead ?? 0);
  out.eye[1] = y;
  out.eye[2] = eye[2];
  return out;
}

/** Champ (degrés) et plongée (rad) d'un cadrage `spec` au format `aspect` : l'horizon tombe à sa part de l'image. */
export function framing(spec: DriveEyeSpec | null | undefined, aspect: number, out: { fov: number; pitch: number }): void {
  const k = landscapeShare(aspect);
  const fovs = spec?.fov ?? COCKPIT.fov;
  const horizons = spec?.horizon ?? COCKPIT.horizon;
  out.fov = fovs[0] + (fovs[1] - fovs[0]) * k;
  const horizon = horizons[0] + (horizons[1] - horizons[0]) * k;
  out.pitch = -Math.atan((1 - 2 * horizon) * Math.tan((out.fov * Math.PI) / 360));
}

/** Relevé de la hauteur du regard (m) : `part` (−1 à 1) du débattement de `spec` (COCKPIT.regard par défaut). */
function regardLift(spec: DriveEyeSpec | null | undefined, part: number): number {
  const regard = spec?.regard ?? COCKPIT.regard;
  const p = Number.isFinite(part) ? Math.max(-1, Math.min(1, part)) : 0;
  return p >= 0 ? p * regard[1] : p * regard[0];
}

/** Mémoire de la hauteur du regard appliquée (une seule scène à la fois) : part et temps du dernier plan. */
export const regardNow = { time: Number.NaN, part: 0 };

/**
 * Hauteur du regard au temps `time` : rejoint `cockpit.regard` en COCKPIT.regardTau s (sans à-coup), d'un
 * coup au premier plan ou après un saut de temps ; un même temps (pause, plusieurs plans d'une image) ne
 * change rien. Aucune allocation.
 */
export function followRegard(time: number): number {
  const target = Number.isFinite(cockpit.regard) ? Math.max(-1, Math.min(1, cockpit.regard)) : 0;
  const dt = time - regardNow.time;
  if (!(dt >= 0) || dt > CHASE.gap) regardNow.part = target;
  else if (dt > 0) regardNow.part += (target - regardNow.part) * (1 - Math.exp(-dt / COCKPIT.regardTau));
  regardNow.time = time;
  return regardNow.part;
}

export function cameraShot(
  id: CameraId,
  frame: VehicleFrame,
  motion: DriveMotion,
  rail: Rail,
  time: number,
  orbit: OrbitView,
  out: CameraShot,
): CameraShot {
  const [px, py, pz] = frame.position;
  const fx = Math.cos(frame.heading);
  const fz = -Math.sin(frame.heading);
  // Gauche du véhicule : (−sin h, 0, −cos h).
  const lx = fz;
  const lz = -fx;
  const size = Math.max(frame.halfLength, frame.halfWidth * 2);
  const F = CAMERA_FEEL;
  const boost = Math.min(1, Math.max(0, motion.boost ?? 0));
  // NOS (src/data/nos.ts) : le champ s'ouvre d'un coup doux à l'envoi ; rien en moins de mouvement.
  const nosFov = cameraFeel.reducedMotion ? 0 : F.fovBoost * boost + liveNos.fov;
  const extraFov = speedFov(motion.speed) + nosFov;
  const pull = Number.isFinite(motion.pull) ? (motion.pull as number) : 0;
  // Tremblement : trois sinus de périodes premières entre elles, en mètres.
  const shake = shakeAmplitude(motion.speed) + liveNos.tremble;
  const shakeY = shake * (0.6 * Math.sin(time * 31.3) + 0.4 * Math.sin(time * 17.9));
  const shakeX = shake * 0.5 * Math.sin(time * 23.7);
  followChase(frame, motion, rail, time);
  out.roll = 0;
  // Pour la garde au sol (guardShot) : ce plan, et l'emprise du véhicule à ignorer sur la ligne de visée.
  guard.id = id;
  guard.time = time;
  guard.x = px;
  guard.z = pz;
  guard.reach = frame.halfLength + CAMERA_GUARD.body;

  switch (id) {
    case 'poursuite': {
      // Recul à l'accélération, rapprochement au freinage ; plus bas avec la vitesse et la poussée.
      const swing = Math.max(-F.pullFwdMax, Math.min(F.pullBackMax, pull * F.pullBack));
      const back = frame.halfLength * 2 + 4 + swing + liveNos.recul;
      const lower = F.speedLower * Math.min(1, motion.speed / F.fovFull) + Math.min(F.lowerMax, Math.max(0, pull) * F.lower);
      extendedPose(rail, motion.s - back, scratch);
      // En retard sur la place, puis sur le cap : le point tourne autour du véhicule de l'écart de cap.
      lateralPoint(scratch, motion.offset + chase.slide, frame.height + 1.1 - lower + shakeY, out.position);
      // Derrière la marche, pas derrière la caisse : en survirage, on voit la caisse se mettre en travers.
      turnAround(out.position, px, pz, marchYaw(motion) + chase.lag);
      out.position[0] += lx * shakeX;
      out.position[2] += lz * shakeX;
      set(out.target, px + fx * frame.halfLength * 0.6, py + frame.height * 0.75, pz + fz * frame.halfLength * 0.6);
      out.fov = 50 + extraFov;
      return out;
    }
    case 'rasante': {
      const side = frame.halfWidth + 0.45;
      const fore = frame.halfLength * 0.95;
      set(out.position, px + fx * fore + lx * side, py + 0.35 + shakeY * 0.6, pz + fz * fore + lz * side);
      set(out.target, px - fx * frame.halfLength * 1.2 + lx * frame.halfWidth * 0.2, py + frame.height * 0.35, pz - fz * frame.halfLength * 1.2 + lz * frame.halfWidth * 0.2);
      // En retard sur le cap : tout le plan tourne autour du véhicule, qui pivote dans le cadre.
      turnAround(out.position, px, pz, chase.lag);
      turnAround(out.target, px, pz, chase.lag);
      // Au ras du sol, le champ ne s'ouvre qu'au NOS : ouvert avec la vitesse, il ralentirait le défilement.
      out.fov = 62 + nosFov * 0.8;
      return out;
    }
    case 'avant': {
      const lead = frame.halfLength * 2 + 4.5;
      extendedPose(rail, motion.s + lead, scratch);
      lateralPoint(scratch, motion.offset, Math.max(1.1, frame.height * 0.9), out.position);
      set(out.target, px, py + frame.height * 0.5, pz);
      out.fov = 46 + extraFov * 0.5;
      return out;
    }
    case 'embarquee': {
      const bike = frame.kind === 'bike';
      const part = followRegard(time);
      // Œil de conduite : celui de la place (ou du motard), relevé, avancé et cadré selon le format (COCKPIT).
      const view = cockpit.eye ? cockpitView(cockpit.eye, bike ? (cockpit.conduite ?? COCKPIT.bike) : cockpit.conduite, cockpit.aspect, part, bike ? Number.NaN : cockpit.ceiling, sight) : null;
      const eye = view ? view.eye : null;
      // L'œil suit la caisse qui roule (la moto qui se couche) : rotation autour de l'axe avant, au sol.
      const roll = Number.isFinite(frame.roll) ? frame.roll : 0;
      const rc = Math.cos(roll);
      const rs = Math.sin(roll);
      // Hauteur de l'œil au-dessus de la route, au repos : d'elle part l'axe de la route (plus bas).
      let eyeHeight: number;
      if (eye) {
        // À la place du conducteur : l'œil suit la caisse en pente et en plongée (rotation autour du
        // côté, comme le groupe du véhicule), à droite du véhicule pour un +Z positif.
        const c = Math.cos(frame.pitch);
        const s = Math.sin(frame.pitch);
        const rolledUp = eye[1] * rc - eye[2] * rs;
        const right = eye[1] * rs + eye[2] * rc;
        const ahead = eye[0] * c - rolledUp * s;
        const up = eye[0] * s + rolledUp * c;
        set(out.position, px + fx * ahead - lx * right, py + up, pz + fz * ahead - lz * right);
        eyeHeight = eye[1];
      } else {
        const back = bike ? frame.halfLength * 0.9 : frame.halfLength * 0.15;
        // Moto : au-dessus du casque du motard (monté depuis), sinon il bouche la vue.
        const height = frame.height + (bike ? 0.3 + CHASE.bikeEyeLift + regardLift(COCKPIT.bike, part) : 0.32);
        set(out.position, px - fx * back - lx * height * rs, py + height * rc, pz - fz * back - lz * height * rs);
        framing(COCKPIT.outside, cockpit.aspect, sight);
        eyeHeight = height;
      }
      // L'image penche avec la caisse, d'une part bornée de son roulis (positif : vers la gauche).
      const R = CHASE;
      out.roll = Math.max(-R.rollMax, Math.min(R.rollMax, -roll * R.rollShare[frame.kind]));
      // Point loin devant, à hauteur d'œil au-dessus de la route : l'axe de la route. Plus près dans une
      // courbe serrée (dans un lacet, 28 m plus loin sur la route, c'est sur le côté ou derrière), et un
      // peu vers l'intérieur de la courbe qui vient.
      let bend = 0;
      for (let k = 0; k < 3; k += 1) {
        extendedPose(rail, motion.s + R.lookAt * (k / 2), scratch);
        bend = Math.max(bend, Math.abs(scratch.curvature));
      }
      extendedPose(rail, motion.s + R.lookAt / (1 + R.lookAt * bend * R.lookBend), scratch);
      const inside = Math.max(-R.insideMax, Math.min(R.insideMax, scratch.curvature * R.inside));
      lateralPoint(scratch, motion.offset + inside, eyeHeight, point);
      set(out.target, point[0], point[1], point[2]);
      // Là où pointe le véhicule : le point visé tourne autour de lui de son cap relatif.
      turnAround(out.target, px, pz, relativeYaw(motion));
      // À la place du conducteur d'une voiture, le regard ne s'écarte pas de l'axe du véhicule de plus de
      // CHASE.cockpitYawMax : la planche, donc la vitesse, reste dans l'image en virage.
      if (eye && !bike) {
        const vx = out.target[0] - out.position[0];
        const vz = out.target[2] - out.position[2];
        const ahead = vx * fx + vz * fz;
        const side = vx * lx + vz * lz;
        const angle = Math.atan2(side, ahead);
        if (Math.abs(angle) > R.cockpitYawMax) {
          const clamped = Math.sign(angle) * R.cockpitYawMax;
          const reach = Math.hypot(vx, vz);
          out.target[0] = out.position[0] + (Math.cos(clamped) * fx + Math.sin(clamped) * lx) * reach;
          out.target[2] = out.position[2] + (Math.cos(clamped) * fz + Math.sin(clamped) * lz) * reach;
        }
      }
      // Plongée : depuis l'axe de la route, le regard descend de l'angle qui met l'horizon à sa place dans
      // l'image (COCKPIT.horizon). Le point visé, à COCKPIT.aim m, reste au-dessus de la chaussée : la garde
      // de la ligne de visée (guardShot) ne relève pas la caméra hors de l'habitacle.
      const vx = out.target[0] - out.position[0];
      const vz = out.target[2] - out.position[2];
      const flat = Math.hypot(vx, vz) || 1;
      const angle = Math.atan2(out.target[1] - out.position[1], flat) + sight.pitch;
      const across = (Math.cos(angle) * COCKPIT.aim) / flat;
      out.target[0] = out.position[0] + vx * across;
      out.target[1] = out.position[1] + Math.sin(angle) * COCKPIT.aim;
      out.target[2] = out.position[2] + vz * across;
      // Le champ du format (COCKPIT) : le volant, la planche et la route.
      out.position[1] += shakeY * 0.5;
      out.fov = sight.fov + extraFov * 0.6;
      return out;
    }
    case 'travelling': {
      const index = travellingIndex(motion.s);
      extendedPose(rail, travellingAt(rail, index), station);
      // Côté droit pour les postes pairs, gauche pour les impairs ; dans un tunnel, contre la paroi.
      const right = index % 2 === 0;
      const edge = station.ground === 'tunnel' ? station.width / 2 - 0.4 : station.width / 2 + TRAVELLING.shoulder;
      lateralPoint(station, right ? -edge : edge, TRAVELLING.height, out.position);
      set(out.target, px, py + frame.height * 0.45, pz);
      const distance = Math.hypot(out.position[0] - px, out.position[1] - py, out.position[2] - pz);
      const fov = (2 * Math.atan(TRAVELLING.frame / 2 / Math.max(0.1, distance)) * 180) / Math.PI;
      out.fov = Math.min(TRAVELLING.fovMax, Math.max(TRAVELLING.fovMin, fov));
      return out;
    }
    case 'orbite': {
      // Bornes appliquées sans créer d'objet (appelé à chaque image).
      const yaw = orbitYaw(orbit.yaw);
      const pitch = orbitPitch(orbit.pitch);
      const distance = Math.max(orbitDistance(orbit.distance), size + 1.5);
      const flat = Math.cos(pitch) * distance;
      // Lacet 0 : derrière le véhicule ; positif : on tourne vers sa gauche.
      const bx = -Math.cos(yaw) * flat;
      const bz = Math.sin(yaw) * flat;
      const cy = py + frame.height * 0.5;
      set(out.position, px + fx * bx + lx * bz, Math.max(py + 0.3, cy + Math.sin(pitch) * distance), pz + fz * bx + lz * bz);
      set(out.target, px, cy, pz);
      out.fov = 45;
      return out;
    }
  }
}

/**
 * Sonde du terrain : hauteur du sol (chaussée, terrain, eau, ouvrages) et du bâti (toits) au point
 * (x, z), NaN là où rien n'est connu. Le sol est celui de qui se trouve à la hauteur `y` (sous un pont,
 * la route du dessous). Fournie par la scène (src/drive/scene/relief.ts).
 */
export interface GroundSampler {
  ground(x: number, z: number, y?: number): number;
  built(x: number, z: number): number;
}

/** Garde au sol des caméras : marges et limites, en mètres. */
export const CAMERA_GUARD = {
  /** Hauteur minimale de la caméra au-dessus du sol. */
  clearance: 0.28,
  /** Marge de la ligne de visée au-dessus du sol (talus entre la caméra et le véhicule). */
  sight: 0.2,
  /** Relevé maximal de la caméra pour voir par-dessus un talus ; au-delà, elle se rapproche. */
  lift: 3,
  /** Points sondés sur la ligne de visée. */
  steps: 12,
  /** Distance minimale au point visé quand la caméra se rapproche. */
  minDistance: 1.5,
  /**
   * Ligne de visée : points ignorés à moins de la demi-longueur du véhicule plus `body` m de son centre.
   * Sous la caisse, la sonde (le point le plus haut de chaque case de 2 m) prend la bordure, le mur ou
   * le talus voisin pour la chaussée ; et un obstacle si près du point visé demandait un relevé
   * multiplié par 1/k (k petit) : la caméra sautait de plusieurs mètres d'une image à l'autre.
   */
  body: 2,
  /**
   * Mémoire de la correction (relevé, rapprochement) d'une image à l'autre : temps de montée et de
   * descente (s, exponentielle du temps écoulé, donc indépendante de la cadence). Au-delà de `gap` s
   * entre deux plans, à un changement de caméra ou à une coupe (caméra déplacée de plus de `cut` m),
   * la correction est prise telle quelle. Ce qui garde la caméra hors du sol et des obstacles monte
   * tout de suite ; seul le relevé de la ligne de visée monte en `rise` s (le véhicule peut rester
   * caché une image ou deux derrière une bosse, jamais la caméra sous le sol).
   */
  rise: 0.08,
  fall: 0.45,
  gap: 0.1,
  cut: 10,
} as const;

/**
 * Mémoire de la garde (une seule scène à la fois, comme `chase`) : le plan du moment, posé par
 * `cameraShot` (caméra, temps, centre du véhicule et rayon ignoré sur la ligne de visée), et la
 * correction appliquée au dernier plan gardé (relevé en m, part du rapprochement vers le point visé).
 * Une garde appelée sans `cameraShot` avant elle (NaN) est instantanée et n'ignore rien.
 */
export const guard = {
  id: '' as CameraId | '',
  time: Number.NaN,
  x: Number.NaN,
  z: Number.NaN,
  reach: 0,
  lastId: '' as CameraId | '',
  lastTime: Number.NaN,
  lastX: Number.NaN,
  lastY: Number.NaN,
  lastZ: Number.NaN,
  floor: 0,
  lift: 0,
  approach: 0,
};

/** Relevé nécessaire au point (x, y, z) pour passer `margin` au-dessus du sol (et des toits si `built`). */
function blockedAt(sampler: GroundSampler, x: number, y: number, z: number, margin: number, built: boolean): number {
  const g = sampler.ground(x, z, y);
  let need = g === g ? g + margin - y : -Infinity;
  if (built) {
    const b = sampler.built(x, z);
    if (b === b && b + margin - y > need) need = b + margin - y;
  }
  return need;
}

/**
 * Garde au sol d'un plan : aucune caméra sous le terrain, dans un bâtiment ni derrière un talus qui
 * cache le véhicule. Dans l'ordre : la caméra se relève au-dessus du sol au point où elle est ; si
 * le sol ou un toit coupe la ligne de visée (hors de l'emprise du véhicule, `CAMERA_GUARD.body`), elle
 * se relève (de `CAMERA_GUARD.lift` au plus) ; si cela ne suffit pas, elle avance vers le point visé
 * jusqu'au dernier point libre (recul limité) ; enfin elle se relève de nouveau au-dessus du sol (et du
 * toit si elle a avancé). Relevé et rapprochement de la ligne de visée passent d'une image à l'autre
 * par la mémoire `guard` (montée en `rise` s, descente en `fall` s) : un obstacle que les points
 * sondés attrapent une image sur deux ne fait plus sauter la caméra (lot « tremblote », 17 novembre
 * 2026 : jusqu'à 180 pixels d'écart d'une image à l'autre en ville). Une sonde muette (NaN partout)
 * laisse le plan tel quel. Sans allocation : modifie `shot` et le rend.
 */
export function guardShot(shot: CameraShot, sampler: GroundSampler): CameraShot {
  const p = shot.position;
  const t = shot.target;
  const G = CAMERA_GUARD;
  const M = guard;
  // Mémoire : même caméra, images rapprochées, pas de coupe (position brute à moins de `cut` m).
  const dt = M.time - M.lastTime;
  const moved = (p[0] - M.lastX) ** 2 + (p[1] - M.lastY) ** 2 + (p[2] - M.lastZ) ** 2;
  // Mémoire et emprise ignorée pour les caméras qui suivent le véhicule du dehors (poursuite, rasante,
  // avant). Embarquée, travelling et orbite : la garde d'avant, instantanée et complète (l'œil de
  // l'embarquée peut encore sortir de l'habitacle : TODO_ASSETS.md, paragraphe « tremblote »).
  const attached = M.id === 'poursuite' || M.id === 'rasante' || M.id === 'avant';
  const memory = attached && M.id === M.lastId && dt >= 0 && dt <= G.gap && moved <= G.cut * G.cut;
  M.lastId = M.id;
  M.lastTime = M.time;
  M.lastX = p[0];
  M.lastY = p[1];
  M.lastZ = p[2];
  const fall = memory && dt > 0 ? Math.exp(-dt / G.fall) : memory ? 1 : 0;
  // 1. Au-dessus du sol au point de la caméra (une caméra dans un bâtiment est traitée en 2 et 3) :
  // relevée tout de suite, redescendue en douceur (une bordure prise une case sur deux ne la fait pas sauter).
  let need = blockedAt(sampler, p[0], p[1], p[2], G.clearance, false);
  M.floor = Math.max(need > 0 ? need : 0, M.floor * fall);
  p[1] += M.floor;
  // 2. Ligne de visée : relevé nécessaire pour passer chaque point sondé hors de l'emprise du véhicule.
  const reach2 = attached && M.x === M.x && M.z === M.z ? M.reach * M.reach : -1;
  let lift = 0;
  let first = 0;
  for (let i = G.steps; i >= 1; i -= 1) {
    const k = i / G.steps;
    const x = t[0] + (p[0] - t[0]) * k;
    const z = t[2] + (p[2] - t[2]) * k;
    if ((x - M.x) ** 2 + (z - M.z) ** 2 < reach2) continue;
    const n = blockedAt(sampler, x, t[1] + (p[1] - t[1]) * k, z, G.sight, true);
    if (n > 0) {
      lift = Math.max(lift, n / k);
      first = i;
    }
  }
  // 3. Trop haut : la caméra se rapproche du point visé, juste avant le premier obstacle (sans relevé).
  let wantLift = lift;
  let wantApproach = 0;
  if (lift > G.lift) {
    const length = Math.hypot(p[0] - t[0], p[1] - t[1], p[2] - t[2]);
    wantApproach = 1 - Math.max((first - 1) / G.steps, Math.min(1, G.minDistance / Math.max(1e-6, length)));
    wantLift = 0;
  }
  // Relevé : monté en `rise` s, redescendu en `fall` s. Rapprochement : tout de suite (jamais dans
  // l'obstacle), puis rendu en `fall` s le long d'une ligne de visée redevenue libre.
  if (memory) {
    if (dt > 0) M.lift += (wantLift - M.lift) * (1 - Math.exp(-dt / (wantLift > M.lift ? G.rise : G.fall)));
    M.approach = Math.max(wantApproach, M.approach * fall);
  } else {
    M.lift = wantLift;
    M.approach = wantApproach;
  }
  if (M.lift < 1e-4 && M.approach < 1e-4) return shot;
  p[1] += M.lift;
  const keep = 1 - M.approach;
  p[0] = t[0] + (p[0] - t[0]) * keep;
  p[1] = t[1] + (p[1] - t[1]) * keep;
  p[2] = t[2] + (p[2] - t[2]) * keep;
  // Toujours au-dessus du sol ; et du toit après un rapprochement (toit débordant sur la chaussée dans les données).
  need = blockedAt(sampler, p[0], p[1], p[2], G.clearance, wantApproach > 0);
  if (need > 0) p[1] += need;
  return shot;
}

/** Plan neuf, à allouer une fois. */
export function createShot(): CameraShot {
  return { position: [0, 0, 0], target: [0, 0, 0], fov: 50, roll: 0 };
}
