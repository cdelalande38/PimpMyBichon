// placeholder_garage : décor minimal (sol, mur du fond, deux tubes néon) en attendant le garage
// du § 4. Déclaré dans TODO_ASSETS.md. Il reprend seulement la signature lumineuse du lieu,
// aux couleurs de l'ambiance choisie (src/data/ambiances.ts).

import { useMemo } from 'react';
import { Color } from 'three';
import type { Ambiance } from '../data/ambiances.ts';

const WALL_Z = -4.6;

function NeonTube({ color, gain, x }: { color: string; gain: number; x: number }) {
  // Couleur au-delà de 1 : c'est ce qui déclenche le bloom sur les sources émissives.
  const hdr = useMemo(() => new Color(color).multiplyScalar(gain), [color, gain]);
  return (
    <mesh position={[x, 2.55, WALL_Z + 0.08]}>
      <boxGeometry args={[4.6, 0.07, 0.07]} />
      <meshBasicMaterial color={hdr} />
    </mesh>
  );
}

export function PlaceholderGarage({ ambiance }: { ambiance: Ambiance }) {
  return (
    <group name="placeholder_garage">
      {/* Sol 2 cm sous le zéro : l'ombre de contact se pose à y = 0 sans scintiller dessus. */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, 0]}>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial color="#24212d" roughness={0.24} metalness={0.25} />
      </mesh>
      <mesh position={[0, 2.4, WALL_Z]}>
        <planeGeometry args={[40, 4.8]} />
        <meshStandardMaterial color="#2b2834" roughness={0.9} metalness={0} />
      </mesh>
      <NeonTube color={ambiance.left} gain={ambiance.tubeGain} x={-2.7} />
      <NeonTube color={ambiance.right} gain={ambiance.tubeGain} x={2.7} />

      <hemisphereLight color={ambiance.sky} groundColor={ambiance.ground} intensity={ambiance.ambient} />
      <pointLight color={ambiance.left} intensity={ambiance.sideIntensity} decay={2} position={[-4.6, 2.8, -2.2]} />
      <pointLight color={ambiance.right} intensity={ambiance.sideIntensity} decay={2} position={[4.6, 2.8, -2.2]} />
      <spotLight
        color={ambiance.key}
        intensity={ambiance.keyIntensity}
        decay={2}
        angle={0.62}
        penumbra={0.85}
        position={[2.5, 6.5, 5.5]}
      />
    </group>
  );
}
