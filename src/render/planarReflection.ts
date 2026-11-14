// Réflexion planaire du sol (§ 8) : la scène vue par une caméra symétrique sous le plan du sol,
// rendue dans une cible à une fraction de la taille de l'image (demi en standard, pleine en
// max), puis floutée deux fois à demi-taille, plus fort à la verticale (traînées).
// Coût : un rendu de scène de plus, et quatre petites passes plein écran, à chaque image rendue
// (le rendu reste à la demande : rien au repos). Les objets du calque 1 (atmosphère) n'y sont pas.

import {
  BufferGeometry,
  Float32BufferAttribute,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type Camera,
  type Object3D,
  type Texture,
  type WebGLRenderer,
} from 'three';
import type { SurfaceUniforms } from './floor.ts';

const BLUR_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;

// Flou gaussien à 9 points en 5 lectures (filtrage linéaire).
const BLUR_FRAGMENT = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 uDirection;
varying vec2 vUv;
void main() {
  vec3 sum = texture2D( tInput, vUv ).rgb * 0.227027;
  sum += ( texture2D( tInput, vUv + uDirection * 1.384615 ).rgb + texture2D( tInput, vUv - uDirection * 1.384615 ).rgb ) * 0.316216;
  sum += ( texture2D( tInput, vUv + uDirection * 3.230769 ).rgb + texture2D( tInput, vUv - uDirection * 3.230769 ).rgb ) * 0.070270;
  gl_FragColor = vec4( sum, 1.0 );
}`;

/** Rayons du flou, en texels de la cible floue : [horizontal, vertical] par itération. */
const BLUR_STEPS: ReadonlyArray<readonly [number, number]> = [
  [1, 2],
  [2, 4.5],
];

function target(): WebGLRenderTarget {
  return new WebGLRenderTarget(1, 1, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
}

export class PlanarReflection {
  private readonly sharp = new WebGLRenderTarget(1, 1, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter });
  private readonly ping = target();
  private readonly pong = target();
  private readonly virtual = new PerspectiveCamera();
  private readonly quad: Mesh<BufferGeometry, ShaderMaterial>;
  private readonly quadScene = new Scene();
  private readonly quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly size = new Vector2();
  private readonly plane = new Plane();
  private readonly clip = new Vector4();
  private readonly q = new Vector4();
  private readonly bias = new Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  private readonly v = { camera: new Vector3(), look: new Vector3(), target: new Vector3(), up: new Vector3() };

  /** Taille de la cible nette, en pixels (pour les relevés). */
  readonly measured = { width: 0, height: 0 };

  /** Fraction de la taille de l'image (0,5 : demi-résolution). */
  private readonly scale: number;
  private readonly uniforms: SurfaceUniforms;
  private readonly blurUniforms = { tInput: { value: null as Texture | null }, uDirection: { value: new Vector2() } };

  constructor(scale: number, uniforms: SurfaceUniforms) {
    this.scale = scale;
    this.uniforms = uniforms;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    geometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    const material = new ShaderMaterial({
      vertexShader: BLUR_VERTEX,
      fragmentShader: BLUR_FRAGMENT,
      uniforms: this.blurUniforms,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new Mesh(geometry, material);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    uniforms.pmbReflection.value = this.sharp.texture;
    uniforms.pmbReflectionBlur.value = this.pong.texture;
  }

  private resize(gl: WebGLRenderer): void {
    gl.getDrawingBufferSize(this.size);
    const width = Math.max(2, Math.round(this.size.x * this.scale));
    const height = Math.max(2, Math.round(this.size.y * this.scale));
    if (width === this.measured.width && height === this.measured.height) return;
    this.measured.width = width;
    this.measured.height = height;
    this.sharp.setSize(width, height);
    const half = [Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2))] as const;
    this.ping.setSize(...half);
    this.pong.setSize(...half);
    this.uniforms.pmbReflectionTexel.value.set(1 / half[0], 1 / half[1]);
  }

  /** Caméra symétrique de `camera` par rapport au plan horizontal y = `height`, plan de coupe oblique. */
  private mirror(camera: Camera, height: number): void {
    const { v, virtual } = this;
    const normal = new Vector3(0, 1, 0);
    const origin = new Vector3(0, height, 0);
    v.camera.setFromMatrixPosition(camera.matrixWorld);
    const rotation = new Matrix4().extractRotation(camera.matrixWorld);
    v.look.set(0, 0, -1).applyMatrix4(rotation).add(v.camera);
    const view = new Vector3().subVectors(origin, v.camera).reflect(normal).negate().add(origin);
    v.target.subVectors(origin, v.look).reflect(normal).negate().add(origin);
    virtual.position.copy(view);
    v.up.set(0, 1, 0).applyMatrix4(rotation).reflect(normal);
    virtual.up.copy(v.up);
    virtual.lookAt(v.target);
    virtual.far = (camera as PerspectiveCamera).far;
    virtual.updateMatrixWorld();
    virtual.projectionMatrix.copy(camera.projectionMatrix);
    this.uniforms.pmbReflectionMatrix.value.copy(this.bias).multiply(virtual.projectionMatrix).multiply(virtual.matrixWorldInverse);

    // Plan de coupe oblique (Lengyel) : rien de ce qui est sous le sol n'entre dans le reflet.
    this.plane.setFromNormalAndCoplanarPoint(normal, origin).applyMatrix4(virtual.matrixWorldInverse);
    const { clip, q } = this;
    clip.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const e = virtual.projectionMatrix.elements;
    q.x = (Math.sign(clip.x) + (e[8] ?? 0)) / (e[0] ?? 1);
    q.y = (Math.sign(clip.y) + (e[9] ?? 0)) / (e[5] ?? 1);
    q.z = -1;
    q.w = (1 + (e[10] ?? 0)) / (e[14] ?? 1);
    clip.multiplyScalar(2 / clip.dot(q));
    e[2] = clip.x;
    e[6] = clip.y;
    e[10] = clip.z + 1;
    e[14] = clip.w;
  }

  private blur(gl: WebGLRenderer): void {
    const uniforms = this.blurUniforms;
    let input: Texture = this.sharp.texture;
    for (const [h, w] of BLUR_STEPS) {
      uniforms.tInput.value = input;
      uniforms.uDirection.value.set(h / this.ping.width, 0);
      gl.setRenderTarget(this.ping);
      gl.render(this.quadScene, this.quadCamera);
      uniforms.tInput.value = this.ping.texture;
      uniforms.uDirection.value.set(0, w / this.pong.height);
      gl.setRenderTarget(this.pong);
      gl.render(this.quadScene, this.quadCamera);
      input = this.pong.texture;
    }
  }

  /** Rend le reflet de `scene` vu par `camera` ; `floor` (le miroir) est masqué le temps du rendu. */
  update(gl: WebGLRenderer, scene: Scene, camera: Camera, floor: Object3D): void {
    // La caméra de drei ne recalcule sa matrice que dans gl.render : sans cela, le reflet
    // suivrait la rotation de l'image d'avant.
    camera.updateMatrixWorld();
    this.resize(gl);
    floor.updateMatrixWorld();
    this.mirror(camera, floor.getWorldPosition(new Vector3()).y);
    const autoClear = gl.autoClear;
    const previous = gl.getRenderTarget();
    floor.visible = false;
    gl.autoClear = true;
    gl.setRenderTarget(this.sharp);
    gl.render(scene, this.virtual);
    gl.autoClear = false;
    this.blur(gl);
    gl.autoClear = autoClear;
    gl.setRenderTarget(previous);
    floor.visible = true;
  }

  dispose(): void {
    this.sharp.dispose();
    this.ping.dispose();
    this.pong.dispose();
    this.quad.geometry.dispose();
    this.quad.material.dispose();
  }
}
