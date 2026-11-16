// Décor de la sortie de nuit : les tronçons de la carte autour du véhicule (chargés au fil de la
// route, libérés derrière lui), habillés par rôle (src/drive/scene/materiaux.ts), leurs instances
// (arbres et palmiers en silhouettes, lampadaires et leur halo, balises, feux tricolores et leur
// lentille allumée, enseignes au néon en agglomération ou aux commerces connus de la carte), le
// relief des tronçons chargés pour la garde des caméras (src/drive/scene/relief.ts), et le relief
// lointain en silhouette sur le ciel. Aucune carte n'est connue ici : tout vient du manifeste et de
// route.json.

import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry as Geometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import type { Rail } from '../contrat.ts';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MAP_INSTANCE_STRIDE, MAP_SHOP_KINDS, MAP_SHOP_STRIDE, type MapChunk, type MapRoute } from '../../data/mapTypes.ts';
import { NO_MIRROR_LAYER } from '../../render/layers.ts';
import { createPose } from '../rail.ts';
import { SKY } from './ciel.ts';
import { DECOR_SIGN_CELLS, placeSigns, shopSignCell, type PlacedSigns, type SignSpot } from './enseignes.ts';
import { emitAttribute, isNoMirror, patchNight, type NightUniforms } from './materiaux.ts';
import { facadeAttribute, roadAttribute, tunnelLamps, tunnelSpans, type Span } from './abri.ts';
import { chunkAt, chunkPlan, wantedChunks, type DriveProfile } from './profil.ts';
import { addRoleMesh, createChunkRelief, Relief } from './relief.ts';

/** Hauteur de la tête d'un lampadaire et longueur de sa crosse (vers +Z de l'instance, côté chaussée). */
export const LAMP_HEAD = { height: 7.9, reach: 1.45 } as const;

function treeGeometry(): BufferGeometry {
  // Deux cônes ouverts empilés (résineux du plateau) : 12 triangles, une silhouette sur le ciel.
  const low = new ConeGeometry(2.3, 6.2, 6, 1, true).translate(0, 4.3, 0);
  const high = new ConeGeometry(1.5, 4.6, 6, 1, true).translate(0, 7.9, 0);
  const g = mergeGeometries([low, high]) as BufferGeometry;
  low.dispose();
  high.dispose();
  return g;
}

function lampGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [
    new CylinderGeometry(0.06, 0.1, LAMP_HEAD.height + 0.2, 5, 1, true).translate(0, (LAMP_HEAD.height + 0.2) / 2, 0),
    new BoxGeometry(0.07, 0.07, LAMP_HEAD.reach + 0.1).translate(0, LAMP_HEAD.height + 0.15, (LAMP_HEAD.reach + 0.1) / 2),
    new BoxGeometry(0.34, 0.1, 0.62).translate(0, LAMP_HEAD.height + 0.06, LAMP_HEAD.reach),
  ];
  parts.forEach((p, i) => {
    const n = p.getAttribute('position').count;
    // Seul le dessous de la tête brille : ses sommets du bas (y < tête).
    const emit = emitAttribute(n, n);
    if (i === 2) {
      const pos = p.getAttribute('position');
      for (let k = 0; k < n; k += 1) emit.setX(k, pos.getY(k) < LAMP_HEAD.height + 0.06 ? 1 : 0);
    }
    p.setAttribute('pmbEmit', emit);
  });
  const g = mergeGeometries(parts) as BufferGeometry;
  for (const p of parts) p.dispose();
  return g;
}

function baliseGeometry(): BufferGeometry {
  return new BoxGeometry(0.11, 1.05, 0.11).translate(0, 0.52, 0);
}

/** Panneau de signalisation sans texte : mât de 2,3 m et plaque ronde ou triangulaire, face à la route (+Z). */
function panneauGeometry(triangle: boolean): BufferGeometry {
  const mat = new CylinderGeometry(0.035, 0.035, 2.3, 5, 1, true).translate(0, 1.15, 0);
  const plaque = (triangle ? new CircleGeometry(0.45, 3, Math.PI / 2) : new CircleGeometry(0.33, 14)).translate(0, 2.3, 0.04);
  const dos = plaque.clone().rotateY(Math.PI).translate(0, 0, 0.0);
  const parts = [mat.toNonIndexed(), plaque.toNonIndexed(), dos.toNonIndexed()];
  for (const p of parts) p.deleteAttribute('uv');
  const g = mergeGeometries(parts) as BufferGeometry;
  for (const p of [mat, plaque, dos, ...parts]) p.dispose();
  return g;
}

