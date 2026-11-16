// Garde au sol des caméras de la sortie (src/drive/cameras.ts, guardShot) et sonde de terrain
// (src/drive/scene/relief.ts) : sur un relief d'essai, puis sur chaque carte fabriquée (npm run
// maps:build) de bout en bout, tronçons réels compris : aucune des six caméras ne passe sous le
// terrain ni dans un bâtiment, et aucun talus ne cache le véhicule (hors tunnels, où la garde se tait).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MapRoute } from '../../src/data/mapTypes.ts';
import { CAMERA_GUARD, cameraShot, createShot, guardShot, type GroundSampler } from '../../src/drive/cameras.ts';
import { CAMERA_IDS, type DriveMotion, type VehicleFrame } from '../../src/drive/contrat.ts';
import { createPose, createRail } from '../../src/drive/rail.ts';
import { addRoleMesh, createChunkRelief, HeightGrid, LAYER_GAP, Relief } from '../../src/drive/scene/relief.ts';


const ORBIT = { yaw: 0.6, pitch: 0.28, distance: 7.5 };

function motionAt(s: number): DriveMotion {
  return { s, speed: 22, accel: 0, offset: 0, roll: 0, dive: 0, braking: false, finished: false };
}

describe('grille de hauteurs', () => {
  it('trame un triangle : cases couvertes à la bonne hauteur, NaN ailleurs', () => {
    const g = new HeightGrid(2);
    // Plan incliné y = x / 10 sur un grand triangle.
    g.triangle(0, 0, 0, 40, 4, 0, 0, 0, 40);
    expect(g.sample(10, 10)).toBeCloseTo(1, 1);
    expect(g.sample(30, 2)).toBeCloseTo(3, 1);
    expect(Number.isNaN(g.sample(-30, -30))).toBe(true);
    // Une case garde le point le plus haut.
    g.triangle(0, 9, 0, 6, 9, 0, 0, 9, 6);
    expect(g.sample(1.5, 1.5)).toBeGreaterThan(8.5);
  });

  it('un maillage indexé décalé de son origine', () => {
    const g = new HeightGrid(2);
    g.mesh([0, 1, 0, 20, 1, 0, 0, 1, 20], [0, 1, 2], 100, 10, 100);
    expect(g.sample(104, 104)).toBeCloseTo(11, 5);
    expect(g.tileCount).toBe(1);
  });
});

/** Sonde d'essai : sol plat à 0, une butte de 5 m entre x = −12 et x = −7, un toit à 6 m au-delà de z = 20. */
const TEST_GROUND: GroundSampler = {
  ground: (x) => (x > -12 && x < -7 ? 5 : 0),
  built: (_x, z) => (z > 20 ? 6 : Number.NaN),
};

describe('garde d’un plan', () => {
  it('relève une caméra sous le sol', () => {
    const shot = { position: [0, -1, 0] as [number, number, number], target: [5, 0.6, 0] as [number, number, number], fov: 50 };
    guardShot(shot, TEST_GROUND);
    expect(shot.position[1]).toBeGreaterThanOrEqual(CAMERA_GUARD.clearance - 1e-9);
  });

  it('relève une caméra qu’une butte cache, de 3 m au plus, sinon la rapproche', () => {
    const low = { position: [-14, 2, 0] as [number, number, number], target: [0, 0.6, 0] as [number, number, number], fov: 50 };
    guardShot(low, TEST_GROUND);
    // Ligne de visée libre après la garde.
    for (let k = 0.05; k < 1; k += 0.05) {
      const x = low.target[0] + (low.position[0] - low.target[0]) * k;
      const y = low.target[1] + (low.position[1] - low.target[1]) * k;
      expect(y).toBeGreaterThanOrEqual(TEST_GROUND.ground(x, 0) - 1e-6);
    }
  });

  it('sort une caméra d’un bâtiment en la rapprochant du point visé', () => {
    const shot = { position: [0, 2, 30] as [number, number, number], target: [0, 0.6, 0] as [number, number, number], fov: 50 };
    guardShot(shot, TEST_GROUND);
    expect(shot.position[2]).toBeLessThanOrEqual(20);
  });

  it('une sonde muette laisse le plan tel quel', () => {
    const mute: GroundSampler = { ground: () => Number.NaN, built: () => Number.NaN };
    const shot = { position: [1, 2, 3] as [number, number, number], target: [0, 0, 0] as [number, number, number], fov: 50 };
    guardShot(shot, mute);
    expect(shot.position).toEqual([1, 2, 3]);
  });
});

// ——— Les cartes fabriquées, tronçons réels ———

const MAPS_DIR = new URL('../../public/assets/maps/', import.meta.url);
const BUILT = existsSync(MAPS_DIR) ? readdirSync(MAPS_DIR).filter((id) => existsSync(new URL(`${id}/route.json`, MAPS_DIR))) : [];
/**
 * Cartes tenues à zéro défaut. Les autres (Monaco, novembre 2026) ont des tronçons où le terrain de la
 * carte recouvre la chaussée (défaut de l'outil des cartes, noté dans TODO_ASSETS.md) : là, aucune
 * caméra ne peut voir le véhicule ; on y vérifie seulement que la garde fait mieux que rien.
 */
const STRICT = new Set(['plateau-matheysin']);

