// Le garage du § 4, construit d'après src/data/garage.ts, sous l'ambiance choisie.
// Remplace placeholder_garage ; le mobilier reste construit par le code (placeholder_*).
// Il porte aussi la réflexion planaire de son sol, son atmosphère, selon le niveau de qualité,
// et la coupe caméra : ce qui passerait entre l'œil et le véhicule quitte l'image (cut.ts). La
// trame du fondu n'est compilée que pendant un fondu, variantes préparées à l'avance
// (src/render/cutDither.ts) : au repos et en rotation lente, aucun rejet de fragments.

import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Vector3, WebGLRenderTarget, type Mesh } from 'three';
import type { Ambiance } from '../../data/ambiances.ts';
import { GARAGE } from '../../data/garage.ts';
import { cutDitherMeshes, cutDitherPrograms, programsReady, warmCutDither, type CutDitherProgram } from '../../render/cutDither.ts';
import { PlanarReflection } from '../../render/planarReflection.ts';
import type { QualityProfile } from '../../render/quality.ts';
import { useRenderStats } from '../../render/renderStats.ts';
import { createGarage } from './build.ts';
import { createCutState, decideCut, protectedBoxes, stepFades, type CutState, type VehicleMeasure } from './cut.ts';

/**
 * Pas de temps maximal du fondu, en secondes : en rendu à la demande, la première image après un
 * repos arrive avec tout le temps écoulé depuis, et sauterait le fondu.
 */
const MAX_FADE_STEP_S = 1 / 20;

/**
 * Priorité de la décision : après les contrôles d'orbite (-1), qui posent la caméra, avant le
 * décalage du mode photo (-0,5 : sous-pixel, disque d'ouverture, tuiles), qui ne doit pas la
 * faire varier, et avant le reflet du sol (0) et la chaîne d'image (1).
 */
const CUT_PRIORITY = -0.6;

/** Relevé des programmes de nuanceur : après la chaîne d'image (1) et les relevés de l'image (2). */
const PROGRAMS_PRIORITY = 3;

/** Sans véhicule posé (modèle absent), on prépare la trame au bout de ce délai. */
const DITHER_VEHICLE_WAIT_MS = 4000;
/** Intervalle de l'attente (préchauffage, puis compilation en tâche de fond). */
const DITHER_POLL_MS = 100;
/**
 * Préchauffage par tranches : au plus ce temps de fil principal d'un coup, puis une image passe
 * (la rotation lente ne saute pas pendant la préparation).
 */
const DITHER_SLICE_MS = 6;
const DITHER_SLICE_GAP_MS = 20;

interface DitherControl {
  /** Variantes « trame » prêtes pour l'état en cours (niveau, contexte) : le fondu est permis. */
  ready: boolean;
  /** Images dessinées depuis le montage (la trame se prépare après la première). */
  frames: number;
  /** Matériaux en trame, et programmes vivants, tels que publiés. */
  active: number;
  programs: number;
  /** Dernier préchauffage (fil principal, puis attente des variantes), en millisecondes. */
  warm: { ms: number; readyMs: number } | null;
}

/** Publie l'état de la trame (tests, « Sous le capot ») ; seulement s'il a changé. */
function publishDither(dither: DitherControl, carriers: number): void {
  const current = useRenderStats.getState().cutDither;
  if (current?.ready === dither.ready && current.active === dither.active && current.carriers === carriers && current.warm === dither.warm) return;
  useRenderStats.setState({ cutDither: { ready: dither.ready, active: dither.active, carriers, warm: dither.warm } });
}

interface CutControl {
  state: CutState;
  eye: Vector3;
  last: Vector3;
  /** P a changé : décider de nouveau même si l'œil n'a pas bougé. */
  dirty: boolean;
  /** Poser l'état d'un coup, sans fondu (première image, qualité, contexte rendu). */
  snap: boolean;
}

