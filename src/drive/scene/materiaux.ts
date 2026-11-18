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
// - façades (PMB_FACADE) : étages, travées, rez-de-chaussée, encadrements, volets, balcons et
//   corniches dessinés par la matière des murs (famille tirée par bâtiment : maison, immeuble, tour),
//   fenêtres allumées par endroits en teintes variées, stores ; aucune texture ;
// - réglettes (PMB_WINDOWS) : les bandes lumineuses des tunnels ;
// - neige (PMB_SNOW) : manteau blanc sur les faces tournées vers le ciel ;
// - abri (PMB_ROAD) : abscisse, écart à l'axe et part « au sec » de chaque sommet de la chaussée
//   (sous un tunnel, ni pluie ni neige ; traces de roues dans la neige).
//
// Le décor ne prend pas la sonde de réflexion (faite pour la caisse) : vue depuis le véhicule et
// remise à jour face par face, elle faisait varier l'éclairage de tout le décor par à-coups. Le ciel
// réfléchi y est calculé (pmbSky).

import {
  BufferAttribute,
  Color,
  DataTexture,
  Matrix4,
  MeshStandardMaterial,
  ShaderChunk,
  Vector2,
  Vector3,
  type Material,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type { MapMaterialRole } from '../../data/mapTypes.ts';
import { SOL_FACADE, SOL_HEAD, SOL_NORMAL, SOL_ROLES, SOL_SURFACE, SOL_TOIT, SOL_UNIFORMS, loadSolTextures, releaseSolTextures, solDefines, type SolUse } from './sol.ts';

/** Lampadaires qui éclairent la chaussée, au plus (taille du tableau d'uniformes). */
export const MAX_LAMPS = 16;
/**
 * Les premiers de la liste (les plus proches) sont aussi de vraies lumières de la scène, qui
 * éclairent la caisse et font leur flaque elles-mêmes : le nuanceur n'en garde que le reflet.
 */
export const REAL_LAMPS = 2;

/**
 * Part de la distance de bord sur laquelle un lampadaire (ou une enseigne) entre et sort de la liste
 * des plus proches : sa lumière y monte ou s'éteint en fondu, jamais d'un coup.
 */
export const LAMP_FADE = 0.35;

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
  /** Par lampadaire : fondu d'entrée (0 à 1) et part du diffus calculé (le reste vient des vraies lumières). */
  pmbLampW: { value: Float32Array };
  pmbLampCount: { value: number };
  pmbLampColor: { value: Color };
  /** Enseignes proches : position (3 nombres) et teinte linéaire (3 nombres) de chacune, et leur nombre. */
  pmbNeons: { value: Float32Array };
  pmbNeonColors: { value: Float32Array };
  pmbNeonCount: { value: number };
  /** Fondu de chaque enseigne proche (0 à 1). */
  pmbNeonW: { value: Float32Array };
  /** Neige : 0 (aucune) à 1 (manteau blanc, flocons). */
  pmbSnow: { value: number };
  // Reflet planaire : mêmes noms que la réflexion du garage (src/render/planarReflection.ts).
  pmbReflection: { value: Texture | null };
  pmbReflectionBlur: { value: Texture | null };
  pmbReflectionMatrix: { value: Matrix4 };
  pmbReflectionStrength: { value: number };
  pmbReflectionTexel: { value: Vector2 };
  /** Moment (src/data/moments.ts) : fenêtres allumées (1 la nuit, 0 le jour) et têtes de lampadaire allumées. */
  pmbGlow: { value: number };
  pmbLampOn: { value: number };
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
    pmbLampW: { value: new Float32Array(MAX_LAMPS * 2) },
    pmbLampCount: { value: 0 },
    pmbLampColor: { value: new Color('#ffa457') },
    pmbNeons: { value: new Float32Array(MAX_NEONS * 3) },
    pmbNeonColors: { value: new Float32Array(MAX_NEONS * 3) },
    pmbNeonCount: { value: 0 },
    pmbNeonW: { value: new Float32Array(MAX_NEONS) },
    pmbSnow: { value: 0 },
    pmbReflection: { value: BLACK },
    pmbReflectionBlur: { value: BLACK },
    pmbReflectionMatrix: { value: new Matrix4() },
    pmbReflectionStrength: { value: 0 },
    pmbReflectionTexel: { value: new Vector2(1, 1) },
    pmbGlow: { value: 1 },
    pmbLampOn: { value: 1 },
  };
}

