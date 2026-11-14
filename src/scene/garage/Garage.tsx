// Le garage du § 4, construit d'après src/data/garage.ts, sous l'ambiance choisie.
// Remplace placeholder_garage ; le mobilier reste en volumes simples (placeholder_*).
// Il porte aussi la réflexion planaire de son sol, son atmosphère, selon le niveau de qualité,
// et la coupe caméra : ce qui passerait entre l'œil et le véhicule quitte l'image (cut.ts).

import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Vector3 } from 'three';
import type { Ambiance } from '../../data/ambiances.ts';
import { GARAGE } from '../../data/garage.ts';
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
  const garage = useMemo(() => createGarage(GARAGE), []);
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
      useRenderStats.setState({ cut: null });
    },
    [],
  );

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
    const step = cut.snap || instantCut ? 1 : (Math.min(delta, MAX_FADE_STEP_S) * 1000) / GARAGE.cut.fadeMs;
    cut.snap = false;
    if (stepFades(garage.cut.fades, cut.state.hidden, step)) state.invalidate();
  }, CUT_PRIORITY);

  return <primitive object={garage.root} />;
}
