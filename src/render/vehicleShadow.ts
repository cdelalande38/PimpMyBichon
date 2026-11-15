// Ombre de contact du véhicule : celle de ContactShadows (drei 10.7), mêmes passes, même plan, même
// flou, même opacité, mais sa caméra d'ombre ne voit que le véhicule. Celle de drei rendait toute la
// scène : elle gardait au sol l'empreinte sombre, à bord net, du mobilier voisin (quad, table basse,
// tabouret), même une fois retiré de l'image par la coupe caméra, et changeait selon ce qui était
// visible à l'instant de sa première image (revue d, D1). Elle n'était jamais libérée (revue d, m5).
// Ici, les pièces du véhicule sont reprises dans une scène à part (mêmes géométries, mêmes
// matériaux, mêmes positions dans la pièce) : rien d'autre n'y entre, et la scène du garage, ses
// lumières et son état de rendu ne sont pas touchés. Seul écart voulu avec drei : la profondeur est
// testée (shadowDepthMaterial), d'où une ombre identique d'un chargement à l'autre.

import {
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  WebGLRenderTarget,
  type Object3D,
  type WebGLRenderer,
} from 'three';
import { HorizontalBlurShader } from 'three/examples/jsm/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/examples/jsm/shaders/VerticalBlurShader.js';

/** Réglages de l'ombre (ceux de l'ancien appel à ContactShadows, BenchCar.tsx). */
export const VEHICLE_SHADOW = {
  /** Plan d'ombre : longueur et largeur du véhicule multipliées par ces facteurs. */
  spread: [2.5, 3] as const,
  blur: 2.2,
  opacity: 0.8,
  resolution: 512,
  /** Seconde passe de flou, plus fine (drei : `smooth`). */
  smooth: true,
  color: '#000000',
} as const;

export interface ShadowSize {
  /** Côtés du plan d'ombre, en mètres (longueur sur x, largeur sur z dans le repère du véhicule). */
  width: number;
  depth: number;
  /** Hauteur vue par la caméra d'ombre, depuis le sol : celle du véhicule. */
  far: number;
}

/** Taille du plan d'ombre d'un véhicule posé (demi-longueur, demi-largeur, hauteur). */
export function shadowSize(measure: { halfLength: number; halfWidth: number; height: number }): ShadowSize {
  return {
    width: measure.halfLength * VEHICLE_SHADOW.spread[0],
    depth: measure.halfWidth * VEHICLE_SHADOW.spread[1],
    far: measure.height,
  };
}

/**
 * Scène de rendu de l'ombre : une reprise de chaque pièce visible de `caster`, sur sa géométrie et
 * son matériau (empruntés, jamais libérés ici), à sa place dans la pièce (matrices du monde à jour).
 * Tout s'y dessine avec `depth` : la scène ne sert qu'à l'ordre de dessin, le même que dans la scène
 * entière (rang, transparence, matériau, distance, puis ordre de création).
 */
export function shadowCasters(caster: Object3D, depth: MeshDepthMaterial): Scene {
  const scene = new Scene();
  scene.overrideMaterial = depth;
  caster.traverseVisible((object) => {
    if (!(object instanceof Mesh)) return;
    const proxy = new Mesh(object.geometry, object.material);
    proxy.matrixAutoUpdate = false;
    proxy.matrix.copy(object.matrixWorld);
    proxy.matrixWorld.copy(object.matrixWorld);
    proxy.layers.mask = object.layers.mask;
    proxy.renderOrder = object.renderOrder;
    proxy.frustumCulled = object.frustumCulled;
    scene.add(proxy);
  });
  return scene;
}

/**
 * Matériau de profondeur coloré de drei : sombre au pied du véhicule, s'efface vers le haut. Test de
 * profondeur actif, contrairement à drei : chaque texel garde la surface la plus proche du sol. Sans
 * lui, la dernière pièce dessinée l'emportait, et l'ordre de dessin suit le numéro des matériaux, que
 * le chargement du modèle attribue dans un ordre variable (textures asynchrones) : selon le
 * chargement, l'ombre venait du plancher ou de l'habitacle (revue d, « ombre qui varie »).
 */
