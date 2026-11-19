// Néons du véhicule (Custom › Néons, src/data/neons.ts), au garage comme en sortie. Aucune vraie lumière :
// - les tubes (et les rubans de LED de l'habitacle) sont un seul maillage émissif, dans la caisse : il
//   suit l'assiette, passe dans le reflet du sol et fait briller le halo (bloom) ;
// - la lueur au sol est un seul maillage de nappes additives, une par tube, posé à plat sous le véhicule
//   (au garage à côté du modèle, en sortie par src/drive/scene/neons.ts) : vue par la caméra et la sonde de
//   réflexion (la caisse et les jantes la reflètent par en dessous), jamais par le reflet du sol, où elle
//   doublerait. Sur un sol mouillé, elle s'étire vers la caméra (`uStretch`) ;
// - les nappes de l'habitacle (plancher, contre-portes) sont un troisième maillage, dans la caisse.
// Couleur, intensité et respiration de chaque zone sont des uniformes : changer une couleur ne refait rien.
// Un véhicule sans néon allumé ne dessine rien (maillages cachés) : ni image ni coût de plus.

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Matrix4,
  Mesh,
  Object3D,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import { create } from 'zustand';
import { useMediaQuery } from '../../app/useMediaQuery.ts';
import {
  arceaux,
  etatsDeSignature,
  forceLueur,
  NEON_RESPIRATION,
  NEON_TUBE,
  NEON_ZONE_COUNT,
  NEON_ZONES,
  neonSignature,
  neonZonesOf,
  porteeLueur,
  type NeonEtat,
  type NeonNappe,
  type RoueNeon,
} from '../../data/neons.ts';
import type { VehicleManifest, VehiclePoint } from '../../data/vehicleTypes.ts';
import { NO_MIRROR_LAYER } from '../../render/layers.ts';
import { useBuilds } from '../../state/builds.ts';
import type { Prepared } from './VehicleModel.tsx';
import { STILL_BODY, useBodyPose, useWheelMounts, type BodyPose } from './wheels.ts';

/**
 * Nœud visé par le regard de la vue intérieure quand on règle les LED de l'habitacle (Intérieur › LED,
 * Néons › Habitacle) : au-dessus de la première nappe du manifeste (le pied de la planche), dans la caisse.
 */
export const NEON_REGARD = 'neons_regard';

/** Rang de dessin des pièces opaques du véhicule (comme VehicleModel.tsx) ; nappes après l'ombre de contact. */
const VEHICLE_RENDER_ORDER = -2;
const NAPPE_RENDER_ORDER = 3;
/** Faces d'un tube autour de sa ligne : six, un tube de 2 cm de large ne montre pas ses pans. */
const FACES = 6;
/** Segments d'un bout arrondi de nappe. */
const BOUT = 6;
/** Hauteur de la nappe au-dessus du sol (m) : au ras, sans scintiller contre lui. */
const AU_SOL = 0.006;

/** Réglages de rendu : force des tubes (au-delà de 1, ils passent le seuil du bloom), des nappes. */
export const NEON_RENDU = Object.freeze({
  /** Tube allumé, de nuit et au garage : franchement au-dessus du seuil du halo. */
  tube: 2.6,
  /** Tube de jour : lisible sans halo (« le tube seul, discret »). */
  tubeJour: 0.9,
  /** Force des nappes au sol, au plus près du tube. */
  nappe: 1.15,
  /** Force des nappes de l'habitacle. */
  cabine: 0.7,
  /** Étirement vers la caméra : sol du garage (carrelage brillant), chaussée sèche, chaussée mouillée. */
  etirementGarage: 0.35,
  etirementSec: 0.2,
  etirementMouille: 1.6,
});

export interface NeonUniforms {
  [name: string]: { value: unknown };
  uColor: { value: Color[] };
  uLevel: { value: number[] };
  uBreath: { value: number[] };
  uTime: { value: number };
  uGlow: { value: number };
  uHalo: { value: number };
  uStretch: { value: number };
  uCamDir: { value: Vector2 };
}

function createUniforms(): NeonUniforms {
  return {
    uColor: { value: NEON_ZONES.map(() => new Color(0, 0, 0)) },
    uLevel: { value: NEON_ZONES.map(() => 0) },
    uBreath: { value: NEON_ZONES.map(() => 0) },
    uTime: { value: 0 },
    uGlow: { value: NEON_RENDU.tube },
    uHalo: { value: 1 },
    uStretch: { value: NEON_RENDU.etirementGarage },
    uCamDir: { value: new Vector2(1, 0) },
  };
}

