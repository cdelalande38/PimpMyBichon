// Scène du garage. Chargée à la demande (three.js pèse lourd) : la coque de l'app s'affiche avant.
// Le véhicule courant du catalogue (src/data/vehicles.ts) dans le garage du § 4, sous l'ambiance
// choisie, avec sa sonde de réflexion, son sol réfléchissant, son atmosphère et sa chaîne d'image, selon le
// niveau de qualité (src/render/quality.ts). Tout est servi par l'app : modèle, textures KTX2 et
// transcodeur ; les textures du garage sont dessinées sur place.
// Vue de départ : le véhicule nez à gauche, la caméra côté gauche (trois quarts avant), le mur
// du fond et ses halos, le mur rouge à droite : la signature du lieu. Quand on tourne autour, le
// décor qui passerait devant le véhicule quitte l'image (coupe caméra, src/scene/garage/cut.ts).
// Chaque véhicule a son cadrage de départ (src/scene/fit.ts, fitVehicle : 80 % de la largeur,
// centré dans la partie libre au-dessus du dock compact) et son côté de présentation (manifeste,
// presentSide). Vue intérieure (useView, mode 'interieur') : assis à l'une des places du manifeste
// (conducteur, passager, arrière), l'œil posé sur les sièges du modèle chargé (src/scene/fit.ts,
// placeEye), le regard qui tourne au doigt, sans se déplacer ni zoomer ; l'habitacle y allume son
// ciel étoilé et sa lumière (cabin).

import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { VignetteEffect } from 'postprocessing';
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef, type RefObject } from 'react';
import { Box3, CircleGeometry, Color, DoubleSide, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera as Camera, Quaternion, Raycaster, Vector3, type Group, type Material, type Object3D } from 'three';
import { SceneBoundary } from '../app/SceneBoundary.tsx';
import { usePaysage } from '../app/paysage.ts';
import { useMediaQuery } from '../app/useMediaQuery.ts';
import { ambiance as findAmbiance } from '../data/ambiances.ts';
import { modelPresent, placeOf, resolveVehicle } from '../data/vehicles.ts';
import type { Build, CabinLighting, InteriorView, PlaceId } from '../data/vehicleTypes.ts';
import { cabinFor, INTERIOR_SLOTS, SKY_TUNE } from '../data/habitacle.ts';
import { GARAGE } from '../data/garage.ts';
import { CAMERA_LAYERS } from '../render/layers.ts';
import { AccumulatePass } from '../render/photo/AccumulatePass.ts';
import { CONTROLS_DAMPING, controlsDamping, slowSpinSpeed } from '../render/frameMeter.ts';
import { frontFromTurn } from '../render/photo/framing.ts';
import { PhotoDirector } from '../render/photo/PhotoDirector.tsx';
import { photoPlan } from '../render/photo/plan.ts';
import { PostChain } from '../render/PostChain.tsx';
import { QUALITY_PROFILES, resolveQuality, type QualityLevel, type QualityProfile } from '../render/quality.ts';
import { ReflectionProbe } from '../render/ReflectionProbe.tsx';
import { useRenderStats, type RenderStatsState } from '../render/renderStats.ts';
import { useBench } from '../state/bench.ts';
import { useBuilds } from '../state/builds.ts';
import { useDock } from '../state/dock.ts';
import { usePhoto } from '../state/photo.ts';
import { useSettings } from '../state/store.ts';
import { useView } from '../state/view.ts';
import { AutoQuality } from './AutoQuality.tsx';
import { starLayout } from './cabin.ts';
import { SceneExtras } from './extras/SceneExtras.tsx';
import {
  clampLook,
  DEFAULT_SEAT,
  defaultZone,
  DOCK_SHIFT_MS,
  DOCK_TOP_MARGIN,
  dockShift,
  dockShiftFrom,
  dragLook,
  easeOutCubic,
  fitVehicle,
  interiorFov,
  interiorPose,
  INTERIOR,
  lookFrom,
  lookPoint,
  lookTarget,
  orbitPosition,
  placeEye,
  presentPose,
  seatMetrics,
  zoneShift,
  type BoxSize,
  type Cast,
  type FreeZone,
  type Look,
  type PlacedSeat,
} from './fit.ts';
import { FrameMeter } from './FrameMeter.tsx';
import { Garage } from './garage/Garage.tsx';
import { SceneProbe } from './SceneProbe.tsx';
import { buildPanel } from './vehicle/tableau.ts';
import { forgetModel, VehicleModel, type VehicleMeasure } from './vehicle/VehicleModel.tsx';
import { bodyPoint, STILL_BODY, useBodyPose } from './vehicle/wheels.ts';

/** Angle vertical borné de l'orbite (src/data/garage.ts). */
const { minPolar: MIN_POLAR, maxPolar: MAX_POLAR } = GARAGE.orbit;
/** Plan proche de l'atelier (la vue intérieure le rapproche). */
const NEAR = 0.1;
/** Haut du dock compact, en part de la hauteur de l'écran, tant qu'il n'est pas mesuré. */
const COMPACT_DOCK_TOP = 0.77;
/** Paysage : bande haute gardée libre (marque, étiquette du véhicule), en part de la hauteur de l'écran. */
const LANDSCAPE_TOP_MARGIN = 0.2;
/** Paysage : marge entre la zone libre et les boutons ronds ou le menu, en pixels CSS. */
const RAIL_GAP = 8;
/** Boîte d'attente d'un véhicule pas encore mesuré, d'après son genre (demi-longueur : manifeste). */
const WAITING_BOX = { car: { halfWidth: 0.9, height: 1.35 }, bike: { halfWidth: 0.4, height: 1.1 } } as const;
const NO_HIDE: readonly string[] = [];
/** Délai sans toucher avant que la rotation lente reprenne. */
const IDLE_DELAY_MS = 2500;

interface StageProps {
  level: QualityLevel;
  profile: QualityProfile;
  /** Rotation lente autorisée (réglage, mouvement réduit, panneau ouvert, mode photo). */
  mayRotate: boolean;
  /** Mode photo : cadrages, affinage, image enregistrée (src/render/photo/). */
  photo: boolean;
  /** Le réglage « auto » choisit le niveau d'après la cadence. */
  autoLevel: boolean;
  /** Cibles de rendu en demi-flottants disponibles (sinon composeur en 8 bits). */
  floatTargets: boolean;
  /** Le système demande moins de mouvement : la coupe caméra bascule sans fondu. */
  reducedMotion: boolean;
  /** Élément de la scène : on y pose, à la main, le cadre du véhicule à l'écran (tests, diagnostic). */
  stage: RefObject<HTMLDivElement | null>;
  /** Haut du dock compact à l'écran, en pixels CSS (`null` : pas encore mesuré). */
  compactTop: number | null;
  /**
   * Paysage : la zone libre entre les boutons ronds et le menu en colonne (menu ouvert), en pixels
   * CSS ; `null` : pas encore mesurée, ou portrait. Le véhicule s'y cadre, que le menu soit ouvert ou non.
   */
  zone: FreeZone | null;
  /** Paysage (téléphone tenu à deux mains) : menu en colonne à droite, pas de dock en bas. */
  paysage: boolean;
  /** Le menu est ouvert (colonne visible) : la vue glisse pour centrer le véhicule dans la zone libre. */
  menuOpen: boolean;
}

