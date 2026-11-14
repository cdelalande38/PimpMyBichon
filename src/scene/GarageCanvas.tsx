// Scène du garage. Chargée à la demande (three.js pèse lourd) : la coque de l'app s'affiche avant.
// Au jalon 1, le modèle de banc d'essai dans le garage du § 4, sous l'ambiance choisie, avec
// sa sonde de réflexion, son sol réfléchissant, son atmosphère et sa chaîne d'image, selon le
// niveau de qualité (src/render/quality.ts). Tout est servi par l'app : modèle, textures KTX2 et
// transcodeur ; les textures du garage sont dessinées sur place.
// Vue de départ : le véhicule nez à gauche, la caméra côté gauche (trois quarts avant), le mur
// du fond et ses halos, le mur rouge à droite : la signature du lieu.

import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { VignetteEffect } from 'postprocessing';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SceneBoundary } from '../app/SceneBoundary.tsx';
import { useMediaQuery } from '../app/useMediaQuery.ts';
import { ambiance as findAmbiance } from '../data/ambiances.ts';
import { BENCH_MODEL } from '../data/bench.ts';
import { GARAGE } from '../data/garage.ts';
import { CAMERA_LAYERS } from '../render/layers.ts';
import { AccumulatePass } from '../render/photo/AccumulatePass.ts';
import { frontFromTurn } from '../render/photo/framing.ts';
import { PhotoDirector } from '../render/photo/PhotoDirector.tsx';
import { photoPlan } from '../render/photo/plan.ts';
import { PostChain } from '../render/PostChain.tsx';
import { QUALITY_PROFILES, resolveQuality, type QualityLevel, type QualityProfile } from '../render/quality.ts';
import { ReflectionProbe } from '../render/ReflectionProbe.tsx';
import { useRenderStats } from '../render/renderStats.ts';
import { useBench } from '../state/bench.ts';
import { usePhoto } from '../state/photo.ts';
import { useSettings } from '../state/store.ts';
import { AutoQuality } from './AutoQuality.tsx';
import { BenchCar, type BenchMeasure } from './bench/BenchCar.tsx';
import { fitCamera, orbitPosition } from './fit.ts';
import { FrameMeter } from './FrameMeter.tsx';
import { Garage } from './garage/Garage.tsx';
import { SceneProbe } from './SceneProbe.tsx';

/** Cible de l'orbite : sous le centre du véhicule, pour le remonter au-dessus du dock. */
const TARGET: [number, number, number] = [0, 0.12, 0];
/** Angle vertical borné (§ 5.1) : ni sous le sol, ni à la verticale. */
const MIN_POLAR = 0.55;
const MAX_POLAR = 1.52;
/**
 * Marge de cadrage : vue de trois quarts, un véhicule paraît plus long que de profil
 * (sa largeur s'ajoute, l'avant est plus près). Il doit tenir dans la largeur avec un peu d'air.
 */
const FRAME_MARGIN = 1.22;
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
}

/** Sens de l'avant du véhicule dans la pièce : les cadrages photo en dépendent. */
const FRONT_X = frontFromTurn(GARAGE.vehicle.turn);

