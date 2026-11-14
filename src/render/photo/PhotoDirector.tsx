// Mode photo, côté scène (§ 5.1, § 8 « Rendu photo ») : pose la caméra sur le cadrage choisi,
// affine l'image dès que la caméra s'immobilise (images décalées d'un sous-pixel et, si le plan
// le prévoit, d'un point du disque d'ouverture : profondeur de champ), puis se tait : au repos,
// plus aucun dessin. Fournit aussi le rendu de l'image enregistrée (2160 px, en tuiles).

import { useFrame, useThree } from '@react-three/fiber';
import type { VignetteEffect } from 'postprocessing';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Vector2, Vector3, type PerspectiveCamera } from 'three';
import { framingById } from '../../data/framings.ts';
import { usePhoto, type PhotoExporter, type RefineStatus } from '../../state/photo.ts';
import { useRenderStats } from '../renderStats.ts';
import { advance, blendWeight, createAccumulator, isComplete, nextWeight, observe, shouldStop } from './accumulate.ts';
import type { AccumulatePass } from './AccumulatePass.ts';
import { framingPose } from './framing.ts';
import { apertureOffset, pixelJitter } from './jitter.ts';
import { EXPORT_MARGIN, EXPORT_TILE_LIMIT, EXPORT_WIDTH, exportSize, type PhotoPlan } from './plan.ts';
import { applyVignette } from './vignette.ts';

type Vec3 = readonly [number, number, number];

/** Fenêtre rendue : une partie (x, y, largeur, hauteur) d'une image complète, en pixels. */
interface View {
  fullWidth: number;
  fullHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Controls {
  target: Vector3;
  update: () => boolean | void;
}

export interface PhotoDirectorProps {
  pass: AccumulatePass;
  vignette: RefObject<VignetteEffect | null>;
  plan: PhotoPlan;
  /** Cadrage de l'orbite (fitCamera) : champ et distance de référence des cadrages photo. */
  fov: number;
  distance: number;
  target: Vec3;
  halfLength: number;
  /** Sens de l'avant du véhicule sur x (src/render/photo/framing.ts). */
  frontX: number;
  /** Vue d'orbite retrouvée en sortant du mode photo. */
  home: { position: Vec3; target: Vec3; fov: number };
}

function report(status: RefineStatus, done: number, target: number): void {
  const current = usePhoto.getState().refine;
  if (current.status !== status || current.done !== done || current.target !== target) {
    usePhoto.setState({ refine: { status, done, target } });
  }
}

const toBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Image vide'))), 'image/jpeg', 0.92),
  );

/** Variables de travail réutilisées d'une image à l'autre (aucune allocation par image). */
interface Rig {
  /** Pose de la caméra avant décalage, rendue après la chaîne d'image. */
  saved: Vector3;
  jittered: boolean;
  buffer: Vector2;
  right: Vector3;
  up: Vector3;
  focus: Vector3;
}

function createRig(): Rig {
  return { saved: new Vector3(), jittered: false, buffer: new Vector2(), right: new Vector3(), up: new Vector3(), focus: new Vector3() };
}

/** Pose la caméra (et la cible des contrôles) d'un coup. */
function placeCamera(camera: PerspectiveCamera, controls: Controls | null, position: Vec3, target: Vec3, fov: number): void {
  camera.fov = fov;
  camera.position.set(...position);
  camera.updateProjectionMatrix();
  if (controls) {
    controls.target.set(...target);
    controls.update();
  } else {
    camera.lookAt(...target);
  }
}

/**
 * Décale la caméra pour l'image `index` : d'un sous-pixel, et d'un point du disque d'ouverture
 * de rayon `aperture` (profondeur de champ ; le plan net passe par la cible des contrôles).
 */