/** Palmier : stipe de 7,5 m et sept palmes retombantes, vues des deux faces (≈ 40 triangles). */
export function palmGeometry(): BufferGeometry {
  const trunk = new CylinderGeometry(0.15, 0.24, 7.6, 5, 1, true).translate(0, 3.8, 0);
  const pos: number[] = [];
  const top = 7.5;
  for (let k = 0; k < 7; k += 1) {
    const a = (k / 7) * Math.PI * 2 + 0.3;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const at = (r: number, w: number, y: number) => [c * r - sn * w, y, sn * r + c * w];
    const base = [0, top, 0];
    const left = at(1.3, -0.42, top + 0.35);
    const right = at(1.3, 0.42, top + 0.35);
    const tip = at(3, 0, top - 1.1);
    for (const t of [
      [base, left, tip],
      [base, tip, right],
      [base, tip, left],
      [base, right, tip],
    ])
      for (const v of t) pos.push(...(v as number[]));
  }
  const crown = new Geometry();
  crown.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  crown.computeVertexNormals();
  // Mêmes attributs des deux côtés : position et normale (le stipe perd ses coordonnées de texture).
  const stipe = trunk.toNonIndexed();
  stipe.deleteAttribute('uv');
  const g = mergeGeometries([stipe, crown]) as BufferGeometry;
  stipe.dispose();
  trunk.dispose();
  crown.dispose();
  return g;
}

/** Hauteur des lentilles d'un feu tricolore : rouge en haut, vert en bas. */
export const FEU = { red: 3.5, green: 2.66, lensZ: 0.2 } as const;

/** Feu tricolore : mât et boîtier sombres (la lentille allumée est une instance à part). */
function feuGeometry(): BufferGeometry {
  const parts = [new CylinderGeometry(0.07, 0.09, 3.6, 5, 1, true).translate(0, 1.8, 0), new BoxGeometry(0.5, 1.3, 0.34).translate(0, 3.08, 0)];
  for (const p of parts) p.setAttribute('pmbEmit', emitAttribute(p.getAttribute('position').count, Infinity));
  const g = mergeGeometries(parts) as BufferGeometry;
  for (const p of parts) p.dispose();
  return g;
}

/** Hachage déterministe d'une position : la couleur allumée d'un feu. */
const feuHash = (x: number, z: number) => {
  const v = Math.sin(x * 0.373 + z * 0.117) * 43758.5453;
  return v - Math.floor(v);
};

/**
 * Lentilles allumées des feux d'un tronçon (rouge ou vert, tiré par la position), et leur lumière
 * (position dans le repère de la carte et teinte, 6 nombres chacune) pour les reflets de la chaussée.
 */
