// Décor de la sortie de nuit : les tronçons de la carte autour du véhicule (chargés au fil de la
// route, libérés derrière lui), habillés par rôle (src/drive/scene/materiaux.ts), leurs instances
// (arbres en silhouettes, lampadaires et leur halo, balises, enseignes au néon en agglomération), le
// relief des tronçons chargés pour la garde des caméras (src/drive/scene/relief.ts), et le relief
// lointain en silhouette sur le ciel. Aucune carte n'est connue ici : tout vient du manifeste et de
// route.json.

import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
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
import { MAP_INSTANCE_STRIDE, type MapChunk, type MapRoute } from '../../data/mapTypes.ts';
import { NO_MIRROR_LAYER } from '../../render/layers.ts';
import { createPose } from '../rail.ts';
import { SKY } from './ciel.ts';
import { placeSigns, type PlacedSigns, type SignSpot } from './enseignes.ts';
import { emitAttribute, isNoMirror, patchNight, type NightUniforms } from './materiaux.ts';
import { chunkAt, chunkWindow, type DriveProfile } from './profil.ts';
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
  readonly halo = new PlaneGeometry(1, 1);
  /** Mât d'une enseigne sur pied : boîte unité, à l'échelle dans sa matrice. */
  readonly pole = new BoxGeometry(1, 1, 1, 1, 1, 1);

  readonly treeMaterial: MeshStandardMaterial;
  readonly lampMaterial: MeshStandardMaterial;
  readonly baliseMaterial: MeshStandardMaterial;
  readonly haloMaterial: ShaderMaterial;
  readonly farMaterial: MeshStandardMaterial;

  constructor(uniforms: NightUniforms, fogFar: number) {
    this.pole.setAttribute('pmbEmit', emitAttribute(this.pole.getAttribute('position').count, Infinity));
    this.treeMaterial = patchNight(new MeshStandardMaterial({ color: '#16241a', roughness: 1, envMapIntensity: 0.05 }), uniforms, {});
    this.treeMaterial.name = 'nuit_arbre';
    this.lampMaterial = patchNight(new MeshStandardMaterial({ color: '#4a4d52', roughness: 0.5, metalness: 0.6, envMapIntensity: 0.5 }), uniforms, { emit: true });
    this.lampMaterial.name = 'nuit_lampadaire';
    this.baliseMaterial = patchNight(new MeshStandardMaterial({ color: '#d9d8d2', roughness: 0.6, envMapIntensity: 0.3 }), uniforms, { retro: 14 });
    this.baliseMaterial.name = 'nuit_balise';
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
    this.farMaterial = new MeshStandardMaterial({ color: '#0a0f1e', roughness: 1, envMapIntensity: 0 });
    this.farMaterial.fog = false;
    this.farMaterial.name = 'nuit_lointain';
    const haze = new Color(SKY.horizon).multiplyScalar(0.55);
    this.farMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uHaze = { value: haze };
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        gl_Position.z = ( 0.99985 + 0.00014 * ( clamp( gl_Position.z / gl_Position.w, -1.0, 1.0 ) * 0.5 + 0.5 ) ) * gl_Position.w;`,
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
    for (const g of [this.tree, this.lamp, this.balise, this.halo, this.pole]) g.dispose();
    for (const m of [this.treeMaterial, this.lampMaterial, this.baliseMaterial, this.haloMaterial, this.farMaterial]) m.dispose();
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

  /** Fenêtre de tronçons autour de l'abscisse `s` : charge ce qui manque, libère le reste. */
  update(s: number, now: number): void {
    const at = chunkAt(this.route.chunks, s);
    if (at === this.lastAt && (this.status.complete || now < this.retryAt)) return;
    this.lastAt = at;
    chunkWindow(this.route.chunks, s, this.profile.behind, this.profile.ahead, this.route.loop, this.wanted);
    for (const [index, chunk] of this.loaded) if (!this.wanted.includes(index)) this.unload(chunk);
    let complete = true;
    for (const index of this.wanted) {
      if (this.loaded.has(index)) continue;
      complete = false;
      if (!this.pending.has(index)) void this.load(index);
    }
    this.status.complete = complete;
    this.status.loaded = this.loaded.size;
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
    scene.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const source = o.material as Material;
      const role = source.name || o.name.replace(/^fusion_/, '');
      const material = this.roles.get(role);
      geometries.push(o.geometry);
      source.dispose();
      const geometry = o.geometry as BufferGeometry;
      const indices = geometry.getIndex();
      addRoleMesh(relief, role, geometry.getAttribute('position').array, indices ? indices.array : null, ox + o.position.x, oy + o.position.y, oz + o.position.z);
      if (role === 'mur') walls.push(o);
      if (!material) {
        o.visible = false;
        return;
      }
      o.material = material;
      if (isNoMirror(role)) o.layers.set(NO_MIRROR_LAYER);
    });
    group.add(scene);
    this.relief.set(index, relief);
    const owned: BufferGeometry[] = [];
    const instancedMeshes: InstancedMesh[] = [];
    const put = (mesh: InstancedMesh | null) => {
      if (!mesh) return;
      instancedMeshes.push(mesh);
      group.add(mesh);
    };
    const { arbre, lampadaire, balise } = chunk.instances;
    if (arbre) put(instanced(arbre, this.profile.treeEvery, this.kit.tree, this.kit.treeMaterial));
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
    const lamps = new Float32Array(((lampadaire?.length ?? 0) / MAP_INSTANCE_STRIDE) * 3);
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
    this.loaded.set(index, { index, group, lamps, geometries, instanced: instancedMeshes, owned, neons: new Float32Array(placed?.lights ?? []) });
    this.status.loaded = this.loaded.size;
    this.status.complete = this.wanted.every((i) => this.loaded.has(i));
    this.collectLamps();
  }

  /** Enseignes d'un tronçon : sur les façades des sections en agglomération, un point tous les 18 m. */
  private placeSigns(chunk: MapChunk, group: Group, walls: Mesh[]): PlacedSigns | null {
    const signs = this.signs;
    if (!signs) return null;
    const spots: SignSpot[] = [];
    for (const section of this.route.sections) {
      if (!section.urban || section.ground !== 'sol') continue;
      const from = Math.max(section.from, chunk.from) + 8;
      const to = Math.min(section.to, chunk.to) - 4;
      for (let s = Math.ceil(from / 18) * 18; s <= to; s += 18) {
        const pose = signs.rail.poseAt(s, createPose());
        const tangent = new Vector3(pose.tangent[0], 0, pose.tangent[2]).normalize();
        spots.push({ s, point: new Vector3(...pose.position), tangent, width: section.width });
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
