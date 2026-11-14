// @ts-check
// Lecture d'un conteneur GLB en Node pur : en-tête, bloc JSON, bloc binaire ; comptage des
// triangles et des primitives ; dimensions des images embarquées (KTX2, PNG, JPEG, WebP).
// Aucune fonction ne lève d'exception sur des octets malformés : elles retournent un échec.

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, normalize, sep } from 'node:path';

const GLB_MAGIC = 0x46546c67; // « glTF »
const CHUNK_JSON = 0x4e4f534a; // « JSON »
const CHUNK_BIN = 0x004e4942; // « BIN\0 »

const MODE_TRIANGLES = 4;
const MODE_TRIANGLE_STRIP = 5;
const MODE_TRIANGLE_FAN = 6;

const KTX2_IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * @typedef {object} GlbContainer
 * @property {Record<string, any>} json  bloc JSON (glTF)
 * @property {Uint8Array} bin            bloc binaire, vide s'il n'y en a pas
 */

/**
 * @typedef {object} ImageSize
 * @property {'KTX2' | 'PNG' | 'JPEG' | 'WebP'} format
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {object} ImageInfo
 * @property {number} index
 * @property {string} format         'KTX2', 'PNG', 'JPEG', 'WebP' ou 'inconnu'
 * @property {number | null} width   null si l'en-tête de l'image n'a pas pu être lu
 * @property {number | null} height
 */

/**
 * @typedef {object} GlbStats
 * @property {number} triangles
 * @property {number} primitives
 * @property {number} meshes
 * @property {ImageInfo[]} images
 */

/** @param {Uint8Array} bytes @param {number[]} signature @param {number} [at] */
function startsWith(bytes, signature, at = 0) {
  if (bytes.length < at + signature.length) return false;
  return signature.every((value, i) => bytes[at + i] === value);
}

