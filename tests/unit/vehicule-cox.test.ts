// La Cox (placeholder_cox) : manifeste et modèle généré par assets-src/vehicles/cox/model.mjs,
// contrôlés contre les conventions du § 8 du cahier des charges et les cotes de la fiche « La Cox ».

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseGlb } from '../../tools/lib/glb.mjs';
import { buildVehicle } from '../../tools/vehicles/build.mjs';
import * as kit from '../../tools/vehicles/kit.mjs';
import { FINISHES } from '../../src/data/finishes.ts';
import type { VehicleManifest } from '../../src/data/vehicleTypes.ts';

const manifest = JSON.parse(readFileSync(new URL('../../public/assets/vehicles/cox/vehicle.json', import.meta.url), 'utf8')) as VehicleManifest;

/** Écart relatif sous 5 %. */
const near = (value: number, expected: number) => expect(Math.abs(value - expected) / expected).toBeLessThan(0.05);

describe('manifeste de la Cox', () => {
  it('décrit le substitut déclaré, au rang 10 de la vague 1', () => {
    expect(manifest.id).toBe('cox');
    expect(manifest.kind).toBe('car');
    expect(manifest.wave).toBe(1);
    expect(manifest.order).toBe(10);
    expect(manifest.glb).toBe('body.glb');
    expect(manifest.placeholder).toBe('placeholder_cox');
    expect(manifest.hint).toBeTruthy();
    expect(manifest.hint).not.toContain('\n');
    near(manifest.halfLengthHint, 4.08 / 2);
  });

  it('porte les zones de la fiche, peintes d’origine en sarcelle pailleté fin', () => {
    const ids = manifest.zones.map((z) => z.id);
    expect(ids).toEqual(expect.arrayContaining(['carrosserie', 'toit', 'capot', 'capot_moteur', 'ailes', 'jantes', 'sellerie']));
    expect(new Set(ids).size).toBe(ids.length);
    expect(manifest.zones[0]!.id).toBe('carrosserie');
    const finishIds = new Set<string>(FINISHES.map((f) => f.id));
    for (const zone of manifest.zones) {
      expect(zone.id).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(zone.label.length).toBeGreaterThan(0);
      expect(zone.paint.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(finishIds.has(zone.paint.finish)).toBe(true);
      expect(zone.materials).toEqual([`paint_${zone.id}`]);
    }
    const byId = Object.fromEntries(manifest.zones.map((z) => [z.id, z]));
    for (const id of ['carrosserie', 'toit', 'capot', 'capot_moteur', 'ailes']) {
      expect(byId[id]!.group).toBe('carrosserie');
      expect(byId[id]!.paint.color).toBe('#0a3a46');
      expect(byId[id]!.paint.finish).toBe('paillete');
      // Paillettes plus fines que celles de la finition, réglées dans le manifeste (en mm).
      expect(byId[id]!.paint.flake).toBeGreaterThan(0);
      expect(byId[id]!.paint.flake!).toBeLessThan(FINISHES.find((f) => f.id === 'paillete')!.flakeSize);
      expect(byId[id]!.linked).not.toBe(false); // ailes liées, comme le reste de la caisse
    }
    expect(byId.jantes!.group).toBe('accastillage');
    expect(byId.jantes!.paint.finish).toBe('chrome');
    expect(byId.sellerie!.group).toBe('accastillage');
    expect(byId.sellerie!.paint.finish).toBe('satine');
  });

  it('donne le moteur de la fiche', () => {
    expect(manifest.engine).toEqual({ label: '4 cylindres à plat refroidi par air', fuel: 'essence', feed: 'carburateur', boost: 'atmo', power: 50 });
  });
});

describe('modèle de la Cox', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON glTF lu tel quel
  let json: Record<string, any>;
  let summary: Awaited<ReturnType<typeof buildVehicle>>['summary'];

  beforeAll(async () => {
    const built = await buildVehicle('cox');
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
    for (const role of ['glass', 'lamp', 'tail', 'signal', 'chrome', 'rubber', 'black']) expect(summary.materials).toContain(role);
  });

  it('tient les budgets : 40 000 à 120 000 triangles, moins de 60 appels de dessin', () => {
    expect(summary.triangles).toBeGreaterThanOrEqual(40_000);
    expect(summary.triangles).toBeLessThanOrEqual(120_000);
    expect(summary.primitives).toBeLessThan(60);
  });

  it('pose ses roues au centre de l’empattement de 2,40 m, sur les voies de la fiche', () => {
    expect(summary.min[1]).toBeCloseTo(0, 2);
    const wheels = json.nodes.filter((n: { name: string }) => n.name.startsWith('roue_'));
    expect(wheels.map((n: { name: string }) => n.name).sort()).toEqual(['roue_arriere_droite', 'roue_arriere_gauche', 'roue_avant_droite', 'roue_avant_gauche']);
    const at = (name: string) => wheels.find((n: { name: string }) => n.name === name).translation as number[];
    near(at('roue_avant_droite')[0]! - at('roue_arriere_droite')[0]!, 2.4);
    expect(at('roue_avant_droite')[0]! + at('roue_arriere_droite')[0]!).toBeCloseTo(0, 3);
    near(at('roue_avant_droite')[2]! - at('roue_avant_gauche')[2]!, 1.31);
    near(at('roue_arriere_droite')[2]! - at('roue_arriere_gauche')[2]!, 1.35);
    // Roue de 0,60 m de diamètre, centre à l'origine de son maillage.
    const wheel = nodeBox('roue_avant_droite');
    near(wheel.max[1]! - wheel.min[1]!, 0.6);
    expect(wheel.min[1]).toBeCloseTo(0, 2);
  });

  it('a les cotes de la fiche à 5 % près (caisse hors rétroviseur)', () => {
    const body = nodeBox('carrosserie');
    near(body.max[0]! - body.min[0]!, 4.08);
    near(body.max[2]! - body.min[2]!, 1.55);
    near(body.max[1]!, 1.44);
    expect(body.max[2]! + body.min[2]!).toBeCloseTo(0, 2); // symétrique gauche-droite
    // Garde au sol de 0,11 m, à 1 cm près.
    expect(Math.abs(body.min[1]! - 0.11)).toBeLessThan(0.01);
    // Avant vers +X : le porte-à-faux avant (0,79 m) est plus court que l'arrière (0,89 m).
    expect(body.max[0]! - 1.2).toBeLessThan(-body.min[0]! - 1.2);
    // Longueur hors tout, échappements compris.
    near(summary.max[0] - summary.min[0], 4.08);
  });
});
