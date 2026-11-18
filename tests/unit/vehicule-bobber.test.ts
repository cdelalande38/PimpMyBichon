// Le bobber (placeholder_bobber) : manifeste et modèle généré par assets-src/vehicles/bobber/model.mjs,
// contrôlés contre les conventions du § 8 du cahier des charges et le gabarit de la fiche « Le bobber ».

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseGlb } from '../../tools/lib/glb.mjs';
import { buildVehicle } from '../../tools/vehicles/build.mjs';
import * as kit from '../../tools/vehicles/kit.mjs';
import { buildRim, buildTire, readCatalogue } from '../../tools/vehicles/roues.mjs';
import { outerRadius } from '../../src/data/wheels.ts';
import { FINISHES } from '../../src/data/finishes.ts';
import type { VehicleManifest } from '../../src/data/vehicleTypes.ts';

const manifest = JSON.parse(readFileSync(new URL('../../public/assets/vehicles/bobber/vehicle.json', import.meta.url), 'utf8')) as VehicleManifest;

/** Écart relatif sous 5 %. */
const near = (value: number, expected: number) => expect(Math.abs(value - expected) / expected).toBeLessThan(0.05);

/** Matériaux des roues partagées que l'app pose sur les ancres (jantes du genre, tous les pneus). */
function sharedWheelMaterials(kind: 'car' | 'bike'): string[] {
  const catalogue = readCatalogue();
  const parts = [...catalogue.rims.filter((rim) => rim.kind === kind).flatMap((rim) => buildRim(rim, catalogue)), ...catalogue.tires.flatMap((tire) => buildTire(tire, kind, catalogue))];
  return [...new Set(parts.map((part) => part.material))];
}

