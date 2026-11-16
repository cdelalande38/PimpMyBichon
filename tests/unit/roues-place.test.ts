// Roues d'un modèle listées par son manifeste (wheels.nodes) : à leur place dans la caisse, la même
// au garage et en sortie de nuit, dans le repère du véhicule, à l'arrêt comme en roulant.
// Défaut attrapé : le concept a toutes ses pièces, roues comprises, sous son soubassement, qui se
// fusionne avec d'autres pièces ; `prepare` le retirait avec ses enfants, et les roues, rangées à
// part sans la rotation ni le recentrage du modèle, sortaient de leurs passages (et les phares, les
// feux et la plaque disparaissaient).
import { readFileSync } from 'node:fs';
import { Box3, BoxGeometry, CylinderGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, Quaternion, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { resolveWheels } from '../../src/data/wheels.ts';
import type { VehicleManifest } from '../../src/data/vehicleTypes.ts';
import { axleOf, rollingWheels, type Wheel } from '../../src/drive/scene/roues.ts';
import { mergeGround, mountWheels, type WheelRig } from '../../src/scene/vehicle/wheels.ts';

// Les modules .tsx échappent au typage des tests (pas de jsx dans tsconfig.node.json) : import
// dynamique, et la part utile de leur interface écrite ici (comme tests/unit/vehicules.test.ts).
interface Prepared {
  root: Group;
  wheels: WheelRig;
}
interface Rig {
  group: Group;
  body: Group;
  wheels: Wheel[];
}
interface VehicleModelModule {
  prepare: (source: Group, vehicle: VehicleManifest) => Prepared;
}
interface DriveModule {
  prepareForDrive: (source: Group, vehicle: VehicleManifest) => { prepared: Prepared };
  createRig: () => Rig;
  rollWheels: (rig: Rig, meters: number) => void;
}
const VEHICLE_MODEL = '../../src/scene/vehicle/VehicleModel.tsx';
const DRIVE_VEHICLE = '../../src/drive/scene/vehicule.tsx';
const { prepare } = (await import(/* @vite-ignore */ VEHICLE_MODEL)) as VehicleModelModule;
const { prepareForDrive, createRig, rollWheels } = (await import(/* @vite-ignore */ DRIVE_VEHICLE)) as DriveModule;

/** Centre (boîte des maillages) d'un nœud dans le repère du véhicule préparé. */
function centreIn(root: Object3D, node: Object3D): Vector3 {
  root.updateWorldMatrix(true, true);
  const inverse = new Matrix4().copy(root.matrixWorld).invert();
  return new Box3().setFromObject(node, true).applyMatrix4(inverse).getCenter(new Vector3());
}

/** Centres des roues au garage : roues posées puis fusionnées, comme VehicleModel. */
function garageCentres(source: Group, vehicle: VehicleManifest): Map<string, Vector3> {
  const prepared = prepare(source, vehicle);
  mountWheels(prepared.wheels, vehicle, resolveWheels(vehicle, undefined)!, null);
  const unmerge = mergeGround(prepared.wheels);
  const centres = new Map<string, Vector3>(prepared.wheels.anchors.map((a) => [a.node.name, centreIn(prepared.root, a.node)]));
  unmerge();
  return centres;
}

/** Le véhicule de la sortie, posé sur la route (cap, pente), ses roues prêtes à tourner. */
function drive(source: Group, vehicle: VehicleManifest) {
  const { prepared } = prepareForDrive(source, vehicle);
  const rig = createRig();
  rig.group.position.set(812, 64, -2290);
  rig.group.rotation.set(0, 2.3, 0.06);
  rig.body.add(prepared.root);
  const mounted = mountWheels(prepared.wheels, vehicle, resolveWheels(vehicle, undefined)!, null);
  rig.wheels = rollingWheels(prepared.root, mounted.spins);
  return { prepared, rig };
}

/** Écart le plus grand entre les centres de roue en sortie et au garage. */
function compare(prepared: Prepared, garage: Map<string, Vector3>): number {
  let offset = 0;
  for (const anchor of prepared.wheels.anchors) {
    const expected = garage.get(anchor.node.name);
    if (!expected) throw new Error(`roue ${anchor.node.name} absente au garage`);
    offset = Math.max(offset, centreIn(prepared.root, anchor.node).distanceTo(expected));
  }
  return offset;
}

/** Parcours d'une sortie : roule, plonge au freinage, prend du roulis ; rend l'écart le plus grand. */
function rollAround(prepared: Prepared, rig: Rig, garage: Map<string, Vector3>): number {
  let worst = compare(prepared, garage);
  for (const [meters, roll, dive] of [
    [0.4, 0, 0],
    [3.1, 0.03, -0.02],
    [11.7, -0.05, 0.015],
    [27.2, 0.01, -0.04],
  ] as const) {
    rig.body.rotation.set(roll, 0, dive);
    rollWheels(rig, meters);
    rig.group.updateMatrixWorld(true);
    worst = Math.max(worst, compare(prepared, garage));
    // L'essieu de chaque roue (sa plus petite dimension) reste sur le côté du véhicule (+Z de son
    // repère) : elle tourne droit, sans braquage ni voile.
    const rootQuaternion = prepared.root.getWorldQuaternion(new Quaternion()).invert();
    for (const w of rig.wheels) {
      const axle = axleOf(w.node)!.applyQuaternion(w.node.getWorldQuaternion(new Quaternion())).applyQuaternion(rootQuaternion);
      expect(Math.abs(axle.z), w.node.name).toBeCloseTo(1, 4);
    }
  }
  return worst;
}

const paint = () => new MeshStandardMaterial({ name: 'Paint' });

/**
 * Modèle d'essai bâti comme le concept : Z vers le haut (matrice du nœud de tête), longueur sur Y
 * (l'avant vers −Y), toutes les pièces sous le soubassement, qui partage son matériau avec le
 * moteur (fusionnés) ; roues listées par le manifeste, avant braquées de 30°.
 */
function zUpModel(): { source: Group; vehicle: VehicleManifest } {
  const mechanical = new MeshStandardMaterial({ name: 'Mechanical' });
  const body = paint();
  const source = new Group();
  const underside = new Mesh(new BoxGeometry(1.6, 3.6, 0.05), mechanical);
  underside.name = 'Underside';
  underside.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
  underside.geometry.translate(0, 0, 0.125);
  source.add(underside);
  const engine = new Mesh(new BoxGeometry(0.6, 0.6, 0.4), mechanical);
  engine.name = 'Engine';
  engine.position.set(0, 1, 0.4);
  underside.add(engine);
  for (const [name, y] of [
    ['ShellFront', -1],
    ['ShellRear', 1],
  ] as const) {
    const shell = new Mesh(new BoxGeometry(1.8, 2, 1.0).translate(0, 0, 0.6), body);
    shell.name = name;
    shell.position.y = y;
    underside.add(shell);
  }
  // Une lampe au matériau unique, sous le soubassement : elle ne doit pas disparaître.
  const lamp = new Mesh(new BoxGeometry(0.2, 0.05, 0.08), new MeshStandardMaterial({ name: 'Headlight' }));
  lamp.name = 'Lamp';
  lamp.position.set(0.6, -1.9, 0.7);
  underside.add(lamp);
  const names: string[] = [];
  for (const [name, x, y, steer] of [
    ['WheelFL', 0.8, -1.4, Math.PI / 6],
    ['WheelFR', -0.8, -1.4, Math.PI / 6],
    ['WheelRL', 0.8, 1.3, 0],
    ['WheelRR', -0.8, 1.3, 0],
  ] as const) {
    const node = new Group();
    node.name = name;
    node.position.set(x, y, 0.35);
    // Braquée autour de la verticale du modèle (Z), puis un quart de tour de roue autour de son axe (X).
    node.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), steer).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 1.1));
    const tire = new Mesh(new CylinderGeometry(0.35, 0.35, 0.25, 24).rotateZ(Math.PI / 2), new MeshStandardMaterial({ name: 'Tire' }));
    node.add(tire);
    underside.add(node);
    names.push(name);
  }
  const vehicle = {
    id: 'essai',
    name: 'Essai',
    kind: 'car',
    glb: 'body.glb',
    zones: [{ id: 'carrosserie', label: 'Carrosserie', materials: ['Paint'], paint: { color: '#336699', finish: 'brillant' } }],
    wheels: { nodes: names, gap: [0.03, 0.03], floor: 0.1 },
  } as unknown as VehicleManifest;
  return { source, vehicle };
}

