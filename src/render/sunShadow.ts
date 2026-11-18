// Ombre portée du véhicule par le soleil (sortie de jour, § 5.5) : elle suit la silhouette du
// véhicule et la direction du soleil, sans carte d'ombres sur la scène.
//
// Une fois par modèle posé (comme l'ombre de contact, src/render/vehicleShadow.ts), deux petites
// cartes de hauteur du véhicule sont rendues dans son repère : le dessus (vu d'en haut) et le dessous
// (vu d'en bas), 128 texels sur la longueur. Au sol, un plan autour de l'empreinte remonte, pour
// chacun de ses pixels, le rayon vers le soleil : le pixel est à l'ombre si le rayon passe entre le
// dessous et le dessus du véhicule. Le jour passe ainsi sous la caisse entre les roues, et le profil
// (pare-brise, toit, rétroviseurs, aileron) se dessine au sol, étiré à l'opposé du soleil.
//
// Coût par image : un appel de dessin et, pour les seuls pixels dont le rayon croise l'empreinte, une
// marche bornée (SUN_SHADOW.steps pas, deux lectures de texture chacun) ; les autres sortent tout de
// suite. Rien n'est rendu à chaque image : les cartes ne changent qu'avec le modèle (roues, pièces).
// Sous un ciel couvert (`soft` à 1), l'ombre se ramasse sous le véhicule et s'adoucit.

import {
  Color,
  DoubleSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type Object3D,
  type WebGLRenderer,
} from 'three';

export const SUN_SHADOW = {
  /** Texels des cartes de hauteur sur la longueur du véhicule (la largeur suit, de 32 à 128). */
  texels: 128,
  /** Marge autour de l'empreinte dans les cartes de hauteur (m). */
  pad: 0.08,
  /** Pas de la marche vers le soleil. */
  steps: 20,
  /** Marge du plan d'ombre autour de l'empreinte (m) : la portée de l'ombre au plus. */
  reach: 2.6,
  /** Pente du rayon vers le soleil au plus (tangente de sa hauteur) : soleil au zénith, ombre courte mais présente. */
  maxSlope: 8,
  /** Ciel couvert : part de la direction du soleil gardée (le reste vient du zénith). */
  overcastSun: 0.3,
  /** Hauteur du plan d'ombre au-dessus du sol du véhicule, hors levée sur l'enrobé (m). */
  planeY: 0.02,
} as const;

/** Mesures du véhicule posé (repère du véhicule : avant +X, côté +Z, sol à y = 0). */
export interface SunShadowMeasure {
  halfLength: number;
  halfWidth: number;
  height: number;
}

/** Cartes de hauteur : rectangle couvert au sol (m), hauteur de normalisation (m), taille en texels. */
export interface HeightMapLayout {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  height: number;
  width: number;
  depth: number;
}

/** Puissance de deux la plus proche de `n`, bornée. */
function pow2(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, 2 ** Math.round(Math.log2(Math.max(1, n)))));
}

/** Rectangle et taille des cartes de hauteur d'un véhicule. */
export function heightMapLayout(m: SunShadowMeasure): HeightMapLayout {
  const { pad, texels } = SUN_SHADOW;
  const x1 = m.halfLength + pad;
  const z1 = m.halfWidth + pad;
  return { x0: -x1, z0: -z1, x1, z1, height: m.height + pad, width: texels, depth: pow2((texels * z1) / x1, 32, texels) };
}

/**
 * Direction vers le soleil pour l'ombre, dans le repère du véhicule : `sun` (unitaire), adoucie vers
 * le zénith sous un ciel couvert (`nette` 0 : couvert, 1 : soleil franc), pente bornée (SUN_SHADOW.maxSlope).
 * Écrit dans `out` (aucune allocation) et le rend.
 */