const VERTEX_HEAD = /* glsl */ `
varying vec3 vPmbWorld;
varying vec3 vPmbNormal;
#ifdef PMB_ROAD
attribute vec4 pmbRoad;
varying vec4 vPmbRoad;
#endif
#ifdef PMB_FACADE
attribute vec3 pmbFacade;
varying vec3 vPmbFacade;
#endif
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
  #ifdef PMB_ROAD
  vPmbRoad = pmbRoad;
  #endif
  #ifdef PMB_FACADE
  vPmbFacade = pmbFacade;
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
// Le décor ne prend pas la sonde de réflexion (voir l'en-tête du fichier) : ciel réfléchi calculé.
#undef USE_ENVMAP
#define PMB_GLARE_MAX 3.0
varying vec3 vPmbWorld;
varying vec3 vPmbNormal;
#ifdef PMB_ROAD
varying vec4 vPmbRoad;
#endif
#ifdef PMB_FACADE
varying vec3 vPmbFacade;
#endif
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
uniform vec2 pmbLampW[ ${MAX_LAMPS} ];
uniform int pmbLampCount;
uniform vec3 pmbLampColor;
uniform vec3 pmbNeons[ ${MAX_NEONS} ];
uniform vec3 pmbNeonColors[ ${MAX_NEONS} ];
uniform int pmbNeonCount;
uniform float pmbNeonW[ ${MAX_NEONS} ];
uniform float pmbSnow;
uniform sampler2D pmbReflection;
uniform sampler2D pmbReflectionBlur;
uniform mat4 pmbReflectionMatrix;
uniform float pmbReflectionStrength;
uniform float pmbGlow;
uniform float pmbLampOn;
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
// Créneau filtré : 1 entre a et b, bords adoucis sur la largeur d'un pixel (w) ; sans scintillement au loin.
float pmbBox( float x, float a, float b, float w ) {
  return clamp( ( x - a ) / w + 0.5, 0.0, 1.0 ) - clamp( ( x - b ) / w + 0.5, 0.0, 1.0 );
}
${HEAD_BEAM}
${SOL_HEAD}
`;

// Après l'éclairage direct : le reflet direct des vraies lumières (lune, lampadaires proches, feux
// arrière) est atténué sur le mouillé et borné (la lune basse ferait sinon une nappe blanche), pour qu'un reflet vu de face ne blanchisse pas l'image.
const HEADLIGHT_PATCH = /* glsl */ `
#ifdef PMB_ROAD
// Tunnel : lueur chaude des réglettes renvoyée par la voûte et les piédroits.
reflectedLight.indirectDiffuse += ( 1.0 - pmbMoonKeep ) * diffuseColor.rgb * vec3( 1.0, 0.72, 0.45 ) * 0.09;
#endif
#ifdef PMB_DIRECT_SPEC
reflectedLight.directSpecular = min( reflectedLight.directSpecular * PMB_DIRECT_SPEC, vec3( 0.05 ) );
#endif
`;