/** Pose ou retire un attribut `data-*` sans toucher au DOM si rien ne change. */
function putData(element: HTMLElement, key: string, value: string | null): void {
  if (value === null) delete element.dataset[key];
  else if (element.dataset[key] !== value) element.dataset[key] = value;
}

/** Transition de la vue intérieure : d'où l'on part, où l'on va. */
interface InteriorRig {
  phase: 'out' | 'entering' | 'in' | 'leaving';
  start: number;
  duration: number;
  fromPosition: Vector3;
  fromQuaternion: Quaternion;
  fromFov: number;
  /** Vue d'atelier laissée en entrant : rendue en sortant. */
  savedPosition: Vector3;
  savedTarget: Vector3;
  /** Véhicule à l'entrée : s'il a changé entre-temps, on sort sur la vue de départ du nouveau. */
  vehicle: string;
  /** Place visée (manifeste) : en changer repart de la pose du moment. */
  view: InteriorView | null;
  /** Sièges posés sous l'œil (modèle, pièces d'habitacle) : s'ils changent, l'œil se repose. */
  signature: string;
  /** Œil et point regardé de la place, dans le repère du véhicule, caisse au repos. */
  rest: { eye: [number, number, number]; target: [number, number, number] } | null;
  place: PlaceId | null;
  /** Ancre visée par le regard (useView, focus) ; `null` : le regard par défaut de la place. */
  focus: string | null;
  eye: Vector3;
  base: Look;
  look: Look;
  fov: number;
}

/** Pièces d'habitacle posées par l'atelier sur les ancres (src/scene/vehicle/habitacle.ts). */
const POSED = 'habitacle_pose';

function posedPiece(object: Object3D): boolean {
  for (let node: Object3D | null = object; node; node = node.parent) if (node.name === POSED) return true;
  return false;
}

/** Lancer de rayon qui voit les deux faces de chaque maillage (un pavillon vu d'en dessous, un dossier de dos). */
function castOn(targets: readonly Object3D[], origin: Vector3, direction: Vector3, skip: (object: Object3D) => boolean): number | null {
  const raycaster = new Raycaster(origin, direction);
  const changed: Array<[Material, Material['side']]> = [];
  for (const target of targets) {
    target.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      for (const material of Array.isArray(object.material) ? (object.material as Material[]) : [object.material as Material]) {
        if (material.side !== DoubleSide) {
          changed.push([material, material.side]);
          material.side = DoubleSide;
        }
      }
    });
  }
  try {
    const hit = raycaster.intersectObjects([...targets], true).find((item) => !skip(item.object));
    return hit ? hit.distance : null;
  } finally {
    for (const [material, side] of changed) material.side = side;
  }
}

/**
 * Œil et regard d'une place, dans le repère du véhicule caisse au repos : posés sur les sièges du
 * modèle chargé (ancres, pièces posées, pavillon mesuré au rayon), ou repris du manifeste pour un
 * vrai modèle sans ancres. `null` : rien pour poser l'œil (modèle pas encore là).
 */
function resolvePlace(group: Object3D | null, rootName: string, view: InteriorView, focus: string | null): { eye: [number, number, number]; target: [number, number, number] } | null {
  const root = group?.getObjectByName(rootName);
  const body = root?.getObjectByName('caisse');
  let eye: [number, number, number] | null = view.eye ? [view.eye[0], view.eye[1], view.eye[2]] : null;
  if (view.seat && root && body) {
    body.updateWorldMatrix(true, true);
    const toBody = body.matrixWorld.clone().invert();
    const quaternion = body.getWorldQuaternion(new Quaternion());
    const toWorld = (point: readonly number[]) => new Vector3(point[0], point[1], point[2]).applyMatrix4(body.matrixWorld);
    const toWorldDir = (dir: readonly number[]) => new Vector3(dir[0], dir[1], dir[2]).applyQuaternion(quaternion);
    const seats: PlacedSeat[] = [];
    for (const name of view.seat.anchors) {
      const anchor = root.getObjectByName(name);
      if (!anchor) continue;
      const at = anchor.getWorldPosition(new Vector3()).applyMatrix4(toBody);
      const pose = anchor.children.find((child) => child.name === POSED);
      let metrics = DEFAULT_SEAT;
      if (pose) {
        // Boîte du siège posé, relative à son ancre, dans le repère de la caisse.
        const box = new Box3();
        const v = new Vector3();
        pose.updateWorldMatrix(true, true);
        pose.traverse((object) => {
          if (!(object instanceof Mesh)) return;
          const position = object.geometry.getAttribute('position');
          if (!position) return;
          const toAnchor = toBody.clone().multiply(object.matrixWorld);
          for (let i = 0; i < position.count; i += 1) box.expandByPoint(v.fromBufferAttribute(position, i).applyMatrix4(toAnchor).sub(at));
        });
        const cast: Cast = (origin, direction) => castOn([pose], toWorld([at.x + origin[0], at.y + origin[1], at.z + origin[2]]), toWorldDir(direction), () => false);
        if (!box.isEmpty()) metrics = seatMetrics(cast, { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] }, view.seat.up);
      }
      seats.push({ anchor: [at.x, at.y, at.z], metrics });
    }
    // Pavillon au-dessus de l'œil : le premier maillage de la caisse touché vers le haut, pièces posées exclues.
    const roof = (x: number, z: number, from: number) => {
      const d = castOn([body], toWorld([x, from, z]), toWorldDir([0, 1, 0]), posedPiece);
      return d === null ? null : from + d;
    };
    eye = placeEye(view.seat, seats, roof) ?? eye;
  }
  if (!eye) return null;
  // Regard visé (Custom › Intérieur : le pommeau) : droit sur l'ancre, si le modèle l'a.
  const aim = focus && body ? root?.getObjectByName(focus) : undefined;
  if (aim && body) {
    const at = aim.getWorldPosition(new Vector3()).applyMatrix4(body.matrixWorld.clone().invert());
    return { eye, target: [at.x, at.y, at.z] };
  }
  const target: [number, number, number] = view.look ? lookTarget(eye, view.look) : view.target ? [view.target[0], view.target[1], view.target[2]] : [eye[0] + 1, eye[1], eye[2]];
  return { eye, target };
}

