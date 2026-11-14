// Surfaces prolongées hors de la pièce (sol, plafond) et sol réfléchissant (§ 8).
// - Dehors : au-delà des murs, la surface se perd dans la brume de l'ambiance (violet très
//   sombre, jamais noir) ; la pièce n'est plus une maquette posée dans le vide.
// - Sol : la réflexion planaire (src/render/planarReflection.ts) s'ajoute à la lumière du
//   carrelage, nette sur les carreaux, floue et étirée vers la caméra, éteinte dans les joints :
//   c'est la carte de rugosité qui décide. Sans réflexion planaire (niveau économie), le sol
//   reste brillant grâce à la sonde.

import { Color, Matrix4, Vector2, Vector3, type MeshStandardMaterial, type Texture, type WebGLProgramParametersWithUniforms } from 'three';

export interface SurfaceUniforms {
  pmbHazeColor: { value: Color };
  /** Centre et demi-côtés de la pièce, au sol (x, z). */
  pmbRoomCenter: { value: Vector2 };
  pmbRoomHalf: { value: Vector2 };
  /** Distance aux murs, en mètres, à laquelle il reste 1/e de la surface. */
  pmbHazeFalloff: { value: number };
  /**
   * Part de l'éclairage diffus venu de la sonde. La sonde voit les rampes du plafond depuis le
   * véhicule ; sur une surface aussi grande que le sol, cet éclairage uniforme laverait tout.
   */
  pmbIblDiffuse: { value: number };
  /**
   * Part du reflet de la sonde sur le sol et le plafond. Quand la réflexion planaire est là, c'est
   * elle qui fait le reflet du sol : celui de la sonde (qui voit les rampes) le doublerait et
   * blanchirait tout le carrelage.
   */
  pmbIblSpecular: { value: number };
  /**
   * Volumes du véhicule (coins min et max, repère de la pièce) : le mobilier qui le masque à la
   * caméra s'efface (voir `patchDecorShader`).
   */
  pmbCutMin: { value: Vector3[] };
  pmbCutMax: { value: Vector3[] };
  pmbReflection: { value: Texture | null };
  pmbReflectionBlur: { value: Texture | null };
  /** Projection monde → coordonnées de la cible de réflexion. */
  pmbReflectionMatrix: { value: Matrix4 };
  pmbReflectionStrength: { value: number };
  /** Taille d'un texel de la cible floue (pour étirer le reflet). */
  pmbReflectionTexel: { value: Vector2 };
}

/** Nombre de volumes du véhicule pour la découpe du décor (fixe : c'est une taille de tableau GLSL). */
export const CUTAWAY_BOXES = 2;

