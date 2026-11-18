// Ciel et air de la sortie de nuit : voûte bleu nuit, horizon clair qui dessine les crêtes, lune
// basse et son halo, voiles de nuages qu'elle éclaire, étoiles discrètes (nuanceur, aucune texture) ;
// pluie en traits instanciés autour de la caméra ; cônes de lumière et éblouissement des phares ;
// lumières lointaines (lampadaires de toute la carte, lueur des villages au-delà des tronçons).
// Tout est dessiné en code, rien n'est téléchargé.

import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import { linearOf, RAIN_TINT } from '../../data/phares.ts';
import { HEADLIGHT, MOON, type NightUniforms } from './materiaux.ts';

/** Palette du ciel (sRGB) : la brume prend la couleur de l'horizon. */
export const SKY = {
  zenith: '#02040f',
  middle: '#0a1330',
  horizon: '#2e4277',
  /** Reste de lueur du couchant, côté ouest-sud-ouest. */
  glow: '#3e2c4c',
  glowDirection: [-0.85, 0, 0.5] as const,
  fog: '#141d3a',
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
uniform float uClouds;
uniform vec3 uMoonDir;
uniform vec3 uMoon;
// Jour (src/data/moments.ts) : 0 la nuit ; 1, soleil, nuages opaques de teinte uCloudTint ; uDisk, éclat du soleil (0 sous un ciel couvert).
uniform float uDay;
uniform float uDisk;
uniform vec3 uCloudTint;
varying vec3 vDir;
float h3( vec3 p ) { return fract( sin( dot( p, vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 ); }
float h2( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float n2( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( h2( i ), h2( i + vec2( 1.0, 0.0 ) ), f.x ), mix( h2( i + vec2( 0.0, 1.0 ) ), h2( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
void main() {
  vec3 d = normalize( vDir );
  float y = max( d.y, -0.2 );
  vec3 c = mix( uHorizon, uMiddle, smoothstep( 0.0, 0.2, y ) );
  c = mix( c, uZenith, smoothstep( 0.2, 0.8, y ) );
  // Sous l'horizon (rarement vu : le relief lointain le couvre), une bande claire de brume.
  c = mix( c, uHorizon * 0.8, 1.0 - smoothstep( -0.08, 0.0, d.y ) );
  float g = pow( max( dot( normalize( vec3( d.x, 0.0, d.z ) ), uGlowDir ), 0.0 ), 3.0 ) * ( 1.0 - smoothstep( -0.02, 0.22, y ) );
  c += uGlow * g;
  // Lune : disque net, halo serré et large lueur qui éclaire l'horizon de son côté.
  float m = max( dot( d, uMoonDir ), 0.0 );
  float disk = smoothstep( 0.99988, 0.99993, m );
  vec3 tangent = d - uMoonDir * m;
  float mare = n2( tangent.xy * 900.0 + 3.0 ) * 0.5 + n2( tangent.yz * 2300.0 ) * 0.5;
  vec3 moonLight = uMoon * ( disk * ( 4.5 - 1.6 * mare ) + pow( m, 2200.0 ) * 0.9 + pow( m, 160.0 ) * 0.14 + pow( m, 8.0 ) * 0.06 );
  // Soleil : disque éblouissant, auréole serrée et large lueur autour de lui.
  float sun = smoothstep( 0.99986, 0.99992, m );
  vec3 sunLight = uMoon * ( uDisk * ( sun * 24.0 + pow( m, 900.0 ) * 1.6 + pow( m, 60.0 ) * 0.22 ) + pow( m, 5.0 ) * 0.1 );
  c += mix( moonLight, sunLight, uDay );
  // Voiles de nuages, éclairés du côté de la lune ; ils cachent les étoiles qu'ils couvrent. De jour,
  // des nuages opaques, plus clairs du côté du soleil.
  vec2 cp = d.xz / ( max( d.y, 0.0 ) + 0.18 ) * vec2( 0.7, 2.2 ) + vec2( uTime * 0.004, uTime * 0.002 );
  float cl = n2( cp ) * 0.55 + n2( cp * 2.3 + 7.1 ) * 0.3 + n2( cp * 5.1 + 2.3 ) * 0.15;
  cl = smoothstep( 0.5, 0.95, cl ) * smoothstep( 0.02, 0.2, y ) * uClouds;
  vec3 cloudLit = mix( uHorizon * 0.55 + uMoon * ( 0.05 + 0.5 * pow( m, 6.0 ) ), uCloudTint * ( 0.82 + 0.3 * pow( m, 4.0 ) - 0.12 * n2( cp * 3.1 + 1.7 ) ), uDay );
  // Ciel couvert de jour (pluie, neige) : une couche de nuages qui a du relief, bancs plus sombres et
  // trouées plus claires, plus lumineuse vers le zénith, au lieu d'un aplat gris (rien la nuit).
  float overcast = smoothstep( 1.0, 2.0, uClouds ) * uDay;
  if ( overcast > 0.0 ) {
    float bank = n2( cp * 0.42 + 3.7 ) * 0.65 + n2( cp * 1.3 + 9.2 ) * 0.35;
    cloudLit *= mix( 1.0, 0.6 + 0.66 * bank + 0.14 * smoothstep( 0.05, 0.7, y ), overcast );
  }
  c = mix( c, cloudLit, min( cl * mix( 0.4, 0.9, uDay ), 1.0 ) );
  // Étoiles : une case de la voûte sur quelques centaines porte une étoile, plus rare vers l'horizon.
  vec3 cell = floor( d * 340.0 );
  float h = h3( cell );
  float star = step( 0.9975, h ) * smoothstep( 0.08, 0.4, y );
  vec3 f = fract( d * 340.0 ) - 0.5;
  star *= smoothstep( 0.5, 0.0, length( f ) ) * ( 0.55 + 0.45 * sin( uTime * ( 1.0 + h * 3.0 ) + h * 80.0 ) );
  c += vec3( 0.75, 0.8, 1.0 ) * star * uStars * ( 1.0 - cl ) * ( 1.0 - smoothstep( 0.97, 0.995, m ) ) * ( 0.4 + 1.4 * fract( h * 911.0 ) );
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
      uClouds: { value: 1 },
      uMoonDir: { value: new Vector3(...MOON.direction).normalize() },
      uMoon: { value: new Color(MOON.color) },
      uDay: { value: 0 },
      uDisk: { value: 1 },
      uCloudTint: { value: new Color() },
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

// Pluie, neige et poussière : une même nuée de quads autour de la caméra (un seul appel de dessin).
// Pluie : traits qui tombent et filent avec la vitesse ; neige : flocons ronds, lents, qui dérivent ;
// poussière (au sec, en roulant vite) : grains fins qui ne se voient que dans les phares. Sous un
// tunnel (portée uSpan autour du rail local uShelterP, uShelterT), rien ne tombe : on voit le rideau
// aux têtes. uDensity éclaircit la nuée en fondu (garde de cadence). Ce que les phares éclairent prend
// la couleur de leur lumière (Custom › Phares : pmbHeadColor, l'uniforme de la route), au même calcul
// que rainTint (src/data/phares.ts) : l'origine ne change rien, une teinte franche colore les gouttes.
const HEAD_ORIGIN = linearOf(HEADLIGHT.color)
  .map((value) => value.toFixed(6))
  .join(', ');
const RAIN_VERTEX = /* glsl */ `
attribute vec4 aSeed;
attribute vec2 aCorner;
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uWind;
uniform float uRain;
uniform float uSnow;
uniform float uDust;
uniform float uDensity;
uniform vec4 uShelterP;
uniform vec3 uShelterT;
uniform vec2 uSpan;
uniform vec3 pmbHeadPos;
uniform vec3 pmbHeadDir;
uniform float pmbHeadOn;
uniform vec3 pmbHeadColor;
varying float vAlpha;
varying vec2 vCorner;
varying float vRound;
varying vec3 vTint;
const vec3 BOX = vec3( 26.0, 14.0, 26.0 );
const vec3 HEAD_ORIGIN = vec3( ${HEAD_ORIGIN} );
const vec3 LUMA = vec3( 0.2126, 0.7152, 0.0722 );
// Teinte de la lumière des phares rapportée à l'origine (1 pour l'origine), relevée pour garder une
// part de la luminance du blanc (une teinte franche ne doit pas éteindre la pluie).
vec3 headTint() {
  vec3 k = pmbHeadColor / HEAD_ORIGIN;
  k /= max( max( k.r, k.g ), max( k.b, 1e-4 ) );
  return k * clamp( ${RAIN_TINT.share.toFixed(3)} / max( dot( k, LUMA ), 1e-4 ), 1.0, ${RAIN_TINT.gain.toFixed(3)} );
}
void main() {
  bool snow = uSnow > uRain;
  float amount = max( max( uRain, uSnow ), uDust );
  bool dust = uDust > max( uRain, uSnow );
  vec3 vel = snow ? vec3( 0.6 * sin( uTime * 0.7 + aSeed.w * 6.28 ), -1.3 - 0.5 * aSeed.w, 0.6 * cos( uTime * 0.5 + aSeed.x * 6.28 ) ) + uWind * 0.8
    : ( dust ? vec3( 0.0, -0.15, 0.0 ) + uWind : vec3( 0.0, -11.0, 0.0 ) + uWind );
  vec3 p = aSeed.xyz * BOX + vel * ( uTime * ( 0.8 + 0.4 * aSeed.w ) );
  // Boîte qui suit la caméra : chaque goutte reboucle dans la boîte autour d'elle.
  p = mod( p - uCenter + BOX * 0.5, BOX ) - BOX * 0.5 + uCenter;
  vec3 view = normalize( cameraPosition - p );
  vec3 world;
  if ( snow ) {
    // Flocon : petit carré face à la caméra (arrondi dans le fragment).
    vec3 right = normalize( cross( view, vec3( 0.0, 1.0, 0.0 ) ) );
    vec3 up = cross( right, view );
    float r = 0.018 + 0.02 * aSeed.w;
    world = p + ( right * aCorner.x + up * ( aCorner.y * 2.0 - 1.0 ) ) * r;
  } else {
    vec3 dir = normalize( vel );
    float len = dust ? 0.05 + 0.25 * clamp( length( uWind ) / 30.0, 0.0, 1.0 ) : 0.45 + 0.35 * aSeed.w;
    vec3 side = normalize( cross( dir, view ) ) * ( dust ? 0.006 : 0.009 );
    world = p + dir * aCorner.y * len + side * aCorner.x;
  }
  vec3 Lh = pmbHeadPos - p;
  float dh = length( Lh );
  float lit = smoothstep( 0.8, 0.95, dot( -Lh / dh, pmbHeadDir ) ) * pmbHeadOn / ( 1.0 + dh * 0.08 );
  float dc = length( p - cameraPosition );
  // Sous la voûte d'un tunnel : rien.
  vec3 d = p - uShelterP.xyz;
  float along = uShelterP.w + dot( d.xz, uShelterT.xy );
  float lat = abs( d.x * uShelterT.y - d.z * uShelterT.x );
  float under = step( uSpan.x + 0.5, along ) * step( along, uSpan.y - 0.5 ) * step( lat, uShelterT.z + 2.5 ) * step( d.y, 7.5 );
  float keep = smoothstep( aSeed.w - 0.05, aSeed.w + 0.05, uDensity );
  float glow = snow ? 2.2 * lit : ( dust ? 2.4 * lit : 1.4 * lit );
  float base = ( snow ? 0.55 : ( dust ? 0.0 : 0.10 ) ) + glow;
  vTint = mix( vec3( 1.0 ), headTint(), glow / max( base, 1e-4 ) );
  // Les plus proches (moins de 1,2 m) ne se dessinent pas : de grands traits flous qui coûtaient cher.
  vAlpha = amount * keep * ( 1.0 - under ) * base * smoothstep( 1.2, 2.8, dc ) * ( 1.0 - smoothstep( 9.0, 13.0, dc ) ) * ( snow ? 1.0 : 1.0 - aCorner.y * 0.6 );
  vCorner = vec2( aCorner.x, aCorner.y * 2.0 - 1.0 );
  vRound = snow ? 1.0 : 0.0;
  gl_Position = projectionMatrix * viewMatrix * vec4( world, 1.0 );
  if ( vAlpha <= 0.0 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
}`;

const RAIN_FRAGMENT = /* glsl */ `
varying float vAlpha;
varying vec2 vCorner;
varying float vRound;
varying vec3 vTint;
void main() {
  float a = vAlpha;
  if ( vRound > 0.5 ) a *= max( 0.0, 1.0 - dot( vCorner, vCorner ) );
  gl_FragColor = vec4( mix( vec3( 0.62, 0.7, 0.85 ), vec3( 0.85, 0.88, 0.95 ), vRound ) * vTint * a, 1.0 );
}`;

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
      uRain: { value: 0 },
      uSnow: { value: 0 },
      uDust: { value: 0 },
      uDensity: { value: 1 },
      uShelterP: { value: new Vector4(0, -1e5, 0, 0) },
      uShelterT: { value: new Vector3(1, 0, 0) },
      uSpan: { value: new Vector2(1, 0) },
      pmbHeadPos: uniforms.pmbHeadPos,
      pmbHeadDir: uniforms.pmbHeadDir,
      pmbHeadOn: uniforms.pmbHeadOn,
      pmbHeadColor: uniforms.pmbHeadColor,
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
varying float vUp;
void main() {
  // Cône couché le long de +X : 0 au phare, 1 au bout ; vUp : hauteur rapportée au rayon du cône.
  vAlong = clamp( position.x / 18.0, 0.0, 1.0 );
  vUp = position.y / max( 0.2, position.x * ( 3.2 / 18.0 ) );
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  vec3 n = normalize( normalMatrix * normal );
  vEdge = abs( dot( n, normalize( -mv.xyz ) ) );
  gl_Position = projectionMatrix * mv;
}`;

const BEAM_FRAGMENT = /* glsl */ `
uniform float uGain;
varying float vAlong;
varying float vEdge;
varying float vUp;
void main() {
  // Feu de croisement : la moitié haute du cône est coupée net.
  float a = pow( vEdge, 1.6 ) * pow( 1.0 - vAlong, 1.8 ) * smoothstep( 0.0, 0.08, vAlong ) * ( 1.0 - 0.9 * smoothstep( -0.15, 0.2, vUp ) );
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

const GLARE_VERTEX = /* glsl */ `
uniform float uSize;
varying vec2 vUv;
varying float vFacing;
void main() {
  vUv = position.xy;
  vec4 center = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
  vec3 forward = normalize( mat3( modelMatrix ) * vec3( 1.0, 0.0, 0.0 ) );
  vec3 world = ( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
  vec3 toCam = normalize( cameraPosition - world );
  vFacing = max( dot( forward, toCam ), 0.0 );
  center.xy += position.xy * uSize * vec2( 2.6, 1.0 );
  gl_Position = projectionMatrix * center;
}`;

const GLARE_FRAGMENT = /* glsl */ `
uniform float uGain;
varying vec2 vUv;
varying float vFacing;
void main() {
  vec2 p = vUv * vec2( 2.6, 1.0 );
  float r2 = dot( p, p );
  float core = exp( -r2 * 160.0 ) * 4.0;
  float halo = exp( -r2 * 16.0 ) * 0.22;
  float streak = exp( -p.y * p.y * 1400.0 ) * exp( -abs( p.x ) * 4.0 ) * 0.5;
  float face = pow( vFacing, 10.0 );
  gl_FragColor = vec4( vec3( 1.0, 0.93, 0.82 ) * ( core + halo + streak ) * face * uGain, 1.0 );
}`;

/** Éblouissement d'un phare vu de face : cœur, halo et trait horizontal, additif, sur le calque de l'atmosphère. */
export function createGlare(gain: { value: number }): Mesh<PlaneGeometry, ShaderMaterial> {
  const material = new ShaderMaterial({
    vertexShader: GLARE_VERTEX,
    fragmentShader: GLARE_FRAGMENT,
    uniforms: { uSize: { value: 0.75 }, uGain: gain },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
    fog: false,
  });
  material.name = 'nuit_eblouissement';
  const glare = new Mesh(new PlaneGeometry(1, 1), material);
  glare.name = 'phare_eblouissement';
  glare.frustumCulled = false;
  glare.renderOrder = 12;
  return glare;
}

const FAR_LIGHTS_VERTEX = /* glsl */ `
uniform float uPixel;
uniform float uTime;
attribute float aSeed;
varying float vGain;
void main() {
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  float d = -mv.z;
  // Les lampadaires des tronçons chargés ont leurs vrais halos : ceux-ci prennent le relais au loin.
  vGain = smoothstep( 380.0, 760.0, d ) * ( 1.0 - smoothstep( 7000.0, 11000.0, d ) ) * ( 0.94 + 0.06 * sin( uTime * 3.0 + aSeed * 40.0 ) );
  // Au moins 2,4 pixels : plus petits, les points sautent d'un pixel à l'autre et scintillent en roulant.
  gl_PointSize = clamp( 2600.0 / d, 2.4, 5.0 ) * uPixel;
  gl_Position = projectionMatrix * mv;
}`;

const FAR_LIGHTS_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying float vGain;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float a = exp( -dot( p, p ) * 18.0 );
  gl_FragColor = vec4( uColor * a * vGain * 2.4, 1.0 );
}`;

/**
 * Lumières lointaines : tous les lampadaires de la carte (route.json) en points, un seul appel de
 * dessin ; visibles au-delà des tronçons chargés, cachés par le relief (test de profondeur).
 */
export function createFarLights(heads: Float32Array, color: Color): Points<BufferGeometry, ShaderMaterial> {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(heads, 3));
  const seeds = new Float32Array(heads.length / 3);
  for (let i = 0; i < seeds.length; i += 1) seeds[i] = (Math.sin(i * 12.9898) * 43758.5453) % 1;
  geometry.setAttribute('aSeed', new BufferAttribute(seeds, 1));
  geometry.computeBoundingSphere();
  const material = new ShaderMaterial({
    vertexShader: FAR_LIGHTS_VERTEX,
    fragmentShader: FAR_LIGHTS_FRAGMENT,
    uniforms: { uPixel: { value: 1 }, uTime: { value: 0 }, uColor: { value: color } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
  });
  material.name = 'nuit_lumieres_lointaines';
  const points = new Points(geometry, material);
  points.name = 'sortie_lumieres_lointaines';
  points.frustumCulled = false;
  points.renderOrder = 4;
  return points;
}

const TOWN_GLOW_VERTEX = /* glsl */ `
varying vec2 vUv;
varying float vGain;
void main() {
  vUv = position.xy;
  vec3 base = ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
  vec2 toCam = cameraPosition.xz - base.xz;
  float d = length( toCam );
  toCam /= max( d, 1e-3 );
  vec3 right = vec3( -toCam.y, 0.0, toCam.x );
  vec3 world = base + right * position.x * 900.0 + vec3( 0.0, ( position.y + 0.5 ) * 260.0, 0.0 );
  vGain = smoothstep( 900.0, 1800.0, d ) * ( 1.0 - smoothstep( 9000.0, 14000.0, d ) );
  gl_Position = projectionMatrix * viewMatrix * vec4( world, 1.0 );
}`;

const TOWN_GLOW_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying vec2 vUv;
varying float vGain;
void main() {
  float x = vUv.x * 2.0;
  float y = vUv.y + 0.5;
  float a = exp( -x * x * 3.0 ) * exp( -y * 4.5 ) * smoothstep( 0.0, 0.05, y );
  gl_FragColor = vec4( uColor * a * vGain * 0.22, 1.0 );
}`;

/** Lueur orangée au-dessus des villages lointains (une instance par point de `centers`, au sol). */
export function createTownGlow(centers: Float32Array, color: Color): InstancedMesh<PlaneGeometry, ShaderMaterial> | null {
  const n = centers.length / 3;
  if (n === 0) return null;
  const material = new ShaderMaterial({
    vertexShader: TOWN_GLOW_VERTEX,
    fragmentShader: TOWN_GLOW_FRAGMENT,
    uniforms: { uColor: { value: color } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
  });
  material.name = 'nuit_lueur_villages';
  const mesh = new InstancedMesh(new PlaneGeometry(1, 1), material, n);
  const m = new Matrix4();
  for (let i = 0; i < n; i += 1) mesh.setMatrixAt(i, m.makeTranslation(centers[i * 3] ?? 0, centers[i * 3 + 1] ?? 0, centers[i * 3 + 2] ?? 0));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.name = 'sortie_lueur_villages';
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return mesh;
}

const BAND_VERTEX = /* glsl */ `
varying float vH;
void main() {
  vH = position.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const BAND_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uGain;
varying float vH;
void main() {
  float a = smoothstep( 1.5, 3.5, vH ) * ( 1.0 - smoothstep( 4.5, 9.0, vH ) );
  gl_FragColor = vec4( uColor * a * uGain, 1.0 );
}`;

/**
 * Bande d'horizon vue par la seule sonde de réflexion (calque PROBE_ONLY) : un anneau mince et doux
 * à 40 m autour du véhicule, de 2 à 13° au-dessus de l'horizon. Quand talus et forêt cachent le ciel, la caisse
 * garde ainsi une ligne d'horizon claire qui dessine ses volumes (l'éclairage d'un studio de pose,
 * en sourdine) ; la caméra ne la voit jamais.
 */
export function createProbeBand(gain: { value: number }): Mesh<CylinderGeometry, ShaderMaterial> {
  const geometry = new CylinderGeometry(40, 40, 10, 32, 1, true).translate(0, 5, 0);
  const material = new ShaderMaterial({
    vertexShader: BAND_VERTEX,
    fragmentShader: BAND_FRAGMENT,
    uniforms: { uColor: { value: new Color(SKY.horizon) }, uGain: gain },
    side: BackSide,
    transparent: true,
    depthWrite: false,
    // Par-dessus le talus et la forêt proches : c'est quand ils cachent le ciel qu'elle sert.
    depthTest: false,
    blending: AdditiveBlending,
    fog: false,
  });
  material.name = 'nuit_bande_sonde';
  const band = new Mesh(geometry, material);
  band.name = 'sortie_bande_sonde';
  band.frustumCulled = false;
  band.renderOrder = 20;
  return band;
}