const ZONE_HEAD = /* glsl */ `
#define NEON_ZONES ${NEON_ZONE_COUNT}
uniform vec3 uColor[NEON_ZONES];
uniform float uLevel[NEON_ZONES];
uniform float uBreath[NEON_ZONES];
uniform float uTime;
attribute float aZone;
float neonLevel( out vec3 color ) {
  int z = int( aZone + 0.5 );
  float breath = 0.5 + 0.5 * sin( uTime * ${(2 * Math.PI / NEON_RESPIRATION.periode).toFixed(5)} );
  float b = mix( 1.0, ${NEON_RESPIRATION.creux.toFixed(3)} + ${(1 - NEON_RESPIRATION.creux).toFixed(3)} * breath, uBreath[z] );
  color = uColor[z];
  return uLevel[z] * b;
}`;

const TUBE_SHADER = {
  vertexShader: /* glsl */ `
${ZONE_HEAD}
uniform float uGlow;
varying vec3 vColor;
varying vec3 vNormalV;
varying vec3 vViewPos;
void main() {
  vec3 color;
  float level = neonLevel( color );
  vColor = color * level * uGlow;
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  vNormalV = normalMatrix * normal;
  vViewPos = -mv.xyz;
  // Zone éteinte : ses sommets sortent du champ, rien n'est dessiné.
  gl_Position = level > 0.0 ? projectionMatrix * mv : vec4( 2.0, 2.0, 2.0, 1.0 );
}`,
  fragmentShader: /* glsl */ `
varying vec3 vColor;
varying vec3 vNormalV;
varying vec3 vViewPos;
void main() {
  float facing = abs( dot( normalize( vNormalV ), normalize( vViewPos ) ) );
  // Cœur du tube plus clair, presque blanc ; bords de la couleur pure.
  float peak = max( vColor.r, max( vColor.g, vColor.b ) );
  vec3 c = mix( vColor * mix( 0.55, 1.0, facing ), vec3( peak ), 0.12 * pow( facing, 3.0 ) );
  gl_FragColor = vec4( c, 1.0 );
}`,
};

const NAPPE_SHADER = {
  vertexShader: /* glsl */ `
${ZONE_HEAD}
uniform float uHalo;
uniform float uStretch;
uniform vec2 uCamDir;
attribute vec2 aOut;
attribute float aD;
attribute float aForce;
varying vec3 vColor;
varying float vD;
varying float vFile;
void main() {
  vec3 color;
  float level = neonLevel( color ) * uHalo;
  vec3 p = position;
  p.xz += aOut;
  // Sur un sol qui brille, la lueur file vers qui la regarde : le bord tourné vers la caméra s'éloigne.
  float l = length( aOut );
  float file = l > 1e-5 ? max( dot( aOut / l, uCamDir ), 0.0 ) : 0.0;
  p.xz += uCamDir * file * uStretch * l;
  vColor = color * level * aForce;
  vD = aD;
  // Part de l'étirement (0 au tube, 1 au bout du reflet) : la traînée s'éteint en s'éloignant du tube.
  vFile = file * min( uStretch, 1.0 );
  gl_Position = level > 0.0 ? projectionMatrix * modelViewMatrix * vec4( p, 1.0 ) : vec4( 2.0, 2.0, 2.0, 1.0 );
}`,
  fragmentShader: /* glsl */ `
varying vec3 vColor;
varying float vD;
varying float vFile;
void main() {
  // Cloche douce, nulle au bord de la nappe ; la traînée sur le mouillé s'éteint vers son bout.
  float f = max( ( exp( -3.2 * vD * vD ) - 0.0408 ) / 0.9592, 0.0 );
  f *= 1.0 - 0.6 * smoothstep( 0.0, 1.0, vFile );
  gl_FragColor = vec4( vColor * f, 1.0 );
}`,
};

function tubeMaterial(uniforms: NeonUniforms): ShaderMaterial {
  const material = new ShaderMaterial({ ...TUBE_SHADER, uniforms, fog: false });
  material.name = 'neon_tube';
  return material;
}