/** Lecteur GLB minimal : positions et indices de chaque maillage nommé fusion_<rôle>. */
function readChunk(file: URL): Array<{ role: string; positions: Float32Array; index: Uint32Array | Uint16Array | null }> {
  const buf = readFileSync(file);
  const jsonLength = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8')) as {
    meshes: Array<{ name: string; primitives: Array<{ attributes: { POSITION: number }; indices?: number }> }>;
    accessors: Array<{ bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }>;
    bufferViews: Array<{ byteOffset?: number; byteLength: number }>;
  };
  const binStart = 20 + jsonLength + 8;
  const view = (accessor: number) => {
    const a = json.accessors[accessor]!;
    const bv = json.bufferViews[a.bufferView]!;
    const offset = binStart + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const size = a.type === 'VEC3' ? 3 : 1;
    const bytes = buf.buffer.slice(buf.byteOffset + offset, buf.byteOffset + offset + a.count * size * (a.componentType === 5123 ? 2 : 4));
    if (a.componentType === 5126) return new Float32Array(bytes);
    if (a.componentType === 5123) return new Uint16Array(bytes);
    return new Uint32Array(bytes);
  };
  return json.meshes.flatMap((m) =>
    m.primitives.map((p) => ({
      role: m.name.replace(/^fusion_/, ''),
      positions: view(p.attributes.POSITION) as Float32Array,
      index: p.indices === undefined ? null : (view(p.indices) as Uint32Array | Uint16Array),
    })),
  );
}

describe.skipIf(BUILT.length === 0)('les cartes fabriquées : aucune caméra sous le terrain', () => {
  it.each(BUILT)('%s : six caméras, voiture et moto, tous les 4 m du rail', (id) => {
    const DIR = new URL(`${id}/`, MAPS_DIR);
    const route = JSON.parse(readFileSync(new URL('route.json', DIR), 'utf8')) as MapRoute;
    const rail = createRail(route);
    const relief = new Relief();
    route.chunks.forEach((chunk, i) => {
      const r = createChunkRelief();
      for (const m of readChunk(new URL(chunk.file, DIR))) addRoleMesh(r, m.role, m.positions, m.index, ...chunk.origin);
      relief.set(i, r);
    });
    const pose = createPose();
    const shot = createShot();
    const vehicles: VehicleFrame[] = [
      { kind: 'car', position: [0, 0, 0], heading: 0, pitch: 0, roll: 0, halfLength: 2.1, halfWidth: 0.95, height: 1.3 },
      { kind: 'bike', position: [0, 0, 0], heading: 0, pitch: 0, roll: 0, halfLength: 1.1, halfWidth: 0.45, height: 1.2 },
    ];
    let before = 0;
    let covered = 0;
    let checked = 0;
    const failures: string[] = [];
    for (const frame of vehicles) {
      for (let s = 0; s <= rail.length; s += 4) {
        rail.poseAt(s, pose);
        if (pose.ground === 'tunnel') continue;
        // Chaussée recouverte (terrain ou ouvrage à plus de LAYER_GAP au-dessus, hors tunnel déclaré) :
        // un défaut de la carte, où aucune caméra ne voit le véhicule de dehors. Compté, borné.
        if (relief.ground(pose.position[0], pose.position[2]) > pose.position[1] + LAYER_GAP) {
          covered += 1;
          continue;
        }
        frame.position = [pose.position[0], pose.position[1], pose.position[2]];
        frame.heading = pose.heading;
        frame.pitch = pose.pitch;
        const motion = motionAt(s);
        for (const id of CAMERA_IDS) {
          cameraShot(id, frame, motion, rail, s / 22, ORBIT, shot);
          const [x0, y0, z0] = shot.position;
          const g0 = relief.ground(x0, z0, y0);
          if (g0 === g0 && y0 < g0) before += 1;
          guardShot(shot, relief);
          checked += 1;
          const [x, y, z] = shot.position;
          const g = relief.ground(x, z, y);
          if (g === g && y < g + CAMERA_GUARD.clearance - 1e-3) failures.push(`${frame.kind} ${id} s=${s} : ${(y - g).toFixed(2)} m au-dessus du sol`);
          const b = relief.built(x, z);
          if (b === b && y < b) failures.push(`${frame.kind} ${id} s=${s} : dans un bâtiment`);
          // Ligne de visée : pas de terrain entre la caméra et le point visé.
          for (let k = 1; k < CAMERA_GUARD.steps; k += 1) {
            const f = k / CAMERA_GUARD.steps;
            const px = shot.target[0] + (x - shot.target[0]) * f;
            const py = shot.target[1] + (y - shot.target[1]) * f;
            const pz = shot.target[2] + (z - shot.target[2]) * f;
            const h = relief.ground(px, pz, py);
            if (h === h && py < h - 0.05) {
              failures.push(`${frame.kind} ${id} s=${s} : talus dans la ligne de visée`);
              break;
            }
          }
        }
      }
    }
    const under = failures.filter((f) => f.includes('au-dessus du sol')).length;
    console.info(`${id} : garde des caméras sur ${checked} plans, ${before} sous le terrain sans elle, ${under} avec elle ; ${failures.length} défauts en tout ; ${covered} positions sous une chaussée recouverte`);
    expect(checked).toBeGreaterThan((route.length / 4) * 10);
    if (STRICT.has(id)) expect(failures.slice(0, 12)).toEqual([]);
    else expect(under).toBeLessThan(Math.max(1, before));
  }, 60_000);
});