function jitterCamera(camera: PerspectiveCamera, controls: Controls | null, rig: Rig, aperture: number, index: number, view: View): void {
  const { right, up, focus } = rig;
  rig.saved.copy(camera.position);
  rig.jittered = true;
  const pixel = pixelJitter(index);
  let x = view.x + pixel.x;
  let y = view.y + pixel.y;
  if (aperture > 0) {
    // La caméra bouge sur le disque ; la fenêtre de vue compense sur le plan net.
    const lens = apertureOffset(index, aperture);
    if (controls) focus.copy(controls.target);
    else focus.set(0, 0, 0);
    const depth = Math.max(0.1, camera.position.distanceTo(focus));
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    camera.position.addScaledVector(right, lens.x).addScaledVector(up, lens.y);
    const pixelsPerMetre = view.fullHeight / (2 * depth * Math.tan((camera.fov * Math.PI) / 360));
    x -= lens.x * pixelsPerMetre;
    y += lens.y * pixelsPerMetre;
  }
  camera.setViewOffset(view.fullWidth, view.fullHeight, x, y, view.width, view.height);
  camera.updateMatrixWorld();
}

/** Rend à la caméra sa pose et sa projection d'avant le décalage. */
function restoreCamera(camera: PerspectiveCamera, rig: Rig): void {
  if (!rig.jittered) return;
  camera.position.copy(rig.saved);
  camera.clearViewOffset();
  camera.updateMatrixWorld();
  rig.jittered = false;
}