function Stage({ level, profile, mayRotate, photo, autoLevel, floatTargets }: StageProps) {
  const width = useThree((state) => state.size.width);
  const height = useThree((state) => state.size.height);
  // Cadrage d'attente, puis cadrage sur la demi-longueur mesurée une fois le modèle posé.
  const [halfLength, setHalfLength] = useState(BENCH_MODEL.halfLengthHint);
  const onMeasured = useCallback((measure: BenchMeasure) => setHalfLength(measure.halfLength), []);
  const fit = useMemo(() => fitCamera(width, height, halfLength * FRAME_MARGIN), [width, height, halfLength]);

  // Ambiance : sources, lumières et étalonnage. La sonde de réflexion se refait à chaque changement.
  const ambiance = findAmbiance(useBench((state) => state.ambiance));
  const setStatus = useBench((state) => state.setStatus);
  const position = useMemo(() => orbitPosition(TARGET, fit.distance), [fit.distance]);
  const home = useMemo(() => ({ position, target: TARGET, fov: fit.fov }), [position, fit.fov]);

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
  // La mesure de cadence de « Sous le capot » fait tourner la scène elle aussi.
  const measuring = useRenderStats((state) => state.meter.running);
  const exporting = usePhoto((state) => state.save.status === 'rendu');
  const rotating = (mayRotate && idle) || measuring;
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

  return (
    <>
      {/* Fond et brume : le sol et le plafond prolongés s'y perdent, jamais dans le noir. */}
      <color attach="background" args={[ambiance.night]} />
      {profile.atmosphere && <fog attach="fog" args={[ambiance.night, GARAGE.fog.near, GARAGE.fog.far]} />}

      <PerspectiveCamera makeDefault fov={fit.fov} near={0.1} far={80} position={position} />
      <OrbitControls
        makeDefault
        target={TARGET}
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        minDistance={fit.minDistance}
        maxDistance={fit.maxDistance}
        minPolarAngle={MIN_POLAR}
        maxPolarAngle={MAX_POLAR}
        autoRotate={rotating}
        autoRotateSpeed={0.9}
        onStart={() => {
          window.clearTimeout(idleTimer.current);
          setIdle(false);
        }}
        onEnd={() => {
          window.clearTimeout(idleTimer.current);
          idleTimer.current = window.setTimeout(() => setIdle(true), IDLE_DELAY_MS);
        }}
      />

      <Garage ambiance={ambiance} profile={profile} />
      {/* En photo, la sonde passe en haute résolution (src/render/photo/plan.ts). */}
      <ReflectionProbe size={photo ? plan.probeSize : profile.probeSize} position={GARAGE.probe} version={ambiance.id} epoch={epoch} />
      {/* Le modèle arrive après le décor ; s'il manque (première visite sans réseau), le garage
          reste et l'étiquette le dit. */}
      {/* Pose du véhicule dans la pièce (nez à gauche) : on tourne son groupe, pas le modèle. */}
      <group rotation-y={GARAGE.vehicle.turn}>
        <SceneBoundary onFail={() => setStatus('erreur')}>
          <Suspense fallback={null}>
            <BenchCar model={BENCH_MODEL} onMeasured={onMeasured} bodyEnv={ambiance.bodyEnv} />
          </Suspense>
        </SceneBoundary>
      </group>

      <PostChain ambiance={ambiance} profile={profile} accumulate={accumulate} vignette={vignette} floatTargets={floatTargets} />
      {photo && (
        <PhotoDirector
          pass={accumulate}
          vignette={vignette}
          plan={plan}
          fov={fit.fov}
          distance={fit.distance}
          target={TARGET}
          halfLength={halfLength}
          frontX={FRONT_X}
          home={home}
        />
      )}

      <SceneProbe />
      <AutoQuality enabled={autoLevel && !measuring && !exporting} />
      <FrameMeter level={level} />
    </>
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
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const autoLevel = useRenderStats((state) => state.auto.level);
  const floatTargets = useRenderStats((state) => state.floatTargets) !== false;
  const exporting = usePhoto((state) => state.save.status === 'rendu');
  const level = resolveQuality(quality, autoLevel, floatTargets);
  const profile = QUALITY_PROFILES[level];

  return (
    <div
      className="stage"
      role="img"
      data-bench={benchStatus}
      data-quality={level}
      data-busy={exporting}
      aria-label="Vue 3D du garage, avec le modèle de banc d’essai. Glisse pour tourner autour, pince pour zoomer."
    >
      <Canvas
        // Rendu à la demande : quand rien ne bouge, le téléphone ne calcule rien (§ 8, budgets).
        frameloop="demand"
        dpr={[1, profile.dprMax]}
        // Tout passe par le composeur et ses cibles : le canvas n'a besoin ni de MSAA, ni de
        // profondeur, ni de stencil (mémoire graphique, § 8).
        gl={{ antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' }}
        onCreated={({ gl, invalidate }) => {
          useRenderStats.setState({ floatTargets: hasFloatTargets(gl) });
          watchContext(gl.domElement, () => invalidate());
        }}
      >
        <Stage
          level={level}
          profile={profile}
          mayRotate={autoRotate && !reducedMotion && !paused && !photo}
          photo={photo}
          autoLevel={quality === 'auto'}
          floatTargets={floatTargets}
        />
      </Canvas>
    </div>
  );
}
