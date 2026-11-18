// Jets du retour de flammes (§ 5.5 « le véhicule vit », § 9), partagés par la sortie de nuit
// (src/drive/scene/flammes.ts : le déclencheur au lever de pied) et le garage (Mécanique · Échappement :
// au lâcher d'un coup de gaz, plus bas). Un quad par sortie déclarée par le manifeste (`exhaust.outlets`),
// tous dans un seul maillage (un appel de dessin), sur le calque de l'atmosphère ; la forme et le dégradé
// (bleu à la bouche, jaune, orange, rouge au bout) sont calculés par le nuanceur, sans texture ; le quad se
// tourne vers la caméra autour de l'axe du jet. Vu dans l'axe (la poursuite), le jet vient vers la caméra :
// il se lit comme une gerbe ronde, plus large que de côté (`disque`), posée devant la caisse. Taille,
// éclat et voile viennent des données (src/data/echappement.ts, `RetourFlammes`) : la flamme ajoute sa
// lumière et voile un peu ce qui est derrière elle (lisible de jour sur la route claire, pas saturée de
// nuit). Rien n'est alloué par image : des uniformes changent.

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { AddEquation, BufferAttribute, BufferGeometry, CustomBlending, DoubleSide, Mesh, OneFactor, OneMinusSrcAlphaFactor, ShaderMaterial, ZeroFactor, type Camera, type Object3D, type Scene, type WebGLRenderer } from 'three';
import { ligneDe, type RetourFlammes } from '../../data/echappement.ts';
import type { ExhaustOutlet, VehicleManifest } from '../../data/vehicleTypes.ts';
import { ATMOSPHERE_LAYER } from '../../render/layers.ts';
import { useBuilds } from '../../state/builds.ts';
import { useFlammesGarage as useTirsGarage } from '../../ui/echappement/flammesGarage.ts';

/** Rayon d'une sortie qui n'en déclare pas (m). */
export const RAYON_SORTIE = 0.025;
/** Sous cette force, le jet est caché (aucun appel de dessin). */
export const SEUIL_VISIBLE = 0.002;

/**
 * Force du jet, de 0 à 1, d'après le temps qui lui reste : `salves` bouffées égales en durée, chacune
 * vive à l'attaque (12 % de sa durée) puis qui retombe ; chaque bouffée un quart plus faible que la
 * précédente.
 */
export function forceFlamme(vie: number, regle: Pick<RetourFlammes, 'duree' | 'salves'>): number {
  if (!(vie > 0) || !(regle.duree > 0)) return 0;
  const salves = Math.max(1, Math.min(3, Math.round(regle.salves)));
  const p = Math.min(1, Math.max(0, 1 - vie / regle.duree)) * salves;
  const rang = Math.min(salves - 1, Math.floor(p));
  const q = p - rang;
  const attaque = Math.min(1, q / 0.12);
  return attaque * attaque * (3 - 2 * attaque) * (1 - q) ** 1.3 * (1 - 0.25 * rang);
}

const VERTEX = /* glsl */ `
uniform float uForce;
uniform float uTemps;
uniform float uLongueur;
uniform float uLargeur;
uniform float uDisque;
attribute vec3 aDir;
attribute vec2 aCoin;
attribute float aGraine;
attribute float aRayon;
varying float vLong;
varying float vCote;
varying float vL;
varying float vW;
varying float vGraine;
void main() {
  // Longueur qui vacille d'une sortie à l'autre ; plus courte quand le jet faiblit.
  float vac = 0.8 + 0.2 * sin( uTemps * 57.0 + aGraine * 13.0 ) * sin( uTemps * 21.0 + aGraine * 7.0 );
  float L = uLongueur * vac * ( 0.45 + 0.55 * uForce );
  float W = max( uLargeur, aRayon * 2.6 ) * ( 0.75 + 0.25 * uForce );
  vec4 p0 = modelViewMatrix * vec4( position, 1.0 );
  vec4 p1 = modelViewMatrix * vec4( position + normalize( aDir ) * L, 1.0 );
  // Le quad suit l'axe du jet projeté sur l'écran, élargi de W de chaque côté et à chaque bout.
  vec2 a2 = p1.xy - p0.xy;
  float l2 = length( a2 );
  // Vu dans l'axe (0) ou de côté (1) : dans l'axe, le jet vient vers la caméra, une gerbe plus large,
  // posée au bout du jet (devant la caisse qui cacherait sa bouche).
  float cote = smoothstep( 0.25 * W, 1.2 * W, l2 );
  W = mix( max( W, uDisque * L ), W, cote );
  vec2 u = l2 > 1e-5 ? a2 / l2 : vec2( 0.0, 1.0 );
  vec2 v = vec2( -u.y, u.x );
  bool bout = aCoin.y > 0.5;
  vec3 base = bout ? p1.xyz : mix( p1.xyz, p0.xyz, cote );
  vec2 ext = u * ( bout ? W : -W ) + v * aCoin.x * W;
  vLong = bout ? l2 + W : -W;
  vCote = aCoin.x * W;
  vL = l2;
  vW = W;
  vGraine = aGraine;
  gl_Position = projectionMatrix * vec4( base + vec3( ext, 0.0 ), 1.0 );
}`;

