// Matières de nuit de la sortie (§ 5.5, § 8) : une par rôle de tronçon (fusion_<rôle>, voir
// MapMaterialRole), posées par l'app sur la géométrie de la carte. Toutes partagent un jeu
// d'uniformes (`NightUniforms`) que la scène met à jour à chaque image : temps, pluie, phares,
// lampadaires proches, reflet planaire de la chaussée.
//
// Ce que les nuanceurs ajoutent à la matière standard de three :
// - lampadaires (PMB_LAMPS) : flaque de lumière au sol et reflet étiré sur le mouillé, calculés pour
//   les quelques lampadaires les plus proches (pas de vraies lumières : une boucle bornée) ;
// - chaussée mouillée (PMB_WET) : rugosité qui baisse avec la pluie, flaques en bruit de valeur ;
// - reflet planaire (PMB_REFLECT) : la scène vue dans la chaussée (src/render/planarReflection.ts) ;
// - catadioptres (PMB_RETRO) : marquage, glissières et balises renvoient la lumière des phares vers
//   qui la regarde depuis le véhicule ;
// - fenêtres (PMB_WINDOWS) : une fenêtre sur deux ou trois allumée, tirée au hasard par case, quelques
//   écrans bleutés ; les autres restent des vitres sombres.

import {
  BufferAttribute,
  Color,
  DataTexture,
  Matrix4,
  MeshStandardMaterial,
  Vector2,
  Vector3,
  type Material,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type { MapMaterialRole } from '../../data/mapTypes.ts';

/** Lampadaires qui éclairent la chaussée, au plus (taille du tableau d'uniformes). */
export const MAX_LAMPS = 16;
/**
 * Les premiers de la liste (les plus proches) sont aussi de vraies lumières de la scène, qui
 * éclairent la caisse et font leur flaque elles-mêmes : le nuanceur n'en garde que le reflet.
 */
export const REAL_LAMPS = 2;

export interface NightUniforms {
  pmbTime: { value: number };
  /** 0 : sec (chaussée humide) ; 1 : pluie. */
  pmbWet: { value: number };
  pmbRain: { value: number };
  /** Milieu des phares et direction du faisceau, dans le repère de la carte. */
  pmbHeadPos: { value: Vector3 };
  pmbHeadDir: { value: Vector3 };
  pmbHeadOn: { value: number };
  /** Têtes des lampadaires proches (3 nombres chacun) et leur nombre. */
  pmbLamps: { value: Float32Array };
  pmbLampCount: { value: number };
  pmbLampColor: { value: Color };
  // Reflet planaire : mêmes noms que la réflexion du garage (src/render/planarReflection.ts).
  pmbReflection: { value: Texture | null };
  pmbReflectionBlur: { value: Texture | null };
  pmbReflectionMatrix: { value: Matrix4 };
  pmbReflectionStrength: { value: number };
  pmbReflectionTexel: { value: Vector2 };
}

const BLACK = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
BLACK.needsUpdate = true;

export function createNightUniforms(): NightUniforms {
  return {
    pmbTime: { value: 0 },
    pmbWet: { value: 0 },
    pmbRain: { value: 0 },
    pmbHeadPos: { value: new Vector3() },
    pmbHeadDir: { value: new Vector3(1, 0, 0) },
    pmbHeadOn: { value: 1 },
    pmbLamps: { value: new Float32Array(MAX_LAMPS * 3) },
    pmbLampCount: { value: 0 },
    pmbLampColor: { value: new Color('#ffa457') },
    pmbReflection: { value: BLACK },
    pmbReflectionBlur: { value: BLACK },
    pmbReflectionMatrix: { value: new Matrix4() },
    pmbReflectionStrength: { value: 0 },
    pmbReflectionTexel: { value: new Vector2(1, 1) },
  };
}

const VERTEX_HEAD = /* glsl */ `
varying vec3 vPmbWorld;
varying vec3 vPmbNormal;
#ifdef PMB_EMIT
attribute float pmbEmit;
varying float vPmbEmit;
#endif
`;

const VERTEX_BODY = /* glsl */ `
#include <project_vertex>
{
  vec4 pmbWp = vec4( transformed, 1.0 );
  vec3 pmbN = objectNormal;
  #ifdef USE_INSTANCING
  pmbWp = instanceMatrix * pmbWp;
  pmbN = mat3( instanceMatrix ) * pmbN;
  #endif
  pmbWp = modelMatrix * pmbWp;
  vPmbWorld = pmbWp.xyz;
  vPmbNormal = mat3( modelMatrix ) * pmbN;
  #ifdef PMB_EMIT
  vPmbEmit = pmbEmit;
  #endif
}
`;

const FRAGMENT_HEAD = /* glsl */ `
#define PMB_GLARE_MAX 3.0
#define PMB_REAL_LAMPS ${REAL_LAMPS}
varying vec3 vPmbWorld;
varying vec3 vPmbNormal;
#ifdef PMB_EMIT
varying float vPmbEmit;
#endif
uniform float pmbTime;
uniform float pmbWet;
uniform float pmbRain;
uniform vec3 pmbHeadPos;
uniform vec3 pmbHeadDir;
uniform float pmbHeadOn;
uniform vec3 pmbLamps[ ${MAX_LAMPS} ];
uniform int pmbLampCount;
uniform vec3 pmbLampColor;
uniform sampler2D pmbReflection;
uniform sampler2D pmbReflectionBlur;
uniform mat4 pmbReflectionMatrix;
uniform float pmbReflectionStrength;
float pmbHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float pmbNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( pmbHash( i ), pmbHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( pmbHash( i + vec2( 0.0, 1.0 ) ), pmbHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
`;

// Après l'éclairage direct : reflet direct borné (éblouissement des phares vu de face), et champ
// proche des phares adouci comme celui d'un vrai code (le faisceau coupe vers le bas : le sol au pied
// du véhicule reçoit bien moins que la pleine intensité d'un projecteur rond).
const HEADLIGHT_PATCH = /* glsl */ `
#ifdef PMB_DIRECT_SPEC
reflectedLight.directSpecular = min( reflectedLight.directSpecular * PMB_DIRECT_SPEC, vec3( 0.06 ) );
{
  vec3 hv = vPmbWorld - pmbHeadPos;
  float front = step( 0.0, dot( hv, pmbHeadDir ) ) * pmbHeadOn;
  reflectedLight.directDiffuse *= mix( 1.0, mix( 0.18, 1.0, smoothstep( 2.0, 16.0, length( hv ) ) ), front );
}
#endif
`;

const ROUGHNESS_PATCH = /* glsl */ `
#include <roughnessmap_fragment>
float pmbPuddle = 0.0;
float pmbGloss = 0.0;
#ifdef PMB_WET
pmbPuddle = pmbRain * smoothstep( 0.5, 0.78, pmbNoise( vPmbWorld.xz * 0.055 ) * 0.75 + pmbNoise( vPmbWorld.xz * 0.16 + 7.3 ) * 0.25 );
roughnessFactor = mix( roughnessFactor, PMB_WET_ROUGH, pmbWet );
roughnessFactor = mix( roughnessFactor, 0.035, pmbPuddle );
diffuseColor.rgb *= 1.0 - 0.75 * pmbWet - 0.2 * pmbPuddle;
#endif
pmbGloss = clamp( 1.0 - roughnessFactor * 1.6, 0.0, 1.0 );
`;

const EMISSIVE_PATCH = /* glsl */ `
#include <emissivemap_fragment>
#ifdef PMB_EMIT
totalEmissiveRadiance += vPmbEmit * pmbLampColor * 9.0;
#endif
#ifdef PMB_WINDOWS
{
  vec3 nW = normalize( vPmbNormal );
  vec2 td = normalize( vec2( -nW.z, nW.x ) + vec2( 1e-4 ) );
  float a = dot( vPmbWorld.xz, td ) / 1.7;
  float cell = floor( a );
  float fr = fract( a );
  float lvl = floor( vPmbWorld.y / 3.0 );
  vec2 blk = floor( vPmbWorld.xz / 12.0 );
  float h1 = pmbHash( vec2( cell + blk.x * 17.0, lvl * 7.0 + blk.y * 13.0 ) );
  float h2 = pmbHash( vec2( cell * 1.7 + 3.1 + blk.y, lvl * 2.3 + blk.x ) );
  float frameMask = step( 0.12, fr ) * step( fr, 0.88 );
  float lit = step( 0.6, h1 ) * frameMask;
  vec3 warm = mix( vec3( 1.0, 0.5, 0.18 ), vec3( 1.0, 0.8, 0.55 ), h2 );
  vec3 tv = vec3( 0.25, 0.42, 1.0 ) * ( 0.65 + 0.35 * sin( pmbTime * ( 4.0 + h2 * 7.0 ) + h1 * 30.0 ) );
  vec3 c = h2 > 0.88 ? tv : warm;
  totalEmissiveRadiance += lit * c * ( 0.9 + 2.2 * h2 );
  diffuseColor.rgb = mix( vec3( 0.012 ), diffuseColor.rgb, frameMask );
}
#endif
`;

const OUTPUT_PATCH = /* glsl */ `
{
  vec3 pW = vPmbWorld;
  vec3 pmbV = normalize( cameraPosition - pW );
  vec3 pmbNw = normalize( vPmbNormal );
  float pmbF = 0.03 + 0.97 * pow( 1.0 - clamp( dot( pmbNw, pmbV ), 0.0, 1.0 ), 5.0 );
  vec3 pmbExtra = vec3( 0.0 );
  #ifdef PMB_LAMPS
  {
    float shin = mix( 12.0, 340.0, pmbGloss );
    vec3 sum = vec3( 0.0 );
    for ( int i = 0; i < ${MAX_LAMPS}; i ++ ) {
      if ( i >= pmbLampCount ) break;
      vec3 Lv = pmbLamps[ i ] - pW;
      float d2 = dot( Lv, Lv );
      vec3 L = Lv * inversesqrt( d2 );
      float att = 64.0 / max( d2, 16.0 );
      float down = smoothstep( 0.32, 0.86, L.y );
      float ndl = max( dot( pmbNw, L ), 0.0 );
      if ( i >= PMB_REAL_LAMPS ) sum += diffuseColor.rgb * ndl * att * down * PMB_LAMP_DIFFUSE;
      vec3 H = normalize( L + pmbV );
      sum += vec3( pmbF * pow( max( dot( pmbNw, H ), 0.0 ), shin ) * att * shin * 0.012 * PMB_LAMP_SPEC * ( 0.3 + 0.7 * down ) );
    }
    pmbExtra += sum * pmbLampColor;
  }
  #endif
  #ifdef PMB_RETRO
  {
    vec3 Lh = pmbHeadPos - pW;
    float dh2 = dot( Lh, Lh );
    vec3 Lhn = Lh * inversesqrt( dh2 );
    float cone = smoothstep( 0.82, 0.96, dot( -Lhn, pmbHeadDir ) );
    pmbExtra += diffuseColor.rgb * pow( max( dot( Lhn, pmbV ), 0.0 ), 10.0 ) * cone * pmbHeadOn * PMB_RETRO / ( 1.0 + dh2 * 0.006 );
  }
  #endif
  #ifdef PMB_REFLECT
  {
    vec4 rc = pmbReflectionMatrix * vec4( pW, 1.0 );
    vec2 ruv = clamp( rc.xy / max( rc.w, 1e-4 ), 0.001, 0.999 );
    vec3 sharpR = texture2D( pmbReflection, ruv ).rgb;
    vec3 blurR = texture2D( pmbReflectionBlur, ruv ).rgb;
    float fade = 1.0 - smoothstep( 60.0, 160.0, length( cameraPosition - pW ) );
    pmbExtra += mix( blurR, sharpR, 0.3 + 0.4 * pmbPuddle ) * pmbF * pmbReflectionStrength * ( 0.25 + 0.75 * pmbGloss ) * fade;
  }
  #endif
  outgoingLight += pmbExtra;
  // Éblouissement borné : le reflet des phares sur le mouillé, vu de face, ne doit pas saturer
  // toute l'image (le bloom l'étalerait) ; une valeur invalide retombe au noir.
  outgoingLight = clamp( outgoingLight, 0.0, PMB_GLARE_MAX );
  if ( any( isnan( outgoingLight ) ) ) outgoingLight = vec3( 0.0 );
}
#include <opaque_fragment>
`;

export interface NightPatch {
  lamps?: { diffuse: number; spec: number };
  wet?: { rough: number };
  reflect?: boolean;
  retro?: number;
  windows?: boolean;
  emit?: boolean;
}

const fixed = (value: number) => value.toFixed(4);

/** Pose les ajouts de nuit sur une matière standard (une clé de programme par combinaison). */
export function patchNight<T extends MeshStandardMaterial>(material: T, uniforms: NightUniforms, patch: NightPatch): T {
  const defines: Record<string, string> = {};
  if (patch.lamps) {
    defines.PMB_LAMPS = '';
    defines.PMB_LAMP_DIFFUSE = fixed(patch.lamps.diffuse);
    defines.PMB_LAMP_SPEC = fixed(patch.lamps.spec);
  }
  if (patch.wet) {
    defines.PMB_WET = '';
    defines.PMB_WET_ROUGH = fixed(patch.wet.rough);
  }
  // Reflet direct des vraies lumières (phares surtout) atténué sur le mouillé et borné partout : vus
  // de face et en rasant, les phares feraient sinon un éblouissement qui blanchit le bas de l'image.
  // Les reflets des lampadaires (calculés plus bas) et le reflet planaire restent entiers.
  defines.PMB_DIRECT_SPEC = patch.wet ? '0.3' : '1.0';
  if (patch.reflect) defines.PMB_REFLECT = '';
  if (patch.retro !== undefined) defines.PMB_RETRO = fixed(patch.retro);
  if (patch.windows) defines.PMB_WINDOWS = '';
  if (patch.emit) defines.PMB_EMIT = '';
  material.defines = { ...material.defines, ...defines };
  const key = `pmb-nuit:${Object.entries(defines)
    .map(([k, v]) => `${k}=${v}`)
    .join(',')}`;
  material.customProgramCacheKey = () => key;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = VERTEX_HEAD + shader.vertexShader.replace('#include <project_vertex>', VERTEX_BODY);
    shader.fragmentShader =
      FRAGMENT_HEAD +
      shader.fragmentShader
        .replace('#include <roughnessmap_fragment>', ROUGHNESS_PATCH)
        .replace('#include <emissivemap_fragment>', EMISSIVE_PATCH)
        .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n' + HEADLIGHT_PATCH)
        .replace('#include <opaque_fragment>', OUTPUT_PATCH);
  };
  return material;
}

