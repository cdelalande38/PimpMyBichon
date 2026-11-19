// NOS en sortie (src/data/nos.ts) : pendant la poussée, un dard bleu à chaque sortie d'échappement déclarée
// par le manifeste (`exhaust.outlets` ; un véhicule sans sortie déclarée n'en a pas), et une lueur bleue
// sur la chaussée derrière elles, qui se diffuse. Le dard reprend la géométrie des jets du retour de flammes
// (src/scene/vehicle/flammes.ts : un quad par sortie, un seul maillage) avec ses propres nuanceurs : un dard
// effilé dans l'axe de la sortie, presque blanc à la bouche, bleu vif, violet à la pointe, qui vacille. Vu de
// dos (la poursuite), le jet vient vers la caméra et s'écrasait en deux taches : le nuanceur de sommets
// l'allonge le long de son axe jusqu'à paraître long d'au moins `etire` largeurs. Deux
// maillages, cachés hors poussée (aucun appel de dessin), compilés à la pose (pas d'à-coup au premier
// envoi). La scène publie `data-nos-flamme` (« oui » tant qu'un dard brûle) pour les parcours, pour l'effet
// du joueur seulement. Rien n'est alloué par image : des uniformes changent.

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { AddEquation, AdditiveBlending, CustomBlending, DoubleSide, Mesh, OneFactor, OneMinusSrcAlphaFactor, PlaneGeometry, ShaderMaterial, Vector3, ZeroFactor, type Object3D, type Scene } from 'three';
import { liveNos, NOS_RENDU, NOS_SEUIL, type EffetNos } from '../../data/nos.ts';
import type { ExhaustOutlet, VehicleManifest } from '../../data/vehicleTypes.ts';
import { ATMOSPHERE_LAYER } from '../../render/layers.ts';
import { compileHidden, geometrieFlammes } from '../../scene/vehicle/flammes.ts';
import { DRIVE_STAGE_CLASS } from '../contrat.ts';

const DARD_VERTEX = /* glsl */ `
uniform float uForce;
uniform float uTemps;
uniform float uLongueur;
uniform float uLargeur;
uniform float uEtire;
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
  // Longueur qui vacille, différente à chaque sortie ; plus courte quand la poussée retombe.
  float vac = 0.86 + 0.14 * sin( uTemps * 61.0 + aGraine * 13.0 ) * sin( uTemps * 23.0 + aGraine * 7.0 );
  float court = vac * ( 0.45 + 0.55 * uForce );
  float L = uLongueur * court;
  float W = max( uLargeur, aRayon * 1.6 ) * ( 0.8 + 0.2 * uForce );
  vec4 p0 = modelViewMatrix * vec4( position, 1.0 );
  vec3 d = ( modelViewMatrix * vec4( normalize( aDir ) * L, 0.0 ) ).xyz;
  // Longueur apparente du jet (après la perspective), en mètres à la profondeur z0 de la bouche : un point
  // de l'axe à k fois la longueur paraît à k |g| z0 / (z0 - k d.z) de la bouche, dans la direction de g.
  float z0 = max( -p0.z, 0.05 );
  vec2 g = ( z0 * d.xy + d.z * p0.xy ) / z0;
  float lg = length( g );
  vec2 u = lg > 1e-6 ? g / lg : vec2( 0.0, -1.0 );
  vec2 v = vec2( -u.y, u.x );
  // Vu presque dans l'axe (la poursuite), le jet s'écrasait en tache : il s'allonge le long de son axe (au-dessus
  // de la chaussée, devant elle pour la profondeur) jusqu'à paraître long d'au moins uEtire largeurs ; trois
  // fois sa longueur au plus, et jamais plus près de la caméra que 45 % de la distance de la bouche.
  float lmin = uEtire * W * court;
  float l2 = lg * z0 / max( z0 - d.z, 1e-3 );
  float kmax = d.z > 0.0 ? min( 3.0, 0.55 * z0 / d.z ) : 3.0;
  float k = l2 >= lmin ? 1.0 : clamp( lmin * z0 / max( lg * z0 + lmin * d.z, 1e-4 ), 1.0, max( 1.0, kmax ) );
  vec3 pointe = p0.xyz + d * k;
  float lt = k * lg * z0 / max( z0 - k * d.z, 1e-3 );
  bool bout = aCoin.y > 0.5;
  vec3 base = bout ? pointe : p0.xyz;
  vec2 ext = u * ( bout ? W : -W ) + v * aCoin.x * W;
  vLong = bout ? lt + W : -W;
  vCote = aCoin.x * W;
  vL = lt;
  vW = W;
  vGraine = aGraine;
  gl_Position = projectionMatrix * vec4( base + vec3( ext, 0.0 ), 1.0 );
}`;