function nappeMaterial(uniforms: NeonUniforms): ShaderMaterial {
  const material = new ShaderMaterial({ ...NAPPE_SHADER, uniforms, fog: false, transparent: true, depthWrite: false, blending: AdditiveBlending });
  material.name = 'neon_nappe';
  material.polygonOffset = true;
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -4;
  return material;
}

// ---------------------------------------------------------------------------------------------
// Géométries.

/** Un tube le long d'une ligne brisée : anneaux de FACES sommets, joints en onglet (aucun bouchon). */
function pushTube(line: readonly VehiclePoint[], radius: number, zone: number, out: { pos: number[]; nor: number[]; zone: number[]; index: number[] }): void {
  const n = line.length;
  if (n < 2) return;
  const t = new Vector3();
  const a = new Vector3();
  const b = new Vector3();
  const side = new Vector3();
  const up = new Vector3();
  const ref = new Vector3();
  const base = out.pos.length / 3;
  for (let i = 0; i < n; i += 1) {
    const p = line[i] as VehiclePoint;
    a.fromArray(line[Math.max(0, i - 1)] as VehiclePoint);
    b.fromArray(line[Math.min(n - 1, i + 1)] as VehiclePoint);
    t.subVectors(b, a).normalize();
    ref.set(0, 1, 0);
    if (Math.abs(t.y) > 0.9) ref.set(1, 0, 0);
    side.crossVectors(t, ref).normalize();
    up.crossVectors(side, t).normalize();
    for (let k = 0; k < FACES; k += 1) {
      const angle = (2 * Math.PI * k) / FACES;
      const nx = side.x * Math.cos(angle) + up.x * Math.sin(angle);
      const ny = side.y * Math.cos(angle) + up.y * Math.sin(angle);
      const nz = side.z * Math.cos(angle) + up.z * Math.sin(angle);
      out.pos.push(p[0] + nx * radius, p[1] + ny * radius, p[2] + nz * radius);
      out.nor.push(nx, ny, nz);
      out.zone.push(zone);
    }
  }
  for (let i = 0; i < n - 1; i += 1) {
    for (let k = 0; k < FACES; k += 1) {
      const k1 = (k + 1) % FACES;
      const p0 = base + i * FACES + k;
      const p1 = base + i * FACES + k1;
      const q0 = base + (i + 1) * FACES + k;
      const q1 = base + (i + 1) * FACES + k1;
      out.index.push(p0, q0, p1, p1, q0, q1);
    }
  }
}

interface NappeBuffers {
  pos: number[];
  out: number[];
  d: number[];
  zone: number[];
  force: number[];
  index: number[];
}

function newNappes(): NappeBuffers {
  return { pos: [], out: [], d: [], zone: [], force: [], index: [] };
}

/**
 * Une nappe : un ruban de part et d'autre de la ligne (plan horizontal à la hauteur y), de demi-largeur
 * `portee`, joints en onglet, et deux bouts arrondis. Les sommets de la ligne sont à la distance 0, ceux
 * du bord à 1 : la cloche du nuanceur se lit le long de cette distance. Un seul ruban par ligne, sans
 * recouvrement : des nappes additives qui se chevauchent feraient des bandes plus claires aux joints.
 */
