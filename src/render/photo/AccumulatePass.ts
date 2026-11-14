// Dernière passe du composeur en mode photo : moyenne courante des images décalées (§ 8,
// « Rendu photo »). Elle reçoit l'image finie (étalonnée, anticrénelée) et la mélange dans sa
// cible avec le poids 1 / (n + 1) (src/render/photo/accumulate.ts), puis montre la moyenne.
// Hors du mode photo, elle s'efface : elle ne dessine rien et laisse l'image passer.

import { CopyMaterial, Pass } from 'postprocessing';
import {
  HalfFloatType,
  NormalBlending,
  ShaderMaterial,
  Uniform,
  UnsignedByteType,
  WebGLRenderTarget,
  type Texture,
  type TextureDataType,
  type WebGLRenderer,
} from 'three';

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

// L'alpha porte le poids : mélange normal, résultat = image × poids + moyenne × (1 − poids).
const BLEND_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D inputBuffer;
uniform float weight;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(texture2D(inputBuffer, vUv).rgb, weight);
}
`;

/** off : rien (image vivante) ; add : mélange l'image reçue ; hold : remontre la moyenne. */
export type AccumulateMode = 'off' | 'add' | 'hold';

export class AccumulatePass extends Pass {
  mode: AccumulateMode = 'off';
  /** Poids de l'image reçue dans la moyenne (1 : elle remplace tout). */
  weight = 1;
  private readonly target: WebGLRenderTarget;
  private readonly blend: ShaderMaterial;
  private readonly copy: CopyMaterial;

  constructor() {
    super('AccumulatePass');
    this.target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
    this.target.texture.name = 'Accumulate.Buffer';
    this.blend = new ShaderMaterial({
      name: 'AccumulateBlend',
      vertexShader: VERTEX,
      fragmentShader: BLEND_FRAGMENT,
      uniforms: { inputBuffer: new Uniform<Texture | null>(null), weight: new Uniform(1) },
      blending: NormalBlending,
      // Sans `transparent`, three coupe le mélange normal.
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.copy = new CopyMaterial();
    this.fullscreenMaterial = this.copy;
  }

  /** Règle la passe pour l'image qui vient (appelé chaque image par src/render/photo/PhotoDirector). */
  set(mode: AccumulateMode, weight = 1): void {
    this.mode = mode;
    this.weight = weight;
  }

  override initialize(_renderer: WebGLRenderer, _alpha: boolean, frameBufferType: TextureDataType): void {
    // Sans cible flottante (repli 8 bits du composeur), la moyenne se fait en 8 bits.
    const type = frameBufferType === UnsignedByteType ? UnsignedByteType : HalfFloatType;
    if (this.target.texture.type !== type) {
      this.target.texture.type = type;
      this.target.dispose();
    }
  }

  override setSize(width: number, height: number): void {
    this.target.setSize(width, height);
  }

  override render(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget | null, outputBuffer: WebGLRenderTarget | null): void {
    if (this.mode === 'off' && !this.renderToScreen) {
      // Rien à faire : la passe suivante lit directement l'image reçue.
      this.needsSwap = false;
      return;
    }
    this.needsSwap = true;
    const input = inputBuffer?.texture ?? null;
    if (this.mode === 'add') {
      this.blend.uniforms.inputBuffer!.value = input;
      this.blend.uniforms.weight!.value = this.weight;
      this.fullscreenMaterial = this.blend;
      // Le composeur rend avec l'effacement automatique : il viderait la moyenne.
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setRenderTarget(this.target);
      renderer.render(this.scene, this.camera);
      renderer.autoClear = autoClear;
    }
    this.copy.uniforms.inputBuffer!.value = this.mode === 'off' ? input : this.target.texture;
    this.fullscreenMaterial = this.copy;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  override dispose(): void {
    super.dispose();
    this.target.dispose();
    this.blend.dispose();
    this.copy.dispose();
  }
}
