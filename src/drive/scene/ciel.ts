// Ciel et air de la sortie de nuit : voûte bleu nuit avec un reste de lueur à l'horizon et des
// étoiles discrètes (nuanceur, aucune texture), pluie en traits instanciés autour de la caméra,
// cônes de lumière des phares. Tout est dessiné en code, rien n'est téléchargé.

import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import type { NightUniforms } from './materiaux.ts';

/** Palette du ciel (sRGB) : la brume prend la couleur de l'horizon. */
export const SKY = {
  zenith: '#010209',
  middle: '#070d24',
  horizon: '#213058',
  /** Reste de lueur du couchant, côté ouest-sud-ouest. */
  glow: '#4a3352',
  glowDirection: [-0.85, 0, 0.5] as const,
  fog: '#0e1529',
} as const;

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  gl_Position = p.xyww;
}`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uMiddle;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uGlowDir;
uniform float uTime;
uniform float uStars;
varying vec3 vDir;
float h3( vec3 p ) { return fract( sin( dot( p, vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 ); }
void main() {
  vec3 d = normalize( vDir );
  float y = max( d.y, -0.2 );
  vec3 c = mix( uHorizon, uMiddle, smoothstep( 0.0, 0.18, y ) );
  c = mix( c, uZenith, smoothstep( 0.18, 0.75, y ) );
  float g = pow( max( dot( normalize( vec3( d.x, 0.0, d.z ) ), uGlowDir ), 0.0 ), 3.0 ) * ( 1.0 - smoothstep( -0.02, 0.22, y ) );
  c += uGlow * g;
  // Étoiles : une case de la voûte sur quelques centaines porte une étoile, plus rare vers l'horizon.
  vec3 cell = floor( d * 340.0 );
  float h = h3( cell );
  float star = step( 0.9975, h ) * smoothstep( 0.08, 0.4, y );
  vec3 f = fract( d * 340.0 ) - 0.5;
  star *= smoothstep( 0.5, 0.0, length( f ) ) * ( 0.55 + 0.45 * sin( uTime * ( 1.0 + h * 3.0 ) + h * 80.0 ) );
  c += vec3( 0.75, 0.8, 1.0 ) * star * uStars * ( 0.4 + 1.4 * fract( h * 911.0 ) );
  gl_FragColor = vec4( c, 1.0 );
  #include <colorspace_fragment>
}`;

const linear = (hex: string) => new Color(hex);

export function createSky(): Mesh<SphereGeometry, ShaderMaterial> {
  const material = new ShaderMaterial({
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    uniforms: {
      uZenith: { value: linear(SKY.zenith) },
      uMiddle: { value: linear(SKY.middle) },
      uHorizon: { value: linear(SKY.horizon) },
      uGlow: { value: linear(SKY.glow) },
      uGlowDir: { value: new Vector3(...SKY.glowDirection).normalize() },
      uTime: { value: 0 },
      uStars: { value: 1 },
    },
    side: BackSide,
    depthWrite: false,
    fog: false,
  });
  material.name = 'nuit_ciel';
  const sky = new Mesh(new SphereGeometry(1000, 24, 12), material);
  sky.name = 'sortie_ciel';
  sky.frustumCulled = false;
  sky.renderOrder = -100;
  return sky;
}

const RAIN_VERTEX = /* glsl */ `
attribute vec4 aSeed;
attribute vec2 aCorner;
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uWind;
uniform vec3 pmbHeadPos;
uniform vec3 pmbHeadDir;
uniform float pmbHeadOn;
varying float vAlpha;
const vec3 BOX = vec3( 26.0, 14.0, 26.0 );
void main() {
  vec3 vel = vec3( 0.0, -11.0, 0.0 ) + uWind;
  vec3 p = aSeed.xyz * BOX + vel * ( uTime * ( 0.8 + 0.4 * aSeed.w ) );
  // Boîte qui suit la caméra : chaque goutte reboucle dans la boîte autour d'elle.
  p = mod( p - uCenter + BOX * 0.5, BOX ) - BOX * 0.5 + uCenter;
  vec3 dir = normalize( vel );
  float len = 0.45 + 0.35 * aSeed.w;
  vec3 view = normalize( cameraPosition - p );
  vec3 side = normalize( cross( dir, view ) ) * 0.009;
  vec3 world = p + dir * aCorner.y * len + side * aCorner.x;
  vec3 Lh = pmbHeadPos - p;
  float dh = length( Lh );
  float lit = smoothstep( 0.8, 0.95, dot( -Lh / dh, pmbHeadDir ) ) * pmbHeadOn / ( 1.0 + dh * 0.08 );
  float dc = length( p - cameraPosition );
  vAlpha = ( 0.10 + 1.4 * lit ) * smoothstep( 0.6, 2.5, dc ) * ( 1.0 - smoothstep( 9.0, 13.0, dc ) ) * ( 1.0 - aCorner.y * 0.6 );
  gl_Position = projectionMatrix * viewMatrix * vec4( world, 1.0 );
}`;