function pushNappe(nappe: NeonNappe, buffers: NappeBuffers): void {
  const pts = nappe.points.filter((p, i) => i === 0 || Math.hypot(p[0] - (nappe.points[i - 1]?.[0] ?? 0), p[1] - (nappe.points[i - 1]?.[1] ?? 0)) > 1e-4);
  const n = pts.length;
  if (n === 0) return;
  const r = nappe.portee;
  const add = (x: number, z: number, ox: number, oz: number, d: number): number => {
    buffers.pos.push(x, nappe.y, z);
    buffers.out.push(ox, oz);
    buffers.d.push(d);
    buffers.zone.push(nappe.zone);
    buffers.force.push(nappe.force);
    return buffers.pos.length / 3 - 1;
  };
  // Tangentes des segments ; une tache seule regarde vers +X.
  const tangent = (i: number): [number, number] => {
    const p = pts[Math.min(i, n - 2)] as readonly [number, number];
    const q = pts[Math.min(i + 1, n - 1)] as readonly [number, number];
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    return l > 1e-6 ? [(q[0] - p[0]) / l, (q[1] - p[1]) / l] : [1, 0];
  };
  const centers: number[] = [];
  const lefts: number[] = [];
  const rights: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const [px, pz] = pts[i] as readonly [number, number];
    const t0 = tangent(Math.max(0, i - 1));
    const t1 = tangent(i);
    // Normale gauche moyenne, allongée en onglet (bornée à deux fois la portée).
    let mx = -(t0[1] + t1[1]);
    let mz = t0[0] + t1[0];
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml;
    mz /= ml;
    const k = Math.min(2, 1 / Math.max(0.5, mx * -t1[1] + mz * t1[0]));
    centers.push(add(px, pz, 0, 0, 0));
    lefts.push(add(px, pz, mx * r * k, mz * r * k, 1));
    rights.push(add(px, pz, -mx * r * k, -mz * r * k, 1));
  }
  for (let i = 0; i < n - 1; i += 1) {
    const c0 = centers[i] as number;
    const c1 = centers[i + 1] as number;
    const l0 = lefts[i] as number;
    const l1 = lefts[i + 1] as number;
    const r0 = rights[i] as number;
    const r1 = rights[i + 1] as number;
    buffers.index.push(c0, l0, c1, c1, l0, l1, c0, c1, r0, r0, c1, r1);
  }
  // Bouts : demi-disques, de la normale gauche à la droite, en passant par l'arrière (début) ou l'avant (fin).
  const cap = (i: number, sens: 1 | -1) => {
    const [cx, cz] = pts[i] as readonly [number, number];
    const t = tangent(sens === 1 ? n - 1 : 0);
    const nx = -t[1];
    const nz = t[0];
    const center = centers[i] as number;
    let previous = lefts[i] as number;
    for (let k = 1; k <= BOUT; k += 1) {
      const angle = (Math.PI * k) / BOUT;
      const ox = (nx * Math.cos(angle) + sens * t[0] * Math.sin(angle)) * r;
      const oz = (nz * Math.cos(angle) + sens * t[1] * Math.sin(angle)) * r;
      const next = k === BOUT ? (rights[i] as number) : add(cx, cz, ox, oz, 1);
      // Bout de fin : les triangles tournent dans l'autre sens (pas de face cachée : rien n'est éliminé).
      buffers.index.push(center, previous, next);
      previous = next;
    }
  };
  cap(0, -1);
  cap(n - 1, 1);
}

function geometryOf(attributes: Record<string, [number[], number]>, index: number[]): BufferGeometry {
  const geometry = new BufferGeometry();
  for (const [name, [values, size]] of Object.entries(attributes)) geometry.setAttribute(name, new BufferAttribute(new Float32Array(values), size));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return geometry;
}

/** Point du repère de la caisse au repos, porté au repère du sol (assiette : montée et bascule). */
function toGround(p: VehiclePoint, pose: BodyPose): VehiclePoint {
  const c = Math.cos(pose.pitch);
  const s = Math.sin(pose.pitch);
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c + pose.y, p[2]];
}

/** Point du repère du sol, porté au repère de la caisse au repos (inverse de toGround). */
function toBody(p: VehiclePoint, pose: BodyPose): VehiclePoint {
  const c = Math.cos(pose.pitch);
  const s = Math.sin(pose.pitch);
  const y = p[1] - pose.y;
  return [p[0] * c + y * s, -p[0] * s + y * c, p[2]];
}

export interface NeonGeometry {
  tubes: BufferGeometry;
  sol: BufferGeometry;
  cabine: BufferGeometry | null;
  /** Nombre de tubes et de nappes, pour les parcours et les mesures. */
  compte: { tubes: number; nappes: number };
}

/**
 * Tubes, nappes au sol et nappes de l'habitacle d'un véhicule, pour ses roues posées et sa caisse à
 * l'assiette `pose`. Une ligne d'une zone extérieure fait une nappe par segment au sol ; un arceau de
 * roue, une seule nappe (sa corde) : ses segments, empilés à la verticale, se recouvriraient.
 */
