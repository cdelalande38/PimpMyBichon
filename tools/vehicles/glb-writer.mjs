// @ts-check
// Écrivain GLB minimal (glTF 2.0 binaire), en Node pur : positions, normales, indices, arbre de
// nœuds nommés, matériaux nommés en PBR métal-rugosité, aucune texture. Déterministe : mêmes
// entrées, mêmes octets. La relecture passe par tools/lib/glb.mjs (parseGlb).

/**
 * @typedef {object} GlbPrimitive
 * @property {number} material      rang dans materials
 * @property {Float32Array} positions
 * @property {Float32Array} normals
 * @property {Uint32Array} indices
 */
/**
 * @typedef {object} GlbMaterial
 * @property {string} name
 * @property {string} color          '#rrggbb'
 * @property {number} metallic
 * @property {number} roughness
 * @property {string} [emissive]     '#rrggbb'
 * @property {number} [emissiveStrength]
 * @property {number} [alpha]        < 1 : mélange (verre)
 */
/**
 * @typedef {object} GlbNode
 * @property {string} name
 * @property {number} [mesh]
 * @property {number[]} [translation]
 * @property {number[]} [rotation]   quaternion x, y, z, w
 * @property {number[]} [children]
 */

const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;

/** '#rrggbb' sRGB → composantes linéaires (glTF attend des facteurs linéaires). @param {string} hex */
export function srgbHexToLinear(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`couleur « ${hex} » invalide (#rrggbb)`);
  const v = parseInt(/** @type {string} */ (m[1]), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => {
    const s = c / 255;
    return round(s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4);
  });
}

/** @param {number} v */
const round = (v) => Math.round(v * 1e6) / 1e6;

/**
 * @param {{ nodes: GlbNode[], meshes: { name: string, primitives: GlbPrimitive[] }[], materials: GlbMaterial[], generator?: string }} scene
 *   nodes[0] est la racine de la scène.
 * @returns {Uint8Array}
 */
export function writeGlb(scene) {
  /** @type {Uint8Array[]} */
  const chunks = [];
  let offset = 0;
  /** @type {any[]} */
  const bufferViews = [];
  /** @type {any[]} */
  const accessors = [];

  /** @param {ArrayBufferView} data @param {number} target */
  const pushView = (data, target) => {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    chunks.push(bytes);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, target });
    offset += bytes.byteLength;
    const pad = (4 - (offset % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      offset += pad;
    }
    return bufferViews.length - 1;
  };

  const meshes = scene.meshes.map((mesh) => ({
    name: mesh.name,
    primitives: mesh.primitives.map((p) => {
      const count = p.positions.length / 3;
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < p.positions.length; i += 3)
        for (let k = 0; k < 3; k += 1) {
          const v = /** @type {number} */ (p.positions[i + k]);
          if (v < /** @type {number} */ (min[k])) min[k] = v;
          if (v > /** @type {number} */ (max[k])) max[k] = v;
        }
      // Les bornes sont celles des flottants 32 bits réellement écrits.
      const f32 = (/** @type {number} */ v) => Math.fround(v);
      const posView = pushView(p.positions, ARRAY_BUFFER);
      accessors.push({ bufferView: posView, componentType: FLOAT, count, type: 'VEC3', min: min.map(f32), max: max.map(f32) });
      const position = accessors.length - 1;
      const norView = pushView(p.normals, ARRAY_BUFFER);
      accessors.push({ bufferView: norView, componentType: FLOAT, count, type: 'VEC3' });
      const normal = accessors.length - 1;
      const small = count < 65536;
      const idx = small ? Uint16Array.from(p.indices) : p.indices;
      const idxView = pushView(idx, ELEMENT_ARRAY_BUFFER);
      accessors.push({ bufferView: idxView, componentType: small ? UNSIGNED_SHORT : UNSIGNED_INT, count: p.indices.length, type: 'SCALAR' });
      return { attributes: { POSITION: position, NORMAL: normal }, indices: accessors.length - 1, material: p.material, mode: 4 };
    }),
  }));

  const materials = scene.materials.map((m) => {
    const [r, g, b] = srgbHexToLinear(m.color);
    /** @type {any} */
    const out = {
      name: m.name,
      pbrMetallicRoughness: { baseColorFactor: [r, g, b, m.alpha ?? 1], metallicFactor: m.metallic, roughnessFactor: m.roughness },
    };
    if (m.emissive) out.emissiveFactor = srgbHexToLinear(m.emissive).map((c) => round(c * Math.min(1, m.emissiveStrength ?? 1)));
    if ((m.alpha ?? 1) < 1) out.alphaMode = 'BLEND';
    return out;
  });

  const json = {
    asset: { version: '2.0', generator: scene.generator ?? 'tools/vehicles/glb-writer.mjs' },
    scene: 0,
    scenes: [{ name: scene.nodes[0]?.name ?? 'scene', nodes: [0] }],
    nodes: scene.nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
  };

  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.byteLength % 4)) % 4;
  const jsonLen = jsonBytes.byteLength + jsonPad;
  const total = 12 + 8 + jsonLen + 8 + offset;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); // « glTF »
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLen, true);
  view.setUint32(16, 0x4e4f534a, true); // « JSON »
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.byteLength, 20 + jsonLen); // bourrage JSON : espaces
  let p = 20 + jsonLen;
  view.setUint32(p, offset, true);
  view.setUint32(p + 4, 0x004e4942, true); // « BIN\0 »
  p += 8;
  for (const c of chunks) {
    out.set(c, p);
    p += c.byteLength;
  }
  return out;
}
