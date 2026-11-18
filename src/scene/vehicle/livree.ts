// Livrée du véhicule (§ 5.3, § 8 « Livrée ») : les stickers du build, peints dans la peinture même.
//
// Les calques de toutes les zones de livrée sont composés dans une seule texture (un atlas, une
// cellule par zone, 256 px par mètre, 1 024 px au plus par côté de cellule, rangées par étagères).
// Le matériau de peinture d'une zone (src/render/paint.ts) reçoit, par-dessus son propre shader, la projection des cadres qui
// le touchent : la couleur du sticker remplace celle de la base avant l'éclairage, si bien qu'il prend
// le vernis, les paillettes et les reflets de la carrosserie. Il ne se pose que sur les matériaux de
// peinture nommés par la zone : ni vitre, ni roue, ni chrome.
//
// Sans sticker, rien n'est créé (ni texture ni variante de shader) : aucun coût. La texture vit tant
// que le véhicule préparé vit (disposeLivery, appelé par disposePrepared).

import {
  CanvasTexture,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  SRGBColorSpace,
  Vector3,
  Vector4,
  type MeshPhysicalMaterial,
  type Object3D,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { stickerById } from '../../data/stickers.ts';
import { stickerUrl } from '../../data/stickersFichiers.ts';
import { projectionMatrix, zoneFrame, zoneLayers, type BuildStickers, type LiveryZone, type StickerLayer } from '../../data/stickersCalques.ts';
import type { VehicleManifest } from '../../data/vehicleTypes.ts';

/** Densité de la livrée sur la caisse, en pixels par mètre, et plafond d'une cellule. */
export const LIVERY_PX_PER_METER = 256;
export const LIVERY_CELL_MAX = 1024;
const PAD = 4;

export interface LiveryCell {
  zone: LiveryZone;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Disposition de l'atlas : cellules rangées par étagères (côte à côte tant qu'elles tiennent dans la
 * largeur d'une cellule pleine, puis à la ligne), séparées d'une marge transparente.
 */
export function liveryLayout(zones: readonly LiveryZone[]): { width: number; height: number; cells: LiveryCell[] } {
  const limit = LIVERY_CELL_MAX + PAD * 2;
  const cells: LiveryCell[] = [];
  let x = 0;
  let y = 0;
  let shelf = 0;
  let width = 0;
  for (const zone of zones) {
    const scale = Math.min(LIVERY_PX_PER_METER, LIVERY_CELL_MAX / Math.max(zone.size[0], zone.size[1]));
    const cellWidth = Math.max(8, Math.round(zone.size[0] * scale));
    const cellHeight = Math.max(8, Math.round(zone.size[1] * scale));
    if (x > 0 && x + cellWidth + PAD * 2 > limit) {
      y += shelf;
      x = 0;
      shelf = 0;
    }
    cells.push({ zone, x: x + PAD, y: y + PAD, width: cellWidth, height: cellHeight });
    x += cellWidth + PAD * 2;
    shelf = Math.max(shelf, cellHeight + PAD * 2);
    width = Math.max(width, x);
  }
  return { width: Math.max(1, width), height: Math.max(1, y + shelf), cells };
}

interface MaterialRig {
  material: MeshPhysicalMaterial;
  /** Indices des zones de livrée qui touchent ce matériau. */
  zones: number[];
  /** Repère du maillage → repère du véhicule (constant : la caisse est rigide). */
  meshToVehicle: Matrix4;
  original: { onBeforeCompile: MeshPhysicalMaterial['onBeforeCompile']; cacheKey: MeshPhysicalMaterial['customProgramCacheKey'] };
  patched: boolean;
}

export interface LiveryRig {
  zones: readonly LiveryZone[];
  materials: MaterialRig[];
  /** Matériaux écartés : leurs maillages ne partagent pas un même repère (la livrée y glisserait). */
  skipped: string[];
  canvas: HTMLCanvasElement | null;
  texture: CanvasTexture | null;
  signature: string;
  generation: number;
  /** Appelé quand la texture a changé (rendu à la demande du garage). */
  onReady: (() => void) | null;
  disposed: boolean;
}

const FRAGMENT_PARS = /* glsl */ `
uniform mat4 pmbLivProj[ PMB_LIV_N ];
uniform vec4 pmbLivRect[ PMB_LIV_N ];
uniform vec3 pmbLivFace[ PMB_LIV_N ];
uniform sampler2D pmbLivMap;
varying vec3 vPmbLivPos;
varying vec3 vPmbLivNrm;
float pmbLivA = 0.0;
`;

// Après la couleur de base : le sticker la recouvre (alpha prémultiplié), avant tout éclairage.
// Pas de branchement : chaque cadre est lu, puis masqué (dérivées sûres pour les mipmaps).
const FRAGMENT_COLOR = /* glsl */ `
{
  vec3 pmbN = normalize( vPmbLivNrm );
  vec4 pmbAcc = vec4( 0.0 );
  for ( int i = 0; i < PMB_LIV_N; i ++ ) {
    vec3 q = ( pmbLivProj[ i ] * vec4( vPmbLivPos, 1.0 ) ).xyz;
    vec3 inside = step( vec3( 0.0 ), q ) * step( q, vec3( 1.0 ) );
    float m = inside.x * inside.y * inside.z * smoothstep( 0.2, 0.5, dot( pmbN, pmbLivFace[ i ] ) );
    vec4 s = texture( pmbLivMap, pmbLivRect[ i ].xy + clamp( q.xy, 0.0, 1.0 ) * pmbLivRect[ i ].zw ) * m;
    pmbAcc = s + pmbAcc * ( 1.0 - s.a );
  }
  diffuseColor.rgb = diffuseColor.rgb * ( 1.0 - pmbAcc.a ) + pmbAcc.rgb;
  pmbLivA = pmbAcc.a;
}
`;

// Le vinyle n'est pas du métal : sous le vernis, il garde sa couleur à tous les angles.
const FRAGMENT_ROUGHNESS = /* glsl */ `
roughnessFactor = mix( roughnessFactor, 0.35, pmbLivA );
`;
const FRAGMENT_METALNESS = /* glsl */ `
metalnessFactor = mix( metalnessFactor, 0.0, pmbLivA );
`;

const VERTEX_PARS = /* glsl */ `
uniform mat4 pmbLivMesh;
varying vec3 vPmbLivPos;
varying vec3 vPmbLivNrm;
`;
const VERTEX_MAIN = /* glsl */ `
vPmbLivPos = ( pmbLivMesh * vec4( transformed, 1.0 ) ).xyz;
vPmbLivNrm = mat3( pmbLivMesh ) * objectNormal;
`;

function insertAfter(source: string, anchor: string, code: string): string {
  if (!source.includes(anchor)) throw new Error(`Livrée : repère de shader introuvable (${anchor})`);
  return source.replace(anchor, `${anchor}\n${code}`);
}

/** Complète les shaders de la peinture pour `count` cadres. Exporté pour vérifier les repères (tests). */
export function patchLiveryShader(shader: Pick<WebGLProgramParametersWithUniforms, 'vertexShader' | 'fragmentShader'>, count: number): void {
  let vertex = insertAfter(shader.vertexShader, '#include <common>', VERTEX_PARS);
  vertex = insertAfter(vertex, '#include <project_vertex>', VERTEX_MAIN);
  let fragment = insertAfter(shader.fragmentShader, '#include <common>', `#define PMB_LIV_N ${count}\n${FRAGMENT_PARS}`);
  fragment = insertAfter(fragment, '#include <color_fragment>', FRAGMENT_COLOR);
  fragment = insertAfter(fragment, '#include <roughnessmap_fragment>', FRAGMENT_ROUGHNESS);
  fragment = insertAfter(fragment, '#include <metalnessmap_fragment>', FRAGMENT_METALNESS);
  shader.vertexShader = vertex;
  shader.fragmentShader = fragment;
}

/**
 * Prépare la livrée d'un véhicule préparé : quels cadres touchent quel matériau de peinture, et le
 * repère de ses maillages. `body` : la caisse (repère du véhicule). Rien n'est dessiné ici.
 */
export function createLiveryRig(vehicle: VehicleManifest, body: Object3D, zoneMaterials: ReadonlyMap<string, MeshPhysicalMaterial>): LiveryRig | null {
  const zones = vehicle.livery ?? [];
  if (zones.length === 0) return null;
  body.updateMatrixWorld(true);
  const toVehicle = new Matrix4().copy(body.matrixWorld).invert();
  const materials: MaterialRig[] = [];
  const skipped: string[] = [];
  for (const [paintZone, material] of zoneMaterials) {
    const touching = zones.flatMap((zone, index) => (zone.paints.includes(paintZone) ? [index] : []));
    if (touching.length === 0) continue;
    const matrices: Matrix4[] = [];
    body.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const list = Array.isArray(object.material) ? object.material : [object.material];
      if (list.includes(material)) matrices.push(new Matrix4().multiplyMatrices(toVehicle, object.matrixWorld));
    });
    const first = matrices[0];
    if (!first || matrices.some((matrix) => !matrix.equals(first) && matrix.elements.some((value, i) => Math.abs(value - first.elements[i]!) > 1e-5))) {
      if (first) skipped.push(paintZone);
      continue;
    }
    materials.push({
      material,
      zones: touching,
      meshToVehicle: first,
      original: { onBeforeCompile: material.onBeforeCompile, cacheKey: material.customProgramCacheKey },
      patched: false,
    });
  }
  return { zones, materials, skipped, canvas: null, texture: null, signature: '', generation: 0, onReady: null, disposed: false };
}