const ROUGHNESS_PATCH = /* glsl */ `
#include <roughnessmap_fragment>
float pmbPuddle = 0.0;
float pmbGloss = 0.0;
// Météo locale : sous un tunnel (chaussée marquée « au sec » sommet par sommet), ni pluie ni neige.
float pmbDryL = 0.0;
float pmbUrban = 0.0;
#ifdef PMB_ROAD
pmbUrban = step( 1.5, vPmbRoad.z );
pmbDryL = clamp( vPmbRoad.z - 2.0 * pmbUrban, 0.0, 1.0 );
#endif
// Sous la voûte d'un tunnel (demi-largeur négative), ni lune ni ciel : la lumière vient des réglettes.
float pmbMoonKeep = 1.0;
#ifdef PMB_ROAD
pmbMoonKeep = vPmbRoad.w < 0.0 ? 0.08 : 1.0;
#endif
float pmbWetL = pmbWet * ( 1.0 - pmbDryL );
float pmbRainL = pmbRain * ( 1.0 - pmbDryL );
float pmbSnowL = pmbSnow * ( 1.0 - pmbDryL );
float pmbWetA = 0.0;
${SOL_SURFACE}
#ifdef PMB_WET
{
  // Mouillé par plaques : des zones restent plus sèches (reflets cassés, jamais un miroir), des flaques
  // brillent dans les creux.
  vec2 q = vPmbWorld.xz;
  float dryPatch = smoothstep( 0.32, 0.72, pmbNoise( q * 0.09 + 2.1 ) * 0.7 + pmbNoise( q * 0.37 ) * 0.3 );
  pmbWetA = pmbWetL * ( 1.0 - 0.6 * dryPatch );
  pmbPuddle = pmbRainL * smoothstep( 0.6, 0.82, pmbNoise( q * 0.055 ) * 0.75 + pmbNoise( q * 0.16 + 7.3 ) * 0.25 + 0.12 * ( pmbSolLow - 0.5 ) );
  // Creux du relief (liant, joints) plus mouillés que la tête des granulats (sol.ts).
  roughnessFactor = mix( roughnessFactor, PMB_WET_ROUGH, clamp( pmbWetA * ( 0.6 + 0.8 * pmbSolLow ), 0.0, 1.0 ) );
  roughnessFactor = mix( roughnessFactor, 0.05, pmbPuddle );
  diffuseColor.rgb *= 1.0 - 0.55 * pmbWetA - 0.2 * pmbPuddle;
}
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
  #ifdef PMB_SOL_ROUTE
  // Grain lu dans la texture de l'enrobé (sol.ts) ; ici, les seules plaques d'usure.
  pmbGrain = pmbSolGrain;
  diffuseColor.rgb *= 0.88 + 0.24 * patchy;
  #else
  pmbGrain = mix( 0.5, g2, fine * 0.8 ) * 0.6 + g1 * 0.4;
  diffuseColor.rgb *= ( 0.62 + 0.76 * pmbGrain ) * ( 0.8 + 0.4 * patchy );
  #endif
  roughnessFactor = clamp( roughnessFactor * ( 0.8 + 0.45 * g1 ), 0.03, 1.0 );
  #ifdef PMB_ROAD
  {
    // Bord de chaussée : caniveau plus sombre, usure plus claire au passage des roues, regards et
    // plaques de loin en loin (en ville), traces de roues dans la neige.
    float lat = vPmbRoad.y;
    float hw = max( abs( vPmbRoad.w ), 1.5 );
    float edge = abs( lat ) - hw;
    float gutter = pmbBox( edge, -0.55, 0.05, max( px, 0.02 ) );
    diffuseColor.rgb *= 1.0 - 0.35 * gutter;
    float lane = hw > 4.2 ? hw * 0.5 : 0.0;
    float dl = abs( abs( lat ) - lane );
    float wheel = 1.0 - smoothstep( 0.18, 0.42, abs( dl - 0.8 ) );
    diffuseColor.rgb *= 1.0 + 0.12 * wheel * fine;
    roughnessFactor = mix( roughnessFactor, roughnessFactor * 0.85, wheel );
    // Regard : un disque de 0,6 m tous les 37 m environ, sur une voie (au hasard du tronçon).
    float cell = floor( vPmbRoad.x / 37.0 );
    float hc = pmbHash( vec2( cell, 3.0 ) );
    if ( hc > 0.55 ) {
      vec2 c = vec2( ( cell + 0.3 + 0.4 * hc ) * 37.0, ( hc > 0.78 ? 1.0 : -1.0 ) * lane * 0.9 );
      float r = length( vec2( vPmbRoad.x, lat ) - c );
      float lid = 1.0 - smoothstep( 0.27, 0.3, r );
      diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.05 ) * ( 0.7 + 0.6 * step( 0.5, fract( ( vPmbRoad.x - c.x ) * 8.0 ) ) ), lid * fine );
      roughnessFactor = mix( roughnessFactor, 0.35, lid );
    }
    if ( pmbSnowL > 0.001 ) {
      // Neige : chaussée sombre et humide, deux traces de roues par voie, neige tassée entre elles et
      // au bord.
      float n = pmbNoise( q * 1.3 );
      float track = 1.0 - smoothstep( 0.2, 0.38, abs( dl - 0.8 ) + 0.1 * ( n - 0.5 ) );
      float side = smoothstep( -1.6, -0.2, edge );
      float slush = pmbSnowL * clamp( 0.4 * ( 1.0 - track ) * ( 0.4 + 0.7 * n ) + 0.85 * side, 0.0, 1.0 );
      diffuseColor.rgb = mix( diffuseColor.rgb * ( 1.0 - 0.5 * pmbSnowL ), vec3( 0.26, 0.28, 0.31 ), slush );
      roughnessFactor = mix( mix( roughnessFactor, 0.32, pmbSnowL ), 0.85, slush );
    }
  }
  #endif
}
#endif
#ifdef PMB_MARK
{
  // Marquage : usé par endroits ; fondu vers l'enrobé quand il devient plus fin qu'un pixel (sinon il
  // scintille au loin en roulant).
  vec2 q = vPmbWorld.xz;
  float px = length( fwidth( q ) );
  float wear = smoothstep( 0.35, 0.8, pmbNoise( q * 1.7 ) );
  diffuseColor.rgb *= 1.0 - 0.35 * wear;
  diffuseColor.rgb = mix( vec3( 0.07, 0.07, 0.08 ), diffuseColor.rgb, clamp( PMB_MARK / max( px, 1e-4 ), 0.15, 1.0 ) );
}
#endif
#if defined( PMB_GRASS ) && !defined( PMB_SOL_BORD )
{
  // Accotement herbeux : touffes plus claires et terre nue par plaques, effacées au loin.
  vec2 q = vPmbWorld.xz;
  float px = length( fwidth( q ) );
  float fine = 1.0 - smoothstep( 0.02, 0.12, px );
  // En agglomération et sous les tunnels, c'est un trottoir : pas d'herbe.
  float grassy = ( 1.0 - pmbUrban ) * pmbMoonKeep;
  float tuft = smoothstep( 0.45, 0.75, pmbNoise( q * 2.3 ) ) * mix( 0.5, pmbHash( floor( q * 9.0 ) ), fine ) * grassy;
  float bare = smoothstep( 0.55, 0.8, pmbNoise( q * 0.35 + 5.1 ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.13, 0.17, 0.09 ), 0.55 * tuft * ( 1.0 - bare ) * grassy );
  diffuseColor.rgb *= 0.85 + 0.3 * tuft;
}
#endif
float pmbSnowCover = 0.0;
#ifdef PMB_SNOW
if ( pmbSnowL > 0.001 ) {
  // Manteau blanc sur les faces tournées vers le ciel (terrain, accotements, toits, branches).
  float up = normalize( vPmbNormal ).y;
  float n = pmbNoise( vPmbWorld.xz * 0.8 ) - 0.5;
  pmbSnowCover = pmbSnowL * smoothstep( PMB_SNOW, PMB_SNOW + 0.22, up + 0.25 * n );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.44, 0.47, 0.53 ), pmbSnowCover );
  roughnessFactor = mix( roughnessFactor, 0.8, pmbSnowCover );
}
#endif
vec3 pmbFacadeEmit = vec3( 0.0 );
float pmbGlass = 0.0;
#ifdef PMB_FACADE
{
  // Façade dessinée par la matière : vPmbFacade = (pied, sommet, graine) du bâtiment.
  vec3 nW = normalize( vPmbNormal );
  float base = vPmbFacade.x;
  float hgt = max( vPmbFacade.y - base, 2.5 );
  float seed = vPmbFacade.z;
  float y = vPmbWorld.y - base;
  vec3 wallTint;
  float hs = fract( seed * 7.31 );
  // Familles : maison (moins de 8,5 m), immeuble (moins de 26 m), tour.
  float fam = hgt < 8.5 ? 0.0 : ( hgt < 26.0 ? 1.0 : 2.0 );
  if ( fam < 0.5 ) wallTint = hs < 0.4 ? vec3( 0.62, 0.58, 0.52 ) : ( hs < 0.75 ? vec3( 0.72, 0.68, 0.6 ) : vec3( 0.55, 0.5, 0.46 ) );
  else if ( fam < 1.5 ) wallTint = hs < 0.3 ? vec3( 0.78, 0.66, 0.5 ) : ( hs < 0.55 ? vec3( 0.8, 0.77, 0.7 ) : ( hs < 0.8 ? vec3( 0.66, 0.64, 0.62 ) : vec3( 0.78, 0.6, 0.55 ) ) );
  else wallTint = hs < 0.5 ? vec3( 0.55, 0.58, 0.62 ) : vec3( 0.66, 0.66, 0.64 );
  diffuseColor.rgb *= wallTint * 1.6;
  ${SOL_FACADE}
  if ( abs( nW.y ) < 0.6 ) {
    vec2 td = normalize( vec2( -nW.z, nW.x ) + vec2( 1e-4 ) );
    float u = dot( vPmbWorld.xz, td );
    float storey = fam < 0.5 ? 2.8 : ( fam < 1.5 ? 3.0 : 3.4 );
    float ground = fam < 0.5 ? 2.8 : ( fam < 1.5 ? 4.0 : 4.6 );
    float bay = ( fam < 0.5 ? 3.3 : ( fam < 1.5 ? 2.8 : 1.9 ) ) * ( 0.9 + 0.25 * fract( seed * 3.17 ) );
    float isGround = step( y, ground );
    float lvl = isGround > 0.5 ? 0.0 : 1.0 + floor( ( y - ground ) / storey );
    float fy = isGround > 0.5 ? y / ground : fract( ( y - ground ) / storey );
    float cu = u / bay;
    float cx = floor( cu );
    float fx = fract( cu );
    float wu = max( length( vec2( dFdx( cu ), dFdy( cu ) ) ), 1e-4 );
    float wv = max( length( vec2( dFdx( y ), dFdy( y ) ) ) / ( isGround > 0.5 ? ground : storey ), 1e-4 );
    // Au loin, une case fait moins de quelques pixels : le dessin s'efface vers sa moyenne.
    float far = smoothstep( 0.12, 0.45, max( wu, wv ) );
    float h1 = pmbHash( vec2( cx + seed * 31.0, lvl * 7.0 + seed * 13.0 ) );
    float h2 = pmbHash( vec2( cx * 1.7 + 3.1 + seed, lvl * 2.3 + seed * 5.0 ) );
    float x0 = fam < 0.5 ? 0.33 : ( fam < 1.5 ? 0.26 : 0.06 );
    float y0 = fam < 0.5 ? 0.3 : ( fam < 1.5 ? 0.24 : 0.1 );
    float y1 = fam < 0.5 ? 0.78 : ( fam < 1.5 ? 0.8 : 0.92 );
    float shop = 0.0;
    if ( isGround > 0.5 && fam > 0.5 ) {
      // Rez-de-chaussée de ville : vitrines larges, une porte de temps en temps.
      bool door = h1 < 0.22;
      x0 = door ? 0.36 : 0.08;
      y0 = door ? 0.0 : 0.12;
      y1 = door ? 0.62 : 0.72;
      shop = 1.0;
    } else if ( isGround > 0.5 && h1 < 0.18 ) {
      // Porte de maison.
      x0 = 0.36;
      y0 = 0.0;
    }
    float inX = pmbBox( fx, x0, 1.0 - x0, wu );
    float inY = pmbBox( fy, y0, y1, wv );
    float topBand = smoothstep( hgt - 0.55, hgt - 0.45, y );
    float win = inX * inY * ( 1.0 - topBand ) * ( 1.0 - step( hgt - 0.9, y ) * ( 1.0 - isGround ) );
    // Encadrement plus clair autour de la baie (immeubles, maisons), corniche en haut, bandeau
    // au-dessus du rez-de-chaussée.
    float frame = clamp( pmbBox( fx, x0 - 0.06, 1.0 - x0 + 0.06, wu ) * pmbBox( fy, y0 - 0.06, y1 + 0.05, wv ) - inX * inY, 0.0, 1.0 ) * step( fam, 1.5 );
    float cornice = topBand + pmbBox( y, ground - 0.25, ground, wv * storey ) * step( 0.5, fam );
    // Volets des maisons, de chaque côté de la fenêtre ; certains fermés.
    float shutter = 0.0;
    vec3 shutterTint = h2 < 0.33 ? vec3( 0.25, 0.4, 0.3 ) : ( h2 < 0.66 ? vec3( 0.45, 0.3, 0.2 ) : vec3( 0.5, 0.52, 0.55 ) );
    if ( fam < 0.5 && isGround < 0.5 || fam < 0.5 && h1 >= 0.18 ) {
      shutter = ( pmbBox( fx, x0 - 0.17, x0, wu ) + pmbBox( fx, 1.0 - x0, 1.0 - x0 + 0.17, wu ) ) * inY;
      if ( h2 > 0.8 ) {
        shutter = max( shutter, win );
        win = 0.0;
      }
    }
    // Balcons des immeubles : une dalle sombre et un garde-corps sous la baie, un étage sur deux.
    float balcony = 0.0;
    if ( fam > 0.5 && fam < 1.5 && isGround < 0.5 && fract( seed * 5.7 ) > 0.4 && mod( lvl, 2.0 ) < 1.0 )
      balcony = pmbBox( fy, 0.0, 0.07, wv ) + 0.6 * pmbBox( fy, 0.07, 0.3, wv ) * mix( step( 0.5, fract( fx * 14.0 ) ), 0.5, smoothstep( 0.025, 0.06, wu ) ) * inX;
    vec3 wall = diffuseColor.rgb;
    wall = mix( wall, wall * 1.35, clamp( frame + cornice * 0.8, 0.0, 1.0 ) );
    wall = mix( wall, shutterTint * 0.35, clamp( shutter, 0.0, 1.0 ) );
    wall = mix( wall, wall * 0.35, clamp( balcony, 0.0, 1.0 ) );
    // Fenêtres allumées : teintes variées (chaude, neutre, froide, écran bleuté), stores baissés.
    float litP = shop > 0.5 ? 0.55 : ( fam < 0.5 ? 0.45 : ( fam < 1.5 ? 0.42 : 0.38 ) );
    float lit = step( 1.0 - litP, h1 );
    vec3 warm = mix( vec3( 1.0, 0.52, 0.2 ), vec3( 1.0, 0.82, 0.58 ), h2 );
    vec3 cool = vec3( 0.75, 0.85, 1.0 );
    vec3 tv = vec3( 0.25, 0.42, 1.0 ) * ( 0.65 + 0.35 * sin( pmbTime * ( 3.0 + h2 * 5.0 ) + h1 * 30.0 ) );
    vec3 tint = h2 > 0.9 ? tv : ( h2 > 0.72 ? cool : warm );
    if ( shop > 0.5 ) tint = h2 > 0.5 ? vec3( 1.0, 0.9, 0.75 ) : vec3( 0.8, 0.92, 1.0 );
    // Lames des stores : effacées dès qu'elles font moins de deux pixels (sinon elles grouillent).
    float blind = h2 > 0.45 && h2 < 0.62 ? 0.55 + 0.45 * mix( step( 0.5, fract( fy * 18.0 ) ), 0.5, smoothstep( 0.02, 0.05, wv ) ) : 1.0;
    float glow = lit * ( 0.8 + 1.6 * fract( h2 * 13.0 ) ) * blind * ( fam > 1.5 ? 0.9 : 1.0 );
    // Au loin : la moyenne (part des baies allumées), sans motif.
    vec3 near = mix( wall, vec3( 0.012 ), win );
    float winAvg = ( 1.0 - 2.0 * x0 ) * ( y1 - y0 );
    diffuseColor.rgb = mix( near, wall * ( 1.0 - winAvg * 0.8 ), far );
    pmbFacadeEmit = mix( win * tint * glow, tint * litP * winAvg * 1.2, far );
    pmbGlass = win * ( 1.0 - far );
    roughnessFactor = mix( roughnessFactor, 0.1, pmbGlass );
  } else {
    // Toit-terrasse vu de dessous ou de dessus (rare) : rien de plus.
  }
}
#endif
#ifdef PMB_ROOF
{
  // Toits : en pente, tuiles (rangs et joints) ou ardoise ; plats, terrasse gravillonnée et acrotère.
  vec3 nW = normalize( vPmbNormal );
  vec2 q = vPmbWorld.xz;
  float px = length( fwidth( q ) );
  float fine = 1.0 - smoothstep( 0.04, 0.15, px );
  float hb = pmbHash( floor( q / 9.0 ) );
  if ( nW.y < 0.96 ) {
    vec3 tile = hb < 0.55 ? vec3( 0.55, 0.26, 0.17 ) : ( hb < 0.8 ? vec3( 0.3, 0.31, 0.34 ) : vec3( 0.42, 0.36, 0.3 ) );
    float row = fract( vPmbWorld.y * 3.2 );
    vec2 hd = normalize( vec2( -nW.z, nW.x ) + vec2( 1e-4 ) );
    float col = fract( dot( q, hd ) * 2.4 + floor( vPmbWorld.y * 3.2 ) * 0.5 );
    float joint = ( 1.0 - smoothstep( 0.0, 0.12, row ) + ( 1.0 - smoothstep( 0.0, 0.06, min( col, 1.0 - col ) ) ) * 0.6 ) * fine * ( 1.0 - smoothstep( 0.03, 0.08, px ) );
    diffuseColor.rgb = tile * ( 1.0 - 0.45 * clamp( joint, 0.0, 1.0 ) ) * ( 0.85 + 0.3 * pmbNoise( q * 0.6 ) );
  } else {
    float g = pmbHash( floor( q * 6.0 ) );
    diffuseColor.rgb = vec3( 0.32, 0.31, 0.3 ) * ( 0.75 + 0.5 * mix( 0.5, g, fine ) );
  }
  ${SOL_TOIT}
}
#endif
pmbGloss = clamp( 1.0 - roughnessFactor * 1.6, 0.0, 1.0 );
`;

