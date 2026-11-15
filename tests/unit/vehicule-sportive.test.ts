// La sportive (placeholder_sportive) : manifeste et modèle généré par
// assets-src/vehicles/sportive/model.mjs, contrôlés contre les conventions du § 8 du cahier des
// charges et le gabarit chiffré de la fiche « La sportive ».

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseGlb } from '../../tools/lib/glb.mjs';
import { buildVehicle } from '../../tools/vehicles/build.mjs';
import * as kit from '../../tools/vehicles/kit.mjs';
import { FINISHES } from '../../src/data/finishes.ts';
import type { VehicleManifest } from '../../src/data/vehicleTypes.ts';

const manifest = JSON.parse(readFileSync(new URL('../../public/assets/vehicles/sportive/vehicle.json', import.meta.url), 'utf8')) as VehicleManifest;

/** Écart relatif sous 5 %. */
const near = (value: number, expected: number) => expect(Math.abs(value - expected) / expected).toBeLessThan(0.05);

describe('manifeste de la sportive', () => {
  it('décrit le substitut déclaré, moto au rang 40 de la vague 1', () => {
    expect(manifest.id).toBe('sportive');
    expect(manifest.name).toBe('La sportive');
    expect(manifest.kind).toBe('bike');
    expect(manifest.wave).toBe(1);
    expect(manifest.order).toBe(40);
    expect(manifest.glb).toBe('body.glb');
    expect(manifest.placeholder).toBe('placeholder_sportive');
    expect(manifest.hint).toBeTruthy();
    expect(manifest.hint).not.toContain('\n');
    expect(manifest.halfLengthHint).toBe(1.1);
    expect(manifest.interiorView).toBeUndefined();
  });

  it('porte les zones de la fiche et la livrée d’origine', () => {
    const ids = manifest.zones.map((z) => z.id);
    expect(ids).toEqual(['carenage', 'reservoir', 'garde_boue', 'bas_carenage', 'coque_arriere', 'jantes', 'cadre', 'fourche', 'selle']);
    const finishIds = new Set<string>(FINISHES.map((f) => f.id));
    for (const zone of manifest.zones) {
      expect(zone.paint.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(finishIds.has(zone.paint.finish)).toBe(true);
      expect(zone.materials).toEqual([`paint_${zone.id}`]);
    }
    const byId = Object.fromEntries(manifest.zones.map((z) => [z.id, z]));
    expect(byId.carenage!.paint).toEqual({ color: '#ff6a00', finish: 'satine' });
    for (const id of ['carenage', 'reservoir', 'garde_boue', 'bas_carenage', 'coque_arriere']) expect(byId[id]!.group).toBe('carrosserie');
    for (const id of ['reservoir', 'garde_boue']) expect(byId[id]!.linked).not.toBe(false);
    expect(byId.bas_carenage!.linked).toBe(false);
    expect(byId.bas_carenage!.paint.color).toBe('#f0efe9');
    expect(byId.coque_arriere!.linked).toBe(false);
    for (const id of ['jantes', 'cadre', 'fourche', 'selle']) expect(byId[id]!.group).toBe('accastillage');
    expect(byId.jantes!.paint.color).toBe('#ff6a00');
    expect(byId.cadre!.paint.finish).toBe('satine');
    expect(byId.fourche!.paint).toEqual({ color: '#c9a23a', finish: 'metallise' });
    expect(byId.selle!.paint.finish).toBe('mat');
  });

  it('donne le moteur de la fiche', () => {
    expect(manifest.engine).toEqual({ label: '4 cylindres en ligne', fuel: 'essence', feed: 'injection', boost: 'atmo', power: 172 });
  });
});

describe('modèle de la sportive', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON glTF lu tel quel
  let json: Record<string, any>;
  let summary: Awaited<ReturnType<typeof buildVehicle>>['summary'];

  beforeAll(async () => {
    const built = await buildVehicle('sportive');
    summary = built.summary;
    const parsed = parseGlb(built.bytes);
    if (!parsed.ok) throw new Error(parsed.message);
    json = parsed.container.json;
  }, 60_000);

  /** Boîte englobante d'un nœud (maillage posé sans rotation). */
  const nodeBox = (name: string) => {
    const node = json.nodes.find((n: { name: string }) => n.name === name);
    const t = node.translation ?? [0, 0, 0];
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const p of json.meshes[node.mesh].primitives) {
      const acc = json.accessors[p.attributes.POSITION];
      for (let i = 0; i < 3; i += 1) {
        min[i] = Math.min(min[i]!, acc.min[i] + t[i]);
        max[i] = Math.max(max[i]!, acc.max[i] + t[i]);
      }
    }
    return { min, max };
  };

  it('nomme ses matériaux par rôle, et chaque peinture est une zone du manifeste', () => {
    const zoneMaterials = manifest.zones.flatMap((z) => z.materials);
    for (const name of summary.materials) {
      expect(name).toMatch(kit.MATERIAL_NAME);
      if (name.startsWith('paint_')) expect(zoneMaterials).toContain(name);
    }
    for (const mat of zoneMaterials) expect(summary.materials).toContain(mat);
    for (const role of ['glass', 'lamp', 'tail', 'signal', 'chrome', 'rubber', 'black', 'alu']) expect(summary.materials).toContain(role);
  });

  it('tient les budgets : 40 000 à 120 000 triangles, moins de 60 appels de dessin', () => {
    expect(summary.triangles).toBeGreaterThanOrEqual(40_000);
    expect(summary.triangles).toBeLessThanOrEqual(120_000);
    expect(summary.primitives).toBeLessThan(60);
  });

  it('pose ses roues sur l’empattement de 1,41 m, aux diamètres de la fiche', () => {
    expect(summary.min[1]).toBeCloseTo(0, 2);
    const wheels = json.nodes.filter((n: { name: string }) => n.name.startsWith('roue_'));
    expect(wheels.map((n: { name: string }) => n.name).sort()).toEqual(['roue_arriere', 'roue_avant']);
    const at = (name: string) => wheels.find((n: { name: string }) => n.name === name).translation as number[];
    near(at('roue_avant')[0]! - at('roue_arriere')[0]!, 1.41);
    expect(at('roue_avant')[0]! + at('roue_arriere')[0]!).toBeCloseTo(0, 3);
    expect(at('roue_avant')[2]).toBeCloseTo(0, 3);
    const front = nodeBox('roue_avant');
    const rear = nodeBox('roue_arriere');
    near(front.max[1]! - front.min[1]!, 0.6);
    near(rear.max[1]! - rear.min[1]!, 0.63);
    expect(front.min[1]).toBeCloseTo(0, 2);
    expect(rear.min[1]).toBeCloseTo(0, 2);
  });

  it('a les cotes du gabarit à 5 % près', () => {
    near(summary.max[0] - summary.min[0], 2.03); // longueur hors tout
    near(summary.max[2] - summary.min[2], 0.72); // largeur aux rétroviseurs
    near(summary.max[1], 1.12); // haut de bulle
    expect(summary.max[2] + summary.min[2]).toBeCloseTo(0, 2);
    const fairing = nodeBox('carenage');
    near(fairing.max[2]! - fairing.min[2]!, 0.5);
    near(fairing.max[0]!, 0.8); // nez
    expect(Math.abs(fairing.min[1]! - 0.17)).toBeLessThan(0.01); // sabot
    const tail = nodeBox('reservoir');
    near(tail.min[0]!, -0.98); // pointe de la coque
    near(tail.max[1]!, 0.98); // dessus du réservoir
    near(tail.max[2]! - tail.min[2]!, 0.42);
    near(nodeBox('bulle').max[1]!, 1.12);
  });
});