/** Ce dont dépend l'œil d'une place : le modèle posé et les pièces sur les ancres de ses sièges. */
function placeSignature(group: Object3D | null, rootName: string, view: InteriorView | null): string {
  const root = group?.getObjectByName(rootName);
  if (!root || !view) return 'absent';
  if (!view.seat) return root.uuid;
  return [root.uuid, ...view.seat.anchors.map((name) => root.getObjectByName(name)?.children.find((child) => child.name === POSED)?.uuid ?? 'nu')].join('|');
}

function Stage({ level, profile, mayRotate, photo, autoLevel, floatTargets, reducedMotion, stage, compactTop, zone, paysage, menuOpen }: StageProps) {
  const width = useThree((state) => state.size.width);
  const height = useThree((state) => state.size.height);
  // Véhicule courant (store des builds), ou celui de départ du catalogue.
  const vehicle = resolveVehicle(useBuilds((state) => state.current));
  // Le véhicule attend la relecture des builds (quelques millisecondes) : sinon le véhicule de
  // départ commencerait à se charger pour rien avant celui qu'on avait laissé à l'écran.
  const buildsRead = useBuilds((state) => state.hydrated);
  const present = modelPresent(vehicle);
  // Cadrage d'attente, puis cadrage sur la demi-longueur mesurée une fois le modèle posé. La
  // mesure entière sert aussi à la coupe caméra (volume protégé autour du véhicule). Une mesure
  // ne vaut que pour son véhicule : au changement, retour au cadrage d'attente du nouveau.
  const [measured, setMeasured] = useState<{ id: string; measure: VehicleMeasure } | null>(null);
  const measure = measured?.id === vehicle.id ? measured.measure : null;
  const halfLength = measure?.halfLength ?? vehicle.halfLengthHint;
  const onMeasured = useCallback((id: string, next: VehicleMeasure) => setMeasured({ id, measure: next }), []);
  // Côté de présentation : la pose du véhicule dans la pièce et l'azimut de départ de la caméra.
  const { turn, azimuth } = presentPose(vehicle.presentSide);
  const setTurn = useView((state) => state.setTurn);
  useLayoutEffect(() => setTurn(turn), [turn, setTurn]);
  const frontX = frontFromTurn(turn);
  // Cadrage de départ : la boîte mesurée (ou celle d'attente) à 80 % de la largeur, centrée dans la
  // partie libre entre la bande haute et le dock compact. Le dock agrandi décale ensuite la vue.
  const waiting = WAITING_BOX[vehicle.kind];
  const sizeKey = measure ? `${measure.halfLength}:${measure.halfWidth}:${measure.height}` : `${vehicle.halfLengthHint}:${waiting.halfWidth}:${waiting.height}`;
  // Paysage : pas de dock en bas, la partie libre est toute la hauteur sous la bande de la marque ;
  // en largeur, la zone entre les boutons ronds et le menu (toute la largeur en mode photo, où le
  // menu s'efface). Le menu ouvert ou fermé ne change pas le cadrage : seule la vue glisse.
  const bandBottom = paysage ? height : (compactTop ?? Math.round(height * COMPACT_DOCK_TOP));
  const bandTop = height * (paysage ? LANDSCAPE_TOP_MARGIN : DOCK_TOP_MARGIN);
  const freeZone = paysage && !photo ? (zone ?? defaultZone(width)) : null;
  const zoneWidth = freeZone ? freeZone.right - freeZone.left : width;
  const fit = useMemo(() => {
    const [hl, hw, h] = sizeKey.split(':').map(Number);
    const size: BoxSize = { halfLength: hl ?? 1, halfWidth: hw ?? 1, height: h ?? 1 };
    return fitVehicle({ width, height, size, turn, azimuth, band: { top: bandTop, bottom: bandBottom }, zoneWidth });
  }, [width, height, sizeKey, turn, azimuth, bandBottom, bandTop, zoneWidth]);
  const target = fit.target;

  // Ambiance : sources, lumières et étalonnage. La sonde de réflexion se refait à chaque changement.
  const ambiance = findAmbiance(useBench((state) => state.ambiance));
  const setStatus = useBench((state) => state.setStatus);
  // Chaque changement de véhicule repart de « chargement » (ou « absent » si le build n'a pas son
  // modèle) ; le véhicule dit « prêt » une fois posé. Un modèle tombé (« erreur ») est oublié du
  // cache (forgetModel) : un nouvel essai (`attempt`, clé du garde-fou) relance une vraie requête.
  const [attempt, setAttempt] = useState(0);
  // Essai tombé (« véhicule:essai »), et celui relancé d'office après une erreur gardée.
  const failed = useRef<string | null>(null);
  const relaunched = useRef<string | null>(null);
  useLayoutEffect(() => {
    const mount = `${vehicle.id}:${attempt}`;
    if (failed.current === mount) {
      // Tombé dans le rendu même qui le montait : l'erreur gardée d'une requête partie avant, puis
      // abandonnée en route. Elle vient d'être oubliée : une relance d'office, une seule.
      if (relaunched.current === mount) return;
      failed.current = null;
      relaunched.current = `${vehicle.id}:${attempt + 1}`;
      setAttempt(attempt + 1);
      return;
    }
    failed.current = null;
    setStatus(present === false ? 'absent' : 'chargement');
  }, [vehicle.id, attempt, present, setStatus]);
  // « Réessayer » (étiquette, src/app/App.tsx) repasse le banc de « erreur » à « chargement » : nouvel essai.
  useEffect(
    () =>
      useBench.subscribe((state, previous) => {
        if (failed.current === null || previous.status !== 'erreur' || state.status !== 'chargement') return;
        failed.current = null;
        setAttempt((value) => value + 1);
      }),
    [],
  );
  const onFail = () => {
    forgetModel(vehicle);
    failed.current = `${vehicle.id}:${attempt}`;
    setStatus('erreur');
  };
  const position = useMemo(() => orbitPosition(fit.target, fit.distance, fit.azimuth), [fit]);
  const home = useMemo(() => ({ position, target: fit.target, fov: fit.fov }), [position, fit]);

  // Mode photo : la passe de moyenne vit avec la scène, la chaîne d'image l'accueille en dernier.
  const plan = photoPlan(level);
  const accumulate = useMemo(() => new AccumulatePass(), []);
  useEffect(() => () => accumulate.dispose(), [accumulate]);
  const vignette = useRef<VignetteEffect>(null);
  const epoch = useRenderStats((state) => state.gpuEpoch);

  // La rotation lente s'efface dès qu'on touche, et reprend après un moment de calme.
  const [idle, setIdle] = useState(true);
  const idleTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(idleTimer.current), []);

  // Rendu à la demande : tant que la rotation lente est due, chaque image en demande une autre.
  // Sans cela elle ne repartirait pas après un geste, les contrôles n'émettant plus rien au repos.
  // Les mesures de « Sous le capot » (« Mesurer », « Comparer ») font tourner la scène elles aussi.
  const measuring = useRenderStats((state) => state.meter.running || state.compare.running);
  const exporting = usePhoto((state) => state.save.status === 'rendu');
  // Vue intérieure : demandée par le bouton rond, rendue impossible par le mode photo, une mesure
  // en cours ou un véhicule sans point de vue intérieur. `outside` : la caméra est revenue en orbite.
  const viewMode = useView((state) => state.mode);
  const setViewMode = useView((state) => state.setMode);
  // Habitacle allumé selon le build : ciel étoilé (couleur, densité, allumé ou éteint), lumière.
  const skyKey = useBuilds((state) => {
    const build = state.builds[vehicle.id];
    return JSON.stringify([build?.parts?.[INTERIOR_SLOTS.sky], build?.partPaints?.[INTERIOR_SLOTS.sky]?.color, build?.tune?.[SKY_TUNE]]);
  });
  const cabin = useMemo(() => {
    const [state, color, density] = JSON.parse(skyKey) as [string | undefined, string | undefined, number | undefined];
    const build: Build = { paints: {} };
    if (state !== undefined) build.parts = { [INTERIOR_SLOTS.sky]: state };
    if (color !== undefined) build.partPaints = { [INTERIOR_SLOTS.sky]: { color } };
    if (density !== undefined) build.tune = { [SKY_TUNE]: density };
    return cabinFor(vehicle, build);
  }, [vehicle, skyKey]);
  // Caisse posée par l'assiette et les roues (src/scene/vehicle/wheels.ts) : la vue intérieure et
  // l'habitacle allumé la suivent.
  const body = useBodyPose((state) => state.poses[vehicle.id]) ?? STILL_BODY;
  // Place assise : celle de l'état de vue, ou le conducteur si ce véhicule ne l'a pas.
  const place = placeOf(vehicle, useView((state) => state.place));
  const interiorView = place?.view;
  const placeId = place?.id ?? null;
  const focus = useView((state) => state.focus);
  const rootName = vehicle.placeholder ?? `vehicule_${vehicle.id}`;
  // Groupe du véhicule dans la pièce : la scène y lit les ancres des sièges et le pavillon.
  const vehicleGroup = useRef<Group>(null);
  const wantInside = viewMode === 'interieur' && interiorView !== undefined && !photo && !measuring;
  useEffect(() => {
    if (viewMode === 'interieur' && !wantInside) setViewMode('atelier');
  }, [viewMode, wantInside, setViewMode]);
  // Changer de véhicule ramène à l'atelier (l'œil d'un autre véhicule n'est pas au même endroit).
  const lastVehicle = useRef(vehicle.id);
  useEffect(() => {
    if (lastVehicle.current !== vehicle.id) setViewMode('atelier');
    lastVehicle.current = vehicle.id;
  }, [vehicle.id, setViewMode]);
  const [outside, setOutside] = useState(true);
  // État de la vue intérieure, lu et écrit hors du rendu (images, gestes).
  const interior = useRef<InteriorRig>({
    phase: 'out',
    start: 0,
    duration: 0,
    fromPosition: new Vector3(),
    fromQuaternion: new Quaternion(),
    fromFov: 0,
    savedPosition: new Vector3(),
    savedTarget: new Vector3(),
    vehicle: '',
    view: null,
    signature: '',
    rest: null,
    place: null,
    focus: null,
    eye: new Vector3(),
    base: { yaw: 0, pitch: 0 },
    look: { yaw: 0, pitch: 0 },
    fov: 60,
  });
  const rotating = ((mayRotate && idle) || measuring) && outside;
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    if (rotating) invalidate();
  }, [rotating, invalidate]);
  // La caméra voit l'atmosphère et les petits objets ; le reflet du sol, ni l'un ni l'autre ;
  // les rampes du plafond, seule la sonde les voit (src/render/layers.ts).
  const camera = useThree((state) => state.camera);
  useEffect(() => {
    for (const layer of CAMERA_LAYERS) camera.layers.enable(layer);
    invalidate();
  }, [camera, invalidate]);
  useFrame(() => {
    if (rotating) invalidate();
  });

  // Dock agrandi : la vue glisse vers le haut (fenêtre de vue décalée ; la caméra ne bouge pas, donc
  // l'orbite, la coupe caméra et les mesures restent les mêmes) pour que le véhicule tienne dans la
  // partie libre au-dessus du dock. Transition courte, coupée si l'on demande moins de mouvement.
  // Rien en mode photo : le dock y est caché et la photo pose ses propres décalages.
  const dockTop = useDock((state) => (state.expanded && !paysage ? state.top : null));
  // Vue intérieure : le point regardé se centre aussi dans la partie libre au-dessus du dock
  // compact (le levier et le bas du tableau de bord restent dans l'image).
  // Paysage : aucun décalage en hauteur (le menu est sur le côté) ; en largeur, la vue glisse vers la
  // gauche, menu ouvert, pour que le véhicule soit au milieu de la zone libre (même mécanisme).
  const shiftGoal = photo || paysage ? 0 : outside ? dockShiftFrom(bandBottom, dockTop) : dockShift(height, dockTop ?? bandBottom);
  const shiftXGoal = photo || !paysage || !menuOpen ? 0 : zoneShift(width, freeZone);
  const shift = useRef({ value: 0, from: 0, goal: 0, x: 0, xFrom: 0, xGoal: 0, start: 0, applied: '' });
  useEffect(() => {
    invalidate();
  }, [shiftGoal, shiftXGoal, photo, invalidate]);
  useFrame((state) => {
    const s = shift.current;
    const now = performance.now();
    if (s.goal !== shiftGoal || s.xGoal !== shiftXGoal) {
      s.from = s.value;
      s.goal = shiftGoal;
      s.xFrom = s.x;
      s.xGoal = shiftXGoal;
      s.start = now;
    }
    if (s.value !== s.goal || s.x !== s.xGoal) {
      const t = reducedMotion || photo ? 1 : (now - s.start) / DOCK_SHIFT_MS;
      s.value = t >= 1 ? s.goal : s.from + (s.goal - s.from) * easeOutCubic(t);
      s.x = t >= 1 ? s.xGoal : s.xFrom + (s.xGoal - s.xFrom) * easeOutCubic(t);
      if (s.value !== s.goal || s.x !== s.xGoal) invalidate();
    }
    const view = state.camera as Camera;
    if (photo) {
      // Entrée en mode photo : le décalage du dock s'efface une fois, la photo pose ensuite le sien.
      if (s.applied !== 'photo' && s.applied !== '' && view.view?.enabled) view.clearViewOffset();
      s.applied = 'photo';
      return;
    }
    // Nouvelle taille d'écran : la caméra recalcule sa projection, le décalage se repose.
    const key = `${width}x${height}:${s.x}:${s.value}`;
    if (s.applied === key) return;
    if (s.value === 0 && s.x === 0) {
      if (view.view?.enabled) view.clearViewOffset();
    } else {
      view.setViewOffset(width, height, s.x, s.value, width, height);
    }
    s.applied = key;
  }, -3);

  // Cadre du véhicule à l'écran (haut et bas de sa boîte projetée, en pixels CSS) et décalage de la
  // vue : posés sur la scène pour les parcours, qui vérifient que le véhicule reste au-dessus du dock.
  // Vue intérieure : la vue (data-vue), le regard relatif à l'axe du manifeste (data-regard, en
  // degrés) ; en atelier, la position de la caméra (data-camera, en centimètres).
  const corner = useMemo(() => new Vector3(), []);
  useFrame((state) => {
    const element = stage.current;
    if (!element) return;
    const rig = interior.current;
    const phase = rig.phase;
    putData(element, 'vue', phase === 'out' ? 'atelier' : phase === 'in' ? 'interieur' : 'transition');
    putData(element, 'regard', phase === 'in' ? `${Math.round(((rig.look.yaw - rig.base.yaw) * 180) / Math.PI)},${Math.round(((rig.look.pitch - rig.base.pitch) * 180) / Math.PI)}` : null);
    // Place assise et œil (repère du véhicule, en centimètres), pour les parcours.
    putData(element, 'place', phase === 'in' ? rig.place : null);
    putData(element, 'oeil', phase === 'in' && rig.rest ? rig.rest.eye.map((v) => Math.round(v * 100)).join(',') : null);
    const p = state.camera.position;
    putData(element, 'camera', phase === 'out' ? `${Math.round(p.x * 100)},${Math.round(p.y * 100)},${Math.round(p.z * 100)}` : null);
    let frame: string | null = null;
    let across: string | null = null;
    if (measure && phase === 'out') {
      const view = state.camera;
      view.updateMatrixWorld();
      const cos = Math.cos(turn);
      const sin = Math.sin(turn);
      let top = Infinity;
      let bottom = -Infinity;
      let left = Infinity;
      let right = -Infinity;
      for (const x of [-measure.halfLength, measure.halfLength]) {
        for (const z of [-measure.halfWidth, measure.halfWidth]) {
          for (const y of [0, measure.height]) {
            corner.set(x * cos + z * sin, y, -x * sin + z * cos).project(view);
            const screen = ((1 - corner.y) / 2) * height;
            top = Math.min(top, screen);
            bottom = Math.max(bottom, screen);
            const sx = ((corner.x + 1) / 2) * width;
            left = Math.min(left, sx);
            right = Math.max(right, sx);
          }
        }
      }
      frame = `${Math.round(top)},${Math.round(bottom)}`;
      across = `${Math.round(left)},${Math.round(right)}`;
    }
    putData(element, 'vehiculeEcran', frame);
    putData(element, 'vehiculeLargeur', across);
    putData(element, 'decalage', String(Math.round(shift.current.value)));
    putData(element, 'decalageX', String(Math.round(shift.current.x)));
  });

  // Rotation lente au temps : OrbitControls avance d'un angle fixe par image (deux fois plus vite à
  // 120 i/s qu'à 60) ; avant sa mise à jour (priorité −1), on règle sa vitesse sur la durée de
  // l'image, pas borné après un repos (src/render/frameMeter.ts, slowSpinSpeed), et son
  // amortissement de même (controlsDamping : à 60 i/s, inchangé).
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  // Entrée et sortie : on part de la caméra telle qu'elle est (même au milieu d'une transition).
  const instant = reducedMotion || photo;
  const getThree = useThree((state) => state.get);
  // Œil de la place posé dans la pièce : `keepLook` garde l'écart du regard au doigt (siège changé).
  const seatEye = useCallback(
    (rig: InteriorRig, view: InteriorView, keepLook: boolean): boolean => {
      const rest = resolvePlace(vehicleGroup.current, rootName, view, rig.focus) ?? rig.rest;
      if (!rest) return false;
      const pose = interiorPose({ eye: bodyPoint(rest.eye, body), target: bodyPoint(rest.target, body) }, turn);
      const base = lookFrom(pose.eye, pose.target);
      const look = keepLook ? { yaw: base.yaw + rig.look.yaw - rig.base.yaw, pitch: base.pitch + rig.look.pitch - rig.base.pitch } : { ...base };
      rig.rest = rest;
      rig.eye.set(...pose.eye);
      rig.base = base;
      rig.look = clampLook(base, look);
      rig.signature = placeSignature(vehicleGroup.current, rootName, view);
      return true;
    },
    [rootName, body, turn],
  );
  useEffect(() => {
    const rig = interior.current;
    const view = getThree().camera as Camera;
    const now = performance.now();
    const moving = rig.phase === 'out' || rig.phase === 'leaving' || rig.view !== interiorView || rig.focus !== focus;
    if (wantInside && interiorView && moving) {
      rig.focus = focus;
      if (rig.phase === 'out') {
        rig.savedPosition.copy(view.position);
        if (controls.current) rig.savedTarget.copy(controls.current.target);
        else rig.savedTarget.set(...target);
        rig.vehicle = vehicle.id;
        rig.rest = null;
      }
      // Modèle pas encore posé : un œil d'attente au-dessus du milieu de l'habitacle, reposé dès son arrivée.
      if (!seatEye(rig, interiorView, false)) {
        const waiting = interiorPose({ eye: bodyPoint([0, 1.2, 0], body), target: bodyPoint([1, 1.05, 0], body) }, turn);
        rig.eye.set(...waiting.eye);
        rig.base = lookFrom(waiting.eye, waiting.target);
        rig.look = { ...rig.base };
        rig.signature = '';
      }
      rig.view = interiorView;
      rig.place = placeId;
      rig.fov = interiorFov(width, height, interiorView.fov);
      rig.fromPosition.copy(view.position);
      rig.fromQuaternion.copy(view.quaternion);
      rig.fromFov = view.fov;
      rig.start = now;
      rig.duration = instant ? 0 : INTERIOR.transitionMs;
      rig.phase = 'entering';
      view.near = INTERIOR.near;
      view.updateProjectionMatrix();
      setOutside(false);
      invalidate();
    } else if (!wantInside && (rig.phase === 'in' || rig.phase === 'entering')) {
      rig.fromPosition.copy(view.position);
      rig.fromQuaternion.copy(view.quaternion);
      rig.fromFov = view.fov;
      rig.start = now;
      rig.duration = instant ? 0 : INTERIOR.transitionMs;
      rig.phase = 'leaving';
      rig.view = null;
      rig.place = null;
      invalidate();
    } else if (wantInside && interiorView && rig.rest) {
      // Même place, caisse reposée (assiette) ou écran tourné : l'œil suit, le regard au doigt reste.
      seatEye(rig, interiorView, true);
      invalidate();
    }
  }, [wantInside, interiorView, placeId, focus, turn, width, height, instant, getThree, target, invalidate, vehicle.id, body, seatEye]);
  // Siège changé dans Custom › Intérieur, ou modèle arrivé après l'entrée : l'œil se repose sur le
  // siège posé (vérifié à chaque image dessinée dedans, qui suit chaque pose de pièce).
  useFrame(() => {
    const rig = interior.current;
    if ((rig.phase !== 'in' && rig.phase !== 'entering') || !rig.view) return;
    if (placeSignature(vehicleGroup.current, rootName, rig.view) === rig.signature) return;
    const view = getThree().camera as Camera;
    if (!seatEye(rig, rig.view, rig.rest !== null)) return;
    rig.fromPosition.copy(view.position);
    rig.fromQuaternion.copy(view.quaternion);
    rig.fromFov = view.fov;
    rig.start = performance.now();
    rig.duration = instant ? 0 : INTERIOR.transitionMs;
    rig.phase = 'entering';
    invalidate();
  }, -1);
  // Le champ de la vue intérieure suit la forme de l'écran.
  const viewFov = interiorView?.fov;
  useEffect(() => {
    interior.current.fov = interiorFov(width, height, viewFov);
    invalidate();
  }, [width, height, viewFov, invalidate]);
  // Dedans : regarder autour en faisant glisser le doigt, borné autour de l'axe du manifeste.
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    if (outside) return undefined;
    const element = gl.domElement;
    let last: { id: number; x: number; y: number } | null = null;
    const down = (event: PointerEvent) => {
      if (last !== null) return;
      last = { id: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const move = (event: PointerEvent) => {
      if (last?.id !== event.pointerId) return;
      const rig = interior.current;
      const dx = event.clientX - last.x;
      const dy = event.clientY - last.y;
      last = { id: event.pointerId, x: event.clientX, y: event.clientY };
      if (rig.phase !== 'in') return;
      rig.look = clampLook(rig.base, dragLook(rig.look, dx, dy, width, height, rig.fov));
      invalidate();
    };
    const up = (event: PointerEvent) => {
      if (last?.id === event.pointerId) last = null;
    };
    element.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      element.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [outside, gl, width, height, invalidate]);
  const homeRef = useRef({ vehicle: vehicle.id, position, target });
  useEffect(() => {
    homeRef.current = { vehicle: vehicle.id, position, target };
  }, [vehicle.id, position, target]);
  // Pose de la caméra pendant la vue intérieure et ses transitions (après les contrôles d'orbite,
  // avant le rendu). Rien à faire en atelier : les contrôles d'orbite tiennent la caméra.
  const work = useMemo(() => ({ position: new Vector3(), quaternion: new Quaternion(), aim: new Vector3(), probe: new Camera() }), []);
  useFrame((state) => {
    const rig = interior.current;
    if (rig.phase === 'out') return;
    const view = state.camera as Camera;
    const t = rig.duration <= 0 ? 1 : Math.min(1, (performance.now() - rig.start) / rig.duration);
    const k = easeOutCubic(t);
    // Pose visée : l'œil et son regard, ou la vue d'atelier laissée en entrant.
    const probe = work.probe;
    let goalFov: number;
    if (rig.phase === 'entering' || rig.phase === 'in') {
      probe.position.copy(rig.eye);
      work.aim.set(...lookPoint([rig.eye.x, rig.eye.y, rig.eye.z], rig.look));
      goalFov = rig.fov;
    } else {
      // Véhicule changé depuis l'entrée : la vue de départ du nouveau, telle qu'elle est à cette image.
      if (rig.vehicle !== homeRef.current.vehicle) {
        rig.savedPosition.set(...homeRef.current.position);
        rig.savedTarget.set(...homeRef.current.target);
      }
      probe.position.copy(rig.savedPosition);
      work.aim.copy(rig.savedTarget);
      goalFov = fit.fov;
    }
    probe.lookAt(work.aim);
    if (rig.phase === 'in') {
      view.position.copy(probe.position);
      view.quaternion.copy(probe.quaternion);
    } else {
      view.position.lerpVectors(rig.fromPosition, probe.position, k);
      view.quaternion.slerpQuaternions(rig.fromQuaternion, probe.quaternion, k);
    }
    const fov = rig.phase === 'in' ? goalFov : rig.fromFov + (goalFov - rig.fromFov) * k;
    if (view.fov !== fov) {
      view.fov = fov;
      view.updateProjectionMatrix();
    }
    if (t < 1) {
      invalidate();
      return;
    }
    if (rig.phase === 'entering') {
      rig.phase = 'in';
      // Une image de plus : la scène publie la vue posée (data-vue) même quand rien d'autre ne
      // redemande d'image (passage d'un point de vue à l'autre, sans changement d'état React).
      invalidate();
    } else if (rig.phase === 'leaving') {
      rig.phase = 'out';
      view.near = NEAR;
      view.updateProjectionMatrix();
      if (controls.current) {
        controls.current.target.copy(rig.savedTarget);
        controls.current.update();
      }
      setOutside(true);
      invalidate();
    }
  }, 0);

  useFrame((_, delta) => {
    if (!controls.current) return;
    controls.current.autoRotateSpeed = slowSpinSpeed(delta);
    controls.current.dampingFactor = controlsDamping(delta);
  }, -2);

  return (
    <>
      {/* Fond et brume : le sol et le plafond prolongés s'y perdent, jamais dans le noir. */}
      <color attach="background" args={[ambiance.night]} />
      {profile.atmosphere && <fog attach="fog" args={[ambiance.night, GARAGE.fog.near, GARAGE.fog.far]} />}

      <PerspectiveCamera makeDefault fov={fit.fov} near={NEAR} far={80} position={position} />
      <OrbitControls
        ref={controls}
        makeDefault
        target={target}
        enabled={outside}
        enablePan={false}
        enableDamping
        dampingFactor={CONTROLS_DAMPING}
        minDistance={fit.minDistance}
        maxDistance={fit.maxDistance}
        minPolarAngle={MIN_POLAR}
        maxPolarAngle={MAX_POLAR}
        autoRotate={rotating}
        onStart={() => {
          window.clearTimeout(idleTimer.current);
          setIdle(false);
        }}
        onEnd={() => {
          window.clearTimeout(idleTimer.current);
          idleTimer.current = window.setTimeout(() => setIdle(true), IDLE_DELAY_MS);
        }}
      />

      <Garage ambiance={ambiance} profile={profile} vehicle={measure} instantCut={reducedMotion || photo} hide={GARAGE.hideFor[vehicle.kind] ?? NO_HIDE} />
      {/* Ce que la pièce ajoute à la scène sans toucher à ce fichier (points d'intérêt, appui sur le véhicule). */}
      <SceneExtras photo={photo} />
      {/* En photo, la sonde passe en haute résolution (src/render/photo/plan.ts). */}
      <ReflectionProbe size={photo ? plan.probeSize : profile.probeSize} position={GARAGE.probe} version={ambiance.id} epoch={epoch} />
      {/* Le modèle arrive après le décor ; s'il manque (absent du build, ou première visite sans
          réseau), le garage reste et l'étiquette le dit. Un véhicule et un essai par clé : en changer
          libère l'ancien (modèle, peinture, ombre) et remet à zéro le garde-fou. */}
      {/* Pose du véhicule dans la pièce (nez à gauche, ou à droite selon presentSide) : on tourne son groupe, pas le modèle. */}
      <group ref={vehicleGroup} rotation-y={turn}>
        {buildsRead && present !== false && (
          <SceneBoundary key={`${vehicle.id}:${attempt}`} onFail={onFail}>
            <Suspense fallback={null}>
              <VehicleModel vehicle={vehicle} onMeasured={onMeasured} bodyEnv={ambiance.bodyEnv} />
            </Suspense>
          </SceneBoundary>
        )}
        {/* Ciel étoilé et lumière d'habitacle : montés avec le véhicule qui les déclare, allumés en vue
            intérieure seulement ; couleur, densité et allumage du ciel suivent le build (Custom · Intérieur). */}
        {cabin && (
          <group position-y={body.y} rotation-z={body.pitch}>
            <CabinLights key={vehicle.id} cabin={cabin} on={!outside} />
          </group>
        )}
      </group>

      <PostChain ambiance={ambiance} profile={profile} accumulate={accumulate} vignette={vignette} floatTargets={floatTargets} />
      {/* Depuis la vue intérieure, la photo attend que la caméra soit revenue en orbite (sortie immédiate). */}
      {photo && outside && (
        <PhotoDirector
          pass={accumulate}
          vignette={vignette}
          plan={plan}
          fov={fit.fov}
          distance={fit.distance}
          target={target}
          halfLength={halfLength}
          frontX={frontX}
          home={home}
        />
      )}

      <SceneProbe />
      <AutoQuality enabled={autoLevel && !measuring && !exporting} />
      <FrameMeter level={level} instantCut={reducedMotion || photo} photo={photo} />
    </>
  );
}