function ensureTexture(rig: LiveryRig): CanvasTexture {
  if (rig.texture) return rig.texture;
  const layout = liveryLayout(rig.zones);
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  // Bords des motifs : sans prémultiplication, le filtrage les noircirait.
  texture.premultiplyAlpha = true;
  texture.anisotropy = 4;
  texture.minFilter = LinearMipmapLinearFilter;
  rig.canvas = canvas;
  rig.texture = texture;
  return texture;
}

function patchMaterial(rig: LiveryRig, entry: MaterialRig, texture: CanvasTexture): void {
  if (entry.patched) return;
  const layout = liveryLayout(rig.zones);
  const count = entry.zones.length;
  const uniforms = {
    pmbLivMesh: { value: entry.meshToVehicle },
    pmbLivProj: { value: entry.zones.map((index) => new Matrix4().fromArray(projectionMatrix(rig.zones[index]!))) },
    pmbLivRect: {
      value: entry.zones.map((index) => {
        const cell = layout.cells[index]!;
        // Texture retournée (flipY) : v = 0 en bas du canevas.
        return new Vector4(cell.x / layout.width, 1 - (cell.y + cell.height) / layout.height, cell.width / layout.width, cell.height / layout.height);
      }),
    },
    pmbLivFace: { value: entry.zones.map((index) => new Vector3(...zoneFrame(rig.zones[index]!.face).normal)) },
    pmbLivMap: { value: texture },
  };
  const { onBeforeCompile, cacheKey } = entry.original;
  entry.material.onBeforeCompile = (shader, renderer) => {
    onBeforeCompile.call(entry.material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    patchLiveryShader(shader, count);
  };
  entry.material.customProgramCacheKey = () => `${cacheKey.call(entry.material)}+livree-${count}`;
  entry.material.needsUpdate = true;
  entry.patched = true;
}

function unpatchMaterial(entry: MaterialRig): void {
  if (!entry.patched) return;
  entry.material.onBeforeCompile = entry.original.onBeforeCompile;
  entry.material.customProgramCacheKey = entry.original.cacheKey;
  entry.material.needsUpdate = true;
  entry.patched = false;
}

// Dessins des motifs, rendus une fois en blanc (seul l'alpha compte : la couleur se pose à la composition).
const MOTIF_PX = 512;
const motifs = new Map<string, Promise<HTMLCanvasElement | null>>();

function motifCanvas(id: string): Promise<HTMLCanvasElement | null> {
  let pending = motifs.get(id);
  if (!pending) {
    const url = stickerUrl(id);
    const ratio = stickerById(id)?.ratio ?? 1;
    pending = !url
      ? Promise.resolve(null)
      : new Promise<HTMLCanvasElement | null>((resolve) => {
          const image = new Image();
          image.decoding = 'async';
          image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = MOTIF_PX;
            canvas.height = Math.max(1, Math.round(MOTIF_PX / ratio));
            canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
            resolve(canvas);
          };
          image.onerror = () => resolve(null);
          image.src = url;
        });
    motifs.set(id, pending);
  }
  return pending;
}

