// Scène du garage. Chargée à la demande (three.js pèse lourd) : la coque de l'app s'affiche avant.
// Au jalon 0, elle ne montre que des substituts déclarés ; elle prouve que la chaîne 3D
// (WebGL 2, React Three Fiber, post-traitement) tourne sur le téléphone, sans rien télécharger d'ailleurs.

import { ContactShadows, OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMediaQuery } from '../app/useMediaQuery.ts';
import { QUALITY_PROFILES, resolveQuality, type QualityProfile } from '../render/quality.ts';
import { useSettings } from '../state/store.ts';
import { createGarageEnvironment } from './environment.ts';
import { fitCamera, orbitPosition } from './fit.ts';
import { PlaceholderGarage } from './PlaceholderGarage.tsx';
import { PlaceholderSpeedShape, SPEEDSHAPE_HALF_LENGTH } from './PlaceholderSpeedShape.tsx';
import { SceneProbe } from './SceneProbe.tsx';

/** Cible de l'orbite : sous le centre de la forme, pour la remonter au-dessus du dock. */
const TARGET: [number, number, number] = [0, 0.12, 0];
/** Angle vertical borné (§ 5.1) : ni sous le sol, ni à la verticale. */
const MIN_POLAR = 0.55;
const MAX_POLAR = 1.52;
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
  const fit = useMemo(
    () => fitCamera(width, height, SPEEDSHAPE_HALF_LENGTH),
    [width, height],
  );
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
      <color attach="background" args={['#06050b']} />
      <fog attach="fog" args={['#06050b', fit.distance + 3, fit.distance + 30]} />

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

      <PlaceholderGarage />
      <PlaceholderSpeedShape />
      {/* À laisser à y = 0 : surélevée, son plan de flou passe derrière sa caméra et l'ombre
          disparaît dès que le post-traitement est coupé (niveau économie). */}
      <ContactShadows
        scale={6}
        far={1.4}
        blur={2.4}
        opacity={0.75}
        resolution={256}
        frames={1}
      />

      {profile.bloom && (
        <EffectComposer multisampling={profile.multisampling}>
          <Bloom mipmapBlur luminanceThreshold={1} luminanceSmoothing={0.2} intensity={0.9} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      )}

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
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const profile = QUALITY_PROFILES[resolveQuality(quality)];

  return (
    <div
      className="stage"
      role="img"
      aria-label="Vue 3D du garage, avec une forme d’essai de peinture. Glisse pour tourner autour, pince pour zoomer."
    >
      <Canvas
        // Rendu à la demande : quand rien ne bouge, le téléphone ne calcule rien (§ 8, budgets).
        frameloop="demand"
        dpr={[1, profile.dprMax]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ gl, scene, invalidate }) => {
          scene.environment = createGarageEnvironment(gl);
          invalidate();
        }}
      >
        <Stage profile={profile} mayRotate={autoRotate && !reducedMotion && !paused} />
      </Canvas>
    </div>
  );
}