function feuLenses(data: readonly number[], origin: readonly number[], geometry: BufferGeometry, material: Material): { mesh: InstancedMesh | null; lights: number[] } {
  const n = data.length / MAP_INSTANCE_STRIDE;
  const lights: number[] = [];
  if (n <= 0) return { mesh: null, lights };
  const mesh = new InstancedMesh(geometry, material, n);
  const color = new Color();
  for (let i = 0; i < n; i += 1) {
    const o = i * MAP_INSTANCE_STRIDE;
    const cap = data[o + 4] ?? 0;
    const red = feuHash(data[o] ?? 0, data[o + 2] ?? 0) < 0.6;
    work.q.setFromAxisAngle(work.y, cap);
    work.p.set((data[o] ?? 0) + Math.sin(cap) * FEU.lensZ, (data[o + 1] ?? 0) + (red ? FEU.red : FEU.green), (data[o + 2] ?? 0) + Math.cos(cap) * FEU.lensZ);
    work.s.set(1, 1, 1);
    work.m.compose(work.p, work.q, work.s);
    mesh.setMatrixAt(i, work.m);
    // Au-delà de 1 : la lentille passe le seuil du halo (bloom).
    mesh.setColorAt(i, red ? color.setRGB(3.2, 0.1, 0.04) : color.setRGB(0.08, 2.6, 0.9));
    lights.push(work.p.x + (origin[0] ?? 0) + Math.sin(cap) * 0.5, work.p.y + (origin[1] ?? 0), work.p.z + (origin[2] ?? 0) + Math.cos(cap) * 0.5, ...(red ? [1, 0.07, 0.03] : [0.05, 1, 0.42]));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return { mesh, lights };
}

// Halo d'un lampadaire, face à la caméra. Dans les plans rapides, il s'étire le long de son
// déplacement à l'écran depuis l'image précédente (traînée lumineuse, pose d'environ 1/16 s) en
// gardant à peu près sa lumière totale.
const HALO_VERTEX = /* glsl */ `
uniform float uSize;
uniform float uFogFar;
uniform mat4 uPrevViewProj;
uniform float uTrail;
uniform float uAspect;
varying vec2 vUv;
varying float vFade;
varying float vStretch;
void main() {
  vUv = position.xy;
  vec4 world = modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
  vec4 view = viewMatrix * world;
  float d = -view.z;
  vFade = ( 1.0 - smoothstep( uFogFar * 0.35, uFogFar, d ) ) * smoothstep( 3.0, 16.0, d );
  vec4 clip = projectionMatrix * view;
  vec4 prev = uPrevViewProj * world;
  vec2 dl = vec2( 0.0 );
  if ( prev.w > 0.1 && clip.w > 0.1 ) dl = ( clip.xy / clip.w - prev.xy / prev.w ) * vec2( uAspect, 1.0 ) * uTrail;
  float len = min( length( dl ), 0.5 );
  vec2 ax = len > 1e-5 ? normalize( dl ) : vec2( 1.0, 0.0 );
  vec2 ay = vec2( -ax.y, ax.x );
  float sz = uSize * projectionMatrix[ 1 ][ 1 ] / max( clip.w, 1e-3 );
  vec2 off = ax * ( position.x * ( sz + len ) - len * 0.5 ) + ay * position.y * sz;
  vStretch = sz / ( sz + len );
  gl_Position = clip + vec4( off * vec2( 1.0 / uAspect, 1.0 ) * clip.w, 0.0, 0.0 );
}`;

const HALO_FRAGMENT = /* glsl */ `
uniform vec3 pmbLampColor;
uniform float uGain;
varying vec2 vUv;
varying float vFade;
varying float vStretch;
void main() {
  float r2 = dot( vUv, vUv ) * 4.0;
  float core = exp( -r2 * 40.0 ) * 3.0;
  float halo = exp( -r2 * 5.0 ) * 0.35;
  gl_FragColor = vec4( pmbLampColor * ( core + halo ) * uGain * vFade * mix( 1.0, vStretch, 0.65 ), 1.0 );
}`;

/** Matières et géométries partagées par tous les tronçons. */
export class DecorKit {
  readonly tree = treeGeometry();
  readonly lamp = lampGeometry();
  readonly balise = baliseGeometry();
  readonly panneaux = [panneauGeometry(false), panneauGeometry(true)] as const;
  readonly palm = palmGeometry();
  readonly feu = feuGeometry();
  readonly lens = new CircleGeometry(0.19, 12);
  readonly halo = new PlaneGeometry(1, 1);
  /** Mât d'une enseigne sur pied : boîte unité, à l'échelle dans sa matrice. */
  readonly pole = new BoxGeometry(1, 1, 1, 1, 1, 1);

  readonly treeMaterial: MeshStandardMaterial;
  readonly lampMaterial: MeshStandardMaterial;
  readonly baliseMaterial: MeshStandardMaterial;
  /** Lentilles allumées des feux : teinte par instance, au-delà de 1. */
  readonly lensMaterial = new MeshBasicMaterial({ color: '#ffffff' });
  readonly haloMaterial: ShaderMaterial;
  readonly farMaterial: MeshStandardMaterial;

  constructor(uniforms: NightUniforms, fogFar: number) {
    this.pole.setAttribute('pmbEmit', emitAttribute(this.pole.getAttribute('position').count, Infinity));
    this.treeMaterial = patchNight(new MeshStandardMaterial({ color: '#16241a', roughness: 1, envMapIntensity: 0 }), uniforms, { snow: 0.05 });
    this.treeMaterial.name = 'nuit_arbre';
    this.lampMaterial = patchNight(new MeshStandardMaterial({ color: '#4a4d52', roughness: 0.5, metalness: 0.6, envMapIntensity: 0 }), uniforms, { emit: true, sky: { gain: 0.35, metal: 1 }, snow: 0.7 });
    this.lampMaterial.name = 'nuit_lampadaire';
    this.baliseMaterial = patchNight(new MeshStandardMaterial({ color: '#d9d8d2', roughness: 0.6, envMapIntensity: 0 }), uniforms, { retro: 14 });
    this.baliseMaterial.name = 'nuit_balise';
    this.lensMaterial.name = 'nuit_feu';
    this.haloMaterial = new ShaderMaterial({
      vertexShader: HALO_VERTEX,
      fragmentShader: HALO_FRAGMENT,
      uniforms: {
        pmbLampColor: uniforms.pmbLampColor,
        uSize: { value: 3.2 },
        uGain: { value: 1.3 },
        uFogFar: { value: fogFar },
        uPrevViewProj: { value: new Matrix4() },
        uTrail: { value: 0 },
        uAspect: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
    });
    this.haloMaterial.name = 'nuit_halo';
    // Relief lointain : une silhouette à peine bleutée, hors de la brume (elle mangerait la ligne de
    // crête), qui s'éclaircit au loin vers la couleur de l'horizon (les crêtes se détachent l'une de
    // l'autre). Sa profondeur est repoussée au fond (au-delà d'environ 2 km de tout le reste) : grossier,
    // il dépasse par endroits la chaussée des tronçons (rampe du départ), et ne doit jamais la cacher.
    // Dans sa tranche du tampon de profondeur, la profondeur suit le logarithme de la distance : avec
    // la profondeur ordinaire, toutes ses crêtes y tombaient sur la même valeur et se battaient
    // (crêtes lointaines qui clignotent en roulant).
    this.farMaterial = new MeshStandardMaterial({ color: '#0a0f1e', roughness: 1, envMapIntensity: 0 });
    this.farMaterial.fog = false;
    this.farMaterial.name = 'nuit_lointain';
    const haze = new Color(SKY.horizon).multiplyScalar(0.55);
    this.farMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uHaze = { value: haze };
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        gl_Position.z = ( 0.99985 + 0.00014 * clamp( log2( max( gl_Position.w, 150.0 ) / 150.0 ) / 7.4, 0.0, 1.0 ) ) * gl_Position.w;`,
      );
      shader.fragmentShader = `uniform vec3 uHaze;\n${shader.fragmentShader}`.replace(
        '#include <opaque_fragment>',
        `outgoingLight = mix( outgoingLight, uHaze, smoothstep( 1200.0, 11000.0, length( vViewPosition ) ) * 0.8 );
        #include <opaque_fragment>`,
      );
    };
    this.farMaterial.customProgramCacheKey = () => 'pmb-nuit-lointain';
  }

  dispose(): void {
    for (const g of [this.tree, this.lamp, this.balise, ...this.panneaux, this.palm, this.feu, this.lens, this.halo, this.pole]) g.dispose();
    for (const m of [this.treeMaterial, this.lampMaterial, this.baliseMaterial, this.lensMaterial, this.haloMaterial, this.farMaterial]) m.dispose();
  }
}