const EMISSIVE_PATCH = /* glsl */ `
#include <emissivemap_fragment>
#ifdef PMB_EMIT
totalEmissiveRadiance += vPmbEmit * pmbLampColor * 9.0 * pmbLampOn;
#endif
#ifdef PMB_WINDOWS
// Réglettes des tunnels (bandes horizontales sous la voûte) : lumière chaude, franche.
totalEmissiveRadiance += vec3( 1.0, 0.72, 0.42 ) * 3.2 * step( 0.5, abs( normalize( vPmbNormal ).y ) );
#endif
totalEmissiveRadiance += pmbFacadeEmit * pmbGlow;
`;

const OUTPUT_PATCH = /* glsl */ `
{
  vec3 pW = vPmbWorld;
  vec3 pmbV = normalize( cameraPosition - pW );
  vec3 pmbNw = normalize( normalize( vPmbNormal ) + pmbSolN );
  float pmbF = 0.03 + 0.97 * pow( 1.0 - clamp( dot( pmbNw, pmbV ), 0.0, 1.0 ), 5.0 );
  vec3 pmbExtra = vec3( 0.0 );
  {
    // Phares du véhicule : diffus sur tout le décor, reflet sur le mouillé (vu de face, la traînée).
    float hShin = mix( 8.0, 260.0, pmbGloss );
    vec2 hl = pmbHeadLight( pW, pmbNw, pmbV, hShin );
    pmbExtra += pmbHeadColor * ( diffuseColor.rgb * hl.x * PMB_HEAD_DIFFUSE + hl.y * pmbF * PMB_HEAD_SPEC * ( 0.12 + 0.88 * max( pmbRainL, pmbWetA ) ) * ( 0.55 + 0.9 * pmbGrain ) );
  }
  #ifdef PMB_LAMPS
  {
    float shin = mix( 12.0, 340.0, pmbGloss );
    vec3 sum = vec3( 0.0 );
    // Au sec, l'enrobé ne renvoie qu'une lueur étalée ; le reflet net des lampes vient avec l'eau.
    #ifdef PMB_WET
    float specWet = 0.18 + 0.82 * pmbWetA;
    #else
    float specWet = 1.0;
    #endif
    for ( int i = 0; i < ${MAX_LAMPS}; i ++ ) {
      if ( i >= pmbLampCount ) break;
      vec2 w = pmbLampW[ i ];
      vec3 Lv = pmbLamps[ i ] - pW;
      float d2 = dot( Lv, Lv );
      vec3 L = Lv * inversesqrt( d2 );
      float att = 64.0 / max( d2, 16.0 );
      float down = smoothstep( 0.32, 0.86, L.y );
      float ndl = max( dot( pmbNw, L ), 0.0 );
      sum += diffuseColor.rgb * ndl * att * down * PMB_LAMP_DIFFUSE * w.y;
      vec3 H = normalize( L + pmbV );
      sum += vec3( pmbF * pow( max( dot( pmbNw, H ), 0.0 ), shin ) * att * shin * 0.012 * PMB_LAMP_SPEC * ( 0.3 + 0.7 * down ) * w.x * specWet );
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
      neon += pmbNeonColors[ i ] * att * pmbNeonW[ i ] * ( diffuseColor.rgb * max( dot( pmbNw, L ), 0.0 ) * PMB_LAMP_DIFFUSE * 0.6 + vec3( pmbF * pow( max( dot( pmbNw, H ), 0.0 ), shin ) * shin * 0.012 * PMB_LAMP_SPEC * specWet ) );
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
  if ( pmbReflectionStrength > 0.0 ) {
    // Reflet planaire, sous la pluie seulement : cassé par le grain de l'enrobé et les zones plus
    // sèches, net dans les flaques.
    vec4 rc = pmbReflectionMatrix * vec4( pW, 1.0 );
    vec2 ruv = clamp( rc.xy / max( rc.w, 1e-4 ), 0.001, 0.999 );
    vec3 sharpR = texture2D( pmbReflection, ruv ).rgb;
    vec3 blurR = texture2D( pmbReflectionBlur, ruv ).rgb;
    float fade = 1.0 - smoothstep( 50.0, 140.0, length( cameraPosition - pW ) );
    float broken = mix( 0.45 + 0.9 * pmbGrain * pmbGrain, 1.0, pmbPuddle );
    pmbExtra += mix( blurR, sharpR, 0.12 + 0.7 * pmbPuddle ) * pmbF * pmbReflectionStrength * pmbWetA * broken * ( 0.25 + 0.75 * pmbGloss ) * fade;
  }
  #endif
  #ifdef PMB_SKY
  {
    // Ciel réfléchi calculé (le décor ne prend pas la sonde) : vitres, métal des glissières.
    vec3 R = reflect( -pmbV, pmbNw );
    R.y = abs( R.y );
    pmbExtra += pmbSky( R ) * mix( pmbF, 1.0, PMB_SKY_METAL ) * PMB_SKY * mix( 0.6, 1.0, pmbGloss );
  }
  #endif
  #ifdef PMB_FACADE
  {
    vec3 R = reflect( -pmbV, pmbNw );
    R.y = abs( R.y );
    pmbExtra += pmbSky( R ) * pmbF * pmbGlass * 0.9;
  }
  #endif
  #ifdef PMB_SNOW
  // Neige : la lumière des lampes et des phares prend davantage sur le blanc.
  pmbExtra *= 1.0 + 0.15 * pmbSnowCover;
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
  /** Attribut `pmbRoad` (abscisse, écart à l'axe, part au sec, demi-largeur) posé au chargement du tronçon. */
  road?: boolean;
  /** Façades dessinées (attribut `pmbFacade` : pied, sommet, graine du bâtiment). */
  facade?: boolean;
  /** Toits : tuiles, ardoise ou terrasse. */
  roof?: boolean;
  /** Neige : orientation (composante verticale de la normale) à partir de laquelle la face blanchit. */
  snow?: number;
  /** Marquage : largeur de la bande (m), pour l'effacer quand elle devient plus fine qu'un pixel. */
  mark?: number;
  /** Accotement herbeux : touffes et terre nue par plaques. */
  grass?: boolean;
  /** Ciel réfléchi calculé : force, et part métallique (1 : reflet teinté plein, sans Fresnel). */
  sky?: { gain: number; metal: number };
  /** Textures du sol et du bâti (sol.ts) : enrobé, marquage, bas-côté, terrain, façade. */
  sol?: SolUse;
}

const fixed = (value: number) => value.toFixed(4);

/** Début de l'éclairage de three, la lune et le ciel masqués sous les tunnels (pmbMoonKeep). */
const LIGHTS_BEGIN = ShaderChunk.lights_fragment_begin
  .replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= pmbMoonKeep;')
  .replace('irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );', 'irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal ) * pmbMoonKeep;');

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
  if (patch.road) defines.PMB_ROAD = '';
  if (patch.facade) defines.PMB_FACADE = '';
  if (patch.roof) defines.PMB_ROOF = '';
  if (patch.grass) defines.PMB_GRASS = '';
  if (patch.snow !== undefined) defines.PMB_SNOW = fixed(patch.snow);
  if (patch.mark !== undefined) defines.PMB_MARK = fixed(patch.mark);
  if (patch.sky) {
    defines.PMB_SKY = fixed(patch.sky.gain);
    defines.PMB_SKY_METAL = fixed(patch.sky.metal);
  }
  if (patch.sol) Object.assign(defines, solDefines(patch.sol));
  defines.PMB_HEAD_DIFFUSE = fixed(patch.head?.diffuse ?? 1);
  defines.PMB_HEAD_SPEC = fixed(patch.head?.spec ?? 1);
  material.defines = { ...material.defines, ...defines };
  const key = `pmb-nuit:${Object.entries(defines)
    .map(([k, v]) => `${k}=${v}`)
    .join(',')}`;
  material.customProgramCacheKey = () => key;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms, SOL_UNIFORMS);
    shader.vertexShader = VERTEX_HEAD + shader.vertexShader.replace('#include <project_vertex>', VERTEX_BODY);
    shader.fragmentShader =
      FRAGMENT_HEAD +
      shader.fragmentShader
        .replace('#include <roughnessmap_fragment>', ROUGHNESS_PATCH)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${SOL_NORMAL}`)
        .replace('#include <lights_fragment_begin>', LIGHTS_BEGIN)
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
  /** Posé sur une autre face (marquage sur la chaussée) : tiré vers la caméra, il ne s'y bat jamais. */
  decal?: boolean;
}

