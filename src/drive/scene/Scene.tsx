// Scène de la sortie de nuit (§ 5.5, lot 1 sur rail) : décor de la carte au fil de la route, ciel,
// brume et pluie, véhicule posé sur le rail, sonde de réflexion mobile, reflet planaire de la
// chaussée, chaîne d'image. La boucle elle-même vit dans le moteur (moteur.ts) : à chaque image,
// le pilote avance (src/drive/pilote.ts), le rail donne la pose (src/drive/rail.ts), la caméra prend
// son plan (src/drive/cameras.ts, ou le réalisateur, src/drive/realisateur.ts), la télémétrie part
// quatre fois par seconde au plus (src/state/drive.ts). Contrat : src/drive/contrat.ts.

import { useFrame, useThree } from '@react-three/fiber';
import type { VignetteEffect } from 'postprocessing';
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { PerspectiveCamera, Scene as ThreeScene } from 'three';
import { SceneBoundary } from '../../app/SceneBoundary.tsx';
import { loadRoute, mapFileUrl } from '../../data/maps.ts';
import type { MapManifest, MapRoute } from '../../data/mapTypes.ts';
import type { VehicleManifest } from '../../data/vehicleTypes.ts';
import { AccumulatePass } from '../../render/photo/AccumulatePass.ts';
import { PostChain } from '../../render/PostChain.tsx';
import { QUALITY_PROFILES, type QualityLevel } from '../../render/quality.ts';
import { useDrive } from '../../state/drive.ts';
import { driveDebug } from './debug.ts';
import { DriveEngine } from './moteur.ts';
import { bodyEnvOf, sortieAmbiance } from './nuit.ts';
import { DriveVehicle, type DriveModel } from './vehicule.tsx';
import { DriveAdversaire, type ModeleAdversaire } from './adversaire.tsx';

export interface DriveSceneProps {
  map: MapManifest;
  vehicle: VehicleManifest;
  level: QualityLevel;
  floatTargets: boolean;
  /** Élément racine (classe drive-stage) : attributs data- pour les parcours. */
  stage: RefObject<HTMLDivElement | null>;
}

/**
 * Route de la carte, par le chargeur partagé avec le menu (src/data/maps.ts : chargée et validée une
 * fois par séance) ; `failed` si elle ne vient pas (carte absente, hors ligne à la première sortie).
 */
function useRoute(map: MapManifest): { route: MapRoute | null; failed: boolean } {
  const [state, setState] = useState<{ route: MapRoute | null; failed: boolean }>({ route: null, failed: false });
  useEffect(() => {
    let alive = true;
    loadRoute(map)
      .then((route) => {
        if (alive) setState({ route, failed: false });
      })
      .catch(() => {
        if (alive) setState({ route: null, failed: true });
      });
    return () => {
      alive = false;
    };
  }, [map]);
  return state;
}

