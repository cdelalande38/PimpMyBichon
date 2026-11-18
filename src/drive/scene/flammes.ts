// Retour de flammes en sortie (§ 5.5 « le véhicule vit », § 9) : avec une ligne d'échappement qui le
// permet (src/data/echappement.ts, `flammes`), un lever de pied franc juste après un passage à haut
// régime en charge fait cracher les sorties déclarées par le manifeste (`exhaust.outlets`). Un quad
// additif par sortie, tous dans un seul maillage (un appel de dessin), sur le calque de l'atmosphère ;
// la forme et le dégradé (bleu à la bouche, jaune, orange, rouge au bout) sont calculés par le nuanceur,
// sans texture ; le quad se tourne vers la caméra autour de l'axe du jet, et devient un disque quand on
// regarde dans l'axe (vue de la poursuite). Rien n'est alloué par image : des uniformes changent.
//
// Le compteur des tirs (src/audio/engine/echappement.ts, `retourFlammes`) fait jouer le claquement par
// les bruitages de route ; la scène publie `data-echappement` (ligne montée), `data-flammes` (tirs
// depuis le départ), `data-flamme` (« oui » tant qu'un jet brûle) et `data-sorties` (sorties déclarées)
// pour les parcours. La finition des sorties suit le build ici aussi (src/scene/vehicle/echappement.ts).
// La sortie n'a pas de mode photo : rien d'autre à éteindre.

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, Mesh, ShaderMaterial, type Camera, type Object3D, type Scene, type WebGLRenderer } from 'three';
import { retourFlammes } from '../../audio/engine/echappement.ts';
import { ligneDe, type RetourFlammes } from '../../data/echappement.ts';
import type { ExhaustOutlet, VehicleManifest } from '../../data/vehicleTypes.ts';
import { ATMOSPHERE_LAYER } from '../../render/layers.ts';
import { useFinitionEchappement } from '../../scene/vehicle/echappement.ts';
import { useBuilds } from '../../state/builds.ts';
import { livePilot, useDrive } from '../../state/drive.ts';
import '../../ui/echappement/suivi.ts';
import { DRIVE_STAGE_CLASS } from '../contrat.ts';

/** Lever de pied : charge tenue avant (au moins), charge après (au plus), et fenêtre entre les deux (s). */
export const LEVER = { armee: 0.5, levee: 0.15, fenetre: 0.6 } as const;
/** Rayon d'une sortie qui n'en déclare pas (m). */
export const RAYON_SORTIE = 0.025;
/** Sous cette force, le jet est caché (aucun appel de dessin). */
const SEUIL_VISIBLE = 0.002;

/** Ce que le déclencheur retient d'une image à l'autre (réécrit sur place). */
export interface SuiviFlammes {
  /** Temps depuis le dernier instant en charge à haut régime (s). */
  depuisCharge: number;
  /** Temps avant qu'un nouveau jet puisse partir (s). */
  attente: number;
  /** Temps restant du jet en cours (s ; 0 : éteint). */
  vie: number;
  /** Jets depuis le départ. */
  tirs: number;
}

export function suiviFlammesRepos(): SuiviFlammes {
  return { depuisCharge: Infinity, attente: 0, vie: 0, tirs: 0 };
}

/**
 * Avance le déclencheur de `dt` secondes de route. `charge` de 0 à 1, `regime` rapporté au rupteur,
 * `passage` : un passage de rapport en cours (sa chute de charge n'est pas un lever de pied). Rend vrai
 * quand un jet part : charge retombée sous `LEVER.levee` moins de `LEVER.fenetre` s après un instant en
 * charge (au moins `LEVER.armee`) à `regle.regimeMin` du rupteur au moins, délai écoulé, et le tirage
 * `alea` (0 à 1) sous `regle.chance`. Un lever de pied ne compte qu'une fois.
 */