export function buildNeonGeometry(vehicle: Pick<VehicleManifest, 'neons' | 'kind'>, roues: readonly RoueNeon[], pose: BodyPose): NeonGeometry {
  const tubes = { pos: [] as number[], nor: [] as number[], zone: [] as number[], index: [] as number[] };
  const sol = newNappes();
  const cabine = newNappes();
  let lines = 0;
  let nappes = 0;
  for (const zone of neonZonesOf(vehicle)) {
    const rank = NEON_ZONES.findIndex((item) => item.id === zone.id);
    const habitacle = zone.habitacle === true;
    const radius = zone.spec.radius ?? (habitacle ? NEON_TUBE.ruban : NEON_TUBE.rayon);
    const own = zone.spec.tubes ?? [];
    const arcs = zone.spec.arceaux ? arceaux(vehicle.kind, roues) : [];
    for (const line of [...own, ...arcs]) {
      pushTube(line, radius, rank, tubes);
      lines += 1;
    }
    if (habitacle) {
      for (const pool of zone.spec.pools ?? []) pushNappe({ zone: rank, points: [[pool.from[0], pool.from[2]], [pool.to[0], pool.to[2]]], y: (pool.from[1] + pool.to[1]) / 2 + AU_SOL, portee: pool.radius, force: NEON_RENDU.cabine }, cabine);
      continue;
    }
    // Une nappe par ligne, à la hauteur moyenne de ses points au-dessus du sol (caisse posée).
    const nappe = (line: readonly VehiclePoint[]) => {
      const ground = line.map((p) => toGround(p, pose));
      const h = ground.reduce((sum, p) => sum + p[1], 0) / Math.max(1, ground.length);
      pushNappe({ zone: rank, points: ground.map((p) => [p[0], p[2]] as const), y: AU_SOL, portee: porteeLueur(h), force: forceLueur(h) * NEON_RENDU.nappe }, sol);
      nappes += 1;
    };
    for (const line of own) nappe(line);
    for (const line of arcs) {
      // Corde de l'arceau, à la hauteur moyenne de ses points : ses segments, empilés à la verticale,
      // feraient une ligne qui revient sur elle-même.
      const ys = line.reduce((sum, p) => sum + p[1], 0) / line.length;
      const xs = line.map((p) => p[0]);
      const z = line[0]?.[2] ?? 0;
      nappe([
        [Math.min(...xs), ys, z],
        [Math.max(...xs), ys, z],
      ]);
    }
  }
  return {
    tubes: geometryOf({ position: [tubes.pos, 3], normal: [tubes.nor, 3], aZone: [tubes.zone, 1] }, tubes.index),
    sol: geometryOf({ position: [sol.pos, 3], aOut: [sol.out, 2], aD: [sol.d, 1], aZone: [sol.zone, 1], aForce: [sol.force, 1] }, sol.index),
    cabine: cabine.pos.length > 0 ? geometryOf({ position: [cabine.pos, 3], aOut: [cabine.out, 2], aD: [cabine.d, 1], aZone: [cabine.zone, 1], aForce: [cabine.force, 1] }, cabine.index) : null,
    compte: { tubes: lines, nappes },
  };
}

// ---------------------------------------------------------------------------------------------
// Roues posées, mesurées dans le repère de la caisse au repos.

const work = { inverse: new Matrix4(), m: new Matrix4(), v: new Vector3() };

/**
 * Roues du modèle préparé : pour chaque ancre, la boîte de ce qui y est posé (pneu et jante de l'atelier,
 * ou roue du modèle), mesurée sur ses sommets dans le repère du véhicule, puis portée dans celui de la
 * caisse au repos. Un sommet sur quatre suffit à la boîte.
 */
export function measureWheels(prepared: Prepared, pose: BodyPose): RoueNeon[] {
  prepared.root.updateMatrixWorld(true);
  work.inverse.copy(prepared.root.matrixWorld).invert();
  const roues: RoueNeon[] = [];
  for (const anchor of prepared.wheels.anchors) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    anchor.node.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const position = object.geometry.getAttribute('position');
      if (!position) return;
      work.m.multiplyMatrices(work.inverse, object.matrixWorld);
      for (let i = 0; i < position.count; i += 4) {
        work.v.fromBufferAttribute(position, i).applyMatrix4(work.m);
        min[0] = Math.min(min[0] as number, work.v.x);
        min[1] = Math.min(min[1] as number, work.v.y);
        min[2] = Math.min(min[2] as number, work.v.z);
        max[0] = Math.max(max[0] as number, work.v.x);
        max[1] = Math.max(max[1] as number, work.v.y);
        max[2] = Math.max(max[2] as number, work.v.z);
      }
    });
    if (!Number.isFinite(min[0])) continue;
    const centre: VehiclePoint = [((min[0] as number) + (max[0] as number)) / 2, ((min[1] as number) + (max[1] as number)) / 2, ((min[2] as number) + (max[2] as number)) / 2];
    const rayon = ((max[1] as number) - (min[1] as number)) / 2;
    roues.push({ centre: toBody(centre, pose), rayon, jante: rayon * 0.68, demiLargeur: ((max[2] as number) - (min[2] as number)) / 2 });
  }
  return roues;
}

