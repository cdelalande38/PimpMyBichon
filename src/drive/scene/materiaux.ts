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

/** Enseignes au néon les plus proches dont la lumière colorée est calculée au sol et sur les murs. */
export const MAX_NEONS = 6;

export interface NightUniforms {
  pmbTime: { value: number };
  /** 0 : sec (chaussée humide) ; 1 : pluie. */
  pmbWet: { value: number };
  pmbRain: { value: number };
  /** Milieu des phares et direction du faisceau, dans le repère de la carte. */
  pmbHeadPos: { value: Vector3 };
  pmbHeadDir: { value: Vector3 };
  pmbHeadOn: { value: number };
  /** Haut et droite du véhicule (repère de la carte), demi-écart des deux phares (0 : un seul phare, moto). */
  pmbHeadUp: { value: Vector3 };
  pmbHeadRight: { value: Vector3 };
  pmbHeadSpread: { value: number };
  /** Intensité d'un phare au cœur du faisceau (candelas, à l'échelle de la scène). */
  pmbHeadPower: { value: number };
  pmbHeadColor: { value: Color };
  /** Lune (direction vers elle) et ciel, pour le reflet calculé de l'eau. */
  pmbMoonDir: { value: Vector3 };
  pmbMoonColor: { value: Color };
  pmbSkyHorizon: { value: Color };
  pmbSkyZenith: { value: Color };
  /** Brume au sol : hauteur de sa base (plan d'eau ou creux), densité à la base (1/m), teinte. */
  pmbMistBase: { value: number };
  pmbMistDensity: { value: number };
  pmbMistColor: { value: Color };
  /** Têtes des lampadaires proches (3 nombres chacun) et leur nombre. */
  pmbLamps: { value: Float32Array };
  pmbLampCount: { value: number };
  pmbLampColor: { value: Color };
  /** Enseignes proches : position (3 nombres) et teinte linéaire (3 nombres) de chacune, et leur nombre. */
  pmbNeons: { value: Float32Array };
  pmbNeonColors: { value: Float32Array };
  pmbNeonCount: { value: number };
  // Reflet planaire : mêmes noms que la réflexion du garage (src/render/planarReflection.ts).
  pmbReflection: { value: Texture | null };
  pmbReflectionBlur: { value: Texture | null };
  pmbReflectionMatrix: { value: Matrix4 };
  pmbReflectionStrength: { value: number };
  pmbReflectionTexel: { value: Vector2 };
}

/**
 * Feux de croisement (calculés dans les nuanceurs, pas de vraie lumière) : intensité au cœur du
 * faisceau, teinte halogène. La forme (coupure, lobes) est dans HEAD_BEAM plus bas.
 */
export const HEADLIGHT = { power: 17000, color: '#ffe9cc' } as const;

/** Lune basse au sud-est (devant le véhicule sur la plus grande partie du parcours) et ciel qu'elle éclaire. */
export const MOON = {
  direction: [0.42, 0.25, 0.87] as const,
  color: '#c9d6ff',
  horizon: '#33497f',
  zenith: '#060b1e',
} as const;

/** Brume au sol : densité à sa base (1/m), épaisseur (m, décroissance exponentielle), teinte éclairée par la lune. */
export const MIST = { density: 0.014, thickness: 3.2, color: '#3a4870' } as const;

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
    pmbHeadUp: { value: new Vector3(0, 1, 0) },
    pmbHeadRight: { value: new Vector3(0, 0, 1) },
    pmbHeadSpread: { value: 0.65 },
    pmbHeadPower: { value: HEADLIGHT.power },
    pmbHeadColor: { value: new Color(HEADLIGHT.color) },
    pmbMoonDir: { value: new Vector3(...MOON.direction).normalize() },
    pmbMoonColor: { value: new Color(MOON.color) },
    pmbSkyHorizon: { value: new Color(MOON.horizon) },
    pmbSkyZenith: { value: new Color(MOON.zenith) },
    pmbMistBase: { value: -1e4 },
    pmbMistDensity: { value: MIST.density },
    pmbMistColor: { value: new Color(MIST.color) },
    pmbLamps: { value: new Float32Array(MAX_LAMPS * 3) },
    pmbLampCount: { value: 0 },
    pmbLampColor: { value: new Color('#ffa457') },
    pmbNeons: { value: new Float32Array(MAX_NEONS * 3) },
    pmbNeonColors: { value: new Float32Array(MAX_NEONS * 3) },
    pmbNeonCount: { value: 0 },
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

