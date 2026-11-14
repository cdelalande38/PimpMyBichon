// placeholder_speedshape : forme d'essai de peinture, comme celles qu'un carrossier peint pour
// montrer une teinte. Elle tient la place du modèle de banc d'essai (jalon 1) et des véhicules
// (jalon 2 et suivants). Déclarée dans TODO_ASSETS.md : ce n'est pas un véhicule du catalogue.

import { useMemo } from 'react';
import { LatheGeometry, Vector2 } from 'three';

/** Demi-longueur de la forme, pour le cadrage de la caméra. */
export const SPEEDSHAPE_HALF_LENGTH = 1.35;

const LENGTH = 2.3;
const RADIUS = 0.6;
const CENTER_Y = 0.52;

function makeGeometry(): LatheGeometry {
  // Profil en goutte : nez rond, arrière effilé. Tourné autour de son axe, puis couché et aplati.
  const steps = 56;
  const profile: Vector2[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const radius = RADIUS * Math.sin(Math.PI * t ** 0.7) ** 0.8;
    profile.push(new Vector2(Math.max(radius, 1e-4), (t - 0.5) * LENGTH));
  }
  const geometry = new LatheGeometry(profile, 72);
  geometry.rotateZ(-Math.PI / 2);
  geometry.scale(1, 0.6, 0.88);
  geometry.computeVertexNormals();
  return geometry;
}

export function PlaceholderSpeedShape() {
  const geometry = useMemo(() => makeGeometry(), []);
  return (
    <group name="placeholder_speedshape">
      <mesh geometry={geometry} position={[0, CENTER_Y, 0]}>
        {/* Vert Bichon, métallisé sous vernis : un avant-goût, pas la peinture multicouche du jalon 1. */}
        <meshPhysicalMaterial
          color="#0c6f66"
          metalness={0.85}
          roughness={0.42}
          clearcoat={1}
          clearcoatRoughness={0.06}
          envMapIntensity={1.3}
        />
      </mesh>
      <mesh position={[0, 0.09, 0]}>
        <cylinderGeometry args={[0.07, 0.1, 0.18, 24]} />
        <meshStandardMaterial color="#101014" metalness={0.7} roughness={0.38} />
      </mesh>
      <mesh position={[0, 0.012, 0]}>
        <cylinderGeometry args={[0.42, 0.46, 0.024, 48]} />
        <meshStandardMaterial color="#101014" metalness={0.7} roughness={0.38} />
      </mesh>
    </group>
  );
}