export function shadowSun(x: number, y: number, z: number, nette: number, out: Vector3): Vector3 {
  const k = SUN_SHADOW.overcastSun + (1 - SUN_SHADOW.overcastSun) * Math.min(1, Math.max(0, nette));
  out.set(x * k, Math.max(0.05, y) * k + (1 - k), z * k);
  const h = Math.hypot(out.x, out.z);
  const minH = out.y / SUN_SHADOW.maxSlope;
  if (h < minH) {
    // Soleil presque au zénith : un soupçon de direction (le long du véhicule s'il n'en a aucune).
    if (h > 1e-6) {
      out.x *= minH / h;
      out.z *= minH / h;
    } else out.x = minH;
  }
  return out.normalize();
}

/** Portée horizontale de l'ombre (m) d'un objet de hauteur `height` sous un soleil de direction unitaire `sun`. */
export function shadowReach(height: number, sun: { x: number; y: number; z: number }): number {
  return (height * Math.hypot(sun.x, sun.z)) / Math.max(1e-3, sun.y);
}

// Cartes de hauteur : chaque pièce du véhicule, projetée de haut en bas sur le rectangle de la carte ;
// la profondeur garde la plus haute surface (dessus) ou la plus basse (dessous). Hauteur sur 8 bits.
const HEIGHT_VERTEX = /* glsl */ `
uniform mat4 uToFrame;
uniform vec4 uRect;
uniform float uInvHeight;
uniform float uBelow;
varying float vH;
void main() {
  vec4 p = vec4( position, 1.0 );
  #ifdef USE_INSTANCING
  p = instanceMatrix * p;
  #endif
  vec4 local = uToFrame * modelMatrix * p;
  vec2 uv = ( local.xz - uRect.xy ) * uRect.zw;
  float h = clamp( local.y * uInvHeight, 0.0, 1.0 );
  vH = h;
  float depth = uBelow > 0.5 ? h : 1.0 - h;
  gl_Position = vec4( uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0 );
}`;

const HEIGHT_FRAGMENT = /* glsl */ `
varying float vH;
void main() {
  gl_FragColor = vec4( vH, 0.0, 0.0, 1.0 );
}`;

const SHADOW_VERTEX = /* glsl */ `
varying vec2 vPos;
void main() {
  vPos = position.xz;
  // La chaussée passe un peu au-dessus du rail (bombé, dévers) : le plan est tiré de 0,25 m vers la
  // caméra le long de la vue (même place à l'écran), pour ne jamais passer sous l'enrobé.
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  mv.xyz *= max( 0.0, 1.0 - 0.25 / max( length( mv.xyz ), 0.5 ) );
  gl_Position = projectionMatrix * mv;
}`;

