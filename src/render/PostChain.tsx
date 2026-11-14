// Chaîne d'image (§ 8, étalonnage) : occlusion ambiante en espace écran (max), bloom sélectif
// sur les émissifs (seuil au-dessus du blanc : seules les sources et leurs reflets brillent),
// exposition de l'ambiance, tone mapping filmique, table de correspondance des couleurs
// fabriquée en code pour l'ambiance (src/render/lut.ts), vignettage léger, grain discret,
// anticrénelage (SMAA, dans sa propre passe), puis la moyenne du rendu photo. Ce que chaque
// niveau garde : src/render/quality.ts.

import { Bloom, EffectComposer, EffectGroup, LUT, N8AO, Noise, SMAA, ToneMapping, Vignette, wrapEffect } from '@react-three/postprocessing';
import { BlendFunction, Effect, LookupTexture, ToneMappingMode, type VignetteEffect } from 'postprocessing';
import { useEffect, useMemo, type ReactElement, type RefObject } from 'react';
import { HalfFloatType, Uniform, UnsignedByteType } from 'three';
import type { Ambiance } from '../data/ambiances.ts';
import { gradeLutData, type Grade } from './lut.ts';
import type { AccumulatePass } from './photo/AccumulatePass.ts';
import type { QualityProfile } from './quality.ts';

/** Côté de la table de correspondance : 16³ suffit, l'interpolation tétraédrique lisse le reste. */
const LUT_SIZE = 16;

const EXPOSURE_SHADER = /* glsl */ `
uniform float exposure;
void mainImage( const in vec4 inputColor, const in vec2 uv, out vec4 outputColor ) {
  outputColor = vec4( inputColor.rgb * exposure, inputColor.a );
}
`;

/** Exposition, en lumière linéaire, avant le tone mapping. */
export class ExposureEffect extends Effect {
  constructor({ exposure = 1 }: { exposure?: number } = {}) {
    super('ExposureEffect', EXPOSURE_SHADER, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, Uniform>([['exposure', new Uniform(exposure)]]),
    });
  }

  get exposure(): number {
    return (this.uniforms.get('exposure') as Uniform<number>).value;
  }

  set exposure(value: number) {
    (this.uniforms.get('exposure') as Uniform<number>).value = value;
  }
}

const Exposure = wrapEffect(ExposureEffect);

function gradeLut(grade: Grade): LookupTexture {
  const lut = LookupTexture.createNeutral(LUT_SIZE);
  (lut.image.data as Float32Array).set(gradeLutData(grade, LUT_SIZE));
  lut.needsUpdate = true;
  return lut;
}

export interface PostChainProps {
  ambiance: Ambiance;
  profile: QualityProfile;
  /** Moyenne du rendu photo, en dernière passe (inactive hors du mode photo). */
  accumulate: AccumulatePass;
  /** L'image enregistrée, rendue en tuiles, coupe le vignettage et le refait en entier. */
  vignette: RefObject<VignetteEffect | null>;
  /** Sans cibles flottantes, le composeur travaille en 8 bits. */
  floatTargets: boolean;
}

export function PostChain({ ambiance, profile, accumulate, vignette, floatTargets }: PostChainProps) {
  const { grade } = ambiance;
  const lut = useMemo(() => gradeLut(grade), [grade]);
  useEffect(() => () => lut.dispose(), [lut]);

  const effects = [
    profile.ao && <N8AO key="ao" quality="low" halfRes aoRadius={0.9} distanceFalloff={0.6} intensity={2.2} />,
    profile.bloom && (
      <Bloom key="bloom" mipmapBlur luminanceThreshold={1} luminanceSmoothing={0.15} intensity={ambiance.bloom} radius={0.72} />
    ),
    <Exposure key="exposure" exposure={ambiance.exposure} />,
    <ToneMapping key="tone" mode={ToneMappingMode.ACES_FILMIC} />,
    <LUT key="lut" lut={lut} tetrahedralInterpolation />,
    <Vignette key="vignette" ref={vignette} offset={0.32} darkness={0.42} />,
  ].filter((effect): effect is ReactElement => effect !== false);
  const grain = <Noise key="grain" premultiply blendFunction={BlendFunction.SCREEN} opacity={0.22} />;

  return (
    // Un composeur neuf à chaque niveau : le MSAA de sa cible ne se change pas en route.
    <EffectComposer
      key={`${profile.multisampling}-${profile.ao}-${profile.bloom}-${profile.smaa}-${floatTargets}`}
      multisampling={profile.multisampling}
      frameBufferType={floatTargets ? HalfFloatType : UnsignedByteType}
    >
      {effects}
      {/* SMAA dans sa propre passe : fusionné avec l'étalonnage, il rendrait aux pixels de bord
          la couleur brute de la scène (ni bloom, ni tone mapping, ni table). Le grain vient après. */}
      {profile.smaa ? (
        <EffectGroup>
          <SMAA />
          {grain}
        </EffectGroup>
      ) : (
        grain
      )}
      <primitive object={accumulate} dispose={null} />
    </EffectComposer>
  );
}