const RAIN_FRAGMENT = /* glsl */ `
varying float vAlpha;
void main() {
  gl_FragColor = vec4( vec3( 0.62, 0.7, 0.85 ) * vAlpha, 1.0 );
}`;

/** Pluie : `count` traits fins, une seule géométrie, un seul appel de dessin. */
export function createRain(count: number, uniforms: NightUniforms): Mesh<BufferGeometry, ShaderMaterial> {
  const seeds = new Float32Array(count * 4 * 4);
  const corners = new Float32Array(count * 4 * 2);
  const index = new Uint32Array(count * 6);
  let r = 12345;
  const rand = () => {
    r = (r * 16807) % 2147483647;
    return r / 2147483647;
  };
  for (let i = 0; i < count; i += 1) {
    const sx = rand();
    const sy = rand();
    const sz = rand();
    const sw = rand();
    for (let k = 0; k < 4; k += 1) {
      seeds.set([sx, sy, sz, sw], (i * 4 + k) * 4);
      corners.set([k === 0 || k === 3 ? -1 : 1, k < 2 ? 0 : 1], (i * 4 + k) * 2);
    }
    index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 4 * 3), 3));
  geometry.setAttribute('aSeed', new BufferAttribute(seeds, 4));
  geometry.setAttribute('aCorner', new BufferAttribute(corners, 2));
  geometry.setIndex(new BufferAttribute(index, 1));
  const material = new ShaderMaterial({
    vertexShader: RAIN_VERTEX,
    fragmentShader: RAIN_FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uCenter: { value: new Vector3() },
      uWind: { value: new Vector3() },
      pmbHeadPos: uniforms.pmbHeadPos,
      pmbHeadDir: uniforms.pmbHeadDir,
      pmbHeadOn: uniforms.pmbHeadOn,
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
  });
  material.name = 'nuit_pluie';
  const rain = new Mesh(geometry, material);
  rain.name = 'sortie_pluie';
  rain.frustumCulled = false;
  rain.renderOrder = 10;
  return rain;
}

const BEAM_VERTEX = /* glsl */ `
varying float vAlong;
varying float vEdge;
void main() {
  // Cône couché le long de +X : 0 au phare, 1 au bout.
  vAlong = clamp( position.x / 18.0, 0.0, 1.0 );
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  vec3 n = normalize( normalMatrix * normal );
  vEdge = abs( dot( n, normalize( -mv.xyz ) ) );
  gl_Position = projectionMatrix * mv;
}`;

const BEAM_FRAGMENT = /* glsl */ `
uniform float uGain;
varying float vAlong;
varying float vEdge;
void main() {
  float a = pow( vEdge, 1.6 ) * pow( 1.0 - vAlong, 1.8 ) * smoothstep( 0.0, 0.08, vAlong );
  gl_FragColor = vec4( vec3( 1.0, 0.94, 0.82 ) * a * uGain, 1.0 );
}`;

/** Faisceau d'un phare, visible dans l'air : cône additif de 18 m, plus marqué sous la pluie. */
export function createBeam(gain: { value: number }): Mesh<ConeGeometry, ShaderMaterial> {
  const geometry = new ConeGeometry(3.2, 18, 16, 1, true);
  // Pointe au phare (origine), ouverture vers +X.
  geometry.translate(0, -9, 0).rotateZ(Math.PI / 2);
  const material = new ShaderMaterial({
    vertexShader: BEAM_VERTEX,
    fragmentShader: BEAM_FRAGMENT,
    uniforms: { uGain: gain },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: BackSide,
    fog: false,
  });
  material.name = 'nuit_faisceau';
  const beam = new Mesh(geometry, material);
  beam.name = 'phare_faisceau';
  beam.renderOrder = 11;
  return beam;
}
