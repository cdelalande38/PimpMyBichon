// Pose des ailerons sur chaque caisse qui les déclare : chaque option du catalogue, modelée en mémoire
// (tools/vehicles/pieces.mjs) et posée comme dans l'app (src/data/pieces.ts, fitPositions), sur le
// modèle du véhicule posé comme dans l'app (substituts fabriqués en mémoire, concept lu dans le dépôt).
// Le dessus de la caisse est relevé en carte des hauteurs (1 cm) ; on contrôle que les pièces ne
// flottent pas (dessous et pieds sur la surface, à 3 mm près) et ne s'enfoncent pas (au plus 1,5 cm
// sous la surface pour le dessous, 1 cm de jour au moins pour le reste).

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { Mesh, Vector3, type BufferGeometry, type Group } from 'three';
import { buildPiece, readCatalogue } from '../../tools/vehicles/pieces.mjs';
import { fitPositions, FOOT_BAND, optionsFor, PIECE_NODES, posteById, type PiecePoste } from '../../src/data/pieces.ts';
import type { VehicleManifest } from '../../src/data/vehicleTypes.ts';
import { builtModel, storedModel } from './places-modeles.ts';

const CELL = 0.01;

/** Carte des hauteurs du dessus de la caisse : le point le plus haut de chaque case de 1 cm. */
class HeightMap {
  readonly x0: number;
  readonly z0: number;
  readonly nx: number;
  readonly nz: number;
  readonly top: Float32Array;

  constructor(model: Group, box: { x: [number, number]; z: [number, number] }) {
    this.x0 = box.x[0];
    this.z0 = box.z[0];
    this.nx = Math.ceil((box.x[1] - box.x[0]) / CELL) + 1;
    this.nz = Math.ceil((box.z[1] - box.z[0]) / CELL) + 1;
    this.top = new Float32Array(this.nx * this.nz).fill(-Infinity);
    model.updateMatrixWorld(true);
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    model.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const geometry = object.geometry as BufferGeometry;
      const position = geometry.getAttribute('position');
      const index = geometry.index;
      const count = index ? index.count : position.count;
      for (let i = 0; i < count; i += 3) {
        const ia = index ? index.getX(i) : i;
        const ib = index ? index.getX(i + 1) : i + 1;
        const ic = index ? index.getX(i + 2) : i + 2;
        a.fromBufferAttribute(position, ia).applyMatrix4(object.matrixWorld);
        b.fromBufferAttribute(position, ib).applyMatrix4(object.matrixWorld);
        c.fromBufferAttribute(position, ic).applyMatrix4(object.matrixWorld);
        this.raster(a, b, c);
      }
    });
  }

  private raster(a: Vector3, b: Vector3, c: Vector3): void {
    const minX = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - this.x0) / CELL));
    const maxX = Math.min(this.nx - 1, Math.ceil((Math.max(a.x, b.x, c.x) - this.x0) / CELL));
    const minZ = Math.max(0, Math.floor((Math.min(a.z, b.z, c.z) - this.z0) / CELL));
    const maxZ = Math.min(this.nz - 1, Math.ceil((Math.max(a.z, b.z, c.z) - this.z0) / CELL));
    if (minX > maxX || minZ > maxZ) return;
    const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    if (Math.abs(d) < 1e-12) return;
    for (let i = minX; i <= maxX; i += 1) {
      const x = this.x0 + i * CELL;
      for (let j = minZ; j <= maxZ; j += 1) {
        const z = this.z0 + j * CELL;
        const l1 = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / d;
        const l2 = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / d;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        const y = l1 * a.y + l2 * b.y + l3 * c.y;
        const k = i * this.nz + j;
        if (y > (this.top[k] as number)) this.top[k] = y;
      }
    }
  }

  private sample(i: number, j: number): number {
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return -Infinity;
    return this.top[i * this.nz + j] as number;
  }

  /** Hauteur du dessus de la caisse en (x, z), interpolée entre les quatre relevés voisins ; −∞ hors de la caisse. */
  at(x: number, z: number): number {
    const u = (x - this.x0) / CELL;
    const v = (z - this.z0) / CELL;
    const i = Math.floor(u);
    const j = Math.floor(v);
    const [a, b, c, d] = [this.sample(i, j), this.sample(i + 1, j), this.sample(i, j + 1), this.sample(i + 1, j + 1)];
    if (![a, b, c, d].every(Number.isFinite)) return this.sample(Math.round(u), Math.round(v));
    const fu = u - i;
    const fv = v - j;
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
  }
}

interface Report {
  /** Écart le plus haut du dessous (ou des pieds) au-dessus de la surface : un jour s'il est positif. */
  float: number;
  /** Écart le plus bas du dessous (ou des pieds) sous la surface. */
  sink: number;
  /** Plus petit jour entre le reste de la pièce et la caisse. */
  clearance: number;
  /** Où se trouvent le plus grand jour et le point le plus enfoncé (repère de la pièce), pour corriger le manifeste. */
  where: { float: string; sink: string };
}