export function DriveScene({ map, vehicle, level, floatTargets, stage }: DriveSceneProps) {
  const scene = useThree((state) => state.scene) as ThreeScene;
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const quality = QUALITY_PROFILES[level];
  const base = mapFileUrl(map, '');
  const { route, failed } = useRoute(map);
  const engine = useMemo(() => (route ? new DriveEngine(base, route, level, vehicle) : null), [base, route, level, vehicle]);
  // Moment et météo (src/data/moments.ts) : étalonnage de l'image et reflet sur la carrosserie. Le
  // ciel, ses lumières et les matières suivent dans le moteur, en fondu.
  const moment = useDrive((state) => state.moment);
  const weather = useDrive((state) => state.weather);
  const ambiance = sortieAmbiance(moment, weather);
  const bodyEnv = bodyEnvOf(moment, weather);

  const setDpr = useThree((state) => state.setDpr);
  useLayoutEffect(() => {
    if (!engine) return undefined;
    engine.attach(scene, camera);
    engine.whenDegraded(() => {
      setDpr(1);
      stage.current?.setAttribute('data-allegee', 'oui');
    });
    return () => engine.dispose();
  }, [engine, scene, camera, setDpr, stage]);

  // Départ : celui choisi (MapStart.id), sinon le premier ; repris si l'interface en change.
  useEffect(() => {
    if (!engine) return undefined;
    engine.start(useDrive.getState().start);
    return useDrive.subscribe((state, previous) => {
      if (state.start !== previous.start) engine.start(state.start);
    });
  }, [engine]);

  // En pause, la scène est rendue à la demande : un changement de l'état (caméra, orbite, météo) redessine.
  useEffect(() => useDrive.subscribe(() => invalidate()), [invalidate]);

  // Échec du chargement de la route : dit tout de suite, sans attendre une boucle.
  useEffect(() => {
    if (!failed) return;
    stage.current?.setAttribute('data-sortie', 'erreur');
    useDrive.getState().fail();
  }, [failed, stage]);

  // Prises de diagnostic (page d'aperçu, captures).
  useEffect(() => {
    if (!engine) return undefined;
    driveDebug.seek = (s: number) => engine.seek(s);
    driveDebug.settled = () => engine.settled();
    driveDebug.measure = () => engine.measure(gl, scene, camera);
    driveDebug.scene = scene;
    driveDebug.uniforms = engine.uniforms;
    driveDebug.camera = camera;
    driveDebug.relief = engine.relief;
    return () => {
      delete driveDebug.seek;
      delete driveDebug.measure;
      delete driveDebug.settled;
      delete driveDebug.scene;
      delete driveDebug.uniforms;
      delete driveDebug.camera;
      delete driveDebug.relief;
    };
  }, [engine, gl, scene, camera]);

  const onModel = useCallback((model: DriveModel | null) => engine?.setModel(model), [engine]);
  const onVehicleFail = useCallback(() => engine?.vehicleFailedNow(), [engine]);
  // Duel : un modèle d'adversaire tombé ne bloque pas la course (il court, invisible).
  const onAdversaire = useCallback((model: ModeleAdversaire | null) => engine?.setAdversaire(model), [engine]);
  const onAdversaireFail = useCallback(() => engine?.adversaireAbsent(), [engine]);

  // Temps arrêté (diagnostic) : l'image est rendue, rien ne bouge.
  const frozenAt = useRef(-1);
  useFrame((state, delta) => {
    const frozen = driveDebug.figer === true;
    if (frozen && frozenAt.current < 0) frozenAt.current = state.clock.elapsedTime;
    if (!frozen) frozenAt.current = -1;
    engine?.frame(state.gl, state.scene, state.camera as PerspectiveCamera, frozen ? 0 : delta, frozen ? frozenAt.current : state.clock.elapsedTime, stage.current);
  });
  // Avant la boucle de la scène (priorité négative) : chronomètre du processeur graphique (diagnostic).
  useFrame((state) => driveDebug.beforeFrame?.(state.gl), -1);
  // Après l'image composée (priorité 2, après la chaîne d'image) : lecture des pixels (diagnostic).
  useFrame((state) => driveDebug.afterFrame?.(state.gl), 2);

  const accumulate = useMemo(() => new AccumulatePass(), []);
  useEffect(() => () => accumulate.dispose(), [accumulate]);
  const vignette = useRef<VignetteEffect>(null);
  // Impression de vitesse : les bords de l'image s'assombrissent un peu avec la vitesse (un uniforme
  // de la passe déjà là, aucun coût).
  useFrame(() => {
    const v = vignette.current;
    if (!v || !engine) return;
    const f = engine.speedFactor;
    const darkness = 0.42 + 0.22 * f * f;
    if (Math.abs(v.darkness - darkness) > 0.002) v.darkness = darkness;
  });

  return (
    <>
      {engine && (
        <SceneBoundary key={vehicle.id} onFail={onVehicleFail}>
          <Suspense fallback={null}>
            <DriveVehicle vehicle={vehicle} rig={engine.rig} bodyEnv={bodyEnv} beams={engine.profile.beams} onModel={onModel} />
          </Suspense>
        </SceneBoundary>
      )}
      {engine?.duel && engine.duelRig && (
        <SceneBoundary key={`adversaire-${engine.duel.adversaire.id}`} onFail={onAdversaireFail}>
          <Suspense fallback={null}>
            <DriveAdversaire duel={engine.duel} rig={engine.duelRig} bodyEnv={bodyEnv} onModel={onAdversaire} />
          </Suspense>
        </SceneBoundary>
      )}
      <PostChain ambiance={ambiance} profile={quality} accumulate={accumulate} vignette={vignette} floatTargets={floatTargets} />
    </>
  );
}