const DARD = /* glsl */ `
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
  // Le long du dard : 0 à la bouche, 1 à la pointe.
  float t = vL > 1e-5 ? sur / vL : 0.0;
  // Dard : serré à la bouche, gonflé juste après, effilé jusqu'à la pointe.
  float r = vW * mix( 0.55, 1.0, smoothstep( 0.0, 0.22, t ) ) * ( 1.0 - 0.88 * smoothstep( 0.22, 1.0, t ) );
  float forme = 1.0 - smoothstep( 0.4 * r, r, d );
  // Cœur presque blanc, étroit, à la sortie ; il s'éteint avant le tiers du dard.
  float coeur = exp( -pow( d / max( 0.28 * r, 1e-4 ), 2.0 ) ) * ( 1.0 - smoothstep( 0.0, 0.3, t ) );
  vec3 c = mix( vec3( 0.3, 0.55, 1.0 ), vec3( 0.04, 0.22, 1.0 ), smoothstep( 0.03, 0.25, t ) );
  c = mix( c, vec3( 0.32, 0.05, 1.0 ), smoothstep( 0.5, 0.9, t ) );
  // Anneaux qui filent le long du dard, et un battement d'éclat propre à chaque sortie.
  float anneaux = 0.8 + 0.2 * sin( vLong * 42.0 - uTemps * 34.0 + vGraine * 9.0 );
  float bat = 0.88 + 0.12 * sin( uTemps * 47.0 + vGraine * 5.0 );
  float corps = forme * pow( 1.0 - t, 0.35 ) * uForce;
  // Mélange prémultiplié : la lumière s'ajoute, le dard voile un peu ce qui est derrière lui (lisible de jour).
  gl_FragColor = vec4( c * corps * anneaux * bat * uEclat + vec3( 0.9, 0.95, 1.0 ) * coeur * uForce * uCoeur, min( 1.0, corps * uVoile ) );
}`;

const LUEUR_VERTEX = /* glsl */ `
varying vec2 vP;
void main() {
  vP = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const LUEUR_FRAGMENT = /* glsl */ `