describe('roues listées par le manifeste, modèle à Z vers le haut sous une pièce fusionnée', () => {
  it('au garage : chaque roue dans son passage, l’avant devant, le pneu au sol, la lampe gardée', () => {
    const { source, vehicle } = zUpModel();
    const prepared = prepare(source, vehicle);
    // Longueur sur X, avant (−Y du modèle) vers +X : passages avant à x = 1,4, arrière à x = −1,3
    // (caisse symétrique, centrée), voie de ±0,8 m sur Z, centre au rayon au-dessus du sol.
    const centres = prepared.wheels.anchors.map((a) => ({ a, c: centreIn(prepared.root, a.node) }));
    for (const { a, c } of centres) {
      const front = a.node.name.startsWith('WheelF');
      expect(a.front, a.node.name).toBe(front);
      expect(c.x, a.node.name).toBeCloseTo(front ? 1.4 : -1.3, 3);
      expect(Math.abs(c.z), a.node.name).toBeCloseTo(0.8, 3);
      expect(c.y, a.node.name).toBeCloseTo(0.35, 3);
    }
    let lamp = false;
    prepared.root.traverse((o) => {
      if (o.name === 'Lamp') lamp = true;
    });
    expect(lamp).toBe(true);
  });

  it('en sortie : mêmes places qu’au garage, à l’arrêt, en roulant, en plongée et en roulis ; essieux droits', () => {
    const { source, vehicle } = zUpModel();
    const garage = garageCentres(source, vehicle);
    const { prepared, rig } = drive(source, vehicle);
    expect(rig.wheels).toHaveLength(4);
    expect(rollAround(prepared, rig, garage)).toBeLessThan(1e-3);
  });
});