export interface CutBox {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

export function createSurfaceUniforms(
  room: { width: number; depth: number },
  falloff: number,
  cutaway: readonly CutBox[] = [],
): SurfaceUniforms {
  // Un volume absent est vide (min > max) : il ne découpe rien.
  const box = (index: number) => cutaway[index] ?? { min: [1, 1, 1] as const, max: [-1, -1, -1] as const };
  const boxes = Array.from({ length: CUTAWAY_BOXES }, (_, index) => box(index));
  return {
    pmbHazeColor: { value: new Color('#170a28') },
    pmbRoomCenter: { value: new Vector2(0, 0) },
    pmbRoomHalf: { value: new Vector2(room.width / 2, room.depth / 2) },
    pmbHazeFalloff: { value: falloff },
    pmbIblDiffuse: { value: 0.08 },
    pmbIblSpecular: { value: 1 },
    pmbCutMin: { value: boxes.map(({ min }) => new Vector3(...min)) },
    pmbCutMax: { value: boxes.map(({ max }) => new Vector3(...max)) },
    pmbReflection: { value: null },
    pmbReflectionBlur: { value: null },
    pmbReflectionMatrix: { value: new Matrix4() },
    pmbReflectionStrength: { value: 1 },
    pmbReflectionTexel: { value: new Vector2(1 / 512, 1 / 512) },
  };
}

const VERTEX_HEAD = /* glsl */ `
varying vec3 vPmbWorld;
#ifdef PMB_REFLECTION
uniform mat4 pmbReflectionMatrix;
varying vec4 vPmbReflCoord;
#endif`;

const VERTEX_BODY = /* glsl */ `
vPmbWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
#ifdef PMB_REFLECTION
vPmbReflCoord = pmbReflectionMatrix * vec4( vPmbWorld, 1.0 );
#endif`;

const FRAGMENT_HEAD = /* glsl */ `
varying vec3 vPmbWorld;
uniform vec3 pmbHazeColor;
uniform vec2 pmbRoomCenter;
uniform vec2 pmbRoomHalf;
uniform float pmbHazeFalloff;
uniform float pmbIblDiffuse;
uniform float pmbIblSpecular;
#ifdef PMB_REFLECTION
uniform sampler2D pmbReflection;
uniform sampler2D pmbReflectionBlur;
uniform float pmbReflectionStrength;
uniform vec2 pmbReflectionTexel;
varying vec4 vPmbReflCoord;
#endif`;

const FRAGMENT_BODY = /* glsl */ `
#ifdef PMB_REFLECTION
{
  vec2 pmbUv = vPmbReflCoord.xy / vPmbReflCoord.w;
  vec3 pmbSharp = texture2D( pmbReflection, pmbUv ).rgb;
  // Reflet flou étiré à la verticale de l'écran : les traînées filent vers la caméra.
  vec2 pmbStep = vec2( 0.0, pmbReflectionTexel.y * 5.0 );
  vec3 pmbSoft = texture2D( pmbReflectionBlur, pmbUv ).rgb * 0.4
    + ( texture2D( pmbReflectionBlur, pmbUv + pmbStep ).rgb + texture2D( pmbReflectionBlur, pmbUv - pmbStep ).rgb ) * 0.3;
  // Carte de rugosité : net sur les carreaux, flou et éteint dans les joints.
  vec3 pmbRefl = mix( pmbSharp, pmbSoft, smoothstep( 0.1, 0.45, roughnessFactor ) );
  float pmbNdV = saturate( dot( normal, normalize( vViewPosition ) ) );
  float pmbFresnel = 0.04 + 0.96 * pow( 1.0 - pmbNdV, 5.0 );
  outgoingLight += pmbRefl * pmbReflectionStrength * ( 1.0 - roughnessFactor ) * mix( 0.3, 1.0, pmbFresnel );
}
#endif
{
  // Hors de la pièce : la surface se perd dans la brume.
  float pmbOut = length( max( abs( vPmbWorld.xz - pmbRoomCenter ) - pmbRoomHalf, 0.0 ) );
  outgoingLight = mix( outgoingLight, pmbHazeColor, 1.0 - exp( -pmbOut / pmbHazeFalloff ) );
}`;

function inject(source: string, anchor: string, code: string, after = true): string {
  if (!source.includes(anchor)) throw new Error(`Surface : repère ${anchor} introuvable`);
  return source.replace(anchor, after ? `${anchor}\n${code}` : `${code}\n${anchor}`);
}

/** Modifie les sources d'un MeshStandardMaterial (exporté pour les tests). */
export function patchSurfaceShader(shader: { vertexShader: string; fragmentShader: string }): void {
  shader.vertexShader = inject(shader.vertexShader, '#include <common>', VERTEX_HEAD);
  shader.vertexShader = inject(shader.vertexShader, '#include <project_vertex>', VERTEX_BODY);
  shader.fragmentShader = inject(shader.fragmentShader, '#include <common>', FRAGMENT_HEAD);
  shader.fragmentShader = inject(
    shader.fragmentShader,
    '#include <lights_fragment_maps>',
    'iblIrradiance *= pmbIblDiffuse;\n#if defined( RE_IndirectSpecular )\nradiance *= pmbIblSpecular;\n#endif',
  );
  shader.fragmentShader = inject(shader.fragmentShader, '#include <opaque_fragment>', FRAGMENT_BODY, false);
}

/** Branche la brume du dehors (et la réflexion planaire si `setReflection`) sur un matériau. */
export function patchSurface(material: MeshStandardMaterial, uniforms: SurfaceUniforms): void {
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    patchSurfaceShader(shader);
  };
  material.customProgramCacheKey = () => 'pmb-surface-3';
}

