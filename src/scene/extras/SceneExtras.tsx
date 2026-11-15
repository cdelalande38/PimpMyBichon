// Point d'ancrage dans la scène 3D : ce qui s'ajoute à la pièce sans modifier GarageCanvas.tsx.
// La pièce cliquable : à chaque image rendue (jamais au repos), la position à l'écran des pastilles
// des points d'intérêt (src/data/pointsInteret.ts) part dans src/state/piece.ts ; un appui court sur
// un objet ouvre son menu, un appui court sur le véhicule ouvre la peinture de la zone touchée.
// Le lancer de rayon ne se fait qu'au moment de l'appui : contre les boîtes des objets (celles de la
// coupe caméra, tirées des données), et contre les maillages du véhicule.

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { Box3, Mesh, Raycaster, Vector2, Vector3, type Camera, type Intersection, type Object3D, type Scene } from 'three';
import { POINTS_INTERET } from '../../data/pointsInteret.ts';
import type { VehicleManifest } from '../../data/vehicleTypes.ts';
import { resolveVehicle } from '../../data/vehicles.ts';
import { useBuilds } from '../../state/builds.ts';
import { usePiece, type PiecePin } from '../../state/piece.ts';
import { useView } from '../../state/view.ts';
import type { GarageCut } from '../garage/build.ts';
import { openPaint, runPieceAction } from './actions.ts';
import { createTapTracker, materialOf, pickTarget, targetsFromElements, zoneForMaterial, type PieceTarget } from './piece.ts';

export interface SceneExtrasProps {
  /** Mode photo : rien ne répond, rien ne s'affiche. */
  photo: boolean;
}

/** Rayon de la zone tactile d'une pastille (48 px de diamètre), et écart mini entre deux pastilles. */
const PIN_RADIUS = 24;
const PIN_SPACING = 44;
/** Fondu de coupe en dessous duquel l'objet est tenu pour retiré. */
const CUT_GONE = 0.5;

function garageCut(root: Object3D | undefined): GarageCut | undefined {
  const cut: unknown = root?.userData.cut;
  return cut && typeof cut === 'object' && 'elements' in cut && 'fades' in cut ? (cut as GarageCut) : undefined;
}

/** Racine du véhicule à l'écran, cherchée hors du garage (le mobilier porte aussi des placeholder_*). */
function findVehicle(scene: Scene, garage: Object3D | undefined, name: string): Object3D | undefined {
  for (const child of scene.children) {
    if (child === garage) continue;
    const found = child.getObjectByName(name);
    if (found) return found;
  }
  return undefined;
}

function attached(object: Object3D | undefined, scene: Scene): boolean {
  let current: Object3D | null | undefined = object;
  while (current) {
    if (current === scene) return true;
    current = current.parent;
  }
  return false;
}

function overlaps(x: number, y: number, rect: DOMRect | undefined): boolean {
  if (!rect || rect.width === 0) return false;
  return x + PIN_RADIUS > rect.left && x - PIN_RADIUS < rect.right && y + PIN_RADIUS > rect.top && y - PIN_RADIUS < rect.bottom;
}

interface Work {
  garage: Object3D | undefined;
  cut: GarageCut | undefined;
  targets: PieceTarget[];
  vehicleRoot: Object3D | undefined;
  vehicleBox: Box3;
  eye: Vector3;
  point: Vector3;
  dir: Vector3;
  hit: Vector3;
  raycaster: Raycaster;
  ndc: Vector2;
}

function createWork(): Work {
  return {
    garage: undefined,
    cut: undefined,
    targets: [],
    vehicleRoot: undefined,
    vehicleBox: new Box3(),
    eye: new Vector3(),
    point: new Vector3(),
    dir: new Vector3(),
    hit: new Vector3(),
    raycaster: new Raycaster(),
    ndc: new Vector2(),
  };
}

/** Garage, coupe et objets visés, retrouvés si le décor a été refait ; racine du véhicule à l'écran. */
function resolve(work: Work, scene: Scene, vehicle: VehicleManifest): void {
  if (!work.garage || !attached(work.garage, scene)) work.garage = scene.getObjectByName('garage');
  const cut = garageCut(work.garage);
  if (cut !== work.cut) {
    work.cut = cut;
    work.targets = cut ? targetsFromElements(cut.elements, POINTS_INTERET) : [];
  }
  const name = vehicle.placeholder ?? `vehicule_${vehicle.id}`;
  if (work.vehicleRoot?.name !== name || !attached(work.vehicleRoot, scene)) work.vehicleRoot = findVehicle(scene, work.garage, name);
}

/** Objet retiré de l'image par la coupe caméra. */
function cutAway(work: Work, target: PieceTarget): boolean {
  return (work.cut?.fades[target.cutId] ?? 1) < CUT_GONE;
}