const SHADOW_FRAGMENT = /* glsl */ `
uniform sampler2D uTop;
uniform sampler2D uBottom;
uniform vec4 uRect;
uniform vec2 uRectMax;
uniform vec2 uPlane;
uniform float uHeight;
uniform vec3 uSun;
uniform float uSoft;
uniform float uLift;
uniform float opacity;
varying vec2 vPos;
float pmbShadowAt( vec2 q, float y, float e, float bias ) {
  vec2 uv = ( q - uRect.xy ) * uRect.zw;
  // Niveau de détail explicite : aucune dérivée dans la marche (après un rejet de pixel, elles ne valent rien).
  float top = textureLod( uTop, uv, bias ).r * uHeight;
  float bottom = textureLod( uBottom, uv, bias ).r * uHeight;
  return smoothstep( -e, e, top - y ) * smoothstep( -e, e, y - bottom );
}
void main() {
  float len = length( uSun.xz );
  vec2 dir = uSun.xz / max( len, 1e-4 );
  float slope = uSun.y / max( len, 1e-4 );
  // Morceau du rayon vers le soleil qui survole l'empreinte, sous le toit (méthode des dalles).
  vec2 sgn = vec2( dir.x >= 0.0 ? 1.0 : -1.0, dir.y >= 0.0 ? 1.0 : -1.0 );
  vec2 inv = sgn / max( abs( dir ), vec2( 1e-4 ) );
  vec2 ta = ( uRect.xy - vPos ) * inv;
  vec2 tb = ( uRectMax - vPos ) * inv;
  vec2 tn = min( ta, tb );
  vec2 tf = max( ta, tb );
  float t0 = max( max( tn.x, tn.y ), 0.0 );
  float t1 = min( min( tf.x, tf.y ), ( uHeight - uLift ) / max( slope, 1e-3 ) );
  if ( t1 <= t0 ) discard;
  float dt = ( t1 - t0 ) / ${SUN_SHADOW.steps}.0;
  // Ciel couvert : cartes lues floues (niveaux réduits), l'ombre s'adoucit.
  float bias = uSoft * 2.5;
  float occ = 0.0;
  for ( int i = 0; i < ${SUN_SHADOW.steps}; i ++ ) {
    float t = t0 + ( float( i ) + 0.5 ) * dt;
    // Pénombre : le soleil n'est pas un point (plus large loin du véhicule) ; ciel couvert, bien plus.
    float e = 0.025 + 0.012 * t + uSoft * ( 0.06 + 0.2 * t );
    occ = max( occ, pmbShadowAt( vPos + dir * t, uLift + t * slope, e, bias ) );
  }
  // Bord du plan : jamais de coupure nette.
  vec2 edge = abs( vPos ) / uPlane;
  occ *= 1.0 - smoothstep( 0.86, 1.0, max( edge.x, edge.y ) );
  if ( occ < 0.004 ) discard;
  gl_FragColor = vec4( 0.0, 0.0, 0.0, occ * opacity );
}`;

/** Reprise des pièces visibles de `caster` (matrices du monde à jour), toutes dessinées avec `material`. */
function heightCasters(caster: Object3D, material: ShaderMaterial): Scene {
  const scene = new Scene();
  scene.overrideMaterial = material;
  caster.traverseVisible((object) => {
    if (!(object instanceof Mesh)) return;
    const proxy = new Mesh(object.geometry, object.material);
    proxy.matrixAutoUpdate = false;
    proxy.matrix.copy(object.matrixWorld);
    proxy.matrixWorld.copy(object.matrixWorld);
    proxy.layers.mask = object.layers.mask;
    proxy.frustumCulled = false;
    scene.add(proxy);
  });
  return scene;
}

function heightTarget(layout: HeightMapLayout): WebGLRenderTarget {
  const target = new WebGLRenderTarget(layout.width, layout.depth, { depthBuffer: true, generateMipmaps: true, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter });
  target.texture.name = 'ombre_soleil_hauteurs';
  return target;
}

/**
 * Ombre portée par le soleil : `mesh` se pose dans le repère du véhicule (au sol, y = 0), `material`
 * porte `opacity` (0 : invisible) et la direction du soleil (`aim`). `render` refait les cartes de
 * hauteur du modèle ; `dispose` libère tout ce qui a été créé ici.
 */
export class SunShadow {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  readonly material: ShaderMaterial;
  readonly layout: HeightMapLayout;
  private readonly top: WebGLRenderTarget;
  private readonly bottom: WebGLRenderTarget;
  private readonly heights: ShaderMaterial;
  /** Caméra de forme : le nuanceur des hauteurs pose lui-même ses sommets. Tous les calques : tout le modèle visible compte. */
  private readonly camera = new OrthographicCamera();
  private readonly clearColor = new Color();
  private readonly toFrame = new Matrix4();

