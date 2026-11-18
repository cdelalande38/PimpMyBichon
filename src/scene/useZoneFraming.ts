// Cadrage de la zone de livrée choisie dans Custom › Stickers (ou du poste choisi dans Custom ›
// Carrosserie, cadre donné tel quel), côté scène du garage (src/scene/GarageCanvas.tsx). Tant que le
// panneau des stickers le demande (src/scene/cadrageZone.ts), la caméra
// quitte la vue d'atelier pour la zone (fitZone, src/scene/fit.ts, d'après src/data/framings.ts), la
// montre en grand dans ce que le panneau laisse libre, la rotation lente s'arrête ; le doigt peut
// encore tourner et pincer autour d'elle. En quittant les stickers, la caméra revient à la vue d'avant
// (celle que le doigt avait choisie). Transitions sur l'orbite (blendOrbit), coupées si l'on demande
// moins de mouvement. Le mode photo et la vue intérieure reprennent la caméra là où elle est.

import { useFrame, useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Vector3, type PerspectiveCamera } from 'three';
import { ZONE_FRAMING_MS, zoneFramingFor } from '../data/framings.ts';
import type { VehicleManifest } from '../data/vehicleTypes.ts';
import { useZoneFocus } from './cadrageZone.ts';
import { createZoneRig, dropZone, fitZone, requestZone, stepZone, zoneCorners, type FreeZone, type OrbitPose, type ScreenFrame, type ZoneFit, type ZonePhase, type ZoneRig } from './fit.ts';

interface OrbitHandle {
  target: Vector3;
}

export interface ZoneFramingOptions {
  vehicle: VehicleManifest;
  turn: number;
  width: number;
  height: number;
  paysage: boolean;
  /** Haut de la partie libre (sous la marque), en pixels CSS. */
  bandTop: number;
  /** Bas de la partie libre tant que le panneau ne s'est pas mesuré (le haut du dock compact). */
  bandBottom: number;
  /** Paysage : la zone libre entre les boutons ronds et le menu. */
  zone: FreeZone | null;
  /** La scène laisse la caméra au cadrage (atelier, ni photo, ni mesure, ni vue intérieure). */
  allowed: boolean;
  instant: boolean;
  /** Bornes de l'élévation de l'orbite du garage. */
  polar: { min: number; max: number };
  controls: RefObject<OrbitHandle | null>;
  /** Vue d'atelier choisie au doigt (mémoire de la scène) : rendue en quittant les stickers. */
  home: RefObject<{ position: Vector3; target: Vector3 }>;
  stage: RefObject<HTMLDivElement | null>;
}

export interface ZoneFraming {
  /** Le panneau des stickers demande une zone de ce véhicule (la rotation lente s'arrête). */
  engaged: boolean;
  phase: ZonePhase;
  fit: ZoneFit | null;
  rig: RefObject<ZoneRig>;
}

/** Compteur d'images du garage, lu par les parcours (window.__pmbImagesGarage). */
function countImage(): void {
  const images = globalThis as { __pmbImagesGarage?: number };
  images.__pmbImagesGarage = (images.__pmbImagesGarage ?? 0) + 1;
}

/** Pose ou retire un attribut `data-*` de la scène sans toucher au DOM si rien ne change. */
function putData(element: HTMLElement, key: string, value: string | null): void {
  if (value === null) {
    if (element.dataset[key] !== undefined) delete element.dataset[key];
  } else if (element.dataset[key] !== value) element.dataset[key] = value;
}

const toPose = (position: Vector3, target: Vector3): OrbitPose => ({ position: [position.x, position.y, position.z], target: [target.x, target.y, target.z] });

