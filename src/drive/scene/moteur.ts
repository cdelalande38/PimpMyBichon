// Moteur de la scène de sortie : tout ce qui vit d'image en image, hors de React (aucune allocation
// par image). La scène React (Scene.tsx) le crée pour une route et un niveau de qualité, l'accroche
// à la scène three, et l'appelle à chaque image. Il tient la boucle du contrat
// (src/drive/contrat.ts) : le pilote avance, le rail donne la pose, la caméra prend son plan (gardé
// au-dessus du terrain par la sonde du décor), le décor suit, la brume au sol se cale sur le plan
// d'eau ou le creux le plus proche, la télémétrie part quatre fois par seconde au plus.

import {
  Box3,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Matrix4,
  Object3D,
  PointLight,
  Vector3,
  type BufferGeometry,
  type DataTexture,
  type InstancedMesh,
  type MeshStandardMaterial,
  type Points,
  type ShaderMaterial,
  type Fog,
  type PerspectiveCamera,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { feuxSon } from '../../audio/sfx/feux.ts';
import { meteoSon } from '../../audio/sfx/meteo.ts';
import { resolveStart } from '../../data/maps.ts';
import { MATIERES_DU_JOUR, type MatiereDuJour } from '../../data/moments.ts';
import type { MapRoute } from '../../data/mapTypes.ts';
import type { VehicleManifest } from '../../data/vehicleTypes.ts';
import type { SurfaceUniforms } from '../../render/floor.ts';
import { ATMOSPHERE_LAYER, CAMERA_LAYERS, PROBE_ONLY_LAYER } from '../../render/layers.ts';
import { PlanarReflection } from '../../render/planarReflection.ts';
import type { QualityLevel } from '../../render/quality.ts';
import { useBuilds } from '../../state/builds.ts';
import { etapeFondu, liveDepart, livePilot, useDrive } from '../../state/drive.ts';
import { cameraShot, guardShot } from '../cameras.ts';
import type { CameraId, CameraShot, Director, DriveTelemetry, Pilot, Rail, RailPose, VehicleFrame } from '../contrat.ts';
import { armerDepart, cleTemps, createDepart, enCourse, lancerDepart, pasDepart, tenuSurLaLigne } from '../depart.ts';
import { courseFinie, SuiviCourse } from '../course.ts';
import { formatCouru, toursDuFormat } from '../../data/courses.ts';
import { createPilot, performanceDe } from '../pilote.ts';
import { createPose, createRail } from '../rail.ts';
import { createDirector } from '../realisateur.ts';
import { localWeather, nearestSpan, shelteredAt, type WeatherAmounts } from './abri.ts';
import { createFarLights, createProbeBand, createRain, createSky, createTownGlow, SKY } from './ciel.ts';
import { driveDebug, type DriveMeasure } from './debug.ts';
import { Decor, DecorKit, LAMP_HEAD } from './decor.ts';
import { Chevrons } from './chevrons.ts';
import { LignesDepart } from './lignes.ts';
import { createSignAtlas, createSignMaterial } from './enseignes.ts';
import type { Relief } from './relief.ts';
import { createNightUniforms, createRoleMaterials, LAMP_FADE, MAX_LAMPS, MAX_NEONS, REAL_LAMPS, type NightUniforms } from './materiaux.ts';
import { MomentMelange } from './moment.ts';
import { DRIVE_PROFILES, due, fogDensity, lampWeights, nearestLamps, stepOf, type DriveProfile } from './profil.ts';
import { MovingProbe } from './sonde.ts';
import { cleanProbePass } from '../../render/probePass.ts';
import { roueEnPlus, rouesMotrices, wheelSteer } from './roues.ts';
import { createRig, rollWheels, TAIL_LIGHT, type DriveModel, type DriveRig } from './vehicule.tsx';

/** Intensité des vraies lumières des lampadaires, en candelas : même éclairement que la flaque calculée (PMB_LAMP_DIFFUSE de la chaussée × 64 × π). */
const LAMP_CANDELA = 380;

/** Feux arrière : intensité au repos et au freinage, en candelas (lueur rouge sur la chaussée ; src/drive/scene/vehicule.tsx). */
const TAIL_CANDELA = TAIL_LIGHT.candela;

/** NOS : lueur bleue à l'échappement (le feu arrière vire au bleu), en candelas au plus fort. */
const NOS_GLOW = { candela: TAIL_LIGHT.candela.nos, color: new Color('#3b7bff') } as const;

/**
 * Météo du ciel, par temps : part mouillée de la chaussée, pluie, neige (la neige laisse la chaussée
 * sombre et humide, à reflets très doux). Elle passe de l'une à l'autre en deux secondes environ.
 */
const WEATHER_GOALS: Readonly<Record<string, WeatherAmounts>> = {
  sec: { wet: 0, rain: 0, snow: 0 },
  pluie: { wet: 1, rain: 1, snow: 0 },
  neige: { wet: 0.55, rain: 0, snow: 1 },
};

/**
 * Garde de cadence de la météo : en roulant, sous `fps` images par seconde pendant `seconds` s, la
 * météo baisse d'un cran (gouttes éclaircies, reflet planaire plus rare puis coupé), en fondu.
 */
const WEATHER_GUARD = { fps: 30, seconds: 3, minSpeed: 3 } as const;
const WEATHER_STEPS = ['completes', 'allegees', 'minimales'] as const;

/** Plan proche de la caméra : 0,3 m (deux fois plus de précision de profondeur au loin) ; embarquée : 0,12 m. */
const NEAR = { default: 0.3, cockpit: 0.12 } as const;

/** Force de la bande d'horizon vue par la sonde (reflet clair qui dessine la caisse) : celle de la nuit (src/data/moments.ts). */
const PROBE_BAND_GAIN = 0.5;

/** Passage d'un moment à l'autre (nuit, jour) : part franchie par seconde. */
const MOMENT_RATE = 1.5;

/** Ombre portée du véhicule : hauteur (part de celle du véhicule) d'où l'astre la projette au sol, et décalage au plus (m). */
const CAST_SHADOW = { height: 0.7, reach: 2, lift: 0.6 } as const;

/**
 * Brume au sol : sa base se cale sur le plan d'eau chargé le plus proche s'il est à moins de
 * `waterReach` m sous la route, sinon `hollow` m sous la route (les creux) ; elle y glisse en
 * quelques secondes.
 */
const MIST_BASE = { waterReach: 30, hollow: 6, rate: 0.6 } as const;

/**
 * Mesures du véhicule pour les caméras, roues comprises : des roues larges qui débordent de la caisse
 * ne doivent pas avaler la caméra rasante.
 */
function withWheels(model: DriveModel, rig: DriveRig): { halfLength: number; halfWidth: number; height: number } {
  const m = { ...model.measure };
  rig.body.updateWorldMatrix(true, false);
  const inverse = new Matrix4().copy(rig.body.matrixWorld).invert();
  const box = new Box3();
  for (const w of model.wheels) {
    w.node.updateWorldMatrix(true, true);
    box.setFromObject(w.node, true).applyMatrix4(inverse);
    if (box.isEmpty()) continue;
    m.halfWidth = Math.max(m.halfWidth, Math.abs(box.min.z), Math.abs(box.max.z));
    m.halfLength = Math.max(m.halfLength, Math.abs(box.min.x), Math.abs(box.max.x));
  }
  return m;
}

/** Têtes de tous les lampadaires de la carte (3 nombres chacune), d'après route.json. */
function routeLampHeads(route: MapRoute): Float32Array {
  const out: number[] = [];
  for (const chunk of route.chunks) {
    const l = chunk.instances.lampadaire ?? [];
    for (let o = 0; o + 4 < l.length; o += 5) {
      const scale = l[o + 3] ?? 1;
      const cap = l[o + 4] ?? 0;
      out.push(
        chunk.origin[0] + (l[o] ?? 0) + Math.sin(cap) * LAMP_HEAD.reach * scale,
        chunk.origin[1] + (l[o + 1] ?? 0) + LAMP_HEAD.height * scale,
        chunk.origin[2] + (l[o + 2] ?? 0) + Math.cos(cap) * LAMP_HEAD.reach * scale,
      );
    }
  }
  return new Float32Array(out);
}

/** Points au sol des agglomérations de la carte, tous les 700 m (lueur des villages au loin). */
function townCenters(route: MapRoute, rail: Rail): Float32Array {
  const out: number[] = [];
  let from = -1;
  let to = -1;
  const flush = () => {
    if (from < 0) return;
    const n = Math.max(1, Math.round((to - from) / 700));
    for (let k = 0; k < n; k += 1) {
      const p = rail.poseAt(from + ((k + 0.5) * (to - from)) / n, createPose()).position;
      out.push(p[0], p[1], p[2]);
    }
    from = -1;
  };
  for (const section of route.sections) {
    if (section.urban) {
      if (from < 0) from = section.from;
      to = section.to;
    } else flush();
  }
  flush();
  return new Float32Array(out);
}

/** Pose un attribut `data-*` sans toucher au DOM si rien ne change. */
function putData(element: HTMLElement | null, key: string, value: string): void {
  if (element && element.dataset[key] !== value) element.dataset[key] = value;
}

export class DriveEngine {
  readonly profile: DriveProfile;
  readonly uniforms: NightUniforms;
  readonly rig: DriveRig;
  readonly rail: Rail;
  readonly pilot: Pilot;
  private readonly director: Director;
  /** Départ arrêté, chrono, tours et arrivée (src/drive/depart.ts) ; lignes en damier sur la chaussée. */
  readonly depart = createDepart();
  /** Mesures de la course en cours (src/drive/course.ts). */
  private readonly suivi = new SuiviCourse();
  private readonly lignes: LignesDepart;
  /** Balises à chevrons des virages (src/drive/scene/chevrons.ts) ; publie les virages pour la mini-carte. */
  private readonly chevrons: Chevrons;
  private startId = '';
  /** Départs à la main déjà pris en compte (src/state/drive.ts, `course`). */
  private course = useDrive.getState().course;
  private readonly vehicleId: string;
  private readonly halfLengthHint: number;
  private readonly roles: ReturnType<typeof createRoleMaterials>;
  private readonly kit: DecorKit;
  private readonly decor: Decor;
  private readonly sky = createSky();
  private readonly rain;
  private readonly probe: MovingProbe;
  private readonly reflection: PlanarReflection | null;
  private readonly floor = new Object3D();
  private readonly lampLights: PointLight[] = [];
  private readonly farLights: Points<BufferGeometry, ShaderMaterial>;
  private readonly townGlow: InstancedMesh | null;
  private readonly signAtlas: DataTexture | null;
  private readonly signMaterial: ShaderMaterial | null;
  private readonly viewProj = new Matrix4();
  private readonly lastCamera = new Vector3();
  private lastCameraId: CameraId | null = null;
  private mistBase = Number.NaN;
  /** Couleur d'origine du feu arrière, gardée à la première poussée du NOS. */
  private tailColor: Color | null = null;
  /** Mouvement réduit (réglage du système) : pas de traînées lumineuses (§ 5.5). */
  private readonly reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** Bande d'horizon de la sonde (src/drive/scene/ciel.ts, createProbeBand). */
  private readonly band = createProbeBand({ value: PROBE_BAND_GAIN });
  private readonly kind: VehicleManifest['kind'];
  /** Moment (nuit, jour) mêlé à la météo du ciel (src/drive/scene/moment.ts), et ce qu'il règle. */
  private readonly moment: MomentMelange;
  private readonly momentMaterials: Array<[MatiereDuJour, MeshStandardMaterial]> = [];
  /** Passage de la nuit (0) au jour (1) ; -1 avant la première image (posé d'un coup). */
  private day = -1;
  private readonly sun = new DirectionalLight();
  private readonly hemi = new HemisphereLight();
  private fog: FogExp2 | null = null;
  private fogBase = 0;
  private readonly level: QualityLevel;
  private readonly route: MapRoute;
  private attached: { scene: Scene; fog: Fog | FogExp2 | null; environment: Texture | null } | null = null;
  private vehicleReady = false;
  private vehicleFailed = false;
  private reportedFailure = false;
  // Objets de travail de la boucle.
  private readonly pose: RailPose = { s: 0, position: [0, 0, 0], tangent: [1, 0, 0], heading: 0, pitch: 0, curvature: 0, ground: 'sol', urban: false, lanes: 2, width: 7 };
  private readonly frameOf: VehicleFrame;
  private readonly shot: CameraShot = { position: [0, 2, -6], target: [0, 0.5, 0], fov: 55, roll: 0 };
  private readonly probeAt = new Vector3();
  /** Pas de la sonde (une face, ou toutes à l'amorçage), réglé à chaque image ; fonction créée une fois. */
  private readonly probeJob = { gl: null as WebGLRenderer | null, scene: null as Scene | null, every: 1, all: false };
  private readonly probeStep = (): void => {
    const job = this.probeJob;
    if (job.gl && job.scene) this.probe.step(job.gl, job.scene, this.probeAt, this.hidden, job.every, job.all);
  };
  private readonly hidden: Object3D[];
  private readonly order = new Int32Array(MAX_LAMPS + 1);
  private readonly dist = new Float32Array(MAX_LAMPS + 1);
  private readonly nearWork = new Float32Array((MAX_LAMPS + 1) * 3);
  private readonly realShare = new Float32Array(REAL_LAMPS);
  private readonly neonShare = new Float32Array(2);
  private readonly neonW2 = new Float32Array((MAX_NEONS + 1) * 2);
  private time = 0;
  private wet = -1;
  /** Météo du ciel (montée en douceur) et météo locale au véhicule (nulle sous un tunnel). */
  private readonly sky0: WeatherAmounts = { wet: 0, rain: 0, snow: 0 };
  private readonly here: WeatherAmounts = { wet: 0, rain: 0, snow: 0 };
  /** Cran de la garde de météo (0 : effets complets), sa durée sous le plancher, et le fondu en cours. */
  private weatherStep = 0;
  private guardFrames = 0;
  private guardTime = 0;
  private density = 1;
  private reflectFade = 1;
  /** Vitesse rapportée à 130 km/h (0 à 1) : vignettage et traînées. */
  speedFactor = 0;
  private lastPub = -Infinity;
  private frames = 0;
  private primed = false;
  /** Cadence mesurée au début de la sortie : sous le plancher, la scène s'allège d'elle-même. */
  private slowFrames = 0;
  private readonly slowDeltas = new Float32Array(60);
  private degraded = false;
  private onDegrade: (() => void) | null = null;

  constructor(base: string, route: MapRoute, level: QualityLevel, vehicle: VehicleManifest) {
    this.route = route;
    this.level = level;
    this.kind = vehicle.kind;
    this.profile = DRIVE_PROFILES[level];
    this.uniforms = createNightUniforms();
    this.roles = createRoleMaterials(this.uniforms);
    this.kit = new DecorKit(this.uniforms, this.profile.fogFar);
    this.decor = new Decor(base, route, this.roles, this.kit, this.profile);
    this.rain = createRain(this.profile.rainDrops, this.uniforms);
    // La pluie ne va ni dans la sonde ni dans le reflet : calque de l'atmosphère.
    this.rain.layers.set(ATMOSPHERE_LAYER);
    this.probe = new MovingProbe(this.profile.probeSize, 2500);
    this.reflection = this.profile.reflection > 0 ? new PlanarReflection(this.profile.reflection, this.uniforms as unknown as SurfaceUniforms) : null;
    // Deux vraies lumières aux têtes des lampadaires les plus proches (le reste est calculé au sol).
    for (let i = 0; i < REAL_LAMPS; i += 1) this.lampLights.push(new PointLight(this.uniforms.pmbLampColor.value, 0, 40, 2));
    this.rig = createRig();
    this.hidden = [this.rig.group];
    this.frameOf = { kind: vehicle.kind, position: [0, 0, 0], heading: 0, pitch: 0, roll: 0, halfLength: vehicle.halfLengthHint, halfWidth: 0.9, height: 1.4 };
    this.rail = createRail(route);
    // Performances du véhicule (manifeste, préparation du build) ; le pilote est publié pour le
    // compte-tours et le son (src/state/drive.ts, livePilot).
    this.pilot = createPilot(this.rail, performanceDe(vehicle, useBuilds.getState().builds[vehicle.id]));
    livePilot.current = this.pilot;
    this.director = createDirector();
    this.vehicleId = vehicle.id;
    this.halfLengthHint = vehicle.halfLengthHint;
    this.lignes = new LignesDepart(this.uniforms);
    this.chevrons = new Chevrons(this.uniforms, this.rail);
    liveDepart.current = this.depart;
    // Lumières lointaines : les lampadaires de toute la carte, la lueur des villages.
    this.farLights = createFarLights(routeLampHeads(route), this.uniforms.pmbLampColor.value);
    this.townGlow = createTownGlow(townCenters(route, this.rail), new Color('#ff8a3a'));
    // Enseignes au néon (atlas dessiné par le navigateur ; sans document, pas d'enseigne).
    this.signAtlas = typeof document === 'undefined' ? null : createSignAtlas();
    this.signMaterial = this.signAtlas ? createSignMaterial(this.signAtlas, this.uniforms.pmbTime, this.profile.fogFar) : null;
    if (this.signMaterial) this.decor.signs = { material: this.signMaterial, rail: this.rail };
    // Matières dont la teinte suit le moment : rôles des tronçons, arbres, relief lointain.
    const nuit = {} as Record<MatiereDuJour, Color>;
    for (const m of MATIERES_DU_JOUR) {
      const material = m === 'arbre' ? this.kit.treeMaterial : m === 'lointain' ? this.kit.farMaterial : this.roles.get(m);
      if (!material) continue;
      this.momentMaterials.push([m, material]);
      nuit[m] = material.color.clone();
    }
    this.moment = new MomentMelange(nuit);
    this.sun.name = 'sortie_astre';
    this.hemi.name = 'sortie_ambiance';
    this.applyMoment(0, 0, 0);
  }

  /** Accroche le décor, le ciel, la brume et la sonde à la scène ; règle la caméra. */
  attach(scene: Scene, camera: PerspectiveCamera): void {
    this.attached = { scene, fog: scene.fog, environment: scene.environment };
    this.band.layers.set(PROBE_ONLY_LAYER);
    scene.add(this.hemi, this.sun, this.decor.root, this.sky, this.rain, this.farLights, this.band, this.lignes.group, this.chevrons.group, ...this.lampLights);
    if (this.townGlow) scene.add(this.townGlow);
    this.fogBase = fogDensity(this.profile.fogFar);
    this.fog = new FogExp2(new Color(SKY.fog), this.fogBase);
    scene.fog = this.fog;
    this.applyMoment(Math.max(0, this.day), this.sky0.rain, this.sky0.snow);
    scene.environment = this.probe.target.texture;
    camera.near = NEAR.default;
    camera.far = 24000;
    for (const layer of CAMERA_LAYERS) camera.layers.enable(layer);
    camera.updateProjectionMatrix();
    this.decor.loadFar().catch(() => undefined);
  }

  detach(): void {
    const a = this.attached;
    if (!a) return;
    a.scene.remove(this.hemi, this.sun, this.decor.root, this.sky, this.rain, this.farLights, this.band, this.lignes.group, this.chevrons.group, ...this.lampLights);
    if (this.townGlow) a.scene.remove(this.townGlow);
    a.scene.fog = a.fog;
    a.scene.environment = a.environment;
    this.attached = null;
  }

  /** Départ choisi (MapStart.id), sinon le premier : départ arrêté sur la ligne, feux dès que la route est prête. */
  start(id: string | null): void {
    const start = resolveStart(this.route, id);
    this.startId = start.id;
    this.pilot.reset(start.at);
    this.director.reset();
    // Aperçu (src/state/drive.ts) : départ lancé, sans feux ; la course, elle, part arrêtée aux feux.
    // Course (src/data/courses.ts) : les tours du format choisi ; la balade et l'aperçu n'en ont pas.
    const drive = useDrive.getState();
    armerDepart(this.depart, this.pilot.motion.s, this.rail.loop, drive.apercu, toursDuFormat(formatCouru(drive.format, this.rail.loop)));
    this.suivi.remettre();
    this.pilot.setHold?.(true);
    this.lignes.poser(this.rail, this.pilot.motion.s, this.rig.measure?.halfLength ?? this.halfLengthHint);
    useDrive.getState().effacerArrivee();
  }

  /** Début du fondu au noir de fin d'aperçu (performance.now, ms), -1 hors fondu. */
  private fonduDepuis = -1;

  /**
   * Aperçu au bout d'un parcours ouvert : fondu au noir (0,4 s, levé dans le store, dessiné par l'écran, qui confirme le noir), puis le
   * véhicule repart du départ pendant que l'écran revient (0,4 s). Coupe franche sans mouvement.
   */
  private reprendreApercu(drive: ReturnType<typeof useDrive.getState>): void {
    const etape = etapeFondu(this.fonduDepuis, performance.now(), this.reducedMotion, drive.fondu === 'noir');
    if (etape === 'lever') {
      this.fonduDepuis = performance.now();
      drive.setFondu('sortie');
    } else if (etape === 'reprendre') {
      this.fonduDepuis = -1;
      this.start(this.startId);
      drive.setFondu('non');
    }
  }

  /** Repart un peu avant `s` et roule jusqu'à elle (le pilote y arrive lancé ; départ lancé, sans les feux). */
  seek(s: number): void {
    lancerDepart(this.depart, Math.max(0, s - 90), this.rail.loop);
    this.pilot.setHold?.(false);
    this.pilot.reset(Math.max(0, s - 90));
    this.pilot.setWeather?.(useDrive.getState().weather);
    const input = useDrive.getState().input;
    for (let i = 0; i < 400 && this.pilot.motion.s < s; i += 1) this.pilot.step(0.1, input, this.kind);
  }

  /** Le modèle posé (ou retiré) : roues, feux, mesures. */
  setModel(model: DriveModel | null): void {
    const rig = this.rig;
    this.vehicleReady = model !== null;
    rig.wheels = model?.wheels ?? [];
    rig.steering = model?.steering ?? [];
    rig.distance = 0;
    rig.spun = 0;
    rouesMotrices(rig.wheels, this.pilot.transmission);
    rig.measure = model?.measure ?? null;
    rig.tails = model?.tails ?? [];
    rig.tailBase = model?.tails[0]?.emissiveIntensity ?? 10;
    rig.tailLight = model?.tailLight ?? null;
    rig.cast = model?.cast ?? null;
    if (model) {
      rig.headLocal.copy(model.head);
      rig.headSpread = model.headSpread;
      // Couleur de la lumière des phares sur la route (Custom › Phares).
      this.uniforms.pmbHeadColor.value.copy(model.headColor);
      rig.measure = withWheels(model, rig);
      this.pilot.setSize?.(rig.measure.halfWidth, rig.measure.halfLength);
    }
  }

  vehicleFailedNow(): void {
    this.vehicleFailed = true;
  }

  settled(): boolean {
    return this.decor.status.complete && this.vehicleReady && this.primed;
  }

  /** Une image : pilote, pose, caméra, décor, air, sonde, reflet, télémétrie. */
  frame(gl: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, delta: number, elapsed: number, stage: HTMLElement | null): void {
    const { rig, uniforms, decor, profile } = this;
    const drive = useDrive.getState();
    const dt = stepOf(delta, drive.paused, drive.slow);
    this.time += dt;
    // « Commencer » ou « Repartir » : retour sur la ligne du départ, feux ; l'aperçu au bout d'un
    // parcours ouvert reprend du départ.
    if (drive.course !== this.course) {
      this.course = drive.course;
      this.start(this.startId);
    } else if (drive.apercu && this.pilot.motion.finished) this.reprendreApercu(drive);
    else if (this.fonduDepuis >= 0) {
      this.fonduDepuis = -1;
      drive.setFondu('non');
    }
    // Départ arrêté : tenu sur la ligne tant que les feux ne sont pas au vert.
    const depart = this.depart;
    this.pilot.setHold?.(tenuSurLaLigne(depart));
    // Adhérence de la météo choisie (src/data/adherence.ts).
    this.pilot.setWeather?.(drive.weather);
    const motion = this.pilot.step(dt, drive.input, this.kind);
    const arrived = depart.phase === 'arrive';
    this.suivi.pas(depart, dt, drive.input, motion, (this.pilot as { contact?: number }).contact ?? 0, this.pilot.train?.nos === true);
    pasDepart(depart, dt, this.vehicleReady && !this.vehicleFailed && decor.status.loaded > 0 && this.frames > 2, motion.s, this.rail, motion.finished);
    if (!arrived && depart.phase === 'arrive' && drive.map && !depart.lance) {
      const format = formatCouru(drive.format, this.rail.loop);
      const finie = enCourse(depart) ? courseFinie(depart, this.suivi.mesures, { carte: drive.map, depart: this.startId, vehicule: this.vehicleId, format, meteo: drive.weather, moment: 'nuit' }) : null;
      if (finie) drive.terminerCourse(finie);
      else drive.noterArrivee(cleTemps(drive.map, this.startId, this.vehicleId), depart.arrivee);
    }
    feuxSon.rouges = depart.rouges;
    feuxSon.vert = depart.vert;
    // Le pilote publié est celui qui roule (en mode strict de React, une scène écartée a pu le publier).
    livePilot.current = this.pilot;
    liveDepart.current = depart;
    const pose = this.rail.poseAt(motion.s, this.pose);

    // Véhicule sur le rail : écart latéral vers la gauche de la marche, cap, pente, roulis, plongée.
    const tx = pose.tangent[0];
    const tz = pose.tangent[2];
    const hl = Math.hypot(tx, tz) || 1;
    const px = pose.position[0] + (tz / hl) * motion.offset;
    const py = pose.position[1];
    const pz = pose.position[2] - (tx / hl) * motion.offset;
    rig.group.position.set(px, py, pz);
    // Cap : celui de la route, plus celui que donne un changement de place (le véhicule pivote).
    const heading = pose.heading + (motion.yaw ?? 0);
    rig.group.rotation.set(0, heading, pose.pitch);
    // Roulis (contrat) : rotation autour de l'avant +X, positive toit vers la droite (+Z) ; plongée
    // autour de l'axe latéral, de même sens que la pente (négative au freinage).
    rig.body.rotation.set(motion.roll, 0, motion.dive);
    // Roues avant braquées du braquage du pilote, amplifié pour l'image (roues.ts).
    const steer = wheelSteer(motion.steer ?? 0, motion.speed, this.kind);
    // Les roues motrices qui patinent tournent plus vite que la route (roues.ts).
    rollWheels(rig, motion.speed * dt, steer, roueEnPlus(motion.spin ?? 0) * dt);
    const brake = motion.braking ? 3.2 : 1;
    for (let i = 0; i < rig.tails.length; i += 1) (rig.tails[i] as { emissiveIntensity: number }).emissiveIntensity = rig.tailBase * brake;
    if (rig.tailLight) {
      const boost = motion.boost ?? 0;
      if (boost > 0.01 && !this.tailColor) this.tailColor = rig.tailLight.color.clone();
      if (this.tailColor) rig.tailLight.color.copy(this.tailColor).lerp(NOS_GLOW.color, boost);
      // Lueur rouge sur la chaussée : la nuit seulement (comme les phares) ; les feux eux-mêmes restent allumés de jour.
      rig.tailLight.intensity = ((motion.braking ? TAIL_CANDELA.brake : TAIL_CANDELA.rest) + boost * NOS_GLOW.candela) * this.moment.etat.phares;
    }
    rig.group.updateMatrixWorld();

    // Plan de la caméra.
    const frame = this.frameOf;
    frame.position[0] = px;
    frame.position[1] = py;
    frame.position[2] = pz;
    frame.heading = heading;
    frame.pitch = pose.pitch + motion.dive;
    frame.roll = motion.roll;
    if (rig.measure) {
      frame.halfLength = rig.measure.halfLength;
      frame.halfWidth = rig.measure.halfWidth;
      frame.height = rig.measure.height;
    }
    const cameraId = drive.director ? this.director.pick(this.time, motion, pose) : drive.camera;
    const shot = cameraShot(cameraId, frame, motion, this.rail, this.time, drive.orbit, this.shot);
    // Garde au sol : jamais sous le terrain, dans un bâtiment ni derrière un talus (hors tunnel, où
    // le relief au-dessus de la voûte fausserait la sonde).
    if (pose.ground !== 'tunnel') guardShot(shot, decor.relief);
    camera.position.set(shot.position[0], shot.position[1], shot.position[2]);
    camera.lookAt(shot.target[0], shot.target[1], shot.target[2]);
    if (shot.roll) camera.rotateZ(shot.roll);
    if (camera.fov !== shot.fov) {
      camera.fov = shot.fov;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
    // Traînées des halos : déplacement à l'écran depuis l'image précédente, nul à une coupe.
    const halo = this.kit.haloMaterial.uniforms;
    const cut = cameraId !== this.lastCameraId || this.lastCamera.distanceToSquared(camera.position) > 36;
    (halo.uPrevViewProj as { value: Matrix4 }).value.copy(this.viewProj);
    (halo.uTrail as { value: number }).value = cut || dt <= 0 || this.reducedMotion ? 0 : Math.min(6, 0.06 / Math.max(delta, 1 / 240));
    (halo.uAspect as { value: number }).value = camera.aspect;
    this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.lastCamera.copy(camera.position);
    this.lastCameraId = cameraId;

    // Décor autour du véhicule, lignes de départ et d'arrivée recalées sur le relief.
    const now = performance.now();
    decor.update(motion.s, now, camera.position.x, camera.position.z);
    this.lignes.update(decor.relief, motion.s);
    this.chevrons.update(decor.relief, motion.s, decor.root, decor.status.loaded);
    // Plan proche : la profondeur garde sa précision au loin (marquage, fenêtres, relief).
    const near = cameraId === 'embarquee' ? NEAR.cockpit : NEAR.default;
    if (camera.near !== near) {
      camera.near = near;
      camera.updateProjectionMatrix();
    }

    // Air : pluie qui monte et descend en douceur, phares, lampadaires proches.
    const off = driveDebug.off;
    const goal = WEATHER_GOALS[drive.weather] ?? (WEATHER_GOALS.sec as WeatherAmounts);
    const sky0 = this.sky0;
    const k = this.wet < 0 ? 1 : Math.min(1, delta * 1.2);
    sky0.wet += (goal.wet - sky0.wet) * k;
    sky0.rain += (goal.rain - sky0.rain) * k;
    sky0.snow += (goal.snow - sky0.snow) * k;
    this.wet = sky0.wet;
    const wet = Math.max(sky0.rain, sky0.snow);
    // Moment : la nuit ou le jour, en fondu, mêlé à la météo du ciel (src/data/moments.ts).
    const dayGoal = drive.moment === 'jour' ? 1 : 0;
    this.day = this.day < 0 ? dayGoal : this.day + (dayGoal - this.day) * Math.min(1, delta * MOMENT_RATE * 2);
    if (Math.abs(this.day - dayGoal) < 0.002) this.day = dayGoal;
    this.applyMoment(this.day, sky0.rain, sky0.snow);
    const look = this.moment.etat;
    const here = localWeather(sky0, decor.spans, motion.s, this.here);
    // Les bruitages de route écoutent la même météo locale (src/audio/sfx/meteo.ts) : objet réécrit sur place.
    meteoSon.posee = true;
    meteoSon.pluie = here.rain;
    meteoSon.neige = here.snow;
    meteoSon.mouille = here.wet;
    meteoSon.abri = shelteredAt(decor.spans, motion.s);
    this.speedFactor = Math.min(1, motion.speed / 36);
    uniforms.pmbTime.value = elapsed;
    uniforms.pmbWet.value = off?.mouille ? 0 : sky0.wet;
    uniforms.pmbRain.value = off?.mouille ? 0 : sky0.rain;
    uniforms.pmbSnow.value = off?.mouille ? 0 : sky0.snow;
    uniforms.pmbHeadPos.value.copy(rig.headLocal).applyMatrix4(rig.body.matrixWorld);
    uniforms.pmbHeadDir.value.copy(rig.headDirLocal).transformDirection(rig.body.matrixWorld);
    uniforms.pmbHeadUp.value.set(0, 1, 0).transformDirection(rig.body.matrixWorld);
    uniforms.pmbHeadRight.value.set(0, 0, 1).transformDirection(rig.body.matrixWorld);
    uniforms.pmbHeadSpread.value = rig.headSpread;
    // Brume au sol : plan d'eau proche sous la route, sinon les creux.
    const water = decor.relief.waterNear(py - 4);
    const mistGoal = water === water && water < py + 2 && water > py - MIST_BASE.waterReach ? water : py - MIST_BASE.hollow;
    // Elle glisse vers sa base, sauf après un saut (départ choisi, retour en arrière) où elle s'y pose ;
    // et jamais au-dessus de la route : la base au-dessus de la caméra noierait toute l'image.
    const glide = this.mistBase === this.mistBase && Math.abs(mistGoal - this.mistBase) < 12;
    this.mistBase = glide ? this.mistBase + (mistGoal - this.mistBase) * Math.min(1, delta * MIST_BASE.rate) : mistGoal;
    this.mistBase = Math.min(this.mistBase, py - 1.5);
    uniforms.pmbMistBase.value = this.mistBase;
    // Économie : pas de brume au sol (§ 8 : le niveau économie coupe la brume ; l'horizon garde la sienne).
    uniforms.pmbMistDensity.value = this.level === 'eco' ? 0 : look.brumeDensite * (1 + 0.3 * here.rain + 0.5 * here.snow);
    {
      // Les plus proches d'un point 10 m devant le véhicule, à chaque image. Les deux premiers sont
      // aussi de vraies lumières (elles éclairent la caisse et font leur flaque) ; tous gardent leur
      // reflet calculé. Chacun entre et sort de la liste en fondu (lampWeights) : aucune flaque ni
      // aucun reflet ne s'allume ou ne s'éteint d'un coup à la limite de portée.
      const keep = Math.min(MAX_LAMPS, profile.lampLights + REAL_LAMPS);
      const sx = px + (tx / hl) * 10;
      const sz = pz + (tz / hl) * 10;
      const work = this.nearWork;
      const found = nearestLamps(decor.lamps, decor.lampCount, sx, sz, keep + 1, work, this.order, this.dist);
      const n = lampWeights(this.dist, found, keep, REAL_LAMPS, LAMP_FADE, uniforms.pmbLampW.value, this.realShare);
      // Lampadaires éteints le jour (src/data/moments.ts) : flaques, reflets et vraies lumières en fondu.
      const lampOn = look.lampadaires;
      if (lampOn !== 1) {
        const lw = uniforms.pmbLampW.value;
        for (let i = 0; i < n * 2; i += 1) lw[i] = (lw[i] ?? 0) * lampOn;
        for (let i = 0; i < REAL_LAMPS; i += 1) this.realShare[i] = (this.realShare[i] ?? 0) * lampOn;
      }
      const lamps = uniforms.pmbLamps.value;
      lamps.set(work.subarray(0, keep * 3));
      for (let i = 0; i < REAL_LAMPS; i += 1) {
        const light = this.lampLights[i] as PointLight;
        light.intensity = i < n ? LAMP_CANDELA * (this.realShare[i] ?? 0) : 0;
        light.position.set(lamps[i * 3] ?? 0, (lamps[i * 3 + 1] ?? 0) - 0.3, lamps[i * 3 + 2] ?? 0);
      }
      uniforms.pmbLampCount.value = lampOn > 0 ? n : 0;
      // Enseignes les plus proches du même point : leur lumière colorée, en fondu de même.
      const m0 = nearestLamps(decor.neonPositions, decor.neonCount, sx, sz, MAX_NEONS + 1, work, this.order, this.dist);
      const m = lampWeights(this.dist, m0, MAX_NEONS, 0, LAMP_FADE, this.neonW2, this.neonShare);
      uniforms.pmbNeons.value.set(work.subarray(0, MAX_NEONS * 3));
      const colors = uniforms.pmbNeonColors.value;
      const nw = uniforms.pmbNeonW.value;
      for (let k = 0; k < m; k += 1) {
        const i = this.order[k] ?? 0;
        colors[k * 3] = decor.neonColors[i * 3] ?? 0;
        colors[k * 3 + 1] = decor.neonColors[i * 3 + 1] ?? 0;
        colors[k * 3 + 2] = decor.neonColors[i * 3 + 2] ?? 0;
        nw[k] = (this.neonW2[k * 2] ?? 0) * look.neons;
      }
      uniforms.pmbNeonCount.value = look.neons > 0 ? m : 0;
    }
    const sky = this.sky.material.uniforms;
    this.sky.position.copy(camera.position);
    (sky.uTime as { value: number }).value = elapsed;
    (sky.uStars as { value: number }).value = look.etoiles;
    (sky.uClouds as { value: number }).value = look.nuages;
    const far = this.farLights.material.uniforms;
    (far.uTime as { value: number }).value = elapsed;
    (far.uPixel as { value: number }).value = gl.getPixelRatio();
    // Poussière au sec, en roulant vite : quelques grains qui filent dans les phares.
    const dust = this.reducedMotion || this.level === 'eco' ? 0 : (1 - wet) * Math.min(1, Math.max(0, (motion.speed - 14) / 20)) * 0.6;
    this.rain.visible = (wet > 0.03 || dust > 0.02) && !off?.gouttes && this.density > 0.02;
    if (this.rain.visible) {
      const rain = this.rain.material.uniforms;
      (rain.uTime as { value: number }).value = elapsed;
      (rain.uCenter as { value: Vector3 }).value.copy(camera.position);
      (rain.uWind as { value: Vector3 }).value.set(-(tx / hl) * motion.speed * 0.7, 0, -(tz / hl) * motion.speed * 0.7);
      (rain.uRain as { value: number }).value = sky0.rain;
      (rain.uSnow as { value: number }).value = sky0.snow;
      (rain.uDust as { value: number }).value = dust;
      (rain.uDensity as { value: number }).value = this.density;
      // Abri : le rail au véhicule et le tunnel le plus proche (rien ne tombe sous la voûte).
      const span = nearestSpan(decor.spans, motion.s);
      (rain.uShelterP as { value: { set: (x: number, y: number, z: number, w: number) => void } }).value.set(pose.position[0], py, pose.position[2], motion.s);
      (rain.uShelterT as { value: Vector3 }).value.set(tx / hl, tz / hl, span ? span.halfWidth : 0);
      (rain.uSpan as { value: { set: (x: number, y: number) => void } }).value.set(span ? span.from : 1, span ? span.to : 0);
    }
    rig.beamGain.value = (0.012 + 0.022 * here.rain + 0.03 * here.snow) * look.phares;
    rig.glareGain.value = (1 + 0.6 * here.rain + 0.4 * here.snow) * look.phares;
    // Neige : la lueur des lampadaires prend dans l'air (halos plus larges).
    (this.kit.haloMaterial.uniforms.uSize as { value: number }).value = 3.2 * (1 + 0.5 * here.snow);
    (this.kit.haloMaterial.uniforms.uGain as { value: number }).value = 1.3 * (1 + 0.35 * here.snow + 0.2 * here.rain) * look.lampadaires;
    this.castShadow(heading, px, py, pz, look.ombre, off?.ombre === true);

    // Sonde (une face par image) et reflet planaire de la chaussée.
    this.probeAt.set(px, py + 1.1, pz);
    this.band.position.set(px, py, pz);
    const primeNow = !this.primed && decor.status.complete;
    // Faces effacées, décor sans environnement : sans quoi la sonde s'éclaircissait sans fin (src/render/probePass.ts).
    if (!off?.sonde || primeNow) {
      const job = this.probeJob;
      job.gl = gl;
      job.scene = scene;
      job.every = this.degraded ? profile.probeEvery * 4 : profile.probeEvery;
      job.all = primeNow;
      cleanProbePass(gl, scene, this.probeStep);
    }
    if (primeNow) this.primed = true;
    // Reflet planaire : sous la pluie seulement (au sec, l'enrobé ne renvoie presque rien ; sous la
    // neige, les reflets très doux des lampes suffisent), une image sur deux, et coupé en fondu par la
    // garde de météo.
    const reflectGoal = this.weatherStep >= 2 || this.degraded || off?.reflet ? 0 : 1;
    this.reflectFade += (reflectGoal - this.reflectFade) * Math.min(1, delta * 2);
    const reflectOn = this.reflection !== null && sky0.rain > 0.02 && this.reflectFade > 0.02;
    if (reflectOn && this.reflection) {
      const every = this.weatherStep >= 1 ? 3 : 2;
      if (this.frames % every === 0 || uniforms.pmbReflectionStrength.value === 0) {
        this.floor.position.set(0, py, 0);
        // La caméra du reflet est sous la chaussée : la brume au sol, calculée depuis elle, voilerait
        // tout le reflet. Elle n'y est pas.
        const mist = uniforms.pmbMistDensity.value;
        uniforms.pmbMistDensity.value = 0;
        this.reflection.update(gl, scene, camera, this.floor);
        uniforms.pmbMistDensity.value = mist;
      }
      // Miroir de la chaussée mouillée (le nuanceur le casse par le grain et les zones plus sèches).
      uniforms.pmbReflectionStrength.value = (1.2 + 1.6 * sky0.rain) * this.reflectFade;
    } else uniforms.pmbReflectionStrength.value = 0;
    this.frames += 1;
    this.watchCadence(delta);
    if (!off?.garde) this.guardWeather(delta, motion.speed, wet, stage);

    // Télémétrie et attributs, quatre fois par seconde au plus.
    if (due(now, this.lastPub)) {
      this.lastPub = now;
      const ready = this.vehicleReady && decor.status.loaded > 0 && this.frames > 2;
      const broken = decor.status.failed || this.vehicleFailed;
      if (broken && !this.reportedFailure) {
        this.reportedFailure = true;
        drive.fail();
      }
      const telemetry: DriveTelemetry = {
        ready: ready && !broken,
        failed: broken,
        speedKmh: Math.round(motion.speed * 3.6),
        s: motion.s,
        progress: this.rail.length > 0 ? Math.min(1, motion.s / this.rail.length) : 0,
        finished: motion.finished,
        depart: depart.phase,
      };
      drive.setTelemetry(telemetry);
      putData(stage, 'sortie', broken ? 'erreur' : ready ? 'prete' : 'chargement');
      putData(stage, 's', String(Math.round(motion.s)));
      putData(stage, 'vitesse', String(telemetry.speedKmh));
      putData(stage, 'camera', cameraId);
      putData(stage, 'troncons', String(decor.status.loaded));
      putData(stage, 'meteo', drive.weather);
      putData(stage, 'moment', drive.moment);
      putData(stage, 'depart', depart.phase);
      putData(stage, 'chrono', String(Math.floor(depart.chrono / 100)));
      putData(stage, 'abri', here.rain + here.snow + here.wet < 1e-3 && wet > 0 ? 'oui' : 'non');
      // Virage : braquage montré des roues avant et roulis de la caisse, en degrés arrondis.
      putData(stage, 'braquage', String(Math.round((steer * 180) / Math.PI)));
      putData(stage, 'roulis', String(Math.round((motion.roll * 180) / Math.PI)));
    }
  }

  /**
   * Pose le moment mêlé (src/drive/scene/moment.ts) sur ce qu'il règle : lumières du ciel, ciel,
   * brouillard, brume, reflets calculés, matières, lumières de la nuit (phares, lampadaires, néons,
   * fenêtres), relief lointain, bande de la sonde. Rien n'est réécrit quand rien n'a changé.
   */
  private applyMoment(day: number, rain: number, snow: number): void {
    if (!this.moment.melanger(day, rain, snow)) return;
    const e = this.moment.etat;
    const u = this.uniforms;
    this.hemi.color.copy(e.ambianceCiel);
    this.hemi.groundColor.copy(e.ambianceSol);
    this.hemi.intensity = e.ambianceIntensite;
    this.sun.color.copy(e.astre);
    this.sun.intensity = e.astreIntensite;
    this.sun.position.copy(e.astreDirection);
    const sky = this.sky.material.uniforms;
    (sky.uZenith as { value: Color }).value.copy(e.zenith);
    (sky.uMiddle as { value: Color }).value.copy(e.milieu);
    (sky.uHorizon as { value: Color }).value.copy(e.horizon);
    (sky.uGlow as { value: Color }).value.copy(e.lueur);
    (sky.uGlowDir as { value: Vector3 }).value.copy(e.lueurDirection);
    (sky.uMoonDir as { value: Vector3 }).value.copy(e.astreDirection);
    (sky.uMoon as { value: Color }).value.copy(e.astreCiel);
    (sky.uDay as { value: number }).value = e.jour;
    (sky.uDisk as { value: number }).value = e.disque;
    (sky.uCloudTint as { value: Color }).value.copy(e.teinteNuages);
    u.pmbMoonDir.value.copy(e.astreDirection);
    u.pmbMoonColor.value.copy(e.astreCiel);
    u.pmbSkyHorizon.value.copy(e.refletHorizon);
    u.pmbSkyZenith.value.copy(e.refletZenith);
    u.pmbMistColor.value.copy(e.brume);
    u.pmbHeadOn.value = e.phares;
    u.pmbGlow.value = e.fenetres;
    u.pmbLampOn.value = e.lampadaires;
    if (this.fog) {
      this.fog.color.copy(e.brouillard);
      this.fog.density = this.fogBase * e.brouillardDensite;
    }
    for (const [m, material] of this.momentMaterials) material.color.copy(e.matieres[m]);
    this.kit.farHaze.copy(e.voile);
    this.kit.farHazeMin.value = e.voileMin;
    const band = this.band.material.uniforms;
    (band.uColor as { value: Color }).value.copy(e.horizon);
    (band.uGain as { value: number }).value = e.bandeSonde;
    // Lumières de la nuit éteintes : rien n'est dessiné (lumières lointaines, lueur des villages, halos, enseignes).
    this.farLights.visible = e.lampadaires > 0.001;
    if (this.townGlow) this.townGlow.visible = e.lampadaires > 0.001;
    this.kit.haloMaterial.visible = e.lampadaires > 0.001;
    if (this.signMaterial) {
      (this.signMaterial.uniforms.uOn as { value: number }).value = e.neons;
      this.signMaterial.visible = e.neons > 0.001;
    }
  }

  /**
   * Ombre portée du véhicule par l'astre (src/drive/scene/vehicule.tsx, `cast`) : l'empreinte de
   * l'ombre de contact, décalée au sol à l'opposé de l'astre (repère du véhicule), d'autant plus
   * qu'il est bas ; invisible la nuit. Aucune allocation.
   */
  private castShadow(heading: number, px: number, py: number, pz: number, opacity: number, off: boolean): void {
    const cast = this.rig.cast;
    if (!cast) return;
    cast.mesh.visible = opacity > 0.01 && !off;
    if (!cast.mesh.visible) return;
    (cast.material.uniforms.opacity as { value: number }).value = opacity;
    const d = this.moment.etat.astreDirection;
    const c = Math.cos(heading);
    const sn = Math.sin(heading);
    // Repère du véhicule (cap autour de +Y) : avant +X, côté +Z.
    const lx = d.x * c - d.z * sn;
    const lz = d.x * sn + d.z * c;
    // Posée sur l'enrobé, qui passe un peu au-dessus du rail (bombé, dévers) : le plus haut du sol au
    // milieu et aux deux flancs du véhicule (sonde du décor).
    const half = this.rig.measure?.halfWidth ?? 0.9;
    let top = this.decor.relief.ground(px, pz, py + 1);
    top = Math.max(top, this.decor.relief.ground(px + sn * half, pz + c * half, py + 1), this.decor.relief.ground(px - sn * half, pz - c * half, py + 1));
    cast.mesh.position.y = (top === top ? Math.min(CAST_SHADOW.lift, Math.max(0, top - py)) : 0) + 0.02;
    const h = (this.rig.measure?.height ?? 1.4) * CAST_SHADOW.height;
    const k = Math.min(CAST_SHADOW.reach, h / Math.max(0.15, d.y));
    (cast.material.uniforms.uOffset as { value: { set: (x: number, y: number) => void } }).value.set(-lx * k, -lz * k);
  }

  /**
   * Plancher de cadence (§ 8 : 30 i/s en sortie) : une fois la scène prête et après 60 images de
   * mise en route (compilations, premiers tronçons), la durée médiane de 60 images est mesurée (un
   * à-coup isolé n'y compte pas) ; sous 24 i/s, la scène s'allège pour toute la sortie (plus de reflet
   * planaire, sonde quatre fois plus lente, pixel ratio ramené à 1 par la scène React).
   */
  private watchCadence(delta: number): void {
    if (this.degraded || !this.primed || !this.vehicleReady || delta <= 0) return;
    this.slowFrames += 1;
    if (this.slowFrames <= 60) return;
    const n = this.slowDeltas.length;
    const k = this.slowFrames - 61;
    if (k < n) this.slowDeltas[k] = delta;
    if (k < n - 1) return;
    this.slowDeltas.sort();
    const median = this.slowDeltas[n >> 1] ?? 0;
    if (median > 1 / 24) {
      this.degraded = true;
      this.uniforms.pmbReflectionStrength.value = 0;
      this.onDegrade?.();
    } else this.slowFrames = Number.MAX_SAFE_INTEGER;
  }

  /**
   * Garde de la météo (§ 8 : 30 i/s plancher) : en roulant sous la pluie ou la neige, si la cadence
   * reste sous WEATHER_GUARD.fps pendant WEATHER_GUARD.seconds s, la météo baisse d'un cran : gouttes
   * éclaircies et reflet planaire une image sur trois, puis reflet coupé et gouttes de moitié. Tout
   * passe en fondu ; le cran est dit dans l'attribut data-meteo-effets.
   */
  private guardWeather(delta: number, speed: number, wet: number, stage: HTMLElement | null): void {
    const densityGoal = this.weatherStep === 0 ? 1 : this.weatherStep === 1 ? 0.7 : 0.45;
    this.density += (densityGoal - this.density) * Math.min(1, delta * 1.5);
    // Fenêtres de WEATHER_GUARD.seconds s en roulant sous la pluie ou la neige, après la mise en route :
    // si la cadence de la fenêtre (images comptées sur le temps écoulé) reste sous le plancher, un cran
    // de plus. Un à-coup isolé (chargement d'un tronçon) n'y suffit pas.
    if (delta > 0 && delta < 0.5 && this.primed && this.frames > 240 && wet > 0.3 && speed > WEATHER_GUARD.minSpeed && this.weatherStep < WEATHER_STEPS.length - 1) {
      this.guardTime += delta;
      this.guardFrames += 1;
      if (this.guardTime >= WEATHER_GUARD.seconds) {
        if (this.guardFrames / this.guardTime < WEATHER_GUARD.fps) this.weatherStep += 1;
        this.guardFrames = 0;
        this.guardTime = 0;
      }
    } else if (wet <= 0.3) {
      this.guardFrames = 0;
      this.guardTime = 0;
    }
    putData(stage, 'meteoEffets', WEATHER_STEPS[this.weatherStep] ?? 'completes');
  }

  /** Appelé une fois si la scène s'allège (la scène React baisse alors le pixel ratio). */
  whenDegraded(callback: () => void): void {
    this.onDegrade = callback;
  }

  /** Sol et bâti des tronçons chargés (garde des caméras). */
  get relief(): Relief {
    return this.decor.relief;
  }

  /** Vrai si la scène s'est allégée faute de cadence. */
  isDegraded(): boolean {
    return this.degraded;
  }

  /** Triangles et appels de dessin de la passe principale, décor seul puis image entière. */
  measure(gl: WebGLRenderer, scene: Scene, camera: PerspectiveCamera): DriveMeasure {
    const info = gl.info;
    const auto = info.autoReset;
    info.autoReset = false;
    const previous = gl.getRenderTarget();
    gl.setRenderTarget(null);
    this.rig.group.visible = false;
    info.reset();
    gl.render(scene, camera);
    const decorOnly = { calls: info.render.calls, triangles: info.render.triangles };
    this.rig.group.visible = true;
    info.reset();
    gl.render(scene, camera);
    const total = { calls: info.render.calls, triangles: info.render.triangles };
    info.reset();
    info.autoReset = auto;
    gl.setRenderTarget(previous);
    return {
      decor: decorOnly,
      total,
      chunks: this.decor.status.loaded,
      chunkTriangles: this.decor.chunkTriangles(),
      lamps: this.decor.lampCount,
      lampLights: this.uniforms.pmbLampCount.value,
      wheels: this.rig.wheels.length,
      level: this.level,
      buffers: { reflection: this.reflection && this.uniforms.pmbReflectionStrength.value > 0 ? [this.reflection.measured.width, this.reflection.measured.height] : [0, 0], probe: this.profile.probeSize },
    };
  }

  dispose(): void {
    if (livePilot.current === this.pilot) livePilot.current = null;
    if (liveDepart.current === this.depart) liveDepart.current = null;
    feuxSon.rouges = 0;
    feuxSon.vert = false;
    this.detach();
    this.lignes.dispose();
    this.chevrons.dispose();
    this.decor.dispose();
    this.kit.dispose();
    for (const m of this.roles.values()) m.dispose();
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.rain.geometry.dispose();
    this.rain.material.dispose();
    this.probe.dispose();
    this.reflection?.dispose();
    this.band.geometry.dispose();
    this.band.material.dispose();
    this.farLights.geometry.dispose();
    this.farLights.material.dispose();
    if (this.townGlow) {
      this.townGlow.geometry.dispose();
      (this.townGlow.material as ShaderMaterial).dispose();
      this.townGlow.dispose();
    }
    this.signMaterial?.dispose();
    this.signAtlas?.dispose();
    for (const l of this.lampLights) l.dispose();
    this.sun.dispose();
    this.hemi.dispose();
  }
}
