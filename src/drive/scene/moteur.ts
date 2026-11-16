// Moteur de la scène de sortie : tout ce qui vit d'image en image, hors de React (aucune allocation
// par image). La scène React (Scene.tsx) le crée pour une route et un niveau de qualité, l'accroche
// à la scène three, et l'appelle à chaque image. Il tient la boucle du contrat
// (src/drive/contrat.ts) : le pilote avance, le rail donne la pose, la caméra prend son plan, le
// décor suit, la télémétrie part quatre fois par seconde au plus.

import {
  Color,
  FogExp2,
  Object3D,
  PointLight,
  Vector3,
  type Fog,
  type PerspectiveCamera,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { resolveStart } from '../../data/maps.ts';
import type { MapRoute } from '../../data/mapTypes.ts';
import type { VehicleManifest } from '../../data/vehicleTypes.ts';
import type { SurfaceUniforms } from '../../render/floor.ts';
import { ATMOSPHERE_LAYER, CAMERA_LAYERS } from '../../render/layers.ts';
import { PlanarReflection } from '../../render/planarReflection.ts';
import type { QualityLevel } from '../../render/quality.ts';
import { useDrive } from '../../state/drive.ts';
import { cameraShot } from '../cameras.ts';
import type { CameraShot, Director, DriveTelemetry, Pilot, Rail, RailPose, VehicleFrame } from '../contrat.ts';
import { createPilot } from '../pilote.ts';
import { createRail } from '../rail.ts';
import { createDirector } from '../realisateur.ts';
import { createRain, createSky, SKY } from './ciel.ts';
import type { DriveMeasure } from './debug.ts';
import { Decor, DecorKit } from './decor.ts';
import { createNightUniforms, createRoleMaterials, MAX_LAMPS, REAL_LAMPS, type NightUniforms } from './materiaux.ts';
import { DRIVE_PROFILES, due, fogDensity, nearestLamps, stepOf, type DriveProfile } from './profil.ts';
import { MovingProbe } from './sonde.ts';
import { createRig, rollWheels, type DriveModel, type DriveRig } from './vehicule.tsx';

/** Intensité des vraies lumières des lampadaires, en candelas : même éclairement que la flaque calculée (PMB_LAMP_DIFFUSE de la chaussée × 64 × π). */
const LAMP_CANDELA = 600;

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
  private readonly roles: ReturnType<typeof createRoleMaterials>;
  private readonly kit: DecorKit;
  private readonly decor: Decor;
  private readonly sky = createSky();
  private readonly rain;
  private readonly probe: MovingProbe;
  private readonly reflection: PlanarReflection | null;
  private readonly floor = new Object3D();
  private readonly lampLights: PointLight[] = [];
  private readonly kind: VehicleManifest['kind'];
  private readonly level: QualityLevel;
  private readonly route: MapRoute;
  private attached: { scene: Scene; fog: Fog | FogExp2 | null; environment: Texture | null } | null = null;
  private vehicleReady = false;
  private vehicleFailed = false;
  private reportedFailure = false;
  // Objets de travail de la boucle.
  private readonly pose: RailPose = { s: 0, position: [0, 0, 0], tangent: [1, 0, 0], heading: 0, pitch: 0, curvature: 0, ground: 'sol', urban: false, lanes: 2, width: 7 };
  private readonly frameOf: VehicleFrame;
  private readonly shot: CameraShot = { position: [0, 2, -6], target: [0, 0.5, 0], fov: 55 };
  private readonly probeAt = new Vector3();
  private readonly hidden: Object3D[];
  private readonly order = new Int32Array(MAX_LAMPS);
  private readonly dist = new Float32Array(MAX_LAMPS);
  private time = 0;
  private wet = -1;
  private lastPub = -Infinity;
  private frames = 0;
  private primed = false;
  private lampTick = 0;
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
    this.pilot = createPilot(this.rail);
    this.director = createDirector();
  }

  /** Accroche le décor, le ciel, la brume et la sonde à la scène ; règle la caméra. */
  attach(scene: Scene, camera: PerspectiveCamera): void {
    this.attached = { scene, fog: scene.fog, environment: scene.environment };
    scene.add(this.decor.root, this.sky, this.rain, ...this.lampLights);
    scene.fog = new FogExp2(new Color(SKY.fog), fogDensity(this.profile.fogFar));
    scene.environment = this.probe.target.texture;
    camera.near = 0.15;
    camera.far = 24000;
    for (const layer of CAMERA_LAYERS) camera.layers.enable(layer);
    camera.updateProjectionMatrix();
    this.decor.loadFar().catch(() => undefined);
  }

  detach(): void {
    const a = this.attached;
    if (!a) return;
    a.scene.remove(this.decor.root, this.sky, this.rain, ...this.lampLights);
    a.scene.fog = a.fog;
    a.scene.environment = a.environment;
    this.attached = null;
  }

  /** Départ choisi (MapStart.id), sinon le premier. */
  start(id: string | null): void {
    this.pilot.reset(resolveStart(this.route, id).at);
    this.director.reset();
  }

  /** Repart un peu avant `s` et roule jusqu'à elle (le pilote y arrive lancé). */
  seek(s: number): void {
    this.pilot.reset(Math.max(0, s - 90));
    const input = useDrive.getState().input;
    for (let i = 0; i < 400 && this.pilot.motion.s < s; i += 1) this.pilot.step(0.1, input, this.kind);
  }

  /** Le modèle posé (ou retiré) : roues, feux, mesures. */
  setModel(model: DriveModel | null): void {
    const rig = this.rig;
    this.vehicleReady = model !== null;
    rig.wheels = model?.wheels ?? [];
    rig.distance = 0;
    rig.measure = model?.measure ?? null;
    rig.tails = model?.tails ?? [];
    rig.tailBase = model?.tails[0]?.emissiveIntensity ?? 10;
    rig.tailLight = model?.tailLight ?? null;
    if (model) rig.headLocal.copy(model.head);
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
    const motion = this.pilot.step(dt, drive.input, this.kind);
    const pose = this.rail.poseAt(motion.s, this.pose);

    // Véhicule sur le rail : écart latéral vers la gauche de la marche, cap, pente, roulis, plongée.
    const tx = pose.tangent[0];
    const tz = pose.tangent[2];
    const hl = Math.hypot(tx, tz) || 1;
    const px = pose.position[0] + (tz / hl) * motion.offset;
    const py = pose.position[1];
    const pz = pose.position[2] - (tx / hl) * motion.offset;
    rig.group.position.set(px, py, pz);
    rig.group.rotation.set(0, pose.heading, pose.pitch);
    // Roulis (contrat) : rotation autour de l'avant +X, positive toit vers la droite (+Z) ; plongée
    // autour de l'axe latéral, de même sens que la pente (négative au freinage).
    rig.body.rotation.set(motion.roll, 0, motion.dive);
    rollWheels(rig, motion.speed * dt);
    const brake = motion.braking ? 3.2 : 1;
    for (let i = 0; i < rig.tails.length; i += 1) (rig.tails[i] as { emissiveIntensity: number }).emissiveIntensity = rig.tailBase * brake;
    if (rig.tailLight) rig.tailLight.intensity = motion.braking ? 10 : 2.5;
    rig.group.updateMatrixWorld();

    // Plan de la caméra.
    const frame = this.frameOf;
    frame.position[0] = px;
    frame.position[1] = py;
    frame.position[2] = pz;
    frame.heading = pose.heading;
    frame.pitch = pose.pitch + motion.dive;
    frame.roll = motion.roll;
    if (rig.measure) {
      frame.halfLength = rig.measure.halfLength;
      frame.halfWidth = rig.measure.halfWidth;
      frame.height = rig.measure.height;
    }
    const cameraId = drive.director ? this.director.pick(this.time, motion, pose) : drive.camera;
    const shot = cameraShot(cameraId, frame, motion, this.rail, this.time, drive.orbit, this.shot);
    camera.position.set(shot.position[0], shot.position[1], shot.position[2]);
    camera.lookAt(shot.target[0], shot.target[1], shot.target[2]);
    if (camera.fov !== shot.fov) {
      camera.fov = shot.fov;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();

    // Décor autour du véhicule.
    const now = performance.now();
    decor.update(motion.s, now);

    // Air : pluie qui monte et descend en douceur, phares, lampadaires proches.
    const wetGoal = drive.weather === 'pluie' ? 1 : 0;
    this.wet = this.wet < 0 ? wetGoal : this.wet + (wetGoal - this.wet) * Math.min(1, delta * 1.2);
    const wet = this.wet;
    uniforms.pmbTime.value = elapsed;
    uniforms.pmbWet.value = 0.35 + 0.65 * wet;
    uniforms.pmbRain.value = wet;
    uniforms.pmbHeadPos.value.copy(rig.headLocal).applyMatrix4(rig.body.matrixWorld);
    uniforms.pmbHeadDir.value.copy(rig.headDirLocal).transformDirection(rig.body.matrixWorld);
    this.lampTick += 1;
    if (this.lampTick % 4 === 1) {
      // Les plus proches d'un point 10 m devant le véhicule. Les deux premiers sont aussi de vraies
      // lumières (elles éclairent la caisse et font leur flaque) ; tous gardent leur reflet calculé.
      const lamps = uniforms.pmbLamps.value;
      const n = nearestLamps(decor.lamps, decor.lampCount, px + (tx / hl) * 10, pz + (tz / hl) * 10, Math.min(MAX_LAMPS, profile.lampLights + REAL_LAMPS), lamps, this.order, this.dist);
      for (let i = 0; i < REAL_LAMPS; i += 1) {
        const light = this.lampLights[i] as PointLight;
        light.intensity = i < n ? LAMP_CANDELA : 0;
        light.position.set(lamps[i * 3] ?? 0, (lamps[i * 3 + 1] ?? 0) - 0.3, lamps[i * 3 + 2] ?? 0);
      }
      uniforms.pmbLampCount.value = n;
    }
    const sky = this.sky.material.uniforms;
    this.sky.position.copy(camera.position);
    (sky.uTime as { value: number }).value = elapsed;
    (sky.uStars as { value: number }).value = 1 - 0.9 * wet;
    this.rain.visible = wet > 0.03;
    if (this.rain.visible) {
      const rain = this.rain.material.uniforms;
      (rain.uTime as { value: number }).value = elapsed;
      (rain.uCenter as { value: Vector3 }).value.copy(camera.position);
      (rain.uWind as { value: Vector3 }).value.set(-tx * motion.speed * 0.7, 0, -tz * motion.speed * 0.7);
    }
    rig.beamGain.value = 0.012 + 0.06 * wet;

    // Sonde (une face par image) et reflet planaire de la chaussée.
    this.probeAt.set(px, py + 1.1, pz);
    const primeNow = !this.primed && decor.status.complete;
    this.probe.step(gl, scene, this.probeAt, this.hidden, this.degraded ? profile.probeEvery * 4 : profile.probeEvery, primeNow);
    if (primeNow) this.primed = true;
    if (this.reflection && !this.degraded) {
      this.floor.position.set(0, py, 0);
      this.reflection.update(gl, scene, camera, this.floor);
      uniforms.pmbReflectionStrength.value = 2.5 + 6 * wet;
    }
    this.frames += 1;
    this.watchCadence(delta);

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
      };
      drive.setTelemetry(telemetry);
      putData(stage, 'sortie', broken ? 'erreur' : ready ? 'prete' : 'chargement');
      putData(stage, 's', String(Math.round(motion.s)));
      putData(stage, 'vitesse', String(telemetry.speedKmh));
      putData(stage, 'camera', cameraId);
      putData(stage, 'troncons', String(decor.status.loaded));
      putData(stage, 'meteo', drive.weather);
    }
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

  /** Appelé une fois si la scène s'allège (la scène React baisse alors le pixel ratio). */
  whenDegraded(callback: () => void): void {
    this.onDegrade = callback;
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
    };
  }

  dispose(): void {
    this.detach();
    this.decor.dispose();
    this.kit.dispose();
    for (const m of this.roles.values()) m.dispose();
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.rain.geometry.dispose();
    this.rain.material.dispose();
    this.probe.dispose();
    this.reflection?.dispose();
    for (const l of this.lampLights) l.dispose();
  }
}