/**
 * Force des points du ciel étoilé : au-delà de 1, ils passent le seuil du halo (bloom). Assez haut
 * pour qu'un point de quelques millimètres, plus petit qu'un pixel, se lise encore sur le pavillon.
 */
const STAR_GLOW = 2.4;
/** Disque d'un point du ciel, tourné vers le bas (on le voit depuis les sièges). */
const STAR_DISC = new CircleGeometry(1, 8).rotateX(Math.PI / 2);

/**
 * Ciel étoilé (src/scene/cabin.ts : un seul maillage instancié, un appel de dessin), cadrans et
 * écran rétroéclairés, et lumière d'habitacle du manifeste (cabin), dans le repère du véhicule. La lumière reste montée, éteinte
 * hors de la vue intérieure : l'allumer ne recompile aucun programme. Rien ne bouge : au repos,
 * rien n'est redessiné.
 */
function CabinLights({ cabin, on }: { cabin: CabinLighting; on: boolean }) {
  const { sky, light } = cabin;
  const stars = useMemo(() => {
    if (!sky) return null;
    const layout = starLayout(sky);
    const material = new MeshBasicMaterial({ color: new Color(sky.color).multiplyScalar(STAR_GLOW), toneMapped: false, fog: false });
    const mesh = new InstancedMesh(STAR_DISC, material, layout.length);
    const matrix = new Matrix4();
    layout.forEach((star, i) => {
      matrix.makeScale(star.radius, star.radius, star.radius).setPosition(star.x, star.y, star.z);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    return mesh;
  }, [sky]);
  // Ciel changé (couleur, densité, allumé) : une image de plus, la scène est rendue à la demande.
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    invalidate();
  }, [stars, light, invalidate]);
  useEffect(
    () => () => {
      if (!stars) return;
      stars.dispose();
      (stars.material as MeshBasicMaterial).dispose();
    },
    [stars],
  );
  // Cadrans et écran : un disque ou un rectangle par surface, face à sa normale (src/scene/vehicle/
  // tableau.ts). Ceux qui portent un instrument sont dessinés à zéro, une fois : au garage, rien n'est
  // redessiné ensuite.
  const panels = useMemo(() => (cabin.panels ?? []).map(buildPanel), [cabin.panels]);
  useEffect(
    () => () => {
      for (const panel of panels) panel.dispose();
    },
    [panels],
  );
  const lightColor = light?.color ?? sky?.color ?? '#ffe2c0';
  return (
    // Hors de la sonde de réflexion, comme le véhicule.
    <group userData={{ hideInProbe: true }}>
      {stars && <primitive object={stars} visible={on} />}
      {panels.map((panel) => (
        <primitive key={panel.mesh.uuid} object={panel.mesh} visible={on} />
      ))}
      {light && <pointLight position={light.position as [number, number, number]} color={lightColor} intensity={on ? light.intensity : 0} distance={light.distance} decay={2} />}
    </group>
  );
}