/**
 * Feux de croisement, pour la droite de la chaussée : intensité relative dans la direction `dir`
 * (unitaire, du phare vers le point). Coupure nette juste sous l'horizontale du véhicule à gauche,
 * relevée de 15° à droite (le bas-côté) ; point chaud juste sous la coupure, un peu à droite, qui
 * porte loin ; avant-champ faible (le sol au pied du véhicule n'est pas une flaque blanche) ; large
 * nappe latérale pour les bas-côtés. Le faisceau suit la caisse : sa portée suit la pente.
 */
const HEAD_BEAM = /* glsl */ `
float pmbBeamShape( vec3 dir ) {
  float fwd = dot( dir, pmbHeadDir );
  if ( fwd <= 0.05 ) return 0.0;
  float av = dot( dir, pmbHeadUp );
  // Tangente de l'angle horizontal (assez proche de l'angle dans le faisceau, et sans atan).
  float ah = dot( dir, pmbHeadRight ) / fwd;
  float cut = -0.011 + clamp( ah, 0.0, 0.16 ) * 0.27;
  float above = smoothstep( cut - 0.002, cut + 0.005, av );
  float dv = ( av - cut + 0.004 ) / 0.03;
  float hv = exp( -dv * dv ) + 0.012 * exp( -av * av * 20.0 );
  float h1 = ( ah - 0.03 ) / 0.16;
  float h2 = ah / 0.62;
  float hh = 0.7 * exp( -h1 * h1 ) + 0.3 * exp( -h2 * h2 );
  return hv * hh * mix( 1.0, 0.02, above ) * smoothstep( 0.05, 0.35, fwd );
}
// Éclairement des deux phares au point P (normale N, vue V) : diffus dans .x, reflet dans .y.
vec2 pmbHeadLight( vec3 P, vec3 N, vec3 V, float shin ) {
  vec2 sum = vec2( 0.0 );
  // Au-delà de 160 m, le faisceau ne compte plus (et derrière le véhicule, il n'éclaire rien).
  vec3 rel = P - pmbHeadPos;
  if ( dot( rel, rel ) > 25600.0 || dot( rel, pmbHeadDir ) < -1.0 ) return sum;
  for ( int k = 0; k < 2; k ++ ) {
    float side = k == 0 ? 1.0 : -1.0;
    if ( k == 1 && pmbHeadSpread <= 0.0 ) break;
    vec3 Lp = pmbHeadPos + pmbHeadRight * pmbHeadSpread * side;
    vec3 v = P - Lp;
    float d2 = max( dot( v, v ), 0.25 );
    vec3 dir = v * inversesqrt( d2 );
    float I = pmbBeamShape( dir ) * pmbHeadPower / d2;
    vec3 L = -dir;
    sum.x += I * max( dot( N, L ), 0.0 );
    vec3 H = normalize( L + V );
    sum.y += I * pow( max( dot( N, H ), 0.0 ), shin ) * ( shin + 2.0 ) * 0.04;
  }
  return sum * pmbHeadOn;
}
vec3 pmbSky( vec3 R ) {
  float y = clamp( R.y, 0.0, 1.0 );
  vec3 c = mix( pmbSkyHorizon, pmbSkyZenith, smoothstep( 0.0, 0.45, y ) );
  float m = max( dot( R, pmbMoonDir ), 0.0 );
  return c + pmbMoonColor * ( pow( m, 14.0 ) * 0.22 + pow( m, 600.0 ) * 40.0 );
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
uniform vec3 pmbHeadUp;
uniform vec3 pmbHeadRight;
uniform float pmbHeadSpread;
uniform float pmbHeadPower;
uniform vec3 pmbHeadColor;
uniform vec3 pmbMoonDir;
uniform vec3 pmbMoonColor;
uniform vec3 pmbSkyHorizon;
uniform vec3 pmbSkyZenith;
uniform float pmbMistBase;
uniform float pmbMistDensity;
uniform vec3 pmbMistColor;
uniform vec3 pmbLamps[ ${MAX_LAMPS} ];
uniform int pmbLampCount;
uniform vec3 pmbLampColor;
uniform vec3 pmbNeons[ ${MAX_NEONS} ];
uniform vec3 pmbNeonColors[ ${MAX_NEONS} ];
uniform int pmbNeonCount;
uniform sampler2D pmbReflection;
uniform sampler2D pmbReflectionBlur;
uniform mat4 pmbReflectionMatrix;
uniform float pmbReflectionStrength;
// Hachage sans sinus (le sinus d'un grand nombre se dégrade en aplats sur le processeur graphique),
// périodique sur 1024 cases : sans couture, sans motif visible à l'échelle de la carte.
float pmbHash( vec2 p ) {
  p = mod( p, 1024.0 );
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float pmbNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( pmbHash( i ), pmbHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( pmbHash( i + vec2( 0.0, 1.0 ) ), pmbHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
${HEAD_BEAM}
`;

