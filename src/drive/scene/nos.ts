// NOS en sortie (src/data/nos.ts) : pendant la poussée, un dard bleu à chaque sortie d'échappement déclarée
// par le manifeste (`exhaust.outlets` ; un véhicule sans sortie déclarée n'en a pas), et une lueur bleue
// sur la chaussée derrière elles, qui se diffuse. Le dard reprend la forme des jets du retour de flammes
// (src/scene/vehicle/flammes.ts : même géométrie, même nuanceur de sommets) avec sa propre couleur : presque
// blanc à la bouche, bleu vif, violet au bout. Deux maillages, cachés hors poussée (aucun appel de dessin),
// compilés à la pose (pas d'à-coup au premier envoi). La scène publie `data-nos-flamme` (« oui » tant qu'un
// dard brûle) pour les parcours. Rien n'est alloué par image : des uniformes changent.

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { AddEquation, AdditiveBlending, CustomBlending, DoubleSide, Mesh, OneFactor, OneMinusSrcAlphaFactor, PlaneGeometry, ShaderMaterial, Vector3, ZeroFactor, type Object3D, type Scene } from 'three';
import { liveNos, NOS_RENDU, NOS_SEUIL } from '../../data/nos.ts';
import type { ExhaustOutlet, VehicleManifest } from '../../data/vehicleTypes.ts';
import { ATMOSPHERE_LAYER } from '../../render/layers.ts';
import { compileHidden, geometrieFlammes, VERTEX } from '../../scene/vehicle/flammes.ts';
import { DRIVE_STAGE_CLASS } from '../contrat.ts';

const DARD = /* glsl */ `
uniform float uForce;
uniform float uTemps;
uniform float uEclat;
uniform float uVoile;
varying float vLong;
varying float vCote;
varying float vL;
varying float vW;
varying float vGraine;
void main() {
  float sur = clamp( vLong, 0.0, vL );
  float d = length( vec2( vLong - sur, vCote ) );
  float axe = smoothstep( 0.25 * vW, 1.2 * vW, vL );
  float t = mix( clamp( d / vW, 0.0, 1.0 ), vL > 1e-5 ? sur / vL : 0.0, axe );
  // Dard : plein à la bouche, effilé jusqu'à la pointe.
  float r = mix( vW, vW * ( 1.0 - 0.85 * smoothstep( 0.0, 1.0, t ) ), axe );
  float forme = 1.0 - smoothstep( 0.35 * r, r, d );
  float coeur = exp( -pow( d / max( 0.3 * r, 1e-4 ), 2.0 ) ) * ( 1.0 - smoothstep( 0.0, 0.55, t ) );
  vec3 c = mix( vec3( 0.8, 0.9, 1.0 ), vec3( 0.12, 0.42, 1.0 ), smoothstep( 0.0, 0.35, t ) );
  c = mix( c, vec3( 0.5, 0.16, 1.0 ), smoothstep( 0.5, 0.95, t ) );
  // Anneaux qui filent le long du dard.
  float anneaux = 0.78 + 0.22 * sin( vLong * 55.0 - uTemps * 46.0 + vGraine * 9.0 );
  float corps = forme * pow( 1.0 - t, 0.55 ) * uForce;
  gl_FragColor = vec4( c * corps * anneaux * uEclat + vec3( 0.85, 0.92, 1.0 ) * coeur * uForce * 0.8, min( 1.0, corps * uVoile ) );
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
const AU_DESSUS_DU_RAIL = 0.075;

function creerDard(outlets: readonly ExhaustOutlet[]) {
  const D = NOS_RENDU.dard;
  const uniforms = {
    uForce: { value: 0 },
    uTemps: { value: 0 },
    uLongueur: { value: D.longueur },
    uLargeur: { value: D.largeur },
    uDisque: { value: D.disque },
    uEclat: { value: D.eclat },
    uVoile: { value: D.voile },
  };
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
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

function creerLueur() {
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

export function useNosSortie(root: Object3D, vehicle: VehicleManifest): void {
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
    v.stage = gl.domElement.closest<HTMLElement>(`.${DRIVE_STAGE_CLASS}`);
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
  }, [rig, root, gl, camera, scene]);

  // Après le moteur de la scène (priorité 0), qui avance `liveNos` ; avant la chaîne d'image (1).
  useFrame((state) => {
    const v = vivant.current;
    const rig = v.rig;
    if (!rig || !outlets) return;
    const force = liveNos.force;
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
