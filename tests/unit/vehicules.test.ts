// Architecture des véhicules (jalon 2) : catalogue découvert au build, validation des manifestes,
// ordre, rôles des matériaux, et preuve du § 15 : ajouter un véhicule ne demande aucune
// modification de code (un dossier aux conventions, déposé ici, entre dans le catalogue).

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, type Material } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { afterAll, describe, expect, it } from 'vitest';
import { materialRole, paintZoneOf } from '../../src/data/materialRoles.ts';
import { buildCatalog, folderOf, resolveVehicle, validateManifest, vehicleById, VEHICLES } from '../../src/data/vehicles.ts';
import type { VehicleManifest } from '../../src/data/vehicleTypes.ts';
import { resolvePaints } from '../../src/state/builds.ts';

const ROOT = new URL('../../', import.meta.url);
const VEHICLES_DIR = new URL('public/assets/vehicles/', ROOT);

// Les modules .tsx échappent au typage des tests (pas de jsx dans tsconfig.node.json) : import
// dynamique, et la part utile de leur interface écrite ici.
interface PreparedLike {
  root: Group;
  paints: MeshPhysicalMaterial[];
  zones: ReadonlyMap<string, MeshPhysicalMaterial>;
  halfLength: number;
  halfWidth: number;
  height: number;
}
interface VehicleModule {
  prepare: (source: Group, vehicle: VehicleManifest) => PreparedLike;
  disposePrepared: (prepared: PreparedLike) => void;
  paintZones: (zones: ReadonlyMap<string, MeshPhysicalMaterial>, paints: Record<string, unknown>, bodyEnv: number) => void;
}
const VEHICLE_MODEL = '../../src/scene/vehicle/VehicleModel.tsx';
const { prepare, disposePrepared, paintZones } = (await import(/* @vite-ignore */ VEHICLE_MODEL)) as VehicleModule;

/**
 * Petit GLB aux conventions, fabriqué ici : un pavé par matériau, alignés le long de X (avant
 * vers +X), posés au sol. Aucune texture.
 */
export function makeConventionGlb(materials: readonly string[], length = 4): Uint8Array {
  const positions: number[] = [];
  const indices: number[] = [];
  const primitives: Array<{ attributes: { POSITION: number }; indices: number; material: number }> = [];
  const accessors: unknown[] = [];
  const views: unknown[] = [];
  const chunks: Buffer[] = [];
  let offset = 0;
  const step = length / materials.length;
  materials.forEach((_, index) => {
    const x0 = -length / 2 + index * step;
    const x1 = x0 + step;
    const box = [
      [x0, 0, -0.8], [x1, 0, -0.8], [x1, 1.2, -0.8], [x0, 1.2, -0.8],
      [x0, 0, 0.8], [x1, 0, 0.8], [x1, 1.2, 0.8], [x0, 1.2, 0.8],
    ];
    const pos = new Float32Array(box.flat());
    const idx = new Uint16Array([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 1, 5, 6, 1, 6, 2, 0, 3, 7, 0, 7, 4]);
    positions.push(...pos);
    indices.push(...idx);
    const posBuf = Buffer.from(pos.buffer);
    const idxBuf = Buffer.alloc(Math.ceil(idx.byteLength / 4) * 4);
    Buffer.from(idx.buffer).copy(idxBuf);
    views.push({ buffer: 0, byteOffset: offset, byteLength: posBuf.length, target: 34962 });
    accessors.push({ bufferView: views.length - 1, componentType: 5126, count: 8, type: 'VEC3', min: [x0, 0, -0.8], max: [x1, 1.2, 0.8] });
    offset += posBuf.length;
    views.push({ buffer: 0, byteOffset: offset, byteLength: idx.byteLength, target: 34963 });
    accessors.push({ bufferView: views.length - 1, componentType: 5123, count: idx.length, type: 'SCALAR' });
    offset += idxBuf.length;
    chunks.push(posBuf, idxBuf);
    primitives.push({ attributes: { POSITION: accessors.length - 2 }, indices: accessors.length - 1, material: index });
  });
  const bin = Buffer.concat(chunks);
  const json = {
    asset: { version: '2.0', generator: 'test PimpMyBichon' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'caisse' }],
    meshes: [{ primitives }],
    materials: materials.map((name) => ({ name, pbrMetallicRoughness: { baseColorFactor: [0.5, 0.5, 0.5, 1] } })),
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: bin.length }],
  };
  let text = Buffer.from(JSON.stringify(json));
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + text.length + 8 + bin.length, 8);
  const jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(text.length, 0);
  jsonHead.writeUInt32LE(0x4e4f534a, 4);
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(bin.length, 0);
  binHead.writeUInt32LE(0x004e4942, 4);
  return new Uint8Array(Buffer.concat([header, jsonHead, text, binHead, bin]));
}

async function parseGlb(bytes: Uint8Array): Promise<Group> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  return gltf.scene;
}