export const ROLE_LOOKS: Readonly<Record<MapMaterialRole, RoleLook>> = {
  // Enrobé mat et granuleux au sec : il ne renvoie presque rien ; l'eau le rend brillant par plaques.
  chaussee: { color: '#2c2d31', roughness: 0.8, envMapIntensity: 0, patch: { lamps: { diffuse: 1.9, spec: 6 }, wet: { rough: 0.1 }, reflect: true, grain: true, road: true, head: { diffuse: 1, spec: 0.3 } }, noMirror: true },
  voie: { color: '#28292d', roughness: 0.82, envMapIntensity: 0, patch: { lamps: { diffuse: 1.9, spec: 2.4 }, wet: { rough: 0.2 }, reflect: true, grain: true, road: true, head: { diffuse: 1, spec: 0.3 } }, noMirror: true },
  marquage: { color: '#bdbbb3', roughness: 0.6, envMapIntensity: 0, patch: { lamps: { diffuse: 1.6, spec: 1.6 }, wet: { rough: 0.25 }, reflect: true, retro: 10, mark: 0.13 }, noMirror: true, decal: true },
  accotement: { color: '#24211d', roughness: 0.92, envMapIntensity: 0, patch: { lamps: { diffuse: 7, spec: 0.3 }, wet: { rough: 0.5 }, road: true, grass: true, snow: 0.55, head: { diffuse: 0.7, spec: 0.3 } }, noMirror: true },
  terrain: { color: '#26301f', roughness: 1, envMapIntensity: 0, patch: { lamps: { diffuse: 6, spec: 0 }, snow: 0.5, head: { diffuse: 0.6, spec: 0 } }, noMirror: true },
  eau: { color: '#010207', roughness: 0.05, envMapIntensity: 0, patch: { lamps: { diffuse: 0, spec: 2.5 }, water: 0.5, head: { diffuse: 0, spec: 1 } }, noMirror: true },
  mur: { color: '#3a3530', roughness: 0.9, envMapIntensity: 0, patch: { lamps: { diffuse: 5, spec: 0.1 }, facade: true } },
  toit: { color: '#1c1a1a', roughness: 0.85, envMapIntensity: 0, patch: { lamps: { diffuse: 3, spec: 0.1 }, roof: true, snow: 0.25 } },
  fenetre: { color: '#20242c', roughness: 0.12, envMapIntensity: 0, patch: { windows: true } },
  ouvrage: { color: '#3a3b40', roughness: 0.85, envMapIntensity: 0, patch: { lamps: { diffuse: 5, spec: 0.2 }, retro: 2, snow: 0.6, road: true } },
  glissiere: { color: '#8d9196', roughness: 0.35, metalness: 0.75, envMapIntensity: 0, patch: { retro: 6, head: { diffuse: 1, spec: 2 }, sky: { gain: 0.5, metal: 1 }, snow: 0.7 } },
};

/** Les matières des rôles, une par rôle, partagées par tous les tronçons. */
export function createRoleMaterials(uniforms: NightUniforms): Map<string, MeshStandardMaterial> {
  const out = new Map<string, MeshStandardMaterial>();
  for (const [role, look] of Object.entries(ROLE_LOOKS) as Array<[MapMaterialRole, RoleLook]>) {
    const m = new MeshStandardMaterial({ color: look.color, roughness: look.roughness, metalness: look.metalness ?? 0, envMapIntensity: look.envMapIntensity ?? 1 });
    m.name = `nuit_${role}`;
    if (look.decal) {
      m.polygonOffset = true;
      m.polygonOffsetFactor = -1;
      m.polygonOffsetUnits = -4;
    }
    patchNight(m, uniforms, { ...look.patch, sol: SOL_ROLES[role] });
    if (SOL_ROLES[role]) m.addEventListener('dispose', releaseSolTextures);
    out.set(role, m);
  }
  loadSolTextures();
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