const FRAGMENT = /* glsl */ `
uniform float uForce;
uniform float uTemps;
uniform float uEclat;
uniform float uCoeur;
uniform float uVoile;
varying float vLong;
varying float vCote;
varying float vL;
varying float vW;
varying float vGraine;
void main() {
  float sur = clamp( vLong, 0.0, vL );
  float d = length( vec2( vLong - sur, vCote ) );
  // Le long du jet (0 : la bouche, 1 : le bout) ; vu dans l'axe, depuis le centre du disque.
  float axe = smoothstep( 0.25 * vW, 1.2 * vW, vL );
  float t = mix( clamp( d / vW, 0.0, 1.0 ), vL > 1e-5 ? sur / vL : 0.0, axe );
  // Profil : étroit à la bouche, renflé, effilé au bout.
  float r = vW * mix( 0.55, 1.0, smoothstep( 0.0, 0.3, t ) ) * ( 1.0 - 0.8 * smoothstep( 0.3, 1.0, t ) );
  r = mix( vW, r, axe );
  float forme = 1.0 - smoothstep( 0.45 * r, r, d );
  float langue = 0.72 + 0.28 * sin( vLong * 28.0 - uTemps * 38.0 + vGraine * 9.0 );
  float coeur = exp( -pow( d / max( 0.35 * r, 1e-4 ), 2.0 ) ) * ( 1.0 - t );
  vec3 c = mix( vec3( 1.0, 0.68, 0.28 ), vec3( 1.0, 0.36, 0.06 ), smoothstep( 0.05, 0.45, t ) );
  c = mix( c, vec3( 0.8, 0.09, 0.02 ), smoothstep( 0.45, 0.95, t ) );
  c = mix( c, vec3( 0.55, 0.7, 1.0 ), coeur * ( 1.0 - smoothstep( 0.0, 0.25, t ) ) * 0.6 );
  float corps = forme * pow( 1.0 - t, 0.7 ) * uForce;
  // Mélange prémultiplié : la lumière de la flamme s'ajoute, et elle voile ce qui est derrière elle.
  gl_FragColor = vec4( c * ( corps * langue * uEclat + coeur * uForce * uCoeur ), min( 1.0, corps * uVoile ) );
}`;

export interface FlammesRig {
  mesh: Mesh<BufferGeometry, ShaderMaterial>;
  /** Forme et éclat du jet le plus fort, d'après la ligne. */
  regler: (regle: Pick<RetourFlammes, 'longueur' | 'largeur' | 'disque' | 'eclat' | 'coeur' | 'voile'>) => void;
  /** Force du jet (0 : caché) et temps (s) qui fait vaciller la flamme. Aucune allocation. */
  poser: (force: number, temps: number) => void;
  dispose: () => void;
}