export function useZoneFraming({ vehicle, turn, width, height, paysage, bandTop, bandBottom, zone, allowed, instant, polar, controls, home, stage }: ZoneFramingOptions): ZoneFraming {
  const focus = useZoneFocus((state) => state.focus);
  const coverTop = useZoneFocus((state) => state.coverTop);
  const spec = useMemo(() => {
    if (focus?.vehicle !== vehicle.id) return undefined;
    return focus.box ? { id: focus.zone, ...focus.box } : vehicle.livery?.find((item) => item.id === focus.zone);
  }, [focus, vehicle]);
  const engaged = spec !== undefined;
  // Partie libre : sous la marque, au-dessus du panneau (portrait) ; entre les boutons ronds et le menu (paysage).
  const free: ScreenFrame = paysage
    ? { left: zone?.left ?? 0, right: zone?.right ?? width, top: bandTop, bottom: height }
    : { left: 0, right: width, top: bandTop, bottom: coverTop ?? bandBottom };
  const freeKey = `${Math.round(free.left)},${Math.round(free.top)},${Math.round(free.right)},${Math.round(free.bottom)}`;
  const fit = useMemo(() => {
    if (!spec) return null;
    const [left, top, right, bottom] = freeKey.split(',').map(Number) as [number, number, number, number];
    return fitZone({ width, height, zone: spec, framing: zoneFramingFor(spec.face), turn, free: { left, top, right, bottom }, polar });
  }, [spec, width, height, turn, freeKey, polar]);
  const key = spec ? `${vehicle.id}|${spec.id}|${width}x${height}|${freeKey}|${turn}` : null;

  const rig = useRef<ZoneRig>(createZoneRig());
  const [phase, setPhase] = useState<ZonePhase>('out');
  const getThree = useThree((state) => state.get);
  const invalidate = useThree((state) => state.invalidate);
  useLayoutEffect(() => {
    const current = rig.current;
    if (!allowed) {
      if (current.phase !== 'out') {
        dropZone(current);
        setPhase('out');
      }
      return;
    }
    const camera = getThree().camera;
    const target = controls.current?.target ?? home.current.target;
    requestZone(current, fit && key ? { key, goal: { position: fit.position, target: fit.target } } : null, toPose(camera.position, target), toPose(home.current.position, home.current.target), performance.now(), instant ? 0 : ZONE_FRAMING_MS);
    setPhase(current.phase);
    invalidate();
  }, [allowed, key, fit, instant, controls, home, getThree, invalidate]);

  // Transition (après les contrôles d'orbite, avant le rendu) : la caméra glisse sur l'orbite.
  const corners = useMemo(() => (spec ? zoneCorners(spec, turn) : null), [spec, turn]);
  const scratch = useRef({ work: { position: [0, 0, 0], target: [0, 0, 0] } as OrbitPose, point: new Vector3(), last: [NaN, NaN, NaN, NaN] });
  useFrame((state) => {
    // Images dessinées par le garage, pour les parcours (rendu à la demande : il se tait au repos).
    countImage();
    const { work, point, last } = scratch.current;
    const current = rig.current;
    const camera = state.camera as PerspectiveCamera;
    if (current.phase === 'entering' || current.phase === 'leaving') {
      const done = stepZone(current, performance.now(), work);
      camera.position.set(work.position[0], work.position[1], work.position[2]);
      camera.lookAt(work.target[0], work.target[1], work.target[2]);
      controls.current?.target.set(work.target[0], work.target[1], work.target[2]);
      if (done) setPhase(current.phase);
      else state.invalidate();
    }
    // Pour les parcours : la zone cadrée (ou « transition »), la partie libre et la zone à l'écran.
    const element = stage.current;
    if (!element) return;
    putData(element, 'cadrage', current.phase === 'in' ? (spec?.id ?? null) : current.phase === 'out' ? null : 'transition');
    if (current.phase !== 'in' || !corners) {
      putData(element, 'zoneEcran', null);
      putData(element, 'cadrageLibre', null);
      last[0] = NaN;
      return;
    }
    camera.updateMatrixWorld();
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (let i = 0; i < corners.length; i += 1) {
      const corner = corners[i]!;
      point.set(corner[0], corner[1], corner[2]).project(camera);
      const x = ((point.x + 1) / 2) * state.size.width;
      const y = ((1 - point.y) / 2) * state.size.height;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
    if (last[0] === Math.round(left) && last[1] === Math.round(top) && last[2] === Math.round(right) && last[3] === Math.round(bottom)) return;
    last[0] = Math.round(left);
    last[1] = Math.round(top);
    last[2] = Math.round(right);
    last[3] = Math.round(bottom);
    putData(element, 'zoneEcran', last.join(','));
    putData(element, 'cadrageLibre', freeKey);
  }, 0);

  return { engaged, phase, fit, rig };
}