// Découpe : un objet du mobilier qui se trouve entre la caméra et le véhicule (le rayon caméra →
// centre de l'objet entre dans un volume du véhicule au-delà de ce centre) disparaît en entier.
// Le coin salon du premier plan, à sa vraie place, ne cache jamais la voiture ni son reflet : on
// voit à travers, comme à travers les murs qui tournent le dos à la caméra. Chaque sommet porte
// le centre de son objet (attribut `pmbAnchor`, w = 1 ; w = 0 : jamais découpé). `cameraPosition`
// est celle de la passe en cours : le reflet du sol découpe de même ; la sonde, placée dans le
// véhicule, ne découpe rien.
export const ANCHOR_ATTRIBUTE = 'pmbAnchor';

const CUT_VERTEX_HEAD = /* glsl */ `
attribute vec4 pmbAnchor;
uniform vec3 pmbCutMin[ ${CUTAWAY_BOXES} ];
uniform vec3 pmbCutMax[ ${CUTAWAY_BOXES} ];
bool pmbHides( vec3 point, vec3 boxMin, vec3 boxMax ) {
  vec3 inv = 1.0 / ( point - cameraPosition );
  vec3 t0 = ( boxMin - cameraPosition ) * inv;
  vec3 t1 = ( boxMax - cameraPosition ) * inv;
  vec3 near = min( t0, t1 );
  vec3 far = max( t0, t1 );
  float enter = max( max( near.x, near.y ), near.z );
  float leave = min( min( far.x, far.y ), far.z );
  return enter > 1.0 && enter <= leave;
}`;

const CUT_VERTEX_BODY = /* glsl */ `
if ( pmbAnchor.w > 0.5 ) {
  for ( int i = 0; i < ${CUTAWAY_BOXES}; i ++ ) {
    // Hors du volume de vue : tous les sommets de l'objet y partent, ses triangles disparaissent.
    if ( pmbHides( pmbAnchor.xyz, pmbCutMin[ i ], pmbCutMax[ i ] ) ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
  }
}`;

/**
 * Pour le reste du décor : seule la part diffuse de la sonde est réduite (ses reflets restent).
 * Les rampes qu'elle voit laveraient sinon les murs d'une lumière uniforme et éteindraient les halos.
 * Le mobilier qui masque le véhicule s'efface (découpe ci-dessus).
 */
export function patchDiffuseIbl(material: MeshStandardMaterial, uniforms: SurfaceUniforms): void {
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.pmbIblDiffuse = uniforms.pmbIblDiffuse;
    shader.uniforms.pmbCutMin = uniforms.pmbCutMin;
    shader.uniforms.pmbCutMax = uniforms.pmbCutMax;
    patchDecorShader(shader);
  };
  material.customProgramCacheKey = () => 'pmb-decor-3';
}

/** Modifie les sources d'un matériau du décor (exporté pour les tests). */
export function patchDecorShader(shader: { vertexShader: string; fragmentShader: string }): void {
  shader.vertexShader = inject(shader.vertexShader, '#include <common>', CUT_VERTEX_HEAD);
  shader.vertexShader = inject(shader.vertexShader, '#include <project_vertex>', CUT_VERTEX_BODY);
  shader.fragmentShader = inject(shader.fragmentShader, '#include <common>', 'uniform float pmbIblDiffuse;');
  shader.fragmentShader = inject(shader.fragmentShader, '#include <lights_fragment_maps>', 'iblIrradiance *= pmbIblDiffuse;');
}

/** Active ou coupe la réflexion planaire d'un matériau patché (recompile une fois). */
export function setReflection(material: MeshStandardMaterial, on: boolean): void {
  const has = material.defines?.PMB_REFLECTION !== undefined;
  if (has === on) return;
  material.defines = { ...(material.defines ?? {}) };
  if (on) material.defines.PMB_REFLECTION = '';
  else delete material.defines.PMB_REFLECTION;
  material.needsUpdate = true;
}