// ---------------------------------------------------------------------------------------------
// Le rig : trois maillages, deux matériaux, un jeu d'uniformes.

export class NeonsRig {
  readonly uniforms = createUniforms();
  readonly tubes: Mesh;
  readonly cabine: Mesh;
  /** Nappes au sol, à poser par l'appelant à plat sous le véhicule, dans son repère (y = 0 : le sol). */
  readonly sol: Group;
  /** Point regardé depuis la vue intérieure pendant le réglage des LED (NEON_REGARD). */
  readonly regard = new Object3D();
  private readonly solMesh: Mesh;
  private readonly tubeMaterial: ShaderMaterial;
  private readonly nappeMaterial: ShaderMaterial;
  private readonly empty = new BufferGeometry();
  /** Zones allumées en ce moment, et zones qui respirent. */
  allumees = 0;
  respire = false;
  compte = { tubes: 0, nappes: 0 };

  constructor() {
    this.tubeMaterial = tubeMaterial(this.uniforms);
    this.nappeMaterial = nappeMaterial(this.uniforms);
    this.tubes = new Mesh(this.empty, this.tubeMaterial);
    this.tubes.name = 'neons_tubes';
    this.tubes.renderOrder = VEHICLE_RENDER_ORDER;
    this.tubes.frustumCulled = false;
    this.cabine = new Mesh(this.empty, this.nappeMaterial);
    this.cabine.name = 'neons_habitacle';
    this.cabine.renderOrder = NAPPE_RENDER_ORDER;
    this.cabine.frustumCulled = false;
    this.solMesh = new Mesh(this.empty, this.nappeMaterial);
    this.solMesh.name = 'neons_sol';
    this.solMesh.renderOrder = NAPPE_RENDER_ORDER;
    this.solMesh.frustumCulled = false;
    // Vue par la caméra et la sonde, pas par le reflet du sol (src/render/layers.ts).
    this.solMesh.layers.set(NO_MIRROR_LAYER);
    this.sol = new Group();
    this.sol.name = 'neons_lueur';
    this.sol.add(this.solMesh);
    this.tubes.visible = this.cabine.visible = this.sol.visible = false;
    this.regard.name = NEON_REGARD;
  }

  /** Pose une géométrie neuve (l'ancienne est libérée). */
  setGeometry(geometry: NeonGeometry): void {
    this.disposeGeometry();
    this.tubes.geometry = geometry.tubes;
    this.solMesh.geometry = geometry.sol;
    this.cabine.geometry = geometry.cabine ?? this.empty;
    this.compte = geometry.compte;
    this.updateVisibility();
  }

  /** Couleur, intensité et mode de chaque zone (sans allocation). */
  apply(etats: readonly NeonEtat[], reducedMotion: boolean): void {
    const { uColor, uLevel, uBreath } = this.uniforms;
    for (let i = 0; i < NEON_ZONE_COUNT; i += 1) uLevel.value[i] = 0;
    let on = 0;
    let breathing = false;
    for (const etat of etats) {
      const rank = NEON_ZONES.findIndex((zone) => zone.id === etat.zone.id);
      if (rank < 0) continue;
      (uColor.value[rank] as Color).set(etat.color);
      uLevel.value[rank] = etat.on ? etat.intensity : 0;
      const breathes = etat.on && etat.mode === 'respiration' && !reducedMotion;
      uBreath.value[rank] = breathes ? 1 : 0;
      if (etat.on) on += 1;
      if (breathes) breathing = true;
    }
    this.allumees = on;
    this.respire = breathing;
    this.updateVisibility();
  }

  /** Temps de la respiration, en secondes. */
  tick(seconds: number): void {
    this.uniforms.uTime.value = seconds;
  }

  /** Étirement de la lueur vers la caméra (`camera`, position dans le monde ; `frame` : le repère de la lueur). */
  aim(frame: Object3D, camera: Vector3): void {
    aimAtCamera(this, frame, camera);
  }