export function suivreFlammes(s: SuiviFlammes, charge: number, regime: number, passage: boolean, regle: RetourFlammes, dt: number, alea: number): boolean {
  const pas = Number.isFinite(dt) ? Math.max(0, dt) : 0;
  s.attente = Math.max(0, s.attente - pas);
  s.vie = Math.max(0, s.vie - pas);
  // Un passage de rapport ne mange pas la fenêtre : au lever de pied, la boîte monte souvent plusieurs
  // rapports d'affilée (une sportive : de la 1re à la 5e en une demi-seconde), et le jet partait ou non
  // selon leur nombre.
  if (!passage) s.depuisCharge += pas;
  if (charge >= LEVER.armee && regime >= regle.regimeMin) {
    s.depuisCharge = 0;
    return false;
  }
  if (passage || charge > LEVER.levee || s.depuisCharge > LEVER.fenetre || s.attente > 0) return false;
  s.depuisCharge = Infinity;
  if (!(alea < regle.chance)) return false;
  s.vie = regle.duree;
  s.attente = regle.attente;
  s.tirs += 1;
  return true;
}

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
  vec2 u = l2 > 1e-5 ? a2 / l2 : vec2( 0.0, 1.0 );
  vec2 v = vec2( -u.y, u.x );
  bool bout = aCoin.y > 0.5;
  vec3 base = bout ? p1.xyz : p0.xyz;
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
  float a = forme * langue * pow( 1.0 - t, 0.7 ) * uForce;
  gl_FragColor = vec4( c * ( a * 2.4 + coeur * uForce * 1.3 ), 1.0 );
}`;

export interface FlammesRig {
  mesh: Mesh<BufferGeometry, ShaderMaterial>;
  /** Taille du jet le plus fort (m), d'après la ligne. */
  regler: (longueur: number, largeur: number) => void;
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
  const uniforms = { uForce: { value: 0 }, uTemps: { value: 0 }, uLongueur: { value: 0.4 }, uLargeur: { value: 0.07 } };
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
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
    regler: (longueur, largeur) => {
      uniforms.uLongueur.value = longueur;
      uniforms.uLargeur.value = largeur;
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
function compileHidden(object: Object3D, gl: WebGLRenderer, camera: Camera, scene: Scene): void {
  const visible = object.visible;
  object.visible = true;
  gl.compile(object, camera, scene);
  object.visible = visible;
}

/**
 * Échappement du véhicule de la sortie : finition des sorties, jets de flammes posés dans la caisse
 * (ils suivent l'assiette), déclencheur lu sur le pilote à chaque image, attributs de la scène.
 */
export function useEchappementSortie(root: Object3D, vehicle: VehicleManifest, invalidate: () => void): void {
  useFinitionEchappement(root, vehicle, invalidate);
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene) as Scene;
  const ligne = useBuilds((state) => ligneDe(state.builds[vehicle.id]));
  const regle = ligne.flammes ?? null;
  const outlets = vehicle.exhaust?.outlets;
  const rig = useMemo(() => (outlets && outlets.length > 0 ? creerFlammes(outlets) : null), [outlets]);
  useEffect(() => () => rig?.dispose(), [rig]);
  // Ce que l'image relit et réécrit : le déclencheur, les jets, la scène (attributs).
  const vivant = useRef<{ suivi: SuiviFlammes; rig: FlammesRig | null; regle: RetourFlammes | null; stage: HTMLElement | null; brule: boolean }>({
    suivi: suiviFlammesRepos(),
    rig: null,
    regle: null,
    stage: null,
    brule: false,
  });
  useLayoutEffect(() => {
    if (!rig) return undefined;
    const caisse = root.getObjectByName('caisse') ?? root;
    caisse.add(rig.mesh);
    compileHidden(rig.mesh, gl, camera, scene);
    const v = vivant.current;
    v.rig = rig;
    return () => {
      caisse.remove(rig.mesh);
      if (v.rig === rig) v.rig = null;
    };
  }, [rig, root, gl, camera, scene]);
  useLayoutEffect(() => {
    vivant.current.regle = regle;
    if (regle) rig?.regler(regle.longueur, regle.largeur);
  }, [rig, regle]);
  useLayoutEffect(() => {
    const host = gl.domElement.closest<HTMLElement>(`.${DRIVE_STAGE_CLASS}`);
    const v = vivant.current;
    v.stage = host;
    if (host) {
      host.dataset.echappement = ligne.id;
      host.dataset.sorties = String(outlets?.length ?? 0);
      host.dataset.flammes = String(v.suivi.tirs);
      host.dataset.flamme = v.brule ? 'oui' : 'non';
    }
    return () => {
      if (host) {
        delete host.dataset.echappement;
        delete host.dataset.sorties;
        delete host.dataset.flammes;
        delete host.dataset.flamme;
      }
      v.stage = null;
    };
  }, [gl, ligne, outlets]);

  // Après le moteur de la scène (priorité 0), qui avance le pilote ; avant la chaîne de rendu (1).
  useFrame((state, delta) => {
    const v = vivant.current;
    const train = livePilot.current?.train;
    if (!v.regle) v.suivi.vie = 0;
    else if (train && !useDrive.getState().paused) {
      const regime = train.redline > 0 ? train.rpm / train.redline : 0;
      if (suivreFlammes(v.suivi, train.load, regime, train.shifting, v.regle, Math.min(0.1, delta), Math.random())) {
        retourFlammes.tirs += 1;
        if (v.stage) v.stage.dataset.flammes = String(v.suivi.tirs);
      }
    }
    const force = v.regle ? forceFlamme(v.suivi.vie, v.regle) : 0;
    v.rig?.poser(force, state.clock.elapsedTime);
    const allume = force > SEUIL_VISIBLE;
    if (allume !== v.brule) {
      v.brule = allume;
      if (v.stage) v.stage.dataset.flamme = allume ? 'oui' : 'non';
    }
  }, 0.5);
}
