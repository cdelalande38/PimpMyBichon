// Petits GLB fabriqués en mémoire pour les tests de budgets des modèles : seuls comptent
// l'en-tête, le JSON et les en-têtes d'images ; les sommets n'existent pas (les accesseurs
// annoncent un nombre d'éléments, rien de plus).

/** Une primitive : `indices` (nombre d'indices) ou, à défaut, `vertices` ; `mode` vaut 4 (triangles) par défaut. */
export interface PrimitiveSpec {
  indices?: number;
  vertices?: number;
  mode?: number;
}

export interface GlbSpec {
  /** Un maillage par entrée, chacun avec ses primitives. */
  meshes?: PrimitiveSpec[][];
  /** Maillage posé par chaque nœud (un maillage peut l'être par plusieurs) ; par défaut, un nœud par maillage. */
  nodes?: number[];
  /** Noms écrits dans le JSON : nœuds et matériaux (un matériau par nom). */
  nodeNames?: string[];
  materialNames?: string[];
  /** Images embarquées dans le bloc binaire, dans l'ordre. */
  images?: Uint8Array[];
  /** JSON brut à la place de celui qui est fabriqué (cas malformés). */
  rawJson?: string;
  /** Version écrite dans l'en-tête (2 par défaut). */
  version?: number;
}

function pad(bytes: Uint8Array, filler: number): Uint8Array {
  const size = Math.ceil(bytes.length / 4) * 4;
  const out = new Uint8Array(size).fill(filler);
  out.set(bytes);
  return out;
}

function chunk(type: number, payload: Uint8Array, filler: number): Uint8Array {
  const body = pad(payload, filler);
  const out = new Uint8Array(8 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length, true);
  view.setUint32(4, type, true);
  out.set(body, 8);
  return out;
}

/** Un fichier GLB complet (version 2 sauf demande contraire). */
export function makeGlb(spec: GlbSpec = {}): Uint8Array {
  const accessors: Array<{ count: number }> = [];
  const accessorOf = (count: number): number => accessors.push({ count }) - 1;

  const meshes = (spec.meshes ?? []).map((primitives) => ({
    primitives: primitives.map((primitive) => ({
      attributes: { POSITION: accessorOf(primitive.vertices ?? (primitive.indices ?? 0) / 3) },
      ...(primitive.indices === undefined ? {} : { indices: accessorOf(primitive.indices) }),
      ...(primitive.mode === undefined ? {} : { mode: primitive.mode }),
    })),
  }));

  const images = spec.images ?? [];
  const bufferViews: Array<{ buffer: number; byteOffset: number; byteLength: number }> = [];
  const parts: Uint8Array[] = [];
  let offset = 0;
  for (const image of images) {
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: image.length });
    const padded = pad(image, 0);
    parts.push(padded);
    offset += padded.length;
  }
  const bin = new Uint8Array(offset);
  let cursor = 0;
  for (const part of parts) {
    bin.set(part, cursor);
    cursor += part.length;
  }

  const json =
    spec.rawJson ??
    JSON.stringify({
      asset: { version: '2.0' },
      accessors,
      meshes,
      nodes: (spec.nodes ?? meshes.map((_mesh, index) => index)).map((mesh, index) => ({
        mesh,
        ...(spec.nodeNames?.[index] === undefined ? {} : { name: spec.nodeNames[index] }),
      })),
      ...(spec.materialNames ? { materials: spec.materialNames.map((name) => ({ name })) } : {}),
      images: images.map((_image, index) => ({ bufferView: index })),
      bufferViews,
      buffers: bin.length > 0 ? [{ byteLength: bin.length }] : [],
    });

  const jsonChunk = chunk(0x4e4f534a, new TextEncoder().encode(json), 0x20);
  const binChunk = bin.length > 0 ? chunk(0x004e4942, bin, 0) : new Uint8Array(0);
  const out = new Uint8Array(12 + jsonChunk.length + binChunk.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, spec.version ?? 2, true);
  view.setUint32(8, out.length, true);
  out.set(jsonChunk, 12);
  out.set(binChunk, 12 + jsonChunk.length);
  return out;
}

/** Un GLB valide et minuscule : un maillage, une primitive, aucune texture. */
export const TINY_GLB = makeGlb({ meshes: [[{ indices: 3 }]] });

/** n maillages d'une primitive indexée de `triangles` triangles chacun. */
export function manyPrimitives(count: number, triangles = 1): PrimitiveSpec[][] {
  return Array.from({ length: count }, () => [{ indices: triangles * 3 }]);
}

/** En-tête KTX2 (identifiant, puis largeur et hauteur aux décalages 20 et 24). */
export function ktx2(width: number, height = width): Uint8Array {
  const out = new Uint8Array(80);
  out.set([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(out.buffer);
  view.setUint32(20, width, true);
  view.setUint32(24, height, true);
  return out;
}

/** Signature PNG et bloc IHDR (dimensions en gros-boutiste). */
export function png(width: number, height = width): Uint8Array {
  const out = new Uint8Array(33);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(out.buffer);
  view.setUint32(8, 13, false);
  out.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return out;
}

/** JPEG : SOI, un segment APP0 de 16 octets, puis SOF0 qui porte les dimensions. */
export function jpeg(width: number, height = width): Uint8Array {
  const out = new Uint8Array(2 + 18 + 19);
  const view = new DataView(out.buffer);
  out.set([0xff, 0xd8, 0xff, 0xe0]);
  view.setUint16(4, 16, false);
  const sof = 20;
  out.set([0xff, 0xc0], sof);
  view.setUint16(sof + 2, 17, false);
  out[sof + 4] = 8;
  view.setUint16(sof + 5, height, false);
  view.setUint16(sof + 7, width, false);
  return out;
}

/** WebP sans perte (VP8L) ou étendu (VP8X). */
export function webp(width: number, height = width, kind: 'VP8L' | 'VP8X' | 'VP8 ' = 'VP8L'): Uint8Array {
  const out = new Uint8Array(40);
  out.set([0x52, 0x49, 0x46, 0x46]);
  out.set([0x57, 0x45, 0x42, 0x50], 8);
  out.set(Array.from(kind, (letter) => letter.charCodeAt(0)), 12);
  const view = new DataView(out.buffer);
  if (kind === 'VP8L') {
    out[20] = 0x2f;
    view.setUint32(21, ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), true);
  } else if (kind === 'VP8X') {
    for (let i = 0; i < 3; i += 1) {
      out[24 + i] = ((width - 1) >>> (8 * i)) & 0xff;
      out[27 + i] = ((height - 1) >>> (8 * i)) & 0xff;
    }
  } else {
    out.set([0x9d, 0x01, 0x2a], 23);
    view.setUint16(26, width, true);
    view.setUint16(28, height, true);
  }
  return out;
}
