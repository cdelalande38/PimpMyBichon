// Scène du garage. Chargée à la demande (three.js pèse lourd) : la coque de l'app s'affiche avant.
// Au jalon 1, le modèle de banc d'essai dans le garage du § 4, sous l'ambiance choisie, avec
// sa sonde de réflexion et sa chaîne d'image. Tout est servi par l'app : modèle, textures KTX2
// et transcodeur ; les textures du garage sont dessinées sur place.

import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SceneBoundary } from '../app/SceneBoundary.tsx';
import { useMediaQuery } from '../app/useMediaQuery.ts';
import { ambiance as findAmbiance } from '../data/ambiances.ts';
import { BENCH_MODEL } from '../data/bench.ts';
import { GARAGE } from '../data/garage.ts';
import { PostChain } from '../render/PostChain.tsx';
import { QUALITY_PROFILES, resolveQuality, type QualityProfile } from '../render/quality.ts';
import { ReflectionProbe } from '../render/ReflectionProbe.tsx';
import { useBench } from '../state/bench.ts';
import { useSettings } from '../state/store.ts';
import { BenchCar, type BenchMeasure } from './bench/BenchCar.tsx';
import { fitCamera, orbitPosition } from './fit.ts';
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
  profile: QualityProfile;
  /** Rotation lente autorisée (réglage, mouvement réduit, panneau ouvert). */
  mayRotate: boolean;
}

function Stage({ profile, mayRotate }: StageProps) {
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

  // La rotation lente s'efface dès qu'on touche, et reprend après un moment de calme.
  const [idle, setIdle] = useState(true);
  const idleTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(idleTimer.current), []);

  // Rendu à la demande : tant que la rotation lente est due, chaque image en demande une autre.
  // Sans cela elle ne repartirait pas après un geste, les contrôles n'émettant plus rien au repos.
  const rotating = mayRotate && idle;
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    if (rotating) invalidate();
  }, [rotating, invalidate]);
  useFrame(() => {
    if (rotating) invalidate();
  });

  return (
    <>
      <color attach="background" args={[ambiance.night]} />

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

      <Garage ambiance={ambiance} />
      <ReflectionProbe size={profile.probeSize} position={GARAGE.probe} version={ambiance.id} />
      {/* Le modèle arrive après le décor ; s'il manque (première visite sans réseau), le garage
          reste et l'étiquette le dit. */}
      <SceneBoundary onFail={() => setStatus('erreur')}>
        <Suspense fallback={null}>
          <BenchCar model={BENCH_MODEL} onMeasured={onMeasured} />
        </Suspense>
      </SceneBoundary>

      <PostChain ambiance={ambiance} profile={profile} />

      <SceneProbe />
    </>
  );
}

export interface GarageCanvasProps {
  /** Un panneau recouvre la scène : on arrête la rotation, donc le rendu. */
  paused: boolean;
}

export default function GarageCanvas({ paused }: GarageCanvasProps) {
  const quality = useSettings((state) => state.quality);
  const autoRotate = useSettings((state) => state.autoRotate);
  const benchStatus = useBench((state) => state.status);
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const profile = QUALITY_PROFILES[resolveQuality(quality)];

  return (
    <div
      className="stage"
      role="img"
      data-bench={benchStatus}
      aria-label="Vue 3D du garage, avec le modèle de banc d’essai. Glisse pour tourner autour, pince pour zoomer."
    >
      <Canvas
        // Rendu à la demande : quand rien ne bouge, le téléphone ne calcule rien (§ 8, budgets).
        frameloop="demand"
        dpr={[1, profile.dprMax]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
      >
        <Stage profile={profile} mayRotate={autoRotate && !reducedMotion && !paused} />
      </Canvas>
    </div>
  );
}