interface LoadedChunk {
  index: number;
  group: Group;
  /** Têtes des lampadaires du tronçon, dans le repère de la carte. */
  lamps: Float32Array;
  geometries: BufferGeometry[];
  instanced: InstancedMesh[];
  /** Géométries d'instances propres au tronçon (enseignes). */
  owned: BufferGeometry[];
  /** Enseignes : position et teinte (6 nombres chacune), dans le repère de la carte. */
  neons: Float32Array;
  /** Petits objets (instances, bord de route) : masqués quand le tronçon est loin dans la brume. */
  details: Object3D[];
}

const work = { m: new Matrix4(), q: new Quaternion(), p: new Vector3(), s: new Vector3(), y: new Vector3(0, 1, 0) };

/** Pose des instances d'une nature dans un maillage instancié (une instance sur `every`). */
function instanced(data: readonly number[], every: number, geometry: BufferGeometry, material: Material, headOnly = false): InstancedMesh | null {
  const total = data.length / MAP_INSTANCE_STRIDE;
  const n = Math.ceil(total / every);
  if (n <= 0) return null;
  const mesh = new InstancedMesh(geometry, material, n);
  let k = 0;
  for (let i = 0; i < total; i += every) {
    const o = i * MAP_INSTANCE_STRIDE;
    const scale = data[o + 3] ?? 1;
    const cap = data[o + 4] ?? 0;
    work.q.setFromAxisAngle(work.y, cap);
    work.p.set(data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0);
    if (headOnly) {
      // Halo : à la tête du lampadaire, au bout de sa crosse.
      work.p.x += Math.sin(cap) * LAMP_HEAD.reach * scale;
      work.p.z += Math.cos(cap) * LAMP_HEAD.reach * scale;
      work.p.y += (LAMP_HEAD.height - 0.15) * scale;
    }
    work.s.set(scale, scale, scale);
    work.m.compose(work.p, work.q, work.s);
    mesh.setMatrixAt(k, work.m);
    k += 1;
  }
  mesh.count = k;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

export interface DecorStatus {
  /** Tronçons chargés. */
  loaded: number;
  /** La fenêtre voulue est entièrement chargée. */
  complete: boolean;
  /** Un chargement a échoué alors qu'aucun tronçon n'était là (hors ligne à la première sortie). */
  failed: boolean;
}

export class Decor {
  readonly root = new Group();
  /** Têtes de lampadaires de tous les tronçons chargés (3 nombres chacune). */
  lamps = new Float32Array(0);
  lampCount = 0;
  /** Enseignes des tronçons chargés : positions (3 nombres) et teintes (3 nombres), et leur nombre. */
  neonPositions = new Float32Array(0);
  neonColors = new Float32Array(0);
  neonCount = 0;
  readonly status: DecorStatus = { loaded: 0, complete: false, failed: false };
  /** Sol et bâti des tronçons chargés, pour la garde des caméras. */
  readonly relief = new Relief();
  /** Enseignes : leur matière et le rail (posés par le moteur ; sans eux, pas d'enseigne). */
  signs: { material: ShaderMaterial; rail: Rail } | null = null;
  private readonly loader = new GLTFLoader();
  private readonly loaded = new Map<number, LoadedChunk>();
  private readonly pending = new Set<number>();
  private readonly wanted: number[] = [];
  private lastAt = -2;
  private disposed = false;
  private retryAt = 0;
  private nextCheck = 0;
  private readonly wantedInfo = { route: 0 };
  private readonly nearOnly = new Set<number>();
  /** Tunnels de la route (météo locale, lampes de voûte). */
  readonly spans: Span[];

  private readonly base: string;
  private readonly route: MapRoute;
  private readonly roles: ReadonlyMap<string, Material>;
  private readonly kit: DecorKit;
  private readonly profile: DriveProfile;

  constructor(base: string, route: MapRoute, roles: ReadonlyMap<string, Material>, kit: DecorKit, profile: DriveProfile) {
    this.base = base;
    this.route = route;
    this.roles = roles;
    this.kit = kit;
    this.profile = profile;
    this.spans = tunnelSpans(route.sections);
    this.root.name = 'sortie_decor';
  }

  /** Relief lointain, une fois pour toute la sortie. */
  async loadFar(): Promise<void> {
    const far = this.route.far;
    if (!far) return;
    const gltf = await this.loader.loadAsync(this.base + far.file);
    if (this.disposed) return;
    gltf.scene.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      (o.material as Material).dispose();
      o.material = this.kit.farMaterial;
    });
    gltf.scene.name = 'sortie_lointain';
    gltf.scene.userData.farGeometries = true;
    this.root.add(gltf.scene);
  }

  /**
   * Fenêtre de tronçons autour de l'abscisse `s` (caméra en `cx`, `cz`) : charge ce qui manque, libère
   * le reste. La fenêtre va jusqu'où la brume a tout mangé, et prend les tronçons proches de la caméra
   * (lacets) : aucun tronçon n'apparaît ni ne disparaît dans le champ.
   */
  update(s: number, now: number, cx = Number.NaN, cz = Number.NaN): void {
    const at = chunkAt(this.route.chunks, s);
    if (at === this.lastAt && now < this.nextCheck && (this.status.complete || now < this.retryAt)) return;
    this.lastAt = at;
    this.nextCheck = now + 400;
    const p = this.profile;
    const plan = chunkPlan(p);
    wantedChunks(this.route.chunks, s, p.behind, p.ahead, this.route.loop, plan.reach, cx, cz, cx === cx ? plan.near : 0, plan.cap, this.wanted, this.wantedInfo);
    // Tronçons pris par leur seule proximité (rue parallèle, lacet plus haut) : leur sol et leurs
    // bâtiments, sans leurs petits objets (budget d'appels de dessin).
    this.nearOnly.clear();
    for (let k = this.wantedInfo.route; k < this.wanted.length; k += 1) this.nearOnly.add(this.wanted[k] as number);
    const before = this.loaded.size;
    for (const [index, chunk] of this.loaded) if (!this.wanted.includes(index)) this.unload(chunk);
    let complete = true;
    for (const index of this.wanted) {
      if (this.loaded.has(index)) continue;
      complete = false;
      if (!this.pending.has(index)) void this.load(index);
    }
    this.status.complete = complete;
    this.status.loaded = this.loaded.size;
    if (this.loaded.size !== before) this.collectLamps();
    if (cx === cx) this.hideFogged(cx, cz, p.fogFar + 30, p.fogFar * 0.7);
  }

  /**
   * Tronçons chargés mais entièrement au-delà de la brume pleine : gardés (la route ne s'arrête pas
   * avant la brume) mais pas dessinés. Au-delà de `detail` mètres (il ne reste qu'environ 15 % de
   * l'image sous la brume), leurs petits objets (arbres, lampadaires et halos, que les lumières
   * lointaines relaient, enseignes, piquets) ne sont pas dessinés : budget d'appels de dessin (§ 8).
   */
  private hideFogged(cx: number, cz: number, far: number, detail: number): void {
    for (const c of this.loaded.values()) {
      const b = this.route.chunks[c.index]?.box;
      if (!b) continue;
      const dx = Math.max((b[0] ?? 0) - cx, 0, cx - (b[3] ?? 0));
      const dz = Math.max((b[2] ?? 0) - cz, 0, cz - (b[5] ?? 0));
      const d2 = dx * dx + dz * dz;
      c.group.visible = d2 < far * far;
      const near = d2 < detail * detail && !this.nearOnly.has(c.index);
      for (let i = 0; i < c.details.length; i += 1) (c.details[i] as Object3D).visible = near;
    }
  }

  private async load(index: number): Promise<void> {
    const chunk = this.route.chunks[index] as MapChunk;
    this.pending.add(index);
    try {
      const gltf = await this.loader.loadAsync(this.base + chunk.file);
      if (this.disposed) return;
      this.pending.delete(index);
      if (!this.wanted.includes(index)) {
        gltf.scene.traverse((o) => {
          if (o instanceof Mesh) {
            o.geometry.dispose();
            (o.material as Material).dispose();
          }
        });
        return;
      }
      this.add(index, chunk, gltf.scene);
      this.status.failed = false;
    } catch {
      this.pending.delete(index);
      // Hors ligne ou fichier absent : on réessaie plus tard ; sans aucun tronçon, c'est l'échec.
      if (this.loaded.size === 0) this.status.failed = true;
      this.retryAt = performance.now() + 3000;
      this.lastAt = -2;
    }
  }

  private add(index: number, chunk: MapChunk, scene: Object3D): void {
    const group = new Group();
    group.name = `troncon_${index}`;
    group.position.set(...chunk.origin);
    const geometries: BufferGeometry[] = [];
    const relief = createChunkRelief();
    const walls: Mesh[] = [];
    const [ox, oy, oz] = chunk.origin;
    const meshes: Mesh[] = [];
    scene.traverse((o) => {
      if (o instanceof Mesh) meshes.push(o);
    });
    for (const o of meshes) {
      const source = o.material as Material;
      const role = source.name || o.name.replace(/^fusion_/, '');
      const material = this.roles.get(role);
      source.dispose();
      this.prepare(o, role, chunk);
      geometries.push(o.geometry);
      const geometry = o.geometry as BufferGeometry;
      const indices = geometry.getIndex();
      addRoleMesh(relief, role, geometry.getAttribute('position').array, indices ? indices.array : null, ox + o.position.x, oy + o.position.y, oz + o.position.z);
      if (role === 'mur') walls.push(o);
      if (!material || geometry.getAttribute('position').count === 0) {
        o.visible = false;
        continue;
      }
      o.material = material;
      if (isNoMirror(role)) o.layers.set(NO_MIRROR_LAYER);
    }
    group.add(scene);
    this.relief.set(index, relief);
    const owned: BufferGeometry[] = [];
    const instancedMeshes: InstancedMesh[] = [];
    const put = (mesh: InstancedMesh | null) => {
      if (!mesh) return;
      instancedMeshes.push(mesh);
      group.add(mesh);
    };
    const { arbre, lampadaire, balise, feu, palmier } = chunk.instances;
    if (arbre) put(instanced(arbre, this.profile.treeEvery, this.kit.tree, this.kit.treeMaterial));
    if (palmier) put(instanced(palmier, this.profile.treeEvery, this.kit.palm, this.kit.treeMaterial));
    let feuxLights: number[] = [];
    if (feu) {
      put(instanced(feu, 1, this.kit.feu, this.kit.lampMaterial));
      const lenses = feuLenses(feu, chunk.origin, this.kit.lens, this.kit.lensMaterial);
      put(lenses.mesh);
      feuxLights = lenses.lights;
    }
    if (lampadaire) {
      put(instanced(lampadaire, 1, this.kit.lamp, this.kit.lampMaterial));
      const halo = instanced(lampadaire, 1, this.kit.halo, this.kit.haloMaterial, true);
      if (halo) {
        // Les halos ne bloquent rien et passent après l'opaque ; ils se reflètent sur la chaussée.
        halo.renderOrder = 5;
        put(halo);
      }
    }
    if (balise) put(instanced(balise, 1, this.kit.balise, this.kit.baliseMaterial));
    // Piquets tous les 50 m et panneaux sans texte de loin en loin (ronds et triangles, un côté puis
    // l'autre) : fondus en un seul maillage par tronçon, un seul appel de dessin.
    const roadside = this.roadside(chunk);
    const details: Object3D[] = [];
    if (roadside) {
      owned.push(roadside.geometry);
      group.add(roadside);
      details.push(roadside);
    }
    const placed = this.signs ? this.placeSigns(chunk, group, walls) : null;
    if (placed?.signs) {
      owned.push(placed.signs.geometry);
      put(placed.signs);
    }
    if (placed && placed.poles.length > 0) {
      const poles = new InstancedMesh(this.kit.pole, this.kit.lampMaterial, placed.poles.length);
      placed.poles.forEach((m, i) => poles.setMatrixAt(i, m));
      poles.instanceMatrix.needsUpdate = true;
      poles.computeBoundingSphere();
      poles.layers.set(NO_MIRROR_LAYER);
      put(poles);
    }
    const vault = tunnelLamps(this.spans, chunk.from, chunk.to, this.route.rail, this.route.step);
    const lamps = new Float32Array(((lampadaire?.length ?? 0) / MAP_INSTANCE_STRIDE) * 3 + vault.length);
    lamps.set(vault, lamps.length - vault.length);
    for (let i = 0; i * MAP_INSTANCE_STRIDE < (lampadaire?.length ?? 0); i += 1) {
      const o = i * MAP_INSTANCE_STRIDE;
      const l = lampadaire as number[];
      const scale = l[o + 3] ?? 1;
      const cap = l[o + 4] ?? 0;
      lamps[i * 3] = chunk.origin[0] + (l[o] ?? 0) + Math.sin(cap) * LAMP_HEAD.reach * scale;
      lamps[i * 3 + 1] = chunk.origin[1] + (l[o + 1] ?? 0) + LAMP_HEAD.height * scale;
      lamps[i * 3 + 2] = chunk.origin[2] + (l[o + 2] ?? 0) + Math.cos(cap) * LAMP_HEAD.reach * scale;
    }
    this.root.add(group);
    details.push(...instancedMeshes);
    this.loaded.set(index, { index, group, lamps, geometries, instanced: instancedMeshes, owned, neons: new Float32Array([...(placed?.lights ?? []), ...feuxLights]), details });
    this.status.loaded = this.loaded.size;
    this.status.complete = this.wanted.every((i) => this.loaded.has(i));
    this.collectLamps();
  }

  /**
   * Piquets de bord de route (hors agglomération, hors ouvrages) : un tous les 50 m de chaque côté,
   * à 1 m du bord de la chaussée, d'après le rail et la largeur des sections ; leur catadioptre
   * s'allume dans les phares à cadence régulière (l'impression de vitesse en vient beaucoup).
   */
  private roadsidePosts(chunk: MapChunk, every: number, margin: number, shift: number, out: number[]): void {
    const { rail, step, sections } = this.route;
    const count = Math.floor(rail.length / 3);
    const single = every > 100;
    for (let s = Math.ceil((chunk.from - shift) / every) * every + shift; s < chunk.to; s += every) {
      if (s < chunk.from) continue;
      const sec = sections.find((x) => s >= x.from && s < x.to);
      if (!sec || sec.urban || sec.ground !== 'sol') continue;
      const i = Math.max(0, Math.min(count - 2, Math.round(s / step)));
      const x = rail[i * 3] ?? 0;
      const y = rail[i * 3 + 1] ?? 0;
      const z = rail[i * 3 + 2] ?? 0;
      const tx = (rail[(i + 1) * 3] ?? 0) - x;
      const tz = (rail[(i + 1) * 3 + 2] ?? 0) - z;
      const tl = Math.hypot(tx, tz) || 1;
      const off = sec.width / 2 + margin;
      for (const side of single ? [Math.round(s / every) % 2 === 0 ? -1 : 1] : [1, -1]) {
        // Gauche de la marche : (tz, −tx) ; la face des panneaux regarde ceux qui arrivent.
        out.push(x + (side * off * tz) / tl - chunk.origin[0], y - chunk.origin[1], z - (side * off * tx) / tl - chunk.origin[2], 1, Math.atan2(-tx, -tz));
      }
    }
  }

  /**
   * Bord de route hors agglomération et hors ouvrages, d'après le rail et la largeur des sections :
   * piquets tous les 50 m de chaque côté à 1 m du bord (leur catadioptre s'allume dans les phares à
   * cadence régulière : l'impression de vitesse en vient beaucoup), panneaux sans texte de loin en
   * loin. Un seul maillage par tronçon.
   */
  private roadside(chunk: MapChunk): Mesh | null {
    const parts: BufferGeometry[] = [];
    const kinds: Array<[number, number, number, BufferGeometry]> = [
      [50, 1, 0, this.kit.balise],
      [420, 1.6, 0, this.kit.panneaux[0]],
      [610, 1.6, 230, this.kit.panneaux[1]],
    ];
    for (const [every, margin, shift, base] of kinds) {
      const data: number[] = [];
      this.roadsidePosts(chunk, every, margin, shift, data);
      for (let o = 0; o + 4 < data.length; o += MAP_INSTANCE_STRIDE) {
        work.q.setFromAxisAngle(work.y, data[o + 4] ?? 0);
        work.p.set(data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0);
        work.s.set(1, 1, 1);
        const g = base.index ? base.toNonIndexed() : base.clone();
        for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
        g.applyMatrix4(work.m.compose(work.p, work.q, work.s));
        parts.push(g);
      }
    }
    if (parts.length === 0) return null;
    const merged = mergeGeometries(parts) as BufferGeometry | null;
    for (const g of parts) g.dispose();
    if (!merged) return null;
    merged.computeBoundingSphere();
    const mesh = new Mesh(merged, this.kit.baliseMaterial);
    mesh.name = 'bord_de_route';
    return mesh;
  }

  /**
   * Attributs posés au chargement : chaussée et accotements (abscisse, écart à l'axe, part au sec,
   * demi-largeur), murs (pied, sommet et graine du bâtiment : façades dessinées), fenêtres (seules
   * restent les réglettes des tunnels ; les baies des façades sont dessinées par la matière des murs).
   */
  private prepare(o: Mesh, role: string, chunk: MapChunk): void {
    const g = o.geometry as BufferGeometry;
    const origin = [chunk.origin[0] + o.position.x, chunk.origin[1] + o.position.y, chunk.origin[2] + o.position.z];
    if (role === 'chaussee' || role === 'voie' || role === 'accotement' || role === 'ouvrage') {
      const attr = roadAttribute(g.getAttribute('position').array, origin, this.route.rail, this.route.step, chunk.from, chunk.to, this.route.sections, this.spans);
      g.setAttribute('pmbRoad', new BufferAttribute(attr, 4));
    } else if (role === 'mur') {
      const flat = g.index ? g.toNonIndexed() : g;
      if (flat !== g) {
        g.dispose();
        o.geometry = flat;
      }
      flat.setAttribute('pmbFacade', new BufferAttribute(facadeAttribute(flat.getAttribute('position').array, origin), 3));
    } else if (role === 'fenetre') {
      const flat = g.index ? g.toNonIndexed() : g;
      const pos = flat.getAttribute('position');
      const keep: number[] = [];
      const a = new Vector3();
      const b = new Vector3();
      const c = new Vector3();
      for (let t = 0; t + 2 < pos.count; t += 3) {
        a.fromBufferAttribute(pos, t);
        b.fromBufferAttribute(pos, t + 1);
        c.fromBufferAttribute(pos, t + 2);
        const n = b.sub(a).cross(c.sub(a));
        if (Math.abs(n.y) > 0.5 * n.length()) for (let k = 0; k < 3; k += 1) keep.push(pos.getX(t + k), pos.getY(t + k), pos.getZ(t + k));
      }
      const out = new Geometry();
      out.setAttribute('position', new BufferAttribute(new Float32Array(keep), 3));
      out.computeVertexNormals();
      if (flat !== g) flat.dispose();
      g.dispose();
      o.geometry = out;
    }
  }

  /**
   * Enseignes d'un tronçon. Commerces connus (OpenStreetMap) : une enseigne par commerce, du côté où
   * il est, au mot de sa nature, et des enseignes d’ambiance (un point tous les 36 m). Sinon, au
   * jugé : sur les façades des sections en agglomération, un point tous les 18 m.
   */
  private placeSigns(chunk: MapChunk, group: Group, walls: Mesh[]): PlacedSigns | null {
    const signs = this.signs;
    if (!signs) return null;
    const spots: SignSpot[] = [];
    const known = Array.isArray(chunk.shops);
    const shops = chunk.shops ?? [];
    for (let k = 0; k + MAP_SHOP_STRIDE <= shops.length; k += MAP_SHOP_STRIDE) {
      const s = shops[k] ?? 0;
      const kind = MAP_SHOP_KINDS[shops[k + 4] ?? -1];
      if (!kind) continue;
      const pose = signs.rail.poseAt(s, createPose());
      const tangent = new Vector3(pose.tangent[0], 0, pose.tangent[2]).normalize();
      const dx = chunk.origin[0] + (shops[k + 1] ?? 0) - pose.position[0];
      const dz = chunk.origin[2] + (shops[k + 3] ?? 0) - pose.position[2];
      // Gauche de la marche : (tz, 0, −tx).
      const side = dx * tangent.z - dz * tangent.x >= 0 ? 1 : -1;
      spots.push({ s, point: new Vector3(...pose.position), tangent, width: pose.width, cell: shopSignCell(kind), side, always: true });
    }
    const every = known ? 36 : 18;
    for (const section of this.route.sections) {
      if (!section.urban || section.ground !== 'sol') continue;
      const from = Math.max(section.from, chunk.from) + 8;
      const to = Math.min(section.to, chunk.to) - 4;
      for (let s = Math.ceil(from / every) * every; s <= to; s += every) {
        const pose = signs.rail.poseAt(s, createPose());
        const tangent = new Vector3(pose.tangent[0], 0, pose.tangent[2]).normalize();
        const cell = known ? DECOR_SIGN_CELLS[Math.floor(Math.abs(Math.sin(s * 12.9898) * 43758.5453)) % DECOR_SIGN_CELLS.length] : undefined;
        spots.push({ s, point: new Vector3(...pose.position), tangent, width: section.width, ...(cell === undefined ? {} : { cell }) });
      }
    }
    if (spots.length === 0) return null;
    group.updateMatrixWorld(true);
    return placeSigns(walls, spots, group.position, signs.material);
  }

  private unload(chunk: LoadedChunk): void {
    this.root.remove(chunk.group);
    for (const g of chunk.geometries) g.dispose();
    for (const g of chunk.owned) g.dispose();
    for (const m of chunk.instanced) m.dispose();
    this.loaded.delete(chunk.index);
    this.relief.delete(chunk.index);
    this.collectLamps();
  }

  private collectNeons(): void {
    let n = 0;
    for (const c of this.loaded.values()) n += c.neons.length / 6;
    this.neonPositions = new Float32Array(n * 3);
    this.neonColors = new Float32Array(n * 3);
    let k = 0;
    for (const c of this.loaded.values()) {
      for (let i = 0; i < c.neons.length; i += 6) {
        this.neonPositions.set(c.neons.subarray(i, i + 3), k * 3);
        this.neonColors.set(c.neons.subarray(i + 3, i + 6), k * 3);
        k += 1;
      }
    }
    this.neonCount = n;
  }

  private collectLamps(): void {
    this.collectNeons();
    let n = 0;
    for (const c of this.loaded.values()) n += c.lamps.length;
    const all = new Float32Array(n);
    let k = 0;
    for (const c of this.loaded.values()) {
      all.set(c.lamps, k);
      k += c.lamps.length;
    }
    this.lamps = all;
    this.lampCount = n / 3;
  }

  /** Triangles déclarés par la carte pour les tronçons chargés (hors instances). */
  chunkTriangles(): number {
    let t = 0;
    for (const c of this.loaded.values()) t += this.route.chunks[c.index]?.triangles ?? 0;
    return t;
  }

  dispose(): void {
    this.disposed = true;
    for (const chunk of [...this.loaded.values()]) this.unload(chunk);
    this.root.traverse((o) => {
      if (o instanceof Mesh && o.material === this.kit.farMaterial) o.geometry.dispose();
    });
    this.root.clear();
  }
}