function manifest(over: Partial<VehicleManifest> & { id: string }): VehicleManifest {
  return {
    name: 'L’essai',
    kind: 'car',
    wave: 1,
    order: 50,
    glb: 'body.glb',
    placeholder: 'placeholder_essai',
    halfLengthHint: 2,
    zones: [
      { id: 'carrosserie', label: 'Carrosserie', materials: [], group: 'carrosserie', paint: { color: '#0a3a46', finish: 'paillete' } },
      { id: 'toit', label: 'Toit', materials: [], group: 'carrosserie', paint: { color: '#f0efe9', finish: 'brillant' } },
      { id: 'jantes', label: 'Jantes', materials: [], group: 'accastillage', paint: { color: '#d4d6dc', finish: 'chrome' } },
    ],
    ...over,
  };
}

function materialsByName(root: Group): Map<string, Material> {
  const found = new Map<string, Material>();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) found.set(material.name, material);
  });
  return found;
}

describe('catalogue des véhicules', () => {
  it('lit chaque dossier de public/assets/vehicles/ qui a un vehicle.json, trié par order', () => {
    const folders = readdirSync(VEHICLES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && readdirSync(new URL(`${entry.name}/`, VEHICLES_DIR)).includes('vehicle.json'))
      .map((entry) => entry.name);
    expect(VEHICLES.map((vehicle) => vehicle.id).sort()).toEqual(folders.sort());
    const orders = VEHICLES.map((vehicle) => vehicle.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it('le véhicule de départ est le premier du catalogue ; un inconnu y retombe', () => {
    const first = VEHICLES[0];
    expect(first).toBeDefined();
    expect(resolveVehicle(null)).toBe(first);
    expect(resolveVehicle('nexistepas')).toBe(first);
    for (const vehicle of VEHICLES) expect(vehicleById(vehicle.id)).toBe(vehicle);
  });

  it('le concept reprend le modèle de banc d’essai : substitut, adaptation, moteur', () => {
    const concept = VEHICLES.find((vehicle) => vehicle.wave === 0);
    expect(concept?.placeholder).toBe('placeholder_banc');
    expect(concept?.adapt?.glass?.materials).toContain('Glass');
    expect(concept?.adapt?.logoTextures?.length).toBeGreaterThan(0);
    expect(concept?.engine).toEqual({ label: 'V8 central', fuel: 'essence', feed: 'injection', boost: 'atmo', power: 480 });
    expect(concept?.zones.filter((zone) => zone.group === 'accastillage').map((zone) => zone.id)).toEqual(['jantes', 'etriers', 'sellerie']);
  });

  it('trie par order, puis par identifiant', () => {
    const catalog = buildCatalog({
      'x/vehicles/b/vehicle.json': manifest({ id: 'b', order: 2 }),
      'x/vehicles/a/vehicle.json': manifest({ id: 'a', order: 2 }),
      'x/vehicles/c/vehicle.json': manifest({ id: 'c', order: 1 }),
    });
    expect(catalog.map((vehicle) => vehicle.id)).toEqual(['c', 'a', 'b']);
  });

  it('refuse un catalogue vide', () => {
    expect(() => buildCatalog({})).toThrow(/Catalogue vide/);
  });
});

describe('validation des manifestes', () => {
  it('accepte un manifeste complet', () => {
    expect(validateManifest(manifest({ id: 'essai' }), 'essai').id).toBe('essai');
  });

  it('exige un id égal au nom du dossier, et cite le fichier', () => {
    expect(() => validateManifest(manifest({ id: 'autre' }), 'essai')).toThrow(
      /public\/assets\/vehicles\/essai\/vehicle\.json.*id « autre ».*« essai »/,
    );
    expect(folderOf('../../public/assets/vehicles/essai/vehicle.json')).toBe('essai');
  });

  it('liste chaque problème trouvé', () => {
    const raw = { ...manifest({ id: 'essai' }), kind: 'camion', wave: 7, glb: '../x.glb', halfLengthHint: 0, placeholder: 'faux' };
    const error = (() => {
      try {
        validateManifest(raw, 'essai');
        return '';
      } catch (caught) {
        return (caught as Error).message;
      }
    })();
    for (const field of ['kind', 'wave', 'glb', 'halfLengthHint', 'placeholder']) expect(error).toContain(field);
  });

  it('vérifie zones, peintures et moteur', () => {
    const zones = [
      { id: 'a', label: 'A', materials: [], group: 'carrosserie', paint: { color: 'rouge', finish: 'brillant' } },
      { id: 'a', label: 'B', materials: 'x', group: 'toit', paint: { color: '#ffffff', finish: 'inconnue' } },
    ];
    expect(() => validateManifest({ ...manifest({ id: 'e' }), zones }, 'e')).toThrow(/paint\.color.*en double.*materials.*group.*finish/);
    expect(() => validateManifest({ ...manifest({ id: 'e' }), zones: [] }, 'e')).toThrow(/au moins une zone/);
    const engine = { label: '', fuel: 'kérosène', feed: 'injection', boost: 'atmo', power: -3 };
    expect(() => validateManifest({ ...manifest({ id: 'e' }), engine }, 'e')).toThrow(/engine\.label.*engine\.fuel.*engine\.power/);
  });

  it('chaque manifeste du dépôt passe, et son id est le nom de son dossier', () => {
    for (const vehicle of VEHICLES) {
      const raw: unknown = JSON.parse(readFileSync(new URL(`${vehicle.id}/vehicle.json`, VEHICLES_DIR), 'utf8'));
      expect(validateManifest(raw, vehicle.id)).toEqual(vehicle);
    }
  });
});

describe('rôles des matériaux (§ 8)', () => {
  it('reconnaît les rôles, suffixes d’exporteur compris', () => {
    expect(materialRole('chrome')?.metalness).toBe(1);
    expect(materialRole('Chrome.001')?.id).toBe('chrome');
    expect(materialRole('rubber_2')?.id).toBe('rubber');
    expect(materialRole('glass')?.opacity).toBeLessThan(1);
    for (const id of ['lamp', 'tail', 'signal']) expect(materialRole(id)?.emissive?.intensity).toBeGreaterThan(1);
    expect(materialRole('Paint 1 Carmine')).toBeUndefined();
    expect(paintZoneOf('paint_toit')).toBe('toit');
    expect(paintZoneOf('paint_toit.001')).toBe('toit');
    expect(paintZoneOf('paint_')).toBeNull();
    expect(paintZoneOf('chrome')).toBeNull();
  });

  it('habille un modèle aux conventions d’après le nom de ses matériaux', async () => {
    const names = ['paint_carrosserie', 'paint_toit', 'paint_jantes', 'chrome', 'glass', 'lamp', 'tail', 'rubber', 'mystere'];
    const scene = await parseGlb(makeConventionGlb(names));
    const vehicle = manifest({ id: 'essai' });
    const prepared = prepare(scene, vehicle);
    expect([...prepared.zones.keys()].sort()).toEqual(['carrosserie', 'jantes', 'toit']);
    expect(prepared.halfLength).toBeCloseTo(2, 3);
    expect(prepared.halfWidth).toBeCloseTo(0.8, 3);
    expect(prepared.height).toBeCloseTo(1.2, 3);
    const found = materialsByName(prepared.root);
    const chrome = found.get('chrome') as MeshStandardMaterial;
    expect(chrome.metalness).toBe(1);
    expect(chrome.roughness).toBeLessThan(0.1);
    const glass = found.get('glass') as MeshStandardMaterial;
    expect(glass.transparent).toBe(true);
    expect(glass.depthWrite).toBe(false);
    expect((found.get('lamp') as MeshStandardMaterial).emissiveIntensity).toBeGreaterThan(1);
    expect((found.get('tail') as MeshStandardMaterial).emissive.r).toBeGreaterThan(0.5);
    expect((found.get('mystere') as MeshStandardMaterial).color.r).toBeCloseTo(0.5, 2);

    // Peintures du store : le toit suit la carrosserie (zone maîtresse), les jantes gardent la leur.
    paintZones(prepared.zones, resolvePaints(vehicle, { paints: { carrosserie: { color: '#ff0000' } } }), 1);
    const body = prepared.zones.get('carrosserie');
    const roof = prepared.zones.get('toit');
    const rims = prepared.zones.get('jantes');
    expect(body?.color.getHexString()).toBe(roof?.color.getHexString());
    expect(rims?.metalness).toBe(1);
    disposePrepared(prepared);
  });
});

describe('§ 15 : ajouter un véhicule ne demande aucune modification de code', () => {
  const folder = `zz-essai-${process.pid}`;
  const dir = join(VEHICLES_DIR.pathname, folder);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('un dossier aux conventions, déposé dans public/assets/vehicles/, entre dans le catalogue', async () => {
    mkdirSync(dir, { recursive: true });
    const glb = makeConventionGlb(['paint_carrosserie', 'paint_toit', 'chrome', 'glass', 'lamp']);
    writeFileSync(join(dir, 'body.glb'), glb);
    writeFileSync(join(dir, 'vehicle.json'), JSON.stringify(manifest({ id: folder, order: 999, name: 'Le dossier d’essai' }), null, 2));

    // Module neuf (requête distincte) : la découverte se refait avec le dossier présent.
    const fresh = `../../src/data/vehicles.ts?essai=${Date.now()}`;
    const catalog = (await import(/* @vite-ignore */ fresh)) as typeof import('../../src/data/vehicles.ts');
    const found = catalog.vehicleById(folder);
    expect(found?.name).toBe('Le dossier d’essai');
    expect(catalog.VEHICLES.at(-1)?.id).toBe(folder);
    expect(catalog.modelUrl(found as VehicleManifest)).toBe(`/assets/vehicles/${folder}/body.glb`);

    const prepared = prepare(await parseGlb(readFileSync(join(dir, 'body.glb'))), found as VehicleManifest);
    expect([...prepared.zones.keys()].sort()).toEqual(['carrosserie', 'toit']);
    disposePrepared(prepared);
  });
});
