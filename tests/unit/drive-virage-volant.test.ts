// Le volant du concept tourne en roulant (demande du 16 novembre 2026 : « si on prend des virages ça
// serait bien aussi de voir le volant tourner en vue intérieure ») : son nœud, déclaré par le
// manifeste (`interior.steeringNode`), reste hors de la fusion des pièces (`prepare`) ; il tourne
// autour de sa colonne (normale de sa jante), par son centre, tourné vers le conducteur.
import { readFileSync } from 'node:fs';
import { Box3, Matrix4, Quaternion, Vector3, type Group, type Mesh } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import type { VehicleManifest } from '../../src/data/vehicleTypes.ts';
import { validateManifest } from '../../src/data/vehicles.ts';
import { steeringWheelPart, steerParts } from '../../src/drive/scene/roues.ts';

// Module .tsx : import dynamique, la part utile de son interface écrite ici (comme roues-place.test.ts).
const VEHICLE_MODEL = '../../src/scene/vehicle/VehicleModel.tsx';
const { prepare } = (await import(/* @vite-ignore */ VEHICLE_MODEL)) as { prepare: (source: Group, vehicle: VehicleManifest) => { root: Group } };

/** Le GLB du concept, sans ses textures (KTX2, illisibles hors navigateur). */
function conceptGlb(): ArrayBuffer {
  const bytes = readFileSync(new URL('../../public/assets/vehicles/concept/body.glb', import.meta.url));
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8')) as Record<string, unknown>;
  delete json.textures;
  delete json.images;
  delete json.samplers;
  json.extensionsRequired = ((json.extensionsRequired as string[] | undefined) ?? []).filter((e) => e !== 'KHR_texture_basisu');
  const strip = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const key of Object.keys(value)) {
      if (key.endsWith('Texture')) delete (value as Record<string, unknown>)[key];
      else strip((value as Record<string, unknown>)[key]);
    }
  };
  strip(json.materials);
  let chunk = Buffer.from(JSON.stringify(json), 'utf8');
  chunk = Buffer.concat([chunk, Buffer.alloc((4 - (chunk.length % 4)) % 4, 0x20)]);
  const rest = bytes.subarray(20 + length);
  const out = Buffer.alloc(20 + chunk.length + rest.length);
  bytes.copy(out, 0, 0, 12);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(chunk.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  chunk.copy(out, 20);
  rest.copy(out, 20 + chunk.length);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.length);
}

const manifest = JSON.parse(readFileSync(new URL('../../public/assets/vehicles/concept/vehicle.json', import.meta.url), 'utf8')) as VehicleManifest;

describe('le volant du concept', () => {
  it('déclaré par le manifeste, validé', () => {
    expect(manifest.interior?.steeringNode).toBeTruthy();
    expect(() => validateManifest(manifest, 'concept')).not.toThrow();
    expect(() => validateManifest({ ...manifest, interior: { fixed: true, steeringNode: '' } }, 'concept')).toThrow(/interior\.steeringNode/);
  });

  it('gardé hors de la fusion, tourne autour de sa colonne par son centre, vers la gauche pour un angle positif', async () => {
    const source = (await new GLTFLoader().parseAsync(conceptGlb(), '')).scene;
    const { root } = prepare(source, manifest);
    root.updateWorldMatrix(true, true);
    const node = root.getObjectByName(manifest.interior!.steeringNode!)!;
    expect(node, 'nœud du volant').toBeDefined();
    let parts = 0;
    node.traverse((o) => {
      if ((o as Mesh).isMesh) parts += 1;
    });
    expect(parts, 'jante, branches et colonne non fusionnées').toBeGreaterThanOrEqual(3);
    // Phares, feux et plaque toujours là.
    const names = new Set<string>();
    root.traverse((o) => names.add(o.name));
    for (const name of ['BodyHeadlights', 'BodyTaillights', 'License_Plate']) expect(names.has(name), name).toBe(true);

    const part = steeringWheelPart(root, node)!;
    expect(part, 'axe mesuré').not.toBeNull();
    const toRoot = new Matrix4().copy(root.matrixWorld).invert().multiply(node.parent!.matrixWorld);
    const axis = part.axis.clone().transformDirection(toRoot);
    const centre = part.pivot.clone().applyMatrix4(toRoot);
    // Colonne tournée vers le conducteur (vers l'arrière), dans un plan vertical du véhicule.
    expect(axis.x).toBeLessThan(-0.7);
    expect(Math.abs(axis.z)).toBeLessThan(0.15);
    // Centre du volant dans l'habitacle, à hauteur de poitrine.
    const box = new Box3().setFromObject(root, true);
    expect(centre.x).toBeGreaterThan(box.min.x);
    expect(centre.x).toBeLessThan(box.max.x);
    expect(centre.y).toBeGreaterThan(0.5);
    expect(centre.y).toBeLessThan(1.1);

    // Tourné de 0,5 rad : chaque point de la jante tourne autour de l'axe ; le centre ne bouge pas.
    const rim = new Box3().setFromObject(node, true).getCenter(new Vector3()).applyMatrix4(new Matrix4().copy(root.matrixWorld).invert());
    steerParts([part], 0.5);
    root.updateWorldMatrix(true, true);
    const moved = new Box3().setFromObject(node, true).getCenter(new Vector3()).applyMatrix4(new Matrix4().copy(root.matrixWorld).invert());
    expect(moved.distanceTo(rim)).toBeLessThan(0.05);
    // Le haut de la jante part vers la gauche (−Z du véhicule) pour un angle positif.
    const top = centre.clone().add(new Vector3(0, 0.15, 0));
    const q = new Quaternion().setFromAxisAngle(axis, 0.5);
    expect(top.clone().sub(centre).applyQuaternion(q).z).toBeLessThan(-0.05);
    steerParts([part], 0);
    expect(node.quaternion.angleTo(part.base)).toBeLessThan(1e-9);
  }, 60_000);
});