export function PhotoDirector({ pass, vignette, plan, fov, distance, target, halfLength, frontX, home }: PhotoDirectorProps) {
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const controls = useThree((state) => state.controls) as unknown as Controls | null;
  const invalidate = useThree((state) => state.invalidate);
  const get = useThree((state) => state.get);
  const framing = usePhoto((state) => state.framing);
  const request = usePhoto((state) => state.request);

  const acc = useRef(createAccumulator(plan.frames));
  const startedAt = useRef(0);
  const aperture = useRef(0);
  const exportFrame = useRef<{ index: number; view: View } | null>(null);
  const [rig] = useState(createRig);

  // Le plan change avec le niveau de qualité : on repart de zéro.
  useEffect(() => {
    acc.current = createAccumulator(plan.frames);
    invalidate();
  }, [plan.frames, invalidate]);

  // Cadrage : la caméra s'y pose d'un coup (pas d'animation : l'affinage commence aussitôt).
  useLayoutEffect(() => {
    const pose = framingPose(framingById(framing), { fov, distance, target, halfLength, frontX });
    placeCamera(camera, controls, pose.position, pose.target, pose.fov);
    aperture.current = plan.depthOfField ? pose.aperture : 0;
    invalidate();
  }, [framing, request, camera, controls, fov, distance, target, halfLength, frontX, plan.depthOfField, invalidate]);

  // En sortant : l'image redevient vivante, la caméra retrouve la vue d'orbite.
  const homeRef = useRef(home);
  useEffect(() => {
    homeRef.current = home;
  }, [home]);
  useEffect(
    () => () => {
      pass.set('off');
      const { position, target: aim, fov: homeFov } = homeRef.current;
      placeCamera(camera, controls, position, aim, homeFov);
      report('mouvement', 0, 1);
      invalidate();
    },
    [pass, camera, controls, invalidate],
  );

  // Après les contrôles (−1), avant le reflet du sol et la chaîne d'image (0 et 1).
  useFrame((state) => {
    const frame = exportFrame.current;
    if (frame) {
      jitterCamera(camera, controls, rig, aperture.current, frame.index, frame.view);
      pass.set('add', blendWeight(frame.index));
      return;
    }
    const { buffer } = rig;
    state.gl.getDrawingBufferSize(buffer);
    const key = [
      ...camera.position.toArray(),
      ...camera.quaternion.toArray(),
      camera.fov,
      buffer.x,
      buffer.y,
      useRenderStats.getState().probe?.updates ?? 0,
    ];
    const previous = acc.current;
    const observed = observe(previous, key);
    if (observed !== previous) {
      // La caméra bouge : image vivante, et on revient voir à l'image suivante.
      acc.current = observed;
      pass.set('off');
      report('mouvement', 0, observed.target);
      state.invalidate();
      return;
    }
    const now = performance.now();
    if (observed.count === 0) startedAt.current = now;
    if (isComplete(observed) || shouldStop(observed, now - startedAt.current, plan.maxMs)) {
      // Image affinée : soit un autre a demandé une image, soit le temps imparti s'est écoulé
      // depuis la précédente (téléphone lent). On remontre la moyenne, et on le dit.
      pass.set('hold');
      report('net', observed.count, observed.target);
      return;
    }
    const view = { fullWidth: buffer.x, fullHeight: buffer.y, x: 0, y: 0, width: buffer.x, height: buffer.y };
    jitterCamera(camera, controls, rig, aperture.current, observed.count, view);
    pass.set('add', nextWeight(observed));
    acc.current = advance(observed);
    const done = shouldStop(acc.current, now - startedAt.current, plan.maxMs);
    report(done ? 'net' : 'affinage', acc.current.count, acc.current.target);
    // Une fois l'image affinée, plus aucune demande : le rendu se tait.
    if (!done) state.invalidate();
  }, -0.5);

  // Après la chaîne d'image : la caméra retrouve sa pose, sans décalage.
  useFrame(() => restoreCamera(camera, rig), 2);

  // Image enregistrée : 2160 px de large, rendue en tuiles (marges rognées), puis vignettée en entier.
  useEffect(() => {
    const exporter: PhotoExporter = async (onProgress) => {
      const state = get();
      const { gl } = state;
      const context = gl.getContext();
      const limit = Math.min(
        gl.capabilities.maxTextureSize,
        context.getParameter(context.MAX_RENDERBUFFER_SIZE) as number,
        EXPORT_TILE_LIMIT,
      );
      const { width: cssWidth, height: cssHeight } = state.size;
      const size = exportSize(cssWidth, cssHeight, EXPORT_WIDTH, limit - 2 * EXPORT_MARGIN);
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const context2d = canvas.getContext('2d');
      if (!context2d) throw new Error('Canvas 2D indisponible');

      const ratio = gl.getPixelRatio();
      const effect = vignette.current;
      const darkness = effect?.darkness ?? 0;
      const offset = effect?.offset ?? 0;
      let time = state.clock.elapsedTime;
      state.setFrameloop('never');
      try {
        gl.setPixelRatio(1);
        if (effect) effect.darkness = 0;
        for (const [i, tile] of size.tiles.entries()) {
          const width = tile.width + 2 * EXPORT_MARGIN;
          const height = tile.height + 2 * EXPORT_MARGIN;
          gl.setSize(width, height, false);
          const view = { fullWidth: size.width, fullHeight: size.height, x: tile.x - EXPORT_MARGIN, y: tile.y - EXPORT_MARGIN, width, height };
          for (let index = 0; index < plan.exportFrames; index += 1) {
            exportFrame.current = { index, view };
            time += 1 / 30;
            state.advance(time);
          }
          // Lu dans la même tâche que le rendu : le tampon d'image est encore là.
          context2d.drawImage(gl.domElement, EXPORT_MARGIN, EXPORT_MARGIN, tile.width, tile.height, tile.x, tile.y, tile.width, tile.height);
          onProgress((i + 1) / (size.tiles.length + 1));
          await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
      } finally {
        exportFrame.current = null;
        if (effect) effect.darkness = darkness;
        gl.setPixelRatio(ratio);
        gl.setSize(cssWidth, cssHeight, false);
        acc.current = createAccumulator(plan.frames);
        state.setFrameloop('demand');
        state.invalidate();
      }
      if (darkness > 0) applyVignette(context2d, size.width, size.height, offset, darkness);
      const blob = await toBlob(canvas);
      onProgress(1);
      return { blob, width: size.width, height: size.height };
    };
    usePhoto.setState({ exporter });
    return () => usePhoto.setState({ exporter: null });
  }, [get, vignette, plan.exportFrames, plan.frames]);

  return null;
}