  /** Moment et sol : force de la lueur au sol, des tubes, étirement vers la caméra. */
  regler(halo: number, glow: number, stretch: number): void {
    this.uniforms.uHalo.value = halo;
    this.uniforms.uGlow.value = glow;
    this.uniforms.uStretch.value = stretch;
  }

  /** Zones de l'habitacle allumées ? (les nappes de l'habitacle ne se montrent qu'alors). */
  private habitacleOn(): boolean {
    const rank = NEON_ZONES.findIndex((zone) => zone.habitacle);
    return rank >= 0 && (this.uniforms.uLevel.value[rank] ?? 0) > 0;
  }

  private exterieurOn(): boolean {
    return NEON_ZONES.some((zone, rank) => !zone.habitacle && (this.uniforms.uLevel.value[rank] ?? 0) > 0);
  }

  private updateVisibility(): void {
    const has = (mesh: Mesh) => mesh.geometry !== this.empty && (mesh.geometry.index?.count ?? 0) > 0;
    this.tubes.visible = this.allumees > 0 && has(this.tubes);
    this.cabine.visible = this.habitacleOn() && has(this.cabine);
    this.sol.visible = this.exterieurOn() && has(this.solMesh);
  }

  private disposeGeometry(): void {
    for (const mesh of [this.tubes, this.cabine, this.solMesh]) if (mesh.geometry !== this.empty) mesh.geometry.dispose();
  }

  dispose(): void {
    this.disposeGeometry();
    this.empty.dispose();
    this.tubeMaterial.dispose();
    this.nappeMaterial.dispose();
  }
}

/** Direction (repère du véhicule, au sol) du milieu du véhicule vers la caméra, pour l'étirement (sans allocation). */
const camWork = { local: new Vector3(), inverse: new Matrix4() };
export function aimAtCamera(rig: NeonsRig, frame: Object3D, cameraPosition: Vector3): void {
  camWork.inverse.copy(frame.matrixWorld).invert();
  camWork.local.copy(cameraPosition).applyMatrix4(camWork.inverse);
  const l = Math.hypot(camWork.local.x, camWork.local.z);
  if (l > 1e-4) rig.uniforms.uCamDir.value.set(camWork.local.x / l, camWork.local.z / l);
}

/**
 * Lueur au sol posée, par véhicule et par scène (« <véhicule>:<classe de la scène> ») : la clé des zones extérieures allumées, une fois leurs nappes dans la
 * scène (vide sinon). La sonde du garage la suit (useNeonsProbeVersion).
 */
const useNeonsPoses = create<{ poses: Record<string, string>; poser: (vehicle: string, cle: string) => void }>()((set) => ({
  poses: {},
  poser: (vehicle, cle) => set((state) => (state.poses[vehicle] === cle ? state : { poses: { ...state.poses, [vehicle]: cle } })),
}));

function cleExterieure(signature: string): string {
  return signature
    .split('|')
    .filter((part) => part !== '' && !NEON_ZONES.some((zone) => zone.habitacle && part.startsWith(`${zone.id}:`)))
    .join('|');
}

/** Ce qui, dans un build, touche aux néons : une clé stable, et les zones allumées qu'elle dit. */
export function useNeonState(vehicle: VehicleManifest): { signature: string; etats: NeonEtat[] } {
  const signature = useBuilds((state) => neonSignature(vehicle, state.builds[vehicle.id]));
  const etats = useMemo(() => etatsDeSignature(signature), [signature]);
  return { signature, etats };
}

/**
 * Les néons du build sur le modèle préparé : tubes et nappes de l'habitacle dans la caisse, nappes au sol
 * dans `rig.sol` (à poser par l'appelant). Géométrie refaite quand les roues ou l'assiette changent ;
 * réglages posés à chaque changement (une image redemandée) ; respiration animée (une image par image
 * tant qu'une zone respire, rien sinon). Attributs `data-neons` (zones allumées, leur mode et leur couleur)
 * et `data-neons-tubes` (tubes dessinés) sur l'élément de la scène (classe `stageClass`), pour les parcours.
 */
