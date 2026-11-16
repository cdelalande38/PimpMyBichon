// Moteur de la scène de sortie : tout ce qui vit d'image en image, hors de React (aucune allocation
// par image). La scène React (Scene.tsx) le crée pour une route et un niveau de qualité, l'accroche
// à la scène three, et l'appelle à chaque image. Il tient la boucle du contrat
// (src/drive/contrat.ts) : le pilote avance, le rail donne la pose, la caméra prend son plan (gardé
// au-dessus du terrain par la sonde du décor), le décor suit, la brume au sol se cale sur le plan
// d'eau ou le creux le plus proche, la télémétrie part quatre fois par seconde au plus.

import {
  Box3,
  Color,
  FogExp2,
  Matrix4,
  Object3D,
  PointLight,
  Vector3,
  type BufferGeometry,
  type DataTexture,
  type InstancedMesh,
  type Points,
  type ShaderMaterial,
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
import { ATMOSPHERE_LAYER, CAMERA_LAYERS, PROBE_ONLY_LAYER } from '../../render/layers.ts';
import { PlanarReflection } from '../../render/planarReflection.ts';
import type { QualityLevel } from '../../render/quality.ts';
import { useBuilds } from '../../state/builds.ts';
import { livePilot, useDrive } from '../../state/drive.ts';
import { cameraShot, guardShot } from '../cameras.ts';
import type { CameraId, CameraShot, Director, DriveTelemetry, Pilot, Rail, RailPose, VehicleFrame } from '../contrat.ts';
import { createPilot, performanceDe } from '../pilote.ts';
import { createPose, createRail } from '../rail.ts';
import { createDirector } from '../realisateur.ts';
import { createFarLights, createProbeBand, createRain, createSky, createTownGlow, SKY } from './ciel.ts';
import type { DriveMeasure } from './debug.ts';
import { Decor, DecorKit, LAMP_HEAD } from './decor.ts';
import { createSignAtlas, createSignMaterial } from './enseignes.ts';
import type { Relief } from './relief.ts';
import { createNightUniforms, createRoleMaterials, MAX_LAMPS, MAX_NEONS, MIST, REAL_LAMPS, type NightUniforms } from './materiaux.ts';
import { DRIVE_PROFILES, due, fogDensity, nearestLamps, stepOf, type DriveProfile } from './profil.ts';
import { MovingProbe } from './sonde.ts';
import { createRig, rollWheels, type DriveModel, type DriveRig } from './vehicule.tsx';

/** Intensité des vraies lumières des lampadaires, en candelas : même éclairement que la flaque calculée (PMB_LAMP_DIFFUSE de la chaussée × 64 × π). */
const LAMP_CANDELA = 380;

/** Feux arrière : intensité au repos et au freinage, en candelas (lueur rouge sur la chaussée). */
const TAIL_CANDELA = { rest: 5, brake: 18 } as const;

/** NOS : lueur bleue à l'échappement (le feu arrière vire au bleu), en candelas au plus fort. */
const NOS_GLOW = { candela: 40, color: new Color('#3b7bff') } as const;

/** Force de la bande d'horizon vue par la sonde (reflet clair qui dessine la caisse). */
const PROBE_BAND_GAIN = 0.5;

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
    // Performances du véhicule (manifeste, préparation du build) ; le pilote est publié pour le
    // compte-tours et le son (src/state/drive.ts, livePilot).
    this.pilot = createPilot(this.rail, performanceDe(vehicle, useBuilds.getState().builds[vehicle.id]));
    livePilot.current = this.pilot;
    this.director = createDirector();
    // Lumières lointaines : les lampadaires de toute la carte, la lueur des villages.
    this.farLights = createFarLights(routeLampHeads(route), this.uniforms.pmbLampColor.value);
    this.townGlow = createTownGlow(townCenters(route, this.rail), new Color('#ff8a3a'));
    // Enseignes au néon (atlas dessiné par le navigateur ; sans document, pas d'enseigne).
    this.signAtlas = typeof document === 'undefined' ? null : createSignAtlas();
    this.signMaterial = this.signAtlas ? createSignMaterial(this.signAtlas, this.uniforms.pmbTime, this.profile.fogFar) : null;
    if (this.signMaterial) this.decor.signs = { material: this.signMaterial, rail: this.rail };
  }

  /** Accroche le décor, le ciel, la brume et la sonde à la scène ; règle la caméra. */
  attach(scene: Scene, camera: PerspectiveCamera): void {
    this.attached = { scene, fog: scene.fog, environment: scene.environment };
    this.band.layers.set(PROBE_ONLY_LAYER);
    scene.add(this.decor.root, this.sky, this.rain, this.farLights, this.band, ...this.lampLights);
    if (this.townGlow) scene.add(this.townGlow);
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
    a.scene.remove(this.decor.root, this.sky, this.rain, this.farLights, this.band, ...this.lampLights);
    if (this.townGlow) a.scene.remove(this.townGlow);
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
    if (model) {
      rig.headLocal.copy(model.head);
      rig.headSpread = model.headSpread;
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
    if (rig.tailLight) {
      const boost = motion.boost ?? 0;
      if (boost > 0.01 && !this.tailColor) this.tailColor = rig.tailLight.color.clone();
      if (this.tailColor) rig.tailLight.color.copy(this.tailColor).lerp(NOS_GLOW.color, boost);
      rig.tailLight.intensity = (motion.braking ? TAIL_CANDELA.brake : TAIL_CANDELA.rest) + boost * NOS_GLOW.candela;
    }
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
    // Garde au sol : jamais sous le terrain, dans un bâtiment ni derrière un talus (hors tunnel, où
    // le relief au-dessus de la voûte fausserait la sonde).
    if (pose.ground !== 'tunnel') guardShot(shot, decor.relief);
    camera.position.set(shot.position[0], shot.position[1], shot.position[2]);
    camera.lookAt(shot.target[0], shot.target[1], shot.target[2]);
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

    // Décor autour du véhicule.
    const now = performance.now();
    decor.update(motion.s, now);

    // Air : pluie qui monte et descend en douceur, phares, lampadaires proches.
    const wetGoal = drive.weather === 'pluie' ? 1 : 0;
    this.wet = this.wet < 0 ? wetGoal : this.wet + (wetGoal - this.wet) * Math.min(1, delta * 1.2);
    const wet = this.wet;
    uniforms.pmbTime.value = elapsed;
    uniforms.pmbWet.value = 0.2 + 0.8 * wet;
    uniforms.pmbRain.value = wet;
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
    uniforms.pmbMistDensity.value = this.level === 'eco' ? 0 : MIST.density * (1 + 0.3 * wet);
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
      // Enseignes les plus proches du même point : leur lumière colorée.
      const m = nearestLamps(decor.neonPositions, decor.neonCount, px + (tx / hl) * 10, pz + (tz / hl) * 10, MAX_NEONS, uniforms.pmbNeons.value, this.order, this.dist);
      const colors = uniforms.pmbNeonColors.value;
      for (let k = 0; k < m; k += 1) {
        const i = this.order[k] ?? 0;
        colors[k * 3] = decor.neonColors[i * 3] ?? 0;
        colors[k * 3 + 1] = decor.neonColors[i * 3 + 1] ?? 0;
        colors[k * 3 + 2] = decor.neonColors[i * 3 + 2] ?? 0;
      }
      uniforms.pmbNeonCount.value = m;
    }
    const sky = this.sky.material.uniforms;
    this.sky.position.copy(camera.position);
    (sky.uTime as { value: number }).value = elapsed;
    (sky.uStars as { value: number }).value = 1 - 0.9 * wet;
    (sky.uClouds as { value: number }).value = 1 + 0.6 * wet;
    const far = this.farLights.material.uniforms;
    (far.uTime as { value: number }).value = elapsed;
    (far.uPixel as { value: number }).value = gl.getPixelRatio();
    this.rain.visible = wet > 0.03;
    if (this.rain.visible) {
      const rain = this.rain.material.uniforms;
      (rain.uTime as { value: number }).value = elapsed;
      (rain.uCenter as { value: Vector3 }).value.copy(camera.position);
      (rain.uWind as { value: Vector3 }).value.set(-tx * motion.speed * 0.7, 0, -tz * motion.speed * 0.7);
    }
    rig.beamGain.value = 0.012 + 0.022 * wet;
    rig.glareGain.value = 1 + 0.6 * wet;

    // Sonde (une face par image) et reflet planaire de la chaussée.
    this.probeAt.set(px, py + 1.1, pz);
    this.band.position.set(px, py, pz);
    const primeNow = !this.primed && decor.status.complete;
    this.probe.step(gl, scene, this.probeAt, this.hidden, this.degraded ? profile.probeEvery * 4 : profile.probeEvery, primeNow);
    if (primeNow) this.primed = true;
    if (this.reflection && !this.degraded) {
      this.floor.position.set(0, py, 0);
      // La caméra du reflet est sous la chaussée : la brume au sol, calculée depuis elle, voilerait
      // tout le reflet. Elle n'y est pas.
      const mist = uniforms.pmbMistDensity.value;
      uniforms.pmbMistDensity.value = 0;
      this.reflection.update(gl, scene, camera, this.floor);
      uniforms.pmbMistDensity.value = mist;
      // Miroir de la chaussée : au plus un peu plus que le Fresnel (plus fort, le ciel clair de l'horizon
      // y ferait une nappe blanche) ; les lampes et les néons, très lumineux, s'y lisent quand même.
      uniforms.pmbReflectionStrength.value = 1.1 + 1.7 * wet;
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
    };
  }

  dispose(): void {
    if (livePilot.current === this.pilot) livePilot.current = null;
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
  }
}