/** Pose une option sur un véhicule (comme l'app) et mesure contact et jours contre la carte des hauteurs. */
function measure(map: HeightMap, vehicle: VehicleManifest, poste: PiecePoste, optionId: string): Report {
  const option = poste.options.find((item) => item.id === optionId);
  const mount = vehicle.pieces?.[poste.id];
  if (!option || !mount) throw new Error(`${vehicle.id} : ${optionId} introuvable`);
  const { node, parts } = buildPiece(option);
  const report: Report = { float: -Infinity, sink: Infinity, clearance: Infinity, where: { float: '', sink: '' } };
  const spot = (lx: number, ly: number, lz: number) => `(${lx.toFixed(3)}, ${ly.toFixed(3)}, ${lz.toFixed(3)})`;
  for (const part of parts) {
    const source = part.geometry.getAttribute('position').array as Float32Array;
    const fitted = fitPositions(source, node, mount, poste, option);
    for (let i = 0; i < source.length; i += 3) {
      const [lx, ly, lz] = [source[i] as number, source[i + 1] as number, source[i + 2] as number];
      const [x, y, z] = [fitted[i] as number, fitted[i + 1] as number, fitted[i + 2] as number];
      const ground = map.at(x, z);
      if (!Number.isFinite(ground)) continue;
      const gap = y - ground;
      // Le dessous : celui d'une pièce de surface en avant du bord de fuite, celui des pieds et des semelles.
      const contact = ly <= -0.003 && (node === PIECE_NODES.level || (lx >= 0.01 && Math.abs(lz) <= 0.57));
      if (contact) {
        if (gap > report.float) [report.float, report.where.float] = [gap, spot(lx, ly, lz)];
        if (gap < report.sink) [report.sink, report.where.sink] = [gap, spot(lx, ly, lz)];
      } else if (node === PIECE_NODES.level && ly > FOOT_BAND + 0.01) report.clearance = Math.min(report.clearance, gap);
    }
  }
  return report;
}

const MANIFESTS = ['cox', 'van', 'concept'].map((id) => JSON.parse(readFileSync(new URL(`../../public/assets/vehicles/${id}/vehicle.json`, import.meta.url), 'utf8')) as VehicleManifest);
const AILERON = posteById('aileron');

describe('ailerons posés sur les trois voitures', () => {
  const maps = new Map<string, HeightMap>();
  beforeAll(async () => {
    for (const vehicle of MANIFESTS) {
      const model = vehicle.placeholder === 'placeholder_banc' ? await storedModel(vehicle.id) : await builtModel(vehicle.id);
      const mount = vehicle.pieces?.aileron;
      if (!mount) continue;
      const xs = [mount.anchor[0], mount.supports?.anchor[0] ?? mount.anchor[0]];
      maps.set(vehicle.id, new HeightMap(model, { x: [Math.min(...xs) - 0.6, Math.max(...xs) + 0.6], z: [-1.2, 1.2] }));
    }
  }, 120_000);

  it('le catalogue des pièces est celui que lit l’outil', () => {
    expect(readCatalogue().postes.map((poste) => poste.id)).toContain('aileron');
    expect(AILERON).toBeDefined();
  });

  for (const vehicle of MANIFESTS) {
    it(`${vehicle.id} : chaque aileron se pose juste (ni jour, ni pièce enfoncée)`, () => {
      const map = maps.get(vehicle.id);
      if (!map || !AILERON) throw new Error(`${vehicle.id} : pas de carte des hauteurs`);
      const options = optionsFor(vehicle, 'aileron');
      expect(options.length, 'options permises').toBeGreaterThanOrEqual(4);
      const reports = options.map((option) => ({ option, r: measure(map, vehicle, AILERON, option.id) }));
      const mm = (v: number) => (v * 1000).toFixed(1);
      const lines = reports.map(({ option, r }) => `${option.id} : jour ${mm(r.float)} mm en ${r.where.float}, enfoncé ${mm(r.sink)} mm en ${r.where.sink}, dégagement ${mm(r.clearance)} mm`);
      if (process.env.PMB_POSE) console.log(`${vehicle.id}\n  ${lines.join('\n  ')}`);
      for (const { option, r } of reports) {
        expect(r.float, `${vehicle.id} ${option.id} : dessous ou pieds décollés`).toBeLessThanOrEqual(0.003);
        expect(r.sink, `${vehicle.id} ${option.id} : dessous ou pieds enfoncés`).toBeGreaterThanOrEqual(-0.015);
        if (option.mount === 'supports') expect(r.clearance, `${vehicle.id} ${option.id} : lame ou dérive dans la caisse`).toBeGreaterThanOrEqual(0.01);
      }
    });
  }
});