function shadowDepthMaterial(color: string): MeshDepthMaterial {
  const material = new MeshDepthMaterial();
  material.depthTest = material.depthWrite = true;
  material.onBeforeCompile = (shader) => {
    shader.uniforms = { ...shader.uniforms, ucolor: { value: new Color(color) } };
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', 'uniform vec3 ucolor;\n           void main() {\n          ');
    shader.fragmentShader = shader.fragmentShader.replace(
      'vec4( vec3( 1.0 - fragCoordZ ), opacity );',
      'vec4( ucolor * fragCoordZ * 2.0, ( 1.0 - fragCoordZ ) * 1.0 );',
    );
  };
  return material;
}

/**
 * Plan d'ombre et ses passes. `root` se pose dans le repère du véhicule, au sol (y = 0) : un groupe
 * tourné d'un quart de tour, avec le plan visible et la caméra orthographique qui regarde vers le
 * haut, comme dans drei. `render` refait la texture ; `dispose` libère tout ce qui a été créé ici.
 */
export class VehicleShadowRig {
  readonly root = new Group();
  readonly camera: OrthographicCamera;
  readonly plane: Mesh;
  private readonly target: WebGLRenderTarget;
  private readonly blurTarget: WebGLRenderTarget;
  private readonly geometry: PlaneGeometry;
  private readonly depth: MeshDepthMaterial;
  private readonly horizontal = new ShaderMaterial(HorizontalBlurShader);
  private readonly vertical = new ShaderMaterial(VerticalBlurShader);
  private readonly blurPlane: Mesh;
  private readonly planeMaterial: MeshBasicMaterial;
  private readonly clearColor = new Color();

  constructor(size: ShadowSize) {
    const { resolution } = VEHICLE_SHADOW;
    this.target = new WebGLRenderTarget(resolution, resolution);
    this.blurTarget = new WebGLRenderTarget(resolution, resolution);
    this.target.texture.generateMipmaps = this.blurTarget.texture.generateMipmaps = false;
    this.geometry = new PlaneGeometry(size.width, size.depth).rotateX(Math.PI / 2);
    this.blurPlane = new Mesh(this.geometry, this.horizontal);
    this.depth = shadowDepthMaterial(VEHICLE_SHADOW.color);
    this.horizontal.depthTest = this.vertical.depthTest = false;

    this.root.rotation.x = Math.PI / 2;
    this.planeMaterial = new MeshBasicMaterial({ transparent: true, map: this.target.texture, opacity: VEHICLE_SHADOW.opacity, depthWrite: false });
    this.plane = new Mesh(this.geometry, this.planeMaterial);
    this.plane.scale.set(1, -1, 1);
    this.plane.rotation.set(-Math.PI / 2, 0, 0);
    this.camera = new OrthographicCamera(-size.width / 2, size.width / 2, size.depth / 2, -size.depth / 2, 0, size.far);
    this.root.add(this.plane, this.camera);
  }

  /**
   * Rend l'ombre de `caster` (le véhicule) : profondeur vue d'en dessous, puis deux flous. `world` est
   * la scène où vivent le véhicule et ce plan : ses matrices sont mises à jour d'abord, comme le
   * faisait le rendu de drei. La cible de profondeur part vide (transparente) à chaque rendu.
   */
  render(gl: WebGLRenderer, caster: Object3D, world: Object3D): void {
    world.updateMatrixWorld();
    const casters = shadowCasters(caster, this.depth);
    gl.getClearColor(this.clearColor);
    const clearAlpha = gl.getClearAlpha();
    gl.setRenderTarget(this.target);
    gl.setClearColor(0x000000, 0);
    gl.clear(true, true, true);
    gl.setClearColor(this.clearColor, clearAlpha);
    gl.render(casters, this.camera);
    this.blur(gl, VEHICLE_SHADOW.blur);
    if (VEHICLE_SHADOW.smooth) this.blur(gl, VEHICLE_SHADOW.blur * 0.4);
    gl.setRenderTarget(null);
  }

  private blur(gl: WebGLRenderer, amount: number): void {
    const { blurPlane, horizontal, vertical } = this;
    blurPlane.visible = true;
    blurPlane.material = horizontal;
    (horizontal.uniforms.tDiffuse as { value: unknown }).value = this.target.texture;
    (horizontal.uniforms.h as { value: number }).value = amount / 256;
    gl.setRenderTarget(this.blurTarget);
    gl.render(blurPlane, this.camera);
    blurPlane.material = vertical;
    (vertical.uniforms.tDiffuse as { value: unknown }).value = this.blurTarget.texture;
    (vertical.uniforms.v as { value: number }).value = amount / 256;
    gl.setRenderTarget(this.target);
    gl.render(blurPlane, this.camera);
    blurPlane.visible = false;
  }

  /** Programmes de l'ombre lancés d'avance, sans rien dessiner (ils se compilent en tâche de fond). */
  compile(gl: WebGLRenderer): void {
    const previous = gl.getRenderTarget();
    gl.setRenderTarget(this.target);
    try {
      // compile() prend les matériaux des objets, pas celui qui les remplace : un maillage porteur de
      // la profondeur, dans une scène sans lumières, comme celle des reprises au rendu.
      gl.compile(new Mesh(this.geometry, this.depth), this.camera, new Scene());
      this.blurPlane.material = this.horizontal;
      gl.compile(this.blurPlane, this.camera);
      this.blurPlane.material = this.vertical;
      gl.compile(this.blurPlane, this.camera);
    } finally {
      gl.setRenderTarget(previous);
    }
  }

  dispose(): void {
    this.target.dispose();
    this.blurTarget.dispose();
    this.geometry.dispose();
    this.depth.dispose();
    this.horizontal.dispose();
    this.vertical.dispose();
    this.planeMaterial.dispose();
  }
}