describe('manifeste du bobber', () => {
  it('décrit le substitut déclaré, moto au rang 30 de la vague 1, sans vue intérieure', () => {
    expect(manifest.id).toBe('bobber');
    expect(manifest.name).toBe('Le bobber');
    expect(manifest.kind).toBe('bike');
    expect(manifest.wave).toBe(1);
    expect(manifest.order).toBe(30);
    expect(manifest.glb).toBe('body.glb');
    expect(manifest.placeholder).toBe('placeholder_bobber');
    expect(manifest.hint).toBeTruthy();
    expect(manifest.hint).not.toContain('\n');
    expect(manifest.halfLengthHint).toBe(1.2);
    expect(manifest.interiorView).toBeUndefined();
  });

  it('porte les zones de la fiche : réservoir maître et garde-boue liés, le reste en accastillage', () => {
    const ids = manifest.zones.map((z) => z.id);
    expect(ids).toEqual(['reservoir', 'garde_boue', 'cadre', 'moteur', 'jantes', 'fourche', 'selle']);
    const finishIds = new Set<string>(FINISHES.map((f) => f.id));
    for (const zone of manifest.zones) {
      expect(zone.label.length).toBeGreaterThan(0);
      expect(zone.paint.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(finishIds.has(zone.paint.finish)).toBe(true);
      expect(zone.materials).toEqual([`paint_${zone.id}`]);
    }
    const byId = Object.fromEntries(manifest.zones.map((z) => [z.id, z]));
    for (const id of ['reservoir', 'garde_boue']) {
      expect(byId[id]!.group).toBe('carrosserie');
      expect(byId[id]!.paint).toEqual({ color: '#0b0b0e', finish: 'brillant' });
      expect(byId[id]!.linked).not.toBe(false);
    }
    for (const id of ['cadre', 'moteur', 'jantes', 'fourche', 'selle']) expect(byId[id]!.group).toBe('accastillage');
    expect(byId.cadre!.paint.finish).toBe('satine');
    expect(byId.moteur!.paint.finish).toBe('mat');
    expect(byId.jantes!.paint.finish).toBe('satine');
    expect(byId.fourche!.paint.finish).toBe('satine');
    expect(byId.selle!.paint.finish).toBe('mat');
  });

  it('donne le moteur de la fiche', () => {
    expect(manifest.engine).toEqual({ label: 'bicylindre en V refroidi par air', fuel: 'essence', feed: 'carburateur', boost: 'atmo', power: 67, sound: 'bicylindre-v', model: 'bicylindre-v' });
  });
});

describe('modèle du bobber', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON glTF lu tel quel
  let json: Record<string, any>;
  let summary: Awaited<ReturnType<typeof buildVehicle>>['summary'];

  beforeAll(async () => {
    const built = await buildVehicle('bobber');
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
    // La zone des jantes est portée par les jantes partagées (tools/vehicles/roues.mjs), que l'app pose sur les ancres.
    const fitZone = manifest.wheels?.fit?.zone;
    expect(fitZone).toBeDefined();
    for (const zone of manifest.zones) for (const mat of zone.materials) if (zone.id !== fitZone) expect(summary.materials).toContain(mat);
    const wheelMaterials = sharedWheelMaterials(manifest.kind);
    expect(wheelMaterials).toContain(`paint_${fitZone}`);
    for (const role of ['chrome', 'rubber', 'black', 'lamp', 'tail', 'glass']) expect([...summary.materials, ...wheelMaterials]).toContain(role);
  });

  it('tient les budgets : 40 000 à 120 000 triangles, moins de 60 appels de dessin', () => {
    expect(summary.triangles).toBeGreaterThanOrEqual(40_000);
    expect(summary.triangles).toBeLessThanOrEqual(120_000);
    expect(summary.primitives).toBeLessThan(60);
  });

  it('pose ses deux roues à ±0,82 m, sur le sol, avec les pneus de la fiche', () => {
    // Les roues sont posées par l'app : la béquille seule touche le sol ; le reste de la caisse est à
    // la garde au sol du manifeste.
    expect(nodeBox('bequille').min[1]).toBeLessThan(0.01);
    expect(manifest.wheels!.grounded).toContain('bequille');
    const lowest = Math.min(...json.nodes.filter((n: { name: string; mesh?: number }) => n.mesh !== undefined && !/^roue_|^bequille$/.test(n.name)).map((n: { name: string }) => nodeBox(n.name).min[1]!));
    expect(lowest).toBeCloseTo(manifest.wheels!.floor, 2);
    const wheels = json.nodes.filter((n: { name: string }) => n.name.startsWith('roue_'));
    expect(wheels.map((n: { name: string }) => n.name).sort()).toEqual(['roue_arriere', 'roue_avant']);
    const at = (name: string) => wheels.find((n: { name: string }) => n.name === name).translation as number[];
    expect(at('roue_avant')).toEqual([0.82, 0.32, 0]);
    expect(at('roue_arriere')).toEqual([-0.82, 0.325, 0]);
    // Pneus d'origine du manifeste : 0,64 et 0,65 de diamètre, 130 de large devant ; centre de
    // chaque ancre à son rayon : au sol. Les ancres ne portent que disques, axe et poulie (plus petits que la jante).
    const fit = manifest.wheels!.fit!;
    near(2 * outerRadius(fit.front), 0.64);
    near(2 * outerRadius(fit.rear!), 0.65);
    near(fit.front.width / 1000, 0.13);
    expect(at('roue_avant')[1]!).toBeCloseTo(outerRadius(fit.front), 2);
    expect(at('roue_arriere')[1]!).toBeCloseTo(outerRadius(fit.rear!), 2);
    for (const name of ['roue_avant', 'roue_arriere']) {
      const parts = nodeBox(name);
      expect(Math.max(parts.max[1]! - parts.min[1]!, parts.max[0]! - parts.min[0]!) / 2).toBeLessThan((fit.diameter[0] * 0.0254) / 2);
    }
  });

  it('a les cotes du gabarit : longueur, guidon, selle, réservoir, phare', () => {
    // Longueur hors tout, roues d'origine posées comprises.
    const fit = manifest.wheels!.fit!;
    const ends = [0.82 + outerRadius(fit.front), -0.82 - outerRadius(fit.rear!), summary.max[0], summary.min[0]];
    near(Math.max(...ends) - Math.min(...ends), 2.29);
    expect(Math.max(...ends) + Math.min(...ends)).toBeCloseTo(0, 1);
    const bar = nodeBox('guidon');
    near(bar.max[2]! - bar.min[2]!, 0.85);
    expect(Math.abs(bar.max[1]! - 1.22)).toBeLessThan(0.025);
    const seat = nodeBox('selle');
    expect(Math.abs((seat.max[1]! + 0.632) / 2 - 0.66)).toBeLessThan(0.02);
    near(seat.max[0]! - seat.min[0]!, 0.32);
    const tank = nodeBox('reservoir');
    expect(Math.abs(tank.min[0]! + 0.12)).toBeLessThan(0.01);
    expect(Math.abs(tank.max[0]! - 0.38)).toBeLessThan(0.01);
    near(tank.max[2]! - tank.min[2]!, 0.3);
    const lamp = nodeBox('phare');
    expect(lamp.max[0]).toBeGreaterThan(0.7);
    // Échappements à droite, jusqu'à x = −0,75 environ.
    const pipes = nodeBox('echappement');
    expect(pipes.min[2]).toBeGreaterThan(0);
    expect(Math.abs(pipes.min[0]! + 0.76)).toBeLessThan(0.03);
  });
});
