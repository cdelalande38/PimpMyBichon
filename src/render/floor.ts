// Matériaux du garage (§ 8) : un seul patch de nuanceur, `patchGarageMaterial`, pour tout ce que
// le décor ajoute aux matériaux de three.
// - Dehors (sol, plafond) : au-delà des murs, la surface se perd dans la brume de l'ambiance
//   (violet très sombre, jamais noir) ; la pièce n'est plus une maquette posée dans le vide.
// - Sol : la réflexion planaire (src/render/planarReflection.ts) s'ajoute à la lumière du
//   carrelage, nette sur les carreaux, floue et étirée vers la caméra, éteinte dans les joints :
//   c'est la carte de rugosité qui décide. Sans réflexion planaire (niveau économie), le sol
//   reste brillant grâce à la sonde.
// - Décor : seule la part diffuse de la sonde est réduite (ses reflets restent) ; les rampes
//   qu'elle voit laveraient sinon les murs d'une lumière uniforme et éteindraient les halos.
// - Coupe caméra (src/render/cut.ts) : chaque élément du décor s'efface quand il passerait entre
//   l'œil et le véhicule.

import {
  AdditiveBlending,
  Color,
  Matrix4,
  MeshStandardMaterial,
  Vector2,
  type Material,
  type MeshBasicMaterial,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { createCutUniforms, patchCutShader, type CutUniforms } from './cut.ts';

export interface SurfaceUniforms extends CutUniforms {
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
  pmbReflection: { value: Texture | null };
  pmbReflectionBlur: { value: Texture | null };
  /** Projection monde → coordonnées de la cible de réflexion. */
  pmbReflectionMatrix: { value: Matrix4 };
  pmbReflectionStrength: { value: number };
  /** Taille d'un texel de la cible floue (pour étirer le reflet). */
  pmbReflectionTexel: { value: Vector2 };
}

export function createSurfaceUniforms(room: { width: number; depth: number }, falloff: number): SurfaceUniforms {
  return {
    ...createCutUniforms(),
    pmbHazeColor: { value: new Color('#170a28') },
    pmbRoomCenter: { value: new Vector2(0, 0) },
    pmbRoomHalf: { value: new Vector2(room.width / 2, room.depth / 2) },
    pmbHazeFalloff: { value: falloff },
    pmbIblDiffuse: { value: 0.08 },
    pmbIblSpecular: { value: 1 },
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

/** Variante de nuanceur d'un matériau du garage (chacune a son programme). */
export interface GarageShaderVariant {
  /** Matériau standard (sinon basique : émissifs, cônes). */
  standard: boolean;
  /** Sol ou plafond : brume du dehors, reflet planaire, reflet de la sonde réglable. */
  surface: boolean;
  /** S'ajoute à l'image (fondu de la coupe par atténuation). */
  additive: boolean;
  /** Voile transparent mélangé par son opacité (ombres de contact) : fondu par l'opacité. */
  alpha?: boolean;
}

/** Modifie les sources d'un matériau du garage selon sa variante (exporté pour les tests). */
export function patchGarageShader(shader: { vertexShader: string; fragmentShader: string }, variant: GarageShaderVariant): void {
  patchCutShader(shader, variant.additive, variant.alpha === true);
  if (!variant.standard) return;
  if (!variant.surface) {
    shader.fragmentShader = inject(shader.fragmentShader, '#include <common>', 'uniform float pmbIblDiffuse;');
    shader.fragmentShader = inject(shader.fragmentShader, '#include <lights_fragment_maps>', 'iblIrradiance *= pmbIblDiffuse;');
    return;
  }
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

/** Sources du sol et du plafond (exporté pour les tests). */
export function patchSurfaceShader(shader: { vertexShader: string; fragmentShader: string }): void {
  patchGarageShader(shader, { standard: true, surface: true, additive: false });
}

/**
 * Branche un matériau sur le garage : coupe caméra toujours ; part diffuse de la sonde pour un
 * matériau standard ; brume du dehors et réflexion planaire (si `setReflection`) pour une surface.
 * Seul patch des matériaux du décor : la clé de programme dit la variante.
 */
export function patchGarageMaterial(
  material: MeshStandardMaterial | MeshBasicMaterial,
  uniforms: SurfaceUniforms,
  options: { surface?: boolean } = {},
): void {
  const standard = material instanceof MeshStandardMaterial;
  const surface = standard && options.surface === true;
  const variant = (): GarageShaderVariant => {
    const additive = material.blending === AdditiveBlending;
    return { standard, surface, additive, alpha: !additive && material.transparent };
  };
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    if (surface) Object.assign(shader.uniforms, uniforms);
    else {
      shader.uniforms.pmbCutFade = uniforms.pmbCutFade;
      shader.uniforms.pmbIblDiffuse = uniforms.pmbIblDiffuse;
    }
    patchGarageShader(shader, variant());
  };
  material.customProgramCacheKey = () => {
    const { additive, alpha } = variant();
    return `pmb-garage-1:${surface ? 'surface' : standard ? 'decor' : 'basique'}:${additive ? 'additif' : alpha ? 'voile' : 'opaque'}`;
  };
  material.userData.pmbCut = true;
}

/**
 * Matériau patché opaque : sa coupe passe par la trame de points, compilée seulement sous le define
 * PMB_CUT_DITHER (src/render/cutDither.ts). Additifs et voiles s'effacent sans rejet de fragments.
 * Même règle que la variante de `patchGarageMaterial`.
 */
export function isDitherCarrier(material: Material): boolean {
  return material.userData.pmbCut === true && material.blending !== AdditiveBlending && !material.transparent;
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