/** Réglage de chaque rôle : teinte de nuit, rugosité, métal, ajouts. Données, pas de code. */
interface RoleLook {
  color: string;
  roughness: number;
  metalness?: number;
  envMapIntensity?: number;
  patch: NightPatch;
  /** Hors du reflet planaire (la chaussée ne se reflète pas en elle-même). */
  noMirror?: boolean;
}

export const ROLE_LOOKS: Readonly<Record<MapMaterialRole, RoleLook>> = {
  chaussee: { color: '#2a2b2f', roughness: 0.42, envMapIntensity: 0.35, patch: { lamps: { diffuse: 3, spec: 6 }, wet: { rough: 0.08 }, reflect: true }, noMirror: true },
  voie: { color: '#242528', roughness: 0.6, envMapIntensity: 0.3, patch: { lamps: { diffuse: 3, spec: 2.4 }, wet: { rough: 0.18 }, reflect: true }, noMirror: true },
  marquage: { color: '#8e8c85', roughness: 0.5, envMapIntensity: 0.3, patch: { lamps: { diffuse: 1.6, spec: 1.6 }, wet: { rough: 0.22 }, reflect: true, retro: 7 }, noMirror: true },
  accotement: { color: '#1e1c19', roughness: 0.92, envMapIntensity: 0.15, patch: { lamps: { diffuse: 7, spec: 0.3 }, wet: { rough: 0.5 } }, noMirror: true },
  terrain: { color: '#182017', roughness: 1, envMapIntensity: 0.08, patch: { lamps: { diffuse: 6, spec: 0 } } },
  eau: { color: '#010207', roughness: 0.05, envMapIntensity: 3, patch: { lamps: { diffuse: 0, spec: 2.5 } }, noMirror: true },
  mur: { color: '#2a2724', roughness: 0.9, envMapIntensity: 0.15, patch: { lamps: { diffuse: 5, spec: 0.1 } } },
  toit: { color: '#161414', roughness: 0.85, envMapIntensity: 0.15, patch: {} },
  fenetre: { color: '#20242c', roughness: 0.12, envMapIntensity: 0.8, patch: { windows: true } },
  ouvrage: { color: '#25262a', roughness: 0.85, envMapIntensity: 0.15, patch: { lamps: { diffuse: 5, spec: 0.2 } } },
  glissiere: { color: '#7d8186', roughness: 0.35, metalness: 0.75, envMapIntensity: 0.7, patch: { retro: 3.5 } },
};

/** Les matières des rôles, une par rôle, partagées par tous les tronçons. */
export function createRoleMaterials(uniforms: NightUniforms): Map<string, MeshStandardMaterial> {
  const out = new Map<string, MeshStandardMaterial>();
  for (const [role, look] of Object.entries(ROLE_LOOKS) as Array<[MapMaterialRole, RoleLook]>) {
    const m = new MeshStandardMaterial({ color: look.color, roughness: look.roughness, metalness: look.metalness ?? 0, envMapIntensity: look.envMapIntensity ?? 1 });
    m.name = `nuit_${role}`;
    patchNight(m, uniforms, look.patch);
    out.set(role, m);
  }
  return out;
}

export function isNoMirror(role: string): boolean {
  return ROLE_LOOKS[role as MapMaterialRole]?.noMirror === true;
}

/** Attribut d'émission (0 ou 1 par sommet) pour les têtes de lampadaire. */
export function emitAttribute(count: number, from: number): BufferAttribute {
  const data = new Float32Array(count);
  data.fill(1, from);
  return new BufferAttribute(data, 1);
}

export function disposeMaterials(materials: Iterable<Material>): void {
  for (const m of materials) m.dispose();
}