  constructor(measure: SunShadowMeasure) {
    const layout = heightMapLayout(measure);
    this.layout = layout;
    this.top = heightTarget(layout);
    this.bottom = heightTarget(layout);
    const rect = new Vector4(layout.x0, layout.z0, 1 / (layout.x1 - layout.x0), 1 / (layout.z1 - layout.z0));
    this.heights = new ShaderMaterial({
      uniforms: { uToFrame: { value: this.toFrame }, uRect: { value: rect }, uInvHeight: { value: 1 / layout.height }, uBelow: { value: 0 } },
      vertexShader: HEIGHT_VERTEX,
      fragmentShader: HEIGHT_FRAGMENT,
      side: DoubleSide,
    });
    this.heights.name = 'jour_ombre_hauteurs';
    this.camera.layers.enableAll();
    const half = new Vector2(measure.halfLength + SUN_SHADOW.reach, measure.halfWidth + SUN_SHADOW.reach);
    const geometry = new PlaneGeometry(2 * half.x, 2 * half.y).rotateX(-Math.PI / 2);
    this.material = new ShaderMaterial({
      uniforms: {
        uTop: { value: this.top.texture },
        uBottom: { value: this.bottom.texture },
        uRect: { value: rect },
        uRectMax: { value: new Vector2(layout.x1, layout.z1) },
        uPlane: { value: half },
        uHeight: { value: layout.height },
        uSun: { value: new Vector3(0, 1, 0) },
        uSoft: { value: 0 },
        uLift: { value: 0 },
        opacity: { value: 0 },
      },
      vertexShader: SHADOW_VERTEX,
      fragmentShader: SHADOW_FRAGMENT,
      transparent: true,
      depthWrite: false,
    });
    this.material.name = 'jour_ombre_portee';
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.name = 'ombre_portee';
    this.mesh.position.y = SUN_SHADOW.planeY;
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
  }

  /**
   * Rend les cartes de hauteur de `caster` (le modèle) dans le repère de `frame` (la caisse : sol à
   * y = 0, avant +X) ; `world` est la scène, dont les matrices sont mises à jour d'abord.
   */
  render(gl: WebGLRenderer, caster: Object3D, frame: Object3D, world: Object3D): void {
    world.updateMatrixWorld();
    this.toFrame.copy(frame.matrixWorld).invert();
    const casters = heightCasters(caster, this.heights);
    const previous = gl.getRenderTarget();
    gl.getClearColor(this.clearColor);
    const clearAlpha = gl.getClearAlpha();
    const below = this.heights.uniforms.uBelow as { value: number };
    for (const [target, under, clear] of [
      [this.top, 0, 0],
      [this.bottom, 1, 1],
    ] as const) {
      below.value = under;
      gl.setRenderTarget(target);
      // Dessus : rien (0) hors du véhicule ; dessous : tout en haut (1), le rayon n'y bute jamais.
      gl.setClearColor(clear === 1 ? 0xffffff : 0x000000, 1);
      gl.clear(true, true, false);
      gl.render(casters, this.camera);
    }
    gl.setClearColor(this.clearColor, clearAlpha);
    gl.setRenderTarget(previous);
    casters.clear();
  }

  /** Programme des cartes de hauteur lancé d'avance (le plan, lui, se compile avec la scène). */
  compile(gl: WebGLRenderer): void {
    const previous = gl.getRenderTarget();
    gl.setRenderTarget(this.top);
    try {
      gl.compile(new Mesh(this.mesh.geometry, this.heights), this.camera, new Scene());
    } finally {
      gl.setRenderTarget(previous);
    }
  }

  dispose(): void {
    this.top.dispose();
    this.bottom.dispose();
    this.heights.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}

/**
 * Pose la direction du soleil sur l'ombre : (x, y, z) vers le soleil dans le repère du véhicule,
 * `nette` de 0 (couvert) à 1 (soleil franc) ; le plan déjà posé à sa hauteur (levé sur l'enrobé).
 * Aucune allocation.
 */
export function aimSunShadow(cast: { mesh: Object3D; material: ShaderMaterial }, x: number, y: number, z: number, nette: number): void {
  const u = cast.material.uniforms;
  const sun = u.uSun?.value as Vector3 | undefined;
  if (sun) shadowSun(x, y, z, nette, sun);
  if (u.uSoft) (u.uSoft as { value: number }).value = 1 - Math.min(1, Math.max(0, nette));
  if (u.uLift) (u.uLift as { value: number }).value = Math.max(0, cast.mesh.position.y - SUN_SHADOW.planeY);
}