// Après l'éclairage direct : le reflet direct des vraies lumières (lune, lampadaires proches, feux
// arrière) est atténué sur le mouillé et borné (la lune basse ferait sinon une nappe blanche), pour qu'un reflet vu de face ne blanchisse pas l'image.
const HEADLIGHT_PATCH = /* glsl */ `
#ifdef PMB_DIRECT_SPEC
reflectedLight.directSpecular = min( reflectedLight.directSpecular * PMB_DIRECT_SPEC, vec3( 0.05 ) );
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
float pmbGrain = 0.5;
#ifdef PMB_GRAIN
{
  // Enrobé : granulats (fins, effacés au loin), reprises et usure en plaques ; rien de téléchargé.
  vec2 q = vPmbWorld.xz;
  float px = length( fwidth( q ) );
  float fine = 1.0 - smoothstep( 0.006, 0.03, px );
  float g1 = pmbNoise( q * 7.0 );
  float g2 = pmbHash( floor( q * 55.0 ) );
  float patchy = pmbNoise( q * 0.21 + 3.7 ) * 0.6 + pmbNoise( q * 0.9 ) * 0.4;
  pmbGrain = mix( 0.5, g2, fine * 0.8 ) * 0.6 + g1 * 0.4;
  diffuseColor.rgb *= ( 0.62 + 0.76 * pmbGrain ) * ( 0.8 + 0.4 * patchy );
  roughnessFactor = clamp( roughnessFactor * ( 0.8 + 0.45 * g1 ), 0.03, 1.0 );
}
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
  {
    // Phares du véhicule : diffus sur tout le décor, reflet sur le mouillé (vu de face, la traînée).
    float hShin = mix( 8.0, 260.0, pmbGloss );
    vec2 hl = pmbHeadLight( pW, pmbNw, pmbV, hShin );
    pmbExtra += pmbHeadColor * ( diffuseColor.rgb * hl.x * PMB_HEAD_DIFFUSE + hl.y * pmbF * PMB_HEAD_SPEC * ( 0.2 + 0.8 * pmbRain ) * ( 0.55 + 0.9 * pmbGrain ) );
  }
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
    // Enseignes au néon proches : leur lumière colorée sur la chaussée et les murs, et son reflet.
    vec3 neon = vec3( 0.0 );
    for ( int i = 0; i < ${MAX_NEONS}; i ++ ) {
      if ( i >= pmbNeonCount ) break;
      vec3 Lv = pmbNeons[ i ] - pW;
      float d2 = dot( Lv, Lv );
      vec3 L = Lv * inversesqrt( d2 );
      float att = 10.0 / max( d2, 3.0 );
      vec3 H = normalize( L + pmbV );
      neon += pmbNeonColors[ i ] * att * ( diffuseColor.rgb * max( dot( pmbNw, L ), 0.0 ) * PMB_LAMP_DIFFUSE * 0.6 + vec3( pmbF * pow( max( dot( pmbNw, H ), 0.0 ), shin ) * shin * 0.012 * PMB_LAMP_SPEC ) );
    }
    pmbExtra += neon;
  }
  #endif
  #ifdef PMB_RETRO
  {
    vec3 Lh = pmbHeadPos - pW;
    float dh2 = dot( Lh, Lh );
    vec3 Lhn = Lh * inversesqrt( dh2 );
    float cone = min( 1.0, pmbBeamShape( -Lhn ) * 1.6 );
    pmbExtra += pmbHeadColor * diffuseColor.rgb * pow( max( dot( Lhn, pmbV ), 0.0 ), 10.0 ) * cone * pmbHeadOn * PMB_RETRO / ( 1.0 + dh2 * 0.004 );
  }
  #endif
  #ifdef PMB_WATER
  {
    // Eau : rides animées, reflet du ciel calculé (l'horizon clair dessine les lacs sur la rive
    // sombre) et chemin de lune qui scintille.
    vec2 q = pW.xz;
    float t = pmbTime;
    vec2 e = vec2( 0.6, 0.0 );
    #define PMB_RIPPLE( p ) ( pmbNoise( ( p ) * 0.3 + vec2( t * 0.07, t * 0.04 ) ) + 0.5 * pmbNoise( ( p ) * 1.3 - vec2( t * 0.13, -t * 0.09 ) ) + 0.25 * pmbNoise( ( p ) * 4.1 + vec2( t * 0.3, t * 0.21 ) ) )
    float r0 = PMB_RIPPLE( q );
    float gx = PMB_RIPPLE( q + e.xy ) - r0;
    float gz = PMB_RIPPLE( q + e.yx ) - r0;
    vec3 Nw = normalize( vec3( -gx * PMB_WATER, 1.0, -gz * PMB_WATER ) );
    vec3 R = reflect( -pmbV, Nw );
    R.y = abs( R.y );
    float Fw = 0.02 + 0.98 * pow( 1.0 - clamp( dot( Nw, pmbV ), 0.0, 1.0 ), 5.0 );
    pmbExtra += pmbSky( R ) * Fw;
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

// Brume : celle de three (FogExp2, l'horizon), puis la brume au sol, dense à sa base (plan d'eau
// proche ou creux sous la route) et qui s'efface en quelques mètres de hauteur ; sa densité est
// intégrée le long du rayon de vue (formule fermée d'une densité exponentielle en hauteur).
const FOG_PATCH = /* glsl */ `
#ifdef USE_FOG
{
  #ifdef FOG_EXP2
  float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
  float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
  vec3 ray = vPmbWorld - cameraPosition;
  float L = length( ray );
  float b = 1.0 / ${MIST.thickness.toFixed(2)};
  float y0 = max( cameraPosition.y - pmbMistBase, 0.0 );
  float y1 = max( vPmbWorld.y - pmbMistBase, 0.0 );
  float dy = y1 - y0;
  float col = abs( dy ) > 0.01 ? ( exp( -b * y0 ) - exp( -b * y1 ) ) / ( b * dy ) : exp( -b * y0 );
  float mist = 1.0 - exp( -pmbMistDensity * L * col );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, pmbMistColor, mist * ( 1.0 - fogFactor ) );
}
#endif
`;

export interface NightPatch {
  lamps?: { diffuse: number; spec: number };
  wet?: { rough: number };
  reflect?: boolean;
  retro?: number;
  windows?: boolean;
  emit?: boolean;
  /** Enrobé de la chaussée (grain procédural). */
  grain?: boolean;
  /** Eau : force des rides du reflet calculé. */
  water?: number;
  /** Part des phares : diffus et reflet (1 par défaut). */
  head?: { diffuse: number; spec: number };
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
  defines.PMB_DIRECT_SPEC = patch.wet ? '0.25' : '1.0';
  if (patch.reflect) defines.PMB_REFLECT = '';
  if (patch.retro !== undefined) defines.PMB_RETRO = fixed(patch.retro);
  if (patch.windows) defines.PMB_WINDOWS = '';
  if (patch.emit) defines.PMB_EMIT = '';
  if (patch.grain) defines.PMB_GRAIN = '';
  if (patch.water !== undefined) defines.PMB_WATER = fixed(patch.water);
  defines.PMB_HEAD_DIFFUSE = fixed(patch.head?.diffuse ?? 1);
  defines.PMB_HEAD_SPEC = fixed(patch.head?.spec ?? 1);
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
        .replace('#include <opaque_fragment>', OUTPUT_PATCH)
        .replace('#include <fog_fragment>', FOG_PATCH);
  };
  return material;
}

/**
 * Réglage de chaque rôle : teinte de nuit, rugosité, métal, ajouts. Données, pas de code. La chaussée
 * prend peu de la sonde (faite pour la caisse : elle y verrait la bande d'horizon en miroir) ; son
 * reflet vient du reflet planaire.
 */
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
  chaussee: { color: '#2c2d31', roughness: 0.5, envMapIntensity: 0.1, patch: { lamps: { diffuse: 1.9, spec: 6 }, wet: { rough: 0.08 }, reflect: true, grain: true, head: { diffuse: 1, spec: 0.3 } }, noMirror: true },
  voie: { color: '#28292d', roughness: 0.6, envMapIntensity: 0.1, patch: { lamps: { diffuse: 1.9, spec: 2.4 }, wet: { rough: 0.18 }, reflect: true, grain: true, head: { diffuse: 1, spec: 0.3 } }, noMirror: true },
  marquage: { color: '#a19f97', roughness: 0.5, envMapIntensity: 0.12, patch: { lamps: { diffuse: 1.6, spec: 1.6 }, wet: { rough: 0.22 }, reflect: true, retro: 9 }, noMirror: true },
  accotement: { color: '#24211d', roughness: 0.92, envMapIntensity: 0.08, patch: { lamps: { diffuse: 7, spec: 0.3 }, wet: { rough: 0.5 }, head: { diffuse: 0.7, spec: 0.3 } }, noMirror: true },
  terrain: { color: '#26301f', roughness: 1, envMapIntensity: 0.1, patch: { lamps: { diffuse: 6, spec: 0 }, head: { diffuse: 0.6, spec: 0 } } },
  eau: { color: '#010207', roughness: 0.05, envMapIntensity: 0.5, patch: { lamps: { diffuse: 0, spec: 2.5 }, water: 0.5, head: { diffuse: 0, spec: 1 } }, noMirror: true },
  mur: { color: '#3a3530', roughness: 0.9, envMapIntensity: 0.15, patch: { lamps: { diffuse: 5, spec: 0.1 } } },
  toit: { color: '#1c1a1a', roughness: 0.85, envMapIntensity: 0.15, patch: {} },
  fenetre: { color: '#20242c', roughness: 0.12, envMapIntensity: 0.8, patch: { windows: true } },
  ouvrage: { color: '#3a3b40', roughness: 0.85, envMapIntensity: 0.15, patch: { lamps: { diffuse: 5, spec: 0.2 }, retro: 2 } },
  glissiere: { color: '#8d9196', roughness: 0.35, metalness: 0.75, envMapIntensity: 0.7, patch: { retro: 6, head: { diffuse: 1, spec: 2 } } },
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