uniform float uForce;
varying vec2 vP;
void main() {
  // Cloche qui tombe à zéro au bord : la lueur se diffuse, sans bord de plaque.
  float g = max( 0.0, ( exp( -3.0 * dot( vP, vP ) ) - exp( -3.0 ) ) / ( 1.0 - exp( -3.0 ) ) );
  gl_FragColor = vec4( vec3( 0.18, 0.4, 1.0 ) * g * uForce, 1.0 );
}`;

/** Hauteur de la lueur au-dessus du rail (m), comme celle des néons (src/drive/scene/neons.ts). */
export const AU_DESSUS_DU_RAIL = 0.075;

export function creerDard(outlets: readonly ExhaustOutlet[]) {
  const D = NOS_RENDU.dard;
  const uniforms = {
    uForce: { value: 0 },
    uTemps: { value: 0 },
    uLongueur: { value: D.longueur },
    uLargeur: { value: D.largeur },
    uEtire: { value: D.etire },
    uEclat: { value: D.eclat },
    uCoeur: { value: D.coeur },
    uVoile: { value: D.voile },
  };
  const material = new ShaderMaterial({
    vertexShader: DARD_VERTEX,
    fragmentShader: DARD,
    uniforms,
    transparent: true,
    depthWrite: false,
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
  material.name = 'nos_dard';
  const mesh = new Mesh(geometrieFlammes(outlets), material);
  mesh.name = 'nos_dard';
  mesh.layers.set(ATMOSPHERE_LAYER);
  mesh.frustumCulled = false;
  mesh.renderOrder = 12;
  mesh.visible = false;
  return { mesh, uniforms };
}

export function creerLueur() {
  const uniforms = { uForce: { value: 0 } };
  const material = new ShaderMaterial({
    vertexShader: LUEUR_VERTEX,
    fragmentShader: LUEUR_FRAGMENT,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
  });
  material.name = 'nos_lueur';
  const geometry = new PlaneGeometry(1, 1);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geometry, material);
  mesh.name = 'nos_lueur';
  mesh.scale.set(NOS_RENDU.lueur.longueur, 1, NOS_RENDU.lueur.largeur);
  mesh.renderOrder = 10;
  mesh.visible = false;
  return { mesh, uniforms };
}

/** Le véhicule posé sur le rail (cap et pente, sans roulis : src/drive/scene/vehicule.tsx). */
function groupeDuVehicule(root: Object3D): Object3D | null {
  let o: Object3D | null = root;
  while (o && o.name !== 'sortie_vehicule') o = o.parent;
  return o;
}

/**
 * Les dards et la lueur d'un véhicule, menés par `effet` : celui du joueur par défaut (`liveNos`, avancé par
 * le moteur de la scène) ; un autre véhicule passe le sien, et rien n'est publié sur la scène pour lui.
 */
export function useNosSortie(root: Object3D, vehicle: VehicleManifest, effet: EffetNos = liveNos): void {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene) as Scene;
  const outlets = vehicle.exhaust?.outlets;
  const rig = useMemo(() => (outlets && outlets.length > 0 ? { dard: creerDard(outlets), lueur: creerLueur() } : null), [outlets]);
  useEffect(
    () => () => {
      if (!rig) return;
      for (const m of [rig.dard.mesh, rig.lueur.mesh]) {
        m.geometry.dispose();
        m.material.dispose();
      }
    },
    [rig],
  );
  // Ce que l'image relit et réécrit (le rig y est posé par l'effet : l'image ne touche pas au mémo).
  const vivant = useRef({ rig: null as typeof rig, stage: null as HTMLElement | null, brule: false, groupe: null as Object3D | null });
  useLayoutEffect(() => {
    if (!rig) return undefined;
    const caisse = root.getObjectByName('caisse') ?? root;
    caisse.add(rig.dard.mesh);
    compileHidden(rig.dard.mesh, gl, camera, scene);
    compileHidden(rig.lueur.mesh, gl, camera, scene);
    const v = vivant.current;
    v.rig = rig;
    v.stage = effet === liveNos ? gl.domElement.closest<HTMLElement>(`.${DRIVE_STAGE_CLASS}`) : null;
    if (v.stage) v.stage.dataset.nosFlamme = 'non';
    return () => {
      caisse.remove(rig.dard.mesh);
      rig.lueur.mesh.removeFromParent();
      if (v.stage) delete v.stage.dataset.nosFlamme;
      v.stage = null;
      v.rig = null;
      v.groupe = null;
      v.brule = false;
    };
  }, [rig, root, gl, camera, scene, effet]);

  // Après le moteur de la scène (priorité 0), qui avance l'effet ; avant la chaîne d'image (1).
  useFrame((state) => {
    const v = vivant.current;
    const rig = v.rig;
    if (!rig || !outlets) return;
    const force = effet.force;
    const allume = force > NOS_SEUIL;
    if (allume && !v.groupe) {
      // Première poussée : la lueur va dans le groupe posé sur le rail, derrière les sorties (une fois).
      const groupe = groupeDuVehicule(root);
      const caisse = root.getObjectByName('caisse') ?? root;
      if (groupe) {
        groupe.updateWorldMatrix(true, true);
        const p = new Vector3();
        const centre = new Vector3();
        for (const o of outlets) centre.add(groupe.worldToLocal(caisse.localToWorld(p.set(o.position[0], o.position[1], o.position[2]))));
        centre.divideScalar(outlets.length);
        rig.lueur.mesh.position.set(centre.x - NOS_RENDU.lueur.recul, AU_DESSUS_DU_RAIL, centre.z);
        groupe.add(rig.lueur.mesh);
        v.groupe = groupe;
      }
    }
    rig.dard.mesh.visible = allume;
    rig.lueur.mesh.visible = allume && v.groupe !== null;
    if (allume) {
      rig.dard.uniforms.uForce.value = force;
      rig.dard.uniforms.uTemps.value = state.clock.elapsedTime;
      rig.lueur.uniforms.uForce.value = force * NOS_RENDU.lueur.force;
    }
    if (allume !== v.brule) {
      v.brule = allume;
      if (v.stage) v.stage.dataset.nosFlamme = allume ? 'oui' : 'non';
    }
  }, 0.5);
}