export function SceneExtras({ photo }: SceneExtrasProps): null {
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const mode = useView((state) => state.mode);
  const vehicle = resolveVehicle(useBuilds((state) => state.current));
  const active = !photo && mode === 'atelier';

  // Tout ce que les rappels lisent sans relancer d'effet.
  const live = useRef({ active, vehicle, camera });
  useLayoutEffect(() => {
    live.current = { active, vehicle, camera };
  }, [active, vehicle, camera]);

  const workRef = useRef<Work | null>(null);
  const getWork = (): Work => (workRef.current ??= createWork());

  useEffect(() => {
    if (!active) usePiece.getState().setPins([]);
  }, [active]);
  useEffect(() => () => usePiece.getState().setPins([]), []);

  const hadPins = useRef(false);

  // Position des pastilles : seulement quand une image est rendue (rendu à la demande).
  useFrame((state) => {
    if (!live.current.active) return;
    const work = getWork();
    resolve(work, scene, live.current.vehicle);
    const cam: Camera = state.camera;
    const rect = gl.domElement.getBoundingClientRect();
    const dock = document.querySelector('footer.dock')?.getBoundingClientRect();
    const brand = document.querySelector('header.hud .brand')?.getBoundingClientRect();
    const quick = document.querySelector('header.hud nav.quick')?.getBoundingClientRect();
    cam.getWorldPosition(work.eye);
    const occluder = work.vehicleRoot ? work.vehicleBox.setFromObject(work.vehicleRoot).expandByScalar(-0.05) : null;
    const pins: PiecePin[] = [];
    for (const target of work.targets) {
      if (cutAway(work, target)) continue;
      const { x, y, z } = target.anchor;
      work.point.set(x, y, z);
      // Caché derrière le véhicule : le trait œil → ancre traverse sa boîte (un peu resserrée).
      if (occluder && !occluder.isEmpty()) {
        const distance = work.eye.distanceTo(work.point);
        work.dir.copy(work.point).sub(work.eye).normalize();
        work.raycaster.ray.set(work.eye, work.dir);
        const hit = work.raycaster.ray.intersectBox(occluder, work.hit);
        if (hit && work.eye.distanceTo(hit) < distance) continue;
      }
      work.point.project(cam);
      if (work.point.z < -1 || work.point.z > 1) continue;
      const px = Math.round(rect.left + ((work.point.x + 1) / 2) * rect.width);
      const py = Math.round(rect.top + ((1 - work.point.y) / 2) * rect.height);
      if (px < rect.left + PIN_RADIUS || px > rect.right - PIN_RADIUS || py < rect.top + PIN_RADIUS || py > rect.bottom - PIN_RADIUS) continue;
      if (dock && py + PIN_RADIUS > dock.top) continue;
      if (overlaps(px, py, brand) || overlaps(px, py, quick)) continue;
      if (pins.some((pin) => Math.hypot(pin.x - px, pin.y - py) < PIN_SPACING)) continue;
      pins.push({ id: target.point.id, x: px, y: py });
    }
    usePiece.getState().setPins(pins);
    // Arrivée (ou retour) des pastilles à l'écran : repères allumés un instant.
    if (pins.length > 0 && !hadPins.current) usePiece.getState().reveal();
    hadPins.current = pins.length > 0;
  });

  // Appui court sur la scène : on écoute sans jamais retenir l'événement (l'orbite garde ses gestes).
  useEffect(() => {
    const element = gl.domElement;
    const tracker = createTapTracker();
    // Repères : effacés tant qu'un doigt est sur la scène, rallumés quand le dernier la quitte.
    const fingers = new Set<number>();
    const lift = (pointerId: number) => {
      fingers.delete(pointerId);
      if (fingers.size === 0) usePiece.getState().reveal();
    };
    const onDown = (event: PointerEvent) => {
      fingers.add(event.pointerId);
      usePiece.getState().hide();
      tracker.down(event.pointerId, event.clientX, event.clientY, event.timeStamp);
    };
    const onMove = (event: PointerEvent) => tracker.move(event.pointerId, event.clientX, event.clientY);
    const onCancel = (event: PointerEvent) => {
      lift(event.pointerId);
      tracker.cancel(event.pointerId);
    };
    const onUp = (event: PointerEvent) => {
      lift(event.pointerId);
      if (!tracker.up(event.pointerId, event.clientX, event.clientY, event.timeStamp)) return;
      if (!live.current.active || usePiece.getState().covered) return;
      const work = getWork();
      resolve(work, scene, live.current.vehicle);
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      work.ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      work.raycaster.setFromCamera(work.ndc, live.current.camera);
      const { origin, direction } = work.raycaster.ray;
      // Véhicule : ses maillages visibles, au moment de l'appui seulement.
      let car: Intersection | undefined;
      if (work.vehicleRoot) {
        const hits: Intersection[] = [];
        work.vehicleRoot.traverseVisible((object) => {
          if (object instanceof Mesh) object.raycast(work.raycaster, hits);
        });
        for (const hit of hits) if (!car || hit.distance < car.distance) car = hit;
      }
      const room = pickTarget(origin, direction, work.targets, (target) => cutAway(work, target));
      if (car && (!room || car.distance <= room.distance)) {
        const mesh = car.object as Mesh;
        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        openPaint(zoneForMaterial(live.current.vehicle, materialOf(mesh.name, material?.name)));
      } else if (room) {
        runPieceAction(room.target.point.action);
      }
    };
    element.addEventListener('pointerdown', onDown, { passive: true });
    element.addEventListener('pointermove', onMove, { passive: true });
    element.addEventListener('pointerup', onUp, { passive: true });
    element.addEventListener('pointercancel', onCancel, { passive: true });
    return () => {
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointercancel', onCancel);
    };
  }, [gl, scene]);

  return null;
}