/** @param {Uint8Array} bytes */
function view(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Découpe un fichier GLB en JSON et binaire.
 * @param {Uint8Array} bytes
 * @returns {{ ok: true, container: GlbContainer } | { ok: false, message: string }}
 */
export function parseGlb(bytes) {
  if (bytes.length < 12) return { ok: false, message: `fichier de ${bytes.length} octets : trop court pour un GLB` };
  const data = view(bytes);
  if (data.getUint32(0, true) !== GLB_MAGIC) {
    return { ok: false, message: "en-tête absent : le fichier ne commence pas par « glTF »" };
  }
  const version = data.getUint32(4, true);
  if (version !== 2) return { ok: false, message: `version ${version} du conteneur GLB : seule la version 2 est lue` };
  const declared = data.getUint32(8, true);
  if (declared > bytes.length) {
    return { ok: false, message: `fichier tronqué : l'en-tête annonce ${declared} octets, il en contient ${bytes.length}` };
  }

  /** @type {Uint8Array | null} */
  let jsonChunk = null;
  /** @type {Uint8Array} */
  let bin = new Uint8Array(0);
  let offset = 12;
  while (offset + 8 <= declared) {
    const length = data.getUint32(offset, true);
    const type = data.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + length > declared) return { ok: false, message: 'bloc tronqué : sa longueur dépasse celle du fichier' };
    if (type === CHUNK_JSON && jsonChunk === null) jsonChunk = bytes.subarray(start, start + length);
    else if (type === CHUNK_BIN && bin.length === 0) bin = bytes.subarray(start, start + length);
    offset = start + length + ((4 - (length % 4)) % 4);
  }
  if (jsonChunk === null) return { ok: false, message: 'bloc JSON absent' };

  try {
    const json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(jsonChunk));
    if (typeof json !== 'object' || json === null || Array.isArray(json)) {
      return { ok: false, message: "bloc JSON invalide : ce n'est pas un objet" };
    }
    return { ok: true, container: { json, bin } };
  } catch (error) {
    return { ok: false, message: `bloc JSON invalide : ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Dimensions lues dans l'en-tête d'une image : KTX2, PNG, JPEG ou WebP.
 * @param {Uint8Array} bytes
 * @returns {ImageSize | null}
 */
export function imageSize(bytes) {
  try {
    const data = view(bytes);
    if (startsWith(bytes, KTX2_IDENTIFIER) && bytes.length >= 28) {
      return { format: 'KTX2', width: data.getUint32(20, true), height: data.getUint32(24, true) };
    }
    if (startsWith(bytes, PNG_SIGNATURE) && bytes.length >= 24) {
      return { format: 'PNG', width: data.getUint32(16, false), height: data.getUint32(20, false) };
    }
    if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpegSize(bytes, data);
    if (bytes.length >= 30 && startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
      return webpSize(bytes, data);
    }
  } catch {
    return null;
  }
  return null;
}

/** @param {Uint8Array} bytes @param {DataView} data @returns {ImageSize | null} */
function jpegSize(bytes, data) {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (bytes[offset + 1] === 0xff) offset += 1; // octets de remplissage
    const marker = bytes[offset + 1] ?? 0;
    const length = data.getUint16(offset + 2, false);
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (offset + 9 > bytes.length) return null;
      return { format: 'JPEG', width: data.getUint16(offset + 7, false), height: data.getUint16(offset + 5, false) };
    }
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

/** @param {Uint8Array} bytes @param {DataView} data @returns {ImageSize | null} */
function webpSize(bytes, data) {
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunk === 'VP8 ') {
    return { format: 'WebP', width: data.getUint16(26, true) & 0x3fff, height: data.getUint16(28, true) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    const bits = data.getUint32(21, true);
    return { format: 'WebP', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    const width = (bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16);
    const height = (bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16);
    return { format: 'WebP', width: width + 1, height: height + 1 };
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} value */
function nonNegativeInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

/**
 * Triangles et primitives de tous les maillages du fichier. Un triangle de liste vaut
 * indices / 3 (ou sommets / 3 sans indices) ; une bande ou un éventail, n - 2.
 * Les autres modes (points, lignes) comptent comme primitive, sans triangle.
 * @param {Record<string, any>} json
 * @returns {{ triangles: number, primitives: number, meshes: number }}
 */
export function countGeometry(json) {
  const accessors = Array.isArray(json.accessors) ? json.accessors : [];
  const meshes = Array.isArray(json.meshes) ? json.meshes : [];
  /** @param {unknown} index */
  const countOf = (index) => {
    const accessor = typeof index === 'number' ? accessors[index] : undefined;
    return isRecord(accessor) ? nonNegativeInteger(accessor.count) : 0;
  };

  let triangles = 0;
  let primitives = 0;
  for (const mesh of meshes) {
    const list = isRecord(mesh) && Array.isArray(mesh.primitives) ? mesh.primitives : [];
    for (const primitive of list) {
      if (!isRecord(primitive)) continue;
      primitives += 1;
      const mode = typeof primitive.mode === 'number' ? primitive.mode : MODE_TRIANGLES;
      const vertices = primitive.indices !== undefined
        ? countOf(primitive.indices)
        : countOf(isRecord(primitive.attributes) ? primitive.attributes.POSITION : undefined);
      if (mode === MODE_TRIANGLES) triangles += Math.floor(vertices / 3);
      else if (mode === MODE_TRIANGLE_STRIP || mode === MODE_TRIANGLE_FAN) triangles += Math.max(0, vertices - 2);
    }
  }
  return { triangles, primitives, meshes: meshes.length };
}

/**
 * Octets d'une image du JSON : vue du binaire, URI de données, ou fichier voisin du GLB.
 * @param {Record<string, any>} json
 * @param {Uint8Array} bin
 * @param {unknown} image
 * @param {string | undefined} baseDir  dossier du GLB, pour les URI relatives
 * @returns {Uint8Array | null}
 */
function imageBytes(json, bin, image, baseDir) {
  if (!isRecord(image)) return null;
  if (typeof image.bufferView === 'number') {
    const views = Array.isArray(json.bufferViews) ? json.bufferViews : [];
    const bufferView = views[image.bufferView];
    if (!isRecord(bufferView)) return null;
    const start = nonNegativeInteger(bufferView.byteOffset);
    const length = nonNegativeInteger(bufferView.byteLength);
    if (start + length > bin.length) return null;
    return bin.subarray(start, start + length);
  }
  if (typeof image.uri !== 'string') return null;
  const data = /^data:[^,]*;base64,(.*)$/s.exec(image.uri);
  if (data) return Uint8Array.from(Buffer.from(data[1] ?? '', 'base64'));
  if (baseDir === undefined || /^[a-z][a-z0-9+.-]*:/i.test(image.uri)) return null;
  try {
    const relative = normalize(decodeURIComponent(image.uri));
    if (isAbsolute(relative) || relative === '..' || relative.startsWith(`..${sep}`)) return null;
    const path = join(baseDir, relative);
    return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
  } catch {
    return null;
  }
}

/**
 * Mesures d'un GLB : triangles, primitives, maillages, et une ligne par image.
 * @param {GlbContainer} container
 * @param {string} [baseDir]  dossier du fichier, pour les images à URI relative
 * @returns {GlbStats}
 */
export function measureGlb({ json, bin }, baseDir) {
  const images = Array.isArray(json.images) ? json.images : [];
  return {
    ...countGeometry(json),
    images: images.map((image, index) => {
      const bytes = imageBytes(json, bin, image, baseDir);
      const size = bytes ? imageSize(bytes) : null;
      return {
        index,
        format: size?.format ?? 'inconnu',
        width: size?.width ?? null,
        height: size?.height ?? null,
      };
    }),
  };
}
