// Chaîne d'image (§ 8, étalonnage) : bloom sélectif sur les émissifs (seuil au-dessus du blanc :
// seules les sources et leurs reflets brillent), tone mapping filmique, dominante de l'ambiance,
// vignettage léger, grain discret, SMAA. Coupée au niveau économie.

import { Bloom, EffectComposer, Noise, SMAA, ToneMapping, Vignette, wrapEffect } from '@react-three/postprocessing';
import { BlendFunction, Effect, ToneMappingMode } from 'postprocessing';
import { Color, Uniform } from 'three';
import type { Ambiance } from '../data/ambiances.ts';
import type { QualityProfile } from './quality.ts';

const GRADE_SHADER = /* glsl */ `
uniform vec3 shadows;
uniform vec3 highlights;
uniform float amount;

void mainImage( const in vec4 inputColor, const in vec2 uv, out vec4 outputColor ) {
  vec3 color = inputColor.rgb;
  float luma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
  // Ombres vers une teinte, hautes lumières vers l'autre, à luminosité à peu près constante.
  vec3 tint = mix( shadows, highlights, smoothstep( 0.04, 0.6, luma ) );
  vec3 toned = color * tint / max( dot( tint, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-3 );
  // Les noirs se relèvent à peine vers la dominante des ombres.
  toned += shadows * 0.025 * ( 1.0 - smoothstep( 0.0, 0.2, luma ) );
  outputColor = vec4( mix( color, toned, amount ), inputColor.a );
}
`;

/** Dominante de couleur par ambiance : ombres et hautes lumières teintées séparément. */
export class GradeEffect extends Effect {
  constructor({ shadows = '#808080', highlights = '#808080', amount = 0 }: { shadows?: string; highlights?: string; amount?: number } = {}) {
    super('GradeEffect', GRADE_SHADER, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['shadows', new Uniform(new Color(shadows))],
        ['highlights', new Uniform(new Color(highlights))],
        ['amount', new Uniform(amount)],
      ]),
    });
  }

  private uniform<T>(name: string): Uniform<T> {
    return this.uniforms.get(name) as Uniform<T>;
  }

  get shadows(): Color {
    return this.uniform<Color>('shadows').value;
  }

  get highlights(): Color {
    return this.uniform<Color>('highlights').value;
  }

  get amount(): number {
    return this.uniform<number>('amount').value;
  }

  set amount(value: number) {
    this.uniform<number>('amount').value = value;
  }
}

const Grade = wrapEffect(GradeEffect);

export interface PostChainProps {
  ambiance: Ambiance;
  profile: QualityProfile;
}

export function PostChain({ ambiance, profile }: PostChainProps) {
  if (!profile.post) return null;
  const { grade } = ambiance;
  return (
    <EffectComposer multisampling={profile.multisampling}>
      <Bloom mipmapBlur luminanceThreshold={1} luminanceSmoothing={0.15} intensity={ambiance.bloom} radius={0.72} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Grade shadows={grade.shadows} highlights={grade.highlights} amount={grade.amount} />
      <Vignette offset={0.3} darkness={0.5} />
      <Noise premultiply blendFunction={BlendFunction.SCREEN} opacity={0.32} />
      <SMAA />
    </EffectComposer>
  );
}