/** Géométrie des jets : quatre sommets par sortie (bouche répétée, direction, coin, graine, rayon). */
export function geometrieFlammes(outlets: readonly ExhaustOutlet[]): BufferGeometry {
  const n = outlets.length;
  const position = new Float32Array(n * 12);
  const dir = new Float32Array(n * 12);
  const coin = new Float32Array(n * 8);
  const graine = new Float32Array(n * 4);
  const rayon = new Float32Array(n * 4);
  const index: number[] = [];
  const coins = [-1, 0, 1, 0, -1, 1, 1, 1];
  outlets.forEach((outlet, i) => {
    const length = Math.hypot(...outlet.direction) || 1;
    for (let k = 0; k < 4; k += 1) {
      const v = i * 4 + k;
      for (let a = 0; a < 3; a += 1) {
        position[v * 3 + a] = outlet.position[a] ?? 0;
        dir[v * 3 + a] = (outlet.direction[a] ?? 0) / length;
      }
      coin[v * 2] = coins[k * 2] ?? 0;
      coin[v * 2 + 1] = coins[k * 2 + 1] ?? 0;
      graine[v] = 0.11 + i * 0.37;
      rayon[v] = outlet.radius ?? RAYON_SORTIE;
    }
    const o = i * 4;
    // Sens direct à l'écran (le quad est bâti face à la caméra) : (bouche gauche, bout gauche, bouche droite), etc.
    index.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('aDir', new BufferAttribute(dir, 3));
  geometry.setAttribute('aCoin', new BufferAttribute(coin, 2));
  geometry.setAttribute('aGraine', new BufferAttribute(graine, 1));
  geometry.setAttribute('aRayon', new BufferAttribute(rayon, 1));
  geometry.setIndex(index);
  return geometry;
}

/** Les jets d'un véhicule : un maillage caché, prêt à cracher. */
export function creerFlammes(outlets: readonly ExhaustOutlet[]): FlammesRig {
  const uniforms = {
    uForce: { value: 0 },
    uTemps: { value: 0 },
    uLongueur: { value: 0.4 },
    uLargeur: { value: 0.07 },
    uDisque: { value: 0 },
    uEclat: { value: 1 },
    uCoeur: { value: 0.3 },
    uVoile: { value: 1 },
  };
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms,
    transparent: true,
    depthWrite: false,
    // Prémultiplié : la couleur s'ajoute, l'alpha voile le fond ; l'alpha de la cible ne bouge pas.
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendEquationAlpha: AddEquation,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
    side: DoubleSide,
    fog: false,
  });
  material.name = 'sortie_flammes';
  const mesh = new Mesh(geometrieFlammes(outlets), material);
  mesh.name = 'sortie_flammes';
  mesh.layers.set(ATMOSPHERE_LAYER);
  // Les quads sont étirés par le nuanceur : la sphère englobante des bouches ne les contient pas.
  mesh.frustumCulled = false;
  mesh.renderOrder = 11;
  mesh.visible = false;
  return {
    mesh,
    regler: (regle) => {
      uniforms.uLongueur.value = regle.longueur;
      uniforms.uLargeur.value = regle.largeur;
      uniforms.uDisque.value = regle.disque;
      uniforms.uEclat.value = regle.eclat;
      uniforms.uCoeur.value = regle.coeur;
      uniforms.uVoile.value = regle.voile;
    },
    poser: (force, temps) => {
      uniforms.uForce.value = force;
      uniforms.uTemps.value = temps;
      mesh.visible = force > SEUIL_VISIBLE;
    },
    dispose: () => {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}

/** Compile le programme d'un objet caché (montré le temps de la compilation) : rien à compiler au premier jet. */
export function compileHidden(object: Object3D, gl: WebGLRenderer, camera: Camera, scene: Scene): void {
  const visible = object.visible;
  object.visible = true;
  gl.compile(object, camera, scene);
  object.visible = visible;
}

/**
 * Garage (src/scene/vehicle/VehicleModel.tsx) : au lâcher d'un coup de gaz tenu dans Mécanique ·
 * Échappement (src/ui/echappement/flammesGarage.ts compte les tirs), la ligne libre crache par les
 * sorties déclarées, comme en sortie. Les jets sont posés dans la caisse ; le garage, rendu à la demande,
 * redemande une image tant qu'un jet brûle. La scène publie `data-flammes-garage` (tirs vus) et
 * `data-flamme-garage` (« oui » tant qu'un jet brûle) pour les parcours. Rien sans sortie déclarée.
 */
export function useFlammesGarage(root: Object3D, vehicle: VehicleManifest, invalidate: () => void): void {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene) as Scene;
  const regle = useBuilds((state) => ligneDe(state.builds[vehicle.id]).flammes ?? null);
  const outlets = vehicle.exhaust?.outlets;
  // Les jets ne sont faits que pour une ligne qui crache : rien à compiler sinon.
  const rig = useMemo(() => (regle && outlets && outlets.length > 0 ? creerFlammes(outlets) : null), [outlets, regle]);
  useEffect(() => () => rig?.dispose(), [rig]);
  const tirs = useTirsGarage((state) => state.tirs);
  const vivant = useRef({ vie: 0, vus: tirs, brule: false, stage: null as HTMLElement | null });
  useLayoutEffect(() => {
    if (!rig || !regle) return undefined;
    rig.regler(regle);
    const caisse = root.getObjectByName('caisse') ?? root;
    caisse.add(rig.mesh);
    compileHidden(rig.mesh, gl, camera, scene);
    return () => {
      caisse.remove(rig.mesh);
    };
  }, [rig, regle, root, gl, camera, scene]);
  useLayoutEffect(() => {
    const stage = gl.domElement.closest<HTMLElement>('.stage');
    const v = vivant.current;
    v.stage = stage;
    return () => {
      if (stage) {
        delete stage.dataset.flammesGarage;
        delete stage.dataset.flammeGarage;
      }
      v.stage = null;
    };
  }, [gl]);
  // Un tir de plus : le jet part (si la ligne crache et que le véhicule a des sorties).
  useEffect(() => {
    const v = vivant.current;
    if (tirs === v.vus) return;
    v.vus = tirs;
    if (!rig || !regle) return;
    v.vie = regle.duree;
    if (v.stage) v.stage.dataset.flammesGarage = String(tirs);
    invalidate();
  }, [tirs, rig, regle, invalidate]);
  useFrame((state, delta) => {
    const v = vivant.current;
    if (!rig || !regle || (v.vie <= 0 && !v.brule)) return;
    v.vie = Math.max(0, v.vie - Math.min(0.1, delta));
    const force = forceFlamme(v.vie, regle);
    rig.poser(force, state.clock.elapsedTime);
    const allume = force > SEUIL_VISIBLE;
    if (allume !== v.brule) {
      v.brule = allume;
      if (v.stage) v.stage.dataset.flammeGarage = allume ? 'oui' : 'non';
    }
    // Rendu à la demande : une image de plus tant que le jet brûle (et une pour l'éteindre).
    if (v.vie > 0) invalidate();
  });
}