/** Le GLB du concept, sans ses textures (KTX2, inutiles ici et illisibles hors navigateur). */
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

const conceptManifest = JSON.parse(readFileSync(new URL('../../public/assets/vehicles/concept/vehicle.json', import.meta.url), 'utf8')) as VehicleManifest;
const loadConcept = () => new GLTFLoader().parseAsync(conceptGlb(), '').then((gltf) => gltf.scene);

describe('le concept (vrai modèle)', () => {
  it('roues dans leurs passages : centrées entre les bords de l’aile, jeu au-dessus du pneu et bas de caisse conformes au manifeste', async () => {
    const prepared = prepare(await loadConcept(), conceptManifest);
    prepared.root.updateMatrixWorld(true);
    const v = new Vector3();
    const gaps: Record<'front' | 'rear', number> = { front: Infinity, rear: Infinity };
    for (const anchor of prepared.wheels.anchors) {
      const box = new Box3().setFromObject(anchor.node, true);
      const c = box.getCenter(new Vector3());
      const r = (box.max.y - box.min.y) / 2;
      // Le pneu touche le sol.
      expect(box.min.y, anchor.node.name).toBeCloseTo(0, 2);
      let ahead = Infinity;
      let behind = -Infinity;
      let top = Infinity;
      prepared.wheels.body.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const position = mesh.geometry.getAttribute('position');
        for (let i = 0; i < position.count; i += 1) {
          v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
          if (Math.abs(v.z - c.z) > 0.14) continue;
          const dx = v.x - c.x;
          // Bords de l'aile à hauteur d'essieu, devant et derrière le pneu.
          if (Math.abs(v.y - c.y) < 0.05 && Math.abs(dx) > r - 0.02 && Math.abs(dx) < r + 0.3) {
            if (dx > 0) ahead = Math.min(ahead, v.x);
            else behind = Math.max(behind, v.x);
          }
          // Voûte du passage au-dessus du pneu.
          if (Math.abs(dx) < 0.08 && v.y > c.y + r - 0.02) top = Math.min(top, v.y - (c.y + r));
        }
      });
      expect(Math.abs((ahead + behind) / 2 - c.x), `${anchor.node.name} dans son passage`).toBeLessThan(0.02);
      const axle = anchor.front ? 'front' : 'rear';
      gaps[axle] = Math.min(gaps[axle], top);
    }
    expect(prepared.wheels.anchors.filter((a) => a.front)).toHaveLength(2);
    const [gapFront, gapRear] = conceptManifest.wheels!.gap;
    expect(Math.abs(gaps.front - gapFront)).toBeLessThan(0.004);
    expect(Math.abs(gaps.rear - gapRear)).toBeLessThan(0.004);
    const floor = new Box3().setFromObject(prepared.wheels.body, true).min.y;
    expect(Math.abs(floor - conceptManifest.wheels!.floor)).toBeLessThan(0.004);
  });

  it('phares, feux et plaque gardés (pièces d’un matériau unique sous le soubassement)', async () => {
    const prepared = prepare(await loadConcept(), conceptManifest);
    const names = new Set<string>();
    prepared.root.traverse((o) => names.add(o.name));
    for (const name of ['BodyHeadlights', 'BodyTaillights', 'BodyTurnsignalsRear', 'License_Plate']) expect(names.has(name), name).toBe(true);
  });

  it('mêmes places au garage et en sortie, à l’arrêt et en roulant', async () => {
    const source = await loadConcept();
    const garage = garageCentres(source, conceptManifest);
    const { prepared, rig } = drive(source, conceptManifest);
    expect(rig.wheels).toHaveLength(4);
    // Étriers et plaquettes tournent avec la roue : la boîte de l'ensemble bouge de quelques
    // millimètres en roulant (le défaut corrigé la décalait de 30 à 50 cm).
    expect(rollAround(prepared, rig, garage)).toBeLessThan(0.01);
  });
});