let scratch: HTMLCanvasElement | null = null;

function drawLayer(context: CanvasRenderingContext2D, cell: LiveryCell, layer: StickerLayer, motif: HTMLCanvasElement): void {
  const ratio = stickerById(layer.motif)?.ratio ?? 1;
  const perMeter = cell.height / cell.zone.size[1];
  const height = Math.max(1, layer.size * perMeter);
  const width = Math.max(1, height * ratio);
  // Teinte : le motif blanc, recouvert de la couleur là où il est opaque.
  scratch ??= document.createElement('canvas');
  scratch.width = Math.ceil(width);
  scratch.height = Math.ceil(height);
  const tint = scratch.getContext('2d');
  if (!tint) return;
  tint.clearRect(0, 0, scratch.width, scratch.height);
  tint.globalCompositeOperation = 'source-over';
  tint.drawImage(motif, 0, 0, scratch.width, scratch.height);
  tint.globalCompositeOperation = 'source-in';
  tint.fillStyle = layer.color;
  tint.fillRect(0, 0, scratch.width, scratch.height);

  context.save();
  context.beginPath();
  context.rect(cell.x, cell.y, cell.width, cell.height);
  context.clip();
  context.translate(cell.x + layer.x * cell.width, cell.y + (1 - layer.y) * cell.height);
  // Canevas : y vers le bas, donc une rotation positive (sens inverse des aiguilles) se dessine en négatif.
  context.rotate((-layer.rotation * Math.PI) / 180);
  if (layer.flip) context.scale(-1, 1);
  context.globalAlpha = layer.opacity;
  context.drawImage(scratch, -width / 2, -height / 2, width, height);
  context.restore();
}