export function useNeons(prepared: Prepared, vehicle: VehicleManifest, invalidate: () => void, options: { stageClass: string; aim: boolean }): NeonsRig {
  const { stageClass, aim } = options;
  const gl = useThree((state) => state.gl);
  const rig = useMemo(() => new NeonsRig(), []);
  useEffect(() => () => rig.dispose(), [rig]);
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const { signature, etats } = useNeonState(vehicle);
  const has = neonZonesOf(vehicle).length > 0;
  const lit = signature !== '';

  // Géométrie : quand un néon est allumé, et à chaque pose des roues ou de l'assiette.
  const stamp = useWheelMounts((state) => state.mounts[prepared.root.uuid]?.stamp ?? 0);
  const pose = useBodyPose((state) => state.poses[vehicle.id]) ?? STILL_BODY;
  useLayoutEffect(() => {
    if (!has || !lit) return;
    const roues = vehicle.neons?.roues?.arceaux ? measureWheels(prepared, pose) : [];
    rig.setGeometry(buildNeonGeometry(vehicle, roues, pose));
    const stage = gl.domElement.closest<HTMLElement>(`.${stageClass}`);
    if (stage) stage.dataset.neonsTubes = String(rig.tubes.visible ? rig.compte.tubes : 0);
    invalidate();
  }, [rig, prepared, vehicle, has, lit, stamp, pose, invalidate, gl, stageClass]);

  // Tubes et nappes de l'habitacle : dans la caisse, qui porte l'assiette ; le point que la vue intérieure
  // regarde pendant le réglage des LED, au-dessus de la première nappe de l'habitacle.
  useLayoutEffect(() => {
    const body = prepared.wheels.body;
    body.add(rig.tubes, rig.cabine);
    const pool = vehicle.neons?.habitacle?.pools?.[0];
    if (pool) {
      rig.regard.position.set((pool.from[0] + pool.to[0]) / 2, (pool.from[1] + pool.to[1]) / 2 + 0.1, (pool.from[2] + pool.to[2]) / 2);
      body.add(rig.regard);
    }
    return () => {
      rig.tubes.removeFromParent();
      rig.cabine.removeFromParent();
      rig.regard.removeFromParent();
    };
  }, [rig, prepared, vehicle]);

  useLayoutEffect(() => {
    rig.apply(etats, reducedMotion);
    invalidate();
    const stage = gl.domElement.closest<HTMLElement>(`.${stageClass}`);
    useNeonsPoses.getState().poser(`${vehicle.id}:${stageClass}`, rig.sol.visible ? cleExterieure(signature) : '');
    if (stage) {
      stage.dataset.neons = signature || 'eteints';
      stage.dataset.neonsTubes = String(rig.tubes.visible ? rig.compte.tubes : 0);
    }
    return () => {
      useNeonsPoses.getState().poser(`${vehicle.id}:${stageClass}`, '');
      if (!stage) return;
      delete stage.dataset.neons;
      delete stage.dataset.neonsTubes;
    };
  }, [rig, etats, signature, reducedMotion, invalidate, gl, stageClass, vehicle.id]);

  // Respiration : le temps avance, une image par image, tant qu'une zone respire.
  // Au garage, la lueur s'étire vers la caméra (la sortie le fait elle-même : src/drive/scene/neons.ts).
  useFrame(({ camera, clock }) => {
    if (aim && rig.sol.visible) rig.aim(rig.sol, camera.position);
    if (!rig.respire) return;
    rig.tick(clock.elapsedTime);
    invalidate();
  });
  return rig;
}

/** Attente après le dernier réglage avant de refaire la sonde du garage (un glissement du nuancier n'en refait qu'une). */
const PROBE_DELAY_MS = 350;

/**
 * Clé de la lueur au sol posée pour ce véhicule, `PROBE_DELAY_MS` après le dernier changement : la scène
 * du garage l'ajoute à la version de la sonde, qui se refait alors une fois (src/scene/GarageCanvas.tsx).
 * Vide : rien d'allumé dehors (ou modèle pas encore posé), la sonde ne change pas.
 */
export function useNeonsProbeVersion(vehicle: VehicleManifest, stageClass = 'stage'): string {
  const posed = useNeonsPoses((state) => state.poses[`${vehicle.id}:${stageClass}`] ?? '');
  const [version, setVersion] = useState(posed);
  useEffect(() => {
    if (posed === version) return undefined;
    const timer = window.setTimeout(() => setVersion(posed), PROBE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [posed, version]);
  return version;
}