export interface GarageCanvasProps {
  /** Un panneau recouvre la scène : on arrête la rotation, donc le rendu. */
  paused: boolean;
  /** Mode photo : interface effacée, cadrages et image qui s'affine. */
  photo: boolean;
}

/** Cibles de rendu en demi-flottants : sans elles, le composeur et le reflet resteraient noirs. */
function hasFloatTargets(gl: { extensions: { has: (name: string) => boolean } }): boolean {
  return gl.extensions.has('EXT_color_buffer_float') || gl.extensions.has('EXT_color_buffer_half_float');
}

/** Contexte WebGL perdu puis rendu (fréquent sur Android) : sonde et ombre de contact se refont. */
function watchContext(canvas: HTMLCanvasElement, invalidate: () => void): void {
  canvas.addEventListener('webglcontextrestored', () => {
    useRenderStats.setState((state) => ({ gpuEpoch: state.gpuEpoch + 1 }));
    // Rendu à la demande : sans cette demande, l'écran resterait vide jusqu'au premier glissé.
    invalidate();
  });
}

export default function GarageCanvas({ paused, photo }: GarageCanvasProps) {
  const quality = useSettings((state) => state.quality);
  const autoRotate = useSettings((state) => state.autoRotate);
  const benchStatus = useBench((state) => state.status);
  const vehicle = resolveVehicle(useBuilds((state) => state.current));
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const autoLevel = useRenderStats((state) => state.auto.level);
  // Connu à la création du contexte (onCreated) : la scène attend, plutôt que de se monter un
  // instant avec des cibles en demi-flottants que le processeur graphique ne saurait pas rendre.
  const floatKnown = useRenderStats((state) => state.floatTargets);
  const floatTargets = floatKnown !== false;
  const fullFloat = useRenderStats((state) => state.fullFloatTargets) !== false;
  const exporting = usePhoto((state) => state.save.status === 'rendu');
  const level = resolveQuality(quality, autoLevel, floatTargets, fullFloat);
  const profile = QUALITY_PROFILES[level];

  // Nombre d'éléments du décor retirés par la coupe caméra, trame du fondu (variantes prêtes,
  // matériaux qui la portent en ce moment) et programmes de nuanceur vivants (tests, diagnostic) :
  // posés à la main sur la scène, pour ne pas refaire le rendu React de toute la scène pendant un glissé.
  const stage = useRef<HTMLDivElement>(null);
  // Haut du dock compact : la partie libre où le véhicule se cadre. Mesuré à l'écran (le dock vit
  // hors de la scène), gardé quand le dock est agrandi ou fermé.
  const [compactTop, setCompactTop] = useState<number | null>(null);
  const dockExpanded = useDock((state) => state.expanded);
  const dockClosed = useDock((state) => state.closed);
  // Paysage : zone libre entre les boutons ronds (gauche) et le menu en colonne (droite), mesurée à
  // l'écran menu ouvert et gardée quand il se ferme (le cadrage ne change pas, seule la vue glisse).
  const paysage = usePaysage();
  const textSize = useSettings((state) => state.textSize);
  const [zone, setZone] = useState<FreeZone | null>(null);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (paysage) {
          const menu = document.querySelector<HTMLElement>('.app > footer.dock:not(.photo-bar):not([data-taille="ferme"])');
          const rail = document.querySelector<HTMLElement>('nav.quick');
          if (menu && rail) {
            const next = { left: Math.round(rail.getBoundingClientRect().right) + RAIL_GAP, right: Math.round(menu.getBoundingClientRect().left) - RAIL_GAP };
            setZone((last) => (last && last.left === next.left && last.right === next.right ? last : next));
          }
          return;
        }
        const dock = document.querySelector<HTMLElement>('footer.dock[data-taille="compact"]');
        if (dock) setCompactTop(Math.round(dock.getBoundingClientRect().top));
      });
    };
    measure();
    // Le dock arrive parfois après la scène (chargement, relecture des réglages) : on remesure.
    const later = [window.setTimeout(measure, 400), window.setTimeout(measure, 1500)];
    window.addEventListener('resize', measure);
    return () => {
      window.cancelAnimationFrame(frame);
      for (const timer of later) window.clearTimeout(timer);
      window.removeEventListener('resize', measure);
    };
  }, [dockExpanded, dockClosed, vehicle.id, paysage, textSize]);
  useEffect(() => {
    const put = (element: HTMLDivElement, key: 'coupe' | 'trame' | 'tramePret' | 'programmes', value: string | null) => {
      if (value === null) delete element.dataset[key];
      else if (element.dataset[key] !== value) element.dataset[key] = value;
    };
    const show = ({ cut, cutDither, programs }: Pick<RenderStatsState, 'cut' | 'cutDither' | 'programs'>) => {
      const element = stage.current;
      if (!element) return;
      put(element, 'coupe', cut === null ? null : String(cut.hidden));
      put(element, 'trame', cutDither === null ? null : String(cutDither.active));
      put(element, 'tramePret', cutDither === null ? null : cutDither.ready ? 'oui' : 'non');
      put(element, 'programmes', programs === null ? null : String(programs));
    };
    show(useRenderStats.getState());
    return useRenderStats.subscribe(show);
  }, []);

  return (
    <div
      ref={stage}
      className="stage"
      role="img"
      data-bench={benchStatus}
      data-vehicle={vehicle.id}
      data-quality={level}
      data-busy={exporting}
      aria-label={`Vue 3D du garage, avec ${vehicle.name.replace(/^L[ea] |^L’/, (article) => article.toLowerCase())}. Glisse pour tourner autour, pince pour zoomer.`}
    >
      <Canvas
        // Rendu à la demande : quand rien ne bouge, le téléphone ne calcule rien (§ 8, budgets).
        frameloop="demand"
        dpr={[1, profile.dprMax]}
        // Tout passe par le composeur et ses cibles : le canvas n'a besoin ni de MSAA, ni de
        // profondeur, ni de stencil (mémoire graphique, § 8).
        gl={{ antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' }}
        onCreated={({ gl, invalidate }) => {
          useRenderStats.setState({ floatTargets: hasFloatTargets(gl), fullFloatTargets: gl.extensions.has('EXT_color_buffer_float') });
          watchContext(gl.domElement, () => invalidate());
        }}
      >
        {floatKnown !== null && (
          <Stage
            level={level}
            profile={profile}
            mayRotate={autoRotate && !reducedMotion && !paused && !photo}
            photo={photo}
            autoLevel={quality === 'auto'}
            floatTargets={floatTargets}
            reducedMotion={reducedMotion}
            stage={stage}
            compactTop={compactTop}
            zone={paysage ? zone : null}
            paysage={paysage}
            menuOpen={!dockClosed}
          />
        )}
      </Canvas>
    </div>
  );
}