/** Calques effectifs de chaque cadre, et la clé qui dit si quelque chose a changé. */
export function liveryState(zones: readonly LiveryZone[], stickers: BuildStickers | undefined): { layers: StickerLayer[][]; signature: string } {
  const layers = zones.map((zone) => zoneLayers(zones, stickers, zone.id));
  return { layers, signature: layers.some((list) => list.length > 0) ? JSON.stringify(layers) : '' };
}

/**
 * Pose les stickers du build : compose l'atlas (après le chargement des dessins), branche la
 * projection sur les matériaux touchés, la débranche quand il n'y a plus rien.
 */
export function applyLivery(rig: LiveryRig, stickers: BuildStickers | undefined, onReady?: () => void): void {
  if (onReady) rig.onReady = onReady;
  const { layers, signature } = liveryState(rig.zones, stickers);
  if (signature === rig.signature) return;
  rig.signature = signature;
  const generation = ++rig.generation;
  if (signature === '') {
    for (const entry of rig.materials) unpatchMaterial(entry);
    rig.texture?.dispose();
    rig.texture = null;
    rig.canvas = null;
    rig.onReady?.();
    return;
  }
  const texture = ensureTexture(rig);
  const used = new Set(layers.flat().map((layer) => layer.motif));
  void Promise.all([...used].map(async (id) => [id, await motifCanvas(id)] as const)).then((loaded) => {
    if (rig.disposed || generation !== rig.generation || !rig.canvas) return;
    const images = new Map(loaded);
    const context = rig.canvas.getContext('2d');
    if (!context) return;
    const layout = liveryLayout(rig.zones);
    context.clearRect(0, 0, rig.canvas.width, rig.canvas.height);
    layout.cells.forEach((cell, index) => {
      for (const layer of layers[index] ?? []) {
        const image = images.get(layer.motif);
        if (image) drawLayer(context, cell, layer, image);
      }
    });
    texture.needsUpdate = true;
    // Seuls les matériaux dont un cadre porte un sticker paient la projection.
    for (const entry of rig.materials) {
      if (entry.zones.some((index) => (layers[index]?.length ?? 0) > 0)) patchMaterial(rig, entry, texture);
      else unpatchMaterial(entry);
    }
    rig.onReady?.();
  });
}

/** Mémoire de la texture de livrée, en octets (mipmaps comprises) ; 0 sans sticker. */
export function liveryBytes(rig: LiveryRig | null | undefined): number {
  if (!rig?.canvas) return 0;
  return Math.round(rig.canvas.width * rig.canvas.height * 4 * (4 / 3));
}

export function disposeLivery(rig: LiveryRig | null | undefined): void {
  if (!rig) return;
  rig.disposed = true;
  for (const entry of rig.materials) unpatchMaterial(entry);
  rig.texture?.dispose();
  rig.texture = null;
  rig.canvas = null;
  rig.onReady = null;
}