export interface GarageProps {
  ambiance: Ambiance;
  profile: QualityProfile;
  /** Mesure du véhicule posé ; `null` tant qu'il n'est pas mesuré, ou s'il manque. */
  vehicle: VehicleMeasure | null;
  /** Coupe sans fondu : mouvement réduit, mode photo (l'image s'affine dès l'arrêt). */
  instantCut: boolean;
}

export function Garage({ ambiance, profile, vehicle, instantCut }: GarageProps) {
  const invalidate = useThree((state) => state.invalidate);
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  // Une œuvre qui arrive redemande une image (rendu à la demande).
  const garage = useMemo(() => createGarage(GARAGE, { onChange: invalidate }), [invalidate]);
  useEffect(() => () => garage.dispose(), [garage]);
  // Avant les effets ordinaires : la sonde de réflexion se refait sur les nouvelles couleurs.
  useLayoutEffect(() => {
    garage.update(ambiance);
    invalidate();
  }, [garage, ambiance, invalidate]);

  // Réflexion planaire : cible à la fraction d'image du niveau (aucune en économie).
  const scale = profile.reflection;
  const reflection = useMemo(() => (scale > 0 ? new PlanarReflection(scale, garage.surfaces) : null), [scale, garage]);
  useLayoutEffect(() => {
    garage.setQuality({ reflection: reflection !== null, atmosphere: profile.atmosphere });
    invalidate();
    return () => reflection?.dispose();
  }, [garage, reflection, profile.atmosphere, invalidate]);

  // Avant la chaîne d'image (priorité 1) : le reflet est prêt quand la scène est dessinée.
  useFrame(({ gl, scene, camera }) => {
    if (!reflection) return;
    reflection.update(gl, scene, camera, garage.floor);
    const { width, height } = reflection.measured;
    const current = useRenderStats.getState().reflection;
    if (current?.width !== width || current.height !== height) useRenderStats.setState({ reflection: { width, height } });
  });
  useEffect(() => {
    if (!reflection) useRenderStats.setState({ reflection: null });
  }, [reflection]);

  // Coupe caméra. P : la boîte du véhicule mesuré, ou celle d'attente.
  const protect = useMemo(() => protectedBoxes(vehicle, GARAGE.vehicle.turn, GARAGE.vehicle.protect), [vehicle]);
  const controlRef = useRef<CutControl | null>(null);
  const control = useCallback(
    (): CutControl =>
      (controlRef.current ??= {
        state: createCutState(garage.cut.structure),
        eye: new Vector3(),
        last: new Vector3(Number.NaN, 0, 0),
        dirty: true,
        snap: true,
      }),
    [garage],
  );
  useEffect(() => {
    control().dirty = true;
    invalidate();
  }, [control, protect, invalidate]);
  // Changement de niveau de qualité, contexte WebGL rendu après une perte : état posé d'un coup.
  const epoch = useRenderStats((state) => state.gpuEpoch);
  useLayoutEffect(() => {
    control().snap = true;
    invalidate();
  }, [control, profile, epoch, invalidate]);
  useEffect(
    () => () => {
      useRenderStats.setState({ cut: null, cutDither: null, programs: null });
    },
    [],
  );

  // Trame du fondu : variantes préparées sans rien dessiner, une fois la première image faite et
  // ses programmes prêts (le démarrage passe d'abord), puis à chaque niveau de qualité (autre
  // sonde, autre brume, autre sol) et après un contexte WebGL rendu. Mouvement réduit et mode
  // photo n'en ont pas besoin : la coupe y bascule toujours sans fondu.
  const ditherRef = useRef<DitherControl>({ ready: false, frames: 0, active: 0, programs: -1, warm: null });
  const vehicleRef = useRef(vehicle);
  useEffect(() => {
    vehicleRef.current = vehicle;
  }, [vehicle]);
  // Cible liée pendant le préchauffage : la clé de programme dépend d'une cible non nulle.
  const warmTarget = useMemo(() => new WebGLRenderTarget(1, 1, { depthBuffer: false }), []);
  useEffect(() => () => warmTarget.dispose(), [warmTarget]);
  useEffect(() => {
    const dither = ditherRef.current;
    const carriers = garage.cut.dither.carriers;
    dither.ready = false;
    publishDither(dither, carriers.length);
    if (instantCut) return undefined;
    const start = performance.now();
    let meshes: Mesh[] | null = null;
    let cursor = 0;
    let programs: CutDitherProgram[] | null = null;
    let warmStart = 0;
    let warmMs = 0;
    let timer = 0;
    const tick = () => {
      if (programs === null && meshes === null) {
        const settled = vehicleRef.current !== null || performance.now() - start > DITHER_VEHICLE_WAIT_MS;
        if (settled && dither.frames > 0 && scene.environment !== null && programsReady(gl.info.programs)) {
          meshes = cutDitherMeshes(garage.root, carriers);
          warmStart = performance.now();
        }
      }
      if (programs === null && meshes !== null) {
        const sliceStart = performance.now();
        cursor = warmCutDither(gl, meshes, cursor, scene, camera, carriers, warmTarget, DITHER_SLICE_MS);
        warmMs += performance.now() - sliceStart;
        if (cursor < meshes.length) {
          timer = window.setTimeout(tick, DITHER_SLICE_GAP_MS);
          return;
        }
        programs = cutDitherPrograms(gl, carriers);
      }
      if (programs !== null && programsReady(programs)) {
        dither.ready = true;
        dither.warm = { ms: Math.round(warmMs), readyMs: Math.round(performance.now() - warmStart) };
        publishDither(dither, carriers.length);
        dither.programs = gl.info.programs?.length ?? 0;
        useRenderStats.setState({ programs: dither.programs });
        return;
      }
      timer = window.setTimeout(tick, DITHER_POLL_MS);
    };
    timer = window.setTimeout(tick, 0);
    return () => window.clearTimeout(timer);
  }, [gl, scene, camera, garage, profile, epoch, instantCut, warmTarget]);

  // Aucune allocation ici : la décision ne se refait que si l'œil ou P bouge ; un fondu en cours
  // redemande une image jusqu'à sa fin, puis plus rien (rendu à la demande).
  useFrame((state, delta) => {
    const cut = control();
    const { eye, last } = cut;
    state.camera.getWorldPosition(eye);
    if (cut.dirty || !eye.equals(last)) {
      decideCut(garage.cut.structure, eye, protect, GARAGE.cut.wallBand, cut.state);
      last.copy(eye);
      cut.dirty = false;
      const current = useRenderStats.getState().cut;
      if (current === null || current.hidden !== cut.state.count || current.vehicle !== protect.vehicle) {
        useRenderStats.setState({ cut: { hidden: cut.state.count, total: garage.cut.structure.count, vehicle: protect.vehicle } });
      }
    }
    // Fondu seulement si ses variantes sont prêtes ; sinon la coupe bascule d'un coup.
    const dither = ditherRef.current;
    dither.frames += 1;
    const fading = dither.ready && !instantCut;
    const step = cut.snap || !fading ? 1 : (Math.min(delta, MAX_FADE_STEP_S) * 1000) / GARAGE.cut.fadeMs;
    cut.snap = false;
    const moving = stepFades(garage.cut.fades, cut.state.hidden, step);
    // Trame posée sur les seuls matériaux dont un élément est en fondu, retirée dès sa fin.
    const active = garage.cut.dither.apply(fading);
    if (active !== dither.active) {
      dither.active = active;
      publishDither(dither, garage.cut.dither.carriers.length);
    }
    if (moving) state.invalidate();
  }, CUT_PRIORITY);
  useFrame((state) => {
    const dither = ditherRef.current;
    const programs = state.gl.info.programs?.length ?? 0;
    if (programs === dither.programs) return;
    dither.programs = programs;
    useRenderStats.setState({ programs });
  }, PROGRAMS_PRIORITY);

  return <primitive object={garage.root} />;
}
